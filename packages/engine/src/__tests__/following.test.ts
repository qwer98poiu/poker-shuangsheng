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
  it('partial trump — must play all available trump when lead is multi-trump', () => {
    // Lead: joker joker ♥2 ♥2 (4 trump, tractor)
    // P1 has only 3 trump: ♣2 (off-suit level) + ♥Q + ♥7
    // P1 tries to play 4 non-trump — should be rejected
    const cfg: TrumpDeclaration = { declarerIndex: 2, trumpSuit: Suit.Hearts, level: 2 };
    const hand = [
      c('C', 2, 100),     // ♣2 副级牌 (trump)
      c('H', 12, 101),     // ♥Q (trump)
      c('H', 7, 102),      // ♥7 (trump)
      c('S', 14, 103),     // ♠A
      c('S', 13, 104),     // ♠K
      c('S', 10, 105),     // ♠10
      c('S', 8, 106),      // ♠8
    ];
    const lead = [
      c('J', 15, 200), c('J', 15, 201), c('H', 2, 202), c('H', 2, 203),
    ];
    const leadPattern = classify(lead, cfg);

    // Play 4 spades while having 3 trump — should reject
    const play = hand.filter(c => c.suit === Suit.Spades).slice(0, 4);
    const r = validateFollow(play, hand, lead, leadPattern, null, cfg);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('trump');
  });

  it('partial trump — allowed when all available trump are played', () => {
    // Same scenario but P1 plays all 3 trump + 1 non-trump — should pass
    const cfg: TrumpDeclaration = { declarerIndex: 2, trumpSuit: Suit.Hearts, level: 2 };
    const hand = [
      c('C', 2, 100),     // ♣2 (trump)
      c('H', 12, 101),     // ♥Q (trump)
      c('H', 7, 102),      // ♥7 (trump)
      c('S', 14, 103),     // ♠A
      c('S', 13, 104),     // ♠K
    ];
    const lead = [
      c('J', 15, 200), c('J', 15, 201), c('H', 2, 202), c('H', 2, 203),
    ];
    const leadPattern = classify(lead, cfg);

    // Play 3 trump + 1 non-trump — should pass
    const play = [
      hand.find(c => c.suit === 'C' && c.rank === 2)!,
      hand.find(c => c.suit === 'H' && c.rank === 12)!,
      hand.find(c => c.suit === 'H' && c.rank === 7)!,
      hand.find(c => c.suit === 'S')!,
    ];
    const r = validateFollow(play, hand, lead, leadPattern, null, cfg);
    expect(r.valid).toBe(true);
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
