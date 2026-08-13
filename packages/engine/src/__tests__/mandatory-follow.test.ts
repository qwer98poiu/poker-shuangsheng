import { describe, it, expect } from 'vitest';
import { Suit } from '../types.js';
import { createCard } from '../model.js';
import { computeMandatoryFollow } from '../following/index.js';
import { aiFollowPlay } from '../ai/index.js';
import type { TrumpDeclaration, Card } from '../types.js';

const cfg5: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Hearts, level: 5 };
// trump = all Jokers, all Hearts, all 5s (any suit)
const cfg2S: TrumpDeclaration = { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 };
// 黑桃主，级牌 2：主牌 = 大小王 + 所有 2 + 黑桃全花色

function c(s: string, r: number, i: number): Card { return createCard(s as any, r as any, i); }

function expectFollow(
  hand: Card[], lead: Card[], cfg: TrumpDeclaration,
  locked: string[], disabled: string[],
): void {
  const got = computeMandatoryFollow(hand, lead, cfg);
  expect(got.lockedIds.slice().sort()).toEqual(locked.slice().sort());
  expect(got.disabledIds.slice().sort()).toEqual(disabled.slice().sort());
}

describe('computeMandatoryFollow — 跟牌部分必出（锁定）与不可选（置灰）', () => {
  it('领出为空 → 全部自由', () => {
    const hand = [c('S', 3, 0), c('H', 3, 1)];
    expectFollow(hand, [], cfg5, [], []);
  });

  it('缺门（手牌无 lead 组牌）→ 全部自由（可垫/毙任意）', () => {
    const hand = [c('S', 3, 0), c('C', 3, 1)];
    expectFollow(hand, [c('D', 7, 9), c('D', 7, 10)], cfg5, [], []);
  });

  it('组牌张数 < lead 张数 → 同花色全部必出（其余任意填）', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12), c('S', 12, 13), c('S', 12, 14)];
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('H', 14, 4), c('D', 6, 5)];
    expectFollow(hand, lead, cfg5, ['S-10-0', 'S-10-1', 'S-9-2', 'S-9-3'], []);
  });

  it('组牌张数 == lead 张数 → 同花色全部必出（唯一可出）', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12), c('S', 12, 13), c('S', 12, 14)];
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('S', 8, 4), c('S', 3, 5)];
    expectFollow(hand, lead, cfg5, ['S-10-0', 'S-10-1', 'S-9-2', 'S-9-3', 'S-8-4', 'S-3-5'], []);
  });

  it('单张领出 + 手牌恰一对 → 唯一可出，锁 1 张（等价组合），另一张不可选', () => {
    const lead = [c('S', 8, 9)];
    const hand = [c('S', 14, 0), c('S', 14, 1), c('H', 13, 2)];
    expectFollow(hand, lead, cfg5, ['S-14-0'], ['S-14-1']);
  });

  it('例 3：领出 3 连对，手牌 2 连对 + 两对 → 2 连对必出，无不可选', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12), c('S', 12, 13), c('S', 12, 14)];
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('S', 7, 4), c('S', 7, 5), c('S', 4, 6), c('S', 4, 7)];
    // hand: 1010 99（2 连对）+ 77 + 44；Ideal 降级为 [2,1]
    expectFollow(hand, lead, cfg5, ['S-10-0', 'S-10-1', 'S-9-2', 'S-9-3'], []);
  });

  it('例 4：主牌甩 3 连对 + 2 连对，手牌 3/2/2/1 → 3 连对必出，对牌不可选', () => {
    const lead = [
      c('J', 16, 0), c('J', 16, 1), c('J', 15, 2), c('J', 15, 3), c('S', 2, 4), c('S', 2, 5),
      c('S', 12, 6), c('S', 12, 7), c('S', 11, 8), c('S', 11, 9),
    ];
    // lead: 对大王对小王对黑桃2（3 连对）+ 黑桃 QQJJ（2 连对）
    const hand = [
      c('H', 2, 0), c('H', 2, 1), c('S', 14, 2), c('S', 14, 3), c('S', 13, 4), c('S', 13, 5),
      c('S', 10, 6), c('S', 10, 7), c('S', 9, 8), c('S', 9, 9),
      c('S', 7, 10), c('S', 7, 11), c('S', 6, 12), c('S', 6, 13),
      c('S', 4, 14), c('S', 4, 15),
    ];
    // hand: 红桃2 + AAKK（3 连对）、101099（2 连对）、7766（2 连对）、44（对牌）
    const locked = ['H-2-0', 'H-2-1', 'S-14-2', 'S-14-3', 'S-13-4', 'S-13-5'];
    const disabled = ['S-4-14', 'S-4-15'];
    expectFollow(hand, lead, cfg2S, locked, disabled);
  });

  it('例 5：领出 2 连对 + 两对，手牌 4 连对 + 一对 → 无必出、无不可选', () => {
    const lead = [
      c('S', 10, 9), c('S', 10, 10), c('S', 9, 11), c('S', 9, 12),
      c('S', 7, 13), c('S', 7, 14), c('S', 4, 15), c('S', 4, 16),
    ];
    // lead: 黑桃 101099（2 连对）+ 77 + 44
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3),
      c('S', 12, 4), c('S', 12, 5), c('S', 11, 6), c('S', 11, 7),
      c('S', 6, 8), c('S', 6, 9),
    ];
    // hand: 黑桃 AAKKQQJJ（4 连对）+ 66（一对）
    expectFollow(hand, lead, cfg5, [], []);
  });

  it('3.1 理想降级：手牌总对数 == Ideal 总对数 → 所有对必出，单牌自由选择', () => {
    const lead = [
      c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12),
      c('S', 12, 13), c('S', 12, 14), c('S', 10, 15), c('S', 10, 16),
      c('S', 9, 17), c('S', 9, 18),
    ];
    // lead: 黑桃 AAKKQQ（3 连对）+ 101099（2 连对），10 张
    const hand = [
      c('S', 7, 0), c('S', 7, 1), c('S', 6, 2), c('S', 6, 3),
      c('S', 4, 4), c('S', 4, 5), c('S', 3, 6), c('S', 3, 7),
      c('S', 8, 8), c('S', 2, 9), c('S', 11, 10),
    ];
    // hand: 7766（2 连对）+ 4433（2 连对）+ 单 8、2、J（11 张）
    // Ideal 降级 [2,2] min 4 == 手牌总对数 4 → 所有对必出，单牌可选（不灰）
    const locked = ['S-7-0', 'S-7-1', 'S-6-2', 'S-6-3', 'S-4-4', 'S-4-5', 'S-3-6', 'S-3-7'];
    expectFollow(hand, lead, cfg5, locked, []);
  });

  it('3.2 领出含单牌 → 同花色无不可选', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12), c('S', 8, 13)];
    // lead: 黑桃 AAKK（2 连对）+ 8（单），5 张
    const hand = [
      c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3),
      c('S', 7, 4), c('S', 7, 5), c('S', 4, 6), c('S', 4, 7), c('S', 3, 8),
    ];
    // hand: 101099（2 连对）+ 77 + 44 + 单 3（9 张）→ 2 连对必出，单牌与对牌均可选
    expectFollow(hand, lead, cfg5, ['S-10-0', 'S-10-1', 'S-9-2', 'S-9-3'], []);
  });

  it('3.2.3 + 3.2.4：领出对子，手牌 2 连对 + 一对 + 单 → 单牌与独立对不可选', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12)];
    // lead: 黑桃 AAKK（2 连对），4 张
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('S', 7, 4), c('S', 7, 5), c('S', 3, 6)];
    // hand: 101099（2 连对）+ 77 + 单 3（7 张）→ 2 连对必出；Ideal [2] 无 fill → 最短对数 2 → 77 与单 3 不可选
    const locked = ['S-10-0', 'S-10-1', 'S-9-2', 'S-9-3'];
    const disabled = ['S-7-4', 'S-7-5', 'S-3-6'];
    expectFollow(hand, lead, cfg5, locked, disabled);
  });

  it('3.2 领出对子、手牌多对 → 无必出；单牌不可选', () => {
    const lead = [c('S', 8, 9), c('S', 8, 10)];
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('S', 7, 4), c('S', 7, 5), c('S', 4, 6)];
    // hand: 101099（2 连对）+ 77 + 单 4 → 任一对可跟 → 无必出；单 4 不可选
    expectFollow(hand, lead, cfg5, [], ['S-4-6']);
  });

  it('领出全单 → 跟牌自由', () => {
    const lead = [c('S', 14, 9), c('S', 9, 10), c('S', 4, 11)];
    const hand = [c('S', 8, 0), c('S', 6, 1), c('S', 3, 2), c('S', 2, 3)];
    expectFollow(hand, lead, cfg5, [], []);
  });

  it('手牌全单跟对子领出 → 无必出无不可选（垫牌）', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10)];
    const hand = [c('S', 8, 0), c('S', 6, 1), c('S', 4, 2)];
    expectFollow(hand, lead, cfg5, [], []);
  });
});

describe('AI 建议出牌与必出/不可选约束一致（建议 ⊇ 必出、∩ 不可选 = ∅）', () => {
  function expectAiFollowRespectsMandatory(hand: Card[], lead: Card[], leadSuit: any, cfg: TrumpDeclaration): void {
    const mandatory = computeMandatoryFollow(hand, lead, cfg);
    const r = aiFollowPlay(hand, lead, leadSuit, cfg);
    const played = new Set(r.cards.map(c => c.id));
    for (const id of mandatory.lockedIds) {
      expect(played.has(id), `AI 建议缺必出牌 ${id}`).toBe(true);
    }
    for (const id of mandatory.disabledIds) {
      expect(played.has(id), `AI 建议含不可选牌 ${id}`).toBe(false);
    }
  }

  it('例 3：领出 3 连对，手牌 2 连对 + 两对', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12), c('S', 12, 13), c('S', 12, 14)];
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('S', 7, 4), c('S', 7, 5), c('S', 4, 6), c('S', 4, 7)];
    expectAiFollowRespectsMandatory(hand, lead, Suit.Spades, cfg5);
  });

  it('例 4：主牌甩 3 连对 + 2 连对，手牌 3/2/2/1', () => {
    const lead = [
      c('J', 16, 0), c('J', 16, 1), c('J', 15, 2), c('J', 15, 3), c('S', 2, 4), c('S', 2, 5),
      c('S', 12, 6), c('S', 12, 7), c('S', 11, 8), c('S', 11, 9),
    ];
    const hand = [
      c('H', 2, 0), c('H', 2, 1), c('S', 14, 2), c('S', 14, 3), c('S', 13, 4), c('S', 13, 5),
      c('S', 10, 6), c('S', 10, 7), c('S', 9, 8), c('S', 9, 9),
      c('S', 7, 10), c('S', 7, 11), c('S', 6, 12), c('S', 6, 13),
      c('S', 4, 14), c('S', 4, 15),
    ];
    expectAiFollowRespectsMandatory(hand, lead, null, cfg2S);
  });

  it('例 5：领出 2 连对 + 两对，手牌 4 连对 + 一对（无必出无不可选）', () => {
    const lead = [
      c('S', 10, 9), c('S', 10, 10), c('S', 9, 11), c('S', 9, 12),
      c('S', 7, 13), c('S', 7, 14), c('S', 4, 15), c('S', 4, 16),
    ];
    const hand = [
      c('S', 14, 0), c('S', 14, 1), c('S', 13, 2), c('S', 13, 3),
      c('S', 12, 4), c('S', 12, 5), c('S', 11, 6), c('S', 11, 7),
      c('S', 6, 8), c('S', 6, 9),
    ];
    expectAiFollowRespectsMandatory(hand, lead, Suit.Spades, cfg5);
  });

  it('3.1 理想降级：手牌 2 连对 + 2 连对 + 单牌', () => {
    const lead = [
      c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12),
      c('S', 12, 13), c('S', 12, 14), c('S', 10, 15), c('S', 10, 16),
      c('S', 9, 17), c('S', 9, 18),
    ];
    const hand = [
      c('S', 7, 0), c('S', 7, 1), c('S', 6, 2), c('S', 6, 3),
      c('S', 4, 4), c('S', 4, 5), c('S', 3, 6), c('S', 3, 7),
      c('S', 8, 8), c('S', 2, 9), c('S', 11, 10),
    ];
    expectAiFollowRespectsMandatory(hand, lead, Suit.Spades, cfg5);
  });

  it('3.2.3+3.2.4：领出 2 连对，手牌 2 连对 + 独立对 + 单牌', () => {
    const lead = [c('S', 14, 9), c('S', 14, 10), c('S', 13, 11), c('S', 13, 12)];
    const hand = [c('S', 10, 0), c('S', 10, 1), c('S', 9, 2), c('S', 9, 3), c('S', 7, 4), c('S', 7, 5), c('S', 3, 6)];
    expectAiFollowRespectsMandatory(hand, lead, Suit.Spades, cfg5);
  });
});

describe('computeMandatoryFollow — 单张领出回归（模拟器发现：classify single 的 pairCount 占位 1）', () => {
  it('吊主单张 + 手牌主牌组多张（含一对级牌）→ 无必出无不可选', () => {
    const cfg3S: TrumpDeclaration = { declarerIndex: 1, trumpSuit: Suit.Spades, level: 3 };
    const lead = [c('S', 7, 5)]; // 黑桃 7 单张（主花色）
    const hand = [
      c('H', 11, 22), c('H', 3, 14), c('S', 12, 10), c('S', 6, 58), c('S', 9, 61),
      c('S', 2, 0), c('S', 11, 63), c('J', 15, 52), c('C', 7, 31), c('S', 5, 57), c('S', 2, 54),
    ];
    // 修复前：single 的 pairCount=1 使 leadHasSingles 误判 false → 3.1 把级牌对 S-2×2 锁死
    expectFollow(hand, lead, cfg3S, [], []);
  });

  it('副牌单张 + 手牌同花色多张 → 无必出无不可选', () => {
    const lead = [c('H', 7, 9)];
    const hand = [c('H', 10, 0), c('H', 10, 1), c('H', 9, 2), c('H', 4, 3), c('S', 3, 4)];
    expectFollow(hand, lead, cfg5, [], []);
  });
});
