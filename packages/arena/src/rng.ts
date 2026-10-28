/**
 * Deterministic deck derivation for the arena.
 *
 * 与记录器（record-rng.ts）同一口径：64 位 base seed + sfc32 顺序流。
 * 一个对决（pair）对应记录器的一条链（chainId = pairIndex）：
 *
 *   chainSeed = sha256("record-v1|chain|<baseSeedHex>|<pairIndex>")[0,16)
 *   deckSeed  = sha256("record-v1|deck|<chainSeed>|<pairIndex>")
 *   deck_i    = chain 的 deck 流第 i 次 drawDeck()
 *
 * 因此同一 base seed、同一 pairIndex、同一 handIndex 得到的 deck 与记录器
 * 完全一致；镜像对决的两场各自从链起点重建流，第 i 手仍是同一副牌。
 *
 * seed 规范形式为 `0x` 前缀的 64 位十六进制（`normalizeSeed`）；派生时用
 * 去掉前缀的 16 位十六进制，与记录器 manifest 的 `seed.base` 相同。
 */
import type { Card } from '@poker/engine';
import {
  deriveChainSeed, deriveStreamSeed, drawDeck, normalizeSeedHex, randomBaseSeedHex, rngFromSeedHex,
} from './record-rng.js';

/** 调用方可以传数字、十进制字符串或 `0x` 十六进制；派生一律按无符号 64 位解释。 */
export type ArenaSeed = string | number | bigint;

/** 竞技场 seed 的规范形式（`0x` + 16 位十六进制），CLI / 子进程 / 报告统一用它。 */
export function normalizeSeed(seed: ArenaSeed): string {
  return `0x${normalizeSeedHex(seed)}`;
}

/** 默认随机 base seed 的规范形式（64 位）。 */
export function randomSeed(): string {
  return `0x${randomBaseSeedHex()}`;
}

/**
 * 一条链（对决）的 deck 顺序流：每次调用发下一副牌。
 * 与记录器 `deriveStreamSeed` 同域（'deck'），chainId 用对决序号。
 */
export function deckStream(seed: ArenaSeed, chainId: number): () => Card[] {
  const baseSeedHex = normalizeSeedHex(seed);
  const chainSeedHex = deriveChainSeed(baseSeedHex, chainId);
  const rand = rngFromSeedHex(deriveStreamSeed(chainSeedHex, chainId, 'deck'));
  return () => drawDeck(rand);
}

/**
 * 第 handIndex 手（0 起）的 deck。顺序流不支持跳读，这里从链起点重放；
 * 连续发牌的场景（playMatch / runDealDeals）应直接用 `deckStream`。
 */
export function deckForHand(seed: ArenaSeed, chainId: number, handIndex: number): Card[] {
  if (!Number.isInteger(handIndex) || handIndex < 0) {
    throw new Error(`handIndex 必须是非负整数: ${handIndex}`);
  }
  const nextDeck = deckStream(seed, chainId);
  let deck = nextDeck();
  for (let i = 0; i < handIndex; i++) deck = nextDeck();
  return deck;
}
