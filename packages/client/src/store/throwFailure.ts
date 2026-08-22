import type { Card } from '@poker/engine';
import { cardName } from '../components/game/export-game.js';

/** 本墩甩牌失败的桌面临时展示（含预渲染消息文案）。瞬态字段，不入快照。 */
export interface FailedThrow {
  playerIndex: number;
  /** 原始尝试的全部牌（保持甩牌顺序）。 */
  attempted: Card[];
  /** 引擎强制实际打出的牌 id（attempted 子集；其余退回手牌、桌面置灰）。 */
  playedIds: string[];
  /** 消息条文案，action 内一次性算好。 */
  notice: string;
}

export interface ThrowEntry { card: Card; dimmed: boolean }

/**
 * 当前墩某座位的桌面牌序列：有失败回显时展开为全部尝试牌并置灰未打出者，
 * 否则原样直通。强制出的小牌排在最右——叠放是后画的盖前画的，
 * 灰牌在前保证它们永远不会盖住实际打出的牌。
 */
export function mergeFailedThrow(
  playedCards: readonly Card[],
  failedThrow: Readonly<FailedThrow> | null,
): ThrowEntry[] {
  if (!failedThrow) return playedCards.map(card => ({ card, dimmed: false }));
  const attemptedIds = new Set(failedThrow.attempted.map(c => c.id));
  const valid = failedThrow.playedIds.length > 0
    && failedThrow.playedIds.every(id => attemptedIds.has(id));
  if (!valid) return playedCards.map(card => ({ card, dimmed: false }));
  const entries = failedThrow.attempted.map(card => ({
    card,
    dimmed: !failedThrow.playedIds.includes(card.id),
  }));
  // 稳定分区：置灰（被退回）在前，实际打出的在后（最右、最上层）
  return [
    ...entries.filter(e => e.dimmed),
    ...entries.filter(e => !e.dimmed),
  ];
}

/**
 * 左上角闲家得分的显示格式：`实际得分-闲家罚分+庄家方罚分`。
 * attackerPoints 为引擎折算后的值（每次甩牌失败 ±10，上限各 3 次）；
 * 反推实际得分后按公式拼接。无罚分时仅显示数字。
 * throwPenalties 缺失（布局回归注入态）→ 仅显示数字。
 */
export function formatAttackerScore(
  attackerPoints: number,
  throwPenalties: readonly [number, number] | undefined | null,
): string {
  const dPen = (throwPenalties?.[0] ?? 0) * 10;
  const aPen = (throwPenalties?.[1] ?? 0) * 10;
  if (dPen === 0 && aPen === 0) return String(attackerPoints);
  const actual = attackerPoints + aPen - dPen;
  let s = String(actual);
  if (aPen > 0) s += `-${aPen}`;
  if (dPen > 0) s += `+${dPen}`;
  return s;
}

/**
 * 由出牌结果构造甩牌失败展示：罚分文案按前后 throwPenalties 差值判断是否
 * 实扣（每方上限 3 次，达上限引擎不再扣分）。
 */
export function buildFailedThrow(args: {
  playerIndex: number;
  playerName: string;
  attempted: readonly Card[];
  forcedPlay: readonly Card[];
  penaltiesBefore: readonly [number, number] | undefined;
  penaltiesAfter: readonly [number, number];
  declarerIndex: number;
}): FailedThrow {
  const teamIdx = args.playerIndex % 2 === args.declarerIndex % 2 ? 0 : 1;
  const team = teamIdx === 0 ? '庄家' : '闲家';
  const count = args.penaltiesAfter[teamIdx];
  const applied = count > (args.penaltiesBefore?.[teamIdx] ?? 0);
  const base = `${args.playerName} 甩牌失败！强制出 ${args.forcedPlay.map(cardName).join(' ')}`;
  const suffix = applied
    ? `（${team}罚 ${count}/3，${teamIdx === 0 ? '+10 分' : '-10 分'}）`
    : `（已达 3 次上限，不扣分）`;
  return {
    playerIndex: args.playerIndex,
    attempted: [...args.attempted],
    playedIds: args.forcedPlay.map(c => c.id),
    notice: `${base}${suffix}`,
  };
}
