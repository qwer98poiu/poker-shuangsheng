import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase, isTrump } from '@poker/engine';

/**
 * 可出牌集合（不符合规则的牌灰色不可选），与引擎 validateFollow 规则对齐：
 * - 领出（trickPlays 空）或非出牌阶段 → null（全可选）
 * - 跟牌：lead 组 = 主牌组（领出是主）或 lead 花色组
 *   - 手牌缺 lead 组 → null（可垫/毙任意牌）
 *   - 手牌 lead 组牌数 ≤ lead 张数 → 全可点（必须全出该组牌，其余任意填——
 *     组合合法性由 submitPlay 的 playCards 校验）
 *   - 手牌 lead 组牌数 > lead 张数 → 只能出该组（含对子/拖拉机组合）
 */
export function computePlayableIds(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): Set<string> | null {
  if (trickPlays.length === 0 || phase !== GamePhase.Playing) return null;
  const lead = trickPlays[0];
  const leadCount = lead.cards.length;
  // lead 组判定：领出是主牌 → 主牌组；否则 lead 花色组（非主）
  const groupIsTrump = isTrump(lead.cards[0], trump!);
  const groupCards = hand.filter(c => (groupIsTrump ? isTrump(c, trump!) : c.suit === lead.leadSuit));
  if (groupCards.length === 0) return null; // 缺门：可垫/毙任意
  if (groupCards.length < leadCount) {
    // 组牌不足 lead 张数：必须全出组牌 + 任意填 → 全可点（组合由 submitPlay 校验）
    return new Set(hand.map(c => c.id));
  }
  if (groupCards.length === leadCount) return new Set(groupCards.map(c => c.id)); // 恰好出组牌
  return new Set(groupCards.map(c => c.id)); // 只能出该组（含对子/拖拉机）
}
