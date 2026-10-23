import { describe, it, expect } from 'vitest';
import { createCard, Suit } from '@poker/engine';
import type { Card, GameState, TrumpDeclaration } from '@poker/engine';
import { bestKouMultiplier, settleAbort } from '../abort-settlement.js';
import { playHand } from '../match.js';
import { deckForHand } from '../rng.js';
import { engineStrategy } from '../strategies.js';
import type { Strategy } from '../types.js';

const TRUMP: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 2 };

function c(suit: Suit, rank: number, id: number): Card {
  return createCard(suit, rank, id);
}

/** 5 分牌（rank 5）、10 分牌（rank 10 / K=13）。 */
function pointCards(): { five: Card; ten: Card; king: Card } {
  return {
    five: c(Suit.Diamonds, 5, 900),
    ten: c(Suit.Clubs, 10, 901),
    king: c(Suit.Clubs, 13, 902),
  };
}

function stateOf(partial: {
  attackerPoints: number;
  trickPlays?: Card[][];
  hands: Card[][];
  bottom: Card[];
}): GameState {
  return {
    players: partial.hands.map((hand, i) => ({
      hand, index: i, name: `P${i}`, isHuman: false,
    })) as unknown as GameState['players'],
    trickPlays: (partial.trickPlays ?? []).map(cards => ({
      cards, pattern: { type: 'single', cards, length: cards.length, pairCount: 0, tractors: [], hasTractor: false }, leadSuit: null,
    })),
    bottomCards: partial.bottom,
    attackerPoints: partial.attackerPoints,
    trumpDeclaration: TRUMP,
  } as unknown as GameState;
}

/** 会连 lead/follow 都返回空数组的 sabotaging 策略；引擎回退仍失败时中止。 */
const sabotage: Strategy = {
  name: 'sabotage',
  tryReveal: () => null,
  chooseBottom: (hand: Card[]) => {
    const sorted = [...hand].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
    const discard = sorted.slice(0, 8);
    const keep = hand.filter(card => !discard.some(d => d.id === card.id));
    return { keep, discard, reason: 'sabotage' };
  },
  lead: () => ({ cards: [], reason: 'sabotage' }),
  follow: () => ({ cards: [], reason: 'sabotage' }),
};

describe('bestKouMultiplier（只看未出手牌）', () => {
  it('空手 0 / 单张 2 / 对子 4 / 拖拉机 2^(n+1)', () => {
    expect(bestKouMultiplier([], TRUMP)).toBe(0);
    expect(bestKouMultiplier([c(Suit.Spades, 5, 0)], TRUMP)).toBe(2);
    expect(bestKouMultiplier([c(Suit.Spades, 5, 0), c(Suit.Spades, 5, 1)], TRUMP)).toBe(4);
    expect(bestKouMultiplier([
      c(Suit.Spades, 5, 0), c(Suit.Spades, 5, 1),
      c(Suit.Spades, 6, 2), c(Suit.Spades, 6, 3),
    ], TRUMP)).toBe(8);
    expect(bestKouMultiplier([
      c(Suit.Spades, 5, 0), c(Suit.Spades, 5, 1),
      c(Suit.Spades, 6, 2), c(Suit.Spades, 6, 3),
      c(Suit.Spades, 7, 4), c(Suit.Spades, 7, 5),
    ], TRUMP)).toBe(16);
  });

  it('两对不相邻 → 只算一个对子 ×4', () => {
    expect(bestKouMultiplier([
      c(Suit.Spades, 5, 0), c(Suit.Spades, 5, 1),
      c(Suit.Spades, 7, 2), c(Suit.Spades, 7, 3),
    ], TRUMP)).toBe(4);
  });
});

describe('settleAbort', () => {
  const { five, ten, king } = pointCards();

  it('因闲家中止：按已完成墩的当前分，不加底牌/当前墩/手牌', () => {
    const state = stateOf({
      attackerPoints: 40,
      trickPlays: [[ten]],
      hands: [[king], [five], [], []],
      bottom: [king, ten],
    });
    const r = settleAbort(state, 0, 1, TRUMP); // 座位 1 是闲家
    expect(r.cause).toBe('attacker');
    expect(r.finalPts).toBe(40);
    expect(r.attackerWonLastTrick).toBe(false);
    expect(r.kouDiAdd).toBe(0);
    expect(r.kouMultiplier).toBe(0);
  });

  it('因庄家中止：当前墩分 + 四家手牌分 + 底牌 × 最佳倍率', () => {
    const state = stateOf({
      attackerPoints: 40,
      trickPlays: [[five]], // 5 分
      hands: [
        [ten], // 庄家 10 分
        [c(Suit.Spades, 6, 0), c(Suit.Spades, 6, 1), c(Suit.Spades, 7, 2), c(Suit.Spades, 7, 3)], // 闲家 2 对拖拉机 ×8，无分
        [king], // 庄家对家 10 分
        [five], // 闲家 5 分
      ],
      bottom: [ten, king], // 20 分
    });
    const r = settleAbort(state, 0, 0, TRUMP); // 座位 0 是庄家
    expect(r.cause).toBe('banker');
    expect(r.kouMultiplier).toBe(8);
    expect(r.kouDiAdd).toBe(160);
    expect(r.finalPts).toBe(40 + 5 + 25 + 160);
    expect(r.attackerWonLastTrick).toBe(true);
  });

  it('两名闲家的手牌不合并：各一张 5 不会拼成对子', () => {
    const state = stateOf({
      attackerPoints: 0,
      hands: [[], [c(Suit.Spades, 5, 0)], [], [c(Suit.Spades, 5, 1)]],
      bottom: [ten],
    });
    const r = settleAbort(state, 0, 0, TRUMP);
    expect(r.kouMultiplier).toBe(2); // 单张 ×2；合并会误成对子 ×4
    expect(r.kouDiAdd).toBe(20);
  });

  it('底牌无分：不加抠底', () => {
    const state = stateOf({
      attackerPoints: 40,
      trickPlays: [[five]],
      hands: [[ten], [], [], []],
      bottom: [c(Suit.Clubs, 3, 0)],
    });
    const r = settleAbort(state, 0, 0, TRUMP);
    expect(r.kouMultiplier).toBe(0);
    expect(r.kouDiAdd).toBe(0);
    expect(r.finalPts).toBe(40 + 5 + 10);
  });
});

describe('playHand 的中止归因', () => {
  function findAbort(strategies: [Strategy, Strategy], wantCause: 'banker' | 'attacker'): ReturnType<typeof playHand> | null {
    for (let k = 0; k < 200; k++) {
      const ev = playHand({
        deck: deckForHand(7, 0, k), handIndex: 2, declarerIdx: 0, level: 2, attackerLevel: 2,
        isFirstHand: false, strategies,
      });
      if (ev.aborted && ev.abortCause === wantCause) return ev;
    }
    return null;
  }

  it('闲家策略导致中止：abortCause=attacker、已结算', () => {
    const ev = findAbort([engineStrategy, sabotage], 'attacker');
    expect(ev).not.toBeNull();
    expect(ev!.settled).toBe(true);
    expect(ev!.abortPlayerIdx! % 2).toBe(1);
    expect(ev!.finalPts).toBeGreaterThanOrEqual(0);
  });

  it('庄家策略导致中止：abortCause=banker、已结算', () => {
    const ev = findAbort([sabotage, engineStrategy], 'banker');
    expect(ev).not.toBeNull();
    expect(ev!.settled).toBe(true);
    expect(ev!.abortPlayerIdx! % 2).toBe(0);
    expect(ev!.finalPts).toBeGreaterThanOrEqual(0);
  });
});
