import { describe, it, expect } from 'vitest';
import { levelBoxState } from '../components/game/CenterArea.js';

// team = index % 2（0 = 玩家1/AI-3，1 = AI-2/AI-4）；teamLevels[team] = 该队等级
describe('levelBoxState — 等级框：我方/对方等级 + 当庄高亮', () => {
  const levels: [number, number] = [5, 3];

  it('P0（队 0）：我方等级 5、对方等级 3', () => {
    const s = levelBoxState(levels, 0, 0);
    expect(s.myLevel).toBe(5);
    expect(s.oppLevel).toBe(3);
  });

  it('P1（队 1）：我方等级 3、对方等级 5（视角换队，等级互换）', () => {
    const s = levelBoxState(levels, 1, 0);
    expect(s.myLevel).toBe(3);
    expect(s.oppLevel).toBe(5);
  });

  it('本队当庄（declarer 0，P0 视角）→ 我方高亮', () => {
    const s = levelBoxState(levels, 0, 0);
    expect(s.myActive).toBe(true);
    expect(s.oppActive).toBe(false);
  });

  it('对家当庄（declarer 1 = 队 1，P0 视角）→ 对方高亮', () => {
    const s = levelBoxState(levels, 0, 1);
    expect(s.myActive).toBe(false);
    expect(s.oppActive).toBe(true);
  });

  it('同队任意座位（P2/AI-3）当庄 → 我方高亮', () => {
    expect(levelBoxState(levels, 0, 2).myActive).toBe(true);
    expect(levelBoxState(levels, 3, 1).myActive).toBe(true); // P3 与 AI-2 同队
  });

  it('declarerIndex 未定（null）→ 双方都不高亮', () => {
    const s = levelBoxState(levels, 0, null);
    expect(s.myActive).toBe(false);
    expect(s.oppActive).toBe(false);
  });
});
