# 修改历史提交（合并/精简/回填历史提交）

## 触发场景

需要把某个提交合并进它前面的提交（如 e2e 断言修复并入策略提交）、精简历史提交的提交信息/Changelog 条目，或把改动回填到历史提交。目标：历史保持"一提交一主题"，无叠加提交、无内容混入。

## 核心安全规则

1. **reset 前保证工作区干净**：`git status` 有未提交改动时**提醒用户，不操作**（不自动 stash——reset --hard 会丢改动）。用户自行处理后确认干净再继续。
2. **reset 前先记下当前提交的哈希**：`git rev-parse HEAD` 记下原始 HEAD，最后用它与 `git diff --stat` 对比验证。
3. **每次 cherry-pick / amend 后跑全量测试**：`npx vitest run packages/engine`、`packages/arena`、`packages/cli`、`packages/client` + 双包 `tsc --noEmit`——每个重放提交后验证，出错即可定位到该提交。
4. **全部处理完后用 `git diff --stat <原始HEAD>` 验证最终影响文件**：与操作前的原始 HEAD 对比，确认整个区间的净变化正确（合并既不应丢失也不应新增文件）。

## 操作步骤

（目标：把 X 合并进它前面的 Y；Y 之后还有 Z₁…Zₙ）

```bash
git rev-parse HEAD              # ① 记下原始 HEAD（规则 2）
git status                      # ② 确认工作区干净（规则 1；不干净 → 提醒用户，不操作）
git reset --hard <Y>            # ③ 站到目标提交（不经过 detach，避免叠加）
git cherry-pick --no-commit <X> # ④ 应用 X 的 diff（合并进 Y 的场景）
# ⑤ 编辑合并内容：Changelog 条目合并（多小节规则见 CLAUDE.md）、提交信息精简
git status                      # ⑥ amend 前检查暂存区只含预期文件
git commit --amend              # ⑦ 合并进 Y（提交信息一并改）
# ⑧ 全量测试（规则 3）
git cherry-pick <Z1> <Z2> …     # ⑨ 逐个重放后续提交，每个之后全量测试
git diff --stat <原始HEAD>      # ⑩ 与原始 HEAD 对比，验证净变化（规则 4）
git log --oneline --stat        # ⑪ 逐个提交确认内容正确
```

## 注意事项（已踩过的坑）

- **detach + cherry-pick + commit 是"叠加"不是"合并"**：新提交的父是原目标，原目标仍在，历史出现两个同主题提交——用 `reset --hard` 站到目标上再 cherry-pick，不经过 detach。
- **`git commit --amend` 提交的是整个暂存区**，不是只提交 `git add` 过的文件。`reset --soft` 后暂存区混有后续提交内容时 amend 会误吞（曾把 14 个基线文件吞进策略提交）——amend 前 `git status` 必须确认暂存区只含预期文件。
- **CHANGELOG 是跨提交共享文件**：改前面提交的条目会让后面提交的 diff 上下文失效 → 重放冲突。把 Changelog 改动限定在目标提交自己的小节（多小节规则：只有最后一个小节写测试总数）；冲突时手动解决。
- **`reset --hard` 丢弃工作区未提交改动**：操作前必须确认工作区干净（规则 1）——不干净时提醒用户自行处理，不自动 stash、不操作。
- **每次提交后检查 `git log --oneline --stat`**：提交内容与预期不符立刻发现（如 4 文件 vs 22 文件）。
