import { describe, expect, it, vi } from 'vitest';
import { applyDragSelection, isCardCoveredByDrag } from './PlayerHand.js';

/**
 * 拖拽框选判定：轨迹矩形是否与本牌"可见（露出）区域"相交。
 * 手牌重叠摆放：下一张 marginLeft -34px 盖住本张右侧 34px →
 * 非最后一张只露出左侧，最后一张全露。
 * （x1<=x2、y1<=y2，调用方已归一化）
 */
const rect = { left: 100, right: 170, top: 200, bottom: 290 }; // 牌宽 70

describe('isCardCoveredByDrag 拖拽框选判定', () => {
  it('非最后一张：轨迹覆盖左侧露出部分 → 选中', () => {
    expect(isCardCoveredByDrag(105, 210, 125, 240, rect, false)).toBe(true);
  });
  it('非最后一张：轨迹只覆盖右侧被盖部分（被下一张盖住）→ 不选中', () => {
    expect(isCardCoveredByDrag(150, 210, 165, 240, rect, false)).toBe(false);
  });
  it('非最后一张：轨迹横跨整张牌（触及露出部分）→ 选中', () => {
    expect(isCardCoveredByDrag(105, 210, 165, 240, rect, false)).toBe(true);
  });
  it('非最后一张：轨迹覆盖露出区右缘附近（x1=130, x2=140 未越过可见右缘 136）→ 选中', () => {
    expect(isCardCoveredByDrag(130, 210, 140, 240, rect, false)).toBe(true);
  });
  it('非最后一张：轨迹完全在被盖区（x1=137 越过可见右缘 136）→ 不选中', () => {
    expect(isCardCoveredByDrag(137, 210, 165, 240, rect, false)).toBe(false);
  });
  it('最后一张（全露）：轨迹只覆盖左侧 1px → 选中', () => {
    expect(isCardCoveredByDrag(100, 210, 105, 240, rect, true)).toBe(true);
  });
  it('最后一张（全露）：轨迹只覆盖右侧 → 选中', () => {
    expect(isCardCoveredByDrag(150, 210, 165, 240, rect, true)).toBe(true);
  });
  it('最后一张（全露）：轨迹横跨整张牌 → 选中', () => {
    expect(isCardCoveredByDrag(105, 210, 165, 240, rect, true)).toBe(true);
  });
  it('轨迹完全在牌左侧 → 不选中', () => {
    expect(isCardCoveredByDrag(50, 210, 80, 240, rect, false)).toBe(false);
  });
  it('轨迹完全在牌右侧 → 不选中', () => {
    expect(isCardCoveredByDrag(180, 210, 200, 240, rect, false)).toBe(false);
  });
  it('轨迹完全在牌上方 → 不选中', () => {
    expect(isCardCoveredByDrag(105, 150, 125, 180, rect, false)).toBe(false);
  });
  it('轨迹完全在牌下方 → 不选中', () => {
    expect(isCardCoveredByDrag(105, 310, 125, 330, rect, false)).toBe(false);
  });
});

describe('applyDragSelection 拖拽反选（XOR 语义）', () => {
  const run = (initial: string[], covered: string[], current: string[]) => {
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    const next = applyDragSelection(new Set(initial), new Set(covered), new Set(current), onSelect, onDeselect);
    return { next: [...next].sort(), onSelect, onDeselect };
  };

  it('初始未选、覆盖 A → A 选中', () => {
    const { next, onSelect, onDeselect } = run([], ['A'], []);
    expect(next).toEqual(['A']);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('A');
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('初始已选 {A,B}、覆盖 {B,C} → B 放下、C 选中、A 保持', () => {
    const { next, onSelect, onDeselect } = run(['A', 'B'], ['B', 'C'], ['A', 'B']);
    expect(next).toEqual(['A', 'C']);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('C');
    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(onDeselect).toHaveBeenCalledWith('B');
  });

  it('初始已选 {A,B}、覆盖 {A,B} → 全部放下', () => {
    const { next, onDeselect } = run(['A', 'B'], ['A', 'B'], ['A', 'B']);
    expect(next).toEqual([]);
    expect(onDeselect).toHaveBeenCalledTimes(2);
  });

  it('初始已选 {A}、覆盖 ∅ → 无任何操作', () => {
    const { next, onSelect, onDeselect } = run(['A'], [], ['A']);
    expect(next).toEqual(['A']);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('幂等：current 已等于期望（拖拽中第二次 mousemove）→ 不重复回调', () => {
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    // 第一帧：初始 {A}、覆盖 {B} → B 选中
    const s1 = applyDragSelection(new Set(['A']), new Set(['B']), new Set(['A']), onSelect, onDeselect);
    // 第二帧：same 覆盖（current 已含 B）→ 无回调
    const s2 = applyDragSelection(new Set(['A']), new Set(['B']), s1, onSelect, onDeselect);
    expect([...s2].sort()).toEqual(['A', 'B']);
    expect(onSelect).toHaveBeenCalledTimes(1); // 仅第一帧
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('初始未选 {A} 覆盖 {A} 且 current 已含 A（拖拽前点击选中过）→ A 放下', () => {
    const { next, onDeselect } = run(['A'], ['A'], ['A']);
    expect(next).toEqual([]);
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });
});
