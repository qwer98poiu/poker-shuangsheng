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
 * Usage: npx tsx scripts/ui-player.ts [--seed 42] [--max-rounds 2] [--speed 8]
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
    console.error(`  reveal r${snap.store!.roundNumber}: click ${pick.suit ?? 'NT'}`);
    await safeClick(page, `[data-testid="reveal-btn-${pick.suit ?? 'NT'}"]`);
    await waitStateChange(page, sigOf(gs), 'reveal click', timeoutMs);
  } else {
    // 无可亮/反选项 → 1s 自动确认（无按钮可点）
    console.error(`  reveal r${snap.store!.roundNumber}: no options, wait auto-pass`);
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

  console.error(`  bottom r${st.roundNumber}: click ${discard.map(c => c.id).join(',')}`);
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

/**
 * 以一定概率（15%）展开调试菜单、随机点一个功能（导出/展开 AI 日志），
 * 然后关闭——验证菜单交互且展开不覆盖手牌（不影响后续出牌）。
 */
async function maybeUseDebugMenu(page: Page, snap: UiSnapshot, seed: number): Promise<void> {
  const st = snap.store!;
  const gs = st.gameState;
  const rnd = mulberry32((seed + st.roundNumber * 7919 + gs.tricksPlayed * 131 + 777) >>> 0)();
  if (rnd >= 0.15) return;
  const check = await collectSnapshot(page);
  if (!check.elements.some(e => e.testid === 'debug-menu' && e.visible)) return; // 非调试模式
  await safeClick(page, '[data-testid="debug-menu"] > summary');
  await page.waitForTimeout(150);
  // 菜单内功能：导出（clipboard）+ AI 日志折叠
  if (rnd < 0.5) {
    await safeClick(page, '[data-testid="export-btn"]');
  } else {
    const log = await collectSnapshot(page);
    const aiLog = log.elements.find(e => e.cls.includes('ai-log') && e.tag === 'summary');
    if (aiLog) await safeClick(page, '.ai-log > summary');
  }
  await page.waitForTimeout(100);
  await safeClick(page, '[data-testid="debug-menu"] > summary'); // 关闭
  console.error('  [dbg-menu] opened, used a feature, closed');
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
    const lead = gs.trickPlays[0];
    console.error(`  play constrained (t${gs.tricksPlayed} lead=${lead ? lead.cards.map(c => c.id).join(',') : '-'} decision=${cards.map(c => c.id).join(',')} playable=${playable ? [...playable].join(',') : 'null'} inPool=${inPool.map(c => c.id).join(',')} final=${finalCards.map(c => c.id).join(',')} err=${playCards(gs, 0, inPool).error ?? '-'})`);
  }
  const ids = finalCards.map(c => c.id);

  // 每墩确定性地随机选交互路径：A = 点建议出牌；B = 手动逐张选牌
  const rnd = mulberry32((seed + st.roundNumber * 7919 + gs.tricksPlayed * 131) >>> 0)();
  const sig = sigOf(gs);
  console.error(`  play r${st.roundNumber} t${gs.tricksPlayed}: ${ids.join(',')} via ${rnd < 0.5 ? 'hint' : 'manual'}`);

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
  let lastTrick = -1;
  let prevRoundEnd: RoundEndRec | null = null;
  let roundEndLogged = -1;

  while (Date.now() < deadline) {
    // 轻量读取（~1ms）：高频率全量 DOM 快照会占满页面主线程，游戏定时器饥饿。
    // 只在墩推进/局结束/人类回合时做全量 collectSnapshot。
    const light = await page.evaluate((): any => {
      const st = (window as any).__POKER_STORE__?.getState?.();
      const gs = st?.gameState;
      if (!gs) return null;
      return {
        phase: gs.phase, roundNumber: st.roundNumber, tricks: gs.tricksPlayed,
        current: gs.currentPlayerIndex, matchOver: !!st.matchOver, humanSeat: !st.aiPlayers[0],
        // 页面内 zustand subscribe 同步捕获的上一局结算快照（round_end 窗口短，
        // 外部轮询常错过；subscribe 回调在 set 内同步执行，不丢）
        lastRoundEndSeen: (window as any).__POKER_LAST_ROUND_END__?.roundNumber ?? -1,
      };
    });

    if (light) {
      const round = light.roundNumber;

      // 墩推进 → 全量断言（所有元素在画布内）
      if (light.tricks > lastTrick) {
        lastTrick = light.tricks;
        const snap = await collectSnapshot(page);
        assertCanvasBounds(snap, round);
      }

      // 局结束记录（页面内 hook 捕获，同步可靠）
      if (light.lastRoundEndSeen > roundEndLogged) {
        roundEndLogged = light.lastRoundEndSeen;
        const hook = await page.evaluate((): any => (window as any).__POKER_LAST_ROUND_END__);
        if (hook) {
          prevRoundEnd = { gs: hook.gs, teamLevels: hook.teamLevels, roundNumber: hook.roundNumber };
          console.error(`  round ${hook.roundNumber} ended (attacker=${hook.gs.attackerPoints}, tricks=${hook.gs.tricksPlayed}, level=${hook.gs.currentLevel}, teams=${hook.teamLevels?.join(',')})`);
          if (hook.roundNumber >= maxRounds - 1) return;
        }
      }

      // matchOver：round_end 持久（不再开新局），主循环轮询可观察到
      if (light.phase === GamePhase.RoundEnd && light.matchOver) {
        console.error(`  match over (team won at round ${round})`);
        return;
      }

      // 局轮转断言（新局开始时，用全量快照）
      if (round > lastRound && lastRound >= 0 && prevRoundEnd && prevRoundEnd.roundNumber === round - 1) {
        const snap = await collectSnapshot(page);
        assertRoundTransition(prevRoundEnd, { gs: snap.store!.gameState, teamLevels: snap.store!.teamLevels });
      }
      lastRound = round;

      // 阶段动作（人类回合才交互）
      switch (light.phase) {
        case GamePhase.Dealing: break; // 发牌中（speed=8 约 1.5s）
        case GamePhase.Revealing: await doReveal(page, timeoutMs); break;
        case GamePhase.BottomExchange: await doBottomExchange(page, timeoutMs); break;
        case GamePhase.Playing:
          if (light.current === 0 && light.humanSeat) {
            const snap = await collectSnapshot(page);
            if (snap.store?.gameState?.phase === GamePhase.Playing
                && snap.store.gameState.currentPlayerIndex === 0) {
              await maybeUseDebugMenu(page, snap, seed);
              await doPlay(page, snap, seed, timeoutMs);
            }
          }
          break;
        case GamePhase.RoundEnd: break; // 等自动 startNewRound
        default: break;
      }
    }
    await page.waitForTimeout(15);
  }
  const gs = (await collectSnapshot(page)).store?.gameState;
  throw new Error(`match did not finish ${maxRounds} round(s) within ${timeoutMs}ms (phase=${gs?.phase}, tricks=${gs?.tricksPlayed}, round=${(await collectSnapshot(page)).store?.roundNumber})`);
}

// ---------------------------------------------------------------------------
// main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let seed = 42, maxRounds = 2, timeoutMs = 240000, noSpawn = false, url = 'http://localhost:3000', speed = 8;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--seed': seed = Number(argv[++i]); break;
      case '--max-rounds': maxRounds = Number(argv[++i]); break;
      case '--timeout-ms': timeoutMs = Number(argv[++i]); break;
      case '--no-spawn': noSpawn = true; break;
      case '--url': url = argv[++i]; break;
      case '--speed': speed = Number(argv[++i]); break;
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
      await page.goto(buildUrl({ url, seed, auto: false, speed }), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // 页面内注入 zustand subscribe：round_end 瞬间同步捕获完整结算状态。
      // 外部轮询会错过短窗口（speed 高时 startNewRound 延迟被压缩到 ~100ms），
      // subscribe 回调在 store set 内同步执行，不丢状态。
      await page.evaluate(() => {
        const w = window as any;
        if (!w.__POKER_PHASE_HOOK__) {
          w.__POKER_PHASE_HOOK__ = true;
          w.__POKER_LAST_ROUND_END__ = null;
          w.__POKER_STORE__.subscribe((s: any, prev: any) => {
            const p = s?.gameState?.phase;
            const pp = prev?.gameState?.phase;
            if (p && p !== pp && p === 'round_end') {
              w.__POKER_LAST_ROUND_END__ = {
                gs: s.gameState, teamLevels: s.teamLevels, roundNumber: s.roundNumber,
              };
            }
          });
        }
      });

      // setup：勾选调试模式（hint 按钮需要 debug）→ 开始游戏（默认人类南座）
      await safeClick(page, '.setup-debug input');
      await safeClick(page, '[data-testid="setup-start"]');

      console.error(`ui-player: seed=${seed}, max-rounds=${maxRounds}, viewport=1280x720`);
      await runMatch(page, seed, maxRounds, timeoutMs);
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    killProcessTree(child);
  }

  // 进度/结果日志全部走 stderr（同步无缓冲，run_in_background 时实时落盘）
  console.error(`\n${asserts.length} assertions, ${failures} failed`);
  if (failures > 0) process.exit(1);
  console.error('ALL GREEN');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
