/**
 * Module 5 — Following (跟出).
 * Validates a follow play against the current trick's lead.
 */
import type { Card, CardSuit, ValidationResult } from '../types.js';
import type { TrumpDeclaration, ComboClass } from '../types.js';
import { isTrump } from '../model.js';
import { findAllPairs, detectTractors } from '../pattern/index.js';

export function validateFollow(
  cards: Card[], hand: Card[], leadCards: Card[],
  leadPattern: ComboClass, leadSuit: CardSuit | null, config: TrumpDeclaration,
): ValidationResult {
  // Same count
  if (cards.length !== leadCards.length) return { valid: false, error: `must play ${leadCards.length} cards` };
  // Cards in hand, no duplicates
  for (const c of cards) { if (!c || !hand.some(h => h.id === c.id)) return { valid: false, error: 'card not in hand' }; }
  if (new Set(cards.map(c => c.id)).size !== cards.length) return { valid: false, error: 'duplicate cards' };

  const leadIsTrump = leadCards.every(c => isTrump(c, config));
  const trumpInHand = hand.filter(c => isTrump(c, config));

  if (leadIsTrump) {
    if (trumpInHand.length >= leadCards.length) {
      if (cards.filter(c => isTrump(c, config)).length < leadCards.length)
        return { valid: false, error: 'lead is trump — must follow with trump' };
    }
    if (leadCards.length >= 2) return checkPatternMatch(cards, trumpInHand, leadPattern, config);
    return { valid: true };
  }

  // Off-suit lead
  if (!leadSuit) return { valid: true };
  const suitCards = hand.filter(c => c.suit === leadSuit && !isTrump(c, config));
  if (suitCards.length >= leadCards.length) {
    const playOff = cards.filter(c => !isTrump(c, config));
    if (!playOff.every(c => c.suit === leadSuit)) return { valid: false, error: 'must follow suit' };
    return checkPatternMatch(cards, suitCards, leadPattern, config);
  }
  return { valid: true }; // void — can trump or discard
}

function checkPatternMatch(play: Card[], suitCards: Card[], lead: ComboClass, config: TrumpDeclaration): ValidationResult {
  if (lead.type === 'pair' && play.length === 2) {
    if (play[0].suit !== play[1].suit || play[0].rank !== play[1].rank) {
      if (findAllPairs(suitCards).length > 0) return { valid: false, error: 'must play a pair' };
    }
  }
  if (lead.hasTractor && suitCards.length >= 4) {
    if (detectTractors(suitCards, config).length > 0 && detectTractors(play.filter(c => c.suit === suitCards[0].suit), config).length === 0)
      return { valid: false, error: 'must play tractor' };
  }
  return { valid: true };
}
