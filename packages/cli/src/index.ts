/**
 * 双升 (拖拉机) CLI version
 * Commands: card indices like "1 3 5", or debug commands starting with /
 * Debug: /hand [n], /tracker [n], /history, /score, /hint, /bottom, /trick, /debug, /dump
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import {
  createFullDeck, shuffle,
  createInitialState, GamePhase,
  tryReveal, finalizeReveal, playCards,
  sortHand, cardPointsFromRank as cardPoints, isPointRank as isPointCard,
  rankLabel, suitLabel, suitName, isRed, isTrump, getEffectiveRank,
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay,
  serialize, deserialize, resumeFromTrick,
  Suit, Rank, validateFollow, validateLead,
  buildAIContext, computeBestSoFar,
  classify,
} from '@poker/engine';
import { computeRoundOutcome } from './round-result.js';
import type { RoundOutcome } from './round-result.js';
import { parseCards, parseHumanCount, parseYesNo, parseSaveChoice, parseTrickNumber, revealLabel } from './parse.js';
import { parseLevelSuit } from './parse-level.js';
import type {
  GameState, PlayerState, TrumpDeclaration, Card, AIReason,
} from '@poker/engine';

const SAVE_DIR = path.join(process.cwd(), 'saves');

/**
 * 组合搜索：从 arr 中找第一个让 valid 返回 true 的 k 张组合（字典序）。
 * 最多尝试 maxCombos 个组合（防止甩牌类大组合数穷举过久），找不到返回 null。
 * 用于 AI 出牌被拒后的降级路径——正常对局中手牌数 ≥ 需出张数时必有合法出牌。
 */
function findValidCombination<T>(
  arr: T[], k: number, valid: (combo: T[]) => boolean, maxCombos = 200000,
): T[] | null {
  if (k <= 0 || k > arr.length) return null;
  let count = 0;
  const chosen: T[] = [];
  let found: T[] | null = null;
  const rec = (start: number): void => {
    if (found || count >= maxCombos) return;
    if (chosen.length === k) {
      count++;
      if (valid(chosen)) found = chosen.slice();
      return;
    }
    for (let i = start; i < arr.length && !found && count < maxCombos; i++) {
      chosen.push(arr[i]);
      rec(i + 1);
      chosen.pop();
    }
  };
  rec(0);
  return found;
}

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
    const saveChoice = parseSaveChoice(loadChoice, saveFiles.length);
    if (saveChoice.warning) console.log(YELLOW + `⚠️ ${saveChoice.warning}` + RESET);
    if (saveChoice.index !== null) {
      resumeFile = saveFiles[saveChoice.index];
      const saved = JSON.parse(fs.readFileSync(resumeFile, 'utf-8'));
      const maxTrick = Number.isFinite(saved.tricksPlayed) ? saved.tricksPlayed : 0;
      const trickInput = await q(`从第几墩继续? (回车=从当前): `);
      const trickChoice = parseTrickNumber(trickInput, maxTrick);
      if (trickChoice.warning) console.log(YELLOW + `⚠️ ${trickChoice.warning}` + RESET);
      resumeFromTrickNum = trickChoice.trick ?? maxTrick;
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
    const hcParsed = parseHumanCount(hc);
    HUMAN_COUNT = hcParsed.count;
    if (hcParsed.warning) console.log(YELLOW + `⚠️ ${hcParsed.warning}` + RESET);
    const dbg = await q('调试模式? (y/n, 默认n): ');
    const dbgChoice = parseYesNo(dbg, false);
    DEBUG = dbgChoice.value;
    if (dbgChoice.warning) console.log(YELLOW + `⚠️ ${dbgChoice.warning}` + RESET);
    const humanSeats: number[] = [];
    for (let i = 0; i < HUMAN_COUNT; i++) humanSeats.push(i);
    aiPlayers = [0, 1, 2, 3].map(i => !humanSeats.includes(i));

    if (DEBUG) console.log(CYAN + '调试模式已开启。可用命令: /hand <0-3>, /history, /score, /hint, /bottom, /dump' + RESET);

    let forcedDeclarer = -1;
    let targetSuit: Suit | null | undefined;
    let targetLevel: number | undefined;
    let autoReveal = false; // only auto-reveal when user explicitly specified suit
    if (DEBUG) {
      const input = await q('首局等级和花色? (如 2C、KNT, 默认2): ');
      const parsed = parseLevelSuit(input);
      targetLevel = parsed.level;
      targetSuit = parsed.suit;
      if (parsed.hasSuit) autoReveal = true;
      if (parsed.warning) console.log(YELLOW + `⚠️ ${parsed.warning}` + RESET);

      const decl = await q('指定庄家? (p0-p3, n=不指定, 回车=自己): ');
      const dp = decl.trim().toUpperCase();
      if (dp === 'N') {
        forcedDeclarer = -1;
      } else if (dp === 'P0' || dp === 'P1' || dp === 'P2' || dp === 'P3') {
        forcedDeclarer = parseInt(dp[1]);
      } else if (dp === '') {
        forcedDeclarer = 0;
      } else {
        console.log(YELLOW + '⚠️ 无效输入，默认自己当庄家' + RESET);
        forcedDeclarer = 0;
      }
    }

    const spectator = aiPlayers.every(v => v);
    await gameLoop(0, 2, spectator, forcedDeclarer, targetSuit, targetLevel, autoReveal);
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
async function gameLoop(
  firstDeclarer: number, currentLevel: number, spectator: boolean,
  forcedDeclarer?: number, targetSuit?: Suit | null, targetLevel?: number,
  autoReveal?: boolean,
): Promise<void> {
  // The declarer (庄家) gets the bottom cards and leads the first trick.
  // In round 1: if someone reveals, they become the declarer; otherwise
  // the firstDeclarer (e.g. P0) becomes the declarer.
  // In subsequent rounds: the declarer is determined by the previous round's
  // result — attacker sits → declarer+1 (other side), defender keeps → declarer+2 (partner).
  let nextDeclarer = firstDeclarer;
  let levelAC = targetLevel ?? currentLevel;
  let levelBD = targetLevel ?? currentLevel;
  let gameOver = false;
  let firstRound = true;
  const matchLogs: string[] = [];

  while (!gameOver) {
    await startNewRound(nextDeclarer, nextDeclarer % 2 === 0 ? levelAC : levelBD, firstRound,
      firstRound ? forcedDeclarer : undefined,
      firstRound ? targetSuit : undefined,
      firstRound ? autoReveal : undefined);
    firstRound = false;

    const result = showRoundResult();
    const changes = result.changes;
    const attackerSits = result.attackerSits; // 含抠底的闲家最终分 ≥ 80（与等级变更同口径）
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
      const ansChoice = parseYesNo(ans, true);
      if (ansChoice.warning) console.log(YELLOW + `⚠️ ${ansChoice.warning}` + RESET);
      if (!ansChoice.value) break;
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

// ---- deck rigging for debug ----
function rigDeck(declarerIdx: number, targetSuit: Suit | null, level: number): Card[] {
  const deck = shuffle(createFullDeck());

  const needed: Card[] = [];
  if (targetSuit === null) {
    // NT: BigJoker pair or SmallJoker pair (random)
    const bj = deck.filter(c => c.rank === Rank.BigJoker);
    const sj = deck.filter(c => c.rank === Rank.SmallJoker);
    const pick = Math.random() < 0.5 ? bj.slice(0, 2) : sj.slice(0, 2);
    needed.push(...pick);
  } else {
    // Suited: 1 or 2 level cards of target suit (random)
    const cards = deck.filter(c => c.suit === targetSuit && c.rank === level);
    const count = Math.random() < 0.5 && cards.length >= 2 ? 2 : 1;
    needed.push(...cards.slice(0, count));
  }

  // Swap needed cards into declarer's positions (round-robin deal order)
  for (let i = 0; i < needed.length; i++) {
    const targetIdx = declarerIdx + i * 4;
    const currentIdx = deck.findIndex(c => c.id === needed[i].id);
    if (currentIdx !== targetIdx) {
      [deck[targetIdx], deck[currentIdx]] = [deck[currentIdx], deck[targetIdx]];
    }
  }
  return deck;
}

// ---- game round ----
async function startNewRound(
  declarerIndex: number, currentLevel: number, isFirstRound: boolean,
  forcedDeclarer?: number, targetSuit?: Suit | null,
  autoReveal?: boolean,
) {
  const useRigged = forcedDeclarer !== undefined && forcedDeclarer >= 0;
  const rigSuit = targetSuit !== undefined ? targetSuit
    : useRigged ? (Math.random() < 0.2 ? null : [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds][Math.floor(Math.random() * 4)]) as Suit | null
    : undefined;
  deck = useRigged
    ? rigDeck(forcedDeclarer, rigSuit!, currentLevel)
    : shuffle(createFullDeck());

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
  // When forcedDeclarer is set, also defer AI reveal.
  const skipAiRevealInDeal = (DEBUG && declarerIndex === 0)
    || (forcedDeclarer !== undefined && forcedDeclarer >= 0);

  await doDeal(skipAiRevealInDeal);

  // Auto-reveal only when user explicitly chose a suit
  if (autoReveal && forcedDeclarer !== undefined && forcedDeclarer >= 0
    && targetSuit !== undefined) {
    gameState = tryReveal(gameState, forcedDeclarer, targetSuit);
  }

  await doReveal(isFirstRound, autoReveal ? forcedDeclarer : undefined);
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
  console.log(CYAN + `  当前主: ${revealLabel(rev, gameState.currentLevel)} (由 ${playerName(rev.playerIndex)} 亮)` + RESET);
}

// ---- reveal ----
async function doReveal(isFirstRound: boolean, skipPlayer?: number) {
  console.log('\n' + BOLD + '=== 亮主阶段 ===' + RESET);
  if (gameState.currentReveal) {
    showRevealStatus();
  } else {
    console.log('无人亮主，将由庄家叫主。');
  }

  for (const pi of [0, 1, 2, 3]) {
    if (pi === skipPlayer) continue;
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
          else { console.log(YELLOW + '⚠️ 无效选择 (S/H/C/D/N)' + RESET); continue; }

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
      // AI 出牌被拒。正常对局中手牌数 ≥ 需出张数时必有合法出牌，走到这里说明
      // AI 出牌非法或牌局状态异常。逐级降级：手牌前 leadLen 张 → 暴力搜索任意
      // 合法组合。全部失败则抛错终止（外层 catch 转储现场）——不能静默跳过，
      // 那会让本墩永远无法推进而陷入死循环。
      const first = playCards(gameState, playerIndex, player.hand.slice(0, Math.max(1, leadLen)));
      let fallback: Card[] | null = null;
      if (!first.error) {
        fallback = player.hand.slice(0, Math.max(1, leadLen));
      } else {
        fallback = findValidCombination(player.hand, leadLen, (combo) => {
          const r = playCards(gameState, playerIndex, combo);
          return !r.error && !r.forcedPlay;
        });
      }
      if (fallback) {
        const fb = playCards(gameState, playerIndex, fallback);
        if (fb.error || fb.forcedPlay) {
          throw new Error(
            `AI ${playerName(playerIndex)} 降级出牌被拒: ${fb.error ?? fb.forceReason}` +
            `（手牌 ${player.hand.length} 张，需出 ${leadLen} 张）`,
          );
        }
        gameState = fb.state;
        cards = fallback;
        reason = '降级出牌';
        console.log(`${playerName(playerIndex)} 出: ${showCards(fallback)}`);
      } else {
        throw new Error(
          `AI ${playerName(playerIndex)} 无法出牌: ${first.error}` +
          `（手牌 ${player.hand.length} 张，需出 ${leadLen} 张）— 牌局状态异常，对局终止`,
        );
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
    const target = playerNum(parts[1]);
    if (target < 0) {
      // No valid index — show all players' hands
      for (let i = 0; i < 4; i++) showHand(i);
    } else {
      showHand(target);
    }
  } else if (c === '/tracker' || c === '/tr') {
    // /tracker accepts 1-4 (external), converts to 0-3 internally
    showNTracker(parts[1] ? String(playerNum(parts[1])) : undefined);
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
    console.log('未知命令。可用: /hand [n], /tracker [n], /history, /score, /hint, /bottom, /trick, /debug, /dump');
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

/** Convert a possible-trump key like "S-2" to display format "♠2", with color. */
function possibleTrumpLabel(key: string): string {
  const idx = key.indexOf('-');
  const suit = key.slice(0, idx);
  const rank = parseInt(key.slice(idx + 1), 10);
  const symbol = suitLabel(suit as any) + rankLabel(rank as any);
  const red = suit === 'H' || suit === 'D' || rank === 16; // BigJoker red, SmallJoker black
  return red ? RED + symbol + RESET : symbol;
}

/** Sort priority for possible-trump keys: BigJoker > SmallJoker > S > H > C > D. */
function possibleTrumpSortKey(key: string): number {
  if (key.startsWith('J-16')) return 0; // BigJoker
  if (key.startsWith('J-15')) return 1; // SmallJoker
  return { S: 2, H: 3, C: 4, D: 5 }[key[0] as string] ?? 9;
}

function showCards(cards: Card[]): string {
  return cards.map(cardStr).join(' ');
}

function playerName(idx: number): string {
  const p = gameState.players[idx];
  const icon = aiPlayers[idx] ? '🤖' : '👤';
  return `${icon} ${p.name}`;
}

/** Display label for a player: "玩家1" or "AI-2". */
function playerLabel(idx: number): string {
  return aiPlayers[idx] ? `AI-${idx + 1}` : `玩家${idx + 1}`;
}

/** Convert external player number (1-4) to internal index (0-3). */
function playerNum(arg: string): number {
  const n = parseInt(arg);
  if (isNaN(n) || n < 1 || n > 4) return -1;
  return n - 1;
}

function showTrump(t: TrumpDeclaration): string {
  if (!t.trumpSuit) return `无主 (级牌${rankLabel(t.level)})`;
  return `${suitLabel(t.trumpSuit)}${rankLabel(t.level)} (${suitName(t.trumpSuit)}主)`;
}

function showBottom() {
  console.log(`底牌: ${showCards(gameState.bottomCards)}`);
}

function showNTracker(targetStr?: string) {
  const decl = gameState.trumpDeclaration;
  if (!decl || decl.trumpSuit !== null) {
    console.log('记牌器仅在无主模式下可用');
    return;
  }

  const target = parseInt(targetStr ?? '');
  if (!isNaN(target) && target >= 0 && target <= 3) {
    showOneTracker(target);
  } else {
    for (let i = 0; i < 4; i++) showOneTracker(i);
  }
}

function showOneTracker(playerIndex: number) {
  const ctx = buildAIContext(gameState, playerIndex);
  if (!ctx || !ctx.ntState) {
    console.log(`${playerLabel(playerIndex)}: 记牌器数据不可用`);
    return;
  }
  const s = ctx.ntState;

  console.log(`\n${BOLD}${playerName(playerIndex)} 的常主记牌器:${RESET}`);

  // My known trumps
  const myTrumps = s.knownTrumpsPerPlayer[playerIndex];
  if (myTrumps.length > 0) {
    console.log(`  手牌常主 (${myTrumps.length}张): ${showCards([...myTrumps])}`);
  } else {
    console.log('  手牌常主: 无');
  }

  // Possible trumps per player and bottom
  const bottomLabel = ctx.isDeclarer ? '底牌(已知)' : '底牌';
  for (const [idx, label] of [[0, playerLabel(0)], [1, playerLabel(1)], [2, playerLabel(2)], [3, playerLabel(3)], [4, bottomLabel]] as const) {
    if (idx === playerIndex) continue; // skip self
    const rec = s.possibleTrumps[idx];
    if (rec === null) {
      console.log(`  ${label}可能常主: (已知,不追踪)`);
    } else {
      const total = Object.values(rec).reduce((a, b) => a + b, 0);
      if (total === 0) {
        console.log(`  ${label}可能常主: 无`);
      } else {
        const parts = Object.entries(rec)
          .filter(([, n]) => n > 0)
          .sort(([a], [b]) => possibleTrumpSortKey(a) - possibleTrumpSortKey(b))
          .map(([k, n]) => {
            const display = possibleTrumpLabel(k);
            return n > 1 ? Array(n).fill(display).join(' ') : display;
          });
        console.log(`  ${label}可能常主 (${total}张): ${parts.join(' ')}`);
      }
    }
  }

  // Summary line
  const flags: string[] = [];
  for (let p = 0; p < 4; p++) {
    if (s.playersWithNoTrump.has(p)) flags.push(`${playerLabel(p)}无主`);
  }
  if (s.isFullyDetermined) flags.push('分布已确定');
  if (s.allUnseenJokersOnOurSide) flags.push('剩余王全在我方');
  if (s.allUnseenBigJokersOnOurSide) flags.push('剩余大王全在我方');
  if (flags.length > 0) console.log(`  ${DIM}${flags.join(' | ')}${RESET}`);

  // Detail: canFormPair, canHaveJoker etc.
  const detailParts: string[] = [];
  for (let p = 0; p < 4; p++) {
    if (p === playerIndex) continue;
    const parts: string[] = [];
    if (s.canFormPair[p]) parts.push('有对');
    if (s.canHaveBigJoker[p]) parts.push('可能有大王');
    if (s.canHaveSmallJoker[p]) parts.push('可能有小王');
    if (parts.length > 0) detailParts.push(`${playerLabel(p)}: ${parts.join(', ')}`);
  }
  if (detailParts.length > 0) console.log(`  ${DIM}${detailParts.join(' | ')}${RESET}`);

  // Counts
  const countParts = [];
  for (let p = 0; p < 4; p++) {
    if (p === playerIndex) continue;
    countParts.push(`${playerLabel(p)} ${s.minTrumpCounts[p]}-${s.maxTrumpCounts[p]}张`);
  }
  console.log(`  ${DIM}对手常主 ≥${s.opponentTrumpCount}张 | 剩余王: 大${s.remainingBigJokers} 小${s.remainingSmallJokers} | ${countParts.join(', ')}${RESET}`);
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

function showRoundResult(): RoundOutcome {
  // 统一口径（含抠底的闲家最终分）：computeRoundOutcome 是上台判定/等级变更的唯一来源
  const outcome = computeRoundOutcome(
    gameState.attackerPoints,
    gameState.bottomCards,
    gameState.trickHistory[gameState.trickHistory.length - 1] ?? null,
    gameState.trumpDeclaration,
    gameState.trumpDeclaration!.declarerIndex, // 实际庄家（首局亮主者可能顶替预定庄家）
  );
  const { multiplier: mult, bottomPoints: bp, finalPts: pts, attackerWonLast, attackerSits, changes } = outcome;
  console.log('\n' + BOLD + '=== 本局结束 ===' + RESET);
  console.log(`闲家得分: ${gameState.attackerPoints}`);
  if (gameState.attackerPoints < 0) console.log(DIM + `  (罚分前: ${gameState.attackerPoints})` + RESET);

  console.log('底牌翻出:');
  showBottom();
  const multLabel = mult === 2 ? '×2' : `×${mult}`;
  console.log(`底牌分数: ${bp} ${multLabel} = ${bp * mult}`);

  if (attackerWonLast && bp > 0) {
    console.log(`抠底加分: ${bp * mult} → 终分 ${pts}`);
  }

  if (!attackerSits && gameState.attackerPoints >= 80) {
    // Attacker had 80+ but fell below after penalties — shouldn't happen in normal play
    console.log(DIM + `  (罚分后不足80分，未能上台)` + RESET);
  }

  if (attackerSits) {
    const up = changes.attackerChange;
    console.log(GREEN + `闲家上台！${up > 0 ? '升' + up + '级' : '不升级'}` + RESET);
  } else {
    const up = changes.defenderChange;
    const label = up === 3 ? '大光' : up === 2 ? '小光' : '保级';
    console.log(`庄家${label}（升${up}级）`);
  }

  return outcome;
}

// ---- helpers ----
function ask(prompt: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}


// ---- start ----
main().catch(console.error);
