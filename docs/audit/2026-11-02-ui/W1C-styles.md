# W1-CSS · styles.ts 落地报告（2026-11-02）

> owner：inspector-styles（`client/styles.ts` 唯一写者）
> 基线：HEAD `a7b5799` + W0-B 的 142 行
> 改动：`client/styles.ts` **+804 / −376**（含 W0 部分），文件 3673 → 4015 行，CSS 内部 3950 行
> 未跑 `npm run build`（按纪律）；每轮跑 `npx tsc -p tsconfig.client.json --noEmit` + 模板串三项自检

## 0. 自检闭环（每轮都跑，结果全绿）

| 项 | 结果 |
|---|---|
| `npx tsc -p tsconfig.client.json --noEmit` | **EXIT 0** |
| CSS 模板字面量内部反引号 | **0** |
| 模板串内部 `${` | **5**（EASE / PANEL_WIDTH / PANEL_MAX_H / GUIDE_CSS / DISTILL_CSS，全是既有插值） |
| 花括号平衡 | **585 / 585** |

> ⚠️ 曾有一次在注释里写了 markdown 反引号导致模板串截断（已修，见 §F）。此后注释一律不用反引号。

## 1. 量化总览（改前 → 改后）

| 指标 | 前 | 后 | 说明 |
|---|---|---|---|
| CSS 规则 | 599 | **585** | 删死代码 + 加新模块 |
| CSS 类 | 279 | **275** | −21 死类 / +17 新类 |
| 零引用类（死类） | 21 | **0** | 已与 tsx 引用逐条核对 |
| 设计令牌 | 98 | **122** | +24（§2.6 一批 + 材质档） |
| 定义但未引用 | 5 | 5 | 全是"外部模块/后批使用"：`surface-opaque`(guide)、`dialog-w`(distill)、`lh-tight-px`/`lh-body-px`(JSX 读)、`ease-in`(第 2 批塌陷) |
| `font-size` 裸 px（styles.ts） | 0 | **0** | 保持 |
| `line-height` 裸 px（styles.ts） | 27 | **0** | 全部走 `--awu-lh-px-*` |
| `box-shadow` 内联色值 | 6 簇 | **1** | 仅剩 reduced-transparency 块内 1 处（有意） |
| `outline: 2px solid var(--awu-accent)` 字面量 | 24 | **0** | 全部走 `--awu-focus-ring/-offset*` |
| `!important` | 3 | **8** | 全部在 a11y 降级块（W0 的全局守卫 5 条 + 本批 0 条） |
| `backdrop-filter` 出现处 | 16 | **24** | 8 个面 ×(标准+webkit) + 降级块里 8 条 `none` = 全覆盖 |
| 未定义却使用的 var | — | 4 | `--awu-tab-i/n`、`--awu-mx/my`（JSX 内联提供，均带 fallback） |

---

## 2. A · 降级与可读性（P0）

### A1 降低透明度：8/8 模糊面 + 全部半透明面变实底

- **做法换了一层**：不再逐个类写 `background-color`（旧版漏了 6 类），改为**在降级块里重写玻璃令牌**：
  `--awu-glass-1/2/2-hi/3`、`--awu-surface-field/strip/dialog/opaque`、`--awu-sheen: transparent`、
  `--awu-specular: inset 0 0 0 0 transparent`（不能写 `none`，否则 `box-shadow: var(--a), var(--specular)` 整条失效）、
  `--awu-scrim-bg` 加深、`--awu-line(-soft)` 提一档。深/浅两套都在降级块里各写一份。
- **8 个模糊面全部 `backdrop-filter: none`**：`trigger / panel / editorFoot / editorConfirm / editorConfirmCard / scrim / dialog / focus`。
- **实测（CDP + `Emulation.setEmulatedMedia`）**：
  `panel rgb(30,30,33)`、`card rgb(38,38,43)`、`trigger rgb(38,38,43)`、`tabs rgb(51,51,56)`、`btn rgb(51,51,56)`、`input rgb(38,38,43)`，全部 `backdrop-filter: none`、`background-image: none`。
- 行数：+46 行（整块重写）。截图：`06-tmp/ui-audit/w1c-rt.png`。

### A2 浅色骨架屏可见 + 扫光改 transform

- `--awu-sk-base` / `--awu-sk-sweep` 两个随主题走的 token（深：5%/14% 白；浅：9% 灰底 + 72% 白扫）。
- 扫光从 `background-position` 动画改为 `.awu-skRow::after` 的 `translateX`（复用 `awu-sheen`），
  顺带把不可合成的每帧整块重绘（4~8 行 × 1000×76）换成合成器位移。
- 行数：+22。验证：浅色截图（`w1c-light-sel.png` 的加载态）、深色 `w1c-dark.png`。

---

## 3. B · 令牌收敛

### B1 新增令牌（24 个）

`--awu-ctrl-h`(36) / `--awu-ctrl-h-sm`(28) / `--awu-lh-px-18|20|22|23|24` / `--awu-lh-tight-px` / `--awu-lh-body-px` /
`--awu-line-soft`（深 `rgba(255,255,255,.055)`，浅 `rgba(60,60,67,.08)`）/ `--awu-radius-sheet`(24) /
`--awu-focus-ring`(= accent) / `--awu-focus-offset`(1px) / `--awu-focus-offset-inset`(−2px) /
`--awu-card-hi`（深 .12 / 浅 .55）/ `--awu-sheen-sweep`（深 .10 / 浅 .55）/ `--awu-sk-base` / `--awu-sk-sweep` /
`--awu-blur-sm`(6px) / `--awu-shadow-glyph`（角色色块投影，深浅各一）。
`--awu-rail-w` 340 → **336**（336−64 gutter = 272，4 格各 68px，整除）；`<1100` 时 300（新增 media）。

### B2 focus ring：从 24 条各写各的 → 1 套值 / 2 档 offset

- 改前：24 条规则，`outline-offset` 取 **1/2/3/4/−2 五种**，且同类控件不一致（`.awu-tab` −2 而 `.awu-modePill` +1）。
- 改后：24 条仍各自成条（上下文不同、合并会伤可读性），但**值只有两个来源**：
  `--awu-focus-ring` + `--awu-focus-offset`（普通，16 处）/ `--awu-focus-offset-inset`（内嵌，9 处）。
  `.awu-modePill` 归到 inset（与 `.awu-tab` 同为分段器内的按钮）。字面量 `outline: 2px solid var(--awu-accent)` = **0**。
- 新增 2 条：`.awu-menuItem`/`.awu-menu > button`（inset）、`.awu-mainBody:focus-visible`（tabpanel 可聚焦，用 inset 否则被 `.awu-main` 裁掉半边）。

### B3 滚动条：三份复制 + 一处缺失 → 1 组

- 改前：`.awu-pane`(13 行) / `.awu-body`(死) / `.awu-editorBody`(13 行) 三份复制，`.awu-focusBody` 只有 `scrollbar-color`、缺 webkit 三件套。
- 改后：一组规则、4 个容器（`.awu-pane, .awu-mainBody, .awu-editorBody, .awu-focusBody`），5 段（width/track/thumb/hover 态/`scrollbar-color`）。
  **`.awu-focusBody` 的 webkit 三件套已补齐**。新增滚动容器只需加选择器，注释里写明"不要再复制"。

### B4 控件高度：6 档 → 2 档

`34/38/40/42/44`（46 是卡片不是控件）→ `--awu-ctrl-h`(36) 与 `--awu-ctrl-h-sm`(28)，共 **15 处**使用：
`.awu-btn` / `md` / `block` / `lg` / `sm` / `.awu-input`(42) / `.awu-editInput`(40) / `.awu-editListText` /
`.awu-editListRemove` / `.awu-reviewInput` / `.awu-reviewMonthHead` / `.awu-previewSegHead` / `.awu-presetModuleBody` /
`.awu-heroActions .awu-btn[md]` / `.awu-menuBtn`。
另外把 `.awu-btn[data-size="md"]` 里的 `font-weight: 500` 删掉 —— 它会盖掉 primary 的 600（同为 (0,2,0) 且 md 在后），
是审查 F16 那条"潜在特异性打架"。

---

## 4. C · 材质分层

### C1 左栏凹陷 / 右栏浮起

- `--awu-surface-strip` 深色从 `transparent` → `rgba(0,0,0,.12)`（浅色保持 6% 灰）。
- `.awu-rail`：**去掉 `border-right`**，改 `box-shadow: inset -1px 0 0 var(--awu-line-soft), inset 0 1px 0 (edge 35%)`
  —— border 会占 1px 布局宽（336→335，四格算出 67.75），inset 不占位且可调透明度。
- `.awu-main` 保持透明（浮起），加 `position: relative`（菜单锚点 + nav 层基准）。
- `.awu-workspace` 补 `position: relative`（必须：push 时 rail 是绝对定位，否则以 `.awu-panel(fixed)` 为基准铺满、盖住头部）。

### C2 卡片指针跟随高光

- 静态顶部高光从 `.awu-card` 的 `background-image` **迁进 `.awu-card::after`**（浅色才能单独压强度）。
- 一个公式两种形态：`radial-gradient(240px circle at var(--awu-mx, 50%) var(--awu-my, -20%), var(--awu-card-hi), transparent 62%)`
  —— 没有 JS 变量时圆心在卡上方 20%、半径 240，摊成原来那条"顶部横带"；有变量时跟随指针。
- **降级开关（三条，逐条独立）**：
  1. 只在 `@media (hover: hover) and (pointer: fine)` 内 `:hover { opacity: 1 }`（触屏永远停在静息 .85）；
  2. `.awu-panel[data-fx="off"] .awu-card::after` 退回旧静态高光（即使 JS 还在写 mx/my 也不跟随）；
  3. `prefers-reduced-motion` 由 W0 的全域守卫把 transition 压到 `.01ms`（不再单独写规则）。
- 实测：`::after { opacity: .85, background: radial-gradient(240px at 50% -20%, rgba(255,255,255,.12)) }`。

### C3 深色二次调 / 弹层

- `--awu-glass-1` `.66 → .70`（右栏正文直接压面板底，太透会被壁纸顶起来）；
- `--awu-blur-panel` `saturate 150% → 138%`（1.5 倍会把整块玻璃往蓝紫推，压平黑白层次）；
- `--awu-surface-dialog` `rgba(30,30,32,.86) → .72` + `.awu-dialog` 顶部 sheen 78%（更透后需要高光才不像灰膜）；
- `.awu-dialog` 圆角 → `--awu-radius-sheet`(24)；**跨批桥接** `.awu-dialog.awu-distill-dialog` 也用 24（压过 distill 的 16，第 3 批落地后删这条）。
- 遮罩模糊 6px 收进 `--awu-blur-sm`（2 处字面量清零）。
- `--awu-line-soft` 铺到：`mainHead` 下边、`railHead` 下边、`sectionHead` 下边、`field` 行线、`kicker::after`、`menuSep`、`railNow` 描边。

---

## 5. D · 布局类（喂 JSX）

| 类 | 内容 |
|---|---|
| `.awu-mainHead` | flex + gutter padding + `border-bottom: line-soft`；`> .awu-tabs { flex:1; margin:0 }`、`> .awu-headActions { margin-left:auto }` |
| `.awu-mainBody` | `flex:1 / min-height:0 / overflow-y:auto / overscroll-behavior:contain` + gutter padding + **滚动条四件套已进统一组** + `::before` 滚动阴影 + `:focus-visible` inset 环 |
| `.awu-railNow` | caption 字号 + `b` 金字 + nowrap/ellipsis；**`[data-empty="true"]` 才隐藏**（JSX 写的是 `'true'|'false'` 字符串，写成 `[data-empty]` 会连 false 一起命中） |
| `.awu-menuBtn` / `.awu-menu` | ⋯ 按钮 36×36（`aria-expanded="true"` 蓝描边）；菜单 = `surface-dialog` + 30px 模糊 + `--awu-shadow` + 240ms `awu-menu-in`（`translateY(-4px) scale(.98)`），锚 `right:0; top:calc(100%+4px)`，锚点 `.awu-heroActions{position:relative}` |
| `.awu-menuItem` / `.awu-menuSep` | 菜单项（也兼容 `.awu-menu > button` 裸按钮）、`[data-kind="danger"]` 红字红 hover、分隔线 line-soft |
| `.awu-card[data-selected="true"]` | 静态蓝轨用 `::before`（2px / left / 上下各 14% / accent）—— 不用 box-shadow 因为 `[data-live]` 的 `awu-glow` 动画驱动的就是它；选中+启用可同时可见（左轨蓝 / 描边金 / 外圈呼吸） |
| `.awu-tabs::before` 滑块 | `width: calc((100% - 6px - (n-1)*gap)/n)`、`translateX(i*(100%+gap))`、240ms `--awu-t-mid`；**已删 `.awu-tab[data-on]` 的底与阴影**（否则双底），选中态只留颜色/字重 |
| `.awu-workspace[data-nav="push"]` | `<900`：rail 绝对定位铺满 + `visibility:hidden` + `pointer-events:none`，main 提 `z-index:--awu-z-inset`；用 visibility 不用 display，保住 rail 滚动位置给第 2 批做位移 |

实测：1440 下 `mainHead/mainBody/tabsInMain=true`、`--awu-tab-i:3`、滑块 157px（= (640−12)/4）；1024 下 rail 296(→300)、tabs 540、滑块 134；820 下 `data-nav=push`、rail hidden、main z=5；560 下 mainHead/mainBody 无横向溢出。

**滑块颜色**：玻璃档用 `--awu-glass-2-hi` 而不是 `glass-1` —— 实测深色下 `glass-1`(20,20,24,.70) 画在更亮的槽上是个黑洞（"选中的看起来是凹下去的"）。

---

## 6. E · 排版与卫生

- **详情字段行**：key `--awu-fs-label` + `ink-mute`；value `--awu-fs-body` + `500` + `ink`；行高 `--awu-lh-px-23`；行内 padding 10→12；`b` 再提 600；新增 `.awu-fieldVal small/em` 掉回常规。
- **分节标题 kicker 化**：`13px/600/ink-dim` → `12px/600/.08em/uppercase/ink-mute`（一屏四五个分组时标题不再和内容同重）。
- **分组间距**：`.awu-detail` gap 16→20；`.awu-detail > .awu-dangerZone { margin-top: 0 }`（删除下沉后的节奏交给 gap）。
- **guide 排版桥接**（第 3 批收回）：`.awu-guide { max-width: 760px; margin: auto }`，正文/问答 14px/23px，注脚 13/20（用 (0,2,0) 压过 guide.styles.ts 的 13/22）。
- **空态**：`.awu-emptySub` 补规则（用了很久但一直没样式）；`.awu-empty[data-kind]` 从"白挂"变有意义（diary 金 / error 红 / pick 蓝）。
- **死代码清理**：21 类 / 约 170 行（`.awu-body` 整块 + `@supports` 里那份、`loreSplit/lorePane/loreDetail`、`editorTabs/editorTab`、`budgetTag/levelTag/fieldCount`、`chips/chip/chipX/chipInput`、`nativeField/jsonView`、`stack`、`modeOption*`），文件里留了一段"删了什么 + 接线时该怎么写"的说明。
- **模板串滚动阴影 bug**：`animation-timeline: scroll(self)` → `scroll(nearest)`（伪元素自身不是滚动容器，原写法时间线不活跃 → 阴影永远 opacity:0）；容器清单同步为 `pane/mainBody/editorBody`。
- **衬线**：删除 7 条被文末推翻的 `font-family: var(--awu-serif)` 死声明；文末那段"衬线留给角色名+日记"的注释改成事实（现在只剩 `.awu-mark`/`.awu-avatar` 首字）。
- **焦点环/令牌清理**：`--awu-surface-foot`/`--awu-gold-hi`/`--awu-grad-soft`/`--awu-pink`/`--awu-size-empty` 五个零引用令牌删除；`.awu-loreRowFlag` 的 `line-height:15px` 换成 flex 居中。

---

## 7. 待裁决 / 未做（需要 Lead 或别的批）

1. **`--awu-lh-tight` / `--awu-lh-body` 没改成整数 px**（契约 §2.6 的字面要求）。原因：它们是比例值，被 100+ 处"字号会变"的正文引用；改成整数会把 22px 标题压成 1.0 行高。落地方式是新增 `--awu-lh-px-18/20/22/23/24` + 两个别名 `--awu-lh-tight-px`/`--awu-lh-body-px`（JSX 读得到）。**若你要的是"改名"，请拍板，我 5 分钟改完。**
2. **`SCOPED_ATTR` 删不掉**：`index.tsx:102` 直接 import 了它（还有 2 处 spread），改不了 JSX。CSS 侧确认无任何 `[data-awu-scoped]` 规则 → 要么 JSX 侧去掉这个属性，要么保留（无害）。
3. **distill 字号击穿**（9.5/10/10.5px）：在 `distill.styles.ts`（第 3 批写域）→ 只报不改。同理它的 16px 弹层圆角我用 (0,2,0) 桥接成 24，第 3 批落地后删桥。
4. **JSX 侧还没接的 CSS 接口**（已就绪，不阻塞）：`--awu-mx/--awu-my`（指针高光）、`.awu-panel[data-still="true"]`（动画期去模糊）、`.awu-panel[data-fx="off"]`（关高光）。
5. **顺手发现一个 JSX 侧重复**：详情页状态带右侧有「退出全局」，⋯ 菜单第一项也是「退出全局」——不是 CSS 问题，转给你判断。
6. `data-state="closing"` vs 契约 §2.2 的 `data-closing="true"`：两边都认（我加了兼容规则），第 2 批统一后删。

## 8. 验证方式汇总

- 静态：`npx tsc -p tsconfig.client.json --noEmit`（EXIT 0）；模板串三项自检脚本（反引号/`${`/花括号）。
- 量化：Node 脚本对 CSS 做花括号级解析 + tsx 引用比对（死类 0、未定义 var 4 个且都带 fallback）。
- 运行时（CDP）：`06-tmp/ui-audit/shot.mjs` + 自建 `_w1c_media.mjs`（支持 `Emulation.setEmulatedMedia`）。
  - 深色/浅色/1024/820/560 五档布局；`data-nav`、滑块几何、rail 宽度、菜单几何、卡片 `::after` 计算值；
  - `prefers-reduced-transparency` 实测 8 个面的 `backdrop-filter` 与背景色；
  - 像素级核对选中蓝轨：`(0,122,255)` 2px，位于卡片左缘。
  - 截图：`w1c-wide.png`（浅）、`w1c-dark.png`、`w1c-detail.png`、`w1c-menu.png`、`w1c-light-sel.png`、`w1c-1024.png`、`w1c-820`/`w1c-560.png`、`w1c-rt.png`（降级）。
