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
import type { Card, CardSuit, TrumpDeclaration } from '../types.js';
import type { AIContext } from '../ai/types.js';

const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const cfgH5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
/** NT（无主）：主牌 = 四门级牌 + 王。级牌 2 → 非分；10 → 分牌；A → aceEff 取 800 的边界。 */
const cfgNT2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };
const cfgNT10: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 10 };
const cfgNTA: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 14 };
function cc(s: CardSuit, r: number, i: number): Card { return createCard(s, r, i); }

function checkFollow(
  play: Card[], hand: Card[], lead: Card[], leadSuit: CardSuit | null, config: TrumpDeclaration,
): void {
  const lp = classify(lead, config);
  const vr = validateFollow(play, hand, lead, lp, leadSuit, config);
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
    trickPlays: [],
    bestSoFar: null, ntState: null, bottomCards: [], debug: false,
    ...over,
  };
}

/** 第二家位置 ctx（bestSoFar = 领出者）。 */
function secondCtx(cfg: TrumpDeclaration, lead: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 1, playCount: 1, leadPlayerIndex: 0,
    trickPlays: [],
    bestSoFar: { cards: lead, playerIndex: 0 },
    ...over,
  });
}

/** 第三家位置 ctx：默认领出者（P0）最大（tmWin）。 */
function thirdCtx(cfg: TrumpDeclaration, lead: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 2, playCount: 2, leadPlayerIndex: 0,
    trickPlays: [],
    bestSoFar: { cards: lead, playerIndex: 0 },
    ...over,
  });
}

/** 第三家、第二家（对手）最大的 ctx。 */
function thirdCtxSecondWins(cfg: TrumpDeclaration, lead: Card[], secondCards: Card[]): AIContext {
  return ctxOf(cfg, {
    myIndex: 2, playCount: 2, leadPlayerIndex: 0,
    trickPlays: [],
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
      trickPlays: [],
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
      trickPlays: [],
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
      trickPlays: [],
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
    checkFollow(r.cards, hand, leadAAKK, Suit.Spades, cfgS2);
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
    checkFollow(r.cards, hand, leadAAKK, Suit.Spades, cfgS2);
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
    checkFollow(r.cards, hand, leadAAKK, Suit.Spades, cfgS2);
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
    checkFollow(r.cards, hand, leadSA, Suit.Spades, cfgS2);
    expect(r.cards[0].id).toBe('S-6-1'); // 非分最小主牌
    expect(r.reason).toContain('同花色出小');
  });

  it('<=15 张：不避分，仍出最小主牌（S5）', () => {
    const hand = [cc('S', 5, 0), cc('S', 8, 1), cc('S', 9, 2)];
    const ctx = secondCtx(cfgS2, leadSA);
    const r = aiFollowPlay(hand, leadSA, Suit.Spades, ctx);
    checkFollow(r.cards, hand, leadSA, Suit.Spades, cfgS2);
    expect(r.cards[0].id).toBe('S-5-0'); // 最小
  });
});

describe('第三/四家：加分垫牌含分花色断门优先（闲家跨 40 台阶例外）', () => {
  // cfgS2：♠ 主 → 副牌花色为 ♥/♣/♦。领出 ♥ 单张（副牌无分），第四家缺 ♥；
  // bestSoFar = 队友 P1 的 ♥A（队友大，tmWin）
  const leadH3: Card[] = [cc('H', 3, 200)];
  /** 第四家 ctx：缺门垫牌可加分（fourth 恒可加分）。isAttacker 由调用方指定。 */
  function fourthVoidCtx(over: Partial<AIContext> = {}): AIContext {
    return ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      trickPlays: [],
      bestSoFar: { cards: [cc('H', 14, 201)], playerIndex: 1 },
      ...over,
    });
  }

  it('闲家第四家：梅花单张 K 可出绝 → 断梅花门出 K（而非分散垫方块 10）', () => {
    // 手牌：♣K（含分单张，1 张 <= 可垫 1 张 → 可出绝）+ ♦10 ♦3 ♦4（含分门）+ 主牌（能毙路径）
    const hand = [cc('C', 13, 0), cc('D', 10, 1), cc('D', 3, 2), cc('D', 4, 3), cc('S', 2, 4), cc('S', 5, 5)];
    const ctx = fourthVoidCtx({ isAttacker: true, attackerPoints: 0 });
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, Suit.Hearts, cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-13-0']); // 断门出 ♣K
  });

  it('庄家方第四家：同样断门优先（无闲家例外）', () => {
    const hand = [cc('C', 13, 0), cc('D', 10, 1), cc('D', 3, 2), cc('D', 4, 3), cc('S', 2, 4), cc('S', 5, 5)];
    const ctx = fourthVoidCtx({ isAttacker: false, attackerPoints: 0 });
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, Suit.Hearts, cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-13-0']);
  });

  it('闲家跨 40 台阶例外：出方块 10 而非断门梅花 5', () => {
    // attackerPoints=31：♣5（断门 5 分，36 不跨 40）vs ♦10（10 分，41 跨 40）→ 出 ♦10
    const hand = [cc('C', 5, 0), cc('D', 10, 1), cc('S', 2, 4), cc('S', 5, 5)];
    const ctx = fourthVoidCtx({ isAttacker: true, attackerPoints: 31 });
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, Suit.Hearts, cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['D-10-1']); // 跨台阶全力加分
  });

  it('不能毙路径（无主牌缺门）：含分门优先于非分门——出 ♦10 而非非分单张 ♣3', () => {
    // 领出 ♥3（缺 ♥、无主牌 → discardNonTrump）：♦10 ♦K 含分门 2 张 > 可垫 1 张（出不绝）
    // → add 分散选分牌 ♦10；♣3 非分门不优先
    const hand = [cc('C', 3, 0), cc('D', 10, 1), cc('D', 13, 2), cc('D', 4, 3)];
    const ctx = fourthVoidCtx({ isAttacker: false, attackerPoints: 0 });
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, Suit.Hearts, cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['D-10-1']); // 分牌优先（♦ 出不绝，分散加分）
  });

  it('多含分门：取张数最少的含分门断门（♥K 1 张先于 ♦ 门 2 张），其余加分垫', () => {
    // 缺 ♣、need=2：♥K（1 张含分可出绝）+ ♦10 ♦3（2 张含分，不可出绝）→ 断 ♥ 门 + 垫 ♦10
    const hand = [cc('H', 13, 0), cc('D', 10, 1), cc('D', 3, 2), cc('S', 2, 4), cc('S', 5, 5)];
    const ctx = fourthVoidCtx({ isAttacker: false, attackerPoints: 0 });
    // 领出 2 张（甩牌 ♣3 ♣4）→ 垫 2 张
    const lead2: Card[] = [cc('C', 3, 200), cc('C', 4, 201)];
    const r = aiFollowPlay(hand, lead2, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead2, Suit.Clubs, cfgS2);
    const ids = r.cards.map(c => c.id);
    expect(ids).toContain('H-13-0'); // 断 ♥ 门
    expect(ids).toContain('D-10-1'); // 其余加分垫（10 分）
    expect(ids.length).toBe(2);
  });
});

describe('第三/四家：不能毙路径跨 40 台阶例外（selectFillers full 分散加分）', () => {
  it('闲家第四家无主牌：近 40 台阶时分散出 ♦10 而非断门 ♣5', () => {
    // attackerPoints=31（距 40 台阶 9 分 <= 10 → full 模式）：♣5（断门 5 分）vs ♦10（10 分）
    // full = 分散全力加分 → ♦10；断门不优先
    const leadH3: Card[] = [cc('H', 3, 200)];
    const hand = [cc('C', 5, 0), cc('D', 10, 1), cc('D', 3, 2), cc('D', 4, 3)]; // 无主牌
    const ctx = ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      trickPlays: [],
      bestSoFar: { cards: [cc('H', 14, 201)], playerIndex: 1 },
      isAttacker: true, attackerPoints: 31,
    });
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, Suit.Hearts, cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['D-10-1']); // full 分散加分
  });
});

// ================================================================
// 第四家吊主单张：能盖过对手（无分墩）——最小单张 / 对子按"加分不拆对"优先级
// ================================================================

describe('第四家吊主单张：能盖过对手（无分墩）', () => {
  const fourthCtx = () => ctxOf(cfgS2, {
    myIndex: 3, playCount: 3, leadPlayerIndex: 0,
    trickPlays: [],
    bestSoFar: { cards: [cc('S', 8, 900)], playerIndex: 2 },
  });
  // 领出 = ♠7 吊主单张；当前最大 = ♠8（对手，无分墩）
  const lead: Card[] = [cc('S', 7, 900)];

  it('最小能盖过是单张 → 出最小单张（♠J 而非更大的 ♠A）', () => {
    const hand = [cc('S', 14, 0), cc('S', 11, 1)];
    const r = aiFollowPlay(hand, lead, null, fourthCtx());
    expect(r.cards.map(c => c.rank)).toEqual([11]);
  });

  it('最小能盖过是对子、更大单张类别更小（非分单 < 非分对）→ 不拆对，出更大单张', () => {
    // 原 bug 场景：♠Q♠Q 对（A 以下主非分对，类别 12）+ ♠J 单（类别 11）
    // 12 > 11 → 保留 ♠Q 对，出 ♠J
    const hand = [cc('S', 12, 0), cc('S', 12, 1), cc('S', 11, 2)];
    const r = aiFollowPlay(hand, lead, null, fourthCtx());
    expect(r.cards.map(c => c.rank)).toEqual([11]);
    checkFollow(r.cards, hand, lead, null, cfgS2);
  });

  it('最小能盖过是对子且类别更小（分对 10 < 非分单 11）→ 拆对盖过', () => {
    // ♠10♠10 分对（类别 10）+ ♠J 单（类别 11）→ 10 < 11 → 拆 ♠10
    const hand = [cc('S', 10, 0), cc('S', 10, 1), cc('S', 11, 2)];
    const r = aiFollowPlay(hand, lead, null, fourthCtx());
    expect(r.cards.map(c => c.rank)).toEqual([10]);
    checkFollow(r.cards, hand, lead, null, cfgS2);
  });

  it('只有对子能盖过 → 拆对盖过', () => {
    const hand = [cc('S', 12, 0), cc('S', 12, 1), cc('S', 5, 2)];
    const r = aiFollowPlay(hand, lead, null, fourthCtx());
    expect(r.cards.map(c => c.rank)).toEqual([12]);
    checkFollow(r.cards, hand, lead, null, cfgS2);
  });

  it('同等级单张优先于对子（常主 ♥2 单 vs ♣2 对，不拆对）', () => {
    const hand = [cc('H', 2, 0), cc('C', 2, 1), cc('C', 2, 2)];
    const r = aiFollowPlay(hand, lead, null, fourthCtx());
    expect(r.cards.map(c => c.rank)).toEqual([2]);
    expect(r.cards.map(c => c.suit)).toEqual([Suit.Hearts]);
    checkFollow(r.cards, hand, lead, null, cfgS2);
  });

  it('墩上有分同样按新规则：最小能盖过是单张（♠J）→ 出 ♠J 不拆 ♠Q 对', () => {
    const ctx = ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      trickPlays: [],
      bestSoFar: { cards: [cc('S', 5, 901)], playerIndex: 2 }, // ♠5 分牌
    });
    const lead5: Card[] = [cc('S', 3, 902)];
    const hand = [cc('S', 12, 0), cc('S', 12, 1), cc('S', 11, 2)];
    const r = aiFollowPlay(hand, lead5, null, ctx);
    expect(r.cards.map(c => c.rank)).toEqual([11]); // 出 ♠J
    checkFollow(r.cards, hand, lead5, null, cfgS2);
  });
});

// ================================================================
// 第四家对子领出：含分最多优先 → 最小能盖过；尽量不拆拖拉机
// ================================================================

describe('第四家对子领出：能盖过对手', () => {
  const ctxFor = (lead: Card[]) => ctxOf(cfgS2, {
    myIndex: 3, playCount: 3, leadPlayerIndex: 0,
    trickPlays: [],
    bestSoFar: { cards: [...lead], playerIndex: 2 },
  });
  const lead8: Card[] = [cc('S', 8, 100), cc('S', 8, 101)];

  it('含分对子优先（10 对 20 分 > K 对 10 分）→ 出 ♠10 对', () => {
    const hand = [cc('S', 10, 0), cc('S', 10, 1), cc('S', 13, 2), cc('S', 13, 3)];
    const r = aiFollowPlay(hand, lead8, null, ctxFor(lead8));
    expect(r.cards.map(c => c.rank).sort()).toEqual([10, 10]);
    checkFollow(r.cards, hand, lead8, null, cfgS2);
  });

  it('无分对子 → 最小能盖过（♠J 对 < ♠Q 对）', () => {
    const hand = [cc('S', 11, 0), cc('S', 11, 1), cc('S', 12, 2), cc('S', 12, 3)];
    const r = aiFollowPlay(hand, lead8, null, ctxFor(lead8));
    expect(r.cards.map(c => c.rank).sort()).toEqual([11, 11]);
    checkFollow(r.cards, hand, lead8, null, cfgS2);
  });

  it('尽量不拆拖拉机：有拖拉机外对子（♠K 对）→ 选它而非 9/10 对', () => {
    const hand = [cc('S', 9, 0), cc('S', 9, 1), cc('S', 10, 2), cc('S', 10, 3),
      cc('S', 13, 4), cc('S', 13, 5)];
    const r = aiFollowPlay(hand, lead8, null, ctxFor(lead8));
    expect(r.cards.map(c => c.rank).sort()).toEqual([13, 13]);
    checkFollow(r.cards, hand, lead8, null, cfgS2);
  });

  it('没得选（只有拖拉机内对子能盖过）→ 拆拖拉机出最小（无分拖拉机 J-Q）', () => {
    const hand = [cc('S', 11, 0), cc('S', 11, 1), cc('S', 12, 2), cc('S', 12, 3)];
    const r = aiFollowPlay(hand, lead8, null, ctxFor(lead8));
    expect(r.cards.map(c => c.rank).sort()).toEqual([11, 11]);
    checkFollow(r.cards, hand, lead8, null, cfgS2);
  });
});

// ================================================================
// 第二/三家毙单张按档位选牌（A 以下单张 > A 以下散对 > A 以下拖拉机 > A 和常主）
// ================================================================
describe('第二/三家 毙单张按档位选牌（不区分分牌与非分）', () => {
  it('第二家首毙副牌单张：不拆散对（♠3×2 + ♠9 → 出 ♠9）', () => {
    const lead = [cc('C', 3, 200)];
    const hand = [cc('S', 3, 0), cc('S', 3, 1), cc('S', 9, 2)];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, secondCtx(cfgS2, lead));
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards[0].id).toBe('S-9-2'); // 旧行为出 S-3-0（拆对）
    expect(r.reason).toBe('用主牌毙（用最小牌盖）');
  });

  it('第二家盖毙：能盖过的牌里不拆散对，且不因分牌改档（K 与 7 同档取小）', () => {
    const lead = [cc('C', 9, 200)];
    const hand = [cc('S', 5, 0), cc('S', 5, 1), cc('S', 7, 2), cc('S', 13, 3)];
    const ctx = ctxOf(cfgS2, {
      myIndex: 1, playCount: 1, leadPlayerIndex: 0,
      trickPlays: [],
      bestSoFar: { cards: [cc('S', 3, 100)], playerIndex: 2 },
    });
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfgS2);
    expect(r.cards[0].id).toBe('S-7-2'); // 旧行为出 S-5-0（拆对）
    expect(r.reason).toBe('盖毙（用最小牌盖）');
  });
});

// ================================================================
// 第四家：不抢无分墩（能毙/盖毙但抢来无牌可领 → 改垫牌）
// ================================================================
describe('第四家：不抢无分墩', () => {
  // cfgS2：♠ 主（级牌 2）→ 副牌花色 ♥/♣/♦。第四家 = P3（myIndex 3，队友 = P1）。
  // 基准局面：P0 领出 ♥3，P1 跟 ♥7（队友），P2 跟 ♥9 盖过（对手最大，本墩无分）。
  const leadH3: Card[] = [cc('H', 3, 200)];
  const p1H7: Card[] = [cc('H', 7, 201)];
  const p2H9: Card[] = [cc('H', 9, 202)];

  /** 第四家 ctx：三家出牌全数列出（trickPlays 与 playCount 相符才算"全知"）。 */
  function noSeizeCtx(over: Partial<AIContext> = {}): AIContext {
    return ctxOf(cfgS2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      bestSoFar: { cards: p2H9, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2H9 }],
      ...over,
    });
  }

  it('正例：无分墩 + 无值得出的牌 + 候选全非分 + 有非分副牌 → 垫最小非分副牌', () => {
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 4, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-2']); // 最小非分副牌
    expect(r.reason).toBe('垫牌（无分墩，不抢）');
  });

  it('本墩有分（中间家垫的 10 分，不是当前最大）→ 照常毙', () => {
    // P1 垫 ♥10（10 分），P2 用 ♥J 盖过 → 当前最大是无分的 ♥J，
    // 只看 bestSoFar 会漏掉这 10 分（旧近似口径），trickPlays 才看得见。
    const p2HJ: Card[] = [cc('H', 11, 203)];
    const ctx = noSeizeCtx({
      bestSoFar: { cards: p2HJ, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: [cc('H', 10, 204)] }, { cards: p2HJ }],
    });
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 4, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']); // 照常毙（最小非分主牌）
    expect(r.reason).not.toContain('无分墩');
  });

  it('出牌未知（trickPlays 不完整）→ 未知按有分处理，照常毙', () => {
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 4, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx({ trickPlays: [] }));
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']);
  });

  it('有值得出的牌（副牌对子）→ 照常毙', () => {
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 4, 2), cc('C', 4, 3)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']);
    expect(r.reason).not.toContain('无分墩');
  });

  it('有值得出的牌（大副牌 A 单张）→ 照常毙', () => {
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 14, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']);
  });

  it('只有主对不算值得出：有非分副牌可垫 → 不抢', () => {
    const hand = [cc('S', 8, 0), cc('S', 8, 1), cc('C', 4, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-2']);
    expect(r.reason).toBe('垫牌（无分墩，不抢）');
  });

  it('建议出牌含分牌（♠5 分被档位优先选中）→ 照常毙', () => {
    const hand = [cc('S', 5, 0), cc('S', 9, 1), cc('C', 4, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-5-0']); // 分牌档优先
    expect(r.reason).not.toContain('无分墩');
  });

  it('要拆主对才能凑齐 → 照常毙（手牌只有主对）', () => {
    const hand = [cc('S', 8, 0), cc('S', 8, 1)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']);
    expect(r.reason).not.toContain('无分墩');
  });

  it('主拖拉机成员不得动用 → 照常毙（手牌只有主拖拉机）', () => {
    const hand = [cc('S', 8, 0), cc('S', 8, 1), cc('S', 9, 2), cc('S', 9, 3)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']);
    expect(r.reason).not.toContain('无分墩');
  });

  it('要垫主牌 A 或更大 → 照常毙', () => {
    const hand = [cc('S', 8, 0), cc('S', 8, 1), cc('S', 14, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0']);
    expect(r.reason).not.toContain('无分墩');
  });

  it('非庄家要垫副分 → 照常毙；同手牌庄家 → 不抢', () => {
    const hand = [cc('S', 14, 0), cc('C', 10, 1)]; // 主A（毙牌候选）+ 副10分
    const asDefender = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx());
    checkFollow(asDefender.cards, hand, leadH3, 'H', cfgS2);
    expect(asDefender.cards.map(c => c.id)).toEqual(['S-14-0']);
    expect(asDefender.reason).not.toContain('无分墩');

    const asDeclarer = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx({
      declarerIndex: 3, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
    }));
    checkFollow(asDeclarer.cards, hand, leadH3, 'H', cfgS2);
    expect(asDeclarer.cards.map(c => c.id)).toEqual(['C-10-1']);
    expect(asDeclarer.reason).toBe('垫牌（无分墩，不抢）');
  });

  it('庄家副分门槛：闲家 70 分可垫 5 分 → 不抢', () => {
    const hand = [cc('S', 14, 0), cc('C', 5, 1)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx({
      declarerIndex: 3, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
      attackerPoints: 70,
    }));
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-5-1']); // 70 + 5 = 75 < 80
    expect(r.reason).toBe('垫牌（无分墩，不抢）');
  });

  it('庄家副分门槛：闲家 75 分不能垫分 → 照常毙', () => {
    const hand = [cc('S', 14, 0), cc('C', 5, 1)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx({
      declarerIndex: 3, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
      attackerPoints: 75,
    }));
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-14-0']); // 75 + 5 = 80 不允许
    expect(r.reason).not.toContain('无分墩');
  });

  it('庄家副分门槛：闲家 70 分垫 10 分 → 照常毙（70+10=80）', () => {
    const hand = [cc('S', 14, 0), cc('C', 10, 1)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, noSeizeCtx({
      declarerIndex: 3, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
      attackerPoints: 70,
    }));
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-14-0']);
    expect(r.reason).not.toContain('无分墩');
  });

  it('盖毙（对手先毙、能盖过且候选非分）→ 不盖毙改垫牌', () => {
    const p2S6: Card[] = [cc('S', 6, 205)]; // P2 用主牌毙了
    const ctx = noSeizeCtx({
      bestSoFar: { cards: p2S6, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2S6 }],
    });
    const hand = [cc('S', 8, 0), cc('C', 4, 1)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-1']);
    expect(r.reason).toBe('垫牌（无分墩，不抢）');
  });

  it('盖不过对手的毙牌 → 走既有垫牌路径（不是本规则）', () => {
    const p2S6: Card[] = [cc('S', 6, 205)];
    const ctx = noSeizeCtx({
      bestSoFar: { cards: p2S6, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2S6 }],
    });
    const hand = [cc('S', 4, 0), cc('C', 4, 1)]; // ♠4 盖不过 ♠6
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.reason).toContain('盖不过');
    expect(r.reason).not.toContain('无分墩');
  });

  it('队友最大（tmWin）→ 不适用本规则（走加分/毙牌分支）', () => {
    const ctx = noSeizeCtx({ bestSoFar: { cards: p1H7, playerIndex: 1 } });
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 4, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgS2);
    expect(r.reason).not.toContain('无分墩');
  });

  it('对子领出：非分副牌少于领出张数、要垫主分 → 照常毙', () => {
    const leadH33: Card[] = [cc('H', 3, 210), cc('H', 3, 211)];
    const p1H77: Card[] = [cc('H', 7, 212), cc('H', 7, 213)];
    const p2H99: Card[] = [cc('H', 9, 214), cc('H', 9, 215)];
    const ctx = noSeizeCtx({
      bestSoFar: { cards: p2H99, playerIndex: 2 },
      trickPlays: [{ cards: leadH33 }, { cards: p1H77 }, { cards: p2H99 }],
    });
    // 主对 ♠8♠8（非分，毙）+ 非分副单 ♣4 + 主分单 ♠5：垫满 2 张须动主分 → 毙
    const hand = [cc('S', 8, 0), cc('S', 8, 1), cc('C', 4, 2), cc('S', 5, 3)];
    const r = aiFollowPlay(hand, leadH33, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH33, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-8-0', 'S-8-1']);
    expect(r.reason).not.toContain('无分墩');
  });

  it('对子领出：庄家累计副分超 10 分上限 → 照常毙', () => {
    const leadH33: Card[] = [cc('H', 3, 220), cc('H', 3, 221)];
    const p1H77: Card[] = [cc('H', 7, 222), cc('H', 7, 223)];
    const p2H99: Card[] = [cc('H', 9, 224), cc('H', 9, 225)];
    const ctx = noSeizeCtx({
      bestSoFar: { cards: p2H99, playerIndex: 2 },
      trickPlays: [{ cards: leadH33 }, { cards: p1H77 }, { cards: p2H99 }],
      declarerIndex: 3, isDeclarer: true, isDeclarerPartner: false, isAttacker: false,
    });
    const hand = [cc('S', 14, 0), cc('S', 14, 1), cc('C', 10, 2), cc('D', 10, 3)];
    const r = aiFollowPlay(hand, leadH33, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH33, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['S-14-0', 'S-14-1']); // 20 分 > 10 分上限
    expect(r.reason).not.toContain('无分墩');
  });

  it('甩副牌领出：同样不抢（垫两张非分副牌）', () => {
    // 甩牌领出：两张不同点数单张（♥3 ♥4，均非分——♥5 是分牌，会令本墩有分）
    const leadH34: Card[] = [cc('H', 3, 230), cc('H', 4, 231)];
    const p1H78: Card[] = [cc('H', 7, 232), cc('H', 8, 233)];
    const p2H9J: Card[] = [cc('H', 9, 234), cc('H', 11, 235)];
    const ctx = noSeizeCtx({
      bestSoFar: { cards: p2H9J, playerIndex: 2 },
      trickPlays: [{ cards: leadH34 }, { cards: p1H78 }, { cards: p2H9J }],
    });
    const hand = [cc('S', 8, 0), cc('S', 9, 1), cc('C', 4, 2), cc('C', 6, 3)];
    const r = aiFollowPlay(hand, leadH34, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH34, 'H', cfgS2);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-2', 'C-6-3']);
    expect(r.reason).toBe('垫牌（无分墩，不抢）');
  });

  it('NT 无主模式同样适用：只垫副牌（级牌一律不得垫），垫不起才照常毙', () => {
    const ctx = ctxOf({ declarerIndex: 0, trumpSuit: null, level: 2 }, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0, isAttacker: true,
      bestSoFar: { cards: p2H9, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2H9 }],
    });
    // NT：主牌=王与级牌；手上 ♠2（级牌，主，非分）+ ♣4/♦6 两张副牌
    const hand = [cc('S', 2, 0), cc('C', 4, 1), cc('D', 6, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgNT2);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-1']); // 垫最小副牌，不动级牌
    expect(r.reason).toBe('垫牌（无分墩，不抢）');

    // 只剩常主可垫 → 垫不起 → 照常毙（那张主牌无论如何都要花掉，赢下此墩更优）
    const trumpOnly = [cc('S', 2, 0), cc('S', 2, 1)];
    const rl = aiFollowPlay(trumpOnly, leadH3, Suit.Hearts, ctx);
    checkFollow(rl.cards, trumpOnly, leadH3, 'H', cfgNT2);
    expect(rl.cards.map(c => c.id)).toEqual(['S-2-0']);
    expect(rl.reason).toContain('用主牌毙');
  });

  it('NT 级牌为 A 的边界（aceEff 返回 800）：常主仍一律不得垫', () => {
    // 打 A 时四门 A 全为主牌，aceEff(♦A) = 800；若靠 "eff >= aceEff 恒成立" 判定会随
    // aceEff 的变化而漏掉主牌，故此处显式钉住边界。
    const ctx = ctxOf(cfgNTA, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0, isAttacker: true,
      bestSoFar: { cards: p2H9, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2H9 }],
    });
    const hand = [cc('D', 14, 0), cc('C', 4, 1)]; // ♦A 是级牌（主）+ 副牌 ♣4
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgNTA);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-1']); // 垫副牌，不动级牌 A
    expect(r.reason).toBe('垫牌（无分墩，不抢）');

    const trumpOnly = [cc('D', 14, 0)];
    const rl = aiFollowPlay(trumpOnly, leadH3, Suit.Hearts, ctx);
    checkFollow(rl.cards, trumpOnly, leadH3, 'H', cfgNTA);
    expect(rl.cards.map(c => c.id)).toEqual(['D-14-0']); // 垫不起 → 照常毙
  });

  it('NT 级牌为 10（既是主牌又是分牌）：档位优先选分牌 → 照常毙', () => {
    const ctx = ctxOf(cfgNT10, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0, isAttacker: true,
      bestSoFar: { cards: p2H9, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2H9 }],
    });
    const hand = [cc('S', 10, 0), cc('C', 4, 1), cc('D', 6, 2)];
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgNT10);
    expect(r.cards.map(c => c.id)).toEqual(['S-10-0']); // 分牌档优先 → 建议出牌含分 → 照常毙
    expect(r.reason).not.toContain('无分墩');
  });

  it('NT 有值得出的牌（副牌对子 / 大副牌 A）→ 照常毙', () => {
    const ctx = ctxOf(cfgNT2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0, isAttacker: true,
      bestSoFar: { cards: p2H9, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2H9 }],
    });
    const pairHand = [cc('S', 2, 0), cc('C', 4, 1), cc('C', 4, 2)];
    const rPair = aiFollowPlay(pairHand, leadH3, Suit.Hearts, ctx);
    checkFollow(rPair.cards, pairHand, leadH3, 'H', cfgNT2);
    expect(rPair.cards.map(c => c.id)).toEqual(['S-2-0']); // 副牌对子 → 有值得出的牌
    expect(rPair.reason).not.toContain('无分墩');

    const bigHand = [cc('S', 2, 0), cc('C', 14, 1)];
    const rBig = aiFollowPlay(bigHand, leadH3, Suit.Hearts, ctx);
    checkFollow(rBig.cards, bigHand, leadH3, 'H', cfgNT2);
    expect(rBig.cards.map(c => c.id)).toEqual(['S-2-0']); // 副牌顶张 A → 有值得出的牌
    expect(rBig.reason).not.toContain('无分墩');
  });

  it('NT 庄家副分同有主口径：≤10 分且闲家不过 80 可垫，非庄家不能垫', () => {
    const nt2Ctx = (over: Partial<AIContext>) => ctxOf(cfgNT2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      bestSoFar: { cards: p2H9, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2H9 }],
      ...over,
    });
    const hand = [cc('S', 2, 0), cc('C', 10, 1)]; // 级牌 ♠2 + 副分单 ♣10
    const declarer = { declarerIndex: 3, isDeclarer: true, isDeclarerPartner: false, isAttacker: false };

    const asDeclarer = aiFollowPlay(hand, leadH3, Suit.Hearts, nt2Ctx({ ...declarer, attackerPoints: 0 }));
    checkFollow(asDeclarer.cards, hand, leadH3, 'H', cfgNT2);
    expect(asDeclarer.cards.map(c => c.id)).toEqual(['C-10-1']); // 闲家 0 分，垫 10 分仍 < 80
    expect(asDeclarer.reason).toBe('垫牌（无分墩，不抢）');

    const near80 = aiFollowPlay(hand, leadH3, Suit.Hearts, nt2Ctx({ ...declarer, attackerPoints: 70 }));
    checkFollow(near80.cards, hand, leadH3, 'H', cfgNT2);
    expect(near80.cards.map(c => c.id)).toEqual(['S-2-0']); // 70 + 10 = 80 不允许

    const asDefender = aiFollowPlay(hand, leadH3, Suit.Hearts, nt2Ctx({ isAttacker: true }));
    checkFollow(asDefender.cards, hand, leadH3, 'H', cfgNT2);
    expect(asDefender.cards.map(c => c.id)).toEqual(['S-2-0']); // 非庄家不得垫副分
  });

  it('NT 盖毙（对手用级牌毙了，能用王盖过且建议出牌非分）→ 不盖毙改垫牌', () => {
    const p2D2: Card[] = [cc('D', 2, 205)]; // P2 用级牌 ♦2 毙了（NT 下级牌即主牌）
    const ctx = ctxOf(cfgNT2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0, isAttacker: true,
      bestSoFar: { cards: p2D2, playerIndex: 2 },
      trickPlays: [{ cards: leadH3 }, { cards: p1H7 }, { cards: p2D2 }],
    });
    const hand = [cc('J', 15, 0), cc('C', 4, 1), cc('D', 6, 2)]; // 小王 + 两张副牌
    const r = aiFollowPlay(hand, leadH3, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadH3, 'H', cfgNT2);
    expect(r.cards.map(c => c.id)).toEqual(['C-4-1']); // 不盖毙，垫副牌保住小王
    expect(r.reason).toBe('垫牌（无分墩，不抢）');
  });
});
