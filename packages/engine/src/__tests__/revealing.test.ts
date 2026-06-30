import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import type { CardSuit } from '../types.js';
import { createCard } from '../model.js';
import { getRevealOptions, canOverride, finalize } from '../revealing/index.js';

describe('Revealing — getRevealOptions', () => {
  it('returns NT with strength 4 for pair of BigJokers', () => {
    const opts = getRevealOptions([
      createCard('J' as any, Rank.BigJoker, 0),
      createCard('J' as any, Rank.BigJoker, 1),
    ], 2);
    const nt = opts.find(o => o.suit === null);
    expect(nt).toBeDefined();
    expect(nt!.strength).toBe(4);
  });

  it('returns NT with strength 3 for pair of SmallJokers', () => {
    const opts = getRevealOptions([
      createCard('J' as any, Rank.SmallJoker, 0),
      createCard('J' as any, Rank.SmallJoker, 1),
    ], 2);
    const nt = opts.find(o => o.suit === null);
    expect(nt).toBeDefined();
    expect(nt!.strength).toBe(3);
  });

  it('does NOT return NT for one big + one small joker', () => {
    const opts = getRevealOptions([
      createCard('J' as any, Rank.BigJoker, 0),
      createCard('J' as any, Rank.SmallJoker, 1),
    ], 2);
    expect(opts.find(o => o.suit === null)).toBeUndefined();
  });

  it('returns pair of level cards with strength 2', () => {
    const opts = getRevealOptions([
      createCard(Suit.Spades, Rank.Two, 0),
      createCard(Suit.Spades, Rank.Two, 1),
    ], 2);
    const s = opts.find(o => o.suit === Suit.Spades);
    expect(s!.strength).toBe(2);
  });

  it('returns single level card with strength 1', () => {
    const opts = getRevealOptions([
      createCard(Suit.Hearts, Rank.Five, 0),
    ], 5);
    const h = opts.find(o => o.suit === Suit.Hearts);
    expect(h!.strength).toBe(1);
  });
});

describe('Revealing — canOverride', () => {
  it('BigJoker pair (4) overrides SmallJoker pair (3)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: null, strength: 3 },
      { playerIndex: 1, suit: null, strength: 4 },
    )).toBe(true);
  });

  it('SmallJoker pair (3) overrides level pair (2)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Spades, strength: 2 },
      { playerIndex: 1, suit: null, strength: 3 },
    )).toBe(true);
  });

  it('Equal strength does NOT override', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 2 },
      { playerIndex: 1, suit: Suit.Spades, strength: 2 },
    )).toBe(false);
  });
});
