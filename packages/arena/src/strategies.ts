/**
 * Strategy adapters: engineStrategy = existing ai/, aiV2Strategy = ai-v2 copy.
 * One-line delegations; identical input → identical output (guarded by the
 * engine-side differential tests).
 */
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, aiV2 } from '@poker/engine';
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

/** Resolve a strategy by name ('ai' | 'ai-v2'). */
export function strategyByName(name: string): Strategy {
  if (name === 'ai') return engineStrategy;
  if (name === 'ai-v2') return aiV2Strategy;
  throw new Error(`未知策略: ${name}（可选: ai, ai-v2）`);
}
