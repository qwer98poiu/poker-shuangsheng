/**
 * 升级记录提取：从一场对决的两场镜像对局中，按小局序数输出升级过程。
 * 同一小局序数的两场使用同一副牌（deckForHand(seed, pair, handIndex)）。
 *
 * 输出字段：小局序数、庄家（A/B，指该方策略）、策略A等级、策略B等级
 * （均指小局开始时的等级）、闲家得分、升级结果（只显示胜利一方；
 * 闲家上台不升级输出 x->x；庄家在 A(14) 打赢输出 x->胜出）。
 */
import { advanceLevel } from './advance-level.js';
import type { HandEvent } from './types.js';

export interface UpgradeLine {
  handIndex: number;
  banker: 'A' | 'B';
  levelA: number;
  levelB: number;
  finalPts: number;
  upgradeSide: 'A' | 'B';
  upgradeFrom: number;
  upgradeTo: number | '胜出';
}

/**
 * 提取一场对局的升级记录（中止局跳过）。
 * @param aParity 策略 A 所在队伍的奇偶（0 = 坐 0/2 号位；1 = 坐 1/3 号位）
 */
export function upgradeLinesForMatch(events: HandEvent[], aParity: 0 | 1): UpgradeLine[] {
  const lines: UpgradeLine[] = [];
  for (const ev of events) {
    if (ev.aborted) continue;
    const bankerIsA = ev.teamBanker === aParity;
    const banker: 'A' | 'B' = bankerIsA ? 'A' : 'B';
    const levelA = bankerIsA ? ev.level : ev.attackerLevel;
    const levelB = bankerIsA ? ev.attackerLevel : ev.level;
    // 胜利一方 = 庄家赢 → 庄家；闲家上台 → 闲家
    const advancingLevel = ev.bankerWon ? ev.level : ev.attackerLevel;
    const upgradeSide: 'A' | 'B' = ev.bankerWon ? banker : (banker === 'A' ? 'B' : 'A');
    const adv = advanceLevel(advancingLevel, ev.finalPts);
    lines.push({
      handIndex: ev.handIndex,
      banker,
      levelA,
      levelB,
      finalPts: ev.finalPts,
      upgradeSide,
      upgradeFrom: advancingLevel,
      upgradeTo: adv.matchOver ? '胜出' : adv.newLevel,
    });
  }
  return lines;
}

export function formatUpgrade(l: UpgradeLine): string {
  return `${l.upgradeSide} ${l.upgradeFrom}->${l.upgradeTo}`;
}
