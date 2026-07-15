/**
 * AI context builder - builds AIContext from GameState + playerIndex.
 */
import type { Card, GameState } from '../types.js';
import { determineWinner, compareTwo } from '../comparing/index.js';
import type { AIContext } from './types.js';
import { computeNTTrumpState } from './nt-tracking.js';

/**
 * Compute the current best play in the trick and which player made it.
 * Handles partial tricks (1-3 plays) by comparing only plays that exist.
 */
export function computeBestSoFar(
  trickPlays: readonly { cards: Card[] }[],
  leadPlayerIndex: number,
  config: NonNullable<GameState['trumpDeclaration']>,
): { cards: Card[]; playerIndex: number } | null {
  if (trickPlays.length === 0) return null;

  const plays: Card[][] = trickPlays.map(p => p.cards);

  // Only the lead — that's the best so far
  if (plays.length === 1) {
    return { cards: plays[0], playerIndex: leadPlayerIndex };
  }

  // Use determineWinner only when all 4 players have played.
  // For partial tricks, iterate only over existing plays.
  if (plays.length === 4) {
    const { winnerIndex } = determineWinner(plays, leadPlayerIndex, config);
    const winnerPlayIdx = (winnerIndex - leadPlayerIndex + 4) % 4;
    return { cards: plays[winnerPlayIdx], playerIndex: winnerIndex };
  }

  // 2-3 players: compare each against the current best
  let bestIdx = leadPlayerIndex;
  let bestCards = plays[0];

  for (let i = 1; i < plays.length; i++) {
    const pi = (leadPlayerIndex + i) % 4;
    if (compareTwo(bestCards, plays[i], plays[0], config) === 'second') {
      bestIdx = pi;
      bestCards = plays[i];
    }
  }

  return { cards: bestCards, playerIndex: bestIdx };
}

/**
 * Build full AIContext from a GameState and player index.
 */
export function buildAIContext(
  state: GameState,
  playerIndex: number,
): AIContext | null {
  const config = state.trumpDeclaration;
  if (!config) return null;

  const declarerIdx = state.declarerIndex;
  const isDeclarer = playerIndex === declarerIdx;
  const isDeclarerPartner = playerIndex === (declarerIdx + 2) % 4;
  const attackerParity = declarerIdx % 2 === 0 ? 1 : 0;
  const isAttacker = playerIndex % 2 === attackerParity;

  const handCounts = state.players.map(p => p.hand.length) as [number, number, number, number];

  const bestSoFar = computeBestSoFar(state.trickPlays, state.leadPlayerIndex, config);

  const ntState = config.trumpSuit === null
    ? computeNTTrumpState(
        state.players[playerIndex].hand,
        playerIndex,
        state.trickHistory,
        state.reveals,
        config,
        isDeclarer,
        state.bottomCards,
      )
    : null;

  return {
    declarerIndex: config.declarerIndex,
    trumpSuit: config.trumpSuit,
    level: config.level,
    myIndex: playerIndex,
    isDeclarer,
    isDeclarerPartner,
    isAttacker,
    attackerPoints: state.attackerPoints,
    handCounts,
    trickHistory: state.trickHistory,
    reveals: state.reveals,
    playCount: state.trickPlays.length,
    leadPlayerIndex: state.leadPlayerIndex,
    bestSoFar,
    ntState,
    bottomCards: state.bottomCards,
    debug: state.debug,
  };
}
