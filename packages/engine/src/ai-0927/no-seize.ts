/**
 * 第四家「不抢无分墩」——避免不必要的毙牌。
 *
 * 领出副牌、自己缺门、当前是**对手**最大、且本墩前三家都没出分时，毙牌只是白花一张
 * 主牌把出牌权抢过来；若抢来又无牌可领，这一抢毫无收益。满足下列条件时改为按避分
 * 梯子垫牌，一旦垫牌落到禁用档（垫主分/拆主对/垫主牌 A 或更大，非庄家垫副分等）
 * 仍照常毙/盖毙：
 *
 *   1. 第四家（position === 'fourth'）
 *   2. 有主与 NT 均适用。NT 的主牌只有级牌与王，一律不得垫，故 NT 版等价于
 *      "只垫副牌，垫不起就照常毙"（详见 `pickNoSeizeDiscards`）
 *   3. 当前最大是队友 → 走加分分支，不适用；对手最大才考虑
 *   4. 本墩前三家都没出分（`trickPlays` 精确判定，未知按"有分"退回现行为）
 *   5. 建议出牌是真毙、且里面没有分牌（能用分牌毙就照常毙）
 *   6. 没有值得出的牌（优先级 1–4 全找不出含副牌的结果）
 *   7. 垫得起（`pickNoSeizeDiscards` 取满 leadLen 张）
 */
import type { Card, ComboClass } from '../types.js';
import { isPointRank } from '../types.js';
import { isTrump } from '../model.js';
import type { AIContext } from './types.js';
import { annotateReason } from './reason.js';
import { trumpKill, isBeatingTrumpKill, type KillMode } from './follow-trump.js';
import { pickNoSeizeDiscards } from './position-policy.js';
import { hasWorthLeadCards } from './lead.js';

/** 本墩已出牌是否全知（`trickPlays` 长度与 `playCount` 相符）。 */
function trickFullyKnown(ctx: AIContext): boolean {
  return ctx.playCount > 0 && ctx.trickPlays.length === ctx.playCount;
}

/** 本墩前三家是否都没出分。未知一律按"有分"处理——退回改动前的行为（照常毙）。 */
function trickHasNoPoints(ctx: AIContext): boolean {
  if (!trickFullyKnown(ctx)) return false;
  return !ctx.trickPlays.some(p => p.cards.some(c => isPointRank(c.rank)));
}

/**
 * 放弃毙牌（改为垫牌）时返回那手垫牌；照常毙时返回 null，调用方接着调 `trumpKill`。
 *
 * 注意（层次）：这里必须调**毙牌选择器本体** `trumpKill` 取建议出牌，**不能**调顶层
 * `aiFollowPlay` / `suggestPlay`——顶层建议正是由本函数决定的，改调它立刻成环。
 */
export function probeDeclineKill(
  hand: Card[],
  leadCards: Card[],
  leadCombo: ComboClass,
  leadLen: number,
  ctx: AIContext,
  position: string,
  tmWin: boolean,
  trumpCards: Card[],
  opts?: { killMode?: KillMode },
): { cards: Card[]; reason: string } | null {
  if (position !== 'fourth') return null;
  if (tmWin) return null;                       // 对手（第一家或第三家）最大才考虑不抢
  if (!trickHasNoPoints(ctx)) return null;

  const proposal = trumpKill(trumpCards, hand, leadCards, leadCombo, leadLen, ctx,
    position, tmWin, opts);
  // 非真毙（trumpKill 自己已在垫牌：盖不过、拖拉机/甩牌匹配不上）→ 保持现行为
  if (!isBeatingTrumpKill(proposal.cards, leadCards, ctx)) return null;
  if (proposal.cards.some(c => isPointRank(c.rank))) return null; // 能用分牌毙 → 照常毙
  if (hasWorthLeadCards(hand, ctx)) return null;                  // 有值得出的牌 → 抢

  const cards = pickNoSeizeDiscards(hand, leadLen, ctx);
  if (!cards) return null;                                        // 垫不起 → 照常毙

  const baseReason = cards.every(c => isTrump(c, ctx)) ? '垫主牌' : '垫牌';
  const reason = annotateReason(baseReason, cards, [], trumpCards,
    leadCombo, leadLen, ctx, position, tmWin, false, 'noSeize');
  return { cards, reason };
}
