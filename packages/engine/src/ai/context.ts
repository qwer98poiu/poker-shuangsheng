/**
 * AI context builder - builds AIContext from GameState + playerIndex.
 */
import type { Card, GameState } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { determineWinner, compareTwo } from '../comparing/index.js';
import type { AIContext } from './types.js';
import { computeNTTrumpState } from './nt-tracking.js';

/**
 * Compute the current best play in the trick and which player made it.
 */
export function computeBestSoFar(
  trickPlays: readonly { cards: Card[] }[],
  leadPlayerIndex: number,
  config: NonNullable<GameState['trumpDeclaration']>,
): { cards: Card[]; playerIndex: number } | null {
  if (trickPlays.length === 0) return null;

  const plays: Card[][] = trickPlays.map(p => p.cards);

  // If only the lead has played so far, that's the best.
  if (plays.length === 1) {
    return { cards: plays[0], playerIndex: leadPlayerIndex };
  }

  const { winnerIndex } = determineWinner(plays, leadPlayerIndex, config);
  const winnerPlayIndex = (winnerIndex - leadPlayerIndex + 4) % 4;
  return {
    cards: plays[winnerPlayIndex],
    playerIndex: winnerIndex,
  };
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
