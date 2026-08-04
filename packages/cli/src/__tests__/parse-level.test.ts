import { describe, it, expect } from 'vitest';
import { Suit } from '@poker/engine';
import { parseLevelSuit } from '../parse-level.js';

describe('parseLevelSuit', () => {
  it('defaults to level 2, no suit for empty input', () => {
    const r = parseLevelSuit('');
    expect(r.level).toBe(2);
    expect(r.suit).toBeUndefined();
    expect(r.hasSuit).toBe(false);
  });

  it('parses level only: "5"', () => {
    const r = parseLevelSuit('5');
    expect(r.level).toBe(5);
    expect(r.suit).toBeUndefined();
    expect(r.hasSuit).toBe(false);
  });

  it('parses "5NT" → level 5, NT', () => {
    const r = parseLevelSuit('5NT');
    expect(r.level).toBe(5);
    expect(r.suit).toBeNull();
    expect(r.hasSuit).toBe(true);
  });

  it('parses "5nt" (lowercase) → level 5, NT', () => {
    const r = parseLevelSuit('5nt');
    expect(r.level).toBe(5);
    expect(r.suit).toBeNull();
    expect(r.hasSuit).toBe(true);
  });

  it('parses "2C" → level 2, Clubs', () => {
    const r = parseLevelSuit('2C');
    expect(r.level).toBe(2);
    expect(r.suit).toBe(Suit.Clubs);
    expect(r.hasSuit).toBe(true);
  });

  it('parses "KS" → level 13, Spades', () => {
    const r = parseLevelSuit('KS');
    expect(r.level).toBe(13);
    expect(r.suit).toBe(Suit.Spades);
    expect(r.hasSuit).toBe(true);
  });

  it('parses "AH" → level 14, Hearts', () => {
    const r = parseLevelSuit('AH');
    expect(r.level).toBe(14);
    expect(r.suit).toBe(Suit.Hearts);
    expect(r.hasSuit).toBe(true);
  });

  it('parses "Q" → level 12, no suit', () => {
    const r = parseLevelSuit('Q');
    expect(r.level).toBe(12);
    expect(r.suit).toBeUndefined();
    expect(r.hasSuit).toBe(false);
  });

  it('parses "jd" → level 11, Diamonds', () => {
    const r = parseLevelSuit('jd');
    expect(r.level).toBe(11);
    expect(r.suit).toBe(Suit.Diamonds);
    expect(r.hasSuit).toBe(true);
  });

  it('caps level > 14 to 2', () => {
    const r = parseLevelSuit('15S');
    expect(r.level).toBe(2);
    expect(r.suit).toBe(Suit.Spades);
  });

  it('parses "KNT" → level 13, NT', () => {
    const r = parseLevelSuit('KNT');
    expect(r.level).toBe(13);
    expect(r.suit).toBeNull();
    expect(r.hasSuit).toBe(true);
  });

  it('parses "NT" alone → level 2, NT', () => {
    const r = parseLevelSuit('NT');
    expect(r.level).toBe(2);
    expect(r.suit).toBeNull();
    expect(r.hasSuit).toBe(true);
  });

  describe('warnings', () => {
    it('warns when level > 14 and clamps to 2', () => {
      const r = parseLevelSuit('15S');
      expect(r.level).toBe(2);
      expect(r.suit).toBe(Suit.Spades);
      expect(r.warning).toContain('超出范围');
    });

    it('warns when level < 2 and clamps to 2', () => {
      const r = parseLevelSuit('1');
      expect(r.level).toBe(2);
      expect(r.warning).toContain('超出范围');
    });

    it('warns on unparseable input', () => {
      const r = parseLevelSuit('xyz');
      expect(r.level).toBe(2);
      expect(r.suit).toBeUndefined();
      expect(r.warning).toContain('无法识别');
    });

    it('no warning for "NT" alone (valid, defaults level 2)', () => {
      const r = parseLevelSuit('NT');
      expect(r.warning).toBeNull();
    });

    it('no warning for valid inputs', () => {
      for (const input of ['2C', '5', 'KNT', 'AH', 'jd']) {
        expect(parseLevelSuit(input).warning).toBeNull();
      }
    });

    it('no warning for empty input', () => {
      expect(parseLevelSuit('').warning).toBeNull();
    });
  });
});
