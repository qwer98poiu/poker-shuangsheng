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
//  ai-0719 on 2026-09-16 — their Elo scores stay in the README for reference)
export * as ai0802 from './ai-0802/index.js'; // ai/ as of the position-based follow refactor (2026-08-02, ebe0625)
export * as ai0808 from './ai-0808/index.js'; // ai/ as of 133900d (2026-08-08), before fourth-no-overkill & NT-discard fixes
export * as ai0809 from './ai-0809/index.js'; // ai/ as of b77a7b1 (2026-08-14), README 1035 Elo measurement target
export * as ai0816 from './ai-0816/index.js'; // ai/ as of 2d56a13 (2026-08-16), README 1055 Elo measurement target
export * as ai0907 from './ai-0907/index.js'; // ai/ as of 7476904 (2026-09-07), before the NT long-suit lead layer

// Serialization (reusing old model/serialize.ts)
export * from './model/serialize.js';
