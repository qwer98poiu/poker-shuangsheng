import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '../types.js';
import { createCard } from '../model.js';
import type { TrumpDeclaration, Card } from '../types.js';
import { computeOffSuitControls } from '../ai/bottom-controls.js';

function c(s: string, r: number, idx: number): Card {
  return createCard(s as any, r as any, idx);
}

/** Deterministic card key: suit + zero-padded rank (lexicographic == numeric). */
function keys(cards: Card[]): string[] {
  return cards.map(c => `${c.suit}${String(c.rank).padStart(2, '0')}`).sort();
}

function ctrlOf(hand: Card[], suit: Suit, config: TrumpDeclaration) {
  const info = computeOffSuitControls(hand, config).find(i => i.suit === suit);
  if (!info) throw new Error(`no control info for ${suit}`);
  return info;
}

// level=2, trump=Hearts → off-suits (S/C/D) never contain rank 2.
const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };

describe('computeOffSuitControls', () => {
  it('single top card is the only tier1; 0 pairs → no tier2', () => {
    // C = A K Q J 10 9 8 7 6 5 4 3 (all singles)
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]) {
      hand.push(c('C', r, idx++));
    }
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(keys(info.tier1)).toEqual(['C14']);
    expect(info.tier1PairCount).toBe(0);
    expect(info.tier2.length).toBe(0);
    // 待扣 = everything except the A (points: K 10 + 10 10 + 5 5 = 25)
    expect(keys(info.voidable)).toEqual(
      ['C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12', 'C13'],
    );
    expect(info.voidablePoints).toBe(25);
    expect(info.voidablePairCount).toBe(0);
  });

  it('top pair AA (exactly 1 pair) → only rank>=10 pairs become tier2', () => {
    // C = A A 10 10 8 8 Q J 9 7 6 5 4 3 — no K in hand so the worst case
    // holds both K's (higher pair) and blocks the 1010 / 88 from throwable.
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [14, 14]) hand.push(c('C', r, idx++));
    for (const r of [10, 10, 8, 8]) hand.push(c('C', r, idx++));
    for (const r of [12, 11, 9, 7, 6, 5, 4, 3]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(keys(info.tier1)).toEqual(['C14', 'C14']);
    expect(info.tier1PairCount).toBe(1);
    // tier2 = the rank>=10 pair only; the 88 pair stays discardable.
    expect(keys(info.tier2)).toEqual(['C10', 'C10']);
    expect(keys(info.voidable)).toContain('C08');
    expect(keys(info.voidable)).toContain('C08');
    expect(keys(info.voidable)).not.toContain('C10');
  });

  it('0 pairs in tier1 (single A only) → rank>=10 pairs are NOT tier2', () => {
    // C = A + 10 10 + 8 8 + Q J 9 7 6 5 4 3
    const hand: Card[] = [c('C', 14, 0)];
    let idx = 1;
    for (const r of [10, 10, 8, 8]) hand.push(c('C', r, idx++));
    for (const r of [12, 11, 9, 7, 6, 5, 4, 3]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(info.tier1PairCount).toBe(0);
    expect(info.tier2.length).toBe(0);
    // Both the 1010 and the 88 pairs are ordinary discardable cards.
    expect(keys(info.voidable)).toContain('C10');
    expect(keys(info.voidable)).toContain('C08');
  });

  it('any tractor (even without the top card) counts as tier1', () => {
    // C = K K Q Q J J + 10 9 8 7 6 5 4 3 (no A at all)
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [13, 13, 12, 12, 11, 11]) hand.push(c('C', r, idx++));
    for (const r of [10, 9, 8, 7, 6, 5, 4, 3]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(keys(info.tier1)).toEqual(['C11', 'C11', 'C12', 'C12', 'C13', 'C13']);
    expect(info.tier1PairCount).toBe(3);
    expect(keys(info.voidable)).toEqual(
      ['C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10'],
    );
  });

  it('AA KK tractor (>=2 pairs) → every other pair becomes tier2', () => {
    // C = A A K K + 8 8 + 9 7 6 5 (8 8 is below rank 10 yet still protected)
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [14, 14, 13, 13]) hand.push(c('C', r, idx++));
    hand.push(c('C', 8, idx++));
    hand.push(c('C', 8, idx++));
    for (const r of [9, 7, 6, 5]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(info.tier1PairCount).toBe(2);
    // 88 pair — rank < 10 — protected because tier1 has >= 2 pairs.
    expect(keys(info.tier2)).toEqual(['C08', 'C08']);
    expect(keys(info.voidable)).not.toContain('C08');
    expect(keys(info.voidable)).toEqual(['C05', 'C06', 'C07', 'C09']);
  });

  it('worst-case throwable: a long single run collapses to the top card only', () => {
    // C = A K Q J 10 9 8 (singles) — worst case holds the second A, K, ...
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [14, 13, 12, 11, 10, 9, 8]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(keys(info.tier1)).toEqual(['C14']);
    expect(keys(info.voidable)).toEqual(
      ['C08', 'C09', 'C10', 'C11', 'C12', 'C13'],
    );
  });

  it('top card is K when A is the level (level=A)', () => {
    const cfgA: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 14 };
    // C = K K 10 10 + 9 8 7 6 5 4 3 2 — A cards are all level (trump);
    // no Q/J in hand so the worst case holds QQ/JJ pairs above the 1010.
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [13, 13]) hand.push(c('C', r, idx++));
    for (const r of [10, 10]) hand.push(c('C', r, idx++));
    for (const r of [9, 8, 7, 6, 5, 4, 3, 2]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfgA);
    // top = K pair (rank 13) is tier1; K-K & 10-10 are not consecutive
    // (Q/J ranks between have no pair) so no tractor; tier1 = exactly
    // 1 pair → the rank>=10 1010 becomes tier2.
    expect(keys(info.tier1)).toEqual(['C13', 'C13']);
    expect(info.tier1PairCount).toBe(1);
    expect(keys(info.tier2)).toEqual(['C10', 'C10']);
    expect(keys(info.voidable)).not.toContain('C10');
  });

  it('single top K when A is the level; pair counting handles isolated pairs', () => {
    const cfgA: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 14 };
    // C = K + 9 9 + 8 7 6 5 4 3 2 — K single is the top (A is level).
    const hand: Card[] = [c('C', 13, 0)];
    let idx = 1;
    hand.push(c('C', 9, idx++));
    hand.push(c('C', 9, idx++));
    for (const r of [8, 7, 6, 5, 4, 3, 2]) hand.push(c('C', r, idx++));
    const info = ctrlOf(hand, Suit.Clubs, cfgA);
    expect(keys(info.tier1)).toEqual(['C13']);
    expect(info.tier1PairCount).toBe(0);
    // 99 pair is not protected (tier1 has 0 pairs, rank < 10 rule not applied).
    expect(info.tier2.length).toBe(0);
  });

  it('suit containing only trump cards is skipped', () => {
    // All Hearts are trump (trumpSuit) — nothing left to analyze.
    const hand: Card[] = [];
    let idx = 0;
    for (const r of [14, 13, 12, 11, 10]) hand.push(c('H', r, idx++));
    const infos = computeOffSuitControls(hand, cfg);
    expect(infos.find(i => i.suit === Suit.Hearts)).toBeUndefined();
  });

  it('level cards never appear in off-suit analysis (they are trump)', () => {
    // level=2 → all rank-2 cards are trump wherever they sit.
    const hand: Card[] = [c('C', 2, 0), c('C', 14, 1), c('C', 13, 2)];
    const info = ctrlOf(hand, Suit.Clubs, cfg);
    expect(keys(info.cards)).toEqual(['C13', 'C14']);
    expect(info.tier1.length).toBe(1); // only the A
  });
});
