import { create } from 'zustand';
import type { Card, GameState, PlayerState, Reveal, AIReason } from '@poker/engine';
import {
  createFullDeck, shuffle,
  createInitialState, GamePhase,
  tryReveal, finalizeReveal, playCards, computeLevelChange,
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay,
  sortHand,
  mulberry32, seededShuffle,
  Suit,
} from '@poker/engine';
import type { Suit as SuitType } from '@poker/engine';
import { devParams, seedFor } from '../dev.js';

// Interval helper: divide by dev speed (?_speed / auto mode) for fast automated runs.
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
  humanCanReveal: boolean;
  showBottomCards: boolean; // show bottom cards on table when revealed
  /** 0-based round number (used for deterministic per-round seeds). */
  roundNumber: number;
}

interface StoreActions {
  startGame: (aiConfig: boolean[], debug: boolean) => void;
  selectCard: (cardId: string) => void;
  deselectCard: (cardId: string) => void;
  clearSelection: () => void;
  submitPlay: () => void;
  submitBottomExchange: () => void;
  humanReveal: (suit: SuitType | null) => void;
  humanPassReveal: () => void;
  runAiTurns: () => void;
  startNewRound: () => void;
  toggleLastTrickReview: () => void;
  getHint: () => void;
  runDealStep: (deck: Card[]) => void;
}

type GameStore = StoreState & StoreActions;

export const useGameStore = create<GameStore>((set, get) => {
  // helper to process bottom exchange
  const doBottomExchange = () => {
    const gs = get().gameState;
    if (!gs || gs.phase !== GamePhase.Playing) return;
    set({ showBottomCards: true });
  };

  return {
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
    humanCanReveal: false,
    showBottomCards: false,
    roundNumber: 0,

    startGame: (aiConfig: boolean[], debug: boolean) => {
      // ?seed=N: deterministic deck + initial dealer (seededShuffle/mulberry32
      // from engine, so the same seed reproduces the same match).
      const seed = devParams.seed;
      const deck = seed !== null
        ? seededShuffle(createFullDeck(), seedFor(seed, 0))
        : shuffle(createFullDeck());
      const emptyPlayers = [0, 1, 2, 3].map(i => ({
        hand: [] as Card[],
        isHuman: !aiConfig[i],
        name: aiConfig[i] ? `AI-${i + 1}` : `玩家 ${i + 1}`,
        index: i,
      })) as [PlayerState, PlayerState, PlayerState, PlayerState];

      const declarerIdx = seed !== null
        ? Math.floor(mulberry32(seed)() * 4)
        : Math.floor(Math.random() * 4);
      const state = createInitialState(
        emptyPlayers,
        declarerIdx,
        2,
        debug,
      );

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
        humanCanReveal: false,
        showBottomCards: false,
        roundNumber: 0,
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
        // done dealing
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

        set({
          gameState: afterDeal,
          message: '发牌完毕，亮主阶段',
          showBottomCards: true,
        });

        // wait a moment then finalize reveal
        setTimeout(() => {
          const gs = get().gameState;
          if (!gs || gs.phase !== GamePhase.Revealing) return;

          const finalized = finalizeReveal(gs);
          const declarerIdx = finalized.currentPlayerIndex;
          const declarer = finalized.players[declarerIdx];

          if (get().aiPlayers[declarerIdx]) {
            // AI does bottom exchange automatically
            const { discard } = aiChooseBottomCards(declarer.hand, finalized.trumpDeclaration!);
            const newHand = declarer.hand.filter(c => !discard.some(d => d.id === c.id));
            const newPlayers2 = finalized.players.map((p, i) =>
              i === declarerIdx
                ? { ...p, hand: [...newHand, ...finalized.bottomCards] }
                : p,
            ) as [PlayerState, PlayerState, PlayerState, PlayerState];

            const ready: GameState = {
              ...finalized,
              players: newPlayers2,
              bottomCards: discard,
              currentPlayerIndex: finalized.leadPlayerIndex,
            };

            set({
              gameState: ready,
              message: `出牌开始！${ready.players[ready.currentPlayerIndex].name} 领出`,
              humanCanReveal: false,
            });
            setTimeout(() => get().runAiTurns(), tick(600));
          } else {
            // human declarer picks bottom cards
            set({
              gameState: finalized,
              message: `请选择8张手牌扣入底牌（你亮主/叫主）`,
              humanCanReveal: false,
            });
          }
        }, tick(1500));
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

      // check AI reveals
      let afterReveal = newState;
      for (const pi of [0, 1, 2, 3]) {
        if (get().aiPlayers[pi]) {
          const rev = aiTryReveal(
            newPlayers[pi].hand,
            newDealt[pi],
            pi,
            newState.currentLevel,
            newState.currentReveal,
          );
          if (rev) {
            afterReveal = tryReveal(afterReveal, pi, rev.suit);
            break;
          }
        }
      }

      set({
        gameState: afterReveal,
        message: `发牌中... ${totalDealt + 1}/100`,
        humanCanReveal: true,
      });

      setTimeout(() => get().runDealStep(deck), tick(180));
    },

    selectCard: (cardId: string) => {
      set(s => ({
        selectedCardIds: s.selectedCardIds.includes(cardId)
          ? s.selectedCardIds
          : [...s.selectedCardIds, cardId],
      }));
    },

    deselectCard: (cardId: string) => {
      set(s => ({
        selectedCardIds: s.selectedCardIds.filter(id => id !== cardId),
      }));
    },

    clearSelection: () => set({ selectedCardIds: [], highlightedCards: [] }),

    humanReveal: (suit: SuitType | null) => {
      const { gameState, localPlayerIndex } = get();
      if (!gameState) return;
      const revealed = tryReveal(gameState, localPlayerIndex, suit);
      set({ gameState: revealed, message: '亮主成功！' });
    },

    humanPassReveal: () => {
      set({ humanCanReveal: false });
    },

    submitBottomExchange: () => {
      const { gameState, selectedCardIds } = get();
      if (!gameState || !gameState.trumpDeclaration) return;

      const declarerIdx = gameState.trumpDeclaration.declarerIndex;
      const declarer = gameState.players[declarerIdx];
      const discarded = declarer.hand.filter(c => selectedCardIds.includes(c.id));

      if (discarded.length !== 8) {
        set({ errorMessage: `必须选8张牌扣底，已选 ${discarded.length} 张` });
        return;
      }

      const newHand = declarer.hand.filter(c => !discarded.some(d => d.id === c.id));
      const newPlayers = gameState.players.map((p, i) =>
        i === declarerIdx
          ? { ...p, hand: [...newHand, ...gameState.bottomCards] }
          : p,
      ) as [PlayerState, PlayerState, PlayerState, PlayerState];

      const ready: GameState = {
        ...gameState,
        players: newPlayers,
        bottomCards: discarded,
        currentPlayerIndex: declarerIdx,
        leadPlayerIndex: declarerIdx,
      };

      set({
        gameState: ready,
        selectedCardIds: [],
        message: `出牌开始！${ready.players[ready.currentPlayerIndex].name} 领出`,
        errorMessage: null,
      });

      setTimeout(() => get().runAiTurns(), 600);
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
        highlightedCards: [],
        errorMessage: null,
      });

      if (result.state.phase === GamePhase.RoundEnd) {
        set({ message: `本局结束！闲家得分: ${result.state.attackerPoints}` });
        setTimeout(() => get().startNewRound(), tick(4000));
        return;
      }

      set({ message: `${result.state.players[result.state.currentPlayerIndex].name} 出牌` });
      setTimeout(() => get().runAiTurns(), tick(600));
    },

    runAiTurns: () => {
      const { gameState, aiPlayers, debug } = get();
      if (!gameState) return;
      if (gameState.phase === GamePhase.Dealing || gameState.phase === GamePhase.Revealing) return;

      if (gameState.phase === GamePhase.RoundEnd) {
        setTimeout(() => get().startNewRound(), tick(3000));
        return;
      }

      const cp = gameState.currentPlayerIndex;
      if (!aiPlayers[cp]) {
        set({ message: `等待 ${gameState.players[cp].name} 出牌` });
        return;
      }

      if (gameState.phase === GamePhase.Playing) {
        const player = gameState.players[cp];
        const isLeading = gameState.trickPlays.length === 0;
        const config = gameState.trumpDeclaration!;

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
          // fallback
          const fb = playCards(gameState, cp, [player.hand[0]]);
          set({
            gameState: fb.state,
            errorMessage: `${result.error}（${reason}）`,
          });
        } else {
          set({ gameState: result.state, errorMessage: null });
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
          setTimeout(() => get().startNewRound(), tick(4000));
          return;
        }

        set({ message: `${get().gameState?.players[get().gameState!.currentPlayerIndex].name} 出牌` });
        setTimeout(() => get().runAiTurns(), tick(800));
      }
    },

    startNewRound: () => {
      const { gameState, debug, roundNumber } = get();
      if (!gameState) return;

      const nextRound = roundNumber + 1;
      const seed = devParams.seed;
      const deck = seed !== null
        ? seededShuffle(createFullDeck(), seedFor(seed, nextRound))
        : shuffle(createFullDeck());
      const emptyPlayers = gameState.players.map((p, i) => ({
        ...p,
        hand: [] as Card[],
      })) as [PlayerState, PlayerState, PlayerState, PlayerState];

      const declarerIdx = gameState.trumpDeclaration?.declarerIndex ?? gameState.declarerIndex;
      const newDealer = (declarerIdx + 1) % 4;
      const attackerTeam = declarerIdx % 2 === 0 ? 1 : 0;
      const changes = computeLevelChange(gameState.attackerPoints);
      const newLevel = attackerTeam === 1
        ? gameState.currentLevel + changes.attackerChange
        : gameState.currentLevel + changes.defenderChange;

      const fresh = createInitialState(emptyPlayers, newDealer, Math.min(newLevel, 14), debug);

      set({
        gameState: { ...fresh, phase: GamePhase.Dealing },
        selectedCardIds: [],
        message: '发牌中...',
        errorMessage: null,
        lastTrickReview: false,
        highlightedCards: [],
        humanCanReveal: false,
        showBottomCards: false,
        roundNumber: nextRound,
      });

      get().runDealStep(deck);
    },

    toggleLastTrickReview: () => {
      set(s => {
        const gs = s.gameState;
        if (!gs || gs.trickHistory.length === 0) return {};
        const last = gs.trickHistory[gs.trickHistory.length - 1];
        const isOpening = !s.lastTrickReview;
        // highlight the winner's cards
        const winnerPlay = last.plays[
          last.winnerIndex === last.leadPlayerIndex ? 0 :
          (last.winnerIndex - last.leadPlayerIndex + 4) % 4
        ];
        return {
          lastTrickReview: isOpening,
          highlightedCards: isOpening ? winnerPlay.cards.map(c => c.id) : [],
        };
      });
    },

    getHint: () => {
      const { gameState, localPlayerIndex } = get();
      if (!gameState) return;
      const player = gameState.players[localPlayerIndex];
      const isLeading = gameState.trickPlays.length === 0;
      const config = gameState.trumpDeclaration!;

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

      set({
        highlightedCards: suggested.map(c => c.id),
        message: `💡 建议: ${reason}`,
      });
    },

    doBottomExchange: () => { set({ showBottomCards: true }); },
  };
});
