/**
 * 配对差与区间估计的纯工具（deal 竞技场核心/报告共用）。
 *
 * `PairedBucket` 记一组配对差 `d`（正 = A 更好）的均值/方差/符号计数。
 * `wilsonInterval` 是胜率比例的 Wilson 区间；`pairedInterval` 是配对差均值的
 * 正态近似区间。两者都不含 arena 业务。
 */

/** 配对差口径：均值/方差 + 符号三分类计数。 */
export interface PairedBucket {
  n: number;
  sumD: number;
  sumD2: number;
  /** d > 0 的次数（A 更好）。 */
  pos: number;
  /** d < 0 的次数（B 更好）。 */
  neg: number;
  /** d = 0 的次数（平）。 */
  zero: number;
}

export const emptyPaired = (): PairedBucket => ({
  n: 0, sumD: 0, sumD2: 0, pos: 0, neg: 0, zero: 0,
});

/** 往桶里加入一个配对差。 */
export function addPaired(b: PairedBucket, d: number): void {
  b.n += 1;
  b.sumD += d;
  b.sumD2 += d * d;
  if (d > 0) b.pos += 1;
  else if (d < 0) b.neg += 1;
  else b.zero += 1;
}

/** 分量相加（worker 合并用）。 */
export function addPairedInto(into: PairedBucket, from: PairedBucket): void {
  into.n += from.n;
  into.sumD += from.sumD;
  into.sumD2 += from.sumD2;
  into.pos += from.pos;
  into.neg += from.neg;
  into.zero += from.zero;
}

export function mergePaired(a: PairedBucket, b: PairedBucket): PairedBucket {
  const out = { ...a };
  addPairedInto(out, b);
  return out;
}

/** A 口径的 Wilson 区间（与 significance.ts 同一公式）。 */
export function wilsonInterval(scoreA: number, n: number, z: number): { lower: number; upper: number } {
  const p = scoreA / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: center - half, upper: center + half };
}

/** A 口径的配对差区间（正态近似）；n < 2 时不可用。 */
export function pairedInterval(
  b: PairedBucket,
  z: number,
): { mean: number; lower: number; upper: number; usable: boolean } {
  if (b.n < 2) return { mean: b.n > 0 ? b.sumD / b.n : NaN, lower: NaN, upper: NaN, usable: false };
  const mean = b.sumD / b.n;
  const variance = Math.max(0, (b.sumD2 - b.n * mean * mean) / (b.n - 1));
  const half = z * Math.sqrt(variance / b.n);
  return { mean, lower: mean - half, upper: mean + half, usable: true };
}
