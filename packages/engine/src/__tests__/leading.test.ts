import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import { validateLead } from '../leading/index.js';
import type { TrumpDeclaration } from '../types.js';

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
