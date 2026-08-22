import { describe, it, expect } from 'vitest';
import { createCard, GamePhase, Suit } from '@poker/engine';
import type { Card, TrumpDeclaration } from '@poker/engine';
import {
  computePlayableIds, computeFollowPlan, canSubmitPlay, bottomExchangeStatus,
  computeSelectionMode, applyGroupClick, applyGroupDragPick, clearSelectionKeepLocked,
} from '../components/game/playable.js';

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);
const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
const play = (cards: Card[], leadSuit: Suit | null): any => ({ cards, pattern: {}, leadSuit });

describe('computePlayableIds — 不符合规则的牌灰色不可选', () => {
  it('领出或非 Playing 阶段 → 全可选（null）', () => {
    const hand = [c('S', 3, 0), c('H', 3, 1)];
    expect(computePlayableIds(hand, [], cfg, GamePhase.Playing)).toBeNull();
    expect(computePlayableIds(hand, [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.BottomExchange)).toBeNull();
  });

  it('领副牌：手牌有同花色（非主）→ 仅同花色可选', () => {
    const hand = [c('S', 3, 0), c('S', 4, 1), c('H', 3, 2)];
    // 黑桃主 level2：领出红桃（非主花色）
    const ids = computePlayableIds(hand, [play([c('H', 7, 9)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids).not.toBeNull();
    expect(ids!.has('H-3-2')).toBe(true);
    expect(ids!.has('S-3-0')).toBe(false);
    expect(ids!.has('S-4-1')).toBe(false);
  });

  it('领副牌缺门 → 全可选（可垫/毙）', () => {
    const hand = [c('S', 3, 0), c('H', 3, 1)];
    expect(computePlayableIds(hand, [play([c('D', 7, 9)], Suit.Diamonds)], cfg, GamePhase.Playing)).toBeNull();
  });

  it('吊主（leadSuit null）：有主必出主（级牌/王/主花色）', () => {
    const hand = [c('S', 3, 0), c('S', 2, 1), c('H', 2, 2), c('D', 3, 3)];
    // 黑桃主 level2：S3/S2(级牌)/H2(级牌) 是主，D3 非主
    const ids = computePlayableIds(hand, [play([c('S', 5, 9)], null)], cfg, GamePhase.Playing);
    expect(ids!.has('S-3-0')).toBe(true);
    expect(ids!.has('S-2-1')).toBe(true);
    expect(ids!.has('H-2-2')).toBe(true);
    expect(ids!.has('D-3-3')).toBe(false);
  });

  it('吊主但手牌无主 → 全可选（垫牌）', () => {
    const hand = [c('D', 3, 0), c('H', 3, 1)];
    expect(computePlayableIds(hand, [play([c('S', 5, 9)], null)], cfg, GamePhase.Playing)).toBeNull();
  });

  it('跟对子：手牌同花色牌数 < lead 张数 → 全可点 null（组牌必出 + 任意填）', () => {
    const hand = [c('H', 3, 0), c('D', 3, 1), c('D', 5, 2)];
    // lead 是红桃对子（2 张），手牌只有 1 张红桃 → 全可点（组牌必出由出牌校验）
    const ids = computePlayableIds(hand, [play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids).toBeNull();
  });

  it('跟单张：手牌同花色数 == lead 张数 → 恰好出该组', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('D', 3, 2)];
    const ids = computePlayableIds(hand, [play([c('H', 7, 9)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids!.has('H-3-0')).toBe(true);
    expect(ids!.has('H-4-1')).toBe(true);
    expect(ids!.has('D-3-2')).toBe(false);
  });

  it('跟对子：手牌同花色数 > lead 张数 → 只能出该组', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('H', 5, 2), c('D', 3, 3)];
    const ids = computePlayableIds(hand, [play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts)], cfg, GamePhase.Playing);
    expect(ids!.has('H-3-0')).toBe(true);
    expect(ids!.has('H-4-1')).toBe(true);
    expect(ids!.has('H-5-2')).toBe(true);
    expect(ids!.has('D-3-3')).toBe(false);
  });

  it('部分必出：必出的 2 连对可点，独立对与单牌不可选', () => {
    const hand = [c('H', 10, 0), c('H', 10, 1), c('H', 9, 2), c('H', 9, 3), c('H', 7, 4), c('H', 7, 5), c('H', 3, 6)];
    // lead: 红桃 AAKK（2 连对），手牌 101099（2 连对）+ 77 + 单 3
    const lead = play([c('H', 14, 9), c('H', 14, 10), c('H', 13, 11), c('H', 13, 12)], Suit.Hearts);
    const ids = computePlayableIds(hand, [lead], cfg, GamePhase.Playing);
    expect(ids!.has('H-10-0')).toBe(true);  // 必出 2 连对
    expect(ids!.has('H-9-2')).toBe(true);
    expect(ids!.has('H-7-4')).toBe(false);  // 独立对不可选
    expect(ids!.has('H-3-6')).toBe(false);  // 单牌不可选
    const plan = computeFollowPlan(hand, [lead], cfg, GamePhase.Playing);
    expect(plan.lockedIds.slice().sort()).toEqual(['H-10-0', 'H-10-1', 'H-9-2', 'H-9-3']);
  });

  it('主牌甩牌部分必出：3 连对必出，对牌不可选（例 4）', () => {
    // lead: 对大王对小王对黑桃2（3 连对）+ 黑桃 QQJJ（2 连对），吊主 leadSuit null
    const lead = play([
      c('J', 16, 0), c('J', 16, 1), c('J', 15, 2), c('J', 15, 3), c('S', 2, 4), c('S', 2, 5),
      c('S', 12, 6), c('S', 12, 7), c('S', 11, 8), c('S', 11, 9),
    ], null);
    const hand = [
      c('H', 2, 0), c('H', 2, 1), c('S', 14, 2), c('S', 14, 3), c('S', 13, 4), c('S', 13, 5),
      c('S', 10, 6), c('S', 10, 7), c('S', 9, 8), c('S', 9, 9),
      c('S', 7, 10), c('S', 7, 11), c('S', 6, 12), c('S', 6, 13),
      c('S', 4, 14), c('S', 4, 15),
    ];
    const ids = computePlayableIds(hand, [lead], cfg, GamePhase.Playing);
    expect(ids!.has('H-2-0')).toBe(true);   // 3 连对必出
    expect(ids!.has('S-14-2')).toBe(true);
    expect(ids!.has('S-13-4')).toBe(true);
    expect(ids!.has('S-4-14')).toBe(false); // 对牌不可选
    const plan = computeFollowPlan(hand, [lead], cfg, GamePhase.Playing);
    expect(plan.lockedIds.slice().sort()).toEqual(['H-2-0', 'H-2-1', 'S-13-4', 'S-13-5', 'S-14-2', 'S-14-3']);
  });

  it('computeFollowPlan：领出或非 Playing → 无必出', () => {
    expect(computeFollowPlan([c('H', 3, 0)], [], cfg, GamePhase.Playing).lockedIds).toEqual([]);
    expect(computeFollowPlan([c('H', 3, 0)], [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.BottomExchange).lockedIds).toEqual([]);
  });
});

describe('canSubmitPlay — 出牌按钮灰色判定', () => {
  it('未选牌 → 不可提交（灰色）', () => {
    expect(canSubmitPlay([], [c('S', 3, 0)], [], cfg)).toBe(false);
  });

  it('领出单张 → 可提交', () => {
    expect(canSubmitPlay([c('S', 3, 0)], [c('S', 3, 0)], [], cfg)).toBe(true);
  });

  it('领出同花色多张 → 可提交', () => {
    expect(canSubmitPlay([c('H', 3, 0), c('H', 4, 1)], [c('H', 3, 0), c('H', 4, 1)], [], cfg)).toBe(true);
  });

  it('领出不同花色多张 → 不可提交', () => {
    expect(canSubmitPlay([c('H', 3, 0), c('D', 4, 1)], [c('H', 3, 0), c('D', 4, 1)], [], cfg)).toBe(false);
  });

  it('领出混主牌与非主 → 不可提交', () => {
    // 黑桃主 level2：H3 非主 + S2 级牌主 → 不同组
    expect(canSubmitPlay([c('H', 3, 0), c('S', 2, 1)], [c('H', 3, 0), c('S', 2, 1)], [], cfg)).toBe(false);
  });

  it('领出全主牌 → 可提交', () => {
    // S2（级牌主）+ J-16（大王主）→ 同组
    expect(canSubmitPlay([c('S', 2, 0), c('J', 16, 1)], [c('S', 2, 0), c('J', 16, 1)], [], cfg)).toBe(true);
  });

  it('跟牌张数与领出不符 → 不可提交', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('D', 3, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    expect(canSubmitPlay([c('H', 3, 0)], hand, [lead], cfg)).toBe(false);
    expect(canSubmitPlay([c('H', 3, 0), c('H', 4, 1), c('D', 3, 2)], hand, [lead], cfg)).toBe(false);
  });

  it('跟牌张数正确但牌型不符合（对子领出需跟对子）→ 不可提交', () => {
    const hand = [c('H', 3, 0), c('H', 4, 1), c('H', 5, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    // 手牌有对子（33），跟两张不同 rank 单牌 → validateFollow 拒绝
    expect(canSubmitPlay([c('H', 3, 0), c('H', 4, 2)], hand, [lead], cfg)).toBe(false);
  });

  it('跟牌张数与牌型都符合 → 可提交', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1), c('H', 4, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    expect(canSubmitPlay([c('H', 3, 0), c('H', 3, 1)], hand, [lead], cfg)).toBe(true);
  });
});

describe('bottomExchangeStatus — 扣底主按键判定', () => {
  const eight = (trumps: number): Card[] => {
    // 8 张：前 trumps 张为主牌，其余为非主（红桃非级牌）
    const cards: Card[] = [];
    for (let i = 0; i < trumps; i++) cards.push(c('S', 3 + i, i)); // 黑桃主花色
    for (let i = trumps; i < 8; i++) cards.push(c('H', 3 + i, i)); // 红桃非级牌（level2）
    return cards;
  };

  it('选满 8 张且无主牌 → 可提交，无警告', () => {
    expect(bottomExchangeStatus(eight(0), cfg)).toEqual({ canSubmit: true, trumpCount: 0 });
  });

  it('选满 8 张但含主牌 → 可提交 + 主牌计数（扣底键变黄）', () => {
    expect(bottomExchangeStatus(eight(2), cfg)).toEqual({ canSubmit: true, trumpCount: 2 });
  });

  it('主牌含级牌（异花色 2）与小王 → 均计入', () => {
    const sel = [c('H', 2, 0), c('J', 15, 1), c('J', 16, 2), c('S', 3, 3),
                 c('H', 4, 4), c('H', 5, 5), c('H', 6, 6), c('H', 7, 7)];
    expect(bottomExchangeStatus(sel, cfg)).toEqual({ canSubmit: true, trumpCount: 4 });
  });

  it('不足 8 张（含主牌）→ 不可提交，仍计数', () => {
    expect(bottomExchangeStatus([c('S', 3, 0), c('H', 2, 1)], cfg)).toEqual({ canSubmit: false, trumpCount: 2 });
  });

  it('超过 8 张 → 不可提交（≠8 判定）', () => {
    const sel = [...eight(0), c('H', 11, 10)];
    expect(bottomExchangeStatus(sel, cfg)).toEqual({ canSubmit: false, trumpCount: 0 });
  });

  it('trumpDeclaration 为空 → 主牌数 0（防御）', () => {
    expect(bottomExchangeStatus([c('S', 3, 0)], null)).toEqual({ canSubmit: false, trumpCount: 0 });
  });
});

describe('computeSelectionMode — 跟牌分组选择模式', () => {
  it('领出/非 Playing → free（自由选择）', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1)];
    expect(computeSelectionMode(hand, [], cfg, GamePhase.Playing).kind).toBe('free');
    expect(computeSelectionMode(hand, [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.BottomExchange).kind).toBe('free');
  });

  it('单张领出 → replace，每张可选牌自成一组', () => {
    const hand = [c('S', 3, 0), c('S', 4, 1), c('H', 3, 2)];
    const mode = computeSelectionMode(hand, [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('replace');
    if (mode.kind !== 'replace') return;
    expect(mode.groups['S-3-0']).toEqual(['S-3-0']);
    expect(mode.groups['S-4-1']).toEqual(['S-4-1']);
    expect(mode.groups['H-3-2']).toBeUndefined(); // 灰色牌无映射
  });

  it('对子领出手牌有多对 → replace，整对一组；点击/再点放下', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1), c('H', 4, 2), c('H', 4, 3), c('D', 5, 4)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('replace');
    if (mode.kind !== 'replace') return;
    expect(mode.groups['H-3-0']).toEqual(['H-3-0', 'H-3-1']);
    expect(applyGroupClick([], [], mode, 'H-3-0')).toEqual(['H-3-0', 'H-3-1']);
    expect(applyGroupClick(['H-3-0', 'H-3-1'], [], mode, 'H-3-1')).toEqual([]);
    // 点另一组 → 放旧选新
    expect(applyGroupClick(['H-3-0', 'H-3-1'], [], mode, 'H-4-2')).toEqual(['H-4-2', 'H-4-3']);
  });

  it('对子领出仅一对（唯一可出）→ free，由自动锁定接管', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1), c('D', 5, 2), c('D', 6, 3)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('对子领出手牌无对 → free（回退自由选择，散牌垫牌）', () => {
    const hand = [c('H', 3, 0), c('D', 5, 1), c('D', 6, 2)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('拖拉机领出仅一台整机（唯一可出）→ free，由自动锁定接管', () => {
    const hand = [c('C', 3, 0), c('C', 3, 1), c('C', 4, 2), c('C', 4, 3), c('D', 9, 4)];
    const lead = play([c('C', 6, 5), c('C', 6, 6), c('C', 7, 7), c('C', 7, 8)], Suit.Clubs);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('拖拉机多窗共享：点一张选整个窗口（引擎允许同长/更长整机提取，整窗皆为合法跟出）', () => {
    // ♣55/66/77/99 → 窗口 5566、6677（同链滑动窗，共享 66）。
    // 曾按"必出 66 + 填一对"按对分组：replace 只留一组，点 66 再点 77 会放掉 66，
    // 永远凑不齐 4 张（实测 canSubmitPlay=false 死路）——改为整窗分组后每次点击
    // 即选中一个完整合法窗口（引擎 [66+77]/[55+66] 均合法）。
    const hand = [c('C', 5, 0), c('C', 5, 1), c('C', 6, 2), c('C', 6, 3),
                  c('C', 7, 4), c('C', 7, 5), c('C', 9, 6), c('C', 9, 7)];
    const lead = play([c('C', 3, 8), c('C', 3, 9), c('C', 4, 10), c('C', 4, 11)], Suit.Clubs);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('replace');
    if (mode.kind !== 'replace') return;
    // 同链先枚举高位窗（引擎 sortHand 降序）：6677 在前、5566 在后
    const winHi = ['C-7-4', 'C-7-5', 'C-6-2', 'C-6-3'];
    const winLo = ['C-6-2', 'C-6-3', 'C-5-0', 'C-5-1'];
    expect(mode.groups['C-7-4']).toEqual(winHi);
    expect(mode.groups['C-5-0']).toEqual(winLo);
    expect(mode.groups['C-9-6']).toBeUndefined(); // 99 进不了任何窗口 → 灰牌无映射
    // 点一张选整个窗口；点另一窗口放旧窗口
    expect(applyGroupClick([], [], mode, 'C-7-4')).toEqual(winHi);
    expect(applyGroupClick(winHi, [], mode, 'C-5-0')).toEqual(winLo);
  });

  it('拖拉机多窗互斥（不相邻且无更长整机）→ 点一张选整个拖拉机', () => {
    // ♣55/66 与 ♣88/99 两台独立二连拖（中间断 7），无共有牌
    const hand = [c('C', 5, 0), c('C', 5, 1), c('C', 6, 2), c('C', 6, 3),
                  c('C', 8, 4), c('C', 8, 5), c('C', 9, 6), c('C', 9, 7)];
    const lead = play([c('C', 3, 8), c('C', 3, 9), c('C', 4, 10), c('C', 4, 11)], Suit.Clubs);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('replace');
    if (mode.kind !== 'replace') return;
    // 组内顺序随引擎（同花色 rank 降序，高位对在前）
    const winA = ['C-6-2', 'C-6-3', 'C-5-0', 'C-5-1'];
    const winB = ['C-9-6', 'C-9-7', 'C-8-4', 'C-8-5'];
    expect(mode.groups['C-6-2']).toEqual(winA);
    expect(mode.groups['C-9-7']).toEqual(winB);
    // 点一张选整台；点另一台放旧整台
    expect(applyGroupClick([], [], mode, 'C-9-6')).toEqual(winB);
    expect(applyGroupClick(winB, [], mode, 'C-5-0')).toEqual(winA);
  });

  it('拖拉机多窗共享（五连对 vs 三连窗）：整窗分组 replace，点任一窗口整组替换', () => {
    // ♣55–99 五连对 → 三连窗口 567/678/789。曾按"必出 77 + 填两对"按对 accumulate；
    // 实测引擎 [678] 等整台均合法、按对拼装常有非法组合（如 55+88 不成台），
    // 且 accumulate 拖动只认终点一对——改为整窗分组 replace 后每次点击 = 一个合法整台。
    const hand = [c('C', 5, 0), c('C', 5, 1), c('C', 6, 2), c('C', 6, 3),
                  c('C', 7, 4), c('C', 7, 5), c('C', 8, 6), c('C', 8, 7),
                  c('C', 9, 8), c('C', 9, 9)];
    const lead = play([c('C', 3, 10), c('C', 3, 11), c('C', 4, 12), c('C', 4, 13), c('C', 5, 14), c('C', 5, 15)], Suit.Clubs);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('replace');
    if (mode.kind !== 'replace') return;
    // 高位窗先枚举 789，其次 678，最后 567；共享牌归先枚举窗
    const win789 = ['C-9-8', 'C-9-9', 'C-8-6', 'C-8-7', 'C-7-4', 'C-7-5'];
    const win678 = ['C-8-6', 'C-8-7', 'C-7-4', 'C-7-5', 'C-6-2', 'C-6-3'];
    const win567 = ['C-7-4', 'C-7-5', 'C-6-2', 'C-6-3', 'C-5-0', 'C-5-1'];
    expect(mode.groups['C-9-8']).toEqual(win789);
    expect(mode.groups['C-6-2']).toEqual(win678);
    expect(mode.groups['C-5-0']).toEqual(win567);
    expect(applyGroupClick([], [], mode, 'C-9-8')).toEqual(win789);
    expect(applyGroupClick(win789, [], mode, 'C-5-0')).toEqual(win567);
  });

  it('拖拉机领出手牌无整机 → free', () => {
    const hand = [c('S', 3, 0), c('S', 3, 1), c('D', 9, 2)];
    const lead = play([c('H', 3, 8), c('H', 3, 9), c('H', 4, 10), c('H', 4, 11)], Suit.Hearts);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('用户回归：主拖拉机领出、手牌 3 个主对（无同长整机）→ accumulate 按对，点一张整对进入', () => {
    // 领出主拖拉机（4 张）；手牌 H33/D33/C22 三个主对，无同长整机——
    // 修复前 wins=空直接回退 free，可点选单张梅花2（引擎 validateFollow 拆对即非法）。
    // 引擎口径：无整机时"散对填充"（minTotalPairs=2），任意 2 个整对合法。
    const cfgC3: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Clubs, level: 3 };
    const hand = [
      c('H', 3, 0), c('H', 3, 1), c('D', 3, 2), c('D', 3, 3), c('C', 2, 4), c('C', 2, 5),
      c('S', 14, 6), c('S', 13, 7), c('S', 12, 8), c('S', 11, 9), c('S', 10, 10),
      c('S', 9, 11), c('S', 8, 12), c('S', 7, 13), c('S', 6, 14), c('S', 5, 15),
    ];
    const lead = play([c('C', 5, 20), c('C', 5, 21), c('C', 6, 22), c('C', 6, 23)], null); // 全主 → leadSuit null
    const mode = computeSelectionMode(hand, [lead], cfgC3, GamePhase.Playing);
    expect(mode.kind).toBe('accumulate');
    if (mode.kind !== 'accumulate') return;
    // 点单张梅花2 → 整对进入；再点另一对累加（不自动放下）
    expect(applyGroupClick([], [], mode, 'C-2-4')).toEqual(['C-2-4', 'C-2-5']);
    expect(applyGroupClick(['C-2-4', 'C-2-5'], [], mode, 'H-3-0'))
      .toEqual(['C-2-4', 'C-2-5', 'H-3-0', 'H-3-1']);
    // 再点整对放下
    expect(applyGroupClick(['C-2-4', 'C-2-5', 'H-3-0', 'H-3-1'], [], mode, 'H-3-1'))
      .toEqual(['C-2-4', 'C-2-5']);
  });

  it('举一反三：主拖拉机领出、手牌 3 对散对（相邻可整对）→ accumulate 按对', () => {
    // 用标准 cfg（黑桃2 主）构造等价场景：S33/S55/S88 三个主对、相邻但不连续 → 无整机
    const hand = [
      c('S', 3, 0), c('S', 3, 1), c('S', 5, 2), c('S', 5, 3), c('S', 8, 4), c('S', 8, 5),
      c('H', 10, 6), c('H', 11, 7), c('H', 12, 8), c('H', 13, 9), c('D', 10, 10), c('D', 11, 11),
    ];
    const lead = play([c('S', 9, 20), c('S', 9, 21), c('S', 10, 22), c('S', 10, 23)], null); // 主拖拉机
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('accumulate');
    if (mode.kind !== 'accumulate') return;
    expect(applyGroupClick([], [], mode, 'S-3-0')).toEqual(['S-3-0', 'S-3-1']);
  });

  it('拖拉机领出、组成败不足（仅一对 + 散牌）→ free + 必出对锁定（可垫近似组合）', () => {
    // 领出主拖拉机 C5-5 C6-6；手牌仅 C22 一个主对 + 散牌——引擎"对子不足可垫"：
    // playable 含散牌，组粒度不适用 → free；C22 必出由锁定承接。
    const cfgC3: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Clubs, level: 3 };
    const hand = [
      c('C', 2, 0), c('C', 2, 1), c('C', 9, 2), c('C', 8, 3), c('C', 7, 4), c('C', 4, 5),
      c('S', 14, 6), c('S', 13, 7),
    ];
    const lead = play([c('C', 5, 20), c('C', 5, 21), c('C', 6, 22), c('C', 6, 23)], null);
    expect(computeSelectionMode(hand, [lead], cfgC3, GamePhase.Playing).kind).toBe('free');
    expect(computeFollowPlan(hand, [lead], cfgC3, GamePhase.Playing).lockedIds).toEqual(['C-2-0', 'C-2-1']);
    const ids = computePlayableIds(hand, [lead], cfgC3, GamePhase.Playing)!;
    expect(ids.has('C-9-2')).toBe(true); // 散牌可垫
  });

  it('举一反三：无单张甩牌领出、组牌数够且全出对牌 → accumulate 按对（不可点选单张）', () => {
    // 领 ♣77+♣99（2 对甩牌，无单张无拖拉机）；手牌 4 对梅花足够 → 可选域全对牌
    const hand = [
      c('C', 3, 0), c('C', 3, 1), c('C', 4, 2), c('C', 4, 3), c('C', 5, 4), c('C', 5, 5),
      c('C', 6, 6), c('C', 6, 7), c('H', 14, 8), c('H', 13, 9), c('H', 12, 10), c('H', 11, 11),
    ];
    const lead = play([c('C', 7, 20), c('C', 7, 21), c('C', 9, 22), c('C', 9, 23)], Suit.Clubs);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('accumulate');
    if (mode.kind !== 'accumulate') return;
    expect(applyGroupClick([], [], mode, 'C-3-0')).toEqual(['C-3-0', 'C-3-1']);
    // 散牌 H-A 等不可选（对牌足够时引擎只给对牌可点）
    const ids = computePlayableIds(hand, [lead], cfg, GamePhase.Playing)!;
    expect(ids.has('H-14-8')).toBe(false);
    expect(ids.has('C-6-6')).toBe(true);
  });

  it('含单张的甩牌领出 → free', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1), c('C', 6, 2), c('C', 6, 3)];
    const lead = play([c('H', 7, 8), c('H', 7, 9), c('H', 9, 10)], Suit.Hearts); // 对+单甩牌
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('不含单张的甩牌领出：组牌不足（部分缺门）→ free（fill 无牌型约束，可拆对）', () => {
    // 领 ♣77+♦88；手牌梅花仅单张 ♣4（必出），剩 3 张任意填。
    // 引擎实测：拆对 [♣4+♦6a+♦6b+♦9a] 与 [♣4+♦6a+♦9a+♦6b] 均合法 → fill 无结构约束 → free，
    // 组粒度（按对/整组）不适用（曾错误返回 accumulate，导致拖选失效）
    const hand = [c('C', 4, 0), c('D', 6, 1), c('D', 6, 2), c('D', 9, 3), c('D', 9, 4)];
    const lead = play([c('C', 7, 5), c('C', 7, 6), c('D', 8, 7), c('D', 8, 8)], Suit.Clubs);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('不含单张的甩牌领出：组牌恰为一对但不足 → free（余位任意填，可拆对）', () => {
    // 领 ♣77+♦88；手牌梅花仅一对 ♣33（必出），剩 2 张任意填。
    // 引擎实测：[♣33+♦6a+♦9a] 拆对合法 → 无结构约束 → free（曾错误返回 replace）
    const hand = [c('C', 3, 0), c('C', 3, 1), c('D', 6, 2), c('D', 6, 3),
                  c('D', 9, 4), c('D', 9, 5)];
    const lead = play([c('C', 7, 6), c('C', 7, 7), c('D', 8, 8), c('D', 8, 9)], Suit.Clubs);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('不含单张的甩牌领出：领出花色够数时其他花色不可用（唯一组合）→ free', () => {
    // 手牌梅花 4 张 == 领出长度 → 引擎判定唯一组合 C33+C44，其余全锁
    const hand = [c('C', 3, 0), c('C', 3, 1), c('C', 4, 2), c('C', 4, 3),
                  c('D', 6, 4), c('D', 6, 5)];
    const lead = play([c('C', 7, 6), c('C', 7, 7), c('D', 8, 8), c('D', 8, 9)], Suit.Clubs);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('非单张领出缺门垫牌（含毙牌局）→ 自由选择', () => {
    const hand = [c('D', 5, 0), c('D', 5, 1), c('C', 8, 2), c('S', 3, 3)];
    const lead = play([c('H', 7, 8), c('H', 7, 9)], Suit.Hearts);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('用户回归：甩牌领出、同门仅 1 张（必出锁定）+ 其他花色含对 → free（拖选可垫任意花色）', () => {
    // 实测反馈：主级牌黑桃2，领出 方块 AA-10-10-9-9（甩牌），手牌单张方块 J（必出锁定），
    // 其余梅花 QJ943 / 红桃 A43 等需拖动垫选——修复前返回 accumulate（按对加选），
    // 拖拽仅认终点一张/对、点选强制整对，无法拖选多个散牌。引擎口径：组牌 ≤ 领出张数
    // → 全出 + 任意填（validateFollow 对 [J + 任意 5 张] 合法）→ 组粒度不适用 → free
    const hand = [
      c('D', 11, 0), // 方块 J（唯一同门，必出）
      c('C', 12, 1), c('C', 11, 2), c('C', 9, 3), c('C', 4, 4), c('C', 3, 5),
      c('H', 14, 6), c('H', 4, 7), c('H', 3, 8),
      c('S', 10, 9), c('S', 10, 10), // 其他花色对（修复前被误组为 accumulate 组）
    ];
    const lead = play([
      c('D', 14, 20), c('D', 14, 21), c('D', 10, 22), c('D', 10, 23),
      c('D', 9, 24), c('D', 9, 25),
    ], Suit.Diamonds);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('free');
    // 必出锁定与选择模式解耦：D-J 仍由 computeFollowPlan 锁定（可放下于 store 层禁止）
    expect(computeFollowPlan(hand, [lead], cfg, GamePhase.Playing).lockedIds).toEqual(['D-11-0']);
    // 全可选（fill 空间任意）
    expect(computePlayableIds(hand, [lead], cfg, GamePhase.Playing)).toBeNull();
  });

  it('非单张领出同门部分不足（需垫一部分）→ free（fill 任意，可拆对）', () => {
    // 领 ♥77 对；手牌红桃仅单张 ♥3（必出），剩 1 张任意垫——
    // 引擎规则：组牌 ≤ 领出张数 → 全出 + 任意填（[♥3+♦5a] 拆对亦合法）→ free
    const hand = [c('H', 3, 0), c('D', 5, 1), c('D', 5, 2)];
    const lead = play([c('H', 7, 8), c('H', 7, 9)], Suit.Hearts);
    expect(computeSelectionMode(hand, [lead], cfg, GamePhase.Playing).kind).toBe('free');
  });

  it('单张领出缺门垫牌 → 仍 replace 单卡组（始终只选一张）', () => {
    const hand = [c('H', 3, 0), c('D', 4, 1)];
    const mode = computeSelectionMode(hand, [play([c('S', 5, 9)], Suit.Spades)], cfg, GamePhase.Playing);
    expect(mode.kind).toBe('replace');
    if (mode.kind !== 'replace') return;
    expect(mode.groups['H-3-0']).toEqual(['H-3-0']);
    expect(applyGroupClick(['H-3-0'], [], mode, 'D-4-1')).toEqual(['D-4-1']);
  });

  it('锁定牌在任何操作下保留', () => {
    const hand = [c('H', 3, 0), c('H', 3, 1), c('H', 4, 2), c('H', 4, 3), c('D', 5, 4)];
    const lead = play([c('H', 7, 9), c('H', 7, 10)], Suit.Hearts);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    if (mode.kind !== 'replace') { throw new Error('expect replace'); }
    // 点新组：锁定保留 + 新组
    expect(applyGroupClick(['D-9-9'], ['D-9-9'], mode as any, 'H-4-2'))
      .toEqual(['D-9-9', 'H-4-2', 'H-4-3']);
    // 放下：仅剩锁定
    expect(applyGroupClick(['D-9-9', 'H-4-2', 'H-4-3'], ['D-9-9'], mode as any, 'H-4-3'))
      .toEqual(['D-9-9']);
  });

  it('拖拽拾取返回候选组（整窗）；终点灰牌清空仅留锁定', () => {
    const hand = [c('C', 5, 0), c('C', 5, 1), c('C', 6, 2), c('C', 6, 3),
                  c('C', 7, 4), c('C', 7, 5), c('C', 9, 6), c('C', 9, 7)];
    const lead = play([c('C', 3, 8), c('C', 3, 9), c('C', 4, 10), c('C', 4, 11)], Suit.Clubs);
    const mode = computeSelectionMode(hand, [lead], cfg, GamePhase.Playing);
    if (mode.kind !== 'replace') { throw new Error('expect replace'); }
    expect(applyGroupDragPick(mode, 'C-7-4')).toEqual(['C-7-4', 'C-7-5', 'C-6-2', 'C-6-3']);
    expect(clearSelectionKeepLocked(['C-7-4', 'C-7-5'], [])).toEqual([]);
    expect(clearSelectionKeepLocked(['A', 'B'], ['B'])).toEqual(['B']);
  });
});
