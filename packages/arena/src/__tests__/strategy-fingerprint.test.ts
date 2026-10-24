import { describe, it, expect } from 'vitest';
import { createFullDeck, seededShuffle } from '@poker/engine';
import { engineStrategy } from '../strategies.js';
import { runPairs } from '../run-pairs.js';
import { playHand, playMatch } from '../match.js';
import { checkSignificance } from '../significance.js';
import type { Strategy } from '../types.js';

/**
 * AI 策略指纹（end-to-end）。
 *
 * 这三项数值都由当前 `packages/engine/src/ai/` 的行为决定，**正常的策略迭代都会改变
 * 它们**。集中在一个文件里，是为了让「策略每改一次要跟着改的测试」只有一个落点：
 * 改策略时同步更新本文件，并在提交信息与 Changelog 的测试数行写
 * 「修改 3 项测试（arena 3）」——check-commits 的 T8 会校验被修改的测试是否已声明。
 *
 * 与策略无关的契约（牌型、验牌、store 不变量等）不放这里，别让它们跟着策略一起改。
 */
describe('AI 策略指纹', () => {
  it('镜像对决（seed 42，20 对，A==A）', () => {
    const { statsA, statsB } = runPairs(42, 0, 20, engineStrategy, engineStrategy);
    expect(statsA.matches.played).toBe(40);
    expect(statsA.matches.won).toBe(20);
    expect(statsA.matches.drawn).toBe(0);
    expect(statsB.matches.played).toBe(40);
    expect(statsB.matches.won).toBe(20);
    expect(statsB.matches.drawn).toBe(0);
    // 镜像对称：双方各胜 20 场，胜时对方平均等级 205/20 = 10.25（A=14）
    // 2026-08-06 新增镜像对决指纹后为 224
    // 2026-08-08 第三家不能毙时不出主分单张后为 214
    // 2026-08-08 第四家不盖队友（先加分、否则最小牌）后为 221
    // 2026-08-09 NT 垫牌先丢级牌再丢王后为 206
    // 2026-08-15 第三/四家加分垫牌优先断门（整门一次甩出）后为 210
    // 2026-08-15 亮主规则禁止自反、同花色可自保后为 229
    // 2026-08-16 第四家单张吊主跟牌改判后为 210
    // 2026-08-23 亮主后同步实际庄家后为 221
    // 2026-08-30 第三家不能毙时垫牌避分后为 223
    // 2026-09-07 扣底策略重构（tier 控制张 + 留控扣绝 + 填充梯）后为 234
    // 2026-09-16 AI 庄家扣底改为 33 张口径后为 203
    // 2026-09-26 毙单张按档位选牌后为 207
    // 2026-09-27 第四家不抢无分墩（含 NT 推广）后为 211
    // 2026-09-27 出副对清对（优先级 0）后为 226
    // 2026-09-29 NT 记牌器对子扣减按领出是否含对判定后为 217
    // 2026-10-02 无主两项新规与「整门已绝」判据放宽后为 219
    // 2026-10-05 无主长花色层与第三家甩牌加分改判后为 203
    // 2026-10-12 领出优先级 0a 放宽（3→2 张、不查能否毙）后为 221
    // 2026-10-18 0b 放宽到一对、第三家跟队友 0b 只看第二/四家且不盖队友后为 208
    // 2026-10-18 领出阶梯按队分叉（庄 1/1.5/2/3/4、闲 1/2/3、通用 5–12 重写）后为 188
    // 2026-10-24 庄4.5 主拖拉机先于通用 5 领出后为 187
    // 2026-10-24 无主非分等级吊主延后到通用 9 后为 205
    expect(statsA.matches.oppLevel).toEqual({ n: 205, d: 20 });
    expect(statsB.matches.oppLevel).toEqual({ n: 205, d: 20 });
    expect(statsA.handsPlayed).toBe(statsB.handsPlayed);
    expect(statsA.abortedHands).toBe(0);
    const sig = checkSignificance(statsA.matches.won, statsB.matches.won, statsA.matches.drawn, statsA.matches.played);
    expect(sig.significant).toBe(false);
    expect(sig.pHat).toBe(0.5);
  });

  it('AI 庄家扣底调用（seed 42，pair 0–2）', () => {
    // 锁两件事：A 队在这三个 pair 里实际扣底 7 次（策略指纹），且每次拿到的都是
    // 并入底牌后的 33 张（接线契约；内容逐张相符由 bottom-exchange-input.test.ts 覆盖）。
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

    // 3 对 × 每对最多 4 局；庄家赢则连庄，故次数不等于半数。
    // 2026-09-16 新增扣底输入指纹后为 8
    // 2026-10-18 领出阶梯按队分叉后为 6
    // 2026-10-24 无主非分等级吊主延后到通用 9 后为 7
    for (const pair of [0, 1, 2]) {
      playMatch({ seed: 42, pairIndex: pair, maxHands: 4, strategies: [spy, engineStrategy] });
    }

    expect(sizes.length).toBe(7);
    expect([...new Set(sizes)]).toEqual([33]);
  });

  it('client GUI 种子局（seed 42，首局）', () => {
    // client 首局按 seededShuffle(createFullDeck(), seedFor(seed, 0)) 发牌，
    // seedFor(42, 0) = 42；预定庄家 P0、等级 2。用同一副牌在 arena 重放，
    // 锁 client 种子局的原始闲家分与墩数（client store 只保留不变量断言）。
    const deck = seededShuffle(createFullDeck(), 42);
    const ev = playHand({
      deck,
      handIndex: 0,
      declarerIdx: 0,
      level: 2,
      attackerLevel: 2,
      isFirstHand: true,
      strategies: [engineStrategy, engineStrategy],
    });
    expect(ev.settled).toBe(false);
    // finalPts 含抠底 10 分；client store 的 attackerPoints 是原始分（不含抠底）。
    // 2026-08-08 新增 client 种子局指纹后为 145 分 / 17 墩
    // 2026-09-07 扣底策略重构后为 135 分 / 17 墩
    // 2026-09-16 AI 庄家扣底改为 33 张口径后为 140 分 / 17 墩
    // 2026-10-18 领出阶梯按队分叉后为 115 分 / 16 墩
    // 2026-10-24 无主非分等级吊主延后到通用 9 后为 105 分 / 15 墩
    expect(ev.finalPts - ev.kouDiAdd).toBe(105);
    expect(ev.tricksPlayed).toBe(15);
  });
});
