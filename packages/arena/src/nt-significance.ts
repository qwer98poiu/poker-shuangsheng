/**
 * Two-proportion comparison at 99% confidence — the NT arena's per-metric
 * verdict (A's rate vs B's rate, both sides measured on the same deals).
 *
 * Each rate gets a Wilson score interval (well-behaved at 0/1, same estimator
 * the general arena uses for its win rate); the difference gets Newcombe's
 * hybrid score interval, which is built from those two Wilson intervals.
 * A metric is significant iff the 99% interval of (rateA − rateB) excludes 0.
 */
import { Z } from './significance.js';

export interface Interval {
  lower: number;
  upper: number;
}

/** Wilson score interval for n successes out of d trials. */
export function wilson(n: number, d: number, z: number = Z): Interval {
  if (d <= 0) return { lower: 0, upper: 1 };
  const p = n / d;
  const z2 = z * z;
  const denom = 1 + z2 / d;
  const center = (p + z2 / (2 * d)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / d + z2 / (4 * d * d))) / denom;
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}

export interface RateComparison {
  rateA: number;
  rateB: number;
  /** rateA − rateB. */
  diff: number;
  ciA: Interval;
  ciB: Interval;
  /** 99% Newcombe interval for the difference. */
  diffCi: Interval;
  significant: boolean;
  leader: 'A' | 'B' | null;
  /** Denominator of A's rate; 0 means the metric had no samples. */
  dA: number;
  dB: number;
}

/**
 * Compare two independent proportions. With either denominator empty the
 * metric is reported as non-significant (no evidence either way).
 */
export function compareRates(
  nA: number, dA: number, nB: number, dB: number, z: number = Z,
): RateComparison {
  const rateA = dA > 0 ? nA / dA : 0;
  const rateB = dB > 0 ? nB / dB : 0;
  const diff = rateA - rateB;
  const ciA = wilson(nA, dA, z);
  const ciB = wilson(nB, dB, z);

  // Newcombe hybrid score interval for the difference of two proportions.
  const lower = diff - Math.sqrt((rateA - ciA.lower) ** 2 + (ciB.upper - rateB) ** 2);
  const upper = diff + Math.sqrt((ciA.upper - rateA) ** 2 + (rateB - ciB.lower) ** 2);
  const usable = dA > 0 && dB > 0;
  const significant = usable && (lower > 0 || upper < 0);

  return {
    rateA, rateB, diff, ciA, ciB,
    diffCi: { lower, upper },
    significant,
    leader: !usable || diff === 0 ? null : (diff > 0 ? 'A' : 'B'),
    dA, dB,
  };
}
