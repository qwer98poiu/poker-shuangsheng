import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { validateThrow } from '../leading/index.js';
import type { Card, TrumpDeclaration } from '../types.js';

function ct(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
function cfg(level: number, trumpSuit: Suit | null = Suit.Spades): TrumpDeclaration {
  return { declarerIndex: 0, trumpSuit, level };
}

describe('validateThrow', () => {
  const config = cfg(2);

  it('passes: all sub-patterns are unblocked', () => {
    const thrown = [
      ct('H', 7, 0), ct('H', 7, 1), ct('H', 8, 2), ct('H', 8, 3),
      ct('H', 12, 4), ct('H', 12, 5),
      ct('H', 14, 6),
    ];
    const other = [
      [ct('H', 6, 7), ct('H', 5, 8), ct('H', 4, 9)],
      [ct('H', 3, 10), ct('H', 4, 11)],
      [ct('H', 10, 12)],
    ];
    expect(validateThrow(thrown, [...thrown, ct('H', 5, 99)], other, config).valid).toBe(true);
  });

  it('fails: higher pair', () => {
    const thrown = [ct('H', 8, 0), ct('H', 8, 1)];
    const r = validateThrow(thrown, [...thrown, ct('H', 7, 2)], [[ct('H', 10, 3), ct('H', 10, 4)]], config);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('higher pair');
  });

  it('fails: higher same-length tractor', () => {
    const thrown = [ct('H', 7, 0), ct('H', 7, 1), ct('H', 8, 2), ct('H', 8, 3)];
    const other = [[ct('H', 10, 4), ct('H', 10, 5), ct('H', 11, 6), ct('H', 11, 7)]];
    const r = validateThrow(thrown, [...thrown, ct('H', 6, 8)], other, config);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('2-pair tractor');
  });

  it('passes: longer tractor has no higher 2p sub', () => {
    const thrown = [ct('H', 5, 0), ct('H', 5, 1), ct('H', 6, 2), ct('H', 6, 3)];
    const other = [[ct('H', 2, 4), ct('H', 2, 5), ct('H', 3, 6), ct('H', 3, 7), ct('H', 4, 8), ct('H', 4, 9)]];
    expect(validateThrow(thrown, [...thrown, ct('H', 4, 10)], other, config).valid).toBe(true);
  });

  it('fails: longer tractor has a higher 2p sub', () => {
    const thrown = [ct('H', 7, 0), ct('H', 7, 1), ct('H', 8, 2), ct('H', 8, 3)];
    const other = [[ct('H', 11, 4), ct('H', 11, 5), ct('H', 12, 6), ct('H', 12, 7), ct('H', 13, 8), ct('H', 13, 9)]];
    const r = validateThrow(thrown, [...thrown, ct('H', 4, 10)], other, config);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('2-pair tractor');
  });

  it('fails: higher single', () => {
    const thrown = [ct('H', 5, 0), ct('H', 6, 1)];
    const r = validateThrow(thrown, [...thrown], [[ct('H', 14, 2)]], config);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('higher single');
  });

  it('fails: trump throw blocked by higher same-length tractor', () => {
    const thrown = [ct('S', 3, 0), ct('S', 3, 1), ct('S', 4, 2), ct('S', 4, 3), ct('S', 6, 4), ct('S', 6, 5)];
    const other = [[ct('S', 10, 6), ct('S', 10, 7), ct('S', 11, 8), ct('S', 11, 9), ct('S', 14, 10)]];
    const r = validateThrow(thrown, [...thrown, ct('J', 15, 11)], other, config);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('2-pair tractor');
  });

  it('passes: trump throw unblocked when all highest', () => {
    const thrown = [ct('S', 12, 0), ct('S', 12, 1), ct('S', 13, 2), ct('S', 13, 3), ct('S', 14, 4)];
    expect(validateThrow(thrown, [...thrown], [[], [], []], config).valid).toBe(true);
  });
});

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };

describe('non-trump throws (spades, cfg5)', () => {

  describe('singles-only', () => {
    it('pass: top singles, no higher cards elsewhere', () => {
      const thrown = [ct('S', 14, 0), ct('S', 13, 0), ct('S', 12, 0)];
      const hand = [...thrown, ct('S', 11, 10), ct('H', 3, 10)];
      const others = [
        [ct('S', 10, 1), ct('S', 9, 1)],
        [ct('S', 8, 1), ct('S', 7, 1)],
        [ct('S', 6, 1)],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: higher single exists', () => {
      const thrown = [ct('S', 11, 0), ct('S', 10, 0), ct('S', 8, 0)];
      const hand = [...thrown, ct('S', 6, 10), ct('H', 2, 10)];
      const others = [[ct('S', 14, 1)], [ct('S', 7, 1)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher single');
    });
  });

  describe('pair + single', () => {
    it('pass: top pair and single, no rivals', () => {
      const thrown = [ct('S', 14, 0), ct('S', 14, 1), ct('S', 13, 0)];
      const hand = [...thrown, ct('S', 11, 10), ct('S', 10, 10)];
      const others = [
        [ct('S', 12, 0), ct('S', 12, 1)],
        [ct('S', 10, 1)],
        [ct('S', 8, 1)],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: higher pair exists', () => {
      const thrown = [ct('S', 11, 0), ct('S', 11, 1), ct('S', 10, 0)];
      const hand = [...thrown, ct('S', 8, 10)];
      const others = [[ct('S', 14, 0), ct('S', 14, 1)], [ct('S', 6, 1)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher pair');
    });

    it('fail: higher single exists (pair is top)', () => {
      const thrown = [ct('S', 14, 0), ct('S', 14, 1), ct('S', 9, 0)];
      const hand = [...thrown, ct('S', 6, 10)];
      const others = [[ct('S', 13, 0)], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher single');
    });
  });

  describe('tractor + single', () => {
    it('pass: top tractor and single, no rivals', () => {
      const thrown = [
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
        ct('S', 12, 0),
      ];
      const hand = [...thrown, ct('S', 10, 10), ct('S', 9, 10)];
      const others = [
        [ct('S', 11, 0), ct('S', 10, 0)],
        [ct('S', 8, 0)],
        [ct('S', 7, 0)],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: higher same-length tractor exists', () => {
      const thrown = [
        ct('S', 11, 0), ct('S', 11, 1),
        ct('S', 10, 0), ct('S', 10, 1),
        ct('S', 9, 0),
      ];
      const hand = [...thrown, ct('S', 6, 10), ct('H', 2, 10)];
      const others = [[
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
      ], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('2-pair tractor');
    });

    it('fail: higher single exists (tractor is top)', () => {
      const thrown = [
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
        ct('S', 8, 0),
      ];
      const hand = [...thrown, ct('S', 6, 10)];
      const others = [[ct('S', 12, 0)], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher single');
    });
  });

  describe('tractor + standalone pair', () => {
    it('pass: top tractor and pair, no rivals', () => {
      const thrown = [
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
        ct('S', 11, 0), ct('S', 11, 1),
      ];
      const hand = [...thrown, ct('S', 9, 10), ct('H', 3, 10)];
      const others = [
        [ct('S', 10, 0), ct('S', 9, 0)],
        [ct('S', 8, 0)],
        [],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: standalone pair blocked by a card in another tractor', () => {
      const thrown = [
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
        ct('S', 9, 0),  ct('S', 9, 1),
      ];
      const hand = [...thrown, ct('S', 6, 10)];
      const others = [[
        ct('S', 12, 0), ct('S', 12, 1),
        ct('S', 11, 0), ct('S', 11, 1),
      ], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher pair');
    });

    it('fail: higher standalone pair blocks', () => {
      const thrown = [
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
        ct('S', 8, 0),  ct('S', 8, 1),
      ];
      const hand = [...thrown, ct('S', 6, 10)];
      const others = [[ct('S', 12, 0), ct('S', 12, 1)], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher pair');
    });

    it('fail: higher tractor blocks', () => {
      const thrown = [
        ct('S', 11, 0), ct('S', 11, 1),
        ct('S', 10, 0), ct('S', 10, 1),
        ct('S', 6, 0),  ct('S', 6, 1),
      ];
      const hand = [...thrown, ct('S', 4, 10)];
      const others = [[
        ct('S', 14, 0), ct('S', 14, 1),
        ct('S', 13, 0), ct('S', 13, 1),
      ], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('2-pair tractor');
    });
  });
});

describe('trump throws (hearts, cfg5)', () => {

  describe('singles-only (trump)', () => {
    it('pass: top trump singles, no rival', () => {
      const thrown = [ct('J', 16, 0), ct('J', 15, 0), ct('H', 14, 0)];
      const hand = [
        ...thrown,
        ct('J', 16, 1), ct('J', 15, 1), ct('H', 14, 1),
        ct('H', 13, 10), ct('S', 3, 10),
      ];
      const others = [
        [ct('H', 13, 0), ct('H', 12, 0)],
        [ct('H', 11, 0), ct('H', 10, 0)],
        [ct('H', 9, 0)],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: higher trump single exists', () => {
      const thrown = [ct('H', 13, 0), ct('H', 12, 0), ct('H', 11, 0)];
      const hand = [...thrown, ct('H', 10, 10), ct('S', 2, 10)];
      const others = [[ct('J', 16, 0)], [ct('H', 8, 0)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher single');
    });
  });

  describe('pair + single (trump)', () => {
    it('pass: top pair, no higher pair elsewhere', () => {
      const thrown = [ct('J', 16, 0), ct('J', 16, 1), ct('H', 14, 0)];
      const hand = [
        ...thrown,
        ct('J', 15, 0), ct('J', 15, 1), ct('H', 13, 10),
      ];
      const others = [
        [ct('H', 13, 0), ct('H', 12, 0)],
        [ct('H', 11, 0)],
        [ct('H', 10, 0), ct('H', 9, 0)],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: higher pair exists', () => {
      const thrown = [ct('H', 13, 0), ct('H', 13, 1), ct('H', 12, 0)];
      const hand = [...thrown, ct('H', 10, 10), ct('S', 3, 10)];
      const others = [[ct('J', 16, 0), ct('J', 16, 1)], [ct('H', 8, 0)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher pair');
    });

    it('fail: higher single exists (pair is top)', () => {
      const thrown = [ct('J', 16, 0), ct('J', 16, 1), ct('H', 9, 0)];
      const hand = [
        ...thrown,
        ct('J', 15, 0), ct('J', 15, 1), ct('H', 10, 10),
      ];
      const others = [[ct('H', 14, 1)], [ct('H', 11, 0)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher single');
    });
  });

  describe('tractor + single (trump)', () => {
    it('pass: top tractor, no rival', () => {
      const thrown = [
        ct('J', 16, 0), ct('J', 16, 1),
        ct('J', 15, 0), ct('J', 15, 1),
        ct('H', 14, 0),
      ];
      const hand = [...thrown, ct('H', 13, 10), ct('H', 12, 10)];
      const others = [
        [ct('H', 13, 0), ct('H', 12, 0), ct('H', 11, 0)],
        [ct('H', 10, 0)],
        [],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: higher same-length tractor exists', () => {
      const thrown = [
        ct('H', 11, 0), ct('H', 11, 1),
        ct('H', 10, 0), ct('H', 10, 1),
        ct('H', 9, 0),
      ];
      const hand = [...thrown, ct('H', 7, 10), ct('S', 2, 10)];
      const others = [[
        ct('H', 14, 0), ct('H', 14, 1),
        ct('H', 13, 0), ct('H', 13, 1),
      ], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('2-pair tractor');
    });

    it('fail: higher single exists (tractor is top)', () => {
      const thrown = [
        ct('J', 16, 0), ct('J', 16, 1),
        ct('J', 15, 0), ct('J', 15, 1),
        ct('H', 8, 0),
      ];
      const hand = [...thrown, ct('H', 13, 10), ct('H', 12, 10)];
      const others = [[ct('H', 14, 0)], [ct('H', 10, 0)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher single');
    });
  });

  describe('tractor + standalone pair (trump)', () => {
    it('pass: top tractor and pair, no rivals', () => {
      const thrown = [
        ct('J', 16, 0), ct('J', 16, 1),
        ct('J', 15, 0), ct('J', 15, 1),
        ct('H', 12, 0), ct('H', 12, 1),
      ];
      const hand = [...thrown, ct('H', 13, 10), ct('H', 11, 10)];
      const others = [
        [ct('H', 11, 0), ct('H', 10, 0), ct('H', 9, 0)],
        [ct('H', 8, 0)],
        [],
      ];
      expect(validateThrow(thrown, hand, others, cfg5).valid).toBe(true);
    });

    it('fail: standalone pair blocked by a card in another tractor', () => {
      const thrown = [
        ct('J', 16, 0), ct('J', 16, 1),
        ct('J', 15, 0), ct('J', 15, 1),
        ct('H', 9, 0),  ct('H', 9, 1),
      ];
      const hand = [...thrown, ct('H', 13, 10), ct('H', 12, 10)];
      const others = [[
        ct('H', 13, 0), ct('H', 13, 1),
        ct('H', 12, 0), ct('H', 12, 1),
      ], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher pair');
    });

    it('fail: higher standalone pair blocks', () => {
      const thrown = [
        ct('H', 14, 0), ct('H', 14, 1),
        ct('H', 13, 0), ct('H', 13, 1),
        ct('H', 8, 0),  ct('H', 8, 1),
      ];
      const hand = [...thrown, ct('H', 10, 10), ct('S', 2, 10)];
      const others = [[ct('J', 16, 0), ct('J', 16, 1)], [ct('H', 6, 0)], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('higher pair');
    });

    it('fail: higher tractor blocks', () => {
      const thrown = [
        ct('H', 12, 0), ct('H', 12, 1),
        ct('H', 11, 0), ct('H', 11, 1),
        ct('H', 6, 0),  ct('H', 6, 1),
      ];
      const hand = [...thrown, ct('H', 4, 10), ct('S', 3, 10)];
      const others = [[
        ct('H', 14, 0), ct('H', 14, 1),
        ct('H', 13, 0), ct('H', 13, 1),
      ], [], []];
      const r = validateThrow(thrown, hand, others, cfg5);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('2-pair tractor');
    });
  });
});

// ================================================================
// Cross-player phantom tractor: cards split across players must not
// combine into a tractor that no single player actually holds.
// ================================================================
describe('no cross-player phantom tractors', () => {
  const cfgNT3: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 3 };

  it('pass: pair+single throw, no individual player has higher tractor', () => {
    // ♦A + ♦8♦8♦7♦7.  Q+Q+J+J split across 3 players — no single
    // player has QQJJ, so the throw is valid.
    const thrown = [
      ct('D', 14, 0),
      ct('D', 8, 0), ct('D', 8, 1),
      ct('D', 7, 2), ct('D', 7, 3),
    ];
    const hand = [...thrown, ct('D', 6, 10), ct('H', 3, 10)];
    const others = [
      [ct('D', 13, 4), ct('D', 12, 5), ct('D', 11, 6), ct('D', 5, 7)],
      [ct('D', 13, 8), ct('D', 11, 9), ct('D', 10, 10)],
      [ct('D', 14, 11), ct('D', 12, 12), ct('D', 5, 13)],
    ];
    const r = validateThrow(thrown, hand, others, cfgNT3);
    expect(r.valid).toBe(true);
  });

  it('fail: one player actually has a higher tractor', () => {
    const thrown = [
      ct('D', 14, 0),
      ct('D', 8, 0), ct('D', 8, 1),
      ct('D', 7, 2), ct('D', 7, 3),
    ];
    const hand = [...thrown, ct('D', 6, 10), ct('H', 3, 10)];
    const others = [
      [ct('D', 12, 4), ct('D', 12, 5), ct('D', 11, 6), ct('D', 11, 7)],
      [ct('D', 10, 8)],
      [ct('D', 5, 9)],
    ];
    const r = validateThrow(thrown, hand, others, cfgNT3);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('2-pair tractor');
  });
});
