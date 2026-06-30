/**
 * Module — Pattern detection (牌型检测).
 *
 * Classifies a set of cards into: single, pair, tractor, throw.
 * Tractor rules: 2+ consecutive pairs within the same suit group.
 * Cross-group special chains for suit trump and NT.
 */
import type { Card } from '../types.js';
import type { ComboClass, TrumpDeclaration } from '../types.js';
import { Rank, SpecialSuit } from '../types.js';

export function classify(cards: Card[], config: TrumpDeclaration): ComboClass {
  const len = cards.length;
  if (len === 0) return mk('single', cards, 0, []);
  if (len === 1) return mk('single', cards, 1, []);
  if (len === 2) {
    const isP = cards[0].suit === cards[1].suit && cards[0].rank === cards[1].rank;
    return mk(isP ? 'pair' : 'throw', cards, isP ? 1 : 0, []);
  }

  const pairs = findAllPairs(cards);
  const tractors = detectTractors(cards, config);

  if (tractors.length > 0) {
    const longest = tractors.reduce((a, b) => a.length >= b.length ? a : b);
    if (longest.length === cards.length) {
      return mk('tractor', cards, 0, [{ pairCount: longest.length / 2 }]);
    }
    const tractorIds = new Set(tractors.flat().map(c => c.id));
    const standalones = pairs.filter(p => !tractorIds.has(p[0].id));
    const distinct = distinctTractors(tractors);
    return mk('throw', cards, standalones.length, distinct.map(t => ({ pairCount: t.length / 2 })));
  }

  return mk('throw', cards, pairs.length, []);
}

function mk(type: ComboClass['type'], cards: Card[], pairCount: number, tractors: { pairCount: number }[]): ComboClass {
  return { type, cards, length: cards.length, pairCount, tractors, hasTractor: tractors.length > 0 };
}

function distinctTractors(tractors: Card[][]): Card[][] {
  const sorted = [...tractors].sort((a, b) => b.length - a.length);
  const result: Card[][] = [];
  const used = new Set<string>();
  for (const t of sorted) {
    if (t.every(c => !used.has(c.id))) { result.push(t); t.forEach(c => used.add(c.id)); }
  }
  return result;
}

export function findAllPairs(cards: Card[]): Card[][] {
  const res: Card[][] = [];
  const s = [...cards].sort((a, b) => String(a.suit).localeCompare(String(b.suit)) || b.rank - a.rank);
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i].suit === s[i + 1].suit && s[i].rank === s[i + 1].rank) { res.push([s[i], s[i + 1]]); i++; }
  }
  return res;
}

export function detectTractors(cards: Card[], config: TrumpDeclaration): Card[][] {
  if (cards.length < 4) return [];
  const pairs = findAllPairs(cards);
  const all: Card[][] = [];

  // 1. Same-suit consecutive pairs
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      if (areConsecutiveSameSuit(pairs[i][0], pairs[j][0], config)) {
        all.push([...pairs[i], ...pairs[j]]);
      }
    }
  }

  // 2. Merge overlapping to get 3+ pair chains
  const merged = mergeChains(all, config);
  all.push(...merged);

  // 3. Cross-group
  all.push(...crossGroupTractors(pairs, config));

  return all.filter(t => t.length >= 4);
}

function areConsecutiveSameSuit(a: Card, b: Card, config: TrumpDeclaration): boolean {
  if (a.suit !== b.suit) return false;
  if (a.suit === SpecialSuit.Joker) {
    return (a.rank === 16 && b.rank === 15) || (a.rank === 15 && b.rank === 16);
  }
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  for (let r = lo + 1; r < hi; r++) {
    if (r !== config.level) return false;
  }
  return true;
}

function mergeChains(chains: Card[][], config: TrumpDeclaration): Card[][] {
  const result: Card[][] = [];
  const used = new Set<number>();
  for (let i = 0; i < chains.length; i++) {
    if (used.has(i)) continue;
    let merged = [...chains[i]]; used.add(i);
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < chains.length; j++) {
        if (used.has(j)) continue;
        const last = [merged[merged.length - 2], merged[merged.length - 1]];
        const first = [chains[j][0], chains[j][1]];
        if (areConsecutiveSameSuit(last[0], first[0], config) && last[0].suit === first[0].suit) {
          merged.push(...chains[j]); used.add(j); extended = true;
        }
      }
    }
    if (merged.length > chains[i].length) result.push(merged);
  }
  return result;
}

function crossGroupTractors(pairs: Card[][], config: TrumpDeclaration): Card[][] {
  const res: Card[][] = [];
  const bj = pairs.find(p => p[0].rank === Rank.BigJoker);
  const sj = pairs.find(p => p[0].rank === Rank.SmallJoker);

  if (config.trumpSuit !== null) {
    const tLev = pairs.find(p => p[0].suit === config.trumpSuit && p[0].rank === config.level);
    const offLev = pairs.find(p => p[0].suit !== config.trumpSuit && p[0].suit !== SpecialSuit.Joker && p[0].rank === config.level);
    const tA = pairs.find(p => p[0].suit === config.trumpSuit && p[0].rank === Rank.Ace);

    if (bj && sj) res.push([...bj, ...sj]);
    if (sj && tLev) res.push([...sj, ...tLev]);
    if (tLev && offLev) res.push([...tLev, ...offLev]);
    if (offLev && tA) res.push([...offLev, ...tA]);
    if (bj && sj && tLev) res.push([...bj, ...sj, ...tLev]);
    if (sj && tLev && offLev) res.push([...sj, ...tLev, ...offLev]);
    if (tLev && offLev && tA) res.push([...tLev, ...offLev, ...tA]);
  } else {
    if (bj && sj) res.push([...bj, ...sj]);
    for (const p of pairs) {
      if (p[0].rank === config.level && p[0].suit !== SpecialSuit.Joker) {
        if (sj) res.push([...sj, ...p]);
        if (bj && sj) res.push([...bj, ...sj, ...p]);
      }
    }
  }
  return res;
}
