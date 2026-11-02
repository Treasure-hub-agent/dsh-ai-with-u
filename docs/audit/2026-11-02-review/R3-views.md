# R3 子视图与数据流审查（只读）

- 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u` @ `98e2b06`（本轮 HEAD）
- 审查员：reviewer-views（只读；未改 `client/**`、`tools/**`、`scripts/**`，未跑 `npm run build`）
- 手段：静态读 + `npx tsc -p tsconfig.client.json --noEmit`（**0 error**）+ `node scripts/verify-a11y.mjs`（**8/8 通过**）
  + 沙盒 59621 只读 CDP 探针（探针与截图落在 `06-tmp/ui-audit/`：`probe-r3-views.mjs`、`probe-r3-views-2.mjs`、`check-dynamic-keys.mjs`）
- 背景已读：`03-reference/dsh-dev-kb/02-踩坑清单.md` #21/#22（拖放）、#33（属性选择器）、#40（Esc 分层）

## 总判

本轮改动**没有发现 P0/P1 回归**：蒸馏 Esc 分层、预设四路关闭、图标替换、FocusEditor 让位全部实测成立。
发现 2 个「肉眼可见」的实现缺陷（R3-V1 世界书箭头误转、R3-V2 骨架形态与内容不匹配）与 6 条注释/一致性/存量问题，全部 P2。

| 编号 | 位置 | 一句话 | P | 实测 |
|---|---|---|---|---|
| R3-V1 | `styles.ts:2688` + `lorebook-editor.tsx:484,576` | 世界书里嵌套折叠块的箭头被祖先规则连带旋转：折叠着也朝下 | P2 | ✅ |
| R3-V2 | `preset-view.tsx:799,1594` / `preview.tsx:152` | `shape="cards"` 用在竖排列表上 → 加载瞬间 2 列块跳成 1 列行 | P2 | ✅ |
| R3-V3 | `distill.tsx:514-518,529,595,617` | 注释声称按钮也走 `onRequestClose`，实际直调 `close()`；`useOverlayRequestClose` 零引用 | P2 | 半（静态+实测非 busy） |
| R3-V4 | `preset-view.tsx:1363` + `editor-focus.tsx:221-226` | 专注层「保存」退场期按 Esc = 整个预设弹层关闭，改动无声丢弃（160ms 窗） | P2 | ✅ |
| R3-V5 | `preset-view.tsx:733-757,1345,1368` | 预设的未保存确认层没有 presence 退场（card-editor 有），CSS 退场规则在本处空转；`renderConfirm()` 被调两次 | P2 | 静态 |
| R3-V6 | `preset-view.tsx:1619` | 中文界面出现「启用 off」：硬编码英文 `off` | P2 | ✅ |
| R3-V7 | `preset-view.tsx:1562` vs `1455-1460` | 导入框 300ms 防抖被 onChange 里的同步 `parse()` 绕过（每敲一字解析两次） | P2 | 静态（存量） |
| R3-V8 | `distill.tsx:700-707` / `preset-view.tsx:713-724` / `lorebook-editor.tsx:446` | 三处「键缺了就退旧文案」的兜底已永不命中；`data-lore="true"` 全仓无任何 CSS/脚本引用（死属性） | P2 | ✅ |
| R3-V9 | `distill.tsx:159-162` / `icons.tsx:98-111` | 订阅广播无 try/catch（与同文件约定不一致）；IconUp/IconDown 各偏视觉中心 0.3 单位≈0.22px@12 | P2(nit) | 静态 |

---

## R3-V1 世界书嵌套折叠块的箭头被祖先规则误转（P2，已实测）

- **文件:行**：`client/styles.ts:2688`（规则本体）+ `client/lorebook-editor.tsx:484`（`.awu-loreDropped`）、`576`（`.awu-loreInfoBlock`）
- **现象**：`.awu-editGroup[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg) }` 是**后代选择器**，而世界书分区本身就是 `<section class="awu-editGroup" data-lore="true">`（`lorebook-editor.tsx:446`）。分区一展开，**里面所有** `.awu-editGroupChevron` 都被转到 90°，包括「被预算裁掉」与「提示级问题」两个子折叠块自己的头。
- **实测**（`?live=1` → 角色簿 → 编辑 → 展开世界书）：
  - 分区 `data-open="true"`，头箭头 `transform = matrix(0, 1, -1, 0, 0, 0)`（=rotate 90°，正确）；
  - 子折叠块 `.awu-loreDropped` 的 `data-open="false"`（**是折叠的**），其箭头同样是 `matrix(0, 1, -1, 0, 0, 0)` → **折叠态箭头朝下，看起来像已展开**。
  - `styles.ts:3462/3465` 那两条「展开才转」的规则因此只在"分区也展开"时与祖先规则同值（看不出差别），在折叠态则完全失效。
- **触发条件**：任何带 `.awu-loreDropped`（宿主给了 budget 裁剪信息）或 `.awu-loreInfoBlock`（有 info 级体检项）的卡，展开世界书分区。
- **影响**：箭头是这两块**唯一的**可展开线索（`styles.ts:2675-2677` 自己写了这句），方向错了等于把"点一下会收起"读成"点一下会展开"。不阻断操作。
- **建议**：把 2688 收窄到「自己的头」——`.awu-editGroup > .awu-editGroupHead > .awu-editGroupChevron`（或 `.awu-editGroup[data-open="true"] > .awu-editGroupHead .awu-editGroupChevron`），并给 `.awu-loreDropped[data-open="false"] .awu-editGroupChevron { transform: none }` 一条显式复位。顺手就能用 R3-V8 里那个闲置的 `[data-lore]` 做限定。
- **备注**：`.awu-loreInfoBlock` 的误转是**同一规则、静态判定**（沙盒 fixture 无 info 级问题，未实测）。

## R3-V2 `shape="cards"` 用错了三处竖排列表（P2，已实测）

- **文件:行**：`client/preset-view.tsx:799`（预设列表加载）、`1594`（导入落库中）、`client/preview.tsx:152`（预览加载）
- **现象**：`cards` 形态在 CSS 里是 `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`（`styles.ts:2500`）、行高 141px（`2519`）。它在 620px 的 `.awu-dialog` 里排成 **2 列**，而这三处要替的内容都是**单列满宽行**。
- **实测**：
  - 预设列表骨架：`data-shape=cards`、`display=grid`、**2 列**、行高 141px；
  - 加载完的预设列表：`.awu-presetRow` **单列、580×84**（容器 `.awu-loreList` 是 `display:block`，全仓没有 `.awu-loreList` 样式）；
  - 预览骨架：2 列、每列 284px；加载完 `.awu-previewSeg` **6 段全宽 580**；
  - 对照：`cards` 真正的原型是角色簿 `.awu-grid`（`240px` 起，沙盒 272px 宽时 1 列、卡片 272×148）——那里 141px 的骨架高度是对的。
- **触发条件**：打开预设弹层（列表还没回来）、导入点确认后、打开注入预览（首帧）。
- **影响**：正是 `parts.tsx:223-227` 说明里要避免的「加载完从竖条突然跳成卡片」的反向版本——2 列方块塌成 1 列长行，观感是一次整块重排。三个弹层的加载态都会闪一下。
- **建议**：加第三形态 `shape="rows"`（单列、行高 ~84px、可带 2 行副标题），三处改用；或让 `cards` 在 `@container`/窄容器下退化成单列。角色簿那处保持 `cards`。
- **备注**：本轮提交说明写的「列表态统一 shape="cards"」把 `cards` 当成了"任意列表"，与 `parts.tsx` 里「cards = 角色簿卡片网格」的原始定义不一致——建议在 `Skeleton` 的注释里钉死"两列卡格"的语义。

## R3-V3 蒸馏：busy 守卫「等价」成立，但注释与实现不一致（P2，半实测）

- **文件:行**：`client/distill.tsx:514-518`（注释）、`529`（head X：`onClick={close} disabled={busy}`）、`595`（footer 取消：同）、`617`（结果态「完成」：`onClick={close}` **无 disabled**）、`442-451`（`close()`：已无 `if (busy) return`）；对照 `client/parts.tsx:63-65,102,136`
- **结论（逐路径）**：
  | 关闭路径 | 是否经过忙碌守卫 | 依据 |
  |---|---|---|
  | Esc | ✅ 经过 | `Overlay` 的 `requestClose` → `onRequestClose={() => !busy}`（`distill.tsx:519`） |
  | 点遮罩 | ✅ 经过 | 同上（`parts.tsx:192-194` 走 `requestClose`） |
  | head X | ⚠️ 不经过钩子，靠 `disabled` | `distill.tsx:529-530` |
  | footer 取消 | ⚠️ 同上 | `distill.tsx:595-596` |
  | 结果态「完成」 | ❌ 两者都没有 | `distill.tsx:617`（但此时 arm/send 已返回，只在 `setStep('result')` → `finally(setBusy(false))` 之间有一帧 `step=result, busy=true`，实际无影响） |
  | `onDone` | ❌ 不经过 | 只有 `close()` 内部调它（`442-451`），`DistillButton` 传入的就是 `() => setOpen(false)`（`686`） |
  | 外部卸载 | ❌ 不经过 | 面板/按钮卸载时 `close()` 不会被调 → 不 `disarm`。与本轮前一致（非回归），窗口由服务端过期兜底 |
- **现象**：注释 514-518 写「弹层内按钮将来若去掉 `disabled` 也不会绕过它」——**这条是假的**：两个按钮直调 `close()`，完全绕过 `requestClose`。文件头 439-441 说「弹层内**两个**关闭按钮本来就是 `disabled={busy}`」，也漏了结果态那第三枚。
- **实测**：非 busy 分支全绿（见「已确认没问题」）；**busy 分支无法实机**——沙盒没有 composer dock，蒸馏开始按钮恒为 `disabled`、文案「输入框未就绪」（`title`=「还没有可用的会话输入框…」）。这与上一版报告 §6.1 的遗留一致。
- **建议**：把 head X 与 footer 取消的 `onClick` 换成 `useOverlayRequestClose() ?? close`（该 hook 是 `parts.tsx:63` 专门为此导出的，**目前全仓零引用**），或在 `close()` 首行恢复 `if (busy) return`；然后改注释为「按钮靠 disabled，Esc/遮罩靠 onRequestClose，两套口径」。

## R3-V4 专注层「保存」退场期按 Esc → 整层关闭、改动无声丢弃（P2，已实测）

- **文件:行**：`client/preset-view.tsx:1363`（`onClosing={() => setFocusClosing(true)}`）、`editor-focus.tsx:220-226`（`beginLeave` 先 `onClosing()` 再把真正的 `onDone(text)` 排到 160ms 后）、`editor-focus.tsx:248-251`（`commit`）
- **现象**：`escYield = (focusLayerOpen && !focusClosing) || confirmLeave || dirty`（`preset-view.tsx:558`）。点「保存」后 `onClosing` 立刻把 `focusClosing=true` → `escYield=false` → 这 160ms 内 Esc 直接落到外壳 `Overlay`；而此刻 `dirty` 仍是 **false**（提交要 160ms 后才写进 `detail`）。
- **实测**：改模块正文 → 点专注层「保存」→ 50ms 后按 Esc → 600ms 后 `.awu-dialog` 列表从 `["预设"]` 变空（整个预设弹层关闭），模块摘要已随弹层卸载。
- **触发条件**：只有改动来自专注层缓冲、且没有别的脏改动时（若名字/顺序已脏，`dirty=true` 仍会弹「放弃改动？」）。窗口 = 160ms。
- **影响**：`edit.discardBody` 的未保存保护在这条窄路上被绕过——用户刚点「保存」就按 Esc（"我改完了"），改动被静默丢弃。同类路径在 `card-editor` 的世界书全屏层存在（`lorebook-editor.tsx:716`）。
- **建议**：区分「取消/丢弃」与「提交」两种退场——`FocusEditor` 在 `commit()` 路径不要上报"已让位"（加 `onCommitting` 或让 `onClosing` 带 `{committed:true}` 参数），或把 `commit` 的 `onDone` 提前到 `beginLeave` 同一 tick 执行（缓冲本来就是本地，提交无需等动画）。

## R3-V5 预设的未保存确认层缺少 presence 退场（P2，静态）

- **文件:行**：`client/preset-view.tsx:733-757`（`renderConfirm` = `confirmLeave ? … : null`）、`1345` 与 `1368`（同一层被渲染两次）
- **现象**：`card-editor.tsx:407,607-614` 的确认层走 `usePresence(confirmLeave, T_EXIT)` + `presenceAttrs`，CSS 有对应退场规则（`styles.ts:4142`、`4154`）；预设这边是纯条件渲染 → 点「继续编辑」/Esc 收掉时**硬切**，`.awu-editorConfirm[data-state="closing"]` 在预设上下文里永远不触发。
- **影响**：同一交互在两处观感不一致（注释 `729` 自称「结构、类名、按钮顺序与 card-editor 逐字对齐」，退场这一条没对齐）。两次 `renderConfirm()` 调用因 `confirmLeave` 互斥不会双份 DOM，但读者要自己验证互斥，属可维护性噪声。
- **建议**：预设侧补 `const confirmPresence = usePresence(confirmLeave, T_EXIT)`，渲染条件改 `confirmPresence.mounted`、属性挂 `presenceAttrs(confirmPresence.closing)`；删掉重复的那次 `renderConfirm()` 调用（保留"最后一层"那处）。

## R3-V6 i18n：中文界面出现硬编码 `off`（P2，已实测键集）

- **文件:行**：`client/preset-view.tsx:1619` —— `{t('preset.editor.enabled')} off`
- **实测**：`preset.editor.enabled` 的 zh=`启用`、en=`Enabled` → 中文界面渲染成「**启用 off**」，英文界面「Enabled off」。
- **清点结论**：键集 zh/en 各 **491** 条完全对称（`verify-a11y` ⑤）；动态拼接的 6 个家族（`preset.import.drop.*` 11 项、`lore.issue.*` 6 项、`lore.level.*` 3 项、`lore.dropped.*` 3 项、`preview.discipline.*` 3 项、`lore.position.*` 2 项）**全部 zh/en 齐平**（`06-tmp/ui-audit/check-dynamic-keys.mjs` 实测）。本轮没有新增文案键（`client/text.ts` 不在本轮 diff 里），所以**不存在裸 key 兜底失效**；唯一瑕疵就是这句硬编码。
- **建议**：加 `preset.editor.disabled`（`未启用` / `Off`），整句走 `t()`；或把整段改成 `t('preset.editor.stateOff')` 的完整短语。

## R3-V7 导入框的 300ms 防抖被 onChange 绕过（P2，存量，静态）

- **文件:行**：`client/preset-view.tsx:1562`（`onChange={e => { setRaw(e.target.value); parse(e.target.value) }}`）vs `1455-1460`（同样的 `parse(raw)` 放进 300ms 防抖）
- **现象**：两条路都会 parse。打字时**同步全量 `JSON.parse` + 预览整块重渲染**照旧发生一次，300ms 后再来一次。防抖注释（`1453`）写的「十万字符级 JSON 每敲一字全量 parse 会把面板卡死（2026-11-01 审查低危项）」因此没有被真正堵住。
- **来源**：`git log -S` 显示 `onChange` 里的 `parse()` 是预设系统首版（`3051ea3`）留下的，防抖是后补的，补的时候没删旧调用。
- **建议**：`onChange` 只 `setRaw`；粘贴/文件读取仍走同一条防抖通道（`parse` 由 effect 触发）。一行改动。

## R3-V8 死兜底与死属性（P2，已实测）

- `client/distill.tsx:700-707`：`raw === 'distill.entryHint'` 就退回 `entryTitle`。实测 `distill.entryHint` 已在 zh/en 两侧存在（`text.ts:534/1063`），且主路径由 `index.tsx:3932` 显式传 `hint` → 这段兜底**不可达**。
- `client/preset-view.tsx:713-724`：`preset.import.discardBody` / `preset.editor.discardBody` 同样已齐平（`text.ts:283-284`），兜底不可达。
- `client/lorebook-editor.tsx:446`：`data-lore="true"` 在**全仓**（client/scripts/tools）只有这一处出现，没有任何 CSS 或自检脚本消费它 → 死属性（而它恰好是修 R3-V1 的现成抓手）。
- **建议**：两条兜底删掉（或改注释「键已合并，保留只为旧包兼容」并给出移除条件）；`data-lore` 要么接上 CSS、要么删。

## R3-V9 两处小一致性问题（P2 nit，静态）

- `client/distill.tsx:159-162`：`notifyOverlay` 直接 `for (const listener of overlayListeners) listener(open)`，没有 try/catch；同文件 `notifySink`（`64-73`）明确写了「订阅方自己炸了要留痕，但不能连累其它订阅」。目前只有 `index.tsx:2383` 一个订阅者，风险为零，但约定不一致。
- `client/icons.tsx:98-111`：`IconUp` 纵向 3.4–13.2、`IconDown` 2.8–12.6 —— 两者是 y=8 的**精确镜像**（互相对称），但各自偏离视觉中心 0.3 单位（12px 尺寸下 ≈0.22px）。并排看几乎不可辨；若要更严谨，把两枚都收成对称的 3.0–13.0 / 3.0–13.0 区间。

---

## 已确认没问题（逐条给证据）

### 1. 蒸馏 Esc 分层（#40）—— 实测 ✅
`?live=1` → 角色簿 → 点「蒸馏角色卡」→ `.awu-scrim`×1、`aria-label="蒸馏角色卡"`：
- **Esc#1** → 弹层消失（`scrims:0`、`dialogs:[]`）、面板仍在（`.awu-panel` 且 `data-state="open"`）；
- **Esc#2** → 面板关闭（`.awu-panel` 不存在）。
- **head X**（`.awu-distill-close`）→ 只关弹层，面板仍在；**footer 取消** → 只关弹层，面板仍在。
- 计数实现正确：只认 `open`（`distill.tsx:657-665`），退场 160ms 期间不再抢 Esc（符合 `motion.ts:175-178` 契约 4 的反向要求）；卸载时 effect cleanup 保证计数归零。

### 2. 预设四路关闭 + 保存门 —— 实测 ✅（零回归）
`?live=1` → 预设 → 打开「测试预设A」→ 用原生 setter 改名字（`.awu-editorDirty` = `data-dirty="true"`、保存按钮 `disabled=false`）：

| 动作 | 期望 | 实测 |
|---|---|---|
| Esc#1 | 出确认层、弹层仍在 | ✅ `confirm:true`、`dialogs:["预设"]` |
| Esc#2 | 收确认层、回编辑 | ✅ `confirm:false`、`editName:true` |
| 点「关闭」 | 出确认层 | ✅ |
| 点「继续编辑」 | 收确认层 | ✅ |
| 点遮罩（`mousedown` 命中 `.awu-scrim`） | 出确认层、弹层仍在 | ✅（说明 `preset-view.tsx:690-703` 的捕获阶段拦截与 `Overlay` 的 `onMouseDown` 没打架） |
| 点「放弃」（intent=close） | 弹层关闭、面板仍在 | ✅ `scrims:0`、`panel:true` |
| 点「返回」→ 确认 → 放弃（intent=list） | 回列表、弹层仍在 | ✅ `presetRows:3`、`dialog` 仍在 |

`escYield` 让位未被破坏（`dirty=true` 时 Esc 不关弹层）；`requestLeave`/`leaveIntent` 的单一出口（`642-650`）与保存门 `disabled={… || !dirty}`（`1339`）均按原样工作。

### 3. FocusEditor `onClosing` 接线有效 —— 实测 ✅
打开模块全屏层 → Esc#1 → **+60ms**：`.awu-focus` 仍在且 `data-state="closing"`；此时 Esc#2 → 预设弹层关闭、面板仍在。即：退场期 Esc **已让回壳层**（不再"按两下才关得掉"），本轮/as-built 的让位协议成立（代价见 R3-V4）。

### 4. 图标替换 —— 实测 ✅
- `IconUp`/`IconDown` 与同族一致：`viewBox="0 0 16 16"`、`stroke-width 1.4`、`strokeLinecap/Linejoin=round`、默认 `size=16`（与 `IconChevron`/`IconImport`/`IconDownload` 同一 `icon()` 工厂）；造型都是「杆 + 双翼箭头」，与 `IconImport` 语言一致；命名 `IconUp/IconDown` 与 `IconBack/IconChevron` 同族。
- DOM 实测（世界书行按钮）：`svg` 内 **2 个 `<path>`**、**无内联 `style`**、`computed transform = none` → 是真图标，不是被旋转的右箭头。
- 全仓已无 `rotate(±90deg)` 内联残留（只有 `lorebook-editor.tsx:186` 的一句历史注释）。
- 其余由 CSS + `data-open` 驱动的旋转**没有漏挂**：`.awu-previewSeg[data-open]`（`preview.tsx:198` / `styles.ts:2267`）、`.awu-editGroup[data-open]`（`preset-view`/`card-editor` 均挂）、`.awu-loreDropped[data-open]`、`.awu-loreInfoBlock[data-open]`（`lorebook-editor.tsx:576` 用 `undefined` 表达"否"，符合 #33）。**问题在"多转"而不在"漏挂"**，见 R3-V1。

### 5. 世界书渲染两条分支 —— 实测/静态 ✅
- 有 ccv3：分区 `data-open` 正确、头箭头 CSS 旋转、4 条条目渲染、展开条目后 `.awu-loreBody[data-state="open"]` 在位、`.awu-loreEmpty` 不出现。
- 空世界书（`entries.length === 0`，`lorebook-editor.tsx:599-607`）与不支持（`!supported`，`465-466`）：JSX 是纯静态分支，无可抛错调用；相关 CSS 类都在（`.awu-loreEmpty:3508`、`.awu-editListEmpty:2799`）。⚠️ **未实测**（fixture 恒带 4 条 + `ccv3.data`，沙盒造不出这两个状态）。

### 6. 骨架屏零件与预览三段式空态 —— 实测/静态 ✅
- `Skeleton` 的 `data-shape`/`role="status"`/`aria-live`/视觉隐藏文案都在；`closing` 分支的绝对定位规则（`styles.ts:4020`）只给面板列表用（`index.tsx:4082`，`06-tmp` 截图里左栏骨架与卡片 272×148 基本吻合），弹层内三处不传 `closing` 是对的（弹层退场由宿主 presence 负责）。
- 预览三段式空态 `.awu-empty` / `.awu-emptyMark` / `.awu-emptyTitle` / `.awu-emptyHint` 四条 CSS 全在（`styles.ts:2415/2435/2449/2457`），不会退化成裸文本。
- `PreviewSegmentBody` 的 `usePresence` 按段 id 挂载，刷新后 id 稳定（正常 `seg.id`；缺 id 时退 `segment-N` 也稳定），无"收起动画期间数据被换掉"的错位。

### 7. 既有约定 —— 实测 ✅
- `scripts/verify-a11y.mjs`：① 0 处 `div/li/span + onClick`；② 14 个图标按钮都有可访问名；③ 119 个 `<button>` 全带 `type`；④ 错误提示可播报；⑤ 键集对称 491/491；⑥ CSS 模板串无裸反引号；⑦ 焦点环全走 token。
- `tsc -p tsconfig.client.json --noEmit`：0 error。
- 本轮 5 个文件里没有新增 `div + onClick`；新增可点物仍是 `.awu-loreRowBtn` / `.awu-presetModuleName` 等真 `<button type="button">`。

---

## 未实测清单（不编造）

1. **蒸馏 busy 分支**（arm/send 在飞时 Esc/遮罩/关闭按钮）——沙盒无 composer dock，开始按钮 `disabled`（`title` 已说明原因）。静态结论见 R3-V3 表格；「结果态完成按钮」那一帧无法在 fixture 里卡住。
2. **空世界书与「不支持」两条分支** —— 需一份无 `ccv3.data` / 无 `character_book` 的 fixture。
3. **`.awu-loreInfoBlock` 箭头误转** —— 需一份带 info 级体检项的卡；与 R3-V1 同一选择器机制，静态判定成立。
4. **导入视图 `shape="cards"` 的跳变** —— 判据来自 CSS/几何（同类三处中的两处已实测），导入落库那处需真实导入一份 ST 预设。
5. **大世界书 / 十万字符预设的打字流畅度**（R3-V7 的实际卡顿幅度）——未做长任务采样。

## 建议优先级（给 Lead）

1. **R3-V1**（一行 CSS 选择器收窄）：唯一"看得出错"的默认可见缺陷，改动最小、收益最直接。
2. **R3-V2**（骨架形态）：影响三个弹层的首帧观感，需 `Skeleton` 增加 `rows` 形态（`parts.tsx` + `styles.ts`，跨写域，建议排给 CSS/零件负责人）。
3. **R3-V4**（160ms 静默丢弃）：数据安全类，虽然窄但仍属"未保存保护被绕过"，建议在改 `FocusEditor` 时一起收。
4. R3-V3/V5/V6/V7/V8/V9：注释与一致性清理，可与上述合并到同一轮。
