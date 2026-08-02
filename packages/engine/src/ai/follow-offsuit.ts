/**
 * AI follow off-suit strategy — following off-suit leads, throwing,
 * and escalating to trump killing when void.
 *
 * 分位置跟牌规格：第二家/第三家/第四家分别决策；lead（backward-compat）
 * 保留旧逻辑。
 */
import type { Card, ComboClass } from '../types.js';
import { Suit, isPointRank } from '../types.js';
import { isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { canBeat, maxCardT, discardSort, getTopOffSuitRank } from './utils.js';
import { annotateReason } from './reason.js';
import {
  pairKillSort, discardNonTrump, canAddPoints, isMaxPattern, tryMatchTractorSlots,
  attackerNearThreshold,
} from './helpers.js';
import { trumpKill, throwKillMode, rule1KillMode } from './follow-trump.js';
import {
  hasStrongFollowUp, minEff, maxEff, pickDiscards, selectFillers,
  secondShouldAvoid, shouldBreakPairForPoints, pickBestAddCards,
  type DiscardMode,
} from './position-policy.js';

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
  hand: Card[],
): { cards: Card[]; reason: string } {
  if (leadLen === 1) {
    return followOffSuitSingle(leadSuitCards, leadCombo, ctx, position, tmWin, trumpCards, hand);
  }
  return followOffSuitMulti(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin, hand);
}

/** 当前最大牌的有效大小（无 bestSoFar 时视为可盖）。 */
function currentMaxRank(ctx: AIContext): number {
  const bs = ctx.bestSoFar;
  if (bs && bs.cards.length > 0) {
    return Math.max(...bs.cards.map(c => getEffectiveRank(c, ctx)));
  }
  return -1;
}

/** 该牌是否来自一个对子（同 suit+rank 至少两张）。 */
function breaksPair(card: Card, cards: Card[]): boolean {
  return cards.filter(x => x.suit === card.suit && x.rank === card.rank).length >= 2;
}

/** 垫牌/填充类别模式：按位置与手牌数选择。
 *  第三家领出（队友）大但不可加分时，垫牌分非分一视同仁（open）。 */
function fillMode(position: string, tmWin: boolean, hand: Card[], leadCombo: ComboClass, ctx: AIContext): DiscardMode {
  if (position === 'second') return secondShouldAvoid(hand) ? 'avoid' : 'open';
  if (tmWin && canAddPoints(tmWin, position, leadCombo, ctx)) {
    return (ctx.isAttacker && attackerNearThreshold(ctx)) ? 'full' : 'add';
  }
  if (position === 'third' && tmWin) return 'open';
  if (position === 'third' || position === 'fourth') return 'avoid';
  return 'open';
}

function followOffSuitSingle(
  leadSuitCards: Card[],
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  trumpCards: Card[],
  hand: Card[],
): { cards: Card[]; reason: string } {
  leadSuitCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
  const bestRank = currentMaxRank(ctx);

  // ---- Second position（第1条）----
  if (position === 'second') {
    const avoid = secondShouldAvoid(hand);
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
    if (beaters.length > 0) {
      // 能盖过：最小牌盖过；避分时非分优先；只有对子时拆最大对
      const beatSingles = beaters.filter(c => !breaksPair(c, leadSuitCards));
      let chosen: Card;
      if (beatSingles.length > 0) {
        chosen = avoid
          ? (beatSingles.some(c => !isPointRank(c.rank))
              ? minEff(beatSingles.filter(c => !isPointRank(c.rank)), ctx)
              : minEff(beatSingles, ctx))
          : minEff(beatSingles, ctx);
      } else {
        chosen = maxEff(beaters, ctx);
      }
      const cards = [chosen];
      const reason = annotateReason('同花色出大', cards, leadSuitCards, trumpCards,
        leadCombo, 1, ctx, position, tmWin, false, 'none');
      return { cards, reason };
    }
    // 盖不过：出最小；避分时非分优先；只有对子时拆最小对
    const singles = leadSuitCards.filter(c => !breaksPair(c, leadSuitCards));
    let chosen: Card;
    if (singles.length > 0) {
      chosen = avoid
        ? (singles.some(c => !isPointRank(c.rank))
            ? minEff(singles.filter(c => !isPointRank(c.rank)), ctx)
            : minEff(singles, ctx))
        : minEff(singles, ctx);
    } else {
      chosen = avoid
        ? (leadSuitCards.some(c => !isPointRank(c.rank))
            ? minEff(leadSuitCards.filter(c => !isPointRank(c.rank)), ctx)
            : minEff(leadSuitCards, ctx))
        : minEff(leadSuitCards, ctx);
    }
    const cards = [chosen];
    const intent = avoid ? 'avoid' : 'none';
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // ---- Third position（第1条/第2条）----
  if (position === 'third') {
    const leadIsTop = isBigOffSuitCardLocal(leadCombo.cards[0], ctx);
    const overkill = !!(ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isTrump(c, ctx)));
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, ctx) > bestRank);

    if (tmWin && leadIsTop) {
      // 第1条：领出顶张单张、第二家没毙 → 优先加副牌分（不拆对），没分出最小副牌；
      // 庄家方 70/75 禁分等不可加分时出最小副牌
      const addOk = canAddPoints(tmWin, position, leadCombo, ctx);
      const cards = addOk
        ? pickDiscards(leadSuitCards, 1, ctx, 'add')
        : pickDiscards(leadSuitCards, 1, ctx, 'avoid');
      const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
        leadCombo, 1, ctx, position, tmWin, false, addOk ? 'add' : 'avoid');
      return { cards, reason };
    }
    if (overkill) {
      // 第二家毙了：不能盖毙 → 出最小副牌且不加分
      const cards = [minEff(leadSuitCards, ctx)];
      const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
        leadCombo, 1, ctx, position, tmWin, false, 'avoid');
      return { cards, reason };
    }
    if (beaters.length > 0) {
      // 第2条：能盖过领出和第二家 → 出最大牌（顶张是对可拆对，其他情况不拆对）
      const cards = [pickThirdBeating(beaters, leadSuitCards, ctx)];
      const reason = annotateReason('同花色出大', cards, leadSuitCards, trumpCards,
        leadCombo, 1, ctx, position, tmWin, false, 'none');
      return { cards, reason };
    }
    // 盖不过：出最小（不加分）
    const cards = [minEff(leadSuitCards, ctx)];
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, 'avoid');
    return { cards, reason };
  }

  // ---- Fourth / lead fallback（保留现逻辑）----
  if (canAddPoints(tmWin, position, leadCombo, ctx)) {
    leadSuitCards.sort(discardSort(true, ctx, leadSuitCards, ctx));
    const cards = [leadSuitCards[0]];
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, 'add');
    return { cards, reason };
  }

  if (tmWin) {
    leadSuitCards.sort(discardSort(false, ctx));
    const cards = [leadSuitCards[0]];
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, 'none');
    return { cards, reason };
  }

  // Can't beat opponent - play smallest
  if (!canBeat([leadSuitCards[0]], ctx.bestSoFar, ctx)) {
    const crossThreshold = attackerNearThreshold(ctx);
    leadSuitCards.sort(crossThreshold ? discardSort(true, ctx, leadSuitCards, ctx) : discardSort(false, ctx));
    const cards = [leadSuitCards[0]];
    const shouldAvoid = !crossThreshold && ((position === 'fourth' && !tmWin)
      || (position === 'third' && !tmWin));
    const intent = shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason('同花色出小', cards, leadSuitCards, trumpCards,
      leadCombo, 1, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can beat opponent - play smallest that beats, fourth prefers point cards
  if (ctx.bestSoFar && ctx.bestSoFar.cards.length > 0) {
    const bestRankL = Math.max(...ctx.bestSoFar.cards.map(c => getEffectiveRank(c, ctx)));
    const beaters = leadSuitCards.filter(c => getEffectiveRank(c, ctx) > bestRankL);
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

/** 顶张判定（A，A为等级时K）。 */
function isBigOffSuitCardLocal(card: Card, ctx: AIContext): boolean {
  return card.rank === getTopOffSuitRank(card.suit as Suit, ctx);
}

/**
 * 第三家第2条：出最大牌；顶张是对可拆对，其他情况不拆对（不看分）。
 * 所有能盖的牌都来自非顶张对时视为盖不过，返回最小能盖的（拆最小对兜底）。
 */
function pickThirdBeating(beaters: Card[], leadSuitCards: Card[], ctx: AIContext): Card {
  const sorted = [...beaters].sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
  for (const c of sorted) {
    if (!breaksPair(c, leadSuitCards)) return c;
  }
  // 全是对子成员：顶张（该花色最大非主牌）成对可拆
  const top = getTopOffSuitRank(sorted[0].suit as Suit, ctx);
  const topCard = sorted.find(c => c.rank === top);
  if (topCard) return topCard;
  return sorted[sorted.length - 1];
}

function followOffSuitMulti(
  leadSuitCards: Card[],
  leadCards: Card[],
  leadLen: number,
  leadCombo: ComboClass,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  hand: Card[],
): { cards: Card[]; reason: string } {
  const myPairs = findAllPairs(leadSuitCards);
  const seize = position === 'second' || position === 'third';
  // 第三家领出更大（队友大）且无强牌 → 不盖（出最小）
  const thirdNoSeize = position === 'third' && tmWin && !hasStrongFollowUp(hand, ctx);

  // Tractor lead - try to match with tractor
  if (leadCombo.hasTractor) {
    const myTractors = detectTractors(leadSuitCards, ctx);
    if (myTractors.length > 0) {
      const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
      const shouldAvoidT = !addPoints
        && ((position === 'fourth' && !tmWin)
          || (position === 'second' && secondShouldAvoid(hand))
          || (position === 'third' && !tmWin));
      const ptsStrat = addPoints ? 'add' : (shouldAvoidT ? 'avoid' : undefined);

      myTractors.sort((a, b) => {
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      let picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx, ptsStrat);
      if (seize && !thirdNoSeize) {
        // 第二/三家：能盖就盖最大；最大盖不过 → 出最小
        myTractors.sort((a, b) => {
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
        picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx, ptsStrat);
        if (picked && !canBeat(picked, ctx.bestSoFar, ctx)) {
          myTractors.sort((a, b) => {
            const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
            const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
            return aMax - bMax;
          });
          picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx, ptsStrat);
        }
      } else if (seize && thirdNoSeize) {
        // 第三家领出更大且无强牌：不盖，出最小匹配
        picked = tryMatchTractorSlots(leadCombo, myTractors, leadSuitCards, leadLen, ctx, ptsStrat);
      } else if (picked && !canBeat(picked, ctx.bestSoFar, ctx)) {
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
      const mode = fillMode(position, tmWin, hand, leadCombo, ctx);
      const cards = [...chosen, ...pickDiscards(rest, leadLen - chosen.length, ctx, mode,
        { allowBreakPair: shouldBreakPairForPoints(ctx, leadCombo) })]
        .slice(0, leadLen);
      const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
      const intent = addPoints ? 'add' : 'none';
      const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
        leadCombo, leadLen, ctx, position, tmWin, false, intent);
      return { cards, reason };
    }
  }

  // Pair lead / throw-with-pairs - include available pairs.
  if (leadCombo.pairCount > 0 && myPairs.length > 0) {
    pairKillSort(myPairs, leadSuitCards, ctx);
    let chosen: Card[];
    if (thirdNoSeize) {
      // 第三家领出更大且无强牌：不盖，出最小对
      myPairs.sort((a, b) =>
        getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
      chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    } else {
      if (seize) {
        // 第二/三家：能盖就盖最大；最大盖不过 → 出最小
        myPairs.sort((a, b) =>
          getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx));
      }
      chosen = myPairs.slice(0, leadCombo.pairCount).flat();
      const pairBeats = canBeat(chosen, ctx.bestSoFar, ctx);
      if (!pairBeats && !seize) {
        // 找能盖过的对子（第四家能盖时优先分牌对）
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
      } else if (!pairBeats && seize) {
        myPairs.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
        chosen = myPairs.slice(0, leadCombo.pairCount).flat();
      } else if (position === 'fourth' && pairBeats) {
        // Fourth can beat — prefer point cards（用分牌盖）
        const pointBeating = myPairs.filter(p =>
          isPointRank(p[0].rank) && canBeat(p, ctx.bestSoFar, ctx));
        if (pointBeating.length >= leadCombo.pairCount) {
          pointBeating.sort((a, b) =>
            getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
          chosen = pointBeating.slice(0, leadCombo.pairCount).flat();
        }
      }
    }
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = leadSuitCards.filter(c => !used.has(c.id));
      const mode = fillMode(position, tmWin, hand, leadCombo, ctx);
      chosen.push(...pickDiscards(rest, leadLen - chosen.length, ctx, mode,
        { allowBreakPair: shouldBreakPairForPoints(ctx, leadCombo) }));
    }
    const cards = chosen.slice(0, leadLen);
    const beating = canBeat(cards, ctx.bestSoFar, ctx);
    const isThrow4 = leadCombo.type === 'throw';
    const baseReason = isThrow4 ? '垫同花色' : (beating ? '同花色出大' : '同花色出小');
    // 4th position should only avoid if we CANNOT beat (otherwise we're winning)
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const shouldAvoid = !addPoints
      && ((position === 'fourth' && !tmWin && !beating)
        || (position === 'second' && secondShouldAvoid(hand))
        || (position === 'third' && !tmWin && !beating));
    const intent = addPoints ? 'add' : shouldAvoid ? 'avoid' : 'none';
    const reason = annotateReason(baseReason, cards, leadSuitCards, [],
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Can't match pattern - play smallest
  if (canAddPoints(tmWin, position, leadCombo, ctx)) {
    leadSuitCards.sort(discardSort(true, ctx, leadSuitCards, ctx));
    const cards = leadSuitCards.slice(0, leadLen);
    const reason = annotateReason('垫同花色', cards, leadSuitCards, [],
      leadCombo, leadLen, ctx, position, tmWin, false, 'add');
    return { cards, reason };
  }

  const mode = fillMode(position, tmWin, hand, leadCombo, ctx);
  const cards = pickDiscards(leadSuitCards, leadLen, ctx, mode);
  const thirdAvoid = position === 'third' && !tmWin;
  const fourthAvoid = position === 'fourth' && !tmWin;
  const secondAvoid = position === 'second' && secondShouldAvoid(hand);
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
    return followOffSuit(leadSuitCards, leadCards, leadLen, leadCombo, ctx, position, tmWin, trumpCards, hand);
  }

  if (leadSuitCards.length > 0) {
    // Partial suit follow
    const remaining = hand.filter(c => !leadSuitCards.includes(c));
    const needed = leadLen - leadSuitCards.length;
    const leadCombo = classifyCombo(leadCards, ctx);
    const mode = fillMode(position, tmWin, hand, leadCombo, ctx);
    const fill = selectFillers(remaining, needed, ctx, mode,
      { allowBreakPair: shouldBreakPairForPoints(ctx, leadCombo) });
    const cards = [...leadSuitCards, ...fill];
    const baseReason = fill.some(c => isTrump(c, ctx))
      ? '同花色不够，垫主牌'
      : '同花色不够，垫其他花色';
    const shouldAvoid = mode === 'avoid';
    const addPts = mode === 'add' || mode === 'full';
    const intent = shouldAvoid ? 'avoid' : (addPts ? 'add' : 'none');
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
      // 垫分（加分）：第三家/第四家按加分优先级选牌（第三家有副牌垫副牌，
      // 全主才出主牌；第四家全手选，可含主牌=毙加分；闲家跨 40 台阶全力加分）
      const cards = pickBestAddCards(hand, leadLen, throwCombo, ctx);
      const reason = annotateReason('垫牌', cards, [], trumpCards,
        throwCombo, leadLen, ctx, position, tmWin, false, 'add');
      return { cards, reason };
    }
    const killMode = throwKillMode(throwCombo, ctx, leadCards);
    return trumpKill(trumpCards, hand, leadCards, throwCombo, leadLen, ctx, position, tmWin,
      { killMode });
  }

  // Not enough trump to kill — discard. Pass the throw combo for canAddPoints.
  const throwCombo = classifyCombo(leadCards, ctx);
  return discardNonTrump(hand, leadLen, ctx, position, tmWin, throwCombo);
}
