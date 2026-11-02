# dsh-ai-with-u · UI 设计感与动效升级 · 交付报告（2026-11-02）

> 方向：**B · 玻璃有呼吸**（主人拍板，含完全结构授权 + 全量动效）
> 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u`，基线 `a7b5799`，本轮仅**本地提交**（未推远端、未发 npm）
> 验收：`npm run build` **EXIT=0**，9 套自检全绿；截图矩阵 48 张（常规/减弱动效/降低透明度各 16 场景）

---

## 1. 一句话结论

面板从「能用的玻璃面板」变成「有主从结构、有材质层次、有出入场语法的玻璃面板」：
结构上把 tabs 归位右栏、左栏只回答「选谁」、hero 从 5-6 个同权按钮收敛成 1 主 1 次 + ⋯；
动效上补齐了**退场系统**（原本 13 类挂载点全是硬切）、分段器滑块、方向位移、指针跟随玻璃高光、
列表 FLIP；工程上把「手写白名单」换成了**全局守卫 + 两条自动化护栏**（`verify-ui` / `verify-a11y`）。

---

## 2. 改动量

| 文件 | 净变化 | 说明 |
|---|---|---|
| `client/styles.ts` | +1113 / −402 | 令牌 98→122、focus ring 24 条→2 个来源、死代码 21 类清理、退场/编排/材质 |
| `client/index.tsx` | +1456 / −252 | 结构重排、导航栈、退场接线、高光/FLIP、性能点 |
| `client/preset-view.tsx` | +370 / −44 | 脏数据保护（P0）、四路关闭统一、Skeleton、保存门 |
| `client/text.ts` | 净 ≈0 | 491↔491 对称；新增 17 / 删 16 / 改值 3 / 复活 4 |
| `client/motion.ts` | 新增 246 行 | `usePresence` / `useFinePointer` / 令牌常量 / `presenceAttrs` |
| `client/entry.tsx` | +82 | **ErrorBoundary**（P0） |
| `client/distill.tsx` | 小 | 状态条 `role=status`、补 `resetHostDropState` 卸载兜底、Overlay TODO |
| `client/distill.styles.ts` | 235→161 行 | 几何交还 `.awu-dialog`（620/24）、41 处旧暖色 fallback 清零、字号字面量 11→0 |
| `client/guide.styles.ts` | 203→210 行 | 阅读宽 760 居中、正文 14/23、字号字面量 14→0 |
| `client/card-editor.tsx` | +240 | 编辑器/确认层退场、击键测量优化、IconClose 复用 |
| `client/editor-focus.tsx` / `diary-review.tsx` / `preview.tsx` / `lorebook-editor.tsx` | 小 | `useLayerExit`/`useStillAttr`、折叠退场、错误条同形、骨架、空态三段式 |
| `scripts/verify-ui.mjs` | 新增 | 7 条纪律断言 |
| `scripts/verify-a11y.mjs` | 新增 | 7 条无障碍断言（8 个通过点） |
| `tools/qa/shots.mjs` | 新增 | CDP 截图矩阵（16 场景 × 3 媒体态，零 playwright 依赖） |
| `docs/design/2026-11-02-ui-motion-system.md` | 新增 | 契约（令牌 / data 属性 / 编排 / 禁止项 / 落地勘误） |

---

## 3. P0 逐条处置（检查阶段认定的 10 条 + 3 条静默失败）

| # | 问题 | 状态 | 落点 |
|---|---|---|---|
| P0-1 | 左栏无选中态 → 日记页静默换操作对象，可能清错卡 | ✅ | `subjectName = detailName` 唯一真源 + `data-selected` 蓝轨 + `.awu-railNow`「正在看：X」 |
| P0-2 | 全仓无 ErrorBoundary | ✅ | `entry.tsx` `PanelBoundary`（含重试；崩溃路径未活验，见遗留） |
| P0-3 | 预设编辑器无脏数据保护 | ✅ | `requestLeave` 单一出口 + baseline + 保存门（沙盒 13 步全绿） |
| P0-4 | 面板关闭无退场 | ✅ | `usePresence` 160ms，80ms 采样 `data-state="closing"`、+160ms 卸载 |
| P0-5 | sheet + 遮罩无退场 | ✅ | scrim/dialog 同时挂 `data-state`，退场期不吃 Esc/点遮罩 |
| P0-6 | list↔detail 只进不出 | ✅ | 进向 +8px + **头像共享元素双向**（`parts` 拆分后给详情接了 morph）；`.awu-detail` 自身的退场 presence 仍缺（见遗留 1） |
| P0-7 | tab 切换零过渡 | ✅ | `.awu-mainBody > *` 120ms `awu-view-in`（零 JSX 依赖） |
| P0-8 | 分段器无滑块 | ✅ | `--awu-tab-i/-n` 驱动，1440 下 157px、1024 下 134px |
| P0-9 | `prefers-reduced-transparency` 只兑现一半 | ✅ | 8/8 模糊面 + 全部半透明卡面换实底（截图 `final-rt/` 可验） |
| P0-10 | 浅色骨架屏不可见（1.02:1） | ✅ | 新增 `--awu-sk-base/-sweep` 随主题走，扫光改 transform |
| 附 | 导入弹层选文件阶段静默失败 | ✅ | 错误条提到阶段判断外 + `role="alert"` |
| 附 | 改写日记成功无反馈 | ✅ | 复用 `diary.editDone` 走 notice |
| 附 | 刷新按钮不转不提示 | ✅ | `busy` 驱动 `data-spin` + `aria-busy` + 骨架重出 |

---

## 4. 设计感与动效（本轮的"看得见"部分）

**结构**：tabs 归位右栏 `.awu-mainHead`（左栏头部只留 CTA/搜索/过滤）；`.awu-mainBody` 四视图；
左栏选中蓝轨 + 「正在看：X」；hero = 绑定（主）/ 编辑（次）/ ⋯（导出 · 改模式 · 换开场白），
删除下沉 `.awu-dangerZone`；「最近日记」只给 8 行 + 出口；空库给两个真按钮。

**材质**：左栏凹陷（inset 发丝，避开 1px 布局误差）/ 右栏浮起；卡片高光迁进 `::after`（240px 圆，
指针跟随，三层降级：fine pointer / `data-fx="off"` / reduced-motion）；深色 `glass-1` .70 + saturate 138%；
弹层 72% + 顶部 sheen + 统一 24px 圆角。

**动效系统**：令牌 7 档时长 + 3 条缓动（旧名做别名，300 处调用零改动）；
退场统一 160ms 只动 opacity、绝不 stagger；进入分层（面板 240 / sheet 320 / 浮层 200+24 错峰 cap 6）；
tab 120ms crossfade；按压补齐 13 个控件（.97/.94/.995）；四套折叠统一 200/160；
`awu-glow` 从 box-shadow 动画改 `::after` opacity 呼吸（去掉无限期整卡重绘）；
shimmer/进度条改 transform；现在**0 条动画动 box-shadow 或 background-position**。

**性能**：面板/弹层动画期 `data-still="true"` → `backdrop-filter:none` + 摘掉大模糊投影；
`.awu-scrim` 的 6px 全屏模糊删除（弹层链从 3 层滤镜降到 ≤2）；`will-change` 不再常驻；
`CharacterTile` 加 memo；5s 轮询 `document.hidden` 早退 + 签名改标量串；
编辑器击键测量 LayoutCount 41→9（跨封顶）/ 41→2（封顶后）。

**无障碍**：`aria-modal` 与焦点陷阱对齐；编辑器关闭还焦（实测 `activeElement.id === 'awu-detail-edit'`）；
新增 5 处 `role="alert"` / `role="status"`；`.awu-err` 与 `pill[teal]` 对比度 4.17/4.33 → 4.94/5.38；
focus ring 值只有一个来源（2 档 offset）；reduced-motion 从「手工白名单」换成**全局守卫**
（`*,*::before,*::after` 时长 .01ms + scroll-timeline 特批 + spinner 例外）。

---

## 5. 自动化护栏（本轮新增，已进 `npm run build`）

| 脚本 | 断言 | 抓到的真实事故 |
|---|---|---|
| `scripts/verify-ui.mjs` | 7 条：模板串反引号/插值白名单/花括号、keyframes 闭环、时长走令牌、字号字面量预算、禁 `transition: all`、属性选择器带值、错峰上限 ≤8 | 本轮**两次**抓到注释里的反引号截断模板串；一次抓到 `min(index,8)` 之外的苗头 |
| `scripts/verify-a11y.mjs` | 7 条（8 个通过点）：0 处 `div+onClick`、14 个图标按钮有标签、119 个 `<button type="button">`、错误可播报、i18n 491↔491 对称、模板闭合形态、焦点环走 token | 红测：注入 11 个违规全部按预期变红 |
| `tools/qa/shots.mjs` | 16 场景 × 3 媒体态截图矩阵 | 替代不可注入的 DSH 桌面端（bsk 连不上） |

当前计数：`verify-ui` 7 项；`verify-a11y` 8 项 0 失败 0 跳过；原有七套（9 / 72 / 306 / 121 / 58 / 324 / 126）不变。

---

## 6. 遗留清单（2026-11-02 收尾轮后更新）

> 收尾轮（四路并行）已关掉原 1/2/3/4/5/6/8 六条，另修掉两个过程中发现的存量 bug。
> 下面只列**仍然开着**的与「已知但接受」的。

### 6.1 仍在（需要主人或后续轮次）

1. **字体放大无效**（全 px，改 rem 属跨轮改动）：系统字号放大对面板内文字无效。
2. **未推远端、未发 npm**（按主人指令：只本地提交）。
3. **`distill` 的 busy 分支只有代码级保证**：沙盒输入框未就绪 →「开始蒸馏」disabled，
   进不了 arm/send 分支，无法实跑「busy 期 Esc/遮罩不关」。
4. **`cards` 骨架在 620 弹层里是两列网格**：它替代的是纵向列表，观感略不符；
   要"竖排行"需 CSS 加 `data-shape="rows"`（记录在 `tools/qa/index.md`）。
5. **预设/预览的 ErrorBar 无「重试」按钮**：两者是 `parts.ErrorBar` 的 `message`-only 用法，
   重试靠弹层头部刷新图标；要统一成带重试需给 `ErrorBar` 传 `onRetry`。

### 6.2 已关闭（本轮）

| 原条目 | 关闭方式 | 证据 |
|---|---|---|
| 1 `.awu-detail` 退场 presence | 详情根 `usePresence` + `data-exit="left"` + 退场期 `pointer-events:none`，并 cancel morph | 80ms 采样 `data-state="closing"`、+240ms 卸载；玻璃 `opacity=1/transform=none` |
| 2 `Overlay` 缺 `onRequestClose` | 内建 `onRequestClose?: () => boolean` + `useOverlayRequestClose()`；7 个弹层接入真实用途 | 上膛时 Esc 只卸膛；busy/locked 期 Esc/遮罩关不掉 |
| 3 preset/preview 缺 fixture | 沙盒补 `/presets` `/preset` `/preview` + `?slow=` `?fail=` `?crash=` | `states.mjs` 15 项、`preset-loading/-error` 图 |
| 4 `Skeleton` 形态 | 列表态统一 `cards`（预设列表/导入落库/预览加载），`detail` 只留表单回读 | 实跑 `data-shape` 断言 |
| 5 `prefers-contrast: more` | 新增整块（ink/line 抬档、去 saturate、焦点环 3px、hover 提亮减半），浅色变体单写 | CDP 模拟实测：mute .82/.88、sheen transparent、outline 3px |
| 6 ErrorBoundary 崩溃路径 | `tools/qa/crash.mjs` 用真实 `CharacterEntry` 注入渲染期异常 | 10 项断言全绿，无未捕获异常，降级 UI + 重试可用 |
| 8 lorebook chevron 静态换图 | `icons.tsx` 补 `IconUp/IconDown`，lorebook 两处 + preset 两处去掉内联 rotate | 实机：svg 无内联 transform，`[data-open]` 驱动旋转 |
| （附带）保存后编辑器硬切 | `CardEditor` 加 `closing`，保存走「先 closing 再 T_EXIT 卸载」 | 80ms `closing`、~310ms 卸载、焦点回 `#awu-detail-edit` |
| （附带）蒸馏弹层里 Esc 连面板一起关 | `distill` 导出 `distillOverlayOpen()`，面板 Esc 判断加 `!distillOverlayOpen` | 一次 Esc 只关弹层（面板 `open`），第二次才关面板 |
| （附带）详情退场时滚动容器抖出横向滚动条 | `.awu-mainBody` 加 `overflow-x: hidden` + `contain` | 退场瞬间 `scrollWidth == clientWidth == 782` |
| （附带）三处折叠缺实机证据 | fixture 补 `character_book` 与跨月日记后实跑 | 三处均：closing 2ms 挂上、165/166ms 卸载 |
| （附带）截图脚本会产出空白假截图 | 导航重试 + `location.href` 校验 + 耗时日志 | 21 场景矩阵无空白图 |

---

## 6.3 审查轮（四名审查员，2026-11-02 下午）

四名审查员分域复查本轮新代码（浮层生命周期 / CSS 动效与降级 / 子视图数据流 / 验证基建），
结论：**P0 = 1（全在验证基建）、P1 = 6、P2 = 20+**，全部已修。

### 已修的关键项

| 域 | 问题 | 修法 | 证据 |
|---|---|---|---|
| CSS | `data-still` 的 `will-change` 仍挂在 `.awu-dialog/.awu-focus/.awu-editorConfirmCard` 三张带 blur 的层上 | 整段删除（那三个属性已无事可做） | `.awu-dialog` willChange `auto` |
| CSS | **面板退场自己在动玻璃**（`awu-exit` + `will-change:opacity`） | 从大层退场组移除；改内容层 `awu-content-out` + 外壳 `::before` `awu-scrim-out` | `.awu-panel` `getAnimations()=0`、`animationName:none` |
| CSS | 骨架退场 `left/right:0` 按 padding box 算 → 宽度 272→336、左移 32px | `inset-inline: var(--awu-pane-pad-x)`（提成令牌） | 骨架宽 272 = 容器内容宽 |
| CSS | 世界书分区展开会把嵌套块箭头一起转（后代选择器过宽） | 收窄成 `> .awu-editGroupHead`，嵌套块 `:not([data-open="true"])` 兜底 | 外层 rotate90、嵌套 `transform:none` |
| CSS | 进场 fill 用了 `both`（3 处）、缺 `forced-colors`、降透明清单与实际不符、高对比没抬玻璃 | 逐条修正 | 见 `verify-ui` 7 项 + CDP 采样 |
| 浮层 | 详情退场判据用 `closing`（晚一帧）→ 中间态先摘详情再重挂 | 判据换 `mounted`，渲染条件收敛成单一判据 | 8/16/30/60/90ms 同一节点、骨架计数恒 0 |
| 浮层 | 详情返回后焦点落 `body` | `usePresence` 传 root + 卸载按 `data-card-id` 还焦，兜底列表容器 | `activeElement` = 原卡片 |
| 浮层 | 保存退场 160ms 内按 Esc 弹出「未保存确认」并随父级消失 | `requestClose/Esc/save` 加 `leaving \|\| closing` 早退，按钮禁用 + `aria-hidden` | confirm 计数 0 |
| 浮层 | 弹层退场期第二次 Esc 连带关面板 | 面板 Esc 与点外面都补 `!dialogPresence.closing`（口径=退场期仍算开着） | 退场期 Esc 后面板仍在 |
| 浮层 | `useOverlayRequestClose()` 零调用（注释承诺不成立） | 新增 `RequestCloseButton`（必须在 Overlay 子节点里才能读到 context），5 个弹层 + distill 三处接入 | arm 期点「再想想」只卸膛 |
| 浮层 | 重开面板仍落进编辑器 | `open=false` 时显式退编辑态并清计时器 | 重开 `.awu-editor` 为 null |
| 视图 | **专注层「保存」后 50ms 按 Esc → 弹层关、改动丢失**（数据安全） | `onClosing(intent: 'cancel' \| 'commit')`，只有 cancel 放行 escYield | 保存→50ms Esc→弹层仍在且正文已落盘；取消路径仍立刻放行 |
| 视图 | 三处竖排列表用了 `cards` 形态（两列网格） | 新增 `shape="rows"`（单列、行高 84、gap 12） | `data-shape="rows"`、3 行 × 84px × 宽 580 |
| 视图 | 计数 cleanup 无下限（HMR 双副本会到 −1） | `Math.max(0, n-1)` + 注释 | 代码级 |
| 视图 | 「启用 off」中英混排 | 改走 `preview.discipline.off` | 实测 pill 显示「关闭」 |
| 视图 | preset 确认层硬切、`renderConfirm()` 调两次 | 接 `usePresence` + `useStillAttr`，删重复调用 | count=1、80ms closing、320ms 卸载 |
| QA | **矩阵没有失败通道**：沙盒没起 / 打包 500 / 步骤点了不存在的元素，全部 `✓ + exit 0` | 加 F1–F5 判红（导航落地/bundle 健康/步骤有效/图不空/与基线栅格差）+ `失败 N` 非 0 退出 | 三种假绿复测均 exit 1，基线 exit 0 |
| QA | `crash.mjs` 崩溃不可归因（别的异常也能全绿） | 断言 `consoleErrors` 含探针原文 | 11/11 绿 |
| QA | `states.mjs` 的"错误文案带 500"是 fixture 自证（宿主只产 400） | fixture 改真实 400 信封 + 断言文案原文；「重试」做成真断言（fetch 计数 1→2） | 23/23 绿 |
| QA | fixture 契约漂移 → 会话绑定/预设摘要/纪律档位**零覆盖** | 逐字段补齐 `/overview` `/character` `/preview`；新增 `?bound=1` 与第 21 个场景 `bound-session` | 该场景实测渲染「本会话 / 全局」与「解除绑定」 |
| QA | `verify-ui`/`verify-a11y` 的 6 类漏检/误报 | 收尾行容忍注释、剥行注释、自动发现 `*.styles.ts`、`props.` 表达式、`onPointerDown`、`outline-color`、`{err}` 渲染 | 16 组注入样本 + 2 条基线全部符合预期 |
| QA | 产物默认写进仓库、端口不校验、Windows 下 `process.exit` 撞 libuv | 默认落仓库外 + `.gitignore` 补 `06-tmp/`；加 `assertSandbox()` 端口认领；先关 ws/杀 chrome 再退出 | 59624 被挡住并提示换端口 |

### 审查轮结论

- 上一轮引入的机制（`onRequestClose` 三入口同源、退场期吃 Esc、计数让位、`editorClosing` 复位、
  玻璃铁律）经逐条实测**逻辑正确**；问题集中在"边界时刻"（退场 160ms 窗口、焦点归还、
  提交与取消的意图区分）与**验证基建的可信度**。
- 新增/更新的经验已同步进知识库：`02` #43（退场期仍算开着）、`03` ⑭（提交/取消要带意图）、
  `04` 静态扫描四条加固、`08` §7（退场同样不能动玻璃）、`09` §7–§8（矩阵必须会红 + fixture 必须对齐真实响应）。

---

## 7. 复验命令

```bash
# 全量构建（9 套自检）
npm run build

# 单独跑新护栏
node scripts/verify-ui.mjs
node scripts/verify-a11y.mjs

# 预览沙盒（改 client 刷新即见）
node tools/preview/serve.mjs            # http://127.0.0.1:59621/  ?live=1  #dark

# 截图矩阵：常规 / 减弱动效 / 降低透明度
node tools/qa/shots.mjs --out=06-tmp/ui-audit/final
node tools/qa/shots.mjs --out=06-tmp/ui-audit/final-rm --media=reduce-motion
node tools/qa/shots.mjs --out=06-tmp/ui-audit/final-rt --media=reduce-transparency
```

产物位置：截图矩阵 `06-tmp/ui-audit/{final,final-rm,final-rt}/`（含 `index.md` 逐图说明）；
基线（改造前）`06-tmp/ui-audit/baseline/`；五份审计报告 `reports/2026-11-02-ui-audit/`。
