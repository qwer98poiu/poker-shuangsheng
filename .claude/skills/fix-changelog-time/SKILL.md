---
name: fix-changelog-time
description: 逐提交修正 Changelog 小节时间为对应提交的 author date（filter-branch 幂等全量替换），用于 Changelog 出现超前/滞后时间时。本仓库规范：Changelog 时间应与提交时间一致（author date）。
---

# 修正 Changelog 时间为提交时间（逐提交）

## 触发场景

Changelog 小节时间与对应提交的提交时间不一致（超前于提交时刻，或滞后过多），需要**逐提交**修改：每个提交树中该提交新增小节的 `## YYYY-MM-DD HH:MM` 时间 = 该提交的 **author date**（`%ai`，非 committer date）。

## 核心原理与坑（务必先读，踩过的坑）

1. **`filter-branch --tree-filter` 基于"原始树"重建**：每个提交的工作树都从其原始树 checkout，**父提交的修改不会传播**到子提交。
   - ❌ 不要只替换"每个提交树中的顶部小节"——中间小节（继承自父）全部保持原始值，最终 diff 只剩顶部一处，中间全部没改。
   - ❌ 不要用"该提交是否修改过 CHANGELOG.md"（`git diff --quiet $GIT_COMMIT^ $GIT_COMMIT`）作判断条件——docs 等未改 Changelog 的提交会保留父提交的**原始值**；父提交被修正后，docs 提交相对新父产生假 diff（回滚父的修正）。
   - ✅ 必须**幂等全量替换**：只要树中存在 CHANGELOG.md 就执行脚本；脚本按"小节标题关键词 → 目标时间"映射修正**所有**匹配小节。结果与树从哪来无关，docs 提交因此继承修正后的父内容（diff 为 0）。
2. **脚本文件单独创建**：创建脚本（`cat > ...`）与执行 filter-branch 必须分开命令——若 filter-branch 的调用被拒绝/回滚，连 `cat` 一起回滚，脚本从未落盘。
3. **验证必须用重写后的新 hash**：filter-branch 保留原对象（`refs/original`），旧 hash 查询命中**原始版本**，显示旧时间——会误判"没生效"。
4. **范围含起点**：`<起点>..HEAD` 排除起点本身；需要包含起点提交时用 `<起点>^..HEAD`。
5. **时间行格式有误时，先恢复格式再改时间**：若 Changelog 存在**孤立时间行**（`YYYY-MM-DD HH:MM` 无 `## ` 前缀——例如此前用 `replace('# Changelog\n\n## ', new, 1)` 插入小节时吃掉了上一小节的 `## `），映射脚本的 `last_ts_idx` 会指向错误位置，把顶部小节反复覆盖成同一时间。脚本必须先**恢复孤立时间行的 `## ` 前缀**（幂等），再执行时间映射。
   - 附带教训：**插入 Changelog 小节时保留原 `## ` 前缀**——不要用 `replace('# Changelog\n\n## ', new, 1)` 方式插入（new 自身含 `# Changelog\n\n## ` 会把上一小节的 `## ` 吃掉）。

## 操作步骤

1. **确认涉及 Changelog 的提交**：author date 与该提交新增小节标题：

   ```bash
   git log --format="%h %ai | %s" <起点>^..HEAD
   for c in <hash...>; do git diff $c^ $c -- CHANGELOG.md | grep '^+### ' | head -1; done
   ```

2. **创建幂等替换脚本**（/tmp/fix-cl-time.py）——**先恢复格式，再改时间**：

   ```python
   import sys, re
   # 小节标题关键词 -> 该小节应改为的 author date
   M = {
     '<小节标题关键词>': 'YYYY-MM-DD HH:MM',
     # ...每个涉及 Changelog 的提交一行
   }
   lines = sys.stdin.read().split('\n')
   # 1) 恢复结构：孤立时间行（丢失的 ## 前缀）加回 "## "
   for i, line in enumerate(lines):
       if re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}', line):
           lines[i] = f'## {line}'
   # 2) 时间映射（幂等）：每个小节标题 → 修正其所属 ## 时间行
   last_ts_idx = None
   for i, line in enumerate(lines):
       if line.startswith('## '):
           last_ts_idx = i
       elif line.startswith('### '):
           for key, ts in M.items():
               if key in line and last_ts_idx is not None:
                   lines[last_ts_idx] = f'## {ts}'
                   break
   sys.stdout.write('\n'.join(lines))
   ```

   标题关键词取该提交新增小节的 `###` 行中的唯一片段（如 `修复：第四家队友已大不盖过`），确保不与更早小节混淆；更早提交的小节不在映射中，保持不动。

3. **执行 filter-branch**（对**所有**含 CHANGELOG.md 的提交执行，不做 diff 判断）：

   ```bash
   git filter-branch -f --tree-filter '
     if git cat-file -e "$GIT_COMMIT:CHANGELOG.md" 2>/dev/null; then
       python3 /tmp/fix-cl-time.py < CHANGELOG.md > CHANGELOG.md.new && mv CHANGELOG.md.new CHANGELOG.md
     fi
   ' <起点>^..HEAD
   ```

4. **验证**（用新 hash）：
   - 每个涉及 Changelog 的提交：`git show <新hash>:CHANGELOG.md | grep -m1 '^## '` == `git show -s --format=%ai <新hash> | cut -c1-16`
   - 未涉及 Changelog 的提交（docs 等）：`git show <新hash> -- CHANGELOG.md` 应无输出（diff 为 0）
   - 整体：`git diff <重写前的HEAD> <重写后的HEAD> -- CHANGELOG.md` 应恰好只含 N 处时间差异（每处 `-## 旧时间` / `+## 新时间`），无其他内容变化
   - `git status` 干净

## 注意事项

- 重写后提交 hash 全部变化；若已推送需 force-push（本仓库工作流不推送，无此问题）。
- 目标时间格式 `YYYY-MM-DD HH:MM`，与 Changelog 惯例一致；author date 含时区（`+0800`），用 `cut -c1-16` 截取。
- 范围外的提交（起点之前）不处理；其小节在范围内提交的树中保留原时间（脚本映射外不动）。
