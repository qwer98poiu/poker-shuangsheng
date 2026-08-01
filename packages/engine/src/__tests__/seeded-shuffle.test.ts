import { describe, it, expect } from 'vitest';
import { createFullDeck, mulberry32, seededShuffle } from '../model.js';
import { dealFromDeck } from '../dealing/index.js';

describe('mulberry32', () => {
  it('seed 42 produces the exact reference sequence', () => {
    const r = mulberry32(42);
    expect([r(), r(), r(), r(), r()]).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
      0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('same seed replays the same sequence', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('seededShuffle', () => {
  it('same seed + fresh deck → identical card order', () => {
    const d1 = seededShuffle(createFullDeck(), 42);
    const d2 = seededShuffle(createFullDeck(), 42);
    expect(d1.map(c => c.id)).toEqual(d2.map(c => c.id));
  });

  it('different seeds → different order', () => {
    const d1 = seededShuffle(createFullDeck(), 1);
    const d2 = seededShuffle(createFullDeck(), 2);
    expect(d1.map(c => c.id)).not.toEqual(d2.map(c => c.id));
  });

  it('is a permutation of the 108-card deck and leaves input untouched', () => {
    const deck = createFullDeck();
    const out = seededShuffle(deck, 12345);
    expect(out.length).toBe(108);
    expect(out.map(c => c.id).sort()).toEqual(deck.map(c => c.id).sort());
    expect(deck.length).toBe(108);
    // input array identity unchanged
    expect(deck[0].id).toBe('S-2-0');
  });

  it('dealFromDeck splits deterministically: P0 gets positions 0,4,...,96, bottom is last 8', () => {
    const deck = seededShuffle(createFullDeck(), 7);
    const { hands, bottom } = dealFromDeck(deck);
    const expected = Array.from({ length: 25 }, (_, i) => deck[i * 4].id);
    expect(hands[0].map(c => c.id)).toEqual(expected);
    expect(bottom.map(c => c.id)).toEqual(deck.slice(100, 108).map(c => c.id));
  });
});
