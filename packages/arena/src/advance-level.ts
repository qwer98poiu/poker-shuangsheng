/**
 * 必打 (must-play K/A) level advancement — pure function.
 *
 * User-confirmed rules:
 * - 庄家打赢 (finalPts < 80): 原级<13 → min(原级+d, 13); 原级=13 → 升到 14; 原级=14 → 该方胜出
 * - 闲家上台 (finalPts >= 80): 闲家等级 N≤13 以升级量 M 上台 → min(N+M, 13)（先台上打赢 K 才能到 A）;
 *   N=14 → 停在 14 继续打 A
 *
 * finalPts = 闲家最终分（含抠底底分×倍数）— 上台判定与升级统一用这个口径（修正 CLI gameLoop 用原始分的差异）。
 *
 * 实现已下沉至引擎（packages/engine/src/scoring/advance-level.ts），本文件为 re-export shim。
 */
export { advanceLevel, LEVEL_MIN, LEVEL_K, LEVEL_A } from '@poker/engine';
export type { AdvanceResult } from '@poker/engine';
