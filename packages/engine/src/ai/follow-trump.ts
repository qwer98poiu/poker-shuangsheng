/**
 * AI follow-trump strategy — following trump leads, trump killing, and
 * NT (no-trump) trump following.
 */
import type { Card, ComboClass } from '../types.js';
import { Rank, Suit, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors } from '../pattern/index.js';
import { compareTwo, matchPattern } from '../comparing/index.js';
import type { AIContext } from './types.js';
import { canBeat, maxCardT, discardSort } from './utils.js';
import { isOnlyLegalPlay } from '../following/index.js';
import { findThrowableOffSuitCombos } from './throw-detector.js';
import { annotateReason } from './reason.js';
import {
  pairKillSort, discardNonTrump, padWithDiscards,
  canAddPoints, isMaxPattern, tryMatchTractorSlots,
} from './helpers.js';

// ---- Follow trump lead ----

export function followTrumpLead(
  hand: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const leadLen = leadCards.length;
  const myTrump = hand.filter(c => isTrump(c, ctx));

  // Fast path: only one legal play — skip strategy, play forced cards.
  if (myTrump.length === leadLen && isOnlyLegalPlay(myTrump, leadLen, leadCombo, ctx)) {
    const sorted = [...myTrump].sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    const cards = sorted.slice(0, leadLen);
    let baseReason: string;
    if (!matchPattern(leadCards, cards, ctx)) {
      baseReason = '垫同花色';
    } else {
      const bestCards = ctx.bestSoFar ? ctx.bestSoFar.cards : leadCards;
      const beating = compareTwo(bestCards, cards, leadCards, ctx) === 'second';
      baseReason = beating ? '同花色出大' : '同花色出小';
    }
    const reason = annotateReason(baseReason, cards, myTrump, myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, 'none');
    return { cards, reason };
  }

  // NT special handling for trump follow
  if (ctx.trumpSuit === null && ctx.ntState) {
    return followNTTrumpLead(hand, leadCards, leadLen, leadCombo, ctx, position, tmWin);
  }

  // Use bestSoFar's max rank (not leadMax) — someone may have already beaten the lead.
  const bs = ctx.bestSoFar;
  const currentMax = bs && bs.cards.length > 0
    ? Math.max(...bs.cards.map(c => getEffectiveRank(c, ctx)))
    : Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));

  if (leadLen === 1) {
    // Single trump lead
    if (myTrump.length > 0) {
      const canBeatCards = myTrump.filter(c => getEffectiveRank(c, ctx) > currentMax);
      if (canBeatCards.length > 0) {
        // Second position: generally play small unless can seize lead
        if (position === 'second') {
          const hasTractor = detectTractors(hand, ctx).length > 0;
          const throwResult = findThrowableOffSuitCombos(hand, ctx);
          const hasThrow = (throwResult?.cards.length ?? 0) > 0;
          if (!hasTractor && !hasThrow) {
            myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
            return { cards: [myTrump[0]], reason: '同花色出小' };
          }
          // Has tractor/throw → seize lead
          if (hasTractor) {
            canBeatCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
          } else {
            const aceRank = getEffectiveRank(
              { suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
            const bigBeaters = canBeatCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
            if (bigBeaters.length > 0) {
              bigBeaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
              const cards = [bigBeaters[0]];
              const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
                leadCombo, 1, ctx, position, tmWin, false, 'none');
              return { cards, reason };
            }
            canBeatCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
          }
          const cards = [canBeatCards[0]];
          const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
            leadCombo, 1, ctx, position, tmWin, false, 'none');
          return { cards, reason };
        }

        // Non-second position: has points → biggest; no points → ≥A or biggest
        const hasPoints = leadCards.some(c => isPointRank(c.rank))
          || (ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank)));
        if (hasPoints) {
          canBeatCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
        } else {
          const aceRank = getEffectiveRank(
            { suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
          const bigBeaters = canBeatCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
          if (bigBeaters.length > 0) {
            bigBeaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
            const cards = [bigBeaters[0]];
            const fourthBeat = position === 'fourth' && !tmWin;
            const intent = fourthBeat ? 'beat_points' : 'none';
            const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
              leadCombo, 1, ctx, position, tmWin, false, intent);
            return { cards, reason };
          }
          canBeatCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
        }
        const cards = [canBeatCards[0]];
        const fourthBeat = position === 'fourth' && !tmWin;
        const intent = hasPoints ? 'none'
          : (tmWin && canAddPoints(tmWin, position, leadCombo, ctx)) ? 'add'
          : fourthBeat ? 'beat_points' : 'none';
        const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
          leadCombo, 1, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
      const shouldAvoid = (position === 'fourth' && !tmWin)
        || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
        || (position === 'third' && !tmWin);
      const addPoints = !shouldAvoid && canAddPoints(tmWin, position, leadCombo, ctx);
      if (addPoints) {
        myTrump.sort(discardSort(true, ctx));
      } else if (shouldAvoid) {
        myTrump.sort(discardSort(false, ctx));
      } else {
        myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      }
      const cards = [myTrump[0]];
      const intent = shouldAvoid ? 'avoid' : (addPoints ? 'add' : 'none');
      const reason = annotateReason('同花色出小', cards, myTrump, myTrump,
        leadCombo, 1, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
    // No trump - discard
    const nonTrump = hand.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin, ctx));
    return { cards: [nonTrump[0] || hand[0]], reason: '垫牌' };
  }

  // Multi-card trump lead - match pattern
  if (myTrump.length >= leadLen) {
    return matchTrumpPattern(myTrump, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  // Not enough trump - pad with discards
  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin, position, leadCombo);
}

export function matchTrumpPattern(
  myTrump: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  // Already fully covered: try to use smallest matching pattern
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(myTrump, ctx);
    if (myTractors.length > 0) {
      const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
      const shouldAvoidT = !addPoints
        && ((position === 'fourth' && !tmWin)
          || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
          || (position === 'third' && !tmWin));
      const ptsStrat = addPoints ? 'add' : (shouldAvoidT ? 'avoid' : undefined);

      myTractors.sort((a, b) => {
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      let picked = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx, ptsStrat);
      if (picked && !canBeat(picked, ctx.bestSoFar, ctx)) {
        // Sort biggest-first to try finding a beating tractor
        myTractors.sort((a, b) => {
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
        const alt = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx, ptsStrat);
        if (alt && canBeat(alt, ctx.bestSoFar, ctx)) picked = alt;
      }
      if (picked) {
        const intent = addPoints ? 'add' : 'none';
        const beating = canBeat(picked, ctx.bestSoFar, ctx);
        const isThrow = leadCombo.type === 'throw';
        const baseReason = isThrow ? '垫同花色' : (beating ? '同花色出大' : '同花色出小');
        const reason = annotateReason(baseReason, picked, [], myTrump,
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards: picked, reason };
      }
    }
    // No tractor - fill with smallest pairs then singles
    const pairs = findAllPairs(myTrump);
    pairKillSort(pairs, myTrump, ctx);
    const chosen = pairs.flat();
    const used = new Set(chosen.map(c => c.id));
    const rest = myTrump.filter(c => !used.has(c.id));
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    const cards = [...chosen, ...rest].slice(0, leadLen);
    const intent = addPoints ? 'add' : 'none';
    const reason = annotateReason('垫同花色', cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(myTrump); pairKillSort(myPairs, myTrump, ctx);
    // Has points in trick → use biggest pair to beat
    const hasPoints = (ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank)))
      || leadCards.some(c => isPointRank(c.rank));
    if (hasPoints) myPairs.sort((a, b) =>
      getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx));
    let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    // If pair(s) cannot beat, try finding a pair that can.
    // For fourth position that can beat, prefer point-card pairs.
    const pairBeating = canBeat(chosen, ctx.bestSoFar, ctx);
    if (!pairBeating) {
      const beatingPairs = myPairs.filter(p => canBeat(p, ctx.bestSoFar, ctx));
      if (beatingPairs.length >= leadCombo.pairCount) {
        const isFourth = position === 'fourth';
        beatingPairs.sort((a, b) => {
          if (isFourth) {
            const aPts = isPointRank(a[0].rank) ? 0 : 100;
            const bPts = isPointRank(b[0].rank) ? 0 : 100;
            if (aPts !== bPts) return aPts - bPts;
          }
          if (hasPoints) return getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx);
          return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
        });
        chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
      }
    } else if (position === 'fourth') {
      // Fourth can beat — prefer point cards
      const pointBeating = myPairs.filter(p =>
        isPointRank(p[0].rank) && canBeat(p, ctx.bestSoFar, ctx));
      if (pointBeating.length >= leadCombo.pairCount) {
        pointBeating.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
        chosen = pointBeating.slice(0, leadCombo.pairCount).flat();
      }
    }
    const shouldAvoid = (position === 'fourth' && !tmWin)
      || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
      || (position === 'third' && !tmWin);
    const addPt = tmWin && canAddPoints(tmWin, position, leadCombo, ctx);
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = myTrump.filter(c => !used.has(c.id));
      rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    const cards = chosen.slice(0, leadLen);
    const formsPair = findAllPairs(cards).length >= leadCombo.pairCount;
    let baseReason: string;
    if (leadCombo.type === 'throw') {
      baseReason = '垫同花色';
    } else if (!formsPair && leadCombo.pairCount > 0) {
      baseReason = '垫同花色';
    } else {
      const beating = canBeat(cards, ctx.bestSoFar, ctx);
      baseReason = beating ? '同花色出大' : '同花色出小';
    }
    const intent = addPt ? 'add' : (shouldAvoid ? 'avoid' : 'none');
    const reason = annotateReason(baseReason, cards, myTrump, myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Pure singles: play smallest trump
  const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
  if (addPoints) {
    myTrump.sort(discardSort(true, ctx));
  } else {
    myTrump.sort(discardSort(false, ctx));
  }
  const cards2 = myTrump.slice(0, leadLen);
  const intent2 = addPoints ? 'add' : 'none';
  const reason2 = annotateReason('垫同花色', cards2, [], myTrump,
    leadCombo, leadLen, ctx, position, tmWin, false, intent2);
  return { cards: cards2, reason: reason2 };
}

// ---- Trump kill ----

/** Check whether our trump kill actually beats the current best play. */
function canTrumpKillBeat(killCards: Card[], leadCards: Card[], ctx: AIContext): boolean {
  const bs = ctx.bestSoFar;
  if (!bs || bs.cards.length === 0) return true;
  if (!bs.cards.some(c => isTrump(c, ctx))) return true;
  return compareTwo(bs.cards, killCards, leadCards, ctx) === 'second';
}

/** Whether someone before us has already killed with trump — we must overkill. */
function isOverkill(ctx: AIContext): boolean {
  const bs = ctx.bestSoFar;
  return !!(bs && bs.cards.length > 0 && bs.cards.some(c => isTrump(c, ctx)));
}

function trumpKillSingle(
  trumpCards: Card[],
  nonTrump: Card[],
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  hasPoints: boolean,
): { cards: Card[]; reason: string } {
  const overkill = isOverkill(ctx);

  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    if (overkill) {
      const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
      const canBeatCards = trumpCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
      if (canBeatCards.length > 0) {
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        return { cards: [canBeatCards[0]], reason: '盖毙' };
      }
      if (nonTrump.length > 0) {
        nonTrump.sort(discardSort(!!tmWin, ctx));
        return { cards: [nonTrump[0]], reason: '盖不过，垫副牌' };
      }
      return { cards: [trumpCards[0]], reason: '盖不过，垫主牌' };
    }
    // bestSoFar is off-suit — first kill
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    if (hasPoints) {
      const aceRank = getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
      const big = trumpCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
      if (big.length > 0) return { cards: [big[0]], reason: '用主牌毙' };
      return { cards: [trumpCards[trumpCards.length - 1]], reason: '用主牌毙' };
    }
    return { cards: [trumpCards[0]], reason: '用主牌毙' };
  }

  // No best yet — smallest trump kills
  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  if (hasPoints) {
    const aceRank = getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
    const big = trumpCards.filter(c => getEffectiveRank(c, ctx) >= aceRank);
    if (big.length > 0) return { cards: [big[0]], reason: '用主牌毙' };
    return { cards: [trumpCards[trumpCards.length - 1]], reason: '用主牌毙' };
  }
  return { cards: [trumpCards[0]], reason: '用主牌毙' };
}

export function trumpKill(
  trumpCards: Card[],
  hand: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const nonTrump = hand.filter(c => !isTrump(c, ctx));

  const hasPoints = leadCards.some(c => isPointRank(c.rank))
    || (ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank))) || false;

  if (leadLen === 1) {
    return trumpKillSingle(trumpCards, nonTrump, ctx, position, tmWin, hasPoints);
  }

  const overkill = isOverkill(ctx);

  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(trumpCards, ctx);
    if (myTractors.length > 0) {
      myTractors.sort((a, b) => {
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      if (hasPoints && !overkill) myTractors.reverse();
      let picked = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx);
      if (picked && !canTrumpKillBeat(picked, leadCards, ctx)) {
        myTractors.reverse();
        const alt = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx);
        if (alt && canTrumpKillBeat(alt, leadCards, ctx)) picked = alt;
      }
      if (picked && canTrumpKillBeat(picked, leadCards, ctx)) {
        const reason = overkill ? '盖毙' : '用主牌毙';
        return { cards: picked, reason };
      }
    }
    return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(trumpCards);
    pairKillSort(myPairs, trumpCards, ctx);
    if (hasPoints && !overkill) myPairs.reverse();
    if (myPairs.length >= leadCombo.pairCount) {
      let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
      if (!canTrumpKillBeat(chosen, leadCards, ctx)) {
        const beatingPairs = myPairs.filter(p => canTrumpKillBeat(p, leadCards, ctx));
        if (beatingPairs.length >= leadCombo.pairCount) {
          beatingPairs.sort((a, b) =>
            getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
          if (hasPoints && !overkill) beatingPairs.reverse();
          chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
        }
      }
      if (!canTrumpKillBeat(chosen, leadCards, ctx)) {
        return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
      }
      if (chosen.length === leadLen) {
        const reason = overkill ? '盖毙' : '用主牌毙';
        return { cards: chosen, reason };
      }
      const used = new Set(chosen.map(c => c.id));
      const rest = trumpCards.filter(c => !used.has(c.id));
      rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      const result = [...chosen, ...rest.slice(0, leadLen - chosen.length)];
      if (canTrumpKillBeat(result, leadCards, ctx)) {
        const reason = overkill ? '盖毙' : '用主牌毙';
        return { cards: result, reason };
      }
      return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
    }
    return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
  }

  // Pure singles
  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  let killKeyIdx = -1;
  if (hasPoints && !overkill) {
    const aceRank = getEffectiveRank({ suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
    for (let i = 0; i < trumpCards.length; i++) {
      if (getEffectiveRank(trumpCards[i], ctx) >= aceRank) {
        killKeyIdx = i;
        break;
      }
    }
    if (killKeyIdx < 0) killKeyIdx = trumpCards.length - 1;
  } else {
    if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
      const bestRank = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
      for (let i = 0; i < trumpCards.length; i++) {
        if (getEffectiveRank(trumpCards[i], ctx) > bestRank) {
          killKeyIdx = i;
          break;
        }
      }
    }
    if (killKeyIdx < 0) killKeyIdx = 0;
  }
  const kill: Card[] = [trumpCards[killKeyIdx]];
  for (let i = 0; i < trumpCards.length && kill.length < leadLen; i++) {
    if (i === killKeyIdx) continue;
    kill.push(trumpCards[i]);
  }
  if (canTrumpKillBeat(kill, leadCards, ctx)) {
    const reason = overkill ? '盖毙' : '用主牌毙';
    return { cards: kill, reason };
  }
  return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
}

// ---- Follow trump throw ----

export function followTrumpThrow(
  hand: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const trump = hand.filter(c => isTrump(c, ctx));
  if (trump.length >= leadLen) {
    trump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    const cards = trump.slice(0, leadLen);
    const reason = annotateReason('同花色出小', cards, [], trump,
      leadCombo, leadLen, ctx, position, tmWin, false, 'none');
    return { cards, reason };
  }
  return padWithDiscards(hand, trump, leadLen, ctx, tmWin, position, leadCombo);
}

// ---- NT trump follow ----

export function followNTTrumpLead(
  hand: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  const myTrump = hand.filter(c => isTrump(c, ctx));
  const bs = ctx.bestSoFar;
  const currentMax = bs && bs.cards.length > 0
    ? Math.max(...bs.cards.map(c => getEffectiveRank(c, ctx)))
    : Math.max(...leadCards.map(c => getEffectiveRank(c, ctx)));

  if (leadLen === 1) {
    if (myTrump.length > 0) {
      const canBeatCards = myTrump.filter(c => getEffectiveRank(c, ctx) > currentMax);
      if (canBeatCards.length > 0) {
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [canBeatCards[0]];
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
          leadCombo, 1, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
      const shouldAvoid = (position === 'fourth' && !tmWin)
        || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
        || (position === 'third' && !tmWin);
      const addPts = !shouldAvoid && tmWin && canAddPoints(tmWin, position, leadCombo, ctx);
      if (addPts) {
        myTrump.sort(discardSort(true, ctx));
      } else if (shouldAvoid) {
        myTrump.sort(discardSort(false, ctx));
      } else {
        myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      }
      const cards = [myTrump[0]];
      const intent = shouldAvoid ? 'avoid' : (addPts ? 'add' : 'none');
      const reason = annotateReason('同花色出小', cards, myTrump, myTrump,
        leadCombo, 1, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
    const nonTrump = hand.filter(c => !isTrump(c, ctx));
    nonTrump.sort(discardSort(!!tmWin, ctx));
    return { cards: [nonTrump[0] || hand[0]], reason: '垫牌' };
  }

  // Multi-card NT trump lead
  if (myTrump.length >= leadLen) {
    if (leadCombo.pairCount > 0 || leadCombo.hasTractor) {
      const myPairs = findAllPairs(myTrump);
      if (myPairs.length > 0) {
        pairKillSort(myPairs, myTrump, ctx);
        const neededPairs = Math.min(myPairs.length, leadCombo.pairCount);
        const used = myPairs.slice(0, neededPairs).flat();
        const usedIds = new Set(used.map(c => c.id));
        const rest = myTrump.filter(c => !usedIds.has(c.id));
        rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [...used, ...rest].slice(0, leadLen);
        const beating = canBeat(cards, ctx.bestSoFar, ctx);
        const baseReason = beating ? '同花色出大' : '同花色出小';
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const reason = annotateReason(baseReason, cards, [], myTrump,
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
    }
    // No pattern to match — smallest N trump
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const sorted = [...myTrump];
    if (addPoints) {
      sorted.sort(discardSort(true, ctx));
    } else {
      sorted.sort(discardSort(false, ctx));
    }
    const cards = sorted.slice(0, leadLen);
    const intent = addPoints ? 'add' : 'none';
    const reason = annotateReason('垫同花色', cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin, position, leadCombo);
}
