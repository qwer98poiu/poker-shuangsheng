/**
 * core card types for 双升 (拖拉机).
 * two standard decks = 108 cards (2×52 + 4 jokers).
 */

export enum Suit {
  Spades = 'S',
  Hearts = 'H',
  Clubs = 'C',
  Diamonds = 'D',
}

export enum SpecialSuit {
  Joker = 'J',
}

export type CardSuit = Suit | SpecialSuit;

export enum Rank {
  Two = 2, Three = 3, Four = 4, Five = 5, Six = 6,
  Seven = 7, Eight = 8, Nine = 9, Ten = 10,
  Jack = 11, Queen = 12, King = 13, Ace = 14,
  SmallJoker = 15,
  BigJoker = 16,
}

/** suit display order for off-suit cards: ♠ ♥ ♣ ♦ */
export const SUIT_ORDER: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];

export const ALL_SUITS: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];

export interface Card {
  readonly id: string;
  readonly suit: CardSuit;
  readonly rank: Rank;
  readonly isJoker: boolean;
}

export function cardId(suit: CardSuit, rank: Rank): string {
  return `${suit}-${rank}`;
}

/** human-readable rank label */
export function rankLabel(rank: Rank): string {
  switch (rank) {
    case Rank.Ace: return 'A';
    case Rank.King: return 'K';
    case Rank.Queen: return 'Q';
    case Rank.Jack: return 'J';
    case Rank.SmallJoker: return 'joker';
    case Rank.BigJoker: return 'JOKER';
    default: return String(rank);
  }
}

export function suitLabel(suit: CardSuit): string {
  switch (suit) {
    case Suit.Spades: return '♠';
    case Suit.Hearts: return '♥';
    case Suit.Clubs: return '♣';
    case Suit.Diamonds: return '♦';
    case SpecialSuit.Joker: return '';
  }
}

/** suit display name in Chinese */
export function suitName(suit: CardSuit): string {
  switch (suit) {
    case Suit.Spades: return '黑桃';
    case Suit.Hearts: return '红桃';
    case Suit.Clubs: return '草花';
    case Suit.Diamonds: return '方块';
    case SpecialSuit.Joker: return '王';
  }
}

/** BigJoker is red, SmallJoker is black */
export function isRed(card: Card): boolean {
  if (card.rank === Rank.BigJoker) return true;
  if (card.rank === Rank.SmallJoker) return false;
  return card.suit === Suit.Hearts || card.suit === Suit.Diamonds;
}

/** check if a card carries points */
export function cardPoints(rank: Rank): number {
  if (rank === Rank.Five) return 5;
  if (rank === Rank.Ten || rank === Rank.King) return 10;
  return 0;
}

/** check if this rank is a point card */
export function isPointCard(rank: Rank): boolean {
  return rank === Rank.Five || rank === Rank.Ten || rank === Rank.King;
}
