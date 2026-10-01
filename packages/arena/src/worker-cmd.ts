/**
 * Worker 启动命令：复用父进程自己的 node + tsx loader，O(1) 得到一份「同样的
 * 运行环境」，不引入任何额外的解析/下载步骤。
 *
 * 不用 `npx tsx`：本仓库的 node_modules 里没有 tsx（node_modules/.bin/tsx 是
 * 悬空链接，指向不存在的 ../tsx/dist/cli.mjs），因此每次 `npx tsx` 都要经 npm
 * registry / npx 缓存解析 tsx。4 个 worker 并发解析时，部分请求会一直挂着
 * （TCP 已建立但不返回，进程 0% CPU），子进程永远不发 ready，池便无输出地永久
 * 等待——2026-09-30 实测：npx 启动 6 轮里只有 0~3/4 个 worker 就绪，而同样 4 个
 * 子进程用下面的命令启动是 3 轮 4/4 全部就绪。
 *
 * 父进程命令行本身（`npx tsx src/run.ts …`）已经带上了 tsx 的 loader，子进程照抄
 * 即可：既不经 npm，也不碰网络，启动还更快。
 */
export function workerCommand(
  childEntry: string, args: readonly string[],
): { cmd: string; args: string[] } {
  return {
    cmd: process.execPath,
    args: [...process.execArgv, childEntry, ...args],
  };
}
