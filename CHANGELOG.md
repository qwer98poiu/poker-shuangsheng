# Changelog

## 2026-08-16 22:01

### 亮主面板改为 6 个固定宽白底胶囊框；亮主过程修复：无人亮主时只能单张亮，可自保成对

**问题**：亮主面板用文字按钮（"♠ 2 (对)"、"大王NT"）加提示文字，且手里有对级牌时可以直接亮一对——不符合"先单张亮、再自保成对"的亮主过程；面板每个胶囊框内有独立白色小圆片（圆圈），胶囊与圆圈两层结构冗余；花色与 NT/nt 字号不一致（14px / 11px）。

**修复**：① 面板改为 6 个固定宽胶囊框（左右弧形）：大王 NT（红）/ 小王 nt（黑）/ ♠♥♣♦，取消全部文字描述；不可亮置灰；图标数统一——没人亮过一律 1 个，有人亮过一律 2 个（亮单张后变 2 个，表示可自保）；无主框恒为 1 个（只有两个字母）；② 引擎 `tryReveal`（新增 `revealStrength`）与 AI（`aiTryReveal`）同步修复亮主过程：无人亮主时有主花色只能单张亮（不直接亮一对），对子仅用于自保（自己同花色巩固）或反主（他人已亮）；无主（对王）不受限；③ 人类亮单张后可自保：亮单张后停留亮主阶段（无自保可能时仍"亮主即确认"立即进入扣底；可自保时等 3s 自动确认兜底），再点同花色成对后进入扣底；④ 去掉内部圆圈——胶囊本身用原圆圈的背景色（#f5f5f5 白底），花色符号直接显示在胶囊上（2 个符号并排同胶囊），符号字号统一 24px（实测 2 符号并排最宽 36px、NT 两字母 38px，均 ≤ 胶囊内宽 54px，无溢出）。实测：浏览器注入 4 种状态图标数与可用性全部正确；ui-player 完整一场 32 局 685 断言全绿。

**新增 30 项测试**（revealing.test.ts：17 项；reveal-panel.test.ts：12 项；gameStore.test.ts：1 项），引擎 713 项 + arena 65 项 + CLI 80 项 + client 95 项 = 953 项通过。

- **影响文件**：`packages/engine/src/revealing/index.ts`、`packages/engine/src/game/index.ts`、`packages/engine/src/ai/index.ts`、`packages/client/src/components/game/revealPanel.ts`（新增）、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/store/gameStore.ts`、`packages/client/src/__tests__/reveal-panel.test.ts`（新增）、`packages/client/scripts/ui-player.ts`、`packages/client/scripts/layout-baseline.json`

## 2026-08-16 13:46

### 新增布局回归检查脚本：改组件位置后自动验证其他组件不变

**问题**：修改某个组件的位置后可能无意影响其他组件（如此前给 `.center-area` 加 `position: relative` 导致等级框掉到桌布上），每次人工逐项测量易遗漏。

**修复**：新增 `packages/client/scripts/layout-regression.ts`——向运行中的 GUI 注入 6 个代表性阶段（发牌/亮主/扣底/出牌/甩 10 张/局末），逐一测量 40 个关键组件的矩形，与基线 `layout-baseline.json` 比对，列出所有位移超过 1px 的组件及精确 delta（有位移时退出码 1）。基线在人工确认布局正确后 `--snapshot` 生成并随代码提交；此后每次 GUI 布局改动后跑一次检查即可。实测：将 `.score-display` top 8→28 后，检查在全部 6 个阶段报出 score-display/level-box/score-item/score-points 位移 +20（桌布/手牌/按键未误报）；还原后通过。

**无新增测试**，引擎 696 项 + arena 65 项 + CLI 80 项 + client 82 项 = 923 项通过。

- **影响文件**：`packages/client/scripts/layout-regression.ts`、`packages/client/scripts/layout-baseline.json`

## 2026-08-16 12:44

### 桌布左上角显示"局数/墩数"（1 起计数），位置与横幅底部对齐；等级框位置不变

**问题**：左上角只有"墩数: N"且从 0 开始（`tricksPlayed` 为已完成墩数）；位置在桌布布局顶部，低于阶段横幅。初版把定位基准放在 `.center-area` 上，`position: relative` 劫持了 `.score-display`（等级框，`top: 8px / left: 12px` 原本锚定 `.game-table`），等级框整体下移到 `.center-area` 内部（top ≈ 100px）压到桌布上；回看上墩/底牌弹层（`top: 40%/50%`）同样被劫持。

**修复**：① 改为"局数: x 墩数: x"——局数 = `roundNumber + 1`、墩数 = `tricksPlayed + 1`（均从 1 开始计数）；② 局数/墩数挂在 `.phase-banner` 内（横幅设 `position: relative` 作为唯一新增定位祖先），`bottom: 0` 使文字底部与横幅底部精确对齐（`line-height: 1` 避免继承横幅行高 28 造成字形悬空），`left: 0` 对齐横幅左缘。等级框与各弹层恢复锚定 `.game-table`，位置不变。实测：等级框回到画布左上（top 8 / left 12），局数/墩数底部 128 == 横幅底部 128（出牌阶段）、139 == 139（发牌阶段，无主牌指示器），桌布 top 150/139 不变。

**无新增测试**，引擎 696 项 + arena 65 项 + CLI 80 项 + client 82 项 = 923 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-16 11:44

### 自保直接替换：亮主展示不再保留自保的旧单张（灰色）

**问题**：自保（单♠2 → 对♠2，同玩家同花色）后，亮主者位置显示 3 张等级牌——旧单张按"被反置灰"规则保留，实际冗余（同花色自保是巩固，不是换主）。

**修复**：新增 `displayReveals` 纯函数：成功链中，被**同一玩家同花色**的后续亮牌覆盖的记录直接不显示（自保替换）；其余被反记录（不同玩家 / 不同花色）仍保留原位置灰；当前主总是显示。实测注入自保链：P0 位置只显示对♠2 两张（无灰色）。

**新增 5 项测试**（reveal.test.ts：5 项），引擎 696 项 + arena 65 项 + CLI 80 项 + client 82 项 = 923 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/__tests__/reveal.test.ts`

## 2026-08-16 10:18

### 结算面板移除重复底牌：底牌只在桌布中央展示

**问题**：一局结束后底牌在两处同时显示——桌布中央的 `.bottom-reveal`（含底牌分×倍率/抠底标注）与结算面板（`.round-result` 的 `.round-bottom`）重复渲染同一份底牌。

**修复**：删除结算面板的 `.round-bottom` 底牌块（含 `bottom-cards` 渲染），底牌统一由桌布中央展示；结算面板保留胜负判定与闲家得分。实测注入 round_end 状态：`.bottom-reveal` 存在、`.round-bottom` 不存在、底牌 8 张仅一处。

**无新增测试**，引擎 696 项 + arena 65 项 + CLI 80 项 + client 77 项 = 918 项通过。

- **影响文件**：`packages/client/src/components/game/GameTable.tsx`

## 2026-08-16 10:07

### 左上角信息区改造：等级框（数值列左对齐、当庄高亮）+ 闲家得分 + 分牌；墩数移到桌布左上角

**问题**：左上角只显示"级别: X 闲家得分: N 墩数: M"一行，看不出双方等级与当庄方；等级数值紧跟标签（"我方等级 5"）未显式成列。

**修复**：① 新增等级框（`.level-box`）：两行"我方等级 5 / 对方等级 3"（team = index % 2，`levelBoxState` 纯函数计算），标签定宽（`.level-label` 56px）数值列左对齐，当前当庄一方高亮（金色加粗 + 淡金底；trumpDeclaration 未定时按预定庄家 declarerIndex 高亮，null 不高亮）；② 等级框下方"闲家得分: 35"（样式不变），再下方分牌展示（样式不变）；③ "墩数: N"移到桌布（`.trick-position-layout`）左上角（`.trick-count` 绝对定位）。实测注入 declarer 3（队 1）+ teamLevels [5,3]：对方等级高亮、闲家得分在框下、墩数: 7 在桌布左上角；等级 10 与 3 数值同列（x=89）。

**新增 6 项测试**（level-box.test.ts：6 项），引擎 696 项 + arena 65 项 + CLI 80 项 + client 77 项 = 918 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/__tests__/level-box.test.ts`

## 2026-08-16 00:29

### 闲家分牌移到分数行正下方，保持自然宽度

**问题**：左上角分数行是 flex 行，闲家已获得的分牌跟在"级别: 2 闲家得分: 0 墩数: 0"右边，随分牌增多横向延伸；改为换行时（`flex-basis: 100%`）分数框又被撑到分牌行宽度（310px）过宽。

**修复**：分数项（级别/闲家得分/墩数）包进 `.score-line` 行容器，`.score-display` 改为左对齐 flex 列——分牌作为独立行在分数行正下方，保持自然宽度（110px）；分数框宽度 = 两行自然宽度较大者（188px）。分数区为绝对定位，不影响桌布/手牌位置。实测：分数行底 y=29，分牌行 y=35 正下方、x=22 左对齐。

**无新增测试**（CenterArea.tsx：0 项），引擎 696 项 + arena 65 项 + CLI 80 项 + client 71 项 = 912 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-15 23:40

### 桌布与手牌位置固定：座位单元格、中间行、按键槽位三级固定

**问题**：① 桌布内部座位随出牌位移——网格行高 `auto 1fr auto` 随该行内容伸缩、挤压中间行，各座位在行内居中随之位移（实测 P1 出 1 张后右座位 y 248→238）；② 桌布整体随下方组件跳动——中间行 `flex: 1`，玩家1 回合有出牌按钮（48px）时 396px、出牌后膨胀到 444px，桌布下移 24px；③ 手牌随按钮槽位条件渲染跳动 48px（y 508 ↔ 556）。

**修复**：① 网格三行等宽固定 + 座位单元格固定高度 86px（label 14 + 牌 70），内容变化只发生在单元格内部；② `.table-middle` 固定高度 396px（= 720 − top 58 − message 24 − action 48 − debug 30 − bottom 164），不再 `flex: 1`；③ 新增常驻 `.table-actions` 槽位（48px，内容可空），亮主面板与出牌/扣底按键统一放其中，扣底主牌警告行改绝对定位覆盖层（`pointer-events: none` 不挡点击）。实测三态（玩家1回合 / 出牌后 AI 回合 / 扣底含主牌警告）：桌布 y 恒 150、手牌 y 恒 556、debug-bar y 恒 526；注入三种出牌状态四座位 y 完全一致（bottom 324 / right 238 / top 152 / left 238）。

**无新增测试**，引擎 696 项 + arena 65 项 + CLI 80 项 + client 71 项 = 912 项通过。

- **影响文件**：`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-15 21:34

### 亮主规则：禁止自反，允许有主自保（同花色巩固）

**问题**：`canOverride` 只比较 strength——同一玩家可以用更强的牌反自己的主（单张→对子、对小王→对大王），应禁止"自反"（换花色/换主）；但同花色的巩固（自保）是合理规则，应允许。

**修复**：`canOverride` 同玩家时要求花色非空、与当前相同且力量更高才允许（自保仅限：单张→同花色对子）；换花色即拒绝，无主不可自保（对小王无主→对大王无主视为自反，禁止——无主没有花色概念，实际也无必要）。`aiTryReveal` 当前主是自己亮的时只提出有主自保（同花色对子），不再反自己的主。客户端亮主面板选项本就经 `canOverride` 过滤，自保选项出现、自反选项消失。规则改变 AI 亮主时机，竞技场 seed-42 冒烟对局走向变化（oppLevel 210 → 213 → 229，同步更新期望值）。

**新增 10 项测试**（engine revealing.test.ts：10 项）、修改 1 项测试（arena），引擎 696 项 + arena 65 项 + CLI 80 项 + client 71 项 = 912 项通过。

- **影响文件**：`packages/engine/src/revealing/index.ts`、`packages/engine/src/ai/index.ts`、`packages/engine/src/__tests__/revealing.test.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`

## 2026-08-15 20:05

### 桌布覆盖发牌/亮主/扣底/出牌四阶段（固定 262px）+ 亮主牌显示与收回

**问题**：深绿色桌布（出牌方位布局）只在出牌阶段渲染，发牌/亮主时中央区域明显缩小，布局跳变；且高度随内容浮动（亮主行出现/消失、出牌张数），各阶段大小不一；亮主只显示在顶部文字指示里，看不出谁亮的、亮了几张；亮主牌在出牌阶段仍显示在桌面上。

**修复**：① 桌布（trick-position-layout）覆盖发牌/亮主/扣底/出牌四阶段，高度固定 262px（= 四家全出牌自然高度 名字 14 + 叠放 70 = 86 × 3 行 + 内边距 4）——四阶段一样大，不随亮主/反主变化，任何阶段不裁剪（262 即内容最大值）；② 亮主牌放在亮主者方位（`trick-pos-reveal` 行，单张 1 张、对牌 2 张并排，无主 = 对大王/对小王各 2 张），只在发牌/亮主阶段显示，庄家拿底（扣底阶段起）后全部收回；被反的主牌不收回：`successfulReveals` 按 strength 严格递增过滤引擎 reveals 历史（失败尝试/同力量重复会被追加进历史，需过滤），非当前记录加 `.reveal-overridden` 置灰保留在原位。实测注入 P0 亮单张♠2 → P2 反主对♥2：P0 面前 1 张灰色♠2、P2 面前 2 张♥2；四阶段桌布恒 262px、亮主牌 发牌 3 张 / 亮主 3 张 / 扣底 0 / 出牌 0，全部在画布内。

**新增 11 项测试**（reveal.test.ts：11 项），引擎 686 项 + arena 65 项 + CLI 80 项 + client 71 项 = 902 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/__tests__/reveal.test.ts`

## 2026-08-15 19:36

### 出牌区布局改造：移除其他玩家手牌示意图，打出牌叠放（甩 10 张也整叠可见）

**问题**：出牌区域太小——打出牌不叠放（每张完整 50px + 间隙），甩 10 张时牌行宽 500px+，远超中央方位轨道（实测 156px），牌被挤到框外不可见；其他玩家座位旁的手牌示意图（8 张牌背扇形）占用中间行垂直空间。

**修复**：① 移除 `seat-hand-fan` 手牌示意图（座位只留名字/张数，已出牌统一在中央方位显示）；② 打出牌叠放（与手牌同视觉）：`playedStackStrip` 纯函数按轨道宽自适应计算露出条（`clamp(floor((W-50)/(n-1)), 4, 18)`），`PlayedStack` 组件测量 `.trick-position-layout` 宽度取轨道宽（布局改为三列等宽 `minmax(0,1fr)`，轨道宽不再随牌数伸缩）；25 张手牌上限内 strip ≥ 4px、整叠 ≤ 轨道宽恒成立。实测注入 P0 甩 10 张红桃：10 张全部在画布内、整叠 149px ≤ 轨道 156px、露出条 11px。

**新增 6 项测试**（layout.test.ts：6 项），引擎 686 项 + arena 65 项 + CLI 80 项 + client 60 项 = 891 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/components/game/PlayerSeat.tsx`、`packages/client/src/__tests__/layout.test.ts`

## 2026-08-15 17:07

### 人类模拟器：扣底 50% 点建议/50% 手动，出牌目标相邻时 50% 拖拽框选

**问题**：模拟器只覆盖"点建议出牌"与"手动逐张选"两条路径，扣底只有手动；且引用已移除的 clear-btn（重选按钮）与 trump-confirm 对话框——GUI 改造后运行即卡死。

**修复**：① 扣底 50% 点"建议扣底"（AI 推荐 8 张直接选中）→ 扣底，50% 按 AI 决策手动逐张选（非法回退启发式），移除 trump-confirm 残留逻辑；② 出牌时目标牌在展示手牌中相邻（连续区间）且 50% 概率走真实 mouse 拖拽框选（起止点取展示序首末张的露出区，XOR 反选前先逐张点击清空非锁定选中），其余维持 hint/手动 50/50；③ clear-btn 引用改为逐张点击已选牌反选清空（锁定牌点击 no-op 自动保留）。实跑种子 42-48 全部 ALL GREEN，hint/手动/拖拽/建议扣底各路径均被覆盖。

**无新增测试**（ui-player.ts：0 项）

- **影响文件**：`packages/client/scripts/ui-player.ts`

### 修复拖拽后首个真实点击被吞（PlayerHand suppressClick 限时失效）

**问题**：拖拽 mouseup 后浏览器合成的 click 落在 mousedown/mouseup 目标的共同祖先（跨卡拖拽时是容器，无 onClick），不消费 suppressClickRef——该标记一直残留，吞掉之后第一次真实点牌（模拟器实测：拖拽后下一个手动选牌回合首张点击无效）。

**修复**：mouseup 置标记后 150ms 自动失效——只吞 mouseup 同帧合成的 click（点同张牌结束拖拽时），之后的真实点击正常。

**无新增测试**（PlayerHand.tsx：0 项）

- **影响文件**：`packages/client/src/components/game/PlayerHand.tsx`

### 修复亮主面板 大王NT/小王NT 同时可选时重复 key（React 警告）

**问题**：两手都亮 NT 选项时 suit 同为 null，key 同为 'NT'——React 重复 key 警告（模拟器 console.error 检查捕获）。

**修复**：key 含 strength 区分（`NT-${o.strength}`），testid 不变（`reveal-btn-NT`，模拟器点首个）。

**无新增测试**（GameTable.tsx：0 项），引擎 686 项 + arena 65 项 + CLI 80 项 + client 54 项 = 885 项通过。

- **影响文件**：`packages/client/src/components/game/GameTable.tsx`

## 2026-08-15 15:43

### 扣底阶段主要按键改造：扣底/回看上墩双键 + 含主牌黄色警告 + 建议扣底

**问题**：扣底界面只有单个"确认扣底"按钮，含主牌时弹二次确认对话框，交互与出牌阶段不一致；无建议扣底，AI 扣底思路无从参考。

**修复**：扣底阶段改用与出牌一致的 action-bar 槽位双主键——左边"扣底 (x/8)"（与出牌键同位同尺寸），右边"回看上墩"（灰色不可选）；未选满 8 张时扣底键灰色。所选底牌含主牌时扣底键变黄并在下方显示"⚠️ 选了 x 张主牌"小字（`bottomExchangeStatus` 判定），取消二次确认，点击直接扣。调试栏新增"建议扣底"（与建议出牌同位置同尺寸），`getBottomHint` 调 `aiChooseBottomCards` 从 33 张手牌选推荐 8 张直接选中。移除旧扣底面板与 trump-confirm 对话框及无用样式。

**新增 7 项测试**（playable.test.ts：6 项，gameStore.test.ts：1 项），引擎 686 项 + arena 65 项 + CLI 80 项 + client 54 项 = 885 项通过。

- **影响文件**：`packages/client/src/components/game/ActionBar.tsx`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/components/game/playable.ts`、`packages/client/src/store/gameStore.ts`、`packages/client/src/__tests__/playable.test.ts`、`packages/client/src/__tests__/gameStore.test.ts`

## 2026-08-15 14:55

### 重构：client 测试文件移入 src/__tests__/ 目录，与其他包统一

**问题**：engine/cli 的测试集中在 `src/__tests__/`，client 的 4 个测试文件分散在源码树（`src/store/`、`src/components/game/`）——目录结构不统一，查找与统计不便。

**修复**：`git mv` 将 4 个测试文件（gameStore/playable/export-game/drag-select）移入 `packages/client/src/__tests__/`，相对 import 同步修正（`./playable.js` → `../components/game/playable.js` 等）。`vitest.config.ts` 的 `src/**/*.test.ts` 收集模式天然覆盖，无需改动；顺带消除因 import 解析失败产生的 8 个 TS7006（implicit any）。

**无新增测试**，引擎 686 项 + arena 65 项 + CLI 80 项 + client 47 项 = 878 项通过。

- **影响文件**：`packages/client/src/__tests__/gameStore.test.ts`、`packages/client/src/__tests__/playable.test.ts`、`packages/client/src/__tests__/export-game.test.ts`、`packages/client/src/__tests__/drag-select.test.ts`（均自原路径移动）

## 2026-08-15 13:40

### 重构：elo-verify.ts 更名 elo-calc.ts——根据实测胜率计算一组策略的 Elo（WLS 锚定），非验证

**问题**：脚本实际用途已从"验证给定 Elo 分是否准确"变为"根据竞技场报告实测胜率计算一组策略的 Elo"，名称与注释语义不符。

**修复**：更名 `elo-calc.ts`；锚点改为常量 `ANCHOR`（当前 `ai-0802` = 1000），`MATCHES` 表存放对决数据，输出逐边 ΔR、WLS 拟合 Elo（权重 = 对局数 n）、拟合残差（自洽性检查）。用法与补充新数据的修改方法见脚本头部注释。

**无新增测试**，引擎 686 项 + arena 65 项 + CLI 80 项 + client 47 项 = 878 项通过。

- **影响文件**：`packages/arena/scripts/elo-verify.ts` → `elo-calc.ts`（更名）、`README.md`

## 2026-08-15 10:37

### 新增：提取 ai-0809 基线（b77a7b1, 08-14 第二家避分修复前），归档移除 ai-0801

**问题**：README 中 1035 Elo 的测量对象是 08-14 时刻的 `ai`（此后第二家避分、断门策略等修复改变了策略），需要把该时刻策略冻结为基线供竞技场对比；`ai-0801`（08-01 重构前）已无对比价值。

**修复**：① `git archive` 提取 b77a7b1 的 `ai/` 为 `packages/engine/src/ai-0809/`，引擎注册 `ai0809` 命名空间、竞技场注册 `ai0809Strategy`（pair 14/15 合法性测试：无中止、无验牌回退）；② 移除 `ai0801Strategy` 注册与对应测试（归档）；③ README：Elo 表 `ai-0809` 行 = 1035（原 `ai` 行），当前 `ai` 行标"待重测"，`ai-0801` 行保留 992.2 分数并移入归档列表，`--strategy-a/b` 可选列表与默认 B（`ai-0809`）同步更新。

**新增 1 项测试、删除 1 项测试（arena）**，引擎 686 项 + arena 65 项 + CLI 80 项 + client 47 项 = 878 项通过。

- **影响文件**：`packages/engine/src/ai-0809/`（新目录，14 文件）、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`、`README.md`

## 2026-08-15 10:01

### 调整策略：第三/四家加分垫牌优先断含分花色——整门垫出，这一墩后该花色出绝（闲家跨 40 台阶例外）

**问题**：第三/四家队友已大可加分时，垫牌按分牌大小分散选择（10>K>5），不会主动把某一门含分花色整体垫出——含分花色留在手里，后续被领出时还要垫分；且张数最少的非分门反而会被优先垫掉。

**修复**：① `selectFillers` add 模式（第三/四家加分）副牌花色排序改为**含分门优先**（同含分按张数升序），张数 <= 可垫张数的含分门整门垫出（断门）；full 模式（闲家近/跨 40 台阶）改为 `pickDiscards` 分散全力加分（不优先断门）；② `pickBestAddCards`（缺门能毙加分路径）新增 `pickVoidSuitCards`：取张数最少的可出绝含分门整门垫出 + 其余加分垫；闲家时保留全力加分跨 40 台阶比较（跨台阶则用全力加分）。例：领出 ♥，第四家缺 ♥，♣K 单张 + ♦10 及非分若干 → 出 ♣K（断 ♣ 门）；♣5 单张时一般出 ♣5，除非出 ♦10 能跨 40 台阶。断门改变了 A==A 镜像对局走向（胜时对方平均等级 206/20 → 210/20），arena-e2e 冒烟 oppLevel 断言同步更新（此前 NT 垫牌保留王后为 206、第四家不盖修复后为 221）。

**新增 6 项测试**（ai-position-follow.test.ts：6 项）、**修改 1 项测试**（arena-e2e.test.ts），引擎 686 项 + arena 65 项 + CLI 80 项 + client 47 项 = 878 项通过。

- **影响文件**：`packages/engine/src/ai/position-policy.ts`、`packages/engine/src/__tests__/ai-position-follow.test.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`

## 2026-08-15 09:39

### 修复：发牌/第 1 墩 UI——不显示建议出牌、手牌亮色、回看上墩第 1 墩灰色不可点

**问题**：① 调试模式下建议出牌按钮在发牌/亮主/扣底阶段也显示，但该阶段无出牌可建议；② 发牌阶段手牌全部置灰（isActive 仅在出牌/扣底回合为 true），看牌不清晰；③ 回看上墩按钮第 1 墩（尚无历史墩）直接隐藏，应显示但置灰提示不可用。

**修复**：① debug-bar 的建议出牌按钮加 `isPlaying` 条件——仅出牌阶段显示；② PlayerHand 新增 `dimInactive` prop 分离"视觉置灰"与"可点"——发牌阶段传 false（手牌亮色展示），点击/拖拽仍由 isActive 控制不可选（selectCard 无 phase 检查，误选会残留到 Playing 前才被清空）；③ ActionBar 回看上墩按钮改为第 1 墩也显示、`disabled={!canReview}` 灰色不可点（发牌阶段 ActionBar 不渲染，仍不显示）。

**无新增测试**，引擎 680 项 + arena 65 项 + CLI 80 项 + client 47 项 = 872 项通过。

- **影响文件**：`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/PlayerHand.tsx`、`packages/client/src/components/game/ActionBar.tsx`

## 2026-08-14 22:58

### 修复：第二家跟牌避分补齐——主牌拖拉机/双对填单张与单张领出均改用 trumpDumpKey（主 A/王保底）

**问题**：庄家领出主牌拖拉机（如 ♠AA ♠KK，主牌序列 A-K 连续），玩家 1（第二家，手牌 >15 张）跟出唯一主对后，填充单张只按大小升序选牌，选了分牌 ♠5（5 分）而非非分 ♠8；排查全部跟牌路径后发现主牌单张第二家跟牌（出最小主牌）同样按纯大小升序——庄家领出 ♠A 时 P1 会垫出最小的分牌 ♠5 而非非分 ♠6+。两处均违反"第二家手牌 >15 张时尽量不加分"策略，白送庄家 5 分。

**修复**：新增 `trumpDumpKey` 垫出优先级（小非分 < 级牌常主 < 分牌 < 主 A/王保底——非分单张不足时宁垫分牌也不垫 A/王），应用于三处第二家避分路径：主牌拖拉机"无拖拉机可跟"填充、双对 rest 填充、单张领出出最小主牌；reason 同步标注"不加分"。<=15 张行为不变。用户场景建议由 ♠4♠4 ♠5 ♠6 变为 ♠4♠4 ♠6 ♠8。

**新增 5 项测试**（ai-position-follow.test.ts：5 项），引擎 680 项 + arena 65 项 + CLI 80 项 + client 47 项 = 872 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-position-follow.test.ts`

## 2026-08-14 22:12

### 新增：回看上墩提升为主要按键（出牌右侧），改为弹层展示；移除重选按钮；查看底牌 5 秒自动消失

**问题**：① 拖拽已支持反选，"重选"按钮失去意义；② 回看上墩藏在 debug-bar 次级按钮里，且是文字一行（按出牌顺序从左到右），与出牌时的方位展示不一致；③ 查看底牌弹层只能手动点按钮隐藏，不会自动消失。

**修复**：① ActionBar 移除重选按钮，新增"回看上墩"主按键（出牌右侧，金色描边，第 1 墩无历史时隐藏）；② 回看改为弹层（与查看底牌同风格 overlay），各家出的牌放在各家对应方位（复用当前墩的 trick-position-layout 布局），中央标注赢家与得分，✕ 手动关闭、5 秒自动消失（store 已有）；③ 查看底牌弹层加 5 秒自动消失（手动按钮仍可隐藏）；④ debug-bar 仅在调试模式或人类庄家时渲染（原回看按钮移走后不再无条件占位）。

**无新增测试**，引擎 675 项 + arena 65 项 + CLI 80 项 + client 47 项 = 867 项通过。

- **影响文件**：`packages/client/src/components/game/ActionBar.tsx`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-14 21:53

### 新增：拖拽框选反选——轨迹覆盖已选牌则放下（XOR 语义，与点击 toggle 一致）

**问题**：拖拽框选只能"覆盖即选中"，已选中的牌被跳过；误选后须先点掉再拖，无法直接框住已选牌放下。

**修复**：拖拽改为 XOR 语义——mousedown 快照初始选中集合，轨迹覆盖的牌取反（初始已选 → 放下、初始未选 → 选中），覆盖外保持初始状态。提取 `applyDragSelection` 纯函数：每帧重算期望状态，仅对实际变化的牌调用 select/deselect（幂等，mousemove 连续触发不会反复 toggle 抖动）。灰色不可选牌仍不参与。

**新增 6 项测试**（drag-select.test.ts：6 项），引擎 675 项 + arena 65 项 + CLI 80 项 + client 47 项 = 867 项通过。

- **影响文件**：`packages/client/src/components/game/PlayerHand.tsx`、`packages/client/src/components/game/drag-select.test.ts`

## 2026-08-14 21:28

### 修复：拖拽框选按可见（露出）区域判定——非最后一张认左侧露出区，最右一张全露可选

**问题**：手牌重叠摆放（下一张 marginLeft -34px 盖住本张右侧 34px），可见区域是左侧露出条（最右一张全露）；但拖拽判定把左 34px 当被盖、按右侧判定，导致：① 轨迹只划过右侧被盖区也误选中（应不选）；② 最右一张只覆盖左侧露出区反而选不中（应全露可选）。

**修复**：提取 `isCardCoveredByDrag(x1,y1,x2,y2,rect,isLastCard,overlapPx)` 纯函数——非最后一张可见右缘 = `right - 34`（露出左侧），最后一张可见右缘 = `right`（全露），轨迹与可见区相交才选中；PlayerHand 的 handleMouseMove 改用该函数判定。

**新增 12 项测试**（drag-select.test.ts：12 项），引擎 675 项 + arena 65 项 + CLI 80 项 + client 41 项 = 861 项通过。

- **影响文件**：`packages/client/src/components/game/PlayerHand.tsx`、`packages/client/src/components/game/drag-select.test.ts`

## 2026-08-14 20:22

### 新增：出牌按钮灰色判定——跟牌张数/牌型不合法、领出不同花色时禁用

**问题**：出牌按钮仅在未选牌时灰色；跟牌张数不对或牌型不符合要求（如对子领出需跟对子）、领出选了不同花色时按钮仍可点，点击后被校验打回（errorMessage）。

**修复**：playable 新增 `canSubmitPlay(selected, hand, trickPlays, trump)`：领出 = 单张或同组（同花色非主 / 全部主牌）；跟牌 = 张数与领出相等且 `validateFollow` 通过。ActionBar 出牌按钮 `disabled={!canSubmitPlay}`（与 0 张同样式），GameTable 传入所选牌/手牌/主牌声明。

**新增 9 项测试**（playable.test.ts：9 项），引擎 675 项 + arena 65 项 + CLI 80 项 + client 29 项 = 849 项通过。

- **影响文件**：`packages/client/src/components/game/playable.ts`、`packages/client/src/components/game/ActionBar.tsx`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/playable.test.ts`

## 2026-08-13 23:54

### 新增：GUI 对局导出增加初始手牌段（扣底后各家 25 张），当前手牌保留

**问题**：调试"AI 建议某张牌"等场景需要开局手牌（如从第 1 墩驱动模拟），但导出只有当前手牌，开局手牌须从"当前手牌 + 已出牌"反推——反推依赖描述完整且易出错（曾出现小王 3 张超张、视角错位等）。

**修复**：① GameState 新增可选字段 `initialHands`（扣底后各家初始手牌）；② 庄家扣底完成的两处（finalizeRevealAndBottom AI 庄 / submitBottomExchange 人类庄）在进入 Playing 时记录各玩家 25 张手牌；③ 导出在"底牌"与"出牌历史"之间增加 `--- 初始手牌 ---` 段（各家 25 张），当前手牌段保留。

**修改 1 项测试**（export-game.test.ts），引擎 675 项 + arena 65 项 + CLI 80 项 + client 20 项 = 840 项通过。

- **影响文件**：`packages/engine/src/types.ts`、`packages/client/src/store/gameStore.ts`、`packages/client/src/components/game/export-game.ts`、`packages/client/src/components/game/export-game.test.ts`

## 2026-08-13 21:46

### 修复：移除中间区域重复的"闲家已得分牌"展示（左上角已有点数分牌行）

**问题**：闲家得分分牌此前已移至左上角（score-display 内一行文字，10/K 在前、5 在后、按花色 SHCD），但中间区域仍保留旧版 point-collection 卡片列表（"闲家已得分牌 (N张):" + CardFace 小卡），两处重复显示。

**修复**：删除 CenterArea 的 point-collection 渲染块及 GameTable.css 对应样式（.point-collection/.point-label/.point-cards），保留左上角唯一展示。

**无新增测试**，引擎 675 项 + arena 65 项 + CLI 80 项 + client 20 项 = 840 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-13 20:04

### 新增：GUI 跟牌必出牌自动选中锁定 + 同花色不可选置灰（computeMandatoryFollow 集成）

**问题**：唯一可出之外，跟牌时部分牌必出（如领出 3 连对、手牌只有 2 连对 + 两对 → 2 连对必出），同花色内部分牌不可选（领出无单牌时单牌不可选、对数小于理想最短对数的子牌型不可选）——GUI 既不会自动选中必出牌，也不会把不可选牌置灰。

**修复**：① playable.ts 的 computePlayableIds 叠加引擎不可选集合（可点 = computeFollowableCards 排除 disabledIds），新增 computeFollowPlan 返回必出牌 id；② gameStore 新增 lockCards（追加选中 + 锁定，不覆盖用户已选的牌）；③ GameTable 跟牌 effect 由"唯一可出"扩展为"必出牌自动选中锁定"（每墩一次、不因手动选牌跳过、deselect/clear 保留锁定、出牌后释放）；④ 引擎新增 AI 一致性测试——AI 建议出牌必含全部必出牌、不含任何不可选牌（例 3/4/5、理想降级、2 连对 + 独立对 + 单 五个场景）；⑤ 模拟器（seed 42）2 局 53 断言 0 失败验证交互不卡死。

**新增 3 项测试**（playable.test.ts：3 项）

- **影响文件**：`packages/client/src/components/game/playable.ts`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/store/gameStore.ts`、`packages/client/src/components/game/playable.test.ts`、`packages/engine/src/__tests__/mandatory-follow.test.ts`

### 修复：computeMandatoryFollow 单张领出误锁对子（classify single 的 pairCount 占位）

**问题**：classify 对单张领出的约定 pairCount=1（占位），computeMandatoryFollow 的"领出含单牌"判断（leadLen > 2×对数）因此误判 false，单张领出被当作"全对领出"处理 → 理想跟牌把级牌对（如 S-2×2）锁为必出 → GUI 选中 3 张、出牌被拒（模拟器 r1 暴露：吊主单张 + 手牌一对级牌）。

**修复**：按牌型类型特判——type === 'single' 时直接返回无必出无不可选（跟牌自由）。

**新增 2 项测试**（mandatory-follow.test.ts：2 项）

- **影响文件**：`packages/engine/src/following/index.ts`、`packages/engine/src/__tests__/mandatory-follow.test.ts`

### 修复：AI 拖拉机跟牌匹配失败时拆开拖拉机出非法组合

**问题**：AI 跟拖拉机领出（如 3 连对）而手牌只有更短拖拉机（如 2 连对）时，tryMatchTractorSlots 找不到足够长的拖拉机返回 null → 落入"垫对子"分支把拖拉机拆成对子出牌（1010+99+77 跟 3 连对）→ validateFollow 拒绝（"must play a tractor with 2 or more pairs"），AI 建议出牌不合法且缺必出的 2 连对（AI 一致性测试捕获）。

**修复**：tryMatchTractorSlots 在无 ≥req 拖拉机时降级取最长的可用拖拉机（与 computeIdealFollow 的 closest-shorter 一致）+ 对子优先填充，组合恒合法；移除"拆拖拉机"路径。

**新增 5 项测试**（mandatory-follow.test.ts：5 项），引擎 675 项 + arena 65 项 + CLI 80 项 + client 20 项 = 840 项通过。

- **影响文件**：`packages/engine/src/ai/helpers.ts`、`packages/engine/src/__tests__/mandatory-follow.test.ts`

## 2026-08-13 00:24

### 新增：引擎部分必出跟牌计算——computeMandatoryFollow 返回锁定（必出）与不可选（置灰）牌 id

**问题**：唯一可出之外，跟牌时部分牌必出（例 3：领出 3 连对、手牌只有一套 2 连对 + 两对 → 2 连对必出），同花色内部分牌不可选（领出无单牌时单牌不可选、对数小于 Ideal 最短对数的子牌型不可选），GUI 无法自动选中与置灰。

**修复**：following 新增 `computeMandatoryFollow(hand, leadCards, config)` → `{ lockedIds, disabledIds }`。流程：组牌张数 ≤ 领出 → 同花色全锁；唯一可出（isOnlyLegalPlay）→ 锁唯一组合（qualifies 对子；单领出锁 1 张），其余同花色不可选；否则手牌总对数 == Ideal 总对数 → 所有对必出、单牌自由（理想降级时张数缺口由单牌填充）；手牌总对数 > Ideal → 循环 k=1..n 递增找首个 l1(k)==l2(k) 锁对数 ≥ k 的子牌型，领出含单牌 → 无不可选，否则单牌不可选 + 对数 < Ideal 最短对数的子牌型不可选。子牌型 = detectTractors 最大不重叠连续块 + 独立对牌。例 3（2 连对必出）、例 4（主牌红桃2+AAKK 3 连对必出、44 不可选）、例 5 修正版（4 连对 + 一对，无必出无不可选）均验证通过。

**新增 14 项测试**（mandatory-follow.test.ts：14 项）

- **影响文件**：`packages/engine/src/following/index.ts`、`packages/engine/src/__tests__/mandatory-follow.test.ts`

### 修复：detectTractors 跨组链合并顺序致 3 连对漏检；isOnlyLegalPlay 理想降级误判唯一

**问题**：① mergeChains 以先出现的链为锚，跨组链（副级牌 2 + 主花色 A）排在同花色链之后，无法吸收共享尾对的主花色链（副级牌2+A 与 A+K 共享 AA）→ 以跨组为基底的 3 连对（例 4 的红桃2+AA+KK）识别不出，computeIdealFollow 随之降级。② isOnlyLegalPlay Rule 3b 只比对子总数：理想跟牌降级（minTotalPairs < 领出对数）时，张数缺口由单牌自由填充 → 组合不唯一却判为唯一，会把不在组合中的对子误锁。

**修复**：① detectTractors 将 crossGroup 链前置为合并锚链（先于同花色链 push）；② Rule 3b 唯一判定增加张数条件——2 × idealTotal == 领出张数（缺口由单牌填充即不唯一）。

**新增 2 项测试**（pattern.test.ts：1 项 + following.test.ts：1 项），引擎 668 项 + arena 65 项 + CLI 80 项 + client 17 项 = 830 项通过。

- **影响文件**：`packages/engine/src/pattern/index.ts`、`packages/engine/src/following/index.ts`、`packages/engine/src/__tests__/pattern.test.ts`、`packages/engine/src/__tests__/following.test.ts`

## 2026-08-09 21:20

### 新增：GUI 交互完善——NT 大王/小王区分、跟牌张数分母、分牌展示、调试菜单扩展（手牌/底牌/历史/记牌器）、唯一可出自动选中锁定、庄家查看底牌

**问题**：无主不区分大王/小王；跟牌按钮不显示应出张数；左上角墩数显示 /25 分母（一局不一定是 25 墩）；闲家得分只有数字没有分牌；调试菜单只有导出；人类庄家无法查看底牌；唯一可出时仍需手动选牌；建议出牌与回看上轮分两行。

**修复**：① NT 区分——strength≥4 大王（红 NT）/≤3 小王（黑 NT），亮主按钮与主牌指示均区分；② 建议出牌（调试）+ 回看上轮合并一行，与跟牌/重选对齐；③ 跟牌按钮显示"跟牌（已选/应出 张）"；④ 导出按钮在调试菜单关闭时重置为"导出"（onToggle）；⑤ 拖拽多选只认露出部分（手牌 overlap 被盖的左 34px 不计）；⑥ 回看上轮无历史时提示"暂无历史墩"；⑦ 墩数去掉分母；⑧ 左上角闲家得分显示分牌——一行 5 张，10/K 档在前、5 在后、同档按花色 SHCD（实测 `K♥10♥K♣K♦K♦10♦10♦5♣5♣5♦`=85 分匹配）；⑨ 调试菜单新增 其他玩家手牌（二级：玩家列表）、底牌（非庄家可见）、历史出牌、记牌器（无主，移植 CLI showOneTracker，二级：玩家视角），全部文字输出；⑩ 人类庄家增加"查看底牌"按钮（非调试模式可用，弹层显示 8 张底牌）；⑪ 非最后一墩且唯一可出（引擎 isOnlyLegalPlay）→ 自动选中并**锁定不可放下**（deselect/clear 均保留，出牌后释放；最后一墩自动打保留）——实测 seed 42/7/123 自动选中 4/2/1 张且点击不取消。

**无新增测试**，引擎 652 项 + arena 65 项 + CLI 80 项 + client 17 项 = 814 项通过。

- **影响文件**：`packages/client/src/store/gameStore.ts`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/PlayerHand.tsx`、`packages/client/src/components/game/ActionBar.tsx`、`packages/client/scripts/lib/driver.ts`

## 2026-08-09 20:05

### 修复：GUI 显示细节——主牌对子双花色符号、不可选牌字体半透明且悬停无效果、回看上墩改文字一行

**问题**：① 对子亮主时主牌仍显示单个花色符号（如 ♠ 2，应为 ♠♠ 2）；② 不可选牌视觉上区分度不足（grayscale 灰化不明显），且悬停时仍会上浮（hover 效果未对 disabled 屏蔽）；③ 回看上墩渲染为卡片列表（每行一人），非"文字一行按出牌顺序"。

**修复**：trump-indicator 从 `gameState.reveals` 末条取 strength——对子亮主（strength≥2 且花色匹配）显示双花色符号（实测 seed 9："♠ 2 (对)" → `主牌:♠♠ 2`）；不可选牌改为**牌面不透明 + 仅字体/花色符号 opacity 0.3**（`.card.disabled:hover` 取消 transform/shadow，悬停无任何效果，实测 hover 后 transform=none）；回看上墩改为文字一行按出牌顺序从左到右（`AI-3K♥ K♥→AI-49♥ Q♥→玩家14♥ 4♥→AI-2👑A♥ A♥得分: 20`，赢家 👑 高亮）。

**无新增测试**，引擎 652 项 + arena 65 项 + CLI 80 项 + client 17 项 = 814 项通过。

- **影响文件**：`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/components/cards/CardFace.css`

## 2026-08-09 18:35

### 修复：模拟点击日志带坐标与组件名；computeFollowableCards 甩牌全对不足时降级可点（模拟整场发现）

**问题**：① 模拟器点击日志无坐标与组件信息，无法核对点击位置；② 模拟完整一场（seed 42）在第 12 局第 6 墩失败——领出为甩牌 2 对（♥ 对 + ♣ 对）时，手牌 ♣ 组只有 1 对，`computeFollowableCards` 的"lead 全对 → 仅对子牌可点"未考虑手牌无法匹配时的降级（标准规则允许垫同张数近似组合，validateFollow 的 computeIdealFollow 本就允许），UI 可点集合过窄导致模拟器无合法组合可出（"must play 4 cards"）。

**修复**：safeClick 每次点击输出 `click: [组件] @(x,y)`（box 中心坐标，stderr 实时落盘）；`computeFollowableCards` 的 lead 全对分支增加"手牌对子/拖拉机总量 ≥ lead 需求"判断——足够时仅对子牌可点，不足时组牌全可点（可垫近似组合）。**seed 42 完整一场复测：31 局 match over（14:8），684 项断言全绿，1614 次点击日志（全部在画布内），83 次调试菜单试用，exit 0**。

**新增 2 项测试**（followable.test.ts：2 项），引擎 652 项 + arena 65 项 + CLI 80 项 + client 17 项 = 814 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`、`packages/engine/src/__tests__/followable.test.ts`、`packages/client/scripts/lib/driver.ts`、`packages/client/scripts/ui-player.ts`

## 2026-08-09 18:01

### 新增：GUI 交互与显示完善——引擎可出牌集合、调试菜单右上角、墩结算融入中央、拖拽选牌、最后一墩自动出、局末底牌倍率

**问题**：初始界面（setup 面板）不在画布中央（重写 App 时丢失居中容器）；调试菜单在右下角且不可选中（debug-bar overflow 裁切）；墩结算新开独立框挤压中央区；跟对子/拖拉机时非对牌仍可选（playable 简化花色规则与引擎不一致）；回看上轮藏在调试菜单里、非调试模式不可用；不可选牌半透明（opacity 0.5）不可辨识；手牌只能逐张点击、无法拖拽多选；最后一墩人类跟出仍需手动确认；局末底牌不显示抠底倍率（庄家保底时未归零）。

**修复**：恢复 `.app-container` 居中容器（setup 面板回到画布中央，实测 x=430/552）；调试菜单移到画布右上角（absolute，展开不覆盖手牌），回看上轮独立按钮常驻居中（非调试模式也提供），建议出牌保持调试模式；墩结算不再新开框——沿用四方位布局在中央格显示"赢家 👑 · N 分"（`settled-center`）；引擎新增 `computeFollowableCards`（返回能出现在某合法跟牌组合中的牌，与 validateFollow 同口径：缺门/组牌不足 null 全可点、恰等仅组牌、全对 lead 仅对子/拖拉机牌），client playable 委托引擎；不可选牌改为不透明灰（grayscale 替代半透明）；手牌支持拖拽框选（轨迹矩形覆盖的牌全部选中，单击不误吞——仅真位移后抑制 click）；最后一墩（跟出张数 == 出牌前手牌数，非领出）停留 1 秒自动打出全部手牌（seed 7 实测自动触发）；局末中央展示底牌 + "底牌 N 分 ×倍率"（闲家抠底用引擎 multiplier、庄家保底显示 ×0）；ui-player 以 15% 概率展开调试菜单随机点功能（导出/AI 日志）后关闭再出牌，验证菜单不覆盖手牌。

**新增 12 项测试**（followable.test.ts：12 项），引擎 650 项 + arena 65 项 + CLI 80 项 + client 17 项 = 812 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`、`packages/engine/src/__tests__/followable.test.ts`（新）、`packages/client/src/components/game/playable.ts`、`packages/client/src/App.tsx`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/PlayerHand.tsx`、`packages/client/src/components/cards/CardFace.css`、`packages/client/src/components/game/SetupPanel.tsx`、`packages/client/scripts/ui-player.ts`

## 2026-08-09 17:04

### 修复：ui-player 进度日志实时落盘与 round_end 可靠捕获——stderr 输出、页面内 subscribe hook、轻量轮询

**问题**：① Node 17 下 stdout 重定向到文件有块缓冲，每局进度日志不实时落盘（后台跑完整一场时无法实时查看进度）；② 外部轮询（80ms 全量/15ms 轻量）都观察不到 round_end 状态——speed 高时 startNewRound 延迟 tick(3000) 被压缩到 ~100ms，CDP evaluate 在浏览器主线程排队错过整个窗口，导致每局结算记录缺失、转局断言从未执行、maxRounds 完成条件永不满足；③ 全量 DOM 快照每 15ms 轮询会占满页面主线程，游戏定时器饥饿。

**修复**：进度/结果日志全部改走 stderr（同步无缓冲，实时落盘）；页面内注入 zustand `subscribe` hook（回调在 store set 内同步执行，不丢状态）在 phase 变为 round_end 瞬间捕获完整结算快照（`__POKER_LAST_ROUND_END__`），模拟器读取 hook 记录每局结算并触发转局断言与完成条件；主循环改为轻量轮询（每 15ms 只读 phase/roundNumber 等字段，~1ms），仅在墩推进/局结束/人类回合时做全量快照；阶段动作（亮主/扣底/出牌路径）加 stderr 实时日志。**seed 42 实测完整一场：31 局，match over（庄家队 A=14 打赢闲家队 8），680 项断言全绿，exit 0**——32 行进度日志全部实时可见，31 局转局断言全部执行。

**无新增测试**，引擎 638 项 + arena 65 项 + CLI 80 项 + client 17 项 = 800 项通过。

- **影响文件**：`packages/client/scripts/ui-player.ts`

## 2026-08-09 16:25

### 修复：ui-player 模拟点击跑完竞技场完整一场（2→A，31 局）——matchOver 完成条件、--speed 参数、每局日志

**问题**：模拟器限定 `--max-rounds` 时，庄家队打到 A 级打赢（matchOver，不再开新局）后主循环完成条件（局数达到上限）永不满足，死等 1 小时超时；完整一场平均 ~35 局，默认 speed=8 太慢；每局日志无等级信息，诊断困难。

**修复**：matchOver（`st.matchOver`）时无条件结束并打印 `match over (team won at round N)`；新增 `--speed N` 参数（AI 回合/发牌速度缩放，默认 8）；每局 ended 日志补充 `level` 与两队等级。**用 seed 42 实测跑完完整一场：31 局，庄家队（A=14）打赢闲家队（8），1221 项断言全绿，exit 0**——覆盖亮主/反主、扣底（33 选 8 + 扣主警告）、跟对子/拖拉机/甩牌、结算轮转、A 级胜出全流程。

**无新增测试**，引擎 638 项 + arena 65 项 + CLI 80 项 + client 17 项 = 800 项通过。

- **影响文件**：`packages/client/scripts/ui-player.ts`

## 2026-08-09 14:33

### 新增：GUI 固定画布 1280×720——窗口过小警告、布局按画布重排、调试越界检查与人类模拟器

**问题**：组件位置随窗口自适应不确定，小窗口无提示且部分功能不可用；座位扇子（8 张背面卡 204px）超出 140px 座位列宽、扣底 33 张手牌超出 1280 宽；跟对子/拖拉机时 UI 只允许选 lead 花色，与引擎"组牌不足必须全出+任意填"规则不一致，用户选不满张数无法出牌。

**修复**：固定画布 1280×720 绝对居中（大屏保持绿色桌布留白），窗口任一边小于画布时显示警告横幅（"超出画布区域不可见/不可点击，请放大窗口"）；布局改为固定高度分配（顶部 58px / 中央 ~396px / 消息 24px / 面板 48px / 手牌 164px），CenterArea 内部子块限高滚动；座位扇子 overlap -40px、手牌 -34px；ActionBar 补 data-testid；调试基建升级——ui-dump 默认 1280×720 视口、新增 --viewport/--resize 参数与 bounds 越界检查段（被滚动容器裁切的元素不算画布越界）、ui-smoke 每墩断言所有元素在画布内 + 小视口警告横幅断言；新增 ui-player 人类模拟器——真实 page.click 驱动完整对局（亮主/扣底/出牌/结算/轮转），每墩确定性随机走"建议出牌"或"手动选牌"路径，出牌决策以 UI 可点集合为约束（组合搜索偏好 AI 决策的合法组合）；playable.ts 与引擎 validateFollow 规则对齐（组牌数 < lead 张数全可点、相等/更大仅组牌）。

**新增 3 项测试**（playable.test.ts：3 项），引擎 638 项 + arena 65 项 + CLI 80 项 + client 17 项 = 800 项通过。

- **影响文件**：`packages/client/src/components/WindowSizeWarning.tsx`（新）、`packages/client/src/App.tsx`、`packages/client/src/styles/global.css`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/components/game/playable.ts`、`packages/client/src/components/game/playable.test.ts`、`packages/client/src/components/game/ActionBar.tsx`、`packages/client/scripts/ui-player.ts`（新）、`packages/client/scripts/ui-dump.ts`、`packages/client/scripts/ui-smoke.ts`、`packages/client/scripts/lib/driver.ts`

## 2026-08-09 12:50

### 修复：GUI 布局与显示——亮主玩家、调试菜单右上角、出牌方位布局、发牌提速、墩结算不占位

**问题**：亮主面板不显示亮主玩家；调试菜单居中且点开挤压布局；建议出牌藏在菜单里；发牌 18 秒过慢；AI 已出牌在座位旁与中央重复显示两次；候选牌上移被截断；当前墩纵向列表不贴近玩家方位；玩家1大时本墩结算不消失挤出手牌区。

**修复**：亮主面板显示"XX 亮主: 主牌（可反主）"；🔧 调试菜单移到右上角（absolute，点开不挤压布局），建议出牌独立按钮居中（去掉"（直接选中）"）；发牌每张 180→120ms（约 12 秒发完）；移除座位旁 playedCards（已出牌统一中央显示）；候选牌容器加 padding-top 防截断；当前墩改为四方位布局（上/左/右/下对应玩家，没出就空着）；轮到人类时清除 settledTrick + 限高 150px 滚动，防手牌被挤出。

**新增 0 项测试**，引擎 638 项 + arena 65 项 + CLI 80 项 + client 14 项 = 797 项通过。

- **影响文件**：`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/PlayerSeat.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/store/gameStore.ts`

## 2026-08-09 11:37

### 修复：GUI 调试菜单与导出——折叠菜单（含 AI 日志）、一键复制对局信息

**问题**：调试按钮平铺挤压界面；无法便捷导出对局信息供复盘。

**修复**：调试区改为折叠菜单（🔧 调试，含 回看上轮/建议出牌/导出/AI 日志，菜单内容 40vh 滚动）；新增导出按钮——点击将本局亮主信息、底牌、历史出牌、当前墩、所有玩家手牌以 CLI 紧凑格式复制到剪贴板（新增 `export-game.ts` 格式化纯函数）。

**新增 2 项测试**（export-game.test.ts：2 项），引擎 638 项 + arena 65 项 + CLI 80 项 + client 14 项 = 797 项通过。

- **影响文件**：`packages/client/src/components/game/export-game.ts`（新）、`packages/client/src/components/game/export-game.test.ts`（新）、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-09 11:27

### 修复：GUI 亮主流程——发牌中可亮主/反主，亮主即确认，3 秒自动确认

**问题**：亮主面板只在发牌完成后显示（发牌中无法亮主/反主）；人类亮主/反主后仍需点"确定"；无操作时没有自动确认，人类不点就永久停等。

**修复**：亮主面板在发牌中（Dealing）即显示，可随时亮主/反主（发牌中 AI 后续仍可反）；亮主/反主即确认——Revealing 阶段点亮主按钮直接进入扣底；能亮/反但没点 → 3 秒后自动确认；不能亮/反 → 1 秒后自动确认（无需人类操作）；面板移除"确定"按钮，空选项时显示等待提示。humanReveal 支持 Dealing 阶段。

**新增 0 项测试**，引擎 638 项 + arena 65 项 + CLI 80 项 + client 12 项 = 795 项通过。

- **影响文件**：`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/store/gameStore.ts`、`packages/client/src/store/gameStore.test.ts`

## 2026-08-09 11:07

### 修复：GUI 交互——灰色禁选、建议直接选中、回看 5 秒、第四家停顿、手牌固定、日志滑动

**问题**：不符合规则的牌仍可选中；提示与建议出牌是两个按钮且不选中候选牌；上轮回看无自动关闭；第四家出牌瞬间被下一墩覆盖（trickPlays 清空即消失）；中间内容挤压手牌区；AI 日志过高挤压界面。

**修复**：新增 `computePlayableIds` 纯函数（领出全可选/跟牌同花色限定/吊主有主必出主/缺门全可选），不符合规则的牌灰色不可选；建议出牌按钮合一并直接选中候选牌；上轮回看 5 秒后自动关闭；新增墩结算显示（settledTrick：第四家出牌后保留上一墩到下一墩第一张牌出现，含👑赢家与得分）；手牌区 `flex-shrink: 0` 固定；AI 日志压缩为 120px 滑动窗口。

**新增 8 项测试**（playable.test.ts：5 项，gameStore.test.ts：3 项），引擎 638 项 + arena 65 项 + CLI 80 项 + client 12 项 = 795 项通过。

- **影响文件**：`packages/client/src/components/game/playable.ts`（新）、`packages/client/src/components/game/playable.test.ts`（新）、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/PlayerHand.tsx`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`、`packages/client/src/store/gameStore.ts`、`packages/client/src/store/gameStore.test.ts`

## 2026-08-09 10:21

### 修复：GUI 信息显示——AI 日志命名、庄家显示、发牌进度、得分左上角

**问题**：AI 日志显示内部编号 P1-P4（应为 玩家1/AI-2/AI-3/AI-4）；主牌指示无庄家信息；发牌进度分母为 100（应为本地手牌 25）；闲家得分在中央、字号偏大挤压界面。

**修复**：AI 日志改按 `players[i].name` 显示（玩家1/AI-2/AI-3/AI-4）；主牌指示新增"庄家: X"（data-testid=declarer-label）；发牌进度改 `发牌中... N/25`（本地玩家手牌数）；闲家得分固定左上角（absolute 12,8、12px、data-testid=score-display）；上轮回看字号小一号（12px）。

**新增 0 项测试**，引擎 638 项 + arena 65 项 + CLI 80 项 + client 4 项 = 787 项通过。

- **影响文件**：`packages/client/src/store/gameStore.ts`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/game/GameTable.css`

## 2026-08-09 09:37

### 新增：提取历史基线 ai-0808（133900d 快照）

**问题**：当前 ai 在 133900d 后做了第四家不盖过、NT 垫牌保留王等策略修复，133900d 时刻的策略（README 中 Elo 1012 的测量对象）需要冻结为基线用于对比。

**修复**：提取 133900d 的 ai/ 完整树（14 文件）为 `packages/engine/src/ai-0808`，注册引擎命名空间导出（`ai0808`）与竞技场策略（`--strategy-a/b ai-0808`），新增合法性测试（无中止、无验牌回退）。README 基线列表与 Elo 表更新：1012 归 `ai-0808`，当前 `ai` 标注待重测。ai-0808 的 helpers.ts 同步死代码清理（行为与快照一致，仅消除 TS2367）。

**新增 1 项测试**（historical-strategies.test.ts：1 项），引擎 638 项 + arena 65 项 + CLI 80 项 + client 4 项 = 787 项通过。

- **影响文件**：`packages/engine/src/ai-0808/`（新）、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`、`README.md`

## 2026-08-09 00:05

### 修复：NT 无主垫牌垫掉小王——级牌4是最小主牌应优先垫

**问题**：4NT 无主场景（用户反馈）：玩家1领对大王，AI-3/AI-4 跟牌时垫出小王+级牌4，而手牌还有多余的级牌4可垫。无主时主牌只有王与级牌（无普通主牌），级牌4是**最小**主牌，垫小王属浪费强牌。

**修复**：`discardSort` 的"级牌排后"规则（意图保留常主）仅在有主花色时生效——NT 无主（`trumpSuit === null`）时跳过该规则，按牌面等级升序垫牌（级牌4先于小王）。有主场景行为不变。

**新增 2 项测试**（ai-follow.test.ts：2 项），更新 arena A==A 镜像值（221→206，NT 垫牌策略改变对局走向），引擎 638 项 + arena 64 项 + CLI 80 项 + client 4 项 = 786 项通过。

- **影响文件**：`packages/engine/src/ai/utils.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`

## 2026-08-08 22:44

### 修复：第四家队友已大不盖过——加分优先，没分出最小（不局限吊主）

**问题**：第四家且队友已大（tmWin）时，多处跟牌路径仍"盖过队友"：单张吊主 `hasPoints` 无条件出最大主牌（用户场景：方块主 level 2，手牌 H2 级牌/DA/DJ 全大于队友 D9，建议出级牌 H2 浪费最强主牌）；拖拉机/对子分支第四家找不到最小匹配时去找能盖的组合盖队友；NT 单张同样缺"不盖"逻辑。违反"队友已大不需要盖过"原则。

**修复**：统一原则（第四家 tmWin，吊主与领副通用）：① 加分优先——手牌有分牌出最小分牌（不盖过更好）；② 没分可加 → 出最小的不盖过的主牌/副牌（垫，让队友赢）；③ 手牌全部大于 currentMax（被迫盖）→ 出最小能盖的，保留大牌。覆盖 7 处：follow-trump.ts 单张吊主、吊主拖拉机（不找盖）、吊主对子（不降序、不找盖对）、NT 单张；follow-offsuit.ts 跟副拖拉机、跟副对子。跟副单张原有"加分/避分"逻辑已符合，未动。用户场景修复后出 DJ（保留 H2 级牌与 DA）；有分牌场景（队友 A 大、手牌 SK）出 SK 加分且不盖。

**新增 2 项测试**（ai-follow.test.ts：2 项），更新 1 项旧断言（盖队友→垫最小）+ arena A==A 镜像值（214→221，第四家策略改变对局走向），引擎 636 项 + arena 64 项 + CLI 80 项 + client 4 项 = 784 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/ai/follow-offsuit.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`

## 2026-08-08 20:10

### 修复：引擎类型检查全绿，`npm run build` 首次完整通过

**问题**：引擎 `tsc --noEmit` 报 63 个类型错误——① `ai/helpers.ts` 的 `mode === 'forbid'` 比较：本函数内 mode 仅产生 avoid/open/add/full，第一个比较后 TS 收窄使 'forbid' 永远不可达（TS2367）；② 62 个测试文件错误：引擎类型重构后 `createCard('S', ...)`/`pair('H')` 等仍用字符串字面量传 `CardSuit` 参数。这些错误使引擎 build 与根 `npm run build`（tsc && vite build）一直失败。

**修复**：helpers.ts 删除死代码比较（forbid 仅来自 follow-offsuit 的 fillMode，此处不可能出现），注释注明口径；测试文件改用枚举 `Suit.Spades/Hearts/Clubs/Diamonds` 与 `SpecialSuit.Joker`（ai-follow.test.ts 41 处、round-outcome.test.ts 17 处、revealing.test.ts 4 处）。行为零变化，`npm run build` 完整通过。

**新增 0 项测试**，引擎 634 项 + arena 64 项 + CLI 80 项 + client 4 项 = 782 项通过。

- **影响文件**：`packages/engine/src/ai/helpers.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/engine/src/__tests__/round-outcome.test.ts`、`packages/engine/src/__tests__/revealing.test.ts`

## 2026-08-08 19:23

### 新增：client store 单测（种子局全流程/亮主等待/33 张扣底/matchOver 停局）

**问题**：GUI 的 store 编排逻辑（发牌/亮主/扣底/结算/轮转）无任何自动化测试，回归只能靠 ui-smoke 浏览器断言。

**修复**：client 新增 vitest 配置与 `gameStore.test.ts` 4 项测试（fake timers + mock dev 参数锁定 seed=42）：①4 AI 种子局完整打到 RoundEnd（得分 145 与 smoke 已知结果一致、甩牌局 17 墩提前耗尽）；②有人类时亮主阶段等待人工操作不自动 finalize；③人类亮无主顶庄 → 33 张选 8 扣底 → 25 张出牌；④庄家 A 打赢 → matchOver 停局不再续局。dev.ts 增加非浏览器环境容错。

**新增 4 项测试**（gameStore.test.ts：4 项），引擎 634 项 + arena 64 项 + CLI 80 项 + client 4 项 = 782 项通过。

- **影响文件**：`packages/client/vitest.config.ts`、`packages/client/src/store/gameStore.test.ts`、`packages/client/src/dev.ts`

## 2026-08-08 19:15

### 修复：GUI 可玩——store 编排重写（亮主/扣底/结算/轮转）+ 引擎甩牌早结束

**问题**：client 有多处致命缺陷——① finalizeReveal 后 phase 停在 BottomExchange 从未置 Playing，第一局发完即卡死；② 人类扣底面板条件 `hand.length===33` 永不成立（底牌从未并入人类手牌）；③ 人类亮主只有 1.5 秒窗口且被自动 finalize 抢跑；④ 局间升级/庄家轮转是近似实现（dealerIndex 不存在、未用 computeRoundOutcome 口径）；⑤ 引擎 RoundEnd 只看 `tricksPlayed>=25`，甩牌局单墩多张时手牌提前耗尽仍要求出牌 → AI 空手牌卡死（GUI 种子局第 17 墩复现，CLI 同样会触发）。

**修复**：
- 引擎：`advanceAfterPlay` 的 RoundEnd 判定增加"所有玩家手牌为空"（game/index.ts），新增 round-end-early 测试 2 项。
- client store 重写：finalize/扣底统一走 `finalizeRevealAndBottom`（人类确定 → finalize → AI 庄家 25 张自动扣底 / 人类庄家底牌并入 33 张待选，两分支显式置 `phase: Playing`）；人类亮主面板等待人工操作（不再被抢跑），`humanPassReveal` = 亮主完毕；startNewRound 用引擎 computeRoundOutcome + advanceLevel（必打 K/A）正确升级/轮转/结算 matchOver。
- UI：局末结算面板（大光/小光/保级/上台、底牌翻出×倍数、抠底、胜利屏，与 CLI showRoundResult 同口径）；座位限制（仅南座人类 + 4AI 观战）；观战模式隐藏本地手牌；全组件 data-testid/data-card-id 铺底；玩家命名对齐 `玩家1`/`AI-2`；`?speed=` 参数独立于 auto 生效。
- ui-dump：动作按命令行顺序执行（wait/click 交错）、waitForSelector 防渲染竞态、新增 `--click-testid`。

**新增 2 项测试**（round-end-early.test.ts：2 项），引擎 634 项 + arena 64 项 + CLI 80 项 = 778 项通过。ui-smoke 种子局 359 断言全绿（含双跑指纹一致）。

- **影响文件**：`packages/engine/src/game/index.ts`、`packages/engine/src/__tests__/round-end-early.test.ts`、`packages/client/src/store/gameStore.ts`、`packages/client/src/components/game/GameTable.tsx`、`packages/client/src/components/game/SetupPanel.tsx`、`packages/client/src/components/game/PlayerSeat.tsx`、`packages/client/src/components/game/CenterArea.tsx`、`packages/client/src/components/cards/CardFace.tsx`、`packages/client/src/dev.ts`、`packages/client/scripts/ui-dump.ts`

## 2026-08-08 18:28

### 重构：结算口径下沉引擎（computeRoundOutcome/advanceLevel 唯一来源）

**问题**：上台判定与等级变更口径散落在 CLI（round-result.ts）与 arena（advance-level.ts，必打 K/A 规则）两处，GUI 开发又需要同一口径——继续复刻将是第三份拷贝。

**修复**：`computeRoundOutcome`/`RoundOutcome` 迁入 `packages/engine/src/scoring/round-outcome.ts`，`advanceLevel`/`LEVEL_K`/`LEVEL_A` 迁入 `scoring/advance-level.ts`，经 scoring/index 导出；CLI 与 arena 的源文件改为 re-export shim，行为零变化（两包测试原样通过）。

**新增 18 项测试**（round-outcome.test.ts：9 项，advance-level.test.ts：9 项），引擎 632 项 + arena 64 项 + CLI 80 项 = 776 项通过。

- **影响文件**：`packages/engine/src/scoring/round-outcome.ts`、`packages/engine/src/scoring/advance-level.ts`、`packages/engine/src/scoring/index.ts`、`packages/cli/src/round-result.ts`、`packages/arena/src/advance-level.ts`

## 2026-08-08 18:25

### 新增：无视觉 AI 的 GUI 调试基建（ui-dump/ui-smoke）

**问题**：开发 GUI 时模型不支持图片输入，无法通过截图调试界面；且调试需要可复现的牌局。

**修复**：client 暴露 `window.__POKER_STORE__`（自动化可读完整 GameState）；新增 `?seed=N`/`?auto=1`/`?speed=n` 开发参数（种子化发牌 + 4AI 观战 + 加速）；新增 playwright-core 脚本 `scripts/ui-dump.ts`（驱动系统 Chrome 无头输出 DOM/布局/状态文本 dump，无视觉模型的"眼睛"）与 `scripts/ui-smoke.ts`（种子化逐墩断言 + 同种子双跑指纹比对）。依赖 playwright-core@1.48.2（兼容 Node 17，系统 Chrome channel 免下载）。

- **影响文件**：`packages/client/src/dev.ts`、`packages/client/src/main.tsx`、`packages/client/src/store/gameStore.ts`、`packages/client/scripts/ui-dump.ts`、`packages/client/scripts/ui-smoke.ts`、`packages/client/scripts/lib/driver.ts`

### 修复：client 无法编译（引擎 API 已改名）

**问题**：`packages/client` 引用引擎已不存在的导出（`dealCards`/`getLeadSuit`/`isPointCard`/`cardPoints`）与字段（`dealerIndex`），`tsc --noEmit` 报 8 个类型错误，应用无法加载（浏览器端 vite 编译直接抛错）。

**修复**：映射到现行引擎 API——`getLeadSuit(pattern)` → `PlayedCards.leadSuit` 字段、`isPointCard` → `isPointRank`、`cardPoints` → `cardPointsFromRank`、`dealerIndex` → `trumpDeclaration.declarerIndex ?? declarerIndex`；删除未使用的 `dealCards` 导入；AI 命名对齐 `AI-2`（CLAUDE.md 约定）。client 自身类型检查恢复干净。

- **影响文件**：`packages/client/src/store/gameStore.ts`、`packages/client/src/components/game/CenterArea.tsx`

## 2026-08-08 16:09

### 修复：缺门垫牌全是主牌时理由应为"垫主牌"

**问题**：第 13 墩场景（P2 领 ♥9♥9，P0 第二家手牌全主、无主对不能毙对子），/hint 建议 ♠Q♠A 理由显示"垫牌"——垫出的全是主牌，应显示"垫主牌"（finishTeammateWin 已有此区分，discardNonTrump 缺门路径漏了）。

**修复**：`discardNonTrump` 的 reason base 按垫出牌判定——全部是主牌 → 「垫主牌」，否则「垫牌」（与 finishTeammateWin 的 hasNonTrump 判定一致）。STRATEGY.md 后缀表「垫主牌」语义同步扩展。

**新增 1 项测试**（ai-follow.test.ts：1 项），引擎 614 项 + arena 64 项 + CLI 80 项 = 758 项通过。

- **影响文件**：`packages/engine/src/ai/helpers.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/engine/src/ai/STRATEGY.md`

## 2026-08-08 15:48

### 修复：第四家出牌理由恒标注加分/不加分

**问题**：第四家的决策完全围绕加不加分，但多个路径的 reason 缺标注（实测矩阵枚举）：主牌单张队友大盖过、对手大有分盖过（「同花色出大」无后缀）；副牌单张队友大 70 禁分（「同花色出小」）；void 垫牌（「垫牌」）；毙牌盖不过（「盖不过，垫副牌」）；NT 甩主牌多张与拖拉机垫牌（「垫同花色/垫主牌」）——与 short 路径的「（盖不过，不加分）」不一致。

**修复**：第四家各路径 intent 补齐——能盖过：队友大 → 加分（add），对手大 → 抢分（beat_points）；盖不过/禁分/void 垫牌/毙牌盖不过/NT 多张/拖拉机垫 → 不加分（avoid）。fast path（唯一可出/最后 N 张必出）豁免。第二/三家与 lead fallback 行为不变；跨 40 台阶冲分场景维持现状（add 后缀会错标"队友已大"，文案体系未新增冲分后缀）。

**新增 8 项测试**（ai-follow.test.ts：8 项，第四家 reason 恒标注矩阵），引擎 613 项 + arena 64 项 + CLI 80 项 = 757 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/ai/follow-offsuit.ts`、`packages/engine/src/ai/helpers.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-08-08 14:44

### 修复：getCompareKey 兜底顺序漏拖拉机——本可盖毙却垫牌

**问题**：14:29 修复（拖拉机覆盖领出对子时崩溃）的兜底顺序为 `fc.pairs → fc.singles → maxCard(follow)`，跳过了拖拉机成分。当 AI 用「拖拉机+单」盖毙（如 NT 下 小王对+♥11对+♠11，最大 900）对付最大 800 的对方毙牌时，填充后 key 取单张（800）与对方打平，被误判盖不过——**本可盖毙却垫牌**。用户追问"第四家试图用对小王盖毙，但他实际上盖不过"暴露了这一点（原崩溃场景对方有 2 大王，AI 确实盖不过、正确垫牌；但无大王的场景会被误判）。

**修复**：`getCompareKey` throw 分支在 fc.pairs 为空时**先取 fc.tractors 最大牌**（与 matchPattern 的对数折算一致），再 singles、最后 follow 整体兜底。原崩溃场景行为不变（盖不过仍垫牌）。

**新增 1 项测试**（ai-follow.test.ts：1 项，修复前失败——垫牌 [2,3,8,5,5] 而非盖毙），引擎 605 项 + arena 64 项 + CLI 80 项 = 749 项通过。

- **影响文件**：`packages/engine/src/comparing/index.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-08-08 14:29

### 修复：竞技场崩溃——拖拉机覆盖领出对子时 getCompareKey 对空数组求 maxCard

**问题**：`npm run arena -- --pairs 5000 --seed 43 --strategy-b ai-0801` 跑 7000 场后崩溃 `Reduce of empty array with no initial value`（PAIR 3547 复现）。根因：NT 模式（级牌 11），领出 ♠A♠A♠Q♠Q♠K（两对+单甩），玩家 2 用 2 大王+♦11♦11+♣11 全主盖毙；第四家 AI 手上有小王对+♥11对（NT 常主跨组拖拉机），盖毙时 `trumpKill` 把拖拉机当两个独立对选出，`compareTwo` 双方都匹配领出后进入 `getCompareKey`——领出含对（lc.pairs 非空）而 follow 的成分全被拖拉机吞掉（fc.pairs 空）→ `maxCard([])` 崩溃。另：闲家 60 分 + 领出 10 分 = 70 触发禁分（不走加分路径），才走到盖毙崩溃路径。

**修复**：`getCompareKey` throw 分支对空成分兜底——fc.pairs 为空时依次尝试 fc.singles、最后用 follow 整体最大牌（`maxCard(follow)`），不再对空数组求值。该分支仅在拖拉机覆盖领出对（或纯主牌毙）时触发，其余路径行为不变。

**验证**：seed 43 崩溃对决（PAIR 3547）修复后正常（AI 盖不过垫牌）；新增 2 项测试（ai-follow.test.ts：2 项）——修复前均崩溃（空数组 reduce），修复后通过。引擎 604 项 + arena 64 项 + CLI 80 项 = 748 项通过。

- **影响文件**：`packages/engine/src/comparing/index.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`

## 2026-08-08 12:54

### 修复：第三家盖不过主牌单张时垫分牌而非非分牌

**问题**：第三家跟主牌单张、盖不过前两家时（规格第 4 条"出最小主牌且不加分"），实现按有效大小纯排序取最小，把 10 分的主牌垫出（有非分 ♥Q 却出了 ♥10），"不加分"未落实——不加分应参照第二家第 5 条避分优先级（主牌 A 以下非分单先于分单，级牌归"主牌 A 或更大"末类）。

**修复**：`followTrumpLead` 第三家盖不过分支改用避分排序（`discardSort(false)`）选牌——非分主牌先于分牌主牌，级牌后置；reason 仍为「同花色出小（尽量少加分）」。其余分支不变。

**新增 1 项测试**（ai-follow.test.ts：1 项），引擎 602 项 + arena 64 项 + CLI 80 项 = 746 项通过。另同步更新 arena A==A 冒烟精确断言（224 → 214——本修复改变了 seed 42 对局走向）。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/engine/src/ai/STRATEGY.md`

## 2026-08-07 19:27

### 归档移除基线策略 ai-0707 / ai-0712 / ai-0726

**移除**：删除三个已归档基线策略的完整目录（`packages/engine/src/ai-0707/`、`ai-0712/`、`ai-0726/`），引擎 `index.ts` 导出、竞技场适配器与 `strategyByName` 条目同步移除；`historical-strategies.test.ts` 删除对应 3 项合法性测试。竞技场默认策略 B 从 `ai-0726` 改为 `ai-0801`（现存最近基线）。README 历史基线列表与选项表移除三项（标注归档），**Elo 表完整保留仅作展示**（`ai-0726` = 988.1、`ai-0712` = 463.6、`ai-0707` = -528.5），`elo-verify.ts` 不受影响（独立数学验证，复跑通过）。

**删除 3 项测试**（historical-strategies.test.ts：3 项），引擎 601 项 + arena 64 项 + CLI 80 项 = 745 项通过。

- **影响文件**：`packages/engine/src/ai-0707/`、`packages/engine/src/ai-0712/`、`packages/engine/src/ai-0726/`（删除）、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/run.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`、`packages/arena/src/__tests__/progress.test.ts`、`README.md`

## 2026-08-06 23:26

### 新增：竞技场报告指标"胜出时对方平均等级"

**问题**：竞技场报告有胜率与各等级台上/台下胜率，但没有衡量"赢得的对局有多快/多压倒"的指标——同样是 60% 胜率，对方平均被压在第 5 级和第 12 级时含金量完全不同。

**修复**：新增指标"胜出时对方平均等级"——每场我方胜出（庄家 A 级打赢）时记录对方终局等级，累计 Σ对方等级/胜场数。`playMatch` 在 `MatchResult` 增加 `finalLevels`（双方终局等级，封顶平局也记录）；`addMatchOutcome` 增加该参数并累计 `matches.oppLevel`；报告在胜率行下输出（如 `10.5000 (42/4)`）；JSON 导出/检查点随 `toJSON` 自动包含。统计口径与已有 per-level 表一致（L2–L14，A=14）。

**修改 4 处测试断言**（stats.test.ts：3 处，arena-e2e.test.ts：1 处），总数不变：引擎 601 项 + arena 67 项 + CLI 80 项 = 748 项通过。

- **影响文件**：`packages/arena/src/types.ts`、`packages/arena/src/match.ts`、`packages/arena/src/stats.ts`、`packages/arena/src/run-pairs.ts`、`packages/arena/src/run.ts`、`packages/arena/src/__tests__/stats.test.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`

## 2026-08-06 22:02

### 提取历史基线策略 ai-0802（ebe0625）

**新增**：从 git 历史提取 `ebe0625`（2026-08-02，分位置跟牌重构提交）时的 `ai/` 完整目录为 `ai-0802`（15 个文件），注册进竞技场（`--strategy-a/b ai-0802`），合法性测试覆盖（pairs 10、11），README 策略列表同步更新。用于 PK 重构效果（与重构前基线 ai-0801 对比）。

**新增 1 项测试**（historical-strategies.test.ts：1 项），引擎 601 项 + arena 67 项 + CLI 80 项 = 748 项通过。

- **影响文件**：`packages/engine/src/ai-0802/`、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`、`README.md`

## 2026-08-06 21:30

### 策略：修正加分垫牌优先级与毙牌/盖毙选牌（第三家⑥ + 第四家）

**问题**：实现与规格存在多处偏差——加分垫牌类别缺"副牌分对"两级（非拖拉机/拆拖拉机）细分、主牌分对未限非常主、A 以下主牌非分单/对与常主分单未细分；毙牌各牌型不优先选分牌（有 ♠4 就出 ♠4 不出 ♠5）；盖毙不保证对子槽位盖过对方最大对应子牌型；40 台阶判定只看已得分、不含本墩已出分。

**修复**：
- **加分垫牌（第三家⑥/第四家③）**：`catOf 'add'` 重写为 14 级——副10/副K/副5/副牌分对(非拖拉机，类内10>K>5)/其他非分副/副牌分对(拆拖拉机)/主10·K·5(非常主)/主牌分对(非常主)/A以下主牌非分单/A以下主牌非分对/常主分单/其他主牌(小→大)。副牌分对按是否处于拖拉机中区分（单元标记 inTractor）。
- **毙牌优先选分牌（第四家原则6注）**：第四家身后无人、加分安全——单张毙/多牌毙的对子与填充均分牌优先（10>K>5，级牌除外，同分取小，独立对先于拖拉机对）；第二/三家身后有人可盖毙，保持最小。盖毙单张分最多优先否则最小能盖。
- **盖毙对子（第四家原则6注）**：对子槽位先选能盖过对方最大对应子牌型的（分最多优先，否则最小能盖），其余按分最多、最小；拖拉机槽位同样分最多优先。
- **40 台阶判定**：`attackerNearThreshold` 计入本墩已出分（visibleTrickPoints），与"全力加分能跨过40台阶"规则一致（如 60 分 + 领出 10 分 → 80 台阶触发全力加分）。

**验证**：用户原始场景（毙 ♣A♣A♣J♣J♣K）建议从 ♠6♠6♠K♠K♠3 变为 ♠6♠6♠K♠K♠5——"用分牌盖"落到实处；第二家毙牌三档回归测试保持通过。

**新增 10 项测试**（ai-position-policy.test.ts：5 项，ai-follow.test.ts：5 项），引擎 601 项 + arena 66 项 + CLI 80 项 = 747 项通过。

- **影响文件**：`packages/engine/src/ai/position-policy.ts`、`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/ai/follow-offsuit.ts`、`packages/engine/src/ai/helpers.ts`、`packages/engine/src/ai/index.ts`、`packages/engine/src/__tests__/ai-position-policy.test.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-08-05 22:50

### 修复：毙牌填充单张分牌优先（落实"用分牌盖"）

**问题**：毙甩牌时注记是"用分牌盖"（beat_points/add），但填充单张按最小有效 rank 选择，完全忽略分牌——实测领出 ♣A♣A♣J♣J♣K 时建议 ♠6♠6 ♠K♠K ♠3，手上有 ♠5（5 分）却填了 ♠3（0 分），意图与行为不一致。

**修复**：`trumpKill` 对子分支的填充排序改为分牌优先：10 分 > K/5 的 5 分，同分取小（保存大牌），无分再按最小。级牌（rank=level）不算分牌——常主只在跨 40 分台阶时出，不作填充优先。对子部分不受影响（hasPoints 时仍反转取大对/分对，4 个主对时 ♥K♥K 仍入选）。

**新增 3 项测试**（ai-follow.test.ts：3 项，等级用 6 使 ♥5 为普通分牌而非级牌），引擎 591 项 + arena 66 项 + CLI 80 项 = 737 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-08-05 22:13

### 改进：亮主阶段交互——不可亮/反时不提示，可亮/反时只显示可用选项

**问题**：亮主阶段无条件展示完整选项列表（"可以亮主: ♣5(对) -> 草花主 ..."）和提示，即使当前主牌下这些选项全部无效（如当前对子时，对子与单张都不能反），玩家仍需手动回车跳过；提示固定写 S/H/C/D 四种花色，与手牌实际可亮花色脱节。

**修复**：
- 新增 `usableRevealOptions`（手牌选项按反主规则过滤 + 按花色去重，对大小王同花色 null 保留强者）与 `revealHint`（缩写=花色名，如 `C=草花主`）纯函数。
- 不可亮/反（无可用选项）时静默跳过，直接输出亮主结果；可亮/反时提示只列可用选项，如 `亮主? (C=草花主, N=大王无主, 回车跳过): `。
- N 仅在对王可用时出现，并标注所用王对（`N=大王无主` / `N=小王无主`）；同时有对大小王时 N 用对大王亮（strength 4 优先，与 tryReveal 行为一致）。

**新增 7 项测试**（parse.test.ts：7 项），引擎 588 项 + arena 66 项 + CLI 80 项 = 734 项通过。

- **影响文件**：`packages/cli/src/parse.ts`、`packages/cli/src/index.ts`、`packages/cli/src/__tests__/parse.test.ts`

## 2026-08-05 21:53

### 修复：亮主状态显示分不清单张与对子

**问题**：对子亮主时"当前主"只显示一张（AI-3 用 ♥5♥5 亮主却显示 `当前主: ♥5`），单张外观让人误判为单张亮主——单张与对子的反主规则不同（对子只能被更强牌型反），显示歧义会导致玩家做出错误决策。

**修复**：新增 `revealLabel` 纯函数——单张亮主显示 `♥5`，对子亮主显示 `♥5♥5`，对大王/对小王显示 `JOKER JOKER` / `joker joker`（与手牌显示大小写一致），`showRevealStatus` 改用该函数（发牌中与亮主阶段共用）。

**新增 5 项测试**（parse.test.ts：5 项），引擎 588 项 + arena 66 项 + CLI 73 项 = 727 项通过。

- **影响文件**：`packages/cli/src/parse.ts`、`packages/cli/src/index.ts`、`packages/cli/src/__tests__/parse.test.ts`

## 2026-08-05 19:30

### 修复：NT 跟拖拉机领出时拆对出非法牌

**问题**：`followNTTrumpLead` 多张分支的 `neededPairs` 只算 `leadCombo.pairCount`，纯拖拉机领出（如 NT 下对小王 + A级牌对，pairCount=0）时一个对子都不出，把对子拆成单张跟牌（"must play at least 1 pairs"），CLI 全降级失败后对局中止。通过 arena ai-0801 合法性测试中止定位。

**修复**：对子需求 = 独立对子 + 拖拉机包含的对子数（`leadCombo.pairCount + Σ tractors.pairCount`）。

**新增 8 项测试**（revealing.test.ts：7 项——canOverride 反主边界 3 项 + aiTryReveal 4 项；ai-follow.test.ts：1 项 NT 拖拉机跟牌），引擎 588 项 + arena 66 项 + CLI 68 项 = 722 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`、`packages/engine/src/__tests__/revealing.test.ts`

## 2026-08-04 23:42

### 修复：CLI 各选项非法输入弹警告

**问题**：除人类玩家数量外，其余 CLI 提示对非法输入一律静默处理——存档编号越界静默不加载、续玩墩号非法静默回退、调试模式输入非 y 静默按 n、首局等级花色无法识别静默默认 2 级、继续下一局输入非 n 静默继续。用户无从得知输入被修正或忽略。

**修复**：新增纯函数 `parseYesNo` / `parseSaveChoice` / `parseTrickNumber`（parse.ts），`parseLevelSuit` 增加 `warning` 字段（等级 <2 或 >14 钳制并警告、完全无法识别警告，`NT` 单独出现合法不警告）。CLI 各提示点接入，非法输入统一弹 `⚠️` 黄色警告；指定庄家与亮主的既有无效文案统一为 ⚠️ 样式。

**新增 21 项测试**（parse.test.ts：15 项，parse-level.test.ts：6 项），引擎 580 项 + arena 66 项 + CLI 68 项 = 714 项通过。

- **影响文件**：`packages/cli/src/parse.ts`、`packages/cli/src/parse-level.ts`、`packages/cli/src/index.ts`、`packages/cli/src/__tests__/parse.test.ts`、`packages/cli/src/__tests__/parse-level.test.ts`

## 2026-08-04 23:29

### 修复：人类玩家数量输入超范围时弹警告

**问题**：`人类玩家数量 (0-4, 默认1)` 输入 5 或 -1 时被静默钳制（5→4、-1→0），没有任何说明，用户无从得知输入被修正。

**修复**：解析逻辑抽为纯函数 `parseHumanCount`：有效输入 (0-4) 原样返回；超范围钳制并警告 `⚠️ 输入超出范围 (0-4)，已按 N 处理`；非数字警告 `⚠️ 无效输入，默认 1`；空输入静默取默认 1。

**新增 7 项测试**（parse.test.ts：7 项），引擎 580 项 + arena 66 项 + CLI 47 项 = 693 项通过。

- **影响文件**：`packages/cli/src/parse.ts`、`packages/cli/src/index.ts`、`packages/cli/src/__tests__/parse.test.ts`

## 2026-08-04 23:12

### 修复：扣底重复选牌损坏牌局，出牌失败陷入死循环

**问题**：扣底输入可含重复编号（实测 "22 23 24 25 20 21 18 21"，21 出现两次）——`parseCards` 对重复索引不做校验，返回同一张牌多次："选 8 张"实际只移走 7 张，庄家手牌剩 26 张而非 25 张，总牌数不再守恒；后续 AI 出牌被拒且全部降级失败时，CLI 打印"崩溃, 跳过"后直接 return，本墩永远无法推进，游戏无限循环（实测第 502795 墩仍未结束，而正常对局最多 25 墩）。

**修复**：
- `parseCards` 拒绝重复编号（报 `重复编号: N（同一张牌只能选一次）`）。扣底与出牌共用此解析器，出牌输入的同类问题一并修复（引擎领出/跟牌验证本已拒绝重复牌，但扣底路径由 CLI 手动算牌、绕过引擎验证）。
- AI 出牌被拒的降级链改为：手牌前 N 张 → 暴力搜索任意合法组合（字典序，上限 20 万次）→ 仍失败则抛错终止对局（外层 catch 转储现场），不再静默跳过。

**新增 6 项测试**（parse.test.ts：6 项），引擎 580 项 + arena 66 项 + CLI 40 项 = 686 项通过。

- **影响文件**：`packages/cli/src/parse.ts`、`packages/cli/src/index.ts`、`packages/cli/src/__tests__/parse.test.ts`

## 2026-08-02 23:02

### 提取历史基线策略 ai-0712 与 ai-0719

**新增**：从 git 历史提取早期策略——`68a134`（2026-07-12）→ `ai-0712`、`98221b`（2026-07-19）→ `ai-0719`（完整目录复制，早期"index + 辅助文件"结构），注册进竞技场（`--strategy-a/--strategy-b ai-0712/ai-0719`），合法性测试覆盖，README 策略列表同步更新。

**修复**（提取时发现的历史 bug，最小改动保持策略意图）：
- `ai-0712`：跟对子领出时对子不足（`myPairs.length >= pairCount`）跳过带对分支 → 0 对子非法跟牌（与 ai/ 448d36d 同类）；NT 下跟常主对/拖拉机无对子匹配（`followNTTrumpLead` 多张分支只按大小垫最小常主）。
- `ai-0719`：`followOffSuitMulti` 对子分支同款 bug；98221b 上游编译错误（`shouldAvoid` 未定义、`hasPoints` 类型、`Reveal.cards` 已随 Reveal 类型移除）；NT 记牌器 `possibleTrumps` 由旧 `string[]` 结构适配为当前引擎的 `Record<key, count>` 结构（3 个读取端重写）。

**新增 2 项测试**（historical-strategies.test.ts：2 项），引擎 580 项 + arena 66 项 + CLI 34 项 = 680 项通过。

- **影响文件**：`packages/engine/src/ai-0712/`、`packages/engine/src/ai-0719/`、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`、`README.md`

## 2026-08-02 21:21

### 重构：跟牌策略改为分位置决策（第二家/第三家/第四家）

**问题**：原跟牌策略为"牌型驱动"（单张/对子/拖拉机/甩牌 + tmWin + isMaxPattern 判断），与新的分位置规格冲突：第二家避分按领出牌型而非手牌数、第三家加分条件粗糙（甩牌恒加分）、第四家加分优先级缺"非分副牌先于主分"与"非常主"限定、缺 70/75 禁分与 80 防御。

**修复**：按分位置规格重构整个跟牌模块——新增 `ai/position-policy.ts`（跨类别垫牌排序 avoid/open/add/full/forbid、强后续判断、可见分统计、80 防御、拆对跨 40 台阶判定）；`follow-trump.ts`/`follow-offsuit.ts`/`index.ts` 按位置分支重写（第二家手牌数避分与拆对、字面最大盖过、毙牌三档 killMode、第三家领出大不毙与强牌抢权、主牌单 A+ 规则、甩牌内容感知加分、70/75 禁分、第四家 catAdd 优先级与跨 40 全力加分）；`reason.ts` 文案体系不变。NT（无主）逻辑保持原样；快照 ai-0801/ai-0726/ai-0707 不受影响。

**新增 60 项测试**（ai-position-policy.test.ts：22 项、ai-position-follow.test.ts：38 项），引擎 580 项 + arena 64 项 + CLI 34 项 = 678 项通过。

- **影响文件**：`packages/engine/src/ai/position-policy.ts`（新）、`follow-offsuit.ts`、`follow-trump.ts`、`helpers.ts`、`index.ts`、`utils.ts`、`STRATEGY.md`、`__tests__/ai-follow.test.ts`、`__tests__/ai-position-policy.test.ts`（新）、`__tests__/ai-position-follow.test.ts`（新）

## 2026-08-02 16:08

### 竞技场：复制当前策略快照 ai-0801

**新增**：当前 `ai/` 的副本（2026-08-01 快照，含当日修复）作为 `ai-0801`，经 `export * as ai0801` 暴露并注册进竞技场（`--strategy-a/--strategy-b ai-0801`），用于未来策略更新后的对比基线；合法性测试覆盖，README 策略列表同步更新。

**新增 1 项测试**（historical-strategies.test.ts：1 项），引擎 520 项 + arena 64 项 + CLI 34 项 = 618 项通过。

- **影响文件**：`packages/engine/src/ai-0801/`、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`、`README.md`

## 2026-08-02 16:06

### 修复：甩牌带对子跟牌时对子不足导致 0 对子非法跟牌

**问题**：竞技场合法性检测发现整场对局中止——跟 5 张甩牌（2 对 + 1 单）时，跟牌者手上有 1 对但少于领出的 2 对，ai 的 `followOffSuitMulti` 因 `myPairs.length >= leadCombo.pairCount` 不成立而跳过"带对子"分支，落到"出最小"产生 0 对子的非法跟牌；两级回退也失败（多张领出无法用单张跟），对局中止。此前 ai-0707 测试中的中止也是同一根因。

**修复**：`followOffSuitMulti` 的对子分支条件放宽为 `myPairs.length > 0`——甩牌含对子时只要有对子就带出（数量不足时用单张填充），与引擎规则（有对子必须带出至少 1 对）一致。

**新增 1 项测试**（ai-follow.test.ts：1 项，level=12 下 S-55 为真副牌对子），引擎 520 项 + arena 63 项 + CLI 34 项 = 617 项通过。

- **影响文件**：`packages/engine/src/ai/follow-offsuit.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-08-02 14:37

### 竞技场：修复升级账本与扣底负数切片两个 bug

**问题**：用户通过升级记录发现——第 8 手闲家 B 上台 2->3 后，第 9 手 B 的等级仍是 2。

**修复**：
- **升级账本记错队伍**：playMatch 用庄家等级调用 `advanceLevel` 并写回庄家的等级桶；闲家上台时升级应作用于闲家队（用闲家自己的等级）。修复后同一对局手 8→9：B 2->3、第 9 手庄家 B 等级 3
- **扣底负数切片**：`tryVoidSuit` 扣绝的门超过 8 张时，`remaining.slice(0, 8 - length)` 的负数 end 会返回大量多余牌，discard 膨胀到 18 张、庄家扣后仅剩 15 张牌导致对局崩溃（升级账本修复改变了等级序列，暴露了这一潜在 bug）。修复：超过 8 张的门不作为扣绝候选；竞技场 playHand 增加防御——扣底非 8 张时回退均匀扣底并计入 errors

**影响**：此前所有竞技场结果（升级节奏、技术指标与胜负）均受等级账本 bug 污染，需重新运行 PK。

**新增 3 项测试**（ai-bottom-strategy.test.ts：2 项；arena-e2e.test.ts：1 项等级账本一致性不变式），引擎 519 项 + arena 63 项 + CLI 34 项 = 616 项通过。

- **影响文件**：`packages/arena/src/match.ts`、`packages/engine/src/ai/bottom-strategy.ts`、`packages/arena/src/__tests__/arena-e2e.test.ts`、`packages/engine/src/__tests__/ai-bottom-strategy.test.ts`

## 2026-08-02 14:12

### 竞技场：新增升级记录查看（--detail-pair）

**新增**：`--detail-pair N` 输出第 N 个对决的镜像两场升级记录后退出——同一小局序数的两场使用同一副牌，可直接对比相同牌局在两套策略下的走向。每行输出：小局序数、庄家（A/B）、策略A等级、策略B等级（均为小局开始时）、闲家得分、升级结果（只显示胜利一方；闲家上台不升级输出 x->x；庄家在 A(14) 打赢输出 x->胜出）。

**新增 5 项测试**（upgrade-log.test.ts：5 项），引擎 517 项 + arena 62 项 + CLI 34 项 = 613 项通过。

- **影响文件**：`packages/arena/src/run.ts`、`packages/arena/src/upgrade-log.ts`（新增）、`packages/arena/src/__tests__/upgrade-log.test.ts`（新增）

## 2026-08-02 13:19

### 竞技场：进度基准动态化——按当前胜率推算显著所需场数

**修改**：进度条的分母（目标场数）不再固定为 `--max-matches` 上限：
- 达到最小样本（2×pairs，默认 10000 场）前，基准固定为最小样本
- 之后若未显著，假设当前胜率维持不变，推算达到显著所需的总场数（向上取整到 `stepMatches` 的整数倍），作为新的进度基准；胜率未过半时基准取上限并注明"显著性不可达"；推算超过上限时按上限计并注明
- 基准变化时在进度行说明原因（如"目标调整: 10000 → 17000 场（按当前 p̂=0.5100 推算显著所需）"）
- ETA 同步按动态基准计算

**修复**：`requiredMatchesForSignificance` 中平局分被双重计入——先把 0.5×平局合并进分数、再整体缩放后传入 `checkSignificance`，函数内部又加一次 0.5×平局，导致推算出的 p̂ 被放大（平局越多偏差越大）。改为按原始 wins/draws 分别缩放，平局比例一致性测试兜底。

**新增 5 项测试**（significance.test.ts：5 项），引擎 517 项 + arena 57 项 + CLI 34 项 = 608 项通过。

- **影响文件**：`packages/arena/src/run.ts`、`packages/arena/src/significance.ts`、`packages/arena/src/__tests__/significance.test.ts`

## 2026-08-02 12:51

### 竞技场：每满 1000 场输出显著性结果

**修改**：进度条每满 `stepMatches` 场（默认 1000）输出显著性结果（leader、p̂、99% CI 下界、是否显著），此前仅在 ≥10000 场后输出；停止判定不变——达到最小样本（默认 10000 场）且显著才停止，未达最小样本时即使显著也标注"未达最小样本，继续"。检查点写入与显著性输出同步。默认策略 B 修正为 ai-0726（原 ai-v2 已移除）。

无新增测试，总数 603 项通过。

- **影响文件**：`packages/arena/src/run.ts`

## 2026-08-02 12:19

### 竞技场：提取 07-08 基线 ai-0707，移除 ai-v2

**新增**：
- 基线策略 **ai-0707**（ae2b76，2026-07-08）：单文件版 ai，与当前引擎直接兼容；100 场验证 0 中止、0 验牌回退，合法性测试通过（2 项）
- HandEvent 新增 `errors` 计数（引擎验牌回退次数），用于策略合法性检测

**移除**：
- **ai-v2**（ai/ 的复制副本）及其差异测试——竞技场工作流已转向提取历史基线，副本不再需要（引擎测试 523 → 517）

**新增 2 项测试**（historical-strategies.test.ts：2 项），引擎 517 项 + arena 52 项 + CLI 34 项 = 603 项通过。

- **影响文件**：`packages/engine/src/ai-0707/`、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/arena/src/types.ts`、`packages/arena/src/match.ts`、`packages/arena/src/__tests__/historical-strategies.test.ts`（新增）、`packages/arena/src/__tests__/arena-e2e.test.ts`、`packages/arena/src/__tests__/stats.test.ts`

## 2026-08-02 11:53

### 竞技场：进度条、检查点与 SIGINT 优雅退出

**新增**：
- **进度条**：每 100 场更新一行（已完赛场数、进度百分比、已用时间、预估剩余时间；显著性检查行也附带 ETA）
- **检查点**：每 1000 场（500 对决）写入 `results/checkpoint.json`（运行元数据 + 双方累计统计），任何时刻 kill 都有最近一批的完整数据；不再需要恢复功能，每次从 0 开始
- **SIGINT 优雅退出**：Ctrl+C 时先写检查点、导出部分报告（含当前胜率/99% CI/各项指标）、终止全部子进程后以 130 退出，不丢数据

**修复**：0 场（中止于起步阶段）时胜率显示 NaN → 显示 `—`；子进程注册表改为全局静态，池创建中途中断也能全部终止。

**新增 7 项测试**（progress.test.ts：7 项），引擎 523 项 + arena 50 项 + CLI 34 项 = 607 项通过。

- **影响文件**：`packages/arena/src/run.ts`、`packages/arena/src/progress.ts`、`packages/arena/src/__tests__/progress.test.ts`

## 2026-08-02 10:37

### 竞技场：提取 2026-07-26 基线策略 ai-0726 用于新旧对比

**新增**：从提交 `7382d1a`（2026-07-26，NT 记牌器时期）提取 `ai/` 策略到 `packages/engine/src/ai-0726/`（12 个 .ts 文件，与当前引擎结构兼容），经 `export * as ai0726` 暴露；竞技场新增策略名 `ai-0726`，可通过 `--strategy-a/--strategy-b ai-0726` 与当前策略镜像对决。

无新增测试（顺带修复 ai-v2-differential.test.ts 一处数组→元组的类型转换），总数 600 项通过。

- **影响文件**：`packages/engine/src/ai-0726/*`、`packages/engine/src/index.ts`、`packages/arena/src/strategies.ts`、`packages/engine/src/__tests__/ai-v2-differential.test.ts`

## 2026-08-02 09:59

### 竞技场：NT 指标改为胜率，新增抠底频率与抠底成功频率

**修改**：
- 庄家扣底成功（赢最后墩）频率 → **庄家保底频率**
- 台上/台下打NT频率 → **台上/台下打NT胜率**（无主小局中的胜率，n=胜局数、d=无主小局数；替代原先"无主占比"口径）

**新增**：
- **抠底频率**：当闲家赢最后一墩的比例（n=赢最后墩局数、d=闲家小局数）
- **抠底成功频率**：底牌有分的小局中，闲家赢最后一墩的比例（对方保底失败频率；n=底牌有分且赢最后墩、d=底牌有分小局）

**新增 2 项测试**（stats.test.ts：2 项），引擎 523 项 + arena 43 项 + CLI 34 项 = 600 项通过。

- **影响文件**：`packages/arena/src/stats.ts`、`packages/arena/src/run.ts`、`packages/arena/src/__tests__/stats.test.ts`

## 2026-08-02 00:09

### CLI：上台判定与庄家轮换统一用含抠底的闲家最终分

**问题**：`showRoundResult` 用含抠底的最终分算等级变更，但 `gameLoop` 的上台判定与庄家轮换用未含抠底的原始分（`attackerPoints >= 80`），口径不一致——闲家靠抠底把分数推过 80 时（如原始 75 + 抠底 20），展示显示"闲家上台"，实际却按庄家保级轮换。另外 `showRoundResult` 用预定的 `declarerIndex` 而非实际庄家（首局亮主者顶替时抠底归属算错）。

**修复**：提取纯函数 `computeRoundOutcome`（`packages/cli/src/round-result.ts`）作为唯一口径——上台判定 = 闲家最终分（含抠底底分×倍数）≥ 80；等级变更、庄家轮换、抠底归属全部使用它，且抠底归属改用实际庄家（`trumpDeclaration.declarerIndex`）。

**新增 8 项测试**（round-result.test.ts：8 项），CLI 34 项 + 引擎 523 项 + arena 41 项 = 598 项通过。

- **影响文件**：`packages/cli/src/index.ts`、`packages/cli/src/round-result.ts`、`packages/cli/src/__tests__/round-result.test.ts`

## 2026-08-01 23:46

### 策略竞技场：镜像对决、必打 K/A、统计显著性判定

**新增**：
- 新包 `@poker/arena`（`npm run arena -w packages/arena`）：两套策略在完整对局（2→A）中镜像对决——每对决两场对局（A 坐 0/2 号位一场 + 反转一场），两场第 i 小局共享同一副牌（`seededShuffle(deck, hashMix(seed, pair, handIndex))`，P0 两场拿到相同的 25 张）
- 必打 K/A 升级规则：庄家打赢升级量 N——原级<13 → min(原级+N, 13)；原级=13 → 升到 14；原级=14 → 该方胜出；闲家上台（等级 N≤K、升级量 M）→ min(N+M, K)，K 必须台上打赢才能到 A；竞技场自身的对局循环统一用含抠底的闲家最终分做上台判定与升级（CLI 的对应修复见 2026-08-02 条目）
- 显著性判定：p̂ = (胜 + 0.5×平)/n（平局 = 单场 200 小局上限），99% Wilson 区间下界 > 0.5 即显著；默认至少 10000 场，之后每 +1000 场检查，上限 100000 场
- 17+ 项技术指标（每项带分子/分母）：台上/台下胜率与各等级胜率、有主胜率、NT 胜率、平均失分、扣底平均分数（底牌分数）、扣绝一门频率、每墩胜率、领出统计等（NT 胜率与抠底频率口径的调整见 2026-08-02 09:59 条目）
- 引擎新增 `mulberry32`/`seededShuffle`（确定性洗牌）；`ai/` 复制为 `ai-v2/`（策略 B 载体，差异测试保证逐字节一致）；并行用子进程（tsx loader 在 Node 17.5 的 worker_threads 下不可靠）

**新增 53 项测试**（seeded-shuffle.test.ts：6 项；ai-v2-differential.test.ts：6 项；arena 六文件：41 项），引擎 523 项 + arena 41 项 + CLI 26 项 = 590 项通过。

- **影响文件**：`packages/arena/`（package.json、tsconfig.json、vitest.config.ts、src/*、src/__tests__/*）、`packages/engine/src/model.ts`、`packages/engine/src/index.ts`、`packages/engine/src/ai-v2/*`、`packages/engine/src/__tests__/seeded-shuffle.test.ts`、`packages/engine/src/__tests__/ai-v2-differential.test.ts`、根 `package.json`、`.gitignore`

## 2026-08-01 12:53

### 记牌器：自我亮主后剩余常主消失，亮主牌在他人视角丢失

**问题**：无主模式下，AI-2 亮单张 ♦5 后，AI-2 自己的记牌器里第二张 ♦5 从所有其他玩家/底牌的可能列表消失（「AI-2视角少一张方块5」）；AI-3（手中持有另一张 ♦5）的视角里 AI-2 完全没有方块5（「AI-3视角下AI-2没有方块5」）。同样地，玩家1 用对大王亮无主后，其他视角的可能列表里也看不到这两张确定的大王。

**修复**：
- 自我亮主分支：亮主牌已在 `initTracking` 中通过 `myCount` 排除（就在自己手牌里），`totalUnseen` 与底牌计数改为只减 `needed`（未在手牌中确认的部分），避免双重扣除
- 可能列表重加确定牌（亮主牌）时不再要求 `totalUnseen > 0`：计数已被 cap 钳制到 `totalUnseen`，全部副本已定位（如自己持有另一张）时确定牌必须无条件重加，否则亮主牌从该视角消失

**新增 3 项测试**（ai-nt-tracking.test.ts：3 项），CLI 26 项 + 引擎 511 项 = 537 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`、`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-08-01 00:22

### 记牌器：已打出的亮主牌不再残留为幽灵常主

**问题**：庄家亮主后，`applyReveals` 的 self 分支每次都会把亮主牌补回 `knownTrumpsPerPlayer`（用当前手牌算 `alreadyKnown`）。亮主牌一旦打出，手牌中已没有它，`needed > 0` 触发补牌，已打出的牌被重新加回「手牌常主」。例如玩家1 用对大王亮无主，第 1 墩打出对大王后，第 3 墩自己的记牌器仍显示「手牌常主: ♥2 ♥2 JOKER JOKER」。

**修复**：牌张打出时从 `knownTrumpsPerPlayer` 中移除（removal 阶段）。对自己只移除超出当前手牌持有数量的部分——手牌常主每次调用由 `myTrumpCards` 重建，自然消失，无需移除；被补回的已打出亮主牌（幽灵）才是移除对象。`definitiveCount` 吸收逻辑不变，`totalUnseen` 不因幽灵移除而重复扣除。

**新增 2 项测试**（ai-nt-tracking.test.ts：2 项），CLI 26 项 + 引擎 508 项 = 534 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`、`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-30 22:14

### CLI：修复首局等级指定不生效

**问题**：CLI 调试模式下输入「5NT」等首局等级，`targetLevel` 解析正确但 `gameLoop` 中 `levelAC`/`levelBD` 始终初始化为固定值 2，未使用解析结果。

**修复**：`levelAC`/`levelBD` 初始化改为 `targetLevel ?? currentLevel`。提取 `parseLevelSuit` 为独立函数。

**新增 12 项测试**（parse-level.test.ts：12 项），CLI 26 项 + 引擎 506 项 = 532 项通过。

- **影响文件**：`packages/cli/src/index.ts`、`packages/cli/src/parse-level.ts`（新增）、`packages/cli/src/__tests__/parse-level.test.ts`（新增）

## 2026-07-30 19:50

### 第四家队友大：统一牌张选择，垫主牌加对子保护和 A 阈值

**问题**：垫主牌仅按 effRank 从小到大选，没有对子保护（可能拆对）、没有 A 阈值（可能垫大主牌）、没有副牌+主牌混合出牌逻辑。

**修复**：
- 新增 `sortTrumpsForDiscard`：A 以下单牌优先 → A 以上单牌 → 对子牌（不拆对）。只有必须垫 A 以上时才允许拆对
- 新增 `selectCardsForTeammateWin`：按「副10>副K>副5>主10>主K>主5>副非分>主非分」统一排序出牌，支持副牌+主牌混合。闲家跨 40 分台阶时主10/K 可越过副5
- 毙牌 filler 加对子保护：分牌 filler 仅闲家跨台阶时拆对，非分 filler 永不拆对（有 fallback）
- 理由判断：全主+牌型匹配+盖过队友才是盖毙，否则垫牌/垫主牌

**新增 7 项测试**（ai-follow.test.ts：7 项），总数 520 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-29 21:48

### 第四家队友大时不毙牌，全主时垫主牌；盖毙统一用 beat_points 标注

**问题**：第四家缺门时，即使队友已大（`tmWin=true`），仍走 `trumpKill` 毙牌，浪费主牌。

**修复**：
- `index.ts` 缺门路径：第四家 + 队友大时，仅当分牌能盖过（加分优先）或最小主牌能盖过（免费超毙）才毙牌，否则 `垫主牌`。垫主牌时若手牌有分，标注 `（队友已大，加分）`
- `killReason`：盖毙统一用 `beat_points` 意图（`用分牌盖`/`用最小牌盖`），`用主牌毙` 才按 tmWin 区分

**新增 4 项测试**（ai-follow.test.ts：4 项），总数 513 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-29 21:22

### 毙牌路径接入 annotateReason，毙牌含分标注「用分牌盖」，无分标注「用最小牌盖」

**问题**：毙牌（`trumpKill`/`trumpKillSingle`）所有返回路径直接使用裸字符串（`'用主牌毙'`、`'盖毙'`），不经过 `annotateReason`。毙牌缺乏牌张选择策略的标注。此外，`followTrumpLead` 第二家留牌、无主垫牌等 3 处路径同样绕过 `annotateReason`。

**修复**：
- `trumpKillSingle`：新增 `leadCombo` 参数，毙牌/盖毙经 `killReason` 走 `annotateReason`——`tmWin` 时 `intent='add'`（队友已大），否则 `intent='beat_points'`（自己盖过）
- `trumpKill`：多牌毙牌同样经 `killReason` 走 `annotateReason`
- `followTrumpLead` 第二家留牌、无主垫牌 → `annotateReason(intent='none')`
- `followNTTrumpLead` 无主垫牌 → `annotateReason(intent='none')`

**新增 9 项测试**（ai-follow.test.ts：9 项），**更新 16 项已有测试期望**。总数 509 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-28 23:48

### 修复第四家出牌理由「同花色出大」却标注「盖不过」的矛盾

**问题**：第四家跟主牌对子时，`shouldAvoid` 无条件为真（`position === 'fourth' && !tmWin`），即使玩家的对子能盖过当前赢家。导致出牌理由是「同花色出大（盖不过，不加分）」——逻辑矛盾。同样问题存在于副牌对子跟牌。

**修复**：将 `shouldAvoid` 计算移到 `beating` 确定之后，第四家条件增加 `&& !beating`——能盖过就不应是 avoid 模式。

**新增 3 项测试**（ai-follow.test.ts：3 项），总数 500 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`packages/engine/src/ai/follow-offsuit.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-26 19:25

### NT 记牌器：修复 totalUnseen 扣减逻辑，definitive 副本不再错误扣减 unseen 池

**问题**：card removal 中直接 `totalUnseen -= playedCount`，未考虑打出的是已知副本（reveal 确定的牌、手牌）。例如 P0 打出手牌中的 D-2（已知在自己手中，不在 unseen 池），却扣减了 `totalUnseen`，导致其他玩家对该牌的可能性被错误清零。

**修复**：
- card removal 扣减 `totalUnseen` 时，先用 `definitiveCount`（`knownTrumpsPerPlayer` 中该玩家的确定副本数）吸收打出量，仅超出部分才从 unseen 池扣除
- self-reveal 的牌记录到 `knownTrumpsPerPlayer[myIndex]`，避免 self 出牌时 `definitiveCount=0`
- `buildState` 添加 definite copies 时排除 void 玩家（`totalPossible(counts, p) === 0`）
- 适配 4 个测试断言（`all 12 trumps`、`full scenario` P3 视角、`trick 2` P0/P1/P3 视角的 sumPossible 和 has 断言）

**测试**：497 项全部通过（save-file 场景 P1 有大王断言通过）。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`、`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-26 17:33

### NT 记牌器：从虚拟副本 ID 改为计数追踪，修复 pairDeduction 副本不一致 bug

**问题**：旧实现用 virtual copy ID（如 `J-16-0`、`J-16-1`）追踪每张常主可能的位置。`applyNoPairDeduction` 从 `cids[length-1]`（最后副本）删除玩家，但 card removal Pass 2 遍历 `possibleLocations.keys()` 删除第一个匹配。两处操作不同的 virtual copy，导致 player coverage 丢失——玩家从全部同 suit-rank 副本中被抹去。

**修复**：将 `possibleTrumps` 从 `(readonly string[] | null)[]` 改为 `(Readonly<Record<string, number>> | null)[]`，每个 (suitRank, location) 记录最大可能张数而非具体副本。无对推断规则：count=2 → 1；count=1 且已出该花色 → 0。底牌不受无对规则影响。

**影响文件**：
- `packages/engine/src/ai/types.ts`：`possibleTrumps` 类型变更
- `packages/engine/src/ai/nt-tracking.ts`：核心重写（~350 行增量）
- `packages/engine/src/__tests__/ai-nt-tracking.test.ts`：全部断言适配新格式
- `packages/engine/src/__tests__/ai-follow.test.ts`：mock 适配
- `packages/cli/src/index.ts`：显示逻辑适配

**测试**：497 项通过，2 项待修正（`full scenario` 和 `trick 2` 断言需适配新规则）。

## 2026-07-26 00:53

### NT 记牌器：新增对局复现测试，确认 pairDeduction 与 card removal 副本不一致 bug

**问题**：`applyNoPairDeduction` 从 `cids[length-1]`（最后副本）删除玩家，但 Phase 2 card removal 的 Pass 2 遍历 `possibleLocations.keys()` 删除第一个匹配。两处操作不同的 virtual copy，导致 player coverage 丢失——玩家从全部同 suit-rank 副本中被抹去。

复现场景（保存文件 `shengji-2026-07-25T11-17-04-042Z.json`）：5 墩 NT 对局，AI-3 和 AI-4 视角下 AI-2 丢失大王。

**新增 1 项测试**（ai-nt-tracking.test.ts：保存文件完整场景），待修复。

- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-25 16:50

### 加分拆对策略：攻击方跨台阶才拆对，庄家永不拆对

**问题**：加分时无差别选分牌，不会考虑拆对代价。例如闲家 D-10 对子 + D-5 单张，只需垫 1 张时，若当前分差不足以跨过 40 分台阶，不应拆对出 D-10。

**修复**：
- 新增 `shouldAvoidBreakingPair(card, hand, ctx)`：检查拆对条件——庄家永不拆对、闲家仅当拆对后能跨 40 分台阶才拆
- 新增 `visibleTrickPoints(ctx)`：从 bestSoFar 统计已可见的墩分
- `discardSort` 和 `fillerSort` 新增 `hand`、`ctx`、`needed` 可选参数：仅当 `needed < 2`（必须拆对才够填）时触发拆对惩罚

**新增 3 项测试**（ai-follow.test.ts：fill-1 闲家 55 分不拆对 + 闲家 60 分拆对 + fill-2 不拆对直接出对），496 项通过。

- **影响文件**：`packages/engine/src/ai/utils.ts`、`follow-trump.ts`、`follow-offsuit.ts`、`helpers.ts`、`index.ts`、`__tests__/ai-follow.test.ts`

## 2026-07-25 16:20

### 修复加分时分牌排序优先级：10 > K > 5

**问题**：`discardSort` 和 `fillerSort` 在加分模式下，分牌之间用 rank 降序排列（K > 10 > 5）。但正确优先级应为 10 > K > 5：
- 10（10分，rank=10）：分大牌小，优先垫出
- K（10分，rank=13）：分大牌大，保留后续墩用
- 5（5分）：分少，最后垫出

**修复**：新增 `pointDumpPriority` 函数（10→0, K→1, 5→2），`discardSort` 和 `fillerSort` 均使用该函数替代简单 rank 降序。

**新增 3 项测试**（ai-follow.test.ts：AAKQQ 甩牌填写 fill-1/fill-2/fill-3），493 项通过。

- **影响文件**：`packages/engine/src/ai/utils.ts`、`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-25 15:40

### 修复 4 处 canAddPoints 加分标注缺失

**问题**：全面审计 `canAddPoints` 调用点，发现 4 处 intent 只在 avoid/none 之间选择，不调用 `canAddPoints`：

1. `_aiFollowPlay` 短牌分支（同花色不够）
2. `padWithDiscards`（主牌不够垫副牌）
3. `followOffSuitThrow` 部分短牌路径
4. `fillerSort` 加分模式下分牌之间未降序排列（选 D-5 而非 D-10）

**修复**：
- 前三处 `intent = shouldAvoid ? 'avoid' : 'none'` 改为 `intent = shouldAvoid ? 'avoid' : (addPoints ? 'add' : 'none')`
- `fillerSort` 加分模式下同分牌降序排列（大分优先），与 `discardSort` 对齐

**新增 3 项测试**（ai-follow.test.ts：AAKK 短牌加分标注 + 大王对主牌不够 + AAKQ 甩牌部分短牌），490 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`、`helpers.ts`、`follow-offsuit.ts`、`utils.ts`、`__tests__/ai-follow.test.ts`

## 2026-07-25 14:16

### 实现 3 项缺失的 AI 策略

**问题**：策略记忆文档 `strategy-rules.md` 列出 9 项未实现策略，经逐项审查确认 3 项真实缺失。

**修复**：

1. **NT 第二家抢牌权**：`followNTTrumpLead` 单张能盖过分支持新增第二家检测——有拖拉机抢最大、有甩牌抢≥A、否则出小。与花色主 `followTrumpLead` 行为对齐。

2. **攻击方拆对跨 40 分台阶**：新增 `attackerNearThreshold(ctx)` 辅助函数，攻击方当前分差 ≤10 分时覆盖 `shouldAvoid`。所有 shouldAvoid 计算位置（index.ts、follow-trump.ts、follow-offsuit.ts、helpers.ts 共 7 处）统一覆盖，`followOffSuitSingle` 盖不过路径同步覆盖选牌排序。

3. **庄家方避 80 分门槛**：`canAddPoints` 新增守卫——庄家方且 `attackerPoints ∈ [75,80)` 时返回 false，宁垫主也不送对手上台。

**新增 8 项测试**（ai-follow.test.ts：NT 第二家×3 + 跨台阶×1 + 避80×1，ai-leading.test.ts：最后手牌×3），487 项通过。

- **影响文件**：`packages/engine/src/ai/follow-trump.ts`、`follow-offsuit.ts`、`helpers.ts`、`index.ts`、`__tests__/ai-follow.test.ts`、`__tests__/ai-leading.test.ts`

## 2026-07-25 11:10

### 修复 86 项 TypeScript 编译错误（0→0）

**问题**：`tsc --noEmit` 有 92 项错误（4 源文件 + 88 测试文件），长期未修复。

**修复**：
- `follow-trump.ts`：`hasPoints` 类型 `boolean | null` → `|| false` 收敛
- `helpers.ts`：`rev.cards` 在 `Reveal` 类型上不存在 → 移除死代码段
- `game/index.ts`：`nextState` 不在 `PlayResult` 中 → `state: nextState`
- `model/serialize.ts`：缺少 `throwPenalties` 字段 → 补 `[0, 0]`
- `ai/index.ts`：`aiFollowPlay`/`_aiFollowPlay` 的 `leadSuit` 类型 `CardSuit` → `CardSuit | null`（与调用点一致）
- 测试文件：77 处字符串字面量 `'S'/'H'` → `Suit.Spades` 枚举，重复 import 移除，`as const` 类型转换修复

`tsc --noEmit` 零错误，479 项测试通过。

- **影响文件**：`packages/engine/src/ai/index.ts`、`follow-trump.ts`、`helpers.ts`、`game/index.ts`、`model/serialize.ts`、`ai-follow.test.ts`、`ai-nt-tracking.test.ts`、`throw-penalty.test.ts`

## 2026-07-25 10:48

### 重构 AI 模块：拆分 index.ts 为 5 个子模块

**问题**：`ai/index.ts` 共 1800 行、40+ 函数，包含领牌、跟牌、毙牌、垫牌、出牌理由、共享辅助等全部职责，难以维护。

**修复**：按职责拆分为 5 个子模块，`index.ts` 精简至 305 行（顶层编排 + 公共 API）。
- `lead.ts`（371 行）：领牌策略（10 个函数，自包含子树）
- `follow-trump.ts`（583 行）：跟主牌 + 毙牌 + 无主跟牌（7 个函数）
- `follow-offsuit.ts`（316 行）：跟副牌 + 垫牌 + 甩牌（5 个函数）
- `helpers.ts`（213 行）：共享策略判断（8 个函数）
- `reason.ts`（72 行）：出牌理由注解（2 个函数，纯展示层）

无循环依赖，向后兼容。

- **影响文件**：`packages/engine/src/ai/`

## 2026-07-25 00:07

### 修正 ai-nt-tracking.test.ts 中 P4 引用为 P0-P3 内部编号

**问题**：测试用例中存在 `P4` 引用（外部编号），与代码中的 `P0-P3` 内部编号不一致。

**修复**：将含 `P4` 的测试用例统一转换为 P0-P3 内部编号：P1→P0、P2→P1、P3→P2、P4→P3。同时修正两处注释中 P3→P2 编号错误（1161行 `P3(AI-3)` → `P2(AI-3)`、1191行 `P3 has no ♥2` → `P2(AI-3) has no ♥2`），对应变量同步更新。涉及 5 处，479 项测试通过。

- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-24 23:28

### 记牌器输出使用玩家名称替代 P1-P4

**问题**：记牌器中所有标签使用内部编号 `P1-P4`，与用户视角的"玩家1-4"不一致。`/hand` 和 `/tracker` 接受 0-3 也与直觉不符。

**修复**：
1. 新增 `playerLabel()` 函数，非 AI 显示"玩家n"，AI 显示"AI-n"
2. 记牌器所有 P1-P4 标签替换为 `playerLabel(p)`
3. 新增 `playerNum()` 将 1-4 转换为 0-3，`/hand` 和 `/tracker` 调用时自动转换

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-24 23:18

### 新增 NT 记牌器第二墩测试：毙副牌后常主分布

**新增测试**：在首墩 SJ 对之后，第二墩 P3 领出 ♠A（副牌），P0 用 ♦2 毙牌，P1 垫副牌，P2 跟副牌。验证毙牌后各视角常主分布。

Trick 2 后关键变化：♦2 总数减 1（P0 打出），P1/P3 视角中 P0 的 ♦2 从 2 张降为 1 张（只能形成 S-2 对，不能形成 D-2 对）。P0 视角 P2 的 S-2+H-2 不变。P2（庄家）视角 P0 只有 S-2+C-2（H-2、D-2 已排除）。

**新增 1 项测试**（ai-nt-tracking.test.ts：50 项），479 项通过。

- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-24 22:44

### 修复 NT 记牌器两项 bug：当前墩自出牌误删副本 + 对子推断顺序错误

**问题**：
1. 当前墩自己出常主时，Phase 2 按 suitRank 匹配会找到并删除代表另一玩家手中同名副本的 virtual copy，导致记牌器少算一张。自己手牌已在 Phase 1 排除，virtual copy 代表的是别处的牌。
2. 对子推断（`applyNoPairDeduction`）在卡牌移除**之后**执行。玩家领出对子、某玩家跟单张时，该玩家每种 rank 应最多持有 1 张，再扣掉打出的一张后归零。但旧顺序先扣牌再推断，导致打出 ♣2 后仍显示可能持有 ♣2。

**修复**：
1. 当前墩通过 `isCurrentTrick` 判断，skip self 的全部移除（Pass 1 + Pass 2）。已完成的历史墩不受影响。
2. 对子推断移到卡牌移除之前执行。先限每种 rank 至多 1 张，再减去打出部分，正确推出归零。

**综合场景测试**：4 视角（P0 亮主者、P1 void、P2 庄家、P3 void）× 每视角逐牌验证 6 种 suit-rank × 非void玩家 + 底牌。P1/P3 视角验证 P0 对子推断：S-2×2→有对、D-2×2→有对、H-2×1→无对、C-2×1→无对。P2 无对（pair dedup）。底牌不受对子推断影响（S×2,D×2,H×1,C×1）。44 长度断言 + 22 计数断言。478 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-22 23:30

### 修复第三家对手赢墩时缺少"不加分"标注

**问题**：`shouldAvoid` 逻辑只覆盖了第二家（且领出为最大牌型）和第四家（对手赢墩），遗漏了第三家。第三家盖不过时，如果对手已经赢墩，即使随不出牌型也应避分。

**修复**：所有 `shouldAvoid` 位置增加 `position === 'third' && !tmWin` 条件。涉及 `followOffSuit`（短门）、`followOffSuitMulti`（多张 fallback）、`followTrumpLead`、`followNTTrumpLead`、`matchTrumpPattern`、`padWithDiscards` 等共 11 处。

**新增 1 项测试**（ai-follow.test.ts：104 项），476 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-22 00:33

### 新增回归测试：确认 NT 主对跟牌 filler 不会误垫 joker

**问题**：用户反馈修复垫大王后仍出现垫小王。经分析，`matchTrumpPattern` 对子 fallback 的 filler 排序在前次修复中已改为 `getEffectiveRank` 升序（joker 900 > level 800），逻辑正确。测试以精确场景（NT 模式，第四家，领出 ♣2♣2 对，手牌 joker+♠2+♦2+♥2 无对子）还原，确认 joker 不会被选中。

**新增 1 项测试**（ai-follow.test.ts：103 项），475 项通过。

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-22 00:13

### 修复纯拖拉机被甩牌策略抢先标注为"甩牌"

**问题**：`_aiLeadPlay` 中甩牌策略（Strategy 4）排在拖拉机策略（Strategy 3）之前。当手牌是纯拖拉机（如 ♠J♠J♠10♠10）时，甩牌检测器也判定它能甩，直接返回 `甩♠副牌(4张)`，拖拉机策略没机会执行。

**修复**：`tryLeadThrowOffSuit` 返回前检查 `classify`——如果甩牌组合是纯拖拉机（无多余单牌/对子），改用拖拉机标签。

**新增 1 项测试**（ai-leading.test.ts），474 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-leading.test.ts`

## 2026-07-21 23:44

### 修复 NT 记牌器未反映当前墩已出牌

**问题**：`computeNTTrumpState` 只处理 `trickHistory`（已完成的墩），不包含当前墩已打出的牌。导致 `buildAIContext` 和 `/tracker` 显示的记牌器信息滞后一整墩。例如 AI-3 打出 ♥2 后，记牌器仍认为 ♥2 可能在 AI-3 或其他玩家手中。

**修复**：
1. `computeNTTrumpState` 新增可选参数 `currentTrickPlays` 和 `currentLeadPlayerIndex`，在 Phase 2.5 中处理当前墩已出的牌：移除已打出的主牌、对垫牌者应用 void 扣减
2. `buildAIContext` 传递 `state.trickPlays` 和 `state.leadPlayerIndex`

**新增 4 项测试**（ai-nt-tracking.test.ts），471 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/ai/context.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-21 22:57

### 修复抠底时底牌分数未计入升级计算

**问题**：`showRoundResult()` 手动计算并显示底牌分数，但从未在调用 `computeLevelChange` 前将其加到闲家得分中。导致闲家抠底成功却不加分，应该上台却判定为保级。同时底牌倍数硬编码为 `×2`，未使用 `bottomMultiplier` 根据最后一墩领出牌型计算正确倍数。

**修复**：
1. CLI 导入 `bottomMultiplier`、`countBottomPoints`、`finalizeAttackerPoints`
2. `showRoundResult()` 中取最后一墩领出牌型计算正确倍数，判断闲家是否赢得最后一墩决定是否抠底加分
3. 用加分后的终分调用 `computeLevelChange`

**新增 1 项测试**（scoring.test.ts），467 项通过。

- **影响文件**：`packages/cli/src/index.ts`
- **影响文件**：`packages/engine/src/__tests__/scoring.test.ts`

## 2026-07-21 22:31

### 修复 matchTrumpPattern 和 padWithDiscards 缺失避分/垫牌逻辑

**问题**：
1. `matchTrumpPattern` 对子领出的 fallback（无对子匹配时）只用 `getEffectiveRank` 升序取最小主牌，不检查 `shouldAvoid`；且用 `canBeat` 判断理由，两单牌盖不过对子却可能误判为“出大”。后续 fillers 排序用了 `discardSort`，该函数设计给副牌垫牌用——避分时优先非级牌，导致主牌中大王排在级牌前被浪费。
2. `padWithDiscards` 硬编码返回 `'主牌不够，垫副牌'`，不走 `annotateReason`，导致第四家避分时缺失“不加分”标注。

**修复**：
1. `matchTrumpPattern` pair 路径：增加 `shouldAvoid`/`addPt` 判断；fillers 用 `getEffectiveRank` 升序始终出最小主牌；检查 `formsPair` 判断是否匹配牌型，不匹配则理由为“垫同花色”。
2. `padWithDiscards`：增加 `position`、`leadCombo` 参数，用 `annotateReason` 标注意图。

**新增 2 项测试**（ai-follow.test.ts：102 项），466 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-21 21:50

### 修复 fast path 用 canBeat 判断理由导致"同花色出大"误报

**问题**：`canBeat` 只比较 max effectiveRank，不检查牌型是否匹配。领出对子、手牌只有两张单牌时，即使单牌 rank 更高也无法盖过对子，但 `canBeat(11 > 5) = true` 误判为"同花色出大"。

**修复**：fast path 改用 `matchPattern` 先检查手牌是否匹配领出牌型。不匹配则理由为"垫同花色"，匹配才用 `compareTwo` 进行牌型感知的 rank 比较。同样修复了主牌跟牌 fast path。

**新增 1 项测试**（ai-follow.test.ts：100 项），464 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-21 00:43

### 修复 NT 记牌器所有卡牌追踪信息错误（ID 不匹配）

**问题**：`enumerateNTTrumpIds` 用 `cardId(suit, rank, 0)` 和 `cardId(suit, rank, 1)` 生成追踪 key（如 `J-16-0`、`S-2-1`），但 `createFullDeck()` 用连续递增 idx 创建实牌（小丑 idx=52,106，大丑 idx=53,107）。Phase 1（排除手牌）和 Phase 2（移除已出牌）的 `possibleLocations.has(id)` / `delete(id)` 全部失败，导致记牌器信息全部错误：自己的手牌显示为可能常主、已打出的牌未移除。

**修复**：用 suitRank key 替代全 ID 进行匹配。新增 `countBySuitRank` 辅助函数。Phase 1 和 Phase 2 都采用两步移除：先精确 ID 匹配（兼容测试），再按 suitRank key 移除剩余未知副本。`buildState` 移除不再需要的 `myHandIds`/`bottomIds` 参数。

463 项测试通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-21 00:01

### 优化记牌器可能常主显示：牌面格式替换原始 ID

**问题**：记牌器中 `可能常主` 显示原始 ID 格式（如 `S-2`、`C-14`、`J-16`），不够直观。

**修复**：新增 `possibleTrumpLabel` 函数，将 `S-2` 转换为 `♠2`、`J-16` 转换为 `JOKER`，与手牌显示风格一致（不带序号）。不影响测试。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-20 23:22

### 修复 NT 吊主导致程序崩溃（`shouldAvoid` 未定义）

**问题**：`followNTTrumpLead` 单张盖不过分支使用了 `shouldAvoid` 变量但从未声明，导致 `ReferenceError` 崩溃。该变量在 `followTrumpLead` 中有声明，但 NT 分支遗漏。

**修复**：在 `followNTTrumpLead` 的盖不过分支前添加 `shouldAvoid` 声明，逻辑与 `followTrumpLead` 一致。

**新增 1 项测试**（ai-follow.test.ts：99 项），463 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-20 22:58

### 扩展"唯一可出"检测：单张领出、手牌仅有一对

**问题**：单张领出时，手牌同花色只有一对（两张同点），两块牌完全等价，选哪张都一样，应判为唯一可出。此前 Rule 2（含单张即返回 false）直接跳过。

**修复**：
1. `isOnlyLegalPlay` 新增 Rule 1.5：当 `leadLen === 1` 且手牌同花色恰好一对时返回 true
2. `followTrumpLead` 单张路径传递 `myTrump` 替代 `[]` 给 `annotateReason`，使主牌唯一可出检测生效
3. `followOffSuitSingle` fallback 路径改为走 `annotateReason`，使副牌唯一可出检测生效

**新增 6 项测试**（following.test.ts：64 项，ai-follow.test.ts：98 项），462 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`
- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-20 22:44

### 修复主牌跟牌 fast path 未标注"唯一可出"

**问题**：`followTrumpLead` fast path 正确调用 `isOnlyLegalPlay` 判断唯一可出，但传给 `annotateReason` 的 `leadSuitCards` 是空数组 `[]`。`annotateReason` 内部重新检查 `isOnlyLegalPlay` 时因空数组直接返回 false，导致主牌唯一可出时缺失标注。

**修复**：fast path 传递 `myTrump` 作为 `leadSuitCards`，使 `annotateReason` 的主牌唯一可出检测正常生效。

**新增 1 项测试**（ai-follow.test.ts：96 项），456 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-20 22:23

### 修复 discardSort 加分模式下降序排列误垫大牌

**问题**：`discardSort(tmWin=true)` 对所有卡牌统一降序排列。初衷是加分时优先出 K/10（大分）而非 5（小分），但副作用是非分牌也降序，导致 ♥A 被优先垫掉而非保留到后续墩次。

**修复**：降序仅对分牌生效（`isPointRank(a) && isPointRank(b)`），非分牌始终升序（优先出小，保留大牌）。

**新增 2 项测试**（ai-follow.test.ts：95 项），455 项通过。

- **影响文件**：`packages/engine/src/ai/utils.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
- **影响文件**：`CLAUDE.md`

## 2026-07-19 16:44

### 扩展 canAddPoints/isMaxPattern 支持主牌最大牌型判断

**问题**：`canAddPoints` 和 `isMaxPattern` 仅通过 `isBigOffSuitCard` 判断副牌最大牌型，对主牌（大王/小王对）无效。同时 `followTrumpLead` 和 `followNTTrumpLead` 盖不过分支未调用 `canAddPoints`，第三家无法标注加分。

**修复**：

1. 新增 `isTrumpMax`：大王单张/对子始终为最大牌型；小王对在我方有大王时为最大牌型
2. 新增 `sideHasBigJoker`：NT 模式用记牌器判断，花色模式通过历史出牌和亮主记录推断
3. `canAddPoints` 和 `isMaxPattern` 中先判断领出是否为主牌，是则调用 `isTrumpMax`
4. `followTrumpLead` 和 `followNTTrumpLead` 盖不过分支增加 `canAddPoints`，可加分时用 `discardSort(true)` 选分牌

**新增 3 项测试**（ai-follow.test.ts：93 项），453 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 15:53

### 修复 discardNonTrump 第三家加分判断 + followOffSuitThrow 缺门加分

**问题 1**：`discardNonTrump` 的 intent 仅判断 `position === 'fourth'`，第三家即使 `canAddPoints` 成立也得不到加分标注。

**问题 2**：`followOffSuitThrow` 缺门路径直接调 `trumpKill`，没有检查队友已大+可加分。

**修复**：
1. `discardNonTrump` 改为调用 `canAddPoints(tmWin, position, combo, ctx)` 判断 intent
2. `followOffSuitThrow` 缺门路径增加 `tmWin && canAddPoints` 检查，队友已大时优先垫分
3. 所有 `discardNonTrump` 调用方传入 `leadCombo`
4. 两处加分路径增加 `nonTrump.length >= leadLen` 守卫

**新增 1 项测试**（ai-follow.test.ts：90 项），450 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 13:41

### 移动 isOnlyLegalPlay 测试从 ai-follow 到 following

`isOnlyLegalPlay` 已移至 following 模块，相关测试也应跟随。5 项测试从 `ai-follow.test.ts`（89 项）移到 `following.test.ts`（58 项），改为直接调用 `isOnlyLegalPlay()`。

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-19 13:33

### following.test.ts 增加唯一可出测试（DA+HA+KK + 10109988 主牌领出）

6 pairs + 2 singles → 唯一可出；多加一对大王 → 不唯一。449 项通过。

- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-19 13:18

### 移动 isOnlyLegalPlay 到 following 模块，AI 增加唯一可出快速路径

`isOnlyLegalPlay` 是跟牌规则而非 AI 策略，移至 `following/index.ts` 并导出。签名简化为 `(leadSuitCards, leadLen, leadCombo, config)`，移除未使用的参数。

AI 策略在 `_aiFollowPlay` 和 `followTrumpLead` 中先调用该判断：若同花色张数等于领出张数且唯一可出，直接打出排序后的强制牌，跳过策略逻辑。447 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`
- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-19 12:57

### 简化标注文字：尽量加分→加分，尽量不加分→不加分

尽量少加分保持不变。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 12:38

### 甩牌跟牌理由统一为垫同花色

**问题**：领出是甩牌时，跟牌理由用了"同花色出大/出小"，不符合甩牌语义——甩牌是多牌型混合，跟出方匹配牌型即可，无所谓盖过。

**修复**：`matchTrumpPattern` 和 `followOffSuitMulti` 中检测 `leadCombo.type === 'throw'`，甩牌跟牌理由统一用"垫同花色"（纯拖拉机仍用出大/出小）。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 12:29

### 拖拉机跟牌增加加分/避分排序

**问题**：`tryMatchTractorSlots` 始终选最小拖拉机填充，不考虑加分/避分策略。第三家队友已大时应优先含分牌，第四家应避免含分牌。

**修复**：`tryMatchTractorSlots` 新增 `pointsStrategy` 参数（'add' | 'avoid'）。add 时含分拖拉机优先，avoid 时含分拖拉机置后。`matchTrumpPattern` 和 `followOffSuitMulti` 两个调用方在选取前计算策略并传入。`trumpKill` 不改（有自己的抢分逻辑）。

**新增 2 项测试**（ai-follow.test.ts：94 项），447 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 11:59

### 修复 checkTractorOrThrowFollow：大拖拉机可满足小拖拉机要求

**问题**：级牌跳跃导致 detectTractors 合并拖拉机时（如 level=6 时 88775544 合并为 4 对拖拉机），validateFollow 的 `checkTractorOrThrowFollow` 要求每个拖拉机对数精确匹配，拒绝大拖拉机满足小要求的合法跟牌。

**修复**：替换精确匹配为贪心分配——一个 N 对的拖拉机可满足 ≤N 对的要求，剩余对数计入 fill。例如 [4] 可满足 [2, 2]（分别分配 2+2），[5] 可满足 [3, 2]（分配 3+2，剩余 0）。

**新增 2 项测试**（ai-follow.test.ts：92 项）+ **6 项 validation 测试**（following.test.ts：53 项），445 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-19 01:34

### 重写 isOnlyLegalPlay 唯一可出判断

**问题**：旧逻辑依赖 `tryMatchTractorSlots` 精确定位唯一匹配，对含单牌的甩牌判断过于宽松，拖拉机分支无法正确区分多选情况。

**新规则**：

1. 手牌同花色张数 = 领出张数 → 唯一可出（全强制）
2. 领出含有单牌 → 不唯一（单牌可自由选）
3. 领出仅含对/拖拉机：
   - 领出/手牌无拖拉机 → 比较总对数
   - 双方均有拖拉机 → 调用 `computeIdealFollow`，滤掉不足长度的对/拖拉机后比较总对数

**新增 `computeIdealFollow` import**：从 `following/index.ts` 复用已有函数。

**新增 5 项测试**（ai-follow.test.ts：90 项），437 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-18 17:29

### 统一跟牌理由，消除硬编码标注和死代码

**问题**：多个跟牌分支绕过 `annotateReason` 直接硬编码标注，导致理由不一致。

**修复**：

1. `discardNonTrump`：`垫牌（队友已大，尽量加分）` 和 `垫牌(含主牌)` 改为走 `annotateReason('垫牌', ...)`
2. `followTrumpThrow`：`垫主牌` 改为 `同花色出小`（跟主牌就是跟同花色）+ `annotateReason` 标注
3. `padWithDiscards`：`主牌不足，补垫牌` 与 `主牌不够，垫副牌` 统一为后者
4. 删除 `followTrumpThrow` 中 `padWithDiscards` 的死代码调用

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-18 17:10

### 吊主单张盖不过分支增加 shouldAvoid + 弃分配非分优先

**问题 1**：`followTrumpLead`/`followNTTrumpLead` 单张盖不过分支始终不标注"尽量不加分"。

**问题 2**：shouldAvoid 时选牌应优先非分牌（`discardSort(false)`），否则最小牌是分牌时不必要的送了分。

**修复**：shouldAvoid 时用 `discardSort(false)` 排序，标注 `intent='avoid'`。

**新增 1 项测试**（ai-follow.test.ts：85 项），432 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-18 16:54

### 修正 isOnlyLegalPlay + 对子跟牌分支缺少 shouldAvoid

**问题 1**：甩牌含对子+单张时，`isOnlyLegalPlay` 误判为唯一可出（pairCount=1 且只有 1 对），忽略多张单张可选。

**问题 2**：`followOffSuitMulti` 对子跟牌分支缺少 `shouldAvoid` 逻辑，第二家/第四家对子盖不过时不标注"尽量不加分"。

**修复**：
- `isOnlyLegalPlay`：pairCount=1+pairs.length=1 时，增加 leadLen===pairSlots 或 leadSuitCards===leadLen 的精确条件
- `followOffSuitMulti`：对子跟牌分支增加 `shouldAvoid` 判断，第二家+max pattern+!tmWin 或第四家+!tmWin 时标注 avoid

**新增 1 项测试**（ai-follow.test.ts：84 项），431 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
## 2026-07-18 16:05

### 完善吊主跟牌规则 + 新增测试

**新增 11 项测试**（ai-follow.test.ts：83 项），430 项通过。

覆盖：
- 吊主单张第二家出小、有拖拉机抢最大、有甩牌抢 ≥A
- 吊主单张有分用最大、无分用 ≥A、无 ≥A 用最大
- 吊主对子有分用最大对子
- 第四家跟副牌单张优先分牌盖
- 跟牌拖拉机最小不能盖时扫描更大者
- 缺门第三家队友已大垫分牌不加分时毙

**影响文件**：`packages/engine/src/ai/index.ts`
**影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-18 12:30

### 跟牌策略完善：吊主盖过规则 + 第四家单张优先分牌

**问题 1**：第四家跟副牌单张盖过时，选最小能盖过的牌（如 ♣Q），未优先用分牌（如 ♣K）。

**问题 2**：吊主跟牌缺少"有分用最大，无分单张用 ≥A"规则，以及第二家抢领出权逻辑。

**修复**：

1. **第四家单张分牌优先**（`followOffSuitSingle`）：第四家盖过时，优先选能盖过的分牌。

2. **吊主单张盖过规则**（`followTrumpLead`）：
   - 第二家：一般出小；有拖拉机→用最大抢；有甩牌→用 ≥A 抢
   - 其他家：有分→用最大盖；无分→用 ≥A 盖（无 ≥A 则用最大）

3. **吊主对子盖过规则**（`matchTrumpPattern`）：有分→用最大对子盖。

**影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-18 12:15

### 修正：缺门且队友已大可加分时不应毙牌

**问题**：缺门时无条件进 `trumpKill`，即使队友已经赢了。例如队友领出副牌 A（最大），对手跟小牌，自己是第三家缺门——应通过垫分牌加分而非浪费主牌毙。

**修复**（`followOffSuit` void 分支）：缺门时先检查 `tmWin && canAddPoints`——队友已大可安全加分则垫分牌；否则正常毙牌。

**影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-18 12:00

### 修正：不指定花色时不应跳过人类亮主

**问题**：`doReveal` 的 `skipPlayer` 参数始终设为 `forcedDeclarer`，导致未指定花色时（不自动亮主）也跳过人类玩家的亮主提示。

**修复**：仅在 `autoReveal` 为 true（明确指定了花色）时才跳过该玩家。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-18 11:40

### 拖拉机跟牌修复：扫描能盖过的拖拉机

**问题**：`tryMatchTractorSlots` 选取最短/最小的拖拉机，若不能盖过则直接放弃，不检查其他拖拉机能否盖过。

**修复**（`matchTrumpPattern`、`followOffSuitMulti`、`trumpKill`）：所选拖拉机不能盖过时，反向排序重试找能盖过的。

**影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-18 00:25

### 对子跟牌修复：扫描能盖过的对子 + 第四家优先用分牌盖

**问题**：`pairKillSort` 选取最小对子后，若不能盖过则直接放弃，从不检查其他对子能否盖过。例如 AI 有 ♣4♣4 和 ♣10♣10，跟 ♣8♣8 时选 ♣4♣4 盖不过，就垫了。

**修复**：

1. **扫描能盖过的对子**（`followOffSuitMulti`、`followTrumpLead`）：最小对子不能盖过时，扫描其余对子，选最小的能盖过的对子。

2. **第四家优先用分牌盖**（`followOffSuitMulti`、`followTrumpLead`）：第四家能盖过时，有分对子则用分对子盖（最小），无分则用最小能盖过的。

3. **毙牌对子扫描**（`trumpKill`）：毙牌时选中的对子不能毙则扫描其余能毙的。

**新增 4 项测试**（ai-follow.test.ts：72 项），419 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-17 23:50

### 调试模式首局设定：指定等级花色和庄家

**功能**：调试模式下新增首局设定 prompt，可指定等级花色和庄家，被指定的庄家发牌时自动获得亮主需要的牌。

**Prompt 1 — 等级花色**（例如 `2C`、`KNT`）：
- 等级支持数字（2-10）和 J/Q/K/A，大小写不敏感
- 花色 S/H/C/D → 对应花色，NT → 无主，不填 → 随机

**Prompt 2 — 指定庄家**：
- `p0`-`p3` 指定，`n` 不指定（自然亮主），回车 = 自己
- 大小写不敏感

**rigDeck()**：发牌前洗牌，找到亮主需要的牌（NT→随机王对，花色→级牌 1~2 张随机），swap 到庄家的发牌位置，保证庄家能亮主。未指定花色时系统随机分配花色并 rig 发牌，但不自动亮主。

**自动亮主**：仅当用户明确指定花色（如 `2C`）时才自动 `tryReveal`。不指定花色但指定庄家时，庄家仍然能亮主但自主决定是否亮。不指定庄家（n）时不做任何干预。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-17 21:03

### 新增 exhaustive 逐卡验证：4 视角 × 3 玩家 × 12 常主逐卡归属检查

**新增**：Post-trick 多视角测试补充 exhaustive 逐卡验证——4 视角 × 3 玩家 × 12 常主 = 144 次逐卡归属检查（含底牌共 180 次），出牌前后各一轮。

**新增 3 项测试**（ai-nt-tracking.test.ts：41 项），415 项通过。

- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-17 19:50

### Post-trick 多视角无对扣除推理测试 + void-after-play 修复

**场景**：P1 吊 SJ 对后，P2（1张，不足2张）和 P3（2张，未跟对）均受扣除，P0 出 H-2 对无扣除。

**新增 void-after-play 规则**：多张吊主时，跟牌者打出 M < N 张主牌，说明只有 M 张主，打出后手牌无常主 → 所有视角下该玩家的 `possibleTrumps` 清空。

**关键验证**：
- P2 1张 < 2张 → void-after-play 清空（所有视角 `possibleTrumps[2] = []`）
- P3 未跟对 → no-pair 扣失去一张 C-2（C-2-0 和 C-2-1 可凑对）
- P0 视角下每个 suit-rank 最多 1 张 → 不触发 no-pair 扣除
- P1（庄家）视角仅剩 BJ-0, C-2-0 两张在 {0,3} 间模糊

**P3 出牌前视角计数修正**：`possibleTrumps` 从 9/10/8/10 修正为 8/9/7/9

**场景细节**：P0(4)→H-2-0,H-2-1,BJ-0,C-2-0 | P1(4)+S-2-0底→SJ-0,SJ-1,D-2-0,C-2-1 | P2(1)→D-2-1 | P3(2)→S-2-1,BJ-1

**新增 1 项测试**（ai-nt-tracking.test.ts：39 项），413 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-17 00:15

### 多视角亮主推理测试：直接验证 possibleTrumps 具体内容

**场景构造**：P0 亮红桃 2 单张，P1 用对小王反无主（庄家）。全部分配：
- P0 手牌：H-2-0, H-2-1, BJ-0, C-2-0（4张）
- P1 手牌：SJ-0, D-2-0, D-2-1, C-2-1；底牌 SJ-1（4+1张）
- P2 手牌：BJ-1（1张）
- P3 手牌：S-2-0, S-2-1（2张）

**6 项多视角测试**，直接验证每个玩家视角下其他玩家的 `possibleTrumps` 具体包含/不包含哪些 card ID：

- `knownTrumpsPerPlayer`：手牌常主在已知列表，非庄家亮主者的牌确定在其手牌
- P0 视角：P1/bottom 含 2 张 SJ，P2/P3 不含 SJ
- P1（庄家）视角：bottom 为 null，H-2-0 只在 P0，所有位置无 SJ
- P2 视角：P1/bottom 含 SJ，P3 无 SJ 无 H-2-0
- P3 视角：对称验证
- 跨视角一致性：非 P1 视角一致同意只有 P1/bottom 可以含 SJ

**新增 6 项测试**（ai-nt-tracking.test.ts：38 项），412 项通过。

- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-16 23:00

### 新增 /tracker 命令，/hand 支持显示所有手牌

**`/tracker [n]`（别名 `/tr`）**：显示常主记牌器（仅无主模式 + debug 模式）：
- 指定玩家（0-3）：从该玩家视角显示手牌常主、各位置可能常主（按 suit-rank 分组）、汇总行（无主标记、分布确定、王控制）、详情行（有对、可能有王）、计数行（对手常主下限、剩余王、张数范围）
- 不指定：循环显示 4 个玩家的记牌器

**`/hand [n]` 增强**：不带参数时循环显示全部 4 个玩家的手牌

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-16 22:30

### 亮主信息推理：基于公开亮主记录推断常主归属

**亮主信息是公共信息**，所有玩家均可基于亮主记录推断其他玩家是否可能持有特定常主：

- **王对亮主（strength ≥ 3）**：揭示者持有全部两张对应等级的王
- **级牌对亮主（strength ≥ 2）**：揭示者持有全部两张该花色级牌
- **单张亮主（strength = 1）**：揭示者持有一张，另一张仍不确定
- **提前亮主被反**：先亮主者（非庄家）的牌不确定仍在手牌中
- **庄家亮主**：最后亮主的是庄家，亮出的牌在 `{庄家, 底牌}`，非 `{庄家}` 确定

**修正**：
- `remainingBigJokers`/`remainingSmallJokers` 只统计模糊牌（`locs.size > 1`），已确定归属的不计入
- `allUnseenJokersOnOurSide` 将庄家队友的底牌视为我方
- `isOurSideLoc` 考虑底牌归属：庄家是队友时底牌是我方

**新增 9 项测试**（ai-nt-tracking.test.ts：23→32 项），392 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-15 23:00

### NT 常主记牌器与吊主策略

**常主记牌器**：
- `possibleTrumps`（5 个位置，自己为 null，庄家底牌为 null）
- `isFullyDetermined`（12 张全部确定归属）、`canFormPair`（是否还能形成对子）
- `canHaveJoker`/`canHaveBigJoker`/`canHaveSmallJoker`（王的可能性）
- `minTrumpCounts`/`maxTrumpCounts`（手中常主张数范围）

**追牌算法**：
- 初始化：手牌和底牌（庄家已知）的常主从可能列表排除
- 打出常主→从所有可能中删除（已不在手牌）
- 吊主对/拖拉机且玩家未跟对→无对扣除（每 (suit,rank) 组合最多留 1 张）
- 吊主时垫副牌→该玩家可能列表清空（已无常主）
- 底牌位置不受无对扣除和清空规则影响

**推断辅助函数**：
- `canPlayerBeatSingle/Pair` / `canAnyOpponentBeatSingle/Pair`
- `canFormJokerPair` / `opponentsHaveTrump`

**NT 吊主策略**：规则 ②③④⑤⑥ 全部实现
- ⑤ 小王对+级牌对拖拉机且对手无法管→出拖拉机
- ③ 级牌对+对手无王对→出级牌对
- ④ 单大王+对手有主→出大王；单小王+大王全在我方→出小王
- ② 剩余王全在我方→上级牌清主
- ⑥ 对手无对→安全吊单张；否则不吊

**跟牌增强**：`followNTTrumpLead` 多张跟牌时优先匹配对子，使用 `pairKillSort` 避免拆拖拉机

**修复**：`nt-tracking.ts` 第 67 行同义反复 bug（`cards === cards` 恒为 true）

**新增 14 项测试**（ai-nt-tracking.test.ts：23 项），383 项通过。

- **影响文件**：`packages/engine/src/ai/types.ts`
- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/ai/context.ts`
- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-15 20:29

### 取消"用拖拉机跟牌"理由，统一为同花色出大/出小

**跟拖拉机理由统一**：
- `followTrumpLead` 和 `followOffSuitLead` 中拖拉机匹配分支，固定的 `用拖拉机跟牌` 改为基于 `canBeat` 动态判断 `同花色出大` / `同花色出小`
- 与对子、单张跟牌的理由体系保持一致

**策略文档修正**：
- `strategy-rules.md` 2.3 节移除「不能匹配但能盖过」的矛盾描述（不匹配拖拉机就无法盖过）
- 理由列表中移除 `用拖拉机跟牌`

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-14 11:55

### 毙牌逻辑修复：按分数选择最小/最大牌

**毙牌大小选择**：
- 无分数 → 用最小能毙的主牌（单张/对子/拖拉机），其余从小到大填充
- 有分数 → 纯单牌用不小于A级的主牌（无则用最大），含对子/拖拉机直接出最大
- 盖毙 → 始终用最小能盖过前人的牌

**填充牌统一从小到大**：关键毙牌之外的填充牌按 rank 升序排列，不调用 discardSort。

**修正 `getEffectiveRank` 参数**：计算 Ace 有效牌力时需传入主花色，否则返回裸 rank 14 导致所有主牌都判定为≥A。

**新增 6 项测试**（ai-follow.test.ts：68 项）：
- 无分 → 最小牌毙
- 无分 → 最小对子毙
- 有分单张 → >=A 牌毙
- 有分单张 → 无>=A 时用最大
- 有分对子 → 最大对子毙
- 盖毙 → 忽略分数，最小能盖过

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-13 23:57

### 唯一可出判断 + 位置感知避分修复 + 吊主 canBeat 用 bestSoFar

**唯一可出判断重写**：`isOnlyLegalPlay` 改为基于牌型分析——单张时同花色只有1张、对子时只有1个对子、拖拉机时只有1套匹配拖拉机，均判定为唯一可出。

**位置感知避分修复**：
- 第三家+tmWin+非最大牌型 → 不附加加分/不加分
- 第四家+!tmWin → 总是避分
- `discardSort` 所有调用点补齐 `ctx` 参数传递
- **`discardSort` 排序逻辑修复**：`teammateWinning=true` 时非分牌未正确降权（与分牌同为 priority 0），导致加分时选不到分牌。修复为分牌 priority 0、非分牌 priority 100

**吊主单张 canBeat 修复**：`followTrumpLead` 和 `followNTTrumpLead` 单张分支改用 `bestSoFar` 的 `currentMax` 而非 `leadMax`。

**新增 5 项测试**：
- 第三家+tmWin+小牌 → 无标注
- 第四家+!tmWin+对子 → 避分
- 吊主第三家不能盖过前家已出大牌
- 吊主第三家全部盖不过
- 第三家+tmWin+拖拉机+仅1对+有分牌 → 加分包含分牌

- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/ai/utils.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 23:12

### 吊主单张跟牌：用 bestSoFar 而非 leadMax 判断能否盖过

`followTrumpLead` 和 `followNTTrumpLead` 单张分支之前用 `leadMax`（领出牌 rank）判断是否盖过，忽略前面玩家已经出更大的牌。改为用 `bestSoFar` 的当前最大值 `currentMax`，正确判断能否盖过当前最佳。

修复前：P0 吊 S-7，P1 跟 S-9(盖过)，P2 的 S-8 仍被判定为"能盖过"（S-8 > S-7），实际 S-8 < S-9 盖不过。修复后正确判断。

**新增 2 项测试**（ai-follow.test.ts：62 项）：
- 第三家 S-8 不能盖过已有 S-9 → 用最小能盖过的 S-10
- 第三家全部盖不过 → 出最小牌

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 22:28

### 甩牌 void 毙牌修复 + 毙牌理由统一 + 对子跟牌理由区分同花色出大/出小

**甩牌 void 毙牌修复**：`followOffSuitThrow` void 分支之前直接取前 N 张主牌乱毙，不检查是否匹配甩牌的对子/拖拉机牌型。改为委托 `trumpKill`，确保毙牌出牌能正确匹配领出牌型，不匹配时弃牌。

**毙牌理由统一**：毙牌理由统一为两种——首毙用 `用主牌毙`，盖过前人毙牌用 `盖毙`。去掉 `用主牌对子毙`、`用主牌拖拉机毙` 等细分理由。

**对子跟牌理由**：对子跟牌分支新增 `canBeat` 判断，能盖过用 `同花色出大`，不能盖过用 `同花色出小`。加分时 base reason 改为 `同花色出小`（队友已大无需盖过）。

**新增 1 项测试**（ai-follow.test.ts：60 项）：
- 甩牌两对 + void + 主牌对子不够 → 弃牌，不谎称毙牌

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 19:08

### 短牌填充避免浪费常主（级牌）

`fillerSort` 和 `discardSort` 新增级牌降权：同优先级主牌中，非级牌优先于级牌（常主）。修复前全主牌填充按 rank 升序 → S-2(常主) 排在最前被浪费；修复后非级牌优先 → S-3 排在 S-2 前面。

discardSort 签名新增可选 `config` 参数，各调用点传入 ctx。

**新增 1 项测试**（ai-follow.test.ts：59 项）：
- 全主牌填充选 S-3 不选 S-2(常主) 和 S-10(分牌)

- **影响文件**：`packages/engine/src/ai/utils.ts`、`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 18:44

### 主牌跟牌理由统一为副牌跟牌理由体系

主牌跟牌理由不再使用独立命名的理由字符串，改为与副牌跟牌相同的体系：
- "用最小能盖过的主牌" → "同花色出大"
- "盖不过，出最小主牌" → "同花色出小"
- "用最小主牌拖拉机跟牌" → "用拖拉机跟牌"
- "用最小主牌对子跟牌" → "用对子跟牌"
- "跟主牌"/"出最小主牌" → "垫同花色"

同时为主牌跟牌各分支补充了位置感知的加分/不加分附加说明。

NT 主牌跟牌同理统一。

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-12 18:35

### 无拖拉机填对子时补充位置感知理由和排序

`followOffSuitMulti` 的无拖拉机填对子分支之前硬编码了理由和填充排序，导致第二家加分、第三家没分可加时缺少标注。

修复后填充排序根据位置调整（第二/四家避分、第三家加分），理由通过 `annotateReason` 生成。

**新增 2 项测试**（ai-follow.test.ts：57 项）：
- 第二家无拖拉机填对子 → 避用分牌，附加尽量不加分
- 第三家无拖拉机填对子但没分 → 附加但没分可加

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 18:29

### 第二/第四家跟牌最大牌型时应附加尽量不加分

新增 `isMaxPattern` 辅助函数（单张/对子大牌、含拖拉机、甩牌）。第二/第四家不能盖过最大牌型领出时，出牌理由附加 `（盖不过，尽量不加分）`。

修复分支：`followOffSuitSingle` 不能盖过、`followOffSuitMulti` 兜底、`followOffSuitThrow` 部分填充、标准短牌填充，共 4 处。

**新增 2 项测试**（ai-follow.test.ts：55 项）：
- AI-2 短牌+第二家+甩牌 → 避用分牌填充
- AI-4 第四家+甩牌 → 避用分牌

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 17:11

### 甩牌检测：单张检查改为遍历全部最坏情况牌

单张可甩判断之前只检查 `worstComps.singles`，但对手可以拆对出单张。改为遍历全部 worstCase 牌（包括在对子/拖拉机中的牌），正确判断是否有任何对手牌能盖过我方单张。

修复前 KKQQ10 被建议甩 5 张（含被 A 挡住的 10），修复后正确返回 4 张（仅 KKQQ 拖拉机）。

**新增 2 项测试**（ai-throw-detector.test.ts：40 项）：
- KKQQ10 → 4 张可甩（KKQQ 拖拉机），10 被 A 挡住
- AAKK → 4 张可甩（AAKK 拖拉机）

- **影响文件**：`packages/engine/src/ai/throw-detector.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-throw-detector.test.ts`

## 2026-07-12 13:58

### 跟牌理由重构：加分/不加分改为附加说明

跟牌理由格式改为"主理由（附加说明）"，不再把加分策略作为独立理由。

**新增辅助函数**：
- `isOnlyLegalPlay` — 判断出牌是否唯一合法（同花色刚好匹配张数/对子/拖拉机且无需跨花色填充）
- `annotateReason` — 根据位置、领出牌型、意图和实际出牌计算附加说明

**附加说明类型**：
- 唯一合法 → `（唯一可出）`
- 加分成功 → `（队友已大，尽量加分）` / `（队友出拖拉机，尽量加分）`
- 加分失败 → `（但没分可加）`
- 避免加分 → `（盖不过，尽量不加分）`
- 避免失败 → `（尽量少加分）`
- 分牌盖过 → `（用分牌盖）` / `（用最小牌盖）`

**修改点**：
- `followOffSuitSingle` — 4处理由改为 base+annotation
- `followOffSuitMulti` — 3处理由改为 base+annotation
- `discardNonTrump` — 1处理由改为 base+annotation
- `followOffSuit` — 签名增加 trumpCards 参数

**新增 5 项测试**：第三家加分/拖拉机加分/不加分、第二家不加分

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 11:05

### 毙牌/跟牌避免拆拖拉机对子

新增 `pairKillSort` 排序器，毙牌和跟牌选择对子时优先不拆拖拉机对子。排序：非拖拉机对子 > 拖拉机对子 > 同档内非分对子 > 最小有效rank。

兜底：所有对子都在拖拉机内时，选择最小的拖拉机对子。

修复点数：`trumpKill`、`aiFollowTrumpOnly`、`followOffSuitMulti`（2处），共4处对子选择点。

**新增 2 项测试**（ai-follow.test.ts：50 项）：
- 有拖拉机对子+独立对子时选独立对子不拆拖拉机
- 无独立对子时兜底选最小拖拉机对子

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 00:52

### 毙牌正确性修复：区分毙和盖毙 + 增加11项毙牌测试

**毙 vs 盖毙区分**：毙牌理由现在根据是否已有人主牌毙过来正确区分——用主牌杀副牌叫「毙」，前面的毙牌需要更大主牌盖过叫「盖毙」。此前用分牌有无（`hasPoints`）错误判断。

**新增 `canTrumpKillBeat`**：用引擎 `compareTwo` 权威比较毙牌是否真正能击败当前最佳，确保所有毙牌理由都成立。

**新增 `isOverkill`**：判断 `bestSoFar` 是否已含主牌，决定是否需要在毙牌理由前加「盖」。

**多项修复**：
- 多张毙牌无法匹配牌型或盖不过时不再落到纯单牌分支（之前的错误）
- 领出对子、主牌无对子时改为弃牌（之前用单张主牌毙对子，非法）
- 单张毙牌：已有人毙过时盖不过改为弃牌

**新增 11 项毙牌测试**（ai-follow.test.ts：48 项）：
- 单张毙/盖毙各 2 项
- 对子毙/盖毙各 2 项
- 拖拉机毙/盖毙各 2 项
- 甩牌毙/盖毙各 2 项
- 毙牌失败弃牌 3 项

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 00:15

### 位置感知加分规则修复 + 短牌填充理由修正

**位置感知加分**：新增 `canAddPoints` 辅助函数。第四家队友已大总是加分；第三家仅在领出最大牌型（单张/对子大牌、含拖拉机、甩牌）时加分。修正了三处调用点（单张跟牌、对牌填充、无法匹配牌型兜底）。

**单张跟牌修复**：队友已大时不尝试盖过队友，直接出小/加分。

**对子填充修复**：对牌匹配后，填充牌按加分规则排序，而非整手早退。

**`discardSort` 修复**：加分时改为降序排列（优先甩大分牌），避免排序为升序时优先垫小分牌。

**短牌填充理由**：根据填充牌内容动态选择——含主牌时 `同花色不够，垫主牌`、含其他花色时 `同花色不够，垫其他花色`、全同花色时 `垫同花色`。

**新增 8 项测试**（ai-follow.test.ts：32 项）：
- 第三家+甩牌/AA对子/单A大牌 → 加分
- 第三家+小牌 → 不加分
- 短牌填充理由（垫主牌/垫其他花色/垫同花色）

- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/ai/utils.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-11 22:21

### 调试模式异常转储

调试模式下 `doPlayPhase` 捕获 `doPlayerTurn` 抛出的异常，打印错误信息和调用栈，并将完整游戏状态（手牌、出牌历史、主牌配置、分数等）序列化为 JSON 保存到 `crashes/` 目录，便于排查。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-11 22:16

### computeBestSoFar 越界崩溃修复

`computeBestSoFar` 在只有 2-3 家出牌时调用了 `determineWinner`，该函数固定遍历 4 家导致 `plays[i]` 为 `undefined` 引发 `TypeError`。
修复：出齐 4 家时用 `determineWinner`，未出齐时直接用 `compareTwo` 遍历已有出牌。

- **影响文件**：`packages/engine/src/ai/context.ts`

## 2026-07-11 22:09

### AI 模块重构：模块拆分 + 策略全面重写 + 68 项新测试

**架构重构**：AI 模块从单文件 675 行拆分为 7 个文件：
- `index.ts` — 公共 API（领出策略优先级链、跟牌策略按领出类型+位置感知分支）
- `types.ts` — `AIContext`（扩展 `TrumpDeclaration`，含角色、分数、手牌数、牌局历史、NT 跟踪）、`NTTrumpState`、`PlayPosition`
- `context.ts` — `buildAIContext(state,idx)` 从 GameState 构建完整决策上下文；`computeBestSoFar` 从 CLI 移入引擎复用
- `nt-tracking.ts` — NT 牌跟踪纯函数（枚举 12 张主牌、追踪已出/已知位置、推断对手主牌数和王分布）
- `throw-detector.ts` — 甩副牌检测（构造"其余牌全在一家"最坏情况，从大到小判断单牌/对子/拖拉机是否可甩）
- `bottom-strategy.ts` — 扣底策略（有主优先扣绝一门、NT <=6 张无分扣绝、均匀扣底）
- `utils.ts` — 共享辅助函数（位置判断、排序器、显示名称）

**领出策略（按优先级链 4>1>3>2>5>6>7）**：
- 4: 甩副牌（检测必然可甩的组合）
- 1: 出副牌大牌 A/K 单张或对子（级牌时 K/A 为顶张）
- 3: 出拖拉机（主/副均可，庄家>=20 张不领出主拖拉机、庄家对家永不出主拖拉机）
- 2: 出对牌（主/副均可，副牌 J+ 优先，同上庄家限制）
- 5: 吊主（最小主牌）
- 6: 副牌单张小牌
- 7: 最后一张

**跟牌策略**：按领出类型+位置感知分支（同花色/毙牌/垫牌、位置加减分规则、NT 吊主规则）

**CLI 集成**：AI 调用改为 `buildAIContext(state, idx)` 传入完整上下文；删除 CLI 本地 `computeBestSoFar`（已移至引擎）

**新增测试**（15 文件、324 项）：
- `ai-throw-detector.test.ts`：38 项
- `ai-leading.test.ts`：14 项
- `ai-nt-tracking.test.ts`：9 项
- `ai-bottom-strategy.test.ts`：7 项

- **影响文件**：`packages/engine/src/ai/*.ts`（7 文件新增/重构）
- **影响文件**：`packages/engine/src/__tests__/ai-*.test.ts`（4 文件新增）
- **影响文件**：`packages/cli/src/index.ts`（上下文传入）

## 2026-07-08 00:02

### 缺门多张毙牌时匹配领出牌型：用主牌对子/拖拉机毙

多张缺门时，AI 现在优先用主牌对子/拖拉机匹配领出牌型，而非盲目取最强主单牌：
- 领出对牌 → 用最小非分主牌对子毙（`用主牌对子毙`）
- 领出拖拉机 → 用最小主牌拖拉机毙（`用主牌拖拉机毙`）
- 领出单牌 → 用最强主牌毙

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-07 23:51

### 修复缺门时浪费主牌的问题 + pairSortAsc 对牌排序

**缺门主牌盖毙/毙牌优化**：
- 单张缺门时，先判断能否盖过当前最大牌，不能则改为垫副牌而非浪费主牌
- 两种例外：全主手牌盖不过时必然出主牌；保留分牌优先垫非分副牌
- 多张缺门时用最小主牌而非最大（盖毙效果相同，保留大主牌）
- 理由区分：`用主牌盖毙`（能盖过）、`盖不过，垫副牌`（不能盖且有副牌）、`盖不过，出最小主牌`（全主手牌）、`无领出花色，出最小主牌`（首跟缺门）

**`pairSortAsc` 通用化**：对牌选择统一为非分对牌优先、同组取最小有效 rank，防止盲目垫分牌对。

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-07 23:37

### AI 对牌跟牌优化：优先出非分对牌

`aiFollowMulti` 的无拖拉机对牌填充分支和标准对牌跟牌分支，对牌排序均改为 `pairSortAsc`：非分对牌优先、同组取最小有效 rank。避免盲目垫分牌对（如 ♦10♦10），保留分牌对到后续墩收割。

新增通用 `pairSortAsc` 辅助函数（已在 `aiFollowTrumpOnly` 中复用）。

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-07 23:20

### AI 出牌策略优化

**领出优化**：
- L1 理由改为「领出拖拉机（N对）」（去掉「清主牌」后缀，因拖拉机不分主副）
- L4 新增 K 领出：A 是级牌时 K 是副牌最大，也可用来清副牌

**跟牌优化**：
- F1/T4：队友已大垫分时确保选的是分牌（5/10/K），而非任意大牌
- F10 改为「垫副牌」、F11 改为「垫牌(含主牌)」，区分是否混合了主牌
- T2/T3：打最小主牌时避免浪费常主（优先选非分、低 rank 的单牌）
- F6/T7/T9：填对子时优先非分对牌，避免盲目垫分数对
- `fillerSort`：短牌填充时优先垫副牌（非主牌），避免无故垫主牌
- `discardSort` 重构：统一逻辑，优先选非分牌

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-06 20:18

### 调试模式恢复原有出牌提示

调试模式下提示恢复为「编号或 /debug 命令:」，因为调试模式支持的命令不止 `/hint` `/score` `/bottom`。非调试模式维持限制版提示。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-06 20:14

### 输入校验 + 测试：拒绝无效手牌编号

`parseCards` 重构为独立模块 `cli/src/parse.ts`，新增完整参数校验：所有编号必须为数字且在范围内。

**新增 14 项 CLI 测试**（`cli/src/__tests__/parse.test.ts`）：
- 3 项有效编号（单个、多个、最大号）
- 空输入返回空
- null trump 配置可用
- 5 项无效编号（超出范围、负数、非数字、混合、极大值）
- 空手牌
- 扣底场景（33 张手牌，8 张选择）

- **影响文件**：`packages/cli/src/parse.ts`（新增）、`packages/cli/src/__tests__/parse.test.ts`（新增）、`packages/cli/src/index.ts`

## 2026-07-06 20:07

### 修复 parseCards 接受无效编号：越界/非数字直接拒绝并提示重试

**问题**：`parseCards` 对无效编号（越界、非数字）静默忽略，可能导致实际打出的牌与输入不符；扣底流程同样缺少校验。

**修复**：`parseCards` 返回前验证全部编号——越界或非数字直接报错并要求重试；扣底（33 选 8）流程同步加校验。

**无新增测试**，256 项测试通过。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-06 19:57

### 手牌排序优化：同 rank 同组按花色 S-H-C-D 展示

`sortHand` 新增花色 tiebreaker：同组同 rank 的牌（如副级牌 ♥2♣2♠2♥2）现在按 ♠♥♣♦ (S-H-C-D) 顺序展示，而非之前的随机顺序。

- **影响文件**：`packages/engine/src/model.ts`

## 2026-07-06 00:14

### AI 跟牌回归测试：新增 4 项方块主 level=2 真实场景

复现用户反馈的崩溃场景，确保 AI 跟牌始终合法：

1. **主拖拉机 D2D2H2H2** → AI 用对小王+最小主单牌跟牌
2. **甩牌：大王对 + 主拖拉机 D2D2H2H2** → AI 匹配拖拉机槽位 + 填对子
3. **黑桃 AQQ** → AI 有对必跟对
4. **草花 AKK** → AI 有对必跟对

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-06 00:08

### 修复全主牌领出时 AI 跟牌崩溃

**根因**：3 个 bug 叠加导致 AI 无法跟出合法牌型，进而触发降级链最终崩溃。

1. **CLI `leadSuit` 空指针覆盖**：全主牌领出时 `leadSuit` 为 `null`，`null || cards[0].suit` 把 `null` 覆盖为方块花色，导致 AI 跟牌按「有方块牌必须跟」处理，只出了 4 张方块单牌。

2. **`aiFollowTrumpOnly` 无拖拉机时不填对子**：领出拖拉机（2 对）但手牌只有 1 对小王无拖拉机时，直接出 4 张最小单牌，不符合「有对子必须尽力配对」的跟牌规则。

3. **`aiFollowMulti` 同样问题**：纯拖拉机领出时 `leadPairs.length === 0`，无拖拉机可用后直接退到单牌路径。

**修复**：
- `leadSuit` 改用 `!= null` 判断避免空指针覆盖
- 两个 AI 函数在无拖拉机可用时主动用对子填充

- **影响文件**：`packages/cli/src/index.ts`、`packages/engine/src/ai/index.ts`

## 2026-07-05 23:52

### 调试模式：人类庄家时 AI 在发牌阶段不亮主

当人类玩家（P0）是第一局庄家时（`DEBUG && declarerIndex === 0`），AI 在发牌阶段不主动亮主，等人类在亮主阶段放弃亮主后，AI 才亮主。人类亮主后 AI 仍可反主。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-05 22:15

### 非调试模式 UX 改进

**命令限制**：非调试模式下只保留 `/score`（查看得分）和 `/hint`（出牌建议），其他 debug 命令（`/hand`、`/history`、`/bottom`、`/dump` 等）不再可用。

**提示文本**：出牌输入提示从「编号或 /debug 命令」改为「编号或/hint查看提示、/score查看目前得分」。

**/score 不暴露底牌**：非调试模式下 `/score` 不再显示底牌内容和底牌分数（保留闲家得分和已拿分数牌）。

**甩牌失败提示**：人类玩家甩牌失败时，CLI 显示黄色提示和灰色罚分详情：
- `甩牌失败！强制出: ♦8♦8♦7♦7`
- `→ throw failed — must play longest tractor (2 pairs) (attacker penalty 1/3)`

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-05 21:59

### 修复跟牌 vs 垫牌比较：跟牌始终大于垫牌

**Bug**：非主牌领出时，`compareTwo` 未区分跟牌和垫牌，直接通过 `cardGreater` 比较 rank。垫牌的 rank 若大于跟牌则错误胜出（如领出 ♦8，跟 ♦Q 为 12，垫 ♥K 为 13 → ♥K 被判最大）。

**修复**：在 `compareTwo` 中新增 `inLeadGroup` 检查——非主牌领出且双方均无主牌时，跟随领出花色组的一方始终大于垫牌方。

**新增测试**：领出 ♦8，玩家跟 ♦Q、垫 ♥K、跟 ♦3 → 验证 ♦Q 获胜而非 ♥K。

- **影响文件**：`packages/engine/src/comparing/index.ts`、`packages/engine/src/__tests__/comparing.test.ts`

## 2026-07-05 21:45

### 幻影对牌测试：验证逐玩家检测也消除跨玩家幻影对牌

**问题**：甩 A+JJ 时，如果 KK 的两张 K 分属两个不同玩家，合并后会被检测为更高对牌挡住 JJ。

**修复**：之前的逐玩家检测已一并解决此问题（`extractComponents` 对每个玩家独立调用）。新增 2 项测试确认：
- KK 分散两人 → 甩牌通过
- KK 在同一人手中 → 甩牌被拦截

- **影响文件**：`packages/engine/src/__tests__/throw-validation.test.ts`

## 2026-07-05 17:59

### 概念重命名：dealer → declarer（庄家）

「庄家」和「发牌者」是同一个身份——拿到并处理底牌的人、领出第一墩的人。不存在独立的「发牌人」概念。

**变更**：`GameState.dealerIndex` → `declarerIndex`，`gameLoop(dealerIndex)` → `gameLoop(firstDeclarer)`，`finalize(dealerIndex)` → `finalize(declarerIndex)`，相关参数、注释、序列化字段全部统一。

**新增 5 项完整两局场景测试**：模拟 P0 初始庄家、P2 亮主、庄家保级后 dealer 轮换的完整链路。

- **影响文件**：`packages/engine/src/types.ts`、`packages/engine/src/revealing/index.ts`、`packages/engine/src/game/index.ts`、`packages/engine/src/model/serialize.ts`、`packages/cli/src/index.ts`、`packages/engine/src/__tests__/declarer-rotation.test.ts`

## 2026-07-05 16:58

### 修复 dealer 轮换逻辑：始终从当局庄家计算下局 dealer

**问题**：之前 `gameLoop` 维护独立的 `dealer` 变量，每次增量更新（`dealer + 1` 或 `dealer + 2`），与当局庄家无关。这导致首局亮主者抢走庄家后，下局 dealer 仍从初始发牌者计算，而非从当局的实际庄家计算。

**修复**：`nextDealer` 始终从 `gameState.trumpDeclaration.declarerIndex` 计算，不再沿用旧 dealer 值。首局庄家由亮主结果确定后，后续局 dealer 均由此派生。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-05 16:33

### 修复甩牌验证中的跨玩家幻影拖拉机检测

**Bug**：`validateThrow` 和 `resolveThrowFailure` 将所有其他玩家的牌合并后再检测拖拉机/对子，导致跨玩家产生幻影牌型。例如 ♦Q 在 AI-2 手中，♦Q 在 AI-4 手中，♦J♦J 在 AI-2 手中——合并后检测出 QQJJ 拖拉机，实际上任何单个玩家都没有这个拖拉机。

**修复**：改为逐个玩家独立检测。每个其他玩家的手牌分别过滤、分别 extract 组件、分别与领出的子牌型比较。只有单个玩家持有的拖拉机/对子/单牌才能拦截甩牌。

**新增 2 项测试**（`throw-validation.test.ts`）：
- Q+J 分散在多个玩家 → 甩牌通过（无幻影拖拉机）
- 单个玩家持有 QQJJ → 甩牌被拦截

- **影响文件**：`packages/engine/src/leading/index.ts`、`packages/engine/src/__tests__/throw-validation.test.ts`

## 2026-07-05 12:52

### 庄家轮换修正 + 11 项测试

**修复**：`gameLoop` 中庄家保级时的 dealer 轮换逻辑从 `不变` 改为 `轮换到对家（队友）`。

**正确规则**：
- 闲家上台（attacker ≥ 80）→ dealer +1 → 另一方做庄
- 庄家保级（attacker < 80）→ dealer +2 → 队友做庄

**新增 `declarer-rotation.test.ts`**（11 项测试）：

**第一局**（`isFirstRound=true`）：
- 玩家亮主 → 亮主者即为庄家
- 反主 → 最终反主者为庄家
- 无人亮主 → dealer 叫主并成为庄家

**后续局**（`isFirstRound=false`）：
- 有人亮主/反主 → 庄家始终是 dealer，亮主者只决定主花色
- 无人亮主 → dealer 叫主并成为庄家
- 庄家保级 → dealer 轮换到对家（队友）
- 闲家上台 → dealer 轮换到下一家

- **影响文件**：`packages/cli/src/index.ts`、`packages/engine/src/__tests__/declarer-rotation.test.ts`（新增）

## 2026-07-05 12:28

### 拖拉机检测修复：级牌与非级牌同花色使用 effective rank 判断连续性

**修复**：之前仅用 `isTrump` 检查无法区分同为主牌的级牌与非级牌（如红桃主时 ♥3 和 ♥2 都是 trump），需用 `getEffectiveRank` 判断两者的 trump 排序是否相邻。

**逻辑**：`areConsecutiveSameSuit` 中，涉及级牌的配对改用 `Math.abs(getEffectiveRank(a) - getEffectiveRank(b)) === 1` 判断。

### 拖拉机链全面测试：新增 57 项跨等级/主牌测试

**新增 `tractor-chains.test.ts`**：覆盖 4 种等级配置下的同花色和跨组拖拉机链：

| 等级 | 主牌 | 测试数 | 关键场景 |
|------|------|--------|----------|
| 2 | 红桃 | 14 | H-33+22 否（级牌断链）、BJ-SJ-H2 3p、H2-S2-HA 3p |
| A(14) | 黑桃 | 23 | S-AA+KK 否、SJ+SA+HA 3p、SA+HA/DA/CA √、HA+DA/CA 否、多 Ace 否 |
| 10 | 草花 | 11 | C-1010+99 否、C-99+88/JJ+99√（跳过 10） |
| K(13) | NT | 9 | S-KK+QQ 否、S-AA+QQ√（跳过 K）、BJ+SJ+HK 3p |

- **影响文件**：`packages/engine/src/pattern/index.ts`、`packages/engine/src/__tests__/tractor-chains.test.ts`（新增）

## 2026-07-05 12:02

### 庄家轮换修正：后续局亮主者不自动成为庄家

**修复**：第一局亮主者即为庄家，但后续局庄家由上一局结果确定（闲家上台则轮换），亮主者只决定主花色，不改变庄家归属。

**之前**：`finalize` 始终将亮主者设为 `declarerIndex`，导致 AI-4 亮主后错误地成为第二局庄家。

**之后**：`finalize` / `finalizeReveal` 新增 `isFirstRound` 参数。第一局行为不变；后续局庄家始终是 dealer，亮主者只贡献 trump suit。

- **影响文件**：`packages/engine/src/revealing/index.ts`、`packages/engine/src/game/index.ts`、`packages/cli/src/index.ts`

### 拖拉机检测修复：级牌与非级牌同花色不能形成拖拉机

**修复**：级牌属于主牌组，非级牌属于其原始花色组，两者在 `areConsecutiveSameSuit` 中不应被视为同一花色组的连续对。例：♣3♣3♣2♣2（♣2 是级牌时）不再误判为拖拉机。

**之前**：`areConsecutiveSameSuit` 只检查 suit 相同即视为同花色，未排除级牌的 suit group 差异。

**之后**：新增 `isTrump(a) !== isTrump(b)` 检查，级牌对与非级牌对不能形成同花色拖拉机（它们属于不同的 suit group）。

- **影响文件**：`packages/engine/src/pattern/index.ts`

## 2026-07-05 10:51

### 甩牌罚分测试：新增 7 项测试覆盖罚分全部场景

**新增 `throw-penalty.test.ts`**（7 项测试）：

| 测试 | 场景 | 验证点 |
|------|------|--------|
| attacker fails | 闲家（P1）甩牌失败 | `attackerPoints: -10`，`throwPenalties: [0,1]` |
| defender fails | 庄家（P0）甩牌失败 | `attackerPoints: +10`，`throwPenalties: [1,0]` |
| attacker 超 3 次 | 预置 3 次罚分后再失败 | 不罚分，`max penalties reached` |
| defender 超 3 次 | 预置 3 次罚分后再失败 | 不罚分，`max penalties reached` |
| -10 clamp | `computeLevelChange(-10)` | 大光 +3 |
| -30 clamp | `computeLevelChange(-30)` | 大光 +3（理论最大罚分） |
| 75→85 上台 | 庄家甩牌失败 +10，75→85 | 闲家从保级跨过 80 分门槛上台 |

- **影响文件**：`packages/engine/src/__tests__/throw-penalty.test.ts`（新增）

## 2026-07-05 09:52

### 甩牌失败罚分规则

**规则**：
- 闲家甩牌失败一次，闲家得分 **-10**（扣 10 分）
- 庄家（含队友）甩牌失败一次，闲家得分 **+10**（加 10 分）
- 每方最多罚 **3 次**，超出不罚
- 可能产生负分，一局结束时 **负分视为 0 分**（`computeLevelChange` clamp）
- 调试模式下不触发罚分（甩牌失败直接报错让玩家重选）

**引擎实现**：
- `GameState` 新增 `throwPenalties: readonly [number, number]`（[庄家方罚次数, 闲家方罚次数]）
- `playLead` 甩牌失败时：判断玩家属于庄家方/闲家方 → 检查是否达上限 → 未达则更新 `throwPenalties` 和 `attackerPoints`
- `computeLevelChange` 改为 `Math.max(0, rawPoints)` clamp 负分
- `advanceAfterPlay` 不变，甩牌失败强制出牌与正常出牌走同一条路径

**CLI 适配**：
- `showRoundResult` 使用 `Math.max(0, attackerPoints)` 计算升级，同时显示罚分前原始得分

**`forceReason` 增强**：附加罚分信息，如 `(defender penalty 2/3)` 或 `(max penalties reached)`

- **影响文件**：`packages/engine/src/types.ts`、`packages/engine/src/game/index.ts`、`packages/engine/src/scoring/index.ts`、`packages/cli/src/index.ts`

## 2026-07-05 00:00

### 新增测试：梅花主 K 级多拖拉机拦截强制出场景

**新增 1 项测试**（leading.test.ts）：梅花主K级——领出小王+方块K+梅花AAQQ7766553322（全主），对方持 JJ10109988（4 对拖拉机）拦截 C-776655（3 对拖拉机），验证引擎强制出 776655（最长被拦截拖拉机）。

- **影响文件**：`packages/engine/src/__tests__/leading.test.ts`

## 2026-07-04 22:55

### 甩牌失败强制出小规则

**新增规则**：甩牌未通过 `validateThrow` 校验时，不再简单拒绝，而是强制打出被拦截子牌型中的最小项。

**仅针对被拦截的牌型**：例：甩 A+55（等级 2），其他玩家有对 6 挡住 55，则强制出对 5，而不是 A。

**优先级**（从高到低，仅限被拦截的牌型）：
1. **拖拉机** → 强制出连对数最多的拖拉机（同长度取最低 rank）
2. **对牌** → 强制出 rank 最小的被挡对牌
3. **单牌** → 强制出 rank 最小的被挡单牌

**调试模式 vs 正常模式**：
- 调试模式：甩牌失败视为不符合出牌规则，返回 error 让玩家重新选择
- 正常模式：甩牌失败不提示错误，直接强制打出被挡子牌型

**引擎实现**：
- **`validateThrow` 重构**：抽取 `collectOtherCards`、`checkTractorBlock`、`checkPairBlock`、`checkSingleBlock` 为可复用辅助函数
- **`resolveThrowFailure(thrown, otherHands, config)`** — 新增函数，逐个判断子牌型是否被拦截，按优先级返回 `{ forcedPlay, reason }`
- **`playCards`/`playLead`** — 甩牌失败时，`state.debug ? reject : forcePlay`

**CLI 适配**：检测 `result.forcedPlay`，显示「甩牌失败」+ 实际打出的牌。

**新增 6 项测试**（`leading.test.ts`）：
- 拖拉机被挡 + 其他正常 → 强制出拖拉机
- 两套拖拉机（3p+2p）均被挡 → 强制出 3-pair
- 对牌被挡 + 顶单未挡 → 强制出最小被挡对牌
- level=2 A+55 被 66 挡 → 强制出 55
- 仅单牌被挡 → 强制出最小被挡单牌
- 主牌拖拉机被挡 → 强制出拖拉机

- **影响文件**：`packages/engine/src/leading/index.ts`、`packages/engine/src/game/index.ts`、`packages/cli/src/index.ts`、`packages/engine/src/__tests__/leading.test.ts`

## 2026-07-04 18:00

### AI 跟牌合规性验证：新增 21 项测试确保建议始终符合规则

**新增 `ai-follow.test.ts`**：21 项测试覆盖 AI 跟牌函数在所有场景下产出均通过 `validateFollow` 校验。

| 场景分类 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| 非主牌领出（黑桃） | 8 | 对牌/拖拉机/甩牌 领出，足够/短牌/缺花 |
| 短牌/缺花 | 5 | 对牌/拖拉机 领出时的全部打出+垫牌 |
| 主牌领出（cfg5） | 4 | 拖拉机领出、单张领出能盖/不能盖 |
| 主牌甩牌（方块A级） | 1 | 12 张两套拖拉机甩牌 |
| 单张非主牌 | 2 | 能盖/队友已大垫分 |
| 王领出 | 1 | 单张大王者跟牌 |

引擎层已有 `playCards` → `validateFollow`/`validateThrow` 验证层，AI 出牌失败会自动降级（lines 534-548），但此前 AI 函数无独立合规性测试，错误依赖降级掩盖。现在每个 AI 跟牌调用都先经引擎校验通过。

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`（新增）

## 2026-07-04 17:39

### AI 跟牌/hint 建议修复：确保建议始终符合跟牌规则

**问题**：`/hint` 命令直接调用 AI 跟牌函数，但 AI 函数存在多处规则违反，未被验证就对用户输出错误建议。

**AI 跟牌修复**（3 处）：

- **`aiFollowMulti`**：拖拉机/甩牌领出时，原逻辑仅匹配第一条同长度拖拉机（`myTractors[0].length === leadLen`），无法处理多拖拉机甩牌和长截取。改为按 lead 的每个 tractor slot 依次匹配（优先最短可用拖拉机），并用对牌（非单牌）填充剩余位置。

- **`aiFollowTrumpOnly`**：同上问题——多张主牌领出时只取第一条拖拉机，导致甩牌场景返回张数不足。改为按 slot 匹配 + 对牌填充。

- **`aiFollowPlay`**：短牌场景（同花色牌数 < 领出张数）被当作缺花色处理，导致跟牌花色错误。新增短牌分支：全部同花色牌打出 + 垫其他花色。

**hint 安全网**：

- 在 `showHint` 中新增 `validateFollow` 验证层：AI 建议先经引擎规则校验，不通过则触发 fallback（打全部同花色牌 + 垫最小牌），fallback 也校验后再输出。
- 导出 `validateFollow`、`validateLead`、`classify` 供 CLI 使用。

- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/following/index.ts`、`packages/cli/src/index.ts`

## 2026-07-04 17:14

### 甩牌验证测试：全面覆盖副牌和主牌甩牌场景

**新增 24 项 `validateThrow` 测试**（cfg5：红桃主，等级 5），覆盖 4 种甩牌类型 × 副牌/主牌两个维度，每种场景含 pass 和 fail 用例：

| 甩牌类型 | 副牌（黑桃） | 主牌（红桃+王） |
|----------|-------------|----------------|
| 纯单牌 | 1 pass + 1 fail | 1 pass + 1 fail |
| 对牌+单牌 | 1 pass + 2 fail | 1 pass + 2 fail |
| 拖拉机+单牌 | 1 pass + 2 fail | 1 pass + 2 fail |
| 拖拉机+独立对 | 1 pass + 3 fail | 1 pass + 3 fail |

**失败场景覆盖 4 种被挡原因**：
- 更高的同长度拖拉机
- 更高的独立对牌
- 更高拖拉机内的牌挡住独立对
- 更高的单牌

测试文件同时清理了不必要的注释，保持代码简洁。

- **影响文件**：`packages/engine/src/__tests__/throw-validation.test.ts`

## 2026-07-04 16:24

### 跟牌验证：复杂拖拉机跟牌 + 模式检测修复

**新增 5 项复杂跟牌测试**（方块主，A 为等级）：

1. 领出 4 连对拖拉机 77665544：
   - 手牌对大王+对小王+对梅花A+883322 → 必须出对王+3322 拖拉机，不能出梅花A+88+3322
   - 手牌 KK+1010+99+88+33+22 → 可出 1010+99+88 拖拉机+22 补对，不能出 99+88+33+22

2. 领出 DA+HA+KK + 10109988 两套拖拉机（共 6 对）：
   - 手牌对大王+对小王+对梅花A+QQJJ+77553322 → 可出 QQJJ77553322，也可出对王+QQJJ3322

**模式检测修复**（3 处 bug）：

- **mergeChains**：合并重叠链（如 10-9 + 9-8）时，共享的 9 对被重复计入，产生 4-pair 而非正确的 3-pair。新增 ID 去重逻辑，合并时跳过已存在的卡牌。

- **crossGroupTractors**：当等级 = A 时，`tLev`（主牌级牌 A）与 `tA`（主牌 A）为同一对牌，导致 `tLev+offLev+tA` 链中 DA 被使用两次。新增 `tAisTLev` 检查，跳过重复链。

- **classify**：计算 standalone 对数时使用了全部拖拉机（含重叠）的卡牌 ID，导致未被选中的对牌也被排除。改为仅使用 `distinctTractors` 的卡牌 ID。

**computeIdealFollow 改进**：

- 拖拉机槽位匹配改为循环填充：当手牌没有足够长的单条拖拉机时，用多条短拖拉机组合填充（`remaining >= 2` 时继续尝试），使 minTotalPairs 计算更准确。
- 避免将 1-pair 的拖拉机截取（实质为普通对牌）当作拖拉机要求。

- **影响文件**：`packages/engine/src/following/index.ts`、`packages/engine/src/pattern/index.ts`、`__tests__/following.test.ts`

## 2026-07-04 13:25

### checkTractorOrThrowFollow：拖拉机个数检查提前到循环外
- **重构**：将「已出拖拉机个数 ≥ 理想个数」的检查从 for 循环内提到循环外，与逐个比对连对数的循环分离。
- **影响文件**：`packages/engine/src/following/index.ts`

## 2026-07-04 13:11

### 短牌/等牌跟牌：移除不必要的牌型检测
- **修复**：当手牌中同花色数 ≤ 领出张数时，玩家必须打出该花色全部牌，不足部分垫其他花色。此场景下玩家对该花色牌的选择没有余地，不应进行牌型匹配检测。
- **移除**：`handInGroup.length <= leadCards.length` 分支中错误的 `matchPattern` 调用——之前短牌时仍要求匹配拖拉机/对子，导致仅有单牌的玩家被错误拒绝。
- **逻辑**：短牌/等牌分支现在只验证该花色牌是否全部打出，不检查牌型。
- **新增测试**（7 项）：`short-suited / exact-count (no pattern check)` 分组：
  - exact-count + 拖拉机领出，牌全是单牌 → 合法
  - exact-count + 对牌领出，单牌 → 合法
  - short + 拖拉机领出，只有一对不要求拖拉机 → 合法
  - short + 甩牌（拖拉机+单）领出，只有单牌 → 合法
  - short + 甩牌（拖拉机+对）领出，只有一对一单 → 合法
  - short 主牌 + 拖拉机领出，主牌全是单牌 → 合法
  - exact-count + 拖拉机领出，恰好成拖拉机 → 合法
- 总计 41 项跟牌测试，107 项引擎测试全部通过。
- **影响文件**：`packages/engine/src/following/index.ts`、`__tests__/following.test.ts`

## 2026-07-03 00:05

### 测试修正：消除 lead 与 hand 的牌面重复 + 甩牌合法性校验
- **修复**：多组测试中 lead 和 hand 使用了相同的 (suit, rank) 组合，违反每张牌最多出现两次的约束。重分配所有牌面使 lead 和 hand 的 rank 互不重叠。
- **修复**：「甩牌拖拉机+对」的 lead AAKK+QQ 实际上 A-K-Q 连续（14-13-12），被 `classify` 判定为纯 3 对拖拉机而非甩牌。改为 AAKK+1010（10 与 K 不连续，有 J、Q 间隔），使其正确归类为甩牌（tractor + standalone pair）。
- **修复**：「无拖拉机全补对子」测试中 hand 的 8877 在 level=5 下是拖拉机（8-7 连续）。改为 Q-9-6（均不连续）。
- **修复**：「主牌拖拉机必须跟」拒绝用例中 hand 只有 1 张 ♥10 却试图构造 ♥1010 对子。改为 pair + 2 singles 作为拒绝场景。
- 总计 34 项测试，100 项全部通过。
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-02 23:19

### 新增 26 项跟牌测试

**新增 26 项测试**（following.test.ts），覆盖全部领出牌型 × 足够同花色/短花色/缺花色场景：
- **对牌领出**（5）：足够同花色有对/无对、短花色有对/无对、缺花色
- **拖拉机领出非主牌**（6）：精确匹配、长截取、无拖拉机有对、无对无对、短花色、短花色有对
- **拖拉机领出主牌**（3）：短主牌、足够主牌精确匹配、无主牌
- **甩牌纯单牌**（3）：足够、短花色、缺花色
- **甩牌对+单**（4）：足够有对、足够无对、短有对、短无对
- **甩牌拖拉机+单**（3）：足够有拖拉机、足够无拖拉机有对、短有拖拉机
- **甩牌拖拉机+对**（2）：足够匹配拖拉机+对、无拖拉机全补对子
- 原有 7 项保留至 basic 分组，总计 33 项测试

- **影响文件**：`packages/engine/src/following/index.ts`、`packages/engine/src/__tests__/following.test.ts`

## 2026-07-02 22:18

### 跟牌规则全面重写

**总前提**：
- 同花色牌数 ≤ 领出张数：该花色全部打出，不足部分垫其他花色
- 同花色牌数 > 领出张数：必须全出该花色，且牌型尽可能匹配领出牌型

**拖拉机跟牌**：
- 优先出相同对数的拖拉机（exact 或从 longer 截取，两者同等有效）
- 都没有时出对数最接近的短拖拉机，再用其他拖拉机拆对、普通对牌补足

**对牌跟牌**：
- 手牌有对子（含拖拉机内的对子）则必须出对牌

**甩牌跟牌**：
- 将甩牌拆为拖拉机（从长到短）和对牌，依次应用上述规则

**新增 `computeIdealFollow` / `pickBestTractor`**：计算手牌能达到的最佳跟牌结构（tractor 对数 + 最小总对数），然后与实际出牌比对验证。

**影响文件**：`packages/engine/src/following/index.ts`

## 2026-07-02 00:20

### 跟牌验证修复：主牌不足时必须出全部主牌
- **修复**：领出多张主牌时，跟牌者主牌数不足领出张数的场景，之前完全跳过了主牌检测（`trumpInHand.length >= leadCards.length` 条件为 false 就直接放行），导致人类玩家可以用全副牌绕过规则。
- **修复**：改为 `mustPlay = Math.min(trumpInHand.length, leadCards.length)`，手上有几主牌就必须出几主牌，不够的部分才能用副牌填补。
- **新增测试**：`partial trump — must play all available trump when lead is multi-trump`（3张主牌面对4张主牌领出，打4张副牌被拒）
- **新增测试**：`partial trump — allowed when all available trump are played`（3主+1副正确通过）
- **影响文件**：`packages/engine/src/following/index.ts`、`__tests__/following.test.ts`

## 2026-07-01 22:00

### 创建 game 状态转换模块
- 新建 `engine/src/game/index.ts` — 纯函数状态胶水层：
  - `tryReveal(state, playerIndex, suit)` — 亮主/反主
  - `finalizeReveal(state)` — 结束亮主阶段，无人亮则庄家自动叫主
  - `playCards(state, playerIndex, cards)` — 领出/跟牌验证 + 牌型分类 + 墩结算
- **影响文件**：`packages/engine/src/game/index.ts`、`packages/engine/src/index.ts`

### 统一 ValidationResult 类型
- 将 `ValidationResult` 接口从 `leading` 和 `following` 的本地定义移至 `types.ts` 作为共享导出，消除两个模块重复导出的歧义。
- **影响文件**：`packages/engine/src/types.ts`、`leading/index.ts`、`following/index.ts`

### 类型修复
- `model.ts` — `createCard` 签名收紧为 `CardSuit`（移除字面量 `'J'`）
- `model/serialize.ts` — `comboToJSON` 修复 readonly tractors 类型错误
- **影响文件**：`packages/engine/src/model.ts`、`model/serialize.ts`

### AI 模块适配
- 修复 `ai/index.ts` 对已删除模块 `../types/play.js` 的残留引用
- 函数名 `detectTractor` → `detectTractors`（匹配 pattern 模块导出）
- 添加缺失的 `ComboClass` 和 `detectTractors` 导入
- **影响文件**：`packages/engine/src/ai/index.ts`

### CLI 适配新 engine API
- 重写 `packages/cli/src/index.ts`：函数名对齐（`cardPointsFromRank` as `cardPoints`，`isPointRank` as `isPointCard`），导入显式指定 `Suit`、`Rank`，移除废弃的 `dealCards` 导入
- 新建 `tsconfig.json`（cli、utility）支持类型检查
- **影响文件**：`packages/cli/src/index.ts`、`tsconfig.json`、`packages/utility/tsconfig.json`

### 验证
- 71 项测试全部通过
- Engine 编译无错误
- CLI 启动正常

## 2026-07-01 21:02

### 清理旧 engine 文件
- **删除**：旧 `types/card.ts`、`types/game.ts`、`types/play.ts`、`model/card.ts`、`model/deck.ts`、`model/rank.ts`、`rules/comparison.ts`、`rules/tractor.ts`、`rules/validation.ts`、`game/state.ts`（共 10 个文件）。
- **更新**：`ai/index.ts` 和 `model/serialize.ts` 改为从新 `types.ts` 和 `model.ts` 导入。
- **更新**：`serialize.ts` 中 ComboClass 的序列化适配新的 `tractors` 数组字段。
- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/model/serialize.ts`

## 2026-07-01 20:55

### comparing/index.ts: replace LeadType with ComboClass['type']
- **重构**：移除内联的 `LeadType` 类型别名和 `determineLeadType()`。
- **重构**：移除 `isPair()` 和 `isTractor()` 内联函数。
- 改用 `getLeadType()` 委托 `classify()` from pattern 模块。
- `leadType` 现在类型为 `ComboClass['type']`，不再重复定义。
- **影响文件**：`packages/engine/src/comparing/index.ts`

## 2026-06-30 23:43

### 大规模重构：engine 拆分为 10 个纯函数子模块

**新结构**：
- `types.ts` — 统一类型定义（ComboClass 新增 tractors 数组支持多拖拉机）
- `model.ts` — 卡牌工厂、牌组、等级排序、手牌排序
- `dealing/` — 发牌（随机/给定牌组）
- `revealing/` — 亮主/反主（strength: 对大王4 > 对小王3 > 对级牌2 > 单张级牌1）
- `bottom-exchange/` — 扣底策略 + 主牌警告检查
- `leading/` — 领出验证 + 甩牌检测（validateThrow）
- `following/` — 跟出验证（matchPattern 伪代码实现）
- `pattern/` — 牌型检测（classify/detectTractors/findAllPairs，支持跨组拖拉机）
- `comparing/` — 大小比较（compareTwo/determineWinner，完整甩牌+拖拉机比较逻辑）
- `scoring/` — 得分管道（一墩得分、抠底倍率、闲家累积、升级规则）

**升级规则修正**：
- 0=大光(+3)，5-35=小光(+2)，40-75=保级(+1)，80-115=上台(0)，≥120=每40分台阶+1级(不封顶)

**抠底倍率**：
- 单张×2，对子×4，拖拉机(n对)×2^(n+1)，甩牌取子牌型最高倍率

**庄家轮换**：
- 只有闲家≥80才下台，<80守庄。gameLoop 独立追踪 TeamAC/TeamBD 级别。

**新增 utility 包**：
- `compact.ts` — JSON→紧凑文本转换工具（`shortCard`/`compactRound`/`compactMatch`/`convertFile`）

**测试**：71 个新测试覆盖全部新模块（revealing/pattern/leading/following/comparing/scoring/throw-validation）。

**影响文件**：packages/engine/src/ 全面重构，新增 packages/utility/，删除旧 test 文件。

## 2026-06-28 23:56

### 计分规则重写 + 庄家轮换修正
- **计分规则**：0 分=大光(庄+3)，1-35=小光(庄+2)，40-75=保级(庄+1)，80-115=上台不升级，≥120=上台每 40 分台阶多升 1 级(不封顶)。
- **庄家轮换**：只有闲家 ≥80 才下台，否则守庄。
- **两队级别独立追踪**：`gameLoop` 分别追踪 TeamAC 和 TeamBD 的级别，结束条件为任意一方超过 A(14)。
- **影响文件**：`packages/engine/src/game/state.ts` — `computeLevelChange()`
- **影响文件**：`packages/cli/src/index.ts` — `gameLoop()`、`showRoundResult()`
- **影响文件**：`packages/cli/src/test-run.ts` — 庄家轮换逻辑

## 2026-06-28 23:00

### AI 主牌跟牌策略：默认出最小，仅必要时出大
- **修复**：`aiFollowTrumpOnly` 的主牌排序从降序改为升序（弱牌优先）。单张主牌跟牌时先尝试最小能盖过的，盖不过出最小；多张跟牌时优先匹配最小拖拉机/对子。
- 消除了「浪费大王跟大王」的问题——AI 现在只在需要盖过对方时才出强牌。
- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-06-28 22:45

### 连续对局 + 观战完整比赛流程
- **新增**：`gameLoop()` — 单局结束后自动进入下一局循环。
- **人类模式**：每局结束显示升级结果，询问「继续下一局？」（回车默认继续，n 退出）。只要人类都同意，可无限进行。
- **观战模式**：自动连续对局直至一方超过 A（14→15），无需人工干预。全程数据导出到单个 `saves/match-<时间戳>.json` 文件。
- **移除**：`startNewRound()` 内部重复调用 `showRoundResult`，统一由 `gameLoop` 管理。
- **影响文件**：`packages/cli/src/index.ts` — `main()`、`gameLoop()`、`showRoundResult()`、`sleep()`

## 2026-06-28 21:33

### AI 跟牌策略改进
- **规则 1**：跟牌时发现自己盖不过已出最大牌→出最小牌保留大牌。
- **规则 2**：跟牌时队友（同墩第二个玩家）已最大→安全垫分牌（优先出分牌）。
- **引擎**：`aiFollowPlay()` 新增可选参数 `bestSoFar` 和 `myIdx`，分发到 `aiFollowSingle`、`aiFollowMulti`、`aiFollowTrumpOnly` 子函数。
- **CLI**：新增 `computeBestSoFar()`，在 AI 跟牌和提示时传入当前墩最优信息。
- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/cli/src/index.ts`

## 2026-06-28 21:09

### 人类玩家数量解析修复
- **修复**：输入 0 个人类玩家时，`parseInt("0") || 1` 把 `0` 当作 falsy 退到默认值 1，导致观战模式下仍然出现「玩家1」。
- 改为 `isNaN(parsed) ? 1 : Math.max(0, Math.min(4, parsed))`。
- **影响文件**：`packages/cli/src/index.ts`

## 2026-06-28 21:05

### 观战模式自动存档
- **新增**：4AI全自动对局结束后，自动 dump 到 `saves/shengji-auto-<时间戳>.json`，便于复盘。
- 新游戏和读档继续两种路径均覆盖。
- **影响文件**：`packages/cli/src/index.ts` — `autoDumpIfSpectator()`

## 2026-06-28 21:01

### 手牌数不等的防御性处理
- **修复**：最后一墩AI空手牌出牌 + `/hint` 崩溃的问题。根因是引擎未强制要求每墩后四家手牌数相等。
- **引擎**：`resolveTrick()` 新增不变式检查——每墩结算后检查四家手牌数是否相等，不等则提前结束本轮以避免级联崩溃。
- **CLI**：`doPlayPhase()` 每墩开始前检查全员手牌是否为空，提前退出循环。
- **CLI**：`showHint()` 对 `trickPlays` 为空或首张卡缺失增加 guard，避免 `cards[0]` 访问崩溃。
- **影响文件**：`packages/engine/src/game/state.ts`、`packages/cli/src/index.ts`

## 2026-06-28 20:35

### 主牌领出必须跟主牌（规则修复）
- **修复**：领出主牌（无论几张）时，跟牌者如果有主牌就必须跟主牌，不能垫副牌。之前只检查了多张（对子/拖拉机）的情况，单张主牌领出时漏检。
- **引擎验证**：`leadIsTrumpLead` 分支移到最前面，单张主牌领出时如果玩家有主牌但未出主牌则拒绝。
- **AI 跟牌**：主牌领出时优先用最小能盖过的主牌，盖不过也出最小主牌，只有真正无主牌时才垫副牌。
- **新增测试**：`trump-lead.test.ts` — 3 项测试（拒绝非主牌跟牌、非主牌领出时允许主杀、真无主牌时允许垫牌）
- **影响文件**：`packages/engine/src/game/state.ts` — `playCards()` 验证顺序
- **影响文件**：`packages/engine/src/ai/index.ts` — `aiFollowPlay()` 主牌领出分支

## 2026-06-28 20:22

### 存档/读档功能
- **新增**：`/dump` 调试命令，将当前对局导出到 `saves/` 目录（JSON 格式）。
- **新增**：启动时自动扫描 `saves/` 目录，列出可用存档，可选择导入。
- **新增**：读档时可选择从第几墩继续（回放或修复）。
- **引擎**：新增 `serialize` / `deserialize` / `resumeFromTrick` 函数。
- **影响文件**：`packages/engine/src/model/serialize.ts`（新增）
- **影响文件**：`packages/engine/src/index.ts`
- **影响文件**：`packages/cli/src/index.ts` — `main()`、`handleDump()`、`getSaveFiles()`

## 2026-06-28 20:15

### 闲家（攻击方）得分修正
- **修复**：引擎用 `dealerIndex`（发牌轮庄）计算攻击方团队，导致亮主/叫主玩家与发牌轮庄不是同一人时得分算错。改为用 `trumpDeclaration.declarerIndex` 计算防御方和攻击方。
- **新增测试**：`Scoring: attacker points use declarer team` — P1 叫主为庄家，P2（攻击方）赢得含 ♠5♠5（10 分）的墩，验证 `attackerPoints` 正确 = 10。
- **影响文件**：`packages/engine/src/game/state.ts` — `resolveTrick()`、`endRound()`
- **影响文件**：`packages/cli/src/index.ts` — `showScoreDetail()`
- **影响文件**：`packages/cli/src/test-run.ts` — level change 计算

## 2026-06-28 19:58

### 引擎比较逻辑修复
- **修复**：非主牌同花色之间现在正确比较 rank，高牌赢低牌（之前错误地将所有非主牌视为「垫牌」直接判先出者赢）。
- **修复**：非主牌跟领出花色 vs 垫其他花色，跟牌者胜。
- **新增测试**：`higher pair beats lower pair in same non-trump suit`（level=2）
- **新增测试**：`pair beats non-pair in same non-trump suit`
- **影响文件**：`packages/engine/src/game/state.ts` - `comparePlays()`

### AI 跟牌策略优化
- **修复**：无法匹配领出牌型时，改为出最小的牌（保留大牌），优先垫非分牌。
- **修复**：对子跟牌补单牌时，改为出最小单牌。
- **新增测试**：`AI plays smallest cards when cannot match pair pattern`
- **新增测试**：`AI discards smallest non-point when void in lead suit`
- **影响文件**：`packages/engine/src/ai/index.ts` - `aiFollowMulti()`

## 2026-06-28 19:27

### 扣底庄家手牌修正
- **修复**：人类庄家扣底时手牌只有25张的问题。现在先合并底牌（25+8=33张），展示后再选8张扣入，剩余25张。
- **影响文件**：`packages/cli/src/index.ts` - `doBottomExchange()`

### CLI 人类出牌鲁棒性
- 出牌输入支持空格分隔编号（如 `5 8`）
- 出牌前显示已选牌和张数
- 非领出时提示需跟牌张数
- 引擎拒绝时打印原因，回到选牌循环
- AI 出牌加三层降级：补/裁张数 → 手牌前N张 → 单张 → 跳过

## 2026-06-28 17:52

### 亮无主规则修正
- **修复**：必须对王（两张大王或两张小王）才能亮无主，一张大王+一张小王不能亮。
- **影响文件**：`packages/engine/src/game/state.ts`、`packages/engine/src/ai/index.ts`

### 主牌领出跟牌逻辑修正
- **修复**：NT 或花色主模式下，领出全是主牌时，跟牌者无需跟花色，但需匹配牌型（对子/拖拉机）。
- **引擎**：`state.ts` 增加 `leadIsTrumpLead` 判断
- **AI**：`aiFollowTrumpOnly()` 重写，支持对子/拖拉机匹配

### 卡牌 ID 去重
- **修复**：两副牌的同张牌（两个♠A）现在有唯一 ID（`S-14-0`, `S-14-1`），不再误判为重复出牌。
- **影响文件**：`packages/engine/src/model/deck.ts`

### findPairs 修复
- **修复**：NT 模式下不同花色的级牌不再误判为对子，增加 suit 检查。
- **影响文件**：`packages/engine/src/game/state.ts`

### 回合结束判定
- **修复**：改为「所有手牌出完」而非固定25墩。
- **影响文件**：`packages/engine/src/game/state.ts`

### 引擎比较逻辑简化
- 去除无意义的 suit 判断，主牌 vs 主牌用 effective rank，副牌 discarding 先出者胜。
- **影响文件**：`packages/engine/src/game/state.ts` - `comparePlays()`

## 2026-06-28 13:00

### 项目初始化
- Monorepo 结构（engine + client + cli）
- 双升引擎核心：Card 模型、Deck、等级排序、拖拉机检测、牌型比较、跟牌验证
- 状态机：发牌→亮主→扣底→出牌→算分
- AI 规则引擎：亮主、扣底、领出、跟牌
- React 前端：牌桌布局、牌面渲染、调试面板
- CLI 版本：交互式人类/AI 混战 + 调试命令（`/hand`, `/history`, `/score`, `/hint`）
