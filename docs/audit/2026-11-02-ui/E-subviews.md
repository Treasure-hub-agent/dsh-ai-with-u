# E · 子视图一致性审查（零件复用 / 视觉语言 / 交互 / 态 / 动效）

- 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u` @ `a7b5799`
- 审查范围（12 个文件，实测行数）：

| 文件 | 行数 | 角色 | 自造 CSS |
|---|---|---|---|
| `client/preset-view.tsx` | 1429 | 预设 列表/编辑/导入 三视图 | 0（全部用 `styles.ts` 类），但 26 处 inline style |
| `client/distill.tsx` | 654 | 蒸馏弹层 + 入口 | 自建弹层壳 + `distill.styles.ts` |
| `client/distill.styles.ts` | 235 | 蒸馏样式 | 独立文件，前缀 `awu-distill-` |
| `client/lorebook-editor.tsx` | 694 | 世界书条目区 | 0（全复用 `awu-edit*`/`awu-lore*`），3 处 inline |
| `client/lorebook-schema.ts` | 581 | 纯数据层 | — |
| `client/card-editor.tsx` | 463 | 角色卡编辑器整页 | 0，2 处 inline |
| `client/card-schema.ts` | 531 | 纯数据层 | — |
| `client/diary-review.tsx` | 323 | 日记回顾（搜索/折叠/导出） | 0，2 处 inline |
| `client/preview.tsx` | 234 | 注入预览弹层 | 0，5 处 inline |
| `client/guide.tsx` | 172 | 使用指南（第 4 个 tab） | `guide.styles.ts`，前缀 `awu-guide-` |
| `client/guide.styles.ts` | 203 | 指南样式 | 独立文件 |
| `client/editor-focus.tsx` | 177 | 专注编辑层 | **0**（纯复用 `awu-focus*`/`awu-btn`/`awu-navBack`） |
| `client/icons.tsx` | 168 | 19 个内联图标 | — |
| `client/card-source.ts` | 108 | 纯数据层 | — |

- 参照物：`client/index.tsx`（3205 行）+ `client/styles.ts`（3587 行，278 个 `awu-*` 类名，1121 行含 `var(--awu-*)`）。
- 方式：**只读**代码走查。未修改任何 client 文件、未 `npm build`、未在浏览器实机复验；凡属「观感判断」的结论标 ⚠️待确认，数值结论均来自 CSS 声明原文。
- 行号口径：`read` 工具的物理行号（含空行）。

> **先更正任务书里的一个前提**：两个子视图样式文件的实际前缀不是 `.awu-dt-*` / `.awu-gd-*`，而是 `.awu-distill-*` / `.awu-guide-*`（`distill.styles.ts:5`、`guide.styles.ts:7` 的约定注释也这么写）。命名纪律本身是干净的，没有撞名（唯一的反向依赖见 P2-8）。

---

## 0. 结论摘要

| 级别 | 条数 | 主题 |
|---|---|---|
| P0 | 1 | 预设编辑器**没有任何脏数据保护**：Esc / 关闭 / 点遮罩即整套模块编辑无声丢失（角色卡编辑器有完整保护，两者分叉） |
| P1 | 11 | 蒸馏弹层尺寸/圆角/字号整体脱队、错误与提示条在弹层里被二次缩进 32px、网络 loading 无骨架、蒸馏自建弹层壳、输入框三档高度、删除确认四套口径、空态三形态、预设保存无 `!dirty` 门、指南 680/13px 自成一套、动效白名单漏掉子视图零件 |
| P2 | 20 | §2 编号 15 项（手搓关闭图标、内联 chevron 旋转、26 处 inline style、行内按钮三档几何与三档按压手感、notice TTL 6000/无关闭钮、死 CSS 与死属性、`styles.ts` 反向引用 `.awu-distill-entry`、硬编码 `.26s` 动画、粘贴框 focus 瞬变 …）+ §4/§5 交叉 5 项（玻璃材质扁平、面包屑/返回路径、标题层级、底栏按钮顺序、无面板级忙碌指示） |

> 编号规则：**P0/P1/P2 的正文编号在 §2–§7 里连续给出**，§4/§5 的表格行会引用同一编号（如 §4「按钮高度」= P2-15），不重复计条。

**最严重的 3 处视觉漂移**（详见 §4）：
1. **蒸馏弹层是另一张弹层**：`760px` 宽 + 圆角 `16px`，其余所有弹层是 `620px` + `24px`（`distill.styles.ts:67-69` vs `styles.ts:2460,2465`）。
2. **蒸馏的数字字号跌破主面板下限**：`9.5 / 10 / 10.5px` 五处，而 `styles.ts` 的小字下限是 `--awu-fs-micro: 11px`（`distill.styles.ts:111,126,176,204,224` vs `styles.ts:130`）；同时 30 处 `var(--awu-*, 暖象牙色)` 的 fallback 全是被玻璃化改造淘汰的旧配色。
3. **弹层里的错误/提示条被 gutter 二次缩进**：`.awu-err` / `.awu-status` 自带 `margin: 0 var(--awu-gutter)` = `32px`，而 `.awu-dialogBody` 已有 `20px` padding，且 `--awu-gutter` 只在 `.awu-panel` 被改成 20px → 弹层内实际缩进 **52px**，比同级文字多缩 32px。

**一句话判断**：子视图的**类名复用纪律很好**（`editor-focus.tsx` 是 0 自造件的标杆，`lorebook-editor.tsx` / `card-editor.tsx` / `diary-review.tsx` 基本只吃主面板零件），漂移集中在**两个独立 styles 文件**和**inline style** 这两处「不受 `styles.ts` 令牌管束的飞地」。

---

## 1. 同一套零件的复用情况（总表）

| 零件 | 主面板真源 | preset | distill | lorebook | card-editor | diary-review | preview | guide | editor-focus |
|---|---|---|---|---|---|---|---|---|---|
| 按钮 `.awu-btn` + `data-kind/size` | `styles.ts:1209-1290` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | —(无按钮) | ✅ |
| 输入 `.awu-input` | `styles.ts:2514-2539` | ✅（名字）/⚠️模块用 `awu-editInput` | ❌ 自造 `.awu-distill-paste` | ✅ | ✅ | ✅（+`awu-reviewInput` 36px） | — | — | — |
| 分段控件 `.awu-tab` | `styles.ts:800-840` | —（三视图用页内切换） | — | — | — | — | — | — | — |
| 空态 `.awu-empty` 家族 | `styles.ts:1920-1976` | ⚠️ 缺 `awu-emptyTitle` | — | ⚠️ 自造 `.awu-loreEmpty` | ✅（`awu-editListEmpty`） | ⚠️ 缺 `awu-emptyTitle` | ❌ 退化 `.awu-hint` | — | — |
| 错误条 | `.awu-err` `styles.ts:1979-1992` + `ErrorBar` `index.tsx:319-330` | ❌ 裸 `.awu-err` ×3 | ❌ 自造 `.awu-distill-status[data-tone]` | —（用 issue 列表） | ❌ 裸 `.awu-err`（无图标） | — | ❌ 裸 `.awu-err` | — | — |
| 加载骨架 `.awu-sk` / `Skeleton` | `styles.ts:1995-2014`、`index.tsx:306-317` | ❌ 纯文字 | ❌ 纯文字（按钮内） | — | — | — | ❌ 纯文字 | — | — |
| 弹层 `.awu-scrim`+`.awu-dialog`+`Overlay` | `styles.ts:2442-2509`、`index.tsx:216-277` | ✅ 复用 `Overlay`（`index.tsx:3128`） | ❌ 自建 scrim/Esc/scroll lock | ✅ 挂在编辑器里 | ✅ 页内职责 | — | ✅ 复用 `Overlay`（`index.tsx:3122`） | — | ✅ 页内 `.awu-focus` |
| 弹层三件套 `.awu-dialogHead/Body/Foot` | `styles.ts:2489-2509` | ✅ | ✅ | — | — | — | ✅ | — | — |
| 加号 `.awu-editAdd` | `styles.ts:2338-2357` | ✅（1060） | — | ✅（577/600） | ✅（149） | — | — | — | — |
| 删除 `.awu-loreRowBtn` | `styles.ts:2940-2957` | ✅（1020-1046） | — | ✅（188-196） | ⚠️ `.awu-editListRemove`（另一件） | — | — | — | — |
| 列表行 `.awu-loreRow` 家族 | `styles.ts:2827-2957` | ✅（598 借用 + `awu-presetRow`） | — | ✅ | — | ✅（`awu-line`/`awu-day`） | — | — | — |
| 图标 `icons.tsx` | 19 枚 | ✅ | ✅ | ✅ | ❌ 手搓 X（374-376） | ✅ | ✅ | ✅ | ✅ |
| 折叠箭头 | `.awu-editGroupChevron` `styles.ts:2173-2181` | ✅ 复用类 + ❌ 内联旋转（1026/1036） | — | ✅ 复用类 + ❌ 内联旋转（176/186/563） | ✅（纯类） | ✅（281） | ✅（201） | — | — |
| 焦点三件套 `a11y.ts` | `useRestoreFocus/useInitialFocus/useFocusTrap` | ✅（经 Overlay） | ✅（手动接线 389-391） | ✅ 经 FocusEditor | ✅（272-277） | — | ✅ 经 Overlay | — | ✅（74-76） |

**统计**：13 类零件里，**7 类在 8 个子视图中全部或几乎全部复用**（按钮 / 弹层三件套 / 加号 / 列表行 / 图标 / 焦点 / 折叠箭头容器）；**3 类被自造分流**（错误条、加载骨架、输入框），**1 类被整个复制**（弹层壳）。

---

## 2. 自造零件清单（file:line + 现象 + 建议 + 级别 + 工作量）

### P1-1　蒸馏弹层整体脱离弹层规范（宽 760 / 圆角 16 / 最大高 720）
- 证据：`client/distill.styles.ts:66-72`（`width: min(var(--awu-dialog-w, 420px), 100%)`、`border-radius: var(--awu-r-lg, 16px)`、`max-height: min(84vh, var(--awu-dialog-max-h, 660px))`），令牌实际值 `--awu-dialog-w: 760px`、`--awu-r-lg: 16px`（`styles.ts:198,176`）；对照 `client/styles.ts:2460,2465`（其余弹层 `width: min(620px,100%)` + `border-radius: var(--awu-r-xl)` = 24px）。CSS 拼接顺序 `styles.ts:3566-3568`（GUIDE 在 DISTILL 之前、两者都在末尾）→ 同权重下 `.awu-distill-dialog` 覆盖 `.awu-dialog`。
- 现象：同一面板里「预设 / 预览 / 删除确认 / 新建」都是 620 宽 24 圆角的 sheet，唯独蒸馏是 760 宽 16 圆角。圆角 8px 差 + 宽 140px 差，放在一起是两种材质感。⚠️待确认（未实机截图对比）。
- 建议：删掉 `.awu-distill-dialog` 里的 `width` / `border-radius` / `max-height` 三行，让 `.awu-dialog` 全权决定；确需更宽再引入 `--awu-dialog-w` 的显式档位（如 `data-size="wide"`）。
- P1 / S

### P1-2　错误条 / 提示条被 gutter 二次缩进（弹层内 52px vs 同级 20px）
- 证据：`.awu-err { margin: 0 var(--awu-gutter) var(--awu-gap-5) }`（`styles.ts:1979-1983`）、`.awu-status { margin: 0 var(--awu-gutter) var(--awu-gap-5) }`（`styles.ts:696`）、`--awu-gutter: 32px`（`styles.ts:157`，仅 `.awu-panel` 覆盖成 20px 见 `styles.ts:569`）、`.awu-dialogBody { padding: 12px 20px 10px }`（`styles.ts:2501`）。用在弹层里的位置：`client/preview.tsx:153`、`client/preset-view.tsx:575`、`client/preset-view.tsx:866`、`client/preset-view.tsx:1329`、`client/preset-view.tsx:567,859`（notice 条）。
- 现象：这两类条在内侧各自再吃 32px 外边距，最终比周围 `<div class="awu-hint">` 窄 64px、左边界差 32px，视觉上像「缩进错的引用块」。子视图靠 inline `style={{marginBottom:10}}` / `marginTop:10` 局部打补丁（`preset-view.tsx:567,864,866,1329`、`preview.tsx:144,161`），越补越不一致。
- 建议：`.awu-dialogBody` 增加 `> .awu-err, > .awu-status { margin-left: 0; margin-right: 0 }` 一条，清掉全部四处 inline 补丁。
- P1 / S

### P1-3　四种错误条形态并存
| 形态 | 位置 | 结构 |
|---|---|---|
| A（规范） | `index.tsx:319-330` `ErrorBar` | `.awu-status.awu-err[data-status="alert"]` + `IconAlert` + 文案 + 可选重试按钮 |
| B | `client/preview.tsx:152-157` | 裸 `.awu-err` + `IconAlert`，无 `.awu-status` |
| C | `client/preset-view.tsx:574-579 / 865-870 / 1328-1333` | 裸 `.awu-err` + `IconAlert`，无 `.awu-status`，靠 inline margin 定位 |
| D | `client/distill.tsx:525-532` + `distill.styles.ts:49-64` | 自造 `.awu-distill-status[data-tone]`（无图标、无边框左侧强调） |
| E | `client/card-editor.tsx:386-390` | 裸 `.awu-err`，**无图标**，inline `margin: '0 16px 10px'`（`16px` 既不是 20 也不是 32） |
- 现象：同一个「出错了」的语义，五种长相；A 有重试按钮，B/C 只能去别处找刷新，D/E 只有一句话。
- 建议：把 `ErrorBar` 从 `index.tsx` 提到共享模块（或 `client/parts.tsx`），子视图统一 `<ErrorBar message onRetry>`；蒸馏的 `data-tone` 状态条保留为「结果回执」（它不是错误条，语义不同），但字号/边框要对齐 `.awu-err`。
- P1 / S

### P1-4　网络 loading 不用骨架屏（3 处）
- 证据：`client/preview.tsx:78,146-148`（`<div className="awu-hint" role="status">{t('preview.loading')}</div>`）、`client/preset-view.tsx:424,581`（同款纯文字）、`client/distill.tsx:377,570`（只有按钮文案变 `common.busy`，无任何进度元素）。规范件在 `index.tsx:306-317` `Skeleton`（`styles.ts:1995-2014`，含 `data-shape="cards|detail"` 与 `awu-shimmer`）。
- 现象：主面板角色簿加载是骨架屏，点进预设/预览就退化成一行「载入中…」，加载完成时布局会跳一次（`awu-skRow` 高度按目标布局算过，正是为了避免这个跳动）。
- 建议：三个子视图统一 `<Skeleton shape="detail">`；蒸馏弹层体量小，可只在按钮内挂 `IconSpinner`（`icons.tsx:138`，`index.tsx:2695` 已在用）。
- P1 / S

### P1-5　蒸馏自建弹层壳（Overlay 的第二份实现）
- 证据：`client/distill.tsx:349-356`（自己的 `useBodyScrollLock`，与 `index.tsx:197-206` 逐字同构）、`client/distill.tsx:483-491`（自己的 `.awu-scrim` 标记）、`client/distill.tsx:425-433`（自己的 Esc 监听）、`client/distill.tsx:389-391`（焦点三件套手动接线）。对照 `index.tsx:216-277`。
- 现象：`index.tsx` 的注释专门解释过遮罩必须吞文件拖放并复位宿主拖放计数器（`index.tsx:210-214,253-255`）；蒸馏这份只做了 `swallowFileDrag`，**缺 Overlay 那条卸载兜底**（`index.tsx:253-255`）→ 若 drop 事件中途被吃掉，宿主聊天区遮罩可能残留（P2-13）。
- 建议：`DistillDialog` 改成 `Overlay` 的子内容（与本面板其余 9 个弹层一致），只保留 `busy` 时不许关的那条差异（可给 `Overlay` 加 `closable={!busy}`）。
- P1 / M

### P1-6　粘贴/长文本输入是第三套输入件
- 证据：`client/distill.tsx:539-546`（`className="awu-distill-paste"` + inline `minHeight: 72`）+ `distill.styles.ts:134-158`（`min-height:104/max-height:200`、`padding: 8px 11px`、`font: mono 11px`、`border-radius: r-sm`、`focus` 只改 `border-color`）。规范件：`.awu-input`（42px 高、16px 字、`focus` 带 `0 0 0 4px` 光环，`styles.ts:2514-2539`）、`.awu-textarea`（110px 起、衬线 15px，`styles.ts:1903-1913`）。
- 现象：同一个弹层里，说明文字的输入（无）与「复制兜底」的只读框长得像老式代码框；**focus 没有 0.18s 过渡也没有光环**（`distill.styles.ts:158` 只有 `border-color`），而旁边所有 `.awu-input` 都有。
- 建议：只读兜底框改用 `.awu-input` + `asis` 的等宽修饰类（在 `styles.ts` 里加 `.awu-input[data-mono]`），最小高度用一个新令牌（如 `--awu-size-textarea-min: 72px`），不要在 JSX 里写 inline height。
- P1 / S

### P1-7　输入框三档高度并存（42 / 40 / 36）
| 高度 | 类 | 位置 |
|---|---|---|
| 42px / 16px 字 | `.awu-input` | `styles.ts:2517,2528` |
| 40px / 14px 字 | `.awu-input.awu-editInput` | `styles.ts:2269-2271` |
| 36px / 14px 字 | `.awu-input.awu-reviewInput` | `styles.ts:1654-1656` |
- 现象：**同一个预设编辑表单里**，预设名字段是 42px（`preset-view.tsx:872-884`），模块名字段是 40px（`preset-view.tsx:1010-1016`），两个输入框上下相邻却不等高 ⚠️待确认（肉眼可辨的 2px）。日记搜索框 36px（`diary-review.tsx:224-231`）是第三种。
- 建议：`awu-reviewInput` 的 36 → 40（与编辑器同一档）；预设名字段改用 `awu-editInput`（40）。保留 42 只给「独立弹层里的单字段表单」（新建/导入）。
- P1 / S

### P2-1　手搓关闭图标（唯一一处没复用 `IconClose`）
- 证据：`client/card-editor.tsx:374-376`（`<svg viewBox="0 0 16 16" width="15" height="15" strokeWidth="1.4">` + `M4 4l8 8M12 4l-8 8`），与 `client/icons.tsx:83` `IconClose` 的 path **逐字相同**。其余三处都用组件：`distill.tsx:503`、`index.tsx:2704`、`index.tsx:2820`。
- 现象：尺寸 15 是硬编码，别处是 `size` 传参（12/14/15）；将来改图标要改两处。
- 建议：换成 `<IconClose size={15} />`。
- P2 / S

### P2-2　折叠箭头靠内联 `transform` 旋转，不走 CSS 态
- 证据：`client/lorebook-editor.tsx:176`（`style={{ transform: 'rotate(-90deg)' }}`）、`:186`（`rotate(90deg)`）、`:563`（`showInfo ? 'rotate(90deg)' : 'none'`）；`client/preset-view.tsx:1026,1036`（同上）。规范做法：`.awu-editGroupChevron` 带 `transition: transform 0.18s`，由容器 `[data-open="true"]` 驱动（`styles.ts:2173-2181`），`styles.ts:1771/3055` 也是这个套路。
- 现象：内联 transform 没有过渡（瞬间跳转），而同一面板里 `.awu-editGroup` 的箭头是 0.18s 平滑旋转 —— 同一个手势两种节奏。另外 `lorebook-editor.tsx:176/186` 的上下移动箭头其实是「旋转 90° 的右箭头」，语义上复用 Chevron 而不是专用上下箭头（`icons.tsx` 没有 `IconUp/Down`）。
- 建议：给 `awu-loreRowBtn` 加 `[data-dir="up|down"] svg { transform: rotate(...) }` 并补 `transition`；顺带补两枚真·上下箭头图标。
- P2 / S

### P2-3　预设视图 26 处 inline style（含 10.5px 魔数）
- 行号全清单：`client/preset-view.tsx:552,564,567,576,577,852,859,864,866,867,868,893,897,906,1002,1026,1036,1071,1290,1319,1329,1330,1331,1337,1365,1405`
- 重点三处：
  - `:852` `style={{ marginLeft:'auto', fontFamily:'var(--awu-mono)', fontSize:10.5 }}` —— 字号 `10.5px` 低于 `--awu-fs-micro: 11px`；同一个魔数在**主面板**也出现了一次（`index.tsx:3090`），说明它已经在悄悄扩散；
  - `:1002` `.awu-switchRow` + `style={{ minHeight: 24 }}` —— 复用了主面板行零件又用 inline 压高度；
  - `:1071/:1290` 分别用 `marginRight:'auto'` / `marginLeft:'auto'` 实现「推到另一侧」，而 `distill.styles.ts:74` 用的是 `.awu-distill-close { margin-left: auto }` 类 —— 右推这件事有三种写法。
- 建议：一次性收编为 `styles.ts` 的 4~5 个工具类（`.awu-pushRight` / `.awu-pushLeft` / `.awu-metaMono` / `.awu-min24`），`fontSize:10.5` 统一到 `--awu-fs-micro`。
- P2 / M

### P2-4　行内图标按钮三档几何 + 三档按压手感
| 零件 | 尺寸 | 圆角 | `:active` |
|---|---|---|---|
| `.awu-iconBtn`（`styles.ts:651-670`） | 32×32 | `r-sm` 10 | `scale(.94)` |
| `.awu-loreRowBtn`（`styles.ts:2940-2957`） | 26×26 | `r-xs` 8 | **无** |
| `.awu-editListRemove`（`styles.ts:2316-2336`） | 28×40 | `r-xs` 8 | **无** |
| `.awu-btn[data-size="sm"]`（`styles.ts:1288`） | 28 高 | `r-xs` 8 | `scale(.97)`（`.awu-btn:active`，`styles.ts:1231`） |
- 现象：世界书行内 3 个按钮（`lorebook-editor.tsx:168-196`）与预设模块行内 3 个按钮（`preset-view.tsx:1018-1046`）都是 26px、按下无反馈；卡片列表的删除是 28×40 的竖长条（`card-editor.tsx:138-146`）。同一个「行内小图标按钮」三种尺寸、两种有无按压态。
- 建议：把 `.awu-loreRowBtn` 定为唯一的 28×28「行内图标」档（吃掉 `iconBtn` 的行内用法与 `editListRemove` 的宽度），统一补 `:active { transform: scale(.94) }`。
- P2 / S

### P2-5　成功反馈条：TTL 与关闭能力与主面板不一致
- 证据：主面板 `showNotice` → `NOTICE_TTL_MS = 5000`（`index.tsx:128,1902-1913`），渲染为 `.awu-status` + `awu-idleDot` + `awu-noticeText` + **`awu-noticeClose` 关闭按钮** + `aria-live="polite"`（`index.tsx:2803-2823`）。预设自建 `showNotice` → **6000ms**（`preset-view.tsx:477-483`），渲染缺关闭按钮、缺 `aria-live`（`preset-view.tsx:566-571,858-863`）。
- 现象：同一个「保存成功」提示，在主面板 5 秒且可手动关，在预设弹层 6 秒且只能干等。可访问性上两边都不算错（`role="status"` 自带 polite 语义），但主面板显式写了 `aria-live` 并给了关闭按钮，子视图少了这两样。
- 建议：预设复用 `index.tsx` 的 notice 组件（含 `IconClose` 与 `notice.close` 文案键），TTL 收敛到 5000 或提成令牌 `--awu-dur-notice`。
- P2 / S

### P2-6　预览的「加载中」图标用错（Spark 当 Spinner）
- 证据：`client/preview.tsx:139` `{loading ? <IconSpark size={14} /> : <IconRefresh size={14} />}` 配 `data-spin="true"`（`:135`）；`icons.tsx:138` 有专门的 `IconSpinner`，主面板加载就是它（`index.tsx:2695`）。
- 现象：同样是「转起来表示在跑」，星形图标旋转语义弱，且和「统计」tab 的图标同形，容易被读成装饰。
- 建议：`IconSpinner`。
- P2 / S

### P2-7　死样式 / 死属性（会误导后来者以为已在生效）
| 位置 | 现象 |
|---|---|
| `distill.styles.ts:160-227` | 注释里自己写明「随粘贴校验一起挂起」的 4 组规则（`sep/meter/bar/groups/tag/nameRow/hint`），TSX 侧已无任何引用（`distill.tsx` 全文搜不到这些类）——其中 `:191` 还留着一条 `.26s` 动画 |
| `client/guide.tsx:106` | `<div className="awu-guide-alert" data-tone="warn">` —— `guide.styles.ts` 没有 `[data-tone]` 选择器，属性完全无效 |
| `client/diary-review.tsx:261`、`client/preset-view.tsx:584` | `.awu-empty[data-kind="diary|empty"]` —— `styles.ts` 里**没有任何** `.awu-empty[data-kind]` 规则 |
| `index.tsx:3015`（主面板，顺带发现） | `.awu-emptySub` 在 `styles.ts` 里**无规则**，该行「补充说明」和小字提示同样样式 |
- 建议：删死 CSS（或加 `/* 保留：接口回来时接线 */` 且从构建产物里摇掉）；`data-kind` 要么补规则（如 error 态红柔光）要么删属性。
- P2 / S

### P2-8　`styles.ts` 反向引用子视图命名空间
- 证据：`styles.ts:559`（`.awu-railHead > .awu-distill-entry`）、`styles.ts:902`（`.awu-ctaRow > .awu-distill-entry`）、`styles.ts:998`（`.awu-distill-entry { margin-bottom }`）。而 `.awu-distill-entry` 的本体定义在 `distill.styles.ts:25-33`。
- 现象：`distill.styles.ts:5` 的约定写的是「类名一律 `awu-distill-*`，不碰别人的 `awu-*`」——反过来主文件却主动去改蒸馏的布局。谁拥有这个类说不清；改一处忘一处就错位。
- 建议：主面板需要控制入口位置时，给容器加 `.awu-ctaRow > *` 之类的通用子选择器，或由 `DistillEntry` 接收 `data-slot` 属性。
- P2 / S

### P2-9　唯一一条硬编码时长动画 + 非 EASE 缓存曲线
- 证据：`distill.styles.ts:191` `transition: width .26s var(--awu-ease, cubic-bezier(.22,.61,.36,1))`。主面板节奏：`--awu-dur-1..5 = .12/.18/.24/.34/.6s`（`styles.ts:182-186`）、`EASE = cubic-bezier(.32,.72,0,1)`（`styles.ts:21`）。fallback 里的 `.22,.61,.36,1` 是更早一版缓动，与现行 EASE 不同。
- 现象：`.26s` 既不在五档里，fallback 也不等于真 EASE；虽然这条规则目前属于挂起块（P2-7），但它是**子视图 CSS 里唯一一处动画**，也正是「继续加动效会更乱」的样板。
- 建议：删掉；真要复活进度条就用 `var(--awu-dur-3)`（.24s）。
- P2 / S

### P2-10　粘贴框 focus 瞬变（无过渡）
- 证据：`distill.styles.ts:135-158`（`.awu-distill-paste` 整块无 `transition` 声明，`:focus` 只改 `border-color`）对照 `.awu-input` 的 `transition: border-color .18s, box-shadow .18s`（`styles.ts:2532`）。
- 现象：同一个弹层里，两类输入框的聚焦反馈一个是渐显光环、一个是瞬间变边。
- P2 / S

### P2-11　布局用内联 spacer / 内联 margin
- 证据：`client/card-editor.tsx:419` `<div style={{ height: 8 }} />`（滚动体末尾垫高，应为 padding-bottom 令牌）、`:387` `.awu-err` 上 inline `margin: '0 16px 10px'`。同类：`client/diary-review.tsx:251`（`marginLeft:'auto'`）、`:295`（`flex:1,minWidth:0`）、`client/preview.tsx:132`（`marginLeft:'auto'`）、`:154,155`。
- 现象：14 处零碎内联布局分散在 5 个文件，没有一处能靠改 `styles.ts` 统一调整间距。
- 建议：`card-editor` 的 8px 改 `.awu-editorBody { padding-bottom: var(--awu-gap-9) }`（已有）；`marginLeft:'auto'` 统一成 P2-3 的工具类。
- P2 / S

### P2-12　预设「两段点击」删除确认的生命周期缺口
- 证据：`client/preset-view.tsx:435`（`confirmDelete` 状态）、`:1070-1089`（第二次点才真删）、`:493/529`（只在 `openPreset`/`startNew` 复位）。
- 现象：点了删除 → 按钮变成「确认删除」并出了提示文案，此时如果去改模块或点刷新，确认态**一直挂着**，误触一次就直接删掉整份预设（没有二次弹层兜底）。
- 建议：`confirmDelete` 加 `useEffect` 超时复位（5s）或「任何其它交互即复位」；更稳的是直接改成主面板那套 `DeleteDialog`（见 P1-8 建议）。
- P2 / S

### P2-13　蒸馏遮罩缺「卸载时复位宿主拖放状态」兜底
- 证据：`client/distill.tsx:487-489` 只接了 `swallowFileDrag`；`index.tsx:253-255` 额外有一条 `useEffect(() => () => resetHostDropState(), [])`，注释解释「万一拖放在中途被别的东西吃掉」。
- 现象：蒸馏弹层是自建壳（P1-5），这条兜底没跟过来；`dragdrop.ts:26-31` 说明漏一处就是一处真机卡死。
- 建议：跟 P1-5 一起解决（换 `Overlay` 即自动获得）。
- P2 / S

### P2-14　`--awu-dialog-w` 注释与实现互相矛盾
- 证据：`styles.ts:2458-2459` 注释「这个宽度直接写在这里，不动 `--awu-dialog-w` 令牌（蒸馏弹层还在用它兜底 420）」，但 `--awu-dialog-w` 的实际值是 `760px`（`styles.ts:198`），而 `distill.styles.ts:67` 的 fallback 仍写 420。
- 现象：三处数字（760 / 620 / 420）各说各话，读代码的人无法判断哪个是意图。
- 建议：删掉已无消费者的 `--awu-dialog-w`（或改注释），fallback 一并清掉。
- P2 / S

### P2-15　同一「启用」动作在弹层是 28px、在详情 hero 是 38px
- 证据：预设「本会话使用 / 全局使用 / 不使用」用 `data-size="sm"`（`preset-view.tsx:914-947`，28px，`styles.ts:1288`）；主面板详情 hero 的同类动作（会话启用/退出/全局启用）用 `data-size="md"`（`index.tsx:1492-1532`，38px，`styles.ts:1280-1286`）。
- 现象：同语义按钮跨界面差 10px 高度；`styles.ts:1279` 的注释也承认 md 是为 hero 造的一档。
- 建议：弹层内主操作统一 `data-size="md"`（38）或 `block`（40），把 28 只留给「行内/次操作」。
- P2 / S

---

## 3. CSS 类名前缀与主 token 的关系（量化）

| 文件 | 类名前缀 | 规则数 | `var(--awu-*)` | 写死色值 | 写死字号 | 写死圆角 | 间距：token / 写死 px |
|---|---|---|---|---|---|---|---|
| `styles.ts` | `awu-*`（278 个类） | 556 条选择器行 | **1121 行含令牌**（1420 处引用） | 10 行（头像色阶、 shimmer、specular 内高光，均为设计意图） | **0** ✅ | 0 | **178 / 19** |
| `distill.styles.ts` | `awu-distill-*` | 33 条选择器 / 34 个规则块（含 1 个 `@media`） | 42 处（**全部带 fallback**） | **30 行** fallback 硬编码（`#8f8172` / `#bdae9d` / `#f6ece0` / `#e9bd72` / `#86c9bd` / `#e2796b` / `rgba(244,208,160,.11)` 等旧暖色系） | **11 处**（11 / 12 / 11 / 11.5 / 9.5 / 10.5 / 11 / 11.5 / 10 / 9.5 / 10 px） | 4（`50%` / `2px`×2 / `999px`——后者本可用 `--awu-r-pill`） | **0 / 23** |
| `guide.styles.ts` | `awu-guide-*` | 26 条选择器 / 25 个规则块 | 26 处（仅颜色与圆角） | 0（唯一的 `#fff` 是 `var(--awu-surface-opaque, #fff)` 的 fallback，`guide.styles.ts:134`） | **14 处**（11–14px，含正文 13px） | 1（`50%`） | **0 / 9** |

**三条结论**：
1. **颜色纪律**：`guide.styles.ts` 干净；`distill.styles.ts` 的 42 处虽有令牌，但**每一处都挂着一个过期暖色 fallback**（文件头 `distill.styles.ts:9-13` 的前提是「弹层在 token 作用域外」——该前提已失效：`styles.ts:51-54` 早把 `.awu-scrim` / `.awu-dialog` 纳入变量清单，而蒸馏弹层正是 `className="awu-dialog awu-distill-dialog"`，`distill.tsx:491`）。这 30 处是可燃垃圾：一旦哪个选择器落到作用域外，界面会瞬间变成 10 月之前的暖象牙主题。
2. **字号纪律**：`styles.ts` 达到 **0 处写死 font-size** 的硬标准，两个子视图文件却是 **25 处全写死**，其中 5 处低于 `--awu-fs-micro: 11px` 下限（`distill.styles.ts:111,126,176,204,224`）。
3. **间距纪律**：`styles.ts` 是 178:19 的 token 化比例，两个子视图文件是 **0:32 全写死**。这是子视图与主面板「看起来不像一家」的最底层原因——不是颜色，是**节奏**。

---

## 4. 视觉语言漂移（数值对照表）

| 维度 | 主面板规范值 | 子视图实际值 | 位置 | 级别 |
|---|---|---|---|---|
| 弹层宽度 | `min(620px,100%)` | `min(760px,100%)` | `styles.ts:2460` vs `distill.styles.ts:67` | P1 |
| 弹层圆角 | `--awu-r-xl` = 24px | `--awu-r-lg` = 16px | `styles.ts:2465` vs `distill.styles.ts:69` | P1 |
| 小字下限 | `--awu-fs-micro: 11px` | 9.5 / 10 / 10.5px | `styles.ts:130` vs `distill.styles.ts:111,126,176,204,224`；`preset-view.tsx:852`；`index.tsx:3090` | P1 |
| 弹层内条状件缩进 | 20px（`.awu-dialogBody` padding） | 52px（32 gutter + 20 padding） | `styles.ts:2501,696,1983` vs `preview.tsx:153`、`preset-view.tsx:575,866,1329` | P1 |
| 输入框高度 | 42px（`.awu-input`） | 40px（`awu-editInput`）/ 36px（`awu-reviewInput`） | `styles.ts:2517,2269,1656`；`preset-view.tsx:873,1011`；`diary-review.tsx:225` | P1 |
| 按钮高度 | 34 默认 / 28 sm / 38 md / 44 lg | 「启用」动作 28（弹层）vs 38（hero） | `styles.ts:1214,1288,1280,1290`；`preset-view.tsx:916`；`index.tsx:1492` | P2 |
| 行内图标按钮 | 32×32 / r10 / `scale(.94)` | 26×26 / r8 / 无按压；28×40 / r8 / 无按压 | `styles.ts:651-670` vs `:2940-2957`、`:2316-2336` | P2 |
| 正文可读宽度 | `--awu-content-max` = 760px，`margin: 0 auto`（`.awu-detail` `styles.ts:1297-1298`） | **680px 硬编码且不居中**（`.awu-guide` 直接挂在 `awu-pane` 里，`index.tsx:3097`） | `guide.styles.ts:25` | P1 |
| 正文字号 | `--awu-fs-body` 14 / `--awu-fs-body-lg` 15（`.awu-hint` 14、`.awu-emptyHint` 15） | 13px（指南正文，`guide.styles.ts:75,104,148,192,199`） | 同上 | P1（与上条合并计一处） |
| 玻璃材质 | `--awu-blur`/`--awu-specular`/`--awu-glass-2` 三层 | 蒸馏状态条用 `--awu-surface-2` 打底、无 sheen/edge/内高光，是扁平的（`.awu-loreFold`/`.awu-presetUse` 那类「次级块」用的是同一档底，但都带了边框方向性强调） | `distill.styles.ts:52-58,144-147` | P2 |
| 面包屑/返回 | `.awu-navBack`（accent 色 + 14px 图标 + min-h 28） | 预设两个视图 ✓ 用它；角色卡编辑器用**关闭 X** 而非返回箭头 | `styles.ts:1304-1314`；`preset-view.tsx:844-851,1286-1289` vs `card-editor.tsx:366-377` | P2 |
| 标题层级 | 弹层标题 `.awu-dialogHead` 18px 600（`styles.ts:2496-2497`）；编辑器「kicker 12 + 名字 22 衬线金」（`:2043-2066`） | 预设编辑视图**无标题**，只有一个返回按钮 + 10.5px 计数（`preset-view.tsx:843-855`）；导入视图右侧标题是裸 `<span>`（`:1290`） | 同上 | P2 |

> **hover 手感**：`.awu-btn` 有 `scale(.97)`、`.awu-iconBtn` 有 `scale(.94)`、`.awu-card` 有位移抬升；而 `.awu-loreRowBtn` / `.awu-editListRemove` / `.awu-editAdd` / `.awu-reviewMonthHead` / `.awu-presetModuleBody` **全部只有颜色变化，没有位移或缩放**。子视图里点击密度最高的正是这批按钮（世界书每行 4 个、预设每模块 4 个），所以「手感发木」的体感会集中在子视图。

---

## 5. 交互模式不一致

### P0-1　预设编辑器没有任何脏数据保护（全项目唯一会静默丢内容的路径）
- 证据：
  - `client/preset-view.tsx:421-428` 的状态表里**没有** `dirty` / `baseline` 字段，`:664-698` 的 `patchModule` / `moveModule` / `removeModule` 全是直接改 `detail`，无快照可比；
  - `client/preset-view.tsx:1092` 底栏「关闭」直接 `onClose()`；`:847` 返回列表直接 `setDetail(undefined)`；`client/index.tsx:3128` 的 `Overlay onClose={() => setDialog('')}` 让 Esc / 点遮罩也走同一条静默销毁路径；模块正文走 `FocusEditor`（`:1105-1121`）只保护了「正在全屏编辑的那一条」，列表里其余改动无保护；
  - 对照实现：`client/card-editor.tsx:279-286`（`structureDirty`/`loreDirty`/`onDirtyChange` 上报）、`:303-315`（`requestClose` + `closeSignal` 同一套）、`:318-331`（Esc 分支）、`:442-460`（`.awu-editorConfirm` 确认层）；`client/editor-focus.tsx:93-97,160-169`（丢弃确认）。
- 现象：预设正文动辄数千到数万字（`PRESET_LIMITS.moduleChars = 40_000`，`:48-53`）。用户编辑完点「关闭」、按 Esc、或点到遮罩，**整套草稿无声消失且没有任何提示**；同一个面板里角色卡编辑器会拦住问「继续编辑 / 丢弃」。
- 影响：数据丢失 + 心智不一致（同一面板里两种「关闭」语义）。这是本轮唯一 P0。
- 建议：最小改动＝把 `card-editor` 那套搬三行——`baseline` 快照（`JSON.stringify(detail)`）+ `dirty` 派生 + 「关闭 / Esc / 遮罩」统一走 `requestClose()` → `.awu-editorConfirm`；同时给底栏加脏标记（见 5.2）。
- P0 / M

| # | 维度 | 主面板口径 | 子视图实际 | 位置 | 级别 |
|---|---|---|---|---|---|
| 5.1 | 保存/关闭的脏数据保护 | 编辑器：`requestClose` → 有改动弹 `.awu-editorConfirm` 二次确认；Esc 同路；父级遮罩关闭走 `closeSignal` 同一套（`card-editor.tsx:303-331`、`:309-315`、`:442-460`；`onDirtyChange` 上报 `:286`） | **预设编辑器 0 保护**：`onClose`（`preset-view.tsx:1092`）与 `Overlay` 的 Esc/遮罩（`index.tsx:3128`）直接关掉整套模块草稿；无 dirty 追踪、无确认层 | `preset-view.tsx:841-1123`、`index.tsx:238-251,3128` | **P0** |
| 5.2 | 保存按钮的可用性 | `disabled={busy \|\| !dirty}` + 左下角脏标记「未保存 / 已保存」（`card-editor.tsx:424-436`） | 预设保存 `disabled={editLoading \|\| detail === undefined}`，**未改动也能点保存**，且没有脏标记 | `preset-view.tsx:1093-1101` | P1 |
| 5.3 | 删除确认 | 独立 `DeleteDialog` 弹层（标题+正文+复选框+危险按钮，`index.tsx:1130-1171`） | 预设：两段点击（无弹层，`preset-view.tsx:1070-1089`）；模块删除：**无确认**（`:1038-1046`）；世界书条目删除：**无确认**（`lorebook-editor.tsx:188-196,416-419`）；卡内列表项删除：**无确认**（`card-editor.tsx:138-146`） | 四处 | P1 |
| 5.4 | 底部操作条顺序 | 左「取消」右「主操作」，`justify-content:flex-end`（`styles.ts:2503-2509`）；危险件在最右（`index.tsx:1157-1168`） | 预设编辑：`[删除(danger,左)] [关闭] [保存(primary)]`；导入：`[取消] [确认]`；蒸馏确认：`[取消] [开始]`、结果：`[复制] [完成]`；预览：`[刷新] [关闭(primary)]` —— 顺序都对，但「关闭」承担了「取消」的语义而文案是「关闭」，且它是第三条 | `preset-view.tsx:1067-1102,1415-1426`；`distill.tsx:555-585`；`preview.tsx:224-231` | P2 |
| 5.5 | Esc 行为 | 壳层 `Overlay` 捕获阶段关弹层；内层 `FocusEditor` 开着时 `escYield` 让位；内层自己先出「丢弃确认」（`index.tsx:239-251`、`editor-focus.tsx:105-121`、`card-editor.tsx:318-331`） | 预设/预览经 `Overlay` ✓；预设把 `escYield` 接到了 `presetFocusOpen`（`index.tsx:3128`）✓；蒸馏自建监听 + `busy` 时禁 Esc（`distill.tsx:425-433`）⚠️ 独立一份；世界书的全屏层靠父级 `loreFocus` 让位 ✓ | 见左 | P2（并入 P1-5） |
| 5.6 | 加载中禁用 | 面板级 `data-busy` 光带（`styles.ts:673-684`）+ 各按钮 `disabled={busy}` | 子视图都做了 `disabled`（预设 `:920,930,944,1084,1098`；蒸馏 `:501,558,566`；预览 `:137,225`）✅ 但**都没有面板级忙碌指示** | 见左 | P2 |
| 5.7 | 成功反馈 | `.awu-status` 提示条，5s 自动走、可手动关、`aria-live`（`index.tsx:2803-2823`） | 预设自建 6s、无关闭钮、无 `aria-live`（`preset-view.tsx:477-483,566-571,858-863`）；蒸馏用弹层内 `data-tone` 状态条（`distill.tsx:525-532`，合理，因为是「结果回执」）；世界书保存成功由父级提示 ✅ | 同左 | P2 |
| 5.8 | 返回路径 | 详情页 `awu-navBack`（`styles.ts:1304`）；编辑器用关闭 X | 预设：`awu-navBack` 回列表 ✓；导入视图：`awu-navBack` ✓；角色卡编辑器是**整页接管**却用 X（语义上更像返回） | `preset-view.tsx:844-851,1286-1289`；`card-editor.tsx:366-377` | P2 |
| 5.9 | 空态文案结构 | `Mark + Title + Hint`（`index.tsx:2957-2961`、`:1412-1416`、`:1654-1658`） | 预设列表：`Mark + Hint`（**缺 Title**，`preset-view.tsx:584-587`）；日记回顾：`Mark + Hint`（**缺 Title**，`diary-review.tsx:261-263`）；预览段为空：非 `.awu-empty`，退化成 `.awu-hint`（`preview.tsx:186`）；世界书：`awu-editListEmpty + awu-hint + 加号`（`lorebook-editor.tsx:573-581`，**无 Mark**，但有空态引导按钮 ✅） | 四处 | P1 |
| 5.10 | 启用态表达（两种启用） | 状态带 `data-status=live/alert/info/warn` + `.awu-pill[data-tone]` | 预设列表用 `.awu-pill[data-tone="live|teal"]` 标「本会话 / 全局」✅ 与主面板一致；编辑页「使用/不使用」三按钮用 `data-kind={here?'primary':undefined}` 表达当前态 ✅ | `preset-view.tsx:605-606,918,928,944`；`styles.ts:1192-1206` | ✅ 已一致 |

---

## 6. 状态完备性矩阵（五态）

| 子视图 | loading | empty | error | disabled（加载中/不可用） | 超长文本 |
|---|---|---|---|---|---|
| 预设 列表 | ⚠️ 纯文字（`preset-view.tsx:581`） | ⚠️ 缺 Title（`:583-588`） | ✅ 三种（unavailable / `.awu-err` / 行内上限提示 `:896-909`） | ✅ 刷新/保存/启用均 `disabled` | ✅ 模块正文走 FocusEditor，列表只给 60 字摘要（`:168-172`） |
| 预设 编辑 | ⚠️ 无骨架，只有按钮变「请稍候」（`:1100`） | ✅ `awu-editListEmpty`（`:997`） | ✅ | ✅ | ✅ FocusEditor + `PRESET_LIMITS.moduleChars` 就地提示 |
| 预设 导入 | ⚠️ 只有按钮文案（`:1424`） | ✅ 空 JSON 时清空预览（`:1196`） | ✅ JSON 解析原文透出（`:1179-1189`） | ✅ `disabled={busy\|\|parsed===undefined}`（`:1422`） | ✅ 粘贴框 + 300ms 防抖（`:1194-1199`）+ 预览列表 `max-height:260`（`styles.ts:3292`） |
| 蒸馏 弹层 | ❌ 只有按钮文案（`distill.tsx:570`） | —（两态流程，无空态） | ⚠️ 自造 `.awu-distill-status` | ✅ 四处（`:427,487,501,566`） | ⚠️ 只读框 `max-height:200` 靠原生滚动（`distill.styles.ts:139`） |
| 世界书 | —（数据由父级给） | ✅ 引导式空态 + 加号（`lorebook-editor.tsx:573-581`） | ✅ 体检 issue 三级 + `unsupported` 说明（`:443-445`） | —（无独立异步动作） | ✅ FocusEditor（`:670-691`）+ 字数计数（`:250-252`） |
| 角色卡编辑器 | —（同上） | ✅ `awu-editListEmpty`（`card-editor.tsx:124-126`） | ⚠️ 裸 `.awu-err` 无图标 + inline margin（`:386-390`） | ✅ 保存 `disabled={busy\|\|!dirty}`（`:435`） | ✅ textarea 自适应到 240px 封顶（`:70-75`） |
| 日记回顾 | —（纯前端过滤） | ⚠️ 缺 Title（`diary-review.tsx:261-263`） | —（无网络） | —（无异步） | ✅ `.awu-line` 15px/24px 自动换行 + 导出前 `flatten` |
| 注入预览 | ⚠️ 纯文字（`preview.tsx:146-148`） | ⚠️ 非 `.awu-empty`（`:186`）；段内空有 `awu-previewEmpty` ✅ | ✅ 区分 unavailable / 失败（`:150-157`） | ✅ 刷新 `disabled={loading}`（`:137,225`） | ✅ `pre.styles`：`max-height:320` + `white-space:pre-wrap` + `word-break`（`styles.ts:1800-1813`） |
| 专注编辑层 | — | ✅ `placeholder` / 只读模式 | — | ✅ 只读模式无「完成」按钮（`editor-focus.tsx:138-142`） | ✅ 整屏 + `--awu-content-max` 行宽 + 码点计数（`:59-61`） |
| 使用指南 | —（静态） | — | — | — | ⚠️ 路径行 `word-break: break-all`（`guide.styles.ts:85,177`）✅ |

**缺的态汇总**：`loading` 三处不达标准（预设列表/编辑/导入、预览、蒸馏）、`empty` 三处缺 Title 或退化、`error` 五处形态不统一。**没有一处完全缺失五态里的某一态**——问题全是「有，但长的不一样」。

---

## 7. 动效一致性

**好消息**：8 个子视图**没有一个自定义 `@keyframes`**（`distill.styles.ts` / `guide.styles.ts` 全文 0 个 `@keyframes`，对比 `styles.ts:3475-3527` 的 12 个）。入场/切换全部走主面板那套：

| 场景 | 动画 | 时长/曲线 | 位置 |
|---|---|---|---|
| 主面板入场 | `awu-panel-in`（scale .985 + translateY 6） | `--awu-dur-4` .34s EASE | `styles.ts:3475-3478` |
| 弹层入场 | `awu-sheet-in`（translateY 24 上浮） | `--awu-dur-4` .34s EASE | `styles.ts:2475` |
| 详情页 / 编辑器切页 | `awu-slide-in`（translateX 10） | `--awu-dur-3` .24s EASE | `styles.ts:1299,2028` |
| 专注编辑层 | `awu-fade` | `--awu-dur-2` .18s EASE | `styles.ts:2592` |
| 卡片错峰 | `awu-rise` + `animationDelay = min(index,8)*CARD_STAGGER(34ms)` | .12–.34s | `styles.ts:37`、`index.tsx:441` |
| 遮罩 | `awu-fade` | .18s | `styles.ts:2453` |
| 骨架 shimmer | `awu-shimmer` | 1.4s linear | `styles.ts:2006` |
| 图标 spin | `awu-spin` | **硬编码 .9s linear** | `styles.ts:670` |

**漂移点**：
1. **唯一的子视图动画是硬编码时长的**：`distill.styles.ts:191` `transition: width .26s`（且 fallback 缓动不是 EASE）——而且它属于已挂起的死块（P2-7/P2-9）。
2. **子视图没有「内容切换」动效，而主面板有**：预设 `list ↔ edit ↔ import` 是同一 `<Overlay>` 内三份 return（`preset-view.tsx:543,654,1127`），切换时无任何过渡，是**瞬切**；主面板详情页切角色有 `awu-slide-in`，编辑器接管有 `awu-slide-in`。⚠️待确认（体感上「页」的切换应该有一次 0.24s 位移或淡入）。世界书分区展开、预设模块展开也都是瞬切（`lorebook-editor.tsx:200`、`preset-view.tsx:1051`），而 `.awu-editGroup` 分组展开同样是瞬切 —— 这一条主面板自己也欠，**不建议只给子视图加**（见 §8）。
3. **34ms stagger 只覆盖主面板卡片**：`CARD_STAGGER` 目前唯一消费点是 `index.tsx:441`。世界书条目列表（`lorebook-editor.tsx:584-599`）、预设模块列表（`preset-view.tsx:999-1058`）都是无错峰直出。考虑到列表项常带重输入框，加 stagger 反而拖慢手感，**建议维持现状**（列入 §9）。
4. **`prefers-reduced-motion` 白名单只认识主面板类**：`styles.ts:3542-3565` 列了 `.awu-card/.awu-trigger/.awu-btn/.awu-tab/.awu-input/.awu-line/.awu-iconBtn/.awu-navBack` 与若干动画类，但**没有** `.awu-loreRowBtn` / `.awu-editListRemove` / `.awu-editAdd` / `.awu-editGroupHead` / `.awu-presetModuleBody` / `.awu-reviewMonthHead` / `.awu-loreDroppedHead` —— 而这些恰恰是子视图里 hover 最频繁的零件。蒸馏只给自己写了 `distill.styles.ts:232-234` 一条降级（且只针对那条死动画）。
   - P1 / S（a11y 缺口，改动极小）

---

## 8. 可维护性：3 个 styles 文件 + 26 处 inline 的结构判断

**现状结构**
```
styles.ts (3587 行, 278 类)
├── 变量层 60-257（深色+浅色两套，逐字同步）
├── 语义零件 650-3460（btn 1209 / tabs 801 / empty 1920 / sk 1995 / editor 2017 / dialog 2456 / focus 2582 / lore 2825 / preset 3120 …）
└── 末尾 3566-3568: ${GUIDE_CSS} ${DISTILL_CSS}
```
三份 CSS 是**串接进同一个 `<style>`**（`styles.ts:3566-3568`，由 `installStyles()` 一次性注入 `:3574-3584`），所以**没有样式隔离**：层叠顺序 = `styles.ts` 全部 → guide → distill。任何子视图规则都能覆盖主面板规则，反之亦然（P1-1、P2-8 就是这么发生的）。inline style 则胜出一切。

**「继续加动效会不会更乱」——会，而且是三步变乱：**
1. **降级清单必然漏**：`prefers-reduced-motion` / `prefers-reduced-transparency` 的白名单（`styles.ts:3529-3565`）是**集中式枚举**，而新的动画目标类天然写在子视图文件里，作者只看自己那份 → 每加一处动效，就多一处 a11y 遗漏（§7.4 已经是这个结果）。动效是唯一「必须回主文件登记」的东西，这是结构性矛盾。
2. **缓动与时长会出现第二真源**：`EASE` 与 `--awu-dur-*` 都定义在 `styles.ts:21,182-186`，子视图里要写过渡就得自己抄值（`distill.styles.ts:191` 已经抄错了一次：`.26s` + 旧曲线）。
3. **入场时序没有统一挂点**：主面板靠「换 DOM 节点」触发 CSS `animation`（`.awu-detail`/`.awu-editor` 各自声明），子视图的多视图切换（预设三视图）是**同一个挂载点的内容替换**，CSS 动画不会重放——所以它今天没有切换动效；要加就得引 JS 时序（key 重挂 / `animationend` / WAAPI），这是一次架构级改动，不是加两行 CSS。

**建议（不要求重构，按性价比排序）**
- S1：把「动效目标类」收成一份 CSS 变量化的清单，例如在 `styles.ts` 末尾只写
  `[class*="awu-"] { transition-duration: … }` 不行（会把不该动的动画也压掉），
  更稳的是给这类零件统一加 `data-motion="ui"` 属性，降级块只写 `:where([data-motion]) { transition-duration: .01ms !important }`。**一次登记，永久生效**，子视图新增零件只要带上属性即可。
- S2：把 `EASE` / 五档时长导出为 TS 常量（已有 `EASE`/`CARD_STAGGER` 先例），子视图禁止写字面量时长；代码评审只需搜 `transition:` 后面是否有裸数字。
- S3：把 `ErrorBar` / `Skeleton` / `EmptyState` / `IconBtn` 四个高频零件提到 `client/parts.tsx`（现在是 `index.tsx` 内部函数，子视图拿不到才各自重写）。这一步能同时消掉 P1-3/P1-4/P1-9 与 P2-4。
- S4：inline style 收编成工具类（P2-3/P2-11），并在 lint 层加一条「`styles.ts` 之外的 px 字面量警告」——`styles.ts` 已经做到 0 处写死字号，这条规则是可以被工具守住的。

**结论**：可以继续加动效，但**必须先做 S1**（否则每加一处都是 a11y 债务）；子视图的**结构性重构（拆包、CSS Modules、Shadow DOM）不建议现在做**——当前的复用率（13 类零件里 7 类全复用）说明分层是对的，病灶只是「两个漏管辖区 + 一个集中式白名单」。

---

## 9. 已经一致、不要动 ✅

以下 12 项经代码核对**与主面板同源**，改动只会制造新漂移：

1. **`client/editor-focus.tsx` 整份** —— 全项目唯一 **0 自造件** 的子视图：只用 `.awu-focus/.awu-focusHead/.awu-focusTitle/.awu-focusCount/.awu-focusBody/.awu-focusInput/.awu-focusRead/.awu-focusFoot/.awu-focusHint` + `.awu-btn` + `.awu-navBack` + `a11y.ts` 三件套；Esc 先出丢弃确认、`Cmd/Ctrl+Enter` 提交、打开时把光标推到末尾（`editor-focus.tsx:74-121`）。**它是子视图的标杆，建议其余模块照这个写。**
2. **`lorebook-editor.tsx` 的零件复用** —— 分区头/折叠/字段/加号/开关全部吃 `.awu-editGroup*` / `.awu-editField*` / `.awu-editInput` / `.awu-editAdd` / `.awu-switchRow`，本文件**新增 0 条 CSS**（相关类都在 `styles.ts:2825-3117` 且 100% 走令牌）。文件头 `:4-7` 明确「样式与语义与 FieldGroup 逐字一致」，实测成立。
3. **`card-editor.tsx` 的编辑器骨架** —— `.awu-editor*` 全家 + `.awu-editorFoot` 的「脏标记 + 取消 + 主操作」顺序 + 未保存确认层（`card-editor.tsx:303-331,423-460`）与 `.awu-focusFoot` 的丢弃确认（`editor-focus.tsx:160-169`）**同一套语言**（都是 `[继续编辑] [丢弃(danger)]`）。
4. **`diary-review.tsx` 的复用** —— 只用 2 处 inline（`marginLeft:'auto'`、`flex:1`）：搜索用 `.awu-input`，清除/导出用 `.awu-btn[data-size=sm][data-kind=ghost]`，空态用 `.awu-empty` + `awu-emptyMark`，正文用主面板的 `.awu-line` / `.awu-day` / `.awu-dayDate` / `.awu-lineEdit`，折叠箭头借用 `.awu-editGroupChevron`（`styles.ts:1695` 有对应 `[data-open]` 旋转规则）。**跨模块借零件是加分项**（比新造一份好），不要为了「模块自治」拆开。
5. **`preview.tsx` / `preset-view.tsx` 的弹层三件套** —— 都渲染 `.awu-dialogHead / .awu-dialogBody / .awu-dialogFoot` 而**不重复实现弹层本身**（对比蒸馏 P1-5）。`preview.tsx:10-13` 的注释把这个理由写得很清楚，建议作为约定固化。
6. **`.awu-iconBtn[data-spin="true"]` 的旋转复用** —— `preview.tsx:135`、`preset-view.tsx:555` 都只挂属性，不写动画（`styles.ts:670`）。这是「复用手感」的正确姿势。
7. **焦点三件套的接线顺序** —— 所有子视图都是「先 `useRestoreFocus` → 再 `useInitialFocus` → 最后 `useFocusTrap`」：`distill.tsx:389-391`、`card-editor.tsx:272-277`（含双层弹层压栈）、`editor-focus.tsx:74-76`、`index.tsx:234-237`。四处逐字一致，且都有「顺序不能换」的注释。**不要动。**
8. **内层让位（escYield）协议** —— `card-editor.tsx:318-331` 的 `loreFocus`、`lorebook-editor.tsx:359,670` 的上报、`preset-view.tsx:470-475` 的 `onFocusLayerChange`、`index.tsx:222-228,3128` 的消费，四方对齐。这是全项目最容易被后续改动破坏的隐式契约，**已经有注释锁着，保持原样**。
9. **蒸馏弹层的忙碌期禁止关闭** —— `distill.tsx:427`（Esc）、`:487`（点遮罩）、`:501`（关闭钮）三处一致守卫 `busy`。语义正确（防止「以为在跑其实关了」），换 `Overlay` 时（P1-5）必须保留。
10. **世界书的「体检不阻断保存」** —— `lorebook-editor.tsx:522-572`：无问题是单句「体检通过」，有问题才挂分组胶囊，`info` 默认折叠，`aria-live="polite"`。信息密度处理得比主面板的「错误 0 / 提醒 0 / 提示 2」更克制（`styles.ts:3010-3028`）。**这是子视图反哺主面板的正面样本。**
11. **`styles.ts` 自身的字号纪律** —— 3587 行里 **0 处** 写死 `font-size`，全部 11 档令牌。新增子视图零件请沿用（Guide/Distill 两文件是反面教材）。
12. **同一份 `<style>` 注入** —— `installStyles()` 幂等 + 两个子视图 CSS 只在末尾拼接、不新增 `<style>` 标签（`styles.ts:17-18,3566-3584`）。这条集成契约守住了，避免了几十个插件抢 `<style>` 的老问题。

---

## 10. 优先级与建议动手顺序

| 序 | 事项 | 涉及 | 级别 | 工作量 | 为什么先做 |
|---|---|---|---|---|---|
| 1 | 预设编辑器加脏数据保护（`dirty` + 确认层 + `onDirtyChange`），照抄 `card-editor.tsx:303-331` | `preset-view.tsx` | **P0** | M | 唯一会静默丢数据的路径 |
| 2 | `distill.styles.ts` 删掉 `width`/`border-radius`/`max-height` 三行；`9.5/10/10.5px` → `--awu-fs-micro`；清 30 处过期 fallback | `distill.styles.ts` | P1 | S | 一次改完，视觉立刻归队（漂移 1+2） |
| 3 | `.awu-dialogBody > .awu-err / > .awu-status` 归零外边距，删 6 处 inline 补丁 | `styles.ts` + 2 子视图 | P1 | S | 漂移 3，一处规则治一片 |
| 4 | `ErrorBar` / `Skeleton` / `EmptyState` 提取共享 + 三处 loading 换骨架 + 两处空态补 Title | 5 文件 | P1 | M | 消掉 3 类零件分流 |
| 5 | 输入框高度收敛（36→40，预设名字段→`awu-editInput`） | `styles.ts` + 2 子视图 | P1 | S | 同屏 2px 差错最刺眼 |
| 6 | 删除确认统一到 `DeleteDialog`（至少给模块/条目删除加确认或撤销） | 3 子视图 | P1 | M | 不可逆操作 |
| 7 | `data-motion` 降级方案（§8-S1），把子视图零件纳入 reduced-motion | `styles.ts` + 3 文件 | P1 | S | 越晚做越漏 |
| 8 | 蒸馏弹层换 `Overlay`（可给 `closable={!busy}`） | `distill.tsx` | P1 | M | 顺带修 P2-13 |
| 9 | 指南 680→`--awu-content-max`、居中、13px→`--awu-fs-body` | `guide.styles.ts` | P1 | S | 一屏阅读宽度 |
| 10 | P2 批量：手搓 X、内联 chevron、inline 工具类、notice 复用、死 CSS 清理、`--awu-dialog-w` 注释、`styles.ts` 反向引用 | 见 §2 | P2 | M | 建议和 2/3 同批提交 |

**不建议做**：为子视图引入 CSS Modules / Shadow DOM / 每模块独立 `<style>`（会破坏 §9-12 的集成契约，收益远小于代价）；给子视图列表加 34ms stagger（§7.3）。

---

## 附：证据清点（只读命令，可复现）

```powershell
# 行数
Get-Content client/<file> | Measure-Object -Line
# 类名总量 / 令牌用量
Select-String -Path client/styles.ts -Pattern '^\s*\.(awu-[A-Za-z0-9-]+)' -AllMatches | % { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique   # 278
# 写死字号（styles.ts = 0，两个子视图 = 25）
Select-String -Path client/*.styles.ts -Pattern 'font-size:\s*[0-9.]+px'
# 间距：token vs 写死 px
# styles.ts 178:19 / distill.styles.ts 0:23 / guide.styles.ts 0:9
# inline style 分布
Select-String -Path client/*.tsx -Pattern 'style=\{\{'   # preset 26 / preview 5 / lorebook 3 / card-editor 2 / diary 2 / distill 1
# 死属性
Select-String -Path client/styles.ts -Pattern 'awu-empty\[data-kind'   # 0 命中
Select-String -Path client/guide.styles.ts -Pattern 'data-tone'        # 0 命中
```
