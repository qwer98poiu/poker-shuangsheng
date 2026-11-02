/**
 * `@poker/ai`：历史 AI 策略基线的统一入口。
 *
 * 过渡期（2026-10-25 起；2026-11 包名由 `ai-baselines` 改来）：存量基线
 * 仍位于 `@poker/engine`，这里只做显式 re-export；新提取的基线直接放入本包
 * `src/ai-XXXX/`。归档存量基线后，本包逐渐成为唯一来源。engine 不得反向依赖本包。
 */

// 存量基线：出处与语义见 `packages/engine/src/index.ts` 的导出注释；归档时同步删除这里的对应行。
export { ai0816, ai0907, ai0929, ai1018 } from '@poker/engine';

/** 快照基线：ai/ 在 bc38d6（2026-10-24，庄 4.5：主拖拉机先于通用 5 领出）时的版本。 */
export * as ai1024 from './ai-1024/index.js';

/** 快照基线：ai/ 在 accffd（2026-10-31，0b 队友对子检查与跟牌拆拖拉机改版）时的版本。 */
export * as ai1031 from './ai-1031/index.js';

// 当前策略（前向兼容）：真实代码仍在 engine，物理搬迁前由 src/ai-latest/ 转出。
export {
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, suggestPlay,
  buildAIContext, computeBestSoFar, groupBySuit,
  findThrowableOffSuitCombos, computeOffSuitControls, longShape,
} from './ai-latest/index.js';
export type {
  AIResult, AIContext, NTTrumpState, PlayPosition, OffSuitControlInfo,
} from './ai-latest/index.js';
