import { describe, it, expect } from 'vitest';
import { deckForHand } from '../rng.js';
import { playHand, naturalDeclaration } from '../match.js';
import { hasJokerPairDeal } from '../nt-arena.js';
import { engineStrategy, ai0929Strategy } from '../strategies.js';

/**
 * `naturalDeclaration` 只是把 playHand 的「发牌 + 亮主」块抽出来重放，供发牌过滤器
 * 在出牌前取该副的主牌。这里用差分测试钉住「两者一致」——重构一旦让它与 playHand
 * 分叉，过滤器就会静默地按错误的主牌分类。
 */
describe('naturalDeclaration 与 playHand 的亮主一致', () => {
  const strategies: [typeof engineStrategy, typeof ai0929Strategy] = [engineStrategy, ai0929Strategy];

  it('逐副一致：trumpSuit 与 declarerIdx 相同（4 个等级 × 30 副）', () => {
    for (const level of [2, 5, 10, 14]) {
      for (let k = 0; k < 30; k++) {
        const deck = deckForHand(11, 0, k);
        const decl = naturalDeclaration(deck, 0, level, false, strategies);
        const ev = playHand({
          deck, handIndex: level, declarerIdx: 0, level, attackerLevel: level,
          isFirstHand: false, strategies,
        });
        expect(decl.trumpSuit).toBe(ev.trumpSuit);
        expect(decl.declarerIndex).toBe(ev.declarerIdx);
        expect(decl.level).toBe(level);
      }
    }
  });

  it('有对王的发牌 → 无主（trumpSuit null）', () => {
    let checked = 0;
    for (let k = 0; k < 200 && checked === 0; k++) {
      const deck = deckForHand(11, 0, k);
      if (!hasJokerPairDeal(deck)) continue;
      checked += 1;
      const decl = naturalDeclaration(deck, 0, 2, false, strategies);
      expect(decl.trumpSuit).toBeNull();
    }
    expect(checked).toBe(1); // 区间内确有对王发牌，断言才不是空转
  });
});
