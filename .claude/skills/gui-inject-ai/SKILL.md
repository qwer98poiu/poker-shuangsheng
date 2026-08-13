---
name: gui-inject-ai
description: 把任意牌局状态注入运行中的双升 GUI（window.__POKER_STORE__）→ 调 getHint 复现 AI 建议出牌与理由，并验证建议满足必出/不可选约束。支持"直接注入当前状态"与"从第 1 墩开局驱动到当前局面"两种模式。用于分析"AI 为什么建议某张牌"、对照真实 GUI 行为、调试跟牌策略。
---

# GUI 牌局注入 + AI 建议复现

## 触发场景

- 用户问"AI 为什么建议出 X？"——把用户描述的牌局注入真实 GUI，拿 AI 实际建议 + 理由（与用户看到的一致或发现描述差异）。
- 验证 GUI 的 AI 建议与引擎约束一致（建议 ⊇ 必出牌、∩ 不可选 = ∅）。
- 构造任意跟牌局面调试锁定/置灰交互。

## 前置

1. **vite dev server 已运行**（`cd packages/client && npm run dev`，默认 5199 端口；脚本 `--url` 指定实际端口）。
2. 浏览器：系统 Chrome（脚本用 `channel: 'chrome'`）。

## 操作步骤

1. **准备 state.json**（牌 = 引擎 cardId 格式 `花色-rank-idx`，如 `S-2-0`、`J-16-7`；花色 S/H/C/D/J，rank 2-16（11=J、12=Q、13=K、14=A、15=小王、16=大王））：

   ```json
   {
     "trump": { "declarerIndex": 0, "trumpSuit": "S", "level": 2 },
     "hand": ["S-2-0", "S-2-1", "C-3-2", "C-13-3", "C-5-4", "C-7-5", "H-2-6", "J-16-7", "D-12-8", "J-16-9"],
     "trickPlays": [
       { "playerIndex": 1, "cards": ["C-14-0"], "leadSuit": "C" },
       { "playerIndex": 2, "cards": ["C-5-1"], "leadSuit": "C" },
       { "playerIndex": 3, "cards": ["C-10-2"], "leadSuit": "C" }
     ],
     "history": [
       { "winnerIndex": 0, "points": 10, "plays": [[0, ["D-14-0"]], [1, ["D-3-1"]], [2, ["D-13-2"]], [3, ["D-3-3"]]] }
     ],
     "aiHands": { "1": ["S-9-0", "S-3-1"], "2": [], "3": [] },
     "attackerPoints": 35,
     "bottomCards": ["H-9-0", "D-7-1"]
   }
   ```

   **两种模式**（脚本自动选择）：
   - **直接注入**（无 `initialHands`）：`hand` = 玩家 1 当前手牌，`aiHands` 给 AI 当前手牌（至少张数，影响记牌），`history`/`trickPlays` 描述当前局面。适合快速验证。
   - **从开局驱动**（有 `initialHands`）：`initialHands` = 扣底后各家 25 张开局手牌（**GUI 导出含此段，直接抄**），`history` 必须完整（逐墩驱动用），`trickPlays` 给当前墩（最后一家 = 玩家 1 不驱动）。适合"AI 为什么建议 X"的完整还原——手牌/记牌/推断与真实路径完全一致，**无需反推**。

   - `trickPlays` 的 **leadSuit 必填**（主牌领出 = `null`）——缺省会被当作吊主走错分支
   - `reveals` 可选（默认按庄家亮主构造）；`attackerPoints`/`bottomCards`/`currentLevel`/`tricksPlayed` 可选
   - 同一 rank 多张牌用不同 idx 区分；**牌局内所有牌 id 全局唯一**

2. **跑脚本**（仓库根）：

   ```bash
   npx tsx .claude/skills/gui-inject-ai/inject-gui.ts /tmp/state.json
   # 或指定端口: ... --url http://localhost:5199
   ```

3. **读输出**：

   ```
   必出(locked): ...     # computeMandatoryFollow（引擎）
   不可选(disabled): ...
   （驱动模式）驱动模式：从开局（第 1 墩前）逐墩出牌，共 7 墩 + 当前墩 3 家
   AI 建议: C-3-2        # getHint 实际建议（与 GUI 建议按钮一致）
   理由: 💡 建议: 同花色出小（盖不过，不加分）
   约束检查: 建议⊇必出 ✓ | 建议∩不可选 ✓
   ```

4. **结论与用户描述比对**：若建议与用户看到的牌不一致 → 优先核对 `trickPlays` 的 playerIndex/leadSuit、`history` 的 winnerIndex（队友判断）、王/级牌的分配（全局唯一性校验会提示超张）。

## 踩过的坑

1. **phase 必须是字符串枚举小写 `'playing'`**（`GamePhase.Playing = 'playing'`）——写 `'Playing'` 会让 `submitPlay` 的 phase 检查静默返回（无任何报错），getHint 不检查 phase 所以不暴露。脚本内部已固定，不要改。
2. **驱动出牌前必须切换 localPlayerIndex**：`submitPlay` 只在 `currentPlayerIndex === localPlayerIndex` 时执行——逐家出牌前 `setState({ localPlayerIndex: p })`。
3. **getHint 前必须把 localPlayerIndex 设回观察视角（0）**：驱动后视角停在最后出牌玩家——从 AI-4 视角建议会完全不同（例：♣A 是 AI-4 队友的 → "队友已大，加分" → 建议 ♣K；玩家 1 视角 → 盖不过 → 建议 ♣3）。脚本已固定设回 0。
4. **全局牌唯一性**：两副 108 张，同 suit-rank 最多 2 张（大小王各 2 张、级牌 4 花色各 2 张）。直接构造中间状态易出超张（如 3 张小王）——脚本会 warn；从 GUI 导出（含 initialHands）取数可避免。
5. **trickPlays 缺 leadSuit** → getHint 把副牌领出当吊主（`!leadSuit` 分支），建议主牌"用最小牌盖"——与真实行为不符。**leadSuit 必填**。
6. **tsx 与 page.evaluate**：脚本用字符串形式的 evaluate（避免 tsx 注入 `__name` helper 导致 ReferenceError）；脚本含 top-level await 会报 CJS 错，已包 `async main()`。
7. **浏览器**：playwright-core 无本地 chromium 时需 `channel: 'chrome'`（本机系统 Chrome）。
8. **getHint 会覆盖 selectedCardIds**（建议直接选中）——注入前清空 selected/locked，避免旧状态干扰。
