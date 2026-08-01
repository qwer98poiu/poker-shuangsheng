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
