/**
 * Module 4 — Leading (领出/领牌).
 *
 * Basic check: cards in hand, same suit group, no duplicates.
 * Throw check (甩牌): the thrown cards must be the highest remaining
 * of their suit group. No other player can have a higher sub-pattern.
 */
import type { Card, ValidationResult } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { extractComponents, cardGreater } from '../comparing/index.js';

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

  // Check each player individually — crossing player boundaries creates
  // phantom pairs/tractors from cards split across different hands.
  for (const hand of otherHands) {
    const pc = hand.filter(c => suitGroup(c, config) === group);
    const pcComps = extractComponents(pc, config);
    const t = checkTractorBlock(comps, pcComps, config);
    if (t) return { valid: false, error: t };
    const p = checkPairBlock(comps, pcComps, config, pc);
    if (p) return { valid: false, error: p };
    const s = checkSingleBlock(comps, pc, config);
    if (s) return { valid: false, error: s };
  }

  return { valid: true };
}

// ---- Blocking checks (reused by resolveThrowFailure) ----

function getFilteredCardGroups(otherHands: Card[][], group: string, config: TrumpDeclaration): Card[][] {
  return otherHands.map(h => h.filter(c => suitGroup(c, config) === group));
}

function checkTractorBlock(
  comps: ReturnType<typeof extractComponents>,
  otherComps: ReturnType<typeof extractComponents>,
  config: TrumpDeclaration,
): string | null {
  for (const lt of comps.tractors) {
    const n = lt.length / 2;
    for (const ot of otherComps.tractors) {
      if (ot.length / 2 < n) continue;
      for (let i = 0; i <= (ot.length / 2) - n; i++) {
        const sub = ot.slice(i * 2, (i + n) * 2);
        if (cardGreater(maxCard(sub, config), maxCard(lt, config), config)) {
          return `another player has a higher ${n}-pair tractor`;
        }
      }
    }
  }
  return null;
}

function checkPairBlock(
  comps: ReturnType<typeof extractComponents>,
  otherComps: ReturnType<typeof extractComponents>,
  config: TrumpDeclaration,
  _otherCards: Card[],
): string | null {
  for (const lp of comps.pairs) {
    for (const op of otherComps.pairs) {
      if (cardGreater(op[0], lp[0], config)) return 'another player has a higher pair';
    }
    for (const ot of otherComps.tractors) {
      for (const c of ot) {
        if (cardGreater(c, lp[0], config)) return 'another player has a higher pair';
      }
    }
  }
  return null;
}

function checkSingleBlock(
  comps: ReturnType<typeof extractComponents>,
  otherCards: Card[],
  config: TrumpDeclaration,
): string | null {
  for (const ls of comps.singles) {
    for (const oc of otherCards) {
      if (cardGreater(oc, ls, config)) return 'another player has a higher single';
    }
  }
  return null;
}

function maxCard(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) => cardGreater(c, best, config) ? c : best);
}

export function suitGroup(card: Card, config: TrumpDeclaration): string {
  return isTrump(card, config) ? '_TRUMP_' : String(card.suit);
}

// ---- Throw failure resolution (甩牌失败强制出小) ----

export interface ThrowFailureResult {
  readonly forcedPlay: Card[];
  readonly reason: string;
}

/**
 * When a throw fails validation, determine the forced play.
 *
 * Only sub-patterns that are ACTUALLY BLOCKED are considered.
 * Priority: tractors → pairs → singles.
 * - Tractors: force the smallest longest blocked tractor.
 * - Pairs: force the smallest blocked pair by rank.
 * - Singles: force the smallest blocked single by rank.
 */
export function resolveThrowFailure(
  thrown: Card[],
  otherHands: Card[][],
  config: TrumpDeclaration,
): ThrowFailureResult {
  const comps = extractComponents(thrown, config);
  const group = suitGroup(thrown[0], config);
  const perPlayer = getFilteredCardGroups(otherHands, group, config);

  const anyBlocksTractor = (lt: Card[]) => {
    const n = lt.length / 2;
    return perPlayer.some(pc => {
      const pcc = extractComponents(pc, config);
      return pcc.tractors.some(ot => {
        if (ot.length / 2 < n) return false;
        for (let i = 0; i <= (ot.length / 2) - n; i++) {
          const sub = ot.slice(i * 2, (i + n) * 2);
          if (cardGreater(maxCard(sub, config), maxCard(lt, config), config)) return true;
        }
        return false;
      });
    });
  };

  const anyBlocksPair = (lp: Card[]) =>
    perPlayer.some(pc => {
      const pcc = extractComponents(pc, config);
      return pcc.pairs.some(op => cardGreater(op[0], lp[0], config)) ||
             pcc.tractors.some(ot => ot.some(c => cardGreater(c, lp[0], config)));
    });

  const anyBlocksSingle = (ls: Card) =>
    perPlayer.some(pc => pc.some((oc: Card) => cardGreater(oc, ls, config)));

  if (comps.tractors.length > 0 && comps.tractors.some(anyBlocksTractor)) {
    comps.tractors.sort((a, b) => {
      const lenDiff = (b.length / 2) - (a.length / 2);
      if (lenDiff !== 0) return lenDiff;
      return getEffectiveRank(maxCard(a, config), config) -
             getEffectiveRank(maxCard(b, config), config);
    });
    const picked = comps.tractors[0];
    return {
      forcedPlay: picked,
      reason: `throw failed — must play longest tractor (${picked.length / 2} pairs)`,
    };
  }

  if (comps.pairs.length > 0 && comps.pairs.some(anyBlocksPair)) {
    comps.pairs.sort((a, b) =>
      getEffectiveRank(a[0], config) - getEffectiveRank(b[0], config),
    );
    return {
      forcedPlay: comps.pairs[0],
      reason: 'throw failed — must play smallest pair',
    };
  }

  const blockedSingles = comps.singles.filter(anyBlocksSingle);
  if (blockedSingles.length > 0) {
    blockedSingles.sort((a, b) =>
      getEffectiveRank(a, config) - getEffectiveRank(b, config),
    );
    return {
      forcedPlay: [blockedSingles[0]],
      reason: 'throw failed — must play smallest single',
    };
  }

  return { forcedPlay: [thrown[0]], reason: 'throw failed' };
}
