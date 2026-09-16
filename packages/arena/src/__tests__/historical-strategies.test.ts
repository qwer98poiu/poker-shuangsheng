import { describe, it, expect } from 'vitest';
import { engineStrategy, ai0719Strategy, ai0802Strategy, ai0808Strategy, ai0809Strategy, ai0816Strategy } from '../strategies.js';
import { playMatch } from '../match.js';

/**
 * 历史基线策略的合法性检测：整场对局不得出现引擎验牌回退（errors>0）
 * 或中止（aborted）。旧策略在现行规则下可能出非法牌——一旦出现，
 * 说明该基线需要重新评估（回退会扭曲其真实行为）。
 */
describe('historical strategies legality', () => {
  // ai-0719 是唯一已知越界的基线：它的扣绝分支没有「整门 ≤8 张」前提——
  // `remaining.slice(0, 8 - discardCards.length)` 在整门 >8 张时是负数切片，
  // 返回远多于 8 张（实测 21 张）→ arena 回退为低分低张并记 1 次 errors。
  // 该 bug 在 25 张口径下也已存在（seed 42 前 16 对里 2 局触发），只是 33 张口径
  // 让整门更容易超 8 张，触发面扩大到 9 局。快照冻结、不修；它的强度数据
  // （README Elo）须按 33 张口径重新评估。
  it('ai-0719（98221b, 07-19）：无中止；扣底越界为已知（33 张口径）', () => {
    const errorsByPair: Array<[number, Array<[number, number]>]> = [];
    for (const pair of [8, 9]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0719Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      errorsByPair.push([pair, m.events.filter(ev => ev.errors > 0).map(ev => [ev.handIndex, ev.errors])]);
    }
    expect(errorsByPair).toEqual([[8, [[13, 1], [29, 1]]], [9, [[15, 1], [24, 1]]]]);
  });

  it('ai-0802（ebe0625, 08-02 分位置跟牌重构）：无中止、无验牌回退', () => {
    for (const pair of [10, 11]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0802Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0808（133900d, 08-08 第四家不盖/NT 垫牌修复前）：无中止、无验牌回退', () => {
    for (const pair of [12, 13]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0808Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0809（b77a7b1, 08-14 第二家避分修复前）：无中止、无验牌回退', () => {
    for (const pair of [14, 15]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0809Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0816（2d56a13, 08-16 扣底策略重构前）：无中止、无验牌回退', () => {
    for (const pair of [16, 17]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0816Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });
});
