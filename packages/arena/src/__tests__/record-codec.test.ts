import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BIN_HEADER_SIZE, FLAG_RULES, IDX_HEADER_SIZE, INDEX_ENTRY_SIZE, NT_TRUMP_CODE,
} from '../record-types.js';
import type { HandRecord, IndexEntry } from '../record-types.js';
import {
  chainDirName, decodeBinFooter, decodeBinHeader, decodeIdxHeader,
  decodeIndexEntryAt, decodeRecordPayload, encodeBinFooter, encodeBinHeader, encodeIdxFooter,
  encodeIdxHeader, encodeIndexEntry, encodeRecord, encodeRecordPayload, initialBottom,
  initialHands, parseIndexFile, readManifest, recordPayloadSize, RecordDataset, scanBinFile,
  shardPaths, writeManifestAtomic,
} from '../record-codec.js';
import { deckHashBigInt, deckHashFromCodes } from '../record-rng.js';
import { makeChain, makeManifest, makeRecord } from './record-fixtures.js';

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'poker-codec-'));

/** 手工写一个分片（不经过 ChainWriter），用于 reader 的独立验收。 */
function writeShard(runDir: string, chainId: number, shardIndex: number, records: HandRecord[]): {
  binPath: string;
  idxPath: string;
  entries: IndexEntry[];
} {
  const dir = path.join(runDir, chainDirName(chainId));
  fs.mkdirSync(dir, { recursive: true });
  const { binPath, idxPath } = shardPaths(runDir, chainId, shardIndex);
  const binParts: Buffer[] = [encodeBinHeader({
    formatVersion: 1, flags: 0, chainId, shardIndex,
    startHandIndex: records.length > 0 ? records[0].chainHandIndex : 0,
    chainSeed: 0x0123456789abcdefn,
  })];
  const idxParts: Buffer[] = [encodeIdxHeader({ formatVersion: 1, chainId, shardIndex })];
  const entries: IndexEntry[] = [];
  let offset = BIN_HEADER_SIZE;
  for (const record of records) {
    const bytes = encodeRecord(record);
    const entry: IndexEntry = {
      offset: BigInt(offset),
      deckHash: deckHashBigInt(deckHashFromCodes(record.deck)),
      chainHandIndex: record.chainHandIndex,
      blockIndex: record.blockIndex,
      cellIndex: record.cellIndex,
      level: record.level,
      declarer: record.declarer,
      trumpCode: record.trumpCode,
      flags: record.flags,
    };
    entries.push(entry);
    binParts.push(bytes);
    idxParts.push(encodeIndexEntry(entry));
    offset += bytes.length;
  }
  binParts.push(encodeBinFooter(records.length));
  idxParts.push(encodeIdxFooter(records.length));
  fs.writeFileSync(binPath, Buffer.concat(binParts));
  fs.writeFileSync(idxPath, Buffer.concat(idxParts));
  return { binPath, idxPath, entries };
}

describe('record encode/decode', () => {
  it('payload 大小 = 164 + 2×reveals + tricks + failedThrows，整条 = 4 + payload', () => {
    const record = makeRecord();
    expect(recordPayloadSize(record)).toBe(164 + 2 * 2 + (8 + 4) + (8 + 8));
    expect(encodeRecordPayload(record)).toHaveLength(recordPayloadSize(record));
    expect(encodeRecord(record)).toHaveLength(4 + recordPayloadSize(record));

    const withThrow = makeRecord({
      failedThrows: [
        { trickIndex: 0, player: 1, penaltyDelta: 10, cards: [10, 11] },
        { trickIndex: 4, player: 2, penaltyDelta: 0, cards: [0, 1, 2] },
      ],
    });
    expect(recordPayloadSize(withThrow)).toBe(recordPayloadSize(record) + (4 + 2) + (4 + 3));
    expect(decodeRecordPayload(encodeRecordPayload(withThrow))).toEqual(withThrow);
  });

  it('每个字段 round-trip（含负数原始分、NT、无主亮主、多墩）', () => {
    const record = makeRecord({
      globalHandIndex: 123456,
      chainHandIndex: 7,
      blockIndex: 19,
      cellIndex: 51,
      level: 14,
      declarer: 3,
      attackerLevel: 0,
      trumpCode: NT_TRUMP_CODE,
      flags: 0x3f,
      lapA: 4,
      lapB: 9,
      levelAfterA: 12,
      levelAfterB: 2,
      nextDeclarer: 0,
      attackerPoints: -30,
      finalPts: 120,
      bottomPoints: 80,
      bottomMultiplier: 32,
      kouDiAdd: 2560,
      throwPenalties: [3, 1],
    });
    const decoded = decodeRecordPayload(encodeRecordPayload(record));
    expect(decoded).toEqual(record);
  });

  it('空 reveals / 空 tricks / 空 failedThrows 的边界记录', () => {
    const record = makeRecord({ reveals: [], tricks: [], failedThrows: [] });
    expect(recordPayloadSize(record)).toBe(164);
    expect(decodeRecordPayload(encodeRecordPayload(record))).toEqual(record);
  });

  it('reveal dealIndex 0/99 与 failedThrow delta 0/±10 round-trip', () => {
    const record = makeRecord({
      reveals: [
        { player: 0, suit: 0, strength: 1, dealIndex: 0 },
        { player: 3, suit: null, strength: 4, dealIndex: 99 },
      ],
      failedThrows: [
        { trickIndex: 0, player: 0, penaltyDelta: -10, cards: [0] },
        { trickIndex: 1, player: 1, penaltyDelta: 0, cards: [1, 2] },
        { trickIndex: 2, player: 2, penaltyDelta: 10, cards: [3, 4, 5] },
      ],
    });
    expect(decodeRecordPayload(encodeRecordPayload(record))).toEqual(record);
    expect(() => encodeRecordPayload(makeRecord({
      reveals: [{ player: 0, suit: 0, strength: 1, dealIndex: 100 }],
    }))).toThrow(/dealIndex/);
  });

  it('截断 payload 报错（不会静默读出垃圾）', () => {
    const bytes = encodeRecordPayload(makeRecord());
    expect(() => decodeRecordPayload(bytes.subarray(0, bytes.length - 3))).toThrow(/截断/);
  });

  it('bin header / footer round-trip', () => {
    const header = encodeBinHeader({
      formatVersion: 1, flags: 0, chainId: 7, shardIndex: 3,
      startHandIndex: 150000, chainSeed: 0xdeadbeefcafef00dn,
    });
    expect(header).toHaveLength(BIN_HEADER_SIZE);
    expect(decodeBinHeader(header)).toEqual({
      formatVersion: 1, flags: 0, chainId: 7, shardIndex: 3,
      startHandIndex: 150000, chainSeed: 0xdeadbeefcafef00dn,
    });
    const footer = encodeBinFooter(1234);
    expect(decodeBinFooter(footer)).toEqual({ recordCount: 1234, crc32: 0 });
    expect(decodeBinFooter(Buffer.from('nope'))).toBeNull();
  });

  it('idx header / entry / footer round-trip（bigint 字段保真）', () => {
    const header = encodeIdxHeader({ formatVersion: 1, chainId: 2, shardIndex: 5 });
    expect(header).toHaveLength(IDX_HEADER_SIZE);
    expect(decodeIdxHeader(header)).toEqual({ formatVersion: 1, chainId: 2, shardIndex: 5 });

    const entry: IndexEntry = {
      offset: 0xfffffffffffff000n,
      deckHash: 0xfedcba9876543210n,
      chainHandIndex: 49999,
      blockIndex: 961,
      cellIndex: 51,
      level: 14,
      declarer: 3,
      trumpCode: NT_TRUMP_CODE,
      flags: 0x2a,
    };
    const bytes = encodeIndexEntry(entry);
    expect(bytes).toHaveLength(INDEX_ENTRY_SIZE);
    expect(decodeIndexEntryAt(bytes, 0)).toEqual(entry);
  });
});

describe('扫描 / 重建', () => {
  it('scanBinFile 读两条记录后停在 footer；截断的第三条不计入', () => {
    const r0 = makeRecord({ chainHandIndex: 0, globalHandIndex: 0 });
    const r1 = makeRecord({ chainHandIndex: 1, globalHandIndex: 1, blockIndex: 1 });
    const r2 = makeRecord({ chainHandIndex: 2, globalHandIndex: 2 });
    const header = encodeBinHeader({
      formatVersion: 1, flags: 0, chainId: 0, shardIndex: 0,
      startHandIndex: 0, chainSeed: 1n,
    });
    const b0 = encodeRecord(r0);
    const b1 = encodeRecord(r1);
    const b2 = encodeRecord(r2);
    const complete = Buffer.concat([header, b0, b1, b2, encodeBinFooter(3)]);
    const scanned = scanBinFile(complete);
    expect(scanned.recordCount).toBe(3);
    expect(scanned.entries.map(e => e.chainHandIndex)).toEqual([0, 1, 2]);
    expect(scanned.entries[0].offset).toBe(BigInt(BIN_HEADER_SIZE));
    expect(scanned.entries[1].offset).toBe(BigInt(BIN_HEADER_SIZE + b0.length));
    expect(scanned.entries[0].deckHash).toBe(deckHashBigInt(deckHashFromCodes(r0.deck)));

    // 第三条只写了一半（模拟硬杀）
    const truncated = Buffer.concat([header, b0, b1, b2.subarray(0, 17)]);
    const rebuilt = scanBinFile(truncated);
    expect(rebuilt.recordCount).toBe(2);
    expect(rebuilt.entries.map(e => e.chainHandIndex)).toEqual([0, 1]);
  });

  it('parseIndexFile 无 footer 或 count 不一致时抛错（交给 .bin 重建）', () => {
    const entry: IndexEntry = {
      offset: 28n, deckHash: 1n, chainHandIndex: 0,
      blockIndex: 0, cellIndex: 0, level: 2, declarer: 0, trumpCode: 0, flags: 1,
    };
    const head = encodeIdxHeader({ formatVersion: 1, chainId: 0, shardIndex: 0 });
    const body = encodeIndexEntry(entry);
    const footer = encodeIdxFooter(1);
    const good = Buffer.concat([head, body, footer]);
    expect(parseIndexFile(good, 0, 0)).toEqual([entry]);
    expect(() => parseIndexFile(Buffer.concat([head, body]), 0, 0)).toThrow(/footer/);
    expect(() => parseIndexFile(Buffer.concat([head, body, encodeIdxFooter(2)]), 0, 0))
      .toThrow(/count/);
    expect(() => parseIndexFile(good, 1, 0)).toThrow(/header/);
  });
});

describe('由记录反推开局手牌', () => {
  it('庄家拿回初始底牌再扣掉最终底牌，四家各 25 张', () => {
    const deck = Array.from({ length: 108 }, (_, i) => i);
    // declarer=2 扣掉的全是初始底牌：手牌与发牌一致
    const record = makeRecord({ deck, declarer: 2, bottom: deck.slice(100, 108) });
    const hands = initialHands(record);
    expect(initialBottom(record)).toEqual(deck.slice(100, 108));
    expect(hands[2]).toEqual(deck.slice(2, 100).filter((_, i) => i % 4 === 0));
    expect(hands[0]).toEqual(deck.slice(0, 100).filter((_, i) => i % 4 === 0));
    for (const hand of hands) expect(hand).toHaveLength(25);
    expect(hands.flat().sort((a, b) => a - b)).toEqual(deck.slice(0, 100));

    // 扣掉手牌里的牌 + 一张底牌：仍是 25 张，且不含最终底牌
    const bottom = [deck[0], ...deck.slice(101, 108)];
    const record2 = makeRecord({ deck, declarer: 0, bottom });
    const hands2 = initialHands(record2);
    expect(hands2[0]).toHaveLength(25);
    expect(hands2[0]).not.toContain(deck[0]);
    expect(hands2[0]).toContain(deck[100]);
    expect(hands2[1]).toEqual(deck.slice(1, 100).filter((_, i) => i % 4 === 0));
  });
});

describe('dataset reader', () => {
  it('按全局 / 链内 index 随机访问；缺 .idx 或截断时从 .bin 重建', () => {
    const runDir = tmpDir();
    const c0r0 = makeRecord({ globalHandIndex: 0, chainHandIndex: 0, blockIndex: 0, cellIndex: 3 });
    const c0r1 = makeRecord({ globalHandIndex: 1, chainHandIndex: 1, blockIndex: 0, cellIndex: 9 });
    const c1r0 = makeRecord({ globalHandIndex: 2, chainHandIndex: 0, blockIndex: 0, cellIndex: 4 });
    const s0 = writeShard(runDir, 0, 0, [c0r0, c0r1]);
    const s1 = writeShard(runDir, 1, 0, [c1r0]);

    writeManifestAtomic(runDir, makeManifest([
      makeChain({ chainId: 0, globalStart: 0, handsRequested: 2, handsCompleted: 2 }),
      makeChain({ chainId: 1, globalStart: 2, handsRequested: 1, handsCompleted: 1 }),
    ]));

    const dataset = RecordDataset.open(runDir);
    expect(dataset.chainHandCount(0)).toBe(2);
    expect(dataset.getHand(0)).toEqual(c0r0);
    expect(dataset.getHand(1)).toEqual(c0r1);
    expect(dataset.getHand(2)).toEqual(c1r0);
    expect(dataset.getHand(3)).toBeNull();
    expect(dataset.getChainHand(0, 1)).toEqual(c0r1);
    expect(dataset.getChainHand(0, 2)).toBeNull();

    const idx = dataset.readIndex(0, 0);
    expect(idx).toEqual(s0.entries);
    expect(idx[0].deckHash).toBe(deckHashBigInt(deckHashFromCodes(c0r0.deck)));

    // 删掉链 1 的 .idx：reader 扫描 .bin 重建
    fs.rmSync(s1.idxPath);
    dataset.close();
    const rebuilt = RecordDataset.open(runDir);
    expect(rebuilt.readIndex(1, 0)).toEqual(s1.entries);
    expect(rebuilt.getHand(2)).toEqual(c1r0);

    // 截断链 0 的 .idx（去掉 footer 与半个 entry）：同样以 .bin 为准
    const idxBytes = fs.readFileSync(s0.idxPath);
    fs.writeFileSync(s0.idxPath, idxBytes.subarray(0, idxBytes.length - 20));
    rebuilt.close();
    const third = RecordDataset.open(runDir);
    expect(third.readIndex(0, 0)).toEqual(s0.entries);
    expect(third.getHand(1)).toEqual(c0r1);
    third.close();
  });

  it('manifest 原子写 / 读 round-trip，版本不符报错', () => {
    const runDir = tmpDir();
    const manifest = makeManifest([makeChain({ chainId: 0, handsRequested: 5, handsCompleted: 5 })]);
    writeManifestAtomic(runDir, manifest);
    expect(readManifest(runDir)).toEqual(manifest);
    expect(fs.readdirSync(runDir).filter(n => n.startsWith('.manifest'))).toEqual([]);

    const bad = { ...manifest, formatVersion: 99 };
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(bad));
    expect(() => readManifest(runDir)).toThrow(/formatVersion/);
  });

  it('rules 模式记录（hasAttackerLevel/hasLap = false 以外的位）也能读回', () => {
    const runDir = tmpDir();
    const record = makeRecord({ flags: FLAG_RULES | 0x0c, blockIndex: 0, cellIndex: 0 });
    writeShard(runDir, 0, 0, [record]);
    writeManifestAtomic(runDir, makeManifest([
      makeChain({ chainId: 0, handsRequested: 1, handsCompleted: 1 }),
    ]));
    const dataset = RecordDataset.open(runDir);
    expect(dataset.getHand(0)).toEqual(record);
    dataset.close();
  });
});
