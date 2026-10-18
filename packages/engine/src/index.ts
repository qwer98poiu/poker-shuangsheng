/**
 * @poker/engine — Refactored entry point.
 *
 * Types & model
 */
export * from './types.js';
export * from './model.js';

// Core sub-modules (each with own tests)
export * from './dealing/index.js';
export * from './revealing/index.js';
export * from './bottom-exchange/index.js';
export * from './leading/index.js';
export * from './following/index.js';
export * from './pattern/index.js';
export * from './comparing/index.js';
export * from './scoring/index.js';

// State machine (glue layer)
export * from './game/index.js';

// AI (reusing old ai/index.ts for now — will be ported later)
export * from './ai/index.js';

// Strategy arena baselines: ai/ as of historical commits
// (archived & removed: ai-0707/ai-0712/ai-0726 on 2026-08-07, ai-0801 on 2026-09-16,
//  ai-0719 on 2026-09-16, ai-0808 on 2026-09-27, ai-0809 on 2026-10-01,
//  ai-0802 on 2026-10-06, ai-0927/ai-1002 on 2026-10-18 — their Elo scores stay in the README for reference)
export * as ai0816 from './ai-0816/index.js'; // ai/ as of 2d56a13 (2026-08-16), README 1055 Elo measurement target
export * as ai0907 from './ai-0907/index.js'; // ai/ as of 6aa2b80 (2026-09-07), before the trump-kill single-card tier selection
export * as ai0929 from './ai-0929/index.js'; // ai/ as of be6026c (2026-09-29), the NT pair-deduction fix — Elo scale anchor
export * as ai1005 from './ai-1005/index.js'; // ai/ as of 805b500 (2026-10-05), the NT long-suit lead layer & third-seat throw-add re-judge
export * as ai1018 from './ai-1018/index.js'; // ai/ as of b5de66 (2026-10-18), before the team-split lead ladder rewrite — includes the 0a/0b loosening

// Serialization (reusing old model/serialize.ts)
export * from './model/serialize.js';
