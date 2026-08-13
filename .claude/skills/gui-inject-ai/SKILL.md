---
name: gui-inject-ai
description: 把任意牌局状态注入运行中的双升 GUI（window.__POKER_STORE__）→ 调 getHint 复现 AI 建议出牌与理由，并验证建议满足必出/不可选约束。用于分析"AI 为什么建议某张牌"、对照真实 GUI 行为、调试跟牌策略。
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

1. **把用户描述的牌局转成 state.json**（牌 = 引擎 cardId 格式 `花色-rank-idx`，如 `S-2-0`、`J-16-7`；花色 S/H/C/D/J，rank 2-16（11=J、12=Q、13=K、14=A、15=小王、16=大王））：

   ```json
   {
     "trump": { "declarerIndex": 0, "trumpSuit": "S", "level": 2 },
     "hand": ["S-2-0", "S-2-1", "C-3-2", "C-13-3", "C-5-4", "C-7-5", "H-2-6", "J-16-7", "D-12-8", "J-15-9"],
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

   - `hand` = 玩家 1 手牌；`aiHands` 提供 AI 手牌**长度**（记牌用，可只给部分）
   - `trickPlays` 的 **leadSuit 必填**（主牌领出 = `null`，如吊主/甩主）——缺省会被当作吊主走错分支
   - `history` 可选（影响记牌/队友判断）；`attackerPoints`/`bottomCards` 可选
   - 同一 rank 多张牌用不同 idx 区分（如 `S-2-0`、`S-2-1`）；**牌局内所有牌 id 全局唯一**

2. **跑脚本**（仓库根）：

   ```bash
   npx tsx .claude/skills/gui-inject-ai/inject-gui.ts /tmp/state.json
   # 或指定端口: ... --url http://localhost:5199
   ```

3. **读输出**：

   ```
   必出(locked): ...     # computeMandatoryFollow（引擎）
   不可选(disabled): ...
   AI 建议: C-3-2        # getHint 实际建议（与 GUI 建议按钮一致）
   理由: 💡 建议: 同花色出小（盖不过，不加分）
   约束检查: 建议⊇必出 ✓ | 建议∩不可选 ✓
   ```

4. **结论与用户描述比对**：若建议与用户看到的牌不一致 → 优先核对 `trickPlays` 的 playerIndex/leadSuit、`history` 的 winnerIndex（队友判断）、`aiHands` 手牌长度——这些差异会改变 AI 决策路径。

## 踩过的坑

1. **trickPlays 缺 leadSuit** → `getHint` 把副牌领出当吊主（`!leadSuit` 分支），建议主牌"用最小牌盖"——与真实行为不符。**leadSuit 必填**（副牌领出 = 花色字母；吊主/甩主 = `null`）。
2. **AI 手牌不给（aiHands 空）** → handCounts 变为 [10,0,0,0]，影响记牌推断 → 建议可能不同。尽量按用户描述给全（至少张数）。
3. **tsx 与 page.evaluate**：脚本用字符串形式的 evaluate（避免 tsx 注入 `__name` helper 导致 ReferenceError）；不要改成函数形式。
4. **浏览器**：playwright-core 无本地 chromium 时需 `channel: 'chrome'`（本机系统 Chrome）。
5. **getHint 会覆盖 selectedCardIds**（建议直接选中）——注入前 `setState` 清空 selected/locked，避免旧状态干扰。
