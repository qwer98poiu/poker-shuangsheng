import { describe, it, expect } from 'vitest';
import { playedStackStrip, playedStackOverlap } from '../components/game/CenterArea.js';

// 约定：小牌宽 50px，露出条 clamp 到 [4, 18]；实测 1280 视口轨道宽 ~156px
describe('playedStackStrip — 打出牌叠放露出条（整叠完全可见）', () => {
  it('单张 → 不叠放（0）', () => {
    expect(playedStackStrip(1, 166)).toBe(0);
  });

  it('166px 轨道精确值：露出条 = floor((W-50)/(n-1))，clamp [4,18]', () => {
    expect(playedStackStrip(2, 166)).toBe(18);   // floor(116/1)=116 → 上限 18
    expect(playedStackStrip(5, 166)).toBe(18);   // floor(116/4)=29 → 上限 18
    expect(playedStackStrip(10, 166)).toBe(12);  // floor(116/9)=12
    expect(playedStackStrip(12, 166)).toBe(10);  // floor(116/11)=10
    expect(playedStackStrip(25, 166)).toBe(4);   // floor(116/24)=4
    expect(playedStackStrip(30, 166)).toBe(4);   // floor(116/29)=4 → 下限 4
  });

  it('甩 10 张 / 25 张手牌上限：整叠总宽 ≤ 轨道宽（无一张牌出框）', () => {
    expect(50 + 9 * playedStackStrip(10, 166)).toBe(158); // ≤ 166
    expect(50 + 24 * playedStackStrip(25, 166)).toBe(146); // ≤ 166
    expect(50 + 29 * playedStackStrip(30, 166)).toBe(166); // 恰好贴边
  });

  it('1280 视口实测轨道 156px：甩 10 张仍完全可见', () => {
    expect(playedStackStrip(10, 156)).toBe(11); // floor(106/9)=11
    expect(50 + 9 * 11).toBe(149);               // ≤ 156
  });

  it('窄容器贴边计算；超窄触发 minStrip 下限；超宽触发 maxStrip 上限', () => {
    expect(playedStackStrip(10, 100)).toBe(5);  // floor(50/9)=5
    expect(50 + 9 * 5).toBe(95);                 // ≤ 100
    expect(playedStackStrip(10, 60)).toBe(4);   // floor(10/9)=1 → 下限 4
    expect(playedStackStrip(2, 1000)).toBe(18); // 上限 18（与手牌露出比例相近）
    expect(playedStackStrip(10, 40)).toBe(4);   // available ≤ 0 → 下限 4
  });

  it('playedStackOverlap = 牌宽 - 露出条（负 margin 值）', () => {
    expect(playedStackOverlap(10, 166)).toBe(38);
    expect(playedStackOverlap(25, 166)).toBe(46);
    expect(playedStackOverlap(1, 166)).toBe(50); // 单张 margin 0
  });
});
