/**
 * 录制小局的纯推进逻辑：随机分层调度、rules 等级循环、顺序发牌、
 * 停止/错误分类与错误报告。写盘由 record-writer.ts 负责。
 *
 * 两种模式共用：
 * - 座位固定 A=P0/P2、B=P1/P3，策略按队注入；
 * - 所有小局都传 `isFirstHand: false`（无抢庄：亮主只决定主牌，不改庄家）；
 * - 发牌走每条链自己的顺序 deck 流，context 抽样走独立流；
 * - 只接受完整手牌：`aborted` 或 `errors > 0` 立即终止整次运行；
 * - 不做链内去重；每手直接消费一次 deck 流。
 */
import fs from 'node:fs';
import path from 'node:path';
import { bottomMultiplier, classify, computeLevelChange, serialize } from '@poker/engine';
import type { Card, GameState, Suit } from '@poker/engine';
import { playHand } from './match.js';
import type { PlayHandOptions } from './match.js';
import type { HandEvent, Strategy } from './types.js';
import {
  CELLS_PER_BLOCK, LEVEL_MIN, NO_NEXT_DECLARER, NT_TRUMP_CODE, TRUMP_CODE_BY_SUIT,
  FLAG_ATTACKER_WON_LAST_TRICK, FLAG_BANKER_WON, FLAG_HAS_ATTACKER_LEVEL, FLAG_HAS_LAP,
  FLAG_RANDOM, FLAG_RULES, cardCode,
} from './record-types.js';
import type {
  ContextMode, FailedThrowRecord, HandRecord, RevealRecord, TrickRecord,
} from './record-types.js';
import {
  deckHashHex, deriveStreamSeed, drawDeck as drawDeckDefault,
  rngFromSeedHex, shuffleInPlace,
} from './record-rng.js';
import type { Rng } from './record-rng.js';

/** 进度上报间隔（hands）。 */
export const PROGRESS_INTERVAL = 1000;
/** 每多少手让出一次事件循环，使 SIGINT/SIGTERM 与 IPC stop 能被处理。 */
export const YIELD_INTERVAL = 100;

// ---- random 分层：每 52 手一个块，块内打乱 ----

export interface ScheduleSlot {
  blockIndex: number;
  /** 0..51：level = 2 + floor(cell/4)，declarer = cell % 4。 */
  cellIndex: number;
}

/** 每条链自己的 context 顺序流：块内 Fisher–Yates，块与块之间顺序不同。 */
export class RandomScheduler {
  private blockIndex = -1;
  private order: number[] = [];
  private position = CELLS_PER_BLOCK;

  constructor(private readonly rand: Rng) {}

  next(): ScheduleSlot {
    if (this.position >= CELLS_PER_BLOCK) {
      this.blockIndex += 1;
      this.order = Array.from({ length: CELLS_PER_BLOCK }, (_, i) => i);
      shuffleInPlace(this.order, this.rand);
      this.position = 0;
    }
    return { blockIndex: this.blockIndex, cellIndex: this.order[this.position++] };
  }
}

// ---- rules 模式：无必打、2..A 循环 ----

export interface RulesState {
  /** [TeamA(P0/P2), TeamB(P1/P3)]。 */
  levels: [number, number];
  laps: [number, number];
  declarerIdx: number;
}

export function initialRulesState(): RulesState {
  return { levels: [2, 2], laps: [0, 0], declarerIdx: 0 };
}

export interface RulesAdvance {
  state: RulesState;
  attackerSits: boolean;
  delta: number;
  nextDeclarer: number;
}

/**
 * 一手结束后的等级/庄家推进（不用 advanceLevel：那里有必打 K/A 与 A 上结束）。
 * 跨过 A 即回绕到 2 并累加圈数：K+2 → 2（lap+1）、A+1 → 2、Q+3 → 2 …
 */
export function advanceRules(state: RulesState, finalPts: number): RulesAdvance {
  const bankerTeam = state.declarerIdx % 2;
  const attackerSits = !(finalPts < 80);
  const changes = computeLevelChange(finalPts);
  const delta = attackerSits ? changes.attackerChange : changes.defenderChange;
  const advancingTeam = attackerSits ? (bankerTeam + 1) % 2 : bankerTeam;

  const raw = state.levels[advancingTeam] + delta;
  const offset = raw - LEVEL_MIN;
  const lapGain = Math.floor(offset / 13);
  const levels: [number, number] = [state.levels[0], state.levels[1]];
  const laps: [number, number] = [state.laps[0], state.laps[1]];
  levels[advancingTeam] = LEVEL_MIN + (offset % 13);
  laps[advancingTeam] += lapGain;

  const nextDeclarer = attackerSits
    ? (state.declarerIdx + 1) % 4
    : (state.declarerIdx + 2) % 4;

  return {
    state: { levels, laps, declarerIdx: nextDeclarer },
    attackerSits,
    delta,
    nextDeclarer,
  };
}

// ---- 运行 ----

export interface ChainDeps {
  /** 测试注入：替换 playHand（默认真打）。 */
  play?: (opts: PlayHandOptions) => HandEvent;
  /** 测试注入：替换发牌（默认从顺序流 Fisher–Yates）。 */
  drawDeck?: (rand: Rng) => Card[];
}

export interface ChainRunOptions {
  chainId: number;
  /** 链 0 的首手全局 index。 */
  globalStart: number;
  seedHex: string;
  mode: ContextMode;
  handsRequested: number;
  strategies: [Strategy, Strategy];
  onRecord: (record: HandRecord, deckHash: bigint) => void;
  onProgress?: (completed: number) => void;
  shouldStop?: () => boolean;
  deps?: ChainDeps;
}

export type ChainErrorKind = 'abort' | 'strategy-error' | 'exception';

export interface ChainErrorContext {
  mode: ContextMode;
  blockIndex: number;
  cellIndex: number;
  level: number;
  declarer: number;
  attackerLevel: number;
  hasAttackerLevel: boolean;
  lapA: number;
  lapB: number;
}

export interface ChainErrorInfo {
  kind: ChainErrorKind;
  chainId: number;
  globalHandIndex: number;
  chainHandIndex: number;
  seed: string;
  strategies: { A: string; B: string };
  context: ChainErrorContext;
  /** 物理卡 id 列表（按发牌顺序）。 */
  deck: string[];
  event: HandEvent | null;
  state: GameState | null;
  message: string;
  stack: string | null;
}

export interface ChainRunResult {
  status: 'completed' | 'stopped' | 'error';
  handsCompleted: number;
  error?: ChainErrorInfo;
}

interface HandPlan {
  blockIndex: number;
  cellIndex: number;
  level: number;
  declarer: number;
  /** 传给 playHand 的 attackerLevel（random 模式为 level，仅满足事件字段）。 */
  playAttackerLevel: number;
  /** 写进记录的 attackerLevel（random 模式 0）。 */
  recordAttackerLevel: number;
  hasAttackerLevel: boolean;
  hasLap: boolean;
  lapA: number;
  lapB: number;
  levelAfterA: number;
  levelAfterB: number;
  nextDeclarer: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stackOf(err: unknown): string | null {
  return err instanceof Error && err.stack ? err.stack : null;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>(resolve => { setImmediate(() => resolve()); });
}

interface RevealLog {
  dealIndex: number;
  player: number;
  suit: Suit | null;
  strength: number;
}

interface ThrowFailureLog {
  trickIndex: number;
  player: number;
  attemptedCards: Card[];
  penaltyDelta: number;
}

function buildRecord(
  plan: HandPlan, ev: HandEvent, state: GameState, deck: readonly Card[], chainHandIndex: number,
  globalHandIndex: number, mode: ContextMode,
  revealLog: readonly RevealLog[], throwFailureLog: readonly ThrowFailureLog[],
): HandRecord {
  const trump = state.trumpDeclaration;
  if (!trump) throw new Error('最终 state 缺少 trumpDeclaration');

  const lastTrick = state.trickHistory.length > 0
    ? state.trickHistory[state.trickHistory.length - 1]
    : null;
  const multiplier = lastTrick
    ? bottomMultiplier(classify(lastTrick.plays[0].cards, trump))
    : 2;

  const reveals: RevealRecord[] = revealLog.map(r => ({
    player: r.player,
    suit: r.suit === null ? null : TRUMP_CODE_BY_SUIT[r.suit],
    strength: r.strength,
    dealIndex: r.dealIndex,
  }));

  const failedThrows: FailedThrowRecord[] = throwFailureLog.map(f => ({
    trickIndex: f.trickIndex,
    player: f.player,
    penaltyDelta: f.penaltyDelta,
    cards: f.attemptedCards.map(cardCode),
  }));

  const tricks: TrickRecord[] = state.trickHistory.map(t => ({
    lead: t.leadPlayerIndex,
    counts: [
      t.plays[0].cards.length, t.plays[1].cards.length,
      t.plays[2].cards.length, t.plays[3].cards.length,
    ],
    cards: t.plays.flatMap(p => p.cards.map(cardCode)),
    winner: t.winnerIndex,
    points: t.points,
  }));

  const flags = (mode === 'random' ? FLAG_RANDOM : FLAG_RULES)
    | (plan.hasAttackerLevel ? FLAG_HAS_ATTACKER_LEVEL : 0)
    | (plan.hasLap ? FLAG_HAS_LAP : 0)
    | (ev.attackerWonLastTrick ? FLAG_ATTACKER_WON_LAST_TRICK : 0)
    | (ev.bankerWon ? FLAG_BANKER_WON : 0);

  return {
    globalHandIndex,
    chainHandIndex,
    blockIndex: plan.blockIndex,
    cellIndex: plan.cellIndex,
    level: plan.level,
    declarer: ev.declarerIdx,
    attackerLevel: plan.recordAttackerLevel,
    trumpCode: trump.trumpSuit === null ? NT_TRUMP_CODE : TRUMP_CODE_BY_SUIT[trump.trumpSuit],
    flags,
    lapA: plan.lapA,
    lapB: plan.lapB,
    levelAfterA: plan.levelAfterA,
    levelAfterB: plan.levelAfterB,
    nextDeclarer: plan.nextDeclarer,
    deck: deck.map(cardCode),
    bottom: state.bottomCards.map(cardCode),
    reveals,
    failedThrows,
    tricks,
    attackerPoints: state.attackerPoints,
    finalPts: ev.finalPts,
    bottomPoints: ev.bottomPoints,
    bottomMultiplier: multiplier,
    kouDiAdd: ev.kouDiAdd,
    throwPenalties: [state.throwPenalties[0], state.throwPenalties[1]],
  };
}

/**
 * 跑一条链直到 handsRequested 或停止条件。
 *
 * 每手直接消费一次 deck 流，不做链内去重；`chainHandIndex` 与流位置一一对应。
 */
export async function runChain(opts: ChainRunOptions): Promise<ChainRunResult> {
  const mode = opts.mode;
  const play = opts.deps?.play ?? playHand;
  const draw = opts.deps?.drawDeck ?? drawDeckDefault;
  const progressInterval = PROGRESS_INTERVAL;

  const deckRng = rngFromSeedHex(deriveStreamSeed(opts.seedHex, opts.chainId, 'deck'));
  const contextRng = rngFromSeedHex(deriveStreamSeed(opts.seedHex, opts.chainId, 'context'));
  const scheduler = new RandomScheduler(contextRng);
  let rules = initialRulesState();

  let completed = 0;
  const strategies: { A: string; B: string } = {
    A: opts.strategies[0].name,
    B: opts.strategies[1].name,
  };

  const makeError = (
    kind: ChainErrorKind, message: string, stack: string | null,
    plan: HandPlan, deck: readonly Card[], event: HandEvent | null, state: GameState | null,
  ): ChainRunResult => ({
    status: 'error',
    handsCompleted: completed,
    error: {
      kind,
      chainId: opts.chainId,
      globalHandIndex: opts.globalStart + completed,
      chainHandIndex: completed,
      seed: opts.seedHex,
      strategies,
      context: {
        mode,
        blockIndex: plan.blockIndex,
        cellIndex: plan.cellIndex,
        level: plan.level,
        declarer: plan.declarer,
        attackerLevel: plan.recordAttackerLevel,
        hasAttackerLevel: plan.hasAttackerLevel,
        lapA: plan.lapA,
        lapB: plan.lapB,
      },
      deck: deck.map(c => c.id),
      event,
      state,
      message,
      stack,
    },
  });

  while (completed < opts.handsRequested) {
    if (opts.shouldStop?.()) break;

    // --- context ---
    let plan: HandPlan;
    if (mode === 'random') {
      const { blockIndex, cellIndex } = scheduler.next();
      const level = LEVEL_MIN + Math.floor(cellIndex / 4);
      plan = {
        blockIndex,
        cellIndex,
        level,
        declarer: cellIndex % 4,
        playAttackerLevel: level,
        recordAttackerLevel: 0,
        hasAttackerLevel: false,
        hasLap: false,
        lapA: 0,
        lapB: 0,
        levelAfterA: 0,
        levelAfterB: 0,
        nextDeclarer: NO_NEXT_DECLARER,
      };
    } else {
      const bankerTeam = rules.declarerIdx % 2;
      plan = {
        blockIndex: 0,
        cellIndex: 0,
        level: rules.levels[bankerTeam],
        declarer: rules.declarerIdx,
        playAttackerLevel: rules.levels[1 - bankerTeam],
        recordAttackerLevel: rules.levels[1 - bankerTeam],
        hasAttackerLevel: true,
        hasLap: true,
        lapA: rules.laps[0],
        lapB: rules.laps[1],
        levelAfterA: rules.levels[0],
        levelAfterB: rules.levels[1],
        nextDeclarer: NO_NEXT_DECLARER,
      };
    }

    // --- deck（不去重；每手直接消费一次顺序流） ---
    const deck = draw(deckRng);
    const deckHash = deckHashHex(deck);

    // --- play ---
    let ev: HandEvent | null = null;
    let captured: GameState | null = null;
    const revealLog: RevealLog[] = [];
    const throwFailureLog: ThrowFailureLog[] = [];
    try {
      ev = play({
        deck,
        handIndex: completed,
        declarerIdx: plan.declarer,
        level: plan.level,
        attackerLevel: plan.playAttackerLevel,
        isFirstHand: false,
        strategies: opts.strategies,
        onComplete: state => { captured = state; },
        onReveal: e => { revealLog.push(e); },
        onThrowFailure: e => { throwFailureLog.push(e); },
      });
    } catch (err) {
      return makeError('exception', messageOf(err), stackOf(err), plan, deck, null, null);
    }

    if (ev.aborted || ev.errors > 0) {
      const kind: ChainErrorKind = ev.aborted ? 'abort' : 'strategy-error';
      const message = ev.aborted
        ? `引擎无法继续（aborted，座位 ${ev.abortPlayerIdx ?? '?'}）`
        : `策略产生非法出牌或静默兜底（errors=${ev.errors}）`;
      return makeError(kind, message, null, plan, deck, ev, captured);
    }
    if (!captured) {
      return makeError('exception', 'onComplete 未捕获最终 state', null, plan, deck, ev, null);
    }
    const finalState: GameState = captured;

    // --- rules 推进（记录写成功后再生效） ---
    let nextRules: RulesState | null = null;
    if (mode === 'rules') {
      const adv = advanceRules(rules, ev.finalPts);
      nextRules = adv.state;
      plan = {
        ...plan,
        lapA: adv.state.laps[0],
        lapB: adv.state.laps[1],
        levelAfterA: adv.state.levels[0],
        levelAfterB: adv.state.levels[1],
        nextDeclarer: adv.nextDeclarer,
      };
    }

    let record: HandRecord;
    try {
      record = buildRecord(
        plan, ev, finalState, deck, completed, opts.globalStart + completed, mode,
        revealLog, throwFailureLog,
      );
    } catch (err) {
      return makeError('exception', messageOf(err), stackOf(err), plan, deck, ev, finalState);
    }

    try {
      opts.onRecord(record, BigInt(`0x${deckHash}`));
    } catch (err) {
      return makeError('exception', messageOf(err), stackOf(err), plan, deck, ev, finalState);
    }

    if (nextRules) rules = nextRules;
    completed += 1;

    if (completed % progressInterval === 0) opts.onProgress?.(completed);
    if (completed % YIELD_INTERVAL === 0) await yieldToEventLoop();
  }

  opts.onProgress?.(completed);
  return {
    status: completed >= opts.handsRequested ? 'completed' : 'stopped',
    handsCompleted: completed,
  };
}

// ---- 错误报告 ----

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** 写 `<runDir>/errors/chain-XX-hand-YYYYYY.json`，返回相对 runDir 的路径。 */
export function writeErrorReport(runDir: string, info: ChainErrorInfo): string {
  const errorsDir = path.join(runDir, 'errors');
  fs.mkdirSync(errorsDir, { recursive: true });
  const name = `chain-${pad(info.chainId, 2)}-hand-${pad(info.chainHandIndex, 6)}.json`;
  const rel = path.posix.join('errors', name);

  let stateJson: string | null = null;
  if (info.state) {
    try {
      stateJson = serialize(info.state, [false, false, false, false], false);
    } catch {
      stateJson = null;
    }
  }

  const body = {
    kind: info.kind,
    chainId: info.chainId,
    globalHandIndex: info.globalHandIndex,
    chainHandIndex: info.chainHandIndex,
    seed: info.seed,
    strategies: info.strategies,
    context: info.context,
    deck: info.deck,
    event: info.event,
    state: stateJson,
    error: { message: info.message, stack: info.stack },
  };
  fs.writeFileSync(path.join(runDir, rel), `${JSON.stringify(body, null, 2)}\n`);
  return rel;
}
