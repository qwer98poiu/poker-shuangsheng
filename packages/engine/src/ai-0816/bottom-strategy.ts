/**
 * Bottom exchange strategy (扣底策略).
 *
 * Determines which 8 cards to discard into the bottom when the AI is declarer.
 *
 * With trump suit: priority is to void one off-suit (after reserving throwable cards).
 * NT mode: can void a suit if it has <=6 cards and no points.
 */
import type { Card } from '../types.js';
import { Suit, SUIT_ORDER, isPointRank } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank, sortHand } from '../model.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { groupBySuit } from './utils.js';
import type { AIContext } from './types.js';

export function aiChooseBottomCards(
  hand: Card[],
  config: AIContext | TrumpDeclaration,
): { keep: Card[]; discard: Card[]; reason: string } {
  const hasContext = 'myIndex' in config && (config as AIContext).myIndex >= 0;

  if (config.trumpSuit === null) {
    return chooseNTBottom(hand, config);
  }
  return chooseSuitedBottom(hand, config, hasContext ? (config as AIContext) : null);
}

/** Bottom strategy for suited trump mode. */
function chooseSuitedBottom(
  hand: Card[],
  config: TrumpDeclaration,
  ctx: AIContext | null,
): { keep: Card[]; discard: Card[]; reason: string } {
  // 1. Reserve throwable combos (these should never be discarded)
  const throwCombo = findThrowableOffSuitCombos(hand, config);
  const throwIds = new Set<string>();
  if (throwCombo) throwCombo.cards.forEach(c => throwIds.add(c.id));

  // 2. Group remaining non-trump cards by suit
  const nonTrump = hand.filter(
    c => !isTrump(c, config) && !throwIds.has(c.id),
  );
  const trumpCards = hand.filter(
    c => isTrump(c, config) && !throwIds.has(c.id),
  );

  const suitGroups = groupBySuit(nonTrump);
  const trumpCount = trumpCards.length;

  // 3. Try to void one off-suit - returns only discard, keep computed from full hand
  const voidResult = tryVoidSuit(suitGroups, trumpCount);
  if (voidResult) {
    const keep = hand.filter(c => !voidResult.discard.some(d => d.id === c.id));
    return { keep, discard: voidResult.discard, reason: voidResult.reason };
  }

  // 4. Even distribution - avoid point cards
  return evenDistribution(hand, trumpCards, nonTrump);
}

/** Try to void one off-suit. Returns only discard cards + reason. */
function tryVoidSuit(
  suitGroups: Card[][],
  trumpCount: number,
): { discard: Card[]; reason: string } | null {
  // Find suits that can be voided (all cards of that suit go to bottom)
  const candidates: { suit: string; cards: Card[]; points: number }[] = [];
  for (const g of suitGroups) {
    if (g.length === 0) continue;
    // 超过 8 张无法整门扣入底牌（否则 8 - length 为负，slice 负数会返回大量多余牌）
    if (g.length > 8) continue;
    const pts = g.reduce((s, c) => s + (isPointRank(c.rank) ? (c.rank === 5 ? 5 : 10) : 0), 0);
    // Allow 5 points discard; allow 10 points if trump >= 10
    const maxPoints = trumpCount >= 10 ? 10 : 5;
    if (pts <= maxPoints) {
      candidates.push({ suit: g[0].suit as string, cards: g, points: pts });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer: no points -> fewer cards
  candidates.sort((a, b) => {
    if (a.points !== b.points) return a.points - b.points;
    return a.cards.length - b.cards.length;
  });

  const chosen = candidates[0];
  const discardCards = chosen.cards;

  // Need exactly 8 - fill remaining with non-point cards from other suits
  const remaining: Card[] = [];
  for (const g of suitGroups) {
    if (g[0].suit !== chosen.suit) remaining.push(...g);
  }
  remaining.sort((a, b) => {
    const aPts = isPointRank(a.rank) ? 100 : 0;
    const bPts = isPointRank(b.rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return a.rank - b.rank;
  });

  const fill = remaining.slice(0, 8 - discardCards.length);
  const discard = [...discardCards, ...fill];

  const suitName = { S: '♠', H: '♥', C: '♣', D: '♦' }[chosen.suit] || chosen.suit;
  const ptsNote = chosen.points > 0 ? `(含${chosen.points}分)` : '';
  return {
    discard,
    reason: `扣绝${suitName}花色${ptsNote}`,
  };
}

/** Distribute evenly, avoid points. */
function evenDistribution(
  fullHand: Card[],
  trumpCards: Card[],
  nonTrump: Card[],
): { keep: Card[]; discard: Card[]; reason: string } {
  // Sort non-trump by suit, then by keeping value (big cards stay)
  const sorted = [...nonTrump].sort((a, b) => {
    // Point cards go to bottom first
    const aPts = isPointRank(a.rank) ? 100 : 0;
    const bPts = isPointRank(b.rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    // Lower rank goes to bottom
    return a.rank - b.rank;
  });

  const discard = sorted.slice(0, 8);
  const keep = fullHand.filter(c => !discard.some(d => d.id === c.id));
  return {
    keep,
    discard,
    reason: `均匀扣底，保留主牌${trumpCards.length}张`,
  };
}

/** NT bottom strategy. */
function chooseNTBottom(
  hand: Card[],
  config: TrumpDeclaration,
): { keep: Card[]; discard: Card[]; reason: string } {
  const throwCombo = findThrowableOffSuitCombos(hand, config);
  const throwIds = new Set<string>();
  if (throwCombo) throwCombo.cards.forEach(c => throwIds.add(c.id));

  const nonTrumpNonThrow = hand.filter(
    c => !isTrump(c, config) && !throwIds.has(c.id),
  );

  const suitGroups = groupBySuit(nonTrumpNonThrow);

  // In NT, can void a suit if <=6 cards and no points
  const candidates: { suit: string; cards: Card[] }[] = [];
  for (const g of suitGroups) {
    if (g.length === 0) continue;
    if (g.length > 6) continue;
    const hasPoints = g.some(c => isPointRank(c.rank));
    if (hasPoints) continue;
    candidates.push({ suit: g[0].suit as string, cards: g });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.cards.length - b.cards.length);
    const chosen = candidates[0];
    const discardCards = chosen.cards;
    const remaining = nonTrumpNonThrow.filter(
      c => c.suit !== chosen.suit,
    );
    remaining.sort((a, b) => a.rank - b.rank);
    const fill = remaining.slice(0, 8 - discardCards.length);
    const discard = [...discardCards, ...fill];
    const keep = hand.filter(c => !discard.some(d => d.id === c.id));
    const suitName = { S: '♠', H: '♥', C: '♣', D: '♦' }[chosen.suit] || chosen.suit;
    return { keep, discard, reason: `NT: 扣绝${suitName}花色(无分)` };
  }

  // Even distribution, avoid points
  return evenDistribution(hand, hand.filter(c => isTrump(c, config)), nonTrumpNonThrow);
}

/** All cards from suit groups except the specified suit. */
function allCardsExcept(
  suitGroups: Card[][],
  excludeSuit: string,
  config: TrumpDeclaration,
): Card[] {
  const result: Card[] = [];
  for (const g of suitGroups) {
    if (g[0].suit !== excludeSuit) result.push(...g);
  }
  return result;
}
