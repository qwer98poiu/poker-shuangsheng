# 双升 (Shengji/Tractor) Card Game

## 项目结构

```
packages/engine/     - 核心引擎（牌型、比较、验牌、AI）
packages/client/     - React 前端
packages/cli/        - CLI 终端版本
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
| `fix:` | 修复 bug |
| `feat:` | 新功能/新策略 |
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
新增1项测试，452项通过。

Co-Authored-By: DeepSeek V4 Pro <noreply@deepseek.com>
```

## Changelog 格式

```markdown
## YYYY-MM-DD HH:MM

### <中文标题>

**问题**：<问题描述>

**修复**：<修复描述>

**新增 N 项测试**（file.ts：M 项），总数 通过。

- **影响文件**：`path/to/file.ts`
```

每项修改为一个独立的日期时间小节，按时间倒序排列。

## AI 策略文档

参见 [packages/engine/src/ai/STRATEGY.md](packages/engine/src/ai/STRATEGY.md)。
