/**
 * 通用领出阶梯 5–12（`ai/generic-lead.ts`）。
 *
 * 5  直接断门副对 / J 以上副对（顶张除外）
 * 6  无主吊主（单张/对子/拖拉机）
 * 7  有主主对（两队；主拖拉机归庄4.5，庄家对家不出主对）
 * 8  10 以下副对（非分优先）
 * 9  有主单张吊主（不再分首次/非首次）
 * 10 直接断门单张 / J 以上单张（取最大）
 * 11 10 以下副单（从最长花色里挑）
 * 12 最后手牌 + 台阶防护
 */
import { describe, it, expect } from 'vitest';
import { createCard } from '../model.js';
import { Rank, Suit } from '../types.js';
import type { Card, CardSuit, Trick, TrumpDeclaration } from '../types.js';
import type { AIContext } from '../ai/types.js';
import { minimalContext } from '../ai/types.js';
import { aiLeadPlay } from '../ai/index.js';
import { classify } from '../pattern/index.js';
import {
  stepBucket,
  throwAllowedByStep,
  tryTier5Pair,
  tryTier6NTTrump,
  tryTier7TrumpPair,
  tryTier8LowPair,
  tryTier9SuitedTrump,
  tryTier10BigSingle,
  tryTier11SmallSingle,
  tryTier12LastHand,
} from '../ai/generic-lead.js';

const SPADES: TrumpDeclaration = { trumpSuit: Suit.Spades, level: Rank.Two, declarerIndex: 0 };
const HEARTS: TrumpDeclaration = { trumpSuit: Suit.Hearts, level: Rank.Five, declarerIndex: 0 };
/** 副牌口径测试的默认配置：♦ 主、级牌 8，H/S/C 都是副牌且 8 未被用到。 */
const DIAMONDS: TrumpDeclaration = { trumpSuit: Suit.Diamonds, level: Rank.Eight, declarerIndex: 0 };

let idSeq = 0;
const c = (suit: CardSuit, rank: number): Card => createCard(suit, rank as Rank, idSeq++);
const H = Suit.Hearts;
const S = Suit.Spades;
const C = Suit.Clubs;
const D = Suit.Diamonds;
const show = (cards: Card[]): string => cards.map(x => `${x.suit}${x.rank}`).join(',');

function ctxOf(cfg: TrumpDeclaration = DIAMONDS, over: Partial<AIContext> = {}): AIContext {
  return {
    ...minimalContext(cfg),
    myIndex: 0,
    isDeclarer: true,
    isDeclarerPartner: false,
    isAttacker: false,
    handCounts: [6, 6, 6, 6] as const,
    ...over,
  };
}

/** 一墩“我领出主牌”的完成墩：只填 6/9 首次判定所需的两个字段。 */
function trumpLeadTrick(leader: number, cfg: AIContext): Trick {
  const play = (cards: Card[]) => ({ cards, pattern: classify(cards, cfg), leadSuit: null as null });
  return {
    plays: [
      play([createCard(cfg.trumpSuit ?? Suit.Spades, 3, idSeq++)]),
      play([createCard(Suit.Clubs, 4, idSeq++)]),
      play([createCard(Suit.Diamonds, 4, idSeq++)]),
      play([createCard(Suit.Clubs, 6, idSeq++)]),
    ],
    leadPlayerIndex: leader,
    winnerIndex: leader,
    points: 0,
  };
}

describe('通用 5 — 直接断门副对 / J 以上副对', () => {
  it('直接断门的低对优先于 J+ 非断门对', () => {
    const hand = [c(S, 2), c(S, 2), c(H, 11), c(H, 11), c(H, 3)];
    const r = tryTier5Pair(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('S2,S2');
    expect(r.reason).toBe('出♠2对');
  });

  it('J 以上非断门对', () => {
    const hand = [c(H, 12), c(H, 12), c(H, 7)];
    const r = tryTier5Pair(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H12,H12');
  });

  it('排除顶张对', () => {
    const hand = [c(H, 14), c(H, 14), c(C, 3)];
    expect(tryTier5Pair(hand, ctxOf(), null)).toBeNull();
  });

  it('同为 J+ 取最小 effective rank', () => {
    const hand = [c(S, 12), c(S, 12), c(S, 6), c(H, 11), c(H, 11), c(H, 6)];
    const r = tryTier5Pair(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H11,H11');
  });

  it('同为直接断门时 J+ 优先', () => {
    const hand = [c(S, 2), c(S, 2), c(H, 11), c(H, 11)];
    const r = tryTier5Pair(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H11,H11');
  });
});

describe('通用 8 — 10 以下副对', () => {
  it('非直接断门的低对', () => {
    const hand = [c(H, 9), c(H, 9), c(H, 3)];
    const r = tryTier8LowPair(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H9,H9');
  });

  it('非分对优先于分对', () => {
    const hand = [c(S, 5), c(S, 5), c(S, 3), c(C, 6), c(C, 6), c(C, 4)];
    const r = tryTier8LowPair(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('C6,C6');
  });

  it('直接断门的低对归通用 5，不在本档', () => {
    const hand = [c(H, 9), c(H, 9)];
    expect(tryTier8LowPair(hand, ctxOf(), null)).toBeNull();
  });
});

describe('通用 6 = 无主吊主 / 通用 9 = 有主单张吊主', () => {
  it('有主：6 档不出，9 档出最小的小主', () => {
    const hand = [c(H, 4), c(H, 3), c(H, 13), c(S, 14)];
    const ctx = ctxOf(HEARTS);
    expect(tryTier6NTTrump(hand, ctx)).toBeNull();
    const r = tryTier9SuitedTrump(hand, ctx)!;
    expect(show(r.cards)).toBe('H3');
    expect(r.reason).toBe('吊主');
  });

  it('有主：不再区分首次/非首次，已有吊主历史仍出 9 档', () => {
    const base = ctxOf(HEARTS);
    const ctx = ctxOf(HEARTS, { trickHistory: [trumpLeadTrick(0, base)] });
    const hand = [c(H, 4), c(H, 3), c(S, 14)];
    expect(tryTier6NTTrump(hand, ctx)).toBeNull();
    const r = tryTier9SuitedTrump(hand, ctx)!;
    expect(show(r.cards)).toBe('H3');
  });

  it('没有小于 A 的小主 → 9 档不吊', () => {
    const hand = [c(H, 5), c(H, 14), c(S, 15), c(S, 16)];
    const ctx = ctxOf(HEARTS);
    expect(tryTier6NTTrump(hand, ctx)).toBeNull();
    expect(tryTier9SuitedTrump(hand, ctx)).toBeNull();
  });
});

describe('通用 7 — 吊主对 / 主拖拉机（两队）', () => {
  function nonFirst(over: Partial<AIContext> = {}): AIContext {
    const cfg = ctxOf(HEARTS, over);
    return { ...cfg, trickHistory: [trumpLeadTrick(0, cfg)] };
  }

  function attackerNonFirst(over: Partial<AIContext> = {}): AIContext {
    return nonFirst({
      myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
      handCounts: [7, 7, 7, 7] as const,
      ...over,
    });
  }

  it('有副牌分对时出最小主对', () => {
    const hand = [c(H, 3), c(H, 3), c(H, 6), c(H, 6), c(C, 10), c(C, 10), c(C, 3)];
    const r = tryTier7TrumpPair(hand, nonFirst(), 7)!;
    expect(show(r.cards)).toBe('H3,H3');
    expect(r.reason).toBe('出主对');
  });

  it('庄家只剩一对主对时仍然出：不再保留一个主对', () => {
    const hand = [c(H, 3), c(H, 3), c(C, 10), c(C, 10), c(C, 3)];
    const r = tryTier7TrumpPair(hand, nonFirst(), 5)!;
    expect(show(r.cards)).toBe('H3,H3');
    expect(r.reason).toBe('出主对');
  });

  it('闲家只剩一对主对时仍然出：同样不再保留一个主对', () => {
    const hand = [c(H, 3), c(H, 3), c(C, 10), c(C, 10), c(C, 3)];
    const r = tryTier7TrumpPair(hand, attackerNonFirst(), 5)!;
    expect(show(r.cards)).toBe('H3,H3');
    expect(r.reason).toBe('出主对');
  });

  it('庄家对家永不出主对', () => {
    const hand = [c(H, 3), c(H, 3), c(H, 6), c(H, 6), c(C, 10), c(C, 10), c(C, 3)];
    const ctx = nonFirst({
      myIndex: 2, isDeclarer: false, isDeclarerPartner: true,
      handCounts: [7, 7, 7, 7] as const,
    });
    expect(tryTier7TrumpPair(hand, ctx, 7)).toBeNull();
  });

  it('庄家没有副牌分对也可以吊主对', () => {
    const hand = [c(H, 3), c(H, 3), c(H, 6), c(H, 6), c(C, 3), c(C, 4)];
    const r = tryTier7TrumpPair(hand, nonFirst(), 6)!;
    expect(show(r.cards)).toBe('H3,H3');
    expect(r.reason).toBe('出主对');
  });

  it('闲家没有副牌分对也可以吊主对', () => {
    const hand = [c(H, 3), c(H, 3), c(H, 6), c(H, 6), c(C, 3), c(C, 4)];
    const r = tryTier7TrumpPair(hand, attackerNonFirst(), 6)!;
    expect(show(r.cards)).toBe('H3,H3');
    expect(r.reason).toBe('出主对');
  });

  it('庄家 ≥20 张时不出 A 以上主对（级牌对）', () => {
    const hand = [c(H, 5), c(H, 5), c(H, 13), c(H, 13), c(C, 10), c(C, 10), c(C, 3)];
    const r = tryTier7TrumpPair(hand, nonFirst(), 20)!;
    expect(show(r.cards)).toBe('H13,H13');
  });

  it('闲家只有主拖拉机时本档不出：不拆拖拉机取对子', () => {
    const hand = [c(H, 4), c(H, 4), c(H, 3), c(H, 3), c(C, 10), c(C, 10), c(C, 3)];
    expect(tryTier7TrumpPair(hand, attackerNonFirst(), 7)).toBeNull();
  });

  it('闲家可以出主对', () => {
    const hand = [c(H, 3), c(H, 3), c(H, 6), c(H, 6), c(C, 10), c(C, 10), c(C, 3)];
    const ctx = nonFirst({
      myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
      handCounts: [7, 7, 7, 7] as const,
    });
    const r = tryTier7TrumpPair(hand, ctx, 7)!;
    expect(show(r.cards)).toBe('H3,H3');
    expect(r.reason).toBe('出主对');
  });

  it('闲家的主拖拉机不在本档：只出独立主对，不拆拖拉机', () => {
    const hand = [
      c(H, 4), c(H, 4), c(H, 3), c(H, 3),
      c(H, 8), c(H, 8),
      c(C, 10), c(C, 10), c(C, 3),
    ];
    const ctx = nonFirst({
      myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
      handCounts: [9, 9, 9, 9] as const,
    });
    const r = tryTier7TrumpPair(hand, ctx, 9)!;
    expect(show(r.cards)).toBe('H8,H8');
    expect(r.reason).toBe('出主对');
  });
});

describe('通用 10 — 直接断门单张 / J 以上单张', () => {
  it('直接断门的低单张', () => {
    // ♥ 只剩一张（直接断门），♠ 还有两张故 Q 不是直接断门单。
    const hand = [c(H, 7), c(S, 12), c(S, 3)];
    const r = tryTier10BigSingle(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H7');
  });

  it('J 以上取最大单牌', () => {
    const hand = [c(H, 12), c(H, 11)];
    const r = tryTier10BigSingle(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H12');
  });

  it('排除顶张', () => {
    const hand = [c(H, 14), c(H, 12)];
    const r = tryTier10BigSingle(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H12');
  });

  it('不避分：K 大于 Q', () => {
    const hand = [c(H, 13), c(H, 12)];
    const r = tryTier10BigSingle(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('H13');
  });

  it('同为副单时直接断门优先于 J+ 单张', () => {
    const hand = [c(S, 2), c(H, 12)];
    const r = tryTier10BigSingle(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('S2');
  });
});

describe('通用 11 — 10 以下副单（最长花色）', () => {
  it('从最长花色里挑最小', () => {
    const hand = [c(S, 3), c(H, 9), c(H, 4)];
    const r = tryTier11SmallSingle(hand, ctxOf())!;
    expect(show(r.cards)).toBe('H4');
  });

  it('10 属于本档', () => {
    const hand = [c(S, 10), c(S, 3)];
    const r = tryTier11SmallSingle(hand, ctxOf())!;
    expect(show(r.cards)).toBe('S3');
  });

  it('只剩 J+ 单张 → null', () => {
    const hand = [c(S, 14), c(S, 12)];
    expect(tryTier11SmallSingle(hand, ctxOf())).toBeNull();
  });

  it('同长度按 SHCD：♠ 先于 ♥', () => {
    const hand = [c(H, 3), c(S, 4)];
    const r = tryTier11SmallSingle(hand, ctxOf())!;
    expect(show(r.cards)).toBe('S4');
  });
});

describe('通用 12 — 台阶防护', () => {
  it('分档边界：0 单独一档，41 起下一档', () => {
    expect([0, 1, 40, 41, 80, 81, 120, 121].map(stepBucket))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  function throwCards(): Card[] {
    return [c(S, 14), c(S, 14), c(S, 13), c(S, 13), c(S, 12), c(S, 11)];
  }

  it('闲家：40→30 不跨档可甩，41→31 跨档不可甩', () => {
    const cards = throwCards();
    const at40 = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 40 });
    const at41 = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 41 });
    expect(throwAllowedByStep(cards, at40)).toBe(true);
    expect(throwAllowedByStep(cards, at41)).toBe(false);
  });

  it('闲家：10→0 是跨档，0→−10 不跨档', () => {
    const cards = throwCards();
    const at10 = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 10 });
    const at0 = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 0 });
    expect(throwAllowedByStep(cards, at10)).toBe(false);
    expect(throwAllowedByStep(cards, at0)).toBe(true);
  });

  it('庄家方：0→10 跨档，30→40 不跨档，40→50 跨档', () => {
    const cards = throwCards();
    const at0 = ctxOf(SPADES, { attackerPoints: 0 });
    const at30 = ctxOf(SPADES, { attackerPoints: 30 });
    const at40 = ctxOf(SPADES, { attackerPoints: 40 });
    expect(throwAllowedByStep(cards, at0)).toBe(false);
    expect(throwAllowedByStep(cards, at30)).toBe(true);
    expect(throwAllowedByStep(cards, at40)).toBe(false);
  });

  it('该方已达 3 次罚分 → 防护失效', () => {
    const cards = throwCards();
    const attacker = ctxOf(SPADES, {
      isDeclarer: false, isAttacker: true, attackerPoints: 41, throwPenalties: [0, 3],
    });
    const declarer = ctxOf(SPADES, { attackerPoints: 0, throwPenalties: [3, 0] });
    expect(throwAllowedByStep(cards, attacker)).toBe(true);
    expect(throwAllowedByStep(cards, declarer)).toBe(true);
  });

  it('单一牌型不属于甩牌，不受防护', () => {
    const pair = [c(S, 9), c(S, 9)];
    const ctx = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 10 });
    expect(throwAllowedByStep(pair, ctx)).toBe(true);
  });
});

describe('通用 12 — 最后手牌', () => {
  /** AA KK JJ Q：拖拉机 + 对子 + 单张的安全甩牌（Q 只有一张，最坏情况凑不出更大的对）。 */
  function throwHand(suit: CardSuit): Card[] {
    return [
      c(suit, 14), c(suit, 14),
      c(suit, 13), c(suit, 13),
      c(suit, 11), c(suit, 11),
      c(suit, 12),
    ];
  }

  it('同一门副牌的安全甩牌：整手出', () => {
    const hand = throwHand(C);
    // 庄家方 30→40 不跨台阶（0 分时 0→10 会跨档）。
    const r = tryTier12LastHand(hand, ctxOf(DIAMONDS, { attackerPoints: 30 }), null)!;
    expect(show(r.cards)).toBe('C14,C14,C13,C13,C11,C11,C12');
    expect(r.reason).toContain('甩♣副牌');
  });

  it('台阶防护拦下时改出最小单张', () => {
    const hand = throwHand(H);
    const ctx = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 41 });
    const r = tryTier12LastHand(hand, ctx, null)!;
    expect(r.cards.length).toBe(1);
    expect(show(r.cards)).toBe('H11');
    expect(r.reason).toBe('出最小牌');
  });

  it('台阶内（40 分）仍整手甩出', () => {
    const hand = throwHand(H);
    const ctx = ctxOf(SPADES, { isDeclarer: false, isAttacker: true, attackerPoints: 40 });
    const r = tryTier12LastHand(hand, ctx, null)!;
    expect(show(r.cards)).toBe('H14,H14,H13,H13,H11,H11,H12');
  });

  it('整手是对子：不受台阶防护', () => {
    const hand = [c(C, 9), c(C, 9)];
    const r = tryTier12LastHand(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('C9,C9');
  });

  it('整手是拖拉机：不受台阶防护', () => {
    const hand = [c(C, 5), c(C, 5), c(C, 4), c(C, 4)];
    const r = tryTier12LastHand(hand, ctxOf(), null)!;
    expect(show(r.cards)).toBe('C5,C5,C4,C4');
  });

  it('混合花色：出最小单张', () => {
    const hand = [c(H, 14), c(S, 3), c(C, 2)];
    const r = tryTier12LastHand(hand, ctxOf(), null)!;
    expect(r.cards.length).toBe(1);
    expect(show(r.cards)).toBe('C2');
  });
});

describe('阶梯顺序（aiLeadPlay 集成）', () => {
  it('通用 5 在通用 9 之前：J+ 副对先出', () => {
    const hand = [c(S, 12), c(S, 12), c(S, 6), c(D, 3)];
    const ctx = ctxOf(DIAMONDS, { handCounts: [4, 25, 25, 25] as const });
    const r = aiLeadPlay(hand, ctx);
    expect(show(r.cards)).toBe('S12,S12');
  });

  it('通用 8 在通用 9 之前：低副对先于有主小主单张', () => {
    const hand = [c(S, 9), c(S, 9), c(S, 6), c(D, 3)];
    const ctx = ctxOf(DIAMONDS, { handCounts: [4, 25, 25, 25] as const });
    const r = aiLeadPlay(hand, ctx);
    expect(show(r.cards)).toBe('S9,S9');
  });

  it('有主单张吊主不再看首次/非首次：无低副对时 9 档出 D3', () => {
    const base = ctxOf(DIAMONDS, {
      myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
      handCounts: [25, 5, 25, 25] as const,
    });
    const ctx: AIContext = { ...base, trickHistory: [trumpLeadTrick(1, base)] };
    const hand = [c(D, 3), c(D, 4), c(S, 2), c(H, 2)];
    const r = aiLeadPlay(hand, ctx);
    expect(show(r.cards)).toBe('D3');
    expect(r.reason).toBe('吊主');
  });

  it('通用 10 在通用 11 之前：直接断门低单张先于长花色小牌', () => {
    const hand = [c(H, 7), c(S, 12), c(S, 3)];
    const r = aiLeadPlay(hand, ctxOf(DIAMONDS, { handCounts: [3, 25, 25, 25] as const }));
    expect(show(r.cards)).toBe('H7');
  });
});
