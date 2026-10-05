/**
 * NT trump tracking - count-based tracking of 12 constant trump cards.
 *
 * Tracks maximum possible counts per (suitRank, location) instead of
 * individual virtual copy IDs. This avoids the pair-deduction / card-removal
 * divergence bug.
 */
import type { Card, Trick, Reveal, CardSuit } from '../types.js';
import { createCard, isTrump, getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors, classify } from '../pattern/index.js';
import { matchPattern } from '../comparing/index.js';
import type { TrumpDeclaration } from '../types.js';
import type { NTTrumpState } from './types.js';

// ---- Constants ----

function trumpSuitRankKeys(level: number): string[] {
  return ['J-16', 'J-15', `S-${level}`, `H-${level}`, `C-${level}`, `D-${level}`];
}

function ntCfg(level: number): TrumpDeclaration {
  return { trumpSuit: null, level, declarerIndex: -1 };
}

// ---- Helpers ----

function suitRankKey(cardIdStr: string): string {
  const idx = cardIdStr.lastIndexOf('-');
  return cardIdStr.slice(0, idx);
}

function isJokerKey(key: string): boolean {
  return key.startsWith('J-');
}

function isBigJokerKey(key: string): boolean {
  return key === 'J-16';
}

function isSmallJokerKey(key: string): boolean {
  return key === 'J-15';
}

function countBySuitRank(cards: Card[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) {
    const key = suitRankKey(c.id);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

function reconstructFromKey(key: string, id = 0): Card {
  const dashIdx = key.indexOf('-');
  // key 由 suitRankKey 生成，花色段必然是 'S'|'H'|'C'|'D'|'J' 之一
  const suit = key.slice(0, dashIdx) as CardSuit;
  const rank = parseInt(key.slice(dashIdx + 1), 10);
  return createCard(suit, rank, id);
}

// ---- Tracking state ----

type MutableCounts = [number, number, number, number, number];

interface TrackingState {
  counts: Map<string, MutableCounts>;
  /** Number of copies NOT definitively assigned per suitRank. */
  totalUnseen: Map<string, number>;
}

function initTracking(
  level: number, myIndex: number,
  myTrumpCards: Card[], isDeclarer: boolean, bottomCards: readonly Card[],
): TrackingState {
  const keys = trumpSuitRankKeys(level);
  const cfg = ntCfg(level);
  const myByKey = countBySuitRank(myTrumpCards);
  const bottomByKey = isDeclarer
    ? countBySuitRank(bottomCards.filter(c => isTrump(c, cfg)))
    : new Map<string, number>();

  const counts = new Map<string, MutableCounts>();
  const totalUnseen = new Map<string, number>();

  for (const key of keys) {
    const myCount = myByKey.get(key) || 0;
    const bottomCount = bottomByKey.get(key) || 0;
    const unseen = Math.max(0, 2 - myCount - bottomCount);

    const arr: MutableCounts = [0, 0, 0, 0, 0];
    for (let p = 0; p < 4; p++) {
      if (p !== myIndex) arr[p] = unseen;
    }
    if (!isDeclarer) arr[4] = unseen;

    counts.set(key, arr);
    totalUnseen.set(key, unseen);
  }

  return { counts, totalUnseen };
}

// ---- Reveal handling ----

function revealInfo(reveal: Reveal, level: number): [string, number] | null {
  if (reveal.suit === null) {
    if (reveal.strength >= 4) return ['J-16', 2];
    if (reveal.strength >= 3) return ['J-15', 2];
    return null;
  }
  const key = `${reveal.suit}-${level}`;
  if (reveal.strength >= 2) return [key, 2];
  if (reveal.strength >= 1) return [key, 1];
  return null;
}

function applyReveals(
  ts: TrackingState,
  reveals: readonly Reveal[],
  level: number,
  myIndex: number,
  declarerIndex: number,
  isDeclarer: boolean,
  knownTrumpsPerPlayer: Card[][],
): void {
  const { counts, totalUnseen } = ts;
  for (const reveal of reveals) {
    const info = revealInfo(reveal, level);
    if (!info) continue;
    const [key, n] = info;
    const pid = reveal.playerIndex;

    if (pid === myIndex) {
      // Record self-revealed cards as definitively mine, but avoid
      // double-counting with my actual hand cards (production).
      const alreadyKnown = knownTrumpsPerPlayer[pid]
        .filter(c => suitRankKey(c.id) === key).length;
      const needed = Math.max(0, n - alreadyKnown);
      for (let i = 0; i < needed; i++) {
        knownTrumpsPerPlayer[pid].push(reconstructFromKey(key));
      }
      // Self-revealed copies are already excluded from totalUnseen and the
      // bottom count via myCount in initTracking — only subtract the part
      // NOT already known, or the other copy vanishes from every location.
      if (!isDeclarer) {
        const arr = counts.get(key);
        if (arr) arr[4] = Math.max(0, arr[4] - needed);
      }
      totalUnseen.set(key, Math.max(0, (totalUnseen.get(key) ?? 0) - needed));
      continue;
    }

    const revealerIsDeclarer = pid === declarerIndex;

    if (!revealerIsDeclarer) {
      for (let i = 0; i < n; i++) {
        knownTrumpsPerPlayer[pid].push(reconstructFromKey(key));
      }
      totalUnseen.set(key, Math.max(0, (totalUnseen.get(key) ?? 0) - n));
      const arr = counts.get(key);
      if (!arr) continue;
      const newUnseen = totalUnseen.get(key) ?? 0;
      for (let i = 0; i < 5; i++) {
        if (i === pid) continue;
        arr[i] = Math.min(arr[i], newUnseen);
      }
    } else {
      const arr = counts.get(key);
      if (!arr) continue;
      const otherUnseen = arr.find((_, i) =>
        i !== pid && i !== 4 && i !== myIndex) ?? 0;
      const newOtherMax = Math.max(0, otherUnseen - n);
      for (let i = 0; i < 5; i++) {
        if (i === pid || i === 4) continue;
        if (i === myIndex) continue;
        arr[i] = Math.min(arr[i], newOtherMax);
      }
    }
  }
}

// ---- Helpers ----

function capCountsAtZero(counts: Map<string, MutableCounts>): void {
  for (const arr of counts.values()) {
    for (let i = 0; i < 5; i++) {
      if (arr[i] < 0) arr[i] = 0;
    }
  }
}

function totalPossible(counts: Map<string, MutableCounts>, location: number): number {
  let sum = 0;
  for (const arr of counts.values()) sum += arr[location];
  return sum;
}

// ---- Main tracking function ----

export function computeNTTrumpState(
  myHand: Card[],
  myIndex: number,
  trickHistory: readonly Trick[],
  _reveals: readonly Reveal[],
  config: TrumpDeclaration,
  isDeclarer: boolean,
  bottomCards: readonly Card[],
  currentTrickPlays?: readonly { cards: Card[] }[],
  currentLeadPlayerIndex?: number,
): NTTrumpState {
  const level = config.level;
  const declarerIndex = config.declarerIndex;
  const cfg = ntCfg(level);
  const myTrumpCards = myHand.filter(c => isTrump(c, cfg));

  // ---- Phase 1: Init ----
  const ts = initTracking(level, myIndex, myTrumpCards, isDeclarer, bottomCards);
  const { counts, totalUnseen } = ts;

  // ---- Phase 1.5: Reveals ----
  const knownTrumpsPerPlayer: Card[][] = [[], [], [], []];
  knownTrumpsPerPlayer[myIndex] = [...myTrumpCards];
  applyReveals(ts, _reveals, level, myIndex, declarerIndex, isDeclarer, knownTrumpsPerPlayer);

  // ---- Phase 2: Plays ----
  const allPlays: { plays: Card[][]; leadPlayerIndex: number }[] = [];
  for (const trick of trickHistory) {
    allPlays.push({ plays: trick.plays.map(p => p.cards), leadPlayerIndex: trick.leadPlayerIndex });
  }
  if (currentTrickPlays && currentTrickPlays.length > 0 && currentLeadPlayerIndex !== undefined) {
    allPlays.push({ plays: currentTrickPlays.map(p => p.cards), leadPlayerIndex: currentLeadPlayerIndex });
  }

  for (const entry of allPlays) {
    const leadCards = entry.plays[0];
    const isTrumpLead = leadCards.every(c => isTrump(c, cfg));
    const leadLen = leadCards.length;
    let leadHasPairOrTractor = false;
    if (isTrumpLead) {
      // 判据是"领出里有没有对子"（拖拉机必含对，一并覆盖）——只有含对的领出
      // 才强制跟牌者出对，跟牌者没出对才推得出"他没有对子"。不能只看
      // type ≠ single：throw 含对的（甩 ♥2♥2+大王）与纯单张的（甩大王+小王）
      // 信息量不同，只有前者强制出对。
      leadHasPairOrTractor = findAllPairs(leadCards).length > 0;
    }

    for (let pi = 0; pi < entry.plays.length; pi++) {
      const actualPlayer = (entry.leadPlayerIndex + pi) % 4;
      const played = entry.plays[pi];
      const playedTrumps = played.filter(c => isTrump(c, cfg));

      if (playedTrumps.length > 0) {
        const playedByKey = countBySuitRank(playedTrumps);

        // ---- Pair deduction (before card removal) ----
        if (leadHasPairOrTractor && actualPlayer !== myIndex && pi > 0) {
          const playedPairs = findAllPairs(played);
          if (playedPairs.length === 0) {
            // count=2 → 1; count=1 + played → 0 (would have been a pair)
            // Bottom (index 4) is NOT affected (actualPlayer is 0-3).
            for (const [key, arr] of counts) {
              const cnt = arr[actualPlayer];
              if (cnt >= 2) {
                arr[actualPlayer] = 1;
              } else if (cnt === 1 && (playedByKey.get(key) || 0) > 0) {
                arr[actualPlayer] = 0;
              }
            }
          }
        }

        // ---- Card removal ----
        const isCurrentTrick = entry === allPlays[allPlays.length - 1]
          && currentTrickPlays && currentTrickPlays.length > 0;
        if (!isCurrentTrick || actualPlayer !== myIndex) {
          const knownList = knownTrumpsPerPlayer[actualPlayer];
          for (const [key, playedCount] of playedByKey) {
            const arr = counts.get(key);
            if (arr) {
              arr[actualPlayer] = Math.max(0, arr[actualPlayer] - playedCount);
            }
            // Decrement totalUnseen. Cards definitively known to be at
            // this player (from hand and reveals) absorb the play first.
            const definitiveCount = knownList
              .filter(c => suitRankKey(c.id) === key).length;
            const reduced = Math.max(0, playedCount - definitiveCount);
            if (reduced > 0) {
              totalUnseen.set(key, Math.max(0, (totalUnseen.get(key) ?? 0) - reduced));
            }
            // Played cards leave the known set — otherwise played reveal
            // cards (re-added by applyReveals) would linger as ghosts in
            // knownTrumpsPerPlayer. For self, hand cards refresh naturally
            // on every call (myTrumpCards), so only the ghost re-additions
            // beyond the copies still held in hand are removed.
            const keptCount = actualPlayer === myIndex
              ? Math.min(definitiveCount,
                myTrumpCards.filter(c => suitRankKey(c.id) === key).length)
              : 0;
            let toRemove = Math.max(0, playedCount - keptCount);
            for (let i = knownList.length - 1; i >= 0 && toRemove > 0; i--) {
              if (suitRankKey(knownList[i].id) === key) {
                knownList.splice(i, 1);
                toRemove--;
              }
            }
          }
        }

        // ---- Void-after-play ----
        if (isTrumpLead && actualPlayer !== myIndex
          && pi > 0 && playedTrumps.length < leadLen) {
          for (const arr of counts.values()) arr[actualPlayer] = 0;
        }
      } else if (isTrumpLead && pi > 0) {
        for (const arr of counts.values()) arr[actualPlayer] = 0;
      }
    }
  }

  capCountsAtZero(counts);
  for (const [key, n] of totalUnseen) {
    if (n < 0) totalUnseen.set(key, 0);
  }
  // Cap per-location counts at totalUnseen
  for (const [key, arr] of counts) {
    const max = totalUnseen.get(key) ?? 0;
    for (let i = 0; i < 5; i++) {
      if (arr[i] > max) arr[i] = max;
    }
  }

  // ---- Phase 3: Build state ----
  return buildState(counts, totalUnseen, level, myIndex, isDeclarer,
    knownTrumpsPerPlayer, config);
}

// ---- State builder ----

function buildState(
  counts: Map<string, MutableCounts>,
  totalUnseen: Map<string, number>,
  level: number,
  myIndex: number,
  isDeclarer: boolean,
  knownTrumpsPerPlayer: Card[][],
  config: TrumpDeclaration,
): NTTrumpState {
  const keys = trumpSuitRankKeys(level);

  // ---- possibleTrumps ----
  const possibleTrumps: (Record<string, number> | null)[] = [];
  for (let p = 0; p < 5; p++) {
    if (p === myIndex || (p === 4 && isDeclarer)) {
      possibleTrumps[p] = null;
    } else {
      const rec: Record<string, number> = {};
      for (const [key, arr] of counts) {
        if (arr[p] > 0) rec[key] = arr[p];
      }
      // Add definitive known copies (revealed). The cap in
      // computeNTTrumpState clamps counts to totalUnseen, so definitives
      // must be re-added even when totalUnseen is 0 (all copies placed —
      // e.g. viewer holds the other copy), or the revealer's card vanishes.
      // Known cards belong to the player regardless of whether they still
      // have unseen copies: an empty unseen pool means the unknown sources
      // are gone, not that the player's revealed cards are.
      if (p >= 0 && p <= 3) {
        for (const c of knownTrumpsPerPlayer[p]) {
          const key = suitRankKey(c.id);
          rec[key] = (rec[key] || 0) + 1;
        }
      }
      possibleTrumps[p] = rec;
    }
  }

  // ---- isFullyDetermined ----
  const isFullyDetermined = [...counts.values()].every(arr => {
    for (let i = 0; i < 5; i++) {
      if (i === myIndex) continue;
      if (i === 4 && isDeclarer) continue;
      if (arr[i] > 0) return false;
    }
    return true;
  });

  // ---- Derived arrays ----
  const canFormPair: boolean[] = [false, false, false, false];
  const canHaveJoker: boolean[] = [false, false, false, false];
  const canHaveBigJoker: boolean[] = [false, false, false, false];
  const canHaveSmallJoker: boolean[] = [false, false, false, false];
  for (let p = 0; p < 4; p++) {
    const rec = possibleTrumps[p];
    if (!rec) continue;
    canFormPair[p] = Object.values(rec).some(n => n >= 2);
    for (const key of Object.keys(rec)) {
      if (isJokerKey(key)) {
        canHaveJoker[p] = true;
        if (isBigJokerKey(key)) canHaveBigJoker[p] = true;
        if (isSmallJokerKey(key)) canHaveSmallJoker[p] = true;
      }
    }
  }

  // ---- minTrumpCounts / maxTrumpCounts ----
  // A player's trump count is their definitively known cards plus the upper
  // bound on unseen copies. The known part must not be dropped when the
  // player has no unseen copies left (totalPossible === 0): that only means
  // no unknown source remains, not that they hold nothing.
  const minTrumpCounts: [number, number, number, number] = [
    knownTrumpsPerPlayer[0].length,
    knownTrumpsPerPlayer[1].length,
    knownTrumpsPerPlayer[2].length,
    knownTrumpsPerPlayer[3].length,
  ];
  const maxTrumpCounts: [number, number, number, number] = [
    knownTrumpsPerPlayer[0].length + totalPossible(counts, 0),
    knownTrumpsPerPlayer[1].length + totalPossible(counts, 1),
    knownTrumpsPerPlayer[2].length + totalPossible(counts, 2),
    knownTrumpsPerPlayer[3].length + totalPossible(counts, 3),
  ];

  // ---- playersWithNoTrump ----
  const playersWithNoTrump = new Set<number>();
  for (let p = 0; p < 4; p++) {
    if (maxTrumpCounts[p] === 0) playersWithNoTrump.add(p);
  }

  // ---- opponentTrumpCount ----
  const myTeamParity = myIndex % 2;
  let opponentTrumpCount = 0;
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myTeamParity) opponentTrumpCount += minTrumpCounts[p];
  }
  for (const key of keys) {
    const arr = counts.get(key)!;
    // Only count ambiguous suits (more than 1 non-zero location)
    let nonZeroCount = 0;
    for (let i = 0; i < 5; i++) {
      if (i === myIndex) continue;
      if (i === 4 && isDeclarer) continue;
      if (arr[i] > 0) nonZeroCount++;
    }
    if (nonZeroCount <= 1) continue;
    let allOpponent = true;
    for (let p = 0; p < 4; p++) {
      if (arr[p] > 0 && p % 2 === myTeamParity) { allOpponent = false; break; }
    }
    if (arr[4] > 0 && config.declarerIndex % 2 === myTeamParity) allOpponent = false;
    if (allOpponent) opponentTrumpCount += (totalUnseen.get(key) ?? 0);
  }

  // ---- Remaining jokers ----
  const remainingBigJokers = totalUnseen.get('J-16') ?? 0;
  const remainingSmallJokers = totalUnseen.get('J-15') ?? 0;

  // ---- allUnseenJokersOnOurSide ----
  const isOurSideLoc = (l: number): boolean =>
    l === myIndex || l === (myIndex + 2) % 4 ||
    (l === 4 && config.declarerIndex % 2 === myTeamParity);

  let allUnseenJokersOnOurSide = true;
  let allUnseenBigJokersOnOurSide = true;
  for (const [key, arr] of counts) {
    if (isJokerKey(key)) {
      for (let p = 0; p < 5; p++) {
        if (arr[p] > 0 && !isOurSideLoc(p)) {
          allUnseenJokersOnOurSide = false;
          if (isBigJokerKey(key)) allUnseenBigJokersOnOurSide = false;
          break;
        }
      }
    }
  }

  return {
    knownTrumpsPerPlayer: knownTrumpsPerPlayer as readonly (readonly Card[])[],
    playersWithNoTrump,
    totalTrumps: 12,
    opponentTrumpCount,
    remainingBigJokers,
    remainingSmallJokers,
    allUnseenJokersOnOurSide,
    allUnseenBigJokersOnOurSide,
    possibleTrumps: possibleTrumps as readonly (Readonly<Record<string, number>> | null)[],
    isFullyDetermined,
    canFormPair,
    canHaveJoker,
    canHaveBigJoker,
    canHaveSmallJoker,
    minTrumpCounts,
    maxTrumpCounts,
  };
}

// ---- Inference helpers ----

export function canPlayerBeatSingle(
  playerIndex: number, targetCard: Card,
  state: NTTrumpState, config: TrumpDeclaration,
): boolean {
  const targetRank = getEffectiveRank(targetCard, config);
  const rec = state.possibleTrumps[playerIndex];
  if (!rec) return false;
  return Object.keys(rec).some(key => {
    const card = reconstructFromKey(key);
    return getEffectiveRank(card, config) > targetRank;
  });
}

export function canPlayerBeatPair(
  playerIndex: number, targetPair: Card[],
  state: NTTrumpState, config: TrumpDeclaration,
): boolean {
  if (!state.canFormPair[playerIndex]) return false;
  if (targetPair.length < 2) return false;
  const targetRank = getEffectiveRank(targetPair[0], config);
  const rec = state.possibleTrumps[playerIndex];
  if (!rec) return false;
  for (const [key, count] of Object.entries(rec)) {
    if (count >= 2) {
      const card = reconstructFromKey(key);
      if (getEffectiveRank(card, config) > targetRank) return true;
    }
  }
  return false;
}

export function canAnyOpponentBeatSingle(
  card: Card, state: NTTrumpState, myIndex: number, config: TrumpDeclaration,
): boolean {
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myIndex % 2 && canPlayerBeatSingle(p, card, state, config)) return true;
  }
  return false;
}

export function canAnyOpponentBeatPair(
  pair: Card[], state: NTTrumpState, myIndex: number, config: TrumpDeclaration,
): boolean {
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myIndex % 2 && canPlayerBeatPair(p, pair, state, config)) return true;
  }
  return false;
}

export function canFormJokerPair(playerIndex: number, state: NTTrumpState): boolean {
  const rec = state.possibleTrumps[playerIndex];
  if (!rec) return false;
  return (rec['J-16'] ?? 0) >= 2 || (rec['J-15'] ?? 0) >= 2;
}

/**
 * 某玩家是否可能用主牌毙掉这手**副牌**领出（单张/对/拖拉机/甩牌）。
 *
 * 无主局里主牌只有级牌与王，任何一张主牌都大于副牌——盖过与否只取决于**牌型**能否
 * 匹配，不比大小。做法：把 `possibleTrumps[playerIndex]`（该玩家可能持牌的上界，
 * 每个 key 至多 2 张）摊成一手"最大可能主牌"，再按领出牌型判这手牌**是否覆盖**领出
 * 牌型——甩牌直接用 `matchPattern`（它对甩牌本就是"跟牌覆盖领出"的判据：跟牌须全主，
 * 拖拉机数/长度不少于领出、对数经 extraPairs 折算后不少于领出），其他牌型按牌型取值
 * （更长的拖拉机可截短）。
 *
 * 保守方向：**证不出"凑不出"就返回 true**（宁可照常毙，也不误判"毙不了"而漏毙）。
 * 返回 false 表示可以断定该玩家毙不了这手牌。
 *
 * 前提：领出必须是副牌。主牌领出的盖过还要比大小，不在本函数范围（调用点见
 * `followOffSuitThrow` 的缺门分支，只对 `leadCombo.type === 'throw'` 的副牌甩牌调用）。
 */
export function canPlayerTrumpThrow(
  playerIndex: number,
  leadCards: Card[],
  state: NTTrumpState,
  config: TrumpDeclaration,
): boolean {
  const rec = state.possibleTrumps[playerIndex];
  if (!rec) return false;
  const leadLen = leadCards.length;
  if (leadLen === 0) return false;
  if (state.maxTrumpCounts[playerIndex] < leadLen) return false;

  const hand: Card[] = [];
  for (const [key, n] of Object.entries(rec)) {
    for (let i = 0; i < Math.min(n, 2); i++) hand.push(reconstructFromKey(key, hand.length));
  }
  if (hand.length < leadLen) return false;

  const combo = classify(leadCards, config);
  if (combo.type === 'throw') return matchPattern(leadCards, hand, config);
  if (combo.type === 'single') return true; // 手上有主牌就盖得过单张副牌
  if (combo.type === 'pair') return findAllPairs(hand).length > 0;
  // tractor：要一副同长的主牌拖拉机（更长的可截短到领出长度）
  const need = combo.length / 2;
  return detectTractors(hand, config).some(t => t.length / 2 >= need);
}

export function opponentsHaveTrump(state: NTTrumpState, myIndex: number): boolean {
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myIndex % 2 && state.maxTrumpCounts[p] > 0) return true;
  }
  return false;
}
