import { describe, it, expect } from 'vitest';
import { Suit, Rank, SpecialSuit } from '../types.js';
import { createCard } from '../model.js';
import { computeNTTrumpState, canFormJokerPair, opponentsHaveTrump,
  canPlayerBeatSingle, canPlayerBeatPair, canAnyOpponentBeatSingle, canAnyOpponentBeatPair,
} from '../ai/nt-tracking.js';
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

/** Mock trick with specific lead pattern (for pair/tractor tests). */
function mockTrickWithPattern(
  plays: [Card[], Card[], Card[], Card[]],
  leadPlayerIndex: number,
  winnerIndex: number,
  leadType: string = 'single',
  leadPairCount: number = 0,
  leadHasTractor: boolean = false,
): Trick {
  return {
    plays: plays.map((cards, i) => ({
      cards,
      pattern: i === 0
        ? { type: leadType, cards, length: cards.length, pairCount: leadPairCount, tractors: leadHasTractor ? [{ pairCount: leadPairCount }] : [], hasTractor: leadHasTractor }
        : { type: 'single', cards, length: cards.length, pairCount: 0, tractors: [], hasTractor: false },
      leadSuit: null,
    })) as Trick['plays'],
    leadPlayerIndex,
    winnerIndex,
    points: 0,
  };
}

/** Default params for non-declarer with no bottom. */
const NO_BOTTOM = { isDeclarer: false, bottomCards: [] as Card[] };
const DECLARER_NO_BOTTOM = { isDeclarer: true, bottomCards: [] as Card[] };

function call(
  hand: Card[], myIndex: number, tricks: Trick[], reveals: Reveal[],
  cfg: TrumpDeclaration, isDeclarer: boolean = false, bottom: Card[] = [],
) {
  return computeNTTrumpState(hand, myIndex, tricks, reveals, cfg, isDeclarer, bottom);
}

describe('NT trump tracking', () => {
  const cfg2 = ntCfg(2);
  const cfg5 = ntCfg(5);

  describe('initial state - no cards played', () => {
    it('non-declarer: all 12 trumps in possible lists for 3 players + bottom', () => {
      const s = call([], 0, [], [], cfg2, false, []);
      expect(s.totalTrumps).toBe(12);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.remainingSmallJokers).toBe(2);
      // Minimum opponent count is 0 (could all be on our side or bottom)
      expect(s.opponentTrumpCount).toBe(0);
      // Self is null (known hand)
      expect(s.possibleTrumps[0]).toBeNull();
      // Other 3 players have possible trumps
      expect(s.possibleTrumps[1]!.length).toBe(12);
      expect(s.possibleTrumps[2]!.length).toBe(12);
      expect(s.possibleTrumps[3]!.length).toBe(12);
      // Bottom also has possible trumps (non-declarer)
      expect(s.possibleTrumps[4]!.length).toBe(12);
      expect(s.isFullyDetermined).toBe(false);
      // All players can form pairs
      expect(s.canFormPair[1]).toBe(true);
      // All players can have jokers
      expect(s.canHaveJoker[1]).toBe(true);
      expect(s.canHaveBigJoker[1]).toBe(true);
      expect(s.canHaveSmallJoker[1]).toBe(true);
    });

    it('declarer: bottom excluded from possible, no bottom tracking', () => {
      const s = call([], 0, [], [], cfg2, true, []);
      expect(s.totalTrumps).toBe(12);
      // Self null, bottom null for declarer
      expect(s.possibleTrumps[0]).toBeNull();
      expect(s.possibleTrumps[4]).toBeNull();
      // Other 3 players have possible trumps
      expect(s.possibleTrumps[1]!.length).toBe(12);
      expect(s.possibleTrumps[2]!.length).toBe(12);
      expect(s.possibleTrumps[3]!.length).toBe(12);
    });

    it('my trump cards not in possible lists', () => {
      const hand = [
        c('J', Rank.BigJoker, 0),
        c('J', Rank.SmallJoker, 0),
        c('S', 2, 0),
        c('H', 2, 0),
      ];
      const s = call(hand, 0, [], [], cfg2, false, []);
      expect(s.remainingBigJokers).toBe(1);
      expect(s.remainingSmallJokers).toBe(1);
      // My trumps are known in my hand
      expect(s.knownTrumpsPerPlayer[0].length).toBe(4);
      // 12 - 4 = 8 unseen
      expect(s.possibleTrumps[1]!.length).toBe(8);
      // Opponents definitely have 0 (minimum)
      expect(s.opponentTrumpCount).toBe(0);
      // Max trump counts: opponents could have 8
      expect(s.maxTrumpCounts[1]).toBe(8); // opponent
      expect(s.maxTrumpCounts[2]).toBe(8); // teammate
      expect(s.maxTrumpCounts[3]).toBe(8); // opponent
    });

    it('declarer: bottom trump cards excluded from tracking', () => {
      const hand: Card[] = [];
      const bottom = [c('J', Rank.BigJoker, 0), c('J', Rank.SmallJoker, 0)];
      const s = call(hand, 0, [], [], cfg2, true, bottom);
      expect(s.remainingBigJokers).toBe(1); // one BJ in bottom
      expect(s.remainingSmallJokers).toBe(1);
      // 10 unseen trumps
      expect(s.possibleTrumps[1]!.length).toBe(10);
      // Bottom is null for declarer (not tracked)
      expect(s.possibleTrumps[4]).toBeNull();
    });
  });

  describe('played trumps tracking', () => {
    it('played trump removed from all possible lists', () => {
      const hand: Card[] = [c('S', 2, 0)];
      const trick = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],
          [c('J', Rank.SmallJoker, 0)],
          [c('D', 2, 0)],
          [c('H', 2, 0)],
        ],
        0, 0,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      // Played: BJ0, SJ0, D2-0, H2-0. My hand: S2-0 = 5 accounted.
      expect(s.remainingBigJokers).toBe(1);
      expect(s.remainingSmallJokers).toBe(1);
      // 12 - 5 = 7 unseen. Bottom saw all 7.
      expect(s.possibleTrumps[4]!.length).toBe(7);
    });

    it('player discarding against trump lead -> cleared from all possible', () => {
      const hand = [c('S', 2, 0)];
      // P0 leads trump (BJ), P1 plays off-suit (no trump)
      const trick = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],    // P0 leads trump
          [c('S', 3, 0)],                  // P1 discards (off-suit)
          [c('J', Rank.SmallJoker, 0)],   // P2 follows trump
          [c('H', 2, 0)],                  // P3 follows trump
        ],
        0, 0,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      // P1 discarded -> cleared from all possible
      expect(s.maxTrumpCounts[1]).toBe(0);
      expect(s.playersWithNoTrump.has(1)).toBe(true);
    });

    it('pair deduction: player follows trump pair with single -> cannot form pairs', () => {
      const hand: Card[] = [];
      // P0 leads a trump pair (S-2 pair), P1 follows with single trump (not a pair)
      const trick = mockTrickWithPattern(
        [
          [c('S', 2, 0), c('S', 2, 1)],   // P0 leads S-2 pair (same suit!)
          [c('D', 2, 0)],                    // P1 plays single trump (no pair!)
          [c('C', 2, 0), c('C', 2, 1)],   // P2 follows with C-2 pair
          [c('J', Rank.SmallJoker, 0)],   // P3 follows single
        ],
        0, 0, 'pair', 1, false,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      // P1 didn't follow with a pair -> can't form pairs
      expect(s.canFormPair[1]).toBe(false);
    });

    it('bottom not affected by pair deduction', () => {
      const hand: Card[] = [];
      const trick = mockTrickWithPattern(
        [
          [c('S', 2, 0), c('S', 2, 1)],   // P0 leads S-2 pair
          [c('D', 2, 0)],                    // P1 plays single (no pair)
          [c('C', 2, 0), c('C', 2, 1)],   // P2 follows pair
          [c('J', Rank.SmallJoker, 0)],   // P3 follows single
        ],
        0, 0, 'pair', 1, false,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      // Bottom can still have pairs (index 4)
      expect(s.possibleTrumps[4]).not.toBeNull();
    });
  });

  describe('full determination', () => {
    it('all 12 trumps accounted for -> isFullyDetermined', () => {
      const hand = [c('S', 2, 0)];
      // All other 11 trumps played across 3 tricks
      const t1 = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],
          [c('J', Rank.BigJoker, 1)],
          [c('J', Rank.SmallJoker, 0)],
          [c('J', Rank.SmallJoker, 1)],
        ], 0, 0,
      );
      const t2 = mockTrick(
        [
          [c('S', 2, 1)],
          [c('H', 2, 0)],
          [c('H', 2, 1)],
          [c('C', 2, 0)],
        ], 0, 0,
      );
      const t3 = mockTrick(
        [
          [c('C', 2, 1)],
          [c('D', 2, 0)],
          [c('D', 2, 1)],
          [c('S', 3, 0)], // non-trump
        ], 0, 0,
      );
      const s = call(hand, 0, [t1, t2, t3], [], cfg2, false, []);
      expect(s.isFullyDetermined).toBe(true);
      // I have 1 trump in hand (S2-0), so I do have trump
      expect(s.maxTrumpCounts[0]).toBe(1);
      expect(s.playersWithNoTrump.has(0)).toBe(false);
    });

    it('isFullyDetermined = false when cards still ambiguous', () => {
      const hand: Card[] = [];
      // Only 4 played
      const t1 = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],
          [c('J', Rank.SmallJoker, 0)],
          [c('D', 2, 0)],
          [c('H', 2, 0)],
        ], 0, 0,
      );
      const s = call(hand, 0, [t1], [], cfg2, false, []);
      expect(s.isFullyDetermined).toBe(false);
    });
  });

  describe('joker tracking', () => {
    it('canHaveJoker reflects possible joker location', () => {
      const hand = [
        c('J', Rank.BigJoker, 0),
        c('J', Rank.BigJoker, 1),
      ];
      const s = call(hand, 0, [], [], cfg2, false, []);
      // Only SJs unseen -> no player can have BJ (both in my hand)
      expect(s.canHaveBigJoker[1]).toBe(false);
      expect(s.canHaveBigJoker[2]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(false);
      // SJs are still unseen
      expect(s.canHaveSmallJoker[1]).toBe(true);
      expect(s.remainingSmallJokers).toBe(2);
      expect(s.remainingBigJokers).toBe(0);
    });

    it('canFormJokerPair when player has 2 possible jokers of same rank', () => {
      const hand: Card[] = [];
      const s = call(hand, 0, [], [], cfg2, false, []);
      // All 4 jokers unseen -> each player could form a joker pair
      expect(canFormJokerPair(1, s)).toBe(true);
    });

    it('all unseen jokers on our side when we have all 4', () => {
      const hand = [
        c('J', Rank.BigJoker, 0),
        c('J', Rank.BigJoker, 1),
        c('J', Rank.SmallJoker, 0),
        c('J', Rank.SmallJoker, 1),
      ];
      const s = call(hand, 0, [], [], cfg2, false, []);
      expect(s.allUnseenJokersOnOurSide).toBe(true);
      expect(s.allUnseenBigJokersOnOurSide).toBe(true);
      expect(s.remainingBigJokers).toBe(0);
      expect(s.remainingSmallJokers).toBe(0);
    });

    it('all unseen jokers not on our side when we have none', () => {
      const hand: Card[] = [c('S', 2, 0)];
      const s = call(hand, 0, [], [], cfg2, false, []);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.remainingSmallJokers).toBe(2);
      expect(s.allUnseenJokersOnOurSide).toBe(false);
    });
  });

  describe('inference helpers', () => {
    it('opponentsHaveTrump returns true when unseen trumps exist', () => {
      const hand: Card[] = [];
      const s = call(hand, 0, [], [], cfg2, false, []);
      expect(opponentsHaveTrump(s, 0)).toBe(true);
    });

    it('opponentsHaveTrump returns false when opponents have no trumps', () => {
      const hand: Card[] = [];
      // All 12 trumps are played except my hand and teammate — but we can't
      // easily make opponents have no trump without the engine. Test with
      // the known opponent having max 0.
      // Simulate: play tricks where opponents are void
      const t1 = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],     // P0 trump
          [c('S', 3, 0)],                 // P1 void (discards)
          [c('D', 2, 0)],                  // P2 trump
          [c('S', 4, 0)],                  // P3 void (discards)
        ], 0, 0,
      );
      // P1 and P3 discarded -> void
      const s = call(hand, 0, [t1], [], cfg2, false, []);
      expect(s.maxTrumpCounts[1]).toBe(0);
      expect(s.maxTrumpCounts[3]).toBe(0);
      // Opponents (P1, P3) are void
      expect(opponentsHaveTrump(s, 0)).toBe(false);
    });

    it('canPlayerBeatSingle detects when player can beat a card', () => {
      const hand = [c('S', 2, 0)]; // I have a level card
      const cfg = cfg2;
      const s = call(hand, 0, [], [], cfg, false, []);
      // Level card (S2, rank 800) can be beaten by any joker (SJ=900, BJ=1000)
      // P1 could have jokers -> can beat
      expect(canPlayerBeatSingle(1, c('S', 2, 1), s, cfg)).toBe(true);
    });

    it('canPlayerBeatPair detects when player can beat a pair', () => {
      const hand: Card[] = [];
      const cfg = cfg2;
      const s = call(hand, 0, [], [], cfg, false, []);
      // P1 can form pairs (all 12 unseen)
      expect(s.canFormPair[1]).toBe(true);
      // A level pair (S2) can be beaten by SJ pair or BJ pair
      // P1 could have jokers
      expect(canPlayerBeatPair(1, [c('S', 2, 0), c('S', 2, 1)], s, cfg)).toBe(true);
    });

    it('canAnyOpponentBeatSingle with unbeatable big joker', () => {
      // I have all 4 jokers -> no opponent can beat a BJ
      const hand = [
        c('J', Rank.BigJoker, 0), c('J', Rank.BigJoker, 1),
        c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1),
      ];
      const cfg = cfg2;
      const s = call(hand, 0, [], [], cfg, false, []);
      const myCard = c('J', Rank.BigJoker, 0); // BJ, unbeatable
      expect(canAnyOpponentBeatSingle(myCard, s, 0, cfg)).toBe(false);
    });
  });

  describe('reveal info', () => {
    it('accepts reveal records (not yet used for deduction)', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: null, strength: 3 },
      ];
      const hand: Card[] = [c('S', 2, 0)];
      const s = call(hand, 0, [], reveals, cfg5, false, []);
      expect(s.totalTrumps).toBe(12);
    });
  });

  describe('level card identity', () => {
    it('tracks level=5 trumps correctly', () => {
      const hand = [c('S', 5, 0), c('H', 5, 0)];
      const s = call(hand, 0, [], [], cfg5, false, []);
      expect(s.totalTrumps).toBe(12);
      expect(s.opponentTrumpCount).toBe(0);
    });

    it('tracks level=14 (Ace) trumps correctly', () => {
      const cfg14 = ntCfg(14);
      const hand = [c('S', 14, 0), c('H', 14, 0)];
      const s = call(hand, 0, [], [], cfg14, false, []);
      expect(s.totalTrumps).toBe(12);
      expect(s.opponentTrumpCount).toBe(0);
    });
  });

  describe('consecutive deductions', () => {
    it('consecutive pair deductions do not double-count', () => {
      const hand: Card[] = [];
      // P1 fails to follow pair twice
      const t1 = mockTrickWithPattern(
        [
          [c('S', 2, 0), c('S', 2, 1)],   // P0 leads S-2 pair
          [c('D', 2, 0)],                    // P1 plays single
          [c('C', 2, 0), c('C', 2, 1)],   // P2 follows C-2 pair
          [c('J', Rank.SmallJoker, 0)],   // P3 follows single
        ], 0, 0, 'pair', 1, false,
      );
      const t2 = mockTrickWithPattern(
        [
          [c('H', 2, 0), c('H', 2, 1)],   // P0 leads H-2 pair
          [c('C', 2, 1)],                    // P1 plays single again (C2-1 only, C2-0 already played)
          [c('J', Rank.SmallJoker, 1)],   // P2 follows single
          [c('J', Rank.BigJoker, 0)],     // P3 follows single
        ], 0, 0, 'pair', 1, false,
      );
      const s = call(hand, 0, [t1, t2], [], cfg2, false, []);
      // P1 still can't form pairs (second deduction was a no-op)
      expect(s.canFormPair[1]).toBe(false);
    });
  });
});
