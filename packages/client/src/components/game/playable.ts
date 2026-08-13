import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase, computeFollowableCards, computeMandatoryFollow } from '@poker/engine';

/**
 * 可出牌集合（不符合规则的牌灰色不可选）——委托引擎 computeFollowableCards
 * 判定（与 validateFollow 同口径）：
 * - 领出或非出牌阶段 → null（全可选）
 * - 跟牌：null = 全可点（缺门垫/毙、组牌不足任意填）；
 *   集合 = 能出现在某合法跟牌组合中的牌（唯一可出时仅组牌、跟对子时仅对子牌等）
 * 并叠加 computeMandatoryFollow 的不可选牌（同花色内必不可能出现在合法组合中的牌）。
 */
export function computePlayableIds(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): Set<string> | null {
  if (trickPlays.length === 0 || phase !== GamePhase.Playing) return null;
  const lead = trickPlays[0];
  const followable = computeFollowableCards(hand, lead.cards, trump!);
  const disabled = new Set(computeMandatoryFollow(hand, lead.cards, trump!).disabledIds);
  if (followable === null) {
    // 全可点：仅排除不可选牌
    return disabled.size === 0 ? null : new Set(hand.filter(c => !disabled.has(c.id)).map(c => c.id));
  }
  return new Set(followable.filter(c => !disabled.has(c.id)).map(c => c.id));
}

export interface FollowPlan {
  /** 必出牌 id（自动选中 + 锁定不可放下） */
  lockedIds: string[];
}

/**
 * 跟牌必出计划：必出牌（唯一可出组合 / 部分必出子牌型）。
 * 领出或非 Playing 阶段 → 空。
 */
export function computeFollowPlan(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): FollowPlan {
  if (trickPlays.length === 0 || phase !== GamePhase.Playing) return { lockedIds: [] };
  const lead = trickPlays[0];
  return { lockedIds: computeMandatoryFollow(hand, lead.cards, trump!).lockedIds };
}
