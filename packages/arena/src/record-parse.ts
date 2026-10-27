/**
 * 牌局录制数据集解析器。
 *
 * 解析器只做机械转换与结构校验：读 `.bin` 的长度前缀，把 record 转成
 * `ParsedHand`，并根据 deck + tricks 重建发牌后/扣底后/逐墩手牌。它不做
 * 概率统计、场景判定、AI 重放，也不重建 `GameState`/`AIContext`。
 *
 * 亮主语义：`reveals` 只含生效项；解析器可从 deck 前缀和 `canOverride`
 * 重放当前亮主。某次 poll 有合法选项却没有生效条目时，视为 pass。
 */
import fs from 'node:fs';
import { canOverride, Rank } from '@poker/engine';
import type { Card, Suit } from '@poker/engine';
import {
  BIN_HEADER_SIZE, DEALT_CARDS, DECK_SIZE, FLAG_ATTACKER_WON_LAST_TRICK,
  FLAG_BANKER_WON, FLAG_HAS_ATTACKER_LEVEL, FLAG_HAS_LAP, FLAG_RANDOM, FLAG_RULES,
  FORMAT_VERSION, MAX_REVEALS, MAX_TRICKS, NT_TRUMP_CODE, TRUMP_CODE_BY_SUIT,
  TRUMP_SUIT_BY_CODE, cardFromCode,
} from './record-types.js';
import type {
  ContextMode, HandRecord, IndexEntry, ManifestChain, TrickRecord,
} from './record-types.js';
import {
  decodeBinHeader, decodeRecordPayload, RecordDataset, shardPaths,
} from './record-codec.js';
import { deckHashFromCodes } from './record-rng.js';

// ---- 公共 DTO ----

export interface RandomContext {
  mode: 'random';
  level: number;
  declarer: number;
  blockIndex: number;
  cellIndex: number;
  attackerLevel: null;
  lapA: null;
  lapB: null;
  levelAfterA: null;
  levelAfterB: null;
  nextDeclarer: null;
}

export interface RulesContext {
  mode: 'rules';
  level: number;
  declarer: number;
  attackerLevel: number;
  blockIndex: 0;
  cellIndex: 0;
  lapA: number;
  lapB: number;
  levelAfterA: number;
  levelAfterB: number;
  nextDeclarer: number;
}

export type HandContext = RandomContext | RulesContext;

export interface ParsedReveal {
  player: number;
  suit: Suit | null;
  strength: number;
  dealIndex: number;
}

export interface ParsedFailedThrow {
  trickIndex: number;
  player: number;
  cards: Card[];
  penaltyDelta: number;
}

export interface ParsedTrick {
  lead: number;
  /** 按出牌顺序；plays[i].seat = (lead + i) % 4。 */
  plays: { seat: number; cards: Card[] }[];
  winner: number;
  points: number;
}

export interface Settlement {
  attackerPoints: number;
  finalPts: number;
  bottomPoints: number;
  bottomMultiplier: number;
  kouDiAdd: number;
  throwPenalties: [number, number];
  attackerWonLastTrick: boolean;
  bankerWon: boolean;
}

export interface ParsedMeta {
  chainId: number;
  chainHandIndex: number;
  globalHandIndex: number;
  /** 16 位十六进制；来自 .idx 或由 deck 计算。 */
  deckHash: string;
}

export interface ParsedHand {
  meta: ParsedMeta;
  context: HandContext;
  trump: { suit: Suit | null; level: number; declarer: number };
  /** 108，原始发牌顺序（前 100 轮发 + 后 8 初始底牌）。 */
  deck: Card[];
  /** 8，扣底后的最终底牌。 */
  bottom: Card[];
  /** 仅生效亮主/反主；空数组 = 自动叫主。 */
  reveals: ParsedReveal[];
  failedThrows: ParsedFailedThrow[];
  tricks: ParsedTrick[];
  settlement: Settlement;
  /** includeRaw 时保留原始 HandRecord。 */
  raw?: HandRecord;
}

export interface ParseFilter {
  mode?: ContextMode;
  level?: number;
  declarer?: number;
  trump?: Suit | 'NT';
  blockIndex?: number;
  cellIndex?: number;
}

export interface ParseOptions {
  filter?: ParseFilter;
  predicate?: (hand: ParsedHand) => boolean;
  /** 默认 true。 */
  validate?: boolean;
  /** 默认 false；遇到坏记录时抛出。 */
  skipBad?: boolean;
  /** 默认 false；manifest.status === running 时拒绝读取。 */
  allowRunning?: boolean;
  /** 默认 false；ParsedHand.raw 保留原记录。 */
  includeRaw?: boolean;
  onSkip?: (err: RecordParseError) => void;
}

export interface ParseHandOptions {
  /** 默认 true。 */
  validate?: boolean;
  /** 默认 false。 */
  includeRaw?: boolean;
}

export interface ParseErrorContext {
  chainId?: number;
  shardIndex?: number;
  offset?: number;
  globalHandIndex?: number;
  chainHandIndex?: number;
}

export class RecordParseError extends Error {
  readonly chainId?: number;
  readonly shardIndex?: number;
  readonly offset?: number;
  readonly globalHandIndex?: number;
  readonly chainHandIndex?: number;

  constructor(message: string, ctx: ParseErrorContext = {}) {
    super(message);
    this.name = 'RecordParseError';
    this.chainId = ctx.chainId;
    this.shardIndex = ctx.shardIndex;
    this.offset = ctx.offset;
    this.globalHandIndex = ctx.globalHandIndex;
    this.chainHandIndex = ctx.chainHandIndex;
  }
}

// ---- decode / parse ----

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function contextual(err: unknown, ctx: ParseErrorContext): RecordParseError {
  if (err instanceof RecordParseError && err.chainId !== undefined) return err;
  return new RecordParseError(messageOf(err), ctx);
}

function revealSuit(code: number | null): Suit | null {
  if (code === null) return null;
  const suit = TRUMP_SUIT_BY_CODE[code];
  if (suit === undefined) throw new Error(`reveal.suit 非法: ${code}`);
  return suit;
}

function trumpSuit(code: number): Suit | null {
  if (code === NT_TRUMP_CODE) return null;
  const suit = TRUMP_SUIT_BY_CODE[code];
  if (suit === undefined) throw new Error(`trumpCode 非法: ${code}`);
  return suit;
}

function toParsedTrick(t: TrickRecord): ParsedTrick {
  let cursor = 0;
  const plays = t.counts.map((count, i) => {
    const cards = t.cards.slice(cursor, cursor + count).map(cardFromCode);
    cursor += count;
    return { seat: (t.lead + i) % 4, cards };
  });
  return { lead: t.lead, plays, winner: t.winner, points: t.points };
}

function toContext(record: HandRecord): HandContext {
  if ((record.flags & FLAG_RANDOM) !== 0) {
    return {
      mode: 'random',
      level: record.level,
      declarer: record.declarer,
      blockIndex: record.blockIndex,
      cellIndex: record.cellIndex,
      attackerLevel: null,
      lapA: null,
      lapB: null,
      levelAfterA: null,
      levelAfterB: null,
      nextDeclarer: null,
    };
  }
  return {
    mode: 'rules',
    level: record.level,
    declarer: record.declarer,
    attackerLevel: record.attackerLevel,
    blockIndex: 0,
    cellIndex: 0,
    lapA: record.lapA,
    lapB: record.lapB,
    levelAfterA: record.levelAfterA,
    levelAfterB: record.levelAfterB,
    nextDeclarer: record.nextDeclarer,
  };
}

/** 把一条记录转成 ParsedHand；默认做结构校验。 */
export function parseHand(
  record: HandRecord, meta: ParsedMeta, opts: ParseHandOptions = {},
): ParsedHand {
  const deck = record.deck.map(cardFromCode);
  const bottom = record.bottom.map(cardFromCode);
  const reveals: ParsedReveal[] = record.reveals.map(r => ({
    player: r.player,
    suit: revealSuit(r.suit),
    strength: r.strength,
    dealIndex: r.dealIndex,
  }));
  const failedThrows: ParsedFailedThrow[] = record.failedThrows.map(f => ({
    trickIndex: f.trickIndex,
    player: f.player,
    cards: f.cards.map(cardFromCode),
    penaltyDelta: f.penaltyDelta,
  }));
  const hand: ParsedHand = {
    meta,
    context: toContext(record),
    trump: {
      suit: trumpSuit(record.trumpCode),
      level: record.level,
      declarer: record.declarer,
    },
    deck,
    bottom,
    reveals,
    failedThrows,
    tricks: record.tricks.map(toParsedTrick),
    settlement: {
      attackerPoints: record.attackerPoints,
      finalPts: record.finalPts,
      bottomPoints: record.bottomPoints,
      bottomMultiplier: record.bottomMultiplier,
      kouDiAdd: record.kouDiAdd,
      throwPenalties: [record.throwPenalties[0], record.throwPenalties[1]],
      attackerWonLastTrick: (record.flags & FLAG_ATTACKER_WON_LAST_TRICK) !== 0,
      bankerWon: (record.flags & FLAG_BANKER_WON) !== 0,
    },
  };
  if (opts.includeRaw) hand.raw = record;
  if (opts.validate !== false) validateParsed(record, hand, meta);
  return hand;
}

// ---- validation ----

function fail(message: string): never {
  throw new RecordParseError(message);
}

function sortedIds(cards: readonly Card[]): string[] {
  return cards.map(c => c.id).sort();
}

function sameIds(a: readonly Card[], b: readonly Card[]): boolean {
  const aa = sortedIds(a);
  const bb = sortedIds(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

function validateContext(record: HandRecord): void {
  if ((record.flags & ~0x3f) !== 0) fail(`未知 flags: 0x${record.flags.toString(16)}`);
  const random = (record.flags & FLAG_RANDOM) !== 0;
  const rules = (record.flags & FLAG_RULES) !== 0;
  if (random === rules) fail('flags 必须且只能标记 random/rules 之一');
  if (record.level < 2 || record.level > 14) fail(`level 越界: ${record.level}`);
  if (record.declarer < 0 || record.declarer > 3) fail(`declarer 越界: ${record.declarer}`);
  if (record.trumpCode !== NT_TRUMP_CODE && (record.trumpCode < 0 || record.trumpCode > 3)) {
    fail(`trumpCode 越界: ${record.trumpCode}`);
  }
  if (random) {
    if (record.cellIndex < 0 || record.cellIndex >= 52) fail(`cellIndex 越界: ${record.cellIndex}`);
    if (record.attackerLevel !== 0) fail('random 模式 attackerLevel 应为 0');
    if ((record.flags & FLAG_HAS_ATTACKER_LEVEL) !== 0) fail('random 模式不应有 hasAttackerLevel');
    if ((record.flags & FLAG_HAS_LAP) !== 0) fail('random 模式不应有 hasLap');
    if (record.lapA !== 0 || record.lapB !== 0) fail('random 模式 lap 应为 0');
    if (record.levelAfterA !== 0 || record.levelAfterB !== 0) fail('random 模式 levelAfter 应为 0');
    if (record.nextDeclarer !== 255) fail('random 模式 nextDeclarer 应为 255');
    return;
  }
  if (record.blockIndex !== 0 || record.cellIndex !== 0) fail('rules 模式 block/cell 应为 0');
  if (record.attackerLevel < 2 || record.attackerLevel > 14) {
    fail(`attackerLevel 越界: ${record.attackerLevel}`);
  }
  if ((record.flags & FLAG_HAS_ATTACKER_LEVEL) === 0) fail('rules 模式缺少 hasAttackerLevel');
  if ((record.flags & FLAG_HAS_LAP) === 0) fail('rules 模式缺少 hasLap');
  if (record.nextDeclarer < 0 || record.nextDeclarer > 3) {
    fail(`nextDeclarer 越界: ${record.nextDeclarer}`);
  }
  if (record.levelAfterA < 2 || record.levelAfterA > 14) fail(`levelAfterA 越界: ${record.levelAfterA}`);
  if (record.levelAfterB < 2 || record.levelAfterB > 14) fail(`levelAfterB 越界: ${record.levelAfterB}`);
}

function validateReveals(record: HandRecord, hand: ParsedHand): void {
  if (hand.reveals.length > MAX_REVEALS) fail(`revealCount 超限: ${hand.reveals.length}`);
  let prevDeal = -1;
  let prevPlayer = -1;
  let previous: { playerIndex: number; suit: Suit | null; strength: number } | null = null;
  for (const rev of hand.reveals) {
    if (!Number.isInteger(rev.dealIndex) || rev.dealIndex < 0 || rev.dealIndex > 99) {
      fail(`reveal.dealIndex 越界: ${rev.dealIndex}`);
    }
    if (rev.dealIndex < prevDeal) fail('reveal.dealIndex 必须非降序');
    if (rev.dealIndex === prevDeal && rev.player <= prevPlayer) {
      fail('同一 dealIndex 内 reveal.player 必须升序');
    }
    prevDeal = rev.dealIndex;
    prevPlayer = rev.player;
    if (rev.player < 0 || rev.player > 3) fail(`reveal.player 越界: ${rev.player}`);
    if (!Number.isInteger(rev.strength) || rev.strength < 1 || rev.strength > 4) {
      fail(`reveal.strength 越界: ${rev.strength}`);
    }

    const prefix = hand.deck.filter((_, i) => i <= rev.dealIndex && i % 4 === rev.player);
    if (rev.suit === null) {
      if (rev.strength !== 3 && rev.strength !== 4) fail('无主亮主 strength 必须为 3/4');
      const jokerRank = rev.strength === 3 ? Rank.SmallJoker : Rank.BigJoker;
      if (prefix.filter(c => c.rank === jokerRank).length < 2) {
        fail(`dealIndex ${rev.dealIndex} 的 ${jokerRank} 对子不足`);
      }
    } else {
      if (rev.strength > 2) fail('有主亮主 strength 必须为 1/2');
      const count = prefix.filter(c => c.suit === rev.suit && c.rank === hand.trump.level).length;
      if (count < rev.strength) {
        fail(`dealIndex ${rev.dealIndex} 的 ${rev.suit} 级牌不足 ${rev.strength} 张`);
      }
    }
    const candidate = { playerIndex: rev.player, suit: rev.suit, strength: rev.strength };
    if (!canOverride(previous, candidate)) {
      fail(`dealIndex ${rev.dealIndex} 的亮主无法覆盖前一条`);
    }
    previous = candidate;
  }
  if (hand.reveals.length > 0) {
    const last = hand.reveals[hand.reveals.length - 1];
    if (last.suit !== hand.trump.suit) fail('最后一条生效亮主与 trumpCode 不一致');
  }
  if (record.reveals.length !== hand.reveals.length) fail('reveals 数量不一致');
}

function validateParsed(record: HandRecord, hand: ParsedHand, meta: ParsedMeta): void {
  if (meta.deckHash !== deckHashFromCodes(record.deck)) fail('meta.deckHash 与 deck 不一致');
  if (record.deck.length !== DECK_SIZE) fail(`deck 长度应为 ${DECK_SIZE}`);
  if (new Set(record.deck).size !== DECK_SIZE) fail('deck 含重复 code');
  if (record.bottom.length !== 8) fail('bottom 长度应为 8');
  if (new Set(record.bottom).size !== 8) fail('bottom 含重复 code');
  const deckCodes = new Set(record.deck);
  for (const code of record.bottom) if (!deckCodes.has(code)) fail(`bottom 含 deck 外的 code: ${code}`);

  validateContext(record);
  validateReveals(record, hand);

  if (record.tricks.length < 1 || record.tricks.length > MAX_TRICKS) {
    fail(`trickCount 越界: ${record.tricks.length}`);
  }
  let expectedLead = record.declarer;
  for (let t = 0; t < record.tricks.length; t++) {
    const tr = record.tricks[t];
    if (tr.lead !== expectedLead) fail(`第 ${t} 墩领出者应为上一墩赢家 ${expectedLead}`);
    if (tr.counts.length !== 4) fail('trick counts 长度应为 4');
    const leadLen = tr.counts[0];
    if (leadLen < 1) fail(`第 ${t} 墩领出张数必须 ≥ 1`);
    if (tr.counts.some(c => c !== leadLen)) fail(`第 ${t} 墩四家出牌张数不相等`);
    if (tr.cards.length !== leadLen * 4) fail(`第 ${t} 墩 cards 数与 counts 不一致`);
    if (tr.winner < 0 || tr.winner > 3) fail(`第 ${t} 墩 winner 越界`);
    expectedLead = tr.winner;
  }

  const dealt = dealtHands(hand.deck);
  const initial = initialBottom(hand);
  const declarer = hand.trump.declarer;
  if (hand.bottom.length !== 8) fail('bottom 长度应为 8');
  const bottomIds = new Set(hand.bottom.map(c => c.id));
  if (bottomIds.size !== 8) fail('bottom 含重复牌');
  const merged = [...dealt[declarer], ...initial];
  if ([...bottomIds].some(id => !merged.some(c => c.id === id))) {
    fail('bottom 必须是庄家 33 张（发牌 25 + 初始底牌 8）的子集');
  }
  const opening = openingHands(hand);
  for (let p = 0; p < 4; p++) {
    if (opening[p].length !== 25) fail(`座位 ${p} 扣底后手牌应为 25 张`);
  }

  const played: Card[][] = [[], [], [], []];
  const playedIds = new Set<string>();
  for (const trick of hand.tricks) {
    if (trick.plays.length !== 4) fail('每墩必须有 4 个 play');
    const leadLen = trick.plays[0].cards.length;
    if (leadLen < 1) fail('每墩领出必须至少 1 张');
    for (let i = 0; i < 4; i++) {
      const p = trick.plays[i];
      if (p.seat !== (trick.lead + i) % 4) fail('trick plays 座位顺序不符');
      if (p.cards.length !== leadLen) fail('trick 四家出牌张数不相等');
      for (const c of p.cards) {
        if (playedIds.has(c.id)) fail(`牌 ${c.id} 被重复出牌`);
        playedIds.add(c.id);
        played[p.seat].push(c);
      }
    }
  }
  for (let p = 0; p < 4; p++) {
    if (played[p].length !== 25) fail(`座位 ${p} 出牌数应为 25`);
    if (!sameIds(played[p], opening[p])) fail(`座位 ${p} 出牌与扣底后手牌不一致`);
  }
  for (const id of bottomIds) if (playedIds.has(id)) fail(`底牌 ${id} 被出掉`);
  if (playedIds.size + bottomIds.size !== DECK_SIZE) fail('出牌 + 底牌未覆盖 108 张');

  const beforeTrick: Card[][][] = [];
  {
    const current = opening.map(h => [...h]);
    for (let t = 0; t < hand.tricks.length; t++) {
      beforeTrick.push(current.map(h => [...h]));
      for (const play of hand.tricks[t].plays) {
        current[play.seat] = current[play.seat].filter(c => !play.cards.some(pc => pc.id === c.id));
      }
    }
  }

  const nonzeroPenalties: [number, number] = [0, 0];
  let prevFailedTrick = -1;
  for (const f of hand.failedThrows) {
    if (f.trickIndex <= prevFailedTrick) fail('failedThrows.trickIndex 必须严格递增');
    prevFailedTrick = f.trickIndex;
    if (f.trickIndex < 0 || f.trickIndex >= hand.tricks.length) fail(`failedThrows.trickIndex 越界: ${f.trickIndex}`);
    const trick = hand.tricks[f.trickIndex];
    if (f.player !== trick.lead) fail('failedThrows.player 必须等于该墩领出者');
    if (f.player < 0 || f.player > 3) fail(`failedThrows.player 越界: ${f.player}`);
    if (![-10, 0, 10].includes(f.penaltyDelta)) fail(`failedThrows.penaltyDelta 非法: ${f.penaltyDelta}`);

    const attemptedIds = new Set(f.cards.map(c => c.id));
    if (attemptedIds.size !== f.cards.length) fail('failedThrows.cards 含重复牌');
    const handAtStart = beforeTrick[f.trickIndex][f.player];
    for (const id of attemptedIds) {
      if (!handAtStart.some(c => c.id === id)) fail(`failedThrows 尝试牌 ${id} 不在该墩开始时手牌中`);
    }
    const actualLeadIds = new Set(trick.plays[0].cards.map(c => c.id));
    for (const id of actualLeadIds) {
      if (!attemptedIds.has(id)) fail('实际领出必须是尝试甩牌的子集');
    }

    const declarerTeam = declarer % 2;
    const team = f.player % 2;
    if (team === declarerTeam) {
      if (f.penaltyDelta < 0) fail('庄家队甩牌罚分应为 +10 或 0');
      if (f.penaltyDelta !== 0) nonzeroPenalties[0] += 1;
    } else {
      if (f.penaltyDelta > 0) fail('闲家队甩牌罚分应为 -10 或 0');
      if (f.penaltyDelta !== 0) nonzeroPenalties[1] += 1;
    }
  }
  if (hand.failedThrows.length > hand.tricks.length) fail('failedThrows 数量超过 trick 数');
  for (let team = 0; team < 2; team++) {
    if (hand.settlement.throwPenalties[team] > 3) fail('throwPenalties 超过 3');
    if (hand.settlement.throwPenalties[team] !== nonzeroPenalties[team]) {
      fail(`throwPenalties[${team}] 与非零 penaltyDelta 数不一致`);
    }
  }

  const rawPts = attackerPointsRaw(hand);
  const deltaSum = hand.failedThrows.reduce((sum, f) => sum + f.penaltyDelta, 0);
  if (hand.settlement.attackerPoints !== rawPts + deltaSum) {
    fail('attackerPoints 与原始分 + 甩牌罚分不一致');
  }
  if (hand.settlement.bankerWon !== (hand.settlement.finalPts < 80)) {
    fail('bankerWon 与 finalPts 不一致');
  }
  if (hand.tricks.length > 0) {
    const last = hand.tricks[hand.tricks.length - 1];
    const wonByAttacker = last.winner % 2 !== declarer % 2;
    if (hand.settlement.attackerWonLastTrick !== wonByAttacker) {
      fail('attackerWonLastTrick 与最后一墩赢家不一致');
    }
  }
}

// ---- 机械 helper ----

/** 发牌后四家各 25 张（按 deck 的轮发顺序）。 */
export function dealtHands(deck: Card[]): Card[][] {
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < DEALT_CARDS; i++) hands[i % 4].push(deck[i]);
  return hands;
}

/** 初始底牌 = deck[100..108)。 */
export function initialBottom(hand: ParsedHand): Card[] {
  return hand.deck.slice(DEALT_CARDS, DEALT_CARDS + 8);
}

/** 庄家拿回初始底牌后的 33 张。 */
export function declarerHandBeforeBury(hand: ParsedHand): Card[] {
  return [...dealtHands(hand.deck)[hand.trump.declarer], ...initialBottom(hand)];
}

/** 扣底后四家各 25 张。 */
export function openingHands(hand: ParsedHand): Card[][] {
  const hands = dealtHands(hand.deck);
  const bottomIds = new Set(hand.bottom.map(c => c.id));
  const merged = [...hands[hand.trump.declarer], ...initialBottom(hand)];
  hands[hand.trump.declarer] = merged.filter(c => !bottomIds.has(c.id));
  return hands;
}

/** 第 dealIndex 张发完后，某座位的手牌前缀（0..99）。 */
export function handAtDealIndex(hand: ParsedHand, seat: number, dealIndex: number): Card[] {
  if (!Number.isInteger(dealIndex) || dealIndex < 0 || dealIndex > 99) {
    throw new Error(`dealIndex 越界: ${dealIndex}`);
  }
  return hand.deck.filter((_, i) => i <= dealIndex && i % 4 === seat);
}

/** 原始闲家分 = 闲家赢下的 trick.points 之和。 */
export function attackerPointsRaw(hand: ParsedHand): number {
  const declarerTeam = hand.trump.declarer % 2;
  return hand.tricks.reduce(
    (sum, t) => (t.winner % 2 !== declarerTeam ? sum + t.points : sum), 0,
  );
}

/** 第 t 墩领出决策前（不含该墩甩牌罚分）的闲家分。 */
export function attackerPointsBeforeTrick(hand: ParsedHand, t: number): number {
  if (!Number.isInteger(t) || t < 0 || t > hand.tricks.length) {
    throw new Error(`trick index 越界: ${t}`);
  }
  const declarerTeam = hand.trump.declarer % 2;
  let pts = 0;
  for (let i = 0; i < t; i++) {
    const trick = hand.tricks[i];
    if (trick.winner % 2 !== declarerTeam) pts += trick.points;
  }
  for (const f of hand.failedThrows) if (f.trickIndex < t) pts += f.penaltyDelta;
  return pts;
}

/** 第 t 墩领出后（含该墩甩牌罚分）的闲家分。 */
export function attackerPointsAfterLead(hand: ParsedHand, t: number): number {
  if (!Number.isInteger(t) || t < 0 || t >= hand.tricks.length) {
    throw new Error(`trick index 越界: ${t}`);
  }
  return attackerPointsBeforeTrick(hand, t)
    + hand.failedThrows.reduce((sum, f) => (f.trickIndex === t ? sum + f.penaltyDelta : sum), 0);
}

// ---- 读取 / 遍历 ----

function hasFilter(filter: ParseFilter | undefined): filter is ParseFilter {
  if (!filter) return false;
  return filter.mode !== undefined || filter.level !== undefined || filter.declarer !== undefined
    || filter.trump !== undefined || filter.blockIndex !== undefined || filter.cellIndex !== undefined;
}

function trumpCodeForFilter(trump: Suit | 'NT'): number {
  return trump === 'NT' ? NT_TRUMP_CODE : TRUMP_CODE_BY_SUIT[trump];
}

function filterMatchesIndex(entry: IndexEntry, filter: ParseFilter): boolean {
  if (filter.mode !== undefined) {
    const random = (entry.flags & FLAG_RANDOM) !== 0;
    if ((filter.mode === 'random') !== random) return false;
  }
  if (filter.level !== undefined && entry.level !== filter.level) return false;
  if (filter.declarer !== undefined && entry.declarer !== filter.declarer) return false;
  if (filter.trump !== undefined && entry.trumpCode !== trumpCodeForFilter(filter.trump)) return false;
  if (filter.blockIndex !== undefined && entry.blockIndex !== filter.blockIndex) return false;
  if (filter.cellIndex !== undefined && entry.cellIndex !== filter.cellIndex) return false;
  return true;
}

function filterMatchesRecord(record: HandRecord, filter: ParseFilter): boolean {
  if (filter.mode !== undefined) {
    const random = (record.flags & FLAG_RANDOM) !== 0;
    if ((filter.mode === 'random') !== random) return false;
  }
  if (filter.level !== undefined && record.level !== filter.level) return false;
  if (filter.declarer !== undefined && record.declarer !== filter.declarer) return false;
  if (filter.trump !== undefined && record.trumpCode !== trumpCodeForFilter(filter.trump)) return false;
  if (filter.blockIndex !== undefined && record.blockIndex !== filter.blockIndex) return false;
  if (filter.cellIndex !== undefined && record.cellIndex !== filter.cellIndex) return false;
  return true;
}

function indexOffsetsValid(entries: readonly IndexEntry[], buf: Buffer): boolean {
  for (const entry of entries) {
    const off = Number(entry.offset);
    if (!Number.isSafeInteger(off) || off < BIN_HEADER_SIZE || off + 4 > buf.length) return false;
    const len = buf.readUInt32LE(off);
    if (len === 0 || off + 4 + len > buf.length) return false;
  }
  return true;
}

function* iterateFilteredWithIndex(
  chain: ManifestChain, shardIndex: number, buf: Buffer,
  entries: readonly IndexEntry[], filter: ParseFilter, opts: ParseOptions,
): Iterable<ParsedHand> {
  for (const entry of entries) {
    if (!filterMatchesIndex(entry, filter)) continue;
    const offset = Number(entry.offset);
    const len = buf.readUInt32LE(offset);
    let record: HandRecord;
    try {
      record = decodeRecordPayload(buf.subarray(offset + 4, offset + 4 + len));
      if (record.chainHandIndex !== entry.chainHandIndex) {
        throw new Error(`.idx chainHandIndex 与记录不一致: ${entry.chainHandIndex}/${record.chainHandIndex}`);
      }
    } catch (err) {
      const e = contextual(err, {
        chainId: chain.chainId, shardIndex, offset,
        chainHandIndex: entry.chainHandIndex,
      });
      if (opts.skipBad) { opts.onSkip?.(e); continue; }
      throw e;
    }
    const expectedGlobal = chain.globalStart + entry.chainHandIndex;
    if (record.globalHandIndex !== expectedGlobal) {
      const e = new RecordParseError(
        `globalHandIndex 不一致: record=${record.globalHandIndex} expected=${expectedGlobal}`,
        {
          chainId: chain.chainId, shardIndex, offset,
          globalHandIndex: record.globalHandIndex, chainHandIndex: entry.chainHandIndex,
        },
      );
      if (opts.skipBad) { opts.onSkip?.(e); continue; }
      throw e;
    }
    let parsed: ParsedHand;
    try {
      parsed = parseHand(record, metaOf(chain, record), {
        validate: opts.validate,
        includeRaw: opts.includeRaw,
      });
    } catch (err) {
      const e = contextual(err, {
        chainId: chain.chainId, shardIndex, offset,
        globalHandIndex: record.globalHandIndex, chainHandIndex: record.chainHandIndex,
      });
      if (opts.skipBad) { opts.onSkip?.(e); continue; }
      throw e;
    }
    if (opts.predicate && !opts.predicate(parsed)) continue;
    yield parsed;
  }
}

function checkManifest(dataset: RecordDataset, opts: ParseOptions): void {
  if (dataset.manifest.status === 'running' && opts.allowRunning !== true) {
    throw new RecordParseError('manifest.status === running（使用 allowRunning 才读取）');
  }
}

function chainInfo(dataset: RecordDataset, chainId: number): ManifestChain {
  const info = dataset.manifest.chains.find(c => c.chainId === chainId);
  if (!info) throw new RecordParseError(`manifest 缺少 chain ${chainId}`);
  return info;
}

function metaOf(
  chain: ManifestChain, record: HandRecord,
): ParsedMeta {
  const global = chain.globalStart + record.chainHandIndex;
  if (record.globalHandIndex !== global) {
    throw new RecordParseError(
      `globalHandIndex 不一致: record=${record.globalHandIndex} expected=${global}`,
      { chainId: chain.chainId, chainHandIndex: record.chainHandIndex, globalHandIndex: record.globalHandIndex },
    );
  }
  return {
    chainId: chain.chainId,
    chainHandIndex: record.chainHandIndex,
    globalHandIndex: record.globalHandIndex,
    deckHash: deckHashFromCodes(record.deck),
  };
}

function* iterateShardWithDataset(
  dataset: RecordDataset, chain: ManifestChain, shardIndex: number, opts: ParseOptions,
): Iterable<ParsedHand> {
  const { binPath } = shardPaths(dataset.runDir, chain.chainId, shardIndex);
  if (!fs.existsSync(binPath)) return;
  const buf = fs.readFileSync(binPath);
  const header = decodeBinHeader(buf);
  if (header.formatVersion !== FORMAT_VERSION) {
    throw new RecordParseError(`.bin 版本不符: ${header.formatVersion}`);
  }
  if (header.chainId !== chain.chainId || header.shardIndex !== shardIndex) {
    throw new RecordParseError('.bin header 与路径不符');
  }
  const filter = hasFilter(opts.filter) ? opts.filter : undefined;
  if (filter !== undefined) {
    try {
      const entries = dataset.readIndex(chain.chainId, shardIndex);
      if (indexOffsetsValid(entries, buf)) {
        yield* iterateFilteredWithIndex(chain, shardIndex, buf, entries, filter, opts);
        return;
      }
    } catch {
      // .idx 不可用/损坏：退回顺序扫描
    }
  }

  let o = BIN_HEADER_SIZE;
  let expectedChainHand = header.startHandIndex;
  while (o + 4 <= buf.length) {
    const len = buf.readUInt32LE(o);
    if (len === 0 || o + 4 + len > buf.length) break; // footer / truncated tail
    const payload = buf.subarray(o + 4, o + 4 + len);
    const offset = o;
    o += 4 + len;

    let record: HandRecord;
    try {
      record = decodeRecordPayload(payload);
    } catch (err) {
      const e = contextual(err, {
        chainId: chain.chainId, shardIndex, offset, chainHandIndex: expectedChainHand,
      });
      if (opts.skipBad) { opts.onSkip?.(e); expectedChainHand += 1; continue; }
      throw e;
    }

    if (record.chainHandIndex !== expectedChainHand) {
      const e = new RecordParseError(
        `chainHandIndex 不连续: 期望 ${expectedChainHand}，实际 ${record.chainHandIndex}`,
        { chainId: chain.chainId, shardIndex, offset, chainHandIndex: record.chainHandIndex },
      );
      if (opts.skipBad) { opts.onSkip?.(e); expectedChainHand = record.chainHandIndex + 1; continue; }
      throw e;
    }
    expectedChainHand += 1;

    if (filter !== undefined && !filterMatchesRecord(record, filter)) continue;
    let parsed: ParsedHand;
    try {
      const meta = metaOf(chain, record);
      parsed = parseHand(record, meta, {
        validate: opts.validate,
        includeRaw: opts.includeRaw,
      });
    } catch (err) {
      const e = contextual(err, {
        chainId: chain.chainId, shardIndex, offset,
        globalHandIndex: record.globalHandIndex, chainHandIndex: record.chainHandIndex,
      });
      if (opts.skipBad) { opts.onSkip?.(e); continue; }
      throw e;
    }
    if (opts.predicate && !opts.predicate(parsed)) continue;
    yield parsed;
  }
}

export function* iterateParsedHands(
  runDir: string, opts: ParseOptions = {},
): Iterable<ParsedHand> {
  const dataset = RecordDataset.open(runDir);
  try {
    checkManifest(dataset, opts);
    for (const chain of dataset.manifest.chains) {
      for (let shard = 0; shard < dataset.shardCount(chain.chainId); shard++) {
        yield* iterateShardWithDataset(dataset, chain, shard, opts);
      }
    }
  } finally {
    dataset.close();
  }
}

export function* iterateShard(
  runDir: string, chainId: number, shardIndex: number, opts: ParseOptions = {},
): Iterable<ParsedHand> {
  const dataset = RecordDataset.open(runDir);
  try {
    checkManifest(dataset, opts);
    const chain = chainInfo(dataset, chainId);
    yield* iterateShardWithDataset(dataset, chain, shardIndex, opts);
  } finally {
    dataset.close();
  }
}

export function getParsedHand(
  dataset: RecordDataset, globalHandIndex: number, opts: ParseOptions = {},
): ParsedHand | null {
  checkManifest(dataset, opts);
  const chain = dataset.manifest.chains.find(
    c => globalHandIndex >= c.globalStart && globalHandIndex < c.globalStart + c.handsRequested,
  );
  if (!chain) return null;
  const record = dataset.getChainHand(chain.chainId, globalHandIndex - chain.globalStart);
  if (!record) return null;
  if (hasFilter(opts.filter) && !filterMatchesRecord(record, opts.filter)) return null;
  const meta = metaOf(chain, record);
  const parsed = parseHand(record, meta, {
    validate: opts.validate,
    includeRaw: opts.includeRaw,
  });
  if (opts.predicate && !opts.predicate(parsed)) return null;
  return parsed;
}
