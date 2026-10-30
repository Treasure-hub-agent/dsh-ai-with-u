# dsh-ai-with-u · 角色扮演管理器

> 由 [AI-WITH-U](https://github.com/Treasure-hub-agent/ai-with-u)（原 skill 形态）改造而来的 **DeepSeek Harness 插件**。
>
> **选一张角色卡点「启用」，人设即插即用；点「退出」干净拔出，完全不影响正常工作。**

---

## 它解决什么问题

原 `ai-with-u` 是个 skill，所有确定性逻辑都让模型自己干——建目录、读写 JSON、追加 markdown、算索引。模型得「扮演」一个文件系统，不稳定。

这个插件把**确定性逻辑收进代码**，只把「怎么写台词」留给模型。同时把 13 KB 的提示词压缩到启用态约 1.8 KB。

| | 原 skill | 本插件 |
|---|---|---|
| 提示词 | `SKILL.md` 13 060 字节，**每轮全量注入** | L0 底线 ≈0.37K（仅启用时）+ L1 角色 ≈1.1K + 世界书命中（典型 ≈0.2K） |
| 文件读写 | 模型自己做 | 插件代码保证 |
| 角色管理 | 对话里说指令 | **可视化面板** |
| 时机控制 | 一直生效 | **可插拔** |

---

## 核心特性

### 🔌 真·插拔

启用 → 人设注入 system prompt，**全局生效，新开旧会话都算**；退出 → 干净拔出，零残留。

- 启用状态落盘，**重启 DSH 自动恢复**
- `awu_*` 工具与角色**同进同出**：启用才挂载，退出即全部卸下
- 退出后**系统提示词里一个字都不留**（连 L0 底线一起撤），和没装插件一样

### 🎭 分层按需注入

| 级别 | 何时 | 内容 |
|---|---|---|
| **L0 底线** | 启用时 | 零系统痕迹铁律 + 优先级声明（约 370 字符，退出即消失）|
| **L1 角色** | 启用时 | 酒馆卡 CCv3 渲染（声线优先）+ 时间差档位 + 最近日记（实测 ≈1.05–1.15K 字符）|
| **世界书** | 命中时 | `character_book` 条目按关键词命中注入；常量条每轮都在，其余未命中零成本（典型 ≈0.2K 字符）|
| **L2 长流程** | 工具按需 | 蒸馏/建卡向导等长文档，不进系统提示词 |

### 📖 世界书按需注入

- **常规人设常驻**（`description` / `personality` / `scenario`），详细设定放世界书
- 命中才注入：关键词（含 `use_regex`）、`constant` 常驻、`selective` + 次级关键词
- 默认预算 **12 条 / 6000 字符**——实测常态根本用不满（典型只注入 168 字符，约 L1 的 11%），它的作用是防爆炸而不是常态成本
- 同一轮多次组装复用结果，**不重复注入、不跨轮累积**
- 易变内容排在系统提示**最后一段**，把缓存失效率降到最小

### ⚖️ 与 AGENTS.md 共存，不冲突

DSH 的 `AGENTS.md` 是以 **user 角色消息**注入的，插件用的是 **system prompt**，层级上天然更高。因此插件**不需要修改用户任何文件**，新装用户开箱即用。

L0 里显式声明了边界：

- **让位的**：AGENTS.md 里的人设、自称、语气、口癖、性格设定
- **照常生效的**：代码规范、项目约定、工程流程、安全约束
- **判据**：只让「我是谁、我怎么说话」，不让「我怎么做事」

### 🎨 「夜繭 / Night Cocoon」设计语言

不是 DSH 皮肤的换色，是独立视觉体系：

- 深夜褐黑画布 + 琥珀金 → 玫瑰金 → 烟霞粉渐变
- 衬线体承担人物感（名字/日记）、无衬线体承担工具感（按钮/数字）、等宽体只用于日期
- 一档缓动贯穿全部动效，卡片错峰升起、启用态呼吸辉光
- 支持浅色模式与 `prefers-reduced-motion`

### 📔 日记无感记忆

- 模型静默把值得记的事追加进日记，正文零痕迹
- 「忘记某事」= 角色卡 + 日记 + 会话摘要**三处同步清理**，角色真的不再提
- 「改日记」就地改写，不动同段其他条目

---

## 界面

入口在**左侧栏底部**（与用量统计插件同席位）：

- **展开态**：`角色管理` + 当前角色名 + 呼吸状态灯
- **收起态**：自动收成 36px 圆徽
- 点击弹出**悬浮面板**

三个分区：**角色簿**（卡片墙 / 详情 / 直接编辑）、**日记**（时间线 / 逐条改写 / 危险区）、**统计**。

### 角色卡编辑器

详情页可直接编辑**全部 10 个分组、34 个字段**：

- 字段是中文键名，原样保留
- **声线基因**有金色描边 +「灵魂字段」徽记（原 skill 标记的灵魂字段）
- 6 个数组字段配了增删改列表编辑器
- 以原卡为底**浅合并**，schema 之外的键原样保留
- 清空字段 = 删键，不写空串污染卡片
- 有改动关闭会二次确认

---

## 安装

### 前提

- DeepSeek Harness（desktop profile）
- desktop profile 由 Electron 独占，**不能用 `dsh plugin` CLI**（会报 `managed exclusively by the Electron application`）

### 步骤

```bash
# 1. 克隆与构建
git clone <repo> dsh-ai-with-u
cd dsh-ai-with-u
npm install && npm run build
```

```powershell
# 2. 建 junction（Windows 上不要用 ln -sfn，它会静默退化成目录拷贝）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ai-with-u" `
  -Target "<你的克隆路径>"
```

3. 编辑 `~/.dsh/profiles/desktop/package.json`：

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

4. **重启 DSH**（宿主不会热加载 `lib/index.js`）

> ⚠️ 不要在 profile 的 `cordis.patch.yml` 里手写插件行——包内 `cordis.patch.yml` 的 `bundle.patch` 会自动挂载，重复写反而干扰故障定位。

---

## 使用

1. 左侧栏底部点「角色管理」
2. 选一张卡点「启用」
3. 开个新会话，像给老朋友发消息一样聊
4. 不想玩了点「退出」，一切恢复原样

**开箱自带 3 张预置角色卡**，首次启用时幂等种入（`characters/` 已存在则跳过，绝不复活你删掉的卡）。

### 兼容旧卡与酒馆卡

- **旧 34 字段卡**：直接放进 `characters/<名>/card.json` 即可，插件**读时自动归一**成酒馆卡 CCv3，首次保存时才落成新格式并留下 `card.v1.bak.json`（回滚就是拷回来）
- **酒馆卡导入**：支持 `.png`（`tEXt` 的 `ccv3` / `chara` chunk）、`.charx`（zip 里的 `card.json`）、裸 `.json`（CCv2 会自动升到 V3）
- ⚠️ 已有角色时**纯拷目录**不会自动进索引（未做一键导入），可以用面板的导入入口

---

## 数据存储

默认 `~/.dsh/ai-with-u/`（可用环境变量 `AIWU_STORAGE_ROOT` 覆盖）：

```
~/.dsh/ai-with-u/
├── _index.json                # 角色索引
├── _active.json               # 当前启用状态
└── characters/<角色名>/
    ├── card.json              # 酒馆卡 CCv3（旧 34 字段卡读时自动归一）
    ├── card.v1.bak.json       # 迁移前的原件（回滚用，只在首次落盘后出现）
    ├── diary.md               # 日记（按天分组）
    └── session.json           # 会话状态
```

**记忆是你的**：纯 markdown / JSON，可读、可改、可备份、可迁移，不上云不注册。

---

## 能力清单

### 模型工具（8 个，仅启用角色时挂载）

| 工具 | 用途 |
|---|---|
| `awu_diary_write` | 追加日记 |
| `awu_diary_read` | 读取/筛选日记 |
| `awu_whoami` | 查询当前身份 |
| `awu_forget` | 忘记某事（三处同步清理）|
| `awu_diary_edit` | 就地改写日记条目 |
| `awu_session_reset` | 全新开始 / 彻底重置 |
| `awu_relation` | 查询关系档位依据 |
| `awu_opening_next` | 换一句开场 |

### REST 接口（18 条，`/_dsh/ai-with-u/`）

`overview` `characters` `character` `character/save` `character/delete` `character/import`
`activate` `deactivate` `mode` `diary/save` `forget` `diary/edit`
`session/reset` `relation` `opening/next` `opening/state` `session/commit` `distill/flow`

> `/character` 与 `/characters` 同时返回 `card`（旧 34 字段视图，编辑器用它）与 `ccv3`（完整酒馆卡）；
> `/character/save` 收 `{ name, card?, ccv3? }` —— 只给 `card` 时保留既有世界书与 `extensions`，只给 `ccv3` 时反推结构。

---

## 开发

```bash
npm install
npm run build            # tsc(宿主) + tsc(前端类型) + 打包 + 五套自检
npm run verify           # 产物自检（导出形状 / inject 形式 / 产物新鲜度）
npm run verify:tavern    # 酒馆卡格式 / 迁移幂等 / 世界书命中与预算（186 项）
npm run verify:import    # PNG / CHARX / JSON 导入解析（47 项）
npm run verify:session   # 会话与指令自检（94 项）
npm run verify:host      # 真实 cordis 宿主验证（19 项）
npm run typecheck:client # 只查浏览器侧类型（tsconfig.client.json，noEmit）
```

**详细开发记录与踩坑大全见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)**——包含 9 个真实踩过的坑、架构决策理由、以及给未来维护者的忠告。

---

## 技术栈

- **宿主侧**：TypeScript / Node 22+ / Cordis 4 插件框架
- **浏览器侧**：React 18/19（宿主提供）/ esbuild 打包为 `window.__ModuleLoader__` 格式
- **零原生依赖**（无 C++ 编译需求）

---

## License

MIT · 原项目 © 2026 [Treasure-hub-agent](https://github.com/Treasure-hub-agent/ai-with-u)