# R2 · CSS / 动效 / 降级 审查报告

- 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u` @ `98e2b06`
- 审查对象：`client/styles.ts`（本轮 diff：`@container` 兜底 / `.awu-mainBody overflow-x` / 详情退场 / 高对比块 / 箭头旋转）
- 依据：KB `08-玻璃与动效.md` §3 三条铁律、`02-踩坑清单.md` #28–#35、#42
- 手段：静态读 + `scripts/verify-ui.mjs` + `scripts/verify-a11y.mjs` + CDP（`tools/qa/cdp.mjs`，自带 headless chromium，沙盒 59621）采样**计算值**
- 只读审查：未改动仓库任何文件
- 局限：无头 + 软件合成下 CSS 动画 `currentTime` 可能不前进（KB #38），本报告只断言**结构性事实与计算值**，观感仍需真机判

---

## 0. 结论

| 严重度 | 条数 | 摘要 |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 | ① data-still 的 `will-change` 落在三张自带 `backdrop-filter` 的层上；② 面板退场自己挂 `will-change: opacity` + opacity 动画；③ 骨架退场 abs 后宽度从 272→336px |
| P2 | 7 | 进场 fill 三处 `both`；缺 `forced-colors`；降透清理单漏 `.awu-menu` 多 `.awu-scrim`；高对比没抬玻璃透光；两处写死值；`[data-exit]` 裸属性选择器；三处存量"blur 元素自身播动画" |

变量清单（5 张）逐字一致、高对比深浅两份都实测生效、keyframes 闭环 22/22、`overflow-x:hidden` 与 `contain` 无实测副作用 —— 见 §2「已确认没问题」。

---

## 1. 问题清单

### F1 · P1 · `data-still` 的 will-change 落在三张自带 backdrop-filter 的层上（#28 自相矛盾）

- **文件:行**：`client/styles.ts:4245-4251`（清单本身）+ `client/parts.tsx:121,125`（scrim/dialog 挂 `data-still`）+ `client/editor-focus.tsx:165`（`.awu-focus` 挂 `data-still`）
- **现象**：同文件 4242-4244 的注释刚写过「给带 backdrop-filter 的元素加 `will-change: opacity|transform` 同样会让它变成独立渲染表面，backdrop 采样退化」，并且确实把 `.awu-panel` 从清单里删了 —— 但清单里剩下的 `.awu-scrim / .awu-dialog / .awu-focus / .awu-editorConfirm` 中，`.awu-dialog`（2979 `blur(30px) saturate(180%)`）、`.awu-focus`（3116 `blur(20px)…`）、`.awu-editorConfirmCard`（2922 `blur(30px)`）三张**本身就带 backdrop-filter**，首帧就会被挂上 `will-change: opacity, transform, scale`。只有 `.awu-scrim`（实测无 blur）与 `.awu-editor`（无 blur）是安全的。
- **影响**：弹层 / 专注层进场那 240~320ms 里玻璃可能退化成「假半透明」或停在中间帧（#28 原症状）；同时 `.awu-dialog` 自己还在播 `awu-sheet-in`（含 `translateY(24px)`），既是逐帧重采样（#29）又是层提升，两个风险叠加。
- **建议**：清单收窄成只留实测无 blur 的两张（`.awu-scrim[data-still="true"]`、`.awu-editor[data-still="true"]`），或整段 will-change 直接删掉（data-still 现在的语义只剩"买层提升"，而这三层本来就会因为 opacity/transform 动画自动合成）。顺带修三处过期注释：`parts.tsx:115`、`editor-focus.tsx:140`、`index.tsx:2539-2543` 仍写「带着 data-still 渲染 = 这次进入不 blur」，CSS 早就不摘 blur 了。
- **是否实测**：是。
  ```
  // 弹层首帧 120ms，.awu-dialog
  {"still":"true","willChange":"opacity, transform, scale",
   "backdrop":"blur(30px) saturate(1.8)","anim":"awu-sheet-in","fill":"none"}
  ```

### F2 · P1 · 面板退场给自己挂 `will-change: opacity` + opacity 动画（铁律直球命中）

- **文件:行**：`client/styles.ts:4137-4146`
- **现象**：`.awu-panel[data-state="closing"]` 与 dialog/scrim/editor 共用一条 `animation: awu-exit … both; will-change: opacity`。面板是**带 20px blur 的玻璃本体**，556 行那句「面板本体不再播任何动画」在这里被自己破例，且破例方式是铁律里点名禁止的那种（`will-change: opacity`）。
- **影响**：退场 160ms 内 1.12M px 的 `backdrop-filter` 逐帧重采样（#29），且 `opacity < 1` 会造独立渲染表面 → 退场期玻璃可能「发灰变雾」。**不是硬切**（实测 `backdrop-filter` 全段恒定，没有 #30 的二段式）。
- **建议**：至少删掉这一行的 `will-change: opacity`（160ms 的 opacity 动画本身必然合成，此处的层提升没有收益，只有破坏采样的代价）；若「退场淡出」就是要保留，请把这条**豁免显式写进注释 + KB #28/#42**（现在文件里是两条互相矛盾的绝对口吻：556「面板本体不再播任何动画」vs 4143「面板在播 awu-exit」）。
- **是否实测**：是（给面板挂 `data-state="closing"` 后采样）。
  ```
  常态   : anim=none   wc=auto    op=1  blur=blur(20px) saturate(1.38)  getAnimations()=0
  closing: anim=awu-exit dur=0.16s fill=both  wc=opacity  op=1  blur=blur(20px) saturate(1.38)  getAnimations()=1
  ```

### F3 · P1 · 骨架退场 abs 后宽度 272→336px、左移 32px

- **文件:行**：`client/styles.ts:4020-4026`（`left:0; right:0`）+ `663-674`（`.awu-pane` 的 `padding: … var(--awu-gutter) …`）
- **现象**：绝对定位的包含块是 padding box，`left:0; right:0` 会把骨架撑到 **padding 边**，比它在流里占的**内容宽**多出左右各一个 gutter。实测常态 `.awu-skRow` 宽 272px，挂 `data-state="closing"` 后容器宽 336px 且起点左移 32px。
- **影响**：这条规则的初衷是「别让骨架+内容上下并存抖一下」，现在把竖向抖动换成了**横向涨宽 23% + 左移**，在 236~272px 的窄栏里是最显眼的方向，且正好发生在"加载完"这个用户正在看的瞬间。不产生横向滚动条（实测 `scrollWidth == clientWidth`，因为只是刚好填满 padding box，不是溢出）。
- **建议**：`left: var(--awu-gutter); right: var(--awu-gutter);`（等价 `inset-inline: var(--awu-gutter)`），让 abs 宽度与流内宽度逐字相等；`.awu-mainBody` 里的骨架同理（它 padding 同为 gutter）。
- **是否实测**：是。
  ```
  {paneW:336, panePadding:32px, rowW_流内:272, 容器W_abs:336, rowH_常态:76, rowH_abs:76,
   paneScrollW:336, paneClientW:336}
  ```

### F4 · P2 · 三处「进场」用了 `both`（#31/#42）

- **文件:行**：`client/styles.ts:807`（`.awu-mainBody > *` → `awu-view-in … both`）、`3992`（四套折叠体 `awu-fold-in … both`）、`4002`（`.awu-notice` / `.awu-status[data-status="info"|"warn"]` → `awu-rise … both`）
- **现象**：三条都是 `from` 为不可见的生产型进场，却用了 `both`。同文件 4166-4171 已经把口径写成「进场用它 `backwards`」。
- **影响**：动画因环境原因不启动时元素会永久停在 `opacity:0`（#31 是项目真踩过的整块面板不可见）。目前三条 `animation-delay` 都是 0，风险是"万一"而非必现，但与自订口径矛盾，也会让下一个改这段的人不知道哪条才是规矩。
- **建议**：统一改 `backwards`。正确样板就在 `client/styles.ts:604-616`（实测 head/status/workspace 全 `backwards`）。
- **是否实测**：是（`.awu-mainBody > *`）。
  ```
  viewRoot: awu-view-in | 0.12s | 0s | both      ← 应为 backwards
  ```

### F5 · P2 · 降级四件套缺 `forced-colors`

- **文件:行**：全文 **0 处** `forced-colors`（`client/*.ts`、`client/*.tsx` 全扫过）
- **现象**：`prefers-reduced-motion`（4330）、`prefers-reduced-transparency`（4262）、`prefers-contrast`（4397）三段齐备，唯独没有 `forced-colors: active`。系统接管的部分是侥幸对的，接不住的没处理。
- **影响**：Windows 高对比下玻璃**仍然每帧做 20~30px 模糊**（背景已被系统换成实底 Canvas，模糊 0 收益），纯 GPU 成本；且焦点环颜色靠系统强制 `outline-color` 兜底，若哪天宿主/内核不改写 `outline-color`，25 条 `outline: 2px solid var(--awu-focus-ring)` 会变成低对比蓝环。
- **建议**：加一段
  `@media (forced-colors: active) { .awu-trigger,.awu-panel,.awu-editorFoot,.awu-editorConfirm,.awu-editorConfirmCard,.awu-scrim,.awu-dialog,.awu-focus,.awu-menu { backdrop-filter: none } }`
  焦点环若要显式兜底，注意 `verify-a11y` ⑦ 只认 `var()`（别写死 `CanvasText`，或加白名单）。
- **是否实测**：是（`Emulation.setEmulatedMedia {forced-colors: active}`）。
  ```
  mql(forced-colors:active)=true
  panel: backdrop=blur(20px) saturate(1.38)   ← 仍在模糊
         background-image="none, none"  box-shadow=none  border=rgb(0,0,0)   ← 系统已接管
  ```

### F6 · P2 · 降透明度清单「漏 `.awu-menu`、多 `.awu-scrim`」

- **文件:行**：`client/styles.ts:4295-4308`（注释宣称"8 个模糊面全部关掉，清单与代码里全部 backdrop-filter 出现处逐一对应"）
- **现象**：`.awu-menu`（1901 `backdrop-filter: var(--awu-blur)`）不在清单里；而清单里的 `.awu-scrim`（2952-2962）**实测没有 backdrop-filter**，是条死选择器。代码里真实 blur 面共 8 张：`trigger / panel / menu / editorFoot / editorConfirm / editorConfirmCard / dialog / focus`。
- **影响**：降透明开启后菜单仍做 30px 模糊（其背景已被 `--awu-surface-dialog:#232327` 换成不透明，白做）；那条"逐一对应"的注释是假的，下一个人照着它增删会继续漂移。
- **建议**：清单换成真实 8 面，删掉 `.awu-scrim` 条目。
- **是否实测**：是。
  ```
  reduce-transparency 下：menu="blur(30px) saturate(1.8)"  panel="none"  trigger="none"
  surfaceDialog=#232327（已不透明）
  ```

### F7 · P2 · 高对比没有抬「玻璃自身透光」，只关了质感附加层

- **文件:行**：`client/styles.ts:4397-4419`
- **现象**：注释的三条主线是「墨色抬档 / 分隔线抬档 / 玻璃降噪」，但第 3 条只动了 `saturate/brightness/sheen/card-hi/glass-2-hi`；`--awu-glass-1/2/3` 与 `--awu-scrim-bg` 原封不动（实测深色 `glass-1` 仍 `.70`、默认 `glass-2` 仍 `.44`；浅色 `.54/.68`；`scrim-bg` 深色仍 `.36`）。
- **影响**：高对比用户最需要的恰恰是"字后面别再透出壁纸"，而现在 `.awu-card`（`.44` 底）上的 12~13px 小字依然压在壁纸色上 —— 墨色抬到 `.82` 只是把字提亮，背景串色没减。
- **建议**：contrast 下各抬一档（深 `glass-1 .70→.82`、`glass-2 .44→.60`；浅 `.54→.70`、`.68→.80`），`scrim-bg` 同步加深（`.36→.50`、浅 `.16→.26`）；抬档后按设计文档 §2 的方法复算一遍 12px 小字比值。
- **是否实测**：是（见下方 §2 表 1 与表 3，glass/scrim 值两态一致）。

### F8 · P2 · 新规则两处写死值

- **文件:行**：`client/styles.ts:2531`（`@container` 里 `height: 76px`）、`client/styles.ts:4426`（`outline-width: 3px !important`）
- **现象**：`76px` 与 2504 `.awu-skRow { height: 76px }` 是同一数字的两份手抄；`3px` 无对应令牌。
- **影响**：将来改骨架基准行高（比如跟 `--awu-size-avatar` 一起抬）时，兜底值会静默漂移；`3px` 若设计要统一焦点环宽度，25 条简写仍各写 `2px`，两处会打架。
- **建议**：`--awu-sk-row-h: 76px` 抽到变量层，2504 与 2531 都引用；焦点环宽度可加 `--awu-focus-w: 2px`（简写里用 `var()` 不被 verify-a11y ⑦ 拦，因为它只查颜色）。
- **是否实测**：是（`@container` 兜底确实生效：rowH=76；无兜底应为 140）。

### F9 · P2 · `[data-exit]` 是全局裸属性选择器，且与 closing 规则重复

- **文件:行**：`client/styles.ts:4184-4198`（对照 `4172-4180`）
- **现象**：`[data-exit="right"], .awu-detail[data-exit="right"]` —— 前半条命中**任何**带该属性的元素，附带 `animation + pointer-events:none + overflow:hidden + contain:layout paint`。当前 JSX 只在退场期给 `.awu-detail` 挂（`index.tsx:1740` ✔）。另外 `overflow:hidden / contain:layout paint` 在 4178-4179 与 4188-4189/4196-4197 各写了两遍。
- **影响**：注释自己说"可挂在任意视图根节点（.awu-detail / .awu-guide / 以后的子视图）"—— 一旦有人为了记方向常驻挂这个属性，那一层就永久 `overflow:hidden` + 永久播一次退场；重复的那两行将来只改一处必漂移。
- **建议**：只保留「类+属性」形式（`.awu-detail[data-exit="left"]` 等已写），去掉裸 `[data-exit=…]`；`overflow/contain` 提成 `.awu-detail[data-state="closing"], .awu-detail[data-exit]` 一条。
- **是否实测**：是（实测 `.awu-detail` 常态 `overflow:visible / contain:none`，closing 时 `hidden / layout paint`，无意外常驻）。

### F10 · P2 · 存量：三张「带 blur 的元素自己在播 transform 动画」

- **文件:行**：`client/styles.ts:387`（`.awu-trigger:active{transform:scale(.985)}`，379 有 blur）、`client/styles.ts:1904`（`.awu-menu{animation:awu-menu-in}`，1901 有 blur）、`client/styles.ts:2986`（`.awu-dialog{animation:awu-sheet-in}`，2979 有 blur）
- **现象**：铁律原文是「带 `backdrop-filter` 的元素**及其任何祖先**都不许有 opacity/transform/scale 动画」，这三条都是元素**自身**在动。
- **影响**：与 F1 同源（层提升 + 逐帧重采样）。三条都不是本轮引入（sheet 上滑是既定观感），但本轮正在收口玻璃铁律，建议一并定性：要么记进 KB 当"退场/弹层已接受的豁免"，要么排进下一轮（比如 sheet 的 24px 上滑改到 dialog 内部内容层）。
- **是否实测**：静态读（F6 里实测了 `.awu-menu` 的 `backdrop-filter: blur(30px) saturate(1.8)` 这一半）。

---

## 2. 已确认没问题（含实测值）

**① 五张变量清单逐字一致 —— 通过。**
`styles.ts:51-55`（变量层）、`293`（浅色）、`4263`（降透明深）、`4279`（降透明浅）、`4398`（高对比深）、`4410`（高对比浅）六处都是
`.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog`，顺序与拼写完全相同，没有一轮新增选择器落在清单外。
实测 portal 到 body 的 `.awu-panelFade` 能取到 `--awu-scrim-bg` 并画出压暗层：`::before` = `animation: awu-scrim-in 0.2s backwards`、`opacity:1`、`background: rgba(0,0,0,0.36)`、外壳 `z-index:2147482000 / pointer-events:none`。

**② 高对比深浅两份都真生效（不是被浅色块压掉）。** 实测计算值（表 1）：

| 令牌 | 基线深 | **contrast 深** | 基线浅 | **contrast 浅** |
|---|---|---|---|---|
| `--awu-ink-mute` | rgba(235,235,245,.68) | **rgba(235,235,245,.82)** | rgba(60,60,67,.78) | **rgba(60,60,67,.88)** |
| `--awu-line` | rgba(255,255,255,.10) | **rgba(255,255,255,.18)** | rgba(60,60,67,.14) | **rgba(60,60,67,.24)** |
| `--awu-line-strong` | rgba(255,255,255,.18) | **rgba(255,255,255,.32)** | rgba(60,60,67,.24) | **rgba(60,60,67,.34)** |
| `--awu-sheen` | rgba(255,255,255,.13) | **transparent** | rgba(255,255,255,.46) | **transparent** |
| `--awu-card-hi` | rgba(255,255,255,.12) | **rgba(255,255,255,.06)** | rgba(255,255,255,.55) | **rgba(255,255,255,.28)** |
| `--awu-glass-2-hi` | rgba(98,98,112,.52) | **rgba(98,98,112,.48)** | rgba(255,255,255,.86) | **rgba(255,255,255,.77)** |
| `--awu-blur` | blur(30px) saturate(180%) | **blur(30px)** | 同深 | **blur(30px)** |
| `--awu-blur-panel` | blur(20px) saturate(138%) | **blur(20px)** | blur(18px) saturate(185%) brightness(1.03) | **blur(20px)** |

- 面板实际 `backdrop-filter`：contrast 浅 = `blur(20px)`、contrast 深 = `blur(20px)`（saturate 确实去掉了）；
- 面板 `background-image` 的径向高光在 contrast 下塌成 `rgba(0,0,0,0)`（sheen 关掉确实生效）；
- hover 提亮「减半」的数字对得上：深 = 基准 `.44` + 原提亮 `.08`/2 = `.48` ✔；浅 = `.68` + `.18`/2 = `.77` ✔；
- 焦点环：contrast 下 `*:focus-visible` 实测 `outline-width: 3px`（`matches(':focus-visible')=true`），基线为 `2px`；
- ⚠️ 唯一小瑕疵（不单列条目）：浅色下 `--awu-blur-panel` 的半径由 18px 变成 20px（与深色默认对齐），与注释「只保留几何所需的半径」措辞略有出入，观感无碍。

**③ 玻璃面板本体进场全程不动 —— 通过。**
`animation-name: none`、`will-change: auto`、`opacity: 1`、`getAnimations().length: 0`；外壳 `.awu-panelFade` 同样 `anim none / op 1 / wc auto`；压暗在 `::before`，基线 `opacity:1` + `backwards`（动画不跑最坏是"压暗瞬现"，不会"没压暗"）。

**④ 三段内容错开与 fill 全对 —— 通过。**
`head: awu-content-in | 0.2s | 0s | backwards`、`status: … | 0.04s | backwards`、`workspace: … | 0.08s | backwards`（位移仅 6px，scale .98→1）。

**⑤ `prefers-reduced-motion` × `prefers-contrast` 无交集冲突 —— 通过。**
两个特性同时开：`.awu-card` `animation-duration:1e-05s`、`animation-delay:0s`（星号守卫仍在起作用）、`.awu-panel` `anim none / wc auto`、高对比令牌仍生效（`ink-mute=.82`）、contast 的 `outline-width` 未被压回 2px。高对比块只动变量 + 一条 outline-width，不含任何 animation/transition，不会压掉守卫；降透明块同理（只重写令牌 + 关 blur），且源码位置都在 reduced-motion 段之前，无顺序反压。

**⑥ 动效闭环 / 令牌 / 位移 / stagger —— 通过。**
`node scripts/verify-ui.mjs` 7/7：keyframes 22 条全部有引用；时长只走令牌（6 个历史字面量白名单，本轮新增的 `animation` 全是 `var(--awu-t-*)`）；无 `transition: all`；`data-*` 选择器全带值；卡片错峰 ≤8。
位移实测：进场 6px（内容）/ 8px（rise）/ 10px（slide-in）/ 24px（sheet-in）；退场 12px（exit-down）/8px（±x、-rise）/0（exit、fold-out）—— 退场全部 ≤12px 且小于对应进场，退场**无 stagger**（错峰只出现在面板三段进场 0/40/80ms）。

**⑦ 详情退场 / `contain` / `overflow` 无副作用 —— 通过。**
`.awu-detail` 常态 `overflow:visible / contain:none / position:static`，closing 后 `animation:awu-exit-left / 0.16s / both / pointer-events:none / overflow:hidden / contain:layout paint`（显式 `data-exit` 正确覆盖默认 `right`）。
关键风险已排除：实测 `.awu-detail` 子树里 **0 个** `absolute/fixed` 后代，所以 `contain: layout` 新建包含块不会让任何元素跳位；也不会裁掉 focus ring（该子树内唯一的外描边元素在 `.awu-detail` 的 padding box 内）。

**⑧ `.awu-mainBody { overflow-x: hidden }` 没有引入裁剪 —— 通过。**
指南 / 日记 / 预设三个视图各扫一遍：`scrollWidth == clientWidth == 782`，超出 mainBody 左右边界（±0.5px）的元素数 = 0。取值也确认它是横向 `hidden`、纵向 `auto`。
残留风险（仅提示，未发现实例）：长路径/长 URL 这类不可断行的串以后会被裁掉而不是横向滚动。

**⑨ `@container` 兜底生效且不越权 —— 通过。**
`.awu-pane` 实测 `container-type: inline-size`（`position: relative` 未丢）；往 `.awu-pane` 里注入 `data-shape="detail"` 骨架，首行高度实测 **76px**（没有被 2524 的 140px 压住，说明 `@container` 规则靠源码顺序赢且容器命中）；主栏没有命名容器，故主栏的 detail 骨架仍走 140px，不受影响。

**⑩ `prefers-reduced-transparency` 令牌层通过（选择器清单问题见 F6）。**
实测 `.awu-panel` / `.awu-trigger` 的 `backdrop-filter: none`，`--awu-glass-1: #1e1e21`、`--awu-surface-dialog: #232327`（就地重写玻璃令牌的做法是对的，后代自动继承）。

**⑪ 校验器全绿（本轮统计）**：`verify-ui.mjs` 7/7、`verify-a11y.mjs` 8/8（模板串反引号 0、25 条 `outline` 全走 `var()`、14 个图标按钮都有可访问名、119 个 `button` 都带 `type`）。

**⑫ 箭头旋转收口齐全 —— 通过。**
`data-open="true" → rotate(90deg)` 五处都有：`.awu-editGroup`(2688)、`.awu-reviewMonth`(2191)、`.awu-previewSeg`(2267)、`.awu-loreDropped`(3462)、`.awu-loreInfoBlock`(3465)；JSX 侧 `data-open` 均带值（`loreInfoBlock` 用 `'true'|undefined`，符合 #33）；过渡走 `--awu-dur-2`。

---

## 3. 建议动作排序（给 lead）

1. **F1**：`styles.ts:4245-4251` 收窄清单（或删整段 will-change）+ 修 3 处过期 JS 注释 —— 1 处改动，风险最低收益最高。
2. **F3**：`styles.ts:4020-4026` 改成 `inset-inline: var(--awu-gutter)` —— 1 行，直接消掉可见的横向抖动。
3. **F2**：删 `styles.ts:4145` 的 `will-change: opacity`（保留面板退场的 opacity 动画），并补一句豁免注释 + 回写 KB #28。
4. **F4**：`807 / 3992 / 4002` 的 `both` → `backwards` —— 3 处机械改动。
5. F5/F6/F7 属降级完备性，建议合成一条"降级收口"批次一起做（含 forced-colors 新段 + 降透明清单纠偏 + 高对比抬玻璃）。
