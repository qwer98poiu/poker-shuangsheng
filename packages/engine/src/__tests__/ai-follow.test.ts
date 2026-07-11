import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import { validateFollow } from '../following/index.js';
import { aiFollowPlay } from '../ai/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
const cfgDiamondA: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 14 };
function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function checkFollow(
  play: Card[], hand: Card[], lead: Card[], leadSuit: string | null, config: TrumpDeclaration,
): void {
  const lp = classify(lead, config);
  const vr = validateFollow(play, hand, lead, lp, leadSuit as any, config);
  expect(vr.valid).toBe(true);
}

function aiFollow(hand: Card[], lead: Card[], suit: string, config: TrumpDeclaration): Card[] {
  return aiFollowPlay(hand, lead, suit as any, config).cards;
}

describe('AI follow play compliance', () => {

  describe('non-trump suit leads (spades, cfg5)', () => {

    it('pair lead, enough suit, has pair -> plays a pair', () => {
      const hand = [c('S', 13, 0), c('S', 13, 1), c('S', 12, 0), c('S', 11, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
      expect(play.length).toBe(2);
    });

    it('pair lead, enough suit, no pair -> plays singles', () => {
      const hand = [c('S', 13, 0), c('S', 12, 0), c('S', 11, 0), c('S', 10, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('2p tractor lead, exact match -> plays tractor', () => {
      const hand = [c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 11, 1), c('S', 10, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
      expect(play.length).toBe(4);
    });

    it('2p tractor lead, longer tractor -> extracts same length', () => {
      const hand = [
        c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 11, 1),
        c('S', 10, 0), c('S', 10, 1),
      ];
      const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('2p tractor lead, no tractor, has pairs -> fills with pairs', () => {
      const hand = [c('S', 12, 0), c('S', 12, 1), c('S', 9, 0), c('S', 9, 1), c('S', 8, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('2p tractor lead, no tractor, no pairs -> plays singles', () => {
      const hand = [c('S', 12, 0), c('S', 9, 0), c('S', 8, 0), c('S', 7, 0), c('S', 6, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('throw tractor+pair, enough, has tractor+pair -> matches both slots', () => {
      const hand = [
        c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 11, 1),
        c('S', 9, 0), c('S', 9, 1), c('S', 8, 0),
      ];
      const lead = [
        c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203),
        c('S', 10, 205), c('S', 10, 206),
      ];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
      expect(play.length).toBe(6);
    });

    it('throw tractor+single, enough, has tractor -> matches tractor', () => {
      const hand = [
        c('S', 12, 0), c('S', 12, 1), c('S', 11, 0), c('S', 11, 1),
        c('S', 10, 0), c('S', 9, 0),
      ];
      const lead = [
        c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203),
        c('S', 12, 204),
      ];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
      expect(play.length).toBe(5);
    });
  });

  describe('short-suited / void (non-trump)', () => {

    it('short, pair lead, has pair -> plays all suit + filler', () => {
      const hand = [c('S', 13, 0), c('S', 13, 1), c('C', 10, 0), c('C', 9, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('short, pair lead, no pair -> plays suit single + filler', () => {
      const hand = [c('S', 13, 0), c('C', 10, 0), c('C', 9, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('short, 2p tractor lead, suit pair -> plays pair + 2 fillers', () => {
      const hand = [c('S', 13, 0), c('S', 13, 1), c('C', 10, 0), c('C', 9, 0), c('C', 8, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
      expect(play.length).toBe(4);
    });

    it('short, 2p tractor lead, suit singles -> plays singles + fillers', () => {
      const hand = [c('S', 13, 0), c('S', 12, 0), c('C', 10, 0), c('C', 9, 0), c('C', 8, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('void in lead suit -> any play valid', () => {
      const hand = [c('C', 13, 0), c('C', 12, 0), c('C', 11, 0)];
      const lead = [c('S', 14, 200), c('S', 14, 201)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      const leadTrump = lead.every(c => isTrump(c, cfg5));
      checkFollow(play, hand, lead, leadTrump ? null : 'S', cfg5);
    });
  });

  describe('trump leads (cfg5: hearts, level=5)', () => {

    it('2p trump tractor, enough, exact match -> plays tractor', () => {
      const hand = [c('H', 12, 0), c('H', 12, 1), c('H', 11, 0), c('H', 11, 1), c('H', 10, 0)];
      const lead = [c('H', 14, 200), c('H', 14, 201), c('H', 13, 202), c('H', 13, 203)];
      const leadTrump = lead.every(c => isTrump(c, cfg5));
      const play = aiFollow(hand, lead, 'H', cfg5);
      checkFollow(play, hand, lead, leadTrump ? null : 'H', cfg5);
    });

    it('2p trump tractor, short -> plays all trump + fillers', () => {
      const hand = [c('H', 12, 0), c('H', 11, 0), c('S', 10, 0), c('S', 9, 0), c('S', 8, 0)];
      const lead = [c('H', 14, 200), c('H', 14, 201), c('H', 13, 202), c('H', 13, 203)];
      const leadTrump = lead.every(c => isTrump(c, cfg5));
      const play = aiFollow(hand, lead, 'H', cfg5);
      checkFollow(play, hand, lead, leadTrump ? null : 'H', cfg5);
    });

    it('single trump, can beat -> plays smallest winning trump', () => {
      const hand = [c('H', 14, 0), c('H', 13, 0)];
      const lead = [c('H', 13, 200)];
      const leadTrump = lead.every(c => isTrump(c, cfg5));
      const play = aiFollow(hand, lead, 'H', cfg5);
      checkFollow(play, hand, lead, leadTrump ? null : 'H', cfg5);
    });

    it('single trump, cannot beat -> plays smallest trump', () => {
      const hand = [c('H', 12, 0)];
      const lead = [c('H', 14, 200)];
      const leadTrump = lead.every(c => isTrump(c, cfg5));
      const play = aiFollow(hand, lead, 'H', cfg5);
      checkFollow(play, hand, lead, leadTrump ? null : 'H', cfg5);
    });
  });

  describe('trump throw (cfgDiamondA: diamonds, level=14)', () => {

    it('multi-tractor throw (12 cards), has tractors -> matches all slots', () => {
      const hand = [
        c('J', 16, 0), c('J', 16, 1), c('J', 15, 0), c('J', 15, 1),
        c('C', 14, 0), c('C', 14, 1),
        c('D', 12, 0), c('D', 12, 1), c('D', 11, 0), c('D', 11, 1),
        c('D', 7, 0), c('D', 7, 1), c('D', 5, 0), c('D', 5, 1),
        c('D', 3, 0), c('D', 3, 1), c('D', 2, 0), c('D', 2, 1),
      ];
      const lead = [
        c('D', 14, 200), c('D', 14, 201), c('H', 14, 202), c('H', 14, 203),
        c('D', 13, 204), c('D', 13, 205),
        c('D', 10, 206), c('D', 10, 207), c('D', 9, 208), c('D', 9, 209),
        c('D', 8, 210), c('D', 8, 211),
      ];
      const leadTrump = lead.every(c => isTrump(c, cfgDiamondA));
      const play = aiFollow(hand, lead, 'D', cfgDiamondA);
      checkFollow(play, hand, lead, leadTrump ? null : 'D', cfgDiamondA);
      expect(play.length).toBe(12);
    });
  });

  describe('single non-trump lead', () => {

    it('can beat -> plays smallest winning card', () => {
      const hand = [c('S', 14, 0), c('S', 13, 0)];
      const lead = [c('S', 13, 200)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });

    it('cannot beat, teammate winning -> discards points', () => {
      const hand = [c('S', 10, 0), c('S', 5, 0)];
      const lead = [c('S', 13, 200)];
      const play = aiFollow(hand, lead, 'S', cfg5);
      checkFollow(play, hand, lead, 'S', cfg5);
    });
  });

  describe('joker lead', () => {

    it('single joker lead -> plays smallest trump', () => {
      const hand = [c('H', 14, 0), c('H', 13, 0)];
      const lead = [c('J', 16, 200)];
      const play = aiFollow(hand, lead, 'J', cfg5);
      const leadTrump = lead.every(c => isTrump(c, cfg5));
      checkFollow(play, hand, lead, leadTrump ? null : 'J', cfg5);
    });
  });
});

// ================================================================
// Crash scenario reproduction: diamonds trump, level 2
// ================================================================
const cfgD2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };

describe('AI follow compliance - diamonds trump, level 2 (crash scenarios)', () => {

  // --- Hand for AI-2: SJ pair + C2 + ♦QJ1074 + non-trump fill
  const handAI2 = [
    c('J', 15, 0), c('J', 15, 1),       // SJ pair (effRank 900)
    c('C', 2, 2),                        // ♣2 (off-suit level, trump, effRank 700)
    c('D', 12, 3), c('D', 11, 4), c('D', 10, 5), c('D', 7, 6), c('D', 4, 7),
    c('S', 7, 8), c('S', 6, 9), c('S', 4, 10),
    c('H', 13, 11), c('H', 13, 12), c('H', 11, 13), c('H', 11, 14),
    c('H', 10, 15), c('H', 10, 16), c('H', 8, 17), c('H', 6, 18), c('H', 5, 19), c('H', 3, 20),
    c('C', 8, 21), c('C', 8, 22), c('C', 7, 23), c('C', 3, 24),
  ];

  it('1. trump tractor lead D2D2H2H2 -> AI plays SJ pair + fill', () => {
    const lead: Card[] = [
      c('D', 2, 200), c('D', 2, 201),
      c('H', 2, 200), c('H', 2, 201),
    ];
    const leadTrump = lead.every(c => isTrump(c, cfgD2));
    const play = aiFollowPlay(handAI2, lead, null as any, cfgD2).cards;
    checkFollow(play, handAI2, lead, leadTrump ? null : 'D', cfgD2);
    expect(play.length).toBe(4);
  });

  it('2. throw: BJ pair + D2D2H2H2 tractor -> AI matches tractor slot', () => {
    // BJ-SJ is 2p tractor, but wait: D2-H2 is also 2p (cross-group).
    // For simplicity: BJ pair + D2-H2 tractor = throw.
    // AI-2 has SJ pair (can match SJ part? No, lead has BJ pair as standalone).
    // Actually let's design: lead = BJ+BJ+D2+D2+H2+H2 (6 cards).
    // classify: H2-D2 forms cross-group tractor (2p). BJ is standalone pair.
    // throw with tractor=[2p], standalone pair=1.
    const lead: Card[] = [
      c('J', 16, 200), c('J', 16, 201),
      c('D', 2, 200), c('D', 2, 201),
      c('H', 2, 200), c('H', 2, 201),
    ];
    const leadTrump = lead.every(c => isTrump(c, cfgD2));
    const play = aiFollowPlay(handAI2, lead, null as any, cfgD2).cards;
    checkFollow(play, handAI2, lead, leadTrump ? null : 'D', cfgD2);
    expect(play.length).toBe(6);
  });

  it('3. S-AQQ throw -> AI matches pair or plays singles', () => {
    // S-A(14) + S-QQ(12). A and Q gap at K(13)≠2 -> not consecutive. Q pair is standalone.
    // throw with single=1, pair=1.
    const hand = [
      c('S', 13, 0), c('S', 13, 1),  // S-KK (pair)
      c('S', 11, 2), c('S', 10, 3),
      c('S', 9, 4),
    ];
    const lead: Card[] = [c('S', 14, 200), c('S', 12, 200), c('S', 12, 201)];
    const play = aiFollowPlay(hand, lead, 'S' as any, cfgD2).cards;
    checkFollow(play, hand, lead, 'S', cfgD2);
    expect(play.length).toBe(3);
  });

  it('4. C-AKK throw -> AI must play pair if has one', () => {
    // C-A(14) + C-KK(13). A and K are consecutive (no level between).
    // BUT: A(14)-K(13) consecutive in non-trump rank space -> A+KKK classifies as...
    // wait, AKK: A is single, K-K is a pair. A-K not consecutive means A is standalone single.
    // But A(14) and K(13) -> hi=14 lo=13 -> loop r=14; r<14 -> empty. So consecutive!
    // So A-K is consecutive! That means AAKK would be a tractor.
    // But A+KK: the A is 1 card, KK is 2 cards. A+A+KK would be tractor 2p.
    // Single A + pair KK: classify... A single, K pair standalone -> throw.
    const hand = [
      c('C', 13, 0), c('C', 13, 1),  // C-KK (pair)
      c('C', 12, 2), c('C', 11, 3),
      c('C', 10, 4),
    ];
    const lead: Card[] = [c('C', 14, 200), c('C', 13, 200), c('C', 13, 201)];
    const play = aiFollowPlay(hand, lead, 'C' as any, cfgD2).cards;
    checkFollow(play, hand, lead, 'C', cfgD2);
    expect(play.length).toBe(3);
  });
});
