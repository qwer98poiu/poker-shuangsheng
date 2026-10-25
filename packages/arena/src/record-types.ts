/**
 * 牌局录制数据集 — 共享类型、格式常量与卡片 code 映射。
 *
 * 数据单位是一手小局（发出 108 张 → 亮主 → 扣底 → 25 墩 → 结算）。文件格式见
 * `record-format.md`：所有整数小端；卡片 code 固定为 `createFullDeck()` 的下标
 * （0..107）。改变这个顺序或任何字段含义都必须升 `FORMAT_VERSION`。
 *
 * 这里只放纯数据定义，不发牌、不写盘，便于 run / codec / writer 共用而不成环。
 */
import { createFullDeck } from '@poker/engine';
import type { Card, Suit } from '@poker/engine';

export const FORMAT_VERSION = 1;
export const RULES_VERSION = 'endless-v1';

export const RECORD_MAGIC = 'PKR1';
export const INDEX_MAGIC = 'PKI1';
export const BIN_FOOTER_MAGIC = 'PKRE';
export const IDX_FOOTER_MAGIC = 'PKIE';

/** `.bin` header：4 magic + u16 version + u16 flags + u16 chain + u16 reserved + u32 shard + u32 start + u64 seed。 */
export const BIN_HEADER_SIZE = 28;
/** `.bin` footer：4 magic + u32 count + u32 crc32。 */
export const BIN_FOOTER_SIZE = 12;
/** `.idx` header：4 magic + u16 version + u16 chain + u32 shard + u32 reserved。 */
export const IDX_HEADER_SIZE = 16;
/** 一条 index entry：u64 offset + u64 deckHash + u32 chainHand + u32 block + 5 × u8 + 3 reserved。 */
export const INDEX_ENTRY_SIZE = 32;
/** `.idx` footer：4 magic + u32 count + u32 crc32。 */
export const IDX_FOOTER_SIZE = 12;

export const DECK_SIZE = 108;
export const DEALT_CARDS = 100;
export const HAND_SIZE = 25;
export const BOTTOM_SIZE = 8;
export const MAX_TRICKS = 25;
export const CELLS_PER_BLOCK = 52;
export const LEVEL_MIN = 2;
export const LEVEL_MAX = 14;

/** random 模式：每 52 手一个完整块。 */
export const MAX_REVEALS = 400;
export const NT_TRUMP_CODE = 255;
export const NO_NEXT_DECLARER = 255;

// ---- record flags（u8） ----

export const FLAG_RANDOM = 0x01;
export const FLAG_RULES = 0x02;
export const FLAG_HAS_ATTACKER_LEVEL = 0x04;
export const FLAG_HAS_LAP = 0x08;
export const FLAG_ATTACKER_WON_LAST_TRICK = 0x10;
export const FLAG_BANKER_WON = 0x20;

// ---- card code：createFullDeck() 的下标 ----

const DECK_TEMPLATE = createFullDeck();
const CODE_BY_ID = new Map<string, number>();
DECK_TEMPLATE.forEach((card, code) => CODE_BY_ID.set(card.id, code));

/** 按 code（0..107）反查模板卡片；同一 code 的 id/suit/rank 永远一致。 */
export const CARD_BY_CODE: readonly Card[] = DECK_TEMPLATE;

export function cardCode(card: Card): number {
  const code = CODE_BY_ID.get(card.id);
  if (code === undefined) throw new Error(`未知卡片（不在 createFullDeck() 中）: ${card.id}`);
  return code;
}

export function cardFromCode(code: number): Card {
  if (!Number.isInteger(code) || code < 0 || code >= DECK_SIZE) {
    throw new Error(`卡片 code 越界: ${code}`);
  }
  return CARD_BY_CODE[code];
}

// ---- trump code：0..3 = S/H/C/D；NT = 255 ----

export const TRUMP_CODE_BY_SUIT: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
export const TRUMP_SUIT_BY_CODE: readonly Suit[] = ['S', 'H', 'C', 'D'];

// ---- 数据形状 ----

export type ContextMode = 'random' | 'rules';

export interface RevealRecord {
  /** 0..3 */
  player: number;
  /** 0..3 = 花色 code；null = 无主。 */
  suit: number | null;
  /** 1..4（单张级牌 / 对级牌 / 对小王 / 对大王）。 */
  strength: number;
  /** 第几张牌发完后生效（0..99）。只记录生效亮主/反主。 */
  dealIndex: number;
}

/** 非法甩牌被强制降级；实际出的牌仍在对应 trick 里。 */
export interface FailedThrowRecord {
  /** 0-based trick index，发生在该墩领出时。 */
  trickIndex: number;
  /** 领出者。 */
  player: number;
  /** 实际加到 attackerPoints 的值：+10 / -10 / 0（封顶）。 */
  penaltyDelta: number;
  /** AI 原本想甩的牌（deck code）。 */
  cards: number[];
}

export interface TrickRecord {
  /** 领出者座位。 */
  lead: number;
  /** 四家按出牌顺序各出几张，`sum(counts) === cards.length`。 */
  counts: [number, number, number, number];
  /** 按出牌顺序拼接的 deck code。 */
  cards: number[];
  winner: number;
  points: number;
}

export interface HandRecord {
  globalHandIndex: number;
  chainHandIndex: number;
  blockIndex: number;
  /** random 模式 0..51；rules 模式 0。 */
  cellIndex: number;
  level: number;
  declarer: number;
  /** rules 模式实际闲家等级；random 模式写 0（看 flags 的 hasAttackerLevel）。 */
  attackerLevel: number;
  /** 0..3 = S/H/C/D；255 = 无主。 */
  trumpCode: number;
  flags: number;
  lapA: number;
  lapB: number;
  levelAfterA: number;
  levelAfterB: number;
  /** rules 模式 0..3；random 模式 255。 */
  nextDeclarer: number;
  /** 原始发牌顺序（100 张手牌 + 8 张初始底牌）。 */
  deck: number[];
  /** 扣底后的最终底牌（8 张）。 */
  bottom: number[];
  /** 仅生效亮主/反主；空数组表示自动叫主。 */
  reveals: RevealRecord[];
  failedThrows: FailedThrowRecord[];
  tricks: TrickRecord[];
  /** 原始闲家分（甩牌罚分后可 < 0）。 */
  attackerPoints: number;
  finalPts: number;
  bottomPoints: number;
  bottomMultiplier: number;
  kouDiAdd: number;
  throwPenalties: [number, number];
}

export interface IndexEntry {
  /** 相对 `.bin` 文件起点，指向 recordLength。 */
  offset: bigint;
  /** 物理 deck hash 的 64 位。 */
  deckHash: bigint;
  chainHandIndex: number;
  blockIndex: number;
  /** random 模式 0..51；rules 0（与记录一致，便于按 cell 查询）。 */
  cellIndex: number;
  level: number;
  declarer: number;
  trumpCode: number;
  flags: number;
}

export interface ManifestShard {
  path: string;
  startHand: number;
  count: number;
  indexPath: string;
}

export type ChainStatus = 'running' | 'completed' | 'stopped' | 'error';

export interface ManifestChain {
  chainId: number;
  seed: string;
  globalStart: number;
  handsRequested: number;
  handsCompleted: number;
  status: ChainStatus;
  shards: ManifestShard[];
}

export interface ManifestError {
  chainId: number;
  /** 链内 hand index（该手未写入数据集）。 */
  handIndex: number;
  kind: string;
  message: string;
  reportPath: string | null;
}

// ---- parent ↔ worker IPC（fork 的 JSON 消息） ----

/** 父进程传给 record-worker 的全部参数（argv[2] 的 JSON）。 */
export interface RecordWorkerSpec {
  chainId: number;
  globalStart: number;
  handsRequested: number;
  seedHex: string;
  mode: ContextMode;
  strategyA: string;
  strategyB: string;
  runDir: string;
  shardHands: number;
  flushHands: number;
}

export type RecordWorkerMessage =
  | { type: 'ready'; chainId: number }
  | { type: 'progress'; chainId: number; completed: number }
  | {
      type: 'done';
      chainId: number;
      status: 'completed' | 'stopped' | 'error';
      completed: number;
      shards: ManifestShard[];
      error?: { kind: string; message: string; reportPath: string | null };
    };

export interface Manifest {
  formatVersion: number;
  rulesVersion: string;
  status: 'running' | 'completed' | 'interrupted' | 'error';
  contextMode: ContextMode;
  seed: {
    base: string;
    source: 'timestamp+random' | 'cli';
    algorithm: 'sha256-64-v1';
  };
  strategies: { A: string; B: string };
  handsRequested: number;
  handsCompleted: number;
  workers: number;
  shardHands: number;
  flushHands: number;
  createdAt: string;
  completedAt: string | null;
  /** 机器可读出处字段（允许提交哈希）；git 不可用时 null。 */
  revision: string | null;
  dirty: boolean;
  node: string;
  command: string[];
  chains: ManifestChain[];
  error: ManifestError | null;
}
