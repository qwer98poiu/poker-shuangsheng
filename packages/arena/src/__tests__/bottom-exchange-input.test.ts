import { describe, it, expect } from 'vitest';
import { engineStrategy } from '../strategies.js';
import { playMatch, dealtHands } from '../match.js';
import { deckForHand } from '../rng.js';
import type { Strategy } from '../types.js';

/**
 * 扣底决策的输入口径：庄家先拿进 8 张底牌（共 33 张），再从 33 张里扣 8 张。
 *
 * 这里锁的是「调用点喂了几张」这一层接线——引擎测试只验证函数在 33 张上的行为，
 * 而 4 个调用点曾长期只喂发到的 25 张（等价于先扣后拿），且没有任何测试断言过
 * 这条接线，所以 bug 藏了很久。
 *
 * 调用次数是策略指纹（随策略变化），断言在 strategy-fingerprint.test.ts；
 * 本文件只锁与策略无关的输入口径。
 */
describe('bottom exchange input (33 cards)', () => {
  it('决策输入 = 自己发到的 25 张 + 8 张底牌（内容逐张相符）', () => {
    const seen: Array<{ seat: number; ids: string[] }> = [];
    const spy: Strategy = {
      ...engineStrategy,
      chooseBottom: (hand, config) => {
        seen.push({ seat: config.declarerIndex, ids: hand.map(c => c.id).sort() });
        return engineStrategy.chooseBottom(hand, config);
      },
    };

    playMatch({ seed: 42, pairIndex: 0, maxHands: 1, strategies: [spy, spy] });
    expect(seen.length).toBe(1);

    const deck = deckForHand(42, 0, 0);
    const dealt = dealtHands(deck);
    const declarer = seen[0].seat;
    const expected = [...dealt[declarer], ...deck.slice(100, 108)].map(c => c.id).sort();
    expect(seen[0].ids).toEqual(expected);
  });
});
