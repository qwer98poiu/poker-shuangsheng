/**
 * Bottom controls (扣底控制张) — tier classification for bottom-card strategy.
 *
 * For each off-suit (non-trump suit):
 *   tier1: top card (usually A; K when A is the level), any structural
 *          tractor (2+ consecutive pairs), and worst-case throwable cards
 *          (cards that could still be thrown even if all remaining
 *          same-suit cards sat in one opponent).
 *   tier2: extra pairs — all other pairs when tier1 contains >= 2 pairs;
 *          only rank >= 10 pairs when tier1 contains exactly 1 pair;
 *          none when tier1 contains no pair.
 *
 * The voidable remainder (待扣) of a suit = its cards outside tier1/tier2;
 * a suit can only be "voided" (扣绝) by discarding that remainder, keeping
 * the control cards in hand.
 */
import type { Card } from '../types.js';
import { Suit, SUIT_ORDER, Rank, cardPointsFromRank } from '../types.js';
import type { TrumpDeclaration } from '../types.js';
import { isTrump } from '../model.js';
import { extractComponents } from '../comparing/index.js';
import { findThrowableSuitCards } from './throw-detector.js';
import { getTopOffSuitRank } from './utils.js';

export interface OffSuitControlInfo {
  suit: Suit;
  /** All non-trump cards of this suit in hand. */
  cards: Card[];
  tier1: Card[];
  tier2: Card[];
  /** Number of pair units inside tier1 (AA=1, AA KK tractor=2). */
  tier1PairCount: number;
  /** Cards outside tier1/tier2 — the discardable remainder (待扣). */
  voidable: Card[];
  voidablePoints: number;
  /** Number of pair units inside the voidable remainder (tie-break key). */
  voidablePairCount: number;
}

export function computeOffSuitControls(
  hand: Card[],
  config: TrumpDeclaration,
): OffSuitControlInfo[] {
  const result: OffSuitControlInfo[] = [];
  for (const suit of SUIT_ORDER) {
    const cards = hand.filter(c => c.suit === suit && !isTrump(c, config));
    if (cards.length === 0) continue;

    // ---- tier1 ----
    const top = getTopOffSuitRank(suit, config);
    const tier1Set = new Set<string>();
    // a) top card (single or pair — every copy of the top rank)
    for (const c of cards) {
      if (c.rank === top) tier1Set.add(c.id);
    }
    // b) structural tractors (any 2+ consecutive pairs, top not required)
    const comps = extractComponents(cards, config);
    for (const t of comps.tractors) {
      for (const c of t) tier1Set.add(c.id);
    }
    // c) worst-case throwable cards (per-suit worst-case model)
    for (const c of findThrowableSuitCards(cards, suit, config)) {
      tier1Set.add(c.id);
    }
    const tier1 = cards.filter(c => tier1Set.has(c.id));

    // ---- tier2 ----
    const tier1PairCount = pairUnitCount(tier1);
    const rest = cards.filter(c => !tier1Set.has(c.id));
    const restPairUnits = pairUnitsOf(rest);
    let tier2: Card[] = [];
    if (tier1PairCount >= 2) {
      // Two or more tier1 pairs → every other pair is a control.
      for (const p of restPairUnits.pairs) tier2.push(...p);
    } else if (tier1PairCount === 1) {
      // Exactly one tier1 pair → only rank >= 10 pairs are controls.
      for (const p of restPairUnits.pairs) {
        if (p[0].rank >= Rank.Ten) tier2.push(...p);
      }
    }
    // tier1PairCount === 0 → no tier2.

    const tier2Ids = new Set(tier2.map(c => c.id));
    const voidable = cards.filter(c => !tier1Set.has(c.id) && !tier2Ids.has(c.id));

    result.push({
      suit,
      cards,
      tier1,
      tier2,
      tier1PairCount,
      voidable,
      voidablePoints: voidable.reduce((s, c) => s + cardPointsFromRank(c.rank), 0),
      voidablePairCount: pairUnitCount(voidable),
    });
  }
  return result;
}

/** Number of pair units in the given cards (2 copies of one rank = one pair). */
export function pairUnitCount(cards: Card[]): number {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const key = `${c.suit}:${c.rank}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let pairs = 0;
  for (const n of counts.values()) pairs += Math.floor(n / 2);
  return pairs;
}

export interface PairSplit {
  pairs: Card[][];
  singles: Card[];
}

/** Split cards into pair units and leftovers (deterministic by card id). */
export function pairUnitsOf(cards: Card[]): PairSplit {
  const byKey = new Map<string, Card[]>();
  for (const c of cards) {
    const key = `${c.suit}:${c.rank}`;
    const arr = byKey.get(key);
    if (arr) arr.push(c);
    else byKey.set(key, [c]);
  }
  const pairs: Card[][] = [];
  const singles: Card[] = [];
  for (const arr of byKey.values()) {
    const sorted = [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i + 1 < sorted.length; i += 2) pairs.push([sorted[i], sorted[i + 1]]);
    if (sorted.length % 2 === 1) singles.push(sorted[sorted.length - 1]);
  }
  return { pairs, singles };
}
