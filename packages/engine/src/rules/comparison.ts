import type { Card, CardSuit } from '../types/card.js';
import { SpecialSuit } from '../types/card.js';
import type { TrumpDeclaration } from '../types/game.js';
import { getEffectiveRank, isTrump } from '../model/rank.js';
import type { ComboClass } from '../types/play.js';
import { ComparisonResult, PatternType } from '../types/play.js';
import { classifyCombo } from './tractor.js';

/**
 * compare two card combinations in a trick.
 * returns which combo wins.
 *
 * comparison rules:
 * 1. Trump always beats non-trump.
 * 2. Same pattern + same suit → compare by highest card's effective rank.
 * 3. If lead is a tractor, follow must also be tractor to compare.
 * 4. Throw comparisons: compare constituent patterns.
 */

/**
 * compare a follow play against the current best in the trick.
 * `best` is the current winning play (may be null if this is the first play).
 * `lead` is the first play in the trick (defines lead suit).
 */
export function compareInTrick(
  play: ComboClass,
  best: ComboClass | null,
  lead: ComboClass,
  leadSuit: CardSuit,
  config: TrumpDeclaration,
): ComparisonResult {
  if (!best) return ComparisonResult.LeadWins;

  const playIsTrump = isComboTrump(play, config);
  const bestIsTrump = isComboTrump(best, config);

  // trump vs non-trump
  if (playIsTrump && !bestIsTrump) return ComparisonResult.FollowWins;
  if (!playIsTrump && bestIsTrump) return ComparisonResult.LeadWins;

  // both trump or both non-trump
  if (playIsTrump && bestIsTrump) {
    return compareTrumpCombos(play, best, config);
  }

  // both non-trump, same suit as lead
  const playInLead = isComboInSuit(play, leadSuit);
  const bestInLead = isComboInSuit(best, leadSuit);

  if (playInLead && bestInLead) {
    return compareSameSuitCombos(play, best, config);
  }

  // one is in lead suit, the other is discarding (different non-trump suit)
  if (playInLead && !bestInLead) return ComparisonResult.FollowWins;
  if (!playInLead && bestInLead) return ComparisonResult.LeadWins;

  // both discarding — first play wins (shouldn't happen in normal play)
  return ComparisonResult.LeadWins;
}

function isComboTrump(combo: ComboClass, config: TrumpDeclaration): boolean {
  return combo.cards.some(c => isTrump(c, config));
}

function isComboInSuit(combo: ComboClass, suit: CardSuit): boolean {
  return combo.cards.every(c => c.suit === suit || c.suit === SpecialSuit.Joker);
}

function compareTrumpCombos(
  a: ComboClass,
  b: ComboClass,
  config: TrumpDeclaration,
): ComparisonResult {
  // same type: compare highest card
  if (a.type === b.type) {
    const maxA = maxEffRank(a.cards, config);
    const maxB = maxEffRank(b.cards, config);
    if (maxA > maxB) return ComparisonResult.FollowWins;
    if (maxB > maxA) return ComparisonResult.LeadWins;
    return ComparisonResult.Tie;
  }

  // tractor beats pair, pair beats single
  if (a.hasTractor && !b.hasTractor) return ComparisonResult.FollowWins;
  if (!a.hasTractor && b.hasTractor) return ComparisonResult.LeadWins;
  if (a.pairCount > b.pairCount) return ComparisonResult.FollowWins;
  if (b.pairCount > a.pairCount) return ComparisonResult.LeadWins;

  // fallback: compare by top card
  const maxA = maxEffRank(a.cards, config);
  const maxB = maxEffRank(b.cards, config);
  if (maxA > maxB) return ComparisonResult.FollowWins;
  if (maxB > maxA) return ComparisonResult.LeadWins;
  return ComparisonResult.Tie;
}

function compareSameSuitCombos(
  a: ComboClass,
  b: ComboClass,
  config: TrumpDeclaration,
): ComparisonResult {
  if (a.type === b.type) {
    const maxA = maxEffRank(a.cards, config);
    const maxB = maxEffRank(b.cards, config);
    if (maxA > maxB) return ComparisonResult.FollowWins;
    if (maxB > maxA) return ComparisonResult.LeadWins;
    return ComparisonResult.Tie;
  }

  if (a.hasTractor && !b.hasTractor) return ComparisonResult.FollowWins;
  if (!a.hasTractor && b.hasTractor) return ComparisonResult.LeadWins;
  if (a.pairCount > b.pairCount) return ComparisonResult.FollowWins;
  if (b.pairCount > a.pairCount) return ComparisonResult.LeadWins;

  const maxA = maxEffRank(a.cards, config);
  const maxB = maxEffRank(b.cards, config);
  if (maxA > maxB) return ComparisonResult.FollowWins;
  if (maxB > maxA) return ComparisonResult.LeadWins;
  return ComparisonResult.Tie;
}

function maxEffRank(cards: Card[], config: TrumpDeclaration): number {
  return Math.max(...cards.map(c => getEffectiveRank(c, config)));
}

/**
 * get the primary card for comparison from a combo.
 */
export function getPrimaryCard(combo: ComboClass, config: TrumpDeclaration): Card {
  return combo.cards.reduce((best, c) =>
    getEffectiveRank(c, config) > getEffectiveRank(best, config) ? c : best,
  );
}

/**
 * get the suit of a combo (for lead suit determination).
 * jokers' suit follows the lead or is considered universal.
 */
export function getComboSuit(combo: ComboClass): CardSuit | null {
  const nonJokers = combo.cards.filter(c => c.suit !== SpecialSuit.Joker);
  if (nonJokers.length > 0) return nonJokers[0].suit;
  return null; // all jokers
}
