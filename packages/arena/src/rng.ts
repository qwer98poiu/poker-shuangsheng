/**
 * Deterministic deck derivation for mirror pairs.
 *
 * Contract: hand index i of BOTH matches in pair k uses the same deck, so
 * P0 receives identical 25 dealt cards in both matches (and the same bottom).
 * Cross-pair seeds differ. No Date.now/Math.random on this path.
 */
import { createFullDeck, seededShuffle } from '@poker/engine';
import type { Card } from '@poker/engine';

const C1 = 0x85ebca6b;
const C2 = 0xc2b2ae35;
const C3 = 0x27d4eb2f;
const C4 = 0x165667b1;

/** Deterministic 32-bit mix of (seed, pairIndex, handIndex). */
export function hashMix(seed: number, pairIndex: number, handIndex: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (pairIndex + C1), C2);
  h = Math.imul(h ^ (handIndex + C3), C4);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/** The deck for hand i of pair k — identical across both matches of the pair. */
export function deckForHand(seed: number, pairIndex: number, handIndex: number): Card[] {
  return seededShuffle(createFullDeck(), hashMix(seed, pairIndex, handIndex));
}
