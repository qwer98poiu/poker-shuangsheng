import { describe, it, expect } from 'vitest';
import { createFullDeck, getRevealOptions, Rank, Suit } from '@poker/engine';
import type { Card, GameState } from '@poker/engine';
import { playHand } from '../match.js';
import { engineStrategy } from '../strategies.js';
import type { Strategy } from '../types.js';

function cardCopies(suit: Suit, rank: Rank): Card[] {
  return createFullDeck().filter(c => c.suit === suit && c.rank === rank);
}

/** 把指定卡放到指定 deck 位置，其余按模板顺序填充。 */
function deckWithSlots(specials: Card[], slots: number[]): Card[] {
  const used = new Set(specials.map(c => c.id));
  const rest = createFullDeck().filter(c => !used.has(c.id));
  const deck: Card[] = [];
  let ri = 0;
  for (let i = 0; i < 108; i++) {
    const slot = slots.indexOf(i);
    deck.push(slot >= 0 ? specials[slot] : rest[ri++]);
  }
  return deck;
}

function withLead(strategy: Strategy, lead: Strategy['lead']): Strategy {
  return { ...strategy, name: 'test-lead', lead };
}

function withFollow(strategy: Strategy, follow: Strategy['follow']): Strategy {
  return { ...strategy, name: 'test-follow', follow };
}

/** 保留指定牌不被策略扣底，保证自定义领出一定还在手里。 */
function preserving(strategy: Strategy, specials: Card[]): Strategy {
  const ids = new Set(specials.map(c => c.id));
  return {
    ...strategy,
    chooseBottom: hand => {
      const discard = hand.filter(c => !ids.has(c.id)).slice(0, 8);
      const discardIds = new Set(discard.map(c => c.id));
      return {
        keep: hand.filter(c => !discardIds.has(c.id)),
        discard,
        reason: 'keep test cards',
      };
    },
  };
}

const noReveal: Strategy = {
  ...engineStrategy,
  name: 'no-reveal',
  tryReveal: () => null,
};

const revealFirst: Strategy = {
  ...engineStrategy,
  name: 'reveal-first',
  tryReveal: (hand, _dealt, player, level) => {
    if (player !== 0) return null;
    const opt = getRevealOptions(hand, level).find(o => o.suit === Suit.Spades);
    return opt ? { suit: opt.suit, reason: 'test' } : null;
  },
};

function play(opts: {
  deck: Card[];
  strategies?: [Strategy, Strategy];
  declarerIdx?: number;
  level?: number;
  onReveal?: (e: { dealIndex: number; player: number; suit: Suit | null; strength: number }) => void;
  onThrowFailure?: (e: {
    trickIndex: number; player: number; attemptedCards: Card[]; penaltyDelta: number;
  }) => void;
  onComplete?: (state: GameState) => void;
}): ReturnType<typeof playHand> {
  return playHand({
    deck: opts.deck,
    handIndex: 0,
    declarerIdx: opts.declarerIdx ?? 0,
    level: opts.level ?? 7,
    attackerLevel: 7,
    isFirstHand: false,
    strategies: opts.strategies ?? [noReveal, noReveal],
    onReveal: opts.onReveal,
    onThrowFailure: opts.onThrowFailure,
    onComplete: opts.onComplete,
  });
}

describe('playHand capture hooks', () => {
  it('onReveal only logs effective declarations; failed attempts remain in state.reveals', () => {
    const [s7a, s7b] = cardCopies(Suit.Spades, Rank.Seven);
    const deck = deckWithSlots([s7a, s7b], [0, 4]);
    const logged: { dealIndex: number; player: number; suit: Suit | null; strength: number }[] = [];
    let finalState: GameState | null = null;
    const ev = play({
      deck,
      strategies: [revealFirst, noReveal],
      onReveal: e => logged.push(e),
      onComplete: s => { finalState = s; },
    });

    expect(ev.errors).toBe(0);
    expect(logged).toEqual([
      { dealIndex: 0, player: 0, suit: 'S', strength: 1 },
      { dealIndex: 4, player: 0, suit: 'S', strength: 2 },
    ]);
    if (!finalState) throw new Error('onComplete 未触发');
    const final = finalState as GameState;
    expect(final.reveals.length).toBeGreaterThan(logged.length);
    expect(final.trumpDeclaration?.trumpSuit).toBe('S');
  });

  it('onThrowFailure logs the attempted throw and actual penalty delta', () => {
    const [s2] = cardCopies(Suit.Spades, Rank.Two);
    const [s3] = cardCopies(Suit.Spades, Rank.Three);
    const spade4 = cardCopies(Suit.Spades, Rank.Four)[0];
    const deck = deckWithSlots([s2, spade4, s3], [0, 1, 4]);
    let firstLead = true;
    const throwLead = preserving(withLead(engineStrategy, (hand, ctx) => {
      if (firstLead) {
        firstLead = false;
        return { cards: [s2, s3], reason: 'test throw' };
      }
      return engineStrategy.lead(hand, ctx);
    }), [s2, s3]);
    const logged: {
      trickIndex: number; player: number; attemptedCards: Card[]; penaltyDelta: number;
    }[] = [];
    const ev = play({
      deck,
      strategies: [throwLead, noReveal],
      onThrowFailure: e => logged.push(e),
    });

    expect(logged).toHaveLength(1);
    expect(logged[0].trickIndex).toBe(0);
    expect(logged[0].player).toBe(0);
    expect(logged[0].attemptedCards.map(c => c.id)).toEqual([s2.id, s3.id]);
    expect(logged[0].penaltyDelta).toBe(10);
    expect(ev.errors).toBe(0);
    expect(ev.aborted).toBe(false);
  });

  it('invalid reveal options are silently ignored (no errors)', () => {
    const levelCards = createFullDeck().filter(c => c.rank === Rank.Seven);
    const deck = deckWithSlots(levelCards, [100, 101, 102, 103, 104, 105, 106, 107]);
    let finalState: GameState | null = null;
    const badReveal: Strategy = {
      ...engineStrategy,
      name: 'bad-reveal',
      tryReveal: () => ({ suit: Suit.Spades, reason: 'not an option' }),
    };
    const ev = play({
      deck,
      strategies: [badReveal, badReveal],
      onComplete: s => { finalState = s; },
    });
    expect(ev.errors).toBe(0);
    if (!finalState) throw new Error('onComplete 未触发');
    expect((finalState as GameState).reveals).toEqual([]);
  });
});

describe('A guards: silent fallbacks become errors', () => {
  it('empty lead is counted once and still falls back', () => {
    let first = true;
    const emptyLead = withLead(engineStrategy, (hand, ctx) => {
      if (first) {
        first = false;
        return { cards: [], reason: 'empty' };
      }
      return engineStrategy.lead(hand, ctx);
    });
    const ev = play({ deck: createFullDeck(), strategies: [emptyLead, noReveal] });
    expect(ev.errors).toBe(1);
    expect(ev.aborted).toBe(false);
  });

  it('wrong follow length is counted once and padded from hand', () => {
    const [s2a, s2b] = cardCopies(Suit.Spades, Rank.Two);
    const deck = deckWithSlots([s2a, s2b], [0, 4]);
    let firstLead = true;
    const pairLead = preserving(withLead(engineStrategy, (hand, ctx) => {
      if (firstLead) {
        firstLead = false;
        return { cards: [s2a, s2b], reason: 'pair' };
      }
      return engineStrategy.lead(hand, ctx);
    }), [s2a, s2b]);
    let firstFollow = true;
    const shortFollow = withFollow(engineStrategy, (hand, lead, suit, ctx) => {
      if (firstFollow) {
        firstFollow = false;
        return { cards: hand.slice(0, 1), reason: 'short' };
      }
      return engineStrategy.follow(hand, lead, suit, ctx);
    });
    const ev = play({ deck, strategies: [pairLead, shortFollow] });
    expect(ev.errors).toBe(1);
    expect(ev.aborted).toBe(false);
  });

  it('invalid bottom is counted once and falls back to a legal 8-card bottom', () => {
    const badBottom: Strategy = {
      ...engineStrategy,
      name: 'bad-bottom',
      chooseBottom: hand => ({
        keep: hand,
        discard: Array.from({ length: 8 }, () => hand[0]),
        reason: 'duplicate discard',
      }),
    };
    const ev = play({ deck: createFullDeck(), strategies: [badBottom, noReveal] });
    expect(ev.errors).toBe(1);
    expect(ev.aborted).toBe(false);
  });
});
