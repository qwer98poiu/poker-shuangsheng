import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCard, createInitialState, GamePhase, Suit } from '@poker/engine';
import type { Card, GameState, PlayerState } from '@poker/engine';

// 可切换的 dev 参数（getter 延迟读取，测试内改 mockDev 生效）。
// 默认 seed=42：与 gameStore.test 一致，种子局结果确定。
const mockDev = vi.hoisted(() => ({ seed: 42 as number | null, auto: false, speed: 8 }));
vi.mock('../dev.js', () => ({
  devParams: {
    get seed() { return mockDev.seed; },
    get auto() { return mockDev.auto; },
    get speed() { return mockDev.speed; },
  },
  seedFor: (seed: number, roundNumber: number) => (seed + roundNumber * 31) >>> 0,
}));

import { useGameStore } from '../store/gameStore.js';
import {
  pickSnapshot, persistenceEnabled, attachPersistence, restoreFromServer,
  SAVE_INTERVAL_MS, SNAPSHOT_VERSION, encodeSnapshot, decodeSnapshot,
  type Envelope, type Snapshot,
} from '../store/persistence.js';

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function waitFor(pred: () => boolean, guard = 4000): Promise<void> {
  let n = 0;
  while (!pred() && n++ < guard) await advance(200);
  expect(pred()).toBe(true);
}

function emptyPlayer(name: string, index: number): PlayerState {
  return { name, index, hand: [], isHuman: false };
}

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);

function playingState(): GameState {
  const base = createInitialState(
    [emptyPlayer('AI-1', 0), emptyPlayer('AI-2', 1), emptyPlayer('AI-3', 2), emptyPlayer('AI-4', 3)],
    0, 2, false,
  );
  // Playing 阶段必有 trumpDeclaration（buildAIContext 依赖，缺了 AI 会崩）
  return { ...base, phase: GamePhase.Playing, trumpDeclaration: { declarerIndex: 0, trumpSuit: null, level: 2 } };
}

/** 合成 round_end 快照的 GameState（庄家 P1、无主、闲家 5 分）。 */
function roundEndState(attackerPoints: number): GameState {
  const base = createInitialState(
    [emptyPlayer('AI-1', 0), emptyPlayer('AI-2', 1), emptyPlayer('AI-3', 2), emptyPlayer('AI-4', 3)],
    1, 2, false,
  );
  return {
    ...base,
    phase: GamePhase.RoundEnd,
    trumpDeclaration: { declarerIndex: 1, trumpSuit: null, level: 2 },
    attackerPoints,
    bottomCards: [],
    trickHistory: [],
  };
}

function makeSnapshot(gameState: GameState, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    gameState,
    localPlayerIndex: 0,
    aiPlayers: [true, true, true, true],
    debug: false,
    roundNumber: 0,
    teamLevels: [2, 2],
    matchOver: false,
    message: '',
    settledTrick: null,
    dealingDeck: null,
    ...overrides,
  };
}

function resetStore(): void {
  useGameStore.setState({
    mode: 'setup',
    gameState: null,
    localPlayerIndex: 0,
    selectedCardIds: [],
    lockedCardIds: [],
    aiPlayers: [false, true, true, true],
    message: '',
    errorMessage: null,
    debug: false,
    lastTrickReview: false,
    highlightedCards: [],
    settledTrick: null,
    roundNumber: 0,
    teamLevels: [2, 2],
    matchOver: false,
  });
}

interface RecordedCall { url: string; init?: RequestInit }

function stubFetch(getResponse: () => Envelope): { calls: RecordedCall[]; impl: typeof fetch } {
  const calls: RecordedCall[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => getResponse(),
    } as unknown as Response;
  }) as typeof fetch;
  return { calls, impl };
}

/** 线格式信封：data 为 base64（与真实 POST/GET 相同编码路径）。 */
const envelopeOf = (snapshot: Snapshot | null): Envelope => ({
  version: SNAPSHOT_VERSION,
  savedAt: 123,
  data: snapshot ? encodeSnapshot(snapshot) : '',
});

let detach: (() => void) | null = null;
let recorded: RecordedCall[] = [];
let response: Envelope = envelopeOf(null);

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  const { calls, impl } = stubFetch(() => response);
  recorded = calls;
  vi.stubGlobal('fetch', impl);
});

afterEach(() => {
  detach?.();
  detach = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockDev.seed = 42;
  mockDev.auto = false;
  mockDev.speed = 8;
});

describe('persistenceEnabled — 自动化流绕过', () => {
  it('?auto=1 关闭', () => {
    expect(persistenceEnabled({ auto: true, seed: null, speed: 1 })).toBe(false);
  });

  it('?seed=N 关闭', () => {
    expect(persistenceEnabled({ auto: false, seed: 42, speed: 1 })).toBe(false);
  });

  it('无参数开启', () => {
    expect(persistenceEnabled({ auto: false, seed: null, speed: 1 })).toBe(true);
  });
});

describe('pickSnapshot', () => {
  const dealingState = (): GameState => createInitialState(
    [emptyPlayer('A', 0), emptyPlayer('B', 1), emptyPlayer('C', 2), emptyPlayer('D', 3)],
    0, 2, false,
  );

  it('dealing 无洗牌堆返回 null（不可恢复，保留旧快照）', () => {
    expect(pickSnapshot({
      ...useGameStore.getState(), mode: 'playing', gameState: dealingState(), dealingDeck: null,
    })).toBeNull();
  });

  it('dealing 有洗牌堆可快照（含 108 张）', () => {
    const deck = Array.from({ length: 108 }, (_, i) => c('S', 2, i));
    const snap = pickSnapshot({
      ...useGameStore.getState(), mode: 'playing', gameState: dealingState(), dealingDeck: deck,
    });
    expect(snap).not.toBeNull();
    expect(snap!.dealingDeck!.length).toBe(108);
  });

  it('线格式为 base64：不含明文手牌，可无损还原（含中文）', () => {
    const snap = makeSnapshot(playingState(), {
      message: '发牌中... ♠A 🃏JOKER',
      settledTrick: null,
    });
    const wire = encodeSnapshot(snap);
    // 明文字段/中文/花色符号均不可见
    expect(wire).not.toContain('phase');
    expect(wire).not.toContain('trumpSuit');
    expect(wire).not.toContain('发牌');
    expect(wire).not.toContain('♠');
    expect(decodeSnapshot(wire)).toEqual(snap);
  });

  it("mode='setup' 返回 null", () => {
    expect(pickSnapshot({ ...useGameStore.getState(), mode: 'setup', gameState: playingState() })).toBeNull();
  });

  it('白名单字段精确：瞬态字段（选中/锁定/高亮/回看/错误）不入快照', () => {
    useGameStore.setState({
      mode: 'playing',
      gameState: playingState(),
      selectedCardIds: ['x'],
      lockedCardIds: ['z'],
      highlightedCards: ['y'],
      lastTrickReview: true,
      errorMessage: 'e',
    });
    const snap = pickSnapshot(useGameStore.getState());
    expect(snap).not.toBeNull();
    expect(Object.keys(snap!).sort()).toEqual([
      'aiPlayers', 'dealingDeck', 'debug', 'gameState', 'localPlayerIndex',
      'matchOver', 'message', 'roundNumber', 'settledTrick', 'teamLevels',
    ]);
    expect(snap!.gameState!.phase).toBe(GamePhase.Playing);
  });
});

describe('attachPersistence — 防抖保存', () => {
  it('节流：首次变更立即落盘，冷却内合并、冷却结束补发一次', async () => {
    useGameStore.setState({ mode: 'playing', gameState: playingState() });
    detach = attachPersistence(useGameStore, { enabled: true });

    for (let i = 0; i < 5; i++) useGameStore.getState().selectCard(`c${i}`);
    // 首次变更立即保存（不等防抖），其余 4 次在冷却期内合并
    let posts = recorded.filter(r => r.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0].init!.body as string);
    expect(body.version).toBe(SNAPSHOT_VERSION);
    expect(body.data).toEqual(expect.any(String));
    const saved = decodeSnapshot(body.data);
    expect(saved.gameState!.phase).toBe(GamePhase.Playing);
    expect(saved.localPlayerIndex).toBe(0);

    // 冷却结束时 trailing 补发最新快照，此后不再增加
    await advance(SAVE_INTERVAL_MS);
    posts = recorded.filter(r => r.init?.method === 'POST');
    expect(posts).toHaveLength(2);
    await advance(SAVE_INTERVAL_MS * 2);
    expect(recorded.filter(r => r.init?.method === 'POST')).toHaveLength(2);
  });

  it('发牌开始立即落盘：快照含 108 张洗牌堆，之后按间隔续存', async () => {
    detach = attachPersistence(useGameStore, { enabled: true });

    // 开局第一张牌同步发出 → 订阅者立即保存（纯 trailing 防抖会被发牌的
    // 连续变更无限顺延，整个发牌期间一次都存不出去——节流修复该问题）
    useGameStore.getState().startGame([true, true, true, true], false);
    let posts = recorded.filter(r => r.init?.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(posts[0].init!.body as string);
    expect(decodeSnapshot(body.data).gameState!.phase).toBe(GamePhase.Dealing);
    expect(decodeSnapshot(body.data).dealingDeck).toHaveLength(108);

    // 冷却结束后：发牌仍在继续 → checkpoint 续存
    await advance(SAVE_INTERVAL_MS + 50);
    posts = recorded.filter(r => r.init?.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(2);
    const lastBody = JSON.parse(posts[posts.length - 1].init!.body as string);
    expect(decodeSnapshot(lastBody.data).gameState!.phase).toBe(GamePhase.Dealing);
  });

  it('冷却期内亮主：绕过节流立即落盘', async () => {
    detach = attachPersistence(useGameStore, { enabled: true });

    // 注入发牌态 → 首沿立即落盘 #1
    const deck = Array.from({ length: 108 }, (_, i) => c('S', 2, i));
    useGameStore.setState({
      mode: 'playing',
      gameState: { ...playingState(), phase: GamePhase.Dealing },
      dealingDeck: deck,
    });
    expect(recorded.filter(r => r.init?.method === 'POST')).toHaveLength(1);
    await advance(50);

    // 冷却期内普通变更：被节流抑制
    useGameStore.getState().selectCard('b');
    expect(recorded.filter(r => r.init?.method === 'POST')).toHaveLength(1);

    // 冷却期内亮主：立即落盘 #2（发牌中刷新若回退掉人类亮主，重放无法恢复）
    const gs = useGameStore.getState().gameState!;
    useGameStore.setState({
      gameState: {
        ...gs,
        reveals: [...gs.reveals, { playerIndex: 1, suit: Suit.Spades, strength: 1 }],
      },
    });
    expect(recorded.filter(r => r.init?.method === 'POST')).toHaveLength(2);

    // 亮主落盘重置冷却：随后的普通变更仍被抑制
    useGameStore.getState().selectCard('d');
    expect(recorded.filter(r => r.init?.method === 'POST')).toHaveLength(2);
  });

  it('gate 关闭（?seed=N 且未显式 enabled）→ 零请求', async () => {
    mockDev.seed = 42;
    useGameStore.setState({ mode: 'playing', gameState: playingState() });
    detach = attachPersistence(useGameStore); // 不传 enabled：走 persistenceEnabled()
    for (let i = 0; i < 3; i++) useGameStore.getState().selectCard(`c${i}`);
    await advance(1000);
    expect(recorded).toHaveLength(0);
  });
});

describe('restoreFromServer — 恢复与续链', () => {
  it('发牌中刷新：恢复洗牌堆并从断点精确续发', async () => {
    useGameStore.getState().startGame([true, true, true, true], false);
    await advance(450); // speed=8 → 已发约 30 张
    const before = useGameStore.getState();
    const dealtBefore = before.gameState!.dealtCards.reduce((s, a) => s + a.length, 0);
    expect(dealtBefore).toBeGreaterThan(0);
    expect(dealtBefore).toBeLessThan(100);

    const snap = pickSnapshot(before)!;
    expect(snap.gameState!.phase).toBe(GamePhase.Dealing);
    expect(snap.dealingDeck!.length).toBe(108);
    resetStore();

    response = envelopeOf(snap);
    await expect(restoreFromServer(useGameStore)).resolves.toBe(true);

    // 恢复即同步续发一张：断点精确衔接
    const dealtAfter = useGameStore.getState().gameState!
      .dealtCards.reduce((s, a) => s + a.length, 0);
    expect(dealtAfter).toBe(dealtBefore + 1);

    // 剩余发完 → 全 AI 自动亮主扣底 → 进入出牌，各家恰好 25 张
    await waitFor(() => useGameStore.getState().gameState!.phase === GamePhase.Playing);
    const playing = useGameStore.getState().gameState!;
    expect(playing.players.every(p => p.hand.length === 25)).toBe(true);
  });

  it('恢复 playing 快照：瞬态字段复位，runAiTurns 续打下一墩', async () => {
    useGameStore.getState().startGame([true, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === GamePhase.Playing);
    await waitFor(() => (useGameStore.getState().gameState?.tricksPlayed ?? 0) >= 1);

    const snap = pickSnapshot(useGameStore.getState())!;
    expect(snap.gameState!.phase).toBe(GamePhase.Playing);
    resetStore();

    response = envelopeOf(snap);
    await expect(restoreFromServer(useGameStore)).resolves.toBe(true);

    const st = useGameStore.getState();
    expect(st.mode).toBe('playing');
    expect(st.gameState!.phase).toBe(GamePhase.Playing);
    expect(st.gameState!.tricksPlayed).toBe(1);
    expect(st.selectedCardIds).toEqual([]);
    expect(st.lockedCardIds).toEqual([]);
    expect(st.highlightedCards).toEqual([]);
    expect(st.lastTrickReview).toBe(false);
    expect(st.errorMessage).toBeNull();

    // AI 链重建：续打到第 2 墩结束（种子局确定性）
    await waitFor(() => useGameStore.getState().gameState!.tricksPlayed === 2);
  });

  it('恢复后二次调用返回 false（mode 已非 setup）', async () => {
    response = envelopeOf(makeSnapshot(playingState()));
    await expect(restoreFromServer(useGameStore)).resolves.toBe(true);
    await expect(restoreFromServer(useGameStore)).resolves.toBe(false);
  });

  it('round_end 快照重放开局：advance 后进入新一局发牌', async () => {
    response = envelopeOf(makeSnapshot(roundEndState(5)));
    await expect(restoreFromServer(useGameStore)).resolves.toBe(true);
    expect(useGameStore.getState().roundNumber).toBe(0);

    await advance(400); // tick(3000)=375ms 调度 startNewRound + 首几张发牌（speed=8 发完需 ~1.5s，仍在 Dealing）
    expect(useGameStore.getState().gameState!.phase).toBe(GamePhase.Dealing);
    expect(useGameStore.getState().roundNumber).toBe(1);
  });

  it('matchOver 快照原地停：不开新局，message 保留', async () => {
    response = envelopeOf(makeSnapshot(roundEndState(5), {
      matchOver: true,
      roundNumber: 3,
      message: '🏆 玩家1/AI-3 队胜出！',
    }));
    await expect(restoreFromServer(useGameStore)).resolves.toBe(true);

    await advance(6000);
    expect(useGameStore.getState().gameState!.phase).toBe(GamePhase.RoundEnd);
    expect(useGameStore.getState().roundNumber).toBe(3);
    expect(useGameStore.getState().matchOver).toBe(true);
    expect(useGameStore.getState().message).toBe('🏆 玩家1/AI-3 队胜出！');
  });

  it('revealing 快照（全 AI）：finalize 定时器重挂，自动进入出牌', async () => {
    useGameStore.getState().startGame([true, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === GamePhase.Revealing);

    const snap = pickSnapshot(useGameStore.getState())!;
    expect(snap.gameState!.currentReveal).not.toBeNull(); // seed=42 有人亮主
    resetStore();

    response = envelopeOf(snap);
    await expect(restoreFromServer(useGameStore)).resolves.toBe(true);
    expect(useGameStore.getState().gameState!.phase).toBe(GamePhase.Revealing);

    await waitFor(() => useGameStore.getState().gameState!.phase === GamePhase.Playing);
  });

  it('无存档（snapshot:null）返回 false，停留 setup', async () => {
    response = envelopeOf(null);
    await expect(restoreFromServer(useGameStore)).resolves.toBe(false);
    expect(useGameStore.getState().mode).toBe('setup');
  });

  it('版本不匹配的快照忽略', async () => {
    response = { version: 999, savedAt: 1, data: encodeSnapshot(makeSnapshot(playingState())) };
    await expect(restoreFromServer(useGameStore)).resolves.toBe(false);
    expect(useGameStore.getState().mode).toBe('setup');
  });

  it('data 非合法编码/JSON → 拒绝恢复', async () => {
    response = { version: SNAPSHOT_VERSION, savedAt: 1, data: 'not-base64-json!!!' };
    await expect(restoreFromServer(useGameStore)).resolves.toBe(false);
    expect(useGameStore.getState().mode).toBe('setup');
  });

  it('dealing 快照缺洗牌堆 → 拒绝恢复（结构校验）', async () => {
    response = envelopeOf(makeSnapshot(createInitialState(
      [emptyPlayer('A', 0), emptyPlayer('B', 1), emptyPlayer('C', 2), emptyPlayer('D', 3)],
      0, 2, false,
    ))); // makeSnapshot 默认 dealingDeck: null
    await expect(restoreFromServer(useGameStore)).resolves.toBe(false);
    expect(useGameStore.getState().mode).toBe('setup');
  });
});
