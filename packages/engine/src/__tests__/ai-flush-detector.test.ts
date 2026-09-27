/**
 * 清对（领出优先级 0）与"第三家跟清对"——利用上一墩出牌信息。
 *
 * 基础模块测试按 CLAUDE.md 要求逐项穷举：
 *   视角（P0-P3）× 副花色（♠♣♦）× 每个配牌者（三个座位）× 跟出的对数（0/1/2）。
 *
 * 核心推论：领出含对牌型时，跟牌者若手上有该花色对子就必须出对
 * （checkPairFollow / computeIdealFollow 的 minTotalPairs = min(fillCap, needed)），
 * 故"实出对数 < 领出要求对数"⇒ 该家该花色对子已出光。
 *
 * 注意 `Suit` 的键是复数（`Suit.Spades` 等）；写 `Suit.Spade` 会得到 undefined，
 * 与 `trumpSuit: undefined` 相配时 `isTrump` 会判定"全牌皆主"、静默测到另一条分支。
 */
import { describe, it, expect } from 'vitest';
import { createCard, isTrump } from '../model.js';
import { Suit, Rank, cardPointsFromRank } from '../types.js';
import type { Card, CardSuit, PlayedCards, Trick, TrumpDeclaration } from '../types.js';
import { classify } from '../pattern/index.js';
import { validateThrow } from '../leading/index.js';
import { compareTwo } from '../comparing/index.js';
import type { AIContext } from '../ai/types.js';
import {
  detectFlushEvidence, tryLeadFlushThrow, isFlushFollow, avoidBeatingTeammate,
} from '../ai/flush-detector.js';
import { canAddPoints } from '../ai/helpers.js';
import { aiLeadPlay, aiFollowPlay } from '../ai/index.js';

// ---- 夹具 ----

const CFG: TrumpDeclaration = { trumpSuit: Suit.Hearts, level: Rank.Two, declarerIndex: 0 };

let idSeq = 0;
const c = (suit: CardSuit, rank: number): Card => createCard(suit, rank as Rank, idSeq++);

const SIDE_SUITS = [Suit.Spades, Suit.Clubs, Suit.Diamonds] as const;
const SUIT_CN: Record<string, string> = { S: '♠', C: '♣', D: '♦' };

/** 证据墩的领出：同花色两对，非连续 → classify 得 throw（reqPairs=2, leadLen=4）。 */
const leadOf = (s: CardSuit): Card[] => [c(s, 14), c(s, 14), c(s, 9), c(s, 9)];
/** 跟 0 对，跟满 4 张。 */
const noPair = (s: CardSuit): Card[] => [c(s, 13), c(s, 12), c(s, 11), c(s, 7)];
/** 跟 1 对（< reqPairs）。 */
const onePair = (s: CardSuit): Card[] => [c(s, 13), c(s, 13), c(s, 12), c(s, 11)];
/** 跟 2 对（== reqPairs，信息不足）。 */
const twoPair = (s: CardSuit): Card[] => [c(s, 13), c(s, 13), c(s, 12), c(s, 12)];
/** 短牌：该花色只有 2 张，其余用主牌补（主牌不属于该花色组）。 */
const shortOf = (s: CardSuit): Card[] => [c(s, 13), c(s, 12), c(Suit.Hearts, 6), c(Suit.Hearts, 7)];
/** 缺门：该花色 0 张。 */
const voidOf = (): Card[] => [c(Suit.Hearts, 6), c(Suit.Hearts, 7), c(Suit.Hearts, 8), c(Suit.Hearts, 9)];

/** 一墩（plays 按出牌顺序，[0] 为领出）。 */
function trickOf(leadIdx: number, winIdx: number, plays: Card[][]): Trick {
  return {
    plays: plays.map(cards => ({
      cards,
      pattern: classify(cards, CFG),
      leadSuit: cards.every(x => isTrump(x, CFG)) ? null : (cards[0].suit as CardSuit),
    })) as [PlayedCards, PlayedCards, PlayedCards, PlayedCards],
    leadPlayerIndex: leadIdx,
    winnerIndex: winIdx,
    points: plays.flat().reduce((s, x) => s + cardPointsFromRank(x.rank), 0),
  };
}

interface CtxOpts {
  myIndex?: number;
  history?: Trick[];
  playCount?: number;
  leadPlayerIndex?: number;
  trickPlays?: { cards: Card[] }[];
  bestSoFar?: { cards: Card[]; playerIndex: number } | null;
  attackerPoints?: number;
}

function ctxOf(o: CtxOpts = {}): AIContext {
  const myIndex = o.myIndex ?? 0;
  const declIdx = CFG.declarerIndex;
  return {
    ...CFG,
    myIndex,
    isDeclarer: myIndex === declIdx,
    isDeclarerPartner: myIndex === (declIdx + 2) % 4,
    isAttacker: myIndex % 2 !== declIdx % 2,
    attackerPoints: o.attackerPoints ?? 0,
    handCounts: [20, 20, 20, 20],
    trickHistory: o.history ?? [],
    reveals: [],
    playCount: o.playCount ?? 0,
    leadPlayerIndex: o.leadPlayerIndex ?? myIndex,
    trickPlays: o.trickPlays ?? [],
    bestSoFar: o.bestSoFar ?? null,
    ntState: null,
    bottomCards: null,
    debug: false,
  };
}

/** 标准证据墩：`hero` 领出该花色两对、赢下，三家都跟满 4 张且都没出满对数。 */
function evidenceTrick(hero: number, suit: CardSuit): Trick {
  return trickOf(hero, hero, [leadOf(suit), noPair(suit), noPair(suit), noPair(suit)]);
}

// ---- 1. 正向穷举：视角 × 花色 ----

describe('detectFlushEvidence — 正向穷举（4 视角 × 3 副花色）', () => {
  for (const hero of [0, 1, 2, 3]) {
    for (const suit of SIDE_SUITS) {
      it(`P${hero} 领出 ${SUIT_CN[suit]} 两对并赢下，三家各 0 对且跟满 → 有证据`, () => {
        const ctx = ctxOf({ myIndex: hero, history: [evidenceTrick(hero, suit)] });
        expect(detectFlushEvidence(ctx, hero)).toEqual({ suit, leadLen: 4, reqPairs: 2 });
      });
    }
  }
});

// ---- 2. G1 穷举：视角 × 目标座位 × 跟出的对数 ----

describe('detectFlushEvidence — G1（每个配牌者各跟 0/1/2 对，阈值 = reqPairs）', () => {
  for (const hero of [0, 1, 2, 3]) {
    for (let slot = 1; slot <= 3; slot++) {
      const target = (hero + slot) % 4;
      const cases: [number, Card[], boolean][] = [
        [0, noPair(Suit.Spades), true],   // 0 < 2 → 对子已绝
        [1, onePair(Suit.Spades), true],  // 1 < 2 → 对子已绝
        [2, twoPair(Suit.Spades), false], // 2 == 2 → 信息不足
      ];
      for (const [pairs, play, expected] of cases) {
        it(`P${hero} 视角、P${target} 跟 ${pairs} 对 → ${expected ? '有证据' : '无证据'}`, () => {
          const plays = [leadOf(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades)];
          plays[slot] = play;
          const ctx = ctxOf({ myIndex: hero, history: [trickOf(hero, hero, plays)] });
          const ev = detectFlushEvidence(ctx, hero);
          if (expected) expect(ev).toEqual({ suit: Suit.Spades, leadLen: 4, reqPairs: 2 });
          else expect(ev).toBeNull();
        });
      }
    }
  }
});

// ---- 3. G2 穷举：视角 × 目标座位 × 短牌/缺门（队友豁免） ----

describe('detectFlushEvidence — G2（短牌/缺门只对对手生效，第三家豁免）', () => {
  for (const hero of [0, 1, 2, 3]) {
    const partner = (hero + 2) % 4;
    for (let slot = 1; slot <= 3; slot++) {
      const target = (hero + slot) % 4;
      const isPartner = target === partner;
      const cases: [string, Card[]][] = [
        ['短牌（跟 2 张 < 4）', shortOf(Suit.Spades)],
        ['缺门（跟 0 张）', voidOf()],
      ];
      for (const [label, play] of cases) {
        it(`P${hero} 视角、P${target} ${label} → ${isPartner ? '仍触发（队友豁免）' : '不触发（可能用主对毙）'}`, () => {
          const plays = [leadOf(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades)];
          plays[slot] = play;
          const ctx = ctxOf({ myIndex: hero, history: [trickOf(hero, hero, plays)] });
          const ev = detectFlushEvidence(ctx, hero);
          if (isPartner) expect(ev).toEqual({ suit: Suit.Spades, leadLen: 4, reqPairs: 2 });
          else expect(ev).toBeNull();
        });
      }
    }
  }
});

// ---- 4. 负向：领出/赢家/牌型/历史 ----

describe('detectFlushEvidence — 负向场景', () => {
  const full = () => [leadOf(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades)];

  it('Trick 有，但领出者不是 hero → null', () => {
    const ctx = ctxOf({ myIndex: 0, history: [trickOf(1, 1, full())] });
    expect(detectFlushEvidence(ctx, 0)).toBeNull();
  });

  it('领出者是 hero 但赢家不是 hero → null', () => {
    const ctx = ctxOf({ myIndex: 0, history: [trickOf(0, 1, full())] });
    expect(detectFlushEvidence(ctx, 0)).toBeNull();
  });

  it('trickHistory 为空（ensureContext 兼容路径）→ null', () => {
    expect(detectFlushEvidence(ctxOf({ myIndex: 0, history: [] }), 0)).toBeNull();
  });

  it('myIndex 为 -1 → null', () => {
    expect(detectFlushEvidence(ctxOf({ myIndex: -1, history: [evidenceTrick(0, Suit.Spades)] }), -1)).toBeNull();
  });

  it('hero 传 -1 → null', () => {
    expect(detectFlushEvidence(ctxOf({ myIndex: 0, history: [evidenceTrick(0, Suit.Spades)] }), -1)).toBeNull();
  });

  it('主牌领出（含主牌对）→ null', () => {
    const t = trickOf(0, 0, [
      [c(Suit.Hearts, 9), c(Suit.Hearts, 9), c(Suit.Hearts, 8), c(Suit.Hearts, 8)],
      [c(Suit.Clubs, 4), c(Suit.Clubs, 5), c(Suit.Clubs, 6), c(Suit.Clubs, 7)],
      [c(Suit.Clubs, 8), c(Suit.Clubs, 9), c(Suit.Clubs, 10), c(Suit.Clubs, 11)],
      [c(Suit.Diamonds, 3), c(Suit.Diamonds, 4), c(Suit.Diamonds, 5), c(Suit.Diamonds, 6)],
    ]);
    expect(detectFlushEvidence(ctxOf({ myIndex: 0, history: [t] }), 0)).toBeNull();
  });

  it('全单领出（reqPairs = 0）→ null', () => {
    const t = trickOf(0, 0, [
      [c(Suit.Spades, 14), c(Suit.Spades, 13), c(Suit.Spades, 12), c(Suit.Spades, 11)],
      noPair(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades),
    ]);
    expect(detectFlushEvidence(ctxOf({ myIndex: 0, history: [t] }), 0)).toBeNull();
  });

  it('单张领出（leadLen 1）→ null', () => {
    const t = trickOf(0, 0, [
      [c(Suit.Spades, 14)],
      [c(Suit.Spades, 13)], [c(Suit.Spades, 12)], [c(Suit.Spades, 11)],
    ]);
    expect(detectFlushEvidence(ctxOf({ myIndex: 0, history: [t] }), 0)).toBeNull();
  });

  it('该花色级牌不算该花色（领出 ♠ 但对子含级牌时仍是主牌组）', () => {
    // ♠2 是级牌 → 主牌，suitGroup 判成 _TRUMP_，与 ♠A 不同组 → 不构成同组领出
    const t = trickOf(0, 0, [
      [c(Suit.Spades, 2), c(Suit.Spades, 2), c(Suit.Spades, 9), c(Suit.Spades, 9)],
      noPair(Suit.Spades), noPair(Suit.Spades), noPair(Suit.Spades),
    ]);
    expect(detectFlushEvidence(ctxOf({ myIndex: 0, history: [t] }), 0)).toBeNull();
  });
});

// ---- 5. 领出清对：tryLeadFlushThrow ----

describe('tryLeadFlushThrow — 把该门剩下的对一次性甩出', () => {
  const ev = () => ctxOf({ myIndex: 0, history: [evidenceTrick(0, Suit.Spades)] });

  it('剩 3 对 → 全部甩出，理由精确', () => {
    const hand = [
      c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6),
      c(Suit.Spades, 3), c(Suit.Spades, 3), c(Suit.Hearts, 7), c(Suit.Clubs, 4),
    ];
    const r = tryLeadFlushThrow(hand, ev())!;
    expect(r.cards.map(x => `${x.suit}${x.rank}`)).toEqual(['S8', 'S8', 'S6', 'S6', 'S3', 'S3']);
    expect(r.reason).toBe('甩♠副牌(对子已绝，3对)');
  });

  it('剩 2 对且连续 → 牌型为拖拉机', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 7), c(Suit.Spades, 7), c(Suit.Hearts, 7)];
    const r = tryLeadFlushThrow(hand, ev())!;
    expect(classify(r.cards, CFG).type).toBe('tractor');
  });

  it('剩 2 对且非连续 → 牌型为甩牌，且引擎判合法（无人持该花色对）', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 5), c(Suit.Spades, 5), c(Suit.Hearts, 7)];
    const r = tryLeadFlushThrow(hand, ev())!;
    expect(classify(r.cards, CFG).type).toBe('throw');
    const otherHands = [
      [c(Suit.Spades, 13), c(Suit.Spades, 12), c(Suit.Clubs, 4), c(Suit.Clubs, 6)],
      [c(Suit.Spades, 11), c(Suit.Spades, 10), c(Suit.Diamonds, 3), c(Suit.Diamonds, 4)],
      [c(Suit.Spades, 9), c(Suit.Spades, 7), c(Suit.Clubs, 5), c(Suit.Clubs, 7)],
    ];
    expect(validateThrow(r.cards, hand, otherHands, CFG).valid).toBe(true);
  });

  it('对照：某个对手持该花色更大的对 → 引擎判非法', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 5), c(Suit.Spades, 5), c(Suit.Hearts, 7)];
    const r = tryLeadFlushThrow(hand, ev())!;
    const otherHands = [
      [c(Suit.Spades, 13), c(Suit.Spades, 13), c(Suit.Clubs, 4), c(Suit.Clubs, 6)],
      [c(Suit.Spades, 11), c(Suit.Spades, 10), c(Suit.Diamonds, 3), c(Suit.Diamonds, 4)],
      [c(Suit.Spades, 9), c(Suit.Spades, 7), c(Suit.Clubs, 5), c(Suit.Clubs, 7)],
    ];
    expect(validateThrow(r.cards, hand, otherHands, CFG).valid).toBe(false);
  });

  it('只剩 1 对 → null（普通出对，交给优先级 2/4）', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Hearts, 7)];
    expect(tryLeadFlushThrow(hand, ev())).toBeNull();
  });

  it('该花色 0 对 → null', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Hearts, 7)];
    expect(tryLeadFlushThrow(hand, ev())).toBeNull();
  });

  it('该花色级牌（主牌）不计为对 → null', () => {
    const hand = [c(Suit.Spades, 2), c(Suit.Spades, 2), c(Suit.Spades, 6), c(Suit.Spades, 6)];
    expect(tryLeadFlushThrow(hand, ev())).toBeNull();
  });

  it('非领出（playCount != 0）→ null', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)];
    expect(tryLeadFlushThrow(hand, ctxOf({ myIndex: 0, playCount: 1, history: [evidenceTrick(0, Suit.Spades)] }))).toBeNull();
  });

  it('无证据（无历史）→ null', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)];
    expect(tryLeadFlushThrow(hand, ctxOf({ myIndex: 0 }))).toBeNull();
  });
});

// ---- 6. 第三家跟清对：isFlushFollow ----

describe('isFlushFollow — 第三家跟"队友清对领出"', () => {
  const thirdCtx = () => ctxOf({
    myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
  });
  const k = (cards: Card[]) => classify(cards, CFG);

  it('第三家 + 全对领出 + 同花色 → true', () => {
    expect(isFlushFollow(thirdCtx(), k([c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)]))).toBe(true);
  });

  it('领出 3 对（多于证据 2 对）→ 仍 true', () => {
    expect(isFlushFollow(thirdCtx(), k([
      c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6),
      c(Suit.Spades, 6), c(Suit.Spades, 5), c(Suit.Spades, 5),
    ]))).toBe(true);
  });

  it('领出 1 对 + 2 单张 → false（含单张的甩牌可被第四家单张盖过）', () => {
    expect(isFlushFollow(thirdCtx(), k([c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 3)]))).toBe(false);
  });

  it('领出 2 对 + 1 单张 → false', () => {
    expect(isFlushFollow(thirdCtx(), k([
      c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6), c(Suit.Spades, 3),
    ]))).toBe(false);
  });

  it('领出全单（4 张单）→ false', () => {
    expect(isFlushFollow(thirdCtx(), k([c(Suit.Spades, 8), c(Suit.Spades, 7), c(Suit.Spades, 6), c(Suit.Spades, 3)]))).toBe(false);
  });

  it('连续对（拖拉机）→ true', () => {
    expect(isFlushFollow(thirdCtx(), k([c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 7), c(Suit.Spades, 7)]))).toBe(true);
  });

  it('花色与证据花色不同 → false', () => {
    expect(isFlushFollow(thirdCtx(), k([c(Suit.Clubs, 8), c(Suit.Clubs, 8), c(Suit.Clubs, 6), c(Suit.Clubs, 6)]))).toBe(false);
  });

  it('领出者不是队友（P1 视角，领出者 P0 是对手）→ false', () => {
    const ctx = ctxOf({ myIndex: 1, playCount: 1, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)] });
    expect(isFlushFollow(ctx, k([c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)]))).toBe(false);
  });

  it('主牌领出 → false', () => {
    expect(isFlushFollow(thirdCtx(), k([c(Suit.Hearts, 9), c(Suit.Hearts, 9), c(Suit.Hearts, 8), c(Suit.Hearts, 8)]))).toBe(false);
  });

  it('无证据（无历史）→ false', () => {
    const ctx = ctxOf({ myIndex: 2, playCount: 2, leadPlayerIndex: 0 });
    expect(isFlushFollow(ctx, k([c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)]))).toBe(false);
  });
});

// ---- 7. 加分钩子：canAddPoints ----

describe('canAddPoints — 第三家清对领出转为加分（含守卫不变）', () => {
  const leadCards = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)];
  const combo = classify(leadCards, CFG);
  const base = (extra: Partial<CtxOpts> = {}) => ctxOf({
    myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)], ...extra,
  });

  it('无证据时，非顶张对领出不加分（原行为）', () => {
    const ctx = ctxOf({ myIndex: 2, playCount: 2, leadPlayerIndex: 0 });
    expect(canAddPoints(true, 'third', combo, ctx)).toBe(false);
  });

  it('有证据时，同一领出改为加分', () => {
    expect(canAddPoints(true, 'third', combo, base())).toBe(true);
  });

  it('守卫：队友未大（第二家已毙）→ 仍不加分', () => {
    const ruff = [c(Suit.Hearts, 9), c(Suit.Hearts, 9), c(Suit.Clubs, 4), c(Suit.Clubs, 5)];
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
      bestSoFar: { cards: ruff, playerIndex: 1 },
    });
    expect(canAddPoints(false, 'third', combo, ctx)).toBe(false);
  });

  it('守卫：庄家方且闲家得分 + 本墩已出分 = 70 → 仍不加分', () => {
    // 领出 ♠8♠8♠6♠6 无分，bestSoFar 即领出者（不重复计）→ vis = 0，故 70 + 0 = 70
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
      attackerPoints: 70, bestSoFar: { cards: leadCards, playerIndex: 0 },
    });
    expect(canAddPoints(true, 'third', combo, ctx)).toBe(false);
  });

  it('守卫：庄家方且闲家得分 >= 75 → 仍不加分', () => {
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)], attackerPoints: 75,
    });
    expect(canAddPoints(true, 'third', combo, ctx)).toBe(false);
  });
});

// ---- 8. 第三家不得盖过队友 ----

describe('avoidBeatingTeammate — 第三家不得抢队友的牌', () => {
  const leadCards = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)];
  const combo = classify(leadCards, CFG);
  const thirdCtx = () => ctxOf({
    myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
    bestSoFar: { cards: leadCards, playerIndex: 0 },
  });
  const show = (a: Card[]) => a.map(x => `${x.suit}${x.rank}`).join(',');

  it('没有盖过队友 → 原样返回', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 9), c(Suit.Hearts, 13), c(Suit.Hearts, 3)];
    expect(show(avoidBeatingTeammate(h, h, leadCards, combo, thirdCtx()))).toBe('H10,H9,H13,H3');
  });

  it('两对主牌会盖过队友 → 换出一张，保留牌权', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 13), c(Suit.Hearts, 9), c(Suit.Hearts, 3)];
    const sel = h.slice(0, 4);
    const ctx = thirdCtx();
    expect(compareTwo(leadCards, sel, leadCards, CFG)).toBe('second'); // 前提：确实盖过
    const out = avoidBeatingTeammate(sel, h, leadCards, combo, ctx);
    expect(compareTwo(leadCards, out, leadCards, CFG)).toBe('first');  // 结果：不再盖过
    expect(show(out)).toBe('H10,H10,H13,H3');
  });

  it('例外 1：手牌恰为两对主牌、无法避免 → 原样返回（不得不毙）', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 13)];
    expect(show(avoidBeatingTeammate(h, h, leadCards, combo, thirdCtx()))).toBe('H10,H10,H13,H13');
  });

  it('例外 2：闲家本墩一次加分到 80 → 允许盖过队友把分打出去', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 13), c(Suit.Hearts, 9), c(Suit.Hearts, 3)];
    const sel = h.slice(0, 4);
    // P1 是闲家（declarer 0），领出者是队友 P3 —— 证据墩也必须由 P3 领出并赢下
    const ctx = ctxOf({
      myIndex: 1, playCount: 2, leadPlayerIndex: 3, history: [evidenceTrick(3, Suit.Spades)],
      attackerPoints: 60, bestSoFar: { cards: leadCards, playerIndex: 3 },
    });
    expect(isFlushFollow(ctx, combo)).toBe(true); // 前提成立，否则本用例会因提前返回而空转
    expect(show(avoidBeatingTeammate(sel, h, leadCards, combo, ctx))).toBe('H10,H10,H13,H13');
  });

  it('闲家但加满也到不了 80 → 仍换牌', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 13), c(Suit.Hearts, 9), c(Suit.Hearts, 3)];
    const sel = h.slice(0, 4);
    const ctx = ctxOf({
      myIndex: 1, playCount: 2, leadPlayerIndex: 3, history: [evidenceTrick(3, Suit.Spades)],
      attackerPoints: 30, bestSoFar: { cards: leadCards, playerIndex: 3 },
    });
    expect(show(avoidBeatingTeammate(sel, h, leadCards, combo, ctx))).toBe('H10,H10,H13,H3');
  });

  it('队友未大（第二家已毙）→ 本约束不适用，原样返回', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 13), c(Suit.Hearts, 9)];
    const sel = h.slice(0, 4);
    const ruff = [c(Suit.Hearts, 2), c(Suit.Hearts, 2), c(Suit.Clubs, 4), c(Suit.Clubs, 5)];
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
      bestSoFar: { cards: ruff, playerIndex: 1 },
    });
    expect(show(avoidBeatingTeammate(sel, h, leadCards, combo, ctx))).toBe('H10,H10,H13,H13');
  });

  it('非清对场景（无证据）→ 原样返回', () => {
    const h = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 13)];
    const ctx = ctxOf({ myIndex: 2, playCount: 2, leadPlayerIndex: 0, bestSoFar: { cards: leadCards, playerIndex: 0 } });
    expect(show(avoidBeatingTeammate(h, h, leadCards, combo, ctx))).toBe('H10,H10,H13,H13');
  });
});

// ---- 9. 端到端 ----

describe('端到端 — aiLeadPlay / aiFollowPlay', () => {
  it('领出：上一墩验对后，把该门剩下的对一次性甩出', () => {
    const hand = [
      c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6),
      c(Suit.Spades, 3), c(Suit.Spades, 3), c(Suit.Hearts, 7), c(Suit.Clubs, 4),
    ];
    const r = aiLeadPlay(hand, ctxOf({ myIndex: 0, history: [evidenceTrick(0, Suit.Spades)] }));
    expect(r.cards.map(x => `${x.suit}${x.rank}`)).toEqual(['S8', 'S8', 'S6', 'S6', 'S3', 'S3']);
    expect(r.reason).toBe('甩♠副牌(对子已绝，3对)');
  });

  it('跟牌（甩牌领出）：第三家缺门全主，两对主牌不抢队友的牌', () => {
    const leadCards = [c(Suit.Spades, 10), c(Suit.Spades, 10), c(Suit.Spades, 4), c(Suit.Spades, 4)];
    const hand = [
      c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13),
      c(Suit.Hearts, 13), c(Suit.Hearts, 9), c(Suit.Hearts, 3),
    ];
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
      trickPlays: [{ cards: leadCards }], bestSoFar: { cards: leadCards, playerIndex: 0 },
    });
    const r = aiFollowPlay(hand, leadCards, Suit.Spades, ctx);
    expect(compareTwo(leadCards, r.cards, leadCards, CFG)).toBe('first'); // 未盖过队友
    expect(r.cards.map(x => `${x.suit}${x.rank}`)).toEqual(['H10', 'H10', 'H13', 'H3']);
    expect(r.reason).toContain('加分');
  });

  it('跟牌（一对领出）：第三家缺门时不再"一对 J 以下就毙队友"', () => {
    const leadCards = [c(Suit.Spades, 9), c(Suit.Spades, 9)];
    const hand = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 3)];
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
      trickPlays: [{ cards: leadCards }], bestSoFar: { cards: leadCards, playerIndex: 0 },
    });
    const r = aiFollowPlay(hand, leadCards, Suit.Spades, ctx);
    expect(compareTwo(leadCards, r.cards, leadCards, CFG)).toBe('first');
    expect(r.cards.map(x => `${x.suit}${x.rank}`)).toEqual(['H13', 'H3']);
  });

  it('跟牌（一对领出）：第二家已毙 → 恢复原规则（不再受清对约束）', () => {
    const leadCards = [c(Suit.Spades, 9), c(Suit.Spades, 9)];
    const ruff = [c(Suit.Hearts, 2), c(Suit.Hearts, 2)];
    const hand = [c(Suit.Hearts, 10), c(Suit.Hearts, 10), c(Suit.Hearts, 13), c(Suit.Hearts, 3)];
    const ctx = ctxOf({
      myIndex: 2, playCount: 2, leadPlayerIndex: 0, history: [evidenceTrick(0, Suit.Spades)],
      trickPlays: [{ cards: leadCards }, { cards: ruff }], bestSoFar: { cards: ruff, playerIndex: 1 },
    });
    const r = aiFollowPlay(hand, leadCards, Suit.Spades, ctx);
    expect(r.cards.map(x => `${x.suit}${x.rank}`)).toEqual(['H3', 'H13']);
  });

  it('ensureContext 兼容路径（裸 TrumpDeclaration）不抛错且不触发清对', () => {
    const hand = [c(Suit.Spades, 8), c(Suit.Spades, 8), c(Suit.Spades, 6), c(Suit.Spades, 6)];
    const r = aiLeadPlay(hand, { trumpSuit: Suit.Hearts, level: Rank.Two, declarerIndex: 0 });
    expect(r.reason).not.toContain('对子已绝');
  });
});
