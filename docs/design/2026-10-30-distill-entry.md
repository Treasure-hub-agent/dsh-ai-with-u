# 蒸馏角色卡 · 入口与流程设计（2026-10-30）

> 设计者：distill-designer（共享任务板 `task-2` → 实施 `task-4`）
> 基线：`main` @ `e07bf58`；行号按该版本核对（`client/index.tsx` 1650 行 / `src/web.ts` 338 行 / `src/tools.ts` 235 行 / `src/store.ts` 951 行）。
> 归属：`src/**`、`distill/`、`client/distill.tsx`、`client/distill.styles.ts`、`client/api.ts` 归本设计；`client/index.tsx` / `client/text.ts` / `client/styles.ts` / `client/entry.tsx` 归 Lead，见 §6.3–§6.5。
> 铁律回顾（`docs/DEVELOPMENT.md:34-42`）：**L2 长流程文档永不进 system prompt**。

> ## 🔴 v2 已实施（2026-10-30 晚）
>
> 主人推翻了 v1 的「蒸馏做成模型工具 + 常驻挂载」路线。最终形态是 **v2：随包 `distill/flow.md` + 一个按钮 + 把指令发进当前会话**。
>
> - **结论以 §0（已改写）与 §12 为准**；§5.8 / §5.9 / §11.1 已标 ❌ 废弃，只是留档。
> - **不要照做**：`awu_distill_guide` 工具、常驻挂载、`src/index.ts` 的任何改动。
> - 复用无误的部分：34 字段契约（§5.6）、V1–V13 校验（§5.7）、`mergeCard` 四个坑（§8.2）、失败矩阵（§7，v2 增补见 §12.4）。
> - 实际代码：`distill/flow.md`、`src/distill.ts`、`client/distill.tsx`、`client/distill.styles.ts`、`client/api.ts`（两处追加）、`src/web.ts`（两条路由）。

> ## ⏸ 34 字段契约已挂起（2026-10-30 22:00，主人拍板改 CCv3）
>
> 卡片格式要从「10 组中文键名」整体换成**酒馆卡 CCv3**（`spec: chara_card_v3`；常规人设走
> `description` / `personality` / `scenario` 常驻 L1，详细设定走 `data.character_book.entries[]`
> 按关键词注入）。所以下面这些内容**只作存档，不要照做**，等 `tavern-architect` 的格式设计定稿：
>
> | 挂起的内容 | 位置 |
> |---|---|
> | `DISTILL_GROUPS`（10 组 34 字段字面量） | §5.6、附录 B |
> | V1–V13 校验规则 / `normalizeDistillCard` | §5.7、`src/distill.ts`（**已从代码里摘除**） |
> | `POST /distill/parse`（粘贴 → 校验） | §5.2b、`src/web.ts`（**路由已摘除**，`client/api.ts` 只保留签名骨架） |
> | 粘贴校验 → `CardEditor` 的交接路径 | §8（`mergeCard` 四个坑仍然有效，等格式定稿后重接） |
>
> **不受影响、已落地**（与格式无关）：
> - 发送通道：`DockSink` / `sendDistillInstruction()` / `composerReady()` / 降级链 / `DistillDialog` / `DistillButton`（§6.2，代码已写完）。
> - `GET /distill/flow` + `client/api.ts` 的 `fetchDistillFlow()`（接口契约不变：`{ok, path, instruction, chars, flowChars}`）。
> - `distill/flow.md` 的**阶段骨架**（5 个阶段、铁律、自检）；「字段契约」「输出格式」两节已换成 `<!-- 待 tavern 格式定稿填充 -->` 占位。
> - L2 铁律、失败矩阵、`mergeCard` 的坑、`writeCard` 复用结论。

---

## 0. 一页结论（TL;DR，**v2 已实施**）

| 问题 | 结论（v2） |
|---|---|
| 流程本体放哪 | **`distill/flow.md`**（随包发布，`package.json.files` 加 `distill`）。宿主用 `join(dirname(fileURLToPath(import.meta.url)), '..', 'distill', 'flow.md')` 定位，与 `presets/` 同款（`src/index.ts:152`）。 |
| 怎么触发 | 面板角色簿头部一个按钮（`DistillButton`，自带弹层）+ 输入框上方的 `conversation.composer.dock` 小入口（`DockEntry`，只填入不发送）。 |
| 怎么把流程交给模型 | **发一条消息**：确认弹层点「发送」→ `inputActions.insertText(指令)` → 同一 tick 内 `submit()`。指令里**只有 flow.md 的绝对路径 + 4 条要求**（289 字符），正文由模型自己去读文件。 |
| 降级链 | `submit` 缺失/抛错 → 只填入并提示「按回车发送」；`insertText` 返回 false → 显示可复制的指令并如实报错；读不到 flow.md → 明确报错且仍可复制。 |
| L2 铁律 | 字段契约只在 `flow.md` 里出现一次。**system prompt 零增量**，那段指令也不含契约正文（指令 289 字符，只有路径 + 4 条要求）。 |
| 卡怎么回来 | ⏸ **随 CCv3 换血挂起**。最终形态：模型产出**一份 CCv3 JSON（含 `character_book`）** → 用户粘回弹层 → 新校验接口（按 CCv3 重写）→ 进 `CardEditor` 二次确认 → 用户点保存才写盘。旧方案（34 字段 + `/distill/parse`）见 §5.2b / §5.6 / §5.7 存档。 |
| 后端改动 | 新文件 `src/distill.ts`（只做「读 md + 生成指令」，零 IO 除读 md）；`src/web.ts` **+1 条** `GET /distill/flow`。`POST /distill/parse` **已摘除**（等格式）。**`src/index.ts` / `src/tools.ts` / `src/store.ts` 一行不改**，不新增工具、不常驻挂载。 |
| 前端改动 | 新文件 `client/distill.tsx`（8 个导出，见 §6.2）、`client/distill.styles.ts`（`DISTILL_CSS`）；`client/api.ts` 追加 `fetchDistillFlow()` + `parseDistillCard()` 骨架（后者签名先定死，路由未注册）。 |
| 不落盘原则 | 当前没有任何写盘路径（校验挂起后连 `readCard` 都不调）。用户在编辑器点保存前，**一个字节都不写盘**。 |
| 数据量级 | 作品正文走 DSH 会话本身，不进插件 HTTP；进 body 的只有最终卡 JSON（典型 4–12 KB）。 |

---

## 1. 现状核查：这个功能确实完全不存在

| 检查项 | 命令 / 位置 | 结果 |
|---|---|---|
| 仓库里有没有 distill 代码 | `Select-String -Path client\*.ts,client\*.tsx -Pattern 'distill'` | **0 命中** |
| `client/text.ts` 有没有文案 | `client/text.ts:13-177`（zh）、`181-343`（en） | 无 `distill.*` 键；最后一个键是 `edit.discard`（:177 / :343） |
| 面板有没有入口 | `client/index.tsx:1422-1437`（角色簿工具行）只有「共 N 位 + 新建角色」；`:1441-1447` 空态只有标题与提示，**没有按钮** | 无入口 |
| 弹层状态机有没有坑位 | `client/index.tsx:919` | `'' \| 'new' \| 'delete' \| 'mode' \| 'editDiary' \| 'forget' \| 'resetAll'`，无 distill |
| 模型工具 | `src/tools.ts` 8 个（:51/82/102/122/143/169/199/215） | 无蒸馏工具 |
| REST 路由 | `src/web.ts` 16 条（`ROUTE_PREFIX}/` 计数 16） | 无 `/distill/*` |
| 字段契约是否就绪 | `client/card-schema.ts:66-194` `GROUPS` 10 组 34 字段 | 就绪，**是本设计的唯一字段真相** |
| 宿主能否访问模型 | `Select-String -Path src\*.ts -Pattern 'fetch\(\|openai\|anthropic'` | **0 命中**；`package.json:51-57` 只有 5 个 devDependencies，**零运行时依赖** |
| 文档里的历史定位 | `docs/DEVELOPMENT.md:401`「蒸馏角色：原 skill 的六 Phase 流水线，工作量大」；`:40` 把蒸馏列为 L2 长流程的示例 | 设计空间早已划定只是没实现 |

补充一条**行号漂移**说明：集成契约 §四 写的入口插入点 `index.tsx:1386-1401` 是开工前的行号；当前 HEAD（`e07bf58`，含 task-1 的详情页错误态改动）对应 **`index.tsx:1422-1437`**（计数 + 「新建角色」所在的 flex 行）。本文一律用当前行号。

---

## 2. 三条路线：先看可行性，再谈体验

### 2.1 前置事实：面板不可能自己「生成」

这不是取舍问题，是物理限制：

1. 浏览器侧只能访问 `/_dsh/ai-with-u/*`（`client/api.ts:14` 的 `API_PREFIX`），这些是宿主自己实现的 REST（`src/web.ts:57-337`）。
2. 宿主侧 `src/**` 里**没有任何模型调用**（上面 grep 0 命中），`package.json` 也**没有任何运行时依赖**。
3. 加一条模型通道 = 引入 AI SDK 或自己写 HTTP 客户端 = 违反「零新依赖」硬约束。

推论：**「生成」只能发生在 DSH 的正常对话里**，面板最多负责「把话递过去」和「把产物接回来」。这一条直接决定了三选一的胜负。

> 技术上也存在第三条路：用宿主的 `sessions` 服务（`docs/DEVELOPMENT.md:119` 的真实服务表里有它）代开一轮对话、把结果流式取回。但那是会话编排 + 流式 + 取消 + 错误恢复的一整套工程，且会把「聊天走正常 DSH 会话」（`docs/DEVELOPMENT.md:22`）这条定位劈成两条链路。本次不做；一旦 DSH 将来暴露「把一条消息塞进当前会话」的 API，工作台可以无损升级成自动发送（§11.3）。

### 2.2 对比表

| 维度 | (a) 单弹层表单 | (b) 六 Phase 向导 | (c) 纯交接 + L2 工具 | **(c′) 推荐：交接 + 校验闭环** |
|---|---|---|---|---|
| 能否真正生成卡 | ❌ 不能（§2.1）。只能把整理好的 prompt 复制给用户，实际退化成 (c) 的一个子集 | ⚠️ 面板能收答案，但**每个 Phase 的追问仍需模型**；面板给的静态问题集等于把「读完正文再追问」降级成「填空问卷」 | ✅ 能：模型拿到 `awu_distill_guide` 的长文档，自己读正文、自己追问 | ✅ 同 (c)，另加确定性校验 |
| 新增代码量（估） | 客户 ~150 行 + 后端 1 路由 | 客户 **600–900 行**（6 屏状态机 + 进度持久化 + 跳过/回退/校验）+ 后端 2–3 路由 | 客户 ~260 行 + 后端 ~210 行 | 客户 **~365 行**（组件 300 + CSS 55 + api 8）+ 后端 **~260 行** |
| 用户动作数 | 粘正文 → 等待 → （其实什么都没发生） | 粘正文 → 6 屏填空 → 等待 | 复制指令 → 粘进对话 → 对话里 5 轮问答 → 输出卡 | 同 (c) + 粘回 JSON → 扫一眼字段差集 → 进编辑器 → 保存（**9 次交互，但每一步都有确定性反馈**） |
| 失败面 | 高：面板假装能生成，失败时用户不知道该怪谁 | 高：任一 Phase 的答案与后端契约错位都难定位；断线后向导状态易丢 | 中：模型跑偏时用户只看到一段坏 JSON | **低**：坏的 JSON 在校验层被拦下并逐条报错，**绝不落盘** |
| 与 L2 分层原则 | 无关（面板自己扛长流程） | ❌ 违反：六屏问题文本 + 字段说明会硬编码进客户端（≈ 一份影子长文档），且无 L2 出口 | ✅ 完全符合：长文档只在工具返回值里出现一次 | ✅ 完全符合 |
| 进度可见性 | 假（无真实进度可显示） | 中：只有用户自己填到第几屏 | ⚠️ 弱：面板看不到对话 | **中**：不伪造 Phase 进度，只报宿主真正看到的事实（粘回后的 34 字段差集 + 重名） |
| 与既有组件的耦合 | 中（新弹层 + 新表单） | **高**（新 tab / 新全屏路由 + 新状态机 + text.ts 50+ 键） | 低（一个弹层 + 一个按钮） | 低（一个弹层 + 一个按钮 + 复用 `CardEditor`） |
| 可回退性 | 差（沉没成本高） | 差 | 好 | 好（删掉入口即回零，后端只多 1 路由 1 工具） |

### 2.3 结论

**选 (c′)。** (c) 符合项目已定的 L2 分层原则（`docs/DEVELOPMENT.md:34-42`、`src/prompt.ts:19`），(a) 在物理上做不到「生成」，(b) 是「把模型擅长的事用面板重做一遍」。

(c) 唯一真实的弱点是**用户点完按钮会茫然**——任务书也点了这一点。c′ 用四个可见锚点解决（§3.2），核心是：**面板不假装自己知道进度**，它只做三件确定的事——递话、验货、交货。

---

## 3. 推荐方案 c′：三段式交接闭环

> ⚠️ **v2 修正**：下面这版流程图里的「① 递话 = 给一句可复制的指令」已经被 v2 升级成「**点发送，指令自动进会话并提交**」（§12）。三段结构（递话 → 长流程 → 验货）本身不变，也仍然是 v2 的骨架；只是第一步从「用户复制粘贴」变成了「一次点击」，并且 `awu_distill_guide` 换成了 `distill/flow.md`。

```
① 递话  panel 给一句可复制的「开场指令」
        ↓ 用户粘进 DSH 对话（连同作品正文/作品名）
② 长流程 对话里：模型调 awu_distill_guide → 按 5 个 Phase 追问 → 最终输出一个 ```json 代码块
        ↓ 用户把那段 JSON 复制出来
③ 验货  panel POST /distill/parse → 剥代码块 → 解析 → 对齐 34 字段 → 查重名
        ↓ 通过（或带缺字段提示）
④ 交货  panel 打开 CardEditor（预填）→ 用户点保存 → 走既有 /character/save → writeCard
```

### 3.1 三段状态（面板只认这三种，绝不发明第四种）

| 状态 | 面板拿什么判定 | 显示什么 |
|---|---|---|
| `idle` | 没有 `POST /distill/parse` 的成功结果 | 三步说明 + 「复制开场指令」+ 空输入框 |
| `parsed` | `/distill/parse` 返回 `ok:true` | `31/34` 进度条 + 缺哪些分组 + 提醒条数 + 重名警告 + 「进编辑器确认」 |
| `editing` | 用户点了「进编辑器确认」 | 整块交给 `CardEditor`（面板内全屏，`index.tsx:1266-1276` 那条分支） |

**刻意不做的第四种状态**：`running` / `phase 3/5`。面板看不见对话，画一个「正在进行第 3 阶段」的进度条就是在骗人——那才是真正让人发怵的地方。

### 3.2 「安全感」四件套（针对「点了按钮一脸茫然」）

1. **按钮文案自带后果**：主按钮写「蒸馏」，`title="从作品蒸馏一张角色卡"`；点了先开工作台，**不直接关面板、不跳走**。
2. **工作台第一屏就是解释**：三行步骤 + 一句为什么（`distill.why`：卡片必须由模型写；面板只做校验、去重与保存）。用户手上永远有一个**具体动作**（复制），而不是一个转圈。
3. **进度只报真话**：粘回后立刻给出「31/34 字段、缺 `world` `user_persona`、2 条提醒、重名冲突」——这是宿主**真的**算出来的。
4. **在你点保存前，一个字节都不写盘**：`/distill/parse` 是纯函数、零 IO（§5.2）。用户随时可以关掉面板、关掉 DSH，磁盘上什么都没变。这条要写在工作台的 hint 里（`distill.noProgress` 的措辞同时承担这个职责）。

### 3.3 断点续航（用户中途关面板）

> **v2 改动**：不再做 localStorage 草稿续航。理由：弹层变短（发送 + 粘贴两步），模型输出就躺在会话历史里，重开弹层重新粘一次成本极低；省掉一份需要版本化的浏览器状态。下面的 v1 设想留档。

- 输入框文本 + 最近一次校验结果存 `localStorage['awu.distill.draft.v1']`（浏览器内建，零依赖，**不进后端**）。
- 重新打开工作台时：有未确认草稿 → 顶部出现「恢复上次未确认的草稿」/「丢弃草稿」（`distill.resume` / `distill.discard`）。
- 对话里的进度**天然不丢**（那是 DSH 会话的事），面板不承担续跑责任——这也是 c′ 比 (b) 健壮的地方：没有需要持久化的流程状态机。

---

## 4. 入口设计

### 4.1 主入口：角色簿头部工具行

理由：蒸馏的产物是**新角色**，主入口必须长在「新建角色」旁边；角色簿是第一屏，用户不需要先点进任何地方。放在「统计」或详情页都会让用户多走一步且语义错位（详情页属于一个**已存在**的角色，容易被理解成「给这个角色再蒸馏一次」）。

行号：`client/index.tsx:1422-1437`（当前 HEAD）。

```
┌─ 角色管理器 ────────────────────────────────────┐
│  AI WITH U                                      │
│  角 色 管 理 器                          ↻   ✕  │
│ ┌─────────────────────────────────────────────┐ │
│ │ ●  虞照                                      │ │
│ │    已启用 今天 · 文本 + 动作    [⌨] [↻] [退出]│ │
│ └─────────────────────────────────────────────┘ │
│  ┌────────┐┌────────┐┌────────┐                │
│  │ 3 角色 ││ 0 记忆 ││ 0 对话 │                │
│  └────────┘└────────┘└────────┘                │
│  ── 角色簿 ──  日记  ──  统计 ────────          │
│  共 3 位                        [✒ 蒸馏] [＋ 新建角色]│
│  ┌─────────────────────────────────────────────┐ │
│  │ 虞  虞照    两个月前搬进你合租房的室友      ›│ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- 按钮：`className="awu-btn" data-size="sm" data-kind="ghost"`，位于「新建角色」左邻；`marginLeft:"auto"` 从「新建角色」（`index.tsx:1431`）**移到蒸馏按钮**上，两者相邻不散。
- 图标复用 `IconQuill`（`client/icons.tsx`，已被「忘记」按钮用过，无需新增图标）。
- 宽度预算：452px 面板，`共 3 位` + 两个 sm 按钮 = 约 300px，放得下；英文 `3 total` + `Distill` + `New character` 约 320px，仍放得下。

### 4.2 次入口：角色簿空态

空态（`client/index.tsx:1441-1447`，「角色簿还是空的」）正是「你还没有任何卡，可以用作品蒸馏一张」的场景，必须给按钮，否则用户只知道 `roster.empty.hint` 里那句「把原 ai-with-u 的 characters 目录搬进插件目录」。

```
┌─────────────────────────────────────────┐
│                  ✦                      │
│           角色簿还是空的                │
│   新建一张角色卡就能开始；也可以把原     │
│   ai-with-u 的 characters 目录搬进来。  │
│                                         │
│         [✒ 蒸馏角色卡]  [＋ 新建角色]     │
└─────────────────────────────────────────┘
```

（`.awu-empty` 是 `display:flex; flex-direction:column; align-items:center`（`client/styles.ts:1182-1191`），直接塞按钮即可，无需改样式。）

### 4.3 明确不放的入口

| 位置 | 不放的理由 |
|---|---|
| `CharacterDetailView` hero 动作区（`index.tsx:728-768` 一带） | 详情页是「已存在的角色」，此处的动作都是「对这个角色做点什么」（编辑/启用/删除）。放蒸馏会被理解成「重新蒸馏覆盖」。 |
| `CardEditor` 内部 | 编辑器是字段级编辑，蒸馏是产出级；且编辑器里 `name` 只读（`card-editor.tsx:286-288`），而蒸馏必须能定名。 |
| 侧栏入口徽标 | 那是面板开合开关（`index.tsx:1186-1216`），加二级动作会破坏「一个席位一个行为」的既有约定。 |

### 4.4 工作台版面（三态 ASCII）

**态 A：待开始（`idle`）**

```
┌─ 蒸馏角色卡 ──────────────────────────────┐
│ ✒  蒸馏角色卡                        ✕   │
├───────────────────────────────────────────┤
│ 角色卡必须由模型来写；这一步在对话里进     │
│ 行，面板只负责校验、去重与保存。          │
│                                           │
│ ① 复制开场指令，连同作品正文发进对话       │
│ ② 模型会逐阶段追问，最后给一个 json 代码块 │
│ ③ 把那段 JSON 粘回下面，校验后进编辑器     │
│                                           │
│              [⧉ 复制开场指令]              │
│                                           │
│ 粘贴模型给的卡片 JSON                     │
│ ┌───────────────────────────────────────┐ │
│ │ ```json                               │ │
│ │ { "name": …                           │ │
│ └───────────────────────────────────────┘ │
│ 面板看不到对话里的进度，所以这里只显示你   │
│ 已经粘回来的结果。                        │
├───────────────────────────────────────────┤
│                        [取消]  [校验]     │
└───────────────────────────────────────────┘
```

**态 B：校验通过（`parsed`）**

```
┌─ 蒸馏角色卡 ──────────────────────────────┐
│ ✒  蒸馏角色卡                        ✕   │
├───────────────────────────────────────────┤
│  ✓ 校验通过：31/34 个字段                 │
│  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱  91%       │
│                                           │
│  分组  [基本信息✓][声线✓][性格✓][关系✓]    │
│        [背景·缺][锚点✓][动态✓][互动✓]      │
│        [你的身份·缺][开场✓]                │
│                                           │
│  角色名（进编辑器后不可改）                │
│  ┌───────────────────────────────────────┐ │
│  │ 虞照                                  │ │
│  └───────────────────────────────────────┘ │
│  ⚠ 2 条提醒：未识别的顶层键 meta；openings │
│    共 9 条，已截断到 8 条                  │
│                                           │
│  2 条缺字段提醒不影响保存，可在编辑器补全  │
├───────────────────────────────────────────┤
│              [取消]  [进编辑器确认]        │
└───────────────────────────────────────────┘
```

**态 C：重名冲突**

```
│  ⚠ 已有同名角色「虞照」                   │
│     保存会覆盖它的角色卡（日记与会话保留） │
│     [改个名字]                            │
│  角色名  ┌───────────────────────────────┐ │
│          │ 虞照（改这里即可）            │ │
│          └───────────────────────────────┘ │
```

### 4.5 文案表（中英双份，**v2 实际 34 键**）

键前缀沿用集成契约 §三的 `distill.`。**这张表就是给 Lead 合并进 `client/text.ts` 的完整清单**（zh 加在 `:176` 的 `edit.discard` 之后，en 加在 `:342` 之后）。`client/distill.tsx` 里 `t()` 用到的键**必须全在这张表里**，缺任何一个，界面上就会直接显示裸 key（`makeTranslator` 的兜底，`client/text.ts:369`）。

| key | zh | en |
|---|---|---|
| `distill.entry` | 蒸馏 | Distill |
| `distill.entryTitle` | 从作品蒸馏一张角色卡 | Distill a card from a story |
| `distill.title` | 蒸馏角色卡 | Distill a character card |
| `distill.why` | 角色卡必须由模型来写；这一步会把蒸馏指令发进当前对话，流程正文在 distill/flow.md 里（不占系统提示词）。 | Cards must be written by the model. This sends the distillation prompt into the current chat; the flow itself lives in distill/flow.md (never in the system prompt). |
| `distill.step1` | 点「发送」，指令会进当前会话并直接发出 | Click Send — the prompt goes into the current chat and is submitted |
| `distill.step2` | 模型会按 flow.md 分阶段追问，最后给一个 json 代码块 | The model follows flow.md, asks by phase, then returns one json block |
| `distill.step3` | 把那段 JSON 粘回这里，校验后进编辑器确认 | Paste that JSON back here, validate, then confirm in the editor |
| `distill.send` | 发送到当前会话 | Send to this chat |
| `distill.noDockShort` | 输入框未就绪 | No chat yet |
| `distill.noDock` | 还没有可用的会话输入框：先打开一个对话，或直接复制指令手动粘贴 | No chat composer available: open a chat, or copy the prompt and paste it yourself |
| `distill.sent` | 已发送，去对话里继续 | Sent — continue in the chat |
| `distill.filled` | 已填入输入框，按回车发送 | Filled into the input — press Enter to send |
| `distill.busyFilled` | 会话正在生成，先没发出去；已填入输入框，等这一轮结束再按回车 | The chat is busy, so nothing was submitted; the prompt is in the input — press Enter once this turn ends |
| `distill.flowFailed` | 读不到蒸馏流程文件 distill/flow.md（插件安装不完整） | Cannot read distill/flow.md (incomplete install) |
| `distill.insertFailed` | 指令没能写进输入框（会话可能正在生成，或输入框刚被改动）；可以先复制，等一下再发 | Could not write into the input (the chat may be busy, or the draft just changed); copy it and retry |
| `distill.submitFailed` | 已填入输入框，但自动发送失败；按回车即可 | Filled, but auto-submit failed — just press Enter |
| `distill.copy` | 复制指令 | Copy prompt |
| `distill.copied` | 已复制 | Copied |
| `distill.copyFailed` | 复制失败，请手动选中下面的文字 | Copy failed — select the text below manually |
| `distill.pasteLabel` | 粘贴模型给的卡片 JSON | Paste the card JSON |
| `distill.pastePlaceholder` | 整段 json 代码块或裸 JSON 都可以 | A fenced json block or raw JSON both work |
| `distill.validate` | 校验 | Validate |
| `distill.pasteEmpty` | 先把模型给的 JSON 粘进来。 | Paste the model's JSON first. |
| `distill.tooLarge` | 内容 {kb} KB，超过上限 {max} KB — 只需要粘角色卡那一段。 | {kb} KB exceeds the {max} KB limit — paste only the card itself. |
| `distill.parsed` | 校验通过：{filled}/{total} 个字段 | Validated: {filled}/{total} fields |
| `distill.missingGroups` | 还没写的分组：{groups} | Groups still empty: {groups} |
| `distill.warnings` | {n} 条提醒 | {n} notices |
| `distill.conflict` | 已有同名角色「{name}」 | A character named “{name}” already exists |
| `distill.conflictHint` | 保存会覆盖它的角色卡（日记与会话记录保留）。 | Saving overwrites its card (diary and session history are kept). |
| `distill.nameLabel` | 角色名（进编辑器后不可改） | Name (read-only once in the editor) |
| `distill.nameRequired` | 先给角色起个名字。 | Give the character a name first. |
| `distill.nameTaken` | 这个名字已经被占用了。 | That name is taken. |
| `distill.nameInvalid` | 名字不能包含 / 或 \，也不能是 . 或 ..。 | The name cannot contain / or \, nor be . or .. |
| `distill.openEditor` | 进编辑器确认 | Open in editor |
| `distill.noEditor` | 面板还没有接上编辑器：先把 JSON 复制走，稍后再粘 | The panel is not wired to the editor yet: copy the JSON and paste it later |
| `distill.noProgress` | 面板看不到对话里的进度，所以这里只显示你已经粘回来的结果；在你点保存前，磁盘上什么都没变。 | The panel cannot see the chat, so it only shows what you pasted back. Nothing is written to disk until you save. |
| `distill.dockDraftNotEmpty` | 输入框里已有文字，先用面板里的「发送」，或清空后再点这里 | The input already has text — use Send in the panel, or clear it first |
| `distill.dockFilled` | 指令已填入输入框，按回车发送 | Prompt filled into the input — press Enter to send |
| `distill.dockUnavailable` | 没拿到输入框能力：去面板里点「发送」，或复制指令手动粘贴 | Composer API unavailable: use Send in the panel, or copy the prompt |

> **现在就要的键（18 个）**：`entry` `entryTitle` `title` `why` `step1` `step2` `step3` `send` `noDockShort` `noDock` `sent` `filled` `busyFilled` `flowFailed` `insertFailed` `submitFailed` `copy` `copied` `copyFailed` `noProgress` `dockDraftNotEmpty` `dockFilled` `dockUnavailable`（共 23；其余是粘贴校验用的，等 CCv3 定稿再一起进 `text.ts`，先加也不报错、只是暂时用不上）。
>
> **⏸ 暂缓的键**：`pasteLabel` `pastePlaceholder` `validate` `pasteEmpty` `tooLarge` `parsed` `missingGroups` `warnings` `conflict` `conflictHint` `nameLabel` `nameRequired` `nameTaken` `nameInvalid` `openEditor` `noEditor` —— 它们跟着 34 字段校验一起挂起。
>
> v2 相对 v1 删掉了 4 个键（`distill.entryEmpty` / `distill.resume` / `distill.discard` / `distill.discarded`）：弹层变短、不再做 localStorage 草稿续航；空态入口直接用 `distill.entry`。
> 文案里 `json` 一词不加反引号/代码样式：弹层是普通文本节点，加符号反而像没渲染的 markdown。

---

## 5. 后端设计（`src/**`，归本设计）

### 5.1 改动总览（**v2 实际落地**）

| # | 文件 | 动作 | 状态 |
|---|---|---|---|
| B0 | `distill/flow.md` | **新建**（4.2 KB）：5 阶段 + 34 字段契约 + 输出格式 + 交卡自检 + 交回面板的话术 | ✅ 已写 |
| B1 | `src/distill.ts` | **新建**（~420 行）：`distillFlowPath / readDistillFlow / buildDistillInstruction / distillFlowInfo` + `DISTILL_GROUPS` + `normalizeDistillCard` + `parseDistillCard`。除读 `flow.md` 外零 IO | ✅ 已写 |
| B2 | `src/web.ts` | **+2 条路由**：`GET /distill/flow`（第 17 条）、`POST /distill/parse`（第 18 条），+1 行 import | ✅ 已写；插在 `:336` 与 `:337` 之间，import 加在 `:16` 之后 |
| B3 | `src/index.ts` | **不改**（v1 的常驻挂载已废弃，见 §5.9） | ✅ 未动 |
| B4 | `src/store.ts` | **不改**（复用 `writeCard`，理由见 §5.5） | ✅ 未动 |
| B5 | `src/tools.ts` | **不改**（v1 的 `awu_distill_guide` 已废弃，见 §5.8） | ✅ 未动 |

`src/distill.ts` 不允许 import `client/**`（`tsconfig.json` 只编 `src/**/*.ts`，`client` 由 esbuild 独立打包，跨端 import 直接编译失败），所以字段契约是 `client/card-schema.ts:66-194` 的**手工镜像**。镜像必须有机器检查，见 §9.5。

### 5.2a B2：`GET /distill/flow`（v2 新增）

**为什么需要它**：面板要「发一条指令」，但指令里的**绝对路径只有宿主知道**（`import.meta.url` 是宿主模块的）。而且 flow.md 缺失时必须在**发送前**就发现，不能等模型读到一半才炸。所以路径与指令文本统一由宿主生成，客户端只负责搬运。

**请求**：无body、无 query（`GET /distill/flow`）。

**成功响应（200）**

```jsonc
{
  "ok": true,
  "path": "D:\\CODEX\\deepseek-work\\01-projects\\dsh-ai-with-u\\distill\\flow.md",
  "instruction": "请帮我从作品里蒸馏一张角色卡。\n\n第一步：完整读取这份流程文件，按它执行：\nD:\\…\\distill\\flow.md\n\n要求：\n1. 读完先只回一句「流程已读，请给我作品名或正文」，不要提前开讲。\n2. 按文件里的 5 个阶段推进，一次只问一个问题。\n3. 最终只输出一个 json 代码块，键名用中文、逐字照文件里的字段契约，不要翻译。\n4. 不要调用任何 awu_* 工具；蒸馏不依赖它们，最后也不要替我保存卡片。\n\n作品：（在这里贴正文；只给作品名也可以，但请先提醒我可能有记忆偏差）",
  "chars": 289,
  "flowChars": 4237
}
```

- `chars` = `instruction.length`（面板判断会不会太长）；`flowChars` = `flow.md` 自身字符数（顺带证明文件存在且非空）。
- 指令正文由 `src/distill.ts` 的 `buildDistillInstruction()` 拼；**只有路径 + 4 条要求，不含 34 字段契约**（这是 v2 满足 L2 铁律的方式）。

**失败响应（400，走 `guard`）**

| 触发 | `error` 文案 |
|---|---|
| `flow.md` 不存在 | `找不到蒸馏流程文件：<路径>（插件安装不完整：distill/flow.md 应随包发布）` |
| 读盘失败（权限等） | `读取蒸馏流程文件失败：<路径>（<原因>）` |
| 文件是空白 | `蒸馏流程文件是空的：<路径>` |

> 面板侧对这三种失败的处理：显示错误 + 保留「复制指令」不可用 + 不拦着用户去看对话（此时只能靠模型记忆，不是我们的问题，但要如实说）。

### ⏸ 5.2b（挂起）`POST /distill/parse`

**为什么需要它**：把「模型输出的自由文本」变成「面板能信任的卡」。校验放在宿主侧而不是客户端，原因有三：① 34 字段契约与 §5.6 的校验规则只有一份实现，客户端不必再抄一遍；② 重名判断要用 `store.readCard`（客户端只持有列表，列表可能过期）；③ 客户端拿到的就是可以直接进 `CardEditor` 的 `Card`。

**请求**

```jsonc
POST /_dsh/ai-with-u/distill/parse
Content-Type: application/json

{
  "raw": "```json\n{ \"name\": \"虞照\", \"basic\": { \"姓名\": \"虞照\" } }\n```"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `raw` | string | ✅ | 模型输出的原文。允许带 ```` ```json ```` 围栏、前后解释文字；服务端负责定位第一个平衡的 `{…}`。上限 1 MB（`DISTILL_MAX_RAW_BYTES`）。 |

**成功响应（200）**

```jsonc
{
  "ok": true,
  "name": "虞照",
  "card": {                       // 已归一化：只含非空字段，source 已注入 'distill'
    "name": "虞照",
    "basic": { "姓名": "虞照", "身份": "两个月前搬进你合租房的室友" },
    "voice": { "爱用句式": ["我跟你说", "真的"], "自称": "我" },
    "opening": "（把两袋菜往你怀里一塞）自己拿。",
    "openings": ["…", "…"],
    "source": "distill"
  },
  "stats": { "filled": 31, "total": 34 },
  "missingGroups": ["world", "user_persona"],
  "missingFields": ["voice.禁忌词", "dynamic_state.此刻在做什么"],
  "warnings": ["未识别的顶层键：meta", "openings 共 9 条，已截断到 8 条"],
  "conflict": { "exists": true, "name": "虞照", "source": "custom" }
}
```

- `conflict` **仅在有同名卡时出现**（`store.readCard(name) !== undefined`）；无冲突时该键整个省略。
- `missingGroups` 是「整组都空」的分组 id；`missingFields` 是「组内至少填了一个、但有字段空着」的个别字段 —— 前者是给进度条用的粗粒度，后者是给润色提示用的细粒度。
- `warnings` 只有提示价值，**不阻断**保存。

**失败响应（400，走 `guard`，`src/web.ts:58-65`）**

沿用既有 `{ok:false,error}` 信封，**不新增 `code` 字段**（避免与 16 条老路由的信封分叉；错误文案本身必须可操作）：

| 触发 | `error` 文案 |
|---|---|
| `readBody` 超 4 MB（`web.ts:37`） | `请求体过大`（既有文案，不改） |
| `raw` 为空 | `先把模型给的 JSON 粘进来（raw）` |
| 找不到 `{…}` | `这段文本里没有 JSON 对象；请只粘模型最后那段代码块` |
| JSON 语法错 | `JSON 解析失败（第 {pos} 个字符）：{detail}`。实现：用 `/at position (\d+)/` 从 `JSON.parse` 的 message 里取位置（Node 22 的 V8 一定带），取不到就省掉位置；同时按 `\n` 数把 `pos` 换算成行列一并给出 |
| 顶层不是对象 | `这不像一张角色卡：顶层必须是 JSON 对象` |
| `name` 缺失/非字符串/非法 | `卡片缺少可用的 name（不能为空、不能含 / 或 \、不能是 . 或 ..）` |
| 超过 1 MB | `蒸馏输入过大（{n} KB），上限 1024 KB` |

**handler 骨架（可直接抄）**

```ts
// src/web.ts —— 加在 return [ ... ] 的最后一项之后（:336 与 :337 之间）
{
  method: 'POST',
  path: `${ROUTE_PREFIX}/distill/parse`,
  handler: guard(async (req, res) => {
    const body = await readBody(req)
    const result = await parseDistillCard(store, body['raw'])
    send(res, 200, { ok: true, ...result })
  }),
},
```

```ts
// src/web.ts:16 之后
import { parseDistillCard } from './distill.js'
```

> ⚠️ 沿用既有「method 是装饰品」的现状（`src/index.ts:208-214` 注册时只用 `path`）：`GET /distill/parse` 也会进同一个 handler，`readBody` 拿到空体返回 `{}`，于是报「先把模型给的 JSON 粘进来」。这是既有行为，本次**不修**（超出范围，且 16 条老路由同样如此）。

### 5.3 为什么**不做** `GET /distill/state`

被评估过，结论是不做，三条理由：

1. **没有可观测的进度**。面板与对话之间没有通道（§2.1）。要显示 Phase 进度，只能让模型每次调工具时顺手写一个进度文件——那是**让长流程去污染磁盘**（新增 `_distill/*.json`、清理责任、并发写、崩溃残留），而换来的只是一个装饰用的进度条。
2. **`/distill/parse` 已经给出了确定性进度**：粘回之后 `stats.filled / 34` 是宿主真算出来的。用户真正关心的不是「走到第几步」，是「还缺什么」。
3. **状态放客户端更省**：`localStorage` 恢复草稿（§3.3）零后端成本，且天然多端不串。

如果将来确实需要「面板显示蒸馏历史」，正确做法是**读已有数据**而不是新建状态：`GET /characters` 里 `source === 'distill'` 的卡就是蒸馏产物（这正是 §5.4 把 `source` 注入成 `'distill'` 的第二个理由，第一个是 `/overview` 的 `bySource` 统计能区分来源）。

### 5.4 ⚠️ B1：`src/distill.ts` 结构（**导出清单以 v2 为准，见下方「v2 实际导出」**）

```ts
/**
 * AI WITH U · 从作品蒸馏角色卡（L2 长流程出口）
 *
 * 本文件只做三件事，全部零 IO：
 *   1. 字段契约（client/card-schema.ts 的 GROUPS 的宿主侧镜像，34 字段）
 *   2. 长流程指南全文（只在 awu_distill_guide 的返回值里出现，永不进 system prompt）
 *   3. 卡片校验/归一化（把模型给的自由 JSON 变成面板能直接塞进 CardEditor 的卡）
 * @module dsh-ai-with-u/distill
 */
```

**导出清单**

| 导出 | 签名 | 用途 |
|---|---|---|
| `DISTILL_FIELD_TOTAL` | `34` | 自检与响应里的 `stats.total` |
| `DISTILL_PHASES` | `readonly ['overview','scope','voice','core','world','assemble']` | 工具 `phase` 参数枚举 |
| `DISTILL_GROUPS` | `DistillGroup[]`（10 组，见 §5.6） | 契约唯一真相（宿主侧） |
| `DISTILL_LIMITS` | `{ maxRawBytes: 1048576, maxCardBytes: 262144, maxOpenings: 8, maxAnchors: 8 }` | 校验阈值 |
| `DISTILL_GUIDE_TEXT` | `string`（≈2.4 KB，全文见附录 A） | **L2 文档本体** |
| `buildGuide(phase, note?)` | `DistillGuideResult` | 工具的返回值构造 |
| `locateCardJson(raw)` | `string`（抛错时带位置） | 从任意文本里剥出 JSON 对象 |
| `normalizeDistillCard(input)` | `{ card, name, stats, missingGroups, missingFields, warnings }` | 归一化 + 校验 |
| `parseDistillCard(store, raw)` | `Promise<DistillParseResponse>` | 上面两者的组合 + 查重名（唯一碰 store 的地方，只调 `readCard`） |
| `createDistillTools()` | `ToolDef[]` | 供 `src/index.ts` 常驻挂载 |

`DistillGroup` 的形状（与 `client/card-schema.ts:35-58` 的 `GroupSpec` 对齐，但**只保留校验需要的字段**）：

```ts
export type DistillFieldKind = 'text' | 'long' | 'list'

export interface DistillField {
  key: string                 // 中文键名，逐字照抄 card-schema.ts
  kind: DistillFieldKind
  required: boolean           // 只有 basic.姓名 是 true（见 §5.6 注 3）
}

export interface DistillGroup {
  id: string                  // 'basic' | 'voice' | …
  target: 'object' | 'top'
  root: string | null         // target='top' 时为 null（opening 组的两个字段直接挂卡片根）
  title: string               // 中文分组名，与 GROUPS 一致
  optional: boolean           // 只有 user_persona 为 true
  fields: DistillField[]
}
```

### 5.5 B4：`src/store.ts` 不改 —— 复用 `writeCard` 的三条理由

1. **落盘时机天然唯一**。蒸馏产物在「用户于编辑器点保存」之前**不该落盘**；那一刻走的是既有链路 `CardEditor.onSave → index.tsx 的 onSaveCard → api.saveCharacter → POST /character/save → store.writeCard`（`client/index.tsx:1139-1161` → `client/api.ts:273-275` → `src/web.ts:138-151` → `src/store.ts:287-292`）。引入 draft 概念等于给同一个文件开第二条写路径。
2. **draft 会带来三类新债**：孤儿草稿文件（用户关掉面板就永远留着）、索引副作用（`writeCard` 末尾 `touchIndex`（`store.ts:291`）会把 `last_active` 刷成现在，draft 也会被算进 `/characters` 与 `/overview` 的统计）、并发写（`store.ts` 目前没有互斥锁，`docs/DEVELOPMENT.md:441` 已列为待修）。
3. **`writeCard` 已经免费提供三件必需语义**：强制 `name = normalizeName(name)`（`store.ts:288-290`）、原子写（`atomicWrite`，`:63-73`）、索引一致（`touchIndex`，`:249-257`）。改它反而要重新验证这些。

**重名冲突**因此也不在 `store.ts` 加参数，而是由 `/distill/parse` 用 `store.readCard(name)`（`src/store.ts:283-285`）**只读**判断，把结果交给面板做「覆盖 / 改名」二选一；「覆盖」就是既有语义（编辑器保存本来就是整体覆盖，`web.ts:147`）。这样 `store.ts` 零改动，也不引入第二个冲突语义。

> 若要更严（防止两个面板同时保存同一张新卡），那是既有「写盘无互斥」问题（`docs/DEVELOPMENT.md:441`，全项目级），不在本功能范围内单独打补丁。

### ⏸ 5.6（挂起）字段契约：10 组 34 字段 —— **等 CCv3 定稿后整体作废重写**

**⚠️ 不要照抄 `src/store.ts:30-33` 的 `FULL_FIELDS`**：它是 9 项，**缺 `world` / `user_persona` / `opening` / `openings`**，且全仓无人引用（`docs/DEVELOPMENT.md` 与 `06-tmp\aiwu-survey\host.md:185` 均已列为死常量）。照它出卡会稳定缺 4 个字段。

| # | 组 id | 中文组名 | target / root | 字段（kind） | 组字段数 |
|---|---|---|---|---|---|
| 1 | `basic` | 基本信息 | object / `basic` | 姓名(text,required)、年龄(text)、身份(text)、一句话背景(long) | 4 |
| 2 | `voice` | 声线基因 | object / `voice` | 对话节奏(long)、爱用句式(**list**)、自称(text)、对用户的称呼(text)、情绪口头禅(**list**)、禁忌词(long)、非语言小动作(**list**) | 7 |
| 3 | `personality` | 性格核心 | object / `personality` | 关键词(**list**)、内在矛盾(long)、对待亲近之人(long) | 3 |
| 4 | `relationship` | 关系定位 | object / `relationship` | 关系起点(text)、角色怎么称呼用户(text)、用户怎么称呼角色(text) | 3 |
| 5 | `world` | 故事背景 | object / `world` | 来处(long)、落差(long)、如今的日子(long)、你与他的旧(long) | 4 |
| 6 | `memory_anchor` | 记忆锚点 | object / `memory_anchor` | 要点(**list**) | 1 |
| 7 | `dynamic_state` | 动态状态 | object / `dynamic_state` | 当前情绪(text)、近况(long)、此刻在做什么(text) | 3 |
| 8 | `interaction_pref` | 互动偏好 | object / `interaction_pref` | 回复长度倾向(text)、表情使用(text)、话题舒适区(text)、雷区(long) | 4 |
| 9 | `user_persona` | 你的身份 | object / `user_persona` | 你是谁(text)、与 TA 的关系(text)、共同经历(long) | 3 |
| 10 | `opening` | 开场白 | **top** / — | `opening`(long)、`openings`(**list**) | 2 |

合计 **4+7+3+3+4+1+3+4+3+2 = 34**。

**注 1（键名逐字禁止改动）**：`user_persona['与 TA 的关系']` 中间是**半角空格**（`client/card-schema.ts:180`，三份 `presets/*/card.json` 逐字一致）。任何「顺手统一格式」都会让老卡在新 schema 下变成「未填写」。

**注 2（两种顶层形态）**：9 个组是卡片根下的子对象；`opening` 组的两字段直接挂在卡片根（`target:'top'`）。`toDraft`（`card-schema.ts:215-229`）与 `mergeCard`（`:245-293`）都按 `target` 分支处理，镜像契约必须同样分两种。

**注 3（required 的真相）**：整张卡唯一硬约束是**顶层 `name`**（`store.ts:288`）。`basic.姓名` 标 `required:true` 是因为它和 `name` 双写（三份 preset 都是这样）；校验时若 `basic.姓名` 为空则**用 `name` 自动补齐**，不算错误。其余 33 个字段全部 `required:false`——空字段要鼓励，假字段要禁止（附录 A 铁律 2）。

**注 4（list 字段共 6 个）**：`爱用句式` `情绪口头禅` `非语言小动作` `关键词` `要点` `openings`。

### ⏸ 5.7（挂起）校验规则（`normalizeDistillCard`）

| # | 规则 | 处理 |
|---|---|---|
| V1 | 顶层必须是 JSON 对象（非 `null`、非数组） | 抛错「顶层必须是 JSON 对象」 |
| V2 | `name` 必须是去空格后非空字符串，且不含 `/` `\`，不等于 `.` / `..` | 抛错（与 `store.ts:53-60` 的 `normalizeName` 口径一致，但**不 import 它**——`distill.ts` 保持零 IO 零依赖，规则手写三行） |
| V3 | 9 个 object 组：值是对象才处理；是字符串/数组/`null` → 整组忽略 + `warnings.push('分组 X 应为对象，已忽略')` | 忽略不抛错 |
| V4 | `list` 字段：数组 → `map(String).filter(非空白)`；**字符串 → 按 `、；;,\n` 拆开再过滤**（防「爱用句式: "我跟你说、真的"」被 `asList`（`card-schema.ts:200-204`）当成单条）；其它类型 → 丢弃 + warning | 归一成 `string[]`，空数组则不产生该键 |
| V5 | `text`/`long` 字段：字符串 → `trim()` 首尾（**不 trim 内部换行**）；数组 → 用 `、` 连接 + warning；number/boolean → `String()` | 归一成 `string` |
| V6 | `openings`：超过 8 条截断 + warning（对齐 `/opening/next` 的 candidates 无上限风险，见 `06-tmp\aiwu-survey\host.md:435`） | — |
| V7 | `memory_anchor.要点`：超过 8 条截断 + warning（memory_anchor 会整段进 L1 提示词，不设限会吃掉 token 预算） | — |
| V8 | 未识别的顶层键 | **保留**（项目约定：`mergeCard` 保留 schema 之外的自定义键，`card-schema.ts:9-12 / :246`）+ warning `未识别的顶层键：x` |
| V9 | 注入 `source: 'distill'`（覆盖模型给的值） | 让 `/overview` 的 `bySource` 能区分来源 |
| V10 | `basic.姓名` 为空时用 `name` 补齐 | 见注 3 |
| V11 | 空字段**不产生键**（不写 `""` / `[]`） | 与 `mergeCard` 的「清空即删键」（`:271-277`）口径一致，卡片保持干净 |
| V12 | `stats.filled` = 34 字段中「非空」的个数，口径对齐 `client/card-schema.ts:303-318` 的 `filledCount`（数组全空白项视为空） | 面板进度条与编辑器头部的 `31/34` 必须是同一个数 |
| V13 | `JSON.stringify(card)` 的 UTF-8 字节数 > `maxCardBytes`（256 KB） | 抛错「卡片过大（{n} KB），上限 256 KB —— 多半是把剧情塞进 padding 了，请精简 world / memory_anchor」。正常卡 4–12 KB，这条只是防呆阀 |

### 5.8 ❌ 已废弃（v1）：`awu_distill_guide` 工具定义

> **这一节不要实现**。主人推翻了「工具通道」路线：蒸馏改走「一张 flow.md + 一条发进会话的指令」（§12）。
> 保留原文只为了记录当时的设计与两处判断（`items` 写法、`output.schema` 要带 `additionalProperties`），它们对**将来任何新工具**仍然成立。

**参数 schema**（注意：本工具**没有数组参数**，所以天然避开 `tools.ts:56/60/220` 那个 `item:` → `items:` 的已知 bug；**若将来加数组参数，必须写 `items`**。`output.schema` 也必须带 `additionalProperties`，不能照抄 `tools.ts:30-33` 的 `{ type: 'object' }`）

```ts
{
  name: 'awu_distill_guide',
  description: '从作品蒸馏角色卡的长流程指南（分阶段返回）。用户想「从这小说/剧本里抽一个角色做成角色卡」「蒸馏角色」'
    + '时先调用 phase="overview" 拿阶段清单与字段契约，然后按返回的 next 逐阶段推进；每个阶段先问问题再落字段。'
    + '本工具不读写任何角色数据，返回的长文档不要复述给用户，自己照着做即可。',
  parameters: {
    phase: {
      type: 'string',
      enum: ['overview', 'scope', 'voice', 'core', 'world', 'assemble'],
      description: '要哪一阶段。首次调用传 overview；之后按返回的 next 推进；收尾传 assemble。默认 overview。',
    },
    note: {
      type: 'string',
      description: '可选：当前进度或用户的一句话交代，原样回显在返回里，便于多轮里保持上下文。',
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
  },
  async execute(args) { /* 见下 */ },
}
```

**`execute` 逻辑（7 行）**

```ts
const raw = typeof args['phase'] === 'string' ? args['phase'] : 'overview'
const phase = (DISTILL_PHASES as readonly string[]).includes(raw) ? raw as DistillPhase : 'overview'
const note = typeof args['note'] === 'string' ? args['note'].trim() : ''
return buildGuide(phase, note)
```

**阶段为什么是 5 个而不是原 skill 的 6 个**：原 skill 的六 Phase 流水线（`docs/DEVELOPMENT.md:401`）里，「关系」与「性格」是分开的两屏，「动态状态」与「世界背景」也分开。本设计合并成 `scope → voice → core（性格+关系）→ world（世界+动态）→ assemble（锚点+偏好+开场）`，外加一个 `overview` 总纲入口。理由：① 工具调用次数直接决定一轮蒸馏的往返成本，5 次比 6 次省 1/6；② 合并的两组都是「同一段原文采样就能一起回答」的问题，拆开反而要用户重复交代背景；③ 真正需要独立成阶段的是**声线**（最重要、最费篇幅）与**出卡**（格式约束最严），这两个原样保留。

**返回结构**（`DistillGuideResult`）

```ts
{
  ok: true,
  guideVersion: 'distill/1',
  phase: 'voice',
  phaseTitle: '声线采证',
  next: 'core' | null,              // 最后一阶段（assemble）为 null
  note,                             // 原样回显
  checklist: string[],              // 本阶段要问的问题（3–5 条，来自附录 A，不重复整份文档）
  doneWhen: string[],               // 本阶段收工判据
  selfCheck?: string[],             // 仅 assemble 阶段返回（出卡自检清单）
  outputRule: string,               // '只输出一个 ```json 代码块 …'（每阶段都带，防走偏）
  fieldContract: {
    total: 34,
    full?: DistillGroup[],          // 仅 overview / assemble：完整 10 组
    phaseGroups?: DistillGroup[],   // 其余阶段：只回本阶段负责的组，省 token
  },
  guideText?: string,               // 仅 overview 返回 DISTILL_GUIDE_TEXT 全文（≈2.4 KB）
  limits: { maxCardBytes: 262144, maxOpenings: 8, maxAnchors: 8 },
}
```

设计取舍：**只有 `overview` 返回全文 + 完整契约，`assemble` 返回完整契约 + 自检清单，中间三个阶段只返回该阶段的 checklist 与相关分组**。这样一轮蒸馏的工具 token 总量 ≈ 2.4 KB + 4×(0.4–0.8 KB) ≈ 6 KB，全部走工具返回值（L2），system prompt 一个字符都不加。

### 5.9 ❌ 已废弃（v1）：`src/index.ts` 常驻挂载（**最容易踩的一步**）

> **这一节不要实现**。`src/index.ts` 在 v2 里**一行都不用改**：不挂工具，也就不需要突破「awu_* 与角色同进同出」的语义。
> 下面是 v1 的存档，供「以后真要加一个常驻工具」时参考（门禁在 `src/index.ts:184-186`，不能放进 `sync`）。

现状：8 个 `awu_*` 工具只在「有启用角色」时挂载（`src/index.ts:183-192`）：

```ts
const sync = (): void => {
  const should = pc.characterName !== undefined      // :184
  if (should && toolDisposers.length === 0) { … createTools(store, pc) … }
  else if (!should && toolDisposers.length > 0) { … 全卸 … }
}
```

而蒸馏的**典型场景恰恰是没有启用角色**（要新建一张卡）。所以必须挂在门禁之外：

```ts
// src/index.ts:179  在 registerTools 里，`if (tools === undefined) return` 之后插入 6 行
  // 蒸馏向导是 L2 长文档出口，必须在「没有启用角色」时也在——那正是要新建卡的场景。
  // 它不读不写任何角色数据，与启用态无关；挂载一次后不再随状态变化。
  for (const tool of createDistillTools()) {
    disposers.push(tools.register(tool))
  }
  log.info('已挂载 awu_distill_guide（常驻，与启用态无关）')
```

```ts
// src/index.ts:31 之后
import { createDistillTools } from './distill.js'
```

注意事项：

- 这段**不能放进 `sync`**：`sync` 由 `pc.onStateChange` 反复调用（`index.ts:307`），放进去会重复注册。
- `disposers` 数组在卸载时统一释放（`index.ts:318-325`），符合既有生命周期。
- 位置必须在 `const tools = …` 之后、`sync` 定义之前或之后都可以（闭包里已拿到 `tools`、`disposers`、`log`）。

**这是一处对既有语义的突破**：`docs/DEVELOPMENT.md:53` 写的是「`awu_*` 工具与角色**同进同出**」。本工具是唯一例外，理由写在上面的注释里。代价是每个会话的工具清单里多一条（≈300–400 token 的描述）。这是 c′ 方案能否成立的硬前提，也是主人最可能拍不同意见的一点（§11.1）。

---

## 6. 前端设计

### 6.1 文件与所有权（v2 实际）

| 文件 | 归谁 | 内容 | 状态 |
|---|---|---|---|
| `client/distill.tsx` | **本设计（新建）** | `DockSink` / `DockEntry` / `composerReady` / `useComposerReady` / `composerSessionId` / `sendDistillInstruction` / `SendResult` / `DistillDialog` / `DistillButton`（签名见 §6.2） | ✅ 已写（~560 行，发送通道完整；粘贴校验已摘除挂起） |
| `client/distill.styles.ts` | **本设计（新建）** | `export const DISTILL_CSS`：全 `awu-distill-*`，颜色 token 一律带 `var(--x, 回退值)`（弹层 portal 在 token 作用域外，见 §12.5） | ✅ 已写 |
| `client/api.ts` | **本设计（追加）** | `ROUTES.distillFlow` / `ROUTES.distillParse` + `DistillFlowInfo` / `DistillParseResult` + `fetchDistillFlow()` / `parseDistillCard()`（**后者只是签名骨架**，路由未注册） | ✅ 已写（纯追加） |
| `client/entry.tsx` | **Lead** | 把 `DockSink` 注册到 `conversation.composer.dock`（见 §6.3a）；可选再注册一个 `DockEntry` | ⏳ 待 Lead |
| `client/index.tsx` | **Lead** | 角色簿头部放 `<DistillButton t={t} />`（一行，见 §6.3b P4′）。编辑器支持「未保存的卡」等 CCv3 定稿后再做 | ⏳ 待 Lead |
| `client/text.ts` | **Lead** | §4.5 里「现在就要的 23 个键」 ×2 语言（其余等 CCv3） | ⏳ 待 Lead |
| `client/styles.ts` | **Lead** | `import { DISTILL_CSS }` + 模板串末尾 `${DISTILL_CSS}`（§6.5） | ⏳ 待 Lead |
| `client/card-schema.ts` | 不动 | `GROUPS` 已就绪；本功能当前**完全不读**它（校验挂起后连分组中文名都不用） | — |

### 6.2 `client/distill.tsx` 导出契约（v2 实际）

**Lead 接线必须的四个**（形状与约定完全一致；`DistillDialog` 的 props 在挂起后**收敛成你给的三件**）：

```ts
export function DistillDialog(props: {
  t: Translate
  onClose: () => void
  /** 发送成功后通知外层（外层可刷新，也可什么都不做）。当前实现：`sent` 时调用一次 */
  onDone: () => void
}): JSX.Element

export function DockSink(props: {
  inputActions?: unknown
  sessionId?: string
  /** slot 标准 props 里的 hook，用来读 phase / draft（缺了就放弃，不调用） */
  useInput?: unknown
  useChat?: unknown
}): JSX.Element | null           // 无头：渲染时把能力存进模块级 sink，返回 null

export function composerReady(): boolean      // dock 是否已拿到可用的 insertText

export function sendDistillInstruction(): Promise<SendResult>
```

> `DistillDialog` 现在**没有** `onAccept` / `existing` 这两个可选 prop 了：粘贴校验挂起后，弹层只做
> 「发送 + 复制 + 回显」，不产出卡。CCv3 格式定稿、校验接口重做时再把 `onAccept(card)` 加回来
> （届时 `index.tsx` 才需要 §6.3b 的 `distillDraft`）。

**另外四个是给 Lead 省事 / 调试用的附加件**（不用也可以）：

| 导出 | 用途 |
|---|---|
| `DistillButton({ t, label? })` | **自带弹层的按钮**：面板角色簿头部一行接完，`index.tsx` 不需要 `dialog === 'distill'` 分支 |
| `DockEntry({ t })` | 输入框上方的可见小入口（**只填入、不发送**：用户人就在输入框旁，自己按回车最安全） |
| `useComposerReady()` | `composerReady()` 的订阅版，供面板重渲染时感知 dock 到位 |
| `composerSessionId()` | 当前 sink 绑定的会话 id（空串 = 没绑定），多会话场景做提示用 |

`SendResult`（**两处相对约定的必要扩展**，只读 `ok`/`mode` 的调用方不受影响）：

```ts
export type SendResult =
  | { ok: true; mode: 'sent' | 'filled'; instruction: string; note?: 'busy' | 'no-submit' }
  | { ok: false; reason: 'no-dock' | 'flow-failed' | 'insert-failed' | 'submit-failed'; instruction: string; error?: string }
```

- 失败原因多了 `flow-failed`（读不到 flow.md）；`error` 是原始错误文案。
- `filled` + `note:'busy'` = 会话正在生成，**只填不发**（宿主对该 phase 的 submit 是静默 no-op，装作发出去了就是骗人——依据见 §12.3）。

**发送实现（`sendDistillInstruction`）的五步**，每一步都可独立失败：

```
① GET /distill/flow → instruction（失败 → flow-failed，带 error）
② typeof actions.insertText === 'function'（否则 → no-dock）
③ captureInsertion() 拿 span → insertText(instruction, span) === true
     ├ 给了 span 仍 false → 再试一次不带 span
     └ 抛错 / 仍 false → insert-failed
④ useInput 快照的 phase 已知且 !== 'plain' → 返回 filled + busy（不 submit）
⑤ typeof actions.submit === 'function'
     ├ 没有 → filled + no-submit
     ├ 抛错 → submit-failed（指令已在输入框里）
     └ 成功 → sent
```

> ③→⑤ 之间**不 await 任何东西**：`submit()` 提交的是 `projection.clipboardText`，同一 tick 里紧跟插入才可靠（实测契约）。
> 全部 `inputActions` 方法都用 `.call(sinkActions, …)` 调，保证 `this` 绑回原对象。

### 6.3a 给 Lead 的 `client/entry.tsx` 注册（v2 新增，**必须先做**）

`sidebar.footer.action` 这个席位拿不到会话级能力，所以 `DockSink` 必须挂到 `conversation.composer.dock`（kind=list / scope=session）上转一手。

```tsx
// entry.tsx 顶部 import
import { DockEntry, DockSink, sendDistillInstruction } from './distill.js'

// apply() 里、现有 sidebar.footer.action 注册之后追加
ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
  name: 'conversation.composer.dock',
  id: `${NS}:distill`,          // 与侧栏席位同一命名空间，但必须不同的 id
  locale: NS,
  order: 20,
}, DockSink))
```

要点：

- **`DockSink` 要一直挂在 dock 上**（它只返回 `null`，不占视觉空间）；一旦用户切到没有输入框的界面，slot 卸载 → sink 自动清空 → 面板按钮自己变回「复制指令」。所以**不要在面板里缓存 `inputActions`**。
- 想再加「输入框上方的小入口」，用**第二个 id** 注册 `DockEntry`（`id: `${NS}:distill-entry``）；它只填入不发送，见 §12.3。
- `sendDistillInstruction` 是面板侧用的，entry 不需要它，除非你想在别处也触发一次发送。
- 插槽未声明时 `slots.register` 会抛 `slot "conversation.composer.dock" is not declared`（DEVELOPMENT.md 坑 4）——**必须**走 `ctx.slots.inject(...)`，不能裸 `register`。

### 6.3b ⏸（随 CCv3 挂起）给 Lead 的 `client/index.tsx` 改动提案

> 因为 `DistillDialog` 现在不产出卡，`index.tsx` **暂时什么都不用改**：把 `<DistillButton t={t} />`
> 放进角色簿头部就行（它自带弹层）。下面三段是「CCv3 定稿、弹层重新交出 card 之后」才需要的改动，
> 先留档（P2 草稿状态 / P6 编辑器换源 / P7 保存新卡）。

> v2 里 `DistillButton` 自带弹层，所以**不再需要** `dialog` 联合类型里的 `'distill'`、也不需要 P8（弹层挂载）。P2（草稿状态）、P6（编辑器换源）、P7（保存新卡）仍然必需——因为「编辑一张还没存进磁盘的卡」这件事，只能由状态宿主 `index.tsx` 表达。

**P2｜⏸（定稿后才要）新增一个状态** — 插在 `:928`（`editError` 声明）之后

```tsx
  // 蒸馏：进编辑器二次确认前的蒸馏卡（用户点保存前不落盘）
  const [distillDraft, setDistillDraft] = useState<Card | undefined>(undefined)
```

**P3｜import** — 两处

```tsx
// :33（import { CardEditor } from './card-editor'）之后
import { DistillButton } from './distill'

// :34-42 的类型导入块里加一行（Card 已在，无需另加）
//   —— 若 P6 用到 DistillParseResult 就一并加，否则不加
```

**P4′｜主入口按钮（现在就能做）** — `:1422-1437` 那一行（`marginLeft:'auto'` 从「新建角色」挪到蒸馏按钮）

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
  <span className="awu-statLabel" style={{ fontFamily: 'var(--awu-mono)' }}>
    {t('roster.count', { n: roster.length })}
  </span>
  <div style={{ marginLeft: 'auto' }}>
    <DistillButton t={t} />          {/* 自带弹层；不产出卡，所以不需要 onAccept */}
  </div>
  <button type="button" className="awu-btn" data-size="sm" data-kind="primary" onClick={() => openDialog('new')}>
    <IconPlus size={12} />
    {t('roster.new')}
  </button>
</div>
```

> `DistillButton` 渲染的是 `.awu-btn[data-size=sm][data-kind=ghost]`，外层 `div` 只是承载 `marginLeft:auto`（组件本身不接受 style prop）。
> 空态（`:1441-1447`）想再放一个入口，同样一行 `<DistillButton t={t} />` 即可。

**P5′｜（⏸ 定稿后）P2 / P6 / P7 才需要**：等弹层重新交出 `card`，`index.tsx` 才需要 `distillDraft`
状态、编辑器换源、`onSaveCard` 支持新卡——见 §6.3-v1 里的 P2 / P6 / P7 原文（那三段与格式无关，逻辑仍有效）。

**P6｜⏸（定稿后才要）编辑器源切换** — `:1266-1276`（让 `CardEditor` 也能吃「还没保存的蒸馏卡」）

```tsx
{editing && (distillDraft ?? currentDetail?.card) !== undefined ? (
  <CardEditor
    card={(distillDraft ?? currentDetail?.card) as Card}
    name={distillDraft !== undefined ? String(distillDraft['name'] ?? '') : (currentDetail?.name ?? '')}
    source={sourceOf(distillDraft ?? currentDetail?.card)}
    busy={busy}
    error={editError}
    onCancel={() => { setEditing(false); if (distillDraft !== undefined) setDistillDraft(undefined) }}
    onSave={onSaveCard}
    t={t}
  />
) : (
```

**P7｜⏸（定稿后才要）`onSaveCard` 支持新卡** — `:1139-1161` 整体替换

```tsx
  const onSaveCard = (next: Card): void => {
    const distilled = distillDraft !== undefined
    const targetName = distilled ? String(next['name'] ?? '') : detailName
    if (targetName === '') return
    setBusy(true)
    setEditError('')
    void (async () => {
      try {
        await saveCharacter(targetName, next)
        const fresh = await fetchCharacter(targetName)   // 既有回读校验，不要删
        if (!aliveRef.current) return
        setDetail(fresh)
        setDetailName(targetName)                        // ← 新增：蒸馏卡保存后定位到它
        setDistillDraft(undefined)                       // ← 新增：草稿转正
        setEditing(false)
        setNotice(t('edit.saved'))
        await reload()
      } catch (error) {
        if (!aliveRef.current) return
        setEditError(errorText(error))
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }
```

---

### 6.3-v1（存档）给 Lead 的 `client/index.tsx` 改动提案（P1–P8，8 处）

> ⚠️ 本节是 v1 的写法（`dialog === 'distill'` + `DistillWorkspace` 受控组件）。**P1 / P3 / P4 / P5 / P8 已作废**（v2 用 `DistillButton` 替代）；P2 / P6 / P7 的**意图**仍然正确，但请按上面 §6.3b 的版本落地（`distillResult` / `distillError` 两个状态改由弹层内部持有）。

**P1｜弹层状态机加一项** — `:919`

```tsx
const [dialog, setDialog] = useState<'' | 'new' | 'distill' | 'delete' | 'mode' | 'editDiary' | 'forget' | 'resetAll'>('')
```

**P2｜新增三个状态** — 插在 `:928`（`editError` 声明）之后

```tsx
  // 蒸馏：工作台校验结果 + 进编辑器二次确认前的蒸馏卡（用户点保存前不落盘）
  const [distillResult, setDistillResult] = useState<DistillParseResult | undefined>(undefined)
  const [distillError, setDistillError] = useState('')
  const [distillDraft, setDistillDraft] = useState<Card | undefined>(undefined)
```

**P3｜import** — 三处，全部是纯追加

```tsx
// :15-32 的 api 值导入块，末尾（nextOpening 之后、`} from './api'` 之前）加两行
  parseDistillCard,

// :34-42 的类型导入块，末尾（RelationState 之后）加一行
  DistillParseResult,

// :33（`import { CardEditor } from './card-editor'`）之后加一行
import { DistillWorkspace } from './distill'
```

**P4｜主入口按钮** — `:1422-1437`（把 `marginLeft:'auto'` 从「新建角色」挪到「蒸馏」）

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
  <span className="awu-statLabel" style={{ fontFamily: 'var(--awu-mono)' }}>
    {t('roster.count', { n: roster.length })}
  </span>
  <button
    type="button"
    className="awu-btn"
    data-size="sm"
    data-kind="ghost"
    style={{ marginLeft: 'auto' }}
    title={t('distill.entryTitle')}
    onClick={() => { setDistillError(''); setDistillResult(undefined); openDialog('distill') }}
    disabled={busy}
  >
    <IconQuill size={12} />
    {t('distill.entry')}
  </button>
  <button
    type="button"
    className="awu-btn"
    data-size="sm"
    data-kind="primary"
    onClick={() => openDialog('new')}
  >
    <IconPlus size={12} />
    {t('roster.new')}
  </button>
</div>
```

> 注意：原 `:1431` 的 `style={{ marginLeft: 'auto' }}` 要**删掉**，否则两个按钮都会被推到右侧且中间出现空档。

**P5｜空态入口** — `:1442-1447` 的 `.awu-empty` 内，`awu-emptyHint` 之后追加

```tsx
<div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
  <button
    type="button"
    className="awu-btn"
    data-size="sm"
    data-kind="ghost"
    title={t('distill.entryTitle')}
    onClick={() => { setDistillError(''); setDistillResult(undefined); openDialog('distill') }}
    disabled={busy}
  >
    <IconQuill size={12} />
    {t('distill.entryEmpty')}
  </button>
</div>
```

**P6｜⏸（定稿后才要）编辑器源切换** — `:1266-1276`（让 `CardEditor` 也能吃「还没保存的蒸馏卡」）

```tsx
{editing && (distillDraft ?? currentDetail?.card) !== undefined ? (
  <CardEditor
    card={(distillDraft ?? currentDetail?.card) as Card}
    name={distillDraft !== undefined ? String(distillDraft['name'] ?? '') : (currentDetail?.name ?? '')}
    source={sourceOf(distillDraft ?? currentDetail?.card)}
    busy={busy}
    error={editError}
    onCancel={() => { setEditing(false); if (distillDraft !== undefined) setDistillDraft(undefined) }}
    onSave={onSaveCard}
    t={t}
  />
) : (
```

> `currentDetail` 的定义在 `:1196`（`detailName !== '' && detailName === detail?.name ? detail : undefined`），所以新卡场景下它是 `undefined`——这正是必须换源的原因。

**P7｜⏸（定稿后才要）`onSaveCard` 支持新卡** — `:1139-1161` 整体替换

```tsx
  const onSaveCard = (next: Card): void => {
    const distilled = distillDraft !== undefined
    const targetName = distilled ? String(next['name'] ?? '') : detailName
    if (targetName === '') return
    setBusy(true)
    setEditError('')
    void (async () => {
      try {
        await saveCharacter(targetName, next)
        const fresh = await fetchCharacter(targetName)   // 既有回读校验，不要删
        if (!aliveRef.current) return
        setDetail(fresh)
        setDetailName(targetName)                        // ← 新增：蒸馏卡保存后定位到它
        setDistillDraft(undefined)                       // ← 新增：草稿转正
        setEditing(false)
        setNotice(t('edit.saved'))
        await reload()
      } catch (error) {
        if (!aliveRef.current) return
        setEditError(errorText(error))
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }
```

**P8｜工作台弹层** — 插在 `:1594`（`dialog === 'new'` 那块的 `)}` 之后）

```tsx
{dialog === 'distill' && (
  <Overlay label={t('distill.title')} onClose={() => setDialog('')}>
    <DistillWorkspace
      t={t}
      busy={busy}
      error={distillError}
      result={distillResult}
      existing={list.map(item => item.name)}
      onValidate={raw => {
        setBusy(true)
        setDistillError('')
        parseDistillCard(raw)
          .then(result => { if (aliveRef.current) setDistillResult(result) })
          .catch((error: unknown) => { if (aliveRef.current) setDistillError(errorText(error)) })
          .finally(() => { if (aliveRef.current) setBusy(false) })
      }}
      onAccept={card => { setDistillDraft(card); setDialog(''); setEditing(true) }}
      onClose={() => setDialog('')}
    />
  </Overlay>
)}
```

行数预算：P1 0 / P2 +4 / P3 +3 / P4 +12 / P5 +11 / P6 +2 / P7 +3 / P8 +22 ≈ **+57 行**（含缩进与换行，净逻辑约 +28 行）。

> ⚠️ P8 的 `onAccept` 必须**同时** `setDialog('')` 与 `setEditing(true)`：编辑态与弹层区在 JSX 里是互斥分支（`index.tsx:1266` 的三元），编辑态一开弹层就整块不渲染了；若留着 `dialog='distill'` 不清，用户在编辑器里点「取消」后工作台会原地复活。

### 6.4 给 Lead 的 `client/text.ts` 提案

把 §4.5 的 28 个键按同序插入 `zh`（`:176` 的 `'edit.discard': '放弃改动',` 之前，保持「编辑器组」在最末更容易对照）与 `en`（`:342` 对应位置）。键名两侧必须**完全一致**（`Dict` 类型在 `:179` 用的是 `{ [K in keyof typeof zh]: string }`，漏一个键 `tsc` 会直接报错——这是免费的一致性检查）。

建议在 zh 侧插入点前加一行分节注释，与既有 `// ---- 角色卡编辑器 ----`（`:156`）风格一致：

```ts
  // ---- 从作品蒸馏角色卡 ----
```

### 6.5 给 Lead 的 `client/styles.ts` 提案（2 行）

```ts
// :17 附近（现有 import 区）加一行
import { DISTILL_CSS } from './distill.styles'
```

```ts
// :1878 之前（CSS 模板串末尾、闭合反引号之前）加一行
  ${DISTILL_CSS}
```

> ⚠️ **后缀写法**：契约 §二写的是 `'./distill.styles.js'`，但 `client/` 里现有 import **全部不带后缀**（`entry.tsx:8-9`、`index.tsx:33` / `:61`），因为浏览器侧由 esbuild 打包。`tsc`（`moduleResolution: 'bundler'`）两种写法都认，esbuild 对显式 `.js` 的解析与 tsc 不完全一致，所以**优先照客户端既有风格写无后缀**；若 Lead 按契约写成 `.js`，务必先跑 `npm run build:client` 确认能解析（这一步只验 bundling，不需要重启 DSH）。

### 6.6 `client/distill.styles.ts`（可直接抄）

```ts
/**
 * 从作品蒸馏角色卡 · 工作台样式
 *
 * 只允许用 --awu-* token（不写死色值），类名一律 awu-distill-*。
 * 由 client/styles.ts 的 CSS 模板串末尾拼接注入，不新增 <style> 标签。
 */
export const DISTILL_CSS = `
/* ---- distill 模块 ---- */
.awu-distill-why {
  margin: 0 0 10px;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--awu-ink-faint);
}

.awu-distill-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.awu-distill-steps li {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  font-size: 11.5px;
  line-height: 17px;
  color: var(--awu-ink-mute);
}
.awu-distill-num {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border: 1px solid var(--awu-line-strong);
  border-radius: 50%;
  font-family: var(--awu-mono);
  font-size: 9.5px;
  color: var(--awu-gold);
}

.awu-distill-paste {
  width: 100%;
  min-height: 104px;
  max-height: 180px;
  box-sizing: border-box;
  padding: 8px 11px;
  resize: vertical;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
  color: var(--awu-ink);
  font-family: var(--awu-mono);
  font-size: 11px;
  line-height: 16px;
  outline: none;
}
.awu-distill-paste:focus { border-color: var(--awu-gold); }
.awu-distill-paste::placeholder {
  font-family: var(--awu-sans);
  font-size: 11.5px;
  color: var(--awu-ink-faint);
}

.awu-distill-meter {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 10px 0 6px;
  font-family: var(--awu-mono);
  font-size: 10px;
  color: var(--awu-ink-dim);
}
.awu-distill-bar {
  flex: 1 1 auto;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--awu-surface-3);
}
.awu-distill-bar span {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--awu-grad);
  transition: width .26s var(--awu-ease);
}

.awu-distill-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0 8px;
}
.awu-distill-tag {
  padding: 1px 6px;
  border: 1px solid var(--awu-line);
  border-radius: 999px;
  font-size: 9.5px;
  color: var(--awu-ink-mute);
}
.awu-distill-tag[data-missing] {
  border-color: rgba(226, 121, 107, .4);
  color: var(--awu-danger);
}

.awu-distill-warn {
  margin: 6px 0 0;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--awu-ink-mute);
}
.awu-distill-warn[data-tone="danger"] { color: var(--awu-danger); }

.awu-distill-nameRow {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
`
```

（唯一写进 `rgba()` 的是缺失徽标的描边——因为 `--awu-danger` 没有 alpha 变体 token；这是既有 CSS 里也存在的做法，如 `styles.ts:1200` 的 `rgba(233,189,114,.3)`。若 Lead 要求零写死色值，把该行改成 `border-color: var(--awu-line-strong)` + `color: var(--awu-danger)`。）

### 6.7 `client/api.ts` 追加（v2 实际，已写入）

```ts
// ROUTES 里（`forget` 之前）加两行
  distillFlow: '/distill/flow',
  distillParse: '/distill/parse',

// 类型区（`OpeningResult` 之后）加两个 interface
export interface DistillFlowInfo {
  ok: true
  path: string          // flow.md 绝对路径
  instruction: string   // 要发进会话的那段话
  chars: number         // instruction.length
  flowChars: number     // flow.md 字符数
}

export interface DistillParseResult {
  ok: true
  name: string
  card: Card
  stats: { filled: number; total: number }
  missingGroups: string[]
  missingFields: string[]
  warnings: string[]
  conflict?: { exists: boolean; name: string; source: string }
}

// 动作函数（`deleteCharacter` 之后）加两个
export function fetchDistillFlow(): Promise<DistillFlowInfo> {
  return request<DistillFlowInfo>(ROUTES.distillFlow)
}

export function parseDistillCard(raw: string): Promise<DistillParseResult> {
  return post<DistillParseResult>(ROUTES.distillParse, { raw })
}
```

> `request()` 会把 404/501 且**响应体不是 JSON 信封**的情况判成 `ApiUnavailableError`（`:59-98`，task-1 已修）——所以旧宿主没这两条路由时，面板会得到「宿主侧尚未提供该能力」而不是怪异报错。

---

## 7. 失败与中断矩阵

| 场景 | 会看到什么 | 处理 | 是否落盘 |
|---|---|---|---|
| 模型缺字段（只给了 3 组） | `stats 12/34` + `missingGroups:['world','relationship',…]` | **不阻断**。面板灰字提示「不影响保存，可在编辑器补全」，用户可直接进编辑器 | 否 |
| 模型答错/跑偏（输出的不是卡） | `400 这段文本里没有 JSON 对象…` 或 `JSON 解析失败（第 N 个字符）：…` | 面板保留原输入不丢；提供「重新粘一段」——用户回到对话说「请只输出一个 json 代码块」即可 | 否 |
| JSON 语法错（尾逗号/全角引号） | 同上，带字符位置 | **不做自动修复**。猜着修会把错的卡写进盘，宁可让用户重来一次 | 否 |
| 模型给了 `items`/英文键名 | `warnings:['未识别的顶层键：basic_info']` + 对应分组为 `missing` | 用户能看到哪里错了；`flow.md` 的「交卡前自检」会提前拦住这类错误（附录 A 已迁入该文件） | 否 |
| list 字段写成一句话 | V4 自动按顿号/分号/逗号拆分并给提醒 | 面板可正常显示条目；用户能在编辑器里逐条改 | 否 |
| 用户中途关面板 / 弹层 | 对话里的进度**不丢**（那是 DSH 会话的事）；弹层里已粘的 JSON 会丢 | 重开弹层重新粘一次即可（模型输出还在会话历史里）。v2 不做 localStorage 续航：弹层短、JSON 就在聊天记录里 | 否 |
| **点发送时会话正在生成** | `insertText` 可能返回 false → `insert-failed`（提示「可能正在生成，先复制，等一下再发」）；若已插进去但 `phase !== 'plain'` → `filled + busy`（**不发**，避免替用户插进正在跑的回合） | 见 §12.3 | 否 |
| **覆盖宿主没有 `submit`** | `filled + no-submit`：「已填入输入框，按回车发送」——这是**正常路径**，不是错误 | 见 §12.3 | 否 |
| **dock 还没就绪**（没开会话 / 会话切换中） | `composerReady() === false` → 发送按钮置灰并显示 `distill.noDock`，只剩「复制指令」 | 用户先去打开一个对话，或直接复制 | 否 |
| **卡片 JSON 过大**（把整本书粘进输入框） | 前端 `new Blob([raw]).size > 1 MB`（`DISTILL_MAX_PASTE_BYTES = 1024*1024`）→ 本地报 `distill.tooLarge` 并**不发请求**；服务端 `raw > 1 MB` 同阈值兜底 | 提示「只需要粘角色卡那一段」 | 否 |
| **作品正文超长** | 不进本插件任何 HTTP（它走 DSH 会话本身，受宿主上下文限制） | 面板开场指令里提示「可以只给作品名，但要接受记忆偏差；章节长文请分段贴」 | 否 |
| 与已有角色重名 | `conflict:{exists:true,name,source}` + 输入框下方红字 | 「改个名字」（本地查重 `existing`）或直接「进编辑器确认」= 覆盖既有卡（**保留其日记与 session**，因为 `writeCard` 只写 `card.json`） | 覆盖时才会 |
| 名字非法（含 `/` `\` 或 `.` `..`） | `distill.nameInvalid` | 前端拦一次（不发请求），服务端 V2 再拦一次 | 否 |
| 保存失败（磁盘权限等） | `CardEditor` 顶部 `awu-err`（`card-editor.tsx:290-294`） | 卡还在编辑器里，用户可重试；`guard` 把异常压成 400 文案 | 否 |
| **读不到 `distill/flow.md`**（插件安装不完整） | `distill.flowFailed` + 后端给的完整路径与原因 | 面板仍可「复制指令」但指令里没有路径；提示用户重装/检查包 | — |
| 用户只给了作品名 | `flow.md` 阶段 1 要求模型**主动声明**记忆偏差后再继续 | 由模型执行（铁律 4） | — |

**统一原则**：失败一律**保留用户的输入**，绝不因为一次解析失败清空输入框。

---

## 8. ⏸（挂起）交接：蒸馏产物 → `CardEditor` 二次确认

> 校验与交接随 CCv3 换血挂起。**§8.2 的四个 `mergeCard` 坑与格式无关，定稿后照样要遵守**；
> §8.1 的数据流里「粘贴 → `/distill/parse`」那一段等新校验接口重接。

### 8.1 数据流

```
（前置）panel 点「发送」→ GET /distill/flow → insertText + submit → 会话收到一条指令
        → 模型读 flow.md → 5 阶段追问 → 输出一个 json 代码块
模型输出 → 用户粘贴回弹层 → POST /distill/parse
  → locateCardJson(raw)           剥 ```json 围栏 / 平衡花括号扫描
  → JSON.parse                   失败即 400（带行/列）
  → normalizeDistillCard          V1–V13，产出「只有非空字段」的卡 + source:'distill'
  → store.readCard(name)          查重名 → conflict（只读，不写盘）
  → 响应 {card, stats, missingGroups, missingFields, warnings, conflict}
        ↓ 弹层内部 setResult(...)（v2 里这些状态不上面板）
        ↓ 用户点「进编辑器确认」→ onAccept(card) → index.tsx: setDistillDraft(card); setEditing(true)
        ↓ index.tsx:1266 分支渲染 <CardEditor card={distillDraft} name={…} source={…}>
        ↓ 用户点保存 → CardEditor.save(): mergeCard(card, draft)   (card-editor.tsx:250-253)
        ↓ onSaveCard → saveCharacter(name, merged) → POST /character/save → store.writeCard
                                                 → writeCard 强制 name + touchIndex（索引一致）
        ↓ onSaveCard 回读校验：fetchCharacter(name) → setDetail → 关闭编辑器 → reload()
```

### 8.2 `mergeCard` 的四个坑（实现时必须逐条对齐）

**坑 1｜删空组（`card-schema.ts:283-285`）——对蒸馏卡无害，但别主动喂空组**

```ts
if (Object.keys(next).length === 0) delete base[rootKey]
```

已知事故（`docs/DEVELOPMENT.md:446`、`06-tmp\aiwu-survey\client.md` R4）：`draftCard` 造的新卡带 `personality:{} / relationship:{} / voice:{}`，用户动一个字段保存就被静默删掉三个组。**对蒸馏卡这个行为是安全的**——V11 保证 `/distill/parse` 只产出非空字段，所以不存在「原本存在但空」的组被删。

> ⚠️ 给实现者的红线：**不要在 `onAccept` 里把缺的组补成 `{}` 再交给编辑器**。那会人为制造「原本存在但空」，用户一保存就被删；而 `writeCard` 不校验字段（`store.ts:287-292`），磁盘上不会报任何错。

**坑 2｜`name` / `source` 不可编辑（`card-schema.ts:288-290`）**

```ts
if (card?.name !== undefined) base['name'] = card.name
if (card?.['source'] !== undefined) base['source'] = card['source']
```

所以：**名字必须在工作台定死**（§4.4 态 C 的输入框），进了编辑器就只能改字段。`source` 由 V9 注入 `'distill'`，编辑器保存后会一直带着它。

**坑 3｜`asText` 会把数组拼成 `、`（`card-schema.ts:207-212`）**

若 `list` 字段被模型写成字符串又被漏过 V4，`toDraft` 的 `asList`（`:200-204`）会把它包成**单元素数组**，用户看到一条长条目。V4 的「按 `、；;,\n` 拆分」就是为这条兜底。

**坑 4｜未知键保留（`card-schema.ts:246` 的 `{...(card ?? {})}`）**

模型的额外顶层键（如 `meta` / `source_work`）会原样写进 `card.json`。这是**有意为之**（项目约定不洗未知键），只在 `warnings` 里提示。`renderCharacterCard`（`src/prompt.ts:93-123`）只渲染 9 个已知组，所以未知键不会污染 L1 提示词。

### 8.3 交接后的可见结果

保存成功后：`setDetailName(targetName)`（P7）→ 角色簿里出现新卡、`last_active` 被 `touchIndex` 刷成现在（`store.ts:291`，**已知的伪活跃问题**，`06-tmp\aiwu-survey\host.md:418` 已记录，本功能不修）→ `/overview` 的 `bySource` 里多一个 `distill` 来源。

---

## 9. 实现顺序与验收

> 顺序原则：**先做能独立验证的纯函数，再接需要重启的宿主，最后才是 UI**。宿主侧（`src/**`）改动**必须重启 DSH 桌面版**才生效（`docs/DEVELOPMENT.md:386-389`、`docs/design/2026-10-30-integration-contract.md:91`）；浏览器侧改完 `npm run build` 后刷新页面即可。

**v2 实际进度（2026-10-30 22:10，34 字段线已挂起）**

| 步骤 | 内容 | 状态 |
|---|---|---|
| 1 | `distill/flow.md`（阶段骨架）+ `src/distill.ts`（读 md + 生成指令） | ✅ 已写；字段契约/输出格式留 `<!-- 待 tavern 格式定稿填充 -->` |
| 2 | `src/web.ts` **1 条**路由 `GET /distill/flow` | ✅ 已写；`POST /distill/parse` 已摘除（等 CCv3） |
| 3 | `client/api.ts` + `client/distill.tsx`（发送通道） + `client/distill.styles.ts` | ✅ 已写；`npm run build` 三套自检全绿（92 + 14 项，路由 17 条） |
| 4 | Lead 接线（`entry.tsx` dock 注册 + `index.tsx` 的 `<DistillButton>` + `text.ts` 23 键 + `styles.ts` 2 行） | ⏳ 待 Lead |
| 5 | 重启 DSH + 发送链手验（`/distill/flow` 200、点发送后会话里出现指令） | ⏳ 待重启后 |
| 6 | ⏸ CCv3 定稿后：新校验 + `/distill/parse` + 粘贴回填 + `CardEditor` 交接 | 挂起 |

### 9.1 Step 1 · `src/distill.ts`（可完全独立验证，不需要重启）

产出：流程定位/读取、指令生成、34 字段契约、`locateCardJson` / `normalizeDistillCard` / `parseDistillCard`（v1 的 `createDistillTools` **已删除**）。

```powershell
npm run build:host
@'
import { distillFlowInfo, locateCardJson, normalizeDistillCard, parseDistillCard } from './lib/distill.js'

const flow = await distillFlowInfo()
console.log('[flow] path =', flow.path)
console.log('[flow] flowChars =', flow.flowChars, '| instruction chars =', flow.chars)
console.log('[flow] instruction 含绝对路径 =', flow.instruction.includes(flow.path))

const r = normalizeDistillCard({
  name: '测试',
  basic: { '姓名': '测试', '身份': '编辑' },
  voice: { '爱用句式': '我跟你说、真的' },
  openings: ['a','b','c','d','e','f','g','h','i'],
  meta: { from: 'demo' },
})
console.log('[正路径]', JSON.stringify({
  total: r.stats.total,
  filled: r.stats.filled,
  groups: r.missingGroups,
  warn: r.warnings,
  phrases: r.card.voice?.['爱用句式'],      // 必须是 2 元素数组
  openings: r.card.openings?.length,        // 必须是 8
  source: r.card.source,                    // 必须是 'distill'
  basicKeys: Object.keys(r.card.basic ?? {}),
}, null, 2))

const fake = { readCard: async () => undefined }
for (const bad of ['```json\n{oops}\n```', 'hello', '{"basic":{}}', '{"name":"a/b"}']) {
  try {
    await parseDistillCard(fake, bad)
    console.log('[负路径] UNEXPECTED OK:', JSON.stringify(bad))
  } catch (error) {
    console.log('[负路径] ok-reject:', error.message)
  }
}
'@ | Set-Content -Encoding utf8 .\tmp-distill-check.mjs
node .\tmp-distill-check.mjs
Remove-Item .\tmp-distill-check.mjs
```

通过判据：`total === 34`；`phrases` 是 **2 元素数组**（V4 把「、」拆开）；`openings === 8`（V6 截断）；`source === 'distill'`（V9）；`basicKeys` 里没有空字符串键（V11）；`warn` 含「未识别的顶层键：meta」（V8）。

负路径四条必须全部 `ok-reject` 且文案是中文人话，**不允许**出现 `Unexpected token` 这种裸英文——`locateCardJson` / `JSON.parse` 的错都要包一层中文。

### 9.2 Step 2 · 宿主接线（`src/web.ts` + `src/index.ts`）—— **必须重启 DSH**

```powershell
npm run build:host
# 重启 DSH 桌面版（宿主不热加载 lib/index.js）
```

重启后验活与工具：

```powershell
Invoke-WebRequest http://127.0.0.1:59609/_dsh/ai-with-u/overview -UseBasicParsing | Select-Object -ExpandProperty StatusCode
# 期望 200；插件日志里应出现「已挂载 awu_distill_guide（常驻，与启用态无关）」
```

验路由（正/负各一次）：

```powershell
$card = @{ name = '蒸馏测试'; basic = @{ 姓名 = '蒸馏测试'; 身份 = '编辑' }; voice = @{ 爱用句式 = @('我跟你说','真的') }; source = 'custom' } | ConvertTo-Json -Depth 8 -Compress
$payload = @{ raw = ('```json' + "`n" + $card + "`n" + '```') } | ConvertTo-Json
$bytes = [Text.Encoding]::UTF8.GetBytes($payload)
Invoke-WebRequest -Uri http://127.0.0.1:59609/_dsh/ai-with-u/distill/parse -Method POST -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing | Select-Object -ExpandProperty Content
# 期望：{"ok":true,"name":"蒸馏测试","stats":{"filled":2,"total":34},...,"conflict":{...}（若已存在同名卡）}

Invoke-WebRequest -Uri http://127.0.0.1:59609/_dsh/ai-with-u/distill/parse -Method POST -ContentType 'application/json' -Body '{"raw":"不是 json"}' -UseBasicParsing -SkipHttpErrorCheck | Select-Object StatusCode, Content
# 期望：StatusCode 400 + {"ok":false,"error":"这段文本里没有 JSON 对象；请只粘模型最后那段代码块"}
```

验工具（**关键**：在**没有启用任何角色**的会话里）：

> 在 DSH 里说「列出你可用的 awu_ 工具」，或直接说「蒸馏角色」。
> 期望：`awu_distill_guide` 在清单里；调用后返回 `guideVersion/guideText/fieldContract`。**这是本次唯一必须重启才能看到的行为变化**。

### 9.3 Step 3 · 前端新文件（`client/api.ts` + `client/distill.tsx` + `client/distill.styles.ts`）

```powershell
npm run typecheck:client   # 必须 0 error
```

此步**只能验类型与打包**：组件还没被 `index.tsx` 引用，`api.ts` 的新函数也没人调用，esbuild 的 tree-shaking 会把它们摇掉，所以 `lib/client.js` 体积基本不变是正常的。真正的 UI 验证要等 Step 4。

### 9.4 Step 4 · Lead 合并三件套 → 全链路手验

```powershell
npm run build    # tsc(宿主) + tsc(前端) + esbuild + verify + verify:session + verify:host
```

手验清单（8 条，缺一不可）：

1. 角色簿头部出现「蒸馏」，点开是工作台，不是直接发请求。
2. 点「复制开场指令」→ 剪贴板里是 §6.2 那段文字，含 10 个中文组名。
3. 把这段指令贴进对话 → 模型**调用 `awu_distill_guide`**（而不是凭空开讲）。
4. 走完对话 → 得到 ```json 代码块 → 粘回工作台 → 点校验 → 进度条与缺组正确。
5. 重名时出现红字与改名输入；改成新名字后 `existing` 不再报冲突。
6. 「进编辑器确认」→ 10 组表单**预填正确**（尤其 `voice` 的 3 个 list 字段是逐条而非一条）、头部 `31/34`。
7. 编辑器里点保存 → 角色簿出现新卡 → 详情页正常 → `/overview` 的 `bySource` 出现 `distill`。
8. **回归**：16 条老路由仍 200；启用/退出后 8 个老 `awu_*` 工具仍按启用态挂载/卸下（日志里「已挂载 8 个 awu_* 工具」/「已卸下 awu_* 工具」照旧）。

### 9.5 建议追加的自检项（需 Lead 同意，`scripts/` 不在本设计范围内）

`scripts/verify.mjs`（当前 87 行）加 1 项：正则抽 `client/card-schema.ts` 的 `key: '…'` 集合与 `src/distill.ts` 的 `key: '…'` 集合，做双向差集，**必须都是空**。理由：字段契约是手工镜像（§5.1），没有机器检查迟早漂移——`store.ts:30-33` 的 `FULL_FIELDS` 就是这么落后 4 个字段的。若 Lead 不采纳，本条改为**发版前手工**跑一次：

```powershell
@'
import { readFileSync } from 'node:fs'

const keys = (file) => new Set([...readFileSync(file, 'utf8').matchAll(/key:\s*'([^']+)'/g)].map(m => m[1]))
const schema = keys('client/card-schema.ts')
const distill = keys('src/distill.ts')
console.log('只在 schema:', [...schema].filter(k => !distill.has(k)))
console.log('只在 distill:', [...distill].filter(k => !schema.has(k)))
console.log('两边都是空 = 契约一致')
'@ | Set-Content -Encoding utf8 .\tmp-contract-check.mjs
node .\tmp-contract-check.mjs
Remove-Item .\tmp-contract-check.mjs
```

> 注意 `src/distill.ts` 里不能出现别的 `key: '…'` 字面量（例如测试数据），否则会污染比对结果。

---

## 10. 明确不做（v1 范围边界）

| 不做 | 理由 |
|---|---|
| `GET /distill/state` | §5.3：面板无法观测对话，做了只能显示自己刚写的数据；进度用 `/distill/parse` 的 `stats` 表达 |
| 作品正文暂存 / 上传（`POST /distill/source`） | 正文走 DSH 会话即可；暂存会新增磁盘状态、清理责任与 4 MB 上限问题（§7 已给超长处理方案） |
| `awu_character_save` 之类「模型直接写卡」的工具 | 会绕过用户二次确认，与「建卡是确定性操作，留给面板」（`src/tools.ts:5-6`）的定位冲突 |
| 六 Phase 面板向导 | §2.2 |
| Phase 进度条 / `running` 状态 | §3.1（不伪造进度） |
| 自动修复坏 JSON（尾逗号、全角引号） | 猜着修会把错的卡写进盘 |
| 改 `src/prompt.ts`（L0/L1） | 本功能对注入层**零改动**；`opening`/`openings` 仍走既有的 `/opening/state` 与 `rotateOpening` |
| 改 `client/card-schema.ts` | `GROUPS` 已就绪，只读 |
| 修「写盘无互斥」「`writeCard` 刷 `last_active`」等既有缺陷 | 全项目级问题（`docs/DEVELOPMENT.md:439-447`），不在本功能内单独打补丁 |
| 新增任何依赖 | 硬约束。复制用 `navigator.clipboard`（不可用时兜底选中文案 + `document.execCommand('copy')` 失败就走手动选中提示） |

---

## 11. 风险与预案

### 11.1 ❌ 已作废（v1 的「最可能被拍回的一点」：`awu_distill_guide` 常驻挂载）

> 主人直接把整条路线推翻了：**不做工具**，所以「常驻挂载 vs 插拔语义」这个矛盾在 v2 里根本不存在。
> 结论：`docs/DEVELOPMENT.md:53` 的「同进同出」原样有效，v2 没有破坏它。
> 下面留档，供以后真要加常驻工具时参考。

`docs/DEVELOPMENT.md:53` 与 README 都把「`awu_*` 工具与角色同进同出、退出即干净拔出」当成卖点。本工具**必须常驻**（否则在最需要它的「还没有角色」场景里消失），代价是每个会话的工具清单多一条（≈300–400 token）。

- **备用方案 A（若主人坚持插拔纯正）**：把蒸馏改成「先启用任意一张卡再做」——体验不可接受，等于把功能藏起来。
- **备用方案 B**：改成「面板点过蒸馏后，向 `_active.json` 写一个 `distillArmed: true` 标志，工具按它挂载，48 小时后自动过期」——状态机变复杂、跨重启语义模糊、还会让 `_active.json` 承担第二职责，**不推荐**。
- **结论**：常驻是正确的取舍，但这是需要主人点头的**语义变更**，不是实现细节。

### 11.2 其他风险

| 风险 | 影响 | 预案 |
|---|---|---|
| 模型不肯调工具，直接凭记忆出卡 | 拿到一张「通用」的卡 | 开场指令第一句就是「先调用 awu_distill_guide」；`assemble` 阶段的自检清单会要求逐组对照 |
| 模型输出在聊天里被 markdown 渲染破坏（如把 `` ``` `` 吃掉） | 用户复制到的不是纯文本 | `/distill/parse` 允许裸 JSON；`locateCardJson` 用「平衡花括号扫描」而不是只认围栏 |
| 34 字段契约与 `GROUPS` 漂移 | 校验器与编辑器口径不一致 | §9.5 的自检项 / 发版前手工比对 |
| 用户把 `openings` 当"更多剧情"狂写 | 卡变胖、L1 提示词变长 | V6 截断到 8 条 + warning |
| `localStorage` 被禁用（隐私模式） | 草稿不能续航 | 所有 `localStorage` 访问包 `try/catch`，失败后功能照常（只是不续航），不抛错 |
| 452px 面板里塞下进度条 + 10 个分组徽标 | 拥挤 | 分组徽标用 `flex-wrap` 两行内解决（§4.4 态 B 草图已按两行排版） |

### 11.3 未来可无损升级

若 DSH 将来暴露「把一条消息注入当前会话并取回结果」的能力，`DistillWorkspace` 的第一屏可以原地升级成：点「开始蒸馏」→ 自动发送同一条开场指令 → 后端写 `_distill/progress.json` → 工作台实时显示阶段。**届时要加的只有「自动发送」与「进度读取」两件，其余（字段契约、校验、交接、编辑器）一行都不用改。** 这也是选 c′ 而不是 b 的长期价值：c′ 的每一块都能独立升级，b 的六屏向导是沉没成本。

---

## 12. v2 与 v1 的差异与原因

### 12.1 为什么推翻「做成工具」

v1 的论证重心是「工具是 L2 长文档的天然出口」，并且我认定 `awu_distill_guide` **必须常驻挂载**（否则在最需要它的「还没有角色」场景缺席）。这个方案技术上自洽，但它换来了两笔真实成本：

1. **破坏既有语义**：`docs/DEVELOPMENT.md:53` 的「`awu_*` 与角色同进同出」是这套插件的卖点之一，为一个功能破例，以后每个新功能都会来问「为什么它可以常驻」。
2. **每个会话都多一条工具**：不管用户这次要不要蒸馏，工具清单里都躺着一条 300–400 token 的描述。

v2 把「长文档」从**工具返回值**换成**磁盘文件**，代价是多一个 `distill/` 目录和一个随包发布的 md，收益是：

- 不新增工具、不改 `src/index.ts`、不碰插拔语义；
- 流程文档**可以被人直接读、直接改**（`distill/flow.md` 就是一份普通 markdown，用户想加自己的口味直接编辑即可——这在「工具返回值」形态下做不到）；
- 指令只有 `289` 字符，模型第一步只是 `read` 一个文件；即便宿主裁剪了 `tools` 服务，这条路依然能跑（不依赖任何 `awu_*` 工具）。

**复盘**：v1 我漏掉的是「DSH 插槽已经能拿到输入框控制权」这个前提。既然能直接把话递进会话，就不该为了递话而去动工具面。

### 12.2 差异对照

| 维度 | v1（已废弃） | v2（已实施） |
|---|---|---|
| 长文档载体 | `src/distill.ts` 里的 `DISTILL_GUIDE_TEXT` 常量，经 `awu_distill_guide` 返回 | `distill/flow.md` 文件，模型自己 `read` |
| 触发方式 | 模型在对话里「想起」有这个工具 | 面板点「发送」，一条指令直接进会话并提交 |
| 工具面 | 新增第 9 个工具、**常驻挂载** | **零新增**，`src/tools.ts` / `src/index.ts` 不动 |
| 用户动作 | 复制指令 → 粘进对话 → 回车 | 点「发送」（已自动填入并提交）；或点 dock 小入口 → 回车 |
| 路由 | 1 条（`/distill/parse`） | 2 条（`+ /distill/flow`） |
| 客户端 | 受控组件 `DistillWorkspace`（fetch 归面板） | 自带弹层的 `DistillButton` + 无头 `DockSink`（组件内部 fetch，例外原因见 §12.3） |
| 进度回显 | 「粘回来后 N/34」 | 同左（**仍然不伪造 Phase 进度**） |
| 复用不变 | 34 字段契约、V1–V13 校验、`/distill/parse`、`mergeCard` 四坑、不落盘原则 | 只剩最后两项：**34 字段契约与 `/distill/parse` 已被 CCv3 换血取代**（⏸ 挂起，见文首横幅）；`mergeCard` 四坑与不落盘原则照旧 |

### 12.3 三个技术判断的依据

1. **`insertText` 必须判 `=== true`**。宿主在「草稿版本变化 / adjudicating / submitting / 已卸载」时返回 `false`（实测契约）。把它当 `void` 用，界面就会说「已发送」而输入框里什么都没有——这是本功能最容易骗人的一处。
2. **`submit()` 必须 `typeof === 'function'` 防御**。它**不在官方插件文档里**（只文档化了 `captureInsertion` / `insertText`），属实测可用未承诺。缺失时降级成「已填入，按回车」——这**不是错误路径**，是正常降级。
3. **dock 小入口只填不发**。已安装的 `dsh-story` 有一模一样的取舍（v0.12.0：自动发送默认关），它的理由同样适用于我们：宿主的 `SubmitMachine` 对 `adjudicating` / `submitting` 是**静默 `return []`**——提交等于什么都没发生。用户此刻就在输入框旁边，按回车是一秒的事；替他点一下，反而可能把指令塞进一个正在跑的回合。

> 另外：`DistillDialog` **自己 fetch**（`fetchDistillFlow` / `parseDistillCard`），偏离了集成契约 §四「新组件不要自己 fetch」。理由是这个弹层要能被 `DistillButton` 一行接进面板，而它需要的数据与动作全部属于自己（没有别的组件会复用）——把 9 个 props 摊给 `index.tsx` 只会让状态宿主更胖。**这是有意的例外，已在此备案。**

### 12.4 失败矩阵的 v2 增补

见 §7 里新增的四行：会话正在生成时的 `insert-failed` / `filled+busy`、宿主没有 `submit`、dock 未就绪、读不到 `flow.md`。共同原则不变：**如实报状态，绝不假装发成功；失败一律把指令原文留在弹层里可复制。**

### 12.5 一个顺手发现的样式坑（给 Lead / ui-designer）

弹层都走 `createPortal(..., document.body)`（`index.tsx:130-162` 的 `Overlay`，以及本文件的 `DistillDialog`），而 `--awu-*` 变量只定义在 `.awu-scope` / `.awu-layer` 两个作用域上（`client/styles.ts:36-37`）——**portal 出去的 `.awu-scrim` / `.awu-dialog` 并不在这两个作用域里**，所以它们内部的 `var(--awu-*)` 全是无效声明：

- `.awu-scrim` 的 `z-index: var(--awu-z-scrim)`、`animation: awu-fade var(--awu-dur-2)`（`styles.ts:1780`、`:1787`）；
- `.awu-dialog` 的 `width: min(var(--awu-dialog-w), 100%)`、`border-radius: var(--awu-r-lg)`、`border: 1px solid var(--awu-line-strong)`（`styles.ts:1791-1795`）。

这些属性会退化成 `auto` / `0` / 无描边，只是**恰好**看起来还行（底色是字面 rgba、文字靠继承）。既有 6 个弹层都受影响。

**建议的一行修法**（`client/styles.ts:36`，ui-designer/Lead 决定）：
```css
.awu-scope, .awu-layer, .awu-scrim, .awu-dialog { …原有的全部 token 定义… }
```
我自己的 `client/distill.styles.ts` 不依赖这次修复：每个 token 都写成 `var(--x, 回退值)`，并且宽度/圆角/最大高度在 `.awu-distill-dialog` 上显式兜了一遍。修好之后回退值自然失效，样式保持一致。

---

## 附录 A：~~`DISTILL_GUIDE_TEXT` 全文~~（❌ v1 存档）

> **v2 已经把这份文本搬进了 `distill/flow.md`**（4 237 字符，多了「交回面板」一节与更直白的阶段写法）。
> `src/distill.ts` 里**没有** `DISTILL_GUIDE_TEXT` 常量，也不该有——流程是文件，不是常量的副本。
> 下面这份只留作「当初是怎么把 L2 文档写成模型能照做的东西」的样本，**改动请改 `distill/flow.md`**。

> 只通过 `awu_distill_guide` 的返回值出现，**永不进 system prompt**。实现时保持为一个模板串常量（`DISTILL_GUIDE_TEXT`），约 2.4 KB。

````markdown
# 从作品蒸馏一张角色卡（distill/1）

## 你要做什么
从用户给的作品（小说 / 剧本 / 影视字幕 / 游戏文本）里抽出一个角色，产出一张符合本插件字段契约的角色卡 JSON。
这张卡会直接当扮演用的素材，所以**声线 > 剧情**：说不像他，卡就废了。

## 铁律
1. 只用作品里能证到的东西。每条声线或性格结论后面跟一句依据（≤30 字原文引用，或章节位置）。
2. 不确定就留空，不要编。空字段用户能在编辑器里补；假字段会污染之后的每一轮对话。
3. 不要写"他会温柔地笑"这种通用描写，要给的是**这个角色独有的说话方式**。
4. 只给作品名、没给正文时：明确告诉用户你只能依赖记忆里的公开信息、可能有偏差，并要求贴章节原文再继续。
5. 一次只问一个问题，不要列问卷。用户答"随便"时，就按作品里最硬的一条证据决定，并说明依据。
6. 最终产出必须是**一个** ```json 代码块，前后不要写解释。键名是中文，逐字照契约，不许翻译。

## 五个阶段（按序推进，每阶段先问后落）

### 1. scope · 定范围
问清：哪部作品、抽谁、用户想以什么身份进这个故事（原作里的角色 / 旁观者 / 自设）。
收工判据：手上有 {角色名, 作品名, 用户身份, 至少一段原文或明确的替代约定}。

### 2. voice · 声线采证（最重要）
从原文摘 3–5 句该角色真实说过的话（连动作描写的括号一起），逐句分析：句长、断句习惯、自称、
怎么称呼对方、口头禅、绝不会说的话。把分析给用户看，再追问：「他生气的时候话变多还是变少？」
收工判据：voice 组 7 个字段都有依据（拿不到的留空）。

### 3. core · 性格与关系
问：外在一句话性格 vs 内在矛盾（他表面在演什么、实际在躲什么）；对最亲近的人有什么反差。
关系：起点是什么、他怎么称呼用户、用户怎么称呼他。用户是自设身份时，先确认「他第一次见你会把你当成谁」。
收工判据：personality 3 + relationship 3 有内容。

### 4. world · 世界与动态
来处（他从哪来）、落差（过去 vs 现在）、如今的日子、你与他的旧（用户是原作角色时）。
动态状态三项是**开场那一刻**的状态，不是总体人设。
收工判据：world 4 + dynamic_state 3。

### 5. assemble · 出卡
- memory_anchor.要点：3–6 条**具体可复用**的细节（谁欠谁一顿饭、哪只手上有疤），不要抽象形容词。上限 8 条。
- interaction_pref：回复长度倾向（短 / 中 / 长）、表情使用、话题舒适区、雷区。
- user_persona：只有当用户有自设身份时才填，否则整组省略。
- opening：一句开场台词（可含动作），要能直接当第一条消息发出去。
- openings：2–3 条备选，风格切面互不相同（不是同一句换词）。上限 8 条。
- name：角色名，同时写进 basic.姓名。名字不能含 / 或 \，不能是 . 或 ..。
- source 会由面板注入，你不用写。

## 字段契约（10 组 34 字段，逐字照抄）

basic（基本信息）：姓名 / 年龄 / 身份 / 一句话背景
voice（声线基因）：对话节奏 / 爱用句式[数组] / 自称 / 对用户的称呼 / 情绪口头禅[数组] / 禁忌词 / 非语言小动作[数组]
personality（性格核心）：关键词[数组] / 内在矛盾 / 对待亲近之人
relationship（关系定位）：关系起点 / 角色怎么称呼用户 / 用户怎么称呼角色
world（故事背景）：来处 / 落差 / 如今的日子 / 你与他的旧
memory_anchor（记忆锚点）：要点[数组]
dynamic_state（动态状态）：当前情绪 / 近况 / 此刻在做什么
interaction_pref（互动偏好）：回复长度倾向 / 表情使用 / 话题舒适区 / 雷区
user_persona（你的身份，选填）：你是谁 / 与 TA 的关系 / 共同经历
opening（开场白，直接挂卡片根）：opening / openings[数组]

[数组] = 字符串数组。其余都是字符串。注意「与 TA 的关系」中间的半角空格不能改。

## 输出格式

```json
{
  "name": "角色名",
  "basic": { "姓名": "…", "年龄": "…", "身份": "…", "一句话背景": "…" },
  "voice": { "对话节奏": "…", "爱用句式": ["…"], "自称": "…", "对用户的称呼": "…", "情绪口头禅": ["…"], "禁忌词": "…", "非语言小动作": ["…"] },
  "personality": { "关键词": ["…"], "内在矛盾": "…", "对待亲近之人": "…" },
  "relationship": { "关系起点": "…", "角色怎么称呼用户": "…", "用户怎么称呼角色": "…" },
  "world": { "来处": "…", "落差": "…", "如今的日子": "…", "你与他的旧": "…" },
  "memory_anchor": { "要点": ["…"] },
  "dynamic_state": { "当前情绪": "…", "近况": "…", "此刻在做什么": "…" },
  "interaction_pref": { "回复长度倾向": "短，两三句就停", "表情使用": "很少用", "话题舒适区": "…", "雷区": "…" },
  "user_persona": { "你是谁": "…", "与 TA 的关系": "…", "共同经历": "…" },
  "opening": "…",
  "openings": ["…", "…"]
}
```

## 交卡前自检（逐条过）
- [ ] 顶层只有一个 JSON 对象，没有解释文字，没有多余代码块。
- [ ] 组名与字段名逐字是中文契约里的写法（不是 basic_info、不是 Item）。
- [ ] 6 个数组字段真的是数组（爱用句式 / 情绪口头禅 / 非语言小动作 / 关键词 / 要点 / openings）。
- [ ] basic.姓名 与顶层 name 一致。
- [ ] 拿不到的字段就留空（整组没有内容就省掉整组），不要编。
- [ ] opening 能直接当第一条消息发出去，并且一听就是这个人。
````

## 附录 B：⏸（挂起）`DISTILL_GROUPS` 字面量（10 组 34 字段存档）

> 来源 `client/card-schema.ts:66-194`，逐字对齐。`required` 只有 `basic.姓名`。`opening` 组 `target:'top'`、`root:null`。

```ts
export const DISTILL_GROUPS: DistillGroup[] = [
  { id: 'basic', target: 'object', root: 'basic', title: '基本信息', optional: false, fields: [
    { key: '姓名', kind: 'text', required: true },
    { key: '年龄', kind: 'text', required: false },
    { key: '身份', kind: 'text', required: false },
    { key: '一句话背景', kind: 'long', required: false },
  ] },
  { id: 'voice', target: 'object', root: 'voice', title: '声线基因', optional: false, fields: [
    { key: '对话节奏', kind: 'long', required: false },
    { key: '爱用句式', kind: 'list', required: false },
    { key: '自称', kind: 'text', required: false },
    { key: '对用户的称呼', kind: 'text', required: false },
    { key: '情绪口头禅', kind: 'list', required: false },
    { key: '禁忌词', kind: 'long', required: false },
    { key: '非语言小动作', kind: 'list', required: false },
  ] },
  { id: 'personality', target: 'object', root: 'personality', title: '性格核心', optional: false, fields: [
    { key: '关键词', kind: 'list', required: false },
    { key: '内在矛盾', kind: 'long', required: false },
    { key: '对待亲近之人', kind: 'long', required: false },
  ] },
  { id: 'relationship', target: 'object', root: 'relationship', title: '关系定位', optional: false, fields: [
    { key: '关系起点', kind: 'text', required: false },
    { key: '角色怎么称呼用户', kind: 'text', required: false },
    { key: '用户怎么称呼角色', kind: 'text', required: false },
  ] },
  { id: 'world', target: 'object', root: 'world', title: '故事背景', optional: false, fields: [
    { key: '来处', kind: 'long', required: false },
    { key: '落差', kind: 'long', required: false },
    { key: '如今的日子', kind: 'long', required: false },
    { key: '你与他的旧', kind: 'long', required: false },
  ] },
  { id: 'memory_anchor', target: 'object', root: 'memory_anchor', title: '记忆锚点', optional: false, fields: [
    { key: '要点', kind: 'list', required: false },
  ] },
  { id: 'dynamic_state', target: 'object', root: 'dynamic_state', title: '动态状态', optional: false, fields: [
    { key: '当前情绪', kind: 'text', required: false },
    { key: '近况', kind: 'long', required: false },
    { key: '此刻在做什么', kind: 'text', required: false },
  ] },
  { id: 'interaction_pref', target: 'object', root: 'interaction_pref', title: '互动偏好', optional: false, fields: [
    { key: '回复长度倾向', kind: 'text', required: false },
    { key: '表情使用', kind: 'text', required: false },
    { key: '话题舒适区', kind: 'text', required: false },
    { key: '雷区', kind: 'long', required: false },
  ] },
  { id: 'user_persona', target: 'object', root: 'user_persona', title: '你的身份', optional: true, fields: [
    { key: '你是谁', kind: 'text', required: false },
    { key: '与 TA 的关系', kind: 'text', required: false },
    { key: '共同经历', kind: 'long', required: false },
  ] },
  { id: 'opening', target: 'top', root: null, title: '开场白', optional: false, fields: [
    { key: 'opening', kind: 'long', required: false },
    { key: 'openings', kind: 'list', required: false },
  ] },
]

export const DISTILL_FIELD_TOTAL = 34
```

校验自检：`DISTILL_GROUPS.reduce((n, g) => n + g.fields.length, 0) === 34`，且
`DISTILL_GROUPS.filter(g => g.fields.some(f => f.kind === 'list')).length === 6` 组里恰好 6 个 list 字段。
