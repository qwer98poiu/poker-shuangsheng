# 双升 (Shengji/Tractor) Card Game

## 项目结构

```
packages/engine/     - 核心引擎（牌型、比较、验牌、AI）
packages/client/     - React 前端
packages/cli/        - CLI 终端版本
packages/arena/      - 策略竞技场（镜像对决、显著性判定）
```

## 提交规范

提交信息使用双语（英文 + 中文），英文正文（details）不超过 12 行；更长的解释写进 Changelog 对应小节，不堆在提交信息里。

| 前缀 | 用途 |
|---|---|
| `fix:` | 修复 bug（含策略 bug） |
| `feat:` | 新功能（非策略） |
| `strategy:` | 修改 AI 策略 |
| `refactor:` | 重构（无行为变更） |
| `test:` | 新增或修改测试（含产物为测试数据/断言的生成器脚本，见下） |
| `docs:` | 文档 |
| `chore:` | 构建/依赖 |
| `skill:` | 新增或修改 skill（`.claude/skills/` 下的技能；提交时用 `git add -f`，该目录在 .gitignore 中） |

**开发脚本（`packages/*/scripts/`）按用途归类**：产物是测试断言或测试场景数据 → `test:`（`gen-bottom-tests.ts`；不改测试套件本身，提交信息与 Changelog 的测试数行均写「无新增测试」）；通用调试基建、供人工手动运行 → `chore:`（`ui-dump.ts`、`ui-smoke.ts`）；本身构成一项可用的检查能力（接入流程）→ `feat:`（`layout-regression.ts`）；仅挪位置/改名/重构 → `refactor:`（`elo-verify.ts → elo-calc.ts`）。

示例：
```
fix: add missing add-points check in followOffSuitThrow void path

Third position with tmWin should check canAddPoints before trumping.
Adds nonTrump.length >= leadLen guard for safe filler selection.

第三家队友已大时，缺门应先检查可加分再毙牌。
新增 1 项测试（engine）。

Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
```

测试数行写 `新增/修改/删除 N 项测试（子包）`——只写测试变动本身、不列测试总数（跨子包写 `新增 3 项测试（engine 1 + client 2）`），无测试改动写 `无新增测试`；数字必须与实际测试结果一致，取数命令见「测试命令」。

### 引用历史：用日期，不用提交哈希

**提交信息、Changelog、代码一律不得引用提交哈希**。

开发过程中改写历史会让旧哈希变成**悬空引用**（`git cat-file` 解析不到，或只解析到改写前的旧对象）——它既指不到任何东西，也失去了「可查」这个唯一优点。日期不会因改写而失效：`MM-DD HH:MM` 取自该提交**自己那条 Changelog 条目**的时间，在文件里就能查到。

- Changelog 正文与代码注释写 `08-23 00:40` 或 `2026-08-23`，不写 `<hash>`：例如「组粒度（08-23 00:40 引入）」「提取 08-14 22:12 的 `ai/`」。
- **不追溯旧账**：只对**本次提交新增的文本**生效；历史上已有的哈希原样保留，不再修改。

**两处例外**（仅限代码载体；提交信息与 Changelog 正文**没有**例外）：

| 例外 | 形态 | 为什么必须留哈希 |
|---|---|---|
| **快照出处注释** | `packages/engine/src/ai-XXXX/` 的出处注释、`// ai/ as of <hash> (日期)` 导出注释、`it('ai-XXXX（<hash>, …）')` 测试名 | 目录名 `ai-XXXX` 只到日，且快照日与提取提交往往不同日（`ai-0808` ← 08-08 的提交、提取在 08-09），只留日期无法唯一定位提取源——必须**同时**给出哈希与日期 |
| **出处字段** | 生成物里记录来源提交的机器可读字段，如布局基线的 `"commit": "<hash>"`（`layout-regression.ts --snapshot` 写入） | 同上；判据看键名（须含 `commit`/`revision`）与值（7–40 位十六进制） |

出处哈希必须**在 main 上可达**（`git merge-base --is-ancestor <hash> main` 成立）：指向被改写掉的旧对象时，眼下还能 `git show <hash>:<path>`，GC 之后彻底失效。

提交前自检与全量校验见 `.claude/skills/check-commits` 的 **S11**（两处例外报 info，其余报 error）。

## Changelog 格式

```markdown
## YYYY-MM-DD HH:MM

### <中文标题>

**问题**：<问题描述>

**修复**：<修复描述>

**新增 N 项测试**（file.ts：M 项），引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过。

- **影响文件**：`path/to/file.ts`
```

Changelog 的测试数行与提交信息不同：列出子包分项与总数（`引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过`）；无新增写 `无新增测试`；删除写 `删除 N 项测试`；client 无测试时省略 `client` 项。每项修改为一个独立的日期时间小节，按时间倒序排列。

**多小节条目**：一个日期时间条目下可包含多个 `###` 小节（同一提交的多方面改动，如策略变更 + 其影响）。只有**最后**一个小节写测试总数（同上一行的分项+总数格式），前面的小节只写 `**新增/修改/删除 N 项测试**（file.ts：M 项）`，不写总数。

## 开发原则

- **用户反馈牌局时（无论要求修 bug 还是理论分析），先执行代码拿到结果，再思考**。应构造场景直接调用引擎 AI（`aiFollowPlay`/`aiLeadPlay` 等，可手写 AIContext 或写临时脚本实测）或写复现测试，先取得实测输出，再基于结果分析；不要先手推逻辑或凭规格推断。修 bug 时：先根据其输入的牌局构造测试用例，确认复现 bug 后再修复。测试应尽可能还原用户描述的场景（手牌、领出、位置等），确保回归测试能捕获同类问题。
- **修改 Changelog 必须在代码提交之前**。每次提交前先写 Changelog，再 `git add` 一起提交。Changelog 时间与提交时间允许相差几分钟，无需强制对齐。
- **Changelog 只在更新代码时写**（fix/feat/strategy/refactor/test 等）；纯文档提交（`docs:` 和 `skill:`）一律不写 Changelog。
- **测试断言优先用精确值**（`toBe(n)`），避免使用 `toBeGreaterThan`、`toBeGreaterThanOrEqual` 等模糊匹配，除非值本身因外部因素不确定。
- **基础模块的测试必须逐项穷举**。对于记牌器这类高阶策略依赖的基础模块，测试覆盖所有视角 × 所有目标玩家 × 所有可能的牌（suit-rank）× 精确张数断言，不允许只验证部分卡牌（记牌器那一套即按此穷举，见 `packages/engine/src/__tests__/ai-nt-tracking.test.ts`）。另外，**测试场景里的庄家（`declarerIndex`）与亮主者（reveal 的 `playerIndex`）必须与真实游戏一致**——庄家身份决定底牌是否进入可能列表，设错会测到另一条分支而测试照样绿，这类错误不会自己暴露。
- **每次提交前必须跑类型检查并清理全部错误**：根目录 `npm run typecheck`，须零错误后才提交（范围与 `scripts/` 的坑见「类型检查」节）。vitest 经 esbuild 转译不做类型检查，类型错误不会导致测试失败，因此必须显式检查。
- **删除符号链接路径下的内容前先确认目标**：`git worktree` 无 node_modules，复用主仓库依赖时通常把 worktree 的 `node_modules` 符号链接到主仓库——此时 `rm worktree/node_modules/@poker/engine` 会顺着链接删掉**主仓库**里的真身（2026-08-15 实测：误删 `@poker/engine` 导致 vite 无法解析）。删除/重建前用 `ls -la`/`readlink` 确认是否为链接及指向；worktree 清理（`git worktree remove`）前先把指向 worktree 内部路径的链接改回相对链接（`../../packages/engine`），否则悬空。

## 测试命令

- **单包测试**：`npm run test -w packages/engine` / `-w packages/cli` / `-w packages/arena` / `-w packages/client`（等价于进入该包目录后 `vitest run`，读取各自的 vitest.config.ts）
- **全量测试**：根目录 `npm run test:all`，依次执行四个单包测试命令（engine → arena → cli → client，任一失败即停止）
- **根目录 `npm run test` 只跑引擎**（根 package.json 的 test 脚本指向 engine）
- **不要从仓库根用 `npx vitest run <包路径>` 统计测试数**——positional filter 在存在多个 vitest.config.ts 时会混入其他包的测试（实测 `npx vitest run packages/cli` 混入 client 测试，127 ≠ 真实 80）
- **Changelog 的测试总数**：运行 `npm run test:all 2>&1 | grep -E "^> @poker/.* test$|Tests +[0-9]+ passed"`，取输出中对应包的 `Tests N passed` 中的 N（四包顺序 = engine + arena + CLI + client），四者之和为总数

## 类型检查

- **命令**：根目录 `npm run typecheck`，按 engine → arena → cli → client → skills 顺序各跑一次 `tsc --noEmit`（与 `test:all` 同风格，任一失败即停止）。提交前必零错误。
- **门禁在 pre-push，不在 pre-commit**：`.githooks/pre-push` 依次跑「工作区 `npm run typecheck` → `npm run test:all` → `check-commits <本次推送范围> --no-tests --no-typecheck`」，任一失败即阻断推送；`git push --no-verify` 可跳过。`core.hooksPath` 由根 `package.json` 的 `prepare` 在 `npm install` 后自动设好，**新克隆无需手工配置**（提交保持快，推送才是「离开本机」的时刻）。
- **本地 `npm run typecheck` ≠ `check-commits` 的 T2**：两者跑的都是 typecheck，但 T2 是在为每个提交新建的**干净 worktree** 里跑，看不见未提交的与被 `.gitignore` 忽略的文件——2026-09-26 实测的最坏组合：本机因 `packages/arena/scripts/` 下三个被忽略的实验脚本而红，而 T2 报告「通过」。**两者不可互相替代**，门禁里跑的是前者；同理，把一个文件写进 `.gitignore` 并不会把它移出 tsconfig 的 `include`（`include` 按目录取），必须同步加 `exclude`。
- **历史坑一（范围）**：该条原先只写「engine 与 client」，`cli`/`arena` 从未被检查过——2026-09-19 修掉的 13 个 TS2345（`packages/cli/src/__tests__/round-result.test.ts`）在此之前一直存在于 HEAD 上，而 vitest 全绿。
- **历史坑二（`scripts/`）**：四个包的 `tsconfig.json` 都只 `include: ["src"]`，**`packages/*/scripts/` 不在任何 tsconfig 范围内**。有 scripts 的包（engine / arena / client）另配 `tsconfig.scripts.json`，已并入该包的 `typecheck` 脚本；新增含 scripts 的包要同步补一个，否则脚本仍然裸奔。
- **历史坑三（`.claude/skills/`）**：skills 在四个包之外，同样不在任何 tsconfig 范围内，脚本一直裸奔——2026-09-26 接入时当场报出 6 个错误（`inject-gui.ts` 的 `JSON.parse` 未定型 → `Object.values` 推成 `unknown[]`，各处展开报 TS2488、回调参数隐式 any）。现由根 `tsconfig.skills.json`（`include: [".claude/skills"]`）与根 `typecheck:skills` 脚本覆盖；**新增带 `.ts` 的 skill 自动纳入，不必再改配置**。
- **花色类型**：`Suit`/`SpecialSuit` 是 `as const` 对象 + 同名联合类型（2026-09-19 由**字符串枚举**改来；字符串枚举是名义类型，那时 `'S'` 赋给 `CardSuit` 会报 TS2345，没有任何编译器开关能放宽）。现在 `Suit.Spades` 与 `'S'` 都合法，不需要任何 cast；`Rank` 仍是数值枚举，传裸数字合法（`createCard(Suit.Spades, 14, 200)`）。
- **不要用 `as any` 消音**：那会把整条链路的类型检查一起关掉——`createCard(s, r as any, i)` 就是反例，它同时掩盖了 rank 传错这类真错误。类型实在对不上时用最小必要的 cast（`as CardSuit` 而非 `as any`）。

## 依赖

- **tsx 钉在 `~4.16.5`，不要升到 4.17+**（2026-10-01 起本地依赖）。4.17 起 tsx 要求 esbuild `~0.23`+，而根已有 esbuild 0.21.5（vite/vitest 那条线）：npm 8 不会为嵌套的 esbuild 装同名平台包 `@esbuild/darwin-x64`（嵌套目录建了但为空），esbuild 的 postinstall 便拿根那份去校验，报 `Expected "0.28.2" but got "0.21.5"`，`npm i` 失败回滚；`--ignore-scripts` 也不行（平台包缺失，tsx 一启动就 TransformError）。4.16.5 要 `~0.21.5`，dedupe 到已有那份，零新增 esbuild——**区间必须写 `~` 而非 `^`**，`^4.16.5` 会在下次 `npm install` 解析回 4.23 并把安装弄坏。
- **`npx tsx` 与本地 `tsx` 的取舍**：仓库自己的入口（`npm run arena`、`npm start -w packages/cli`）直接调本地 `tsx`；文档与脚本注释里的 `npx tsx …` 保持原样——那些命令在普通终端里跑，PATH 上没有 `node_modules/.bin`。本地有依赖后 npx 不再联网（解析不到才会联网下载，2026-09-30 那晚的竞技场卡死正是这个形态）。

## 布局回归检查

- **用途**：修改任意 GUI 组件的位置后，验证其他所有组件位置不变（历史教训：给 `.center-area` 加 `position: relative` 导致等级框掉到桌布上——定位祖先被劫持）。
- **用法**（vite dev server 默认跑在 3000；该端口被占用时 vite 会顺延到下一个可用端口并打印实际地址，那就用 `--url` 指定它。浏览器 = 系统 Chrome）：
  - 检查：`cd packages/client && npx tsx scripts/layout-regression.ts`——注入 6 个代表性阶段（发牌/亮主/扣底/出牌/甩 10 张/局末），测量 40 个关键组件的矩形，与基线 `scripts/layout-baseline.json` 比对；任一组件位移 >1px 时列出该组件及精确 delta，退出码 1。
  - 生成基线：`npx tsx scripts/layout-regression.ts --snapshot`——**仅当人工确认当前布局正确时**执行；基线随代码提交，视口固定 1280×720。
- **有意移动组件时**：人工确认全布局正确后重新 `--snapshot` 更新基线，再提交。

## Elo 分与 README 数值

- **用途**：README 中英两张表里的 Elo 分是**实测快照**（`packages/arena/scripts/elo-calc.ts` 拟合，锚点 `ANCHOR_ELO`）。被测代码或测量口径一变旧数字就失效，**必须改标 `待重测`（TBD）**——中英两处都改，不得让旧分数挂着不动。
- **失效范围按被测物的依赖边界划分**（实测：冻结快照只 import 共享模块 `model`/`pattern`/`comparing`/`following`/`types`，**不 import `ai/`**——所以改 `ai/` 只波及当前行，改共享模块才波及全表）：

  | 改了什么 | 失效范围 | 处理 |
  |---|---|---|
  | `packages/engine/src/ai/` 策略代码 | 仅 `ai`（当前）一行 | 该格改 `待重测`；基线行与锚点不动 |
  | 共享引擎代码——`model.ts`、`pattern/`、`comparing/`、`following/`、扣底/升级、发牌 | **整张表**（含锚点） | 全表重测；口径变了（如扣底口径）另开一表，不与旧表混列 |
  | `packages/engine/src/ai-XXXX/` 冻结快照 | 该基线 | 不应改动——快照是 `git archive` 产物，改了就不再是那个日期的策略 |
  | 策略接线（`packages/arena/src/strategies.ts` 的策略名 → 引擎入口） | 被改接线的那些行 | 名字必须继续指同一份代码；换实现 = 换策略，旧分不成立 |
  | 竞技场测量口径（`packages/arena/src/run.ts`、镜像对局、平局按 0.5、n 局数） | `MATCHES` 全部 p̂ | 重跑对局、重填 `MATCHES` |
  | `ANCHOR` / `ANCHOR_ELO` | 整张表（构造上） | 只在有意改刻度时动 |

- **判据是「行为是否可能改变 AI 决策或牌局结算」**，不是「是否动了 engine 目录」：纯注释、纯类型、测试、无行为变更的重构、尚未接线的导出函数不必改标。**拿不准就改标**——旧数字挂着不动的代价远大于多测一次。
- 重测后按 `elo-calc.ts` 的读数规则填表（新拟合值与表中原值只差 **1** 时保留原值）。CLI / GUI 改动**不影响** Elo——竞技场在 Node 里直接跑引擎，不经前端。

## 命名约定

- **内部编号 P0-P3**：代码和测试中统一使用，P0=玩家1、P1=AI-2、P2=AI-3、P3=AI-4。不存在 P4。
- **外部显示**：CLI 输出使用 `玩家1`（非 AI）或 `AI-2`（AI），由 `playerLabel(idx)` 生成。
- **测试注释中的玩家标注**：优先使用 P0-P3 内部编号，或用 `P2(AI-3)` 同时标注两者。

## AI 策略文档

参见 [packages/engine/src/ai/STRATEGY.md](packages/engine/src/ai/STRATEGY.md)。
