/**
 * Long-suit memory (长花色记忆) — NT only.
 *
 * 当前主线只用长花色做三件事：动态顶张、`knownOutOfPlay` 排除集与 0b skip。
 * 长花色本身从玩家**初始手牌**（当前手牌 + 我已打出的牌；庄家再加底牌）按扣底
 * 同款形状判据选出（总张数 ≥9 且控制张 ≥6），整回合固定。
 *
 * 取某位玩家在某墩出的牌一律走 `playOf(trick, playerIndex)`：`Trick.plays`
 * 按出牌顺序存放（slot 0 = 领出者），座位号不能直接当槽位用。
 */
import type { Card, Suit } from '../types.js';
import { isTrump, playOf } from '../model.js';
import type { AIContext } from './types.js';
import { computeOffSuitControls } from './bottom-controls.js';
import { longShape, compareLongCandidate } from './bottom-strategy.js';

/** Non-trump cards of one suit. */
function suitCardsOf(cards: readonly Card[], suit: Suit, config: AIContext): Card[] {
  return cards.filter(c => c.suit === suit && !isTrump(c, config));
}

/** Everything I have already played, across all completed tricks. */
export function myPlayedCards(ctx: AIContext): Card[] {
  if (ctx.myIndex < 0) return [];
  const out: Card[] = [];
  for (const t of ctx.trickHistory) out.push(...playOf(t, ctx.myIndex).cards);
  return out;
}

/**
 * The hand I was dealt at the start of play: current hand + my played cards,
 * plus the buried bottom for the declarer (he is the only one who sees it).
 * The declarer ends up with 33 cards, everyone else with 25.
 */
export function initialHand(hand: Card[], ctx: AIContext): Card[] {
  // buildAIContext 只给庄家发底牌（其余座位为 null），此处再按 isDeclarer 兜一层。
  const bottom = ctx.isDeclarer ? ctx.bottomCards ?? [] : [];
  return [...hand, ...myPlayedCards(ctx), ...bottom];
}

/**
 * The player's single long suit for this round, or null when none qualifies.
 * Non-NT rounds never have one.
 */
export function computeLongSuit(hand: Card[], ctx: AIContext): Suit | null {
  if (ctx.trumpSuit !== null) return null;
  const infos = computeOffSuitControls(initialHand(hand, ctx), ctx);
  const candidates = infos.filter(longShape).sort(compareLongCandidate);
  return candidates.length > 0 ? candidates[0].suit : null;
}

/**
 * 运行时生效的长花色：初始手牌认定的长门，在当前手牌里只剩一张单牌或一对时
 * **不再算长花色**（全口径停用：动态顶张、排除集、0b skip）。
 * 两张不同 rank（2 张甩牌）、3 张以上牌型与拖拉机仍算长花色。
 */
export function computeActiveLongSuit(hand: Card[], ctx: AIContext): Suit | null {
  const suit = computeLongSuit(hand, ctx);
  if (suit === null) return null;
  const cards = suitCardsOf(hand, suit, ctx);
  if (cards.length === 0) return null;
  if (cards.length === 1) return null;
  if (cards.length === 2 && cards[0].rank === cards[1].rank) return null;
  return suit;
}

/**
 * Every card of one suit known to be out of play: played by anyone so far,
 * plus the declarer's buried bottom (only he can see it). Such cards can never
 * block a lead or sit in an opponent's hand, so they may be dropped from the
 * worst-case model — this is what makes the "top" rank dynamic.
 */
export function knownOutOfPlay(ctx: AIContext, suit: Suit): Card[] {
  const played = suitCardsOf(
    ctx.trickHistory.flatMap(t => t.plays.flatMap(p => p.cards)), suit, ctx,
  );
  const bottom = ctx.isDeclarer && ctx.bottomCards
    ? suitCardsOf(ctx.bottomCards, suit, ctx)
    : [];
  return [...played, ...bottom];
}
