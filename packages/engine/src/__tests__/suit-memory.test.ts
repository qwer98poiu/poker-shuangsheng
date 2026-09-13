import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration, ComboClass } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import {
  computeLongSuit, computeLongSuitMemory, initialHand, longSuitLeadCount, myPlayedCards,
} from '../ai/suit-memory.js';
import { minimalContext } from '../ai/types.js';
import type { AIContext } from '../ai/types.js';

function c(s: CardSuit, r: number, idx: number): Card {
  return createCard(s, r, idx);
}

const cfgNT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

function ctxOf(over: Partial<AIContext> = {}): AIContext {
  return { ...minimalContext(cfgNT), ...over };
}

/**
 * Build a trick from four **seat-ordered** plays, emitting `Trick.plays` the
 * way the engine does: in play order starting from the leader, with every
 * follow carrying the lead's `leadSuit` (see `playLead`/`playFollow`).
 */
function trick(plays: Card[][], leadIdx: number, winnerIndex = leadIdx): Trick {
  const lead = plays[leadIdx];
  const leadSuit = lead.every(x => isTrump(x, cfgNT)) ? null : (lead[0].suit as CardSuit);
  const ordered = plays.map((_, i) => plays[(leadIdx + i) % 4]);
  return {
    plays: ordered.map(cards => ({
      cards,
      pattern: classify(cards, cfgNT),
      leadSuit,
    })) as unknown as Trick['plays'],
    leadPlayerIndex: leadIdx,
    winnerIndex,
    points: 0,
  };
}

/** The declarer's spade long suit: 9 cards, 7 controls. */
const longHand = [
  c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
  c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
  c('H', 14, 0), c('H', 14, 1), c('D', 14, 0),
];

const offSuits = (p: number): Card[] => [c('H', 3, p), c('H', 3, p + 10), c('H', 4, p), c('H', 4, p + 10)];

describe('suit memory — long suit designation', () => {
  it('picks the one suit that is both long and control-heavy', () => {
    const ctx = ctxOf({ myIndex: 0, isDeclarer: true });
    expect(computeLongSuit(longHand, ctx)).toBe(Suit.Spades);
  });

  it('returns null in a suited round', () => {
    const suited: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const ctx: AIContext = { ...minimalContext(suited), myIndex: 0, isDeclarer: true };
    expect(computeLongSuit(longHand, ctx)).toBeNull();
  });

  it('returns null when no suit reaches 9 cards with 6 controls', () => {
    const short = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('H', 3, 0)];
    const ctx = ctxOf({ myIndex: 0, isDeclarer: true });
    expect(computeLongSuit(short, ctx)).toBeNull();
  });
});

describe('suit memory — initial hand', () => {
  it('declarer rebuilds all 33 cards: hand + played + bottom', () => {
    const played = [c('S', 4, 0), c('S', 4, 1)];
    const t = trick([
      played, offSuits(1), offSuits(2), offSuits(3),
    ], 0);
    const bottom = [c('C', 3, 0), c('C', 3, 1), c('C', 4, 0), c('C', 4, 1),
      c('D', 3, 0), c('D', 3, 1), c('D', 4, 0), c('D', 4, 1)];
    const ctx = ctxOf({
      myIndex: 0, isDeclarer: true, trickHistory: [t], bottomCards: bottom,
    });
    const hand = longHand.filter(x => !played.some(p => p.id === x.id));
    expect(myPlayedCards(ctx).length).toBe(2);
    expect(initialHand(hand, ctx).length).toBe(hand.length + 2 + 8);
  });

  it('non-declarer never adds the bottom he cannot see', () => {
    const bottom = [c('C', 3, 0), c('C', 3, 1), c('C', 4, 0), c('C', 4, 1),
      c('D', 3, 0), c('D', 3, 1), c('D', 4, 0), c('D', 4, 1)];
    const ctx = ctxOf({ myIndex: 1, isDeclarer: false, bottomCards: bottom });
    expect(initialHand(longHand, ctx).length).toBe(longHand.length);
  });
});

describe('suit memory — void and no-pair inference', () => {
  // Lead: my spade 2-pair tractor (4 cards). Everyone else has to follow with
  // spades up to that count; coming up short proves they ran out.
  const lead = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1)];
  const noSpades = [
    c('H', 3, 1), c('H', 3, 11), c('H', 4, 1), c('H', 4, 11),
  ];
  const twoSpades = [
    c('S', 8, 0), c('S', 7, 0), c('H', 5, 1), c('H', 5, 11),
  ];
  const fullTractor = [
    c('S', 8, 1), c('S', 8, 11), c('S', 7, 1), c('S', 7, 11),
  ];

  const memory = (plays: Card[][], hand: Card[] = longHand) =>
    computeLongSuitMemory(hand, ctxOf({
      myIndex: 0, isDeclarer: true, trickHistory: [trick(plays, 0)],
    }));

  it('marks a player with no suit cards as void and painless', () => {
    const m = memory([lead, noSpades, twoSpades, noSpades]);
    expect([...m!.voidPlayers].sort()).toEqual([1, 2, 3]);
    expect([...m!.noPairPlayers].sort()).toEqual([1, 2, 3]);
  });

  it('does not mark a player who followed short as void', () => {
    const m = memory([lead, fullTractor, fullTractor, fullTractor]);
    expect([...m!.voidPlayers]).toEqual([]);
    expect([...m!.noPairPlayers]).toEqual([]);
  });

  it('a follower who plays fewer pairs than the lead demanded has none left', () => {
    // Lead demands 2 pairs; player 1 plays a 2-pair tractor (satisfied),
    // player 2 plays one pair plus two singles (short), player 3 plays none.
    const lead5 = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1)];
    const onePair = [c('S', 8, 0), c('S', 8, 11), c('S', 6, 0), c('H', 5, 1)];
    const m = memory([lead5, fullTractor, onePair, noSpades]);
    expect([...m!.noPairPlayers].sort()).toEqual([2, 3]);
  });

  it('a player who played zero of a single-card lead is void', () => {
    const singleLead = [c('S', 9, 0)];
    const m = memory([singleLead, noSpades.slice(0, 1), [c('S', 8, 0)], noSpades.slice(0, 1)]);
    expect([...m!.voidPlayers].sort()).toEqual([1, 3]);
  });
});

describe('suit memory — window differs by role', () => {
  const t1 = trick([
    [c('S', 4, 0)], [c('H', 3, 1)], [c('H', 3, 2)], [c('H', 3, 3)],
  ], 0);
  const t2 = trick([
    [c('H', 6, 0)], [c('C', 6, 1)], [c('C', 6, 2)], [c('C', 6, 3)],
  ], 0);

  it('declarer accumulates every trick', () => {
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 0, isDeclarer: true, trickHistory: [t1, t2],
    }));
    expect(m!.playedCards.length).toBe(1);
  });

  it('non-declarer only looks back one trick', () => {
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 1, isDeclarer: false, trickHistory: [t1, t2],
    }));
    expect(m!.playedCards.length).toBe(0);
  });

  it('non-declarer still sees the suit in the trick right before', () => {
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 1, isDeclarer: false, trickHistory: [t2, t1],
    }));
    expect(m!.playedCards.length).toBe(1);
  });
});

describe('suit memory — the bottom never leaks to a non-declarer', () => {
  const bottomSpades = [
    c('S', 6, 0), c('S', 6, 1), c('S', 5, 0), c('S', 5, 1),
    c('C', 4, 0), c('C', 4, 1), c('C', 3, 0), c('C', 3, 1),
  ];
  it('produces identical memory with and without bottomCards', () => {
    const base = { myIndex: 1, isDeclarer: false, trickHistory: [] };
    const withBottom = computeLongSuitMemory(longHand, ctxOf({ ...base, bottomCards: bottomSpades }));
    const without = computeLongSuitMemory(longHand, ctxOf({ ...base, bottomCards: [] }));
    expect(withBottom!.tier1.length).toBe(without!.tier1.length);
    expect(withBottom!.playedCards.length).toBe(without!.playedCards.length);
  });

  it('the declarer does fold the bottom in', () => {
    const base = { myIndex: 0, isDeclarer: true, trickHistory: [] };
    const withBottom = computeLongSuitMemory(longHand, ctxOf({ ...base, bottomCards: bottomSpades }));
    const without = computeLongSuitMemory(longHand, ctxOf({ ...base, bottomCards: [] }));
    // Both Aces buried => the King becomes the top card of the suit.
    const hasKing = (m: ReturnType<typeof computeLongSuitMemory>) =>
      m!.tier1.some(x => x.rank === Rank.King);
    expect(hasKing(withBottom)).toBe(true);
    expect(hasKing(without)).toBe(true);
    expect(withBottom!.playedCards.length).toBe(without!.playedCards.length);
  });
});

/**
 * `Trick.plays` 按出牌顺序存放（slot 0 = 领出者）。领出者不是自己时，把座位号
 * 直接当槽位读会读到**别人**的牌——2026-09-19 修的就是这个。
 */
describe('suit memory — plays are read in play order', () => {
  // 座位序：P1 领出 ♠A♠A、P2 跟 ♣、P3 跟 ♦、P0（我）垫 ♥3♥4。
  const myDiscard = [c('H', 3, 7), c('H', 4, 7)];
  const ledByP1 = trick([
    myDiscard,
    [c('S', 14, 1), c('S', 14, 11)],
    [c('C', 5, 2), c('C', 6, 2)],
    [c('D', 5, 3), c('D', 6, 3)],
  ], 1);
  const ctx = (over: Partial<AIContext> = {}): AIContext =>
    ctxOf({ myIndex: 0, isDeclarer: true, trickHistory: [ledByP1], ...over });

  it('myPlayedCards returns my seat, not the leader', () => {
    expect(myPlayedCards(ctx()).map(x => x.id)).toEqual(['H-3-7', 'H-4-7']);
  });

  it('initialHand never picks up the cards of another seat', () => {
    const init = initialHand([c('H', 5, 7)], ctx());
    expect(init.map(x => x.id).sort()).toEqual(['H-3-7', 'H-4-7', 'H-5-7']);
  });

  it('void and no-pair deduction follow the seating, not the play slots', () => {
    // 座位序：P1 领出 4 张 ♠（两对拖拉机）、P2 跟满、P3 一张 ♠ 都没有。
    const lead = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1)];
    const fullTractor = [c('S', 8, 1), c('S', 8, 11), c('S', 7, 1), c('S', 7, 11)];
    const noSpades = [c('H', 3, 2), c('H', 3, 12), c('H', 4, 2), c('H', 4, 12)];
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 0, isDeclarer: true,
      trickHistory: [trick([noSpades, lead, fullTractor, noSpades], 1)],
    }));
    expect([...m!.voidPlayers]).toEqual([3]);
    expect([...m!.noPairPlayers]).toEqual([3]);
  });

});

describe('suit memory — the long suit survives being trumped', () => {
  it('counts the leads I made in that suit, whatever else happened', () => {
    const spadeLead = trick([
      [c('S', 4, 0)], [c('H', 3, 1)], [c('H', 3, 2)], [c('H', 3, 3)],
    ], 0);
    const heartLead = trick([
      [c('H', 6, 0)], [c('C', 6, 1)], [c('C', 6, 2)], [c('C', 6, 3)],
    ], 1);
    const spadeLeadAgain = trick([
      [c('S', 4, 1)], [c('H', 5, 1)], [c('H', 5, 2)], [c('H', 5, 3)],
    ], 0);
    const ctx = ctxOf({
      myIndex: 0, isDeclarer: true,
      trickHistory: [spadeLead, heartLead, spadeLeadAgain],
    });
    expect(longSuitLeadCount(ctx, Suit.Spades)).toBe(2);
    expect(computeLongSuit(longHand, ctx)).toBe(Suit.Spades);
  });
});
