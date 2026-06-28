import type { Card, Suit } from '../types/card.js';
import type { PlayedCards } from '../types/play.js';

export enum GamePhase {
  Setup = 'setup',
  Dealing = 'dealing',
  Revealing = 'revealing',
  Playing = 'playing',
  RoundEnd = 'round_end',
}

export enum Team {
  TeamAC = 0,
  TeamBD = 1,
}

export function getTeam(playerIndex: number): Team {
  return playerIndex % 2 === 0 ? Team.TeamAC : Team.TeamBD;
}

export function teammateIndex(playerIndex: number): number {
  return (playerIndex + 2) % 4;
}

export interface PlayerState {
  readonly hand: Card[];
  readonly isHuman: boolean;
  readonly name: string;
  readonly index: number;
}

/** trump declaration from reveal or calling */
export interface TrumpDeclaration {
  readonly declarerIndex: number;
  readonly trumpSuit: Suit | null;
  readonly level: number;
}

/** a reveal (亮主) attempt during dealing */
export interface Reveal {
  readonly playerIndex: number;
  readonly suit: Suit | null; // null = NT (pair of jokers)
  /** strength: 1 = single level card, 2 = pair of level cards, 3 = pair of jokers */
  readonly strength: number;
}

export interface Trick {
  readonly plays: [PlayedCards, PlayedCards, PlayedCards, PlayedCards];
  readonly leadPlayerIndex: number;
  readonly winnerIndex: number;
  readonly points: number;
}

/** AI reasoning entry for debug */
export interface AIReason {
  readonly playerIndex: number;
  readonly phase: string;
  readonly decision: string;
  readonly reason: string;
  readonly cards: string[];
}

export interface GameState {
  readonly phase: GamePhase;
  readonly currentLevel: number;
  readonly players: [PlayerState, PlayerState, PlayerState, PlayerState];
  readonly bottomCards: Card[];
  readonly trickHistory: Trick[];
  readonly dealerIndex: number;
  readonly trumpDeclaration: TrumpDeclaration | null;
  /** points scored by the attacking team (non-dealer team) this round */
  readonly attackerPoints: number;
  readonly currentPlayerIndex: number;
  readonly leadPlayerIndex: number;
  readonly trickPlays: PlayedCards[];
  readonly tricksPlayed: number;
  /** reveal attempts during dealing */
  readonly reveals: Reveal[];
  /** current reveal state */
  readonly currentReveal: Reveal | null;
  /** whether dealing is complete */
  readonly dealingComplete: boolean;
  /** cards dealt so far to each player */
  readonly dealtCards: Card[][];
  /** if true, game is in debug mode */
  readonly debug: boolean;
  /** AI reasoning log */
  readonly aiReasons: AIReason[];
}

export function createInitialState(
  players: [PlayerState, PlayerState, PlayerState, PlayerState],
  dealerIndex: number,
  currentLevel: number,
  debug: boolean,
): GameState {
  return {
    phase: GamePhase.Dealing,
    currentLevel,
    players,
    bottomCards: [],
    trickHistory: [],
    dealerIndex,
    trumpDeclaration: null,
    attackerPoints: 0,
    currentPlayerIndex: dealerIndex,
    leadPlayerIndex: dealerIndex,
    trickPlays: [],
    tricksPlayed: 0,
    reveals: [],
    currentReveal: null,
    dealingComplete: false,
    dealtCards: [[], [], [], []],
    debug,
    aiReasons: [],
  };
}
