/**
 * 庄1（全控花色 / A 类）——领出阶梯的第一档。
 *
 * 候选花色（仅副牌）：
 *   1. 全控花色：当前手牌里该门全部是底牌规则的 T1/T2 控制张；
 *   2. 非全控、但同时含顶张和拖拉机的花色（A 类）。
 * 不含顶张的纯拖拉机归庄2；非全控、有顶张、无拖拉机的花色归庄4。
 *
 * 门内先看整门：24 张反推成立，或整门能作为一手安全甩牌，就整门出。
 * 否则按“含顶张的牌型”取最大集合：安全的含顶张+拖拉机甩牌 → 含顶张拖拉机
 * → 顶张对 → 顶张单张。非顶对不直接出：T1 非顶对只随顶张一起甩，T2 对由 0b
 * 接管；0b 不满足时本档放弃。
 *
 * 跨花色键：张数少 > 出完即断门 > 满足毙牌条件 > 对数多 > 有拖拉机 > SHCD。
 */
import type { Card, Suit } from '../types.js';
import { Rank, SUIT_ORDER } from '../types.js';
import { isTrump } from '../model.js';
import { classify, detectTractors } from '../pattern/index.js';
import { validateThrow } from '../leading/index.js';
import type { AIContext } from './types.js';
import { getTopOffSuitRank, suitLabelCn } from './utils.js';
import { rankLabelStr } from './reason.js';
import { worstCaseSuitHand, findThrowableSuitCards } from './throw-detector.js';
import { computeOffSuitControls } from './bottom-controls.js';
import { knownOutOfPlay } from './suit-memory.js';
import { canPlayerTrumpThrow } from './nt-tracking.js';

interface Candidate {
  readonly cards: Card[];
  readonly suit: Suit;
  readonly reason: string;
}

/** 该门副牌（级牌/主牌不属于该门）。 */
function cardsOfSuit(cards: readonly Card[], suit: Suit, ctx: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, ctx));
}

/** NT 长花色的动态顶张：扣掉已知出局的牌后该门最高的 rank。 */
function dynamicTopRank(suit: Suit, ctx: AIContext, exclude: readonly Card[]): Rank | null {
  const outCounts = new Map<number, number>();
  for (const c of exclude) {
    if (c.suit !== suit) continue;
    outCounts.set(c.rank, (outCounts.get(c.rank) ?? 0) + 1);
  }
  for (let r = Rank.Ace; r >= Rank.Two; r--) {
    if (r === ctx.level) continue;
    if ((outCounts.get(r) ?? 0) < 2) return r as Rank;
  }
  return null;
}

/** 该门的顶张口径：NT 长门动态，其余静态。 */
function topRankOf(
  suit: Suit, ctx: AIContext, longSuit: Suit | null,
): { rank: Rank; exclude: Card[]; isLong: boolean } {
  const isLong = ctx.trumpSuit === null && suit === longSuit;
  const exclude = isLong ? knownOutOfPlay(ctx, suit) : [];
  const rank = isLong
    ? dynamicTopRank(suit, ctx, exclude) ?? getTopOffSuitRank(suit, ctx)
    : getTopOffSuitRank(suit, ctx);
  return { rank, exclude, isLong };
}

/** 该门当前顶张（NT 长门动态，其余静态）。 */
export function topRankForSuit(suit: Suit, ctx: AIContext, longSuit: Suit | null): Rank {
  return topRankOf(suit, ctx, longSuit).rank;
}

/** 该门是否全控：非长门静态、NT 长门动态，`voidable` 为空即全控。 */
export function isAllControlSuit(
  hand: Card[], suit: Suit, ctx: AIContext, longSuit: Suit | null,
): boolean {
  const cards = cardsOfSuit(hand, suit, ctx);
  if (cards.length === 0) return false;
  const { rank, exclude, isLong } = topRankOf(suit, ctx, longSuit);
  const infos = computeOffSuitControls(
    hand, ctx, exclude,
    isLong ? (s: Suit) => (s === suit ? rank : getTopOffSuitRank(s, ctx)) : undefined,
  );
  return infos.some(i => i.suit === suit && i.voidable.length === 0);
}

/** 非全控 A 类：同时含顶张和结构性拖拉机。 */
export function hasTopAndTractor(
  hand: Card[], suit: Suit, ctx: AIContext, longSuit: Suit | null,
): boolean {
  const cards = cardsOfSuit(hand, suit, ctx);
  if (cards.length === 0) return false;
  const { rank } = topRankOf(suit, ctx, longSuit);
  return cards.some(c => c.rank === rank) && detectTractors(cards, ctx).length > 0;
}

/** 毙牌条件（仅无主）：`¬能毙(4) ∧ (¬能毙(2) ∨ 能毙(3))`。 */
export function beatsSafely(cards: Card[], ctx: AIContext): boolean {
  const nt = ctx.ntState;
  if (!nt || ctx.myIndex < 0) return false;
  const second = (ctx.myIndex + 1) % 4;
  const third = (ctx.myIndex + 2) % 4;
  const fourth = (ctx.myIndex + 3) % 4;
  if (canPlayerTrumpThrow(fourth, cards, nt, ctx)) return false;
  return !canPlayerTrumpThrow(second, cards, nt, ctx)
    || canPlayerTrumpThrow(third, cards, nt, ctx);
}

/** 整门作为一手甩牌是否安全（单/对/拖拉机本身合法，不需要过闸门）。 */
function wholeSafeThrow(
  cards: Card[], hand: Card[], suit: Suit, ctx: AIContext, exclude: readonly Card[],
): boolean {
  if (classify(cards, ctx).type !== 'throw') return false;
  const worst = worstCaseSuitHand(cards, suit, ctx, exclude);
  return validateThrow(cards, hand, [worst], ctx).valid;
}

/**
 * 安全的“含顶张”整手（最大集合）。
 * `findThrowableSuitCards` 给出最坏情况下仍能甩出的牌；这里只要求它含顶张，
 * 不要求含拖拉机——“顶张 > 拖拉机”里顶张的真实指代就是这手含顶张的最大集合
 * （AAK9988 → AAK），拖拉机只在没有顶张时才是候选。作为一手牌型仍须合法。
 */
function safeTopThrow(
  cards: Card[], hand: Card[], suit: Suit, top: Rank, ctx: AIContext,
  exclude: readonly Card[],
): Card[] | null {
  const throwable = findThrowableSuitCards(cards, suit, ctx, exclude);
  if (throwable.length === 0) return null;
  if (!throwable.some(c => c.rank === top)) return null;
  const combo = classify(throwable, ctx);
  if (combo.type === 'throw') {
    const worst = worstCaseSuitHand(cards, suit, ctx, exclude);
    if (!validateThrow(throwable, hand, [worst], ctx).valid) return null;
  }
  return throwable;
}

/** 去掉被更长拖拉机包含的短拖拉机（不拆拖拉机）。 */
function maximalTractors(tractors: Card[][]): Card[][] {
  const unique: Card[][] = [];
  const seen = new Set<string>();
  for (const t of tractors) {
    const key = t.map(c => c.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  return unique.filter((a, i) => !unique.some((b, j) => {
    if (i === j || a.length >= b.length) return false;
    const ids = new Set(b.map(c => c.id));
    return a.every(c => ids.has(c.id));
  }));
}

/** 同门多个拖拉机：对数少优先；同对数按最小对大的优先。 */
function sortTractors(tractors: Card[][]): Card[][] {
  return [...tractors].sort((a, b) => {
    const pa = a.length / 2;
    const pb = b.length / 2;
    if (pa !== pb) return pa - pb;
    const ma = Math.min(...a.map(c => c.rank));
    const mb = Math.min(...b.map(c => c.rank));
    if (ma !== mb) return mb - ma;
    const xa = Math.max(...a.map(c => c.rank));
    const xb = Math.max(...b.map(c => c.rank));
    return xb - xa;
  });
}

function tractorReason(cards: Card[], suit: Suit): string {
  return `出${suitLabelCn(suit)}拖拉机(${cards.length / 2}对)`;
}

/** 门内候选构造。 */
function buildTopPattern(
  hand: Card[], suit: Suit, ctx: AIContext, longSuit: Suit | null,
): { cards: Card[]; reason: string } | null {
  const cards = cardsOfSuit(hand, suit, ctx);
  if (cards.length === 0) return null;
  const { rank: top, exclude, isLong } = topRankOf(suit, ctx, longSuit);
  const topCards = cards.filter(c => c.rank === top);
  const label = suitLabelCn(suit);

  // 24 张反推：该门没有未知牌 → 整门剩余全部可出。
  if (isLong && knownOutOfPlay(ctx, suit).length + cards.length === 24) {
    return { cards, reason: `长花色24张反推，整门全出` };
  }

  // 1. 整门安全甩牌（最大集合）。
  if (wholeSafeThrow(cards, hand, suit, ctx, exclude)) {
    return { cards, reason: `甩${label}副牌(${cards.length}张)` };
  }

  // 2. 安全的含顶张整手（最大集合，不要求含拖拉机）。
  const safeTop = safeTopThrow(cards, hand, suit, top, ctx, exclude);
  if (safeTop) {
    const combo = classify(safeTop, ctx);
    if (combo.type === 'throw') {
      return { cards: safeTop, reason: `甩${label}副牌(${safeTop.length}张)` };
    }
    if (combo.type === 'tractor') {
      return { cards: safeTop, reason: tractorReason(safeTop, suit) };
    }
    if (combo.type === 'pair') {
      return { cards: safeTop, reason: `出${label}${rankLabelStr(top)}对` };
    }
    return { cards: safeTop, reason: `出${label}${rankLabelStr(top)}` };
  }

  const tractors = sortTractors(maximalTractors(detectTractors(cards, ctx)));

  // 3. 顶张在拖拉机里 → 该含顶张拖拉机。
  const topTractor = tractors.find(t => t.some(c => c.rank === top));
  if (topTractor) {
    return { cards: topTractor, reason: tractorReason(topTractor, suit) };
  }

  // 4. 顶张对 → 5. 顶张单张。
  if (topCards.length >= 2) {
    return {
      cards: [topCards[0], topCards[1]],
      reason: `出${label}${rankLabelStr(top)}对`,
    };
  }
  if (topCards.length === 1) {
    return { cards: [topCards[0]], reason: `出${label}${rankLabelStr(top)}` };
  }

  // 全控但没有顶张（例如纯低拖拉机）：出最大集合里的拖拉机。
  if (tractors.length > 0) {
    return { cards: tractors[0], reason: tractorReason(tractors[0], suit) };
  }
  return null;
}

function totalPairCount(combo: ReturnType<typeof classify>): number {
  return combo.pairCount
    + combo.tractors.reduce((s, t) => s + t.pairCount, 0);
}

/** 跨花色键（大者优先）。 */
function candidateKeys(cand: Candidate, suitCards: Card[], ctx: AIContext): number[] {
  const combo = classify(cand.cards, ctx);
  return [
    -cand.cards.length,
    cand.cards.length === suitCards.length ? 1 : 0,
    beatsSafely(cand.cards, ctx) ? 1 : 0,
    totalPairCount(combo),
    combo.hasTractor ? 1 : 0,
    SUIT_ORDER.length - SUIT_ORDER.indexOf(cand.suit),
  ];
}

function isBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * 庄1 入口。`longSuit` 由调用方算好传入（NT 才可能非 null），用于动态顶张、
 * 排除集和 24 张反推。没有候选时返回 null。
 */
export function tryDrain(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): { cards: Card[]; reason: string } | null {
  if (hand.length === 0) return null;

  let best: Candidate | null = null;
  let bestKeys: number[] | null = null;

  for (const suit of SUIT_ORDER) {
    const suitCards = cardsOfSuit(hand, suit, ctx);
    if (suitCards.length === 0) continue;
    const allControl = isAllControlSuit(hand, suit, ctx, longSuit);
    if (!allControl && !hasTopAndTractor(hand, suit, ctx, longSuit)) continue;

    const built = buildTopPattern(hand, suit, ctx, longSuit);
    if (!built) continue;
    const cand: Candidate = { cards: built.cards, suit, reason: built.reason };
    const keys = candidateKeys(cand, suitCards, ctx);
    if (best === null || bestKeys === null || isBetter(keys, bestKeys)) {
      best = cand;
      bestKeys = keys;
    }
  }

  return best === null ? null : { cards: best.cards, reason: best.reason };
}

/**
 * 庄1.5（仅无主）：该门手里只有一对非顶张对牌、rank ≥ J，且满足毙牌条件。
 * 0b 在更前面，条件满足时已经由 0b 出掉；这里只接管剩下的孤单非顶对。
 */
export function tryLoneNonTopPair(
  hand: Card[], ctx: AIContext, longSuit: Suit | null,
): { cards: Card[]; reason: string } | null {
  if (ctx.trumpSuit !== null) return null;

  for (const suit of SUIT_ORDER) {
    const cards = cardsOfSuit(hand, suit, ctx);
    if (cards.length !== 2 || cards[0].rank !== cards[1].rank) continue;
    const rank = cards[0].rank;
    if (rank < Rank.Jack) continue;
    const { rank: top } = topRankOf(suit, ctx, longSuit);
    if (rank === top) continue; // 顶张对归庄1
    if (!beatsSafely(cards, ctx)) continue;
    return {
      cards,
      reason: `出${suitLabelCn(suit)}${rankLabelStr(rank)}对（孤单非顶对）`,
    };
  }
  return null;
}
