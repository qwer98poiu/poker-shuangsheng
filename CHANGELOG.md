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

## 2026-07-03 00:05

### 测试修正：消除 lead 与 hand 的牌面重复 + 甩牌合法性校验
- **修复**：多组测试中 lead 和 hand 使用了相同的 (suit, rank) 组合，违反每张牌最多出现两次的约束。重分配所有牌面使 lead 和 hand 的 rank 互不重叠。
- **修复**：「甩牌拖拉机+对」的 lead AAKK+QQ 实际上 A-K-Q 连续（14-13-12），被 `classify` 判定为纯 3 对拖拉机而非甩牌。改为 AAKK+1010（10 与 K 不连续，有 J、Q 间隔），使其正确归类为甩牌（tractor + standalone pair）。
- **修复**：「无拖拉机全补对子」测试中 hand 的 8877 在 level=5 下是拖拉机（8-7 连续）。改为 Q-9-6（均不连续）。
- **修复**：「主牌拖拉机必须跟」拒绝用例中 hand 只有 1 张 ♥10 却试图构造 ♥1010 对子。改为 pair + 2 singles 作为拒绝场景。
- 总计 34 项测试，100 项全部通过。
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

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

## 2026-07-04 13:25

### checkTractorOrThrowFollow：拖拉机个数检查提前到循环外
- **重构**：将「已出拖拉机个数 ≥ 理想个数」的检查从 for 循环内提到循环外，与逐个比对连对数的循环分离。
- **影响文件**：`packages/engine/src/following/index.ts`

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
- 梅花主K级：领出小王+方块K+梅花AAQQ7766553322，被 JJ10109988（4对拖拉机）拦截 → 强制出 776655（3对）

- **影响文件**：`packages/engine/src/leading/index.ts`、`packages/engine/src/game/index.ts`、`packages/cli/src/index.ts`、`packages/engine/src/__tests__/leading.test.ts`

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

## 2026-07-05 16:33

### 修复甩牌验证中的跨玩家幻影拖拉机检测

**Bug**：`validateThrow` 和 `resolveThrowFailure` 将所有其他玩家的牌合并后再检测拖拉机/对子，导致跨玩家产生幻影牌型。例如 ♦Q 在 AI-2 手中，♦Q 在 AI-4 手中，♦J♦J 在 AI-2 手中——合并后检测出 QQJJ 拖拉机，实际上任何单个玩家都没有这个拖拉机。

**修复**：改为逐个玩家独立检测。每个其他玩家的手牌分别过滤、分别 extract 组件、分别与领出的子牌型比较。只有单个玩家持有的拖拉机/对子/单牌才能拦截甩牌。

**新增 2 项测试**（`throw-validation.test.ts`）：
- Q+J 分散在多个玩家 → 甩牌通过（无幻影拖拉机）
- 单个玩家持有 QQJJ → 甩牌被拦截

- **影响文件**：`packages/engine/src/leading/index.ts`、`packages/engine/src/__tests__/throw-validation.test.ts`

## 2026-07-05 16:33

### 修复甩牌验证：跨玩家幻影拖拉机

- **修复**：`validateThrow` 和 `resolveThrowFailure` 将所有其他玩家的牌合并后检测，导致 ♦Q（AI-2）+ ♦Q（AI-4）+ ♦J♦J（AI-2）合并出 QQJJ 拖拉机，实际任何单个玩家都没有。改为逐个玩家独立检测。
- **新增测试**：2 项——牌分散多玩家则通过、单个玩家有更高拖拉机则拦截。
- **影响文件**：`packages/engine/src/leading/index.ts`、`packages/engine/src/__tests__/throw-validation.test.ts`

## 2026-07-05 16:58

### 修复 dealer 轮换逻辑：始终从当局庄家计算下局 dealer

**问题**：之前 `gameLoop` 维护独立的 `dealer` 变量，每次增量更新（`dealer + 1` 或 `dealer + 2`），与当局庄家无关。这导致首局亮主者抢走庄家后，下局 dealer 仍从初始发牌者计算，而非从当局的实际庄家计算。

**修复**：`nextDealer` 始终从 `gameState.trumpDeclaration.declarerIndex` 计算，不再沿用旧 dealer 值。首局庄家由亮主结果确定后，后续局 dealer 均由此派生。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-05 17:59

### 概念重命名：dealer → declarer（庄家）

「庄家」和「发牌者」是同一个身份——拿到并处理底牌的人、领出第一墩的人。不存在独立的「发牌人」概念。

**变更**：`GameState.dealerIndex` → `declarerIndex`，`gameLoop(dealerIndex)` → `gameLoop(firstDeclarer)`，`finalize(dealerIndex)` → `finalize(declarerIndex)`，相关参数、注释、序列化字段全部统一。

**新增 5 项完整两局场景测试**：模拟 P0 初始庄家、P2 亮主、庄家保级后 dealer 轮换的完整链路。

- **影响文件**：`packages/engine/src/types.ts`、`packages/engine/src/revealing/index.ts`、`packages/engine/src/game/index.ts`、`packages/engine/src/model/serialize.ts`、`packages/cli/src/index.ts`、`packages/engine/src/__tests__/declarer-rotation.test.ts`

## 2026-07-05 21:45

### 幻影对牌测试：验证逐玩家检测也消除跨玩家幻影对牌

**问题**：甩 A+JJ 时，如果 KK 的两张 K 分属两个不同玩家，合并后会被检测为更高对牌挡住 JJ。

**修复**：之前的逐玩家检测已一并解决此问题（`extractComponents` 对每个玩家独立调用）。新增 2 项测试确认：
- KK 分散两人 → 甩牌通过
- KK 在同一人手中 → 甩牌被拦截

- **影响文件**：`packages/engine/src/__tests__/throw-validation.test.ts`

## 2026-07-05 21:59

### 修复跟牌 vs 垫牌比较：跟牌始终大于垫牌

**Bug**：非主牌领出时，`compareTwo` 未区分跟牌和垫牌，直接通过 `cardGreater` 比较 rank。垫牌的 rank 若大于跟牌则错误胜出（如领出 ♦8，跟 ♦Q 为 12，垫 ♥K 为 13 → ♥K 被判最大）。

**修复**：在 `compareTwo` 中新增 `inLeadGroup` 检查——非主牌领出且双方均无主牌时，跟随领出花色组的一方始终大于垫牌方。

**新增测试**：领出 ♦8，玩家跟 ♦Q、垫 ♥K、跟 ♦3 → 验证 ♦Q 获胜而非 ♥K。

- **影响文件**：`packages/engine/src/comparing/index.ts`、`packages/engine/src/__tests__/comparing.test.ts`

## 2026-07-05 22:15

### 非调试模式 UX 改进

**命令限制**：非调试模式下只保留 `/score`（查看得分）和 `/hint`（出牌建议），其他 debug 命令（`/hand`、`/history`、`/bottom`、`/dump` 等）不再可用。

**甩牌失败提示**：人类玩家甩牌失败时，CLI 显示黄色提示和灰色罚分详情：
- `甩牌失败！强制出: ♦8♦8♦7♦7`
- `→ throw failed — must play longest tractor (2 pairs) (attacker penalty 1/3)`

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-05 22:25

### 非调试模式 UX 优化

**提示文本**：出牌输入提示从「编号或 /debug 命令」改为「编号或/hint查看提示、/score查看目前得分」。

**/score 不暴露底牌**：非调试模式下 `/score` 不再显示底牌内容和底牌分数（保留闲家得分和已拿分数牌）。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-05 23:52

### 调试模式：人类庄家时 AI 在发牌阶段不亮主

当人类玩家（P0）是第一局庄家时（`DEBUG && declarerIndex === 0`），AI 在发牌阶段不主动亮主，等人类在亮主阶段放弃亮主后，AI 才亮主。人类亮主后 AI 仍可反主。

- **影响文件**：`packages/cli/src/index.ts`

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

## 2026-07-06 00:14

### AI 跟牌回归测试：新增 4 项方块主 level=2 真实场景

复现用户反馈的崩溃场景，确保 AI 跟牌始终合法：

1. **主拖拉机 D2D2H2H2** → AI 用对小王+最小主单牌跟牌
2. **甩牌：大王对 + 主拖拉机 D2D2H2H2** → AI 匹配拖拉机槽位 + 填对子
3. **黑桃 AQQ** → AI 有对必跟对
4. **草花 AKK** → AI 有对必跟对

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
