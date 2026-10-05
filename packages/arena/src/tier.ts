/**
 * 升级量档位（tier）——单副牌竞技场与无主竞技场共用。
 *
 * 独立成模块是为了打破循环：`nt-arena` 被 `solo-arena` import（`hasJokerPairDeal`），
 * 若 `nt-arena` 反过来从 `solo-arena` 取 `tierOf` 就成环。`solo-arena` 仍原样再导出
 * `tierOf` / `tierOutcome` / `TierBucket`，既有的 import 路径与测试都不用改。
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

/**
 * 档位口径胜负。`aWantsLower` 为真表示 A 希望分低（A 当庄），为假表示 A 希望分高
 * （A 当闲）。**第一个实参必须是 A 所在那条腿的分数**，否则方向会反过来。
 */
export function tierOutcome(ptsA: number, ptsBase: number, aWantsLower: boolean): 'a' | 'b' | 'draw' {
  const tA = tierOf(ptsA);
  const tB = tierOf(ptsBase);
  if (tA === tB) return 'draw';
  const aBetter = aWantsLower ? tA < tB : tA > tB;
  return aBetter ? 'a' : 'b';
}

/** 档位口径的三分类计数。 */
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
