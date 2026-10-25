import { describe, it, expect } from 'vitest';
import { createFullDeck } from '@poker/engine';
import { cardCode, DECK_SIZE } from '../record-types.js';
import {
  deckHashBigInt, deckHashFromCodes, deckHashHex, deriveBaseSeed, deriveChainSeed,
  deriveStreamSeed, drawDeck, normalizeSeedHex, randomBaseSeedHex, rngFromSeedHex,
  sfc32, shuffleInPlace, validateDeckCodes,
} from '../record-rng.js';

const templateCodes = (): number[] => createFullDeck().map(cardCode);

describe('seed 派生', () => {
  it('normalizeSeedHex：十进制 / 0x / bigint 归一为 16 位十六进制', () => {
    expect(normalizeSeedHex(42)).toBe('000000000000002a');
    expect(normalizeSeedHex('42')).toBe('000000000000002a');
    expect(normalizeSeedHex('0x2a')).toBe('000000000000002a');
    expect(normalizeSeedHex(42n)).toBe('000000000000002a');
    expect(normalizeSeedHex('0xffffffffffffffff')).toBe('ffffffffffffffff');
  });

  it('normalizeSeedHex：非法输入报错，不静默截断', () => {
    expect(() => normalizeSeedHex('abc')).toThrow(/十进制整数或 0x/);
    expect(() => normalizeSeedHex(-1)).toThrow(/64 位范围/);
    expect(() => normalizeSeedHex('0x10000000000000000')).toThrow(/64 位范围/);
    expect(() => normalizeSeedHex(1.5)).toThrow(/整数/);
  });

  it('deriveBaseSeed 确定、16 位十六进制；randomBaseSeedHex 也符合形状', () => {
    expect(deriveBaseSeed('record-v1|1|2|abc')).toBe(deriveBaseSeed('record-v1|1|2|abc'));
    expect(deriveBaseSeed('record-v1|1|2|abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(randomBaseSeedHex()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('chainSeed 按 chainId 分离，deck/context 两个域互不相同', () => {
    const base = '0123456789abcdef';
    const c0 = deriveChainSeed(base, 0);
    const c1 = deriveChainSeed(base, 1);
    expect(c0).toMatch(/^[0-9a-f]{16}$/);
    expect(c0).not.toBe(c1);
    const deck = deriveStreamSeed(c0, 0, 'deck');
    const context = deriveStreamSeed(c0, 0, 'context');
    expect(deck).not.toBe(context);
    expect(deck).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同 seed 同流、不同 seed 不同流，取值都在 [0,1)', () => {
    const a = rngFromSeedHex('00'.repeat(32));
    const b = rngFromSeedHex('00'.repeat(32));
    const c = rngFromSeedHex('01'.repeat(32));
    const av = Array.from({ length: 8 }, () => a());
    const bv = Array.from({ length: 8 }, () => b());
    const cv = Array.from({ length: 8 }, () => c());
    expect(av).toEqual(bv);
    expect(av).not.toEqual(cv);
    for (const v of [...av, ...cv]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rngFromSeedHex 拒绝不足 16 字节的 seed', () => {
    expect(() => rngFromSeedHex('00'.repeat(15))).toThrow(/至少 16 字节/);
  });
});

describe('发牌流', () => {
  it('shuffleInPlace 是排列（元素一个不多一个不少）', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    shuffleInPlace(arr, sfc32(1, 2, 3, 4));
    expect([...arr].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('同一 deck 流重放同一副牌；牌面是完整 108 张', () => {
    const seed = deriveStreamSeed('0123456789abcdef', 3, 'deck');
    const d1 = drawDeck(rngFromSeedHex(seed));
    const d2 = drawDeck(rngFromSeedHex(seed));
    expect(d1.map(c => c.id)).toEqual(d2.map(c => c.id));
    expect(d1).toHaveLength(DECK_SIZE);
    expect(new Set(d1.map(c => c.id)).size).toBe(DECK_SIZE);
    expect(d1.map(cardCode).sort((a, b) => a - b)).toEqual(templateCodes());
  });

  it('validateDeckCodes：合法排列通过，重复/越界/长度不符报错', () => {
    expect(() => validateDeckCodes(templateCodes())).not.toThrow();
    const dup = templateCodes();
    dup[0] = dup[1];
    expect(() => validateDeckCodes(dup)).toThrow(/重复 code/);
    const bad = templateCodes();
    bad[0] = 108;
    expect(() => validateDeckCodes(bad)).toThrow(/非法 code/);
    expect(() => validateDeckCodes(templateCodes().slice(0, 107))).toThrow(/长度/);
  });

  it('物理 deck hash 只由 code 序列决定，截 64 位', () => {
    const deck = drawDeck(rngFromSeedHex('ab'.repeat(32)));
    const hex = deckHashHex(deck);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
    expect(deckHashHex(deck)).toBe(hex);
    expect(deckHashFromCodes(deck.map(cardCode))).toBe(hex);
    expect(deckHashBigInt(hex)).toBe(BigInt(`0x${hex}`));

    const swapped = [...deck];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(deckHashHex(swapped)).not.toBe(hex);
  });
});
