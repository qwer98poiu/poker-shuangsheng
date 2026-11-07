/**
 * Strategy adapters: engineStrategy = the current ai-latest/ strategy.
 * One-line delegations; identical input → identical output (guarded by the
 * engine-side differential tests).
 */
import { aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay } from '@poker/ai';
import { ai0907, ai0929, ai1018, ai1024, ai1031, ai1106 } from '@poker/ai';
import type { Strategy } from './types.js';

export const engineStrategy: Strategy = {
  name: 'ai-latest',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => aiChooseBottomCards(hand, config),
  lead: (hand, config) => aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 6aa2b80（2026-09-07，毙牌单张按档位选牌之前）时的版本。 */
export const ai0907Strategy: Strategy = {
  name: 'ai-0907',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => ai0907.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0907.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0907.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0907.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 be6026c（2026-09-29，NT 记牌器对子扣减修复）时的版本，Elo 刻度锚点。 */
export const ai0929Strategy: Strategy = {
  name: 'ai-0929',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => ai0929.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai0929.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai0929.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai0929.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 b5de66（2026-10-18，领出阶梯按庄/闲分档重写之前，含 0a/0b 放宽）时的版本。 */
export const ai1018Strategy: Strategy = {
  name: 'ai-1018',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => ai1018.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai1018.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai1018.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai1018.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 bc38d6（2026-10-24，庄 4.5：主拖拉机先于通用 5 领出）时的版本。 */
export const ai1024Strategy: Strategy = {
  name: 'ai-1024',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => ai1024.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai1024.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai1024.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai1024.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 accffd（2026-10-31，0b 队友对子检查与跟牌拆拖拉机改版）时的版本。 */
export const ai1031Strategy: Strategy = {
  name: 'ai-1031',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => ai1031.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai1031.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai1031.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai1031.aiFollowPlay(hand, lead, suit, config),
};

/** 快照基线：ai/ 在 6c77d74（2026-11-06，庄家方统一领出阶梯落地）时的版本。 */
export const ai1106Strategy: Strategy = {
  name: 'ai-1106',
  revealsOnlyWhenEffective: true,
  tryReveal: (hand, dealt, pi, level, cur) => ai1106.aiTryReveal(hand, dealt, pi, level, cur),
  chooseBottom: (hand, config) => ai1106.aiChooseBottomCards(hand, config),
  lead: (hand, config) => ai1106.aiLeadPlay(hand, config),
  follow: (hand, lead, suit, config) => ai1106.aiFollowPlay(hand, lead, suit, config),
};

/** Resolve a strategy by name ('ai-latest' | 'ai-0907' | 'ai-0929' | 'ai-1018' | 'ai-1024' | 'ai-1031' | 'ai-1106'). */
export function strategyByName(name: string): Strategy {
  if (name === 'ai-latest') return engineStrategy;
  if (name === 'ai-0907') return ai0907Strategy;
  if (name === 'ai-0929') return ai0929Strategy;
  if (name === 'ai-1018') return ai1018Strategy;
  if (name === 'ai-1024') return ai1024Strategy;
  if (name === 'ai-1031') return ai1031Strategy;
  if (name === 'ai-1106') return ai1106Strategy;
  throw new Error(`未知策略: ${name}（可选: ai-latest, ai-0907, ai-0929, ai-1018, ai-1024, ai-1031, ai-1106）`);
}
