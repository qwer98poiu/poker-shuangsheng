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
// Lead: ♠A♠A.  Hand ranks: K Q J 10 9 8 (all different from A, OK)
// ============================================================
describe('pair lead (non-trump)', () => {

  const lead = [c('S', 14, 200), c('S', 14, 201)]; // ♠A ♠A

  it('enough suit + has pair → must play a pair', () => {
    const hand = [
      c('S', 13, 1), c('S', 13, 2), // ♠K ♠K (pair)
      c('S', 12, 3), c('S', 11, 4), c('S', 10, 5), c('S', 9, 6),
    ];
    const lp = classify(lead, cfg5);
    const r1 = validateFollow([c('S', 12, 3), c('S', 11, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain('pair');
    const r2 = validateFollow([c('S', 13, 1), c('S', 13, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough suit + no pair → can play singles', () => {
    const hand = [
      c('S', 13, 1), c('S', 12, 2), c('S', 11, 3), c('S', 10, 4),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 13, 1), c('S', 12, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit + suit cards form a pair → must play that pair', () => {
    const hand = [
      c('S', 13, 1), c('S', 13, 2), // ♠K ♠K (pair, only 2 spades)
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    const r1 = validateFollow([c('S', 13, 1), c('C', 10, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    const r2 = validateFollow([c('S', 13, 1), c('S', 13, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('short suit + no pair → play all suit + fillers', () => {
    const hand = [
      c('S', 13, 1), c('C', 10, 2), c('C', 9, 3),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 13, 1), c('C', 10, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('void in suit → any play valid', () => {
    const hand = [c('C', 13, 1), c('C', 12, 2), c('C', 11, 3)];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('C', 13, 1), c('C', 12, 2)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Tractor lead (non-trump) — 领出拖拉机
// Lead: ♠A♠A♠K♠K 2-pair tractor.  Each rank consumed ×2.
// Hand uses ranks: Q J 10 9 8 7 6 (no overlap)
// ============================================================
describe('tractor lead (non-trump)', () => {

  const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];

  it('enough suit + exact tractor → must play tractor', () => {
    // ♠Q♠Q♠J♠J 2-pair tractor (Q=12, J=11 consecutive at level 5)
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 11, 3), c('S', 11, 4),
      c('S', 10, 5), c('S', 9, 6),
    ];
    const lp = classify(lead, cfg5);
    // accept: exact tractor QJ
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('S', 11, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: no tractor, no pairs (4 singles)
    const r2 = validateFollow([c('S', 12, 1), c('S', 10, 5), c('S', 9, 6), c('S', 8, 7)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + longer tractor → can extract same length', () => {
    // ♠Q♠Q♠J♠J♠10♠10 3-pair tractor (Q=12,J=11,10=10 consecutive)
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 11, 3), c('S', 11, 4),
      c('S', 10, 5), c('S', 10, 6),
      c('S', 9, 7),
    ];
    const lp = classify(lead, cfg5);
    // extract 2-pair from 3-pair ≡ valid
    const r = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('S', 11, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('enough suit + no tractor but has pairs → must play pairs', () => {
    // ♠Q♠Q + ♠9♠9 (gap at J=11,10 — not consecutive)
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 9, 3), c('S', 9, 4),
      c('S', 8, 5),
    ];
    const lp = classify(lead, cfg5);
    // accept: 2 pairs fill the tractor slot
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 9, 3), c('S', 9, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 1 pair + 2 singles
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 9, 3), c('S', 8, 5)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + no tractor + no pairs → can play singles', () => {
    const hand = [
      c('S', 12, 1), c('S', 9, 2), c('S', 8, 3), c('S', 7, 4), c('S', 6, 5),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 9, 2), c('S', 8, 3), c('S', 7, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit → play all suit + fillers', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), // only 2 spades
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('C', 10, 3), c('C', 9, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit, suit cards form a pair → must play that pair', () => {
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q (pair)
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    // accept: pair + 2 fillers
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('C', 10, 3), c('C', 9, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: didn't play both spades
    const r2 = validateFollow([c('S', 12, 1), c('C', 10, 3), c('C', 9, 4), c('C', 8, 5)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

});

// ============================================================
// Tractor lead (trump) — 领出主牌拖拉机
// Lead: ♥A♥A♥K♥K.  Each rank consumed ×2.
// Hand trump: Q J 10 9 (no overlap)
// ============================================================
describe('tractor lead (trump)', () => {

  const lead: Card[] = [
    c('H', 14, 200), c('H', 14, 201), c('H', 13, 202), c('H', 13, 203),
  ];

  it('short trump → must play all trump + fillers', () => {
    const hand = [
      c('H', 12, 1), c('H', 11, 2), // only 2 trump
      c('S', 10, 3), c('S', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    // reject: only 1 trump played
    const r1 = validateFollow([c('H', 12, 1), c('S', 10, 3), c('S', 9, 4), c('S', 8, 5)], hand, lead, lp, null, cfg5);
    expect(r1.valid).toBe(false);
    // accept: both trump + 2 fillers
    const r2 = validateFollow([c('H', 12, 1), c('H', 11, 2), c('S', 10, 3), c('S', 9, 4)], hand, lead, lp, null, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough trump + has tractor → must play tractor', () => {
    // ♥Q♥Q♥J♥J tractor + ♥10 ♥9 singletons
    const hand = [
      c('H', 12, 1), c('H', 12, 2),
      c('H', 11, 3), c('H', 11, 4),
      c('H', 10, 5), c('H', 9, 6),
    ];
    const lp = classify(lead, cfg5);
    // reject: pair + 2 singles (not a tractor)
    const r1 = validateFollow([c('H', 12, 1), c('H', 12, 2), c('H', 10, 5), c('H', 9, 6)], hand, lead, lp, null, cfg5);
    expect(r1.valid).toBe(false);
    // accept: exact tractor ♥Q♥Q♥J♥J
    const r2 = validateFollow([c('H', 12, 1), c('H', 12, 2), c('H', 11, 3), c('H', 11, 4)], hand, lead, lp, null, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough trump + no tractor + has pairs → must fill with pairs', () => {
    // ♥Q♥Q + ♥9♥9 (gap at J=11,10 — not consecutive)
    const hand = [
      c('H', 12, 1), c('H', 12, 2),
      c('H', 9, 3), c('H', 9, 4),
      c('H', 8, 5),
    ];
    const lp = classify(lead, cfg5);
    // accept: 2 pairs
    const r1 = validateFollow([c('H', 12, 1), c('H', 12, 2), c('H', 9, 3), c('H', 9, 4)], hand, lead, lp, null, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 1 pair
    const r2 = validateFollow([c('H', 12, 1), c('H', 12, 2), c('H', 9, 3), c('H', 8, 5)], hand, lead, lp, null, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('void in trump → any play', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4), c('S', 8, 5),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4)], hand, lead, lp, null, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: singles only — 纯单牌甩牌
// Lead: ♠A ♠K ♠Q.  Hand ranks: J 10 9 8 (no overlap)
// classify: 3 singles, no pairs → throw with pairCount=0
// ============================================================
describe('throw (singles only)', () => {

  const lead = [c('S', 14, 200), c('S', 13, 201), c('S', 12, 202)];

  it('enough suit → follow suit', () => {
    const hand = [
      c('S', 11, 1), c('S', 10, 2), c('S', 9, 3), c('S', 8, 4),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 11, 1), c('S', 10, 2), c('S', 9, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit → play all suit + fillers', () => {
    const hand = [
      c('S', 11, 1), c('C', 10, 2), c('C', 9, 3),
    ];
    const lp = classify(lead, cfg5);
    const r1 = validateFollow([c('C', 10, 2), c('C', 9, 3), c('C', 8, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    const r2 = validateFollow([c('S', 11, 1), c('C', 10, 2), c('C', 9, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('void → any play', () => {
    const hand = [c('C', 13, 1), c('C', 12, 2), c('C', 11, 3), c('C', 10, 4)];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('C', 13, 1), c('C', 12, 2), c('C', 11, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: pair + single — 含对牌和单牌的甩牌
// Lead: ♠A♠A ♠K.  Ranks consumed: A×2, K×1.
// Hand ranks: Q J 10 9 8 (no overlap)
// classify: 1 pair + 1 single → throw with pairCount=1
// ============================================================
describe('throw (pair + single)', () => {

  const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202)];

  it('enough suit + has pair → must play pair', () => {
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q
      c('S', 11, 3), c('S', 10, 4), c('S', 9, 5),
    ];
    const lp = classify(lead, cfg5);
    // reject: 3 singles, no pair
    const r1 = validateFollow([c('S', 12, 1), c('S', 11, 3), c('S', 10, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    // accept: pair + single
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 11, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('enough suit + no pair → can play singles', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('S', 10, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

  it('short suit + suit has pair → must play that pair', () => {
    const hand = [
      c('S', 12, 1), c('S', 12, 2), // ♠Q♠Q (only 2 spades)
      c('C', 10, 3), c('C', 9, 4),
    ];
    const lp = classify(lead, cfg5);
    const r1 = validateFollow([c('S', 12, 1), c('C', 10, 3), c('C', 9, 4)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(false);
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('C', 10, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(true);
  });

  it('short suit + no pair → play all suit + fillers', () => {
    const hand = [
      c('S', 12, 1), c('S', 11, 2), c('C', 10, 3),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 12, 1), c('S', 11, 2), c('C', 10, 3)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: tractor + single — 含拖拉机和单牌的甩牌
// Lead: ♠A♠A♠K♠K ♠Q.  classify → throw (tractor=AAKK, single=Q).
// Ranks consumed: A×2, K×2, Q×1.
// Hand ranks: J 10 9 8 7 6 (no overlap with A,K,Q)
// ============================================================
describe('throw (tractor + single)', () => {

  const lead = [
    c('S', 14, 200), c('S', 14, 201),
    c('S', 13, 202), c('S', 13, 203),
    c('S', 12, 204),
  ];

  it('enough suit + has tractor → must match tractor', () => {
    // ♠J♠J♠10♠10♠9♠9 3-pair tractor (J=11,10=10,9=9 consecutive)
    const hand = [
      c('S', 11, 1), c('S', 11, 2),
      c('S', 10, 3), c('S', 10, 4),
      c('S', 9, 5), c('S', 9, 6),
      c('S', 8, 7),
    ];
    const lp = classify(lead, cfg5);
    // accept: extract 2-pair (JJ1010) + 1 single
    const r1 = validateFollow([c('S', 11, 1), c('S', 11, 2), c('S', 10, 3), c('S', 10, 4), c('S', 8, 7)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: two non-consecutive pairs (JJ+99) + single
    const r2 = validateFollow([c('S', 11, 1), c('S', 11, 2), c('S', 9, 5), c('S', 9, 6), c('S', 8, 7)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + no tractor + has pairs → must fill with pairs', () => {
    // ♠J♠J + ♠8♠8 (gap at 10,9 — not consecutive)
    const hand = [
      c('S', 11, 1), c('S', 11, 2),
      c('S', 8, 3), c('S', 8, 4),
      c('S', 7, 5), c('S', 6, 6),
    ];
    const lp = classify(lead, cfg5);
    // accept: 2 pairs + 1 single
    const r1 = validateFollow([c('S', 11, 1), c('S', 11, 2), c('S', 8, 3), c('S', 8, 4), c('S', 7, 5)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 1 pair + 3 singles
    const r2 = validateFollow([c('S', 11, 1), c('S', 11, 2), c('S', 8, 3), c('S', 7, 5), c('S', 6, 6)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('short suit with tractor → play all suit, tractor match on suit portion', () => {
    // only 4 spades: ♠J♠J♠10♠10 tractor
    const hand = [
      c('S', 11, 1), c('S', 11, 2),
      c('S', 10, 3), c('S', 10, 4),
      c('C', 9, 5),
    ];
    const lp = classify(lead, cfg5);
    const r = validateFollow([c('S', 11, 1), c('S', 11, 2), c('S', 10, 3), c('S', 10, 4), c('C', 9, 5)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Throw: tractor + standalone pair — 含对牌和拖拉机的甩牌
// Lead: ♠A♠A♠K♠K ♠10♠10.
// tractor=AAKK, standalone pair=10,10 (gap at J,Q — not consecutive with K)
// classify → throw: tractors=[{pairCount:2}], pairCount=1
// Ranks consumed: A×2, K×2, 10×2.
// Hand ranks: Q J 9 8 7 6 (no overlap)
// ============================================================
describe('throw (tractor + standalone pair)', () => {

  const lead = [
    c('S', 14, 200), c('S', 14, 201),
    c('S', 13, 202), c('S', 13, 203),
    c('S', 10, 205), c('S', 10, 206),
  ];

  it('enough suit + has matching tractor + extra pair → accept', () => {
    // ♠Q♠Q♠J♠J tractor (Q=12,J=11 consecutive) + ♠9♠9 standalone pair
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 11, 3), c('S', 11, 4),
      c('S', 9, 5), c('S', 9, 6),
      c('S', 8, 7),
    ];
    const lp = classify(lead, cfg5);
    // accept: tractor QJ + pair 99 = 6 cards
    const r1 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('S', 11, 4), c('S', 9, 5), c('S', 9, 6)], hand, lead, lp, 'S' as any, cfg5);
    expect(r1.valid).toBe(true);
    // reject: only 2 pairs + 2 singles (missing tractor/fill)
    const r2 = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 9, 5), c('S', 9, 6), c('S', 8, 7), c('S', 7, 8)], hand, lead, lp, 'S' as any, cfg5);
    expect(r2.valid).toBe(false);
  });

  it('enough suit + no tractor → must fill all with pairs', () => {
    // ♠Q♠Q, ♠9♠9, ♠6♠6 — all gapped (Q-9:11,10 not 5; 9-6:8,7 not 5), no tractor
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('S', 9, 3), c('S', 9, 4),
      c('S', 6, 5), c('S', 6, 6),
      c('S', 4, 7),
    ];
    const lp = classify(lead, cfg5);
    // accept: 3 pairs
    const r = validateFollow([c('S', 12, 1), c('S', 12, 2), c('S', 9, 3), c('S', 9, 4), c('S', 6, 5), c('S', 6, 6)], hand, lead, lp, 'S' as any, cfg5);
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Short-suited / exact-count: no pattern check required.
// When handInGroup <= leadCards, the player MUST play all suit cards
// and fills the rest with any other cards. No pattern matching applies
// because the player has no choice in which suit cards to include.
// ============================================================
describe('short-suited / exact-count (no pattern check)', () => {

  it('exact-count + tractor lead, suit cards are all singles → valid', () => {
    // Lead: 2-pair tractor ♠A♠A♠K♠K (ranks 14,13).
    // Hand: exactly 4 spades, all singles (no pairs at all).
    const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
    const hand = [
      c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4),
      c('C', 8, 5), c('C', 7, 6),
    ];
    const lp = classify(lead, cfg5);
    // Play all 4 spade singles — valid because player must play all suit cards.
    const r = validateFollow(
      [c('S', 12, 1), c('S', 11, 2), c('S', 10, 3), c('S', 9, 4)],
      hand, lead, lp, 'S' as any, cfg5,
    );
    expect(r.valid).toBe(true);
  });

  it('exact-count + pair lead, suit cards are singles (not a pair) → valid', () => {
    // Lead: pair ♠A♠A (rank 14).
    // Hand: exactly 2 spades, not a pair.
    const lead = [c('S', 14, 200), c('S', 14, 201)];
    const hand = [
      c('S', 13, 1), c('S', 12, 2),
      c('C', 10, 3),
    ];
    const lp = classify(lead, cfg5);
    // Play both spades → valid even though they don't form a pair.
    const r = validateFollow(
      [c('S', 13, 1), c('S', 12, 2)],
      hand, lead, lp, 'S' as any, cfg5,
    );
    expect(r.valid).toBe(true);
  });

  it('short-suited + tractor lead, suit portion has pairs but no tractor → valid', () => {
    // Lead: 2-pair tractor ♠A♠A♠K♠K (ranks 14,13), 4 cards.
    // Hand: only 2 spades forming a pair.
    const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
    const hand = [
      c('S', 12, 1), c('S', 12, 2),
      c('C', 10, 3), c('C', 9, 4), c('C', 8, 5),
    ];
    const lp = classify(lead, cfg5);
    // Play both spades as a pair + 2 fillers → valid.
    const r = validateFollow(
      [c('S', 12, 1), c('S', 12, 2), c('C', 10, 3), c('C', 9, 4)],
      hand, lead, lp, 'S' as any, cfg5,
    );
    expect(r.valid).toBe(true);
  });

  it('short-suited + throw (tractor+single), hand has only singles → valid', () => {
    // Lead: tractor+single throw ♠A♠A♠K♠K♠Q (ranks 14,13,12), 5 cards.
    // Hand: only 2 spade singles.
    const lead = [
      c('S', 14, 200), c('S', 14, 201),
      c('S', 13, 202), c('S', 13, 203),
      c('S', 12, 204),
    ];
    const hand = [
      c('S', 11, 1), c('S', 10, 2),
      c('C', 9, 3), c('C', 8, 4), c('C', 7, 5),
    ];
    const lp = classify(lead, cfg5);
    // Play both spade singles + 3 fillers → valid.
    const r = validateFollow(
      [c('S', 11, 1), c('S', 10, 2), c('C', 9, 3), c('C', 8, 4), c('C', 7, 5)],
      hand, lead, lp, 'S' as any, cfg5,
    );
    expect(r.valid).toBe(true);
  });

  it('short-suited + throw (tractor+pair), hand has pairs not forming tractor → valid', () => {
    // Lead: throw with 2-pair tractor + standalone pair (6 cards).
    // Hand: only 3 spades: 1 pair + 1 single.
    const lead = [
      c('S', 14, 200), c('S', 14, 201),
      c('S', 13, 202), c('S', 13, 203),
      c('S', 10, 205), c('S', 10, 206),
    ];
    const hand = [
      c('S', 12, 1), c('S', 12, 2), c('S', 11, 3),
      c('C', 9, 4), c('C', 8, 5), c('C', 7, 6), c('C', 6, 7),
    ];
    const lp = classify(lead, cfg5);
    // Play pair + single + 3 fillers → valid.
    const r = validateFollow(
      [c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('C', 9, 4), c('C', 8, 5), c('C', 7, 6)],
      hand, lead, lp, 'S' as any, cfg5,
    );
    expect(r.valid).toBe(true);
  });

  it('short trump + tractor lead, trump are singles → valid', () => {
    // Lead: 2-pair trump tractor ♥A♥A♥K♥K (ranks 14,13), 4 cards.
    // Hand: only 2 trump singles + non-trump fillers.
    const lead = [
      c('H', 14, 200), c('H', 14, 201), c('H', 13, 202), c('H', 13, 203),
    ];
    const hand = [
      c('H', 12, 1), c('H', 11, 2),
      c('S', 10, 3), c('S', 9, 4), c('S', 8, 5),
    ];
    const lp = classify(lead, cfg5);
    // Play both trump singles + 2 fillers → valid.
    const r = validateFollow(
      [c('H', 12, 1), c('H', 11, 2), c('S', 10, 3), c('S', 9, 4)],
      hand, lead, lp, null, cfg5,
    );
    expect(r.valid).toBe(true);
  });

  it('exact-count + tractor lead, suit forms a tractor → valid (still no pattern check needed)', () => {
    // Lead: 2-pair tractor ♠A♠A♠K♠K (ranks 14,13).
    // Hand: exactly 4 spades forming a tractor.
    const lead = [c('S', 14, 200), c('S', 14, 201), c('S', 13, 202), c('S', 13, 203)];
    const hand = [
      c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('S', 11, 4),
      c('C', 9, 5),
    ];
    const lp = classify(lead, cfg5);
    // Play the tractor → valid (must play all suit cards).
    const r = validateFollow(
      [c('S', 12, 1), c('S', 12, 2), c('S', 11, 3), c('S', 11, 4)],
      hand, lead, lp, 'S' as any, cfg5,
    );
    expect(r.valid).toBe(true);
  });

});

// ============================================================
// Basic / legacy tests
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
      hand.find(c1 => c1.suit === 'C' && c1.rank === 2)!,
      hand.find(c1 => c1.suit === 'H' && c1.rank === 12)!,
      hand.find(c1 => c1.suit === 'H' && c1.rank === 7)!,
      hand.find(c1 => c1.suit === 'S')!,
    ];
    const r = validateFollow(play, hand, lead, lp, null, cfg2);
    expect(r.valid).toBe(true);
  });

  it('trump lead with pair — must play pair if available', () => {
    const hand = [c('S', 3, 0), c('S', 3, 1), c('S', 5, 2)];
    const lead = [c('S', 2, 3), c('S', 2, 5)];
    const r = validateFollow([c('S', 3, 0), c('S', 5, 2)], hand, lead, classify(lead, trump2), 'S' as any, trump2);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('pair');
  });
});
