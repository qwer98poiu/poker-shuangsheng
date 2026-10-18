import { describe, it, expect } from 'vitest';
import { engineStrategy, ai0816Strategy, ai0907Strategy, ai0927Strategy, ai0929Strategy, ai1002Strategy, ai1005Strategy } from '../strategies.js';
import { playMatch } from '../match.js';

/**
 * 历史基线策略的合法性检测：整场对局不得出现引擎验牌回退（errors>0）
 * 或中止（aborted）。旧策略在现行规则下可能出非法牌——一旦出现，
 * 说明该基线需要重新评估（回退会扭曲其真实行为）。
 */
describe('historical strategies legality', () => {
  it('ai-0816（2d56a13, 08-16 扣底策略重构前）：无中止、无验牌回退', () => {
    for (const pair of [16, 17]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0816Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0907（6aa2b80, 09-07 毙牌单张按档位选牌之前）：无中止、无验牌回退', () => {
    for (const pair of [18, 19]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0907Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0927（45c8f78, 09-27 亮主 4>3 修复与出副对清对之前）：无中止、无验牌回退', () => {
    for (const pair of [12, 13]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0927Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-0929（be6026c, 09-29 NT 记牌器对子扣减修复）：无中止、无验牌回退', () => {
    for (const pair of [20, 21]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0929Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-1002（2024c08, 10-02 NT 缺门/毙甩/无分墩规则）：无中止、无验牌回退', () => {
    for (const pair of [22, 23]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai1002Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-1005（805b500, 10-05 无主长花色领出层）：无中止、无验牌回退', () => {
    for (const pair of [24, 25]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai1005Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });
});
