import { describe, it, expect } from 'vitest';
import { Suit } from '@poker/engine';
import { createCard } from '@poker/engine';
import { parseCards, parseHumanCount, parseYesNo, parseSaveChoice, parseTrickNumber } from '../parse.js';
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

describe('parseHumanCount', () => {
  it('accepts valid range 0-4 without warning', () => {
    for (const [input, expected] of [['0', 0], ['1', 1], ['2', 2], ['3', 3], ['4', 4]] as const) {
      const r = parseHumanCount(input);
      expect(r.count).toBe(expected);
      expect(r.warning).toBeNull();
    }
  });

  it('clamps 5 to 4 with a warning', () => {
    const r = parseHumanCount('5');
    expect(r.count).toBe(4);
    expect(r.warning).toContain('超出范围');
  });

  it('clamps negative input to 0 with a warning', () => {
    const r = parseHumanCount('-1');
    expect(r.count).toBe(0);
    expect(r.warning).toContain('超出范围');
  });

  it('clamps 99 and -99 with the clamped value in the warning', () => {
    const hi = parseHumanCount('99');
    expect(hi.count).toBe(4);
    expect(hi.warning).toContain('4');

    const lo = parseHumanCount('-99');
    expect(lo.count).toBe(0);
    expect(lo.warning).toContain('0');
  });

  it('treats non-numeric input as default 1 with a warning', () => {
    const r = parseHumanCount('abc');
    expect(r.count).toBe(1);
    expect(r.warning).toContain('无效');
  });

  it('treats empty input as default 1 silently (默认1)', () => {
    const r = parseHumanCount('');
    expect(r.count).toBe(1);
    expect(r.warning).toBeNull();
  });

  it('treats whitespace input as empty', () => {
    const r = parseHumanCount('   ');
    expect(r.count).toBe(1);
    expect(r.warning).toBeNull();
  });
});

describe('parseYesNo', () => {
  it('accepts y/yes/n/no case-insensitively without warning', () => {
    for (const [input, expected] of [['y', true], ['yes', true], ['Y', true], ['YES', true], ['n', false], ['no', false], ['N', false]] as const) {
      const r = parseYesNo(input, false);
      expect(r.value).toBe(expected);
      expect(r.warning).toBeNull();
    }
  });

  it('empty input silently returns default', () => {
    const r = parseYesNo('', true);
    expect(r.value).toBe(true);
    expect(r.warning).toBeNull();
  });

  it('invalid input returns default with warning (默认 n)', () => {
    const r = parseYesNo('abc', false);
    expect(r.value).toBe(false);
    expect(r.warning).toContain('无效输入');
    expect(r.warning).toContain('n');
  });

  it('invalid input returns default with warning (默认 y)', () => {
    const r = parseYesNo('xyz', true);
    expect(r.value).toBe(true);
    expect(r.warning).toContain('y');
  });
});

describe('parseSaveChoice', () => {
  it('empty input silently skips', () => {
    const r = parseSaveChoice('', 3);
    expect(r.index).toBeNull();
    expect(r.warning).toBeNull();
  });

  it('parses 1-based index', () => {
    const r = parseSaveChoice('2', 3);
    expect(r.index).toBe(1);
    expect(r.warning).toBeNull();
  });

  it('rejects out-of-range index with warning', () => {
    const r = parseSaveChoice('5', 3);
    expect(r.index).toBeNull();
    expect(r.warning).toContain('1-3');
  });

  it('rejects 0 (not 1-based) with warning', () => {
    const r = parseSaveChoice('0', 3);
    expect(r.index).toBeNull();
    expect(r.warning).toContain('无效编号');
  });

  it('rejects non-numeric input with warning', () => {
    const r = parseSaveChoice('abc', 3);
    expect(r.index).toBeNull();
    expect(r.warning).toContain('无效编号');
  });
});

describe('parseTrickNumber', () => {
  it('empty input silently returns null (从当前)', () => {
    const r = parseTrickNumber('', 25);
    expect(r.trick).toBeNull();
    expect(r.warning).toBeNull();
  });

  it('parses valid trick within range', () => {
    const r = parseTrickNumber('12', 25);
    expect(r.trick).toBe(12);
    expect(r.warning).toBeNull();
  });

  it('parses 0', () => {
    const r = parseTrickNumber('0', 25);
    expect(r.trick).toBe(0);
    expect(r.warning).toBeNull();
  });

  it('rejects negative with warning', () => {
    const r = parseTrickNumber('-3', 25);
    expect(r.trick).toBeNull();
    expect(r.warning).toContain('0-25');
  });

  it('rejects beyond max with warning', () => {
    const r = parseTrickNumber('99', 25);
    expect(r.trick).toBeNull();
    expect(r.warning).toContain('0-25');
  });

  it('rejects non-numeric input with warning', () => {
    const r = parseTrickNumber('abc', 25);
    expect(r.trick).toBeNull();
    expect(r.warning).toContain('无效');
  });
});
