// types
export { Suit, SpecialSuit, Rank, SUIT_ORDER, ALL_SUITS, cardId, rankLabel, suitLabel, suitName, isRed, cardPoints, isPointCard } from './types/card.js';
export type { Card, CardSuit } from './types/card.js';

// model
export { createCard, cardsEqual, cardKey } from './model/card.js';
export { createFullDeck, shuffle, dealCards } from './model/deck.js';
export { getEffectiveRank, isTrump, compareCards, sortHand } from './model/rank.js';

// rules
export { classifyCombo, detectTractor, findAllPairs } from './rules/tractor.js';
export { compareInTrick, getPrimaryCard, getComboSuit } from './rules/comparison.js';
export { validateFollowPlay, validateLeadPlay, getLeadSuit, findLegalPlays } from './rules/validation.js';

// game
export { tryReveal, finalizeReveal, playCards, computeLevelChange } from './game/state.js';

export {
  GamePhase, Team, getTeam, teammateIndex, createInitialState,
} from './types/game.js';
export type {
  GameState, PlayerState, TrumpDeclaration, Trick, Reveal, AIReason,
} from './types/game.js';

export {
  PatternType, ComparisonResult,
} from './types/play.js';
export type { ComboClass, PlayedCards } from './types/play.js';

// AI
export { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, suggestPlay } from './ai/index.js';

// serialization
export { serialize, deserialize, resumeFromTrick } from './model/serialize.js';
