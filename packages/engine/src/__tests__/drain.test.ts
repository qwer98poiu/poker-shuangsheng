/**
 * 庄1：全控花色 / A 类。
 *
 * 规格见 plan.md §4.1：整门安全甩 → 安全的含顶张整手（最大集合，不要求含拖拉机）
 * → 顶张拖拉机 → 顶张对 → 顶张单张；非顶对不单独出。NT 长门用动态顶张，
 * 24 张反推整门全出。
 */
import { describe, it, expect } from 'vitest';
import { createCard } from '../model.js';
import { Suit, Rank } from '../types.js';
import type { Card, CardSuit, PlayedCards, Trick, TrumpDeclaration } from '../types.js';
import { classify } from '../pattern/index.js';
import type { AIContext, NTTrumpState } from '../ai/types.js';
import { minimalContext } from '../ai/types.js';
import { tryDrain, tryLoneNonTopPair, isAllControlSuit } from '../ai/drain.js';
import { aiLeadPlay } from '../ai/index.js';

const CFG: TrumpDeclaration = { trumpSuit: Suit.Spades, level: Rank.Two, declarerIndex: 0 };
const NT_CFG: TrumpDeclaration = { trumpSuit: null, level: Rank.Two, declarerIndex: 0 };

let idSeq = 0;
const c = (suit: CardSuit, rank: number): Card => createCard(suit, rank as Rank, idSeq++);
const H = Suit.Hearts;
const S = Suit.Spades;
const C = Suit.Clubs;
const D = Suit.Diamonds;
const show = (cards: Card[]): string[] => cards.map(x => `${x.suit}${x.rank}`);
const junk = (): Card[] => [c(C, 7), c(D, 8), c(S, 3)];

function ctxOf(hand: Card[], cfg: TrumpDeclaration = CFG, over: Partial<AIContext> = {}): AIContext {
  return {
    ...minimalContext(cfg),
    myIndex: 0,
    isDeclarer: true,
    isDeclarerPartner: false,
    isAttacker: false,
    handCounts: [hand.length, 25, 25, 25] as const,
    ...over,
  };
}

function run(hand: Card[], cfg: TrumpDeclaration = CFG, longSuit: Suit | null = null) {
  return tryDrain(hand, ctxOf(hand, cfg), longSuit);
}

/** 一墩（plays 槽位不要求与座位对齐；knownOutOfPlay 只摊平所有牌）。 */
function trickOf(cards: Card[], cfg: TrumpDeclaration = NT_CFG): Trick {
  const chunks: Card[][] = [[], [], [], []];
  cards.forEach((card, i) => chunks[i % 4].push(card));
  return {
    plays: chunks.map(cs => ({
      cards: cs,
      pattern: classify(cs, cfg),
      leadSuit: H,
    })) as [PlayedCards, PlayedCards, PlayedCards, PlayedCards],
    leadPlayerIndex: 0,
    winnerIndex: 0,
    points: 0,
  };
}

/** 只填 canPlayerTrumpThrow 会读的字段。 */
function ntStateOf(possible: Record<number, Record<string, number>>): NTTrumpState {
  const slots: (Record<string, number> | null)[] = [null, {}, {}, {}, {}];
  const maxes: [number, number, number, number] = [0, 0, 0, 0];
  for (const [idx, rec] of Object.entries(possible)) {
    slots[Number(idx)] = rec;
    let t = 0;
    for (const n of Object.values(rec)) t += Math.min(n, 2);
    maxes[Number(idx)] = t;
  }
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
    maxTrumpCounts: maxes,
  };
}

describe('庄1 — 全控 / A 类', () => {
  it('♥A4433 全控 → 出 ♥A；之后 ♥4433 仍全控 → 出拖拉机', () => {
    const hand = [c(H, 14), c(H, 4), c(H, 4), c(H, 3), c(H, 3), ...junk()];
    const first = run(hand)!;
    expect(show(first.cards)).toEqual(['H14']);
    expect(first.reason).toBe('出♥A');

    const rest = hand.filter(x => x.rank !== 14);
    const second = run(rest)!;
    expect(show(second.cards)).toEqual(['H4', 'H4', 'H3', 'H3']);
    expect(second.reason).toBe('出♥拖拉机(2对)');
  });

  it('♥A4433+7（非全控 A 类）→ 先出 ♥A；剩 4433+7 不再由庄1接', () => {
    const hand = [c(H, 14), c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(H, 7), ...junk()];
    const first = aiLeadPlay(hand, ctxOf(hand));
    expect(show(first.cards)).toEqual(['H14']);
    expect(first.reason).toBe('出♥A');

    const rest = hand.filter(x => x.rank !== 14);
    expect(run(rest)).toBeNull();
  });

  it('♥AA6655 全控 → 先 ♥AA；之后 ♥6655 仍全控', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 6), c(H, 6), c(H, 5), c(H, 5), ...junk()];
    const first = run(hand)!;
    expect(show(first.cards)).toEqual(['H14', 'H14']);
    expect(first.reason).toBe('出♥A对');

    const rest = hand.filter(x => !(x.suit === H && x.rank === 14));
    const second = run(rest)!;
    expect(show(second.cards)).toEqual(['H6', 'H6', 'H5', 'H5']);
  });

  it('♥AAKK88 全控 → 先 ♥AAKK；之后 88 退出全控，庄1不再接', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 13), c(H, 8), c(H, 8), ...junk()];
    const first = run(hand)!;
    expect(show(first.cards)).toEqual(['H14', 'H14', 'H13', 'H13']);
    expect(first.reason).toBe('出♥拖拉机(2对)');

    const rest = hand.filter(x => x.rank !== 14 && x.rank !== 13);
    expect(run(rest)).toBeNull();
  });

  it('♥AAQQJJ + 杂牌 → 整门安全甩出', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 12), c(H, 12), c(H, 11), c(H, 11), ...junk()];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H14', 'H14', 'H12', 'H12', 'H11', 'H11']);
    expect(r.reason).toBe('甩♥副牌(6张)');
  });

  it('♥AA4433 的整手甩不安全 → 只出顶张对（4433 被更大拖拉机压住）', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 4), c(H, 4), c(H, 3), c(H, 3), ...junk()];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H14', 'H14']);
  });

  it('♥AA+K+8 无拖拉机 → 不是庄1候选', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 8), ...junk()];
    expect(run(hand)).toBeNull();
  });

  it('♥AAK9988 → 含顶张的最长可甩集合 AAK（9988 被压住，不截短成 AA）', () => {
    const hand = [
      c(H, 14), c(H, 14), c(H, 13), c(H, 9), c(H, 9), c(H, 8), c(H, 8),
      ...junk(),
    ];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H14', 'H14', 'H13']);
    expect(r.reason).toBe('甩♥副牌(3张)');
  });

  it('♥A+KK+9988 → AKK（顶单与非顶对一起甩，不单独出非顶对）', () => {
    const hand = [
      c(H, 14), c(H, 13), c(H, 13), c(H, 9), c(H, 9), c(H, 8), c(H, 8),
      ...junk(),
    ];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H13', 'H13', 'H14']);
    expect(r.reason).toBe('甩♥副牌(3张)');
  });

  it('♥AAKKQQ 是一条 3 对拖拉机，不拆成 2 对', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 13), c(H, 12), c(H, 12), ...junk()];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H14', 'H14', 'H13', 'H13', 'H12', 'H12']);
  });

  it('无顶张的全控拖拉机（4433）由庄1出拖拉机', () => {
    const hand = [c(H, 4), c(H, 4), c(H, 3), c(H, 3), ...junk()];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H4', 'H4', 'H3', 'H3']);
  });

  it('跨花色张数少优先：♥A4433 的 A 压过 ♣AAKK 的拖拉机', () => {
    const hand = [
      c(H, 14), c(H, 4), c(H, 4), c(H, 3), c(H, 3),
      c(C, 14), c(C, 14), c(C, 13), c(C, 13),
      c(D, 6), c(S, 5),
    ];
    const r = run(hand)!;
    expect(show(r.cards)).toEqual(['H14']);
  });

  it('NT 长门动态顶张：A 已出尽后 K 成为顶张，KK 成为全控', () => {
    const hand = [c(H, 13), c(H, 13), ...junk()];
    const playedA = [c(H, 14), c(H, 14)];
    const ctx: AIContext = ctxOf(hand, NT_CFG, {
      isDeclarer: false,
      isAttacker: true,
      trickHistory: [trickOf(playedA)],
    });
    expect(isAllControlSuit(hand, H, ctx, H)).toBe(true);
    const r = tryDrain(hand, ctx, H)!;
    expect(show(r.cards)).toEqual(['H13', 'H13']);
  });

  it('NT 长门 24 张反推：已出 22 张 + 手牌 2 张 → 整门全出', () => {
    const all: Card[] = [];
    for (let rank = 3; rank <= 14; rank++) {
      if (rank === Rank.Two) continue;
      all.push(c(H, rank), c(H, rank));
    }
    expect(all).toHaveLength(24);
    const played = all.slice(0, 22);
    const hand = all.slice(22);
    const ctx = ctxOf(hand, NT_CFG, { isDeclarer: false, isAttacker: true, trickHistory: [trickOf(played)] });
    const r = tryDrain(hand, ctx, H)!;
    expect(show(r.cards)).toEqual(show(hand));
    expect(r.reason).toBe('长花色24张反推，整门全出');
  });
});

describe('庄2 — 非全控、无顶张、纯拖拉机', () => {
  it('♥4433+7：无顶张的纯拖拉机 → 出 ♥4433', () => {
    const hand = [c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(H, 7), ...junk()];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H4', 'H4', 'H3', 'H3']);
    expect(r.reason).toBe('出♥拖拉机(2对)');
  });

  it('跨花色“没有其他独立对”优先于最小对大小', () => {
    // ♥4433+8：无其他对；♦6655+99+7：拖拉机外加一对独立对。
    // 虽然 ♦ 的最小对更大，♥ 先赢在“没有其他独立对”。
    const hand = [
      c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(H, 8),
      c(D, 6), c(D, 6), c(D, 5), c(D, 5), c(D, 9), c(D, 9), c(D, 7),
      c(C, 4), c(S, 3),
    ];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H4', 'H4', 'H3', 'H3']);
  });

  it('同花色内对数多优先', () => {
    const hand = [
      c(H, 6), c(H, 6), c(H, 5), c(H, 5), c(H, 4), c(H, 4), c(H, 8),
      c(C, 4), c(C, 4), c(C, 3), c(C, 3), c(C, 7),
      c(D, 6), c(S, 3),
    ];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H6', 'H6', 'H5', 'H5', 'H4', 'H4']);
  });
});

describe('庄4 — 非全控、有顶张、无拖拉机', () => {
  it('♥AA+K+8 → 出安全顶张甩牌 ♥AA+K', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 8), ...junk()];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H14', 'H14', 'H13']);
    expect(r.reason).toBe('甩♥副牌(3张)');
  });

  it('♥A+KK+8 → 出安全顶张甩牌 ♥A+KK', () => {
    const hand = [c(H, 14), c(H, 13), c(H, 13), c(H, 8), ...junk()];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards).sort()).toEqual(['H13', 'H13', 'H14'].sort());
    expect(r.reason).toBe('甩♥副牌(3张)');
  });

  it('无安全甩牌 → 顶张对', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 8), ...junk()];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H14', 'H14']);
    expect(r.reason).toBe('出♥A对');
  });

  it('无对 → 顶张单张', () => {
    const hand = [c(H, 14), c(H, 8), ...junk()];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H14']);
    expect(r.reason).toBe('出♥A');
  });

  it('跨花色张数少优先：♥A+8 压过 ♣AA+8', () => {
    const hand = [c(H, 14), c(H, 8), c(C, 14), c(C, 14), c(C, 8), c(D, 6), c(S, 3)];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H14']);
  });

  it('含顶张的拖拉机不属于庄4（AAKK+8 由庄1出）', () => {
    const hand = [c(H, 14), c(H, 14), c(H, 13), c(H, 13), c(H, 8), ...junk()];
    const r = aiLeadPlay(hand, ctxOf(hand));
    expect(show(r.cards)).toEqual(['H14', 'H14', 'H13', 'H13']);
  });
});

describe('庄1.5 — 孤单非顶对（仅无主）', () => {
  const safeNt = () => ntStateOf({ 1: {}, 3: {} });

  it('♥KK 孤单、非顶张、rank ≥ J、毙牌条件成立 → 出 ♥KK', () => {
    const hand = [c(H, 13), c(H, 13), ...junk()];
    const ctx = ctxOf(hand, NT_CFG, { isDeclarer: true, isAttacker: false, ntState: safeNt() });
    const r = tryLoneNonTopPair(hand, ctx, null)!;
    expect(show(r.cards)).toEqual(['H13', 'H13']);
    expect(r.reason).toBe('出♥K对（孤单非顶对）');
    expect(show(aiLeadPlay(hand, ctx).cards)).toEqual(['H13', 'H13']);
  });

  it('顶张对（♥AA）归庄1，不由庄1.5出', () => {
    const hand = [c(H, 14), c(H, 14), ...junk()];
    const ctx = ctxOf(hand, NT_CFG, { isDeclarer: true, isAttacker: false, ntState: safeNt() });
    expect(tryLoneNonTopPair(hand, ctx, null)).toBeNull();
  });

  it('rank < J（♥10 对）不由庄1.5出', () => {
    const hand = [c(H, 10), c(H, 10), ...junk()];
    const ctx = ctxOf(hand, NT_CFG, { isDeclarer: true, isAttacker: false, ntState: safeNt() });
    expect(tryLoneNonTopPair(hand, ctx, null)).toBeNull();
  });

  it('该门还有其他牌 → 不是孤单对', () => {
    const hand = [c(H, 13), c(H, 13), c(H, 3), ...junk()];
    const ctx = ctxOf(hand, NT_CFG, { isDeclarer: true, isAttacker: false, ntState: safeNt() });
    expect(tryLoneNonTopPair(hand, ctx, null)).toBeNull();
  });

  it('毙牌条件不成立（第四家能用主对毙）→ 不出', () => {
    const hand = [c(H, 13), c(H, 13), ...junk()];
    const ctx = ctxOf(hand, NT_CFG, {
      isDeclarer: true, isAttacker: false,
      ntState: ntStateOf({ 1: {}, 3: { 'S-2': 2 } }),
    });
    expect(tryLoneNonTopPair(hand, ctx, null)).toBeNull();
  });

  it('有主局不适用', () => {
    const hand = [c(H, 13), c(H, 13), ...junk()];
    const ctx = ctxOf(hand, CFG, { isDeclarer: true, isAttacker: false });
    expect(tryLoneNonTopPair(hand, ctx, null)).toBeNull();
  });
});
