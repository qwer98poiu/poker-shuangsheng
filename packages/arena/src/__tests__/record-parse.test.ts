import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRevealOptions } from '@poker/engine';
import { ChainWriter } from '../record-writer.js';
import { deckHashFromCodes, deriveChainSeed } from '../record-rng.js';
import { runChain } from '../record-run.js';
import { engineStrategy } from '../strategies.js';
import type { Strategy } from '../types.js';
import type { HandRecord } from '../record-types.js';
import { cardCode } from '../record-types.js';
import {
  RecordDataset, shardPaths, writeManifestAtomic,
} from '../record-codec.js';
import { makeChain, makeManifest } from './record-fixtures.js';
import {
  attackerPointsAfterLead, attackerPointsBeforeTrick, attackerPointsRaw, declarerHandBeforeBury,
  dealtHands, getParsedHand, handAtDealIndex, initialBottom, iterateParsedHands, iterateShard,
  openingHands, parseHand, RecordParseError,
} from '../record-parse.js';

const SEED = deriveChainSeed('000000000000002a', 0);

const revealFirst: Strategy = {
  ...engineStrategy,
  name: 'reveal-first-parser',
  revealsOnlyWhenEffective: false,
  tryReveal: (hand, _dealt, _player, level) => {
    const opts = getRevealOptions(hand, level);
    return opts.length > 0 ? { suit: opts[0].suit, reason: 'parser test' } : null;
  },
};

interface Dataset {
  dir: string;
  records: HandRecord[];
}

async function makeDataset(hands: number, shardHands = 2): Promise<Dataset> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-parse-'));
  const records: HandRecord[] = [];
  const writer = new ChainWriter({
    runDir: dir, chainId: 0, chainSeedHex: SEED, shardHands, flushHands: 1,
  });
  const result = await runChain({
    chainId: 0,
    globalStart: 0,
    seedHex: SEED,
    mode: 'random',
    handsRequested: hands,
    strategies: [revealFirst, revealFirst],
    onRecord: (record, hash) => {
      records.push(record);
      writer.write(record, hash);
    },
  });
  writer.close();
  writeManifestAtomic(dir, makeManifest([
    makeChain({
      chainId: 0, globalStart: 0, handsRequested: hands,
      handsCompleted: result.handsCompleted, shards: writer.shards,
    }),
  ]));
  return { dir, records };
}

function metaOf(record: HandRecord) {
  return {
    chainId: 0,
    chainHandIndex: record.chainHandIndex,
    globalHandIndex: record.globalHandIndex,
    deckHash: deckHashFromCodes(record.deck),
  };
}

let fixture: Dataset;

beforeAll(async () => {
  fixture = await makeDataset(4);
}, 120_000);

describe('record parser: real records', () => {
  it('validates and reconstructs all four hands / tricks', () => {
    const parsed = [...iterateParsedHands(fixture.dir)];
    expect(parsed).toHaveLength(4);
    for (const hand of parsed) {
      expect(hand.deck).toHaveLength(108);
      expect(hand.bottom).toHaveLength(8);
      expect(hand.tricks.length).toBeGreaterThanOrEqual(1);
      expect(hand.tricks.length).toBeLessThanOrEqual(25);
      expect(hand.reveals.every(r => r.dealIndex >= 0 && r.dealIndex <= 99)).toBe(true);
      if (hand.reveals.length > 0) {
        expect(hand.reveals[hand.reveals.length - 1].suit).toBe(hand.trump.suit);
      }
      const opening = openingHands(hand);
      for (const h of opening) expect(h).toHaveLength(25);
      expect(dealtHands(hand.deck).every(h => h.length === 25)).toBe(true);
      expect(initialBottom(hand)).toHaveLength(8);
      expect(declarerHandBeforeBury(hand)).toHaveLength(33);
      for (const trick of hand.tricks) {
        expect(trick.plays).toHaveLength(4);
        for (let i = 0; i < 4; i++) expect(trick.plays[i].seat).toBe((trick.lead + i) % 4);
      }
      expect(attackerPointsRaw(hand)).toBe(
        hand.tricks.reduce((sum, t) =>
          t.winner % 2 !== hand.trump.declarer % 2 ? sum + t.points : sum, 0),
      );
      expect(attackerPointsBeforeTrick(hand, 0)).toBe(0);
      const leadDelta = hand.failedThrows
        .filter(f => f.trickIndex === 0)
        .reduce((sum, f) => sum + f.penaltyDelta, 0);
      expect(attackerPointsAfterLead(hand, 0)).toBe(leadDelta);
      expect(handAtDealIndex(hand, 0, 0).length).toBe(1);
    }
  });

  it('filters by .idx fields and predicate; getParsedHand parses one hand', () => {
    const base = fixture.records[0];
    const filtered = [...iterateParsedHands(fixture.dir, {
      filter: { level: base.level, declarer: base.declarer },
    })];
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.every(h => h.context.level === base.level && h.context.declarer === base.declarer)).toBe(true);

    const onlySecond = [...iterateParsedHands(fixture.dir, {
      predicate: h => h.meta.globalHandIndex === 1,
    })];
    expect(onlySecond).toHaveLength(1);
    expect(onlySecond[0].meta.globalHandIndex).toBe(1);

    const shard = [...iterateShard(fixture.dir, 0, 1)];
    expect(shard.length).toBeGreaterThanOrEqual(1);

    const dataset = RecordDataset.open(fixture.dir);
    const one = getParsedHand(dataset, 2);
    expect(one?.meta.globalHandIndex).toBe(2);
    expect(one?.raw).toBeUndefined();
    const raw = getParsedHand(dataset, 2, { includeRaw: true });
    expect(raw?.raw?.globalHandIndex).toBe(2);
    expect(getParsedHand(dataset, 999)).toBeNull();
    dataset.close();
  });

  it('reports RecordParseError with location for invalid records', () => {
    const record = fixture.records[0];
    const bad = { ...record, deck: [...record.deck] };
    bad.deck[1] = bad.deck[0];
    expect(() => parseHand(bad, metaOf(bad))).toThrow(RecordParseError);
    expect(() => parseHand(bad, metaOf(bad))).toThrow(/deck/);

    if (record.reveals.length > 0) {
      const badReveal = {
        ...record,
        reveals: [{ ...record.reveals[0], dealIndex: 100 }],
      };
      expect(() => parseHand(badReveal, metaOf(badReveal))).toThrow(/dealIndex/);
    }
  });

  it('rejects a running manifest unless allowRunning; accepts a truncated tail', () => {
    const runningDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-parse-running-'));
    fs.cpSync(fixture.dir, runningDir, { recursive: true });
    const manifestPath = path.join(runningDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { status: string };
    manifest.status = 'running';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => [...iterateParsedHands(runningDir)]).toThrow(/running/);
    expect([...iterateParsedHands(runningDir, { allowRunning: true })]).toHaveLength(4);

    const truncatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-parse-trunc-'));
    fs.cpSync(fixture.dir, truncatedDir, { recursive: true });
    const lastBin = shardPaths(truncatedDir, 0, 1).binPath;
    const bytes = fs.readFileSync(lastBin);
    fs.writeFileSync(lastBin, bytes.subarray(0, bytes.length - 7));
    const parsed = [...iterateParsedHands(truncatedDir)];
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed.length).toBeLessThanOrEqual(4);
  });
});

describe('record parser: structural failedThrows', () => {
  it('accepts a structurally valid failed-throw entry and exposes running points', () => {
    const base = fixture.records.find(r => r.throwPenalties[0] === 0 && r.throwPenalties[1] === 0)
      ?? fixture.records[0];
    const parsedBase = parseHand(base, metaOf(base));
    const trick = parsedBase.tricks[0];
    const player = trick.lead;
    const declarerTeam = parsedBase.trump.declarer % 2;
    const delta = player % 2 === declarerTeam ? 10 : -10;
    const codes = trick.plays[0].cards.map(cardCode);
    const changed: HandRecord = {
      ...base,
      failedThrows: [{ trickIndex: 0, player, penaltyDelta: delta, cards: codes }],
      attackerPoints: base.attackerPoints + delta,
      throwPenalties: player % 2 === declarerTeam ? [1, 0] : [0, 1],
    };
    const parsed = parseHand(changed, metaOf(changed));
    expect(parsed.failedThrows).toHaveLength(1);
    expect(attackerPointsRaw(parsed) + delta).toBe(parsed.settlement.attackerPoints);
    expect(parsed.failedThrows[0].penaltyDelta).toBe(delta);
  });
});
