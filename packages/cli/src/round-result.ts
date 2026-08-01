/**
 * 回合结果纯函数 — CLI 上台判定/等级变更的统一口径。
 *
 * 修复前：showRoundResult 用含抠底的最终分算等级变更，但 gameLoop 的
 * 上台判定与庄家轮换用未含抠底的原始分（attackerPoints），口径不一致。
 * 本模块是唯一口径：上台判定 = 闲家最终分（含抠底底分×倍数）≥ 80。
 */
import {
  classify, bottomMultiplier, countBottomPoints, finalizeAttackerPoints, computeLevelChange,
} from '@poker/engine';
import type { Card, Trick, TrumpDeclaration } from '@poker/engine';

export interface RoundOutcome {
  /** 最后一墩领出牌型的底牌倍数（无最后墩时按单张 ×2）。 */
  multiplier: number;
  /** 底牌分数。 */
  bottomPoints: number;
  /** 闲家最终分（含抠底加分，≥0）。 */
  finalPts: number;
  /** 闲家是否赢最后一墩（抠底）。 */
  attackerWonLast: boolean;
  /** 上台判定：finalPts >= 80。 */
  attackerSits: boolean;
  changes: { defenderChange: number; attackerChange: number };
}

/**
 * @param attackerPoints 闲家牌面得分（可能因罚分为负）
 * @param bottom 底牌
 * @param lastTrick 最后一墩（无则按 ×2 且不抠底）
 * @param trump 主牌声明（无最后墩时可为 null）
 * @param declarerIndex 实际庄家（trumpDeclaration.declarerIndex，首局亮主者可能顶替预定庄家）
 */
export function computeRoundOutcome(
  attackerPoints: number,
  bottom: Card[],
  lastTrick: Trick | null,
  trump: TrumpDeclaration | null,
  declarerIndex: number,
): RoundOutcome {
  const lastLeadCombo = lastTrick && trump ? classify(lastTrick.plays[0].cards, trump) : null;
  const multiplier = lastLeadCombo ? bottomMultiplier(lastLeadCombo) : 2;
  const bottomPoints = countBottomPoints(bottom);
  const finalPts = lastTrick
    ? finalizeAttackerPoints(attackerPoints, bottomPoints, multiplier, lastTrick.winnerIndex, declarerIndex)
    : attackerPoints;
  const pts = Math.max(0, finalPts);
  return {
    multiplier,
    bottomPoints,
    finalPts: pts,
    attackerWonLast: lastTrick ? lastTrick.winnerIndex % 2 !== declarerIndex % 2 : false,
    attackerSits: pts >= 80,
    changes: computeLevelChange(pts),
  };
}
