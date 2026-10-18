/**
 * Strategy adapters: engineStrategy = existing ai/, aiV2Strategy = ai-v2 copy.
 * One-line delegations; identical input → identical output (guarded by the
 * engine-side differential tests).
 */
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, ai0816, ai0907, ai0927, ai0929, ai1002, ai1005 } from '@poker/engine';
import type { Strategy } from './types.js';

export const engineStrategy: Strategy = {
  name: 'ai',
  tryReveal: (hand, dealt, pi, level, cur) => aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => aiChooseBottomCards(hand, config),
  lead: (hand, config) => aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 2d56a13（2026-08-16，扣底策略重构前）时的版本，README 中 1055 Elo 的测量对象。 */
export const ai0816Strategy: Strategy = {
  name: 'ai-0816',
  tryReveal: (hand, dealt, pi, level, cur) => ai0816.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0816.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0816.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0816.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 6aa2b80（2026-09-07，毙牌单张按档位选牌之前）时的版本。 */
export const ai0907Strategy: Strategy = {
  name: 'ai-0907',
  tryReveal: (hand, dealt, pi, level, cur) => ai0907.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0907.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0907.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0907.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 45c8f78（2026-09-27，亮主 4>3 修复与出副对清对之前）时的版本。 */
export const ai0927Strategy: Strategy = {
  name: 'ai-0927',
  tryReveal: (hand, dealt, pi, level, cur) => ai0927.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0927.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0927.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0927.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 be6026c（2026-09-29，NT 记牌器对子扣减修复）时的版本，Elo 刻度锚点。 */
export const ai0929Strategy: Strategy = {
  name: 'ai-0929',
  tryReveal: (hand, dealt, pi, level, cur) => ai0929.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0929.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0929.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0929.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 2024c08（2026-10-02，无主缺门/毙甩/无分墩规则与 pairCount 修复）时的版本，锚点 ai-0929 之后的第一次策略分歧。 */
export const ai1002Strategy: Strategy = {
  name: 'ai-1002',
  tryReveal: (hand, dealt, pi, level, cur) => ai1002.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai1002.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai1002.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai1002.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 805b500（2026-10-05，无主长花色领出层与第三家甩牌加分改判）时的版本。 */
export const ai1005Strategy: Strategy = {
  name: 'ai-1005',
  tryReveal: (hand, dealt, pi, level, cur) => ai1005.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai1005.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai1005.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai1005.aiFollowPlay(hand, lead, suit, config),
};

/** Resolve a strategy by name ('ai' | 'ai-0816' | 'ai-0907' | 'ai-0927' | 'ai-0929' | 'ai-1002' | 'ai-1005'). */
export function strategyByName(name: string): Strategy {
  if (name === 'ai') return engineStrategy;
  if (name === 'ai-0816') return ai0816Strategy;
  if (name === 'ai-0907') return ai0907Strategy;
  if (name === 'ai-0927') return ai0927Strategy;
  if (name === 'ai-0929') return ai0929Strategy;
  if (name === 'ai-1002') return ai1002Strategy;
  if (name === 'ai-1005') return ai1005Strategy;
  throw new Error(`未知策略: ${name}（可选: ai, ai-0816, ai-0907, ai-0927, ai-0929, ai-1002, ai-1005）`);
}
