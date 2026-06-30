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
  const config = cfg(2); // level=2, trump=♠ — 2 is the only level rank

  it('passes: all sub-patterns are unblocked', () => {
    // ♥ throw: tractor 7788 + pair QQ + single A (others have only lower ♥ cards, no 2's)
    // level=2, so 5,6,7,8,10,12,14 are all non-trump non-level
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
    // thrown: ♥ 5566 (max=6). Other has ♥ 223344 (3p, all 2p subs max≤4). Passes.
    const thrown = [ct('H', 5, 0), ct('H', 5, 1), ct('H', 6, 2), ct('H', 6, 3)];
    const other = [[ct('H', 2, 4), ct('H', 2, 5), ct('H', 3, 6), ct('H', 3, 7), ct('H', 4, 8), ct('H', 4, 9)]];
    expect(validateThrow(thrown, [...thrown, ct('H', 4, 10)], other, config).valid).toBe(true);
  });

  it('fails: longer tractor has a higher 2p sub', () => {
    // thrown: ♥ 7788 (max=8). Other has ♥ JJQQKK (sub QQKK max=K=13 > 8). Fails.
    const thrown = [ct('H', 7, 0), ct('H', 7, 1), ct('H', 8, 2), ct('H', 8, 3)];
    const other = [[ct('H', 11, 4), ct('H', 11, 5), ct('H', 12, 6), ct('H', 12, 7), ct('H', 13, 8), ct('H', 13, 9)]];
    const r = validateThrow(thrown, [...thrown, ct('H', 4, 10)], other, config);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('2-pair tractor');
  });

  it('fails: higher single', () => {
    const thrown = [ct('H', 5, 0), ct('H', 6, 1)];
    // ♥A rank 14, not level (level=2), so it's non-trump ♥ and blocks
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
