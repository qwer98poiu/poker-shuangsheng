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

// ================================================================
// Position-aware point adding (third/fourth position + teammate wins)
// Reproduces the bug: AI-3 (third position, declarer partner) did not add
// points when declarer led C-AAK throw.
// ================================================================
describe('position-aware point adding (diamonds trump, level=2)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  // P0 has C-A-A-K (2 decks: 2xA total, 2xK total). P0 leads AAK throw.
  // Remaining clubs: 0xA, 1xK (P0 has 1), plus J-3. P0 also has Q,9,9,6,6,4,4.
  const leadAAK: Card[] = [cc('C', 14, 200), cc('C', 14, 201), cc('C', 13, 200)];
  const bestP0 = { cards: leadAAK, playerIdx: 0 };

  describe('third position, teammate wins with max pattern', () => {
    it('adds points when lead is throw (AAK), has 10-10 + K + 5 + 3', () => {
      // P0 has AAK -> at most 1xK left. AI-3 (P2, declarer partner) has:
      // C-10-10 (pair, 20pts) + C-K (10pts) + C-5 (5pts) + C-3 + fillers.
      const hand = [
        cc('C', 10, 0), cc('C', 10, 1),  // 10-10 pair (20 pts)
        cc('C', 13, 1),                    // single K (10 pts, P0 has the other)
        cc('C', 5, 0),                     // 5 (5 pts)
        cc('C', 3, 0),                     // 3
        cc('H', 8, 0), cc('H', 7, 0),     // other suits
      ];
      const r = aiFollowPlay(hand, leadAAK, 'C', cfg, bestP0, 2);
      checkFollow(r.cards, hand, leadAAK, 'C', cfg);
      expect(r.cards.length).toBe(3);
      // Third + throw -> canAddPoints. Should prefer 10-10 pair + K single (30 pts)
      // over 10-10 pair + 3 single (20 pts).
      const ranks = r.cards.map(c => c.rank).sort((a, b) => a - b);
      // Should include K (13) — the max point filler
      expect(ranks).toContain(13);
    });

    it('adds points when lead is max pair (AA), has KK pair', () => {
      // P0 has AA -> 0xA left. AI-3 has KK (20 pts) + 5 (5 pts).
      const leadAA: Card[] = [cc('C', 14, 200), cc('C', 14, 201)];
      const bestAA = { cards: leadAA, playerIdx: 0 };
      const hand = [
        cc('C', 13, 0), cc('C', 13, 1),  // KK (20 pts, P0 has no K)
        cc('C', 5, 0),                     // 5 (5 pts)
        cc('H', 8, 0),
      ];
      const r = aiFollowPlay(hand, leadAA, 'C', cfg, bestAA, 2);
      checkFollow(r.cards, hand, leadAA, 'C', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toContain('唯一可出');
      // Should play KK (20 pts), not 5+something
      const ranks = r.cards.map(c => c.rank);
      expect(ranks.filter(r => r === 13).length).toBe(2);
    });

    it('adds points when lead is single big off-suit card (A)', () => {
      // P0 leads C-A (max off-suit single). P0 has 2xA total, 1 led.
      // AI-3 has K (10pts), 5 (5pts), 3 (non-point).
      const leadA: Card[] = [cc('C', 14, 200)];
      const bestA = { cards: leadA, playerIdx: 0 };
      const hand = [
        cc('C', 13, 0),  // K (10 pts, P0 has the other K? No, P0 has AAK - 1 K.)
        // Actually P0 has 1 K. Other K is available. AI-3 can have it.
        cc('C', 5, 0),   // 5 (5 pts)
        cc('C', 3, 0),   // 3 (non-point)
        cc('H', 8, 0),
      ];
      const r = aiFollowPlay(hand, leadA, 'C', cfg, bestA, 2);
      checkFollow(r.cards, hand, leadA, 'C', cfg);
      expect(r.cards.length).toBe(1);
      // Lead is single A -> big off-suit card -> canAddPoints. Should play K.
      expect(r.cards[0].rank).toBe(13);
    });
  });

  describe('third position, teammate wins but lead is NOT max pattern', () => {
    it('does NOT add points when third and lead is small card', () => {
      // P0 leads C-9 (small). P1 plays C-8, P0 still wins (no one beat).
      // P2 is third, teammate winning but lead is small -> canAddPoints false.
      const lead9: Card[] = [cc('C', 9, 200)];
      const bestP0b = { cards: lead9, playerIdx: 0 };
      const hand = [
        cc('C', 13, 0),  // K (10 pts)
        cc('C', 8, 0),   // 8
        cc('C', 3, 0),   // 3
        cc('H', 6, 0),
      ];
      const r = aiFollowPlay(hand, lead9, 'C', cfg, bestP0b, 2);
      checkFollow(r.cards, hand, lead9, 'C', cfg);
      expect(r.cards.length).toBe(1);
      // Lead is small (9 not max), so third+tmWin = NO annotation
      expect(r.reason).not.toContain('加分');
      expect(r.reason).not.toContain('不加分');
    });
  });

});

// ================================================================
// Short-suited fill reason accuracy
// ================================================================
describe('short-suited fill reason (diamonds trump, level=2)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  it('uses "同花色不够，垫其他花色" when fillers contain other suits but no trump', () => {
    // Lead C-9-9 pair. AI has C-Q (1 club) + H-3, H-6 (other suits, no trump).
    const hand = [
      cc('C', 12, 0),  // C-Q
      cc('H', 3, 0),   // H-3
      cc('H', 6, 0),   // H-6
    ];
    const lead: Card[] = [cc('C', 9, 200), cc('C', 9, 201)];
    const r = aiFollowPlay(hand, lead, 'C', cfg);
    checkFollow(r.cards, hand, lead, 'C', cfg);
    expect(r.cards.length).toBe(2);
    expect(r.reason).toBe('同花色不够，垫其他花色');
  });

  it('uses "同花色不够，垫主牌" when all fillers are trump', () => {
    // Lead C-9-9 pair. AI has C-Q (1 club) + only trump cards to fill.
    // fillerSort prefers non-trump first, so with only trump fillers -> trump.
    const hand = [
      cc('C', 12, 0),  // C-Q
      cc('D', 7, 0),   // D-7 (trump)
      cc('D', 8, 0),   // D-8 (trump)
      cc('D', 9, 0),   // D-9 (trump)
      cc('D', 10, 0),  // D-10 (trump)
    ];
    const lead: Card[] = [cc('C', 9, 200), cc('C', 9, 201)];
    const r = aiFollowPlay(hand, lead, 'C', cfg);
    checkFollow(r.cards, hand, lead, 'C', cfg);
    expect(r.cards.length).toBe(2);
    expect(r.reason).toBe('同花色不够，垫主牌');
  });

  it('uses "垫同花色" when following a throw with enough lead-suit cards but cannot match pattern', () => {
    // Lead C-A-A-K (throw: A pair + K single). AI has 3 clubs but no pairs:
    // C-Q, C-8, C-7 — all singles, can match single slot but not the pair.
    // All 3 cards are same suit as lead -> "垫同花色".
    const hand = [
      cc('C', 12, 0), cc('C', 8, 0), cc('C', 7, 0),  // all clubs, no pairs
      cc('H', 3, 0), cc('H', 6, 0),
    ];
    const leadAAK: Card[] = [cc('C', 14, 200), cc('C', 14, 201), cc('C', 13, 200)];
    const r = aiFollowPlay(hand, leadAAK, 'C', cfg);
    checkFollow(r.cards, hand, leadAAK, 'C', cfg);
    expect(r.cards.length).toBe(3);
    // All played cards are clubs (lead suit), can't match pattern (no pair)
    expect(r.reason).toBe('垫同花色');
  });
});

// ================================================================
// Trump kill validity: every "毙" reason must actually beat
// ================================================================
describe('trump kill validity (hearts trump, level=5)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
  function c2(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  describe('single lead, void in suit, can beat', () => {
    it('kills off-suit A with smallest trump - "用主牌毙"', () => {
      const lead: Card[] = [c2('S', 14, 200)];
      const best = { cards: lead, playerIdx: 0 };
      // void in spades: only trump + other suits
      const hand = [c2('H', 3, 0), c2('C', 9, 0), c2('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].id).toBe(c2('H', 3, 0).id);
      expect(r.reason).toBe('用主牌毙');
    });

    it('kills single K - no overkill, "用主牌毙"', () => {
      const lead: Card[] = [c2('S', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [c2('H', 4, 0), c2('C', 9, 0), c2('D', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toBe('用主牌毙');
    });
  });

  describe('single lead, void, best already trumped, cannot beat', () => {
    it('discards when trump is too small', () => {
      // P1 already killed S-A with H-A (effRank=614). AI=P2 has H-3 (603).
      const lead: Card[] = [c2('S', 14, 200)];
      const best = { cards: [c2('H', 14, 0)], playerIdx: 1 };
      const hand = [c2('H', 3, 0), c2('C', 9, 0), c2('C', 8, 0), c2('D', 6, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.reason).not.toContain('毙');
      expect(r.reason).toContain('垫');
    });
  });

  describe('fourth position pair follow: prefer point cards when beating', () => {
    // diamonds trump, level=2, P0 declarer
    const cfg4: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
    const lead88 = [c2('C', 8, 200), c2('C', 8, 201)];
    const best88 = { cards: lead88, playerIdx: 0 };

    it('beats with point pair (10-10) when smallest pair (4-4) cannot beat', () => {
      // 4-4 (rank 4) cannot beat 8-8. AI should scan and find 10-10.
      const hand = [
        c2('C', 4, 0), c2('C', 4, 1),   // 4-4 pair (non-point, cannot beat 8-8)
        c2('C', 10, 0), c2('C', 10, 1),  // 10-10 pair (point, 20pts, can beat)
        c2('H', 8, 0), c2('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead88, 'C', cfg4, best88, 3);
      checkFollow(r.cards, hand, lead88, 'C', cfg4);
      expect(r.cards.length).toBe(2);
      // Should pick 10-10 (only beating pair)
      expect(r.cards.every(c => c.rank === 10)).toBe(true);
    });

    it('beats with smallest non-point pair when no point pair available', () => {
      const hand = [
        c2('C', 9, 0), c2('C', 9, 1),   // 9-9 pair (non-point, beats 8-8)
        c2('C', 12, 0), c2('C', 12, 1),  // Q-Q pair (non-point, beats 8-8)
        c2('H', 8, 0), c2('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead88, 'C', cfg4, best88, 3);
      checkFollow(r.cards, hand, lead88, 'C', cfg4);
      expect(r.cards.length).toBe(2);
      // Should pick smallest beating non-point pair (9-9)
      expect(r.cards.every(c => c.rank === 9)).toBe(true);
    });

    it('scans for beating pair when smallest pair cannot beat', () => {
      // Smallest pair 3-3 cannot beat 8-8, but 9-9 can
      const hand = [
        c2('C', 3, 0), c2('C', 3, 1),   // 3-3 pair (cannot beat 8-8)
        c2('C', 9, 0), c2('C', 9, 1),   // 9-9 pair (can beat 8-8)
        c2('C', 5, 0),                    // single
        c2('H', 8, 0), c2('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead88, 'C', cfg4, best88, 3);
      checkFollow(r.cards, hand, lead88, 'C', cfg4);
      expect(r.cards.length).toBe(2);
      // Should pick 9-9 (beats) over 3-3 (cannot)
      expect(r.cards.every(c => c.rank === 9)).toBe(true);
    });

    it('scans for beating pair, prefers point when fourth and beating is possible', () => {
      // Smallest pair 3-3 cannot beat 8-8. Both 9-9 and 10-10 can beat.
      // Fourth should pick 10-10 (point) over 9-9 (non-point).
      const hand = [
        c2('C', 3, 0), c2('C', 3, 1),   // 3-3 pair (cannot beat)
        c2('C', 9, 0), c2('C', 9, 1),   // 9-9 pair (non-point)
        c2('C', 10, 0), c2('C', 10, 1), // 10-10 pair (point)
        c2('H', 8, 0), c2('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead88, 'C', cfg4, best88, 3);
      checkFollow(r.cards, hand, lead88, 'C', cfg4);
      expect(r.cards.length).toBe(2);
      // Should pick 10-10 (point, beating) over 9-9 (non-point, beating)
      expect(r.cards.every(c => c.rank === 10)).toBe(true);
    });

  });

  describe('pair lead, void, can beat', () => {
    it('kills off-suit pair with smallest trump pair - "用主牌毙"', () => {
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      // void in spades: trump pair + other suits
      const hand = [c2('H', 3, 0), c2('H', 3, 1), c2('C', 8, 0), c2('D', 7, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toBe('用主牌毙');
    });
  });

  describe('pair lead, void, cannot beat', () => {
    it('discards when trump pair exists but too small', () => {
      // P1 killed S-9-9 with H-AA (effRank=614). AI has H-3-3 (603).
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: [c2('H', 14, 0), c2('H', 14, 1)], playerIdx: 1 };
      const hand = [c2('H', 3, 0), c2('H', 3, 1), c2('C', 8, 0), c2('D', 7, 0), c2('D', 6, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).not.toContain('毙');
    });

    it('discards when trump has singles but no pair for pair lead', () => {
      // trump=3 >= leadLen=2, but no trump pair -> cannot kill pair lead.
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [c2('H', 3, 0), c2('H', 4, 0), c2('H', 6, 0), c2('C', 8, 0), c2('D', 7, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).not.toContain('毙');
    });
  });

  describe('tractor lead, void, can beat', () => {
    it('kills off-suit tractor with trump tractor - "用主牌毙"', () => {
      // S-QQ+JJ (Q=12,J=11 consecutive). H-AA+KK (A=14,K=13 consecutive).
      const lead: Card[] = [
        c2('S', 12, 200), c2('S', 12, 201), c2('S', 11, 200), c2('S', 11, 201),
      ];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 14, 0), c2('H', 14, 1), c2('H', 13, 0), c2('H', 13, 1),
        c2('C', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(4);
      expect(r.reason).toBe('用主牌毙');
    });
  });

  describe('tractor lead, void, cannot beat', () => {
    it('discards when trump tractor too small vs existing kill', () => {
      // P1 killed with H-AA+KK (614/613). AI has H-33+44 (603/604).
      const lead: Card[] = [
        c2('S', 12, 200), c2('S', 12, 201), c2('S', 11, 200), c2('S', 11, 201),
      ];
      const best = {
        cards: [c2('H', 14, 0), c2('H', 14, 1), c2('H', 13, 0), c2('H', 13, 1)],
        playerIdx: 1,
      };
      const hand = [
        c2('H', 3, 0), c2('H', 3, 1), c2('H', 4, 0), c2('H', 4, 1),
        c2('C', 8, 0), c2('C', 7, 0), c2('C', 6, 0), c2('D', 5, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(4);
      expect(r.reason).not.toContain('毙');
    });
  });

  describe('throw lead, void, can beat', () => {
    it('kills AAK throw with pair+single - no overkill, "用主牌毙"', () => {
      // S-AAK throw (A pair + K single, K=10pts). H-33 + H-4 = pair+fill.
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 13, 0)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 3, 0), c2('H', 3, 1), c2('H', 4, 0), c2('C', 8, 0), c2('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.reason).toBe('用主牌毙');
    });

    it('kills throw without points - "用主牌毙"', () => {
      // S-AAJ throw (A pair + J single, no points).
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 11, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 6, 0), c2('H', 6, 1), c2('H', 7, 0), c2('C', 8, 0), c2('D', 9, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.reason).toBe('用主牌毙');
    });
  });

  describe('throw lead, void, best already trumped, cannot beat', () => {
    it('discards when trump too small vs existing throw kill', () => {
      // S-AAK throw. P1 killed with H-AA+K. AI has H-33+4 (too small).
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 13, 0)];
      const best = {
        cards: [c2('H', 14, 0), c2('H', 14, 1), c2('H', 13, 0)],
        playerIdx: 1,
      };
      const hand = [
        c2('H', 3, 0), c2('H', 3, 1), c2('H', 4, 0),
        c2('C', 8, 0), c2('C', 9, 0), c2('D', 10, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.reason).not.toContain('毙');
    });
  });

  describe('overkill (盖毙): bestSoFar already has trump, AI overkills', () => {
    it('overkills single with bigger trump - "盖毙"', () => {
      // P0 leads S-A. P1 killed with H-10 (effRank=610).
      // AI=P2 has H-A (effRank=614) > 610 → overkill.
      const lead: Card[] = [c2('S', 14, 200)];
      const best = { cards: [c2('H', 10, 0)], playerIdx: 1 }; // P1 trumped
      const hand = [c2('H', 14, 0), c2('C', 9, 0), c2('D', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toBe('盖毙');
    });

    it('overkills pair with bigger trump pair - "盖毙"', () => {
      // P0 leads S-9-9. P1 killed with H-10-10 (effRank=610).
      // AI=P2 has H-AA (effRank=614) → overkill.
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: [c2('H', 10, 0), c2('H', 10, 1)], playerIdx: 1 };
      const hand = [c2('H', 14, 0), c2('H', 14, 1), c2('C', 8, 0), c2('D', 7, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toBe('盖毙');
    });

    it('overkills tractor with bigger trump tractor - "盖毙"', () => {
      // S-QQ+JJ tractor. P1 killed with H-10-10+9-9 (tractor, effRank 610/609).
      // AI=P2 has H-AA+KK (effRank 614/613) → overkill.
      const lead: Card[] = [
        c2('S', 12, 200), c2('S', 12, 201), c2('S', 11, 200), c2('S', 11, 201),
      ];
      const best = {
        cards: [c2('H', 10, 0), c2('H', 10, 1), c2('H', 9, 0), c2('H', 9, 1)],
        playerIdx: 1,
      };
      const hand = [
        c2('H', 14, 0), c2('H', 14, 1), c2('H', 13, 0), c2('H', 13, 1),
        c2('C', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(4);
      expect(r.reason).toBe('盖毙');
    });

    it('overkills throw with bigger trump - "盖毙"', () => {
      // S-AAK throw. P1 killed with H-10-10+9 (pair+single).
      // AI=P2 has H-AA+K → overkill.
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 13, 0)];
      const best = {
        cards: [c2('H', 10, 0), c2('H', 10, 1), c2('H', 9, 0)],
        playerIdx: 1,
      };
      const hand = [
        c2('H', 14, 0), c2('H', 14, 1), c2('H', 13, 0),
        c2('C', 8, 0), c2('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.reason).toContain('盖毙');
    });
  });

  describe('throw with pairs, void, insufficient trump pairs', () => {
    it('discards instead of claiming kill with illegal single-for-pair', () => {
      // Bug: AI-3 void in D, lead is D-6-6-3-3 (throw with 2 pairs).
      // AI-3 has S-3-3 (1 pair) + S-4 + S-6. Not enough trump pairs to match.
      // Previously claimed "用主牌毙" with singles-for-pairs. Should discard.
      const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
      function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
      const lead: Card[] = [
        cc('D', 6, 200), cc('D', 6, 201),
        cc('D', 3, 200), cc('D', 3, 201),
      ];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        cc('S', 3, 0), cc('S', 3, 1), // one trump pair
        cc('S', 4, 0),                  // trump single
        cc('S', 6, 0),                  // trump single
        cc('S', 7, 0), cc('H', 8, 0),  // extra to avoid maybeAppendFinal
      ];
      const r = aiFollowPlay(hand, lead, 'D', cfgS2, best, 2);
      checkFollow(r.cards, hand, lead, 'D', cfgS2);
      expect(r.cards.length).toBe(4);
      expect(r.reason).not.toContain('毙');
      expect(r.reason).toContain('垫');
    });
  });

  describe('pair selection avoids breaking tractors', () => {
    const cfgD2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
    function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

    it('void in spades, picks standalone trump pair over tractor pair', () => {
      // Reproduces: AI-4 leads S-8-8 pair. Player 1 has:
      // D-5 D-5 D-4 D-4 (tractor: 5+4 consecutive since 2 is level, skip 2, 3:
      //   actually D-5 and D-4: level=2. D-5 effRank=605, D-4 effRank=604.
      //   areConsecutiveSameSuit: both trump, level=2. 5!=2 and 4!=2, so
      //   hi=5 lo=4, loop r=5; r<5 -> empty. Consecutive!
      //   Wait: 5!=2 and 4!=2 so hi=5 lo=4, loop r=5; r<5 -> empty. Yes consecutive.
      //   So D-5-5 + D-4-4 is a tractor.
      // D-Q D-Q (standalone pair, non-tractor, no points)
      // D-10 D-10 (standalone pair, non-tractor, points)
      // D-J, D-A etc.
      // The hint should pick D-Q-Q (standalone, non-point, smallest) over
      // D-4-4 (tractor pair, breaks the tractor).
      const lead: Card[] = [cc('S', 8, 200), cc('S', 8, 201)];
      const best = { cards: lead, playerIdx: 3 };
      const hand = [
        // Tractor: D-5-5 + D-4-4
        cc('D', 5, 0), cc('D', 5, 1),
        cc('D', 4, 0), cc('D', 4, 1),
        // Standalone pairs
        cc('D', 12, 0), cc('D', 12, 1),  // D-Q-Q (non-point)
        cc('D', 10, 0), cc('D', 10, 1),  // D-10-10 (points)
        // Other singletons
        cc('D', 14, 0),  // D-A
        cc('D', 11, 0),  // D-J
        cc('C', 6, 0), cc('C', 4, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfgD2, best, 0);
      checkFollow(r.cards, hand, lead, 'S', cfgD2);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toContain('毙');
      // Should pick D-Q-Q (standalone, non-point) not D-4-4 (tractor pair)
      expect(r.cards.some(c => c.rank === 12)).toBe(true);
      expect(r.cards.some(c => c.rank === 4)).toBe(false);
    });

    it('falls back to tractor pair when no standalone pair exists', () => {
      // Only tractor pairs available: D-5-5 + D-4-4. No standalone pairs.
      // Must pick the smallest tractor pair (D-4-4).
      const lead: Card[] = [cc('S', 8, 200), cc('S', 8, 201)];
      const best = { cards: lead, playerIdx: 3 };
      const hand = [
        // Tractor: D-5-5 + D-4-4
        cc('D', 5, 0), cc('D', 5, 1),
        cc('D', 4, 0), cc('D', 4, 1),
        // Singles only
        cc('D', 9, 0), cc('D', 7, 0),
        cc('C', 8, 0), cc('C', 6, 0),
      ];
      const r = aiFollowPlay(hand, lead, 'S', cfgD2, best, 0);
      checkFollow(r.cards, hand, lead, 'S', cfgD2);
      expect(r.cards.length).toBe(2);
      // Must pick the smallest tractor pair
      expect(r.cards.some(c => c.rank === 4)).toBe(true);
    });
  });
});

// ================================================================
// Reason annotation format: base reason + (annotation)
// ================================================================
describe('reason annotation format', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  it('third + teammate wins + max pattern: "同花色出小（队友已大，尽量加分）"', () => {
    const lead: Card[] = [cc('S', 14, 200)]; // S-A (max single)
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('S', 13, 0), cc('S', 12, 0), cc('S', 8, 0)];
    const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.reason).toBe('同花色出小（队友已大，尽量加分）');
  });

  it('third + teammate wins + tractor: "同花色出大（队友出拖拉机，尽量加分）"', () => {
    const lead: Card[] = [
      cc('S', 12, 200), cc('S', 12, 201),
      cc('S', 11, 200), cc('S', 11, 201),
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('S', 10, 0), cc('S', 10, 1), cc('S', 9, 0), cc('S', 9, 1),
      cc('S', 7, 0),
    ];
    const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    // Only one tractor matches -> "唯一可出" takes priority
    expect(r.reason).toContain('唯一可出');
  });

  it('third + teammate wins + not max: "同花色出小（盖不过，尽量不加分）"', () => {
    // Lead is small, teammate still wins, third should avoid adding
    const lead: Card[] = [cc('S', 9, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('S', 13, 0), cc('S', 5, 0), cc('S', 3, 0)];
    const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    // Lead is not max (9 is not A/K), third+tmWin → no annotation
    expect(r.reason).not.toContain('加分');
    expect(r.reason).not.toContain('不加分');
  });

  it('second + max pattern + cannot beat: "同花色出小（盖不过，尽量不加分）"', () => {
    // P0 leads S-A (max). P1=second, has S-K,Q,8. Cannot beat A.
    const lead: Card[] = [cc('S', 14, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('S', 13, 0), cc('S', 12, 0), cc('S', 8, 0)];
    const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.reason).toContain('尽量不加分');
  });

  it('third + tmWin + tractor, only one pair + point filler: "垫同花色（队友出拖拉机，尽量加分）"', () => {
    // P0 leads S-QQ+JJ tractor. P2=third, teammate wins, lead has tractor.
    // P2 has: one 10-10 pair + 5(point) + 9 + 7 + 3 = 5 cards.
    // Use level=2 so S-5 is off-suit point (not trump at level 5).
    // 10-10 alone is NOT a tractor. Only 1 pair -> NOT unique, can add points.
    const cfgH2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };
    const lead: Card[] = [
      cc('S', 12, 200), cc('S', 12, 201),
      cc('S', 11, 200), cc('S', 11, 201),
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('S', 10, 0), cc('S', 10, 1),  // one pair
      cc('S', 5, 0),                     // 5 (5pts) - should pick this
      cc('S', 9, 0),                     // 9 (non-point)
      cc('S', 7, 0),                     // 7 (non-point)
      cc('S', 3, 0),                     // 3 (non-point)
    ];
    const r = aiFollowPlay(hand, lead, 'S', cfgH2, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfgH2);
    expect(r.cards.length).toBe(4);
    expect(r.cards.some(c => c.rank === 5)).toBe(true);
    expect(r.reason).toContain('垫同花色');
    expect(r.reason).toContain('队友出拖拉机');
    expect(r.reason).toContain('尽量加分');
  });
});

// ================================================================
// Bug: short-suited/second + throw/max pattern should avoid points
// ================================================================
describe('short-suited / fourth avoid points on max pattern (spades trump, level=2)', () => {
  const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  // P0 leads D-A-K-K (AAK throw, max pattern). P1=second, has D-9 + D-A + C-K(10pts).
  // Short-suited: only D-9 + D-A = 2 diamonds < 3. Filler needed.
  // Has C-K (point) and H-3 (non-point) as fillers. Should avoid C-K.
  it('second+short+max throw avoids point filler: "同花色不够，垫其他花色（盖不过，尽量不加分）"', () => {
    const lead: Card[] = [cc('D', 14, 200), cc('D', 14, 201), cc('D', 13, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('D', 9, 0),    // 1 diamond
      cc('D', 14, 0),   // 1 diamond (D-A)
      cc('C', 13, 0),   // C-K (10 pts) — filler, should AVOID
      cc('H', 3, 0),    // H-3 (non-point) — filler, should USE
      cc('H', 6, 0),    // extra
    ];
    const r = aiFollowPlay(hand, lead, 'D', cfgS2, best, 1);
    checkFollow(r.cards, hand, lead, 'D', cfgS2);
    expect(r.cards.length).toBe(3);
    // Should NOT include C-K (13)
    expect(r.cards.every(c => c.rank !== 13 || c.suit !== 'C')).toBe(true);
    expect(r.reason).toContain('尽量不加分');
  });

  // P0 leads D-A-K-K (AAK throw). P3=fourth, has D-6, D-7, D-9, D-5(5pts).
  // Enough diamonds (3 >= 3) to follow, but max pattern + fourth -> avoid points.
  it('fourth+enough+max throw avoids point: "垫同花色（盖不过，尽量不加分）"', () => {
    const lead: Card[] = [cc('D', 14, 200), cc('D', 14, 201), cc('D', 13, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('D', 6, 0),    // D-6
      cc('D', 7, 0),    // D-7
      cc('D', 9, 0),    // D-9
      cc('D', 5, 0),    // D-5 (5 pts) — should AVOID
      cc('H', 3, 0),    // extra
    ];
    const r = aiFollowPlay(hand, lead, 'D', cfgS2, best, 3);
    checkFollow(r.cards, hand, lead, 'D', cfgS2);
    expect(r.cards.length).toBe(3);
    // Should NOT include D-5
    expect(r.cards.every(c => c.rank !== 5 || c.suit !== 'D')).toBe(true);
    expect(r.reason).toContain('尽量不加分');
  });
});

// ================================================================
// Tractor lead: second/no-tractor avoids points, third adds
// ================================================================
describe('tractor lead fill-with-pairs annotations (level=2, spades trump)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  // P0 leads H-KK+QQ (tractor, max). P1=second, has H-6-6 pair + H-4,H-5,H-8.
  // No tractor match → fill with H-6-6 + 2 smallest non-point singles.
  it('second+no-tractor avoids point fillers: "垫同花色（盖不过，尽量不加分）"', () => {
    const lead: Card[] = [
      cc('H', 13, 200), cc('H', 13, 201),
      cc('H', 12, 200), cc('H', 12, 201),
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('H', 6, 0), cc('H', 6, 1),   // 6-6 pair
      cc('H', 4, 0),                    // 4 (non-point)
      cc('H', 5, 0),                    // 5 (5 pts) - should AVOID
      cc('H', 8, 0),                    // 8 (non-point)
      cc('S', 7, 0),                    // extra trump
    ];
    const r = aiFollowPlay(hand, lead, 'H', cfg, best, 1);
    checkFollow(r.cards, hand, lead, 'H', cfg);
    expect(r.cards.length).toBe(4);
    // Should NOT include H-5
    expect(r.cards.every(c => c.rank !== 5 || c.suit !== 'H')).toBe(true);
    expect(r.reason).toContain('尽量不加分');
  });

  // P0 leads H-KK+QQ (tractor). P2=third, teammate wins.
  // Has H-7-7 pair + H-9,H-J,H-A. No points available among these.
  it('third+teammate wins+tractor, no points: "垫同花色（但没分可加）"', () => {
    const lead: Card[] = [
      cc('H', 13, 200), cc('H', 13, 201),
      cc('H', 12, 200), cc('H', 12, 201),
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('H', 7, 0), cc('H', 7, 1),   // 7-7 pair
      cc('H', 14, 0),                   // A (not a point card)
      cc('H', 11, 0),                   // J (not a point card)
      cc('H', 9, 0),                    // 9 (not a point card)
      cc('S', 8, 0),
    ];
    const r = aiFollowPlay(hand, lead, 'H', cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'H', cfg);
    expect(r.cards.length).toBe(4);
    // All cards are non-pointers
    expect(r.reason).toContain('但没分可加');
  });
});

// ================================================================
// Short-suited filler avoids level trump (常主)
// ================================================================
describe('filler avoids level trump when all remaining are trump', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  it('prefers non-level S-3 over S-2(level) and S-10(point) as filler', () => {
    // P0 leads D-Q-Q pair. AI has D-Q (1 diamond, short).
    // All remaining cards are trump: S-2(level/常主), S-3, S-10(point).
    // Should pick S-3, not waste S-2 or add S-10.
    const lead: Card[] = [cc('D', 12, 200), cc('D', 12, 201)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('D', 12, 0), cc('S', 2, 0), cc('S', 3, 0), cc('S', 10, 0),
    ];
    const r = aiFollowPlay(hand, lead, 'D', cfg, best, 3);
    checkFollow(r.cards, hand, lead, 'D', cfg);
    expect(r.cards.length).toBe(2);
    expect(r.cards.some(c => c.suit === 'S' && c.rank === 3)).toBe(true);
    expect(r.cards.some(c => c.suit === 'S' && c.rank === 2)).toBe(false);
    expect(r.cards.some(c => c.suit === 'S' && c.rank === 10)).toBe(false);
  });
});

// ================================================================
// Trump draw: canBeat uses bestSoFar not leadMax
// ================================================================
describe('trump draw canBeat uses bestSoFar (spades trump, level=2)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  it('third position cannot beat with S-8 when S-9 already beat lead S-7', () => {
    // P0 leads S-7(607). P1's S-9(609) beat the lead.
    // P2 has S-8(608) and S-10(610). S-8 < S-9, cannot beat.
    // Should play S-10 (smallest that beats currentMax=609) OR play S-8 as 同花色出小.
    // Actually: canBeatCards = [S-10(610)] only. S-8 is excluded.
    const lead: Card[] = [cc('S', 7, 200)];
    const best = { cards: [cc('S', 9, 0)], playerIdx: 1 }; // P1 already beat
    const hand = [
      cc('S', 8, 0), cc('S', 10, 0),
      cc('H', 3, 0),  // extra
    ];
    const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards.length).toBe(1);
    // Must play S-10(610), not S-8(608). S-8 < S-9(609).
    expect(r.cards[0].rank).toBe(10);
    expect(r.reason).toContain('同花色出大');
  });

  it('third position plays smallest when cannot beat at all', () => {
    // P0 leads S-Q(612). P1's S-A(614) beat it.
    // P2 has S-8(608), S-6(606). Neither beats S-A(614).
    // Should play S-6 (smallest) and say 同花色出小.
    const lead: Card[] = [cc('S', 12, 200)];
    const best = { cards: [cc('S', 14, 0)], playerIdx: 1 };
    const hand = [cc('S', 8, 0), cc('S', 6, 0), cc('H', 3, 0)];
    const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards.length).toBe(1);
    expect(r.cards[0].rank).toBe(6);
    expect(r.reason).toContain('同花色出小');
  });
});

// ================================================================
// Trump kill: no points → smallest, has points → >= A / biggest
// ================================================================
describe('trump kill point-aware selection (hearts trump, level=5)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  describe('no points in trick → smallest trump', () => {
    it('kills S-A with smallest trump H-3', () => {
      const lead: Card[] = [cc('S', 14, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 3, 0), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 3, 0).id);
      expect(r.reason).toBe('用主牌毙');
    });

    it('kills S-9-9 pair with smallest trump pair H-3-3', () => {
      const lead: Card[] = [cc('S', 9, 200), cc('S', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 14, 1), cc('H', 3, 0), cc('H', 3, 1), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.some(c => c.rank === 3)).toBe(true);
      expect(r.reason).toBe('用主牌毙');
    });
  });

  describe('has points in trick → >= A / biggest trump', () => {
    it('kills S-K(10pts) with >=A trump H-A', () => {
      const lead: Card[] = [cc('S', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 3, 0), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 14, 0).id); // >= A
      expect(r.reason).toBe('用主牌毙');
    });

    it('kills S-K(10pts) with biggest when no >=A trump available', () => {
      const lead: Card[] = [cc('S', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 10, 0), cc('H', 3, 0), cc('C', 8, 0)]; // H-10 is biggest
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 10, 0).id); // biggest
      expect(r.reason).toBe('用主牌毙');
    });

    it('kills pairs with points using biggest trump pair', () => {
      // S-10-10 pair (each 10pts). AI has H-AA and H-3-3.
      const lead: Card[] = [cc('S', 10, 200), cc('S', 10, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 14, 1), cc('H', 3, 0), cc('H', 3, 1), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      // should use H-AA (biggest), not H-3-3
      expect(r.cards.some(c => c.rank === 14)).toBe(true);
      expect(r.cards.some(c => c.rank === 3)).toBe(false);
      expect(r.reason).toBe('用主牌毙');
    });
  });

  describe('overkill → always smallest beating', () => {
    it('overkills existing trump with smallest beating (ignoring points)', () => {
      // P0 leads S-K(10pts). P1 killed with H-Q. AI=P2 has H-A, H-10.
      // Points exist, but overkill → smallest beating, not >=A.
      const lead: Card[] = [cc('S', 13, 200)];
      const best = { cards: [cc('H', 12, 0)], playerIdx: 1 };
      const hand = [cc('H', 14, 0), cc('H', 13, 0), cc('H', 10, 0), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, 'S', cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      // H-10 beats H-Q? H-10 effRank=610, H-Q effRank=612 → 610<612, can't beat.
      // H-13 beats H-Q? 613>612 → yes, smallest beating is H-13.
      expect(r.cards[0].id).toBe(cc('H', 13, 0).id);
      expect(r.reason).toBe('盖毙');
    });
  });
});
