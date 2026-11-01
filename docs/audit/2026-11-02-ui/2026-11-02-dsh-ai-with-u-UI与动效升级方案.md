# dsh-ai-with-u · UI 设计感与动效升级方案

> 日期：2026-11-02 凌晨 · 仓库 `D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u`（HEAD `a7b5799`，工作区干净）
> 性质：**只读检查 + 方案**（本轮未改任何 `client/**`、未跑 build）
> 检查阵容：5 位检查员（A 样式层 / B 动效 / C 主面板 / D 无障碍+性能 / E 子视图一致性）+ Lead 实机量测
> 检查报告：`D:\CODEX\deepseek-work\reports\2026-11-02-ui-audit\`（A/B/C/D/E 五份，共 2000+ 行）
> 实测截图与量测：`D:\CODEX\deepseek-work\06-tmp\ui-audit\`

---

## 1. 本轮边界

**做**：面板的视觉效果、动效体系、交互反馈、信息层级、响应式、无障碍与渲染性能的**全量体检 + 升级**。
**不做**（本轮明确排除，避免范围爆炸）：
- 视觉语言推倒重来（不换「Liquid Glass」这套底）；
- 功能新增（多角色同场、立绘、PNG/CHARX 导出等——那是功能线）；
- 拆包/懒加载（D 已实测结论：cjs 单包 + 宿主只认一个 client 产物，拆不动，替手见 §9.4）；
- 后端 REST 契约改动（只允许 UI 侧消费现有字段）。

---

## 2. 检查方法与可复现性

| 手段 | 说明 |
|---|---|
| 静态审读 | 5 人分域全文通读 `client/**` 12,000 行 + 3 份 CSS + 10 份设计文档 + `scripts/**` 自检 |
| 实机量测 | Lead 用本机 Chromium(`ms-playwright/chromium-1234`) + CDP 脚本驱动预览沙盒，量真实几何 |
| 实机截图 | 浅色/深色 × 角色簿/详情/日记/统计/指南/弹层 × 1440/1024/820 共 11 张 |
| 对照设计文档 | `docs/design/2026-10-30-liquid-glass.md`、`panel-ui.md`、`visual-qa.md`（三轮视觉验收记录）、`a11y-merge.md` |

**沙盒可复现**：`node tools/preview/serve.mjs` → `http://127.0.0.1:59621/`（`?live=1` 启用态，`#dark` 深色）。
截图脚本（本轮新建，建议入库）`06-tmp/ui-audit/shot.mjs`：headless Chromium + CDP，支持 `--eval` 逐步点击、`--dpr`、`--w`/`--h`，产出 PNG。

### 2.1 Lead 实测几何（1440×900，浅色，已启用一张卡）

```
panel   1103 × 808   top 52   radius 24   backdrop-filter: blur(18px) saturate(1.85) brightness(1.03)
rail     336 × 621
main     765 × 621
grid     grid-template-columns: 276px          ← 恒单列（minmax(240px) 在 336px 轨内永远塞不下第二列）
cards    [146, 146, 146] px                    ← 卡高已统一（visual-qa 第三轮的成果，成立）
tabs     35 px ×4
```

→ 顺带坐实了 C 的 3 条 ⚠️待确认：卡高 146 已统一、rail 内栅格恒单列（`styles.ts:1000` 的栅格是空转）、tabs 35px 未换行。

---

## 3. 现状诊断（量化）

| 维度 | 基线 | 判词 |
|---|---|---|
| CSS 总量 | 599 规则 / 2775 声明 / 279 类（`styles.ts` 3587 行 + distill 256 + guide 203） | 结构清晰、分节有序；**21 个类零引用 ≈171 行死代码** |
| 令牌纪律 | 98 个令牌，`styles.ts` 引用 1420 次、**规则层写死字号 0 处**、间距 token:写死 = 178:19 | 主文件纪律优秀 |
| 令牌飞地 | `distill.styles.ts` 写死字号 11 处 / 间距 23 处全写死；`guide.styles.ts` 写死字号 14 / 间距 9 | **两个子视图文件不受令牌管束** |
| 内联样式 | tsx 内联 80 处（index 41 / preset-view 26） | 第二通道，需收编 |
| 动效 | 13 个 keyframes（全部有引用、0 死动画）、19 条 animation、31 条 transition、**0 处 `transition: all`**、单档 EASE | 底座正；缺"退场"和"状态切换" |
| 无障碍 | 14 层浮层全走同一份 `a11y.ts` 三件套、**0 处 div+onClick**、Esc 让位正确、`:focus-visible` 20+ 条、监听器 100% 配对 | 底子极好，返工点很少 |
| 渲染 | 16 useState/15 effect/4 useMemo/8 useCallback；**0 处 React.memo**；`CharacterTile` 全量重渲 | 热点在 backdrop-filter 链，不在 React |
| 包体 | `lib/client.js` 359.9 KB min（CSS 127.1 + 字典 70.4 + index 52.6） | 不可拆包（D 实证），可延迟注入 CSS |

---

## 4. P0 汇总（10 条，全部有 `文件:行` 证据）

| # | 问题 | 证据 | 归属 | 量 |
|---|---|---|---|---|
| P0-1 | **左栏没有选中态**：日记 tab 下点另一张卡 = 静默换操作对象，随后「彻底重置」清的是刚点过的那张（不可逆） | `index.tsx:2964-2978`、`437-445`、`styles.ts:1050-1055`；`index.tsx:1997-2005`、`2259/2277/2301` | C | S |
| P0-2 | **全仓没有 ErrorBoundary**：面板是 slot entry，任一渲染异常 → 整块侧栏席位空白、无提示 | grep `componentDidCatch\|getDerivedStateFromError` 0 命中；`docs/PLUGIN-DEV-GUIDE.md:150` | D | S |
| P0-3 | **预设编辑器无脏数据保护**：关闭/Esc/遮罩三条路都能无声销毁数千字草稿 | `preset-view.tsx:421-428,847,1092`、`index.tsx:3128`（对照 `card-editor.tsx:279-331,442-460`） | E | M |
| P0-4 | **面板关闭无退场**：DOM 秒消失（进 340ms / 出 0ms） | `index.tsx:2620,2702` | B | M |
| P0-5 | **sheet + 遮罩无退场** | `index.tsx:257-276`、`styles.ts:2453,2475` | B | M |
| P0-6 | **list↔detail 只进不出**（返回无反向位移） | `index.tsx:2991-3017`、`styles.ts:1299` | B | M |
| P0-7 | **tab 切换零过渡**（4 个主 tab 硬切） | `index.tsx:2861-2878`、`styles.ts:833` | B | M |
| P0-8 | **分段器没有滑动指示块**（iOS 分段器的标志性手感缺失） | `styles.ts:801-809,833` | B | S |
| P0-9 | **`prefers-reduced-transparency` 只兑现一半**：8 个模糊面只关掉 4 个，卡片/输入/按钮/trigger/editorFoot/scrim 全漏，与文件自述「降级 = 真·不透明」矛盾 | `styles.ts:3529-3540` vs `297/1022/1218/1520/2139/2369/2451/2523` | A | M |
| P0-10 | **浅色骨架屏不可见**：`rgba(255,255,255,.04)` 叠在 68% 白卡面上，对比 ≈1.02:1 → loading 信号消失 | `styles.ts:1998-2007` | A | S |

> 另有 3 条「静默失败」级问题，虽被 D 归 P1，但实际是用户可见的哑火，建议并入第 0 批：导入弹层选文件阶段的校验错误从不渲染（`index.tsx:884-892` vs `:1024`）、改写日记成功无反馈（`2264-2271`）、刷新按钮不转不提示（`2687-2696`）。

---

## 5. P1 主线（按主题合并，40+ 条明细见各报告）

1. **结构与层级**（C/E）：分段器在左栏、内容在右栏 → 切「统计/指南」时左栏是死点击；1120 的头部只放 2 个图标、两枚主 CTA 被压进 340px 左栏；三个统计数字在头部与统计 tab 重复；详情 hero 5-6 个同权 40px 按钮平铺、删除与「全局启用」相距 10px；「最近日记」实渲染全量日记。
2. **视觉漂移**（E）：蒸馏弹层 760px/圆角 16 vs 其余 620px/圆角 24；蒸馏字号 9.5/10/10.5px 击穿 `--awu-fs-micro:11px` 下限，10.5 魔数已扩散 3 处；弹层内错误条被 `--awu-gutter` 二次缩进（实际 52px）；错误条 5 种形态、输入框 3 种高度（42/40/36）同屏。
3. **动效缺口**（B）：38 处 `:hover` 对 5 处 `:active`；13 个控件只有 hover 无按压；4 套折叠各写各的（`.awu-loreBody` 无过渡）；骨架→内容同帧硬切；notice 无进出；导入无进度（只有一行「解析中…」）；全库 0 处 IntersectionObserver。
4. **性能红线**（B/A/D）：`awu-glow` 用 box-shadow 3.6s infinite 每帧重绘整卡；面板/sheet 在 20-30px blur 面上做位移+缩放（外加 `0 0 0 100vmax` 巨影）；8 个 backdrop-filter 面最坏 4 层同时（scrim 6px 全屏 + dialog 30px）；`will-change` 常驻不回收；shimmer 用 background-position；`.awu-focus` 1.0M px 的 30px 模糊违反自订规矩；每击键强制同步布局（`card-editor.tsx:70-75`）；5s 轮询无 `document.hidden` 早退。
5. **对比度**（D）：`.awu-err` 红字压同色 12% 底 深 4.17/浅 4.33（要求 4.5）；`pill[teal]` 中灰壁纸下 3.93；浅色玻璃 alpha .54 换非白壁纸后 `ink-mute` 3.95、accent 2.32、gold 3.24、teal 3.12、danger 3.11 全线跌破。**根因级，但处理方式不是整体提 alpha**（会毁主人要的透亮）。
6. **响应式**（A/C）：断点只有 900，720/560 无规则；`<900` 时 rail 不隐藏、右栏被推到列表下方几屏（且 CSS 注释谎称「rail 隐藏由 JSX 决定」，JSX 里无任何断点逻辑）；`.awu-loreSplit` 固定 320px，901-1100px 时右栏仅 ≈133px 而仍是两列。
7. **a11y**（D）：`aria-modal="false"` 却装了焦点陷阱（Tab 出不了面板）；编辑器关闭后焦点落 body；4 处表单错误无 `aria-live`；图标按钮缺标签 1 条；`prefers-contrast` 整块缺失；系统字体放大完全无效（全 px）。
8. **一致性与可维护性**（E/A）：`distill.tsx` 复制了一整套弹层壳（自建 scrim/Esc/滚动锁/焦点三件套，缺 Overlay 的 drop 复位兜底）；`ErrorBar`/`Skeleton`/`EmptyState`/`IconBtn` 未被复用；`.awu-empty[data-kind]` 7 处白挂无规则；`SCOPED_ATTR` 与整个 `.awu-body` 块是死代码；`styles.ts:3458` 的「衬线只留角色名+日记」注释与实现相反（7 条死声明）。

---

## 6. 设计方向（三选一）

| 方向 | 内容 | 观感提升 | 风险 | 工作量 |
|---|---|---|---|---|
| **A · 精修派** | 只做材质细节（specular/边缘光/分层哑光）、排版节奏、动效补齐（退场/切换/按压/滑轨），不动任何 JSX 结构 | 中 | 低 | ~2 人日 |
| **B · 玻璃有呼吸（推荐）** | A 全部 + **结构重排**（tabs 归位右栏、左栏选中态、hero 收敛为 1 主 1 次 + ⋯、删除下沉 dangerZone + 底部安全区）+ **显性动效**（分段器滑块、list↔detail 方向位移 + 头像共享元素、指针跟随玻璃高光、列表 FLIP） | 高 | 中（动 index.tsx 3000 行，需分批 + 每批全绿） | ~6.5 人日 |
| **C · 换语言** | 推翻 Liquid Glass 换新视觉语言（如磨砂+硬边极简） | 最高 | 高（等于重做，历史设计文档全部作废，三轮视觉验收成果清零） | 15+ 人日 |

**推荐 B**。理由：现有底座（令牌纪律、单一 EASE、焦点三件套、空态三分支、i18n 强约束）质量明显高于同类插件，问题集中在「缺层次、缺动效、缺结构收口」，属于**把 80 分做到 92 分**的活；方向 A 修不到「设计感」这个诉求的核心（当前最刺眼的是左栏缺主从结构、hero 一屏五钮、tab 硬切），方向 C 则是把已验证的东西推倒。

---

## 7. 分批实施计划（4 批 + 分工 + 写域）

> 团队约定：**写域不重叠**；同一文件同一时刻只有一个 owner；每批结束 `npm run build` 必须全绿（当前 1032 项自检）后才进入下一批；Lead 复核全量 diff 并跑验收截图。

### 第 0 批 · 止血与地基（0.5 人日，可立即开工）

| 包 | 内容 | Owner | 写域 |
|---|---|---|---|
| W0-A | ErrorBoundary（`entry.tsx` 包 20 行 class + 重试）；导入静默失败；4 处 `aria-live`；`aria-modal` 二选一（取 `true`）；编辑器还焦；`.awu-err`/`pill[teal]` 底色对比度；改写日记成功 notice | teammate-1「修复」 | `client/entry.tsx`、`client/index.tsx`（仅列出的行）、`client/text.ts`、`client/styles.ts`（仅 758/1199/1985 三处） |
| W0-B | 动效地基：`client/motion.ts`（`usePresence` + 令牌常量导出）、令牌语义化（`--awu-t-fast/base/mid/enter/exit/slow/ambient` + `ease/ease-out/ease-in`，旧名留别名 → 300 处调用不动）、**reduced-motion 全局守卫**（`*,*::before,*::after` + scroll-timeline 3 条特批 + spinner 例外）、`data-motion="ui"` 登记约定 | teammate-2「动效」 | `client/motion.ts`（新）、`client/styles.ts`（仅变量层 + 3471 行后动效/降级段） |

**依赖**：W0-B 先落地令牌与守卫（styles.ts 变量层），W0-A 的 styles.ts 三处小改排在 W0-B 之后合并，避免写域打架。

### 第 1 批 · 视觉骨架（2 人日）

| 包 | 内容 | Owner | 写域 |
|---|---|---|---|
| W1-CSS | 材质分层（rail 凹陷 / main 浮起 / 卡片层级）、指针跟随高光的 CSS 载体、specular 强化、滚动条统一（含 `.awu-focusBody` 三件套）、focus ring 收敛为 1 套（24 条 → token）、死代码清理（21 类 + `.awu-body` 块 + `SCOPED_ATTR` + 7 条死 serif 声明 + 注释纠偏）、新增控件高度/行高/滚动区三组令牌 | teammate-3「样式」 | `client/styles.ts`（整文件独占） |
| W1-JSX | 结构重排：tabs 归位右栏、左栏补选中态（`data-selected` 蓝轨 + 「正在看：X」面包屑）、hero 收敛（1 主 1 次 + ⋯ 菜单，删除下沉 dangerZone）、头部信息重排（统计去重）、响应式真规则（900/720/560 三档 + 单栏导航栈：list→detail push/pop，附 `data-nav`） | teammate-4「结构」 | `client/index.tsx`（整文件独占）、`client/text.ts` |

**依赖**：W1-CSS 与 W1-JSX 通过**类名契约先行**并行（Lead 先出 20 行契约：新类名/`data-*` 属性清单），互不改对方文件。

### 第 2 批 · 动效系统（2 人日）

| 包 | 内容 | Owner | 写域 |
|---|---|---|---|
| W2-MOTION | 退场系统接 6 个挂载点（面板/Overlay/编辑器/详情返回/notice/骨架）；tab 120ms crossfade；分段器滑块（`--awu-tab-i/-n` 零 JS 测量）；list↔detail 方向位移 + 头像共享元素；4 套折叠统一 200/160；按压补齐 13 个控件；`awu-glow` 改 `::after` opacity 呼吸；shimmer 改 transform；动画期临时降 blur；`will-change` 回收 | teammate-2「动效」 | `client/styles.ts`（动效段）、`client/motion.ts`、`client/index.tsx`（仅挂载点 + 分段器 2 行） |
| W2-PERF | 删 `.awu-scrim` 的 blur(6px)；`CharacterTile` 加 `memo`；轮询加 `document.hidden` 早退 + 签名改轻量；`TextField` 击键合帧 | teammate-3「样式」 | `client/index.tsx`（仅性能点）、`client/styles.ts`（仅 scrim）、`client/card-editor.tsx` |

**依赖**：W2 必须在第 1 批之后（结构定了才挂退场动画）；W2-MOTION 与 W2-PERF 均触 `index.tsx`，按**顺序串行**（MOTION 先，PERF 后），或由 W2-PERF 只改 `card-editor.tsx` + CSS 并把 index.tsx 的两个点写成 patch 交 MOTION 落地。

### 第 3 批 · 一致性收编与子视图（1.5 人日）

| 包 | 内容 | Owner | 写域 |
|---|---|---|---|
| W3-PARTS | 抽 `client/parts.tsx`（ErrorBar/Skeleton/EmptyState/IconBtn/Notice）+ 5 个调用方收编；错误条 5 形态 → 1；输入框高度 3 档 → 2 档 | teammate-5「一致性」 | `client/parts.tsx`（新）、`client/preview.tsx`、`client/lorebook-editor.tsx`、`client/card-editor.tsx`、`client/diary-review.tsx` |
| W3-SUB | `distill.tsx` 换回 Overlay（顺带修 drop 复位兜底）；蒸馏 CSS 三行（宽/圆角/字号下限）+ 清 30 处旧暖色 fallback；guide 阅读宽 680→760 居中 + 正文 13→14；预设切换动效（同一挂载点内容替换 → 需 JS 时序，归属 W2 的 `usePresence`） | teammate-5 | `client/distill.tsx`、`client/distill.styles.ts`、`client/guide.styles.ts`、`client/preset-view.tsx` |

### 第 4 批 · 验收与固化（0.5 人日，Lead + QA）

- 截图矩阵：浅/深 × 角色簿/详情/日记/统计/指南/弹层/编辑器/专注层 × 1440/1024/820/560，共 30+ 张，before/after 对比入 `docs/design/2026-11-02-ui-motion-before-after.md`；
- 降级三态回归：`prefers-reduced-motion` / `prefers-reduced-transparency` / 强制对比（CDP `Emulation.setEmulatedMedia`）；
- 新增两个自检脚本（并入 `npm run build`）：`verify-ui.mjs`（禁写死字号、令牌全引用、动效类必须在 `data-motion` 登记、模板串禁反引号/`${`）、`verify-a11y.mjs`（图标按钮必有标签、错误块必有 `aria-live`、焦点环唯一）；
- 真机：重启 DSH 装 v0.5.1 复看一轮（宿主改动需重启，见实测方法论）。

---

## 8. 动效系统规范（第 2 批的执行依据）

### 8.1 令牌（改 `styles.ts:180-187` 一处，旧名做别名）

```
--awu-t-fast:120ms  --awu-t-base:200ms  --awu-t-mid:240ms
--awu-t-enter:320ms --awu-t-exit:160ms(新) --awu-t-slow:600ms --awu-t-ambient:3400ms
--awu-ease:cubic-bezier(.32,.72,0,1)        /* 进入，现有，保留 */
--awu-ease-out:cubic-bezier(.22,1,.36,1)    /* 退场/收尾 */
--awu-ease-in:cubic-bezier(.55,0,1,.45)     /* 收起/删除 */
```

**不引入第二套弹簧曲线**（B 明确：`linear()` 采样点不手写）；时长硬编码从 13 种收敛到令牌。

### 8.2 编排规则

| 场景 | 规则 |
|---|---|
| 进入 | 分三层：面板 240ms（只 opacity + scale，动画期 `backdrop-filter:none`）/ sheet 320ms / 浮层 200ms + 24ms 错峰（cap 6） |
| **退场** | **统一 160ms、只动 opacity、绝不 stagger**（退场永远比进入快 40%） |
| tab 切换 | 120ms crossfade，不带位移 |
| list→detail | 从右 +8px；返回从左 −8px |
| 展开/折叠 | 展开 200ms / 收起 160ms，四套折叠共用一条 |
| 列表删除 | 淡出 120ms → FLIP 200ms 塌陷 |
| 环境动画 | `awu-glow` 改伪元素 opacity .35↔.85 呼吸；shimmer 改 transform（不再 background-position） |
| 按压 | 全局补 `:active`：卡片 `scale(.995)`、按钮 `scale(.97)`、图标件 `scale(.94)` |
| 错峰 | 维持 `min(index,8)×34ms` **cap 8 不动**（实测 612ms 落位；去 cap 后 50 张要 2.0s） |

### 8.3 退场实现路线（B 已查证宿主）

- **采用**：`usePresence(open, 160)` 延迟卸载 hook（~30 行）+ 6 个挂载点。必须同时处理 5 个时序风险：焦点恢复要提前 blur、滚动锁仍按卸载解锁、快速连开关清 timer、`closing` 期间 `escYield` 放行、`animation-fill-mode:both` 防末帧闪回。
- **不采用**：`View Transitions`（桌面 Electron 44.7.0 虽支持，但它是**文档级** API，会快照宿主聊天区、多插件互相 `skipTransition`，且快照 1120×900 含 8 个 blur 面比 crossfade 更慢；`PLUGIN-DEV-GUIDE.md:149/342` 的「不要动组件外 DOM」边界踩线）。
- `@starting-style` 只用于原生 `<details>`（`.awu-loreFold`），配 `transition-behavior:allow-discrete`。

### 8.4 降级（从"手工白名单"改为"全局守卫"）

```
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.01ms!important; animation-iteration-count:1!important;
                           transition-duration:.01ms!important; scroll-behavior:auto!important }
  /* 特批例外：.awu-iconBtn[data-spin] svg 保留旋转（WCAG 允许加载指示） */
  .awu-body::before, .awu-pane::before { animation: none !important }  /* scroll-timeline 不认 duration */
}
```
理由：现状白名单已漂移（列了 `.awu-line` 但它只有 background 过渡、漏了子视图全部行内零件与 15 类 transition）。守卫一次登记、永久生效，此后新增动效不再需要登记（配 `data-motion="ui"` 只为可读性，不参与判定）。

---

## 9. 视觉升级清单（第 1 批落点）

### 9.1 材质与层次（这是"设计感"的主战场）

| 改动 | 落点 |
|---|---|
| 面板 → rail 凹陷 / main 浮起：rail 用 `inset` 内阴影 + 更低 sheen，main 保持浮起；1px 分隔线保留但降为 `line` 半档 | `styles.ts` 面板骨架 / 两栏骨架 / `--awu-surface-strip` |
| 卡片层级：静息 1 档阴影、hover 提亮 + 上浮（已有）+ **指针跟随高光**（`::after` radial-gradient at `--awu-mx/-my`，rAF 合帧、仅 `(hover:hover) and (pointer:fine)`、reduced-motion 不绑）；先做纯 CSS 斜向扫光版（0 行 JS）作为兜底 | `.awu-card` + 新 `client/highlight.ts`（~35 行） |
| specular 强化：面板顶部径向 sheen 提一档、边缘 1px 亮边在深色下提亮（现深色偏烟灰） | 变量层 `--awu-sheen` / `--awu-glass-edge` |
| 深色二次调：`glass-1` .66→.70、`saturate` 150%→138%、补 `--awu-line-soft` 给统计分隔线（visual-qa §7.3 遗留） | 变量层 |
| 弹层：`surface-dialog` .86 降到 .72 + 顶部 sheen + 620/24 统一 | `.awu-dialog` |

### 9.2 排版与节奏

- 字段行：key 列 `--awu-ink-mute` 13px / value `--awu-ink` 14px 500、行高整数化、分组 gap 16→20；
- 分节标题：从「12px 金色小字」提到「11px 600 字距 .06em 的 kicker + 13px 正文层级」；
- 引导页：阅读宽 760 居中、正文 13→14/23、列表项间距 +2px；
- 数字：全站数字走 `--awu-mono` + `font-variant-numeric: tabular-nums`（头部计数、体积、轮数）；
- 蒸馏字号击穿修掉（9.5/10/10.5 → 11 下限），10.5 魔数 3 处清除。

### 9.3 结构与交互（B 方向的核心，见 §7 第 1 批 W1-JSX）

- 左栏只回答「选谁」：tabs 归位右栏顶部；左栏补 `data-selected` 蓝轨 + 「正在看：X」；点击语义唯一；
- hero：1 主（启用/绑定）+ 1 次（编辑）+ ⋯（导出/改模式/换开场白），**删除下沉到 detail 底部 dangerZone**（现成样式 `styles.ts:1665-1698`）；
- 头部：统计数字与统计 tab 去重，只留 1 处；刷新按钮驱动 `busy`（图标转 + 骨架）；
- 空态：右栏未选卡加「指向左栏的箭头指示 + 次级行动」；空库态给「蒸馏 / 自创」两个真按钮；
- 弹层族：删除确认统一走 `DeleteDialog`（导入覆盖两步、删除一步、重置一步 → 统一口径）；
- 响应式：900 以下 `data-nav="list"` 单栏导航栈（贴 iOS 的 push/pop，**这正好是动效最出彩的地方**），720/560 补规则。

### 9.4 性能（与"设计感"同批做，否则高级感会被掉帧吃掉）

- 删 `.awu-scrim` 的 blur(6px)（视觉差别极小，省一个全屏滤镜通道）；
- `.awu-focus` 底换 `surface-dialog` + `blur-panel`（不再 1.0M px × 30px）；
- 面板/sheet 位移动画期间临时 `backdrop-filter:none`，`animationend` 后恢复；
- `awu-glow` 与 shimmer 去 paint 化（见 §8.2）；
- `will-change` 只在动画期间存在；
- 弹层打开 = 3 层滤镜链 → 目标 ≤2 层。

---

## 10. 工程硬约束（改动前必须记住）

| # | 约束 | 来源 |
|---|---|---|
| T1 | 三份 `*.styles.ts` 的 CSS 模板串里**禁止反引号、禁止 `${`**（注释里也不行）；`verify-bundle` 会真 import 执行模块 | `verify-bundle.mjs:64-91`、`styles.ts:544` |
| T2 | 改完 `client/**` 必须 `npm run build`（`verify.mjs:91-100` 查 `lib/client.js` mtime ≥ client 目录最大 mtime） | `verify.mjs` |
| T3 | `.awu-toolbar` / `.awu-railActions` / `.awu-btnRow` 三个类名不能随意改名（弱正则断言） | `verify-wiring.mjs:816` |
| T4 | 单一 `<style>` 幂等注入 + 卸载移除，禁止每模块独立 `<style>`；`createPortal` 到 body 的元素必须进变量清单（`.awu-scope/.awu-layer/.awu-scrim/.awu-dialog` 四处**逐字一致**，浅色覆盖块同步增删） | `styles.ts:51-54`、`entry.tsx:58-64` |
| T5 | 不要动的隐式协议：`a11y.ts` 三 hook 拆分与 `escYield` 让位、焦点三件套接线顺序、`ink-faint` 只作装饰、拖放三处复位、`NOTICE_TTL_MS`、卡片高整数 px、hover 只提亮不压暗、错峰 cap 8、`EASE` 单真源 | 各报告「已做得好」节（共 60 条） |
| T6 | 设计文档同步：`liquid-glass.md` 的数值已与 CSS 漂移、`panel-ui.md` 是 452px 旧版 → 本轮结束标「历史」并把新真源写进 `docs/design/2026-11-02-ui-motion-system.md` | A §待确认 |

---

## 11. 验收方案

1. **构建门**：每批结束 `npm run build` 全绿（当前 1032 项），新增 `verify-ui.mjs` / `verify-a11y.mjs` 后项数上升；
2. **视觉门**：CDP 截图矩阵 30+ 张（浅/深 × 8 界面 × 4 宽度），对照 `06-tmp/ui-audit/` 的改造前基线逐张看差异；
3. **降级门**：`Emulation.setEmulatedMedia` 模拟 reduced-motion / reduced-transparency / forced-colors，各截一遍；
4. **对比度门**：脚本按 §D 的合成算式复算「语义色文字压同色底」8 组组合，全部 ≥4.5（正文）/ ≥3（大字号与图形）；
5. **动效门**：录 `Page.startScreencast` 转 GIF 或逐帧截图看退场是否 160ms、是否 stagger（可选，成本高则跳过）；
6. **真机门**：重启 DSH 装 0.5.1，主人过一眼（宿主改动需重启，这一条不能省）。

---

## 12. 风险与回滚

| 风险 | 缓解 |
|---|---|
| `index.tsx` 3009 行结构重排引入回归 | 结构只动「编排层」，不动数据流；每个 commit 只做一件事；保留 `a7b5799` 为基线 tag；分批全绿 |
| 退场动画与焦点/滚动锁打架 | `usePresence` 明确 5 条时序契约 + 面板/弹层/编辑器三处各写一条 verify 断言 |
| 指针高光在中低端机掉帧 | rAF 合帧 + 仅 fine pointer + 提供纯 CSS 扫光兜底开关（`data-fx="off"`） |
| 深色宿主 / 非白壁纸下对比度 | 只给小字加不透明衬底，不动 alpha；验收含非白壁纸截图 |
| 与宿主 slot props 契约（`wide` 传值）冲突 | `useWideLayout` 两段互斥逻辑本轮统一（C P1-11），先实测宿主传值 |

---

## 13. 需要主人拍板

1. **方向**：A 精修 / **B 玻璃有呼吸（推荐）** / C 换语言；
2. **结构改动的授权范围**：是否允许动 `index.tsx` 的信息架构（tabs 归位右栏、hero 收敛、删除下沉、<900 单栏导航栈）；
3. **显性动效尺度**：是否接受「指针跟随玻璃高光 + 头像共享元素转场 + 列表 FLIP」这类看得见的效果（B 的核心卖点），还是要更克制（只做退场/切换/按压）。

拍板后我按 §7 开工：先落第 0 批（止血 + 动效地基，0.5 人日），再进第 1 批。
