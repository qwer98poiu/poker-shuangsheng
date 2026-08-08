/**
 * Shared playwright-core driver for ui-dump.ts / ui-smoke.ts.
 *
 * Handles: vite dev-server lifecycle (reuse or spawn), system-Chrome launch,
 * page snapshot collection (DOM elements + zustand store via
 * window.__POKER_STORE__), and phase/trick waits.
 */
import { chromium, type Page } from 'playwright-core';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_URL = 'http://localhost:3000';

export interface DriverOpts {
  url: string;
  seed: number | null;
  auto: boolean;
  speed: number | null;
}

// ---------------------------------------------------------------------------
// vite dev server lifecycle

// NOTE: no global fetch on Node 17 — use node:http.
export function serverAlive(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(!!res.statusCode && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

export function spawnVite(): ChildProcess {
  // detached: true → we kill the whole process group on exit; killing just
  // `npx` would orphan the real vite child.
  const child = spawn('npx', ['--no-install', 'vite', '--port', '3000', '--strictPort'], {
    cwd: CLIENT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  return child;
}

export function killProcessTree(child: ChildProcess | null): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

export async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverAlive(url)) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`vite dev server not reachable at ${url} after ${timeoutMs}ms (is another process on :3000?)`);
}

export async function ensureServer(opts: { url: string; noSpawn: boolean }): Promise<ChildProcess | null> {
  const alive = await serverAlive(opts.url);
  if (alive) return null;
  if (opts.noSpawn) throw new Error(`server not running at ${opts.url} and --no-spawn given`);
  const child = spawnVite();
  try {
    await waitForServer(opts.url, 30000);
  } catch (err) {
    killProcessTree(child);
    throw err;
  }
  return child;
}

// ---------------------------------------------------------------------------
// browser

export async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    throw new Error(
      `Failed to launch system Chrome (channel:'chrome'). Install Google Chrome or use full playwright.\n${err}`,
    );
  }
}

export function buildUrl(opts: DriverOpts): string {
  const sp = new URLSearchParams();
  if (opts.seed !== null) sp.set('seed', String(opts.seed));
  if (opts.auto) sp.set('auto', '1');
  if (opts.speed !== null) sp.set('speed', String(opts.speed));
  const qs = sp.toString();
  return opts.url + (qs ? `/?${qs}` : '/');
}

// ---------------------------------------------------------------------------
// snapshot

export interface UiSnapshot {
  url: string;
  viewport: { w: number; h: number };
  store: {
    mode: string;
    roundNumber: number;
    aiPlayers: boolean[];
    message: string;
    errorMessage: string | null;
    selectedCardIds: string[];
    gameState: any;
  } | null;
  elements: Array<{
    tag: string; testid: string | null; cardId: string | null; cls: string;
    text: string; box: [number, number, number, number]; visible: boolean; z: number;
  }>;
}

export async function collectSnapshot(page: Page): Promise<UiSnapshot> {
  return page.evaluate(() => {
    const win = window as any;
    const st = win.__POKER_STORE__?.getState?.() ?? null;
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const elements: UiSnapshot['elements'] = [];
    document.querySelectorAll('[data-testid], [data-card-id]').forEach((el) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      elements.push({
        tag: el.tagName.toLowerCase(),
        testid: h.getAttribute('data-testid'),
        cardId: h.getAttribute('data-card-id'),
        cls: typeof h.className === 'string' ? h.className : '',
        text: (h.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        visible: (r.width > 0 || r.height > 0) && cs.display !== 'none' && cs.visibility !== 'hidden',
        z: parseInt(cs.zIndex, 10) || 0,
      });
    });
    const gs = st?.gameState ?? null;
    return {
      viewport,
      elements,
      store: st
        ? {
            mode: st.mode, roundNumber: st.roundNumber, aiPlayers: st.aiPlayers,
            message: st.message, errorMessage: st.errorMessage,
            selectedCardIds: st.selectedCardIds, gameState: gs,
          }
        : null,
    };
  }) as Promise<UiSnapshot>;
}

// ---------------------------------------------------------------------------
// waits

export async function waitPhase(page: Page, phase: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await collectSnapshot(page);
    if (snap.store?.gameState?.phase === phase) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`phase did not reach "${phase}" within ${timeoutMs}ms`);
}

export async function waitTricks(page: Page, n: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await collectSnapshot(page);
    if ((snap.store?.gameState?.tricksPlayed ?? 0) >= n) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`tricksPlayed did not reach ${n} within ${timeoutMs}ms`);
}
