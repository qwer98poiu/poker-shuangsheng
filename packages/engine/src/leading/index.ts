/**
 * Module 4 — Leading (领出/领牌).
 *
 * Basic check: cards in hand, same suit group, no duplicates.
 * Throw check (甩牌): the thrown cards must be the highest remaining
 * of their suit group. No other player can have a higher sub-pattern.
 */
import type { Card } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump } from '../model.js';
import { extractComponents, cardGreater } from '../comparing/index.js';

export interface ValidationResult { readonly valid: boolean; readonly error?: string; }

export function validateLead(cards: Card[], hand: Card[], config: TrumpDeclaration): ValidationResult {
  if (cards.length === 0) return { valid: false, error: 'must play at least one card' };
  const hs = new Set(hand.map(c => c.id));
  for (const c of cards) {
    if (!c) return { valid: false, error: 'null card' };
    if (!hs.has(c.id)) return { valid: false, error: `card ${c.id} not in hand` };
  }
  if (new Set(cards.map(c => c.id)).size !== cards.length) return { valid: false, error: 'duplicate cards' };
  const g = suitGroup(cards[0], config);
  for (const c of cards) if (suitGroup(c, config) !== g) return { valid: false, error: 'all led cards must be from the same suit group' };
  return { valid: true };
}

/**
 * Validate a throw (甩牌). Checks that no other player has cards in the SAME
 * suit group that could beat any sub-pattern of the thrown cards.
 */
export function validateThrow(
  thrown: Card[], leaderHand: Card[], otherHands: Card[][], config: TrumpDeclaration,
): ValidationResult {
  const basic = validateLead(thrown, leaderHand, config);
  if (!basic.valid) return basic;

  const comps = extractComponents(thrown, config);
  const group = suitGroup(thrown[0], config);

  // Collect all cards of this suit group from other players
  const otherCards: Card[] = [];
  for (const h of otherHands) for (const c of h) if (suitGroup(c, config) === group) otherCards.push(c);
  const otherComps = extractComponents(otherCards, config);

  // 1. Tractors: same-length sub-tractor from others is higher
  for (const lt of comps.tractors) {
    const n = lt.length / 2;
    for (const ot of otherComps.tractors) {
      if (ot.length / 2 < n) continue;
      for (let i = 0; i <= (ot.length / 2) - n; i++) {
        const sub = ot.slice(i * 2, (i + n) * 2);
        if (cardGreater(maxCard(sub, config), maxCard(lt, config), config)) {
          return { valid: false, error: `another player has a higher ${n}-pair tractor` };
        }
      }
    }
  }

  // 2. Pairs: higher pair (standalone or from any tractor)
  for (const lp of comps.pairs) {
    for (const op of otherComps.pairs) {
      if (cardGreater(op[0], lp[0], config)) return { valid: false, error: 'another player has a higher pair' };
    }
    for (const ot of otherComps.tractors) {
      for (const c of ot) {
        if (cardGreater(c, lp[0], config)) return { valid: false, error: 'another player has a higher pair' };
      }
    }
  }

  // 3. Singles: higher single
  for (const ls of comps.singles) {
    for (const oc of otherCards) {
      if (cardGreater(oc, ls, config)) return { valid: false, error: 'another player has a higher single' };
    }
  }

  return { valid: true };
}

function maxCard(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) => cardGreater(c, best, config) ? c : best);
}

export function suitGroup(card: Card, config: TrumpDeclaration): string {
  return isTrump(card, config) ? '_TRUMP_' : String(card.suit);
}
