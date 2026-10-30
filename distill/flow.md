# 从作品蒸馏一张角色卡（六 Phase 执行手册）

> 这份文件由 `dsh-ai-with-u` 插件随包发布。你收到的指令里给了它的**绝对路径**，读完就按下面的流程做。
> **你是执行者**：用户点了一次「开始蒸馏」，剩下全由你推进——问问题、查证、填卡、**最后自己调工具保存**。
> 文件路径、Phase 编号、这份手册本身，都不必念给用户听。

---

## 0. 第一件事：判断该不该委派（子代理优先）

蒸馏是**重活**：六 Phase、多次联网核实、几十条证据记录。它会把当前会话塞满中间过程，
而用户真正要的只是最后那张卡。所以——**优先交给子代理去做**。

| 你现在是谁 | 该怎么做 |
|---|---|
| **主会话的 agent**（用户直接跟你说话） | 先只确认两件事：**作品+角色**、**用户想以什么身份出场**。然后**派一个子代理**跑完全程，你只负责：转发用户补充的素材、汇报最终结果、在子代理需要拍板时把选择转给用户。**不要在主会话里跑六 Phase。** |
| **被派来的子代理**（你的任务就是蒸馏） | 从 Phase 1 开始一路跑到 Phase 6，自己保存，最后把结果报回主 agent。 |

**派单时必须把上下文写全**（子代理看不到你的会话，缺一样它就会瞎猜）：

```
请按蒸馏流程产出一张角色卡。
流程文件（先完整读完，按它执行）：{flow.md 绝对路径}
作品：{作品名}    角色：{角色名}    用户身份：{我本人 / 作品里的某人 / 用户自述}
素材：{用户贴的原文 / 链接 / 无}
联网核实：{默认执行 / 用户说过别联网}
规则：不扮演、不编造、每条提取带证据等级；最后调 awu_card_save({ name, data }) 保存；
      保存前若工具报 not-armed，先 POST {插件地址}/_dsh/ai-with-u/distill/arm 重新武装再存。
回报：卡名、证据覆盖度、未裁决冲突、⚠️待确认项。
```

**委派的三条纪律**：
1. **不要在会话里转播中间过程**——用户不需要看六 Phase 的每一步。只在「需要用户拍板」和「最终完成」时说话。
2. **子代理失败或检索不可用时**，合并成一段汇报，**不要**把它的原始日志贴给用户。
3. **卡存好之后**，主 agent 只回一句：卡名 + 一句人设摘要 + 「面板里已经能看到，直接开聊就行」。

> 当前环境**没有**子代理工具时（找不到 `subagent` / `spawn` / `task` 一类能力），就自己按六 Phase 跑。
> 但即便如此，也要**把中间过程压到最低**：一次只问一个问题，不要刷屏式汇报。

---

## 0.1 交货标准（先看这段，再动手）

1. **最终动作只有一个：调用 `awu_card_save({ name, data })` 把卡存进插件。**
   不要输出 JSON 代码块让用户复制，不要输出整张卡让人过目，不要说「把上面的内容粘回面板」——没有那一步。
2. **不做扮演测试**：蒸馏过程中**不许**演一段角色、不许给示例台词、不许示范对话。
   第一句话留给用户真正开聊时——从蒸馏里跳进角色演一段，会直接打断沉浸感。
3. **禁止编造**：拿不到就留空或标 `[待补]`。空是「还没写」，假是「写错了」——后者更贵。
4. **每条提取都要带证据等级**（直引 / 事实 / 印象），见 Phase 2。
5. **冲突未处置完不进最终卡**，见 Phase 3。
6. **一次只问一个问题**，不要列问卷。用户答「随便 / 你定」时，按最硬的那条证据决定，并说明依据。
7. **联网核实默认要执行**（除非用户说了别联网），见 Phase 1。
8. 你需要问的只有两件事：**素材（作品/角色/原文）** 与 **用户想以什么身份出场**。其余自己查、自己判断。

---

## 一、六 Phase 总览

| Phase | 名称 | 输入 → 产物 |
|---|---|---|
| 1 | **接收设定**（含资料核实） | 作品名 / 原文 / 链接 → **设定清单**（来源列表 + 信息充足度初判） |
| 2 | **五维提取** | 设定清单 → 五维条目，**每条带证据等级** |
| 3 | **冲突检查** | 五维草稿 → **conflicts 记录**（裁决或 `[待补]`） |
| 4 | **生成角色卡** | 五维 + 裁决 → 一张待保存的 CCv3 `data`（+ `character_book`） |
| 5 | **告知用户** | 卡片 → **证据覆盖度 / 冲突 / 保存位置**三项汇报 |
| 6 | **确认完整 → 保存** | 用户点头 → **调 `awu_card_save`** → 一句话确认 |
| （可选） | 质量评分 | 默认**不跑**；用户问「这卡怎么样」时再算，见 §九 |

> 每完成一个 Phase 写一次断点（见 §八）。中途被打断，用户说「继续蒸馏」就从断点接着跑。

---

## 二、Phase 1 · 接收设定（含资料核实）

### 2.1 五种素材渠道（用户给哪种走哪种）

| # | 渠道 | 处理 |
|---|---|---|
| 1 | **作品类型**（「从《××》里请 TA 来」） | 允许凭模型知识起手，但**必须按 2.2 联网核实**（除非用户说别联网） |
| 2 | **上传文本文件**（本地 txt / md 路径） | 只读该文件用于提取，**绝不修改源文件** |
| 3 | **对话粘贴文本**（原文片段 / 简介 / 百科摘录） | 按该文本提取，**不改写用户原文** |
| 4 | **用户提供链接** | **直接读该链接**（给链接即视为授权），只读该页，不扩散搜索 |
| 5 | **联网检索**（你自己搜） | v3 起**默认可以直接执行**，不必先问；用户说了「别联网 / 不用查」才跳过 |

确认前不进入提取：**先复述一句你要蒸馏的作品与角色，等用户确认（或用户已经说清就直接开始）**。

用户主动说了「我是 TA 的同门师弟」这类身份，就记进设定清单，Phase 5 复述确认——**不主动追问**。

### 2.2 联网核实（默认执行，这一步决定卡像不像本人）

> 只用模型知识蒸馏出来的卡，十张有八张是「通用印象」。**先用你手上的检索工具把印象换成依据。**

用 `web_search` / `advanced_search` / `web_fetch` / `platform_search`（哪个能用用哪个）按四轮查：

| 查什么 | 怎么查 | 用来填 |
|---|---|---|
| 基础事实 | 作品官网 / 官方设定 / 百科 | `basic`、`world` |
| **声线（最重要）** | 角色语音、剧情台词、PV / 动画台词；**中文查一遍、原文（日/英）再查一遍** | `voice` 七项 |
| 性格与关系 | 官方设定 + 主线关键事件 + 人物关系条目 | `personality`、`relationship` |
| 名字对应 | **外服 / 原文名**（同名角色极多，名字错了整张卡就歪） | `name`、`source` |

**策略（与老版 skill 相反，别照老习惯走）**：

- 默认联网核实 → 不询问；
- 用户明确说「别联网」→ 跳过，并在收尾时说明「本次只用模型知识与你的素材，细节可能有偏差」；
- **检索不可用**（没工具 / 全失败）→ 退回模型知识，**必须在 Phase 5 如实说明**「这次没能联网，证据等级以印象为主」；
- 用户给了大段原文 → 联网可以少查，但**声线仍要从原文里逐句摘**（Phase 2）。

### 2.3 信息源优先级（照这张表挑源）

| 优先级 | 信息源 | 用途 | 证据级别 |
|---|---|---|---|
| 1 | 作品官网 / 官方设定集页 / 作者访谈 | 人物设定、世界观、创作意图的第一手资料 | 事实 |
| 2 | 萌娘百科（中文 ACGN 角色条目最全） | 性格、口头禅、人际关系、经典语录 | 事实 |
| 3 | Fandom / 灰机 wiki（作品专属 wiki） | 剧情细节、角色语录、时间线 | 事实 / 直引 |
| 4 | 作品平台原文页（起点 / 晋江 / 番茄 / 豆瓣阅读等） | 作品简介、正文章节（台词与行为） | **直引** |
| 5 | 百度百科 / 维基百科（中英） | 通用条目、履历 | 事实 |
| 6 | 影视游戏商店页（豆瓣条目 / IMDb / Steam） | 角色介绍、演员 / 声优、剧情梗概 | 事实 |
| 7 | TV Tropes（Characters/ 页） | 性格 trope 标签化 | **印象** |
| 8 | 社区讨论（知乎 / 贴吧 / NGA / B 站 / Reddit） | 性格分析、关系解读、名场面整理 | **印象** |

**交叉验证**：至少两个来源对得上才算「事实」。只有单一来源的可以写进卡，但要在 Phase 5 标「⚠️ 单一来源」。

### 2.4 产物：设定清单（在心里/断点里维护，不必贴给用户）

```
作品：<作品名>（类型 / 作者）
角色：<角色名>（原文名 / 别名）
来源：模型知识 / 上传文本 / 粘贴文本 / 用户链接 / 联网检索（列出实际用到的 URL）
身份：用户将以什么身份出场（没说就写「未定」，Phase 6 再问一句）
充足度初判：五维各 高/中/低（见 §5.4）
```

---

## 三、Phase 2 · 五维提取（每条都要带证据等级）

### 3.1 五维

| 维度 | 提取内容 | 落到卡里 |
|---|---|---|
| **profile** | 姓名 / 年龄 / 身份 / 一句话背景 | `basic.*` + `data.name` |
| **personality** | 性格关键词 / 内在矛盾 / 三观倾向 | `personality.*` |
| **interaction** | 说话节奏 / 爱用句式 / 自称 / 怎么称呼用户 / 情绪口头禅 / 禁忌词 / 小动作 | `voice.*`（**灵魂字段**） |
| **memory** | 他自己的背景要点（对话能自然引用） | `world.*` + `memoryAnchors` |
| **relations** | 人际关系网络 + 关系起点 | `relationship.*` + `character_book` |

提取以「**对话能用得上**」为纲：优先他怎么说话、怎么待人、心里在乎什么；
百科式履历只保留**能自然引用为记忆锚点**的部分。

### 3.2 证据分级（三档，强制）

| 档 | 名称 | 判定 | 用法 |
|---|---|---|---|
| **verbatim** | 原文直引 | 作品 / 文本中的原句或近乎原句 | 最高优先；`voice` 必用 |
| **artifact** | 作品内事实 | 由情节、行为、事件推出的客观事实 | 正常使用 |
| **impression** | 印象推断 | 由整体氛围与上下文得出的主观印象 | **保守使用**，写进卡时标 `[推断]` |

### 3.3 记录格式（最终要落进 `aiwu.evidence.items`）

每条提取先在心里记成一行，Phase 4 组装卡时逐条塞进 `aiwu.evidence.items`：

```
{维度.字段}｜{内容}｜{verbatim|artifact|impression}｜{来源：URL / 章节 / 「原文粘贴」}
```

对应到卡里就是：

```jsonc
{ "field": "voice.catchphrases", "value": "诶诶诶", "grade": "verbatim", "source": "原作 第3章" }
```

- **`voice` 必须有出处**：`catchphrases` / `selfRef` / `callsUser` / `forbidden` 这几项，
  每条都要能追到**具体台词**；追不到就**留空**——声线写错比空着更糟。
- 印象级的条目**不要超过全部条目的一半**；过半说明你查得不够，回 Phase 1 再补。
- 条目多的时候**不必每条都进 `items`**（会撑大卡）：把 `voice` / `personality` / `relations` 的关键条目
  （约 10–20 条）写进 `items`，其余用 `evidence.coverage` 计数即可。

### 3.4 世界观的口径（底色，不是主线）

- 作品的设定只作**底色**收编：把「他曾经是谁、因何落到今天、如今靠什么过日子、你与他的旧」
  写进 `world.*` —— 让角色带上**故事感**。
- **原作主线不引入对话**：不设时间表（今晚/三天后）、不派任务（你去查/你去送）、
  不制造必须解决的悬念、不安排倒计时。
- 判据：**背景有没有让用户觉得「我得做点什么」**？有 → 写过头了，退回来。
- 需要在**被问到时才展开**的设定（原作主线梗概、专有名词、人物关系网）→ 走 `character_book`，见 §5.3。

---

## 四、Phase 3 · 冲突检查

同一设定在不同来源不一致时，就是冲突——**写下来，别擅自圆过去**。

### 4.1 conflicts 记录格式（最终写进 `aiwu.conflicts`）

```jsonc
{
  "field": "basic.age",           // 冲突落在哪个字段
  "a": "官方设定 26",              // 来源 A 的说法（带上来源类型更好）
  "b": "百度百科 24",              // 来源 B 的说法
  "verdict": "按官方设定取 26",     // 怎么裁的；裁不了写「用户未裁决，按缺失处理」
  "resolved": true                // 用户/你裁决了 = true；留 [待补] = false
}
```

没有冲突就**整块省略** `conflicts`；有冲突就整数组写进 `aiwu.conflicts`，
**未裁决的也要写进去**（`resolved: false`）——不许静默丢弃。

### 4.2 裁决顺序

1. 先按证据可信度裁决：**直引 > 事实 > 印象**；能裁决的直接裁，并记下依据（哪一条直引）。
2. 裁不了的 → 标 `[待补]`，留到 Phase 5 让用户拍板。
3. 用户拍了板 → 按用户的说法写。

### 4.3 硬约束

- **未处置的冲突不许带进最终卡**；用户没裁之前，该字段一律按缺失 `[待补]` 处理。
- `[待补]` 的字段**不要用「合理发挥」填**——那等于编造（违反 §0 第 3 条）。

---

## 五、Phase 4 · 生成角色卡

> **不产出额外文件**：老版 skill 的 `full_card.md` / `manifest.json` 这类多文件产物我们暂时不做——
> 来源、证据覆盖度、冲突裁决**全部写进卡里**（`aiwu.evidence` / `data.creator_notes` /
> `extensions.aiwu.evidence` / `extensions.aiwu.conflicts`）。你只需要凑出一份 `data`。

### 5.1 分工：常驻人设 vs 世界书

| 放哪 | 放什么 | 效果 |
|---|---|---|
| `data.extensions.aiwu.*` | **常规人设**：性格、声线、关系、世界底色、动态状态、记忆锚点、互动偏好 | 插件据此生成**常驻**的 `description` / `personality` / `scenario` / `system_prompt` / `post_history_instructions`，每轮都在 |
| `data.first_mes` + `data.alternate_greetings` | 开场白 + 2–3 条备选 | 原生位，**必须自己写** |
| `data.character_book.entries[]` | **被问到时才需要的设定**：原作主线梗概、专有名词、势力/地点、人物关系网 | **关键词触发**才注入，平时不占 token |

规则：常驻位只放「不说话就不像他」的东西；**能等到被问再说的，一律进世界书**。

### 5.2 `awu_card_save` 的 `data` 怎么填

**先把五维落到 `aiwu`（这一步照表抄，别自己发明键名）**：

| 五维（Phase 2） | 落到 `extensions.aiwu` |
|---|---|
| profile | `basic.age` / `basic.identity` / `basic.background` |
| personality | `personality.keywords` / `personality.contradiction` / `personality.towardClose` |
| **interaction（声线）** | `voice.pace` / `voice.catchphrases` / `voice.selfRef` / `voice.callsUser` / `voice.emotes` / `voice.forbidden` / `voice.gestures` |
| memory | `memoryAnchors`（string[]） |
| relations | `relationship.startPoint` / `relationship.charCallsUser` / `relationship.userCallsChar` |
| （另有四处不来自五维） | `world`（来处/落差/如今的日子/你与他的旧）、`dynamicState`（情绪/近况/此刻在做什么）、`interactionPref`（长度/表情/舒适区/雷区）、`userPersona`（你是谁/关系/共同经历/称呼替换名） |

> 完整 34 项对照表见**文末附录 A**，拿不准某个内容该落哪就把附录 A 从头过一遍。

一次调用就够：

```jsonc
awu_card_save({
  "name": "虞照",
  "data": {
    "name": "虞照",                        // 与顶层 name 一致
    "first_mes": "（把两袋菜往你怀里一塞）自己拿。",   // 必填：原生开场白（= 旧 opening）
    "alternate_greetings": ["…", "…"],      // 2–3 条，风格切面不同（= 旧 openings）

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
        "interactionPref": { "length": "…", "emoji": "…", "comfortZone": "…", "taboo": "…" },

        // 证据（原流程的 full_card / manifest 就落在这里，不另建文件）
        "evidence": {
          "items": [                         // 逐条：哪条是直引、哪条是印象，一目了然
            { "field": "voice.catchphrases", "value": "诶诶诶", "grade": "verbatim", "source": "原作 第3章" },
            { "field": "personality.keywords", "value": "话痨", "grade": "artifact", "source": "https://…" },
            { "field": "relations.在意的人", "value": "很护着家里人", "grade": "impression", "source": "社区讨论" }
          ],
          "coverage": { "verbatim": 12, "artifact": 7, "impression": 3 },
          "sources": ["https://…", "…"],    // ★ 查过的 URL 全部放这里，**不要**放 data.source
          "sufficiency": { "profile": "高", "personality": "中", "interaction": "高",
                           "memory": "中", "relations": "低" },
          "lite": false
        },

        // 跨来源冲突的裁决记录（Phase 3 的产物，原流程的 conflicts）
        "conflicts": [
          { "field": "basic.age", "a": "官方设定 26", "b": "百度百科 24",
            "verdict": "按官方设定取 26", "resolved": true },
          { "field": "world.origin", "a": "原作 南方小城", "b": "动画 北方",
            "verdict": "用户未裁决，按缺失处理", "resolved": false }
        ]
      }
    },

    "source": ["distill"],                  // 出处标识（distill / import / custom）——**不要塞资料 URL**；
                                        // 研究引用一律进 aiwu.evidence.sources（见下）
    "creator_notes": "蒸馏自《××》；印象级 3 条，relations 维度偏低（[待补]）",

    "character_book": {                     // 可选：只放"被问到才需要"的设定
      "name": "××·设定集",
      "entries": [
        {
          "keys": ["学院", "结社"],
          "content": "原作里 TA 出身的那个结社：…（一句话到三句话，别写成剧情大纲）",
          "enabled": true,
          "insertion_order": 1,
          "use_regex": false
        }
      ]
    }
  }
})
```

**别写这些原生位**：`description` / `personality` / `scenario` / `system_prompt` /
`post_history_instructions` / `mes_example` —— 留空，插件保存时按 `aiwu` 结构**确定性生成**。
（你若自己写了，插件只在为空时覆盖；但**绝不要和 `aiwu` 结构互相矛盾**。）

> 一句话记法：**结构（`aiwu`）是权威，原生位是投影**。所以你只填 `aiwu` + `first_mes` +
> `alternate_greetings` + 可选 `character_book` + `source`，其余交给插件。

### 5.3 `character_book` 怎么写

- **一条 = 一个主题**（一个组织 / 一个地名 / 一条主线梗概 / 一个人物关系网）。
- `keys`：2–6 个用户真可能打出来的词（别名、外号、地名简写都放进去）。
- `content`：1–3 句话，**陈述事实**，不写指令、不派任务。
- 没有合适主题就**整块省略**——宁可没有，也不要塞一堆「世界观介绍」进去吃 token。

### 5.4 信息充足度（强制）与 lite 轻量卡

对五维**逐一**标 高 / 中 / 低：

| 档 | 判据 | 处理 |
|---|---|---|
| **高** | 以直引 / 事实为主，证据充分 | 直接成卡 |
| **中** | 有骨架但细节缺失 | 缺的标 `[待补]`，可先成卡 |
| **低** | 只有印象或近乎空白 | **禁止编造**：回问用户或换素材，不能用「合理发挥」填 |

**lite 轻量卡**（冷门配角、素材稀薄）：

- 只保留五必填：`name` / `basic`（至少身份）/ `personality`（关键词）/ `relationship`（起点）/ `source`；
- `data.extensions.aiwu.evidence` 里写 `"lite": true`；
- 跳过质量评分；对话时按已有信息即兴发挥；
- 补全后**移除 lite 标记**即可升级成完整卡。

### 5.5 收尾前对一遍附录

填完 `aiwu` 后，回到**文末附录 A**（34 项 → `extensions.aiwu` 对照表）逐行核一遍：
有没有该填却漏的、有没有把内容塞错位置（例如把「关系起点」写进了 `world`）。

---

## 六、Phase 5 · 告知用户（三项汇报，别写成小作文）

按清单报，不要贴整张卡：

1. **证据覆盖度**：五维各自的充足度（高/中/低）+ 印象级条目占比 + 「⚠️ 单一来源」的部分。
   如果这次**没能联网**，第一句就说清。
2. **冲突与处置**：哪些跨来源矛盾、按什么依据裁的、哪些留着让用户定（`[待补]`）——
   全部来自 `aiwu.conflicts`，`resolved: false` 的**逐条列给用户**，不能只报个数字。
3. **将保存的位置**：卡名（`name`），以及「存好之后角色簿里就能看到」。
4. **（可选）你的身份**：用户之前说过自己以什么身份出场就复述确认；没说就问一句——
   给三个出口：① 我本人（默认，留空即此）② 同作品里的另一位（从 `relations` 里挑 1–2 个亲近的给候选）
   ③ 自己描述一句。用户说「随便 / 没有」→ 按 ① 走，**不追问、不阻塞**。

> 这一段是建卡的**后台汇报**，可以用清单体；等真正开聊时才恢复「零系统痕迹」，用角色口吻说话。

---

## 七、Phase 6 · 确认完整 → 保存

### 7.1 一句话收尾

> 「以上这样，可以开聊了吗？」

用户说行 / 点头 / 「可以」→ 进 7.2。
用户说哪块不对 → **就地改那一块**，改完再问一次，不用重走全流程。

### 7.2 保存：调 `awu_card_save`

```jsonc
awu_card_save({ "name": "虞照", "data": { …见 §5.2… } })
```

按返回的 `code` 分支处理（工具会明确给错误码，别自己猜）：

| 返回 | 处理 |
|---|---|
| `ok: true` | 进 7.3 |
| `code: "name-conflict"` | **先问用户**（见下），别写盘 |
| `code: "not-armed"` | 这次蒸馏的窗口没了 → 「这个会话的保存窗口已过期，去面板重新点一次蒸馏入口」 |
| `code: "invalid-name"` / `"invalid-data"` | 按报错原文修参数重试一次；仍失败就如实告诉用户 |

**重名时先问**：

> 「已经有一张叫『虞照』的卡了。你想**改名**存成新的，还是**覆盖**掉它？」

- 改名 → 问清新名字 → 换 `name` 再调一次；
- 覆盖 → 调 `awu_card_save({ name, data, overwrite: true })`；
- 用户犹豫 → 停着等，**不许自己决定覆盖**（会丢人家原来的卡）。

**其它失败**（写盘权限 / 参数被拒）→ 把错误原话告一句 + 给下一步，**不要假装存成功**。

> 注意：`data` 里**至少要有一样实质内容**（`description` / `personality` / `scenario` /
> `first_mes` / `mes_example`）。我们只写 `first_mes` 就够了，但**开场白不能空**——空卡会被工具拒。

### 7.3 保存后：一句话确认，然后闭嘴

> 「存好了：《虞照》——话多得要命、每天给你留一张便利贴的合租室友。角色簿里已经能看到这张卡了。」

要求：

- 卡名 + **一句人设摘要**（让用户确认抽对了角色）；
- 明确说「**角色簿里已经能看到**」；
- 需要的话补一句「想调哪块（声线 / 关系 / 开场）直接说，我改」；
- **不要**说「把 JSON 粘回面板」，**不要**再贴任何卡片内容；
- 然后结束这段建卡流程，不主动开聊、不给示例台词。

---

## 八、断点保存（中断可续）

插件的数据目录：**`~/.dsh/ai-with-u/`**（Windows 是 `C:\Users\<你>\.dsh\ai-with-u\`；若环境变量
`AIWU_STORAGE_ROOT` 覆盖过，以它为准）。

- 每完成一个 Phase，用你自己的文件写工具写一次
  **`~/.dsh/ai-with-u/_distill/<角色名>.json`**（角色名还没定时用 `_pending.json`）：

  ```json
  {
    "character": "虞照",
    "phase": 3,
    "phase_name": "冲突检查",
    "done_phases": 3,
    "next_phase": "生成角色卡",
    "notes": "五维已提取；2 条冲突待用户裁决",
    "updated_at": "2026-10-30T23:00:00+08:00"
  }
  ```

- **没有文件写能力时**（工具被裁）：把同样的内容当一条「断点摘要」留在对话里，并告诉用户
  「想中断就记住这句，回来说『继续蒸馏』我从这里接」。
- 用户说「继续蒸馏」：读最近一份断点，从 `next_phase` 接着跑，不要从头重来。
- **保存成功后删掉断点**（`_distill/<角色名>.json`）；此后「继续蒸馏」按「当前没有未完成的蒸馏」回答。

---

## 九、质量评分（可选，默认不跑）

> 蒸馏是给用户用的，不是给评委看的。Phase 5 汇报完直接保存开聊；用户问「这卡怎么样」或要做横向对比时再算。

综合分 = **完整度 × 45% + 证据率 × 45% + 冲突扣分 × 10%**（**不含任何扮演测试项**）

| 分数 | 档位 |
|---|---|
| ≥ 0.85 | 优秀 |
| 0.70 – 0.84 | 良好 |
| 0.60 – 0.69 | 及格 |
| < 0.60 | 不合格 |

- 完整度：五维覆盖比例（0–1）。
- 证据率：带**直引 / 事实**证据的条目占比（0–1）。
- 冲突扣分：无未处置冲突 = 1；每 1 条未处置冲突 −0.1，下限 0。
- 算分只在用户要求时进行，结论写进 `creator_notes` 即可；**不评分不影响保存**。

---

## 十、交卡前自检（逐条过，再调保存）

- [ ] `voice` 的 `pace` / `catchphrases` / `selfRef` / `forbidden`**没有一个空着**——废卡高发区。
- [ ] 每条声线与性格结论都有证据等级 + 出处，没有一句是「通用印象」。
- [ ] 印象级条目没过半；过半数 → 回 Phase 1 补查。
- [ ] `conflicts` 全部有处置或标了 `[待补]`，**没有未处置冲突进卡**。
- [ ] 五维充足度已逐个标注；`低` 的维度没有编造内容。
- [ ] `memoryAnchors` 是具体细节（谁欠谁一顿饭、哪只手有疤），不是形容词。
- [ ] `first_mes` 能直接当第一条消息发出去，且一听就是这个人；`alternate_greetings` 2–3 条。
- [ ] 常驻位只放「不说话就不像他」的东西；主线梗概 / 名词表 / 关系网都在 `character_book`。
- [ ] 没写 `description` / `personality` / `scenario` / `system_prompt` 这些原生投影（留给插件生成）。
- [ ] 数组字段真的是数组；拿不到的键是**省略**的，不是空串。
- [ ] 只调用了 `awu_card_save`，没动别的 `awu_*` 工具。
- [ ] 没有输出 JSON 代码块，没有演角色，没有给示例台词。

---

## 十一、数据获取铁律（v3 口径，与老版 skill 相反）

| 情况 | 做法 |
|---|---|
| 默认 | **联网核实直接执行**，不必先问用户 |
| 用户说「别联网 / 不用查」 | 跳过联网；收尾时说明「本次只用模型知识与你的素材，细节可能有偏差」 |
| 检索工具不可用 / 全部失败 | 退回模型知识；**在 Phase 5 如实说明**，并把证据等级整体下调（以印象为主） |
| 用户给了链接 | 直接读该页，**不扩散**到其它页面 |
| 用户贴了大段原文 | 以原文为准（`verbatim` 优先），联网可少查，但声线仍要逐句摘 |
| 冷门 / 细节存疑 | 继续换关键词检索；仍查不到就问用户，**不许自己编** |

> 一句话：**默认查，查不到才退**。别再回到「模型知识优先、联网要确认」的老口径。

---

## 附录 A：34 项人设维度 → `extensions.aiwu` 对照表（Phase 4 照它填）

> 这张表是我们独有的（原 skill 没有）。Phase 4 组装 `data` 时逐行对照，**别自己发明键名**。

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
| 33 | 开场白 | `data.first_mes` | string（**原生位**，模型手写） |
| 34 | 备选开场 | `data.alternate_greetings` | string[]（**原生位**，2–3 条） |

约定：

- 数组字段就给**数组**（别写「我跟你说、真的」一句话；插件不会替你猜）。
- 拿不到的键**整键省略**，不要写空串。
- `schema` 恒为 `1`；`displayName` 留空表示渲染成「你」。
- `name` 只在两处出现：工具参数 `name` 与 `data.name`，必须一致。
- 表里没有的三样由 Phase 3 / Phase 5 产出：证据 → `aiwu.evidence`，冲突 → `aiwu.conflicts`，
  来源 → `data.source`。
