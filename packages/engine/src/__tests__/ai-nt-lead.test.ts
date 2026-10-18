/**
 * NT 长花色领出层（`ai/nt-lead.ts`）——按用户方案的 10 条重写后的行为断言。
 *
 * 层的总开关是「有长花色」（第 1 条）：`computeLongSuit(...)` 为 null 就完全走现行阶梯，
 * 调用方也就不传 `longSuit`。层内顺序：第 2/2.1 条（非长门断门 / 非长门拖拉机）
 * → 第 5 条（应甩尽甩：整段 T1 甩出），闸门判不出合法甩牌时回落到现行七步阶梯。
 */
import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import { extractComponents } from '../comparing/index.js';
import { validateLead, validateThrow } from '../leading/index.js';
import { tryNTLead } from '../ai/nt-lead.js';
import { worstCaseSuitHand } from '../ai/throw-detector.js';
import { computeLongSuit, knownOutOfPlay } from '../ai/suit-memory.js';
import { aiLeadPlay } from '../ai/index.js';
import { minimalContext } from '../ai/types.js';
import type { AIContext, NTTrumpState } from '../ai/types.js';

function c(s: CardSuit, r: number, idx: number): Card {
  return createCard(s, r, idx);
}

const cfgNT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

function ctxOf(over: Partial<AIContext> = {}): AIContext {
  return { ...minimalContext(cfgNT), ...over };
}

/** Build a trick with `Trick.plays` in play order from the leader (seat-ordered input). */
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

/** Card ranks of a play, sorted, for readable assertions. */
const ranks = (cards: Card[]): number[] => cards.map(x => x.rank).sort((a, b) => a - b);

function checkLead(play: Card[], hand: Card[]): void {
  expect(validateLead(play, hand, cfgNT).valid).toBe(true);
}

/** The ±10-throw invariant: every component must survive the worst-case hand. */
function checkNoPenalty(play: Card[], hand: Card[], ctx: AIContext): void {
  if (classify(play, cfgNT).type !== 'throw') return;
  const suit = play[0].suit as Suit;
  const ofSuit = (cards: readonly Card[]) =>
    cards.filter(x => x.suit === suit && !isTrump(x, cfgNT));
  const worst = worstCaseSuitHand(ofSuit(hand), suit, cfgNT, knownOutOfPlay(ctx, suit));
  const comps = extractComponents(play, cfgNT);
  // Tractors too: a mixed throw is classified `throw` and `checkTractorBlock`
  // runs over its tractor components, so they carry the penalty as well.
  for (const tractor of comps.tractors) {
    expect(validateThrow(tractor, hand, [worst], cfgNT).valid).toBe(true);
  }
  for (const pair of comps.pairs) {
    expect(validateThrow(pair, hand, [worst], cfgNT).valid).toBe(true);
  }
  for (const single of comps.singles) {
    expect(validateThrow([single], hand, [worst], cfgNT).valid).toBe(true);
  }
}

/** Minimal NT trump-tracker state: `possible` maps seat → trump record. */
function ntStateOf(
  possible: Record<number, Record<string, number>>,
  maxCounts: [number, number, number, number],
): NTTrumpState {
  const slots: (Record<string, number> | null)[] = [null, {}, {}, {}, {}];
  for (const [idx, rec] of Object.entries(possible)) slots[Number(idx)] = rec;
  return {
    knownTrumpsPerPlayer: [[], [], [], []],
    playersWithNoTrump: new Set(),
    totalTrumps: 12,
    opponentTrumpCount: 0,
    remainingBigJokers: 2,
    remainingSmallJokers: 2,
    allUnseenJokersOnOurSide: false,
    allUnseenBigJokersOnOurSide: false,
    possibleTrumps: slots,
    isFullyDetermined: false,
    canFormPair: [false, false, false, false],
    canHaveJoker: [false, false, false, false],
    canHaveBigJoker: [false, false, false, false],
    canHaveSmallJoker: [false, false, false, false],
    minTrumpCounts: [0, 0, 0, 0],
    maxTrumpCounts: maxCounts,
  };
}

const declarer = (over: Partial<AIContext> = {}): AIContext => ctxOf({
  myIndex: 0, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
  declarerIndex: 0, ...over,
});

// ---- Fixtures ----

/** Pure long suit ♠ AAKKQQ J 10 9 → tier1 = {AA KK QQ J} (7), tier2 = []. */
const longHand = [
  c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
  c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
];
const longCtx = (over: Partial<AIContext> = {}) =>
  declarer({ handCounts: [longHand.length, 20, 20, 20] as [number, number, number, number], ...over });

/** Adds a blocked 99 pair → tier2 = {99}, so item 3 fires. */
const reduceHand = [
  c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
  c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 9, 0), c('S', 9, 1), c('S', 8, 0),
];

/**
 * Pairless-T1 fixture. I once held ♠ AAKKQQ J 10 9; I have played ♠ A K Q
 * (one copy each) and ♠ J 10 9, so my current ♠ holding is A K Q. With those
 * six cards out of play the three survivors are unblockable, so
 * tier1 = {A, K, Q} — a **pairless** T1, which is what §5.2/§5.3/§5.4/§8 key off.
 */
const dumpA = [c('S', 14, 1), c('S', 13, 1), c('S', 12, 1)];
const dumpB = [c('S', 11, 0), c('S', 10, 0), c('S', 9, 0)];
/** Partner (seat 2) plays no ♠ in either dump trick → marked void. */
const partnerVoidTricks = [
  trick([dumpA, [c('H', 3, 1), c('H', 4, 1), c('H', 5, 1)],
    [c('H', 6, 1), c('H', 7, 1), c('H', 8, 1)], [c('H', 9, 1), c('H', 10, 1), c('H', 11, 1)]], 0),
  trick([dumpB, [c('C', 3, 1), c('C', 4, 1), c('C', 5, 1)],
    [c('C', 6, 1), c('C', 7, 1), c('C', 8, 1)], [c('C', 9, 1), c('C', 10, 1), c('C', 11, 1)]], 0),
];
/** Partner follows the ♠ lead in full both times → not void. */
const partnerFilledTricks = [
  trick([dumpA, [c('H', 3, 1), c('H', 4, 1), c('H', 5, 1)],
    [c('S', 8, 0), c('S', 7, 0), c('S', 6, 0)], [c('H', 9, 1), c('H', 10, 1), c('H', 11, 1)]], 0),
  trick([dumpB, [c('C', 3, 1), c('C', 4, 1), c('C', 5, 1)],
    [c('S', 5, 0), c('S', 4, 0), c('S', 3, 0)], [c('C', 9, 1), c('C', 10, 1), c('C', 11, 1)]], 0),
];
const loneControlHand = [c('S', 14, 0), c('S', 13, 0), c('S', 12, 0)];

/** Both opponents provably cannot trump a 3-card lead. */
const cantTrump = ntStateOf({}, [0, 0, 0, 0]);
/** Both opponents hold three trumps of assorted suits → they may trump. */
const mayTrump = ntStateOf(
  { 1: { 'S-2': 1, 'H-2': 1, 'C-2': 1 }, 3: { 'S-2': 1, 'H-2': 1, 'C-2': 1 } },
  [0, 3, 0, 3],
);
const pairlessCtx = (over: Partial<AIContext> = {}) => declarer({
  handCounts: [loneControlHand.length, 22, 22, 22] as [number, number, number, number],
  trickHistory: partnerVoidTricks, ...over,
});

describe('NT lead layer — 只处理长花色 T1，非长门交给其他档', () => {
  it('长花色 T1 优先于非长门断门', () => {
    const hand = [...longHand, c('H', 14, 0), c('H', 14, 1)];
    const r = tryNTLead(hand, longCtx(), Suit.Spades);
    checkLead(r!.cards, hand);
    expect(r!.cards.every(x => x.suit === Suit.Spades)).toBe(true);
    expect(r!.reason).toBe('长花色控制张(7张)');
  });

  it('非长门拖拉机不再由本层出；T1 单/对等待时返回 null', () => {
    // 当前长花色只剩 ♠AA（一对），初始手牌里的另外 7 张已由我打出。
    const playedSpades = [
      c('S', 14, 1), c('S', 14, 2), c('S', 13, 1), c('S', 13, 2),
      c('S', 11, 1), c('S', 10, 1), c('S', 9, 1),
    ];
    const played = trick([
      playedSpades,
      [c('H', 3, 1), c('H', 4, 1), c('H', 5, 1), c('H', 6, 1), c('H', 7, 1), c('H', 8, 1), c('H', 9, 1)],
      [c('C', 3, 1), c('C', 4, 1), c('C', 5, 1), c('C', 6, 1), c('C', 7, 1), c('C', 8, 1), c('C', 9, 1)],
      [c('D', 3, 1), c('D', 4, 1), c('D', 5, 1), c('D', 6, 1), c('D', 7, 1), c('D', 8, 1), c('D', 9, 1)],
    ], 0);
    const hand = [
      c('S', 12, 0), c('S', 12, 3),
      c('D', 14, 0), c('D', 14, 1), c('D', 13, 0), c('D', 13, 1), c('D', 5, 0), c('D', 5, 1),
      c('C', 7, 3),
    ];
    const ctx = declarer({
      handCounts: [hand.length, 22, 22, 22] as [number, number, number, number],
      trickHistory: [played],
    });
    expect(computeLongSuit(hand, ctx)).toBe(Suit.Spades);
    expect(tryNTLead(hand, ctx, Suit.Spades)).toBeNull();
  });
});

describe('NT lead layer — 长花色闸门：拖拉机也过 worst-case 校验', () => {
  /**
   * ♠ AAKKQQ + 55 44（10 张）。55-44 是**结构性拖拉机**（两对连张），
   * `computeOffSuitControls` 的 tier1 第 (b) 条把它**无条件**收进 T1——
   * 尽管未见的 ♠（JJ 1010 99 88 77 66 33）里就有一手更高的两对拖拉机。
   * 闸门过去对拖拉机无条件放行，于是这手 10 张整手甩出、被引擎按
   * `checkTractorBlock` 判非法（±10 分 + 强制降级）——实测的甩牌罚分全是这个形状。
   */
  const blockedTractorHand = [
    c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
    c('S', 12, 0), c('S', 12, 1), c('S', 5, 0), c('S', 5, 1),
    c('S', 4, 0), c('S', 4, 1),
  ];

  it('drops the blockable tractor instead of leading an illegal throw', () => {
    const ctx = declarer({ handCounts: [10, 20, 20, 20] as [number, number, number, number] });
    const r = tryNTLead(blockedTractorHand, ctx, Suit.Spades);
    checkLead(r!.cards, blockedTractorHand);
    checkNoPenalty(r!.cards, blockedTractorHand, ctx);
    // 55-44 被 worst case 的 JJ-1010 拖拉机盖过 → 被闸门丢掉。
    expect(r!.cards.some(x => x.rank === Rank.Five)).toBe(false);
    expect(r!.cards.some(x => x.rank === Rank.Four)).toBe(false);
    // 剩下的 AA KK QQ 仍是一手合法领出。
    expect(ranks(r!.cards)).toEqual([12, 12, 13, 13, 14, 14]);
  });
});

describe('NT lead layer — 第 5 条：T1 整段甩出（第 3 条减量已撤）', () => {
  it('plays the whole T1 when no T2 is left', () => {
    const ctx = longCtx();
    const r = tryNTLead(longHand, ctx, Suit.Spades);
    checkLead(r!.cards, longHand);
    checkNoPenalty(r!.cards, longHand, ctx);
    expect(ranks(r!.cards)).toEqual([11, 12, 12, 13, 13, 14, 14]);
    expect(r!.reason).toBe('长花色控制张(7张)');
  });

  it('plays the whole T1 even when T2 is non-empty (no reduction to the longest sub-pattern)', () => {
    // 撤第 3 条前：T1 = AA KK QQ J（甩牌）且 T2 = {99} → 只出 AA KK QQ 拖拉机（6 张）。
    // 撤后：不再为留 T2 而减量，整段 T1 一起出。
    const ctx = declarer({ handCounts: [10, 20, 20, 20] as [number, number, number, number] });
    const r = tryNTLead(reduceHand, ctx, Suit.Spades);
    checkLead(r!.cards, reduceHand);
    checkNoPenalty(r!.cards, reduceHand, ctx);
    expect(ranks(r!.cards)).toEqual([11, 12, 12, 13, 13, 14, 14]);
    expect(r!.reason).toBe('长花色控制张(7张)');
  });

  it('no longer holds a T1 single back for a later lead', () => {
    const ctx = declarer({ handCounts: [10, 20, 20, 20] as [number, number, number, number] });
    const r = tryNTLead(reduceHand, ctx, Suit.Spades);
    // ♠J 属于 T1，现在随整段 T1 一起打出（撤第 3 条前会被扣下）。
    expect(r!.cards.some(x => x.rank === Rank.Jack)).toBe(true);
  });
});

describe('NT lead layer — T1 无对：也应甩尽甩（第 8 / 5.2 / 5.3 / 5.4 条已撤）', () => {
  it('the fixture really is a pairless 3-card T1', () => {
    const init = [...loneControlHand, ...dumpA, ...dumpB];
    expect(computeLongSuit(init, pairlessCtx())).toBe(Suit.Spades);
  });

  it('throws the whole pairless T1 when both opponents provably cannot trump it', () => {
    const r = tryNTLead(loneControlHand, pairlessCtx({ ntState: cantTrump }), Suit.Spades);
    checkLead(r!.cards, loneControlHand);
    expect(ranks(r!.cards)).toEqual([12, 13, 14]);
    expect(r!.reason).toBe('长花色控制张(3张)');
  });

  it('still throws it when an opponent could trump — 第 5.2 条（转吊主）已撤', () => {
    const hand = [...loneControlHand, c('J', 16, 9)];
    const r = tryNTLead(hand, pairlessCtx({ ntState: mayTrump }), Suit.Spades);
    checkLead(r!.cards, hand);
    expect(ranks(r!.cards)).toEqual([12, 13, 14]);
    expect(r!.reason).toBe('长花色控制张(3张)');
  });

  it('throws it with no trump even when the partner is void — 第 5.3 条（喂队友）已撤', () => {
    const r = tryNTLead(loneControlHand, pairlessCtx({ ntState: mayTrump }), Suit.Spades);
    expect(ranks(r!.cards)).toEqual([12, 13, 14]);
    expect(r!.reason).toBe('长花色控制张(3张)');
  });

  it('throws it even when the partner still holds the suit — 第 5.4 条（弃权）已撤', () => {
    const ctx = declarer({
      handCounts: [3, 22, 22, 22] as [number, number, number, number],
      trickHistory: partnerFilledTricks, ntState: mayTrump,
    });
    const r = tryNTLead(loneControlHand, ctx, Suit.Spades);
    checkLead(r!.cards, loneControlHand);
    expect(ranks(r!.cards)).toEqual([12, 13, 14]);
    expect(r!.reason).toBe('长花色控制张(3张)');
  });

  it('without a tracker it throws the pairless T1 too — 第 8 条（两家毙不了）已撤', () => {
    const r = tryNTLead(loneControlHand, pairlessCtx(), Suit.Spades);
    expect(ranks(r!.cards)).toEqual([12, 13, 14]);
    expect(r!.reason).toBe('长花色控制张(3张)');
  });
});

describe('NT lead layer — scope and safety', () => {
  it('does nothing outside NT', () => {
    const suited: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const ctx: AIContext = { ...minimalContext(suited), myIndex: 0, isDeclarer: true };
    expect(tryNTLead(longHand, ctx, Suit.Spades)).toBeNull();
  });

  it('does nothing without a seat index', () => {
    expect(tryNTLead(longHand, ctxOf({ myIndex: -1 }), Suit.Spades)).toBeNull();
  });

  it('the general ladder still runs when the layer abstains', () => {
    const suited: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const r = aiLeadPlay(longHand, suited);
    expect(validateLead(r.cards, longHand, suited).valid).toBe(true);
  });

  it('abstains once my cards in the long suit are all gone', () => {
    const hand = [c('H', 3, 0), c('C', 4, 0)];
    const ctx = declarer({
      handCounts: [2, 10, 10, 10] as [number, number, number, number],
      trickHistory: partnerVoidTricks,
    });
    expect(tryNTLead(hand, ctx, Suit.Spades)).toBeNull();
    const ladder = aiLeadPlay(hand, ctx);
    expect(validateLead(ladder.cards, hand, cfgNT).valid).toBe(true);
  });

  it('keeps the long suit after it has been trumped', () => {
    const trumped = trick([
      [c('S', 4, 0)], [c('J', 15, 1)], [c('C', 3, 2)], [c('C', 4, 3)],
    ], 0, 1);
    const ctx = declarer({
      handCounts: [9, 20, 20, 20] as [number, number, number, number], trickHistory: [trumped],
    });
    expect(computeLongSuit(longHand, ctx)).toBe(Suit.Spades);
    const r = tryNTLead(longHand, ctx, Suit.Spades);
    checkLead(r!.cards, longHand);
    checkNoPenalty(r!.cards, longHand, ctx);
    expect(r!.cards.every(x => x.suit === Suit.Spades)).toBe(true);
  });

  it('a trick led by someone else never turns their cards into my controls', () => {
    // 回归：`plays` 按出牌顺序存放；领出者不是自己时按座位号读会读到别人的牌，
    // 把别人的 ♥AAK 记成"我出的"，我手上的 ♥K 就被提升成 ♥ 控制张领出去。
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 0), c('S', 13, 1),
      c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 10, 0), c('S', 9, 0),
      c('H', 13, 0), c('H', 5, 0),
    ];
    const ledByP1 = trick([
      [c('C', 3, 0), c('C', 4, 0), c('C', 5, 0)],
      [c('H', 14, 0), c('H', 14, 1), c('H', 13, 1)],
      [c('D', 4, 0), c('D', 5, 0), c('D', 6, 0)],
      [c('D', 7, 0), c('D', 8, 0), c('D', 9, 0)],
    ], 1);
    const ctx = declarer({
      handCounts: [11, 22, 22, 22] as [number, number, number, number], trickHistory: [ledByP1],
    });
    const r = tryNTLead(hand, ctx, Suit.Spades);
    checkLead(r!.cards, hand);
    // ♥K must not be treated as a ♥ control (the bug led it), so ♥ is never the
    // drain target; the long suit takes over.
    expect(r!.cards.every(x => x.suit === Suit.Spades)).toBe(true);
  });
});

describe('NT lead layer — 层无提案时回落到出副牌大牌（第 6 条已撤）', () => {
  /** Long suit whose controls are all spent; the off-suit top rank sits in ♦. */
  const spentHand = [
    c('S', 8, 0), c('S', 7, 0), c('S', 6, 0), c('S', 5, 0),
    c('D', 14, 0), c('D', 6, 0), c('D', 7, 0),
  ];

  it('cashes the non-long top card when the layer has nothing to propose', () => {
    // I once held ♠ AAKKQQ J 10 9 in one lead; it is now all played.
    const nineLead = [
      c('S', 14, 1), c('S', 14, 2), c('S', 13, 1), c('S', 13, 2), c('S', 12, 1),
      c('S', 12, 2), c('S', 11, 1), c('S', 10, 1), c('S', 9, 1),
    ];
    const nineTrick = trick([nineLead,
      [c('H', 3, 1), c('H', 4, 1), c('H', 5, 1), c('H', 6, 1), c('H', 7, 1),
        c('H', 8, 1), c('H', 9, 1), c('H', 10, 1), c('H', 11, 1)],
      [c('C', 3, 1), c('C', 4, 1), c('C', 5, 1), c('C', 6, 1), c('C', 7, 1),
        c('C', 8, 1), c('C', 9, 1), c('C', 10, 1), c('C', 11, 1)],
      [c('D', 3, 1), c('D', 4, 1), c('D', 5, 1), c('D', 6, 1), c('D', 7, 1),
        c('D', 8, 1), c('D', 9, 1), c('D', 10, 1), c('D', 11, 1)]], 0);
    // Last trick led by seat 1 so the one-trick-window rules at priority 0
    // cannot fire; the layer has nothing to propose, so the general ladder runs.
    const lastByP1 = trick([
      [c('H', 5, 2), c('H', 6, 2)], [c('H', 7, 2), c('H', 8, 2)],
      [c('H', 9, 2), c('H', 10, 2)], [c('H', 11, 2), c('H', 12, 2)],
    ], 1);
    const ctx = ctxOf({
      myIndex: 0, isDeclarer: true, declarerIndex: 0, isAttacker: false,
      handCounts: [7, 15, 15, 15] as [number, number, number, number],
      trickHistory: [nineTrick, lastByP1], ntState: cantTrump,
    });
    expect(computeLongSuit(spentHand, ctx)).toBe(Suit.Spades);
    const r = aiLeadPlay(spentHand, ctx);
    expect(validateLead(r.cards, spentHand, cfgNT).valid).toBe(true);
    expect(r.cards.some(x => x.suit === Suit.Diamonds && x.rank === Rank.Ace)).toBe(true);
  });

  it('without a long suit the same hand does cash the top card', () => {
    // Same shape, but the spades never became a long suit (only 4 played).
    const fourLead = [c('S', 14, 1), c('S', 14, 2), c('S', 13, 1), c('S', 13, 2)];
    const fourTrick = trick([fourLead,
      [c('H', 3, 1), c('H', 4, 1), c('H', 5, 1), c('H', 6, 1)],
      [c('C', 3, 1), c('C', 4, 1), c('C', 5, 1), c('C', 6, 1)],
      [c('D', 3, 1), c('D', 4, 1), c('D', 5, 1), c('D', 6, 1)]], 0);
    const lastByP1 = trick([
      [c('H', 5, 2), c('H', 6, 2)], [c('H', 7, 2), c('H', 8, 2)],
      [c('H', 9, 2), c('H', 10, 2)], [c('H', 11, 2), c('H', 12, 2)],
    ], 1);
    const ctx = ctxOf({
      myIndex: 0, isDeclarer: true, declarerIndex: 0, isAttacker: false,
      handCounts: [7, 15, 15, 15] as [number, number, number, number],
      trickHistory: [fourTrick, lastByP1], ntState: cantTrump,
    });
    expect(computeLongSuit(spentHand, ctx)).toBeNull();
    const r = aiLeadPlay(spentHand, ctx);
    expect(r.cards.some(x => x.rank === Rank.Ace)).toBe(true);
    expect(r.reason).toBe('出♦A');
  });
});
