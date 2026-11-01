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
| P0-6 | list↔detail 只进不出 | ⚠️ 半 | 进向 +8px 已接、`awu-exit-left/right` 已接选择器；**返回方向缺 `.awu-detail` presence**（index.tsx，遗留） |
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

## 6. 遗留清单（如实，未做/未验）

1. **`.awu-detail` 的 presence 未接** → 详情「返回列表」仍是硬切；CSS 侧 `awu-exit-left/right` 已备好选择器，只差 `index.tsx` 给详情根挂 `usePresence` + `data-exit`。
2. **`distill.tsx` 未换回 Overlay** → 自建 scrim/dialog 副本仍在（本轮已手动补齐 drop 复位 + `role=status`；`data-still`/presence 仍缺），文件头有第 4 轮 TODO。
3. **`parts.tsx` 未抽** → `ErrorBar`/`Skeleton`/`EmptyState`/`IconBtn` 仍分散（本轮只做了 preview 的错误条同形与骨架同构，未做统一组件）。
4. **3 处折叠缺实机证据**（`.awu-loreBody`+FocusEditor、`.awu-diary`、`.awu-preview*`）：沙盒 fixture 无 `ccv3.data`/日记/`/preview` 路由，代码同 hook 同形状但未采样，不敢写成已验证。
5. **保存成功后编辑器仍是硬切**（父级 `setEditing(false)` 直接卸载，本层拦不到）。
6. **`prefers-contrast: more` 整块仍缺**（原计划第 3 批，未做）。
7. **ErrorBoundary 崩溃路径未活验**（只验了包一层后正常路径无回归）。
8. **字体放大无效**（全 px，改用 rem 属跨轮改动，未做）。
9. **lorebook 两处 chevron 是静态换图标**（不是过渡），彻底修法需 `icons.tsx` 补 `IconUp/IconDown`。
10. **未推远端、未发 npm**（按主人指令：只本地提交）。

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
