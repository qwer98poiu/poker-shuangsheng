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

## 2026-07-06 19:57

### 手牌排序优化：同 rank 同组按花色 S-H-C-D 展示

`sortHand` 新增花色 tiebreaker：同组同 rank 的牌（如副级牌 ♥2♣2♠2♥2）现在按 ♠♥♣♦ (S-H-C-D) 顺序展示，而非之前的随机顺序。

- **影响文件**：`packages/engine/src/model.ts`

## 2026-07-06 20:14

### 输入校验 + 测试：拒绝无效手牌编号

`parseCards` 重构为独立模块 `cli/src/parse.ts`，新增完整参数校验：所有编号必须为数字且在范围内。无效编号直接拒绝并提示。

**新增 14 项 CLI 测试**（`cli/src/__tests__/parse.test.ts`）：
- 3 项有效编号（单个、多个、最大号）
- 空输入返回空
- null trump 配置可用
- 5 项无效编号（超出范围、负数、非数字、混合、极大值）
- 空手牌
- 扣底场景（33 张手牌，8 张选择）

- **影响文件**：`packages/cli/src/parse.ts`（新增）、`packages/cli/src/__tests__/parse.test.ts`（新增）、`packages/cli/src/index.ts`

## 2026-07-06 20:18

### 调试模式恢复原有出牌提示

调试模式下提示恢复为「编号或 /debug 命令:」，因为调试模式支持的命令不止 `/hint` `/score` `/bottom`。非调试模式维持限制版提示。

- **影响文件**：`packages/cli/src/index.ts`

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

## 2026-07-07 23:37

### AI 对牌跟牌优化：优先出非分对牌

`aiFollowMulti` 的无拖拉机对牌填充分支和标准对牌跟牌分支，对牌排序均改为 `pairSortAsc`：非分对牌优先、同组取最小有效 rank。避免盲目垫分牌对（如 ♦10♦10），保留分牌对到后续墩收割。

新增通用 `pairSortAsc` 辅助函数（已在 `aiFollowTrumpOnly` 中复用）。

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

## 2026-07-08 00:02

### 缺门多张毙牌时匹配领出牌型：用主牌对子/拖拉机毙

多张缺门时，AI 现在优先用主牌对子/拖拉机匹配领出牌型，而非盲目取最强主单牌：
- 领出对牌 → 用最小非分主牌对子毙（`用主牌对子毙`）
- 领出拖拉机 → 用最小主牌拖拉机毙（`用主牌拖拉机毙`）
- 领出单牌 → 用最强主牌毙

- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-11 22:15

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

## 2026-07-11 22:16

### computeBestSoFar 越界崩溃修复

`computeBestSoFar` 在只有 2-3 家出牌时调用了 `determineWinner`，该函数固定遍历 4 家导致 `plays[i]` 为 `undefined` 引发 `TypeError`。
修复：出齐 4 家时用 `determineWinner`，未出齐时直接用 `compareTwo` 遍历已有出牌。

- **影响文件**：`packages/engine/src/ai/context.ts`

## 2026-07-11 22:21

### 调试模式异常转储

调试模式下 `doPlayPhase` 捕获 `doPlayerTurn` 抛出的异常，打印错误信息和调用栈，并将完整游戏状态（手牌、出牌历史、主牌配置、分数等）序列化为 JSON 保存到 `crashes/` 目录，便于排查。

- **影响文件**：`packages/cli/src/index.ts`

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

## 2026-07-12 17:12

### 甩牌检测：单张检查改为遍历全部最坏情况牌

单张可甩判断之前只检查 `worstComps.singles`，但对手可以拆对出单张。改为遍历全部 worstCase 牌（包括在对子/拖拉机中的牌），正确判断是否有任何对手牌能盖过我方单张。

修复前 KKQQ10 被建议甩 5 张（含被 A 挡住的 10），修复后正确返回 4 张（仅 KKQQ 拖拉机）。

**新增 2 项测试**（ai-throw-detector.test.ts：40 项）：
- KKQQ10 → 4 张可甩（KKQQ 拖拉机），10 被 A 挡住
- AAKK → 4 张可甩（AAKK 拖拉机）

- **影响文件**：`packages/engine/src/ai/throw-detector.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-throw-detector.test.ts`

## 2026-07-12 18:30

### 第二/第四家跟牌最大牌型时应附加尽量不加分

新增 `isMaxPattern` 辅助函数（单张/对子大牌、含拖拉机、甩牌）。第二/第四家不能盖过最大牌型领出时，出牌理由附加 `（盖不过，尽量不加分）`。

修复分支：`followOffSuitSingle` 不能盖过、`followOffSuitMulti` 兜底、`followOffSuitThrow` 部分填充、标准短牌填充，共 4 处。

**新增 2 项测试**（ai-follow.test.ts：55 项）：
- AI-2 短牌+第二家+甩牌 → 避用分牌填充
- AI-4 第四家+甩牌 → 避用分牌

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 18:36

### 无拖拉机填对子时补充位置感知理由和排序

`followOffSuitMulti` 的无拖拉机填对子分支之前硬编码了理由和填充排序，导致第二家加分、第三家没分可加时缺少标注。

修复后填充排序根据位置调整（第二/四家避分、第三家加分），理由通过 `annotateReason` 生成。

**新增 2 项测试**（ai-follow.test.ts：57 项）：
- 第二家无拖拉机填对子 → 避用分牌，附加尽量不加分
- 第三家无拖拉机填对子但没分 → 附加但没分可加

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 18:46

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

## 2026-07-12 19:08

### 短牌填充避免浪费常主（级牌）

`fillerSort` 和 `discardSort` 新增级牌降权：同优先级主牌中，非级牌优先于级牌（常主）。修复前全主牌填充按 rank 升序 → S-2(常主) 排在最前被浪费；修复后非级牌优先 → S-3 排在 S-2 前面。

discardSort 签名新增可选 `config` 参数，各调用点传入 ctx。

**新增 1 项测试**（ai-follow.test.ts：59 项）：
- 全主牌填充选 S-3 不选 S-2(常主) 和 S-10(分牌)

- **影响文件**：`packages/engine/src/ai/utils.ts`、`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 22:30

### 甩牌 void 毙牌修复 + 毙牌理由统一 + 对子跟牌理由区分同花色出大/出小

**甩牌 void 毙牌修复**：`followOffSuitThrow` void 分支之前直接取前 N 张主牌乱毙，不检查是否匹配甩牌的对子/拖拉机牌型。改为委托 `trumpKill`，确保毙牌出牌能正确匹配领出牌型，不匹配时弃牌。

**毙牌理由统一**：毙牌理由统一为两种——首毙用 `用主牌毙`，盖过前人毙牌用 `盖毙`。去掉 `用主牌对子毙`、`用主牌拖拉机毙` 等细分理由。

**对子跟牌理由**：对子跟牌分支新增 `canBeat` 判断，能盖过用 `同花色出大`，不能盖过用 `同花色出小`。加分时 base reason 改为 `同花色出小`（队友已大无需盖过）。

**新增 1 项测试**（ai-follow.test.ts：60 项）：
- 甩牌两对 + void + 主牌对子不够 → 弃牌，不谎称毙牌

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-12 23:15

### 吊主单张跟牌：用 bestSoFar 而非 leadMax 判断能否盖过

`followTrumpLead` 和 `followNTTrumpLead` 单张分支之前用 `leadMax`（领出牌 rank）判断是否盖过，忽略前面玩家已经出更大的牌。改为用 `bestSoFar` 的当前最大值 `currentMax`，正确判断能否盖过当前最佳。

修复前：P0 吊 S-7，P1 跟 S-9(盖过)，P2 的 S-8 仍被判定为"能盖过"（S-8 > S-7），实际 S-8 < S-9 盖不过。修复后正确判断。

**新增 2 项测试**（ai-follow.test.ts：62 项）：
- 第三家 S-8 不能盖过已有 S-9 → 用最小能盖过的 S-10
- 第三家全部盖不过 → 出最小牌

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

## 2026-07-15 20:30

### 取消"用拖拉机跟牌"理由，统一为同花色出大/出小

**跟拖拉机理由统一**：
- `followTrumpLead` 和 `followOffSuitLead` 中拖拉机匹配分支，固定的 `用拖拉机跟牌` 改为基于 `canBeat` 动态判断 `同花色出大` / `同花色出小`
- 与对子、单张跟牌的理由体系保持一致

**策略文档修正**：
- `strategy-rules.md` 2.3 节移除「不能匹配但能盖过」的矛盾描述（不匹配拖拉机就无法盖过）
- 理由列表中移除 `用拖拉机跟牌`

- **影响文件**：`packages/engine/src/ai/index.ts`

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

## 2026-07-16 23:00

### 新增 /tracker 命令，/hand 支持显示所有手牌

**`/tracker [n]`（别名 `/tr`）**：显示常主记牌器（仅无主模式 + debug 模式）：
- 指定玩家（0-3）：从该玩家视角显示手牌常主、各位置可能常主（按 suit-rank 分组）、汇总行（无主标记、分布确定、王控制）、详情行（有对、可能有王）、计数行（对手常主下限、剩余王、张数范围）
- 不指定：循环显示 4 个玩家的记牌器

**`/hand [n]` 增强**：不带参数时循环显示全部 4 个玩家的手牌

- **影响文件**：`packages/cli/src/index.ts`

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

**新增 exhaustive 逐卡验证**：4 视角 × 3 玩家 × 12 常主 = 144 次逐卡归属检查（含底牌共 180 次），出牌前后各一轮。

**新增 3 项测试**（ai-nt-tracking.test.ts：41 项），415 项通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

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

## 2026-07-18 11:40

### 拖拉机跟牌修复：扫描能盖过的拖拉机

**问题**：`tryMatchTractorSlots` 选取最短/最小的拖拉机，若不能盖过则直接放弃，不检查其他拖拉机能否盖过。

**修复**（`matchTrumpPattern`、`followOffSuitMulti`、`trumpKill`）：所选拖拉机不能盖过时，反向排序重试找能盖过的。

**影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-18 12:00

### 修正：不指定花色时不应跳过人类亮主

**问题**：`doReveal` 的 `skipPlayer` 参数始终设为 `forcedDeclarer`，导致未指定花色时（不自动亮主）也跳过人类玩家的亮主提示。

**修复**：仅在 `autoReveal` 为 true（明确指定了花色）时才跳过该玩家。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-18 12:15

### 修正：缺门且队友已大可加分时不应毙牌

**问题**：缺门时无条件进 `trumpKill`，即使队友已经赢了。例如队友领出副牌 A（最大），对手跟小牌，自己是第三家缺门——应通过垫分牌加分而非浪费主牌毙。

**修复**（`followOffSuit` void 分支）：缺门时先检查 `tmWin && canAddPoints`——队友已大可安全加分则垫分牌；否则正常毙牌。

**影响文件**：`packages/engine/src/ai/index.ts`

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

## 2026-07-18 16:55

### 修正 isOnlyLegalPlay + 对子跟牌分支缺少 shouldAvoid

**问题 1**：甩牌含对子+单张时，`isOnlyLegalPlay` 误判为唯一可出（pairCount=1 且只有 1 对），忽略多张单张可选。

**问题 2**：`followOffSuitMulti` 对子跟牌分支缺少 `shouldAvoid` 逻辑，第二家/第四家对子盖不过时不标注"尽量不加分"。

**修复**：
- `isOnlyLegalPlay`：pairCount=1+pairs.length=1 时，增加 leadLen===pairSlots 或 leadSuitCards===leadLen 的精确条件
- `followOffSuitMulti`：对子跟牌分支增加 `shouldAvoid` 判断，第二家+max pattern+!tmWin 或第四家+!tmWin 时标注 avoid

**新增 1 项测试**（ai-follow.test.ts：84 项），431 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
## 2026-07-18 17:10

### 吊主单张盖不过分支增加 shouldAvoid + 弃分配非分优先

**问题 1**：`followTrumpLead`/`followNTTrumpLead` 单张盖不过分支始终不标注"尽量不加分"。

**问题 2**：shouldAvoid 时选牌应优先非分牌（`discardSort(false)`），否则最小牌是分牌时不必要的送了分。

**修复**：shouldAvoid 时用 `discardSort(false)` 排序，标注 `intent='avoid'`。

**新增 1 项测试**（ai-follow.test.ts：85 项），432 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-18 17:30

### 统一跟牌理由，消除硬编码标注和死代码

**问题**：多个跟牌分支绕过 `annotateReason` 直接硬编码标注，导致理由不一致。

**修复**：

1. `discardNonTrump`：`垫牌（队友已大，尽量加分）` 和 `垫牌(含主牌)` 改为走 `annotateReason('垫牌', ...)`
2. `followTrumpThrow`：`垫主牌` 改为 `同花色出小`（跟主牌就是跟同花色）+ `annotateReason` 标注
3. `padWithDiscards`：`主牌不足，补垫牌` 与 `主牌不够，垫副牌` 统一为后者
4. 删除 `followTrumpThrow` 中 `padWithDiscards` 的死代码调用

- **影响文件**：`packages/engine/src/ai/index.ts`

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

## 2026-07-19 11:59

### 修复 checkTractorOrThrowFollow：大拖拉机可满足小拖拉机要求

**问题**：级牌跳跃导致 detectTractors 合并拖拉机时（如 level=6 时 88775544 合并为 4 对拖拉机），validateFollow 的 `checkTractorOrThrowFollow` 要求每个拖拉机对数精确匹配，拒绝大拖拉机满足小要求的合法跟牌。

**修复**：替换精确匹配为贪心分配——一个 N 对的拖拉机可满足 ≤N 对的要求，剩余对数计入 fill。例如 [4] 可满足 [2, 2]（分别分配 2+2），[5] 可满足 [3, 2]（分配 3+2，剩余 0）。

**新增 2 项测试**（ai-follow.test.ts：92 项）+ **6 项 validation 测试**（following.test.ts：53 项），445 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-19 12:29

### 拖拉机跟牌增加加分/避分排序

**问题**：`tryMatchTractorSlots` 始终选最小拖拉机填充，不考虑加分/避分策略。第三家队友已大时应优先含分牌，第四家应避免含分牌。

**修复**：`tryMatchTractorSlots` 新增 `pointsStrategy` 参数（'add' | 'avoid'）。add 时含分拖拉机优先，avoid 时含分拖拉机置后。`matchTrumpPattern` 和 `followOffSuitMulti` 两个调用方在选取前计算策略并传入。`trumpKill` 不改（有自己的抢分逻辑）。

**新增 2 项测试**（ai-follow.test.ts：94 项），447 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 12:38

### 甩牌跟牌理由统一为垫同花色

**问题**：领出是甩牌时，跟牌理由用了"同花色出大/出小"，不符合甩牌语义——甩牌是多牌型混合，跟出方匹配牌型即可，无所谓盖过。

**修复**：`matchTrumpPattern` 和 `followOffSuitMulti` 中检测 `leadCombo.type === 'throw'`，甩牌跟牌理由统一用"垫同花色"（纯拖拉机仍用出大/出小）。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 12:57

### 简化标注文字：尽量加分→加分，尽量不加分→不加分

尽量少加分保持不变。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-19 13:18

### 移动 isOnlyLegalPlay 到 following 模块，AI 增加唯一可出快速路径

`isOnlyLegalPlay` 是跟牌规则而非 AI 策略，移至 `following/index.ts` 并导出。签名简化为 `(leadSuitCards, leadLen, leadCombo, config)`，移除未使用的参数。

AI 策略在 `_aiFollowPlay` 和 `followTrumpLead` 中先调用该判断：若同花色张数等于领出张数且唯一可出，直接打出排序后的强制牌，跳过策略逻辑。447 项通过。

- **影响文件**：`packages/engine/src/following/index.ts`
- **影响文件**：`packages/engine/src/ai/index.ts`

## 2026-07-19 13:33

### following.test.ts 增加唯一可出测试（DA+HA+KK + 10109988 主牌领出）

6 pairs + 2 singles → 唯一可出；多加一对大王 → 不唯一。449 项通过。

- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-19 13:41

### 移动 isOnlyLegalPlay 测试从 ai-follow 到 following

`isOnlyLegalPlay` 已移至 following 模块，相关测试也应跟随。5 项测试从 `ai-follow.test.ts`（89 项）移到 `following.test.ts`（58 项），改为直接调用 `isOnlyLegalPlay()`。

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
- **影响文件**：`packages/engine/src/__tests__/following.test.ts`

## 2026-07-19 14:00

### 新增 AI 策略文档 STRATEGY.md

面向普通玩家的完整出牌策略文档，包含领出、跟牌、扣底、NT 模式的策略表格和理由速查表。

- **新增文件**：`packages/engine/src/ai/STRATEGY.md`

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

## 2026-07-20 22:23

### 修复 discardSort 加分模式下降序排列误垫大牌

**问题**：`discardSort(tmWin=true)` 对所有卡牌统一降序排列。初衷是加分时优先出 K/10（大分）而非 5（小分），但副作用是非分牌也降序，导致 ♥A 被优先垫掉而非保留到后续墩次。

**修复**：降序仅对分牌生效（`isPointRank(a) && isPointRank(b)`），非分牌始终升序（优先出小，保留大牌）。

**新增 2 项测试**（ai-follow.test.ts：95 项），455 项通过。

- **影响文件**：`packages/engine/src/ai/utils.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
- **影响文件**：`CLAUDE.md`

## 2026-07-20 22:44

### 修复主牌跟牌 fast path 未标注"唯一可出"

**问题**：`followTrumpLead` fast path 正确调用 `isOnlyLegalPlay` 判断唯一可出，但传给 `annotateReason` 的 `leadSuitCards` 是空数组 `[]`。`annotateReason` 内部重新检查 `isOnlyLegalPlay` 时因空数组直接返回 false，导致主牌唯一可出时缺失标注。

**修复**：fast path 传递 `myTrump` 作为 `leadSuitCards`，使 `annotateReason` 的主牌唯一可出检测正常生效。

**新增 1 项测试**（ai-follow.test.ts：96 项），456 项通过。

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

## 2026-07-20 23:22

### 修复 NT 吊主导致程序崩溃（`shouldAvoid` 未定义）

**问题**：`followNTTrumpLead` 单张盖不过分支使用了 `shouldAvoid` 变量但从未声明，导致 `ReferenceError` 崩溃。该变量在 `followTrumpLead` 中有声明，但 NT 分支遗漏。

**修复**：在 `followNTTrumpLead` 的盖不过分支前添加 `shouldAvoid` 声明，逻辑与 `followTrumpLead` 一致。

**新增 1 项测试**（ai-follow.test.ts：99 项），463 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-21 00:01

### 优化记牌器可能常主显示：牌面格式替换原始 ID

**问题**：记牌器中 `可能常主` 显示原始 ID 格式（如 `S-2`、`C-14`、`J-16`），不够直观。

**修复**：新增 `possibleTrumpLabel` 函数，将 `S-2` 转换为 `♠2`、`J-16` 转换为 `JOKER`，与手牌显示风格一致（不带序号）。不影响测试。

- **影响文件**：`packages/cli/src/index.ts`

## 2026-07-21 00:43

### 修复 NT 记牌器所有卡牌追踪信息错误（ID 不匹配）

**问题**：`enumerateNTTrumpIds` 用 `cardId(suit, rank, 0)` 和 `cardId(suit, rank, 1)` 生成追踪 key（如 `J-16-0`、`S-2-1`），但 `createFullDeck()` 用连续递增 idx 创建实牌（小丑 idx=52,106，大丑 idx=53,107）。Phase 1（排除手牌）和 Phase 2（移除已出牌）的 `possibleLocations.has(id)` / `delete(id)` 全部失败，导致记牌器信息全部错误：自己的手牌显示为可能常主、已打出的牌未移除。

**修复**：用 suitRank key 替代全 ID 进行匹配。新增 `countBySuitRank` 辅助函数。Phase 1 和 Phase 2 都采用两步移除：先精确 ID 匹配（兼容测试），再按 suitRank key 移除剩余未知副本。`buildState` 移除不再需要的 `myHandIds`/`bottomIds` 参数。

463 项测试通过。

- **影响文件**：`packages/engine/src/ai/nt-tracking.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-nt-tracking.test.ts`

## 2026-07-21 21:50

### 修复 fast path 用 canBeat 判断理由导致"同花色出大"误报

**问题**：`canBeat` 只比较 max effectiveRank，不检查牌型是否匹配。领出对子、手牌只有两张单牌时，即使单牌 rank 更高也无法盖过对子，但 `canBeat(11 > 5) = true` 误判为"同花色出大"。

**修复**：fast path 改用 `matchPattern` 先检查手牌是否匹配领出牌型。不匹配则理由为"垫同花色"，匹配才用 `compareTwo` 进行牌型感知的 rank 比较。同样修复了主牌跟牌 fast path。

**新增 1 项测试**（ai-follow.test.ts：100 项），464 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

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

## 2026-07-22 00:15

### 修复纯拖拉机被甩牌策略抢先标注为"甩牌"

**问题**：`_aiLeadPlay` 中甩牌策略（Strategy 4）排在拖拉机策略（Strategy 3）之前。当手牌是纯拖拉机（如 ♠J♠J♠10♠10）时，甩牌检测器也判定它能甩，直接返回 `甩♠副牌(4张)`，拖拉机策略没机会执行。

**修复**：`tryLeadThrowOffSuit` 返回前检查 `classify`——如果甩牌组合是纯拖拉机（无多余单牌/对子），改用拖拉机标签。

**新增 1 项测试**（ai-leading.test.ts），474 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-leading.test.ts`

## 2026-07-22 00:33

### 新增回归测试：确认 NT 主对跟牌 filler 不会误垫 joker

**问题**：用户反馈修复垫大王后仍出现垫小王。经分析，`matchTrumpPattern` 对子 fallback 的 filler 排序在前次修复中已改为 `getEffectiveRank` 升序（joker 900 > level 800），逻辑正确。测试以精确场景（NT 模式，第四家，领出 ♣2♣2 对，手牌 joker+♠2+♦2+♥2 无对子）还原，确认 joker 不会被选中。

**新增 1 项测试**（ai-follow.test.ts：103 项），475 项通过。

- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`

## 2026-07-22 23:30

### 修复第三家对手赢墩时缺少"不加分"标注

**问题**：`shouldAvoid` 逻辑只覆盖了第二家（且领出为最大牌型）和第四家（对手赢墩），遗漏了第三家。第三家盖不过时，如果对手已经赢墩，即使随不出牌型也应避分。

**修复**：所有 `shouldAvoid` 位置增加 `position === 'third' && !tmWin` 条件。涉及 `followOffSuit`（短门）、`followOffSuitMulti`（多张 fallback）、`followTrumpLead`、`followNTTrumpLead`、`matchTrumpPattern`、`padWithDiscards` 等共 11 处。

**新增 1 项测试**（ai-follow.test.ts：104 项），476 项通过。

- **影响文件**：`packages/engine/src/ai/index.ts`
- **影响文件**：`packages/engine/src/__tests__/ai-follow.test.ts`
