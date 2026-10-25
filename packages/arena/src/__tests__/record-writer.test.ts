import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChainWriter } from '../record-writer.js';
import {
  decodeBinFooter, decodeBinHeader, decodeIdxFooter, RecordDataset,
  scanBinFile, shardPaths, writeManifestAtomic,
} from '../record-codec.js';
import { deckHashBigInt, deckHashFromCodes } from '../record-rng.js';
import { makeChain, makeManifest, makeRecord } from './record-fixtures.js';

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'poker-writer-'));
const SEED = '0123456789abcdef';

function writeHands(writer: ChainWriter, count: number, offset = 0): void {
  for (let i = 0; i < count; i++) {
    const chainHandIndex = offset + i;
    const record = makeRecord({
      globalHandIndex: chainHandIndex,
      chainHandIndex,
      blockIndex: Math.floor(chainHandIndex / 52),
      cellIndex: chainHandIndex % 52,
    });
    writer.write(record, deckHashBigInt(deckHashFromCodes(record.deck)));
  }
}

describe('ChainWriter', () => {
  it('按 shardHands 换分片；每片 header/footer/index 正确', () => {
    const runDir = tmpDir();
    const writer = new ChainWriter({
      runDir, chainId: 0, chainSeedHex: SEED, shardHands: 3, flushHands: 2,
    });
    writeHands(writer, 7);
    writer.close();
    expect(writer.handsWritten).toBe(7);
    expect(writer.shards.map(s => [s.path, s.startHand, s.count])).toEqual([
      ['chain-00/shard-000.bin', 0, 3],
      ['chain-00/shard-001.bin', 3, 3],
      ['chain-00/shard-002.bin', 6, 1],
    ]);

    const starts = [0, 3, 6];
    const counts = [3, 3, 1];
    for (let shard = 0; shard < 3; shard++) {
      const { binPath, idxPath } = shardPaths(runDir, 0, shard);
      const bin = fs.readFileSync(binPath);
      const header = decodeBinHeader(bin);
      expect(header.chainId).toBe(0);
      expect(header.shardIndex).toBe(shard);
      expect(header.startHandIndex).toBe(starts[shard]);
      expect(header.chainSeed).toBe(0x0123456789abcdefn);
      expect(decodeBinFooter(bin.subarray(bin.length - 12))).toEqual({ recordCount: counts[shard], crc32: 0 });

      const idx = fs.readFileSync(idxPath);
      expect(decodeIdxFooter(idx.subarray(idx.length - 12))).toEqual({ count: counts[shard], crc32: 0 });
      expect(writer.shards[shard].indexPath).toBe(`chain-00/shard-00${shard}.idx`);
    }
  });

  it('writer 产物可被 RecordDataset 逐手读回（分片边界手也对）', () => {
    const runDir = tmpDir();
    const writer = new ChainWriter({
      runDir, chainId: 0, chainSeedHex: SEED, shardHands: 3, flushHands: 1,
    });
    const source = [];
    for (let i = 0; i < 7; i++) {
      source.push(makeRecord({
        globalHandIndex: i, chainHandIndex: i,
        blockIndex: Math.floor(i / 52), cellIndex: i, level: 2 + (i % 13),
      }));
    }
    for (const record of source) writer.write(record, deckHashBigInt(deckHashFromCodes(record.deck)));
    writer.close();

    writeManifestAtomic(runDir, makeManifest([
      makeChain({ chainId: 0, globalStart: 0, handsRequested: 7, handsCompleted: 7, shards: writer.shards }),
    ]));
    const dataset = RecordDataset.open(runDir);
    for (let i = 0; i < 7; i++) {
      expect(dataset.getChainHand(0, i)).toEqual(source[i]);
      expect(dataset.getHand(i)).toEqual(source[i]);
    }
    expect(dataset.getHand(7)).toBeNull();
    expect(dataset.readIndex(0, 1)).toHaveLength(3);
    dataset.close();
  });

  it('flush 后未写 footer 的文件也能被长度前缀扫出已完成记录', () => {
    const runDir = tmpDir();
    const writer = new ChainWriter({
      runDir, chainId: 0, chainSeedHex: SEED, shardHands: 100, flushHands: 10,
    });
    writeHands(writer, 2);
    writer.flush();
    const { binPath } = shardPaths(runDir, 0, 0);
    const scanned = scanBinFile(fs.readFileSync(binPath));
    expect(scanned.recordCount).toBe(2);
    expect(scanned.entries.map(e => e.chainHandIndex)).toEqual([0, 1]);
    writer.close();
    expect(decodeBinFooter(fs.readFileSync(binPath).subarray(-12))).toEqual({ recordCount: 2, crc32: 0 });
  });

  it('空链 close 也留下合法的空分片', () => {
    const runDir = tmpDir();
    const writer = new ChainWriter({
      runDir, chainId: 3, chainSeedHex: SEED, shardHands: 5, flushHands: 5,
    });
    writer.close();
    expect(writer.shards).toEqual([{
      path: 'chain-03/shard-000.bin', startHand: 0, count: 0,
      indexPath: 'chain-03/shard-000.idx',
    }]);
    const { binPath, idxPath } = shardPaths(runDir, 3, 0);
    expect(decodeBinHeader(fs.readFileSync(binPath)).chainId).toBe(3);
    expect(decodeBinFooter(fs.readFileSync(binPath).subarray(-12))).toEqual({ recordCount: 0, crc32: 0 });
    expect(decodeIdxFooter(fs.readFileSync(idxPath).subarray(-12))).toEqual({ count: 0, crc32: 0 });
  });

  it('chainHandIndex 不连续时报错（防止静默错位）', () => {
    const runDir = tmpDir();
    const writer = new ChainWriter({
      runDir, chainId: 0, chainSeedHex: SEED, shardHands: 10, flushHands: 10,
    });
    const record = makeRecord({ chainHandIndex: 1, globalHandIndex: 1 });
    expect(() => writer.write(record, 1n)).toThrow(/不连续/);
    writer.close();
  });

  it('写入的 index entry offset 指向 recordLength，deckHash 与重算一致', () => {
    const runDir = tmpDir();
    const writer = new ChainWriter({
      runDir, chainId: 0, chainSeedHex: SEED, shardHands: 100, flushHands: 1,
    });
    const record = makeRecord({ chainHandIndex: 0, globalHandIndex: 0 });
    const hash = deckHashFromCodes(record.deck);
    writer.write(record, deckHashBigInt(hash));
    writer.close();
    writeManifestAtomic(runDir, makeManifest([
      makeChain({ chainId: 0, handsRequested: 1, handsCompleted: 1 }),
    ]));
    const dataset = RecordDataset.open(runDir);
    const entries = dataset.readIndex(0, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].offset).toBe(28n);
    expect(entries[0].deckHash).toBe(deckHashBigInt(hash));
    const bin = fs.readFileSync(shardPaths(runDir, 0, 0).binPath);
    const len = bin.readUInt32LE(Number(entries[0].offset));
    expect(Number(entries[0].offset) + 4 + len)
      .toBe(bin.length - 12); // 恰好到 footer 之前
    dataset.close();
  });
});
