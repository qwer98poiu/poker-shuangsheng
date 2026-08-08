/**
 * UI smoke test — full-stack regression lock for the GUI.
 *
 * Runs seeded 4-AI spectator matches headlessly and asserts, at every trick
 * boundary and round end:
 *   - trickHistory invariants (4 plays per trick, per-play card counts match)
 *   - attackerPoints === sum of points of tricks won by the attacker team
 *   - card conservation (108 = hands + bottom + played)
 *   - DOM ↔ engine consistency (once data-testid lands, P4)
 *   - round transition: next level/declarer match engine's advanceLevel
 *     prediction (once computeRoundOutcome/advanceLevel land in engine, P1)
 *   - determinism: two runs with the same seed produce byte-identical
 *     trick fingerprints (winner/points per trick, level per round)
 *
 * Usage: npx tsx scripts/ui-smoke.ts [--seed 42] [--max-rounds 3]
 *        [--url http://localhost:3000] [--no-spawn] [--no-fingerprint]
 *        [--timeout-ms 180000]
 *
 * Exit codes: 0 all green, 1 any assertion failed.
 */
import type { Page } from 'playwright-core';
import { collectSnapshot, ensureServer, killProcessTree, launchBrowser, buildUrl } from './lib/driver.js';
import type { UiSnapshot } from './lib/driver.js';

// Optional engine helpers (available after P1) for round-transition prediction.
let computeRoundOutcome: any = null;
let advanceLevel: any = null;
(async () => {
  try {
    const engine = await import('@poker/engine');
    computeRoundOutcome = engine.computeRoundOutcome ?? null;
    advanceLevel = engine.advanceLevel ?? null;
  } catch {
    // engine exports land in P1; transitions are then asserted automatically
  }
})();

// ---------------------------------------------------------------------------
// assertions

interface Assert { name: string; ok: boolean; detail: string; }
const asserts: Assert[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  asserts.push({ name, ok, detail });
  if (!ok) {
    failures++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// per-trick invariants (engine-side, always available)

function assertTrickInvariants(snap: UiSnapshot, round: number): void {
  const gs = snap.store?.gameState;
  if (!gs) { check(`r${round} trick invariants`, false, 'no gameState'); return; }
  const declarer = gs.trumpDeclaration?.declarerIndex ?? gs.declarerIndex;
  const attackerTeam = declarer % 2 === 0 ? 1 : 0;

  check(`r${round} history length == tricksPlayed`,
    gs.trickHistory.length === gs.tricksPlayed,
    `history=${gs.trickHistory.length} tricksPlayed=${gs.tricksPlayed}`);
  check(`r${round} every trick has 4 plays`,
    gs.trickHistory.every((t: any) => t.plays.length === 4),
    `tricks=${gs.trickHistory.length}`);
  const mismatched = gs.trickHistory.find((t: any) =>
    t.plays.some((p: any) => p.cards.length !== t.plays[0].cards.length));
  check(`r${round} same card count per trick`, !mismatched,
    mismatched ? `trick ${gs.trickHistory.indexOf(mismatched)} counts differ` : '');

  const expectedPts = gs.trickHistory
    .filter((t: any) => t.winnerIndex % 2 === attackerTeam)
    .reduce((s: number, t: any) => s + t.points, 0);
  check(`r${round} attackerPoints == Σ attacker-team trick points`,
    gs.attackerPoints === expectedPts,
    `actual=${gs.attackerPoints} expected=${expectedPts}`);

  // conservation only holds once dealing is complete (during dealing the deck
  // still holds undealt cards)
  if (gs.phase !== 'dealing') {
    const playedInHistory = gs.trickHistory.reduce((s: number, t: any) =>
      s + t.plays.reduce((ss: number, p: any) => ss + p.cards.length, 0), 0);
    const playedNow = gs.trickPlays.reduce((s: number, p: any) => s + p.cards.length, 0);
    const total = gs.players.reduce((s: number, p: any) => s + p.hand.length, 0)
      + gs.bottomCards.length + playedInHistory + playedNow;
    check(`r${round} card conservation (108)`, total === 108,
      `total=${total} hands+bottom+played=${total}`);
  }
}

// ---------------------------------------------------------------------------
// DOM ↔ engine consistency (lands with data-testid in P4)

function assertDomConsistency(snap: UiSnapshot, round: number): void {
  const gs = snap.store?.gameState;
  if (!gs) return;
  const hasTestids = snap.elements.some(e => e.testid);
  if (!hasTestids) return; // data-testid arrives in P4 — skip silently

  for (let i = 0; i < 4; i++) {
    const seat = snap.elements.find(e => e.testid === `seat-${i}`);
    if (!seat) continue;
    const expected = `(${gs.players[i].hand.length} 张)`;
    check(`r${round} seat P${i} hand count label`, seat.text.includes(expected),
      `seat text="${seat.text}" expected "${expected}"`);
  }
  const banner = snap.elements.find(e => e.testid === 'phase-banner');
  if (banner) {
    const expectedPhase = gs.phase === 'dealing' ? '发牌中' : gs.phase === 'revealing' ? '亮主阶段' : gs.phase === 'bottom_exchange' ? '扣底' : gs.phase === 'playing' ? '出牌阶段' : '本局结束';
    check(`r${round} phase banner matches`, banner.text.includes(expectedPhase),
      `banner="${banner.text}" expected contains "${expectedPhase}"`);
  }
}

// ---------------------------------------------------------------------------
// round transition (needs engine computeRoundOutcome/advanceLevel, P1)

function assertRoundTransition(prev: any, next: any): void {
  if (!computeRoundOutcome || !advanceLevel) return;
  if (!prev || !next) return;
  const gsPrev = prev.gameState, gsNext = next.gameState;
  if (!gsPrev || !gsNext || gsPrev.phase !== 'round_end') return;

  const declarer = gsPrev.trumpDeclaration?.declarerIndex ?? gsPrev.declarerIndex;
  const lastTrick = gsPrev.trickHistory[gsPrev.trickHistory.length - 1] ?? null;
  const outcome = computeRoundOutcome(gsPrev.attackerPoints, gsPrev.bottomCards, lastTrick, gsPrev.trumpDeclaration, declarer);

  // advancing team level prediction (same formula as client startNewRound)
  const advancingTeam = outcome.attackerSits ? (declarer + 1) % 2 : declarer % 2;
  const expectedLevel = advanceLevel(gsPrev.currentLevel, outcome.finalPts).newLevel;
  const expectedDeclarer = outcome.attackerSits ? (declarer + 1) % 4 : (declarer + 2) % 4;
  check(`round transition level (${rankStr(gsPrev.currentLevel)}→?)`, gsNext.currentLevel === expectedLevel,
    `actual=${rankStr(gsNext.currentLevel)} expected=${rankStr(expectedLevel)} outcome=${JSON.stringify(outcome)}`);
  check(`round transition declarer`, gsNext.declarerIndex === expectedDeclarer,
    `actual=P${gsNext.declarerIndex} expected=P${expectedDeclarer}`);
}

function rankStr(level: number): string {
  return level <= 14 ? ['2','3','4','5','6','7','8','9','10','J','Q','K','A'][level - 2] : String(level);
}

// ---------------------------------------------------------------------------
// match run

interface Fingerprint { trickFp: string[]; roundFp: string[]; }

async function runMatch(page: Page, opts: { maxRounds: number; timeoutMs: number }): Promise<Fingerprint> {
  const fp: Fingerprint = { trickFp: [], roundFp: [] };
  const deadline = Date.now() + opts.timeoutMs;
  let prevRoundEnd: UiSnapshot | null = null;
  let roundsSeen = 0;
  let lastTrick = -1;
  let lastRound = -1;

  while (Date.now() < deadline) {
    const snap = await collectSnapshot(page);
    const st = snap.store;
    if (!st?.gameState) { await page.waitForTimeout(100); continue; }
    const gs = st.gameState;

    if (gs.tricksPlayed > lastTrick) {
      lastTrick = gs.tricksPlayed;
      assertTrickInvariants(snap, st.roundNumber);
      assertDomConsistency(snap, st.roundNumber);
      const th = gs.trickHistory;
      if (th.length > 0) {
        const t = th[th.length - 1];
        fp.trickFp.push(`${st.roundNumber}:${th.length}:w${t.winnerIndex}:p${t.points}`);
      }
    }

    if (gs.phase === 'round_end' && st.roundNumber > lastRound) {
      lastRound = st.roundNumber;
      roundsSeen++;
      assertRoundTransition(prevRoundEnd, snap);
      prevRoundEnd = snap;
      fp.roundFp.push(`r${st.roundNumber}:level${gs.currentLevel}:declP${gs.trumpDeclaration?.declarerIndex ?? gs.declarerIndex}:att${gs.attackerPoints}`);
      console.log(`  round ${st.roundNumber} ended (attacker=${gs.attackerPoints}, level=${rankStr(gs.currentLevel)}, roundsSeen=${roundsSeen}/${opts.maxRounds})`);
      if (roundsSeen >= opts.maxRounds) return fp;
    }
    await page.waitForTimeout(50);
  }
  const gs = (await collectSnapshot(page)).store?.gameState;
  throw new Error(`match did not finish ${opts.maxRounds} round(s) within ${opts.timeoutMs}ms (phase=${gs?.phase}, tricks=${gs?.tricksPlayed})`);
}

// ---------------------------------------------------------------------------
// main

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let seed = 42, maxRounds = 3, timeoutMs = 180000, noSpawn = false, noFingerprint = false, url = 'http://localhost:3000';
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--seed': seed = Number(argv[++i]); break;
      case '--max-rounds': maxRounds = Number(argv[++i]); break;
      case '--timeout-ms': timeoutMs = Number(argv[++i]); break;
      case '--no-spawn': noSpawn = true; break;
      case '--no-fingerprint': noFingerprint = true; break;
      case '--url': url = argv[++i]; break;
      default: console.error(`Unknown flag: ${argv[i]}`); process.exit(2);
    }
  }

  const child = await ensureServer({ url, noSpawn });
  try {
    const browser = await launchBrowser();
    try {
      const runs: Fingerprint[] = [];
      const runCount = noFingerprint ? 1 : 2;
      for (let r = 0; r < runCount; r++) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(buildUrl({ url, seed, auto: true, speed: null }), { waitUntil: 'domcontentloaded' });
        console.log(`run ${r + 1}/${runCount}: seed=${seed}, max-rounds=${maxRounds}`);
        const fp = await runMatch(page, { maxRounds, timeoutMs });
        runs.push(fp);
        await page.close();
      }
      if (!noFingerprint) {
        const [a, b] = runs;
        const same = a.trickFp.length === b.trickFp.length
          && a.trickFp.every((v, i) => v === b.trickFp[i])
          && a.roundFp.length === b.roundFp.length
          && a.roundFp.every((v, i) => v === b.roundFp[i]);
        check('determinism: identical fingerprints across runs', same,
          `run1 tricks=${a.trickFp.length} rounds=${a.roundFp.length}, run2 tricks=${b.trickFp.length} rounds=${b.roundFp.length}`);
      }
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
