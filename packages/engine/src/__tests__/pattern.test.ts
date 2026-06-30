import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import { classify, detectTractors, findAllPairs } from '../pattern/index.js';
import type { TrumpDeclaration } from '../types.js';

const trump5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 5 };
const nt2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

function c(suit: string, rank: number, idx: number) {
  return createCard(suit as any, rank as any, idx);
}

describe('Pattern — classify', () => {
  it('single', () => expect(classify([c('H', 14, 0)], trump5).type).toBe('single'));
  it('pair', () => {
    const r = classify([c('H', 14, 0), c('H', 14, 1)], trump5);
    expect(r.type).toBe('pair');
    expect(r.pairCount).toBe(1);
  });
  it('simple same-suit tractor', () => {
    const cards = [c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3)];
    const r = classify(cards, trump5);
    expect(r.type).toBe('tractor');
    expect(r.tractors).toHaveLength(1);
    expect(r.tractors[0].pairCount).toBe(2);
  });
  it('throw with standalone pairs', () => {
    const cards = [c('H', 14, 0), c('H', 14, 1), c('H', 10, 2)];
    const r = classify(cards, trump5);
    expect(r.type).toBe('throw');
    expect(r.pairCount).toBe(1);
    expect(r.hasTractor).toBe(false);
  });
});

describe('Pattern — tractors', () => {
  it('BJ+SJ is tractor', () => {
    const t = detectTractors([c('J', 16, 0), c('J', 16, 1), c('J', 15, 2), c('J', 15, 3)], trump5);
    expect(t.length).toBeGreaterThan(0);
  });
  it('SJ+TrumpLevel is tractor', () => {
    const t = detectTractors([c('J', 15, 0), c('J', 15, 1), c('S', 5, 2), c('S', 5, 3)], trump5);
    expect(t.length).toBeGreaterThan(0);
  });
  it('TrumpLevel+OffSuitLevel is tractor', () => {
    const t = detectTractors([c('S', 5, 0), c('S', 5, 1), c('H', 5, 2), c('H', 5, 3)], trump5);
    expect(t.length).toBeGreaterThan(0);
  });
  it('OffSuitLevel+TrumpA is tractor', () => {
    const t = detectTractors([c('H', 5, 0), c('H', 5, 1), c('S', 14, 2), c('S', 14, 3)], trump5);
    expect(t.length).toBeGreaterThan(0);
  });
  it('SJ+Level pair is tractor (NT mode)', () => {
    const t = detectTractors([c('J', 15, 0), c('J', 15, 1), c('H', 2, 2), c('H', 2, 3)], nt2);
    expect(t.length).toBeGreaterThan(0);
  });
  it('BJ+SJ+Level is tractor (NT mode)', () => {
    const t = detectTractors([
      c('J', 16, 0), c('J', 16, 1),
      c('J', 15, 2), c('J', 15, 3),
      c('H', 2, 4), c('H', 2, 5),
    ], nt2);
    expect(t.some(tr => tr.length >= 6)).toBe(true);
  });
  it('two level pairs are NOT a tractor (NT)', () => {
    const t = detectTractors([c('H', 2, 0), c('H', 2, 1), c('S', 2, 2), c('S', 2, 3)], nt2);
    expect(t).toHaveLength(0);
  });
  it('Trumplevel+TrumpleA is NOT a tractor', () => {
    const t = detectTractors([c('S', 5, 0), c('S', 5, 1), c('S', 14, 2), c('S', 14, 3)], trump5);
    expect(t).toHaveLength(0);
  });
  it('skipping level card counts as tractor', () => {
    const t = detectTractors([c('S', 6, 0), c('S', 6, 1), c('S', 4, 2), c('S', 4, 3)], trump5);
    expect(t.length).toBeGreaterThan(0);
  });
  it('non-consecutive is NOT a tractor', () => {
    const t = detectTractors([c('H', 14, 0), c('H', 14, 1), c('H', 10, 2), c('H', 10, 3)], trump5);
    expect(t).toHaveLength(0);
  });
});
