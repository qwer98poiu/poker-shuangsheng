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
 * 成立条件：上一墩由 hero 领出、hero 赢下；领出是含对的副牌牌型；
 * 三家**都没出满要求的对数**（G1）；两个对手都**跟满了领出张数**（G2）。
 * 返回 null 表示无证据 / 信息不足。
 */
export function detectFlushEvidence(ctx: AIContext, heroIndex: number): FlushEvidence | null {
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

    // G1：跟的对数不足 ⇒ 该家把该花色对子出光了。出满 → 信息不足。
    if (findAllPairs(inSuit).length >= reqPairs) return null;

    // G2：跟该花色张数不足 ⇒ 该家现已缺门，可能用主牌对毙。队友豁免。
    if (p !== partnerIndex && inSuit.length !== leadCards.length) return null;
  }

  return { suit: leadCards[0].suit, leadLen: leadCards.length, reqPairs };
}

/**
 * 领出优先级 0：把证据花色剩下的对一次性甩出。
 * 只在剩 >= 2 对时触发——只剩 1 对是普通出对，不该遮蔽优先级 2/4。
 */
export function tryLeadFlushThrow(
  hand: Card[], ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  if (ctx.playCount !== 0) return null; // 只在领出时
  const evidence = detectFlushEvidence(ctx, ctx.myIndex);
  if (!evidence) return null;

  const group = String(evidence.suit);
  const suitCards = hand.filter(c => suitGroup(c, ctx) === group);
  const pairs = findAllPairs(suitCards);
  if (pairs.length < 2) return null;

  const cards = pairs.flat();
  return {
    cards,
    reason: `甩${suitLabelCn(evidence.suit)}副牌(对子已绝，${pairs.length}对)`,
  };
}

/**
 * 第三家跟"队友清对领出"时是否适用加分规则。
 *
 * 要求：领出者是队友；领出的**全是对**（含单张的甩牌可被第四家更大单张盖过，
 * 那时加分就是喂分）；花色与证据花色一致；证据成立。
 */
export function isFlushFollow(ctx: AIContext, leadCombo: ComboClass): boolean {
  if (ctx.myIndex < 0) return false;
  const partnerIndex = (ctx.myIndex + 2) % 4;
  if (ctx.leadPlayerIndex !== partnerIndex) return false;

  const evidence = detectFlushEvidence(ctx, partnerIndex);
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
