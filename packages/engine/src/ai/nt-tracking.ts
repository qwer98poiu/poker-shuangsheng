/**
 * NT trump tracking - tracks the 12 constant trump cards in NT mode.
 *
 * In NT mode there are exactly 12 constant trump cards:
 * 2 BigJokers, 2 SmallJokers, and 2 level cards per suit (S/H/C/D) x 2 decks.
 *
 * Uses only public information (trick history, reveals) and private information
 * (own hand, bottom cards if declarer). Does NOT peek at other players' hands.
 */
import type { Card, Trick, Reveal } from '../types.js';
import { Rank, SpecialSuit, Suit, cardId } from '../types.js';
import { createCard, isTrump, getEffectiveRank } from '../model.js';
import { classify } from '../pattern/index.js';
import { findAllPairs } from '../pattern/index.js';
import type { TrumpDeclaration } from '../types.js';
import type { NTTrumpState } from './types.js';

// ---- Card ID helpers ----

/** Enumerate all 12 NT trump card IDs. */
function enumerateNTTrumpIds(level: number): string[] {
  const ids: string[] = [];
  ids.push(cardId(SpecialSuit.Joker, Rank.BigJoker, 0));
  ids.push(cardId(SpecialSuit.Joker, Rank.BigJoker, 1));
  ids.push(cardId(SpecialSuit.Joker, Rank.SmallJoker, 0));
  ids.push(cardId(SpecialSuit.Joker, Rank.SmallJoker, 1));
  for (const suit of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
    ids.push(cardId(suit, level, 0));
    ids.push(cardId(suit, level, 1));
  }
  return ids;
}

/** Extract suit-rank key from a card ID, e.g. "S-2-0" → "S-2". */
function suitRankKey(cardIdStr: string): string {
  const idx = cardIdStr.lastIndexOf('-');
  return cardIdStr.slice(0, idx);
}

/** Count trump cards by suit-rank key. */
function countBySuitRank(cards: Card[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) {
    const key = suitRankKey(c.id);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

function isJokerId(cardIdStr: string): boolean {
  return cardIdStr.startsWith('J-');
}

function isBigJokerId(cardIdStr: string): boolean {
  return cardIdStr.startsWith('J-16');
}

function isSmallJokerId(cardIdStr: string): boolean {
  return cardIdStr.startsWith('J-15');
}

/** Reconstruct a Card from a card ID string. */
function reconstructCard(cardIdStr: string): Card {
  const parts = cardIdStr.split('-');
  return createCard(parts[0] as any, parseInt(parts[1]) as Rank, parseInt(parts[2]));
}

/**
 * Apply no-pair deduction: for each (suit,rank) combo where a player could
 * have ≥2 cards, remove one possible card (they can't form that pair).
 * Does NOT apply to bottom (location 4).
 */
function applyNoPairDeduction(
  playerIndex: number,
  possibleLocations: Map<string, Set<number>>,
): void {
  const byKey = new Map<string, string[]>();
  for (const [cid, locs] of possibleLocations) {
    if (locs.has(playerIndex)) {
      const key = suitRankKey(cid);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(cid);
    }
  }
  for (const cids of byKey.values()) {
    if (cids.length >= 2) {
      // Remove this player from one of the two copies (they can have at most 1)
      possibleLocations.get(cids[cids.length - 1])!.delete(playerIndex);
    }
  }
}

// ---- Main tracking function ----

/**
 * Compute NT trump tracking state.
 * Determines where each unseen trump card could possibly be, based on
 * played cards, void deductions, and pair-failure deductions.
 */
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
  const allTrumpIds = enumerateNTTrumpIds(level);

  const myTrumpCards = myHand.filter(c => isTrump(c, config));
  const otherPlayers = [0, 1, 2, 3].filter(p => p !== myIndex);

  // ---- Phase 1: Initialize possible locations for UNSEEN trump cards ----
  // possibleLocations: virtualCopyKey -> Set of location indices (0-3=players, 4=bottom)
  // Virtual copy keys (J-16-0, S-2-1) are tracking labels, NOT actual card IDs.
  // Actual card IDs differ (deck uses sequential indices), so we match by suitRank.
  //
  // Each suit-rank has 2 copies total. Unseen = 2 - myHandCount - bottomCount.
  // Two-pass removal: exact ID match first, then any remaining copies by key.

  // Build known count by suit-rank key (from my hand and bottom)
  const knownByKey = countBySuitRank(myTrumpCards);
  if (isDeclarer) {
    for (const c of bottomCards.filter(c => isTrump(c, config))) {
      const key = suitRankKey(c.id);
      knownByKey.set(key, (knownByKey.get(key) || 0) + 1);
    }
  }

  // Group virtual copy IDs by suit-rank key
  const virtualCopies = new Map<string, string[]>();
  for (const id of allTrumpIds) {
    const key = suitRankKey(id);
    if (!virtualCopies.has(key)) virtualCopies.set(key, []);
    virtualCopies.get(key)!.push(id);
  }

  // Remove known copies: prefer exact ID match, then any remaining
  const removedIds = new Set<string>();

  // Collect all known cards for exact ID matching
  const allKnown = [...myTrumpCards];
  if (isDeclarer) allKnown.push(...bottomCards.filter(c => isTrump(c, config)));

  for (const c of allKnown) {
    const vc = virtualCopies.get(suitRankKey(c.id));
    if (vc && vc.includes(c.id)) {
      // Exact ID match between actual card and virtual copy
      if (!removedIds.has(c.id)) {
        removedIds.add(c.id);
        const key = suitRankKey(c.id);
        knownByKey.set(key, (knownByKey.get(key) || 1) - 1);
      }
    }
  }

  // Remove remaining known copies (any virtual copy for each key)
  for (const [key, remaining] of knownByKey) {
    const vc = virtualCopies.get(key);
    if (!vc) continue;
    let toRemove = remaining;
    for (const id of vc) {
      if (toRemove <= 0) break;
      if (!removedIds.has(id)) {
        removedIds.add(id);
        toRemove--;
      }
    }
  }

  const possibleLocations = new Map<string, Set<number>>();
  for (const [key, vc] of virtualCopies) {
    for (const id of vc) {
      if (removedIds.has(id)) continue;
      const locs = new Set<number>();
      for (const p of otherPlayers) locs.add(p);
      if (!isDeclarer) locs.add(4); // bottom is possible for non-declarer
      possibleLocations.set(id, locs);
    }
  }

  // ---- Phase 1.5: Process reveals (public info about who revealed what) ----
  // Reveals tell us which player definitely holds (or held) which trump cards.
  // The LAST revealer is the declarer (config.declarerIndex); their revealed
  // cards could be in hand or in the bottom.
  for (const reveal of _reveals) {
    const pid = reveal.playerIndex;
    const revealerIsDeclarer = pid === config.declarerIndex;

    if (reveal.suit === null) {
      // Joker reveal (NT declaration): strength 3=SmallJoker pair, 4=BigJoker pair
      if (reveal.strength >= 3) {
        const jokerRank = reveal.strength >= 4 ? Rank.BigJoker : Rank.SmallJoker;
        const id0 = cardId(SpecialSuit.Joker, jokerRank, 0);
        const id1 = cardId(SpecialSuit.Joker, jokerRank, 1);
        if (pid === myIndex) {
          // Cards in my hand — remove bottom from possible set
          if (!isDeclarer) {
            possibleLocations.get(id0)?.delete(4);
            possibleLocations.get(id1)?.delete(4);
          }
        } else if (revealerIsDeclarer) {
          // Revealer is declarer: cards at pid or bottom
          if (possibleLocations.has(id0)) possibleLocations.set(id0, new Set([pid, 4]));
          if (possibleLocations.has(id1)) possibleLocations.set(id1, new Set([pid, 4]));
        } else {
          // Revealer is NOT declarer: cards definitively at pid
          if (possibleLocations.has(id0)) possibleLocations.set(id0, new Set([pid]));
          if (possibleLocations.has(id1)) possibleLocations.set(id1, new Set([pid]));
        }
      }
    } else {
      // Level card reveal: strength 2=pair, strength 1=single
      if (reveal.strength >= 2) {
        // Pair reveal — both copies are at revealer
        const id0 = cardId(reveal.suit as any, level, 0);
        const id1 = cardId(reveal.suit as any, level, 1);
        if (pid === myIndex) {
          if (!isDeclarer) {
            possibleLocations.get(id0)?.delete(4);
            possibleLocations.get(id1)?.delete(4);
          }
        } else if (revealerIsDeclarer) {
          if (possibleLocations.has(id0)) possibleLocations.set(id0, new Set([pid, 4]));
          if (possibleLocations.has(id1)) possibleLocations.set(id1, new Set([pid, 4]));
        } else {
          if (possibleLocations.has(id0)) possibleLocations.set(id0, new Set([pid]));
          if (possibleLocations.has(id1)) possibleLocations.set(id1, new Set([pid]));
        }
      } else {
        // Single reveal (strength 1) — one copy at revealer
        const id0 = cardId(reveal.suit as any, level, 0);
        if (pid === myIndex) {
          if (!isDeclarer) {
            possibleLocations.get(id0)?.delete(4);
          }
        } else if (revealerIsDeclarer) {
          if (possibleLocations.has(id0)) possibleLocations.set(id0, new Set([pid, 4]));
        } else {
          if (possibleLocations.has(id0)) possibleLocations.set(id0, new Set([pid]));
        }
      }
    }
  }

  // ---- Phase 2: Process all known plays (completed tricks + current) ----
  // Merge trickHistory and currentTrickPlays into a uniform list.
  const allPlays: { plays: Card[][]; leadPlayerIndex: number }[] = [];

  for (const trick of trickHistory) {
    allPlays.push({
      plays: trick.plays.map(p => p.cards),
      leadPlayerIndex: trick.leadPlayerIndex,
    });
  }
  if (currentTrickPlays && currentTrickPlays.length > 0 && currentLeadPlayerIndex !== undefined) {
    allPlays.push({
      plays: currentTrickPlays.map(p => p.cards),
      leadPlayerIndex: currentLeadPlayerIndex,
    });
  }

  for (const entry of allPlays) {
    const leadCards = entry.plays[0];
    const isTrumpLead = leadCards.every(c => isTrump(c, config));
    const leadLen = leadCards.length;
    let leadHasPairOrTractor = false;

    if (isTrumpLead) {
      const leadCombo = classify(leadCards, config);
      leadHasPairOrTractor = leadCombo.pairCount > 0 || leadCombo.hasTractor;
    }

    for (let pi = 0; pi < entry.plays.length; pi++) {
      const actualPlayer = (entry.leadPlayerIndex + pi) % 4;
      const played = entry.plays[pi];
      const playedTrumpIds = played
        .filter(c => isTrump(c, config))
        .map(c => c.id);

      if (playedTrumpIds.length > 0) {
        // Played trump cards are no longer in any hand — remove from tracking.
        // Two-pass removal: exact ID match first, then any copy by suitRank key.
        const playedTrumps = played.filter(c => isTrump(c, config));
        const playedByKey = countBySuitRank(playedTrumps);

        // Pass 1: exact ID match
        for (const c of playedTrumps) {
          if (possibleLocations.has(c.id)) {
            possibleLocations.delete(c.id);
            const key = suitRankKey(c.id);
            playedByKey.set(key, (playedByKey.get(key) || 1) - 1);
          }
        }

        // Pass 2: remove remaining by suitRank key
        for (const [key, remaining] of playedByKey) {
          for (let r = 0; r < remaining; r++) {
            for (const copyKey of possibleLocations.keys()) {
              if (suitRankKey(copyKey) === key) {
                possibleLocations.delete(copyKey);
                break;
              }
            }
          }
        }

        // Pair deduction: if trump lead with pairs/tractors and player
        // didn't follow with any trump pair (but played trump), they can't form pairs.
        // Does NOT apply to self (we know our own hand).
        if (leadHasPairOrTractor && actualPlayer !== myIndex && pi > 0) {
          const playedPairs = findAllPairs(played);
          if (playedPairs.length === 0) {
            applyNoPairDeduction(actualPlayer, possibleLocations);
          }
        }

        // Void-after-play deduction: if player followed a multi-card trump
        // lead with fewer trumps than required (M < N), they had exactly M
        // trump cards and are now void.
        if (isTrumpLead && actualPlayer !== myIndex
          && pi > 0 && playedTrumpIds.length < leadLen) {
          for (const locs of possibleLocations.values()) {
            locs.delete(actualPlayer);
          }
        }
      } else if (isTrumpLead && pi > 0) {
        // Player discarded entirely against a trump lead → void in trump.
        // Clear this player from all possible locations.
        for (const locs of possibleLocations.values()) {
          locs.delete(actualPlayer);
        }
      }
    }
  }

  // ---- Phase 3: Build derived state from possibleLocations ----
  return buildState(possibleLocations, allTrumpIds, myTrumpCards,
    myIndex, isDeclarer, config);
}

// ---- State builder ----

function buildState(
  possibleLocations: Map<string, Set<number>>,
  allTrumpIds: string[],
  myTrumpCards: Card[],
  myIndex: number,
  isDeclarer: boolean,
  config: TrumpDeclaration,
): NTTrumpState {
  // ---- possibleTrumps ----
  const possibleTrumps: (string[] | null)[] = [];
  for (let p = 0; p < 4; p++) {
    possibleTrumps[p] = p === myIndex ? null : [];
  }
  possibleTrumps[4] = isDeclarer ? null : [];

  for (const [cardId, locs] of possibleLocations) {
    for (const loc of locs) {
      const arr = possibleTrumps[loc];
      if (arr) arr.push(cardId);
    }
  }

  // ---- knownTrumpsPerPlayer (deduced, not played) ----
  const knownTrumpsPerPlayer: Card[][] = [[], [], [], []];
  // My hand trumps
  knownTrumpsPerPlayer[myIndex] = [...myTrumpCards];

  // Cards definitively at a single player (from possibleLocations)
  for (const [cardId, locs] of possibleLocations) {
    if (locs.size === 1) {
      const loc = [...locs][0];
      if (loc >= 0 && loc <= 3) {
        knownTrumpsPerPlayer[loc].push(reconstructCard(cardId));
      }
    }
  }

  // ---- isFullyDetermined ----
  const isFullyDetermined = possibleLocations.size === 0 ||
    [...possibleLocations.values()].every(locs => locs.size === 1);

  // ---- canFormPair ----
  const canFormPair: boolean[] = [false, false, false, false];
  for (let p = 0; p < 4; p++) {
    const arr = possibleTrumps[p];
    if (!arr) continue;
    const byKey = new Map<string, number>();
    for (const id of arr) {
      const key = suitRankKey(id);
      byKey.set(key, (byKey.get(key) || 0) + 1);
    }
    canFormPair[p] = [...byKey.values()].some(n => n >= 2);
  }

  // ---- canHaveJoker / canHaveBigJoker / canHaveSmallJoker ----
  const canHaveJoker: boolean[] = [false, false, false, false];
  const canHaveBigJoker: boolean[] = [false, false, false, false];
  const canHaveSmallJoker: boolean[] = [false, false, false, false];
  for (let p = 0; p < 4; p++) {
    const arr = possibleTrumps[p];
    if (!arr) continue;
    for (const id of arr) {
      if (isJokerId(id)) {
        canHaveJoker[p] = true;
        if (isBigJokerId(id)) canHaveBigJoker[p] = true;
        if (isSmallJokerId(id)) canHaveSmallJoker[p] = true;
      }
    }
  }

  // ---- minTrumpCounts / maxTrumpCounts ----
  const minTrumpCounts: [number, number, number, number] = [
    knownTrumpsPerPlayer[0].length,
    knownTrumpsPerPlayer[1].length,
    knownTrumpsPerPlayer[2].length,
    knownTrumpsPerPlayer[3].length,
  ];
  const maxTrumpCounts: [number, number, number, number] = [
    knownTrumpsPerPlayer[0].length + (possibleTrumps[0]?.length ?? 0),
    knownTrumpsPerPlayer[1].length + (possibleTrumps[1]?.length ?? 0),
    knownTrumpsPerPlayer[2].length + (possibleTrumps[2]?.length ?? 0),
    knownTrumpsPerPlayer[3].length + (possibleTrumps[3]?.length ?? 0),
  ];

  // ---- playersWithNoTrump ----
  const playersWithNoTrump = new Set<number>();
  for (let p = 0; p < 4; p++) {
    if (maxTrumpCounts[p] === 0) playersWithNoTrump.add(p);
  }

  // ---- opponentTrumpCount (minimum opponent count) ----
  const myTeamParity = myIndex % 2;
  let opponentTrumpCount = 0;
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myTeamParity) {
      opponentTrumpCount += minTrumpCounts[p];
    }
  }
  // Cards ambiguous but all possible locations are opponents
  for (const [, locs] of possibleLocations) {
    if (locs.size > 1) {
      const allOpponents = [...locs].every(l => l <= 3 && (l % 2 !== myTeamParity));
      if (allOpponents) opponentTrumpCount++;
    }
  }

  // ---- Joker counts (only ambiguous) ----
  let remainingBigJokers = 0;
  let remainingSmallJokers = 0;
  for (const [id, locs] of possibleLocations) {
    if (locs.size <= 1) continue; // definitively assigned, not "remaining"
    if (isBigJokerId(id)) remainingBigJokers++;
    if (isSmallJokerId(id)) remainingSmallJokers++;
  }

  // Known jokers on my team (from hand + deduced)
  let myTeamBjCount = knownTrumpsPerPlayer[myIndex].filter(c => c.rank === Rank.BigJoker).length
    + knownTrumpsPerPlayer[(myIndex + 2) % 4].filter(c => c.rank === Rank.BigJoker).length;
  let myTeamSjCount = knownTrumpsPerPlayer[myIndex].filter(c => c.rank === Rank.SmallJoker).length
    + knownTrumpsPerPlayer[(myIndex + 2) % 4].filter(c => c.rank === Rank.SmallJoker).length;

  // Check if any joker is definitively at an opponent (from reveal or play)
  let anyJokerAtOpponent = false;
  for (const [id, locs] of possibleLocations) {
    if (!isJokerId(id)) continue;
    if (locs.size === 1) {
      const loc = [...locs][0];
      if (loc >= 0 && loc <= 3 && loc % 2 !== myTeamParity) {
        anyJokerAtOpponent = true;
        break;
      }
    }
  }

  // Helper: is a location on our side?
  // Bottom (4) is our side if declarer is our teammate.
  const declarerIsOurSide = config.declarerIndex % 2 === myTeamParity;
  const isOurSideLoc = (l: number): boolean =>
    l === myIndex || l === (myIndex + 2) % 4 ||
    (l === 4 && declarerIsOurSide);

  // Check if all ambiguous jokers can only be on our side
  let allUnseenJokersOnOurSide = !anyJokerAtOpponent;
  let allUnseenBigJokersOnOurSide = !anyJokerAtOpponent;

  // If no definitive opponents found, check ambiguous jokers
  if (allUnseenJokersOnOurSide) {
    for (const [id, locs] of possibleLocations) {
      if (isJokerId(id)) {
        const onlyOurSide = [...locs].every(isOurSideLoc);
        if (!onlyOurSide) {
          allUnseenJokersOnOurSide = false;
          break;
        }
      }
    }
  }

  if (allUnseenBigJokersOnOurSide) {
    for (const [id, locs] of possibleLocations) {
      if (isBigJokerId(id)) {
        const onlyOurSide = [...locs].every(isOurSideLoc);
        if (!onlyOurSide) {
          allUnseenBigJokersOnOurSide = false;
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
    possibleTrumps: possibleTrumps as readonly (readonly string[] | null)[],
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

/**
 * Can a specific player possibly beat this single trump card?
 */
export function canPlayerBeatSingle(
  playerIndex: number,
  targetCard: Card,
  state: NTTrumpState,
  config: TrumpDeclaration,
): boolean {
  const targetRank = getEffectiveRank(targetCard, config);
  const possible = state.possibleTrumps[playerIndex];
  if (!possible) return false;
  return possible.some(id => {
    const card = reconstructCard(id);
    return getEffectiveRank(card, config) > targetRank;
  });
}

/**
 * Can a specific player possibly beat this trump pair?
 */
export function canPlayerBeatPair(
  playerIndex: number,
  targetPair: Card[],
  state: NTTrumpState,
  config: TrumpDeclaration,
): boolean {
  if (!state.canFormPair[playerIndex]) return false;
  if (targetPair.length < 2) return false;

  const targetRank = getEffectiveRank(targetPair[0], config);
  const possible = state.possibleTrumps[playerIndex];
  if (!possible) return false;

  const byKey = new Map<string, string[]>();
  for (const id of possible) {
    const key = suitRankKey(id);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(id);
  }

  for (const cids of byKey.values()) {
    if (cids.length >= 2) {
      const card = reconstructCard(cids[0]);
      if (getEffectiveRank(card, config) > targetRank) return true;
    }
  }
  return false;
}

/**
 * Can any opponent possibly beat this single trump card?
 */
export function canAnyOpponentBeatSingle(
  card: Card,
  state: NTTrumpState,
  myIndex: number,
  config: TrumpDeclaration,
): boolean {
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myIndex % 2) {
      if (canPlayerBeatSingle(p, card, state, config)) return true;
    }
  }
  return false;
}

/**
 * Can any opponent possibly beat this trump pair?
 */
export function canAnyOpponentBeatPair(
  pair: Card[],
  state: NTTrumpState,
  myIndex: number,
  config: TrumpDeclaration,
): boolean {
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myIndex % 2) {
      if (canPlayerBeatPair(p, pair, state, config)) return true;
    }
  }
  return false;
}

/**
 * Can this player form a joker pair (Big or Small)?
 */
export function canFormJokerPair(
  playerIndex: number,
  state: NTTrumpState,
): boolean {
  const possible = state.possibleTrumps[playerIndex];
  if (!possible) return false;
  const bigCount = possible.filter(isBigJokerId).length;
  const smallCount = possible.filter(isSmallJokerId).length;
  return bigCount >= 2 || smallCount >= 2;
}

/**
 * Do opponents have any trump at all?
 */
export function opponentsHaveTrump(
  state: NTTrumpState,
  myIndex: number,
): boolean {
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myIndex % 2 && state.maxTrumpCounts[p] > 0) return true;
  }
  return false;
}
