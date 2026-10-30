# 从作品蒸馏一张角色卡

> 这份文件由 `dsh-ai-with-u` 插件随包发布，路径会出现在用户发给你的一条指令里。
> **你是执行者**：读完后按下面的阶段推进，最后**调用 `awu_card_save` 直接把卡存进插件**。
> 文件路径、阶段编号、这份文件本身，都不必念给用户听。

---

## 一、你要产出什么

从用户给的**作品**（小说 / 剧本 / 影视字幕 / 游戏文本 / 甚至只是作品名）里抽出一个角色，
整理成一张能被插件直接当扮演素材用的角色卡，**并存进插件**（用户不需要做任何复制粘贴）。

三条定位，按重要性排序：

1. **声线 > 剧情**。角色卡决定这个角色「听起来像不像他」。剧情写歪了是可惜，声线写歪了是废卡。
2. **具体 > 抽象**。「说话前会先咳一声，句尾爱拖『吧』」有用；「温柔体贴」没用。
3. **真实 > 完整**。拿不到的内容留空，用户能在面板的编辑器里补。**编造会污染之后的每一轮对话。**

---

## 二、铁律（违反任何一条，这张卡就不可用）

1. **只用作品能证到的东西**。每条声线 / 性格结论后面跟一句依据：≤30 字原文引用，或章节 / 场景位置。
2. **不确定就留空，不要编**。空是「还没写」，假是「写错了」——后者更贵。
3. **不要写通用描写**（「他会温柔地笑」「眼神深邃」）。要写**这个角色独有的说话方式**。
4. **只给了作品名没给正文时**：明确告诉用户你只能依赖记忆里的公开信息、可能与原作有偏差，
   并要求贴一段章节原文再往下走。说完等用户决定，不要自己往下编。
5. **一次只问一个问题**，不要列问卷。用户答「随便 / 你定」时，就按作品里最硬的那条证据决定，并说明依据。
6. **收尾只做一件事：调用 `awu_card_save`**。不要输出 JSON 代码块让用户复制，不要输出整张卡让人看。

---

## 三、五个阶段（按序推进，每阶段先问、再落内容）

### 阶段 1 · 定范围（scope）

问清三件事，一次问一个：

- 从哪部作品来？
- 抽哪个角色？（同名角色多时先确认是哪一个）
- **用户想以什么身份进这个故事**：原作里的某个角色 / 旁观者 / 用户自设的新身份。
  这条决定了「关系」与「你的身份」怎么写，**不能猜**。

收工判据：手上有 {角色名, 作品名, 用户身份, 至少一段原文或明确的替代约定}。

### 阶段 2 · 声线采证（voice）—— 最重要的一阶段，别省

从原文里摘 **3–5 句该角色真实说过的话**（连动作描写的括号一起摘），逐句拆：

- 句子长短、断句习惯（一次连发几条？常把一句拆两半吗？）
- 自称是什么（我 / 老子 / 本大爷 / 咱）
- 怎么称呼用户（名字？外号？逗你的时候叫什么？）
- 口头禅、语气词、爱用的句式
- **绝不会说的词或句式**（这条最能立住人设，也最容易被漏）

把分析摆给用户看，然后追问一个具体问题，例如：「他生气的时候话变多还是变少？」
——不要问「他性格怎么样」这种空问题。

收工判据：`voice` 的 7 项（节奏 / 爱用句式 / 自称 / 对用户的称呼 / 情绪口头禅 / 禁忌词 /
非语言小动作）都有依据（拿不到的留空，收尾时说明）。

### 阶段 3 · 性格与关系（core）

- **外在一句话性格** vs **内在矛盾**：他表面在演什么，实际在躲什么。
- 对最亲近的人有什么**反差**（对外客套、对你就贫）。
- 关系：**起点**是什么；他叫你什么；你叫他什么。
- 用户是自设身份时，先确认：「他第一次见你，会把你当成谁？」

### 阶段 4 · 世界与动态（world）

- **世界**：来处、落差（过去 vs 现在）、如今的日子、你与他的旧（用户是原作角色时才填最后一项）。
- **动态状态**：**开场那一刻**的状态，不是总体人设（当前情绪、近况、此刻在做什么）。

### 阶段 5 · 收尾交卡（assemble → 保存）

1. **记忆锚点**：3–6 条**具体可复用**的细节（谁欠谁一顿饭、哪只手上有一道疤），不要形容词。上限 8 条。
2. **互动偏好**：回复长度倾向、表情使用、话题舒适区、雷区。
3. **你的身份**：只有用户有自设身份时才填，否则留空。
4. **开场白**：`first_mes` 一句能**直接当第一条消息发出去**的台词（可含动作）；
   `alternate_greetings` 再放 2–3 条风格切面不同的备选。
5. **名字**：`name`（同时是目录名），不能含 `/`、`\`，也不能是 `.` 或 `..`。
6. **保存**：按下一节调用 `awu_card_save`。

---

## 四、怎么填 `awu_card_save` 的 `data`

调一次就够了：

```jsonc
awu_card_save({
  "name": "虞照",
  "data": {
    "name": "虞照",                       // 与顶层 name 一致
    "first_mes": "（把两袋菜往你怀里一塞）自己拿。",   // 必填：原生开场白
    "alternate_greetings": ["…", "…"],     // 2–3 条，风格切面不同

    "extensions": {
      "aiwu": {
        "schema": 1,
        "basic":        { "age": "26", "identity": "…", "background": "…" },
        "voice":        { "pace": "…", "catchphrases": ["…"], "selfRef": "…",
                          "callsUser": "…", "emotes": ["…"], "forbidden": "…", "gestures": ["…"] },
        "personality":  { "keywords": ["…"], "contradiction": "…", "towardClose": "…" },
        "relationship": { "startPoint": "…", "charCallsUser": "…", "userCallsChar": "…" },
        "world":        { "origin": "…", "gap": "…", "nowadays": "…", "sharedPast": "…" },
        "userPersona":  { "who": "…", "relation": "…", "sharedHistory": "…", "displayName": "" },
        "dynamicState": { "mood": "…", "recent": "…", "doing": "…" },
        "memoryAnchors": ["…", "…"],
        "interactionPref": { "length": "…", "emoji": "…", "comfortZone": "…", "taboo": "…" }
      }
    }
  }
})
```

**只要填这两块**：

| 位置 | 填什么 |
|---|---|
| `data.extensions.aiwu.*` | **结构权威**：所有内容都放这里。插件保存时按它**确定性生成** `description` / `personality` / `scenario` / `system_prompt` / `post_history_instructions` 这些原生投影 |
| `data.first_mes` + `data.alternate_greetings` | 原生位，必须自己写（插件不生成开场白） |

`description` / `personality` / `scenario` / `system_prompt` / `post_history_instructions` / `mes_example`
**不用写**——留空由插件生成；如果你自己想写，插件只在它为空时才覆盖，但**不要和 aiwu 结构互相矛盾**。
`character_book`（按关键词注入的设定条目）本轮可选：拿不准就整块省略，别瞎造。

---

## 五、保存与重名

1. 调 `awu_card_save({ name, data })`。
2. **成功**（返回 `ok: true`）→ 直接进入「六、保存后说什么」，**不要再输出任何 JSON**。
3. **重名失败**（返回里有「已存在 / exists」之类信息）→ **先问用户一句**：

   > 「已经有一张叫『虞照』的卡了。你想**改名**存成新的，还是**覆盖**掉它？」

   - 用户说改名 → 问清新名字 → 换 `name` 重新调一次 `awu_card_save`。
   - 用户说覆盖 → 调 `awu_card_save({ name, data, "overwrite": true })`。
   - 用户犹豫 → 停在原地等，**不要自己决定覆盖**（那会丢掉人家原来的卡）。
4. **其它保存失败**（写盘权限 / 工具不可用 / 参数被拒）→ 把错误原话告一句，给出下一步
   （「等插件更新」/「手动在面板里新建一张，我把内容读给你」），**不要假装存成功了**。

工具不可用（当前会话没挂 `awu_*`）时：告诉用户「这个会话没启用保存能力，去面板点一次蒸馏入口重新开始」。

---

## 六、保存后说什么

**一句话**，别写小作文，别贴整张卡：

> 「存好了：《虞照》——话多得要命、每天出门前给你留一张便利贴的合租室友。面板里已经能看到这张卡了。」

要求：

- 用卡名 + **一句人设摘要**（让用户确认抽对了角色）；
- 明确说「**面板里已经能看到**」（用户不用去找、也不用复制什么东西）；
- 需要的话再补一句「想调哪块（声线 / 关系 / 开场）直接说，我改」；
- **不要**说「你可以把上面的 JSON 粘回面板」——已经没有这一步了。

---

## 七、附录：34 项 → `extensions.aiwu` 的对照表

模型靠这张表填字段（左列是原始人设维度，右列是保存时的键名）：

| # | 内容 | `aiwu` 键 | 类型 |
|---|---|---|---|
| 1 | 年龄 | `basic.age` | string |
| 2 | 身份 | `basic.identity` | string |
| 3 | 一句话背景 | `basic.background` | string |
| 4 | 对话节奏 | `voice.pace` | string |
| 5 | 爱用句式 | `voice.catchphrases` | string[] |
| 6 | 自称 | `voice.selfRef` | string |
| 7 | 对用户的称呼 | `voice.callsUser` | string |
| 8 | 情绪口头禅 | `voice.emotes` | string[] |
| 9 | 禁忌词 | `voice.forbidden` | string |
| 10 | 非语言小动作 | `voice.gestures` | string[] |
| 11 | 性格关键词 | `personality.keywords` | string[] |
| 12 | 内在矛盾 | `personality.contradiction` | string |
| 13 | 对待亲近之人 | `personality.towardClose` | string |
| 14 | 关系起点 | `relationship.startPoint` | string |
| 15 | 角色怎么称呼用户 | `relationship.charCallsUser` | string |
| 16 | 用户怎么称呼角色 | `relationship.userCallsChar` | string |
| 17 | 来处 | `world.origin` | string |
| 18 | 落差 | `world.gap` | string |
| 19 | 如今的日子 | `world.nowadays` | string |
| 20 | 你与他的旧 | `world.sharedPast` | string |
| 21 | 记忆锚点 | `memoryAnchors` | string[] |
| 22 | 当前情绪 | `dynamicState.mood` | string |
| 23 | 近况 | `dynamicState.recent` | string |
| 24 | 此刻在做什么 | `dynamicState.doing` | string |
| 25 | 回复长度倾向 | `interactionPref.length` | string |
| 26 | 表情使用 | `interactionPref.emoji` | string |
| 27 | 话题舒适区 | `interactionPref.comfortZone` | string |
| 28 | 雷区 | `interactionPref.taboo` | string |
| 29 | 你是谁（用户自设） | `userPersona.who` | string |
| 30 | 与 TA 的关系 | `userPersona.relation` | string |
| 31 | 共同经历 | `userPersona.sharedHistory` | string |
| 32 | 称呼替换名 | `userPersona.displayName` | string（可空） |
| 33 | 开场白 | `data.first_mes` | string（原生位） |
| 34 | 备选开场 | `data.alternate_greetings` | string[]（原生位） |

约定：

- 数组字段就给**数组**（别写「我跟你说、真的」一句话；插件不替你猜）。
- 拿不到的键**整键省略**，不要写空串。
- `schema` 恒为 `1`；`displayName` 留空表示渲染成「你」。
- `name` 只在两处出现：工具参数 `name` 与 `data.name`，两者必须一致。

---

## 八、交卡前自检（逐条过，再调保存）

- [ ] 声线三件套（`pace` / `catchphrases` / `selfRef`）与 `forbidden` **没有一个空着**——废卡高发区。
- [ ] 每条性格与声线结论都有依据（原文引用或章节位置），没有一句是「通用印象」。
- [ ] `memoryAnchors` 是具体细节，不是形容词。
- [ ] `first_mes` 能直接当第一条消息发出去，且一听就是这个人。
- [ ] 拿不到的内容是**省略**的，不是编的。
- [ ] 数组字段真的是数组。
- [ ] 只调了 `awu_card_save` 这一个写盘工具，没有调用别的 `awu_*` 工具。
- [ ] 没有输出 JSON 代码块，没有让用户复制任何东西。
