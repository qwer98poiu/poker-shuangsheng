import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { aiChooseBottomCards } from '../ai/index.js';
// 下面的场景手牌是手工构造的形状（长度只为凑够可扣的 8 张），打的是选牌算法本身；
// 对外入口「必须 33 张」的契约由文件末尾的契约用例单独覆盖。
import { aiChooseBottomCards as chooseBottom } from '../ai/bottom-strategy.js';
import type { Card, CardSuit, TrumpDeclaration } from '../types.js';

type SR = [CardSuit, number];

function c(s: CardSuit, r: number, idx: number): Card {
  return createCard(s, r, idx);
}

/** Build a hand from [suit, rank] pairs with unique ids. */
function build(spec: SR[]): Card[] {
  return spec.map(([s, r], i) => c(s, r, i));
}

/** Deterministic card key: suit + zero-padded rank. */
function keys(cards: Card[]): string[] {
  return cards.map(card => `${card.suit}${String(card.rank).padStart(2, '0')}`).sort();
}

/** level-5 Hearts trump (rank 5 is the level; suits never contain 5s). */
const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
/** level-J (11) Hearts trump — 用户扣底示例的亮主配置 (亮主 JH)。 */
const cfg11: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 11 };
/** level-3 Hearts trump (used when a 5-point card is needed in an off-suit). */
const cfg3: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 3 };
/** level-2 no-trump (rank-2 cards and jokers are trump). */
const cfgNT: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 2 };
/** level-3 no-trump (used when a rank-2 card is needed off-suit). */
const cfgNT3: TrumpDeclaration = { declarerIndex: 0, trumpSuit: null, level: 3 };

describe('aiChooseBottomCards', () => {
  describe('suited trump mode', () => {
    it('returns exactly 8 discard and 25 keep for a 33-card hand', () => {
      const hand = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'] as const;
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = chooseBottom(hand, cfg5);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
      expect(r.reason.length).toBeGreaterThan(0);
    });

    it('voids a 10-point remainder by keeping the A in hand (扣绝留控制张)', () => {
      // ♣ = A + 10 9 8 7 6 4 3 → 待扣 7 张 10 分, main=12 (cap 10) → ②-type door.
      // ♠ has 待扣 12 (>8) so it is never a door; fill 1 slot comes from ♠.
      const hand = build([
        ['C', 14], ['C', 10], ['C', 9], ['C', 8], ['C', 7], ['C', 6], ['C', 4], ['C', 3],
        ...([2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ['H', r] as SR)),
        ['S', 14], ['S', 2], ['S', 2], ['S', 6], ['S', 6], ['S', 10], ['S', 10],
        ['S', 3], ['S', 4], ['S', 7], ['S', 8], ['S', 9], ['S', 11],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('扣绝♣花色（共10分）；填充1张（共0分）');
      // The A stays in hand; the 7-card remainder plus one ♠3 fill the bottom.
      expect(keys(r.discard)).toEqual(
        ['C03', 'C04', 'C06', 'C07', 'C08', 'C09', 'C10', 'S03'],
      );
      expect(r.keep.map(k => k.id)).toContain(hand.find(x => x.suit === 'C' && x.rank === 14)!.id);
    });

    it('0-point door is chosen before a 5-point door; both can void in order', () => {
      // main = 9 (cap 5). ♣ (0分, 3张) first, then ♦ (5分, 4张); 1 fill from ♠.
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 10], ['H', 11],
        ['C', 9], ['C', 8], ['C', 7],
        ['D', 5], ['D', 9], ['D', 8], ['D', 7],
        ['S', 14], ['S', 2], ['S', 2], ['S', 5], ['S', 5], ['S', 7], ['S', 7],
        ['S', 9], ['S', 9], ['S', 11], ['S', 11], ['S', 13], ['S', 13],
        ['S', 4], ['S', 6], ['S', 8], ['S', 10],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♣♦花色（共5分）；填充1张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C07', 'C08', 'C09', 'D05', 'D07', 'D08', 'D09', 'S04'],
      );
    });

    it('does not take a 10-point door while a 5-point door fits first (cumulative cap)', () => {
      // main = 10 (cap 10). ♦ 5分门 first (cum 5); then ♠ 10分门 would push
      // cumulative to 15 > cap → rejected even though slots remain.
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 10], ['H', 11], ['H', 12],
        ['D', 5], ['D', 9], ['D', 8],
        ['S', 13], ['S', 9], ['S', 8], ['S', 7], ['S', 6], ['S', 4], ['S', 2],
        ['C', 14],
        ['C', 2], ['C', 4], ['C', 5], ['C', 6], ['C', 7], ['C', 8], ['C', 9],
        ['C', 11], ['C', 12], ['C', 13], ['C', 10], ['C', 10],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♦花色（共5分）；填充5张（共0分）');
      // ♦ 3 张 + 5 张填充 (桶1 跨花色从小到大: S2/C2/S4/C4/S6);
      // ♠ 的 10 分门整门保留 (累计 5+10 > cap 10)。
      expect(keys(r.discard)).toEqual(
        ['C02', 'C04', 'D05', 'D08', 'D09', 'S02', 'S04', 'S06'],
      );
      expect(r.discard.some(x => x.suit === 'S' && x.rank === 13)).toBe(false);
    });

    it('main <= 8 → 0-point cap: a 5-point suit is not voided (falls to fill)', () => {
      // main = 8, cap 0. ♣ has 5 points → not a door; S/D also carry 5-point
      // junk so no suit is ever a 0-point door; pure ladder fill (25-card hand).
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 10],
        ['C', 5], ['C', 9], ['C', 8],
        ['S', 2], ['S', 4], ['S', 5], ['S', 6], ['S', 7], ['S', 8], ['S', 9], ['S', 11],
        ['D', 2], ['D', 4], ['D', 5], ['D', 6], ['D', 7], ['D', 8],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      // 桶1 非分单从小到大: ♠/♦ rank 2/4/6/7 的单张 (♣ 的 9/8 排 rank 8/9 之后).
      expect(keys(r.discard)).toEqual(
        ['D02', 'D04', 'D06', 'D07', 'S02', 'S04', 'S06', 'S07'],
      );
    });

    it('a door whose remainder is exactly 8 fills the whole bottom', () => {
      // ♣ = A + 8 张 0 分垃圾 → 待扣 8 → 整底扣绝。
      const hand = build([
        ['C', 14], ['C', 11], ['C', 9], ['C', 8], ['C', 7], ['C', 6], ['C', 4], ['C', 3], ['C', 2],
        ...([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14].map(r => ['H', r] as SR)),
        ['S', 14], ['S', 13], ['S', 12], ['S', 11], ['S', 10], ['S', 9], ['S', 8], ['S', 7],
        ['S', 6], ['S', 4], ['S', 3], ['S', 2],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('扣绝♣花色（共0分）；无填充');
      expect(keys(r.discard)).toEqual(
        ['C02', 'C03', 'C04', 'C06', 'C07', 'C08', 'C09', 'C11'],
      );
      expect(r.keep.length).toBe(25);
    });

    it('trump junk enters the bottom only after off-suit junk (ladder 桶5)', () => {
      // main = 16 (cap 10). 副牌垃圾: ♣ 7 张 (对 66/88 不拆、1010 分对不拆)
      // + ♦ 2 张 20 分 (分过多不可扣绝) → 桶1-4 只取 7 张,
      // 桶5 "主牌 A 以下非分单牌" 取 H6 补足第 8 张。
      const hand = build([
        ['H', 2], ['H', 2], ['H', 3], ['H', 3], ['H', 4], ['H', 4],
        ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 10], ['H', 11], ['H', 12], ['H', 13], ['H', 14], ['H', 5],
        ['C', 3], ['C', 6], ['C', 6], ['C', 8], ['C', 8], ['C', 10], ['C', 10],
        ['D', 10], ['D', 13],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg5);
      // ♦ 的非控制 (D10/D13) 全数由填充清空 → 按整体归类计为 扣绝♦(共20分)。
      expect(r.reason).toBe('扣绝♦花色（共20分）；填充6张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C03', 'C06', 'C06', 'C08', 'C08', 'D10', 'D13', 'H06'],
      );
    });

    it('cap 0: odd slot after skipping a 0-point pair prefers a small trump single over splitting it', () => {
      // main = 8 → cap 0. 桶1 非分单恰 7 张 (♠2/3/4/6/8/9 + ♦2) → 余 1 槽;
      // 桶2 的 77 整对放不下被跳过 → 桶3 分单超限整桶跳过 (限额 0, 不再取
      // 10 分单), 桶5 "主牌 A 以下非分单牌" 取 H2 补足——保留 ♠77 整对,
      // 不拆对。C10×3 与 ♠K 全留手。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11], ['H', 12],
        ['S', 14], ['S', 2], ['S', 3], ['S', 4], ['S', 6], ['S', 7], ['S', 7], ['S', 8], ['S', 9], ['S', 13],
        ['D', 14], ['D', 2], ['D', 13],
        ['C', 14], ['C', 10], ['C', 10], ['C', 10],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['D02', 'H02', 'S02', 'S03', 'S04', 'S06', 'S08', 'S09'],
      );
      // 小主牌单张入底、0 分对整对保留; 分牌 (C10/♠K) 一张不进底。
      expect(r.discard.filter(x => x.suit === 'S' && x.rank === 7).length).toBe(0);
      expect(r.discard.some(x => x.rank === 10 || x.rank === 13)).toBe(false);
    });

    it('5-point door used the cap: the odd slot then prefers a small trump single over splitting a 0-point pair', () => {
      // main = 10 (cap 10). ♣ = A + C5 → 扣绝 1 张 5 分门 (5 分档先于 10 分档)。
      // 剩 7 槽: 桶1 非分单 6 张 (♠2/4/6/8/9/J) → 余 1 槽; 桶2 的 77 放不下;
      // 余量 5 分放不下 ♠K(10 分) → 桶3 跳过 → 桶5 取 H2 补足, ♠77 整对保留。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11], ['H', 12], ['H', 13], ['H', 14],
        ['C', 14], ['C', 5],
        ['S', 14], ['S', 2], ['S', 4], ['S', 6], ['S', 7], ['S', 7], ['S', 8], ['S', 9], ['S', 11], ['S', 13],
        ['D', 14], ['D', 10], ['D', 13],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♣花色（共5分）；填充7张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C05', 'H02', 'S02', 'S04', 'S06', 'S08', 'S09', 'S11'],
      );
      expect(r.discard.filter(x => x.suit === 'S' && x.rank === 7).length).toBe(0);
      expect(r.discard.some(x => x.suit === 'S' && x.rank === 13)).toBe(false);
      expect(r.discard.some(x => x.suit === 'D' && (x.rank === 10 || x.rank === 13))).toBe(false);
    });

    it('桶6: 无主牌小单可填时，奇数槽拆最弱 0 分副牌对 (先于拆分对与主牌)', () => {
      // main = 8 (H5×2 级牌 + H10/H13×2 主分 + H14×2 主A 对) → cap 0,
      // 且主牌无 A 以下非分单张 (桶5 空)。桶1 非分单恰 7 张 (♠2/3/4/6/8/9 +
      // ♦2) → 余 1 槽: 桶2 的 77 整对放不下、桶3 分单 (♠K) 超限整桶跳过、
      // 桶4 分对 (♦10/C10) 放不下 → 桶6 拆最弱 0 分对 ♠7 半张补足, 0 分。
      const hand = build([
        ['H', 5], ['H', 5], ['H', 10], ['H', 10], ['H', 13], ['H', 13], ['H', 14], ['H', 14],
        ['S', 14], ['S', 2], ['S', 3], ['S', 4], ['S', 6], ['S', 7], ['S', 7], ['S', 8], ['S', 9], ['S', 13],
        ['D', 14], ['D', 2], ['D', 10], ['D', 10],
        ['C', 14], ['C', 10], ['C', 10],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['D02', 'S02', 'S03', 'S04', 'S06', 'S07', 'S08', 'S09'],
      );
      // 只取一张 ♠7 (半张); 分对 ♦10/C10 与 ♠K 全留手。
      expect(r.discard.filter(x => x.suit === 'S' && x.rank === 7).length).toBe(1);
      expect(r.discard.every(x => x.rank !== 10 && x.rank !== 13)).toBe(true);
    });

    it('桶2: 非tier2控制张的对先于tier2对 (宁可扣 ♣77 也不动 tier2 的 ♠33)', () => {
      // main = 7 (cap 0). ♠ = AA+KK 拖拉机 (tier1 2对) → tier2 = 33;
      // ♣ = A + 77 → 77 非 tier2. 桶1 恰 6 单张 (♣3/6/8 + ♦2/4/6) → 余 2 槽,
      // 桶2 候选 {♣77(非tier2), ♠33(tier2)} → 非 tier2 先取 ♣77。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11],
        ['S', 14], ['S', 14], ['S', 13], ['S', 13], ['S', 3], ['S', 3], ['S', 10],
        ['C', 14], ['C', 7], ['C', 7], ['C', 13], ['C', 3], ['C', 6], ['C', 8],
        ['D', 10], ['D', 2], ['D', 4], ['D', 6],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C03', 'C06', 'C07', 'C07', 'C08', 'D02', 'D04', 'D06'],
      );
      expect(r.discard.filter(x => x.suit === 'C' && x.rank === 7).length).toBe(2);
      expect(r.discard.some(x => x.suit === 'S' && x.rank === 3)).toBe(false);
    });

    it('桶2: 同级内总对数少的花色优先 (♣ 总1对先于 ♦ 总2对)', () => {
      // main = 7 (cap 0). ♣ = A + 77 + K (总对数 1); ♦ = A + 33 + 88 + K (总 2);
      // 两对都非 tier2. 桶1 恰 6 单张 (♠2/4/6/8/9/J) → 余 2 槽 →
      // 总对数少的 ♣77 先取 (旧排序会先取 rank3 的 ♦33)。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11],
        ['S', 14], ['S', 13], ['S', 2], ['S', 4], ['S', 6], ['S', 8], ['S', 9], ['S', 11],
        ['C', 14], ['C', 7], ['C', 7], ['C', 13],
        ['D', 14], ['D', 3], ['D', 3], ['D', 8], ['D', 8], ['D', 13],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C07', 'C07', 'S02', 'S04', 'S06', 'S08', 'S09', 'S11'],
      );
      expect(r.discard.some(x => x.suit === 'D' && x.rank === 3)).toBe(false);
    });

    it('常主(王/级牌)与主分(带分主牌)永不扣入底牌', () => {
      // 主牌近满手: H 26 张 (两副全部, 含 H5 级牌 ×2、H10/H13 主分 ×4)。
      // 副牌仅 ♣ 7 张非分 → 扣绝 7 张后剩 1 槽: 桶1-8 无候选, 桶9 拆主A 对补足。
      const hand = build([
        ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap(r => [
          ['H', r] as SR, ['H', r] as SR,
        ]),
        ['C', 2], ['C', 3], ['C', 4], ['C', 6], ['C', 7], ['C', 8], ['C', 9],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg5);
      expect(r.reason).toBe('扣绝♣花色（共0分）；填充1张（共0分）');
      // 最后一槽由桶9 末组拆最弱主牌对 H2 补足 (主A 对保留)。
      expect(keys(r.discard)).toEqual(
        ['C02', 'C03', 'C04', 'C06', 'C07', 'C08', 'C09', 'H02'],
      );
      // 无任何常主/主分入底 (无王、无级牌 H5、无主分 H10/H13)。
      const forbidden = r.discard.filter(x =>
        x.suit === 'J' || x.rank === 5 || x.rank === 10 || x.rank === 13,
      );
      expect(forbidden).toEqual([]);
    });

    it('桶1: 脆弱花色 {10,2} 留一张非分保护牌 (不被抽成只剩分)', () => {
      // 主 8 (cap 0)。♠ = A + 5 张 0 分垃圾 → 0 分门扣绝 → 剩 3 槽;
      // ♦ = {10,2}：无控制、只有单牌、带 10 分 → 脆弱（10 分档 cap 0 扣不起，
      // 不能扣绝）。桶1 候选 = ♦2 + ♣2/4/9 (m=4 > k=3)：旧逻辑从小到大会抽走
      // ♦2 → ♦ 只剩 10；新逻辑留 ♦2，改填 ♣2/♣4/♣9。
      const hand = build([
        ['H', 2], ['H', 3], ['H', 4], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11],
        ['S', 14], ['S', 2], ['S', 4], ['S', 6], ['S', 7], ['S', 8],
        ['D', 10], ['D', 2],
        ['C', 14], ['C', 13], ['C', 10], ['C', 5], ['C', 2], ['C', 4], ['C', 6], ['C', 6], ['C', 9],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♠花色（共0分）；填充3张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C02', 'C04', 'C09', 'S02', 'S04', 'S06', 'S07', 'S08'],
      );
      // ♦2 与 ♦10 都留在手里（非分单保护牌未被抽走）。
      expect(r.keep.some(x => x.suit === 'D' && x.rank === 2)).toBe(true);
      expect(r.keep.some(x => x.suit === 'D' && x.rank === 10)).toBe(true);
    });

    it('桶1: 两门脆弱花色 {10,2} 同时各留一张保护牌', () => {
      // 主 8 (cap 0)。♠/♦ = {10,2} 都是脆弱门; ♣ = A + 8 张非分单 + K/55
      // (voidable 9 张 10 分 → 非 0 分门不可扣绝, 也不够 8 槽)。
      // 桶1 候选 10 张 > 填 8 槽 (slack 2): 两门都能留, 底牌全取 ♣ 非分单。
      const hand = build([
        ['H', 2], ['H', 3], ['H', 4], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11],
        ['S', 10], ['S', 2],
        ['D', 10], ['D', 2],
        ['C', 14], ['C', 14], ['C', 13], ['C', 5], ['C', 5], ['C', 2], ['C', 4],
        ['C', 6], ['C', 7], ['C', 8], ['C', 9], ['C', 11], ['C', 12],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C02', 'C04', 'C06', 'C07', 'C08', 'C09', 'C11', 'C12'],
      );
      // ♠2/♦2 都留手, ♠10/♦10 分牌也没入底。
      expect(r.discard.some(x => x.suit === 'S' && x.rank === 2)).toBe(false);
      expect(r.discard.some(x => x.suit === 'D' && x.rank === 2)).toBe(false);
      expect(r.discard.every(x => x.rank !== 10)).toBe(true);
    });

    it('桶1: 两门脆弱门仅剩 1 空位时留分多的 (♠ 20 分 > ♦ 15 分)', () => {
      // 主 14 (cap 10)。♠={K,T,2} (20 分) 与 ♦={K,5,2} (15 分) 都脆弱; ♣ 供
      // 7 个非分单 → 候选 9 张恰填 8 槽 (slack 1) → 只能留一张保护牌 → 留分
      // 多的 ♠2, ♦2 入底 (♦ 被抽成只剩 K5, 作为牺牲)。
      const hand = build([
        ['H', 2], ['H', 2], ['H', 3], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9],
        ['H', 10], ['H', 11], ['H', 12], ['H', 13], ['H', 14],
        ['S', 13], ['S', 10], ['S', 2],
        ['D', 13], ['D', 5], ['D', 2],
        ['C', 14], ['C', 14], ['C', 2], ['C', 2], ['C', 5], ['C', 10], ['C', 4], ['C', 6],
        ['C', 7], ['C', 8], ['C', 9], ['C', 11], ['C', 12],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C04', 'C06', 'C07', 'C08', 'C09', 'C11', 'C12', 'D02'],
      );
      // ♠2 留手 (分多的门受保护), ♦2 被抽走 (♦ 剩 K5 无保护)。
      expect(r.keep.some(x => x.suit === 'S' && x.rank === 2)).toBe(true);
      expect(r.discard.some(x => x.suit === 'D' && x.rank === 2)).toBe(true);
    });

    it('桶1: 两门脆弱门同分仅剩 1 空位时按 SHCD 留 ♠', () => {
      // 与上例同形: ♠={K,5,2} 与 ♦={T,5,2} 都是 15 分 → 同分按 SHCD 优先级
      // 留 ♠2, ♦2 入底。
      const hand = build([
        ['H', 2], ['H', 2], ['H', 3], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9],
        ['H', 10], ['H', 11], ['H', 12], ['H', 13], ['H', 14],
        ['S', 13], ['S', 5], ['S', 2],
        ['D', 10], ['D', 5], ['D', 2],
        ['C', 14], ['C', 14], ['C', 2], ['C', 2], ['C', 13], ['C', 10], ['C', 4], ['C', 6],
        ['C', 7], ['C', 8], ['C', 9], ['C', 11], ['C', 12],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C04', 'C06', 'C07', 'C08', 'C09', 'C11', 'C12', 'D02'],
      );
      expect(r.keep.some(x => x.suit === 'S' && x.rank === 2)).toBe(true);
      expect(r.discard.some(x => x.suit === 'D' && x.rank === 2)).toBe(true);
    });

    it('second door may be a 10-point one when cumulative cap allows (③)', () => {
      // main = 10 (cap 10). 0 分门 ♣ first (cum 0) → 10 分门 ♦ fits (10 <= cap).
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 10], ['H', 11], ['H', 12],
        ['C', 9], ['C', 8],
        ['D', 13], ['D', 9], ['D', 8],
        ['S', 14], ['S', 2], ['S', 2], ['S', 5], ['S', 5], ['S', 7], ['S', 7],
        ['S', 9], ['S', 9], ['S', 11], ['S', 11], ['S', 13], ['S', 13],
        ['S', 4], ['S', 6], ['S', 8], ['S', 10], ['S', 12],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♣♦花色（共10分）；填充3张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C08', 'C09', 'D08', 'D09', 'D13', 'S04', 'S06', 'S08'],
      );
    });

    it('桶3: 分单先取"扣掉即整门扣绝"的单张K (方块K 优先于黑桃K/草花K)', () => {
      // 用户牌例 (亮主 J♥, 主 7 → cap 0)。♠/♣/♦ 待扣均带 10 分, 扣绝循环不取门;
      // 桶1 取 6 张非分单 (♠3/6/7、♣4、♦9/Q) 后 ♦ 只剩单张 ♦K。桶3 候选
      // ♠K ♣K ♦K: 先取"整门只剩它"的 ♦K (扣掉方块门归零), 再按 SHCD 取 ♠K;
      // ♣K 留手 (旧排序按 SHCD 取 ♠K ♣K、留 ♦K 死牌)。
      const hand = build([
        ['J', 16], ['C', 11],
        ['H', 14], ['H', 10], ['H', 6], ['H', 4], ['H', 3],
        ['S', 13], ['S', 12], ['S', 12], ['S', 10], ['S', 10], ['S', 9], ['S', 9], ['S', 7], ['S', 6], ['S', 3],
        ['C', 14], ['C', 13], ['C', 8], ['C', 8], ['C', 7], ['C', 7], ['C', 6], ['C', 6], ['C', 4], ['C', 3], ['C', 3], ['C', 2], ['C', 2],
        ['D', 13], ['D', 12], ['D', 9],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfg11);
      expect(r.reason).toBe('扣绝♠♦花色（共20分）；填充1张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C04', 'D09', 'D12', 'D13', 'S03', 'S06', 'S07', 'S13'],
      );
      // 方块门被抽空 (扣绝), 无死 K 留手; ♣K 留手。
      expect(r.keep.some(x => x.suit === 'D')).toBe(false);
      expect(r.keep.some(x => x.suit === 'C' && x.rank === 13)).toBe(true);
    });

    it('桶3: "整门只剩单张5" 优先于其他门的普通 5 (即使 SHCD 靠后)', () => {
      // 主 5 (cap 0)。♦ 门 0 分垃圾 4 张 → 0 分门扣绝; 桶1 = ♠2/♠8/♣2 → 余
      // 1 槽进桶3: 候选 ♣5 (♣ 门只剩它 → 扣掉即整门扣绝) 与 ♠5 (♠ 门还有
      // ♠10)。取 ♣5 而非按 SHCD 取 ♠5; ♠5/♠10 留手。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7],
        ['S', 5], ['S', 10], ['S', 2], ['S', 8],
        ['C', 5], ['C', 2],
        ['D', 2], ['D', 4], ['D', 6], ['D', 8], ['D', 10], ['D', 10], ['D', 11], ['D', 11], ['D', 12], ['D', 12], ['D', 13], ['D', 13], ['D', 14], ['D', 14],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♣♦花色（共5分）；填充2张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C02', 'C05', 'D02', 'D04', 'D06', 'D08', 'S02', 'S08'],
      );
      expect(r.keep.some(x => x.suit === 'S' && x.rank === 5)).toBe(true);
      expect(r.keep.some(x => x.suit === 'S' && x.rank === 10)).toBe(true);
    });

    it('桶3: 两个"整门只剩单张5"并列时按 SHCD 取 ♠5', () => {
      // 主 7 (cap 0)。♠ {5,2} 与 ♣ {5,4} 都是只剩单牌的脆弱门; ♦ 门 0 分垃圾
      // 5 张 → 0 分门扣绝。桶1 取 ♠2/♣4 + ♦ 垃圾 → 余 1 槽进桶3: ♠5 与 ♣5
      // 同为"整门只剩单张 5" → 按 SHCD 取 ♠5, ♣5 留手。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9],
        ['S', 5], ['S', 2],
        ['C', 5], ['C', 4],
        ['D', 10], ['D', 2], ['D', 4], ['D', 6], ['D', 8], ['D', 9], ['D', 11], ['D', 11], ['D', 12], ['D', 12], ['D', 13], ['D', 13], ['D', 14], ['D', 14],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♠♦花色（共5分）；填充1张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C04', 'D02', 'D04', 'D06', 'D08', 'D09', 'S02', 'S05'],
      );
      expect(r.keep.some(x => x.suit === 'C' && x.rank === 5)).toBe(true);
    });

    it('桶3: "整门只剩"的单张K 优先于普通 10 (单张K 与单张10 同级)', () => {
      // 主 8 (cap 0)。♣ 门 0 分垃圾 3 张扣绝; 桶1 = ♠2/♦2/♦4 → 余 2 槽进桶3:
      // 候选 ♠K (♠ 门只剩它 → 整门扣绝), ♦5 与 ♦10 (♦ 门还有 ♦5)。同档取分单:
      // 单张 K 与单张 10 同级、先取单张 → 取 ♦5 + ♠K, ♦10 留手 (旧排序取 ♦10、
      // 留 ♠K)。
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9], ['H', 11],
        ['S', 13], ['S', 2],
        ['D', 10], ['D', 5], ['D', 2], ['D', 4], ['D', 14], ['D', 14],
        ['C', 2], ['C', 4], ['C', 6], ['C', 10], ['C', 10], ['C', 11], ['C', 11], ['C', 14], ['C', 14],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfg3);
      expect(r.reason).toBe('扣绝♠♣花色（共10分）；填充3张（共5分）');
      expect(keys(r.discard)).toEqual(
        ['C02', 'C04', 'C06', 'D02', 'D04', 'D05', 'S02', 'S13'],
      );
      expect(r.keep.some(x => x.suit === 'D' && x.rank === 10)).toBe(true);
      expect(r.keep.some(x => x.suit === 'S' && x.rank === 13)).toBe(false);
    });
  });

  describe('NT (no-trump) mode', () => {
    it('returns exactly 8 discard and 25 keep', () => {
      const hand: Card[] = [];
      let n = 0;
      for (const s of ['S', 'H', 'C', 'D'] as const) {
        for (let r = 3; r <= 10; r++) hand.push(c(s, r, n++));
      }
      hand.push(c('S', 11, n++)); // 33rd card
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfgNT);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
    });

    it('voids a 5-point suit when main >= 3 (cap 5)', () => {
      // main = 3 (2 大王 + 1 小王). ♣ 待扣 7 张 5 分, 总 7 ≤ 8 → voidable.
      const hand = build([
        ['J', 16], ['J', 16], ['J', 15],
        ['C', 5], ['C', 9], ['C', 8], ['C', 7], ['C', 6], ['C', 4], ['C', 3],
        ...([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ['S', r] as SR)),
        ...([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r => ['D', r] as SR)),
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 扣绝♣花色（共5分）；填充1张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'S03'],
      );
    });

    it('never voids a 10-point suit in NT even when main >= 3', () => {
      // ♣ 待扣 7 张含 K (10 分) → NT 上限 5 → 不扣绝, 纯填充从 ♠/♦ 取 8 张。
      const hand = build([
        ['J', 16], ['J', 16], ['J', 15],
        ['C', 13], ['C', 9], ['C', 8], ['C', 7], ['C', 6], ['C', 4], ['C', 3],
        ...([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ['S', r] as SR)),
        ...([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r => ['D', r] as SR)),
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 无扣绝；填充8张（共0分）');
      // 桶1 非分单从小到大 (rank3→4→6) 取 8 张, 含 ♣ 低张 — K(10 分) 留下。
      expect(keys(r.discard)).toEqual(
        ['C03', 'C04', 'C06', 'D03', 'D04', 'S03', 'S04', 'S06'],
      );
      expect(r.discard.some(x => x.suit === 'C' && x.rank === 13)).toBe(false);
    });

    it('NT cap 0: odd slot after skipping 0-point pairs splits the weakest one, no point single', () => {
      // main 0 (无王/级牌) → cap 0. 桶1 非长非分非控单恰 7 张 (♠3/4/6/8/9/J/Q)
      // → 余 1 槽; 桶2 的 ♠77/♦44 整对放不下、无长花色单张 → 桶4 (非长非分
      // 非控对, 拆对) 拆最弱 0 分对 (♦4 先于 ♠7) 一张, 不进桶7 分单。5/10/K 分牌全留手。
      const hand = build([
        ['S', 3], ['S', 4], ['S', 6], ['S', 7], ['S', 7], ['S', 8], ['S', 9], ['S', 11], ['S', 12],
        ['D', 14], ['D', 4], ['D', 4], ['D', 5], ['D', 10], ['D', 13],
        ['C', 14], ['C', 10], ['C', 10], ['C', 10], ['C', 13],
        ['H', 14], ['H', 10], ['H', 10], ['H', 10], ['H', 13],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['D04', 'S03', 'S04', 'S06', 'S08', 'S09', 'S11', 'S12'],
      );
      expect(r.discard.filter(x => x.suit === 'D' && x.rank === 4).length).toBe(1);
      expect(r.discard.every(x => x.rank !== 5 && x.rank !== 10 && x.rank !== 13)).toBe(true);
    });

    it('NT 桶2: 总对数少的花色优先 (♣ 总1对先于 ♦ 总2对)', () => {
      // main 0 (cap 0). 桶1 恰 6 单张 (♠3/4/6/8/9/J) → 余 2 槽; 桶2 候选
      // {♣77 (总对数1), ♦33/♦88 (总2)} → 先取 ♣77 (旧排序会先取 ♦33)。
      const hand = build([
        ['S', 14], ['S', 3], ['S', 4], ['S', 6], ['S', 8], ['S', 9], ['S', 11], ['S', 13],
        ['C', 14], ['C', 7], ['C', 7], ['C', 13],
        ['D', 14], ['D', 3], ['D', 3], ['D', 8], ['D', 8], ['D', 13],
        ['H', 14], ['H', 5], ['H', 5], ['H', 5], ['H', 10], ['H', 10], ['H', 13],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C07', 'C07', 'S03', 'S04', 'S06', 'S08', 'S09', 'S11'],
      );
      expect(r.discard.some(x => x.suit === 'D' && x.rank === 3)).toBe(false);
    });

    it('NT 桶4: 非长非分非控制对的拆对先于限额内的分单牌', () => {
      // main = 3 (2 大王 + 1 小王) → cap 5。桶1 非长非分非控单恰 7 张
      // (♠3/4/6/8/9/J/Q) → 余 1 槽; 桶2 的 ♠77/♦44 整对放不下、无长花色
      // 单张 → 桶4 拆最弱 0 分对 (♦4 先于 ♠7)。桶7 分单 (♦5 = 5 分) 虽在
      // 限额内也不取——无主时 0 分对拆对先于放分进底。
      const hand = build([
        ['J', 16], ['J', 16], ['J', 15],
        ['S', 3], ['S', 4], ['S', 6], ['S', 7], ['S', 7], ['S', 8], ['S', 9], ['S', 11], ['S', 12],
        ['D', 14], ['D', 4], ['D', 4], ['D', 5], ['D', 10], ['D', 13],
        ['C', 14], ['C', 10], ['C', 10], ['C', 10],
        ['H', 14], ['H', 10], ['H', 10],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 无扣绝；填充8张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['D04', 'S03', 'S04', 'S06', 'S08', 'S09', 'S11', 'S12'],
      );
      expect(r.discard.filter(x => x.suit === 'D' && x.rank === 4).length).toBe(1);
      expect(r.discard.every(x => x.rank !== 5 && x.rank !== 10 && x.rank !== 13)).toBe(true);
    });

    it('NT 桶7: "整门只剩"的单张K 优先于普通 10 分单 (同有主桶3)', () => {
      // 无主 level 3 (主 0 → cap 0)。桶1 = ♠2/♦2/♦4/♥2/♥7 → 余 3 槽进桶7:
      // 候选 ♥5/♦5 (5 分档先取) 与 ♠K/♦10/♥10/♥K — ♠ 门只剩 ♠K → 单张 K 与
      // 单张 10 同级且优先 → 取 ♥5 ♦5 ♠K; ♦10/♥10/♥K 留手 (旧排序取 ♦10)。
      const hand = build([
        ['S', 13], ['S', 2],
        ['D', 10], ['D', 5], ['D', 2], ['D', 4], ['D', 14], ['D', 14],
        ['H', 2], ['H', 5], ['H', 7], ['H', 10], ['H', 13],
        ['C', 9], ['C', 9], ['C', 10], ['C', 10], ['C', 11], ['C', 11], ['C', 12], ['C', 12], ['C', 13], ['C', 13], ['C', 14], ['C', 14],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfgNT3);
      expect(r.reason).toBe('NT: 扣绝♠花色（共10分）；填充6张（共10分）');
      expect(keys(r.discard)).toEqual(
        ['D02', 'D04', 'D05', 'H02', 'H05', 'H07', 'S02', 'S13'],
      );
      expect(r.keep.some(x => x.suit === 'D' && x.rank === 10)).toBe(true);
      expect(r.keep.some(x => x.suit === 'H' && x.rank === 10)).toBe(true);
      expect(r.keep.some(x => x.suit === 'S' && x.rank === 13)).toBe(false);
    });

    it('weak long suit (total 9, control 1) can be voided completely (④)', () => {
      // ♠ = A + 8 张 0 分垃圾 (总 9, 控制 1) → ④ 型, 待扣 8 整底。
      const hand = build([
        ['S', 14], ['S', 3], ['S', 4], ['S', 6], ['S', 7], ['S', 8], ['S', 9], ['S', 11], ['S', 12],
        ...([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ['C', r] as SR)),
        ...([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(r => ['D', r] as SR)),
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 扣绝♠花色（共0分）；无填充');
      expect(keys(r.discard)).toEqual(
        ['S03', 'S04', 'S06', 'S07', 'S08', 'S09', 'S11', 'S12'],
      );
    });

    it('designates only one long suit; the other candidate is ordinary', () => {
      // ♠ 11 张 (AA KK QQ JJ + 9 8 7) 与 ♦ 10 张 (AA KK QQ JJ + 10 9) 都满足
      // 总>=9 且 控制>=6 → 选 (总+控制) 更大的 ♠ 为唯一长花色。
      // 填充时 ♦ 的杂牌 (桶1) 先于 ♠ 的杂牌 (桶3) 入底。
      const hand = build([
        ['S', 14], ['S', 14], ['S', 13], ['S', 13], ['S', 12], ['S', 12],
        ['S', 11], ['S', 11], ['S', 9], ['S', 8], ['S', 7],
        ['D', 14], ['D', 14], ['D', 13], ['D', 13], ['D', 12], ['D', 12],
        ['D', 11], ['D', 11], ['D', 10], ['D', 9],
        ['C', 14], ['C', 3], ['C', 4], ['C', 5], ['C', 6], ['C', 7], ['C', 8],
        ['C', 9], ['C', 10], ['C', 11], ['C', 12], ['C', 13],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfgNT);
      // ♦ 唯一待扣 (D9) 被桶1 恰好清空 → 按整体归类计为 扣绝♦(共0分)。
      expect(r.reason).toBe('NT: 扣绝♦花色（共0分）；填充7张（共0分）');
      // 桶1 = 非长(♦/♣) 非分非控单牌 (rank5 是分不进): ♣3/4/6/7/8/9 + ♦9 + ♣J;
      // 长花色 ♠ 的 9/8/7 不进底。
      expect(keys(r.discard)).toEqual(
        ['C03', 'C04', 'C06', 'C07', 'C08', 'C09', 'C11', 'D09'],
      );
      expect(r.discard.some(x => x.suit === 'S')).toBe(false);
    });

    it('桶1 (NT): 脆弱花色 {10,2} 留一张非分保护牌', () => {
      // 主 3 (王 2 + ♣3, cap 5)。♠ = A + 5 张 0 分垃圾 → 0 分门扣绝 → 剩 3 槽;
      // ♦ = {10,2}：无控制、只有单牌、带 10 分 → 脆弱 (10 分 > NT cap 5 扣不起)。
      // 桶1 候选 = ♦2 + ♣6/7/8/9/11/12 (m=7 > k=3): 留 ♦2, 改填 ♣6/7/8。
      const hand = build([
        ['J', 16], ['J', 15], ['C', 3],
        ['S', 14], ['S', 2], ['S', 4], ['S', 6], ['S', 7], ['S', 8],
        ['D', 10], ['D', 2],
        ['C', 14], ['C', 2], ['C', 2], ['C', 4], ['C', 4], ['C', 5], ['C', 6], ['C', 7],
        ['C', 8], ['C', 9], ['C', 10], ['C', 11], ['C', 12], ['C', 13],
      ]);
      expect(hand.length).toBe(25);
      const r = chooseBottom(hand, cfgNT3);
      expect(r.reason).toBe('NT: 扣绝♠花色（共0分）；填充3张（共0分）');
      expect(keys(r.discard)).toEqual(
        ['C06', 'C07', 'C08', 'S02', 'S04', 'S06', 'S07', 'S08'],
      );
      // ♦2 与 ♦10 都留在手里。
      expect(r.keep.some(x => x.suit === 'D' && x.rank === 2)).toBe(true);
      expect(r.keep.some(x => x.suit === 'D' && x.rank === 10)).toBe(true);
    });

    it('cap is 0 when main < 3: a 5-point suit is not voided', () => {
      // main = 1 (单大王) < 3 → 无主上限 0; ♣ 5 分门不可扣绝 → 纯填充。
      const hand = build([
        ['J', 16],
        ['C', 5], ['C', 9], ['C', 8], ['C', 7], ['C', 6], ['C', 4], ['C', 3],
        ['S', 14], ['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 7], ['S', 8],
        ['S', 9], ['S', 10], ['S', 11], ['S', 12], ['S', 13],
        ['D', 14], ['D', 3], ['D', 4], ['D', 4], ['D', 5], ['D', 6], ['D', 7],
        ['D', 8], ['D', 9], ['D', 10], ['D', 11], ['D', 12], ['D', 13],
      ]);
      expect(hand.length).toBe(33);
      const r = chooseBottom(hand, cfgNT);
      expect(r.reason).toBe('NT: 无扣绝；填充8张（共0分）');
      // 桶1 非分单: rank3-6 先于 ♣5(分单) — 8 张正好取完。
      expect(keys(r.discard)).toEqual(
        ['C03', 'C04', 'C06', 'D03', 'D06', 'S03', 'S04', 'S06'],
      );
    });
  });

  describe('对外入口的手牌张数契约', () => {
    // 庄家先拿底牌后扣底：决策输入 = 发到的 25 张 + 拿进的 8 张 = 33 张。
    // 4 个调用点（arena/cli/client/导出脚本）曾长期只喂 25 张，等价于先扣后拿，
    // 且不报错、静默降级；入口断言把这类回归从「安静地打折扣」变成「立刻炸」。
    it('33 张（拿进底牌后）可以决策，扣 8 张留 25 张', () => {
      const hand = Array.from({ length: 33 }, (_, i) => {
        const suits = ['S', 'H', 'C', 'D'] as const;
        return c(suits[i % 4], 2 + (i % 13), i);
      });
      const r = aiChooseBottomCards(hand, cfg5);
      expect(r.discard.length).toBe(8);
      expect(r.keep.length).toBe(25);
    });

    it('25 张（未拿底牌）直接抛错', () => {
      const hand = build([
        ['H', 2], ['H', 4], ['H', 5], ['H', 6], ['H', 7], ['H', 8], ['H', 9],
        ['H', 10], ['H', 11], ['H', 12], ['H', 13], ['H', 14],
        ['S', 14], ['S', 13], ['S', 12], ['S', 11], ['S', 10], ['S', 9],
        ['C', 14], ['C', 13], ['C', 12], ['C', 11], ['C', 10], ['C', 9],
        ['D', 14],
      ]);
      expect(hand.length).toBe(25);
      expect(() => aiChooseBottomCards(hand, cfg5)).toThrow(
        '扣底决策必须基于 33 张手牌（发到的 25 张 + 拿进的 8 张底牌），实收 25 张',
      );
    });
  });
});
