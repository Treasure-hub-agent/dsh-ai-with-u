# 角色卡编辑器 · CCv3 重构设计（v0.2.0）

> 任务：`client/card-schema.ts` 从「10 组 / 34 个中文键」整体切到**酒馆卡 Character Card V3**，编辑器跟着重做。
> 本阶段**只做设计**，不动代码。等 `tavern-architect` 的格式稿定稿后实施。
> 行号基准：`main` e07bf58 工作副本；`client/card-editor.tsx` 366 行（已含 guide-designer 的焦点三件套）、`client/card-schema.ts` 318 行、`client/styles.ts` 2161 行。
> 视觉口径沿用 `docs/design/2026-10-30-panel-ui.md`：面板 452px、字号走 `--awu-fs-*`、颜色走 `--awu-*`、状态走 `data-*`、文案中英双份。

---

## 〇、与 `tavern-architect` 的契约假设（先钉死，避免实施时返工）

格式稿还没到，但编辑器不能等。下面 6 条是我**假定的契约**；若 architect 定稿不同，改动点就落在标注的那一处（都已收敛到常量/单函数），不会扩散：

| # | 假设 | 若定稿不同，改哪里 |
|---|---|---|
| C1 | 落盘的是**完整信封** `{ spec:'chara_card_v3', spec_version:'3.0', data:{…} }`，不是只存 `data` | `card-schema.ts` 的 `SPEC_ROOT = 'data'` 一处；设成 `''` 即兼容"只存 data" |
| C2 | 旧 10 组中文键**原样**保留在 `data.extensions.aiwu.legacy`，另记 `aiwu.migrated_from` / `aiwu.migrated_at` | 编辑器只读展示，键名由 `LEGACY_KEY = 'aiwu'` 一处决定 |
| C3 | 世界书的 `scan_depth` / `token_budget` 是**书级**（V3 规范如此），条目级没有 | 见 §3.3：条目级不入规范字段；若主人坚持，写进 `entry.extensions.aiwu.scan_depth` |
| C4 | L1 常驻注入仍按 `DEVELOPMENT.md §二` 的 ~1200 字符预算 | `L1_SOFT_BUDGET` / `L1_HARD_BUDGET` 两个常量 |
| C5 | `data.name` 仍等于目录名（改名要动目录，本轮不做），编辑器里只读 | 头部只读提示文案 |
| C6 | 世界书检索（哪些条目、几轮扫描、命中规则）是**后端**的事，编辑器只管数据正确 | §7.8 的后端依赖清单 |

> 一句话：**编辑器只对「数据形状与编辑体验」负责，不对「注入策略」负责。** 两者通过 `budget` 标注和预算条对话，不通过字段名对话。

---

## 一、现状与影响面

### 1.1 现状（改造前）

| 维度 | 现状 | 位置 |
|---|---|---|
| 字段模型 | 10 组 / 34 字段，中文键名，`target: 'object'|'top'` + `root` 两级寻址 | `card-schema.ts:66-194` |
| 控件 | 只有 3 种：`text` / `long` / `list` | `card-schema.ts:17-20` |
| 长文本 | 自适应 `textarea`，最高 240px 后内部滚动 | `card-editor.tsx:34-40` |
| 完整度 | 全字段二值计数 `filled/34` | `card-schema.ts:303-318` |
| 脏检查 | 每次渲染 `JSON.stringify(toDraft(card))` + `JSON.stringify(draft)` | `card-schema.ts:296-300`、`card-editor.tsx:227` |
| 合并 | 浅合并 + 空值删键 + 空组删组 | `card-schema.ts:245-293` |
| 身份字段 | `name` / `source` 只读 | `card-editor.tsx:298-301`、`card-schema.ts:288-290` |
| 焦点 | 编辑器 + 未保存确认两层，`useRestoreFocus/useInitialFocus/useFocusTrap` 各一对 | `card-editor.tsx:218-225` |

### 1.2 三个必须先说清楚的"已有成本"

**(a) 键盘 Esc 会连面板一起关掉，编辑内容全丢（P0，本轮必须顺手修）**
`index.tsx:1050` 的面板级 Esc 判断是 `if (event.key === 'Escape' && dialog === '')`——编辑器打开时 `dialog === ''`、`editing === true`，于是**面板先关、编辑器随后卸载**。`card-editor.tsx:259` 虽然 `stopPropagation()`，但同节点上的捕获监听按注册顺序执行（面板先注册），拦不住。
修法在 `index.tsx`（Lead 的地盘）：把条件补成 `&& !editing`。这行不修，下面所有"未保存缓冲"设计都会在 Esc 场景下失效。

**(b) 每次按键都在做全量序列化（长文本卡顿的真正来源）**
`card-editor.tsx:227-231`：`dirty` 用两次 `JSON.stringify`（一次序列化整卡、一次序列化草稿），`progress` 又跑一次 `mergeCard` + `filledCount`。这两块都在**顶层组件**里、依赖 `draft`，所以每敲一个字都执行。description 上万字时，单次 stringify 是 10–20KB 级别的字符串操作 ×2，再叠加 27 个分组 + 世界书条目的全树 reconcile——这是"输入延迟"的主因，而不是 textarea 本身。

**(c) 自适应高度每键强制回流**
`card-editor.tsx:35-40`：`height='auto'` → 读 `scrollHeight` → 写 `height`。读 `scrollHeight` 会强制同步布局；在滚动容器里每键两次，是明确的布局抖动。

> 注：以上是从代码路径能确定的成本项，**未做真机 profiling**（没有浏览器上下文）；实施后建议用 DevTools Performance 录一段 10k 字输入的火焰图复核。

### 1.3 CCv3 字段全景（编辑器要覆盖的面）

| # | 路径（相对 `data`） | 类型 | 长文本 | 级别 | 注入 | 现状对应 |
|---|---|---|---|---|---|---|
| 1 | `name` | string | — | 必填（只读） | L1 | 「姓名」 |
| 2 | `nickname` | string | — | 选填 | 不注入 | 无（新增能力） |
| 3 | `tags` | string[] | — | 推荐 | 不注入 | 「关键词」 |
| 4 | `creator` | string | — | 选填 | 不注入 | 无 |
| 5 | `description` | string | ✅ 可上万字 | **必填** | L1 | 「一句话背景」+ 声线 + 性格 + 背景（合并） |
| 6 | `personality` | string | ✅ | 推荐 | L1 | 「内在矛盾」「对待亲近之人」 |
| 7 | `scenario` | string | ✅ | 推荐 | L1 | 「关系起点」「此刻在做什么」 |
| 8 | `first_mes` | string | ✅ | **必填** | 首轮 | 「opening」 |
| 9 | `alternate_greetings` | string[] | ✅ 每项多段 | 选填 | 首轮 | 「openings」 |
| 10 | `group_only_greetings` | string[] | ✅ | 选填 | 不用 | 无（V3 新增，本插件无群聊） |
| 11 | `mes_example` | string | ✅ | 推荐 | L1 | 无（新增能力） |
| 12 | `system_prompt` | string | ✅ | 选填 | L1 | 无 |
| 13 | `post_history_instructions` | string | ✅ | 选填 | L1 | 无 |
| 14 | `creator_notes` | string | ✅ | 选填 | 不注入 | 「source」的语义位 |
| 15 | `character_version` | string | — | 选填 | 不注入 | 无 |
| 16 | `character_book` | object | — | 选填 | 检索 | **无（全新）** |
| 17 | `extensions.aiwu.legacy` | object | — | 只读 | 不注入 | 旧 10 组全量 |
| 18 | `assets` / 两个 `*_date` | — | — | 只读 | 不注入 | 无（不编辑，保留） |

合计**可编辑 15 项 + 世界书 + 3 组只读**。字段数从 34 掉到 15，但**单字段体积上升一个数量级**——所以下面 §4 的长文本体验才是这次重构的主战场。

### 1.4 跨文件影响清单（v0.2.0 级别的证据）

| 文件:行 | 现在依赖旧格式 | 后果 | 归属 |
|---|---|---|---|
| `src/prompt.ts:93-123` | `renderCharacterCard` 逐个 `render('基本信息', card['basic'])` … 9 组 | 换成 CCv3 后 L1 段会**渲染出空卡**（全部 undefined） | 后端 · architect |
| `src/store.ts:29-32` | `REQUIRED_FIELDS = ['name','basic','personality','relationship','source']`、`FULL_FIELDS` 9 项 | 校验/完整性判定失真；注意它本来就漏了 4 个字段 | 后端 |
| `src/store.ts:509` | 「忘记某事」遍历 `['memory_anchor','dynamic_state']` 删句子 | 迁移后这两个键不存在 → **忘却功能静默失效**（用户可见的功能回退） | 后端 · P0 |
| `src/tools.ts:123` | `awu_forget` 工具描述点名 memory_anchor / dynamic_state | 模型按旧描述找字段，找不到就瞎删 | 后端 |
| `distill/flow.md:93` | 「字段契约（10 组 34 字段，逐字照抄）」 | 蒸馏产物会按旧格式输出，导入即失配 | distill-designer |
| `client/distill.tsx:31,339,363` | `import { GROUPS }` 做分组校验与标题映射 | `GROUPS` 重写后分组 id 变了 → 校验逻辑静默失效 | distill-designer |
| `presets/*/card.json` | 3 张旧格式预置卡 | 首次启用仍播种旧卡 → **正好当迁移的活体测试用例**（建议保留，见 §6.3） | 后端 |
| `client/card-editor.tsx` | 全文件 | 本轮主体 | 我 |
| `client/styles.ts` | 编辑器相关约 25 条规则 | 需要新增（我的地盘） | 我 |
| `client/text.ts` | `edit.*` 约 25 键 | 新增 + 改写（Lead） | Lead |
| `client/api.ts` | `Card = Record<string, unknown>` | **不用改**（索引签名兜得住 CCv3） | — |
| `src/web.ts:37` | 请求体 4MB 上限 | 200 条世界书 × 2k ≈ 400KB，仍在限内 | — |

---

## 二、编辑器字段结构

### 2.1 九组（8 个内容组 + 1 个迁移/元数据组）

顺序即 UI 顺序。**默认只展开 ①身份 + ②人设**（v0.1 展开的是"基本信息 + 声线"，对应到今天就是这两组）。

| # | id | 中文标题 | 只有 i18n 键 | 字段 | 默认展开 |
|---|---|---|---|---|---|
| ① | `identity` | 身份 | `edit.group.identity` | name(只读) / nickname / tags / creator | ✅ |
| ② | `persona` | 人设 | `edit.group.persona` | description / personality | ✅ |
| ③ | `scene` | 场景 | `edit.group.scene` | scenario | — |
| ④ | `greeting` | 开场 | `edit.group.greeting` | first_mes / alternate_greetings / group_only_greetings | — |
| ⑤ | `example` | 示例对话 | `edit.group.example` | mes_example | — |
| ⑥ | `system` | 系统提示 | `edit.group.system` | system_prompt / post_history_instructions | — |
| ⑦ | `notes` | 作者注 | `edit.group.notes` | creator_notes / character_version | — |
| ⑧ | `lorebook` | 世界书 | `edit.group.lorebook` | `character_book.*`（独立视图，见 §3） | — |
| ⑨ | `meta` | 迁移与元数据 | `edit.group.meta` | extensions（只读）/ legacy（只读）/ 两个日期（只读） | — |

**为什么 ⑧ 单独成视图而不是分组**：世界书是「一列条目、每条又能展开编辑」的二级结构，塞进手风琴会和其它组的视觉语义打架（一个折叠组里再套折叠组，452px 下层级会糊）。所以编辑器顶部加一个**两段式分段器**：`主要内容` / `世界书`，点击切换。（复用我上一轮做的下划线式 tab 视觉，`awu-editorTabs` 一套规则即可。）

### 2.2 `FieldSpec` 新形状（旧的两个字段被替换）

```ts
// card-schema.ts
export type FieldKind =
  | 'text'      // 单行 input
  | 'long'      // 多行；< 800 字内联直编，≥ 800 字降级为预览 + 专注层（见 §4）
  | 'longlist'  // 多行文本数组（alternate_greetings / group_only_greetings）
  | 'chips'     // 字符串数组，逗号/回车成词（tags）
  | 'number'    // 整数输入（世界书书级 scan_depth / token_budget）
  | 'toggle'    // 布尔开关
  | 'readonly'  // 只读展示（name / 日期 / extensions 摘要）

export type FieldLevel = 'required' | 'recommended' | 'optional'
/** 这条字段最终怎么进上下文——决定字数预算与 UI 徽记 */
export type FieldBudget = 'l1' | 'turn0' | 'retrieval' | 'never'

export interface FieldSpec {
  path: string          // 相对 SPEC_ROOT，点分：'description' / 'character_book.scan_depth'
  label: string         // i18n 键，如 'field.description'（不再直接显示英文键名）
  kind: FieldKind
  level: FieldLevel
  budget: FieldBudget
  hint?: string         // i18n 键
  placeholder?: string  // i18n 键
  minChars?: number     // 低于此字数给「建议补全」软提示（不算未填）
  maxChars?: number     // 高于此字数给软警告（不阻断保存）
  default?: string | number | boolean
}

export interface GroupSpec {
  id: string
  title: string         // i18n 键
  hint?: string
  open?: boolean
  fields: FieldSpec[]
  /** 特殊渲染：世界书视图 / 迁移信息 */
  extra?: 'lorebook' | 'legacy'
}
```

**关键变化**（相对 `card-schema.ts:23-58`）：
- `target: 'object'|'top'` + `root` → **`path` 点分路径**。CCv3 有 `data.character_book.entries[i].keys` 这种三级结构，旧的"两级 + 特例"表达不了；`path` 也顺手解决了"存完整信封还是只存 data"（只改 `SPEC_ROOT`）。
- `key`（中文键名，直接当显示名）→ `path`（数据位置）+ `label`（i18n 键）。旧设计"中文键名原样保留"是针对自研格式的；CCv3 的键是英文规范名，**必须**有独立显示名，否则界面上会出现 `post_history_instructions`。
- 新增 `level` / `budget` / `minChars` / `maxChars`：把「必填、进不进上下文、多少字算多」从注释变成数据，完整度与预算条都从这三个字段推导。

### 2.3 各组的控件与体积

| 字段 | kind | 选填 | 建议字数 | 软上限 | 备注 |
|---|---|---|---|---|---|
| `name` | readonly | — | — | — | 等于目录名；只读提示「改名要动目录，暂不支持」 |
| `nickname` | text | ✅ | — | 40 | 显示用别名；后端可用它做"称呼优先"（建议，非要求） |
| `tags` | chips | 推荐 | — | 20 个 | 导出给别的前端看；本插件不注入 |
| `creator` | text | ✅ | — | 60 | |
| `description` | long | **必填** | ≥ 120 | 4000 | 超过 4000 提示"把细节移进世界书" |
| `personality` | long | 推荐 | ≥ 60 | 1500 | |
| `scenario` | long | 推荐 | ≥ 40 | 1000 | |
| `first_mes` | long | **必填** | ≥ 40 | 1200 | 可含动作描写 |
| `alternate_greetings` | longlist | ✅ | — | 每项 1200 | 换一句开场时轮换 |
| `group_only_greetings` | longlist | ✅ | — | 每项 800 | **本插件不用**：标注「仅为导出兼容保留」 |
| `mes_example` | long | 推荐 | ≥ 80 | 2000 | `<START>` 分隔的示例对话 |
| `system_prompt` | long | ✅ | — | 1500 | |
| `post_history_instructions` | long | ✅ | — | 1000 | |
| `creator_notes` | long | ✅ | — | 2000 | 导出给别的前端看 |
| `character_version` | text | ✅ | — | 20 | |
| `character_book` | extra | ✅ | — | — | §3 |

### 2.4 读写路径（唯一一处需要跟 architect 对齐的常量）

```ts
/** CCv3 信封标识 */
export const SPEC_NAME = 'chara_card_v3'
export const SPEC_VERSION = '3.0'
/** 数据根：'data' = 落盘完整信封；'' = 只落盘 data 内容。改这一行即可切换（契约 C1） */
export const SPEC_ROOT = 'data'
/** 旧格式在 extensions 里的键名（契约 C2） */
export const LEGACY_NS = 'aiwu'
```

```ts
function readPath(root: Record<string, unknown>, path: string): unknown
function writePath(root: Record<string, unknown>, path: string, value: unknown): void
```

**空值语义（对 v0.1 的刻意反转）**：v0.1 是"清空就删键"，CCv3 下改成——

- 原卡**已有**该键、用户清空 → 写 `''` / `[]`，**不删键**（互操作格式缺键比空串更容易被别的前端显示成 `undefined`）；
- 原卡**没有**该键、草稿也为空 → **不新增**（不给 15 个字段全塞空串，保持 `card.json` 可读）；
- `name` 永远沿用原值（同 `card-schema.ts:288-290`）。

这条规则必须写进注释，否则下一个人会照着 v0.1 的 `delete` 写法把结构改回去。

---

## 三、世界书条目编辑器（全新 · §2.1 的 ⑧）

### 3.1 书级设置 + 条目列表

```
世界书                                  5 条   ＋新建条目
扫描深度 [ 2 ] 条消息   预算 [ 500 ] tokens   ☐ 递归扫描
─────────────────────────────────────────────────────
┌───────────────────────────────────────────────────┐
│ ●  便利店与便利贴              3 键 · 412 字    ⌄  │
├───────────────────────────────────────────────────┤
│ ○  同一枚钥匙              0 键 · 88 字  ⚠    ⌄  │  ← 无关键词：检索永远命不中
└───────────────────────────────────────────────────┘
```

| 元素 | 尺寸/规则 |
|---|---|
| 视图宽 | 面板内容宽 420px（`452 − 2×16`）|
| 书级行 | 高 32px，输入框 40/56px 宽（数字框），toggle 24px 命中高 |
| 条目行 | 高 48px（两行：备注名 + meta）；`data-issue` 时左侧 2px 危险色轨 |
| 条目行内容 | 左：6px 状态点（`enabled`）／中：`comment` 或首个 key（截断）／右：`3 键 · 412 字` + chevron |
| 空世界书 | 虚线卡片 + 一句话「世界书按关键词触发，适合放具体设定、地名、人物关系」（复用 `.awu-empty`）|
| 排序 | 按 `insertion_order` 升序；**不做拖拽**（零依赖 + 452px 命中区太难做对），用条目内 ↑↓ |
| 删除 | 条目内 danger 按钮 + 二次确认（复用 `.awu-editorConfirm` 那套覆盖层的视觉）|

### 3.2 展开后的条目编辑器（手风琴，不弹层）

```
┌───────────────────────────────────────────────────┐
│ ●  便利店与便利贴              3 键 · 412 字    ⌃  │
├───────────────────────────────────────────────────┤
│ 关键词（必填，命中任一即触发）                      │
│ ┌───────────────────────────────────────────────┐ │
│ │ [便利店 ×] [便利贴 ×] [早饭 ×]                │ │
│ │ 输入后按回车或逗号添加…                        │ │
│ └───────────────────────────────────────────────┘ │
│ 内容                                               │
│ ┌───────────────────────────────────────────────┐ │
│ │ 便利贴有一整叠，颜色按事情分：黄色是吃什么，   │ │
│ │ 蓝色是提醒，粉色是他说不出口的话……             │ │
│ │                                    [ 展开编辑 ]│ │
│ └───────────────────────────────────────────────┘ │
│ ☑ 启用          ☐ 常驻（不看关键词，每轮都带）       │
│ 插入顺序 [100]  ↑ ↓      位置 [ 角色之前 ⌄ ]      │
│ ▸ 更多：次级关键词 / 大小写敏感 / 正则 / 优先级 / 备注│
│                                    [ 删除该条目 ]  │
└───────────────────────────────────────────────────┘
```

| 控件 | 交互规格 |
|---|---|
| **关键词 chips** | 输入框内联在 chips 之后，`Enter` / `,` / `，` / `、` 提交；`Backspace`（输入为空时）删最后一枚；粘贴 `a,b,c` 自动切分；去重（大小写不敏感，保留首次出现的大小写）；单条上限 40 键（超出软警告不阻断）；每枚 chip 24px 高、带 × 按钮（`aria-label` 用 `lore.key.remove`）|
| **内容** | 3 行预览（`line-clamp: 3`，`--awu-lh-body`），右上「展开编辑」进专注层（§4）；单条软上限 2000 字 |
| **启用 / 常驻** | 两个 checkbox 行（`role` 不需要，原生 checkbox + `<label>` 即可；命中区靠整行 padding 撑到 32px）|
| **插入顺序** | `<input type="number">`，整数，min 0；↑↓ 与相邻条目**交换 order 值**（不重排数组、不留空档）；新建条目 `order = max + 1` |
| **位置** | `<select>`：角色之前 / 角色之后（`before_char` / `after_char`）。原生 select，不自己做下拉（452px 内原生下拉更稳）|
| **更多（折叠）** | 次级关键词（chips）/ 大小写敏感 / 选择性 / 正则 / 优先级（number）/ 备注（text）|
| **必填校验** | `keys` 为空 → 条目行标 ⚠ 且**保存时拦截**（弹一条 inline 错误，不弹窗）；`content` 为空 → 只警告不拦截 |

### 3.3 关于 `scan_depth`（与 Lead 需求的一处澄清）

V3 规范里 `scan_depth` / `token_budget` / `recursive_scanning` 都是 **`character_book` 书级**，条目级没有这三个字段。所以：

- 书级：`character_book.scan_depth`（默认 2）/ `token_budget`（默认 500）/ `recursive_scanning`（默认 false）→ 放在世界书视图顶部（§3.1）。
- 条目级：**不放**。若主人坚持"每条单独设深度"，唯一不破坏规范的做法是写 `entry.extensions.aiwu.scan_depth`——但导出到 SillyTavern 等前端时会被忽略。**默认不做**，需要时再加。

### 3.4 结构问题检测（`loreIssues()`，保存前跑）

| code | 触发 | UI |
|---|---|---|
| `no-keys` | `keys` 过滤空串后为空 | 条目行 ⚠ + **拦截保存**，点击滚动到该条目 |
| `empty-content` | `content.trim() === ''` | 条目行 ⚠ + 只警告 |
| `duplicate-keys` | 两条条目共享同一个 key | 两条都标 ⚠ + 警告（不拦截：重叠触发是合法玩法）|
| `order-collision` | 两条 `insertion_order` 相同 | 只警告，提示"顺序不确定，建议错开" |

**为什么只有 `no-keys` 拦截**：没关键词的条目在检索语义上等于不存在，用户填了 500 字却永远不生效——这是"静默失效"，必须拦。其它三项都是"可能是有意为之"，拦了会烦。

---

## 四、长文本编辑体验（本次重构的主战场）

### 4.1 先量化：每敲一个字现在做了什么

| 步骤 | 现状 | 代码位置 |
|---|---|---|
| ① 顶层重渲染 | `setDraft` 在 `CardEditor` 顶层 → 整棵树（9 组 + 世界书 N 条）reconcile | `card-editor.tsx:233-238` |
| ② 脏检查 | `JSON.stringify(toDraft(card))` + `JSON.stringify(draft)`，整卡 20KB 级字符串 **×2** | `card-schema.ts:296-300` 经 `card-editor.tsx:227` |
| ③ 完整度 | `mergeCard()` 全卡浅拷贝 + `filledCount()` 遍历 34 字段 | `card-editor.tsx:228-231` |
| ④ 自适应高度 | `height='auto'` → 读 `scrollHeight`（**强制同步布局**）→ 写 `height`，每键一轮 | `card-editor.tsx:35-40` |
| ⑤ 输入延迟 | 上面四项在同一个 keydown 帧里完成 | — |

一句话：**卡顿不在 textarea，在于「每键全卡序列化 + 全树重渲染 + 强制回流」三件事叠在一起。**

### 4.2 三个方案

| | A 保持现状（只调高度上限） | **B 阈值降级 + 专注层缓冲（推荐）** | C 内嵌双栏（左编辑右预览） |
|---|---|---|---|
| 做法 | 把 240px 提到 480px，别的都不动 | < 800 字内联直编；≥ 800 字降级为 3 行预览 + 「展开编辑」进专注层（层内**本地缓冲**，关闭才提交） | 420px 分左右两栏，左边 textarea 右边预览 |
| 每键成本 | 不变（仍全量序列化 + 全树重渲染）| 内联态：去掉 ②③④；专注态：**父组件零重渲染** | 不变（还多一栏渲染） |
| 10k 字可编性 | 差（240→480px 里滚） | 好（整屏 24 行，14px/1.8） | 极差（每栏 200px 宽） |
| 改动量 | 1 行 | 新增 1 个组件 + 3 处接线 | 布局重写 |
| 452px 适配 | 可以 | 可以 | **不行**（420 / 2 = 210px 一行约 17 字，中文断句碎） |
| 结论 | 不解决 | ✅ 采用 | 否决 |

**C 被否决的硬理由**：452px 面板分两栏后每栏 206px，12px 中文一行只能排 ~17 字，长句断行密度高到没法读；而且预览区还得再引入一个 markdown/沙盒渲染器（零新依赖铁律下等于手写）。

### 4.3 阈值为什么是 800 字（不是拍脑袋）

12px 中文在 388px 内容宽（420 − 左右内距）里约 **34 字/行**；800 字 ≈ **24 行 ≈ 480px**——已经超过现状 textarea 的 240px 上限两倍，也超过面板可视区（约 620px）的大半。再往上，内联编辑就变成"在一个 240px 的盒子里滚 40 行"。
所以规则是：**内联编辑只在"一屏能看全"时用；看不全就换整屏。**

400 字以下的短长文本（scenario、personality 常见区间）保持内联直编，体验不退化。

### 4.4 专注编辑层

```
┌─────────────────────────── 452 ───────────────────────────┐
│ ← 返回        人设描述      2,140 字        [ 完成 ]       │ 头部 44px
├───────────────────────────────────────────────────────────┤
│ 这个角色是……                                              │
│                                                           │
│ （整屏 textarea：14px 衬线 / 行高 1.8 / 内距 16，可滚动）   │
│                                                           │
├───────────────────────────────────────────────────────────┤
│ ⚠ 常驻预算已超 940 字     建议把细节移进世界书              │ 底部 40px
└───────────────────────────────────────────────────────────┘
```

| 项 | 规格 |
|---|---|
| 层级 | 面板内 `position: absolute; inset: 0`，`z-index: var(--awu-z-inset)`（与未保存确认同层，但后打开者压栈在上，见 4.6）|
| 背景 | `var(--awu-surface)`（近不透明，长文编辑必须压住宿主背景）|
| 头部 | 返回按钮（`awu-navBack` 同款）+ 字段标签 + 实时字数 + 「完成」主按钮 |
| 正文 | `--awu-fs-control` 14px 衬线 / `--awu-lh-loose` 1.8 / `padding: var(--awu-gutter)`；**不用** auto-height，直接 100% 高 |
| 底部 | 预算/超限提示（`data-over` 状态）+ 可选「移到世界书」|
| 提交 | 只有三条出口：`完成`（写回）/ `Esc`（丢弃，若与打开时不同则弹二次确认，复用 `.awu-editorConfirm`）/ 点返回（同 Esc）|
| 字数 | `[...text].length`（按码点算，emoji 不会变两字）；只在层内实时算，不参与父渲染 |

**关键实现：本地缓冲**
```tsx
const [text, setText] = useState(value)   // 只在层内变化
// 打字期间父组件（CardEditor）一次都不重渲染 → 上面 ①②③④ 全部为 0
```
代价：层打开期间，底部的「已改动」指示与顶部完整度是**滞后**的（用打开前的 snapshot）。可接受——整屏被层盖住，用户看不到那两个数。

### 4.5 字数、软警告、以及「别把设定塞进人设」

| 触发 | 提示 | 是否阻断 |
|---|---|---|
| `description` > 4000 字 | 「人设 4,120 字。具体设定更适合放世界书（关键词触发），人设保持 2000 字内更像"人"」+ [移到世界书] | 不阻断 |
| `first_mes` > 1200 字 | 「开场白偏长，第一屏会把用户淹掉」 | 不阻断 |
| `mes_example` > 2000 字 | 「示例对话吃常驻预算」 | 不阻断 |
| 常驻合计 > 1200（软）| 头部预算条变黄 + ⚠ | 不阻断 |
| 常驻合计 > 1600（硬）| 头部变红 + 编辑区顶部一条 `.awu-status[data-status="alert"]` | 不阻断（但保存按钮旁出现「仍要保存」态） |
| 世界书 > 200 条 | 「200 条以上检索质量会下降」 | 不阻断 |

**为什么不硬拦**：角色卡是创作物，作者比我们清楚哪句话重要；硬拦只会让人去找"绕过提示"的办法。**但 `no-keys` 例外**（§3.4）——那是功能性失效，不是审美。

**P2 可选：「移到世界书」**
一键把该字段内容转成一条世界书条目（`keys: []`、`comment: '来自人设描述'`、`order = max+1`）、清空字段、并直接打开那条条目的关键词输入框（因为空 keys 会被拦，必须让用户马上补）。成本不高、教学价值极高，但可以放到第二批。

### 4.6 焦点与 Esc 的四层链路（不能破坏 guide-designer 的接线）

现状（`card-editor.tsx:218-225`）是两对：

```ts
useRestoreFocus(true)              // ① 编辑器
useInitialFocus(editorRef, true)
useFocusTrap(editorRef, true)
useRestoreFocus(confirmLeave)      // ② 未保存确认
useInitialFocus(confirmRef, confirmLeave)
useFocusTrap(confirmRef, confirmLeave)
```

**必须原样保留**，专注层作为**第三对**追加在其后（顺序仍是"先还焦记忆、再初始聚焦、最后设陷阱"，`a11y.ts` 的栈会自动让最上层接管 Tab）：

```ts
useRestoreFocus(focusKey !== null)          // ③ 专注编辑层
useInitialFocus(focusRef, focusKey !== null)
useFocusTrap(focusRef, focusKey !== null)
```

Esc 处理器（`card-editor.tsx:251-261`）要加**第一优先级分支**，否则会一次关两层：

```ts
if (event.key !== 'Escape') return
event.stopPropagation()
if (focusKey !== null) { closeFocus(); return }   // ← 新增，必须在 confirmLeave 之前
if (confirmLeave) { setConfirmLeave(false); return }
…
```

`requestClose`（244-248）同理：专注层开着时，关闭动作只关层。

---

## 五、完整度指标重算

### 5.1 三个方案

| | A 全字段二值（沿用） | **B 三级计数（推荐）** | C 加权百分比 |
|---|---|---|---|
| 口径 | 15 个字段 + 世界书算 1 项 → `5/16` | `核心 5/7` + `选填 2/9` + `世界书 3 条` 三个独立读数 | 必填 60% / 推荐 30% / 世界书 10% |
| 优点 | 改得少 | 分母含义清楚；世界书不污染百分比；一眼知道"还差什么级别" | 好看 |
| 缺点 | 世界书一条也算 1 分，10 条世界书能把 15 字段的卡刷到 100% | 头部要放两个数（452px 下勉强够） | 假精度；"世界书多=更完整"是错的 |
| 结论 | 否决 | ✅ 采用 | 否决 |

### 5.2 算法（写进 `card-schema.ts`，纯函数、可单测）

```ts
export interface Completeness {
  core: { filled: number; total: number }      // 必填 + 推荐 = 7
  optional: { filled: number; total: number }  // 选填 = 8
  lore: { entries: number; issues: number }    // 世界书条数与问题数
  short: string[]                              // 填了但低于 minChars 的 path
}

export function completeness(card: Card | undefined): Completeness
```

| 级别 | 字段 | 计数规则 |
|---|---|---|
| 必填 | `name`（只读，恒算已填）/ `description` / `first_mes` | 3 项，`name` 白送 1 分 |
| 推荐 | `personality` / `scenario` / `tags` / `mes_example` | 4 项 |
| 选填 | `nickname` / `creator` / `creator_notes` / `system_prompt` / `post_history_instructions` / `alternate_greetings` / `character_version` / `group_only_greetings` | 8 项 |
| 世界书 | `character_book` | 只报条数与问题数，**不进百分比** |

**显示**（头部右侧两个 pill，10px 等宽）：
```
[ 核心 5/7 ]  [ 选填 2/9 ]                        ← 正常
[ 核心 5/7 ]  [ 常驻 1,240/1,200 ⚠ ]              ← 超预算时用预算条顶掉选填
```
世界书条数放在世界书视图标题右侧（`世界书 · 5 条`），不占头部。

**第三态「偏短」**：`minChars` 命中时该字段在组内标黄点、`short[]` 里记 path；组头计数仍算"已填"（不惩罚），只在组展开时于字段下方给一句"建议再具体一点"。

---

## 六、迁移后的兼容展示

### 6.1 检测

```ts
/** 旧格式迁移过：extensions.aiwu.legacy 是非空对象 */
export function legacyInfo(card: Card | undefined): { legacy: Record<string, unknown>; from: string; at: string } | null
```

### 6.2 编辑器里的三处呈现

**(1) 编辑区顶部横幅**（复用上一轮做好的状态带，零新样式）

```tsx
<div className="awu-status" data-status="info">
  <span style={{ flex: 1 }}>{t('migrate.banner', { from, at })}</span>
  <button type="button" className="awu-btn" data-size="sm" onClick={() => setSection('meta')}>
    {t('migrate.viewLegacy')}
  </button>
</div>
```

> 注意：`.awu-status` 是我上一轮在 `styles.ts` 里加的通用状态带（四态一形）；这里直接复用 `data-status="info"`，不需要新 CSS。

**(2) ⑨ 元数据组里的只读 JSON**
```
迁移来源                                    v0.1 → CCv3
旧格式 34 个字段全部保留：                  34/34 ✓
┌───────────────────────────────────────────────┐
│ {                                             │  ← pre，等宽 10px，最高 240px
│   "basic": { "姓名": "虞照", … },              │     可滚动，pre-wrap
│   "voice": { … }                              │
└───────────────────────────────────────────────┘
```

**(3) 只字不放**：`mergeCard` 对 `path` 以 `extensions` 开头的字段一律**跳过写入**（白名单式），并在函数上写死这条注释——任何"顺手把 extensions 也纳管"的改动都会毁掉迁移凭证。

### 6.3 迁移映射（这部分归 architect，编辑器只消费结果）

编辑器只需要知道"结果长什么样"。为免实施时抓瞎，下面是我建议的默认映射（对应契约 C2；若 architect 定稿不同，只影响 `src/store.ts` 的迁移函数与 §6.2 的文案，不影响编辑器结构）：

| 旧字段 | 去向 |
|---|---|
| `basic.姓名` | `data.name`（本来就一致）|
| `basic.年龄` / `basic.身份` / `basic.一句话背景` | `description` 的「基本信息」小节 |
| `voice.*`（7 项）| `description` 的「声线」小节 **+** `extensions.aiwu.voice` 结构化保留（保住「声线优先注入」的原设计意图）|
| `personality.*` | `personality` |
| `relationship.*` + `dynamic_state.此刻在做什么` | `scenario` |
| `world.*` / `user_persona.*` | `description` 的「背景 / 你」小节 |
| `memory_anchor.要点` | 世界书条目 1 条（keys 取要点里的高频名词，content 为整段）或全部塞 `extensions.aiwu.legacy`——**建议前者**，否则记忆锚点在新格式里无处安放 |
| `interaction_pref.*` | `post_history_instructions`（"回复长度/表情/雷区"本来就是行为约束）|
| `opening` | `first_mes` |
| `openings` | `alternate_greetings` |
| `source` | `creator_notes`（或丢弃；`source` 是插件内部字段）|
| **整张旧卡** | `extensions.aiwu.legacy`（原样，34 字段 100% 保留）|

**presets 的处理建议**：3 张旧预置卡**保持旧格式不动**，让它们每次全新安装都真跑一遍迁移函数——这是最便宜、最持续有效的迁移回归测试。迁移后必须断言 `legacy` 里 34/34 键都在。

---

## 七、改动清单（文件:行）

### 7.1 `client/card-schema.ts` —— 整体重写（318 行 → 约 430 行）

| 区块 | 现状行 | 处置 |
|---|---|---|
| 文件头注释（三条约束）| 1-13 | 重写：约束变成「CCv3 是互操作格式，缺键比空串更糟」「extensions 只读」「未知键不丢」|
| `FieldKind` | 17-20 | 扩到 7 种（`text/long/longlist/chips/number/toggle/readonly`）|
| `FieldSpec` | 23-32 | 换成 `path/label/kind/level/budget/hint/placeholder/minChars/maxChars/default` |
| `GroupSpec` | 35-58 | `root`/`target` → `extra?: 'lorebook'|'legacy'`；`soul`/`optional` → `level` |
| `GROUPS` | 66-194 | 换成 9 组（§2.1）|
| `Draft` | 197 | 换成 `{ fields: Record<string, FieldValue>; entries: LoreEntryDraft[] }` |
| `asList`/`asText` | 200-212 | 保留并加 `asBool`/`asNumber` |
| `toDraft` | 215-229 | 按 `path` 读；`chips`/`longlist` 走 asList |
| `isEmptyValue` | 232-235 | 保留 |
| `mergeCard` | 245-293 | 按 `path` 写；空值语义反转（§2.4）；`extensions` 跳过；`name` 强制沿用 |
| `isDirty` | 296-300 | 保留签名，内部改 shallow-equal（避免整卡 stringify）|
| `filledCount` | 303-318 | 换成 `completeness()`（§5.2），旧函数可留一版 `filledCount` 兼容壳给 `distill.tsx` 过渡 |
| 新增 | — | `SPEC_NAME`/`SPEC_VERSION`/`SPEC_ROOT`/`LEGACY_NS`/`L1_SOFT_BUDGET`/`L1_HARD_BUDGET`/`readPath`/`writePath`/`legacyInfo`/`budgetChars`/`leads`/`LEGACY_GROUP_TITLES` |

**迁移兼容壳（必须）**：`distill.tsx:31,339,363` 依赖 `GROUPS` 的 `id`/`title`。重写后 `GROUPS` 的 id 全变，所以保留导出 `LEGACY_GROUP_TITLES: Record<string, string>`（旧 10 组 id → 中文标题），让 distill 侧一行改动接上，而不是去重写它的校验。

### 7.2 `client/lorebook-schema.ts` —— 新建（约 180 行）

```ts
export const BOOK_DEFAULTS = { name: '', description: '', scan_depth: 2, token_budget: 500, recursive_scanning: false }
export const ENTRY_DEFAULTS = { enabled: true, constant: false, insertion_order: 100, case_sensitive: false,
                                selective: true, position: 'before_char', priority: 10, use_regex: false }

export interface LoreEntryDraft {
  id: string                 // 本地稳定 id（React key + 合并对齐），不落盘
  keys: string[]; secondaryKeys: string[]
  content: string; comment: string
  enabled: boolean; constant: boolean
  insertionOrder: number; priority: number
  position: 'before_char' | 'after_char'
  caseSensitive: boolean; selective: boolean; useRegex: boolean
  unknown: Record<string, unknown>   // 该条目上不属于规范字段的内容，原样带回
}

export function toLoreDraft(book: unknown, seed?: string): { book: BookDraft; entries: LoreEntryDraft[] }
export function mergeLore(book: unknown, draft: BookDraft, entries: LoreEntryDraft[]): Record<string, unknown>
export function loreIssues(entries: LoreEntryDraft[]): LoreIssue[]
export function nextInsertionOrder(entries: LoreEntryDraft[]): number
export function moveEntry(entries: LoreEntryDraft[], from: number, to: number): LoreEntryDraft[]
export function normalizeKeys(raw: string): string[]      // 逗号/顿号/换行切分 + trim + 去重
```

### 7.3 `client/card-editor.tsx` —— 按行号的 15 处

| # | 行 | 现状 | 改成 |
|---|---|---|---|
| E1 | 24-62 | `TextField`（自适应高度） | **删除**，迁进 `editor-fields.tsx` 的 `InlineText`（阈值降级 + 字数）|
| E2 | 64-117 | `ListField`（`key={index}`，单行） | **删除**，迁进 `editor-fields.tsx`；`longlist` 走自动高 160px；key 用稳定 id（同 §7.2 的 `id` 思路）|
| E3 | 119-190 | `FieldGroup` 组头 4 件套（标题/灵魂徽/选填徽/计数） | 组头改 5 件：标题 + `data-level` 徽 + `data-budget` 徽 + 计数 + chevron；组体按 `kind` 分发（`lorebook`/`legacy` 走特殊分支）|
| E4 | 205 | `useState(toDraft(card))` | `useState<Draft>(() => toDraft(card))`（新 Draft 形状：`{fields, entries}`）|
| E5 | 207-211 | `openGroups` 按 `GROUPS` | 保留，默认开 ①身份 ②人设 |
| E6 | 212-216 | `confirmLeave` / refs | 新增 `section: 'main'|'lore'`、`focusKey: string|null`、`focusRef` |
| E7 | 218-225 | a11y 两对 hook | **一行不动**，在其后追加专注层三件套（§4.6）|
| E8 | 227-231 | `dirty`/`progress` 每渲染全量算 | `dirty` 改 `revision` 计数（`setField` 里 +1）；`progress` 改 300ms 防抖的 `useMemo`（或只在折叠/保存时算）|
| E9 | 244-248 | `requestClose` | 前置：`if (focusKey !== null) { setFocusKey(null); return }` |
| E10 | 251-261 | Esc 处理 | 前置 focusKey 分支（§4.6 代码）|
| E11 | 271-296 | 头部：kicker/名字/进度/关闭 | 撕成三段：① kicker+名字 ② 两个 pill（核心/预算）③ 分段器（主要内容/世界书）|
| E12 | 298-301 | 只读提示 | + 迁移横幅（`legacyInfo` 非空时，复用 `.awu-status`）|
| E13 | 309-323 | `GROUPS.map` 单列 | `section === 'main' ? GROUPS.map(…) : <LoreEditor …/>` |
| E14 | 326-342 | 底部条 | 保存前跑 `loreIssues`：有 `no-keys` 则拦截并滚动到该条目；dirty 文案加 issue 数 |
| E15 | 344-363 | 未保存确认 | 保留；文案追加"另有 N 条世界书未填关键词"（可选）|

> 说明：E7 是**唯一必须零改动**的地方；guide-designer 的 `useRestoreFocus/useInitialFocus/useFocusTrap` 接线（含注释）保持原样，只在它下面追加第三对。

### 7.4 三个新文件

| 文件 | 行数估计 | 职责 | 依赖 |
|---|---|---|---|
| `client/editor-fields.tsx` | ~200 | `InlineText`（阈值降级 + 字数）/ `ChipsField` / `NumberField` / `ToggleField` / `LongList` | 只依赖 `card-schema.ts` 的类型 |
| `client/editor-focus.tsx` | ~120 | 专注编辑层（本地缓冲 + 提交/丢弃 + 预算提示）| `a11y.ts`、`text.ts` |
| `client/lore-editor.tsx` | ~260 | 世界书视图：书级设置 + 条目列表 + 条目手风琴（chips/content/toggles/order/advanced）| `lorebook-schema.ts`、`editor-fields.tsx` |

拆分的理由：`card-editor.tsx` 现在 366 行，把世界书与专注层塞进去会到 800 行以上（和 `index.tsx` 一样的单文件问题）。按"数据 / 原子控件 / 独立视图 / 壳"四层切开，壳稳定在 350 行内。

### 7.5 `client/text.ts` 新增键（Lead 合，见附录 A 全表）

新增 **66 个键**（`field.*` 15 + `edit.*` 21 + `migrate.*` 3 + `lore.*` 27），全部 zh/en 双份。旧的 `edit.soulBadge` / `edit.optional` 保留（`level` 徽记继续用它们）。

### 7.6 `client/styles.ts` 新增规则（我的地盘，约 180 行）

| 类名 / 选择器 | 用途 | 关键 token |
|---|---|---|
| `.awu-editorTabs` / `.awu-editorTab[data-active]` | 编辑器内两段式分段器 | 复用 `--awu-fs-body-lg` / `--awu-gap-*` / `--awu-grad` |
| `.awu-budget` / `.awu-budget[data-over="true"]` | 头部预算 pill | `--awu-fs-caption` / `--awu-danger` / `--awu-gold` |
| `.awu-levelTag[data-level]` / `.awu-budgetTag[data-budget]` | 组头与字段的级别/注入徽记 | `--awu-r-pill` / `--awu-ink-mute` |
| `.awu-fieldCount` | 字段右上角字数 | `--awu-fs-micro` / `--awu-mono` |
| `.awu-focus` / `.awu-focusHead` / `.awu-focusBody` / `.awu-focusFoot` | 专注层 | `--awu-z-inset` / `--awu-surface` / `--awu-fs-control` / `--awu-lh-loose` |
| `.awu-chips` / `.awu-chip` / `.awu-chipX` / `.awu-chipInput` | 多值输入 | `--awu-r-pill` / `--awu-gap-3` / `--awu-size-hit` |
| `.awu-loreList` / `.awu-loreRow[data-issue]` / `.awu-loreRow[data-enabled]` | 条目列表 | 左 2px 轨用 `data-issue`（同状态带语法）|
| `.awu-loreBody` / `.awu-loreAdv` | 条目手风琴 | `--awu-gap-4` |
| `.awu-switchRow` | 启用/常驻 | 整行 32px 命中区 |
| `.awu-legacyJson` | 旧卡 JSON 预览 | `--awu-mono` / `--awu-fs-caption` / `max-height: 240px` |
| `.awu-issue` | 行内错误 | `--awu-danger` + `role="alert"` |

新增 `data-*` 共 6 个：`data-level`、`data-budget`、`data-over`、`data-active`、`data-issue`、`data-enabled`（全部有 CSS 消费者，不做纯标记）。

### 7.7 受牵连的并行模块

| 文件:行 | 影响 | 建议 |
|---|---|---|
| `client/distill.tsx:31,339,363` | `GROUPS` 形状变了；`missingGroups` 的 id 仍是旧 10 组 | 我在 `card-schema.ts` 里保留 `LEGACY_GROUP_TITLES`；distill 侧把 `GROUPS.map(g => g.title)` 换成查这张表（1 行改动）|
| `distill/flow.md:93` | 「10 组 34 字段逐字照抄」契约作废 | distill-designer 按 CCv3 重写第四节，并把「照抄 34 字段」改成「按 15 字段契约输出 CCv3 JSON」|
| `src/distill.ts` | `POST /distill/parse` 的校验按旧分组 | 换用新 `completeness` + `loreIssues` 的同构逻辑（后端自己实现，字段表共用文档）|

### 7.8 后端依赖（编辑器不负责，但会挡住功能）

| # | 文件:行 | 要做什么 |
|---|---|---|
| B1 | `src/prompt.ts:93-123` | `renderCharacterCard` 改读 CCv3：`description/personality/scenario/mes_example/system_prompt/post_history_instructions` + 世界书命中的条目；**保留"声线优先"**（若迁移时把 `voice` 结构化存进了 `extensions.aiwu.voice`，这里优先渲染它）|
| B2 | `src/store.ts:29-32` | `REQUIRED_FIELDS`/`FULL_FIELDS` 换 CCv3（`name`/`description`/`first_mes`）|
| B3 | `src/store.ts:509` | 忘却逻辑改到「`description`/`personality` 正文 + `character_book.entries[].content` + `extensions.aiwu.legacy`」三处；**这是 P0，不改就是功能静默失效** |
| B4 | `src/tools.ts:123` | `awu_forget` 描述同步 |
| B5 | `src/store.ts`（新增）| 读卡时做 §6.3 迁移；写卡时落 CCv3 信封（契约 C1）|
| B6 | `src/index.ts:152` | presets 播种路径不变（旧格式 → 首次读取即迁移）|

---

## 八、实施顺序与风险

**依赖关系**：schema（纯数据）→ 原子控件 → 独立视图 → 壳接线 → 样式/文案 → 并行模块对齐 → 后端。

| 步 | 内容 | 依赖 | 可并行 |
|---|---|---|---|
| 1 | 契约冻结（architect 稿落地，核对 §〇 的 C1-C6）| — | — |
| 2 | `card-schema.ts` 重写 + `lorebook-schema.ts` 新建（纯函数，先写 `completeness`/`loreIssues`/`mergeCard` 的单测式自检）| 1 | 与 3、6 并行 |
| 3 | `editor-fields.tsx` + `editor-focus.tsx` | 2 | 与 4 并行 |
| 4 | `lore-editor.tsx` | 3 | — |
| 5 | `card-editor.tsx` 15 处接线（E1-E15）| 2/3/4 | — |
| 6 | `styles.ts` 新增 11 组规则（我的地盘）| 2（类名先定）| 与 2-4 并行 |
| 7 | `text.ts` 38 键（Lead）| 2 | 与 2 并行 |
| 8 | `distill.tsx` 兼容 + `flow.md` 重写 | 2 | 与 5 并行 |
| 9 | 后端 B1-B6 | 1 | 与 2-8 并行（独立文件） |
| 10 | 迁移回归：3 张 preset 全新安装 → `legacy` 34/34 | 2/9 | — |

**风险与缓解**

| 风险 | 影响 | 缓解 |
|---|---|---|
| 迁移丢字段 | 用户旧卡被洗 | presets 当活体用例，断言 34/34；`extensions` 白名单跳过 |
| Esc 关面板（§1.2a） | 编辑内容丢失 | `index.tsx:1050` 补 `&& !editing`，**先于**所有编辑功能修 |
| 四层焦点栈 | Tab 跑出层或卡死 | 严格照 §4.6 顺序追加；手验清单覆盖 4 层 |
| `no-keys` 拦截太硬 | 用户存不了卡 | 行内错误 + 一键滚动定位；不弹窗 |
| 世界书条目多时全树重渲染 | 卡顿回潮 | 条目行 `React.memo`，只有展开那条挂编辑控件；折叠态只渲染摘要 |
| 保存体超 4MB | 保存失败 | 200 条软警告；单卡实际远低于上限（200×2k=400KB）|

---

## 九、验收清单

机检：

```
npm run typecheck:client          # 0 error
npm run build                     # 三套自检全绿
grep -n "font-size" client/card-schema.ts   # 期望为空：编辑器样式只在 styles.ts
node -e "…"                       # 迁移 3 张 preset：legacy 键数 = 34/34（手写一次性脚本，不入库）
```

手验（活面板）：

1. 打开旧卡（虞照）→ 顶部出现「由 v0.1 迁移」横幅 → ⑨ 组里能看到 34 个旧键的 JSON。
2. 编一张新卡：只填 name + description + first_mes → 头部 `核心 3/7`；补 personality/scenario/tags/mes_example → `7/7`。
3. description 粘 10,000 字 → 内联变 3 行预览 + 「展开编辑」；进专注层打字**无可感延迟**（DevTools 火焰图每帧 < 16ms）。
4. 专注层里按 Esc → 只关层，编辑器还在；再按 Esc → 出「未保存」确认（面板**不能**被一起关掉，§1.2a 已修）。
5. 世界书新建一条不填关键词就保存 → 拦截 + 滚动定位 + 行内错误。
6. 关键词输入：输入 `便利店,便利贴、早饭` 一次成 3 枚 chips；`Backspace` 删最后一枚；重复词不重复添加。
7. 条目 ↑↓ 交换后 `insertion_order` 互换、列表顺序随之变化。
8. 未保存确认层打开时 Tab 只在确认卡内循环；关掉后回到编辑器；专注层同理。
9. 切浅色主题：chips / 徽记 / 专注层 / 世界书行全部走 token，无亮金残留。
10. 中英切换：15 个字段标签、66 条新文案全部有英文，不出现 `field.description` 这种裸键名。

---

## 附录 A · i18n 键表（66 个，zh / en 各一份）

| 键 | zh | en |
|---|---|---|
| `field.name` | 姓名 | Name |
| `field.nickname` | 别称 | Nickname |
| `field.tags` | 标签 | Tags |
| `field.creator` | 作者 | Creator |
| `field.description` | 人设描述 | Description |
| `field.personality` | 性格 | Personality |
| `field.scenario` | 场景 | Scenario |
| `field.first_mes` | 开场白 | First message |
| `field.alternate_greetings` | 备选开场 | Alternate greetings |
| `field.group_only_greetings` | 群聊开场 | Group-only greetings |
| `field.mes_example` | 示例对话 | Example dialogue |
| `field.system_prompt` | 系统提示 | System prompt |
| `field.post_history_instructions` | 历史后指令 | Post-history instructions |
| `field.creator_notes` | 作者注 | Creator notes |
| `field.character_version` | 角色版本 | Character version |
| `edit.group.identity` | 身份 | Identity |
| `edit.group.persona` | 人设 | Persona |
| `edit.group.scene` | 场景 | Scene |
| `edit.group.greeting` | 开场 | Greetings |
| `edit.group.example` | 示例对话 | Examples |
| `edit.group.system` | 系统提示 | System |
| `edit.group.notes` | 作者注 | Notes |
| `edit.group.lorebook` | 世界书 | Lorebook |
| `edit.group.meta` | 迁移与元数据 | Migration & meta |
| `edit.section.main` | 主要内容 | Main |
| `edit.section.lore` | 世界书 | Lorebook |
| `edit.budget` | 常驻 | Always-on |
| `edit.budgetOver` | 超出常驻预算 {n} 字 | Over budget by {n} chars |
| `edit.completeness.core` | 核心 | Core |
| `edit.completeness.optional` | 选填 | Optional |
| `edit.chars` | {n} 字 | {n} chars |
| `edit.focus.open` | 展开编辑 | Edit full screen |
| `edit.focus.done` | 完成 | Done |
| `edit.focus.discard` | 丢弃这次修改？ | Discard these edits? |
| `edit.groupOnlyHint` | 本插件不用，仅为导出兼容保留 | Unused here; kept for export |
| `edit.moveToLore` | 移到世界书 | Move to lorebook |
| `migrate.banner` | 这张卡由 {from} 迁移而来，原始字段完整保留 | Migrated from {from}; original fields preserved |
| `migrate.viewLegacy` | 查看原始字段 | View original fields |
| `migrate.kept` | 旧格式 {n} 个字段全部保留 | All {n} legacy fields preserved |
| `lore.title` | 世界书 | Lorebook |
| `lore.count` | {n} 条 | {n} entries |
| `lore.add` | 新建条目 | New entry |
| `lore.empty` | 世界书按关键词触发，适合放具体设定、地名、人物关系 | Entries trigger on keywords — good for concrete facts |
| `lore.keys` | 关键词（必填，命中任一即触发）| Keys (required; any hit triggers) |
| `lore.keysPlaceholder` | 输入后按回车或逗号添加 | Type, then Enter or comma |
| `lore.key.remove` | 移除关键词 {k} | Remove key {k} |
| `lore.content` | 内容 | Content |
| `lore.enabled` | 启用 | Enabled |
| `lore.constant` | 常驻（不看关键词，每轮都带）| Constant (always injected) |
| `lore.order` | 插入顺序 | Insertion order |
| `lore.position` | 位置 | Position |
| `lore.position.before` | 角色之前 | Before character |
| `lore.position.after` | 角色之后 | After character |
| `lore.advanced` | 更多 | Advanced |
| `lore.secondary` | 次级关键词 | Secondary keys |
| `lore.caseSensitive` | 大小写敏感 | Case sensitive |
| `lore.useRegex` | 正则匹配 | Regex |
| `lore.priority` | 优先级 | Priority |
| `lore.comment` | 备注 | Comment |
| `lore.remove` | 删除该条目 | Delete entry |
| `lore.scanDepth` | 扫描深度（条消息）| Scan depth (messages) |
| `lore.tokenBudget` | 预算（tokens）| Budget (tokens) |
| `lore.recursive` | 递归扫描 | Recursive scanning |
| `lore.issue.noKeys` | 没有关键词，这条永远不会被触发 | No keys — this entry can never trigger |
| `lore.issue.emptyContent` | 内容为空 | Content is empty |
| `lore.issue.dupKeys` | 与其它条目共用关键词：{k} | Key also used by another entry: {k} |

> 这张表就是新增键的全集（66 条），不含任何"推测可能需要的键"；实施时两边字典键名必须逐字一致，多一条少一条都算不一致。

---

## 附录 B · 与旧 schema 的字段对照（实施时照这张表核）

| 旧 10 组 | 新位置 | 是否保留在 legacy |
|---|---|---|
| `basic`（4）| `description` 首段 | ✅ 全量 |
| `voice`（7）| `description` 的声线段 + `extensions.aiwu.voice` | ✅ 全量 |
| `personality`（3）| `personality` / `tags` | ✅ 全量 |
| `relationship`（3）| `scenario` | ✅ 全量 |
| `world`（4）| `description` 背景段 | ✅ 全量 |
| `memory_anchor`（1）| 世界书条目（建议）| ✅ 全量 |
| `dynamic_state`（3）| `scenario` / `description` | ✅ 全量 |
| `interaction_pref`（4）| `post_history_instructions` | ✅ 全量 |
| `user_persona`（3）| `description` 的你段 | ✅ 全量 |
| `opening`（`opening` + `openings`）| `first_mes` + `alternate_greetings` | ✅ 全量 |

**合计 34/34，无一丢弃**——编辑器 ⑨ 组里的「34/34 ✓」就是按这张表核出来的数字。

