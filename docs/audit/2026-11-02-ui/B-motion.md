# B · 动效（Motion）审查（dsh-ai-with-u）

> 检查员：inspector-motion（只读阶段）
> 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u`，HEAD `a7b5799`，`git status` 干净
> 范围：`client/styles.ts`(3587) / `distill.styles.ts`(235) / `guide.styles.ts`(203) 的全部 `@keyframes`/`animation`/`transition`，加上 8 个 tsx 的 inline style 与「动效触发点」接线（条件渲染、data-* 开关、动画 key）
> 未做：任何 client 文件修改、`npm build`、运行时录屏。凡需真机帧率/浏览器能力实测的项已标 ⚠️待确认
> 口径差异：`A-styles.md` 记「animation 声明 18 条」，本报告按行计 **19 条**（多算的是 `styles.ts:874` 的 scroll-timeline；`styles.ts:1054` 一条声明里含两个动画，按 2 个引用算）。两份报告不冲突。

## 0. 总量与一句话结论

| 指标 | 数值 | 证据 |
|---|---|---|
| `@keyframes` | **13** | styles.ts `878, 3475, 3480, 3485, 3487, 3492, 3497, 3502, 3507, 3512, 3517, 3522, 3524`；distill/guide **0** |
| `animation:` 声明 | **19** 行 / **20** 个引用 | 346, 399, 471, 670, 683, 737, 874, 1032, 1054(×2), 1095, 1299, 2006, 2028, 2229, 2406, 2453, 2475, 2592, 3184 |
| `transition:` 声明 | **31** | styles.ts（另 +1 条 `transition-duration` 降级 3563）；distill **1**（191）；guide **0** |
| tsx 里的 inline 动效 | **1 处** | `index.tsx:441` 的 `animationDelay`。**没有**任何 inline `animation`/`transition`/`animationName` |
| 时长种类 | **13 种** | 令牌 6（`.12 .18 .24 .34 .6 3.4`）+ 硬编码 7（`.26 .9 1.1 1.4 2.6 3.6 .01ms`） |
| 缓动 | **1 档 + 2 条线性** | `EASE`(styles.ts:21) 全局；`ease-in-out`(346,399,1054,1095)、`linear`(670,683,874,2006) |
| `prefers-reduced-motion` 块 | 2 个 | styles.ts:3542-3565（17 个选择器）、distill.styles.ts:232-234（1 个） |
| 降级漏网 | **3 个动画选择器 + 12 类 transition** | 见 §6 |
| 无退场动画的挂载点 | **13 类** | 见 §3.5 |

**结论**：这套动效的**基线很正**（单档弹簧缓动、时长全 token、0 处 `transition: all`、错峰只有一处真源、scroll-hint 有 `@supports` 降级），真正的问题不在"不好看"，而在 **① 只有"进"没有"出"**（面板/弹层/详情/展开全靠 React 卸载秒消失）、**② 状态切换（tab/list↔detail/骨架→内容/步骤）没有过渡，全靠 180ms 换底色**、**③ 两条无限循环的 paint 动画（`awu-glow` 的 box-shadow、`awu-shimmer` 的 background-position）在玻璃层上跑**、**④ reduced-motion 是"逐个选择器点名"的白名单，新增动画一定会漏**。

---

## 1. 动效现状图谱

### 1.1 动画（`animation:`）—— 19 条

| # | 元素 / 选择器 | 触发时机 | 动画 | 时长 | 缓动 | fill | 可中断 | 位置 |
|---|---|---|---|---|---|---|---|---|
| 1 | `.awu-panel` | 打开面板（首帧） | `awu-panel-in`（opacity + `scale:.985` + y6） | `.24s`(dur-3) | EASE | — | 否（卸载即消失） | styles.ts:471 / kf:3475 |
| 2 | `.awu-trigger[data-live] .awu-mark::after` | 有启用角色 | `awu-breathe`（opacity .35↔.85 + scale 1↔1.05） | `3.4s` ∞ | ease-in-out | — | 否（循环） | 346 / kf:3502 |
| 3 | `.awu-lamp[data-on]` | 会话灯亮 | `awu-pulse`（opacity 1↔.45） | `2.6s` ∞ | ease-in-out | — | 否（循环） | 399 / kf:3507 |
| 4 | `.awu-iconBtn[data-spin] svg` | `busy` | `awu-spin`（rotate 360） | `.9s` ∞ | linear | — | 否（循环） | 670 / kf:3522 |
| 5 | `.awu-panel[data-busy] .awu-head::after` | `busy` | `awu-progress`（background-position） | `1.1s` ∞ | linear | — | 否（循环） | 683 / kf:3524 |
| 6 | `.awu-status[data-status=live]::after`, `.awu-sigil::after` | 状态带出现 | `awu-sheen`（translateX -100%→100%） | `.6s` **1 次** | EASE | — | 否 | 737 / kf:3512 |
| 7 | `.awu-body::before`, `.awu-pane::before` | 滚动位置（scroll timeline） | `awu-scroll-hint`（opacity 0→1，`animation-range:0 24px`） | — | linear | `both` | **是**（跟手） | 874-876 / kf:878 |
| 8 | `.awu-card` | 列表挂载 | `awu-rise`（opacity + y8） | `.34s`(dur-4) | EASE | **backwards** | 否 | 1032 / kf:3487 |
| 9 | `.awu-card[data-live]` | 该卡为启用卡（或 `data-live` 翻转） | `awu-rise` + `awu-glow`（两个 box-shadow 呼吸） | `.34s` + `3.6s` ∞ | EASE + ease-in-out | rise:backwards | 否 | 1054 / kf:3497 |
| 10 | `.awu-avatar[data-live]::after` | 同上 | `awu-breathe` | `3.4s` ∞ | ease-in-out | — | 否 | 1095 |
| 11 | `.awu-detail` | 打开详情 | `awu-slide-in`（opacity + x10） | `.24s` | EASE | — | 否 | 1299 / kf:3492 |
| 12 | `.awu-skRow` | 加载中 | `awu-shimmer`（background-position） | `1.4s` ∞ | linear | — | 否 | 2006 / kf:3517 |
| 13 | `.awu-editor` | 进入编辑器 | `awu-slide-in` | `.24s` | EASE | — | 否 | 2028 |
| 14 | `.awu-editGroupBody` | 展开编辑分组 | `awu-fade` | `.18s`(dur-2) | EASE | — | 否 | 2229 / kf:3485 |
| 15 | `.awu-editorConfirm` | 未保存确认弹出 | `awu-fade` | `.18s` | EASE | — | 否 | 2406 |
| 16 | `.awu-scrim` | 弹层遮罩出现 | `awu-fade` | `.18s` | EASE | — | 否 | 2453 |
| 17 | `.awu-dialog` | sheet 出现 | `awu-sheet-in`（opacity + y24） | `.34s` | EASE | — | 否 | 2475 / kf:3480 |
| 18 | `.awu-focus` | 专注编辑层 | `awu-fade` | `.18s` | EASE | — | 否 | 2592 |
| 19 | `.awu-presetHeavyConfirm` | 重量确认条出现 | `awu-fade` | `.18s` | EASE | — | 否 | 3184 |

**利用率**：`awu-fade` 5 处、`awu-rise` 2、`awu-slide-in` 2、`awu-breathe` 2，其余各 1。13 条 keyframes 全部有引用，**没有死动画**。

### 1.2 过渡（`transition:`）—— 31 条（按属性族归类）

| 属性族 | 时长 | 缓动 | 代表位置 |
|---|---|---|---|
| 颜色/底色（background, color, border-color） | dur-2 `.18s` | EASE | 300, 381, 393, 533, 663, 827, 928, 969, 1030, 1142, 1226, 1320, 1611, 1690, 1766, 2143, 2167, 2330, 2352, 2378, 2532, 2575, 2716, 2838, 2952, 2992, 3249, 3331 |
| **box-shadow**（会 paint） | dur-2 | EASE | 300（trigger）、393（lamp）、663（iconBtn）、827（tab）、1030（card）、2143（editGroup）、2532（input focus ring） |
| opacity | dur-2/dur-3 | EASE | 341（mark::after）、1638（lineEdit）、2330（listRemove）、1638 |
| transform（hover/active 微位移） | dur-1 `.12s` / dur-2 | EASE | 300/663/1226（press 用 dur-1）、1030（card hover 用 dur-2）、1142（cardChevron 位移）、2177（chevron 旋转） |
| width（**layout**） | `.26s` | `cubic-bezier(.22,.61,.36,1)` | **distill.styles.ts:191**（`.awu-distill-bar > span`，已挂起未用） |

### 1.3 tsx 内联动效核查（8 个文件全量）

| 文件 | `style={{` 数 | 其中与动效有关 | 结论 |
|---|---|---|---|
| index.tsx | 41 | **1**：`:441` `animationDelay = min(index,8)*CARD_STAGGER` | 唯一真·inline 动效 |
| preset-view.tsx | 26 | 0（26 处全是 margin/flex/字号；`1026/1036` 的 chevron 是**固定** `rotate(±90deg)` 上下移按钮图标，不是动画） | 无 |
| distill.tsx | 1 | 0（`:542` `minHeight:72`） | 无 |
| lorebook-editor.tsx | 3 | 0（`176/186` 固定 rotate 上/下移图标；`563` rotate 90/0 切换 info 箭头，**没有 transition** → 硬跳） | 见 §2 缺口 G9 |
| card-editor.tsx | 2 | 0（`:387` margin、`:419` `height:8` 占位） | 无 |
| diary-review.tsx | 2 | 0（`:295` flex/minWidth） | 无 |
| preview.tsx | 5 | 0（`:132/144/154/155/161` margin/flex） | 无 |
| guide.tsx | 0 | — | 纯静态 |

**与 CSS 同名动画是否重复定义 → 没有重复**。`index.tsx:441` 只写 `animationDelay`，动画名/时长/曲线全在 `styles.ts:1032` 的 `.awu-card{animation:awu-rise … }`；34ms 这个值本身也只有一处真源（`styles.ts:37` `CARD_STAGGER`，由 CSS 注释与 JS 共用）。这是**正确**的做法，别改成两处各写一份。
唯一副作用：inline `animationDelay` 是**单值**，会同时作用于 `.awu-card[data-live]` 的**两条**动画（`1054`），于是启用卡的 `awu-glow` 呼吸被错峰拖后最多 272ms（P2 / S，见 §3.6）。

### 1.4 同名/近似重复的样式实现（工程债，不是 bug）

| 现象 | 证据 |
|---|---|
| 4 套"折叠体"实现、4 种展开手感 | `.awu-editGroupBody`(2229 有 fade) / `.awu-loreBody`(2845 **无动画**) / `.awu-reviewMonth > .awu-diary`(1668, 无) / `.awu-previewSeg`(1744, 无)；外加原生 `<details>` 的 `.awu-loreFold`(2961) 完全无动画 |
| 2 套 scrim+dialog 门户 | `index.tsx:257`（通用 Overlay，承载 10 个弹层分支：new/import/preview/preset/delete/mode/editDiary/forget/resetAll/resetSession）+ `distill.tsx:483`（自己复制了一份 scrim）；退场改造要改两处 |
| chevron 旋转规则重复 5 次 | `2177`（`--dur-2` transition）+ `2181/3055/1695/1771` 各自 `rotate(90deg)` |

---

## 2. 缺口清单（没有动效 / 动效断裂的关键交互）

> P0 = 高频主路径上体感明显断裂，或与她自己的设计语言冲突；P1 = 明显但可缓；P2 = 打磨。
> 工作量：S ≤30 行、M 30–120 行、L >120 行或跨文件结构改造。

| # | 缺口 | 证据（file:line） | 现状 | P | 量 |
|---|---|---|---|---|---|
| G1 | **面板关闭/退场完全没有** | `index.tsx:2620` `{open && … createPortal(...)}`；关闭按钮 `2702` | 点 × 或再点入口 → DOM 立刻消失，无 fade/scale-out | **P0** | M |
| G2 | **弹层 sheet 退场没有** | Overlay `index.tsx:257-276`；`styles.ts:2453`(scrim fade-in)、`2475`(sheet 进)；Esc/点遮罩 `index.tsx:240-251, 261-263` | 遮罩与 sheet 同时秒消失；进入 340ms、退出 0ms，明显"甩门" | **P0** | M |
| G3 | **list ↔ detail 只进不出** | 列表 `index.tsx:2964-2978`；detail 分支 `2991-3017`；detail 进入动画 `styles.ts:1299`；`onBack` `3002` | 进详情有 x10 滑入；点「返回」列表瞬间出现，**没有反方向位移** | **P0** | M |
| G4 | **tab 切换零过渡** | `index.tsx:2861-2878`（`setTab` 2873）；内容分支 `2991/3019/3059`；`.awu-tab[data-on]` 只换底 `styles.ts:833` | 4 个 tab 内容区硬切；无 crossfade，也无指示块位移 | **P0** | M |
| G5 | **分段控件没有滑块** | `.awu-tabs` `styles.ts:801-809`（纯 flex + padding）；`.awu-modePills` `908-915` | 选中态 = 目标格自己换背景（180ms）；没有"发光块从 A 滑到 B"的 iOS 分段感 | **P0** | S |
| G6 | **删除卡片无移除动效** | `onDeleteConfirmed` `index.tsx:2194-2202`；grid `2964-2978`（`key={item.name}`，无 wrapper） | 删完 `reload` → 该卡 DOM 直接消失、下面所有卡瞬跳一格（无 collapse / 无 FLIP） | **P0** | L |
| G7 | **日记按月折叠体无动画** | `diary-review.tsx:287` `{open && <div className="awu-diary">}`；CSS `styles.ts:1668-1675` 只有 `[data-open]` 换描边；chevron 有 `.18s` 旋转 `1695` | 点开：内容瞬间撑开（chevron 在转，正文没动） | **P1** | M |
| G8 | **世界书条目展开无动画 + 与卡编辑器不一致** | `lorebook-editor.tsx:200`（条目体判定 `data-open` 129，body `2845` 无动画）；卡编辑器同结构 **有** fade `card-editor.tsx:194` + `styles.ts:2229` | 同一界面里两种展开手感 | **P1** | S |
| G9 | **世界书「被裁条目」展开无动画** | `lorebook-editor.tsx:462-467`（`data-open` 容器）+ `490-502`（`{showDropped && <ul className="awu-loreDroppedList">}`）；chevron 有 `3055` | 硬切 | **P1** | S |
| G10 | **`<details>` 折叠区零动画** | `styles.ts:2961-2979`（`.awu-loreFold`，原生 `[open]`）；使用处 `lorebook-editor.tsx:560` 一带 | 原生 details 跳变；这里最该用 `@starting-style` + `allow-discrete` | **P2** | S |
| G11 | **导入没有进度/阶段反馈** | `index.tsx:1020-1022`（`{busy && parsed===undefined && <div className="awu-hint">解析中…</div>}`）；拖放区 `976-1006`，`[data-busy]` 只是 `opacity:.6` `styles.ts:3334` | 三阶段（选文件→解析→预览）之间只有一行文字；无 indeterminate 条、无上传字节、无 spinner | **P1** | M |
| G12 | **保存成功反馈没有进入动画** | notice 渲染 `index.tsx:2803-2823`；`.awu-status` 本身无 animation（只有 live 态有 `::after` sheen `737`）；自动消失 `NOTICE_TTL_MS=5000` `index.tsx:128` + `1907-1912` | 5s 后**秒消失**，无淡出；出现时也无 y-6 上浮，是"啪"地插入 | **P1** | S |
| G13 | **骨架 → 内容硬切** | `index.tsx:2953`（Skeleton）↔ `2964`（grid）；`styles.ts:2006` | 骨架屏形状已对齐（做得好），但切换是同帧替换，无 120ms crossfade | **P1** | S |
| G14 | **编辑器接管/退出不对称** | 进入 `index.tsx:2646` + `styles.ts:2028`（slide-in）；`onCancel` `2657` / `setEditing(false)` | 进有动画，出一闪 | **P1** | S |
| G15 | **专注层只 fade，没有"升起"** | `editor-focus.tsx:124` + `styles.ts:2592` | 全屏长文本层只 180ms 淡入，层级感靠 z-index；退出无 | **P2** | S |
| G16 | **preset 列表 ↔ 编辑页硬切** | `preset-view.tsx:421`(`view` state) / `543`(`if (view==='list')`) | 同层两种"页"，无方向感（列表→编辑应向右推入） | **P2** | M |
| G17 | **蒸馏 1→2 步硬切** | `distill.tsx:508`(`step==='confirm'`) / `376` + `450/466` | 确认 → 已发送瞬间换内容，用户不知"发生了什么" | **P2** | S |
| G18 | **hover 有、press 无的控件** | 38 处 `:hover` vs **5 处** `:active`（`305, 668, 1045, 1231, 1324`）。无 press 态：`.awu-tab`(831)、`.awu-modePill`(931)、`.awu-loreRow`(2841)、`.awu-loreRowBtn`(2955)、`.awu-editGroupHead`(2170)、`.awu-reviewMonthHead`(1693)、`.awu-previewSegHead`(1769)、`.awu-check`(2578)、`.awu-noticeClose`(972)、`.awu-editListRemove`(2335)、`.awu-editAdd`(2356)、`.awu-lineEdit`(1644)；导入拖放区 `styles.ts:3320-3334` **连 hover 都没有** | 点击只有"结果"没有"触感" | **P1** | S |
| G19 | **滚动进入视口无渐显，stagger 只在挂载** | 只有 `index.tsx:441`；全库 **0 处** `IntersectionObserver`（grep 无命中） | 长列表（rail 单列，见 §3.6）第 10 张起全靠"已经在那"；滚动到下方无入场上浮 | **P2** | M |
| G20 | **筛选/排序无位移** | `diary-review.tsx:145`(`keyword` state) + `267`(`filtered.map`)；preset 列表 `preset-view.tsx:590-630` | 改关键词 → 月份列表瞬变，无"行往下让"的过渡 | **P2** | M |
| G21 | **空态/错误条无进入动画** | `.awu-empty` `styles.ts:1920`；`.awu-err` `styles.ts:1979-1992`；notice `index.tsx:2803` | 与"液态玻璃"的柔性调性不符（P2 可并入 G12 一起做） | **P2** | S |
| G22 | **`busy` 只换文案，没有进度语义** | 按钮文本 `t('common.busy')`：`index.tsx:1114/1118/1166`；只有刷新图标转（`2692-2695`，`styles.ts:670`） | 长任务时按钮只变"处理中…"，用户不知道还要多久；⚠️与 G11 同源 | **P2** | S |

---

## 3. 体验与工程问题

### 3.1 时长不统一：13 种值（P1 / S）

- 令牌 6 档：`.12 / .18 / .24 / .34 / .6 / 3.4`（`styles.ts:182-187`）。
- 硬编码 7 个：`.9s`（spin 670）、`1.1s`（progress 683）、`1.4s`（shimmer 2006）、`2.6s`（pulse 399）、`3.6s`（glow 1054）、`.26s`（distill bar `distill.styles.ts:191`，且用了一条**不在令牌里**的曲线 `cubic-bezier(.22,.61,.36,1)`，与全局 `EASE` 不同）、`.01ms`（降级 3563）。
- 问题不在数量本身（环境动画确实需要长时长），而在**两处曲线漂移**（distill 的 `.26s` + 另一条 cubic-bezier）与**"进入 340ms / 退出 0ms"** 的节奏不对称。规范里应只有 `enter / exit / ambient` 三条语义。

### 3.2 `transition: all` = 0 处 ✓（不用改）

全库 grep `transition:\s*all` **零命中**。这是这套 CSS 最值得保留的纪律。

### 3.3 触发 layout / paint 的动画：1 处 width，其余靠 paint

| 动画 | 属性 | 是否 layout | 代价 | 位置 |
|---|---|---|---|---|
| `.awu-distill-bar > span` | `width` | **是** | 每帧 layout + paint；好在整组 UI 已挂起未用 | distill.styles.ts:191 |
| `awu-glow` | `box-shadow`（2 个阴影） | 否，但 **paint 每帧** | 卡片 16px 圆角 + 24/32px 模糊，每帧重画整卡 | styles.ts:3497-3499（用于 1054） |
| `awu-shimmer` | `background-position`（300% 宽渐变） | 否，**paint** | 骨架行（每行 76px 高，卡片形态更高）持续重绘 | 3517-3520（用于 2006） |
| `awu-progress` | `background-position` | 否，paint | 2px 高、全宽条 | 3524-3527（用于 683） |
| `awu-sheen` | `transform` | 否 | 合成，且**只跑一次**（737 `1`） | 3512 |
| `awu-rise/slide-in/panel-in/breathe/sheet-in` | `transform` + `opacity` | 否 | 合成 | 3475-3505 |

**结论**：没有 `top/left/height` 动画（✓）；唯一 layout 动画在死代码里；paint 类有 3 条，其中 `awu-glow` 是**无限循环**，见 §4。

### 3.4 `animation-fill-mode`

- 唯一带 delay 的动画是 `.awu-card`（`1032`），它**正确地**用了 `backwards`，所以错峰期间是"透明待命"而不是"先显示再闪一下" ✓。
- `.awu-card[data-live]`（`1054`）的 `awu-glow` 无 fill（infinite，无影响）。
- 其余动画 delay=0、无 fill，首帧即 `from` 状态，**未发现因 fill 遗漏导致的闪烁** ✓。
- 唯一可挑的：`awu-panel-in`（`3475`）在 `from` 里同时写 `scale` 与 `transform`，且 `.awu-panel` 常驻 `will-change: transform, opacity`（`470`）——见 §4.3。

### 3.5 React 卸载即消失（无退出动画）—— 全清单（13 类挂载点，P0 群）

| # | 组件 | 挂载点 |
|---|---|---|
| 1 | 主面板 | `index.tsx:2620` |
| 2 | 通用 Overlay（遮罩 + sheet）——**承载 10 个弹层分支** | 组件 `index.tsx:257`；挂载分支 `3103`(new) `3112`(import) `3121`(preview) `3127`(preset) `3138`(delete) `3147`(mode) `3156`(editDiary) `3166`(forget) `3175`(resetAll) `3186`(resetSession)；各弹层自带 `<Overlay>` 调用 `630, 967, 1140, 1188, 1246, 1304, 1349` |
| 3 | 蒸馏弹层自己的 scrim+dialog | `distill.tsx:483-491` |
| 4 | 卡编辑器接管 | `index.tsx:2646` |
| 5 | 详情视图（返回时） | `index.tsx:2991` / `3002` |
| 6 | notice 条 | `index.tsx:2803` |
| 7 | 日记月折叠体 | `diary-review.tsx:287` |
| 8 | 世界书条目体 | `lorebook-editor.tsx:200`、`441` |
| 9 | 卡编辑器分组体 | `card-editor.tsx:194` |
| 10 | 预览段正文 | `preview.tsx:210` |
| 11 | 专注编辑层 | `editor-focus.tsx:124`（在 `card-editor.tsx` 内条件渲染） |
| 12 | 编辑器未保存确认层 | `styles.ts:2394`（`.awu-editorConfirm`，仅 fade-in） |
| 13 | 骨架屏 | `index.tsx:2953` |

一个 `usePresence(open, ms)` + 3 个挂载点的改造能一次覆盖 1/2/3/4/5/11（见 §5.3）。

### 3.6 stagger 累积计算（**不要**盲目加大）

- 公式：`animationDelay = min(index, 8) × 34ms`（`index.tsx:441`，`CARD_STAGGER=34` `styles.ts:37`）。
- **9 张卡**：最后一张 delay `272ms`，动画 `340ms` → 全部落位 `612ms`。
- **20 / 50 / 200 张卡**：仍是 `272ms` + `340ms = 612ms`（cap 生效，**不累积**）✓。
- 如果去掉 cap：20 张 = `646+340=986ms`；50 张 = `1666+340≈2.0s`（不可接受）。→ **cap 8 是正确决策，别"优化"掉**。
- 真正的隐性成本：`.awu-grid` 在 `.awu-rail`（340px）里、`minmax(240px,1fr)`（`styles.ts:1002`）→ **单列**，所以 34ms 是"每行错峰"，9 行 272ms 的瀑布观感成立；但也意味着**第 10 张起完全没有错峰**，视觉上是"前 9 张依次亮，剩下的同时亮"（P3 观感，不建议为此延长 cap）。
- 反向问题：由于 `reload()` **不会**把 `loading` 重新置 true（`index.tsx:1947` 只有 `setLoading(false)`，全文件无第二次 `setLoading(true)`），刷新/保存后列表**不会重播** stagger ✓（好事，别动）。

### 3.7 其他工程问题

- **`.awu-card[data-live]` 翻转会重播整条动画**：`animation` 属性从 `awu-rise` 变成 `awu-rise, awu-glow`（`1054`）→ 浏览器重启动画，卡片会先透明（backwards + delay 最长 272ms）再升起。启用一张卡时"卡闪一下"（P2 / S，改成把 glow 拆到 `::after` 或独立 `animation-name` 不动 rise 即可）。
- **修改 `data-open` 无过渡的 4 套折叠**：见 §1.4，统一成一套 `grid-template-rows: 0fr→1fr` 后，`allow-discrete` 只在 `<details>` 那处需要（其余靠状态驱动，可以纯 CSS transition）。
- **distill 的 `.26s` 曲线与全局不一致**（`distill.styles.ts:191`），恢复该 UI 时要改。
- **`transition-duration: .01ms` 覆盖清单**（`3563`）里包含 `.awu-line`，但 `.awu-line` 的 transition 只有 `background`（`1611`）——说明这份清单是"凭记忆列的"，已经漂移（见 §6）。

---

## 4. 性能红线

### 4.1 合成层数量：8 个 `backdrop-filter` 面，最多 4 层叠加（P0 / M）

| 面 | 模糊 | 面积 | 位置 |
|---|---|---|---|
| `.awu-trigger`（侧栏入口） | `blur(30px) saturate(180%)` | 340×44 | 297-298 |
| `.awu-panel` | `blur(20px) saturate(150%)` | **1120×900** | 457-458 |
| `.awu-editorFoot` | `blur(30px)` | 全宽×~70 | 2369-2370 |
| `.awu-editorConfirm` | `blur(6px)` | 面板全屏 | 2403-2404 |
| `.awu-editorConfirmCard` | `blur(30px)` | 420×~200 | 2416-2417 |
| `.awu-scrim` | `blur(6px)` | **视口全屏 (fixed)** | 2451-2452 |
| `.awu-dialog` | `blur(30px)` | 620×~700 | 2468-2469 |
| `.awu-focus` | `blur(30px)` | 面板全屏 | 2590-2591 |

- **最坏同时存在 4 层**（面板 + editorFoot + focus + confirmCard），其中 2 层是 `blur(30px)` 全屏级。每层都会为"下方所有内容"建立 backdrop 快照，任意一层下方有东西在动 → 全部重算模糊。
- `--awu-blur-panel` 的注释（`styles.ts:69`）已经写明了这个权衡（"强 blur 只留给小面积"），但 `.awu-scrim`（2451，**视口全屏 + 6px**）与 `.awu-focus`（2590，**面板全屏 + 30px**）仍是"大面积"档，与注释的意图冲突（6px 面积大尚可接受，30px 全屏是主要风险）。
- 具体掉帧点：
  1. **面板进入**：`awu-panel-in` 对带 `blur(20)` 的 1120×900 元素做 `opacity + scale`（`471`），且 `box-shadow` 里还带 `0 0 0 100vmax` 的全屏遮罩影（`461`）→ 240ms 内每帧都要重算大面积模糊 + 重画巨影。**建议：进入动画只做 `opacity`，不做 `scale`（或把 scale 从 1.0 提到 .995 以内），并在动画期间给面板临时 `backdrop-filter: none`，`animationend` 后加回**（一次性 class 切换，约 10 行）。
  2. **sheet 进入**：`awu-sheet-in` 的 `translateY` 作用在 `blur(30)` 的 `.awu-dialog`（`2475`）上，叠在 `blur(6)` 全屏 `.awu-scrim`（`2451`）之上 → 340ms 双模糊逐帧重算。**建议：进位移交给不含 blur 的外层 wrapper，`.awu-dialog` 本体只做 `opacity`**（这条改动要动 CSS 结构，M）。
  3. `.awu-focus`（2590）在编辑器里叠在 `.awu-editorFoot` 之上，两个 30px 模糊互相隔着 → 打开专注层会同时重算两层。

### 4.2 `filter: blur()` 动画：无（✓）

全库 `filter:` 只有 `brightness`（`1245`，主按钮 hover，非模糊、无 transition）。**没有**对 `filter` 做动画 ✓。

### 4.3 `will-change` 常驻（P1 / S）

- `styles.ts:470` `.awu-panel { will-change: transform, opacity }` 是**永久**声明，面板关闭后才销毁。它让 1120×900 面板+其内部（含 `backdrop-filter`）常驻一个合成层，显存 ~4MB 级（1120×900×4B）且阻止"动画结束回收层"。
- 建议：入场时由 `.awu-panel[data-entering]` 加 `will-change`，`animationend` 移除（`index.tsx:2622` 旁边加一个 onAnimationEnd 即可，~5 行）；或干脆删掉——`transform/opacity` 动画本身会自动提升。

### 4.4 `awu-glow`：每帧重绘 box-shadow 的无限动画（**P0 / M**）

```css
/* styles.ts:3497-3499 · 挂在 .awu-card[data-live="true"] 上（1054），3.6s infinite */
0%,100% { box-shadow: 0 0 0 1px color-mix(...18%...), 0 8px 24px color-mix(...12%...); }
50%     { box-shadow: 0 0 0 1px color-mix(...34%...), 0 12px 32px color-mix(...20%...); }
```

- box-shadow **不可合成**，只能每帧 paint。这个动画在"有启用角色"时**永不停**，而 `.awu-card` 同时有 `overflow:hidden` + 16px 圆角 + `background-image: radial-gradient`（`1023`）→ 每帧重画整卡（含径向渐变）。卡片在 340px 单列里高度 ~120px，视口内可能同时多张（详情页返回后仍在）。
- **替代实现（推荐，S）**：`::after` 铺一层 `inset:-1px` 的 `border-radius:inherit` + `box-shadow` 静态两档，用 `opacity` 在 `.35↔.85` 呼吸（`opacity` 合成，devtools 里不会触发 paint）；或直接用 `background: radial-gradient` 定位到卡外 `::before` 上做 opacity 呼吸。改动约 12 行 CSS + 1 行 keyframes 改名，零 JS。

### 4.5 `awu-shimmer` / `awu-progress`：background-position 的 paint 循环（P1 / S）

- `3517-3520` 让 `.awu-skRow`（`2006`）的 300% 宽渐变每帧平移 → 每次 paint 一整行（卡片形态下更高，`2009-2011` 用 calc 算高度）。
- 替代：把 shimmer 改成**一个 `::after` 的 `transform: translateX(-100%)→(100%)`**（与 `awu-sheen` 3512 完全同构，可直接复用）。骨架屏属性 `overflow:hidden` 已有 `border-radius`，改 6 行。
- `awu-progress`（3524）同理，但它只有 2px 高，收益小 → P2，可不改。

### 4.6 box-shadow 的 hover 过渡（P2 / S）

- `.awu-card` 的 `transition` 含 `box-shadow`（`1030`）+ hover 换成 `--awu-shadow-card-hi`（`0 14px 34px`，`66`）→ hover 的 180ms 里每帧 paint 整卡；同时 `transform: translateY(-2px)` 是合成的 → **合成与 paint 混在一起**，实事上是 hover 时最掉帧的一瞬。
- 替代：hover 阴影用 `::after`（静态 `box-shadow` / 或 `opacity` 双态）做 opacity 过渡，`transform` 保留。改动集中在 `1009-1045`，约 20 行。同类：`.awu-editGroup`(2143)、`.awu-input` focus ring(2532)。

### 4.7 汇总：会掉帧的动画（按严重度）

| 动画 | 掉帧机制 | 位置 | P |
|---|---|---|---|
| `awu-glow` | box-shadow 每帧 paint，**无限循环** | 3497 / 1054 | **P0** |
| 面板进入 | 大面 blur(20) 上做 opacity+scale，且带 100vmax 巨影 | 471 / 3475 / 461 | **P0** |
| sheet 进入 | translateY 作用在 blur(30) 上，叠 blur(6) 全屏 | 2475 / 2451 | **P0** |
| `awu-shimmer` | background-position 每帧 paint | 3517 / 2006 | P1 |
| card hover | box-shadow 与 transform 混用过渡 | 1030-1042 | P1 |
| `will-change` 常驻 | 层不回收，占显存 | 470 | P1 |
| `.awu-focus` 叠加 | 两层 30px blur 相邻 | 2590 / 2369 | P2 |
| `awu-progress` | 2px 条 paint | 3524 / 683 | P2 |

---

## 5. 动效系统提案（可落地）

### 5.1 令牌：把 13 种时长收成 6 档语义 + 3 条曲线（P1 / S，改 1 处）

```css
/* styles.ts:180-187 替换（旧名保留为别名，避免全库改 300 处） */
/* 语义名 */
--awu-t-fast:    120ms;   /* press / 图标 / 指针跟随 */
--awu-t-base:    200ms;   /* hover、色变、焦点环（原 180，±20 统一） */
--awu-t-mid:     240ms;   /* 层级内位移（详情/编辑器进入） */
--awu-t-enter:   320ms;   /* sheet / 面板 / 大层进入（原 340 → 320） */
--awu-t-exit:    160ms;   /* ★ 所有退场：永远比进入快 ~40% */
--awu-t-slow:    600ms;   /* 一次性扫光 / 大位移 */
--awu-t-ambient: 3400ms;  /* 呼吸、辉光、加载（环境层） */
/* 别名（先别动调用方） */
--awu-dur-1: var(--awu-t-fast);
--awu-dur-2: var(--awu-t-base);
--awu-dur-3: var(--awu-t-mid);
--awu-dur-4: var(--awu-t-enter);
--awu-dur-5: var(--awu-t-slow);
--awu-dur-breathe: var(--awu-t-ambient);
/* 曲线：3 条，按方向分工 */
--awu-ease:      cubic-bezier(.32,.72,0,1);   /* 进入（保留，别动） */
--awu-ease-out:  cubic-bezier(.22,1,.36,1);   /* 退场 / 位移收尾（收得快） */
--awu-ease-in:   cubic-bezier(.55,0,1,.45);   /* 收起 / 被删除 */
```

可选（**只在 `@supports (animation-timing-function: linear(0,1))` 内**）给"弹性段"：
`--awu-ease-spring: linear(...)` —— ⚠️具体采样点应由工具生成（如 spring-easing / linear-easing-generator 输入 stiffness 180 / damping 26），**本报告不给未验证的手写曲线**。当前 `EASE` 已经在体感上当弹簧用，**不建议**为了"更像 iOS"引入第二条曲线体系。

**改完的收益**：`3.4s/3.6s/2.6s` 三个"环境值"归并到 `ambient`（视觉上无区别，可读性提升），`1.1s/1.4s/.9s` 三个加载值也归到 `ambient` 的派生（如 `calc(var(--awu-t-ambient)/3)` 或保留字面量但在注释里标注"加载类，允许偏离"）。

### 5.2 分场景编排规则（写进 `docs/design/` 的正式条款，P2 / S）

| 场景 | 变什么 | 时长 | 缓动 | 错峰 | 备注 |
|---|---|---|---|---|---|
| **进入 · 面板** | opacity + `scale .985→1` + y6 | 240 | `--awu-ease` | 无 | 与现状一致，只把 340 改 240；期内临时关 `backdrop-filter`（见 §4.1） |
| **进入 · sheet** | opacity + y24 | 320 | `--awu-ease` | 无 | 位移交给 wrapper，本体只 opacity |
| **进入 · 弹窗内元素** | opacity + y4 | 200 | `--awu-ease` | 24ms，cap 6 | 弹层里出现 2 个以上块才用 |
| **退场（全部）** | opacity（+ 反向 2~4px） | **160** | `--awu-ease-out` | **不 stagger** | 退场绝不逐项延迟，用户已经在等它消失 |
| **切换 · tab** | 内容 opacity 0→1 | 120 | `--awu-ease-out` | 无 | 不做位移（4 个 tab 是平级） |
| **切换 · list↔detail** | 进入 x8（从右），返回 x-8（从左） | 200 | `--awu-ease` | 无 | 方向必须与"前进/后退"语义一致 |
| **展开/收起** | `grid-template-rows: 0fr↔1fr` + opacity | 200/160 | `--awu-ease` / `--awu-ease-in` | 无 | 4 套折叠统一走这条（§1.4） |
| **列表项进入** | opacity + y8 | 200 | `--awu-ease` | 24ms，cap 8（192ms） | 改 34→24 让瀑布更紧凑（可选） |
| **删除** | 先 `opacity→0, scale .98`（120ms），再 FLIP 位移（200ms） | 320 总 | `--awu-ease-in` → `--awu-ease` | 无 | 需要 FLIP（§5.4 ③） |
| **成功反馈** | notice `opacity + y-6` 进 200 / 出 160 | 200/160 | ease / ease-out | 无 | 5s 后必须先淡出再卸载 |
| **错误** | 不抖动（或 1 次 220ms 的 2px 抖动） | 220 | linear | 无 | 抖动是最容易被嫌吵的动效，默认不做 |
| **加载** | 骨架 shimmer `1.4s`；进度条用 `scaleX` | ambient | linear | 无 | 超过 400ms 才显示 spinner（避免闪） |
| **hover / press** | 色变 120ms；press `scale .97` 100ms，松手 160ms | fast | ease | 无 | 所有 `:hover` 有 `:active` 的都要配对（§G18） |

### 5.3 退出动画：三条路的取舍（含宿主规范核查）

**A. `@starting-style`（Chrome 117+）** —— 只能解决**进入**的首帧跳变，**解决不了退出**：React 卸载后 DOM 节点已不存在，没有"过渡主体"。
唯一真正适用的地方是**原生 `<details>`**：`.awu-loreFold`（`styles.ts:2961-2979`）可以用 `interpolate-size / transition-behavior: allow-discrete` + `@starting-style` 做 `[open]` 的真展开动画，**不碰 React**。→ 用在 G10（P2 / S）。

**B. 延迟卸载 hook（推荐主路径）** ——

```ts
// 新增 client/motion.ts（~30 行）
export function usePresence(open: boolean, ms = 160): { mounted: boolean; state: 'open' | 'closing' } {
  const [mounted, setMounted] = useState(open)
  const [state, setState] = useState<'open' | 'closing'>(open ? 'open' : 'closing')
  useEffect(() => {
    if (open) { setMounted(true); setState('open'); return }
    setState('closing')
    const t = window.setTimeout(() => setMounted(false), ms)
    return () => window.clearTimeout(t)
  }, [open, ms])
  return { mounted, state }
}
```

落点只需 3 处：`index.tsx:2620`（面板）、`index.tsx:257`（Overlay）、`index.tsx:2646`（编辑器）；蒸馏那份复制件 `distill.tsx:483` 同改。CSS 加：

```css
.awu-panel[data-state="closing"], .awu-scrim[data-state="closing"], .awu-dialog[data-state="closing"], .awu-editor[data-state="closing"] {
  animation: awu-exit var(--awu-t-exit) var(--awu-ease-out) both; pointer-events: none;
}
@keyframes awu-exit { from { opacity: 1; } to { opacity: 0; } }
```

**风险（必须一起处理，否则会引入 P0 级 bug）**：
1. **焦点恢复时序**：`useRestoreFocus()`（`index.tsx:235`）在卸载时才把焦点还回去；延迟卸载期间焦点还留在正在淡出的节点上 → 必须在 `state==='closing'` 时立刻 `blur` 或把焦点移到 `document.body`，否则淡出中 Tab 会跳进虚空。
2. **滚动锁时序**：`useScrollLock(true)`（`index.tsx:232`）若随 mount 生命周期走，退场 160ms 内页面仍锁滚动（可接受）；但若在 open=false 立刻解锁，用户会在遮罩还在时滚到底层 → 保持"卸载时解锁"即可，别改成跟着 `open` 走。
3. **快速连开连关**：`setTimeout` 必须被 effect 清理（上面已写 return），否则会出现"关了又自己开回来"。
4. **Esc 的两层语义**：`escYield`（`index.tsx:228/244`）依赖"内层还在 DOM"，延迟卸载期间内层已关但外层还在 → 内层 closing 时要把 `escYield` 置 false，否则 Esc 会被吞 160ms。
5. **`animation-fill-mode: both`** 保证淡出到 0 才卸载，避免末帧闪回。

**C. View Transitions API 在 DSH 宿主的可行性（已实际查证）**

| 核查项 | 结论 | 证据 |
|---|---|---|
| 宿主运行时是否支持 | **支持**。桌面端 Electron **44.7.0**（`D:\CODEX\DSH-desktop\version`），Chromium 远高于 `startViewTransition` 的 111+ 与 `@starting-style` 的 117+；旁证：项目已在用 `@supports (animation-timeline: scroll())`（`styles.ts:863`，需 115+）与独立的 `scale` 属性（`3476`，需 104+） | `D:\CODEX\DSH-desktop\version` = `44.7.0` |
| Web 端（浏览器打开 GUI）是否保证 | **不保证**。宿主支持隧道/反代访问（`docs/PLUGIN-DEV-GUIDE.md:131`），用户可能用任意浏览器 → 必须 `if ('startViewTransition' in document)` 双闸 | 同上 |
| 规范里有没有禁止条款 | **没有明确禁止**。`docs/PLUGIN-DEV-GUIDE.md` 全文 grep `View|过渡|动画` 只命中 5 处，无一条提到 View Transitions；最接近的是 `:149`「**不要在组件外写 DOM、不要读别的插件的 DOM**（规范明写）」与 `:342`「规范禁止改外部 DOM」 | `docs/PLUGIN-DEV-GUIDE.md:149`、`:342` |
| 语义冲突 | **有**。`document.startViewTransition()` 是**文档级** API：它快照**整个 document**（含宿主聊天区），无法只对插件子树取快照。这直接踩在 `:149` 的边界上；而且宿主或多个插件同时调用时，后调用者会 `skipTransition()` 打断前者（规范没有仲裁机制） | 同上 |
| 性能 | **更慢**。快照 1120×900 面板（内含 8 个 `backdrop-filter` 面）+ 宿主整页，每次切换要额外一次全屏合成层拷贝；用它替代"opacity crossfade"是净亏 | §4.1 |
| **结论** | **不推荐作为主路径**，也不建议做 progressive enhancement（收益 < 风险：跨插件打断、宿主 DOM 边界、快照成本）。退场/切换一律用 §5.3-B 的 `usePresence` + CSS | — |

> 唯一"可以使用"的场合：**插件内部**、单层、用户已明确要求"系统级转场"时，且必须满足 3 个前置（`in document` + `prefers-reduced-motion: no-preference` + 面板关闭时不调用）。本轮不建议排期。

### 5.4 三个「便宜但显高级」的具体效果

#### ① 分段控件的滑动指示块（P0 / S，~25 行 CSS + 2 行 JSX）

- **改哪里**：`styles.ts:801-809`（`.awu-tabs`）+ `index.tsx:2861`（容器加 `style={{ '--awu-tab-i': …, '--awu-tab-n': … }}`）；`.awu-modePills`（`908`，`index.tsx:2890`）同一套。
- **怎么实现（纯 CSS 位移，零 JS 测量）**：

```css
.awu-tabs { position: relative; }
.awu-tabs::before {
  content: ""; position: absolute; z-index: 0;
  top: 3px; bottom: 3px; left: 3px;
  width: calc((100% - 6px - (var(--awu-tab-n) - 1) * var(--awu-gap-1)) / var(--awu-tab-n));
  border-radius: var(--awu-r-sm);
  background: var(--awu-glass-1);
  box-shadow: 0 1px 3px rgba(0,0,0,.18), var(--awu-specular);
  transform: translateX(calc(var(--awu-tab-i) * (100% + var(--awu-gap-1))));
  transition: transform var(--awu-t-base) var(--awu-ease);
}
.awu-tab { position: relative; z-index: 1; }
/* 选中态不再自绘底/影（交给滑块）：用同权重选择器覆盖，避免引入 !important */
.awu-tab[data-on="true"] { background: transparent; box-shadow: none; }
```

- **风险**：a) 4 个 tab 是 `flex:1` 等宽（`812`），公式成立；若将来 tab 数变化要保证 `--awu-tab-n` 跟着变（`TAB_IDS` 是常量，安全）。b) `gap: var(--awu-gap-1)` 参与宽度计算，改 gap 要同步公式（建议加注释）。c) 必须把 `.awu-tab[data-on]` 的 `background/box-shadow`（`833-838`）清掉，否则会和滑块叠出"双底"。d) reduced-motion 下把 `transition` 归零（§6 统一守卫会自动管）。e) 与现有 `.awu-tab` 的 `transition`（`827`）会并存——只保留颜色过渡，删掉背景项。
- **收益/成本比**：这是全套里**最像 iOS** 的一处，25 行 CSS 换掉"换底色"的廉价感。

#### ② 指针跟随的玻璃高光（P1 / M，~30 行 CSS + ~35 行 TS）

- **改哪里**：新增 `client/motion.ts`（`useGlassSpotlight()`，rAF 合帧写 CSS 变量）；`styles.ts:1009-1045`（`.awu-card` 加 `::after`，并把 `1023` 的**静态**径向高光迁到 `::after` 上，避免两套高光叠加）；`index.tsx:2965`（`.awu-grid` 挂 `ref`）。
- **怎么实现**：

```css
.awu-card::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  border-radius: inherit; opacity: 0;
  background: radial-gradient(220px circle at var(--awu-mx, 50%) var(--awu-my, 0%),
    rgba(255,255,255,.16), transparent 60%);
  transition: opacity var(--awu-t-base) var(--awu-ease);
}
.awu-card:hover::after { opacity: 1; }
@media (hover: none) { .awu-card::after { display: none; } }
```

```ts
// client/motion.ts：一个委托监听，rAF 合帧，只写 CSS 变量（不触发 React 渲染）
export function useGlassSpotlight(ref: React.RefObject<HTMLElement>, enabled: boolean): void
// pointermove → 若下一帧未排 → requestAnimationFrame 里 el.style.setProperty('--awu-mx', `${x}px`)
```

- **风险**：a) `pointermove` 频率可达 120Hz → **必须 rAF 合帧**，且只在 `(hover: hover) and (pointer: fine)` 下绑定；b) 触摸设备不绑（`hover:none` 落空）；c) `prefers-reduced-motion` 不绑；d) 卡上不能因此加 `backdrop-filter`（会翻倍合成层）；e) `.awu-card` 有 `overflow:hidden`（`1028`）✓ 已具备裁剪；f) 把静态 `radial-gradient`（`1023`）保留原位会导致高光叠加变亮 → 必须迁移，否则浅色主题下卡面会过曝（这条是本项最大的返工风险）。
- **替代（更便宜、更保险）**：纯 CSS 的斜向扫光（hover 时 `::after` 从 -100% 平移到 100%，复用 `awu-sheen` 关键帧 `3512`），**0 行 JS**，观感提升约 70%。若担心 pointer 性能，先做这个。

#### ③ 列表 FLIP 位移动画（P1 / L，~60–80 行 TS + 1 行 JSX）

- **改哪里**：新增 `client/motion.ts` 的 `useFlipList(containerRef, deps)`；`index.tsx:2966` 给 `CharacterTile` 根节点 `data-flip-id={item.name}`（`index.tsx:437` 的 `<button>`）；配合 §5.3-B 的 `usePresence` 才能覆盖"删除时先淡出再塌陷"。
- **怎么实现（WAAPI，避免与 hover 的 CSS transform 抢属性）**：

```ts
// 记录 rect → 等 React 提交 → 再测 rect → 对位移元素 el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}], {duration:200, easing:EASE})
// 用 Web Animations API 而不是 CSS transition：动画结束后自动脱离，不留 style 残留
```

- **风险**：a) 与 `.awu-card:hover { transform: translateY(-2px) }`（`1038`）冲突 → 动画期间给容器加 `[data-flipping]` 临时禁用 hover transform；b) 删除项本身已卸载，FLIP 只能让**其余项**塌陷上移，"被删的那张"的淡出要靠 5.3-B（所以顺序：先淡出 120ms → 再 reload/FLIP 200ms）；c) React 18 并发下必须在 `useLayoutEffect` 里测（不是 `useEffect`）；d) 列表是单列（§3.6），位移只有 Y 方向，实现可以只做 `translateY`（更便宜）；e) 筛选（G20）也复用同一个 hook，别写第二份。
- **为什么排最后**：它是本轮唯一需要新增 JS 动画引擎的项，且只有"删除/筛选"两个触发点；性价比低于 ① ②。

#### 加餐（真正最便宜的一处）：保存成功反馈的"入场 + 淡出"（P1 / S，~8 行）

- `index.tsx:2803` 的 notice 加 `data-enter` + CSS `@keyframes awu-notice-in { from{opacity:0; transform:translateY(-6px)} }`（200ms）；`dismissNotice`（`1897`）与 `NOTICE_TTL_MS` 到期（`1908`）前先走 160ms 淡出（复用 §5.3-B 的 `usePresence`，或直接把 timeout 拆成 `5000` + `160` 两段）。
- 风险：`role="status" aria-live="polite"`（`2807`）——淡出期间不要把 `text` 清空（屏幕阅读器会读两遍空串），只改 opacity，卸载放到 160ms 后。
- 8 行换来"每次保存都有确认感"，是本清单里投入产出比最高的一条。

---

## 6. 无障碍：`prefers-reduced-motion` 覆盖差集

### 6.1 动画选择器差集（`styles.ts:3542-3561` 的 17 个点名 vs 20 个动画引用）

| 动画选择器 | 位置 | 降级块里有吗 |
|---|---|---|
| `.awu-panel` | 471 | ✓ 3543 |
| `.awu-card` / `.awu-card[data-live]` | 1032 / 1054 | ✓ 3544 / 3552 |
| `.awu-detail` | 1299 | ✓ 3545 |
| `.awu-dialog` | 2475 | ✓ 3546 |
| `.awu-editor` | 2028 | ✓ 3547 |
| `.awu-editorConfirm` | 2406 | ✓ 3548 |
| `.awu-scrim` | 2453 | ✓ 3549 |
| `.awu-focus` | 2592 | ✓ 3550 |
| `.awu-skRow` | 2006 | ✓ 3551 |
| `.awu-status[data-status=live]::after` / `.awu-sigil::after` | 737 | ✓ 3553-3554 |
| `.awu-panel[data-busy] .awu-head::after` | 683 | ✓ 3555 |
| `.awu-trigger[data-live] .awu-mark::after` | 346 | ✓ 3556 |
| `.awu-avatar[data-live]::after` | 1095 | ✓ 3557 |
| `.awu-lamp[data-on]` | 399 | ✓ 3558 |
| `.awu-iconBtn[data-spin] svg` | 670 | ✓ 3559 |
| **`.awu-body::before`, `.awu-pane::before`** | **874-876** | **✗ 漏**（scroll-timeline；`animation-duration` 对它无效，必须单独 `animation: none`） |
| **`.awu-editGroupBody`** | **2229** | **✗ 漏** |
| **`.awu-presetHeavyConfirm`** | **3184** | **✗ 漏** |
| `.awu-distill-bar > span`（transition） | distill:191 | ✓ distill:232-234 |

### 6.2 transition 降级差集（`3563` 只收 8 个选择器，实际 31 条 transition）

- 已覆盖：`.awu-card`(1030)、`.awu-trigger`(300)、`.awu-btn`(1226)、`.awu-tab`(827)、`.awu-input`(2532)、`.awu-line`(1611)、`.awu-iconBtn`(663)、`.awu-navBack`(1320)。
- **未覆盖且含 transform（真正需要归零的）**：`.awu-editGroupChevron`(2177，旋转)、`.awu-cardChevron`(1142/1145，位移)、`.awu-modePill`(928)、`.awu-check`(2575)、`.awu-loreRow`(2838)、`.awu-loreRowBtn`(2952)、`.awu-editGroupHead`(2167)、`.awu-noticeClose`(969)、`.awu-lineEdit`(1638)、`.awu-editAdd`(2352)、`.awu-editListRemove`(2330)、`.awu-editorDirty`(2378)、`.awu-pane::-webkit-scrollbar-thumb`(533)、`.awu-triggerName`(381)、`.awu-lamp`(393)。
- **死规则**：`.awu-line` 在降级块里，但它的 transition 只有 `background`（`1611`）→ 说明这份清单是手工维护、已漂移。
- `.awu-card:hover { transform: none }`（`3564`）✓ —— 最低限度保住了"卡片不飞"。

### 6.3 另外两处

- **`will-change: transform, opacity`**（`470`）在 reduced-motion 下没有撤销（`3564` 只改 transform）→ 建议一并 `will-change: auto`。
- **`prefers-reduced-transparency`**（`3529-3539`）做得对 ✓（关掉 4 个面的 backdrop-filter + 换实心底 + 换描边），别动。

### 6.4 建议：把"白名单"换成"全局守卫"（P0 / S，~10 行）

```css
@media (prefers-reduced-motion: reduce) {
  /* 全局守卫：未来新增的任何动画/过渡自动降级，不再依赖手工点名 */
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
  /* 只保留"状态必须可见"的：无 */
  /* scroll-timeline 动画不吃 duration，单独关 */
  .awu-body::before, .awu-pane::before { animation: none !important; }
  .awu-editGroupBody, .awu-presetHeavyConfirm { animation: none !important; }
  .awu-panel { will-change: auto; }
}
```

风险：`animation-iteration-count: 1` 会让"无限呼吸"停在最后一帧；对 `awu-glow/breathe/pulse` 这类**装饰循环**这正确，对 `awu-spin`（加载指示）会**停转**——需要给 `.awu-iconBtn[data-spin] svg` 例外保留（或按 WCAG 允许它转，因为转动的加载指示属于"必要信息"）。**这是唯一需要逐个裁决的地方**，建议在 CSS 里显式写：

```css
.awu-iconBtn[data-spin="true"] svg { animation: awu-spin .9s linear infinite !important; }
```

---

## 7. 已做得好、**不要重做**

1. **动效令牌化 + 单档缓动**：`EASE`（`styles.ts:21`）一处定义、`--awu-ease` 一处引用（`181`），34 处 transition 全部走 `var(--awu-ease)`，没有手写第二曲线（唯一例外是挂起中的 distill `191`）。
2. **`transition: all` = 0**：全库零命中，全部显式列属性 —— 这是最该守住的纪律。
3. **错峰只有一处真源**：`CARD_STAGGER=34`（`37`）+ `index.tsx:441` 的 `min(index,8)`；**cap 8 是正确的**（§3.6），别为了"更长的瀑布"去掉。
4. **`awu-panel-in` 的两条注释**（`3472-3474`）：解释"为什么不用 translateX"（居中靠 `left/right/margin:auto`，transform 会在动画期覆盖布局导致窗口先偏后跳）+ 用独立 `scale` 属性避免与 `transform` 打架 —— 这是**踩过坑的正确解法**，别改回 `transform: scale()`。
5. **`awu-sheen` 只扫一次**（`737`，`1` 不是 `infinite`），注释 `729` 明写"进场扫一次就停"。全局唯一的"高级感扫光"用得克制。
6. **scroll-hint 用 `@supports (animation-timeline: scroll())` 降级**（`863-879`）：不支持就只是没有阴影，零副作用 —— 渐进增强的教科书写法，可以直接复用到仓促新增的动效上。
7. **骨架屏形状与真实布局对齐**（`1994-2014`，`data-shape="cards"` 用 calc 对齐卡片高度）：避免了加载完成时的跳版，这比任何淡入都值钱。
8. **`animation-fill-mode` 用法正确**：唯一带 delay 的 `.awu-card` 用了 `backwards`（`1032`），没有"延迟期闪一下"。
9. **hover 提亮而非压暗**（`1035-1041` 的注释 + `--awu-glass-2-hi`），press 有 `scale` 的 5 处（`305/668/1045/1231/1324`）—— 触感方向是对的，只是覆盖不全（G18）。
10. **`prefers-reduced-transparency` 降级是真的降级**（`3529-3539` 用 `--awu-surface-opaque` + 关 blur），且注释记录了旧实现的 bug。
11. **`loadDetail` 等异步状态没有用"假动画"掩盖**：骨架屏只在对的时机出现（`2994/3036`），没有为了动效而人为延后渲染。

---

## 8. 落地顺序（建议）

| 批次 | 内容 | 条目 | 量 |
|---|---|---|---|
| **第 1 批（P0，一次迭代）** | 退场系统（`usePresence` + 3 挂载点 + distill 副本） | G1 G2 G14 + §3.5 全清 | M |
| | reduced-motion 全局守卫 + 3 个漏网 + `will-change` 撤销 | §6.4 / §6.1 / §4.3 | S |
| | `awu-glow` 改 `::after` opacity 呼吸 | §4.4 | S |
| | 面板/sheet 进入降 blur（动画期临时关） | §4.1-① ② | M |
| | 分段器滑动指示块 | G5 / §5.4① | S |
| | 时长令牌语义化（+ 别名） | §5.1 | S |
| **第 2 批（P1）** | list↔detail 方向位移 + tab 120ms crossfade | G3 G4 | M |
| | 4 套折叠统一 `grid-template-rows`（含 `<details>` 用 `@starting-style`） | G7 G8 G9 G10 | M |
| | notice 入场+淡出、骨架→内容 crossfade | G12 G13 G21 + §5.4 加餐 | S |
| | 导入进度（indeterminate 条 + 阶段点） | G11 G22 | M |
| | press 态补齐 13 个控件 | G18 | S |
| | shimmer 改 transform | §4.5 | S |
| **第 3 批（P2）** | FLIP 列表（删除/筛选） | G6 G20 / §5.4③ | L |
| | 指针跟随高光（或先上纯 CSS 扫光） | §5.4② | M |
| | 编辑管线其余：preset list↔edit、distill 步骤、专注层升起、空态 | G15 G16 G17 | M |
| | 滚动进入视口渐显 | G19 | M |

---

## 附录 A · 核查方法与不确定项

- **方法**：`git log -1` 确认 HEAD `a7b5799`、`git status` 干净；`Select-String` 全量 grep `animation|transition|@keyframes|prefers-reduced-motion|backdrop-filter|will-change|startViewTransition|IntersectionObserver|animationDelay`；对 19 个 animation 站点、31 个 transition 站点、8 个 backdrop-filter 面逐个 `read` 上下文；8 个 tsx 的 `style={{`（80 处）逐文件核对是否含动效属性。
- ⚠️ **待确认（需真机/性能面板）**：
  1. Electron 44.7.0 对应的确切 Chromium 大版本（`D:\CODEX\DSH-desktop\version` 只给 Electron 版本）；`@starting-style / allow-discrete / linear()` 的实机可用性未在 GUI 里实测。
  2. 面板进入 240ms 内 `blur(20)` 的真实掉帧幅度（需 DevTools Performance 录制；本报告给的是机制判断，非实测帧率）。
  3. Web 端（浏览器打开 `http://127.0.0.1:63396`）的实际用户浏览器分布 —— 决定 `@starting-style` 能否作为**唯一**实现（当前建议是渐进增强 + 兜底 fade）。
  4. `.awu-grid` 在 340px rail 里是否确为单列（按 `minmax(240px,1fr)` 与 rail 宽推算；若 rail 曾改宽则需复核 stagger 观感）。
- **未覆盖**：`docs/design/*` 里对动效的历史决策（只读 `visual-qa.md`/`panel-ui.md` 的目录级描述，未逐字比对设计稿要求）；动效与 SF Symbols 图标动画的关系（`icons.tsx` 无动画）。

## 附录 B · 与其它检查员报告的口径交叉

| 项 | 本报告 | A-styles.md | 说明 |
|---|---|---|---|
| `animation` 声明 | 19 行 / 20 引用 | 18 | 口径差（是否含 scroll-timeline / 1054 的双动画） |
| `@keyframes` | 13 | 13 | 一致 |
| `transition: all` | 0 | 0 | 一致 |
| `backdrop-filter` 面 | 8（+1 显式 none） | 8 | 一致；本报告额外指出"最多 4 层同时叠加" |
| reduced-motion 漏网 | 3 个动画选择器 + 15 条含 transform 的 transition | "覆盖 15 条，漏 3 条" | 一致（本报告把 transition 差集展开到具体选择器） |
