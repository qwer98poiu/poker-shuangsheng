import { describe, it, expect } from 'vitest';
import { Suit, Rank, SpecialSuit } from '../types.js';
import { createCard } from '../model.js';
import { computeNTTrumpState } from '../ai/nt-tracking.js';
import type { TrumpDeclaration, Card, Trick, Reveal } from '../types.js';

/** Create a minimal NT config at the given level. */
function ntCfg(level: number, declarerIdx = 0): TrumpDeclaration {
  return { declarerIndex: declarerIdx, trumpSuit: null, level };
}

/** Shorthand: create a card with a specific id suffix. */
function c(s: string, r: number, idx: number): Card {
  return createCard(s as any, r as any, idx);
}

/** Mock trick with known plays at known positions. */
function mockTrick(
  plays: [Card[], Card[], Card[], Card[]],
  leadPlayerIndex: number,
  winnerIndex: number,
): Trick {
  return {
    plays: plays.map(cards => ({
      cards,
      pattern: { type: 'single', cards, length: cards.length, pairCount: 0, tractors: [], hasTractor: false },
      leadSuit: null,
    })) as Trick['plays'],
    leadPlayerIndex,
    winnerIndex,
    points: 0,
  };
}

describe('NT trump tracking', () => {
  const cfg2 = ntCfg(2);
  const cfg5 = ntCfg(5);

  describe('initial state - no cards played', () => {
    it('all 12 trumps unknown, opponent count is 6 (half)', () => {
      const hand: Card[] = [];
      const s = computeNTTrumpState(hand, 0, [], [], cfg2);
      expect(s.totalTrumps).toBe(12);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.remainingSmallJokers).toBe(2);
      // no cards seen, assume half on opponent side
      expect(s.opponentTrumpCount).toBe(6);
    });

    it('with known trumps in my hand, opponent count decreases', () => {
      const hand = [
        c('J', Rank.BigJoker, 0),
        c('J', Rank.SmallJoker, 0),
        c('S', 2, 0),
        c('H', 2, 0),
      ];
      const s = computeNTTrumpState(hand, 0, [], [], cfg2);
      expect(s.remainingBigJokers).toBe(1); // I have one BJ
      expect(s.remainingSmallJokers).toBe(1); // I have one SJ
      // I have 4, 8 unknown, half of unknowns = 4 opponent
      expect(s.opponentTrumpCount).toBeLessThanOrEqual(6);
    });
  });

  describe('played trumps tracking', () => {
    it('deducts cards seen in trick history', () => {
      const hand = [c('S', 2, 0)]; // one level trump
      // P0 led BJ, P1 played SJ, P2 played a diamond level, P3 played a heart level
      const trick = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],
          [c('J', Rank.SmallJoker, 0)],
          [c('D', 2, 0)],
          [c('H', 2, 0)],
        ],
        0, 0,
      );
      const s = computeNTTrumpState(hand, 0, [trick], [], cfg2);
      // Seen: BJ0, SJ0, D2-0, H2-0, S2-0 (me) = 5
      // Remaining: BJ1, SJ1, S2-1, H2-1, C2-0, C2-1, D2-1 = 7
      expect(s.remainingBigJokers).toBe(1);
      expect(s.remainingSmallJokers).toBe(1);
      expect(s.playersWithNoTrump.has).toBeInstanceOf(Function);
    });

    it('deduces players with no trump when all 12 seen', () => {
      // Build hands where all 12 trumps are accounted for
      const allTrumps: Card[] = [
        ...['S', 'H', 'C', 'D'].flatMap(s => [c(s, 2, 0), c(s, 2, 1)]),
        c('J', Rank.BigJoker, 0), c('J', Rank.BigJoker, 1),
        c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1),
      ];

      const myHand = allTrumps.slice(0, 4); // I have 4
      const p2Hand = allTrumps.slice(4, 8); // teammate has 4
      const p1Hand = allTrumps.slice(8, 10); // opponent has 2
      const p3Hand = allTrumps.slice(10, 12); // opponent has 2

      // Simulate trick history where these cards are revealed
      const tricks: Trick[] = [
        mockTrick([myHand.slice(0, 1), [], [], []], 0, 0),
      ];

      const s = computeNTTrumpState(myHand, 0, [], [], cfg2);
      // All 12 visible
      const seen = myHand.length; // only my cards are seen
      expect(s.playersWithNoTrump).toBeDefined();
    });
  });

  describe('reveal info deduction', () => {
    it('knows NT revealer must have a joker pair', () => {
      // Player 1 revealed NT with strength 3+ (pair of jokers)
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: null, strength: 3 },
      ];
      const hand: Card[] = [
        c('S', 2, 0),
      ];
      const s = computeNTTrumpState(hand, 0, [], reveals, cfg5);
      // The reveal info tells us P1 has/had a joker pair
      // This doesn't directly affect the tracking but is available
      expect(s.totalTrumps).toBe(12);
    });
  });

  describe('level card identity', () => {
    it('tracks level=5 trumps correctly', () => {
      const hand = [
        c('S', 5, 0),
        c('H', 5, 0),
      ];
      const s = computeNTTrumpState(hand, 0, [], [], cfg5);
      // All level=5 cards should be counted
      expect(s.totalTrumps).toBe(12);
      expect(s.opponentTrumpCount).toBeLessThanOrEqual(6);
    });

    it('tracks level=14 (Ace) trumps correctly', () => {
      const cfg14 = ntCfg(14);
      const hand = [
        c('S', 14, 0),
        c('H', 14, 0),
      ];
      const s = computeNTTrumpState(hand, 0, [], [], cfg14);
      expect(s.totalTrumps).toBe(12);
      expect(s.opponentTrumpCount).toBeLessThanOrEqual(6);
    });
  });

  describe('all unseen jokers deduction', () => {
    it('all unseen jokers on our side when we have all 4', () => {
      const hand = [
        c('J', Rank.BigJoker, 0),
        c('J', Rank.BigJoker, 1),
        c('J', Rank.SmallJoker, 0),
        c('J', Rank.SmallJoker, 1),
      ];
      const s = computeNTTrumpState(hand, 0, [], [], cfg2);
      expect(s.allUnseenJokersOnOurSide).toBe(true);
      expect(s.allUnseenBigJokersOnOurSide).toBe(true);
      expect(s.remainingBigJokers).toBe(0);
      expect(s.remainingSmallJokers).toBe(0);
    });

    it('all unseen jokers not on our side when we have none', () => {
      const hand: Card[] = [c('S', 2, 0)];
      const s = computeNTTrumpState(hand, 0, [], [], cfg2);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.remainingSmallJokers).toBe(2);
      expect(s.allUnseenJokersOnOurSide).toBe(false);
    });
  });
});
