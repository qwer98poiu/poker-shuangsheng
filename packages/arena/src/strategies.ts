/**
 * Strategy adapters: engineStrategy = existing ai/, aiV2Strategy = ai-v2 copy.
 * One-line delegations; identical input → identical output (guarded by the
 * engine-side differential tests).
 */
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, ai0726, ai0707 } from '@poker/engine';
import type { CardSuit } from '@poker/engine';
import type { Strategy } from './types.js';

export const engineStrategy: Strategy = {
  name: 'ai',
  tryReveal: (hand, dealt, pi, level, cur) => aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => aiChooseBottomCards(hand, config),
  lead: (hand, config) => aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => aiFollowPlay(hand, lead, suit, config),
};

/** 基线策略：ai/ 在 7382d1a（2026-07-26）时的版本。 */
export const ai0726Strategy: Strategy = {
  name: 'ai-0726',
  tryReveal: (hand, dealt, pi, level, cur) => ai0726.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0726.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0726.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0726.aiFollowPlay(hand, lead, suit, config),
};

/** 基线策略：ai/ 在 ae2b76（2026-07-08）时的版本（leadSuit 参数为非空，竞技场调用点已保证非空）。 */
export const ai0707Strategy: Strategy = {
  name: 'ai-0707',
  tryReveal: (hand, dealt, pi, level, cur) => ai0707.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0707.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0707.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0707.aiFollowPlay(hand, lead, suit as CardSuit, config),
};

/** Resolve a strategy by name ('ai' | 'ai-0726' | 'ai-0707'). */
export function strategyByName(name: string): Strategy {
  if (name === 'ai') return engineStrategy;
  if (name === 'ai-0726') return ai0726Strategy;
  if (name === 'ai-0707') return ai0707Strategy;
  throw new Error(`未知策略: ${name}（可选: ai, ai-0726, ai-0707）`);
}
