/**
 * NT trump tracking - pure function that deduces trump distribution in NT mode.
 *
 * In NT mode there are exactly 12 constant trump cards:
 * 2 BigJokers, 2 SmallJokers, and 2 level cards per suit (S/H/C/D) x 2 decks.
 *
 * By tracking which trump cards have been played and which are in our own hand,
 * we can deduce who has the remaining trumps.
 */
import type { Card, Trick, Reveal } from '../types.js';
import { Rank, SpecialSuit, Suit, cardId } from '../types.js';
import { createCard, isTrump, getEffectiveRank } from '../model.js';
import type { TrumpDeclaration } from '../types.js';
import type { NTTrumpState } from './types.js';

/** Enumerate all 12 NT trump card IDs. */
function enumerateNTTrumpIds(level: number): string[] {
  const ids: string[] = [];
  // 2 copies of each joker
  ids.push(cardId(SpecialSuit.Joker, Rank.BigJoker, 0));
  ids.push(cardId(SpecialSuit.Joker, Rank.BigJoker, 1));
  ids.push(cardId(SpecialSuit.Joker, Rank.SmallJoker, 0));
  ids.push(cardId(SpecialSuit.Joker, Rank.SmallJoker, 1));
  // 2 copies of level card per suit
  for (const suit of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
    ids.push(cardId(suit, level, 0));
    ids.push(cardId(suit, level, 1));
  }
  return ids;
}

/**
 * Compute NT trump tracking state.
 * Determines which trumps have been seen (played or in my hand),
 * which players are known to have no trumps, and how many trumps opponents hold.
 */
export function computeNTTrumpState(
  myHand: Card[],
  myIndex: number,
  trickHistory: readonly Trick[],
  reveals: readonly Reveal[],
  config: TrumpDeclaration,
): NTTrumpState {
  const level = config.level;

  // Mark all trumps as initially unknown (-1), then track where they were seen.
  const seenByPlayer: number[] = []; // cardId index -> playerIndex
  const allTrumpIds = enumerateNTTrumpIds(level);
  const trumpIdToIdx = new Map<string, number>();
  allTrumpIds.forEach((id, i) => trumpIdToIdx.set(id, i));
  seenByPlayer.length = allTrumpIds.length;
  seenByPlayer.fill(-1);

  // Mark cards in my hand
  for (const c of myHand) {
    const idx = trumpIdToIdx.get(c.id);
    if (idx !== undefined) seenByPlayer[idx] = myIndex;
  }

  // Mark cards seen in tricks
  for (const trick of trickHistory) {
    for (let pi = 0; pi < 4; pi++) {
      for (const c of trick.plays[pi].cards) {
        const idx = trumpIdToIdx.get(c.id);
        if (idx !== undefined) {
          seenByPlayer[idx] = trick.plays[pi].cards === trick.plays[pi].cards
            ? (trick.leadPlayerIndex + pi) % 4
            : -2; // seen but don't know who played it (shouldn't happen)
        }
      }
    }
  }

  // Known trump cards per player
  const knownTrumpsPerPlayer: Card[][] = [[], [], [], []];
  let seenCount = 0;
  for (let i = 0; i < allTrumpIds.length; i++) {
    const pid = seenByPlayer[i];
    if (pid >= 0) {
      // Reconstruct card from ID
      const parts = allTrumpIds[i].split('-');
      const card = createCard(
        parts[0] as any,
        parseInt(parts[1]) as Rank,
        parseInt(parts[2]),
      );
      knownTrumpsPerPlayer[pid].push(card);
      seenCount++;
    }
  }

  // Determine who has no trumps
  const playersWithNoTrump = new Set<number>();
  const unseenCount = 12 - seenCount;

  // If we've seen all 12, everyone with 0 known trumps has exactly 0.
  // If we've seen N and one player has all unseen, we can deduce.
  for (let p = 0; p < 4; p++) {
    if (knownTrumpsPerPlayer[p].length === 0 && unseenCount === 0) {
      playersWithNoTrump.add(p);
    }
  }

  // Count opponent trumps
  const myTeamParity = myIndex % 2;
  let opponentTrumpCount = 0;
  for (let p = 0; p < 4; p++) {
    if (p % 2 !== myTeamParity) {
      opponentTrumpCount += knownTrumpsPerPlayer[p].length;
    }
  }
  // Add unseen trumps if we can't determine where they are
  const unseenOpponentTrumps = unseenCount > 0
    ? Math.ceil(unseenCount / 2) // assume worst case: half of unseen on opponent side
    : 0;
  opponentTrumpCount += unseenOpponentTrumps;

  // Count remaining jokers
  let remainingBigJokers = 2; // start with 2 total
  let remainingSmallJokers = 2;
  for (let i = 0; i < allTrumpIds.length; i++) {
    if (seenByPlayer[i] >= 0) {
      const parts = allTrumpIds[i].split('-');
      const rank = parseInt(parts[1]);
      if (rank === Rank.BigJoker) remainingBigJokers--;
      if (rank === Rank.SmallJoker) remainingSmallJokers--;
    }
  }

  // Determine if all unseen jokers are on our side
  // If all 4 jokers are accounted for in our team's hands, then yes
  const myTeamBjCount = knownTrumpsPerPlayer[myIndex].filter(c => c.rank === Rank.BigJoker).length +
    knownTrumpsPerPlayer[(myIndex + 2) % 4].filter(c => c.rank === Rank.BigJoker).length;
  const myTeamSjCount = knownTrumpsPerPlayer[myIndex].filter(c => c.rank === Rank.SmallJoker).length +
    knownTrumpsPerPlayer[(myIndex + 2) % 4].filter(c => c.rank === Rank.SmallJoker).length;

  const allUnseenJokersOnOurSide =
    remainingBigJokers + remainingSmallJokers === 0 ||
    (myTeamBjCount + myTeamSjCount === 4);

  const allUnseenBigJokersOnOurSide =
    remainingBigJokers === 0 || myTeamBjCount === 2;

  return {
    knownTrumpsPerPlayer: knownTrumpsPerPlayer as readonly (readonly Card[])[],
    playersWithNoTrump,
    totalTrumps: 12,
    opponentTrumpCount,
    remainingBigJokers: Math.max(0, remainingBigJokers),
    remainingSmallJokers: Math.max(0, remainingSmallJokers),
    allUnseenJokersOnOurSide,
    allUnseenBigJokersOnOurSide,
  };
}
