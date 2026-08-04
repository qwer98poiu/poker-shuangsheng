import { describe, it, expect } from 'vitest';
import { Suit } from '@poker/engine';
import { createCard } from '@poker/engine';
import { parseCards } from '../parse.js';
import type { Card, TrumpDeclaration } from '@poker/engine';

const cfgD2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
const cfgNull: TrumpDeclaration | null = null;

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

describe('parseCards', () => {
  const hand25: Card[] = Array.from({ length: 25 }, (_, i) => {
    const suits = ['S', 'H', 'C', 'D'];
    return c(suits[i % 4], 2 + (i % 13), i);
  });

  describe('valid indices', () => {
    it('parses three valid indices', () => {
      const r = parseCards('0 1 2', hand25, cfgD2);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(3);
    });

    it('parses single valid index', () => {
      const r = parseCards('0', hand25, cfgD2);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(1);
    });

    it('parses last valid index (24)', () => {
      const r = parseCards('24', hand25, cfgD2);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(1);
    });

    it('returns empty for empty input', () => {
      const r = parseCards('', hand25, cfgD2);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(0);
    });

    it('works with null trump config', () => {
      const r = parseCards('0 1', hand25, cfgNull);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(2);
    });
  });

  describe('invalid indices', () => {
    it('rejects out of range (25 when max is 24)', () => {
      const r = parseCards('24 25', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('超出范围');
    });

    it('rejects single out of range', () => {
      const r = parseCards('25', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('超出范围');
    });

    it('rejects negative index', () => {
      const r = parseCards('-1', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('超出范围');
    });

    it('rejects non-numeric input', () => {
      const r = parseCards('abc', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('无效编号');
    });

    it('rejects mixed valid and invalid', () => {
      const r = parseCards('0 abc 2', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('无效编号');
    });

    it('rejects way out of range (99)', () => {
      const r = parseCards('99', hand25, cfgD2);
      expect(r.error).toContain('超出范围');
    });

    it('rejects index for empty hand', () => {
      const r = parseCards('0', [], cfgD2);
      expect(r.error).toContain('超出范围');
    });
  });

  describe('bottom exchange (扣底) scenario', () => {
    // Simulating a 33-card merged hand (25 + 8 bottom cards)
    const hand33: Card[] = Array.from({ length: 33 }, (_, i) => {
      const suits = ['S', 'H', 'C', 'D'];
      return c(suits[i % 4], 2 + (i % 13), i);
    });

    it('accepts 8 valid indices for 33-card hand', () => {
      const r = parseCards('0 1 2 3 4 5 6 7', hand33, cfgD2);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(8);
    });

    it('rejects index 33 for 33-card hand (max is 32)', () => {
      const r = parseCards('0 1 2 3 4 5 6 33', hand33, cfgD2);
      expect(r.error).toContain('超出范围');
    });
  });

  describe('duplicate indices (重复编号)', () => {
    // 用户实测场景：33 张（25 手牌 + 8 底牌）扣底输入 "22 23 24 25 20 21 18 21"，
    // 21 出现两次 → 旧实现返回 8 张（含同一张牌两次），扣底只移走 7 张，
    // 庄家手牌剩 26 张而非 25 张，总牌数不再守恒。
    it('rejects the user-reported duplicate bottom selection', () => {
      const hand33: Card[] = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'];
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = parseCards('22 23 24 25 20 21 18 21', hand33, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('重复编号');
      expect(r.error).toContain('21');
    });

    it('rejects duplicate index in play input', () => {
      const r = parseCards('5 5', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('重复编号');
    });

    it('rejects any repeated index regardless of order', () => {
      const r = parseCards('3 1 3', hand25, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('重复编号');
    });

    it('rejects duplicates among 8 bottom picks', () => {
      const hand33: Card[] = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'];
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = parseCards('0 1 2 3 4 5 6 6', hand33, cfgD2);
      expect(r.cards.length).toBe(0);
      expect(r.error).toContain('重复编号');
    });

    it('still accepts 8 distinct bottom picks', () => {
      const hand33: Card[] = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'];
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = parseCards('0 1 2 3 4 5 6 7', hand33, cfgD2);
      expect(r.error).toBeUndefined();
      expect(r.cards.length).toBe(8);
      expect(new Set(r.cards.map(c => c.id)).size).toBe(8);
    });

    it('range check still wins over duplicate check', () => {
      const r = parseCards('5 5 99', hand25, cfgD2);
      expect(r.error).toContain('超出范围');
    });
  });
});
