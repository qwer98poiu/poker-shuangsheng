import { describe, it, expect } from 'vitest';
import { createCard } from '@poker/engine';
import type { Card } from '@poker/engine';
import {
  mergeFailedThrow, buildFailedThrow, formatAttackerScore,
  type FailedThrow,
} from '../store/throwFailure.js';

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);

describe('mergeFailedThrow — 桌面牌序列与置灰', () => {
  it('无失败回显：原样直通、全部不置灰', () => {
    const played = [c('S', 13, 0)];
    expect(mergeFailedThrow(played, null)).toEqual([
      { card: c('S', 13, 0), dimmed: false },
    ]);
  });

  it('重复 A 压 K：展开为全部尝试牌，未打出的 ♠A 置灰、强制出的 ♠K 排最右', () => {
    const ft: FailedThrow = {
      playerIndex: 0,
      attempted: [c('S', 14, 0), c('S', 13, 0)],
      playedIds: ['S-13-0'],
      notice: 'x',
    };
    expect(mergeFailedThrow([c('S', 13, 0)], ft)).toEqual([
      { card: c('S', 14, 0), dimmed: true },
      { card: c('S', 13, 0), dimmed: false },
    ]);
  });

  it('尝试顺序中强制出的牌在前：重排后仍排最右（不被灰牌覆盖）', () => {
    const ft: FailedThrow = {
      playerIndex: 0,
      attempted: [c('S', 13, 0), c('S', 14, 0)], // 先 K 后 A
      playedIds: ['S-13-0'],
      notice: 'x',
    };
    expect(mergeFailedThrow([], ft)).toEqual([
      { card: c('S', 14, 0), dimmed: true },
      { card: c('S', 13, 0), dimmed: false },
    ]);
  });

  it('多张灰牌保持相对顺序，全部位于强制出牌左侧', () => {
    const ft: FailedThrow = {
      playerIndex: 0,
      attempted: [c('S', 14, 0), c('S', 12, 0), c('S', 7, 0)],
      playedIds: ['S-7-0'],
      notice: 'x',
    };
    expect(mergeFailedThrow([], ft)).toEqual([
      { card: c('S', 14, 0), dimmed: true },
      { card: c('S', 12, 0), dimmed: true },
      { card: c('S', 7, 0), dimmed: false },
    ]);
  });

  it('整手被压（attempted === forcedPlay）：全部不置灰', () => {
    const ft: FailedThrow = {
      playerIndex: 0,
      attempted: [c('S', 13, 0)],
      playedIds: ['S-13-0'],
      notice: 'x',
    };
    expect(mergeFailedThrow([c('S', 13, 0)], ft)).toEqual([
      { card: c('S', 13, 0), dimmed: false },
    ]);
  });

  it('playedIds 不在尝试牌中（异常防御）：回退直通不置灰', () => {
    const ft: FailedThrow = {
      playerIndex: 0,
      attempted: [c('S', 14, 0)],
      playedIds: ['H-3-9'],
      notice: 'x',
    };
    const played = [c('S', 14, 0)];
    expect(mergeFailedThrow(played, ft)).toEqual([{ card: c('S', 14, 0), dimmed: false }]);
  });

  it('真实形态：小王不可被压 → 退回置灰，级牌被强制打出', () => {
    const ft: FailedThrow = {
      playerIndex: 0,
      attempted: [c('J', 15, 0), c('H', 2, 0)],
      playedIds: ['H-2-0'],
      notice: 'x',
    };
    expect(mergeFailedThrow([c('H', 2, 0)], ft)).toEqual([
      { card: c('J', 15, 0), dimmed: true },
      { card: c('H', 2, 0), dimmed: false },
    ]);
  });
});

describe('formatAttackerScore — 得分公式显示格式', () => {
  it('无罚分：仅数字；throwPenalties 缺失（布局注入态）同样仅数字', () => {
    expect(formatAttackerScore(50, [0, 0])).toBe('50');
    expect(formatAttackerScore(50, undefined)).toBe('50');
    expect(formatAttackerScore(50, null)).toBe('50');
  });

  it('仅闲家被罚：实际得分-罚分', () => {
    // 引擎折算后 -10，反推实际 0 → "0-10"
    expect(formatAttackerScore(-10, [0, 1])).toBe('0-10');
  });

  it('仅庄家方被罚：实际得分+罚分', () => {
    // 折算后 45 = 实际 35 + 10
    expect(formatAttackerScore(45, [1, 0])).toBe('35+10');
  });

  it('双方均有罚分：实际-闲家罚+庄家罚', () => {
    // 折算后 30 = 实际 20，闲家罚 10、庄家罚 20
    expect(formatAttackerScore(30, [2, 1])).toBe('20-10+20');
  });
});

describe('buildFailedThrow — 提示文案', () => {
  it('闲家失败：名称 + 强制出牌 + 闲家罚 n/3 + -10 分', () => {
    const ft = buildFailedThrow({
      playerIndex: 0, playerName: '玩家1',
      attempted: [c('S', 14, 0), c('S', 13, 0)],
      forcedPlay: [c('S', 13, 0)],
      penaltiesBefore: [0, 0], penaltiesAfter: [0, 1],
      declarerIndex: 1,
    });
    expect(ft.playerIndex).toBe(0);
    expect(ft.playedIds).toEqual(['S-13-0']);
    expect(ft.notice).toBe('玩家1 甩牌失败！强制出 ♠K（闲家罚 1/3，-10 分）');
  });

  it('庄家方失败：+10 分、庄家罚 n/3', () => {
    const ft = buildFailedThrow({
      playerIndex: 1, playerName: 'AI-2',
      attempted: [c('H', 5, 0), c('H', 5, 1)],
      forcedPlay: [c('H', 5, 0), c('H', 5, 1)],
      penaltiesBefore: [0, 0], penaltiesAfter: [1, 0],
      declarerIndex: 1,
    });
    expect(ft.notice).toBe('AI-2 甩牌失败！强制出 ♥5 ♥5（庄家罚 1/3，+10 分）');
  });

  it('已达 3 次上限：不扣分文案', () => {
    const ft = buildFailedThrow({
      playerIndex: 0, playerName: '玩家1',
      attempted: [c('S', 13, 0)],
      forcedPlay: [c('S', 13, 0)],
      penaltiesBefore: [0, 3], penaltiesAfter: [0, 3],
      declarerIndex: 1,
    });
    expect(ft.notice).toBe('玩家1 甩牌失败！强制出 ♠K（已达 3 次上限，不扣分）');
  });

  it('尝试牌含小王、强制出被压的级牌（大王/小王不可被压，永不为强制出牌）', () => {
    const ft = buildFailedThrow({
      playerIndex: 0, playerName: '玩家1',
      attempted: [c('J', 15, 0), c('H', 2, 0)],
      forcedPlay: [c('H', 2, 0)],
      penaltiesBefore: [0, 0], penaltiesAfter: [0, 1],
      declarerIndex: 1,
    });
    expect(ft.notice).toBe('玩家1 甩牌失败！强制出 ♥2（闲家罚 1/3，-10 分）');
  });
});
