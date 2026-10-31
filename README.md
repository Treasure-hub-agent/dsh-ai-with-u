# dsh-ai-with-u

**给 DeepSeek Harness 的角色扮演插件。** 蒸馏任意ip角色卡并让你的大肥鱼成为TA，选一张角色卡点「启用」，人设立刻生效；点「退出」，干净拔出，正常工作不受影响。

![version](https://img.shields.io/badge/version-0.3.0-d97706)
![npm](https://img.shields.io/npm/v/dsh-ai-with-u?color=cb3837&logo=npm)
![license](https://img.shields.io/badge/license-MIT-2563eb)
![platform](https://img.shields.io/badge/DSH-desktop-1f6feb)
![node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933?logo=node.js&logoColor=white)
![self-checks](https://img.shields.io/badge/self--checks-784%20passed-16a34a)

<p align="center">
  <img src="docs/assets/panel.png" width="880" alt="角色管理器面板：左侧角色簿，右侧角色卡详情与编辑入口">
</p>

<p align="center">
  <sub>面板实拍：左侧角色簿，右侧是角色卡详情——34 个字段都可以就地编辑。</sub>
</p>

---

## 它是什么

一个 DSH 插件，负责三件事：**把角色卡注入系统提示词、维护角色的日记记忆、提供一个管理面板**。

自带完整的蒸馏系统，可指引大肥鱼联网收集资料，整理一张任意 IP 的角色卡并启用角色扮演——只要网上能搜到，就能蒸出来！
内置三张卡：Ave Mujica 的丰川祥子、明日方舟的阿米娅、崩坏的昔涟。
标准的酒馆卡格式，可导入现成酒馆卡，也可自制。

聊天本身仍然走 DSH 自己的会话——不做自定义聊天界面，不劫持消息流。插件只在「人设从哪来、记忆写到哪」这两个环节介入。

```
启用前：和普通 DSH 会话没有区别
启用后：模型以角色身份说话，但该跑测试跑测试、该读代码读代码
退出后：系统提示词里一个字都不留，和没装过一样
```

---

## 为什么会有它

原项目 [ai-with-u](https://github.com/Treasure-hub-agent/ai-with-u) 是一个 skill：角色卡、日记、时间差全有，但所有确定性逻辑都交给模型——建目录、读写 JSON、追加 markdown、算索引。模型得同时扮演角色和文件系统，出岔子是早晚的事。

这个插件把确定性部分收进代码，只把「怎么写台词」留给模型。

| | 原 skill | 本插件 |
|---|---|---|
| 提示词 | `SKILL.md` 13 KB，每轮全量注入 | 启用态约 2.8–3.3 KB（lite 档），不启用时为 0 |
| 文件读写 | 模型自己动手 | 插件代码保证，原子写 + 跨进程锁 |
| 角色管理 | 在对话里说指令 | 可视化面板 |
| 生效时机 | 一直生效 | 可插拔，退出即卸载 |

有两处是**故意不做**，别当成缺功能：

- **8 个场景的扮演测试**（原 skill 里那套「测一遍人设像不像」的用例）没搬。人像不像只能靠聊，靠脚本测不出来——能测的（提示词长度、字段完整性、世界书命中、导入解析）都已经进了自检，共八套。
- **`manifest` / `full_card` 不单独落文件**，收进 `card.json` 的 `extensions.aiwu` 里。CCv3 本身只有一份真相，再存一份清单等于制造两个会互相漂移的事实来源；要读清单就 `GET /character`。

---

## 它是怎么工作的

```mermaid
flowchart LR
    U[你的消息] --> S[DSH 会话]
    S --> A{每轮组装系统提示词}
    A --> L0[L0 底线]
    A --> L05[L0.5 纪律包]
    A --> L1[L1 角色卡]
    A --> W[世界书命中]
    A --> D[日记与会话摘要]
    L0 --> M[模型]
    L05 --> M
    L1 --> M
    W --> M
    D --> M
    M --> R[角色口吻的回复]
    R --> DB[(写回日记 / 会话状态)]
    DB -. 下一轮 .-> A
```

### 分层注入

| 层级 | 什么时候在 | 内容 | 体积 |
|---|---|---|---|
| **L0 底线** | 启用期间 | 优先级声明 + 扮演底线 | 约 365 字符 |
| **L0.5 纪律包** | 启用期间，按档位 | 禁止词库、消息形态、动作格式、输入识别、内容边界 | lite 555 / full 736 字符 |
| **L1 角色** | 启用期间 | CCv3 角色卡（声线优先）+ 时间差 + 最近日记 | 约 1.9–2.4K，随卡增长 |
| **世界书** | 命中才注入 | 关键词 / 常驻条目，预算 12 条 · 6000 字符 | 典型约 0.2K |
| **L2 长流程** | 工具按需 | 蒸馏、建卡向导 | 不进系统提示词 |

退出时五段全部返回空串，宿主会过滤掉——这是「干净拔出」的实现方式，不是靠删文件。

纪律包有三档：`off`（关掉）/ `lite`（默认）/ `full`（多一段「遮住名字也要猜得出是谁」的语态锚点 + 每 10 轮日记自检）。切档走 `POST /_dsh/ai-with-u/discipline`，偏好存在 `_active.json` 里，退出角色也保留。

### 插拔

- 启用状态落盘，重启 DSH 自动恢复
- `awu_*` 工具与角色同进同出：启用才挂载，退出即卸下
- 世界书按关键词命中，同一轮复用结果，不重复注入、不跨轮累积

---

## 界面

入口在左侧栏底部（与用量统计插件同席位）。展开态显示「角色管理 + 当前角色名」，收起态收成 36px 圆徽，点击弹出悬浮面板。

四个分区：

- **角色簿** — 卡片墙、导入角色卡、注入预览、详情页、完整编辑
- **日记** — 时间线、关键词搜索、按月折叠、导出 markdown、逐条改写、危险区
- **统计** — 角色数、记忆条数、对话轮次
- **指南** — 首次打开时的使用说明

**注入预览**在角色簿详情的「预览」入口：列出此刻真正会进系统提示词的五段（L0 底线 / L0.5 纪律包 / L1 角色 / 世界书 / 时间差），每段给段名与字符数，下面是逐段正文，最后给总字符数。它显示的是宿主那一刻的真实渲染结果（`GET /preview`，纯只读：不刷新缓存、不写盘），不是面板自己另算的一份——两套算法的预览迟早会和实际注入对不上。

日记页支持**记忆回顾**：关键词搜索（标题、正文、日期都能命中）、按月份折叠，以及把当前角色的日记导出成 markdown 文件（浏览器里直接下载，不经过宿主）。

角色簿左栏顶部并排两枚同级按钮：**蒸馏角色卡**（从作品里蒸一张）和 **自创角色卡**（从零写一张）。旁边是对话模式的胶囊「纯文本 / 文本 + 动作」，当前值高亮，点一下立刻生效——不需要先启用角色，因为模式是偏好不是角色属性。

自创角色卡填三格（名字 / 身份 / 一句话背景）就能落档。想省事就勾「让 AI 补全人设」：插件先把这张骨架卡存好，再把补全指令发到当前会话，AI 会先问你 3–5 个关键问题（声线、关系、雷区、称呼），然后按酒馆卡格式补齐人设、开场白和世界书。合理推断标 `[AI推断]`，推不出来的标 `[待补]`，不编造。

角色簿左栏还有「导入角色卡」，吃酒馆卡的三种形态：带立绘的 `.png`、`.charx` 压缩包、裸 `.json`。选完文件先出预览（识别到的名字、格式、全部 warnings），同名卡会提醒冲突并要二次确认；确认后才写盘，取消不落任何文件。文件上限 11 MB——base64 会膨胀 4/3，11 MB 传到宿主正好还在 16 MB 收包线内；带立绘的 PNG 卡常见 3–10 MB。

「世界书太大」不再拦导入，只给警告：世界书是**按需注入**的（12 条 / 6000 字预算），超大书不会把提示词撑爆，只是超出预算的条目进不去当轮上下文。真正没有预算、直进提示词的那五个原生字段（描述 / 性格 / 场景 / 系统提示 / 历史后指令）仍然有硬上限。

角色卡编辑器是 10 组 34 字段，第 11 个分区是**世界书**：条目名、关键词 / 副关键词（逗号分隔）、内容长文本（可全屏写）、常驻、优先级、插入顺序、逐条启用与上移下移。高级项里有位置（角色设定前 / 后）、大小写敏感、`selective`、正则。顶部体检标红五种情况：没有关键词、`selective` 缺副关键词、内容为空或超长（单条 800 字）、关键词重复、插入顺序撞车；整本还有条数 30 / 总字数 20000 的预算提醒。体检只提示，不拦保存。

编辑器里「声线基因」是灵魂字段：说话节奏、自称、口头禅、禁忌词、小动作。这些决定「听起来像不像他」，所以给了金色描边和独立徽记。

---

## 安装

### 前提

- DeepSeek Harness 桌面版（desktop profile）
- Node 22.19+ 或 24+
- 不需要编译 C++，零原生依赖

### 步骤

包已发布到 npm，可以跳过克隆直接装（装完仍要按第 3 步配 bundles）：

```bash
npm install dsh-ai-with-u
```

GitHub Packages 上也有同一版本（scoped 名，需要带 `read:packages` 的 token）：

```bash
npm install @treasure-hub-agent/dsh-ai-with-u --registry=https://npm.pkg.github.com
```

或者从源码构建：

```bash
git clone https://github.com/Treasure-hub-agent/dsh-ai-with-u.git
cd dsh-ai-with-u
npm install && npm run build
```

```powershell
# 建 junction（Windows 上不要用 ln -sfn，它会静默退化成目录拷贝）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ai-with-u" `
  -Target "<你的克隆路径>"
```

然后编辑 `~/.dsh/profiles/desktop/package.json`：

```jsonc
{
  "dependencies": {
    "dsh-ai-with-u": "link:<你的克隆路径>"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...
        "dsh-ai-with-u"
      ]
    }
  }
}
```

最后重启 DSH。宿主不会热加载 `lib/index.js`。

> ⚠️ 不要在 profile 的 `cordis.patch.yml` 里手写插件行——包内 `cordis.patch.yml` 的 `bundle.patch` 会自动挂载，重复写只会干扰故障定位。

---

## 使用

1. 左侧栏底部点「角色管理」
2. 选一张卡点「启用」
3. 开个新会话，像给老朋友发消息一样聊
4. 不想玩了点「退出」

想换说话方式（要不要带 `（动作）`）不用回面板：角色簿左栏工具栏有「纯文本 / 文本 + 动作」两枚胶囊，点一下 `POST /mode` 立刻切；也可以在对话里让模型切（`awu_mode`）。

开箱自带三张范例卡（丰川祥子 / 阿米娅 / 昔涟，都由插件自己的蒸馏流程产出）。首次启用时幂等种入：`characters/` 已存在就跳过，不会复活你删掉的卡。

### 兼容旧卡与酒馆卡

- **旧 34 字段卡**：直接放进 `characters/<名>/card.json`，读时自动归一成 CCv3，首次保存时才落成新格式并留下 `card.v1.bak.json`
- **酒馆卡导入**：支持 `.png`（`tEXt` / `iTXt` 的 `ccv3`、`chara` 段）、`.charx`（zip 里的 `card.json`）、裸 `.json`（CCv2 自动升到 V3）
- **世界书超限**：不再拒绝导入或保存，改为返回 warnings（实际字数 + 上限）并在预览里逐条列出。世界书按需注入，超出 12 条 / 6000 字预算的部分不会进提示词——书是完整的，只是这一轮用不到那么多

### 文件拖放归谁管

**面板打开期间，文件拖放归面板处理。**

DSH 的聊天区有一个「文件或图片拖动到此处即可添加」的拖放区，它是文档级的：文件在页面任何位置松手，都会被它接住当附件。所以插件打开面板后会接管文件拖放：

- 拖进「导入角色卡」的虚线框 → 走导入预览（不写盘，确认才保存）
- 拖到面板里其它地方 → 提示「把卡拖到虚线框里」，**不放行给聊天区**
- 拖进面板之外（聊天区自己）→ 正常添加附件，插件不管

为什么这么较真：v0.3.0 真机上出现过「把角色卡拖到面板上，卡被当成附件发进了对话」。宁可拦下来给一句提示，也不能让卡文件混进聊天上下文。

> 插件同时会替聊天区复位它的拖放状态（拖完主动补一个 `dragend`）。所以关掉面板之后，聊天区的拖放应该和平时一样——如果你发现关面板后拖文件进聊天区没反应，那是 P0，请报。

---

## 数据存储

默认 `~/.dsh/ai-with-u/`，可用 `AIWU_STORAGE_ROOT` 覆盖：

```
~/.dsh/ai-with-u/
├── _index.json                # 角色索引
├── _active.json               # 当前启用状态（含 mode / discipline 偏好）
└── characters/<角色名>/
    ├── card.json              # CCv3 角色卡
    ├── card.v1.bak.json       # 迁移前原件，回滚就拷回来
    ├── diary.md               # 日记，按天分组
    └── session.json           # 会话状态与滚动摘要
```

`session.json` 是「这一册读到哪了」，认得这些字段：

| 字段 | 含义 |
|---|---|
| `recent` / `turn_count` / `last_ts` | 最近几轮、累计轮次、最后一次时间 |
| `mood` / `topic` | 此刻的情绪、未竟的话题（写日记时一并落盘，下一轮 L1 用） |
| `mode` | `text` 或 `text+action`，**交互模式的权威位置** |
| `intimacy` | 关系档位，五档之一：陌生 / 认识 / 熟悉 / 亲近 / 亲密 |
| `relation_log` | 档位变化留痕：`{ at, from, to, why? }`，最多 50 条，超出丢最旧 |

交互模式按 `session.json` → `_active.json` → `text+action` 的顺序解析：会话里用 `awu_mode` 切的档立刻生效，`_active.json` 只作没会话记录时的兜底。

纯 markdown / JSON，可读、可改、可备份、可迁移。不联网、不注册、不收藏数据。

### 接口安全

面板接口 `/_dsh/ai-with-u/*` 只接受本机来源：Host 必须是回环或实际监听地址，Origin 必须同源，`Sec-Fetch-Site: cross-site` 直接拒绝；写接口强制 `POST + application/json`。浏览器里任何网页都无法跨站触发删除或读取卡片。

如果确实要通过隧道/反代从别的域名访问本机 GUI，用环境变量显式放行：

```bash
AIWU_TRUSTED_HOSTS=my.tunnel.example
```

默认拒绝，不靠猜。

---

## 能力清单

### 模型工具（9 个，仅启用角色时挂载）

| 工具 | 用途 |
|---|---|
| `awu_diary_write` | 追加日记（可同时记下 `topic` / `mood`） |
| `awu_diary_read` | 读取 / 筛选日记 |
| `awu_whoami` | 查询当前身份 |
| `awu_forget` | 忘记某事（日记 + 会话 + 角色卡三处同步） |
| `awu_diary_edit` | 就地改写日记条目 |
| `awu_session_reset` | 全新开始 / 彻底重置 |
| `awu_relation` | 查关系档位依据；带 `set` 时按里程碑写回档位 |
| `awu_mode` | 切换纯文本 / 文本 + 动作 |
| `awu_opening_next` | 换一句开场 |

另有一个**条件挂载**的 `awu_card_save`：只在点「蒸馏角色卡」后的两小时内、且保存一次后自动失效。平时模型拿不到写卡能力。

### REST 接口（24 条，`/_dsh/ai-with-u/`）

```
overview  preview  characters  character  character/save  character/import  character/delete
activate  deactivate  mode  discipline  relation  relation/set  opening/next  opening/state
diary/save  diary/edit  forget  session/reset  session/commit
distill/flow  distill/arm  distill/disarm  distill/state
```

`/character` 与 `/characters` 同时返回 `card`（34 字段视图）与 `ccv3`（完整卡）；`/character/save` 收 `{ name, card?, ccv3? }`，只给 `card` 时保留既有世界书与 `extensions`。

`GET /preview` 是**纯只读**快照：返回 `{ active, mode, discipline, segments[] }`，`segments` 永远五段（`id` / `order` / `label` / `chars` / `text`；未启用角色时 `text: ''`、`chars: 0`）。文本走 `PromptController` 的真实渲染路径，不在预览里另拼一份——拼第二份等于给「预览与真实注入漂移」开口子。

> 世界书的改动**必须随 `ccv3` 发**：只发 `card` 时后端以磁盘上的旧卡为底重投影，`character_book` 按原卡保留——改动会被静默吞掉，还会提示保存成功。

`awu_relation` 的口径是「**查看不写回**」：用户只是问「关系如何」时只读档位、不改档；只有里程碑事件（第一次约定、第一次争吵、称呼改变、表白）才带 `set` 写回，并在 `relation_log` 留一条。对话里不出现「好感度 +1」这类数值。

### 面板与提示词

- **注入预览** —— 五段真实渲染的段名 / 字符数 / 正文 + 总字符，纯只读快照
- **记忆回顾** —— 日记关键词搜索、按月折叠、导出 markdown
- **导入角色卡** —— 角色簿左栏入口，吃 PNG / CHARX / JSON，先预览后落盘；世界书超限只警告不拦
- **自创角色卡** —— 三格表单落骨架卡，可选「让 AI 补全人设」（走当前会话，AI 先问 3–5 个问题）
- **世界书编辑** —— 角色卡编辑器第 11 分区，条目增删改 + 体检
- **对话模式** —— 角色簿工具栏的「纯文本 / 文本 + 动作」胶囊，点了立刻生效，不需要启用角色
- **纪律包 L0.5** —— `off` / `lite` / `full` 三档，默认 lite，偏好落盘、退出角色也保留
- **`awu_mode`** —— 对话里直接切纯文本 / 文本 + 动作，不需要回面板

---

## 开发

```bash
npm run build            # 宿主 tsc + 前端 tsc + 打包 + 九套自检（合计 784 项）
npm run verify           # 产物形状 / 新鲜度 / 孤儿产物（15 项）
npm run verify:bundle    # 客户端产物加载（9 项）
npm run verify:wiring    # 接线体检：17 组契约（42 项；后端做了前端没接 / 验收项回归）
npm run verify:tavern    # 卡格式 / 迁移幂等 / 世界书 / 软警告（254 项）
npm run verify:distill   # 蒸馏 / 补全武装与 kind（121 项）
npm run verify:import    # PNG / CHARX / JSON 导入解析（49 项）
npm run verify:session   # 会话、指令、纪律包、关系与预览只读（212 项）
npm run verify:host      # 真实 cordis 宿主装配（82 项）
npm run typecheck:client # 只查浏览器侧类型
```

`npm run build` 串的顺序是：`tsc`(宿主) → `tsc`(前端) → esbuild 打包 → `verify-bundle` → `verify-wiring` → `verify` → `verify-tavern` → `verify-distill` → `verify-import` → `verify-session` → `verify-host`。任何一项非 0 退出就整体失败。

徽章上的 784 = build 串里所有自检的通过项之和，失败项必须为 0、skip 也必须为 0（`bundle 9 + wiring 42 + verify 15 + tavern 254 + distill 121 + import 49 + session 212 + host 82`）。旧徽章的 515 用的是更窄的口径（只数六套，不含 `verify` 与 `verify-wiring`），所以数字变大不全是因为新增了断言。

`verify-wiring` 补的是其余七套查不到的盲区：**类型检查只问「类型对不对」，不问「有没有人调用」**。一个 17 KB 的世界书数据层可以零引用地躺在仓库里，一个 `POST /character/import` 可以注册完就没下文——这两种状态下 `tsc`、打包、其余自检全绿，但用户打开面板什么都看不到。脚本只做静态扫描（读源码找路由字符串与调用点），失败文案写清「缺什么 + 该找谁」。最后一组会把 `lib/prompt.js` 拿回来跟源码逐字比纪律包文本，抓「改了源码没重编」；产物不存在或比源码旧时跳过，不报红。

> 抽查 `lib/client.js` 时别用中文去 grep：esbuild 默认 `charset: ascii`，打包产物里的中文一律转成 `\uXXXX`（如「导入角色卡」= `\u5BFC\u5165\u89D2\u8272\u5361`）。功能无损，但**按字面搜中文会误判「产物里没有」**。

宿主 API 的类型直接来自 `@deepseek-ai/dsh-system-prompt` / `dsh-tools` / `cordis` 的 devDependencies，`inject`、`PromptSection`、`ToolDefinition` 都有编译期校验——契约漂移会在构建阶段报错，而不是运行时「failed 但不给原因」。

### 目录结构

```
src/            宿主侧：存储、提示词、工具、路由、格式层、导入、蒸馏
client/         浏览器侧：面板、编辑器、日记、指南、统计
scripts/        构建与自检
docs/           设计文档与开发记录（含踩坑大全）
presets/        开箱角色卡
tools/preview/  脱离宿主的面板预览沙盒
```

---

## 常见问题

<details>
<summary>会不会覆盖我 AGENTS.md 里的人设？</summary>

AGENTS.md 是以 user 角色消息注入的，插件用的是 system prompt，层级更高。L0 里显式写了边界：只让「我是谁、我怎么说话」，不让「我怎么做事」——代码规范、工程流程、安全约束照常生效。

</details>

<details>
<summary>退出后真的什么都不留吗？</summary>

五段（L0 / L0.5 纪律 / L1 / 世界书 / 时间差）在退出后都返回空串，宿主会过滤空段。`awu_*` 工具同时全部卸载。数据文件仍然在磁盘上，但不参与任何提示词组装。

</details>

<details>
<summary>为什么不能用 <code>dsh plugin</code> CLI 安装？</summary>

desktop profile 由 Electron 独占管理，CLI 会直接报 `managed exclusively by the Electron application`。按上面的 junction + profile 配置方式装。

</details>

<details>
<summary>删了角色，日记还在吗？</summary>

删除时可以选「只删卡」或「连记忆一起删」。只删卡时 `diary.md` 留在磁盘上，重新创建同名角色还能接上。

</details>

<details>
<summary>提示词到底占多少 token？</summary>

启用态约 2.8–3.3 KB 字符量级（中文按字计），未启用 0。实测：丰川祥子的卡 + lite 档，整段渲染 3286 字符。默认 lite 档的纪律包占 555 字符；切 `off` 全省，切 `full` 多 181 字符。世界书常态只注入一两百字符。重内容（卡里的详细设定、长日记）不会无条件进提示词。

</details>

<details>
<summary>为什么我的大卡能导入了，但设定只用得上一部分？</summary>

因为世界书是**按需注入**的，不是整本塞进提示词。命中预算默认 12 条 / 6000 字（`LORE_DEFAULTS`），超出预算的条目这一轮就不进上下文——卡本身一个字都没被改，磁盘上仍是完整的世界书，你在编辑器里能看到全部条目。

这是刻意的：一张 9.8 万字的世界书全量注入，要么撑爆上下文、要么每轮烧掉一大笔费用，而真正用得上的往往只有当轮提到的那几条。想提高命中率就把关键词写准、把常驻条目留给「必须一直生效」的设定。

现在导入/保存这类大书只会出警告（附实际字数与上限），不再拦你——v0.3.0 之前这里是硬拦，属于过严。

</details>

---

## 致谢

- 原项目：[ai-with-u](https://github.com/Treasure-hub-agent/ai-with-u)
- 角色卡格式：[Character Card V3](https://github.com/malfoyslastname/character-card-spec-v2)
- 宿主：[DeepSeek Harness](https://harness.deepseek.com)

## License

MIT
