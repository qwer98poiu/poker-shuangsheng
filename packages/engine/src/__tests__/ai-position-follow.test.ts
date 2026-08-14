/**
 * 分位置跟牌规格（第二家/第三家/第四家）的新行为用例。
 * 覆盖：手牌数避分、拆对、毙牌三档、字面最大盖过、第三家盖毙/不毙、
 * 主牌单 A+ 规则、强牌抢权、甩牌内容感知加分、70/75 禁分、跨 40 台阶。
 * 约定：cfgS2 主花色 = ♠（S 牌都是主牌），副牌用 ♥/♣/♦。
 * 第三家 tmWin = 领出者（P0）大（bestSoFar.playerIndex=0）。
 */
import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import { validateFollow } from '../following/index.js';
import { aiFollowPlay } from '../ai/index.js';
import type { TrumpDeclaration, Card } from '../types.js';
import type { AIContext } from '../ai/types.js';

const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const cfgH5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function checkFollow(
  play: Card[], hand: Card[], lead: Card[], leadSuit: string | null, config: TrumpDeclaration,
): void {
  const lp = classify(lead, config);
  const vr = validateFollow(play, hand, lead, lp, leadSuit as any, config);
  expect(vr.valid).toBe(true);
}

function ctxOf(
  cfg: TrumpDeclaration, over: Partial<AIContext>,
): AIContext {
  return {
    declarerIndex: 0, trumpSuit: cfg.trumpSuit, level: cfg.level,
    myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: false,
    attackerPoints: 0, handCounts: [25, 25, 25, 25] as const,
    trickHistory: [], reveals: [], playCount: 1, leadPlayerIndex: 0,
    bestSoFar: null, ntState: null, bottomCards: [], debug: false,
    ...over,
  };
}

/** 第二家位置 ctx（bestSoFar = 领出者）。 */
function secondCtx(cfg: TrumpDeclaration, lead: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 1, playCount: 1, leadPlayerIndex: 0,
    bestSoFar: { cards: lead, playerIndex: 0 },
    ...over,
  });
}

/** 第三家位置 ctx：默认领出者（P0）最大（tmWin）。 */
function thirdCtx(cfg: TrumpDeclaration, lead: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 2, playCount: 2, leadPlayerIndex: 0,
    bestSoFar: { cards: lead, playerIndex: 0 },
    ...over,
  });
}

/** 第三家、第二家（对手）最大的 ctx。 */
function thirdCtxSecondWins(cfg: TrumpDeclaration, lead: Card[], secondCards: Card[]): AIContext {
  return ctxOf(cfg, {
    myIndex: 2, playCount: 2, leadPlayerIndex: 0,
    bestSoFar: { cards: secondCards, playerIndex: 1 },
  });
}

/** N 张 ♣ 副牌 filler（rank 3-12 循环）。 */
function fillerClubs(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => cc('C', (i % 10) + 3, 1000 + i));
}

// ================================================================
// 第二家
// ================================================================

describe('第二家：手牌数避分（>15 避分 / <=15 一视同仁）', () => {
  it('>15 张：同花色能盖时优先最小非分能盖', () => {
    // P0 领出 ♥-7。P1 有 ♥9(非分)、♥10(分)、♥K(分) + 14 张 ♣（>15）。
    const lead: Card[] = [cc('H', 7, 200)];
    const hand = [cc('H', 9, 0), cc('H', 10, 1), cc('H', 13, 2), ...fillerClubs(14)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(9); // 非分最小能盖
    expect(r.reason).toContain('同花色出大');
  });

  it('<=15 张：同花色能盖时最小能盖（分牌也可）', () => {
    const lead: Card[] = [cc('H', 7, 200)];
    const hand = [cc('H', 9, 0), cc('H', 10, 1), cc('H', 13, 2)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(9);
    expect(r.reason).not.toContain('加分');
  });

  it('>15 张：垫牌避分——非分单张先于分牌', () => {
    // P0 领出 ♥-A（盖不过）。P1 有 ♥5(分)、♥3(非分) + 15 张 ♣。
    const lead: Card[] = [cc('H', 14, 200)];
    const hand = [cc('H', 5, 0), cc('H', 3, 1), ...fillerClubs(15)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(3); // 非分优先
    expect(r.reason).toContain('同花色出小');
  });
});

describe('第二家：拆对规则（能盖过拆最大对，不能盖过拆最小对）', () => {
  it('只有对子且能盖过 → 拆最大对', () => {
    // P0 领出 ♥-4。P1 只有 ♥9-9、♥5-5 两对，9 能盖过 4。
    const lead: Card[] = [cc('H', 4, 200)];
    const hand = [cc('H', 9, 0), cc('H', 9, 1), cc('H', 5, 2), cc('H', 5, 3)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(9); // 拆最大对
  });

  it('只有对子且盖不过 → 拆最小对', () => {
    const lead: Card[] = [cc('H', 14, 200)];
    const hand = [cc('H', 9, 0), cc('H', 9, 1), cc('H', 5, 2), cc('H', 5, 3)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(5); // 拆最小对
  });

  it('对子领出整对垫出（不算拆对）', () => {
    const lead: Card[] = [cc('H', 5, 200), cc('H', 5, 201)];
    const hand = [cc('H', 8, 0), cc('H', 8, 1), cc('H', 3, 2)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.length).toBe(2);
    expect(r.cards.every(c => c.rank === 8)).toBe(true);
  });
});

describe('第二家：毙牌三档（强牌最大 / 领出分不小于A / 最小）', () => {
  it('手中有拖拉机 → 用最大主牌毙', () => {
    // P0 领出副牌 ♣-3。P1 缺门，有主牌 S-A、S-10、S-3 + 副牌拖拉机 ♦44-♦55。
    const lead: Card[] = [cc('C', 3, 200)];
    const hand = [
      cc('S', 14, 0), cc('S', 10, 1), cc('S', 3, 2),
      cc('D', 4, 3), cc('D', 4, 4), cc('D', 5, 5), cc('D', 5, 6),
    ];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards[0].rank).toBe(14); // 最大主牌 S-A
    expect(r.reason).toContain('用主牌毙');
  });

  it('领出分牌 → 用不小于 A 的主牌毙', () => {
    const lead: Card[] = [cc('C', 10, 200)];
    const hand = [cc('S', 14, 0), cc('S', 10, 1), cc('S', 3, 2)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards[0].rank).toBe(14); // >=A 最小
  });

  it('普通领出 → 用最小主牌毙', () => {
    const lead: Card[] = [cc('C', 3, 200)];
    const hand = [cc('S', 14, 0), cc('S', 10, 1), cc('S', 3, 2)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards[0].rank).toBe(3); // 最小主牌
  });
});

describe('第二家：对子/拖拉机领出字面用最大盖过', () => {
  it('副牌对子领出：能盖过 → 用最大对子盖', () => {
    const lead: Card[] = [cc('H', 5, 200), cc('H', 5, 201)];
    const hand = [cc('H', 8, 0), cc('H', 8, 1), cc('H', 10, 2), cc('H', 10, 3)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.every(c => c.rank === 10)).toBe(true); // 最大对
    expect(r.reason).toContain('同花色出大');
  });

  it('副牌对子领出：盖不过 → 出最小对', () => {
    const lead: Card[] = [cc('H', 12, 200), cc('H', 12, 201)];
    const hand = [cc('H', 8, 0), cc('H', 8, 1), cc('H', 10, 2), cc('H', 10, 3)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.every(c => c.rank === 8)).toBe(true); // 最小对
  });
});

describe('第二家：主牌单张领出', () => {
  it('有拖拉机/可甩副牌 → 出最大主牌（不管能否盖过）', () => {
    // P0 领出主牌 S-K。P1 有主牌 S-A、S-5 和副牌拖拉机 ♣33-♣44。
    const lead: Card[] = [cc('S', 13, 200)];
    const hand = [
      cc('S', 14, 0), cc('S', 5, 1),
      cc('C', 3, 2), cc('C', 3, 3), cc('C', 4, 4), cc('C', 4, 5),
    ];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards[0].rank).toBe(14); // 最大主牌
  });

  it('无强牌 → 出最小主牌（不一定盖过）', () => {
    const lead: Card[] = [cc('S', 13, 200)];
    const hand = [cc('S', 14, 0), cc('S', 5, 1), cc('S', 3, 2)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards[0].rank).toBe(3); // 最小主牌，不盖
  });
});

describe('第二家：毙甩牌', () => {
  it('甩牌只含单张 → 毙牌不小于 A（无 >=A 用最大）', () => {
    // P0 甩 ♣3、♣4（两张单）。P1 缺门全主，有主牌 S-K、S-5。
    const lead: Card[] = [cc('C', 3, 200), cc('C', 4, 201)];
    const hand = [cc('S', 13, 0), cc('S', 5, 1)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards.length).toBe(2);
    expect(r.cards.some(c => c.rank === 13)).toBe(true); // 最大能毙 S-K
  });

  it('庄家方 + 已出含分且得分+已出 >= 80 → 出最大能毙', () => {
    // 庄家方（isAttacker=false），闲家得分 75，领出 ♣10（10分）→ 75+10=85 >= 80。
    const lead: Card[] = [cc('C', 10, 200)];
    const hand = [cc('S', 14, 0), cc('S', 8, 1)];
    const ctx = secondCtx(cfgS2, lead, { attackerPoints: 75, isAttacker: false });
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards[0].rank).toBe(14);
  });
});

describe('第二家：甩主牌垫牌（>15 张避分）', () => {
  it('>15 张：垫主牌避分（非分先）', () => {
    // P0 甩主牌 S-K、S-Q。P1 有主牌 S-10(分)、S-3、S-2 + 15 张 ♣ 副牌。
    const lead: Card[] = [cc('S', 13, 200), cc('S', 12, 201)];
    const hand = [cc('S', 10, 0), cc('S', 3, 1), cc('S', 2, 2), ...fillerClubs(15)];
    const ctx = secondCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards.some(c => c.suit === 'S' && c.rank === 3)).toBe(true);
    // 主A下分单（S10）先于级牌 S2（主A或更大）——需垫 2 张，S10 出、级牌 S2 留手
    expect(r.cards.some(c => c.suit === 'S' && c.rank === 10)).toBe(true);
    expect(r.cards.some(c => c.suit === 'S' && c.rank === 2)).toBe(false);
  });
});

// ================================================================
// 第三家
// ================================================================

describe('第三家：领出副牌单张顶张（A，A为等级时K）', () => {
  it('第二家没毙（领出者大）→ 优先加副牌分（不拆对）', () => {
    // P0 领出 ♥-A。第二家跟 ♥-7（没盖过）。P2 有 ♥10、♥10（对子）、♥3。
    const lead: Card[] = [cc('H', 14, 200)];
    const hand = [cc('H', 10, 0), cc('H', 3, 1)];
    const ctx = thirdCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(10); // 加副10分
    expect(r.reason).toContain('加分');
  });

  it('副牌没分 → 出最小副牌', () => {
    const lead: Card[] = [cc('H', 14, 200)];
    const hand = [cc('H', 9, 0), cc('H', 3, 1)];
    const ctx = thirdCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(3);
  });

  it('第二家毙了且不能盖毙 → 出最小副牌不加分', () => {
    // 第二家用主牌 S-8 毙了 ♥-A（第二家大）。P2 有 ♥9、♥3（同花色）。
    const ctx = thirdCtxSecondWins(cfgS2, [cc('H', 14, 200)], [cc('S', 8, 100)]);
    const hand = [cc('H', 9, 0), cc('H', 3, 1)];
    const r = aiFollowPlay(hand, [cc('H', 14, 200)], Suit.Hearts, ctx);
    checkFollow(r.cards, hand, [cc('H', 14, 200)], 'H', cfgS2);
    expect(r.cards[0].rank).toBe(3); // 最小，不加分
    expect(r.reason).toContain('同花色出小');
  });

  it('手牌全主（缺门）→ 出主分（毙）加分', () => {
    // P0 领出 ♠-A（顶张，cfgH5 主 ♥）。P2 缺门，只有主牌 H-10(分)、H-3。
    const lead: Card[] = [cc('S', 14, 200)];
    const hand = [cc('H', 10, 0), cc('H', 3, 1)];
    const ctx = thirdCtx(cfgH5, lead);
    const r = aiFollowPlay(hand, lead, Suit.Spades, ctx);
    checkFollow(r.cards, hand, lead, 'S', cfgH5);
    expect(r.cards[0].rank).toBe(10); // 主分（非常主 10）
    expect(r.reason).toContain('加分');
  });
});

describe('第三家：领出副牌非顶张单张', () => {
  it('能盖过两家 → 出最大牌', () => {
    // P0 领出 ♥-7。第二家 ♥-9 盖过（第二家大）。P2 有 ♥A、♥10 → 出最大 ♥A。
    const lead: Card[] = [cc('H', 7, 200)];
    const ctx = thirdCtxSecondWins(cfgS2, lead, [cc('H', 9, 100)]);
    const hand = [cc('H', 14, 0), cc('H', 10, 1), cc('H', 3, 2)];
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(14); // 最大牌
    expect(r.reason).toContain('同花色出大');
  });

  it('盖不过 → 出最小', () => {
    const lead: Card[] = [cc('H', 7, 200)];
    const ctx = thirdCtxSecondWins(cfgS2, lead, [cc('H', 14, 100)]);
    const hand = [cc('H', 10, 0), cc('H', 3, 1)];
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(3);
  });
});

describe('第三家：副牌对子领出字面用最大盖过', () => {
  it('对子领出能盖过 → 用最大对子盖', () => {
    // P0 领出 ♥5-5。第二家 ♥6-6 盖过（第二家大）。P2 有 ♥8-8、♥10-10。
    const lead: Card[] = [cc('H', 5, 200), cc('H', 5, 201)];
    const ctx = thirdCtxSecondWins(cfgS2, lead, [cc('H', 6, 100), cc('H', 6, 101)]);
    const hand = [cc('H', 8, 0), cc('H', 8, 1), cc('H', 10, 2), cc('H', 10, 3)];
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.every(c => c.rank === 10)).toBe(true); // 最大对
  });
});

describe('第三家：领出大（队友）时缺门不毙', () => {
  it('领出对子 < J → 毙最小', () => {
    // P0 领出 ♥10-10（小于 J）。P2 缺门，有主牌 S-A、S-8 → 毙最小 S-8。
    const lead: Card[] = [cc('H', 10, 200), cc('H', 10, 201)];
    const hand = [cc('S', 14, 0), cc('S', 8, 1)];
    const ctx = thirdCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(8); // 最小毙
  });

  it('领出对子 >= J → 不毙，垫牌（一视同仁）', () => {
    // P0 领出 ♥J-J（>= J）。P2 缺门能毙但不毙，垫最小副牌。
    const lead: Card[] = [cc('H', 11, 200), cc('H', 11, 201)];
    const hand = [cc('S', 14, 0), cc('S', 8, 1), cc('C', 3, 2), cc('D', 5, 3)];
    const ctx = thirdCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.some(c => c.suit === 'S')).toBe(false); // 不毙
    expect(r.cards.every(c => !isTrump(c, cfgS2))).toBe(true); // 垫副牌
    expect(r.reason).toContain('垫牌');
  });

  it('领出拖拉机 → 不毙，垫牌加分', () => {
    // P0 领出 ♥JJ-QQ 拖拉机。P2 缺门能毙但不毙（拖拉机），垫分加分。
    const lead: Card[] = [
      cc('H', 11, 200), cc('H', 11, 201),
      cc('H', 12, 200), cc('H', 12, 201),
    ];
    const hand = [cc('S', 14, 0), cc('S', 8, 1), cc('C', 10, 2), cc('D', 5, 3), cc('C', 7, 4), cc('D', 8, 5)];
    const ctx = thirdCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.some(c => c.suit === 'S')).toBe(false); // 不毙（副牌够垫）
    expect(r.cards.some(c => c.rank === 10 && c.suit === 'C')).toBe(true); // 垫分
    expect(r.reason).toContain('加分');
  });
});

describe('第三家：主牌单张领出（第4条）', () => {
  it('出 A 或更大且盖过前两家', () => {
    // P0 领出主牌 S-5。第二家 S-7 盖过。P2 有 S-A、S-10 → 出 >=A 最小 S-A。
    const lead: Card[] = [cc('S', 5, 200)];
    const ctx = thirdCtxSecondWins(cfgS2, lead, [cc('S', 7, 100)]);
    const hand = [cc('S', 14, 0), cc('S', 10, 1), cc('S', 3, 2)];
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards[0].rank).toBe(14);
    expect(r.reason).toContain('同花色出大');
  });

  it('盖不过前两家 → 出最小主牌且不加分', () => {
    const lead: Card[] = [cc('S', 5, 200)];
    const ctx = thirdCtxSecondWins(cfgS2, lead, [cc('S', 14, 100)]);
    const hand = [cc('S', 10, 0), cc('S', 3, 1)];
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards[0].rank).toBe(3);
    expect(r.reason).toContain('同花色出小');
  });

  it('有强牌 → 出最大主牌（盖过）', () => {
    // P0 领出主牌 S-5。第二家 S-7 盖过。P2 有主牌 S-A、S-3 + 副牌拖拉机 ♣44-♣55。
    const lead: Card[] = [cc('S', 5, 200)];
    const ctx = thirdCtxSecondWins(cfgS2, lead, [cc('S', 7, 100)]);
    const hand = [
      cc('S', 14, 0), cc('S', 3, 1),
      cc('C', 4, 2), cc('C', 4, 3), cc('C', 5, 4), cc('C', 5, 5),
    ];
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards[0].rank).toBe(14); // 最大能盖
  });
});

describe('第三家：主牌对子领出（第5条）', () => {
  it('领出更大且有强牌 → 盖过抢权', () => {
    // P0 领出主牌 S-5-5（领出大）。第二家跟 S-3-3。P2 有 S-7-7 + 副牌拖拉机。
    const lead: Card[] = [cc('S', 5, 200), cc('S', 5, 201)];
    const second = { cards: [cc('S', 3, 100), cc('S', 3, 101)], playerIndex: 1 };
    const hand = [
      cc('S', 7, 0), cc('S', 7, 1),
      cc('C', 4, 2), cc('C', 4, 3), cc('C', 5, 4), cc('C', 5, 5),
    ];
    const ctx = thirdCtx(cfgS2, lead, { bestSoFar: second });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards.every(c => c.rank === 7)).toBe(true); // 盖过抢权
  });

  it('领出更大且无强牌 → 不盖（出最小）', () => {
    const lead: Card[] = [cc('S', 5, 200), cc('S', 5, 201)];
    const second = { cards: [cc('S', 3, 100), cc('S', 3, 101)], playerIndex: 1 };
    // 最小对 S3-3 盖不过领出 S5-5，S9-9 能盖过——无强牌 → 不盖，出最小 S3-3
    const hand = [cc('S', 9, 0), cc('S', 9, 1), cc('S', 3, 2), cc('S', 3, 3)];
    const ctx = thirdCtx(cfgS2, lead); // 第二家 S-3-3 没盖过 S-5-5 → 领出者大
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards.every(c => c.rank === 3)).toBe(true); // 不出 9-9（能盖但无强牌不盖），出最小
  });
});

describe('第三家：甩牌领出', () => {
  it('甩副牌含顶张 → 加分', () => {
    // P0 甩 ♥A、♥9（含顶张 A，领出大）。P2 短门（1 张 ♥3），填充加分。
    const lead: Card[] = [cc('H', 14, 200), cc('H', 9, 201)];
    const hand = [cc('H', 3, 0), cc('D', 10, 1), cc('C', 5, 2), cc('S', 3, 3)];
    const ctx = thirdCtx(cfgS2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.some(c => c.rank === 10 && c.suit === 'D')).toBe(true); // 垫 D-10 加分
    expect(r.reason).toContain('加分');
  });

  it('甩副牌不含顶张/拖拉机 → 垫最小，分非分一视同仁', () => {
    // P0 甩 ♥7、♥6（无顶张，领出大）。P2 短门填充：按大小垫最小（不特别加分）。
    const lead: Card[] = [cc('H', 7, 200), cc('H', 6, 201)];
    const second = { cards: [cc('H', 4, 100), cc('H', 5, 101)], playerIndex: 1 };
    const hand = [cc('H', 3, 0), cc('D', 10, 1), cc('C', 5, 2), cc('S', 3, 3)];
    const ctx = thirdCtx(cfgS2, lead, { bestSoFar: second });
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.some(c => c.suit === 'H' && c.rank === 3)).toBe(true);
    expect(r.reason).not.toContain('队友已大');
  });

  it('甩主牌 → 垫牌优先加分', () => {
    // P0 甩主牌 S-K、S-Q（领出大）。P2 有主牌 S-10(分)、S-3 → 垫分加分。
    const lead: Card[] = [cc('S', 13, 200), cc('S', 12, 201)];
    const second = { cards: [cc('S', 5, 100), cc('S', 4, 101)], playerIndex: 1 };
    const hand = [cc('S', 10, 0), cc('S', 3, 1), cc('S', 2, 2)];
    const ctx = thirdCtx(cfgS2, lead, { bestSoFar: second });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, null, cfgS2);
    expect(r.cards.some(c => c.rank === 10)).toBe(true); // 主10 分
  });
});

describe('第三家：庄家方 70/75 禁分', () => {
  it('闲家得分 + 已出分 = 75 → 不能加分（非分副牌先垫）', () => {
    // P0 领出 ♥-A（顶张，领出大）。闲家得分 70 + 已出分 5（第二家出 ♥-5）= 75。
    // 庄家方 P2 有 ♥10(分)、♥3 → 禁分 → 出 ♥3。
    const lead: Card[] = [cc('H', 14, 200)];
    const hand = [cc('H', 10, 0), cc('H', 3, 1)];
    const ctx = thirdCtx(cfgS2, lead, {
      isAttacker: false, attackerPoints: 70,
    });
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(3); // 非分，不加分
    expect(r.reason).toContain('不加分');
  });
});

// ================================================================
// 第四家
// ================================================================

describe('第四家：70/75 禁分', () => {
  it('闲家得分 + 已出分 = 70 → 非分副牌先垫', () => {
    // P0 领出 ♥-A，第二家 ♥-7，第三家 ♣-5(5分)。得分 65 + 已出 5 = 70。
    // 第四家（庄家方）有 ♣10、♦5、♥3 → 禁分：非分副 ♥3 先。
    const lead: Card[] = [cc('H', 14, 200)];
    const third = { cards: [cc('C', 5, 101)], playerIndex: 2 };
    const hand = [cc('C', 10, 0), cc('D', 5, 1), cc('H', 3, 2)];
    const ctx = ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      bestSoFar: third, isAttacker: false, attackerPoints: 65,
    });
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(3); // 非分副牌
    expect(r.reason).not.toContain('加分');
  });
});

describe('第四家：加分优先盖过队友（盖毙）', () => {
  it('缺门 + 队友大 + 主牌分对垫出（盖过队友无妨，加分优先）', () => {
    // P0 领出 ♥9-9 对。第二家跟 ♥8-8（队友大）。P3 缺门，
    // 手牌全主 S-10-10、S-3、S-2 → 加分优先：主10-10 对（带分）垫出。
    const lead: Card[] = [cc('H', 9, 200), cc('H', 9, 201)];
    const second = { cards: [cc('H', 8, 100), cc('H', 8, 101)], playerIndex: 1 };
    const hand = [cc('S', 10, 0), cc('S', 10, 1), cc('S', 3, 2), cc('S', 2, 3)];
    const ctx = ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      bestSoFar: second, isAttacker: true,
    });
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards.every(c => c.rank === 10)).toBe(true); // 主10-10 对
    expect(r.reason).toContain('主');
    expect(r.reason).toContain('加分');
  });

  it('第四家同花色能盖 → 用分牌盖（最小能盖分牌）', () => {
    // P0 领出 ♥5。第三家 ♥9 盖过（对手大）。P3 有 ♥10(分)、♥K(分)、♥3 → 分牌盖最小 ♥10。
    const lead: Card[] = [cc('H', 5, 200)];
    const third = { cards: [cc('H', 9, 101)], playerIndex: 2 };
    const hand = [cc('H', 10, 0), cc('H', 13, 1), cc('H', 3, 2)];
    const ctx = ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      bestSoFar: third, isAttacker: true,
    });
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, 'H', cfgS2);
    expect(r.cards[0].rank).toBe(10); // 最小能盖分牌
    expect(r.reason).toContain('用分牌盖');
  });
});

describe('第二家：主牌双对领出填单张避分（>15 张）', () => {
  const leadAAKK: Card[] = [cc('S', 14, 200), cc('S', 14, 201), cc('S', 13, 202), cc('S', 13, 203)];

  it('>15 张：跟主对后填单张非分优先（分牌 S5 被 S8 替换）', () => {
    // 还原用户牌局：庄家 AI-4 领出 SA SA SK SK（主牌双对，含 K 分），
    // P1 主牌 S4-4（唯一主对，必跟）+ S5(分) + S6 S8(非分) + H2 级牌 + 2 王 + 12 张副牌（>15）
    const hand = [
      cc('S', 4, 0), cc('S', 4, 1), cc('S', 5, 2), cc('S', 6, 3), cc('S', 8, 4),
      cc('H', 2, 5), cc('J', 16, 6), cc('J', 15, 7),
      ...fillerClubs(12),
    ];
    const ctx = secondCtx(cfgS2, leadAAKK);
    const r = aiFollowPlay(hand, leadAAKK, Suit.Spades, ctx);
    checkFollow(r.cards, hand, leadAAKK, Suit.Spades as any, cfgS2);
    expect(r.cards.length).toBe(4);
    const ids = r.cards.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['S-4-0', 'S-4-1'])); // 主对必跟
    expect(ids).not.toContain('S-5-2'); // 分牌 S5 被避
    expect(ids).toEqual(expect.arrayContaining(['S-6-3', 'S-8-4'])); // 非分单张填充
  });

  it('<=15 张：不避分，仍按大小升序填（S5 分牌保留）', () => {
    const hand = [
      cc('S', 4, 0), cc('S', 4, 1), cc('S', 5, 2), cc('S', 6, 3), cc('S', 8, 4),
      ...fillerClubs(6),
    ]; // 11 张
    const ctx = secondCtx(cfgS2, leadAAKK);
    const r = aiFollowPlay(hand, leadAAKK, Suit.Spades, ctx);
    checkFollow(r.cards, hand, leadAAKK, Suit.Spades as any, cfgS2);
    const ids = r.cards.map(c => c.id);
    expect(ids).toContain('S-5-2'); // 大小升序填 S5 S6
  });

  it('>15 张：非分单张不足时垫分牌而不垫大王（A/王保底）', () => {
    // 主牌 S4-4 + S5(分) + 大王 + 小王 + 14 张副牌（>15）
    // 需填 2 张单张：S5 + 一张王；应垫 S5 保大王
    const hand = [
      cc('S', 4, 0), cc('S', 4, 1), cc('S', 5, 2), cc('J', 16, 3), cc('J', 15, 4),
      ...fillerClubs(14),
    ]; // 18 张
    const ctx = secondCtx(cfgS2, leadAAKK);
    const r = aiFollowPlay(hand, leadAAKK, Suit.Spades, ctx);
    checkFollow(r.cards, hand, leadAAKK, Suit.Spades as any, cfgS2);
    const ids = r.cards.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['S-4-0', 'S-4-1']));
    expect(ids).toContain('S-5-2'); // 被迫垫分牌
    expect(ids).not.toContain('J-16-3'); // 大王保底
  });
});

/** 无对、无 3 张同花色的副牌 filler（避免触发 hasStrongFollowUp 的"可甩副牌"）。 */
function fillerNoThrow(): Card[] {
  return [cc('H', 3, 300), cc('H', 8, 301), cc('C', 4, 302), cc('C', 6, 303), cc('D', 7, 304), cc('D', 9, 305)];
}

describe('第二家：主牌单张领出避分（>15 张）', () => {
  const leadSA: Card[] = [cc('S', 14, 200)];

  it('>15 张：出最小非分主牌（分牌 S5 被 S6 替换）', () => {
    // 庄家领出 ♠A。P1 主牌最小是分牌 S5，S6+ 均非分；副牌 6 张无对/无可甩（hasStrongFollowUp=false）
    // → 避分（>15 张）出 S6 而非 S5
    const hand = [
      cc('S', 5, 0), cc('S', 6, 1), cc('S', 7, 2), cc('S', 8, 3), cc('S', 9, 4),
      cc('S', 10, 5), cc('S', 11, 6), cc('S', 12, 7), cc('H', 2, 8), cc('J', 15, 9), cc('J', 16, 10),
      ...fillerNoThrow(),
    ]; // 11 主 + 6 副 = 17 张
    const ctx = secondCtx(cfgS2, leadSA);
    const r = aiFollowPlay(hand, leadSA, Suit.Spades, ctx);
    checkFollow(r.cards, hand, leadSA, Suit.Spades as any, cfgS2);
    expect(r.cards[0].id).toBe('S-6-1'); // 非分最小主牌
    expect(r.reason).toContain('同花色出小');
  });

  it('<=15 张：不避分，仍出最小主牌（S5）', () => {
    const hand = [cc('S', 5, 0), cc('S', 8, 1), cc('S', 9, 2)];
    const ctx = secondCtx(cfgS2, leadSA);
    const r = aiFollowPlay(hand, leadSA, Suit.Spades, ctx);
    checkFollow(r.cards, hand, leadSA, Suit.Spades as any, cfgS2);
    expect(r.cards[0].id).toBe('S-5-0'); // 最小
  });
});
