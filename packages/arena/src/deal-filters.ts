/**
 * Deal 竞技场的**内置发牌过滤器**（谓词实现）。
 *
 * 这里只放「名字 → 谓词」里的谓词；注册表与解析在 `deal-filter.ts`。谓词是纯函数，
 * 输入 `DealFilterContext`（含该副该等级的候选庄位主牌声明 `decl`），输出「保留为真」。
 */
import type { DealFilterContext } from './deal-filter.js';
import { computeOffSuitControls, longShape } from '@poker/engine';

/**
 * 长花色（**副牌**长套）：任一座位在该副（该等级）的候选主牌下，存在一门副牌满足
 * `longShape`（≥9 张且 T1+T2 控制 ≥6）。主牌门不算——`computeOffSuitControls`
 * 会先把 `isTrump` 的牌剔除；这与 AI 的无主长花色层一致（`longSuit` 只在无主时启用）。
 *
 * 牌数按座位取：**候选庄家**（`ctx.decl.declarerIndex`，由调用方传入的配置庄位）
 * 用 **33 张池** `hands[seat] + 底牌 8 张`（扣底前它拿到底牌后的手牌），其余三家
 * 各 25 张手牌 —— 与长花色层实际看到的手牌口径一致。判断在出牌/扣底之前完成，
 * 所以庄家扣底后长花色消失，这副牌仍然保留。
 *
 * 谓词本身与主牌类型无关——主牌由 `ctx.decl` 给出；自然亮主出对王时即按无主判断。
 */
export function longSuitDealFilter(ctx: DealFilterContext): boolean {
  const bottom = ctx.deck.slice(100, 108);
  const declarer = ctx.decl.declarerIndex;
  return ctx.hands.some((hand, i) =>
    computeOffSuitControls(i === declarer ? [...hand, ...bottom] : [...hand], ctx.decl).some(longShape));
}
