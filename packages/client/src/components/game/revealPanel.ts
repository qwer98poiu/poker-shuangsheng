/**
 * 亮主面板（6 个胶囊框：NT 红 / nt 黑 / ♠♥♣♦）的选项计算。
 *
 * 显示规则：
 * - 图标数统一：没人亮过 → 一律 1 个图标；有人亮过 → 一律 2 个图标
 *   （亮单张后 → 2 个图标，表示可自保成对）；
 * - 无人亮主时有主花色只能单张亮（不直接亮一对，引擎 revealStrength 同规则），
 *   对子仅用于自保（自己同花色巩固）或反主（他人已亮）；
 * - 无主（对王）本身即一对（strength 3/4）。
 */
import type { Card, Reveal } from '@poker/engine';
import { Rank, Suit, canOverride } from '@poker/engine';

export interface RevealPill {
  /** 花色；null = 无主（label 区分 NT/nt） */
  suit: Suit | null;
  /** 点击动作的力量：1 单张 / 2 对 / 3 小王无主 / 4 大王无主 */
  strength: number;
  available: boolean;
  /** 图标数：没人亮过 → 1；有人亮过 → 2（一律） */
  icons: number;
  /** 框内图标文字：'NT' | 'nt' | '♠' | '♥' | '♣' | '♦' */
  label: string;
  /** 红色图标（♥♦ 与大王 NT） */
  red: boolean;
}

export function revealPills(
  hand: readonly Card[],
  level: number,
  current: Reveal | null,
  playerIndex: number,
): RevealPill[] {
  const cur = current;
  // 有主图标数：没人亮过 1 个；有人亮过一律 2 个。无主（NT/nt）恒为 1 个（只有两个字母）。
  const suitIcons = cur ? 2 : 1;

  const make = (
    suit: Suit | null,
    strength: number,
    /** 手牌该牌的张数 */
    have: number,
    label: string,
    red: boolean,
  ): RevealPill => {
    // 无主需 2 张王（strength 3/4 不代表 3/4 张牌）；有主需 strength 张级牌
    const need = suit === null ? 2 : strength;
    const available = have >= need && canOverride(cur, { playerIndex, suit, strength });
    return { suit, strength, available, icons: suit === null ? 1 : suitIcons, label, red };
  };

  const pills: RevealPill[] = [];
  // 无主：对大王（红 NT）/ 对小王（黑 nt）——本身即一对（2 张王）
  const bigJokers = hand.filter(c => c.rank === Rank.BigJoker).length;
  const smallJokers = hand.filter(c => c.rank === Rank.SmallJoker).length;
  pills.push(make(null, 4, bigJokers, 'NT', true));
  pills.push(make(null, 3, smallJokers, 'nt', false));

  const suits: [Suit, string, boolean][] = [
    [Suit.Spades, '♠', false], [Suit.Hearts, '♥', true],
    [Suit.Clubs, '♣', false], [Suit.Diamonds, '♦', true],
  ];
  for (const [s, label, red] of suits) {
    const cnt = hand.filter(c => c.suit === s && c.rank === level).length;
    // 无人亮主 → 只能单张亮（strength 1，不直接亮一对）；否则对子（自保/反主）
    const strength = cur ? 2 : 1;
    pills.push(make(s, strength, cnt, label, red));
  }
  return pills;
}
