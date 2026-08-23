import { describe, it, expect } from 'vitest';
import { Suit, Rank, GamePhase } from '../types.js';
import type { CardSuit } from '../types.js';
import { createCard } from '../model.js';
import {
  getRevealOptions, canOverride, finalize, revealStrength, canSelfReinforce,
} from '../revealing/index.js';
import { aiTryReveal, buildAIContext } from '../ai/index.js';
import { tryReveal, finalizeReveal } from '../game/index.js';

describe('Revealing — getRevealOptions', () => {
  it('returns NT with strength 4 for pair of BigJokers', () => {
    const opts = getRevealOptions([
      createCard('J' as any, Rank.BigJoker, 0),
      createCard('J' as any, Rank.BigJoker, 1),
    ], 2);
    const nt = opts.find(o => o.suit === null);
    expect(nt).toBeDefined();
    expect(nt!.strength).toBe(4);
  });

  it('returns NT with strength 3 for pair of SmallJokers', () => {
    const opts = getRevealOptions([
      createCard('J' as any, Rank.SmallJoker, 0),
      createCard('J' as any, Rank.SmallJoker, 1),
    ], 2);
    const nt = opts.find(o => o.suit === null);
    expect(nt).toBeDefined();
    expect(nt!.strength).toBe(3);
  });

  it('does NOT return NT for one big + one small joker', () => {
    const opts = getRevealOptions([
      createCard('J' as any, Rank.BigJoker, 0),
      createCard('J' as any, Rank.SmallJoker, 1),
    ], 2);
    expect(opts.find(o => o.suit === null)).toBeUndefined();
  });

  it('returns pair of level cards with strength 2', () => {
    const opts = getRevealOptions([
      createCard(Suit.Spades, Rank.Two, 0),
      createCard(Suit.Spades, Rank.Two, 1),
    ], 2);
    const s = opts.find(o => o.suit === Suit.Spades);
    expect(s!.strength).toBe(2);
  });

  it('returns single level card with strength 1', () => {
    const opts = getRevealOptions([
      createCard(Suit.Hearts, Rank.Five, 0),
    ], 5);
    const h = opts.find(o => o.suit === Suit.Hearts);
    expect(h!.strength).toBe(1);
  });
});

describe('Revealing — revealStrength 亮主过程（无人亮主不直接亮一对）', () => {
  it('无人亮主 + 单张级牌 → strength 1', () => {
    expect(revealStrength(null, { suit: Suit.Spades, strength: 1, reason: '' })).toBe(1);
  });

  it('无人亮主 + 级牌对 → 仍为 1（只能单张亮，不直接亮一对）', () => {
    expect(revealStrength(null, { suit: Suit.Spades, strength: 2, reason: '' })).toBe(1);
  });

  it('无人亮主 + 对王无主 → 保持 3/4（无主本身即一对）', () => {
    expect(revealStrength(null, { suit: null, strength: 3, reason: '' })).toBe(3);
    expect(revealStrength(null, { suit: null, strength: 4, reason: '' })).toBe(4);
  });

  it('已有人亮主 → 按选项力量（自保/反主用对子）', () => {
    const cur = { playerIndex: 0, suit: Suit.Spades, strength: 1 };
    expect(revealStrength(cur, { suit: Suit.Hearts, strength: 2, reason: '' })).toBe(2);
    expect(revealStrength(cur, { suit: null, strength: 4, reason: '' })).toBe(4);
  });
});

describe('Revealing — canSelfReinforce', () => {
  const hand = (ids: [CardSuit, number][]) => ids.map(([s, i]) => createCard(s, 2, i));

  it('自己单张主 + 手里还有同花色级牌对 → 可自保', () => {
    const cur = { playerIndex: 1, suit: Suit.Spades, strength: 1 };
    expect(canSelfReinforce(cur, hand([[Suit.Spades, 0], [Suit.Spades, 1]]), 2, 1)).toBe(true);
  });

  it('自己单张主 + 手里只有 1 张该级牌 → 不可自保', () => {
    const cur = { playerIndex: 1, suit: Suit.Spades, strength: 1 };
    expect(canSelfReinforce(cur, hand([[Suit.Spades, 0]]), 2, 1)).toBe(false);
  });

  it('无主（strength 3/4）不可自保（禁止自反）', () => {
    expect(canSelfReinforce(
      { playerIndex: 1, suit: null, strength: 3 },
      [createCard('J' as any, Rank.BigJoker, 0), createCard('J' as any, Rank.BigJoker, 1)], 2, 1,
    )).toBe(false);
  });

  it('别人的单张主 → 不是自保', () => {
    const cur = { playerIndex: 0, suit: Suit.Spades, strength: 1 };
    expect(canSelfReinforce(cur, hand([[Suit.Spades, 0], [Suit.Spades, 1]]), 2, 1)).toBe(false);
  });

  it('无人亮主 → false', () => {
    expect(canSelfReinforce(null, hand([[Suit.Spades, 0]]), 2, 1)).toBe(false);
  });
});

describe('Revealing — canOverride', () => {
  it('BigJoker pair (4) overrides SmallJoker pair (3)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: null, strength: 3 },
      { playerIndex: 1, suit: null, strength: 4 },
    )).toBe(true);
  });

  it('SmallJoker pair (3) overrides level pair (2)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Spades, strength: 2 },
      { playerIndex: 1, suit: null, strength: 3 },
    )).toBe(true);
  });

  it('Pair (2) overrides a single (1)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 1, suit: Suit.Spades, strength: 2 },
    )).toBe(true);
  });

  it('Equal strength does NOT override (对子不能反对子)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 2 },
      { playerIndex: 1, suit: Suit.Spades, strength: 2 },
    )).toBe(false);
  });

  it('Single (1) does NOT override a single (1)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 1, suit: Suit.Spades, strength: 1 },
    )).toBe(false);
  });

  it('Single (1) does NOT override a pair (2)', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 2 },
      { playerIndex: 1, suit: Suit.Spades, strength: 1 },
    )).toBe(false);
  });

  it('自反禁止：自己换花色不行（单张♥→对♠）', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 0, suit: Suit.Spades, strength: 2 },
    )).toBe(false);
  });

  it('自保允许：同花色单张→对子', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 0, suit: Suit.Hearts, strength: 2 },
    )).toBe(true);
  });

  it('无主不可自保：对小王无主→对大王无主视为自反，禁止', () => {
    expect(canOverride(
      { playerIndex: 2, suit: null, strength: 3 },
      { playerIndex: 2, suit: null, strength: 4 },
    )).toBe(false);
  });

  it('自保只能同花色：对大王无主不能换成有主花色', () => {
    expect(canOverride(
      { playerIndex: 2, suit: null, strength: 4 },
      { playerIndex: 2, suit: Suit.Clubs, strength: 2 },
    )).toBe(false);
  });

  it('反别人的主不受玩家限制（别人亮单张，自己对子反）', () => {
    expect(canOverride(
      { playerIndex: 0, suit: Suit.Hearts, strength: 1 },
      { playerIndex: 1, suit: Suit.Spades, strength: 2 },
    )).toBe(true);
  });
});

describe('Revealing — aiTryReveal 亮主过程（无人亮主不直接亮一对）', () => {
  const pair = (s: CardSuit) => [createCard(s, 5, 0), createCard(s, 5, 1)];

  it('无人亮主 + 对级牌 → 单张亮（不直接亮一对）', () => {
    const r = aiTryReveal(pair(Suit.Hearts), [], 1, 5, null);
    expect(r?.suit).toBe(Suit.Hearts);
    expect(r!.reason).toContain('单张');
  });

  it('无人亮主 + 单张级牌 → 单张亮', () => {
    const r = aiTryReveal([createCard(Suit.Clubs, 5, 0)], [], 1, 5, null);
    expect(r?.suit).toBe(Suit.Clubs);
    expect(r!.reason).toContain('单张');
  });

  it('无人亮主 + 对王 → 亮无主（无主本身即一对，不受单张限制）', () => {
    const r = aiTryReveal(
      [createCard('J' as any, Rank.SmallJoker, 0), createCard('J' as any, Rank.SmallJoker, 1)], [], 1, 5, null,
    );
    expect(r?.suit).toBeNull();
  });

  it('无人亮主 + 单张王 → 不亮（无主需对王）', () => {
    const r = aiTryReveal([createCard('J' as any, Rank.BigJoker, 0)], [], 1, 5, null);
    expect(r).toBeNull();
  });
});

describe('Revealing — aiTryReveal 对子反主', () => {
  const pair = (s: CardSuit) => [createCard(s, 5, 0), createCard(s, 5, 1)];

  it('对子反单张（保持既有行为）', () => {
    const r = aiTryReveal(pair(Suit.Hearts), [], 1, 5, { suit: Suit.Diamonds, strength: 1 });
    expect(r?.suit).toBe(Suit.Hearts);
  });

  it('对子不能反其他花色对子', () => {
    const r = aiTryReveal(pair(Suit.Clubs), [], 1, 5, { suit: Suit.Hearts, strength: 2 });
    expect(r).toBeNull();
  });

  it('对子不能反同花色对子', () => {
    const r = aiTryReveal(pair(Suit.Hearts), [], 1, 5, { suit: Suit.Hearts, strength: 2 });
    expect(r).toBeNull();
  });

  it('对子不能反对王（无主）', () => {
    const r = aiTryReveal(pair(Suit.Hearts), [], 1, 5, { suit: null, strength: 3 });
    expect(r).toBeNull();
  });

  it('自保：自己亮单张♥，手里同花色对 → 巩固为对♥', () => {
    const r = aiTryReveal(pair(Suit.Hearts), [], 1, 5, { suit: Suit.Hearts, strength: 1, playerIndex: 1 });
    expect(r?.suit).toBe(Suit.Hearts);
  });

  it('自反禁止：自己亮单张♥，手里其他花色对 → 不反', () => {
    const r = aiTryReveal(pair(Suit.Clubs), [], 1, 5, { suit: Suit.Hearts, strength: 1, playerIndex: 1 });
    expect(r).toBeNull();
  });

  it('无主不可自保：自己亮对小王无主，手里对大王 → 不触发', () => {
    const r = aiTryReveal([createCard('J' as any, Rank.BigJoker, 0), createCard('J' as any, Rank.BigJoker, 1)], [], 1, 5, { suit: null, strength: 3, playerIndex: 1 });
    expect(r).toBeNull();
  });

  it('自保已达上限：自己亮对大王无主 → 不再亮', () => {
    const r = aiTryReveal([createCard('J' as any, Rank.SmallJoker, 0), createCard('J' as any, Rank.SmallJoker, 1)], [], 1, 5, { suit: null, strength: 4, playerIndex: 1 });
    expect(r).toBeNull();
  });

  it('别人亮单张，自己对子反（不受玩家限制）', () => {
    const r = aiTryReveal(pair(Suit.Hearts), [], 1, 5, { suit: Suit.Diamonds, strength: 1, playerIndex: 0 });
    expect(r?.suit).toBe(Suit.Hearts);
  });
});

describe('tryReveal — 亮主过程（单张 → 自保，不直接亮一对）', () => {
  const pair = [createCard(Suit.Spades, 5, 0), createCard(Suit.Spades, 5, 1)];
  const mkState = (hand: typeof pair, currentReveal: any = null) => ({
    players: [{ hand }, {}, {}, {}],
    currentReveal,
    currentLevel: 5,
    reveals: [],
  }) as any;

  it('无人亮主 + 对级牌 → 亮单张（strength 1，不直接亮一对）', () => {
    const s = tryReveal(mkState(pair), 0, Suit.Spades);
    expect(s.currentReveal).toEqual({ playerIndex: 0, suit: Suit.Spades, strength: 1 });
  });

  it('再亮同花色 → 自保成对（strength 2）', () => {
    const s1 = tryReveal(mkState(pair), 0, Suit.Spades);
    const s2 = tryReveal(s1, 0, Suit.Spades);
    expect(s2.currentReveal).toEqual({ playerIndex: 0, suit: Suit.Spades, strength: 2 });
  });

  it('无人亮主 + 对王 → 亮无主保持 3/4', () => {
    const s = tryReveal(
      mkState([createCard('J' as any, Rank.BigJoker, 0), createCard('J' as any, Rank.BigJoker, 1)]),
      0, null,
    );
    expect(s.currentReveal).toEqual({ playerIndex: 0, suit: null, strength: 4 });
  });

  it('他人亮单张 → 自己反主用对子（strength 2）', () => {
    const cur = { playerIndex: 1, suit: Suit.Hearts, strength: 1 };
    const s = tryReveal(mkState(pair, cur), 0, Suit.Spades);
    expect(s.currentReveal).toEqual({ playerIndex: 0, suit: Suit.Spades, strength: 2 });
  });
});

describe('finalizeReveal — 顶层 declarerIndex 与亮主者同步', () => {
  const mkGameState = (defaultDeclarer: number, currentReveal: any) => ({
    players: [0, 1, 2, 3].map(i => ({
      name: `P${i}`, hand: [createCard(Suit.Hearts, 5, i)], isHuman: i === defaultDeclarer, index: i,
    })),
    phase: GamePhase.Revealing,
    currentPlayerIndex: defaultDeclarer,
    trumpDeclaration: null,
    declarerIndex: defaultDeclarer,
    attackerPoints: 0,
    bottomCards: [],
    trickHistory: [], trickPlays: [], leadPlayerIndex: defaultDeclarer,
    tricksPlayed: 0, currentLevel: 2, roundNumber: 0,
    reveals: currentReveal ? [currentReveal] : [], currentReveal,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: false, matchOver: false, settledTrick: null, throwPenalties: [0, 0],
  });

  it('第 1 局默认庄家 P0，P2 反主 → 顶层 declarerIndex 同步为 P2（AI isDeclarer 判定依赖）', () => {
    const state = mkGameState(0, { playerIndex: 2, suit: Suit.Spades, strength: 2 });
    const out = finalizeReveal(state as any, true);
    expect(out.trumpDeclaration!.declarerIndex).toBe(2); // 亮主者成为庄家
    expect(out.declarerIndex).toBe(2); // 顶层必须同步，否则 AI 策略身份判定失效
    const ctx = buildAIContext(out as any, 2)!;
    expect(ctx.isDeclarer).toBe(true);
    expect(ctx.isDeclarerPartner).toBe(false);
    expect(buildAIContext(out as any, 0)!.isDeclarer).toBe(false);
    expect(buildAIContext(out as any, 0)!.isDeclarerPartner).toBe(true); // (2+2)%4 = 0
  });

  it('无人亮主自动叫 → 庄家保持默认（顶层不变）', () => {
    const state = mkGameState(1, null);
    const out = finalizeReveal(state as any, true);
    expect(out.trumpDeclaration!.declarerIndex).toBe(1);
    expect(out.declarerIndex).toBe(1);
    expect(buildAIContext(out as any, 1)!.isDeclarer).toBe(true);
  });

  it('默认庄家 P1、P2 反主（实战 bug 形态：P2 既非 isDeclarer 也非 isDeclarerPartner）', () => {
    // 修复前：顶层停在 1 → AIContext 对 P2 两个身份标志全 false，
    // "手牌 ≥20 不出 A 以上主拖拉机"等庄家限制被整体跳过
    const state = mkGameState(1, { playerIndex: 2, suit: Suit.Spades, strength: 2 });
    const out = finalizeReveal(state as any, true);
    expect(out.trumpDeclaration!.declarerIndex).toBe(2);
    expect(out.declarerIndex).toBe(2);
    const ctx = buildAIContext(out as any, 2)!;
    expect(ctx.isDeclarer).toBe(true);
    expect(ctx.isDeclarerPartner).toBe(false);
  });

  it('后续局（isFirstRound=false）默认庄家即实际庄家 → 同步无副作用', () => {
    const state = mkGameState(3, { playerIndex: 3, suit: Suit.Hearts, strength: 1 });
    const out = finalizeReveal(state as any, false);
    expect(out.trumpDeclaration!.declarerIndex).toBe(3);
    expect(out.declarerIndex).toBe(3);
    expect(buildAIContext(out as any, 3)!.isDeclarer).toBe(true);
  });
});
