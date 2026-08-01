/**
 * 必打 (must-play K/A) level advancement — pure function.
 *
 * User-confirmed rules:
 * - 庄家打赢 (finalPts < 80): 原级<13 → min(原级+d, 13); 原级=13 → 升到 14; 原级=14 → 该方胜出
 * - 闲家上台 (finalPts >= 80): 闲家等级 N≤13 以升级量 M 上台 → min(N+M, 13)（先台上打赢 K 才能到 A）;
 *   N=14 → 停在 14 继续打 A
 *
 * finalPts = 闲家最终分（含抠底底分×倍数）— 上台判定与升级统一用这个口径（修正 CLI gameLoop 用原始分的差异）。
 */
import { computeLevelChange } from '@poker/engine';

export const LEVEL_MIN = 2;
export const LEVEL_K = 13;
export const LEVEL_A = 14;

export interface AdvanceResult {
  newLevel: number;
  matchOver: boolean;   // true only when the banker wins at A(14)
  attackerSits: boolean;
}

export function advanceLevel(advancingSideLevel: number, finalPts: number): AdvanceResult {
  const attackerSits = finalPts >= 80;
  const changes = computeLevelChange(finalPts);
  const change = attackerSits ? changes.attackerChange : changes.defenderChange;

  if (advancingSideLevel <= 12) {
    return { newLevel: Math.min(advancingSideLevel + change, LEVEL_K), matchOver: false, attackerSits };
  }
  if (advancingSideLevel === LEVEL_K) {
    // 庄家在 K 上打赢 → 到 A；闲家在 K 上台 → 停在 K（K 必须台上打赢）
    return { newLevel: attackerSits ? LEVEL_K : LEVEL_A, matchOver: false, attackerSits };
  }
  // 14 = A
  return { newLevel: LEVEL_A, matchOver: !attackerSits, attackerSits };
}
