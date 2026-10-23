/**
 * 中止小局结算（所有竞技场共用）。
 *
 * 中止不是随机缺失：它是被测策略出了非法牌/无法跟牌。整组作废会把失败样本删掉，
 * 产生选择偏差（出 bug 多的策略反而可能删掉最差的局）。这里按中止玩家所在队结算：
 *
 * - **闲家中止**：按已完成墩的当前分结算（`attackerPoints`），不加当前墩、剩余手牌
 *   或底牌——该小局没有走到最后一墩，底牌尚未结算。
 * - **庄家中止**：假设闲家赢下当前墩和所有剩余墩——当前墩已出牌分 + 四家剩余手牌分
 *   + 底牌分 × 最佳抠底倍率。
 *
 * **最后一墩不会中止**，所以中止时的当前墩一定不是最后一墩，抠底发生在未来的
 * 最后一墩；倍率只从两名闲家**尚未出的手牌**里取。中止发生在墩进行中，两人的
 * 剩余手牌数可能不相等，故分别单独计算、不合并、不互相补齐。
 */

import { countBottomPoints, countTrickPoints, detectTractors, findAllPairs } from '@poker/engine';
import type { Card, GameState, TrumpDeclaration } from '@poker/engine';

export type AbortCause = 'banker' | 'attacker';

export interface AbortSettlement {
  /** 中止玩家所在队。 */
  cause: AbortCause;
  /** 触发中止的玩家座位。 */
  playerIdx: number;
  /** 结算后的闲家最终分（含结算抠底）。 */
  finalPts: number;
  /** 是否视为闲家赢下最后一墩。 */
  attackerWonLastTrick: boolean;
  /** 结算抠底加分；闲家中止时为 0。 */
  kouDiAdd: number;
  /** 实际采用的抠底倍率；0 = 未抠底。 */
  kouMultiplier: number;
}

/**
 * 一手牌能形成的最高抠底倍率：
 * n 对拖拉机 → 2^(n+1)；否则有对子 → 4；否则有牌 → 2；空手 → 0。
 *
 * 倍率相同即加分相同，不需要再按牌型/花色/点数打破平局——那只是在重算同一个分数。
 * 两名闲家各自调用本函数，取较高者；不要把它们的手牌合并（中止发生在墩进行中，
 * 两人的剩余手牌数可能不相等）。
 */
export function bestKouMultiplier(hand: readonly Card[], trump: TrumpDeclaration): number {
  if (hand.length === 0) return 0;
  let best = 0;
  for (const tractor of detectTractors([...hand], trump)) {
    // 拖拉机段长度 = 2 × 对数；n 对 → 2^(n+1)
    best = Math.max(best, 2 ** (tractor.length / 2 + 1));
  }
  if (best === 0 && findAllPairs([...hand]).length > 0) best = 4;
  return best === 0 ? 2 : best;
}

/**
 * 由中止时的 `GameState` 计算结算分。`trump` 必须是该小局实际的
 * `state.trumpDeclaration`（强制无主时 `trumpSuit` 为 null）。
 */
export function settleAbort(
  state: GameState,
  declarerIdx: number,
  abortPlayerIdx: number,
  trump: TrumpDeclaration,
): AbortSettlement {
  const teamBanker = (declarerIdx % 2) as 0 | 1;
  const cause: AbortCause = abortPlayerIdx % 2 === teamBanker ? 'banker' : 'attacker';

  if (cause === 'attacker') {
    return {
      cause,
      playerIdx: abortPlayerIdx,
      finalPts: state.attackerPoints,
      attackerWonLastTrick: false,
      kouDiAdd: 0,
      kouMultiplier: 0,
    };
  }

  // 庄家中止：闲家赢下当前墩和所有剩余墩。
  const currentTrickPts = countTrickPoints(state.trickPlays.map(p => p.cards));
  const handPts = state.players.reduce((sum, p) => sum + countBottomPoints(p.hand), 0);
  const bottomPts = countBottomPoints(state.bottomCards);

  let kouMultiplier = 0;
  if (bottomPts > 0) {
    for (let seat = 0; seat < 4; seat++) {
      if (seat % 2 === teamBanker) continue; // 只取闲家
      kouMultiplier = Math.max(kouMultiplier, bestKouMultiplier(state.players[seat].hand, trump));
    }
  }
  const kouDiAdd = bottomPts * kouMultiplier;

  return {
    cause,
    playerIdx: abortPlayerIdx,
    finalPts: state.attackerPoints + currentTrickPts + handPts + kouDiAdd,
    attackerWonLastTrick: true,
    kouDiAdd,
    kouMultiplier,
  };
}
