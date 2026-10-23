/**
 * 升级量档位（tier）——deal 竞技场的三分类与分解指标共用。
 *
 * 报告文字统一用「升级」；`tier` 只是代码标识。
 */

/**
 * 档位 = 升级量档：**0 分单列一档**（−1），其余按 ⌊闲家分 / 40⌋。
 *
 * 双升的升级量是一条阶梯（`computeLevelChange`）：0 分是大光、庄家升 3 级；
 * 5–35 分小光升 2 级；40–75 分保庄升 1 级；80–115 分上台不升；之后每 40 分再 +1 级。
 * 闲家得分恒为 5 的倍数，所以每一段就是 ⌊分/40⌋ 的一档——**前提是把 0 分单独拆出来**，
 * 否则大光与小光会并成同一档，等于把差 1 级的两个结果判成平局。
 */
export function tierOf(pts: number): number {
  return pts === 0 ? -1 : Math.floor(pts / 40);
}

/** 升级三分类（A 胜 / B 胜 / 平）计数。 */
export interface TierBucket {
  n: number;
  a: number;
  b: number;
  draw: number;
}

export const emptyTier = (): TierBucket => ({ n: 0, a: 0, b: 0, draw: 0 });

export function addTier(b: TierBucket, outcome: 'a' | 'b' | 'draw'): void {
  b.n += 1;
  if (outcome === 'a') b.a += 1;
  else if (outcome === 'b') b.b += 1;
  else b.draw += 1;
}
