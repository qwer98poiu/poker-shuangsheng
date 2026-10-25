/**
 * 历史 AI 策略基线的统一入口。
 *
 * 过渡期（2026-10-25 起）：存量基线仍位于 `@poker/engine`，这里只做显式
 * re-export；新提取的基线直接放入本包 `src/ai-XXXX/`。归档存量基线后，
 * 本包逐渐成为唯一来源。engine 不得反向依赖本包。
 */

// 存量基线：出处与语义见 `packages/engine/src/index.ts` 的导出注释；归档时同步删除这里的对应行。
export { ai0816, ai0907, ai0929, ai1005, ai1018 } from '@poker/engine';
