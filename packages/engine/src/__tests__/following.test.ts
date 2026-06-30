import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import { validateFollow } from '../following/index.js';
import { classify } from '../pattern/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

const trump2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

describe('validateFollow', () => {
  it('rejects wrong count', () => {
    const r = validateFollow([c('H', 3, 0)], [c('H', 3, 0)], [c('H', 5, 1), c('H', 5, 2)], classify([c('H', 5, 1), c('H', 5, 2)], trump2), 'H' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('must play');
  });
  it('must follow suit', () => {
    const hand = [c('H', 3, 0), c('D', 4, 1)];
    const lead = [c('H', 5, 2)];
    // play D4 (non-trump, wrong suit) while having H3 (correct suit)
    const r = validateFollow([c('D', 4, 1)], hand, lead, classify(lead, trump2), 'H' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('follow suit');
  });
  it('void can trump', () => {
    const hand = [c('S', 2, 0)];
    const lead = [c('H', 5, 1)];
    const r = validateFollow([c('S', 2, 0)], hand, lead, classify(lead, trump2), 'H' as any, trump2);
    expect(r.valid).toBe(true);
  });
  it('trump lead must follow trump', () => {
    const hand = [c('S', 2, 0), c('S', 3, 1), c('H', 5, 2)];
    const lead = [c('S', 2, 3)];
    // play non-trump H5 while having trump S2,S3
    const r = validateFollow([c('H', 5, 2)], hand, lead, classify(lead, trump2), 'S' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('trump');
  });
  it('trump lead with pair — must play pair if available', () => {
    const hand = [c('S', 3, 0), c('S', 3, 1), c('S', 5, 2)];
    const lead = [c('S', 2, 3), c('S', 2, 5)];
    // try to play single trump while having pair
    const r = validateFollow([c('S', 3, 0), c('S', 5, 2)], hand, lead, classify(lead, trump2), 'S' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('pair');
  });
});
