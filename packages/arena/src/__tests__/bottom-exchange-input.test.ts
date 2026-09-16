import { describe, it, expect } from 'vitest';
import { engineStrategy } from '../strategies.js';
import { playMatch } from '../match.js';
import { deckForHand } from '../rng.js';
import type { Card } from '@poker/engine';
import type { Strategy } from '../types.js';

/** 分牌口径（与 match.ts 一致）：第 i 张发给 i % 4 号位。 */
function dealtHands(deck: Card[]): Card[][] {
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) hands[i % 4].push(deck[i]);
  return hands;
}

/**
 * 扣底决策的输入口径：庄家先拿进 8 张底牌（共 33 张），再从 33 张里扣 8 张。
 *
 * 这里锁的是「调用点喂了几张」这一层接线——引擎测试只验证函数在 33 张上的行为，
 * 而 4 个调用点曾长期只喂发到的 25 张（等价于先扣后拿），且没有任何测试断言过
 * 这条接线，所以 bug 藏了很久。
 */
describe('bottom exchange input (33 cards)', () => {
  it('AI 庄家扣底时拿到的是并入底牌后的 33 张', () => {
    const sizes: number[] = [];
    const spy: Strategy = {
      ...engineStrategy,
      chooseBottom: (hand, config) => {
        sizes.push(hand.length);
        // 张数不对时不去调引擎（入口会抛错），返回空扣底让 arena 走回退，
        // 断言失败信息停在这里的张数上。
        return hand.length === 33
          ? engineStrategy.chooseBottom(hand, config)
          : { keep: hand, discard: [], reason: 'spy' };
      },
    };

    // 多跑几对，保证 A 队（0/2 号位）确实当过庄：3 对 × 每对最多 4 局，
    // 其中 A 当庄 8 次（庄家赢则连庄，故不等于半数）。
    for (const pair of [0, 1, 2]) {
      playMatch({ seed: 42, pairIndex: pair, maxHands: 4, strategies: [spy, engineStrategy] });
    }

    expect(sizes.length).toBe(8);
    expect([...new Set(sizes)]).toEqual([33]);
  });

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
