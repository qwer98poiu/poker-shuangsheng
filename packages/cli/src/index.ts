/**
 * 双升 (拖拉机) CLI version
 * Commands: card indices like "1 3 5", or debug commands starting with /
 * Debug: /hand <0-3>, /history, /score, /hint, /bottom, /dump
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import {
  createFullDeck, shuffle,
  createInitialState, GamePhase,
  tryReveal, finalizeReveal, playCards, computeLevelChange,
  sortHand, cardPointsFromRank as cardPoints, isPointRank as isPointCard,
  rankLabel, suitLabel, suitName, isRed, isTrump, getEffectiveRank,
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay,
  serialize, deserialize, resumeFromTrick,
  Suit, Rank, validateFollow, validateLead,
  buildAIContext, computeBestSoFar,
} from '@poker/engine';
import { classify } from '@poker/engine';
import { parseCards } from './parse.js';
import type {
  GameState, PlayerState, TrumpDeclaration, Card, AIReason,
} from '@poker/engine';

const SAVE_DIR = path.join(process.cwd(), 'saves');

// ---- config ----
let DEBUG = false;
let HUMAN_COUNT = 1;
let aiPlayers: boolean[] = [false, true, true, true];

// ---- state ----
let gameState: GameState;
let deck: Card[] = [];
let rl: readline.Interface;

// ---- colors (ANSI) ----
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

// ---- main ----
async function main() {
  console.clear();
  console.log(BOLD + '🃏 双升 (拖拉机) CLI' + RESET);
  console.log('');

  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (prompt: string): Promise<string> => new Promise(r => rl.question(prompt, r));

  // check for saved game
  const saveFiles = getSaveFiles();
  let resumeFile: string | null = null;
  let resumeFromTrickNum = 0;

  if (saveFiles.length > 0) {
    console.log('\n可用的存档:');
    saveFiles.forEach((f, i) => {
      const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
      const isMatch = Array.isArray(s);
      const playerCount = isMatch ? 4 : (s.aiPlayers?.length ?? s.players?.length ?? 4);
      const trickCount = isMatch ? (s[0]?.tricksPlayed ?? '?') : (s.tricksPlayed ?? '?');
      const roundCount = isMatch ? `${s.length}局` : '1局';
      console.log(`  [${i + 1}] ${path.basename(f)} — ${new Date(isMatch ? s[0]?.t : s.t).toLocaleString()} — ${playerCount}人 — ${roundCount} — 墩${trickCount}`);
    });
    const loadChoice = await q('加载存档? (输入编号, 回车跳过): ');
    if (loadChoice) {
      const idx = parseInt(loadChoice) - 1;
      if (idx >= 0 && idx < saveFiles.length) {
        resumeFile = saveFiles[idx];
        const trickInput = await q(`从第几墩继续? (回车=从当前): `);
        if (trickInput) {
          resumeFromTrickNum = parseInt(trickInput);
          if (isNaN(resumeFromTrickNum)) resumeFromTrickNum = 0;
        } else {
          resumeFromTrickNum = JSON.parse(fs.readFileSync(resumeFile, 'utf-8')).tricksPlayed;
        }
      }
    }
  }

  if (resumeFile) {
    const data = deserialize(fs.readFileSync(resumeFile, 'utf-8'));
    const resumed = resumeFromTrick(data, resumeFromTrickNum);
    gameState = resumed.state;
    aiPlayers = resumed.aiPlayers;
    DEBUG = resumed.debug;
    console.log(GREEN + `存档已加载，从第 ${resumed.state.tricksPlayed} 墩继续` + RESET);
    await doPlayPhase();
    showRoundResult();
  } else {
    const hc = await q('人类玩家数量 (0-4, 默认1): ');
    const parsed = parseInt(hc);
    HUMAN_COUNT = isNaN(parsed) ? 1 : Math.max(0, Math.min(4, parsed));
    const dbg = await q('调试模式? (y/n, 默认n): ');
    DEBUG = dbg.toLowerCase() === 'y';
    const humanSeats: number[] = [];
    for (let i = 0; i < HUMAN_COUNT; i++) humanSeats.push(i);
    aiPlayers = [0, 1, 2, 3].map(i => !humanSeats.includes(i));

    if (DEBUG) console.log(CYAN + '调试模式已开启。可用命令: /hand <0-3>, /history, /score, /hint, /bottom, /dump' + RESET);

    const spectator = aiPlayers.every(v => v);
    await gameLoop(0, 2, spectator);
  }

  rl.close();
  console.log('\n游戏结束!');
}

// ---- save/load helpers ----
function getSaveFiles(): string[] {
  try {
    if (!fs.existsSync(SAVE_DIR)) return [];
    return fs.readdirSync(SAVE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(SAVE_DIR, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}

function handleDump() {
  try {
    if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
    const name = `shengji-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const file = path.join(SAVE_DIR, name);
    const json = serialize(gameState, aiPlayers, DEBUG);
    fs.writeFileSync(file, json, 'utf-8');
    console.log(GREEN + `存档已保存: ${name}` + RESET);
    console.log(`路径: ${file}`);
  } catch (e) {
    console.log(`${RED}保存失败: ${e}${RESET}`);
  }
}

// ---- crash dump ----
const CRASH_DIR = path.join(process.cwd(), 'crashes');

function dumpCrash(state: any, aiPlayers: boolean[], error: unknown): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `crash-${ts}.json`;
  if (!fs.existsSync(CRASH_DIR)) fs.mkdirSync(CRASH_DIR, { recursive: true });
  const file = path.join(CRASH_DIR, name);

  const dump = {
    timestamp: new Date().toISOString(),
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    gameState: JSON.parse(serialize(state, aiPlayers, state.debug)),
  };

  fs.writeFileSync(file, JSON.stringify(dump, null, 2), 'utf-8');
  return file;
}

// ---- continuous game loop ----
async function gameLoop(firstDeclarer: number, currentLevel: number, spectator: boolean): Promise<void> {
  // The declarer (庄家) gets the bottom cards and leads the first trick.
  // In round 1: if someone reveals, they become the declarer; otherwise
  // the firstDeclarer (e.g. P0) becomes the declarer.
  // In subsequent rounds: the declarer is determined by the previous round's
  // result — attacker sits → declarer+1 (other side), defender keeps → declarer+2 (partner).
  let nextDeclarer = firstDeclarer;
  let levelAC = currentLevel;
  let levelBD = currentLevel;
  let gameOver = false;
  let firstRound = true;
  const matchLogs: string[] = [];

  while (!gameOver) {
    await startNewRound(nextDeclarer, nextDeclarer % 2 === 0 ? levelAC : levelBD, firstRound);
    firstRound = false;

    const result = showRoundResult();
    const changes = result.changes;
    const attackerSits = gameState.attackerPoints >= 80;
    const declarerIdx = gameState.trumpDeclaration!.declarerIndex;
    const defenderTeam = declarerIdx % 2;
    if (attackerSits) {
      if (defenderTeam === 0) {
        levelBD += changes.attackerChange;
      } else {
        levelAC += changes.attackerChange;
      }
    } else {
      if (defenderTeam === 0) {
        levelAC += changes.defenderChange;
      } else {
        levelBD += changes.defenderChange;
      }
    }

    if (levelAC > 14 || levelBD > 14) {
      console.log('\n' + GREEN + BOLD + `🏆 比赛结束！TeamAC=${rankLabel(levelAC)} TeamBD=${rankLabel(levelBD)}` + RESET);
      gameOver = true;
    }

    if (gameOver) {
      if (spectator) { const s = serialize(gameState, aiPlayers, DEBUG); matchLogs.push(s); }
      break;
    }

    if (spectator) {
      const snap = serialize(gameState, aiPlayers, DEBUG);
      matchLogs.push(snap);
      console.log(`📼 观战记录: 第 ${gameState.trickHistory.length || '?'} 墩 | TeamAC=${rankLabel(levelAC)} TeamBD=${rankLabel(levelBD)}`);
      await sleep(1500);
    } else {
      const ans = await ask(`\n继续下一局? (TeamAC=${rankLabel(levelAC)} TeamBD=${rankLabel(levelBD)}) (y/n, 默认y): `);
      if (ans.toLowerCase() === 'n') break;
    }

    nextDeclarer = attackerSits ? (declarerIdx + 1) % 4 : (declarerIdx + 2) % 4;
  }

  if (spectator && matchLogs.length > 0) {
    const matchFile = path.join(SAVE_DIR, `match-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(matchFile, '[\n' + matchLogs.join(',\n') + '\n]', 'utf-8');
    console.log(`\n📼 比赛数据已导出: ${matchFile}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---- game round ----
async function startNewRound(declarerIndex: number, currentLevel: number, isFirstRound: boolean) {
  deck = shuffle(createFullDeck());

  const emptyPlayers: PlayerState[] = [0, 1, 2, 3].map(i => ({
    hand: [] as Card[],
    isHuman: !aiPlayers[i],
    name: aiPlayers[i] ? `AI-${i + 1}` : `玩家${i + 1}`,
    index: i,
  }));

  gameState = createInitialState(
    emptyPlayers as any, declarerIndex, currentLevel, DEBUG,
  );

  // Debug mode: when human is declarer, AI defers reveal during dealing
  // so the human has a chance to reveal first.
  const humanIsDeclarer = DEBUG && declarerIndex === 0;

  await doDeal(humanIsDeclarer);
  await doReveal(isFirstRound);
  await doBottomExchange();
  await doPlayPhase();
}

// ---- deal ----
async function doDeal(skipAiReveal = false) {
  console.log('\n' + BOLD + '=== 发牌 ===' + RESET);

  const dealt: Card[][] = [[], [], [], []];

  for (let i = 0; i < 100; i++) {
    const pi = i % 4;
    const card = deck[i];
    dealt[pi].push(card);

    gameState = {
      ...gameState,
      dealtCards: dealt.map(a => [...a]) as any,
      players: gameState.players.map((p, j) => ({
        ...p,
        hand: [...dealt[j]],
      })) as any,
    };

    if (i % 10 === 0 && i > 0) {
      process.stdout.write(`发牌... ${i}/100\r`);
    }

    // AI reveal check — when human is declarer, AI defers until reveal phase
    if (!skipAiReveal) {
      for (const pj of [0, 1, 2, 3]) {
        if (aiPlayers[pj]) {
          const rev = aiTryReveal(
            gameState.players[pj].hand,
            dealt[pj],
            pj,
            gameState.currentLevel,
            gameState.currentReveal,
          );
          if (rev) {
            gameState = tryReveal(gameState, pj, rev.suit);
            if (gameState.currentReveal?.playerIndex === pj) {
              console.log(`\n${playerName(pj)} 亮主: ${rev.reason}`);
              showRevealStatus();
            }
          }
        }
      }
    }
  }

  const bottom = deck.slice(100, 108);
  gameState = {
    ...gameState,
    bottomCards: bottom,
    dealingComplete: true,
    phase: GamePhase.Revealing,
  };

  console.log(`\n发牌完成！每人 ${gameState.players[0].hand.length} 张，底牌 ${bottom.length} 张。`);
  showHumanHands();
}

function showRevealStatus() {
  const rev = gameState.currentReveal;
  if (!rev) return;
  const suit = rev.suit ? suitLabel(rev.suit) + rankLabel(gameState.currentLevel) : '无主';
  console.log(CYAN + `  当前主: ${suit} (由 ${playerName(rev.playerIndex)} 亮)` + RESET);
}

// ---- reveal ----
async function doReveal(isFirstRound: boolean) {
  console.log('\n' + BOLD + '=== 亮主阶段 ===' + RESET);
  if (gameState.currentReveal) {
    showRevealStatus();
  } else {
    console.log('无人亮主，将由庄家叫主。');
  }

  for (const pi of [0, 1, 2, 3]) {
    if (!aiPlayers[pi]) {
      const player = gameState.players[pi];
      const level = gameState.currentLevel;

      const bigJ = player.hand.filter(c => c.rank === Rank.BigJoker);
      const smallJ = player.hand.filter(c => c.rank === Rank.SmallJoker);
      const canNT = bigJ.length >= 2 || smallJ.length >= 2;

      const levelCards: { suit: Suit; count: number }[] = [];
      for (const s of [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]) {
        const cnt = player.hand.filter(c => c.suit === s && c.rank === level).length;
        if (cnt > 0) levelCards.push({ suit: s, count: cnt });
      }

      if (canNT || levelCards.length > 0) {
        console.log(`\n${playerName(pi)} 可以亮主:`);
        if (canNT) console.log(`  对王 -> 无主`);
        for (const lc of levelCards) {
          console.log(`  ${suitLabel(lc.suit)}${rankLabel(level)}${lc.count >= 2 ? '(对)' : ''} -> ${suitName(lc.suit)}主`);
        }
        const choice = await ask(`亮主? (输入花色缩写: S/H/C/D, N=无主, 回车跳过): `);
        if (choice) {
          const up = choice.toUpperCase().trim();
          let suit: Suit | null = null;
          if (up === 'N') suit = null;
          else if (up === 'S') suit = Suit.Spades;
          else if (up === 'H') suit = Suit.Hearts;
          else if (up === 'C') suit = Suit.Clubs;
          else if (up === 'D') suit = Suit.Diamonds;
          else { console.log('无效选择'); continue; }

          const before = gameState.currentReveal;
          gameState = tryReveal(gameState, pi, suit);
          if (gameState.currentReveal !== before) {
            console.log(GREEN + '亮主成功!' + RESET);
            showRevealStatus();
          } else {
            console.log('亮主失败（力量不够）');
          }
        }
      }
    }
  }

  gameState = finalizeReveal(gameState, isFirstRound);
  console.log(`\n最终主牌: ${showTrump(gameState.trumpDeclaration!)}`);
  console.log(`庄家: ${playerName(gameState.trumpDeclaration!.declarerIndex)}`);
}

// ---- bottom exchange ----
async function doBottomExchange() {
  console.log('\n' + BOLD + '=== 扣底 ===' + RESET);

  const declarerIdx = gameState.trumpDeclaration!.declarerIndex;
  const declarer = gameState.players[declarerIdx];

  console.log(`庄家: ${playerName(declarerIdx)}`);
  console.log(`底牌 (8张): ${showCards(gameState.bottomCards)}`);

  if (aiPlayers[declarerIdx]) {
    const { discard, reason } = aiChooseBottomCards(declarer.hand, gameState.trumpDeclaration!);
    const newHand = declarer.hand.filter(c => !discard.some(d => d.id === c.id));
    const newPlayers = gameState.players.map((p, i) =>
      i === declarerIdx ? { ...p, hand: [...newHand, ...gameState.bottomCards] } : p,
    ) as any;
    gameState = {
      ...gameState,
      players: newPlayers,
      bottomCards: discard,
      currentPlayerIndex: declarerIdx,
      leadPlayerIndex: declarerIdx,
    };
    if (DEBUG) console.log(CYAN + `AI 扣底理由: ${reason}` + RESET);
  } else {
    const mergedHand = [...declarer.hand, ...gameState.bottomCards];
    gameState = {
      ...gameState,
      players: gameState.players.map((p, i) =>
        i === declarerIdx ? { ...p, hand: mergedHand } : p,
      ) as any,
    };

    showHand(declarerIdx);
    let picked: Card[] = [];
    while (picked.length !== 8) {
      const idxStr = await ask(`选8张牌扣入底牌 (输入编号，空格分隔，已选${picked.length}/8): `);
      const parsed = parseCards(idxStr, gameState.players[declarerIdx].hand, gameState.trumpDeclaration);
      if (parsed.error) {
        console.log(`❌ ${parsed.error}`);
        continue;
      }
      picked = parsed.cards;
      if (picked.length !== 8) {
        console.log(`需要正好8张，已选${picked.length}张`);
      }
    }
    const newHand = mergedHand.filter(c => !picked.some(d => d.id === c.id));
    const newPlayers = gameState.players.map((p, i) =>
      i === declarerIdx ? { ...p, hand: newHand } : p,
    ) as any;
    gameState = {
      ...gameState,
      players: newPlayers,
      bottomCards: picked,
      currentPlayerIndex: declarerIdx,
      leadPlayerIndex: declarerIdx,
    };
  }

  console.log(`扣底完成。庄家现在有 ${gameState.players[declarerIdx].hand.length} 张牌。`);
}

// ---- play phase ----
async function doPlayPhase() {
  let trickNum = 0;

  while (gameState.tricksPlayed < 25) {
    const allEmpty = gameState.players.every(p => p.hand.length === 0);
    if (allEmpty) break;

    trickNum++;
    console.log(`\n${BOLD}=== 第 ${trickNum} 墩 ===${RESET}`);

    for (let i = 0; i < 4; i++) {
      const cp = gameState.currentPlayerIndex;
      if (gameState.players[cp].hand.length === 0) {
        if (DEBUG) console.log(`⚠️ P${cp + 1} 手牌空但仍在回合中，跳过`);
        break;
      }
      try {
        await doPlayerTurn(cp);
      } catch (e) {
        console.log(RED + `\n!!! 程序异常 !!!` + RESET);
        console.log(RED + `${e}` + RESET);
        if (e instanceof Error && e.stack) {
          console.log(DIM + e.stack.split('\n').slice(0, 6).join('\n') + RESET);
        }
        const crashFile = dumpCrash(gameState, aiPlayers, e);
        console.log(YELLOW + `对局信息已转储: ${crashFile}` + RESET);
        return;
      }
      if (gameState.phase === GamePhase.RoundEnd) break;
    }

    if (gameState.phase === GamePhase.RoundEnd) break;

    const lastTrick = gameState.trickHistory[gameState.trickHistory.length - 1];
    console.log(`${playerName(lastTrick.winnerIndex)} 赢了这一墩！(得分: ${lastTrick.points})`);
    console.log(`闲家累计得分: ${gameState.attackerPoints}`);
  }
}


async function doPlayerTurn(playerIndex: number) {
  const player = gameState.players[playerIndex];
  const isLeading = gameState.trickPlays.length === 0;
  const leadLen = isLeading ? 0 : gameState.trickPlays[0].cards.length;
  const config = gameState.trumpDeclaration!;

  if (aiPlayers[playerIndex]) {
    // ====== AI turn ======
    let cards: Card[] = [];
    let reason = '';

    if (isLeading) {
      const ctx = buildAIContext(gameState, playerIndex)!;
      const r = aiLeadPlay(player.hand, ctx);
      cards = r.cards;
      reason = r.reason;
    } else {
      const leadPlay = gameState.trickPlays[0];
      const leadSuit = leadPlay.leadSuit ?? leadPlay.cards[0]?.suit;
      if (!leadSuit) {
        cards = [player.hand[0]];
        reason = '异常领出，随便跟';
      } else {
        const ctx = buildAIContext(gameState, playerIndex)!;
        const r = aiFollowPlay(player.hand, leadPlay.cards, leadSuit, ctx);
        cards = r.cards;
        reason = r.reason;
      }
    }

    if (!cards || cards.length === 0 || cards.some(c => !c)) {
      cards = player.hand.slice(0, Math.max(1, leadLen));
      reason = '空手牌降级';
    }
    if (!isLeading && cards.length !== leadLen) {
      const used = new Set(cards.filter(Boolean).map(c => c.id));
      const extra = player.hand.filter(c => !used.has(c.id));
      cards = [...cards.filter(Boolean), ...extra].slice(0, leadLen);
    }

    const result = playCards(gameState, playerIndex, cards);
    if (result.forcedPlay) {
      // Throw was rejected — engine auto-forced the smallest sub-pattern
      cards = result.forcedPlay;
      reason = result.forceReason || reason;
      gameState = result.state;
      console.log(`${playerName(playerIndex)} 甩牌失败: ${showCards(cards)}`);
    } else if (result.error) {
      const fb = playCards(gameState, playerIndex, player.hand.slice(0, Math.max(1, leadLen)));
      if (fb.error) {
        const fb2 = playCards(gameState, playerIndex, [player.hand[0]]);
        if (fb2.error) {
          console.log(`💀 AI ${playerName(playerIndex)} 崩溃: ${fb2.error}, 跳过`);
          return;
        }
        gameState = fb2.state;
        console.log(`${playerName(playerIndex)} 出: ${showCards([player.hand[0]])}`);
      } else {
        gameState = fb.state;
        console.log(`${playerName(playerIndex)} 出: ${showCards(player.hand.slice(0, Math.max(1, leadLen)))}`);
      }
      if (DEBUG) console.log(DIM + `  (出错: ${result.error})` + RESET);
    } else {
      gameState = result.state;
      console.log(`${playerName(playerIndex)} 出: ${showCards(cards)}`);
    }

    if (DEBUG) console.log(DIM + `  → ${reason}` + RESET);
    if (DEBUG) {
      gameState = { ...gameState, aiReasons: [...gameState.aiReasons, {
        playerIndex, phase: isLeading ? '领出' : '跟牌',
        decision: cards.map(c => c.id).join(','), reason, cards: cards.map(c => c.id),
      }]};
    }

  } else {
    // ====== Human turn ======
    showHand(playerIndex);

    if (isLeading) {
      console.log('你是领出者，请输入要出的牌编号 (空格分隔):');
    } else {
      const leadPlay = gameState.trickPlays[0];
      console.log(`领出: ${playerName(gameState.leadPlayerIndex)} → ${showCards(leadPlay.cards)} (${leadLen}张)`);
      console.log(`你需要跟 ${leadLen} 张牌，编号空格分隔:`);
      showCurrentTrick();
    }

    let ok = false;
    while (!ok) {
      const decl = gameState.trumpDeclaration!;
      const isDecl = playerIndex === decl.declarerIndex;
      const prompt = DEBUG
        ? '编号或 /debug 命令: '
        : isDecl
          ? '编号或 /hint 查看提示、/score 查看得分、/bottom 查看底牌: '
          : '编号或 /hint 查看提示、/score 查看得分: ';
      const input = await ask(prompt);
      if (!input) continue;

      if (input.startsWith('/')) {
        await handleDebugCommand(input, playerIndex);
        if (!isLeading) {
          console.log(`仍需跟 ${leadLen} 张牌:`);
        }
        continue;
      }

      const parsed = parseCards(input, player.hand, gameState.trumpDeclaration);
      if (parsed.error) {
        console.log(`❌ ${parsed.error}`);
        continue;
      }
      const cards = parsed.cards;
      if (cards.length === 0) {
        console.log('未选中任何牌，请重试 (例: 3 7 表示选编号3和7的牌)');
        continue;
      }

      console.log(`已选: ${showCards(cards)} (${cards.length}张)`);

      const result = playCards(gameState, playerIndex, cards);
      if (result.forcedPlay) {
        console.log(YELLOW + `甩牌失败！强制出: ${showCards(result.forcedPlay)}` + RESET);
        console.log(DIM + `  → ${result.forceReason}` + RESET);
        gameState = result.state;
        ok = true;
        continue;
      }
      if (result.error) {
        console.log(`❌ ${result.error}`);
        continue;
      }
      gameState = result.state;
      ok = true;
    }
  }
}

// ---- debug commands ----
async function handleDebugCommand(cmd: string, playerIndex: number) {
  const parts = cmd.trim().split(/\s+/);
  const c = parts[0].toLowerCase();

  // Non-debug mode: only /score, /hint, and /bottom (for declarer only)
  if (!DEBUG) {
    if (c === '/score' || c === '/s') {
      showScoreDetail();
    } else if (c === '/hint' || c === '/tip') {
      showHint(playerIndex);
    } else if (c === '/bottom' || c === '/b') {
      const decl = gameState.trumpDeclaration!;
      if (playerIndex === decl.declarerIndex) {
        showBottom();
      } else {
        console.log('只有庄家可以查看底牌');
      }
    } else {
      console.log('命令不可用。可用: /score, /hint');
    }
    return;
  }

  if (c === '/hand' || c === '/h') {
    const target = parseInt(parts[1]);
    if (isNaN(target) || target < 0 || target > 3) {
      console.log('用法: /hand <0-3>');
    } else {
      showHand(target);
    }
  } else if (c === '/history' || c === '/hist') {
    showHistory();
  } else if (c === '/score' || c === '/s') {
    showScoreDetail();
  } else if (c === '/hint' || c === '/tip') {
    showHint(playerIndex);
  } else if (c === '/bottom' || c === '/b') {
    showBottom();
  } else if (c === '/trick' || c === '/t') {
    showCurrentTrick();
  } else if (c === '/debug' || c === '/d') {
    console.log(`DEBUG=${DEBUG}  人类=${HUMAN_COUNT}  主牌=${showTrump(gameState.trumpDeclaration!)}`);
    console.log(`墩数=${gameState.tricksPlayed}/25  闲家得分=${gameState.attackerPoints}`);
    console.log(`当前玩家=${playerName(gameState.currentPlayerIndex)}`);
    if (gameState.aiReasons.length > 0) {
      console.log('\nAI 日志:');
      for (const r of gameState.aiReasons.slice(-10)) {
        console.log(`  P${r.playerIndex + 1} [${r.phase}] ${r.reason}`);
      }
    }
  } else if (c === '/dump') {
    handleDump();
  } else {
    console.log('未知命令。可用: /hand <n>, /history, /score, /hint, /bottom, /trick, /debug, /dump');
  }
}

// ---- display helpers ----
function showHand(playerIndex: number, highlight: Card[] = []) {
  const player = gameState.players[playerIndex];
  const sorted = sortHand(player.hand, gameState.trumpDeclaration);
  console.log(`\n${BOLD}${playerName(playerIndex)} 的手牌 (${player.hand.length}张):${RESET}`);

  const groups: { label: string; cards: Card[] }[] = [];
  let currentLabel = '';
  let currentGroup: Card[] = [];

  for (const card of sorted) {
    const label = cardGroupLabel(card, gameState.trumpDeclaration);
    if (label !== currentLabel) {
      if (currentGroup.length > 0) groups.push({ label: currentLabel, cards: currentGroup });
      currentLabel = label;
      currentGroup = [];
    }
    currentGroup.push(card);
  }
  if (currentGroup.length > 0) groups.push({ label: currentLabel, cards: currentGroup });

  let globalIdx = 0;
  for (const group of groups) {
    const line = group.cards.map(card => {
      const s = cardStr(card);
      const hl = highlight.some(h => h.id === card.id);
      const idxStr = `[${globalIdx++}]`.padStart(5);
      return hl ? GREEN + idxStr + s + RESET : idxStr + s;
    }).join('');
    console.log(`  ${DIM}${group.label}:${RESET} ${line}`);
  }
}

function cardGroupLabel(card: Card, trump: TrumpDeclaration | null): string {
  if (card.rank === Rank.BigJoker) return '大王';
  if (card.rank === Rank.SmallJoker) return '小王';
  if (!trump) return suitName(card.suit);
  if (card.rank === trump.level) {
    if (card.suit === trump.trumpSuit) return '主级牌';
    return '副级牌';
  }
  if (trump.trumpSuit && card.suit === trump.trumpSuit) return `主${suitName(card.suit)}`;
  return suitName(card.suit);
}

function cardStr(card: Card): string {
  const s = rankLabel(card.rank);
  const suit = card.isJoker ? '' : suitLabel(card.suit);
  const colored = isRed(card) ? RED : '';
  const reset = isRed(card) ? RESET : '';
  return `${colored}${suit}${s}${reset}`;
}

function showCards(cards: Card[]): string {
  return cards.map(cardStr).join(' ');
}

function playerName(idx: number): string {
  const p = gameState.players[idx];
  const icon = aiPlayers[idx] ? '🤖' : '👤';
  return `${icon} ${p.name}`;
}

function showTrump(t: TrumpDeclaration): string {
  if (!t.trumpSuit) return `无主 (级牌${rankLabel(t.level)})`;
  return `${suitLabel(t.trumpSuit)}${rankLabel(t.level)} (${suitName(t.trumpSuit)}主)`;
}

function showBottom() {
  console.log(`底牌: ${showCards(gameState.bottomCards)}`);
}

function showCurrentTrick() {
  if (gameState.trickPlays.length === 0) {
    console.log('当前还没有出牌');
    return;
  }
  for (let i = 0; i < gameState.trickPlays.length; i++) {
    const pi = (gameState.leadPlayerIndex + i) % 4;
    console.log(`  ${playerName(pi)}: ${showCards(gameState.trickPlays[i].cards)}`);
  }
}

function showHistory() {
  if (gameState.trickHistory.length === 0) {
    console.log('还没有打完的墩');
    return;
  }
  console.log(`\n${BOLD}历史出牌 (共${gameState.trickHistory.length}墩):${RESET}`);
  for (let t = 0; t < gameState.trickHistory.length; t++) {
    const trick = gameState.trickHistory[t];
    console.log(`\n--- 第${t + 1}墩 (P${trick.leadPlayerIndex + 1}领出) ---`);
    for (let i = 0; i < 4; i++) {
      const pi = (trick.leadPlayerIndex + i) % 4;
      const isWinner = pi === trick.winnerIndex;
      const marker = isWinner ? ' 👑' : '';
      console.log(`  ${playerName(pi)}: ${showCards(trick.plays[i].cards)}${marker}`);
    }
    if (trick.points > 0) console.log(`  得分: ${trick.points}`);
  }
}

function showScoreDetail() {
  const defenderTeam = gameState.trumpDeclaration!.declarerIndex % 2;
  const attackerTeam = defenderTeam === 0 ? 1 : 0;

  const pointCardsWon = gameState.trickHistory
    .filter(t => t.winnerIndex % 2 === attackerTeam && t.points > 0)
    .flatMap(t => t.plays.flatMap(p => p.cards))
    .filter(c => isPointCard(c.rank));

  console.log(`\n闲家得分: ${gameState.attackerPoints}`);
  console.log(`已拿分数牌 (${pointCardsWon.length}张): ${showCards(pointCardsWon)}`);

  if (DEBUG) {
    console.log(`底牌: ${showCards(gameState.bottomCards)}`);
    let bp = 0;
    for (const c of gameState.bottomCards) bp += cardPoints(c.rank);
    console.log(`底牌分数: ${bp} (×2 = ${bp * 2})`);
  }

  if (gameState.attackerPoints >= 80) console.log(GREEN + '闲家已够80分，升级!' + RESET);
  else if (gameState.attackerPoints >= 40) console.log('闲家40+分，庄家保级');
  else console.log(YELLOW + '闲家不足40分，庄家跳级(小光)!' + RESET);
}

function showHint(playerIndex: number) {
  const player = gameState.players[playerIndex];
  const isLeading = gameState.trickPlays.length === 0;
  const config = gameState.trumpDeclaration!;

  let suggested: Card[] = [];
  let reason = '';

  if (isLeading) {
    const ctx = buildAIContext(gameState, playerIndex)!;
    const r = aiLeadPlay(player.hand, ctx);
    suggested = r.cards;
    reason = r.reason;
  } else if (gameState.trickPlays.length > 0 && gameState.trickPlays[0]?.cards?.length > 0) {
    const leadPlay = gameState.trickPlays[0];
    const suit = leadPlay.leadSuit != null ? leadPlay.leadSuit : leadPlay.cards[0]?.suit;
    const ctx = buildAIContext(gameState, playerIndex)!;
    const r = aiFollowPlay(player.hand, leadPlay.cards, suit, ctx);
    suggested = r.cards;
    reason = r.reason;

    // Safety net: validate the suggestion against engine rules
    const leadPattern = classify(leadPlay.cards, config);
    const vr = validateFollow(suggested, player.hand, leadPlay.cards, leadPattern, suit as any, config);
    if (!vr.valid) {
      console.log(YELLOW + `⚠ 提示校验失败: ${vr.error}，重试...` + RESET);
      // Fallback: just play all lead suit cards (if any) and fill with smallest
      const leadSuitCards = player.hand.filter(c => c.suit === suit && !isTrump(c, config));
      const trumpCards = player.hand.filter(c => isTrump(c, config));
      const groupCards = suit === leadPlay.leadSuit ? [...leadSuitCards, ...trumpCards] : trumpCards;
      if (groupCards.length > 0) {
        groupCards.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
        suggested = [...groupCards.slice(0, Math.min(groupCards.length, leadPlay.cards.length))];
        if (suggested.length < leadPlay.cards.length) {
          const other = player.hand.filter(c => !suggested.includes(c));
          other.sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
          suggested.push(...other.slice(0, leadPlay.cards.length - suggested.length));
        }
      } else {
        const sorted = [...player.hand].sort((a, b) => getEffectiveRank(a, config) - getEffectiveRank(b, config));
        suggested = sorted.slice(0, leadPlay.cards.length);
      }
      reason = '(fallback)';
      const vr2 = validateFollow(suggested, player.hand, leadPlay.cards, leadPattern, suit as any, config);
      if (!vr2.valid) {
        console.log(RED + `✗ 提示失败: ${vr2.error}` + RESET);
        return;
      }
    }
  } else {
    console.log(YELLOW + '当前无可提示' + RESET);
    return;
  }

  console.log(GREEN + `💡 建议出: ${showCards(suggested)}` + RESET);
  console.log(GREEN + `   理由: ${reason}` + RESET);
  showHand(playerIndex, suggested);
}

function showHumanHands() {
  for (const pi of [0, 1, 2, 3]) {
    if (!aiPlayers[pi]) {
      showHand(pi);
    }
  }
}

function showRoundResult(): { changes: { defenderChange: number; attackerChange: number } } {
  const pts = Math.max(0, gameState.attackerPoints);
  console.log('\n' + BOLD + '=== 本局结束 ===' + RESET);
  console.log(`闲家得分: ${pts}`);
  if (gameState.attackerPoints < 0) console.log(DIM + `  (罚分前: ${gameState.attackerPoints})` + RESET);

  console.log('底牌翻出:');
  showBottom();
  let bp = 0;
  for (const c of gameState.bottomCards) bp += cardPoints(c.rank);
  console.log(`底牌分数: ${bp} ×2 = ${bp * 2}`);

  const changes = computeLevelChange(pts);
  const attackerSits = pts >= 80;

  if (attackerSits) {
    const up = changes.attackerChange;
    console.log(GREEN + `闲家上台！${up > 0 ? '升' + up + '级' : '不升级'}` + RESET);
  } else {
    const up = changes.defenderChange;
    const label = up === 3 ? '大光' : up === 2 ? '小光' : '保级';
    console.log(`庄家${label}（升${up}级）`);
  }

  return { changes };
}

// ---- helpers ----
function ask(prompt: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}


// ---- start ----
main().catch(console.error);
