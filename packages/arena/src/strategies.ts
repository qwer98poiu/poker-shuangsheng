/**
 * Strategy adapters: engineStrategy = existing ai/, aiV2Strategy = ai-v2 copy.
 * One-line delegations; identical input → identical output (guarded by the
 * engine-side differential tests).
 */
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, aiV2, ai0726 } from '@poker/engine';
import type { Strategy } from './types.js';

export const engineStrategy: Strategy = {
  name: 'ai',
  tryReveal: (hand, dealt, pi, level, cur) => aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => aiChooseBottomCards(hand, config),
  lead: (hand, config) => aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => aiFollowPlay(hand, lead, suit, config),
};

export const aiV2Strategy: Strategy = {
  name: 'ai-v2',
  tryReveal: (hand, dealt, pi, level, cur) => aiV2.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => aiV2.aiChooseBottomCards(hand, config),
  lead: (hand, config) => aiV2.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => aiV2.aiFollowPlay(hand, lead, suit, config),
};

/** 基线策略：ai/ 在 7382d1a（2026-07-26）时的版本。 */
export const ai0726Strategy: Strategy = {
  name: 'ai-0726',
  tryReveal: (hand, dealt, pi, level, cur) => ai0726.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0726.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0726.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0726.aiFollowPlay(hand, lead, suit, config),
};

/** Resolve a strategy by name ('ai' | 'ai-v2' | 'ai-0726'). */
export function strategyByName(name: string): Strategy {
  if (name === 'ai') return engineStrategy;
  if (name === 'ai-v2') return aiV2Strategy;
  if (name === 'ai-0726') return ai0726Strategy;
  throw new Error(`未知策略: ${name}（可选: ai, ai-v2, ai-0726）`);
}
