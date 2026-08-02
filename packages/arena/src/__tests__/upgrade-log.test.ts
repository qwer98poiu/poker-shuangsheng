import { describe, it, expect } from 'vitest';
import { Suit } from '@poker/engine';
import type { HandEvent } from '../types.js';
import { upgradeLinesForMatch, formatUpgrade } from '../upgrade-log.js';

function ev(partial: Partial<HandEvent>): HandEvent {
  return {
    handIndex: 0, level: 5, attackerLevel: 3, declarerIdx: 0, teamBanker: 0,
    trumpSuit: Suit.Hearts, bottomPoints: 0, killSuitCount: 0,
    attackerWonLastTrick: false, kouDiAdd: 0, finalPts: 40, bankerWon: true,
    tricksPlayed: 13, tricksWonByTeam0: 9, leadsByTeam0: 7,
    leadCardsByTeam0: 9, leadCardsTotal: 17, errors: 0, aborted: false,
    ...partial,
  };
}

describe('upgradeLinesForMatch', () => {
  it('庄家为 A 且庄家赢：A 升级，等级取各自一侧', () => {
    const lines = upgradeLinesForMatch([ev({ handIndex: 0, level: 5, attackerLevel: 3, finalPts: 20, bankerWon: true })], 0);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.banker).toBe('A');
    expect(l.levelA).toBe(5);
    expect(l.levelB).toBe(3);
    expect(l.upgradeSide).toBe('A');
    expect(l.upgradeFrom).toBe(5);
    expect(l.upgradeTo).toBe(7); // 20 分 → 小光 +2
    expect(formatUpgrade(l)).toBe('A 5->7');
  });

  it('庄家为 B 且闲家上台不升级：输出 x->x', () => {
    // teamBanker 1 → aParity 0 时庄家为 B；闲家(A) 90 分上台不升级
    const lines = upgradeLinesForMatch([ev({ teamBanker: 1, level: 6, attackerLevel: 5, finalPts: 90, bankerWon: false })], 0);
    const l = lines[0];
    expect(l.banker).toBe('B');
    expect(l.levelA).toBe(5);
    expect(l.levelB).toBe(6);
    expect(l.upgradeSide).toBe('A');
    expect(l.upgradeFrom).toBe(5);
    expect(l.upgradeTo).toBe(5);
    expect(formatUpgrade(l)).toBe('A 5->5');
  });

  it('庄家在 A(14) 打赢 → 胜出', () => {
    const lines = upgradeLinesForMatch([ev({ level: 14, attackerLevel: 10, finalPts: 40, bankerWon: true })], 0);
    expect(lines[0].upgradeTo).toBe('胜出');
    expect(formatUpgrade(lines[0])).toBe('A 14->胜出');
  });

  it('中止局跳过', () => {
    const lines = upgradeLinesForMatch([ev({ aborted: true }), ev({ handIndex: 1 })], 0);
    expect(lines).toHaveLength(1);
    expect(lines[0].handIndex).toBe(1);
  });

  it('对局2（aParity=1）：parity 0 的庄家标记为 B', () => {
    // B 坐庄输 120 → 闲家(A) 上台 +1：A 2->3
    const lines = upgradeLinesForMatch([ev({ teamBanker: 0, level: 4, attackerLevel: 2, finalPts: 120, bankerWon: false })], 1);
    const l = lines[0];
    expect(l.banker).toBe('B');
    expect(l.levelA).toBe(2);
    expect(l.levelB).toBe(4);
    expect(l.upgradeSide).toBe('A');
    expect(l.upgradeFrom).toBe(2);
    expect(l.upgradeTo).toBe(3);
    expect(formatUpgrade(l)).toBe('A 2->3');
  });
});
