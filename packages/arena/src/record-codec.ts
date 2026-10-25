/**
 * 录制数据集的二进制 codec 与读取器。
 *
 * 布局（全部小端）：
 *   .bin = header(28) + N × [u32 recordLength + payload] + footer(12)
 *   .idx = header(16) + N × entry(28) + footer(12)
 *
 * payload 前部就是 context 字段（global/chain index、block、cell、level、declarer、
 * trumpCode、flags），所以 `.idx` 缺失或未写完时可以只凭 `.bin` 的长度前缀重建索引。
 * 文件格式细节见 `record-format.md`。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BIN_FOOTER_MAGIC, BIN_FOOTER_SIZE, BIN_HEADER_SIZE, DEALT_CARDS, DECK_SIZE,
  FLAG_HAS_ATTACKER_LEVEL, FLAG_HAS_LAP, FORMAT_VERSION, IDX_FOOTER_MAGIC, IDX_FOOTER_SIZE,
  IDX_HEADER_SIZE, INDEX_ENTRY_SIZE, INDEX_MAGIC, MAX_REVEALS, RECORD_MAGIC,
} from './record-types.js';
import type {
  HandRecord, IndexEntry, Manifest, RevealRecord, TrickRecord,
} from './record-types.js';
import { deckHashBigInt, deckHashFromCodes } from './record-rng.js';

// ---- 范围校验 ----

function checkInt(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`录制字段 ${name} 越界: ${value}（应在 ${min}..${max}）`);
  }
  return value;
}

const u8 = (name: string, v: number): number => checkInt(name, v, 0, 0xff);
const u16 = (name: string, v: number): number => checkInt(name, v, 0, 0xffff);
const u32 = (name: string, v: number): number => checkInt(name, v, 0, 0xffffffff);
const i16 = (name: string, v: number): number => checkInt(name, v, -0x8000, 0x7fff);

// ---- record ----

function trickPayloadSize(t: TrickRecord): number {
  return 8 + t.cards.length; // lead + counts + cards + winner + points
}

function failedThrowPayloadSize(f: HandRecord['failedThrows'][number]): number {
  return 4 + f.cards.length; // trickIndex + player + penaltyDelta + cardCount + cards
}

/** 不含长度前缀的 payload 字节数。 */
export function recordPayloadSize(r: HandRecord): number {
  let n = 164 + 2 * r.reveals.length;
  for (const t of r.tricks) n += trickPayloadSize(t);
  for (const f of r.failedThrows) n += failedThrowPayloadSize(f);
  return n;
}

export function encodeRecordPayload(r: HandRecord): Buffer {
  const payload = Buffer.allocUnsafe(recordPayloadSize(r));
  let o = 0;

  payload.writeUInt32LE(u32('globalHandIndex', r.globalHandIndex), o); o += 4;
  payload.writeUInt32LE(u32('chainHandIndex', r.chainHandIndex), o); o += 4;
  payload.writeUInt32LE(u32('blockIndex', r.blockIndex), o); o += 4;

  payload[o++] = u8('cellIndex', r.cellIndex);
  payload[o++] = u8('level', r.level);
  payload[o++] = u8('declarer', r.declarer);
  payload[o++] = u8('attackerLevel', r.attackerLevel);
  payload[o++] = u8('trumpCode', r.trumpCode);
  payload[o++] = u8('flags', r.flags);

  payload.writeUInt32LE(u32('lapA', r.lapA), o); o += 4;
  payload.writeUInt32LE(u32('lapB', r.lapB), o); o += 4;

  payload[o++] = u8('levelAfterA', r.levelAfterA);
  payload[o++] = u8('levelAfterB', r.levelAfterB);
  payload[o++] = u8('nextDeclarer', r.nextDeclarer);

  if (r.deck.length !== DECK_SIZE) throw new Error(`deck 长度应为 ${DECK_SIZE}，实际 ${r.deck.length}`);
  for (let i = 0; i < DECK_SIZE; i++) payload[o++] = u8('deck', r.deck[i]);
  if (r.bottom.length !== 8) throw new Error(`bottom 长度应为 8，实际 ${r.bottom.length}`);
  for (let i = 0; i < 8; i++) payload[o++] = u8('bottom', r.bottom[i]);

  payload.writeUInt16LE(u16('revealCount', r.reveals.length), o); o += 2;
  if (r.reveals.length > MAX_REVEALS) {
    throw new Error(`revealCount 超过上限 ${MAX_REVEALS}: ${r.reveals.length}`);
  }
  for (const rev of r.reveals) {
    const player = u8('reveal.player', rev.player);
    if (player > 3) throw new Error(`reveal.player 越界: ${player}`);
    const suitCode = rev.suit === null ? 7 : u8('reveal.suit', rev.suit);
    if (rev.suit !== null && suitCode > 3) throw new Error(`reveal.suit 越界: ${rev.suit}`);
    const strength = u8('reveal.strength', rev.strength);
    if (strength < 1 || strength > 4) throw new Error(`reveal.strength 越界: ${strength}`);
    payload[o++] = player | (suitCode << 2) | ((strength - 1) << 5);
    payload[o++] = checkInt('reveal.dealIndex', rev.dealIndex, 0, 99);
  }

  payload[o++] = u8('trickCount', r.tricks.length);
  for (const t of r.tricks) {
    payload[o++] = u8('trick.lead', t.lead);
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const c = u8('trick.count', t.counts[i]);
      payload[o++] = c;
      total += c;
    }
    if (total !== t.cards.length) {
      throw new Error(`trick cards 数 ${t.cards.length} 与 counts 之和 ${total} 不一致`);
    }
    for (const card of t.cards) payload[o++] = u8('trick.card', card);
    payload[o++] = u8('trick.winner', t.winner);
    payload.writeUInt16LE(u16('trick.points', t.points), o); o += 2;
  }

  payload.writeInt16LE(i16('attackerPoints', r.attackerPoints), o); o += 2;
  payload.writeUInt32LE(u32('finalPts', r.finalPts), o); o += 4;
  payload[o++] = u8('bottomPoints', r.bottomPoints);
  payload.writeUInt16LE(u16('bottomMultiplier', r.bottomMultiplier), o); o += 2;
  payload.writeUInt32LE(u32('kouDiAdd', r.kouDiAdd), o); o += 4;
  payload[o++] = u8('throwPenaltyA', r.throwPenalties[0]);
  payload[o++] = u8('throwPenaltyB', r.throwPenalties[1]);

  if (r.failedThrows.length > 0xff) throw new Error(`failedThrowCount 越界: ${r.failedThrows.length}`);
  payload[o++] = r.failedThrows.length;
  for (const f of r.failedThrows) {
    payload[o++] = checkInt('failedThrow.trickIndex', f.trickIndex, 0, 0xff);
    payload[o++] = checkInt('failedThrow.player', f.player, 0, 3);
    payload[o++] = checkInt('failedThrow.penaltyDelta', f.penaltyDelta, -128, 127);
    if (f.cards.length > 0xff) throw new Error(`failedThrow.cards 越界: ${f.cards.length}`);
    payload[o++] = f.cards.length;
    for (const card of f.cards) payload[o++] = u8('failedThrow.card', card);
  }

  if (o !== payload.length) throw new Error(`record payload 长度不符: 写入 ${o}，分配 ${payload.length}`);
  return payload;
}

/** 一手完整记录：`u32 payload 长度` + payload。 */
export function encodeRecord(r: HandRecord): Buffer {
  const payload = encodeRecordPayload(r);
  const out = Buffer.allocUnsafe(4 + payload.length);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

export function decodeRecordPayload(payload: Buffer): HandRecord {
  let o = 0;
  const need = (n: number): void => {
    if (o + n > payload.length) throw new Error(`record payload 截断：需要 ${n} 字节，剩余 ${payload.length - o}`);
  };
  const takeU8 = (): number => { need(1); return payload[o++]; };
  const takeU16 = (): number => { need(2); const v = payload.readUInt16LE(o); o += 2; return v; };
  const takeU32 = (): number => { need(4); const v = payload.readUInt32LE(o); o += 4; return v; };

  const globalHandIndex = takeU32();
  const chainHandIndex = takeU32();
  const blockIndex = takeU32();
  const cellIndex = takeU8();
  const level = takeU8();
  const declarer = takeU8();
  const attackerLevel = takeU8();
  const trumpCode = takeU8();
  const flags = takeU8();
  const lapA = takeU32();
  const lapB = takeU32();
  const levelAfterA = takeU8();
  const levelAfterB = takeU8();
  const nextDeclarer = takeU8();

  const deck: number[] = new Array(DECK_SIZE);
  for (let i = 0; i < DECK_SIZE; i++) deck[i] = takeU8();
  const bottom: number[] = new Array(8);
  for (let i = 0; i < 8; i++) bottom[i] = takeU8();

  const revealCount = takeU16();
  if (revealCount > MAX_REVEALS) throw new Error(`revealCount 越界: ${revealCount}`);
  const reveals: RevealRecord[] = [];
  for (let i = 0; i < revealCount; i++) {
    const packed = takeU8();
    if ((packed & 0x80) !== 0) throw new Error(`reveal packed 保留位非零: ${packed}`);
    const suitCode = (packed >> 2) & 0x7;
    const strength = ((packed >> 5) & 0x3) + 1;
    if (suitCode > 3 && suitCode !== 7) throw new Error(`reveal.suit code 非法: ${suitCode}`);
    const dealIndex = takeU8();
    if (dealIndex > 99) throw new Error(`reveal.dealIndex 越界: ${dealIndex}`);
    reveals.push({ player: packed & 0x3, suit: suitCode === 7 ? null : suitCode, strength, dealIndex });
  }

  const trickCount = takeU8();
  const tricks: TrickRecord[] = [];
  for (let i = 0; i < trickCount; i++) {
    const lead = takeU8();
    const counts = [takeU8(), takeU8(), takeU8(), takeU8()] as [number, number, number, number];
    const total = counts[0] + counts[1] + counts[2] + counts[3];
    const cards: number[] = new Array(total);
    for (let j = 0; j < total; j++) cards[j] = takeU8();
    const winner = takeU8();
    const points = takeU16();
    tricks.push({ lead, counts, cards, winner, points });
  }

  need(2);
  const attackerPoints = payload.readInt16LE(o); o += 2;
  const finalPts = takeU32();
  const bottomPoints = takeU8();
  const bottomMultiplier = takeU16();
  const kouDiAdd = takeU32();
  const throwPenalties: [number, number] = [takeU8(), takeU8()];
  const failedThrowCount = takeU8();
  const failedThrows: HandRecord['failedThrows'] = [];
  for (let i = 0; i < failedThrowCount; i++) {
    need(4);
    const trickIndex = takeU8();
    const player = takeU8();
    const penaltyDelta = payload.readInt8(o); o += 1;
    const cardCount = takeU8();
    const cards: number[] = new Array(cardCount);
    for (let j = 0; j < cardCount; j++) cards[j] = takeU8();
    failedThrows.push({ trickIndex, player, penaltyDelta, cards });
  }

  if (o !== payload.length) throw new Error(`record payload 有多余字节: 读 ${o} / 共 ${payload.length}`);

  return {
    globalHandIndex, chainHandIndex, blockIndex, cellIndex, level, declarer,
    attackerLevel, trumpCode, flags, lapA, lapB, levelAfterA, levelAfterB, nextDeclarer,
    deck, bottom, reveals, failedThrows, tricks, attackerPoints, finalPts, bottomPoints,
    bottomMultiplier, kouDiAdd, throwPenalties,
  };
}

// ---- header / footer ----

export interface BinHeader {
  formatVersion: number;
  flags: number;
  chainId: number;
  shardIndex: number;
  startHandIndex: number;
  chainSeed: bigint;
}

export function encodeBinHeader(h: BinHeader): Buffer {
  const b = Buffer.allocUnsafe(BIN_HEADER_SIZE);
  b.write(RECORD_MAGIC, 0, 'ascii');
  b.writeUInt16LE(u16('formatVersion', h.formatVersion), 4);
  b.writeUInt16LE(u16('flags', h.flags), 6);
  b.writeUInt16LE(u16('chainId', h.chainId), 8);
  b.writeUInt16LE(0, 10); // reserved
  b.writeUInt32LE(u32('shardIndex', h.shardIndex), 12);
  b.writeUInt32LE(u32('startHandIndex', h.startHandIndex), 16);
  b.writeBigUInt64LE(h.chainSeed, 20);
  return b;
}

export function decodeBinHeader(buf: Buffer): BinHeader {
  if (buf.length < BIN_HEADER_SIZE) throw new Error(`.bin header 截断: ${buf.length}`);
  if (buf.toString('ascii', 0, 4) !== RECORD_MAGIC) throw new Error('.bin magic 不符');
  return {
    formatVersion: buf.readUInt16LE(4),
    flags: buf.readUInt16LE(6),
    chainId: buf.readUInt16LE(8),
    shardIndex: buf.readUInt32LE(12),
    startHandIndex: buf.readUInt32LE(16),
    chainSeed: buf.readBigUInt64LE(20),
  };
}

export function encodeBinFooter(recordCount: number, crc32 = 0): Buffer {
  const b = Buffer.allocUnsafe(BIN_FOOTER_SIZE);
  b.write(BIN_FOOTER_MAGIC, 0, 'ascii');
  b.writeUInt32LE(u32('recordCount', recordCount), 4);
  b.writeUInt32LE(u32('crc32', crc32), 8);
  return b;
}

export function decodeBinFooter(buf: Buffer): { recordCount: number; crc32: number } | null {
  if (buf.length < BIN_FOOTER_SIZE) return null;
  if (buf.toString('ascii', 0, 4) !== BIN_FOOTER_MAGIC) return null;
  return { recordCount: buf.readUInt32LE(4), crc32: buf.readUInt32LE(8) };
}

export interface IdxHeader {
  formatVersion: number;
  chainId: number;
  shardIndex: number;
}

export function encodeIdxHeader(h: IdxHeader): Buffer {
  const b = Buffer.allocUnsafe(IDX_HEADER_SIZE);
  b.write(INDEX_MAGIC, 0, 'ascii');
  b.writeUInt16LE(u16('formatVersion', h.formatVersion), 4);
  b.writeUInt16LE(u16('chainId', h.chainId), 6);
  b.writeUInt32LE(u32('shardIndex', h.shardIndex), 8);
  b.writeUInt32LE(0, 12); // reserved
  return b;
}

export function decodeIdxHeader(buf: Buffer): IdxHeader {
  if (buf.length < IDX_HEADER_SIZE) throw new Error(`.idx header 截断: ${buf.length}`);
  if (buf.toString('ascii', 0, 4) !== INDEX_MAGIC) throw new Error('.idx magic 不符');
  return {
    formatVersion: buf.readUInt16LE(4),
    chainId: buf.readUInt16LE(6),
    shardIndex: buf.readUInt32LE(8),
  };
}

export function encodeIdxFooter(count: number, crc32 = 0): Buffer {
  const b = Buffer.allocUnsafe(IDX_FOOTER_SIZE);
  b.write(IDX_FOOTER_MAGIC, 0, 'ascii');
  b.writeUInt32LE(u32('count', count), 4);
  b.writeUInt32LE(u32('crc32', crc32), 8);
  return b;
}

export function decodeIdxFooter(buf: Buffer): { count: number; crc32: number } | null {
  if (buf.length < IDX_FOOTER_SIZE) return null;
  if (buf.toString('ascii', 0, 4) !== IDX_FOOTER_MAGIC) return null;
  return { count: buf.readUInt32LE(4), crc32: buf.readUInt32LE(8) };
}

// ---- index entry ----

export function encodeIndexEntry(e: IndexEntry): Buffer {
  const b = Buffer.allocUnsafe(INDEX_ENTRY_SIZE);
  if (e.offset < 0n || e.offset > 0xffffffffffffffffn) throw new Error(`index offset 越界: ${e.offset}`);
  if (e.deckHash < 0n || e.deckHash > 0xffffffffffffffffn) throw new Error(`index deckHash 越界: ${e.deckHash}`);
  b.writeBigUInt64LE(e.offset, 0);
  b.writeBigUInt64LE(e.deckHash, 8);
  b.writeUInt32LE(u32('chainHandIndex', e.chainHandIndex), 16);
  b.writeUInt32LE(u32('blockIndex', e.blockIndex), 20);
  b[24] = u8('level', e.level);
  b[25] = u8('declarer', e.declarer);
  b[26] = u8('trumpCode', e.trumpCode);
  b[27] = u8('flags', e.flags);
  b[28] = u8('cellIndex', e.cellIndex);
  b[29] = 0; // reserved
  b[30] = 0;
  b[31] = 0;
  return b;
}

export function decodeIndexEntryAt(buf: Buffer, offset: number): IndexEntry {
  if (offset + INDEX_ENTRY_SIZE > buf.length) throw new Error('.idx entry 截断');
  return {
    offset: buf.readBigUInt64LE(offset),
    deckHash: buf.readBigUInt64LE(offset + 8),
    chainHandIndex: buf.readUInt32LE(offset + 16),
    blockIndex: buf.readUInt32LE(offset + 20),
    level: buf[offset + 24],
    declarer: buf[offset + 25],
    trumpCode: buf[offset + 26],
    flags: buf[offset + 27],
    cellIndex: buf[offset + 28],
  };
}

/**
 * 解析整个 `.idx`。必须有 footer：没有 footer 说明分片还没写完（或中断在写索引
 * 之后），此时以 `.bin` 的长度前缀为准重建，避免「索引少一条、记录却存在」。
 */
export function parseIndexFile(buf: Buffer, chainId: number, shardIndex: number): IndexEntry[] {
  const header = decodeIdxHeader(buf);
  if (header.formatVersion !== FORMAT_VERSION) throw new Error(`.idx 版本不符: ${header.formatVersion}`);
  if (header.chainId !== chainId || header.shardIndex !== shardIndex) {
    throw new Error(`.idx header 与路径不符: chain ${header.chainId}/${shardIndex}`);
  }
  const footer = decodeIdxFooter(buf.subarray(buf.length - IDX_FOOTER_SIZE));
  if (!footer) throw new Error('.idx 缺少 footer（未写完），需从 .bin 重建');
  const end = buf.length - IDX_FOOTER_SIZE;
  const entries: IndexEntry[] = [];
  for (let o = IDX_HEADER_SIZE; o + INDEX_ENTRY_SIZE <= end; o += INDEX_ENTRY_SIZE) {
    entries.push(decodeIndexEntryAt(buf, o));
  }
  if (footer.count !== entries.length) {
    throw new Error(`.idx footer count=${footer.count} 与 entry 数 ${entries.length} 不一致`);
  }
  return entries;
}

// ---- 路径 ----

export function chainDirName(chainId: number): string {
  return `chain-${String(chainId).padStart(2, '0')}`;
}

export interface ShardPaths {
  binPath: string;
  idxPath: string;
  relBin: string;
  relIdx: string;
}

export function shardPaths(runDir: string, chainId: number, shardIndex: number): ShardPaths {
  const dir = chainDirName(chainId);
  const base = `shard-${String(shardIndex).padStart(3, '0')}`;
  const relBin = path.posix.join(dir, `${base}.bin`);
  const relIdx = path.posix.join(dir, `${base}.idx`);
  return {
    binPath: path.join(runDir, dir, `${base}.bin`),
    idxPath: path.join(runDir, dir, `${base}.idx`),
    relBin,
    relIdx,
  };
}

// ---- manifest ----

export function readManifest(runDir: string): Manifest {
  const file = path.join(runDir, 'manifest.json');
  const text = fs.readFileSync(file, 'utf8');
  const manifest = JSON.parse(text) as Manifest;
  if (manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error(`manifest formatVersion 不支持: ${manifest.formatVersion}（本 reader 支持 ${FORMAT_VERSION}）`);
  }
  if (!Array.isArray(manifest.chains)) throw new Error('manifest 缺少 chains');
  return manifest;
}

/** 原子写：临时文件 + rename，中断时不会留下半个 JSON。 */
export function writeManifestAtomic(runDir: string, manifest: Manifest): void {
  const target = path.join(runDir, 'manifest.json');
  const tmp = path.join(runDir, `.manifest.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

// ---- reader ----

export interface DatasetChainInfo {
  chainId: number;
  globalStart: number;
  handsRequested: number;
  seed: string;
}

interface LocatedEntry {
  entry: IndexEntry;
  shardIndex: number;
}

/** 由 `.bin` 的长度前缀重建一个分片的索引（`.idx` 缺失/截断时的兜底）。 */
export function scanBinFile(buf: Buffer): { header: BinHeader; entries: IndexEntry[]; recordCount: number } {
  const header = decodeBinHeader(buf);
  const entries: IndexEntry[] = [];
  let o = BIN_HEADER_SIZE;
  while (o + 4 <= buf.length) {
    const len = buf.readUInt32LE(o);
    // footer 的 "PKRE" 作为长度会是一个巨大的值，直接越界退出
    if (len === 0 || o + 4 + len > buf.length) break;
    const record = decodeRecordPayload(buf.subarray(o + 4, o + 4 + len));
    entries.push({
      offset: BigInt(o),
      deckHash: deckHashBigInt(deckHashFromCodes(record.deck)),
      chainHandIndex: record.chainHandIndex,
      blockIndex: record.blockIndex,
      cellIndex: record.cellIndex,
      level: record.level,
      declarer: record.declarer,
      trumpCode: record.trumpCode,
      flags: record.flags,
    });
    o += 4 + len;
  }
  return { header, entries, recordCount: entries.length };
}

/**
 * 只读数据集：按全局 / 链内 handIndex 随机访问，按分片读取 `.idx`。
 *
 * - `.idx` 缺失或不完整时自动扫描 `.bin` 重建（不写回磁盘）；
 * - 文件句柄懒打开，用完后 `close()`。
 */
export class RecordDataset {
  private readonly fds = new Map<string, number>();
  private readonly located = new Map<number, LocatedEntry[]>();
  private readonly shardCache = new Map<number, number[]>();

  private constructor(
    readonly runDir: string,
    readonly manifest: Manifest,
    private readonly chains: DatasetChainInfo[],
  ) {}

  static open(runDir: string): RecordDataset {
    const resolved = path.resolve(runDir);
    const manifest = readManifest(resolved);
    const chains: DatasetChainInfo[] = manifest.chains
      .map(c => ({
        chainId: c.chainId, globalStart: c.globalStart,
        handsRequested: c.handsRequested, seed: c.seed,
      }))
      .sort((a, b) => a.chainId - b.chainId);
    return new RecordDataset(resolved, manifest, chains);
  }

  get chainInfos(): readonly DatasetChainInfo[] {
    return this.chains;
  }

  private shardNumbers(chainId: number): number[] {
    const cached = this.shardCache.get(chainId);
    if (cached) return cached;
    const dir = path.join(this.runDir, chainDirName(chainId));
    const found = new Set<number>();
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const m = /^shard-(\d+)\.bin$/.exec(name);
        if (m) found.add(Number(m[1]));
      }
    }
    const list = [...found].sort((a, b) => a - b);
    this.shardCache.set(chainId, list);
    return list;
  }

  readIndex(chainId: number, shardIndex: number): IndexEntry[] {
    const { binPath, idxPath } = shardPaths(this.runDir, chainId, shardIndex);
    if (!fs.existsSync(idxPath)) {
      if (!fs.existsSync(binPath)) return [];
      return this.rebuildIndex(chainId, shardIndex);
    }
    try {
      return parseIndexFile(fs.readFileSync(idxPath), chainId, shardIndex);
    } catch {
      // 截断/不一致：以 `.bin` 为准
      return this.rebuildIndex(chainId, shardIndex);
    }
  }

  rebuildIndex(chainId: number, shardIndex: number): IndexEntry[] {
    const { binPath } = shardPaths(this.runDir, chainId, shardIndex);
    if (!fs.existsSync(binPath)) return [];
    const { entries } = scanBinFile(fs.readFileSync(binPath));
    return entries;
  }

  private chainEntries(chainId: number): LocatedEntry[] {
    const cached = this.located.get(chainId);
    if (cached) return cached;
    const list: LocatedEntry[] = [];
    for (const shardIndex of this.shardNumbers(chainId)) {
      for (const entry of this.readIndex(chainId, shardIndex)) {
        list.push({ entry, shardIndex });
      }
    }
    list.sort((a, b) => a.entry.chainHandIndex - b.entry.chainHandIndex);
    this.located.set(chainId, list);
    return list;
  }

  /** 一条链实际可读的记录数（以索引为准，不看 manifest 的完成数）。 */
  chainHandCount(chainId: number): number {
    return this.chainEntries(chainId).length;
  }

  /** 磁盘上该链的分片数（不依赖 manifest 的 shards 列表）。 */
  shardCount(chainId: number): number {
    return this.shardNumbers(chainId).length;
  }

  private readAt(chainId: number, shardIndex: number, offset: bigint): HandRecord | null {
    const offsetNum = Number(offset);
    if (!Number.isSafeInteger(offsetNum) || offsetNum < 0) return null;
    const { binPath } = shardPaths(this.runDir, chainId, shardIndex);
    let fd = this.fds.get(binPath);
    if (fd === undefined) {
      fd = fs.openSync(binPath, 'r');
      this.fds.set(binPath, fd);
    }
    const lenBuf = Buffer.allocUnsafe(4);
    const gotLen = fs.readSync(fd, lenBuf, 0, 4, offsetNum);
    if (gotLen !== 4) return null;
    const len = lenBuf.readUInt32LE(0);
    if (len === 0) return null;
    const payload = Buffer.allocUnsafe(len);
    const got = fs.readSync(fd, payload, 0, len, offsetNum + 4);
    if (got !== len) return null;
    return decodeRecordPayload(payload);
  }

  getChainHand(chainId: number, chainHandIndex: number): HandRecord | null {
    const entries = this.chainEntries(chainId);
    let lo = 0;
    let hi = entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cur = entries[mid].entry.chainHandIndex;
      if (cur === chainHandIndex) {
        return this.readAt(chainId, entries[mid].shardIndex, entries[mid].entry.offset);
      }
      if (cur < chainHandIndex) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  getHand(globalHandIndex: number): HandRecord | null {
    for (const c of this.chains) {
      if (globalHandIndex >= c.globalStart && globalHandIndex < c.globalStart + c.handsRequested) {
        return this.getChainHand(c.chainId, globalHandIndex - c.globalStart);
      }
    }
    return null;
  }

  close(): void {
    for (const fd of this.fds.values()) fs.closeSync(fd);
    this.fds.clear();
  }
}

// ---- 由记录反推开局手牌 ----

/** 初始底牌 = deck[100..108)。 */
export function initialBottom(record: HandRecord): number[] {
  return record.deck.slice(DEALT_CARDS, DEALT_CARDS + 8);
}

/**
 * 扣底后四家的 25 张手牌（code）。庄家 = 发到的 25 张 + 初始 8 张底牌 − 最终底牌；
 * 其余三家就是发牌结果。这样记录里不必重复存 100 张手牌。
 */
export function initialHands(record: HandRecord): number[][] {
  const hands: number[][] = [[], [], [], []];
  for (let i = 0; i < DEALT_CARDS; i++) hands[i % 4].push(record.deck[i]);
  const bottom = new Set(record.bottom);
  const merged = [...hands[record.declarer], ...initialBottom(record)];
  hands[record.declarer] = merged.filter(code => !bottom.has(code));
  return hands;
}

/** flags 便捷判断。 */
export function recordHasAttackerLevel(record: HandRecord): boolean {
  return (record.flags & FLAG_HAS_ATTACKER_LEVEL) !== 0;
}

export function recordHasLap(record: HandRecord): boolean {
  return (record.flags & FLAG_HAS_LAP) !== 0;
}
