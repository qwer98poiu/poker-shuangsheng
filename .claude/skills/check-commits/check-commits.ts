#!/usr/bin/env -S npx tsx
/**
 * check-commits — 逐提交校验提交序列是否满足 CLAUDE.md 的提交规范。
 *
 * 默认范围 origin/main..HEAD，可传 range / 单个 rev / --last N。
 * 见同目录 SKILL.md 的检查项清单与判定口径。
 *
 * 用法：
 *   npx tsx .claude/skills/check-commits/check-commits.ts [range] [options]
 */

import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────
// 常量
// ────────────────────────────────────────────────────────────

const PKGS = ['engine', 'arena', 'cli', 'client'] as const;
type Pkg = (typeof PKGS)[number];

const VALID_PREFIXES = ['fix', 'feat', 'strategy', 'refactor', 'test', 'docs', 'chore', 'skill'];
/** 纯文档前缀：不写 Changelog、不改代码、不跑测试 */
const DOC_PREFIXES = ['docs', 'skill'];

/**
 * 纯数据文件：JSON 结构上只能装数据、装不下逻辑，「是数据」因此是**可验证的事实**
 * 而不是自报的意图——`packages/` 下的 `.json` 由这里从「代码/配置」口径中摘出，
 * 改动它不触发 S3/S5（重测换几个数不必写 Changelog）。
 *
 * 两个例外：`package.json`（脚本入口）与 `tsconfig*.json`（编译配置）同为 JSON，
 * 改的却是行为与构建，仍算代码/配置。
 */
function isDataFile(f: string): boolean {
  return f.endsWith('.json')
    && !/(^|\/)package(-lock)?\.json$/.test(f)
    && !/(^|\/)tsconfig[^/]*\.json$/.test(f);
}

/** 「代码/配置」路径口径：S5 判纯文档提交越界、S3 判是否该写 Changelog，共用一套；数据文件不计 */
function codeFilesOf(files: string[]): string[] {
  return files.filter((f) => !isDataFile(f)
    && (f.startsWith('packages/') || f === 'package.json' || /^tsconfig.*\.json$/.test(f)));
}

/** 冻结快照目录（extract-ai-baseline 产物），创建后只读 */
const SNAPSHOT_DIR_RE = /^packages\/engine\/src\/(ai-\d+)\//;
const SNAPSHOT_SCAN_PATH = 'packages/engine/src/';

/** 快照允许的两类例外（extract-ai-baseline/SKILL.md:58-59） */
const SNAPSHOT_EXCEPTION_NOTE =
  '快照只允许「死代码清理（行为不变）」与「注释」两类改动，其余任何修改都会污染基线对比';

const MODE = { ERROR: 'error', WARN: 'warn', INFO: 'info' } as const;
type Level = (typeof MODE)[keyof typeof MODE];

const LEVEL_ORDER: Level[] = [MODE.ERROR, MODE.WARN, MODE.INFO];
const LEVEL_GLYPH: Record<Level, string> = { error: '✗', warn: '⚠', info: '·' };

/** 英文单词里混进来的 [0-9a-f]{7,40} 假阳性（S11） */
const HEX_STOPWORDS = new Set(['defaced', 'effaced', 'facaded', 'decafed']);

/**
 * 出处字段——S11 的**例外之二**（与下面的快照出处注释并列）。
 *
 * 生成物里记录「依据哪个提交生成/测量」的机器可读字段，如布局基线的
 * `"commit": "e2a0158"`（由 `layout-regression.ts --snapshot` 写入）。它与快照出处注释
 * 同源：值只有是哈希才具备定位能力——日期到分钟仍可能与同日多次改写混淆——而这类字段
 * 行内没有「快照/基线」字样可依赖，只能按**键名**判。
 *
 * 判据比对注释类更严（据此收窄误报面）：键名须含 commit/revision 语义，值须是
 * 7–40 位十六进制串（日期、布尔、普通字符串都匹配不到）。与注释类例外相同，仍要求
 * 该 token 能解析成 commit 对象、且**在 main 上可达**（见 isMainReachable）——后者不可达
 * 时按 error 报，不豁免。
 */
const PROVENANCE_FIELD_RE = /"[A-Za-z_]*(?:commit|revision)[A-Za-z_]*"\s*:\s*"[0-9a-f]{7,40}"/i;

/**
 * 快照出处注释——S11 的**例外之一**。
 *
 * 冻结基线（`packages/engine/src/ai-XXXX/`）的出处注释必须同时给出「出处提交的哈希」与
 * 「日期」：目录名只到日，且快照日与提取提交往往不同日（`ai-0808` ← 133900d 是 08-08，
 * 提取提交在 08-09；`ai-0809` ← b77a7b1 是 08-14，提取在 08-15），只留日期无法唯一定位
 * 提取源。同理适用于 `ai/ as of <hash>` 形式的导出注释与 `it('ai-XXXX（<hash>, …）')`
 * 这类把出处写进测试名的写法。
 *
 * 判据宽松是有意的：只要求同一行里出现快照标识（`ai-XXXX`）或出处用词（快照/基线/
 * `as of`）。哈希出现在可执行代码里本就极罕见，而误报一个出处注释的代价（逼人删掉追溯
 * 信息）高于漏报一个前提是「这行同时还是个快照出处注释」的哈希引用。
 *
 * 宽松只针对「这行算不算出处注释」；例外成立另有一项前提：该哈希必须在 main 上可达
 * （见 isMainReachable），不可达时报 error 而非 info。
 */
const SNAPSHOT_PROVENANCE_RE = /快照|基线|snapshot|baseline|as of|ai-\d{4}/i;

/** 测试数解析：vitest 每包只输出一行 `Tests  N passed (N)` */
const TESTS_PASSED_RE = /Tests\s+(\d+)\s+passed/;
const TESTS_FAILED_RE = /Tests\s+(\d+)\s+failed/;

/**
 * 去掉 ANSI 转义序列。vitest 即使给了 FORCE_COLOR=0 / CI=true 仍会着色，
 * 摘要行实际是 `Tests  \x1b[1m\x1b[32m772 passed`，不去色则数字前有转义码，正则匹配不到。
 */
const ANSI_RE = new RegExp("\\u001b\\[[0-9;]*[A-Za-z]", "g");
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// ────────────────────────────────────────────────────────────
// 基础工具
// ────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..', '..', '..');

function git(args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', args, {
      cwd: opts.cwd ?? ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (opts.allowFail) return '';
    const err = e as { stderr?: Buffer | string; message: string };
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    throw new Error(`git ${args.join(' ')} 失败：${stderr || err.message}`);
  }
}

function readFileAt(rev: string, file: string): string | null {
  const out = git(['show', `${rev}:${file}`], { allowFail: true });
  return out === '' ? null : out;
}

function jsonAt<T>(rev: string, file: string): T | null {
  const raw = readFileAt(rev, file);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// 命令行参数
// ────────────────────────────────────────────────────────────

interface Options {
  range: string;
  /** 用户传的是单个 rev（而非 range）时记下来，解析成 `rev^..rev` */
  single: string | null;
  runTests: boolean;
  runTypecheck: boolean;
  jobs: number;
  json: boolean;
  out: string | null;
  keep: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    range: '',
    single: null,
    runTests: true,
    runTypecheck: true,
    jobs: 2,
    json: false,
    out: null,
    keep: false,
    verbose: false,
  };
  let positional: string | null = null;
  let last: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--last') {
      last = Number(argv[++i]);
      if (!Number.isInteger(last) || last <= 0) throw new Error('--last 需要一个正整数');
    } else if (a === '--no-tests') opts.runTests = false;
    else if (a === '--no-typecheck') opts.runTypecheck = false;
    else if (a === '--jobs') {
      opts.jobs = Number(argv[++i]);
      if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new Error('--jobs 需要一个正整数');
    } else if (a === '--json') opts.json = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a.startsWith('--')) throw new Error(`未知选项：${a}`);
    else if (positional === null) positional = a;
    else throw new Error(`多余的参数：${a}`);
  }

  if (last !== null && positional !== null) throw new Error('--last 与位置参数不能同时使用');
  if (last !== null) {
    opts.range = `HEAD~${last}..HEAD`;
  } else if (positional === null) {
    opts.range = 'origin/main..HEAD';
  } else if (positional.includes('..')) {
    opts.range = positional;
  } else {
    // 单个 rev：解析成 rev^..rev，只检查这一个提交。
    // 不能直接把裸 rev 交给 rev-list——那会列出它的全部祖先。
    opts.single = positional;
    opts.range = positional;
  }
  return opts;
}

/** 把 range 解析成自旧到新的 sha 列表 */
function resolveRange(opts: Options): string[] {
  let range = opts.range;
  if (opts.single !== null) {
    const hasParent =
      git(['rev-parse', '--verify', '--quiet', `${opts.single}^`], { allowFail: true }) !== '';
    if (git(['rev-parse', '--verify', '--quiet', `${opts.single}^{commit}`], { allowFail: true }) === '') {
      throw new Error(`无法把 ${opts.single} 解析为提交（检查拼写，或改用 A..B 形式指定范围）`);
    }
    if (!hasParent) return [git(['rev-parse', opts.single]).trim()]; // 根提交，没有父可比
    range = `${opts.single}^..${opts.single}`;
    opts.range = range; // 报告里显示实际范围
  }
  const shas = git(['rev-list', '--reverse', range], { allowFail: true }).trim();
  if (shas === '') {
    throw new Error(
      `范围 ${range} 内没有提交。若默认的 origin/main 不存在，请显式指定范围，` +
        `例如：check-commits.ts HEAD~10..HEAD`,
    );
  }
  return shas.split('\n');
}

// ────────────────────────────────────────────────────────────
// 提交元数据采集
// ────────────────────────────────────────────────────────────

interface CommitInfo {
  sha: string;
  short: string;
  authorDate: Date;
  authorDateStr: string; // 'YYYY-MM-DD HH:MM'
  subject: string;
  body: string; // %B 全文
  prefix: string | null;
  isDoc: boolean;
  parent: string | null;
  isMerge: boolean;
  /** 本次改动文件，含状态：M/A/D/R */
  changes: { status: string; file: string }[];
  files: string[];
  /** 本提交在 CHANGELOG.md 里新增/删除的行 */
  clAdded: string[];
  clRemoved: string[];
  /** 本提交新增的 `## 时间` 小节 */
  addedSections: { time: string; title: string }[];
}

function collectCommit(sha: string): CommitInfo {
  const meta = git(['show', '-s', '--format=%H%x01%h%x01%aI%x01%ad%x01%P%x01%s%x01%B', '--date=format:%Y-%m-%d %H:%M', sha]);
  const [, short, isoDate, dateStr, parents, subject, ...bodyParts] = meta.split('\x01');
  const body = bodyParts.join('\x01');

  const nameStatus = git(['show', '--name-status', '--format=', '--no-renames', sha]);
  const changes: { status: string; file: string }[] = [];
  for (const line of nameStatus.split('\n')) {
    const m = line.match(/^([A-Z])\t(.+)$/);
    if (m) changes.push({ status: m[1], file: m[2] });
  }

  // CHANGELOG 的增删行：只认本提交引入的文本（不翻旧账）
  const clDiff = git(['show', '--format=', '--unified=0', sha, '--', 'CHANGELOG.md']);
  const clAdded: string[] = [];
  const clRemoved: string[] = [];
  for (const line of clDiff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) clAdded.push(line.slice(1));
    else if (line.startsWith('-')) clRemoved.push(line.slice(1));
  }

  // `## ` 小节 = 标题行 + 紧随其后的 `### ` 行
  const addedSections: { time: string; title: string }[] = [];
  let current: { time: string; title: string } | null = null;
  for (const line of clAdded) {
    const h2 = line.match(/^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h2) {
      current = { time: h2[1], title: '' };
      addedSections.push(current);
    } else if (h3 && current) {
      if (current.title === '') current.title = h3[1];
    }
  }

  const prefixMatch = subject.match(/^([a-z]+):\s/);
  const prefix = prefixMatch ? prefixMatch[1] : null;

  return {
    sha,
    short,
    authorDate: new Date(isoDate),
    authorDateStr: dateStr,
    subject,
    body,
    prefix,
    isDoc: prefix !== null && DOC_PREFIXES.includes(prefix),
    parent: parents.trim() === '' ? null : parents.trim().split(' ')[0],
    isMerge: parents.trim().split(' ').filter(Boolean).length > 1,
    changes,
    files: changes.map((c) => c.file),
    clAdded,
    clRemoved,
    addedSections,
  };
}

// ────────────────────────────────────────────────────────────
// 检查结果
// ────────────────────────────────────────────────────────────

interface Finding {
  id: string;
  level: Level;
  sha: string | null;
  message: string;
  /** 期望值 vs 实测值，报告里单独一行 */
  detail?: string;
}

const findings: Finding[] = [];

function report(
  id: string,
  level: Level,
  sha: string | null,
  message: string,
  detail?: string,
): void {
  findings.push({ id, level, sha, message, detail });
}

// ────────────────────────────────────────────────────────────
// 结构类检查 S1–S14
// ────────────────────────────────────────────────────────────

function checkS1Dates(commits: CommitInfo[]): void {
  for (let i = 1; i < commits.length; i++) {
    const prev = commits[i - 1];
    const cur = commits[i];
    if (cur.authorDate.getTime() <= prev.authorDate.getTime()) {
      report(
        'S1',
        MODE.ERROR,
        cur.short,
        'author date 未晚于前一个提交',
        `${prev.short} ${prev.authorDateStr}  →  ${cur.short} ${cur.authorDateStr}`,
      );
    }
  }
}

function checkS2Prefix(c: CommitInfo): void {
  if (c.prefix === null) {
    report('S2', MODE.WARN, c.short, '提交信息缺少 `<type>: ` 前缀', `subject: ${c.subject}`);
  } else if (!VALID_PREFIXES.includes(c.prefix)) {
    report(
      'S2',
      MODE.WARN,
      c.short,
      `提交信息前缀 \`${c.prefix}:\` 不在白名单内`,
      `合法前缀：${VALID_PREFIXES.join(' / ')}`,
    );
  }
}

function checkS3S4S5(c: CommitInfo): void {
  if (c.isDoc) {
    // S4：纯文档提交不得新增 Changelog 条目（`## 时间` 行）；修正既有正文不受限
    if (c.addedSections.length > 0) {
      report('S4', MODE.ERROR, c.short, `${c.prefix}: 提交新增了 CHANGELOG.md 小节（规范：纯文档提交不写 Changelog 条目）`);
    }
    // S5：纯文档提交不得改代码
    const codeFiles = codeFilesOf(c.files);
    if (codeFiles.length > 0) {
      report(
        'S5',
        MODE.ERROR,
        c.short,
        `${c.prefix}: 提交改动了代码/配置（纯文档提交应只动 .md）`,
        codeFiles.slice(0, 8).join('、') + (codeFiles.length > 8 ? ` 等 ${codeFiles.length} 个` : ''),
      );
    }
    return;
  }

  // S3：改了代码的提交必须新增至少一个 `## ` 小节（只碰 .md/.gitignore 的 chore 之类不在此列）
  if (codeFilesOf(c.files).length > 0 && c.addedSections.length === 0) {
    const addedH3 = c.clAdded.filter((l) => /^###\s+/.test(l));
    report(
      'S3',
      MODE.ERROR,
      c.short,
      addedH3.length > 0
        ? `提交只往别人的小节里插了 ${addedH3.length} 个 ###，没有新增自己的 \`## 时间\` 小节`
        : '改了代码的提交没有新增 Changelog 小节',
    );
  }
}

/** S6：新增的 `## ` 必须在文件顶部连续区域（新条目置顶） */
function checkS6(c: CommitInfo, changelogAtCommit: string | null): void {
  if (c.addedSections.length === 0 || changelogAtCommit === null) return;
  const fileHeads = changelogAtCommit
    .split('\n')
    .map((l) => l.match(/^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);

  for (const s of c.addedSections) {
    const idx = fileHeads.indexOf(s.time);
    if (idx !== 0) {
      report(
        'S6',
        MODE.WARN,
        c.short,
        `新增的小节 \`## ${s.time}\` 不在文件首个 \`## \` 位置（实际第 ${idx + 1} 个）`,
        'Changelog 为时间倒序，新条目应置顶',
      );
    }
  }
}

/** S7/S8：Changelog 全文的时间倒序与孤立时间行（在范围最新提交处检查一次） */
function checkS7S8(changelogTip: string | null, tipSha: string): void {
  if (changelogTip === null) {
    report('S7', MODE.ERROR, tipSha, '找不到 CHANGELOG.md');
    return;
  }
  const lines = changelogTip.split('\n');

  const orphans = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*$/.test(l));
  if (orphans.length > 0) {
    report(
      'S8',
      MODE.ERROR,
      null,
      `Changelog 有 ${orphans.length} 行缺少 \`## \` 前缀的孤立时间行`,
      orphans.map((o) => `L${o.i + 1}: ${o.l}`).join('\n'),
    );
  }

  const heads = lines
    .map((l, i) => ({ m: l.match(/^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/), i }))
    .filter((x): x is { m: RegExpMatchArray; i: number } => x.m !== null);
  for (let i = 1; i < heads.length; i++) {
    const prev = heads[i - 1].m[1];
    const cur = heads[i].m[1];
    if (cur >= prev) {
      report(
        'S7',
        MODE.ERROR,
        null,
        'Changelog 未按时间倒序排列',
        `L${heads[i - 1].i + 1} \`${prev}\` 之后是 L${heads[i].i + 1} \`${cur}\``,
      );
    }
  }
}

/** S9：每个新增 `## 时间` 行只能由一个提交引入 */
function checkS9(commits: CommitInfo[]): void {
  const owners = new Map<string, string[]>();
  for (const c of commits) {
    for (const s of c.addedSections) {
      const list = owners.get(s.time) ?? [];
      list.push(c.short);
      owners.set(s.time, list);
    }
  }
  for (const [time, shas] of owners) {
    if (shas.length > 1) {
      report('S9', MODE.ERROR, shas[0], `小节 \`## ${time}\` 被多个提交重复引入`, shas.join('、'));
    }
  }
}

/** S10：Changelog 时间不得晚于提交时间 */
function checkS10(c: CommitInfo): void {
  for (const s of c.addedSections) {
    const t = new Date(s.time.replace(' ', 'T') + ':00');
    if (Number.isNaN(t.getTime())) continue;
    const deltaMin = Math.round((c.authorDate.getTime() - t.getTime()) / 60000);
    if (deltaMin < 0) {
      report(
        'S10',
        MODE.ERROR,
        c.short,
        `Changelog 时间 \`${s.time}\` 晚于提交时间`,
        `提交 author date: ${c.authorDateStr}（条目比提交早 ${-deltaMin} 分钟，方向反了）`,
      );
    } else if (deltaMin > 40) {
      report(
        'S10',
        MODE.WARN,
        c.short,
        `Changelog 时间 \`${s.time}\` 比提交时间早 ${deltaMin} 分钟`,
        `提交 author date: ${c.authorDateStr}；差 >40 分钟多半是条目与提交映射错了`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────
// S11：禁止引用提交哈希
// ────────────────────────────────────────────────────────────

function hexTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    if (!HEX_STOPWORDS.has(m[0])) out.add(m[0]);
  }
  return [...out];
}

/**
 * 只关心成败、不关心输出的 git 调用。
 *
 * 别用 `git(...) !== ''` 判断——`git cat-file -e` 成功时**什么都不打印**（只给退出码），
 * 那种写法会把成功一律判成失败（此前的 isCommitish 正是如此，导致代码扫描恒不命中）。
 */
function gitOk(args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/** 该 token 能否解析成仓库里的 commit 对象（含 backup 分支与悬空对象） */
const resolvableCache = new Map<string, boolean>();
function isCommitish(token: string): boolean {
  const hit = resolvableCache.get(token);
  if (hit !== undefined) return hit;
  const ok = gitOk(['cat-file', '-e', `${token}^{commit}`]);
  resolvableCache.set(token, ok);
  return ok;
}

/**
 * 主线基准：出处哈希还必须**在 main 上可达**，例外才成立。
 *
 * 例外允许哈希的唯一理由是「只留日期无法唯一定位提取源」——定位能力就是它的全部价值。
 * 指向被改写掉的旧对象的哈希，眼下 `git show <hash>:<path>` 仍能读出内容，但那只是 GC
 * 之前的假象：它既无法在 main 上 checkout 复现，对象一被回收，`git show` 也彻底失效。
 *
 * 基准取**本地 `main`** 而不是 `origin/main`：出处可以指向尚未 push 的提交（基线提取的
 * 源提交往往就是本地主线刚提交不久的那个），用远端主线会把这类正常引用误报。`main`
 * 取不到时依次回退 `origin/main`、`HEAD`；三者都取不到则**跳过**本项判定——宁可不报，
 * 也不要让每个出处哈希一起误报。
 */
let mainRefCache: string | null | undefined;
function mainRef(): string | null {
  if (mainRefCache !== undefined) return mainRefCache;
  for (const ref of ['main', 'origin/main', 'HEAD']) {
    if (gitOk(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) {
      mainRefCache = ref;
      return ref;
    }
  }
  mainRefCache = null;
  return null;
}

/** 该 token 是否在主线可达。基准本身取不到时返回 true（不判定，见 mainRef）。 */
const reachableCache = new Map<string, boolean>();
function isMainReachable(token: string): boolean {
  const ref = mainRef();
  if (ref === null) return true;
  const key = `${ref}:${token}`;
  const hit = reachableCache.get(key);
  if (hit !== undefined) return hit;
  const ok = gitOk(['merge-base', '--is-ancestor', token, ref]);
  reachableCache.set(key, ok);
  return ok;
}

function checkS11(c: CommitInfo, codeAddedLines: Map<string, { file: string; line: string }[]>): void {
  // 载体一：提交信息（散文语境，十六进制串基本只可能是 hash）
  for (const token of hexTokens(c.body)) {
    report('S11', MODE.ERROR, c.short, `提交信息引用了提交哈希 \`${token}\``, '指代历史请用日期');
  }

  // 载体二：Changelog 新增行
  for (const token of hexTokens(c.clAdded.join('\n'))) {
    report('S11', MODE.ERROR, c.short, `Changelog 引用了提交哈希 \`${token}\``, '指代历史请用日期');
  }

  // 载体三：代码新增行——只在能解析成 commit 时报，避免把颜色/ID 当哈希
  for (const { file, line } of codeAddedLines.get(c.sha) ?? []) {
    // 两类出处例外（见 SNAPSHOT_PROVENANCE_RE / PROVENANCE_FIELD_RE 注释）。豁免成立时报
    // info 而非静默跳过，免得将来误把整行其他位置的哈希也一并豁免时无人察觉；例外还有一项
    // 前提——哈希必须在 main 上可达（见 isMainReachable），不可达时按 error 报。
    const provenance = SNAPSHOT_PROVENANCE_RE.test(line)
      ? '快照出处注释'
      : PROVENANCE_FIELD_RE.test(line)
        ? '出处字段'
        : null;
    if (provenance !== null) {
      for (const token of hexTokens(line)) {
        if (!isCommitish(token)) continue;
        const where = `${file}: ${line.trim().slice(0, 100)}`;
        if (!isMainReachable(token)) {
          report(
            'S11',
            MODE.ERROR,
            c.short,
            `${provenance}的提交哈希 \`${token}\` 不在 main 上`,
            `指向被改写掉的旧对象：无法在 main 上复现，GC 后 \`git show\` 也失效——改指 main 上同一提交的哈希。${where}`,
          );
        } else {
          report(
            'S11',
            MODE.INFO,
            c.short,
            `${provenance}含提交哈希 \`${token}\``,
            `已豁免（${provenance}例外）：${where}`,
          );
        }
      }
      continue;
    }
    for (const token of hexTokens(line)) {
      if (isCommitish(token)) {
        report(
          'S11',
          MODE.ERROR,
          c.short,
          `代码里出现提交哈希 \`${token}\``,
          `${file}: ${line.trim().slice(0, 120)}`,
        );
      }
    }
  }
}

/**
 * 一次性取出范围内所有新增的代码行，按提交分组（避免逐提交起 git 进程）。
 *
 * 解析要点：`+++ b/<path>` 之后紧跟着的就是 `@@ … @@` hunk 头，**不能**把「非 +/-/空格
 * 开头」一律当成「出了 hunk」——那样刚记下的文件名会被 hunk 头立刻清空，其后所有新增行
 * 全被丢掉。实测旧写法收集到 0 行、丢弃 142 行，等于代码这一路从未生效。
 * 只有 `diff --git` 才代表进入下一个文件（`Binary files differ` 之类没有新增行，无需处理）。
 */
function collectCodeAddedLines(range: string): Map<string, { file: string; line: string }[]> {
  const out = new Map<string, { file: string; line: string }[]>();
  const raw = git(['log', '-p', '--unified=0', '--format=%x01%H', range]);
  let cur: string | null = null;
  let file: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('\x01')) {
      cur = line.slice(1).trim();
      file = null;
      continue;
    }
    if (line.startsWith('diff --git ')) {
      file = null; // 进入下一个文件；路径由随后的 `+++ ` 行给出
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('+') && cur && file) {
      const list = out.get(cur) ?? [];
      list.push({ file, line: line.slice(1) });
      out.set(cur, list);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// S12：提交信息格式
// ────────────────────────────────────────────────────────────

const CJK_RE = /[　-〿一-鿿＀-￯]/;

function checkS12(c: CommitInfo): void {
  const level: Level = c.isDoc ? MODE.INFO : MODE.WARN;
  const lines = c.body.split('\n');

  // 尾行单独整篇找：中文简述排在 Co-Authored-By 之前，用「遇到 CJK 就停」的循环会
  // 在抵达尾行前就退出，把每个提交都误报成缺尾行。
  const trailerLine = lines.find((l) => /^Co-Authored-By:\s+.+<[^>]+>\s*$/.test(l)) ?? null;

  // 英文正文行数：从正文开始，到第一行含 CJK 的行为止（或到尾行/其它 trailer 为止）
  let englishLines = 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^[A-Za-z-]+:\s/.test(l)) break; // trailer 段开始
    if (CJK_RE.test(l)) break;
    if (l.trim() !== '') englishLines++;
  }

  if (englishLines > 12) {
    report(
      'S12',
      level,
      c.short,
      `英文正文 ${englishLines} 行，超过 12 行上限`,
      '更长的解释写进 Changelog 对应小节，不堆在提交信息里',
    );
  }
  if (trailerLine === null) {
    report('S12', level, c.short, '提交信息缺少 `Co-Authored-By:` 尾行');
  }
}

// ────────────────────────────────────────────────────────────
// S14：冻结快照只读
// ────────────────────────────────────────────────────────────

function snapshotDirsAt(rev: string): Set<string> {
  const raw = git(['ls-tree', '-r', '--name-only', rev, '--', SNAPSHOT_SCAN_PATH], { allowFail: true });
  const out = new Set<string>();
  for (const f of raw.split('\n')) {
    const m = f.match(SNAPSHOT_DIR_RE);
    if (m) out.add(m[1]);
  }
  return out;
}

function checkS14(c: CommitInfo): void {
  if (c.parent === null) return; // 根提交没有父可比
  const before = snapshotDirsAt(c.parent);
  const after = snapshotDirsAt(c.sha);

  for (const dir of before) {
    const prefix = `packages/engine/src/${dir}/`;
    const touched = c.changes.filter((ch) => ch.file.startsWith(prefix));
    if (touched.length === 0) continue;

    if (!after.has(dir)) {
      // 整体删除：归档是合规操作
      report('S14', MODE.INFO, c.short, `归档移除快照 \`${dir}\`（${touched.length} 个文件，合规）`);
      continue;
    }
    const detail = touched
      .map((t) => `${t.status === 'M' ? '修改' : t.status === 'A' ? '新增' : '删除'} ${t.file.slice(prefix.length)}`)
      .join('、');
    report(
      'S14',
      MODE.ERROR,
      c.short,
      `冻结快照 \`${dir}\` 被改动（${touched.length} 个文件）`,
      `${detail}\n  ${SNAPSHOT_EXCEPTION_NOTE}`,
    );
  }

  for (const dir of after) {
    if (!before.has(dir)) {
      const n = c.changes.filter((ch) => ch.file.startsWith(`packages/engine/src/${dir}/`)).length;
      report('S14', MODE.INFO, c.short, `新增快照 \`${dir}\`（${n} 个文件，提取基线）`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 实测：worktree 隔离跑测试 / 类型检查
// ────────────────────────────────────────────────────────────

interface Measurement {
  counts: Partial<Record<Pkg, number>>;
  testsOk: boolean;
  testsNote: string;
  typecheckOk: boolean | null; // null = 该提交没有 typecheck 脚本
  typecheckNote: string;
}

const WT_ROOT = path.join(ROOT, '.git', 'cc-check-wt');
const CACHE_ROOT = path.join(ROOT, '.git', 'cc-check-cache');

/**
 * 改实测口径（解析方式、要跑的命令等）时必须 +1，否则旧缓存会被当成有效结果复用。
 * v1 → v2：解析测试数前先去掉 ANSI 转义序列。
 * v2 → v3：垫片补上 `packages/<pkg>/node_modules`（漏掉它会让 client 的 playwright-core
 *           解析不到，把干净的提交误判成 typecheck 失败）。
 */
const CACHE_VERSION = 3;

function cacheFile(sha: string, runTests: boolean, runTypecheck: boolean): string {
  return path.join(
    CACHE_ROOT,
    `v${CACHE_VERSION}-${sha}.${runTests ? 't' : 'n'}${runTypecheck ? 'y' : 'n'}.json`,
  );
}

function loadCache(sha: string, runTests: boolean, runTypecheck: boolean): Measurement | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(sha, runTests, runTypecheck), 'utf8')) as Measurement;
  } catch {
    return null;
  }
}

function saveCache(sha: string, runTests: boolean, runTypecheck: boolean, m: Measurement): void {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  fs.writeFileSync(cacheFile(sha, runTests, runTypecheck), JSON.stringify(m, null, 2));
}

/** 这两类目录是构建/依赖缓存，软链过去会让历史提交复用主仓库的缓存 */
const SHIM_SKIP = new Set(['.vite', '.cache']);

/**
 * 把一个主仓库的 node_modules 目录镜像成 worktree 里的真实目录 + 符号链接。
 *
 * 主仓库里 `node_modules/@poker/engine -> ../../packages/engine` 是**相对**链接——直接
 * 软链整个 node_modules 会让 worktree 跑到主仓库的包（也就是当前代码而不是历史代码）。
 * 所以除 @poker 外全部用绝对链接指回主仓库，@poker/* 用相对链接解析到 worktree 自己。
 */
function linkModules(mainDir: string, wtDir: string, wt: string): void {
  if (fs.existsSync(wtDir)) fs.rmSync(wtDir, { recursive: true, force: true });
  fs.mkdirSync(wtDir, { recursive: true });

  for (const entry of fs.readdirSync(mainDir)) {
    if (SHIM_SKIP.has(entry)) continue;
    const target = path.join(wtDir, entry);
    if (entry !== '@poker') {
      fs.symlinkSync(path.join(mainDir, entry), target);
      continue;
    }
    // @poker 作用域：指向 worktree 自己的包。相对路径按本层深度算，根和 packages/*/ 深度不同
    const scopeDir = target;
    fs.mkdirSync(scopeDir);
    const relPackages = path.relative(scopeDir, path.join(wt, 'packages'));
    for (const name of fs.readdirSync(path.join(mainDir, entry))) {
      // 老提交里可能还没有这个包（如 arena 是后加的），链过去会是悬空链接
      if (!fs.existsSync(path.join(wt, 'packages', name))) continue;
      fs.symlinkSync(path.join(relPackages, name), path.join(scopeDir, name));
    }
  }
}

/**
 * 建 worktree 的 node_modules 垫片，返回所有被创建的真实目录（清理时要先删它们）。
 *
 * 光镜像**根** node_modules 不够：主仓库里有些依赖没被提升到根，而是装在
 * `packages/<pkg>/node_modules/`（例如 client 的 `playwright-core`）。漏掉它会让
 * `tsc -p tsconfig.scripts.json` 报 TS2307「找不到模块」，把本来干净的提交误判成类型检查失败。
 */
function buildShim(wt: string, mainRoot: string): string[] {
  const dirs: string[] = [];
  const rootNm = path.join(wt, 'node_modules');
  linkModules(path.join(mainRoot, 'node_modules'), rootNm, wt);
  dirs.push(rootNm);

  const pkgsDir = path.join(wt, 'packages');
  if (fs.existsSync(pkgsDir)) {
    for (const pkg of fs.readdirSync(pkgsDir)) {
      const mainPkgNm = path.join(mainRoot, 'packages', pkg, 'node_modules');
      if (!fs.existsSync(mainPkgNm)) continue;
      const wtPkgNm = path.join(pkgsDir, pkg, 'node_modules');
      linkModules(mainPkgNm, wtPkgNm, wt);
      dirs.push(wtPkgNm);
    }
  }
  return dirs;
}

/**
 * 清理前逐个断言垫片目录安全（CLAUDE.md：误删软链路径会毁掉主仓库）。
 *
 * 两道关卡：(1) 每个垫片目录本身必须是真实目录而非符号链接——否则 `rm -rf` 会顺着
 * 链接删到主仓库里去；(2) @poker/* 必须解析在 worktree 内部。
 */
function assertShimSafe(wt: string, moduleDirs: string[]): void {
  const realWt = fs.realpathSync(wt);
  for (const dir of moduleDirs) {
    if (!fs.existsSync(dir)) continue;
    if (!dir.startsWith(realWt + path.sep)) {
      throw new Error(`安全检查失败：垫片目录 ${dir} 不在 worktree 内，拒绝删除`);
    }
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error(`安全检查失败：${dir} 不是真实目录，拒绝递归删除`);
    }
    const scope = path.join(dir, '@poker');
    if (!fs.existsSync(scope)) continue;
    if (fs.lstatSync(scope).isSymbolicLink()) {
      throw new Error(`安全检查失败：${scope} 不应是符号链接`);
    }
    for (const entry of fs.readdirSync(scope)) {
      const link = path.join(scope, entry);
      if (!fs.lstatSync(link).isSymbolicLink()) {
        throw new Error(`安全检查失败：${link} 不是符号链接，拒绝删除`);
      }
      // 词法解析链接目标即可：realpathSync 要求目标存在，而老提交里包可能还不存在
      const target = path.resolve(scope, fs.readlinkSync(link));
      if (target !== realWt && !target.startsWith(realWt + path.sep)) {
        throw new Error(`安全检查失败：${link} 指向 worktree 之外（${target}），拒绝删除`);
      }
    }
  }
}

function cleanupWorktree(wt: string, moduleDirs: string[]): void {
  if (!wt.startsWith(WT_ROOT + path.sep)) throw new Error(`拒绝清理 worktree 之外的路径：${wt}`);
  try {
    // 先断言、再删除：断言确保每个垫片目录是真实目录（不是指向主仓库的链接），
    // 否则 `rm -rf` 会顺着链接把主仓库的 node_modules 删掉
    assertShimSafe(wt, moduleDirs);
    for (const dir of moduleDirs) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    git(['worktree', 'remove', '--force', wt], { allowFail: true });
    git(['worktree', 'prune'], { allowFail: true });
  }
}

interface RunResult {
  ok: boolean;
  code: number | null;
  out: string;
}

function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0', CI: 'true' } });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', (e) => resolve({ ok: false, code: null, out: String(e) }));
    child.on('close', (code) => resolve({ ok: code === 0, code, out }));
  });
}

function tail(s: string, n = 2500): string {
  const t = s.trim();
  return t.length <= n ? t : '…' + t.slice(-n);
}

async function measure(
  sha: string,
  opts: Options,
  verbose: (msg: string) => void,
): Promise<Measurement> {
  const cached = loadCache(sha, opts.runTests, opts.runTypecheck);
  if (cached) {
    verbose(`${sha.slice(0, 7)} 命中缓存`);
    return cached;
  }

  const wt = path.join(WT_ROOT, sha);
  git(['worktree', 'remove', '--force', wt], { allowFail: true });
  fs.rmSync(wt, { recursive: true, force: true });
  fs.mkdirSync(WT_ROOT, { recursive: true });
  git(['worktree', 'add', '--detach', wt, sha]);

  const result: Measurement = {
    counts: {},
    testsOk: true,
    testsNote: '',
    typecheckOk: null,
    typecheckNote: '',
  };

  let moduleDirs: string[] = [];
  try {
    moduleDirs = buildShim(wt, ROOT);

    if (opts.runTests) {
      const notes: string[] = [];
      for (const pkg of PKGS) {
        const pkgJson = jsonAt<{ scripts?: Record<string, string> }>(sha, `packages/${pkg}/package.json`);
        if (pkgJson === null) {
          notes.push(`${pkg}: 该提交尚无此包`);
          continue;
        }
        if (!pkgJson.scripts?.test) {
          notes.push(`${pkg}: 无 test 脚本`);
          continue;
        }
        const r = await run('npm', ['run', 'test', '-w', `packages/${pkg}`], wt);
        const out = stripAnsi(r.out);
        const passed = TESTS_PASSED_RE.exec(out);
        const failed = TESTS_FAILED_RE.exec(out);
        if (passed) result.counts[pkg] = Number(passed[1]);
        const green = r.ok && failed === null && passed !== null;
        if (!green) {
          result.testsOk = false;
          notes.push(`${pkg}: ${failed ? `${failed[1]} 项失败` : `退出码 ${r.code}`}\n${tail(out)}`);
        }
        verbose(`${sha.slice(0, 7)} ${pkg} ${passed ? passed[1] : '?'} 项 ${green ? '✓' : '✗'}`);
      }
      result.testsNote = notes.join('\n');
    }

    if (opts.runTypecheck) {
      const rootPkg = jsonAt<{ scripts?: Record<string, string> }>(sha, 'package.json');
      if (!rootPkg?.scripts?.typecheck) {
        result.typecheckNote = '该提交的根 package.json 尚无 typecheck 脚本，跳过';
      } else {
        const r = await run('npm', ['run', 'typecheck'], wt);
        result.typecheckOk = r.ok;
        result.typecheckNote = r.ok ? '' : tail(stripAnsi(r.out));
      }
    }
  } finally {
    if (opts.keep) {
      verbose(`保留 worktree：${wt}`);
    } else {
      cleanupWorktree(wt, moduleDirs);
    }
  }

  saveCache(sha, opts.runTests, opts.runTypecheck, result);
  return result;
}

async function measureAll(
  shas: string[],
  opts: Options,
  verbose: (msg: string) => void,
): Promise<Map<string, Measurement>> {
  const out = new Map<string, Measurement>();
  const queue = [...shas];
  let done = 0;
  const total = queue.length;

  const worker = async (): Promise<void> => {
    for (;;) {
      const sha = queue.shift();
      if (sha === undefined) return;
      const m = await measure(sha, opts, verbose);
      out.set(sha, m);
      done++;
      process.stderr.write(`\r实测进度 ${done}/${total}  `);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.jobs, total) }, worker));
  process.stderr.write('\n');
  return out;
}

// ────────────────────────────────────────────────────────────
// T3–T6：解析提交信息 / Changelog 里的测试断言
// ────────────────────────────────────────────────────────────

interface TestDelta {
  /** 各动词的项数，如 {新增: 34, 重写: 9, 修改: 2} */
  verbs: Record<string, number>;
  /** 期望的净增量 = Σ新增 − Σ删除 − Σ移除（改/重写是计数中性的） */
  netDelta: number;
  /** 期望的逐包增量；null = 无法唯一反推，只能校验总数 */
  perPkg: Partial<Record<Pkg, number>> | null;
}

const VERBS = ['新增', '修改', '删除', '重写', '移除'];
const CHANGING_VERBS = ['新增', '删除', '移除'];

/**
 * 解析括号里的逐包分解。
 *   `engine 2 + arena 2` → {engine:2, arena:2}
 *   `engine`             → 裸包名，表示该子句的全部项数都归这个包（返 sum=null 由调用方补）
 *   其它（如按文件名细分的 `x.test.ts：新增 10 项；…`）→ null
 */
function parseBreakdown(inner: string): { per: Partial<Record<Pkg, number>>; sum: number; bare: Pkg | null } | null {
  const trimmed = inner.trim();
  if (/^(engine|arena|cli|client)$/.test(trimmed)) {
    return { per: {}, sum: -1, bare: trimmed as Pkg };
  }
  const per: Partial<Record<Pkg, number>> = {};
  const parts = trimmed.split(/[+＋]/);
  for (const part of parts) {
    const pm = part.trim().match(/^(engine|arena|cli|client)\s*(\d+)\s*项?$/);
    if (!pm) return null;
    per[pm[1] as Pkg] = (per[pm[1] as Pkg] ?? 0) + Number(pm[2]);
  }
  const sum = Object.values(per).reduce((a, b) => a + b, 0);
  return { per, sum, bare: null };
}

function parseTestDelta(text: string): TestDelta | null {
  // 先把所有 （…） 组抹成等长空白再抓子句：括号里常是按文件的细分
  // （`新增 29 项测试（x.test.ts：新增 10 项；…）`），不抹掉会把细分数再算一遍。
  // 用等长替换是为了保持子句的字符下标，后续才能把分解括号对回它前面的子句。
  let masked = text;
  const groups: { start: number; per: Partial<Record<Pkg, number>>; sum: number; bare: Pkg | null }[] = [];
  for (const m of text.matchAll(/（([^（）]*)）/g)) {
    const start = m.index ?? 0;
    masked = masked.slice(0, start) + ' '.repeat(m[0].length) + masked.slice(start + m[0].length);
    const parsed = parseBreakdown(m[1]);
    if (parsed) groups.push({ start, ...parsed });
  }

  interface Clause {
    verb: string;
    count: number;
    pos: number;
    per: Partial<Record<Pkg, number>> | null;
    claimed: boolean;
  }
  const clauses: Clause[] = [];
  const clauseRe = new RegExp(`(${VERBS.join('|')})\\s*(\\d+)\\s*项`, 'g');
  for (const m of masked.matchAll(clauseRe)) {
    clauses.push({ verb: m[1], count: Number(m[2]), pos: m.index ?? 0, per: null, claimed: false });
  }

  if (clauses.length === 0) {
    return /无新增测试/.test(text) ? { verbs: {}, netDelta: 0, perPkg: {} } : null;
  }

  // 每个分解括号归给紧邻在它前面的、尚未被认领的子句；该项数对不上括号合计时，
  // 说明这个括号横跨了多个子句（如「新增 34 项、重写 9 项、修改 2 项测试（engine 43 + …）」），
  // 此时无法拆出逐包增量。
  const ambiguous = new Set<Clause>();
  for (const g of groups) {
    let target: Clause | null = null;
    for (let i = clauses.length - 1; i >= 0; i--) {
      const cl = clauses[i];
      if (cl.pos < g.start && !cl.claimed) {
        target = cl;
        break;
      }
    }
    if (!target) continue;
    target.claimed = true;
    if (g.bare) {
      target.per = { [g.bare]: target.count };
    } else if (g.sum === target.count) {
      target.per = g.per;
    } else {
      ambiguous.add(target);
    }
  }

  const verbs: Record<string, number> = {};
  for (const cl of clauses) verbs[cl.verb] = (verbs[cl.verb] ?? 0) + cl.count;

  let netDelta = 0;
  for (const v of CHANGING_VERBS) netDelta += v === '新增' ? verbs[v] ?? 0 : -(verbs[v] ?? 0);

  // 逐包只有在每个「计数会变的」子句都拿到了自己的分解时才能反推
  const changing = clauses.filter((cl) => CHANGING_VERBS.includes(cl.verb));
  let perPkg: Partial<Record<Pkg, number>> | null = {};
  for (const cl of changing) {
    if (cl.per === null || ambiguous.has(cl)) {
      perPkg = null;
      break;
    }
    const sign = cl.verb === '新增' ? 1 : -1;
    for (const [p, n] of Object.entries(cl.per)) {
      perPkg[p as Pkg] = (perPkg[p as Pkg] ?? 0) + sign * n;
    }
  }

  return { verbs, netDelta, perPkg };
}

/** Changelog 里的测试数行：`引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过` */
interface ClCounts {
  counts: Partial<Record<Pkg, number>>;
  total: number;
}

function parseChangelogCounts(section: string): ClCounts | null {
  const m = section.match(
    /引擎\s*(\d+)\s*项\s*\+\s*arena\s*(\d+)\s*项\s*\+\s*CLI\s*(\d+)\s*项(?:\s*\+\s*client\s*(\d+)\s*项)?\s*=\s*(\d+)\s*项通过/,
  );
  if (!m) return null;
  const counts: Partial<Record<Pkg, number>> = {
    engine: Number(m[1]),
    arena: Number(m[2]),
    cli: Number(m[3]),
  };
  if (m[4] !== undefined) counts.client = Number(m[4]);
  return { counts, total: Number(m[5]) };
}

interface Section {
  time: string;
  /** 该 `## ` 小节的全部文本 */
  text: string;
  /** 小节内的 `### ` 标题 */
  subs: string[];
}

/** 解析某个 revision 的 Changelog，按 `## 时间` 切段 */
function parseChangelogSections(content: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const line of content.split('\n')) {
    const h2 = line.match(/^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/);
    if (h2) {
      cur = { time: h2[1], text: '', subs: [] };
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    cur.text += line + '\n';
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) cur.subs.push(h3[1]);
  }
  return out;
}

/** 多小节条目：只有最后一个 `###` 带总数行 */
function checkS13(sec: Section, sha: string): void {
  if (sec.subs.length < 2) return;
  // 按 `### ` 切分，检查除最后一段外是否出现总数行
  const parts = sec.text.split(/^###\s+/m).slice(1);
  for (let i = 0; i < parts.length - 1; i++) {
    if (/=\s*\d+\s*项通过/.test(parts[i])) {
      report(
        'S13',
        MODE.ERROR,
        sha,
        `小节 \`## ${sec.time}\` 的第 ${i + 1} 个 ### 带了测试总数行`,
        `只有最后一个 ###（共 ${parts.length} 个）才写「引擎 X 项 + … = X 项通过」`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────
// T6：影响文件比对（宽松）
// ────────────────────────────────────────────────────────────

function expandBraces(pattern: string): string[] {
  const m = pattern.match(/^(.*?)\{([^{}]+)\}(.*)$/);
  if (!m) return [pattern];
  return m[2]
    .split(',')
    .flatMap((alt) => expandBraces(m[1] + alt.trim() + m[3]));
}

function patternToRegExp(raw: string): RegExp {
  const isDir = raw.endsWith('/');
  const body = raw.replace(/\/+$/, '');
  const escaped = body
    .split('/')
    .map((seg) => {
      if (seg === '**') return '(?:.*)';
      if (seg === '*') return '[^/]*';
      return seg.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    })
    .join('/');
  // `a/**/b` 里的 `**/` 应能匹配零层目录
  const re = escaped.replace(/\/\(\?:\.\*\)\//g, '/(?:.*/)?');
  return new RegExp('^' + re + (isDir ? '/' : '$'));
}

/** `- **影响文件**：\`a\`、\`b\`，及 \`c\`。` → 展开 brace 后的路径模式列表 */
function impactPatterns(line: string): string[] {
  const listed = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return listed.flatMap((p) => expandBraces(p));
}

/** 该提交改动的文件里，没有任何一个匹配这些模式的一批 */
function uncoveredFiles(c: CommitInfo, patterns: string[]): string[] {
  const changed = c.files.filter((f) => f !== 'CHANGELOG.md');
  const regexes = patterns.map(patternToRegExp);
  return changed.filter((f) => !regexes.some((r) => r.test(f)));
}

/** 这些模式里，在本提交的改动中一个文件都没匹配上的 */
function patternsWithNoMatch(c: CommitInfo, patterns: string[]): string[] {
  const changed = c.files.filter((f) => f !== 'CHANGELOG.md');
  return patterns.filter((p) => !changed.some((f) => patternToRegExp(p).test(f)));
}

// ────────────────────────────────────────────────────────────
// 报告
// ────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  const w = [...s].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
}

function countsLine(m: Measurement | undefined): string {
  if (!m) return '（未实测）';
  const parts = PKGS.map((p) => `${p}=${m.counts[p] ?? '—'}`);
  const total = PKGS.reduce((acc, p) => acc + (m.counts[p] ?? 0), 0);
  return parts.join(' ') + ` 合计=${total}`;
}

function buildReport(
  opts: Options,
  commits: CommitInfo[],
  measurements: Map<string, Measurement>,
  globalNotes: string[],
): string {
  const L: string[] = [];
  const errs = findings.filter((f) => f.level === MODE.ERROR);
  const warns = findings.filter((f) => f.level === MODE.WARN);
  const infos = findings.filter((f) => f.level === MODE.INFO);

  const docs = commits.filter((c) => c.isDoc).length;
  L.push(`check-commits  ${opts.range}`);
  L.push(
    `${commits.length} 个提交：${commits.length - docs} 个改代码 / ${docs} 个纯文档` +
      `　·　error ${errs.length} / warn ${warns.length} / info ${infos.length}`,
  );
  L.push('');

  const bySha = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.sha === null) continue;
    const list = bySha.get(f.sha) ?? [];
    list.push(f);
    bySha.set(f.sha, list);
  }

  L.push('逐提交');
  for (const c of commits) {
    const fs_ = bySha.get(c.short) ?? [];
    const worst = LEVEL_ORDER.find((lv) => fs_.some((f) => f.level === lv));
    const mark = worst ? LEVEL_GLYPH[worst] : '✓';
    const m = measurements.get(c.sha);
    L.push(
      `  ${mark} ${c.short}  ${c.authorDateStr}  ${pad(c.isDoc ? '[纯文档]' : '', 8)} ${c.subject.slice(0, 46)}`,
    );
    if (opts.runTests || opts.runTypecheck) {
      L.push(`      ${countsLine(m)}${m && m.typecheckOk === false ? '   typecheck ✗' : ''}`);
    }
    for (const f of fs_) {
      L.push(`      ${LEVEL_GLYPH[f.level]} ${f.id} ${f.message}`);
      if (f.detail) for (const d of f.detail.split('\n')) L.push(`          ${d}`);
    }
  }
  L.push('');

  const globals = findings.filter((f) => f.sha === null);
  if (globals.length > 0 || globalNotes.length > 0) {
    L.push('范围级检查');
    for (const f of globals) {
      L.push(`  ${LEVEL_GLYPH[f.level]} ${f.id} ${f.message}`);
      if (f.detail) for (const d of f.detail.split('\n')) L.push(`      ${d}`);
    }
    for (const n of globalNotes) L.push(`  · ${n}`);
    L.push('');
  }

  if (errs.length + warns.length > 0) {
    L.push('汇总');
    for (const [label, list] of [
      ['错误', errs],
      ['警告', warns],
    ] as [string, Finding[]][]) {
      if (list.length === 0) continue;
      L.push(`  ${label}（${list.length}）`);
      for (const f of list) {
        L.push(`    ${f.sha ?? '—'}  ${f.id}  ${f.message}`);
        if (f.detail && f.level === MODE.ERROR) {
          for (const d of f.detail.split('\n').slice(0, 4)) L.push(`        ${d}`);
        }
      }
    }
    L.push('');
  }

  if (errs.length === 0) L.push(`结果：通过（无 error）`);
  else L.push(`结果：失败（${errs.length} 个 error）`);
  return L.join('\n');
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const verbose = (msg: string): void => {
    if (opts.verbose) process.stderr.write(`  ${msg}\n`);
  };

  const shas = resolveRange(opts);
  verbose(`范围 ${opts.range}：${shas.length} 个提交`);

  const commits = shas.map(collectCommit);

  // 范围内的提交直接查表；范围外的祖先（算 T3 增量要用）按需采集并缓存
  const infoCache = new Map<string, CommitInfo>(commits.map((c) => [c.sha, c]));
  const infoOf = (sha: string): CommitInfo => {
    const hit = infoCache.get(sha);
    if (hit) return hit;
    const info = collectCommit(sha);
    infoCache.set(sha, info);
    return info;
  };
  /** 自身或最近的祖先里，第一个非纯文档提交 */
  const nearestNonDoc = (c: CommitInfo, includeSelf: boolean): CommitInfo | null => {
    let cur: CommitInfo | null = includeSelf ? c : c.parent ? infoOf(c.parent) : null;
    let guard = 0;
    while (cur && cur.isDoc && guard++ < 500) cur = cur.parent ? infoOf(cur.parent) : null;
    return cur;
  };

  // ── 结构类
  checkS1Dates(commits);
  for (const c of commits) {
    checkS2Prefix(c);
    checkS3S4S5(c);
    checkS10(c);
    checkS12(c);
    checkS14(c);
    checkS6(c, readFileAt(c.sha, 'CHANGELOG.md'));
  }
  checkS9(commits);
  const tip = commits[commits.length - 1];
  const changelogTip = readFileAt(tip.sha, 'CHANGELOG.md');
  checkS7S8(changelogTip, tip.short);

  const codeAdded = collectCodeAddedLines(opts.range);
  for (const c of commits) checkS11(c, codeAdded);

  // ── 实测类：先算出需要实测哪些提交
  //
  // 需要实测的是两类：范围内每个提交的「基准」（自身或最近的非 docs 祖先，纯文档提交
  // 的测试数就等于它——docs 不改代码），以及每个非 docs 提交的「前一个非 docs 提交」
  // （T3 的增量要和它比）。后者可能是范围外的提交（范围首提交的父），也要测。
  const measureSet = new Set<string>();
  for (const c of commits) {
    const self = nearestNonDoc(c, true);
    if (self) measureSet.add(self.sha);
    if (!c.isDoc) {
      const prev = nearestNonDoc(c, false);
      if (prev) measureSet.add(prev.sha);
    }
  }
  const measureList = [...measureSet];

  const measurements = new Map<string, Measurement>();
  if (opts.runTests || opts.runTypecheck) {
    const measured = await measureAll(measureList, opts, verbose);
    for (const [k, v] of measured) measurements.set(k, v);
  }

  /** 某提交的测试数：纯文档提交递归取最近的非 docs 祖先 */
  const countsFor = (c: CommitInfo): Measurement | undefined => {
    const base = nearestNonDoc(c, true);
    return base ? measurements.get(base.sha) : undefined;
  };
  const prevNonDoc = (c: CommitInfo): CommitInfo | null => nearestNonDoc(c, false);

  for (const c of commits) {
    // ── T1：测试全绿
    // 纯文档提交没有被自己实测（其测试数继承自最近的非 docs 祖先），不重复报 T1/T2
    const m = c.isDoc ? undefined : measurements.get(c.sha);
    if (opts.runTests && m && !m.testsOk) {
      report('T1', MODE.ERROR, c.short, '该提交的测试未全绿', m.testsNote);
    }

    // ── T2：类型检查
    if (opts.runTypecheck && m) {
      if (m.typecheckOk === false) {
        report('T2', MODE.ERROR, c.short, '该提交 `npm run typecheck` 有错误', m.typecheckNote);
      }
    }

    const prev = prevNonDoc(c);
    const curM = countsFor(c);
    const prevM = prev ? countsFor(prev) : undefined;

    // ── T3：提交信息的测试增量
    if (!c.isDoc && opts.runTests) {
      const delta = parseTestDelta(c.body);
      if (delta === null) {
        if (/测试/.test(c.body)) {
          report('T3', MODE.WARN, c.short, '提交信息提到测试但没有可解析的增量声明');
        }
      } else if (curM && prevM) {
        const actualTotal =
          PKGS.reduce((acc, p) => acc + (curM.counts[p] ?? 0), 0) -
          PKGS.reduce((acc, p) => acc + (prevM.counts[p] ?? 0), 0);
        if (actualTotal !== delta.netDelta) {
          report(
            'T3',
            MODE.ERROR,
            c.short,
            `提交信息声明的测试增量与实测不符`,
            `声明：${delta.netDelta >= 0 ? '+' : ''}${delta.netDelta} 项（` +
              Object.entries(delta.verbs).map(([k, v]) => `${k} ${v}`).join('、') +
              `）　实测：${actualTotal >= 0 ? '+' : ''}${actualTotal} 项\n` +
              PKGS.map((p) => `${p} ${prevM.counts[p] ?? '—'}→${curM.counts[p] ?? '—'}`).join('　'),
          );
        }
        // 逐包：能唯一反推时硬校验；推不出来（括号横跨多个动词）时只提示人工核对
        const actualPerPkg = (p: Pkg): number => (curM.counts[p] ?? 0) - (prevM.counts[p] ?? 0);
        const expected = delta.perPkg;
        if (expected !== null) {
          const declared = (p: Pkg): number => expected[p] ?? 0;
          const bad = PKGS.filter((p) => declared(p) !== actualPerPkg(p));
          if (bad.length > 0) {
            report(
              'T3',
              MODE.ERROR,
              c.short,
              '提交信息的逐包分解与实测不符',
              bad.map((p) => `${p}: 声明 ${declared(p)}，实测 ${actualPerPkg(p)}`).join('\n'),
            );
          }
        } else {
          report(
            'T3',
            MODE.INFO,
            c.short,
            '测试增量无法唯一反推逐包分配（括号横跨多个动词），请人工核对',
            '实测逐包 Δ：' + PKGS.map((p) => `${p} ${actualPerPkg(p)}`).join('　'),
          );
        }
      }
    }

    // ── T4/T5/T6：Changelog 断言（用该提交时的文件内容定位小节）
    if (c.addedSections.length === 0) continue;
    const clAt = readFileAt(c.sha, 'CHANGELOG.md');
    if (clAt === null) continue;
    const sections = parseChangelogSections(clAt);
    const own = sections.filter((s) => c.addedSections.some((a) => a.time === s.time));
    if (own.length === 0) continue;

    /** 本提交所有小节的「影响文件」模式，用于提交级的漏列统计 */
    const allImpactPatterns: string[] = [];

    // 最后一个小节才是带总数行的那个
    for (let i = 0; i < own.length; i++) {
      const sec = own[i];
      checkS13(sec, c.short);

      const parsed = parseChangelogCounts(sec.text);
      const isLast = i === own.length - 1;
      if (isLast && curM && opts.runTests) {
        if (parsed === null) {
          report('T4', MODE.ERROR, c.short, `小节 \`## ${sec.time}\` 缺少「引擎 X 项 + … = X 项通过」测试数行`);
        } else {
          const mismatched = PKGS.filter(
            (p) => parsed.counts[p] !== undefined && parsed.counts[p] !== (curM.counts[p] ?? -1),
          );
          const sum = PKGS.reduce((acc, p) => acc + (parsed.counts[p] ?? 0), 0);
          if (mismatched.length > 0) {
            report(
              'T4',
              MODE.ERROR,
              c.short,
              `小节 \`## ${sec.time}\` 的测试数与实测不符`,
              `Changelog 写 ${parsed.total} 项，实测 ${PKGS.reduce((a, p) => a + (curM.counts[p] ?? 0), 0)} 项：` +
                mismatched.map((p) => `${p} ${parsed.counts[p]}≠${curM.counts[p] ?? '—'}`).join('、'),
            );
          } else if (sum !== parsed.total) {
            report(
              'T4',
              MODE.ERROR,
              c.short,
              `小节 \`## ${sec.time}\` 的测试数总分不自洽`,
              `${PKGS.map((p) => parsed.counts[p]).join(' + ')} = ${sum}，但写了 ${parsed.total}`,
            );
          }
        }
      } else if (!isLast && parsed !== null) {
        // 非末小节不该有总数行（S13 已覆盖，这里只提示）
      }

      // ── T6：影响文件（硬错误按小节判——谁列错谁负责）
      // 一个 `##` 下可能有多条 `###`（同一提交的多方面改动），每条各自带一行「影响文件」，
      // 所以要 matchAll 取全部，不能只取第一行。
      for (const impact of sec.text.matchAll(/^-\s+\*\*影响文件\*\*：(.+)$/gm)) {
        const patterns = impactPatterns(impact[1]);
        allImpactPatterns.push(...patterns);
        const missing = patternsWithNoMatch(c, patterns);
        if (missing.length > 0) {
          report(
            'T6',
            MODE.ERROR,
            c.short,
            `小节 \`## ${sec.time}\` 的「影响文件」列出了本次未改动的路径`,
            missing.map((p) => `\`${p}\``).join('、'),
          );
        }
      }
    }

    // T6 的「漏列」按整个提交判：多小节条目会把不同文件写在不同小节，逐小节算会互相误报
    if (allImpactPatterns.length > 0) {
      const uncovered = uncoveredFiles(c, allImpactPatterns);
      if (uncovered.length > 0) {
        report(
          'T6',
          MODE.INFO,
          c.short,
          `${uncovered.length} 个改动文件未被「影响文件」覆盖`,
          uncovered.slice(0, 8).join('、') + (uncovered.length > 8 ? ` 等 ${uncovered.length} 个` : ''),
        );
      }
    }

    // ── T5：Changelog 的测试增量声明与提交信息一致
    // 多小节条目里，增量声明可能分散在各小节（如「新增 1 项」在前、「无新增测试」在后），
    // 所以按整个条目拼起来解析，而不是只看最后一个小节。
    if (!c.isDoc && opts.runTests && curM && prevM) {
      const clDelta = parseTestDelta(own.map((s) => s.text).join('\n'));
      const msgDelta = parseTestDelta(c.body);
      if (clDelta && msgDelta && clDelta.netDelta !== msgDelta.netDelta) {
        report(
          'T5',
          MODE.WARN,
          c.short,
          'Changelog 的测试增量与提交信息不一致',
          `Changelog: ${clDelta.netDelta}　提交信息: ${msgDelta.netDelta}`,
        );
      }
    }
  }

  // ── 报告
  const globalNotes: string[] = [];
  if (opts.runTests) {
    const failed = [...measurements.values()].filter((m) => !m.testsOk).length;
    globalNotes.push(
      `实测 ${measurements.size} 个提交（含范围首个提交的父提交，缓存于 .git/cc-check-cache/）` +
        (failed > 0 ? `，其中 ${failed} 个提交测试未通过` : '，全部测试通过'),
    );
  } else {
    globalNotes.push('已用 --no-tests 跳过实测（T1/T3/T4/T5 未运行）');
  }

  const text = buildReport(opts, commits, measurements, globalNotes);
  if (opts.json) {
    const payload = {
      range: opts.range,
      commits: commits.map((c) => ({
        sha: c.sha,
        short: c.short,
        authorDate: c.authorDate.toISOString(),
        subject: c.subject,
        prefix: c.prefix,
        isDoc: c.isDoc,
        // 纯文档提交没有被自己实测，用最近的非 docs 祖先的数（与报告里的口径一致）
        counts: countsFor(c)?.counts ?? null,
        sections: c.addedSections,
      })),
      findings,
    };
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(payload, null, 2));
    else process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(text + '\n');
    if (opts.out) fs.writeFileSync(opts.out, text + '\n');
  }

  return findings.some((f) => f.level === MODE.ERROR) ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`\n检查器出错：${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  });
