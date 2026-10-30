# 角色卡编辑器 · CCv3 重构设计 **v2**（对齐 `2026-10-30-tavern-card.md`）

> **v2 修订说明（必读，3 条）**
> 1. 本文件是 v1 的替换版。v1 的核心假设被 `docs/design/2026-10-30-tavern-card.md`（下称**架构稿**）推翻了：v1 让用户直接编辑 CCv3 原生字段（`description` / `personality` …），而架构稿 **D3** 定死了「结构 → 原生」的**单向投影**，`§8.2` 明确写「编辑用旧 34 字段视图」。直接编辑原生字段会在下一次投影时被**静默覆盖**，所以 v1 的字段结构必须改。
> 2. 改完之后**改动量反而小了很多**：`client/card-schema.ts` 不再需要整体重写（34 字段的 `GROUPS` 原样保留，只加元数据与新视图），`saveCharacter` 的传输形状不变（后端用 `fromLegacyView` 合并）。唯一新增的写完路径是世界书（§7.4 / C7）。
> 3. v1 里仍然成立的部分（世界书编辑器、长文本专注层、迁移展示、性能分析）保留并更新；**所有长度阈值换成架构稿 §5.1 的数字**（v1 的 1200/1600/4000 是自拟的，作废）。
>
> 行号基准：`main` 1024514 工作副本；`client/card-editor.tsx` 366 行、`client/card-schema.ts` 318 行、`client/styles.ts` 2176 行。
> 视觉口径沿用 `docs/design/2026-10-30-panel-ui.md`：452px 面板、`--awu-fs-*`、`--awu-*`、`data-*`、中英双份。
>
> **状态（2026-10-30，Lead 已拍板）**
> - 编辑面 **A 采纳**：结构是权威、原生是对外兼容的出口（拍板理由记在 §1.1 末尾）。
> - **C7 三键保存成立**，由 `tavern-architect` 在 `src/web.ts` / `src/store.ts` 实施；编辑器线不碰这两个文件。
> - 代码**尚未开工**：等 architect 的 `src/tavern.ts` 实际形状落地后，按 §8 的步骤 2-10 执行。

---

## 〇、契约：已冻结 7 条 + 待拍板 1 条

**已冻结**（直接引用架构稿，不再"假设"）：

| # | 事实 | 出处 |
|---|---|---|
| F1 | 落盘是**完整 CCv3 信封** `{spec, spec_version, data}` | D1 / §1.1 |
| F2 | 自制卡的结构存在 `data.extensions.aiwu.*`（`schema:1`），原生字段是它的**单向投影** | D2 / D3 / §1.5 |
| F3 | 编辑面 = **旧 34 字段视图**（`toLegacyView`），写完由 `fromLegacyView` 合回结构 | §8.2 / §6.5 |
| F4 | 世界书直接改 `data.character_book.entries`，**不新增 REST** | §8.2 |
| F5 | 长度/预算指标**不落盘**，`GET` 时现算（`aiwu.length`）| §8.2 |
| F6 | 迁移留痕 `aiwu.legacy = {from, at, originalName, extra}`；外部卡原文保真 `aiwu.imported.raw` | §1.4 |
| F7 | 长度**不设硬上限**、**不拒绝保存**，只有软警告（阈值见架构稿 §5.1）| D9 / §5.2 |

**待拍板 —— C7：一次保存要同时带"结构"和"世界书"**

架构稿 §8.2 说世界书直接改 `ccv3.data.character_book.entries`，而结构编辑走 `{name, card: 旧视图}`。**同一次保存往往两边都改了**，现在两个入口各缺一半：

- 只发 `{name, card}` → 世界书改动丢失（`fromLegacyView` 只认结构字段）；
- 只发 `{name, ccv3}` → 结构改动就得客户端实现 `fromLegacyView`（等于把后端映射抄一份，必然漂移）。

**建议**：`POST /character/save { name, card: <34 字段视图>, ccv3: <完整对象> }`，后端顺序 `fromLegacyView(card, ccv3)` → 用 `ccv3.data.character_book` 覆盖 → `writeCard`。约 15 行，落在 `src/web.ts` 的 save handler + `src/store.ts` 的 `writeCard` 入参。
**✅ 已拍板（2026-10-30）**：三键并存成立；`src/web.ts` / `src/store.ts` 归 **tavern-architect** 实施，编辑器线只负责把 `{card, ccv3}` 组装好传给 `saveCharacter`。下面这条原建议保留作实现依据。
**不定的后果**：世界书只能靠"保存两次"（有中间态）或"客户端抄映射"（必然漂移）。

---

## 一、编辑器到底编辑什么（本次最关键的决策）

### 1.1 两个编辑面，只能选一个当权威

| | **A 编辑结构（推荐）** | B 编辑 CCv3 原生字段 |
|---|---|---|
| 用户看到 | 「声线基因 / 关系定位 / 故事背景」这套中文语义字段（= 今天的样子）| `description` / `personality` / `scenario` / `first_mes` … 七段规范字段 |
| 权威 | `extensions.aiwu.*`，写完投影出原生字段 | 原生字段本身 |
| 与 D3 | ✅ 一致 | ❌ 冲突（投影会覆盖用户输入）|
| 要改后端 | 不用（`fromLegacyView` 现成）| 要推翻 D3：投影改成"结构为空才生成"，还要新增"手工字段锁" |
| 导入卡 | 结构由 `deriveFromNative` 反解；反解不出的进"未映射"区（§6.3）| 直接显示原文，编辑即生效（对导入卡更顺）|
| 自制卡 | 逐字段可编、可投影、可回滚 | 改 `description` 后，下次改结构字段就被投影覆盖 → **静默丢字** |
| 改动量 | 编辑器加一个只读预览视图 | `card-schema.ts` 重写 + 后端投影改向 + 新增锁 |

**推荐 A**。理由不是省事，是**一致性**：一张卡不能有两个权威。架构稿把结构定为权威（D3）、原生定为输出（D2），编辑器反过来就是制造第二套真相——而消灭"两套真相"正是这次格式重构的目的（架构稿 §1.2 原话：转换层漏一个键就静默丢数据）。

> **✅ 已拍板（2026-10-30，Lead）**：采纳 A。补充理由值得写进实现注释——架构稿的单向投影是**产品判断**而非工程逃避：我们的 34 字段是**为扮演优化的 schema**（声线优先、关系定位、动态状态），比酒馆那七段原生字段更贴合"演一个人"；让用户编辑原生字段再投影回去，等于把产品最核心的那层降级成"酒馆卡的皮"。**CCv3 是对外兼容的出口，不是内部真相。**

**但你的 brief 是对的**：用户确实需要**看见**七段原生字段长什么样（导出给 SillyTavern 时"description 里到底写了什么"是真实需求）。所以 A 不是"不给原生字段"，而是**给只读预览**（§2.3）：能看、能复制、能确认导出效果；要改则回结构改。

### 1.2 编辑器 = 三个视图

```
人设（结构·可编辑）        世界书（可编辑）        CCv3（只读预览）
10 组 / 34 字段           book 设置 + entries     7 段投影 + 元数据 + 未映射 + 完整 JSON
```

用编辑器头部的**分段器**切换（`data-active`），复用上一轮做的下划线视觉。默认 `人设`。

**为什么不把「迁移」单列成第 4 个视图**：迁移/导入信息属于"这张卡从哪来"，和 CCv3 预览同一个心智模型（"导出的卡长什么样"），放一起省一次跳转。

---

## 二、三个视图的字段结构

### 2.1 视图一 · 人设（结构，沿用今天的 10 组 34 字段）

**`GROUPS` 一行不改**（`card-schema.ts:66-194`）。它就是 `extensions.aiwu` 的镜像视图（架构稿 §2.2 的 34 行映射表逐行对得上），改它就是给自己造迁移。

只做三件加法（都是**元数据**，不动字段本身）：

```ts
export interface FieldSpec {
  key: string                 // 中文键名（数据键，不变）
  kind: FieldKind             // 不变：text / long / list
  placeholder?: string
  itemPlaceholder?: string
  /** + 新增：投影到哪一段原生字段（只读展示用，§2.3） */
  projectsTo?: 'description' | 'personality' | 'scenario' | 'system_prompt'
             | 'post_history_instructions' | 'first_mes' | 'alternate_greetings' | null
  /** + 新增：进不进 L1 常驻（预算/徽记用；与架构稿 §1.4「进 L1」列逐字对齐） */
  budget?: 'l1' | 'turn0' | 'never'
  /** + 新增：低于此字数给"建议补全"提示，不算未填 */
  minChars?: number
}

export interface GroupSpec {
  // …原有字段不变…
  /** + 新增：特殊视图，不是普通字段组 */
  extra?: 'lorebook' | 'native'
}
```

`projectsTo` 取值表（照抄架构稿 §2.2，一行不差）：

| 旧字段 | projectsTo | budget |
|---|---|---|
| `basic.身份` / `basic.一句话背景` | `description` | l1 |
| `voice.对话节奏` / `爱用句式` / `自称` / `对用户的称呼` / `情绪口头禅` / `非语言小动作` | `system_prompt` | l1 |
| `voice.禁忌词` | `post_history_instructions` | l1 |
| `personality.关键词` / `内在矛盾` / `对待亲近之人` | `personality` | l1 |
| `world.*`（4 项）| `scenario` | l1 |
| `interaction_pref.回复长度倾向` / `表情使用` / `话题舒适区` | `system_prompt` | l1 |
| `interaction_pref.雷区` | `post_history_instructions` | l1 |
| `relationship.*`（3 项）| `null`（不进原生）| l1 |
| `user_persona.*`（3 项）| `null` | l1 |
| `dynamic_state.*`（3 项）| `null`（易变块）| l1 |
| `memory_anchor.要点` | `null`（当 constant 块）| l1 |
| `opening` | `first_mes` | turn0 |
| `openings` | `alternate_greetings` | turn0 |

**字段显示名**：沿用中文键名（= v0.1 行为），**本轮不做 34 字段 i18n**。理由：① 数据键就是中文，改显示名会让"界面看到的"和"`card.json` 里的"对不上，排查更难；② v0.2.0 是格式重构不是 i18n 重构；③ 需要英文的人已经有 CCv3 预览视图（英文规范字段 + i18n 标签）。**「34 字段全量 i18n」列入 v0.3.0**——这是明确的范围裁剪，不留悬空项。

### 2.2 视图二 · 世界书 → 见 §三

### 2.3 视图三 · CCv3 预览（只读 + 元数据 + 未映射）

```
┌ CCv3 导出预览 ─────────────────────── 可导出 ✓ ─┐
│ 这里只读：要改内容请回「人设」                    │
│ description              [由结构生成] [1,024 字] │
│ ┌──────────────────────────────────────────────┐ │
│ │ 身份：两个月前搬进你合租房的室友。            │ │
│ │ 背景：话多、爱笑，把家里弄得热闹……             │ │
│ └──────────────────────────────────────────────┘ │
│ personality              [由结构生成] [312 字]   │
│ …                                                │
│ mes_example              [空·不编造]  [ — ]      │
│ first_mes                [由结构生成] [486 字]   │
│ ▸ 元数据（name/nickname/tags/creator/creator_    │
│    notes/character_version/两个日期/assets）     │
│ ▸ 迁移与导入（aiwu.legacy / aiwu.imported.raw）  │
│ ▸ 完整 CCv3 JSON（240px 只读 + 复制）            │
└──────────────────────────────────────────────────┘
```

| 元素 | 规则 |
|---|---|
| 7 段投影字段 | 只读；≤ 3 行直接显示，> 3 行 `line-clamp` + 「展开」（专注层只读模式）|
| 来源徽记 `data-source` | `projected`（由结构生成）/ `raw`（外部原文）/ `empty`（空）/ `unmapped`（反解失败）|
| 字数 | 每段右上角 `{n} 字`，与架构稿 §5.1 阈值联动（超阈值变黄）|
| 元数据折叠区 | `name` / `nickname` / `tags` / `creator` / `creator_notes` / `character_version` / `creation_date` / `modification_date` / `assets`（只读，注明"由迁移或导入决定"）|
| 完整 JSON | `<pre>` 10px 等宽，最高 240px，右上「复制」（`navigator.clipboard`，失败降级全选）|
| 不可编辑 | 全视图无 input；顶部一句话说明原因，避免用户白点 |

**为什么值得做**：这是唯一能让用户确认「导出给酒馆的卡长什么样」的地方，也是排查"我的声线为什么没生效"的第一现场（能看见 `system_prompt` 到底拼成了什么）。纯展示，成本低。

---

## 三、世界书条目编辑器

### 3.1 书级设置 + 条目列表

```
世界书 · 5 条                                    ＋新建条目
扫描深度 [ 2 ] 条消息   预算 [ 500 ] tokens   ☐ 递归扫描
──────────────────────────────────────────────────
┌────────────────────────────────────────────────┐
│ ●  便利店与便利贴             3 键 · 412 字  ⌄ │
├────────────────────────────────────────────────┤
│ ○  同一枚钥匙             0 键 · 88 字  ⚠  ⌄ │
└────────────────────────────────────────────────┘
```

| 元素 | 规格 |
|---|---|
| 视图宽 | 420px（`452 − 2×16`）|
| 书级行 | 高 32px；数字框 56px；toggle 整行 32px 命中区 |
| 条目行 | 高 48px（备注名 + `N 键 · N 字`）；`data-issue` 时左 2px 危险色轨（同状态带语法）|
| 排序 | 按 `insertion_order` 升序；**不做拖拽**，条目内 ↑↓ 交换 order 值 |
| 删除 | danger 按钮 + 二次确认（复用 `.awu-editorConfirm` 视觉）|
| 空态 | `.awu-empty` + 「世界书按关键词触发，适合放具体设定、地名、人物关系」|

### 3.2 展开后的条目（手风琴，不弹层）

```
┌────────────────────────────────────────────────┐
│ ●  便利店与便利贴             3 键 · 412 字  ⌃ │
├────────────────────────────────────────────────┤
│ 关键词（必填，命中任一即触发）                    │
│ ┌────────────────────────────────────────────┐ │
│ │ [便利店 ×] [便利贴 ×] [早饭 ×]             │ │
│ │ 输入后按回车或逗号添加…                     │ │
│ └────────────────────────────────────────────┘ │
│ 内容                                             │
│ ┌────────────────────────────────────────────┐ │
│ │ 便利贴有一整叠，颜色按事情分：黄色是吃什么，│ │
│ │ 蓝色是提醒，粉色是他说不出口的话……          │ │
│ │                                 [ 展开编辑 ]│ │
│ └────────────────────────────────────────────┘ │
│ ☑ 启用        ☐ 常驻（不看关键词，每轮都带）     │
│ 插入顺序 [100]  ↑ ↓    位置 [ 角色之前 ⌄ ]     │
│ ▸ 更多：次级关键词 / 大小写 / 正则 / 优先级 / 备注│
│                                 [ 删除该条目 ]  │
└────────────────────────────────────────────────┘
```

| 控件 | 规格 |
|---|---|
| 关键词 chips | `Enter` / `,` / `，` / `、` 提交；空输入时 `Backspace` 删最后一枚；粘贴 `a,b,c` 自动切分；去重（大小写不敏感）；每枚 24px 高、× 按钮带 `aria-label` |
| 内容 | 3 行预览 + 「展开编辑」进专注层（§4）；> 800 字按架构稿 §5.1 软警告 |
| 启用 / 常驻 | 原生 checkbox + `<label>`，整行 32px |
| 插入顺序 | `<input type="number">`；↑↓ 与相邻条目交换 order 值（不重排、不留空档）；新建 `order = max + 1` |
| 位置 | 原生 `<select>`：`before_char` / `after_char` |
| 更多 | 次级关键词（chips）/ 大小写敏感 / 选择性 / 正则 / 优先级 / 备注 |
| 落点 | 直接改 `ccv3.data.character_book.entries`，**不新增 REST**（F4）|

### 3.3 `scan_depth` 归书级（你已拍板，我 concur）

`scan_depth` / `token_budget` / `recursive_scanning` 是 **`character_book` 书级**（V3 规范如此）。条目级只有 `insertion_order` / `priority` / `position`。条目级单设深度只能塞 `entry.extensions.aiwu.*`，导出到 SillyTavern 会被忽略——等于制造"在我这儿有用、在别处静默失效"的隐性契约。不做。

### 3.4 问题检测（`loreIssues()`，保存前跑；**不硬拦截**）

| code | 触发 | UI |
|---|---|---|
| `no-keys` | `keys` 过滤空串后为空 **且** `constant !== true` | 条目行 ⚠ + 保存前**软确认** |
| `empty-content` | `content.trim() === ''` | 条目行 ⚠ |
| `duplicate-keys` | 两条共享同一 key | 两条都 ⚠（重叠触发是合法玩法）|
| `order-collision` | 两条 `insertion_order` 相同 | 警告"顺序不确定" |
| `too-long` | 单条 > 800 字 / 总量 > 20000 字 / 条数 > 30 | 视图顶部汇总（架构稿 §5.1）|

**软确认而非硬拦截**（对 v1 的修正）：架构稿 §5.2 明确"不截断、不拒绝保存"。所以 `no-keys` 不挡保存，改为保存时弹一次小确认——「有 2 条世界书没有关键词，永远无法被命中。仍要保存？」[仍要保存 / 回去补]。一次点击可过，既不拒绝，也不让用户毫无察觉。

> `constant: true` 的条目不需要关键词（每轮都注入），`no-keys` 判定必须排除它——不写清，用户会以为自己漏填。

---

## 四、长文本编辑体验

### 4.1 成本清单（代码路径可确定，未做真机 profiling）

| 步骤 | 现状 | 位置 |
|---|---|---|
| ① 顶层重渲染 | `setDraft` 在 `CardEditor` 顶层 → 全树 reconcile | `card-editor.tsx:233-238` |
| ② 脏检查 | 每次渲染 `JSON.stringify(toDraft(card))` + `JSON.stringify(draft)`，整卡 20KB 级 ×2 | `card-schema.ts:296-300` 经 `card-editor.tsx:227` |
| ③ 完整度 | `mergeCard()` 全卡浅拷贝 + `filledCount()` 34 字段 | `card-editor.tsx:228-231` |
| ④ 自适应高度 | `height='auto'` → 读 `scrollHeight`（强制同步布局）→ 写 `height` | `card-editor.tsx:35-40` |

四件事在同一个 keydown 帧里完成。**卡顿不在 textarea。**

### 4.2 方案：阈值降级 + 专注层本地缓冲

| | A 保持现状 | **B 阈值降级 + 专注层（推荐）** | C 内嵌双栏 |
|---|---|---|---|
| 做法 | 高度上限 240→480 | < 800 字内联直编；≥ 800 字 3 行预览 + 「展开编辑」进整屏层（层内本地缓冲，关闭才提交）| 左右分栏 |
| 每键成本 | 不变 | 内联：去掉 ②③④；专注：**父组件零重渲染** | 不变（多一栏）|
| 452 适配 | 可以 | 可以 | ❌ 每栏 206px ≈ 17 字/行 |

**阈值 800 的依据**：12px 中文在 388px 内容宽里约 34 字/行，800 字 ≈ 24 行 ≈ 480px，已超现状上限两倍、超面板可视区大半。再长就不是"一屏能看全"，内联编辑退化成"在 240px 盒子里滚 40 行"。

**适用范围**：`long` 类结构字段 + 世界书条目 `content` + 只读预览里 > 3 行的段落（专注层开只读模式）。

### 4.3 专注编辑层

```
┌────────────────────── 452 ──────────────────────┐
│ ← 返回      一句背景      2,140 字       [完成]  │ 头 44px
├──────────────────────────────────────────────────┤
│ 这个角色是……                                    │
│ （整屏 textarea：14px 衬线 / 行高 1.8 / 内距 16）│
├──────────────────────────────────────────────────┤
│ ⚠ 这段投影后 2,140 字，超过 1,200 建议值          │ 底 40px
└──────────────────────────────────────────────────┘
```

| 项 | 规格 |
|---|---|
| 层级 | 面板内 `absolute; inset:0`，`z-index: var(--awu-z-inset)`（与未保存确认同层，后打开者压栈在上）|
| 背景 | `var(--awu-surface)`（近不透明）|
| 头部 | 返回（`awu-navBack` 同款）+ 字段名 + 实时字数 + 完成 |
| 正文 | `--awu-fs-control` 14px 衬线 / `--awu-lh-loose` 1.8 / `padding: var(--awu-gutter)` / 100% 高（**不** auto-height）|
| 底部 | 与阈值联动的软提示（`data-over`）|
| 出口 | `完成`（写回）/ `Esc`（与打开时不同则二次确认）/ 返回（同 Esc）|
| 字数 | `[...text].length`（按码点，emoji 不算两字）；只在层内算 |
| **本地缓冲** | `const [text, setText] = useState(value)`，打字期间父组件零重渲染，①②③④ 全为 0 |

代价：层打开期间头部完整度/体检是**打开前的快照**（层盖住了那两个数，用户看不到，可接受）。

### 4.4 焦点四层链路（不破坏 guide-designer 的接线）

现状 `card-editor.tsx:218-225` 是两对 hook。**原样保留**，专注层作为第三对追加在其后：

```ts
useRestoreFocus(focusKey !== null)          // ③ 专注层
useInitialFocus(focusRef, focusKey !== null)
useFocusTrap(focusRef, focusKey !== null)
```

Esc 处理器（`251-261`）加**第一优先级分支**：

```ts
if (event.key !== 'Escape') return
event.stopPropagation()
if (focusKey !== null) { closeFocus(); return }   // ← 新增，必须在 confirmLeave 之前
if (confirmLeave) { setConfirmLeave(false); return }
if (dirty) { setConfirmLeave(true); return }
onCancel()
```

`requestClose`（244-248）同理：专注层开着时只关层。你已在 `index.tsx` 修了面板级 Esc（`dialog === '' && !editing` + 依赖补 `editing`），所以这条链路现在只关自己。

### 4.5 阈值（全部取架构稿 §5.1，不自拟）

| 指标 | 阈值 | 编辑器表现 |
|---|---|---|
| `description`（**投影后**）| > 1200 字符 | 「角色设定偏长（{n} 字），建议拆到世界书」+ 字段字数变黄 |
| 单卡 L1 静态块（1–12 段合计）| > 3000 字符 | 头部体检 pill 变黄 |
| 世界书单条 `content` | > 800 字符 | 条目内提示 |
| 世界书总量 | > 20000 字符 或 > 30 条 | 视图顶部汇总 |
| `card.json` | > 200 KB | 「面板加载会变慢」|
| `keys` 为 0 且非 constant | — | 条目 ⚠ + 保存前软确认（§3.4）|

**数字只有一个来源**：架构稿 §5.1。编辑器不自带阈值常数；若后端 `GET` 一并返回算好的 `aiwu.length`（F5），编辑器直接显示，**不在客户端重算**（避免两套真相——我上一轮刚在字号上批过这件事）。

---

## 五、完整度与「导出体检」

### 5.1 两个读数，回答两个问题

| 读数 | 回答 | 算法 | 显示 |
|---|---|---|---|
| **结构完整度** `filled/34` | "资料填全了吗" | 沿用 `filledCount()`（`card-schema.ts:303-318`），计数规则不变 | 头部 pill `12/34` |
| **导出体检** `issues[]` | "导出到酒馆能用吗" | 七段投影逐段判定：`empty` / `raw` / `ok` / `warn`（超阈值）| 头部 pill `可导出 ✓` / `2 项待处理` |

**为什么不再按"必填/推荐/选填"三档算**（v1 方案）：CCv3 的必填性由**投影结果**决定——34 个结构字段里没有"必填"概念（`voice.自称` 空着卡照样跑），真正必须非空的是投影出来的 `description` / `first_mes`。按结构字段打分是错的口径；按投影结果体检才是"能不能用"。

### 5.2 导出体检规则（`exportIssues(view, ccv3)`）

| code | 判定 | 级别 |
|---|---|---|
| `empty-description` | 结构全空 **且** `data.description` 空 | 红 |
| `empty-first-mes` | 同上之于 `first_mes` | 红 |
| `no-lorebook-keys` | 世界书有 `no-keys` 条目 | 黄（软确认）|
| `description-too-long` / `l1-too-long` / `lore-too-big` | 架构稿 §5.1 阈值 | 黄 |
| `unknown-preserved` | `aiwu.legacy.extra` 非空 | 蓝（"有 N 个旧字段没有对应位置，已原样保留"）|
| `unmapped-native` | `imported.raw` 有字段但结构反解为空 | 蓝（"这段原样保留，L1 优先用原文"）|

pill 点开 → 展开 `.awu-status` 列表（复用状态带四态），每条给"跳到对应视图/字段"的按钮。

---

## 六、迁移与导入的展示

### 6.1 三个来源，三种语气

| 来源 | 横幅 | 说明 |
|---|---|---|
| `aiwu.legacy.from = 'aiwu-v1'` | `data-status="info"`：「这张卡由 v0.1 的 34 个中文键迁移而来，原始内容保留在 `aiwu.legacy`」+ [查看原始字段] | 结构完整，原生是投影 |
| `native` / `png` / `charx` | `data-status="info"`：「从外部导入，原文逐字保留在 `aiwu.imported.raw`」+ [查看原文] | 结构是反解的影子 |
| `unknown` | `data-status="alert"`：「格式未识别，整份原文备份在 `aiwu.legacy.extra`」| 只能备份，不能编辑 |

### 6.2 「查看原始字段」落到哪

CCv3 视图的两个折叠区：**迁移与导入**（`aiwu.legacy` + `aiwu.imported.raw`，各一个只读 JSON，10px 等宽，最高 240px，`pre-wrap`）与**完整 CCv3 JSON**（整份对象，方便复制去别的前端验证）。

### 6.3 「未映射」怎么表达（外部卡的真实痛点）

外部卡的 `description` 往往是一大段散文，`deriveFromNative` 反解不出「身份 / 一句话背景」→ 34 字段视图**大片空白、而原生字段有内容**，用户会以为卡坏了。

处理：
1. `imported.raw` 存在的字段，CCv3 视图标 `data-source="raw"` + 「这段来自原文，L1 优先用原文；要改请用结构字段」。
2. 结构视图对应组顶一行 `data-status="info"`：「本组从原文反解失败，原文见 CCv3 → 迁移与导入」。
3. **不提供"从原文拆解"向导**（那是蒸馏线的事，且容易拆坏）；本轮只保证"看得见、不丢失"。

---

## 七、改动清单（文件:行）

### 7.1 `client/card-schema.ts` —— **小改**（不再重写）

| 区块 | 行 | 处置 |
|---|---|---|
| 文件头注释 | 1-13 | 补一句：本文件描述「结构视图」，原生字段是投影，改结构不改原生 |
| `FieldKind` | 17-20 | 不变（`text/long/list` 够用；chips 是世界书专用，进 `lorebook-schema.ts`）|
| `FieldSpec` | 23-32 | **+3 元数据**：`projectsTo` / `budget` / `minChars` |
| `GroupSpec` | 35-58 | **+1**：`extra?: 'lorebook' | 'native'` |
| `GROUPS` | 66-194 | 字段与顺序一字不改；每项补 `projectsTo`/`budget`/`minChars`（照架构稿 §2.2）|
| `Draft`/`toDraft`/`isEmptyValue`/`mergeCard`/`isDirty`/`filledCount` | 197-318 | **逻辑不变**（仍产出旧 34 字段视图）。加注释：「产出物进 `POST /character/save` 的 `card` 键，不要试图写原生字段」|
| 新增 | 末尾 | `exportIssues(view, ccv3)` / `resolveCardSource(detail)` / `NATIVE_FIELDS`（7 段原生字段的展示元数据）|

**风险最高处**：`mergeCard` 的"清空即删键"（`283-285` 整组空了删组）。结构视图删组不影响投影（后端 `fromLegacyView` 会重算），**保留现状**，不要顺手改成写空串——那会让 `toLegacyView` 形状漂移。

### 7.2 新文件 `client/card-source.ts`（约 80 行）

过渡期三种后端形态都要能跑，用适配器，别在编辑器里到处 `if (detail.ccv3)`：

```ts
export type CardMode = 'transition' | 'native' | 'legacy-only'

export interface CardSource {
  mode: CardMode
  view: Card          // 34 字段结构视图（编辑面）
  ccv3: Card          // 完整对象（世界书 / 未知键 / 预览）
  hasLorebook: boolean
}

export function resolveCardSource(detail: CharacterDetail): CardSource
```

| 后端形态 | 判据 | mode |
|---|---|---|
| 过渡双视图（架构稿 §6.5）| `detail.ccv3` 且 `detail.card` | `transition` |
| 硬切 CCv3 | `detail.card.spec === 'chara_card_v3'` | `native`（此时结构视图需后端给 `fields`；没有就只在人设视图顶部提示"当前后端未提供结构视图"，世界书仍可编）|
| v0.1 后端 | 只有旧 `card` | `legacy-only`（世界书视图隐藏，其余照常）|

### 7.3 `client/card-editor.tsx` —— 按行号的 15 处

| # | 行 | 现状 | 改成 |
|---|---|---|---|
| E1 | 24-62 | `TextField` 自适应 240px | 迁进 `editor-fields.tsx` 的 `InlineText`（800 字阈值降级 + 字数）|
| E2 | 64-117 | `ListField`（`key={index}`）| 迁进 `editor-fields.tsx`；稳定 id；长列表项自动高 |
| E3 | 119-190 | `FieldGroup` 组头 4 件套 | + `data-budget` 徽 + `data-projects` tooltip（「会投影进 system_prompt」）；`lorebook`/`native` 特殊分支 |
| E4 | 192-203 | props：`card/name/source/busy/error/onCancel/onSave` | 收 `source: CardSource`；`onSave(next: { card: Card; ccv3: Card })` |
| E5 | 205 | `useState(toDraft(card))` | `useState(toDraft(source.view))`；+ `section` / `focusKey` / `loreDraft` |
| E6 | 207-211 | `openGroups` | 保留（默认开 basic/voice，与今天一致）|
| E7 | 218-225 | a11y 两对 hook | **一行不动**，其后追加专注层三件套（§4.4）|
| E8 | 227-231 | `dirty`/`progress` 每渲染全量算 | `dirty` 改 revision 计数；`progress` 300ms 防抖 |
| E9 | 244-248 | `requestClose` | 前置 focusKey 分支 |
| E10 | 251-261 | Esc | 前置 focusKey 分支（§4.4 代码）|
| E11 | 271-296 | 头部：kicker/名字/进度/关闭 | 撕成：① kicker+名字 ② `filled/34` + 体检 pill ③ 三视图分段器 |
| E12 | 298-301 | 只读提示 | 按 `mode` 与 `legacy.from` 换成迁移/导入横幅（§6.1）|
| E13 | 309-323 | `GROUPS.map` 单列 | 按 `section` 分流：人设 → GROUPS.map；世界书 → `<LoreEditor/>`；ccv3 → `<NativePreview/>` |
| E14 | 326-342 | 底部条 | `save()` 产出 `{card: mergeCard(...), ccv3: mergeLore(...)}`；有未确认 `no-keys` 先软确认（§3.4）|
| E15 | 344-363 | 未保存确认 | 保留；可选追加 issue 摘要 |

### 7.4 新增文件与跨线改动

| 文件 | 归属 | 内容 |
|---|---|---|
| `client/lorebook-schema.ts`（新 ~180 行）| 我 | `LoreEntryDraft` / `toLoreDraft` / `mergeLore` / `loreIssues` / `nextInsertionOrder` / `moveEntry` / `normalizeKeys` |
| `client/editor-fields.tsx`（新 ~200 行）| 我 | `InlineText` / `ChipsField` / `NumberField` / `ToggleField` / `LongList` |
| `client/editor-focus.tsx`（新 ~120 行）| 我 | 专注层（本地缓冲，含只读模式）|
| `client/lore-editor.tsx`（新 ~260 行）| 我 | 世界书视图 + 条目手风琴 |
| `client/native-preview.tsx`（新 ~150 行）| 我 | CCv3 预览（7 段 + 元数据 + 迁移区 + 完整 JSON）|
| `client/card-source.ts`（新 ~80 行）| 我 | 三形态适配器 |
| `client/api.ts` | **无主（需指派）** | `CharacterDetail` 加 `ccv3?`/`fields?`；`saveCharacter(name, card, ccv3?)` |
| `client/index.tsx` | Lead | `onSaveCard` 接收 `{card, ccv3}` 并透传（约 3 行）|
| `src/web.ts` | **tavern-architect**（Lead 已拍板转派）| save handler 接受 `{name, card?, ccv3?}`（C7，约 15 行）|
| `client/text.ts` | Lead | 新增 55 键（附录 A）|
| `client/styles.ts` | 我 | 新增 12 组规则（附录 A2）|

### 7.5 与其余并行线的关系

| 线 | 影响 | 处置 |
|---|---|---|
| distill（`client/distill.tsx:31,339`）| `GROUPS` **不变** → 客户端不用改 | 但 `distill/flow.md` 的「34 字段逐字照抄」要按架构稿 §8.1 改成 CCv3 输出 |
| guide | 第 4 个 tab 与编辑器三视图分段器不冲突（面板级 vs 编辑器级）| 无 |
| 后端 | 见架构稿附录 A | 归 architect/Lead |

---

## 八、实施顺序与风险

| 步 | 内容 | 依赖 | 并行 |
|---|---|---|---|
| 1 | C7 拍板 + `web.ts` save 双键落地 | — | ✅ 与 2 并行 |
| 2 | `card-schema.ts` 元数据 + `card-source.ts` + `exportIssues`（纯函数）| 无 | ✅ |
| 3 | `lorebook-schema.ts`（纯函数）| 无 | ✅ |
| 4 | `editor-fields.tsx` + `editor-focus.tsx` | 2 | ✅ |
| 5 | `native-preview.tsx` / `lore-editor.tsx` | 2/3/4 | 部分 |
| 6 | `card-editor.tsx` E1-E15 接线 | 2-5 | — |
| 7 | `styles.ts` 12 组规则 | 类名先定 | ✅ 与 2-5 并行 |
| 8 | `text.ts` 55 键 | 2 | ✅ |
| 9 | `api.ts` 类型 + `index.tsx` 透传 | 1 | — |
| 10 | 手验：3 张旧卡（迁移态）+ 1 张导入卡（未映射态）+ 空卡（全新态）| 全部 | — |

**风险**

| 风险 | 影响 | 缓解 |
|---|---|---|
| 用户以为 CCv3 预览可编辑 | 白点 | 顶部说明 + 全只读样式（无 input 边框/focus 环）|
| C7 未定就动手 | 世界书改动丢失 | 第 1 步先定；未定时世界书视图置灰 + 提示"等待后端保存契约" |
| `deriveFromNative` 反解失败 | 结构空白、用户以为卡坏 | §6.3 的 `unmapped` 徽记 + 组内提示 |
| 硬切 CCv3 且后端不给 `fields` | 结构无法编辑 | `mode='native'` 分支显式提示，只允许改世界书（不静默失败）|
| Esc 关面板 | 丢编辑 | 你已修（`index.tsx`），专注层以此为前提 |
| 世界书条目多时全树重渲染 | 卡顿 | 条目行 `React.memo`；折叠态只渲染摘要 |

---

## 九、验收清单

机检：

```
npm run typecheck:client                 # 0 error
npm run build                            # 三套自检全绿
grep -n "font-size" client/card-schema.ts client/card-source.ts client/lorebook-schema.ts  # 期望空
```

手验：

1. 旧卡（虞照）：人设视图 34 字段有内容 → CCv3 视图 `description/personality/scenario/system_prompt` 显示 `[由结构生成]`，`mes_example` 显示 `[空·不编造]`。
2. 改「一句话背景」→ 保存 → 重开：CCv3 视图 `description` 第 2 段随之变化（证明投影生效）。
3. 世界书新建一条、2 个关键词 + 300 字 → 保存 → 重开：条目还在、order 稳定、`entries` 长度 +1。
4. 世界书新建一条不填关键词 → 保存 → 软确认「2 条没有关键词」→「仍要保存」可通过。
5. `对话节奏` 粘 10,000 字 → 内联变 3 行预览 + 展开编辑；专注层打字无可感延迟。
6. 专注层 Esc 只关层；再 Esc 出未保存确认；面板不跟着关。
7. 导入卡（若有 `imported.raw`）：CCv3 视图显示 `[外部原文]`，结构视图对应组显示"反解失败"提示。
8. 中英切换：新增 55 条文案全有英文；34 字段沿用中文键名（范围裁剪，§2.1）。
9. 浅色主题：世界书行、chips、专注层、预览段全部走 token。
10. 三视图分段器键盘：左右键切换、`aria-controls` 指向同一个 tabpanel。

---

## 附录 A · 新增 i18n 键（55 个，zh / en）

| 键 | zh | en |
|---|---|---|
| `edit.section.persona` | 人设 | Persona |
| `edit.section.lore` | 世界书 | Lorebook |
| `edit.section.ccv3` | CCv3 | CCv3 |
| `native.title` | CCv3 导出预览 | CCv3 export preview |
| `native.readonly` | 这里只读：要改内容请回「人设」 | Read-only: edit under Persona |
| `native.source.projected` | 由结构生成 | Generated |
| `native.source.raw` | 外部原文 | Imported text |
| `native.source.empty` | 空·不编造 | Empty |
| `native.source.unmapped` | 未映射 | Unmapped |
| `native.meta` | 元数据 | Metadata |
| `native.migrate` | 迁移与导入 | Migration & import |
| `native.fullJson` | 完整 CCv3 JSON | Full CCv3 JSON |
| `native.copy` | 复制 | Copy |
| `native.copied` | 已复制 | Copied |
| `edit.export.ok` | 可导出 | Ready to export |
| `edit.export.issues` | {n} 项待处理 | {n} issues |
| `export.emptyDescription` | 人设是空的，导出后别人看到一张空卡 | Description is empty |
| `export.emptyFirstMes` | 没有开场白，启用后第一句会空着 | No first message |
| `export.descriptionTooLong` | 人设 {n} 字，超过 1200 建议值 | Description {n} chars, over 1200 |
| `export.l1TooLong` | 常驻人设 {n} 字，每轮都会注入 | Always-on {n} chars, injected every turn |
| `export.loreTooBig` | 世界书 {n} 条 / {m} 字，命中率会下降 | Lorebook {n} entries / {m} chars |
| `export.legacyExtra` | {n} 个旧字段没有对应位置，已原样保留 | {n} legacy fields preserved as-is |
| `export.unmapped` | {n} 段原文未能反解成结构 | {n} sections could not be mapped |
| `migrate.fromAiwuV1` | 由 v0.1 的 34 个中文键迁移而来 | Migrated from v0.1 |
| `migrate.fromExternal` | 从外部导入，原文逐字保留 | Imported; original text preserved |
| `migrate.fromUnknown` | 格式未识别，整份原文已备份 | Unknown format; raw backup kept |
| `migrate.viewLegacy` | 查看原始字段 | View original fields |
| `migrate.viewRaw` | 查看原文 | View imported text |
| `migrate.deriveFailed` | 本组从原文反解失败，原文见 CCv3 | Could not map this group from the imported text |
| `lore.title` | 世界书 | Lorebook |
| `lore.count` | {n} 条 | {n} entries |
| `lore.add` | 新建条目 | New entry |
| `lore.empty` | 世界书按关键词触发，适合放具体设定、地名、人物关系 | Triggered by keywords — good for concrete facts |
| `lore.keys` | 关键词（必填，命中任一即触发） | Keys (required) |
| `lore.keysPlaceholder` | 输入后按回车或逗号添加 | Type, then Enter or comma |
| `lore.keyRemove` | 移除关键词 {k} | Remove key {k} |
| `lore.content` | 内容 | Content |
| `lore.enabled` | 启用 | Enabled |
| `lore.constant` | 常驻（不看关键词，每轮都带） | Constant (always injected) |
| `lore.order` | 插入顺序 | Insertion order |
| `lore.position` | 位置 | Position |
| `lore.positionBefore` | 角色之前 | Before character |
| `lore.positionAfter` | 角色之后 | After character |
| `lore.advanced` | 更多 | Advanced |
| `lore.remove` | 删除该条目 | Delete entry |
| `lore.scanDepth` | 扫描深度（条消息） | Scan depth (messages) |
| `lore.tokenBudget` | 预算（tokens） | Budget (tokens) |
| `lore.recursive` | 递归扫描 | Recursive scanning |
| `lore.confirmNoKeys` | {n} 条世界书没有关键词，永远无法被命中。仍要保存？ | {n} entries have no keys and can never trigger. Save anyway? |
| `lore.confirmSave` | 仍要保存 | Save anyway |
| `lore.confirmBack` | 回去补 | Go back |
| `edit.focus.open` | 展开编辑 | Edit full screen |
| `edit.focus.done` | 完成 | Done |
| `edit.focus.chars` | {n} 字 | {n} chars |
| `edit.chars` | {n} 字 | {n} chars |

## 附录 A2 · `styles.ts` 新增规则（12 组）

| 类/选择器 | 用途 |
|---|---|
| `.awu-editorTabs` / `.awu-editorTab[data-active]` | 三视图分段器（复用下划线视觉）|
| `.awu-exportPill` / `[data-state="ok|warn|bad"]` | 导出体检 pill |
| `.awu-budgetTag[data-budget]` | 字段注入徽记 |
| `.awu-fieldCount` | 字段字数（10px 等宽）|
| `.awu-focus` / `-Head` / `-Body` / `-Foot` | 专注层（含只读）|
| `.awu-chips` / `.awu-chip` / `.awu-chipX` | 关键词多值 |
| `.awu-loreList` / `.awu-loreRow[data-issue][data-enabled]` | 世界书列表 |
| `.awu-loreBody` / `.awu-loreAdv` | 条目手风琴 |
| `.awu-switchRow` | 启用/常驻（整行 32px）|
| `.awu-nativeField[data-source]` | 预览段 + 来源徽记 |
| `.awu-jsonView` | 只读 JSON（10px 等宽，最高 240px）|
| `.awu-issueList` | 体检展开列表 |

新增 `data-*` 6 个：`data-active`、`data-state`、`data-budget`、`data-source`、`data-issue`、`data-enabled`（都有 CSS 消费者）。

## 附录 B · v1 → v2 差异（快速 diff）

| v1 | v2 | 原因 |
|---|---|---|
| 编辑原生 15 字段（9 组）| 编辑结构 34 字段（10 组不变）+ 原生只读预览 | 架构稿 D3/§8.2 |
| `card-schema.ts` 整体重写（点分 path）| 小改（+3 元数据 + 导出函数）| 编辑面没变 |
| 完整度三级（必填/推荐/选填）| 结构完整度 + 导出体检 | 必填性由投影结果决定 |
| `no-keys` 硬拦截 | 软确认（一次点击可通过）| §5.2「不拒绝保存」|
| 阈值自定 1200/1600/4000 | §5.1 的 1200/3000/800/20000/30/200KB | 单一真相 |
| 世界书 200 条上限 | 30 条 | 同上 |
| `mergeCard` 空值写空串 | 保持"清空删键" | 结构视图合并语义不变 |
| 66 个 i18n 键 | 55 个（34 字段不做 i18n）| 范围裁剪，v0.3.0 补 |

## 附录 C · 给 architect 的 5 条反馈（读稿发现的不一致，不改稿，只报）

1. **D13 与附录 A 打架**：D13「删除 `prompt.ts` 的 `renderCharacterCard`」，附录 A「保留（过渡期给 `toLegacyView` 用）」。建议按 D13 删——`toLegacyView` 是数据视图，不需要渲染器。
2. **D12 与附录 A 打架**：D12 定「presets 保持旧格式不动」（Lead 已采纳），附录 A 仍写「presets → CCv3」。附录需同步。
3. **`GET /character` 会有两份同样的投影**：§6.5 同时给 `card` 与 `fields`，两者都是 `toLegacyView(ccv3)`。建议只留 `card` + `ccv3`，删 `fields`，省一次投影与一次歧义。
4. **保存入口要能同时带结构与世界书**（本文 C7）：`{name, card}` 与 `{name, ccv3}` 各缺一半。
5. **`aiwu.length` 现算 + 硬切无 `fields`**：若 Q1 选硬切，编辑器拿不到结构视图就没法工作；硬切必须同时给 `fields`。
