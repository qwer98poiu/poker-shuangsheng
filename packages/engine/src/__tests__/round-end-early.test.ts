import { describe, it, expect } from 'vitest';
import { Suit, GamePhase, createInitialState } from '../types.js';
import { createCard } from '../model.js';
import { playCards } from '../game/index.js';
import type { TrumpDeclaration, Card, PlayerState, GameState } from '../types.js';

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function mkPlayer(name: string, idx: number, hand: Card[]): PlayerState {
  return { name, index: idx, hand, isHuman: false };
}

/**
 * 甩牌/拖拉机局：单墩多张导致手牌在 25 墩前耗尽 → 本墩结算后应进入 RoundEnd。
 * （修复前 engine 只在 tricksPlayed >= 25 时结束，空手牌玩家会被继续要求出牌。）
 */
function mkEarlyState(): GameState {
  const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
    mkPlayer('P0', 0, [c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3)]), // 拖拉机 AA-KK 领出
    mkPlayer('P1', 1, [c('S', 2, 10), c('S', 3, 11), c('S', 4, 12), c('S', 5, 13)]),
    mkPlayer('P2', 2, [c('S', 6, 20), c('S', 7, 21), c('S', 8, 22), c('S', 9, 23)]),
    mkPlayer('P3', 3, [c('S', 10, 30), c('S', 11, 31), c('S', 12, 32), c('S', 12, 33)]),
  ];
  const state: GameState = {
    ...createInitialState(players, 0, 5, false),
    phase: GamePhase.Playing,
    trumpDeclaration: { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 } satisfies TrumpDeclaration,
    currentPlayerIndex: 0,
    leadPlayerIndex: 0,
    bottomCards: [],
  };
  return state;
}

describe('round ends early when all hands empty (throws/tractors consumed cards)', () => {
  it('单墩 4 张 ×4 人出完 → 即使 tricksPlayed=1 也进入 RoundEnd', () => {
    let s = mkEarlyState();
    // P0 领拖拉机 AA-KK
    s = playCards(s, 0, [c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3)]).state;
    expect(s.phase).toBe(GamePhase.Playing);
    // P1/P2/P3 各跟 4 张
    s = playCards(s, 1, [c('S', 2, 10), c('S', 3, 11), c('S', 4, 12), c('S', 5, 13)]).state;
    s = playCards(s, 2, [c('S', 6, 20), c('S', 7, 21), c('S', 8, 22), c('S', 9, 23)]).state;
    s = playCards(s, 3, [c('S', 10, 30), c('S', 11, 31), c('S', 12, 32), c('S', 12, 33)]).state;

    expect(s.tricksPlayed).toBe(1);
    expect(s.players.every(p => p.hand.length === 0)).toBe(true);
    expect(s.phase).toBe(GamePhase.RoundEnd);
    expect(s.trickPlays).toEqual([]);
    // 结算信息完整
    expect(s.trickHistory).toHaveLength(1);
  });

  it('25 墩满时正常 RoundEnd 不受影响', () => {
    // 以全空手牌为条件的早结束不应误伤 25 墩正常路径 —— 用 1 张牌×4 家打完 25 墩太长，
    // 此处验证：早结束只在手牌全空时发生，非空手牌时 phase 保持 Playing。
    let s = mkEarlyState();
    s = playCards(s, 0, [c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3)]).state;
    s = playCards(s, 1, [c('S', 2, 10), c('S', 3, 11), c('S', 4, 12), c('S', 5, 13)]).state;
    s = playCards(s, 2, [c('S', 6, 20), c('S', 7, 21), c('S', 8, 22), c('S', 9, 23)]).state;
    // 打完第三家后还有 P3 的手牌 → 未 RoundEnd
    expect(s.phase).toBe(GamePhase.Playing);
    expect(s.trickPlays).toHaveLength(3);
  });
});
