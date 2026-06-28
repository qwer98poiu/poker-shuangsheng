import type { Card, CardSuit } from '../types/card.js';
import { Rank, SpecialSuit, Suit } from '../types/card.js';
import type { TrumpDeclaration } from '../types/game.js';
import { getEffectiveRank, isTrump } from '../model/rank.js';

/**
 * tractor detection and combo classification.
 *
 * a "tractor" (拖拉机) is 2+ consecutive pairs of the same suit,
 * where "consecutive" is defined within the trump-adjusted ordering.
 */

/**
 * classify a set of cards into a combo pattern.
 */
import type { ComboClass } from '../types/play.js';
import { PatternType } from '../types/play.js';

export function classifyCombo(cards: Card[], config: TrumpDeclaration): ComboClass {
  const len = cards.length;

  if (len === 0) {
    return { type: PatternType.Single, cards, length: 0, pairCount: 0, hasTractor: false, tractorPairCount: 0 };
  }

  if (len === 1) {
    return { type: PatternType.Single, cards, length: 1, pairCount: 0, hasTractor: false, tractorPairCount: 0 };
  }

  if (len === 2) {
    const isPair_ = cards[0].suit === cards[1].suit && cards[0].rank === cards[1].rank;
    return {
      type: isPair_ ? PatternType.Pair : PatternType.Throw,
      cards,
      length: 2,
      pairCount: isPair_ ? 1 : 0,
      hasTractor: false,
      tractorPairCount: 0,
    };
  }

  // for 3+ cards, check for tractor or throw
  const tractors = detectTractor(cards, config);
  if (tractors.length > 0) {
    // the longest tractor
    const flat = tractors.flat();
    const tractorPairCount = flat.length / 2;
    return {
      type: PatternType.Tractor,
      cards,
      length: len,
      pairCount: tractorPairCount,
      hasTractor: true,
      tractorPairCount,
    };
  }

  // not a tractor — could be multiple pairs or a throw
  const pairs = findAllPairs(cards);
  if (pairs.length > 0) {
    return {
      type: PatternType.Throw,
      cards,
      length: len,
      pairCount: pairs.length,
      hasTractor: false,
      tractorPairCount: 0,
    };
  }

  return {
    type: PatternType.Throw,
    cards,
    length: len,
    pairCount: 0,
    hasTractor: false,
    tractorPairCount: 0,
  };
}

/**
 * detect all tractor combinations within a set of cards.
 * returns each tractor as an array of cards.
 */
export function detectTractor(cards: Card[], config: TrumpDeclaration): Card[][] {
  if (cards.length < 4) return [];

  const result: Card[][] = [];

  // group cards by "tractor grouping" key
  const groups = groupByTractorKey(cards, config);

  for (const group of groups.values()) {
    if (group.length < 4) continue;

    // sort by effective rank descending
    const sorted = [...group].sort((a, b) => getEffectiveRank(b, config) - getEffectiveRank(a, config));

    // find pairs in sorted order
    const pairs = extractPairs(sorted);
    if (pairs.length < 2) continue;

    // scan for consecutive sequences
    let i = 0;
    while (i < pairs.length - 1) {
      const seq: Card[][] = [pairs[i]];
      let j = i + 1;
      while (j < pairs.length && arePairsConsecutive(seq[seq.length - 1], pairs[j], config)) {
        seq.push(pairs[j]);
        j++;
      }
      if (seq.length >= 2) {
        result.push(seq.flat());
      }
      i = j;
    }
  }

  // check cross-group tractors:
  // SJ pair + trump level pair, and trump level pair + trump A pair
  const crossTractors = findCrossGroupTractors(cards, config);
  result.push(...crossTractors);

  return result;
}

/**
 * find all pairs in a sorted array of cards.
 * assumes cards of the same group.
 */
function extractPairs(sorted: Card[]): Card[][] {
  const pairs: Card[][] = [];
  let i = 0;
  while (i < sorted.length - 1) {
    // cards of same suit and rank form a pair
    if (sorted[i].suit === sorted[i + 1].suit && sorted[i].rank === sorted[i + 1].rank) {
      pairs.push([sorted[i], sorted[i + 1]]);
      i += 2; // skip the pair
    } else {
      i += 1;
    }
  }
  return pairs;
}

/**
 * find all pairs in a set of cards (not necessarily sorted).
 */
export function findAllPairs(cards: Card[]): Card[][] {
  const sorted = [...cards].sort((a, b) => {
    if (a.suit !== b.suit) return String(a.suit).localeCompare(String(b.suit));
    return b.rank - a.rank;
  });

  return extractPairs(sorted);
}

/**
 * check if two pairs are consecutive within their tractor group.
 */
function arePairsConsecutive(
  pair1: Card[],
  pair2: Card[],
  config: TrumpDeclaration,
): boolean {
  const a = pair1[0];
  const b = pair2[0];

  // must be same suit (or both jokers)
  if (a.suit === SpecialSuit.Joker && b.suit === SpecialSuit.Joker) {
    // BJ pair and SJ pair are consecutive
    return (a.rank === Rank.BigJoker && b.rank === Rank.SmallJoker) ||
           (a.rank === Rank.SmallJoker && b.rank === Rank.BigJoker);
  }

  // different suits → not consecutive
  if (a.suit !== b.suit) return false;

  // same suit: check if ranks are consecutive, skipping level rank
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);

  // must be exactly 1 step apart after skipping the level
  for (let r = lo + 1; r < hi; r++) {
    if (r !== config.level) return false; // there's a rank between them
  }
  return true;
}

/**
 * find cross-group tractors:
 * 1. Small Joker pair + Trump Level pair (suit trump mode)
 * 2. Trump Level pair + Trump A pair (suit trump mode)
 */
function findCrossGroupTractors(
  cards: Card[],
  config: TrumpDeclaration,
): Card[][] {
  if (config.trumpSuit === null) return []; // NT mode, no cross-group

  const result: Card[][] = [];

  const sjPair = findSpecificPair(cards, SpecialSuit.Joker, Rank.SmallJoker);
  const bjPair = findSpecificPair(cards, SpecialSuit.Joker, Rank.BigJoker);
  const trumpLevelPair = findSpecificPair(cards, config.trumpSuit, config.level);
  const trumpAPair = findSpecificPair(cards, config.trumpSuit, Rank.Ace);

  // SJ + Trump Level
  if (sjPair && trumpLevelPair) {
    result.push([...sjPair, ...trumpLevelPair]);
  }

  // Trump Level + Trump A (only if level != A, i.e., level < 14)
  if (trumpLevelPair && trumpAPair && config.level !== Rank.Ace) {
    result.push([...trumpLevelPair, ...trumpAPair]);
  }

  // BJ + SJ is already handled within joker group in detectTractor,
  // but just in case, handle it here too:
  if (bjPair && sjPair) {
    // check if not already found
    const alreadyFound = result.some(t => t.some(c => c.suit === SpecialSuit.Joker && c.rank === Rank.SmallJoker));
    if (!alreadyFound) {
      result.push([...bjPair, ...sjPair]);
    }
  }

  return result;
}

function findSpecificPair(cards: Card[], suit: CardSuit, rank: Rank): Card[] | null {
  const matches = cards.filter(c => c.suit === suit && c.rank === rank);
  return matches.length >= 2 ? [matches[0], matches[1]] : null;
}

/**
 * group cards by "tractor grouping key" for adjacency checking.
 */
function groupByTractorKey(
  cards: Card[],
  config: TrumpDeclaration,
): Map<string, Card[]> {
  const groups = new Map<string, Card[]>();

  for (const card of cards) {
    const key = getTractorGroupKey(card, config);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }

  return groups;
}

function getTractorGroupKey(card: Card, config: TrumpDeclaration): string {
  if (card.suit === SpecialSuit.Joker) return 'joker';

  if (card.rank === config.level) {
    return 'level';
  }

  return `${card.suit}`;
}
