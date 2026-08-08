// Dev-only helpers: parse URL params for deterministic, automated runs.
// These hooks exist so the GUI can be driven reproducibly by a vision-less
// agent (see scripts/ui-dump.ts / scripts/ui-smoke.ts).

export interface DevParams {
  /** ?seed=N — deterministic deck (seededShuffle); null = normal random game. */
  seed: number | null;
  /** ?auto=1 — start a 4-AI spectator match on page load. */
  auto: boolean;
  /** ?speed=n — divide all setTimeout intervals by n (auto=1 implies 8). */
  speed: number;
}

function parseParams(): DevParams {
  const sp = new URLSearchParams(window.location.search);
  const rawSeed = sp.get('seed');
  const seed = rawSeed !== null && /^\d+$/.test(rawSeed) ? Number(rawSeed) : null;
  const auto = sp.get('auto') === '1';
  const rawSpeed = sp.get('speed');
  const speed =
    auto && rawSpeed !== null && /^\d+$/.test(rawSpeed) && Number(rawSpeed) >= 1
      ? Number(rawSpeed)
      : auto ? 8 : 1;
  return { seed, auto, speed };
}

export const devParams: DevParams = parseParams();

/** Deterministic per-round seed: (seed + round*31) >>> 0. */
export function seedFor(seed: number, roundNumber: number): number {
  return (seed + roundNumber * 31) >>> 0;
}
