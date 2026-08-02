import { describe, it, expect } from 'vitest';
import { createCard } from '../model.js';
import { Suit, Rank, SpecialSuit, GamePhase } from '../types.js';
import type { Card, CardSuit, TrumpDeclaration, GameState, PlayerState } from '../types.js';
import { createInitialState } from '../types.js';
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay } from '../ai/index.js';
import { buildAIContext } from '../ai/context.js';
import { aiV2 } from '../index.js';

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
const cfg13: TrumpDeclaration = { declarerIndex: 2, trumpSuit: Suit.Spades, level: 13 };
const cfgNT: TrumpDeclaration = { declarerIndex: 1, trumpSuit: null, level: 5 };

function c(s: CardSuit, r: number, i: number): Card {
  return createCard(s, r as any, i);
}

function ids(cards: Card[]): string[] {
  return cards.map(x => x.id);
}

/** Compare a decision pair from ai/ and ai-v2/ on identical input. */
function expectSame<T extends { cards: Card[]; reason: string }>(a: T, b: T): void {
  expect(ids(b.cards)).toEqual(ids(a.cards));
  expect(b.reason).toBe(a.reason);
}

// ---- fixtures ----
const lv5PairHand = [
  c(Suit.Spades, 5, 0), c(Suit.Spades, 5, 1),           // 对级牌 S5
  c(Suit.Hearts, 5, 0), c(Suit.Hearts, 5, 1),           // 对级牌 H5
  c(Suit.Spades, 14, 0), c(Suit.Spades, 13, 0), c(Suit.Spades, 10, 0),
  c(Suit.Hearts, 14, 0), c(Suit.Hearts, 10, 0), c(Suit.Clubs, 12, 0),
  c(Suit.Diamonds, 14, 0), c(Suit.Diamonds, 11, 0),
];
const lv13SingleHand = [
  c(Suit.Diamonds, 13, 0),                              // 单张级牌 D13
  c(Suit.Diamonds, 14, 0), c(Suit.Diamonds, 12, 0), c(Suit.Diamonds, 10, 0),
  c(Suit.Spades, 14, 1), c(Suit.Spades, 12, 1), c(Suit.Spades, 9, 1),
  c(Suit.Hearts, 13, 1), c(Suit.Hearts, 12, 1), c(Suit.Clubs, 14, 1),
];
const jokerPairHand = [
  c(SpecialSuit.Joker, Rank.BigJoker, 0), c(SpecialSuit.Joker, Rank.BigJoker, 1),   // 对大王 → NT
  c(SpecialSuit.Joker, Rank.SmallJoker, 0), c(SpecialSuit.Joker, Rank.SmallJoker, 1), // 对小王
  c(Suit.Spades, 14, 0), c(Suit.Spades, 12, 0), c(Suit.Spades, 10, 0),
  c(Suit.Hearts, 14, 0), c(Suit.Hearts, 9, 0), c(Suit.Clubs, 13, 0), c(Suit.Diamonds, 11, 0),
];
const bottomRichHand = [
  // 主牌丰富：10 张 H（含级牌 H5）
  c(Suit.Hearts, 5, 0), c(Suit.Hearts, 5, 1), c(Suit.Hearts, 14, 0), c(Suit.Hearts, 14, 1),
  c(Suit.Hearts, 13, 0), c(Suit.Hearts, 12, 0), c(Suit.Hearts, 11, 0),
  c(Suit.Hearts, 10, 0), c(Suit.Hearts, 9, 0), c(Suit.Hearts, 8, 0),
  c(SpecialSuit.Joker, Rank.BigJoker, 0), c(SpecialSuit.Joker, Rank.SmallJoker, 0),
  // 副牌：S 三张带 5 分，C 两张，D 两张
  c(Suit.Spades, 14, 0), c(Suit.Spades, 12, 0), c(Suit.Spades, 5, 0),
  c(Suit.Clubs, 13, 0), c(Suit.Clubs, 10, 0),
  c(Suit.Diamonds, 12, 0), c(Suit.Diamonds, 9, 0),
];
const bottomNTHand = [
  c(SpecialSuit.Joker, Rank.BigJoker, 0), c(SpecialSuit.Joker, Rank.SmallJoker, 0),
  c(Suit.Spades, 5, 0), c(Suit.Spades, 5, 1), c(Suit.Spades, 14, 0), c(Suit.Spades, 13, 0),
  c(Suit.Spades, 12, 0), c(Suit.Spades, 11, 0), c(Suit.Spades, 10, 0), c(Suit.Spades, 9, 0),
  c(Suit.Hearts, 14, 0), c(Suit.Hearts, 12, 0), c(Suit.Hearts, 11, 0), c(Suit.Hearts, 10, 0),
  c(Suit.Clubs, 13, 0), c(Suit.Clubs, 11, 0), c(Suit.Clubs, 9, 0),
  c(Suit.Diamonds, 14, 0), c(Suit.Diamonds, 10, 0), c(Suit.Diamonds, 8, 0),
  c(Suit.Spades, 5, 2),
];
const leadPairHand = [
  c(Suit.Spades, 14, 0), c(Suit.Spades, 14, 1), c(Suit.Spades, 13, 0), c(Suit.Spades, 12, 0),
  c(Suit.Hearts, 13, 0), c(Suit.Hearts, 13, 1), c(Suit.Hearts, 10, 0), c(Suit.Hearts, 9, 0),
  c(Suit.Clubs, 14, 0), c(Suit.Clubs, 11, 0), c(Suit.Clubs, 8, 0),
  c(Suit.Diamonds, 12, 0), c(Suit.Diamonds, 7, 0),
];
const leadTractorHand = [
  c(Suit.Spades, 14, 0), c(Suit.Spades, 14, 1), c(Suit.Spades, 13, 0), c(Suit.Spades, 13, 1),
  c(Suit.Spades, 12, 0), c(Suit.Spades, 12, 1),   // 拖拉机 AAKKQQ
  c(Suit.Hearts, 14, 0), c(Suit.Hearts, 10, 0), c(Suit.Clubs, 13, 0), c(Suit.Diamonds, 11, 0),
];
const throwHand = [
  c(Suit.Spades, 14, 0), c(Suit.Spades, 13, 0), c(Suit.Spades, 12, 0), c(Suit.Spades, 11, 0),
  c(Suit.Spades, 10, 0), c(Suit.Spades, 9, 0),   // S 六连 A..9
  c(Suit.Hearts, 14, 0), c(Suit.Hearts, 13, 0), c(Suit.Hearts, 10, 0),
  c(Suit.Clubs, 12, 0), c(Suit.Diamonds, 11, 0),
];
const followHand = [
  c(Suit.Spades, 13, 0), c(Suit.Spades, 12, 0), c(Suit.Spades, 10, 0), c(Suit.Spades, 8, 0),
  c(Suit.Hearts, 14, 0), c(Suit.Hearts, 13, 0), c(Suit.Hearts, 12, 0), c(Suit.Hearts, 11, 0),
  c(Suit.Clubs, 14, 0), c(Suit.Clubs, 10, 0),
  c(Suit.Diamonds, 13, 0), c(Suit.Diamonds, 9, 0),
];

describe('ai-v2 differential (copy must behave identically to ai/)', () => {
  it('export surface: aiV2 exposes the four decision functions', () => {
    expect(typeof aiV2.aiTryReveal).toBe('function');
    expect(typeof aiV2.aiChooseBottomCards).toBe('function');
    expect(typeof aiV2.aiLeadPlay).toBe('function');
    expect(typeof aiV2.aiFollowPlay).toBe('function');
  });

  it('aiTryReveal identical across hands × levels × currentReveal states', () => {
    const hands = [lv5PairHand, lv13SingleHand, jokerPairHand];
    const levels = [5, 13, 14];
    const currs = [
      null,
      { suit: Suit.Hearts as Suit, strength: 1 },
      { suit: null as Suit | null, strength: 3 },
      { suit: Suit.Spades as Suit, strength: 2 },
    ];
    for (const h of hands) {
      for (const lv of levels) {
        for (const cur of currs) {
          const a = aiTryReveal(h, [], 0, lv, cur);
          const b = aiV2.aiTryReveal(h, [], 0, lv, cur);
          expect(b).toEqual(a);
        }
      }
    }
  });

  it('aiChooseBottomCards identical for suited and NT configs', () => {
    for (const hand of [bottomRichHand, bottomNTHand, leadTractorHand]) {
      for (const cfg of [cfg5, cfg13, cfgNT]) {
        const a = aiChooseBottomCards(hand, cfg);
        const b = aiV2.aiChooseBottomCards(hand, cfg);
        expect(ids(b.discard)).toEqual(ids(a.discard));
        expect(ids(b.keep)).toEqual(ids(a.keep));
        expect(b.reason).toBe(a.reason);
      }
    }
  });

  it('aiLeadPlay identical across configs', () => {
    for (const hand of [leadPairHand, leadTractorHand, throwHand, lv5PairHand]) {
      for (const cfg of [cfg5, cfg13, cfgNT]) {
        expectSame(aiLeadPlay(hand, cfg), aiV2.aiLeadPlay(hand, cfg));
      }
    }
  });

  it('aiFollowPlay identical for single/pair/tractor/throw and trump leads', () => {
    const leads: { cards: Card[]; suit: CardSuit }[] = [
      { cards: [c(Suit.Spades, 14, 200)], suit: Suit.Spades },                       // 副牌单张
      { cards: [c(Suit.Spades, 13, 200), c(Suit.Spades, 13, 201)], suit: Suit.Spades }, // 副牌对子
      { cards: [c(Suit.Hearts, 14, 200)], suit: Suit.Hearts },                       // 主牌单张
      { cards: [c(Suit.Hearts, 10, 200), c(Suit.Hearts, 10, 201), c(Suit.Hearts, 11, 200), c(Suit.Hearts, 11, 201)], suit: Suit.Hearts }, // 主拖拉机
      { cards: [c(Suit.Spades, 14, 210), c(Suit.Spades, 13, 210)], suit: Suit.Spades }, // 甩牌两连
      { cards: [c(Suit.Diamonds, 9, 220)], suit: Suit.Diamonds },                    // 缺门副牌
    ];
    for (const lead of leads) {
      const a = aiFollowPlay(followHand, lead.cards, lead.suit, cfg5);
      const b = aiV2.aiFollowPlay(followHand, lead.cards, lead.suit, cfg5);
      expectSame(a, b);
    }
  });

  it('lead/follow identical when driven through buildAIContext (arena-style)', () => {
    const players: PlayerState[] = [0, 1, 2, 3].map(i => ({
      hand: [] as Card[], isHuman: false, name: `AI-${i + 1}`, index: i,
    }));
    let state: GameState = createInitialState(players as [PlayerState, PlayerState, PlayerState, PlayerState], 0, 5, false);
    state = {
      ...state,
      trumpDeclaration: cfg5,
      phase: GamePhase.Playing,
      declarerIndex: 0,
      players: [
        { ...state.players[0], hand: leadTractorHand },
        { ...state.players[1], hand: followHand },
        { ...state.players[2], hand: lv5PairHand },
        { ...state.players[3], hand: bottomRichHand },
      ],
    } as GameState;

    const ctx = buildAIContext(state, 0)!;
    expect(ctx).not.toBeNull();
    expectSame(aiLeadPlay(state.players[0].hand, ctx), aiV2.aiLeadPlay(state.players[0].hand, ctx));

    const leadCards = [c(Suit.Spades, 14, 300), c(Suit.Spades, 13, 300)];
    const ctx2 = buildAIContext(state, 1)!;
    expectSame(
      aiFollowPlay(state.players[1].hand, leadCards, Suit.Spades, ctx2),
      aiV2.aiFollowPlay(state.players[1].hand, leadCards, Suit.Spades, ctx2),
    );
  });
});
