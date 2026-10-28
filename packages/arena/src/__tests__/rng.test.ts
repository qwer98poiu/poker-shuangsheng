import { describe, it, expect } from 'vitest';
import { deckForHand, deckStream, normalizeSeed, randomSeed } from '../rng.js';
import { deriveChainSeed, deriveStreamSeed, drawDeck, rngFromSeedHex } from '../record-rng.js';

describe('seed 规范化', () => {
  it('数字 / 十进制 / 0x 十六进制 → 同一个 0x 规范形式', () => {
    expect(normalizeSeed(42)).toBe('0x000000000000002a');
    expect(normalizeSeed('42')).toBe('0x000000000000002a');
    expect(normalizeSeed('0x2a')).toBe('0x000000000000002a');
    expect(normalizeSeed(0xffffffffffffffffn)).toBe('0xffffffffffffffff');
  });

  it('超出无符号 64 位即报错（不静默截断）', () => {
    expect(() => normalizeSeed('0x10000000000000000')).toThrow();
    expect(() => normalizeSeed(-1)).toThrow();
  });

  it('randomSeed 返回 0x + 16 位十六进制', () => {
    expect(randomSeed()).toMatch(/^0x[0-9a-f]{16}$/);
  });
});

describe('deckStream / deckForHand', () => {
  it('同 seed（不同写法）同链 → 相同牌序序列', () => {
    const a = deckStream(42, 0);
    const b = deckStream('0x000000000000002a', 0);
    const decksA = Array.from({ length: 3 }, () => a().map(c => c.id));
    const decksB = Array.from({ length: 3 }, () => b().map(c => c.id));
    expect(decksA).toEqual(decksB);
    expect(decksA[0]).toEqual(deckForHand(42, 0, 0).map(c => c.id));
    expect(decksA[2]).toEqual(deckForHand(42, 0, 2).map(c => c.id));
  });

  it('64 位 seed：只差高 32 位的两个 seed 产出不同 deck', () => {
    expect(deckForHand(42, 0, 0).map(c => c.id))
      .not.toEqual(deckForHand(42 + 2 ** 32, 0, 0).map(c => c.id));
  });

  it('与记录器链口径逐手一致：链 k、第 i 手 == 记录器链 k 的 deck 流第 i 次抽取', () => {
    const seed = '0x0123456789abcdef';
    const chainId = 3;
    const chainSeed = deriveChainSeed('0123456789abcdef', chainId);
    const rand = rngFromSeedHex(deriveStreamSeed(chainSeed, chainId, 'deck'));
    const expected = Array.from({ length: 3 }, () => drawDeck(rand).map(c => c.id));
    for (let i = 0; i < expected.length; i++) {
      expect(deckForHand(seed, chainId, i).map(c => c.id)).toEqual(expected[i]);
    }
  });

  it('参考值固定：deck(42,0,0) 首牌 S-5-3', () => {
    expect(deckForHand(42, 0, 0)[0].id).toBe('S-5-3');
  });

  it('镜像契约：同参两次 → 相同牌序（对决内两场第 i 局同牌）', () => {
    const d1 = deckForHand(42, 0, 0);
    const d2 = deckForHand(42, 0, 0);
    expect(d1.map(c => c.id)).toEqual(d2.map(c => c.id));
    expect(d1.length).toBe(108);
  });

  it('不同 handIndex / pairIndex / seed → 不同牌序', () => {
    expect(deckForHand(42, 3, 0).map(c => c.id)).not.toEqual(deckForHand(42, 3, 1).map(c => c.id));
    expect(deckForHand(42, 0, 0).map(c => c.id)).not.toEqual(deckForHand(42, 1, 0).map(c => c.id));
    expect(deckForHand(42, 0, 0).map(c => c.id)).not.toEqual(deckForHand(43, 0, 0).map(c => c.id));
  });

  it('handIndex 必须是非负整数', () => {
    expect(() => deckForHand(42, 0, -1)).toThrow();
    expect(() => deckForHand(42, 0, 1.5)).toThrow();
  });
});
