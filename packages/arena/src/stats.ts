/**
 * Per-strategy stat accumulators. Every ratio carries explicit {n, d}
 * (numerator / denominator). Aborted hands never enter any denominator.
 */
import type { HandEvent } from './types.js';

export interface CountPair {
  n: number;
  d: number;
}

export interface StrategyStats {
  matches: {
    played: number;
    won: number;
    drawn: number;
    oppLevel: CountPair;  // 胜出时对方平均等级 = Σ对方终局等级/胜场数（A=14）
  };
  handsPlayed: number;
  banker: {
    hands: number;
    wins: number;                          // 台上胜率 = wins/hands
    perLevel: Map<number, CountPair>;      // 台上各等级胜率, key = 我方等级
    trumpHands: CountPair;                 // 台上打有主胜率 = n/d (n=wins)
    ntHands: CountPair;                    // 台上打NT胜率 = n/d (n=wins)
    avgLoss: CountPair;                    // 台上平均失分 = Σ闲家最终分/hands
    avgBottomPts: CountPair;               // 台上扣底平均分数 = Σ底牌分数/hands
    killSuitFreq: CountPair;               // 台上扣绝一门频率 = Σ(扣绝>0)/hands
    keepBottom: CountPair;                 // 庄家保底频率 = 庄家赢最后墩/hands
  };
  attacker: {
    hands: number;
    wins: number;                          // 台下胜率 = wins/hands (finalPts >= 80)
    perLevel: Map<number, CountPair>;      // 台下各等级胜率, key = 我方等级
    trumpHands: CountPair;                 // 台下打有主胜率
    ntHands: CountPair;                    // 台下打NT胜率 = n/d (n=wins)
    kouDiFreq: CountPair;                  // 抠底频率 = 当闲家赢最后一墩/hands
    kouDiSuccess: CountPair;               // 抠底成功频率 = 底牌有分的小局中赢最后墩/底牌有分小局
    avgKouDi: CountPair;                   // 闲家抠底平均加分 = Σ抠底加分/抠底发生局数
  };
  tricks: {
    won: CountPair;                        // 每墩胜率 = n/d (d = 总墩数)
    leads: CountPair;                      // 每局平均领出次数 = n/handsPlayed (d = 总墩数)
    leadCards: CountPair;                  // 每局平均每墩领出张数(仅我方领出) = n/d
  };
  abortedHands: number;
}

export function createStats(): StrategyStats {
  return {
    matches: { played: 0, won: 0, drawn: 0, oppLevel: { n: 0, d: 0 } },
    handsPlayed: 0,
    banker: {
      hands: 0,
      wins: 0,
      perLevel: new Map(),
      trumpHands: { n: 0, d: 0 },
      ntHands: { n: 0, d: 0 },
      avgLoss: { n: 0, d: 0 },
      avgBottomPts: { n: 0, d: 0 },
      killSuitFreq: { n: 0, d: 0 },
      keepBottom: { n: 0, d: 0 },
    },
    attacker: {
      hands: 0,
      wins: 0,
      perLevel: new Map(),
      trumpHands: { n: 0, d: 0 },
      ntHands: { n: 0, d: 0 },
      kouDiFreq: { n: 0, d: 0 },
      kouDiSuccess: { n: 0, d: 0 },
      avgKouDi: { n: 0, d: 0 },
    },
    tricks: {
      won: { n: 0, d: 0 },
      leads: { n: 0, d: 0 },
      leadCards: { n: 0, d: 0 },
    },
    abortedHands: 0,
  };
}

function bump(map: Map<number, CountPair>, level: number, n: number, d: number): void {
  const cur = map.get(level) ?? { n: 0, d: 0 };
  cur.n += n;
  cur.d += d;
  map.set(level, cur);
}

/** Accumulate one hand into the strategy's stats (ourParity = our team). */
export function addHandStats(s: StrategyStats, ev: HandEvent, ourParity: 0 | 1): void {
  if (ev.aborted) {
    s.abortedHands += 1;
    return;
  }
  s.handsPlayed += 1;

  const isBanker = ev.teamBanker === ourParity;
  if (isBanker) {
    const b = s.banker;
    b.hands += 1;
    b.wins += ev.bankerWon ? 1 : 0;
    bump(b.perLevel, ev.level, ev.bankerWon ? 1 : 0, 1);
    if (ev.trumpSuit !== null) {
      b.trumpHands.n += ev.bankerWon ? 1 : 0;
      b.trumpHands.d += 1;
    } else {
      b.ntHands.n += ev.bankerWon ? 1 : 0;
      b.ntHands.d += 1;
    }
    b.avgLoss.n += ev.finalPts;
    b.avgLoss.d += 1;
    b.avgBottomPts.n += ev.bottomPoints;
    b.avgBottomPts.d += 1;
    if (ev.killSuitCount > 0) b.killSuitFreq.n += 1;
    b.killSuitFreq.d += 1;
    if (!ev.attackerWonLastTrick) b.keepBottom.n += 1;
    b.keepBottom.d += 1;
  } else {
    const a = s.attacker;
    const won = ev.bankerWon ? 0 : 1;
    a.hands += 1;
    a.wins += won;
    bump(a.perLevel, ev.attackerLevel, won, 1);
    if (ev.trumpSuit !== null) {
      a.trumpHands.n += won;
      a.trumpHands.d += 1;
    } else {
      a.ntHands.n += won;
      a.ntHands.d += 1;
    }
    if (ev.attackerWonLastTrick) a.kouDiFreq.n += 1;
    a.kouDiFreq.d += 1;
    if (ev.bottomPoints > 0) {
      if (ev.attackerWonLastTrick) a.kouDiSuccess.n += 1;
      a.kouDiSuccess.d += 1;
    }
    if (ev.kouDiAdd > 0) {
      a.avgKouDi.n += ev.kouDiAdd;
      a.avgKouDi.d += 1;
    }
  }

  const t = s.tricks;
  t.won.d += ev.tricksPlayed;
  t.won.n += ourParity === 0 ? ev.tricksWonByTeam0 : ev.tricksPlayed - ev.tricksWonByTeam0;
  t.leads.d += ev.tricksPlayed;
  t.leads.n += ourParity === 0 ? ev.leadsByTeam0 : ev.tricksPlayed - ev.leadsByTeam0;
  t.leadCards.n += ourParity === 0 ? ev.leadCardsByTeam0 : ev.leadCardsTotal - ev.leadCardsByTeam0;
  t.leadCards.d += ourParity === 0 ? ev.leadsByTeam0 : ev.tricksPlayed - ev.leadsByTeam0;
}

/** Record a match outcome (winnerTeam) for our strategy (ourParity). */
export function addMatchOutcome(
  s: StrategyStats, winnerTeam: 0 | 1 | null, ourParity: 0 | 1, finalLevels: [number, number],
): void {
  s.matches.played += 1;
  if (winnerTeam === null) s.matches.drawn += 1;
  else if (winnerTeam === ourParity) {
    s.matches.won += 1;
    s.matches.oppLevel.n += finalLevels[ourParity === 0 ? 1 : 0];
    s.matches.oppLevel.d += 1;
  }
}

function sumPair(a: CountPair, b: CountPair): CountPair {
  return { n: a.n + b.n, d: a.d + b.d };
}

function sumMap(a: Map<number, CountPair>, b: Map<number, CountPair>): Map<number, CountPair> {
  const out = new Map(a);
  for (const [k, v] of b) {
    const cur = out.get(k) ?? { n: 0, d: 0 };
    out.set(k, sumPair(cur, v));
  }
  return out;
}

/** Componentwise sum of two stats (used for worker aggregation). */
export function mergeStats(a: StrategyStats, b: StrategyStats): StrategyStats {
  return {
    matches: {
      played: a.matches.played + b.matches.played,
      won: a.matches.won + b.matches.won,
      drawn: a.matches.drawn + b.matches.drawn,
      oppLevel: sumPair(a.matches.oppLevel, b.matches.oppLevel),
    },
    handsPlayed: a.handsPlayed + b.handsPlayed,
    banker: {
      hands: a.banker.hands + b.banker.hands,
      wins: a.banker.wins + b.banker.wins,
      perLevel: sumMap(a.banker.perLevel, b.banker.perLevel),
      trumpHands: sumPair(a.banker.trumpHands, b.banker.trumpHands),
      ntHands: sumPair(a.banker.ntHands, b.banker.ntHands),
      avgLoss: sumPair(a.banker.avgLoss, b.banker.avgLoss),
      avgBottomPts: sumPair(a.banker.avgBottomPts, b.banker.avgBottomPts),
      killSuitFreq: sumPair(a.banker.killSuitFreq, b.banker.killSuitFreq),
      keepBottom: sumPair(a.banker.keepBottom, b.banker.keepBottom),
    },
    attacker: {
      hands: a.attacker.hands + b.attacker.hands,
      wins: a.attacker.wins + b.attacker.wins,
      perLevel: sumMap(a.attacker.perLevel, b.attacker.perLevel),
      trumpHands: sumPair(a.attacker.trumpHands, b.attacker.trumpHands),
      ntHands: sumPair(a.attacker.ntHands, b.attacker.ntHands),
      kouDiFreq: sumPair(a.attacker.kouDiFreq, b.attacker.kouDiFreq),
      kouDiSuccess: sumPair(a.attacker.kouDiSuccess, b.attacker.kouDiSuccess),
      avgKouDi: sumPair(a.attacker.avgKouDi, b.attacker.avgKouDi),
    },
    tricks: {
      won: sumPair(a.tricks.won, b.tricks.won),
      leads: sumPair(a.tricks.leads, b.tricks.leads),
      leadCards: sumPair(a.tricks.leadCards, b.tricks.leadCards),
    },
    abortedHands: a.abortedHands + b.abortedHands,
  };
}

/** Rebuild a StrategyStats from toJSON output (worker aggregation). */
export function fromJSON(j: Record<string, any>): StrategyStats {
  const s = createStats();
  const objToMap = (o: Record<string, CountPair>): Map<number, CountPair> => {
    const m = new Map<number, CountPair>();
    for (const [k, v] of Object.entries(o)) m.set(Number(k), { n: v.n, d: v.d });
    return m;
  };
  s.matches = { played: j.matches.played, won: j.matches.won, drawn: j.matches.drawn, oppLevel: { ...j.matches.oppLevel } };
  s.handsPlayed = j.handsPlayed;
  s.banker.hands = j.banker.hands;
  s.banker.wins = j.banker.wins;
  s.banker.perLevel = objToMap(j.banker.perLevel);
  s.banker.trumpHands = { ...j.banker.trumpHands };
  s.banker.ntHands = { ...j.banker.ntHands };
  s.banker.avgLoss = { ...j.banker.avgLoss };
  s.banker.avgBottomPts = { ...j.banker.avgBottomPts };
  s.banker.killSuitFreq = { ...j.banker.killSuitFreq };
  s.banker.keepBottom = { ...j.banker.keepBottom };
  s.attacker.hands = j.attacker.hands;
  s.attacker.wins = j.attacker.wins;
  s.attacker.perLevel = objToMap(j.attacker.perLevel);
  s.attacker.trumpHands = { ...j.attacker.trumpHands };
  s.attacker.ntHands = { ...j.attacker.ntHands };
  s.attacker.kouDiFreq = { ...j.attacker.kouDiFreq };
  s.attacker.kouDiSuccess = { ...j.attacker.kouDiSuccess };
  s.attacker.avgKouDi = { ...j.attacker.avgKouDi };
  s.tricks.won = { ...j.tricks.won };
  s.tricks.leads = { ...j.tricks.leads };
  s.tricks.leadCards = { ...j.tricks.leadCards };
  s.abortedHands = j.abortedHands;
  return s;
}

/** Convert to a JSON-serializable plain object (Maps → string-keyed objects). */
export function toJSON(s: StrategyStats): Record<string, unknown> {
  const mapToObj = (m: Map<number, CountPair>): Record<string, CountPair> => {
    const out: Record<string, CountPair> = {};
    for (const [k, v] of m) out[String(k)] = v;
    return out;
  };
  return {
    matches: { ...s.matches },
    handsPlayed: s.handsPlayed,
    banker: {
      hands: s.banker.hands,
      wins: s.banker.wins,
      perLevel: mapToObj(s.banker.perLevel),
      trumpHands: { ...s.banker.trumpHands },
      ntHands: { ...s.banker.ntHands },
      avgLoss: { ...s.banker.avgLoss },
      avgBottomPts: { ...s.banker.avgBottomPts },
      killSuitFreq: { ...s.banker.killSuitFreq },
      keepBottom: { ...s.banker.keepBottom },
    },
    attacker: {
      hands: s.attacker.hands,
      wins: s.attacker.wins,
      perLevel: mapToObj(s.attacker.perLevel),
      trumpHands: { ...s.attacker.trumpHands },
      ntHands: { ...s.attacker.ntHands },
      kouDiFreq: { ...s.attacker.kouDiFreq },
      kouDiSuccess: { ...s.attacker.kouDiSuccess },
      avgKouDi: { ...s.attacker.avgKouDi },
    },
    tricks: {
      won: { ...s.tricks.won },
      leads: { ...s.tricks.leads },
      leadCards: { ...s.tricks.leadCards },
    },
    abortedHands: s.abortedHands,
  };
}
