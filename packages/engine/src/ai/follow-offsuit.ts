/**
 * AI follow off-suit strategy — following off-suit leads, throwing,
 * and escalating to trump killing when void.
 */
import type { Card, ComboClass } from '../types.js';
import { isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { canBeat, maxCardT, discardSort } from './utils.js';
import { annotateReason } from './reason.js';
import {
  pairKillSort, discardNonTrump, canAddPoints, isMaxPattern, tryMatchTractorSlots,
  attackerNearThreshold,
} from './helpers.js';
import { trumpKill } from './follow-trump.js';

// ---- Follow off-suit lead ----

export function followOffSuit(
  leadSuitCards: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  trumpCards: Card[],
): { cards: Card[]; reason: string } {
  if (leadLen === 1) {
    return followOffSuitSingle(leadSuitCards, leadCombo, ctx, position, tmWin, trumpCards);
  }
  return followOffSuitMulti(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin);
}

function followOffSuitSingle(
  leadSuitCards: Card[],
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  trumpCards: Card[],
): { cards: Card[]; reason: string } {
  leadSuitCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));

  if (canAddPoints(tmWin, position, leadCombo, ctx)) {
    leadSuitCards.sort(discardSort(true, ctx));
    const cards = [leadSuitCards[0]];
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, 'add');
    return { cards, reason };
  }

  if (tmWin) {
    leadSuitCards.sort(discardSort(false, ctx));
    const cards = [leadSuitCards[0]];
    const intent = 'none';
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can't beat opponent - play smallest
  if (!canBeat([leadSuitCards[0]], ctx.bestSoFar, ctx)) {
    const crossThreshold = attackerNearThreshold(ctx);
    leadSuitCards.sort(crossThreshold ? discardSort(true, ctx) : discardSort(false, ctx));
    const cards = [leadSuitCards[0]];
    const shouldAvoid = !crossThreshold && ((position === 'fourth' && !tmWin)
      || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
      || (position === 'third' && !tmWin));
    const intent = shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can beat opponent - play smallest that beats, fourth prefers point cards
  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
    if (beaters.length > 0) {
      const fourthBeat = position === 'fourth' && !tmWin;
      if (fourthBeat) {
        // Fourth beating — prefer point cards
        const pointBeaters = beaters.filter(c => isPointRank(c.rank));
        if (pointBeaters.length > 0) {
          pointBeaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          const cards = [pointBeaters[0]];
          const reason = annotateReason('同花色出大', cards, leadSuitCards, trumpCards,
            leadCombo, 1, ctx, position, tmWin, false, 'beat_points');
          return { cards, reason };
        }
      }
      beaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      const cards = [beaters[0]];
      const intent = fourthBeat ? 'beat_points' : 'none';
      const reason = annotateReason('同花色出大', cards, leadSuitCards, trumpCards,
        leadCombo, 1, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
  }

  const cards = [leadSuitCards[0]];
  const reason = annotateReason('同花色出大', cards, leadSuitCards, trumpCards,
    leadCombo, 1, ctx, position, tmWin, false, 'none');
  return { cards, reason };
}

function followOffSuitMulti(
  leadSuitCards: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const myPairs = findAllPairs(leadSuitCards);

  // Tractor lead - try to match with tractor
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(leadSuitCards, ctx);
    if (myTractors.length > 0) {
      const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
      const shouldAvoidT = !addPoints
        && ((position === 'fourth' && !tmWin)
          || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
          || (position === 'third' && !tmWin));
      const ptsStrat = addPoints ? 'add' : (shouldAvoidT ? 'avoid' : undefined);

      myTractors.sort((a, b) => b.length - a.length);
      let picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx, ptsStrat);
      if (picked && !canBeat(picked, ctx.bestSoFar, ctx)) {
        // Sort by max rank descending to try finding a beating tractor
        myTractors.sort((a, b) => {
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
        const alt = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx, ptsStrat);
        if (alt && canBeat(alt, ctx.bestSoFar, ctx)) picked = alt;
      }
      if (picked) {
        const intent = addPoints ? 'add' : 'none';
        const beating = canBeat(picked, ctx.bestSoFar, ctx);
        const isThrow3 = leadCombo.type === 'throw';
        const baseReason = isThrow3 ? '垫同花色' : (beating ? '同花色出大' : '同花色出小');
        const reason = annotateReason(baseReason, picked, leadSuitCards, [],
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards: picked, reason };
      }
    }
    // No tractor - fill with pairs then singles
    if (myPairs.length > 0) {
      pairKillSort(myPairs, leadSuitCards, ctx);
      const chosen = myPairs.flat();
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
      const shouldAvoid = !addPoints
        && ((position === 'fourth' && !tmWin)
          || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
          || (position === 'third' && !tmWin));
      if (addPoints) {
        rest.sort(discardSort(true, ctx));
      } else if (shouldAvoid) {
        rest.sort(discardSort(false, ctx));
      } else {
        rest.sort((a, b) => a.rank - b.rank);
      }
      const cards = [...chosen, ...rest].slice(0, leadLen);
      const intent = addPoints ? 'add' : (shouldAvoid ? 'avoid' : 'none');
      const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
        leadCombo, leadLen, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
  }

  // Pair lead - match with pairs
  if (leadCombo.pairCount > 0 && myPairs.length >= leadCombo.pairCount) {
    pairKillSort(myPairs, leadSuitCards, ctx);
    let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    // If smallest pair(s) cannot beat, try finding a pair that can.
    // For fourth position that can beat, prefer point-card pairs.
    const pairBeats = canBeat(chosen, ctx.bestSoFar, ctx);
    if (!pairBeats) {
      const beatingPairs = myPairs.filter(p => canBeat(p, ctx.bestSoFar, ctx));
      if (beatingPairs.length >= leadCombo.pairCount) {
        const isFourth = position === 'fourth';
        beatingPairs.sort((a, b) => {
          if (isFourth) {
            const aPts = isPointRank(a[0].rank) ? 0 : 100;
            const bPts = isPointRank(b[0].rank) ? 0 : 100;
            if (aPts !== bPts) return aPts - bPts;
          }
          return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
        });
        chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
      }
    } else if (position === 'fourth') {
      // Fourth can beat — prefer point cards (用分牌盖)
      const pointBeating = myPairs.filter(p =>
        isPointRank(p[0].rank) && canBeat(p, ctx.bestSoFar, ctx));
      if (pointBeating.length >= leadCombo.pairCount) {
        pointBeating.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
        chosen = pointBeating.slice(0, leadCombo.pairCount).flat();
      }
    }
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const shouldAvoid = !addPoints
      && ((position === 'fourth' && !tmWin)
        || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx)));
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      if (addPoints) {
        rest.sort(discardSort(true, ctx));
      } else if (shouldAvoid) {
        rest.sort(discardSort(false, ctx));
      } else {
        rest.sort((a, b) => a.rank - b.rank);
      }
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    const cards = chosen.slice(0, leadLen);
    const beating = canBeat(cards, ctx.bestSoFar, ctx);
    const isThrow4 = leadCombo.type === 'throw';
    const baseReason = isThrow4 ? '垫同花色' : (beating ? '同花色出大' : '同花色出小');
    const intent = addPoints ? 'add' : shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, [],
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can't match pattern - play smallest
  if (canAddPoints(tmWin, position, leadCombo, ctx)) {
    leadSuitCards.sort(discardSort(true, ctx));
    const cards = leadSuitCards.slice(0, leadLen);
    const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
      leadCombo, leadLen, ctx, position, tmWin, false, 'add');
    return { cards, reason };
  }

  leadSuitCards.sort(discardSort(false, ctx));
  const cards = leadSuitCards.slice(0, leadLen);
  const thirdAvoid = position === 'third' && !tmWin;
  const fourthAvoid = position === 'fourth' && !tmWin;
  const secondAvoid = position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx);
  const intent = (thirdAvoid || fourthAvoid || secondAvoid) ? 'avoid' : 'none';
  const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
    leadCombo, leadLen, ctx, position, tmWin, false, intent);
  return { cards, reason };
}

// ---- Follow throw off-suit ----

export function followOffSuitThrow(
  hand: Card[],
  leadCards: Card[],
  leadSuitCards: Card[],
  trumpCards: Card[],
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  // Must follow suit first, then non-trump, then trump
  if (leadSuitCards.length >= leadLen) {
    // Try to match the throw's pattern (tractors, pairs) first
    const leadCombo = classifyCombo(leadCards, ctx);
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin, trumpCards);
  }

  if (leadSuitCards.length > 0) {
    // Partial suit follow
    const remaining = hand.filter(c => !leadSuitCards.includes(c));
    const nonTrump = remaining.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin, ctx));
    const trumps = remaining.filter(c => isTrump(c, ctx));
    trumps.sort(discardSort(!!tmWin, ctx));
    const fill = [...nonTrump, ...trumps].slice(0, leadLen - leadSuitCards.length);
    const cards = [...leadSuitCards, ...fill];
    const leadCombo = classifyCombo(leadCards, ctx);
    const baseReason = fill.some(c => isTrump(c, ctx))
      ? '同花色不够，垫主牌'
      : '同花色不够，垫其他花色';
    const shouldAvoid = ((position === 'fourth' && !tmWin)
      || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
      || (position === 'third' && !tmWin)) && !attackerNearThreshold(ctx);
    const intent = shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Void in lead suit - try to trump the throw.
  // But first: if teammate already wins and we can safely add points,
  // dump points instead of wasting trump.
  if (trumpCards.length >= leadLen) {
    const throwCombo = classifyCombo(leadCards, ctx);
    if (tmWin && canAddPoints(tmWin, position, throwCombo, ctx)) {
      const nonTrump = hand.filter(c => !isTrump(c, ctx));
      if (nonTrump.length >= leadLen) {
        nonTrump.sort(discardSort(true, ctx));
        const cards = nonTrump.slice(0, leadLen);
        const reason = annotateReason('垫牌', cards, [], trumpCards,
          throwCombo, leadLen, ctx, position, tmWin, false, 'add');
        return { cards, reason };
      }
    }
    return trumpKill(trumpCards, hand, leadCards, throwCombo, leadLen, ctx, position, tmWin);
  }

  // Not enough trump to kill — discard. Pass the throw combo for canAddPoints.
  const throwCombo = classifyCombo(leadCards, ctx);
  return discardNonTrump(hand, leadLen, ctx, position, tmWin, throwCombo);
}
