/**
 * Reason annotation utilities — translate strategy decisions into
 * human-readable play reasons.
 *
 * This module handles only the SECONDARY reason (intent annotation).
 * Primary reasons (e.g. "吊主", "同花色出大") are set inline by each
 * strategy function, which knows best what action was taken.
 */
import type { Card, ComboClass } from '../types.js';
import { isPointRank } from '../types.js';
import type { AIContext } from './types.js';
import { isOnlyLegalPlay } from '../following/index.js';

/**
 * Annotate a base reason with intent-specific suffix text.
 *
 * @param baseReason — primary reason set by the strategy function
 * @param cards — the cards being played (for checking if they have points)
 * @param leadSuitCards — cards in the lead suit (for unique-play check)
 * @param leadCombo — the lead combination pattern
 * @param leadLen — number of cards led
 * @param ctx — AI context
 * @param position — 'lead', 'second', 'third', or 'fourth'
 * @param tmWin — teammate is currently winning the trick
 * @param isTrumpKill — this play is a trump kill (skip unique-play check)
 * @param intent — what the player tried to achieve
 */
export function annotateReason(
  baseReason: string,
  cards: Card[],
  leadSuitCards: Card[],
  _trumpCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  isTrumpKill: boolean,
  intent: 'add' | 'avoid' | 'beat_points' | 'none',
): string {
  // Check unique-play first (not applicable to trump kill)
  if (!isTrumpKill && isOnlyLegalPlay(leadSuitCards, leadLen, leadCombo, ctx)) {
    return `${baseReason}（唯一可出）`;
  }

  if (intent === 'add') {
    const hasPoints = cards.some(c => isPointRank(c.rank));
    if (!hasPoints) return `${baseReason}（但没分可加）`;
    const suffix = (tmWin && leadCombo.hasTractor) ? '队友出拖拉机，加分' : '队友已大，加分';
    return `${baseReason}（${suffix}）`;
  }

  if (intent === 'avoid') {
    const hasPoints = cards.some(c => isPointRank(c.rank));
    if (hasPoints) return `${baseReason}（尽量少加分）`;
    if (position === 'second' && !isTrumpKill) return `${baseReason}（盖不过，不加分）`;
    return `${baseReason}（盖不过，不加分）`;
  }

  if (intent === 'beat_points') {
    const hasPoints = cards.some(c => isPointRank(c.rank));
    if (!hasPoints) return `${baseReason}（用最小牌盖）`;
    return `${baseReason}（用分牌盖）`;
  }

  return baseReason;
}

/** Map a numeric rank to its display label (A, K, Q, J). */
export function rankLabelStr(rank: number): string {
  return { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' }[rank] || String(rank);
}
