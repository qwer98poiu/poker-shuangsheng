/**
 * Shared AI strategy helpers — tactical utilities used by both trump-follow
 * and off-suit-follow modules for pattern evaluation, point management,
 * and card selection.
 */
import type { Card, ComboClass } from '../types.js';
import { Rank, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { isBigOffSuitCard, discardSort, pairSortAsc } from './utils.js';
import { annotateReason } from './reason.js';

// ---- Sorting helpers ----

/** Sort pairs for killing/following: non-tractor first (avoid breaking tractors),
 *  then non-point first, then smallest effective rank. */
export function pairKillSort(pairs: Card[][], cards: Card[], ctx: AIContext): void {
  const tractors = detectTractors(cards, ctx);
  const tractorIds = new Set(tractors.flat().map(c => c.id));
  pairs.sort((a, b) => {
    const aTr = tractorIds.has(a[0].id) ? 100 : 0;
    const bTr = tractorIds.has(b[0].id) ? 100 : 0;
    if (aTr !== bTr) return aTr - bTr;
    const aPts = isPointRank(a[0].rank) ? 100 : 0;
    const bPts = isPointRank(b[0].rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
  });
}

// ---- Discard / Pad helpers ----

export function discardNonTrump(
  hand: Card[],
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  leadCombo?: ComboClass,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  nonTrump.sort(discardSort(!!tmWin, ctx));
  const combo = leadCombo || { type: 'single' as const, cards: [], length: leadLen, pairCount: 0, tractors: [], hasTractor: false };
  if (nonTrump.length >= leadLen) {
    const cards = nonTrump.slice(0, leadLen);
    const addPt = tmWin && canAddPoints(tmWin, position, combo, ctx);
    const intent = addPt ? 'add' : 'none';
    const reason = annotateReason('垫牌', cards, [], [],
      combo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }
  const trump = hand.filter(c => isTrump(c, ctx));
  trump.sort(discardSort(!!tmWin, ctx));
  const cards = [...nonTrump, ...trump].slice(0, leadLen);
  const addPt2 = tmWin && canAddPoints(tmWin, position, combo, ctx);
  const intent = addPt2 ? 'add' : 'none';
  const reason = annotateReason('垫牌', cards, [], [],
    combo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

export function padWithDiscards(
  hand: Card[],
  myTrump: Card[],
  leadLen: number,
  ctx: AIContext,
  tmWin: boolean,
  position: string,
  leadCombo: ComboClass,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  const shouldAvoid = (position === 'fourth' && !tmWin)
    || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
    || (position === 'third' && !tmWin);
  nonTrump.sort(discardSort(!shouldAvoid && !!tmWin, ctx));
  const cards = [...myTrump, ...nonTrump].slice(0, leadLen);
  const intent = shouldAvoid ? 'avoid' : 'none';
  const reason = annotateReason('主牌不够，垫副牌', cards, myTrump, myTrump,
    leadCombo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

// ---- Point-adding strategy ----

/** Whether we should add points when teammate is winning.
 *  Fourth: always.
 *  Third: only if lead is max pattern — big card (A/K single or pair),
 *         has tractor, or is a throw (甩牌 already max). */
export function canAddPoints(tmWin: boolean, position: string, leadCombo: ComboClass, ctx: AIContext): boolean {
  if (!tmWin) return false;
  if (position === 'fourth') return true;
  if (position === 'third') {
    if (leadCombo.hasTractor) return true;
    if (leadCombo.type === 'throw') return true;
    if (leadCombo.type === 'single' || leadCombo.type === 'pair') {
      const isTrumpLead = leadCombo.cards.every(c => isTrump(c, ctx));
      if (isTrumpLead) return isTrumpMax(leadCombo, ctx);
      return leadCombo.cards.every(c => isBigOffSuitCard(c, ctx));
    }
  }
  return false;
}

// ---- Pattern evaluation ----

/** Whether the lead combo is a max pattern — big card, tractor, or throw.
 *  Second position should avoid points when following such a lead. */
export function isMaxPattern(leadCombo: ComboClass, ctx: AIContext): boolean {
  if (leadCombo.hasTractor) return true;
  if (leadCombo.type === 'throw') return true;
  if (leadCombo.type === 'single' || leadCombo.type === 'pair') {
    const isTrumpLead = leadCombo.cards.every(c => isTrump(c, ctx));
    if (isTrumpLead) return isTrumpMax(leadCombo, ctx);
    if (leadCombo.type === 'single') return isBigOffSuitCard(leadCombo.cards[0], ctx);
    return leadCombo.cards.every(c => isBigOffSuitCard(c, ctx));
  }
  return false;
}

export function isTrumpMax(leadCombo: ComboClass, ctx: AIContext): boolean {
  if (leadCombo.cards.some(c => c.rank === Rank.BigJoker)) return true;
  if (leadCombo.cards.length === 2 && leadCombo.cards[0].rank === Rank.SmallJoker) {
    return sideHasBigJoker(ctx);
  }
  return false;
}

export function sideHasBigJoker(ctx: AIContext): boolean {
  if (ctx.myIndex < 0) return false;
  if (ctx.ntState) {
    const opponents = [0, 1, 2, 3].filter(p => p % 2 !== ctx.myIndex % 2);
    if (opponents.every(p => !ctx.ntState!.canHaveBigJoker[p])) return true;
    if (ctx.ntState!.allUnseenBigJokersOnOurSide) return true;
    return false;
  }
  const ourTeam = new Set([ctx.myIndex, (ctx.myIndex + 2) % 4]);
  for (const trick of ctx.trickHistory) {
    for (let pi = 0; pi < 4; pi++) {
      for (const c of trick.plays[pi].cards) {
        if (c.rank === Rank.BigJoker && ourTeam.has(pi)) return true;
      }
    }
  }
  for (const rev of ctx.reveals) {
    for (const c of rev.cards) {
      if (c.rank === Rank.BigJoker && ourTeam.has(rev.playerIndex)) return true;
    }
  }
  return false;
}

// ---- Tractor matching ----

export function tryMatchTractorSlots(
  leadCombo: ComboClass,
  myTractors: Card[][],
  cardPool: Card[],
  leadLen: number,
  ctx: AIContext,
  pointsStrategy?: 'add' | 'avoid',
): Card[] | null {
  const picked: Card[] = [];
  const usedIds = new Set<string>();

  for (const req of leadCombo.tractors.map(t => t.pairCount)) {
    const available = myTractors.filter(t =>
      t.every(c => !usedIds.has(c.id)) && t.length / 2 >= req,
    );
    if (available.length > 0) {
      available.sort((a, b) => {
        if (pointsStrategy === 'add') {
          const aPts = a.some(c => isPointRank(c.rank)) ? 0 : 100;
          const bPts = b.some(c => isPointRank(c.rank)) ? 0 : 100;
          if (aPts !== bPts) return aPts - bPts;
        } else if (pointsStrategy === 'avoid') {
          const aPts = a.some(c => isPointRank(c.rank)) ? 100 : 0;
          const bPts = b.some(c => isPointRank(c.rank)) ? 100 : 0;
          if (aPts !== bPts) return aPts - bPts;
        }
        return (a.length / 2) - (b.length / 2);
      });
      const sel = available[0].slice(0, req * 2);
      picked.push(...sel);
      sel.forEach(c => usedIds.add(c.id));
    }
  }

  if (picked.length === 0) return null;

  const remaining = cardPool.filter(c => !usedIds.has(c.id));
  // Fill remaining: pairs first, then singles (non-point priority)
  const remPairs = findAllPairs(remaining);
  remPairs.sort(pairSortAsc(ctx));
  const fill: Card[] = [];
  for (const p of remPairs) {
    if (picked.length + fill.length + 2 > leadLen) break;
    if (p.some(c => usedIds.has(c.id))) continue;
    fill.push(...p);
    p.forEach(c => usedIds.add(c.id));
  }
  const restSingles = remaining.filter(c => !usedIds.has(c.id));
  restSingles.sort((a, b) => {
    const aPts = isPointRank(a.rank) ? 100 : 0;
    const bPts = isPointRank(b.rank) ? 100 : 0;
    if (aPts !== bPts) return aPts - bPts;
    return getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx);
  });
  const need = leadLen - picked.length - fill.length;
  if (need > 0) fill.push(...restSingles.slice(0, need));

  return [...picked, ...fill];
}
