import { describe, it, expect } from 'vitest';
import { GamePhase, Suit } from '../types.js';
import type { Card, CardSuit, GameState, PlayerState } from '../types.js';
import { createCard } from '../model.js';
import { createInitialState } from '../types.js';
import { buildAIContext } from '../ai/context.js';

function c(s: CardSuit, r: number, i: number): Card { return createCard(s, r, i); }

function player(index: number): PlayerState {
  return { name: `P${index}`, index, hand: [], isHuman: index === 0 };
}

/** 庄家 P1 扣底后的出牌中局面：四家各 3 张手牌 + 8 张底牌。 */
function playingState(trumpSuit: Suit | null): GameState {
  const withHands = [0, 1, 2, 3].map(i => ({
    ...player(i),
    hand: [c('S', 3, i * 2), c('H', 4, i * 2 + 1), c('C', 6, i * 2 + 2)],
  })) as GameState['players'];
  const base = createInitialState(withHands, 1, 2, false);
  return {
    ...base,
    phase: GamePhase.Playing,
    trumpDeclaration: { declarerIndex: 1, trumpSuit, level: 2 },
    // 底牌含主 ♠2 与分牌 ♠10：若泄漏，闲家既能看到张数也能看到具体牌
    bottomCards: [
      c('S', 2, 100), c('S', 10, 101), c('H', 5, 102), c('H', 7, 103),
      c('C', 9, 104), c('C', 11, 105), c('D', 4, 106), c('D', 13, 107),
    ],
  };
}

/**
 * 底牌只有庄家可见：buildAIContext 是 AI 唯一的取信入口，
 * 若把底牌无差别发给四个座位，闲家（含庄家的对家）就能读到底牌。
 */
describe('buildAIContext — 底牌只发给庄家', () => {
  for (const trumpSuit of [Suit.Spades, null] as const) {
    const label = trumpSuit === null ? '无主' : '有主 ♠';

    it(`${label}：庄家 ctx.bottomCards 为 8 张底牌`, () => {
      const state = playingState(trumpSuit);
      const ctx = buildAIContext(state, 1)!;
      expect(ctx.isDeclarer).toBe(true);
      expect(ctx.bottomCards).toHaveLength(8);
      expect(ctx.bottomCards!.map(x => x.id)).toEqual(state.bottomCards.map(x => x.id));
    });

    it(`${label}：另外三个座位 ctx.bottomCards 为 null（含庄家对家 P3）`, () => {
      const state = playingState(trumpSuit);
      expect(buildAIContext(state, 3)!.isDeclarerPartner).toBe(true);
      for (const seat of [0, 2, 3]) {
        const ctx = buildAIContext(state, seat)!;
        expect(ctx.bottomCards).toBeNull();
      }
    });
  }

  it('其余字段不受影响（declarerIndex / isDeclarer / isAttacker）', () => {
    const state = playingState(Suit.Spades);
    const ctx = buildAIContext(state, 0)!;
    expect(ctx.declarerIndex).toBe(1);
    expect(ctx.myIndex).toBe(0);
    expect(ctx.isDeclarer).toBe(false);
    expect(ctx.isDeclarerPartner).toBe(false);
    expect(ctx.isAttacker).toBe(true);
    expect(ctx.trumpSuit).toBe(Suit.Spades);
  });
});
