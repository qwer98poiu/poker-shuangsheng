---
name: layout-regression
description: 修改 GUI 组件位置后，验证其他所有组件位置不变——注入 6 个代表性阶段、测量 40 个关键组件矩形并与基线比对，位移 >1px 即报错；也用于人工确认布局后更新基线。
---

# 布局回归检查

## 触发场景

- 修改任意 GUI 组件的位置（尤其是给容器加/改 `position`）。
- 有意移动组件、人工确认全布局正确后更新基线。

## 前置

vite dev server（默认 3000；被占用时 vite 顺延并打印实际地址，用 `--url` 指定）。浏览器 = 系统 Chrome。

## 检查

```bash
cd packages/client && npx tsx scripts/layout-regression.ts
```

注入 6 个代表性阶段（发牌/亮主/扣底/出牌/甩 10 张/局末），测量 40 个关键组件的矩形，与基线 `scripts/layout-baseline.json` 比对；任一组件位移 >1px 时列出该组件及精确 delta，退出码 1。

## 更新基线

```bash
npx tsx scripts/layout-regression.ts --snapshot
```

**仅当人工确认当前布局正确时**执行；基线随代码提交，视口固定 1280×720。

## 历史教训

给 `.center-area` 加 `position: relative` 导致等级框掉到桌布上——定位祖先被劫持。改容器定位属性后必须跑本检查。
