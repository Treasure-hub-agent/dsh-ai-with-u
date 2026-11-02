# AI WITH U · UI 动效系统与结构契约（2026-11-02）

> 本文件是「方向 B · 玻璃有呼吸」升级的**接口契约**：CSS 侧（`styles.ts`）与 JSX 侧（`index.tsx`）并行开工时，双方只按本文件的类名与 `data-*` 对接，互不改对方文件。
> 契约外的改动请先改本文件（Lead 维护），再落地代码。
> 上游：`reports/2026-11-02-ui-audit/{A,B,C,D,E}-*.md`、`reports/2026-11-02-dsh-ai-with-u-UI与动效升级方案.md`

---

## 1. 动效令牌（第 0 批已落，`client/motion.ts` ↔ `styles.ts` 双写）

| 语义 | CSS 变量 | TS 常量 | 值 |
|---|---|---|---|
| 微交互（按压/滑块） | `--awu-t-fast` | `T_FAST` | 120ms |
| 默认过渡 | `--awu-t-base` | `T_BASE` | 200ms |
| 中等（折叠展开） | `--awu-t-mid` | `T_MID` | 240ms |
| 进入（面板/sheet） | `--awu-t-enter` | `T_ENTER` | 320ms |
| **退场（统一）** | `--awu-t-exit` | `T_EXIT` | 160ms |
| 长任务反馈 | `--awu-t-slow` | `T_SLOW` | 600ms |
| 环境动画（呼吸） | `--awu-t-ambient` | `T_AMBIENT` | 3400ms |

| 缓动 | CSS | TS |
|---|---|---|
| 进入（弹簧感） | `--awu-ease` | `EASE` = `cubic-bezier(.32,.72,0,1)` |
| 退场/收尾 | `--awu-ease-out` | `EASE_OUT` = `cubic-bezier(.22,1,.36,1)` |
| 收起/被删 | `--awu-ease-in` | `EASE_IN` = `cubic-bezier(.55,0,1,.45)` |

**纪律**：CSS 里只允许 `var(--awu-t-*)` / `var(--awu-ease*)`，禁止新的时长字面量；旧名（`--awu-dur-1..5` 等）保留为别名，第 2 批统一后再删。

---

## 2. 结构与状态契约（谁提供 / 谁消费）

### 2.1 布局状态

| 属性 | 提供方 | 取值 | 消费方用途 |
|---|---|---|---|
| `.awu-workspace[data-nav]` | JSX（index.tsx） | `split` \| `push` \| `pop` | `<900` 单栏导航栈：`push`=详情页覆盖列表，`pop`=返回列表 |
| `.awu-panel[data-still]` | JSX | `true`（动画期） | CSS 在 `data-still="true"` 时 `backdrop-filter:none`，`animationend` 移除（性能） |
| `.awu-panel[data-fx]` | JSX | `off`（用户关高光） | 关掉指针跟随高光 |
| `.awu-card[data-selected]` | JSX | `true` | 左栏选中态（静态蓝轨，与 `[data-live]` 金色呼吸区分） |
| `.awu-card[data-card-id]` | JSX | 卡名/稳定 id | 第 2 批 FLIP 需要稳定身份 |
| `.awu-card[data-mx][data-my]` 或内联 `--awu-mx/--awu-my` | JSX（`useFinePointer` + rAF） | 百分比 | 指针跟随高光位置 |
| `.awu-avatar[data-morph]` | JSX | `avatar` | list→detail 头像共享元素（卡片与 hero 两处同名） |

### 2.2 退场（`usePresence`）

| 元素 | 属性 | 说明 |
|---|---|---|
| `.awu-scrim` / `.awu-panel` / `.awu-dialog` / `.awu-editor` / `.awu-focus` | `data-closing="true"` | 退场期 160ms 只动 opacity；**不 stagger**；`animation-fill-mode:both` 防末帧闪回 |
| 关闭路径 | — | JSX 用 `usePresence(open)` 的 `mounted` 控制是否渲染、`closing` 控制属性；`escYield` 在 closing 期间放行 |

### 2.3 分段控件滑块

`.awu-tabs` 上由 JSX 写内联 CSS 变量：`--awu-tab-i`（当前序号，0 基）、`--awu-tab-n`（总数）。
CSS 用 `transform: translateX(calc(var(--awu-tab-i) * 100%))` 驱动 `::before` 指示块，宽度 `calc(100% / var(--awu-tab-n))`。
**注意**：CSS 必须删掉 `.awu-tab[data-on]` 自带的底与阴影，否则双底；`gap` 参与宽度公式，写注释说明。

### 2.4 右栏顶部（tabs 归位）

新骨架（JSX 提供，CSS 只负责外观）：

```
.awu-main
  .awu-mainHead          ← tabs 移到这里；右端放「刷新 / 关闭」等全局动作
    .awu-tabs[--awu-tab-i][--awu-tab-n]
  .awu-mainBody          ← 原 .awu-pane，roster | diary | stats | guide 四视图
```

左栏保留：`.awu-railHead`（蒸馏 / 自创 CTA + 过滤 + 预设/预览/导入）→ `.awu-grid` 卡片列表。
左栏在 `diary` tab 下额外显示一行 `.awu-railNow`（「正在看：<角色名>」），`data-empty` 时隐藏。

### 2.5 详情页动作收敛

```
.awu-hero .awu-heroActions
  .awu-btn[data-tone="primary"]        ← 1 主（启用/绑定）
  .awu-btn[data-size="md"]             ← 1 次（编辑）
  .awu-menuBtn                          ← ⋯ 溢出菜单（导出 / 改模式 / 换开场白）
.awu-detail > .awu-dangerZone          ← 删除下沉到详情底部（复用现有维护区样式）
.awu-menu                               ← 溢出菜单浮层（Esc/点外部关；焦点归还 ⋯ 按钮）
```

### 2.6 视觉令牌（第 1 批新增，CSS 侧定义、JSX 可读）

| 令牌 | 用途 |
|---|---|
| `--awu-rail-w` | 左栏宽度（默认 336，`<1100` 时 300） |
| `--awu-ctrl-h` / `--awu-ctrl-h-sm` | 控件高度（现 34/38/40/42/44/46 六种 → 收敛到 2 档） |
| `--awu-lh-tight` / `--awu-lh-body` | 整数行高（替掉 27 处 px 字面量） |
| `--awu-line-soft` | 深色下几乎消失的分隔线（统计条/分组头） |
| `--awu-radius-sheet` | 弹层圆角（统一 24，蒸馏不再用 16） |
| `--awu-focus-ring` / `--awu-focus-offset` | 焦点环唯一真源（现 24 条重复、5 种 offset） |

---

## 3. 编排规则（第 2 批执行）

| 场景 | 时长/曲线 | 备注 |
|---|---|---|
| 面板进入 | `T_ENTER` + `EASE`，opacity + scale(.985) | 动画期 `data-still` 去掉 blur |
| 面板/弹层退场 | `T_EXIT` + `EASE_OUT`，只 opacity | 不 stagger、可被打断 |
| tab 切换 | `T_FAST` crossfade | 不带位移，不带 stagger |
| list→detail | `T_MID` + `EASE`，+8px 从右；返回 −8px 从左 | `<900` 用 `data-nav` push/pop |
| 折叠展开/收起 | `T_BASE` / `T_EXIT` | 四套折叠共用一条 |
| 删卡 | 淡出 `T_FAST` → FLIP `T_BASE` 塌陷 | 依赖 `usePresence` + `data-card-id` |
| 环境呼吸 | `T_AMBIENT` 无限，`::after` opacity .35↔.85 | 禁止 box-shadow 动画 |
| 按压 | `T_FAST`，卡片 scale(.995)/按钮 .97/图标件 .94 | 补齐 13 个只有 hover 的控件 |

---

## 4. 降级与例外

- `prefers-reduced-motion: reduce` → 全局守卫（`*,*::before,*::after` 时长 .01ms）；例外仅 `.awu-iconBtn[data-spin] svg`（加载指示）。
- `prefers-reduced-transparency: reduce` → 面板/弹层/专注层/卡片/输入/按钮/trigger/editorFoot/scrim 全部换不透明底（第 1 批补齐 8 个模糊面）。
- `prefers-contrast: more` → 第 3 批新增：`--awu-line` 提到 `line-strong`、ink-mute 提到 ink-dim、去掉玻璃 sheen。
- 指针高光只在 `useFinePointer()` 为真时绑定；`data-fx="off"` 时纯 CSS。

---

## 5. 禁止项（改动即回归）

1. 模板串禁反引号/`${`（`verify-bundle.mjs:64-91` 会真执行模块）。
2. `.awu-toolbar` / `.awu-railActions` / `.awu-btnRow` 三个类名不得改名（`verify-wiring.mjs:816`）。
3. 单一 `<style>` 幂等注入；`createPortal` 变量清单四处类名逐字一致。
4. `a11y.ts` 三 hook 与 `escYield` 让位协议不拆不改序。
5. `ink-faint` 只作装饰，不作文本色。
6. 卡片高整数 px、hover 只提亮不压暗、错峰 `min(index,8)×34ms` 不放大。
7. 每批结束必须 `npm run build` 全绿（基线 1032 项）。

---

## 6. 第 1 批落地勘误（2026-11-02，以实际代码为准）

写到这里的都是「实现与上面的设想不一致、但已经过验收」的条目，后续批次按本节执行。

| 项 | 设想 | 实际落地 | 后续 |
|---|---|---|---|
| 行高令牌 | `--awu-lh-tight/_body` 改整数 px | 该两枚是被 100+ 处引用的**比例值**，改整数会把 22px 标题压成 1.0；改为新增 `--awu-lh-px-18/20/22/23/24` + 别名 `--awu-lh-tight-px/-body-px` | 保持，不再改名 |
| 退场属性 | `data-closing="true"` | CSS 实际用 `[data-state="closing"]`（与 `presenceAttrs()` 一致），并兼容 `data-closing` | 第 2 批**统一为 `data-state`**，删兼容 |
| 分段器滑块 | 只写 `--awu-tab-i/-n` | 已落，实测 1440 下 157px、1024 下 134px；`.awu-tab[data-on]` 自底已删 | 完成 |
| 左栏选中轨 | `data-selected` + box-shadow | 实际用 `::before` 蓝轨（2px，左侧，上下各留 14%）—— 因为 `[data-live]` 的金色呼吸动画驱动的正是 box-shadow，会互相覆盖 | 完成 |
| `<900` 导航 | CSS `[data-nav]` 管布局 | `push` 由 CSS 覆盖（visibility 保滚动位）；`split` 由 **JSX 不挂载 `.awu-main`** 实现（CSS 无 split 规则） | 第 2 批 pop 退场时保持该契约 |
| `railNow` 隐藏 | `[data-empty]` | 必须是 `[data-empty="true"]`（React 会把 `false` 序列化成字符串 `"false"`，属性存在性选择器会把两者都命中） | 完成，**新属性一律带值匹配** |
| 指针高光 | JS 写内联 `--awu-mx/-my` | CSS 侧 `::after` 已就绪（240px 圆，静息 .85 / hover 1，仅 fine pointer），**JS 未接** | 第 2 批接：`useFinePointer()` + rAF 合帧 + `[data-fx="off"]` 开关 |
| 动画期降模糊 | `data-still="true"` | CSS 已就绪，**JS 未接** | 第 2 批接：面板 `animationstart/end` 挂属性 |
| 死代码 `SCOPED_ATTR` | 删 | `index.tsx:102` 仍 import，CSS 侧已确认无 `[data-awu-scoped]` 规则 | 第 2 批随 index.tsx 一起删 |
| 「退出全局」入口 | 唯一 | 状态带右侧与 ⋯ 菜单各一份（重复） | 第 2 批去重（保留菜单项，状态带改为纯状态） |

---

## 7. 进场机制修正（2026-11-02 主人实测报「二段式」后重做）

**现象**：打开面板时先半透明发白，顿一下才变实。**根因（CDP 逐帧采样）**：进场走的是
「动画期摘掉 `backdrop-filter` → `animationend` 装回去」，而 blur 与 box-shadow 都不可过渡，
所以 t≈401ms 发生了一次硬切（`none` → `blur(18px) saturate(1.85) brightness(1.03)`，投影同时换档）。

**两条被否掉的路**：
1. 保持模糊 + 给面板播 opacity/scale —— 面板 1.1M px 的模糊要逐帧重采，本机实测直接卡在首帧；
2. 摘模糊省成本 + 结束时装回 —— 就是上面那次硬切。

**最终做法**：玻璃**不参与任何动画**，在挂载首帧完整就位并恒定；新增不参与模糊的外壳
`.awu-panelFade`（`position:fixed; inset:0; pointer-events:none`，面板自身 `auto`），用
`transition: opacity` + `@starting-style { opacity: 0 }` 做**一次纯合成淡入**，100vmax 压暗随之一起淡。

**为什么用 `@starting-style` 而不是 keyframes + `fill:both`**：后者在"动画不跑"的环境里会把面板
永远停在 `opacity:0`（本机无头环境实测复现）；前者的终态就是 `opacity:1`，最坏情况只是没有淡入。

**代价与遗留**：面板不再有位移/缩放（放大入场这条手感没了）；弹层（sheet）仍是 `translateY` 入场，
它们的 `data-still` 现在只买 `will-change`，如果哪天报卡顿，用同一招给弹层也套一层外壳。
