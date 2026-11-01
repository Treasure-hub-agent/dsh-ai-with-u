# D · 无障碍 + 性能检查报告（dsh-ai-with-u · 客户端）

> 检查员：inspector-a11y（无障碍 + 性能）
> 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u`，HEAD `a7b5799`
> 阶段：**只读检查**（未改任何 client 文件、未跑 `npm run build`）
> 唯一写入：本文件。附带的 3 个度量脚本也在本目录（`_contrast.py` / `_scan_aria*.py` / `_bundle-analyze.mjs`），只读、不落产物。
> 先读的既有文档：`docs/design/2026-10-30-a11y-merge.md`、`docs/design/2026-10-30-visual-qa.md`、`docs/PLUGIN-DEV-GUIDE.md`。
> **本文不重报这两份文档已声明"已做"的项**，只复核它们是否还在、以及补它们没覆盖的部分。

---

## 0. 一页结论

| # | 结论 | 级别 |
|---|---|---|
| 1 | **全仓没有 ErrorBoundary**（无 `componentDidCatch` / `getDerivedStateFromError`）。面板是 `sidebar.footer.action` 的 slot entry，渲染抛错就是整块席位空白 | **P0** |
| 2 | `ImportDialog` 在「选文件」阶段的**校验错误从不渲染**（文件类型/大小/空文件）→ 用户拖错文件后界面毫无反应 | **P1** |
| 3 | 面板 `role="dialog" aria-modal="false"` 但**装了焦点陷阱**（`useFocusTrap(panelRef, open)`）→ 语义说"非模态"、行为是"模态"，键盘用户出不去 | **P1** |
| 4 | 关掉角色卡编辑器后**焦点落到 `body`**：编辑器把详情页整块替换，`useRestoreFocus` 记录的锚点已 `isConnected === false` | **P1** |
| 5 | `.awu-err` 红字压在红色 12% 底上：深色 **4.17:1** / 浅色 **4.33:1**，都低于 4.5 | **P1** |
| 6 | 4 处表单/结果错误**没有 `aria-live`**（新建角色、改写日记、忘记、蒸馏结果） | **P1** |
| 7 | 浅色主题玻璃 `alpha .54`：换到非白壁纸时 `ink-mute` **3.95:1**、语义色全线 **3.1–3.2:1** | **P1** |
| 8 | 键盘可用性底子很好：**全仓 0 个 `div/li + onClick`**、0 个图标按钮无名字、20+ 条 `:focus-visible`、世界书已有「上移/下移」按钮替代拖拽 | ✅ 别重做 |
| 9 | 性能热点不是"react 太慢"，是 **6 处 `backdrop-filter` 链式叠 + 常驻 `will-change`**；包体 359.9 KB 里 **CSS 占 35.3%、字典占 19.5%** | 见 §6 |

---

## 1. 焦点管理

### 1.1 `client/a11y.ts` 到底导出了什么、被谁用

| 导出 | 行 | 语义 | 调用点 |
|---|---|---|---|
| `useRestoreFocus(active = true)` | 109 | 激活瞬间记 `activeElement`，退活/卸载时还焦；锚点已 `isConnected === false` 或原本是 `body` 就跳过 | `index.tsx:235`（Overlay）、`:1879`（面板）、`card-editor.tsx:272`、`:275`、`distill.tsx:389`、`editor-focus.tsx:74` |
| `useInitialFocus(ref, active, selector?)` | 136 | `selector` → `[autofocus]` → 首个可见可聚焦 → 容器自身（补 `tabindex="-1"`） | `index.tsx:236`、`:1880`、`card-editor.tsx:273`、`:276`、`distill.tsx:390`、`editor-focus.tsx:75` |
| `useFocusTrap(ref, active)` | 175 | 只拦 `Tab`/`Shift+Tab`；`trapStack` 栈顶独占；Esc 明确留给调用方 | `index.tsx:237`、`:1881`、`card-editor.tsx:274`、`:277`、`distill.tsx:391`、`editor-focus.tsx:76` |

**死代码结论：`a11y.ts` 无死代码。** 三个 hook 全部有真实调用点，`FOCUSABLE` / `trapStack` / `stackTop` / `popTrap` / `warn` / `focusElement` / `currentFocus` / `visibleItems` 都被主流程用到。

> 另有**别处的死代码**（顺带记录，P2）：`styles.ts:3587` 导出 `SCOPED_ATTR = 'data-awu-scoped'`，`index.tsx:2585` / `:2629` 把它写进 DOM，但**三份 CSS 里没有任何 `[data-awu-scoped]` 选择器**；`styles.ts:843-877` 的整个 `.awu-body` 块（含 `::-webkit-scrollbar` 与 `::before` 滚动阴影）在 JSX 里已经没有任何 `.awu-body` 节点（面板改用 `.awu-pane` / `.awu-main`）——连同 `@supports (animation-timeline: scroll())` 里的 `.awu-body::before` 一起失效。

### 1.2 13 层浮层的焦点接线覆盖表（真实层数比"7 个 Dialog"多）

| 层 | 位置 | 还焦 | 初始聚焦 | Tab 陷阱 | Esc | 点遮罩 |
|---|---|---|---|---|---|---|
| 面板（非模态） | `index.tsx:2620-2641` | ✅ `:1879` | ✅ `:1880` | ⚠️ `:1881`（见 1.3） | ✅ `:2142-2148` | ✅ `:2127-2141` |
| `Overlay` 壳 | `index.tsx:216-277` | ✅ `:235` | ✅ `:236` | ✅ `:237` | ✅ `:239-251` | ✅ `:261-263` |
| ① NewCharacter | `:484` | 继承 Overlay | 自有 `:518` + Overlay | ✅ | ✅ | ✅ |
| ② Import | `:836` | 继承 | Overlay | ✅ | ✅ | ✅ |
| ③ Preview | `:3121` | 继承 | Overlay | ✅ | ✅ | ✅ |
| ④ Preset | `:3127` | 继承（`escYield`） | Overlay | ✅ | ✅（让位） | ✅ |
| ⑤ Delete | `:1138` | 继承 | Overlay | ✅ | ✅ | ✅ |
| ⑥ Mode | `:1186` | 继承 | Overlay | ✅ | ✅ | ✅ |
| ⑦ EditDiary | `:1246` | 继承 | 自有 `:1235-1240`（带 `setSelectionRange`） | ✅ | ✅ | ✅ |
| ⑧ Forget | `:1304` | 继承 | 自有 `:1297` | ✅ | ✅ | ✅ |
| ⑨ ResetAll / ⑩ ResetSession | `:1349` / `:3186` | 继承 | Overlay | ✅ | ✅ | ✅ |
| ⑪ Distill | `distill.tsx:483-491` | ✅ `:389` | ✅ `:390` | ✅ `:391` | ✅ `:425-433` | ✅ `:487` |
| ⑫ CardEditor | `card-editor.tsx:352` | ⚠️ `:272`（见 1.3） | ✅ `:273` | ✅ `:274` | ✅ `:318-331` | —（面板内） |
| ⑬ 未保存确认 | `card-editor.tsx:443` | ✅ `:275` | ✅ `:276` | ✅ `:277` | ✅ 同上（`:325-326`） | — |
| ⑭ 专注编辑层 | `editor-focus.tsx:124` | ✅ `:74` | ✅ `:75`（按 `readOnly` 选选择器） | ✅ `:76` | ✅ `:105-121` | — |

**结论：焦点三件套的统一性很好**——14 层全部走同一份 `a11y.ts`，没有各自手写 trap 的实现。嵌套栈我按 React effect 顺序核对过是**自洽的**：面板先压栈；子树（编辑器/弹层）后挂载再压栈 → 栈顶永远是内层；内层的 `active` 变化会重跑 effect 重新压栈（`card-editor.tsx:275-277` 的确认层就是这样拿到栈顶的）。**没有"外层弹层先抢栈"的 bug。**

### 1.3 三个真实缺口

#### 【P1】关掉角色卡编辑器后焦点落到 `body`（不是回到「编辑」按钮）

- 证据：`index.tsx:2646-2661` 用 `editing && currentDetail !== undefined ? <CardEditor/> : <>…详情页…</>` **整块替换**；`card-editor.tsx:272` 的 `useRestoreFocus(true)` 在挂载 effect 里读 `document.activeElement`——此刻「编辑」按钮已经在同一次 commit 里被卸载，浏览器已把焦点退回 `body`，于是 `a11y.ts:113` 的 `previous !== document.body` 判定为 false → `restoreTo = null` → **不还焦**。
- 影响：关掉编辑器后无焦点、无读屏位置。后续 `Tab` 会被面板陷阱兜回面板首元素（`a11y.ts:197-199`），所以"能用"，但用户失去了"回到刚才那个按钮"的连续性；对读屏用户等于失去上下文。
- 附带：`a11y-merge.md:247` 已把这条列为"本轮不做"。**现在它仍是当前行为。**
- 建议（S）：面板给「编辑」按钮固定 `id="awu-detail-edit"`；`CardEditor` 卸载后不依赖 `activeElement`，由面板在 `editing → false` 的 effect 里 `document.getElementById('awu-detail-edit')?.focus()`（面板自己知道"编辑态刚关掉"，比通用 hook 更准）。
- 同类（P2，一起修最省事）：`index.tsx:3002`（详情「返回」）、`:1420`（错误态「返回」）、`:3049`（日记加载失败「重试」）——按钮随内容替换而卸载，焦点同样落空。

#### 【P1】面板是 `aria-modal="false"` 却装了 Tab 陷阱

- 证据：`index.tsx:2626-2627` `role="dialog" aria-modal="false"`；同一组件 `:1881` `useFocusTrap(panelRef, open)`。`panelRef` 只包 `.awu-panel`，触发按钮 `.awu-trigger`（`:2587`）在它外面（`layerRef` 下），所以 **Tab/Shift+Tab 永远走不到触发按钮和宿主 UI**。
- 遮罩也不是真元素：`styles.ts:461` 用 `box-shadow: 0 0 0 100vmax var(--awu-scrim-bg)` 伪造压暗层，DOM 里没有可点的 scrim；点外部关闭靠 `document` 的 `pointerdown`（`index.tsx:2127`）。
- 影响：行为是完整模态（Esc 关、点外面关、Tab 出不去），语义却告诉读屏"非模态"——读屏用户仍能虚拟光标浏览背景内容，与键盘行为矛盾；`a11y-merge.md:235-236` 当初的设计是"面板不加陷阱、Tab 必须能走出去"，现在**实现走反了**。
- 建议（S，二选一，推荐 A）：
  - **A**：承认它就是模态 → `aria-modal="true"`；面板已有 `aria-label`、Esc、关闭按钮，符合模态契约。
  - **B**：真的要非模态 → 删掉 `:1881` 的 `useFocusTrap`，把 `Tab` 放出去。**不要保持现状。**

#### 【P2】非模态/视图切换处没有"焦点搬家"约定

- `index.tsx:2991-3017`：点卡片 → 右栏从空态换成详情，焦点留在左侧卡片上 ✅（这点是对的）；
- 但 `:3019-3058` 日记 tab 的内容是"选中/未选中"两态切换，切 tab 后焦点留在 tablist（正确），内容区不抢焦点（正确）——**这里没问题，记一句避免后人误改**。

---

## 2. 键盘可达

### 2.1 可点击元素是不是真 button —— 结论：**是，100%**

扫描全部 `client/*.tsx`（正则 `<div|li|ul|span|aside|section|p|td|tr|a` 且同标签带 `onClick`）：

```
=== 非 button 元素上绑 onClick（div/li/span/aside/td…）===
（无输出）
```

- **0 处** `div/li/span + onClick`。列表项也都是真 `<button>`：角色卡 `index.tsx:437`、日记行改写 `:389`/`diary-review.tsx:296`、预设行 `preset-view.tsx:596`、世界书条目头 `lorebook-editor.tsx:131`、月份折叠 `diary-review.tsx:275`、模块启用开关 `preset-view.tsx:1006`、分段器 `index.tsx:2863`。
- 列表语义处也用原生元素：`<ol>` 蒸馏步骤（`distill.tsx:512`）、`<ul>` 导入警告（`index.tsx:1072`、`preset-view.tsx:1353`）、`<details>/<summary>` 世界书高级项（`lorebook-editor.tsx:298`、`:608`）。
- 这意味着 **"role+keydown 手搓按钮"这类问题在本仓不存在**，Tab 顺序由浏览器原生给出，这是很大的一块已做好的工作。

### 2.2 快捷操作覆盖

| 操作 | 覆盖情况 | 证据 |
|---|---|---|
| Enter 提交 | 新建角色 3 个输入框 ✅、忘记关键词 ✅ | `index.tsx:613-615` + `:648/:658/:668`、`:1319` |
| Enter 提交（多行） | 改写日记用 **Cmd/Ctrl+Enter**（合理，多行不能说 Enter 就提交）✅ | `index.tsx:1262-1264` |
| Cmd/Ctrl+Enter | 专注编辑层 ✅ | `editor-focus.tsx:113-117` |
| Esc 关闭 | 14 层全有 ✅（面板 `:2145`、Overlay `:241`、编辑器 `:320`、专注层 `:107`、蒸馏 `:427`） | 见 §1.2 表 |
| Esc 让位（嵌套不连关两层） | ✅ 显式做了：`Overlay` 的 `escYield`（`index.tsx:228`、`:244`）、`CardEditor` 的 `loreFocus` 守卫（`card-editor.tsx:323`）、`FocusEditor` 的 `stopPropagation`（`editor-focus.tsx:108`） | 这是最容易写错的地方，本仓写对了 |
| 方向键 · 分段控件 | ✅ 左/右循环 + Home/End + roving tabindex + 修饰键让路 | `index.tsx:2556-2577`、`:2861-2877` |
| 方向键 · 列表移动 | ❌ **全仓 0 处**。角色卡网格、日记时间线、预设列表、世界书条目列表都只能逐个 Tab | grep `ArrowUp|ArrowDown` 全仓仅 `:2570`（tablist 的左右） |
| 拖放上传的键盘替代 | ✅ 导入弹层把原生 `<input type="file">` **留在 DOM 里可见可聚焦**（不是 `display:none`），`styles.ts:3337-3346` 明确写了理由；另有「选择文件」按钮（`index.tsx:985-993`） | 面板级/遮罩级的 `onDrop` 只是"吞掉文件防误发"（`index.tsx:2635-2640`、`Overlay:264-269`），不承载上传功能，所以不需要键盘等价 |
| 重排的键盘替代 | ✅ 世界书条目有「上移/下移」按钮 + 每行 `aria-label` 带条目名 | `lorebook-editor.tsx:168-187` |

> 列表方向键（P2，M）：这一步不做也不算 violation（原生 Tab 可达），但对"上百条世界书条目"的编辑体验差别很大。若做，只做世界书条目列表一处即可（`lorebook-editor.tsx:131` 的行头是现成的 button，加 `role="listbox"` 会破坏太多次结构，**建议只做"上/下箭头 = 移动到相邻条目头"的快捷键，不动语义**）。

---

## 3. 语义与标签

### 3.1 图标按钮的 aria-label / title 覆盖：**基本全绿**

「真·图标按钮」（body 里无文字、只有 `<Icon/>` 或 `<svg/>`）全量扫描结果只有 7 个，其中 **6 个同时有 `aria-label` + `title`**：

| 位置 | aria-label | title | 判定 |
|---|---|---|---|
| `card-editor.tsx:366`（关闭编辑器） | ✅ | ✅ | 好 |
| `distill.tsx:495`（关闭蒸馏） | ✅ | ✅ | 好 |
| `index.tsx:2687`（刷新面板） | ✅ | ✅ | 好 |
| `index.tsx:2813`（关提示条） | ✅ | ✅ | 好 |
| `lorebook-editor.tsx:188`（删条目，带条目名） | ✅ | ✅ | 好 |
| `preview.tsx:129`（刷新注入预览） | ✅ | ✅ | 好 |
| **`index.tsx:2756`（换开场白）** | **❌** | ✅ | **唯一缺口** |

**「有图标无标签」的完整清单就是上面这 1 条**（`index.tsx:2756`，`<IconRefresh/>` 单独在按钮里，只有 `title`）。可访问名会退化成 `title`，读屏仍能念出「换一个开场白」，但 `title` 不保证在所有 AT 上稳定（且触屏无 hover）。
- 建议（S）：补 `aria-label={t('opening.next')}`。
- 顺带：`index.tsx:2745`（切模式）是图标+`title`，同款风险，一起补。

### 3.2 表单 label 关联

| 表单 | 关联方式 | 判定 |
|---|---|---|
| 新建角色 姓名/身份/一句话 | `htmlFor` + `id`（`index.tsx:639/640-641`、`:650/651`、`:660/661`） | ✅ |
| 忘记关键词 | `htmlFor="awu-forget-kw"`（`index.tsx:1311`/`1313`） | ✅ |
| 蒸馏手动指令 | `htmlFor="awu-distill-manual"`（`distill.tsx:538`/`540`） | ✅ |
| 预设名 / 预设导入 JSON | `htmlFor`（`preset-view.tsx:872`、`:1294`） | ✅ |
| 编辑器 34 个字段 | 隐式 `<label className="awu-editField">` 包住控件（`card-editor.tsx:202-223`） | ✅（隐式关联合法） |
| 世界书多字段 | 隐式 label；内容框因标题行有按钮改用 `aria-label`（`lorebook-editor.tsx:262-263`，注释已说明） | ✅ |
| 日记搜索框 | 无可见 label，用 `aria-label`（`diary-review.tsx:229`） | ✅（可接受） |
| **导入文件 `<input type="file">`** | **无 label、无 aria-label**（`index.tsx:994-1001`，`id="awu-import-file"` 没人引用） | **P2** |
| 编辑器列表字段 | `<label>` 里塞了 N 个 textarea + 删除按钮（`card-editor.tsx:202` 包 `ListField:122-153`）。HTML 规定 label 只关联**第一个**可关联后代；第 2 条起靠自带的 `aria-label`（`:135`）兜住，第 1 条被 `aria-label` 覆盖 | P2（不报错，但语义脏） |

- 建议（S）：给 `index.tsx:994` 的 file input 加 `aria-label={t('import.pick')}`；`ListField` 的容器从 `<label>` 降级成 `<div>`（它已经自带 aria-label，不需要外层 label）。

### 3.3 aria-live：提示/错误/保存成功到底会不会被念出来

| 场景 | 现状 | 判定 |
|---|---|---|
| 面板提示条（保存成功/软警告） | `role="status" aria-live="polite"`（`index.tsx:2803-2822`） | ⚠️ 见下方"挂载即内容"问题 |
| 面板错误条 | `role="alert"`（`ErrorBar`，`index.tsx:321`） | ✅ |
| 骨架屏 | `role="status"` + 视觉隐藏文案（`index.tsx:308-311`） | ✅ |
| 导入：解析中 / 解析错误 / 冲突 / 正则屏蔽 / 拖到框外提示 | 都有 `role="status"` / `role="alert"` / `aria-live`（`:1004`、`:1017`、`:1021`、`:1025`、`:1039`、`:1053`） | ✅ |
| 预设：加载中 / 错误 / 重提示 / 重量确认 | ✅（`preset-view.tsx:567`、`:575`、`:581`、`:866`、`:954`、`:1329`、`:1347`） | ✅ |
| 注入预览：加载/错误 | ✅（`preview.tsx:147`、`:153`） | ✅ |
| 世界书问题清单 | `role="status" aria-live="polite"`（`lorebook-editor.tsx:548`） | ✅（但 `role="status"` 会覆盖 `<ul>` 的列表语义，P2） |
| 开场白轮换结果 | `role="status"`（`index.tsx:2737`） | ✅ |
| **新建角色：校验/保存失败** | `<div className="awu-hint" style={{color: danger}}>`（`index.tsx:695`）**无 role** | ❌ **P1** |
| **改写日记：保存失败** | 同上（`index.tsx:1266`） | ❌ **P1** |
| **忘记：关键词必填/失败** | 同上（`index.tsx:1321-1323`） | ❌ **P1** |
| **蒸馏：发送结果（成功/失败原文）** | `<div className="awu-distill-status">`（`distill.tsx:526-532`）**无 role** | ❌ **P1** |
| 日记搜索命中数 | `.awu-reviewHits`（`diary-review.tsx:234`）无 live | P2 |
| 编辑器未保存状态 | `.awu-editorDirty`（`card-editor.tsx:424`）纯视觉，无 live | P2（可接受，`aria-busy`/标题已够） |

**⚠️ "挂载即内容"问题（P2，值得记）**：保存成功走的就是上面那条 `notice`，但 `setEditing(false)` 与 `notifySaved(...)` 在**同一次 commit**（`index.tsx:2360-2361`）里发生——live region 是**和内容一起插进 DOM** 的。主流读屏（NVDA/JAWS/VoiceOver）对"插入时就有内容的 live region"通常**不播报**（只播报已存在区域的后续变化）。同理 `dialog === 'new'` 的提示在弹层关闭后重新挂载也有这个风险。
- 建议（S）：把 `notice` 容器**常驻**在面板根（`:2802` 附近）渲染，只切换内部文本；空字符串时留一个空 `<span>`。这是一行改动、收益很大。

### 3.4 标题/列表/图片

- **标题层级缺失（P2）**：全仓只有 `guide.tsx:43` 一个 `<h3>`。面板标题是 `<div className="awu-title">`（`index.tsx:2667`）、详情分组是 `<div className="awu-sectionHead">`（`index.tsx:359`）、`<section className="awu-editGroup">` 无标题元素（`card-editor.tsx:172`）。**读屏用户无法按标题跳转**（H 键失效），10 屏长的编辑器只能从头 Tab。
  - 建议（M）：`.awu-title` → `<h1>`（视觉不变，`styles.ts:609` 已有 `.awu-title` 样式）；`Section` 的 `sectionHead` → `<h2>`；`FieldGroup` 的标题 → `<h2>`/`<h3>`。纯标签替换，CSS 里 `.awu-title` / `.awu-sectionHead` / `.awu-editGroupTitle` 都按类选，不会掉样式。
- **列表语义**：警告/问题用真 `<ul>/<li>` ✅；角色卡网格用 `.awu-grid` + button 列表（可接受，但 `role="list"` 能让读屏报"3 项"）；日记时间线 `.awu-diary/.awu-day/.awu-line` 是纯 div（P2，无列表语义，读屏不会报总条数）。
- **图片/头像 alt**：全仓**没有 `<img>`**，头像是文字字形块，已 `aria-hidden="true"`（`index.tsx:294`、`icons.tsx:29` 的 `IconAlert` 等同步处理）✅。名字本身在相邻文本里，不会丢信息。**这条已做得好，别重做。**

---

## 4. 对比度（含算式，不抄注释）

### 4.1 方法

WCAG 2.x 相对亮度 + 正常文本 4.5:1 / 大字与图形 3:1。玻璃是半透明的，所以必须先把"玻璃叠在什么底上"合成出来，再把半透明文字叠上去：

```
合成：C_out = α·C_top + (1-α)·C_bottom          （逐通道，sRGB 直通 alpha）
亮度：L = 0.2126·f(R) + 0.7152·f(G) + 0.0722·f(B)
      f(c) = c/12.92                    , c ≤ 0.04045
      f(c) = ((c+0.055)/1.055)^2.4      , c > 0.04045
比值：(L_亮 + 0.05) / (L_暗 + 0.05)
```

**手算示例（深色主题 `--awu-ink-mute` 压在面板上，宿主深色画布 `#1c1c1e`）**：

```
① 面板底 = 0.66·(20,20,24) + 0.34·(28,28,30) = (22.72, 22.72, 26.04) → rgb(23,23,26)
② 文字色 = 0.68·(235,235,245) + 0.32·(22.72,22.72,26.04) = (167.07, 167.07, 174.93)
③ L(底)：22.72/255=0.0891 → ((0.0891+0.055)/1.055)^2.4 = 0.00840
          26.04/255=0.1021 → ((0.1021+0.055)/1.055)^2.4 = 0.01035
          L = 0.9278·0.00840 + 0.0722·0.01035 = 0.00854
④ L(字)：167.07/255=0.6552 → 0.3868 ；174.93/255=0.6860 → 0.4284
          L = 0.9278·0.3868 + 0.0722·0.4284 = 0.38982
⑤ 比值 = (0.38982+0.05) / (0.00854+0.05) = 0.43982 / 0.05854 = 7.51 : 1
```

（完整矩阵由 `_contrast.py` 一次算出，下面直接引用它的输出。）

### 4.2 实测矩阵：深色主题（面板 = `rgba(20,20,24,.66)`）

| 前景 | 叠在**深色画布 `#1c1c1e`**（真实场景） | 叠在**中灰壁纸 `#808080`** | 叠在**白底**（极端） |
|---|---|---|---|
| `--awu-ink` `#f2f2f7` | **16.07** | 10.36 | 5.30 |
| `--awu-ink-dim` `.82` | **10.44** | 7.17 | 3.96 ❌ |
| `--awu-ink-mute` `.68` | **7.51** | 5.49 | 3.26 ❌ |
| `--awu-ink-faint` `.30` | 2.47（仅装饰） | 2.29 | 1.78 |
| `--awu-accent` `#0a84ff` | 4.92 | 3.17 ⚠️ | 1.62 ❌ |
| `--awu-accent-strong` `#0a6fe0` | 3.73（作填充/图形够 3:1） | 2.40 ❌ | 1.23 ❌ |
| `--awu-accent-text` `#5ab0ff` | 7.76 | 5.00 | 2.56 ❌ |
| `--awu-gold` `#e8c07a` | 10.46 | 6.75 | 3.45 |
| `--awu-teal` `#30d158` | 8.87 | 5.72 | 2.92 |
| `--awu-danger` `#ff6b61` | 6.43 | 4.15 ⚠️ | 2.12 ❌ |
| 白字 on `accent-strong` 填充 | **4.81 ✅** | 4.81 | 4.81 |
| `danger` 字 on `.awu-err` 底（12% 红 + glass-2） | **4.17 ❌** | 3.22 ❌ | 2.31 ❌ |
| `gold` 字 on `pill[live]` 底 | 6.15 | 4.73 | 3.40 ❌ |
| `teal` 字 on `pill[teal]` 底 | 5.46 | 4.21 ❌ | 3.03 ❌ |

### 4.3 实测矩阵：浅色主题（面板 = `rgba(255,255,255,.54)`）

| 前景 | 叠在**白底** | 叠在**偏亮壁纸 `#d8d8dc`** | 叠在**中灰壁纸 `#808080`** |
|---|---|---|---|
| `--awu-ink` `#1c1c1e` | 17.01 | 14.56 | 9.81 |
| `--awu-ink-dim` `.88` | 7.59 | 6.71 | **4.89**（勉强） |
| `--awu-ink-mute` `.78` | 5.63 | 5.11 | **3.95 ❌** |
| `--awu-ink-faint` `.30` | 1.73（仅装饰） | 1.69 | 1.59 |
| `--awu-accent` `#007aff` | 4.02 ⚠️ | 3.44 ⚠️ | 2.32 ❌ |
| `--awu-accent-text` `#0066cc` | 5.57 | 4.76 | 3.21 ❌ |
| `--awu-gold` `#8a5f1e` | 5.62 | 4.81 | 3.24 ❌ |
| `--awu-teal` `#1e7a33` | 5.40 | **4.62** | 3.12 ❌ |
| `--awu-danger` `#d70015` | 5.38 | 4.61 | 3.11 ❌ |
| `danger` 字 on `.awu-err` 底 | **4.33 ❌** | 4.13 ❌ | 3.70 ❌ |
| `gold` 字 on `pill[live]` 底 | 4.77 | **4.56** | 4.10 ❌ |
| `teal` 字 on `pill[teal]` 底 | **4.58** | **4.37 ❌** | 3.93 ❌ |

### 4.4 注释里的标称比值 vs 复算：**数字没算错，但对应的是另一块底**

| token（注释行） | 注释标称 | 我的复算 | 结论 |
|---|---|---|---|
| `--awu-ink` 深 `#f2f2f7`（`styles.ts:79`） | 12.49 | 深画布 **16.07** / 中灰壁纸 10.36 | 注释隐含底亮度 ≈0.0254（约 `#2e2e2e`），**不是当前 `.66` 玻璃叠深画布**（0.0085）→ 注释偏保守 |
| `--awu-ink` 浅 `#1c1c1e`（`:228`） | 16.44 | 白底 **17.01** / `#f6f6f8` 15.76 | 基本对得上 ✅ |
| `accent-strong` 白字（`:97`） | 4.81 | **4.81** | **完全对上** ✅（`#0a6fe0` 不透明填充） |
| `accent` 作文字（`:98`） | 3.82 | 4.92（当前面板）/ 3.17（中灰壁纸） | 口径不同，但"当文字不达标"的判断是对的 ✅ |
| `accent-text` 深 `#5ab0ff`（`:98`） | 6.03 | **7.76** | 注释偏保守 |
| `--awu-gold` 深（`:105`） | 8.13 | **10.46** | 隐含底 ≈0.0254（与 ink 12.49 同底，说明是一次同批测量） |
| `--awu-gold-hi` 深（`:106`） | 10.32 | 13.28 | 同上，偏保守 |
| `--awu-teal` 深（`:112`） | 6.89 | 8.87 | 隐含底 ≈0.046 —— **与 ink/gold 的 0.0254 不是同一块底** |
| `--awu-danger` 深（`:113`） | 5.00 | 6.43 | 隐含底 ≈0.0465 |
| `--awu-rose` 深（`:114`） | 5.47 | 7.03 | 隐含底 ≈0.0465 |
| `--awu-pink` 深（`:115`） | 8.26 | 10.63 | — |
| `--awu-gold` 浅 `#8a5f1e`（`:245`） | 5.43 | 白底 5.62 / `#f6f6f8` 5.21 / 中灰壁纸 **3.24** | 只对"近白底"成立 |
| `--awu-teal` 浅 `#1e7a33`（`:251`） | 4.62 | 白底 **5.40** / `#f6f6f8` 5.01 / 中灰壁纸 **3.12** | 隐含底亮度 ≈0.766（≈`#e2e2e2`）—— **与 danger 的隐含底 0.964 不是同一个底** |
| `--awu-danger` 浅 `#d70015`（`:252`） | 5.20 | 白底 5.38 / `#f6f6f8` 4.99 | 隐含底 ≈0.964 |

**结论两点**（这是本节最该带走的）：
1. **注释里的比值彼此不自洽**（ink/gold 隐含底亮度 0.025、teal/rose 0.046、teal 浅 0.766、danger 浅 0.964），说明它们是**分批在不同底色上量的**。这些数字**不能当验收基线**用——尤其浅色那两颗（`gold 5.43` / `teal 4.62`）只在近白底成立，一旦壁纸不是白的就跌破 4.5。
2. **真正的失败区不在注释覆盖的范围内**：注释里一个都没提"语义色文字压在同色 12% 底上"这种组合，而它恰好是最常出现的错误提示样式。

### 4.5 实际不达标的组合清单（可直接派活）

| # | 组合 | 位置 | 实测 | 要求 | 级别 |
|---|---|---|---|---|---|
| C1 | `danger` 字 + 12% 红底。**同一个构造有两处**：`.awu-status[data-status="alert"]`（错误条）与 `.awu-err`（行内错误块），都是"红字压红色 12% + surface-2 的底" | `styles.ts:758-760`（错误条）、`styles.ts:1985-1989`（行内错误块）；渲染于 `index.tsx:321`、`:1025`、`card-editor.tsx:387` | 深 4.17 / 浅 4.33 | 4.5（14px 正文） | **P1** |
| C2 | `teal` 字 + 12% 青底（`pill[teal]`，记忆数） | `styles.ts:1199-1200` | 浅 4.58 → 壁纸下 4.37 | 4.5（12px） | **P1** |
| C3 | `gold` 字 + 12% 金底（`pill[live]`「启用中」） | `styles.ts:1193-1195` | 浅 4.77 → 4.56 → 4.10 | 4.5（12px） | P2 |
| C4 | 浅色主题 `ink-mute` 小字压非白壁纸 | 全局（`.awu-fieldKey`:1555、`.awu-hint`:2511、`.awu-kicker`:592…） | 3.95 | 4.5 | **P1** |
| C5 | 浅色主题 `accent` 当文字（`.awu-title em`:612 用的是 `accent-text`，但 `.awu-navBack`:1314 也是 `accent-text`；**`--awu-accent` 目前只作装饰**） | `styles.ts:612` | accent-text 5.57 白底 → 3.21 中灰壁纸 | 4.5 | P1（同 C4，同一根因） |
| C6 | 深色主题遇上浅色宿主背景（壁纸/主题插件） | 全局 | `ink-dim` 3.96、`ink-mute` 3.26 | 4.5 | P2（需真机确认宿主是否会透浅底） |
| C7 | `--awu-ink-faint` 作文字 | **无**（只用于 `.awu-countSep:647` 的「·」、`.awu-cardChevron:1141`、`.awu-editGroupChevron:2176`、`.awu-detailNavTitle::before:1344`，全部装饰或 `aria-hidden`） | 1.7–2.5 | — | ✅ **纪律守住了，别改** |

- 建议（C1/C2/C3，S）：**不要靠调 token**（`danger/teal/gold` 在纯底上都是 5 分以上，动了会伤主场景）。改法是把"12% 同色底"换成中性底 `--awu-surface-2`（或把文字色提到 `ink-dim`），红色/青色只留在描边 + 圆点上。
- 建议（C4/C5，M）：浅色面板把 `--awu-glass-1` 从 `.54` 提到 `.66~.72`，或给面板加一层 `rgba(255,255,255,.25)` 的"内衬"。**注意**：这会牺牲主人要的"透亮"，所以更好的做法是**只给文字容器**加不透明衬底（`.awu-card` 已是 `.68`，问题主要在"直接压在面板底上的小字"：`.awu-kicker`、`.awu-fieldKey`、`.awu-hint`）。

---

## 5. 降级路径

### 5.1 `prefers-reduced-motion`：差集（用脚本把三份 CSS 里所有 `animation:` / `transition:` 选择器抽出来，与 `styles.ts:3542-3565` 的降级块对齐）

**动画（`animation:`）来源 18 处，降级块覆盖 15 处，漏 3 处：**

| 漏掉的选择器 | 行 | 关键帧 | 影响 |
|---|---|---|---|
| `.awu-pane::before`（滚动阴影） | `styles.ts:864-877`（在 `@supports (animation-timeline: scroll())` 里，与死掉的 `.awu-body::before` 共用一条规则） | `awu-scroll-hint`（scroll timeline） | 减弱动效用户在滚动时仍有 24px 行程的透明度动画；P2 |
| `.awu-editGroupBody` | `:2229` | `awu-fade` 120ms | 展开分组时的淡入；P2（可接受） |
| `.awu-presetHeavyConfirm` | `:3184` | `awu-fade` 120ms | 同上；P2 |

**已覆盖、不要重做**：`.awu-panel` / `.awu-card` / `.awu-card[data-live]` / `.awu-detail` / `.awu-dialog` / `.awu-editor` / `.awu-editorConfirm` / `.awu-scrim` / `.awu-focus` / `.awu-skRow`（骨架 shimmer）/ `.awu-status[data-status=live]::after` / `.awu-sigil::after`（扫光）/ `.awu-panel[data-busy] .awu-head::after`（进度条）/ `.awu-trigger[data-live] .awu-mark::after`（呼吸）/ `.awu-avatar[data-live]::after` / `.awu-lamp[data-on]`（脉冲）/ `.awu-iconBtn[data-spin] svg`（转圈）。**9 个 `@keyframes` 里 8 个都在降级名单内，这一块做得比大多数项目细。**

**过渡（`transition:`）只覆盖了 8 个类**（`:3562-3564`：`.awu-card/.awu-trigger/.awu-btn/.awu-tab/.awu-input/.awu-line/.awu-iconBtn/.awu-navBack`），**漏掉的全部是颜色/透明度过渡**（`.awu-modePill`、`.awu-noticeClose`、`.awu-lineEdit`、`.awu-editListRemove`、`.awu-editGroup*`、`.awu-loreRowFlag`、`.awu-importDrop`、`.awu-presetModuleBody`、`.awu-editorTab`、`.awu-chipInput` 等 20+ 处）。
> 这一条**不建议全补**：WCAG 2.3.3 管的是"运动"，颜色渐入不触发前庭反应。但其中有 **3 处带位移**必须补：`.awu-cardChevron`（`:1142`，hover 时 `translateX(2px)`）、`.awu-editGroupChevron`（`:2177`）、`.awu-card:hover` 的 `translateY(-2px)`（已在 `:3564` 用 `transform: none` 兜住 ✅）。
> 建议（S）：在 `:3562` 的名单里补 `.awu-cardChevron, .awu-editGroupChevron`，或在降级块里加一条 `*{transition-duration:.01ms!important}`（更狠但一劳永逸，副作用是"按下无回弹"）。

**inline 动画**：`.tsx` 里只有 `index.tsx:441` 的 `animationDelay`（`CARD_STAGGER` 错峰），它只改延迟、不新建动画，且父选择器 `.awu-card` 已在降级名单 → **无漏**。三份 `.styles.ts` 里唯一的额外降级是 `distill.styles.ts:232`（`.awu-distill-bar > span { transition: none }`）✅。

### 5.2 `prefers-reduced-transparency`：有，但覆盖面窄

- 现状：`styles.ts:3529-3540` 只处理 `.awu-panel, .awu-dialog, .awu-focus, .awu-editorConfirmCard` → 换成 `--awu-surface-opaque` + `backdrop-filter: none` ✅（这条是真修过的，`visual-qa.md:60-70` 有记录）。
- **漏**：`.awu-card`（glass-2 `.68`）、`.awu-input`/`.awu-textarea`、`.awu-btn`、`.awu-tab`、`.awu-trigger`、`.awu-editorFoot`、`.awu-scrim`（`.16/.36` 压暗层）。也就是说"关掉透明"后，**卡片和输入框仍然是半透明玻璃**，只是面板变实——用户的诉求只被满足了一半。
- 建议（S）：把 `.awu-card, .awu-input, .awu-textarea, .awu-btn, .awu-tab, .awu-editorFoot, .awu-trigger` 一并纳入同一块（`background-image: none; background-color: 中性实心; backdrop-filter: none`）。

### 5.3 `prefers-contrast`：**完全没有**

- 证据：三份样式文件 grep `prefers-contrast` → 0 命中。
- 影响：Windows 高对比度模式 / macOS 增强对比度用户拿到的仍是半透明玻璃 + `ink-mute` 小字。虽然 WCAG 不强制，但这是"降级路径"清单里唯一整块缺失的媒体查询。
- 建议（M）：`@media (prefers-contrast: more)` 里把 `--awu-ink-dim/--awu-ink-mute` 提到与 `--awu-ink` 同级、`--awu-glass-1/2` 提到 `.85+`、`--awu-line` 提到 `.35`。**不用逐条改选择器**，因为它全部走 token。

### 5.4 200% 缩放 / 系统字体放大 / 窄窗

| 场景 | 现状 | 判定 |
|---|---|---|
| 200% 页面缩放 | 面板 `width: min(1120px, calc(100vw - 32px))` + `height: calc(100vh - 80px)`（`index.tsx:2544-2554` / `styles.ts:446-448`），内容在 `.awu-pane` 内滚动 → 不裁字 | ✅ 可用 |
| **系统字体放大（浏览器默认字号）** | 字号全部是 **px**（`--awu-fs-*`，`styles.ts:130-138`），不跟随根字号 → **完全无效** | P2（取舍，见下） |
| **内联 px 字号绕过 token** | 10.5px ×3（`index.tsx:1250`、`:3090`、`preset-view.tsx:852`）、11px ×1（`index.tsx:2738`）、12.5px ×1（`:1208`）；另 `index.tsx:1209` 用 `opacity: 0.78` 压 10.5px 文本 | P2（10.5px 已低于自己的 `--awu-fs-micro: 11px` 下限） |
| 窄窗 **900** | 有断点：`styles.ts:564-570`（两栏收单栏）、`:1453-1456`（hero 三钮等宽）、`:2691-2693`（世界书拆栏收单列） | ✅ |
| 窄窗 **720 / 560** | **没有任何断点**（三份 CSS 的 `@media` 只有 900 与两个 prefers-*）。560px 下靠 `min(…,100%)` 与 `flex-wrap` 硬撑：`.awu-ctaRow` 两颗 CTA + 两行 hint 会挤、`.awu-tabs` 四个 tab 各 ~120px 尚可、`.awu-dialog` 收到 `min(620,100%)` 尚可 | P2（无实测截图，`visual-qa.md:335` 也承认"窄屏没有真机验证"） |

- 关于"系统字体放大不生效"：这是插件嵌在宿主页面里的**已知取舍**（用 rem 会被宿主根字号影响，且宿主不保证 `html { font-size }`）。**不建议为它改全局单位**，但应保证"最小字号 ≥12px 且能被 zoom 放大"——即先把 §5.4 里的 10.5/11px 内联值并回 12px token。

---

## 6. 渲染性能

### 6.1 `CharacterPanel` 一次 render 的规模（实测计数）

```
CharacterPanel  useState(16)  useEffect(15)  useMemo(4)  useCallback(8)  useRef(4)
+ useWideLayout   useState(2)  useEffect(2)   ← index.tsx:1721-1760
```

16 个 state 意味着**任何一次 `setState` 都会让整棵树重渲染**：`busy`、`notice`、`openingNote`、`detailLoading`、`dialogError` 任何一个变化都会重跑 `:2580-3202` 的整块 JSX。

### 6.2 每次 render 重建的对象/数组（`useMemo` 漏点）

| 位置 | 重建内容 | 影响 |
|---|---|---|
| `index.tsx:2544-2554` | `panelStyle` 字面量对象 | 传给 `.awu-panel` 的内联样式，React 每次 diff，**可忽略**（不修） |
| `index.tsx:2558-2563` | `TAB_IDS` 数组 | 同上，可忽略 |
| `index.tsx:3105` | `existing={list.map(item => item.name)}` | **每次 render 新建数组**传给 `NewCharacterDialog` → 该弹层 props 永远"变"，无法 memo（弹层打开时才有意义，P2） |
| `index.tsx:2400/2404/2473` | `roster` / `stats` / `diaryRelation` | ✅ 已 `useMemo`，**这里做对了** |
| `index.tsx:2433-2464` | `detailSaysBoundHere` / `isBoundHere` 函数 | 每次重建，但只在 render 内部同步调用，**无影响** |
| `index.tsx:2579+` | 所有 `onCancel={() => setDialog('')}` 等箭头 | 内联箭头让子组件 props 每次变；配合"子组件未 memo"就是全量重渲染 |

**最关键的一条：`CharacterTile`（`index.tsx:424`）没有 `React.memo`，全仓也 0 处 `React.memo`（grep 确认）。** 每次面板 render → N 张卡片全部重渲染，每张都重算 `roleOf` / `blurbOf` / `relativeDay`（`:433-435`）。3 张卡无感，30 张卡 × 每 5 秒轮询一次就有感了。
- 建议（S）：`const CharacterTile = memo(function CharacterTile(...))`，并把 `onOpen={setDetailName}`（`:2974`，引用天然稳定 ✅）之外的两个不稳定 prop 收一下——实际上 `busy` / `live` / `t` 都稳定，**只需 `memo` 一次即可全绿**。

### 6.3 编辑器：每次击键的真实代价

- `card-editor.tsx:279` `isDirty(card, draft)` 与 `:287-290` `mergeCard(card, draft) + filledCount` 都依赖 `draft` → **每敲一个字**：一次深比较 + 一次全卡合并 + 34 字段遍历。`loreDirty`（`:280`）在改世界书时还多一次整份 `JSON.stringify`。
- `card-editor.tsx:70-75` `TextField` 的自适应高度：每次 `value` 变化都 `el.style.height='auto'` 再读 `el.scrollHeight` → **强制同步布局（layout thrash）**，而它在 `<input>`/`<textarea>` 里逐个触发。长文本字段打字时这是最贵的一步。
  - 建议（S）：用 `requestAnimationFrame` 合帧，或只在 `scrollHeight` 超过当前高度时增长（`if (el.scrollHeight > el.clientHeight)`），避免每个字符都回流一次。
- 注：`editor-focus.tsx` 的"整屏长文本编辑层"正是为解决"打字时整树重渲染"而做的（文件头注释已说明），**这个设计是对的，别重做**。剩下的痛点是"普通字段仍然走全量合并"，属于可接受范围（P2，M：给 `FieldGroup` 加 `memo` + 把 `mergeCard` 移到 `save()` 时算）。

### 6.4 滚动区是否会触发全量重绘

- 两个滚动容器：`.awu-pane`（`styles.ts:509+`）与 `.awu-editorBody`，都只设 `scrollbar-color`，**没有 `backdrop-filter`** → 滚动本身不触发滤镜重算 ✅。
- 但 `.awu-pane::before` 的 **scroll-timeline 动画**（`:864-877`）在滚动时持续改 `opacity`，会强制每帧一次合成；影响很小（1px 高的条），P2。
- **真正的重绘来源是叠起来的 6 处 `backdrop-filter`**：

| 元素 | 行 | 半径 | 面积 |
|---|---|---|---|
| `.awu-trigger` | `:297` | `blur(30px) saturate(180%)` | 小 |
| `.awu-panel` | `:457` | `blur(18~20px) saturate(185%)` | **1120×~820 大面积** |
| `.awu-scrim` | `:2451` | `blur(6px)` | **全视口** |
| `.awu-dialog` | `:2468` | `blur(30px) saturate(180%)` | 620×~600 |
| `.awu-editorFoot` | `:2369` | `blur(30px)` | **1120×~50 全宽条** |
| `.awu-editorConfirmCard` | `:2416` | `blur(30px)` | 420 宽 |
| `.awu-focus` | `:2590` | `blur(30px)` | 面板全屏 |

  弹层打开时是**链式三层**：面板(18px) 被 scrim(6px) 采样、scrim 被 dialog(30px) 采样 → 每次 sheet 入场动画（`awu-sheet-in` 340ms）要跑 3 个全屏级滤镜通道。`styles.ts:69` 的注释写的是"强 blur 只留给小面积元素（卡片/按钮/弹层内容）"，但 `.awu-dialog`（620 宽）和 `.awu-editorFoot`（1120 宽）都用了 30px，**与自己的规矩不符**。
  - 建议（S，收益最大）：`.awu-scrim` 的 `blur(6px)` 去掉（它上面还压了 `.16/.36` 的暗层，视觉差别极小）；`.awu-editorFoot` 降到 `blur(12px)`；`.awu-dialog` 降到 `blur(20px)`。
- `.awu-panel { will-change: transform, opacity }`（`styles.ts:470`）**常驻**：这个属性在动画结束后不会被撤销，等于永久给一块 1120×820 的元素保留独立合成层 + GPU 显存。建议动画结束后移除（`animationend` 里 `el.style.willChange='auto'`），或干脆去掉——入场动画只有 240ms，浏览器自己会临时提升。

### 6.5 轮询与副作用

- `index.tsx:2047-2051`：面板打开期间 **每 5 秒** `reloadQuietly()` → 2 个 HTTP 请求 + `JSON.stringify([chars, ov.active, ov.sessionId, ov.bindings, ov.stats, ov.preset])`（`:2025-2032`）做变更签名。
  - 问题 a：**没有 `document.hidden` 检查**，窗口最小化/切到后台仍照发照算。
  - 问题 b：`JSON.stringify` 整份列表做签名，卡片多时是 O(全量) 序列化 × 12 次/分钟。
  - 建议（S）：`if (document.hidden) return`；签名改成"长度 + 名字串拼接"或直接比对引用（后端每次都是新对象时说明数据可能变了，此时不做省流反而更稳——所以第一优先只加 `document.hidden`）。
- 副作用依赖检查：`:1951`（`reload` 变则重拉，绑定 `sinkSessionId` ✅）、`:1954-1960`（`open` + `window.focus` 监听，清理 ✅）、`:2047`（interval 清理 ✅）、`:2002-2005`（`viewName` → `loadDetail`，带 `seq` 竞态守卫 ✅）、`:2503-2522`（编辑器 `droppedLore`，带 `cancelled` ✅）。**依赖与清理这一块质量很高。**

### 6.6 事件监听 / 观察器清理：**全仓配对，无泄漏**

| 注册 | 位置 | 清理 |
|---|---|---|
| `document.keydown`（Overlay Esc） | `index.tsx:249` | `:250` ✅ |
| `document.dragenter` | `:2104` | `:2112` ✅ |
| `document.dragover/drop` | `:2108-2109` | `:2113-2114` ✅ |
| `document.pointerdown` / `keydown`（点外/Esc） | `:2150-2151` | `:2153-2154` ✅ |
| `window.beforeunload` | `:1869` | `:1870` ✅ |
| `window.focus` | `:1958` | `:1959` ✅ |
| `window.resize`（无 ResizeObserver 时） | `:1750` | `:1751` ✅ |
| `ResizeObserver` | `:1746` | `:1748 disconnect()` ✅ |
| `setInterval`（5s 轮询） | `:2049` | `:2050` ✅ |
| `setTimeout`（提示条 TTL） | `:1908` | `:1916` 卸载清理 ✅ |
| `document.keydown`（CardEditor / FocusEditor / Distill） | `card-editor.tsx:329`、`editor-focus.tsx:119`、`distill.tsx:431` | 各自 `+1` 行 remove ✅ |
| `a11y.ts` 的 `document.keydown`（trap） | `:208` | `:216` ✅ |
| `fetch` 的 abort 监听 | `api.ts:91` | `:110` ✅ |
| `setTimeout`（预设提示 6s） | `preset-view.tsx:481` | ⚠️ 无 clear，靠 `aliveRef` 守卫（`aliveRef.current` 已 false 就不再 setState）→ 不泄漏，但计时器会跑完 |
| `setTimeout`（预设 JSON 防抖 300ms） | `preset-view.tsx:1197` | `:1198` ✅ |

**结论：8 处 `addEventListener` 全部有对应 `removeEventListener`，1 个 `ResizeObserver` 有 `disconnect()`；无 `takeRecords`（也不需要——没有用它做"卸载前冲刷"的场景）。这一块不需要返工。**

### 6.7 `lib/client.js` 368 KB 的构成（esbuild metafile 只读度量，`write:false`）

实测 minified = **368 583 B = 359.9 KB**，与仓库里 `lib/client.js` 的 368 749 B 差 166 B（wrapper 那几行），一致。

| 源文件 | 产物 | 占比 |
|---|---|---|
| `client/styles.ts`（CSS 字符串） | **127.1 KB** | **35.3%** |
| `client/text.ts`（中英双字典） | **70.4 KB** | **19.5%** |
| `client/index.tsx` | 52.6 KB | 14.6% |
| `client/preset-view.tsx` | 24.9 KB | 6.9% |
| `client/lorebook-editor.tsx` | 14.2 KB | 4.0% |
| `client/distill.tsx` | 8.2 KB | 2.3% |
| `client/distill.styles.ts` | 7.6 KB | 2.1% |
| `client/card-schema.ts` | 7.5 KB | 2.1% |
| `client/card-editor.tsx` | 7.1 KB | 2.0% |
| `client/lorebook-schema.ts` | 5.5 KB | 1.5% |
| `client/guide.styles.ts` | 5.2 KB | 1.4% |
| 其余（api/preview/diary-review/guide/icons/a11y/editor-focus/lore-diag/entry/dragdrop/card-source） | 22.6 KB | 6.3% |

**"值不值得拆包"的判断：不值得，而且技术上做不到"省字节的懒加载"。**

1. **构建形态决定了拆不出来**：`scripts/build-client.mjs:23-49` 是 `bundle: true, format: 'cjs'`，**没有 `splitting`**（cjs 也不支持），产物被塞进 `window.__ModuleLoader__.load({ id, factory: (require) => … })` 的**单个 factory**。
2. **宿主契约只认一个文件**：`package.json` 的 `dsh.client` = `{platform:'web'}`、`exports["./client"] = "./lib/client.js"`；`docs/PLUGIN-DEV-GUIDE.md:146` 写的 artifact 形态就是"一个 `load({id, factory})`"。**没有任何 chunk 加载 API**。cjs 里的 `import()` 会被 esbuild 内联成 `Promise.resolve().then(() => require(...))`，**字节一分不少，只是把执行推后**。
3. **就算能拆，能省的只有 13%**：任务里点名的 `distill.tsx`(8.2) + `preset-view.tsx`(24.9) + `lorebook-editor.tsx`(14.2) 合计 **47.3 KB = 13%**，而且这三个组件在**打开面板后 1 次点击内**就会用到一个（预设/导入是工具栏常驻入口）。
4. **真正的大头不能懒**：CSS 127 KB 必须首屏（否则面板裸奔），字典 70 KB 首屏就要（面板文字全在里面）。

- 建议（P2，M，收益最大的三个方向，都不是拆包）：
  - a) **CSS 拆分注入时机**：把 `.awu-editor*` / `.awu-lore*` / `.awu-preset*` 三块（约占 styles.ts 的 40%）从 `installStyles()` 里拆成"打开编辑器/预设时再 `insertRule`"。**收益 ~50 KB、且不改构建**。注意仍要保证只注入一次（`installStyles` 的幂等写法可复用）。
  - b) **字典按语言懒挂**：`text.ts` 的 zh/en 两份字典可以只保留当前 locale（`props.t` 已能判断），省 ~35 KB。
  - c) 若真要拆 UI，**比拆文件更值的是删死代码**：§1.1 提到的 `.awu-body` 整块 + `SCOPED_ATTR`，以及 `styles.ts` 里已被替换掉的旧选择器。

---

## 7. 运行时健壮性

### 7.1 【P0】没有 ErrorBoundary —— 明确点名

- 证据：全仓 grep `componentDidCatch|getDerivedStateFromError|ErrorBoundary|window.onerror|unhandledrejection` → **0 命中**（`client/*.ts(x)` 全文）。
- 风险面（都是真实存在过的故障形态）：
  - `CharacterPanel` 渲染期抛错（例如 `detail.card` 形状异常、`relativeDay` 收到脏时间戳、`overview.stats.bySource` 不是对象）→ React 卸载整棵子树 → **侧栏席位变空白**；
  - `docs/PLUGIN-DEV-GUIDE.md:150` 已写明"抛错的 slot entry 会整块空白"；`scripts/verify-bundle.mjs:4-9` 记录了同类事故（CSS 模板串被反引号截断 → 模块初始化抛错 → 宿主静默跳过整个插件）。
  - 本仓大量的 `?.` / `??` 说明作者知道数据不可信，但**渲染期异常没有任何兜底**。
- 影响：一个坏卡片数据 = 整个角色管理器消失，且用户看不到任何提示（连"出错"两个字都没有）。
- 建议（S，强烈建议本轮就做）：在 `entry.tsx` 注册的组件外面包一层最小 ErrorBoundary（class 组件 20 行，`getDerivedStateFromError` + `componentDidCatch` 打日志），fallback 渲染一行"角色管理器加载失败，点击重试"的按钮（重置 `state.error = null` 触发重挂）。**这是唯一一条我建议越过"只读检查"立刻修的项。**

### 7.2 缺 DOM / 宿主 API 缺失的守卫（现状盘点）

| 检查点 | 现状 | 判定 |
|---|---|---|
| `installStyles()` 无 `document` | `styles.ts:3575` `if (typeof document === 'undefined') return false` | ✅ |
| 面板 portal | `index.tsx:2620` `{open && typeof document !== 'undefined' && createPortal(…)}` | ✅ |
| 三个 a11y hook 无 `document` | `a11y.ts:111`、`:142`、`:177` 各自判 `typeof document === 'undefined'` | ✅ |
| 所有焦点 API | `a11y.ts:44-59`、`:62-69`、`:72-87` 全 try/catch + `console.warn` | ✅（这份容错写得比多数库好） |
| `localStorage` 不可用（隐私模式） | `guide.tsx:20-36` try/catch，读失败按"已看过"、写失败只 warn | ✅ |
| `navigator.clipboard` 不存在 | `distill.tsx:335` `typeof navigator === 'undefined' ? undefined : navigator.clipboard`，失败走"复制原文"降级 | ✅ |
| `ResizeObserver` 不存在 | `index.tsx:1745-1751` 回退 `window.resize` | ✅ |
| `composedPath` 不存在 | `index.tsx:2129` 有 `typeof event.composedPath === 'function'` 兜底 + `contains` 双判 | ✅ |
| 宿主拖放 API 形状变化 | `dragdrop.ts` 全文（`:68-75` 只发 `dragend` 事件复位，不碰宿主内部状态；`:84-89` 统一入口） | ✅ |
| **`Overlay` 的 `createPortal(…, document.body)`** | `index.tsx:257-276`、`distill.tsx:483-589` **直接解引用 `document.body`**，无守卫 | P2（只在有 document 的树里挂载，实际不会炸；但与面板那处的守卫风格不一致） |
| **SSR 首屏** | 面板 `useState(() => guideFirstRun())` 在**渲染期**读 `window.localStorage`（`index.tsx:1780`）。try/catch 能接住 `ReferenceError`，所以不会抛；但 `typeof window` 风格不统一 | 可接受 |
| **重复注入样式** | `styles.ts:3577` 用 `style[data-plugin-css]` 去重 ✅；`entry.tsx:58-64` 用 `ctx.effect` 卸载时按 `style[data-plugin]` 移除 ✅；`index.tsx:1773` 再兜一次 `installStyles()`（注释解释了热替换场景）✅ | ✅ **这块做得很好，别动** |
| **portal 容器缺失** | 挂 `document.body`，不存在"容器被删"的场景；`.awu-scrim`/`.awu-panel` 的 z-index 用 `2147482000/100` 与宿主抢栈（`styles.ts:190-192`，注释说明是"经验值"） | ✅ 可接受 |

---

## 8. 已做得好、不要重做（明确清单）

1. **`client/a11y.ts` 的形态**：三个职责拆开的 hook（还焦/初始聚焦/陷阱）+ 模块级栈处理嵌套 + 全 try/catch。**不要合并成一个 hook，也不要给它加 Esc**（Esc 归调用方是正确取舍，`a11y.ts:170-173` 的注释已验证过这个决定）。
2. **0 处 `div/li + onClick`**：所有可点击物都是真 `<button type="button">`。这个底子决定了后续所有键盘问题都只是"锦上添花"。
3. **Esc 让位机制**（`escYield` / `loreFocus` / `FocusEditor.stopPropagation`）：嵌套浮层"一次 Esc 只关一层"是很多人做错的地方，这里做对了。
4. **分段器的 roving tabindex + 方向键 + Home/End + 修饰键让路**（`index.tsx:2556-2577`）：与 WAI-ARIA Tabs 模式一致。
5. **`:focus-visible` 覆盖 20+ 个可聚焦类**（`styles.ts` 全量清单见 §3.1 的 grep），且 `outline-offset` 有正有负地对齐了圆角。**唯一的例外是 `.awu-focusInput`（见下）**。
6. **`.awu-lineEdit` 的"hover 才显示"没有坑住键盘**：`styles.ts:1641-1642` 同时给 `:hover` 和 `:focus-visible` 置 `opacity: 1`。这是"隐藏操作按钮"最常见的 a11y 事故，这里避开了。
7. **文件拖放有键盘替代路径**：`styles.ts:3337-3346` 明确"原生 file input 不藏起来，键盘用户要能 Tab 到它"。
8. **`prefers-reduced-motion` 覆盖 9 个 keyframes 中的 8 个** + `transition-duration: .01ms` 批量兜底 + `card:hover { transform: none }`。
9. **`prefers-reduced-transparency` 真的换成了不透明底**（`--awu-surface-opaque`），并记录了旧的"改了还是透"的 bug。
10. **事件监听/观察器 100% 配对清理**（§6.6 表）：8 处 listener + 1 个 ResizeObserver + 2 个计时器。
11. **竞态守卫**：`detailSeq`（`index.tsx:1974`）、`aliveRef`、`cancelled`、`quietSig`（5s 轮询去抖）——这些不是 a11y，但它们让"焦点/提示"不会因为晚到的响应而错位。
12. **`--awu-ink-faint` 的纪律守住了**：只作线条/装饰，没有任何一处置成正文色（§4.5 C7）。
13. **样式注入幂等 + 卸载移除**（`installStyles` + `ctx.effect`）。

---

## 9. 未做的检查 / 需要真机确认（不编造）

| 项 | 为什么没做 | 怎么补 |
|---|---|---|
| 真实读屏播报验证（NVDA / VoiceOver） | 只读检查、不能起宿主 | Lead 手验：打开面板 → 保存一张卡 → 听是否播报"已保存"（验证 §3.3 的"挂载即内容"问题） |
| 浅色主题 + 真实壁纸的合成底 | 拿不到宿主的实际背景图/主题变量 | 在预览沙盒（`tools/preview`，`visual-qa.md` 提过 `?live=1`）取一次 `getComputedStyle` 实测 |
| 深色主题宿主是否会透浅底（§4.5 C6） | 需要真机看宿主 chat 区背景 | 主人机器上开深色 + 亮壁纸看一眼即可 |
| 560px 窄窗实测 | 无截图权限 | 拉窗口到 560 看 `.awu-ctaRow` / `.awu-tabs` 是否溢出 |
| 200% 缩放下弹层是否被裁 | 需要浏览器 | Chrome DevTools 设 `200%` zoom 打开「新建角色」 |
| 动态 import 是否有隐藏支持 | 宿主 `app.asar` 不在本机（`D:\CODEX\DSH-desktop\resources\app.asar` 不存在） | ⚠️待确认：若宿主 client-modules 支持多 artifact 或 `window.__ModuleLoader__` 有 `require(id)` 跨模块能力，§6.7 的结论要重估。**但即使支持，能省的也只有 13%。** |

---

## 10. 优先级汇总（可直接派活）

| 级别 | 项 | 文件:行 | 工作量 |
|---|---|---|---|
| **P0** | 加 ErrorBoundary（fallback + 日志 + 重试） | `entry.tsx:71-93`（包一层） | **S** |
| **P1** | ImportDialog「选文件」阶段的错误不渲染 | `index.tsx:884-892` vs `:1024` | **S** |
| **P1** | 面板 `aria-modal` 与焦点陷阱二选一 | `index.tsx:2626-2627` + `:1881` | **S** |
| **P1** | 关编辑器后焦点回「编辑」按钮 | `index.tsx:2646` + `card-editor.tsx:272` | **S** |
| **P1** | 4 处表单/结果错误补 `role="alert"` | `index.tsx:695`、`:1266`、`:1321`、`distill.tsx:526` | **S** |
| **P1** | `.awu-err` 红字压红底不达标（4.17/4.33） | `styles.ts:1985-1989`、`:758-760` | **S** |
| **P1** | `pill[teal]` 青字压青底（浅色壁纸下 4.37） | `styles.ts:1199-1200` | **S** |
| **P1** | 浅色玻璃 `.54` 在非白壁纸下小字跌破 4.5 | `styles.ts:214`（正文字容器加衬底，别整体提 alpha） | **M** |
| P2 | 常驻 live region，修"挂载即内容"不播报 | `index.tsx:2802-2823` | **S** |
| P2 | 28 个标题位加 `<h1>/<h2>` | `index.tsx:2667`、`:359`、`card-editor.tsx:172` | **M** |
| P2 | `prefers-contrast: more` 整块 | `styles.ts:3529` 附近 | **M** |
| P2 | `prefers-reduced-transparency` 扩到卡片/输入框/按钮 | `styles.ts:3529-3540` | **S** |
| P2 | reduced-motion 补 3 处（`.awu-pane::before`、`.awu-editGroupBody`、`.awu-presetHeavyConfirm`）+ 2 个 chevron 位移 | `styles.ts:3562` | **S** |
| P2 | 去 `.awu-scrim` 的 `blur(6px)`、`.awu-editorFoot` 30→12px、`.awu-dialog` 30→20px | `styles.ts:2451`、`:2369`、`:2468` | **S** |
| P2 | 去掉常驻 `will-change` | `styles.ts:470` | **S** |
| P2 | `CharacterTile` 加 `memo` | `index.tsx:424` | **S** |
| P2 | 5s 轮询加 `document.hidden` 早退 | `index.tsx:2047` | **S** |
| P2 | `TextField` 自适应高度合帧/条件增长 | `card-editor.tsx:70-75` | **S** |
| P2 | import file input 补 `aria-label`；`ListField` 外层 `label`→`div` | `index.tsx:994`、`card-editor.tsx:202` | **S** |
| P2 | `index.tsx:2756`/`2745` 图标按钮补 `aria-label` | 同上 | **S** |
| P2 | 把 10.5/11px 内联字号并回 token（≥12px） | `index.tsx:1250`、`:3090`、`:2738`、`preset-view.tsx:852` | **S** |
| P2 | 删死代码：`.awu-body` 整块、`SCOPED_ATTR` | `styles.ts:843-877`、`:3587`；`index.tsx:2585`、`:2629` | **S** |
| P2 | `.awu-focusInput` 补焦点指示 | `styles.ts:2636-2652` | **S** |
| P2 | `.awu-noticeClose` 22×22 → ≥24×24（WCAG 2.2） | `styles.ts:961-962` | **S** |
| P2 | 预设空窗期列表加 `role="list"`；日记行加列表语义 | `index.tsx:2965`、`:402` | **S** |
| P2 | 世界书条目列表加方向键移动光标 | `lorebook-editor.tsx:131` | **M** |
| P2 | CSS 按需注入（拆 `.awu-editor*`/`.awu-lore*`/`.awu-preset*`） | `styles.ts:574`→`installStyles` | **M** |
| P2 | 字典按 locale 懒挂 | `text.ts` | **M** |
