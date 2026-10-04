import { describe, it, expect } from 'vitest';
import { createCard, Suit } from '@poker/engine';
import type { Card, TrumpDeclaration } from '@poker/engine';
import {
  ALL_LEVELS, DEFAULT_LEVELS, DEAL_FILTERS, availableFilterNames,
  parseLevels, passesDealFilters, resolveDealFilters,
} from '../solo-filter.js';
import type { DealFilterContext } from '../solo-filter.js';

/** 无主亮主（level 2）：每一门都是副牌。 */
const NT2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

let cardId = 0;
/** Build cards of one suit from a rank list (unique ids via a running counter). */
function suitCards(suit: Card['suit'], ranks: number[]): Card[] {
  return ranks.map(r => createCard(suit, r, cardId++));
}

function ctxOf(hands: Card[][], decl: TrumpDeclaration = NT2, deck: Card[] = []): DealFilterContext {
  return { hands, deck, level: decl.level, decl };
}

/** A 108-card deck whose bottom (deck[100..107]) is `bottom`; the rest is filler. */
function deckWithBottom(bottom: Card[]): Card[] {
  const filler = Array.from({ length: 100 }, () => createCard(Suit.Diamonds, 3, cardId++));
  return [...filler, ...bottom];
}

describe('parseLevels', () => {
  it('默认等级串 2,5,10,Q,K,A → [2,5,10,12,13,14]', () => {
    expect(parseLevels('2,5,10,Q,K,A')).toEqual([2, 5, 10, 12, 13, 14]);
  });

  it('DEFAULT_LEVELS 就是 2,5,10,Q,K,A', () => {
    expect([...DEFAULT_LEVELS]).toEqual([2, 5, 10, 12, 13, 14]);
  });

  it('all → 2..A 全 13 档（大小写均可）', () => {
    expect(parseLevels('all')).toEqual([...ALL_LEVELS]);
    expect(parseLevels('ALL')).toEqual([...ALL_LEVELS]);
    expect(parseLevels(' all ')).toEqual([...ALL_LEVELS]);
  });

  it('J/Q/K/A 大小写不敏感，且与数字同义', () => {
    expect(parseLevels('j,q,k,a')).toEqual([11, 12, 13, 14]);
    expect(parseLevels('11,12,13,14')).toEqual([11, 12, 13, 14]);
  });

  it('去重并升序', () => {
    expect(parseLevels('10,2,10,2')).toEqual([2, 10]);
    expect(parseLevels('A,2')).toEqual([2, 14]);
    expect(parseLevels('K,5,J')).toEqual([5, 11, 13]);
  });

  it('非法 token 报错并指出该 token', () => {
    expect(() => parseLevels('1')).toThrow(/1/);
    expect(() => parseLevels('15')).toThrow(/15/);
    expect(() => parseLevels('X')).toThrow(/X/);
    expect(() => parseLevels('2,Q,3')).not.toThrow();
    expect(() => parseLevels('2,,3')).toThrow(/空项/);
    expect(() => parseLevels('')).toThrow(/不能为空/);
  });
});

describe('发牌过滤器注册表（接口/管道）', () => {
  it('空列表恒通过', () => {
    expect(resolveDealFilters([])).toEqual([]);
    expect(passesDealFilters([], ctxOf([]))).toBe(true);
  });

  it('未注册的名字报错，且报错文本点名该名字', () => {
    expect(() => resolveDealFilters(['no-such-filter-xyz'])).toThrow(/no-such-filter-xyz/);
  });

  it('注册一个过滤器后：解析通过、求值按 AND 组合', () => {
    DEAL_FILTERS.set('t-even-level', ctx => ctx.level % 2 === 0);
    try {
      expect(availableFilterNames()).toContain('t-even-level');
      expect(resolveDealFilters(['t-even-level'])).toEqual(['t-even-level']);
      expect(passesDealFilters(['t-even-level'], ctxOf([], { declarerIndex: 0, trumpSuit: null, level: 4 }))).toBe(true);
      expect(passesDealFilters(['t-even-level'], ctxOf([], { declarerIndex: 0, trumpSuit: null, level: 5 }))).toBe(false);
      // 未知名字的报错列出可用名字
      expect(() => resolveDealFilters(['nope'])).toThrow(/t-even-level/);
    } finally {
      DEAL_FILTERS.delete('t-even-level');
    }
  });
});

describe('内置过滤器 long-suit', () => {
  /** 10 张黑桃：AA KK QQ JJ 9 8 —— ≥9 张且拖拉机（8 张）即 ≥6 控制。 */
  const tenSpades = (): Card[] => suitCards(Suit.Spades, [14, 14, 13, 13, 12, 12, 11, 11, 9, 8]);
  /** 8 张黑桃 AAKKQQJJ —— 只有 8 张，不够长。 */
  const eightSpades = (): Card[] => suitCards(Suit.Spades, [14, 14, 13, 13, 12, 12, 11, 11]);

  it('已注册：可被 --deal-filter 指名', () => {
    expect(availableFilterNames()).toContain('long-suit');
    expect(resolveDealFilters(['long-suit'])).toEqual(['long-suit']);
  });

  it('任一座位有长花色即通过', () => {
    expect(passesDealFilters(['long-suit'], ctxOf([[], tenSpades(), [], []]))).toBe(true);
  });

  it('无人有长花色则不通过', () => {
    expect(passesDealFilters(['long-suit'], ctxOf([eightSpades(), [], [], []]))).toBe(false);
  });

  it('庄家 P0 用 33 张池：底牌补足后才够长', () => {
    // P0 手上只有 7 张黑桃 —— 单独看不够 9 张。
    const hands = [suitCards(Suit.Spades, [14, 14, 13, 13, 12, 12, 11]), [], [], []];
    const noSpadeBottom = deckWithBottom(suitCards(Suit.Diamonds, [3, 4, 5, 6, 7, 8, 9, 10]));
    expect(passesDealFilters(['long-suit'], ctxOf(hands, NT2, noSpadeBottom))).toBe(false);

    // 底牌里再补 4 张黑桃 → 33 张池里 11 张黑桃 → 长花色。
    const spadeBottom = deckWithBottom([
      ...suitCards(Suit.Spades, [10, 9, 8, 7]),
      ...suitCards(Suit.Diamonds, [3, 4, 5, 6]),
    ]);
    expect(passesDealFilters(['long-suit'], ctxOf(hands, NT2, spadeBottom))).toBe(true);
  });

  it('非庄家只按 25 张手牌算：底牌不计入', () => {
    // 同样的 7 张黑桃放在 P3，底牌再有 4 张黑桃也不会被算进去。
    const hands = [[], [], [], suitCards(Suit.Spades, [14, 14, 13, 13, 12, 12, 11])];
    const spadeBottom = deckWithBottom([
      ...suitCards(Suit.Spades, [10, 9, 8, 7]),
      ...suitCards(Suit.Diamonds, [3, 4, 5, 6]),
    ]);
    expect(passesDealFilters(['long-suit'], ctxOf(hands, NT2, spadeBottom))).toBe(false);
  });

  it('用 ctx.decl 判副牌：同一手牌被亮成主牌后不再是长花色', () => {
    const hands = [[], tenSpades(), [], []];
    expect(passesDealFilters(['long-suit'], ctxOf(hands, NT2))).toBe(true);
    const spadeTrump: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
    expect(passesDealFilters(['long-suit'], ctxOf(hands, spadeTrump))).toBe(false);
  });
});
