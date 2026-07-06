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
});
