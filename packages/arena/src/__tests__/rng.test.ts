import { describe, it, expect } from 'vitest';
import { hashMix, deckForHand } from '../rng.js';

describe('hashMix', () => {
  it('确定性：同参两次 → 相同 32 位值', () => {
    expect(hashMix(42, 0, 0)).toBe(2005763341);
    expect(hashMix(42, 0, 0)).toBe(hashMix(42, 0, 0));
  });

  it('参考值固定：(42,3,7)=4061631664, (42,3,8)=1893931777', () => {
    expect(hashMix(42, 3, 7)).toBe(4061631664);
    expect(hashMix(42, 3, 8)).toBe(1893931777);
  });

  it('相邻 handIndex / pairIndex / seed 产生不同值', () => {
    expect(hashMix(42, 3, 7)).not.toBe(hashMix(42, 3, 8));
    expect(hashMix(42, 3, 7)).not.toBe(hashMix(42, 4, 7));
    expect(hashMix(42, 0, 0)).not.toBe(hashMix(1, 0, 0));
  });
});

describe('deckForHand', () => {
  it('同参两次 → 相同牌序（镜像契约：对决内两场第 i 局同牌）', () => {
    const d1 = deckForHand(42, 0, 0);
    const d2 = deckForHand(42, 0, 0);
    expect(d1.map(c => c.id)).toEqual(d2.map(c => c.id));
    expect(d1.length).toBe(108);
  });

  it('参考值固定：deck(42,0,0) 首牌 C-11-35', () => {
    expect(deckForHand(42, 0, 0)[0].id).toBe('C-11-35');
  });

  it('不同 handIndex → 不同牌序', () => {
    expect(deckForHand(42, 3, 0).map(c => c.id)).not.toEqual(deckForHand(42, 3, 1).map(c => c.id));
  });

  it('不同 pair → 不同牌序（跨对决独立）', () => {
    expect(deckForHand(42, 0, 0).map(c => c.id)).not.toEqual(deckForHand(42, 1, 0).map(c => c.id));
  });
});
