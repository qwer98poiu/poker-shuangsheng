import { describe, it, expect } from 'vitest';
import { engineStrategy, ai0907Strategy, ai0929Strategy, ai1024Strategy, ai1031Strategy, ai1106Strategy, ai1108Strategy } from '../strategies.js';
import { playMatch } from '../match.js';

/**
 * 历史基线策略的合法性检测：整场对局不得出现引擎验牌回退（errors>0）
 * 或中止（aborted）。旧策略在现行规则下可能出非法牌——一旦出现，
 * 说明该基线需要重新评估（回退会扭曲其真实行为）。
 */
describe('historical strategies legality', () => {
  it('ai-0907（6aa2b80, 09-07 毙牌单张按档位选牌之前）：无中止、无验牌回退', () => {
    for (const pair of [18, 19]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai0907Strategy, engineStrategy], captureEvents: true });
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

  it('ai-1024（bc38d6, 10-24 庄 4.5：主拖拉机先于通用 5 领出）：无中止、无验牌回退', () => {
    for (const pair of [30, 31]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai1024Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-1031（accffd, 10-31 0b 队友对子检查与跟牌拆拖拉机改版）：无中止、无验牌回退', () => {
    for (const pair of [28, 29]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai1031Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-1106（6c77d74, 11-06 庄家方统一领出阶梯落地）：无中止、无验牌回退', () => {
    for (const pair of [32, 33]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai1106Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });

  it('ai-1108（086ac7d, 11-08 第四家盖不过时不加分）：无中止、无验牌回退', () => {
    for (const pair of [34, 35]) {
      const m = playMatch({ seed: 42, pairIndex: pair, strategies: [ai1108Strategy, engineStrategy], captureEvents: true });
      expect(m.abortedHands).toBe(0);
      for (const ev of m.events) expect(ev.errors).toBe(0);
    }
  });
});
