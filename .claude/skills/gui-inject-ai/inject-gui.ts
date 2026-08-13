/**
 * 注入任意牌局状态到运行中的 GUI（window.__POKER_STORE__）→ 调 getHint 拿 AI 建议，
 * 并验证建议满足必出/不可选约束（computeMandatoryFollow）。
 *
 * 两种模式（按 state.json 是否含 initialHands 自动选择）：
 * - 无 initialHands：直接注入"当前状态"（hand + trickPlays + history）→ getHint。
 * - 有 initialHands：从第 1 墩开局驱动（按 history 逐墩出牌）到当前局面 → getHint。
 *   适合"AI 为什么建议某张牌"的完整还原（手牌/记牌/推断与真实路径一致）。
 *
 * Usage（在仓库任意位置）:
 *   npx tsx .claude/skills/gui-inject-ai/inject-gui.ts <state.json> [--url http://localhost:5199]
 *
 * state.json 格式（牌 = "S-2-0"（suit-rank-idx，同引擎 cardId）; JOKER 用 J-16-x / J-15-x）:
 * {
 *   "trump": { "declarerIndex": 0, "trumpSuit": "S", "level": 2 },   // trumpSuit null = NT
 *   "hand": ["S-2-0", "C-3-2", "C-13-3", "J-16-7"],                 // 玩家 1 当前手牌（无 initialHands 时用）
 *   "initialHands": { "0": [...25 张], "1": [...], "2": [...], "3": [...] },  // 扣底后各家开局手牌（导出含此段）
 *   "trickPlays": [{ "playerIndex": 1, "cards": ["C-14-0"], "leadSuit": "C" }],  // 当前墩（leadSuit 必填！主牌领出 null）
 *   "history": [{ "winnerIndex": 0, "points": 10, "plays": [[0, ["D-14-0"]], [1, ["D-3-0"]]] }], // 已出墩（驱动模式必需）
 *   "aiHands": { "1": ["S-9-0", ...], "2": [...], "3": [...] },     // AI 当前手牌（影响 handCounts 记牌；无 initialHands 时用）
 *   "attackerPoints": 35, "bottomCards": ["H-9-0", ...],            // 可选
 *   "currentLevel": 2, "tricksPlayed": 7, "roundNumber": 1, "leadPlayerIndex": 1, "reveals": [...] // 可选
 * }
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCard } from '../../../packages/engine/src/model.js';
import { computeMandatoryFollow } from '../../../packages/engine/src/following/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require(fileURLToPath(new URL('../../../packages/client/node_modules/playwright-core/index.js', import.meta.url)));

async function main(): Promise<void> {
const args = process.argv.slice(2);
const statePath = args[0];
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:5199';
if (!statePath) { console.error('Usage: inject-gui.ts <state.json> [--url http://localhost:5199]'); process.exit(2); }

const inj = JSON.parse(readFileSync(statePath, 'utf8'));
const cfg = inj.trump;
const card = (id: string) => {
  const m = /^([A-Z])-(\d+)-(\d+)$/.exec(id);
  if (!m) throw new Error(`bad card id: ${id}`);
  return createCard(m[1] as any, Number(m[2]), Number(m[3]));
};

// ---- 全局牌唯一性校验（两副 108 张，同 suit-rank 最多 2 张） ----
{
  const count = new Map<string, number>();
  const add = (id: string) => {
    const m = /^([A-Z])-(\d+)-(\d+)$/.exec(id);
    if (m) count.set(`${m[1]}-${m[2]}`, (count.get(`${m[1]}-${m[2]}`) ?? 0) + 1);
  };
  const allIds: string[] = [];
  if (inj.initialHands) Object.values(inj.initialHands).forEach(h => allIds.push(...h));
  else { allIds.push(...(inj.hand ?? [])); Object.values(inj.aiHands ?? {}).forEach(h => allIds.push(...h)); }
  (inj.trickPlays ?? []).forEach(p => allIds.push(...p.cards));
  (inj.history ?? []).forEach(t => t.plays.forEach(pl => allIds.push(...pl[1])));
  (inj.bottomCards ?? []).forEach(id => allIds.push(id));
  allIds.forEach(add);
  for (const [k, n] of [...count.entries()].sort()) {
    if (n > 2) console.warn(`⚠ 牌 ${k} 出现 ${n} 次（两副牌最多 2 张）——检查描述/导出是否一致`);
  }
}

// ---- 模式选择：有 initialHands → 从开局驱动；否则直接注入当前状态 ----
const driveMode = !!inj.initialHands;

const mkPlayersOf = (hands: string[][]) => hands.map((h, i) => ({
  hand: h.map(card), isHuman: true, name: i === 0 ? '玩家1' : `AI-${i + 1}`, index: i,
}));

// 当前状态（直接注入模式）
const curHands = [inj.hand ?? [], ...Object.values(inj.aiHands ?? {})];
const mkPlays = (plays: any[]) => plays.map((p: any) => ({ playerIndex: p[0], cards: p[1].map(card) }));
const curState = {
  players: mkPlayersOf(curHands),
  trumpDeclaration: cfg,
  declarerIndex: inj.declarerIndex ?? 0,
  attackerPoints: inj.attackerPoints ?? 0,
  trickHistory: (inj.history ?? []).map((t: any) => ({ winnerIndex: t.winnerIndex, points: t.points, plays: mkPlays(t.plays) })),
  reveals: inj.reveals ?? [],
  trickPlays: (inj.trickPlays ?? []).map((p: any) => ({ playerIndex: p.playerIndex, cards: p.cards.map(card), leadSuit: p.leadSuit ?? null })),
  leadPlayerIndex: inj.leadPlayerIndex ?? (inj.trickPlays?.[0]?.playerIndex ?? 0),
  bottomCards: (inj.bottomCards ?? []).map(card),
  debug: true,
  phase: 'playing', currentLevel: inj.currentLevel ?? 2, tricksPlayed: inj.tricksPlayed ?? 0,
  currentPlayerIndex: 0, roundNumber: inj.roundNumber ?? 1,
  matchOver: false, settledTrick: null,
};

// 开局状态（驱动模式）
const initState = {
  players: mkPlayersOf([0, 1, 2, 3].map(i => (inj.initialHands ?? {})[String(i)] ?? [])),
  trumpDeclaration: cfg,
  declarerIndex: inj.declarerIndex ?? 0,
  attackerPoints: 0,
  trickHistory: [],
  reveals: inj.reveals ?? [{ playerIndex: inj.declarerIndex ?? 0, suit: cfg.trumpSuit, strength: 1 }],
  trickPlays: [],
  leadPlayerIndex: 0,
  bottomCards: (inj.bottomCards ?? []).map(card),
  debug: true,
  phase: 'playing', currentLevel: inj.currentLevel ?? 2, tricksPlayed: 0,
  currentPlayerIndex: inj.declarerIndex ?? 0, roundNumber: inj.roundNumber ?? 1,
  matchOver: false, settledTrick: null,
};

// ---- Node 侧约束检查（AI 建议 ⊇ 必出、∩ 不可选 = ∅） ----
const leadCards = curState.trickPlays[0]?.cards ?? [];
let mandatory: { lockedIds: string[]; disabledIds: string[] } | null = null;
if (leadCards.length > 0) {
  mandatory = computeMandatoryFollow(curState.players[0].hand, leadCards, cfg);
  console.log('必出(locked):', mandatory.lockedIds.join(', ') || '无');
  console.log('不可选(disabled):', mandatory.disabledIds.join(', ') || '无');
}

// ---- 页面注入 ----
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'networkidle' });

const injectState = (state: any) => page.evaluate(`(function(){
  const st = window.__POKER_STORE__;
  st.setState({ gameState: JSON.parse(JSON.stringify(${JSON.stringify(state)})), localPlayerIndex: 0, selectedCardIds: [], lockedCardIds: [], aiPlayers: [false,false,false,false], debug: true, matchOver: false, roundNumber: ${state.roundNumber} });
})()`);

const drivePlayer = (p: number, ids: string[]) => page.evaluate(`(function(){
  const st = window.__POKER_STORE__;
  st.setState({ localPlayerIndex: ${p} });
  const gs = st.getState().gameState;
  if (gs.currentPlayerIndex !== ${p}) return 'player-mismatch: ' + gs.currentPlayerIndex;
  st.getState().clearSelection();
  ${ids.map(id => 'st.getState().selectCard(\'' + id + '\')').join(',')}
  st.getState().submitPlay();
  return 'ok';
})()`);

if (driveMode) {
  await injectState(initState);
  console.log(`驱动模式：从开局（第 1 墩前）逐墩出牌，共 ${(inj.history ?? []).length} 墩 + 当前墩 ${(inj.trickPlays ?? []).length - 1} 家`);
  for (let t = 0; t < (inj.history ?? []).length; t++) {
    for (const [p, cards] of (inj.history ?? [])[t].plays) {
      const ok = await drivePlayer(p, cards);
      if (ok !== 'ok') { console.error('第', t + 1, '墩玩家', p, '驱动失败:', ok); process.exit(1); }
    }
  }
  for (const tp of (inj.trickPlays ?? []).slice(0, -1)) {
    const ok = await drivePlayer(tp.playerIndex, tp.cards);
    if (ok !== 'ok') { console.error('当前墩玩家', tp.playerIndex, '驱动失败:', ok); process.exit(1); }
  }
} else {
  await injectState(curState);
}

// ---- getHint（视角 = 玩家 1） ----
const result = JSON.parse(await page.evaluate(`(function(){
  const st = window.__POKER_STORE__;
  st.setState({ localPlayerIndex: 0 });
  const gs = st.getState().gameState;
  st.getState().getHint();
  const s = st.getState();
  return JSON.stringify({ selected: s.selectedCardIds, message: s.message, tricks: gs.tricksPlayed, trickPlays: gs.trickPlays.length });
})()`));
console.log(`\nAI 建议: ${result.selected.join(', ') || '（无）'}`);
console.log('理由:', result.message);

if (mandatory) {
  const okLocked = mandatory.lockedIds.every(id => result.selected.includes(id));
  const okDisabled = mandatory.disabledIds.every(id => !result.selected.includes(id));
  console.log(`\n约束检查: 建议⊇必出 ${okLocked ? '✓' : '✗ 缺: ' + mandatory.lockedIds.filter(id => !result.selected.includes(id)).join(',')} | 建议∩不可选 ${okDisabled ? '✓' : '✗ 含: ' + mandatory.disabledIds.filter(id => result.selected.includes(id)).join(',')}`);
}
await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
