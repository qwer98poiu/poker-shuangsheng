import { create } from 'zustand';
import type { Card, GameState, PlayerState, Reveal, AIReason, Trick } from '@poker/engine';
import {
  createFullDeck, shuffle,
  createInitialState, GamePhase,
  tryReveal, finalizeReveal, playCards, canSelfReinforce,
  computeRoundOutcome, advanceLevel,
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay,
  buildAIContext,
  getRevealOptions, canOverride,
  sortHand, suitLabel, rankLabel,
  mulberry32, seededShuffle,
  Suit,
} from '@poker/engine';
import type { Suit as SuitType } from '@poker/engine';
import { devParams, seedFor } from '../dev.js';

// Interval helper: divide by dev speed (?speed / auto mode) for fast automated runs.
const tick = (ms: number) => Math.max(1, Math.round(ms / devParams.speed));

export type GameMode = 'setup' | 'playing';

interface StoreState {
  mode: GameMode;
  gameState: GameState | null;
  localPlayerIndex: number;
  selectedCardIds: string[];
  aiPlayers: boolean[];
  message: string;
  errorMessage: string | null;
  debug: boolean;
  lastTrickReview: boolean;
  highlightedCards: string[];
  /** 上一墩结算显示（第四家出牌后保留到下一墩第一张牌出现）。 */
  settledTrick: Trick | null;
  /** 0-based round number (used for deterministic per-round seeds + first-round reveal). */
  roundNumber: number;
  /** Levels per team (team = declarerIndex % 2). */
  teamLevels: [number, number];
  /** A-side won the match (banker wins at A). Stops auto-starting new rounds. */
  matchOver: boolean;
  /** 唯一可出自动选中的牌：不可放下（deselect/clear 均保留，出牌后释放）。 */
  lockedCardIds: string[];
}

interface StoreActions {
  startGame: (aiConfig: boolean[], debug: boolean) => void;
  selectCard: (cardId: string) => void;
  deselectCard: (cardId: string) => void;
  clearSelection: () => void;
  autoSelectCards: (cardIds: string[]) => void;
  lockCards: (cardIds: string[]) => void;
  clearLockedCards: () => void;
  submitPlay: () => void;
  submitBottomExchange: () => void;
  humanReveal: (suit: SuitType | null) => void;
  humanPassReveal: () => void;
  runAiTurns: () => void;
  startNewRound: () => void;
  toggleLastTrickReview: () => void;
  getHint: () => void;
  getBottomHint: () => void;
  runDealStep: (deck: Card[]) => void;
  finalizeRevealAndBottom: () => void;
}

type GameStore = StoreState & StoreActions;

/** 墩结算显示：第四家出牌后 trickPlays 清空，把上一墩保留到下一墩第一张牌出现。 */
export function settledFrom(prev: GameState, next: GameState): Trick | null {
  if (next.trickPlays.length === 0 && next.tricksPlayed > prev.tricksPlayed) {
    return next.trickHistory[next.trickHistory.length - 1] ?? null;
  }
  return null;
}

const emptyPlayersOf = (aiConfig: boolean[]): [PlayerState, PlayerState, PlayerState, PlayerState] =>
  [0, 1, 2, 3].map(i => ({
    hand: [] as Card[],
    isHuman: !aiConfig[i],
    name: aiConfig[i] ? `AI-${i + 1}` : `玩家${i + 1}`,
    index: i,
  })) as [PlayerState, PlayerState, PlayerState, PlayerState];

export const useGameStore = create<GameStore>((set, get) => ({
  mode: 'setup',
  gameState: null,
  localPlayerIndex: 0,
  selectedCardIds: [],
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
  lockedCardIds: [],

  startGame: (aiConfig: boolean[], debug: boolean) => {
    // ?seed=N: deterministic deck + initial dealer (seededShuffle/mulberry32
    // from engine, so the same seed reproduces the same match).
    const seed = devParams.seed;
    const deck = seed !== null
      ? seededShuffle(createFullDeck(), seedFor(seed, 0))
      : shuffle(createFullDeck());
    const declarerIdx = seed !== null
      ? Math.floor(mulberry32(seed)() * 4)
      : Math.floor(Math.random() * 4);
    const state = createInitialState(emptyPlayersOf(aiConfig), declarerIdx, 2, debug);

    set({
      mode: 'playing',
      gameState: { ...state, phase: GamePhase.Dealing },
      aiPlayers: aiConfig,
      selectedCardIds: [],
      message: '发牌中...',
      errorMessage: null,
      debug,
      lastTrickReview: false,
      highlightedCards: [],
      roundNumber: 0,
      teamLevels: [2, 2],
      matchOver: false,
    });

    get().runDealStep(deck);
  },

  runDealStep: (deck: Card[]) => {
    const state = get().gameState;
    if (!state || (state.phase !== GamePhase.Dealing && state.phase !== GamePhase.Revealing)) return;

    const dealt = state.dealtCards;
    const totalDealt = dealt.reduce((s, a) => s + a.length, 0);
    const targetDealt = 100;

    if (totalDealt >= targetDealt) {
      // done dealing → reveal phase
      const hands = dealt;
      const bottom = deck.slice(100, 108);
      const newPlayers = state.players.map((p, i) => ({
        ...p,
        hand: [...hands[i]],
      })) as [PlayerState, PlayerState, PlayerState, PlayerState];

      const afterDeal: GameState = {
        ...state,
        players: newPlayers,
        bottomCards: bottom,
        dealingComplete: true,
        phase: GamePhase.Revealing,
      };

      set({ gameState: afterDeal, message: '发牌完毕，亮主阶段' });

      // spectator (all AI): finalize shortly; otherwise wait for the human.
      if (get().aiPlayers.every(Boolean)) {
        setTimeout(() => get().finalizeRevealAndBottom(), tick(300));
      }
      return;
    }

    // deal one card
    const nextPlayer = totalDealt % 4;
    const card = deck[totalDealt];
    const newDealt = dealt.map((a, i) => i === nextPlayer ? [...a, card] : a);

    const newPlayers = state.players.map((p, i) => ({
      ...p,
      hand: [...newDealt[i]],
    })) as [PlayerState, PlayerState, PlayerState, PlayerState];

    const newState: GameState = { ...state, players: newPlayers, dealtCards: newDealt };

    // AI reveal check — all four seats, same as CLI (no break: tryReveal
    // itself applies the strength hierarchy).
    let afterReveal = newState;
    for (const pi of [0, 1, 2, 3]) {
      if (!get().aiPlayers[pi]) continue;
      const rev = aiTryReveal(
        newPlayers[pi].hand,
        newDealt[pi],
        pi,
        newState.currentLevel,
        newState.currentReveal,
      );
      if (rev) afterReveal = tryReveal(afterReveal, pi, rev.suit);
    }

    set({
      gameState: afterReveal,
      // 发牌进度按本地玩家手牌显示（分母 25）
      message: `发牌中... ${newPlayers[get().localPlayerIndex].hand.length}/25`,
    });

    setTimeout(() => get().runDealStep(deck), tick(120)); // 100 张 × 120ms ≈ 12 秒发完
  },

  /** Finalize reveal (human "确定" or spectator auto) then run bottom exchange. */
  finalizeRevealAndBottom: () => {
    const gs = get().gameState;
    if (!gs || gs.phase !== GamePhase.Revealing) return;

    // Round 1 only: the revealer takes over the scheduled dealer.
    const finalized = finalizeReveal(gs, get().roundNumber === 0);
    const config = finalized.trumpDeclaration!;
    const declarerIdx = config.declarerIndex;
    const declarer = finalized.players[declarerIdx];

    if (get().aiPlayers[declarerIdx]) {
      // AI declarer: pick 8 discards from the 25-card hand (CLI semantics);
      // the 8 discarded become the new bottom, the old bottom joins the hand.
      const { discard } = aiChooseBottomCards(declarer.hand, config);
      const discarded = new Set(discard.map(d => d.id));
      const withBottom = [...declarer.hand.filter(c => !discarded.has(c.id)), ...finalized.bottomCards];
      const newPlayers = finalized.players.map((p, i) =>
        i === declarerIdx ? { ...p, hand: withBottom } : p,
      ) as [PlayerState, PlayerState, PlayerState, PlayerState];

      const ready: GameState = {
        ...finalized,
        players: newPlayers,
        bottomCards: discard,
        phase: GamePhase.Playing,
        currentPlayerIndex: declarerIdx,
        leadPlayerIndex: declarerIdx,
        initialHands: newPlayers.map(p => p.hand),
      };

      set({
        gameState: ready,
        message: `出牌开始！${ready.players[declarerIdx].name} 领出`,
      });
      setTimeout(() => get().runAiTurns(), tick(600));
    } else {
      // Human declarer: merge bottom into hand (33 cards) and wait for selection.
      const withBottom = [...declarer.hand, ...finalized.bottomCards];
      const newPlayers = finalized.players.map((p, i) =>
        i === declarerIdx ? { ...p, hand: withBottom } : p,
      ) as [PlayerState, PlayerState, PlayerState, PlayerState];

      const ready: GameState = {
        ...finalized,
        players: newPlayers,
        phase: GamePhase.BottomExchange,
        currentPlayerIndex: declarerIdx,
        leadPlayerIndex: declarerIdx,
      };

      set({
        gameState: ready,
        selectedCardIds: [],
        lockedCardIds: [],
        message: '请选择8张手牌扣入底牌',
      });
    }
  },

  selectCard: (cardId: string) => {
    set(s => ({
      selectedCardIds: s.selectedCardIds.includes(cardId)
        ? s.selectedCardIds
        : [...s.selectedCardIds, cardId],
    }));
  },

  deselectCard: (cardId: string) => {
    // 唯一可出自动选中的牌不可放下
    if (get().lockedCardIds.includes(cardId)) return;
    set(s => ({
      selectedCardIds: s.selectedCardIds.filter(id => id !== cardId),
    }));
  },

  clearSelection: () => {
    // 锁定牌保留（不可放下），其余清空
    const locked = get().lockedCardIds;
    set({ selectedCardIds: locked, highlightedCards: [] });
  },

  /** 唯一可出自动选中：选中并锁定（不可放下）。 */
  autoSelectCards: (cardIds: string[]) => {
    set({ selectedCardIds: cardIds, lockedCardIds: cardIds });
  },

  /** 必出牌锁定：追加到选中并锁定（不可放下），不覆盖用户已选的其他牌。 */
  lockCards: (cardIds: string[]) => {
    set(s => ({
      selectedCardIds: [...s.selectedCardIds, ...cardIds.filter(id => !s.selectedCardIds.includes(id))],
      lockedCardIds: [...s.lockedCardIds, ...cardIds.filter(id => !s.lockedCardIds.includes(id))],
    }));
  },

  /** 出牌/新墩后释放锁定。 */
  clearLockedCards: () => set({ lockedCardIds: [] }),

  humanReveal: (suit: SuitType | null) => {
    const { gameState, localPlayerIndex } = get();
    if (!gameState || (gameState.phase !== GamePhase.Revealing && gameState.phase !== GamePhase.Dealing)) return;
    // tryReveal applies the strength hierarchy internally (via getRevealOptions).
    const revealed = tryReveal(gameState, localPlayerIndex, suit);
    if (revealed.currentReveal === gameState.currentReveal && revealed.reveals.length === gameState.reveals.length) {
      set({ message: '亮主失败（力量不够）' });
      return;
    }
    const rev = revealed.currentReveal;
    set({
      gameState: revealed,
      message: rev ? `已亮主: ${rev.suit ? suitLabel(rev.suit) + rankLabel(revealed.currentLevel) : '无主'}` : '亮主阶段',
    });
    // 亮主即确认：无可自保（无主/无对/已是上限）→ 直接进入扣底；
    // 单张亮后同花色手里还有对 → 停留等自保（面板显示 2 图标；GameTable 自动确认 3s 兜底）
    if (revealed.phase === GamePhase.Revealing) {
      const canReinforce = canSelfReinforce(
        rev, revealed.players[localPlayerIndex].hand, revealed.currentLevel, localPlayerIndex,
      );
      if (!canReinforce) get().finalizeRevealAndBottom();
    }
  },

  /** Human ends the reveal phase ("确定" button). */
  humanPassReveal: () => {
    const gs = get().gameState;
    if (!gs || gs.phase !== GamePhase.Revealing) return;
    get().finalizeRevealAndBottom();
  },

  submitBottomExchange: () => {
    const { gameState, selectedCardIds } = get();
    if (!gameState || gameState.phase !== GamePhase.BottomExchange) return;
    if (!gameState.trumpDeclaration) return;

    const declarerIdx = gameState.trumpDeclaration.declarerIndex;
    const declarer = gameState.players[declarerIdx];
    const discarded = declarer.hand.filter(c => selectedCardIds.includes(c.id));

    if (discarded.length !== 8) {
      set({ errorMessage: `必须选8张牌扣底，已选 ${discarded.length} 张` });
      return;
    }

    const discardedIds = new Set(discarded.map(d => d.id));
    const withBottom = declarer.hand.filter(c => !discardedIds.has(c.id));
    const newPlayers = gameState.players.map((p, i) =>
      i === declarerIdx
        ? { ...p, hand: withBottom }
        : p,
    ) as [PlayerState, PlayerState, PlayerState, PlayerState];

    const ready: GameState = {
      ...gameState,
      players: newPlayers,
      bottomCards: discarded,
      phase: GamePhase.Playing,
      currentPlayerIndex: declarerIdx,
      leadPlayerIndex: declarerIdx,
      initialHands: newPlayers.map(p => p.hand),
    };

    set({
      gameState: ready,
      selectedCardIds: [],
      lockedCardIds: [],
      message: `出牌开始！${ready.players[declarerIdx].name} 领出`,
      errorMessage: null,
    });

    setTimeout(() => get().runAiTurns(), tick(600));
  },

  submitPlay: () => {
    const { gameState, selectedCardIds, localPlayerIndex } = get();
    if (!gameState || gameState.phase !== GamePhase.Playing) return;
    if (gameState.currentPlayerIndex !== localPlayerIndex) return;

    const player = gameState.players[localPlayerIndex];
    const cards = player.hand.filter(c => selectedCardIds.includes(c.id));
    if (cards.length === 0) { set({ errorMessage: '请先选牌' }); return; }

    const result = playCards(gameState, localPlayerIndex, cards);
    if (result.error) { set({ errorMessage: result.error }); return; }

    set({
      gameState: result.state,
      selectedCardIds: [],
      lockedCardIds: [],
      highlightedCards: [],
      errorMessage: null,
      settledTrick: settledFrom(gameState, result.state),
    });

    if (result.state.phase === GamePhase.RoundEnd) {
      set({ message: `本局结束！闲家得分: ${result.state.attackerPoints}` });
      if (!get().matchOver) setTimeout(() => get().startNewRound(), tick(4000));
      return;
    }

    set({ message: `${result.state.players[result.state.currentPlayerIndex].name} 出牌` });
    setTimeout(() => get().runAiTurns(), tick(600));
  },

  runAiTurns: () => {
    const { gameState, aiPlayers, debug } = get();
    if (!gameState) return;
    if (gameState.phase === GamePhase.Dealing || gameState.phase === GamePhase.Revealing
        || gameState.phase === GamePhase.BottomExchange) return;

    if (gameState.phase === GamePhase.RoundEnd) {
      if (!get().matchOver) setTimeout(() => get().startNewRound(), tick(3000));
      return;
    }

    const cp = gameState.currentPlayerIndex;
    if (!aiPlayers[cp]) {
      // 轮到人类：清除上一墩结算显示（否则人类领出时一直占位挤压手牌区）
      set({ message: `等待 ${gameState.players[cp].name} 出牌`, settledTrick: null });
      return;
    }

    if (gameState.phase === GamePhase.Playing) {
      const player = gameState.players[cp];
      const isLeading = gameState.trickPlays.length === 0;
      // Full-context AI (card counting etc.) — same entry point as CLI/arena.
      const config = buildAIContext(gameState, cp)!;

      let cards: Card[] = [];
      let reason = '';

      if (isLeading) {
        const r = aiLeadPlay(player.hand, config);
        cards = r.cards;
        reason = r.reason;
      } else {
        const leadPlay = gameState.trickPlays[0];
        const r = aiFollowPlay(player.hand, leadPlay.cards, leadPlay.leadSuit, config);
        cards = r.cards;
        reason = r.reason;
      }

      const result = playCards(gameState, cp, cards);
      if (result.error) {
        // fallback: single-card legal play
        const fb = playCards(gameState, cp, [player.hand[0]]);
        set({
          gameState: fb.state,
          errorMessage: `${result.error}（${reason}）`,
          settledTrick: settledFrom(gameState, fb.state),
        });
      } else {
        set({
          gameState: result.state,
          errorMessage: null,
          settledTrick: settledFrom(gameState, result.state),
        });
      }

      // record AI reasoning in debug
      if (debug && get().gameState) {
        const aiReason: AIReason = {
          playerIndex: cp,
          phase: isLeading ? '领出' : '跟牌',
          decision: cards.map(c => c.id).join(','),
          reason,
          cards: cards.map(c => c.id),
        };
        const ns = get().gameState!;
        set({ gameState: { ...ns, aiReasons: [...ns.aiReasons, aiReason] } });
      }

      if (get().gameState?.phase === GamePhase.RoundEnd) {
        set({ message: `本局结束！闲家得分: ${get().gameState!.attackerPoints}` });
        if (!get().matchOver) setTimeout(() => get().startNewRound(), tick(4000));
        return;
      }

      set({ message: `${get().gameState?.players[get().gameState!.currentPlayerIndex].name} 出牌` });
      setTimeout(() => get().runAiTurns(), tick(800));
    }
  },

  startNewRound: () => {
    const { gameState, debug, roundNumber, teamLevels } = get();
    if (!gameState) return;

    // Settlement — single source of truth (engine computeRoundOutcome +
    // advanceLevel, must-play K/A rules).
    const declarerIdx = gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex;
    const lastTrick = gameState.trickHistory[gameState.trickHistory.length - 1] ?? null;
    const outcome = computeRoundOutcome(
      gameState.attackerPoints, gameState.bottomCards, lastTrick,
      gameState.trumpDeclaration, declarerIdx,
    );

    const advancingTeam = outcome.attackerSits ? (declarerIdx + 1) % 2 : declarerIdx % 2;
    const adv = advanceLevel(teamLevels[advancingTeam], outcome.finalPts);
    const newTeamLevels = [...teamLevels] as [number, number];
    newTeamLevels[advancingTeam] = adv.newLevel;

    if (adv.matchOver) {
      const teamName = declarerIdx % 2 === 0 ? '玩家1/AI-3' : 'AI-2/AI-4';
      set({
        matchOver: true,
        message: `🏆 ${teamName} 队胜出！`,
      });
      return;
    }

    const nextRound = roundNumber + 1;
    const nextDeclarer = outcome.attackerSits ? (declarerIdx + 1) % 4 : (declarerIdx + 2) % 4;
    const nextLevel = newTeamLevels[nextDeclarer % 2];

    const seed = devParams.seed;
    const deck = seed !== null
      ? seededShuffle(createFullDeck(), seedFor(seed, nextRound))
      : shuffle(createFullDeck());

    const fresh = createInitialState(emptyPlayersOf(get().aiPlayers), nextDeclarer, nextLevel, debug);

    set({
      gameState: { ...fresh, phase: GamePhase.Dealing },
      selectedCardIds: [],
      lockedCardIds: [],
      message: '发牌中...',
      errorMessage: null,
      lastTrickReview: false,
      highlightedCards: [],
      roundNumber: nextRound,
      teamLevels: newTeamLevels,
      matchOver: false,
    });

    get().runDealStep(deck);
  },

  toggleLastTrickReview: () => {
    const s = get();
    if (!s.gameState || s.gameState.trickHistory.length === 0) {
      // 无历史墩时给提示（否则点击无反应）
      if (s.gameState) set({ message: '暂无历史墩' });
      return;
    }
    const last = s.gameState.trickHistory[s.gameState.trickHistory.length - 1];
    const isOpening = !s.lastTrickReview;
    // highlight the winner's cards
    const winnerPlay = last.plays[
      last.winnerIndex === last.leadPlayerIndex ? 0 :
      (last.winnerIndex - last.leadPlayerIndex + 4) % 4
    ];
    set({
      lastTrickReview: isOpening,
      highlightedCards: isOpening ? winnerPlay.cards.map(c => c.id) : [],
    });
    // 5 秒后自动关闭回看，回到当前出牌
    if (isOpening) {
      setTimeout(() => {
        const st = get();
        if (st.lastTrickReview) set({ lastTrickReview: false, highlightedCards: [] });
      }, 5000);
    }
  },

  getHint: () => {
    const { gameState, localPlayerIndex } = get();
    if (!gameState) return;
    const player = gameState.players[localPlayerIndex];
    const isLeading = gameState.trickPlays.length === 0;
    const config = buildAIContext(gameState, localPlayerIndex) ?? gameState.trumpDeclaration!;

    let suggested: Card[] = [];
    let reason = '';

    if (isLeading) {
      const r = aiLeadPlay(player.hand, config);
      suggested = r.cards;
      reason = r.reason;
    } else if (gameState.trickPlays.length > 0) {
      const lead = gameState.trickPlays[0];
      const r = aiFollowPlay(player.hand, lead.cards, lead.leadSuit, config);
      suggested = r.cards;
      reason = r.reason;
    }

    // 建议出牌直接选中候选牌，可直接点"跟牌/出牌"
    set({
      selectedCardIds: suggested.map(c => c.id),
      highlightedCards: [],
      message: `💡 建议: ${reason}`,
    });
  },

  /** 建议扣底：AI 从 33 张手牌中选 8 张扣入底牌（与 AI 庄家同口径），直接选中，可立即点"扣底"。 */
  getBottomHint: () => {
    const { gameState, localPlayerIndex } = get();
    if (!gameState || gameState.phase !== GamePhase.BottomExchange) return;
    if (gameState.trumpDeclaration?.declarerIndex !== localPlayerIndex) return;
    const hand = gameState.players[localPlayerIndex].hand;
    const r = aiChooseBottomCards(hand, gameState.trumpDeclaration);
    set({
      selectedCardIds: r.discard.map(c => c.id),
      highlightedCards: [],
      message: `💡 建议: ${r.reason}`,
    });
  },
}));
