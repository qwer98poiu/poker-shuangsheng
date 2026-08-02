/**
 * Single-match (2→A) loop — the arena core.
 *
 * Replicates the CLI's round flow (deal → reveal → bottom exchange → play →
 * scoring) with per-seat strategy injection:
 * - createInitialState(..., debug=false): failed 甩牌 auto-forces with penalty
 *   (debug=true would return an error instead, diverging from real play).
 * - finalizeReveal(state, isFirstHand): only hand 0 lets the revealer become
 *   declarer; later hands keep the rotated declarer (reveal only sets trump).
 * - Bottom exchange uses the BARE TrumpDeclaration (position-blind), matching
 *   the CLI — keeps the mirror fair.
 * - Lead/follow use buildAIContext (full observability), like the CLI.
 * - 上台判定 & 升级 both use finalPts (闲家最终分含抠底), fixing the CLI's
 *   gameLoop:218 inconsistency (rotation read raw attackerPoints).
 */
import {
  createInitialState, GamePhase, tryReveal, finalizeReveal, playCards,
  classify, bottomMultiplier, countBottomPoints, finalizeAttackerPoints,
  buildAIContext,
} from '@poker/engine';
import type { Card, CardSuit, GameState, PlayerState, Suit, TrumpDeclaration } from '@poker/engine';
import { Suit as SuitEnum } from '@poker/engine';
import { deckForHand } from './rng.js';
import { advanceLevel } from './advance-level.js';
import type { HandEvent, MatchResult, Strategy } from './types.js';

export const DEFAULT_MAX_HANDS = 200;

export interface MatchConfig {
  seed: number;
  pairIndex: number;
  /** strategies[0] sits on seats 0&2, strategies[1] on seats 1&3. */
  strategies: [Strategy, Strategy];
  maxHands?: number;
  captureEvents?: boolean;
  onHand?: (ev: HandEvent) => void;
}

export interface PlayHandOptions {
  deck: Card[];
  handIndex: number;
  declarerIdx: number;
  level: number;
  attackerLevel: number;
  isFirstHand: boolean;
  strategies: [Strategy, Strategy];
}

function countBySuit(hand: Card[]): Record<string, number> {
  const counts: Record<string, number> = { S: 0, H: 0, C: 0, D: 0 };
  for (const c of hand) {
    const s = c.suit as string;
    if (s in counts) counts[s] += 1;
  }
  return counts;
}

/** 扣绝一门: non-trump suits going 有→无 through the bottom exchange. */
function countVoidedSuits(before: Card[], after: Card[], config: TrumpDeclaration): number {
  const pre = countBySuit(before);
  const post = countBySuit(after);
  let killed = 0;
  for (const s of [SuitEnum.Spades, SuitEnum.Hearts, SuitEnum.Clubs, SuitEnum.Diamonds]) {
    if (config.trumpSuit !== null && s === config.trumpSuit) continue; // 主牌不算副牌
    if (pre[s] > 0 && post[s] === 0) killed += 1;
  }
  return killed;
}

/** Play one hand (小局) from a pre-shuffled deck. Returns the stat event. */
export function playHand(opts: PlayHandOptions): HandEvent {
  const { deck, handIndex, declarerIdx, level, attackerLevel, isFirstHand, strategies } = opts;

  const players = [0, 1, 2, 3].map(i => ({
    hand: [] as Card[], isHuman: false, name: `AI-${i + 1}`, index: i,
  })) as [PlayerState, PlayerState, PlayerState, PlayerState];

  let state = createInitialState(players, declarerIdx, level, false);

  // --- deal (round-robin, reveal interleaved per card) ---
  const dealt: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) {
    const pi = i % 4;
    dealt[pi].push(deck[i]);
    state = {
      ...state,
      dealtCards: dealt.map(a => [...a]) as unknown as Card[][],
      players: state.players.map((p, j) => ({ ...p, hand: [...dealt[j]] })) as unknown as typeof state.players,
    };
    for (let pj = 0; pj < 4; pj++) {
      const rev = strategies[pj % 2].tryReveal(
        state.players[pj].hand, dealt[pj], pj, level, state.currentReveal,
      );
      if (rev) state = tryReveal(state, pj, rev.suit);
    }
  }
  state = {
    ...state,
    bottomCards: deck.slice(100, 108),
    dealingComplete: true,
    phase: GamePhase.Revealing,
  };
  state = finalizeReveal(state, isFirstHand);
  const t = state.trumpDeclaration!;
  const declarer = t.declarerIndex;
  const teamBanker = (declarer % 2) as 0 | 1;

  // --- bottom exchange (position-blind bare declaration, like the CLI) ---
  const { discard } = strategies[declarer % 2].chooseBottom(state.players[declarer].hand, t);
  const preHand = state.players[declarer].hand;
  const newHand = preHand.filter(c => !discard.some(d => d.id === c.id));
  state = {
    ...state,
    players: state.players.map((p, i) =>
      i === declarer ? { ...p, hand: [...newHand, ...state.bottomCards] } : p,
    ) as unknown as typeof state.players,
    bottomCards: discard,
    currentPlayerIndex: declarer,
    leadPlayerIndex: declarer,
  };
  const killSuitCount = countVoidedSuits(preHand, state.players[declarer].hand, t);

  // --- play phase ---
  let aborted = false;
  let errors = 0;
  while (state.tricksPlayed < 25) {
    if (state.players.every(p => p.hand.length === 0)) break; // 全部出完提前结束
    const cp = state.currentPlayerIndex;
    const player = state.players[cp];
    if (player.hand.length === 0) { aborted = true; break; }

    const isLeading = state.trickPlays.length === 0;
    const leadLen = isLeading ? 0 : state.trickPlays[0].cards.length;
    const ctx = buildAIContext(state, cp)!;
    const s = strategies[cp % 2];

    let cards: Card[];
    if (isLeading) {
      cards = s.lead(player.hand, ctx).cards;
    } else {
      const leadPlay = state.trickPlays[0];
      const leadSuit: CardSuit | null = leadPlay.leadSuit ?? leadPlay.cards[0]?.suit ?? null;
      if (!leadSuit) {
        cards = [player.hand[0]];
      } else {
        cards = s.follow(player.hand, leadPlay.cards, leadSuit, ctx).cards;
      }
    }

    // sanity fallbacks (mirrors cli/index.ts:603-611)
    if (!cards || cards.length === 0 || cards.some(c => !c)) {
      cards = player.hand.slice(0, Math.max(1, leadLen));
    }
    if (!isLeading && cards.length !== leadLen) {
      const used = new Set(cards.filter(Boolean).map(c => c.id));
      const extra = player.hand.filter(c => !used.has(c.id));
      cards = [...cards.filter(Boolean), ...extra].slice(0, leadLen);
      if (cards.length < leadLen) { aborted = true; break; }
    }

    const res = playCards(state, cp, cards);
    if (res.forcedPlay) {
      state = res.state; // throw auto-forced with penalty
    } else if (res.error) {
      errors += 1; // 策略出了非法牌，引擎验牌回退
      const want = isLeading ? 1 : (state.trickPlays[0]?.cards.length ?? 1);
      const fb = playCards(state, cp, player.hand.slice(0, want));
      if (fb.error) {
        errors += 1;
        const fb2 = playCards(state, cp, [player.hand[0]]);
        if (fb2.error) { aborted = true; break; }
        state = fb2.state;
      } else {
        state = fb.state;
      }
    } else {
      state = res.state;
    }
    if (state.phase === GamePhase.RoundEnd) break;
  }

  // --- round result ---
  const lastTrick = state.trickHistory[state.trickHistory.length - 1];
  const mult = lastTrick ? bottomMultiplier(classify(lastTrick.plays[0].cards, t)) : 2;
  const bp = countBottomPoints(state.bottomCards);
  const attackerWonLastTrick = lastTrick
    ? lastTrick.winnerIndex % 2 !== teamBanker
    : false;
  const finalPts = Math.max(0, lastTrick
    ? finalizeAttackerPoints(state.attackerPoints, bp, mult, lastTrick.winnerIndex, declarer)
    : state.attackerPoints);
  const kouDiAdd = attackerWonLastTrick ? bp * mult : 0;

  let tricksWonByTeam0 = 0;
  let leadsByTeam0 = 0;
  let leadCardsByTeam0 = 0;
  let leadCardsTotal = 0;
  for (const trick of state.trickHistory) {
    if (trick.winnerIndex % 2 === 0) tricksWonByTeam0 += 1;
    if (trick.leadPlayerIndex % 2 === 0) {
      leadsByTeam0 += 1;
      leadCardsByTeam0 += trick.plays[0].cards.length;
    }
    leadCardsTotal += trick.plays[0].cards.length;
  }

  return {
    handIndex,
    level,
    attackerLevel,
    declarerIdx: declarer,
    teamBanker,
    trumpSuit: t.trumpSuit,
    bottomPoints: bp,
    killSuitCount,
    attackerWonLastTrick,
    kouDiAdd,
    finalPts,
    bankerWon: finalPts < 80,
    tricksPlayed: state.trickHistory.length,
    tricksWonByTeam0,
    leadsByTeam0,
    leadCardsByTeam0,
    leadCardsTotal,
    errors,
    aborted,
  };
}

/** One full match (2→A) with 必打 K/A. winnerTeam null = draw at maxHands. */
export function playMatch(cfg: MatchConfig): MatchResult {
  const maxHands = cfg.maxHands ?? DEFAULT_MAX_HANDS;
  const events: HandEvent[] = cfg.captureEvents ? [] : [];
  const sideLevels: [number, number] = [2, 2];
  let declarerIdx = 0;
  let handIndex = 0;
  let abortedHands = 0;

  while (handIndex < maxHands) {
    const team = (declarerIdx % 2) as 0 | 1;
    const level = sideLevels[team];
    const attackerLevel = sideLevels[team === 0 ? 1 : 0];
    const deck = deckForHand(cfg.seed, cfg.pairIndex, handIndex);

    const ev = playHand({
      deck, handIndex, declarerIdx, level, attackerLevel,
      isFirstHand: handIndex === 0,
      strategies: cfg.strategies,
    });
    if (cfg.onHand) cfg.onHand(ev);

    handIndex += 1;
    if (ev.aborted) {
      abortedHands += 1;
      continue; // 中止局也消耗 handIndex，保证镜像两场 seed 对齐
    }
    events.push(ev);

    const adv = advanceLevel(level, ev.finalPts);
    sideLevels[team] = adv.newLevel;
    if (adv.matchOver) {
      return { winnerTeam: team, handsPlayed: handIndex - abortedHands, abortedHands, capped: false, events };
    }
    // 轮转基于实际庄家（首局亮主者可能顶替预定庄家），与 cli gameLoop:255 一致
    declarerIdx = adv.attackerSits ? (ev.declarerIdx + 1) % 4 : (ev.declarerIdx + 2) % 4;
  }

  return { winnerTeam: null, handsPlayed: handIndex - abortedHands, abortedHands, capped: true, events };
}
