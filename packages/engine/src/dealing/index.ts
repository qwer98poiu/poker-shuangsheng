/**
 * Module 1 — Dealing (发牌).
 *
 * Pure functions: create a 108-card deck, shuffle, deal 100 cards to 4 players
 * (25 each) and 8 to the bottom. No side effects, no random without seeding.
 */
import type { Card } from '../types.js';
import { createFullDeck, shuffle as shuffleDeck } from '../model.js';

export interface DealResult {
  readonly hands: [Card[], Card[], Card[], Card[]];
  readonly bottom: Card[];
}

/**
 * Create a new shuffled deck and deal 25 cards per player + 8 bottom.
 */
export function deal(): DealResult {
  const deck = shuffleDeck(createFullDeck());
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) hands[i % 4].push(deck[i]);
  return {
    hands: hands as [Card[], Card[], Card[], Card[]],
    bottom: deck.slice(100, 108),
  };
}

/**
 * Deal a pre-shuffled deck (for deterministic testing).
 */
export function dealFromDeck(deck: Card[]): DealResult {
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) hands[i % 4].push(deck[i]);
  return {
    hands: hands as [Card[], Card[], Card[], Card[]],
    bottom: deck.slice(100, 108),
  };
}
