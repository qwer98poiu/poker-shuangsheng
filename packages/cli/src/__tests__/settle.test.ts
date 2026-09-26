import { describe, it, expect } from 'vitest';
import { settleRound } from '../settle.js';

/**
 * CLI 结算的团队映射 + 引擎 advanceLevel 的规则。
 *
 * 这些用例对应的都是**旧实现会算错**的场景：`gameLoop` 原先自己
 * `level += changes.attackerChange/defenderChange` 并以 `level > 14` 判结束，
 * 没有必打 K/A 的钳制，会把闲家在 K 或 A 上拿高分算成 15 级并直接判比赛结束。
 * 等级「超过 14」在这套规则下不可能出现，故下面既是规则断言也是回归守卫。
 */
describe('settleRound：等级推进与比赛结束', () => {
  it('闲家在 K(13) 拿 160 → 停在 K，比赛继续（旧实现：13+2=15 → 判结束）', () => {
    const r = settleRound([2, 13], { attackerSits: true, finalPts: 160 }, 0);
    expect(r.levels).toEqual([2, 13]);
    expect(r.matchOver).toBe(false);
    expect(r.winnerTeam).toBeNull();
    expect(r.nextDeclarer).toBe(1);
  });

  it('闲家在 Q(12) 拿 160 → 升到 K(13)，不跳过 K（旧实现：12+2=14）', () => {
    const r = settleRound([2, 12], { attackerSits: true, finalPts: 160 }, 0);
    expect(r.levels).toEqual([2, 13]);
    expect(r.matchOver).toBe(false);
  });

  it('闲家在 A(14) 拿 120 → 停在 A，继续打（旧实现：14+1=15 → 判结束）', () => {
    const r = settleRound([2, 14], { attackerSits: true, finalPts: 120 }, 0);
    expect(r.levels).toEqual([2, 14]);
    expect(r.matchOver).toBe(false);
    expect(r.nextDeclarer).toBe(1);
  });

  it('庄家在 A(14) 打赢（40 分）→ 比赛结束，胜方是庄家队', () => {
    const r = settleRound([14, 2], { attackerSits: false, finalPts: 40 }, 0);
    expect(r.matchOver).toBe(true);
    expect(r.winnerTeam).toBe(0);
    expect(r.nextDeclarer).toBe(2);
  });

  it('庄家在 K(13) 打赢（20 分）→ 升到 A(14)，比赛继续', () => {
    const r = settleRound([13, 2], { attackerSits: false, finalPts: 20 }, 0);
    expect(r.levels).toEqual([14, 2]);
    expect(r.matchOver).toBe(false);
  });

  it('庄家为奇数座位时，推进方映射到另一队', () => {
    // declarerIdx 1 → 庄家队 1，闲家队 0；闲家上台时推进的是 TeamAC
    const r = settleRound([12, 2], { attackerSits: true, finalPts: 160 }, 1);
    expect(r.levels).toEqual([13, 2]);
    expect(r.nextDeclarer).toBe(2);
  });

  it('穷举：任何等级/分数/庄家座位下，两队等级都不超过 14（旧实现会到 15）', () => {
    for (let L = 2; L <= 14; L++) {
      for (const P of [0, 5, 40, 80, 120, 160, 320]) {
        for (const declarerIdx of [0, 1, 2, 3]) {
          const r = settleRound([L, L], { attackerSits: P >= 80, finalPts: P }, declarerIdx);
          expect(r.levels[0]).toBeLessThanOrEqual(14);
          expect(r.levels[1]).toBeLessThanOrEqual(14);
          // 只可能有一队被推进，另一队原样
          const changed = [r.levels[0] !== L, r.levels[1] !== L].filter(Boolean).length;
          expect(changed).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
