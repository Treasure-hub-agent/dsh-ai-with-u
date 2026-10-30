# 开发记录与注意事项

> 本文记录 `dsh-ai-with-u` 从零到可用的完整开发过程、踩过的坑与设计取舍。
> **写给未来的自己（和任何要改这个项目的人）**：如果你想避开我们踩过的所有雷，先读完这份。
>
> 最后更新：2026-10-30

---

## 一、项目缘起

原始项目 [`ai-with-u`](https://github.com/Treasure-hub-agent/ai-with-u) 是一个**陪伴式聊天 skill**（SKILL.md + 按需加载模块），让 AI 像真人发消息一样陪聊，带角色卡、日记记忆、时间差感知。

它有 17 条指令、七字段角色卡、日记体系，但**所有确定性逻辑都交给模型自己干**——建目录、读写 JSON、追加 markdown、算索引。模型得「扮演」一个文件系统。

本次改造的目标：**把确定性逻辑收进插件代码，把不确定性（怎么写台词）留给模型。**

## 二、架构决策

### 定位（主人拍板）

> 「聊天走正常 DSH 会话，插件只管管理和查看统计」

这条定位贯穿整个设计：

| 职责 | 归属 |
|---|---|
| 角色人设、怎么说话 | 插件注入 system prompt |
| 聊天本身 | **DSH 正常会话**（不做自定义聊天 UI） |
| 建卡/改卡/删除 | 面板 + 工具 |
| 日记读写 | 工具 + 面板 |
| 查看统计 | 面板 |

### 分层注入（核心设计）

| 级别 | 何时 | 内容 | 体积 |
|---|---|---|---|
| **L0 常驻** | 总是 | 零系统痕迹铁律 + 优先级声明 | ~684 字符 |
| **L1 角色** | 启用时 | 七字段角色卡（声线优先）+ 时间差 + 最近日记 | ~1200 字符 |
| **L2 长流程** | 工具按需返回 | 蒸馏/建卡向导等长文档 | 不进系统提示词 |

对比原 skill：`SKILL.md` 13 060 字节**每轮全量注入**，现在启用态只占约 1/10。

### 插拔机制

主人要求的「插拔」有三个硬约束：**全局生效、跨重启保持、干净拔出**。

实现要点：

- `ctx.systemPrompt.section()` 在 **host 层**注册 → 进 `global` 层 → 对所有 agent 生效
- L1 段的 `text` 是**函数**，每次组装重新求值：未启用返回空串（DSH 过滤空段，等于不存在），启用返回角色卡
- 启用状态落盘 `_active.json`，启动时读回自动恢复
- `awu_*` 工具与角色**同进同出**：启用才挂载，退出即卸下

### 与 AGENTS.md 的优先级问题（重要）

主人曾问：「你有鲸鱼娘人设，这插件会不会和 AGENTS.md 冲突？」

**这是真问题。** 查明 DSH 的机制后有了答案：

- AGENTS.md 是以**普通 user 角色消息**注入的，插件用 `systemPrompt.section()` 是**系统提示词**，层级上系统 > 用户消息
- DSH 自己的模板里写着：`They do not override system, developer, or direct user instructions.`

所以**不需要改用户任何文件**，插件天然压过 AGENTS.md。

但为了稳妥，L0 里显式写了优先级声明：

- **让位的**：AGENTS.md 里的人设、自称、语气、口癖
- **照常生效的**：代码规范、项目约定、工程流程、安全约束
- **判据**：只让「我是谁、我怎么说话」，不让「我怎么做事」

> ⚠️ 曾经考虑过「启用时临时挂起 AGENTS.md §1」的方案，被否决：那是**为单机特例写的方案**——主人这台机器恰好写了人设，但新装用户可能没有 AGENTS.md，或有自己需要的规范，脚本找不到目标或误伤规范都会出事故。

---

## 三、踩坑大全（按重要性排序）

### 🔴 坑 1：`inject` 写错了服务名 → 插件卡死在 pending

**共踩了两次，两个不同的错法。**

#### 错法 A：写成对象形式

```ts
// ❌ 这样写插件永远起不来
export const inject = { required: [], optional: ['tools', 'webServer'] }
```

Cordis 的类型是 `Inject = (keyof M)[] | { name: interceptConfig }`，
**对象形式会被当成「服务名 → 拦截配置」映射**，于是插件一直等 `required`/`optional` 两个不存在的服务。

```ts
// ✅ 正确
export const inject = ['systemPrompt']
```

#### 错法 B：把 mixin 方法当服务

```ts
// ❌ effect 不是服务！
export const inject = ['slots', 'locale', 'effect']
```

报错：`pending (waiting for service: effect)`，插件卡住不往下走。

根因（`cordis/src/reflect.ts` 原文）：

```js
this.mixin('reflect',  ['get', 'set', 'provide', 'accessor', 'mixin'])
this.mixin('fiber',    ['runtime', 'effect'])
this.mixin('registry', ['inject', 'plugin'])
this.mixin('events',   ['on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])
```

`effect` 是从 `fiber` 服务上 **mixin 出来的方法**，不是服务。

| 类别 | 名字 | 写进 inject？ |
|---|---|---|
| **真服务** | `slots` `locale` `systemPrompt` `tools` `webServer` `sessions` `commands` `skills` | ✅ 必须写 |
| **mixin 方法** | `effect` `get` `set` `provide` `mixin` `on` `once` `emit` `serial` `waterfall` `inject` `plugin` `runtime` | ❌ **绝不能写** |

**口诀**：能从哪个服务上拆出来的方法，就不是服务本身。`effect` 拆自 `fiber`，`on` 拆自 `events`。

---

### 🔴 坑 2：cordis 4 的 Context 是 Proxy，读未 inject 的服务**抛错**

```js
// cordis/lib/index.js
const error = new Error(`cannot get property "${prop}" without inject`)
```

- **可选链 `?.` 兜不住 Proxy 抛错**，`if (ctx.tools !== undefined)` 这行自己就会炸
- 后果链：`waitTools()` 抛 → `waitWeb()` 不执行 → 路由全没注册 → 异常被 `.catch(()=>{})` 吞掉，零痕迹

**正解**：用 `ctx.inject(['服务名'], sub => {...})` 声明式等待，回调里服务必然已就绪。

> ⚠️ **不要用 `ctx.get()` 当探测银弹**。`get(name, strict)` 读的是**已解析依赖表**，只检查
> `fiber.state !== 2`，**并不判断该服务有没有在 inject 里声明**，对未 inject 的服务返回 `undefined`。
> 我们一度以为它是解法，后来实测证明不是。

---

### 🔴 坑 3：`web boot` 报错不给原因

现象：启动弹窗 `web boot: 1 entry did not activate` + `dsh-ai-with-u: failed`，
crash 日志里**只有结论，没有任何子插件异常**。

- **`web boot` 检查的是浏览器端 client-modules，不是宿主侧插件**
- 所以宿主 fiber 显示 `state=2`(ACTIVE) 完全不代表没事
- 状态码：`{0:pending, 1:loading, 2:active, 3:failed, 4:disposed, 5:unloading}`

**定位手段**：在 client 侧用 `console.error('[probe] ...')` 打点——crash 日志的
`renderer console (error level)` 段会完整收集，这是拿真话最快的一条路。

**从报错文案反推故障类：**

| 报错 | 含义 | 常见原因 |
|---|---|---|
| `xxx: pending (waiting for service: YYY)` | 有 fiber，卡在等依赖 | `inject` 里写了不存在的服务（含 mixin 方法）|
| `xxx: failed` | 模块导入失败 | `inject` 对象形式、`export default`、顶层 import 报错 |
| `xxx: active` 但功能不出现 | 插件活着，逻辑没跑通 | Proxy 抛错被吞、`slots.register` 早于声明 |
| 只有 `dsh-xxx: failed` 无堆栈 | 真实异常被吞 | `console.error` 打点 |

> 💡 **报 `pending` 是好信号**——说明模块能加载、前面修复都生效了，只剩依赖声明写错这一处。

---

### 🔴 坑 4：声明制插槽必须用 `slots.inject()`

UI 插槽是**声明制**：`settings.section` 由设置页 entry 在自己 `children` 表里声明，
`register()` 是**同步校验**，声明没落地就抛：

```
Error: slot "settings.section" is not declared
       (a parent entry's children table must declare it)
```

```ts
// ✅ 唯一正确入口
ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({...}, Component))
```

---

### 🟡 坑 5：Windows 上 `ln -sfn` 静默退化成目录拷贝

```bash
ln -sfn "G:/xxx" node_modules/pkg   # ❌ 不报错，但建的是实体目录拷贝
```

后果：改源码后 DSH 读的是旧副本，**修复永远不生效**，白排查。这次坑了一整个上午。

```powershell
# ✅ 用 junction
New-Item -ItemType Junction -Path '<target>' -Target '<src>'
# 验证
(Get-Item '<target>').Target
```

---

### 🟡 坑 6：`export default` 会丢 `inject`

Cordis Loader 的 `unwrapExports` 会折叠模块并丢掉 `inject`。
插件必须是 `export const name` / `export const inject` / `export function apply`，**不能有 default**。

`scripts/verify.mjs` 已加自动检查。

---

### 🟡 坑 7：空的 `.catch(() => {})` 藏住异常

层 1 的异常被它藏了整整四轮排查。**全项目禁止空 catch**，改为打印路径+原因。

---

### 🟢 坑 8：前端 CSS 的 flex 链断裂

`.awu-cardRole` 写了 `text-overflow: ellipsis` 但没生效，文字被硬裁掉连省略号都没有。
根因：父级 `.awu-cardTop` **没有 `min-width: 0` / `overflow: hidden`**，flex 子项按内容撑开，
ellipsis 没有裁切上下文。

```css
.awu-cardTop   { min-width: 0; overflow: hidden; }
.awu-cardTitle { flex: 1 1 0%; overflow: hidden; }
```

同类：**grid 子项默认 `min-width: auto`**，也会撑破容器，要显式 `min-width: 0`。

---

### 🟢 坑 9：截图不能全信

排查 UI 时，有两张「问题截图」其实是测试脚手架产物（样式表未加载的裸 HTML），差点误判。
现在的截图脚本加了**样式守卫**：样式表不完整直接拒绝截图。

**教训：报 bug 前先确认截图是不是脚手架产物。**

---

### 🟡 坑 10：`client/` 根本不在 `tsc` 里（2026-10-30 补）

接手时才发现：`tsconfig.json` 的 `include` 只有 `src/**/*.ts`、`exclude` 里还明写了 `client`，
而前端产物由 esbuild 打包——**esbuild 只转译不查类型**。于是 150 KB 的浏览器侧代码
（`index.tsx` 单文件 750 行、`styles.ts` 1 897 行模板串）全程没有类型安全网，
写错一个属性名也能进 `lib/client.js`，只在运行时炸。

修法（已落地）：

```jsonc
// tsconfig.client.json —— 只做 noEmit 校验，产物仍归 esbuild
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "strict": true
  },
  "include": ["client/**/*.ts", "client/**/*.tsx"]
}
```

`package.json` 里 `build` 现在是 `tsc(宿主) && tsc(前端) && esbuild && 三套自检`，
另有独立的 `npm run typecheck:client`。

> 💡 需要 `@types/react` / `@types/react-dom`（devDependencies）。宿主只提供 React 运行时，
> 不带类型声明；不装这两个包，`tsc` 会把 `JSX` 命名空间整个当作不存在。

**教训：构建链里「不报错」不等于「检查过」。** 转译器和类型检查器是两件事，缺哪个都要补。

---

### 🟡 坑 11：CSS 模板串里写反引号，会把样式表从中间截断（2026-10-30）

`client/styles.ts` 的 CSS 整个是一个 JS 模板串。有人在注释里写了一句
「类名一律 \`.awu-distill-*\`，不碰别人的 \`.awu-*\`」——反引号直接把模板串提前闭合，
后面几百行 CSS 被当成 JS 解析。

**报错长这样**，而且位置和真凶**不在同一处**：

```
client/distill.styles.ts(16,28): error TS2362: The left-hand side of an arithmetic operation must be ...
client/distill.styles.ts(113,28): error TS2304: Cannot find name 'parse'.
```

`TS2304` 指向的是注释里出现的 `/distill/parse` 路径片段——因为那段注释已经不在字符串里了。

**规矩**：CSS 模板串（含功能模块的 `*.styles.ts`）**一律不写反引号**。需要强调就用「」或 `*`。
这条同样适用于新手容易踩的 `${...}`：模板串里的 `${` 会被当插值求值，写 CSS 时别出现。

---

### 🟡 坑 12：portal 到 `document.body` 的元素拿不到 scoped token（2026-10-30）

`--awu-*` 定义在 `.awu-scope` / `.awu-layer` 上，但**弹层是 `createPortal` 到 `document.body` 的**，
在作用域之外 → 弹层里所有 `var(--awu-*)` 都是无效声明，背景、圆角、z-index、入场动画集体退化。

修法是把 portal 目标也纳入变量层：

```css
/* 深色（默认）与浅色两块的选择器必须逐字同步，漏一边就会出现「浅色宿主下弹层暗底亮字」 */
.awu-scope,
.awu-layer,
.awu-scrim,
.awu-dialog { ... }

html:not([data-ds-dark-theme]) .awu-scope,
html:not([data-ds-dark-theme]) .awu-layer,
html:not([data-ds-dark-theme]) .awu-scrim,
html:not([data-ds-dark-theme]) .awu-dialog { ... }
```

**教训**：用 scoped CSS 变量 + portal 时，「变量定义在哪」和「元素渲染在哪」必须对一遍。
我们第一次只补了深色块，浅色块漏了 —— 症状比原 bug 更难看（暗底亮字）。

---

## 四、当前架构

```
dsh-ai-with-u/
├── package.json          # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      # 插件行
├── tsconfig.json
├── presets/              # 3 张预置角色卡（首次启用幂等种入）
├── src/                  # 宿主侧（Node）
│   ├── index.ts          # 生命周期、服务等待、插拔联动、会话钩子
│   ├── prompt.ts         # L0/L1 分层注入、时间差档位
│   ├── store.ts          # 存储层（卡/日记/会话/索引）
│   ├── tools.ts          # 8 个 awu_* 工具
│   └── web.ts            # 16 条 REST 路由
├── client/               # 浏览器侧（React）
│   ├── entry.tsx         # 插件入口（inject/apply/slot 注册）
│   ├── index.tsx         # 面板主体
│   ├── card-editor.tsx   # 角色卡编辑器
│   ├── card-schema.ts    # 编辑器字段 schema
│   ├── styles.ts         # 「夜繭」设计语言
│   ├── api.ts            # REST 封装
│   ├── text.ts           # 文案
│   └── icons.tsx
├── scripts/
│   ├── build-client.mjs  # 前端打包（ModuleLoader 格式）
│   ├── verify.mjs        # 产物自检
│   ├── verify-session.mjs# 会话/指令自检（92 项）
│   └── verify-host.mjs   # 真实 cordis 宿主验证（14 项）
└── lib/                  # 构建产物（已 gitignore）
```

### 数据格式

```
~/.dsh/ai-with-u/               # 可用 AIWU_STORAGE_ROOT 覆盖
├── _index.json                 # 角色索引
├── _active.json                # 当前启用状态
└── characters/<角色名>/
    ├── card.json               # 七字段角色卡（中文键名）
    ├── diary.md                # 日记（按天分组）
    └── session.json            # 会话状态
```

**完全兼容原 skill 格式**，把原 `~/.ai-with-u/characters/` 拷过来就能用。

---

## 五、功能清单

### 模型工具（8 个，仅启用角色时挂载）

| 工具 | 用途 |
|---|---|
| `awu_diary_write` | 追加日记 |
| `awu_diary_read` | 读取/关键词筛选日记 |
| `awu_whoami` | 查询当前身份 |
| `awu_forget` | 忘记某事（卡+日记+会话三处同步） |
| `awu_diary_edit` | 就地改写日记条目 |
| `awu_session_reset` | 全新开始 / 彻底重置 |
| `awu_relation` | 查询关系档位依据 |
| `awu_opening_next` | 换一句开场 |

### REST 接口（16 条，`/_dsh/ai-with-u/`）

`overview` `characters` `character` `character/save` `character/delete`
`activate` `deactivate` `mode` `diary/save` `forget` `diary/edit`
`session/reset` `relation` `opening/next` `opening/state` `session/commit`

> ⚠️ `session/reset` 的 `scope:'all'`（彻底重置）**必须同时传 `confirmAll:true`**。

### 设计语言「夜繭 / Night Cocoon」

- **配色**：深夜褐黑画布 + 琥珀金 → 玫瑰金 → 烟霞粉渐变
- **字体**：衬线体承担人物感（名字/日记）、无衬线体承担工具感（按钮/数字）、等宽体只用于日期
- **动效**：一档缓动 `cubic-bezier(.22,.61,.36,1)`，卡片错峰升起、启用态呼吸辉光
- **入口**：左侧栏底部（`sidebar.footer.action`），宽态显示「角色管理 + 角色名」，收起态自动收成 36px 圆徽

---

## 六、开发与构建

```bash
npm install
npm run build          # tsc(宿主) + tsc(前端类型) + 前端打包 + 三套自检
npm run build:host     # 只编宿主
npm run build:client   # 只打包前端
npm run typecheck:client # 只查前端类型（noEmit）
npm run verify         # 产物自检
npm run verify:session # 会话/指令自检
npm run verify:host    # 真实 cordis 宿主验证
```

> ⚠️ `build:client` 只打包、不查类型；改完前端务必跑 `npm run typecheck:client`（或直接 `npm run build`）。

### 安装到 DSH（desktop profile）

desktop profile 由 Electron 独占，**不能用 `dsh plugin` CLI**（会报 `managed exclusively by the Electron application`）。

```powershell
# 1. 建 junction（不要用 ln -sfn！）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ai-with-u" `
  -Target "D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u"

# 2. package.json 的 dependencies 加 link:，bundles 加 dsh-ai-with-u
#    "dsh-ai-with-u": "link:D:/CODEX/deepseek-work/01-projects/dsh-ai-with-u"

# 3. 让 pnpm-lock 与 package.json 对齐（只改锁、不动 node_modules）
pnpm install --lockfile-only --prefer-offline

# 4. 重启 DSH（宿主不会热加载 lib/index.js）
```

> ⚠️ `cordis.patch.yml` **不需要**手写插件行——包内 `cordis.patch.yml` 的 `bundle.patch` 会自动挂载。
> 手写重复行反而干扰故障定位。

> 💡 用 `link:` 而不是 `file:`：`file:` 在 hoisted 模式下可能落成**实体拷贝**（坑 5 的同类），
> 改源码后看不到效果；`link:` 是 junction，`npm run build` 一跑，宿主下次加载就是新代码。

---

## 七、后续可做

| 项 | 说明 |
|---|---|
| **改名功能** | 涉及目录重命名，需后端加 `POST /character/rename {from, to}` |
| **蒸馏角色** | 从作品提取角色，原 skill 的六 Phase 流水线，工作量大 |
| **PNG/CHARX 导入** | 酒馆卡的 `tEXt` chunk 解析 |
| **一键导入原 skill 数据** | 格式已兼容，缺个导入按钮 |
| **淡入淡出动画细化** | 目前动效已有，可继续打磨 |

---

## 八、致谢与教训总结

**最重要的一条**：这个项目第一版启动失败了 **7 次**，排查 **1h45m**，根因是 3 个独立缺陷串联 + 1 个 Windows 环境坑。
后来新代码又引入第 4 个（mixin 当服务），又被修复。

**共性教训**：

1. **报错不给原因时，自己埋探针**——别指望宿主管家
2. **`pending` 和 `failed` 是两类问题**，先从文案反推
3. **不要盲信第一直觉**——卡片贴边框我以为是 padding，实际是 flex 链断
4. **截图要先验证完整性**——烂脚手架会骗你
5. **插件开发的大部分坑都在「声明与实际的错位」**：声明了不存在的服务、没声明的服务却去读、插槽没声明就去注册

---

## 九、接手记录（2026-10-30，v0.1.0 → 待发 0.1.1）

接手时做了一轮全量源码勘察（宿主 4 文件 + 前端 8 文件），报告在
`D:\CODEX\deepseek-work\06-tmp\aiwu-survey\host.md` 与 `client.md`（31 + 17 条风险，带行号）。
本机安装位置：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u`，桌面 profile 用 `link:` + junction 挂载。

### 这一批改了什么

| 改动 | 文件 | 为什么 |
|---|---|---|
| 补 `tsconfig.client.json` + `typecheck:client`，`build` 串进去 | `tsconfig.client.json`（新）、`package.json` | 前端 150 KB 代码原本零类型检查（坑 10） |
| 加 `@types/react` / `@types/react-dom` | `package.json`（devDependencies） | 不装则 `JSX` 命名空间不存在，`tsc` 直接报错 |
| 404 语义分开：只有「响应体不是 JSON 信封」才判 `ApiUnavailableError` | `client/api.ts` | 原本角色被删也被提示成「宿主侧尚未提供该能力」，重试永远打同一个死地址 |
| 详情加载失败 → 空态 + 重试，不再永久骨架屏 | `client/index.tsx`、`client/text.ts` | 清 `detailError` 前，失败后 `detail` 为 `undefined`，`loading=false` 也只会渲染 `<Skeleton />` |
| 文档同步 | `README.md`、本文件 | 安装路径 / 命令 / 坑 10 |

### 还没修的（按优先级，接管者从这里起手）

1. **写盘无互斥**（`src/store.ts:249-257 / 356-367 / 418-441`）：`atomicWrite` 只防写坏，不防丢更新；两个会话并发 `agent/turn-stopping` 会互相覆盖 `turn_count` / `recent`。建议给 `Store` 加一把按角色名的串行队列。
2. **`diary.md` 写入器会丢内容**（`src/store.ts:369-384`）：整文件重写抹掉 `- ` 前缀与自定义标题；`date` 为空时写出永远解析不到的块。写入前应先校验 `date`、解析器与生成器对齐。
3. **路由 `method` 是装饰品**（`src/index.ts:208-214`）：`webServer.register` 本身只有 `{kind,path,handler}`，同机 dsh-pet / dsh-whale-game 都在 handler 里自己看 `req.method` 分发。要么照做，要么把 `web.ts` 里的 `method` 字段删掉免得误导。
4. **`commitTurn` 默认 mode 会篡改用户选择**（`src/store.ts:436`）：`/session/commit` 不传 mode 时，`_active.json` 的 `text` 会被写成 `text+action`。
5. **`prompt.refresh` 的串行化是坏的**（`src/prompt.ts:301-307`）：A 的 `finally` 会无条件清掉 B 的登记，第三轮起并发。
6. **保存角色卡会静默删空分组**（`client/card-schema.ts:283-285`）：新建角色只填 `basic`，动一个字段保存就丢掉 `personality` / `relationship` / `voice` 三个空组。
7. **`openingNote` 只写不读**（`client/index.tsx:892` 声明、`1133-1138` 赋值、全文件无渲染）：「换一句开场」没有任何反馈。
