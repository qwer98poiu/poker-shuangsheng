/**
 * 录制数据集的确定性随机源。
 *
 * 约定（竞技场自 2026-10-28 起复用同一口径：pair k = 链 k）：
 * - 每条链一个顺序 PRNG 流，发牌与 context 抽样各用一个独立流；
 * - 不使用 `base + i`、不每手重置 seed、不调用 `hashMix` / `seededShuffle`；
 * - 同一个 chainSeed 永远重放出同一条牌的序列与同一条 context 序列。
 *
 * 派生（sha256-64-v1）：
 *   chainSeed    = sha256("record-v1|chain|<baseSeedHex>|<chainId>")[0,16)
 *   deckSeed     = sha256("record-v1|deck|<chainSeed>|<chainId>")
 *   contextSeed  = sha256("record-v1|context|<chainSeed>|<chainId>")
 * 流本身用 sfc32（128 位 state），取 seed 的前 16 字节拆成四个 uint32。
 */
import { createHash, randomBytes } from 'node:crypto';
import { createFullDeck } from '@poker/engine';
import type { Card } from '@poker/engine';
import { DECK_SIZE, cardCode } from './record-types.js';

export type Rng = () => number;

export type SeedDomain = 'deck' | 'context';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 默认 base seed：时间戳 + pid + 8 字节随机，再 sha256 截 64 位。 */
export function randomBaseSeedHex(): string {
  const raw = `record-v1|${Date.now()}|${process.pid}|${randomBytes(8).toString('hex')}`;
  return deriveBaseSeed(raw);
}

export function deriveBaseSeed(raw: string): string {
  return sha256Hex(raw).slice(0, 16);
}

/**
 * CLI seed → 16 位十六进制。数字按无符号 64 位解释；十进制字符串与 `0x` 十六进制
 * 都接受，越界即报错（不做静默截断）。
 */
export function normalizeSeedHex(input: bigint | number | string): string {
  let value: bigint;
  if (typeof input === 'bigint') {
    value = input;
  } else if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) throw new Error(`seed 必须是安全整数: ${input}`);
    value = BigInt(input);
  } else {
    const s = input.trim();
    if (/^0x[0-9a-f]+$/i.test(s)) value = BigInt(s);
    else if (/^\d+$/.test(s)) value = BigInt(s);
    else throw new Error(`seed 必须是十进制整数或 0x 十六进制: ${input}`);
  }
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`seed 超出无符号 64 位范围: ${input}`);
  }
  return value.toString(16).padStart(16, '0');
}

export function deriveChainSeed(baseSeedHex: string, chainId: number): string {
  return sha256Hex(`record-v1|chain|${baseSeedHex}|${chainId}`).slice(0, 16);
}

/** deck / context 两个域必须分离：同一 chainSeed 下得到的流互不相同。 */
export function deriveStreamSeed(chainSeedHex: string, chainId: number, domain: SeedDomain): string {
  return sha256Hex(`record-v1|${domain}|${chainSeedHex}|${chainId}`);
}

/** sfc32 — 128 位 state 的顺序 PRNG，返回 [0, 1)。 */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** 从 sha256（至少 16 字节）的十六进制取前 16 字节作为四个 uint32 state。 */
export function rngFromSeedHex(seedHex: string): Rng {
  if (!/^[0-9a-f]{32,}$/i.test(seedHex)) {
    throw new Error(`seed 十六进制无效（至少 16 字节）: ${seedHex}`);
  }
  const buf = Buffer.from(seedHex.slice(0, 32), 'hex');
  return sfc32(buf.readUInt32LE(0), buf.readUInt32LE(4), buf.readUInt32LE(8), buf.readUInt32LE(12));
}

/** Fisher–Yates，原地打乱；调用方负责每手传入新数组。 */
export function shuffleInPlace<T>(arr: T[], rand: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** 从顺序发牌流抽下一副：复制模板后 Fisher–Yates。 */
export function drawDeck(rand: Rng): Card[] {
  return shuffleInPlace(createFullDeck(), rand);
}

function deckHashFromBytes(codes: Uint8Array): string {
  return createHash('sha256').update(codes).digest('hex').slice(0, 16);
}

/** 物理 deck hash：按 108 个 card code 的 SHA-256 截 64 位（十六进制）。 */
export function deckHashHex(deck: readonly Card[]): string {
  const codes = new Uint8Array(deck.length);
  for (let i = 0; i < deck.length; i++) codes[i] = cardCode(deck[i]);
  return deckHashFromBytes(codes);
}

/** 记录里已经是 code，重算 hash 时不再回查卡片对象。 */
export function deckHashFromCodes(codes: readonly number[]): string {
  const bytes = new Uint8Array(codes.length);
  for (let i = 0; i < codes.length; i++) bytes[i] = codes[i];
  return deckHashFromBytes(bytes);
}

export function deckHashBigInt(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

/**
 * 校验一副 deck 是 `createFullDeck()` 的排列：长度 108、code 0..107 各一次。
 * 生产路径不必每手调用（deck 由模板打乱而来），测试与 reader 重建时使用。
 */
export function validateDeckCodes(codes: readonly number[]): void {
  if (codes.length !== DECK_SIZE) {
    throw new Error(`deck 长度应为 ${DECK_SIZE}，实际 ${codes.length}`);
  }
  const seen = new Uint8Array(DECK_SIZE);
  for (const code of codes) {
    if (!Number.isInteger(code) || code < 0 || code >= DECK_SIZE) {
      throw new Error(`deck 含非法 code: ${code}`);
    }
    if (seen[code] !== 0) throw new Error(`deck 含重复 code: ${code}`);
    seen[code] = 1;
  }
}
