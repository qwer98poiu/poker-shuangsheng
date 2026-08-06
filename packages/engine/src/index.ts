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
export * as ai0712 from './ai-0712/index.js'; // 68a134 (2026-07-12)
export * as ai0719 from './ai-0719/index.js'; // 98221b (2026-07-19)
export * as ai0726 from './ai-0726/index.js'; // 7382d1a (2026-07-26)
export * as ai0707 from './ai-0707/index.js'; // ae2b76 (2026-07-08)
export * as ai0801 from './ai-0801/index.js'; // ai/ snapshot before the position-based follow refactor (2026-08-01)
export * as ai0802 from './ai-0802/index.js'; // ai/ as of the position-based follow refactor (2026-08-02, ebe0625)

// Serialization (reusing old model/serialize.ts)
export * from './model/serialize.js';
