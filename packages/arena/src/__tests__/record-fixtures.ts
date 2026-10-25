/** 录制数据集测试夹具：构造字段齐全的 HandRecord，避免每个测试重复 100+ 行。 */
import { FLAG_RANDOM } from '../record-types.js';
import type { HandRecord, Manifest, ManifestChain } from '../record-types.js';

/** 一副 108 张、code 恰为 0..107 的合法 deck（升序，便于断言）。 */
export function orderedDeck(): number[] {
  return Array.from({ length: 108 }, (_, i) => i);
}

export function makeRecord(overrides: Partial<HandRecord> = {}): HandRecord {
  const deck = overrides.deck ?? orderedDeck();
  return {
    globalHandIndex: 0,
    chainHandIndex: 0,
    blockIndex: 0,
    cellIndex: 0,
    level: 7,
    declarer: 1,
    attackerLevel: 0,
    trumpCode: 1,
    flags: FLAG_RANDOM,
    lapA: 0,
    lapB: 0,
    levelAfterA: 0,
    levelAfterB: 0,
    nextDeclarer: 255,
    deck,
    bottom: deck.slice(100, 108),
    reveals: [
      { player: 0, suit: 2, strength: 1, dealIndex: 13 },
      { player: 1, suit: null, strength: 4, dealIndex: 42 },
    ],
    failedThrows: [],
    tricks: [
      { lead: 1, counts: [1, 1, 1, 1], cards: [10, 11, 12, 13], winner: 1, points: 0 },
      { lead: 2, counts: [2, 2, 2, 2], cards: [0, 1, 2, 3, 4, 5, 6, 7], winner: 2, points: 15 },
    ],
    attackerPoints: -10,
    finalPts: 85,
    bottomPoints: 25,
    bottomMultiplier: 4,
    kouDiAdd: 100,
    throwPenalties: [1, 2],
    ...overrides,
  };
}

export function makeChain(overrides: Partial<ManifestChain> = {}): ManifestChain {
  return {
    chainId: 0,
    seed: '0123456789abcdef',
    globalStart: 0,
    handsRequested: 0,
    handsCompleted: 0,
    status: 'completed',
    shards: [],
    ...overrides,
  };
}

export function makeManifest(chains: ManifestChain[]): Manifest {
  return {
    formatVersion: 1,
    rulesVersion: 'endless-v1',
    status: 'completed',
    contextMode: 'random',
    seed: { base: '000000000000002a', source: 'cli', algorithm: 'sha256-64-v1' },
    strategies: { A: 'ai', B: 'ai' },
    handsRequested: chains.reduce((s, c) => s + c.handsRequested, 0),
    handsCompleted: chains.reduce((s, c) => s + c.handsCompleted, 0),
    workers: chains.length,
    shardHands: 50000,
    flushHands: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    revision: null,
    dirty: false,
    node: 'v17.5.0',
    command: ['record'],
    chains,
    error: null,
  };
}
