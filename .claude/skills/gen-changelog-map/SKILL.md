---
name: gen-changelog-map
description: 生成/更新项目根目录的 CHANGELOG_COMMITS.md——Changelog 条目与 git 提交的对照表（含异常标注与强制校验）。只在用户明确要求时执行，不主动生成或同步。
---

# 生成 Changelog 与提交对照表

## 触发场景

用户要求"生成对照表"、"更新对照表"、"同步对照表"时，生成或更新 `CHANGELOG_COMMITS.md`（项目根目录）。

⚠️ **不要主动生成或更新对照表**——用户明确要求过：未要求时不动此文件（即使 Changelog 或提交历史已变化，只提醒、不代劳）。

## 输出约定

- 文件：`CHANGELOG_COMMITS.md`（项目根目录，与 `CHANGELOG.md` 同层）
- 默认**不提交**（保持 untracked；`git add`/`git commit` 仅当用户明确要求）
- Changelog 与主对照表均为**时间倒序**（最新在上）
- 内容用中文；提交 hash 用 7 位短 hash；提交列格式 `hash（提交时间）`
- 每次生成前重新提取数据，**不要复用旧快照**（用户经常 amend 提交，hash 会变）

## 数据提取

```bash
# 权威提交总数（git log 管道输出末行无换行，wc -l 会少 1，勿用 wc 计数）
git rev-list --count HEAD

# 提交清单：%h=短hash %ad=author date %s=subject
git log --pretty=format:'%h|%ad|%s' --date=format:'%Y-%m-%d %H:%M' > /tmp/poker_commits.txt

# Changelog 小节标题（时间倒序）
grep '^## ' CHANGELOG.md

# ⚠️ 检查无 `##` 前缀的孤立时间行（历史遗留，如 2026-08-09 11:37）
grep -nE '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' CHANGELOG.md
```

## 匹配规则（自动候选 + 语义核对）

1. **自动候选**：条目时间与提交时间差 ≤40 分钟内唯一候选 → 自动匹配；无候选 / 多候选 / 差 >10 分钟 → 标注待核对。
2. **语义核对**：条目标题与提交信息**内容匹配为主**、时间为辅；看提交正文 `git show <hash> --format='%b'`。
3. **歧义验证**：`git log -S '<条目时间>' -- CHANGELOG.md` 找引入该条目的提交（谁把这条 `##` 时间行写进了 CHANGELOG）。适用于：条目时间与提交时间对不上、条目内容疑似并入其他提交的情况。
4. **已目录化的异常类型**（全部写进"异常汇总"节）：
   - **条目无对应提交**：2026-06-28 13:00–21:33 的早期记录，随初始提交 `ed09940` 一次性入库（主表行提交列写 `ed09940`，备注"⚠️ 无对应提交"）
   - **两个条目对应同一提交**（如 e8dfbdf 22:25+22:15、de65d6f 16:33×2）——内容重复时可建议合并
   - **提交无条目**：`docs:` 前缀按规范不写 Changelog（2026-08-08"docs 不写 Changelog"规范确立前写过的除外，如 Elo 表更新类 docs）；测试提交可能并入相邻修复条目
   - **时间偏差 >10 分钟**：分方向标注（条目早于提交 N 分 / 晚于提交 N 分）
   - **小节结构异常**：缺 `##` 前缀的孤立时间行、同小节多条 `###`（同一提交多修复）、同时间两条 `##`（内容重复）
   - **WIP 提交**：可能是用户手动 amend 的"所有 Changelog 维护修改的合并"——按实际 diff 内容描述（`git show --stat HEAD`），hash 以最新为准

## 生成模板（按既有文件结构）

```
# Changelog 与提交对照表
<开头说明：小节数（## 数 + 孤立行数）与提交数；更新记录（如适用）>

## 总览          → 提交总数 / Changelog 小节 / 有对应提交的条目 / 无对应提交的条目 / 无 Changelog 的提交（含分项）
## 主对照表      → | Changelog 时间 | Changelog 条目 | 提交（时间） | 备注 |
## 无 Changelog 的提交 → docs 提交表 + 代码/测试与维护提交表（提交 | 时间 | 信息 | 说明）
## 无对应提交的 Changelog 条目 → 列表 + 说明（早期记录随初始提交入库）
## 异常汇总      → | # | 类型 | 说明 |，已解决的标"（已解决）"并注明处理方式
## 说明          → 对照依据、已知口径问题、生成方式
```

- 条目列取该小节 `###` 标题（多 `###` 小节合并描述并在备注注明）
- 备注列只填异常（⚠️ 前缀），正常留空
- 无 Changelog 提交的分项要能在总览中加总自洽（docs + 代码/测试 + WIP = 总数）

## 校验（必须全部通过）

```bash
# 1) 行数一致：主表行数 == Changelog 小节数（## 数 + 孤立时间行数）
grep -c '^| 2026-' CHANGELOG_COMMITS.md

# 2) 提交全覆盖：每个提交 hash 都出现在对照表文件中
while IFS='|' read -r h t s; do
  grep -q "\b$h\b" CHANGELOG_COMMITS.md || echo "MISSING: $h $t $s"
done < /tmp/poker_commits.txt

# 3) 行时间匹配：每行 hash 的提交时间与条目时间差 ≤40 分钟（ed09940 行除外）
awk -F'|' '/^\| 2026-/{gsub(/ /,"",$4); split($4,a,"（"); h=a[1]; t=$2; gsub(/ /,"",t); print t "|" h}' \
  CHANGELOG_COMMITS.md | while IFS='|' read -r t h; do
    [ "$h" = "ed09940" ] && continue
    actual=$(grep "^$h|" /tmp/poker_commits.txt | cut -d'|' -f2)
    tsec=$(date -j -f '%Y-%m-%d %H:%M' "$t" +%s); asec=$(date -j -f '%Y-%m-%d %H:%M' "$actual" +%s)
    diff=$(( (tsec - asec) / 60 ))
    [ $diff -gt 40 ] || [ $diff -lt -40 ] && echo "TIME MISMATCH: $t -> $h"
  done

# 4) 计数自洽：not-mapped（提交清单 − 主表唯一 hash 数，ed09940 计入主表）== 总览"无 Changelog 的提交"
comm -23 <(cut -d'|' -f1 /tmp/poker_commits.txt | sort -u) \
  <(awk -F'|' '/^\| 2026-/{gsub(/ /,"",$4); split($4,a,"（"); print a[1]}' CHANGELOG_COMMITS.md | sort -u) | wc -l
```

## 注意事项

- **语义匹配是人工判断**：脚本/命令只做提取与校验的机械部分；自动候选结果必须经内容核对后才写入
- 更新记录（文件头部"YYYY-MM-DD 更新"块）只在用户要求更新时追加，说明本次变更要点
- 测试数行（"引擎 X 项 + arena X 项 = X 项通过"）与对照无关
- 对照表是查阅文档，不是规范；与 CLAUDE.md 提交规范冲突时以 CLAUDE.md 为准
