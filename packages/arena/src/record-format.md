# 牌局录制数据集（record）— CLI 与二进制格式 v1

生成用于数据分析的**小局**（每次发牌 + 出牌）数据集；只记录，不做分析。
一手 = 108 张发牌 → 亮主 → 扣底 → 25 墩 → 结算。

> **v1 布局修订（2026-10-27）**：`reveals` 只记录生效亮主并带 `dealIndex`，
> payload 末尾增加 `failedThrows`。旧布局的 v1 录像不兼容，已作废；不要与新
> 录像混读。`FORMAT_VERSION` 仍为 1（旧数据不保留）。

```bash
# 默认：random 分层，1,000,000 手，min(8, cpus) 条链
npm run record

# 小规模单链
npm run record -- --hands 1000 --workers 1 --seed 42

# rules 模式（2..A 循环，无必打）
npm run record -- --hands 10000 --context rules
# 等价（在 packages/arena 下）：npm run arena:record -- --hands 10000 --context rules

# 读数据集（读某手 / 按 context 查询）
npx tsx packages/arena/scripts/record-inspect.ts packages/arena/results/recordings/<runId> --hand 0
npx tsx packages/arena/scripts/record-inspect.ts <runDir> --level 7 --declarer 2 --trump NT --limit 20
```

实现：`src/record.ts`（CLI/父进程）、`src/record-worker.ts`（fork 子进程）、
`src/record-run.ts`（推进逻辑）、`src/record-writer.ts`（分片写）、
`src/record-codec.ts`（codec/reader）、`src/record-rng.ts`（seed/流）、
`src/record-types.ts`（常量与类型）。

## 1. CLI 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--context` | `random` | `random`（52 手分层块）/ `rules`（首局 P0、双方 2 级、无抢庄） |
| `--hands` | `1000000` | 手数总数 |
| `--workers` | `min(8, cpus, hands)` | 独立链数；`1` = 进程内 |
| `--seed` | 时间戳+随机派生 | 十进制或 `0x` 十六进制，按无符号 64 位解释 |
| `--strategy-a` | `ai` | 座位 A（P0/P2） |
| `--strategy-b` | `ai` | 座位 B（P1/P3） |
| `--out` | `packages/arena/results/recordings/<runId>` | **必须不存在**，不覆盖 |
| `--shard-hands` | `50000` | 每个 `.bin` 的手数 |
| `--flush-hands` | `1000` | 写缓冲 flush 间隔 |

- 队伍：A = P0/P2，B = P1/P3，每队一个策略。
- `runId` = `<UTC ISO 时间，冒号/点换成->-<baseSeed 前 8 位>`，如
  `2026-10-25T12-34-56-789Z-1a2b3c4d`。
- 输出目录默认在 gitignored 的 `results/` 下；**不要提交数据集**。

## 2. 运行语义

### 2.1 两种模式共同点

- 每条链独立 seed、独立输出分片；不做去重。
- 所有小局 `isFirstHand: false`：亮主只决定主牌，不改变预设庄家（无抢庄）。
  无人亮主时沿用引擎自动叫主（庄家手牌中该等级牌最多的花色）。
- 发牌走每条链的顺序 deck 流；context 抽样走独立流。**不用** `base + i`、
  不用每手 32 位哈希、不改竞技场 `rng.ts` / `seededShuffle`。
- 只接受完整手牌：`ev.aborted === true` 或 `ev.errors > 0`（引擎验牌失败或
  静默兜底）视为策略 bug，立即停止全部链；出错手不写入数据集，另存错误 JSON
  （见 §5）。失败亮主/反主不是 `errors`；它不生效、不记录。
- **不做链内去重**：每手直接消费一次 deck 流，`chainHandIndex` 与流位置
  一一对应。物理 deck 可能重复（概率极低）；`.idx` 的 `deckHash` 仍可用于
  下游可选去重。**不跨链去重**。

### 2.2 random 模式（默认）

`chainHandIndex` 在每个块内的位置：

```text
blockIndex = floor(chainHand / 52)
position   = chainHand % 52
cellIndex ∈ 0..51：level = 2 + floor(cell / 4)，declarer = cell % 4
```

每进入新块，把 `0..51` 用该链的 context 流 Fisher–Yates 打乱，按 position 取。
所以一个块内 13 个等级 × 4 个庄位各恰好一次；块与块之间顺序不同，不是固定
周期。末尾不完整块同样先打乱再取前 `remainder` 个。

- 记录里 `attackerLevel = 0`、`hasAttackerLevel = false`（AI 不读该字段，
  传 `level` 仅满足事件接口）；`lap*`/`levelAfter*` 为 0，`hasLap = false`，
  `nextDeclarer = 255`。
- `blockIndex` / `cellIndex` 写入记录与 `.idx`，可直接作为分层变量。
- 总手数按链均分，每条链的块都从 0 开始；全局 52 块不跨链对齐（若要一条
  连续 100 万，用 `--workers 1`）。1,000,000 = 19,230 × 52 + 40，在单链下
  最后 40 手是不完整块。

### 2.3 rules 模式

初始 `levels = [2, 2]`、`laps = [0, 0]`、`declarerIdx = 0`。每手结束后：

```text
bankerTeam = declarerIdx % 2
attackerSits = finalPts >= 80
delta = attackerSits ? changes.attackerChange : changes.defenderChange
advancingTeam = attackerSits ? 1 - bankerTeam : bankerTeam

raw    = levels[advancingTeam] + delta
offset = raw - 2
levels[advancingTeam] = 2 + offset % 13
laps[advancingTeam]  += floor(offset / 13)
nextDeclarer = attackerSits ? (declarerIdx + 1) % 4 : (declarerIdx + 2) % 4
```

不使用 `advanceLevel`（那里有必打 K/A 与 A 上结束）：K+2 → 2（lap+1）、
K+3 → 3、Q+3 → 2、A+0 → A、A+1 → 2；没有 `matchOver`，一直循环到请求手数
或停止条件。中止/出错时不推进等级与庄家，直接停止。

## 3. 目录与文件

```text
<runDir>/
  manifest.json
  chain-00/
    shard-000.bin
    shard-000.idx
    shard-001.bin
    shard-001.idx
  chain-01/...
  errors/
    chain-00-hand-001234.json
```

`.bin` 是 raw（不 gzip）：随机访问需要 seek。1,000,000 手约 400–500 MB。
需要归档时另做 gzip 副本，不要作为主数据格式。

### 3.1 基础约定

- 所有整数**小端**。
- 卡片 code 固定为 `createFullDeck()` 的下标 0..107；改变顺序必须升版本。
- `trumpCode`：0..3 = S/H/C/D，255 = 无主（NT）。
- `FORMAT_VERSION = 1`、`rulesVersion = "endless-v1"`。

### 3.2 `.bin`

Header（28 字节）：

| 字段 | 类型 |
|---|---|
| magic `PKR1` | 4 bytes ASCII |
| formatVersion | u16 |
| flags | u16（目前 0） |
| chainId | u16 |
| reserved | u16 |
| shardIndex | u32 |
| startHandIndex（链内 index） | u32 |
| chainSeed（seed 的 64 位数值） | u64 |

之后是连续的记录，每条：

```text
u32 recordLength（payload 字节数，不含这 4 字节）
payload
```

Footer（12 字节）：`PKRE` + u32 recordCount + u32 crc32（目前恒 0）。
中断时 footer 可能缺失；reader 用长度前缀扫描，footer 的 `PKRE` 作为长度会
越界，天然成为终止条件。

### 3.3 record payload（164 + 2×reveals + tricks + failedThrows 字节）

| 字段 | 类型 | 说明 |
|---|---|---|
| globalHandIndex | u32 | 全局 index |
| chainHandIndex | u32 | 链内 index |
| blockIndex | u32 | random 块号；rules 0 |
| cellIndex | u8 | random 0..51；rules 0 |
| level | u8 | 庄家/主等级 2..14 |
| declarer | u8 | 0..3 |
| attackerLevel | u8 | rules 实际值；random 0 |
| trumpCode | u8 | 0..3 / 255 |
| flags | u8 | 见下 |
| lapA | u32 | rules；random 0 |
| lapB | u32 | rules；random 0 |
| levelAfterA | u8 | rules；random 0 |
| levelAfterB | u8 | rules；random 0 |
| nextDeclarer | u8 | rules 0..3；random 255 |
| deck | 108 × u8 | 原始发牌顺序（100 张手牌 + 8 张初始底牌） |
| bottom | 8 × u8 | **扣底后**的最终底牌 |
| revealCount | u16 | **生效**亮主/反主次数，≤ 400 |
| reveals | revealCount × 2 × u8 | 每项：packed 字节 + `dealIndex`（见下） |
| trickCount | u8 | 通常 25，可能更少 |
| tricks | 变长 | 见下 |
| attackerPoints | **i16** | 原始闲家分；甩牌罚分后可 < 0 |
| finalPts | u32 | 含抠底的最终分（≥ 0） |
| bottomPoints | u8 | 底牌分 |
| bottomMultiplier | u16 | 抠底倍率 |
| kouDiAdd | u32 | 抠底加分 |
| throwPenalties | 2 × u8 | `[declarerTeam, attackerTeam]` 甩牌罚分计数 |
| failedThrowCount | u8 | 非法甩牌强制降级次数 |
| failedThrows | 变长 | 每项见下，附在 payload 末尾 |

Reveal（每项 2 字节）：

```text
byte 0: player (bits 0..1)
        suit   (bits 2..4；0..3 = S/H/C/D，7 = NT)
        strength-1 (bits 5..6)
        bit 7 reserved = 0
byte 1: dealIndex (u8，0..99)
```

- `reveals` 只记录改变了 `currentReveal` 的**生效**亮主/反主；合法但
  `canOverride` 失败、主动 pass、非法选项都不记录。
- 发牌是轮发：`deck[i]` 给座位 `i % 4`（前 100 张）；每发一张后按座位 0→3
  轮询亮主，`dealIndex=i`。同一 `dealIndex` 内按 player 升序。初始底牌
  `deck[100..108)` 不参与亮主轮询。
- **缺失条目的语义**：若某 `(dealIndex, player)` 有合法亮主选项却没有生效
  条目，表示 pass（失败反主也并入 pass；下游不区分）。空 `reveals` 表示
  自动叫主，最终主牌由 `trumpCode` 给出。
- `revealCount` 为生效条目数，不是尝试数；`MAX_REVEALS=400`。

FailedThrow：

```text
u8 trickIndex       // 0-based；发生在该墩领出
u8 player           // 领出者 = tricks[trickIndex].lead
i8 penaltyDelta     // +10 / -10 / 0（罚分封顶）
u8 cardCount
u8 cards[cardCount] // AI 原本想甩的牌（deck code）
```

- 只记录 `validateThrow` 失败、被强制降级的甩牌；合法甩出后被主牌毙的
  不是失败，直接看 `tricks[t].winner/points`。
- 被强制降级后**实际出的牌**在 `tricks[trickIndex]` 里，不重复存。
- `attackerPoints = 原始闲家分 + Σ penaltyDelta`；罚分发生在该墩领出前，
  该墩领出决策的上下文不含本次 delta，跟牌及之后包含。

flags：

| bit | 含义 |
|---|---|
| 0 | random 模式 |
| 1 | rules 模式 |
| 2 | hasAttackerLevel（rules） |
| 3 | hasLap（rules） |
| 4 | attackerWonLastTrick（抠底） |
| 5 | bankerWon（finalPts < 80，冗余便于校验） |

Trick：

```text
u8 lead                 // 领出者座位
4 × u8 counts           // 四家按出牌顺序各出几张
sum(counts) × u8 cards  // 按出牌顺序拼接的 code
u8 winner
u16 points
```

- `deck` 存原始 108 张；初始底牌 = `deck[100..108)`。扣底后四家手牌由
  `deck` + `declarer` + `bottom` 推导，不必重复存 100 张；
  `record-codec.ts` 的 `initialHands(record)` 给出 code 手牌。
- reveal 的 `player` 2 bits、suit 3 bits、strength 2 bits。
- 出错手不写入；中止手不写入（运行会停止）。

### 3.4 `.idx`

Header（16 字节）：`PKI1` + u16 version + u16 chainId + u32 shardIndex + u32 reserved。

每条记录一个 entry（32 字节）：

| 字段 | 类型 |
|---|---|
| offset（相对 `.bin` 起点，指向 recordLength） | u64 |
| deckHash（物理 deck hash 的低 64 位） | u64 |
| chainHandIndex | u32 |
| blockIndex | u32 |
| level | u8 |
| declarer | u8 |
| trumpCode | u8 |
| flags | u8 |
| cellIndex | u8 |
| reserved | 3 × u8 |

Footer（12 字节）：`PKIE` + u32 count + u32 crc32。

- 必须写完 footer 才算完整；reader 遇到缺失 footer 或 count 不一致时丢弃该
  `.idx`，改从 `.bin` 的长度前缀重建（不改写磁盘）。
- 记录顺序 = chainHandIndex 顺序，无跳号。

### 3.5 manifest.json

父进程写，原子写（临时文件 + rename）。字段：

```json
{
  "formatVersion": 1,
  "rulesVersion": "endless-v1",
  "status": "running|completed|interrupted|error",
  "contextMode": "random|rules",
  "seed": { "base": "<16 hex>", "source": "timestamp+random|cli", "algorithm": "sha256-64-v1" },
  "strategies": { "A": "ai", "B": "ai" },
  "handsRequested": 1000000,
  "handsCompleted": 999999,
  "workers": 8,
  "shardHands": 50000,
  "flushHands": 1000,
  "createdAt": "ISO",
  "completedAt": "ISO|null",
  "revision": "<git rev-parse HEAD|null>",
  "dirty": false,
  "node": "v17.5.0",
  "command": ["..."],
  "chains": [
    {
      "chainId": 0,
      "seed": "<16 hex>",
      "globalStart": 0,
      "handsRequested": 125000,
      "handsCompleted": 125000,
      "status": "running|completed|stopped|error",
      "shards": [
        { "path": "chain-00/shard-000.bin", "startHand": 0, "count": 50000, "indexPath": "chain-00/shard-000.idx" }
      ]
    }
  ],
  "error": null
}
```

`revision` 是机器可读出处字段，允许提交哈希；git 不可用时为 null。

## 4. 随机与 seed

```text
baseSeed    = sha256("record-v1|<Date.now>|<pid>|<random 8 bytes>")[0,8)   // 默认
chainSeed   = sha256("record-v1|chain|<baseSeedHex>|<chainId>")[0,8)
deckSeed    = sha256("record-v1|deck|<chainSeed>|<chainId>")
contextSeed = sha256("record-v1|context|<chainSeed>|<chainId>")
```

`chainSeed` 写 manifest 与 `.bin` header（64 位数值）。每条链把 deckSeed /
contextSeed 的前 16 字节拆成四个 uint32 作为 sfc32 的 state；发牌是
`createFullDeck()` + Fisher–Yates；context 块用独立流打乱。所有流都是顺序流，
同一 chain seed 可完整重放一条链。

## 5. 中断、错误与持久化

- 每 `flushHands` 手或缓冲到 1 MB 时 `writeSync`；每 `shardHands` 手换分片，
  分片结束写 footer 并关闭。
- SIGINT/SIGTERM：父进程向所有子进程发 `{type:"stop"}`；子进程打完当前手、
  flush、写 footer、关闭后才退出。第二次信号强制结束。
- 子进程还会处理 `disconnect`（父进程消失）与直接收到的 SIGINT，避免孤儿
  进程继续写盘。
- 硬杀最多丢最后 `flushHands` 手；`.idx` 不完整时 reader 可重建。
- **不 resume**；运行目录唯一，存在即报错。已完成手保留。
- 链出错（abort / 验牌失败或静默兜底 / 策略抛异常 / 分片写失败）：父进程停止所有链，
  manifest `status = "error"`，退出码 1。出错手不写数据集，写

```text
<runDir>/errors/chain-XX-hand-YYYYYY.json
```

  内容含 `kind`、链内/全局 index、seed、策略名、context、deck（物理卡 id）、
  事件、`serialize(state)` 字符串与错误 message/stack。

## 6. 读取

```ts
import { RecordDataset, initialHands } from '@poker/arena/src/record-codec.js';

const dataset = RecordDataset.open(runDir);
const one = dataset.getHand(12345);             // 全局 index
const two = dataset.getChainHand(1, 2345);      // (chainId, chainHandIndex)
const index = dataset.readIndex(1, 0);          // 分片索引（含 deckHash/level/declarer/trump）
const rebuilt = dataset.rebuildIndex(1, 0);     // 强制扫描 .bin
const hands = one ? initialHands(one) : null;   // 扣底后四家 25 张 code
dataset.close();
```

按 context 查询不需要额外持久化索引：`.idx` 已带 level / declarer / trumpCode /
blockIndex / cellIndex，分析器可在内存里建 bitset（1M 手约 2.75 MB）做组合过滤。
`scripts/record-inspect.ts` 是最小验收工具。

### 6.1 解析器（`src/record-parse.ts`）

解析器把一条 `HandRecord` 转成分析用 `ParsedHand`，只做机械转换与结构校验：
`deck`、最终 `bottom`、生效 `reveals`（含 `dealIndex`）、`failedThrows`、逐墩
`plays`（出牌顺序，`seat = (lead + i) % 4`）与结算字段；不重建
`GameState`/`AIContext`，不重跑 AI，不做概率或场景判定。

- `parseHand(record, meta, { validate, includeRaw })`：单条转换；默认严格校验。
- `dealtHands` / `initialBottom` / `declarerHandBeforeBury` / `openingHands` /
  `handAtDealIndex`：从 `deck` + `bottom` 机械推出各阶段手牌。
- `attackerPointsRaw` / `attackerPointsBeforeTrick` / `attackerPointsAfterLead`：
  用 trick 分数 + `failedThrows.penaltyDelta` 推 running 分；领出决策前不含该墩
  罚分，`AfterLead` 含。
- `iterateParsedHands(runDir, opts)` / `iterateShard(..., opts)`：
  chain → shard → chainHandIndex 顺序，流式 yield；`filter` 用 `.idx` 字段做
  预筛，`predicate` 在解码后执行；`skipBad` 默认 false。
- `getParsedHand(dataset, globalHandIndex, opts)`：随机访问。
- `validate` 默认 true；`running` manifest 默认拒绝（`allowRunning` 可放行）；
  截断尾部视为正常结束；结构/语义不一致抛 `RecordParseError`（带
  chain/shard/offset/index 上下文），不静默修正。
- 亮主不补 pass 条目：下游在 `(dealIndex, player)` 用 `getRevealOptions` /
  `canOverride` 判断“有合法选项但无生效条目 = pass”；失败反主并入 pass。
- 解析器只给事实；反事实整手模拟/重跑 AI 是另一个分析层，不在本文件。

## 7. 保证与限制

- **不做生成期去重**：物理 deck 可能重复（1M 规模下概率极低）；`.idx` 的
  `deckHash` 可用于下游可选去重。
- 记录自包含：deck、最终底牌、生效亮主序列（含 `dealIndex`）、非法甩牌
  原始意图、每墩出牌/赢家/分、结算字段、context 与推进信息。四家手牌可反推。
- 不改变 AI 行为：本功能只调用现有 `playHand`（新增 `onComplete` / `onReveal` /
  `onThrowFailure` 纯捕获回调），不动策略、竞技场 `rng.ts` 与 Elo；Elo 表
  不因本功能失效。
- 不跑分析器、不做 resume、不做全局精确均衡（链各自 52 手块）。
- `attackerPoints` 用 i16 而非 u16：甩牌罚分可使原始分变为负数，截断会污染数据。
- 随机源仍是 64 位 seed + sfc32 顺序流；**不声称**覆盖全部 108! 发牌或严格
  等概率。deck 已持久化，解析器不依赖重放随机流。
- **旧 v1 布局不兼容**：`reveals` 2 字节、`failedThrows`、无去重；旧录像
  全部作废（`FORMAT_VERSION` 仍为 1，不要混读）。
