/**
 * Strategy adapters: engineStrategy = existing ai/, aiV2Strategy = ai-v2 copy.
 * One-line delegations; identical input → identical output (guarded by the
 * engine-side differential tests).
 */
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, ai0719, ai0802, ai0808, ai0809 } from '@poker/engine';
import type { CardSuit } from '@poker/engine';
import type { Strategy } from './types.js';

export const engineStrategy: Strategy = {
  name: 'ai',
  tryReveal: (hand, dealt, pi, level, cur) => aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => aiChooseBottomCards(hand, config),
  lead: (hand, config) => aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => aiFollowPlay(hand, lead, suit, config),
};

/** 基线策略：ai/ 在 98221b（2026-07-19）时的版本（leadSuit 参数为非空，竞技场调用点已保证非空）。 */
export const ai0719Strategy: Strategy = {
  name: 'ai-0719',
  tryReveal: (hand, dealt, pi, level, cur) => ai0719.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0719.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0719.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0719.aiFollowPlay(hand, lead, suit as CardSuit, config),
};

/** 快照基线：ai/ 在分位置跟牌重构提交（2026-08-02, ebe0625）时的版本，用于对比重构效果。 */
export const ai0802Strategy: Strategy = {
  name: 'ai-0802',
  tryReveal: (hand, dealt, pi, level, cur) => ai0802.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0802.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0802.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0802.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 133900d（2026-08-08，第四家不盖/NT 垫牌修复前）时的版本，README 中 1012 Elo 的测量对象。 */
export const ai0808Strategy: Strategy = {
  name: 'ai-0808',
  tryReveal: (hand, dealt, pi, level, cur) => ai0808.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0808.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0808.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0808.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 b77a7b1（2026-08-14，第二家避分修复前）时的版本，README 中 1035 Elo 的测量对象。 */
export const ai0809Strategy: Strategy = {
  name: 'ai-0809',
  tryReveal: (hand, dealt, pi, level, cur) => ai0809.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0809.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0809.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0809.aiFollowPlay(hand, lead, suit, config),
};

/** Resolve a strategy by name ('ai' | 'ai-0719' | 'ai-0802' | 'ai-0808' | 'ai-0809'). */
export function strategyByName(name: string): Strategy {
  if (name === 'ai') return engineStrategy;
  if (name === 'ai-0719') return ai0719Strategy;
  if (name === 'ai-0802') return ai0802Strategy;
  if (name === 'ai-0808') return ai0808Strategy;
  if (name === 'ai-0809') return ai0809Strategy;
  throw new Error(`未知策略: ${name}（可选: ai, ai-0719, ai-0802, ai-0808, ai-0809）`);
}
