# dsh-ai-with-u · 并行开发集成契约（2026-10-30）

> 由 Lead 定，三个设计/实现并行时必须遵守。目的是让三份设计能**同时落地而不互相覆盖**。
> 依据：`client/styles.ts` 只有一个全局样式入口、`client/index.tsx` 是唯一状态宿主（1600 行单文件）。

---

## 一、文件所有权（谁可以写哪个文件）

| 文件 | 所有者 | 说明 |
|---|---|---|
| `client/styles.ts` | **ui-designer** | 基础 token + 既有 `awu-*` 规则 + 字号/间距/状态带/tab/对比度收口。Lead 只动 3 行胶水（两个 `import` + 一处 `${...}` 拼接） |
| `client/a11y.ts` | ui-designer（新建） | 焦点陷阱等无障碍原语，纯函数 + hook |
| `client/card-editor.tsx` | ui-designer | 仅 2 处无障碍/字号改动（见 panel-ui 设计 §8.6） |
| `client/guide.styles.ts` | guide-designer（新建） | 导出 `GUIDE_CSS` |
| `client/distill.styles.ts` | distill-designer（新建） | 导出 `DISTILL_CSS` |
| `client/guide.tsx` | guide-designer（新建） | 指南板块组件 |
| `client/distill.tsx` | distill-designer（新建） | 蒸馏入口/向导组件 |
| `client/api.ts` | **distill-designer** | 只允许**追加**（`ROUTES.distillParse` 等），不许改动既有函数 |
| `src/distill.ts` | distill-designer（新建） | 指南全文 + 34 字段契约 + 校验 + 工具工厂（零 IO） |
| `src/web.ts` / `src/index.ts` | distill-designer | 各 +1 条路由 / +7 行常驻挂载 |
| `client/index.tsx` | **Lead** | 唯一状态宿主。成员**只提交改动提案**（文件:行 + 代码片段），由 Lead 落地 |
| `client/text.ts` | **Lead** | 中英字典。成员提交键名 + 文案表，由 Lead 合并（避免三人同时改一个对象字面量） |
| `client/icons.tsx` | **Lead** | 目前无新增需求；若某功能确需新图标，提要求、Lead 统一加 |
| `src/store.ts` / `src/tools.ts` | **无人改** | 蒸馏复用 `writeCard` 与既有 `ToolDef` 类型，零改动 |

> 一句话：**新功能 = 新文件；`index.tsx` / `text.ts` / `icons.tsx` 只有 Lead 动；`styles.ts` 归 ui-designer。**
>
> ⚠️ 2026-10-30 20:30 修订：上一版 §一 写「styles.ts 归 ui-designer」、§六-3 又写「Lead 是 styles.ts 唯一写者」，两条自相矛盾。以本表为准。

---

## 二、样式怎么并行（关键约定）

`client/styles.ts` 只有一个 `installStyles()`，全局注入一份 `<style data-plugin-css="dsh-ai-with-u/styles.css">`。
所以**不新增第二个 style 标签**，新功能的 CSS 走「模板串拼接」：

```ts
// client/guide.styles.ts
/** 使用指南板块样式；只允许用 --awu-* token，不许写死色值。 */
export const GUIDE_CSS = `
/* ---- guide 模块 ---- */
.awu-guide { ... }
`
```

```ts
// client/styles.ts（由 Lead 改这两行，成员不要动）
import { GUIDE_CSS } from './guide.styles.js'
import { DISTILL_CSS } from './distill.styles.js'

const CSS = `
  ...现有内容...
  ${GUIDE_CSS}
  ${DISTILL_CSS}
`
```

好处：注入点唯一、卸载时 `style[data-plugin="dsh-ai-with-u"]` 一次清干净、CSS 顺序天然（基础在前、功能在后可覆盖），且三方的 CSS 永远不冲突。

**命名前缀**：指南用 `awu-guide-*`，蒸馏用 `awu-distill-*`，一律不碰别人的 `awu-*`。

---

## 三、i18n 怎么并行

`client/text.ts` 导出 `zh` 与 `en` 两个扁平字典，键名必须一致。新键只加不改：

| 模块 | 键前缀 | 例 |
|---|---|---|
| 使用指南 | `guide.` | `'guide.quickstart.1': '选一张角色卡，点「启用」'` |
| 蒸馏 | `distill.` | `'distill.entry': '蒸馏角色卡'` |
| 面板细化新增 | 沿用现有语义前缀 | `'panel.tab.guide'` / `'roster.new'` 旁边加 `'roster.distill'` |

交付时给 Lead 一张两列表（键名 / zh / en），Lead 合并进 `text.ts` 并跑一致性自检。

---

## 四、组件怎么接进面板

`index.tsx` 的接入点已经勘察过（见 `06-tmp\aiwu-survey\client.md` §1 组件树）：

- **新 tab（指南）**：`index.tsx:1336-1367` 的 `role=tablist` 加第 4 个按钮 → `index.tsx:1370-1547` 的 `.awu-body` 加 `{tab === 'guide' && <GuideView t={t} />}`；`Tab` 联合类型在 `index.tsx` 顶部，需同步加 `'guide'`。
- **新按钮（蒸馏）**：角色簿头部 `index.tsx:1386-1401`（计数 + 「新建」那一行）右侧追加。
- 组件约定：**受控、纯展示**，数据与动作通过 props 传入；不要在新组件里自己 `fetch`（项目现有约定：所有请求收拢在 `client/api.ts`，一个函数一个动作）。
- 弹层复用现有 `Overlay`（`index.tsx:130`），不要新写 scrim。

---

## 五、验证门槛（每次提交前）

```bash
npm run typecheck:client   # 必须有 0 error
npm run build              # tsc + tsc(client) + esbuild + 三套自检
```

改了样式或组件后，还要在活的面板上手验：DSH 桌面版已加载本插件，入口在左侧栏底部「角色管理」。
**注意**：宿主不热加载 `lib/index.js`，宿主侧（`src/**`）改动要重启 DSH 才生效；浏览器侧改完 `npm run build` 后刷新页面即可（必要时重启）。

---

## 六、冲突处理

1. 动手前先在任务板上确认自己的 `write_scopes`。
2. 发现自己要改的文件不在自己名下 → **停下来发消息给 Lead**，不要先改再说。
3. 写者分工：`index.tsx` / `text.ts` / `icons.tsx` = Lead；`styles.ts` + `a11y.ts` + `card-editor.tsx` = ui-designer；`api.ts` + `src/**` = distill-designer。
4. 合并顺序：**基础样式（ui-designer）→ 指南（guide）→ 蒸馏（distill）**。每步都跑 `npm run build`，绿了再进下一步。
5. 任何一方改了 `card-schema.ts` 的 `GROUPS`，必须同时检查 `src/prompt.ts:93-123` 的 `renderCharacterCard` 是否已渲染该分组（否则字段存得下却进不了提示词）。
