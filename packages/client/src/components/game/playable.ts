import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { GamePhase, computeFollowableCards, computeMandatoryFollow, validateFollow, classify, isTrump } from '@poker/engine';

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

/**
 * 扣底状态（庄家 BottomExchange 主按键判定）：
 * - canSubmit：已选恰好 8 张（≠8 时扣底键灰色不可点）
 * - trumpCount：所选底牌中的主牌数（>0 时扣底键变黄并显示警告小字，不设二次确认，点击直接扣）
 */
export function bottomExchangeStatus(
  selected: Card[],
  trump: TrumpDeclaration | null,
): { canSubmit: boolean; trumpCount: number } {
  return {
    canSubmit: selected.length === 8,
    trumpCount: trump ? selected.filter(c => isTrump(c, trump)).length : 0,
  };
}

/**
 * 出牌按钮可否提交（灰色判定）：
 * - 未选牌 → false（与 0 张样式一致）
 * - 领出：单张或同组（同花色非主 / 全部主牌）→ true，不同花色 → false
 * - 跟牌：张数与领出相等且 validateFollow 通过（牌型符合要求）→ true，否则 false
 */
export function canSubmitPlay(
  selected: Card[],
  hand: Card[],
  trickPlays: GameState['trickPlays'],
  trump: TrumpDeclaration | null,
): boolean {
  if (selected.length === 0) return false;
  if (trickPlays.length === 0) {
    // 领出：同组 = 同花色非主 或 全部主牌
    if (selected.length <= 1) return true;
    const groupOf = (c: Card) => (trump && isTrump(c, trump)) ? '_TRUMP_' : c.suit;
    const g = groupOf(selected[0]);
    return selected.every(c => groupOf(c) === g);
  }
  const lead = trickPlays[0];
  if (selected.length !== lead.cards.length) return false;
  if (!trump) return true;
  const leadPattern = classify(lead.cards, trump);
  return validateFollow(selected, hand, lead.cards, leadPattern, lead.leadSuit, trump).valid;
}
