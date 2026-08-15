# 修改历史提交（合并/精简/回填历史提交）

## 触发场景

需要把某个提交合并进它前面的提交（如 e2e 断言修复并入策略提交）、精简历史提交的提交信息/Changelog 条目，或把改动回填到历史提交。目标：历史保持"一提交一主题"，无叠加提交、无内容混入。

## 核心安全规则

1. **reset 前保证工作区干净**：`git status` 有未提交改动时**提醒用户，不操作**（不自动 stash——reset --hard 会丢改动）。用户自行处理后确认干净再继续。
2. **reset 前先记下当前提交的哈希**：`git rev-parse HEAD` 记下原始 HEAD，最后用它与 `git diff --stat` 对比验证。
3. **每次 cherry-pick / amend 后跑全量测试**：`npx vitest run packages/engine`、`packages/arena`、`packages/cli`、`packages/client` + 双包 `tsc --noEmit`——每个重放提交后验证，出错即可定位到该提交。
4. **全部处理完后用 `git diff --stat <原始HEAD>` 验证最终影响文件**：与操作前的原始 HEAD 对比，确认整个区间的净变化正确（合并既不应丢失也不应新增文件）。

## 操作步骤

（目标：把 X₁…Xₘ 合并为一次提交、插在 Y 之后；Y 之后还有 Z₁…Zₙ；X₁ 的父 = Y）

```bash
git rev-parse HEAD              # ① 记下原始 HEAD（规则 2）
git status                      # ② 确认工作区干净（规则 1；不干净 → 提醒用户，不操作）
git log --oneline <Y>..HEAD     # ③ 确认 Y 与 HEAD 之间的提交链与合并范围——用户口述的
                                #    哈希可能有笔误/重复，先列出核对，reset 目标是 X₁ 的父（=Y）
git reset --hard <Y>            # ④ 站到合并范围的父提交（不经过 detach，避免叠加）
git cherry-pick --no-commit <X1> <X2> …  # ⑤ 逐个应用范围内每个提交自己的 diff——
                                #    不要用 reset --soft（会把 Y 之后其他提交的改动一并暂存）
# ⑥ 编辑合并内容：Changelog 条目折叠（多小节规则见 CLAUDE.md）、提交信息精简
git diff --cached --stat        # ⑦ 提交前确认暂存区只含预期文件（混入其他提交改动立刻可见）
GIT_AUTHOR_DATE="$(git show -s --format=%ai <Xm>)" git commit  # ⑧ 合并提交；用户指定时间时取该提交 author date
# ⑨ 全量测试（规则 3）
git cherry-pick <Z1> <Z2> …     # ⑩ 逐个重放范围之后的提交（reset --hard 已把它们移出分支，
                                #    reflog 可恢复；漏放会体现在步骤 ⑫ 的 diff 里），每个之后全量测试
git diff --stat <原始HEAD>      # ⑪ 与原始 HEAD 对比，验证净变化（规则 4）——应只差折叠后的 CHANGELOG
git log --oneline --stat        # ⑫ 逐个提交确认内容正确
```

## 注意事项（已踩过的坑）

- **detach + cherry-pick + commit 是"叠加"不是"合并"**：新提交的父是原目标，原目标仍在，历史出现两个同主题提交——用 `reset --hard` 站到目标上再 cherry-pick，不经过 detach。
- **`git commit --amend` 提交的是整个暂存区**，不是只提交 `git add` 过的文件。`reset --soft` 后暂存区混有后续提交内容时 amend 会误吞（曾把 14 个基线文件吞进策略提交；也曾把"目标之后其他提交"的分牌改动混进布局合并提交）——amend/提交前 `git status`/`git diff --cached --stat` 必须确认暂存区只含预期文件。
- **多提交合并用 `reset --hard <范围父>` + `cherry-pick --no-commit` 逐个应用，不用 `reset --soft`**：soft reset 暂存的是"当前树 vs 目标"的全部差异——目标与 HEAD 之间其他提交的改动全会被暂存（2026-08-16 实测）。cherry-pick 每个提交只带它自己的 diff。
- **reset 目标必须是合并范围首个提交的父**：先 `git log --oneline <目标>..HEAD` 确认中间没有别的提交（曾把中间隔着亮主规则/docs 提交的 e66becb 当父，若直接提交会卷进它们的改动）。用户口述的哈希可能笔误/重复（"a408667 7857f66 7857f66"实为三个提交）——先列出核对。
- **范围之后的提交必须重放**：`reset --hard` 会把它们移出分支（reflog 可恢复，如 8258072 分牌修复）——`git cherry-pick <原哈希>` 重放，保留原提交信息与作者时间；`git diff --stat <原始HEAD>` 若出现非 CHANGELOG 差异即漏放。
- **合并多个提交为一时可用 `GIT_AUTHOR_DATE` 指定作者时间**：`GIT_AUTHOR_DATE="$(git show -s --format=%ai <被合并提交>)" git commit`，Changelog 条目时间同步（规则：Changelog 时间 ≈ 提交 author date）。
- **CHANGELOG 是跨提交共享文件**：改前面提交的条目会让后面提交的 diff 上下文失效 → 重放冲突。把 Changelog 改动限定在目标提交自己的小节（多小节规则：只有最后一个小节写测试总数）；冲突时手动解决。
- **`reset --hard` 丢弃工作区未提交改动**：操作前必须确认工作区干净（规则 1）——不干净时提醒用户自行处理，不自动 stash、不操作。
- **每次提交后检查 `git log --oneline --stat`**：提交内容与预期不符立刻发现（如 4 文件 vs 22 文件）。
