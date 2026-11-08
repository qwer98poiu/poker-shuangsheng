/**
 * 跟牌侧拆拖拉机（任务 1）。
 *
 * 约定：主牌 = ♠，副牌用 ♥；第三家 tmWin 表示队友（P0）领出且当前最大。
 * 所有用例的牌型均为同花色对子/甩牌对子槽，且手里没有独立对（除专门用例）。
 */
import { describe, it, expect } from 'vitest';
import { Rank, Suit } from '../types.js';
import { createCard } from '../model.js';
import { classify } from '../pattern/index.js';
import { validateFollow } from '../following/index.js';
import { aiFollowPlay } from '../ai-latest/index.js';
import type { Card, CardSuit, TrumpDeclaration } from '../types.js';
import type { AIContext } from '../ai-latest/types.js';

const cfg2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const cfgQ: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 12 };
const cfgK: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 13 };
const cfgNT2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

function cc(s: CardSuit, r: number, i: number): Card { return createCard(s, r, i); }

function ctxOf(cfg: TrumpDeclaration, over: Partial<AIContext>): AIContext {
  return {
    declarerIndex: 0, trumpSuit: cfg.trumpSuit, level: cfg.level,
    myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: false,
    attackerPoints: 0, throwPenalties: [0, 0] as const,
    handCounts: [25, 25, 25, 25] as const,
    trickHistory: [], reveals: [], playCount: 1, leadPlayerIndex: 0,
    trickPlays: [], bestSoFar: null, ntState: null, bottomCards: [], debug: false,
    ...over,
  };
}

/** 第三家，队友 P0 当前最大（tmWin = true）。 */
function thirdWin(cfg: TrumpDeclaration, lead: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 2, playCount: 2, leadPlayerIndex: 0,
    bestSoFar: { cards: lead, playerIndex: 0 },
    ...over,
  });
}

/** 第三家，对手 P1 当前最大（tmWin = false）。 */
function thirdLose(cfg: TrumpDeclaration, winning: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 2, playCount: 2, leadPlayerIndex: 0,
    bestSoFar: { cards: winning, playerIndex: 1 },
    ...over,
  });
}

/** 第四家，队友 P1 当前最大（tmWin = true）。 */
function fourthWin(cfg: TrumpDeclaration, winning: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 3, playCount: 3, leadPlayerIndex: 0,
    bestSoFar: { cards: winning, playerIndex: 1 },
    ...over,
  });
}

/** 第二家，P0 领出（tmWin = false）。 */
function second(cfg: TrumpDeclaration, lead: Card[], over: Partial<AIContext> = {}): AIContext {
  return ctxOf(cfg, {
    myIndex: 1, playCount: 1, leadPlayerIndex: 0,
    bestSoFar: { cards: lead, playerIndex: 0 },
    ...over,
  });
}

function checkFollow(
  play: Card[], hand: Card[], lead: Card[], cfg: TrumpDeclaration,
): void {
  expect(validateFollow(play, hand, lead, classify(lead, cfg), 'H', cfg).valid).toBe(true);
}

function fillerClubs(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => cc('C', (i % 10) + 3, 1000 + i));
}

const leadA = [cc('H', 14, 200), cc('H', 14, 201)];
const opponentA = [cc('H', 14, 300), cc('H', 14, 301)];

describe('拆拖拉机：canAddPoints = true（第三家队友大，优先加分）', () => {
  const cases: { name: string; cards: Card[]; expected: number[] }[] = [
    {
      name: 'K-Q：先拆 K 分边',
      cards: [cc('H', 13, 0), cc('H', 13, 1), cc('H', 12, 2), cc('H', 12, 3)],
      expected: [13, 13],
    },
    {
      name: '10-9：先拆 10 分边',
      cards: [cc('H', 10, 0), cc('H', 10, 1), cc('H', 9, 2), cc('H', 9, 3)],
      expected: [10, 10],
    },
    {
      name: '5-4：先拆 5 分边',
      cards: [cc('H', 5, 0), cc('H', 5, 1), cc('H', 4, 2), cc('H', 4, 3)],
      expected: [5, 5],
    },
    {
      name: '6-5：拆 5 分边而非更小的 6',
      cards: [cc('H', 6, 0), cc('H', 6, 1), cc('H', 5, 2), cc('H', 5, 3)],
      expected: [5, 5],
    },
    {
      name: 'J-10：拆 10 分边而非更小的 J',
      cards: [cc('H', 11, 0), cc('H', 11, 1), cc('H', 10, 2), cc('H', 10, 3)],
      expected: [10, 10],
    },
    {
      name: '9-8：无分对取最小非分对',
      cards: [cc('H', 9, 0), cc('H', 9, 1), cc('H', 8, 2), cc('H', 8, 3)],
      expected: [8, 8],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const hand = [...c.cards, cc('H', 3, 10), cc('H', 4, 11)];
      const ctx = thirdWin(cfg2, leadA);
      const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
      checkFollow(r.cards, hand, leadA, cfg2);
      expect(r.cards.map(card => card.rank)).toEqual(c.expected);
    });
  }

  it('长拖 5-6-7：优先拆有分的边缘 5，不拆中间 6', () => {
    const hand = [
      cc('H', 5, 0), cc('H', 5, 1), cc('H', 6, 2), cc('H', 6, 3),
      cc('H', 7, 4), cc('H', 7, 5), cc('H', 3, 6), cc('H', 4, 7),
    ];
    const ctx = thirdWin(cfg2, leadA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-5-0', 'H-5-1']);
  });

  it('长拖无分边 + 2 对 K-Q：结构优先，拆长拖最小边缘 7，不拆 2 对的 K', () => {
    const hand = [
      cc('H', 9, 0), cc('H', 9, 1), cc('H', 8, 2), cc('H', 8, 3),
      cc('H', 7, 4), cc('H', 7, 5), cc('H', 13, 6), cc('H', 13, 7),
      cc('H', 12, 8), cc('H', 12, 9), cc('H', 3, 10), cc('H', 4, 11),
    ];
    const ctx = thirdWin(cfg2, leadA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-7-4', 'H-7-5']);
  });

  it('长拖有 K 分边 + 2 对 10-9：长拖结构优先，拆 K', () => {
    const hand = [
      cc('H', 13, 0), cc('H', 13, 1), cc('H', 12, 2), cc('H', 12, 3),
      cc('H', 11, 4), cc('H', 11, 5), cc('H', 10, 6), cc('H', 10, 7),
      cc('H', 9, 8), cc('H', 9, 9), cc('H', 3, 10), cc('H', 4, 11),
    ];
    const ctx = thirdWin(cfg2, leadA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-13-0', 'H-13-1']);
  });

  it('有独立 J-J 对时先出独立对，不拆 5-4 拖拉机', () => {
    const hand = [
      cc('H', 11, 0), cc('H', 11, 1), cc('H', 5, 2), cc('H', 5, 3),
      cc('H', 4, 4), cc('H', 4, 5), cc('H', 3, 6), cc('H', 6, 7),
    ];
    const ctx = thirdWin(cfg2, leadA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-11-0', 'H-11-1']);
  });

  it('两个 2 对拖拉机 K-Q 与 10-9：全局 10 > K，拆 10', () => {
    const hand = [
      cc('H', 13, 0), cc('H', 13, 1), cc('H', 12, 2), cc('H', 12, 3),
      cc('H', 10, 4), cc('H', 10, 5), cc('H', 9, 6), cc('H', 9, 7),
      cc('H', 3, 8), cc('H', 4, 9),
    ];
    const ctx = thirdWin(cfg2, leadA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-10-4', 'H-10-5']);
  });

  it('无主局同规则：K-Q 先拆 K 分边', () => {
    const hand = [
      cc('H', 13, 0), cc('H', 13, 1), cc('H', 12, 2), cc('H', 12, 3),
      cc('H', 3, 4), cc('H', 4, 5),
    ];
    const ctx = thirdWin(cfgNT2, leadA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfgNT2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-13-0', 'H-13-1']);
  });

  it('多把长拖且边缘均无分：取最短长度中最小边缘 6', () => {
    // 等级 K：6-7-8 与 J-Q-A（K 为级牌跳过）两把 3 对拖拉机，边缘均无分。
    const lead = [cc('H', 3, 200), cc('H', 3, 201)];
    const winning = [cc('H', 4, 300), cc('H', 4, 301)];
    const hand = [
      cc('H', 6, 0), cc('H', 6, 1), cc('H', 7, 2), cc('H', 7, 3),
      cc('H', 8, 4), cc('H', 8, 5), cc('H', 11, 6), cc('H', 11, 7),
      cc('H', 12, 8), cc('H', 12, 9), cc('H', 14, 10), cc('H', 14, 11),
      cc('H', 5, 12), cc('H', 9, 13),
    ];
    const ctx = fourthWin(cfgK, winning);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, cfgK);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-6-0', 'H-6-1']);
  });
});

describe('拆拖拉机：canAddPoints = false（对手大）', () => {
  const cases: { name: string; cards: Card[]; expected: number[] }[] = [
    {
      name: 'K-Q：排除 K，拆 Q',
      cards: [cc('H', 13, 0), cc('H', 13, 1), cc('H', 12, 2), cc('H', 12, 3)],
      expected: [12, 12],
    },
    {
      name: '10-9：排除 10，拆 9',
      cards: [cc('H', 10, 0), cc('H', 10, 1), cc('H', 9, 2), cc('H', 9, 3)],
      expected: [9, 9],
    },
    {
      name: '5-4：排除 5，拆 4',
      cards: [cc('H', 5, 0), cc('H', 5, 1), cc('H', 4, 2), cc('H', 4, 3)],
      expected: [4, 4],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const hand = [...c.cards, cc('H', 3, 10), cc('H', 7, 11)];
      const ctx = thirdLose(cfg2, opponentA);
      const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
      checkFollow(r.cards, hand, leadA, cfg2);
      expect(r.cards.map(card => card.rank)).toEqual(c.expected);
    });
  }

  it('长拖 10-J-K（等级 Q）两边全为分对：拆中间最小非分对 J', () => {
    const hand = [
      cc('H', 10, 0), cc('H', 10, 1), cc('H', 11, 2), cc('H', 11, 3),
      cc('H', 13, 4), cc('H', 13, 5), cc('H', 3, 6), cc('H', 4, 7),
    ];
    const ctx = thirdLose(cfgQ, opponentA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfgQ);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-11-2', 'H-11-3']);
  });

  it('长拖全分边 + 2 对 3-4 非分：转拆 2 对，不拆长拖中间', () => {
    const hand = [
      cc('H', 10, 0), cc('H', 10, 1), cc('H', 11, 2), cc('H', 11, 3),
      cc('H', 13, 4), cc('H', 13, 5), cc('H', 3, 6), cc('H', 3, 7),
      cc('H', 4, 8), cc('H', 4, 9), cc('H', 6, 10), cc('H', 7, 11),
    ];
    const ctx = thirdLose(cfgQ, opponentA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfgQ);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-3-6', 'H-3-7']);
  });

  it('长拖有非分边 + 2 对 10-9：拆长拖最小的非分边 6，不拆 10 分边', () => {
    const hand = [
      cc('H', 6, 0), cc('H', 6, 1), cc('H', 7, 2), cc('H', 7, 3),
      cc('H', 8, 4), cc('H', 8, 5), cc('H', 10, 6), cc('H', 10, 7),
      cc('H', 9, 8), cc('H', 9, 9), cc('H', 3, 10), cc('H', 4, 11),
    ];
    const ctx = thirdLose(cfg2, opponentA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-6-0', 'H-6-1']);
  });

  it('两个 2 对拖拉机 K-Q 与 10-9：排除分对，拆最小非分边 9', () => {
    const hand = [
      cc('H', 13, 0), cc('H', 13, 1), cc('H', 12, 2), cc('H', 12, 3),
      cc('H', 10, 4), cc('H', 10, 5), cc('H', 9, 6), cc('H', 9, 7),
      cc('H', 3, 8), cc('H', 4, 9),
    ];
    const ctx = thirdLose(cfg2, opponentA);
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-9-6', 'H-9-7']);
  });
});

describe('拆拖拉机：第二家手牌数分档', () => {
  const lead = leadA;

  it('>15 张：排除 5 分对，拆 6', () => {
    const hand = [
      cc('H', 6, 0), cc('H', 6, 1), cc('H', 5, 2), cc('H', 5, 3),
      ...fillerClubs(14),
    ];
    const ctx = second(cfg2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-6-0', 'H-6-1']);
  });

  it('<=15 张：分/非分一视同仁，结构内取最小边缘 5', () => {
    const hand = [
      cc('H', 6, 0), cc('H', 6, 1), cc('H', 5, 2), cc('H', 5, 3),
      ...fillerClubs(10),
    ];
    const ctx = second(cfg2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-5-2', 'H-5-3']);
  });

  it('<=15 张：长拖优先于 2 对，取长拖最小边缘 7', () => {
    const hand = [
      cc('H', 9, 0), cc('H', 9, 1), cc('H', 8, 2), cc('H', 8, 3),
      cc('H', 7, 4), cc('H', 7, 5), cc('H', 13, 6), cc('H', 13, 7),
      cc('H', 12, 8), cc('H', 12, 9),
    ];
    const ctx = second(cfg2, lead);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-7-4', 'H-7-5']);
  });
});

describe('拆拖拉机：全力加分（第三家，跨 40 台阶）', () => {
  it('忽略结构，全局按 10 > K > 5 选 K', () => {
    const hand = [
      cc('H', 9, 0), cc('H', 9, 1), cc('H', 8, 2), cc('H', 8, 3),
      cc('H', 7, 4), cc('H', 7, 5), cc('H', 13, 6), cc('H', 13, 7),
      cc('H', 12, 8), cc('H', 12, 9), cc('H', 3, 10), cc('H', 4, 11),
    ];
    const ctx = thirdWin(cfg2, leadA, { isAttacker: true, attackerPoints: 35 });
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-13-6', 'H-13-7']);
  });

  it('无分对可拆时回退普通加分结构：长拖最小边缘 7', () => {
    const hand = [
      cc('H', 9, 0), cc('H', 9, 1), cc('H', 8, 2), cc('H', 8, 3),
      cc('H', 7, 4), cc('H', 7, 5), cc('H', 4, 6), cc('H', 4, 7),
      cc('H', 3, 8), cc('H', 3, 9),
    ];
    const ctx = thirdWin(cfg2, leadA, { isAttacker: true, attackerPoints: 35 });
    const r = aiFollowPlay(hand, leadA, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, leadA, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['H-7-4', 'H-7-5']);
  });
});

describe('拆拖拉机：甩牌中的对子槽', () => {
  it('甩 8-8 + J-J（两对），拆 5-6-7 长拖的两个边缘 7、6', () => {
    const lead = [
      cc('H', 8, 400), cc('H', 8, 401),
      cc('H', 11, 402), cc('H', 11, 403),
    ];
    const winning = [cc('H', 12, 500), cc('H', 12, 501)];
    const hand = [
      cc('H', 5, 0), cc('H', 5, 1), cc('H', 6, 2), cc('H', 6, 3),
      cc('H', 7, 4), cc('H', 7, 5), cc('H', 3, 6), cc('H', 4, 7),
    ];
    const ctx = thirdLose(cfg2, winning);
    const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort())
      .toEqual(['H-6-2', 'H-6-3', 'H-7-4', 'H-7-5']);
  });
});

describe('拆拖拉机：第四家跨 40 台阶精确比较', () => {
  const lead = [cc('S', 3, 200), cc('S', 3, 201)];
  const partner = [cc('S', 8, 300), cc('S', 8, 301)];
  const hand = [
    cc('S', 9, 0), cc('S', 9, 1), cc('S', 10, 2), cc('S', 10, 3),
    cc('S', 11, 4), cc('S', 11, 5), cc('S', 12, 6), cc('S', 12, 7),
    ...fillerClubs(8),
  ];

  it('20 分对实际跨 40 台阶：出 ♠10 对，而非拆边缘 ♠9 对', () => {
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 20 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('同台阶不拆结构：闲家 0 分仍出 ♠9 对', () => {
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 0 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-9-0', 'S-9-1']);
  });

  it('30 分时 20 分对跨 40：保留原有全力加分', () => {
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 30 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('第三家非最大但带分的牌计入本墩：20 + 第三家 10 + ♠10 对 → 跨 40', () => {
    const third = [cc('S', 5, 400), cc('S', 5, 401)];
    const ctx = fourthWin(cfg2, partner, {
      isAttacker: true, attackerPoints: 20,
      trickPlays: [
        { cards: lead },
        { cards: partner },
        { cards: third },
      ],
    });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('自己能盖过对手且 20 分对跨 40：出 ♠10 对', () => {
    const second = [cc('S', 7, 500), cc('S', 7, 501)];
    const third = [cc('S', 8, 502), cc('S', 8, 503)];
    const ctx = ctxOf(cfg2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      isAttacker: true, attackerPoints: 20,
      trickPlays: [
        { cards: lead },
        { cards: second },
        { cards: third },
      ],
      bestSoFar: { cards: third, playerIndex: 2 },
    });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('自己能盖过对手但同台阶：保留 ♠9 对，不无条件全力', () => {
    const second = [cc('S', 7, 600), cc('S', 7, 601)];
    const third = [cc('S', 8, 602), cc('S', 8, 603)];
    const ctx = ctxOf(cfg2, {
      myIndex: 3, playCount: 3, leadPlayerIndex: 0,
      isAttacker: true, attackerPoints: 0,
      trickPlays: [
        { cards: lead },
        { cards: second },
        { cards: third },
      ],
      bestSoFar: { cards: third, playerIndex: 2 },
    });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-9-0', 'S-9-1']);
  });
});

describe('第四家吊主对：add/full 候选与级牌/王对', () => {
  const lead = [cc('S', 3, 700), cc('S', 3, 701)];
  const partner = [cc('S', 4, 702), cc('S', 4, 703)];
  const fill = () => [
    cc('C', 3, 800), cc('C', 4, 801), cc('D', 3, 802), cc('D', 4, 803),
  ];

  it('add 保留级牌对：有非常主分对时出 ♠10 对，不出级牌对 ♠2', () => {
    const hand = [
      cc('S', 2, 0), cc('S', 2, 1),
      cc('S', 10, 2), cc('S', 10, 3),
      cc('S', 6, 4), cc('S', 6, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 0 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('没有非常主分对：出最小非常主非分对 ♠6，保留级牌对', () => {
    const hand = [
      cc('S', 2, 0), cc('S', 2, 1),
      cc('S', 6, 2), cc('S', 6, 3),
      cc('S', 7, 4), cc('S', 7, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 0 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-6-2', 'S-6-3']);
  });

  it('级 K 分对只在 full 跨台阶时使用：20 分时出 ♠K 对', () => {
    const hand = [
      cc('S', 13, 0), cc('S', 13, 1),
      cc('S', 6, 2), cc('S', 6, 3),
      cc('S', 7, 4), cc('S', 7, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfgK, partner, { isAttacker: true, attackerPoints: 20 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfgK);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-13-0', 'S-13-1']);
    expect(r.reason).toContain('全力加分');
  });

  it('非常主分对能跨时优先非常主：出 ♠10 对而非级 K 对', () => {
    const hand = [
      cc('S', 13, 0), cc('S', 13, 1),
      cc('S', 10, 2), cc('S', 10, 3),
      cc('S', 6, 4), cc('S', 6, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfgK, partner, { isAttacker: true, attackerPoints: 20 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfgK);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('级牌非分时不因跨台阶选级牌对：级 2 时仍出 ♠6', () => {
    const hand = [
      cc('S', 2, 0), cc('S', 2, 1),
      cc('S', 6, 2), cc('S', 6, 3),
      ...fill(),
    ];
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 30 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-6-2', 'S-6-3']);
  });

  it('非常主 5 分对不跨、级 K 分对可跨：选级 K 对', () => {
    const hand = [
      cc('S', 13, 0), cc('S', 13, 1),
      cc('S', 5, 2), cc('S', 5, 3),
      cc('S', 6, 4), cc('S', 6, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfgK, partner, { isAttacker: true, attackerPoints: 25 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfgK);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-13-0', 'S-13-1']);
    expect(r.reason).toContain('全力加分');
  });

  it('王对不作为分对候选：有 ♠10 对时出 ♠10，保留小王对', () => {
    const hand = [
      cc('J', Rank.SmallJoker, 0), cc('J', Rank.SmallJoker, 1),
      cc('S', 10, 2), cc('S', 10, 3),
      cc('S', 6, 4), cc('S', 6, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 20 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-10-2', 'S-10-3']);
  });

  it('同台阶时 add 选独立非分对：出 ♠K 对，不拆 9-10 拖拉机取 ♠10 对', () => {
    const hand = [
      cc('S', 9, 0), cc('S', 9, 1),
      cc('S', 10, 2), cc('S', 10, 3),
      cc('S', 13, 4), cc('S', 13, 5),
      ...fill(),
    ];
    const ctx = fourthWin(cfg2, partner, { isAttacker: true, attackerPoints: 0 });
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-13-4', 'S-13-5']);
  });
});

describe('拆拖拉机：有主局吊主对（主牌对子）', () => {
  const leadA2 = [cc('S', 14, 200), cc('S', 14, 201)];

  it('无独立主对、避免加分：拆长拖 5-6-7 的非分边缘 7，而非最小对 6', () => {
    const hand = [
      cc('S', 5, 0), cc('S', 5, 1), cc('S', 6, 2), cc('S', 6, 3),
      cc('S', 7, 4), cc('S', 7, 5), cc('S', 13, 6), cc('S', 13, 7),
      cc('S', 12, 8), cc('S', 12, 9),
    ];
    const ctx = thirdWin(cfg2, leadA2);
    const r = aiFollowPlay(hand, leadA2, null, ctx);
    checkFollow(r.cards, hand, leadA2, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-7-4', 'S-7-5']);
  });

  it('第四家队友大、加分：拆长拖的 5 分边，而非最小对 6', () => {
    const winning = [cc('S', 2, 300), cc('S', 2, 301)];
    const hand = [
      cc('S', 5, 0), cc('S', 5, 1), cc('S', 6, 2), cc('S', 6, 3),
      cc('S', 7, 4), cc('S', 7, 5), cc('S', 13, 6), cc('S', 13, 7),
      cc('S', 12, 8), cc('S', 12, 9),
    ];
    const ctx = fourthWin(cfg2, winning, { isAttacker: true });
    const r = aiFollowPlay(hand, leadA2, null, ctx);
    checkFollow(r.cards, hand, leadA2, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-5-0', 'S-5-1']);
  });

  it('有独立主对时保持原选择，不套用拆对规则', () => {
    const hand = [
      cc('S', 5, 0), cc('S', 5, 1), cc('S', 6, 2), cc('S', 6, 3),
      cc('S', 7, 4), cc('S', 7, 5), cc('S', 9, 6), cc('S', 9, 7),
    ];
    const ctx = thirdWin(cfg2, leadA2);
    const r = aiFollowPlay(hand, leadA2, null, ctx);
    checkFollow(r.cards, hand, leadA2, cfg2);
    expect(r.cards.map(c => c.id).sort()).toEqual(['S-9-6', 'S-9-7']);
  });

  it('甩主牌对子槽：两个短拖按加分优先级取 10 与 5', () => {
    const lead = [
      cc('S', 3, 400), cc('S', 3, 401),
      cc('S', 9, 402), cc('S', 9, 403),
      cc('S', 8, 404),
    ];
    const hand = [
      cc('S', 5, 0), cc('S', 5, 1), cc('S', 6, 2), cc('S', 6, 3),
      cc('S', 10, 4), cc('S', 10, 5), cc('S', 11, 6), cc('S', 11, 7),
    ];
    const ctx = thirdWin(cfg2, lead);
    const r = aiFollowPlay(hand, lead, null, ctx);
    checkFollow(r.cards, hand, lead, cfg2);
    expect(r.cards.length).toBe(5);
    expect(r.cards.filter(c => c.rank === 10).length).toBe(2);
    expect(r.cards.filter(c => c.rank === 5).length).toBe(2);
  });
});
