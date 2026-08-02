/**
 * 进度/检查点纯工具：时长格式化、剩余时间估计、检查点文档构建。
 */

/** 格式化时长：59s / 4m12s / 2h05m。 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** 按当前平均速率估计剩余时间（ms）。done<=0 或已跑完返回 0。 */
export function estimateRemaining(elapsedMs: number, done: number, total: number): number {
  if (done <= 0 || total <= done) return 0;
  return (elapsedMs / done) * (total - done);
}

export interface CheckpointMeta {
  seed: number;
  strategyA: string;
  strategyB: string;
  minMatches: number;
  maxMatches: number;
  stepMatches: number;
  startedAt: string;
}

/**
 * 构建检查点文档：累计统计 + 元数据（覆盖写，供中止后查看部分结果）。
 * statsA/statsB 为 toJSON 后的纯对象。
 */
export function buildCheckpointDoc(
  meta: CheckpointMeta,
  pairsDone: number,
  statsA: Record<string, unknown>,
  statsB: Record<string, unknown>,
  checkpointAt: string,
): Record<string, unknown> {
  return {
    meta: { ...meta, checkpointAt },
    evaluatedMatches: pairsDone * 2,
    pairsDone,
    strategies: {
      A: { name: meta.strategyA, ...statsA },
      B: { name: meta.strategyB, ...statsB },
    },
  };
}
