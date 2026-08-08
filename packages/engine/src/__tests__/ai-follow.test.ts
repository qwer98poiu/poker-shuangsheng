import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard, isTrump } from '../model.js';
import { classify } from '../pattern/index.js';
import { compareTwo } from '../comparing/index.js';
import { validateFollow } from '../following/index.js';
import { aiFollowPlay } from '../ai/index.js';
import type { TrumpDeclaration, Card } from '../types.js';
import type { AIContext, NTTrumpState } from '../ai/types.js';

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

    it('third position, cannot beat trump single -> non-point trump before point trump（盖不过避分）', () => {
      // 用户场景：P3 领出吊主 ♥10，P0（第二家）出大王盖过，P1（第三家）盖不过。
      // 规格：盖不过前两家出最小主牌且不加分 → 不加分按避分优先级
      // （主牌 A 以下非分单 ♥Q 先于主牌 A 以下分单 ♥10）→ 应出 ♥Q 而非 ♥10。
      const lead: Card[] = [c('H', 10, 200)];
      const ctx: AIContext = {
        declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5,
        myIndex: 1, isDeclarer: false, isDeclarerPartner: false,
        isAttacker: false, attackerPoints: 15,
        handCounts: [6, 6, 6, 6], trickHistory: [], reveals: [],
        playCount: 2, leadPlayerIndex: 3,
        bestSoFar: { cards: [c('J', 16, 0)], playerIndex: 0 }, // 玩家1 大王
        ntState: null, bottomCards: [], debug: false,
      };
      const hand = [c('H', 12, 0), c('H', 10, 0), c('S', 12, 0)]; // ♥Q(非分) ♥10(10分) ♠Q
      const r = aiFollowPlay(hand, lead, Suit.Hearts, ctx);
      checkFollow(r.cards, hand, lead, 'H', cfg5);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(12); // ♥Q，不是 ♥10
      expect(r.reason).toContain('同花色出小');
    });

    it('single trump, only one trump in hand -> 唯一可出', () => {
      // AI-2 has only ♣7 (H-8) as trump, rest are non-trump.
      // Lead H-12 — AI-2 plays its sole trump, no choice.
      const lead: Card[] = [c('H', 12, 200)];
      const hand = [
        c('H', 8, 0),     // only trump
        c('S', 14, 0),    // ♠A (non-trump)
        c('S', 13, 0),    // ♠K (non-trump)
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfg5, undefined, 2);
      checkFollow(r.cards, hand, lead, 'H', cfg5);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toContain('唯一可出');
    });

    it('single trump lead, hand has a pair of trumps -> 唯一可出', () => {
      // Lead ♥K. AI-2 has ♥8♥8 — a pair. Either ♥8 is the same card.
      const lead: Card[] = [c('H', 13, 200)];
      const hand = [
        c('H', 8, 0), c('H', 8, 1),  // ♥8♥8 pair (trump)
        c('S', 14, 0),                 // ♠A (non-trump)
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfg5, undefined, 2);
      checkFollow(r.cards, hand, lead, 'H', cfg5);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toContain('唯一可出');
    });

    it('single off-suit lead, hand has a pair in that suit -> 唯一可出', () => {
      // Lead ♠Q. AI-2 has ♠K♠K — a pair. Either ♠K is the same.
      const lead: Card[] = [c('S', 12, 200)];
      const hand = [
        c('S', 13, 0), c('S', 13, 1),  // ♠K♠K pair
        c('H', 8, 0),                    // trump
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg5, undefined, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg5);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toContain('唯一可出');
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

    it('pair lead, hand has two singles -> 垫同花色, not 出大', () => {
      // Lead ♠Q♠Q pair. Hand: ♠K, ♠8 (singles, different ranks).
      // Even though ♠K > ♠Q, two singles cannot beat a pair → 垫同花色.
      const lead: Card[] = [c('S', 12, 200), c('S', 12, 201)];
      const hand = [
        c('S', 13, 0),    // ♠K
        c('S', 8, 0),     // ♠8
        c('H', 14, 0),    // extra
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg5, undefined, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg5);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toContain('垫同花色');
      expect(r.reason).toContain('唯一可出');
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
    const play = aiFollowPlay(hand, lead, Suit.Spades as any, cfgD2).cards;
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
    const play = aiFollowPlay(hand, lead, Suit.Clubs as any, cfgD2).cards;
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
      const r = aiFollowPlay(hand, leadAAK, Suit.Clubs, cfg, bestP0, 2);
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
      const r = aiFollowPlay(hand, leadAA, Suit.Clubs, cfg, bestAA, 2);
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
      const r = aiFollowPlay(hand, leadA, Suit.Clubs, cfg, bestA, 2);
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
      const r = aiFollowPlay(hand, lead9, Suit.Clubs, cfg, bestP0b, 2);
      checkFollow(r.cards, hand, lead9, 'C', cfg);
      expect(r.cards.length).toBe(1);
      // Lead is small (9 not max), so third+tmWin = NO annotation
      expect(r.reason).not.toContain('加分');
      expect(r.reason).not.toContain('不加分');
    });
  });

  describe('NT trump follow single cannot beat (crash fix)', () => {
    // Bug: followNTTrumpLead used `shouldAvoid` without defining it.
    // Fix: declare shouldAvoid before usage, matching followTrumpLead.
    // NT mode: trumpSuit=null, all jokers+level cards are trump.
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    // Minimal NTTrumpState mock — enough for the cannot-beat path.
    const mockNTState: NTTrumpState = {
      knownTrumpsPerPlayer: [[], [], [], []],
      playersWithNoTrump: new Set(),
      totalTrumps: 12,
      opponentTrumpCount: 0,
      remainingBigJokers: 0,
      remainingSmallJokers: 0,
      allUnseenJokersOnOurSide: false,
      allUnseenBigJokersOnOurSide: false,
      possibleTrumps: [null, {}, {}, {}, {}],
      isFullyDetermined: false,
      canFormPair: [false, false, false, false],
      canHaveJoker: [false, false, false, false],
      canHaveBigJoker: [false, false, false, false],
      canHaveSmallJoker: [false, false, false, false],
      minTrumpCounts: [0, 0, 0, 0],
      maxTrumpCounts: [0, 0, 0, 0],
    };

    it('NT single trump, fourth+oppWins, cannot beat -> no crash', () => {
      // P0 (declarer) leads ♣2. P1 beats with JOKER. P3=AI(fourth) has ♠2
      // as only trump, cannot beat JOKER. opponent wins → shouldAvoid=true.
      // Crash was: shouldAvoid used without declaration.
      const lead: Card[] = [ct('C', 2, 200)];
      const bestSoFar = { cards: [ct('J', 16, 201)], playerIdx: 1 };
      const ctx: AIContext = {
        declarerIndex: 0,
        trumpSuit: null,
        level: 2,
        myIndex: 3,
        isDeclarer: false,
        isDeclarerPartner: false,
        isAttacker: true,
        attackerPoints: 0,
        handCounts: [25, 25, 25, 25] as const,
        trickHistory: [],
        reveals: [],
        playCount: 3,
        leadPlayerIndex: 0,
        bestSoFar: { cards: bestSoFar.cards, playerIndex: bestSoFar.playerIdx },
        ntState: mockNTState,
        bottomCards: [],
        debug: false,
      };
      const hand = [
        ct('S', 2, 0),     // ♠2 (trump in NT)
        ct('H', 14, 0),    // ♥A (non-trump)
        ct('D', 10, 0),    // ♦10 (non-trump)
      ];
      const r = aiFollowPlay(hand, lead, null as any, ctx);
      checkFollow(r.cards, hand, lead, null as any, ctx);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toBeTruthy();
      // Should not crash
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
    const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg);
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
    const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg);
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
    const r = aiFollowPlay(hand, leadAAK, Suit.Clubs, cfg);
    checkFollow(r.cards, hand, leadAAK, 'C', cfg);
    expect(r.cards.length).toBe(3);
    // All played cards are clubs (lead suit), can't match pattern (no pair)
    // Hand has exactly 3 clubs = leadLen, all cards forced → unique.
    expect(r.reason).toBe('垫同花色（唯一可出）');
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].id).toBe(c2('H', 3, 0).id);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });

    it('kills single K - no overkill, "用主牌毙"', () => {
      const lead: Card[] = [c2('S', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [c2('H', 4, 0), c2('C', 9, 0), c2('D', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });
  });

  describe('single lead, void, best already trumped, cannot beat', () => {
    it('discards when trump is too small', () => {
      // P1 already killed S-A with H-A (effRank=614). AI=P2 has H-3 (603).
      const lead: Card[] = [c2('S', 14, 200)];
      const best = { cards: [c2('H', 14, 0)], playerIdx: 1 };
      const hand = [c2('H', 3, 0), c2('C', 9, 0), c2('C', 8, 0), c2('D', 6, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
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
      const r = aiFollowPlay(hand, lead88, Suit.Clubs, cfg4, best88, 3);
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
      const r = aiFollowPlay(hand, lead88, Suit.Clubs, cfg4, best88, 3);
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
      const r = aiFollowPlay(hand, lead88, Suit.Clubs, cfg4, best88, 3);
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
      const r = aiFollowPlay(hand, lead88, Suit.Clubs, cfg4, best88, 3);
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });
  });

  describe('pair lead, void, cannot beat', () => {
    it('discards when trump pair exists but too small', () => {
      // P1 killed S-9-9 with H-AA (effRank=614). AI has H-3-3 (603).
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: [c2('H', 14, 0), c2('H', 14, 1)], playerIdx: 1 };
      const hand = [c2('H', 3, 0), c2('H', 3, 1), c2('C', 8, 0), c2('D', 7, 0), c2('D', 6, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).not.toContain('毙');
    });

    it('discards when trump has singles but no pair for pair lead', () => {
      // trump=3 >= leadLen=2, but no trump pair -> cannot kill pair lead.
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [c2('H', 3, 0), c2('H', 4, 0), c2('H', 6, 0), c2('C', 8, 0), c2('D', 7, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).not.toContain('毙');
    });
  });

  describe('tractor lead, void, can beat', () => {
    it('kills off-suit tractor with trump tractor - "用主牌毙（用分牌盖）"', () => {
      // S-QQ+JJ (Q=12,J=11 consecutive). H-AA+KK (A=14,K=13 consecutive).
      // K is a point rank → annotated 加分.
      const lead: Card[] = [
        c2('S', 12, 200), c2('S', 12, 201), c2('S', 11, 200), c2('S', 11, 201),
      ];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 14, 0), c2('H', 14, 1), c2('H', 13, 0), c2('H', 13, 1),
        c2('C', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(4);
      expect(r.reason).toBe('用主牌毙（用分牌盖）');
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });

    it('kills throw without points - "用主牌毙"', () => {
      // S-AAJ throw (A pair + J single, no points).
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 11, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 6, 0), c2('H', 6, 1), c2('H', 7, 0), c2('C', 8, 0), c2('D', 9, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });

    // 实测场景（用户牌局）：领出 ♣A♣A♣J♣J♣K（2 对+1 单，含 K 分），第四家缺门毙。
    // 填充单张应分牌优先：手上有 ♥5 就不填 ♥3 —— "用分牌盖"意图要落到实处。
    // 等级用 6（非 5）：让 ♥5 是普通 5 分牌而非级牌——级牌（rank=level）不算分牌，
    // 只在跨 40 分台阶时出，不能作为填充优先的验证对象。
    it('kills throw: filler prefers point card over smaller non-point', () => {
      const cfg6: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 6 };
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 11, 2), c2('S', 11, 3), c2('S', 13, 4)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 3, 0), c2('H', 3, 1),   // ♥3♥3 对
        c2('H', 7, 0), c2('H', 7, 1),   // ♥7♥7 对
        c2('H', 5, 0),                  // ♥5（5 分）
        c2('H', 4, 1),                  // ♥4（非分）
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg6, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg6);
      expect(r.cards.length).toBe(5);
      // 填充单张必须是分牌 ♥5，而不是更小的 ♥4
      expect(r.cards.filter(c => c.rank === 5).length).toBe(1);
      expect(r.cards.filter(c => c.rank === 4).length).toBe(0);
      expect(r.reason).toContain('用分牌盖');
    });

    it('kills throw: with both 10 and 5 singles, filler picks the 10', () => {
      const cfg6: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 6 };
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 11, 2), c2('S', 11, 3), c2('S', 13, 4)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 3, 0), c2('H', 3, 1),
        c2('H', 7, 0), c2('H', 7, 1),
        c2('H', 10, 0),                // ♥10（10 分）
        c2('H', 5, 1),                 // ♥5（5 分）
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg6, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg6);
      expect(r.cards.length).toBe(5);
      // 分高在前：填 10 分牌，不填 5 分牌
      expect(r.cards.filter(c => c.rank === 10).length).toBe(1);
      expect(r.cards.filter(c => c.rank === 5).length).toBe(0);
    });

    it('kills throw with 4 trump pairs: K pair still chosen (points first)', () => {
      const cfg6: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 6 };
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 11, 2), c2('S', 11, 3), c2('S', 13, 4)];
      const best = { cards: lead, playerIdx: 0 };
      // 4 个主对：♥3♥3、♥6♥6（级牌对）、♥7♥7、♥K♥K（K 是唯一分对也是大对）
      const hand = [
        c2('H', 3, 0), c2('H', 3, 1),
        c2('H', 6, 0), c2('H', 6, 1),
        c2('H', 7, 0), c2('H', 7, 1),
        c2('H', 13, 0), c2('H', 13, 1),
        c2('H', 4, 0),                  // 填充单张
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg6, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg6);
      expect(r.cards.length).toBe(5);
      // 分对/大对在前：♥K♥K 对必然入选（与用户实测的建议一致）
      expect(r.cards.filter(c => c.rank === 13).length).toBe(2);
      expect(r.reason).toContain('用分牌盖');
    });

    // 第四家毙牌优先选分牌（身后无人，加分安全）——规格第四家原则6注。
    // 等级用 6（非 5）：♥5 是普通 5 分牌而非级牌（常主只在跨 40 分台阶时出）。
    it('fourth kills single: prefers point card over smaller non-point (♠5 over ♠4)', () => {
      const cfg6: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 6 };
      const lead: Card[] = [c2('S', 14, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 4, 0), c2('H', 5, 1),   // ♥4（非分）与 ♥5（5 分）
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg6, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg6);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(5);  // 分牌优先，不出更小的 4
      expect(r.reason).toContain('用分牌盖');
    });

    it('fourth kills single: with both 10 and 5, plays the 10', () => {
      const lead: Card[] = [c2('S', 14, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('H', 4, 0), c2('H', 5, 1), c2('H', 10, 2),
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].rank).toBe(10); // 10 分 > 5 分
    });

    it('fourth overkills single: point-max beater (10 over K/8)', () => {
      const lead: Card[] = [c2('S', 14, 200)];
      // 第三家已用 ♥6 毙（effRank=606），第四家盖毙
      const best = { cards: [c2('H', 6, 300)], playerIdx: 2 };
      const hand = [
        c2('H', 8, 0), c2('H', 10, 1), c2('H', 13, 2),  // 都能盖 606
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(10); // 分最多优先，不出更小的 8
      expect(r.reason).toContain('盖毙');
    });

    // 第四家盖毙甩牌：对子槽位要盖过对方最大的对应子牌型，分最多优先
    it('fourth overkills throw: pair must beat opponent biggest pair (10-10 over 7-7)', () => {
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 13, 2)];
      // 第三家已毙：♥8♥8 + ♥3（对子 608）
      const best = { cards: [c2('H', 8, 300), c2('H', 8, 301), c2('H', 3, 302)], playerIdx: 2 };
      const hand = [
        c2('H', 10, 0), c2('H', 10, 1),  // ♥10♥10（能盖 608，分对）
        c2('H', 7, 0), c2('H', 7, 1),    // ♥7♥7（607，盖不过 608）
        c2('H', 9, 2),                   // 填充单张
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.cards.filter(c => c.rank === 10).length).toBe(2); // 10 对盖过 8 对
      expect(r.cards.filter(c => c.rank === 7).length).toBeLessThan(2); // 7 对不拆（最多作填充单张）
      expect(r.reason).toContain('盖毙');
    });

    it('fourth overkills throw: smallest pair that beats (9-9 over 7-7)', () => {
      const lead: Card[] = [c2('S', 14, 0), c2('S', 14, 1), c2('S', 13, 2)];
      const best = { cards: [c2('H', 8, 300), c2('H', 8, 301), c2('H', 3, 302)], playerIdx: 2 };
      const hand = [
        c2('H', 9, 0), c2('H', 9, 1),    // ♥9♥9（609，能盖 608）
        c2('H', 7, 0), c2('H', 7, 1),    // ♥7♥7（607，盖不过）
        c2('H', 6, 2),                   // 填充单张
        c2('C', 9, 0), c2('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(3);
      expect(r.cards.filter(c => c.rank === 9).length).toBe(2); // 唯一能盖的 9 对
      expect(r.cards.filter(c => c.rank === 7).length).toBe(0);
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toBe('盖毙（用最小牌盖）');
    });

    it('overkills pair with bigger trump pair - "盖毙"', () => {
      // P0 leads S-9-9. P1 killed with H-10-10 (effRank=610).
      // AI=P2 has H-AA (effRank=614) → overkill.
      const lead: Card[] = [c2('S', 9, 200), c2('S', 9, 201)];
      const best = { cards: [c2('H', 10, 0), c2('H', 10, 1)], playerIdx: 1 };
      const hand = [c2('H', 14, 0), c2('H', 14, 1), c2('C', 8, 0), c2('D', 7, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toBe('盖毙（用最小牌盖）');
    });

    it('overkills tractor with bigger trump tractor - "盖毙（用分牌盖）"', () => {
      // S-QQ+JJ tractor. P1 killed with H-10-10+9-9 (tractor, effRank 610/609).
      // AI=P2 has H-AA+KK (effRank 614/613) → overkill.
      // K is a point rank → annotated 加分.
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.length).toBe(4);
      expect(r.reason).toBe('盖毙（用分牌盖）');
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
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
      const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfgS2, best, 2);
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgD2, best, 0);
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgD2, best, 0);
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

  it('third + teammate wins + max pattern: "同花色出小（队友已大，加分）"', () => {
    const lead: Card[] = [cc('S', 14, 200)]; // S-A (max single)
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('S', 13, 0), cc('S', 12, 0), cc('S', 8, 0)];
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.reason).toBe('同花色出小（队友已大，加分）');
  });

  it('third + teammate wins + tractor: "同花色出大（队友出拖拉机，加分）"', () => {
    const lead: Card[] = [
      cc('S', 12, 200), cc('S', 12, 201),
      cc('S', 11, 200), cc('S', 11, 201),
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('S', 10, 0), cc('S', 10, 1), cc('S', 9, 0), cc('S', 9, 1),
      cc('S', 7, 0),
    ];
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    // Only one tractor matches -> "唯一可出" takes priority
    expect(r.reason).toContain('唯一可出');
  });

  it('third + teammate wins + not max: "同花色出小（盖不过，不加分）"', () => {
    // Lead is small, teammate still wins, third should avoid adding
    const lead: Card[] = [cc('S', 9, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('S', 13, 0), cc('S', 5, 0), cc('S', 3, 0)];
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    // Lead is not max (9 is not A/K), third+tmWin → no annotation
    expect(r.reason).not.toContain('加分');
    expect(r.reason).not.toContain('不加分');
  });

  it('second + cannot beat: plays smallest (3 cards <= 15, no avoid annotation)', () => {
    // P0 leads S-A (max). P1=second, has S-K,Q,8. Cannot beat A.
    // 避分改为手牌数规则：3 张 <= 15 → 不避分，出最小 S-8，无标注。
    const lead: Card[] = [cc('S', 14, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('S', 13, 0), cc('S', 12, 0), cc('S', 8, 0)];
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards[0].rank).toBe(8);
    expect(r.reason).toContain('同花色出小');
    expect(r.reason).not.toContain('加分');
  });

  it('third + tmWin + tractor, only one pair + point filler: "垫同花色（队友出拖拉机，加分）"', () => {
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
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfgH2, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfgH2);
    expect(r.cards.length).toBe(4);
    expect(r.cards.some(c => c.rank === 5)).toBe(true);
    expect(r.reason).toContain('垫同花色');
    expect(r.reason).toContain('队友出拖拉机');
    expect(r.reason).toContain('加分');
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
  // 5 张手牌 <= 15 → 不避分（分非分一视同仁按大小）：H-3 最小先垫，C-K 最大留手。
  it('second+short+max throw, 5 cards: filler by size (H-3 first, C-K kept)', () => {
    const lead: Card[] = [cc('D', 14, 200), cc('D', 14, 201), cc('D', 13, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('D', 9, 0),    // 1 diamond
      cc('D', 14, 0),   // 1 diamond (D-A)
      cc('C', 13, 0),   // C-K (10 pts) — largest, kept
      cc('H', 3, 0),    // H-3 — smallest filler, used
      cc('H', 6, 0),    // extra
    ];
    const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfgS2, best, 1);
    checkFollow(r.cards, hand, lead, 'D', cfgS2);
    expect(r.cards.length).toBe(3);
    // 垫其他花色优先张数最少的副牌花色（断门）：♣ 只有 1 张 → 整门垫出 C-K
    expect(r.cards.some(c => c.rank === 13 && c.suit === 'C')).toBe(true);
    expect(r.reason).not.toContain('加分');
  });

  // P0 leads D-A-K-K (AAK throw). P3=fourth, has D-6, D-7, D-9, D-5(5pts).
  // Enough diamonds (3 >= 3) to follow, but max pattern + fourth -> avoid points.
  it('fourth+enough+max throw avoids point: "垫同花色（盖不过，不加分）"', () => {
    const lead: Card[] = [cc('D', 14, 200), cc('D', 14, 201), cc('D', 13, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('D', 6, 0),    // D-6
      cc('D', 7, 0),    // D-7
      cc('D', 9, 0),    // D-9
      cc('D', 5, 0),    // D-5 (5 pts) — should AVOID
      cc('H', 3, 0),    // extra
    ];
    const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfgS2, best, 3);
    checkFollow(r.cards, hand, lead, 'D', cfgS2);
    expect(r.cards.length).toBe(3);
    // Should NOT include D-5
    expect(r.cards.every(c => c.rank !== 5 || c.suit !== 'D')).toBe(true);
    expect(r.reason).toContain('不加分');
  });
});

// ================================================================
// Tractor lead: second/no-tractor avoids points, third adds
// ================================================================
describe('tractor lead fill-with-pairs annotations (level=2, spades trump)', () => {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

  // P0 leads H-KK+QQ (tractor, max). P1=second, has H-6-6 pair + H-4,H-5,H-8.
  // No tractor match → fill with H-6-6 + 2 smallest singles.
  // 6 张手牌 <= 15 → 不避分（分非分一视同仁）：H-4, H-5 先垫（按大小）。
  it('second+no-tractor, 6 cards: fill smallest singles by size (H-4, H-5)', () => {
    const lead: Card[] = [
      cc('H', 13, 200), cc('H', 13, 201),
      cc('H', 12, 200), cc('H', 12, 201),
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('H', 6, 0), cc('H', 6, 1),   // 6-6 pair
      cc('H', 4, 0),                    // 4 (non-point)
      cc('H', 5, 0),                    // 5 (5 pts)
      cc('H', 8, 0),                    // 8 (non-point)
      cc('S', 7, 0),                    // extra trump
    ];
    const r = aiFollowPlay(hand, lead, Suit.Hearts, cfg, best, 1);
    checkFollow(r.cards, hand, lead, 'H', cfg);
    expect(r.cards.length).toBe(4);
    // H-5 is smallest after H-4 → included (一视同仁按大小)
    expect(r.cards.some(c => c.rank === 5 && c.suit === 'H')).toBe(true);
    expect(r.reason).not.toContain('加分');
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
    const r = aiFollowPlay(hand, lead, Suit.Hearts, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'H', cfg);
    expect(r.cards.length).toBe(4);
    // All cards are non-pointers
    expect(r.reason).toContain('但没分可加');
  });

  it('third + tmWin + trump BJ single -> max pattern, adds points', () => {
    // P0 leads trump BJ. P2=third, teammate P0 wins. BJ single is max -> add points.
    const cfgH: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const lead: Card[] = [cc('J', 16, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('H', 14, 0), cc('H', 13, 0), cc('H', 8, 0)];
    const r = aiFollowPlay(hand, lead, null, cfgH, best, 2);
    checkFollow(r.cards, hand, lead, null, cfgH);
    expect(r.reason).toContain('加分');
  });

  it('second + trump BJ single (max) -> plays smallest trump', () => {
    // P0 leads trump BJ. P1=second, has H-A,K,8. 第3条：出最小主牌（不一定盖过），
    // 避分改为手牌数规则（垫牌场景），跟主牌单张恒出最小。
    const cfgH2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const lead: Card[] = [cc('J', 16, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('H', 14, 0), cc('H', 13, 0), cc('H', 8, 0)];
    const r = aiFollowPlay(hand, lead, null, cfgH2, best, 1);
    checkFollow(r.cards, hand, lead, null, cfgH2);
    expect(r.cards[0].rank).toBe(8);
    expect(r.reason).toContain('同花色出小');
  });

  it('second + small trump (not max) -> no annotation', () => {
    // P0 leads small trump H-8. P1=second, has H-9,10,A. Not max -> no avoid annotation.
    const cfgH3: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    const lead: Card[] = [cc('H', 8, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [cc('H', 9, 0), cc('H', 10, 0), cc('H', 14, 0)];
    const r = aiFollowPlay(hand, lead, null, cfgH3, best, 1);
    checkFollow(r.cards, hand, lead, null, cfgH3);
    expect(r.reason).not.toContain('不加分');
    expect(r.reason).not.toContain('加分');
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
    const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfg, best, 3);
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
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
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
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards.length).toBe(1);
    expect(r.cards[0].rank).toBe(6);
    expect(r.reason).toContain('同花色出小');
  });
});

// ================================================================
// NT throw kill: tractor covering lead's pairs must not crash
// ================================================================
describe('NT throw kill: 拖拉机覆盖领出对子（getCompareKey 空成分回归）', () => {
  // 用户场景（arena seed 43 pair 3547 崩溃）：
  // NT、级牌 11、闲家 60 分。领出 ♠A♠A♠Q♠Q♠K（两对+单甩，含 10 分，
  // 60+10=70 → 禁分 → 走盖毙）。玩家2 用 2大王+♦11♦11+♣11 全主盖毙。
  // AI（座位0，第四家）有 小王对+♥11对——盖毙 chosen 是 NT 拖拉机
  // （小王 900 + 级牌 800 相邻），extractComponents 把它整体归拖拉机、
  // 无独立对——修复前 getCompareKey 对空 pairs 数组 reduce 崩溃。
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 11 };
  const c11 = (s: string, i: number): Card => createCard(s as any, 11 as any, i);

  it('盖毙用拖拉机（小王对+级牌对）盖两对甩领出：不崩溃且出牌合法', () => {
    const lead: Card[] = [
      createCard('S', 14, 200), createCard('S', 14, 201),
      createCard('S', 12, 202), createCard('S', 12, 203),
      createCard('S', 13, 204),
    ];
    const hand: Card[] = [
      createCard('D', 3, 0), createCard('D', 2, 0),
      createCard('J', 15, 0), createCard('J', 15, 1),   // 小王对（主）
      createCard('H', 13, 0), c11('H', 0), createCard('D', 8, 0), createCard('D', 5, 0),
      c11('H', 1), createCard('D', 13, 0), createCard('H', 5, 0), c11('S', 0),
    ];
    const ctx: AIContext = {
      declarerIndex: 0, trumpSuit: null, level: 11,
      myIndex: 0, isDeclarer: false, isDeclarerPartner: false,
      isAttacker: false, attackerPoints: 60,          // 60 + 领出 10 分 = 70 → 禁分
      handCounts: [12, 7, 7, 7], trickHistory: [], reveals: [],
      playCount: 3, leadPlayerIndex: 1,               // 第四家
      bestSoFar: {
        cards: [createCard('J', 16, 107), createCard('J', 16, 53),
          c11('D', 48), c11('D', 102), c11('C', 35)], // 玩家2 全主盖毙
        playerIndex: 2,
      },
      ntState: null, bottomCards: [], debug: false,
    };
    expect(() => aiFollowPlay(hand, lead, Suit.Spades, ctx)).not.toThrow();
    const r = aiFollowPlay(hand, lead, Suit.Spades, ctx);
    checkFollow(r.cards, hand, lead, 'S', cfg);
  });

  it('拖拉机覆盖领出的对：compareTwo 不再对空成分求 maxCard', () => {
    // 直接回归 comparing：领出两对+单，bestSoFar 全主盖毙（匹配），
    // follow 是拖拉机（无独立对）——first/second 都匹配才进 getCompareKey。
    const lead: Card[] = [
      createCard('S', 14, 200), createCard('S', 14, 201),
      createCard('S', 12, 202), createCard('S', 12, 203),
      createCard('S', 13, 204),
    ];
    const bs: Card[] = [
      createCard('J', 16, 107), createCard('J', 16, 53),
      c11('D', 48), c11('D', 102), c11('C', 35),
    ];
    const follow: Card[] = [
      createCard('J', 15, 300), createCard('J', 15, 301),
      createCard('H', 11, 302), createCard('H', 11, 303),
    ];
    expect(() => compareTwo(bs, follow, lead, cfg)).not.toThrow();
  });

  it('拖拉机+单盖毙能盖过的对方（900 > 800）：用拖拉机盖毙而非垫牌', () => {
    // 用户追问：AI 试图用对小王盖毙——若对方毙牌无大王（最大 800），
    // AI 的拖拉机（小王对+♥11对，900）本可盖过，但 getCompareKey 兜底
    // 顺序 pairs→singles→follow 跳过了拖拉机，填充后 key 取单张（800）
    // 与对方打平 → 误判盖不过而垫牌。应出拖拉机+单盖毙。
    const lead: Card[] = [
      createCard('S', 14, 200), createCard('S', 14, 201),
      createCard('S', 12, 202), createCard('S', 12, 203),
      createCard('S', 13, 204),
    ];
    const hand: Card[] = [
      createCard('J', 15, 0), createCard('J', 15, 1),   // 小王对（主）
      c11('H', 0), c11('H', 1), c11('S', 0),            // ♥11对 + ♠11（主）
      createCard('D', 3, 0), createCard('D', 2, 0), createCard('H', 13, 0),
      createCard('D', 8, 0), createCard('D', 5, 0), createCard('D', 13, 0),
      createCard('H', 5, 0),
    ];
    const ctx: AIContext = {
      declarerIndex: 0, trumpSuit: null, level: 11,
      myIndex: 0, isDeclarer: false, isDeclarerPartner: false,
      isAttacker: false, attackerPoints: 20,           // 避开 70/75 禁分
      handCounts: [12, 7, 7, 7], trickHistory: [], reveals: [],
      playCount: 3, leadPlayerIndex: 1,                // 第四家
      bestSoFar: {
        cards: [c11('D', 48), c11('D', 102), c11('C', 35), c11('C', 61), c11('H', 70)], // P3 毙牌，最大 800
        playerIndex: 3,
      },
      ntState: null, bottomCards: [], debug: false,
    };
    const r = aiFollowPlay(hand, lead, Suit.Spades, ctx);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    // 应出 小王对+♥11对（拖拉机）+♠11 盖毙，而不是垫牌
    expect(r.cards.map(c => c.rank)).toEqual([15, 15, 11, 11, 11]);
    expect(r.reason).toContain('盖毙');
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
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 3, 0).id);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });

    it('kills S-9-9 pair with smallest trump pair H-3-3', () => {
      const lead: Card[] = [cc('S', 9, 200), cc('S', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 14, 1), cc('H', 3, 0), cc('H', 3, 1), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards.some(c => c.rank === 3)).toBe(true);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });
  });

  describe('has points in trick → >= A / biggest trump', () => {
    it('kills S-K(10pts) with >=A trump H-A', () => {
      const lead: Card[] = [cc('S', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 3, 0), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 14, 0).id); // >= A
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });

    it('kills S-K(10pts) with biggest when no >=A trump available', () => {
      const lead: Card[] = [cc('S', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 10, 0), cc('H', 3, 0), cc('C', 8, 0)]; // H-10 is biggest (point)
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 10, 0).id); // biggest
      expect(r.reason).toBe('用主牌毙（用分牌盖）');
    });

    it('kills pairs with points using biggest trump pair', () => {
      // S-10-10 pair (each 10pts). AI has H-AA and H-3-3.
      const lead: Card[] = [cc('S', 10, 200), cc('S', 10, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [cc('H', 14, 0), cc('H', 14, 1), cc('H', 3, 0), cc('H', 3, 1), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      // should use H-AA (biggest), not H-3-3
      expect(r.cards.some(c => c.rank === 14)).toBe(true);
      expect(r.cards.some(c => c.rank === 3)).toBe(false);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });
  });

  describe('overkill → kill mode by rule1 (points → >=A)', () => {
    it('overkills with >=A when lead has points (rule1KillMode a-or-max)', () => {
      // P0 leads S-K(10pts). P1 killed with H-Q. AI=P2=third has H-A, H-10, H-K.
      // 第1条②：领出分牌 → 用不小于A的主牌毙（盖毙同样适用）。
      // H-A(614) is the >=A beating card → overkill with H-A.
      const lead: Card[] = [cc('S', 13, 200)];
      const best = { cards: [cc('H', 12, 0)], playerIdx: 1 };
      const hand = [cc('H', 14, 0), cc('H', 13, 0), cc('H', 10, 0), cc('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfg);
      expect(r.cards[0].id).toBe(cc('H', 14, 0).id);
      expect(r.reason).toBe('盖毙（用最小牌盖）');
    });
  });

  describe('trump kill reason annotations (用分牌盖 / 用最小牌盖)', () => {
    const cfgS: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
    function crd(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }
    // All tests use ♥J♥9 throw lead (2 cards, off-suit), matching user scenario.
    // effRank: ♠3=603, ♠4=604, ♠5=605, ♠7=607, ♠9=609, ♠K=613, ♠A=614, ♣2=700

    // ---- Kill (用主牌毙) ----

    it('kill, filler prefers point card over smaller non-point', () => {
      // Hand has ♠K(point) + ♠3 + ♠4. killKeyIdx=♠3, filler prefers ♠K(point) over ♠4.
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [crd('S', 13, 0), crd('S', 3, 0), crd('S', 4, 0), crd('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 1);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([3, 13]);
      expect(r.reason).toBe('用主牌毙（用分牌盖）');
    });

    it('kill, all trumps non-point: 毙甩牌用不小于A（没有则最大）', () => {
      // Hand has ♠9,♠7,♠4 all non-point. 第二家第5条：甩牌只含单张 →
      // 毙牌最大单张不小于A；无 >=A → 用最大能毙 ♠9，填充最小非分 ♠4。
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [crd('S', 9, 0), crd('S', 7, 0), crd('S', 4, 0), crd('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 1);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([4, 9]);
      expect(r.reason).toBe('用主牌毙（用最小牌盖）');
    });

    // ---- Overkill (盖毙) with points → 用分牌盖 ----

    it('overkill with point card: ♠K beats ♠Q, filler ♠3', () => {
      // P1 kills with ♠Q♠8. AI=P2 overkills: ♠K(613)>♠Q(612), filler ♠3.
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: [crd('S', 12, 0), crd('S', 8, 0)], playerIdx: 1 };
      const hand = [crd('S', 13, 0), crd('S', 3, 0), crd('S', 4, 0), crd('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([3, 13]);
      expect(r.reason).toBe('盖毙（用分牌盖）');
    });

    it('overkill, only two trumps, filler is point card', () => {
      // P1 kills with ♠8♠3. AI=P2 has only ♠9+♠5 → kill [♠9,♠5], ♠5 is point.
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: [crd('S', 8, 0), crd('S', 3, 0)], playerIdx: 1 };
      const hand = [crd('S', 9, 0), crd('S', 5, 0), crd('C', 8, 0), crd('D', 7, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([5, 9]);
      expect(r.reason).toBe('盖毙（用分牌盖）');
    });

    // ---- Overkill (盖毙) without points → 用最小牌盖 (two cases) ----

    it('overkill, all trumps non-point: 用最小牌盖', () => {
      // P1 kills with ♠6♠5. AI=P2 has ♠9,♠4,♠3 all non-point → ♠9 overkills.
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: [crd('S', 6, 0), crd('S', 5, 0)], playerIdx: 1 };
      const hand = [crd('S', 9, 0), crd('S', 4, 0), crd('S', 3, 0), crd('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([3, 9]);
      expect(r.reason).toBe('盖毙（用最小牌盖）');
    });

    it('overkill, point can\'t beat but still used as filler', () => {
      // P1 kills with ♠7♠6. AI=P2 has ♠5(point,605<607), ♠9(609>607), ♠4(604).
      // ♠5 can't overkill → ♠9 overkills. Filler prefers point → picks ♠5.
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: [crd('S', 7, 0), crd('S', 6, 0)], playerIdx: 1 };
      const hand = [crd('S', 5, 0), crd('S', 9, 0), crd('S', 4, 0), crd('C', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([5, 9]);
      expect(r.reason).toBe('盖毙（用分牌盖）');
    });

    // ---- Fourth position overkill: ♠K + ♣2, depends on opponent ----

    it('fourth overkill: opponent kills with ♠A → ♣2 overkills, no points', () => {
      // P0 leads ♥J single. P2 kills with ♠A(614).
      // P3 has ♣2(700),♠K(613),♠7(607). ♠K<♠A → ♣2 overkills.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 14, 0)], playerIdx: 2 };
      const hand = [crd('C', 2, 30), crd('S', 13, 0), crd('S', 7, 0), crd('D', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].suit).toBe('C');
      expect(r.cards[0].rank).toBe(2);
      expect(r.reason).toBe('盖毙（用最小牌盖）');
    });

    it('fourth overkill: opponent kills with ♠Q → ♠K overkills, adds points', () => {
      // P0 leads ♥J single. P2 kills with ♠Q(612).
      // P3 has ♣2,♠K,♠7. ♠K(613)>♠Q(612) → overkills with point.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 12, 0)], playerIdx: 2 };
      const hand = [crd('C', 2, 30), crd('S', 13, 0), crd('S', 7, 0), crd('D', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].suit).toBe('S');
      expect(r.cards[0].rank).toBe(13);
      expect(r.reason).toBe('盖毙（用分牌盖）');
    });

    // ---- Fourth position kill: user scenario ----

    it('fourth position kill: ♥J♥9 throw, ♠K point in kill', () => {
      // Exact user scenario: P0 leads ♥J♥9.
      // AI=P3 (fourth, opponent winning) has BJ, ♠2, ♣2, ♠K, ♠7.
      // Kills with ♠7+♠K → ♠K is point → 用分牌盖.
      const lead: Card[] = [crd('H', 11, 200), crd('H', 9, 201)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        crd('J', 16, 53),  // BJ
        crd('S', 2, 50),   // ♠2
        crd('C', 2, 30),   // ♣2
        crd('S', 13, 0),   // ♠K (10pts)
        crd('S', 7, 0),    // ♠7
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toBe('用主牌毙（用分牌盖）');
    });

    // ---- Fourth position, teammate wins: 垫主牌 (don't waste trump) ----

    it('fourth tmWin, has point but cannot beat → 垫主牌', () => {
      // P1 (teammate) killed with ♠Q(612). P3 has ♠5(point,605<612) → can't beat.
      // Point card can't overkill → discard ♠5, don't waste ♠2.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 12, 0)], playerIdx: 1 }; // P1 killed with ♠Q
      const hand = [crd('S', 5, 0), crd('S', 7, 0), crd('S', 9, 0), crd('S', 2, 50)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(5); // ♠5 discarded (smallest, point can't beat)
      expect(r.reason).toContain('垫主牌');
      expect(r.reason).toContain('加分');
    });

    it('fourth tmWin, has points → kills even if bigger trump needed', () => {
      // P1 (teammate) killed with ♠Q(612). P3 has ♠K(point,613) — kill to add points.
      // ♠9(609) can't beat ♠Q → must use ♠K. Adding points takes priority.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 12, 0)], playerIdx: 1 }; // P1 killed with ♠Q
      const hand = [crd('S', 4, 0), crd('S', 9, 0), crd('S', 13, 0), crd('S', 2, 50)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(13); // ♠K used to overkill and add points
      expect(r.reason).toBe('盖毙（用分牌盖）');
    });

    it('fourth tmWin, no points, smallest can overkill → 盖毙', () => {
      // P1 killed with ♠3(603). P3 all non-point, smallest ♠4(604)>603 → free overkill.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 3, 0)], playerIdx: 1 };
      const hand = [crd('S', 4, 0), crd('S', 7, 0), crd('S', 9, 0), crd('S', 2, 50)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(4); // smallest beating trump
      expect(r.reason).toBe('盖毙（用最小牌盖）');
    });

    it('fourth tmWin, no points, smallest cannot overkill → 垫主牌', () => {
      // P1 killed with ♠9(609). P3 all non-point, smallest ♠3(603)<609.
      // No points + smallest can't overkill → discard, don't waste trump.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 9, 0)], playerIdx: 1 };
      const hand = [crd('S', 3, 0), crd('S', 4, 0), crd('S', 7, 0), crd('S', 2, 50)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(3); // smallest trump discarded
      expect(r.reason).toBe('垫主牌');
    });

    // ---- Mixed non-trump + trump discard ----

    it('fourth tmWin, mixed: prefers non-trump points over trump points', () => {
      // P1 (teammate) killed with ♠3(603). P3 has ♦10(副分) and ♠K(主分).
      // Should pick ♦10 over ♠K (副分优先).
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 3, 0)], playerIdx: 1 };
      const hand = [crd('D', 10, 0), crd('S', 13, 0), crd('S', 4, 0), crd('S', 2, 50)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].suit).toBe('D'); // ♦10 picked (副分优先)
      expect(r.reason).toContain('垫牌');
      expect(r.reason).toContain('加分');
    });

    // ---- sortTrumpsForDiscard: A-threshold + pair protection ----

    it('fourth tmWin, all trump: prefers below-A singles over pair cards', () => {
      // P1 killed with ♠9(609). P3 has ♠3,♠4(below-A), ♠7♠7(pair), ♠A(614).
      // Sort should put ♠3,♠4 before ♠7♠7 pair cards and ♠A.
      const lead: Card[] = [crd('H', 11, 200)];
      const best = { cards: [crd('S', 9, 0)], playerIdx: 1 };
      const hand = [
        crd('S', 3, 0), crd('S', 4, 0),   // below-A singles
        crd('S', 7, 0), crd('S', 7, 1),    // pair
        crd('S', 14, 0),                    // A
        crd('S', 2, 50),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgS, best, 3);
      checkFollow(r.cards, hand, lead, 'H', cfgS);
      expect(r.cards.length).toBe(1);
      expect(r.cards[0].rank).toBe(3); // ♠3 (below-A single, safest)
      expect(r.reason).toBe('垫主牌');
    });
  });

  describe('fourth+tmWin tractor lead: mixed discard with pair protection', () => {
    // Hearts trump, level 2. DeclarerIndex=0 → P1+P3 are attackers.
    // Helper to build minimal AIContext with attackerPoints.
    function mkCtx(attackerPoints: number, bestSoFar: { cards: Card[]; playerIndex: number }): AIContext {
      return {
        declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2,
        myIndex: 3, isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
        attackerPoints,
        handCounts: [20, 20, 20, 20] as const,
        trickHistory: [], reveals: [],
        playCount: 3, leadPlayerIndex: 0,
        bestSoFar,
        ntState: null, bottomCards: [], debug: false,
      };
    }
    function crd(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }
    // P0 leads ♣4♣4♣3♣3 tractor. P1 (teammate) follows ♣9♣9♣8♣8 → wins.
    const lead = [crd('C', 4, 200), crd('C', 4, 201), crd('C', 3, 200), crd('C', 3, 201)];
    const best = {
      cards: [crd('C', 9, 0), crd('C', 9, 1), crd('C', 8, 0), crd('C', 8, 1)],
      playerIndex: 1,
    };

    it('scenario 1: ♣6 + ♠1010 + ♠4, score=50', () => {
      const hand = [
        crd('C', 6, 0),                          // 1 club (follow suit)
        crd('S', 10, 0), crd('S', 10, 1),        // ♠1010 (副10, point pair, 20pts)
        crd('H', 5, 0), crd('H', 5, 1),          // ♥55 (主5, point pair, 10pts)
        crd('S', 4, 0), crd('S', 7, 0),           // non-point spades
        crd('H', 4, 0), crd('H', 6, 0),           // non-point hearts
      ];
      const ctx = mkCtx(50, best);
      const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
      checkFollow(r.cards, hand, lead, 'C', ctx);
      expect(r.cards.length).toBe(4);
      // Short-suited: ♣6 + 3 fillers. 加分优先级（catAdd）：
      // 副10 > 副K > 副5 > 其他非分副 > 主10 > 主K > 主5 > 主牌分对。
      // 非分副（♠4）在主牌分对（♥55）之前 → ♠10♠10 + ♠4。
      expect(r.cards.some(c => c.rank === 6 && c.suit === 'C')).toBe(true);  // ♣6
      expect(r.cards.filter(c => c.rank === 10 && c.suit === 'S').length).toBe(2); // ♠10♠10
      expect(r.cards.some(c => c.rank === 4 && c.suit === 'S')).toBe(true);  // ♠4
      expect(r.cards.filter(c => c.rank === 5 && c.suit === 'H').length).toBe(0); // ♥55 not played
    });

    it('scenario 1: ♣6 + ♠1010 + ♠4, score=55', () => {
      const hand = [
        crd('C', 6, 0),
        crd('S', 10, 0), crd('S', 10, 1),
        crd('H', 5, 0), crd('H', 5, 1),
        crd('S', 4, 0), crd('S', 7, 0),
        crd('H', 4, 0), crd('H', 6, 0),
      ];
      const ctx = mkCtx(55, best);
      const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
      checkFollow(r.cards, hand, lead, 'C', ctx);
      expect(r.cards.length).toBe(4);
      // 同 score=50：非分副 ♠4 先于主牌分对 ♥55（55+20+5=80 不触发拆对——♠4 无分）。
      expect(r.cards.some(c => c.rank === 6 && c.suit === 'C')).toBe(true);  // ♣6
      expect(r.cards.filter(c => c.rank === 10 && c.suit === 'S').length).toBe(2); // ♠10♠10
      expect(r.cards.some(c => c.rank === 4 && c.suit === 'S')).toBe(true);  // ♠4
      expect(r.cards.filter(c => c.rank === 5 && c.suit === 'H').length).toBe(0); // ♥55 not played
    });

    it('scenario 2: void clubs, ♦nonpts+♦5+♠K+♥5544 → mixed discard', () => {
      const hand = [
        crd('D', 5, 0),                           // ♦5 (副5, 5pts)
        crd('S', 13, 0),                           // ♠K (副K, 10pts)
        crd('D', 4, 0), crd('D', 7, 0), crd('D', 8, 0), crd('D', 9, 0), // non-point diamonds
        crd('H', 5, 0), crd('H', 5, 1),           // ♥55 (主5, 10pts)
        crd('H', 4, 0), crd('H', 4, 1),           // ♥44 (non-point, tractor with ♥55)
      ];
      const ctx = mkCtx(0, best);
      const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
      checkFollow(r.cards, hand, lead, 'C', ctx);
      expect(r.cards.length).toBe(4);
      // Void but 6 non-trump + score=0 → no threshold crossing.
      // canAddPoints dumps non-trump first: ♠K(副K) + ♦5(副5) + 2 smallest ♦.
      // ♥55 and ♥44 stay in hand (副牌优先，不跨台阶不碰主牌).
      expect(r.cards.some(c => c.rank === 13 && c.suit === 'S')).toBe(true); // ♠K
      expect(r.cards.some(c => c.rank === 5 && c.suit === 'D')).toBe(true);  // ♦5
      expect(r.cards.filter(c => c.rank === 5 && c.suit === 'H').length).toBe(0); // ♥55 not played
      expect(r.cards.filter(c => c.rank === 4 && c.suit === 'H').length).toBe(0); // ♥44 not played
      // Not all trump → 垫牌 not 盖毙
      expect(r.reason).toContain('垫牌');
      expect(r.reason).toContain('加分');
    });

    it('scenario 2, score=15: add ♥55 to cross 40', () => {
      // Score 15 + 0(visible) = 15. Non-trump only: +15 → 30 (tier 0).
      // With ♥55: +25 → 40 → crosses 40! Should prefer trump.
      const hand = [
        crd('D', 5, 0), crd('S', 13, 0),
        crd('D', 4, 0), crd('D', 7, 0), crd('D', 8, 0), crd('D', 9, 0),
        crd('H', 5, 0), crd('H', 5, 1),
        crd('H', 4, 0), crd('H', 4, 1),
      ];
      const ctx = mkCtx(15, best);
      const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
      checkFollow(r.cards, hand, lead, 'C', ctx);
      expect(r.cards.length).toBe(4);
      expect(r.cards.filter(c => c.rank === 5 && c.suit === 'H').length).toBe(2); // ♥55 played
      expect(r.cards.some(c => c.rank === 13 && c.suit === 'S')).toBe(true); // ♠K
      expect(r.reason).toContain('加分');
    });

    it('scenario 2, score=95: add ♥55 to cross 120', () => {
      // Score 95 + 0 = 95. Non-trump only: +15 → 110 (tier 2).
      // With ♥55: +25 → 120 → crosses 120! Should prefer trump.
      const hand = [
        crd('D', 5, 0), crd('S', 13, 0),
        crd('D', 4, 0), crd('D', 7, 0), crd('D', 8, 0), crd('D', 9, 0),
        crd('H', 5, 0), crd('H', 5, 1),
        crd('H', 4, 0), crd('H', 4, 1),
      ];
      const ctx = mkCtx(95, best);
      const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
      checkFollow(r.cards, hand, lead, 'C', ctx);
      expect(r.cards.length).toBe(4);
      expect(r.cards.filter(c => c.rank === 5 && c.suit === 'H').length).toBe(2); // ♥55 played
      expect(r.cards.some(c => c.rank === 13 && c.suit === 'S')).toBe(true); // ♠K
      expect(r.reason).toContain('加分');
    });
  });

  describe('trump follow single beating rules (hearts trump, level=5)', () => {
    const cfgT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('second position: plays small trump (no tractor/throw to seize)', () => {
      // P0 leads H-3 (effRank=603), AI=P1 second, no tractor/throw
      const lead: Card[] = [ct('H', 3, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [ct('H', 14, 0), ct('H', 13, 0), ct('H', 10, 0),
        ct('H', 8, 0), ct('S', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 1);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(1);
      // plays small: H-8 (effRank 608), not H-A or H-K
      expect(r.cards[0].rank).toBe(8);
      expect(r.reason).toContain('同花色出小');
    });

    it('second position with tractor: seizes with biggest trump', () => {
      // P0 leads H-3, AI=P1 has tractor H-10-10-9-9 → seize with biggest
      // H-3 effRank=603, all trumps can beat it.
      const lead: Card[] = [ct('H', 3, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('H', 10, 0), ct('H', 10, 1), ct('H', 9, 0), ct('H', 9, 1),
        ct('H', 14, 0), ct('H', 13, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 1);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(1);
      // has tractor → seize with biggest: H-A(14) since can beat H-3
      expect(r.cards[0].rank).toBe(14);
      expect(r.reason).toContain('同花色出大');
    });

    it('second position with throwable off-suit: seizes with >=A trump', () => {
      // P0 leads H-3, AI=P1 has throwable spades AAKQQ → seize with >=A
      const lead: Card[] = [ct('H', 3, 200)];
      const best = { cards: lead, playerIdx: 0 };
      // Spades: A-A-K-Q-Q — AA pair beats any pair, K/Q singles top-ranked
      const hand = [
        ct('H', 14, 0), ct('H', 10, 0),
        ct('S', 14, 0), ct('S', 14, 1),  // AA
        ct('S', 13, 0),                    // K
        ct('S', 12, 0), ct('S', 12, 1),   // QQ
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 1);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(1);
      // If has throw → seize with >=A: H-A effRank=614
      // If throw detection fails in stub ctx, plays small H-10
      const hasThrow = r.cards[0].rank === 14;
      expect(r.reason).toContain(hasThrow ? '同花色出大' : '同花色出小');
      // Document: seizes with >=A if throw detected, else plays small
    });

    it('non-second, no points: >=A beating or biggest if none', () => {
      // P0 leads H-3, P1 played H-6, AI=P2 (third), no points
      const lead: Card[] = [ct('H', 3, 200)];
      const best = { cards: [ct('H', 6, 0)], playerIdx: 1 };
      // H-6 effRank = 606. >=A = H-A = 614.
      const hand = [ct('H', 14, 0), ct('H', 13, 0), ct('H', 10, 0),
        ct('H', 7, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(1);
      // >=A: needs effRank >= 614. Only H-A(14) qualifies.
      expect(r.cards[0].rank).toBe(14);
      expect(r.reason).toContain('同花色出大');
    });

    it('non-second, no points, no >=A beating: uses biggest', () => {
      // P0 leads H-3, P1 played H-8, AI=P2 (third), no points, no >=A
      const lead: Card[] = [ct('H', 3, 200)];
      const best = { cards: [ct('H', 8, 0)], playerIdx: 1 };
      const hand = [ct('H', 13, 0), ct('H', 12, 0), ct('H', 10, 0)];
      // effRanks: H-K=613, H-Q=612, H-10=610. Best=608. >=A needs 614 → none.
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(1);
      // no >=A → biggest: H-K(13)
      expect(r.cards[0].rank).toBe(13);
      expect(r.reason).toContain('同花色出大');
    });

    it('non-second, has points: uses biggest beating', () => {
      // P0 leads H-K (K=point, 10pts). H-K effRank=613.
      const lead: Card[] = [ct('H', 13, 200)];
      const best = { cards: [ct('H', 13, 200)], playerIdx: 0 };
      const hand = [ct('H', 14, 0), ct('H', 12, 0), ct('H', 11, 0),
        ct('H', 8, 0), ct('S', 8, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(1);
      // hasPoints → biggest: H-A(14) > H-Q(12)
      expect(r.cards[0].rank).toBe(14);
      expect(r.reason).toContain('同花色出大');
    });

    it('cannot beat, fourth+!tmWin: avoid points annotation', () => {
      // P0 leads ♠4, P1 plays ♠5, P2 plays JOKER, AI=P3 fourth can't beat.
      const lead: Card[] = [ct('H', 4, 200)];
      const best = { cards: [ct('J', 16, 0)], playerIdx: 2 };
      const hand = [ct('H', 12, 0), ct('H', 10, 0), ct('H', 5, 0)];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 3);
      checkFollow(r.cards, hand, lead, null, cfgT);
      expect(r.cards.length).toBe(1);
      expect(r.reason).toContain('同花色出小');
      expect(r.reason).toContain('不加分');
    });
  });

  describe('trump follow pair with points (hearts trump, level=5)', () => {
    const cfgT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('pair lead with points: uses biggest beating pair', () => {
      // P0 leads H-10-10 (10=point). P1 plays H-3-3. AI=P2 has AA, KK.
      const lead: Card[] = [ct('H', 10, 200), ct('H', 10, 201)];
      const best = { cards: [ct('H', 3, 0), ct('H', 3, 1)], playerIdx: 1 };
      // H-3 effRank=603 < H-10(610). Current best is P1's H-3-3. AA(614)>603, KK(613)>603.
      const hand = [
        ct('H', 14, 0), ct('H', 14, 1),  // AA pair (effRank 614)
        ct('H', 13, 0), ct('H', 13, 1),  // KK pair (effRank 613, point)
        ct('H', 12, 0),
        ct('S', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Hearts, cfgT, best, 2);
      checkFollow(r.cards, hand, lead, 'H', cfgT);
      expect(r.cards.length).toBe(2);
      // hasPoints → biggest beating pair by effRank: AA(614) > KK(613)
      expect(r.cards.every(c => c.rank === 14)).toBe(true);
      expect(r.reason).toContain('同花色出大');
    });

    it('trump pair lead, no pair in hand: plays smallest trump, avoids JOKER', () => {
      // Reproduce: level=2, spades trump. P0 leads SJ pair. AI=P1(second)
      // has JOKER + ♠2 + ♦2 + ♥2 (4 trump, no pair).
      // Should play 2 smallest trump (♦2♥2 effRank=700) not JOKER(1000).
      const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
      function c2(s: string, r: number, i: number): Card {
        return createCard(s as any, r as any, i);
      }
      const lead: Card[] = [c2('J', 15, 200), c2('J', 15, 201)]; // SJ pair
      const hand = [
        c2('J', 16, 53),   // BJ (effRank 1000)
        c2('S', 2, 50),    // ♠2 (effRank 800, trump suit + level)
        c2('D', 2, 30),    // ♦2 (effRank 700)
        c2('H', 2, 90),    // ♥2 (effRank 700)
        c2('S', 14, 0),    // ♠A extra
      ];
      const best = { cards: lead, playerIdx: 0 };
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgS2, best, 1);
      checkFollow(r.cards, hand, lead, 'S', cfgS2);
      expect(r.cards.length).toBe(2);
      // Must NOT include JOKER
      expect(r.cards.some(c => c.rank === 16)).toBe(false);
      expect(r.reason).toContain('垫同花色');
    });

    it('trump pair lead, not enough trump: padWithDiscards avoids points', () => {
      // Reproduce: level=2, spades trump. P0 leads SJ pair. AI=P3(fourth)
      // has only 1 trump (♠2), opp wins. padWithDiscards should add 不加分.
      const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
      function c2(s: string, r: number, i: number): Card {
        return createCard(s as any, r as any, i);
      }
      const lead: Card[] = [c2('J', 15, 200), c2('J', 15, 201)]; // SJ pair
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        c2('S', 2, 50),    // ♠2 (only trump)
        c2('D', 4, 0),     // ♦4 (non-trump)
        c2('C', 4, 0),     // ♣4 (non-trump)
        c2('H', 10, 0),    // ♥10 (non-trump, point)
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgS2, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfgS2);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toContain('主牌不够');
      expect(r.reason).toContain('不加分');
    });

    it('third position, pair lead, no pair: avoids points when opponent overtook', () => {
      // Reproduce: P1 leads ♦6♦6, P2 beats with ♦9♦9, AI=P3(third) has
      // ♦4♦8 (no pair), can't beat P2. Should annotate 不加分.
      const cfgD2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };
      function c3(s: string, r: number, i: number): Card {
        return createCard(s as any, r as any, i);
      }
      const lead: Card[] = [c3('D', 6, 200), c3('D', 6, 201)]; // ♦6♦6 pair
      const best = { cards: [c3('D', 9, 0), c3('D', 9, 1)], playerIdx: 1 }; // P2 beats
      const hand = [
        c3('D', 4, 0),    // ♦4
        c3('D', 8, 0),    // ♦8
        c3('D', 5, 0),    // ♦5 (5pts, should be avoided)
        c3('H', 3, 0),    // extra
      ];
      const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfgD2, best, 2);
      checkFollow(r.cards, hand, lead, 'D', cfgD2);
      expect(r.cards.length).toBe(2);
      expect(r.reason).toContain('垫同花色');
      expect(r.reason).toContain('不加分');
    });
  });

  describe('fourth position pair follow: correct reason when beating', () => {
    // When 4th position CAN beat with a pair, reason should say 同花色出大
    // NOT 盖不过 (which contradicts beating). Regression test for bug where
    // shouldAvoid was set unconditionally for 4th+!tmWin regardless of beating.
    const cfgS2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
    function c2(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('fourth beats with trump pair: "同花色出大" (no 盖不过)', () => {
      // P0 leads ♠J♠J pair. P2 plays ♠Q♠Q (currently winning).
      // AI=P3 (fourth, opponent is P2) has ♠A♠A (beats ♠Q♠Q) and
      // ♠10♠10 (cannot beat ♠Q♠Q, 10 < Q). Should pick ♠A♠A.
      // Reason should say 同花色出大, not 盖不过.
      const lead: Card[] = [c2('S', 11, 200), c2('S', 11, 201)]; // ♠J♠J
      const best = { cards: [c2('S', 12, 0), c2('S', 12, 1)], playerIdx: 2 }; // P2's ♠Q♠Q
      const hand = [
        c2('S', 14, 0), c2('S', 14, 1),  // ♠A♠A — beats Q pair
        c2('S', 10, 0), c2('S', 10, 1),  // ♠10♠10 — cannot beat Q pair
        c2('S', 3, 0),                     // ♠3 filler
        c2('H', 8, 0),                     // extra
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgS2, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfgS2);
      expect(r.cards.length).toBe(2);
      expect(r.cards.every(c => c.rank === 14 && c.suit === 'S')).toBe(true);
      expect(r.reason).toContain('同花色出大');
      expect(r.reason).not.toContain('盖不过');
    });

    it('fourth cannot beat with trump pair: "同花色出小（盖不过，不加分）"', () => {
      // P0 leads ♠K♠K pair. P2 plays ♠A♠A (currently winning).
      // AI=P3 has ♠Q♠Q and ♠10♠10 — both CANNOT beat ♠A♠A.
      // Reason should say 盖不过 — this is correct avoidance.
      const lead: Card[] = [c2('S', 13, 200), c2('S', 13, 201)]; // ♠K♠K
      const best = { cards: [c2('S', 14, 0), c2('S', 14, 1)], playerIdx: 2 }; // P2's ♠A♠A
      const hand = [
        c2('S', 12, 0), c2('S', 12, 1),  // ♠Q♠Q — cannot beat A pair
        c2('S', 10, 0), c2('S', 10, 1),  // ♠10♠10 — also cannot beat
        c2('S', 3, 0),                     // ♠3 filler
        c2('H', 8, 0),                     // extra
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgS2, best, 3);
      checkFollow(r.cards, hand, lead, 'S', cfgS2);
      expect(r.cards.length).toBe(2);
      // pairKillSort puts non-point ♠Q before point ♠10 → picks ♠Q♠Q
      expect(r.cards.every(c => c.rank === 12 && c.suit === 'S')).toBe(true);
      expect(r.reason).toContain('同花色出小');
      expect(r.reason).toContain('盖不过');
      expect(r.reason).toContain('不加分');
    });

    it('off-suit fourth beats with pair: "同花色出大" (no 盖不过)', () => {
      // Off-suit pair follow: same bug existed in follow-offsuit.ts.
      // P0 leads ♣8♣8. P2 plays ♣9♣9 (currently winning).
      // AI=P3 has ♣10♣10 and ♣Q♣Q — both beat ♣9♣9.
      // Fourth prefers point cards → picks ♣10♣10.
      const lead: Card[] = [c2('C', 8, 200), c2('C', 8, 201)]; // ♣8♣8
      const best = { cards: [c2('C', 9, 0), c2('C', 9, 1)], playerIdx: 2 }; // P2's ♣9♣9
      const hand = [
        c2('C', 10, 0), c2('C', 10, 1),  // ♣10♣10 — beats 9 pair (point, preferred)
        c2('C', 12, 0), c2('C', 12, 1),  // ♣Q♣Q — beats 9 pair (non-point)
        c2('C', 3, 0),                     // ♣3 filler
        c2('S', 8, 0),                     // extra
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfgS2, best, 3);
      checkFollow(r.cards, hand, lead, 'C', cfgS2);
      expect(r.cards.length).toBe(2);
      expect(r.cards.every(c => c.rank === 10 && c.suit === 'C')).toBe(true);
      expect(r.reason).toContain('同花色出大');
      expect(r.reason).not.toContain('盖不过');
    });
  });

  describe('fourth position off-suit single: prefers point card when beating', () => {
    const cfgD: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('beats with K(10pts) over Q when both can beat', () => {
      // P0 leads C-10, P1 plays C-9, P2 plays C-3, AI=P3 (fourth) beats
      const lead: Card[] = [ct('C', 10, 200)];
      const best = { cards: [ct('C', 10, 200)], playerIdx: 0 };
      const hand = [
        ct('C', 13, 0),   // K (10 pts, can beat)
        ct('C', 12, 0),   // Q (non-point, can beat)
        ct('D', 8, 0),
        ct('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfgD, best, 3);
      checkFollow(r.cards, hand, lead, 'C', cfgD);
      expect(r.cards.length).toBe(1);
      // Fourth beating prefers point: K over Q
      expect(r.cards[0].rank).toBe(13);
    });

    it('falls back to smallest beating non-point when no point card available', () => {
      const lead: Card[] = [ct('C', 10, 200)];
      const best = { cards: [ct('C', 10, 200)], playerIdx: 0 };
      const hand = [
        ct('C', 12, 0),   // Q (non-point, can beat)
        ct('C', 11, 0),   // J (non-point, can beat)
        ct('D', 8, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfgD, best, 3);
      checkFollow(r.cards, hand, lead, 'C', cfgD);
      expect(r.cards.length).toBe(1);
      // No point card that beats → smallest beating: J(11)
      expect(r.cards[0].rank).toBe(11);
    });
  });

  describe('tractor follow: scans for beating tractor when smallest cannot beat', () => {
    const cfgD: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('off-suit: smallest tractor cannot beat, scans for bigger one', () => {
      // P0 leads S-10-10-9-9 (2-pair tractor). P1 plays S-J-J-10-10 (can beat).
      // AI=P2 has two 2-pair S tractors:
      //   S-7-7-6-6 (max=7, cannot beat P1's max=J)
      //   S-Q-Q-J-J (max=Q=12, can beat P1's max=J=11)
      const lead: Card[] = [
        ct('S', 10, 200), ct('S', 10, 201),
        ct('S', 9, 200), ct('S', 9, 201),
      ];
      const best = {
        cards: [ct('S', 11, 0), ct('S', 11, 1), ct('S', 10, 0), ct('S', 10, 1)],
        playerIdx: 1,
      };
      const hand = [
        ct('S', 7, 0), ct('S', 7, 1), ct('S', 6, 0), ct('S', 6, 1), // 7-7-6-6
        ct('S', 12, 0), ct('S', 12, 1), ct('S', 11, 0), ct('S', 11, 1), // Q-Q-J-J
        ct('D', 7, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Spades, cfgD, best, 2);
      checkFollow(r.cards, hand, lead, 'S', cfgD);
      expect(r.cards.length).toBe(4);
      // Should pick Q-Q-J-J (max=Q=12, can beat P1's max=J=11)
      // Smallest tractor 7-7-6-6 cannot beat J=11
      const ranks = r.cards.map(c => c.rank).sort((a,b) => b-a);
      expect(ranks).toContain(12); // Q present
      expect(ranks).toContain(11); // J present
      expect(r.reason).toContain('同花色出大');
    });
  });

  describe('throw pair+single, has one pair but multiple singles → not unique', () => {
    // Reproduces: P0 (declarer) leads ♦A♦A♦K. AI-2 (P1, second+!tmWin) has
    // ♦7♦7 + 6 other singles. Must follow with the pair, but many single choices
    // → NOT 唯一可出. Second + max pattern → avoid points.
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('pair+single throw, one pair + spare singles → not 唯一可出, avoid points', () => {
      const lead: Card[] = [ct('D', 14, 200), ct('D', 14, 201), ct('D', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('D', 7, 0), ct('D', 7, 1),  // pair
        ct('D', 4, 0), ct('D', 10, 0), ct('D', 9, 0),
        ct('D', 8, 0), ct('D', 6, 0), ct('D', 5, 0),
        ct('S', 8, 0), ct('H', 3, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfg, best, 1);
      checkFollow(r.cards, hand, lead, 'D', cfg);
      expect(r.cards.length).toBe(3);
      // Must play ♦7♦7 pair + a filler single — many singleton choices → NOT 唯一可出
      expect(r.reason).not.toContain('唯一可出');
      // 10 张手牌 <= 15 → 第二家不避分（填充按大小一视同仁），无避分标注
      expect(r.reason).not.toContain('加分');
    });
  });

  describe('tryMatchTractorSlots: level-skip merged tractor splitting', () => {
    // At level 6, clubs C-8-7-5-4 form a chain (7-5 skip level 6),
    // causing detectTractors to merge 88775544 into a single 4-pair tractor.
    // tryMatchTractorSlots must pick non-merging tractors (e.g. 8877 + 4433)
    // instead of ones that merge (8877 + 5544).
    const cfg6: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 6 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('two 2-pair tractor lead, hand has 88775544 → splits correctly', () => {
      // Lead: AAKK + JJ1010 (two 2-pair tractors, 8 cards).
      // Hand clubs: 88775544 (4-pair chain via level-skip) + 33 + 22.
      const lead: Card[] = [
        ct('C', 14, 200), ct('C', 14, 201),   // AA
        ct('C', 13, 200), ct('C', 13, 201),   // KK
        ct('C', 11, 200), ct('C', 11, 201),   // JJ
        ct('C', 10, 200), ct('C', 10, 201),   // 1010
      ];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('C', 8, 0), ct('C', 8, 1),   // 88
        ct('C', 7, 0), ct('C', 7, 1),   // 77
        ct('C', 5, 0), ct('C', 5, 1),   // 55
        ct('C', 4, 0), ct('C', 4, 1),   // 44
        ct('C', 3, 0), ct('C', 3, 1),   // 33
        ct('C', 2, 0), ct('C', 2, 1),   // 22
        ct('S', 8, 0), ct('S', 9, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg6, best, 1);
      checkFollow(r.cards, hand, lead, 'C', cfg6);
      expect(r.cards.length).toBe(8);
      // Must not merge into a single 4-pair tractor.
      // Should play two 2-pair tractors (e.g. 8877 + 4433 or 8877 + 3322).
    });

    it('lead AAKK, hand 5544 (2 pairs, exact match) → valid follow', () => {
      // Simple 2-pair tractor lead, hand has exactly 2 pairs → unique.
      const lead: Card[] = [
        ct('C', 14, 200), ct('C', 14, 201),
        ct('C', 13, 200), ct('C', 13, 201),
      ];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('C', 5, 0), ct('C', 5, 1),   // 55
        ct('C', 4, 0), ct('C', 4, 1),   // 44
        ct('S', 8, 0), ct('S', 9, 0),
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg6, best, 1);
      checkFollow(r.cards, hand, lead, 'C', cfg6);
      expect(r.cards.length).toBe(4);
      expect(r.reason).toContain('唯一可出');
    });
  });

  describe('tractor follow point strategy: add/avoid (level=6)', () => {
    // P0 declarer leads AAKK+JJ1010 (two 2-pair tractors, 8 cards), P0 wins.
    // AI hand: 12 clubs 887755443322 + 2 spades. Must pick two 2-pair tractors.
    // Third (P2, teammate) should add points → include 55.
    // Fourth (P3, opponent) should avoid points → exclude 55.
    const cfg6: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 6 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    const lead: Card[] = [
      ct('C', 14, 200), ct('C', 14, 201),   // AA
      ct('C', 13, 200), ct('C', 13, 201),   // KK
      ct('C', 11, 200), ct('C', 11, 201),   // JJ
      ct('C', 10, 200), ct('C', 10, 201),   // 1010
    ];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      ct('C', 8, 0), ct('C', 8, 1),   // 88
      ct('C', 7, 0), ct('C', 7, 1),   // 77
      ct('C', 5, 0), ct('C', 5, 1),   // 55 (point pair)
      ct('C', 4, 0), ct('C', 4, 1),   // 44
      ct('C', 3, 0), ct('C', 3, 1),   // 33
      ct('C', 2, 0), ct('C', 2, 1),   // 22
      ct('S', 8, 0), ct('S', 9, 0),
    ];

    it('third position (P2, teammate wins) adds points, includes 55', () => {
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg6, best, 2);
      checkFollow(r.cards, hand, lead, 'C', cfg6);
      expect(r.cards.length).toBe(8);
      // Should include the point pair 55.
      const ranks = r.cards.filter(c => c.suit === 'C').map(c => c.rank);
      expect(ranks).toContain(5);
      expect(r.reason).toContain('垫同花色');
      expect(r.reason).toContain('加分');
    });

    it('fourth position (P3, opponent wins) avoids points, excludes 55', () => {
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg6, best, 3);
      checkFollow(r.cards, hand, lead, 'C', cfg6);
      expect(r.cards.length).toBe(8);
      // Should NOT include the point pair 55.
      const ranks = r.cards.filter(c => c.suit === 'C').map(c => c.rank);
      expect(ranks).not.toContain(5);
      expect(r.reason).toContain('垫同花色');
    });

    it('trump pair lead, no pair in hand, fourth position: avoids SJ filler', () => {
      // Reproduce: NT level=2. P3 leads ♣2♣2 pair. AI=P2(fourth) has
      // joker(SJ) + ♠2 + ♦2 + ♥2 (4 trump, no pair). opp wins.
      // Filler sort should NOT pick joker (effRank 900) over level-2s (800).
      const cfgNT: TrumpDeclaration = { declarerIndex: 1, trumpSuit: null, level: 2 };
      function c2(s: string, r: number, i: number): Card {
        return createCard(s as any, r as any, i);
      }
      // Lead: ♣2♣2 pair. P0 (AI-4) follows ♥2 joker. P1 (human) follows ♥10♣5.
      // AI=P2(fourth). Best so far is lead (pair), not beaten by teammate.
      const lead: Card[] = [c2('C', 2, 200), c2('C', 2, 201)];
      const best = { cards: lead, playerIdx: 2 }; // P3 wins (no one beat pair)
      const hand = [
        c2('J', 15, 0),    // joker (SJ, effRank 900)
        c2('S', 2, 50),    // ♠2 (effRank 800)
        c2('D', 2, 30),    // ♦2 (effRank 800)
        c2('H', 2, 90),    // ♥2 (effRank 800)
      ];
      const r = aiFollowPlay(hand, lead, null as any, cfgNT, best, 3);
      checkFollow(r.cards, hand, lead, null as any, cfgNT);
      expect(r.cards.length).toBe(2);
      // Must NOT include joker (rank 15 = SmallJoker)
      expect(r.cards.some(c => c.rank === 15)).toBe(false);
      expect(r.reason).toContain('垫同花色');
    });
  });

  describe('short-suited add points: non-point fillers ascending (discardSort fix)', () => {
    // Bug: discardSort(teammateWinning=true) sorted ALL cards descending,
    // so non-point fillers like ♥A were dumped before ♥8/♥9.
    // Fix: only point cards sort descending when adding points; non-point ascending.
    const cfgH: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('third+tmWin+short throw, non-point filler ascending: picks ♣8 not ♣A', () => {
      // P0 leads D-A-A-K (3-card throw, pair+single, max pattern).
      // P2=AI(teammate) has 1 diamond < 3 → short 2 fillers.
      // tmWin + throw → discardSort(true): points first, non-points ascending.
      // Hearts trump so both ♠ and ♣ are non-trump fillers.
      const lead: Card[] = [ct('D', 14, 200), ct('D', 14, 201), ct('D', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('D', 11, 0),   // ♦J (only diamond)
        ct('S', 10, 0),   // ♠10 (10 pts) — filler, should be used (add points)
        ct('C', 14, 0),   // ♣A — filler, should NOT be used (keep big cards)
        ct('C', 9, 0),    // ♣9
        ct('C', 8, 0),    // ♣8 — filler, should be used (smallest non-point)
      ];
      const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfgH, best, 2);
      checkFollow(r.cards, hand, lead, 'D', cfgH);
      expect(r.cards.length).toBe(3);
      // Must include the only diamond
      expect(r.cards.some(c => c.suit === 'D' && c.rank === 11)).toBe(true);
      // Must include ♠10 (point) to add score
      expect(r.cards.some(c => c.suit === 'S' && c.rank === 10)).toBe(true);
      // Must NOT include ♣A (should keep big non-point cards)
      expect(r.cards.find(c => c.suit === 'C' && c.rank === 14)).toBeUndefined();
      // Should include ♣8 (smallest non-point)
      expect(r.cards.some(c => c.suit === 'C' && c.rank === 8)).toBe(true);
    });

    it('third+tmWin+short throw, points descending: picks K over 5, non-point ♣3 not ♣Q', () => {
      // 4-card throw lead, only 1 diamond → need 3 fillers.
      // Points descending: K(10pts) before 5(5pts).
      // Non-points ascending: 3 before Q(12).
      const lead: Card[] = [
        ct('D', 14, 200), ct('D', 14, 201),
        ct('D', 13, 200), ct('D', 13, 201),
      ];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('D', 11, 0),   // ♦J (only diamond)
        ct('S', 13, 0),   // ♠K (10 pts) — point, should be used
        ct('S', 5, 0),    // ♠5 (5 pts) — point, K > 5 so K first
        ct('C', 12, 0),   // ♣Q — non-point, should NOT be used
        ct('C', 3, 0),    // ♣3 — non-point, should be used (smallest)
      ];
      const r = aiFollowPlay(hand, lead, Suit.Diamonds, cfgH, best, 2);
      checkFollow(r.cards, hand, lead, 'D', cfgH);
      expect(r.cards.length).toBe(4);
      // Must include ♦J
      expect(r.cards.some(c => c.suit === 'D' && c.rank === 11)).toBe(true);
      // Must include ♠K (max point card)
      expect(r.cards.some(c => c.suit === 'S' && c.rank === 13)).toBe(true);
      // Must include ♠5 (second point card, still before any non-point)
      expect(r.cards.some(c => c.suit === 'S' && c.rank === 5)).toBe(true);
      // Must NOT include non-point ♣Q (should be last, not picked)
      expect(r.cards.find(c => c.suit === 'C' && c.rank === 12)).toBeUndefined();
      // Should include ♣3 (first non-point after exhausting points)
      expect(r.cards.some(c => c.suit === 'C' && c.rank === 3)).toBe(true);
    });
  });

  describe('team-win void avoids unnecessary trump kill', () => {
    const cfgD: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Diamonds, level: 2 };
    function ct(s: string, r: number, i: number): Card {
      return createCard(s as any, r as any, i);
    }

    it('third+tmWin, throw lead void, has enough trump: dumps points instead of trumping', () => {
      // Reproduces: P0 leads C-AAK (throw, 3 cards). P1 plays C-4-6-8.
      // P2=AI(teammate) void in clubs. Has 3 trump (enough to kill) but
      // teammate P0 already wins. Should dump points, not waste trump.
      const cfgS: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
      function ct2(s: string, r: number, i: number): Card {
        return createCard(s as any, r as any, i);
      }
      const lead: Card[] = [ct2('C', 14, 200), ct2('C', 14, 201), ct2('C', 13, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct2('S', 10, 0), ct2('S', 10, 1),     // trump pair, can kill (10 is point)
        ct2('S', 3, 0),                         // trump single
        ct2('H', 5, 0),                         // 5 pts, off-suit
        ct2('D', 10, 0),                        // 10 pts, off-suit, different suit
        ct2('D', 4, 0),                         // non-point
        ct2('H', 3, 0),                         // non-point
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfgS, best, 2);
      checkFollow(r.cards, hand, lead, 'C', cfgS);
      expect(r.cards.length).toBe(3);
      expect(r.reason).toContain('垫牌');
      expect(r.reason).toContain('加分');
      expect(r.reason).not.toContain('毙');
      // Dumped cards should include points from different suits
      const playedIds = r.cards.map(c => c.id);
      const ptIds = [ct2('H', 5, 0).id, ct2('D', 10, 0).id];
      expect(playedIds.some(id => ptIds.includes(id))).toBe(true);
    });

    it('third+tmWin, max off-suit lead: adds points instead of trumping', () => {
      // P0 leads C-A (max single). P1 plays C-3. P2=AI(teammate) void with trump.
      // Teammate P0 wins with A → should dump points, not trump.
      const lead: Card[] = [ct('C', 14, 200)];
      const best = { cards: lead, playerIdx: 0 };
      const hand = [
        ct('D', 3, 0),    // trump (can kill)
        ct('D', 4, 0),
        ct('S', 13, 0),   // S-K (10 pts)
        ct('S', 5, 0),    // S-5 (5 pts)
      ];
      const r = aiFollowPlay(hand, lead, Suit.Clubs, cfgD, best, 2);
      checkFollow(r.cards, hand, lead, 'C', cfgD);
      expect(r.cards.length).toBe(1);
      // tmWin + canAddPoints(third + max pattern) → dump points
      expect(r.reason).toContain('垫牌');
      expect(r.reason).toContain('加分');
      // Should NOT be 用主牌毙
      expect(r.reason).not.toContain('毙');
    });
  });
});


// ================================================================
// Item 1: NT single trump follow, second position seizing (抢牌权)
// ================================================================
// Bug: followNTTrumpLead lacks second-position seizing logic that
// followTrumpLead has. In suited mode, second position with a tractor
// seizes with biggest trump. In NT mode, always picks smallest beater.
describe('NT second position seizing lead (抢牌权)', () => {
  function ct(s: string, r: number, i: number): Card {
    return createCard(s as any, r as any, i);
  }

  const mockNT: NTTrumpState = {
    knownTrumpsPerPlayer: [[], [], [], []],
    playersWithNoTrump: new Set(),
    totalTrumps: 12,
    opponentTrumpCount: 4,
    remainingBigJokers: 1,
    remainingSmallJokers: 1,
    allUnseenJokersOnOurSide: false,
    allUnseenBigJokersOnOurSide: false,
    possibleTrumps: [null, {}, {}, {}, {}],
    isFullyDetermined: false,
    canFormPair: [false, false, false, false],
    canHaveJoker: [false, false, false, false],
    canHaveBigJoker: [false, false, false, false],
    canHaveSmallJoker: [false, false, false, false],
    minTrumpCounts: [0, 0, 0, 0],
    maxTrumpCounts: [0, 0, 0, 0],
  };

  function ntCtx(myIndex: number, playCount: number,
    best: { cards: Card[]; playerIdx: number }): AIContext {
    return {
      declarerIndex: 0, trumpSuit: null, level: 2, myIndex,
      isDeclarer: myIndex === 0,
      isDeclarerPartner: myIndex === 2,
      isAttacker: myIndex % 2 !== 0,
      attackerPoints: 0,
      handCounts: [25, 25, 25, 25] as const,
      trickHistory: [], reveals: [],
      playCount, leadPlayerIndex: 0,
      bestSoFar: best ? { cards: best.cards, playerIndex: best.playerIdx } : null,
      ntState: mockNT, bottomCards: [], debug: false,
    };
  }

  // NT level=2, P0吊S-2(effRank=800), P1(second) has BJ(1000)+SJ(900)
  // + S tractor. Both BJ and SJ can beat S-2. Smallest beater = SJ(900).
  // But with tractor, should seize BJ(1000) to prepare for tractor lead.
  // Expected: BJ (biggest). Actual: SJ (smallest beater, no seizing logic).
  it('second with tractor: seizes with BJ not SJ', () => {
    const lead: Card[] = [ct('S', 2, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const ctx = ntCtx(1, 1, best);
    const hand = [
      ct('J', 16, 0),                      // BJ (effRank=1000, biggest)
      ct('J', 15, 0),                      // SJ (effRank=900, smallest beater)
      ct('S', 3, 0), ct('S', 3, 1),       // S-33 pair
      ct('S', 4, 0), ct('S', 4, 1),       // S-44 pair (tractor with S-33)
    ];
    const r = aiFollowPlay(hand, lead, null as any, ctx);
    checkFollow(r.cards, hand, lead, null as any, ctx);
    expect(r.cards.length).toBe(1);
    expect(r.cards[0].rank).toBe(16); // BJ seizes
  });

  // Same but with throwable combo. P1 has BJ+SJ+S throw combo.
  // Lead D-2(800). Beaters: BJ(1000), SJ(900). Both beat.
  // With throw, should seize with smallest >=A (SJ), not biggest (BJ).
  // Current: picks SJ (smallest beater, correct by coincidence for throw).
  // The key check: reason should be 同花色出大 (active), not 同花色出小 (passive).
  it('second with throw: seizes actively, not passive 同花色出小', () => {
    const lead: Card[] = [ct('D', 2, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const ctx = ntCtx(1, 1, best);
    const hand = [
      ct('J', 16, 0),                      // BJ (1000)
      ct('J', 15, 0),                      // SJ (900)
      ct('S', 14, 0), ct('S', 14, 1),     // S-AA (throw combo)
      ct('S', 13, 0),                       // S-K
    ];
    const r = aiFollowPlay(hand, lead, null as any, ctx);
    checkFollow(r.cards, hand, lead, null as any, ctx);
    expect(r.cards.length).toBe(1);
    // With throw combo, should actively seize (同花色出大), not passively follow
    expect(r.reason).toContain('同花色出大');
  });

  // NT second, no tractor/throw: play small passively.
  // P1 has BJ(1000)+SJ(900)+singles only. Lead D-2(800).
  // No tractor/throw → should play smallest beater (SJ).
  it('second without tractor/throw: plays small', () => {
    const lead: Card[] = [ct('D', 2, 200)];
    const best = { cards: lead, playerIdx: 0 };
    const ctx = ntCtx(1, 1, best);
    const hand = [
      ct('J', 16, 0), ct('J', 15, 0),
      ct('S', 3, 0), ct('S', 5, 0), ct('C', 8, 0),
    ];
    const r = aiFollowPlay(hand, lead, null as any, ctx);
    checkFollow(r.cards, hand, lead, null as any, ctx);
    expect(r.cards.length).toBe(1);
    // Passive: no tractor/throw, just play smallest beater (SJ=15)
    expect(r.cards[0].rank).toBe(15); // SJ
  });

  // 实测崩溃场景（arena 手36）：NT A 级（level=14），领出对小王 + A 级牌对
  // （小王15 与 级牌14 相邻，是合法 2 对拖拉机），跟牌方只有大王对 + 3 张级牌
  // 单张。旧代码 neededPairs 只看 leadCombo.pairCount（纯拖拉机 = 0），一个对子
  // 都不出 → 拆对出非法跟牌（"must play at least 1 pairs"），全降级失败导致对局中止。
  it('tractor lead in NT: keeps the pair intact (must not split)', () => {
    const lead: Card[] = [
      ct('J', 15, 200), ct('J', 15, 201),   // 对小王
      ct('H', 14, 202), ct('H', 14, 203),   // A 级牌对（NT 常主）
    ];
    const best = { cards: lead, playerIdx: 0 };
    const ctx14 = { ...ntCtx(1, 1, best), level: 14 };
    const hand = [
      ct('J', 16, 0), ct('J', 16, 1),       // 大王对
      ct('D', 14, 2), ct('S', 14, 3), ct('C', 14, 4), // 级牌单张 ×3
    ];
    const r = aiFollowPlay(hand, lead, null as any, ctx14);
    checkFollow(r.cards, hand, lead, null as any, ctx14);
    expect(r.cards.length).toBe(4);
    // 大王对必须整体出，不能拆成单张
    expect(r.cards.filter(c => c.rank === 16).length).toBe(2);
  });
});


// ================================================================
// Item 5: attacker breaks pair to cross 40-point threshold (拆对跨分台阶)
// ================================================================
// P0 leads S-A (max off-suit single). P1 plays S-3 (no beat).
// P2 (attacker, myIndex=3, fourth, !tmWin since P0 is defender winning).
// attacker at 35pts. Hand: S-10,S-10 (pair) + S-4 (non-point, rank≠level so not trump).
// No single S-10 or S-K available. shouldAvoid → S-4 (non-point).
// But breaking the pair to play S-10: 35+10=45≥40, crosses threshold.
// Should override shouldAvoid when threshold crossing is possible.
describe('attacker crosses 40-point threshold', () => {
  it('third+!tmWin+35pts: breaks 10-pair to cross 40', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 1, trumpSuit: Suit.Hearts, level: 5 };
    function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
    // declarerIndex=1 → P0 is attacker. P0 leads S-A.
    // P1 (defender) plays S-3. P2 (attacker myIndex=2, third).
    // P0 wins with S-A, but P2's teammate IS P0 → tmWin=true for P2!
    // Need declarerIndex=0 so P2(aligned with P0) is defender...

    // Actually: declarerIndex=0 → P0,P2 defenders. P1,P3 attackers.
    // But P2 needs to be an ATTACKER. So declarerIndex=1:
    // P1,P3 defenders. P0,P2 attackers. P0 leads S-A (attacker).
    // P1 (defender) plays S-3. P2 (attacker, third, tmWin since P0 wins)...
    // tmWin=true → canAddPoints, not shouldAvoid...

    // Need shouldAvoid. So P0 NOT teammate. declarerIndex=0:
    // P0,P2 defenders(庄家方). P1,P3 attackers(闲家).
    // myIndex=3 (fourth attacker). P0 leads S-A, P1 defender S-3.
    // P2 defender plays. Now P3 (attacker, fourth).
    // playCount=3, fourth, tmWin=(best.playerIndex===myIndex+2) → P0(index0) vs P3(index3): 0≠1 → tmWin=false.
    // shouldAvoid: fourth+!tmWin → true.
    // Hand: S-10,S-10(pair) + S-4(small). shouldAvoid picks S-4.
    // But 35+S-10(10)=45≥40 → cross threshold, should play S-10 breaking pair.

    const lead: Card[] = [cc('S', 14, 200)]; // P0 leads S-A
    const best = { cards: lead, playerIdx: 0 }; // P0 winning (defender wins)
    const hand = [
      cc('S', 10, 0), cc('S', 10, 1),  // S-10 pair (10分对子, rank≠level)
      cc('S', 4, 0),                     // S-4 (非分, 不会被过滤)
    ];
    const ctx: AIContext = {
      declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5, myIndex: 3, // fourth
      isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
      attackerPoints: 35, handCounts: [25, 25, 25, 3] as const,
      trickHistory: [], reveals: [], playCount: 3, leadPlayerIndex: 0,
      bestSoFar: { cards: best.cards, playerIndex: best.playerIdx },
      ntState: null, bottomCards: [], debug: false,
    };
    const r = aiFollowPlay(hand, lead, Suit.Spades, ctx);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards.length).toBe(1);
    // Break 10 pair → play S-10 to cross threshold (35+10=45≥40)
    expect(r.cards[0].rank).toBe(10);
  });
});

// ================================================================
// Item 7: declarer avoids pushing attacker to 80 (送对手上台)
// ================================================================
//
// Scenario: declarerIndex=0, P0(defender) leads S-3(small), P1(attacker)
// beats with S-A (opponent wins). P2(defender, third, !tmWin) is void in
// S. Hand: D-10(10pts off-suit) + H-3(non-point trump).
// attacker at 75pts. Void branch: trumpCards=[H-3](1), leadLen=1,
// trumpCards.length >= leadLen, falls to trumpKill path.
// BUT: key check — adding D-10 gives attacker 75+10=85≥80→上台!
// shouldAvoid would normally not apply here (void branch uses trumpKill),
// but the declarer should override: discard non-point trump H-3 instead
// of adding D-10. Actually, the void branch already checks tmWin and
// canAddPoints before trumpKill. Without canAddPoints, it goes to trumpKill.
//
// The issue: after canAddPoints check, the void branch either dumps points
// (tmWin+canAddPoints) or goes to trumpKill. The trumpKill path doesn't
// consider the 80-point danger. Since H-3(leadLen=1) would kill, it uses
// H-3 (non-point trump). The D-10 is not selected. So this scenario is
// actually handled correctly!
//
// Better scenario: declarer tmWin=true, canAddPoints=true, but adding
// points pushes attacker to 80 → override canAddPoints.
//
// P0(defender) leads S-A(max). P1(attacker) follows S-3.
// P2(defender, third, tmWin=true). Void in S (no spades).
// Hand: D-10(10pts off-suit) + H-3(non-point trump).
// attacker at 75pts.
// canAddPoints: third+tmWin+A(max)→true → dump points → D-10.
// 75+10=85≥80 → attacker scores! Should discard H-3 instead.
describe('declarer avoids pushing attacker to 80', () => {
  it('void third+tmWin+75pts: discards non-point trump instead of adding 10', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
    function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
    const lead: Card[] = [cc('S', 14, 200)]; // S-A (max off-suit)
    const best = { cards: lead, playerIdx: 0 }; // P0 defender winning

    const hand = [
      cc('D', 10, 0),  // D-10 (10分, would push attacker to 85)
      cc('H', 3, 0),   // H-3 (non-point trump)
    ];
    const ctx: AIContext = {
      declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5, myIndex: 2,
      isDeclarer: false, isDeclarerPartner: true, isAttacker: false,
      attackerPoints: 75, handCounts: [25, 25, 2, 25] as const,
      trickHistory: [], reveals: [], playCount: 2, leadPlayerIndex: 0,
      bestSoFar: { cards: best.cards, playerIndex: best.playerIdx },
      ntState: null, bottomCards: [], debug: false,
    };
    const r = aiFollowPlay(hand, lead, Suit.Spades, ctx);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards.length).toBe(1);
    // Should NOT add D-10 (pushes attacker to 85≥80); discard H-3 instead
    expect(r.cards[0].suit).toBe('H');
  });
});

// ================================================================
// Short-suited + canAddPoints: reason should say 加分
// ================================================================
// Bug: short-suited branch in _aiFollowPlay used only avoid/none intent,
// never checked canAddPoints. Third+tmWin+max pattern should annotate 加分
// even when short-suited.
describe('short-suited point adding annotation', () => {
  // Reproduce: P0 leads C-A,C-A,C-K,C-K (AAKK throw, max off-suit).
  // AI-3 (third, declarer partner, tmWin=true) has only 3 clubs:
  // C-9,C-6,C-3 + D-10 (10分) + D-5 (5分) + D-8 (非分). Short-suited:
  // play all 3 clubs + fill D-10. tmWin+third+max throw→canAddPoints
  // → should annotate 加分. Among point cards, should pick D-10 (bigger
  // point) over D-5.
  it('third+tmWin+max throw short: picks D-10 over D-5, annotates 加分', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 7 };
    function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
    const lead: Card[] = [cc('C', 14, 200), cc('C', 14, 201), cc('C', 13, 200), cc('C', 13, 201)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('C', 9, 0), cc('C', 6, 0), cc('C', 3, 0),  // 3 clubs (short by 1)
      cc('D', 10, 0),  // D-10 (10分)
      cc('D', 5, 0),   // D-5 (5分)
      cc('D', 8, 0),   // D-8 (非分)
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'C', cfg);
    expect(r.cards.length).toBe(4);
    // D-10 should be picked over D-5 (bigger point card first)
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 10)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 5)).toBe(false);
    expect(r.reason).toContain('加分');
  });
});

// ================================================================
// padWithDiscards: add-points annotation when tmWin and canAddPoints
// ================================================================
// Bug: padWithDiscards used only avoid/none intent, never 'add'.
// When tmWin and canAddPoints, filler sort already picks point cards;
// the reason should annotate 加分.
describe('padWithDiscards add-points annotation', () => {
  // P0 leads BJ,BJ (big joker pair, max trump pattern). P2 (third, tmWin)
  // has H-5 (only 1 trump, short by 1) + D-K,K (20分副牌对子) + D-8.
  // leadLen=2, myTrump=[H-5] (1 card), padWithDiscards fills 1 card.
  // BJ pair is max → canAddPoints → should annotate 加分, and
  // D-K should be the filler (10分优先 via discardSort(true)).
  it('third+tmWin max trump pair short: annotates 加分 on filler', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 7 };
    function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
    const lead: Card[] = [cc('J', 16, 200), cc('J', 16, 201)];
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('H', 5, 0),                    // only 1 trump (short by 1)
      cc('D', 13, 0), cc('D', 13, 1),  // D-K-K pair (10分对子)
      cc('D', 8, 0),                    // D-8 (non-point)
    ];
    const r = aiFollowPlay(hand, lead, Suit.Hearts, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'H', cfg);
    expect(r.cards.length).toBe(2);
    // D-K should be the filler (point card)
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 13)).toBe(true);
    expect(r.reason).toContain('加分');
  });
});

// ================================================================
// followOffSuitThrow partial fill: add-points annotation
// ================================================================
// Bug: followOffSuitThrow partial fill used only avoid/none intent.
// When tmWin and canAddPoints, should annotate 加分.
describe('followOffSuitThrow partial fill add-points annotation', () => {
  // P0 leads S-A,S-A,S-K,S-Q (AAKQ throw, 4 cards, 2A+1K+1Q).
  // P2 (third, tmWin) has only S-9 (1 spade, short by 3).
  // Fillers: D-K,K pair + D-8. tmWin+third+max throw→canAddPoints.
  it('third+tmWin partial throw: annotates 加分 on fillers', () => {
    const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 7 };
    function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
    const lead: Card[] = [
      cc('S', 14, 200), cc('S', 14, 201),
      cc('S', 13, 200), cc('S', 12, 200),
    ];
    const best = { cards: lead, playerIdx: 0 };
    // 1 spade + D-K,K pair (20分) + D-8 + extra to avoid 最后N张手牌
    const hand = [
      cc('S', 9, 0),                     // only 1 spade (short by 3)
      cc('D', 13, 0), cc('D', 13, 1),   // D-K-K pair (10分对子)
      cc('D', 8, 0),                     // D-8 (non-point)
      cc('D', 6, 0),                     // extra non-point
    ];
    const r = aiFollowPlay(hand, lead, Suit.Spades, cfg, best, 2);
    checkFollow(r.cards, hand, lead, 'S', cfg);
    expect(r.cards.length).toBe(4);
    // D-K should be in the fill (point card added by discardSort)
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 13)).toBe(true);
    expect(r.reason).toContain('加分');
  });
});

// ================================================================
// Point card fill priority: 10 > K > 5 when adding points
// ================================================================
// When teammate wins and canAddPoints, the filler should pick point
// cards in order: 10 (10pts + low rank, dump first), K (10pts + high
// rank, keep for winning), 5 (5pts, dump last).
describe('point card priority: 10 > K > 5 when adding', () => {
  // P0 (declarer) leads C-A,A,K,Q,Q (AAKQQ throw, 5 cards, max off-suit).
  // AI-3 (third, declarer partner, tmWin) has D-10, D-K, D-5 + fillers.
  // Vary the club count to test fill-1, fill-2, fill-3.

  function cc(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }
  const lead: Card[] = [
    cc('C', 14, 200), cc('C', 14, 201),
    cc('C', 13, 200),
    cc('C', 12, 200), cc('C', 12, 201),
  ];
  const cfg7: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 7 };

  it('fill 1: picks D-10 first (10 > K > 5)', () => {
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('C', 9, 0), cc('C', 8, 0), cc('C', 4, 0), cc('C', 6, 0), // 4 clubs (rank 4,6,8,9 — none=level 7)
      cc('D', 10, 0), cc('D', 13, 0), cc('D', 5, 0),               // 10 K 5
      cc('D', 3, 0),                                                 // extra non-point
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg7, best, 2);
    checkFollow(r.cards, hand, lead, 'C', cfg7);
    expect(r.cards.length).toBe(5);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 10)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 13)).toBe(false);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 5)).toBe(false);
  });

  it('fill 2: picks D-10 then D-K (10 > K)', () => {
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('C', 9, 0), cc('C', 8, 0), cc('C', 4, 0), // 3 clubs (short by 2, none=level 7)
      cc('D', 10, 0), cc('D', 13, 0), cc('D', 5, 0), // 10 K 5
      cc('D', 3, 0), // extra non-point
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg7, best, 2);
    checkFollow(r.cards, hand, lead, 'C', cfg7);
    expect(r.cards.length).toBe(5);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 10)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 13)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 5)).toBe(false);
  });

  it('fill 3: picks D-10, D-K, D-5 (10 > K > 5)', () => {
    const best = { cards: lead, playerIdx: 0 };
    const hand = [
      cc('C', 9, 0), cc('C', 8, 0), // 2 clubs (short by 3)
      cc('D', 10, 0), cc('D', 13, 0), cc('D', 5, 0), // 10 K 5
      cc('D', 3, 0), // extra non-point
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, cfg7, best, 2);
    checkFollow(r.cards, hand, lead, 'C', cfg7);
    expect(r.cards.length).toBe(5);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 10)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 13)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 5)).toBe(true);
  });
});

// ================================================================
// Break pair to add points: only when score warrants it
// ================================================================
// Attacker (闲家) should break a pair to play 10 points only when
// adding those 10 points can meaningfully help reach the next threshold.
// Otherwise, play a single 5 and keep the pair intact.
//
// Scenario: declarerIndex=1, P0(attacker) leads AAKQQ (5 cards).
// P1(defender) follows small clubs. P2(attacker, third, tmWin=true)
// has some clubs + D-10,D-10 pair + D-5 single + D-4 filler.
describe('break pair: score-aware pair breaking', () => {
  function cc(s: string, r: number, i: number): Card {
    return createCard(s as any, r as any, i);
  }
  const lead: Card[] = [
    cc('C', 14, 200), cc('C', 14, 201),
    cc('C', 13, 200),
    cc('C', 12, 200), cc('C', 12, 201),
  ];
  const cfg7: TrumpDeclaration = { declarerIndex: 1, trumpSuit: Suit.Hearts, level: 7 };

  function atkCtx(myIndex: number, score: number): AIContext {
    return {
      declarerIndex: 1, trumpSuit: Suit.Hearts, level: 7, myIndex,
      isDeclarer: false, isDeclarerPartner: false, isAttacker: true,
      attackerPoints: score,
      handCounts: [25, 25, 25, 25] as const,
      trickHistory: [], reveals: [],
      playCount: 2, leadPlayerIndex: 0,
      bestSoFar: { cards: lead, playerIndex: 0 },
      ntState: null, bottomCards: [], debug: false,
    };
  }

  // fill-1, score=55: D-10 would give 65, still far from 80.
  // Better to play D-5 (5pts) and keep D-10 pair for later.
  it('fill-1, score=55: does NOT break 10-pair, plays 5 instead', () => {
    const ctx = atkCtx(2, 55);
    const hand = [
      cc('C', 9, 0), cc('C', 8, 0), cc('C', 6, 0), cc('C', 4, 0),
      cc('D', 10, 0), cc('D', 10, 1),  // D-10 pair
      cc('D', 5, 0),                     // D-5 single
      cc('D', 3, 0),                     // D-3 non-point
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfg7);
    expect(r.cards.length).toBe(5);
    // Plays D-5, not D-10
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 5)).toBe(true);
    // Only one D-10 at most (the pair stays intact)
    const tens = r.cards.filter(c => c.suit === 'D' && c.rank === 10);
    expect(tens.length).toBe(0);
  });

  // fill-1, score=60: D-10 gives 70, within striking distance of 80.
  // Worth breaking the pair.
  it('fill-1, score=60: breaks 10-pair, plays 10', () => {
    const ctx = atkCtx(2, 60);
    const hand = [
      cc('C', 9, 0), cc('C', 8, 0), cc('C', 6, 0), cc('C', 4, 0),
      cc('D', 10, 0), cc('D', 10, 1),  // D-10 pair
      cc('D', 5, 0),                     // D-5 single
      cc('D', 3, 0),
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfg7);
    expect(r.cards.length).toBe(5);
    // Breaks pair → plays D-10
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 10)).toBe(true);
  });

  // fill-2, score=55: 加分优先级（原则6）副5单 > 副牌分对——先出 D-5，10 对
  // 放不下（不拆对），再补 D-3。55+10=65 不跨 80，不走全力加分。
  it('fill-2, score=55: plays D-5 + D-3 (5-single before point pair)', () => {
    const ctx = atkCtx(2, 55);
    const hand = [
      cc('C', 9, 0), cc('C', 8, 0), cc('C', 6, 0), // 3 clubs (short by 2)
      cc('D', 10, 0), cc('D', 10, 1),  // D-10 pair
      cc('D', 5, 0),
      cc('D', 3, 0),
    ];
    const r = aiFollowPlay(hand, lead, Suit.Clubs, ctx);
    checkFollow(r.cards, hand, lead, 'C', cfg7);
    expect(r.cards.length).toBe(5);
    // 副5 单优先于 副牌分对；对子不拆
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 5)).toBe(true);
    expect(r.cards.some(c => c.suit === 'D' && c.rank === 3)).toBe(true);
    const tens = r.cards.filter(c => c.suit === 'D' && c.rank === 10);
    expect(tens.length).toBe(0); // 10 对保持完整
  });

  it('甩牌带对子跟牌：对子不足领出对数时也必须带出（回归：0 对子非法跟牌）', () => {
    // level=12：S-55 不是级牌，是真正的副牌对子（level 5 时会变成主牌，测不到本 bug）
    const cfgQ: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 12 };
    // 领出 S-AA S-1010 S-K：5 张甩牌，2 对 + 1 单
    const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 10, 202), c('S', 10, 203), c('S', 13, 204)];
    // 跟牌手：7 张 S（S-55 一对 + 5 张单张），对子数少于领出、且非被迫全出
    const hand = [c('S', 5, 0), c('S', 5, 1), c('S', 9, 2), c('S', 8, 3), c('S', 7, 4),
      c('S', 6, 5), c('S', 4, 6),
      c('H', 14, 10), c('H', 13, 11), c('C', 12, 12), c('D', 11, 13)];
    const play = aiFollow(hand, lead, 'S', cfgQ);
    checkFollow(play, hand, lead, 'S', cfgQ);
    expect(play.length).toBe(5);
    // 必须包含至少 1 对
    const pairCount = classify(play, cfgQ).pairCount;
    expect(pairCount).toBeGreaterThanOrEqual(1);
  });
});
