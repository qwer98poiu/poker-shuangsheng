import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import {
  computeLongSuit, computeActiveLongSuit, initialHand, knownOutOfPlay, myPlayedCards,
} from '../ai-latest/suit-memory.js';
import { minimalContext } from '../ai-latest/types.js';
import type { AIContext } from '../ai-latest/types.js';

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

describe('suit memory — active long suit (current hand loss)', () => {
  /** Keep some spades in hand; the rest were played by me in one completed trick. */
  function activeCtx(keepSpades: Card[]): { hand: Card[]; ctx: AIContext } {
    const keepIds = new Set(keepSpades.map(x => x.id));
    const played = longHand.filter(x => x.suit === Suit.Spades && !keepIds.has(x.id));
    const t = trick([played, offSuits(1), offSuits(2), offSuits(3)], 0);
    const hand = [...keepSpades, ...longHand.filter(x => x.suit !== Suit.Spades)];
    return {
      hand,
      ctx: ctxOf({ myIndex: 0, isDeclarer: true, trickHistory: [t] }),
    };
  }

  it('只剩一张单牌 → 不再算长花色', () => {
    const { hand, ctx } = activeCtx([c('S', 14, 0)]);
    expect(computeLongSuit(hand, ctx)).toBe(Suit.Spades);
    expect(computeActiveLongSuit(hand, ctx)).toBeNull();
  });

  it('只剩一对 → 不再算长花色', () => {
    const { hand, ctx } = activeCtx([c('S', 14, 0), c('S', 14, 1)]);
    expect(computeLongSuit(hand, ctx)).toBe(Suit.Spades);
    expect(computeActiveLongSuit(hand, ctx)).toBeNull();
  });

  it('两张不同 rank（2 张甩牌）仍算长花色', () => {
    const { hand, ctx } = activeCtx([c('S', 11, 0), c('S', 9, 0)]);
    expect(computeActiveLongSuit(hand, ctx)).toBe(Suit.Spades);
  });

  it('三张单牌仍算长花色', () => {
    const { hand, ctx } = activeCtx([c('S', 11, 0), c('S', 10, 0), c('S', 9, 0)]);
    expect(computeActiveLongSuit(hand, ctx)).toBe(Suit.Spades);
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

describe('suit memory — the bottom never leaks to a non-declarer', () => {
  const bottomSpades = [
    c('S', 6, 0), c('S', 6, 1), c('S', 5, 0), c('S', 5, 1),
    c('C', 4, 0), c('C', 4, 1), c('C', 3, 0), c('C', 3, 1),
  ];

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
});
