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
  attackerNearThreshold,
} from './helpers.js';
import {
  hasStrongFollowUp, visibleTrickPoints, leadHasPoints, defense80,
  pickDiscards, secondShouldAvoid, minEff, maxEff,
  unitize, catOf,
} from './position-policy.js';

// ---- Kill mode ----

/** 毙牌力度：auto=现行为（最小毙/有分>=A或最大/盖毙最小能盖）；
 *  max=最大主牌毙；a-or-max=不小于A的最小主牌毙（没有则最大）。 */
export type KillMode = 'auto' | 'max' | 'a-or-max';

/** 主牌 A 的有效大小阈值。 */
function aceEff(ctx: AIContext): number {
  return getEffectiveRank(
    { suit: ctx.trumpSuit ?? Suit.Spades, rank: Rank.Ace, isJoker: false, id: '' } as Card, ctx);
}

/** 第二家避分时主牌单张的垫出优先级：小非分(0) < 级牌常主(1) < 分牌(2) < 主A/王保底(3)。
 *  垫分牌损失分，垫 A/王损失控制力——宁垫分牌保 A/王。 */
function trumpDumpKey(c: Card, ctx: AIContext): number {
  if (isPointRank(c.rank)) return 2;
  if (getEffectiveRank(c, ctx) >= aceEff(ctx)) return 3;
  return c.rank === ctx.level ? 1 : 0;
}


/** 毙牌选牌的分牌值：10>K>5（级牌除外——常主只在跨 40 分台阶时出）。 */
function killPointVal(c: Card, ctx: AIContext): number {
  return c.rank === ctx.level ? 0
    : (c.rank === Rank.Ten ? 10 : (c.rank === Rank.King || c.rank === Rank.Five ? 5 : 0));
}

/** 毙牌排序：分最多优先（10>K>5，级牌除外，同分取小），无分取最小。 */
function sortKillCards(cs: Card[], ctx: AIContext): Card[] {
  return cs.sort((a, b) => (killPointVal(b, ctx) - killPointVal(a, ctx))
    || (getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx)));
}

/** 第1条毙牌三档：有强牌(拖拉机/可甩副牌)用最大主牌毙；
 *  墩含分用不小于A的主牌毙；其他用最小主牌毙。 */
export function rule1KillMode(
  _position: string, _tmWin: boolean, leadCombo: ComboClass, ctx: AIContext,
  hand: Card[], leadCards: Card[],
): KillMode {
  if (hasStrongFollowUp(hand, ctx)) return 'max';
  if (leadHasPoints(leadCombo, ctx)) return 'a-or-max';
  return 'auto';
}

/** 毙甩牌：只含单张 → 80 防御用最大、否则不小于A；含对/拖拉机 →
 *  已出含分用最大能毙、否则最小能毙（看最长子牌型）。 */
export function throwKillMode(leadCombo: ComboClass, ctx: AIContext, leadCards: Card[]): KillMode {
  if (leadCombo.pairCount === 0 && !leadCombo.hasTractor) {
    return defense80(ctx, leadCards) ? 'max' : 'a-or-max';
  }
  return visibleTrickPoints(ctx, leadCards) > 0 ? 'max' : 'auto';
}

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

      if (position === 'second') {
        // 第3条：出最小主牌（不一定盖过）；有拖拉机或可甩副牌 → 出最大主牌；
        // 避分（>15 张）：非分小牌优先，级牌次之，分牌再次，主 A/王保底
        if (hasStrongFollowUp(hand, ctx)) {
          myTrump.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
          const cards = [myTrump[0]];
          const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
            leadCombo, 1, ctx, position, tmWin, false, 'none');
          return { cards, reason };
        }
        if (secondShouldAvoid(hand)) {
          myTrump.sort((a, b) => (trumpDumpKey(a, ctx) - trumpDumpKey(b, ctx))
            || (getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx)));
        } else {
          myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        }
        const cards = [myTrump[0]];
        const intent = secondShouldAvoid(hand) ? 'avoid' : 'none';
        const reason = annotateReason('同花色出小', cards, myTrump, myTrump,
          leadCombo, 1, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }

      if (position === 'third') {
        // 第4条：出A或更大且盖过前两家；有强牌 → 最大能盖；
        // 有分 → 主级牌或更大；盖不过 → 最小主牌且不加分
        if (canBeatCards.length > 0) {
          let chosen: Card;
          if (hasStrongFollowUp(hand, ctx)) {
            chosen = maxEff(canBeatCards, ctx);
          } else if (visibleTrickPoints(ctx, leadCards) > 0) {
            const lvlEff = getEffectiveRank(
              { suit: ctx.trumpSuit ?? Suit.Spades, rank: ctx.level as Rank, isJoker: false, id: '' } as Card, ctx);
            const lvlOrBigger = canBeatCards.filter(c => getEffectiveRank(c, ctx) >= lvlEff);
            chosen = lvlOrBigger.length > 0 ? minEff(lvlOrBigger, ctx) : maxEff(canBeatCards, ctx);
          } else {
            const big = canBeatCards.filter(c => getEffectiveRank(c, ctx) >= aceEff(ctx));
            chosen = big.length > 0 ? minEff(big, ctx) : maxEff(canBeatCards, ctx);
          }
          const cards = [chosen];
          const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
            leadCombo, 1, ctx, position, tmWin, false, 'none');
          return { cards, reason };
        }
        // 盖不过前两家 → 最小主牌且不加分（避分优先级：主牌A以下非分单先于分单，
        // 级牌归"主牌A或更大"末类；分牌不优先）
        myTrump.sort(discardSort(false, ctx));
        const cards = [myTrump[0]];
        const reason = annotateReason('同花色出小', cards, myTrump, myTrump,
          leadCombo, 1, ctx, position, tmWin, false, 'avoid');
        return { cards, reason };
      }

      // Fourth / lead fallback: existing behavior
      if (canBeatCards.length > 0) {
        if (position === 'fourth' && tmWin) {
          // 队友已大：第四家不需要盖过。加分优先（出最小的主牌分牌）；
          // 没分可加 → 出最小的不盖过的主牌（垫，让队友赢）；
          // 全部大于 currentMax（被迫盖）→ 出最小能盖的，保留大牌。
          const pointTrump = myTrump.filter(c => isPointRank(c.rank));
          if (pointTrump.length > 0) {
            pointTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
            const cards = [pointTrump[0]];
            const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
              leadCombo, 1, ctx, position, tmWin, false, 'add');
            return { cards, reason };
          }
          const notBeating = myTrump.filter(c => getEffectiveRank(c, ctx) <= currentMax);
          const pool = notBeating.length > 0 ? notBeating : canBeatCards;
          pool.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          const cards = [pool[0]];
          const reason = annotateReason(notBeating.length > 0 ? '同花色出小' : '同花色出大',
            cards, myTrump, myTrump, leadCombo, 1, ctx, position, tmWin, false, 'add');
          return { cards, reason };
        }
        if (position === 'fourth') {
          // 第四家、能盖过对手（墩上有分/无分统一）：
          // 最小能盖过是单张 → 出最小单张（显然）；同等级单张优先于对子（不拆对）。
          // 最小能盖过是对子 X → 按"加分不拆对的垫牌优先级"（add 模式类别）：
          //   X 类别 < 更大单张的类别 → 拆 X 出一张盖过；否则出更大单张保留对子。
          const units = unitize(myTrump, ctx)
            .filter(u => getEffectiveRank(u.card, ctx) > currentMax);
          const pairUnits = units.filter(u => u.kind === 'pair');
          const singleUnits = units.filter(u => u.kind === 'single');
          const pairMin = pairUnits.length
            ? Math.min(...pairUnits.map(u => getEffectiveRank(u.card, ctx))) : Infinity;
          const singleMin = singleUnits.length
            ? Math.min(...singleUnits.map(u => getEffectiveRank(u.card, ctx))) : Infinity;
          let chosen: Card;
          if (singleMin <= pairMin) {
            const cands = singleUnits
              .filter(u => getEffectiveRank(u.card, ctx) === singleMin)
              .map(u => u.card);
            chosen = minEff(cands, ctx);
          } else {
            const X = pairUnits.find(u => getEffectiveRank(u.card, ctx) === pairMin)!;
            const catX = catOf(X, 'add', ctx);
            const biggerSingles = singleUnits
              .filter(u => getEffectiveRank(u.card, ctx) > pairMin)
              .sort((a, b) => (catOf(a, 'add', ctx) - catOf(b, 'add', ctx))
                || (getEffectiveRank(a.card, ctx) - getEffectiveRank(b.card, ctx)));
            const Y = biggerSingles[0];
            chosen = (!Y || catX < catOf(Y, 'add', ctx)) ? X.card : Y.card;
          }
          const cards = [chosen];
          const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
            leadCombo, 1, ctx, position, tmWin, false, 'beat_points');
          return { cards, reason };
        }
        // lead fallback（无位置信息）：最小 A 以上，否则最大（既有行为）
        const bigBeaters = canBeatCards.filter(c => getEffectiveRank(c, ctx) >= aceEff(ctx));
        if (bigBeaters.length > 0) {
          bigBeaters.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          const cards = [bigBeaters[0]];
          const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
            leadCombo, 1, ctx, position, tmWin, false, 'none');
          return { cards, reason };
        }
        canBeatCards.sort((a, b) => getEffectiveRank(b, ctx) - getEffectiveRank(a, ctx));
        const cards = [canBeatCards[0]];
        const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
          leadCombo, 1, ctx, position, tmWin, false, 'none');
        return { cards, reason };
      }
      // 盖不过：第四家（对手大，不加分）/lead fallback
      const shouldAvoid = position === 'fourth' && !tmWin && !attackerNearThreshold(ctx, visibleTrickPoints(ctx, leadCards));
      const addPoints = !shouldAvoid && canAddPoints(tmWin, position, leadCombo, ctx);
      if (addPoints) {
        myTrump.sort(discardSort(true, ctx, myTrump, ctx));
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
    nonTrump.sort(discardSort(!!tmWin, ctx, nonTrump, ctx));
    const forced = [nonTrump[0] || hand[0]];
    const reason = annotateReason('垫牌', forced, [], [],
      leadCombo, leadLen, ctx, position, tmWin, false, 'none');
    return { cards: forced, reason };
  }

  // Multi-card trump lead - match pattern
  if (myTrump.length >= leadLen) {
    return matchTrumpPattern(hand, myTrump, leadCards, leadCombo, leadLen, ctx, position, tmWin);
  }

  // Not enough trump - pad with discards
  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin, position, leadCombo);
}

/** 对子总分（10=10 分、K/5=5 分，级牌 2 无分）。 */
function pairPoints(p: Card[]): number {
  return p.reduce((s, c) =>
    s + (c.rank === Rank.Ten ? 10 : (c.rank === Rank.King || c.rank === Rank.Five ? 5 : 0)), 0);
}

/**
 * 第四家选能盖过的对子（对手大）：优先含最多分且能盖过的（分多在前，
 * 同分取最小能盖过）；尽量不拆拖拉机——拖拉机内的对子仅当外部能盖对子不足时使用。
 */
function pickBeatingPairsForFourth(
  beatingPairs: Card[][], myTrump: Card[], pairCount: number, ctx: AIContext,
): Card[][] {
  const tractors = detectTractors(myTrump, ctx);
  const inTractor = (p: Card[]) => tractors.some(t => t.some(c => c.id === p[0].id));
  const outside = beatingPairs.filter(p => !inTractor(p));
  const pool = outside.length >= pairCount ? outside : beatingPairs;
  pool.sort((a, b) => (pairPoints(b) - pairPoints(a))
    || (getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx)));
  return pool.slice(0, pairCount);
}

export function matchTrumpPattern(
  hand: Card[],
  myTrump: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
): { cards: Card[]; reason: string } {
  // 第三家第5条：领出（队友）更大时，只有手里有拖拉机或可甩副牌才盖过抢权；
  // 无强牌不盖（出最小）。第二家大时能盖就盖。
  const thirdNoSeize = position === 'third' && tmWin && !hasStrongFollowUp(hand, ctx);

  // Already fully covered: try to use smallest matching pattern
  if (leadCombo.hasTractor) {
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const shouldAvoidT = !addPoints
      && ((position === 'fourth' && !tmWin)
        || (position === 'second' && secondShouldAvoid(hand))
        || (position === 'third' && !tmWin));
    const myTractors = detectTractors(myTrump, ctx);
    if (myTractors.length > 0) {
      const ptsStrat = addPoints ? 'add' : (shouldAvoidT ? 'avoid' : undefined);

      // 含最多分且能盖过的优先（第四家能盖过对手）；同分取最小能盖过
      const tractorPoints = (t: Card[]) => t.reduce((s, c) =>
        s + (c.rank === Rank.Ten ? 10 : (c.rank === Rank.King || c.rank === Rank.Five ? 5 : 0)), 0);
      myTractors.sort((a, b) => {
        const pd = tractorPoints(b) - tractorPoints(a);
        if (pd !== 0) return pd;
        const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
        const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
        return aMax - bMax;
      });
      let picked = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx, ptsStrat);
      if (picked && !canBeat(picked, ctx.bestSoFar, ctx) && !thirdNoSeize
          && !(position === 'fourth' && tmWin)) {
        // Sort points-first, biggest-last to try finding a beating tractor
        myTractors.sort((a, b) => {
          const pd = tractorPoints(b) - tractorPoints(a);
          if (pd !== 0) return pd;
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
        const alt = tryMatchTractorSlots(leadCombo, myTractors, myTrump, leadLen, ctx, ptsStrat);
        if (alt && canBeat(alt, ctx.bestSoFar, ctx)) picked = alt;
      }
      if (picked) {
        // 第四家 !addPoints（对手大）垫牌恒标注不加分
        const intent = addPoints ? 'add' : (shouldAvoidT ? 'avoid' : 'none');
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
    // 避分（第二家 >15 张等）：非分小牌优先、级牌次之、分牌再次、主 A/王保底；
    // 否则按大小升序（保留大牌）
    if (shouldAvoidT) {
      rest.sort((a, b) => (trumpDumpKey(a, ctx) - trumpDumpKey(b, ctx))
        || (getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx)));
    } else {
      rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    }
    const cards = [...chosen, ...rest].slice(0, leadLen);
    const intent = addPoints ? 'add' : (shouldAvoidT ? 'avoid' : 'none');
    const reason = annotateReason('垫同花色', cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(myTrump); pairKillSort(myPairs, myTrump, ctx);
    // Has points in trick → use biggest pair to beat
    const hasPoints = (ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank)))
      || leadCards.some(c => isPointRank(c.rank));
    // 第四家队友已大：不因场上有分而出最大对盖队友（加分走下面分牌对分支）
    if (hasPoints && !thirdNoSeize && !(position === 'fourth' && tmWin)) myPairs.sort((a, b) =>
      getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx));
    let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
    // If pair(s) cannot beat, try finding a pair that can.
    // For fourth position that can beat, prefer point-card pairs.
    // Third position with 领出大 and no strong follow-up: do not seize (keep smallest).
    const pairBeating = canBeat(chosen, ctx.bestSoFar, ctx);
    // 第四家队友已大：不需要找能盖的对子盖队友
    if (!pairBeating && !thirdNoSeize && !(position === 'fourth' && tmWin)) {
      const beatingPairs = myPairs.filter(p => canBeat(p, ctx.bestSoFar, ctx));
      if (beatingPairs.length >= leadCombo.pairCount) {
        if (position === 'fourth') {
          // 第四家能盖过对手：优先含最多分且能盖过的，然后最小能盖过的；尽量不拆拖拉机
          chosen = pickBeatingPairsForFourth(beatingPairs, myTrump, leadCombo.pairCount, ctx).flat();
        } else {
          beatingPairs.sort((a, b) => {
            if (hasPoints) return getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx);
            return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
          });
          chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
        }
      }
    } else if (position === 'fourth' && !tmWin) {
      // Fourth can beat — prefer most points first, then smallest beating
      const beatingPairs = myPairs.filter(p => canBeat(p, ctx.bestSoFar, ctx));
      if (beatingPairs.length >= leadCombo.pairCount) {
        chosen = pickBeatingPairsForFourth(beatingPairs, myTrump, leadCombo.pairCount, ctx).flat();
      }
    } else if (position === 'fourth') {
      // Fourth, teammate winning — keep existing point-pair preference (do not beat teammate)
      const pointBeating = myPairs.filter(p =>
        isPointRank(p[0].rank) && canBeat(p, ctx.bestSoFar, ctx));
      if (pointBeating.length >= leadCombo.pairCount) {
        pointBeating.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
        chosen = pointBeating.slice(0, leadCombo.pairCount).flat();
      }
    }
    const addPt = tmWin && canAddPoints(tmWin, position, leadCombo, ctx);
    if (chosen.length < leadLen) {
      const used = new Set(chosen.map(c => c.id));
      const rest = myTrump.filter(c => !used.has(c.id));
      // 第二家避分（>15 张）：非分小牌优先，级牌常主次之，分牌再次，
      // 主牌 A/王保底最后（不加分会导致垫 A/王时宁垫分牌）——与纯单张分支同策略
      if (position === 'second' && secondShouldAvoid(hand)) {
        rest.sort((a, b) => (trumpDumpKey(a, ctx) - trumpDumpKey(b, ctx))
          || (getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx)));
      } else {
        rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      }
      chosen.push(...rest.slice(0, leadLen - chosen.length));
    }
    const cards = chosen.slice(0, leadLen);
    const formsPair = findAllPairs(cards).length >= leadCombo.pairCount;
    const beating = canBeat(cards, ctx.bestSoFar, ctx);
    // 4th position should only avoid if we CANNOT beat (otherwise we're winning)
    // second: avoid by hand size (>15); third: avoid when cannot beat.
    const shouldAvoid = ((position === 'fourth' && !tmWin && !beating)
      || (position === 'second' && secondShouldAvoid(hand))
      || (position === 'third' && !tmWin && !beating)) && !attackerNearThreshold(ctx, visibleTrickPoints(ctx, leadCards));
    let baseReason: string;
    if (leadCombo.type === 'throw') {
      baseReason = '垫同花色';
    } else if (!formsPair && leadCombo.pairCount > 0) {
      baseReason = '垫同花色';
    } else {
      baseReason = beating ? '同花色出大' : '同花色出小';
    }
    const intent = addPt ? 'add' : (shouldAvoid ? 'avoid' : 'none');
    const reason = annotateReason(baseReason, cards, myTrump, myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  // Pure singles: play smallest trump
  // 第二家甩主牌：垫牌（按手牌数避分）；第三家甩主牌：垫牌优先加分；
  // 第四家：队友大加分，否则避分（恒标注）
  let cards2: Card[];
  let intent2: 'add' | 'avoid' | 'none' = 'none';
  if (position === 'second') {
    cards2 = pickDiscards(myTrump, leadLen, ctx, secondShouldAvoid(hand) ? 'avoid' : 'open');
    intent2 = secondShouldAvoid(hand) ? 'avoid' : 'none';
  } else if (position === 'third') {
    cards2 = pickDiscards(myTrump, leadLen, ctx, 'add');
    intent2 = 'add';
  } else {
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    if (addPoints) {
      myTrump.sort(discardSort(true, ctx, myTrump, ctx));
      intent2 = 'add';
    } else {
      myTrump.sort(discardSort(false, ctx));
      intent2 = position === 'fourth' ? 'avoid' : 'none';
    }
    cards2 = myTrump.slice(0, leadLen);
  }
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
  leadCombo: ComboClass,
  killMode: KillMode,
): { cards: Card[]; reason: string } {
  const overkill = isOverkill(ctx);
  // 第四家身后无人可盖毙，加分安全：毙牌/盖毙优先选分牌；第二/三家身后有人，
  // 加分会冒被盖毙抢分的风险，保持最小
  const isFourth = position === 'fourth';

  function killReason(cards: Card[], base: string): string {
    // 盖毙 always uses beat_points; 用主牌毙 uses tmWin to decide.
    const intent = base === '盖毙' ? 'beat_points' : (tmWin ? 'add' : 'beat_points');
    return annotateReason(base, cards, [], trumpCards,
      leadCombo, 1, ctx, position, tmWin, true, intent);
  }

  if (overkill) {
    const bestRank = Math.max(...ctx.bestSoFar!.cards.map(c => getEffectiveRank(c, ctx)));
    const canBeatCards = trumpCards.filter(c => getEffectiveRank(c, ctx) > bestRank);
    if (canBeatCards.length > 0) {
      const chosen = killMode === 'max' ? maxEff(canBeatCards, ctx)
        : killMode === 'a-or-max'
          ? (canBeatCards.some(c => getEffectiveRank(c, ctx) >= aceEff(ctx))
              ? minEff(canBeatCards.filter(c => getEffectiveRank(c, ctx) >= aceEff(ctx)), ctx)
              : maxEff(canBeatCards, ctx))
          // 盖毙：分最多优先，否则最小能盖（仅第四家——身后无人加分安全）
          : isFourth ? sortKillCards(canBeatCards, ctx)[0] : minEff(canBeatCards, ctx);
      return { cards: [chosen], reason: killReason([chosen], '盖毙') };
    }
    // 盖不过恒标注不加分（第四家）
    if (nonTrump.length > 0) {
      nonTrump.sort(discardSort(!!tmWin, ctx, nonTrump, ctx));
      const cards = [nonTrump[0]];
      const reason = annotateReason('盖不过，垫副牌', cards, [], trumpCards,
        leadCombo, 1, ctx, position, tmWin, true, 'avoid');
      return { cards, reason };
    }
    const cards = [trumpCards[0]];
    const reason = annotateReason('盖不过，垫主牌', cards, [], trumpCards,
      leadCombo, 1, ctx, position, tmWin, true, 'avoid');
    return { cards, reason };
  }

  // First kill (bestSoFar is off-suit or none)
  let chosen: Card;
  if (killMode === 'max') {
    chosen = maxEff(trumpCards, ctx);
  } else if (killMode === 'a-or-max') {
    const big = trumpCards.filter(c => getEffectiveRank(c, ctx) >= aceEff(ctx));
    chosen = big.length > 0 ? minEff(big, ctx) : maxEff(trumpCards, ctx);
  } else {
    // auto: 第四家毙牌优先选分牌（10>K>5，级牌除外，同分取小），无分取最小；
    // 墩含分时在不小于A的主牌里同样分优先（级牌除外），没有则取最大。
    // 第二/三家保持最小（身后有人可盖毙，加分冒风险）。
    const sorted = isFourth ? sortKillCards([...trumpCards], ctx)
      : [...trumpCards].sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    if (hasPoints) {
      const big = sorted.filter(c => getEffectiveRank(c, ctx) >= aceEff(ctx));
      chosen = big.length > 0 ? big[0] : sorted[sorted.length - 1];
    } else {
      chosen = sorted[0];
    }
  }
  return { cards: [chosen], reason: killReason([chosen], '用主牌毙') };
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
  opts?: { killMode?: KillMode },
): { cards: Card[]; reason: string } {
  const killMode = opts?.killMode ?? 'auto';
  const nonTrump = hand.filter(c => !isTrump(c, ctx));
  // 第四家身后无人可盖毙，加分安全：毙牌/盖毙优先选分牌；第二/三家保持最小
  const isFourth = position === 'fourth';

  const hasPoints = leadCards.some(c => isPointRank(c.rank))
    || (ctx.bestSoFar && ctx.bestSoFar.cards.some(c => isPointRank(c.rank))) || false;

  /** Annotate a trump-kill reason: tmWin → add, otherwise beat_points. */
  function killReason(cards: Card[], base: string): string {
    const intent = tmWin ? 'add' : 'beat_points';
    return annotateReason(base, cards, [], trumpCards,
      leadCombo, leadLen, ctx, position, tmWin, true, intent);
  }

  if (leadLen === 1) {
    return trumpKillSingle(trumpCards, nonTrump, ctx, position, tmWin, hasPoints, leadCombo, killMode);
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
      if (killMode === 'max' || killMode === 'a-or-max') {
        myTractors.sort((a, b) => {
          const aMax = getEffectiveRank(maxCardT(a, ctx), ctx);
          const bMax = getEffectiveRank(maxCardT(b, ctx), ctx);
          return bMax - aMax;
        });
      } else if (hasPoints && !overkill) {
        myTractors.reverse();
      }
      let picked = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx,
        overkill ? 'add' : undefined); // 盖毙：最长子牌型分最多优先，否则最小能盖
      if (picked && !canTrumpKillBeat(picked, leadCards, ctx)) {
        myTractors.reverse();
        const alt = tryMatchTractorSlots(leadCombo, myTractors, trumpCards, leadLen, ctx,
          overkill ? 'add' : undefined);
        if (alt && canTrumpKillBeat(alt, leadCards, ctx)) picked = alt;
      }
      if (picked && canTrumpKillBeat(picked, leadCards, ctx)) {
        const reason = killReason(picked, overkill ? '盖毙' : '用主牌毙');
        return { cards: picked, reason };
      }
    }
    return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
  }

  if (leadCombo.pairCount > 0) {
    const myPairs = findAllPairs(trumpCards);
    pairKillSort(myPairs, trumpCards, ctx);
    if (killMode === 'max' || killMode === 'a-or-max') {
      myPairs.sort((a, b) =>
        getEffectiveRank(b[0], ctx) - getEffectiveRank(a[0], ctx));
    } else if (overkill) {
      if (isFourth) {
        // 盖毙（第四家原则6注）：对子槽位要盖过对方最大的对应子牌型——能盖过对方
        // 大对的在前（分最多优先，否则最小能盖），其余按分最多、最小
        const bestPairs = ctx.bestSoFar ? findAllPairs(ctx.bestSoFar.cards) : [];
        const bestPairMax = bestPairs.length > 0
          ? Math.max(...bestPairs.map(p => getEffectiveRank(p[0], ctx))) : -Infinity;
        myPairs.sort((a, b) => {
          const aBeats = getEffectiveRank(a[0], ctx) > bestPairMax ? 0 : 1;
          const bBeats = getEffectiveRank(b[0], ctx) > bestPairMax ? 0 : 1;
          if (aBeats !== bBeats) return aBeats - bBeats;
          const d = killPointVal(b[0], ctx) - killPointVal(a[0], ctx);
          if (d !== 0) return d;
          return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
        });
      } else {
        // 第二/三家盖毙：最小能盖（身后有人，不冒加分风险）
        myPairs.sort((a, b) =>
          getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
      }
    } else if (isFourth) {
      // 第四家毙牌优先选分牌：独立对优先（不拆拖拉机），再分对优先
      // （10>K>5，级牌除外，同分取小），无分取最小
      const tractorIds = new Set(detectTractors(trumpCards, ctx).flat().map(c => c.id));
      myPairs.sort((a, b) => {
        const aTr = tractorIds.has(a[0].id) ? 1 : 0;
        const bTr = tractorIds.has(b[0].id) ? 1 : 0;
        if (aTr !== bTr) return aTr - bTr;
        const d = killPointVal(b[0], ctx) - killPointVal(a[0], ctx);
        if (d !== 0) return d;
        return getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx);
      });
    } else {
      // 第二/三家：保持原行为（最小优先，墩含分时反转取大）
      pairKillSort(myPairs, trumpCards, ctx);
      if (hasPoints) myPairs.reverse();
    }
    if (myPairs.length >= leadCombo.pairCount) {
      let chosen = myPairs.slice(0, leadCombo.pairCount).flat();
      if (!canTrumpKillBeat(chosen, leadCards, ctx)) {
        const beatingPairs = myPairs.filter(p => canTrumpKillBeat(p, leadCards, ctx));
        if (beatingPairs.length >= leadCombo.pairCount) {
          beatingPairs.sort((a, b) =>
            getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx));
          if (killMode === 'max' || killMode === 'a-or-max') {
            beatingPairs.reverse();
          } else if (isFourth) {
            // 第四家：分最多优先，否则最小能盖
            beatingPairs.sort((a, b) =>
              (killPointVal(b[0], ctx) - killPointVal(a[0], ctx))
              || (getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx)));
          } else if (hasPoints && !overkill) {
            beatingPairs.reverse();
          }
          chosen = beatingPairs.slice(0, leadCombo.pairCount).flat();
        }
      }
      if (!canTrumpKillBeat(chosen, leadCards, ctx)) {
        return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
      }
      if (chosen.length === leadLen) {
        const reason = killReason(chosen, overkill ? '盖毙' : '用主牌毙');
        return { cards: chosen, reason };
      }
      const used = new Set(chosen.map(c => c.id));
      const rest = trumpCards.filter(c => !used.has(c.id));
      // 毙牌优先选分牌：填充单张分牌优先（10>K>5，级牌除外，同分取小），无分按最小
      rest.sort((a, b) => (killPointVal(b, ctx) - killPointVal(a, ctx))
        || (getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx)));
      const result = [...chosen, ...rest.slice(0, leadLen - chosen.length)];
      if (canTrumpKillBeat(result, leadCards, ctx)) {
        const reason = killReason(result, overkill ? '盖毙' : '用主牌毙');
        return { cards: result, reason };
      }
      return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
    }
    return discardNonTrump(hand, leadLen, ctx, position, tmWin, leadCombo);
  }

  // Pure singles
  trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  let killKeyIdx = -1;
  if (killMode === 'max') {
    if (overkill) {
      const bestRank = Math.max(...ctx.bestSoFar!.cards.map(c => getEffectiveRank(c, ctx)));
      for (let i = trumpCards.length - 1; i >= 0; i--) {
        if (getEffectiveRank(trumpCards[i], ctx) > bestRank) { killKeyIdx = i; break; }
      }
      if (killKeyIdx < 0) killKeyIdx = 0;
    } else {
      killKeyIdx = trumpCards.length - 1;
    }
  } else if (killMode === 'a-or-max') {
    if (overkill) {
      const bestRank = Math.max(...ctx.bestSoFar!.cards.map(c => getEffectiveRank(c, ctx)));
      const candidates = trumpCards.filter(c =>
        getEffectiveRank(c, ctx) > bestRank && getEffectiveRank(c, ctx) >= aceEff(ctx));
      if (candidates.length > 0) {
        killKeyIdx = trumpCards.indexOf(minEff(candidates, ctx));
      } else {
        for (let i = trumpCards.length - 1; i >= 0; i--) {
          if (getEffectiveRank(trumpCards[i], ctx) > bestRank) { killKeyIdx = i; break; }
        }
        if (killKeyIdx < 0) killKeyIdx = 0;
      }
    } else {
      const big = trumpCards.filter(c => getEffectiveRank(c, ctx) >= aceEff(ctx));
      killKeyIdx = big.length > 0 ? trumpCards.indexOf(minEff(big, ctx)) : trumpCards.length - 1;
    }
  } else if (hasPoints && !overkill) {
    // auto with points in trick: use >=A or biggest
    for (let i = 0; i < trumpCards.length; i++) {
      if (getEffectiveRank(trumpCards[i], ctx) >= aceEff(ctx)) {
        killKeyIdx = i;
        break;
      }
    }
    if (killKeyIdx < 0) killKeyIdx = trumpCards.length - 1;
  } else {
    // auto: smallest that beats (overkill) or smallest
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
  // Prefer point cards as fillers — don't waste the chance to add points.
  // But avoid breaking pairs unless necessary (attacker crossing threshold).
  const trumpPairs = findAllPairs(trumpCards);
  const remaining = trumpCards.filter((_, i) => i !== killKeyIdx);
  const pointFillers = remaining.filter(c => isPointRank(c.rank))
    .sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
  const nonPointFillers = remaining.filter(c => !isPointRank(c.rank))
    .sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));

  function wouldBreakPair(c: Card, selected: Card[]): boolean {
    const pair = trumpPairs.find(p => p.some(x => x.id === c.id));
    if (!pair) return false;
    // Not breaking if both cards of the pair are selected (整对垫出)
    return !pair.every(x => selected.includes(x) || x.id === c.id);
  }

  // Point fillers: break pair only if attacker crosses 40-pt threshold
  for (const c of pointFillers) {
    if (kill.length >= leadLen) break;
    if (wouldBreakPair(c, kill) && !attackerNearThreshold(ctx, visibleTrickPoints(ctx, leadCards))) continue;
    kill.push(c);
  }
  // Non-point fillers: never break pairs
  for (const c of nonPointFillers) {
    if (kill.length >= leadLen) break;
    if (wouldBreakPair(c, kill)) continue;
    kill.push(c);
  }
  // If still need fillers, allow breaking (fallback)
  if (kill.length < leadLen) {
    const used = new Set(kill.map(c => c.id));
    for (const c of remaining) {
      if (kill.length >= leadLen) break;
      if (used.has(c.id)) continue;
      kill.push(c);
    }
  }
  if (canTrumpKillBeat(kill, leadCards, ctx)) {
    const reason = killReason(kill, overkill ? '盖毙' : '用主牌毙');
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
    // 第6条（第二家）/第7条（第三家）：不可能盖过，只能垫牌。
    // 第二家按手牌数避分；第三家/第四家队友大时优先加分。
    let cards: Card[];
    if (position === 'second') {
      cards = pickDiscards(trump, leadLen, ctx, secondShouldAvoid(hand) ? 'avoid' : 'open');
    } else if (position === 'third') {
      cards = pickDiscards(trump, leadLen, ctx, 'add');
    } else if (position === 'fourth') {
      cards = pickDiscards(trump, leadLen, ctx, tmWin ? 'add' : 'avoid');
    } else {
      trump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      cards = trump.slice(0, leadLen);
    }
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
        // Second position: seize lead if hand has strong follow-up (tractor/throw).
        if (position === 'second') {
          const hasTractor = detectTractors(hand, ctx).length > 0;
          const throwResult = findThrowableOffSuitCombos(hand, ctx);
          const hasThrow = (throwResult?.cards.length ?? 0) > 0;
          if (!hasTractor && !hasThrow) {
            myTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
            const cards = [myTrump[0]];
            const reason = annotateReason('同花色出小', cards, myTrump, myTrump,
              leadCombo, 1, ctx, position, tmWin, false, 'none');
            return { cards, reason };
          }
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

        if (position === 'fourth' && tmWin) {
          // 队友已大：加分优先（出最小主牌分牌）；没分 → 垫最小不盖过，被迫盖时最小能盖
          const pointTrump = myTrump.filter(c => isPointRank(c.rank));
          if (pointTrump.length > 0) {
            pointTrump.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
            const cards = [pointTrump[0]];
            const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
              leadCombo, 1, ctx, position, tmWin, false, 'add');
            return { cards, reason };
          }
          const notBeating = myTrump.filter(c => getEffectiveRank(c, ctx) <= currentMax);
          const pool = notBeating.length > 0 ? notBeating : canBeatCards;
          pool.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
          const cards = [pool[0]];
          const reason = annotateReason(notBeating.length > 0 ? '同花色出小' : '同花色出大',
            cards, myTrump, myTrump, leadCombo, 1, ctx, position, tmWin, false, 'add');
          return { cards, reason };
        }
        canBeatCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [canBeatCards[0]];
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        const intent = addPoints ? 'add' : 'none';
        const reason = annotateReason('同花色出大', cards, myTrump, myTrump,
          leadCombo, 1, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
      const shouldAvoid = ((position === 'fourth' && !tmWin)
        || (position === 'second' && !tmWin && isMaxPattern(leadCombo, ctx))
        || (position === 'third' && !tmWin)) && !attackerNearThreshold(ctx, visibleTrickPoints(ctx, leadCards));
      const addPts = !shouldAvoid && tmWin && canAddPoints(tmWin, position, leadCombo, ctx);
      if (addPts) {
        myTrump.sort(discardSort(true, ctx, myTrump, ctx));
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
    nonTrump.sort(discardSort(!!tmWin, ctx, nonTrump, ctx));
    const forced = [nonTrump[0] || hand[0]];
    const reason = annotateReason('垫牌', forced, [], [],
      leadCombo, leadLen, ctx, position, tmWin, false, 'none');
    return { cards: forced, reason };
  }

  // Multi-card NT trump lead
  if (myTrump.length >= leadLen) {
    if (leadCombo.pairCount > 0 || leadCombo.hasTractor) {
      const myPairs = findAllPairs(myTrump);
      if (myPairs.length > 0) {
        pairKillSort(myPairs, myTrump, ctx);
        // 对子需求 = 独立对子 + 拖拉机包含的对子（纯拖拉机领出 pairCount=0，
        // 若只看 pairCount 会一个对子都不出 → 拆对出非法跟牌）
        const tractorPairs = leadCombo.tractors.reduce((s, t) => s + t.pairCount, 0);
        const neededPairs = Math.min(myPairs.length, leadCombo.pairCount + tractorPairs);
        const used = myPairs.slice(0, neededPairs).flat();
        const usedIds = new Set(used.map(c => c.id));
        const rest = myTrump.filter(c => !usedIds.has(c.id));
        rest.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
        const cards = [...used, ...rest].slice(0, leadLen);
        const beating = canBeat(cards, ctx.bestSoFar, ctx);
        const baseReason = beating ? '同花色出大' : '同花色出小';
        const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
        // 第四家恒标注：不加分（对手大）时标注避分
        const intent = addPoints ? 'add' : (position === 'fourth' && !tmWin) ? 'avoid' : 'none';
        const reason = annotateReason(baseReason, cards, [], myTrump,
          leadCombo, leadLen, ctx, position, tmWin, false, intent);
        return { cards, reason };
      }
    }
    // No pattern to match — smallest N trump
    const addPoints = canAddPoints(tmWin, position, leadCombo, ctx);
    const sorted = [...myTrump];
    if (addPoints) {
      sorted.sort(discardSort(true, ctx, sorted, ctx));
    } else {
      sorted.sort(discardSort(false, ctx));
    }
    const cards = sorted.slice(0, leadLen);
    const intent = addPoints ? 'add' : (position === 'fourth' && !tmWin) ? 'avoid' : 'none';
    const reason = annotateReason('垫同花色', cards, [], myTrump,
      leadCombo, leadLen, ctx, position, tmWin, false, intent);
    return { cards, reason };
  }

  return padWithDiscards(hand, myTrump, leadLen, ctx, tmWin, position, leadCombo);
}
