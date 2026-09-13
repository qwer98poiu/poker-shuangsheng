/**
 * NT trump drawing (无主吊主) — the six rules that pick a safe trump lead.
 *
 * Shared by the general lead ladder (`lead.ts`, strategy 5) and by the NT
 * long-suit layer, which uses it as a pre-step when opponents might trump the
 * proposed lead.
 */
import type { Card } from '../types.js';
import { Rank, SpecialSuit, isPointRank } from '../types.js';
import { getEffectiveRank } from '../model.js';
import { findAllPairs, detectTractors } from '../pattern/index.js';
import type { AIContext } from './types.js';
import { canFormJokerPair, opponentsHaveTrump } from './nt-tracking.js';

export function shouldDrawTrumpInNT(ctx: AIContext): boolean {
  if (!ctx.ntState) return false;
  const s = ctx.ntState;

  // Rule 1: Opponents have no trump -> stop unless level is points + attacker leading + not yet 80
  if (!opponentsHaveTrump(s, ctx.myIndex)) {
    if (!isPointRank(ctx.level as Rank)) return false;
    if (!ctx.isAttacker || ctx.playCount > 0) return false;
    if (ctx.attackerPoints >= 80) return false;
    return true;
  }

  return true;
}

export function pickNTTrumpLead(
  hand: Card[],
  trumpCards: Card[],
  ctx: AIContext,
): { cards: Card[]; reason: string } | null {
  const s = ctx.ntState!;
  const myTrumpPairs = findAllPairs(trumpCards);
  const levelPairs = myTrumpPairs.filter(p => p[0].suit !== SpecialSuit.Joker);
  const jokerPairs = myTrumpPairs.filter(p => p[0].suit === SpecialSuit.Joker);
  const smallJokerPair = jokerPairs.find(p => p[0].rank === Rank.SmallJoker);
  const opponents = [0, 1, 2, 3].filter(p => p % 2 !== ctx.myIndex % 2);
  const oppsHaveTrump = opponents.some(p => s.maxTrumpCounts[p] > 0);

  // Rule 5 (highest): SJ pair + level pair forms tractor -> lead if opponents can't beat
  if (smallJokerPair && levelPairs.length > 0) {
    for (const lp of levelPairs) {
      const tractorCandidate = [...smallJokerPair, ...lp];
      const tractors = detectTractors(tractorCandidate, ctx);
      if (tractors.length > 0 && tractors.some(t => t.length === 4)) {
        // SJ+level tractor can only be beaten by BJ+SJ tractor (BJ+SJ pair from 1 player)
        const canAnyBeat = opponents.some(p =>
          s.canFormPair[p] && s.canHaveBigJoker[p] && s.canHaveSmallJoker[p],
        );
        if (!canAnyBeat) {
          return { cards: tractorCandidate, reason: '吊主(小王对+级牌对拖拉机)' };
        }
      }
    }
  }

  // Rule 3: Level pair exists + no opponent joker pair -> lead level pair
  if (levelPairs.length > 0) {
    const noOpponentJokerPair = opponents.every(
      p => !canFormJokerPair(p, s),
    );
    if (noOpponentJokerPair && oppsHaveTrump) {
      levelPairs.sort((a, b) =>
        getEffectiveRank(a[0], ctx) - getEffectiveRank(b[0], ctx),
      );
      return { cards: levelPairs[0], reason: '吊主(级牌对，对手无王对)' };
    }
  }

  // Rule 4: Single big joker or small joker (BJ on our side) -> draw single
  const myBigJokers = trumpCards.filter(c => c.rank === Rank.BigJoker);
  const mySmallJokers = trumpCards.filter(c => c.rank === Rank.SmallJoker);

  if (myBigJokers.length > 0 && oppsHaveTrump) {
    return { cards: [myBigJokers[0]], reason: '吊主(大王)' };
  }

  if (mySmallJokers.length > 0 && s.allUnseenBigJokersOnOurSide && oppsHaveTrump) {
    return { cards: [mySmallJokers[0]], reason: '吊主(小王，大王全在我方)' };
  }

  // Rule 2: All unseen jokers on our side -> draw level cards to clear
  if (s.allUnseenJokersOnOurSide) {
    const levelCards = trumpCards.filter(c => c.suit !== SpecialSuit.Joker);
    if (levelCards.length > 0) {
      levelCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [levelCards[0]], reason: '吊主(级牌)' };
    }
    if (trumpCards.length > 0) {
      trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
      return { cards: [trumpCards[0]], reason: '吊主' };
    }
  }

  // Rule 6: Opponents can't form pairs -> drawing single is safe
  const allOpponentsNoPair = opponents.every(p => !s.canFormPair[p]);
  if (allOpponentsNoPair && trumpCards.length > 0) {
    trumpCards.sort((a, b) => getEffectiveRank(a, ctx) - getEffectiveRank(b, ctx));
    return { cards: [trumpCards[0]], reason: '吊主(对手无对)' };
  }

  return null; // Not advantageous to draw
}
