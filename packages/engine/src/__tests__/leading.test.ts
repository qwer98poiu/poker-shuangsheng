import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import { validateLead, resolveThrowFailure } from '../leading/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

function ct(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

describe('Leading — validateLead', () => {
  const trumpSuit: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };
  const nt: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };

  it('accepts single card', () => {
    const c = createCard(Suit.Clubs, Rank.Ace, 0);
    expect(validateLead([c], [c], trumpSuit).valid).toBe(true);
  });

  it('accepts two same-suit non-trump cards', () => {
    const a = createCard(Suit.Clubs, Rank.Ace, 0);
    const b = createCard(Suit.Clubs, Rank.King, 1);
    expect(validateLead([a, b], [a, b], trumpSuit).valid).toBe(true);
  });

  it('accepts mixed trump cards (all trump = one suit group)', () => {
    const bj = createCard('J' as any, Rank.BigJoker, 0);
    const h2 = createCard(Suit.Hearts, Rank.Two, 1);
    const s2 = createCard(Suit.Spades, Rank.Two, 2);
    const hA = createCard(Suit.Hearts, Rank.Ace, 3);
    const hand = [bj, h2, s2, hA];
    expect(validateLead([bj, h2, s2, hA], hand, trumpSuit).valid).toBe(true);
  });

  it('rejects mixing trump with non-trump', () => {
    const h2 = createCard(Suit.Hearts, Rank.Two, 0);
    const cA = createCard(Suit.Clubs, Rank.Ace, 1);
    const hand = [h2, cA];
    const r = validateLead([h2, cA], hand, trumpSuit);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('same suit group');
  });

  it('rejects mixing two different off-suits', () => {
    const sA = createCard(Suit.Spades, Rank.Ace, 0);
    const cA = createCard(Suit.Clubs, Rank.Ace, 1);
    const r = validateLead([sA, cA], [sA, cA], trumpSuit);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('same suit group');
  });

  it('NT mode: level cards from different suits are all trump, valid together', () => {
    const h2 = createCard(Suit.Hearts, Rank.Two, 0);
    const s2 = createCard(Suit.Spades, Rank.Two, 1);
    const hand = [h2, s2];
    expect(validateLead([h2, s2], hand, nt).valid).toBe(true);
  });

  it('NT mode: level card + off-suit is rejected', () => {
    const h2 = createCard(Suit.Hearts, Rank.Two, 0);
    const hA = createCard(Suit.Hearts, Rank.Ace, 1);
    const r = validateLead([h2, hA], [h2, hA], nt);
    expect(r.valid).toBe(false);
  });

  it('rejects empty play', () => {
    expect(validateLead([], [], trumpSuit).valid).toBe(false);
  });

  it('rejects cards not in hand', () => {
    const c = createCard(Suit.Spades, Rank.Ace, 0);
    expect(validateLead([c], [], trumpSuit).valid).toBe(false);
  });
});

describe('resolveThrowFailure', () => {
  const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };

  it('tractor blocked + pairs unblocked → forces longest tractor', () => {
    const thrown = [
      ct('S', 11, 0), ct('S', 11, 1), ct('S', 10, 2), ct('S', 10, 3),
      ct('S', 8, 4),  ct('S', 8, 5),
      ct('S', 6, 6),
    ];
    const other = [[
      ct('S', 14, 7), ct('S', 14, 8), ct('S', 13, 9), ct('S', 13, 10),
    ]];
    const r = resolveThrowFailure(thrown, other, cfg5);
    expect(r.forcedPlay.length).toBe(4);
    expect(r.reason).toContain('longest tractor');
  });

  it('two tractors (3p + 2p) both blocked → forces 3-pair tractor', () => {
    const thrown = [
      ct('S', 10, 0), ct('S', 10, 1), ct('S', 9, 2), ct('S', 9, 3),
      ct('S', 8, 4),  ct('S', 8, 5),
      ct('S', 4, 6),  ct('S', 4, 7), ct('S', 3, 8), ct('S', 3, 9),
    ];
    const other = [[
      ct('S', 14, 10), ct('S', 14, 11), ct('S', 13, 12), ct('S', 13, 13),
    ]];
    const r = resolveThrowFailure(thrown, other, cfg5);
    expect(r.forcedPlay.length).toBe(6);
    expect(r.reason).toContain('longest tractor');
    expect(r.reason).toContain('3 pairs');
  });

  it('pair blocked + top single unblocked → forces smallest blocked pair', () => {
    const thrown = [
      ct('S', 14, 0), ct('S', 11, 1), ct('S', 11, 2),
      ct('S', 9, 3),  ct('S', 9, 4),
    ];
    const other = [[ct('S', 10, 5), ct('S', 10, 6)]];
    const r = resolveThrowFailure(thrown, other, cfg5);
    expect(r.forcedPlay.length).toBe(2);
    expect(r.reason).toContain('smallest pair');
    expect(r.forcedPlay[0].rank).toBe(9);
  });

  it('pair blocked + single unblocked (level=2, A+55 vs 66) → forces pair', () => {
    const cfg2: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };
    const thrown = [ct('S', 14, 0), ct('S', 5, 1), ct('S', 5, 2)];
    const other = [[ct('S', 6, 3), ct('S', 6, 4)]];
    const r = resolveThrowFailure(thrown, other, cfg2);
    expect(r.forcedPlay.length).toBe(2);
    expect(r.reason).toContain('smallest pair');
    expect(r.forcedPlay[0].rank).toBe(5);
  });

  it('only single blocked → forces smallest blocked single', () => {
    const thrown = [ct('S', 11, 0), ct('S', 10, 1), ct('S', 8, 2)];
    const other = [[ct('S', 14, 3)]];
    const r = resolveThrowFailure(thrown, other, cfg5);
    expect(r.forcedPlay.length).toBe(1);
    expect(r.reason).toContain('smallest single');
    expect(r.forcedPlay[0].rank).toBe(8);
  });

  it('trump tractor blocked + pair unblocked → forces tractor', () => {
    const thrown = [
      ct('H', 11, 0), ct('H', 11, 1), ct('H', 10, 2), ct('H', 10, 3),
      ct('H', 6, 4),  ct('H', 6, 5),
    ];
    const other = [[
      ct('H', 14, 6), ct('H', 14, 7), ct('H', 13, 8), ct('H', 13, 9),
    ]];
    const r = resolveThrowFailure(thrown, other, cfg5);
    expect(r.forcedPlay.length).toBe(4);
    expect(r.reason).toContain('longest tractor');
  });

  it('clubs trump K: small joker + DK + C-AAQQ7766553322, blocked by JJ10109988 → forces 776655', () => {
    const cfgCK: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Clubs, level: 13 };
    const thrown = [
      ct('J', 15, 0),                                // small joker
      ct('D', 13, 1),                                 // D-K (level card)
      ct('C', 14, 2), ct('C', 14, 3),                 // C-AA
      ct('C', 12, 4), ct('C', 12, 5),                 // C-QQ
      ct('C', 7, 6),  ct('C', 7, 7),                  // C-77
      ct('C', 6, 8),  ct('C', 6, 9),                  // C-66
      ct('C', 5, 10), ct('C', 5, 11),                 // C-55
      ct('C', 3, 12), ct('C', 3, 13),                 // C-33
      ct('C', 2, 14), ct('C', 2, 15),                 // C-22
    ];
    const other = [[
      ct('C', 11, 16), ct('C', 11, 17),               // C-JJ
      ct('C', 10, 18), ct('C', 10, 19),               // C-1010
      ct('C', 9, 20),  ct('C', 9, 21),                // C-99
      ct('C', 8, 22),  ct('C', 8, 23),                // C-88
    ]];
    const r = resolveThrowFailure(thrown, other, cfgCK);
    expect(r.forcedPlay.length).toBe(6);
    expect(r.forcedPlay[0].rank).toBe(7);
    expect(r.reason).toContain('longest tractor');
    expect(r.reason).toContain('3 pairs');
  });
});
