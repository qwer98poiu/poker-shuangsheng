import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import { cardGreater, compareTwo, determineWinner } from '../comparing/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

const trump2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const trumpA: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 14 };

function ct(suit: string, rank: number, idx: number): Card {
  return createCard(suit as any, rank as any, idx);
}

describe('cardGreater', () => {
  it('trump beats non-trump', () => expect(cardGreater(ct('S', 3, 0), ct('H', 14, 1), trump2)).toBe(true));
  it('non-trump does not beat trump', () => expect(cardGreater(ct('H', 14, 0), ct('S', 3, 1), trump2)).toBe(false));
  it('higher same-group wins', () => expect(cardGreater(ct('H', 14, 0), ct('H', 13, 1), trump2)).toBe(true));
  it('equal → false (先出为大)', () => expect(cardGreater(ct('H', 10, 0), ct('H', 10, 1), trump2)).toBe(false));
});

describe('compareTwo — single/pair', () => {
  it('higher single wins', () => {
    expect(compareTwo([ct('S', 4, 0)], [ct('S', 5, 1)], [ct('S', 4, 0)], trump2)).toBe('second');
  });
  it('equal single → first', () => {
    expect(compareTwo([ct('S', 4, 0)], [ct('S', 4, 1)], [ct('S', 4, 0)], trump2)).toBe('first');
  });
  it('higher pair wins', () => {
    const l = [ct('H', 5, 0), ct('H', 5, 1)];
    expect(compareTwo(l, [ct('H', 6, 2), ct('H', 6, 3)], l, trump2)).toBe('second');
  });
  it('trump pair beats off-suit pair', () => {
    const l = [ct('H', 4, 0), ct('H', 4, 1)];
    expect(compareTwo([ct('H', 10, 2), ct('H', 10, 3)], [ct('S', 3, 4), ct('S', 3, 5)], l, trump2)).toBe('second');
  });
});

describe('determineWinner — basic', () => {
  it('P0 leads off-suit, P2 trumps', () => {
    const ps = [[ct('H', 5, 0)], [ct('H', 14, 1)], [ct('S', 2, 2)], [ct('H', 3, 3)]];
    expect(determineWinner(ps, 0, trump2).winnerIndex).toBe(2);
  });
  it('P0 leads pair, P1 follows bigger', () => {
    const ps = [
      [ct('H', 5, 0), ct('H', 5, 1)], [ct('H', 7, 2), ct('H', 7, 3)],
      [ct('D', 3, 4), ct('D', 4, 5)], [ct('D', 5, 6), ct('D', 6, 7)],
    ];
    expect(determineWinner(ps, 0, trump2).winnerIndex).toBe(1);
  });

  it('follow suit beats discard: ♦Q follows, ♥K discards → ♦Q wins', () => {
    // Lead: ♦8 (diamonds, non-trump). ♦Q follows suit, ♥K discards heart.
    // Even though ♥K has higher rank, following the lead suit wins.
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
    const ps = [
      [ct('D', 8, 0)],      // lead: ♦8
      [ct('D', 12, 0)],     // follow: ♦Q (follows suit)
      [ct('H', 13, 0)],     // discard: ♥K (different suit)
      [ct('D', 3, 0)],      // follow: ♦3
    ];
    // ♦Q should win — following suit > discarding
    const r = compareTwo(ps[0], ps[1], ps[0], cfg);
    expect(r).toBe('second'); // second = P1 (♦Q) beats P0 (♦8)
    const winner = determineWinner(ps, 0, cfg).winnerIndex;
    expect(winner).not.toBe(2); // P2 with ♥K should NOT win
  });
});

describe('throw — complex over-trump (level=A)', () => {
  /**
   * Level=A(14) trump=♠. No rank interference from level cards.
   * Lead: ♥ throw with two 2-pair tractors + 2 singles (10 cards).
   * A: ♠8899(2p) + ♠2233(2p) + 2 singles.
   * B: ♠1010JJ(2p) + ♠445566(3p).
   *
   * Lead longest tractor = 2p.
   * A's max in tractors ≥2p = max(8,9 + 2,3) = 9.
   * B's max in tractors ≥2p = max(10,11 + 4,5,6) = J(11).
   * 11 > 9 → B over-trumps.
   */
  it('B over-trumps A with higher max', () => {
    const a = [
      ct('S', 8, 0), ct('S', 8, 1), ct('S', 9, 2), ct('S', 9, 3),
      ct('S', 2, 4), ct('S', 2, 5), ct('S', 3, 6), ct('S', 3, 7),
      ct('S', 4, 40), ct('S', 5, 41),
    ];
    const b = [
      ct('S', 10, 8), ct('S', 10, 9), ct('S', 11, 10), ct('S', 11, 11),
      ct('S', 4, 12), ct('S', 4, 13), ct('S', 5, 14), ct('S', 5, 15),
      ct('S', 6, 16), ct('S', 6, 17),
    ];
    const lead = [
      ct('H', 10, 20), ct('H', 10, 21), ct('H', 9, 22), ct('H', 9, 23),
      ct('H', 4, 24), ct('H', 4, 25), ct('H', 3, 26), ct('H', 3, 27),
      ct('H', 5, 28), ct('H', 6, 29),
    ];
    expect(compareTwo(a, b, lead, trumpA)).toBe('second');
  });

  it('B wins full trick', () => {
    const lead = [
      ct('H', 10, 20), ct('H', 10, 21), ct('H', 9, 22), ct('H', 9, 23),
      ct('H', 4, 24), ct('H', 4, 25), ct('H', 3, 26), ct('H', 3, 27),
      ct('H', 5, 28), ct('H', 6, 29),
    ];
    const plays = [
      lead,
      [ct('H', 7, 30), ct('H', 8, 31), ct('C', 2, 32), ct('C', 3, 33),
       ct('C', 4, 34), ct('C', 5, 35), ct('C', 6, 36), ct('C', 7, 37),
       ct('C', 8, 38), ct('C', 9, 39)],
      [ct('S', 8, 0), ct('S', 8, 1), ct('S', 9, 2), ct('S', 9, 3),
       ct('S', 2, 4), ct('S', 2, 5), ct('S', 3, 6), ct('S', 3, 7),
       ct('S', 4, 40), ct('S', 5, 41)],
      [ct('S', 10, 8), ct('S', 10, 9), ct('S', 11, 10), ct('S', 11, 11),
       ct('S', 4, 12), ct('S', 4, 13), ct('S', 5, 14), ct('S', 5, 15),
       ct('S', 6, 16), ct('S', 6, 17)],
    ];
    expect(determineWinner(plays, 0, trumpA).winnerIndex).toBe(3);
  });
});
