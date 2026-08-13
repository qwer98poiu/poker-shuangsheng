/**
 * 注入任意牌局状态到运行中的 GUI（window.__POKER_STORE__）→ 调 getHint 拿 AI 建议，
 * 并验证建议满足必出/不可选约束（computeMandatoryFollow）。
 *
 * Usage（在仓库任意位置）:
 *   npx tsx .claude/skills/gui-inject-ai/inject-gui.ts <state.json> [--url http://localhost:5199]
 *
 * state.json 格式（牌 = "S-2-0"（suit-rank-idx，同引擎 cardId））:
 * {
 *   "trump": { "declarerIndex": 0, "trumpSuit": "S", "level": 2 },   // trumpSuit null = NT
 *   "hand": ["S-2-0", "C-3-2", "C-13-3", "J-16-7"],                 // 玩家 1 手牌
 *   "trickPlays": [{ "playerIndex": 1, "cards": ["C-14-0"], "leadSuit": "C" }],  // 当前墩（leadSuit 必填！）
 *   "history": [{ "winnerIndex": 0, "points": 10, "plays": [[0, ["D-14-0"]], [1, ["D-3-0"]]] }], // 可选
 *   "aiHands": { "1": ["S-9-0", ...], "2": [...], "3": [...] },     // AI 手牌（影响 handCounts 记牌），可选
 *   "attackerPoints": 35,                                           // 可选，默认 0
 *   "bottomCards": ["H-9-0", ...],                                  // 可选（庄家底牌）
 *   "declarerIndex": 0,                                             // 可选，默认 0
 *   "currentLevel": 2, "tricksPlayed": 7, "roundNumber": 1          // 可选
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
const mkPlayers = () => {
  const aiHands: Record<string, string[]> = inj.aiHands ?? {};
  return [0, 1, 2, 3].map(i => ({
    hand: i === 0 ? inj.hand.map(card) : (aiHands[String(i)] ?? []).map(card),
    isHuman: i === 0,
    name: i === 0 ? '玩家1' : `AI-${i + 1}`,
    index: i,
  }));
};
const mkPlays = (plays: any[]) => plays.map((p: any) => ({ playerIndex: p[0], cards: p[1].map(card) }));
const state = {
  players: mkPlayers(),
  trumpDeclaration: cfg,
  declarerIndex: inj.declarerIndex ?? 0,
  attackerPoints: inj.attackerPoints ?? 0,
  trickHistory: (inj.history ?? []).map((t: any) => ({ winnerIndex: t.winnerIndex, points: t.points, plays: mkPlays(t.plays) })),
  reveals: inj.reveals ?? [],
  trickPlays: (inj.trickPlays ?? []).map((p: any) => ({ playerIndex: p.playerIndex, cards: p.cards.map(card), leadSuit: p.leadSuit ?? null })),
  leadPlayerIndex: inj.leadPlayerIndex ?? (inj.trickPlays?.[0]?.playerIndex ?? 0),
  bottomCards: (inj.bottomCards ?? []).map(card),
  debug: true,
  phase: 'Playing', currentLevel: inj.currentLevel ?? 2, tricksPlayed: inj.tricksPlayed ?? 0,
  currentPlayerIndex: 0, roundNumber: inj.roundNumber ?? 1,
  matchOver: false, settledTrick: null,
};

// ---- Node 侧约束检查（AI 建议 ⊇ 必出、∩ 不可选 = ∅） ----
const leadCards = state.trickPlays[0]?.cards ?? [];
let mandatory: { lockedIds: string[]; disabledIds: string[] } | null = null;
if (leadCards.length > 0) {
  mandatory = computeMandatoryFollow(state.players[0].hand, leadCards, cfg);
  console.log('必出(locked):', mandatory.lockedIds.join(', ') || '无');
  console.log('不可选(disabled):', mandatory.disabledIds.join(', ') || '无');
}

// ---- 页面注入 + getHint ----
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'networkidle' });

const stateJson = JSON.stringify(state).replace(/`/g, '\\`');
const code = `
(function(){
  const state = JSON.parse(JSON.stringify(${stateJson}));
  const st = window.__POKER_STORE__;
  st.setState({ gameState: state, localPlayerIndex: 0, selectedCardIds: [], lockedCardIds: [], aiPlayers: [false,true,true,true], debug: true, matchOver: false, roundNumber: state.roundNumber });
  st.getState().getHint();
  const s = st.getState();
  return JSON.stringify({ selected: s.selectedCardIds, message: s.message });
})()
`;
const result = JSON.parse(await page.evaluate(code));
console.log('\nAI 建议:', result.selected.join(', ') || '（无）');
console.log('理由:', result.message);

if (mandatory) {
  const okLocked = mandatory.lockedIds.every(id => result.selected.includes(id));
  const okDisabled = mandatory.disabledIds.every(id => !result.selected.includes(id));
  console.log(`\n约束检查: 建议⊇必出 ${okLocked ? '✓' : '✗ 缺: ' + mandatory.lockedIds.filter(id => !result.selected.includes(id)).join(',')} | 建议∩不可选 ${okDisabled ? '✓' : '✗ 含: ' + mandatory.disabledIds.filter(id => result.selected.includes(id)).join(',')}`);
}
await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
