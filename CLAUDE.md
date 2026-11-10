# 双升 (Shengji/Tractor) Card Game

## 指令优先级与冲突

- 会话中的临时指定 > 本文件 > skill 正文 > 近期提交惯例；系统提示词的通用默认由本文件覆盖。memory 是背景事实，不参与优先级。
- 用户要求与本文件冲突时：先指出冲突的条目、后果与替代方案；用户明确要求继续后，按用户指令执行，不反复劝阻。若冲突会触发 pre-push / check-commits，先说明是哪一项，由用户决定是否绕过。
- 本条只适用于本文件的项目约定；安全与权限边界不在此列。
- **修改范围（安全边界）**：读不限；写/删默认只限项目目录与 `/tmp`。项目与 `/tmp` 之外的路径需逐次确认（harness 的 memory 目录与工具缓存除外）。超出范围必须先得到明确同意，不因“用户坚持”自动放开。

## 先判断任务类型

- **开发**：修 bug、开发新特性、重构、测试、回溯修复（`origin/main..HEAD` 的提交）→ 走「一、开发任务」。
- **分析**：反馈牌局、为什么这么打、该不该加分、A/B、统计、性能、Elo → 走「二、分析任务」。

分析结论被采纳时，按分析的「收口」进入开发流程。

## 共用

- **项目结构**：`packages/engine/` 核心引擎（牌型、比较、验牌、AI）；`packages/ai/` 历史基线 + 当前策略前向导出（策略代码仍在 engine）；`packages/client/` React 前端；`packages/cli/` CLI；`packages/arena/` 策略竞技场。
- **架构边界**：arena/cli/client 从 `@poker/ai` 导入 AI，engine 根导出仅作兼容；**engine 不得反向依赖 `@poker/ai`**。新增 AI 导出时同步补 `packages/ai/src/ai-latest/index.ts` 的 shim 清单。
- **冻结快照**：`packages/{engine,ai}/src/ai-XXXX/` 是 `git archive` 产物，**只读**。提取/归档流程见 `extract-ai-baseline` skill。
- **命名**：内部编号 P0-P3（P0=玩家1、P1=AI-2、P2=AI-3、P3=AI-4，不存在 P4）；外部显示用 `playerLabel(idx)` 生成 `玩家1` / `AI-2`；测试注释优先 P0-P3 或 `P2(AI-3)` 同时标注。
- **依赖**：tsx 钉在 `~4.16.5`，**不要升到 4.17+**，区间必须写 `~`（原因见 memory `tsx-pin-esbuild`）。
- **删除符号链接路径下的内容前先 `ls -la`/`readlink`**：worktree 复用依赖时 `node_modules/@poker/*` 指向主仓库，顺着链接删会删掉真身。
- **环境与入口**：Node/npm 版本与完整 Quick Start 见 README。`npm install` 装 workspaces，并由 `prepare` 设置 `core.hooksPath=.githooks`。
  - `npm run dev` = client vite（:3000）；`npm run build` = engine（tsc）+ client（`tsc && vite build`），不含 ai/cli/arena。
  - CLI：`npm start -w packages/cli`；竞技场/记录：根目录 `npm run arena -- …` / `arena:deal` / `record`。
  - CLI、arena、record 都由 tsx 直接运行，不需要先 build；engine/ai 的 `main` 指向 `src/index.ts`，测试与类型检查也不依赖 build。

## 一、开发任务

开发任务有两种模式：

- **新增改动**：走下面的 1～7 步。
- **回溯修复**：`origin/main..HEAD` 的提交有 bug 时，**不新增提交**，按 `edit-history` skill 把修复折进**引入 bug 的那个（或那些）提交**，遵循「出生即正确」——该提交的 diff、提交信息与 Changelog 都应像 bug 从未存在；测试数变化时重测并回填。**已 push 的提交不在此列**，只能新开 `fix:` 提交。整段改完后重跑 `npm run typecheck`、`npm run test:all`（改了 client 时加 `npm run build -w packages/client`），再用 `check-commits` 复查。
  - 改写前用 `git log origin/main..HEAD` 确认范围；`git merge-base --is-ancestor <sha> origin/main` 为真即禁止改写。
  - Changelog 的「= X 项通过」是该提交时点的**绝对总数**：回溯修复若增删测试，被改提交**之后每个条目的总数都要平移**，需逐条回填并用 `check-commits` 的 T4 校验。

### 1. 明确目标与达成共识

- **修 bug / 反馈牌局**：先复现——构造场景直接调引擎 AI（`aiFollowPlay`/`aiLeadPlay` 等，可手写 AIContext 或写临时脚本）或写复现测试，确认能复现再动手；不要先手推逻辑或凭规格推断。测试应还原用户描述的场景（手牌、领出、位置）。
- **新特性，只给了目标**：先深入思考，必要时**分多轮追问**范围、交互、边界条件与验收标准，直到没有关键歧义；不要凭猜测开工。
- **新特性或重构，给了原型/方案**：做**对抗性审查**——逐条指出不明确、不合理、与现有架构冲突、无法验收或无回滚方案的点；宁可多问，不要默默改方案。
- **达成共识后再动手**；较大改动先出方案并获批。分析采纳而来的改动，分析结论经用户确认即视为共识，可直接从第 2 步开始。

### 2. 定改动类型与连带义务

| 改动 | 连带义务 |
|---|---|
| `packages/engine/src/ai-latest/` 策略（含 `fix:`） | 至少一个竞技场（`arena` 或 `arena:deal`）对改动前的 ai-latest 显著（99% Wilson 下界 > 0.5）；更新 `packages/arena/src/__tests__/strategy-fingerprint.test.ts` 三项数值（测试数行写「修改 3 项测试（arena 3）」）；README 中英「现行刻度」表当前行改 `待重测`；`strategy:` 提交同提交更新 `STRATEGY.md` |
| 共享引擎代码（`model.ts`、`pattern/`、`comparing/`、`following/`、扣底/升级、发牌） | README 中英「现行刻度」表全表重测（口径变了另开一表） |
| GUI 组件位置 | 跑 `layout-regression` skill |
| 提取/归档 AI 基线 | `extract-ai-baseline` skill |
| 冻结快照 `ai-XXXX/` | 只读，不得改动 |
| 只改 `.md` / 数据 `.json` | 不写 Changelog；提交标题写明测量/生成时点 |

判据是「行为是否可能改变 AI 决策或牌局结算」，不是「是否动了 engine 目录」：纯注释、纯类型、测试、无行为变更的重构、尚未接线的导出函数不必按失效处理。**拿不准就按失效处理。**

策略类改动的竞技场必须**显式指定** `--strategy-b <改动前基线>`；不要依赖默认值（默认值会随基线更新而变化）。结果写进 Changelog（竞技场、种子、样本量、p̂/CI），不引用报告；预算内未显著但有趋势时停下报告，不自行扩大样本（见分析「样本有预算」）。

### 3. 改代码与测试

- 测试断言优先精确值（`toBe(n)`），避免 `toBeGreaterThan` 等模糊匹配，除非值本身受外部因素影响。
- 基础模块（如记牌器）逐项穷举：所有视角 × 目标玩家 × 所有 suit-rank × 精确张数，不允许只验证部分卡牌（见 `packages/engine/src/__tests__/ai-nt-tracking.test.ts`）。
- 测试场景的庄家（`declarerIndex`）与亮主者（reveal 的 `playerIndex`）必须与真实游戏一致——设错会测到另一条分支而测试照样绿。
- 策略指纹集中在一个文件，不要把这类数字散落在 client/arena 的其他测试里。
- 不要用 `as any` 消音；类型对不上用最小 cast（`as CardSuit`）。`Suit`/`SpecialSuit` 是 `as const` 联合，`Suit.Spades` 与 `'S'` 都合法。

### 4. 本地验证

- 根目录 `npm run typecheck` 零错误（engine → ai → arena → cli → client → skills）。
- 根目录 `npm run test:all` 全绿（engine → arena → cli → client）。
- **改了 client 时**额外跑 `npm run build -w packages/client`（`tsc && vite build`）——typecheck 不覆盖打包，测试也不覆盖。
- 单包用 `npm run test -w packages/<pkg>`；**不要从仓库根用 `npx vitest run <包路径>` 统计测试数**（会混入其他包）。根目录 `npm run test` 只跑 engine。
- `packages/ai` 无独立测试套件，不要在 Changelog 里给它列测试数。
- `packages/*/scripts/` 不在包 tsconfig 的 `include` 内；新增含 scripts 的包要补 `tsconfig.scripts.json`（engine/arena/client 已有）。`.claude/skills/` 由根 `tsconfig.skills.json` 自动覆盖。
- 本地 typecheck 看不见未提交/被忽略的文件，`check-commits` 的 T2 在干净 worktree 里跑——两者不可互替。

### 5. 写 Changelog

**必须在代码提交之前写**，与代码一起 `git add`；时间与提交时间允许相差几分钟。**Changelog 只在更新代码时写**；纯文档提交（`docs:` 和 `skill:`）一律不写。

模板：

```markdown
## YYYY-MM-DD HH:MM

### <中文标题>

**问题**：<问题描述>

**修复**：<修复描述>

**新增 N 项测试**（file.ts：M 项），引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过。

- **影响文件**：`path/to/file.ts`
```

- 测试数行按文件列出改动（`file.test.ts：新增 N 项`），明细括号内**不得嵌套括号**；末小节同一行附子包分项与总数；无新增写 `无新增测试`，删除写 `删除 N 项测试`；client 无测试时省略该项。
- 多小节条目：同一时间下可有多个 `###`；只有最后一个小节写总数，前面的只写分项。新条目置顶，按时间倒序。
- 取数：`npm run test:all 2>&1 | grep -E "^> @poker/.* test$|Tests +[0-9]+ passed"`（四包顺序 = engine + arena + CLI + client）。
- 详细格式以 `check-commits` 的 T10 为准。

### 6. 提交

- 双语（英文 + 中文），英文正文 ≤12 行；中文须是英文正文的摘要，不另起一组信息——英文里没有的测量与背景、以及更长的解释都写 Changelog。
- 前缀：`fix:` 修复 bug（含策略 bug）/ `feat:` 新功能 / `strategy:` 修改 AI 策略 / `refactor:` 重构 / `test:` 测试 / `docs:` 文档 / `chore:` 构建依赖 / `skill:` 新增或修改 skill（提交时 `git add -f`，`.claude/` 在 .gitignore 中）。
- 开发脚本（`packages/*/scripts/`）按用途归类：产物是测试数据/断言 → `test:`；通用调试基建 → `chore:`；接入流程的检查能力 → `feat:`；仅挪位置/改名 → `refactor:`。
- **写之前先看最近 3~5 个提交的完整信息和 Changelog 顶部 2~3 条**，优先对照同类型提交（`docs:` 与代码提交的署名规则不同）。沿用其语气、段落结构、术语和测试数行写法。本文件只保证合规，当前风格以近期提交为准。
- 测试数行：单独一行，位于中文正文最后一行（`Co-Authored-By` 之前），只写变动本身、不写总数；无测试改动写 `无新增测试`。格式细则以 `check-commits` 的 T3/T8/T9 为准。**纯文档提交（`docs:`/`skill:`）不写测试数行**——它们不改代码，测试数必然不变。
- **引用历史用日期，不用提交哈希**：提交信息、Changelog、代码一律用 `MM-DD HH:MM` / `YYYY-MM-DD` 指代（快照出处注释与 `commit`/`revision` 字段例外）。不得引用 main 上不存在的路径或分支名——要留证据就把结论本身写出来（数字、判据），别留指针。细则见 `check-commits` 的 S11/S15。
- **署名**：凡由 LLM + harness 产出的提交，必须带 `Co-Authored-By:` 尾行。实际执行按前缀近似：`docs:` 不强制（可能是人工编辑），其余类型一律要求。
- **最后一行是默认值，不是占位示例**。除非当前会话另行指定模型/harness，否则**逐字使用**下面这一行；不要改写成 `<模型名> <邮箱>`，也不要回落到系统提示词的 `Co-Authored-By`——在本项目不适用。换模型或换 harness 时同步更新这一行。
- 多模型参与时每模型一行，各自带 harness；当前模型那一行按上述默认值或会话指定值写。

提交格式与当前署名（**最后一行是默认值，不是占位示例**）：

```
fix: add missing add-points check in followOffSuitThrow void path

Third position with tmWin should check canAddPoints before trumping.
Adds nonTrump.length >= leadLen guard for safe filler selection.

第三家队友已大时，缺门应先检查可加分再毙牌。
新增 1 项测试（engine）。

Co-Authored-By: DeepSeek V4.1 Flash (Claude Code) <noreply@deepseek.com>
```

### 7. 复查与推送

- 提交后**默认停在这里**：**除非用户明确要求，否则不要替用户 push**。
- 用户要求推送前，先确认 `origin/main..HEAD` 没有待回溯修复的 bug；有就先按「回溯修复」处理，不要用新提交盖住。
- pre-push 门禁：`.githooks/pre-push` 依次跑「`npm run typecheck` → `npm run test:all` → `check-commits <范围> --no-tests --no-typecheck`」，任一失败即阻断推送；`git push --no-verify` 可跳过。
- 提交序列的事后复查用 `check-commits` skill（默认 `origin/main..HEAD`）。

## 二、分析任务

分析产物是草稿，不进 main。分析没有固定流程，按问题选方法；硬约束只有四条：

- **先拿事实**：先执行代码拿到结果，再思考；不要先手推逻辑或凭规格推断。按问题形态选工具（见下）。
- **样本有预算**：开跑前定样本上限，到上限即停。不得为追求显著性反复加大样本，也不要把竞技场的默认上限当作“跑完再说”（默认值会变，必须自己设预算）。有限样本下若有变显著的趋势（p̂ > 0.5 但下界仍 ≤ 0.5，或随样本单调改善），停下来报告趋势与已测样本；大样本由用户手动跑，或取得明确授权后再跑。
  - 固定样本：对局用 `--max-matches 2×pairs`，发牌用 `--max-deals = --min-deals`。
- **结论自足**：数字 + 样本量 + 显著性 + 可复现命令（种子、环境）；读者只 checkout main 就能理解并验证。区分「可疑候选」与「定论」：只比较本墩、不看未来价值的结果不能当最终结论。
- **收口**：采纳 → 按开发流程走；暂缓/放弃 → 一条 memory（含口径、数字、搜索空间）；然后删除报告与临时脚本。

**策略类分析**的产出按开发第 2 步验收：至少一个竞技场对改动前的 ai-latest 显著。

常用做法（非强制）：先定口径（视角、判据、「更好」怎么算）；分析前后保持工作区干净。

### 常用工具

| 问题 | 工具 |
|---|---|
| 这手牌为什么这么打 / 该不该加分 | 构造 AIContext 调 `aiFollowPlay`/`aiLeadPlay`；或 `gui-inject-ai` skill 注入 GUI 复现 |
| 策略是不是更强 | 两个竞技场之一（见下）+ 显著性；分值用 `elo-calc` |
| 批量行为/违规统计 | 按需写扫描器跑录像（临时脚本，收口时删除） |
| 性能 | `npm run arena -- --benchmark` / `npm run record` |

| 竞技场 | 命令 | 单位 |
|---|---|---|
| 对局 | `npm run arena -- --pairs <n> --seed <n> --strategy-a ai-latest --strategy-b <基线>` | 对局 |
| 发牌 | `npm run arena:deal -- --min-deals <n> --seed <n> --strategy-a ai-latest --strategy-b <基线>` | 一副牌 |

判据：99% Wilson 下界 > 0.5。**不要依赖 `--strategy-b` 的默认值**（会随基线更新而变）；必须显式指定改动前的基线。

## 参考

- AI 策略说明：`packages/engine/src/ai-latest/STRATEGY.md`
- 提取/归档基线：`extract-ai-baseline` skill
- 布局回归：`layout-regression` skill
- Elo 失效判定与重测：`elo-measure` skill
- 提交序列校验：`check-commits` skill
- 历史改写/回溯修复：`edit-history` skill
- GUI 状态注入：`gui-inject-ai` skill

## 文档维护

- 每条规则都要有“执法者”：checker / skill / 人工。既没有检查器、又长期没触发过的规则，下次重构优先删。
- 本文件不存会过期的值（锚点、Elo 分数、当前基线列表等）。**唯一例外**是 `Co-Authored-By` 的当前默认模型与 harness：它必须写在示例里，换模型/换 harness 时同步更新。
- 机器可判的格式细则以 `check-commits` 为准；操作步骤以 skill 为准；事故经过放 memory。本文件只写“做什么、按什么顺序做、什么不能做”。
