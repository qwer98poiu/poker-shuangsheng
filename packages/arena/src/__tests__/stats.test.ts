import { describe, it, expect } from 'vitest';
import { Suit } from '@poker/engine';
import type { HandEvent } from '../types.js';
import { createStats, addHandStats, addMatchOutcome, mergeStats, toJSON } from '../stats.js';

/** 庄家(team0)在 Q(12) 有主 打赢：闲家 40 分保级。 */
const evBankerWin: HandEvent = {
  handIndex: 0, level: 12, attackerLevel: 10, declarerIdx: 0, teamBanker: 0,
  trumpSuit: Suit.Hearts, bottomPoints: 15, killSuitCount: 1,
  attackerWonLastTrick: false, kouDiAdd: 0, finalPts: 40, bankerWon: true,
  tricksPlayed: 13, tricksWonByTeam0: 9, leadsByTeam0: 7,
  leadCardsByTeam0: 9, leadCardsTotal: 17, aborted: false,
};

/** 闲家(team1)在闲家等级 A(14) 上台赢：NT、抠底 +40。 */
const evAttackerWin: HandEvent = {
  handIndex: 1, level: 5, attackerLevel: 14, declarerIdx: 1, teamBanker: 1,
  trumpSuit: null, bottomPoints: 20, killSuitCount: 0,
  attackerWonLastTrick: true, kouDiAdd: 40, finalPts: 120, bankerWon: false,
  tricksPlayed: 11, tricksWonByTeam0: 3, leadsByTeam0: 5,
  leadCardsByTeam0: 6, leadCardsTotal: 14, aborted: false,
};

const evAborted: HandEvent = {
  ...evBankerWin, handIndex: 2, aborted: true,
};

describe('addHandStats — 我方=team0', () => {
  it('庄家赢局：台上各项精确累加', () => {
    const s = createStats();
    addHandStats(s, evBankerWin, 0);
    expect(s.handsPlayed).toBe(1);
    expect(s.banker.hands).toBe(1);
    expect(s.banker.wins).toBe(1);
    expect(s.banker.perLevel.get(12)).toEqual({ n: 1, d: 1 });
    expect(s.banker.trumpHands).toEqual({ n: 1, d: 1 });
    expect(s.banker.ntHands).toEqual({ n: 0, d: 0 });
    expect(s.banker.avgLoss).toEqual({ n: 40, d: 1 });
    expect(s.banker.avgBottomPts).toEqual({ n: 15, d: 1 });
    expect(s.banker.killSuitFreq).toEqual({ n: 1, d: 1 });
    expect(s.banker.keepBottom).toEqual({ n: 1, d: 1 });
    expect(s.tricks.won).toEqual({ n: 9, d: 13 });
    expect(s.tricks.leads).toEqual({ n: 7, d: 13 });
    expect(s.tricks.leadCards).toEqual({ n: 9, d: 7 });
  });

  it('闲家上台局：台下各项精确累加（含抠底）', () => {
    const s = createStats();
    addHandStats(s, evAttackerWin, 0);
    expect(s.handsPlayed).toBe(1);
    expect(s.attacker.hands).toBe(1);
    expect(s.attacker.wins).toBe(1);
    expect(s.attacker.perLevel.get(14)).toEqual({ n: 1, d: 1 });
    expect(s.attacker.trumpHands).toEqual({ n: 0, d: 0 });
    expect(s.attacker.ntHands).toEqual({ n: 1, d: 1 });
    expect(s.attacker.kouDiFreq).toEqual({ n: 1, d: 1 });
    expect(s.attacker.kouDiSuccess).toEqual({ n: 1, d: 1 });
    expect(s.attacker.avgKouDi).toEqual({ n: 40, d: 1 });
    expect(s.tricks.won).toEqual({ n: 3, d: 11 });
    expect(s.tricks.leads).toEqual({ n: 5, d: 11 });
    expect(s.tricks.leadCards).toEqual({ n: 6, d: 5 });
  });
});

describe('addHandStats — 我方=team1（镜像补集）', () => {
  it('同一手牌的补集统计', () => {
    const s = createStats();
    addHandStats(s, evBankerWin, 1);
    addHandStats(s, evAttackerWin, 1);
    // 第一局 team1 是闲家（我方等级 10）
    expect(s.attacker.hands).toBe(1);
    expect(s.attacker.wins).toBe(0);
    expect(s.attacker.perLevel.get(10)).toEqual({ n: 0, d: 1 });
    expect(s.attacker.trumpHands).toEqual({ n: 0, d: 1 });
    expect(s.attacker.kouDiFreq).toEqual({ n: 0, d: 1 });
    expect(s.attacker.kouDiSuccess).toEqual({ n: 0, d: 1 });
    // 第二局 team1 是庄家（等级 5，NT 输局）
    expect(s.banker.hands).toBe(1);
    expect(s.banker.wins).toBe(0);
    expect(s.banker.perLevel.get(5)).toEqual({ n: 0, d: 1 });
    expect(s.banker.ntHands).toEqual({ n: 0, d: 1 });
    expect(s.banker.avgLoss).toEqual({ n: 120, d: 1 });
    expect(s.banker.avgBottomPts).toEqual({ n: 20, d: 1 });
    expect(s.banker.killSuitFreq).toEqual({ n: 0, d: 1 });
    expect(s.banker.keepBottom).toEqual({ n: 0, d: 1 });
    expect(s.banker.trumpHands).toEqual({ n: 0, d: 0 });
    // 墩数补集：总 13 → 我方 4；总 11 → 我方 8
    expect(s.tricks.won).toEqual({ n: 12, d: 24 });
    expect(s.tricks.leads).toEqual({ n: 12, d: 24 });
    expect(s.tricks.leadCards).toEqual({ n: 16, d: 12 }); // (17-9)+(14-6) / (13-7)+(11-5)
  });
});

describe('中止局与 match outcome', () => {
  it('中止局只计入 abortedHands，不进任何分母', () => {
    const s = createStats();
    addHandStats(s, evAborted, 0);
    expect(s.abortedHands).toBe(1);
    expect(s.handsPlayed).toBe(0);
    expect(s.banker.hands).toBe(0);
    expect(s.attacker.hands).toBe(0);
    expect(s.tricks.won).toEqual({ n: 0, d: 0 });
  });

  it('addMatchOutcome：胜/平/负精确计数', () => {
    const s = createStats();
    addMatchOutcome(s, 0, 0);
    addMatchOutcome(s, null, 0);
    addMatchOutcome(s, 1, 0);
    expect(s.matches).toEqual({ played: 3, won: 1, drawn: 1 });
  });
});

describe('mergeStats 与 toJSON', () => {
  it('mergeStats 逐分量相加（含 perLevel map）', () => {
    const a = createStats();
    const b = createStats();
    addHandStats(a, evBankerWin, 0);
    addHandStats(b, evAttackerWin, 0);
    addMatchOutcome(a, 0, 0);
    addMatchOutcome(b, null, 0);
    const m = mergeStats(a, b);
    expect(m.handsPlayed).toBe(2);
    expect(m.banker.hands).toBe(1);
    expect(m.attacker.hands).toBe(1);
    expect(m.banker.perLevel.get(12)).toEqual({ n: 1, d: 1 });
    expect(m.attacker.perLevel.get(14)).toEqual({ n: 1, d: 1 });
    expect(m.banker.avgLoss).toEqual({ n: 40, d: 1 });
    expect(m.tricks.won).toEqual({ n: 12, d: 24 });
    expect(m.matches).toEqual({ played: 2, won: 1, drawn: 1 });
  });

  it('toJSON：perLevel 转字符串键对象，其余字段原样', () => {
    const s = createStats();
    addHandStats(s, evBankerWin, 0);
    const j = toJSON(s) as any;
    expect(j.banker.perLevel['12']).toEqual({ n: 1, d: 1 });
    expect(j.banker.hands).toBe(1);
    expect(j.tricks.won).toEqual({ n: 9, d: 13 });
    expect(j.matches).toEqual({ played: 0, won: 0, drawn: 0 });
  });
});

describe('抠底频率与抠底成功频率', () => {
  it('底牌无分时赢最后一墩：计入抠底频率，不计入抠底成功频率', () => {
    const evNoPoints: HandEvent = {
      handIndex: 5, level: 6, attackerLevel: 4, declarerIdx: 1, teamBanker: 1,
      trumpSuit: Suit.Hearts, bottomPoints: 0, killSuitCount: 0,
      attackerWonLastTrick: true, kouDiAdd: 0, finalPts: 85, bankerWon: false,
      tricksPlayed: 10, tricksWonByTeam0: 4, leadsByTeam0: 5,
      leadCardsByTeam0: 6, leadCardsTotal: 13, aborted: false,
    };
    const s = createStats();
    addHandStats(s, evNoPoints, 0); // team0 是闲家：赢了最后一墩但底牌无分
    expect(s.attacker.kouDiFreq).toEqual({ n: 1, d: 1 });
    expect(s.attacker.kouDiSuccess).toEqual({ n: 0, d: 0 }); // 分母只计底牌有分的小局
    expect(s.attacker.avgKouDi).toEqual({ n: 0, d: 0 }); // 无底分自然无抠底加分
  });

  it('NT 胜率：两局无主当庄一胜一负 → {n:1,d:2}', () => {
    const win: HandEvent = { ...evBankerWin, handIndex: 6, trumpSuit: null, bottomPoints: 0 };
    const lose: HandEvent = {
      ...evAttackerWin, handIndex: 7, teamBanker: 0, declarerIdx: 0,
      attackerWonLastTrick: false, kouDiAdd: 0,
    };
    const s = createStats();
    addHandStats(s, win, 0);
    addHandStats(s, lose, 0);
    expect(s.banker.ntHands).toEqual({ n: 1, d: 2 });
  });
});
