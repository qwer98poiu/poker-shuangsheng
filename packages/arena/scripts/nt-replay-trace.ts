/**
 * 复现单副发牌并打印每一步 AI 决策（含 reason），用于回答「AI 为什么这么出」。
 * 调试脚本，与 nt-longsuit-deal-export.ts 同一套发牌/扣底/出牌口径。
 *
 * 用法（在 packages/arena 下）:
 *   npx tsx scripts/nt-replay-trace.ts --deal 28 --level 9 --seed 42
 *   npx tsx scripts/nt-replay-trace.ts --deal 28 --level 9 --tricks 2
 */
import {
  createInitialState, finalizeReveal, tryReveal, playCards, buildAIContext, GamePhase,
  suitLabel, rankLabel, isPointRank,
} from '@poker/engine';
import type { Card, GameState, PlayerState, TrumpDeclaration } from '@poker/engine';
import { deckForHand } from '../src/rng.js';
import { strategyByName } from '../src/strategies.js';
import { computeLongSuit, computeLongSuitMemory, longSuitLeadCount, initialHand, myPlayedCards } from '../../engine/src/ai/suit-memory.js';
import { computeOffSuitControls } from '../../engine/src/ai/bottom-controls.js';
import { pickNTTrumpLead } from '../../engine/src/ai/nt-trump.js';
import { worstCaseSuitHand, findThrowableSuitCards } from '../../engine/src/ai/throw-detector.js';
import { extractComponents } from '../../engine/src/comparing/index.js';
import { validateThrow } from '../../engine/src/leading/index.js';

const NAMES = ['玩家1', 'AI-2', 'AI-3', 'AI-4'] as const;
const HAND_COUNT = 25;

const STRAT_AI = strategyByName('ai');
const STRAT_0907 = strategyByName('ai-0907');
const seatStrategy = (i: number) => (i % 2 === 0 ? STRAT_AI : STRAT_0907);

function parseArgs(argv: string[]) {
  const args = { seed: 42, deal: 28, level: 9, tricks: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} 需要参数值`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--seed': args.seed = parseInt(val(), 10) >>> 0; break;
      case '--deal': args.deal = parseInt(val(), 10); break;
      case '--level': args.level = parseInt(val(), 10); break;
      case '--tricks': args.tricks = parseInt(val(), 10); break;
      default: throw new Error(`未知参数: ${a}`);
    }
  }
  return args;
}

function dealState(deck: Card[], level: number, isFirstHand: boolean): GameState {
  const players = [0, 1, 2, 3].map(i => ({
    hand: [] as Card[], isHuman: false, name: NAMES[i], index: i,
  })) as [PlayerState, PlayerState, PlayerState, PlayerState];

  let state = createInitialState(players, 0, level, false);
  const dealt: Card[][] = [[], [], [], []];
  for (let i = 0; i < 100; i++) {
    const pi = i % 4;
    dealt[pi].push(deck[i]);
    state = {
      ...state,
      dealtCards: dealt.map(a => [...a]) as unknown as Card[][],
      players: state.players.map((p, j) => ({ ...p, hand: [...dealt[j]] })) as unknown as typeof state.players,
    };
    for (let pj = 0; pj < 4; pj++) {
      const rev = seatStrategy(pj).tryReveal(state.players[pj].hand, dealt[pj], pj, level, state.currentReveal);
      if (rev) state = tryReveal(state, pj, rev.suit);
    }
  }
  state = {
    ...state,
    bottomCards: deck.slice(100, 108),
    dealingComplete: true,
    phase: GamePhase.Revealing,
  };
  state = finalizeReveal(state, isFirstHand);
  return { ...state, declarerIndex: 0, trumpDeclaration: { declarerIndex: 0, trumpSuit: null, level } };
}

function exchangeBottom(state: GameState, t: TrumpDeclaration): GameState {
  const merged = [...state.players[0].hand, ...state.bottomCards];
  const { discard } = STRAT_AI.chooseBottom(merged, t);
  const keep = new Set(discard.map(d => d.id));
  const newHand = merged.filter(c => !keep.has(c.id));
  const players = state.players.map((p, i) => (i === 0 ? { ...p, hand: newHand } : p)) as unknown as typeof state.players;
  return {
    ...state, players, bottomCards: discard, phase: GamePhase.Playing,
    currentPlayerIndex: 0, leadPlayerIndex: 0,
    initialHands: players.map(p => p.hand),
  };
}

/** 一张牌的显示名（花色+点数；分数牌加 ★；主牌加 T: 前缀）。 */
function cn(c: Card, t: TrumpDeclaration): string {
  const base = c.rank >= 15
    ? (c.rank === 16 ? 'JOKER' : 'joker')
    : `${suitLabel(c.suit)}${rankLabel(c.rank)}`;
  const trump = c.rank >= 15 || (t.trumpSuit === null ? c.rank === t.level : false);
  return `${isPointRank(c.rank) ? '★' : ''}${trump ? 'T:' : ''}${base}`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const deck = deckForHand(args.seed, 0, args.deal);
  let s = exchangeBottom(dealState(deck, args.level, false), {
    declarerIndex: 0, trumpSuit: null, level: args.level,
  });
  const t = s.trumpDeclaration!;
  console.log(`发牌序号 ${args.deal} | seed ${args.seed} | level ${args.level} | 无主 | 庄家 玩家1`);
  console.log(`底牌: ${s.bottomCards.map(c => cn(c, t)).join(' ')}`);
  for (let i = 0; i < 4; i++) {
    console.log(`${NAMES[i]}: ${s.players[i].hand.map(c => cn(c, t)).join(' ')}`);
  }
  console.log('');

  while (s.tricksPlayed < HAND_COUNT && s.tricksPlayed < args.tricks) {
    if (s.players.every(p => p.hand.length === 0)) break;
    const cp = s.currentPlayerIndex;
    const player = s.players[cp];
    const isLeading = s.trickPlays.length === 0;
    const leadLen = isLeading ? 0 : s.trickPlays[0].cards.length;
    const ctx = buildAIContext(s, cp);
    if (!ctx) throw new Error('缺少亮主信息');
    const strat = seatStrategy(cp);

    if (isLeading && ctx.trumpSuit === null) {
      const ls = computeLongSuit(player.hand, ctx);
      const mem = computeLongSuitMemory(player.hand, ctx);
      console.log(
        `  [NT层] 长花色=${ls ? suitLabel(ls) : '无'} 已领出该门次数=${ls ? longSuitLeadCount(ctx, ls) : 0}`
        + ` 手牌该门=${ls ? player.hand.filter(c => c.suit === ls).length : 0}张`
        + ` T1=${mem ? mem.tier1.map(c => cn(c, t)).join(' ') || '∅' : '—'}`
        + ` 已出该门=${mem ? mem.playedCards.length : 0}张`
        + ` void=${mem ? [...mem.voidPlayers].join(',') || '无' : '—'}`
        + ` 无对=${mem ? [...mem.noPairPlayers].join(',') || '无' : '—'}`
        + ` 我主牌张数=${player.hand.filter(c => c.rank >= 15 || c.rank === t.level).length}`
        + ` 有人亮王对=${ctx.reveals.some(r => r.strength >= 3 && r.playerIndex % 2 !== ctx.myIndex % 2)}`
        + ` maxTrumpCounts=[${(ctx.ntState?.maxTrumpCounts ?? []).join(',')}]`
        + ` 大王全在我方=${ctx.ntState?.allUnseenBigJokersOnOurSide}`
        + ` 王全在我方=${ctx.ntState?.allUnseenJokersOnOurSide}`
        + ` 亮主记录=[${ctx.reveals.map(r => `${r.playerIndex}/${r.strength}/${r.suit}`).join(' ')}]`,
      );
      const trumpCards = player.hand.filter(c => c.rank >= 15 || c.rank === t.level);
      const tl = pickNTTrumpLead(player.hand, trumpCards, ctx);
      console.log(`  [NT层] 吊主预选=${tl ? tl.cards.map(c => cn(c, t)).join(' ') + ' ← ' + tl.reason : 'null'}`);
      // §1 候选：非长花色控制张（同时打印「按出牌顺序正确取牌」的对照）
      {
        const fixedPlayed: Card[] = [];
        for (const tr of ctx.trickHistory) {
          const slot = (ctx.myIndex - tr.leadPlayerIndex + 4) % 4;
          fixedPlayed.push(...tr.plays[slot].cards);
        }
        const initFixed = [...player.hand, ...fixedPlayed, ...(ctx.bottomCards ?? [])];
        for (const info of computeOffSuitControls(initFixed, ctx)) {
          if (ls && info.suit === ls) continue;
          const t1 = info.tier1.filter(c => new Set(player.hand.map(x => x.id)).has(c.id));
          console.log(`  [§1修正] ${suitLabel(info.suit)}: 初始该门=${info.cards.map(c => cn(c, t)).join(' ')} tier1=${info.tier1.map(c => cn(c, t)).join(' ') || '∅'} ∩手牌=${t1.map(c => cn(c, t)).join(' ') || '∅'}`);
        }
        const init = initialHand(player.hand, ctx);
        const handIds = new Set(player.hand.map(c => c.id));
        for (const info of computeOffSuitControls(init, ctx)) {
          if (ls && info.suit === ls) continue;
          const t1 = info.tier1.filter(c => handIds.has(c.id));
          if (t1.length === 0) continue;
          const hs = player.hand.filter(c => c.suit === info.suit);
          console.log(
            `  [§1] ${suitLabel(info.suit)}: 初始该门${info.cards.length}张 控张∩手牌=`
            + `${t1.map(c => cn(c, t)).join(' ') || '∅'} 手牌该门${hs.length}张`
            + ` → 打后断门=${t1.length === hs.length}`,
          );
          console.log(`     该门初始牌=${info.cards.map(c => cn(c, t)).join(' ')}`);
          console.log(`     该门 tier1=${info.tier1.map(c => cn(c, t)).join(' ') || '∅'}`);
          const wc = worstCaseSuitHand(info.cards, info.suit, ctx, []);
          console.log(`     最坏手(${wc.length})=${wc.map(c => cn(c, t)).join(' ')}`);
          console.log(`     throwable=${findThrowableSuitCards(info.cards, info.suit, ctx, []).map(c => cn(c, t)).join(' ') || '∅'}`);
          console.log(`     myPlayedCards=${myPlayedCards(ctx).map(c => cn(c, t)).join(' ')}`);
        }
      }

      // 复算 §6 之前的 throw 闸门：gated 是否被清空
      if (mem && ls) {
        const suitCards = player.hand.filter(c => c.suit === ls);
        const worst = worstCaseSuitHand(suitCards, ls, ctx, mem.playedCards);
        const comps = extractComponents(mem.tier1, ctx);
        const gate = (cs: Card[], label: string) => {
          const ok = validateThrow(cs, player.hand, [worst], ctx).valid;
          console.log(`  [闸门] ${label} ${cs.map(c => cn(c, t)).join(' ')} → ${ok ? '过' : '被砍'}`);
          return ok;
        };
        console.log(`  [闸门] 提案件数: 拖拉机${comps.tractors.length} 对${comps.pairs.length} 单${comps.singles.length}`);
        for (const p of comps.pairs) gate(p, '对');
        for (const s of comps.singles) gate([s], '单');
        console.log(`  [闸门] 最坏手=${worst.map(c => cn(c, t)).join(' ') || '空'}`);
      }
    }

    let cards: Card[];
    let reason: string;
    if (isLeading) {
      const r = strat.lead(player.hand, ctx);
      cards = r.cards; reason = r.reason ?? '';
    } else {
      const leadPlay = s.trickPlays[0];
      const leadSuit = leadPlay.leadSuit ?? leadPlay.cards[0]?.suit ?? null;
      const r = strat.follow(player.hand, leadPlay.cards, leadSuit!, ctx);
      cards = r.cards; reason = r.reason ?? '';
    }
    const trickNo = s.tricksPlayed + 1;
    console.log(
      `第 ${trickNo} 墩 ${NAMES[cp]}${isLeading ? ' 领出' : ' 跟牌'}(${player.hand.length}张手牌): `
      + `${cards.map(c => cn(c, t)).join(' ')}  ← ${reason}`,
    );

    const res = playCards(s, cp, cards);
    if (res.error) {
      console.log(`  ⚠️ 非法: ${res.error}`);
      const want = isLeading ? 1 : leadLen;
      const fb = playCards(s, cp, player.hand.slice(0, want));
      if (fb.error) throw new Error(`回退失败: ${fb.error}`);
      s = fb.state;
    } else {
      if (res.forcedPlay) console.log('  ⚠️ 甩牌被判非法，引擎强制改出');
      s = res.state;
    }
    if (s.trickPlays.length === 0 && s.trickHistory.length > 0) {
      const last = s.trickHistory[s.trickHistory.length - 1];
      if (last.leadPlayerIndex === cp || true) {
        console.log(
          `  → 第 ${s.trickHistory.length} 墩结束，赢家 ${NAMES[last.winnerIndex]}`
          + `（得分 ${last.points}）闲家累计 ${s.attackerPoints}`,
        );
      }
    }
    if (s.phase === GamePhase.RoundEnd) { console.log('本局结束'); break; }
    console.log('');
  }
  console.log(`\n最终: 闲家分 ${s.attackerPoints} | 墩 ${s.tricksPlayed}/25 | 主牌 ${t.trumpSuit === null ? '无主' : suitLabel(t.trumpSuit)}`);
}

main();
