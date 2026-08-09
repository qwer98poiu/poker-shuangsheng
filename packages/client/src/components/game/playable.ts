import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase, isTrump } from '@poker/engine';

/**
 * 可出牌集合（不符合规则的牌灰色不可选）：
 * - 领出（trickPlays 空）或非出牌阶段 → null（全可选）
 * - 吊主（leadSuit null）：手牌有主牌必须出主 → 主牌 id 集合；无主牌可垫任意 → null
 * - 领副牌：手牌有该花色非主牌 → 仅该花色 id 集合；缺门可垫/毙 → null
 */
export function computePlayableIds(
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
  phase: GamePhase,
): Set<string> | null {
  if (trickPlays.length === 0 || phase !== GamePhase.Playing) return null;
  const leadSuit = trickPlays[0].leadSuit;
  if (leadSuit === null) {
    const trumps = hand.filter(c => isTrump(c, trump!));
    return trumps.length > 0 ? new Set(trumps.map(c => c.id)) : null;
  }
  const leadCards = hand.filter(c => c.suit === leadSuit && !isTrump(c, trump!));
  return leadCards.length > 0 ? new Set(leadCards.map(c => c.id)) : null;
}
