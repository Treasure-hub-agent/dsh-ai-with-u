# A · 设计系统 / 样式层审查（dsh-ai-with-u）

> 检查员：inspector-styles（只读阶段）
> 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u`，HEAD `a7b5799`，工作区干净
> 范围：`client/styles.ts`（3587 行）+ `client/distill.styles.ts`（256 行）+ `client/guide.styles.ts`（203 行）的 CSS 层；为交叉验证读了 `client/*.tsx` 的类名接线与 `scripts/verify*.mjs` 的断言
> 未做：任何文件修改、npm build、运行时截图（浏览器实测项已标 ⚠️待确认）

## 0. 统计口径与总量

| 指标 | 数值 | 说明 |
|---|---|---|
| 规则块（rule） | **599** | styles 541 / distill 33 / guide 25 |
| 声明（declaration） | **2775** | 同上三文件 |
| CSS 类 | **279** | 其中 **21 个（7.5%）在 tsx 里出现 0 次**，≈171 行死代码 |
| 设计令牌 | **98** | 深色块 `styles.ts:55-207`；浅色覆盖 **37** 个（`styles.ts:213-259`） |
| `var(--awu-*)` 引用 | **1488** 次，实际用到 **93** 个 token | 定义但无人引用 **5** 个 |
| 硬编码颜色（规则层） | **18** 个值（9 hex + 9 rgba），集中在 **6 簇** | styles.ts 规则层；distill 另有 33（全是 var 回退值） |
| 硬编码 `font-size` | styles **0** / distill **11** / guide **14** | styles 层的纪律是真的 |
| 硬编码 `line-height` | **27** 处（15/16/17/…/24px） | 与 `--awu-lh-*`（比例值）并存 |
| 硬编码控件高度 | **12 种**（22/24/26/32/34/36/38/40/42/44/46/76px） | 无控件高度 token 层 |
| `!important` | **3**（2 在 styles 3559/3563，1 在 distill 233） | 全部在 a11y 降级块，用法正确 |
| `transition: all` | **0** | ✓ |
| `animation` 声明 | **18** 条，`@keyframes` **13** 个 | 降级块覆盖 15 条，漏 3 条 |
| `backdrop-filter` 面 | **8** 处（+1 处显式 none） | 降级只关掉 4 处 |
| `@media` / `@supports` | 7 块：`max-width:900px` ×3、`prefers-reduced-transparency`、`prefers-reduced-motion`、`@supports(animation-timeline)`、distill 的 reduced-motion | 没有 720px 断点 |
| `z-index` 声明 | **4**，全部 `var(--awu-z-*)` | ✓ |
| `color-mix()` | **73** 处 | Chromium 可用；旧版 Firefox 会整条失效 |
| tsx 内联样式 | **80** 处（index 41 / preset-view 26 / preview 5 / lorebook 3 / card-editor 2 / diary-review 2 / distill 1） | 绕开设计令牌的第二条通道 |

**一句话结论**：`styles.ts` 的规则层纪律很好（字号/层级/时长全 token，颜色几乎全 token），真正的问题集中在 **三处**：① 子模块 (`distill/guide`) 与 tsx 内联样式形成了"第二套像素体系"；② a11y 降级只覆盖了自己声称的一部分；③ 深浅两套色板里"浮起/下沉"的语义在浅色下反转，且有几处深色专用字面量漏进浅色。

---

## 1. 设计令牌纪律

### F1 · 缺三层 token：控件高度 / 整数行高 / 滚动区高度（**P1 / M**）

- **证据**：`styles.ts:286`(44px)、`1214`(34px)、`1281`(38px)、`1289`(40px)、`1290`(44px)、`2269`(40px)、`2517`(42px)、`3222`(32px)、`1654`(36px)、`1946`(64px) + `--awu-size-*` 只有 7 档（`styles.ts:163-170`）
- **现象**：只有 `hit/icon/mark/rail/avatar/avatar-lg/empty` 七个"部件尺寸"被 token 化，**控件高度完全没进 token**（34 = 默认按钮、38 = md、40 = block/输入、42 = `.awu-input`、44 = trigger/lg、46 = `.awu-cardBlurb` 两行高、76 = 骨架行高…）。这些值散落在 12 个不同规则里，改"整体控件手感"要全文件翻。
- **为什么是问题**：这是 R1「规则层不写字面量」的**最大缺口**，也是唯一一处真的会导致"想统一调整却改不干净"的地方（行高同理：`--awu-lh-*` 是比例，而 `styles.ts:1147-1150` 明确决定卡片用整数 px 行高 22/23，比例 token 表达不了这个决定）。`distill`/`guide` 里 gap/margin/font 全部字面量，等于第二套体系。
- **建议**：加一组 `--awu-ctl-h-sm/md/lg`（28/34/40）、`--awu-ctl-h-input`(42)、`--awu-lh-22/23/24`（或统一改叫 `--awu-lh-fixed-*`）、`--awu-scroll-max-*`（132/220/260/320）。distill/guide 的 spacing 全部映射到 `--awu-gap-*`（它们现在 6/8/10/12/14/20 有 5 档能直接对应）。

### F2 · 圆角越级 4 处（**P2 / S**）

- **证据**：`styles.ts:1946` `border-radius: 20px`（空态徽标，圆角表里没有 20）；`distill.styles.ts:183,189` `2px`；`distill.styles.ts:203` `999px`（应走 `--awu-r-pill`）；`border-radius: 50%` ×4（`styles.ts:391,1583`、`distill:109`、`guide:128`）
- **建议**：20 → `--awu-r-xl`(24) 或补 `--awu-r-2xl`；999px → `--awu-r-pill`；50% 属于"正圆"，可留但建议补一个 `--awu-r-circle: 50%` 语义别名。

### F3 · 6 个无限动画时长没 token（**P2 / S**）

- **证据**：`styles.ts:399` 2.6s、`670` .9s、`683` 1.1s、`1054` 3.6s、`2006` 1.4s、`distill:191` .26s
- **现象**：`--awu-dur-1..5` + `--awu-dur-breathe` 之外，还有 6 个裸时长；其中 4 个是 `infinite` 循环（用户会长期盯着）。
- **为什么是问题**：循环动画是最该被统一调慢/调快的一类（省电、晕动症），现在分散在 4 个规则里。
- **建议**：补 `--awu-dur-pulse: 2.6s`、`--awu-dur-glow: 3.6s`、`--awu-dur-shimmer: 1.4s`、`--awu-dur-spin: .9s`、`--awu-dur-progress: 1.1s`、`--awu-dur-bar: .26s`。

### F4 · 5 个定义但零引用的 token（**P2 / S**）

- **证据**：`--awu-surface-foot`(92/237)、`--awu-gold-hi`(106)、`--awu-grad-soft`(109)、`--awu-pink`(115)、`--awu-size-empty`(170) 在 `client/` 全部源码里 `var()` 引用数为 0
- **建议**：删，或补上对应规则（`--awu-surface-foot` 明显是给编辑器底栏准备的，但 `styles.ts:2368` 用的是 `glass-2`）。

### F5 · 4 级 ink 自洽，但 ink-faint 被当图标色用（**P1 / S**）

- **证据**：`styles.ts:82` 注释"仅线条/装饰"；实际 `styles.ts:1141`（`.awu-cardChevron`）、`1344`（`.awu-detailNavTitle::before`）、`2176`（`.awu-editGroupChevron`）、`647`（`.awu-countSep`）都拿它当**前景色**
- **为什么是问题**：`ink-faint` 在深色下是 30% 白（≈1.5:1），浅色下是 30% 深灰（≈2.5:1）。装饰没问题，但 **chevron 是"这里可以展开/点进去"的唯一视觉线索**，属于 WCAG 2.1 SC 1.4.11 的非文本对比（要求 3:1）。
- **建议**：三个 chevron 改 `--awu-ink-mute`（或新增 `--awu-ink-icon` = mute 一档）；`::before` 分隔符与 `·` 保留 faint。四级 ink 本身自洽（4 档都用到了，无孤立档）。

### F6 · 3 层玻璃语义超载：`glass-3` 同时当"浮起底"与"hover 罩"，且深浅两态方向相反（**P2 / M**）

- **证据**：槽底用 `--awu-glass-3`：`styles.ts:808`（分段器槽）、`914`（模式胶囊槽）、`2702`（编辑器 tab 槽）；hover 罩也用 `glass-3`：`304`、`428`、`1230`、`1251`、`1274`。浅色值 `styles.ts:218` = `rgba(120,120,128,.13)`（灰、比卡面**深**），深色值 `styles.ts:64` = `rgba(120,120,128,.20)`（白灰、比卡面**浅**）。
- **为什么是问题**：同一 token 承担"凹陷槽"和"抬起反馈"两种相反语义；浅色下它比卡面深（下沉），深色下比卡面浅（上浮）。而文件自己在 `styles.ts:1035-1036` 明确写过"灰色叠加层会让整套变暗，主人不喜欢"——按钮/图标按钮的 hover 正好是那种灰色叠加。
- **建议**：拆 `--awu-surface-slot`（槽）/ `--awu-surface-hover`（hover 罩），深浅各自定值；或者 hover 统一走 `glass-2-hi`（卡片已用这条，效果已被主人认可）。三层玻璃的"层数"本身没问题，问题在命名与用途。

### F7 · `--awu-surface-*` 与 `--awu-glass-*` 迁移不彻底（**P2 / S**）

- **证据**：`var(--awu-surface-*)` 引用 **53** 次，`var(--awu-glass-*)` **30** 次；`styles.ts:84` 注释称 surface 是"外部模块按老名字引用"的别名，但 styles.ts 自己新写的规则也在用老名字（`1469`、`1832`、`2570`、`2866`…），而同一概念的另一些规则用新名字（`1022`、`1520`、`2139`）。另外 `.awu-dialog` 用 `--awu-surface-dialog`（86% 不透明），`.awu-editorConfirmCard` 用 `--awu-surface`（= glass-1，66%），两个同层级浮层用了相差 20% 透明度的不同 token。
- **建议**：定一条规则——**语义面走 surface，材质层走 glass，二者不混**；或直接删除旧别名（外部只有 distill/guide 两个模块用 `surface-2`，改 4 处即可）。

### F8 · 阴影/elevation 只有 4 档，3 处硬编码（**P2 / S**）

- **证据**：token 侧只有 `shadow-card` / `shadow-card-hi` / `shadow` / `specular`（`65-66,72,201`）；硬编码：`styles.ts:330`、`1081`（头像 insets + 黑投影）、`735`（状态带扫光）、`837`（选中 tab 黑投影）、`2002-2004`（骨架渐变）。hover 阴影同样内联在 `1052-1053`、`1241`、`1247`。
- **建议**：补 `--awu-shadow-1/2/3` 三级 elevation + `--awu-sheen-soft`；把 tab/头像的黑投影换成 `--awu-shadow-card`。

---

## 2. 重复与腐化

### F9 · 21 个死类 / ≈171 行从未渲染的 CSS（**P2 / M**）

- **证据**（tsx 里出现 0 次，已剥离注释后验证）：`.awu-body`(843-860,864)、`.awu-loreSplit/.awu-lorePane/.awu-loreDetail`(2681-2693)、`.awu-editorTabs/.awu-editorTab`(2695-2720)、`.awu-budgetTag/.awu-levelTag/.awu-fieldCount`(2738-2760)、`.awu-chips/.awu-chip/.awu-chipX/.awu-chipInput`(2763-2822)、`.awu-nativeField/.awu-jsonView`(3421-3439)、`.awu-stack`(3442)、`.awu-modeOption/.awu-modeOptionRow/.awu-modeOptionText/.awu-modeLabel/.awu-modeHint`(3452-3456)
- **现象**：`styles.ts:2676-2678` 已声明"预留模块（世界书/词条/CCv3 预览）组件尚未接线"，那部分是**有意**的；但 `.awu-modeOption*`（旧 452px 设计里"模式选项当按钮列表"的形态）和 `.awu-body`（两栏改造后已被 `.awu-pane` 取代，`index.tsx:2557` 只剩一行注释提到它）**没有任何文档认领**，是纯残留。
- **建议**：预留块保留但集中到一个带 `/* reserved */` 分区（并加"接组件时删本节"的清单）；`.awu-modeOption*` 与 `.awu-body` 直接删（`-60` 行）。

### F10 · 7 处 `font-family` 死声明 + 文末注释与实现矛盾（**P2 / S**）

- **证据**：`styles.ts:1908`(.awu-textarea serif)、`2285`(.awu-editArea)、`2313`(.awu-editListText)、`2058`(.awu-editorName)、`2552`(.awu-previewName)、`2644`(.awu-focusInput)、`2653`(.awu-focusRead) 全部声明 serif，随后被文末同权重、后出现的 `styles.ts:3463-3469` 统一改回 `--awu-sans` → **7 条声明永不生效**。
- **更糟**：`styles.ts:3458-3459` 的注释写"衬线只留两处：角色名（.awu-cardName/.awu-heroName/.awu-sigilName）与日记正文（.awu-line）"，但实测这 4 个类**自己就写着 `font-family: var(--awu-sans)`**（`1117`、`1365`、`769`、`1606`）。真正还留衬线的只有 `.awu-mark`(325) 与 `.awu-avatar`(1075) 两个字形块 → 设计文档 R3「衬线留给人物感」实际**只剩头像首字**。
- **为什么是问题**：下次任何人要"恢复角色名衬线"，会照着 3458 的注释去找，结果改完没反应（被文末块覆盖）；而且 7 处死声明让人误判当前状态。
- **建议**：删 7 处 serif 声明；把 3458-3459 注释改成事实（"衬线只剩头像/徽标首字；名字与日记已在 2026-10-30 改黑体"）；设计文档 R3 同步。

### F11 · 滚动条三段式复制 ×3（**P1 / S**）

- **证据**：`styles.ts:526-538`（`.awu-pane`）、`853-860`（`.awu-body`，死代码）、`2120-2131`（`.awu-editorBody`）；另 `2629-2632`（`.awu-focusBody`）只写了 `scrollbar-width/color` 缺 webkit 三件套 → **专注层（长文本编辑）滚动条在 Chromium 上是默认粗条**。
- **为什么是问题**：同一套"细轨 + hover 显形"逻辑抄了三遍，第四处漏抄；改手感要改 3 个地方。
- **建议**：合并成 `.awu-pane, .awu-editorBody, .awu-focusBody { … }` 一组选择器，删掉 `.awu-body` 那份。

### F12 · 焦点环 24 处重复、offset 5 种取值（**P1 / S**）

- **证据**：24 条 `:focus-visible` 规则全部写 `outline: 2px solid var(--awu-accent)`，`outline-offset` 分别取 `1px`(9 处)/`2px`(5)/`-2px`(7)/`3px`(1，`3346`)/`4px`(1，`2662`)；`styles.ts:312/669/840/934/973/1047/1232/1325/1643/1694/1770/2171/2336/2357/2662/2720/2893/2957/2977/2996/3054/3253/3346` 等
- **现象**：`-2px`（内描边）与 `+2px`（外描边）混用于同类可点元素（例如 `.awu-tab` 与 `.awu-modePill` 都是分段控件里的按钮，前者 -2、后者 +1）。
- **建议**：补 `--awu-ring-width: 2px` / `--awu-ring-offset: 1px`，把 24 条收敛成 2~3 条分组选择器（`outline` 不能继承，但可以 `:where(...)` 合并选择器）。

### F13 · `.awu-presetRow` 同选择器拆两段（**P2 / S**）

- **证据**：`styles.ts:3120-3126` 与 `3198-3199`（两条规则无共享属性，纯碎片化）。同文件 `2722-2732`（`.awu-exportPill`）也有 22 行/3 段的碎片。
- **建议**：合并相邻规则，纯审美+可读性。

### F14 · `.awu-panel` 的 width/height/max-height 是被 inline 覆盖的死声明（**P2 / S**）

- **证据**：`styles.ts:446-448` 三个声明；`index.tsx:2544-2555` 的 `panelStyle` 用同名内联属性，内联恒赢。`styles.ts:434-435` 注释已承认"只是没有 inline 时的兜底"。
- **建议**：保留也可以（SSR/无 JS 兜底），但建议注释里写清"inline 才是权威"，否则下一个人会改 CSS 却看不到变化。

### F15 · `.awu-emptySub` 在 JSX 里使用但全项目无规则（**P2 / S**）

- **证据**：`index.tsx:3015`；`styles.ts`/`distill`/`guide` 均无 `.awu-emptySub`
- **现象**：空态第二行提示（"从左栏选一张卡"）掉回继承样式（14px、`--awu-ink`），与 `.awu-emptyHint` 的层级设计不一致。
- **建议**：补一条规则（12px / ink-mute）或改成已有的 `.awu-emptyHint`。

### F16 · 特异性打架（现状可控，但有两处脆弱点）

- **已文档化且正确**：`styles.ts:556-561`（railHead 子块 margin 归零必须两个类，注释写清原因）、`1442-1450`（heroActions 的 md 按钮需 (0,3,0)）。
- **脆弱点 A**：`.awu-distill-dialog`（`distill:66-72`）靠"拼接在后面"覆盖 `.awu-dialog`（`styles.ts:2456-2476`）的 `width`。两者特异性相同 (0,1,0)，**胜负只由 `${DISTILL_CSS}` 的位置决定**（`styles.ts:3566-3567`）。若哪天调换拼接顺序或把 distill 拆成独立 `<style>`，弹层宽度会静默变 620。
- **脆弱点 B（潜在）**：`.awu-btn[data-kind="primary"]` 在 `styles.ts:1240` 设 `font-weight:600`，而 `.awu-btn[data-size="md"]` 在 `1284` 设 `font-weight:500`，同为 (0,2,0)，后者更靠后 → 任何**不在 `.awu-heroActions` 里**的 `primary + data-size="md"` 组合都会掉成 500（当前 JSX 里没有这种组合，detail hero 里的 md 按钮被 1449 的 (0,3,0) 救回来了）。
- **建议**：A 改成 `.awu-dialog.awu-distill-dialog`（提高特异性，不依赖顺序）；B 把 `font-weight` 从 size 档里删掉（size 只该管几何）。

### F17 · `!important` 与 z-index（**已做好，见 §8**）

- 全项目 3 处 `!important`，全部在 `prefers-reduced-motion` 块里为压掉动画——用法正当，无需改。
- `z-index` 4 处全部 token（`--awu-z-panel/inset/scrim`），无散落。

### F18 · `data-awu-scoped` 属性无任何 CSS 规则（**P2 / S，⚠️待确认**）

- **证据**：`styles.ts:3587` 导出 `SCOPED_ATTR`；`index.tsx:2585,2629` 把它 spread 到两个元素上；但 styles.ts 里没有任何 `[data-awu-scoped]` 规则（grep 仅命中导出那一行）。
- **为什么是问题**：要么它是给宿主/老版本用的钩子（那该写注释），要么是重构残留（那该删）。当前状态是"往 DOM 上刻了一个没人读的标记"。
- **建议**：确认后删除，或补一条说明它给谁用。

---

## 3. 深/浅色与降级

### F19 · 浅色块的**类名**清单逐字一致 ✓，但 `--awu-blur` 缺浅色值（**结论 + P2**）

- 深色根选择器 `styles.ts:51-54`：`.awu-scope, .awu-layer, .awu-scrim, .awu-dialog`
- 浅色覆盖 `styles.ts:213`：`html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) :is(.awu-scope, .awu-layer, .awu-scrim, .awu-dialog)`
- **结论：4 个类名逐字一致 ✓**（`styles.ts:50` 的"必须逐字一致"要求被满足）。变量层面深浅是 37/98 的**子集**，缺的绝大多数是主题无关档（字体/间距/圆角/时长/z），这是对的。
- **唯一实质缺口**：`--awu-blur`（`styles.ts:71` = `blur(30px) saturate(180%)`）**没有浅色版本**。浅色面板走的是 `--awu-blur-panel` = `blur(18px) saturate(185%) brightness(1.03)`（`223`），而弹层/底栏/专注层仍是 30px+saturate(180%) 的深色参数 → 白底上饱和度过高、边缘发灰。
- **建议**：补 `--awu-blur` 的浅色值（如 `blur(24px) saturate(140%)`），并给两处 `saturate` 加注释说明为什么面板比元素低。

### F20 · 浅色主题下骨架屏几乎不可见（**P0 / S**）

- **证据**：`styles.ts:1998-2007` `.awu-skRow` 的闪烁底是**深色专用** `rgba(255,255,255,.04/.10)`，未随主题走；浅色卡面本身已经是 `rgba(255,255,255,.68)`（`215`）
- **现象**：浅色下 loading 骨架 = 白底上的白色渐变（对比 ≈1.02:1），"正在加载"这个信号**消失**，只剩一个看不出边界的方块在动。
- **为什么是 P0**：这是浅色主题下唯一"状态直接丢失"的缺陷（不是不好看，是读不出来）。而且 `--awu-sheen` 早就有深浅两套值，说明作者意识到过这个问题，只是骨架漏了。
- **建议**：改用 `color-mix(in srgb, var(--awu-ink) 6%, transparent)` 系（深浅自适应），或直接引 `--awu-sheen`。

### F21 · 浅色下仍带深色专用字面量（**P2 / S**）

- `styles.ts:735` 状态带扫光 `rgba(255,255,255,.10)`（浅色下 = 白扫白，看不见）
- `styles.ts:330/1081` 头像 `0 2px 8px rgba(0,0,0,.18)` + `inset ... .45`（浅色下投影偏重，iOS 浅色一般 .08~.10）
- `styles.ts:837` 选中 tab `0 1px 3px rgba(0,0,0,.18)`
- **建议**：前两处改 token（`--awu-sheen-soft` / `--awu-shadow-card`），第三处 `.18 → .10` 或 token 化。

### F22 · `prefers-reduced-transparency` 只关掉 8 个模糊面里的 4 个，且所有半透明面仍透（**P0 / M**）

- **证据**：降级块 `styles.ts:3529-3540` 只列 `.awu-panel, .awu-dialog, .awu-focus, .awu-editorConfirmCard`
- **未覆盖的模糊面**：`.awu-trigger`(297，侧栏入口，常驻)、`.awu-editorFoot`(2369，编辑器底栏)、`.awu-editorConfirm`(2403，整面板遮罩 blur 6px)、`.awu-scrim`(2451，全视口遮罩 blur 6px)
- **更关键的未覆盖**：**所有半透明卡面**——`.awu-card`(1022)、`.awu-section`(1520)、`.awu-editGroup`(2139)、`.awu-input`(2523)、`.awu-dialog` 的兄弟浮层、`.awu-tabs`(808)、`.awu-btn`(1218)、`.awu-loreRow`(2835)… 用户打开"降低透明度"后，面板底变实心了，但卡片/输入框/按钮仍然是 44%~20% 透明的玻璃 —— **透过它们仍能看见壁纸**，等于"降级做了一半"。
- **为什么是 P0**：`styles.ts:74-76` 与设计文档 §8.3 都把这条写成"降级 = 真·不透明"，并特别记录过一次"旧实现降级无效"的 bug；现在只是从"全无效"变成了"半数有效"，功能承诺仍未兑现（前庭功能障碍/低视力用户依赖这条）。
- **建议**：降级块里把所有 `background-color: var(--awu-glass-*)` / `color-mix(... surface-*)` 面改为 `--awu-surface-opaque` 系（或加一个 `--awu-surface-solid-2/3`），并显式 `backdrop-filter: none` 覆盖 8 个面。

### F23 · `prefers-reduced-motion` 漏 3 条动画 + 2 处 transform 过渡（**P1 / S**）

- **证据**：降级块 `styles.ts:3542-3565`。逐条比对 18 条 `animation` 声明：
  - 覆盖 15 ✓
  - **漏**：`styles.ts:874` `.awu-body::before, .awu-pane::before`（滚动阴影 `awu-scroll-hint`）、`2229` `.awu-editGroupBody`（`awu-fade`）、`3184` `.awu-presetHeavyConfirm`（`awu-fade`）
  - **transform 过渡未禁**：`styles.ts:2177` `.awu-editGroupChevron { transition: transform }`，展开时 `rotate(90deg)`（`2181`）——旋转是最典型的"位移动效"；`1142` `.awu-cardChevron` 的 `translateX(2px)`（`1145`）同理。两者都不在 `3562-3563` 的 `transition-duration: .01ms` 名单里。
- **建议**：三条动画补进 `animation: none` 名单；把 `.awu-editGroupChevron/.awu-cardChevron` 加进 `transition-duration` 名单，或统一改成 `*, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }` 的兜底写法（更省心，也避免下次新增动画再漏）。

### F24 · 文档与实现的数值漂移（**P2 / S**）

- `docs/design/2026-10-30-liquid-glass.md:23-26` 的玻璃值（.72/.42/.22）vs 实际（.66/.44/.20，`styles.ts:60-64`）
- 同文 `:32` `blur-panel = blur(16px) saturate(160%)` vs 实际 `blur(20px) saturate(150%)`（`styles.ts:70`）
- 同文 `:86-87` ink-dim/mute 的 alpha（.75/.60；浅 .82/.72）vs 实际（.82/.68；.88/.78，`styles.ts:80-81,229-230`）→ **那张对比度表已经不是当前配色的证明**，后续谁拿它当验收依据就会错。
- 同文 `:104` 字号首档 10px vs 实际 11px（`styles.ts:130`），且实际多了 `--awu-fs-control:16`
- 同文 `:122` "240px 起 4 列"：`.awu-grid`（`1000-1004`）实际挂在 rail 的 `.awu-pane`（`index.tsx:2952/2965`），可用宽 276px → **永远只有 1 列**
- 同文 `:168` 称 `will-change` 只因面板"随开合挂载/卸载"才安全 —— 但面板一次打开可能挂几小时（`styles.ts:470`）
- **建议**：以 CSS 为准，回写一版"当前真值表"（或干脆在文档里标注这些是 2026-10-30 快照），并把 `docs/design/2026-10-30-panel-ui.md`（452px 旧语言）在文件头标 `[已废弃]`，避免两份互相矛盾的权威。

### F25 · `@supports (animation-timeline: scroll())` 的 `scroll(self)` 可能让滚动阴影永远不出现（**P2 / S，⚠️待确认**）

- **证据**：`styles.ts:863-879`，`.awu-pane::before` / `.awu-body::before` 是**伪元素**，却用 `animation-timeline: scroll(self)`。按规范 `self` 要求元素自身是滚动容器，伪元素不是 → 时间线不活跃，`opacity` 停在 `from`(0)。
- **建议**：改成 `scroll(nearest)` 或干脆删掉 `animation-timeline`（默认 `auto` 就是最近滚动容器），然后在 DevTools → Animations 里验证一次（这条我做不了运行时验证，故标待确认）。

---

## 4. 性能（1120×~900 面板）

### F26 · `.awu-focus` 是全屏 30px 模糊 + 66% 透明底（**P1 / M**）

- **证据**：`styles.ts:2582-2593`：`inset:0`（1120×900 ≈ **1.0M px**）+ `background: var(--awu-surface)`（= glass-1，66% 透明）+ `backdrop-filter: var(--awu-blur)`（**30px**）
- **为什么是问题**：① 直接违反 `styles.ts:69` 自己定的红线"大面积用轻 blur，强 blur 只留给小面积"——这是全项目最大的一块 30px 模糊；② 66% 透明底 + 30px 模糊上编辑长文本，正文可读性依赖背后壁纸；`styles.ts:2521-2522` 对输入框的判词（"底太透壁纸会从字缝钻上来"）在这里完全适用。
- **建议**：底改 `--awu-surface-dialog`（86%）+ `--awu-blur-panel`（18px）；专注层本质是"读/写区"，它不需要液态玻璃。

### F27 · 嵌套 backdrop-filter：面板 × 底栏 / 遮罩 / 弹层（**P1 / M**）

- 模糊面清单（8）：`.awu-trigger`(297, 30px)、`.awu-panel`(457, 20px)、`.awu-editorFoot`(2369, 30px)、`.awu-editorConfirm`(2403, 6px)、`.awu-editorConfirmCard`(2416, 30px)、`.awu-scrim`(2451, 6px)、`.awu-dialog`(2468, 30px)、`.awu-focus`(2590, 30px)
- **风险点**：
  1. **sheet 打开时叠 3 层**：`.awu-scrim`（全视口 1.3M px, 6px）→ `.awu-dialog`（30px）→ 其内部 `.awu-input` 等半透明面。Chromium 对"有 backdrop-filter 的祖先里有 backdrop-filter 的后代"必须额外做离屏合成，**每帧成本翻倍**；而 `awu-sheet-in`（`3480-3483`）是 `translateY(24px)` 动画，位移期间 backdrop 每帧都在变 → **不能缓存**。
  2. **`.awu-editorFoot`(30px) 压在可滚动的 `.awu-editorBody`(`2103-2115`) 上方**：每滚一帧都要重算 1120×76 区域的 30px 模糊。
  3. `.awu-editorConfirm` 覆盖整个面板且内含再一层 30px 卡片。
- **建议**：底栏/遮罩用 6~12px 或不模糊（改用不透明度）；sheet 入场动画期间可以先 `backdrop-filter:none`，动画结束后再挂（`animationend` 加类），或改用 `opacity` 淡入代替位移。

### F28 · 无限 `box-shadow` 动画（**P1 / S**）

- **证据**：`styles.ts:1054` `.awu-card[data-live="true"]` 挂 `awu-glow 3.6s ease-in-out infinite`，keyframes `3497-3500` 在 24px→32px 的两层 box-shadow 之间插值
- **为什么是问题**：box-shadow 不在合成器可动画属性里（除非被提升为 layer），每帧都要重绘 240×180 卡 + 30px 模糊阴影；且这是**无限**循环，用户停留在启用角色的详情页时一直在烧 GPU/电。
- **建议**：改成伪元素上的 `opacity` 呼吸（已有 `awu-breathe` 这个正确范式，见 `3502-3505`）；或改成 `filter: drop-shadow` + `will-change`，最好直接复用 breathe。

### F29 · 骨架闪烁用 `background-position`（**P1 / S**）

- **证据**：`styles.ts:2001-2007`（`background-size: 300% 100%` + `awu-shimmer` 改 `background-position`，`3517-3520`）
- **为什么是问题**：background-position 无法合成，每帧整块重绘；骨架屏通常同时存在 4~8 行 × 全宽（~1000px × 76px）→ 每帧 0.3~0.6M px 重绘，低端机上是"一进面板就卡"。
- **建议**：改成 `::after` 渐变条 + `transform: translateX`（合成器友好），保持视觉不变。

### F30 · `will-change` 常驻（**P2 / S**）

- **证据**：`styles.ts:470` `.awu-panel { will-change: transform, opacity; }`
- **现象**：面板一开就常驻合成层（加上 backdrop-filter 本身就是一层）。注释与设计文档都以"面板随开合挂载"为理由，但面板是长驻 UI（打开后可能几小时）。
- **建议**：只在入场动画期间设（`animation` 期间由浏览器自动提升），或改成 `.awu-panel:not([data-settled])` 之类；收益不大，属清理项。

### F31 · hover 过渡 `box-shadow`（34px 模糊）（**P2 / S**）

- **证据**：`styles.ts:1030-1031` 过渡 box-shadow，`1041` 目标值 `0 14px 34px rgba(0,0,0,.42)`
- **现象**：卡片 hover 的 180ms 里每帧重绘 34px 模糊阴影。单卡 hover 影响可控，但"卡片墙 + 鼠标横扫"会连续触发。
- **建议**：hover 阴影改"两档二值切换"（不过渡 box-shadow，只过渡 transform/border），或降低模糊半径。

### F32 · 1120 面板在低端机上的掉帧风险排序（结论表）

| 排序 | 场景 | 成本 | 触发条件 |
|---|---|---|---|
| 1 | 打开任一 sheet | 全视口 6px 模糊(1.3M px) + 620×600 的 30px 模糊，**位移动画期间每帧重算** | 每次开弹层 |
| 2 | 编辑器滚动 | 1120×76 的 30px 底栏模糊每帧重算 | 滚动即触发 |
| 3 | 骨架屏 | background-position 动画，0.3~0.6M px/帧 | 每次加载 |
| 4 | 启用角色的卡/详情 | 无限 box-shadow 动画（30px 阴影） | 停留即持续 |
| 5 | 专注层 | 1.0M px 的 30px 模糊（静态，仅入场一帧） | 进入专注编辑 |
| 6 | 面板本体 | 1.12M px 的 20px 模糊（静态可缓存；开合动画 240ms 内每帧重算） | 开/关面板 |
| 7 | hover 卡片 | 34px 阴影 180ms 过渡 | 鼠标扫过卡片墙 |

---

## 5. 响应式

### F33 · 只有 1 个断点、且 `900px` 块重复 3 次（**P2 / S**）

- **证据**：`styles.ts:564-570`（两栏→单栏 + gutter 20）、`1453-1456`（hero 动作）、`2691-2693`（世界书两栏→单栏）
- **现象**：三块 `@media (max-width: 900px)` 分散在文件中；`gutter` 的降级只写在第一块（`569`），`distill`/`guide` 无任何断点。
- **建议**：合并到一个断点区（文件末尾 "响应式" 分区），后续加 720px 档时一处可查。

### F34 · 901–1100px 两栏会挤坏世界书（**P1 / M**）

- **证据**：`.awu-loreSplit` `styles.ts:2681-2686` 固定 `320px minmax(0,1fr)`，只在 <900 收单栏（`2691-2693`）
- **算例**：视口 901px → 面板 869 → 减 rail 340 → 减 gutter 64 → 主栏内容 **465px**；`.awu-loreSplit` 再分出 320，右栏内容区 **≈133px**（还含 `gap 12`）。`.awu-loreGrid`（`2959`）在该 133px 里仍是**两列** → 每列约 60px，输入框/标签全部挤成竖条。
- **建议**：`.awu-loreSplit` 用 `minmax(240px, 300px) minmax(320px, 1fr)` 并加 `@container`/`@media (max-width: 1100px)` 收单栏；`.awu-loreGrid` 用 `repeat(auto-fit, minmax(220px, 1fr))`。（注：该组件目前未接线，属"接线前必须先修"的前置项。）

### F35 · <900 单栏时 `.awu-rail` 不隐藏 → 列表压在内容上方（**P1 / M**）

- **证据**：断点块 `styles.ts:564-570` 只把 `.awu-workspace` 改 `display:block`、`.awu-rail` 改 `width:100%`，没有隐藏 rail；`styles.ts:476-477` 注释说"rail 隐藏条件由 JSX 决定"，但**全项目没有任何 `matchMedia`/`innerWidth` 逻辑**（已 grep 确认），JSX 也无条件渲染 rail（`index.tsx:2831`）
- **现象**：窄窗下"角色列表（可无限长）"整块排在上方，选中角色后详情在列表**下方**；列表有 20 张卡时，用户要滚过 20 张卡才能看到刚点的详情。同时 rail 内 `.awu-pane` 因父高 auto 失去独立滚动（`styles.ts:509-519` 的 `flex:1 + overflow-y:auto` 失效），整个 `.awu-workspace` 变成一个长滚动容器，`@supports` 的滚动阴影（`864`）也落在错误的容器上。
- **建议**：加 `data-view="detail"` 到 `.awu-panel`，断点里 `.awu-rail { display:none }` + 主栏补一个返回按钮（详情已有 `.awu-navBack`，`1304`）；或 `<900` 时 rail 限高 40vh 且自己滚动。

### F36 · 其他窄窗具体风险

| 位置 | 证据 | 风险 | 优先级 |
|---|---|---|---|
| `.awu-field` 两列 | `styles.ts:1544-1546` `104px 1fr` 无断点 | 视口 <380px 时值列 <180px，长英文 key/URL 靠 `word-break` 硬断行；中文标签 6 字以上会换行成两行，行高不齐 | P2/S |
| `.awu-tabs` 4 个 tab | `styles.ts:801-829`；rail 内容宽 276 → 每 tab ≈66px | 中文 3 字（42px）+ 内距 16px = 58px，勉强；**换成 4 字标签或加第 5 个 tab 立刻 ellipsis**，且 JSX 没给 tab 加 `title`（`index.tsx:2861-2877`）→ 截断后无法获知全称 | P2/S |
| `.awu-counts` | `styles.ts:618-628` `white-space: nowrap` | 头部一行三个计数不换行，窄窗与 `.awu-headActions` 抢宽；溢出时被 `.awu-panel` 的 `overflow:hidden` 裁掉（不产生横向滚动条，但右侧按钮会被压） | P2/S |
| 横向滚动 | `.awu-panel` `overflow:hidden`（468）+ `.awu-pane` 各自 `overflow-y:auto` | 面板级不会出现横向滚动 ✓；但 `.awu-previewText`(`1800`)、`.awu-jsonView`(`3426`)、`.awu-distill-paste` 用 `overflow:auto` 会**在内部**出横条（等宽长串场景），属预期 | 可以接受 |
| 长名字 | `.awu-cardName`(1112)/`.awu-cardRole`(1128)/`.awu-sigilName`(767)/`.awu-heroSub`(1373)/`.awu-focusTitle`(2604) 均有 `nowrap + ellipsis` | ✓ 做好 | — |
| distill 弹层 | `distill:67-68` `min(var(--awu-dialog-w),100%)`（实际 760）+ `max-height: min(84vh, 720)` | 窄窗（<780px）时宽度自适应 ✓，但内部 `.awu-distill-steps` 字号 11~11.5px、`.awu-distill-warn` 10.5px 在手机尺度上不可读（见 F37） | P1 |

### F37 · 子模块字号击穿设计下限（**P1 / M**）

- **证据**：`distill.styles.ts:111` `font-size: 9.5px`、`204` `9.5px`、`176/224` `10px`、`126` `10.5px`、`96/155` `11.5px`；`guide.styles.ts` 用 12/13/14（尚可但全是字面量）
- **对照**：`styles.ts:127-129` 明确"中文正文下限 12→13px，全部落在整数像素"；`styles.ts:127` 首个 token `--awu-fs-micro: 11px`
- **为什么是问题**：9.5px 与 10px 是**低于系统给自己定的最小档**的中文实际小字（步骤说明、警告、标签），在 2x 屏上也是最小可读边界之下；且 9.5/10.5/11.5 三点五档都是 0.5px 小数，与"整数像素避免发虚"的决定直接冲突。
- **建议**：distill 全量映射到 `--awu-fs-micro`(11) / `--awu-fs-caption`(12) / `--awu-fs-label`(13)；如确实需要更小，必须先改令牌表（并把"整数 px"原则重新裁决），不要在地下模块偷偷加 0.5px 档。

---

## 6. 测试耦合（改样式的硬约束清单）

> 结论：**没有任何断言直接匹配 CSS 文本或 `.awu-*` 类名清单**（除下面 3 条间接耦合 + 1 条弱正则）。因此重构选择器/合并规则的阻力很小；真正的阻力是"改完必须重编、且模板串里不能出现反引号"。

| # | 位置 | 断言内容 | 改样式会不会踩红 | 应对 |
|---|---|---|---|---|
| T1 | `scripts/verify-bundle.mjs:64-91`（`npm run build` 第 4 步） | 用 DOM stub **真实 import + 执行** `lib/client.js` 的 factory | **会**。CSS 是模板字符串：任何新增的**反引号**或 `${` 都会截断模板，导致模块初始化抛错（`verify-bundle.mjs:5-9` 记录了该事故）。注释里也不能写反引号（`styles.ts:544`、`distill:24`、`guide:9-10` 都留了警告） | 改 CSS 时禁用反引号与 `${`；写完必跑 `node scripts/verify-bundle.mjs` |
| T2 | `scripts/verify.mjs:91-100`（`npm run build` 第 6 步） | `lib/client.js` 的 mtime 必须 ≥ `client/` 目录下**所有**文件的最大 mtime | **会**。只改 `styles.ts`/`distill.styles.ts` 而不重新构建，`verify` 必红（文案：`lib/client.js 比 client/ 下最新源文件旧，重新构建`） | 样式改动一律走 `npm run build`，不能只跑 typecheck |
| T3 | `scripts/verify-wiring.mjs:816` | `/awu-toolbar\|awu-railActions\|awu-btnRow/u.test(between)`——当「自创角色卡」按钮与「蒸馏角色卡」按钮相距 >2500 字符时，要求两者之间出现这三个类名之一 | **会**（条件触发）。若重命名这三个类、或把两个 CTA 分到不同容器 | 保留这三个类名，或同步改正则 |
| T4 | `scripts/verify-wiring.mjs:825-829` | 从 JSX 片段抽 `data-size="(sm\|md)"` 比较两个 CTA 尺寸是否一致 | 只 `note()` 提醒，**不会**红。但若把尺寸改成 `data-size="lg"`，比较值变"未标"→ 仍只提醒 | 无硬约束 |
| T5 | `scripts/verify.mjs:110-121` | 产物需含 `window.__ModuleLoader__.load(` 且 react 走 `require("react")` | 与 CSS 无关，但 CSS 模板串破坏会连带失败 | 同 T1 |

- **确认没有**：对 `.awu-*` 类名清单、CSS 变量名、`1120px`、`backdrop-filter`、`prefers-reduced-*` 的断言（`grep -n "awu-"` 在 scripts 下的 57 处命中，除 T3 外全部是 `awu_card_save`/`awu_mode`/`awu_relation` 等**工具名**）。
- **构建顺序**：`package.json` 的 `build` = `tsc → tsc:client → build-client → verify-bundle → verify-wiring → verify → verify-tavern → verify-distill → verify-import → verify-session → verify-host`。样式改动只影响前 5 步。

---

## 7. 已经做得好的、不要重做

1. **规则层零字号字面量**：`styles.ts` 全文件 `font-size:\s*[0-9]` = **0 命中**（设计文档 §9 的自检是真的）。别把字号 token 化当成待办再跑一遍。
2. **零 `z-index` 字面量**：4 处声明全走 `--awu-z-*`；`2147482000/100` 的"抢栈经验值"有注释、有设计文档依据。不需要引入新的层级体系。
3. **零 `transition: all`**：31 条 transition 全部显式列属性。
4. **`!important` 极克制**：全项目 3 处，全在 a11y 降级块里，理由充分。
5. **颜色纪律**：规则层只有 **18 个字面量 / 6 簇**（头像三套色相、两处头像 inset 阴影、状态带扫光、选中 tab 阴影、骨架渐变），且每簇都有"为什么不能 token 化"的语境界限。`--awu-grad` 用 token 承载渐变这个做法要保留。
6. **令牌完备性**：98 个 token 覆盖材质/墨色/线面/强调/角色色/语义色/字体/字号/行高/间距/尺寸/圆角/时长/层级/结构尺码；**93 个被真实引用**，仅 5 个闲置。命名前缀统一（`--awu-`），无大小写/连字符混乱。
7. **`EASE` 单一来源**：`styles.ts:21` 导出、`181` 注入 token，78 处过渡全部 `var(--awu-ease)`（另 4 处 `ease-in-out` 只出现在呼吸/辉光）。
8. **结构常量 JS/CSS 同源**：`PANEL_WIDTH`/`PANEL_MAX_H`/`CARD_STAGGER` 从 TS 注入模板（`31-37`、`195-196`），没有第二份写死的 1120。
9. **单一 `<style>` 注入 + 幂等**：`installStyles`（`3574-3584`）用 `data-plugin-css` 去重，distill/guide 走 `${GUIDE_CSS}${DISTILL_CSS}`（`3566-3567`）拼接，没有第二个 style 标签。
10. **焦点可见性覆盖率高**：24 条 `:focus-visible`，覆盖 16 个可交互类；`outline-offset` 按"区块外扩 / 行内内缩"分开，逻辑成立（只是没抽 token，见 F12）。
11. **深色/浅色作用域选择器写法正确**：`html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme])` 同时判两个宿主（`styles.ts:209-213`），并留了"只判 html 会让 :not() 恒真"的踩坑注释；4 个 portal 根的类名清单逐字一致。
12. **`prefers-reduced-transparency` 的思路是对的**（引入 `--awu-surface-opaque`、删 `background-image`、退描边），只是覆盖面不完整 —— **修它不要重写它**。
13. **两栏骨架与断点判断**：1120 下两栏、<900 单栏的取舍有设计文档依据（§3.3）；卡片/名字类普遍做了 `min-width:0 + ellipsis`，长中文名不会撑破（`1099-1136`）。
14. **`.awu-grid > * { min-width: 0 }`**（`1007`）这种"grid 子项溢出"的细节已经想到，别当成新问题。

---

## 8. 建议改造顺序（给 Lead 排期用）

| 顺序 | 项 | 优先级 | 工作量 | 依赖 |
|---|---|---|---|---|
| 1 | F22 补全 reduced-transparency（8 模糊面 + 半透明卡面） | **P0** | M | 无 |
| 2 | F20 浅色骨架屏改自适应色 | **P0** | S | 无 |
| 3 | F26 `.awu-focus` 降模糊 + 加实底 | P1 | M | 无 |
| 4 | F27 sheet/底栏/遮罩的嵌套模糊（动画期不挂 filter） | P1 | M | 需真机 FPS 采样 |
| 5 | F28/F29 两个无限动画改合成器友好写法 | P1 | S | 无 |
| 6 | F5 chevron 提亮到 ink-mute | P1 | S | 无 |
| 7 | F37 distill 字号回到 11/12/13 三档 | P1 | M | 需同时改令牌表口径 |
| 8 | F11/F12 滚动条与焦点环去重（顺带补 `.awu-focusBody`） | P1 | S | 无 |
| 9 | F23 reduced-motion 补 3 动画 + 2 过渡（建议改兜底写法） | P1 | S | 无 |
| 10 | F1 补控件高度/整数行高/滚动区高度 token | P1 | M | 与 F37 同批 |
| 11 | F35 <900 单栏的 rail 折叠（需 JSX `data-view`） | P1 | M | 与 client-ui 同批 |
| 12 | F34 loreSplit/loreGrid 弹性化 | P1 | S | 世界书接线前必做 |
| 13 | F9 删 60 行死代码（`.awu-body`、`.awu-modeOption*`）；预留块集中标注 | P2 | S | 无 |
| 14 | F10 删 7 条 serif 死声明 + 修 3458 注释 | P2 | S | 与设计文档 R3 同步 |
| 15 | F2/F3/F4/F6/F7/F8 令牌补档与别名收敛 | P2 | M | 建议与 10 合并成一次"令牌重构" |
| 16 | F24/F25 文档回写真值 + 修 scroll(self) | P2 | S | 无 |
| 17 | F15/F16/F18/F19 零碎（emptySub、distill 特异性、SCOPED_ATTR、blur token） | P2 | S | 无 |

**总计**：P0 2 项（约 1 天）、P1 10 项（约 3~4 天）、P2 7 项（约 1.5 天）。若只能做一件事：**F22**（用户可见的功能承诺 + a11y 合规）。

---

## 附录 · 口径与不确定项

- **计数方法**：用 Node 脚本对三份 CSS 做花括号级解析（跳过 `/* */` 注释）统计规则/声明；硬编码用属性级正则（`padding|margin|gap|border-radius|font-size|line-height|width|height|…: <数字>px`）并排除含 `var(` 的行；token 未引用项用 `var\(--awu-([a-z0-9-]+)` 与定义集合求差。**行号以 `read`/`Select-String` 直读为准**（早期脚本的行号有累计偏移，已弃用）。
- **⚠️待确认 1（F25）**：`animation-timeline: scroll(self)` 用在伪元素上是否真的 inactive，需 DevTools Animations 面板或真机截图确认。
- **⚠️待确认 2（F32 排序）**：没有真机 FPS/GPU trace，上表是按"模糊面积 × 是否每帧重算"的静态推断，实际帧率请以 Performance 面板采样为准（建议在核显笔记本 + 144Hz 外接屏各采一次）。
- **⚠️待确认 3（F34/F35）**：世界书两栏与窄窗单栏都涉及尚未接线的组件（`.awu-loreSplit` 当前 0 处引用），风险是"接线即暴露"，不是"当前已坏"。
- **未覆盖**：`client/*.tsx` 的 DOM 结构与 ARIA（属于别的检查员的范围）；`src/` 宿主侧注入的样式。
