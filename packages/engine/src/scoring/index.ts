/**
 * Modules 7-10 — Scoring pipeline.
 *
 * 7.  Trick scoring: count raw points in a trick.
 * 8.  Bottom scoring: multiplier depends on last trick's lead pattern.
 * 9.  Attacker scoring: only scores when attacker wins a trick.
 * 10. Level change: 大光/小光/保级/上台.
 */
import type { Card, ComboClass } from '../types.js';
import { cardPointsFromRank } from '../types.js';

// ---- 7. Trick scoring ----

export function countTrickPoints(plays: Card[][]): number {
  let pts = 0;
  for (const p of plays) for (const c of p) pts += cardPointsFromRank(c.rank);
  return pts;
}

// ---- 8. Bottom scoring ----

/**
 * Multiplier for bottom cards depends on the LAST trick's lead pattern:
 *   Single → ×2 (2^1)
 *   Pair → ×4 (2^2)
 *   Tractor with n pairs → ×2^(n+1)
 *   Throw → max multiplier among its sub-patterns
 */
export function bottomMultiplier(leadPattern: ComboClass): number {
  if (leadPattern.type === 'single') return 2;
  if (leadPattern.type === 'pair') return 4;
  if (leadPattern.type === 'tractor') {
    const n = leadPattern.tractors[0]?.pairCount ?? 0;
    return Math.pow(2, n + 1);
  }
  // throw: max among tractors, pairs, singles
  let max = 1;
  for (const t of leadPattern.tractors) {
    max = Math.max(max, Math.pow(2, t.pairCount + 1));
  }
  if (leadPattern.pairCount > 0) max = Math.max(max, 4);
  const singCount = leadPattern.length
    - leadPattern.pairCount * 2
    - leadPattern.tractors.reduce((s, t) => s + t.pairCount * 2, 0);
  if (singCount > 0) max = Math.max(max, 2);
  return max;
}

export function countBottomPoints(bottom: Card[]): number {
  return bottom.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
}

// ---- 9. Attacker scoring ----

export function accumulateAttackerPoints(
  current: number, trickPoints: number, winnerIdx: number, declarerIdx: number,
): number {
  const attackerTeam = declarerIdx % 2 === 0 ? 1 : 0;
  return trickPoints > 0 && winnerIdx % 2 === attackerTeam ? current + trickPoints : current;
}

export function finalizeAttackerPoints(
  attackerPoints: number, bottom: number, multiplier: number,
  lastWinnerIdx: number, declarerIdx: number,
): number {
  const attackerTeam = declarerIdx % 2 === 0 ? 1 : 0;
  return lastWinnerIdx % 2 === attackerTeam
    ? attackerPoints + bottom * multiplier
    : attackerPoints;
}

// ---- 10. Level change ----

/**
 *   0 分      = 大光, 庄家升3级
 *   5-35 分   = 小光, 庄家升2级
 *   40-75 分  = 保级, 庄家升1级
 *   80-115 分 = 上台, 不升级
 *   ≥120 分   = 上台, 每40分台阶 +1 级 (不封顶)
 */
export function computeLevelChange(rawPoints: number): {
  defenderChange: number; attackerChange: number;
} {
  const attackerPoints = Math.max(0, rawPoints);
  const n = Math.floor(attackerPoints / 40);
  if (n === 0) {
    if (attackerPoints === 0) return { defenderChange: 3, attackerChange: 0 };
    return { defenderChange: 2, attackerChange: 0 };
  }
  if (n === 1) return { defenderChange: 1, attackerChange: 0 };
  return { defenderChange: 0, attackerChange: n - 2 };
}

// ---- 11. Round outcome & level advancement (统一口径，自 CLI/arena 下沉) ----

export * from './round-outcome.js';
export * from './advance-level.js';
