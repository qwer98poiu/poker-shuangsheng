/**
 * Refactored engine types for 双升 (Shengji).
 * Moved from the old fragmented types/ into a single coherent module.
 */

// ---- Card ----
export enum Suit { Spades = 'S', Hearts = 'H', Clubs = 'C', Diamonds = 'D' }
export enum SpecialSuit { Joker = 'J' }
export type CardSuit = Suit | SpecialSuit;

export enum Rank {
  Two = 2, Three = 3, Four = 4, Five = 5, Six = 6,
  Seven = 7, Eight = 8, Nine = 9, Ten = 10,
  Jack = 11, Queen = 12, King = 13, Ace = 14,
  SmallJoker = 15, BigJoker = 16,
}

export const SUIT_ORDER: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds];
export const ALL_SUITS: Suit[] = [...SUIT_ORDER];

export interface Card {
  readonly id: string;
  readonly suit: CardSuit;
  readonly rank: Rank;
  readonly isJoker: boolean;
}

export function cardId(suit: CardSuit, rank: Rank, idx: number): string {
  return `${suit}-${rank}-${idx}`;
}

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

export function suitName(suit: CardSuit): string {
  switch (suit) {
    case Suit.Spades: return '黑桃';
    case Suit.Hearts: return '红桃';
    case Suit.Clubs: return '草花';
    case Suit.Diamonds: return '方块';
    case SpecialSuit.Joker: return '王';
  }
}

export function isRed(card: Card): boolean {
  if (card.rank === Rank.BigJoker) return true;
  if (card.rank === Rank.SmallJoker) return false;
  return card.suit === Suit.Hearts || card.suit === Suit.Diamonds;
}

export function cardPointsFromRank(rank: Rank): number {
  if (rank === Rank.Five) return 5;
  if (rank === Rank.Ten || rank === Rank.King) return 10;
  return 0;
}

export function isPointRank(rank: Rank): boolean {
  return rank === Rank.Five || rank === Rank.Ten || rank === Rank.King;
}

// ---- Game State ----

export interface ValidationResult { readonly valid: boolean; readonly error?: string; }

export enum GamePhase {
  Dealing = 'dealing',
  Revealing = 'revealing',
  BottomExchange = 'bottom_exchange',
  Playing = 'playing',
  RoundEnd = 'round_end',
}

export interface TrumpDeclaration {
  readonly declarerIndex: number; // who won the reveal
  readonly trumpSuit: Suit | null; // null = NT
  readonly level: number;
}

export interface Reveal {
  readonly playerIndex: number;
  readonly suit: Suit | null;
  readonly strength: number; // 1=单张级牌, 2=对级牌, 3=对王
}

export interface PlayerState {
  readonly hand: Card[];
  readonly isHuman: boolean;
  readonly name: string;
  readonly index: number;
}

export interface ComboClass {
  readonly type: 'single' | 'pair' | 'tractor' | 'throw';
  readonly cards: Card[];
  readonly length: number;
  /** Number of standalone pairs (not part of any tractor). */
  readonly pairCount: number;
  /** Tractors found in this combo. Each entry is one tractor segment with its pair count.
   *  e.g. a 3-pair tractor = [{ pairCount: 3 }]. Two separate 2-pair tractors = [{ pairCount: 2 }, { pairCount: 2 }].
   *  Empty array means no tractor. */
  readonly tractors: readonly { pairCount: number }[];
  /** Convenience: true if any tractor is present. */
  readonly hasTractor: boolean;
}

export interface PlayedCards {
  readonly cards: Card[];
  readonly pattern: ComboClass;
  readonly leadSuit: CardSuit | null;
}

export interface Trick {
  readonly plays: [PlayedCards, PlayedCards, PlayedCards, PlayedCards];
  readonly leadPlayerIndex: number;
  readonly winnerIndex: number;
  readonly points: number;
}

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
  readonly declarerIndex: number; // default declarer — overridden by revealer only in round 1
  readonly trumpDeclaration: TrumpDeclaration | null;
  readonly attackerPoints: number;
  readonly currentPlayerIndex: number;
  readonly leadPlayerIndex: number;
  readonly trickPlays: PlayedCards[];
  readonly tricksPlayed: number;
  readonly reveals: Reveal[];
  readonly currentReveal: Reveal | null;
  readonly dealingComplete: boolean;
  readonly dealtCards: Card[][];
  readonly debug: boolean;
  readonly aiReasons: AIReason[];
  /** Throw failure penalty counts: [declarerTeam, attackerTeam], max 3 each. */
  readonly throwPenalties: readonly [number, number];
  /** 扣底后各家初始手牌（各 25 张），调试导出用（免反推开局）。 */
  readonly initialHands?: Card[][];
}

export function createInitialState(
  players: [PlayerState, PlayerState, PlayerState, PlayerState],
  declarerIndex: number,
  currentLevel: number,
  debug: boolean,
): GameState {
  return {
    phase: GamePhase.Dealing,
    currentLevel,
    players,
    bottomCards: [],
    trickHistory: [],
    declarerIndex,
    trumpDeclaration: null,
    attackerPoints: 0,
    currentPlayerIndex: declarerIndex,
    leadPlayerIndex: declarerIndex,
    trickPlays: [],
    tricksPlayed: 0,
    reveals: [],
    currentReveal: null,
    dealingComplete: false,
    dealtCards: [[], [], [], []],
    debug,
    aiReasons: [],
    throwPenalties: [0, 0],
  };
}
