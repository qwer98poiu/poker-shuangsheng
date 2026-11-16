/**
 * AI lead play strategies — tactics for choosing what to lead when
 * it's our turn to start a trick.
 */
import type { Card } from '../types.js';
import { cardPointsFromRank } from '../types.js';
import { isTrump } from '../model.js';
import { detectTractors } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { tryLeadFlushThrow, evaluateDrainedSuitLead } from './flush-detector.js';
import { tryDrain } from './drain.js';
import { tryAttackerTractor, tryAttackerTop, tryAttackerDrain } from './attacker-lead.js';
import { computeActiveLongSuit } from './suit-memory.js';
import { tryGenericLadder, hasWorthGenericLead } from './generic-lead.js';
import { sortPreferLevelSingle } from './utils.js';

/** 领出阶梯档位标签（诊断/测试用，随 `_aiLeadPlay` 的结果一起返回）。 */
export type LeadTier =
  | '0a' | '0b'
  | '庄1'
  | '通用2' | '通用3' | '庄3.5' | '通用4'
  | '通用' | '兜底';

/**
 * 庄家方纯主拖拉机是否被庄3.5 排除。只处理纯主拖拉机（整手都是主牌）；
 * 副拖拉机、含拖甩牌等一律返回 false，不受影响。
 *
 * - 庄家手牌 ≥20：不出含 A 以上（王/级牌）的主拖拉机；<20 不限。
 * - 庄家对家手牌 ≥15：不出 0 分主拖拉机；<15 不限。
 * - 闲家不走庄3.5。
 *
 * 「0 分」按牌自身 rank 计（级牌为 5/10/K 时带分，天然豁免）。
 */
export function forbidsDeclarerSideMainTractor(
  cards: readonly Card[],
  ctx: AIContext,
  handCount: number,
): boolean {
  if (!cards.every(c => isTrump(c, ctx))) return false;
  if (ctx.isDeclarer) {
    return handCount >= 20 && cards.some(c => c.isJoker || c.rank === ctx.level);
  }
  if (ctx.isDeclarerPartner) {
    return handCount >= 15 && cards.every(c => cardPointsFromRank(c.rank) === 0);
  }
  return false;
}

/** 庄3.5 的纯主拖过滤器；闲家没有这一档，返回 undefined。 */
function mainTractorFilterFor(
  hand: Card[],
  ctx: AIContext,
): ((cards: Card[]) => boolean) | undefined {
  if (!ctx.isDeclarer && !ctx.isDeclarerPartner) return undefined;
  const handCount = ctx.myIndex >= 0 ? ctx.handCounts[ctx.myIndex] : hand.length;
  return (cards) => forbidsDeclarerSideMainTractor(cards, ctx, handCount);
}

// ---- 庄3.5：纯主拖拉机 ----

/**
 * 庄3.5：只出纯主拖拉机，选牌键与通用2 的纯拖拉机分支完全一致
 * （对数多 > 张数多 > 最小对大的）。
 *
 * 不含副拖拉机、不含含拖甩牌。庄家与庄家对家共用本档，限制由
 * `forbidsDeclarerSideMainTractor` 按座位与手牌张数判断。
 */
export function tryPureTrumpTractor(
  hand: Card[],
  ctx: AIContext,
  opts?: { forbid?: (cards: Card[]) => boolean },
): { cards: Card[]; reason: string } | null {
  let candidates = detectTractors(hand, ctx).filter(t => t.every(c => isTrump(c, ctx)));
  if (opts?.forbid) {
    candidates = candidates.filter(t => opts.forbid!(t) !== true);
  }

  let best: Card[] | null = null;
  let bestKeys: number[] | null = null;
  for (const t of candidates) {
    // 与 tryAttackerTractor 的纯拖拉机分支一致：全主时 drains/offSuit 恒为 0。
    const keys = [t.length / 2, 0, t.length, 0, Math.min(...t.map(c => c.rank)), 0];
    if (bestKeys === null) {
      best = t;
      bestKeys = keys;
      continue;
    }
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== bestKeys[i]) {
        if (keys[i] > bestKeys[i]) { best = t; bestKeys = keys; }
        break;
      }
    }
  }

  return best === null ? null : { cards: best, reason: `出主拖拉机(${best.length / 2}对)` };
}

// ---- "Worth leading" probe (第四家不抢无分墩) ----

/**
 * 是否有“值得出的牌”——抢到出牌权后领得出去、且值得为之花主牌的东西：
 * 庄1、通用2/通用3、断门/甩牌（通用4 中张数 >1 的候选），以及通用
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

  const isDeclarerSide = ctx.isDeclarer || ctx.isDeclarerPartner;
  if (isDeclarerSide && hasOffSuit(tryDrain(hand, ctx, longSuit))) return true;

  // 庄家方通用2 不出纯主拖；闲家通用2 仍含纯主拖。探针与领出同口径。
  const tractorOpts = isDeclarerSide
    ? { forbidMainTractor: (): boolean => true }
    : undefined;
  if (hasOffSuit(tryAttackerTractor(hand, ctx, longSuit, tractorOpts))) return true;
  if (hasOffSuit(tryAttackerTop(hand, ctx, longSuit))) return true;
  const drain = tryAttackerDrain(hand, ctx, longSuit);
  if (drain !== null && drain.cards.length > 1 && hasOffSuit(drain)) return true;

  return hasWorthGenericLead(hand, ctx, longSuit);
}

// ---- Main lead orchestrator ----

export function _aiLeadPlay(
  hand: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string; tier: LeadTier } {
  const myHandCount = ctx.myIndex >= 0 ? ctx.handCounts[ctx.myIndex] : hand.length;

  // 无主长花色：整套长花色策略的总开关。只算一次，喂给 0b 的排除与长花色层，
  // 免得各层各自重算 computeOffSuitControls。
  const longSuit = ctx.trumpSuit === null && ctx.myIndex >= 0 && hand.length > 0
    ? computeActiveLongSuit(hand, ctx)
    : null;

  // 优先级 0：同一墩窗口的两条甩牌规则——这一墩领了别的牌证据就作废，故必须排在最前。
  //   (a) 整门已绝 → 该门剩下的全甩（牌更多，先试；有主按对子数/已出张数设门槛）
  //   (b) 对子已绝 → 该门剩下的对全甩
  const drained = evaluateDrainedSuitLead(hand, ctx);
  if (drained?.kind === 'throw') {
    return { cards: drained.cards, reason: drained.reason, tier: '0a' };
  }
  const flushResult = tryLeadFlushThrow(hand, ctx, longSuit ?? undefined);
  if (flushResult) return { ...flushResult, tier: '0b' };

  const isDeclarerSide = ctx.isDeclarer || ctx.isDeclarerPartner;

  // 庄1（仅庄家方）：全控花色 / 含顶张和拖拉机的 A 类，按最大集合兑现控制张。
  // 无主长花色也走这一档（动态顶张、24 张反推）。
  if (isDeclarerSide) {
    const drainResult = tryDrain(hand, ctx, longSuit);
    if (drainResult) return { ...drainResult, tier: '庄1' };
  }

  // 通用2：拖拉机 / 含拖拉机的副牌牌型。庄家方排除纯主拖（留给庄3.5），
  // 闲家仍可直接出纯主拖。
  const tractorOpts = isDeclarerSide
    ? { forbidMainTractor: (): boolean => true }
    : undefined;
  const attackerTractor = tryAttackerTractor(hand, ctx, longSuit, tractorOpts);
  if (attackerTractor) return { ...attackerTractor, tier: '通用2' };

  // 通用3：含顶张的副牌牌型。
  const attackerTop = tryAttackerTop(hand, ctx, longSuit);
  if (attackerTop) return { ...attackerTop, tier: '通用3' };

  // 庄3.5（仅庄家方，有主）：纯主拖拉机。无主局不出，落回通用6。
  if (isDeclarerSide && ctx.trumpSuit !== null) {
    const tt = tryPureTrumpTractor(hand, ctx, { forbid: mainTractorFilterFor(hand, ctx) });
    if (tt) return { ...tt, tier: '庄3.5' };
  }

  // 通用4：断门 + 长花色非断门可甩牌。
  const attackerDrain = tryAttackerDrain(hand, ctx, longSuit);
  if (attackerDrain) return { ...attackerDrain, tier: '通用4' };

  // 通用 5–12：副对 → 无主吊主 / 有主主对 → 低副对 → 有主单张吊主
  // → 大单张 → 小单张 → 最后手牌（唯一受台阶防护的一档）。
  const generic = tryGenericLadder(hand, ctx, longSuit, myHandCount);
  if (generic) return { ...generic, tier: '通用' };

  return { cards: [sortPreferLevelSingle(hand, ctx)[0]], reason: '出最小牌', tier: '兜底' };
}
