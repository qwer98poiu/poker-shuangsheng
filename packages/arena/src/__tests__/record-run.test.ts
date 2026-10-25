import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { playHand } from '../match.js';
import { engineStrategy } from '../strategies.js';
import {
  advanceRules, initialRulesState, RandomScheduler, runChain, writeErrorReport,
} from '../record-run.js';
import type { ChainRunResult, RulesState } from '../record-run.js';
import type { HandRecord } from '../record-types.js';
import {
  FLAG_BANKER_WON, FLAG_HAS_ATTACKER_LEVEL, FLAG_HAS_LAP, FLAG_RANDOM, FLAG_RULES,
  NT_TRUMP_CODE,
} from '../record-types.js';
import { deriveChainSeed, deriveStreamSeed, drawDeck, rngFromSeedHex } from '../record-rng.js';

const BASE = '000000000000002a';
const CHAIN0 = deriveChainSeed(BASE, 0);
const CHAIN1 = deriveChainSeed(BASE, 1);

function contextScheduler(chainSeedHex: string, chainId = 0): RandomScheduler {
  return new RandomScheduler(rngFromSeedHex(deriveStreamSeed(chainSeedHex, chainId, 'context')));
}

describe('random 分层调度', () => {
  it('52 个 cell 恰好一次；104 手 = 两个完整块', () => {
    const scheduler = contextScheduler(CHAIN0);
    const block0 = Array.from({ length: 52 }, () => scheduler.next());
    expect(block0.every(s => s.blockIndex === 0)).toBe(true);
    const cells0 = block0.map(s => s.cellIndex).sort((a, b) => a - b);
    expect(cells0).toEqual(Array.from({ length: 52 }, (_, i) => i));

    const block1 = Array.from({ length: 52 }, () => scheduler.next());
    expect(block1.every(s => s.blockIndex === 1)).toBe(true);
    const cells1 = block1.map(s => s.cellIndex).sort((a, b) => a - b);
    expect(cells1).toEqual(Array.from({ length: 52 }, (_, i) => i));
    // 块与块之间顺序不同（不是固定周期）
    expect(block1.map(s => s.cellIndex)).not.toEqual(block0.map(s => s.cellIndex));
  });

  it('1000 手 = 19 完整块 + 12 手余数，余数无重复', () => {
    const scheduler = contextScheduler(CHAIN0);
    const slots = Array.from({ length: 1000 }, () => scheduler.next());
    const counts = new Map<number, number>();
    for (const s of slots) counts.set(s.blockIndex, (counts.get(s.blockIndex) ?? 0) + 1);
    for (let b = 0; b < 19; b++) expect(counts.get(b)).toBe(52);
    expect(counts.get(19)).toBe(12);
    expect(counts.size).toBe(20);

    const remainder = slots.filter(s => s.blockIndex === 19).map(s => s.cellIndex);
    expect(new Set(remainder).size).toBe(12);
    for (const cell of remainder) expect(cell).toBeGreaterThanOrEqual(0);
  });

  it('不同链（同 base seed）schedule 不同；同 chain seed 可复现', () => {
    const a = contextScheduler(CHAIN0);
    const b = contextScheduler(CHAIN0);
    const c = contextScheduler(CHAIN1, 1);
    const av = Array.from({ length: 52 }, () => a.next().cellIndex);
    const bv = Array.from({ length: 52 }, () => b.next().cellIndex);
    const cv = Array.from({ length: 52 }, () => c.next().cellIndex);
    expect(av).toEqual(bv);
    expect(av).not.toEqual(cv);
  });

});

describe('rules 等级循环（无必打）', () => {
  const advance = (state: RulesState, finalPts: number) => advanceRules(state, finalPts);

  it('K + 2 → 2（lap+1）；K + 3 → 3；Q + 3 → 2', () => {
    const k = advance({ levels: [13, 5], laps: [0, 2], declarerIdx: 0 }, 5);
    expect(k.attackerSits).toBe(false);
    expect(k.delta).toBe(2);
    expect(k.state.levels).toEqual([2, 5]);
    expect(k.state.laps).toEqual([1, 2]);
    expect(k.nextDeclarer).toBe(2);

    const k3 = advance({ levels: [13, 5], laps: [0, 0], declarerIdx: 0 }, 0);
    expect(k3.delta).toBe(3);
    expect(k3.state.levels).toEqual([3, 5]);
    expect(k3.state.laps).toEqual([1, 0]);

    const q = advance({ levels: [12, 5], laps: [0, 0], declarerIdx: 0 }, 0);
    expect(q.state.levels).toEqual([2, 5]);
    expect(q.state.laps).toEqual([1, 0]);
  });

  it('闲家在 A 上台：delta 0 停在 A；delta 1 回绕到 2（lap+1）', () => {
    const hold = advance({ levels: [14, 14], laps: [0, 0], declarerIdx: 0 }, 80);
    expect(hold.attackerSits).toBe(true);
    expect(hold.delta).toBe(0);
    expect(hold.state.levels).toEqual([14, 14]);
    expect(hold.state.laps).toEqual([0, 0]);
    expect(hold.nextDeclarer).toBe(1);

    const wrap = advance({ levels: [14, 14], laps: [0, 0], declarerIdx: 0 }, 120);
    expect(wrap.delta).toBe(1);
    expect(wrap.state.levels).toEqual([14, 2]);
    expect(wrap.state.laps).toEqual([0, 1]);
  });

  it('庄家赢 → 同队对家；闲家上台 → 下家', () => {
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 1 }, 40).nextDeclarer).toBe(3);
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 3 }, 40).nextDeclarer).toBe(1);
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 3 }, 80).nextDeclarer).toBe(0);
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 1 }, 80).nextDeclarer).toBe(2);
    // 升级方是 Teams：庄家在 0 保庄 → 0 队；闲家上台 → 1 队
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 0 }, 40).state.levels).toEqual([6, 5]);
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 0 }, 80).state.levels).toEqual([5, 5]);
    expect(advance({ levels: [5, 5], laps: [0, 0], declarerIdx: 0 }, 120).state.levels).toEqual([5, 6]);
  });

  it('等级始终留在 2..14，圈数单调不减', () => {
    for (const declarerIdx of [0, 1, 2, 3]) {
      for (const lo of [2, 12, 13, 14]) {
        for (const hi of [2, 12, 13, 14]) {
          for (const pts of [0, 5, 40, 80, 119, 120, 200]) {
            const out = advanceRules({ levels: [lo, hi], laps: [0, 0], declarerIdx }, pts);
            for (const level of out.state.levels) {
              expect(level).toBeGreaterThanOrEqual(2);
              expect(level).toBeLessThanOrEqual(14);
            }
            for (const lap of out.state.laps) expect(lap).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });
});

describe('runChain：随机模式', () => {
  it('52 手一个完整块：每个 cell 恰一次，记录字段自洽', async () => {
    const records: HandRecord[] = [];
    const progress: number[] = [];
    const result = await runChain({
      chainId: 0,
      globalStart: 0,
      seedHex: CHAIN0,
      mode: 'random',
      handsRequested: 52,
      strategies: [engineStrategy, engineStrategy],
      onRecord: r => records.push(r),
      onProgress: done => progress.push(done),
    });
    expect(result.status).toBe('completed');
    expect(result.handsCompleted).toBe(52);
    expect(result.error).toBeUndefined();
    expect(progress[progress.length - 1]).toBe(52);
    expect(records).toHaveLength(52);

    expect(records.every(r => r.blockIndex === 0)).toBe(true);
    expect(records.map(r => r.cellIndex).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 52 }, (_, i) => i));

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      expect(r.globalHandIndex).toBe(i);
      expect(r.chainHandIndex).toBe(i);
      expect(r.level).toBe(2 + Math.floor(r.cellIndex / 4));
      expect(r.level).toBeGreaterThanOrEqual(2);
      expect(r.level).toBeLessThanOrEqual(14);
      expect(r.declarer).toBe(r.cellIndex % 4);
      expect(r.attackerLevel).toBe(0);
      expect(r.nextDeclarer).toBe(255);
      expect(r.levelAfterA).toBe(0);
      expect(r.lapA).toBe(0);
      expect((r.flags & FLAG_RANDOM) !== 0).toBe(true);
      expect((r.flags & FLAG_RULES) !== 0).toBe(false);
      expect((r.flags & FLAG_HAS_ATTACKER_LEVEL) !== 0).toBe(false);
      expect((r.flags & FLAG_HAS_LAP) !== 0).toBe(false);
      expect(r.deck).toHaveLength(108);
      expect(new Set(r.deck).size).toBe(108);
      expect(r.bottom).toHaveLength(8);
      expect(new Set(r.bottom).size).toBe(8);
      for (const code of r.bottom) expect(r.deck).toContain(code);
      expect(r.tricks.length).toBeGreaterThanOrEqual(1);
      expect(r.tricks.length).toBeLessThanOrEqual(25);
      for (const trick of r.tricks) {
        expect(trick.cards).toHaveLength(
          trick.counts[0] + trick.counts[1] + trick.counts[2] + trick.counts[3],
        );
      }
      expect(Array.isArray(r.failedThrows)).toBe(true);
      let prevDeal = -1;
      for (const rev of r.reveals) {
        expect(rev.dealIndex).toBeGreaterThanOrEqual(0);
        expect(rev.dealIndex).toBeLessThanOrEqual(99);
        expect(rev.dealIndex).toBeGreaterThanOrEqual(prevDeal);
        prevDeal = rev.dealIndex;
        expect(rev.player).toBeGreaterThanOrEqual(0);
        expect(rev.player).toBeLessThanOrEqual(3);
        expect(rev.strength).toBeGreaterThanOrEqual(1);
        expect(rev.strength).toBeLessThanOrEqual(4);
      }
      if (r.reveals.length > 0) {
        const last = r.reveals[r.reveals.length - 1];
        expect(last.suit).toBe(r.trumpCode === NT_TRUMP_CODE ? null : r.trumpCode);
      }
      for (const f of r.failedThrows) {
        expect(f.trickIndex).toBeGreaterThanOrEqual(0);
        expect(f.trickIndex).toBeLessThan(r.tricks.length);
        expect([-10, 0, 10]).toContain(f.penaltyDelta);
        expect(r.tricks[f.trickIndex].lead).toBe(f.player);
      }
      expect(r.finalPts).toBeGreaterThanOrEqual(0);
      expect((r.flags & FLAG_BANKER_WON) !== 0).toBe(r.finalPts < 80);
      expect(r.kouDiAdd).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('runChain：rules 模式', () => {
  it('首局 P0/双方 2 级；每手等级与庄家按 advanceRules 衔接', async () => {
    const records: HandRecord[] = [];
    const result = await runChain({
      chainId: 0,
      globalStart: 0,
      seedHex: CHAIN0,
      mode: 'rules',
      handsRequested: 24,
      strategies: [engineStrategy, engineStrategy],
      onRecord: r => records.push(r),
    });
    expect(result.status).toBe('completed');
    expect(result.error).toBeUndefined();
    expect(records).toHaveLength(24);

    expect(records[0].level).toBe(2);
    expect(records[0].declarer).toBe(0);
    expect(records[0].blockIndex).toBe(0);
    expect(records[0].cellIndex).toBe(0);

    let state: RulesState = initialRulesState();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      expect(r.declarer).toBe(state.declarerIdx);
      expect(r.level).toBe(state.levels[r.declarer % 2]);
      expect(r.attackerLevel).toBe(state.levels[1 - (r.declarer % 2)]);
      expect((r.flags & FLAG_RULES) !== 0).toBe(true);
      expect((r.flags & FLAG_HAS_ATTACKER_LEVEL) !== 0).toBe(true);
      expect((r.flags & FLAG_HAS_LAP) !== 0).toBe(true);

      const adv = advanceRules(state, r.finalPts);
      expect(r.levelAfterA).toBe(adv.state.levels[0]);
      expect(r.levelAfterB).toBe(adv.state.levels[1]);
      expect(r.lapA).toBe(adv.state.laps[0]);
      expect(r.lapB).toBe(adv.state.laps[1]);
      expect(r.nextDeclarer).toBe(adv.nextDeclarer);
      state = adv.state;

      if (i + 1 < records.length) {
        expect(records[i + 1].declarer).toBe(adv.nextDeclarer);
        expect(records[i + 1].level).toBe(adv.state.levels[adv.nextDeclarer % 2]);
      }
    }
  });
});

describe('runChain：不去重 / 停止 / 错误', () => {
  const deckA = drawDeck(rngFromSeedHex('11'.repeat(32)));
  const deckB = drawDeck(rngFromSeedHex('22'.repeat(32)));

  it('重复 deck 直接保留：每手消费一次流，不重抽、不占额外 index', async () => {
    const records: HandRecord[] = [];
    const sequence = [deckA, deckA, deckB];
    let cursor = 0;
    const result = await runChain({
      chainId: 0,
      globalStart: 40,
      seedHex: CHAIN0,
      mode: 'random',
      handsRequested: 2,
      strategies: [engineStrategy, engineStrategy],
      onRecord: r => records.push(r),
      deps: { drawDeck: () => sequence[cursor++] },
    });
    expect(result.status).toBe('completed');
    expect(result.handsCompleted).toBe(2);
    expect(records.map(r => r.chainHandIndex)).toEqual([0, 1]);
    expect(records.map(r => r.globalHandIndex)).toEqual([40, 41]);
    expect(records[0].deck).toEqual(records[1].deck);

    const expected = contextScheduler(CHAIN0);
    expect(records.map(r => r.cellIndex))
      .toEqual([expected.next().cellIndex, expected.next().cellIndex]);
  });

  it('shouldStop 在第一手后生效：status stopped，已完成记录保留', async () => {
    let checks = 0;
    const records: HandRecord[] = [];
    const result = await runChain({
      chainId: 0,
      globalStart: 0,
      seedHex: CHAIN0,
      mode: 'random',
      handsRequested: 5,
      strategies: [engineStrategy, engineStrategy],
      onRecord: r => records.push(r),
      shouldStop: () => checks++ > 0,
    });
    expect(result.status).toBe('stopped');
    expect(result.handsCompleted).toBe(1);
    expect(records).toHaveLength(1);
  });

  it('ev.aborted → 停止，kind=abort，错误信息带 deck/state', async () => {
    const result = await runChain({
      chainId: 3,
      globalStart: 9,
      seedHex: CHAIN0,
      mode: 'random',
      handsRequested: 1,
      strategies: [engineStrategy, engineStrategy],
      onRecord: () => { throw new Error('不应写入中止手'); },
      deps: {
        play: (opts) => {
          const ev = playHand(opts);
          return { ...ev, aborted: true, abortPlayerIdx: 2, settled: false };
        },
      },
    });
    expect(result.status).toBe('error');
    expect(result.handsCompleted).toBe(0);
    expect(result.error?.kind).toBe('abort');
    expect(result.error?.chainHandIndex).toBe(0);
    expect(result.error?.globalHandIndex).toBe(9);
    expect(result.error?.deck).toHaveLength(108);
    expect(result.error?.event?.aborted).toBe(true);
    expect(result.error?.state).not.toBeNull();
  });

  it('ev.errors > 0 → kind=strategy-error；策略抛异常 → kind=exception', async () => {
    const errored = await runChain({
      chainId: 0, globalStart: 0, seedHex: CHAIN0, mode: 'random', handsRequested: 1,
      strategies: [engineStrategy, engineStrategy],
      onRecord: () => { throw new Error('不应写入'); },
      deps: {
        play: (opts) => ({ ...playHand(opts), errors: 1 }),
      },
    });
    expect(errored.status).toBe('error');
    expect(errored.error?.kind).toBe('strategy-error');
    expect(errored.error?.message).toMatch(/errors=1/);

    const thrown = await runChain({
      chainId: 0, globalStart: 0, seedHex: CHAIN0, mode: 'random', handsRequested: 1,
      strategies: [engineStrategy, engineStrategy],
      onRecord: () => { /* unreachable */ },
      deps: {
        play: () => { throw new Error('boom'); },
      },
    });
    expect(thrown.status).toBe('error');
    expect(thrown.error?.kind).toBe('exception');
    expect(thrown.error?.message).toBe('boom');
    expect(thrown.error?.stack).toContain('boom');
    expect(thrown.error?.event).toBeNull();
    expect(thrown.error?.state).toBeNull();
    expect(thrown.error?.deck).toHaveLength(108);
  });

  it('writeErrorReport：JSON 字段齐全、state 为 serialize 字符串；exception 时 state=null', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-run-'));
    const errorRun: ChainRunResult = await runChain({
      chainId: 1, globalStart: 100, seedHex: CHAIN1, mode: 'rules', handsRequested: 1,
      strategies: [engineStrategy, engineStrategy],
      onRecord: () => { throw new Error('不应写入'); },
      deps: { play: () => { throw new Error('boom'); } },
    });
    if (!errorRun.error) throw new Error('测试预期出错');
    const rel = writeErrorReport(runDir, errorRun.error);
    expect(rel).toBe('errors/chain-01-hand-000000.json');
    const body = JSON.parse(fs.readFileSync(path.join(runDir, rel), 'utf8')) as {
      kind: string; chainId: number; globalHandIndex: number; chainHandIndex: number;
      seed: string; strategies: { A: string; B: string }; context: { mode: string };
      deck: string[]; event: unknown; state: unknown; error: { message: string };
    };
    expect(body.kind).toBe('exception');
    expect(body.chainId).toBe(1);
    expect(body.globalHandIndex).toBe(100);
    expect(body.chainHandIndex).toBe(0);
    expect(body.seed).toBe(CHAIN1);
    expect(body.strategies).toEqual({ A: 'ai', B: 'ai' });
    expect(body.context.mode).toBe('rules');
    expect(body.deck).toHaveLength(108);
    expect(body.event).toBeNull();
    expect(body.state).toBeNull();
    expect(body.error.message).toBe('boom');

    // 正常手（未中止）的 state 是完整 JSON 字符串
    const abortRun = await runChain({
      chainId: 0, globalStart: 0, seedHex: CHAIN0, mode: 'random', handsRequested: 1,
      strategies: [engineStrategy, engineStrategy],
      onRecord: () => { throw new Error('不应写入'); },
      deps: {
        play: (opts) => ({ ...playHand(opts), aborted: true, abortPlayerIdx: 0 }),
      },
    });
    if (!abortRun.error) throw new Error('测试预期中止');
    const rel2 = writeErrorReport(runDir, abortRun.error);
    const body2 = JSON.parse(fs.readFileSync(path.join(runDir, rel2), 'utf8')) as { state: string };
    expect(typeof body2.state).toBe('string');
    expect(JSON.parse(body2.state)).toHaveProperty('trickHistory');
  });
});
