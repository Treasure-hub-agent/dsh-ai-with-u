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

| 级别 | 何时 | 内容 | 体积（静态字数） |
|---|---|---|---|
| **L0 底线** | 启用期间 | 优先级声明 + 扮演底线（「只让我是谁、不让怎么做事」） | 365 字符（退出即消失） |
| **L0.5 纪律包** | 启用期间，按档位 | 真人感纪律：禁止词库 / 消息形态 / 动作 / 输入识别 / 内容边界 / 指令确认 | lite 555、full 736，`off` 为 0 |
| **L1 角色** | 启用期间 | 酒馆卡 CCv3 渲染（声线优先）+ 最近日记 + 会话摘要 | 约 1.9–2.4K，随卡增长 |
| **世界书** | 命中才注入 | 关键词 / 常驻条目，12 条 · 6000 字预算 | 典型约 0.2K |
| **时间差** | 启用期间 | 隔多久了、该用什么语气接上 | 每轮随分钟数变，垫底 |
| **L2 长流程** | 工具按需返回 | 蒸馏 / 建卡向导等长文档 | 不进系统提示词 |

> v0.2.0 把「世界书命中」从 L1 里拆成了独立段（order 10300，时间差 10350 垫底）：易变段越靠后，
> 缓存失效范围越小；混在 L1 里会导致每轮命中变化就把整段 L1 重新计费。
> L0.5 纪律包是 2026-10-31 加的（见 §十），order 5050，夹在 L0 与 L1 之间。

对比原 skill：`SKILL.md` 13 KB 每轮全量注入；本插件启用态实测 **3286 字符**（丰川祥子 + lite 档，`verify-host` 量的），未启用时为 0。

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

> ⚠️ **`ctx.get()` 能探测服务，但它不看 inject**（cordis `reflect.ts`：`get()` → `_getImpl()` 只查
> isolate 映射与 store，不校验声明）。未激活的服务返回 `undefined`，所以「就绪没」可以探测；
> 但**声明式 `ctx.inject([...], cb)` 仍然更稳**——宿主会等依赖，不需要我们自己轮询。

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

`package.json` 里 `build` 现在是 `tsc(宿主) && tsc(前端) && esbuild && 九套自检`，
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

### 🔴 坑 13：宿主会对段文本做 `{{var}}` 插值，未知变量**直接抛错**（导入即崩）

`@deepseek-ai/dsh-system-prompt@0.2.1-rc.5` 的组装代码：

```js
// lib/index.js:118 —— 只有显式 false 才豁免
return assembly.sections.map((s) => s.interpolate === false ? s.text : interpolate(s, assembly.variables, "section"))
// lib/index.js:158
if (!Object.hasOwn(variables, name)) throw new Error(`unknown prompt variable "{{${name}}}" ...`)
```

CCv3 卡里 `{{char}}` / `{{user}}` 是通用写法 ⇒ 不关插值 = **启用该角色后整轮对话进不去**
（不是显示成字面量，是请求失败）。调研员用 rc.5 实跑验证过：
① 不传 `interpolate` → THROW `unknown prompt variable "{{char}}"`；② `interpolate:false` → OK；
③ 注册同名变量 → OK（证明是变量表查找，不是黑名单）；
④ **`{{Char}}` 大写变体同样 THROW `malformed`**；⑤ 孤立 `{{` 不闭合反而不抛。

**修法**：`host.sys.section({ name, order, text, interpolate: false })` —— **每一段都要传**；
再由 `tavern.expandMacros` 处理：认识的展开（char/user/random/pick/roll/注释），
**不认识的 `{{xxx}}` 原样保留、绝不抛错**。宏层**大小写敏感**（只认规范小写）。

**回归网**：`scripts/verify-host.mjs` 断言任何 `aiwu:*` 段 `interpolate !== false` 就红；
`verify-tavern` 的 V20 覆盖未知宏 / 未闭合 / 大写变体 / `\,` 转义 / `roll` 三种写法。

### 🔴 坑 14：易变段放前面 = 每轮把后面全部缓存烧掉

宿主文档（`dsh-system-prompt/README.zh.md:152-154`）：头节点重写会从首个变化的 token 起失去前缀复用。
所以「每轮都会变」的内容要**垫底**。反面教材：有社区插件把每轮都变的世界书段放 `order: -999999`（最前），
等于每轮全废；另一家专门写了「缓存安全改道」机制来绕这件事。

我们的四段位见 §四「v0.2.0 数据格式」。另外**没有**用 `systemPrompt.context()`：它确实能落到消息数组末尾，
但会以 `source.kind='runtime-context'` 的 **user 消息落进会话表面**，与 L0 的「零系统痕迹」冲突。

---

## 四、当前架构

```
dsh-ai-with-u/
├── package.json          # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      # 插件行
├── tsconfig.json
├── presets/              # 3 张范例角色卡（蒸馏产出的 IP 卡，CCv3；首次安装幂等种入）
├── src/                  # 宿主侧（Node）
│   ├── index.ts          # 生命周期、服务等待、插拔联动、会话钩子
│   ├── prompt.ts         # L0/L1 分层注入、时间差档位
│   ├── store.ts          # 存储层（卡/日记/会话/索引）
│   ├── tools.ts          # 8 个 awu_* 工具
│   └── web.ts            # 21 条 REST 路由
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

### v0.2.0 数据格式（CCv3）

> 上面那段是 **v0.1 的形态**，保留不动——它描述的中文键视图**仍在使用**（`Store.readCard()` 返回的就是
> 旧 34 字段视图，面板 / 工具 / 旧自检全都按它读）。变的只是**落盘格式**：CCv3。

```
~/.dsh/ai-with-u/
├── _index.json                  # 角色索引（结构不变）
├── _active.json                 # 启用状态（结构不变）
└── characters/<角色名>/
    ├── card.json                # 酒馆卡 CCv3（spec: chara_card_v3）
    ├── card.v1.bak.json         # 旧格式原件（首次迁移写一次，回滚用）
    ├── diary.md                 # 日记（不变）
    └── session.json             # 会话状态（不变）
```

**四条规则（改存储前先读这四条）**

1. **读时归一**：盘上是旧 34 字段卡也能读（`tavern.normalizeCard` 在内存里补成 CCv3），
   只有真正写盘时才落 CCv3。所以旧卡不会在「某次升级后凭空消失」；
   `card.v1.bak.json` 是回滚兜底（`Copy-Item` 回去 + 重启即可，读时归一永远兼容旧格式）。
2. **结构权威、原生投影**：34 字段结构存 `data.extensions.aiwu`；原生字段
   （`description` / `personality` / `scenario` / `system_prompt` / `post_history_instructions` /
   `first_mes` / `alternate_greetings`）由结构**单向**生成，原生**不反写**结构。
   外部导入卡走 `aiwu.imported.raw` 保真（L1 优先用原文，用户一改就转结构权威）。
   > 为什么单向：双向同步必然打架；实测同一份内容两种写法，L1 每段**只选一个来源渲染**，
   > 所以文件 +42% 但 L1 反而略小（见 §九 v0.2.0）。
3. **保存契约 C7 三键**：`Store.saveCard({ name, card?, ccv3? })` ——
   `card` 是旧视图（编辑面，给了就重投影原生）、`ccv3` 是原始对象（世界书从这里走）；
   `extensions.aiwu` 没被覆盖的键、`character_book`、别人的 `extensions.*` **一律原样保留**。
   写入口只有 `fromLegacyView`（结构 → 卡），不做"原生反解析回结构"（导入时那次 `deriveFromNative` 例外）。
4. **`presets/*/card.json` 现在是 CCv3**（蒸馏产出的范例卡）。**旧 34 字段卡的迁移回归改用 `scripts/fixtures/legacy-cards/`**：
   之前一段时间 presets 故意保持旧格式，让每次全新安装都真跑一遍迁移；2026-10-30 换范例卡后，
   迁移样本移到 fixtures（`verify-tavern` 的 PRESETS 从那里读），产品预置与测试夹具就此分离。
   ⚠️ 换预置卡时记得同步检查夹具：`verify-host` 曾把 `虞照` 写死在启用断言里，换卡后 5 条断言全红，
   而报错看起来像「L0 坏了」——已经改成从 `presets/` 取第一张，不再写死名字。

**四个提示词段位（v0.2.0 起；`src/prompt.ts`）**

| order | 段名 | 内容 | 易变度 |
|---|---|---|---|
| 5000 | `aiwu:baseline` | L0 底线（**启用时才注入**，`renderBaselineSection`；未启用返回空串） | 启用时才注入（退出即消失） |
| 5100 | `aiwu:active-character` | 酒馆卡渲染 + 会话摘要 + 日记 + 交互模式 + 关系口径 + 收尾提醒 | 每轮（会话写盘后） |
| 10300 | `aiwu:lore` | 世界书命中（关键词 + 预算） | 命中集合变才变 |
| 10350 | `aiwu:clock` | 距上次互动 + 当前时间 | 每分钟 |

易变段**垫底**的理由：宿主文档（`dsh-system-prompt/README.zh.md:152-154`）说头节点重写会从首个变化的 token
起失去前缀复用 —— 把每分钟都变的内容放最前，等于每轮把后面的缓存全烧掉（坑 14）。
表述纪律：按宿主文档这是**失效范围最小**的摆法，**不承诺**实际命中率。

**格式层的三个入口（都在 `src/tavern.ts`，纯函数零 IO）**

| 函数 | 用途 |
|---|---|
| `normalizeCard(input)` | 任意输入（V3 / V2 / 旧 34 字段 / 无法识别）→ 规范 CCv3；`migrateLegacyCard` 是它的旧格式分支 |
| `renderL1(card, extras)` | 卡 + 外部段落 → L1 文本（顺序：静态 → 世界书 → 时间差 → 会话 → 日记 → 模式 → 关系 → 收尾） |
| `selectLoreEntries(book, texts, opts)` | 世界书命中（含预算/去重/四值 selective/稳定哈希 probability），返回文本 + `diag` |

设计全文：`docs/design/2026-10-30-tavern-card.md`；社区对照与坑：`06-tmp/tavern-study/REPORT.md`。

---

## 五、功能清单

### 模型工具（9 个，仅启用角色时挂载）

| 工具 | 用途 |
|---|---|
| `awu_diary_write` | 追加日记（可同时落 `topic` / `mood`） |
| `awu_diary_read` | 读取/关键词筛选日记 |
| `awu_whoami` | 查询当前身份 |
| `awu_forget` | 忘记某事（卡+日记+会话三处同步） |
| `awu_diary_edit` | 就地改写日记条目 |
| `awu_session_reset` | 全新开始 / 彻底重置 |
| `awu_relation` | 查询关系档位依据；带 `set` 时按里程碑写回 |
| `awu_mode` | 切换纯文本 / 文本 + 动作 |
| `awu_opening_next` | 换一句开场 |

### REST 接口（23 条，`/_dsh/ai-with-u/`）

`overview` `characters` `character` `character/save` `character/import` `character/delete`
`activate` `deactivate` `mode` `discipline` `relation` `relation/set`
`opening/next` `opening/state` `diary/save` `diary/edit` `forget`
`session/reset` `session/commit` `distill/flow` `distill/arm` `distill/disarm` `distill/state`

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
npm run build          # tsc(宿主) + tsc(前端类型) + 前端打包 + 九套自检（合计 720 项）
npm run build:host     # 只编宿主
npm run build:client   # 只打包前端
npm run typecheck:client # 只查前端类型（noEmit）
npm run verify         # 产物自检（15 项）
npm run verify:wiring  # 接线体检（18 项）
npm run verify:session # 会话/指令自检（184 项）
npm run verify:host    # 真实 cordis 宿主验证（55 项）
```

> ⚠️ `build:client` 只打包、不查类型；改完前端务必跑 `npm run typecheck:client`（或直接 `npm run build`）。

> **v0.2.0 追加**（上面的命令一条没少，只是 `build` 串的自检变多了）：
> `npm run build` 现在依次跑 **产物自检 → `verify-tavern`(218 项) → `verify-import`(49 项) → `verify-session`(184 项) → `verify-host`(55 项)**，
> 另有独立入口 `npm run verify:tavern` / `npm run verify:import`。

> **2026-10-31 追加**：`verify-bundle`(9 项) 与 `verify-wiring`(18 项) 也进了 `build` 串，位置在 `verify-bundle` 之后；
> 九套合计 **720 项**（截至 v0.3.0 验收轮）。README 徽章按这个口径计（旧徽章的 515 只数六套，不含 `verify` 与 `verify-wiring`）。

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
| ~~**蒸馏角色**~~ | ✅ 已做（`src/distill.ts` + `awu_card_save` + 面板 CTA，`verify-distill` 121 项） |
| ~~**PNG/CHARX 导入**~~ | ✅ 已做（`src/import-card.ts` + 面板「导入角色卡」，`verify-import` 49 项） |
| ~~**一键导入原 skill 数据**~~ | ✅ 已覆盖：`characters/` 下旧格式卡读时自动归一；外部卡走「导入角色卡」 |
| **淡入淡出动画细化** | 目前动效已有，可继续打磨 |
| **真机点击链路回归** | 导入 → 预览 → 覆盖 → 世界书编辑 → 保存回读，目前只有静态/单元级自检覆盖 |

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

### v0.2.0（CCv3）—— 格式层重做 + 世界书按需注入（tavern-architect）

设计全文 `docs/design/2026-10-30-tavern-card.md`（含 34 字段逐字段映射、完整样例、验收清单）。

| 改动 | 文件 | 为什么 |
|---|---|---|
| 新增格式层：识别 / 归一 / 迁移 / 投影 / 渲染 / 世界书 / 宏 / 忘却 / 长度告警 | `src/tavern.ts`（新，约 1800 行） | 纯函数零 IO，能脱离宿主单测（`verify-tavern` 218 项） |
| `card.json` 落 CCv3、读时归一、首次迁移写 `card.v1.bak.json` | `src/store.ts` | 无损导入导出；旧卡不会消失；可一条命令回滚 |
| 保存契约 C7 三键 `{name, card?, ccv3?}` | `src/store.ts` + `src/web.ts` | 结构权威、原生投影；`character_book` / 别人的 extensions 不被洗掉 |
| **`readCard()` 仍返回旧 34 字段视图**，完整对象走 `readCcV3()` | `src/store.ts` | 面板 / 工具 / 92 项旧自检零改动（Lead 决策 A）；内部一律 `readCcV3` |
| L1 改由 `tavern.renderL1` 渲染；**删掉**旧的 `renderCharacterCard` | `src/prompt.ts` | 两套渲染并存 = L1 token 翻倍 |
| 提示词拆四段 + **全部 `interpolate:false`** | `src/prompt.ts` | 坑 13 / 坑 14 |
| 世界书按需注入（关键词 + 12 条 / 6000 字预算 + 四值 `selectiveLogic` + 稳定哈希 `probability` + Unicode 整词边界 + 同轮防抖） | `src/tavern.ts` | 调研四家社区实现后定稿（`REPORT.md` §4.3） |
| 导入接口 `POST /character/import`（16 MB、按魔数判格式、预览不落盘） | `src/web.ts` | 带立绘的 PNG 卡常 3–10 MB，原 4 MB 上限会让好卡直接进不来 |
| **P0：写盘按角色串行**（`Store.locked`，跨角色并行） | `src/store.ts` | `atomicWrite` 只防半个文件，防不了「读-改-写」丢更新（host.md P0-2） |
| **P0：损坏文件走 `.corrupt-*` 备份且不删索引** | `src/store.ts` | 原来 JSON 坏了当"不存在"，`ensureIndex` 会把卡从列表剔除 = 卡凭空消失（host.md P0-23） |
| 忘却改成「全卡按句手术」：遍历 `aiwu` 整棵树 + 世界书 + 外部原文 + 开场白，返回 `scanned` 计数 | `src/store.ts` + `src/tavern.ts` | 旧实现只认 `memory_anchor`/`dynamic_state` 两个键，迁 CCv3 后会**提示成功、一个字没删** |
| 顺手修：`commitTurn` 的 turnId 去重从**单字段**改成按角色 Map | `src/store.ts` | 多角色并发时共用一个字段会互相踩掉去重 |
| **L0 底线改为「与角色同进同出」**：`aiwu:baseline` 的 text 改成函数，未启用返回空串；文案 684 → **365 字**（删掉「何时让位给任务模式」整节） | `src/prompt.ts` | 原来无条件下常驻且在没启用时也写着「当前对话启用了角色扮演」= 假话；还与「退出即零残留」自相矛盾 |
| 新增 `scripts/verify-tavern.mjs`（218 项）并串进 `npm run build` | `scripts/`、`package.json` | 格式 / 迁移幂等 / 34 字段零丢失 / 世界书 / 忘却 / 并发写盘 / 四段装配 |

**实测（预置三张卡）**

- 文件：旧卡 2021 B → CCv3 2871 B（**+42%**，双写投影的代价）
- L1：旧渲染 1107 字 → 新 L1 实测 1.9–2.4K 字（含收尾提醒与信任边界声明），**静态块 1.3–1.7K 字**——文件变大但 L1 没变大，
  因为原生投影与结构是同一份内容，每段只选一个来源渲染
- 内容保真：旧卡 42 条文本字段**零丢失**
- 世界书成本：虞照 + 10 条真实世界书，典型对话命中 4 条、注入 **168 字**（L1 的 11%），
  6000 字预算是防爆炸不是常态成本

**还没做的（接手者从这里起手）**

1. **`assets` 立绘落地**：导入时一律剥掉并告警（`import-card.ts`），要显示立绘得先定"存在哪、怎么引用"。
2. **世界书递归激活**：`recursive_scanning` 字段认了但不执行（收益低、放大预算风险，报告 §4.3.3）。
3. **`lore_lookup` 查询工具**：条目涨到几百条、预算装不下时再谈（需要挂常驻工具，主人已否）。
4. **会话隔离**：仍是全局单角色（`_active.json` 一个 `character`）；两个会话同时启用**同一个角色**会写同一份
   `session.json`（写盘已串行，但语义上是同一份会话）。

---

## 十、2026-10-31 · 手感轮（纪律包 L0.5 / mode 权威 / 亲密度落盘）

v0.2.0 把格式层（CCv3 + 世界书）重做完了，但「聊起来像不像人」还是原 skill 的那几个老毛病：会回「作为一个 AI 我无法…」、
一段回复写得像文档、动作符号与台词糊在一起。这一轮只补手感，不动格式层。

### 纪律包为什么独立成段（order 5050）

| 问题 | 结论 |
|---|---|
| 现状是什么 | L0 只有 365 字「让位边界」；原 skill 的六块纪律（禁止词库 / 消息形态 / 动作 / 输入识别 / 内容边界 / 指令确认）一个字都没有 |
| 为什么不并进 L0 | L0 是「让不让位」的元规则，尺寸固定；纪律包长度随档位变（off 0 / lite 555 / full 736）。并在 L0 里 = 选 lite 的人一直为 full 的 token 付费，且换角色时会连带重算这段预算 |
| 为什么 order 5050 | DSH 第一方段落在 −1000..10200，外部段用 5000+。5050 夹在 `baseline`(5000) 与 `active-character`(5100) 之间：排在底线之后（先立让位边界）、角色卡之前（行为纪律先于具体人设），且早于每轮都变的日记 / 世界书(10300) / 时间差(10350)，缓存失效范围最小 |
| 为什么三档 | `off` 给不想被管的人；`lite` 默认，纯负面约束只压 AI 腔；`full` 多两段（语态锚点 + 每 10 轮日记自检），适合长期养角色的人。三档共用同一份公共文本：`DISCIPLINE_FULL_TEXT = DISCIPLINE_TEXT + 新增两段`，以后改禁止词库不会「改了 lite 忘了 full」 |
| 为什么不写正例台词 | `human_chat_guide` 的原话：正例会被模型当模板抄，角色的声线就死了。只给负面清单与短口径 |

静态字数（按源码字面量数，不含运行时插值）：lite **555 字符**、full **736 字符**（full = lite + 181），都低于 900 / 1400 的上限，留了改文案的余量。
未启用角色或 `level='off'` 时该段返回空串（和其余四段同一套「干净拔出」逻辑）。

### mode 的权威位置从 `_active.json` 迁到 `session.json`

- **旧实现的病**：`mode` 只在 `_active.json`，是全局的。`/mode` 一写，同一角色的所有会话一起被改——「这一次对话用纯文本」根本无法表达。
- **新解析顺序**：`session.mode` > `_active.json.mode` > `'text+action'`。L1 渲染与 `/overview` 必须走**同一个函数**，
  否则会出现「面板说纯文本、提示词按动作渲染」这种自相矛盾。
- **为什么留 `_active.json.mode`**：它是「还没 commit 过任何一轮」时的兜底，也是老客户端的兼容面。**不删，降级为兜底**。
- **为什么落 session**：模式属于「这一次对话怎么说话」，与 `recent` / `turn_count` 同级；跨会话共享一个开关是历史包袱。

### 亲密度落盘与「查看不写回」口径

- **旧状态**：面板显示 `relationBaseline`（卡里写的起点档），对话里模型按「累计轮次 + 日记条数」现算——两个数永远对不上，
  用户看到一套、聊到的是另一套。
- **新做法**：`SessionState.intimacy` 落五档（陌生 / 认识 / 熟悉 / 亲近 / 亲密），`relation_log` 记每次变化
  （`{ at, from, to, why? }`，上限 50 条，超出丢最旧）。`relationState()` 同时返回 `baseline`（起点，由卡的「关系起点」推出）
  与 `current`（落盘档位），面板与工具读同一个来源。
- **「查看不写回」是口径，不是代码**：用户只是问「关系如何」→ 只读；只有里程碑事件（第一次约定 / 第一次争吵 / 称呼改变 / 表白）
  才带 `set` 写回。理由：每轮都写会让档位随情绪抖动，`relation_log` 退化成流水账，真正的转折反而看不出来。这条写死在 `RELATION_HINT` 里。
- **顺便修掉一对死字段**：`awu_diary_write` 现在可带 `topic` / `mood` 写进 session（同一事务），否则 L1 的
  「未竟话题 / 此刻的情绪」两行永远是空的——旧代码只在 `/session/commit` 显式传时才写，而面板根本不调那条路由。

### 这一轮的改动清单

| 改动 | 文件 | 为什么 |
|---|---|---|
| 新增 `SECTION_DISCIPLINE='aiwu:discipline'`（order `ORDER_BASE + 50`）、`DISCIPLINE_TEXT` / `DISCIPLINE_FULL_TEXT` / `DISCIPLINE_LEVELS` | `src/prompt.ts` | L0.5 纪律包，三档可关 |
| `ActiveState.discipline` + `POST /discipline` + `/overview` 返回 `discipline` | `src/prompt.ts`、`src/web.ts` | 档位落盘、面板可切 |
| 新增工具 `awu_mode`；`/mode` 兼容 `name?` | `src/tools.ts`、`src/web.ts` | 用户说「切纯文本」时模型能自己切，不必回面板 |
| `session.mode` 优先、`_active.json.mode` 兜底的统一解析 | `src/prompt.ts`、`src/store.ts` | 同上，「这一次」的语义落到会话 |
| `SessionState.intimacy` / `relation_log`；`awu_relation` 加 `set` + `why`；`POST /relation/set` | `src/store.ts`、`src/tools.ts`、`src/web.ts` | 档位只有一个真相，变化可回溯 |
| `awu_diary_write` 支持 `topic` / `mood`（同事务写 session） | `src/tools.ts`、`src/store.ts` | 盘活 L1 的两个死字段 |
| 面板「导入角色卡」（PNG / CHARX / JSON，预览不落盘、同名二次确认）+ 编辑器第 11 分区「世界书」 | `client/index.tsx`、`client/card-editor.tsx`、`client/lorebook-editor.tsx`（新）、`client/text.ts` | 后端 `POST /character/import` 与世界书数据层都在，界面零入口 = 白做 |
| 清死路由 `ROUTES.distillParse` / `parseDistillCard` | `client/api.ts` | 宿主从没注册这条路由，留着就是永远抛 `ApiUnavailableError` |
| 新增 `scripts/verify-wiring.mjs`（接线体检，14 组断言：8 组接线 + 6 组验收回归，含产物漂移检查） | `scripts/verify-wiring.mjs` | 见下 |

### 为什么要一个「接线体检」脚本

这一轮开工时仓库里有两种「后端做完、前端没接」的真实状态：

1. `POST /character/import` 在 `src/web.ts` 完整实现（16 MB 上限、PNG/CHARX/JSON、解析后**不落盘**、返回 `conflict`），
   而 `client/api.ts` 连路由常量都没有——面板上没有任何上传入口；
2. `client/lorebook-schema.ts` 17 KB 数据层（`toLoreDraft` / `mergeLore` / `mergeLoreIntoCard` / `moveEntry` / `loreIssues`）
   **全项目零引用**，世界书改不了。

这两种状态下 `tsc`、esbuild、七套自检（当时还没有 `verify-wiring`）**全是绿的**——因为类型检查只问「类型对不对」，不问「有没有人调用」。
`scripts/verify-wiring.mjs` 就干这一件事：纯静态读源码，断言 14 组接线（导入入口 / 世界书接线与文案 key / 死路由已清 /
纪律包名字 order 长度 / `awu_mode` 与 `awu_relation.set` / `SessionState` 新字段 / 世界书改动是否随 `ccv3` 发出去 /
**产物里的纪律包文本与源码逐字一致**）。
拿不准的用 `[skip]`，不误报——红点必须都是真问题，否则没人看。

> 第 7 组有个刻度上的取舍：**「世界书保存不传 `card`」这一条最初按字面写成硬断言，跑起来是红的**，
> 但查了 `store.saveCard`（`src/store.ts:571-581`）发现「都给」时以 `ccv3` 为底、`card` 只覆盖结构，
> `character_book` 不会丢——照字面判红等于误报。所以改成「世界书改动必须随 `ccv3` 发出」（真会丢数据的那一项）
> 判红，混发 `card` 只记提醒并 `[skip]`，把口径问题留给 Lead 定（Lead 已拍板：混发不算问题，只改 `card-editor.tsx`
> 那段「两步发、不混」的注释）。这就是「宁可 skip 不误报」的具体一次。

> 第 8 组（产物 vs 源码）是 Lead 让加的：纪律包每轮都进系统提示词，`tsc` 怎么 emit、以及「改了 src 没重编」，
> 前七组只读源码，一律看不见。实现上两处保守：`lib/prompt.js` 不存在 → `[skip]`；产物比源码旧 → `[skip]`
> （研发中途没 build 是正常态，不是失败）；只有「产物是新的、文本却和源码不一样」才判红。
> 加它的当天就吃到一次真实价值：先是报了 `DISCIPLINE_FULL_TEXT` 750 vs 736，查下去是**脚本自己的边界写错了**
> ——语句边界只认 `const`，把中间的 `export type DisciplineLevel = 'off' | 'lite' | 'full'` 那行的字面量
> 当正文多算 14 字符。边界改成「下一条顶层声明（含 `type`/`interface`/`function`）或顶层注释」，两边都回到 736。
> 顺手把文档里先前写错的 full 字数（750 / 多 195）改成 **736 / 多 181**——计量脚本自己写错时，
> 它给出的数字一个都不能信。

它**已经串进 `npm run build`**（Lead 决定，位置在 `verify-bundle` 之后），另有 `npm run verify:wiring` 独立入口。
按当前实现，`[7]` 也随 B 改成「只发 ccv3」而转成了正经的 ✓，混发那条 `[skip]` 变成了历史口径。

### 集成验收记录（2026-10-31，C2 全量回归）

`npm run build` 一次过，八套自检合计 **641 项通过 / 0 失败**（日志里 ✓ 641、✗ 0）：

| 自检 | 通过项 |
|---|---|
| `verify-bundle`（客户端产物可加载） | 9 |
| `verify-wiring`（接线 + 产物漂移） | 18 |
| `verify`（产物形状 / 新鲜度 / 孤儿产物） | 15 |
| `verify-tavern`（卡格式 / 迁移 / 世界书 / 忘却） | 218 |
| `verify-distill`（蒸馏武装 / TTL） | 93 |
| `verify-import`（PNG / CHARX / JSON） | 49 |
| `verify-session`（会话 / 指令 / 纪律包 / 关系） | 184 |
| `verify-host`（真实 cordis 装配） | 55 |

产物抽查（`npm run build` 之后）：

- `lib/client.js` 257.2 KB：含 `character/import`、`character_book`、`lore.title`、`import.tooLarge`；中文按 esbuild 默认 `charset: ascii` 转成 `\uXXXX`（「导入角色卡」= `\u5BFC\u5165\u89D2\u8272\u5361`）——**按字面 grep 中文会误判缺内容**
- `lib/prompt.js` 27.2 KB：`aiwu:discipline` / 禁止词库 / 语态锚点都在，且与源码逐字一致（第 8 组守着）
- 宿主实测：启用态（丰川祥子 + lite）整段渲染 **3286 字符**；`off` 档纪律包消失但 L0 仍在
- `package.json` 的 `files` 仍是 `lib / presets / distill / cordis.patch.yml / README.md`：新增的 `client/lorebook-editor.tsx` 是源码，打进 `lib/client.js`，不需要改 `files`

这次没覆盖到的（留给下一轮或发版后观察）：真机重装后的面板点击链路（导入 → 预览 → 覆盖 → 世界书编辑 → 保存回读）、
`awu_mode` / `awu_relation.set` 在真实模型对话里的调用时机、`relation_log` 长期增长到 50 条后的面板呈现。

---

## 十一、2026-10-31 · 验收轮（v0.3.0 真机反馈 7 条）

主人在真机上装了 v0.3.0 跑了一遍，报 7 条：**6 条前端、1 条宿主侧过严**。全部自检当时是绿的——
这些都不是「代码坏了」，而是「代码按实现者的假设跑，但主人的用法不在假设里」。所以这一节记的是**根因**，不是改动清单。

行号是 v0.3.0（HEAD `90cd1ec`）当时的，客户端文件一直在动，**别拿行号当锚点**，看函数名/文案 key。

### 逐条：现象 → 根因 → 改法 → 归属

| # | 现象 | 根因 | 改法 | 归属 |
|---|---|---|---|---|
| 1 | 日记页右侧显示「先启用或选择一位角色」，但明明选了卡 | `client/index.tsx:1351` 的 `viewName` 只在日记 tab 看 `active.character`：选了卡但没启用 = 空串，于是走空态 | 改为「先 `detailName`，再 `active.character`」；空态拆三分支（没选/没日记/加载失败），「没有日记」单独文案 | E |
| 2 | **把卡拖进导入框，文件被发到会话输入框** | `client/index.tsx:601-628` 的 dropzone 只 `preventDefault()`，**没 `stopPropagation()`** → drop 事件冒泡到宿主 composer，它照样接文件 | 弹层根节点统一 `preventDefault + stopPropagation`；框外 drop 给「拖到虚线框里」提示；弹层打开期间挂 document 级兜底并记得卸载 | E |
| 3 | 提示条（notice）常驻不消失 | `client/index.tsx:1232` 只有 `useState('')` + 各处 `setNotice(...)`，**没有任何计时器** | 成功类 5 秒自动消失 + 手动关闭；错误类留待手关；新提示覆盖旧计时器（cleanup 清）；`aria-live="polite"` | E |
| 4 | 找不到在哪里切「纯文本 / 文本 + 动作」 | 模式开关藏在「启用中角色」状态条的小图标里（`client/index.tsx:1803-1820`）：**没启用角色就完全看不到**，而 mode 其实是偏好不需要角色 | 角色簿左栏工具栏加两枚显式胶囊（当前值高亮），不需要启用就能点，点击即 `POST /mode`；原图标入口保留 | E |
| 5 | 「新建角色」和「蒸馏角色卡」一大一小、名字不对仗 | 两个入口是不同时期加的：蒸馏是主 CTA（大），新建是 `data-size="sm"` 的小按钮，文案 `roster.new`=「新建角色」 | 改名**「自创角色卡」**（中英各一），与「蒸馏角色卡」同级并排、同级尺寸；断言按「文案 key + 同一工具栏」判，不写行号 | E |
| 6 | 自创角色卡只有三个空字段，想让人设自己长出来 | 新建弹层（`client/index.tsx:369` 起）只调 `draftCard` + `saveCharacter` 落骨架，**宿主那条 arm 通道只服务蒸馏**（`DistillArm` 没有 `kind`） | 加「让 AI 补全人设」勾选：先存骨架卡 → `POST /distill/arm {kind:'create'}` → 复用蒸馏的 `insertText → submit` 通道 → 关弹层提示已发出。宿主侧 `kind` 区分 `flow.md` / `flow-create.md` | E + D |
| 7 | 导入大卡被硬拦：「世界书总字数超限（98869，上限 20000）：请精简后再保存」 | `src/tavern.ts:882-883` 的 `CARD_HARD_LIMITS` 里，`bookEntry`/`bookTotal` 和五个原生字段**混在同一个 `assertCardLimits` 硬拦里**（throw 在 `:911` 与 `:916`） | 拆语义：五个原生字段（description 2000 / personality 4000 / scenario 4000 / system_prompt 4000 / post_history 4000）继续硬拦；`bookEntry`/`bookTotal` 改 `collectCardWarnings()` 产出的**软警告**，`saveCard` 返回 `warnings`，`POST /character/save` 与 `/character/import` 都带出来 | D |

### 两条教训（比这 7 条本身更值钱）

**教训 1：`assertCardLimits` 把「有预算的注入」和「无预算直进提示词」混在一个硬拦里。**

世界书是**按需注入**的：`LORE_DEFAULTS` 早就限了 `maxEntries=12 / budgetChars=6000`，一本 9.8 万字的书不会撑爆上下文，
只是大部分条目这一轮用不到。而那五个原生字段是**整段直进系统提示词**的，没有预算兜底，超了必须拦。
把两类放在同一个 `assertCardLimits` 里，等于用「最危险那类」的尺度去管「有预算那类」——表现就是「书是好的，插件不让进」。

判据要写成一句话：**这条内容进提示词时有没有预算？** 有预算的给警告，没预算的才拦。

**教训 2：拖放只 `preventDefault()` 不够，必须 `stopPropagation()`。**

`preventDefault()` 只告诉浏览器「这个 drop 不用默认行为」，事件仍然会**往上传**。宿主 composer 在 document 层监听 drop，
于是文件既进了导入框、又被塞进会话输入框。正确姿势是两层：

```text
弹层根节点：onDragOver/onDrop → preventDefault() + stopPropagation()   // 拦住冒泡
document 级：dragover/drop    → preventDefault() + stopPropagation()   // 弹层开着时兜底，关闭即卸载
```

代价是「document 级监听忘了卸载」会让整个页面再也拖不动文件——所以它和弹层生命周期必须绑在一起。

### 这一轮的断言（verify-wiring [9]–[14]）

六条新断言全部按**文案 key / 结构特征**写，不写行号（客户端文件一直在动，行号断言活不过一天）：

- `[9]` 自创卡 AI 补全接线：client 有 `kind: 'create'` 的 arm 调用 → `src/web.ts` 的 arm 路由读 kind → `distill/flow-create.md` > 2000 字节
- `[10]` 世界书软警告契约：tavern 不再对 bookEntry/bookTotal 抛错 → save 响应含 `warnings` → client 保存返回类型收 `warnings`
- `[11]` 提示条自动消失：notice 有 `setTimeout` + `clearTimeout`，且有专门的可关闭入口（通用 `common.close` 不算数，那样判绿等于没判）
- `[12]` 按钮文案与同级：中英各一条「自创角色卡」→ 与 `DistillEntry`（蒸馏角色卡）在同一工具栏跨度内
- `[13]` mode 三段契约：`/mode` 路由块里不再有 `resolveName` 硬解析（无目标不抛错）→ 响应含 `scope` 与 `global` 分支 → 无目标时仍写全局兜底（`prompt.setMode`）
- `[14]` 补全手册的名字约束：`flow-create.md` 里要有「以给定/面板名字为准、不改名」的硬约束，以及「`overwrite:true` 覆盖同名骨架卡（不是新建）」

`[13]` 与 `[14]` 是 Lead 拍板后从「真机才能发现」升级成静态断言的：前者是**契约缺口**（见下），
后者是**手册缺陷**——两者都能靠读源码/读文档判出来，没理由留给真机。

拿不准的一律 `[skip]`：比如「文案还没改」时，同级那条会跳过而不是拿旧 key 判绿——**假绿点比红点更坏**，
它会让人以为这条已经验过了。

### 这一轮没验透、需要真机复看的两处

1. **拖放的两层监听有没有正确卸载**（第 2 条）：静态脚本只能看出「有没有 `stopPropagation()`」，
   看不出 document 级监听是否在弹层关闭时卸载。忘了卸 = 整个页面从此拖不动文件；拦得太宽 = 面板内其它拖拽也废了。
   必须真机拖一次、开关弹层再拖一次。
2. **提示条的计时器有没有只作用于成功类**（第 3 条）：断言只查 `setTimeout` / `clearTimeout` 存在，
   分不出「错误提示也被 5 秒卷走」。错误提示自动消失会让用户错过失败原因，比常驻更糟。

> 另外两条曾经也只能真机看，现在已经被钉死：
> **模式胶囊**——`/mode` 原来的 `resolveName`（`src/web.ts:182-187`）在「body 无 name 且没启用角色」时直接
> throw「缺少角色名，且当前没有启用角色」，而面板的 `setInteractionMode(mode)` 只发 `{ mode }`，胶囊点下去就是 400。
> 契约改成三段（有启用→session / 带 name→该角色 / 都没有→全局兜底 `_active.mode` + `scope:'global'`）后，`[13]` 守着它。
> **AI 补全的名字一致性**——`awu_card_save` 的 `overwrite:true` 按名字匹配，AI 若按自己推断的名字落盘，
> 结果不是补全而是**多出一张壳卡**；现在 `flow-create.md` 里写死了「按给定名字 + overwrite 覆盖」，`[14]` 守着它。

### 集成验收记录（F2，九套全量）

`npm run build` 一次过，九套自检合计 **720 项通过 / 0 失败**（日志里 ✓ 720、✗ 0，`exit=0`）：

| 自检 | 通过项 |
|---|---|
| `verify-bundle`（客户端产物可加载） | 9 |
| `verify-wiring`（14 组接线 + 验收回归 + 产物漂移） | 33 |
| `verify`（产物形状 / 新鲜度 / 孤儿产物） | 15 |
| `verify-tavern`（卡格式 / 迁移 / 世界书 / 软警告） | 254（+36） |
| `verify-distill`（蒸馏 / 补全武装 / kind） | 121（+28） |
| `verify-import`（PNG / CHARX / JSON） | 49 |
| `verify-session`（会话 / 指令 / 纪律包 / 关系） | 184 |
| `verify-host`（真实 cordis 装配） | 55 |

产物抽查（26 项全命中）：`lib/client.js` 272.9 KB 里有「自创角色卡 / 蒸馏角色卡 / 纯文本 / 文本 + 动作 /
让 AI 补全人设 / 还没有日记 / 把卡拖到」，以及 `cta.selfCreate`、`new.aiFill`、`notice.close`、
`awu-ctaRow`、`awu-modePill`、`awu-importDrop`、`kind:"create"`、`scope`；`lib/prompt.js` 里纪律包段名与正文都在。

> ⚠️ 两个产物工具的编码行为**不一致**，抽查时容易误判：esbuild（`lib/client.js`）默认 `charset: ascii`，
> 中文是 `\uXXXX`（9699 处，0 个未转义汉字）；tsc（`lib/prompt.js`）**保留原始 UTF-8**，直接 grep 中文即可。
> 我自己第一次抽查就踩了两次：把空格也转义了（`文本 + 动作` 假失配）、拿转义串去查 prompt.js（`禁止词库` 假失配）。

### 主人报的 7 条：逐条判定

| # | 判定 | 依据（静态可查的部分） |
|---|---|---|
| 1 日记空态错 | **已修** | `viewName = tab==='diary' ? (detailName || (active.enabled ? active.character : '')) : detailName`；三分支齐：无选择→提示、无日记→`diary.emptyFor`+`emptyForHint`、加载失败→`data-kind="error"` + `detailError` 原文 + 重试按钮 |
| 2 拖卡发进会话框 | **已修**（细节需真机） | 四层：拖放区 `preventDefault+stopPropagation`、`Overlay` 遮罩对文件拖放 `preventDefault+stopPropagation` 并回调「把卡拖到虚线框里」、弹层打开期间 document 捕获阶段 `dragover/drop` 兜底（`dialog !== ''` 才挂、卸载清理齐）、面板根节点常驻吞文件拖放 |
| 3 提示条常驻 | **已修** | `notice: {text, tone}` + `NOTICE_TTL_MS=5000`，**只有 `tone==='ok'` 才起计时器**、`warn` 留待手关；新提示先 `clearNoticeTimer()`；卸载 `useEffect` 清计时器；`dismissNotice` 供关闭按钮用 |
| 4 模式没暴露 / 无卡时不能切 | **已修** | 工具栏两枚胶囊（`awu-modePill`，当前值 `data-on`）；`applyMode` 有选中卡时带 `targetName`，无目标时走后端三段返回 `scope:'global'` 并提示「待启用生效」（`mode.pending`），不报错 |
| 5 按钮一大一小 | **已修** | `cta.selfCreate` =「自创角色卡」/「Create card」，中英齐；与 `<DistillEntry>` 同在 `awu-ctaRow` 一行同级 |
| 6 自创卡缺 AI 补全 | **已修**（省与否两条路径都在） | 勾选 → `submitWithAi`：先 `saveCharacter` 落骨架卡 → `armDistill({kind:'create'})` → 复用 `insertText→submit`；**不勾选 → `submitForm` 只落表单卡**（旧行为不变，`new.done` 提示） |
| 7 大卡被硬拦 | **已修** | `collectCardWarnings` 替代 bookEntry/bookTotal 的 throw；`saveCard` 返回 warnings；`/character/save` 与 `/character/import` 都带出（导入预览就已经看见）；五个原生字段仍硬拦 |

**需真机复看的**（静态断言碰不到）：拖放的两层监听在开关弹层后是否干净（忘卸 = 整页拖不动文件）、
提示条是否真的只对成功类计时（`warn` 类不该被卷走）、AI 补全跑完后是否**覆盖**了骨架卡而不是多落一张。

### 两条独立判断（不采信实现者的结论，自己验）

**① 面板内非导入态的文件拖放被整体吞掉 —— 是取舍，但「吞而不告」欠一句提示。**
`.awu-panel` 根节点常驻 `onDragOver/onDrop`，只对 `Files` 类型 `preventDefault+stopPropagation`。
放行的代价很明确：宿主 composer 在 document 层收 drop，卡文件会被当附件发进对话（就是主人报的第 2 条）。
所以「吞」方向是对的，而且它只拦文件、不影响面板内文字拖拽与滚动（有 `dragHasFiles` 判断）。
欠的是反馈：用户在面板上拖一张卡进去，界面毫无变化，而导入弹层内同样的动作会提示「把卡拖到虚线框里」。
建议（低优先级）：面板根收到文件 drop 时给一句「卡文件请从『导入角色卡』拖入」，或直接打开导入弹层预览。

**② 日记页看非启用卡时不显示关系条 —— 方向对，但只做对了一半。**
现实现是 `relation={diaryDetail.name === liveName ? relation : undefined}`：拿「启用中角色的关系」去贴在别人的日记上是错的
（代码注释也这么写），这点判断正确。但 `GET /character` **本来就按卡返回 `relation`**（`client/api.ts` 的 `charDetail.relation`），
所以被看那张卡自己的档位是拿得到的。现在的写法把「别人的关系」和「自己的关系」一起否掉了：
不贴错数据 ✅，但用户看某张卡的日记时看不到它自己的关系状态（信息缺失，不是数据错误）。
是否补上属于产品判断——若日记页不打算承担「看关系」职责，现状可接受；若要补，用 `diaryDetail.relation` 而不是 `active` 那份。

### 这次没覆盖到的

真机点击链路（导入 → 预览 → 同名覆盖 → 世界书编辑 → 保存回读 → 提示条自动消失）、
`awu_mode` / `awu_relation.set` 在真实模型对话里的调用时机、AI 补全端到端（真实模型是否按 `flow-create.md` 先问 3–5 个问题、
是否按给定名字覆盖）、桌面 profile 重启加载。
