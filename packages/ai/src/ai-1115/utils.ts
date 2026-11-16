/**
 * AI utility functions - shared helpers used across strategy modules.
 */
import type { Card, CardSuit } from '../types.js';
import { Rank, Suit, isPointRank } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import type { AIContext, PlayPosition } from './types.js';

// ---- Position helpers ----

/** Determine my position in the current trick. */
export function getPositionInTrick(ctx: AIContext): PlayPosition {
  const pos: PlayPosition[] = ['lead', 'second', 'third', 'fourth'];
  return pos[Math.min(ctx.playCount, 3)];
}

/** Whether my teammate is currently winning the trick. */
export function isTeammateWinning(ctx: AIContext): boolean {
  if (ctx.myIndex < 0) return false;
  const best = ctx.bestSoFar;
  if (!best || best.playerIndex === undefined) return false;
  return best.playerIndex === (ctx.myIndex + 2) % 4;
}

/** Whether the given cards can beat the current best in the trick. */
export function canBeat(
  cards: Card[],
  best: { cards: Card[]; playerIndex: number } | null | undefined,
  config: TrumpDeclaration,
): boolean {
  if (!best || best.cards.length === 0) return true;
  const myMax = Math.max(...cards.map(c => getEffectiveRank(c, config)));
  const bestMax = Math.max(...best.cards.map(c => getEffectiveRank(c, config)));
  return myMax > bestMax;
}

/** Get the max card by effective rank. */
export function maxCardT(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) =>
    getEffectiveRank(c, config) > getEffectiveRank(best, config) ? c : best,
  );
}

/** Check if teammate wins: best player is (myIndex + 2) % 4. */
export function teammateWins(
  myIdx: number | undefined,
  best: { cards: Card[]; playerIdx: number } | null | undefined,
): boolean {
  if (myIdx === undefined || !best) return false;
  return best.playerIdx === (myIdx + 2) % 4;
}

// ---- Card property helpers ----

/**
 * Get the top non-trump rank for a given off-suit.
 * When a rank is the level (trump), it's removed from the off-suit ranking.
 * E.g. level=A -> top off-suit is K; level=K -> top off-suit is A.
 */
export function getTopOffSuitRank(suit: Suit, config: TrumpDeclaration): Rank {
  // In NT mode, all levels are trump but there's no suit trump - A is still top off-suit.
  // In suited mode, check if A or K is the level.
  const candidates = [Rank.Ace, Rank.King, Rank.Queen, Rank.Jack];
  for (const r of candidates) {
    if (r !== config.level) return r;
  }
  return Rank.Ten; // fallback
}

/** Whether a card is a "big card" (大牌) in its off-suit. */
export function isBigOffSuitCard(card: Card, config: TrumpDeclaration): boolean {
  if (isTrump(card, config)) return false;
  const top = getTopOffSuitRank(card.suit as Suit, config);
  return card.rank === top;
}

/** Whether a card is a point card (5, 10, K). */
export function isPointCard(r: number): boolean {
  return isPointRank(r as Rank);
}

// ---- Pair-breaking helpers ----

/** Sum points visible in the current trick (from bestSoFar cards). */
function visibleTrickPoints(ctx: AIContext): number {
  if (!ctx.bestSoFar || !ctx.bestSoFar.cards.length) return 0;
  return ctx.bestSoFar.cards.reduce((s, c) => s + (isPointRank(c.rank) ? 5 : 0) + (c.rank === 10 || c.rank === 13 ? 5 : 0), 0);
}

/**
 * Check whether playing this card would break a pair in hand, and if so,
 * whether we should avoid it. Defenders never break pairs. Attackers avoid
 * unless the extra points cross a 40-point scoring threshold.
 */
function shouldAvoidBreakingPair(card: Card, hand: Card[], ctx: AIContext): boolean {
  if (!isPointRank(card.rank)) return false;
  const sameInHand = hand.filter(c =>
    c.suit === card.suit && c.rank === card.rank && c.id !== card.id
  );
  if (sameInHand.length === 0) return false;
  // Defenders never break pairs to add points.
  if (!ctx.isAttacker) return true;
  // Attackers: break only if crossing a 40-point threshold.
  const cardPts = card.rank === 5 ? 5 : 10;
  const projected = ctx.attackerPoints + visibleTrickPoints(ctx) + cardPts;
  const currTier = Math.floor(ctx.attackerPoints / 40);
  const projTier = Math.floor(projected / 40);
  return projTier === currTier;
}

/** `cards` 中与 `card` 同花色同点数的张数 ≥ 2（这张牌属于对子）。 */
export function breaksPairIn(cards: Card[], card: Card): boolean {
  return cards.filter(c => c.suit === card.suit && c.rank === card.rank).length >= 2;
}

/**
 * 同有效点数、同为级牌时：不成对的单张先于对子成员（零代价保对）。
 *
 * 有主局的副级牌（各门同级、eff 700）与无主局的所有级牌（eff 800）会在排序/
 * 取最小最大时撞成平局；此时拆对没有任何收益。非级牌或点数不同返回 0，
 * 由调用方保留原比较结果。`pool` 传当前可判断对子的牌池（通常为主牌全集）。
 */
export function levelSingleTiebreak(
  a: Card, b: Card, pool: Card[], config: TrumpDeclaration,
): number {
  if (a.rank !== config.level || b.rank !== config.level) return 0;
  if (getEffectiveRank(a, config) !== getEffectiveRank(b, config)) return 0;
  const ap = breaksPairIn(pool, a) ? 1 : 0;
  const bp = breaksPairIn(pool, b) ? 1 : 0;
  return ap - bp;
}

/** 稳定排序：只把同为级牌且同有效点数的单张挪到对子成员之前，其余顺序不变。 */
export function sortPreferLevelSingle(cards: Card[], config: TrumpDeclaration): Card[] {
  return [...cards].sort((a, b) => levelSingleTiebreak(a, b, cards, config));
}

/**
 * 盖不过 / 必输墩垫一张：按第二家第 5 条 avoid 梯子取最小——
 * 非分单 > 非分对 > 分单 > 分对；同档内优先不拆对，再取有效点数最小。
 * 第三家、第四家与缺主垫副共用。
 */
export function pickLowestAvoid(cards: Card[], ctx: TrumpDeclaration): Card {
  const weight = (c: Card): number[] => [
    isPointRank(c.rank) ? 1 : 0,
    breaksPairIn(cards, c) ? 1 : 0,
    getEffectiveRank(c, ctx),
  ];
  return cards.reduce((a, b) => {
    const wa = weight(a);
    const wb = weight(b);
    for (let i = 0; i < wa.length; i++) {
      if (wa[i] !== wb[i]) return wa[i] < wb[i] ? a : b;
    }
    return a;
  });
}

// ---- Sort helpers ----

/** When adding points, compare two point cards for dump order: 10 > K > 5.
 *  10 (10pts, rank 10) — dump first, low playing value.
 *  K  (10pts, rank 13) — dump second, can win future tricks.
 *  5  (5pts,  rank 5)  — dump last, only half the points. */
function pointDumpPriority(r: number): number {
  if (r === 10) return 0;
  if (r === 13) return 1;
  return 2; // rank 5
}

/** Sort pairs: non-point first, then smallest effective rank. */
export function pairSortAsc(config: TrumpDeclaration): (a: Card[], b: Card[]) => number {
  return (a, b) => {
    const aPts = isPointRank(a[0].rank) ? 100 : 0;
    const bPts = isPointRank(b[0].rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config);
  };
}

/**
 * Sort comparator: when teammateWinning, prefer point cards;
 * otherwise avoid them, prefer smallest rank.
 * Among same-priority cards, non-level trump comes before level trump.
 */
export function discardSort(
  teammateWinning: boolean,
  config?: TrumpDeclaration,
  hand?: Card[],
  ctx?: AIContext,
  needed?: number,
): (a: Card, b: Card) => number {
  return (a, b) => {
    const aPts = isPointRank(a.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    const bPts = isPointRank(b.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    if (aPts !== bPts) return aPts - bPts;
    // When adding points & need exactly 1 card: avoid breaking a pair to fill.
    // (If need >=2, the pair can play together — no breaking.)
    if (teammateWinning && hand && ctx && needed !== undefined && needed < 2
        && isPointRank(a.rank) && isPointRank(b.rank)) {
      const aBreak = shouldAvoidBreakingPair(a, hand, ctx) ? 100 : 0;
      const bBreak = shouldAvoidBreakingPair(b, hand, ctx) ? 100 : 0;
      if (aBreak !== bBreak) return aBreak - bBreak;
    }
    // Non-level trump before level trump (avoid wasting constant trump).
    // NT (trumpSuit null): level cards are the SMALLEST trumps (below
    // jokers) — dumping a joker while keeping a level card is wasteful,
    // so the rule must not apply; plain rank order pads level cards first.
    if (config && config.trumpSuit !== null) {
      const aLvl = a.rank === config.level ? 100 : 0;
      const bLvl = b.rank === config.level ? 100 : 0;
      if (aLvl !== bLvl) return aLvl - bLvl;
    }
    // When adding points: 10 > K > 5 (dump low-rank 10 first, keep K).
    if (teammateWinning && isPointRank(a.rank) && isPointRank(b.rank)) {
      const pd = pointDumpPriority(a.rank) - pointDumpPriority(b.rank);
      if (pd !== 0) return pd;
    }
    // 同为级牌且同有效点数（副级牌跨门）：不拆对的单张先出。
    if (hand && config) {
      const lv = levelSingleTiebreak(a, b, hand, config);
      if (lv !== 0) return lv;
    }
    return a.rank - b.rank;
  };
}

/**
 * Same as discardSort but additionally deprioritizes trump cards.
 * Among trump cards, deprioritize level trump (常主) and point trump.
 */
export function fillerSort(
  teammateWinning: boolean,
  config: TrumpDeclaration,
  hand?: Card[],
  ctx?: AIContext,
  needed?: number,
): (a: Card, b: Card) => number {
  return (a, b) => {
    const aPts = isPointRank(a.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    const bPts = isPointRank(b.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    if (aPts !== bPts) return aPts - bPts;
    // When adding points & need exactly 1: avoid breaking a pair to fill.
    if (teammateWinning && hand && ctx && needed !== undefined && needed < 2
        && isPointRank(a.rank) && isPointRank(b.rank)) {
      const aBreak = shouldAvoidBreakingPair(a, hand, ctx) ? 100 : 0;
      const bBreak = shouldAvoidBreakingPair(b, hand, ctx) ? 100 : 0;
      if (aBreak !== bBreak) return aBreak - bBreak;
    }
    // When adding points: 10 > K > 5 (dump low-rank 10 first, keep K).
    if (teammateWinning && isPointRank(a.rank) && isPointRank(b.rank)) {
      const pd = pointDumpPriority(a.rank) - pointDumpPriority(b.rank);
      if (pd !== 0) return pd;
    }
    // Prefer non-trump over trump as fillers
    const aTr = isTrump(a, config) ? 100 : 0;
    const bTr = isTrump(b, config) ? 100 : 0;
    if (aTr !== bTr) return aTr - bTr;
    // Both trump: non-level first (avoid wasting 常主), then smallest rank
    const aLvl = a.rank === config.level ? 100 : 0;
    const bLvl = b.rank === config.level ? 100 : 0;
    if (aLvl !== bLvl) return aLvl - bLvl;
    // 同为级牌且同有效点数：不拆对的单张先出。
    if (hand) {
      const lv = levelSingleTiebreak(a, b, hand, config);
      if (lv !== 0) return lv;
    }
    return a.rank - b.rank;
  };
}

// ---- Display helpers ----

export function groupBySuit(cards: readonly Card[]): Card[][] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const key = String(card.suit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }
  return Array.from(groups.values());
}

export function suitLabelCn(suit: CardSuit): string {
  return { S: '♠', H: '♥', C: '♣', D: '♦' }[suit as string] || String(suit);
}

export function cardName(card: Card): string {
  const rankMap: Record<number, string> = {
    14: 'A', 13: 'K', 12: 'Q', 11: 'J', 15: 'joker', 16: 'JOKER',
  };
  const rank = rankMap[card.rank] || String(card.rank);
  const suit = card.isJoker
    ? ''
    : { S: '♠', H: '♥', C: '♣', D: '♦' }[card.suit as string] || String(card.suit);
  return suit + rank;
}
