import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard, isTrump } from '../model.js';
import type { Card, TrumpDeclaration } from '../types.js';
import type { AIContext } from '../ai/types.js';
import {
  sortDiscards, pickDiscards, selectFillers,
  hasStrongFollowUp, visibleTrickPoints, secondShouldAvoid, defense80, leadHasPoints,
} from '../ai/position-policy.js';

const cfg2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
const cfg10: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 10 };
function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function ctxOf(cfg: TrumpDeclaration, over: Partial<AIContext> = {}): AIContext {
  return {
    declarerIndex: 0, trumpSuit: cfg.trumpSuit, level: cfg.level,
    myIndex: 1, isDeclarer: false, isDeclarerPartner: false, isAttacker: false,
    attackerPoints: 0, handCounts: [25, 25, 25, 25], trickHistory: [],
    reveals: [], playCount: 1, leadPlayerIndex: 0, bestSoFar: null,
    ntState: null, bottomCards: [], debug: false,
    ...over,
  };
}

/** 排序后各牌按顺序出现（断言顺序列表）。 */
function orderOf(sorted: Card[], hand: Card[]): string[] {
  return sorted.map(card => `${card.suit}${card.rank}`);
}

describe('sortDiscards avoid（第二家原则5）', () => {
  it('类别顺序：副非分单 < 副非分对 < 主A下非分单 < 副分单 < 副分对 < 主A下分单 < 主A下非分对 < 主A下分对 < 主A或更大', () => {
    const hand = [
      c('H', 10, 1),            // 副分单 10
      c('D', 13, 2),            // 副分单 K
      c('S', 3, 3),             // 主A下非分单（主花色 ♠）
      c('S', 5, 4),             // 主A下分单（5 不是级牌）
      c('H', 8, 5), c('H', 8, 6),     // 副非分对
      c('D', 5, 7), c('D', 5, 8),     // 副分对
      c('C', 3, 9),             // 副非分单
      c('S', 12, 10), c('S', 12, 11), // 主A下非分对（Q）
      c('S', 10, 12), c('S', 10, 13), // 主A下分对（主10对）
      c('S', 14, 14),           // 主牌A（A或更大）
    ];
    const sorted = sortDiscards(hand, cfg2, 'avoid');
    const order = orderOf(sorted, hand);
    const idx = (s: string) => order.indexOf(s);
    expect(order.length).toBe(hand.length);
    // 副非分单（C3）最先
    expect(order[0]).toBe('C3');
    // 副非分对（H8H8）在副非分单之后、主牌之前
    expect(idx('C3')).toBeLessThan(idx('H8'));
    expect(idx('H8')).toBeLessThan(idx('S3'));
    // 副分单（H10/DK）在副非分对之后、副分对之前
    expect(idx('H8')).toBeLessThan(idx('H10'));
    expect(idx('D13')).toBeLessThan(idx('D5'));
    // 主A下分单（S5）在副分单之后、主A下非分对之前
    expect(idx('H10')).toBeLessThan(idx('S5'));
    expect(idx('S5')).toBeLessThan(idx('S12'));
    // 主A下非分对（S12S12）在主A下分对（S10S10）之前
    expect(idx('S12')).toBeLessThan(idx('S10'));
    // 主牌A 最后
    expect(idx('S14')).toBeGreaterThan(idx('S10'));
  });

  it('级牌分单张（分数为等级时）不属"主A下分单"，归入"主A或更大"末类', () => {
    const hand = [
      c('S', 2, 1),   // 级牌分（打2，主花色级牌）
      c('S', 5, 2),   // 主A下分单（非级牌）
      c('C', 3, 3),   // 副非分单
    ];
    const sorted = sortDiscards(hand, cfg2, 'avoid');
    const order = orderOf(sorted, hand);
    expect(order.indexOf('S2')).toBeGreaterThan(order.indexOf('S5'));
    expect(order[order.length - 1]).toBe('S2');
  });

  it('副牌级牌分（主花色外的级牌）同样归末类', () => {
    const hand = [
      c('D', 2, 1),   // 副牌级牌分（打2，♠ 主）
      c('D', 3, 2),   // 副非分单
    ];
    const sorted = sortDiscards(hand, cfg2, 'avoid');
    expect(orderOf(sorted, hand)[orderOf(sorted, hand).length - 1]).toBe('D2');
  });
});

describe('sortDiscards open（第二家原则6）', () => {
  it('类别顺序：副单 < 副对 < 主A下单 < 主A下对 < 主A或更大，分非分一视同仁', () => {
    const hand = [
      c('H', 10, 1),            // 副单（分）
      c('S', 14, 2),            // 主牌A
      c('S', 3, 3),             // 主A下单
      c('D', 5, 4), c('D', 5, 5),     // 副对（分）
      c('S', 12, 6), c('S', 12, 7),   // 主A下对
    ];
    const sorted = sortDiscards(hand, cfg2, 'open');
    const order = orderOf(sorted, hand);
    // 副单（H10）先于副对（D5）
    expect(order.indexOf('H10')).toBeLessThan(order.indexOf('D5'));
    // 副对先于主A下单
    expect(order.indexOf('D5')).toBeLessThan(order.indexOf('S3'));
    // 主A下单先于主A下对
    expect(order.indexOf('S3')).toBeLessThan(order.indexOf('S12'));
    // 主牌A 最后
    expect(order[order.length - 1]).toBe('S14');
  });
});

describe('sortDiscards add（第三家原则6）', () => {
  it('类别顺序：副10 < 副K < 副5 < 其他非分副 < 主10 < 主K < 主5 < 主牌分对 < 其他主牌', () => {
    const hand = [
      c('S', 14, 1),            // 主牌A（其他主牌）
      c('H', 10, 2),            // 副10
      c('D', 13, 3),            // 副K
      c('D', 5, 4),             // 副5
      c('C', 3, 5),             // 其他非分副
      c('S', 10, 6),            // 主10（非常主，打2）
      c('S', 13, 7),            // 主K
      c('S', 5, 8),             // 主5
      c('S', 9, 9), c('S', 9, 10),    // 主牌非分对（其他主牌）
    ];
    const sorted = sortDiscards(hand, cfg2, 'add');
    const order = orderOf(sorted, hand);
    const idx = (s: string) => order.indexOf(s);
    expect(order[0]).toBe('H10');
    expect(idx('H10')).toBeLessThan(idx('D13'));
    expect(idx('D13')).toBeLessThan(idx('D5'));
    expect(idx('D5')).toBeLessThan(idx('C3'));
    expect(idx('C3')).toBeLessThan(idx('S10'));
    expect(idx('S10')).toBeLessThan(idx('S13'));
    expect(idx('S13')).toBeLessThan(idx('S5'));
    expect(idx('S5')).toBeLessThan(idx('S9'));
    expect(idx('S9')).toBeLessThan(idx('S14'));
  });

  it('级牌分主牌不算"非常主"（打5时主5归其他主牌），主牌分对单独一类', () => {
    const hand = [
      c('H', 5, 1),             // 主牌5 但 5 是级牌（常主分）→ 其他主牌
      c('H', 10, 2),            // 主10（非常主，打5）
      c('H', 13, 3), c('H', 13, 4),   // 主牌K对（分对）
      c('S', 10, 5),            // 副10
    ];
    const sorted = sortDiscards(hand, cfg5, 'add');
    const order = orderOf(sorted, hand);
    // 副10 最先；主10（非常主）在级牌分 H5 之前；主牌分对 H13 也在级牌分 H5 之前
    expect(order[0]).toBe('S10');
    expect(order.indexOf('H10')).toBeLessThan(order.indexOf('H13'));
    expect(order.indexOf('H13')).toBeLessThan(order.indexOf('H5'));
  });

  it('所有副牌花色一视同仁（10 优先于其他花色的 K）', () => {
    const hand = [
      c('H', 13, 1),            // 副K
      c('C', 10, 2),            // 另一花色副10
    ];
    const sorted = sortDiscards(hand, cfg2, 'add');
    expect(orderOf(sorted, hand)[0]).toBe('C10');
  });

  it('修正规格：副5单 < 副牌分对（非拖拉机）< 其他非分副', () => {
    const hand = [
      c('H', 5, 1),             // 副5单
      c('C', 10, 2), c('C', 10, 3),   // 副10对（独立，非拖拉机）
      c('D', 3, 4),             // 其他非分副
    ];
    const sorted = sortDiscards(hand, cfg2, 'add');
    const order = orderOf(sorted, hand);
    expect(order.indexOf('H5')).toBeLessThan(order.indexOf('C10'));
    expect(order.indexOf('C10')).toBeLessThan(order.indexOf('D3'));
  });

  it('副牌分对类内 10>K>5（分高在前，同分 rank 大在前）', () => {
    const hand = [
      c('H', 13, 1), c('H', 13, 2),   // 副K对
      c('C', 10, 3), c('C', 10, 4),   // 副10对
      c('D', 5, 5), c('D', 5, 6),     // 副5对
    ];
    const sorted = sortDiscards(hand, cfg2, 'add');
    const order = orderOf(sorted, hand);
    expect(order.indexOf('C10')).toBeLessThan(order.indexOf('H13'));
    expect(order.indexOf('H13')).toBeLessThan(order.indexOf('D5'));
  });

  it('副牌分对（拆拖拉机）排在其他非分副之后', () => {
    // C-10-10 + C-9-9 组成拖拉机：C10 对需拆拖拉机才能用
    const hand = [
      c('C', 10, 1), c('C', 10, 2), c('C', 9, 3), c('C', 9, 4),  // 拖拉机
      c('D', 3, 5),             // 其他非分副
      c('H', 5, 6),             // 副5单
    ];
    const sorted = sortDiscards(hand, cfg2, 'add');
    const order = orderOf(sorted, hand);
    expect(order.indexOf('H5')).toBeLessThan(order.indexOf('D3'));
    expect(order.indexOf('D3')).toBeLessThan(order.indexOf('C10'));
    expect(order.indexOf('C9')).toBeLessThan(order.indexOf('C10')); // 9 对先于需拆的 10 对
  });

  it('主牌分对（非常主）< A以下主牌非分单 < A以下主牌非分对 < 常主分单 < 其他主牌', () => {
    // ♠ 主、打10：S10 是常主分单（级牌且是分牌）
    const cfg10S: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 10 };
    const hand = [
      c('S', 13, 1), c('S', 13, 2),   // 主K对（非常主分对）
      c('S', 3, 3),             // A以下主牌非分单
      c('S', 4, 4), c('S', 4, 5),     // A以下主牌非分对
      c('S', 10, 6),            // 常主分单
      c('S', 14, 7),            // 其他主牌（A）
    ];
    const sorted = sortDiscards(hand, cfg10S, 'add');
    const order = orderOf(sorted, hand);
    expect(order.indexOf('S13')).toBeLessThan(order.indexOf('S3'));
    expect(order.indexOf('S3')).toBeLessThan(order.indexOf('S4'));
    expect(order.indexOf('S4')).toBeLessThan(order.indexOf('S10'));
    expect(order.indexOf('S10')).toBeLessThan(order.indexOf('S14'));
  });

  it('常主分对归其他主牌（打5时 主5对 在 常主分单 之后）', () => {
    const hand = [
      c('S', 5, 1), c('S', 5, 2),     // 常主分对（打5：S5 是级牌）
      c('H', 5, 3),             // 常主分单（H5 级牌）
      c('S', 10, 4),            // 主10（非常主分单）
    ];
    const sorted = sortDiscards(hand, cfg5, 'add');
    const order = orderOf(sorted, hand);
    // 主10（非常主）< 常主分单 < 常主分对（其他主牌）
    expect(order.indexOf('S10')).toBeLessThan(order.indexOf('H5'));
    expect(order.indexOf('H5')).toBeLessThan(order.indexOf('S5'));
  });
});

describe('sortDiscards full（第三家原则7）', () => {
  it('类别顺序：副10 < 副K < 主10 < 主K < 常主10/K < 副5 < 主5 < 其他非分副 < 其他主牌', () => {
    const hand = [
      c('S', 10, 1),            // 主10（打2，非常主）
      c('H', 10, 2),            // 副10
      c('H', 13, 3),            // 副K
      c('D', 5, 4),             // 副5
      c('S', 5, 5),             // 主5
      c('C', 3, 6),             // 其他非分副
      c('S', 14, 7),            // 其他主牌（A）
      c('H', 11, 8),            // 副J（其他非分副）
    ];
    const sorted = sortDiscards(hand, cfg2, 'full');
    const order = orderOf(sorted, hand);
    const idx = (s: string) => order.indexOf(s);
    expect(order[0]).toBe('H10');
    expect(idx('H13')).toBeLessThan(idx('S10'));
    expect(idx('S10')).toBeLessThan(idx('D5'));
    expect(idx('D5')).toBeLessThan(idx('S5'));
    expect(idx('S5')).toBeLessThan(idx('C3'));
    expect(idx('C3')).toBeLessThan(idx('H11'));
    expect(idx('H11')).toBeLessThan(idx('S14'));
  });

  it('打10时主牌10是常主（类5），排在副K后、副5前；副牌级牌10归常主', () => {
    const hand = [
      c('S', 10, 1),            // 主花色级牌10（常主）
      c('D', 10, 2),            // 副牌级牌10（常主，打10时四花色级牌都算主牌）
      c('H', 13, 3),            // 副K
      c('C', 5, 4),             // 副5
    ];
    const sorted = sortDiscards(hand, cfg10, 'full');
    const order = orderOf(sorted, hand);
    const idx = (s: string) => order.indexOf(s);
    expect(idx('H13')).toBeLessThan(idx('S10'));
    expect(idx('S10')).toBeLessThan(idx('C5'));
    expect(idx('D10')).toBeLessThan(idx('C5'));
  });
});

describe('sortDiscards forbid（第三家原则9）', () => {
  it('类别顺序：非分副 < 非分主 < 副5 < 主5 < 副10 < 副K < 主10/K', () => {
    const hand = [
      c('H', 10, 1),            // 副10
      c('H', 13, 2),            // 副K
      c('C', 5, 3),             // 副5
      c('S', 5, 4),             // 主5
      c('C', 3, 5),             // 非分副
      c('S', 3, 6),             // 非分主
      c('S', 10, 7),            // 主10
      c('S', 13, 8),            // 主K
    ];
    const sorted = sortDiscards(hand, cfg2, 'forbid');
    const order = orderOf(sorted, hand);
    const idx = (s: string) => order.indexOf(s);
    expect(order[0]).toBe('C3');
    expect(idx('C3')).toBeLessThan(idx('S3'));
    expect(idx('S3')).toBeLessThan(idx('C5'));
    expect(idx('C5')).toBeLessThan(idx('S5'));
    expect(idx('S5')).toBeLessThan(idx('H10'));
    expect(idx('H10')).toBeLessThan(idx('H13'));
    expect(idx('H13')).toBeLessThan(idx('S10'));
    expect(idx('S10')).toBeLessThan(idx('S13'));
  });

  it('主10/K 类内谁小谁优先（打10时主K 先于主10 级牌）', () => {
    const hand = [
      c('S', 10, 1),            // 主10（级牌，打10）
      c('S', 13, 2),            // 主K
    ];
    const sorted = sortDiscards(hand, cfg10, 'forbid');
    const order = orderOf(sorted, hand);
    expect(order[0]).toBe('S13');
  });
});

describe('pickDiscards 整对与拆对', () => {
  it('need=1 时不拆对：优先非分单张，无单张才兜底拆对', () => {
    const hand = [c('H', 10, 1), c('H', 10, 2), c('C', 3, 3)];
    const picked = pickDiscards(hand, 1, cfg2, 'avoid');
    expect(picked.map(x => x.rank)).toEqual([3]);
  });

  it('need=1 只有对子时兜底拆对（跟牌强制）', () => {
    const hand = [c('H', 10, 1), c('H', 10, 2)];
    const picked = pickDiscards(hand, 1, cfg2, 'avoid');
    expect(picked.length).toBe(1);
    expect(picked[0].rank).toBe(10);
  });

  it('need=2 时整对垫出（不拆）', () => {
    const hand = [c('H', 10, 1), c('H', 10, 2), c('C', 3, 3)];
    const picked = pickDiscards(hand, 2, cfg2, 'avoid');
    expect(picked.map(x => x.rank).sort((a, b) => a - b)).toEqual([3, 10]);
  });
});

describe('selectFillers 垫牌花色', () => {
  it('open 模式：优先张数最少的副牌花色整门垫出', () => {
    const hand = [
      c('H', 3, 1), c('H', 4, 2), c('H', 5, 3),  // ♥ 3张
      c('D', 10, 4), c('D', 11, 5),              // ♦ 2张（最少）
      c('S', 14, 6),                              // 主牌A（兜底）
    ];
    const picked = selectFillers(hand, 3, cfg2, 'open');
    // 张数最少的 ♦（2张整门）+ 还需1张 → 从 ♥ 截断
    expect(picked.length).toBe(3);
    expect(picked.filter(x => x.suit === 'D').length).toBe(2);
    expect(picked.some(x => x.suit === 'H')).toBe(true);
    expect(picked.some(x => isTrump(x, cfg2))).toBe(false); // 主牌不垫
  });

  it('avoid 模式：类别优先（非分副牌先于分牌），可混合多花色', () => {
    const hand = [
      c('H', 10, 1), c('H', 10, 2),   // 副分对（2张花色）
      c('C', 3, 3),                    // 副非分单（1张花色）
    ];
    const picked = selectFillers(hand, 2, cfg2, 'avoid');
    // 非分单 C3 优先，然后才轮到 ♥
    expect(picked.map(x => x.rank)).toContain(3);
  });

  it('副牌不够时主牌兜底', () => {
    const hand = [
      c('C', 3, 1),
      c('S', 14, 2), c('S', 10, 3),
    ];
    const picked = selectFillers(hand, 3, cfg2, 'open');
    expect(picked.length).toBe(3);
    expect(picked.some(x => isTrump(x, cfg2))).toBe(true);
  });
});

describe('谓词', () => {
  it('hasStrongFollowUp：有拖拉机或有可甩副牌', () => {
    const ctx = ctxOf(cfg2);
    // 有拖拉机（♠ 主：D3D3D4D4 是副牌拖拉机）
    const withTractor = [c('D', 3, 1), c('D', 3, 2), c('D', 4, 3), c('D', 4, 4), c('C', 2, 5)];
    expect(hasStrongFollowUp(withTractor, ctx)).toBe(true);
    // 无可甩（单张凑不满3张同花色）
    const weak = [c('D', 3, 1), c('C', 4, 2), c('S', 2, 3)];
    expect(hasStrongFollowUp(weak, ctx)).toBe(false);
  });

  it('secondShouldAvoid：手牌 >15 张', () => {
    const small = Array.from({ length: 15 }, (_, i) => c('C', (i % 10) + 3, i));
    const big = Array.from({ length: 16 }, (_, i) => c('C', (i % 10) + 3, i));
    expect(secondShouldAvoid(small)).toBe(false);
    expect(secondShouldAvoid(big)).toBe(true);
  });

  it('visibleTrickPoints：领出 + 当前最大（非领出时）', () => {
    const lead = [c('H', 10, 1)]; // 10分
    const ctx = ctxOf(cfg2, {
      bestSoFar: { cards: [c('H', 5, 2)], playerIndex: 1 }, // 5分
      leadPlayerIndex: 0,
    });
    expect(visibleTrickPoints(ctx, lead)).toBe(15);
    // 当前最大是领出者 → 不重复计
    const ctx2 = ctxOf(cfg2, { bestSoFar: { cards: lead, playerIndex: 0 }, leadPlayerIndex: 0 });
    expect(visibleTrickPoints(ctx2, lead)).toBe(10);
  });

  it('defense80：庄家方且已出含分、闲家得分 + 已出分 >= 80', () => {
    const lead = [c('H', 10, 1)];
    const ctx = ctxOf(cfg2, { attackerPoints: 75, isAttacker: false, bestSoFar: { cards: lead, playerIndex: 0 } });
    expect(defense80(ctx, lead)).toBe(true);
    const ctx2 = ctxOf(cfg2, { attackerPoints: 65, isAttacker: false, bestSoFar: { cards: lead, playerIndex: 0 } });
    expect(defense80(ctx2, lead)).toBe(false);
    // 闲家方不算防御
    const ctx3 = ctxOf(cfg2, { attackerPoints: 75, isAttacker: true, bestSoFar: { cards: lead, playerIndex: 0 } });
    expect(defense80(ctx3, lead)).toBe(false);
  });

  it('leadHasPoints：领出或当前最大含分', () => {
    const ctx = ctxOf(cfg2);
    const combo = { type: 'single' as const, cards: [c('H', 10, 1)], length: 1, pairCount: 0, tractors: [], hasTractor: false };
    expect(leadHasPoints(combo, ctx)).toBe(true);
    const combo2 = { ...combo, cards: [c('H', 3, 2)] };
    expect(leadHasPoints(combo2, ctx)).toBe(false);
    const ctx2 = ctxOf(cfg2, { bestSoFar: { cards: [c('D', 5, 3)], playerIndex: 1 } });
    expect(leadHasPoints(combo2, ctx2)).toBe(true);
  });
});
