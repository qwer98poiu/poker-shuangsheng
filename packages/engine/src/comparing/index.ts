/**
 * Module 6 — Comparing (比较大小).
 * Follows the user-provided pseudocode exactly.
 */
import type { Card, ComboClass, PlayedCards, TrumpDeclaration } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { cardPointsFromRank } from '../types.js';
import { findAllPairs, detectTractors, classify } from '../pattern/index.js';

export function cardGreater(a: Card, b: Card, config: TrumpDeclaration): boolean {
  const aT = isTrump(a, config), bT = isTrump(b, config);
  if (aT && !bT) return true;
  if (!aT && bT) return false;
  return getEffectiveRank(a, config) > getEffectiveRank(b, config);
}

function allTrump(cards: Card[], config: TrumpDeclaration): boolean {
  return cards.every(c => isTrump(c, config));
}

function allSameSuitGroup(cards: Card[], config: TrumpDeclaration): boolean {
  if (cards.length <= 1) return true;
  return cards.every(c => isTrump(c, config)) ||
    cards.every(c => !isTrump(c, config) && c.suit === cards[0].suit);
}

function getLeadType(cards: Card[], config: TrumpDeclaration): ComboClass['type'] {
  return classify(cards, config).type;
}

// ---- Component extraction ----

interface Components {
  tractors: Card[][];
  pairs: Card[][];
  singles: Card[];
}

export function extractComponents(cards: Card[], config: TrumpDeclaration): Components {
  const tractors = dedupTractors(detectTractors(cards, config));
  const tractorIds = new Set(tractors.flat().map(c => c.id));
  const pairs = findAllPairs(cards).filter(p => !tractorIds.has(p[0].id));
  const used = new Set([...tractorIds, ...pairs.flat().map(c => c.id)]);
  const singles = cards.filter(c => !used.has(c.id));
  tractors.sort((a, b) => (b.length / 2) - (a.length / 2));
  return { tractors, pairs, singles };
}

function dedupTractors(tractors: Card[][]): Card[][] {
  const sorted = [...tractors].sort((a, b) => b.length - a.length);
  const result: Card[][] = [];
  const used = new Set<string>();
  for (const t of sorted) {
    if (t.every(c => !used.has(c.id))) { result.push(t); t.forEach(c => used.add(c.id)); }
  }
  return result;
}

// ---- Pattern matching ----

function tractorLen(t: Card[]): number { return t.length / 2; }

export function matchPattern(
  lead: Card[], follow: Card[], config: TrumpDeclaration,
): boolean {
  // Follow must be same suit group
  if (!allSameSuitGroup(follow, config)) return false;

  const leadType = getLeadType(lead, config);

  if (leadType === 'single') return follow.length === 1;
  if (leadType === 'pair') return getLeadType(follow, config) === 'pair';
  if (leadType === 'tractor') {
    return getLeadType(follow, config) === 'tractor' && tractorLen(follow) === tractorLen(lead);
  }

  // throw
  if (allTrump(lead, config)) return false; // trump throw always wins

  if (!allTrump(follow, config)) return false;

  const lc = extractComponents(lead, config);
  const fc = extractComponents(follow, config);

  if (fc.tractors.length < lc.tractors.length) return false;
  for (let i = 0; i < lc.tractors.length; i++) {
    if (tractorLen(fc.tractors[i]) < tractorLen(lc.tractors[i])) return false;
  }

  const leadTrPairs = lc.tractors.reduce((s, t) => s + tractorLen(t), 0);
  const followTrPairs = fc.tractors.reduce((s, t) => s + tractorLen(t), 0);
  const extraPairs = followTrPairs - leadTrPairs;

  return fc.pairs.length + extraPairs >= lc.pairs.length;
}

// ---- Compare key extraction ----

function maxCard(cards: Card[], config: TrumpDeclaration): Card {
  return cards.reduce((best, c) => cardGreater(c, best, config) ? c : best);
}

function getMaxInTractors(tractors: Card[][], minLen: number, config: TrumpDeclaration): Card | null {
  const qualified = tractors.filter(t => tractorLen(t) >= minLen);
  if (qualified.length === 0) return null;
  let best: Card | null = null;
  for (const t of qualified) {
    const m = maxCard(t, config);
    if (best === null || cardGreater(m, best, config)) best = m;
  }
  return best;
}

function getCompareKey(lead: Card[], follow: Card[], config: TrumpDeclaration): Card {
  const leadType = getLeadType(lead, config);
  const fc = extractComponents(follow, config);

  if (leadType === 'single') return follow[0];
  if (leadType === 'pair') return follow[0];
  if (leadType === 'tractor') return maxCard(follow, config);

  // throw
  const lc = extractComponents(lead, config);
  if (lc.tractors.length > 0) {
    const minLen = Math.max(...lc.tractors.map(tractorLen));
    const key = getMaxInTractors(fc.tractors, minLen, config);
    if (key) return key;
  }
  if (lc.pairs.length > 0) return maxCard(fc.pairs.flat(), config);
  return maxCard(fc.singles, config);
}

// ---- Two-card comparison ----

type Winner = 'first' | 'second';

export function compareTwo(
  firstCards: Card[], secondCards: Card[], leadCards: Card[], config: TrumpDeclaration,
): Winner {
  const firstMatch = matchPattern(leadCards, firstCards, config);
  const secondMatch = matchPattern(leadCards, secondCards, config);

  if (firstMatch && !secondMatch) return 'first';
  if (secondMatch && !firstMatch) return 'second';
  // Both match or both don't. Both-don't-match is impossible (defensive).
  if (!firstMatch && !secondMatch) return 'first';

  const key1 = getCompareKey(leadCards, firstCards, config);
  const key2 = getCompareKey(leadCards, secondCards, config);

  return cardGreater(key2, key1, config) ? 'second' : 'first';
}

export function compareLeadVsFollow(lead: Card[], follow: Card[], config: TrumpDeclaration): boolean {
  return compareTwo(lead, follow, lead, config) === 'second';
}

// ---- Trick winner ----

export function determineWinner(
  plays: Card[][], leadIdx: number, config: TrumpDeclaration,
): { winnerIndex: number; points: number } {
  const lead = plays[0];
  let best = leadIdx;
  for (let i = 1; i < 4; i++) {
    const pi = (leadIdx + i) % 4;
    if (compareTwo(plays[(best - leadIdx + 4) % 4], plays[i], lead, config) === 'second')
      best = pi;
  }
  let pts = 0;
  for (const p of plays) for (const c of p) pts += cardPointsFromRank(c.rank);
  return { winnerIndex: best, points: pts };
}
