/**
 * AI lead play strategies — tactics for choosing what to lead when
 * it's our turn to start a trick.
 */
import type { Card, Suit } from '../types.js';
import { SUIT_ORDER } from '../types.js';
import { isTrump } from '../model.js';
import { findAllPairs, detectTractors, classify as classifyCombo } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { suitLabelCn, getTopOffSuitRank } from './utils.js';
import { findThrowableSuitCards, worstCaseSuitHand } from './throw-detector.js';
import { validateThrow } from '../leading/index.js';
import { tryLeadFlushThrow, tryLeadDrainedSuitThrow } from './flush-detector.js';
import { tryDrain, tryLoneNonTopPair, isAllControlSuit, topRankForSuit } from './drain.js';
import { tryAttackerTractor, tryAttackerTop, tryAttackerDrain } from './attacker-lead.js';
import { tryNTLead } from './nt-lead.js';
import { computeActiveLongSuit } from './suit-memory.js';
import { tryGenericLadder, hasWorthGenericLead } from './generic-lead.js';
import { rankLabelStr } from './reason.js';

// ---- 庄2：非全控、无顶张、纯拖拉机 ----

/**
 * 庄2：非全控、无顶张、只含纯拖拉机的花色。NT 下整体跳过长花色。
 *
 * 花色内选对数多的拖拉机；同对数按最小对大的优先。跨花色键（大者优先）：
 * 同花色没有其他独立对（拖拉机成员不计） > 对数多 > 最小对大的 > SHCD。
 */
function tryDeclarerTractor(
  hand: Card[],
  ctx: AIContext,
  longSuit: Suit | null,
): { cards: Card[]; reason: string } | null {
  interface Cand { cards: Card[]; suit: Suit; keys: number[] }
  let best: Cand | null = null;

  for (const suit of SUIT_ORDER) {
    if (ctx.trumpSuit === null && suit === longSuit) continue; // NT：长花色归庄3
    const cards = hand.filter(c => c.suit === suit && !isTrump(c, ctx));
    if (cards.length === 0) continue;
    if (isAllControlSuit(hand, suit, ctx, longSuit)) continue;
    const top = topRankForSuit(suit, ctx, longSuit);
    if (cards.some(c => c.rank === top)) continue;

    const tractors = detectTractors(cards, ctx);
    if (tractors.length === 0) continue;
    const tractor = [...tractors].sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      const ma = Math.min(...a.map(c => c.rank));
      const mb = Math.min(...b.map(c => c.rank));
      if (ma !== mb) return mb - ma;
      return Math.max(...b.map(c => c.rank)) - Math.max(...a.map(c => c.rank));
    })[0];

    // “其他对”只算独立对，不含任何拖拉机成员。
    const tractorIds = new Set(tractors.flat().map(c => c.id));
    const hasOtherPair = findAllPairs(cards)
      .some(p => !p.some(c => tractorIds.has(c.id)));

    const keys = [
      hasOtherPair ? 0 : 1,
      tractor.length / 2,
      Math.min(...tractor.map(c => c.rank)),
      SUIT_ORDER.length - SUIT_ORDER.indexOf(suit),
    ];
    const cand: Cand = { cards: tractor, suit, keys };
    if (best === null) {
      best = cand;
      continue;
    }
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== best.keys[i]) {
        if (keys[i] > best.keys[i]) best = cand;
        break;
      }
    }
  }

  return best === null ? null : {
    cards: best.cards,
    reason: `出${suitLabelCn(best.suit)}拖拉机(${best.cards.length / 2}对)`,
  };
}

// ---- 庄4：非全控、有顶张、无拖拉机 ----

/**
 * 庄4：非全控、有顶张、无拖拉机的花色，按最大集合出含顶张的牌型。
 * 顶张静态；跨花色张数少优先，并列 SHCD。
 */
function tryDeclarerTop(
  hand: Card[],
  ctx: AIContext,
  longSuit: Suit | null,
): { cards: Card[]; reason: string } | null {
  interface Cand { cards: Card[]; suit: Suit; keys: number[] }
  let best: Cand | null = null;

  for (const suit of SUIT_ORDER) {
    const cards = hand.filter(c => c.suit === suit && !isTrump(c, ctx));
    if (cards.length === 0) continue;
    if (isAllControlSuit(hand, suit, ctx, longSuit)) continue;
    const top = getTopOffSuitRank(suit, ctx);
    if (!cards.some(c => c.rank === top)) continue;
    if (detectTractors(cards, ctx).length > 0) continue;

    const topCards = cards.filter(c => c.rank === top);
    let chosen: Card[] | null = null;

    // 不含拖拉机的安全顶张甩牌（最大集合）。
    const throwable = findThrowableSuitCards(cards, suit, ctx);
    if (throwable.length > 0 && throwable.some(c => c.rank === top)) {
      const combo = classifyCombo(throwable, ctx);
      if (combo.type === 'throw' && !combo.hasTractor) {
        const worst = worstCaseSuitHand(cards, suit, ctx);
        if (validateThrow(throwable, hand, [worst], ctx).valid) chosen = throwable;
      }
    }

    if (chosen === null && topCards.length >= 2) chosen = [topCards[0], topCards[1]];
    if (chosen === null && topCards.length >= 1) chosen = [topCards[0]];
    if (chosen === null) continue;

    const keys = [
      -chosen.length,
      SUIT_ORDER.length - SUIT_ORDER.indexOf(suit),
    ];
    const cand: Cand = { cards: chosen, suit, keys };
    if (best === null) {
      best = cand;
      continue;
    }
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== best.keys[i]) {
        if (keys[i] > best.keys[i]) best = cand;
        break;
      }
    }
  }

  if (best === null) return null;
  const combo = classifyCombo(best.cards, ctx);
  const reason = combo.type === 'throw'
    ? `甩${suitLabelCn(best.suit)}副牌(${best.cards.length}张)`
    : combo.type === 'pair'
      ? `出${suitLabelCn(best.suit)}${rankLabelStr(best.cards[0].rank)}对`
      : `出${suitLabelCn(best.suit)}${rankLabelStr(best.cards[0].rank)}`;
  return { cards: best.cards, reason };
}

// ---- "Worth leading" probe (第四家不抢无分墩) ----

/**
 * 是否有“值得出的牌”——抢到出牌权后领得出去、且值得为之花主牌的东西：
 * 庄1/庄2/庄4、闲1/闲2、断门/甩牌（闲3 中张数 >1 的候选），以及通用
 * 5/8/10（对子与 J+ 单张）。**结果必须含副牌**：只有主牌的候选不算，
 * 抢来也只能吊主。通用 11 的小单张不算，否则任何一张副牌
 * 都会让第四家去抢无分墩。
 */
export function hasWorthLeadCards(hand: Card[], ctx: AIContext): boolean {
  const longSuit = ctx.trumpSuit === null && ctx.myIndex >= 0 && hand.length > 0
    ? computeActiveLongSuit(hand, ctx)
    : null;
  const hasOffSuit = (r: { cards: Card[] } | null): boolean =>
    !!r && r.cards.some(c => !isTrump(c, ctx));

  if (ctx.isDeclarer || ctx.isDeclarerPartner) {
    if (hasOffSuit(tryDrain(hand, ctx, longSuit))) return true;
    if (hasOffSuit(tryLoneNonTopPair(hand, ctx, longSuit))) return true;
    if (hasOffSuit(tryDeclarerTractor(hand, ctx, longSuit))) return true;
    if (longSuit !== null && hasOffSuit(tryNTLead(hand, ctx, longSuit))) return true;
    if (hasOffSuit(tryDeclarerTop(hand, ctx, longSuit))) return true;
  } else if (ctx.isAttacker) {
    if (hasOffSuit(tryAttackerTractor(hand, ctx, longSuit))) return true;
    if (hasOffSuit(tryAttackerTop(hand, ctx, longSuit))) return true;
    const drain = tryAttackerDrain(hand, ctx, longSuit);
    if (drain !== null && drain.cards.length > 1 && hasOffSuit(drain)) return true;
  }

  return hasWorthGenericLead(hand, ctx, longSuit);
}

// ---- Main lead orchestrator ----

export function _aiLeadPlay(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } {
  const myHandCount = ctx.myIndex >= 0 ? ctx.handCounts[ctx.myIndex] : hand.length;

  // 无主长花色：整套长花色策略的总开关。只算一次，喂给 0b 的排除与长花色层，
  // 免得各层各自重算 computeOffSuitControls。
  const longSuit = ctx.trumpSuit === null && ctx.myIndex >= 0 && hand.length > 0
    ? computeActiveLongSuit(hand, ctx)
    : null;

  // 优先级 0：同一墩窗口的两条甩牌规则（无主才可能触发"整门已绝"那条）——
  // 这一墩领了别的牌证据就作废，故必须排在最前。
  //   (a) 整门已绝 → 该门剩下的全甩（牌更多，先试）
  //   (b) 对子已绝 → 该门剩下的对全甩
  const drainedResult = tryLeadDrainedSuitThrow(hand, ctx);
  if (drainedResult) return drainedResult;
  const flushResult = tryLeadFlushThrow(hand, ctx, longSuit ?? undefined);
  if (flushResult) return flushResult;

  // 庄1（仅庄家方）：全控花色 / 含顶张和拖拉机的 A 类，按最大集合兑现控制张。
  // 无主长花色也走这一档（动态顶张、24 张反推）。
  if (ctx.isDeclarer || ctx.isDeclarerPartner) {
    const drainResult = tryDrain(hand, ctx, longSuit);
    if (drainResult) return drainResult;

    // 庄1.5：无主下孤单非顶对（rank ≥ J），满足毙牌条件才出。
    const lonePair = tryLoneNonTopPair(hand, ctx, longSuit);
    if (lonePair) return lonePair;

    // 庄2：非全控、无顶张、纯拖拉机。
    const declarerTractor = tryDeclarerTractor(hand, ctx, longSuit);
    if (declarerTractor) return declarerTractor;
  } else if (ctx.isAttacker) {
    // 闲家：闲1 拖拉机 → 闲2 顶张 → 闲3 兜底。
    const attackerTractor = tryAttackerTractor(hand, ctx, longSuit);
    if (attackerTractor) return attackerTractor;

    const attackerTop = tryAttackerTop(hand, ctx, longSuit);
    if (attackerTop) return attackerTop;

    const attackerDrain = tryAttackerDrain(hand, ctx, longSuit);
    if (attackerDrain) return attackerDrain;
  }

  // 优先级 0.5（仅无主 + 有长花色）：长花色层——非长门断门/拖拉机、长花色应甩尽甩。
  if (longSuit !== null) {
    const ntResult = tryNTLead(hand, ctx, longSuit);
    if (ntResult) return ntResult;
  }

  // 庄4（仅庄家方）：非全控、有顶张、无拖拉机。
  // 排在旧长花色层之后，保持庄3（长花色）优先。
  if (ctx.isDeclarer || ctx.isDeclarerPartner) {
    const topResult = tryDeclarerTop(hand, ctx, longSuit);
    if (topResult) return topResult;
  }

  // 通用 5–12：副对 → 无主吊主 / 有主主对/主拖拉机 → 低副对 → 有主单张吊主
  // → 大单张 → 小单张 → 最后手牌（唯一受台阶防护的一档）。
  const generic = tryGenericLadder(hand, ctx, longSuit, myHandCount);
  if (generic) return generic;

  return { cards: [hand[0]], reason: '出最小牌' };
}
