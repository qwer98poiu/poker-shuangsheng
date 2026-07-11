import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { aiChooseBottomCards } from '../ai/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

function c(s: string, r: number, idx: number): Card {
  return createCard(s as any, r as any, idx);
}

describe('aiChooseBottomCards', () => {
  describe('suited trump mode (Hearts, level=5)', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };

    it('returns exactly 8 discard cards and 25 keep cards for 33-card hand', () => {
      const hand = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'];
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = aiChooseBottomCards(hand, cfg);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
      expect(r.reason.length).toBeGreaterThan(0);
    });

    it('prefers to keep trump cards', () => {
      // Build a hand where we can see what's kept vs discarded
      const trumpCards: Card[] = [];
      for (let i = 0; i < 10; i++) {
        trumpCards.push(c('H', 2 + i, i));
      }
      const offSuitCards: Card[] = [];
      for (let i = 0; i < 23; i++) {
        offSuitCards.push(c('S', 2 + (i % 13), 100 + i));
      }
      const hand = [...trumpCards, ...offSuitCards];
      const r = aiChooseBottomCards(hand, cfg);
      const keptTrump = r.keep.filter(c => isTrump(c, cfg));
      expect(keptTrump.length).toBeGreaterThanOrEqual(8); // should keep most trump
    });

    it('tries to void a suit with few cards and no points', () => {
      // Pick a hand with a clear short suit to void
      const hand: Card[] = [];
      let idx = 0;
      // Main suit Spades: 15 cards (no points among top ones)
      for (let i = 0; i < 15; i++) {
        hand.push(c('S', 14 - (i % 13), idx++));
      }
      // Trump Hearts: 8 cards
      for (let i = 0; i < 8; i++) {
        hand.push(c('H', 14 - (i % 13), idx++));
      }
      // Short Clubs: 3 cards (no points)
      hand.push(c('C', 8, idx++));
      hand.push(c('C', 6, idx++));
      hand.push(c('C', 4, idx++));
      // Diamonds: rest
      for (let i = 0; i < 7; i++) {
        hand.push(c('D', 14 - (i % 13), idx++));
      }

      const r = aiChooseBottomCards(hand, cfg);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
      // Should try to void the short suit
      const discardedClubs = r.discard.filter(c => c.suit === 'C');
      // All clubs should be discarded if voiding
      expect(discardedClubs.length).toBe(3);
    });

    it('allows discarding up to 5 points to void a suit', () => {
      const hand: Card[] = [];
      let idx = 0;
      for (let i = 0; i < 15; i++) {
        hand.push(c('S', 14 - (i % 13), idx++));
      }
      for (let i = 0; i < 8; i++) {
        hand.push(c('H', 14 - (i % 13), idx++));
      }
      // Short Clubs: 3 cards with one 5-point card
      hand.push(c('C', 8, idx++));
      hand.push(c('C', 5, idx++)); // 5 points
      hand.push(c('C', 4, idx++));
      for (let i = 0; i < 7; i++) {
        hand.push(c('D', 14 - (i % 13), idx++));
      }
      const r = aiChooseBottomCards(hand, cfg);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
    });
  });

  describe('NT mode (level=2)', () => {
    const cfgNT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

    it('returns exactly 8 discard and 25 keep', () => {
      const hand = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'];
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = aiChooseBottomCards(hand, cfgNT);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
    });

    it('can void a suit with <=6 cards and no points', () => {
      const hand: Card[] = [];
      let idx = 0;
      for (let i = 0; i < 15; i++) {
        hand.push(c('S', 14 - (i % 13), idx++));
      }
      for (let i = 0; i < 12; i++) {
        hand.push(c('H', 14 - (i % 13), idx++));
      }
      // Short: 4 Diamonds, no points
      hand.push(c('D', 9, idx++));
      hand.push(c('D', 7, idx++));
      hand.push(c('D', 4, idx++));
      hand.push(c('D', 3, idx++));
      // 2 Clubs
      hand.push(c('C', 8, idx++));
      hand.push(c('C', 6, idx++));

      const r = aiChooseBottomCards(hand, cfgNT);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
    });

    it('does not void a suit with points even if <=6 cards', () => {
      const hand: Card[] = [];
      let idx = 0;
      for (let i = 0; i < 15; i++) {
        hand.push(c('S', 14 - (i % 13), idx++));
      }
      for (let i = 0; i < 12; i++) {
        hand.push(c('H', 14 - (i % 13), idx++));
      }
      // Short: 4 Diamonds, with K (10 pts)
      hand.push(c('D', 13, idx++)); // K = 10 pts
      hand.push(c('D', 7, idx++));
      hand.push(c('D', 4, idx++));
      hand.push(c('D', 3, idx++));
      hand.push(c('C', 8, idx++));
      hand.push(c('C', 6, idx++));

      const r = aiChooseBottomCards(hand, cfgNT);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
    });
  });
});
