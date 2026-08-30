# 双升 (Shengji/Tractor) Card Game

## 项目结构

```
packages/engine/     - 核心引擎（牌型、比较、验牌、AI）
packages/client/     - React 前端
packages/cli/        - CLI 终端版本
packages/arena/      - 策略竞技场（镜像对决、显著性判定）
```

## 提交规范

提交信息使用双语（英文 + 中文）：

```
<type>: <English short description>

<English details (if needed)>

<中文简述（可选）>

Co-Authored-By: DeepSeek V4 Flash <noreply@deepseek.com>
```

英文正文（details）不超过 12 行；更长的解释写进 Changelog 对应小节，不堆在提交信息里。

| 前缀 | 用途 |
|---|---|
| `fix:` | 修复 bug（含策略 bug） |
| `feat:` | 新功能（非策略） |
| `strategy:` | 修改 AI 策略 |
| `refactor:` | 重构（无行为变更） |
| `test:` | 新增或修改测试 |
| `docs:` | 文档 |
| `chore:` | 构建/依赖 |
| `skill:` | 新增或修改 skill（`.claude/skills/` 下的技能；提交时用 `git add -f`，该目录在 .gitignore 中） |

示例：
```
fix: add missing add-points check in followOffSuitThrow void path

Third position with tmWin should check canAddPoints before trumping.
Adds nonTrump.length >= leadLen guard for safe filler selection.

第三家队友已大时，缺门应先检查可加分再毙牌。
新增 1 项测试（engine）。

Co-Authored-By: DeepSeek V4 Flash <noreply@deepseek.com>
```

测试数行格式（提交信息）：

```
新增/修改/删除 N 项测试（子包）。
```

- 只写测试变动本身，不列测试总数：`新增 12 项测试（engine）`、`修改 2 项测试（arena）`、`删除 3 项测试（cli）`；跨子包写 `新增 3 项测试（engine 1 + client 2）`。
- 无测试改动写 `无新增测试`。
- 提交信息与 Changelog 中的测试数必须与实际测试结果一致（`npm run test` 各包之和）；Changelog 的分项与总数格式见下节。

## Changelog 格式

```markdown
## YYYY-MM-DD HH:MM

### <中文标题>

**问题**：<问题描述>

**修复**：<修复描述>

**新增 N 项测试**（file.ts：M 项），引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过。

- **影响文件**：`path/to/file.ts`
```

Changelog 测试数行与提交信息不同——列出子包分项与总数；无新增写 `无新增测试`；删除写 `删除 N 项测试`；client 无测试时省略 `client` 项。

每项修改为一个独立的日期时间小节，按时间倒序排列。

**多小节条目**：一个日期时间条目下可包含多个 `###` 小节（同一提交的多方面改动，如策略变更 + 其影响）。只有**最后**一个小节写测试总数（`引擎 X 项 + arena X 项 + CLI X 项 + client X 项 = X 项通过`），前面的小节只写 `**新增/修改/删除 N 项测试**（file.ts：M 项）`，不写总数。

## 开发原则

- **用户反馈牌局时（无论要求修 bug 还是理论分析），先执行代码拿到结果，再思考**。应构造场景直接调用引擎 AI（`aiFollowPlay`/`aiLeadPlay` 等，可手写 AIContext 或写临时脚本实测）或写复现测试，先取得实测输出，再基于结果分析；不要先手推逻辑或凭规格推断。修 bug 时：先根据其输入的牌局构造测试用例，确认复现 bug 后再修复。测试应尽可能还原用户描述的场景（手牌、领出、位置等），确保回归测试能捕获同类问题。
- **修改 Changelog 必须在代码提交之前**。每次提交前先写 Changelog，再 `git add` 一起提交。Changelog 时间与提交时间允许相差几分钟，无需强制对齐。
- **Changelog 只在更新代码时写**（fix/feat/strategy/refactor/test 等）；纯文档提交（`docs:` 和 `skill:`）一律不写 Changelog。
- **测试断言优先用精确值**（`toBe(n)`），避免使用 `toBeGreaterThan`、`toBeGreaterThanOrEqual` 等模糊匹配，除非值本身因外部因素不确定。
- **基础模块的测试必须逐项穷举**。对于记牌器这类高阶策略依赖的基础模块，测试覆盖所有视角 × 所有目标玩家 × 所有可能的牌（suit-rank）× 精确张数断言，不允许只验证部分卡牌。
- **每次提交前必须跑类型检查并清理全部错误**：在 `packages/engine` 与 `packages/client` 下各跑一次 `npx tsc --noEmit`，须零错误后才提交。vitest 经 esbuild 转译不做类型检查，类型错误不会导致测试失败，因此必须显式检查。
- **删除符号链接路径下的内容前先确认目标**：`git worktree` 无 node_modules，复用主仓库依赖时通常把 worktree 的 `node_modules` 符号链接到主仓库——此时 `rm worktree/node_modules/@poker/engine` 会顺着链接删掉**主仓库**里的真身（2026-08-15 实测：误删 `@poker/engine` 导致 vite 无法解析）。删除/重建前用 `ls -la`/`readlink` 确认是否为链接及指向；worktree 清理（`git worktree remove`）前先把指向 worktree 内部路径的链接改回相对链接（`../../packages/engine`），否则悬空。

## 测试命令

- **单包测试**：`npm run test -w packages/engine` / `-w packages/cli` / `-w packages/arena` / `-w packages/client`（等价于进入该包目录后 `vitest run`，读取各自的 vitest.config.ts）
- **全量测试**：根目录 `npm run test:all`，依次执行四个单包测试命令（engine → arena → cli → client，任一失败即停止）
- **根目录 `npm run test` 只跑引擎**（根 package.json 的 test 脚本指向 engine）
- **不要从仓库根用 `npx vitest run <包路径>` 统计测试数**——positional filter 在存在多个 vitest.config.ts 时会混入其他包的测试（实测 `npx vitest run packages/cli` 混入 client 测试，127 ≠ 真实 80）
- **Changelog 的测试总数**：运行 `npm run test:all 2>&1 | grep -E "^> @poker/.* test$|Tests +[0-9]+ passed"`，取输出中对应包的 `Tests N passed` 中的 N（四包顺序 = engine + arena + CLI + client），四者之和为总数

## 布局回归检查

- **用途**：修改任意 GUI 组件的位置后，验证其他所有组件位置不变（历史教训：给 `.center-area` 加 `position: relative` 导致等级框掉到桌布上——定位祖先被劫持）。
- **用法**（vite dev server 需运行在 5199，浏览器 = 系统 Chrome）：
  - 检查：`cd packages/client && npx tsx scripts/layout-regression.ts`——注入 6 个代表性阶段（发牌/亮主/扣底/出牌/甩 10 张/局末），测量 40 个关键组件的矩形，与基线 `scripts/layout-baseline.json` 比对；任一组件位移 >1px 时列出该组件及精确 delta，退出码 1。
  - 生成基线：`npx tsx scripts/layout-regression.ts --snapshot`——**仅当人工确认当前布局正确时**执行；基线随代码提交，视口固定 1280×720。
- **有意移动组件时**：人工确认全布局正确后重新 `--snapshot` 更新基线，再提交。

## 命名约定

- **内部编号 P0-P3**：代码和测试中统一使用，P0=玩家1、P1=AI-2、P2=AI-3、P3=AI-4。不存在 P4。
- **外部显示**：CLI 输出使用 `玩家1`（非 AI）或 `AI-2`（AI），由 `playerLabel(idx)` 生成。
- **测试注释中的玩家标注**：优先使用 P0-P3 内部编号，或用 `P2(AI-3)` 同时标注两者。

## 记牌器相关

- 记牌器测试必须验证每个视角下每张常主（S-2, H-2, C-2, D-2, J-15, J-16）在每个非 void 玩家手中的精确副本数（`cnt` 断言）。
- 必须验证对子推断：何种对子可能存在（`cnt=2`），何种不可能（`cnt≤1`），包括底牌（不受对子推断影响）。
- 必须验证 void deduction 结果（`playersWithNoTrump`、possible 列表长度）。
- 测试场景中的庄家（declarerIndex）、亮主者（reveal playerIndex）必须与真实游戏一致。

## AI 策略文档

参见 [packages/engine/src/ai/STRATEGY.md](packages/engine/src/ai/STRATEGY.md)。
