/**
 * 快照兼容 shim：历史 `ai/` 以 `../types.js` 引用当时的引擎模块。
 * 新基线按 `git archive` 原样放入 `src/ai-XXXX/` 后，这些相对路径解析到本文件。
 * 不要在这里加逻辑——它只把旧内部路径映射到 engine 的公开导出。
 */
export * from '@poker/engine';
