# Changelog

## 2026-06-28 13:00

### 项目初始化
- Monorepo 结构（engine + client + cli）
- 双升引擎核心：Card 模型、Deck、等级排序、拖拉机检测、牌型比较、跟牌验证
- 状态机：发牌→亮主→扣底→出牌→算分
- AI 规则引擎：亮主、扣底、领出、跟牌
- React 前端：牌桌布局、牌面渲染、调试面板
- CLI 版本：交互式人类/AI 混战 + 调试命令（`/hand`, `/history`, `/score`, `/hint`）

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

## 2026-06-28 22:45

### 连续对局 + 观战完整比赛流程
- **新增**：`gameLoop()` — 单局结束后自动进入下一局循环。
- **人类模式**：每局结束显示升级结果，询问「继续下一局？」（回车默认继续，n 退出）。只要人类都同意，可无限进行。
- **观战模式**：自动连续对局直至一方超过 A（14→15），无需人工干预。全程数据导出到单个 `saves/match-<时间戳>.json` 文件。
- **移除**：`startNewRound()` 内部重复调用 `showRoundResult`，统一由 `gameLoop` 管理。
- **影响文件**：`packages/cli/src/index.ts` — `main()`、`gameLoop()`、`showRoundResult()`、`sleep()`

## 2026-06-28 23:00

### AI 主牌跟牌策略：默认出最小，仅必要时出大
- **修复**：`aiFollowTrumpOnly` 的主牌排序从降序改为升序（弱牌优先）。单张主牌跟牌时先尝试最小能盖过的，盖不过出最小；多张跟牌时优先匹配最小拖拉机/对子。
- 消除了「浪费大王跟大王」的问题——AI 现在只在需要盖过对方时才出强牌。
- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-06-28 23:56

### 计分规则重写 + 庄家轮换修正
- **计分规则**：0 分=大光(庄+3)，1-35=小光(庄+2)，40-75=保级(庄+1)，80-115=上台不升级，≥120=上台每 40 分台阶多升 1 级(不封顶)。
- **庄家轮换**：只有闲家 ≥80 才下台，否则守庄。
- **两队级别独立追踪**：`gameLoop` 分别追踪 TeamAC 和 TeamBD 的级别，结束条件为任意一方超过 A(14)。
- **影响文件**：`packages/engine/src/game/state.ts` — `computeLevelChange()`
- **影响文件**：`packages/cli/src/index.ts` — `gameLoop()`、`showRoundResult()`
- **影响文件**：`packages/cli/src/test-run.ts` — 庄家轮换逻辑

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

## 2026-07-01 20:55

### comparing/index.ts: replace LeadType with ComboClass['type']
- **重构**：移除内联的 `LeadType` 类型别名和 `determineLeadType()`。
- **重构**：移除 `isPair()` 和 `isTractor()` 内联函数。
- 改用 `getLeadType()` 委托 `classify()` from pattern 模块。
- `leadType` 现在类型为 `ComboClass['type']`，不再重复定义。
- **影响文件**：`packages/engine/src/comparing/index.ts`

## 2026-07-01 21:02

### 清理旧 engine 文件
- **删除**：旧 `types/card.ts`、`types/game.ts`、`types/play.ts`、`model/card.ts`、`model/deck.ts`、`model/rank.ts`、`rules/comparison.ts`、`rules/tractor.ts`、`rules/validation.ts`、`game/state.ts`（共 10 个文件）。
- **更新**：`ai/index.ts` 和 `model/serialize.ts` 改为从新 `types.ts` 和 `model.ts` 导入。
- **更新**：`serialize.ts` 中 ComboClass 的序列化适配新的 `tractors` 数组字段。
- **影响文件**：`packages/engine/src/ai/index.ts`、`packages/engine/src/model/serialize.ts`

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

## 2026-07-02 00:20

### 跟牌验证修复：主牌不足时必须出全部主牌
- **修复**：领出多张主牌时，跟牌者主牌数不足领出张数的场景，之前完全跳过了主牌检测（`trumpInHand.length >= leadCards.length` 条件为 false 就直接放行），导致人类玩家可以用全副牌绕过规则。
- **修复**：改为 `mustPlay = Math.min(trumpInHand.length, leadCards.length)`，手上有几主牌就必须出几主牌，不够的部分才能用副牌填补。
- **新增测试**：`partial trump — must play all available trump when lead is multi-trump`（3张主牌面对4张主牌领出，打4张副牌被拒）
- **新增测试**：`partial trump — allowed when all available trump are played`（3主+1副正确通过）
- **影响文件**：`packages/engine/src/following/index.ts`、`__tests__/following.test.ts`

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

**影响文件**：`packages/engine/src/following/index.ts`、`__tests__/following.test.ts`

### 新增 26 项跟牌测试
- **对牌领出**（5）：足够同花色有对/无对、短花色有对/无对、缺花色
- **拖拉机领出非主牌**（6）：精确匹配、长截取、无拖拉机有对、无对无对、短花色、短花色有对
- **拖拉机领出主牌**（3）：短主牌、足够主牌精确匹配、无主牌
- **甩牌纯单牌**（3）：足够、短花色、缺花色
- **甩牌对+单**（4）：足够有对、足够无对、短有对、短无对
- **甩牌拖拉机+单**（3）：足够有拖拉机、足够无拖拉机有对、短有拖拉机
- **甩牌拖拉机+对**（2）：足够匹配拖拉机+对、无拖拉机全补对子
- 原有 7 项保留至 basic 分组，总计 33 项测试
