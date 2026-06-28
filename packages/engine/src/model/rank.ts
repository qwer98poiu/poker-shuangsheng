import type { Card, CardSuit } from '../types/card.js';
import { Rank, Suit, SpecialSuit, SUIT_ORDER } from '../types/card.js';
import type { TrumpDeclaration } from '../types/game.js';

/**
 * compute effective rank for comparison.
 * suit trump mode (e.g. trump=♠, level=5):
 *   BigJoker(1000) > SmallJoker(900)
 *   > TrumpSuitLevel(800) > OffSuitLevel(700)
 *   > TrumpSuit A..2 (600+rank) > NonTrump (rank)
 *
 * NT mode: BigJoker(1000) > SmallJoker(900) > Level cards(800) > rest(rank)
 */
export function getEffectiveRank(card: Card, config: TrumpDeclaration): number {
  if (card.suit === SpecialSuit.Joker) {
    return card.rank === Rank.BigJoker ? 1000 : 900;
  }

  const isLevel = card.rank === config.level;
  const isTrumpSuit = config.trumpSuit !== null && card.suit === config.trumpSuit;

  if (config.trumpSuit === null) {
    if (isLevel) return 800;
    return card.rank;
  }

  if (isLevel && isTrumpSuit) return 800;
  if (isLevel && !isTrumpSuit) return 700;
  if (isTrumpSuit) return 600 + card.rank;
  return card.rank;
}

export function isTrump(card: Card, config: TrumpDeclaration): boolean {
  if (card.suit === SpecialSuit.Joker) return true;
  if (card.rank === config.level) return true;
  if (config.trumpSuit === null) return false;
  return card.suit === config.trumpSuit;
}

export function compareCards(a: Card, b: Card, config: TrumpDeclaration): number {
  return getEffectiveRank(a, config) - getEffectiveRank(b, config);
}

/**
 * sort a hand for display.
 * order: BigJoker > SmallJoker > trump level card > off-suit level cards
 *   > other trump suit cards (A..2, skip level)
 *   > off-suit cards grouped by ♠ ♥ ♦ ♣, each group A..2 (skip level)
 */
export function sortHand(cards: Card[], config: TrumpDeclaration | null): Card[] {
  return [...cards].sort((a, b) => {
    const gA = sortGroup(a, config);
    const gB = sortGroup(b, config);
    if (gA !== gB) return gA - gB;
    // within same group, sort by rank descending
    return b.rank - a.rank;
  });
}

/** return a numeric group for sorting; lower = appears first (leftmost) */
function sortGroup(card: Card, config: TrumpDeclaration | null): number {
  // Big Joker
  if (card.rank === Rank.BigJoker) return 0;
  // Small Joker
  if (card.rank === Rank.SmallJoker) return 1;

  if (config) {
    // trump level card
    if (card.rank === config.level && config.trumpSuit !== null && card.suit === config.trumpSuit) return 2;
    // off-suit level cards
    if (card.rank === config.level) return 3;
    // other trump suit cards
    if (config.trumpSuit !== null && card.suit === config.trumpSuit) return 4;
  }

  // off-suit cards: ordered by suit then rank
  const suitIdx = SUIT_ORDER.indexOf(card.suit as Suit);
  return 10 + (suitIdx >= 0 ? suitIdx : 4);
}

export function isPair(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}
