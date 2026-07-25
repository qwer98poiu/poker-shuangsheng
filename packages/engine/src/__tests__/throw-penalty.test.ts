import { describe, it, expect } from 'vitest';
import { Suit, GamePhase, createInitialState } from '../types.js';
import { createCard } from '../model.js';
import { playCards } from '../game/index.js';
import { computeLevelChange } from '../scoring/index.js';
import type { TrumpDeclaration, Card, PlayerState, GameState } from '../types.js';

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function mkPlayer(name: string, idx: number, hand: Card[], isHuman = false): PlayerState {
  return { name, index: idx, hand, isHuman };
}

// Build state. Players at idx 0 and 2 are declarer side (P0+P2), 1 and 3 are attacker side.
function mkState(playerIdx: number, hand: Card[], blocker: Card[], declarerIndex = 0): GameState {
  // Give blocker to a player on the OTHER side
  // If player is declarer (0,2), blocker goes to attacker (1)
  // If player is attacker (1,3), blocker goes to declarer (0)
  const isDeclarer = playerIdx === declarerIndex || playerIdx === (declarerIndex + 2) % 4;
  const blockerIdx = isDeclarer ? 1 : 0;
  const baseHand = [c('H', 3, 80), c('H', 4, 80), c('C', 3, 80), c('D', 3, 80)];
  const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
    mkPlayer('P0', 0, blockerIdx === 0 ? [...blocker, ...baseHand] : [...baseHand]),
    mkPlayer('P1', 1, blockerIdx === 1 ? [...blocker, ...baseHand] : [...baseHand]),
    mkPlayer('P2', 2, [...baseHand, c('H', 6, 80)]),
    mkPlayer('P3', 3, [...baseHand, c('H', 7, 80)]),
  ];
  players[playerIdx] = mkPlayer(`P${playerIdx}`, playerIdx, hand);
  return {
    ...createInitialState(players, 0, 5, false),
    phase: GamePhase.Playing,
    trumpDeclaration: { declarerIndex, trumpSuit: Suit.Hearts, level: 5 },
    currentPlayerIndex: playerIdx,
    leadPlayerIndex: playerIdx,
  };
}

// Throw: S-JJ1010 (tractor, blocked by S-AAKK) + S-88 (pair, not blocked)
function makeThrow(): Card[] {
  return [
    c('S', 11, 0), c('S', 11, 1), c('S', 10, 2), c('S', 10, 3),
    c('S', 8, 4),  c('S', 8, 5),
  ];
}

function makeBlocker(): Card[] {
  return [c('S', 14, 10), c('S', 14, 11), c('S', 13, 10), c('S', 13, 11)];
}

describe('throw penalty', () => {
  const thrown = makeThrow();
  const blocker = makeBlocker();

  // declarerIndex=0 → declarerSide: P0,P2   attackerSide: P1,P3

  it('attacker (P1) fails throw → attackerPoints -10', () => {
    const hand = [...thrown, c('H', 2, 80), c('H', 3, 80), c('C', 4, 80), c('D', 5, 80)];
    const state = mkState(1, hand, blocker);
    expect(state.attackerPoints).toBe(0);

    const r = playCards(state, 1, thrown);

    expect(r.error).toBeUndefined();
    expect(r.forcedPlay).toBeDefined();
    expect(r.state.attackerPoints).toBe(-10);
    expect(r.state.throwPenalties).toEqual([0, 1]);
    expect(r.forceReason).toContain('attacker penalty 1/3');
  });

  it('defender (P0) fails throw → attackerPoints +10', () => {
    const hand = [...thrown, c('H', 2, 80), c('H', 3, 80), c('C', 4, 80), c('D', 5, 80)];
    const state = mkState(0, hand, blocker);
    expect(state.attackerPoints).toBe(0);

    const r = playCards(state, 0, thrown);

    expect(r.error).toBeUndefined();
    expect(r.forcedPlay).toBeDefined();
    expect(r.state.attackerPoints).toBe(10);
    expect(r.state.throwPenalties).toEqual([1, 0]);
    expect(r.forceReason).toContain('defender penalty 1/3');
  });

  it('attacker exceeds 3 penalties → no further fine', () => {
    const hand = [...thrown, c('H', 2, 80), c('H', 3, 80), c('C', 4, 80), c('D', 5, 80)];
    let state = mkState(1, hand, blocker);
    state = { ...state, throwPenalties: [0, 3], attackerPoints: -30 };

    const r = playCards(state, 1, thrown);

    expect(r.error).toBeUndefined();
    expect(r.forcedPlay).toBeDefined();
    expect(r.state.attackerPoints).toBe(-30);
    expect(r.state.throwPenalties).toEqual([0, 3]);
    expect(r.forceReason).toContain('max penalties reached');
  });

  it('defender exceeds 3 penalties → no further fine', () => {
    const hand = [...thrown, c('H', 2, 80), c('H', 3, 80), c('C', 4, 80), c('D', 5, 80)];
    let state = mkState(0, hand, blocker);
    state = { ...state, throwPenalties: [3, 0], attackerPoints: 30 };

    const r = playCards(state, 0, thrown);

    expect(r.error).toBeUndefined();
    expect(r.forcedPlay).toBeDefined();
    expect(r.state.attackerPoints).toBe(30);
    expect(r.state.throwPenalties).toEqual([3, 0]);
    expect(r.forceReason).toContain('max penalties reached');
  });
});

describe('computeLevelChange clamps negative to 0', () => {
  it('-10 → 0 (大光, defender +3)', () => {
    expect(computeLevelChange(-10)).toEqual({ defenderChange: 3, attackerChange: 0 });
  });

  it('-30 → 0 (max possible penalty: 3× -10)', () => {
    expect(computeLevelChange(-30)).toEqual({ defenderChange: 3, attackerChange: 0 });
  });
});

describe('penalty crosses score threshold', () => {
  it('defender fails at 75 pts → attackerPoints=85, attacker sits', () => {
    // 保级 (75) → 上台 (85), defender fails +10 pushes over 80
    const thrown = makeThrow();
    const blocker = makeBlocker();
    const hand = [...thrown, c('H', 2, 80), c('H', 3, 80), c('C', 4, 80), c('D', 5, 80)];
    let state = mkState(0, hand, blocker); // P0 is declarer (defender)
    state = { ...state, attackerPoints: 75 };

    const r = playCards(state, 0, thrown);

    expect(r.error).toBeUndefined();
    expect(r.forcedPlay).toBeDefined();
    expect(r.state.attackerPoints).toBe(85);
    expect(r.state.throwPenalties).toEqual([1, 0]);
    // 85 ≥ 80 → attacker sits
    expect(computeLevelChange(85)).toEqual({ defenderChange: 0, attackerChange: 0 });
  });
});
