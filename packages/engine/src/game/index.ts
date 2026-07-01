/**
 * Game state transitions.
 *
 * Thin immutable wrappers that tie the pure sub-modules together into
 * full state mutations.  These are the only stateful-looking functions
 * in the engine — each returns a new GameState snapshot.
 */
import type { Card, CardSuit, GameState, PlayedCards, Trick } from '../types.js';
import { GamePhase, Suit } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import { validateLead, validateThrow } from '../leading/index.js';
import { validateFollow } from '../following/index.js';
import { attemptReveal, finalize, getRevealOptions } from '../revealing/index.js';
import { determineWinner } from '../comparing/index.js';
import { accumulateAttackerPoints } from '../scoring/index.js';

// ---- Reveal helpers ----

/** Apply a human or AI reveal attempt during the dealing/revealing phase. */
export function tryReveal(state: GameState, playerIndex: number, suit: Suit | null): GameState {
  const hand = state.players[playerIndex].hand;
  const opts = getRevealOptions(hand, state.currentLevel);
  const opt = opts.find(o => o.suit === suit);
  if (!opt) return state;

  const { currentReveal, reveals } = attemptReveal(
    state.currentReveal, state.reveals, playerIndex, suit, opt.strength,
  );
  return { ...state, currentReveal, reveals };
}

/** Finalize the reveal phase and set the trump declaration. */
export function finalizeReveal(state: GameState): GameState {
  const dealerIdx = state.dealerIndex;
  const dealerHand = state.players[dealerIdx].hand;
  const r = finalize(state.currentReveal, dealerHand, state.currentLevel, dealerIdx);

  const decl: TrumpDeclaration = {
    declarerIndex: r.declarerIndex,
    trumpSuit: r.trumpSuit,
    level: r.level,
  };
  return { ...state, trumpDeclaration: decl, phase: GamePhase.BottomExchange };
}

// ---- Play cards ----

export interface PlayResult {
  readonly error?: string;
  readonly state: GameState;
}

function removeFromHand(hand: Card[], cards: Card[]): Card[] {
  const ids = new Set(cards.map(c => c.id));
  return hand.filter(c => !ids.has(c.id));
}

/** Play cards from a player's hand.  Validates, classifies, and advances state. */
export function playCards(state: GameState, playerIndex: number, cards: Card[]): PlayResult {
  if (state.currentPlayerIndex !== playerIndex) {
    return { error: '不是你的回合', state };
  }

  const player = state.players[playerIndex];
  const config = state.trumpDeclaration!;
  const isLeading = state.trickPlays.length === 0;

  if (isLeading) {
    return playLead(state, playerIndex, cards, player.hand, config);
  }
  return playFollow(state, playerIndex, cards, player.hand, config);
}

function playLead(
  state: GameState, playerIndex: number, cards: Card[],
  hand: Card[], config: TrumpDeclaration,
): PlayResult {
  const v = validateLead(cards, hand, config);
  if (!v.valid) return { error: v.error, state };

  const pattern = classify(cards, config);

  if (pattern.type === 'throw') {
    const otherHands = state.players
      .filter((_, i) => i !== playerIndex)
      .map(p => p.hand);
    const tv = validateThrow(cards, hand, otherHands, config);
    if (!tv.valid) return { error: tv.error, state };
  }

  const leadSuit: CardSuit | null =
    cards.every(c => isTrump(c, config)) ? null : (cards[0].suit as CardSuit);

  const play: PlayedCards = { cards, pattern, leadSuit };

  return {
    state: advanceAfterPlay(state, playerIndex, play),
  };
}

function playFollow(
  state: GameState, playerIndex: number, cards: Card[],
  hand: Card[], config: TrumpDeclaration,
): PlayResult {
  const leadPlay = state.trickPlays[0];

  const v = validateFollow(cards, hand, leadPlay.cards, leadPlay.pattern, leadPlay.leadSuit, config);
  if (!v.valid) return { error: v.error, state };

  const pattern = classify(cards, config);
  const play: PlayedCards = { cards, pattern, leadSuit: leadPlay.leadSuit };

  return {
    state: advanceAfterPlay(state, playerIndex, play),
  };
}

function advanceAfterPlay(state: GameState, playerIndex: number, play: PlayedCards): GameState {
  const newPlays = [...state.trickPlays, play];
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hand: removeFromHand(p.hand, play.cards) } : p,
  ) as typeof state.players;

  // Not all four have played yet — pass to next player
  if (newPlays.length < 4) {
    return {
      ...state,
      trickPlays: newPlays,
      players: newPlayers,
      currentPlayerIndex: (playerIndex + 1) % 4,
    };
  }

  // All four played — resolve the trick
  const config = state.trumpDeclaration!;
  const cardPlays = newPlays.map(p => p.cards);
  const { winnerIndex, points } = determineWinner(cardPlays, state.leadPlayerIndex, config);

  const attackerPts = accumulateAttackerPoints(
    state.attackerPoints, points, winnerIndex, config.declarerIndex,
  );

  const trick: Trick = {
    plays: newPlays as [PlayedCards, PlayedCards, PlayedCards, PlayedCards],
    leadPlayerIndex: state.leadPlayerIndex,
    winnerIndex,
    points,
  };

  const tricksPlayed = state.tricksPlayed + 1;
  const roundOver = tricksPlayed >= 25;

  return {
    ...state,
    trickPlays: [],
    players: newPlayers,
    trickHistory: [...state.trickHistory, trick],
    attackerPoints: attackerPts,
    currentPlayerIndex: winnerIndex,
    leadPlayerIndex: winnerIndex,
    tricksPlayed,
    phase: roundOver ? GamePhase.RoundEnd : state.phase,
  };
}
