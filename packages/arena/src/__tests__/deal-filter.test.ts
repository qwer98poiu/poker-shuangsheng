import { describe, it, expect } from 'vitest';
import { createCard, Suit } from '@poker/engine';
import type { Card, TrumpDeclaration } from '@poker/engine';
import {
  ALL_LEVELS, DEFAULT_LEVELS, availableFilterNames, parseLevels,
  passesDealFilters, resolveDealFilters,
} from '../deal-filter.js';
import { longSuitDealFilter } from '../deal-filters.js';

describe('parseLevels', () => {
  it('all = 2..A', () => {
    expect(parseLevels('all')).toEqual([...ALL_LEVELS]);
    expect(parseLevels('ALL')).toEqual([...ALL_LEVELS]);
  });

  it('数字与 J/Q/K/A 混写；去重、升序', () => {
    expect(parseLevels('2,5,10,Q,K,A')).toEqual([...DEFAULT_LEVELS]);
    expect(parseLevels('A,2,J,2,k,10,q')).toEqual([2, 10, 11, 12, 13, 14]);
  });

  it('非法输入报错并指出该项', () => {
    expect(() => parseLevels('')).toThrow('--level 不能为空');
    expect(() => parseLevels('2,,K')).toThrow('空项');
    expect(() => parseLevels('1')).toThrow('超出 2..14');
    expect(() => parseLevels('X')).toThrow('非法等级: X');
  });
});

describe('过滤器注册表', () => {
  it('当前只有 long-suit', () => {
    expect(availableFilterNames()).toEqual(['long-suit']);
    expect(resolveDealFilters(['long-suit'])).toEqual(['long-suit']);
    expect(() => resolveDealFilters(['nope'])).toThrow('未知的发牌过滤器: nope');
  });

  it('空过滤器恒通过', () => {
    const ctx = {
      hands: [], deck: [], level: 2,
      decl: { declarerIndex: 0, trumpSuit: null, level: 2 } as TrumpDeclaration,
    };
    expect(passesDealFilters([], ctx)).toBe(true);
  });
});

describe('long-suit = 副牌长套（主牌门不算）', () => {
  /** 3♠ 到 7♠ 各两张 → 5 连对；避开等级 2（等级牌恒为主牌）。 */
  function spadeChain(startRank = 3, pairs = 5, startId = 0): Card[] {
    const cards: Card[] = [];
    let id = startId;
    for (let i = 0; i < pairs; i++) {
      cards.push(createCard(Suit.Spades, startRank + i, id++));
      cards.push(createCard(Suit.Spades, startRank + i, id++));
    }
    return cards;
  }

  function ctxWithTrump(trumpSuit: Suit): Parameters<typeof longSuitDealFilter>[0] {
    const hand = spadeChain();
    return {
      hands: [hand, [], [], []],
      deck: hand,
      level: 2,
      decl: { declarerIndex: 0, trumpSuit, level: 2 },
    };
  }

  it('黑桃为副牌时，长套通过', () => {
    expect(longSuitDealFilter(ctxWithTrump(Suit.Hearts))).toBe(true);
  });

  it('黑桃为主牌时，同一手牌不算长花色', () => {
    expect(longSuitDealFilter(ctxWithTrump(Suit.Spades))).toBe(false);
  });

  it('长套不必在庄家手里：任一座位的手牌都参与判断', () => {
    const hand = spadeChain(3, 5, 0); // 10 张黑桃，5 连对
    const ctx: Parameters<typeof longSuitDealFilter>[0] = {
      hands: [[], hand, [], []],
      deck: hand, // 长度不足 100，底牌为空
      level: 2,
      decl: { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 } as TrumpDeclaration,
    };
    expect(longSuitDealFilter(ctx)).toBe(true);
  });

  it('候选庄家用 33 张池（25 手牌 + 底牌 8）', () => {
    // 手牌 8 张黑桃（4 对，<9 张）+ 17 张方块；底牌 8 张里补 6 张黑桃。
    const handSpades = spadeChain(3, 4, 0); // 3..6，8 张
    // 其余 17 张用主牌门（红桃），会被 computeOffSuitControls 剔除，避免本身构成另一门长套。
    const handHearts = Array.from({ length: 17 }, (_, i) =>
      createCard(Suit.Hearts, 3 + (i % 11), 100 + i));
    const hand = [...handSpades, ...handHearts];
    const bottomSpades = spadeChain(7, 3, 200); // 7..9，6 张
    const bottomFiller = [createCard(Suit.Clubs, 3, 300), createCard(Suit.Clubs, 4, 301)];
    const filler = Array.from({ length: 100 }, (_, i) =>
      createCard(Suit.Clubs, 3 + (i % 11), 400 + i));
    const deckWithBottom = [...filler, ...bottomSpades, ...bottomFiller];
    const deckWithout = [...filler, ...bottomFiller, ...bottomFiller];

    const base = {
      hands: [hand, [], [], []],
      level: 2,
      decl: { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 } as TrumpDeclaration,
    };
    // 手牌本身 8 张黑桃（<9），不构成 longShape；底牌补到 14 张后通过。
    expect(longSuitDealFilter({ ...base, deck: deckWithout })).toBe(false);
    expect(longSuitDealFilter({ ...base, deck: deckWithBottom })).toBe(true);
  });
});
