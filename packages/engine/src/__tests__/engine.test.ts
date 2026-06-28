import { describe, it, expect } from 'vitest';
import {
  Suit, SpecialSuit, Rank, ALL_SUITS,
  createCard, createFullDeck, shuffle, dealCards,
  getEffectiveRank, isTrump, sortHand,
  classifyCombo, detectTractor,
  validateLeadPlay,
  createInitialState, GamePhase,
  tryReveal, finalizeReveal, playCards,
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay,
  cardPoints, isPointCard,
} from '../index.js';
import type { TrumpDeclaration, PlayerState } from '../types/game.js';
import type { Card } from '../types/card.js';
import { PatternType } from '../types/play.js';

function makeHand(cards: Card[]): PlayerState {
  return { hand: cards, isHuman: false, name: 'Test', index: 0 };
}

function trumpConfig(trumpSuit: Suit | null, level: number): TrumpDeclaration {
  return { declarerIndex: 0, trumpSuit, level };
}

describe('Card and Deck', () => {
  it('creates 108-card deck', () => {
    const deck = createFullDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c: Card) => c.rank === Rank.SmallJoker)).toHaveLength(2);
    expect(deck.filter((c: Card) => c.rank === Rank.BigJoker)).toHaveLength(2);
  });

  it('deals 25 each + 8 bottom', () => {
    const deck = shuffle(createFullDeck());
    const { hands, bottom } = dealCards(deck);
    hands.forEach((h: Card[]) => expect(h).toHaveLength(25));
    expect(bottom).toHaveLength(8);
  });

  it('card points', () => {
    const k = createCard(Suit.Hearts, Rank.King);
    expect(cardPoints(k.rank)).toBe(10);
    expect(isPointCard(Rank.Ten)).toBe(true);
    expect(isPointCard(Rank.Four)).toBe(false);
  });
});

describe('Rank and Trump', () => {
  it('suit trump mode (trump=♠, level=5)', () => {
    const config = trumpConfig(Suit.Spades, 5);
    expect(getEffectiveRank(createCard(SpecialSuit.Joker, Rank.BigJoker), config)).toBe(1000);
    expect(getEffectiveRank(createCard(SpecialSuit.Joker, Rank.SmallJoker), config)).toBe(900);
    expect(getEffectiveRank(createCard(Suit.Spades, Rank.Five), config)).toBe(800);
    expect(getEffectiveRank(createCard(Suit.Hearts, Rank.Five), config)).toBe(700);
    expect(isTrump(createCard(Suit.Hearts, Rank.Ace), config)).toBe(false);
  });

  it('NT mode (level=5)', () => {
    const config = trumpConfig(null, 5);
    expect(isTrump(createCard(Suit.Hearts, Rank.Five), config)).toBe(true);
    expect(isTrump(createCard(Suit.Spades, Rank.Ace), config)).toBe(false);
  });

  it('sortHand order', () => {
    const config = trumpConfig(Suit.Spades, 5);
    const cards = [
      createCard(Suit.Hearts, Rank.Three),
      createCard(SpecialSuit.Joker, Rank.BigJoker),
      createCard(Suit.Spades, Rank.Ace),
      createCard(Suit.Spades, Rank.Five),
      createCard(SpecialSuit.Joker, Rank.SmallJoker),
      createCard(Suit.Hearts, Rank.Five),
      createCard(Suit.Clubs, Rank.Ace),
    ];
    const sorted = sortHand(cards, config);
    // BJ, SJ, trump level, off-suit level, trump suit, off-suit
    expect(sorted[0].rank).toBe(Rank.BigJoker);
    expect(sorted[1].rank).toBe(Rank.SmallJoker);
    expect(sorted[2].suit).toBe(Suit.Spades);
    expect(sorted[2].rank).toBe(Rank.Five);
    expect(sorted[3].rank).toBe(Rank.Five);
    expect(sorted[3].suit).toBe(Suit.Hearts);
  });
});

describe('Combo and Tractor', () => {
  const config = trumpConfig(Suit.Spades, 5);

  it('two joker pairs form tractor', () => {
    const cards = [
      createCard(SpecialSuit.Joker, Rank.BigJoker), createCard(SpecialSuit.Joker, Rank.BigJoker),
      createCard(SpecialSuit.Joker, Rank.SmallJoker), createCard(SpecialSuit.Joker, Rank.SmallJoker),
    ];
    expect(detectTractor(cards, config).length).toBeGreaterThan(0);
  });

  it('A-A + K-K is tractor', () => {
    const cards = [
      createCard(Suit.Spades, Rank.Ace), createCard(Suit.Spades, Rank.Ace),
      createCard(Suit.Spades, Rank.King), createCard(Suit.Spades, Rank.King),
    ];
    const combo = classifyCombo(cards, config);
    expect(combo.type).toBe(PatternType.Tractor);
  });

  it('6-6 + 4-4 skips level 5', () => {
    const cards = [
      createCard(Suit.Spades, Rank.Six), createCard(Suit.Spades, Rank.Six),
      createCard(Suit.Spades, Rank.Four), createCard(Suit.Spades, Rank.Four),
    ];
    expect(detectTractor(cards, config).length).toBeGreaterThan(0);
  });
});

describe('Play Validation', () => {
  it('validates lead', () => {
    const sA = createCard(Suit.Spades, Rank.Ace);
    expect(validateLeadPlay([sA], makeHand([sA])).valid).toBe(true);
  });

  it('rejects card not in hand', () => {
    expect(validateLeadPlay(
      [createCard(Suit.Spades, Rank.Ace)],
      makeHand([createCard(Suit.Hearts, Rank.King)]),
    ).valid).toBe(false);
  });
});

describe('Game State', () => {
  it('creates state', () => {
    const hands = dealCards(shuffle(createFullDeck())).hands;
    const players = hands.map(h => makeHand(h)) as [PlayerState, PlayerState, PlayerState, PlayerState];
    const state = createInitialState(players, 0, 5, false);
    expect(state.phase).toBe(GamePhase.Dealing);
    expect(state.dealerIndex).toBe(0);
  });

  it('reveal mechanism', () => {
    const hands = dealCards(shuffle(createFullDeck())).hands;
    const players = hands.map(h => makeHand(h)) as [PlayerState, PlayerState, PlayerState, PlayerState];
    let state = createInitialState(players, 0, 5, false);
    // give player 1 a level card
    const h5 = createCard(Suit.Hearts, Rank.Five);
    state = { ...state, players: state.players.map((p, i) =>
      i === 1 ? { ...p, hand: [...p.hand, h5] } : p,
    ) as [PlayerState, PlayerState, PlayerState, PlayerState] };
    state = tryReveal(state, 1, Suit.Hearts);
    expect(state.currentReveal).not.toBeNull();
    expect(state.currentReveal?.suit).toBe(Suit.Hearts);
  });
});

describe('AI', () => {
  it('AI reveals NT with pair of same jokers', () => {
    const hand = [
      createCard(SpecialSuit.Joker, Rank.BigJoker),
      createCard(SpecialSuit.Joker, Rank.BigJoker),
    ];
    const r = aiTryReveal(hand, [], 0, 5, null);
    expect(r).not.toBeNull();
    expect(r!.suit).toBeNull(); // NT
  });

  it('AI does NOT reveal NT with mixed jokers (not a pair)', () => {
    const hand = [
      createCard(SpecialSuit.Joker, Rank.BigJoker),
      createCard(SpecialSuit.Joker, Rank.SmallJoker),
    ];
    const r = aiTryReveal(hand, [], 0, 5, null);
    expect(r).toBeNull(); // one big + one small ≠ pair
  });

  it('AI bottom keeps trump', () => {
    const config = trumpConfig(Suit.Spades, 5);
    const hand: Card[] = [createCard(SpecialSuit.Joker, Rank.BigJoker), createCard(Suit.Spades, Rank.Five)];
    for (let i = 0; i < 31; i++) hand.push(createCard(Suit.Hearts, (i < 13 ? i + 2 : 2) as Rank));
    const { discard, keep } = aiChooseBottomCards(hand, config);
    expect(discard).toHaveLength(8);
    expect(keep).toHaveLength(25);
    expect(keep.some((c: Card) => c.rank === Rank.BigJoker)).toBe(true);
  });

  it('AI leads tractor if available', () => {
    const config = trumpConfig(Suit.Spades, 5);
    const hand = [
      createCard(Suit.Spades, Rank.Ace), createCard(Suit.Spades, Rank.Ace),
      createCard(Suit.Spades, Rank.King), createCard(Suit.Spades, Rank.King),
    ];
    const { cards } = aiLeadPlay(hand, config);
    expect(cards).toHaveLength(4);
  });
});

describe('Comparison: non-trump same suit', () => {
  /** make a fresh deck, pick cards from it — each test gets its own deck */
  function pickCards(deck: Card[], suit: Suit, rank: Rank, count: number): Card[] {
    return deck.filter(c => c.suit === suit && c.rank === rank).slice(0, count);
  }

  it('higher pair beats lower pair in same non-trump suit', () => {
    const deck = createFullDeck();
    // level=2, trump=♠ → ♥ is non-trump, rank 5/6 are not level cards
    const config = trumpConfig(Suit.Spades, 2);
    const h5pair = pickCards(deck, Suit.Hearts, Rank.Five, 2);
    const h6pair = pickCards(deck, Suit.Hearts, Rank.Six, 2);
    const d3 = pickCards(deck, Suit.Diamonds, Rank.Three, 1)[0];
    const d4 = pickCards(deck, Suit.Diamonds, Rank.Four, 1)[0];
    const c7 = pickCards(deck, Suit.Clubs, Rank.Seven, 1)[0];
    const c8 = pickCards(deck, Suit.Clubs, Rank.Eight, 1)[0];

    const players = [
      makeHand([...h5pair]),
      makeHand([...h6pair]),
      makeHand([d3, d4]),
      makeHand([c7, c8]),
    ] as [PlayerState, PlayerState, PlayerState, PlayerState];

    let state = createInitialState(players, 0, 2, false);
    state = { ...state, trumpDeclaration: config, phase: GamePhase.Playing, currentPlayerIndex: 0, leadPlayerIndex: 0 };

    const r0 = playCards(state, 0, h5pair);
    expect(r0.error).toBeUndefined();
    state = r0.state;

    const r1 = playCards(state, 1, h6pair);
    expect(r1.error).toBeUndefined();
    state = r1.state;

    const r2 = playCards(state, 2, [d3, d4]);
    expect(r2.error).toBeUndefined();
    state = r2.state;
    const r3 = playCards(state, 3, [c7, c8]);
    expect(r3.error).toBeUndefined();
    state = r3.state;

    const last = state.trickHistory[state.trickHistory.length - 1];
    // P1 (index 1) with ♥6♥6 should beat P0 (index 0) with ♥5♥5
    expect(last.winnerIndex).toBe(1);
  });

  it('pair beats non-pair in same non-trump suit', () => {
    const deck = createFullDeck();
    const config = trumpConfig(Suit.Spades, 2);
    const h5pair = pickCards(deck, Suit.Hearts, Rank.Five, 2);
    const hA = pickCards(deck, Suit.Hearts, Rank.Ace, 1);
    const h10 = pickCards(deck, Suit.Hearts, Rank.Ten, 1);
    const h3 = pickCards(deck, Suit.Hearts, Rank.Three, 1)[0];
    const h4 = pickCards(deck, Suit.Hearts, Rank.Four, 1)[0];
    const d3 = pickCards(deck, Suit.Diamonds, Rank.Three, 1)[0];
    const d4 = pickCards(deck, Suit.Diamonds, Rank.Four, 1)[0];
    const d5 = pickCards(deck, Suit.Diamonds, Rank.Five, 1)[0];
    const d6 = pickCards(deck, Suit.Diamonds, Rank.Six, 1)[0];

    const players = [
      makeHand([h5pair[0], h5pair[1], h3, h4]),
      makeHand([hA[0], h10[0]]),
      makeHand([d3, d4]),
      makeHand([d5, d6]),
    ] as [PlayerState, PlayerState, PlayerState, PlayerState];

    let state = createInitialState(players, 0, 2, false);
    state = { ...state, trumpDeclaration: config, phase: GamePhase.Playing, currentPlayerIndex: 0, leadPlayerIndex: 0 };

    const r0 = playCards(state, 0, h5pair);
    expect(r0.error).toBeUndefined();
    state = r0.state;

    const r1 = playCards(state, 1, [hA[0], h10[0]]);
    expect(r1.error).toBeUndefined();
    state = r1.state;

    const r2 = playCards(state, 2, [d3, d4]);
    expect(r2.error).toBeUndefined();
    state = r2.state;
    const r3 = playCards(state, 3, [d5, d6]);
    expect(r3.error).toBeUndefined();
    state = r3.state;

    const last = state.trickHistory[state.trickHistory.length - 1];
    // P0 with pair should win
    expect(last.winnerIndex).toBe(0);
  });
});

describe('AI follow: discard smallest when cannot match', () => {
  function pickCards(deck: Card[], suit: Suit, rank: Rank, count: number): Card[] {
    return deck.filter(c => c.suit === suit && c.rank === rank).slice(0, count);
  }

  it('AI plays smallest cards when cannot match pair pattern', () => {
    const deck = createFullDeck();
    const config = trumpConfig(Suit.Spades, 5);
    const lead = pickCards(deck, Suit.Hearts, Rank.Five, 2);
    const hand = [
      pickCards(deck, Suit.Hearts, Rank.Ace, 1)[0],
      pickCards(deck, Suit.Hearts, Rank.Ten, 1)[0],
      pickCards(deck, Suit.Hearts, Rank.Seven, 1)[0],
      pickCards(deck, Suit.Hearts, Rank.Four, 1)[0],
    ];
    const result = aiFollowPlay(hand, lead, Suit.Hearts, config);
    expect(result.cards).toHaveLength(2);
    const ranks = result.cards.map(c => c.rank);
    expect(ranks).not.toContain(Rank.Ace);
    expect(ranks).not.toContain(Rank.Ten);
  });

  it('AI discards smallest non-point when void in lead suit', () => {
    const deck = createFullDeck();
    const config = trumpConfig(Suit.Spades, 5);
    const lead = [pickCards(deck, Suit.Clubs, Rank.Five, 1)[0]];
    const hand = [
      pickCards(deck, Suit.Hearts, Rank.Ace, 1)[0],
      pickCards(deck, Suit.Hearts, Rank.King, 1)[0],
      pickCards(deck, Suit.Hearts, Rank.Four, 1)[0],
      pickCards(deck, Suit.Hearts, Rank.Three, 1)[0],
    ];
    const result = aiFollowPlay(hand, lead, Suit.Clubs, config);
    expect(result.cards).toHaveLength(1);
    const r = result.cards[0].rank;
    expect([Rank.Ace, Rank.King]).not.toContain(r);
    expect([Rank.Three, Rank.Four]).toContain(r);
  });
});

describe('Scoring: attacker points use declarer team', () => {
  function pickCards(deck: Card[], suit: Suit, rank: Rank, count: number): Card[] {
    return deck.filter(c => c.suit === suit && c.rank === rank).slice(0, count);
  }

  it('scores points for attacker when they win a trick with point cards', () => {
    const deck = createFullDeck();
    // declarer=P1 (index=1, TeamBD), attacker=TeamAC (indexes 0,2)
    const config: TrumpDeclaration = { declarerIndex: 1, trumpSuit: Suit.Spades, level: 2 };

    const s5s = pickCards(deck, Suit.Spades, Rank.Five, 2);
    const s7s = pickCards(deck, Suit.Spades, Rank.Seven, 2);
    const hx1 = pickCards(deck, Suit.Hearts, Rank.Ace, 2);
    const hx2 = pickCards(deck, Suit.Diamonds, Rank.Eight, 2);

    const players = [
      makeHand([hx1[0], hx1[1]]),     // P0 = attacker (TeamAC)
      makeHand([s5s[0], s5s[1]]),      // P1 = declarer (TeamBD)
      makeHand([s7s[0], s7s[1]]),      // P2 = attacker (TeamAC)
      makeHand([hx2[0], hx2[1]]),      // P3 = defender (TeamBD)
    ] as [PlayerState, PlayerState, PlayerState, PlayerState];

    let state = createInitialState(players, 1, 2, false);
    state = { ...state, trumpDeclaration: config, phase: GamePhase.Playing, currentPlayerIndex: 1, leadPlayerIndex: 1 };

    // P1 (declarer) leads ♠5♠5 (10 points)
    const r0 = playCards(state, 1, [s5s[0], s5s[1]]);
    expect(r0.error).toBeUndefined();
    state = r0.state;

    // P2 (attacker) follows ♠7♠7 (beats declarer)
    const r1 = playCards(state, 2, [s7s[0], s7s[1]]);
    expect(r1.error).toBeUndefined();
    state = r1.state;

    // P3 (defender) discards
    const r2 = playCards(state, 3, [hx2[0], hx2[1]]);
    expect(r2.error).toBeUndefined();
    state = r2.state;

    // P0 (attacker) discards
    const r3 = playCards(state, 0, [hx1[0], hx1[1]]);
    expect(r3.error).toBeUndefined();
    state = r3.state;

    const last = state.trickHistory[state.trickHistory.length - 1];
    expect(last.winnerIndex).toBe(2); // P2 won
    expect(last.points).toBe(10);     // pair of 5s = 10

    // attackerTeam = (declarerIndex 1) % 2 = 1 → opposite = 0 = TeamAC
    // P2 is index 2, team 0 → attacker!
    expect(state.attackerPoints).toBe(10);
  });
});
