# W3-CSS · 收口报告（2026-11-02）

> owner：inspector-styles
> 写域：`client/styles.ts` + `client/distill.styles.ts` + `client/guide.styles.ts`
> 基线：第 2 批验收后（HEAD `a7b5799` + 各批工作区改动）

## 0. 自检（贴实际数字）

| 项 | 结果 |
|---|---|
| `_gate.mjs`（模板串 + 真打一次包取注入 CSS） | **GATE PASS**：模板串内反引号 **0**；`${` **5**（EASE / PANEL_WIDTH / PANEL_MAX_H / GUIDE_CSS / DISTILL_CSS）；注入 CSS 花括号 **665 / 665** BALANCED；注入 CSS 内反引号 0、`${` 0 |
| `node scripts/verify-ui.mjs` | **7/7 通过**；其中「子视图字号字面量 **0** 处（预算 30）」 |
| `node scripts/verify-a11y.mjs` | **8/8 通过，0 失败，0 跳过**（④ 蒸馏结果条已是 `role="status"`，跳过项自动转绿） |
| `npx tsc -p tsconfig.client.json --noEmit` | **本批三个文件 0 错误**；全项目 1 条，在 `client/card-editor.tsx(398,50) Cannot find name 'T_BASE'` —— 并行 JSX 侧的在飞改动（未 import motion.ts 的 T_BASE），不属本写域 |
| `tools/qa/shots.mjs` 16 场景 | **16/16 ✓**，产物 `06-tmp/ui-audit/w3/` |

---

## 1. A · JSX 侧请求的 7 条

| # | 落地 | 位置 | 说明 |
|---|---|---|---|
| A1 | `.awu-sk[data-state="closing"]` | `styles.ts:3922` | 加 `position: absolute; left: 0; right: 0`（top 保持 auto → 留在静态位置，只把宽度按容器撑满）。配套给 `.awu-pane`(:601) 与 `.awu-mainBody` 加 `position: relative` 当定位上下文。实测注入一个 `.awu-sk[data-state="closing"]`：`position=absolute, left=0, right=0, width=782 = mainBody 宽`，动画 `awu-exit`，`pointer-events:none` |
| A2 | `.awu-status[data-state="closing"]` | `:3934` | `awu-exit-rise` + T_EXIT；它与进场（`:3894`，按 `[data-status=info|warn]` 命中的 `awu-rise`）同为 (0,2,0)，**退场段在文件更后所以赢**，注释里写明"别动顺序"。实测 `animation-name=awu-exit-rise`、`pointer-events=none` |
| A3 | `.awu-card[data-flipping="true"]` + `:hover` + `:active` | `:3944-3947` | 已含 `:active`（原 W2 就有）；实测挂上 `data-flipping` 后 `transform=none` |
| A4 | `.awu-card[data-state="closing"]` | `:4111` | 用 `awu-exit` + **T_FAST(120ms)**（删卡是 FLIP 的第一步，160ms 会让人觉得"点完没反应"）。实测 `animation-name=awu-exit, duration=0.12s, pointer-events=none`。注释里已写「📌 第 4 批：JSX 的内联 opacity/120ms 兜底可删」 |
| A5 | `.awu-railHead > .awu-headActions` | `:693` | `justify-content: flex-end`（它自身是 flex 容器且被列向父级 stretch 满宽，用 margin 推不动，只能 justify）。实测 820 窄屏：railHead 右边界 803、末个按钮右边界 783 = 803 − gutter 20，**右对齐成立** |
| A6 | 删 `[data-closing="true"]` 兼容段 | 已删净 | `grep data-closing` 在三个 styles 里 **0 命中** |
| A7 | 删 `[data-view-state]` 兼容段 | 已删净 | `grep data-view-state` **0 命中**；`awu-view-in` 的唯一引用保留在 `.awu-mainBody > *`（`:741`），keyframes 闭环仍绿 |

## 2. B · 两条预留 keyframes 接上

| keyframes | 引用点 |
|---|---|
| `awu-exit-right` | `.awu-detail[data-state="closing"]`（`:4068`，默认"回列表 = 向右退"）+ `[data-exit="right"]` / `.awu-detail[data-exit="right"]`（`:4075-4076`） |
| `awu-exit-left` | `[data-exit="left"]` / `.awu-detail[data-exit="left"]`（`:4081-4082`） |

- 显式方向写成「属性 + 类」两个选择器：`.awu-detail[data-exit="left"]` 是 (0,2,0)，与 `.awu-detail[data-state="closing"]` 同权且在后 → 显式方向能压过默认方向（实测：无 data-exit → `awu-exit-right`；`data-exit="left"` → `awu-exit-left`；`right` → `awu-exit-right`）。
- 两条都带 `pointer-events: none`；`prefers-reduced-motion` 里补了一条 `.awu-detail[data-state="closing"] { animation-name: awu-exit }`（减弱动效下只淡出，不做 ±8px）。
- **`verify-ui` 的 RESERVED 白名单现在可以删**（`awu-exit-right/left` 都有真实引用，删白名单后闭环仍成立）。

## 3. C · distill.styles.ts（235 → 161 行，+85/−159）

| 项 | 改法 |
|---|---|
| C8 宽度/圆角 | 删掉 `.awu-distill-dialog` 整条规则（原 `width: min(var(--awu-dialog-w,420px),100%)` + `max-height` + `border-radius: var(--awu-r-lg,16px)`）→ 全部继承 `.awu-dialog`。同时 `styles.ts` 的 `--awu-dialog-w` **760 → 620**，`.awu-dialog` 的 `width: min(620px,100%)` 改成 `min(var(--awu-dialog-w),100%)`（单一真源）。**`.awu-dialog.awu-distill-dialog` 桥接已删**。实测蒸馏弹层 622（620+2px 描边）、`border-radius: 24px` |
| C9 字号 | 9.5 / 10 / 10.5 → `--awu-fs-micro`(11)；11.5 → `--awu-fs-caption`(12)；11px→micro、12px→caption。实测 `.awu-distill-num` 11px、`.awu-distill-steps li` 12px。**distill 字号字面量 11 → 0** |
| C10 旧暖色 fallback | **41 处 `var(--awu-x, 回退值)` 全部清掉**（`#8f8172 / #bdae9d / #e9bd72 / #86c9bd / #f6ece0 / rgba(244,208,160,…)` 那套象牙色）。文件头注释同步改写：旧前提「弹层在 token 作用域外」早已失效 |
| C11 `.26s` 硬编码 + 旧曲线 | 该块（`.awu-distill-sep/-meter/-bar/-groups/-tag/-nameRow`）与 `.awu-distill-sendRow` 在 JSX 里引用数 **0** → 整段删除（连同文件末尾那条只为它存在的 reduced-motion 块）。**`.26s` 随之消失** |
| 顺带 | 间距全部并进 `--awu-gap-*`；`border-radius: 50%` → `--awu-r-pill`；`999px` → `--awu-r-pill` |

## 4. D · guide.styles.ts（203 → 210 行，+68/−61）

- 阅读宽 **680 → `var(--awu-content-max)`(760) + `margin: 0 auto`**（与详情页/编辑器正文同宽居中）。
- 正文档 **13/22 → 14/23**（`--awu-fs-body` + `--awu-lh-px-23`）：`.awu-guide-line / -text / -key / -q / -a / -alertText` 都升到 14；`.awu-guide-alertTitle` 14/20；小注/路径 12/20；分节标题 12/18；序号 11/23。
- **字号字面量 14 → 0**（全部 `--awu-fs-*`）；行高全部整数阶梯 `--awu-lh-px-18/20/23`；间距全部 `--awu-gap-*`。
- `.awu-guide-alert .awu-guide-alertMark` 的字色保留 `var(--awu-surface-opaque)` 并补了注释：gold 在深浅两态一亮一暗，字色必须反向，不能换 `--awu-on-character`。
- `border-radius: var(--awu-r-lg, 14px)` 的**错值回退**（token 其实是 16）一并删除。

**`verify-ui` 字号字面量最终数字：子视图 **0** 处（预算 30；改前 distill 11 + guide 14 = 25）。**

## 5. 与 JSX 侧的对表（本轮继续有效的钩子）

- `.awu-sk[data-state="closing"]` / `.awu-status[data-state="closing"]` / `.awu-card[data-state="closing"]` / `.awu-card[data-flipping="true"]`：全部按 `data-state` / 带值属性写。
- 方向退场：**JSX 目前还没写 `data-exit`**（`grep data-exit` 在 tsx 里 0 命中）。默认路径（只挂 `data-state="closing"`）已经能拿到"向右退"；要做反方向（从详情退回列表时列表向左退）再挂 `data-exit="left"`。
- `.awu-distill-dialog` 现在是**纯标记位**（CSS 无规则）：几何由 `.awu-dialog` 提供，JSX 保留该类不会掉样式。
- `verify-a11y` ④ 的跳过项已消失（JSX 给 `.awu-distill-status` 加了 `role="status"`），不用再登记。

## 6. 遗留（不在本写域）

1. `client/card-editor.tsx:398` 用了 `T_BASE` 但没 import（并行 JSX 侧）：**tsc 全项目目前因此为红**，与本批 CSS 无关；本批三文件 0 错误。
2. `distill.tsx` 的 `.awu-distill-status` 已补 `role="status"`；若还要给 tone=warn/danger 更強的播报，需在 JSX 侧决定（不建议同一节点切 `alert`，会打断读屏）。
3. 截图矩阵 16 场景已全绿；如果需要"退场/降级"专项图，`tools/qa/shots.mjs --media=reduce-transparency` 可再出一套（本批未跑全套降级图，只做了 A1-A4 的计算值实测）。
