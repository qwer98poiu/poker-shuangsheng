import type { Card, CardSuit } from '../types/card.js';
import { Rank, SpecialSuit, cardId } from '../types/card.js';

export function createCard(suit: CardSuit, rank: Rank): Card {
  return Object.freeze({
    id: cardId(suit, rank),
    suit,
    rank,
    isJoker: suit === SpecialSuit.Joker,
  });
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.id === b.id;
}

export function cardKey(card: Card): string {
  return card.id;
}
