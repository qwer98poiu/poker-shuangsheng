# Changelog

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

## 2026-06-28 20:15

### 闲家（攻击方）得分修正
- **修复**：引擎用 `dealerIndex`（发牌轮庄）计算攻击方团队，导致亮主/叫主玩家与发牌轮庄不是同一人时得分算错。改为用 `trumpDeclaration.declarerIndex` 计算防御方和攻击方。
- **新增测试**：`Scoring: attacker points use declarer team` — P1 叫主为庄家，P2（攻击方）赢得含 ♠5♠5（10 分）的墩，验证 `attackerPoints` 正确 = 10。
- **影响文件**：`packages/engine/src/game/state.ts` — `resolveTrick()`、`endRound()`
- **影响文件**：`packages/cli/src/index.ts` — `showScoreDetail()`
- **影响文件**：`packages/cli/src/test-run.ts` — level change 计算

## 2026-06-28 20:22

### 存档/读档功能
- **新增**：`/dump` 调试命令，将当前对局导出到 `saves/` 目录（JSON 格式）。
- **新增**：启动时自动扫描 `saves/` 目录，列出可用存档，可选择导入。
- **新增**：读档时可选择从第几墩继续（回放或修复）。
- **引擎**：新增 `serialize` / `deserialize` / `resumeFromTrick` 函数。
- **影响文件**：`packages/engine/src/model/serialize.ts`（新增）
- **影响文件**：`packages/engine/src/index.ts`
- **影响文件**：`packages/cli/src/index.ts` — `main()`、`handleDump()`、`getSaveFiles()`

## 2026-06-28 20:35

### 主牌领出必须跟主牌（规则修复）
- **修复**：领出主牌（无论几张）时，跟牌者如果有主牌就必须跟主牌，不能垫副牌。之前只检查了多张（对子/拖拉机）的情况，单张主牌领出时漏检。
- **引擎验证**：`leadIsTrumpLead` 分支移到最前面，单张主牌领出时如果玩家有主牌但未出主牌则拒绝。
- **AI 跟牌**：主牌领出时优先用最小能盖过的主牌，盖不过也出最小主牌，只有真正无主牌时才垫副牌。
- **新增测试**：`trump-lead.test.ts` — 3 项测试（拒绝非主牌跟牌、非主牌领出时允许主杀、真无主牌时允许垫牌）
- **影响文件**：`packages/engine/src/game/state.ts` — `playCards()` 验证顺序
- **影响文件**：`packages/engine/src/ai/index.ts` — `aiFollowPlay()` 主牌领出分支

## 2026-06-28 21:01

### 手牌数不等的防御性处理
- **修复**：最后一墩AI空手牌出牌 + `/hint` 崩溃的问题。根因是引擎未强制要求每墩后四家手牌数相等。
- **引擎**：`resolveTrick()` 新增不变式检查——每墩结算后检查四家手牌数是否相等，不等则提前结束本轮以避免级联崩溃。
- **CLI**：`doPlayPhase()` 每墩开始前检查全员手牌是否为空，提前退出循环。
- **CLI**：`showHint()` 对 `trickPlays` 为空或首张卡缺失增加 guard，避免 `cards[0]` 访问崩溃。
- **影响文件**：`packages/engine/src/game/state.ts`、`packages/cli/src/index.ts`

## 2026-06-28 21:05

### 观战模式自动存档
- **新增**：4AI全自动对局结束后，自动 dump 到 `saves/shengji-auto-<时间戳>.json`，便于复盘。
- 新游戏和读档继续两种路径均覆盖。
- **影响文件**：`packages/cli/src/index.ts` — `autoDumpIfSpectator()`

## 2026-06-28 21:09

### 人类玩家数量解析修复
- **修复**：输入 0 个人类玩家时，`parseInt("0") || 1` 把 `0` 当作 falsy 退到默认值 1，导致观战模式下仍然出现「玩家1」。
- 改为 `isNaN(parsed) ? 1 : Math.max(0, Math.min(4, parsed))`。
- **影响文件**：`packages/cli/src/index.ts`

## 2026-06-28 21:33

### AI 跟牌策略改进
- **规则 1**：跟牌时发现自己盖不过已出最大牌→出最小牌保留大牌。
- **规则 2**：跟牌时队友（同墩第二个玩家）已最大→安全垫分牌（优先出分牌）。
- **引擎**：`aiFollowPlay()` 新增可选参数 `bestSoFar` 和 `myIdx`，分发到 `aiFollowSingle`、`aiFollowMulti`、`aiFollowTrumpOnly` 子函数。
- **CLI**：新增 `computeBestSoFar()`，在 AI 跟牌和提示时传入当前墩最优信息。
- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/cli/src/index.ts`
