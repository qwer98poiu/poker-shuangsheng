/**
 * 全自动测试：4 AI 对战，验证引擎逻辑
 * 用法: npx tsx packages/cli/src/test-run.ts
 */
import {
  createFullDeck, shuffle,
  createInitialState, GamePhase,
  tryReveal, finalizeReveal, playCards, computeLevelChange,
  rankLabel, suitLabel,
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay,
} from '@poker/engine';
import type { GameState, PlayerState, Card } from '@poker/engine';
import { Suit, Rank } from '@poker/engine';

let gameState: GameState;
let PROBLEMS = 0;
const DEBUG = true;

function ptag(idx: number) { return `P${idx + 1}`; }

function log(s: string) { console.log(s); }

await runGame();
console.log(`\n总错误数: ${PROBLEMS}`);
process.exit(0);

async function runGame() {
  log('🃏 4 AI 自动对战\n');

  let level = 2;
  let dealer = 0;

  for (let round = 0; round < 5; round++) {
    log(`\n${'='.repeat(50)}`);
    log(`局 ${round + 1}  级 ${rankLabel(level)}  庄 ${ptag(dealer)}`);
    log('='.repeat(50));

    const deck = shuffle(createFullDeck());
    const players = [0, 1, 2, 3].map(i => ({
      hand: [] as Card[], isHuman: false, name: `AI-${i + 1}`, index: i,
    })) as [PlayerState, PlayerState, PlayerState, PlayerState];

    gameState = createInitialState(players, dealer, level, true);

    // --- deal ---
    const dealt: Card[][] = [[], [], [], []];
    for (let i = 0; i < 100; i++) {
      const pi = i % 4;
      dealt[pi].push(deck[i]);
      gameState = {
        ...gameState,
        dealtCards: dealt.map(a => [...a]) as any,
        players: gameState.players.map((p, j) => ({ ...p, hand: [...dealt[j]] })) as any,
      };
      for (const pj of [0, 1, 2, 3]) {
        const rev = aiTryReveal(gameState.players[pj].hand, dealt[pj], pj, gameState.currentLevel, gameState.currentReveal);
        if (rev) gameState = tryReveal(gameState, pj, rev.suit);
      }
    }
    gameState = { ...gameState, bottomCards: deck.slice(100, 108), dealingComplete: true, phase: GamePhase.Revealing };

    // --- reveal ---
    gameState = finalizeReveal(gameState);
    const t = gameState.trumpDeclaration!;
    log(`主: ${t.trumpSuit ? suitLabel(t.trumpSuit) + rankLabel(t.level) : 'NT'}`);

    // --- bottom exchange ---
    const declarer = gameState.players[t.declarerIndex];
    const { discard } = aiChooseBottomCards(declarer.hand, t);
    gameState = {
      ...gameState,
      players: gameState.players.map((p, i) =>
        i === t.declarerIndex
          ? { ...p, hand: [...p.hand.filter(c => !discard.some(d => d.id === c.id)), ...gameState.bottomCards] }
          : p,
      ) as any,
      bottomCards: discard,
      currentPlayerIndex: t.declarerIndex,
      leadPlayerIndex: t.declarerIndex,
    };

    // --- play phase ---
    let aborted = false;
    for (let trick = 1; trick <= 25; trick++) {
      if (gameState.phase === GamePhase.RoundEnd || aborted) break;

      // check if all hands empty = normal game completion
      const allEmpty = gameState.players.every(pl => pl.hand.length === 0);
      if (allEmpty) break;

      for (let p = 0; p < 4; p++) {
        const cp = gameState.currentPlayerIndex;
        const player = gameState.players[cp];

        // should never happen if we checked allEmpty above
        if (player.hand.length === 0) {
          log(`💀 ${ptag(cp)} 手牌空了但其他人还有牌！`);
          for (const pi of [0, 1, 2, 3]) {
            log(`  ${ptag(pi)}: ${gameState.players[pi].hand.length} 张`);
          }
          PROBLEMS++;
          aborted = true;
          break;
        }

        const isLeading = gameState.trickPlays.length === 0;
        const config = gameState.trumpDeclaration!;
        let cards: Card[] = [];

        if (isLeading) {
          const r = aiLeadPlay(player.hand, config);
          cards = r.cards;
        } else {
          const leadPlay = gameState.trickPlays[0];
          if (!leadPlay) { aborted = true; break; }
          const suit = leadPlay.leadSuit ?? leadPlay.cards[0]?.suit;
          if (!suit) { cards = [player.hand[0]]; }
          else {
            const r = aiFollowPlay(player.hand, leadPlay.cards, suit, config);
            cards = r.cards;
          }
        }

        // sanity: must have cards
        if (!cards || cards.length === 0 || cards.some(c => !c)) {
          cards = [player.hand[0]];
          PROBLEMS++;
        }

        // ensure follow count matches
        if (!isLeading && gameState.trickPlays.length > 0) {
          const want = gameState.trickPlays[0].cards.length;
          if (cards.length !== want) {
            const used = new Set(cards.filter(Boolean).map(c => c.id));
            const extra = player.hand.filter(c => !used.has(c.id));
            cards = [...cards.filter(Boolean), ...extra];
            cards = cards.slice(0, want);
            if (cards.length < want) {
              aborted = true;
              break;
            }
            PROBLEMS++;
          }
        }

        if (aborted) break;

        const result = playCards(gameState, cp, cards);
        if (result.error) {
          // fallback: try first N cards (same count)
          const want = isLeading ? 1 : gameState.trickPlays[0].cards.length;
          const fb = playCards(gameState, cp, player.hand.slice(0, want));
          if (fb.error) {
            log(`💀 ${ptag(cp)} 崩溃: ${fb.error}`);
            aborted = true;
            break;
          }
          gameState = fb.state;
          PROBLEMS++;
        } else {
          gameState = result.state;
        }

        if (gameState.phase === GamePhase.RoundEnd) break;
      }

      if (aborted) break;
      if (gameState.phase === GamePhase.RoundEnd) break;
    }

    if (aborted) {
      log(`⚠️ 局中止 (墩 ${gameState.tricksPlayed})`);
      // display remaining hands
      for (const pi of [0, 1, 2, 3]) {
        log(`  ${ptag(pi)} 剩 ${gameState.players[pi].hand.length} 张`);
      }
      continue;
    }

    // verify
    const rems = gameState.players.map(p => p.hand.length);
    if (rems.some(r => r !== 0)) {
      log(`⚠️ 手牌不空: ${rems}`);
      PROBLEMS++;
    }
    if (new Set(rems).size > 1) {
      log(`⚠️ 手牌不均: ${rems}`);
      PROBLEMS++;
    }

    log(`闲家得分: ${gameState.attackerPoints}  错误: ${PROBLEMS}`);

    const changes = computeLevelChange(gameState.attackerPoints);
    const defenderTeam = gameState.trumpDeclaration?.declarerIndex !== undefined
      ? gameState.trumpDeclaration.declarerIndex % 2
      : dealer % 2;
    const atkTeam = defenderTeam === 0 ? 1 : 0;
    level += (atkTeam === 1) ? changes.attackerChange : changes.defenderChange;
    level = Math.max(2, Math.min(level, 14));
    // 闲家上台才轮换庄家
    if (gameState.attackerPoints >= 80) dealer = (dealer + 1) % 4;
  }
}
