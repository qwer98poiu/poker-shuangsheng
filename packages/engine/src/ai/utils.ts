/**
 * AI utility functions - shared helpers used across strategy modules.
 */
import type { Card, CardSuit } from '../types.js';
import { Rank, Suit, SpecialSuit, isPointRank } from '../types.js';
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

// ---- Sort helpers ----

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
): (a: Card, b: Card) => number {
  return (a, b) => {
    const aPts = isPointRank(a.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    const bPts = isPointRank(b.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    if (aPts !== bPts) return aPts - bPts;
    // Non-level trump before level trump (avoid wasting constant trump)
    if (config) {
      const aLvl = a.rank === config.level ? 100 : 0;
      const bLvl = b.rank === config.level ? 100 : 0;
      if (aLvl !== bLvl) return aLvl - bLvl;
    }
    // When adding points: point cards descending (dump big points first),
    // non-point cards ascending (keep big cards for future tricks).
    if (teammateWinning && isPointRank(a.rank) && isPointRank(b.rank)) {
      return b.rank - a.rank;
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
): (a: Card, b: Card) => number {
  return (a, b) => {
    const aPts = isPointRank(a.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    const bPts = isPointRank(b.rank) ? (teammateWinning ? 0 : 100) : (teammateWinning ? 100 : 0);
    if (aPts !== bPts) return aPts - bPts;
    // When adding points: point cards descending (dump big points first).
    if (teammateWinning && isPointRank(a.rank) && isPointRank(b.rank)) {
      return b.rank - a.rank;
    }
    // Prefer non-trump over trump as fillers
    const aTr = isTrump(a, config) ? 100 : 0;
    const bTr = isTrump(b, config) ? 100 : 0;
    if (aTr !== bTr) return aTr - bTr;
    // Both trump: non-level first (avoid wasting 常主), then smallest rank
    const aLvl = a.rank === config.level ? 100 : 0;
    const bLvl = b.rank === config.level ? 100 : 0;
    if (aLvl !== bLvl) return aLvl - bLvl;
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
