/**
 * Strategy arena — shared types.
 */
import type { Card, CardSuit, Suit, TrumpDeclaration, AIContext } from '@poker/engine';

/** A strategy's reveal decision (suit=null → 无主 NT). */
export interface RevealDecision {
  suit: Suit | null;
  reason: string;
}

/**
 * A strategy = the four AI decision functions, bound per seat.
 * Seats 0&2 use strategies[0], seats 1&3 use strategies[1].
 */
export interface Strategy {
  readonly name: string;
  tryReveal(
    hand: Card[],
    dealtCards: Card[],
    playerIndex: number,
    level: number,
    currentReveal: { suit: Suit | null; strength: number } | null,
  ): RevealDecision | null;
  chooseBottom(hand: Card[], config: TrumpDeclaration): { keep: Card[]; discard: Card[]; reason: string };
  lead(hand: Card[], config: AIContext): { cards: Card[]; reason: string };
  follow(
    hand: Card[],
    leadCards: Card[],
    leadSuit: CardSuit | null,
    config: AIContext,
  ): { cards: Card[]; reason: string };
}

/**
 * Everything the stat accumulator needs from one hand (小局).
 * Derived from GameState at hand end; level = banker team's level,
 * attackerLevel = the defending team's own level.
 */
export interface HandEvent {
  handIndex: number;
  level: number;          // banker team's level for this hand
  attackerLevel: number;  // attacker team's own level (for 台下 per-level buckets)
  declarerIdx: number;
  teamBanker: 0 | 1;      // = declarerIdx % 2
  trumpSuit: Suit | null; // null = NT
  bottomPoints: number;   // 底牌分数 (user definition of 台上扣底平均分数)
  killSuitCount: number;  // 扣绝: non-trump suits going 有→无 after the bottom exchange
  attackerWonLastTrick: boolean; // 闲家赢最后一墩 → 抠底
  kouDiAdd: number;       // 抠底加分 = bottomPoints × multiplier when attackerWonLastTrick
  finalPts: number;       // 闲家最终分（含抠底，≥0）
  bankerWon: boolean;     // finalPts < 80
  tricksPlayed: number;
  tricksWonByTeam0: number;
  leadsByTeam0: number;
  leadCardsByTeam0: number; // sum of lead plays' card counts when a team-0 seat led
  leadCardsTotal: number;   // sum of all lead plays' card counts (both teams)
  errors: number;           // 引擎验牌失败回退次数（策略合法性检测用）
  aborted: boolean;         // engine error/abort — excluded from all denominators
}

export interface MatchResult {
  winnerTeam: 0 | 1 | null; // null = draw (hand cap reached)
  handsPlayed: number;      // completed (non-aborted) hands
  abortedHands: number;
  capped: boolean;          // ended by the maxHands cap
  finalLevels: [number, number]; // 终局双方等级 [team0, team1]（封顶平局也记录，A=14）
  events: HandEvent[];      // only populated when captureEvents=true
}

