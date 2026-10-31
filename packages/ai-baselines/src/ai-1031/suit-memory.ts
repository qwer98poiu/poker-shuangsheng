/**
 * Long-suit memory (长花色记忆) — NT only.
 *
 * The NT lead strategy works off one designated long suit per player. For it
 * it needs three things:
 *   - which cards of that suit have already been played (they widen the
 *     "throwable" pool and promote control cards),
 *   - who is known to be void in it,
 *   - who is known to hold no pair in it.
 *
 * The AI is a pure function, so this memory is *rebuilt* from ctx on every
 * lead instead of being carried as mutable state. Every seat reads **all**
 * completed tricks; the only declarer/non-declarer difference is that the
 * declarer folds the buried bottom into his initial hand (he is the only one
 * who sees it) and may infer from the 24-card suit total ("整门已绝"), which
 * the others must not do.
 *
 * The long suit itself is fixed for the whole round. It is derived from the
 * player's *initial* hand — current hand + cards already played by me, plus
 * the bottom for the declarer — using the same shape test as the bottom
 * strategy (total >= 9 and controls >= 6). That way being trumped never loses
 * the long suit: when the lead comes back, the remaining cards of that suit
 * are picked up again.
 *
 * 取某位玩家在某墩出的牌一律走 `playOf(trick, playerIndex)`：`Trick.plays`
 * 按出牌顺序存放（slot 0 = 领出者），座位号不能直接当槽位用。
 */
import type { Card, Suit, Trick } from '../types.js';
import { isTrump, playOf } from '../model.js';
import type { AIContext } from './types.js';
import { computeOffSuitControls, pairUnitCount, pairUnitsOf } from './bottom-controls.js';
import { longShape, compareLongCandidate } from './bottom-strategy.js';

export interface LongSuitMemory {
  /** The designated long suit. */
  readonly suit: Suit;
  /** Cards of the long suit played so far (by anyone, all completed tricks). */
  readonly playedCards: Card[];
  /** Current control cards (T1) of the long suit, after dynamic promotion. */
  readonly tier1: Card[];
  /** Extra control cards (T2) of the long suit — item 3's reduction needs them. */
  readonly tier2: Card[];
  /** Players known to be void in the long suit. */
  readonly voidPlayers: ReadonlySet<number>;
  /** Players known to hold no pair in the long suit. */
  readonly noPairPlayers: ReadonlySet<number>;
}

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
 * **不再算长花色**（全口径停用：动态顶张、排除集、0b skip、庄3）。
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
 * Every seat reads the whole history. The declarer/非庄家 difference is the
 * bottom in `initialHand` and the 24-count inference (item 10), not the window.
 */
function memoryWindow(ctx: AIContext): readonly Trick[] {
  if (ctx.myIndex < 0) return [];
  return ctx.trickHistory;
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

/**
 * Count how many completed tricks I led this suit group in (0 = never/首次).
 * `suit === null` counts trump leads: the engine stores `leadSuit = null`
 * whenever every led card is trump. Used by the generic 6/9 tiers.
 */
export function leadCount(ctx: AIContext, suit: Suit | null): number {
  if (ctx.myIndex < 0) return 0;
  let n = 0;
  for (const t of ctx.trickHistory) {
    if (t.leadPlayerIndex !== ctx.myIndex) continue;
    if (t.plays[0].leadSuit === suit) n++;
  }
  return n;
}

/** Count how many completed tricks I led this off-suit in (0 = never/首次). */
export function longSuitLeadCount(ctx: AIContext, suit: Suit): number {
  return leadCount(ctx, suit);
}

/**
 * Players who played no card of the led suit group in a trick where that suit
 * was led. The follow rules force you to play your group cards (up to the lead
 * length), so playing fewer than the lead length proves you had exactly that
 * many — and therefore have none left. Void is permanent within the round.
 */
function inferVoidPlayers(
  window: readonly Trick[],
  suit: Suit,
  ctx: AIContext,
): Set<number> {
  const out = new Set<number>();
  for (const t of window) {
    const lead = t.plays[0];
    if (lead.leadSuit !== suit) continue;
    const leadLen = lead.cards.length;
    for (let p = 0; p < 4; p++) {
      if (p === ctx.myIndex || p === t.leadPlayerIndex) continue;
      const played = suitCardsOf(playOf(t, p).cards, suit, ctx).length;
      if (played < leadLen) out.add(p);
    }
  }
  return out;
}

/**
 * Players who played fewer pair units than the lead demanded. The follow rules
 * require a follower to play min(leadPairs, ownPairs) pairs, so coming up short
 * means the follower had only as many pairs as were played — none left.
 * A one-pair lead (k = 1) is just the familiar "had a pair, didn't play one".
 */
function inferNoPairPlayers(
  window: readonly Trick[],
  suit: Suit,
  ctx: AIContext,
): Set<number> {
  const out = new Set<number>();
  for (const t of window) {
    const lead = t.plays[0];
    if (lead.leadSuit !== suit) continue;
    const demandedPairs = lead.pattern.pairCount
      + lead.pattern.tractors.reduce((s, tr) => s + tr.pairCount, 0);
    if (demandedPairs === 0) continue;
    for (let p = 0; p < 4; p++) {
      if (p === ctx.myIndex || p === t.leadPlayerIndex) continue;
      const played = pairUnitCount(suitCardsOf(playOf(t, p).cards, suit, ctx));
      if (played < demandedPairs) out.add(p);
    }
  }
  return out;
}

/**
 * Rebuild the long-suit memory, or null when this player has no long suit.
 */
export function computeLongSuitMemory(
  hand: Card[],
  ctx: AIContext,
): LongSuitMemory | null {
  const suit = computeLongSuit(hand, ctx);
  if (suit === null) return null;

  const window = memoryWindow(ctx);
  const playedCards = suitCardsOf(
    window.flatMap(t => t.plays.flatMap(p => p.cards)), suit, ctx,
  );

  // Controls are computed on the *current* hand for every seat, with everything
  // known to be out of play excluded. Because that exclusion now covers all
  // played cards (including my own) and the declarer's bottom, no seat needs
  // the initial hand here — the two roles differ only in the bottom, which the
  // declarer alone can see.
  const info = computeOffSuitControls(hand, ctx, knownOutOfPlay(ctx, suit))
    .find(i => i.suit === suit);
  const tier1: Card[] = info?.tier1 ?? [];
  const tier2: Card[] = info?.tier2 ?? [];

  const voidPlayers = inferVoidPlayers(window, suit, ctx);
  const noPairPlayers = inferNoPairPlayers(window, suit, ctx);

  // §4.6: once nobody else can hold a pair in this suit, every pair of mine is
  // a control — the worst-case pool still admits pairs it cannot actually have.
  const others = [0, 1, 2, 3].filter(p => p !== ctx.myIndex);
  if (others.length > 0 && others.every(p => noPairPlayers.has(p))) {
    const mine = suitCardsOf(hand, suit, ctx);
    const ids = new Set(tier1.map(c => c.id));
    for (const pair of pairUnitsOf(mine).pairs) {
      for (const c of pair) {
        if (!ids.has(c.id)) { ids.add(c.id); tier1.push(c); }
      }
    }
  }

  return { suit, playedCards, tier1, tier2, voidPlayers, noPairPlayers };
}
