/**
 * 前向兼容 shim：当前策略代码仍在 `packages/engine/src/ai-latest/`，物理搬迁前
 * 由本文件转出。搬迁时本目录由真实代码整体替换，包根 index 无需再改。
 * 勿在此加逻辑；engine 新增 AI 导出时同步补这里的清单。
 */
export {
  aiTryReveal, aiChooseBottomCards, aiLeadPlay, aiFollowPlay, suggestPlay,
  buildAIContext, computeBestSoFar, groupBySuit,
  findThrowableOffSuitCombos, computeOffSuitControls, longShape,
} from '@poker/engine';
export type {
  AIResult, AIContext, NTTrumpState, PlayPosition, OffSuitControlInfo,
} from '@poker/engine';
