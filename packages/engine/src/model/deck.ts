import type { Card } from '../types/card.js';
import { Rank, SpecialSuit, Suit } from '../types/card.js';
import { createCard } from './card.js';

const SUITS: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];

const STANDARD_RANKS: Rank[] = [
  Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six,
  Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten,
  Rank.Jack, Rank.Queen, Rank.King, Rank.Ace,
];

/**
 * Create a full 108-card deck.
 * Each card gets a unique id (deck index appended) so the two
 * identical cards (e.g. ♠A from deck 1 and ♠A from deck 2)
 * have different IDs and won't be confused as duplicates.
 */
export function createFullDeck(): Card[] {
  const cards: Card[] = [];
  let idx = 0;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of STANDARD_RANKS) {
        const card = createCard(suit, rank);
        cards.push({ ...card, id: `${card.id}-${idx++}` });
      }
    }
    const sj = createCard(SpecialSuit.Joker, Rank.SmallJoker);
    cards.push({ ...sj, id: `${sj.id}-${idx++}` });
    const bj = createCard(SpecialSuit.Joker, Rank.BigJoker);
    cards.push({ ...bj, id: `${bj.id}-${idx++}` });
  }
  return cards;
}

/**
 * Fisher-Yates shuffle (in-place, returns the same array).
 */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deal 4 hands of 25 cards + 8 bottom cards from a shuffled deck.
 */
export function dealCards(deck: Card[]): { hands: Card[][]; bottom: Card[] } {
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) {
    hands[i % 4].push(deck[i]);
  }
  const bottom = deck.slice(100, 108);
  return { hands, bottom };
}
