import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { detectTractors } from '../pattern/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
function pairs(ranks: [string, number][]): Card[] {
  return ranks.map(([s, r]) => [c(s, r, 0), c(s, r, 1)]).flat();
}
function hasTractor(cards: Card[], expectedPairs: number, config: TrumpDeclaration): boolean {
  return detectTractors(cards, config).some(t => t.length / 2 === expectedPairs && t.length === cards.length);
}

// ================================================================
// Case 1: Level=2, trump=Hearts (红桃主)
// ================================================================
describe('level=2, trump=Hearts', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };

  describe('same-suit: level card breaks chain', () => {
    it('H-33+22 is NOT a tractor (both trump but effRank not adjacent)', () => {
      const cards = pairs([['H', 3], ['H', 2]]);
      expect(hasTractor(cards, 2, cfg)).toBe(false);
    });

    it('S-33+22 is NOT a tractor (different suit groups)', () => {
      const cards = pairs([['S', 3], ['S', 2]]);
      expect(hasTractor(cards, 2, cfg)).toBe(false);
    });

    it('H-44+33 IS a tractor (both non-level trump, consecutive effRank)', () => {
      const cards = pairs([['H', 4], ['H', 3]]);
      expect(hasTractor(cards, 2, cfg)).toBe(true);
    });

    it('H-AA+KK+QQ IS a 3-pair tractor (non-level trump, consecutive)', () => {
      const cards = pairs([['H', 14], ['H', 13], ['H', 12]]);
      expect(hasTractor(cards, 3, cfg)).toBe(true);
    });
  });

  describe('cross-group tractors', () => {
    it('BJ+SJ → 2-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15]]), 2, cfg)).toBe(true);
    });

    it('SJ+H2 → 2-pair tractor', () => {
      expect(hasTractor(pairs([['J', 15], ['H', 2]]), 2, cfg)).toBe(true);
    });

    it('H2+S2 → 2-pair tractor (tLev + offLev)', () => {
      expect(hasTractor(pairs([['H', 2], ['S', 2]]), 2, cfg)).toBe(true);
    });

    it('S2+HA → 2-pair tractor (offLev + tA)', () => {
      expect(hasTractor(pairs([['S', 2], ['H', 14]]), 2, cfg)).toBe(true);
    });

    it('BJ+SJ+H2 → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15], ['H', 2]]), 3, cfg)).toBe(true);
    });

    it('SJ+H2+S2 → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 15], ['H', 2], ['S', 2]]), 3, cfg)).toBe(true);
    });

    it('H2+S2+HA → 3-pair tractor', () => {
      expect(hasTractor(pairs([['H', 2], ['S', 2], ['H', 14]]), 3, cfg)).toBe(true);
    });
  });

  describe('non-trump same-suit', () => {
    it('S-AA+KK IS a tractor (consecutive, no level between)', () => {
      expect(hasTractor(pairs([['S', 14], ['S', 13]]), 2, cfg)).toBe(true);
    });

    it('S-AA+QQ is NOT a tractor (K between, K≠level=2)', () => {
      expect(hasTractor(pairs([['S', 14], ['S', 12]]), 2, cfg)).toBe(false);
    });

    it('S-66+44 IS a tractor (only 5 between, 5≠level=2... wait 5≠2)', () => {
      // Actually with level=2, 66(6) and 44(4): between is 5, 5≠level → NOT consecutive
      expect(hasTractor(pairs([['S', 6], ['S', 4]]), 2, cfg)).toBe(false);
    });
  });
});

// ================================================================
// Case 2: Level=A(14), trump=Spades (黑桃主)
// ================================================================
describe('level=A(14), trump=Spades', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 14 };

  describe('same-suit: level card breaks chain', () => {
    it('S-AA+KK is NOT a tractor (A=level, different suit groups)', () => {
      const cards = pairs([['S', 14], ['S', 13]]);
      expect(hasTractor(cards, 2, cfg)).toBe(false);
    });

    it('S-KK+QQ IS a tractor (both non-level, consecutive)', () => {
      expect(hasTractor(pairs([['S', 13], ['S', 12]]), 2, cfg)).toBe(true);
    });

    it('S-KK+QQ+JJ IS a 3-pair tractor (non-level, consecutive)', () => {
      expect(hasTractor(pairs([['S', 13], ['S', 12], ['S', 11]]), 3, cfg)).toBe(true);
    });

    it('S-JJ+1010+99 IS a 3-pair tractor (non-level, consecutive)', () => {
      expect(hasTractor(pairs([['S', 11], ['S', 10], ['S', 9]]), 3, cfg)).toBe(true);
    });
  });

  describe('cross-group tractors (tA is also tLev)', () => {
    it('BJ+SJ → 2-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15]]), 2, cfg)).toBe(true);
    });

    it('SJ+SA → 2-pair tractor (SJ + tLev)', () => {
      expect(hasTractor(pairs([['J', 15], ['S', 14]]), 2, cfg)).toBe(true);
    });

    it('SA+HA → 2-pair tractor (tLev + offLev)', () => {
      expect(hasTractor(pairs([['S', 14], ['H', 14]]), 2, cfg)).toBe(true);
    });

    it('BJ+SJ+SA → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15], ['S', 14]]), 3, cfg)).toBe(true);
    });

    it('SJ+SA+HA → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 15], ['S', 14], ['H', 14]]), 3, cfg)).toBe(true);
    });

    it('SA+HA+SA duplicate is NOT a tractor', () => {
      const dup = [c('S', 14, 10), c('S', 14, 11), c('H', 14, 0), c('H', 14, 1),
                   c('S', 14, 12), c('S', 14, 13)];
      expect(hasTractor(dup, 3, cfg)).toBe(false);
    });

    it('SA+HA IS a tractor (tLev + offLev)', () => {
      expect(hasTractor(pairs([['S', 14], ['H', 14]]), 2, cfg)).toBe(true);
    });

    it('SA+DA IS a tractor (tLev + offLev, any off-suit)', () => {
      expect(hasTractor(pairs([['S', 14], ['D', 14]]), 2, cfg)).toBe(true);
    });

    it('SA+CA IS a tractor (tLev + offLev, any off-suit)', () => {
      expect(hasTractor(pairs([['S', 14], ['C', 14]]), 2, cfg)).toBe(true);
    });

    it('HA+DA is NOT a tractor (two offLev without tLev)', () => {
      expect(hasTractor(pairs([['H', 14], ['D', 14]]), 2, cfg)).toBe(false);
    });

    it('HA+CA is NOT a tractor (two offLev without tLev)', () => {
      expect(hasTractor(pairs([['H', 14], ['C', 14]]), 2, cfg)).toBe(false);
    });

    it('DA+CA is NOT a tractor (two offLev without tLev)', () => {
      expect(hasTractor(pairs([['D', 14], ['C', 14]]), 2, cfg)).toBe(false);
    });

    it('SA+HA+DA is NOT a tractor (only one offLev can chain with tLev)', () => {
      expect(hasTractor(pairs([['S', 14], ['H', 14], ['D', 14]]), 3, cfg)).toBe(false);
    });

    it('SA+DA+CA is NOT a tractor (only one offLev can chain with tLev)', () => {
      expect(hasTractor(pairs([['S', 14], ['D', 14], ['C', 14]]), 3, cfg)).toBe(false);
    });

    it('HA+DA+CA is NOT a tractor (three offLev without tLev)', () => {
      expect(hasTractor(pairs([['H', 14], ['D', 14], ['C', 14]]), 3, cfg)).toBe(false);
    });
  });

  describe('non-trump same-suit', () => {
    it('H-AA+KK is NOT a tractor (HA is off-suit level=trump, HK is non-trump)', () => {
      // H-A(14) is a level card → trump. H-K(13) is non-trump. Different suit groups.
      expect(hasTractor(pairs([['H', 14], ['H', 13]]), 2, cfg)).toBe(false);
    });

    it('H-KK+QQ IS a tractor (both non-level, consecutive in non-trump space)', () => {
      expect(hasTractor(pairs([['H', 13], ['H', 12]]), 2, cfg)).toBe(true);
    });
  });
});

// ================================================================
// Case 3: Level=10, trump=Clubs (草花主)
// ================================================================
describe('level=10, trump=Clubs', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Clubs, level: 10 };

  describe('same-suit: level card breaks chain', () => {
    it('C-1010+99 is NOT a tractor (level + non-level)', () => {
      expect(hasTractor(pairs([['C', 10], ['C', 9]]), 2, cfg)).toBe(false);
    });

    it('C-JJ+QQ IS a tractor (both non-level trump, consecutive)', () => {
      expect(hasTractor(pairs([['C', 11], ['C', 12]]), 2, cfg)).toBe(true);
    });

    it('C-99+88 IS a tractor (only 10 between, 10=level → skip)', () => {
      expect(hasTractor(pairs([['C', 9], ['C', 8]]), 2, cfg)).toBe(true);
    });

    it('C-JJ+99 IS a tractor (only 10 between, 10=level → skip)', () => {
      expect(hasTractor(pairs([['C', 11], ['C', 9]]), 2, cfg)).toBe(true);
    });
  });

  describe('cross-group tractors', () => {
    it('BJ+SJ → 2-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15]]), 2, cfg)).toBe(true);
    });

    it('SJ+C10 → 2-pair tractor', () => {
      expect(hasTractor(pairs([['J', 15], ['C', 10]]), 2, cfg)).toBe(true);
    });

    it('C10+S10 → 2-pair tractor (tLev + offLev)', () => {
      expect(hasTractor(pairs([['C', 10], ['S', 10]]), 2, cfg)).toBe(true);
    });

    it('S10+CA → 2-pair tractor (offLev + tA)', () => {
      expect(hasTractor(pairs([['S', 10], ['C', 14]]), 2, cfg)).toBe(true);
    });

    it('BJ+SJ+C10 → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15], ['C', 10]]), 3, cfg)).toBe(true);
    });

    it('SJ+C10+S10 → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 15], ['C', 10], ['S', 10]]), 3, cfg)).toBe(true);
    });

    it('C10+S10+CA → 3-pair tractor', () => {
      expect(hasTractor(pairs([['C', 10], ['S', 10], ['C', 14]]), 3, cfg)).toBe(true);
    });
  });
});

// ================================================================
// Case 4: Level=K(13), NT (无主)
// ================================================================
describe('level=K(13), NT', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 13 };

  describe('same-suit: level K is trump, breaks non-trump chains', () => {
    it('S-KK+QQ is NOT a tractor (K=level=trump, Q=non-trump)', () => {
      expect(hasTractor(pairs([['S', 13], ['S', 12]]), 2, cfg)).toBe(false);
    });

    it('S-KK+AA is NOT a tractor (different suit groups)', () => {
      expect(hasTractor(pairs([['S', 13], ['S', 14]]), 2, cfg)).toBe(false);
    });

    it('S-AA+QQ IS a tractor (only K between, K=level → skip)', () => {
      expect(hasTractor(pairs([['S', 14], ['S', 12]]), 2, cfg)).toBe(true);
    });

    it('S-AA+JJ is NOT a tractor (Q between, Q≠level)', () => {
      expect(hasTractor(pairs([['S', 14], ['S', 11]]), 2, cfg)).toBe(false);
    });

    it('S-JJ+1010 IS a tractor (consecutive, no level between)', () => {
      expect(hasTractor(pairs([['S', 11], ['S', 10]]), 2, cfg)).toBe(true);
    });
  });

  describe('cross-group tractors (NT)', () => {
    it('BJ+SJ → 2-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15]]), 2, cfg)).toBe(true);
    });

    it('SJ+SK → 2-pair tractor (SJ + level card)', () => {
      expect(hasTractor(pairs([['J', 15], ['S', 13]]), 2, cfg)).toBe(true);
    });

    it('SJ+HK → 2-pair tractor (SJ + level card, any suit)', () => {
      expect(hasTractor(pairs([['J', 15], ['H', 13]]), 2, cfg)).toBe(true);
    });

    it('BJ+SJ+SK → 3-pair tractor', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15], ['S', 13]]), 3, cfg)).toBe(true);
    });

    it('BJ+SJ+HK → 3-pair tractor (level card from any suit)', () => {
      expect(hasTractor(pairs([['J', 16], ['J', 15], ['H', 13]]), 3, cfg)).toBe(true);
    });

    it('SK+HK is NOT a tractor (two Ks from different suits, not same-suit or cross-group)', () => {
      expect(hasTractor(pairs([['S', 13], ['H', 13]]), 2, cfg)).toBe(false);
    });
  });
});
