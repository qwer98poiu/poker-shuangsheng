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

  describe('reveal-based deduction', () => {
    it('pair of Small Jokers reveal (NT): both SJs at revealer (declarer)', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: null, strength: 3 },
      ];
      const hand: Card[] = [c('S', 2, 0)];
      // P1 is the last (only) revealer → P1 is declarer
      // From my perspective (P0, non-declarer): SJs at P1 or bottom
      const cfg = ntCfg(2, 1); // declarerIndex = 1
      const s = call(hand, 0, [], reveals, cfg, false, []);
      // No player other than P1 can have SJ
      expect(s.canHaveSmallJoker[2]).toBe(false);
      expect(s.canHaveSmallJoker[3]).toBe(false);
      // P1 has SJs (in hand or bottom)
      expect(s.canHaveSmallJoker[1]).toBe(true);
      // SJs are at {1, 4} → locs.size=2 → counted as remaining (ambiguous)
      expect(s.remainingSmallJokers).toBe(2);
      // Bottom can have SJ
      const bottomPossible = s.possibleTrumps[4]!;
      const bottomHasSJ = bottomPossible.some(id => id.startsWith('J-15'));
      expect(bottomHasSJ).toBe(true);
      // P1 is our opponent → bottom is opponent side → not all on our side
      expect(s.allUnseenJokersOnOurSide).toBe(false);
    });

    it('pair of Big Jokers reveal (NT): both BJs at revealer (teammate declarer)', () => {
      const reveals: Reveal[] = [
        { playerIndex: 2, suit: null, strength: 4 },
      ];
      const hand: Card[] = [];
      // P2 is the last revealer → declarer. P2 is my teammate.
      const cfg = ntCfg(2, 2); // declarerIndex = 2
      const s = call(hand, 0, [], reveals, cfg, false, []);
      // P2 could have BJs in hand or bottom → ambiguous
      expect(s.remainingBigJokers).toBe(2);
      // No opponent can have BJ
      expect(s.canHaveBigJoker[1]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(false);
      // P2 has BJ control (hand or bottom, both our side since P2 is teammate)
      expect(s.canHaveBigJoker[2]).toBe(true);
      // Bottom is teammate's bottom → our side → all unseen BJs on our side
      expect(s.allUnseenBigJokersOnOurSide).toBe(true);
    });

    it('pair of level cards reveal: both copies at revealer', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 2 },
      ];
      const hand: Card[] = [];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      // P1 has both H-2 copies — no other player can have H-2 pair
      expect(s.knownTrumpsPerPlayer[1].length).toBe(2);
      // Other players cannot have H-2 at all
      const h2Ids = [c('H', 2, 0).id, c('H', 2, 1).id];
      for (const id of h2Ids) {
        const inP2 = s.possibleTrumps[2]?.includes(id);
        const inP3 = s.possibleTrumps[3]?.includes(id);
        expect(inP2).toBe(false);
        expect(inP3).toBe(false);
      }
      // Bottom cannot have H-2
      const inBottom = h2Ids.some(id => s.possibleTrumps[4]!.includes(id));
      expect(inBottom).toBe(false);
    });

    it('single level card reveal: one copy at revealer, other still possible', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 1 },
      ];
      const hand: Card[] = [];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      // P1 has at least one H-2
      expect(s.knownTrumpsPerPlayer[1].length).toBe(1);
      // P1's known card is an H-2
      expect(s.knownTrumpsPerPlayer[1][0].suit).toBe('H');
      expect(s.knownTrumpsPerPlayer[1][0].rank).toBe(2);
      // The other H-2 is still possible for P2/P3/bottom
      // (it's not at P1 in possibleTrumps — the revealed copy is in knownTrumpsPerPlayer)
      expect(s.canFormPair[2]).toBe(true);
      expect(s.canFormPair[3]).toBe(true);
    });

    it('counter-reveal: P1 reveals H-2 single, P2 counters with SJ pair', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 1 },
        { playerIndex: 2, suit: null, strength: 3 },
      ];
      const hand: Card[] = [];
      // P2 revealed last → declarer. P2 is my teammate.
      const cfg = ntCfg(2, 2);
      const s = call(hand, 0, [], reveals, cfg, false, []);
      // P1 (not declarer) has one H-2 definitively
      expect(s.knownTrumpsPerPlayer[1].length).toBe(1);
      expect(s.knownTrumpsPerPlayer[1][0].suit).toBe('H');
      // P2 (declarer, teammate) has both SJs (hand or bottom)
      expect(s.remainingSmallJokers).toBe(2);
      // Opponents (P1, P3) cannot have SJ
      expect(s.canHaveSmallJoker[1]).toBe(false);
      expect(s.canHaveSmallJoker[3]).toBe(false);
      // SJs are controlled by P2 (teammate declarer); BJs still ambiguous
      expect(s.canHaveSmallJoker[2]).toBe(true);
      expect(s.allUnseenJokersOnOurSide).toBe(false); // BJs could be at opponents
    });

    it('from P1 perspective: P2 counters with SJ pair, P1 knows P3+P4 cannot have SJ pair', () => {
      // User's example: P1 reveals H-2 single, P2 counters with SJ pair (NT).
      // From P1's perspective: P2 (declarer) has SJs (hand or bottom).
      // P3 and P0 cannot have SJ at all.
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 1 },
        { playerIndex: 2, suit: null, strength: 3 },
      ];
      const cfg = ntCfg(2, 2); // P2 is declarer
      const hand: Card[] = [c('H', 2, 0)]; // P1 has one H-2 in hand
      // Act as P1 (myIndex = 1)
      const s = call(hand, 1, [], reveals, cfg, false, []);
      // P2 (declarer) has SJs: hand or bottom
      expect(s.canHaveSmallJoker[2]).toBe(true);
      // P0 and P3 cannot have SJ (no SJ pair for opponents other than declarer)
      expect(s.canHaveSmallJoker[0]).toBe(false);
      expect(s.canHaveSmallJoker[3]).toBe(false);
      // P0 and P3 could still form BJ pair (canFormJokerPair checks any joker rank)
      // but not SJ pair
      expect(s.canHaveBigJoker[0]).toBe(true); // BJs still possible
      expect(s.canHaveBigJoker[3]).toBe(true);
    });

    it('from P2 perspective: P2 knows P3+P4 have at most 1 H-2 between them', () => {
      // Continuation: P2 countered with NT. P2 knows P1 had one H-2.
      // Other H-2 is at most 1 between P3, P0, and bottom.
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 1 },
        { playerIndex: 2, suit: null, strength: 3 },
      ];
      const cfg = ntCfg(2, 2);
      // P2 has both SJs in hand
      const hand: Card[] = [
        c('J', Rank.SmallJoker, 0),
        c('J', Rank.SmallJoker, 1),
      ];
      const s = call(hand, 2, [], reveals, cfg, false, []);
      // P2 knows P1 has one H-2
      expect(s.knownTrumpsPerPlayer[1].length).toBe(1);
      expect(s.knownTrumpsPerPlayer[1][0].suit).toBe('H');
      // P0 and P3 can have at most 1 H-2 total (only 1 copy remaining)
      // Check: is P0 or P3 known to have H-2? Neither should be definitive.
      const knownP0 = s.knownTrumpsPerPlayer[0];
      const knownP3 = s.knownTrumpsPerPlayer[3];
      expect(knownP0.length + knownP3.length).toBeLessThanOrEqual(1);
    });

    it('revealer is self: cards in hand already excluded, bottom still cleaned', () => {
      const reveals: Reveal[] = [
        { playerIndex: 0, suit: null, strength: 3 }, // I declare NT with SJ pair
      ];
      const hand = [
        c('J', Rank.SmallJoker, 0),
        c('J', Rank.SmallJoker, 1),
        c('S', 2, 0),
      ];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      // Both SJs in my hand
      expect(s.remainingSmallJokers).toBe(0);
      // Bottom cannot have SJ
      const bottomPossible = s.possibleTrumps[4]!;
      const bottomHasSJ = bottomPossible.some(id => id.startsWith('J-15'));
      expect(bottomHasSJ).toBe(false);
    });

    it('self reveals pair of level cards: other copies excluded from bottom', () => {
      const reveals: Reveal[] = [
        { playerIndex: 0, suit: Suit.Spades, strength: 2 },
      ];
      const hand = [
        c('S', 2, 0), c('S', 2, 1),
        c('J', Rank.BigJoker, 0),
      ];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      // Both S-2 in my hand, already tracked
      expect(s.knownTrumpsPerPlayer[0].length).toBe(3);
      // Bottom cannot have S-2
      const bottomPossible = s.possibleTrumps[4]!;
      const bottomHasS2 = bottomPossible.some(id => id.startsWith('S-2'));
      expect(bottomHasS2).toBe(false);
    });

    it('declarer revealed: opponents cannot have revealed cards, bottom may', () => {
      // P1 reveals BJ pair → P1 is declarer. I am P0, not declarer.
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: null, strength: 4 },
      ];
      const cfg = ntCfg(2, 1); // declarerIndex = P1
      const hand: Card[] = [];
      const s = call(hand, 0, [], reveals, cfg, false, []);
      // P1 (declarer) has BJs in hand or bottom → ambiguous count
      expect(s.remainingBigJokers).toBe(2);
      // P2 and P3 cannot have BJ
      expect(s.canHaveBigJoker[2]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(false);
      // P1 is opponent → bottom is opponent's → not all on our side
      expect(s.allUnseenBigJokersOnOurSide).toBe(false);
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

  describe('multi-perspective deduction with full distribution', () => {
    // Scenario: P0 reveals H-2 single, P1 counters with SJ pair → P1 is declarer.
    // Trump distribution (12 total, 1 in bottom):
    //   P0(4 in hand): H-2-0(revealed), H-2-1, BJ-0, C-2-0
    //   P1(4+1): SJ-0, SJ-1, D-2-0, C-2-1 in hand; S-2-0 in bottom (declarer)
    //   P2(1 in hand): D-2-1
    //   P3(2 in hand): S-2-1, BJ-1
    const cfg = ntCfg(2, 1); // P1 is declarer
    const reveals: Reveal[] = [
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 1, suit: null, strength: 3 },
    ];
    const p0Hand = [c('H', 2, 0), c('H', 2, 1), c('J', Rank.BigJoker, 0), c('C', 2, 0)];
    const p1Hand = [c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1), c('D', 2, 0), c('C', 2, 1)];
    const p1Bottom = [c('S', 2, 0)];
    const p2Hand = [c('D', 2, 1)];
    const p3Hand = [c('S', 2, 1), c('J', Rank.BigJoker, 1)];

    // Card ID helpers
    function cid(suit: string, rank: number, idx: number): string {
      return c(suit, rank, idx).id;
    }
    function has(bag: readonly string[] | null | undefined, suit: string, rank: number, idx: number): boolean {
      const id = cid(suit, rank, idx);
      return (bag ?? []).includes(id);
    }

    it('knownTrumpsPerPlayer: my-hand cards always in known, no other player private info', () => {
      const s0 = call(p0Hand, 0, [], reveals, cfg, false, []);
      // P0's hand: {H-2-0, H-2-1, BJ-0, C-2-0}
      expect(s0.knownTrumpsPerPlayer[0].length).toBe(4);
      expect(s0.knownTrumpsPerPlayer[1].length).toBe(0);
      expect(s0.knownTrumpsPerPlayer[2].length).toBe(0);
      expect(s0.knownTrumpsPerPlayer[3].length).toBe(0);

      const s1 = call(p1Hand, 1, [], reveals, cfg, true, p1Bottom);
      // P1's hand: {SJ-0, D-2-0, D-2-1, C-2-1}
      expect(s1.knownTrumpsPerPlayer[1].length).toBe(4);
      // P0 definitive: H-2-0 from reveal (not declarer)
      expect(s1.knownTrumpsPerPlayer[0].length).toBe(1);
      expect(s1.knownTrumpsPerPlayer[0][0].id).toBe(cid('H', 2, 0));
      expect(s1.knownTrumpsPerPlayer[2].length).toBe(0);
      expect(s1.knownTrumpsPerPlayer[3].length).toBe(0);
    });

    it('P0 view: P2/P3 possible list excludes SJs, P1 and bottom include SJs', () => {
      const s = call(p0Hand, 0, [], reveals, cfg, false, []);
      // Self: no possibleTrumps[0]
      expect(s.possibleTrumps[0]).toBeNull();
      // P1 possible: 6 ambiguous + 2 SJs = 8
      expect(s.possibleTrumps[1]!).toHaveLength(8);
      expect(has(s.possibleTrumps[1], 'J', 15, 0)).toBe(true);
      expect(has(s.possibleTrumps[1], 'J', 15, 1)).toBe(true);
      // P2 possible: 6 ambiguous, no SJ
      expect(s.possibleTrumps[2]!).toHaveLength(6);
      expect(has(s.possibleTrumps[2], 'J', 15, 0)).toBe(false);
      expect(has(s.possibleTrumps[2], 'J', 15, 1)).toBe(false);
      // P3 possible: 6 ambiguous, no SJ
      expect(s.possibleTrumps[3]!).toHaveLength(6);
      expect(has(s.possibleTrumps[3], 'J', 15, 0)).toBe(false);
      expect(has(s.possibleTrumps[3], 'J', 15, 1)).toBe(false);
      // Bottom: 6 ambiguous + 2 SJs = 8
      expect(s.possibleTrumps[4]!).toHaveLength(8);
      expect(has(s.possibleTrumps[4], 'J', 15, 0)).toBe(true);
      expect(has(s.possibleTrumps[4], 'J', 15, 1)).toBe(true);
    });

    it('P1 declarer view: bottom excluded, H-2-0 at P0, no SJs anywhere possible', () => {
      const s = call(p1Hand, 1, [], reveals, cfg, true, p1Bottom);
      // Bottom excluded
      expect(s.possibleTrumps[4]).toBeNull();
      // 6 unseen + H-2-0 definitive at P0: {J-16-0,J-16-1,S-2-1,H-2-1,C-2-0,D-2-1} + H-2-0
      // S-2-0 is in bottom (known to declarer, excluded).
      const unseen = ['J-16-0', 'J-16-1', 'S-2-1', 'H-2-0', 'H-2-1', 'C-2-0', 'D-2-1'];
      // P0 possible: 6 ambiguous + H-2-0 = 7
      expect(s.possibleTrumps[0]!).toHaveLength(7);
      for (const id of unseen) expect(s.possibleTrumps[0]!).toContain(id);
      // H-2-0 is also definitive at P0
      expect(s.knownTrumpsPerPlayer[0].map(c => c.id)).toContain('H-2-0');
      // P2 possible: 6 ambiguous only (H-2-0 NOT at P2)
      expect(s.possibleTrumps[2]!).toHaveLength(6);
      expect(has(s.possibleTrumps[2], 'H', 2, 0)).toBe(false);
      expect(has(s.possibleTrumps[2], 'J', 16, 0)).toBe(true);
      // P3 possible: 6 ambiguous only
      expect(s.possibleTrumps[3]!).toHaveLength(6);
      expect(has(s.possibleTrumps[3], 'H', 2, 0)).toBe(false);
      // No player has SJ in possible
      for (let p = 0; p < 4; p++) {
        if (p === 1) continue;
        expect(has(s.possibleTrumps[p], 'J', 15, 0)).toBe(false);
        expect(has(s.possibleTrumps[p], 'J', 15, 1)).toBe(false);
      }
    });

    it('P2 view: SJs at {P1, bottom}, H-2-0 at P0 only', () => {
      const s = call(p2Hand, 2, [], reveals, cfg, false, []);
      // Self null
      expect(s.possibleTrumps[2]).toBeNull();
      // P0 possible: 8 ambiguous + H-2-0 = 9 (no SJs)
      expect(s.possibleTrumps[0]!).toHaveLength(9);
      expect(has(s.possibleTrumps[0], 'H', 2, 0)).toBe(true);
      expect(has(s.possibleTrumps[0], 'J', 15, 0)).toBe(false);
      // P1 possible: 8 ambiguous + 2 SJs = 10
      expect(s.possibleTrumps[1]!).toHaveLength(10);
      expect(has(s.possibleTrumps[1], 'J', 15, 0)).toBe(true);
      expect(has(s.possibleTrumps[1], 'J', 15, 1)).toBe(true);
      // P3 possible: 8 ambiguous (no H-2-0, no SJs)
      expect(s.possibleTrumps[3]!).toHaveLength(8);
      expect(has(s.possibleTrumps[3], 'H', 2, 0)).toBe(false);
      expect(has(s.possibleTrumps[3], 'J', 15, 0)).toBe(false);
      // Bottom: 8 ambiguous + 2 SJs = 10
      expect(s.possibleTrumps[4]!).toHaveLength(10);
      expect(has(s.possibleTrumps[4], 'J', 15, 0)).toBe(true);
      // known: P0 has H-2-0 from reveal
      expect(s.knownTrumpsPerPlayer[0].map(c => c.id)).toContain(cid('H', 2, 0));
    });

    it('P3 view: SJs at {P1, bottom}, H-2-0 at P0 only', () => {
      const s = call(p3Hand, 3, [], reveals, cfg, false, []);
      expect(s.possibleTrumps[3]).toBeNull();
      // P3 has 2 trumps, 10 unseen. H-2-0 at {0}, SJs at {1,4}.
      // 7 unrestricted: BJ-0, H-2-1, C-2-0, C-2-1, D-2-0, D-2-1, S-2-0
      // P0: 7 + H-2-0 = 8
      expect(s.possibleTrumps[0]!).toHaveLength(8);
      expect(has(s.possibleTrumps[0], 'H', 2, 0)).toBe(true);
      expect(has(s.possibleTrumps[0], 'J', 15, 0)).toBe(false);
      // P1: 7 + 2 SJs = 9
      expect(s.possibleTrumps[1]!).toHaveLength(9);
      expect(has(s.possibleTrumps[1], 'J', 15, 0)).toBe(true);
      expect(has(s.possibleTrumps[1], 'J', 15, 1)).toBe(true);
      // P2: 7 (no H-2-0 at P2, no SJs)
      expect(s.possibleTrumps[2]!).toHaveLength(7);
      expect(has(s.possibleTrumps[2], 'H', 2, 0)).toBe(false);
      expect(has(s.possibleTrumps[2], 'J', 15, 0)).toBe(false);
      // Bottom: 7 + 2 SJs = 9
      expect(s.possibleTrumps[4]!).toHaveLength(9);
      expect(has(s.possibleTrumps[4], 'J', 15, 0)).toBe(true);
      expect(has(s.possibleTrumps[4], 'J', 15, 1)).toBe(true);
    });

    const offsuit = c('S', 3, 0); // non-trump pad card

    it('after P1 leads SJ pair: verify each post-trick perspective', () => {
      // Trick 1: P1 leads SJ-0, SJ-1 (trump pair, 2 cards).
      // P2: D-2-1 + pad (1 trump < 2 → void-after-play, also no pair)
      // P3: S-2-1, BJ-1 (2 singles, no pair → no-pair deduction)
      // P0: H-2-0, H-2-1 (mandatory pair, no deduction)
      const trick1 = mockTrickWithPattern(
        [
          [c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1)],
          [c('D', 2, 1), offsuit],
          [c('S', 2, 1), c('J', Rank.BigJoker, 1)],
          [c('H', 2, 0), c('H', 2, 1)],
        ],
        1, 1, 'pair', 1, false,
      );

      // Post-play hands:
      const p0Post = [c('J', Rank.BigJoker, 0), c('C', 2, 0)];
      const p1Post = [c('D', 2, 0), c('C', 2, 1)];
      const p2Post: Card[] = [];
      const p3Post: Card[] = [];
      // Bottom: S-2-0 (known to P1 declarer)
      // Unplayed: BJ-0(P0), C-2-0(P0), D-2-0(P1), C-2-1(P1), S-2-0(bottom) = 5

      // Key deduction: P2 played 1 trump against 2-card lead → void after play.
      // In all perspectives, possibleTrumps[2] should be empty.

      // === P0 view: self BJ-0, C-2-0. 3 unseen at {1,3,4}. P2 void. ===
      const s0 = call(p0Post, 0, [trick1], reveals, cfg, false, []);
      expect(s0.possibleTrumps[0]).toBeNull();
      expect(s0.possibleTrumps[1]!).toHaveLength(3);
      expect(has(s0.possibleTrumps[1], 'D', 2, 0)).toBe(true);
      expect(has(s0.possibleTrumps[1], 'C', 2, 1)).toBe(true);
      expect(has(s0.possibleTrumps[1], 'S', 2, 0)).toBe(true);
      // P2 void (played 1 trump < 2-card lead)
      expect(s0.possibleTrumps[2]!).toHaveLength(0);
      expect(s0.playersWithNoTrump.has(2)).toBe(true);
      // P3: 3 unseen. No pair deduction (C-2 key has only 1 copy per player)
      expect(s0.possibleTrumps[3]!).toHaveLength(3);
      // Bottom: 3
      expect(s0.possibleTrumps[4]!).toHaveLength(3);

      // === P1 view (declarer): self D-2-0, C-2-1; bottom S-2-0 known. 2 unseen at {0,3}. P2 void. ===
      const s1 = call(p1Post, 1, [trick1], reveals, cfg, true, p1Bottom);
      expect(s1.possibleTrumps[4]).toBeNull();
      expect(s1.possibleTrumps[0]!).toHaveLength(2);
      expect(has(s1.possibleTrumps[0], 'J', 16, 0)).toBe(true);
      expect(has(s1.possibleTrumps[0], 'C', 2, 0)).toBe(true);
      // P2 void
      expect(s1.possibleTrumps[2]!).toHaveLength(0);
      expect(s1.playersWithNoTrump.has(2)).toBe(true);
      expect(s1.possibleTrumps[3]!).toHaveLength(2);

      // === P2 view: self void. 5 unseen at {0,1,3,4}. P3 gets C-2 deduction. ===
      const s2 = call(p2Post, 2, [trick1], reveals, cfg, false, []);
      expect(s2.possibleTrumps[2]).toBeNull();
      expect(s2.possibleTrumps[0]!).toHaveLength(5);
      expect(s2.possibleTrumps[1]!).toHaveLength(5);
      // P3: 4 (lost one C-2 from pair deduction, but P2 is NOT void from P2's own view)
      expect(s2.possibleTrumps[3]!).toHaveLength(4);
      const p3missC2 = has(s2.possibleTrumps[3], 'C', 2, 0)
        ? !has(s2.possibleTrumps[3], 'C', 2, 1)
        : !has(s2.possibleTrumps[3], 'C', 2, 0);
      expect(p3missC2).toBe(true);
      expect(has(s2.possibleTrumps[3], 'D', 2, 0)).toBe(true);
      expect(has(s2.possibleTrumps[3], 'S', 2, 0)).toBe(true);
      expect(s2.possibleTrumps[4]!).toHaveLength(5);

      // === P3 view: self void. 5 unseen at {0,1,2,4}. P2 void (1 trump < 2-card lead). ===
      const s3 = call(p3Post, 3, [trick1], reveals, cfg, false, []);
      expect(s3.possibleTrumps[3]).toBeNull();
      expect(s3.possibleTrumps[0]!).toHaveLength(5);
      expect(s3.possibleTrumps[1]!).toHaveLength(5);
      // P2 void after play
      expect(s3.possibleTrumps[2]!).toHaveLength(0);
      expect(s3.playersWithNoTrump.has(2)).toBe(true);
      expect(s3.possibleTrumps[4]!).toHaveLength(5);

      // All views: played cards not in any possibleTrumps
      const playedIds = [
        cid('J', 15, 0), cid('J', 15, 1), cid('D', 2, 1),
        cid('S', 2, 1), cid('J', 16, 1), cid('H', 2, 0), cid('H', 2, 1),
      ];
      for (const v of [s0, s1, s2, s3]) {
        for (let p = 0; p < 5; p++) {
          const bag = v.possibleTrumps[p];
          if (!bag) continue;
          for (const pid of playedIds) expect(bag).not.toContain(pid);
        }
      }
    });

    it('all non-P1 perspectives agree: only P1/bottom can have SJ', () => {
      for (const [idx, hand, isDecl, bot] of [
        [0, p0Hand, false, []],
        [2, p2Hand, false, []],
        [3, p3Hand, false, []],
      ] as const) {
        const s = call(hand, idx, [], reveals, cfg, isDecl, bot);
        // Only P1 and bottom can have SJ
        expect(has(s.possibleTrumps[1], 'J', 15, 0)).toBe(true);
        expect(has(s.possibleTrumps[1], 'J', 15, 1)).toBe(true);
        expect(has(s.possibleTrumps[4], 'J', 15, 0)).toBe(true);
        expect(has(s.possibleTrumps[4], 'J', 15, 1)).toBe(true);
        // No one else
        for (let p = 0; p < 4; p++) {
          if (p === idx || p === 1) continue;
          expect(has(s.possibleTrumps[p], 'J', 15, 0)).toBe(false);
          expect(has(s.possibleTrumps[p], 'J', 15, 1)).toBe(false);
        }
      }
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
