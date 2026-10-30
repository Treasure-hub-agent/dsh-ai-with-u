# 面板设计语言换血 · iOS Liquid Glass（2026-10-30）

> 交付：`client/styles.ts` 已整体重写（2433 行，`PANEL_WIDTH = 1120` / `PANEL_MAX_H = 80`）。
> 本文给 Lead 三样接线材料（§3/§6）、材质与 token 全表（§2/§4）、以及编辑器布局判断（§7）。
> 约束遵守：只动 `styles.ts`；`index.tsx` / `entry.tsx` / `text.ts` 未碰；`.awu-distill-*` / `.awu-guide-*` 归各自文件，我的规则在 `${GUIDE_CSS}${DISTILL_CSS}` 之前，级联顺序天然让它们赢。

---

## 1. 一句话结论

旧「夜繭」是**深夜烛光 + 小气泡**；新语言是**白天玻璃 + 1120 大窗**。两者的差别不只是颜色，是三条硬规则：

| # | 规则 | 落地 |
|---|---|---|
| R1 | **结构是权威，皮肤是投影**（沿用 v2 的主张）| 所有颜色/字号/间距/圆角/时长只经 token，规则层不写字面量 |
| R2 | **暖金降级成「角色专属色」** | 只出现在头像、角色名、启用态辉光/描边；其余全走 iOS 灰阶 + 系统蓝 |
| R3 | **衬线只留给「人物感」** | 角色名（卡片/横幅/详情/编辑器）+ 日记正文；其余无衬线 |

## 2. 材质参数（液态玻璃的四层）

| 层 | 用途 | 深色 | 浅色 |
|---|---|---|---|
| `glass-1` | 面板底、segmented 选中块 | `rgba(28,28,30,.72)` | `rgba(255,255,255,.72)` |
| `glass-2` | 卡片 / 分组 / 状态带 | `rgba(58,58,60,.42)` | `rgba(255,255,255,.62)` |
| `glass-3` | 浮起元素（输入底、分段器槽、hover）| `rgba(120,120,128,.22)` | `rgba(120,120,128,.14)` |
| `surface-field` | 输入框/代码块底 | `rgba(0,0,0,.22)` | `rgba(120,120,128,.10)` |

**blur 分两级**（这是本轮的性能关键，见 §8）：

| token | 值 | 用在哪 |
|---|---|---|
| `--awu-blur-panel` | `blur(16px) saturate(160%)` | 面板本底（1120×900 的大面积）|
| `--awu-blur` | `blur(30px) saturate(180%)` | 小面积：侧栏入口、sheet、专注层、编辑器底栏 |

高光：`--awu-specular: inset 0 1px 0 rgba(255,255,255,.20)`（深）/ `…,.92)`（浅），贴在每张玻璃卡的顶边。
压暗：`--awu-scrim-bg`（深 `rgba(0,0,0,.34)` / 浅 `rgba(0,0,0,.20)`）；面板的遮罩用 `box-shadow: … 0 0 0 100vmax var(--awu-scrim-bg)` 实现，**零 DOM 改动**。

## 3. 两栏骨架：嵌套顺序与内容分配（Lead 要的第 1、2 项）

### 3.1 嵌套顺序

```
.awu-panel                      ← 已有；1120×(100vh−80)，圆角 24，玻璃底
├─ .awu-head                    ← 已有，全宽
├─ .awu-status                  ← 已有（现为 .awu-sigil/.awu-idle 别名），全宽
└─ .awu-workspace               ← 新增，flex row，flex:1，min-height:0
   ├─ .awu-rail                 ← 新增，左，width: var(--awu-rail-w)=340，border-right
   │  ├─ .awu-toolbar           ← 已有类，放这里（计数 · 新建 · 蒸馏入口）
   │  ├─ .awu-tabs              ← 已有类，放这里（4 tab segmented）
   │  └─ .awu-pane              ← 新增，可滚动，放列表/目录
   └─ .awu-main                 ← 新增，右，flex:1，可滚动
      ├─ .awu-stats             ← 已有类，放在 main 顶部（全局读数）
      └─ .awu-pane              ← 新增，可滚动，放 tab 内容
```

两个 `.awu-pane` 各自独立滚动；`.awu-body` **保留**（旧单栏结构仍可用，样式没删）。

### 3.2 谁进 rail、谁进 main

| 块 | 位置 | 理由 |
|---|---|---|
| 头部（kicker/标题/刷新/关闭）| **全宽**（head）| 是窗框，不属于任何一栏 |
| 状态带（启用中 / 未启用 / 错误 / 提示）| **全宽**（head 下）| "当前在扮演谁"是全局状态，两栏都要看 |
| 工具行（计数 + 新建 + 蒸馏入口）| **rail** | 操作的对象是左栏那张列表 |
| 分段器（4 tab）| **rail** | 切的是左栏列什么，右栏跟着变 |
| 角色卡列表 | **rail**（`.awu-pane`）| 340 宽下单列行卡，正好是 iOS 侧栏 |
| 统计条（3 指标）| **main 顶部** | 340 塞 3 个指标会挤；放右栏顶部当"仪表行" |
| 详情页 / 日记 / 统计明细 / 指南 | **main**（`.awu-pane`）| 内容区 |

**tab 与 rail 的关系（建议的最小接线）**：
- `roster`：rail = 角色列表；main = 选中角色的详情（未选则空态"从左栏选一张卡"）。
- `diary` / `stats` / `guide`：**rail 显示什么可以先不动**（继续显示角色列表），main 换成对应内容。二期再让 rail 随 tab 变（diary→关系条+日期目录，guide→目录）。这样第一版 JSX 改动最少，且不会出现"左栏空着"。

### 3.3 断点

只有一条：`@media (max-width: 900px)` → `.awu-workspace` 改 `display:block`、rail 改 100% 宽、`.awu-gutter` 降到 20。
**代价写清**：这是项目第一个响应式断点，意味着视觉 QA 从「单栏 × 2 主题」变成「单栏 + 两栏 × 2 主题」；但 1120 主面板在 <900 视口下强行两栏会两边都不可用，这条断点是必要的。

## 4. Token 全表（只列变更/新增）

### 4.1 颜色与实测对比度（WCAG 2.1，按玻璃合成后的等效底色算）

| token | 深色 | 对 `#2C2C2E` | 浅色 | 对 `#FBFBFB` |
|---|---|---|---|---|
| `--awu-ink` | `#f2f2f7` | **12.49** | `#1c1c1e` | **16.44** |
| `--awu-ink-dim` | `rgba(235,235,245,.75)` | **7.31** | `rgba(60,60,67,.82)` | **6.22** |
| `--awu-ink-mute` | `rgba(235,235,245,.60)` | **5.29** | `rgba(60,60,67,.72)` | **4.69** |
| `--awu-ink-faint` | `rgba(235,235,245,.28)` | 2.26（仅线条）| `rgba(60,60,67,.28)` | 1.65（仅线条）|
| `--awu-accent` | `#0a84ff` | 3.82（**只作装饰**）| `#007aff` | 3.88（只作装饰）|
| `--awu-accent-strong` | `#0a6fe0` | 白字 **4.81** | `#0066cc` | 白字 **5.57** |
| `--awu-accent-text` | `#5ab0ff` | **6.03** | `#0066cc` | **5.38** |
| `--awu-gold`（角色色）| `#e8c07a` | **8.13** | `#8a5f1e` | **5.43** |
| `--awu-danger` | `#ff6b61` | **5.00** | `#d70015` | **5.20** |
| `--awu-teal` | `#30d158` | **6.89** | `#1e7a33` | **4.62** |
| `--awu-on-accent` | `#ffffff` | — | `#ffffff` | — |
| `--awu-on-character` | `#2b1d0a` | 对 gold 9.55 | 同 | 7.28 |

**没抄 iOS 原值的两处**（都因为原值不达标）：`systemBlue` 当文字只有 3.82 → 拆出 `accent-text`；浅色 `systemGreen #34c759` 只有 2.7 → 用 `#1e7a33`。

### 4.2 字号 / 行高 / 间距 / 圆角 / 尺寸 / 动效

| 类 | 值 |
|---|---|
| 字号 9 档 | 10 / 11 / 12 / 13 / 14 / 15 / 18 / 22 / 26 |
| 行高 4 档 | tight 1.25 · snug 1.4 · body 1.65 · loose 1.8 |
| 间距 10 档 | 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32；`--awu-gutter: 32`；`--awu-content-max: 760`；`--awu-rail-w: 340` |
| 圆角 6 档 | xs 8 · sm 10 · md 12 · lg 16 · xl 24 · pill 999 |
| 尺寸 7 档 | hit 28 · icon 32 · mark 28 · rail 36 · avatar 38 · avatar-lg 56 · empty 56 |
| 动效 | 缓动 `cubic-bezier(.32,.72,0,1)`；时长 .12 / .18 / .24 / .34 / .6 / breathe 3.4s |
| 层级 | `--awu-z-panel: 2147482000` · `--awu-z-scrim: 2147482100` · `--awu-z-inset: 5`（**值未变**） |

## 5. 每个模块的 iOS 映射

| 模块 | 旧（夜繭）| 新（Liquid Glass）| 关键实现 |
|---|---|---|---|
| 侧栏入口 | 暖底 + 金渐变徽记 | 玻璃胶囊；徽记仍是角色色渐变 | `.awu-trigger` 用 `--awu-glass-2` + specular；启用态只留一圈金色呼吸 |
| 面板 | 侧吸小气泡 452px | 居中大窗 1120×(100vh−80)，圆角 24 | 见 §3.1；遮罩用 100vmax 阴影 |
| 头部 | 20px 衬线标题 + 金色 kicker | 22px 无衬线粗标题 + 灰 kicker；`em` 走 `accent-text` | 标题不再用衬线（衬线只留给名字）|
| 状态带 | 金渐变横幅 | 四态一形：live=角色色轨 / idle=虚线 / info=蓝调 / alert=红调 | `.awu-status[data-status]`，旧 `.awu-sigil`/`.awu-idle` 仍生效 |
| 统计条 | 三格 + 19px 衬线数字 | 三格 + 18px 无衬线等宽数字，格间 1px 发丝 | 数字用 `tabular-nums` |
| 分段器 | 下划线 tab | **iOS segmented**：灰槽 + 选中白块 + 细影 | 同 `.awu-tabs`/`.awu-tab[data-on]`，**无需改标记** |
| 角色卡 | 双列小卡 + 金渐变填充 | 240px 起 4 列；玻璃卡 + specular；启用卡只描边 + 呼吸 | `.awu-card[data-live]` 不再渐变填充 |
| 按钮 | 渐变主按钮 | 系统蓝实心（`accent-strong`）+ 白字；ghost/danger/edit 三档 | `.awu-btn[data-kind]`；`.awu-editEntry` 旧类保留 |
| 详情分组 | 带描边的小卡 | **inset grouped list**：无描边、圆角 16、卡内发丝行 | `.awu-section` / `.awu-field` 96→104px 标签列 |
| 日记 | 金色竖轴 + 衬线正文 | 竖轴降为 30% 金线；**正文仍衬线**（人物感锚点）| `.awu-line` 保持 serif，`--awu-fs-body-lg` |
| 编辑器 | 452 内全屏表单 | 880 居中单栏 + inset 分组（见 §7）| `.awu-editor max-width:880` |
| 弹层 | 居中 420 卡 | **iOS sheet**：底部浮起、760 宽、圆角 24、顶部 grabber、滑入 | `.awu-scrim` 改 `align-items:flex-end`；`.awu-dialog::before` 画 grabber |
| 专注层 | 452 整屏 | 760 内容宽的整面板层（长文本）| `.awu-focus*`，未接线 |

## 6. JSX 接线清单（Lead 要的第 3 项）

> 行号基于提交 `fba3ff5` 的 `client/index.tsx`（1678 行）。**只列需要动的**；纯样式自动生效的没列。

| # | 文件:行 | 现状 | 改成 | 为什么 |
|---|---|---|---|---|
| J1 | `index.tsx:1196-1201` | `panelStyle` = `top/left/width/height/transform` | 已由你改成 `left:0; right:0; margin:'0 auto'` + `top:40` + `height:'calc(100vh - 80px)'` ✅ | — |
| J2 | `index.tsx:1412-1417` | `<div className="awu-body" id="awu-tabpanel" …>` 单栏 | 包成两栏：`<div className="awu-workspace"><aside className="awu-rail">…工具行+分段器+<div className="awu-pane">列表</div></aside><main className="awu-main"><StatStrip/><div className="awu-pane" id="awu-tabpanel" role="tabpanel">…tab 内容</div></main></div>` | 1120 下单栏列表会像三块孤岛 |
| J3 | `index.tsx:1436-1455` | 工具行（`.awu-toolbar`）在 body 顶部 | 移到 `.awu-rail` 顶部 | 操作对象是左栏列表 |
| J4 | `index.tsx:1391-1416` | `.awu-tabs` 在 body 上方 | 移到 `.awu-rail`，工具行之后 | 切的是左栏内容 |
| J5 | `index.tsx:211` / `1397` | `<StatStrip/>` 在 head 下方全宽 | 移到 `.awu-main` 顶部 | 右栏仪表行 |
| J6 | `index.tsx:1413` | `id="awu-tabpanel"` 挂在 `.awu-body` | 改挂到 main 里的 `.awu-pane`（`role="tabpanel"`/`aria-labelledby` 跟着走）| `aria-controls` 指向的必须还是同一个 id |
| J7 | `index.tsx:1331/1370/1382` | 已是 `.awu-status awu-sigil` + `data-status` ✅ | 保留双类（`.awu-sigil` 别名在，别删）| 我的 CSS 两者都认 |
| J8 | `index.tsx:1391` 起 tablist | 4 tab 标记已带 `id`/`aria-controls`/roving tabindex ✅ | 不需要改 | segmented 只吃 `.awu-tab[data-on]` |
| J9 | `index.tsx:1454` | `<DistillEntry t={t} />` | 不动（已接线）；如果放进 rail，宽度会自动 340 满宽 | 蒸馏样式归 distill.styles.ts |
| J10 | `index.tsx:1288` `<CardEditor>` | 直接渲染在 `.awu-panel` 里 | 不动 | 编辑器自带 880 居中（§7）|
| J11 | 新增 | — | 需要时给卡片网格加 `data-shape`（见 §9 遗留） | 骨架屏形状 |

**不需要改的**：`.awu-body` 保留（旧结构仍能跑）、弹层 6 个（sheet 样式自动生效，`Overlay` 的 DOM 不用动）、编辑器内部（分组/字段样式同名替换）。

## 7. 编辑器在 1120 下：单栏，不两栏

**结论：单栏 880 居中，内容 760。不做两栏。**

| 依据 | 数字 |
|---|---|
| 单栏可读行宽 | 760px ÷ 14px 衬线 ≈ **54 汉字/行**（推荐 25–45；衬线正文略宽可接受）|
| 两栏方案 | 每栏 ≈ 370px，减去 32 内距 + 24 缩进后正文仅 ≈ 314px ≈ **22 汉字/行**，长句断行碎 |
| 内容性质 | 34 字段是**线性填卡流程**，两栏会把顺序切成 17+17，阅读路径断裂 |
| 已有解法 | 长文本走**专注层**（760 内容宽、整面板高、本地缓冲），比两栏更合适 |

所以编辑器：`.awu-editor { max-width: 880px; margin: 0 auto }`，`.awu-editorBody` 内容 760 居中，**两侧留白是刻意的**（像 iPad 设置页）。分组仍是单列 accordion；每个分组是 inset list 卡。

**焦点三件套**（`card-editor.tsx` 的 `useRestoreFocus/useInitialFocus/useFocusTrap` 挂在 `editorRef`/`confirmRef` 上）：我**没有改任何 DOM 层级**，只改了宽度与圆角，ref 节点不变 → 无障碍不受影响。将来加专注层时按 v2 §4.4 的顺序追加第三对 hook，不要插到现有三行中间。

## 8. 性能（1120 大窗的两条红线）

1. **blur 分级**：面板本体 `blur(16px)`（面积 1120×900），只有弹层/专注层/入口用 `blur(30px)`。旧值 30px 铺满整块面板在核显上会掉帧。
2. **动画只碰 transform / opacity / scale**：入场用独立 `scale` 属性 + `translateY`，**不用 translateX**（会覆盖 `left/right/margin:auto` 的居中，复现"先出现在右半边再跳回中间"）。`transform-origin: center`。`will-change: transform, opacity` 只挂在面板上——面板随开合挂载/卸载，不会长期占着合成层。
3. **降级**：`@media (prefers-reduced-transparency: reduce)` 关掉玻璃（退纯色）；`prefers-reduced-motion` 关掉全部入场/循环动画（含新增的 sheet、专注层）。
4. **编辑器输入手感**（你提的那条）：本次只改了皮肤，`card-editor.tsx` 的「每键两次整卡 `JSON.stringify` + `mergeCard` + `filledCount`」**没有动**（按排期等 CCv3 定稿）。在 1120 下它更明显，但解药是 v2 §4 的专注层本地缓冲 + `dirty` 改 revision 计数，属于编辑器的施工范围，不是这次的样式换血。

## 9. 自检结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck:client` | **0 error** |
| `node scripts/build-client.mjs` + `verify.mjs` | **通过**（`lib/client.js` 243.2 KB，ModuleLoader 格式、react external 正常）|
| `font-size:\s*[0-9]` | **0**（字号全 token）|
| `html:not([data-ds-dark-theme])` | **4 行**（同一个浅色变量块的 4 个选择器，组件级补丁 0）|
| `z-index:\s*[0-9]` | **0** |
| `width:\s*(452\|720\|1120)px` | **0** |
| 花括号配平 | 369 / 369（改后仍平衡）|
| 类名覆盖 | 旧 `styles.ts` 里 139 个 `awu-*` 类 → 新文件 176 个，**旧类零丢失**（脚本比对）|

**`npm run build` 目前红**：卡在 `src/tavern.ts`（1216/1230/1240/1354 行：`maxEntries` / `turnSeed` 不在 `LoreSelectOptions` / `LoreSelectionDiagnostics` 类型里）。那是 tavern 线的未完成改动，与本轮样式无关；前端那条链路（`tsc -p tsconfig.client.json` + esbuild + verify）我已单独跑通。

## 10. 遗留 / 下一步

1. **J2/J3/J4/J5 是接线主体**（两栏骨架），建议你一次做完再刷新，避免中间态两栏各半。
2. 骨架屏 `data-shape="cards"` 仍等编辑器/列表改造一起接（`.awu-sk[data-shape]` 已就绪）。
3. 专注层（`.awu-focus*`）、世界书两栏（`.awu-loreSplit`）、词条 chips（`.awu-chips*`）、CCv3 预览（`.awu-nativeField` / `.awu-jsonView`）样式已全部就绪，等 v2 的组件落地即可直接接。
4. 世界书在 1120 下**改用两栏**（`.awu-loreSplit`：320 列表 + 1fr 内容，<900 收单栏），v2 §3 的手风琴方案降级为窄屏兜底——这是你上一条问的"要不要重做"，答案是：**两栏为主，手风琴保留为断点内的形态**。
