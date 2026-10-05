import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import {
  computeLongSuit, computeLongSuitMemory, initialHand, knownOutOfPlay,
  longSuitLeadCount, myPlayedCards,
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
 * follow carrying the lead's `leadSuit`.
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

/** The declarer's spade long suit: 9 cards, 8 controls (AA KK QQ tractor + J 10 9). */
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
    const t = trick([played, offSuits(1), offSuits(2), offSuits(3)], 0);
    const bottom = [c('C', 3, 0), c('C', 3, 1), c('C', 4, 0), c('C', 4, 1),
      c('D', 3, 0), c('D', 3, 1), c('D', 4, 0), c('D', 4, 1)];
    const ctx = ctxOf({ myIndex: 0, isDeclarer: true, trickHistory: [t], bottomCards: bottom });
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
  const lead = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1)];
  const noSpades = [c('H', 3, 1), c('H', 3, 11), c('H', 4, 1), c('H', 4, 11)];
  const twoSpades = [c('S', 8, 0), c('S', 7, 0), c('H', 5, 1), c('H', 5, 11)];
  const fullTractor = [c('S', 8, 1), c('S', 8, 11), c('S', 7, 1), c('S', 7, 11)];

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

// 口径 4（用户确认）：非庄家与庄家一样读**全部**已完成墩；两者的差别只有
// 「底牌进 initialHand」与「庄家可用 24 张总数反推」。
describe('suit memory — every seat reads every trick', () => {
  const t1 = trick([[c('S', 4, 0)], [c('H', 3, 1)], [c('H', 3, 2)], [c('H', 3, 3)]], 0);
  const t2 = trick([[c('H', 6, 0)], [c('C', 6, 1)], [c('C', 6, 2)], [c('C', 6, 3)]], 0);

  it('declarer accumulates every trick', () => {
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 0, isDeclarer: true, trickHistory: [t1, t2],
    }));
    expect(m!.playedCards.length).toBe(1);
  });

  it('non-declarer accumulates every trick too (no one-trick window)', () => {
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 1, isDeclarer: false, trickHistory: [t1, t2],
    }));
    expect(m!.playedCards.length).toBe(1);
  });

  it('non-declarer sees the earlier trick even when it is not the last one', () => {
    const m = computeLongSuitMemory(longHand, ctxOf({
      myIndex: 1, isDeclarer: false, trickHistory: [t1, t2],
    }));
    expect(m!.playedCards.map(x => x.id)).toEqual(['S-4-0']);
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
    expect(withBottom!.tier1.map(x => x.id).sort()).toEqual(without!.tier1.map(x => x.id).sort());
    expect(withBottom!.playedCards.length).toBe(without!.playedCards.length);
  });

  it('knownOutOfPlay folds the bottom in only for the declarer', () => {
    const declarer = ctxOf({ myIndex: 0, isDeclarer: true, bottomCards: bottomSpades });
    const partner = ctxOf({ myIndex: 2, isDeclarer: false, bottomCards: bottomSpades });
    expect(knownOutOfPlay(declarer, Suit.Spades).length).toBe(4);
    expect(knownOutOfPlay(partner, Suit.Spades).length).toBe(0);
  });
});

/**
 * `Trick.plays` 按出牌顺序存放（slot 0 = 领出者）。领出者不是自己时，把座位号
 * 直接当槽位读会读到**别人**的牌。
 */
describe('suit memory — plays are read in play order', () => {
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
    const spadeLead = trick([[c('S', 4, 0)], [c('H', 3, 1)], [c('H', 3, 2)], [c('H', 3, 3)]], 0);
    const heartLead = trick([[c('H', 6, 0)], [c('C', 6, 1)], [c('C', 6, 2)], [c('C', 6, 3)]], 1);
    const spadeLeadAgain = trick([[c('S', 4, 1)], [c('H', 5, 1)], [c('H', 5, 2)], [c('H', 5, 3)]], 0);
    const ctx = ctxOf({
      myIndex: 0, isDeclarer: true,
      trickHistory: [spadeLead, heartLead, spadeLeadAgain],
    });
    expect(longSuitLeadCount(ctx, Suit.Spades)).toBe(2);
    expect(computeLongSuit(longHand, ctx)).toBe(Suit.Spades);
  });
});

// ---- 第 4 条：逐墩重建带来的动态升级 ----
//
// 手牌 ♠ = AA KK JJ 99 7。AA KK 是 2 对拖拉机（tier1 = AA KK）；
// JJ / 99 是散对，落在 tier2；单张 7 谁都能盖。注意 JJ 与 99 之间隔着 10，
// 不是拖拉机，否则「对 J 是否是控制张」就由结构性拖拉机决定、测不出升级。
describe('suit memory — dynamic promotion (§4.4 / §4.5 / §4.6)', () => {
  const promHand = [
    c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
    c('S', 11, 0), c('S', 11, 7), c('S', 9, 0), c('S', 9, 7), c('S', 7, 0),
    c('H', 14, 0), c('H', 3, 0), c('D', 5, 0),
  ];
  const base = (history: Trick[] = []) => ctxOf({
    myIndex: 0, isDeclarer: true, trickHistory: history,
  });

  it('§4.5: a pair blocked by an unseen higher pair is NOT a control', () => {
    const m = computeLongSuitMemory(promHand, base());
    expect(m!.tier1.some(x => x.rank === Rank.Jack)).toBe(false);
    expect(m!.tier2.some(x => x.rank === Rank.Jack)).toBe(true);
  });

  it('§4.5: the same pair becomes a control once the blocker is known out of play', () => {
    // 一墩由我领出 ♥，P1/P2 各垫一张 ♠Q（两副牌共两张，正好出尽）。
    const qDump = trick([
      [c('H', 5, 0)], [c('S', 12, 1)], [c('S', 12, 11)], [c('H', 6, 3)],
    ], 0);
    const m = computeLongSuitMemory(promHand, base([qDump]));
    expect(m!.tier1.some(x => x.rank === Rank.Jack)).toBe(true);
  });

  it('§4.4: a lone single is promoted once every higher card is known out of play', () => {
    // 手牌 ♠ 里 9 是单张；比 9 大的在外牌只有 10 与 Q（各两张）。一墩由我领出 ♥，
    // P1 垫 ♠10♠10、P2 垫 ♠Q♠Q → 9 成为最大的单张。
    const dump = trick([
      [c('H', 5, 0), c('H', 6, 0), c('H', 7, 0), c('H', 8, 0)],
      [c('S', 10, 1), c('S', 10, 11), c('H', 3, 1), c('H', 4, 1)],
      [c('S', 12, 1), c('S', 12, 11), c('H', 3, 2), c('H', 4, 2)],
      [c('H', 9, 0), c('H', 10, 0), c('H', 11, 0), c('H', 12, 0)],
    ], 0);
    const before = computeLongSuitMemory(promHand, base());
    const after = computeLongSuitMemory(promHand, base([dump]));
    expect(before!.tier1.some(x => x.rank === Rank.Nine)).toBe(false);
    expect(after!.tier1.some(x => x.rank === Rank.Nine)).toBe(true);
  });

  it('§4.6: when nobody else can hold a pair, every pair of mine is a control', () => {
    // 我领出 ♠77（一对，要求 1 对）；三家都只跟两张单张 → 三家皆无对。
    const lead = [c('S', 7, 1), c('S', 7, 2)];
    const singles = [
      [c('S', 6, 0), c('S', 5, 0)],
      [c('S', 4, 0), c('S', 3, 0)],
      [c('S', 6, 1), c('S', 5, 1)],
    ];
    const t = trick([lead, singles[0], singles[1], singles[2]], 0);
    const hand = promHand.filter(x => !lead.some(l => l.id === x.id));
    const m = computeLongSuitMemory(hand, base([t]));
    expect([...m!.noPairPlayers].sort()).toEqual([1, 2, 3]);
    // JJ / 99 被升级进 tier1（原先只在 tier2，被在外的 QQ / 10 挡着）。
    expect(m!.tier1.some(x => x.rank === Rank.Jack)).toBe(true);
    expect(m!.tier1.some(x => x.rank === Rank.Nine)).toBe(true);
  });
});
