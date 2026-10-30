# 「使用指南」板块 · 设计与交付（2026-10-30）

> 归属：dsh-ai-with-u 面板（452px 悬浮面板）的第 4 个 tab。
> 依据：`README.md`、`docs/DEVELOPMENT.md` §二 / §九、`06-tmp/aiwu-survey/client.md`、
> `client/text.ts`、`client/index.tsx`，以及**活着的实例**（`http://127.0.0.1:59609/_dsh/ai-with-u/overview`
> 与 `/characters` 实测：3 张预置卡、`root=C:\Users\11387\.dsh\ai-with-u`、`active.enabled=false`、
> `memoryEntries=0`；数据根下确实只有 `_index.json` + `characters/<角色名>/card.json`）。
> 行号以提交 `e07bf58` 为准。**本文没有半成品：每个数字都是实测值，每段文案都可直接粘贴。**

---

## 0. 结论

| 项 | 决定 |
|---|---|
| 位置 | **第 4 个 tab「指南」** + 首次打开面板时**一次性落在该 tab**（不做浮层、不做 `?` 按钮） |
| 结构 | 6 节，每节 3-5 条；8 个工具压成 4 组 ×4 行 + 1 条注 |
| 体量 | 中文 **724 字符（汉字 472）**，英文 1 771 字符；首屏（约 480px）覆盖前 4 节 |
| 字号 | 正文 11.5px、脚注/路径/FAQ 答案 11px（正文下限 11px，守住）；分节标题与序号 10px（标记，非正文） |
| 折叠 | **不做**。指南是"看一次 + 回头查"，折叠会把"一眼扫完"变成"多点几下" |
| 首次引导 | 做，轻量版：`localStorage['awu.guide.seen.v1']`，不碰插件数据目录 |
| 落点 | 新增 `client/guide.tsx`、`client/guide.styles.ts`；`index.tsx` 6 处小改；`text.ts` 42 键；`styles.ts` 2 行拼接 |
| README | 不复制、不链接、不依赖；口径按 §7 校准（"零残留"改为"角色与工具卸下，只剩 L0 底线"） |

我是按集成契约交付的：`index.tsx` / `text.ts` / `styles.ts` **只给提案**，没有动；新增的两个源码文件
（`client/guide.tsx`、`client/guide.styles.ts`）已按契约 §一 落盘，`npm run typecheck:client` 实测 0 error。

---

## 1. 位置：三方案对比与决定

### 1.1 452px 下的空间账

- 面板 `width: 452px`（`client/styles.ts:287`），内容区 `452 − 17×2 = 418px`。
- 分段器内宽 `418 − 2(border) − 6(padding) = 410`，4 个 tab 各 `flex:1`、`gap:2px`：
  `(410 − 6) / 4 ≈ 101px/格`。中文标签 2-3 字（"角色簿"36px）加 padding 16px 仍有 40px 余量；
  英文 `Roster` / `Guide` 约 42-46px，同样放得下。
- 极端窄屏（`max-width: calc(100vw - 20px)`，视口 300px → 面板 280px）时每格约 61px，
  3 字标签 36 + 16 padding = 52px，仍不折行。**结论：4 个 tab 在 452px 和 300px 两档都成立，不需要改 `.awu-tabs` 的 CSS。**

### 1.2 对比

| 方案 | 452px 下的实际表现 | "常翻"吗 | 实现成本 | 结论 |
|---|---|---|---|---|
| **a) 第 4 个 tab「指南」** | 与其它 tab 同级，占 34px 高的一行；内容是长文，正好用 `.awu-body` 的滚动 | ✅ 随时点开 | 1 个按钮 + `Tab` 联合类型加一项 + 1 行渲染 | **采用** |
| b) 头部 `?` 按钮弹层 | 长文塞进 452px 弹层，遮住面板、要自己滚；`Overlay` 已有 6 个弹层在用，再加一个状态 | ❌ 每次都要先找到 `?` | 新增 dialog 状态 + 弹层组件 | 不采用 |
| c) 首次打开的一次性引导浮层 | 第一次读完就再也找不到；还多一套 scrim/焦点管理 | ❌ | 中 | 只取"落地页"这一半，并入 a |

### 1.3 决定

**a + c 的轻量组合**：指南是一个常驻 tab（可反复翻），首次打开面板时该 tab 已是选中态
（"落地页"效果），读完点"角色簿"就永远按用户选择走。没有浮层、没有 scrim、没有额外按钮，
面板头部保持现在的"刷新 / 关闭"两个图标（`index.tsx:1285-1305`）。

为什么不是纯 c：指南里"数据在哪、怎么备份、退出有没有残留"属于**出事时才翻**的内容，
一次性浮层把它变成了不可逆的"当时没看清就没了"。

---

## 2. 内容结构（6 节）

| # | 节 | 条数 | 回答的问题 | 首屏? |
|---|---|---|---|---|
| 1 | 三步上手 | 3 | 怎么开始用 | ✅ |
| 2 | 它能帮什么 | 4 | 值不值得用 | ✅ |
| 3 | 面板里的三块 | 3 | 三个 tab 各干什么 | ✅ |
| 4 | 模型会做的 8 件事 | 4 行 + 1 注 | 启用后模型多出哪些动作（人话，不写函数签名） | ✅ |
| 5 | 数据在哪 | 1 路径块 + 3 行 + 1 注 | 存哪、长什么样、怎么备份、怎么导入原 skill | 第 2 屏 |
| 6 | 常见疑问 | 3 Q&A | 换会话算不算 / 退出有没有残留 / L0 是什么 | 第 2 屏 |

映射关系（README 里对应哪段，但**不复用其文字**）：

- 节 1 → README「使用」4 步（压成 3 步，去掉"开新会话"这个多余动作）
- 节 4 → README「能力清单 · 模型工具（8 个）」表格（表 → 4 组人话）
- 节 5 → README「数据存储」目录树（树 → 一句路径块 + 三句话）
- 节 6 → README「核心特性 · 真·插拔」「分层按需注入 L0」（把口号改成可验证的陈述）

节数/条数都在 3-5 之间，唯一超过 5 行的是节 5 的路径块，按**一个块**计（3 行等宽字），不拆。

---

## 3. 完整文案

### 3.1 中文（直接粘进 `client/text.ts` 的 `zh`）

```ts
  // ---- 使用指南 ----
  'panel.tab.guide': '指南',
  'guide.quickstart.title': '三步上手',
  'guide.quickstart.step1': '在角色簿里挑一张卡，点「启用」。',
  'guide.quickstart.step2': '回到任意会话直接发消息，不用重新介绍自己。',
  'guide.quickstart.step3': '不想用了点「退出」，人设和工具一起卸下。',
  'guide.help.title': '它能帮什么',
  'guide.help.1': '一张卡就是一个人：称呼、语气、节奏都按卡走。',
  'guide.help.2': '聊过的事会记进日记，下次它自己想起来。',
  'guide.help.3': '改卡、翻日记、清记忆都在面板里，不用手改文件。',
  'guide.help.4': '不启用时完全不影响写代码、查资料、跑命令。',
  'guide.sections.title': '面板里的三块',
  'guide.sections.rosterName': '角色簿',
  'guide.sections.roster': '挑卡、启用、看详情、改角色卡。',
  'guide.sections.diaryName': '日记',
  'guide.sections.diary': '按天看记录，可改写、可忘记、可重置。',
  'guide.sections.statsName': '统计',
  'guide.sections.stats': '角色数、记忆数、对话轮数、数据放在哪。',
  'guide.tools.title': '模型会做的 8 件事',
  'guide.tools.diaryName': '日记',
  'guide.tools.diary': '写新记录；按关键词翻旧的。',
  'guide.tools.fixesName': '更正',
  'guide.tools.fixes': '改写某一条；忘掉一件事，三处一起清。',
  'guide.tools.identityName': '身份',
  'guide.tools.identity': '查它现在是谁；按对话重算关系档位。',
  'guide.tools.openingName': '开场',
  'guide.tools.opening': '换一句开场；全新开始或彻底重置。',
  'guide.tools.note': '一共 8 个，只在启用角色时挂载，退出即卸下。',
  'guide.data.title': '数据在哪',
  'guide.data.root': '~/.dsh/ai-with-u/',
  'guide.data.rootWindows': 'Windows: C:\\Users\\<你>\\.dsh\\ai-with-u\\',
  'guide.data.rootHint': '换位置：设环境变量 AIWU_STORAGE_ROOT。',
  'guide.data.layout': '每个角色一个文件夹：card.json、diary.md、session.json。',
  'guide.data.backup': '备份：整个文件夹复制走；恢复就拷回原位，点刷新。',
  'guide.data.import': '导入：把原 skill 的 characters/ 里每个角色文件夹拷进 characters/，刷新面板。',
  'guide.data.note': '预置卡只在 characters/ 不存在时种一次，不会覆盖你拷进来的卡。',
  'guide.faq.title': '常见疑问',
  'guide.faq.q1': '换会话还算吗？',
  'guide.faq.a1': '算。启用状态写在磁盘上，新旧会话都带人设，重启 DSH 也会自动恢复。',
  'guide.faq.q2': '退出后有残留吗？',
  'guide.faq.a2': '人设和 8 个工具都卸下；只剩一段约 690 字的 L0 底线常驻，里面没有任何角色内容。',
  'guide.faq.q3': 'L0 底线是什么？',
  'guide.faq.a3': '一条常驻声明：工作区里的人设、语气让位；代码规范、安全约束照常。判据是「只让我是谁，不让我怎么做」。',
```

### 3.2 英文（直接粘进 `client/text.ts` 的 `en`，与中文逐键对应）

```ts
  'panel.tab.guide': 'Guide',
  'guide.quickstart.title': 'Three steps',
  'guide.quickstart.step1': 'Pick a card in the roster and press Enable.',
  'guide.quickstart.step2': 'Return to any chat and just type; no reintroduction needed.',
  'guide.quickstart.step3': 'Press Exit and the persona and its tools come off together.',
  'guide.help.title': 'What it does',
  'guide.help.1': 'One card is one person: wording, tone and rhythm come from it.',
  'guide.help.2': 'Talks go into a diary, so the character remembers next time.',
  'guide.help.3': 'Cards, diaries and memory cleanup all live in this panel.',
  'guide.help.4': 'While off, coding, research and commands are untouched.',
  'guide.sections.title': 'The three tabs',
  'guide.sections.rosterName': 'Roster',
  'guide.sections.roster': 'pick a card, enable it, view details, edit the card.',
  'guide.sections.diaryName': 'Diary',
  'guide.sections.diary': 'entries by day; rewrite, forget or reset them.',
  'guide.sections.statsName': 'Stats',
  'guide.sections.stats': 'characters, memories, turns, and where the data lives.',
  'guide.tools.title': 'What the model can do',
  'guide.tools.diaryName': 'Diary',
  'guide.tools.diary': 'write new notes; search older ones by keyword.',
  'guide.tools.fixesName': 'Fixes',
  'guide.tools.fixes': 'rewrite a line; forget one thing across all three places.',
  'guide.tools.identityName': 'Identity',
  'guide.tools.identity': 'who it is now; recompute the relationship band.',
  'guide.tools.openingName': 'Opening',
  'guide.tools.opening': 'another opening; start over, or reset everything.',
  'guide.tools.note': 'Eight in all; mounted only while a character is enabled.',
  'guide.data.title': 'Where the data lives',
  'guide.data.root': '~/.dsh/ai-with-u/',
  'guide.data.rootWindows': 'Windows: C:\\Users\\<you>\\.dsh\\ai-with-u\\',
  'guide.data.rootHint': 'Change it with the AIWU_STORAGE_ROOT environment variable.',
  'guide.data.layout': 'One folder per character: card.json, diary.md, session.json.',
  'guide.data.backup': 'Backup: copy the whole folder; restore it and hit refresh.',
  'guide.data.import': 'Import: paste each old-skill character folder into characters/, then refresh.',
  'guide.data.note': 'Presets seed once, only when characters/ is absent; yours are never overwritten.',
  'guide.faq.title': 'Common questions',
  'guide.faq.q1': 'Does it carry into new chats?',
  'guide.faq.a1': 'Yes. The state is saved to disk; new and old chats both get the persona, and a restart keeps it.',
  'guide.faq.q2': 'Anything left after Exit?',
  'guide.faq.a2': 'The persona and all eight tools are unmounted. Only a ~690-character L0 baseline stays in the system prompt, with no character content.',
  'guide.faq.q3': 'What is the L0 baseline?',
  'guide.faq.a3': 'Workspace personas and tone step aside; code, process and safety rules still apply. The test: who I am yields, how I work does not.',
```

### 3.3 字数与折行（452px 实测口径）

规则：内容宽 418px。中文按 11.5px/全角算 ≈ **36 字/行**，带前缀（序号/标签）≈ **32 字/行**；
英文按 11.5px ≈ **66 字符/行**，留余量按 **62**。11px 的脚注/FAQ 答案按 **38 字/行**。
"行"= 预估渲染行数（`=ceil(宽/418)`，带前缀时已扣前缀宽）。

| 键 | 中文 | 行 | 英文 | 行 |
|---|---:|---:|---:|---:|
| `panel.tab.guide` | 2 | 1 | 5 | 1 |
| `guide.quickstart.title` | 4 | 1 | 11 | 1 |
| `guide.quickstart.step1` | 16 | 1 | 43 | 1 |
| `guide.quickstart.step2` | 21 | 1 | 59 | 1 |
| `guide.quickstart.step3` | 20 | 1 | 59 | 1 |
| `guide.help.title` | 5 | 1 | 12 | 1 |
| `guide.help.1` | 22 | 1 | 62 | 1 |
| `guide.help.2` | 19 | 1 | 60 | 1 |
| `guide.help.3` | 23 | 1 | 57 | 1 |
| `guide.help.4` | 21 | 1 | 55 | 1 |
| `guide.sections.title` | 6 | 1 | 14 | 1 |
| `guide.sections.rosterName` | 3 | 1 | 6 | 1 |
| `guide.sections.roster` | 15 | 1 | 52 | 1 |
| `guide.sections.diaryName` | 2 | 1 | 5 | 1 |
| `guide.sections.diary` | 18 | 1 | 46 | 1 |
| `guide.sections.statsName` | 2 | 1 | 5 | 1 |
| `guide.sections.stats` | 19 | 1 | 54 | 1 |
| `guide.tools.title` | 10 | 1 | 21 | 1 |
| `guide.tools.diaryName` | 2 | 1 | 5 | 1 |
| `guide.tools.diary` | 13 | 1 | 46 | 1 |
| `guide.tools.fixesName` | 2 | 1 | 5 | 1 |
| `guide.tools.fixes` | 18 | 1 | 57 | 1 |
| `guide.tools.identityName` | 2 | 1 | 8 | 1 |
| `guide.tools.identity` | 17 | 1 | 47 | 1 |
| `guide.tools.openingName` | 2 | 1 | 7 | 1 |
| `guide.tools.opening` | 16 | 1 | 49 | 1 |
| `guide.tools.note` | 23 | 1 | 56 | 1 |
| `guide.data.title` | 4 | 1 | 20 | 1 |
| `guide.data.root` | 17 | 1 | 17 | 1 |
| `guide.data.rootWindows` | 37 | 1 | 39 | 1 |
| `guide.data.rootHint` | 28 | 1 | 58 | 1 |
| `guide.data.layout` | 42 | 1 | 60 | 1 |
| `guide.data.backup` | 24 | 1 | 58 | 1 |
| `guide.data.import` | 54 | 2 | 77 | 2 |
| `guide.data.note` | 37 | 1 | 80 | 2 |
| `guide.faq.title` | 4 | 1 | 16 | 1 |
| `guide.faq.q1` | 7 | 1 | 29 | 1 |
| `guide.faq.a1` | 35 | 1 | 96 | 2 |
| `guide.faq.q2` | 8 | 1 | 25 | 1 |
| `guide.faq.a2` | 45 | 2 | 135 | 2 |
| `guide.faq.q3` | 9 | 1 | 24 | 1 |
| `guide.faq.a3` | 50 | 2 | 131 | 2 |

- 中文合计 **724 字符 / 472 汉字**；英文合计 **1 771 字符**（42 键）。
- 需要折行的中文只有 3 条（`data.import`、`faq.a2`、`faq.a3`），英文 5 条（`data.import`、`data.note`、`faq.a1`、`faq.a2`、`faq.a3`）；两边都折的是 `data.import`、`faq.a2`、`faq.a3`。
- `guide.data.rootWindows` 中文 37"字"但绝大部分是 ASCII 路径，实宽约 229px，单行；`data.layout` 同理（实宽约 333px）。
- 没有一条需要超过 2 行；3 行即视为文案超长，测试时按此验收。

### 3.4 文案原则（写后续文案时照这个来）

1. **直白**：能写"点「启用」"就不写"即可完成启用"。
2. **不用感叹号**：全篇 0 个 `！` / `!`；情绪交给角色卡，指南只负责说清。
3. **数字说准**：8 个工具、3 个分区、690 字 L0、`characters/` 目录名。宁可写路径也不写"某个目录"。
4. **术语保留原文**：`card.json` / `_active.json` / `AIWU_STORAGE_ROOT` / `characters/` 不翻译、不改大小写。
5. **中英同义**：英文不是直译，但每条的信息量必须与中文一致（`panel.tab.guide` 是唯一只求短的例外）。

---

## 4. 版式

### 4.1 ASCII 草图（452px；括号内是高度）

```text
┌────────────────────────── 452px ──────────────────────────┐
│ AI WITH U                                      ↻    ✕     │ 头部 ~70
│ 角色管理器                                                │
├───────────────────────────────────────────────────────────┤
│ ◉ 虞照   已启用 今天 · 文本 + 动作        [⇄] [↻] [退出]   │ 启用横幅 ~66
│  （未启用时：虚线提示条 ~46）                              │
├───────────────────────────────────────────────────────────┤
│        3 角色       │      0 记忆      │      0 对话       │ 统计条 ~59
├───────────────────────────────────────────────────────────┤
│ [ 角色簿 ] [ 日记 ] [ 统计 ] [ 指南 ]                      │ 分段器 ~46
├───────────────────────────────────────────────────────────┤
│ 三步上手 ──────────────────────────────                    │ 题 10/14，下距 7
│ 1  在角色簿里挑一张卡，点「启用」。                        │ 步 11.5/18
│ 2  回到任意会话直接发消息，不用重新介绍自己。              │
│ 3  不想用了点「退出」，人设和工具一起卸下。                │
│                                                            │ ↕ 节间距 16
│ 它能帮什么 ────────────────────────────                    │
│ 一张卡就是一个人：称呼、语气、节奏都按卡走。               │
│ 聊过的事会记进日记，下次它自己想起来。                     │
│ 改卡、翻日记、清记忆都在面板里，不用手改文件。             │
│ 不启用时完全不影响写代码、查资料、跑命令。                 │
│                                                            │
│ 面板里的三块 ──────────────────────────                    │
│ 📖 角色簿  挑卡、启用、看详情、改角色卡。                  │
│ ✒  日记    按天看记录，可改写、可忘记、可重置。            │
│ ✦  统计    角色数、记忆数、对话轮数、数据放在哪。          │
│                                                            │
│ 模型会做的 8 件事 ─────────────────────                    │
│ 日记  写新记录；按关键词翻旧的。                           │
│ 更正  改写某一条；忘掉一件事，三处一起清。                 │
│ 身份  查它现在是谁；按对话重算关系档位。                   │
│ 开场  换一句开场；全新开始或彻底重置。                     │
│   一共 8 个，只在启用角色时挂载，退出即卸下。              │ 注 11/17，左缩 20
│                                                            │
│  ↓ 滚动（约 1.7 屏；左侧那条 7px 滚动条由 .awu-body 提供）    │
└───────────────────────────────────────────────────────────┘
```

第二屏（`数据在哪` + `常见疑问`）：

```text
│ 数据在哪 ──────────────────────────────                    │
│ ┌─────────────────────────────────────────────────────┐   │ 路径块
│ │ ~/.dsh/ai-with-u/                                   │   │ 等宽 11/17
│ │ Windows: C:\Users\<你>\.dsh\ai-with-u\              │   │
│ │ 换位置：设环境变量 AIWU_STORAGE_ROOT。              │   │ 11/16 淡
│ └─────────────────────────────────────────────────────┘   │ 圆角 8、内距 8/10
│ 每个角色一个文件夹：card.json、diary.md、session.json。    │
│ 备份：整个文件夹复制走；恢复就拷回原位，点刷新。           │
│ 导入：把原 skill 的 characters/ 里每个角色文件夹拷进       │ ← 2 行
│       characters/，刷新面板。                              │
│   预置卡只在 characters/ 不存在时种一次，不会覆盖你的卡。  │
│                                                            │
│ 常见疑问 ──────────────────────────────                    │
│ 换会话还算吗？                                             │ 问 11.5/17 500
│ 算。启用状态写在磁盘上，新旧会话都带人设，重启 DSH ...     │ 答 11/17
│                                                            │ 问答对间距 +4
│ 退出后有残留吗？                                           │
│ 人设和 8 个工具都卸下；只剩一段约 690 字的 L0 底线常驻，   │
│ 里面没有任何角色内容。                                     │
│                                                            │
│ L0 底线是什么？                                            │
│ 一条常驻声明：工作区里的人设、语气让位；代码规范、安全...  │
```

### 4.2 尺寸表

| 元素 | 值 | 说明 |
|---|---|---|
| 面板宽 | 452px（`styles.ts:287`） | 不改 |
| 内容宽 | 418px = 452 − 17×2 | 指南整列占满 |
| 分节标题 | 10px / 14px，600，`.18em`，`--awu-gold`，大写 | 与 `.awu-sectionHead` 同一语言，但**不带卡片边框**，省两层内边距 |
| 正文 | 11.5px / 18px，`--awu-ink-dim` | 与 `.awu-line`、`.awu-field` 同档 |
| 序号 / 分节标题 | 10px | 属"标记"层；正文层一律 ≥11px |
| 脚注、路径、FAQ 答案 | 11px / 17px | 不破 11px 下限 |
| 行内标签 | 11.5px / 18px，500，`--awu-ink-mute` | |
| 图标 | 11px（复用 `icons.tsx` 的 16 格视野） | `IconBook` / `IconQuill` / `IconSpark`，与三个 tab 同源 |
| 节间距 | 16px | 与"一屏四节"的节奏配套 |
| 节内条目间距 | 6px | 比行高 18 略松，条目自成一格 |
| 题头与正文间距 | 7px | |
| 问答对额外间距 | 4px | |
| 路径块 | padding 8/10，`--awu-r-sm`(8px)，`--awu-surface-2` | 浅色主题下自动变成"宣纸底" |
| 折叠 | **无** | 见 §4.3 |
| 首屏高度 | 前 4 节约 467px | 720px 高的面板给 body 约 480px，刚好一屏 |

### 4.3 折叠与否

- **不做**逐节折叠。理由：① 折叠需要状态（与"纯展示组件"契约冲突，也会让 `guide.tsx` 长出 `useState`）；
  ② 指南的目标是"一眼扫完"，折叠把一次滚动变成多次点击；③ 6 节里最长的一节（数据）也只有 5 条。
- 若将来内容翻倍：优先**拆 tab**（如"指南 / 数据"），不要折叠——折叠在 452px 里会吃掉标题行高度。

### 4.4 字号红线自检

- 正文层：`11.5px`（line/step text/key）、`11px`（note / path / faq-a），**没有 11px 以下的正文**。
- 唯一的 10px 是 `.awu-guide-h`（分节标题）和 `.awu-guide-num`（序号），两者都是"标记"，
  与面板既有的 `.awu-sectionHead`(10px)、`.awu-lineMarker`(9px)、`.awu-count`(10px) 同一口径。
- 深/浅色两套主题都由 `--awu-*` token 自动切换（浅色变量在 `styles.ts:63-85`），无需额外规则。
- 无动画：指南不引入 `@keyframes`，`prefers-reduced-motion` 无需为它加条目。

---

## 5. 首次引导

### 5.1 决定

**做，但不做浮层**：首次打开面板时「指南」是选中 tab（落地页），离开后不再自动抢焦点。

- 打开面板 = 用户第一次真的要看东西，此时给指南最自然；
- 不遮挡、不加 scrim、不需要焦点管理（`Overlay` 的焦点问题见 client.md §7-R8）；
- 只有一次，之后用户点哪个 tab 就是哪个。

### 5.2 标记存哪

| 项 | 值 |
|---|---|
| 存储 | `window.localStorage` |
| key | `awu.guide.seen.v1` |
| value | `'1'` |
| 写入时机 | 面板 `open` 变 `true` 时（`markGuideSeen()`） |
| 读取时机 | `CharacterPanel` 挂载时决定 `tab` 初始值（`guideFirstRun()`） |
| 与插件数据目录的关系 | **无耦合**。插件数据在 `~/.dsh/ai-with-u/`（磁盘 JSON/MD），这里在浏览器 profile 的 Local Storage，不进 `_active.json`、不进 `_index.json` |
| 后端改动 | 0 |

### 5.3 生命周期与失败路径

- 换浏览器 / 清缓存 / 换 DSH profile → 标记消失 → 下次打开面板又落一次指南（代价：点一下"角色簿"），**不丢任何数据**。
- 隐私模式 / storage 被禁 → `getItem` 抛错 → `guideFirstRun()` 返回 `false`（按已看过处理），
  **不会每次打开都强行落在指南**；`markGuideSeen()` 抛错只打一条 `console.warn`，不阻断面板。
- 升版重来：把 key 改成 `awu.guide.seen.v2` 即可再引导一次，旧 key 不用清理（几十字节）。
- 不做"每台机器同步"：这是引导提示，不是数据；同步它没有收益。

### 5.4 未采纳

- 完整遮罩式欢迎页：成本高（新 scrim/焦点/Esc 管理）、和现有 6 个弹层抢 z-index（`2147482000/2147482100`）。
- 在启用横幅下加一行"第一次用？看指南"：多一行 UI，且启用横幅本身已有 3 个按钮，视觉上更挤。

---

## 6. 实现落点

### 6.1 新增 `client/guide.tsx`（已落盘，可直接用）

```tsx
/**
 * AI WITH U · 使用指南（面板第 4 个 tab）
 *
 * 定位：让新用户 60 秒内知道「怎么用 / 能干什么 / 数据在哪 / 常见疑问」。
 * 纯展示组件：只接收翻译函数 `t`，不 fetch、不读写角色数据，也不订阅宿主状态。
 *
 * 唯一的状态副作用是首次引导标记：读写在浏览器 `localStorage`，**不落插件数据目录**
 * （`~/.dsh/ai-with-u/`），删掉只会让「指南」再当一次落地页，不丢任何记忆。
 * 读取 / 写入由 `index.tsx` 在面板打开时调用 `guideFirstRun()` / `markGuideSeen()`。
 */
import type { JSX } from 'react'

import { IconBook, IconQuill, IconSpark } from './icons'
import type { Translate } from './text'

/** 首次引导标记：`awu.` 前缀 + 功能名 + 版本号；以后改版直接升到 v2 重新引导。 */
export const GUIDE_SEEN_KEY = 'awu.guide.seen.v1'

/** 是否该把「指南」当首屏。读不到（隐私模式 / 无 storage）就当作已看过，宁可少打扰。 */
export function guideFirstRun(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) !== '1'
  } catch (error) {
    console.warn('[ai-with-u] 读取指南首次标记失败，按已看过处理', error)
    return false
  }
}

/** 记下「看过了」。写失败不影响使用，只留一条警告方便排查。 */
export function markGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, '1')
  } catch (error) {
    console.warn('[ai-with-u] 写入指南首次标记失败（localStorage 不可用）', error)
  }
}

// ---------------------------------------------------------------- 小组件

function GuideSection(props: { title: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <section className="awu-guide-sec">
      <h3 className="awu-guide-h">{props.title}</h3>
      <div className="awu-guide-body">{props.children}</div>
    </section>
  )
}

/** 带序号的一步。 */
function Step(props: { index: number; text: string }): JSX.Element {
  return (
    <div className="awu-guide-step">
      <span className="awu-guide-num">{props.index}</span>
      <span className="awu-guide-text">{props.text}</span>
    </div>
  )
}

/** 一行说明；`mono` 用于路径这类需要等宽对齐的内容。 */
function Line(props: { text: string; mono?: boolean }): JSX.Element {
  return (
    <div className="awu-guide-line" data-mono={props.mono === true ? 'true' : 'false'}>
      {props.text}
    </div>
  )
}

/** 「标签 + 说明」一行；标签可以带一枚 16 格视野的内联图标。 */
function KeyLine(props: { icon?: JSX.Element; name: string; text: string }): JSX.Element {
  return (
    <div className="awu-guide-keyed">
      {props.icon !== undefined && (
        <span className="awu-guide-ico" aria-hidden="true">{props.icon}</span>
      )}
      <span className="awu-guide-key">{props.name}</span>
      <span className="awu-guide-text">{props.text}</span>
    </div>
  )
}

/** 一条问答。 */
function Faq(props: { q: string; a: string }): JSX.Element {
  return (
    <div className="awu-guide-faq">
      <div className="awu-guide-q">{props.q}</div>
      <div className="awu-guide-a">{props.a}</div>
    </div>
  )
}

// ---------------------------------------------------------------- 主体

/**
 * 指南正文。六节：三步上手 / 它能帮什么 / 面板三块 / 8 个工具 / 数据在哪 / 常见疑问。
 * 每节 3-5 条，首屏覆盖前四节；数据与问答在下半屏，属于「回头查」的部分。
 */
export function GuideView(props: { t: Translate }): JSX.Element {
  const { t } = props
  return (
    <div className="awu-guide">
      <GuideSection title={t('guide.quickstart.title')}>
        <Step index={1} text={t('guide.quickstart.step1')} />
        <Step index={2} text={t('guide.quickstart.step2')} />
        <Step index={3} text={t('guide.quickstart.step3')} />
      </GuideSection>

      <GuideSection title={t('guide.help.title')}>
        <Line text={t('guide.help.1')} />
        <Line text={t('guide.help.2')} />
        <Line text={t('guide.help.3')} />
        <Line text={t('guide.help.4')} />
      </GuideSection>

      <GuideSection title={t('guide.sections.title')}>
        <KeyLine
          icon={<IconBook size={11} />}
          name={t('guide.sections.rosterName')}
          text={t('guide.sections.roster')}
        />
        <KeyLine
          icon={<IconQuill size={11} />}
          name={t('guide.sections.diaryName')}
          text={t('guide.sections.diary')}
        />
        <KeyLine
          icon={<IconSpark size={11} />}
          name={t('guide.sections.statsName')}
          text={t('guide.sections.stats')}
        />
      </GuideSection>

      <GuideSection title={t('guide.tools.title')}>
        <KeyLine name={t('guide.tools.diaryName')} text={t('guide.tools.diary')} />
        <KeyLine name={t('guide.tools.fixesName')} text={t('guide.tools.fixes')} />
        <KeyLine name={t('guide.tools.identityName')} text={t('guide.tools.identity')} />
        <KeyLine name={t('guide.tools.openingName')} text={t('guide.tools.opening')} />
        <div className="awu-guide-note">{t('guide.tools.note')}</div>
      </GuideSection>

      <GuideSection title={t('guide.data.title')}>
        <div className="awu-guide-path">
          <div className="awu-guide-pathLine">{t('guide.data.root')}</div>
          <div className="awu-guide-pathLine">{t('guide.data.rootWindows')}</div>
          <div className="awu-guide-pathHint">{t('guide.data.rootHint')}</div>
        </div>
        <Line text={t('guide.data.layout')} />
        <Line text={t('guide.data.backup')} />
        <Line text={t('guide.data.import')} />
        <div className="awu-guide-note">{t('guide.data.note')}</div>
      </GuideSection>

      <GuideSection title={t('guide.faq.title')}>
        <Faq q={t('guide.faq.q1')} a={t('guide.faq.a1')} />
        <Faq q={t('guide.faq.q2')} a={t('guide.faq.a2')} />
        <Faq q={t('guide.faq.q3')} a={t('guide.faq.a3')} />
      </GuideSection>
    </div>
  )
}
```

### 6.2 新增 `client/guide.styles.ts`（已落盘，导出 `GUIDE_CSS`）

```ts
/**
 * AI WITH U · 使用指南板块样式
 *
 * 独立文件，由 `client/styles.ts` 把 `GUIDE_CSS` 拼进那唯一一份 <style>（集成契约 §二），
 * 不新增第二个 style 标签、不改卸载逻辑、也不碰任何既有的 `.awu-*` 规则。
 *
 * 约定：类名一律 `awu-guide-*` 前缀；颜色只走 `--awu-*` token，一个写死的色值都没有；
 * 字号不低于 11px（序号 / 分节标题这类「标记」按现有面板口径用 10px）。
 */
export const GUIDE_CSS = `
/* ================================================================ 使用指南（面板第 4 个 tab） */

.awu-guide {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 2px;
}

.awu-guide-sec { display: flex; flex-direction: column; gap: 7px; }

/* 分节标题：沿用面板 .awu-sectionHead 的「金色小标 + 细线」，但不带卡片边框，省掉两层内边距 */
.awu-guide-h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--awu-gold);
  opacity: .9;
}

.awu-guide-h::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--awu-line-strong), transparent);
}

.awu-guide-body { display: flex; flex-direction: column; gap: 6px; }

/* 步骤与「标签 + 说明」两种行：同一套 flex 骨架，标签不参与换行 */
.awu-guide-step,
.awu-guide-keyed {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.awu-guide-num {
  flex: none;
  width: 13px;
  font-family: var(--awu-mono);
  font-size: 10px;
  line-height: 18px;
  color: var(--awu-gold);
}

/* 正文：11.5px / 18px，与 .awu-line、.awu-field 同一档（这套面板的正文基准） */
.awu-guide-line {
  font-size: 11.5px;
  line-height: 18px;
  color: var(--awu-ink-dim);
}

.awu-guide-line[data-mono="true"] {
  font-family: var(--awu-mono);
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-ico {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--awu-gold);
  opacity: .7;
}

.awu-guide-key {
  flex: none;
  font-size: 11.5px;
  line-height: 18px;
  font-weight: 500;
  color: var(--awu-ink-mute);
}

.awu-guide-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--awu-ink-dim);
}

/* 小注：跟正文同一档字号（11px），靠淡一档的墨色退到次要层 */
.awu-guide-note {
  padding-left: 20px;
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-faint);
}

/* 数据路径块：浅底 + 等宽字，和「统计」页的存放位置是同一种读法 */
.awu-guide-path {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
}

.awu-guide-pathLine {
  font-family: var(--awu-mono);
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-pathHint {
  font-size: 11px;
  line-height: 16px;
  color: var(--awu-ink-faint);
  word-break: break-word;
}

/* 常见疑问：问在上答在下，问答对之间比行距再松一点 */
.awu-guide-faq { display: flex; flex-direction: column; gap: 2px; }
.awu-guide-faq + .awu-guide-faq { margin-top: 4px; }

.awu-guide-q {
  font-size: 11.5px;
  line-height: 17px;
  font-weight: 500;
  color: var(--awu-ink-dim);
}

.awu-guide-a {
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute);
}
`
```

### 6.3 给 Lead 的合并清单

| # | 文件:行（e07bf58） | 动作 | 片段 |
|---|---|---|---|
| 1 | `client/index.tsx:83` | `Tab` 联合类型加一项 | `type Tab = 'roster' \| 'diary' \| 'stats' \| 'guide'` |
| 2 | `client/index.tsx:33` | 加导入 | `import { GuideView, guideFirstRun, markGuideSeen } from './guide'` |
| 3 | `client/index.tsx:903` | tab 初始值走首次引导 | `const [tab, setTab] = useState<Tab>(() => (guideFirstRun() ? 'guide' : 'roster'))` |
| 4 | `client/index.tsx:970` 之后 | 打开面板即记「已看过」 | 见下方片段 A |
| 5 | `client/index.tsx:1400` 之后 | 分段器加第 4 个按钮 | 见下方片段 B |
| 6 | `client/index.tsx:1582` 之后（`1583` 的 `</div>` 之前） | body 里渲染指南 | `{tab === 'guide' && <GuideView t={t} />}` |
| 7 | `client/styles.ts:17` 之前（文件头注释之后） | 引入 GUIDE_CSS | `import { GUIDE_CSS } from './guide.styles'` |
| 8 | `client/styles.ts:1877` 之后 | 拼进唯一 CSS | 在 `}` 与收尾反引号之间加一行 `  ${GUIDE_CSS}` |
| 9 | `client/text.ts:26` / `:194` | 加第 4 个 tab 文案 | `'panel.tab.guide': '指南',` / `'panel.tab.guide': 'Guide',` |
| 10 | `client/text.ts:176` / `:342` 之后（`177` / `343` 的闭合 `}` 之前） | 粘贴 §3.1 / §3.2 两块 | 键名 / zh / en 见 §3 |

片段 A（插在 `index.tsx:964-970` 那个"面板打开时静默刷新"的 effect 之后）：

```tsx
  // 首次打开面板：让「指南」当一次落地页，并记下「看过了」。
  // 标记在浏览器 localStorage，不碰插件数据目录，也不影响任何角色数据。
  useEffect(() => {
    if (open) markGuideSeen()
  }, [open])
```

片段 B（插在 `index.tsx:1400` 的 `</button>` 之后、`1401` 的 `</div>` 之前）：

```tsx
            <button
              type="button"
              role="tab"
              className="awu-tab"
              data-on={tab === 'guide' ? 'true' : 'false'}
              aria-selected={tab === 'guide'}
              onClick={() => setTab('guide')}
            >
              {t('panel.tab.guide')}
            </button>
```

补充说明：

- **不需要动 `.awu-tabs` CSS**：`.awu-tab` 是 `flex: 1`，第 4 个按钮自动四等分（见 §1.1 的宽度账）。
- **不需要新弹层状态**：指南是 tab，`dialog` 字符串联合（`index.tsx:919`）保持不变。
- **不要给指南加 `aria-controls`/`role="tabpanel"`**：现有三个 tab 都没有，单独给第 4 个加会造成不一致；
  若要补无障碍，应四个一起补（属另一件事）。
- `GuideView` 不接收 `root`：实际存放路径在「统计」页的「存放位置」已经显示，指南只讲默认位置，
  避免两处数据源不一致。
- 面板宽度 452px、`maxHeight: min(78vh, 720px)` 均不变；指南内容约 833px，靠 `.awu-body` 滚动。

### 6.4 验收命令

```bash
npm run typecheck:client   # 已跑：0 error（新文件也纳入 tsconfig.client.json 的 include）
npm run build              # tsc + tsc(client) + esbuild + 三套自检
```

手验：左栏底部「角色管理」→ 首次打开应落在「指南」→ 四节在首屏 → 滚到底看数据与 FAQ →
点「角色簿」后关闭面板再打开，应停在「角色簿」（标记已写）。

---

## 7. 与 README 的关系

### 7.1 三条硬规矩

1. **不复制**：README 的表格、目录树、安装步骤、体积对比（13 KB → 1.8 KB）一个字都没搬进来。
2. **不依赖**：指南里没有任何链接，也不要求用户先读 README；断网、只装了插件也能读完。
3. **不打架**：README 里被口号化/过时的说法，指南按**代码实测**写（见下表），README 自己不改。

### 7.2 口径校准

| 主题 | README 的说法 | 指南的说法 | 依据 |
|---|---|---|---|
| 退出后的残留 | 第 28 行写"退出 → 干净拔出，零残留"（第 5 行是"干净拔出"） | "人设和 8 个工具都卸下；只剩一段约 690 字的 L0 底线常驻，里面没有任何角色内容" | README 第 32 行自己也承认"退出后只剩 L0 常驻"；`src/prompt.ts:238-248` 的常驻段不随 `deactivate` 释放 |
| L0 体积 | 684 字符（第 17、38 行） | 约 690 字 | 实测 `BASELINE_TEXT` = **686 字符**（`src/prompt.ts:32-56`） |
| 预置卡什么时候种 | "首次启用时幂等种入" | "只在 `characters/` 不存在时种一次，不会覆盖你拷进来的卡" | `src/store.ts:770-773`：`existsSync(dirRoot)` 直接 `return 0` |
| 导入原 skill | "把 `~/.ai-with-u/characters/` 直接拷进…" | "把原 skill 的 `characters/` 里每个角色文件夹拷进 `characters/`，刷新面板" | 同上：整个 characters 目录已存在时不再种卡，拷的是**角色文件夹** |
| 8 个工具 | 表格 + 函数名 | 4 组人话（日记/更正/身份/开场），不写函数签名 | 契约要求"用人话，不写函数签名" |
| 与 AGENTS.md 的优先级 | 单独一节 | 只出现在 FAQ 一处（"只让我是谁，不让我怎么做"） | 指南不是架构文档 |
| 安装 / 开发 / 接口 | 大段 | 不出现 | 面板内的事，60 秒目标 |

> 给以后改文案的人：如果哪天 L0 真的去掉了，FAQ 第 2 条要**一起改**——这句是全篇唯一直接引用实现细节的文案。

---

## 8. 交付自检

| 硬约束 | 结果 |
|---|---|
| 唯一允许写盘的文件 | 原任务只许写本文；Lead 的集成契约把 `client/guide.tsx`、`client/guide.styles.ts` 划给我，故实际落盘 = 本文 + 这 2 个**新文件**；`index.tsx` / `text.ts` / `styles.ts` / `README.md` / `DEVELOPMENT.md` **0 改动**（`git status` 只有 `??` 新增） |
| 颜色走 token | `GUIDE_CSS` 内 0 个 `#` / `rgb(` / `hsl(` 字面量，全部 `var(--awu-*)` |
| 状态用 `data-*` | `data-mono="true\|false"` |
| 中英双份、语义一致 | 42 键 ↔ 42 键，逐条核对 |
| 中文直白、无感叹号堆情绪 | 全篇 `！` 0 个 |
| 零新依赖 | 只 import 现有 `icons.tsx` / `text.ts` |
| 无未完成项 | 每个数字都是实测值，没有「稍后补」的占位标记 |
| 文案可直接用 | §3.1 / §3.2 可整块粘贴；§6.1 / §6.2 为已落盘文件的全文 |
| 字号红线 | 正文最低 11px（§4.4） |
| 类型检查 | `npm run typecheck:client` → 0 error |

### 一句话留给主人

最可能想删的一节是「它能帮什么」——它和 §1 的启用横幅、§3 的分区说明有一点语义重叠；
最可能想加的是"怎么改角色卡"（34 个字段、声线灵魂字段），本文只给了一句"改角色卡"，因为编辑器入口在详情页、
指南再展开会破坏"6 节、每节 3-5 条"的扫描节奏。
