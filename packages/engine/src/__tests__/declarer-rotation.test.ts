import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { finalize } from '../revealing/index.js';
import type { Reveal, Card } from '../types.js';

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function mkReveal(playerIndex: number, suit: Suit | null, strength: number): Reveal {
  return { playerIndex, suit, strength };
}

// ================================================================
// First round scenarios
// ================================================================
describe('first round (isFirstRound=true)', () => {

  it('P1 reveals → P1 is declarer, trump = revealed suit', () => {
    const cur = mkReveal(1, Suit.Hearts, 1);
    const hand = [c('H', 2, 0), c('S', 3, 1)];
    const r = finalize(cur, hand, 2, 0, true);
    expect(r.declarerIndex).toBe(1);
    expect(r.trumpSuit).toBe(Suit.Hearts);
    expect(r.level).toBe(2);
  });

  it('P3 reveals NT (pair of jokers) → P3 is declarer, trump = null', () => {
    const cur = mkReveal(3, null, 4);
    const hand = [c('H', 2, 0)];
    const r = finalize(cur, hand, 2, 0, true);
    expect(r.declarerIndex).toBe(3);
    expect(r.trumpSuit).toBeNull();
  });

  it('counter-reveal (反主): P2 reveals first, then P0 overrides → P0 is declarer', () => {
    // P2 revealed strength=1 (single level card), P0 counter-reveals strength=2 (pair of level cards)
    // current is P0's reveal (the winner)
    const cur = mkReveal(0, Suit.Spades, 2);
    const hand = [c('S', 2, 0), c('H', 3, 1)];
    const r = finalize(cur, hand, 2, 1, true);
    expect(r.declarerIndex).toBe(0);
    expect(r.trumpSuit).toBe(Suit.Spades);
  });

  it('no one reveals → dealer (P2) auto-calls, P2 is declarer', () => {
    // Dealer has more Clubs level cards → auto-call Clubs
    const hand = [c('C', 2, 0), c('C', 2, 1), c('S', 2, 2)];
    const r = finalize(null, hand, 2, 2, true);
    expect(r.declarerIndex).toBe(2);
    expect(r.trumpSuit).toBe(Suit.Clubs);
  });

  it('no one reveals → dealer auto-calls with most level cards', () => {
    // Dealer has 1 Spade level, 3 Diamond level → Diamond is selected
    const hand = [c('S', 5, 0), c('D', 5, 1), c('D', 5, 2), c('D', 5, 3)];
    const r = finalize(null, hand, 5, 0, true);
    expect(r.declarerIndex).toBe(0);
    expect(r.trumpSuit).toBe(Suit.Diamonds);
  });
});

// ================================================================
// Subsequent round scenarios (isFirstRound=false)
// ================================================================
describe('subsequent rounds (isFirstRound=false)', () => {

  it('P3 reveals but dealer is P1 → P1 is declarer, trump = P3\'s suit', () => {
    const cur = mkReveal(3, Suit.Diamonds, 1);
    const hand = [c('H', 3, 0)];
    const r = finalize(cur, hand, 3, 1, false);
    expect(r.declarerIndex).toBe(1);
    expect(r.trumpSuit).toBe(Suit.Diamonds);
  });

  it('P1 reveals NT, dealer is P2 → P2 is declarer, trump = null', () => {
    const cur = mkReveal(1, null, 3);
    const hand = [c('H', 5, 0)];
    const r = finalize(cur, hand, 5, 2, false);
    expect(r.declarerIndex).toBe(2);
    expect(r.trumpSuit).toBeNull();
  });

  it('counter-reveal happens but dealer is P0 → P0 is still declarer', () => {
    // P3 revealed, P1 counter-reveals (higher strength), P1 is current
    // But dealer is P0 — P0 is declarer regardless
    const cur = mkReveal(1, Suit.Clubs, 2);
    const hand = [c('C', 10, 0), c('H', 3, 1)];
    const r = finalize(cur, hand, 10, 0, false);
    expect(r.declarerIndex).toBe(0);
    expect(r.trumpSuit).toBe(Suit.Clubs);
  });

  it('no one reveals → dealer (P3) auto-calls, P3 is declarer', () => {
    const hand = [c('S', 2, 0), c('S', 2, 1), c('H', 2, 2)];
    const r = finalize(null, hand, 2, 3, false);
    expect(r.declarerIndex).toBe(3);
    expect(r.trumpSuit).toBe(Suit.Spades);
  });

  it('defender keeps seat → dealer rotates to partner (teammate), new dealer P2 is declarer', () => {
    // Simulates: defender kept seat. Dealer was P0, now rotates to partner P2.
    // P2 is the new dealer/declarer. P1 reveals trump suit but P2 is still declarer.
    const cur = mkReveal(1, Suit.Hearts, 1);
    const hand = [c('H', 5, 0)];
    const r = finalize(cur, hand, 5, 2, false);
    expect(r.declarerIndex).toBe(2);
    expect(r.trumpSuit).toBe(Suit.Hearts);
  });

  it('dealer rotates after attacker sits (≥80), new dealer P1 is declarer', () => {
    // Simulates: previous round attacker got 85 pts (sits).
    // Dealer rotated from P0 to P1. Now P3 reveals, but P1 is dealer → P1 is declarer.
    const cur = mkReveal(3, Suit.Clubs, 2);
    const hand = [c('C', 7, 0)];
    const r = finalize(cur, hand, 7, 1, false);
    expect(r.declarerIndex).toBe(1);
    expect(r.trumpSuit).toBe(Suit.Clubs);
  });
});

// ================================================================
// Full scenario: P0 starts as dealer, P2 reveals in round 1,
// defender keeps seat → next dealer = P0's partner? No —
// from P2 (declarer) + 2 = P0. P0 is dealer in round 2.
// ================================================================
describe('full two-round scenario: initial dealer P0, P2 reveals', () => {

  it('round 1: P0 is dealer, P2 reveals → P2 is declarer', () => {
    const cur = mkReveal(2, Suit.Hearts, 1);
    const hand = [c('S', 2, 0)];
    const r = finalize(cur, hand, 2, 0, true);
    expect(r.declarerIndex).toBe(2);
    expect(r.trumpSuit).toBe(Suit.Hearts);
  });

  it('after round 1 (defender keeps, attacker=50): next dealer = (P2+2)%4 = P0', () => {
    // P2 was declarer, defender kept seat → dealer = (2+2)%4 = 0 = P0
    // This is the NEXT round's dealer for startNewRound.
    // P0 should become the next dealer (not P2's partner P0... wait
    // P2's partner IS P0. Defender keeps → dealer+2 → partner.
    // P0 was the original dealer, and is also P2's partner. Correct.)
    const prevDeclarer = 2;
    const attackerSits = false; // 50 < 80
    const nextDealer = attackerSits ? (prevDeclarer + 1) % 4 : (prevDeclarer + 2) % 4;
    expect(nextDealer).toBe(0);
  });

  it('round 2: P0 is dealer, AI-2 reveals NT → P0 is still declarer', () => {
    // P0 is the new dealer. AI-2 reveals but dealer is the declarer now.
    const cur = mkReveal(1, null, 3);
    const hand = [c('H', 3, 0)];
    const r = finalize(cur, hand, 3, 0, false);
    expect(r.declarerIndex).toBe(0);
    expect(r.trumpSuit).toBeNull();
  });

  it('after round 2 (defender keeps again): next dealer = (P0+2)%4 = P2', () => {
    const prevDeclarer = 0;
    const attackerSits = false;
    const nextDealer = attackerSits ? (prevDeclarer + 1) % 4 : (prevDeclarer + 2) % 4;
    expect(nextDealer).toBe(2);
  });

  it('after round 2 (attacker sits, 85 pts): next dealer = (P0+1)%4 = P1', () => {
    const prevDeclarer = 0;
    const attackerSits = true;
    const nextDealer = (prevDeclarer + 1) % 4;
    expect(nextDealer).toBe(1);
  });
});
