import { describe, it, expect } from 'vitest';
import {
  ALL_LEVELS, DEFAULT_LEVELS, DEAL_FILTERS, availableFilterNames,
  parseLevels, passesDealFilters, resolveDealFilters,
} from '../solo-filter.js';

describe('parseLevels', () => {
  it('默认等级串 2,5,10,Q,K,A → [2,5,10,12,13,14]', () => {
    expect(parseLevels('2,5,10,Q,K,A')).toEqual([2, 5, 10, 12, 13, 14]);
  });

  it('DEFAULT_LEVELS 就是 2,5,10,Q,K,A', () => {
    expect([...DEFAULT_LEVELS]).toEqual([2, 5, 10, 12, 13, 14]);
  });

  it('all → 2..A 全 13 档（大小写均可）', () => {
    expect(parseLevels('all')).toEqual([...ALL_LEVELS]);
    expect(parseLevels('ALL')).toEqual([...ALL_LEVELS]);
    expect(parseLevels(' all ')).toEqual([...ALL_LEVELS]);
  });

  it('J/Q/K/A 大小写不敏感，且与数字同义', () => {
    expect(parseLevels('j,q,k,a')).toEqual([11, 12, 13, 14]);
    expect(parseLevels('11,12,13,14')).toEqual([11, 12, 13, 14]);
  });

  it('去重并升序', () => {
    expect(parseLevels('10,2,10,2')).toEqual([2, 10]);
    expect(parseLevels('A,2')).toEqual([2, 14]);
    expect(parseLevels('K,5,J')).toEqual([5, 11, 13]);
  });

  it('非法 token 报错并指出该 token', () => {
    expect(() => parseLevels('1')).toThrow(/1/);
    expect(() => parseLevels('15')).toThrow(/15/);
    expect(() => parseLevels('X')).toThrow(/X/);
    expect(() => parseLevels('2,Q,3')).not.toThrow();
    expect(() => parseLevels('2,,3')).toThrow(/空项/);
    expect(() => parseLevels('')).toThrow(/不能为空/);
  });
});

describe('发牌过滤器注册表（接口/管道）', () => {
  it('空列表恒通过', () => {
    expect(resolveDealFilters([])).toEqual([]);
    expect(passesDealFilters([], { hands: [], deck: [], level: 2 })).toBe(true);
  });

  it('未注册的名字报错，且报错文本点名该名字', () => {
    expect(() => resolveDealFilters(['no-such-filter-xyz'])).toThrow(/no-such-filter-xyz/);
  });

  it('注册一个过滤器后：解析通过、求值按 AND 组合', () => {
    DEAL_FILTERS.set('t-even-level', ctx => ctx.level % 2 === 0);
    try {
      expect(availableFilterNames()).toContain('t-even-level');
      expect(resolveDealFilters(['t-even-level'])).toEqual(['t-even-level']);
      expect(passesDealFilters(['t-even-level'], { hands: [], deck: [], level: 4 })).toBe(true);
      expect(passesDealFilters(['t-even-level'], { hands: [], deck: [], level: 5 })).toBe(false);
      // 未知名字的报错列出可用名字
      expect(() => resolveDealFilters(['nope'])).toThrow(/t-even-level/);
    } finally {
      DEAL_FILTERS.delete('t-even-level');
    }
  });
});
