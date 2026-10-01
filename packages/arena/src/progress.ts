/**
 * 进度/检查点纯工具：时长格式化、剩余时间估计、检查点文档构建、进度行输出原语。
 */

/** 清行并把光标移回行首：原地刷新即覆盖上一行。 */
export const CLEAR_LINE = '\r\x1b[K';

/** 输出端：write 不带换行，log 带换行（对应 process.stdout / console.log）。 */
export interface LineSink {
  write(s: string): void;
  log(s: string): void;
}

/**
 * 进度行输出原语：TTY 下进度行原地覆盖（只占一行），显著性等「保留行」整行落盘后
 * 不再被覆盖；非 TTY（重定向到文件/管道）时一律降级为普通逐行打印，不留 `\r` 残迹。
 */
export class ProgressLines {
  /** 当前是否有一行原地刷新、尚未换行。 */
  private pending = false;

  constructor(private readonly tty: boolean, private readonly sink: LineSink) {}

  /** 进度行：原地覆盖上一行（每 100 场调用一次）。 */
  progress(line: string): void {
    if (!this.tty) {
      this.sink.log(line);
      return;
    }
    this.sink.write(CLEAR_LINE + line);
    this.pending = true;
  }

  /** 保留行（显著性结果）：覆盖当前进度行并换行，之后停留在屏幕上到下次刷新。 */
  sticky(line: string): void {
    if (!this.tty) {
      this.sink.log(line);
      return;
    }
    this.sink.write(CLEAR_LINE + line + '\n');
    this.pending = false;
  }

  /** 结束未换行的原地行（报告/中断提示前调用），避免与后续输出粘连。 */
  endLine(): void {
    if (this.tty && this.pending) {
      this.sink.write('\n');
      this.pending = false;
    }
  }
}

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
  /** 不设最小样本、任一显著即停（--until-significant）。 */
  untilSignificant: boolean;
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
