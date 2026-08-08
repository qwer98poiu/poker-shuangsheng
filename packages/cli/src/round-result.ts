/**
 * 回合结果纯函数 — 上台判定/等级变更的统一口径。
 *
 * 修复前：showRoundResult 用含抠底的最终分算等级变更，但 gameLoop 的
 * 上台判定与庄家轮换用未含抠底的原始分（attackerPoints），口径不一致。
 * 本模块是唯一口径：上台判定 = 闲家最终分（含抠底底分×倍数）≥ 80。
 *
 * 实现已下沉至引擎（packages/engine/src/scoring/round-outcome.ts），本文件为 re-export shim。
 */
export { computeRoundOutcome } from '@poker/engine';
export type { RoundOutcome } from '@poker/engine';
