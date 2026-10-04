/**
 * 单副牌 A/B 竞技场的**内置发牌过滤器**（谓词实现）。
 *
 * 这里只放「名字 → 谓词」里的谓词；注册表与解析在 `solo-filter.ts`。谓词是纯函数，
 * 输入 `DealFilterContext`（含该副该等级的自然亮主 `decl`），输出「保留为真」。
 */
import type { DealFilterContext } from './solo-filter.js';
import { computeOffSuitControls, longShape } from '@poker/engine';

/**
 * 长花色：**任一座位**在该副（该等级）的**自然主牌**下，存在一门副牌满足 `longShape`
 * （≥9 张且 T1+T2 控制 ≥6）。牌数按座位取：**庄家**（`ctx.decl.declarerIndex`，本竞技场
 * 固定为 P0）用 **33 张池** `hands[0] + 底牌 8 张`（扣底前它拿到底牌后的手牌），其余三家
 * 各 25 张手牌 —— 与长花色层实际看到的手牌口径一致。
 *
 * 谓词本身与无主无关——主牌由 `ctx.decl` 给出；与 `--nt-only` 共用时主牌恒为无主
 * （对王亮无主压过一切有主亮主），即得到「NT 长花色」。不带 `--nt-only` 时，主牌是
 * 该副的自然亮主，被亮的那一门不算副牌 —— 这正是「过滤器本身不限无主」的含义。
 */
export function longSuitDealFilter(ctx: DealFilterContext): boolean {
  const bottom = ctx.deck.slice(100, 108);
  const declarer = ctx.decl.declarerIndex;
  return ctx.hands.some((hand, i) =>
    computeOffSuitControls(i === declarer ? [...hand, ...bottom] : [...hand], ctx.decl).some(longShape));
}
