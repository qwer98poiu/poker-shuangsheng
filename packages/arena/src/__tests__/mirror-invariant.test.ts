import { describe, it, expect } from 'vitest';
import { engineStrategy } from '../strategies.js';
import { runPair } from '../run-pairs.js';
import { playMatch } from '../match.js';

/**
 * 镜像契约：对决内两场用同一副牌（deckForHand 同参），
 * 两场策略等价（A==B）时整场对局必须逐手一致。
 */
describe('mirror invariant', () => {
  it('A==B 时两场镜像对局完全一致：statsA 与 statsB 逐项相等', () => {
    const { statsA, statsB } = runPair(42, 3, engineStrategy, engineStrategy);
    expect(statsA.matches).toEqual(statsB.matches);
    expect(statsA.banker).toEqual(statsB.banker);
    expect(statsA.attacker).toEqual(statsB.attacker);
    expect(statsA.tricks).toEqual(statsB.tricks);
    expect(statsA.handsPlayed).toBe(statsB.handsPlayed);
  });

  it('A==B 时两场对局的事件序列完全一致（相同发牌 → 相同过程）', () => {
    const m1 = playMatch({ seed: 7, pairIndex: 5, strategies: [engineStrategy, engineStrategy], captureEvents: true });
    const m2 = playMatch({ seed: 7, pairIndex: 5, strategies: [engineStrategy, engineStrategy], captureEvents: true });
    expect(m1.handsPlayed).toBe(m2.handsPlayed);
    expect(m1.winnerTeam).toBe(m2.winnerTeam);
    expect(m1.events.map(e => e.finalPts)).toEqual(m2.events.map(e => e.finalPts));
    expect(m1.events.map(e => e.trumpSuit)).toEqual(m2.events.map(e => e.trumpSuit));
  });

  it('A==B 时两场对局每手牌的等级与闲家等级都在 [2,14]', () => {
    const m = playMatch({ seed: 7, pairIndex: 5, strategies: [engineStrategy, engineStrategy], captureEvents: true });
    for (const ev of m.events) {
      expect(ev.level).toBeGreaterThanOrEqual(2);
      expect(ev.level).toBeLessThanOrEqual(14);
      expect(ev.attackerLevel).toBeGreaterThanOrEqual(2);
      expect(ev.attackerLevel).toBeLessThanOrEqual(14);
    }
  });
});
