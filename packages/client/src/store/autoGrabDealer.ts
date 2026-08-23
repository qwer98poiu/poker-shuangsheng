import type { Card, Reveal, Suit } from '@poker/engine';
import { canSelfReinforce, getRevealOptions } from '@poker/engine';

export type AutoGrabDecision =
  | { readonly action: 'idle' }
  | { readonly action: 'reveal'; readonly suit: Suit };

/**
 * 首局自动抢庄决策（纯函数，供 GameTable 自动化 effect 调用）：
 * 发牌期间每落一张新牌调用一次（与 AI 的 aiTryReveal 同节奏——后亮须严格
 * 更高，必须抢先出手才能赢下平级局），进入亮主阶段后再以完整手牌终评：
 * - 手牌能亮或反无主（对王）→ 一律不动：无主够强，留给玩家自行决定；
 * - 无人亮主：有级牌即亮（多门时取引擎枚举序第一门，SHCD）；
 * - 已自亮单张且同门仍有级牌对 → 自保（再亮同花色巩固成对）；
 * - 他人已亮：有力量严格更高的花色选项 → 反主（同样取枚举序第一门）。
 * 无主选项（对王）被前置排除后，suitOpts 里只剩花色亮，永远不会返回无主。
 */
export function decideAutoGrabDealer(
  hand: Card[],
  currentReveal: Reveal | null,
  myIndex: number,
  level: number,
): AutoGrabDecision {
  const opts = getRevealOptions(hand, level);
  if (opts.some(o => o.suit === null)) return { action: 'idle' };
  const suitOpts = opts.filter((o): o is typeof o & { suit: Suit } => o.suit !== null);
  if (!currentReveal) {
    const first = suitOpts[0];
    return first ? { action: 'reveal', suit: first.suit } : { action: 'idle' };
  }
  if (currentReveal.playerIndex === myIndex) {
    // canSelfReinforce 已保证 suit 非空（无主不可自保），此处仅收窄类型
    return canSelfReinforce(currentReveal, hand, level, myIndex) && currentReveal.suit !== null
      ? { action: 'reveal', suit: currentReveal.suit }
      : { action: 'idle' };
  }
  const beater = suitOpts.find(o => o.strength > currentReveal.strength);
  return beater ? { action: 'reveal', suit: beater.suit } : { action: 'idle' };
}
