import type { Card, CardSuit } from '../types/card.js';

export enum PatternType {
  Single = 'single',
  Pair = 'pair',
  Tractor = 'tractor',
  Throw = 'throw',
}

export interface ComboClass {
  readonly type: PatternType;
  readonly cards: Card[];
  readonly length: number;
  readonly pairCount: number;
  readonly hasTractor: boolean;
  readonly tractorPairCount: number;
}

export interface PlayedCards {
  readonly cards: Card[];
  readonly pattern: ComboClass;
  readonly leadSuit: CardSuit | null;
}

export enum ComparisonResult {
  LeadWins = 'lead',
  FollowWins = 'follow',
  Tie = 'tie',
}
