import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase, computeFollowableCards } from '@poker/engine';

/**
 * 可出牌集合（不符合规则的牌灰色不可选）——委托引擎 computeFollowableCards
 * 判定（与 validateFollow 同口径）：
 * - 领出或非出牌阶段 → null（全可选）
 * - 跟牌：null = 全可点（缺门垫/毙、组牌不足任意填）；
 *   集合 = 能出现在某合法跟牌组合中的牌（唯一可出时仅组牌、跟对子时仅对子牌等）
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
  return followable === null ? null : new Set(followable.map(c => c.id));
}
