/**
 * Win-rate significance test.
 *
 * 99% confidence (z = 2.576). p̂ = (wins + 0.5·draws)/n for the leading
 * strategy; significant iff the 99% lower bound of the Wilson score interval
 * for p̂ exceeds 0.5. Wilson is used instead of the plain normal approximation
 * because it stays well-behaved at p̂ = 0 or 1 (the normal formula degenerates
 * to zero width there); at mid-range p̂ the two agree to ~1e-4.
 */
export const Z = 2.576;

export interface SignificanceResult {
  significant: boolean;
  leader: 'A' | 'B' | null;
  pHat: number;
  ciLower: number;
  n: number;
}

export function checkSignificance(
  winsA: number,
  winsB: number,
  draws: number,
  n: number,
  z: number = Z,
): SignificanceResult {
  const scoreA = winsA + 0.5 * draws;
  const scoreB = winsB + 0.5 * draws;
  const leader: 'A' | 'B' | null = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null;
  if (leader === null || n === 0) {
    return { significant: false, leader, pHat: 0.5, ciLower: 0.5, n };
  }
  const p = (leader === 'A' ? scoreA : scoreB) / n;

  // Wilson score interval lower bound
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const ciLower = center - half;

  return { significant: ciLower > 0.5, leader, pHat: p, ciLower, n };
}

/**
 * 按当前胜率推算达到显著所需的总场数（动态进度基准）。
 *
 * 假设当前 p̂ 维持不变（胜/平/负按比例缩放），返回第一个满足显著的场数，
 * 向上取 stepMatches 的整数倍。p̂ ≤ 0.5 时显著性不可达，返回 Infinity；
 * 超过 maxMatches 仍未显著时返回第一个越过上限的倍数（调用方负责钳制并解释）。
 */
export function requiredMatchesForSignificance(
  winsA: number,
  winsB: number,
  draws: number,
  currentN: number,
  stepMatches: number,
  maxMatches: number,
): number {
  const scoreA = winsA + 0.5 * draws;
  const scoreB = winsB + 0.5 * draws;
  const p = Math.max(scoreA, scoreB) / currentN;
  if (p <= 0.5) return Infinity;

  let n = currentN;
  for (; n <= maxMatches; n += stepMatches) {
    // 按原始 wins/draws 分别缩放（checkSignificance 内部会再加 0.5×draws，
    // 若传入合并后的分数会导致 p̂ 被放大）
    const scale = n / currentN;
    const r = checkSignificance(winsA * scale, winsB * scale, draws * scale, n);
    if (r.significant) return n;
  }
  return n;
}
