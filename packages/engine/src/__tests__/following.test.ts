import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { validateFollow } from '../following/index.js';
import { classify } from '../pattern/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
// trump = all Jokers, all Hearts, all 5s (any suit)

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

// ============================================================
// Pair lead (non-trump) — 领出对牌
// ============================================================
describe('pair lead (non-trump)', () => {

  it('enough suit + has pair → must play a pair', () => {
    const lead = [c('S', 14, 200), c('S', 14, 201)]; // ♠A ♠A
    const hand = [
      c('S', 13, 1), c('S', 13, 2), // ♠K ♠K (pair)
      c('S', 12, 3), c('S', 11, 4), c('S', 10, 5), c('S', 9, 6),
    ];
    const lp = classify(lead, cfg5);
    // reject: singles instead of pair
    const r1 = validateFollow([c('S', 12, 3), c('S', 11, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain('pair');
    // accept: pair
    const r2 = validateFollow([c('S', 13, 1), c('S', 13, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough suit + no pair → can play singles', () => {
    const lead = [c('S', 14, 200), c('S', 14, 201)];
    const hand = [
      c('S', 13, 1), c('S', 12, 2), c('S', 11, 3), c('S', 10, 4),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 13, 1), c('S', 12, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit + suit cards form a pair → must play that pair', () => {
    const lead = [c('S', 14, 200), c('S', 14, 201)];
    const hand = [
      c('S', 13, 1), c('S', 13, 2), // ♠K ♠K (pair, only 2 spades)
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    // reject: play 1 spade + 1 filler, didn't play both spades
    const r1 = validateFollow([c('S', 13, 1), c('C', 10, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    // accept: play both spades (the pair)
    const r2 = validateFollow([c('S', 13, 1), c('S', 13, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('short suit + no pair → play all suit + fillers', () => {
    const lead = [c('S', 14, 200), c('S', 14, 201)];
    const hand = [
      c('S', 13, 1), c('C', 10, 2), c('C', 9, 3),
    ]; // only 1 spade
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 13, 1), c('C', 10, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('void in suit → any play valid', () => {
    const lead = [c('S', 14, 200), c('S', 14, 201)];
    const hand = [c('C', 13, 1), c('C', 12, 2), c('C', 11, 3)];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('C', 13, 1), c('C', 12, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Tractor lead (non-trump) — 领出拖拉机
// ============================================================
describe('tractor lead (non-trump)', () => {

  // helper: ♠A♠A♠K♠K 2-pair tractor
  const lead2p = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];

  it('enough suit + exact tractor → must play tractor', () => {
    const hand = [
      c('S', 14, 1), c('S', 14, 2), c('S', 13, 3), c('S', 13, 4), // exact tractor
      c('S', 12, 5), c('S', 11, 6),
    ];
    const lp = classify(lead2p, cfg5);
    // accept: exact tractor
    const r1 = validateFollow([c('S', 14, 1), c('S', 14, 2), c('S', 13, 3), c('S', 13, 4)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: no tractor, no pairs
    const r2 = validateFollow([c('S', 14, 1), c('S', 12, 5), c('S', 11, 6), c('S', 10, 7)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + longer tractor → can extract same length', () => {
    // 3-pair tractor: ♠K♠K ♠Q♠Q ♠J♠J
    const hand = [
      c('S', 13, 1), c('S', 13, 2),
      c('S', 12, 3), c('S', 12, 4),
      c('S', 11, 5), c('S', 11, 6),
      c('S', 10, 7),
    ];
    const lp = classify(lead2p, cfg5);
    // extract first 2 pairs from 3-pair tractor → accept
    const r = validateFollow([c('S', 13, 1), c('S', 13, 2), c('S', 12, 3), c('S', 12, 4)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('enough suit + no tractor but has pairs → must play pairs', () => {
    // ♠Q♠Q, ♠10♠10 are NOT consecutive (J=11 missing)
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q
      c('S', 10, 3), c('S', 10, 4), // ♠10♠10
      c('S', 8, 5),
    ];
    const lp = classify(lead2p, cfg5);
    // accept: 2 pairs (no tractor possible in hand)
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 10, 3), c('S', 10, 4)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 1 pair
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 10, 3), c('S', 8, 5)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + no tractor + no pairs → can play singles', () => {
    const hand = [
      c('S', 12, 1), c('S', 10, 2), c('S', 8, 3), c('S', 7, 4), c('S', 6, 5),
    ];
    const lp = classify(lead2p, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 10, 2), c('S', 8, 3), c('S', 7, 4)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit → play all suit + fillers', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), // only 2 spades
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead2p, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('C', 10, 3), c('C', 9, 4)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit, suit cards form a tractor → must play that tractor (pattern check)', () => {
    // 2 spades forming a pair, lead is tractor
    // hand has exactly 2 spades = ♠Q♠Q (pair), lead is 4-card tractor
    // Must play both spades, but lead is tractor — suit portion is just a pair.
    // computeIdealFollow on handInGroup (2 cards): only 1 pair, no tractor.
    // leadReqs = {tractorReqs:[2], pairReqs:0}. No tractor available → bestTractors=[].
    // needed=2, fillCap=1, minTotalPairs=1. Player must play 1 pair in the suit portion.
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q (pair)
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead2p, cfg5);
    // accept: play the spade pair + 2 fillers
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('C', 10, 3), c('C', 9, 4)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: play both spades but not as a pair (impossible with 2 same-rank...)
    // reject: didn't play both spades
    const r2 = validateFollow([c('S', 12, 1), c('C', 10, 3), c('C', 9, 4), c('C', 8, 5)], hand, lead2p, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

});

// ============================================================
// Tractor lead (trump) — 领出主牌拖拉机
// ============================================================
describe('tractor lead (trump)', () => {

  // ♥A♥A♥K♥K 2-pair trump tractor (Hearts are trump)
  const leadTr: Card[] = [
    c('H', 14, 200), c('H', 14, 201), c('H', 13, 202), c('H', 13, 203),
  ];

  it('short trump → must play all trump + fillers', () => {
    const hand = [
      c('H', 12, 1), c('H', 11, 2), // only 2 trump
      c('S', 10, 3), c('S', 9, 4),
    ];
    const lp = classify(leadTr, cfg5);
    // reject: didn't play both trump
    const r1 = validateFollow([c('H', 12, 1), c('S', 10, 3), c('S', 9, 4), c('S', 8, 5)], hand, leadTr, lp, null, cfg5);
    expect(r1.valid).toBe(false);
    // accept: play both trump + 2 fillers
    const r2 = validateFollow([c('H', 12, 1), c('H', 11, 2), c('S', 10, 3), c('S', 9, 4)], hand, leadTr, lp, null, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough trump + exact tractor → must play tractor', () => {
    const hand = [
      c('H', 14, 1), c('H', 14, 2), c('H', 13, 3), c('H', 13, 4),
      c('H', 12, 5), c('H', 11, 6),
    ];
    const lp = classify(leadTr, cfg5);
    // reject: 2 pairs not consecutive (14,14,12,12 skips 13)
    const r1 = validateFollow([c('H', 14, 1), c('H', 14, 2), c('H', 12, 5), c('H', 12, 6)], hand, leadTr, lp, null, cfg5);
    expect(r1.valid).toBe(false);
    // accept: exact tractor
    const r2 = validateFollow([c('H', 14, 1), c('H', 14, 2), c('H', 13, 3), c('H', 13, 4)], hand, leadTr, lp, null, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('void in trump → any play', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4), c('S', 8, 5),
    ];
    const lp = classify(leadTr, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4)], hand, leadTr, lp, null, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: singles only — 纯单牌甩牌
// ============================================================
describe('throw (singles only)', () => {

  // 3 single spades (all highest → valid throw)
  const lead3s = [c('S', 14, 200), c('S', 13, 201), c('S', 12, 202)];

  it('enough suit → follow suit', () => {
    const hand = [
      c('S', 11, 1), c('S', 10, 2), c('S', 9, 3), c('S', 8, 4),
    ];
    const lp = classify(lead3s, cfg5);
    const r = validateFollow([c('S', 11, 1), c('S', 10, 2), c('S', 9, 3)], hand, lead3s, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit → play all suit + fillers', () => {
    const hand = [
      c('S', 11, 1), c('C', 10, 2), c('C', 9, 3),
    ]; // only 1 spade
    const lp = classify(lead3s, cfg5);
    // reject: didn't play the only spade
    const r1 = validateFollow([c('C', 10, 2), c('C', 9, 3), c('C', 8, 4)], hand, lead3s, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    // accept: play 1 spade + 2 fillers
    const r2 = validateFollow([c('S', 11, 1), c('C', 10, 2), c('C', 9, 3)], hand, lead3s, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('void → any play', () => {
    const hand = [c('C', 13, 1), c('C', 12, 2), c('C', 11, 3), c('C', 10, 4)];
    const lp = classify(lead3s, cfg5);
    const r = validateFollow([c('C', 13, 1), c('C', 12, 2), c('C', 11, 3)], hand, lead3s, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: pair + singles — 含对牌和单牌的甩牌
// ============================================================
describe('throw (pair + singles)', () => {

  // ♠A♠A ♠K (pair + single)
  const leadPairSingle = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202)];

  it('enough suit + has pair → must play pair', () => {
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q
      c('S', 11, 3), c('S', 10, 4), c('S', 9, 5),
    ];
    const lp = classify(leadPairSingle, cfg5);
    // reject: 3 singles, no pair
    const r1 = validateFollow([c('S', 12, 1), c('S', 11, 3), c('S', 10, 4)], hand, leadPairSingle, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    // accept: pair + single
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 11, 3)], hand, leadPairSingle, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough suit + no pair → can play singles', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4),
    ]; // all singles
    const lp = classify(leadPairSingle, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('S', 10, 3)], hand, leadPairSingle, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit + suit has pair → must play that pair', () => {
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q (only 2 spades, form a pair)
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(leadPairSingle, cfg5);
    // reject: only 1 spade played
    const r1 = validateFollow([c('S', 12, 1), c('C', 10, 3), c('C', 9, 4)], hand, leadPairSingle, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    // accept: play both spades (pair) + 1 filler
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('C', 10, 3)], hand, leadPairSingle, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('short suit + no pair → play all suit + fillers', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), // 2 singles in spades
      c('C', 10, 3),
    ];
    const lp = classify(leadPairSingle, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('C', 10, 3)], hand, leadPairSingle, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: tractor + single — 含拖拉机和单牌的甩牌
// ============================================================
describe('throw (tractor + single)', () => {

  // ♠A♠A♠K♠K ♠Q (2-pair tractor + 1 single = 5 cards)
  const leadTrSingle = [
    c('S', 14, 200), c('S', 14, 201),
    c('S', 13, 202), c('S', 13, 203),
    c('S', 12, 204),
  ];

  it('enough suit + has tractor → must match tractor', () => {
    // 3-pair tractor: ♠K♠K ♠Q♠Q ♠J♠J
    const hand = [
      c('S', 13, 1), c('S', 13, 2),
      c('S', 12, 3), c('S', 12, 4),
      c('S', 11, 5), c('S', 11, 6),
      c('S', 10, 7),
    ];
    const lp = classify(leadTrSingle, cfg5);
    // accept: extract 2-pair from 3-pair tractor + 1 single
    const r1 = validateFollow([c('S', 13, 1), c('S', 13, 2), c('S', 12, 3), c('S', 12, 4), c('S', 10, 7)], hand, leadTrSingle, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: no tractor, only pairs
    const r2 = validateFollow([c('S', 13, 1), c('S', 13, 2), c('S', 11, 5), c('S', 11, 6), c('S', 10, 7)], hand, leadTrSingle, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + no tractor + has pairs → must fill with pairs', () => {
    // ♠Q♠Q, ♠10♠10 are NOT consecutive (J=11 missing)
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q
      c('S', 10, 3), c('S', 10, 4), // ♠10♠10
      c('S', 8, 5), c('S', 7, 6),
    ];
    const lp = classify(leadTrSingle, cfg5);
    // accept: 2 pairs + 1 single
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 10, 3), c('S', 10, 4), c('S', 8, 5)], hand, leadTrSingle, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 1 pair + 3 singles
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 10, 3), c('S', 8, 5), c('S', 7, 6)], hand, leadTrSingle, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('short suit with tractor → play all suit, tractor match on suit portion', () => {
    // only 4 spades, forming a 2-pair tractor
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 11, 3), c('S', 11, 4), // ♠Q♠Q♠J♠J tractor
      c('C', 10, 5),
    ];
    const lp = classify(leadTrSingle, cfg5);
    // accept: play all 4 spades (tractor) + 1 filler
    const r = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('S', 11, 4), c('C', 10, 5)], hand, leadTrSingle, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: pairs + tractor — 含多对和拖拉机的甩牌
// ============================================================
describe('throw (pairs + tractor)', () => {

  // ♠A♠A♠K♠K (tractor 2-pair) + ♠Q♠Q (standalone pair) = 6 cards
  const leadTrPair = [
    c('S', 14, 200), c('S', 14, 201),
    c('S', 13, 202), c('S', 13, 203),
    c('S', 12, 204), c('S', 12, 205),
  ];

  it('enough suit + has matching tractor + extra pair → accept', () => {
    // Hand: 3-pair tractor (can extract 2) + another pair + singles
    const hand = [
      c('S', 13, 1), c('S', 13, 2), // will be part of tractor extract
      c('S', 12, 3), c('S', 12, 4), // solo pair (lead also has this, so it's duplicated...)
      // Actually lead has ♠Q♠Q as the standalone pair. Hand needs a different pair.
      // Let me use a different rank for the standalone pair in hand.
      c('S', 10, 5), c('S', 10, 6), // ♠10♠10 (standalone pair)
      c('S', 9, 7), c('S', 8, 8),
    ];
    const lp = classify(leadTrPair, cfg5);
    // accept: tractor extract (13-12=♠K♠K♠Q♠Q) + pair (♠10♠10) = 6
    const r1 = validateFollow([c('S', 13, 1), c('S', 13, 2), c('S', 12, 3), c('S', 12, 4), c('S', 10, 5), c('S', 10, 6)], hand, leadTrPair, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 1 pair + singles (missing a tractor)
    const r2 = validateFollow([c('S', 13, 1), c('S', 13, 2), c('S', 10, 5), c('S', 10, 6), c('S', 9, 7), c('S', 8, 8)], hand, leadTrPair, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + no tractor → must fill all with pairs', () => {
    // ♠Q♠Q, ♠10♠10, ♠8♠8 — 3 standalone pairs, no tractor
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 10, 3), c('S', 10, 4),
      c('S', 8, 5), c('S', 8, 6),
      c('S', 7, 7),
    ];
    const lp = classify(leadTrPair, cfg5);
    // accept: 3 pairs (tractor 2-pair slot unfilled, filled by pairs)
    const r = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 10, 3), c('S', 10, 4), c('S', 8, 5), c('S', 8, 6)], hand, leadTrPair, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Legacy tests — retained and adapted
// ============================================================
describe('validateFollow (basic)', () => {
  const trump2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
  it('rejects wrong count', () => {
    const r = validateFollow([c('H', 3, 0)], [c('H', 3, 0)], [c('H', 5, 1), c('H', 5, 2)], classify([c('H', 5, 1), c('H', 5, 2)], trump2), 'H' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('must play');
  });
  it('must follow suit', () => {
    const hand = [c('H', 3, 0), c('D', 4, 1)];
    const lead = [c('H', 5, 2)];
    const r = validateFollow([c('D', 4, 1)], hand, lead, classify(lead, trump2), 'H' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('follow suit');
  });
  it('void can trump', () => {
    const hand = [c('S', 2, 0)];
    const lead = [c('H', 5, 1)];
    const r = validateFollow([c('S', 2, 0)], hand, lead, classify(lead, trump2), 'H' as any, trump2);
    expect(r.valid).toBe(true);
  });
  it('trump lead must follow trump', () => {
    const hand = [c('S', 2, 0), c('S', 3, 1), c('H', 5, 2)];
    const lead = [c('S', 2, 3)];
    const r = validateFollow([c('H', 5, 2)], hand, lead, classify(lead, trump2), 'S' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('trump');
  });
  it('partial trump — must play all available trump when lead is multi-trump', () => {
    const cfg2: TrumpDeclaration = { declarerIndex: 2, trumpSuit: Suit.Hearts, level: 2 };
    const hand = [
      c('C', 2, 100), c('H', 12, 101), c('H', 7, 102),
      c('S', 14, 103), c('S', 13, 104), c('S', 10, 105), c('S', 8, 106),
    ];
    const lead = [c('J', 15, 200), c('J', 15, 201), c('H', 2, 202), c('H', 2, 203)];
    const lp = classify(lead, cfg2);
    const r = validateFollow(hand.filter(c => c.suit === Suit.Spades).slice(0, 4), hand, lead, lp, null, cfg2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('trump');
  });
  it('partial trump — allowed when all available trump are played', () => {
    const cfg2: TrumpDeclaration = { declarerIndex: 2, trumpSuit: Suit.Hearts, level: 2 };
    const hand = [
      c('C', 2, 100), c('H', 12, 101), c('H', 7, 102),
      c('S', 14, 103), c('S', 13, 104),
    ];
    const lead = [c('J', 15, 200), c('J', 15, 201), c('H', 2, 202), c('H', 2, 203)];
    const lp = classify(lead, cfg2);
    const play = [
      hand.find(c => c.suit === 'C' && c.rank === 2)!,
      hand.find(c => c.suit === 'H' && c.rank === 12)!,
      hand.find(c => c.suit === 'H' && c.rank === 7)!,
      hand.find(c => c.suit === 'S')!,
    ];
    const r = validateFollow(play, hand, lead, lp, null, cfg2);
    expect(r.valid).toBe(true);
  });
  it('trump lead with pair — must play pair if available', () => {
    const cfg2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
    const hand = [c('S', 3, 0), c('S', 3, 1), c('S', 5, 2)];
    const lead = [c('S', 2, 3), c('S', 2, 5)];
    const r = validateFollow([c('S', 3, 0), c('S', 5, 2)], hand, lead, classify(lead, cfg2), 'S' as any, cfg2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('pair');
  });
});
