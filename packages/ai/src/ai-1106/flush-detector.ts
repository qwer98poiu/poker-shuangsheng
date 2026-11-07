/**
 * Flush detector — 利用"上一墩"的出牌信息，判断某副花色的对子是否已绝，
 * 从而把该门剩下的对一次性甩出（领出优先级 0）。
 *
 * 推论依据（是引擎的**强制**规则，不是启发式）：
 *   领出含对的牌型时，跟牌者若手上有该花色对子就必须出对——
 *   `checkPairFollow` 直接判非法；拖拉机/甩牌走 `computeIdealFollow`，其
 *   `minTotalPairs = played + min(fillCap, needed)`；当 `fillCap < needed` 时
 *   `minTotalPairs = fillCap`，即**必须把该花色对子全部出光**。
 *   于是"实出对数 < 领出要求对数"⟹ 该家当时把该花色对子全出了，此后不再有。
 *
 * 推论恰好也是 `validateThrow` 的判据（纯对子甩牌只可能被更大的对/拖拉机阻断），
 * 所以推论成立时"把剩下的对一次性甩出"是被引擎保证合法的。
 *
 * 两条边界（见 STRATEGY.md 优先级 0）：
 *   - G2：跟该花色张数 < 领出张数 ⇒ 该家已缺门，可能用主牌对毙 → 不触发。
 *     只对**两个对手**生效；队友（第三家）缺门不构成威胁（由第三家的
 *     "不得盖过队友"约束兜底），故豁免。
 *   - 知识只取**上一墩**（策略基于不记牌，不做跨墩累积，也不用记牌器）。
 */
import type { Card, CardSuit } from '../types.js';
import { Rank, cardPointsFromRank, isPointRank } from '../types.js';
import { getEffectiveRank, isTrump } from '../model.js';
import { classify, findAllPairs, detectTractors } from '../pattern/index.js';
import { compareTwo } from '../comparing/index.js';
import { suitGroup } from '../leading/index.js';
import type { ComboClass } from '../types.js';
import type { AIContext } from './types.js';
import { suitLabelCn } from './utils.js';
import { visibleTrickPoints } from './position-policy.js';

/** 上一墩留下的"该门对子已绝"证据。 */
export interface FlushEvidence {
  /** 已被验空对子的副花色。 */
  readonly suit: CardSuit;
  /** 上一墩领出的张数。 */
  readonly leadLen: number;
  /** 上一墩领出要求的对子数。 */
  readonly reqPairs: number;
  /** 队友该门对子状态。仅在 `checkPartnerPairs` 开启时给出。 */
  readonly partnerPairStatus?: 'none' | 'unknown';
}

/** 跨过 80 台阶需一次加到的分数（闲家冲 80）。 */
const ATTACKER_TARGET = 80;

/** 领出侧分对优先级：K > 10 > 5。 */
function leadPointOrder(rank: number): number {
  if (rank === Rank.King) return 0;
  if (rank === Rank.Ten) return 1;
  if (rank === Rank.Five) return 2;
  return 3;
}

function pickLeadPointPair(pairs: Card[][], ctx: AIContext): Card[] {
  return pairs.reduce((best, pair) => {
    const order = leadPointOrder(pair[0].rank);
    const bestOrder = leadPointOrder(best[0].rank);
    if (order !== bestOrder) return order < bestOrder ? pair : best;
    return getEffectiveRank(pair[0], ctx) > getEffectiveRank(best[0], ctx) ? pair : best;
  });
}

function pickLargestPair(pairs: Card[][], ctx: AIContext): Card[] {
  return pairs.reduce((best, pair) =>
    getEffectiveRank(pair[0], ctx) > getEffectiveRank(best[0], ctx) ? pair : best);
}

/**
 * 0b 队友对子状态未知时先出的一对。
 * 独立对优先，不拆拖拉机；独立分对按领出侧 K > 10 > 5，无独立分对取最大独立非分对。
 * 没有独立对时仍按同一优先级从拖拉机对里拆一对（不套用跟牌侧的边缘/结构规则）。
 */
function pickFlushLeadPair(pairs: Card[][], suitCards: Card[], ctx: AIContext): Card[] {
  const tractorIds = new Set(detectTractors(suitCards, ctx).flat().map(c => c.id));
  const standalone = pairs.filter(pair => !tractorIds.has(pair[0].id));
  const pool = standalone.length > 0 ? standalone : pairs;
  const points = pool.filter(pair => isPointRank(pair[0].rank));
  return points.length > 0
    ? pickLeadPointPair(points, ctx)
    : pickLargestPair(pool, ctx);
}

/**
 * 从上一墩推断 `heroIndex` 是否已可安全清空某门的对子。
 *
 * 成立条件：上一墩由 hero 领出、hero 赢下；领出是含对的副牌牌型。
 *
 * - **G1**：跟出对数 < 要求的对数、证明该家该门对子已出光。推断本身对三家
 *   一视同仁（任何 reqPairs 都成立）；**默认只查两个对手**，队友是否检查由
 *   `checkPartnerPairs` 显式指定——领出侧有候选用作甩牌时才需要队友的对子状态
 *   （1 对是普通对子领出，队友有无对不影响），跟牌侧则不查。
 * - **G2**：有主局两个对手都跟满了领出张数；无主局跳过。
 *   对手缺门就可能用主牌对毙，与 G1 的对子推断无关（缺门者本来就一对没有）。
 *
 * `skipOpponentFullFollow`（无主领出/跟牌侧用）跳过 G2；`checkPartnerPairs`
 * 在 G1 里把队友也查上，并在返回值里给出 `partnerPairStatus`：`'none'` 表示
 * 队友该门对子已出光，`'unknown'` 表示队友跟满要求对数、仍可能留对。
 * `skipPartnerPairCheck`（第三家跟牌侧用）即使传了 `checkPartnerPairs` 也不看
 * 队友——回看证据时"不考虑第三家自己是否有对"。返回 null 表示无证据 / 信息不足。
 */
export function detectFlushEvidence(
  ctx: AIContext,
  heroIndex: number,
  opts?: {
    skipOpponentFullFollow?: boolean;
    checkPartnerPairs?: boolean;
    skipPartnerPairCheck?: boolean;
  },
): FlushEvidence | null {
  if (heroIndex < 0 || ctx.myIndex < 0) return null;

  const history = ctx.trickHistory;
  if (history.length === 0) return null; // ensureContext 兼容路径（无历史）→ 无证据
  const last = history[history.length - 1];
  // 领出者与赢家都必须是 hero：赢了才有牌权继续出，且是他领出的这手
  if (last.leadPlayerIndex !== heroIndex || last.winnerIndex !== heroIndex) return null;

  const leadCards = last.plays[0].cards; // plays[0] 恒为领出（见 model.ts playOf）
  if (leadCards.length < 2) return null;
  if (leadCards.some(c => isTrump(c, ctx))) return null; // 只认副牌（主牌对另有一套）

  const group = suitGroup(leadCards[0], ctx);
  if (!leadCards.every(c => suitGroup(c, ctx) === group)) return null;

  // 重新分类而不读 plays[0].pattern：兼容甩牌失败后的强制降级与手工构造的 ctx
  const combo = classify(leadCards, ctx);
  const reqPairs = combo.tractors.reduce((s, t) => s + t.pairCount, 0) + combo.pairCount;
  if (reqPairs < 1) return null; // 全单领出：没有对子可推

  const partnerIndex = (heroIndex + 2) % 4;
  let partnerPairStatus: 'none' | 'unknown' | undefined;
  for (let i = 1; i <= 3; i++) {
    const p = (last.leadPlayerIndex + i) % 4;
    const inSuit = last.plays[i].cards.filter(c => suitGroup(c, ctx) === group);
    const isPartner = p === partnerIndex;
    const playedPairs = findAllPairs(inSuit).length;

    // G1：跟的对数不足 ⇒ 该家把该花色对子出光了。出满 → 信息不足。
    // 推断对三家同口径；默认只查对手，队友由 checkPartnerPairs 显式开启。
    if (isPartner) {
      if (opts?.checkPartnerPairs === true && !opts?.skipPartnerPairCheck) {
        partnerPairStatus = playedPairs >= reqPairs ? 'unknown' : 'none';
      }
    } else if (playedPairs >= reqPairs) {
      return null;
    }

    // G2：跟该花色张数不足 ⇒ 该家现已缺门，可能用主牌对毙。队友豁免。
    if (!opts?.skipOpponentFullFollow
        && !isPartner && inSuit.length !== leadCards.length) return null;
  }

  const evidence: FlushEvidence = {
    suit: leadCards[0].suit, leadLen: leadCards.length, reqPairs,
  };
  return partnerPairStatus === undefined
    ? evidence
    : { ...evidence, partnerPairStatus };
}

/**
 * 领出优先级 0：把证据花色剩下的对甩出。
 * - ≥2 对且队友已被证明该门无对：把该门剩下的**全部对**（含拖拉机）一次性甩出；
 * - ≥2 对但队友对子状态未知（上一墩跟满要求对数）：不甩，先出一对——
 *   `validateThrow` 会检查队友，整手甩牌可能被队友留着的对阻断；先出一对是普通
 *   对子领出，队友若有对必须跟出，对手已被证明无对，这一对必归我方。
 *   选对优先独立对、不拆拖拉机：独立分对按领出侧 K > 10 > 5，无独立分对取最大
 *   独立非分对；没有独立对时按同一优先级从拖拉机对里拆。
 * - 1 对：直接出这一对（证据已验两个对手该门对子已绝）。
 *
 * 有主/无主统一，不再要求两个对手上一墩跟满张数（G2）：对手缺门可能用主牌毙，
 * 该风险按实测结果接受。
 *
 * `skipSuit` 是「无主长花色」：该门的甩牌由通用2/3/4 处理，这条通用规则不得
 * 抢先改写它——它只证明**对子**已绝、并不证明整门已断，且无主下不查是否会挨毙。
 * 其余花色不受影响；跟牌侧不经过本函数，统一由 `detectTeammateSafeLead` 判定。
 */
export function tryLeadFlushThrow(
  hand: Card[], ctx: AIContext, skipSuit?: CardSuit,
): { cards: Card[]; reason: string } | null {
  if (ctx.playCount !== 0) return null; // 只在领出时
  // 有主/无主统一：甩对接受被毙风险，不再要求两个对手上一墩跟满（G2 已去除）。
  // 同时取队友的对子状态：≥2 对时决定是整手甩出还是先出一对。
  const evidence = detectFlushEvidence(ctx, ctx.myIndex, {
    skipOpponentFullFollow: true,
    checkPartnerPairs: true,
  });
  if (!evidence) return null;
  if (skipSuit !== undefined && evidence.suit === skipSuit) return null;

  const group = String(evidence.suit);
  const suitCards = hand.filter(c => suitGroup(c, ctx) === group);
  const pairs = findAllPairs(suitCards);
  if (pairs.length === 0) return null;

  if (pairs.length === 1) {
    return {
      cards: pairs[0],
      reason: `出${suitLabelCn(evidence.suit)}对子（对子已绝）`,
    };
  }

  // 队友无法证明该门无对：不甩（甩牌会被判非法），改为普通对子领出，先清一对。
  if (evidence.partnerPairStatus !== 'none') {
    return {
      cards: pickFlushLeadPair(pairs, suitCards, ctx),
      reason: `出${suitLabelCn(evidence.suit)}对子（队友对子未证绝）`,
    };
  }

  const cards = pairs.flat();
  return {
    cards,
    reason: `甩${suitLabelCn(evidence.suit)}副牌(对子已绝，${pairs.length}对)`,
  };
}

/** 上一墩留下的"该副花色整门已绝"证据。 */
export interface DrainedSuitEvidence {
  readonly suit: CardSuit;
}

/**
 * 从上一墩推断 `heroIndex` 领出的某副花色是否**整门已绝**。
 *
 * 成立条件：上一墩由 hero 领出、hero 赢下；领出是单一副花色的牌型；三家**都跟不满
 * 领出张数**。跟牌强制出尽该花色（手上不够领出张数就必须把这门全部出掉），故
 * "跟不满"⟺三家此刻已缺门，该门剩余全在 hero 手上。返回 null 表示无证据 / 信息不足。
 *
 * 判据与 G2 同口径（`inSuit.length < leadLen`），`leadLen === 1` 时退化为"一张没出"。
 */
export function detectDrainedSuit(ctx: AIContext, heroIndex: number): DrainedSuitEvidence | null {
  if (heroIndex < 0 || ctx.myIndex < 0) return null;
  const history = ctx.trickHistory;
  if (history.length === 0) return null;
  const last = history[history.length - 1];
  if (last.leadPlayerIndex !== heroIndex || last.winnerIndex !== heroIndex) return null;

  const leadCards = last.plays[0].cards;
  if (leadCards.length < 2) return null;
  if (leadCards.some(c => isTrump(c, ctx))) return null;
  const group = suitGroup(leadCards[0], ctx);
  if (!leadCards.every(c => suitGroup(c, ctx) === group)) return null;

  for (let i = 1; i <= 3; i++) {
    const inSuit = last.plays[i].cards.filter(c => suitGroup(c, ctx) === group);
    if (inSuit.length >= leadCards.length) return null; // 跟满 ⇒ 该家手上还有这门，信息不足
  }
  return { suit: leadCards[0].suit as CardSuit };
}

/** 已完成的各墩领出张数之和 = 每人当前已出张数（领出前调用）。 */
export function playedPerPlayer(ctx: AIContext): number {
  return ctx.trickHistory.reduce((sum, trick) => sum + trick.plays[0].cards.length, 0);
}

/** 0a 门槛裁决：`throw` = 本墩甩出；`rejected` = 有主门槛拒绝（V3 用它阻断 0b）。 */
export type DrainedSuitLeadDecision =
  | { readonly kind: 'throw'; readonly cards: Card[]; readonly reason: string }
  | { readonly kind: 'rejected'; readonly suit: CardSuit };

/**
 * 领出优先级 0：上一墩我领出某副花色、三家都跟不满领出张数、我赢下
 * → 该门剩下的**全部**在我手上，本墩可以一次性甩出去。
 *
 * **不会被判罚**：`validateThrow` 只看同花色组的阻断，三家该门此刻一张没有 ⇒ 必然合法。
 * 唯一风险是被主牌毙：
 *   - 无主：不据此拦截（2026-10-12 起），含对与纯单张一视同仁；
 *   - 有主：按剩余牌型的对数分档——0 对不甩；1 对要求领出前每人已出 ≥ 13 张；
 *     ≥ 2 对总是甩。实测有主 1 对、13–18 档「至少一家能毙」约 19–25%，交给消融接受。
 *
 * 剩余是单一牌型（单张/对/拖拉机）时不走这里——那分别是出单/出对/出拖拉机，交给
 * 优先级 2–4；这也让队友侧"跟队友甩牌"（`leadCombo.type === 'throw'`）的判据一致。
 * **张数门槛 ≥ 2**（2026-10-12 起，原为 ≥ 3）：允许两张单牌组成的甩牌。
 */
export function evaluateDrainedSuitLead(
  hand: Card[], ctx: AIContext,
): DrainedSuitLeadDecision | null {
  if (ctx.playCount !== 0) return null;
  const evidence = detectDrainedSuit(ctx, ctx.myIndex);
  if (!evidence) return null;

  const group = String(evidence.suit);
  const cards = hand.filter(c => suitGroup(c, ctx) === group);
  if (cards.length < 2) return null; // 1 张是出单，不是甩

  const combo = classify(cards, ctx);
  if (combo.type !== 'throw') return null;

  if (ctx.ntState === null) {
    const pairs = combo.pairCount + combo.tractors.reduce((sum, t) => sum + t.pairCount, 0);
    if (pairs === 0) return { kind: 'rejected', suit: evidence.suit };
    if (pairs === 1 && playedPerPlayer(ctx) < 13) {
      return { kind: 'rejected', suit: evidence.suit };
    }
  }

  return {
    kind: 'throw',
    cards,
    reason: `甩${suitLabelCn(evidence.suit)}副牌(该门已绝，${cards.length}张)`,
  };
}

/** 兼容包装：只返回实际甩出的牌；门槛拒绝按 null 处理。 */
export function tryLeadDrainedSuitThrow(
  hand: Card[], ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const decision = evaluateDrainedSuitLead(hand, ctx);
  return decision?.kind === 'throw'
    ? { cards: decision.cards, reason: decision.reason }
    : null;
}

/** 领出是否全是对（每个 rank 恰好出现两次；拖拉机与多对甩牌都满足）。 */
function isAllPairs(cards: readonly Card[]): boolean {
  const rankCounts = new Map<number, number>();
  for (const card of cards) rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
  return [...rankCounts.values()].every(n => n === 2);
}

/** 队友“安全领出”的两种证据。 */
export interface TeammateSafeLead {
  /** flush = 对手该门对子已绝（领出必须全是对）；drained = 三家该门整门已绝。 */
  readonly kind: 'flush' | 'drained';
  readonly suit: CardSuit;
}

/**
 * 第三家回看“队友本墩领出的这一手是否已锁定归队友”。
 *
 * - `drained`：上一墩队友领该副花色并赢下、三家都跟不满 ⇒ 三家该门已绝，
 *   领出可以含单张（花色内无人能盖，只剩被第四家毙的风险）；
 * - `flush`：上一墩队友领含对牌型并赢下、两个对手该门对子已绝 ⇒ 只有全对的领出
 *   才安全（含单张的甩牌可被第四家更大的单张盖过）。
 *
 * 回看证据时**不看第三家自己**：自己的对子/缺门不影响对手是否可能盖牌。
 * 有主/无主同口径（不查 G2）。
 */
export function detectTeammateSafeLead(
  ctx: AIContext, leadCombo: ComboClass,
): TeammateSafeLead | null {
  if (ctx.myIndex < 0) return null;
  const partnerIndex = (ctx.myIndex + 2) % 4;
  if (ctx.leadPlayerIndex !== partnerIndex) return null;

  const cards = leadCombo.cards;
  if (cards.length < 2) return null;
  if (cards.some(c => isTrump(c, ctx))) return null;
  const group = String(suitGroup(cards[0], ctx));
  if (!cards.every(c => suitGroup(c, ctx) === group)) return null;

  const drained = detectDrainedSuit(ctx, partnerIndex);
  if (drained && String(drained.suit) === group) return { kind: 'drained', suit: drained.suit };

  const relaxed = detectFlushEvidence(ctx, partnerIndex, {
    skipOpponentFullFollow: true,
    skipPartnerPairCheck: true,
  });
  if (!relaxed || String(relaxed.suit) !== group) return null;

  // 必须**全是对**：含单张的甩牌可被第四家更大的单张盖过，那时加分就是喂分。
  if (!isAllPairs(cards)) return null;
  return { kind: 'flush', suit: relaxed.suit };
}

/** 第三家跟"队友 0b 清对领出"时是否适用加分规则（`flush` 的薄包装）。 */
export function isFlushFollow(ctx: AIContext, leadCombo: ComboClass): boolean {
  return detectTeammateSafeLead(ctx, leadCombo)?.kind === 'flush';
}

/**
 * 第三家不得盖过队友（0a 整门已绝 / 0b 清对领出时）。
 *
 * 允许队友缺门的前提是队友不抢牌——牌权一旦易主，剩下的牌就再也兑现不了
 * （证据只有一墩窗口）。两道例外保留原选牌：
 *   1. 无法避免：拆不出不盖的牌（如全手恰为两对主牌）；
 *   2. 闲家冲 80：本墩加分后闲家总分**一次达到 80**，值得把主对 10 打出去。
 */
export function avoidBeatingTeammate(
  cards: Card[], hand: Card[], leadCards: Card[], leadCombo: ComboClass, ctx: AIContext,
): Card[] {
  if (!detectTeammateSafeLead(ctx, leadCombo)) return cards;
  const best = ctx.bestSoFar;
  if (!best || best.playerIndex !== (ctx.myIndex + 2) % 4) return cards;
  if (compareTwo(best.cards, cards, leadCards, ctx) !== 'second') return cards; // 没盖过

  const leadLen = leadCards.length;

  // 例外 2：闲家一次加分到 80
  if (ctx.isAttacker && ctx.attackerPoints + visibleTrickPoints(ctx, leadCards) < ATTACKER_TARGET) {
    const played = cards.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
    if (ctx.attackerPoints + visibleTrickPoints(ctx, leadCards) + played >= ATTACKER_TARGET) return cards;
  }

  // 兜底重选：只换一张，优先多留分，其次丢最小
  const chosenIds = new Set(cards.map(c => c.id));
  const pool = hand.filter(c => !chosenIds.has(c.id));
  let bestAlt: Card[] | null = null;
  let bestKey: [number, number] | null = null;
  for (const out of cards) {
    for (const inc of pool) {
      const alt = [...cards.filter(c => c.id !== out.id), inc];
      if (alt.length !== leadLen) continue;
      if (alt.some(c => !hand.some(h => h.id === c.id))) continue;
      if (compareTwo(best.cards, alt, leadCards, ctx) === 'second') continue; // 仍然盖过 → 跳过
      const pts = alt.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
      const key: [number, number] = [pts, -alt.reduce((s, c) => s + c.rank, 0)];
      if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        bestKey = key;
        bestAlt = alt;
      }
    }
  }

  return bestAlt ?? cards; // 例外 1：换不出不盖的牌 → 不得不毙
}
