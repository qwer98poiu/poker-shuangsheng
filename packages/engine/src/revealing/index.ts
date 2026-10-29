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
import { Rank, Suit, SUIT_ORDER } from '../types.js';
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

/**
 * 这手牌是否**可能**产生一次会改变 currentReveal 的亮主/反主/自保。
 *
 * 与「枚举 getRevealOptions 再逐个 canOverride」等价，但只遍历一次手牌。
 * 按当前亮主的力量分档：
 * - 无人亮主：任意级牌（单张即可亮），或对大王/对小王；
 * - 他人亮单张(1)：任一对级牌（2 > 1），或对王；
 * - 他人亮对级牌(2)：对王（3/4 > 2）；
 * - 他人亮对小王(3)：对大王（4 > 3）；
 * - 他人亮对大王(4)：不可能；
 * - 自己亮的主：只有 strength 1 时能用**同花色**对级牌自保，其余一律不可能
 *   （无主不可自保、不能换花色自反）。
 *
 * 供发牌循环在调用策略前剪枝。注意：只有「不可能生效」时才能跳过调用——
 * 策略允许返回会被 `tryReveal` 记为失败尝试的选项，那是公开信息，
 * `state.reveals` 需要保留它（见 arena 的 record-hooks 测试）。
 */
export function canRevealOrOverride(
  hand: readonly Card[],
  playerIndex: number,
  level: number,
  current: { suit: Suit | null; strength: number; playerIndex?: number } | null,
): boolean {
  let bigJokers = 0;
  let smallJokers = 0;
  let hasLevelCard = false;
  const levelCounts = [0, 0, 0, 0]; // SUIT_ORDER 下标
  for (const c of hand) {
    if (c.rank === Rank.BigJoker) { bigJokers += 1; continue; }
    if (c.rank === Rank.SmallJoker) { smallJokers += 1; continue; }
    if (c.rank === level) {
      hasLevelCard = true;
      const idx = SUIT_ORDER.indexOf(c.suit as Suit);
      if (idx >= 0) levelCounts[idx] += 1;
    }
  }

  const jokerPair = bigJokers >= 2 || smallJokers >= 2;
  if (!current || current.strength <= 0) return hasLevelCard || jokerPair;

  if (current.playerIndex === playerIndex) {
    if (current.strength !== 1 || current.suit === null) return false;
    return (levelCounts[SUIT_ORDER.indexOf(current.suit)] ?? 0) >= 2;
  }

  if (current.strength === 1) return jokerPair || levelCounts.some(n => n >= 2);
  if (current.strength === 2) return jokerPair;
  if (current.strength === 3) return bigJokers >= 2;
  return false;
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
