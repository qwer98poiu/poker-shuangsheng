/**
 * Pure model: card creation, deck, rank ordering, hand sorting.
 */
import type { Card, CardSuit, TrumpDeclaration } from './types.js';
import { Rank, Suit, SpecialSuit, SUIT_ORDER, cardId } from './types.js';

// ---- Card factory ----

export function createCard(suit: CardSuit, rank: Rank, idx: number): Card {
  return Object.freeze({
    id: cardId(suit, rank, idx),
    suit: suit as CardSuit,
    rank,
    isJoker: suit === (SpecialSuit.Joker as CardSuit),
  } as Card);
}

// ---- Deck ----

const STANDARD_RANKS: Rank[] = [
  Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six,
  Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten,
  Rank.Jack, Rank.Queen, Rank.King, Rank.Ace,
];

export function createFullDeck(): Card[] {
  const cards: Card[] = [];
  let idx = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
      for (const rank of STANDARD_RANKS) {
        cards.push(createCard(suit, rank, idx++));
      }
    }
    cards.push(createCard(SpecialSuit.Joker, Rank.SmallJoker, idx++));
    cards.push(createCard(SpecialSuit.Joker, Rank.BigJoker, idx++));
  }
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Seeded RNG (deterministic shuffle) ----

/**
 * mulberry32 — tiny deterministic 32-bit PRNG. Seed is truncated to uint32.
 * Returns a function producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle. Returns a new array (input untouched);
 * the same (seed, arr) always yields the same order.
 */
export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- Rank ordering under trump ----

export function getEffectiveRank(card: Card, config: TrumpDeclaration): number {
  if (card.suit === SpecialSuit.Joker) {
    return card.rank === Rank.BigJoker ? 1000 : 900;
  }
  const isLevel = card.rank === config.level;
  const isTrumpSuit = config.trumpSuit !== null && card.suit === config.trumpSuit;
  if (config.trumpSuit === null) {
    return isLevel ? 800 : card.rank;
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

// ---- Hand sorting ----

export function sortHand(cards: Card[], config: TrumpDeclaration | null): Card[] {
  return [...cards].sort((a, b) => {
    const g = sortGroup(a, config) - sortGroup(b, config);
    if (g !== 0) return g;
    if (a.rank !== b.rank) return b.rank - a.rank;
    const as = suitSortKey(a.suit);
    const bs = suitSortKey(b.suit);
    return as - bs;
  });
}

function suitSortKey(suit: CardSuit): number {
  if (suit === SpecialSuit.Joker) return 99;
  const idx = SUIT_ORDER.indexOf(suit as Suit);
  return idx >= 0 ? idx : 99;
}

function sortGroup(card: Card, config: TrumpDeclaration | null): number {
  if (card.rank === Rank.BigJoker) return 0;
  if (card.rank === Rank.SmallJoker) return 1;
  if (config) {
    if (card.rank === config.level && config.trumpSuit !== null && card.suit === config.trumpSuit) return 2;
    if (card.rank === config.level) return 3;
    if (config.trumpSuit !== null && card.suit === config.trumpSuit) return 4;
  }
  const suitIdx = SUIT_ORDER.indexOf(card.suit as Suit);
  return 10 + (suitIdx >= 0 ? suitIdx : 4);
}
