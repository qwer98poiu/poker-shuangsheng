import { describe, it, expect } from 'vitest';
import { engineStrategy, ai0719Strategy, ai0801Strategy, ai0802Strategy } from '../strategies.js';
import { playMatch } from '../match.js';

/**
 * 历史基线策略的合法性检测：整场对局不得出现引擎验牌回退（errors>0）
 * 或中止（aborted）。旧策略在现行规则下可能出非法牌——一旦出现，
 * 说明该基线需要重新评估（回退会扭曲其真实行为）。
 */
describe('historical strategies legality', () => {
  it('ai-0719（98221b, 07-19）：无中止、无验牌回退', () => {
    for (const pair of [8, 9]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0719Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0801（当前 ai/ 快照）：无中止、无验牌回退', () => {
    for (const pair of [4, 5]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0801Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0802（ebe0625, 08-02 分位置跟牌重构）：无中止、无验牌回退', () => {
    for (const pair of [10, 11]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0802Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });
});
