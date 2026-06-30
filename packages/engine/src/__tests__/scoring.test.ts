import { describe, it, expect } from 'vitest';
import { computeLevelChange, accumulateAttackerPoints, finalizeAttackerPoints,
         bottomMultiplier, countBottomPoints } from '../scoring/index.js';

describe('Level change', () => {
  it('大光: 0 pts → defender +3', () => {
    expect(computeLevelChange(0)).toEqual({ defenderChange: 3, attackerChange: 0 });
  });
  it('小光: 5 pts → defender +2', () => {
    expect(computeLevelChange(5)).toEqual({ defenderChange: 2, attackerChange: 0 });
  });
  it('保级: 40 pts → defender +1', () => {
    expect(computeLevelChange(40)).toEqual({ defenderChange: 1, attackerChange: 0 });
  });
  it('上台: 80 pts → both 0', () => {
    expect(computeLevelChange(80)).toEqual({ defenderChange: 0, attackerChange: 0 });
  });
  it('上台+1: 120 pts → attacker +1', () => {
    expect(computeLevelChange(120)).toEqual({ defenderChange: 0, attackerChange: 1 });
  });
  it('上台+2: 160 pts → attacker +2', () => {
    expect(computeLevelChange(160)).toEqual({ defenderChange: 0, attackerChange: 2 });
  });
  it('上台+3: 200 pts → attacker +3', () => {
    expect(computeLevelChange(200)).toEqual({ defenderChange: 0, attackerChange: 3 });
  });
});

describe('Attacker scoring', () => {
  it('attacker wins trick with 10 pts', () => {
    // declarer=0 → defenderTeam=0, attackerTeam=1
    expect(accumulateAttackerPoints(0, 10, 1, 0)).toBe(10);
  });
  it('defender wins trick → no points', () => {
    expect(accumulateAttackerPoints(0, 10, 0, 0)).toBe(0);
  });
  it('attacker wins last trick, gets bottom', () => {
    expect(finalizeAttackerPoints(50, 10, 2, 1, 0)).toBe(70); // 10*2 + 50
  });
  it('defender wins last trick → no bottom', () => {
    expect(finalizeAttackerPoints(50, 10, 2, 0, 0)).toBe(50);
  });
});

describe('Bottom multiplier', () => {
  it('single → 2', () => {
    expect(bottomMultiplier({ type: 'single', cards: [], length: 1, pairCount: 0, tractors: [], hasTractor: false } as any)).toBe(2);
  });
  it('pair → 4', () => {
    expect(bottomMultiplier({ type: 'pair', cards: [], length: 2, pairCount: 1, tractors: [], hasTractor: false } as any)).toBe(4);
  });
  it('tractor with 2 pairs → 8 (2^(2+1))', () => {
    expect(bottomMultiplier({ type: 'tractor', cards: [], length: 4, pairCount: 0, tractors: [{ pairCount: 2 }], hasTractor: true } as any)).toBe(8);
  });
  it('tractor with 3 pairs → 16', () => {
    expect(bottomMultiplier({ type: 'tractor', cards: [], length: 6, pairCount: 0, tractors: [{ pairCount: 3 }], hasTractor: true } as any)).toBe(16);
  });
});
