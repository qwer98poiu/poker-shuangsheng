---
name: check-commits
description: 逐提交校验提交序列是否满足 CLAUDE.md 规范——每个提交测试全绿、author date 递增、Changelog 时间与数值断言属实、影响文件属实、不引用提交哈希、冻结快照只读。默认范围 origin/main..HEAD，可指定任意范围。
---

# 提交序列一致性检查

## 触发场景

用户要求「检查提交序列」「校验最近的提交」「查最近几个提交合不合规」「检查 Changelog 数字对不对」时执行。

默认检查 `origin/main..HEAD`；用户给了范围（`HEAD~5..HEAD`、某个 hash、`--last N`）时按给定范围检查。

## 这个技能解决什么

`CLAUDE.md` 的提交规范里有大量**数值断言**——「新增 N 项测试」「引擎 X 项 + arena X 项 + …… = X 项通过」「影响文件：……」——但没有任何自动化在事后验证它们。vitest 经 esbuild 转译不做类型检查，`test:all` 只在提交前手工跑一次。

更关键的是：**历史改写（`edit-history`）之后没有任何复查机制**。提交被前移/合并/回填后，author date 变了、测试数变了，而 Changelog 里的数字和引用还停在改写前的那条历史线上。

实测本仓库 `origin/main..HEAD` 首次运行即报出这类缺陷（后已逐条就地修正）：`09-19 08:55` 的 Changelog 写「= 1178 项通过」而该提交实测 1120 项，并列了三个**从未存在于任何提交**的 `packages/arena/scripts/nt-*.ts` 作为影响文件；`09-09 00:13`、`09-19 08:55`、`09-19 09:47` 三个提交用哈希指代历史。

## 用法

```bash
cd /Users/jia/Documents/project/poker

# 默认：origin/main..HEAD
npx tsx .claude/skills/check-commits/check-commits.ts

# 指定范围
npx tsx .claude/skills/check-commits/check-commits.ts HEAD~5..HEAD
npx tsx .claude/skills/check-commits/check-commits.ts HEAD~1          # 单个提交（等价于 HEAD~1^..HEAD~1）
npx tsx .claude/skills/check-commits/check-commits.ts --last 10

# 只跑结构检查，不跑测试（秒级返回）
npx tsx .claude/skills/check-commits/check-commits.ts --no-tests --no-typecheck

# 其它
--jobs N             并发 worktree 数（默认 2）
--json / --out FILE  机器可读输出
--keep               保留 worktree 便于排查
--verbose            打印每个提交每个包的实测过程
```

退出码：有 error → `1`，否则 `0`；检查器自身出错 → `2`。

**耗时**：每个提交要跑四包测试 + 类型检查，实测（4 核机器、`--jobs 2`）约 1.5~2 分钟/个；默认范围 18 个提交里 14 个要实测，整体约 20~25 分钟。结果按 sha 缓存在 `.git/cc-check-cache/`，重跑秒回——改了实测口径（命令、解析方式、垫片）时把脚本里的 `CACHE_VERSION` 加一即可作废旧缓存，不必手动删目录。急着看结构问题就先跑 `--no-tests --no-typecheck`，秒级出结果。

**实测范围会比提交数多一个**：除范围内每个提交的「基准」外，还会额外实测**范围首个提交的父提交**，否则首提交的 T3 增量无从计算（结果里能看到「实测 N 个提交」比提交数多 1）。

## 检查项

三级：**error**（影响退出码）/ **warn** / **info**。纯文档指 `docs:` 与 `skill:` 前缀（规范：一律不写 Changelog）。

### 结构类（不跑测试）

| # | 检查 | 级别 |
|---|---|---|
| S1 | 提交 author date 自旧到新严格递增 | error |
| S2 | 提交信息前缀在 `fix/feat/strategy/refactor/test/docs/chore/skill` 白名单内 | warn |
| S3 | 非纯文档提交必须新增 ≥1 个 `## 时间` Changelog 小节 | error |
| S4 | 纯文档提交不得修改 `CHANGELOG.md` | error |
| S5 | 纯文档提交不得改动 `packages/**`、根 `package.json`、`tsconfig*.json` | error |
| S6 | 新增的 `## 时间` 行必须位于文件首个 `## ` 位置（新条目置顶） | warn |
| S7 | Changelog 全文 `## ` 时间严格递减 | error |
| S8 | Changelog 无缺少 `## ` 前缀的孤立时间行 | error |
| S9 | 每个新增 `## 时间` 行只被一个提交引入 | error |
| S10 | Changelog 时间不得晚于该提交 author date（早 >40 分钟另报 warn：多半是映射错了） | error / warn |
| S11 | **不得引用提交哈希**：提交信息、Changelog、代码一律用日期指代历史 | error |
| S12 | 英文正文 ≤12 行；`Co-Authored-By:` 尾行存在 | 纯文档 info；改代码 warn |
| S13 | 同一 `##` 下只有**最后一个** `###` 带「= X 项通过」总数行 | error |
| S14 | 冻结快照 `packages/engine/src/ai-XXXX/` 只读 | error |

### 实测类（跑测试 / 类型检查）

| # | 检查 | 级别 |
|---|---|---|
| T1 | 每个非纯文档提交，四包测试全绿 | error |
| T2 | 有 `typecheck` 脚本的提交，`npm run typecheck` 零错误 | error |
| T3 | 提交信息声明的测试增量 == 实测 Δ（逐包） | error |
| T4 | Changelog「引擎 X + arena X + CLI X + client X = X 项通过」逐项等于实测，且总和自洽 | error |
| T5 | Changelog 的测试增量声明与提交信息一致 | warn |
| T6 | 「影响文件」列出的路径本次确有改动（漏列的文件仅 info） | error / info |

### 关键口径

**提交 ↔ Changelog 条目的映射**用权威方式而非时间近似：`git show <sha> -- CHANGELOG.md` 取出该提交**新增**的 `## ` 行——谁把时间行写进文件，谁就是它的主人。这比「时间差最小的那个」可靠得多。

**T3 的基准**是「最近的非纯文档祖先」，不是父提交——纯文档提交不改代码，测试数必然等于其祖先。范围首提交的父提交会被额外实测一次，所以首提交也会被检查。

**T3 的增量口径**：`新增 N` 计 `+N`、`删除/移除 N` 计 `−N`、`修改/重写` 与 `无新增测试` 计 `0`。逐包分解只在括号能唯一对应到子句时硬校验；`新增 34 项、重写 9 项、修改 2 项测试（engine 43 + arena 1 + client 1）` 这类括号横跨多个动词的写法推不出逐包分配，降为 info 并打印实测逐包 Δ 供人工核对。

**S11 的探测分三种载体**（只扫本次提交引入的文本，不翻旧账）：提交信息与 Changelog 增行是散文语境，命中 `[0-9a-f]{7,40}` 即报；代码增行只在该 token 能解析成 commit 对象时报（`#1a2b3c` 这类颜色/ID 天然解析不到）。

**S14**：整体删除快照目录 = info（归档合规）；新增快照目录 = info（提取基线）；目录内**文件被修改/新增/删除** = error。`extract-ai-baseline/SKILL.md:58-59` 允许「死代码清理与注释」两类例外，故 error 文案会打印改动的文件并附该例外说明，需人工判定。

**T6 的宽松比对**：能识别折叠写法——`packages/{engine,cli,client}/src/**/__tests__/`（brace 展开 + glob，`**/` 匹配零层目录）、`packages/engine/src/ai-0816/`（目录前缀）、`` `x.ts`（新） ``（括号尾注在反引号外，不影响）。比对本就不含 `CHANGELOG.md`（规范示例一律不列它）。硬错误按小节判（谁列错谁负责），漏列按整个提交判（多小节条目会把不同文件写在不同小节，逐小节算会互相误报）。

## 报告解读

- 每个提交一行摘要 + 四包实测数；下面缩进列出该提交的每个非 PASS 发现，**失败项都带期望值 vs 实测值**，可直接拿去改。
- `范围级检查` 是 S7/S8 这类整文件检查（不属于某个提交）。
- 末尾 `汇总` 按 error/warn 分组，便于一次看完要改什么。

修复时配合既有技能：Changelog 时间不对用 `fix-changelog-time`；条目与提交对不上用 `gen-changelog-map` 人工核对；要改历史用 `edit-history`。

## 核心机制：按提交隔离跑测试

在 `.git/cc-check-wt/<sha>` 建 `git worktree`，跑完即删。**关键点是 node_modules 垫片**，两个坑都踩过：

1. **相对链接会把代码跑错**。主仓库里 `node_modules/@poker/engine -> ../../packages/engine` 是**相对**符号链接。若直接把整个 node_modules 软链进 worktree，`../../packages/engine` 会解析回**主仓库**的包——测试跑的是当前代码而不是历史代码，所有实测数字都变成当前值（这个坑很隐蔽，会让人以为历史本来就一致）。所以垫片里除 `@poker` 外全部用绝对链接指回主仓库，唯独 `@poker/*` 用相对链接解析到 worktree 自己。
2. **只镜像根 node_modules 不够**。有些依赖没被提升到根，而是装在 `packages/<pkg>/node_modules/`（本仓库里 client 的 `playwright-core` 就是）。漏掉它会让 `tsc -p tsconfig.scripts.json` 报 TS2307「找不到模块」，把本来干净的提交误判成类型检查失败——第一次全量跑就撞上了，`09-19 08:55`、`09-19 09:47` 两个提交被冤报。所以每个 `packages/<pkg>/node_modules` 也要同样镜像一份。

`.vite` / `.cache` 是构建缓存，跳过不链——否则历史提交会复用主仓库的缓存。

**安全**：清理前断言 `node_modules` 是真实目录而非符号链接、且 `@poker/*` 解析后仍在 worktree 内，再先 `rm -rf node_modules` 后 `git worktree remove`。绝不对软链路径递归删除（`CLAUDE.md` 有专门警告：顺着链接删会毁掉主仓库）。

## 已知局限

- **S11 的代码扫描**只能认出**仍存在于对象库**的 hash（含 backup 分支）。被 GC 掉的改写前 hash 扫不出来。
- **S12 的英文正文行数**是启发式：数到第一行含 CJK 的行为止。提交信息里若中英混排在同一行，会提前截断。
- **S12 对纯文档提交恒为 info**：`docs:` 提交本就不写 `Co-Authored-By` 尾行（如 `09-23 00:11` 那条），报出来属预期噪音，不是要修的问题。
- **Changelog 条目与提交内容的语义匹配**机器判不了——时间对得上但内容张冠李戴时不会报错。报告里并排的「条目标题 ↔ 提交 subject」仅供人工扫一眼。**这一项试过三种可判定代理，结论是都不值得接成检查项**，过程记录在此以免后人重踩：
  - ①「条目反引号 token 出现在本次 diff 里」→ 无用。命中 20+ 处，绝大多数是**合法背景引用**（`09-19 08:27` 的条目提 `game/index.ts`、`determineWinner`，是为了说明「大家都按这个约定读，只有它在乱读」）。
  - ②「条目引用的路径存在于该提交树中」（朴素）→ 无用，全是形态噪声：目录 token（`packages/cli`）、裸文件名（`types.ts`）、类型字段（`ChildReply.statsA/statsB`）。
  - ③ ②+噪声处理后 → 13 个条目命中 3 个，其中 **3 处真问题恰恰是 T6 已经报过的**（`09-19 08:55` 那三个从未提交过的 `nt-*.ts`，它同时写进了「影响文件」行）。
  - 根因是结构性的：**「影响文件」那一行是条目在「断言」，正文其余部分是「叙述」**，叙述天然会引用前置代码、别人改的文件、以后才有的文件。所以对正文的扫描只会不断重新发现断言里已列过的文件，再搭上假阳性（实测边际收益 +0 真阳性 / +1 假阳性）。
  - 若将来仍要做，③ 的工程要点：排除 glob（交给 T6 的匹配器）、含空格的（命令行）、以 `-` 开头的（flag）、`Type.member`、有点但非扩展名；目录按前缀或任一路径段匹配；**裸文件名按 basename 匹配**（条目里大量相对写法）；**查父提交树**（本提交删除的路径在自身树里必然不存在）；报告按 basename 去重。
  - 即便做出来，它也**测不出「条目归错提交但内容确实存在」**——那种情况只能靠人看并排的标题。
- **不是提交前门禁**：本技能面向「事后复查一段已存在的历史」，尤其是历史改写之后。提交前仍按 `CLAUDE.md` 手工跑 `npm run test:all` 与 `npm run typecheck`。
