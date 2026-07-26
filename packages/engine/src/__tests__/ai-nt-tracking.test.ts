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
    })) as unknown as Trick['plays'],
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
    })) as unknown as Trick['plays'],
    leadPlayerIndex,
    winnerIndex,
    points: 0,
  };
}

function call(
  hand: Card[], myIndex: number, tricks: Trick[], reveals: Reveal[],
  cfg: TrumpDeclaration, isDeclarer: boolean = false, bottom: Card[] = [],
) {
  return computeNTTrumpState(hand, myIndex, tricks, reveals, cfg, isDeclarer, bottom);
}

// ---- Helpers for new Record<string, number> possibleTrumps format ----

/** Total possible trump count at a location (sum of all counts). */
function sumPossible(rec: Record<string, number> | null): number {
  if (!rec) return 0;
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

/** Make a suit-rank key from suit character and rank number. */
function srk(suit: string, rank: number): string {
  return suit === 'J' ? `J-${rank}` : `${suit}-${rank}`;
}

/** Check if a location can have >=1 of a given suitRank. */
function has(rec: Record<string, number> | null, suit: string, rank: number, _idx?: number): boolean {
  return (rec?.[srk(suit, rank)] ?? 0) > 0;
}

/** Get possible count for a suitRank at a location. */
function cnt(rec: Record<string, number> | null, key: string): number {
  return rec?.[key] ?? 0;
}

// ---- Tests ----

describe('NT trump tracking', () => {
  const cfg2 = ntCfg(2);
  const cfg5 = ntCfg(5);

  describe('initial state - no cards played', () => {
    it('non-declarer: all 12 trumps in possible lists for 3 players + bottom', () => {
      const s = call([], 0, [], [], cfg2, false, []);
      expect(s.totalTrumps).toBe(12);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.remainingSmallJokers).toBe(2);
      expect(s.opponentTrumpCount).toBe(0);
      expect(s.possibleTrumps[0]).toBeNull();
      expect(sumPossible(s.possibleTrumps[1])).toBe(12);
      expect(sumPossible(s.possibleTrumps[2])).toBe(12);
      expect(sumPossible(s.possibleTrumps[3])).toBe(12);
      expect(sumPossible(s.possibleTrumps[4])).toBe(12);
      expect(s.isFullyDetermined).toBe(false);
      expect(s.canFormPair[1]).toBe(true);
      expect(s.canHaveJoker[1]).toBe(true);
      expect(s.canHaveBigJoker[1]).toBe(true);
      expect(s.canHaveSmallJoker[1]).toBe(true);
    });

    it('declarer: bottom excluded from possible, no bottom tracking', () => {
      const s = call([], 0, [], [], cfg2, true, []);
      expect(s.totalTrumps).toBe(12);
      expect(s.possibleTrumps[0]).toBeNull();
      expect(s.possibleTrumps[4]).toBeNull();
      expect(sumPossible(s.possibleTrumps[1])).toBe(12);
      expect(sumPossible(s.possibleTrumps[2])).toBe(12);
      expect(sumPossible(s.possibleTrumps[3])).toBe(12);
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
      expect(s.knownTrumpsPerPlayer[0].length).toBe(4);
      expect(sumPossible(s.possibleTrumps[1])).toBe(8);
      expect(s.opponentTrumpCount).toBe(0);
      expect(s.maxTrumpCounts[1]).toBe(8);
      expect(s.maxTrumpCounts[2]).toBe(8);
      expect(s.maxTrumpCounts[3]).toBe(8);
    });

    it('declarer: bottom trump cards excluded from tracking', () => {
      const hand: Card[] = [];
      const bottom = [c('J', Rank.BigJoker, 0), c('J', Rank.SmallJoker, 0)];
      const s = call(hand, 0, [], [], cfg2, true, bottom);
      expect(s.remainingBigJokers).toBe(1);
      expect(s.remainingSmallJokers).toBe(1);
      expect(sumPossible(s.possibleTrumps[1])).toBe(10);
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
      expect(s.remainingBigJokers).toBe(1);
      expect(s.remainingSmallJokers).toBe(1);
      expect(sumPossible(s.possibleTrumps[4])).toBe(7);
    });

    it('player discarding against trump lead -> cleared from all possible', () => {
      const hand = [c('S', 2, 0)];
      const trick = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],
          [c('S', 3, 0)],
          [c('J', Rank.SmallJoker, 0)],
          [c('H', 2, 0)],
        ],
        0, 0,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      expect(s.maxTrumpCounts[1]).toBe(0);
      expect(s.playersWithNoTrump.has(1)).toBe(true);
    });

    it('pair deduction: player follows trump pair with single -> cannot form pairs', () => {
      const hand: Card[] = [];
      const trick = mockTrickWithPattern(
        [
          [c('S', 2, 0), c('S', 2, 1)],
          [c('D', 2, 0)],
          [c('C', 2, 0), c('C', 2, 1)],
          [c('J', Rank.SmallJoker, 0)],
        ],
        0, 0, 'pair', 1, false,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      expect(s.canFormPair[1]).toBe(false);
    });

    it('bottom not affected by pair deduction', () => {
      const hand: Card[] = [];
      const trick = mockTrickWithPattern(
        [
          [c('S', 2, 0), c('S', 2, 1)],
          [c('D', 2, 0)],
          [c('C', 2, 0), c('C', 2, 1)],
          [c('J', Rank.SmallJoker, 0)],
        ],
        0, 0, 'pair', 1, false,
      );
      const s = call(hand, 0, [trick], [], cfg2, false, []);
      expect(s.possibleTrumps[4]).not.toBeNull();
    });
  });

  describe('full determination', () => {
    it('all 12 trumps accounted for -> isFullyDetermined', () => {
      const hand = [c('S', 2, 0)];
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
          [c('S', 3, 0)],
        ], 0, 0,
      );
      const s = call(hand, 0, [t1, t2, t3], [], cfg2, false, []);
      expect(s.isFullyDetermined).toBe(true);
      expect(s.maxTrumpCounts[0]).toBe(1);
      expect(s.playersWithNoTrump.has(0)).toBe(false);
    });

    it('isFullyDetermined = false when cards still ambiguous', () => {
      const hand: Card[] = [];
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
      expect(s.canHaveBigJoker[1]).toBe(false);
      expect(s.canHaveBigJoker[2]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(false);
      expect(s.canHaveSmallJoker[1]).toBe(true);
      expect(s.remainingSmallJokers).toBe(2);
      expect(s.remainingBigJokers).toBe(0);
    });

    it('canFormJokerPair when player has 2 possible jokers of same rank', () => {
      const hand: Card[] = [];
      const s = call(hand, 0, [], [], cfg2, false, []);
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
      const t1 = mockTrick(
        [
          [c('J', Rank.BigJoker, 0)],
          [c('S', 3, 0)],
          [c('D', 2, 0)],
          [c('S', 4, 0)],
        ], 0, 0,
      );
      const s = call(hand, 0, [t1], [], cfg2, false, []);
      expect(s.maxTrumpCounts[1]).toBe(0);
      expect(s.maxTrumpCounts[3]).toBe(0);
      expect(opponentsHaveTrump(s, 0)).toBe(false);
    });

    it('canPlayerBeatSingle detects when player can beat a card', () => {
      const hand = [c('S', 2, 0)];
      const cfg = cfg2;
      const s = call(hand, 0, [], [], cfg, false, []);
      expect(canPlayerBeatSingle(1, c('S', 2, 1), s, cfg)).toBe(true);
    });

    it('canPlayerBeatPair detects when player can beat a pair', () => {
      const hand: Card[] = [];
      const cfg = cfg2;
      const s = call(hand, 0, [], [], cfg, false, []);
      expect(s.canFormPair[1]).toBe(true);
      expect(canPlayerBeatPair(1, [c('S', 2, 0), c('S', 2, 1)], s, cfg)).toBe(true);
    });

    it('canAnyOpponentBeatSingle with unbeatable big joker', () => {
      const hand = [
        c('J', Rank.BigJoker, 0), c('J', Rank.BigJoker, 1),
        c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1),
      ];
      const cfg = cfg2;
      const s = call(hand, 0, [], [], cfg, false, []);
      const myCard = c('J', Rank.BigJoker, 0);
      expect(canAnyOpponentBeatSingle(myCard, s, 0, cfg)).toBe(false);
    });
  });

  describe('reveal-based deduction', () => {
    it('pair of Small Jokers reveal (NT): both SJs at revealer (declarer)', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: null, strength: 3 },
      ];
      const hand: Card[] = [c('S', 2, 0)];
      const cfg = ntCfg(2, 1);
      const s = call(hand, 0, [], reveals, cfg, false, []);
      expect(s.canHaveSmallJoker[2]).toBe(false);
      expect(s.canHaveSmallJoker[3]).toBe(false);
      expect(s.canHaveSmallJoker[1]).toBe(true);
      expect(s.remainingSmallJokers).toBe(2);
      const rec = s.possibleTrumps[4]!;
      expect(has(s.possibleTrumps[4], 'J', 15)).toBe(true);
      expect(s.allUnseenJokersOnOurSide).toBe(false);
    });

    it('pair of Big Jokers reveal (NT): both BJs at revealer (teammate declarer)', () => {
      const reveals: Reveal[] = [
        { playerIndex: 2, suit: null, strength: 4 },
      ];
      const hand: Card[] = [];
      const cfg = ntCfg(2, 2);
      const s = call(hand, 0, [], reveals, cfg, false, []);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.canHaveBigJoker[1]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(false);
      expect(s.canHaveBigJoker[2]).toBe(true);
      expect(s.allUnseenBigJokersOnOurSide).toBe(true);
    });

    it('pair of level cards reveal: both copies at revealer', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 2 },
      ];
      const hand: Card[] = [];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      expect(s.knownTrumpsPerPlayer[1].length).toBe(2);
      // P2, P3 cannot have H-2
      expect(has(s.possibleTrumps[2], 'H', 2)).toBe(false);
      expect(has(s.possibleTrumps[3], 'H', 2)).toBe(false);
      // Bottom cannot have H-2
      expect(has(s.possibleTrumps[4], 'H', 2)).toBe(false);
    });

    it('single level card reveal: one copy at revealer, other still possible', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 1 },
      ];
      const hand: Card[] = [];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      expect(s.knownTrumpsPerPlayer[1].length).toBe(1);
      expect(s.knownTrumpsPerPlayer[1][0].suit).toBe('H');
      expect(s.knownTrumpsPerPlayer[1][0].rank).toBe(2);
      expect(s.canFormPair[2]).toBe(true);
      expect(s.canFormPair[3]).toBe(true);
    });

    it('counter-reveal: P1 reveals H-2 single, P2 counters with SJ pair', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: Suit.Hearts, strength: 1 },
        { playerIndex: 2, suit: null, strength: 3 },
      ];
      const hand: Card[] = [];
      const cfg = ntCfg(2, 2);
      const s = call(hand, 0, [], reveals, cfg, false, []);
      expect(s.knownTrumpsPerPlayer[1].length).toBe(1);
      expect(s.knownTrumpsPerPlayer[1][0].suit).toBe('H');
      expect(s.remainingSmallJokers).toBe(2);
      expect(s.canHaveSmallJoker[1]).toBe(false);
      expect(s.canHaveSmallJoker[3]).toBe(false);
      expect(s.canHaveSmallJoker[2]).toBe(true);
      expect(s.allUnseenJokersOnOurSide).toBe(false);
    });

    it('from P0 perspective: P1 counters with SJ pair, P0 knows P2+P3 cannot have SJ pair', () => {
      const reveals: Reveal[] = [
        { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
        { playerIndex: 1, suit: null, strength: 3 },
      ];
      const cfg = ntCfg(2, 1);
      const hand: Card[] = [c('H', 2, 0)];
      const s = call(hand, 0, [], reveals, cfg, false, []);
      expect(s.canHaveSmallJoker[1]).toBe(true);
      expect(s.canHaveSmallJoker[3]).toBe(false);
      expect(s.canHaveSmallJoker[2]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(true);
      expect(s.canHaveBigJoker[2]).toBe(true);
    });

    it('from P1 perspective: P1 knows P3+P2 have at most 1 H-2 between them', () => {
      const reveals: Reveal[] = [
        { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
        { playerIndex: 1, suit: null, strength: 3 },
      ];
      const cfg = ntCfg(2, 1);
      const hand: Card[] = [
        c('J', Rank.SmallJoker, 0),
        c('J', Rank.SmallJoker, 1),
      ];
      const s = call(hand, 1, [], reveals, cfg, false, []);
      expect(s.knownTrumpsPerPlayer[0].length).toBe(1);
      expect(s.knownTrumpsPerPlayer[0][0].suit).toBe('H');
      const knownP3 = s.knownTrumpsPerPlayer[3];
      const knownP2 = s.knownTrumpsPerPlayer[2];
      expect(knownP3.length + knownP2.length).toBeLessThanOrEqual(1);
    });

    it('revealer is self: cards in hand already excluded, bottom still cleaned', () => {
      const reveals: Reveal[] = [
        { playerIndex: 0, suit: null, strength: 3 },
      ];
      const hand = [
        c('J', Rank.SmallJoker, 0),
        c('J', Rank.SmallJoker, 1),
        c('S', 2, 0),
      ];
      const s = call(hand, 0, [], reveals, cfg2, false, []);
      expect(s.remainingSmallJokers).toBe(0);
      expect(has(s.possibleTrumps[4], 'J', 15)).toBe(false);
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
      expect(s.knownTrumpsPerPlayer[0].length).toBe(3);
      expect(has(s.possibleTrumps[4], 'S', 2)).toBe(false);
    });

    it('declarer revealed: opponents cannot have revealed cards, bottom may', () => {
      const reveals: Reveal[] = [
        { playerIndex: 1, suit: null, strength: 4 },
      ];
      const cfg = ntCfg(2, 1);
      const hand: Card[] = [];
      const s = call(hand, 0, [], reveals, cfg, false, []);
      expect(s.remainingBigJokers).toBe(2);
      expect(s.canHaveBigJoker[2]).toBe(false);
      expect(s.canHaveBigJoker[3]).toBe(false);
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
    //   P0(4): H-2-0(revealed), H-2-1, BJ-0, C-2-0
    //   P1(4+1): SJ-0, SJ-1, D-2-0, C-2-1; bottom: S-2-0
    //   P2(1): D-2-1
    //   P3(2): S-2-1, BJ-1
    const cfg = ntCfg(2, 1);
    const reveals: Reveal[] = [
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 1, suit: null, strength: 3 },
    ];
    const p0Hand = [c('H', 2, 0), c('H', 2, 1), c('J', Rank.BigJoker, 0), c('C', 2, 0)];
    const p1Hand = [c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1), c('D', 2, 0), c('C', 2, 1)];
    const p1Bottom = [c('S', 2, 0)];
    const p2Hand = [c('D', 2, 1)];
    const p3Hand = [c('S', 2, 1), c('J', Rank.BigJoker, 1)];

    function isr(k: string): boolean { return k === 'J-16'; }
    function iss(k: string): boolean { return k === 'J-15'; }

    const allKeys = ['J-16','J-15','S-2','H-2','C-2','D-2'];

    it('knownTrumpsPerPlayer: my-hand cards always in known, no other player private info', () => {
      const s0 = call(p0Hand, 0, [], reveals, cfg, false, []);
      expect(s0.knownTrumpsPerPlayer[0].length).toBe(4);
      expect(s0.knownTrumpsPerPlayer[1].length).toBe(0);
      expect(s0.knownTrumpsPerPlayer[2].length).toBe(0);
      expect(s0.knownTrumpsPerPlayer[3].length).toBe(0);

      const s1 = call(p1Hand, 1, [], reveals, cfg, true, p1Bottom);
      expect(s1.knownTrumpsPerPlayer[1].length).toBe(4);
      expect(s1.knownTrumpsPerPlayer[0].length).toBe(1);
      expect(s1.knownTrumpsPerPlayer[0][0].id).toBe(c('H', 2, 0).id);
      expect(s1.knownTrumpsPerPlayer[2].length).toBe(0);
      expect(s1.knownTrumpsPerPlayer[3].length).toBe(0);
    });

    it('P0 view: P2/P3 possible list excludes SJs, P1 and bottom include SJs', () => {
      const s = call(p0Hand, 0, [], reveals, cfg, false, []);
      expect(s.possibleTrumps[0]).toBeNull();
      expect(sumPossible(s.possibleTrumps[1])).toBe(8);
      expect(has(s.possibleTrumps[1], 'J', 15)).toBe(true);
      expect(cnt(s.possibleTrumps[1], 'J-15')).toBe(2);
      expect(sumPossible(s.possibleTrumps[2])).toBe(6);
      expect(has(s.possibleTrumps[2], 'J', 15)).toBe(false);
      expect(sumPossible(s.possibleTrumps[3])).toBe(6);
      expect(has(s.possibleTrumps[3], 'J', 15)).toBe(false);
      expect(sumPossible(s.possibleTrumps[4])).toBe(8);
      expect(has(s.possibleTrumps[4], 'J', 15)).toBe(true);
    });

    it('P1 declarer view: bottom excluded, H-2-0 at P0, no SJs anywhere possible', () => {
      const s = call(p1Hand, 1, [], reveals, cfg, true, p1Bottom);
      expect(s.possibleTrumps[4]).toBeNull();
      expect(sumPossible(s.possibleTrumps[0])).toBe(7);
      expect(has(s.possibleTrumps[0], 'J', 16)).toBe(true);
      expect(has(s.possibleTrumps[0], 'S', 2)).toBe(true);
      expect(has(s.possibleTrumps[0], 'H', 2)).toBe(true);
      expect(has(s.possibleTrumps[0], 'C', 2)).toBe(true);
      expect(has(s.possibleTrumps[0], 'D', 2)).toBe(true);
      expect(s.knownTrumpsPerPlayer[0].map(c => c.id)).toContain('H-2-0');
      expect(sumPossible(s.possibleTrumps[2])).toBe(6);
      // P2: H-2 count=1 (H-2-1 unseen, H-2-0 definitive at P0)
      expect(cnt(s.possibleTrumps[2], 'H-2')).toBe(1);
      expect(has(s.possibleTrumps[2], 'J', 16)).toBe(true);
      expect(sumPossible(s.possibleTrumps[3])).toBe(6);
      expect(cnt(s.possibleTrumps[3], 'H-2')).toBe(1);
      for (let p = 0; p < 4; p++) {
        if (p === 1) continue;
        expect(has(s.possibleTrumps[p], 'J', 15)).toBe(false);
      }
    });

    it('P2 view: SJs at {P1, bottom}, H-2-0 at P0 only', () => {
      const s = call(p2Hand, 2, [], reveals, cfg, false, []);
      expect(s.possibleTrumps[2]).toBeNull();
      expect(sumPossible(s.possibleTrumps[0])).toBe(9);
      expect(has(s.possibleTrumps[0], 'H', 2)).toBe(true);
      expect(has(s.possibleTrumps[0], 'J', 15)).toBe(false);
      expect(sumPossible(s.possibleTrumps[1])).toBe(10);
      expect(has(s.possibleTrumps[1], 'J', 15)).toBe(true);
      expect(cnt(s.possibleTrumps[1], 'J-15')).toBe(2);
      expect(sumPossible(s.possibleTrumps[3])).toBe(8);
      // P3: H-2 count=1 (H-2-1 unseen, H-2-0 definitive at P0)
      expect(cnt(s.possibleTrumps[3], 'H-2')).toBe(1);
      expect(has(s.possibleTrumps[3], 'J', 15)).toBe(false);
      expect(sumPossible(s.possibleTrumps[4])).toBe(10);
      expect(has(s.possibleTrumps[4], 'J', 15)).toBe(true);
      expect(s.knownTrumpsPerPlayer[0].map(c => c.id)).toContain(c('H', 2, 0).id);
    });

    it('P3 view: SJs at {P1, bottom}, H-2-0 at P0 only', () => {
      const s = call(p3Hand, 3, [], reveals, cfg, false, []);
      expect(s.possibleTrumps[3]).toBeNull();
      expect(sumPossible(s.possibleTrumps[0])).toBe(8);
      expect(has(s.possibleTrumps[0], 'H', 2)).toBe(true);
      expect(has(s.possibleTrumps[0], 'J', 15)).toBe(false);
      expect(sumPossible(s.possibleTrumps[1])).toBe(9);
      expect(has(s.possibleTrumps[1], 'J', 15)).toBe(true);
      expect(cnt(s.possibleTrumps[1], 'J-15')).toBe(2);
      expect(sumPossible(s.possibleTrumps[2])).toBe(7);
      // P2: H-2 count=1 (H-2-1 unseen, H-2-0 definitive at P0)
      expect(cnt(s.possibleTrumps[2], 'H-2')).toBe(1);
      expect(has(s.possibleTrumps[2], 'J', 15)).toBe(false);
      expect(sumPossible(s.possibleTrumps[4])).toBe(9);
      expect(has(s.possibleTrumps[4], 'J', 15)).toBe(true);
    });

    const offsuit = c('S', 3, 0);

    it('after P1 leads SJ pair: verify each post-trick perspective', () => {
      const trick1 = mockTrickWithPattern(
        [
          [c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1)],
          [c('D', 2, 1), offsuit],
          [c('S', 2, 1), c('J', Rank.BigJoker, 1)],
          [c('H', 2, 0), c('H', 2, 1)],
        ],
        1, 1, 'pair', 1, false,
      );

      const p0Post = [c('J', Rank.BigJoker, 0), c('C', 2, 0)];
      const p1Post = [c('D', 2, 0), c('C', 2, 1)];
      const p2Post: Card[] = [];
      const p3Post: Card[] = [];

      // === P0 view ===
      const s0 = call(p0Post, 0, [trick1], reveals, cfg, false, []);
      expect(s0.possibleTrumps[0]).toBeNull();
      // P1/bottom/P3: S-2=1, C-2=1, D-2=1 (3 unseen between them)
      // But P3 had pair dedup → S-2 gone (played), J-16 gone (played)
      // P3: C-2=1, D-2=1 (only 2 can remain after pair dedup + card removal)
      expect(sumPossible(s0.possibleTrumps[1])).toBe(3);
      expect(has(s0.possibleTrumps[1], 'D', 2)).toBe(true);
      expect(has(s0.possibleTrumps[1], 'C', 2)).toBe(true);
      expect(has(s0.possibleTrumps[1], 'S', 2)).toBe(true);
      expect(sumPossible(s0.possibleTrumps[2])).toBe(0);
      expect(s0.playersWithNoTrump.has(2)).toBe(true);
      // Old buggy code had 3 (S-2/J-16 survived via copy mismatch).
      // Fixed count-based: S-2 & J-16 are both played + deduped → 0 at P3.
      // P3 only has C-2=1, D-2=1 = 2.
      expect(sumPossible(s0.possibleTrumps[3])).toBe(2);
      expect(sumPossible(s0.possibleTrumps[4])).toBe(3);

      // === P1 view (declarer) ===
      // P1 knows S-2-0 in bottom, D-2-0+C-2-1 in hand. Unseen: J-16-0, C-2-0.
      // P3 dedup: played J-16-1, S-2-1. J-16 count=1+played→0. S-2 already 0.
      // P3 remaining: C-2=1 only.
      const s1 = call(p1Post, 1, [trick1], reveals, cfg, true, p1Bottom);
      expect(s1.possibleTrumps[4]).toBeNull();
      expect(sumPossible(s1.possibleTrumps[0])).toBe(2);
      expect(has(s1.possibleTrumps[0], 'J', 16)).toBe(true);
      expect(has(s1.possibleTrumps[0], 'C', 2)).toBe(true);
      expect(sumPossible(s1.possibleTrumps[2])).toBe(0);
      expect(s1.playersWithNoTrump.has(2)).toBe(true);
      expect(sumPossible(s1.possibleTrumps[3])).toBe(1);

      // === P2 view ===
      // P2 hand empty. 5 unseen: J-16-0,S-2-0,C-2×2,D-2-0.
      // P3 dedup: played S-2-1,J-16-1. S-2 2→1,played→0. J-16 2→1,played→0.
      // P3 remaining: C-2=1,D-2=1 = 2.
      const s2 = call(p2Post, 2, [trick1], reveals, cfg, false, []);
      expect(s2.possibleTrumps[2]).toBeNull();
      expect(sumPossible(s2.possibleTrumps[0])).toBe(5);
      expect(sumPossible(s2.possibleTrumps[1])).toBe(5);
      expect(sumPossible(s2.possibleTrumps[3])).toBe(2);
      const p3c2 = cnt(s2.possibleTrumps[3], 'C-2');
      expect(p3c2).toBe(1);
      expect(has(s2.possibleTrumps[3], 'D', 2)).toBe(true);
      // P3 can't have S-2 (played + dedup → 0) or J-16 (same)
      expect(has(s2.possibleTrumps[3], 'S', 2)).toBe(false);
      expect(has(s2.possibleTrumps[3], 'J', 16)).toBe(false);
      expect(sumPossible(s2.possibleTrumps[4])).toBe(5);

      // === P3 view ===
      const s3 = call(p3Post, 3, [trick1], reveals, cfg, false, []);
      expect(s3.possibleTrumps[3]).toBeNull();
      expect(sumPossible(s3.possibleTrumps[0])).toBe(5);
      expect(sumPossible(s3.possibleTrumps[1])).toBe(5);
      expect(sumPossible(s3.possibleTrumps[2])).toBe(0);
      expect(s3.playersWithNoTrump.has(2)).toBe(true);
      expect(sumPossible(s3.possibleTrumps[4])).toBe(5);

      // All views: played cards not in any possibleTrumps
      const playedKeys: Record<string, number> = {
        'J-15': 2, 'D-2': 1, 'S-2': 1, 'J-16': 1, 'H-2': 2,
      };
      for (const v of [s0, s1, s2, s3]) {
        for (let p = 0; p < 5; p++) {
          const rec = v.possibleTrumps[p];
          if (!rec) continue;
          for (const [k, _n] of Object.entries(playedKeys)) {
            // played cards may have been at this location before play,
            // but after removal they should not appear in other locations.
            // Just verify the sum across all locations is consistent.
          }
        }
      }

      // Verify counts match
      const v0 = call(p0Post, 0, [trick1], reveals, cfg, false, []);
      expect(sumPossible(v0.possibleTrumps[1])).toBe(3);
      expect(sumPossible(v0.possibleTrumps[2])).toBe(0);
      expect(sumPossible(v0.possibleTrumps[3])).toBe(2);
      expect(sumPossible(v0.possibleTrumps[4])).toBe(3);
      expect(v0.playersWithNoTrump.has(2)).toBe(true);
      const v1 = call(p1Post, 1, [trick1], reveals, cfg, true, p1Bottom);
      expect(sumPossible(v1.possibleTrumps[0])).toBe(2);
      expect(sumPossible(v1.possibleTrumps[2])).toBe(0);
      expect(sumPossible(v1.possibleTrumps[3])).toBe(1);
      expect(v1.playersWithNoTrump.has(2)).toBe(true);
      const v3 = call(p3Post, 3, [trick1], reveals, cfg, false, []);
      expect(sumPossible(v3.possibleTrumps[0])).toBe(5);
      expect(sumPossible(v3.possibleTrumps[1])).toBe(5);
      expect(sumPossible(v3.possibleTrumps[2])).toBe(0);
      expect(sumPossible(v3.possibleTrumps[4])).toBe(5);
      expect(v3.playersWithNoTrump.has(2)).toBe(true);
    });

    it('all non-P1 perspectives agree: only P1/bottom can have SJ', () => {
      for (const [idx, hand, isDecl, bot] of [
        [0, p0Hand, false, []],
        [2, p2Hand, false, []],
        [3, p3Hand, false, []],
      ] as const) {
        const s = call(hand, idx, [], reveals, cfg, isDecl, bot as unknown as Card[]);
        expect(has(s.possibleTrumps[1], 'J', 15)).toBe(true);
        expect(cnt(s.possibleTrumps[1], 'J-15')).toBe(2);
        expect(has(s.possibleTrumps[4], 'J', 15)).toBe(true);
        expect(cnt(s.possibleTrumps[4], 'J-15')).toBe(2);
        for (let p = 0; p < 4; p++) {
          if (p === idx || p === 1) continue;
          expect(has(s.possibleTrumps[p], 'J', 15)).toBe(false);
        }
      }
    });

    // ---- Exhaustive: all 6 suit-rank keys at all 3 other players x 4 perspectives ----

    it('pre-trick: exhaustive 6-key x 4-perspective x all-locations verification', () => {
      function checkCounts(
        s: ReturnType<typeof computeNTTrumpState>,
        myIndex: number, isDecl: boolean,
        expectedCount: (p: number, key: string) => number,
      ) {
        for (let p = 0; p < 5; p++) {
          if (p === myIndex || (p === 4 && isDecl)) {
            expect(s.possibleTrumps[p]).toBeNull();
            continue;
          }
          const rec = s.possibleTrumps[p]!;
          for (const key of allKeys) {
            const expected = expectedCount(p, key);
            const actual = rec[key] ?? 0;
            if (expected > 0) {
              expect(actual).toBe(expected);
            } else {
              expect(actual).toBe(0);
            }
          }
        }
      }

      // P0 view: hand={J-16-0,H-2-0,H-2-1,C-2-0}. Unseen total: 8.
      // SJ at {1,4}(2). Others: J-16×1, S-2×2, C-2×1, D-2×2 unrestricted.
      const p0view = call(p0Hand, 0, [], reveals, cfg, false, []);
      checkCounts(p0view, 0, false, (p, k) => {
        if (k === 'J-16') return p === 0 ? 0 : 1; // my hand has 1 BJ, other unseen
        if (k === 'H-2') return p === 0 ? 0 : 0; // both H-2 in my hand
        if (k === 'C-2') return p === 0 ? 0 : 1; // my hand has 1 C-2
        if (k === 'J-15') return (p === 1 || p === 4) ? 2 : 0; // SJ at {1,4}
        if (k === 'S-2') return 2; // both unseen
        if (k === 'D-2') return 2; // both unseen
        return 0;
      });

      // P1 declarer view
      const p1view = call(p1Hand, 1, [], reveals, cfg, true, p1Bottom);
      checkCounts(p1view, 1, true, (p, k) => {
        if (k === 'J-15') return 0; // both in hand
        if (k === 'D-2') return p === 1 ? 0 : 1; // 1 in hand, 1 unseen
        if (k === 'C-2') return p === 1 ? 0 : 1; // 1 in hand, 1 unseen
        if (k === 'S-2') return p === 1 ? 0 : 1; // 1 in bottom, other unseen at non-bottom
        if (k === 'H-2') return p === 0 ? 2 : 1; // P0: 1 reveal + 1 unseen, others: 1 unseen
        if (k === 'J-16') return 2; // both BJs unseen
        return 0;
      });

      // P2 view
      const p2view = call(p2Hand, 2, [], reveals, cfg, false, []);
      checkCounts(p2view, 2, false, (p, k) => {
        if (k === 'D-2') return p === 2 ? 0 : 1; // 1 in hand
        if (k === 'H-2') return p === 0 ? 2 : 1; // P0: 1 reveal + 1 unseen, others: 1 unseen
        if (k === 'J-15') return (p === 1 || p === 4) ? 2 : 0; // SJ at {1,4}
        if (k === 'J-16') return 2; // both unseen
        if (k === 'S-2') return 2;
        if (k === 'C-2') return 2;
        return 0;
      });

      // P3 view
      const p3view = call(p3Hand, 3, [], reveals, cfg, false, []);
      checkCounts(p3view, 3, false, (p, k) => {
        if (k === 'J-16') return p === 3 ? 0 : 1; // 1 in hand
        if (k === 'S-2') return p === 3 ? 0 : 1; // 1 in hand
        if (k === 'H-2') return p === 0 ? 2 : 1; // P0: 1 reveal + 1 unseen, others: 1 unseen
        if (k === 'J-15') return (p === 1 || p === 4) ? 2 : 0;
        if (k === 'C-2') return 2;
        if (k === 'D-2') return 2;
        return 0;
      });

      // Verify total counts
      expect(sumPossible(p0view.possibleTrumps[1])).toBe(8);
      expect(sumPossible(p0view.possibleTrumps[2])).toBe(6);
      expect(sumPossible(p0view.possibleTrumps[3])).toBe(6);
      expect(sumPossible(p0view.possibleTrumps[4])).toBe(8);
      expect(sumPossible(p1view.possibleTrumps[0])).toBe(7);
      expect(sumPossible(p1view.possibleTrumps[2])).toBe(6);
      expect(sumPossible(p1view.possibleTrumps[3])).toBe(6);
      expect(sumPossible(p2view.possibleTrumps[0])).toBe(9);
      expect(sumPossible(p2view.possibleTrumps[1])).toBe(10);
      expect(sumPossible(p2view.possibleTrumps[3])).toBe(8);
      expect(sumPossible(p3view.possibleTrumps[0])).toBe(8);
      expect(sumPossible(p3view.possibleTrumps[1])).toBe(9);
      expect(sumPossible(p3view.possibleTrumps[2])).toBe(7);
    });

    it('post-trick: exhaustive 6-key x 4-perspective verification', () => {
      const trick1 = mockTrickWithPattern(
        [
          [c('J', Rank.SmallJoker, 0), c('J', Rank.SmallJoker, 1)],
          [c('D', 2, 1), offsuit],
          [c('S', 2, 1), c('J', Rank.BigJoker, 1)],
          [c('H', 2, 0), c('H', 2, 1)],
        ],
        1, 1, 'pair', 1, false,
      );

      const p0Post = [c('J', Rank.BigJoker, 0), c('C', 2, 0)];
      const p1Post = [c('D', 2, 0), c('C', 2, 1)];
      const p2Post: Card[] = [];
      const p3Post: Card[] = [];

      // P0 view post-trick
      const s0 = call(p0Post, 0, [trick1], reveals, cfg, false, []);
      // P2 void (1 trump < 2-card lead from P1)
      expect(sumPossible(s0.possibleTrumps[2])).toBe(0);
      // Unplayed after: J-16-0(P0), C-2-0(P0), D-2-0(P1), C-2-1(P1), S-2-0(bottom)
      // P0: knows own (J-16-0, C-2-0). P1: D-2, C-2, S-2 = 3.
      // P3: pair dedup (S-2,J-16 played+count=1→0) → D-2=1, C-2=1 = 2.
      // Bottom: D-2=1, C-2=1, S-2=1 = 3.
      expect(sumPossible(s0.possibleTrumps[1])).toBe(3);
      expect(sumPossible(s0.possibleTrumps[3])).toBe(2);
      expect(sumPossible(s0.possibleTrumps[4])).toBe(3);

      // P1 declarer view post-trick
      // P1 knows D-2-0,C-2-1 in hand, S-2-0 in bottom. Unseen: J-16-0,C-2-0.
      // P3 dedup: J-16 count=1+played→0. P3: C-2=1.
      const s1 = call(p1Post, 1, [trick1], reveals, cfg, true, p1Bottom);
      expect(sumPossible(s1.possibleTrumps[2])).toBe(0);
      expect(sumPossible(s1.possibleTrumps[0])).toBe(2);
      expect(sumPossible(s1.possibleTrumps[3])).toBe(1);

      // P2 view post-trick: P3 dedup → S-2=0,J-16=0,C-2=1,D-2=1 = 2.
      const s2 = call(p2Post, 2, [trick1], reveals, cfg, false, []);
      for (let p = 0; p < 5; p++) {
        if (p === 2) { expect(s2.possibleTrumps[p]).toBeNull(); continue; }
        const rec = s2.possibleTrumps[p]!;
        expect(cnt(rec, 'J-15')).toBe(0);
        expect(cnt(rec, 'H-2')).toBe(0);
        if (p === 3) {
          // P3: pair dedup on S-2 and J-16 → 0 for both
          expect(cnt(rec, 'C-2')).toBe(1);
          expect(cnt(rec, 'D-2')).toBe(1);
          expect(cnt(rec, 'S-2')).toBe(0);
          expect(cnt(rec, 'J-16')).toBe(0);
        } else {
          // P0, P1, bottom: no dedup
          expect(cnt(rec, 'D-2')).toBe(1);
          expect(cnt(rec, 'S-2')).toBe(1);
          expect(cnt(rec, 'J-16')).toBe(1);
          expect(cnt(rec, 'C-2')).toBe(2);
        }
      }
      expect(sumPossible(s2.possibleTrumps[4])).toBe(5);

      // P3 view post-trick
      const s3 = call(p3Post, 3, [trick1], reveals, cfg, false, []);
      for (let p = 0; p < 5; p++) {
        if (p === 3) { expect(s3.possibleTrumps[p]).toBeNull(); continue; }
        const rec = s3.possibleTrumps[p]!;
        expect(cnt(rec, 'J-15')).toBe(0);
        expect(cnt(rec, 'H-2')).toBe(0);
        if (p === 2) continue; // P2 void
        expect(cnt(rec, 'D-2')).toBeGreaterThanOrEqual(1);
        expect(cnt(rec, 'S-2')).toBeGreaterThanOrEqual(1);
        expect(cnt(rec, 'J-16')).toBeGreaterThanOrEqual(1);
      }
      expect(sumPossible(s3.possibleTrumps[2])).toBe(0);

      // Verify counts
      expect(sumPossible(s0.possibleTrumps[1])).toBe(3);
      expect(sumPossible(s0.possibleTrumps[2])).toBe(0);
      expect(sumPossible(s0.possibleTrumps[3])).toBe(2);
      expect(sumPossible(s0.possibleTrumps[4])).toBe(3);
      expect(s0.playersWithNoTrump.has(2)).toBe(true);
      const v1 = call(p1Post, 1, [trick1], reveals, cfg, true, p1Bottom);
      expect(sumPossible(v1.possibleTrumps[0])).toBe(2);
      expect(sumPossible(v1.possibleTrumps[2])).toBe(0);
      expect(sumPossible(v1.possibleTrumps[3])).toBe(1);
      expect(v1.playersWithNoTrump.has(2)).toBe(true);
      const v3 = call(p3Post, 3, [trick1], reveals, cfg, false, []);
      expect(sumPossible(v3.possibleTrumps[0])).toBe(5);
      expect(sumPossible(v3.possibleTrumps[1])).toBe(5);
      expect(sumPossible(v3.possibleTrumps[2])).toBe(0);
      expect(sumPossible(v3.possibleTrumps[4])).toBe(5);
      expect(v3.playersWithNoTrump.has(2)).toBe(true);
    });
  });

  describe('consecutive deductions', () => {
    it('consecutive pair deductions do not double-count', () => {
      const hand: Card[] = [];
      const t1 = mockTrickWithPattern(
        [
          [c('S', 2, 0), c('S', 2, 1)],
          [c('D', 2, 0)],
          [c('C', 2, 0), c('C', 2, 1)],
          [c('J', Rank.SmallJoker, 0)],
        ], 0, 0, 'pair', 1, false,
      );
      const t2 = mockTrickWithPattern(
        [
          [c('H', 2, 0), c('H', 2, 1)],
          [c('C', 2, 1)],
          [c('J', Rank.SmallJoker, 1)],
          [c('J', Rank.BigJoker, 0)],
        ], 0, 0, 'pair', 1, false,
      );
      const s = call(hand, 0, [t1, t2], [], cfg2, false, []);
      expect(s.canFormPair[1]).toBe(false);
    });
  });
});

describe('current trick plays — in-progress trick deduction', () => {
  const cfg2 = ntCfg(2);
  const cfg5 = ntCfg(5);

  it('played trump in current trick removed from all possible lists', () => {
    const hand: Card[] = [];
    const currentPlays = [
      { cards: [c('H', 2, 0)] },
    ];
    const s = computeNTTrumpState(hand, 0, [], [], cfg2, false, [],
      currentPlays, 3);
    // One H-2 played, one unseen → count=1 everywhere
    expect(cnt(s.possibleTrumps[3], 'H-2')).toBe(1);
    expect(cnt(s.possibleTrumps[1], 'H-2')).toBe(1);
    expect(cnt(s.possibleTrumps[2], 'H-2')).toBe(1);
    expect(cnt(s.possibleTrumps[4], 'H-2')).toBe(1);
  });

  it('discard on trump lead in current trick → void deduction', () => {
    const hand: Card[] = [c('C', 8, 0)];
    const currentPlays = [
      { cards: [c('H', 2, 0)] },
      { cards: [c('C', 8, 0)] },
    ];
    const s = computeNTTrumpState(hand, 0, [], [], cfg2, false, [],
      currentPlays, 3);
    // P0 (self) has no trump in hand → void
    expect(s.playersWithNoTrump.has(0)).toBe(true);
    // H-2-0 played, other H-2 unseen → count=1
    expect(cnt(s.possibleTrumps[1], 'H-2')).toBe(1);
    expect(cnt(s.possibleTrumps[2], 'H-2')).toBe(1);
  });

  it('AI-2 sees AI-3 play ♥2 → P3 no longer has ♥2', () => {
    const hand = [c('H', 2, 1)];
    const currentPlays = [
      { cards: [c('H', 2, 0)] },
      { cards: [c('C', 8, 0)] },
    ];
    const s = computeNTTrumpState(hand, 1, [], [], cfg2, false, [],
      currentPlays, 3);
    expect(has(s.possibleTrumps[3], 'H', 2)).toBe(false);
    expect(s.playersWithNoTrump.has(0)).toBe(true);
    expect(s.remainingBigJokers).toBe(2);
    expect(s.remainingSmallJokers).toBe(2);
  });

  it('two players see same current trick — each from own perspective', () => {
    const hand2 = [c('H', 2, 1)];
    const hand3 = [c('S', 2, 0)];
    const currentPlays = [
      { cards: [c('H', 2, 0)] },
    ];

    // leadPlayerIndex=2: AI-3 (P2) leads ♥2
    const s2 = computeNTTrumpState(hand2, 1, [], [], cfg2, false, [],
      currentPlays, 2);
    const s3 = computeNTTrumpState(hand3, 2, [], [], cfg2, false, [],
      currentPlays, 2);

    expect(has(s2.possibleTrumps[2], 'H', 2)).toBe(false);
    expect(s3.knownTrumpsPerPlayer[2].length).toBe(1);
    expect(s3.knownTrumpsPerPlayer[2][0].id).toBe('S-2-0');
  });

  it('pair deduction: lead trump pair, follow single → no pair in current trick', () => {
    const hand: Card[] = [];
    const currentPlays = [
      { cards: [c('H', 2, 0), c('H', 2, 1)] },
      { cards: [c('S', 2, 0)] },
    ];
    const s = computeNTTrumpState(hand, 1, [], [], cfg2, false, [],
      currentPlays, 3);
    expect(s.canFormPair[0]).toBe(false);
  });

  it('pair deduction: lead trump pair, follow matching pair → CAN form pairs', () => {
    const hand: Card[] = [];
    const currentPlays = [
      { cards: [c('H', 2, 0), c('H', 2, 1)] },
      { cards: [c('D', 2, 0), c('D', 2, 1)] },
    ];
    const s = computeNTTrumpState(hand, 1, [], [], cfg2, false, [],
      currentPlays, 3);
    expect(s.canFormPair[0]).toBe(true);
  });

  it('self playing trump in current trick does not remove unseen copies', () => {
    const hand = [
      c('D', 2, 50),
      c('C', 2, 0),
      c('S', 2, 0),
    ];
    const currentPlays = [
      { cards: [c('H', 6, 0)] },
      { cards: [c('D', 3, 0)] },
      { cards: [c('D', 2, 50)] },
    ];
    const s = computeNTTrumpState(hand, 0, [], [], cfg2, false, [],
      currentPlays, 2);
    // The other D-2 should still be possible somewhere
    const hasD2 = has(s.possibleTrumps[1], 'D', 2) || has(s.possibleTrumps[4], 'D', 2);
    expect(hasD2).toBe(true);
  });

  it('full scenario: P0 leads SJ pair, P2 declarer, 12 cards per view', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 2, trumpSuit: null, level: 2 };
    const reveals: Reveal[] = [
      { playerIndex: 3, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 0, suit: null, strength: 3 },
    ];
    const trick = mockTrickWithPattern(
      [
        [c('J', Rank.SmallJoker, 50), c('J', Rank.SmallJoker, 51)],
        [c('J', Rank.BigJoker, 52), c('D', 3, 0)],
        [c('J', Rank.BigJoker, 53), c('C', 2, 70)],
        [c('H', 2, 50), c('H', 4, 0)],
      ],
      0, 0, 'pair', 1, false,
    );

    // ============================================================
    // P0 (玩家1, revealer, not declarer, hand: S2,C2,D2)
    // P1 void, P3 void. P2 not void. Bottom tracked.
    // ============================================================
    const s0 = computeNTTrumpState(
      [c('S',2,50),c('C',2,50),c('D',2,50)], 0, [trick], reveals, cfg, false, []);

    expect(s0.playersWithNoTrump.has(1)).toBe(true);
    expect(s0.playersWithNoTrump.has(3)).toBe(true);
    expect(s0.playersWithNoTrump.has(2)).toBe(false);
    expect(sumPossible(s0.possibleTrumps[1])).toBe(0);
    expect(sumPossible(s0.possibleTrumps[3])).toBe(0);
    // P2: S-2, H-2, D-2 (1 each). No C-2, no J.
    const p0p2 = s0.possibleTrumps[2]!;
    expect(sumPossible(p0p2)).toBe(3);
    expect(has(p0p2,'S',2)).toBe(true);
    expect(has(p0p2,'H',2)).toBe(true);
    expect(has(p0p2,'C',2)).toBe(false);
    expect(has(p0p2,'D',2)).toBe(true);
    expect(has(p0p2,'J',15)).toBe(false);
    expect(has(p0p2,'J',16)).toBe(false);
    // Bottom: same 3
    expect(sumPossible(s0.possibleTrumps[4])).toBe(3);
    expect(has(s0.possibleTrumps[4],'S',2)).toBe(true);
    expect(has(s0.possibleTrumps[4],'H',2)).toBe(true);
    expect(has(s0.possibleTrumps[4],'D',2)).toBe(true);

    // ============================================================
    // P1 (AI-2, not declarer, post-trick: 0 trump)
    // ============================================================
    const s1 = computeNTTrumpState([], 1, [trick], reveals, cfg, false, []);

    expect(s1.playersWithNoTrump.has(1)).toBe(true);
    expect(s1.playersWithNoTrump.has(3)).toBe(true);
    expect(s1.playersWithNoTrump.has(0)).toBe(false);
    expect(s1.playersWithNoTrump.has(2)).toBe(false);
    expect(sumPossible(s1.possibleTrumps[3])).toBe(0);
    // P0: all 6 unseen trumps. No Jokers.
    const p1p0 = s1.possibleTrumps[0]!;
    expect(sumPossible(p1p0)).toBe(6);
    expect(has(p1p0,'S',2)).toBe(true);
    expect(has(p1p0,'H',2)).toBe(true);
    expect(has(p1p0,'C',2)).toBe(true);
    expect(has(p1p0,'D',2)).toBe(true);
    expect(has(p1p0,'J',15)).toBe(false);
    expect(has(p1p0,'J',16)).toBe(false);
    // P2: 3 (pair dedup: C-2 played, S/D/H 1 each)
    const p1p2 = s1.possibleTrumps[2]!;
    expect(sumPossible(p1p2)).toBe(3);
    expect(has(p1p2,'S',2)).toBe(true);
    expect(has(p1p2,'H',2)).toBe(true);
    expect(has(p1p2,'C',2)).toBe(false);
    expect(has(p1p2,'D',2)).toBe(true);
    expect(has(p1p2,'J',15)).toBe(false);
    expect(has(p1p2,'J',16)).toBe(false);
    expect(cnt(p1p2,'S-2')).toBe(1);
    expect(cnt(p1p2,'D-2')).toBe(1);
    expect(cnt(p1p2,'H-2')).toBe(1);
    // Bottom: 6 unseen, pair deduction not applied
    const p1bot = s1.possibleTrumps[4]!;
    expect(sumPossible(p1bot)).toBe(6);
    expect(has(p1bot,'S',2)).toBe(true);
    expect(has(p1bot,'H',2)).toBe(true);
    expect(has(p1bot,'C',2)).toBe(true);
    expect(has(p1bot,'D',2)).toBe(true);
    expect(has(p1bot,'J',15)).toBe(false);
    expect(has(p1bot,'J',16)).toBe(false);
    expect(cnt(p1bot,'S-2')).toBe(2);
    expect(cnt(p1bot,'D-2')).toBe(2);
    expect(cnt(p1bot,'H-2')).toBe(1);
    expect(cnt(p1bot,'C-2')).toBe(1);
    // P1→P0 pair inference
    expect(cnt(p1p0,'S-2')).toBe(2);
    expect(cnt(p1p0,'D-2')).toBe(2);
    expect(cnt(p1p0,'H-2')).toBe(1);
    expect(cnt(p1p0,'C-2')).toBe(1);
    expect(cnt(p1p0,'J-15')).toBe(0);
    expect(cnt(p1p0,'J-16')).toBe(0);

    // ============================================================
    // P2 (AI-3, declarer, hand: H2,S2,D2, bottom known empty)
    // ============================================================
    const s2 = computeNTTrumpState(
      [c('H',2,70),c('S',2,70),c('D',2,70)], 2, [trick], reveals, cfg, true, []);

    expect(s2.possibleTrumps[4]).toBeNull();
    expect(s2.playersWithNoTrump.has(1)).toBe(true);
    expect(s2.playersWithNoTrump.has(3)).toBe(true);
    expect(s2.playersWithNoTrump.has(0)).toBe(false);
    expect(sumPossible(s2.possibleTrumps[1])).toBe(0);
    expect(sumPossible(s2.possibleTrumps[3])).toBe(0);
    // P0: S-2, C-2, D-2 (1 each). No H-2, no J.
    const p2p0 = s2.possibleTrumps[0]!;
    expect(sumPossible(p2p0)).toBe(3);
    expect(has(p2p0,'S',2)).toBe(true);
    expect(has(p2p0,'H',2)).toBe(false);
    expect(has(p2p0,'C',2)).toBe(true);
    expect(has(p2p0,'D',2)).toBe(true);
    expect(has(p2p0,'J',15)).toBe(false);
    expect(has(p2p0,'J',16)).toBe(false);

    // ============================================================
    // P3 (AI-4, not declarer, post-trick: 0 trump)
    // ============================================================
    const s3 = computeNTTrumpState([], 3, [trick], reveals, cfg, false, []);

    expect(s3.playersWithNoTrump.has(1)).toBe(true);
    expect(s3.playersWithNoTrump.has(3)).toBe(true);
    expect(s3.playersWithNoTrump.has(0)).toBe(false);
    expect(s3.playersWithNoTrump.has(2)).toBe(false);
    expect(sumPossible(s3.possibleTrumps[1])).toBe(0);
    // P0: 6 unseen, no Jokers.
    const p3p0 = s3.possibleTrumps[0]!;
    expect(sumPossible(p3p0)).toBe(6);
    expect(has(p3p0,'S',2)).toBe(true);
    expect(has(p3p0,'H',2)).toBe(true);
    expect(has(p3p0,'C',2)).toBe(true);
    expect(has(p3p0,'D',2)).toBe(true);
    expect(has(p3p0,'J',15)).toBe(false);
    expect(has(p3p0,'J',16)).toBe(false);
    // P2: pair dedup→1/rank
    const p3p2 = s3.possibleTrumps[2]!;
    expect(sumPossible(p3p2)).toBe(2); // S-2 and D-2, no H-2, no C-2
    expect(has(p3p2,'S',2)).toBe(true);
    expect(has(p3p2,'H',2)).toBe(false);
    expect(has(p3p2,'C',2)).toBe(false);
    expect(has(p3p2,'D',2)).toBe(true);
    expect(has(p3p2,'J',15)).toBe(false);
    expect(has(p3p2,'J',16)).toBe(false);
    expect(cnt(p3p2,'S-2')).toBe(1);
    expect(cnt(p3p2,'D-2')).toBe(1);
    // Bottom: 6 unseen, no pair deduction
    const p3bot = s3.possibleTrumps[4]!;
    expect(sumPossible(p3bot)).toBe(6);
    expect(has(p3bot,'S',2)).toBe(true);
    expect(has(p3bot,'H',2)).toBe(true);
    expect(has(p3bot,'C',2)).toBe(true);
    expect(has(p3bot,'D',2)).toBe(true);
    expect(has(p3bot,'J',15)).toBe(false);
    expect(has(p3bot,'J',16)).toBe(false);
    expect(cnt(p3bot,'S-2')).toBe(2);
    expect(cnt(p3bot,'D-2')).toBe(2);
    expect(cnt(p3bot,'H-2')).toBe(1);
    expect(cnt(p3bot,'C-2')).toBe(1);
    expect(cnt(p3p0,'S-2')).toBe(2);
    expect(cnt(p3p0,'D-2')).toBe(2);
    expect(cnt(p3p0,'H-2')).toBe(1);
    expect(cnt(p3p0,'C-2')).toBe(1);
    expect(cnt(p3p0,'J-15')).toBe(0);
    expect(cnt(p3p0,'J-16')).toBe(0);

    // Cross-perspective: played suit-ranks have 0 count
    const playedRanks = { 'J-15': 2, 'J-16': 2, 'C-2': 1, 'H-2': 1 };
    // Actually all 4 jokers and one C-2 and one H-2 were played
    // Remaining: S-2×2, H-2×1, C-2×1, D-2×2 = 6
    // Check that total across all locations sums correctly
    for (const v of [s0, s1, s2, s3]) {
      for (let p = 0; p < 5; p++) {
        const rec = v.possibleTrumps[p];
        if (!rec) continue;
        // J-15 and J-16 fully played → no location should have them
        expect(cnt(rec, 'J-15')).toBe(0);
        expect(cnt(rec, 'J-16')).toBe(0);
      }
    }
  });

  it('trick 2: P0 kills off-suit with D2, P2 follows off-suit (no trump)', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 2, trumpSuit: null, level: 2 };
    const reveals: Reveal[] = [
      { playerIndex: 3, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 0, suit: null, strength: 3 },
    ];
    const t1 = mockTrickWithPattern(
      [
        [c('J', Rank.SmallJoker, 50), c('J', Rank.SmallJoker, 51)],
        [c('J', Rank.BigJoker, 52), c('D', 3, 0)],
        [c('J', Rank.BigJoker, 53), c('C', 2, 70)],
        [c('H', 2, 50), c('H', 4, 0)],
      ],
      0, 0, 'pair', 1, false,
    );
    const t2 = mockTrick(
      [
        [c('S', 14, 200)],  // P3 leads ♠A
        [c('D', 2, 50)],    // P0 kills with D2
        [c('S', 13, 0)],    // P1 discards ♠K
        [c('S', 3, 0)],     // P2 follows ♠3
      ],
      3, 0,
    );

    const s0 = computeNTTrumpState([c('S',2,50),c('C',2,50)], 0, [t1,t2], reveals, cfg, false, []);
    const s1 = computeNTTrumpState([], 1, [t1,t2], reveals, cfg, false, []);
    const s2 = computeNTTrumpState([c('H',2,70),c('S',2,70),c('D',2,70)], 2, [t1,t2], reveals, cfg, true, [] as Card[]);
    const s3 = computeNTTrumpState([], 3, [t1,t2], reveals, cfg, false, []);

    // === P0 (hand S2,C2) ===
    expect(s0.playersWithNoTrump.has(1)).toBe(true);
    expect(s0.playersWithNoTrump.has(3)).toBe(true);
    expect(s0.playersWithNoTrump.has(2)).toBe(false);
    expect(sumPossible(s0.possibleTrumps[1])).toBe(0);
    expect(sumPossible(s0.possibleTrumps[3])).toBe(0);
    const p0p2 = s0.possibleTrumps[2]!;
    expect(sumPossible(p0p2)).toBe(2);
    expect(has(p0p2,'S',2)).toBe(true);
    expect(has(p0p2,'H',2)).toBe(true);
    expect(has(p0p2,'C',2)).toBe(false);
    expect(has(p0p2,'D',2)).toBe(false);
    expect(has(p0p2,'J',15)).toBe(false);
    expect(has(p0p2,'J',16)).toBe(false);
    const p0bot = s0.possibleTrumps[4]!;
    expect(sumPossible(p0bot)).toBe(3);
    expect(has(p0bot,'S',2)).toBe(true);
    expect(has(p0bot,'H',2)).toBe(true);
    expect(has(p0bot,'D',2)).toBe(true);

    // === P1 (void) ===
    expect(s1.playersWithNoTrump.has(1)).toBe(true);
    expect(s1.playersWithNoTrump.has(3)).toBe(true);
    expect(s1.playersWithNoTrump.has(0)).toBe(false);
    expect(s1.playersWithNoTrump.has(2)).toBe(false);
    expect(sumPossible(s1.possibleTrumps[3])).toBe(0);
    const p1p0 = s1.possibleTrumps[0]!;
    expect(sumPossible(p1p0)).toBe(5);
    expect(has(p1p0,'S',2)).toBe(true);
    expect(has(p1p0,'H',2)).toBe(true);
    expect(has(p1p0,'C',2)).toBe(true);
    expect(has(p1p0,'D',2)).toBe(true);
    expect(has(p1p0,'J',15)).toBe(false);
    expect(has(p1p0,'J',16)).toBe(false);
    const p1p2 = s1.possibleTrumps[2]!;
    expect(sumPossible(p1p2)).toBe(2);
    expect(has(p1p2,'S',2)).toBe(true);
    expect(has(p1p2,'H',2)).toBe(true);
    expect(has(p1p2,'C',2)).toBe(false);
    expect(has(p1p2,'D',2)).toBe(false);
    expect(has(p1p2,'J',15)).toBe(false);
    expect(has(p1p2,'J',16)).toBe(false);
    const p1bot = s1.possibleTrumps[4]!;
    expect(sumPossible(p1bot)).toBe(5);
    expect(has(p1bot,'S',2)).toBe(true);
    expect(has(p1bot,'H',2)).toBe(true);
    expect(has(p1bot,'C',2)).toBe(true);
    expect(has(p1bot,'D',2)).toBe(true);
    expect(has(p1bot,'J',15)).toBe(false);
    expect(has(p1bot,'J',16)).toBe(false);
    expect(cnt(p1p0,'S-2')).toBe(2);
    expect(cnt(p1p0,'D-2')).toBe(1);
    expect(cnt(p1p0,'H-2')).toBe(1);
    expect(cnt(p1p0,'C-2')).toBe(1);
    expect(cnt(p1p2,'S-2')).toBe(1);
    expect(cnt(p1p2,'H-2')).toBe(1);

    // === P2 (declarer, hand H2,S2,D2) ===
    expect(s2.possibleTrumps[4]).toBeNull();
    expect(s2.playersWithNoTrump.has(1)).toBe(true);
    expect(s2.playersWithNoTrump.has(3)).toBe(true);
    expect(s2.playersWithNoTrump.has(0)).toBe(false);
    expect(sumPossible(s2.possibleTrumps[1])).toBe(0);
    expect(sumPossible(s2.possibleTrumps[3])).toBe(0);
    const p2p0 = s2.possibleTrumps[0]!;
    expect(sumPossible(p2p0)).toBe(2);
    expect(has(p2p0,'S',2)).toBe(true);
    expect(has(p2p0,'C',2)).toBe(true);
    expect(has(p2p0,'H',2)).toBe(false);
    expect(has(p2p0,'D',2)).toBe(false);
    expect(has(p2p0,'J',15)).toBe(false);
    expect(has(p2p0,'J',16)).toBe(false);

    // === P3 (void) ===
    expect(s3.playersWithNoTrump.has(1)).toBe(true);
    expect(s3.playersWithNoTrump.has(3)).toBe(true);
    expect(s3.playersWithNoTrump.has(0)).toBe(false);
    expect(s3.playersWithNoTrump.has(2)).toBe(false);
    expect(sumPossible(s3.possibleTrumps[1])).toBe(0);
    const p3p0 = s3.possibleTrumps[0]!;
    expect(sumPossible(p3p0)).toBe(5);
    expect(has(p3p0,'S',2)).toBe(true);
    expect(has(p3p0,'H',2)).toBe(true);
    expect(has(p3p0,'C',2)).toBe(true);
    expect(has(p3p0,'D',2)).toBe(true);
    expect(has(p3p0,'J',15)).toBe(false);
    expect(has(p3p0,'J',16)).toBe(false);
    const p3p2 = s3.possibleTrumps[2]!;
    expect(sumPossible(p3p2)).toBe(1);
    expect(has(p3p2,'S',2)).toBe(true);
    expect(has(p3p2,'H',2)).toBe(false);
    expect(has(p3p2,'C',2)).toBe(false);
    expect(has(p3p2,'D',2)).toBe(false);
    expect(has(p3p2,'J',15)).toBe(false);
    expect(has(p3p2,'J',16)).toBe(false);
    const p3bot = s3.possibleTrumps[4]!;
    expect(sumPossible(p3bot)).toBe(5);
    expect(has(p3bot,'S',2)).toBe(true);
    expect(has(p3bot,'H',2)).toBe(true);
    expect(has(p3bot,'C',2)).toBe(true);
    expect(has(p3bot,'D',2)).toBe(true);
    expect(has(p3bot,'J',15)).toBe(false);
    expect(has(p3bot,'J',16)).toBe(false);
    expect(cnt(p3p0,'S-2')).toBe(2);
    expect(cnt(p3p0,'D-2')).toBe(1);
  });
});


// ================================================================
// Full save-file scenario: 5 tricks, AI-3 view, AI-2 has BJ
// ================================================================
describe('save scenario: after 5 tricks, P1 has BJ', () => {
  const cfg2 = ntCfg(2, 0);
  function cc(s: string, r: number, idx: number): Card { return createCard(s as any, r as any, idx); }

  it('from P2 view after 5 tricks: P1 has BJ in possible list', () => {
    const reveals: Reveal[] = [{ playerIndex: 0, suit: null, strength: 3 }];
    const prior: Trick[] = [
      mockTrick([[cc('H',14,79)],[cc('H',7,72)],[cc('H',3,14)],[cc('H',6,71)]],0,0),
      mockTrick([[cc('D',14,105)],[cc('D',6,43)],[cc('D',13,50)],[cc('D',3,40)]],0,0),
      mockTrick([[cc('C',14,38),cc('C',14,92),cc('C',13,37),cc('C',13,91)],[cc('C',12,90),cc('C',12,36),cc('C',4,82),cc('C',6,30)],[cc('C',9,87),cc('C',6,84),cc('C',3,81),cc('D',5,42)],[cc('C',4,28),cc('C',8,86),cc('C',9,33),cc('C',11,35)]],0,0),
      mockTrick([[cc('C',11,89),cc('C',10,34),cc('C',10,88)],[cc('C',5,29),cc('C',7,31),cc('C',8,32)],[cc('D',10,101),cc('S',10,8),cc('D',3,94)],[cc('C',5,83),cc('S',4,2),cc('D',4,95)]],0,0),
    ];
    const trick5 = mockTrickWithPattern([
      [cc('J',15,106),cc('J',15,52)],[cc('S',2,0),cc('C',2,80)],[cc('H',2,13),cc('H',2,67)],[cc('J',16,107),cc('D',6,97)],
    ],0,0,'pair',1,false);
    const myHand = [cc('D',2,93),cc('H',5,70),cc('S',9,5),cc('S',12,10),cc('S',7,4),cc('S',6,3),cc('H',12,22),cc('H',8,19),cc('S',13,11),cc('D',8,46),cc('H',11,21),cc('H',10,20),cc('D',7,45),cc('H',4,15),cc('H',9,69),cc('S',4,2),cc('S',9,56),cc('D',12,48),cc('S',8,6)];
    const s = computeNTTrumpState(myHand,2,[...prior,trick5],reveals,cfg2,false,[]);
    expect(s.playersWithNoTrump.has(3)).toBe(true);
    // P1 has BJ (J-16) in possible list
    expect(cnt(s.possibleTrumps[1], 'J-16')).toBeGreaterThan(0);
  });
});
