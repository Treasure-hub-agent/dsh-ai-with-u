# R1 · 浮层与生命周期审查（dsh-ai-with-u @ 98e2b06）

- 审查员：reviewer-overlay（只读；仅本文件与 `06-tmp/ui-audit/` 下探针脚本被写入）
- 范围：本轮新改的浮层/生命周期代码（`parts.tsx` 的 `onRequestClose`/`useOverlayRequestClose`/`DialogLayerContext`；`index.tsx` 的详情 `usePresence`+`data-exit`+`closeDetail`、7 个弹层接线、`editorClosing`、面板 Esc 的 `!distillOverlayOpen`；`distill.tsx` 的 `overlayOpenCount`；`card-editor.tsx` 的 `closing`）
- 依据：KB `02-踩坑清单.md` #28–#42（尤 #31/#32/#33/#40/#42）、`03-可复用模式.md` ⑬
- 手段：静态通读 + `npx tsc -p tsconfig.client.json --noEmit`（**0 error**）+ CDP 只读探针（`tools/qa/cdp.mjs`，沙盒 `:59621`）做时序/焦点/计算样式取证
- 探针脚本（可复跑）：`06-tmp/ui-audit/probe0-explore.mjs`、`probe0b-distill.mjs`、`probe1-timing.mjs`（`--only=A|C|D|E`）、`probe2-hit-focus.mjs`、`probe3-escYield.mjs`、`probe4-panel-close-editor.mjs`、`probe5-esc-during-save-exit.mjs`

**结论速览**：本轮改动的**核心机制全部按设计工作**（`onRequestClose` 三入口同源、退场期吃 Esc、计数让位、`editorClosing` 复位、玻璃铁律零违反）。没有 P0。发现 6 条 **P2**（其中 1 条是存量、1 条只在 HMR 下成立），另有 2 条"字面踩线"需 CSS/后续 owner 拍板。

---

## 一、发现（按严重度）

### F1 `detailSubject` 用了晚一帧的 `closing` → 详情退场首帧先提交「卸载 .awu-detail + 出骨架屏」，退场动画跑在重挂的新节点上

- **文件:行**：`client/index.tsx:3286`（`detailSubject = detailName !== '' ? detailName : (detailPresence.closing ? lastDetailNameRef.current : '')`）；`client/index.tsx:4182`（渲染条件 `detailPresence.mounted || detailName !== ''`）、`client/index.tsx:4186`（`key={detailSubject}`）；`client/index.tsx:1689-1693`（`detail === undefined` → `Skeleton`）；`client/motion.ts:229`（`closing` 在 effect 里才 set）
- **现象**：点「返回」后 **t≈6ms 的那个 commit** 里 `.awu-detail` 被整块摘掉、`.awu-sk`（骨架屏）出现，`active` 变成 `BODY`；5ms 后 `.awu-detail[data-state="closing"]` 出现，但它是**重新挂载的新节点**（key 走 `名字 → "" → 名字`，`CharacterDetailView` 被卸载重挂两次）。实测采样（`probe1-timing.mjs --only=A`）：
  ```
  {"t":0,"detail":"open","active":"awu-navBack"}
  {"t":6,"why":"mut","detail":null,"sk":1,"active":"BODY"}      ← 中间态：无 .awu-detail、有骨架
  {"t":11,"why":"mut","detail":"closing","sk":0}                ← 新挂载的退场节点
  {"t":167,"why":"mut","detail":null}                           ← 真正卸载（≈T_EXIT）
  ```
- **触发条件**：`closeDetail`（详情页「返回」/错误态「返回」）。
- **影响**：① 退场动画作用在一个"用户从没交互过"的新节点上，原节点的选中文本、内部 state、焦点上下文全部丢失（焦点 t≈6ms 掉到 body，见 F2）；② 依赖"React 会在 paint 前 flush 离散事件的 passive effect"这一点才没闪骨架 —— **这一帧实测没有被画出来**（rAF 采样里含骨架的可见帧 = 0），但只要触发路径变成非离散（以后有人从 promise/定时器里调 `closeDetail`、或 React 调度策略变化），就会看到一次骨架闪烁；③ 与 KB #42「退场要 `both`、要找得到对象」的初衷相抵：对象其实被换了一个。
- **建议修法**：判据从 `closing` 换成 `mounted`（`mounted` 在退场 160ms 内恒为 true，且首帧就是 true）：
  ```ts
  const detailSubject = detailName !== '' ? detailName : (detailPresence.mounted ? lastDetailNameRef.current : '')
  ```
  一行改动，key 稳定、不再重挂，卸载时机不变。
- **级别**：P2（无数据风险、当前不可见；属于"假动画 + 多余销毁"的结构缺陷）
- **实测复现**：中间态**已复现**；可见闪烁**未复现**（headless 无该帧）。

### F2 详情退场后焦点落在 `body`（面板 aria-modal 内没有还焦）

- **文件:行**：`client/index.tsx:3280`（`usePresence(detailOpen, T_EXIT)` **未传 root**）；`client/index.tsx:3380-3391`（`closeDetail` 只清名字，无还焦）；对照 `client/parts.tsx:145-147`（Overlay 用 `releaseFocusWithin`）与 `client/editor-focus.tsx:110`（约定：不传 root 时调用方自己 blur/还焦）
- **现象**：点「返回」后 `document.activeElement === body`，并且 600ms 之后仍是 body（实测 ④）。面板是真的模态（`aria-modal="true"` + `useFocusTrap`），但焦点陷阱只在 Tab 时才把焦点拉回，读屏用户退场期听到的是一个"看得见却在消失"的返回按钮，之后彻底失去上下文。
- **触发条件**：任何一次详情 → 列表返回。
- **影响**：键盘/读屏可用性退化；与编辑器那条已经补过的 `#awu-detail-edit` 还焦（`index.tsx:2505-2521`）不对称 —— 同一层级的两个视图，一个还焦、一个不还。
- **建议修法**：给 `usePresence` 传 root（`usePresence(detailOpen, T_EXIT, detailRootRef)`，root 需要从 `CharacterDetailView` 提到面板层或用 `.awu-detail` 查询兜底），并在退场结束后把焦点还给左栏同一张卡（`[data-name="…"] .awu-cardName` 的父节点）或一个稳定 id（照抄 `#awu-detail-edit` 的做法，锁在 `closeDetail` 记下的名字上）。
- **级别**：P2（明显体验缺陷但不可见性依赖用户是否用键盘）
- **实测复现**：是。

### F3 保存退场（父级 `closing`）期间按 Esc，会在正在淡出的图层里弹出「未保存确认」

- **文件:行**：`client/card-editor.tsx:475-490`（Esc 分支只判 `layerExit.leaving`，不看父级 `closing`）；`client/index.tsx:3203-3208`（保存成功置 `editorClosing` + `T_EXIT` 定时器）；`client/index.tsx:3779`（传 `closing`）
- **现象**：保存成功后 160ms 内按 Esc，`layerExit.leaving` 在保存路径下**恒为 false**（保存不走 `useLayerExit`），于是走进"有改动 → 弹确认"分支：实测 `.awu-editorConfirm` 数量 0 → 1（此时 `.awu-editor` 已是 `data-state="closing"`、`pointer-events:none`、`aria-hidden` 缺席），120ms 后随父级卸载一起消失 —— 用户看到淡出动作里闪一张幽灵确认卡。若那一刻 `dirty` 已被刷成 false，则走 `layerExit.beginLeave()` → 立刻 `onCancel()` → **提前卸载，退场动画被截断**。
- **触发条件**：保存成功后 160ms 内按 Esc（或触发 `closeSignal` → `requestClose`，同一判断链）。
- **影响**：视觉噪声 + 一条"退场期仍可被内层抢动作"的路径；与 `useInitialFocus/useFocusTrap` 已经随 `closing` 关闭（`card-editor.tsx:420-421`）的口径不一致 —— 焦点三件套让位了，Esc 没让位。
- **建议修法**：`requestClose` / Esc / `save` 统一加 `if (layerExit.leaving || closing) return`；顺带 `disabled={busy || closing}`、`aria-hidden={closing || undefined}`（`Overlay` 的 `.awu-dialog` 在 closing 时是挂 `aria-hidden` 的，`.awu-editor` 现在没有）。
- **级别**：P2
- **实测复现**：是（`probe5-esc-during-save-exit.mjs`：`{"editor":"closing","confirm":1}` → 120ms 后 `{"editor":null,"confirm":0}`）。

### F4 退场 160ms 内的第二次 Esc 会把面板一起关掉（面板 Esc 判据只看 `dialog === ''`）

- **文件:行**：`client/index.tsx:2963`（`if (event.key === 'Escape' && dialog === '' && !editing && !distillOverlayOpen)`）；`client/index.tsx:2444`（`dialogPresence` 已经能区分"退场中"）
- **现象**：删除弹层按 Esc → `dialog` 立刻变 `''` → 60ms 内第二次 Esc → **面板 `gone`**（实测：`dialog:"closing"` 时第二次 Esc → 350ms 后 `panel:"gone"`）。弹层还在淡出就被连带卸载（半透明帧硬切）。
- **触发条件**：任何弹层关闭后的 160ms 窗口内再按 Esc（"连按两下 Escape"是很常见的肌肉记忆）。
- **影响**：与 `Overlay` 自己"退场中不再响应 Esc"的注释（`parts.tsx:168-170`）口径相反：内层退场期吃 Esc、外层却在同一时刻接手。**这一条 distill 侧是明确写成"预期"的**（`distill.tsx:653-655`：再按一次关面板符合预期），所以是否算 bug 需要产品口径拍板；我只报"两层口径不一致 + 半透明帧被硬切"。
- **建议修法**：判据补一项（与 distill 合并成"有层开着或有层在退场"）：
  ```ts
  && !dialogPresence.closing   // 或 !dialogPresence.mounted
  ```
  成本一行，且让"第一下退场、第二下才关面板"的行为对齐 distill 的既有实测口径。
- **级别**：P2（若产品认为"连按两下关到底"是对的，则降级为"文档化"）
- **实测复现**：是（`probe1-timing.mjs --only=D`）。

### F5 `useOverlayRequestClose()` 与 `distillOverlayOpen()` 是零调用点导出，注释承诺的不变量没有代码保证

- **文件:行**：`client/parts.tsx:60-65`（hook，零调用）、`client/parts.tsx:96-101`（注释承诺"不会出现 Esc 拦得住、按钮拦不住"）；`client/distill.tsx:164-167`（`distillOverlayOpen()`，零调用，只有 `useDistillOverlayOpen` 被面板用）
- **现象**：全仓 grep 无调用点。实际不一致：`client/index.tsx:1125`（DeleteDialog「再想想」在 armed 期**直接关层**，而 Esc 只卸膛）、`client/index.tsx:1186`（ModeDialog 取消按钮 busy 期可点，Esc 被 `onRequestClose` 拦住）。这两处当前都**无害**（armed 期取消 = 放弃这次危险操作；busy 期关模式弹层不丢数据），但注释声称的"同一套口径"事实上没实现，且这个导出会被后来的 owner 当成"已有口子"直接用。
- **建议修法**：二选一 —— ① 正文按钮改 `onClick={useOverlayRequestClose() ?? onCancel}`（让不变量真的成立，armed 期「再想想」也变成只卸膛）；② 删掉两个导出，注释改成"仅 Esc / 点遮罩走 `onRequestClose`"。倾向 ②（少一个 API，口径写清楚）。
- **级别**：P2（气味）
- **实测复现**：部分（armed 期「再想想」vs Esc 的不一致）。

### F6 `overlayOpenCount` 的 cleanup 用无下限 `-= 1`：模块被重新求值时计数会永久 -1，把本轮修的 bug 放回来（⚠️ 推演，未实测）

- **文件:行**：`client/distill.tsx:156`（模块级 `let overlayOpenCount = 0`）、`client/distill.tsx:657-665`（登记/注销 effect）、`client/distill.tsx:159-162`（`notifyOverlay`）
- **现象**：正常路径**不漂移** —— 实测 3 轮「开→Esc」后计数回到 0（三轮后单次 Esc 能关面板），`StrictMode` 双挂载是对称的（+1/−1/+1 = 1），`notifyOverlay` 也在 cleanup 里调了，不存在"永久 > 0 让 Esc 失效"的正常路径。真正的脆弱点只有一个：**模块被重新求值**时（client.js HMR / 打包出两份副本）计数归 0，而仍挂载的那个 `DistillButton` 的 cleanup 会把它减到 **−1**，此后一次打开只回到 0 → `0 > 0` 为 false → 蒸馏弹层开着时面板 Esc 又会连带关面板（回到本轮修掉的那个 bug）。KB #23 说 client.js 改完走刷新页面（无 HMR），所以概率很低。
- **触发条件**：HMR / 双模块实例（当前仓库两样都不成立）。
- **影响**：回到本轮已修的 Esc 连关；不会负数导致其它问题（`> 0` 比较对负值安全）。
- **建议修法**：清理时钳一下 + 登记时显式 resync：
  ```ts
  overlayOpenCount = Math.max(0, overlayOpenCount - 1)
  ```
- **级别**：P2（⚠️ 推演，未实测；正常路径已实测无漂移）
- **实测复现**：漂移路径否；正常路径已验。

### F7 面板关闭不复位 `editing` → 重开面板直接落进编辑器（**存量**，非本轮引入，但与 `editorClosing` 同一状态机）

- **文件:行**：`client/index.tsx:2456`（`editing` state）、`client/index.tsx:2482-2490`（只在 `editing → false` 时复位 `editorDirty/editorClosing/timer`）、`client/index.tsx:3768`（`editing && currentDetail !== undefined` 渲染编辑器）、`client/index.tsx:2956`（点外部 `setOpen(false)`）
- **现象**：打开编辑器 → 点面板外（无脏改动）→ 面板关（实测 `panel: closing → gone`）→ 再点侧栏入口 → **直接又落进编辑器**（实测重开 500/900ms 都是 `editor:"open"`），要再按一次 Esc 才回到详情页。
- **触发条件**：编辑器打开且无脏改动时点面板外/托盘外收起面板，然后重开。
- **影响**：重开面板看到的是上次的"编辑态"而不是详情页（草稿会从 `card` 重新初始化，不丢已保存内容，也不绕过脏改动拦截，所以**没有数据风险**）；顺带让 `editorClosing` 多一条悬挂窗口 —— 实测重进编辑器 120ms 就是 `data-state="open"`，**没有出现"下次打开立刻 closing"**（见"已确认没问题"第 1 条）。
- **建议修法**：`open` 翻 false 时（或 `panelPresence.mounted` 翻 false 时）显式 `setEditing(false); setEditorClosing(false)` 并 `clearTimeout(editorExitTimer.current)`；这与本轮 `index.tsx:2482-2490` 的复位 effect 是同一个入口，只是触发条件漏了"面板关掉"。
- **级别**：P2（存量体验缺陷）
- **实测复现**：是（`probe4-panel-close-editor.mjs`）。

---

## 二、两条"字面踩线"（不是本轮 JSX 的锅，交 CSS/后续 owner 拍板）

1. `client/styles.ts:4137-4146`：`.awu-panel[data-state="closing"]` 自己挂了 `animation: awu-exit` + `will-change: opacity`。KB #28 的原文是"带 `backdrop-filter` 的元素**及其祖先**不得有 opacity/transform 动画，也不得挂 `will-change: opacity|transform`" —— 这是玻璃**本身**在退场 160ms 里做 opacity 动画，字面违反。只在退场期、且是存量（本轮 diff 未改这一条），但它与 ⑬ 的"玻璃全程不动"不一致，建议 CSS owner 决定：退场是否改成"只动内容层 + 外壳压暗"或接受这 160ms。**实测**：详情退场、编辑退场期间 `.awu-panel` 的 computed 是 `opacity:1 / transform:none / will-change:auto / animation:none`（新代码零违反，见第三节第 7 条）。
2. `client/styles.ts:4184-4198` 的 `[data-exit="left|right"]` 是**全局属性选择器**，任何节点挂上就会拿到 `animation + pointer-events:none + overflow:hidden + contain`。目前只有 `.awu-detail` 用，但这是给未来埋的"哑弹"（谁挂谁失去点击）。建议限缩成 `.awu-detail[data-exit=…]` 或 `.awu-view[data-exit=…]`。

---

## 三、已确认没问题（看了什么、为什么觉得没事 —— 不用重复劳动）

1. **`editorClosing` 的四条复位路径**（对应你第 1 条）
   - 重新打开：`index.tsx:4204` 的 `onEdit` 显式 `setEditorClosing(false)`；实测重进编辑器 120ms 即 `data-state="open"`、520ms 仍 `open`（不会"一打开就 closing"）。
   - 关闭后：`index.tsx:2482-2490` 在 `editing → false` 时复位 `editorClosing` + 清 `editorExitTimer`；保存路径的定时器回调（`3205-3208`）先 `setEditing(false)` 再触发这个 effect，链路闭合。
   - 面板关闭：`editing` 本身残留（F7），但 `editorClosing` 会被上面那个定时器 + effect 复位 —— **未观察到"下次打开立刻 closing"**。
   - 组件卸载：`editorExitTimer` 的 setState 由 `aliveRef` 兜住（`3207`），卸载后定时器空转一次即结束；effect 本身没有 unmount cleanup，但重复触发已被 `clearTimeout` 与 `editing` 守卫收口（属于可接受的小气味，未单列）。
   - **换卡**：编辑态是整块替换（`index.tsx:3768`），编辑期间左栏/头部/tab 全部不渲染 → 用户**不可能**在 `editorClosing` 窗口里换卡，这条 race 不可达。
2. **计时器不叠加**（第 2 条）：保存按钮 `disabled={busy}`；退场期 `.awu-editor[data-state="closing"]` 的 computed `pointer-events: none`（实测 `pe:"none"`），鼠标/键盘都点不进去；代码本身也是"先 clear 再 set"（`3204`）。实测保存 → closing `t≈7ms` → 卸载 `t≈177ms`（≈T_EXIT+16ms），单次、不提前不重复。`detailPresence` 用的 `usePresence` 自带双向清 timer（`motion.ts:198-243`，契约 3），详情路径实测 closing→卸载 ≈167ms，无叠加。
3. **计数漂移（第 3 条）**：真实调用点只有 **1 个** `DistillButton`（`index.tsx:3932` 的 `DistillEntry`；`.awu-distill-cta` 在 DOM 里有 2 个，但第二个是 `index.tsx:3933-3946` 手写的「自创角色卡」按钮，只是复用类名，**不参与登记**）。实测 3 轮「开→Esc」后计数回到 0（三轮后单按 Esc 能关面板）；`StrictMode` 双挂载对称不漂移；卸载时 cleanup 与 `open` 同步。真正的脆弱点只有 F6 那条 HMR 推演。
4. **Esc 层级（第 4 条）**：蒸馏弹层里 Esc 只关弹层（面板 `open`）、删除弹层里 Esc 只关弹层、两个都在退场 160ms 内再按一次才轮到面板（F4）；`⋯` 菜单走 **window capture**（`index.tsx:1432`）先于 document capture 吃 Esc，不会被 Overlay/面板抢。`escYield` 与 `distillOverlayOpen` **不会互相干扰**：蒸馏弹层只能从面板 CTA 打开，任何 `dialog !== ''` 时 CTA 都在遮罩后面点不到，两者互斥。preset 的 `escYield` 闩锁风险也实测排除：脏状态下关弹层必须走"放弃改动"，该动作会把 `dirty` 复位并上报 `false`（`probe3-escYield.mjs`：重开预设后 Esc 能正常关）。
5. **焦点（第 5 条）**：退场首帧 `releaseFocusWithin` 生效（`parts.tsx:145-147`）；还焦实测——蒸馏弹层关后回 `.awu-distill-cta`、删除弹层关后回「删除」按钮、保存退场后回 `#awu-detail-edit`（`index.tsx:2505-2521` 的补焦真的生效）。**唯一例外是详情退场 → body（F2）**。没有出现"焦点停在已卸载节点"（none of the probes showed a detached activeElement）。
6. **遮罩/点外部（第 6 条）**：`onRequestClose` 返回 false 时遮罩点击真的不关层（实测 armed 1→0，dialog 仍 `open`），且**下一次还能关**（第二次点遮罩 → `closing` → 400ms 卸载，面板保持 `open`，焦点回「删除」按钮），没有卡死态；退场期点遮罩被 `!closing` 守卫吃掉（`parts.tsx:192-194`），也不会重置计时。面板侧"点外面"对蒸馏弹层的豁免走 `.awu-scrim` 判定（`index.tsx:2952-2953`），而面板自身没有 `.awu-scrim`（是 `.awu-panelFade > .awu-panel`），**不存在"自己把自己判成嵌套层、于是面板永远点不关"的回归**（实测点面板外 120ms → `panel: closing` → 520ms `gone`）。
7. **玻璃铁律（第 7 条）**：新代码只给内容层挂动画 —— `.awu-detail`（`index.tsx:1739-1741`）、`.awu-editor`（`card-editor.tsx:518`）、`.awu-dialog`（`parts.tsx:208-209`），都是玻璃**内部**节点。实测两段退场期间计算样式：`.awu-panel`（`opacity:1 / transform:none / will-change:auto / animation:none / backdrop: blur(18px) saturate(1.85)`）、`.awu-panelFade`（`opacity:1 / transform:none / will-change:auto`），祖先链全部干净。**零违反**。唯一字面争议是存量规则（见第二节第 1 条）。
8. **类型/构建现状**：`npx tsc -p tsconfig.client.json --noEmit` → **0 error**；探针运行期间无 `console.error`、无未捕获异常（`probe1` E 段有 0 条）。
9. **`Overlay` 的新接线本身**：`requestClose` 把 Esc / 遮罩 / 子节点三个入口收成一条路（`parts.tsx:134-138`），退场期早退；`closing` 走 context 广播而不是逐层传 prop（9 个调用点），7 个弹层的 `onRequestClose` 都返回布尔且没有一处漏 `return`；`busy/locked` 期的 Esc 不再能绕过组件内守卫（DeleteDialog 实测 armed 期行为正确）。这条是本轮做得最干净的部分。

---

## 四、建议的处理顺序

1. F1 + F2（同一处：`detailSubject` 用 `mounted` + 给 `usePresence` 传 root/还焦）—— 一行 + 十行，收益是"退场不再换对象 + 焦点不落 body"。
2. F3（`card-editor` 的 Esc/按钮补 `closing` 守卫 + `aria-hidden`）—— 三行，去掉幽灵确认卡。
3. F7（面板关时复位 `editing`）—— 存量但影响最容易被用户感知。
4. F4（面板 Esc 判据补 `!dialogPresence.closing`）—— 需要产品口径确认"连按两下是否该关到底"。
5. F5 / F6（删死 API / 钳一下计数）—— 纯卫生。
