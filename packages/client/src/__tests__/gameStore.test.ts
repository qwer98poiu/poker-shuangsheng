import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCard, createInitialState, GamePhase, Suit } from '@poker/engine';
import type { Card, GameState, PlayerState } from '@poker/engine';

// Deterministic dev params (same derivation as src/dev.ts).
vi.mock('../dev.js', () => ({
  devParams: { seed: 42, auto: false, speed: 8 },
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

  it('人类亮主（对大王无主）→ 顶庄 → 33 张选 8 扣底 → 25 张出牌（真实种子流程）', async () => {
    useGameStore.getState().startGame([false, true, true, true], false);
    await waitFor(() => useGameStore.getState().gameState?.phase === 'revealing');

    // seed=42：人类手牌有对大王 → 亮无主（strength 4），亮主即确认直接进入扣底
    useGameStore.getState().humanReveal(null);
    let gs = useGameStore.getState().gameState!;
    expect(gs.currentReveal).toEqual({ playerIndex: 0, suit: null, strength: 4 });
    expect(gs.phase).toBe(GamePhase.BottomExchange); // 亮主即确认，不再等待"确定"
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
    useGameStore.getState().humanReveal(null); // seed=42 人类对大王亮无主 → 顶庄扣底
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
