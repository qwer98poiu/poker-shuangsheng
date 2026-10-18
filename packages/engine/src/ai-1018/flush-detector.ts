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
import { isTrump } from '../model.js';
import { cardPointsFromRank } from '../types.js';
import { classify, findAllPairs } from '../pattern/index.js';
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
}

/** 跨过 80 台阶需一次加到的分数（闲家冲 80）。 */
const ATTACKER_TARGET = 80;

/**
 * 从上一墩推断 `heroIndex` 是否已可安全清空某门的对子。
 *
 * 成立条件：上一墩由 hero 领出、hero 赢下；领出是含对的副牌牌型。
 *
 * - **G1**：≥2 对时三家都没出满要求的对数；1 对时只要求两个对手
 *   （第三家是队友，其是否还有对不影响）。
 * - **G2**：有主局两个对手都跟满了领出张数；无主局跳过。
 *   对手缺门就可能用主牌对毙，与 G1 的对子推断无关（缺门者本来就一对没有）。
 *
 * `skipOpponentFullFollow`（无主领出/跟牌侧用）跳过 G2；`skipPartnerPairCheck`
 * （第三家跟牌侧用）连 G1 的第三家也不看——回看证据时"不考虑第三家自己是否有对"。
 * 返回 null 表示无证据 / 信息不足。
 */
export function detectFlushEvidence(
  ctx: AIContext,
  heroIndex: number,
  opts?: { skipOpponentFullFollow?: boolean; skipPartnerPairCheck?: boolean },
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
  for (let i = 1; i <= 3; i++) {
    const p = (last.leadPlayerIndex + i) % 4;
    const inSuit = last.plays[i].cards.filter(c => suitGroup(c, ctx) === group);
    const isPartner = p === partnerIndex;

    // G1：跟的对数不足 ⇒ 该家把该花色对子出光了。出满 → 信息不足。
    // 1 对只查两个对手；第三家跟牌侧（skipPartnerPairCheck）永远不查。
    const checkPairs = !isPartner || (reqPairs >= 2 && !opts?.skipPartnerPairCheck);
    if (checkPairs && findAllPairs(inSuit).length >= reqPairs) return null;

    // G2：跟该花色张数不足 ⇒ 该家现已缺门，可能用主牌对毙。队友豁免。
    if (!opts?.skipOpponentFullFollow
        && !isPartner && inSuit.length !== leadCards.length) return null;
  }

  return { suit: leadCards[0].suit, leadLen: leadCards.length, reqPairs };
}

/**
 * 领出优先级 0：把证据花色剩下的对甩出。
 * - ≥2 对：把该门剩下的**全部对**（含拖拉机）一次性甩出；
 * - 1 对：直接出这一对（证据已验两个对手该门对子已绝）。
 *
 * `skipSuit` 是「无主长花色层的长花色」：该门的甩牌由 `nt-lead.ts` 应甩尽甩
 * 处理（T1 整段过闸门，含最坏情况校验），这条通用规则不得抢先改写它——它只证明
 * **对子**已绝、并不证明整门已断，且无主下不查是否会挨毙。其余花色不受影响；
 * 不传该参即原行为（跟牌侧的 `isFlushFollow` / `avoidBeatingTeammate` 一律走原样）。
 */
export function tryLeadFlushThrow(
  hand: Card[], ctx: AIContext, skipSuit?: CardSuit,
): { cards: Card[]; reason: string } | null {
  if (ctx.playCount !== 0) return null; // 只在领出时
  // 无主：甩对接受被毙风险，跳过 G2（对手缺门不构成对子推断的缺口）；有主维持原样
  const evidence = detectFlushEvidence(ctx, ctx.myIndex,
    { skipOpponentFullFollow: ctx.ntState !== null });
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

/**
 * 领出优先级 0（无主）：上一墩我领出某副花色、三家一张都没跟出该花色、我赢下
 * → 该门剩下的**全部**在我手上，本墩把它一次性甩出去。
 *
 * **不会被判罚**：`validateThrow` 只看同花色组的阻断，三家该门此刻一张没有 ⇒ 必然合法。
 * 唯一风险是被主牌毙——**不再据此拦截**（2026-10-12 起）：三家跟不满领出张数已经证明该门
 * 已绝，把这一门清干净的收益盖过挨毙的风险；含对与纯单张一视同仁（原实现只对纯单张查
 * 记牌器，且查的是刻意保守的上界）。
 *
 * 剩余是单一牌型（单张/对/拖拉机）时不走这里——那分别是出单/出对/出拖拉机，交给
 * 优先级 2–4；这也让队友侧"跟队友甩牌"（`leadCombo.type === 'throw'`）的判据一致。
 * **张数门槛 ≥ 2**（2026-10-12 起，原为 ≥ 3）：允许两张单牌组成的甩牌。
 */
export function tryLeadDrainedSuitThrow(
  hand: Card[], ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  if (!ctx.ntState) return null; // 仅无主（规格边界）：有主局的同形态由 0b 与后续档处理
  if (ctx.playCount !== 0) return null;
  const evidence = detectDrainedSuit(ctx, ctx.myIndex);
  if (!evidence) return null;

  const group = String(evidence.suit);
  const cards = hand.filter(c => suitGroup(c, ctx) === group);
  if (cards.length < 2) return null; // 1 张是出单，不是甩

  const combo = classify(cards, ctx);
  if (combo.type !== 'throw') return null;

  return {
    cards,
    reason: `甩${suitLabelCn(evidence.suit)}副牌(该门已绝，${cards.length}张)`,
  };
}

/**
 * 第三家跟"队友 0b 领出"时是否适用加分规则。
 *
 * 要求：领出者是队友；领出的**全是对**（一对或拖拉机；含单张的甩牌可被第四家
 * 更大单张盖过，那时加分就是喂分）；花色与证据花色一致；证据成立。
 *
 * 回看证据时**只看第二/四家**：不考虑第三家自己是否已断门、是否有对。
 * 无主局不检查 G2（对手是否跟满）——与 0b 领出侧同口径。
 */
export function isFlushFollow(ctx: AIContext, leadCombo: ComboClass): boolean {
  if (ctx.myIndex < 0) return false;
  const partnerIndex = (ctx.myIndex + 2) % 4;
  if (ctx.leadPlayerIndex !== partnerIndex) return false;

  const evidence = detectFlushEvidence(ctx, partnerIndex, {
    skipOpponentFullFollow: ctx.ntState !== null,
    skipPartnerPairCheck: true,
  });
  if (!evidence) return false;

  const cards = leadCombo.cards;
  if (cards.length < 2) return false;
  if (cards.some(c => isTrump(c, ctx))) return false;
  const group = String(evidence.suit);
  if (!cards.every(c => suitGroup(c, ctx) === group)) return false;

  // 必须**全是对**：含单张的甩牌可被第四家更大的单张盖过，那时加分就是喂分。
  // 逐 rank 数出现次数（每 rank 至多 2 张），出现 1 次即为单张。
  const rankCounts = new Map<number, number>();
  for (const card of cards) rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
  return [...rankCounts.values()].every(n => n === 2);
}

/**
 * 第三家不得盖过队友（清对领出时）。
 *
 * 允许队友缺门的前提是队友不抢牌——牌权一旦易主，剩下的对就再也兑现不了
 * （证据只有一墩窗口）。两道例外保留原选牌：
 *   1. 无法避免：拆不出不盖的牌（如全手恰为两对主牌）；
 *   2. 闲家冲 80：本墩加分后闲家总分**一次达到 80**，值得把主对 10 打出去。
 */
export function avoidBeatingTeammate(
  cards: Card[], hand: Card[], leadCards: Card[], leadCombo: ComboClass, ctx: AIContext,
): Card[] {
  if (!isFlushFollow(ctx, leadCombo)) return cards;
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
