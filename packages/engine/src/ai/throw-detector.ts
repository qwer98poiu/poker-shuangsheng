/**
 * Throw detector - finds guaranteed off-suit throw combinations.
 *
 * Algorithm: for each off-suit, construct a "worst-case" hand containing
 * all remaining cards of that suit (not in my hand) concentrated in one player.
 * Then check which of my singles/pairs/tractors beat the corresponding
 * patterns in that worst-case hand.
 */
import type { Card } from '../types.js';
import { Suit, SUIT_ORDER } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, createCard } from '../model.js';
import { extractComponents } from '../comparing/index.js';
import { cardGreater } from '../comparing/index.js';

/** All suits for off-suit analysis. */
const OFF_SUITS: Suit[] = [...SUIT_ORDER];

/**
 * Find a throwable off-suit combination in the hand.
 * Returns the throwable cards and a reason string, or null if none found.
 */
export function findThrowableOffSuitCombos(
  hand: Card[],
  config: TrumpDeclaration,
): { cards: Card[]; reason: string } | null {
  let bestCombo: { cards: Card[]; reason: string } | null = null;
  let bestScore = -1;

  for (const suit of OFF_SUITS) {
    if (suit === config.trumpSuit) continue; // skip trump suit

    const mySuitCards = hand.filter(
      c => c.suit === suit && !isTrump(c, config),
    );
    if (mySuitCards.length < 3) continue; // need at least 3 cards to throw

    // Build the worst-case testing hand: all cards of this suit minus mine.
    // Use rank counting instead of ID matching because test cards and
    // getAllSuitCards may produce different IDs for the same logical card.
    const allSuitCards = getAllSuitCards(suit, config.level);
    const myRankCounts = new Map<number, number>();
    for (const c of mySuitCards) {
      myRankCounts.set(c.rank, (myRankCounts.get(c.rank) || 0) + 1);
    }
    const worstCase = allSuitCards.filter(c => {
      const remaining = myRankCounts.get(c.rank) || 0;
      if (remaining > 0) {
        myRankCounts.set(c.rank, remaining - 1);
        return false; // exclude this copy
      }
      return true;
    });

    // Extract components from both my cards and worst case
    const myComps = extractComponents(mySuitCards, config);
    const worstComps = extractComponents(worstCase, config);

    // Find which of my components can beat the worst case
    const throwableCards = findThrowableInSuit(mySuitCards, myComps, worstComps, config);

    if (throwableCards.length >= 3) {
      const suitName = { S: '♠', H: '♥', C: '♣', D: '♦' }[suit] || suit;
      const score = throwableCards.length;
      if (score > bestScore) {
        bestScore = score;
        bestCombo = {
          cards: throwableCards,
          reason: `甩${suitName}副牌(${throwableCards.length}张)`,
        };
      }
    }
  }

  return bestCombo;
}

/**
 * Generate all cards of a given suit at the given level.
 * Handles the fact that level cards of this suit are trump (excluded).
 */
function getAllSuitCards(suit: Suit, level: number): Card[] {
  const cards: Card[] = [];
  let idx = 0;
  // 2 decks
  for (let d = 0; d < 2; d++) {
    for (let r = 2; r <= 14; r++) {
      if (r === level) continue; // level card is trump, not in this suit group
      cards.push(createCard(suit, r as any, idx++));
    }
  }
  return cards;
}

/**
 * Find which cards in my hand can be thrown.
 * Check singles, pairs, and tractors from highest to lowest -
 * anything that beats the worst case is throwable.
 */
function findThrowableInSuit(
  _myCards: Card[],
  myComps: ReturnType<typeof extractComponents>,
  worstComps: ReturnType<typeof extractComponents>,
  config: TrumpDeclaration,
): Card[] {
  const result: Card[] = [];
  const usedIds = new Set<string>();

  // Check tractors: not throwable only if worst case has a strictly higher tractor
  for (const myTr of myComps.tractors) {
    if (myTr.some(c => usedIds.has(c.id))) continue;
    const n = myTr.length / 2;
    const worstMax = findBestTractorOfLength(worstComps.tractors, n, config);
    if (worstMax === null || !cardGreater(worstMax, maxCard(myTr, config), config)) {
      myTr.forEach(c => usedIds.add(c.id));
      result.push(...myTr);
    }
  }

  // Check pairs: not throwable only if worst case has a strictly higher pair
  for (const myPair of myComps.pairs) {
    if (myPair.some(c => usedIds.has(c.id))) continue;
    const worstMax = findBestPairOrTractorCard(worstComps, myPair[0], config);
    if (worstMax === null || !cardGreater(worstMax, myPair[0], config)) {
      myPair.forEach(c => usedIds.add(c.id));
      result.push(...myPair);
    }
  }

  // Check singles: not throwable only if worst case has a strictly higher single
  for (const s of myComps.singles) {
    if (usedIds.has(s.id)) continue;
    const worstMax = findBestSingle(worstComps, config);
    if (worstMax === null || !cardGreater(worstMax, s, config)) {
      usedIds.add(s.id);
      result.push(s);
    }
  }

  return result;
}

function maxCard(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) => cardGreater(c, best, config) ? c : best);
}

function findBestTractorOfLength(
  tractors: Card[][],
  pairCount: number,
  config: TrumpDeclaration,
): Card | null {
  let best: Card | null = null;
  for (const t of tractors) {
    if (t.length / 2 >= pairCount) {
      const sub = t.slice(0, pairCount * 2);
      const m = maxCard(sub, config);
      if (best === null || cardGreater(m, best, config)) best = m;
    }
  }
  return best;
}

function findBestPairOrTractorCard(
  comps: ReturnType<typeof extractComponents>,
  _myCard: Card,
  config: TrumpDeclaration,
): Card | null {
  let best: Card | null = null;
  // Check standalone pairs
  for (const p of comps.pairs) {
    if (best === null || cardGreater(p[0], best, config)) best = p[0];
  }
  // Check cards in tractors (they're part of pairs too)
  for (const t of comps.tractors) {
    for (const c of t) {
      if (best === null || cardGreater(c, best, config)) best = c;
    }
  }
  return best;
}

function findBestSingle(
  comps: ReturnType<typeof extractComponents>,
  config: TrumpDeclaration,
): Card | null {
  if (comps.singles.length === 0) return null;
  return comps.singles.reduce((best, c) => cardGreater(c, best, config) ? c : best);
}
