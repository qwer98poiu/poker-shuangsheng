import { describe, it, expect } from 'vitest';
import { createCard, createInitialState, GamePhase, Suit } from '@poker/engine';
import type { Card, GameState, PlayerState } from '@poker/engine';
import { cardName, formatGameExport } from './export-game.js';

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);
const mk = (name: string, idx: number, hand: Card[]): PlayerState => ({ name, index: idx, hand, isHuman: false });
const play = (cards: Card[]): any => ({ cards, pattern: { type: 'single', cards, length: 1, pairCount: 0, tractors: [], hasTractor: false }, leadSuit: Suit.Spades });

describe('cardName — CLI 风格单牌', () => {
  it('普通牌与王', () => {
    expect(cardName(c('S', 14, 0))).toBe('♠A');
    expect(cardName(c('H', 10, 0))).toBe('♥10');
    expect(cardName(c('D', 15, 0))).toBe('joker');
    expect(cardName(c('J', 16, 0))).toBe('JOKER');
  });
});

describe('formatGameExport — 紧凑 CLI 格式', () => {
  it('包含亮主/底牌/历史/当前墩/手牌全部段落', () => {
    const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
      mk('玩家1', 0, [c('S', 14, 0), c('S', 13, 1)]),
      mk('AI-2', 1, [c('H', 3, 2)]),
      mk('AI-3', 2, [c('D', 5, 3)]),
      mk('AI-4', 3, [c('C', 7, 4)]),
    ];
    const base = createInitialState(players, 1, 2, false);
    const trick: any = {
      plays: [play([c('S', 3, 10)]), play([c('S', 4, 11)]), play([c('S', 5, 12)]), play([c('S', 6, 13)])],
      leadPlayerIndex: 0, winnerIndex: 2, points: 10,
    };
    const gs: GameState = {
      ...base,
      phase: GamePhase.Playing,
      leadPlayerIndex: 0, // 覆盖 createInitialState 的 declarer=1
      trumpDeclaration: { declarerIndex: 1, trumpSuit: Suit.Spades, level: 2 },
      bottomCards: [c('S', 5, 20), c('H', 13, 21)],
      trickHistory: [trick],
      trickPlays: [play([c('D', 7, 30)])],
      attackerPoints: 10,
      tricksPlayed: 1,
      initialHands: [
        [c('S', 14, 0), c('S', 13, 1), c('S', 2, 50)],
        [c('H', 3, 2), c('H', 9, 51)],
        [c('D', 5, 3)],
        [c('C', 7, 4)],
      ],
    };
    const out = formatGameExport({ gameState: gs, roundNumber: 2 });

    expect(out).toContain('第 3 局 | 级牌 2 | 主牌: ♠2 (♠主) | 庄家: AI-2');
    expect(out).toContain('闲家得分: 10 | 墩: 1/25');
    expect(out).toContain('底牌(2): ♠5 ♥K');
    expect(out).toContain('--- 初始手牌 ---');
    expect(out).toContain('玩家1(3): ♠A ♠K ♠2');
    expect(out).toContain('AI-4(1): ♣7');
    expect(out).toContain('第 1 墩');
    expect(out).toContain('👑');
    expect(out).toContain('得分10');
    expect(out).toContain('--- 当前墩 ---');
    expect(out).toContain('玩家1: ♦7');
    expect(out).toContain('--- 手牌 ---');
    expect(out).toContain('玩家1(2): ♠A ♠K');
    expect(out).toContain('AI-2(1): ♥3');
  });
});
