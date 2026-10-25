/**
 * 分片写入器：一条链一个实例，顺序追加 record + index entry。
 *
 * - 每 `shardHands` 手换一个 `.bin`/`.idx`；每个分片结束时写 footer 并关闭；
 * - 编码结果先进内存缓冲，每 `flushHands` 手或缓冲到 1 MB 时 `writeSync`；
 * - 缓冲期间被硬杀最多丢最后 `flushHands` 手；`.idx` 不完整时 reader 可扫描
 *   `.bin` 的长度前缀重建；
 * - `close()` 幂等：写完当前分片 footer、flush、关闭，可在中断/错误路径重复调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BIN_HEADER_SIZE, FORMAT_VERSION,
} from './record-types.js';
import type { HandRecord, ManifestShard } from './record-types.js';
import {
  chainDirName, encodeBinFooter, encodeBinHeader, encodeIdxFooter, encodeIdxHeader,
  encodeIndexEntry, encodeRecord, shardPaths,
} from './record-codec.js';

const FLUSH_BYTES = 1 << 20;

export interface ChainWriterOptions {
  runDir: string;
  chainId: number;
  chainSeedHex: string;
  /** 每个 `.bin` 容纳的手数。 */
  shardHands: number;
  /** 最多缓冲多少手再写盘。 */
  flushHands: number;
}

function writeAll(fd: number, buf: Buffer): void {
  let off = 0;
  while (off < buf.length) {
    const n = fs.writeSync(fd, buf, off, buf.length - off);
    if (n <= 0) throw new Error('写文件失败（writeSync 返回 0）');
    off += n;
  }
}

export class ChainWriter {
  readonly chainDir: string;
  readonly shards: ManifestShard[] = [];
  /** 已写入（含仍在缓冲）的记录数。 */
  handsWritten = 0;

  private readonly runDir: string;
  private readonly chainId: number;
  private readonly chainSeed: bigint;
  private readonly shardHands: number;
  private readonly flushHands: number;

  private shardIndex = 0;
  private shardStartHand = 0;
  private shardCount = 0;
  /** 当前 `.bin` 已占字节数（含 header），下一条记录的 offset。 */
  private shardBytes = BIN_HEADER_SIZE;
  private binFd = -1;
  private idxFd = -1;
  private binPending: Buffer[] = [];
  private idxPending: Buffer[] = [];
  private pendingBytes = 0;
  private pendingHands = 0;
  private closed = false;

  constructor(opts: ChainWriterOptions) {
    if (!Number.isInteger(opts.shardHands) || opts.shardHands < 1) throw new Error('shardHands 必须 ≥ 1');
    if (!Number.isInteger(opts.flushHands) || opts.flushHands < 1) throw new Error('flushHands 必须 ≥ 1');
    this.runDir = opts.runDir;
    this.chainId = opts.chainId;
    this.chainSeed = BigInt(`0x${opts.chainSeedHex}`);
    this.shardHands = opts.shardHands;
    this.flushHands = opts.flushHands;
    this.chainDir = path.join(opts.runDir, chainDirName(opts.chainId));
    fs.mkdirSync(this.chainDir, { recursive: true });
    this.openShard(0);
  }

  private openShard(index: number): void {
    const { binPath, idxPath } = shardPaths(this.runDir, this.chainId, index);
    this.shardIndex = index;
    this.shardStartHand = this.handsWritten;
    this.shardCount = 0;
    this.shardBytes = BIN_HEADER_SIZE;
    this.binFd = fs.openSync(binPath, 'w');
    this.idxFd = fs.openSync(idxPath, 'w');
    writeAll(this.binFd, encodeBinHeader({
      formatVersion: FORMAT_VERSION,
      flags: 0,
      chainId: this.chainId,
      shardIndex: index,
      startHandIndex: this.shardStartHand,
      chainSeed: this.chainSeed,
    }));
    writeAll(this.idxFd, encodeIdxHeader({
      formatVersion: FORMAT_VERSION,
      chainId: this.chainId,
      shardIndex: index,
    }));
  }

  write(record: HandRecord, deckHash: bigint): void {
    if (this.closed) throw new Error('ChainWriter 已关闭');
    if (this.shardCount >= this.shardHands) this.rotate();
    if (record.chainHandIndex !== this.handsWritten) {
      throw new Error(`chainHandIndex 不连续: 期望 ${this.handsWritten}，实际 ${record.chainHandIndex}`);
    }

    const bin = encodeRecord(record);
    const idx = encodeIndexEntry({
      offset: BigInt(this.shardBytes),
      deckHash,
      chainHandIndex: record.chainHandIndex,
      blockIndex: record.blockIndex,
      cellIndex: record.cellIndex,
      level: record.level,
      declarer: record.declarer,
      trumpCode: record.trumpCode,
      flags: record.flags,
    });
    this.binPending.push(bin);
    this.idxPending.push(idx);
    this.shardBytes += bin.length;
    this.shardCount += 1;
    this.handsWritten += 1;
    this.pendingHands += 1;
    this.pendingBytes += bin.length + idx.length;
    if (this.pendingHands >= this.flushHands || this.pendingBytes >= FLUSH_BYTES) this.flush();
  }

  /** 把缓冲写入磁盘（不写 footer，不换分片）。 */
  flush(): void {
    if (this.closed || this.pendingHands === 0) return;
    if (this.binFd < 0 || this.idxFd < 0) throw new Error('分片未打开');
    writeAll(this.binFd, Buffer.concat(this.binPending));
    writeAll(this.idxFd, Buffer.concat(this.idxPending));
    this.binPending = [];
    this.idxPending = [];
    this.pendingHands = 0;
    this.pendingBytes = 0;
  }

  private rotate(): void {
    this.closeShard();
    this.openShard(this.shardIndex + 1);
  }

  private closeShard(): void {
    if (this.binFd < 0) return;
    this.flush();
    writeAll(this.binFd, encodeBinFooter(this.shardCount));
    writeAll(this.idxFd, encodeIdxFooter(this.shardCount));
    fs.closeSync(this.binFd);
    fs.closeSync(this.idxFd);
    const { relBin, relIdx } = shardPaths(this.runDir, this.chainId, this.shardIndex);
    this.shards.push({
      path: relBin,
      startHand: this.shardStartHand,
      count: this.shardCount,
      indexPath: relIdx,
    });
    this.binFd = -1;
    this.idxFd = -1;
  }

  /** 当前分片的序号与记录数（诊断/测试用）。 */
  get currentShard(): { index: number; count: number } {
    return { index: this.shardIndex, count: this.shardCount };
  }

  close(): void {
    if (this.closed) return;
    this.closeShard();
    this.closed = true;
  }
}
