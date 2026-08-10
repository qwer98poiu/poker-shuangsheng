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

Co-Authored-By: DeepSeek V4 Pro <noreply@deepseek.com>
```

| 前缀 | 用途 |
|---|---|
| `fix:` | 修复 bug（含策略 bug） |
| `feat:` | 新功能（非策略） |
| `strategy:` | 修改 AI 策略 |
| `refactor:` | 重构（无行为变更） |
| `test:` | 新增或修改测试 |
| `docs:` | 文档 |
| `chore:` | 构建/依赖 |

示例：
```
fix: add missing add-points check in followOffSuitThrow void path

Third position with tmWin should check canAddPoints before trumping.
Adds nonTrump.length >= leadLen guard for safe filler selection.

第三家队友已大时，缺门应先检查可加分再毙牌。
新增 1 项测试（engine）。

Co-Authored-By: DeepSeek V4 Pro <noreply@deepseek.com>
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

## 开发原则

- **用户反馈牌局时（无论要求修 bug 还是理论分析），先执行代码拿到结果，再思考**。应构造场景直接调用引擎 AI（`aiFollowPlay`/`aiLeadPlay` 等，可手写 AIContext 或写临时脚本实测）或写复现测试，先取得实测输出，再基于结果分析；不要先手推逻辑或凭规格推断。修 bug 时：先根据其输入的牌局构造测试用例，确认复现 bug 后再修复。测试应尽可能还原用户描述的场景（手牌、领出、位置等），确保回归测试能捕获同类问题。
- **修改 Changelog 必须在代码提交之前**。每次提交前先写 Changelog，再 `git add` 一起提交。Changelog 时间与提交时间允许相差几分钟，无需强制对齐。
- **Changelog 只在更新代码时写**（fix/feat/strategy/refactor/test 等）；纯文档提交（`docs:`）一律不写 Changelog。
- **测试断言优先用精确值**（`toBe(n)`），避免使用 `toBeGreaterThan`、`toBeGreaterThanOrEqual` 等模糊匹配，除非值本身因外部因素不确定。
- **基础模块的测试必须逐项穷举**。对于记牌器这类高阶策略依赖的基础模块，测试覆盖所有视角 × 所有目标玩家 × 所有可能的牌（suit-rank）× 精确张数断言，不允许只验证部分卡牌。
- **每次提交前必须跑类型检查并清理全部错误**：在 `packages/engine` 与 `packages/client` 下各跑一次 `npx tsc --noEmit`，须零错误后才提交。vitest 经 esbuild 转译不做类型检查，类型错误不会导致测试失败，因此必须显式检查。

## 测试命令

- **单包测试**：`npm run test -w packages/engine` / `-w packages/cli` / `-w packages/arena`（等价于该包目录下的 `vitest run`，读取各自的 vitest.config.ts）
- **根目录 `npm run test` 只跑引擎**（根 package.json 的 test 脚本指向 engine）
- 也可用 `npx vitest run <包路径>` 从仓库根限定范围（如 `npx vitest run packages/arena`），效果等同该包的单包测试

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
