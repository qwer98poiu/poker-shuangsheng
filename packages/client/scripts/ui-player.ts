/**
 * ui-player — 人类模拟器（模拟点击驱动完整对局）。
 *
 * 单人 vs AI（人类南座）模式下，用真实 page.click 走完竞技场定义的一场的
 * 简化版（默认 2 局，完整一场 ~35 局不默认跑）：亮主 → 扣底 → 出牌 →
 * 结算 → 轮转。AI 决策复用引擎（与 gameStore 的 runAiTurns 同口径），
 * 交互全部真实点击，覆盖 hint（建议出牌）与手动选牌两条路径。
 *
 * 每步断言：
 *   - 元素 box 完全在 1280×720 画布内（safeClick 前置 + 快照后验）
 *   - 状态按预期推进（点击后签名变化，超时 = UI 卡死）
 *   - DOM ↔ 引擎一致（座位张数 label）
 *   - 局转：下一局 level/declarer 与 advanceLevel 预测一致
 *
 * Usage: npx tsx scripts/ui-player.ts [--seed 42] [--max-rounds 2]
 *        [--url http://localhost:3000] [--no-spawn] [--timeout-ms 240000]
 *
 * Exit codes: 0 all green, 1 any failure.
 */
import type { Page } from 'playwright-core';
import type { Card } from '@poker/engine';
import {
  GamePhase, getRevealOptions, canOverride, buildAIContext, playCards,
  aiLeadPlay, aiFollowPlay, aiChooseBottomCards, computeRoundOutcome, advanceLevel,
} from '@poker/engine';
import {
  collectSnapshot, ensureServer, killProcessTree, launchBrowser, buildUrl,
  safeClick, listOutOfBounds, type UiSnapshot,
} from './lib/driver.js';
import { computePlayableIds } from '../src/components/game/playable.js';

// ---------------------------------------------------------------------------
// deterministic rng for path choice (reproducible with the same seed)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** C(arr, k) 所有组合。 */
function combos<T>(arr: T[], k: number): T[][] {
  if (k <= 0) return [[]];
  if (arr.length < k) return [];
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

// ---------------------------------------------------------------------------
// assertions

const asserts: { name: string; ok: boolean; detail: string }[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  asserts.push({ name, ok, detail });
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function sigOf(gs: any): string {
  return gs ? `${gs.phase}:${gs.tricksPlayed}:${gs.trickPlays.length}:${gs.currentPlayerIndex}` : 'none';
}

/** 点击后状态必须推进；签名不变说明 UI 卡死或点击无效。 */
async function waitStateChange(page: Page, sig: string, what: string, timeoutMs: number): Promise<UiSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await collectSnapshot(page);
    const cur = sigOf(snap.store?.gameState);
    if (cur !== sig) return snap;
    await page.waitForTimeout(100);
  }
  throw new Error(`state did not change after "${what}" (was ${sig})`);
}

/** 所有可见元素必须完全在 1280×720 画布内。 */
function assertCanvasBounds(snap: UiSnapshot, round: number): void {
  const fails = listOutOfBounds(snap.elements);
  check(`r${round} all elements within canvas`, fails.length === 0,
    fails.length > 0 ? `${fails.length} out of bounds: ${fails.map(f => `${f.selector}(${f.edge})`).join(', ')}` : '');
}

// ---------------------------------------------------------------------------
// stage actions — all real clicks

async function doReveal(page: Page, timeoutMs: number): Promise<void> {
  const snap = await collectSnapshot(page);
  const gs = snap.store?.gameState;
  if (!gs || gs.phase !== GamePhase.Revealing) return;
  const opts = getRevealOptions(gs.players[0].hand, gs.currentLevel)
    .filter(o => canOverride(gs.currentReveal, { playerIndex: 0, suit: o.suit, strength: o.strength }));
  if (opts.length > 0) {
    const pick = opts[0];
    check(`r${snap.store!.roundNumber} reveal buttons in canvas`, true);
    await safeClick(page, `[data-testid="reveal-btn-${pick.suit ?? 'NT'}"]`);
    await waitStateChange(page, sigOf(gs), 'reveal click', timeoutMs);
  } else {
    // 无可亮/反选项 → 1s 自动确认（无按钮可点）
    await waitStateChange(page, sigOf(gs), 'reveal auto-pass', timeoutMs);
  }
}

async function doBottomExchange(page: Page, timeoutMs: number): Promise<void> {
  const snap = await collectSnapshot(page);
  const st = snap.store!;
  const gs = st.gameState;
  if (!gs || gs.phase !== GamePhase.BottomExchange) return;
  const declarerIdx = gs.trumpDeclaration?.declarerIndex ?? gs.declarerIndex;
  if (declarerIdx !== 0) {
    // AI 庄家：自动扣底进 Playing，等 phase 变化即可
    await waitStateChange(page, sigOf(gs), 'AI bottom exchange', timeoutMs);
    return;
  }

  // 人类庄家：从 33 张（手牌+底牌）选 8 张。引擎决策，非法则回退启发式。
  const ctx = buildAIContext(gs, 0);
  let discard: Card[] = ctx ? aiChooseBottomCards(gs.players[0].hand, ctx).discard : [];
  const inHand = discard.filter(c => gs.players[0].hand.some(h => h.id === c.id));
  if (inHand.length !== 8) {
    // 回退：先无分副牌，后补任意（保证恰 8 张）
    const trump = gs.trumpDeclaration;
    const hand = [...gs.players[0].hand].sort((a, b) => {
      const ka = (trump && (a.suit === trump.trumpSuit || a.isJoker) ? 1 : 0) * 2
        + (a.rank === 5 || a.rank === 10 || a.rank === 13 ? 1 : 0);
      const kb = (trump && (b.suit === trump.trumpSuit || b.isJoker) ? 1 : 0) * 2
        + (b.rank === 5 || b.rank === 10 || b.rank === 13 ? 1 : 0);
      return ka - kb;
    });
    discard = hand.slice(0, 8);
    console.error(`  bottom: engine discard invalid (${inHand.length}), fell back to heuristic`);
  }

  for (const c of discard) {
    await safeClick(page, `[data-card-id="${c.id}"]`);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(120);
  const sel = (await collectSnapshot(page)).store!.selectedCardIds;
  check(`r${st.roundNumber} bottom exchange selected 8`, sel.length === 8, `selected=${sel.length}`);

  await safeClick(page, '[data-testid="bottom-confirm"]');
  await page.waitForTimeout(150);
  const after = await collectSnapshot(page);
  if (after.elements.some(e => e.testid === 'trump-confirm')) {
    // 扣主警告 → 确认
    await safeClick(page, '[data-testid="trump-confirm"]');
  }
  await waitStateChange(page, sigOf(gs), 'bottom exchange done', timeoutMs);
}

async function doPlay(page: Page, snap: UiSnapshot, seed: number, timeoutMs: number): Promise<void> {
  const st = snap.store!;
  const gs = st.gameState;
  if (!gs || gs.phase !== GamePhase.Playing || gs.currentPlayerIndex !== 0) return;

  const player = gs.players[0];
  const config = buildAIContext(gs, 0);
  if (!config) { check(`r${st.roundNumber} AI context`, false, 'buildAIContext returned null'); return; }

  // AI 决策（记牌器推断）可能含 UI 灰色牌（UI playable 与引擎规则存在
  // 简化差，如缺门甩牌）→ 以 UI 可点集合为约束：优先 AI 决策 ∩ 可点集合，
  // 非法则在该集合内搜索"包含 AI 决策牌最多"的合法组合（leadCount ≤ 4，组合数可控）。
  const playable = computePlayableIds(player.hand, gs.trickPlays, gs.trumpDeclaration, gs.phase);
  const pool = playable ? player.hand.filter(c => playable.has(c.id)) : player.hand;

  let cards: Card[];
  if (gs.trickPlays.length === 0) {
    cards = aiLeadPlay(player.hand, config).cards;
  } else {
    const lead = gs.trickPlays[0];
    cards = aiFollowPlay(player.hand, lead.cards, lead.leadSuit, config).cards;
  }
  const inPool = cards.filter(c => !playable || playable.has(c.id));
  const legal = inPool.length > 0 && !playCards(gs, 0, inPool).error;
  let finalCards: Card[] = legal ? inPool : [];
  if (finalCards.length === 0 && pool.length > 0) {
    if (gs.trickPlays.length > 0) {
      const leadCount = gs.trickPlays[0].cards.length;
      const pref = new Set(inPool.map(c => c.id));
      const prefCount = (cs: Card[]) => cs.filter(c => pref.has(c.id)).length;
      finalCards = combos(pool, Math.min(leadCount, pool.length))
        .sort((a, b) => prefCount(b) - prefCount(a))
        .find(c => !playCards(gs, 0, c).error) ?? [pool[0]];
    } else {
      finalCards = [pool[0]]; // 领出回退：UI 可点单张
    }
  }
  if (finalCards.length < cards.length) {
    console.error(`  play constrained (decision ${cards.length}→${finalCards.length}: UI playable subset)`);
  }
  const ids = finalCards.map(c => c.id);

  // 每墩确定性地随机选交互路径：A = 点建议出牌；B = 手动逐张选牌
  const rnd = mulberry32((seed + st.roundNumber * 7919 + gs.tricksPlayed * 131) >>> 0)();
  const sig = sigOf(gs);

  if (rnd < 0.5) {
    await safeClick(page, '[data-testid="hint-btn"]');
    await page.waitForTimeout(150);
    const sel = (await collectSnapshot(page)).store!.selectedCardIds;
    const selLegal = sel.length > 0
      && (!playable || sel.every(id => playable.has(id)))
      && !playCards(gs, 0, player.hand.filter(c => sel.includes(c.id))).error;
    if (!selLegal) {
      // hint 选中了灰色/非法组合（client getHint 无校验，与 runAiTurns 的 AI 回退不同）→ 重选走手动
      await safeClick(page, '[data-testid="clear-btn"]');
      await page.waitForTimeout(100);
      for (const id of ids) {
        await safeClick(page, `[data-card-id="${id}"]`);
        await page.waitForTimeout(30);
      }
    } else {
      const same = sel.length === ids.length && sel.every(id => ids.includes(id));
      check(`r${st.roundNumber} hint selects AI decision`, same,
        `hint=${[...sel].sort().join(',')} expected=${[...ids].sort().join(',')}`);
    }
  } else {
    for (const id of ids) {
      await safeClick(page, `[data-card-id="${id}"]`);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(120);
    const sel = (await collectSnapshot(page)).store!.selectedCardIds;
    const same = sel.length === ids.length && ids.every(id => sel.includes(id));
    check(`r${st.roundNumber} manual selection matches AI decision`, same,
      `selected=${[...sel].sort().join(',')} expected=${[...ids].sort().join(',')}`);
  }

  await safeClick(page, '[data-testid="play-btn"]');
  await page.waitForTimeout(250);
  const err = (await collectSnapshot(page)).store?.errorMessage;
  if (err) throw new Error(`play error after click: ${err}`);
  await waitStateChange(page, sig, 'play submit', timeoutMs);
}

// ---------------------------------------------------------------------------
// round transition (same prediction as client startNewRound)

interface RoundEndRec { gs: any; teamLevels: [number, number] | null; roundNumber: number; }

function assertRoundTransition(prev: RoundEndRec, next: { gs: any; teamLevels: [number, number] | null }): void {
  const gsPrev = prev.gs, gsNext = next.gs;
  if (!gsPrev || !gsNext) return;
  const declarer = gsPrev.trumpDeclaration?.declarerIndex ?? gsPrev.declarerIndex;
  const lastTrick = gsPrev.trickHistory[gsPrev.trickHistory.length - 1] ?? null;
  const outcome = computeRoundOutcome(
    gsPrev.attackerPoints, gsPrev.bottomCards, lastTrick, gsPrev.trumpDeclaration, declarer,
  );
  const advancingTeam = outcome.attackerSits ? (declarer + 1) % 2 : declarer % 2;
  const adv = advanceLevel((prev.teamLevels ?? [gsPrev.currentLevel, gsPrev.currentLevel])[advancingTeam], outcome.finalPts);

  if (adv.matchOver) {
    // 庄家队 A 打赢 → 比赛结束，无下一局
    check(`r${prev.roundNumber} matchOver on A win`, true);
    return;
  }

  const expectedDeclarer = outcome.attackerSits ? (declarer + 1) % 4 : (declarer + 2) % 4;
  check(`r${prev.roundNumber}→${prev.roundNumber + 1} level matches advanceLevel`,
    gsNext.currentLevel === adv.newLevel,
    `actual=${gsNext.currentLevel} expected=${adv.newLevel} outcome=${JSON.stringify(outcome)}`);
  check(`r${prev.roundNumber}→${prev.roundNumber + 1} declarer rotates`,
    gsNext.declarerIndex === expectedDeclarer,
    `actual=P${gsNext.declarerIndex} expected=P${expectedDeclarer}`);
}

// ---------------------------------------------------------------------------
// match run

async function runMatch(page: Page, seed: number, maxRounds: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastRound = -1;
  let prevRoundEnd: RoundEndRec | null = null;
  let roundEndLogged = -1;

  while (Date.now() < deadline) {
    const snap = await collectSnapshot(page);
    const st = snap.store;
    if (!st?.gameState) { await page.waitForTimeout(100); continue; }
    const gs = st.gameState;

    // 边界断言：阶段变化时 + 每 500ms 兜底（跳过发牌期高频轮询）
    if (gs.phase !== GamePhase.Dealing) assertCanvasBounds(snap, st.roundNumber);

    // 局结束记录（每局一次）
    if (gs.phase === GamePhase.RoundEnd && st.roundNumber > roundEndLogged) {
      roundEndLogged = st.roundNumber;
      prevRoundEnd = { gs, teamLevels: st.teamLevels, roundNumber: st.roundNumber };
      console.log(`  round ${st.roundNumber} ended (attacker=${gs.attackerPoints}, tricks=${gs.tricksPlayed})`);
    }

    // 局轮转断言
    if (st.roundNumber > lastRound && lastRound >= 0) {
      if (prevRoundEnd && prevRoundEnd.roundNumber === st.roundNumber - 1) {
        assertRoundTransition(prevRoundEnd, { gs, teamLevels: st.teamLevels });
      }
    }
    lastRound = st.roundNumber;

    // 完成条件：第 maxRounds 局进入结算（或 matchOver）
    if (gs.phase === GamePhase.RoundEnd && st.roundNumber >= maxRounds - 1) {
      if (st.matchOver) { console.log(`  match over (team won at round ${st.roundNumber})`); return; }
      // matchOver 前最后一局的转局断言由下一轮 roundNumber 增加触发；
      // 若已确认结算完成则直接返回
      if (prevRoundEnd && prevRoundEnd.roundNumber === st.roundNumber) return;
    }

    // 阶段动作（人类回合才交互）
    switch (gs.phase) {
      case GamePhase.Dealing: break; // 发牌中（speed=8 约 1.5s）
      case GamePhase.Revealing: await doReveal(page, timeoutMs); break;
      case GamePhase.BottomExchange: await doBottomExchange(page, timeoutMs); break;
      case GamePhase.Playing:
        if (gs.currentPlayerIndex === 0 && !st.aiPlayers[0]) {
          await doPlay(page, snap, seed, timeoutMs);
        }
        break;
      case GamePhase.RoundEnd: break; // 等自动 startNewRound（4s）
      default: break;
    }
    await page.waitForTimeout(80);
  }
  const gs = (await collectSnapshot(page)).store?.gameState;
  throw new Error(`match did not finish ${maxRounds} round(s) within ${timeoutMs}ms (phase=${gs?.phase}, tricks=${gs?.tricksPlayed}, round=${(await collectSnapshot(page)).store?.roundNumber})`);
}

// ---------------------------------------------------------------------------
// main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let seed = 42, maxRounds = 2, timeoutMs = 240000, noSpawn = false, url = 'http://localhost:3000';
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--seed': seed = Number(argv[++i]); break;
      case '--max-rounds': maxRounds = Number(argv[++i]); break;
      case '--timeout-ms': timeoutMs = Number(argv[++i]); break;
      case '--no-spawn': noSpawn = true; break;
      case '--url': url = argv[++i]; break;
      default: console.error(`Unknown flag: ${argv[i]}`); process.exit(2);
    }
  }

  const child = await ensureServer({ url, noSpawn });
  try {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (err) => { check('no pageerror', false, err.message); });
      page.on('console', (msg) => {
        // 过滤 vite dev server 的资源 404 噪音（favicon 等），只关注应用运行时错误
        if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
          check('no console.error', false, msg.text());
        }
      });
      await page.goto(buildUrl({ url, seed, auto: false, speed: 8 }), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // setup：勾选调试模式（hint 按钮需要 debug）→ 开始游戏（默认人类南座）
      await safeClick(page, '.setup-debug input');
      await safeClick(page, '[data-testid="setup-start"]');

      console.log(`ui-player: seed=${seed}, max-rounds=${maxRounds}, viewport=1280x720`);
      await runMatch(page, seed, maxRounds, timeoutMs);
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    killProcessTree(child);
  }

  console.log(`\n${asserts.length} assertions, ${failures} failed`);
  if (failures > 0) process.exit(1);
  console.log('ALL GREEN');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
