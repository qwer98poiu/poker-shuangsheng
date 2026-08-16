/**
 * 布局回归检查：修改任意组件位置后，验证其他所有组件位置不变。
 *
 * 原理：向运行中的 GUI 注入 6 个代表性阶段状态（发牌/亮主/扣底/出牌×2/局末），
 * 逐一测量各组件 getBoundingClientRect，与基线（layout-baseline.json）比对，
 * 列出所有位移超过 1px 的组件及具体 delta。
 *
 * Usage（vite dev server 需在 5199 运行，浏览器 = 系统 Chrome）:
 *   npx tsx scripts/layout-regression.ts --snapshot   # 用当前布局生成基线（仅当确认布局正确时）
 *   npx tsx scripts/layout-regression.ts              # 对照基线检查；有位移 → 列出并退出码 1
 *   npx tsx scripts/layout-regression.ts --url http://localhost:5199
 *
 * 基线文件（layout-baseline.json）随代码提交；--snapshot 覆盖时先人工确认布局正确。
 * 注意：视图必须 1280×720（游戏画布固定 720 高）；窗口缩小会触发 WindowSizeWarning 但
 * 画布尺寸不变，测量仍有效。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCard } from '../../../packages/engine/src/model.js';

const require = createRequire(import.meta.url);
const { chromium } = require(fileURLToPath(new URL('../node_modules/playwright-core/index.js', import.meta.url)));

const BASELINE_PATH = fileURLToPath(new URL('./layout-baseline.json', import.meta.url));
const GAME_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5199';
const SNAPSHOT = process.argv.includes('--snapshot');
/** 允许的最大位移（px）：getBoundingClientRect 取整误差。 */
const TOLERANCE = 1;

const card = (id: string) => {
  const m = /^([A-Z])-(\d+)-(\d+)$/.exec(id);
  if (!m) throw new Error(`bad card id: ${id}`);
  return createCard(m[1] as any, Number(m[2]), Number(m[3]));
};

// ---- 各阶段固定状态（牌 id = 引擎 cardId；同 suit-rank 全局 ≤2 张） ----
const playersOf = (hands: string[][]) => hands.map((h, i) => ({
  hand: h.map(card), isHuman: true, name: i === 0 ? '玩家1' : `AI-${i + 1}`, index: i,
}));

const mkPlays = (plays: any[]) => plays.map((p: any) => ({
  playerIndex: p[0], cards: p[1].map(card),
}));

/** 出牌阶段手牌（本地玩家 12 张，其余 11 张） */
const playHands = (): string[][] => {
  const hands: string[][] = [[], [], [], []];
  let idx = 0;
  const deal = (n: number) => {
    const h: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = ['S', 'H', 'C', 'D'][Math.floor(idx / 13) % 4];
      const r = 2 + ((idx * 7 + i) % 13);
      h.push(`${s}-${r}-${idx++}`);
    }
    return h;
  };
  hands[0] = deal(12);
  hands[1] = deal(11);
  hands[2] = deal(11);
  hands[3] = deal(11);
  return hands;
};

const trump = { declarerIndex: 0, trumpSuit: 'S' as string | null, level: 2 };

/** 一墩 4 家出牌：P0 10 张甩牌 → 牌号跨 S/H/C/D，验证叠放不越界 */
const throwCards: string[][] = [
  ['S-4-0', 'S-6-1', 'S-8-2', 'S-10-3', 'S-12-4', 'S-14-5', 'H-5-6', 'H-9-7', 'C-7-8', 'D-3-9'],
  ['S-3-10'], ['C-5-11'], ['H-4-12'],
];

const STATES: Record<string, any> = {
  // 1. 发牌：无主、亮主面板显示
  dealing: {
    players: playersOf([['S-2-0', 'H-5-1', 'C-8-2', 'D-11-3', 'J-15-4', 'S-7-5', 'C-3-6', 'H-10-7'], [], [], []]),
    trumpDeclaration: null, declarerIndex: null, attackerPoints: 0,
    trickHistory: [], reveals: [], trickPlays: [], leadPlayerIndex: 0,
    bottomCards: [], phase: 'dealing', currentLevel: 2, tricksPlayed: 0,
    currentPlayerIndex: 0, roundNumber: 0,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: true, matchOver: false, settledTrick: null,
  },

  // 2. 亮主：P0 单♠2（灰，被反）+ P2 对♥2（当前主），亮主面板显示
  revealing: {
    players: playersOf([['S-2-0', 'H-5-1', 'C-8-2', 'D-11-3', 'J-15-4'], [], ['H-2-5', 'H-2-6', 'C-9-7'], []]),
    trumpDeclaration: { declarerIndex: 2, trumpSuit: 'H', level: 2 }, declarerIndex: 2,
    attackerPoints: 0, trickHistory: [],
    reveals: [
      { playerIndex: 0, suit: 'S', strength: 1 },
      { playerIndex: 2, suit: 'H', strength: 2 },
    ],
    trickPlays: [], leadPlayerIndex: 2, bottomCards: [],
    phase: 'revealing', currentLevel: 2, tricksPlayed: 0,
    currentPlayerIndex: 2, roundNumber: 0,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: true, matchOver: false, settledTrick: null,
  },

  // 3. 扣底：庄家 25 张，已选 3 张含主牌 → 黄色扣底键 + 主牌警告
  bottom_exchange: {
    players: playersOf([
      ['S-2-0', 'S-2-1', 'S-4-2', 'S-6-3', 'S-8-4', 'S-10-5', 'S-12-6', 'S-14-7',
       'H-3-8', 'H-5-9', 'H-7-10', 'H-9-11', 'H-11-12', 'H-13-13',
       'C-4-14', 'C-6-15', 'C-8-16', 'C-10-17', 'C-12-18', 'C-14-19',
       'D-5-20', 'D-7-21', 'D-9-22', 'D-11-23', 'D-13-24'],
      [], [], [],
    ]),
    trumpDeclaration: trump, declarerIndex: 0, attackerPoints: 0,
    trickHistory: [], reveals: [{ playerIndex: 0, suit: 'S', strength: 1 }],
    trickPlays: [], leadPlayerIndex: 0,
    bottomCards: ['H-9-25', 'C-3-26', 'D-11-27', 'D-13-28', 'S-5-29', 'H-2-30', 'J-16-31', 'J-15-32'],
    phase: 'bottom_exchange', currentLevel: 2, tricksPlayed: 0,
    currentPlayerIndex: 0, roundNumber: 0,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: true, matchOver: false, settledTrick: null,
  },

  // 4. 出牌：P1-P3 已出，P0 待出（锁定检查），已有一墩历史 → 分牌展示
  playing: {
    players: playersOf(playHands()),
    trumpDeclaration: trump, declarerIndex: 0, attackerPoints: 35,
    trickHistory: [
      {
        winnerIndex: 0, points: 10, leadPlayerIndex: 0,
        plays: mkPlays([[0, ['D-14-0']], [1, ['D-3-1']], [2, ['D-13-2']], [3, ['D-3-3']]]),
      },
    ],
    reveals: [{ playerIndex: 0, suit: 'S', strength: 1 }],
    trickPlays: [
      { playerIndex: 1, cards: ['C-14-0'].map(card), leadSuit: 'C' },
      { playerIndex: 2, cards: ['C-5-1'].map(card), leadSuit: 'C' },
      { playerIndex: 3, cards: ['C-10-2'].map(card), leadSuit: 'C' },
    ],
    leadPlayerIndex: 1, bottomCards: [],
    phase: 'playing', currentLevel: 2, tricksPlayed: 7,
    currentPlayerIndex: 0, roundNumber: 2,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: true, matchOver: false, settledTrick: null,
  },

  // 5. 甩 10 张：P0 已出 10 张（叠放），P1 待出
  playing_throw10: {
    players: playersOf(playHands()),
    trumpDeclaration: trump, declarerIndex: 0, attackerPoints: 0,
    trickHistory: [], reveals: [{ playerIndex: 0, suit: 'S', strength: 1 }],
    trickPlays: throwCards.slice(0, 1).map((p) => ({ playerIndex: 0, cards: p.map(card), leadSuit: null })),
    leadPlayerIndex: 0, bottomCards: [],
    phase: 'playing', currentLevel: 2, tricksPlayed: 3,
    currentPlayerIndex: 1, roundNumber: 1,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: true, matchOver: false, settledTrick: null,
  },

  // 6. 局末：结算面板 + 中央底牌展示
  round_end: {
    players: playersOf(playHands()),
    trumpDeclaration: trump, declarerIndex: 0, attackerPoints: 120,
    trickHistory: [
      {
        winnerIndex: 3, points: 20, leadPlayerIndex: 0,
        plays: mkPlays([[0, ['S-4-0']], [1, ['H-5-1']], [2, ['C-8-2']], [3, ['D-11-3']]]),
      },
      {
        winnerIndex: 0, points: 5, leadPlayerIndex: 3,
        plays: mkPlays([[3, ['H-9-4']], [0, ['S-2-5']], [1, ['C-3-6']], [2, ['D-7-7']]]),
      },
    ],
    reveals: [{ playerIndex: 0, suit: 'S', strength: 1 }],
    trickPlays: [], leadPlayerIndex: 0,
    bottomCards: ['H-9-8', 'C-3-9', 'D-11-10', 'D-13-11', 'S-5-12', 'H-2-13', 'J-16-14', 'J-15-15'],
    phase: 'round_end', currentLevel: 2, tricksPlayed: 12,
    currentPlayerIndex: 0, roundNumber: 2,
    aiReasons: [], dealtCards: [[], [], [], []], dealingComplete: true,
    debug: true, matchOver: false, settledTrick: null,
  },
};

/** 待测量的组件（选择器）：位置必须不受"其他组件"修改影响的全部关键元素 */
const ELEMENTS: [string, string][] = [
  ['game-table', '.game-table'],
  ['center-area', '.center-area'],
  ['table-top', '.table-top'],
  ['table-left', '.table-left'],
  ['table-right', '.table-right'],
  ['seat-top', '.table-top .player-seat'],
  ['seat-left', '.table-left .player-seat'],
  ['seat-right', '.table-right .player-seat'],
  ['message', '.table-message'],
  ['actions-slot', '.table-actions'],
  ['debug-bar', '.debug-bar'],
  ['hand-container', '.player-hand-container'],
  ['hand-label', '.player-hand-label'],
  ['hand-cards', '.player-hand-cards'],
  ['banner', '[data-testid=phase-banner]'],
  ['trump-indicator', '[data-testid=trump-indicator]'],
  ['trick-count', '[data-testid=trick-count]'],
  ['score-display', '[data-testid=score-display]'],
  ['level-box', '[data-testid=level-box]'],
  ['score-item', '.score-item'],
  ['score-points', '.score-points'],
  ['tablecloth', '[data-testid=trick-position-layout]'],
  ['pos-bottom', '.trick-pos-bottom'],
  ['pos-left', '.trick-pos-left'],
  ['pos-top', '.trick-pos-top'],
  ['pos-right', '.trick-pos-right'],
  ['pos-bottom-cards', '.trick-pos-bottom .trick-pos-cards'],
  ['pos-left-cards', '.trick-pos-left .trick-pos-cards'],
  ['pos-top-cards', '.trick-pos-top .trick-pos-cards'],
  ['pos-right-cards', '.trick-pos-right .trick-pos-cards'],
  ['pos-bottom-reveal', '.trick-pos-bottom .trick-pos-reveal'],
  ['pos-left-reveal', '.trick-pos-left .trick-pos-reveal'],
  ['pos-top-reveal', '.trick-pos-top .trick-pos-reveal'],
  ['pos-right-reveal', '.trick-pos-right .trick-pos-reveal'],
  ['reveal-panel', '[data-testid=reveal-panel]'],
  ['play-btn', '.action-bar .play-btn'],
  ['review-btn', '.action-bar .review-btn'],
  ['action-warn', '.action-warn'],
  ['bottom-reveal', '[data-testid=bottom-reveal]'],
  ['round-result', '[data-testid=round-result]'],
];

let page: any;

const injectState = (state: any, selected: string[] = []) => page.evaluate(`(function(){
  const st = window.__POKER_STORE__;
  st.setState({ gameState: JSON.parse(JSON.stringify(${JSON.stringify(state)})), mode: 'playing',
    localPlayerIndex: 0, selectedCardIds: ${JSON.stringify(selected)}, lockedCardIds: [],
    aiPlayers: [false,false,false,false], debug: true, matchOver: false, roundNumber: ${state.roundNumber} });
})()`);

const measure = () => page.evaluate(`(function(){
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left),
             right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) };
  };
  const out = {};
  ${JSON.stringify(ELEMENTS.map(e => e[0]))}.forEach((name, i) => out[name] = r(${JSON.stringify(ELEMENTS.map(e => e[1]))}[i]));
  return out;
})()`);

async function collect(): Promise<Record<string, Record<string, any>>> {
  const states: Record<string, Record<string, any>> = {};
  for (const [name, state] of Object.entries(STATES)) {
    const selected = name === 'bottom_exchange'
      ? ['S-2-0', 'S-2-1', 'S-4-2'] // 含主牌 → 触发黄色警告
      : [];
    await injectState(state, selected);
    await new Promise(r => setTimeout(r, 250)); // React 渲染 + 布局稳定
    states[name] = await measure();
  }
  return states;
}

/** 比较单个矩形：任一轴位移超阈值 → 返回位移清单，否则 null。 */
function diff(before: Record<string, any> | null, after: Record<string, any> | null) {
  if (!before || !after) return null;
  const moved: string[] = [];
  for (const axis of ['top', 'bottom', 'left', 'right', 'width', 'height']) {
    const d = (after[axis] ?? 0) - (before[axis] ?? 0);
    if (Math.abs(d) > TOLERANCE) {
      moved.push(`${axis} ${before[axis]}→${after[axis]} (${d > 0 ? '+' : ''}${d})`);
    }
  }
  return moved.length ? moved : null;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(GAME_URL, { waitUntil: 'networkidle' });

  const states = await collect();
  await browser.close();

  if (SNAPSHOT) {
    const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: fileURLToPath(new URL('../..', import.meta.url)) }).toString().trim(); } catch { return 'unknown'; } })();
    const baseline = {
      meta: { commit, viewport: '1280x720', generatedAt: new Date().toISOString() },
      states,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`已生成基线 ${BASELINE_PATH}（${Object.keys(states).length} 个阶段，commit ${commit}）`);
    console.log('提交前请确认当前布局正确；此后任何 GUI 改动后跑一次本脚本检查。');
    return;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(`基线不存在：${BASELINE_PATH}\n先用 --snapshot 生成（须人工确认当前布局正确）。`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (baseline.meta?.viewport !== '1280x720') {
    console.warn(`⚠ 基线视口 ${baseline.meta?.viewport} ≠ 当前 1280x720，位移比对可能失真`);
  }

  let anyMoved = false;
  for (const [name, cur] of Object.entries(states)) {
    const base = baseline.states?.[name];
    const problems: string[] = [];
    for (const [elemName, curRect] of Object.entries(cur)) {
      const d = diff(base?.[elemName] ?? null, curRect);
      if (d) problems.push(`    ${elemName}: ${d.join(', ')}`);
    }
    if (problems.length) {
      anyMoved = true;
      console.log(`✗ ${name}（${Object.keys(cur).length} 个组件中 ${problems.length} 个位移）`);
      problems.forEach(p => console.log(p));
    } else {
      console.log(`✓ ${name}`);
    }
  }
  console.log(anyMoved
    ? `\n布局回归失败：有组件位移。检查上方清单后再提交；若本次改动是有意调整这些组件的位置，需人工确认全布局后重新 --snapshot。`
    : `\n布局回归通过：${Object.keys(states).length} 个阶段全部组件位置与基线一致（≤${TOLERANCE}px）。`);
  process.exit(anyMoved ? 1 : 0);
}
main();
