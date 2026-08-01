/**
 * AI strategy types.
 */
import type { Card, CardSuit, Trick, Reveal, TrumpDeclaration } from '../types.js';

/** Position in the current trick. */
export type PlayPosition = 'lead' | 'second' | 'third' | 'fourth';

/** NT trump tracking state - only non-null when config.trumpSuit is null. */
export interface NTTrumpState {
  /** Known trump cards still held by each player (deduced, not played). */
  readonly knownTrumpsPerPlayer: readonly (readonly Card[])[];
  /** Players known to have no trump cards. */
  readonly playersWithNoTrump: ReadonlySet<number>;
  /** Total trumps in the game (always 12 for NT). */
  readonly totalTrumps: 12;
  /** Number of trumps opponents still hold (minimum estimate). */
  readonly opponentTrumpCount: number;
  /** Remaining big jokers not yet seen. */
  readonly remainingBigJokers: number;
  /** Remaining small jokers not yet seen. */
  readonly remainingSmallJokers: number;
  /** Whether all unseen joker pairs are on our side (my team). */
  readonly allUnseenJokersOnOurSide: boolean;
  /** Whether all unseen big jokers are on our side. */
  readonly allUnseenBigJokersOnOurSide: boolean;

  /**
   * Possible constant-trump counts per suit-rank for each location.
   * Index 0-3 = other players' hands, 4 = bottom cards.
   * Null for self (known own hand) and for bottom when declarer (known bottom).
   * Each non-null entry is a Record mapping suitRank key (e.g. "J-16", "S-2")
   * to the maximum number of copies the location could hold.
   * Missing keys imply count 0.
   */
  readonly possibleTrumps: readonly (Readonly<Record<string, number>> | null)[]; // length 5
  /** Whether the distribution is fully determined. */
  readonly isFullyDetermined: boolean;
  /** Whether each player (0-3) can still form at least one pair from possible trumps. */
  readonly canFormPair: readonly boolean[]; // length 4
  /** Whether each player (0-3) can still have any joker (Big or Small). */
  readonly canHaveJoker: readonly boolean[]; // length 4
  /** Whether each player (0-3) can still have a Big Joker. */
  readonly canHaveBigJoker: readonly boolean[]; // length 4
  /** Whether each player (0-3) can still have a Small Joker. */
  readonly canHaveSmallJoker: readonly boolean[]; // length 4
  /** Minimum unplayed trump count per player (0-3). */
  readonly minTrumpCounts: readonly [number, number, number, number];
  /** Maximum unplayed trump count per player (0-3). */
  readonly maxTrumpCounts: readonly [number, number, number, number];
}

/**
 * Full AI decision context. Extends TrumpDeclaration so existing code
 * that passes a plain TrumpDeclaration still compiles.
 */
export interface AIContext extends TrumpDeclaration {
  /** My seat index (0-3). */
  readonly myIndex: number;
  /** True if I am the declarer (庄家). */
  readonly isDeclarer: boolean;
  /** True if I am the declarer's partner (庄家对家). */
  readonly isDeclarerPartner: boolean;
  /** True if I am on the attacking team (闲家). */
  readonly isAttacker: boolean;
  /** Current attacking team score. */
  readonly attackerPoints: number;
  /** Number of cards remaining in each player's hand. */
  readonly handCounts: readonly [number, number, number, number];
  /** Completed tricks in this round. */
  readonly trickHistory: readonly Trick[];
  /** All reveal records (for NT deduction). */
  readonly reveals: readonly Reveal[];
  /** Number of players who have played in the current trick. */
  readonly playCount: number;
  /** Who led the current trick. */
  readonly leadPlayerIndex: number;
  /** Current best play in this trick and who played it. */
  readonly bestSoFar: { cards: Card[]; playerIndex: number } | null;
  /** NT trump tracking - precomputed, only non-null in NT mode. */
  readonly ntState: NTTrumpState | null;
  /** Cards the declarer put in the bottom (if known to this player). */
  readonly bottomCards: readonly Card[];
  /** Whether this is a debug game. */
  readonly debug: boolean;
}

/** Minimal context for backward compatibility. */
export function minimalContext(config: TrumpDeclaration): AIContext {
  return {
    ...config,
    myIndex: -1,
    isDeclarer: false,
    isDeclarerPartner: false,
    isAttacker: false,
    attackerPoints: 0,
    handCounts: [25, 25, 25, 25] as const,
    trickHistory: [],
    reveals: [],
    playCount: 0,
    leadPlayerIndex: -1,
    bestSoFar: null,
    ntState: null,
    bottomCards: [],
    debug: false,
  };
}
