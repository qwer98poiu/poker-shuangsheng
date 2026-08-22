import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCard, createInitialState, GamePhase, Suit } from '@poker/engine';
import type { Card, GameState, PlayerState } from '@poker/engine';

// Deterministic dev params (same derivation as src/dev.ts).
// mockDev.seed 可在单个测试内临时切换（如 seed=9：P0 有对♠2 且 AI 无可亮牌）。
const mockDev = vi.hoisted(() => ({ seed: 42 }));
vi.mock('../dev.js', () => ({
  // seed 用 getter：mock 工厂只在模块加载时求值一次，测试内改 mockDev.seed 需延迟读取
  devParams: { get seed() { return mockDev.seed; }, auto: false, speed: 8 },
  seedFor: (seed: number, roundNumber: number) => (seed + roundNumber * 31) >>> 0,
}));

import { useGameStore, settledFrom } from '../store/gameStore.js';

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);

async function waitFor(pred: () => boolean, guard = 4000): Promise<void> {
  let n = 0;
  while (!pred() && n++ < guard) await advance(200);
  expect(pred()).toBe(true);
}

function emptyPlayer(name: string, index: number): PlayerState {
  return { name, index, hand: [], isHuman: false };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gameStore — seeded 4-AI match', () => {
  it('种子局完整打到 RoundEnd：得分/历史一致，25 张牌耗尽', async () => {
    useGameStore.getState().startGame([true, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'round_end');

    const gs = useGameStore.getState().gameState!;
    expect(gs.phase).toBe(GamePhase.RoundEnd);
    expect(useGameStore.getState().roundNumber).toBe(0);
    // seed=42 已知结果（与 ui-smoke 一致）
    expect(gs.attackerPoints).toBe(145);
    expect(gs.players.every(p => p.hand.length === 0)).toBe(true);

    const declarer = gs.trumpDeclaration!.declarerIndex;
    const attackerTeam = declarer % 2 === 0 ? 1 : 0;
    const expected = gs.trickHistory
      .filter(t => t.winnerIndex % 2 === attackerTeam)
      .reduce((s, t) => s + t.points, 0);
    expect(gs.attackerPoints).toBe(expected);
    expect(gs.trickHistory).toHaveLength(gs.tricksPlayed);
    expect(gs.tricksPlayed).toBe(17); // 甩牌局提前耗尽（引擎 round-end-early 修复）
  });
});

describe('gameStore — human reveal flow', () => {
  it('有人类时亮主阶段等待人类操作，不自动 finalize', async () => {
    useGameStore.getState().startGame([false, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'revealing');

    // 人类不操作：推进 5 秒仍停留在 revealing
    await advance(5000);
    expect(useGameStore.getState().gameState?.phase).toBe('revealing');

    // 人类点"确定" → 亮主完毕进入后续流程（seed=42：AI-1 已亮无主，扣底后 playing）
    useGameStore.getState().humanPassReveal();
    await waitFor(() => {
      const p = useGameStore.getState().gameState?.phase;
      return p === 'playing' || p === 'bottom_exchange' || p === 'round_end';
    });
    expect(useGameStore.getState().gameState?.phase).toBe('playing');
  });

  it('人类亮单张（有对可自保）→ 停留亮主阶段；再点自保成对 → 进入扣底', async () => {
    mockDev.seed = 880; // P0 第 21 步拿到对♦2（AI 第 36 步才有第一张级牌，且全程无级牌对/无对王）
    try {
      useGameStore.getState().startGame([false, true, true, true], false);

      // 发牌中 P0 拿到第二张 ♦2 后立刻亮单张（AI 尚无级牌 → 无人抢先亮）
      await waitFor(() => useGameStore.getState().gameState!.players[0].hand
        .filter(c => c.suit === Suit.Diamonds && c.rank === 2).length >= 2);
      useGameStore.getState().humanReveal(Suit.Diamonds);
      let gs = useGameStore.getState().gameState!;
      expect(gs.currentReveal).toEqual({ playerIndex: 0, suit: Suit.Diamonds, strength: 1 }); // 不直接亮一对
      expect(gs.phase).toBe(GamePhase.Dealing); // 发牌中：等发完；AI 无对/无对王不会反

      // 发牌完成 → 亮主阶段：单张主保持，可自保（面板显示 2 图标）
      await waitFor(() => useGameStore.getState().gameState?.phase === 'revealing');
      expect(useGameStore.getState().gameState!.currentReveal)
        .toEqual({ playerIndex: 0, suit: Suit.Diamonds, strength: 1 });

      // 再点同花色 → 自保成对 → 停留亮主（等倒计时）；humanPassReveal 模拟到期确认
      useGameStore.getState().humanReveal(Suit.Diamonds);
      gs = useGameStore.getState().gameState!;
      expect(gs.currentReveal).toEqual({ playerIndex: 0, suit: Suit.Diamonds, strength: 2 });
      expect(gs.phase).toBe(GamePhase.Revealing);
      useGameStore.getState().humanPassReveal();
      expect(useGameStore.getState().gameState!.phase).toBe(GamePhase.BottomExchange);
    } finally {
      mockDev.seed = 42;
    }
  });

  it('人类亮主（对大王无主）→ 顶庄 → 33 张选 8 扣底 → 25 张出牌（真实种子流程）', async () => {
    useGameStore.getState().startGame([false, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'revealing');

    // seed=42：人类手牌有对大王 → 亮无主（strength 4）→ 停留亮主（等倒计时）；
    // humanPassReveal 模拟倒计时到期确认 → 进入扣底
    useGameStore.getState().humanReveal(null);
    let gs = useGameStore.getState().gameState!;
    expect(gs.currentReveal).toEqual({ playerIndex: 0, suit: null, strength: 4 });
    expect(gs.phase).toBe(GamePhase.Revealing);
    useGameStore.getState().humanPassReveal();
    gs = useGameStore.getState().gameState!;
    expect(gs.phase).toBe(GamePhase.BottomExchange);
    gs = useGameStore.getState().gameState!;
    expect(gs.trumpDeclaration?.declarerIndex).toBe(0); // 首局亮主者顶庄
    expect(gs.players[0].hand).toHaveLength(33); // 底牌并入

    // 选 8 张扣底（store 层不拦截主牌；UI 层扣底键变黄 + 警告小字，无二次确认）
    const picks = gs.players[0].hand.slice(0, 8);
    for (const c of picks) useGameStore.getState().selectCard(c.id);
    expect(useGameStore.getState().selectedCardIds).toHaveLength(8);
    useGameStore.getState().submitBottomExchange();
    await advance(200);

    gs = useGameStore.getState().gameState!;
    expect(gs.phase).toBe(GamePhase.Playing);
    expect(gs.players[0].hand).toHaveLength(25);
    expect(gs.bottomCards).toHaveLength(8);
    expect(gs.bottomCards.map(c => c.id).sort()).toEqual(picks.map(c => c.id).sort());
  });

  it('建议扣底：getBottomHint 直接选中 AI 推荐的 8 张（可立即点扣底）', async () => {
    useGameStore.getState().startGame([false, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'revealing');
    useGameStore.getState().humanReveal(null); // seed=42 人类对大王亮无主 → 顶庄
    useGameStore.getState().humanPassReveal(); // 模拟倒计时到期确认
    const gs = useGameStore.getState().gameState!;
    expect(gs.phase).toBe(GamePhase.BottomExchange);
    expect(gs.players[0].hand).toHaveLength(33); // 底牌并入

    useGameStore.getState().getBottomHint();
    const sel = useGameStore.getState().selectedCardIds;
    expect(sel).toHaveLength(8); // AI 推荐恰好 8 张
    const hand = useGameStore.getState().gameState!.players[0].hand.map(c => c.id);
    expect(sel.every(id => hand.includes(id))).toBe(true);
    // 阶段不变（仅选中，不提交），可手动调整后扣底
    expect(useGameStore.getState().gameState?.phase).toBe(GamePhase.BottomExchange);
  });
});

describe('gameStore — match over', () => {
  it('庄家在 A 打赢 → matchOver 停局，不再自动续局', async () => {
    const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
      emptyPlayer('玩家1', 0), emptyPlayer('AI-2', 1),
      emptyPlayer('AI-3', 2), emptyPlayer('AI-4', 3),
    ];
    const base = createInitialState(players, 0, 14, false);
    const fake: GameState = {
      ...base,
      phase: GamePhase.RoundEnd,
      attackerPoints: 40,
      trumpDeclaration: { declarerIndex: 0, trumpSuit: Suit.Spades, level: 14 },
      bottomCards: [],
      trickHistory: [],
    };
    useGameStore.setState({
      gameState: fake,
      aiPlayers: [true, true, true, true],
      roundNumber: 5,
      teamLevels: [14, 2],
      matchOver: false,
    });

    useGameStore.getState().startNewRound();
    expect(useGameStore.getState().matchOver).toBe(true);
    // 停在结算屏：不再发牌
    expect(useGameStore.getState().gameState?.phase).toBe(GamePhase.RoundEnd);
    await advance(10000);
    expect(useGameStore.getState().gameState?.phase).toBe(GamePhase.RoundEnd);
    expect(useGameStore.getState().roundNumber).toBe(5);
  });
});

describe('gameStore — suggestion selects cards / review auto-close / settled trick', () => {
  it('建议出牌直接选中候选牌（可立即点跟牌）', async () => {
    useGameStore.getState().startGame([false, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'revealing');
    useGameStore.getState().humanPassReveal();
    // 推进到人类（P0）轮到出牌：领出或跟牌皆可
    await waitFor(() => {
      const gs = useGameStore.getState().gameState;
      return gs?.phase === 'playing' && gs.currentPlayerIndex === 0;
    });
    const before = useGameStore.getState().selectedCardIds.length;
    useGameStore.getState().getHint();
    const after = useGameStore.getState().selectedCardIds;
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).not.toBe(before);
    // 候选牌必须来自手牌
    const hand = useGameStore.getState().gameState!.players[0].hand.map(c => c.id);
    expect(after.every(id => hand.includes(id))).toBe(true);
  });

  it('上轮回看 5 秒后自动关闭（回到当前出牌）', async () => {
    // 构造有历史墩的 state
    const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
      emptyPlayer('玩家1', 0), emptyPlayer('AI-2', 1),
      emptyPlayer('AI-3', 2), emptyPlayer('AI-4', 3),
    ];
    const base = createInitialState(players, 0, 2, false);
    const trick: any = {
      plays: [
        { cards: [c('S', 3, 0)], pattern: {}, leadSuit: Suit.Spades },
        { cards: [c('S', 4, 1)], pattern: {}, leadSuit: Suit.Spades },
        { cards: [c('S', 5, 2)], pattern: {}, leadSuit: Suit.Spades },
        { cards: [c('S', 6, 3)], pattern: {}, leadSuit: Suit.Spades },
      ],
      leadPlayerIndex: 0, winnerIndex: 3, points: 0,
    };
    const fake: GameState = {
      ...base, phase: GamePhase.Playing, trickHistory: [trick],
      trumpDeclaration: { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 },
    };
    useGameStore.setState({
      gameState: fake, aiPlayers: [false, true, true, true],
      lastTrickReview: false, highlightedCards: [],
    });
    useGameStore.getState().toggleLastTrickReview();
    expect(useGameStore.getState().lastTrickReview).toBe(true);
    await advance(5000);
    expect(useGameStore.getState().lastTrickReview).toBe(false);
  });

  it('settledFrom：墩结算时返回上一墩，非结算返回 null', () => {
    const mkGs = (tricksPlayed: number, trickPlaysLen: number, hasTrick: boolean): GameState => {
      const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
        emptyPlayer('玩家1', 0), emptyPlayer('AI-2', 1),
        emptyPlayer('AI-3', 2), emptyPlayer('AI-4', 3),
      ];
      const base = createInitialState(players, 0, 2, false);
      const trick: any = {
        plays: [
          { cards: [c('S', 3, 0)], pattern: {}, leadSuit: Suit.Spades },
          { cards: [c('S', 4, 1)], pattern: {}, leadSuit: Suit.Spades },
          { cards: [c('S', 5, 2)], pattern: {}, leadSuit: Suit.Spades },
          { cards: [c('S', 6, 3)], pattern: {}, leadSuit: Suit.Spades },
        ],
        leadPlayerIndex: 0, winnerIndex: 3, points: 0,
      };
      return {
        ...base, phase: GamePhase.Playing, tricksPlayed,
        trickPlays: Array.from({ length: trickPlaysLen }, () => ({ cards: [c('S', 9, 9)], pattern: {} as any, leadSuit: Suit.Spades })),
        trickHistory: hasTrick ? [trick] : [],
        trumpDeclaration: { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 },
      };
    };
    const prev = mkGs(0, 3, false);
    // 结算：trickPlays 清空且 tricksPlayed +1 → 返回上一墩
    const settled = settledFrom(prev, mkGs(1, 0, true));
    expect(settled).not.toBeNull();
    expect(settled!.winnerIndex).toBe(3);
    // 非结算（墩中）：返回 null
    expect(settledFrom(prev, mkGs(0, 3, false))).toBeNull();
    expect(settledFrom(prev, mkGs(0, 2, false))).toBeNull();
  });
});

describe('gameStore — 局间 settledTrick 清零', () => {
  it('新局开始后 settledTrick 为 null（扣底后不闪现上一局最后一墩）', async () => {
    useGameStore.getState().startGame([true, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'round_end');

    // RoundEnd：settledTrick 保留最后一墩结算
    expect(useGameStore.getState().settledTrick).not.toBeNull();

    // 自动开新局 → Dealing
    await waitFor(() => useGameStore.getState().gameState?.phase === 'dealing');
    expect(useGameStore.getState().roundNumber).toBe(1);

    // Bug：startNewRound 未重置 → 扣底后进入 Playing、第一墩首张牌出现前
    // CenterArea isSettled = playing && 无 trickPlays && settledTrick → 桌布闪现上一局最后一墩
    expect(useGameStore.getState().settledTrick).toBeNull();
  });
});

describe('gameStore — 甩牌失败流程（非 debug）', () => {
  // 双副牌场景：P0 持 ♠A#0 ♠K#0，P1 持另一张 ♠A#1 → ♠K 被压、♠A 压不住
  // → 引擎强制出 ♠K、♠A 退回手牌。庄家=P1 → P0/P2 为闲家。
  const craftThrowState = (debug: boolean, overrides: Partial<GameState> = {}): GameState => {
    const mk = (name: string, i: number, hand: Card[]): PlayerState =>
      ({ name, index: i, isHuman: i === 0, hand });
    const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
      mk('玩家1', 0, [c('S', 14, 0), c('S', 13, 0), c('C', 3, 0), c('C', 4, 0)]),
      mk('AI-2', 1, [c('S', 14, 1), c('C', 3, 1), c('C', 4, 1)]),
      mk('AI-3', 2, [c('C', 3, 2), c('C', 4, 2), c('C', 5, 2)]),
      mk('AI-4', 3, [c('C', 3, 3), c('C', 4, 3), c('C', 5, 3)]),
    ];
    const base = createInitialState(
      [mk('玩家1', 0, []), mk('AI-2', 1, []), mk('AI-3', 2, []), mk('AI-4', 3, [])],
      1, 2, debug,
    );
    return {
      ...base,
      phase: GamePhase.Playing,
      currentPlayerIndex: 0,
      leadPlayerIndex: 0,
      trickPlays: [],
      trickHistory: [],
      players,
      initialHands: players.map(p => p.hand),
      trumpDeclaration: { declarerIndex: 1, trumpSuit: Suit.Hearts, level: 2 },
      ...overrides,
    };
  };

  const setStateFor = (gs: GameState): void => {
    useGameStore.setState({
      mode: 'playing',
      gameState: gs,
      aiPlayers: [false, true, true, true],
      localPlayerIndex: 0,
      selectedCardIds: [],
      lockedCardIds: [],
      errorMessage: null,
      failedThrow: null,
      matchOver: false,
      roundNumber: 0,
      teamLevels: [2, 2],
    });
  };

  it('人类甩牌失败：♠A 灰牌退回、强制出 ♠K、提示文案与罚分、延时续打', async () => {
    const gs = craftThrowState(false);
    setStateFor(gs);
    useGameStore.setState({
      selectedCardIds: ['S-14-0', 'S-13-0'],
    });

    useGameStore.getState().submitPlay();

    const st = useGameStore.getState();
    expect(st.gameState!.players[0].hand.map(x => x.id)).toContain('S-14-0');
    expect(st.gameState!.players[0].hand.map(x => x.id)).not.toContain('S-13-0');
    expect(st.gameState!.trickPlays[0].cards.map(x => x.id)).toEqual(['S-13-0']);
    expect(st.failedThrow).not.toBeNull();
    expect(st.failedThrow!.playerIndex).toBe(0);
    expect(st.failedThrow!.playedIds).toEqual(['S-13-0']);
    expect(st.failedThrow!.attempted.map(x => x.id)).toEqual(['S-14-0', 'S-13-0']);
    expect(st.failedThrow!.notice).toBe('玩家1 甩牌失败！强制出 ♠K（闲家罚 1/3，-10 分）');
    expect(st.gameState!.attackerPoints).toBe(-10);
    expect(st.gameState!.throwPenalties).toEqual([0, 1]);
    expect(st.errorMessage).toBeNull();

    // 延时续打：100ms 时未续（tick(2000)=250ms @speed8）
    await advance(100);
    expect(useGameStore.getState().gameState!.trickPlays).toHaveLength(1);
    // 续打后墩内跟牌不清失败回显
    await advance(300);
    expect(useGameStore.getState().failedThrow).not.toBeNull();
    // 本墩结算（第 4 家出牌）→ 清零
    await waitFor(() => useGameStore.getState().gameState!.tricksPlayed === 1);
    expect(useGameStore.getState().failedThrow).toBeNull();
  });

  it('已达罚分上限：不再扣分，文案标注上限', () => {
    const gs = craftThrowState(false, { throwPenalties: [0, 3], attackerPoints: 50 });
    setStateFor(gs);
    useGameStore.setState({ selectedCardIds: ['S-14-0', 'S-13-0'] });

    useGameStore.getState().submitPlay();

    const st = useGameStore.getState();
    expect(st.gameState!.attackerPoints).toBe(50);
    expect(st.gameState!.throwPenalties).toEqual([0, 3]);
    expect(st.failedThrow!.notice).toBe('玩家1 甩牌失败！强制出 ♠K（已达 3 次上限，不扣分）');
  });

  it('墩内 AI 跟牌保留领出者的失败回显，结算时清零', async () => {
    // 说明：AI 领出甩牌前有比 validateThrow 更严的预校验（worst-case 集中），
    // 自然对局中 AI 甩牌失败几乎不可达；此处验证 store 的保留/清零责任：
    // P0 甩牌失败后轮到 AI 跟牌 → 回显必须保留（不能被跟牌覆盖为 null）。
    const gs = craftThrowState(false);
    setStateFor(gs);
    useGameStore.setState({ selectedCardIds: ['S-14-0', 'S-13-0'] });

    useGameStore.getState().submitPlay();
    expect(useGameStore.getState().failedThrow).not.toBeNull();

    // AI 跟牌推进至本墩结算：结算前回显保留
    await advance(400);
    if (useGameStore.getState().gameState!.tricksPlayed === 0) {
      expect(useGameStore.getState().failedThrow).not.toBeNull();
    }
    // 结算 → 清零
    await waitFor(() => useGameStore.getState().gameState!.tricksPlayed === 1);
    expect(useGameStore.getState().failedThrow).toBeNull();
  });

  it('debug 模式保持原样：报错重选、不上桌、不罚分', () => {
    const gs = craftThrowState(true);
    setStateFor(gs);
    useGameStore.setState({ selectedCardIds: ['S-14-0', 'S-13-0'] });

    useGameStore.getState().submitPlay();

    const st = useGameStore.getState();
    expect(st.errorMessage).not.toBeNull();
    expect(st.gameState!.players[0].hand.map(x => x.id)).toEqual(['S-14-0', 'S-13-0', 'C-3-0', 'C-4-0']);
    expect(st.gameState!.trickPlays).toHaveLength(0);
    expect(st.failedThrow).toBeNull();
    expect(st.gameState!.throwPenalties).toEqual([0, 0]);
  });

  it('新局开始清零 failedThrow', () => {
    const players: [PlayerState, PlayerState, PlayerState, PlayerState] = [
      emptyPlayer('玩家1', 0), emptyPlayer('AI-2', 1),
      emptyPlayer('AI-3', 2), emptyPlayer('AI-4', 3),
    ];
    const base = createInitialState(players, 0, 2, false);
    useGameStore.setState({
      gameState: {
        ...base,
        phase: GamePhase.RoundEnd,
        attackerPoints: 40,
        trumpDeclaration: { declarerIndex: 0, trumpSuit: Suit.Spades, level: 2 },
        bottomCards: [],
        trickHistory: [],
      },
      aiPlayers: [true, true, true, true],
      roundNumber: 5,
      teamLevels: [2, 2],
      matchOver: false,
      failedThrow: {
        playerIndex: 0, attempted: [], playedIds: [], notice: 'x',
      },
    });

    useGameStore.getState().startNewRound();
    expect(useGameStore.getState().gameState?.phase).toBe(GamePhase.Dealing);
    expect(useGameStore.getState().roundNumber).toBe(6);
    expect(useGameStore.getState().failedThrow).toBeNull();
  });
});
