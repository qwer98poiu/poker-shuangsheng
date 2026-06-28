import type { Card, CardSuit } from '../types/card.js';
import { SpecialSuit } from '../types/card.js';
import type { TrumpDeclaration, PlayerState } from '../types/game.js';
import { isTrump } from '../model/rank.js';
import type { ComboClass } from '../types/play.js';
import { PatternType } from '../types/play.js';
import { classifyCombo, findAllPairs, detectTractor } from './tractor.js';

export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * validate that a player can play the given cards as a follow
 * (not leading the trick).
 *
 * rules:
 * 1. must play the same number of cards as the lead.
 * 2. if the player has cards of the lead suit, they MUST play cards
 *    of that suit (unless trumping with specific patterns).
 * 3. if lead has pairs/tractors, follower must match the pattern
 *    if they have the cards to do so.
 * 4. void in lead suit: can trump or discard.
 */
export function validateFollowPlay(
  play: Card[],
  player: PlayerState,
  leadCombo: ComboClass,
  leadSuit: CardSuit,
  config: TrumpDeclaration,
): ValidationResult {
  // rule 1: same count
  if (play.length !== leadCombo.length) {
    return { valid: false, error: `must play ${leadCombo.length} cards` };
  }

  // check all cards are in hand
  for (const c of play) {
    if (!player.hand.some(h => h.id === c.id)) {
      return { valid: false, error: `card ${c.id} not in hand` };
    }
  }

  // no duplicates in play
  const ids = new Set(play.map(c => c.id));
  if (ids.size !== play.length) {
    return { valid: false, error: 'duplicate cards in play' };
  }

  const playCombo = classifyCombo(play, config);
  const playIsTrump = play.some(c => isTrump(c, config));

  // check if player has lead suit cards
  const leadSuitCards = player.hand.filter(
    c => c.suit === leadSuit && c.suit !== SpecialSuit.Joker && !isTrump(c, config),
  );
  const hasLeadSuit = leadSuitCards.length > 0;

  const playContainsLeadSuit = play.some(
    c => c.suit === leadSuit && !isTrump(c, config),
  );

  if (hasLeadSuit) {
    // must play lead suit
    if (!playContainsLeadSuit) {
      return { valid: false, error: 'must follow suit with lead suit cards' };
    }

    // check pair/tractor matching
    return validatePatternMatch(playCombo, leadCombo, leadSuitCards, config);
  }

  // void in lead suit — can trump or discard
  // no further restrictions
  return { valid: true };
}

/**
 * validate pattern matching when following suit.
 * if the lead contains pairs, the follower must play matching pairs
 * if they have them. if lead is a tractor, follower must match tractor.
 */
function validatePatternMatch(
  play: ComboClass,
  lead: ComboClass,
  leadSuitCards: Card[],
  config: TrumpDeclaration,
): ValidationResult {
  if (lead.type === PatternType.Single) {
    return { valid: true };
  }

  if (lead.type === PatternType.Pair || lead.hasTractor) {
    // check if player can match the pairs
    const leadPairs = lead.hasTractor
      ? detectTractor(lead.cards, config).flat()
      : lead.cards;

    const availablePairs = findAllPairs(leadSuitCards);
    const availableTractors = leadSuitCards.length >= 4
      ? detectTractor(leadSuitCards, config)
      : [];

    // if player has matching pairs, they must play at least as many pairs
    // as they have available (up to the lead's pair count)
    // this is a simplified version — full throw matching is more complex

    // for now, ensure the play contains pairs if player has them
    if (availableTractors.length > 0 && !play.hasTractor) {
      return { valid: false, error: 'must play tractor if you have one' };
    }

    if (availablePairs.length > 0 && play.pairCount === 0) {
      return { valid: false, error: 'must play pairs if you have them' };
    }
  }

  return { valid: true };
}

/**
 * validate a lead play (when the player is leading the trick).
 * any valid combination is allowed when leading.
 */
export function validateLeadPlay(
  play: Card[],
  player: PlayerState,
): ValidationResult {
  if (play.length === 0) {
    return { valid: false, error: 'must play at least one card' };
  }

  // all cards in hand
  for (const c of play) {
    if (!player.hand.some(h => h.id === c.id)) {
      return { valid: false, error: `card ${c.id} not in hand` };
    }
  }

  // no duplicates
  const ids = new Set(play.map(c => c.id));
  if (ids.size !== play.length) {
    return { valid: false, error: 'duplicate cards in play' };
  }

  return { valid: true };
}

/**
 * get the lead suit from a combo.
 * jokers don't define a lead suit — use the first non-joker card.
 */
export function getLeadSuit(combo: ComboClass): CardSuit | null {
  const nonJoker = combo.cards.find(c => c.suit !== SpecialSuit.Joker);
  return nonJoker ? nonJoker.suit : null;
}

/**
 * find all legal plays for a player given the current trick state.
 * for leading: all single cards + all valid pairs + all valid tractors.
 * for following: all plays that satisfy follow-suit rules.
 */
export function findLegalPlays(
  player: PlayerState,
  isLeading: boolean,
  leadCombo: ComboClass | null,
  leadSuit: CardSuit | null,
  config: TrumpDeclaration,
): Card[][] {
  if (isLeading) {
    return findLegalLeadPlays(player, config);
  }
  return findLegalFollowPlays(player, leadCombo!, leadSuit!, config);
}

function findLegalLeadPlays(
  player: PlayerState,
  config: TrumpDeclaration,
): Card[][] {
  const plays: Card[][] = [];

  // singles
  for (const card of player.hand) {
    plays.push([card]);
  }

  // pairs
  const pairs = findAllPairs(player.hand);
  for (const pair of pairs) {
    plays.push(pair);
  }

  // tractors
  const tractors = detectTractor(player.hand, config);
  for (const tractor of tractors) {
    plays.push(tractor);
  }

  return plays;
}

function findLegalFollowPlays(
  player: PlayerState,
  leadCombo: ComboClass,
  leadSuit: CardSuit,
  config: TrumpDeclaration,
): Card[][] {
  // generate all combinations of `leadCombo.length` cards from hand
  // and filter by validity
  // for now, return empty — full generation is complex and will be
  // handled by the AI or UI layer
  return [];
}
