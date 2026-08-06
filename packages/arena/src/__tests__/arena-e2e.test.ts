import { describe, it, expect } from 'vitest';
import { engineStrategy } from '../strategies.js';
import { runPair, runPairs } from '../run-pairs.js';
import { playMatch } from '../match.js';
import { createStats, addHandStats, addMatchOutcome, mergeStats, toJSON, fromJSON } from '../stats.js';
import { checkSignificance } from '../significance.js';
import { upgradeLinesForMatch } from '../upgrade-log.js';

describe('arena e2e', () => {
  it('1 对决（seed 42）：两场完整对局、胜方统计一致、无中止', () => {
    const { statsA, statsB } = runPair(42, 0, engineStrategy, engineStrategy);
    expect(statsA.matches.played).toBe(2);
    expect(statsB.matches.played).toBe(2);
    // 每场对局恰好记给一方（或平局双方 0.5）
    expect(statsA.matches.won + statsB.matches.won + statsA.matches.drawn).toBe(2);
    // A==B 行为等价 → 两场同胜负（team1 胜），每策略坐 1&3 号位各赢一场
    expect(statsA.matches.won).toBe(1);
    expect(statsB.matches.won).toBe(1);
    expect(statsA.matches.drawn).toBe(0);
    expect(statsA.abortedHands).toBe(0);
    expect(statsB.abortedHands).toBe(0);
    expect(statsA.handsPlayed).toBe(statsB.handsPlayed);
  });

  it('对局完整跑通：事件等级有界、庄家轮转合法、墩数一致', () => {
    const m = playMatch({ seed: 42, pairIndex: 1, strategies: [engineStrategy, engineStrategy], captureEvents: true });
    expect(m.handsPlayed).toBeGreaterThanOrEqual(1);
    expect(m.abortedHands).toBe(0);
    for (const ev of m.events) {
      expect(ev.level).toBeGreaterThanOrEqual(2);
      expect(ev.level).toBeLessThanOrEqual(14);
      expect(ev.attackerLevel).toBeGreaterThanOrEqual(2);
      expect(ev.attackerLevel).toBeLessThanOrEqual(14);
      expect(ev.tricksPlayed).toBeGreaterThanOrEqual(1);
      expect(ev.tricksPlayed).toBeLessThanOrEqual(25);
      expect(ev.tricksWonByTeam0).toBeGreaterThanOrEqual(0);
      expect(ev.tricksWonByTeam0).toBeLessThanOrEqual(ev.tricksPlayed);
      expect(ev.finalPts).toBeGreaterThanOrEqual(0);
    }
    // bankerWon 与 finalPts 自洽
    for (const ev of m.events) {
      expect(ev.bankerWon).toBe(ev.finalPts < 80);
    }
  });

  it('maxHands=1 强制平局：winnerTeam=null、capped=true、各记 0.5 胜', () => {
    const m = playMatch({ seed: 42, pairIndex: 2, strategies: [engineStrategy, engineStrategy], maxHands: 1 });
    expect(m.winnerTeam).toBeNull();
    expect(m.capped).toBe(true);
    expect(m.handsPlayed).toBe(1);
    const s = createStats();
    addMatchOutcome(s, m.winnerTeam, 0, m.finalLevels);
    expect(s.matches).toEqual({ played: 1, won: 0, drawn: 1, oppLevel: { n: 0, d: 0 } });
  });

  it('A==A 冒烟（seed 42, 20 对决）：精确 20/20、不显著、pHat=0.5', () => {
    const { statsA, statsB } = runPairs(42, 0, 20, engineStrategy, engineStrategy);
    expect(statsA.matches.played).toBe(40);
    expect(statsA.matches.won).toBe(20);
    expect(statsA.matches.drawn).toBe(0);
    expect(statsB.matches.played).toBe(40);
    expect(statsB.matches.won).toBe(20);
    expect(statsB.matches.drawn).toBe(0);
    // 镜像对称：双方各胜 20 场，胜时对方平均等级 224/20 = 11.2（A=14）
    expect(statsA.matches.oppLevel).toEqual({ n: 224, d: 20 });
    expect(statsB.matches.oppLevel).toEqual({ n: 224, d: 20 });
    expect(statsA.handsPlayed).toBe(statsB.handsPlayed);
    expect(statsA.abortedHands).toBe(0);
    const sig = checkSignificance(statsA.matches.won, statsB.matches.won, statsA.matches.drawn, statsA.matches.played);
    expect(sig.significant).toBe(false);
    expect(sig.pHat).toBe(0.5);
  });

  it('toJSON → fromJSON 往返保持统计不变', () => {
    const { statsA } = runPair(42, 0, engineStrategy, engineStrategy);
    expect(fromJSON(toJSON(statsA))).toEqual(statsA);
  });

  it('mergeStats 逐对合并 == runPairs 批量合并', () => {
    const p0 = runPair(42, 0, engineStrategy, engineStrategy);
    const p1 = runPair(42, 1, engineStrategy, engineStrategy);
    const batched = runPairs(42, 0, 2, engineStrategy, engineStrategy);
    expect(mergeStats(p0.statsA, p1.statsA)).toEqual(batched.statsA);
    expect(mergeStats(p0.statsB, p1.statsB)).toEqual(batched.statsB);
  });

  it('addHandStats 聚合 = 事件逐条累加', () => {
    const m = playMatch({ seed: 42, pairIndex: 1, strategies: [engineStrategy, engineStrategy], captureEvents: true });
    const s = createStats();
    for (const ev of m.events) addHandStats(s, ev, 0);
    expect(s.handsPlayed).toBe(m.handsPlayed);
    expect(s.abortedHands).toBe(m.abortedHands);
    expect(s.banker.hands + s.attacker.hands).toBe(m.handsPlayed);
  });

  it('等级账本一致性：上一手的升级方成为下一手庄家，双方等级严格衔接（回归：闲家上台升级记错队伍）', () => {
    for (const pair of [0, 1, 2, 3]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [engineStrategy, engineStrategy], captureEvents: true });
      const lines = upgradeLinesForMatch(m.events, 0);
      for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1];
        const cur = lines[i];
        // 上一手升级方成为下一手庄家（庄家保级 → 对家同队；闲家上台 → 闲家队）
        expect(cur.banker).toBe(prev.upgradeSide);
        // 升级方的等级 = 上一手的升级结果；另一方保持不变
        expect(cur.levelA).toBe(prev.upgradeSide === 'A' ? prev.upgradeTo : prev.levelA);
        expect(cur.levelB).toBe(prev.upgradeSide === 'B' ? prev.upgradeTo : prev.levelB);
      }
    }
  });
});
