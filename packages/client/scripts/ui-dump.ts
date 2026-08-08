/**
 * UI dump tool — the vision-less agent's "eyes".
 *
 * Drives the real GUI (system Chrome via playwright-core), then prints a
 * structured, greppable text dump: game-state summary, every interactive
 * element with its box/visibility, an ASCII layout sketch, and engine state.
 *
 * Usage:
 *   npx tsx scripts/ui-dump.ts [--url http://localhost:3000] [--seed 42] [--auto 1]
 *     [--start] [--click-card <cardId>...] [--wait-phase <phase>] [--wait-tricks N]
 *     [--auto-tricks N] [--dump [file|-]] [--shot out.png] [--no-spawn] [--timeout-ms 60000]
 *
 * Exit codes: 0 ok, 1 step failure, 2 usage error.
 */
import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { rankLabel, suitLabel } from '@poker/engine';
import {
  DEFAULT_URL, collectSnapshot, ensureServer, killProcessTree, launchBrowser, buildUrl,
  waitPhase, waitTricks, type UiSnapshot,
} from './lib/driver.js';

const DUMP_VERSION = 'v1';

// ---------------------------------------------------------------------------
// args

interface Args {
  url: string;
  seed: number | null;
  auto: boolean;
  speed: number | null;
  start: boolean;
  clickCards: string[];
  waitPhase: string | null;
  waitTricks: number | null;
  autoTricks: number | null;
  dump: string | null; // null = none, '-' = stdout
  shot: string | null;
  noSpawn: boolean;
  timeoutMs: number;
}

function usage(): never {
  console.error(`Usage: npx tsx scripts/ui-dump.ts [--url URL] [--seed N] [--auto 1] [--speed N]
    [--start] [--click-card <id>...] [--wait-phase <phase>] [--wait-tricks N]
    [--auto-tricks N] [--dump [file|-]] [--shot out.png] [--no-spawn] [--timeout-ms N]`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: DEFAULT_URL, seed: null, auto: false, speed: null,
    start: false, clickCards: [], waitPhase: null, waitTricks: null,
    autoTricks: null, dump: null, shot: null, noSpawn: false, timeoutMs: 60000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': args.url = next(); break;
      case '--seed': args.seed = Number(next()); break;
      case '--auto': args.auto = next() === '1'; break;
      case '--speed': args.speed = Number(next()); break;
      case '--start': args.start = true; break;
      case '--click-card': args.clickCards.push(next()); break;
      case '--wait-phase': args.waitPhase = next(); break;
      case '--wait-tricks': args.waitTricks = Number(next()); break;
      case '--auto-tricks': args.autoTricks = Number(next()); break;
      case '--dump': args.dump = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? next() : '-'; break;
      case '--shot': args.shot = next(); break;
      case '--no-spawn': args.noSpawn = true; break;
      case '--timeout-ms': args.timeoutMs = Number(next()); break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); usage(); }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// formatting

function cardStr(id: string): string {
  const m = /^([SHCDJ])-(\d+)/.exec(id);
  if (!m) return id;
  return `${m[1]}${m[2] === '15' ? 'J' : m[2] === '16' ? 'B' : rankLabel(Number(m[2]))}`;
}

function formatDump(snap: UiSnapshot): string {
  const gs = snap.store?.gameState ?? null;
  const out: string[] = [];
  out.push(`--- poker-ui-dump ${DUMP_VERSION} ---`);
  out.push(`url: ${snap.url}`);
  out.push(`viewport: ${snap.viewport.w}x${snap.viewport.h}`);
  if (!snap.store) {
    out.push('store: NOT_AVAILABLE (window.__POKER_STORE__ missing)');
    return out.join('\n');
  }
  const mode = snap.store.aiPlayers.every(Boolean) ? 'spectator' : 'single';
  out.push(`mode: ${mode}`);
  if (!gs) {
    out.push('gameState: null (still on setup?)');
    if (snap.store.mode === 'setup') out.push(`setup-message: ${snap.store.message || 'waiting for start'}`);
    out.push('elements:');
    for (const e of snap.elements.filter(e => e.visible)) {
      out.push(`  [${e.tag}${e.testid ? ` testid=${e.testid}` : ''}${e.cardId ? ` card=${e.cardId}` : ''} .${e.cls.split(' ').join('.')}] box=${e.box.join('x')}@(${e.box[0]},${e.box[1]}) z=${e.z} text="${e.text}"`);
    }
    return out.join('\n');
  }

  const trump = gs.trumpDeclaration;
  const trumpStr = trump
    ? `${trump.trumpSuit ? suitLabel(trump.trumpSuit) + rankLabel(trump.level) : 'NT'}(${trump.trumpSuit ? suitLabel(trump.trumpSuit) + '主' : '无主'})`
    : '-';
  const declarer = gs.trumpDeclaration?.declarerIndex ?? gs.declarerIndex;
  out.push(`round: ${snap.store.roundNumber} | phase: ${gs.phase} | level: ${rankLabel(gs.currentLevel)} | trump: ${trumpStr} | declarer: P${declarer}(${gs.players[declarer].name})`);
  const attackerTeam = (declarer % 2 === 0) ? 1 : 0;
  const teamPts: [number, number] = [0, 0];
  for (const t of gs.trickHistory) teamPts[t.winnerIndex % 2] += t.points;
  out.push(`scores: attacker=${gs.attackerPoints} | tricks=${gs.tricksPlayed}/25 | team0=${teamPts[0]} | team1=${teamPts[1]}`);
  out.push(`players: ${gs.players.map((p: any, i: number) =>
    `P${i}(${p.name}) hand=${p.hand.length} played=${(gs.trickPlays.find((pl: any) => (gs.leadPlayerIndex + gs.trickPlays.indexOf(pl)) % 4 === i)?.cards ?? []).length}`
  ).join(' | ')} | active=P${gs.currentPlayerIndex}`);
  if (gs.trickPlays.length > 0) {
    const lead = gs.trickPlays[0];
    const plays = gs.trickPlays.map((pl: any, i: number) =>
      `P${(gs.leadPlayerIndex + i) % 4} [${pl.cards.map((c: any) => cardStr(c.id)).join(' ')}]`).join(' ');
    const pts = lead.cards.reduce((s: number, c: any) => s + (c.rank === 5 ? 5 : c.rank === 10 || c.rank === 13 ? 10 : 0), 0);
    out.push(`trick: ${plays} | pts-so-far=${pts} | leadSuit=${lead.leadSuit ?? '-'}`);
  }
  out.push(`bottom: ${gs.bottomCards.length} (${gs.phase === 'round_end' ? 'revealed' : 'hidden'})`);
  if (gs.trickHistory.length > 0) {
    const last = gs.trickHistory[gs.trickHistory.length - 1];
    out.push(`lastTrick: winner=P${last.winnerIndex} pts=${last.points}`);
  }
  if (gs.currentReveal) out.push(`reveal: P${gs.currentReveal.playerIndex} ${gs.currentReveal.suit ? suitLabel(gs.currentReveal.suit) + rankLabel(gs.currentLevel) : 'NT'}(${gs.currentReveal.strength})`);
  out.push(`penalty: [${gs.throwPenalties.join(',')}]`);

  // elements
  out.push('elements:');
  for (const e of snap.elements) {
    if (!e.visible) continue;
    out.push(`  [${e.tag}${e.testid ? ` testid=${e.testid}` : ''}${e.cardId ? ` card=${e.cardId}` : ''} .${e.cls.split(' ').join('.')}] box=${e.box.join('x')}@(${e.box[0]},${e.box[1]}) z=${e.z} text="${e.text}"`);
  }

  // ascii layout: seats + center, from element boxes
  const seatEls = snap.elements.filter(e => e.testid?.startsWith('seat-'));
  const centerEl = snap.elements.find(e => e.testid === 'phase-banner');
  out.push('ascii:');
  if (seatEls.length > 0 && centerEl) {
    const yTop = Math.min(...seatEls.map(e => e.box[1]));
    const yBottom = Math.max(...seatEls.map(e => e.box[1] + e.box[3]));
    const xLeft = Math.min(...seatEls.map(e => e.box[0]));
    const xRight = Math.max(...seatEls.map(e => e.box[0] + e.box[2]));
    const W = 60;
    const rows = Array.from({ length: 9 }, () => Array(W).fill(' '));
    const put = (x: number, y: number, s: string) => {
      for (let i = 0; i < s.length; i++) {
        if (x + i >= 0 && x + i < W && y >= 0 && y < rows.length) rows[y][x + i] = s[i];
      }
    };
    put(0, 0, `┌${'─'.repeat(W - 2)}┐`);
    for (let y = 1; y < rows.length - 1; y++) { put(0, y, '│'); put(W - 1, y, '│'); }
    put(0, rows.length - 1, `└${'─'.repeat(W - 2)}┘`);
    for (const e of seatEls) {
      const cy = (e.box[1] + e.box[3] / 2 - yTop) / Math.max(1, yBottom - yTop);
      const row = Math.min(rows.length - 2, Math.max(1, Math.round(cy * (rows.length - 2))));
      const isLeft = e.box[0] < (xLeft + xRight) / 2;
      const label = e.text.slice(0, 18);
      if (isLeft) put(2, row, label); else put(W - 2 - label.length, row, label);
    }
    if (centerEl) {
      const cy = (centerEl.box[1] + centerEl.box[3] / 2 - yTop) / Math.max(1, yBottom - yTop);
      const row = Math.min(rows.length - 2, Math.max(1, Math.round(cy * (rows.length - 2))));
      put(Math.floor(W / 2) - 10, row, centerEl.text.slice(0, 20));
    }
    out.push(rows.map(r => r.join('').replace(/\s+$/, '')).join('\n'));
  } else {
    out.push('  (no seat/phase elements yet)');
  }

  // state summary (key fields only, greppable)
  out.push('state:');
  out.push(`  phase=${gs.phase} level=${gs.currentLevel} declarer=P${declarer} attackerPts=${gs.attackerPoints} tricks=${gs.tricksPlayed} trickPlays=${gs.trickPlays.length}`);
  if (snap.store.errorMessage) out.push(`  error="${snap.store.errorMessage}"`);
  out.push(`  message="${snap.store.message}"`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// auto-trick watcher

async function runAutoTricks(page: Parameters<typeof waitTricks>[0], n: number, dumpFile: string | null, timeoutMs: number): Promise<string[]> {
  const dumps: string[] = [];
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    const snap = await collectSnapshot(page);
    const t = snap.store?.gameState?.tricksPlayed ?? 0;
    if (t > last) {
      last = t;
      const text = formatDump(snap);
      dumps.push(text);
      if (dumpFile) {
        if (dumpFile === '-') console.log(`--- trick ${t} ---\n${text}\n`);
        else fs.appendFileSync(dumpFile, `--- trick ${t} ---\n${text}\n`);
      }
    }
    if (t >= n) return dumps;
    await page.waitForTimeout(50);
  }
  throw new Error(`tricksPlayed did not reach ${n} within ${timeoutMs}ms (reached ${last})`);
}

// ---------------------------------------------------------------------------
// main

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = buildUrl(args);

  let child: ChildProcess | null = null;
  try {
    child = await ensureServer({ url: args.url, noSpawn: args.noSpawn });
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.error(`[console.error] ${msg.text()}`);
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
      // give React a beat to mount
      await page.waitForTimeout(300);

      if (args.start) {
        await page.click('.setup-start-btn', { timeout: 5000 }).catch(() => {
          throw new Error('setup-start button not found (is the panel rendered?)');
        });
        await page.waitForTimeout(200);
      }
      for (const id of args.clickCards) {
        await page.click(`[data-card-id="${id}"]`, { timeout: 5000 }).catch(() => {
          throw new Error(`card [data-card-id="${id}"] not found (data-card-id lands in P4)`);
        });
        await page.waitForTimeout(50);
      }
      if (args.waitPhase) await waitPhase(page, args.waitPhase, args.timeoutMs);
      if (args.waitTricks !== null) await waitTricks(page, args.waitTricks, args.timeoutMs);

      if (args.autoTricks !== null) {
        await runAutoTricks(page, args.autoTricks, args.dump, args.timeoutMs);
      }

      const snap = await collectSnapshot(page);
      const text = formatDump({ ...snap, url: page.url() });
      if (args.dump === '-') console.log(text);
      else if (args.dump) fs.writeFileSync(args.dump, text + '\n');
      else console.log(text);

      if (args.shot) {
        await page.screenshot({ path: args.shot, fullPage: false });
        console.error(`screenshot saved: ${args.shot}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    killProcessTree(child);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
