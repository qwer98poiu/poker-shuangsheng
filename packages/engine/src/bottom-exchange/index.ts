/**
 * Module 3 — Bottom exchange (扣底).
 *
 * After trump is declared, the declarer (庄家) takes the 8 bottom cards into
 * their hand, then selects 8 cards to discard back to the bottom.
 *
 * Provides discarding strategy and a trump-card warning check for human players.
 */
import type { Card, PlayerState, TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { cardPointsFromRank } from '../types.js';

export interface ExchangeResult {
  readonly kept: Card[];
  readonly discarded: Card[];
}

/**
 * Pick 8 cards to discard based on priority scoring.
 * Lower score → more likely to be discarded.
 * Used by both AI (auto) and human (via CLI hook).
 */
export function chooseDiscards(hand: Card[], config: TrumpDeclaration): ExchangeResult {
  const scored = hand.map(card => ({
    card,
    score: keepScore(card, config),
  }));
  scored.sort((a, b) => a.score - b.score);
  return {
    discarded: scored.slice(0, 8).map(s => s.card),
    kept: scored.slice(8).map(s => s.card),
  };
}

function keepScore(card: Card, config: TrumpDeclaration): number {
  let s = 0;
  if (isTrump(card, config)) s += 50 + getEffectiveRank(card, config);
  if (card.rank === 14) s += 35;     // A
  if (card.rank === 13) s += 28;     // K
  if (card.rank === 10) s += 22;
  if (card.rank === 5)  s += 18;
  if (card.rank >= 12)  s += 10;     // Q+
  return s;
}

/**
 * Check whether the selected discard cards contain any trump.
 * Returns a warning message if so, or null if safe.
 * Used by CLI to show a confirmation prompt before actually discarding.
 */
export function checkTrumpWarning(
  discarded: Card[],
  config: TrumpDeclaration,
): { hasTrump: boolean; trumpCards: Card[]; message: string | null } {
  const trumpInDiscard = discarded.filter(c => isTrump(c, config));
  if (trumpInDiscard.length > 0) {
    return {
      hasTrump: true,
      trumpCards: trumpInDiscard,
      message: `⚠️ 你选了 ${trumpInDiscard.length} 张主牌扣入底牌，确定吗？`,
    };
  }
  return { hasTrump: false, trumpCards: [], message: null };
}

/** Calculate total points in a set of cards. */
export function totalPoints(cards: Card[]): number {
  return cards.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
}

/**
 * Execute the exchange: declarer merges bottom into hand, then removes discarded.
 * Returns new hand (25 cards) and new bottom (8 cards).
 */
export function executeExchange(
  declarerHand: Card[],
  bottom: Card[],
  discarded: Card[],
): { newHand: Card[]; newBottom: Card[] } {
  const merged = [...declarerHand, ...bottom];
  const discSet = new Set(discarded.map(c => c.id));
  return {
    newHand: merged.filter(c => !discSet.has(c.id)),
    newBottom: [...discarded],
  };
}
