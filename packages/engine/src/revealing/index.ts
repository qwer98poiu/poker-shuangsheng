/**
 * Module 2 — Revealing trump (亮主/反主).
 *
 * Strength hierarchy:
 *   4 = pair of BigJokers (对大王) — can override everything below
 *   3 = pair of SmallJokers (对小王)
 *   2 = pair of level cards (对级牌)
 *   1 = single level card (单张级牌)
 *
 * Both 4 and 3 declare No-Trump (无主, suit=null).
 * 4 can override 3, which matters for determining the first-round defender.
 */
import type { Card } from '../types.js';
import { Rank, Suit } from '../types.js';
import type { Reveal } from '../types.js';

export interface RevealOption {
  readonly suit: Suit | null;
  readonly strength: number;
  readonly reason: string;
}

/** Get all possible reveal options for a player's hand. */
export function getRevealOptions(hand: Card[], level: number): RevealOption[] {
  const opts: RevealOption[] = [];

  const bj = hand.filter(c => c.rank === Rank.BigJoker);
  if (bj.length >= 2) opts.push({ suit: null, strength: 4, reason: '对大王亮无主' });

  const sj = hand.filter(c => c.rank === Rank.SmallJoker);
  if (sj.length >= 2) opts.push({ suit: null, strength: 3, reason: '对小王亮无主' });

  for (const s of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
    const cnt = hand.filter(c => c.suit === s && c.rank === level).length;
    if (cnt >= 2) opts.push({ suit: s, strength: 2, reason: `对${s}${level}亮主` });
    else if (cnt >= 1) opts.push({ suit: s, strength: 1, reason: `单张${s}${level}亮主` });
  }
  return opts;
}

/**
 * 亮主过程的实际力量：无人亮主时有主花色只能单张亮（不直接亮一对），
 * 对子仅用于自保（自己同花色巩固）或反主（他人已亮）；无主（对王）不受限。
 */
export function revealStrength(current: Reveal | null, opt: RevealOption): number {
  if (!current && opt.suit !== null) return 1;
  return opt.strength;
}

/**
 * 亮主后能否继续自保：自己同花色单张主（strength 1）且手里还有该花色级牌对。
 * 无主（suit null）不可自保（对小王→对大王视为自反，禁止）。
 */
export function canSelfReinforce(
  current: Reveal | null,
  hand: readonly Card[],
  level: number,
  playerIndex: number,
): boolean {
  if (!current) return false;
  if (current.playerIndex !== playerIndex) return false;
  if (current.suit === null || current.strength !== 1) return false;
  return hand.filter(c => c.suit === current.suit && c.rank === level).length >= 2;
}

/**
 * Can candidate override current?
 * 自己不能反自己：自保仅限有主同花色巩固（单张→同花色对子）；
 * 无主不可自保（对小王→对大王视为自反，禁止）。其他人按力量反主。
 */
export function canOverride(current: Reveal | null, candidate: Reveal): boolean {
  if (!current) return true;
  if (candidate.playerIndex === current.playerIndex) {
    return candidate.suit !== null
      && candidate.suit === current.suit
      && candidate.strength > current.strength;
  }
  return candidate.strength > current.strength;
}

/** Apply a reveal attempt. Returns updated current + history. */
export function attemptReveal(
  current: Reveal | null,
  history: readonly Reveal[],
  playerIndex: number,
  suit: Suit | null,
  strength: number,
): { currentReveal: Reveal | null; reveals: Reveal[] } {
  const a: Reveal = { playerIndex, suit, strength };
  if (canOverride(current, a)) return { currentReveal: a, reveals: [...history, a] };
  return { currentReveal: current, reveals: [...history, a] };
}

/** Finalize: if no reveal, dealer auto-calls by picking first available suit. */
export function finalize(
  current: Reveal | null,
  dealerHand: Card[],
  level: number,
  declarerIndex: number,
  isFirstRound = true,
): { declarerIndex: number; trumpSuit: Suit | null; level: number } {
  if (current && isFirstRound) return { declarerIndex: current.playerIndex, trumpSuit: current.suit, level };
  // Subsequent rounds: the default declarer is always the actual declarer.
  // If someone revealed, use their trump suit; otherwise auto-call.
  if (current) return { declarerIndex, trumpSuit: current.suit, level };
  // Auto-call: pick suit with most level cards
  let best: Suit = Suit.Spades;
  let bestCnt = 0;
  for (const s of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
    const c = dealerHand.filter(c => c.suit === s && c.rank === level).length;
    if (c > bestCnt) { bestCnt = c; best = s; }
  }
  return { declarerIndex, trumpSuit: best, level };
}
