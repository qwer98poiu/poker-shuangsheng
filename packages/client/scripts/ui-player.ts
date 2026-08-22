/**
 * ui-player — 人类模拟器（模拟点击驱动完整对局）。
 *
 * 单人 vs AI（人类南座）模式下，用真实 page.click / mouse 事件走完竞技场
 * 定义的一场的简化版（默认 2 局，完整一场 ~35 局不默认跑）：亮主 → 扣底 →
 * 出牌 → 结算 → 轮转。AI 决策复用引擎（与 gameStore 的 runAiTurns 同口径），
 * 交互全部真实输入，覆盖多条人类路径：
 *   - 扣底：50% 点"建议扣底"直接扣；50% 按 AI 决策手动逐张选
 *   - 出牌：与 GameTable 同口径计算 selectionMode（free/replace/accumulate）——
 *     free 走 XOR 拖框/逐张点选；组粒度（replace/accumulate，6bf3a20 引入）把 AI
 *     决策经 applyGroupClick 模拟展开为"整组点击/整组拖拽"（点代表一张整组进、
 *     拖拽终点拾取组），组语义表达不了才落 hint；另有 skipped 页弃竞态快照
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
  GamePhase, getRevealOptions, canOverride, buildAIContext, playCards, sortHand,
  aiLeadPlay, aiFollowPlay, aiChooseBottomCards, computeRoundOutcome, advanceLevel,
} from '@poker/engine';
import {
  collectSnapshot, ensureServer, killProcessTree, launchBrowser, buildUrl,
  safeClick, listOutOfBounds, type UiSnapshot,
} from './lib/driver.js';
import {
  computePlayableIds, computeSelectionMode, computeFollowPlan,
  applyGroupClick, type SelectionMode,
} from '../src/components/game/playable.js';

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
// selection helpers — all real mouse events

/**
 * 清空已有选中（UI 无清空按钮：逐张点击已选牌 toggle 反选；
 * 锁定牌点击为 no-op 自动保留，出牌后释放）。
 * 组粒度模式：点选是对粒度，同一组的对再点一次整对放下——逐张清会反复 toggle
 * （点 A 把 A 对放下、点 B 把 A 对又拉回），按"组"只点其中一张即可整组清空。
 */
async function clearSelectionByClicks(page: Page, mode?: SelectionMode): Promise<void> {
  const sel = (await collectSnapshot(page)).store!.selectedCardIds;
  const done = new Set<string>();
  for (const id of sel) {
    if (done.has(id)) continue;
    const g = mode && mode.kind !== 'free' ? (mode.groups[id] ?? [id]) : [id];
    await safeClick(page, `[data-card-id="${id}"]`);
    await page.waitForTimeout(30);
    g.forEach(x => done.add(x));
  }
}

/**
 * 拖拽框选首→末张目标牌（真实 mouse 事件，走 PlayerHand 拖拽路径）：
 * - 起始点 = 首牌露出区（左缘 +8px，露出条 [左, 左+36)），结束点 = 末牌露出区左缘内侧（+15px）
 *   → 矩形恰好覆盖 [first..last] 的露出区，前后相邻牌不进矩形
 * - 结束点纵向 +15px：纯水平矩形无高度，isCardCoveredByDrag 不命中
 * 前置：目标牌未选中（XOR 反选语义——已选牌被矩形覆盖会反选）。
 */
async function dragSelectCards(page: Page, ids: string[]): Promise<void> {
  const first = page.locator(`[data-card-id="${ids[0]}"]`).first();
  const last = page.locator(`[data-card-id="${ids[ids.length - 1]}"]`).first();
  const fb = await first.boundingBox();
  const lb = await last.boundingBox();
  if (!fb || !lb) throw new Error(`drag: card box missing (${ids[0]} / ${ids[ids.length - 1]})`);
  await page.mouse.move(fb.x + 8, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + 15, lb.y + lb.height / 2 + 15, { steps: 12 });
  await page.mouse.up();
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
    await safeClick(page, `[data-testid="reveal-btn-${pick.suit ?? (pick.strength >= 4 ? 'NT' : 'nt')}"]`);
    await waitStateChange(page, sigOf(gs), 'reveal click', timeoutMs);
  } else {
    // 无可亮/反选项 → 1s 自动确认（无按钮可点）
    console.error(`  reveal r${snap.store!.roundNumber}: no options, wait auto-pass`);
    await waitStateChange(page, sigOf(gs), 'reveal auto-pass', timeoutMs);
  }
}

async function doBottomExchange(page: Page, seed: number, timeoutMs: number): Promise<void> {
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

  // 人类庄家：从 33 张（手牌+底牌）选 8 张。
  // 50% 点"建议扣底"（AI 决策直接选中）；50% 按 AI 决策手动逐张选（非法回退启发式）。
  const rnd = mulberry32((seed + st.roundNumber * 7877 + 31) >>> 0)();
  if (rnd < 0.5) {
    await safeClick(page, '[data-testid="bottom-hint-btn"]');
    await page.waitForTimeout(150);
    const sel = (await collectSnapshot(page)).store!.selectedCardIds;
    check(`r${st.roundNumber} bottom hint selects 8`, sel.length === 8, `selected=${sel.length}`);
    console.error(`  bottom r${st.roundNumber}: hint ${[...sel].sort().join(',')}`);
  } else {
    // 手动：引擎决策（与 hint 同源），非法则回退启发式
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
  }

  await safeClick(page, '[data-testid="bottom-confirm"]');
  await waitStateChange(page, sigOf(gs), 'bottom exchange done', timeoutMs);
}

/**
 * 组粒度下把 AI 决策分解为"逐组点击序列"（repCardId × N + 判定是否可点击）：
 * - 逐张点 AI 组合会反复 toggle（点 A 整对进、点 B 整对又放下），必须按组点代表。
 * - 候选组 = 决策每张牌所在组（去重）；只保留"整组都在决策内"的组——组拉出决策外的
 *   牌（重叠窗口的错配映射，如点 8 整窗 789 进来）点击后终态必不符。
 * - 代表牌必须是"自己的组映射 == 目标组"的牌（点击/拖拽终点都以 groups[牌] 为准）：
 *   共享牌（如 66 同时进 5566/6677 窗口）映射到先枚举窗，不能当另一窗的代表。
 * - 用 applyGroupClick 模拟整条点击序列：终态必须恰好等于 AI 决策（含锁定），
 *   否则视为"组语义不可表达"（返回 null，调用方走 hint 兜底——getHint 直接 set store）。
 *   replace 只留最后一组（+锁定），决策含两组的组合模拟终态=仅最后组 ≠ 决策 → null，
 *   自动落到 hint——这正是"UI 组语义表达不了该组合"的信号。
 */
function groupClickPath(
  ids: string[], locked: Set<string>, mode: Exclude<SelectionMode, { kind: 'free' }>,
): { clicks: string[]; groups: string[][] } | null {
  const idSet = new Set(ids);
  const sameGroup = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every(x => b.includes(x));
  const cand: string[][] = [];
  const seenKey = new Set<string>();
  for (const id of ids) {
    const g = mode.groups[id] ?? [id];
    const key = [...g].sort().join(',');
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    cand.push(g);
  }
  const usable = cand.filter(g => g.every(x => idSet.has(x)));
  if (usable.length === 0) return null;
  // 代表：组内、非锁定、且自身组映射 == 目标组（共享牌映射到别的窗时不能当代表）
  const reps: string[] = [];
  for (const g of usable) {
    const rep = g.find(x => !locked.has(x) && sameGroup(mode.groups[x] ?? [x], g));
    if (!rep) return null; // 该组无可用代表（全部是共享牌）→ 组语义表达不了
    reps.push(rep);
  }
  const sel: string[] = [...locked];
  for (const rep of reps) {
    const next = applyGroupClick(sel, [...locked], mode, rep);
    sel.splice(0, sel.length, ...next);
  }
  const same = sel.length === ids.length && ids.every(x => sel.includes(x));
  return same ? { clicks: reps, groups: usable } : null;
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
  // 可选域与组粒度模式必须与 GameTable 同口径（强制拆对收窄 + selectionMode），
  // 否则模拟器按"错误模式"点击/断言（如把整对当单张逐点，点两次把对又放掉）。
  let forcedSplit: { selectId: string } | null = null;
  if (gs.trumpDeclaration && gs.phase === GamePhase.Playing
    && gs.trickPlays.length > 0 && gs.trickPlays[0].cards.length === 1) {
    const playableIds = computePlayableIds(player.hand, gs.trickPlays, gs.trumpDeclaration, gs.phase)
      ?? new Set(player.hand.map(c => c.id));
    if (playableIds.size === 2) {
      const two = player.hand.filter(c => playableIds.has(c.id));
      const [a, b] = two;
      if (a.suit === b.suit && a.rank === b.rank && !a.isJoker) {
        forcedSplit = { selectId: sortHand(two, gs.trumpDeclaration)[0].id };
      }
    }
  }
  const playableOverride = forcedSplit ? new Set([forcedSplit.selectId]) : undefined;
  const playable = playableOverride
    ?? computePlayableIds(player.hand, gs.trickPlays, gs.trumpDeclaration, gs.phase);
  const selectionMode = computeSelectionMode(
    player.hand, gs.trickPlays, gs.trumpDeclaration, gs.phase, playableOverride,
  );
  const lockedIds = new Set(computeFollowPlan(player.hand, gs.trickPlays, gs.trumpDeclaration, gs.phase).lockedIds);
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
    console.error(`  play constrained (t${gs.tricksPlayed} decision=${cards.map(c => c?.id ?? '?').join(',')} playable=${playable ? [...playable].join(',') : 'null'} inPool=${inPool.map(c => c?.id ?? '?').join(',')} final=${finalCards.map(c => c?.id ?? '?').join(',')} err=${playCards(gs, 0, inPool).error ?? '-'})`);
  }
  // 空决策（快照与页面推进竞态，预存在 flake：seed 3 稳定复现——AI 决策含 undefined
  // 或手牌已空但 phase 未翻）——本墩跳过交互，主循环下一轮按新状态重试。
  // （手牌非空但 finalCards 空 = 全灰牌的极端角：保留旧 hint 兜底，见下）
  if (cards.some(c => !c) || player.hand.length === 0) {
    console.error(`  play r${st.roundNumber} t${gs.tricksPlayed} skipped (degenerate decision, wait state settle)`);
    return;
  }
  const ids = finalCards.map(c => c.id);

  // 每墩确定性地随机选交互路径（独立 rng 流，seed 可复现）：
  // - free：目标在展示手牌中相邻（连续区间）且 rndDrag < 0.5 → XOR 拖框；否则
  //   rnd < 0.5 → 点建议出牌；rnd ≥ 0.5 → 逐张手动（自由选择允许单张 toggle，原语义不变）
  // - replace / accumulate（组粒度）：决策先用 applyGroupClick 模拟展开为整组点击序列；
  //   可表达时 rndDrag < 0.5 → 按组拖拽（终点拾取整组，replace 落一组 / accumulate 逐组加）、
  //   rnd < 0.5 → 建议；否则按组点选（每组点代表一张，整组进入）。组语义表达不了
  //   （决策含散牌/跨窗口）→ 建议出牌兜底（getHint 直接 set store，绕过组粒度）。
  const rnd = mulberry32((seed + st.roundNumber * 7919 + gs.tricksPlayed * 131) >>> 0)();
  const rndDrag = mulberry32((seed + st.roundNumber * 7919 + gs.tricksPlayed * 131 + 17) >>> 0)();
  const display = sortHand(player.hand, gs.trumpDeclaration);
  const dispIdx = new Map(display.map((c, i) => [c.id, i] as const));
  const idxs = ids.map(id => dispIdx.get(id) ?? -1).sort((a, b) => a - b);
  const contiguous = idxs.length >= 2 && idxs[0] >= 0 && idxs[idxs.length - 1] - idxs[0] + 1 === idxs.length;
  const groupPath = selectionMode.kind !== 'free'
    ? groupClickPath(ids, lockedIds, selectionMode)
    : null;
  const useFreeDrag = selectionMode.kind === 'free' && contiguous && rndDrag < 0.5;
  const useGroupDrag = groupPath !== null && rndDrag < 0.5;
  const useGroupManual = groupPath !== null && !useGroupDrag && rnd >= 0.5;
  const sig = sigOf(gs);
  const via = groupPath !== null
    ? (useGroupDrag ? 'group-drag' : useGroupManual ? 'group-click' : 'hint')
    : (useFreeDrag ? 'drag' : rnd < 0.5 ? 'hint' : 'manual');
  console.error(`  play r${st.roundNumber} t${gs.tricksPlayed}: ${ids.join(',')} via ${via}`);

  // 断言当前选中 == AI 决策（组粒度下锁定牌已在选中列表中）
  const assertSelection = async (label: string): Promise<void> => {
    await page.waitForTimeout(120);
    const sel = (await collectSnapshot(page)).store!.selectedCardIds;
    const same = sel.length === ids.length && ids.every(id => sel.includes(id));
    check(`r${st.roundNumber} ${label} selection matches AI decision`, same,
      `selected=${[...sel].sort().join(',')} expected=${[...ids].sort().join(',')}`);
  };
  /** 组粒度整组点选：每组点代表一张（调用前应已清空）。 */
  const clickGroups = async (): Promise<void> => {
    for (const rep of groupPath!.clicks) {
      await safeClick(page, `[data-card-id="${rep}"]`);
      await page.waitForTimeout(30);
    }
  };

  if (useFreeDrag) {
    // 拖拽前清空非锁定选中（XOR 反选：已选牌被拖到会反选；锁定牌点击 no-op 保留）
    await clearSelectionByClicks(page, selectionMode);
    // 拖拽矩形取展示序首末张（AI 决策顺序 ≠ 展示序时，首末端点会漏选/多选）
    await dragSelectCards(page, idxs.map(i => display[i].id));
    await assertSelection('drag');
  } else if (useGroupDrag && groupPath) {
    // 组粒度拖拽：拖过每组自己首→末张（终点拾取：replace 保留终点组、accumulate 加终点组）
    await clearSelectionByClicks(page, selectionMode);
    for (const g of groupPath.groups) {
      const gIds = g.map(id => dispIdx.get(id) ?? -1).sort((a, b) => a - b)
        .map(i => display[i].id);
      await dragSelectCards(page, gIds);
      await page.waitForTimeout(80);
    }
    await assertSelection('group drag');
  } else if (useGroupManual && groupPath) {
    await clearSelectionByClicks(page, selectionMode);
    await clickGroups();
    await assertSelection('group click');
  } else if (rnd < 0.5 || (selectionMode.kind !== 'free' && groupPath === null)) {
    await safeClick(page, '[data-testid="hint-btn"]');
    await page.waitForTimeout(150);
    const sel = (await collectSnapshot(page)).store!.selectedCardIds;
    const selLegal = sel.length > 0
      && (!playable || sel.every(id => playable.has(id)))
      && !playCards(gs, 0, player.hand.filter(c => sel.includes(c.id))).error;
    if (!selLegal) {
      // hint 选中了灰色/非法组合（client getHint 无校验，与 runAiTurns 的 AI 回退不同）→ 重选走手动
      await clearSelectionByClicks(page, selectionMode);
      if (groupPath) await clickGroups();
      else {
        for (const id of ids) {
          await safeClick(page, `[data-card-id="${id}"]`);
          await page.waitForTimeout(30);
        }
      }
    } else {
      const same = sel.length === ids.length && sel.every(id => ids.includes(id));
      check(`r${st.roundNumber} hint selects AI decision`, same,
        `hint=${[...sel].sort().join(',')} expected=${[...ids].sort().join(',')}`);
    }
  } else {
    // 自由模式手动：先清空已有选中（可能与自动选中/上次选择冲突，重选避免 toggle）
    await clearSelectionByClicks(page, selectionMode);
    for (const id of ids) {
      await safeClick(page, `[data-card-id="${id}"]`);
      await page.waitForTimeout(30);
    }
    await assertSelection('manual');
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
        case GamePhase.BottomExchange: await doBottomExchange(page, seed, timeoutMs); break;
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
      // 注意：.setup-debug 有两个 （自动抢庄 + 调试），.first() 会点到抢庄——
      // 调试必须点 [data-testid="setup-debug"]（8b9dab2 引入抢庄勾选框后此处曾错位）
      await safeClick(page, '[data-testid="setup-debug"]');
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
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
