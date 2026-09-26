/**
 * 一局结束后的等级推进 —— 纯函数，便于单测（`gameLoop` 本身与 readline/console 耦合，测不了）。
 *
 * 规则全部来自引擎的 `advanceLevel`（`packages/engine/src/scoring/advance-level.ts`），
 * 与 client 的 `packages/client/src/store/gameStore.ts` 结算段逐行同口径：
 * 推进方 = 闲家上台 ? 庄家的对面 : 庄家本人；等级只写回推进方自己那一格。
 *
 * 历史：CLI 的 `gameLoop` 曾自己累加 `changes.attackerChange/defenderChange`、并以
 * `level > 14` 判比赛结束，缺了 `advanceLevel` 的三条钳制（必打 K、闲家在 K 上台停在 K、
 * 闲家在 A 上台停在 A），于是闲家在 K 或 A 上拿高分会被算成 **15 级**并直接判比赛结束——
 * 既把比赛判早结束了，`rankLabel(15)` 还会在界面上打印出字符串 "15"。
 */
import { advanceLevel } from '@poker/engine';

export interface RoundSettlement {
  /** 结算后的两队等级，下标 0 = TeamAC，1 = TeamBD。 */
  levels: [number, number];
  /** 比赛是否结束。引擎口径：仅**庄家在 A 打赢**时为真。 */
  matchOver: boolean;
  /** 胜方（0 = TeamAC，1 = TeamBD）；未结束时为 null。 */
  winnerTeam: 0 | 1 | null;
  /** 下一局的庄家座位。 */
  nextDeclarer: number;
}

/**
 * @param levels 当前两队等级 `[TeamAC, TeamBD]`
 * @param outcome 本局结果；只用到 `attackerSits` 与**含抠底**的 `finalPts`
 *                （即 `computeRoundOutcome` 的返回值，见 `./round-result.ts`）
 * @param declarerIdx 实际庄家座位（首局亮主者可能顶替预定庄家）
 */
export function settleRound(
  levels: [number, number],
  outcome: { attackerSits: boolean; finalPts: number },
  declarerIdx: number,
): RoundSettlement {
  const advancingTeam = (outcome.attackerSits ? (declarerIdx + 1) % 2 : declarerIdx % 2) as 0 | 1;
  const adv = advanceLevel(levels[advancingTeam], outcome.finalPts);
  const nextLevels: [number, number] = [levels[0], levels[1]];
  nextLevels[advancingTeam] = adv.newLevel;
  return {
    levels: nextLevels,
    matchOver: adv.matchOver,
    winnerTeam: adv.matchOver ? ((declarerIdx % 2) as 0 | 1) : null,
    nextDeclarer: outcome.attackerSits ? (declarerIdx + 1) % 4 : (declarerIdx + 2) % 4,
  };
}
