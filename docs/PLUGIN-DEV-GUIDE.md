# DSH 插件开发手册 · 实战沉淀

> 来源：`dsh-ai-with-u`（角色扮演插件）从 v0.1.0 到 v0.4 的全部踩坑与复用经验。
> 每条都带「现象 → 根因 → 对策」，能直接照抄。
> 更新方式：新增坑就往后追加一条，别改写历史结论（历史结论是当时的证据）。

---

## 0. 一分钟上手

```bash
git clone <repo> && cd dsh-ai-with-u
npm install
npm run build          # tsc(host) + tsc(client, noEmit) + esbuild 打包 + 八套自检
```

装进桌面版（DSH 不热加载 `lib/index.js`，装完必须**完全退出再启动**）：

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-ai-with-u" `
  -Target "<克隆路径>"
```

再在 `profiles/desktop/package.json` 里加 `dependencies` 的 `link:` 与 `dsh.profile.bundles` 条目。
**不要在 profile 的 `cordis.patch.yml` 里手写插件行**——包内 `cordis.patch.yml` 的 `bundle.patch` 会自动挂载，重复写只会干扰排障。

---

## 1. 项目地图

```
src/            宿主侧（Node 侧，tsc 编到 lib/）
  index.ts      插件入口：apply() 时序、事件钩子、工具/路由挂载、卸载
  prompt.ts     提示词五段注册 + 每会话缓存 + 决议（会话绑定>全局>未启用）
  store.ts      存储层：原子写、跨进程锁、索引、迁移、日记/会话/绑定
  tavern.ts     CCv3 卡：归一、投影、L1 渲染、世界书选择、宏、忘却
  tools.ts      9 个 awu_* 模型工具（按会话决议角色）
  web.ts        面板 REST 路由（/_dsh/ai-with-u/*）+ 来源栅栏
  distill.ts    蒸馏/自创卡的"武装"状态机（TTL）
  import-card.ts PNG(tEXt/iTXt) / CHARX / JSON 解析
client/         浏览器侧（esbuild 打成 lib/client.js，__ModuleLoader__ 格式）
  entry.tsx     注册侧栏入口 + composer dock + locale
  index.tsx     主面板（4 tab + 多种弹层）
  card-editor.tsx / lorebook-editor.tsx / preview.tsx / diary-review.tsx
  dragdrop.ts   文件拖放与宿主拖放状态机的交界（见坑 #21/#22）
  text.ts       中英双字典（缺 key 会裸显 key）
scripts/        八套自检 + 打包
docs/           设计文档与踩坑记录（DEVELOPMENT.md 是主时间线）
distill/flow*.md 蒸馏 / 自创卡补全的"执行手册"（模型按它跑流程）
presets/        开箱角色卡
```

**数据根**：`~/.dsh/ai-with-u/`（`AIWU_STORAGE_ROOT` 可覆盖）

```
_index.json            角色索引
_active.json           全局启用态 + mode + discipline 偏好
_sessions.json         会话绑定：{ [sessionId]: { character, boundAt } }
characters/<名>/card.json      CCv3 卡（权威）
characters/<名>/diary.md       日记（时间线 + 心情札记）
characters/<名>/session.json   会话摘要 / last_ts / turn_count / mode / intimacy
```

---

## 2. 宿主契约速查（以本机 0.2.1-rc 为准，换版本要重新核）

### 2.1 入口

```ts
export const name = 'my-plugin'
export const inject = ['systemPrompt']            // 硬依赖；可选服务走 ctx.get/inject
export function apply(ctx: Context): () => void { /* ... */ return dispose }
```

- 可选服务（`tools` / `webServer` / `agents` / `events`）**一律用 `ctx.get()` 探测**：Cordis 4 的 Context 是 Proxy，访问未声明服务会直接抛 `cannot get property "x" without inject`。
- 所有注册都返回 disposer，`apply` 的返回值要在卸载时把**全部** disposer 跑一遍（逆序）。

### 2.2 提示词段

```ts
ctx.systemPrompt.section({ name, order, text, interpolate: false }): () => void
```

| 字段 | 说明 |
|---|---|
| `name` | 段的稳定标识，同名会覆盖/遮蔽同名段 |
| `order` | 排序；DSH 第一方段在 −1000~10200，外部插件用 5000+ 落在指令区之后 |
| `text` | 字符串或 **`(context) => string`**，每次组装重新求值 |
| `interpolate` | **必须显式传 `false`**（见坑 #1） |
| `complete` | 本插件没用；用于"完整覆盖"语义的场景要谨慎（会压掉其它段） |

**关键事实**：`PromptSection` **没有 `scope` 字段**；scope 是「注册处上下文」的属性，同名 scoped 段会 shadow 全局段。
但每个段的 `text(context)` 会收到 `AssembleContext`：`{ agent?: Agent, scope, signal? }`，而运行时 `assembleContextFor(agent) = { agent, scope: agent }` —— **`scope` 就是 Agent 本体**。

> 推论：**一个全局注册的段就能按会话渲染不同内容**（在 `text(context)` 里读 `context.agent.session.id`）。不必自建 `createScope`——自建要管生命周期，agent 重建时容易泄漏。

本项目的五段（这个顺序本身就是设计）：

| order | 段名 | 内容 | 变化频率 |
|---|---|---|---|
| 5000 | `aiwu:baseline` | L0 底线（让位声明 / 扮演底线） | 启用态不变 |
| 5050 | `aiwu:discipline` | L0.5 纪律包（禁止词库 / 消息形态 / 动作 / 输入识别 / 边界） | 只随档位变 |
| 5100 | `aiwu:active-character` | L1 角色卡 + 会话摘要 + 日记 + 模式口径 | 每轮 |
| 10300 | `aiwu:lore` | 世界书命中 | 命中集合变才变 |
| 10350 | `aiwu:clock` | 时间差 + 当前时间 | 每分钟 |

**易变段必须垫底**：宿主按系统提示内部顺序算缓存失效范围，把每轮都变的段放前面，等于每轮把后面全废（`dsh-tavern` 把世界书命中放 `order: -999999`，就是反面教材）。

### 2.3 工具

```ts
ctx.tools.register({ name, description, parameters, output, execute(args, exec) }): () => void
```

- `parameters` 是**简化 JSON Schema**：数组元素用 `items`（写成 `item` 会被宿主忽略）。
- `exec.agent` 由 agent loop 注入 → **想按会话工作，必须读它**。
- 条件挂载：把注册结果存进数组，启用时 `register`、退出时逆序 `dispose`。
- 编译期对齐：把本项目的 `ToolDef` 断言成宿主 `ToolDefinition`（`type X = ToolDef extends ToolDefinition ? true : false`），签名漂移会在 `tsc` 阶段报错而不是运行时静默失败。

### 2.4 Web 路由

```ts
ctx.webServer.register({ kind: 'exact' | 'prefix', path, handler: (req, res) => ... })
```

- **路由表里的 `method` 会被宿主丢弃**：必须自己在包装层校验，不符返回 405。
- 宿主只给 `/api` 做来源校验，插件自己的前缀要**自己补栅栏**：Host 必须是回环或实际监听地址、带 Origin 必须同 authority、`Sec-Fetch-Site: cross-site` 直接 403、写操作强制 `Content-Type: application/json`。
- 体积自守：普通请求 4MB，导入类放宽到 16MB（客户端侧再按 base64 ×4/3 折算成 11MB）。
- 隧道/反代访问要环境变量显式放行（本项目 `AIWU_TRUSTED_HOSTS`），默认拒绝。

### 2.5 事件

```ts
ctx.on('agent/pre-step', (payload, next) => { ...; return next() })   // waterfall：不调 next() 整轮进不去
ctx.on('agent/turn-stopping', (payload) => { ... })                   // serial：一轮真正收尾
```

- **计数只能用 `turn-stopping`**：`pre-step` 在工具循环里每步都会触发，用它计数会把一轮算成好几轮。
- 事件回调里抛错会被宿主吞成一条 warn：自己 `try/catch` + 全量日志。
- **子代理是独立 agent**：`ctx.get('agents').roots()` 返回"没有 owner 的顶层 agent"，用它排除子代理，否则子代理的对话会写进用户的 `session.json`。

### 2.6 客户端

- artifact 是 `window.__ModuleLoader__.load({ id, factory: (require) => ... })`；`react` / `react-dom` / `react/jsx-runtime` 一律 external（宿主提供），否则出现第二个 React，hooks 直接炸。
- UI 通过插槽贡献：`ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`；本项目用 `sidebar.footer.action`（侧栏入口）与 `conversation.composer.dock`（拿 `inputActions` 的唯一通道）。
- 新增聊天行要 `ctx.uiConversation.events.register()` + 注册在 `conversation.chat.node` 槽；**它只能新增行，改不了宿主已有消息的渲染**。
- **不要在组件外写 DOM、不要读别的插件的 DOM**（规范明写）。想要"渲染后替换文本"这类效果，只能靠独立引擎插件（见 §7）。
- 主题只依赖 `--dsw-alias-*` 令牌；不要 require 宿主的 client 包（版本漂移会炸，而且抛错的 slot entry 会整块空白）。
- 可见文案走 locale 服务（本项目 `client/text.ts` 中英双字典，缺 key 会裸显 key）。

---

## 3. 踩坑清单（按类，共 27 条）

### A. 提示词 / 注入

**#1 `interpolate` 默认 true，卡里的 `{{char}}` 会让整轮进不去**
现象：导入任何酒馆卡后会话直接失败，报 `unknown prompt variable`。
根因：宿主组装时会替换 `{{var}}`，遇到未知变量**直接 throw**。
对策：所有段 `interpolate: false`，宏自己展开（认识的展开、不认识的**原样保留**、绝不抛错）。

**#2 返回空串的段会被宿主过滤 —— 这就是"干净拔出"的实现方式**
别去删文件、别去注销段；把段文本返回 `''`，宿主过滤空段，提示词里一个字都不留。

**#3 段的 order 决定缓存失效范围**
易变内容（世界书命中、时间、随机）放最末；稳定内容（身份、角色卡、纪律）放前面。顺序改一次就是真金白银。

**#4 缓存要"整体替换"，绝不先清空**
先清空会让正在进行的组装读到空缓存 → 整轮丢人设。正确做法：读盘完成后一次性赋值。

**#5 并发 refresh 要串行链 + 代际**
两个刷新交错时，后完成的旧结果会覆盖新结果。用 promise 链排队，再用 `generation` 只允许最新一代提交。

**#6 想按会话就要读 `context.agent`**
`PromptSection` 没有 scope；但 `text(context)` 有 `Agent`。
⚠️ diagnostics（诊断页组装）**没有 agent**，必须稳退回全局，绝不抛错。

### B. 事件 / 生命周期

**#7 `pre-step` 是 waterfall，忘 `next()` 这一轮就废了**
刷新只是尽力而为——不要 `await` 它再 `next()`，先 `next()` 再异步刷新。

**#8 用 `pre-step` 计数会把一轮算成多轮**
工具循环每步都触发。计数只在 `turn-stopping`。

**#9 子代理会污染主会话状态**
用 `agents.roots()` 判定；取不到 roots 时**按"不是子代理"处理**（宁可多写一轮，也别静默丢掉主会话）。

**#10 事件回调抛错会被吞**
Cordis hooks 同步派发，抛错只留一条 warn。自己兜住并打全上下文。

### C. 存储

**#11 必须原子写**：`.tmp`（pid+uuid）→ `fsync` → `rename`；失败删 tmp 再抛。

**#12 单实例锁不够，要跨进程文件锁**
桌面版 + web profile 共用数据根时，进程内队列管不了另一个进程。`open(lock,'wx')` 独占创建 + 轮询 + 超时 + mtime 过期视为崩溃残留。

**#13 BOM 会让 `JSON.parse` 直接炸**：读文本先剥 `\uFEFF`。

**#14 损坏文件要隔离而不是当"不存在"**
JSON 语法错 → 改名 `.corrupt-<ts>` + 留痕 + 返回 undefined；有备份的卡**不能丢索引条目**，否则用户以为卡没了。

**#15 Windows 大小写不敏感**：`Alice` 与 `alice` 会写进同一目录。保存前挡住"仅大小写/编码不同"的重名。

**#16 时间戳要带 UTC 偏移**：`YYYY-MM-DDTHH:mm:ss+08:00`。只写 UTC 或裸本地时间，跨时区/跨客户端会算错时间差。

### D. 客户端 / 打包

**#17 `react` 必须 external**（见 §2.6），否则双实例。

**#18 `react/jsx-runtime` 不能用 `jsx-dev-runtime`**：后者只导出 `jsxDEV`，esbuild 生成的 `jsxs(...)` 会变 undefined。

**#19 esbuild 会把中文字符串转成 `\uXXXX`**
`charset` 默认 ascii。**产物抽查时按字面 grep 中文会误判"没打包进去"**。
而 `tsc` 产物（host 侧）**保留原始 UTF-8**。两个工具有两种编码行为，抽查前先确认目标文件是谁产出的。

**#20 minify 会改函数名**
`resetHostDropState()` 在 `lib/client.js` 里叫 `ha`。**抽查要查"行为标记"**（事件构造、className 选择器、文案 key、`new Blob(`），别查你起的函数名。

**#21 模态弹层的文件拖放会抢宿主 composer 的 drop**
现象：把卡拖进导入框，卡导入了，同时图片被当附件发进对话。
根因：导入框只 `preventDefault()`，事件继续冒泡到宿主 `document` 监听。
对策：**`preventDefault` ≠ `stopPropagation`**。要拦就三层都拦（拖放区 / 弹层遮罩 / 文档捕获兜底），且只对 `dataTransfer.types` 含 `Files` 的拖拽生效（否则面板内文字拖拽、滚动条拖拽全废）。

**#22 吞掉第三方状态机的原生事件，必须补它的"复位事件"**
现象：导入卡后关面板，DSH 聊天区永久卡在「文件或图片拖动到此处即可添加」遮罩，必须再拖一次文件才消失。
根因：宿主的拖放提示层是**文档级深度计数器**：

```js
dragenter: depth++ , 显示遮罩
dragleave: depth-- , 归零才隐藏
drop:      reset()
window.addEventListener('dragend', reset)   // ← 唯一兜底复位口
```

我们 `stopPropagation` 掉 `drop` → 宿主 `onDrop` 不跑 → 不 reset；而**从系统拖入的文件没有源元素，浏览器不会派发 `dragend`** → 两条复位路同时失效 → 永久卡住。
对策（三条缺一不可）：
1. 每个吞 drop 的路径末尾 `window.dispatchEvent(new Event('dragend'))`（命中对方自己的 reset，不是 hack）
2. 截断 `dragenter`（只对容器内、只 `stopPropagation` 不 `preventDefault`），让计数器根本不 +1
3. 弹层关闭/组件卸载再补一次复位，**且监听必须随开关卸载**——监听常驻会让宿主拖放永久失效，比卡遮罩更糟

**可复用判据**：*吞掉一个由第三方状态机驱动的原生事件时，必须同时补上它的复位事件*。三步自查：① 读对方状态机，找出它靠什么推进/复位；② 你的拦截让它停在哪个中间态；③ 复位事件在真实场景里是否必然到达（`dragend` 对系统拖入不触发，就是典型的"不会到达"）。

### E. 自检 / 发布

**#23 宿主不热加载 `lib/index.js`**：改宿主侧代码必须重启 DSH；改 `lib/client.js` 刷新页面即可。

**#24 自检脚本 `import` 的是 `lib/` 产物**
改完 `src/` 不 emit 就直接跑，测的是旧代码。要么先 `tsc`，要么让脚本自己 build。本项目把「产物比源码旧」做成了一条断言，从根上堵住。

**#25 断言别绑死实现位置**
同一个行为可以有三种写法（函数内 / 调用点 / 数据层整体展开）。断言写成"必须在某函数体里出现"，上游换个更漂亮的写法就被判红——等于逼人按你的想象写代码。**启发式要跟着行为走，不跟着实现走。**

**#26 文案命中 ≠ 行为正确**
"有句文案提到不执行"可能出现在一条永远不会走到的分支里。断言要同时校验**行为证据**（路由存在、字段被读、`delete` 不存在）。

**#27 计量脚本自己会算错**
一次"字数 750 vs 产物 736"的误判，根因是计量脚本把 `export type` 那行的字面量算进了正文。**任何数字都要有第二份独立实现复算**，尤其是要写进徽章/文档的数字。

---

## 4. 可复用模式

**① 插拔段（同进同出）**——启用才返回文本，退出返回 `''`；工具同生命周期挂/卸。

**② 条件工具 + TTL 武装**——"能写卡的权力"只在用户点某个按钮后 2 小时内有效、保存一次即焚。
⚠️ 工具注册必须发生在**插件作用域**（`apply` 期），不要在 HTTP 请求作用域里注册：请求结束 effect 销毁，工具会被连带移除（表现为"已添加工具→很快又已移除"，再武装报 `cannot create effect on inactive context`）。

**③ 双视图 + 单向投影（C7）**——结构（自家字段）权威，原生字段（酒馆卡 `description` 等）是投影。
- 只给结构：以磁盘 CCv3 为底重投影，原生没被覆盖的键 / `character_book` / 他人 `extensions` 原样保留
- 只给 CCv3：补默认值，**只填空不覆盖**
- 要给：以 CCv3 为底再用结构覆盖

**④ 原子写 + 两级锁**（见 #11/#12）。

**⑤ 迁移幂等 + 备份**——读时归一，写时才落新格式；首次迁移前落一份 `card.v1.bak.json`（不覆盖已有）；种入预置卡只在目标目录不存在时跑一次。

**⑥ 快照预览**——面板"本轮注入了什么"必须**复用真实渲染函数**，不能另拼一份；否则预览和真实注入会漂移，这个功能就变成负资产。缓存缺失时预览**不触发刷新**（只读），返回同一句占位文案。

**⑦ 决议函数 + 安全失败**
`resolveTarget(sessionId)`：会话绑定 > 全局启用 > 未启用。
**出错方向必须安全**：绑定的卡被删 → 该会话视为未启用并清理绑定，**不回落全局**（否则用户以为在跟 A 聊，其实在跟 B 聊）。

**⑧ 会话态缓存要有上限**——`Map<sessionId, Cache>` 必须 LRU（本项目 32），否则开一百个会话内存和读放大都失控；渲染路径**零读盘**（绑定表走内存镜像）。

**⑨ 隔离不变量要覆盖三层**——提示词、工具、存储。只做提示词隔离、工具仍读全局角色，比完全不隔离更糟（更难排查）。

**⑩ 体检分级**
- `error` = 永远不会生效（非常驻且无关键词、内容为空）
- `warn` = 会因预算/条数进不去（**真丢内容**）
- `info` = 影响手感但不失效
判据一句话：**会不会真的丢内容**。而且：**一条提示存在的意义是推动用户做一个动作**——没有动作、或做了也没差别的，聚合成一条或直接删（本项目把 323 条噪声压到 4 条）。

**⑪ 记账式日志**——只记"条数与条目名"，绝不把卡正文写进日志（正文进日志 = 把内容泄露到可分享的地方）。

**⑫ i18n 双字典 + 键集一致性脚本**——中英各一份，缺 key 会裸显 key；写脚本核对"无重复 + 两边键集完全相同 + 模板里用到的 key 都存在"。

---

## 5. 自检体系

**八套，串在 `npm run build` 里**（任何一套红 = 构建失败）：

| 脚本 | 覆盖 |
|---|---|
| `verify-bundle` | 客户端产物形状（`__ModuleLoader__`、外部依赖） |
| `verify-wiring` | **接线体检**：后端做了前端没接、产物与源码漂移、文案 key 缺失 |
| `verify` | 产物形状 / 新鲜度 / 孤儿产物 |
| `verify-tavern` | 卡格式 / 迁移 / 世界书 / 忘却 / 宏 / 正则屏蔽 |
| `verify-distill` | 蒸馏武装 / TTL / 双通道 |
| `verify-import` | PNG / CHARX / JSON 解析 |
| `verify-session` | 会话 / 工具决议 / 纪律包 / 关系 / 绑定 |
| `verify-host` | **真实 cordis 装配**（Fake services + 真 assembly） |

写法要点：
- 用**临时数据根**（`mkdtemp`），跑完清理，绝不碰用户数据
- 需要真宿主时装配 Fake 服务（`FakeSystemPrompt` / `FakeTools` / `FakeWebServer`），**用真 assembly 取段文本**，比断言字符串更有说服力
- 断言要**独立复算**（见 #27）
- `skip` 只用于"依赖未就绪"，且必须在报告里说明为什么跳过
- 徽章口径写死：**总通过项之和，失败与 skip 都必须为 0**

---

## 6. 发版流程

1. 本地绿灯：`npm run build`（八套）
2. 改版本号（`package.json` + `package-lock.json` 两处 + README badge）
3. **只在本地提交**；`push` 必须等用户确认（本项目纪律）
4. npm：`npm publish`（注意：账号开了 2FA 策略时不能 unpublish，发之前想清楚）
5. GitHub Packages：走 Actions（`GITHUB_TOKEN` 需要 `packages:write`；本机 token 通常没有）
6. 桌面版：junction + profile `dependencies`/`bundles`，**重启**生效

---

## 7. 生态借鉴（DSH 酒馆类插件）

- **`dsh-tavern` 值得学的是工程纪律，不是匹配算法**：它的世界书选择器比我们更不完整（`secondary_keys` 无条件 AND、不读 `selective`、`probability` 用 `Math.random` 毁缓存、标题不认 `comment`），**别反向对齐**。
- 值得抄的四条：① 会话↔预设的**单一权威闸门**（只认显式操作写账）② **注入体积可观测**（快照 + 节流 + 60%/90% 分级）③ **一个判定函数两处复用**（注入点与统计点必须调同一个）④ **写别人配置文件的受管块纪律**（dry-run / 校验 / 备份 / 原子写 / 块外零字节不变 / 判等不写）。
- **显示层正则（SillyTavern `regex_scripts` 的 markdown 侧）在 DSH 里做不到**：没有消息正文变换的扩展点（`conversation.chat.node` 只能新增行、`agent/request` 只管路由、规范禁止改外部 DOM）。生态解法是**交割给独立引擎插件**（`dsh-tavern` → `dsh-muv-engine`，取样口是渲染后的 `[class*="_markdown_"]`），并且**只留一套渲染器**（tavern 把自己原来的 `beautifyContentEl` 删了，因为两套会互相覆盖）。
- 本项目的口径：**只做提示词侧，显示侧明确不支持并明示**；带正则的卡**保留字段、屏蔽执行、面板可见**。

### 7.5 导入第三方格式（以 SillyTavern 预设为例）的五条教训

**① 判据以真原件为准，不以别人的转换器为准**
差点照抄某插件的转换器，直到在本机翻到 7 份真实的 ST 聊天补全预设（`<ST>\data\<user>\OpenAI Settings\*.json`），才发现二手实现漏了事实。**有原件就别看二手实现。**

**② 特征位不能当结构判据——必须白名单**
ST 的 `marker: true` 看着像"结构占位"，实际 `nsfw` / `jailbreak` / `enhanceDefinitions` 也带 marker **但有正文**。按特征位一刀切会静默丢掉真内容。
只能靠**已知占位清单**（`worldInfoBefore` / `worldInfoAfter` / `charDescription` / `chatHistory` / `main` …）判定，且要允许以后补清单。
> 通用形式：**"某字段为真"往往只是提示，不是定义**；定义在原件里，代码里把清单显式列出来。

**③ 开关常常不在对象上**
ST 的启停不在 `prompts[i].enabled`，而在 `prompt_order[].order[i].enabled`；`prompt_order` 还可能有多份（单聊/群聊），要取条目最多的那份。**读到"全是默认值"时先怀疑位置找错，而不是数据缺失。**

**④ 导入结果为空，必须是「解释过的空」**
`Default.json` 导入后只剩 1 条且停用——这是**正确结果**（`main` 是系统提示槽位、`nsfw`/`jailbreak` 正文 0 字节）。但用户看到"几乎没导进来"会以为解析坏了。
对策：导入预览给**丢弃分组摘要**（`结构占位 9 · 空内容 2`，只列非零项）+ 一句解释"这些定位由本插件自带的底线/纪律段承担"。
> 判据：**用户看到的"空"必须能自己解释清楚**，否则再正确也是 bug 体验。

**⑤ 验证时当心「对了一半」**
复算 7 份文件时字段名读错，导致"保留数全 0"，而"丢弃数"因为字段名恰好对了**完全正确**——这种一半对的结果最容易被当成通过。**每一列都要独立复算，别用一列的正确担保另一列。**

---

## 8. 排查表

| 现象 | 先看哪里 |
|---|---|
| 面板不出现 | crash log 的 web boot 行；`lib/client.js` 是否重建；`dsh.profile.bundles` 有没有条目 |
| 段注入了但会话失败 | 段是否 `interpolate:false`；卡里 `{{var}}` 是否被当宿主变量 |
| 启用后没生效 | 是否重启过 DSH（宿主侧改动不热加载）；`_active.json` 是否指着一张已删的卡 |
| 两个会话串台 | 决议函数是否读 `context.agent`；工具层是否还在用全局 `characterName` |
| 世界书该进没进 | 看 `/preview` 的 `lore.diag`；`keywordDropped` / `constantDropped` 里有名字就是被预算裁了 |
| 面板一拖文件就把卡发进对话 | 见坑 #21；关面板后拖放失效见坑 #22 |
| 产物里搜不到中文 | esbuild `\uXXXX`（坑 #19） |
| 产物里搜不到自己的函数名 | minify 改名（坑 #20） |
| 自检红但代码看着对 | 产物是否比源码旧（坑 #24）；断言是否绑死了实现位置（坑 #25） |
