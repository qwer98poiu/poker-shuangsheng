import { describe, it, expect } from 'vitest';
import {
  Suit, Rank, createFullDeck, createInitialState, GamePhase, playCards,
} from '../index.js';
import type { TrumpDeclaration, PlayerState } from '../types/game.js';
import type { Card } from '../types/card.js';

function makeHand(cards: Card[]): PlayerState {
  return { hand: cards, isHuman: false, name: 'Test', index: 0 };
}

function tConfig(trumpSuit: Suit | null, level: number): TrumpDeclaration {
  return { declarerIndex: 0, trumpSuit, level };
}

function pickCards(deck: Card[], suit: Suit, rank: Rank, count: number): Card[] {
  return deck.filter(c => c.suit === suit && c.rank === rank).slice(0, count);
}

describe('Trump lead: must follow with trump', () => {
  it('rejects non-trump when player has trump and lead is single trump', () => {
    const deck = createFullDeck();
    const config = tConfig(Suit.Hearts, 2);

    const h2pair = pickCards(deck, Suit.Hearts, Rank.Two, 2);
    const d3 = pickCards(deck, Suit.Diamonds, Rank.Three, 1)[0];
    const d4 = pickCards(deck, Suit.Diamonds, Rank.Four, 1)[0];
    const d5 = pickCards(deck, Suit.Diamonds, Rank.Five, 1)[0];
    const d6 = pickCards(deck, Suit.Diamonds, Rank.Six, 1)[0];

    const players = [
      makeHand([d3, d4]),
      makeHand([h2pair[0]]),        // P1 leads trump
      makeHand([h2pair[1], d5, d6]), // P2 has trump + non-trump
      makeHand([d3]),
    ] as [PlayerState, PlayerState, PlayerState, PlayerState];

    let state = createInitialState(players, 0, 2, false);
    state = { ...state, trumpDeclaration: config, phase: GamePhase.Playing, currentPlayerIndex: 1, leadPlayerIndex: 1 };
    state = playCards(state, 1, [h2pair[0]]).state;
    // P2 tries d5 while having h2pair[1] → rejected
    const bad = playCards(state, 2, [d5]);
    expect(bad.error).toBe('领出主牌，你必须跟主牌');
    // P2 correctly follows
    const good = playCards(state, 2, [h2pair[1]]);
    expect(good.error).toBeUndefined();
  });

  it('allows non-trump kill when lead is non-trump and void', () => {
    const deck = createFullDeck();
    const config = tConfig(Suit.Hearts, 2);

    const h2a = pickCards(deck, Suit.Hearts, Rank.Two, 1)[0];
    const h2b = pickCards(deck, Suit.Hearts, Rank.Two, 1)[0];
    const c3a = pickCards(deck, Suit.Clubs, Rank.Three, 1)[0];
    const c3b = pickCards(deck, Suit.Clubs, Rank.Three, 1)[0];
    const c4 = pickCards(deck, Suit.Clubs, Rank.Four, 1)[0];
    const c5 = pickCards(deck, Suit.Clubs, Rank.Five, 1)[0];

    const players = [
      makeHand([h2a]),
      makeHand([c3a, c4, c5]),
      makeHand([h2b]),
      makeHand([c3b]),
    ] as [PlayerState, PlayerState, PlayerState, PlayerState];

    let state = createInitialState(players, 0, 2, false);
    state = { ...state, trumpDeclaration: config, phase: GamePhase.Playing, currentPlayerIndex: 1, leadPlayerIndex: 1 };
    state = playCards(state, 1, [c3a]).state; // P1 leads ♣ (non-trump)
    // P2 has trump, void in ♣ → trump allowed
    state = playCards(state, 2, [h2b]).state;
    // P3 has ♣ → follow suit
    state = playCards(state, 3, [c3b]).state;
    // P0 has trump, void in ♣ → trump allowed
    const r3 = playCards(state, 0, [h2a]);
    expect(r3.error).toBeUndefined();
  });

  it('allows non-trump discard when lead is trump and follower has no trump', () => {
    const deck = createFullDeck();
    const config = tConfig(Suit.Hearts, 2);

    const h2pair = pickCards(deck, Suit.Hearts, Rank.Two, 2);
    const c3a = pickCards(deck, Suit.Clubs, Rank.Three, 1)[0];
    const c3b = pickCards(deck, Suit.Clubs, Rank.Three, 1)[0];
    const c4 = pickCards(deck, Suit.Diamonds, Rank.Four, 1)[0];
    const c5 = pickCards(deck, Suit.Diamonds, Rank.Five, 1)[0];
    const c6 = pickCards(deck, Suit.Diamonds, Rank.Six, 1)[0];

    const players = [
      makeHand([c3a, c4, c5, c6]), // P0: NO trump
      makeHand([h2pair[0]]),         // P1: leads trump
      makeHand([h2pair[1]]),         // P2: has trump
      makeHand([c3b]),               // P3 dummy
    ] as [PlayerState, PlayerState, PlayerState, PlayerState];

    let state = createInitialState(players, 0, 2, false);
    state = { ...state, trumpDeclaration: config, phase: GamePhase.Playing, currentPlayerIndex: 1, leadPlayerIndex: 1 };
    state = playCards(state, 1, [h2pair[0]]).state;
    state = playCards(state, 2, [h2pair[1]]).state; // P2 follows trump
    state = playCards(state, 3, [c3b]).state;
    // P0 has no trump → non-trump discard allowed
    const r3 = playCards(state, 0, [c3a]);
    expect(r3.error).toBeUndefined();
  });
});
