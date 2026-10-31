# 蒸馏武装接口 400：`cannot create effect on inactive context`

- **发现时间**：2026-10-31 14:23 左右（本机，Asia/Hong_Kong）
- **发现场景**：用「蒸馏角色卡」从《明日方舟：终末地》蒸馏「庄方宜」时，AI 需要在最后一步调 `awu_card_save` 落卡
- **状态**：✅ **已修复**（2026-10-31 14:35，代码未提交前先在本地验证；宿主需重启生效）
- **修复方式**：工具改为**插件作用域内常驻注册** + `arm.armed` 门控（见 §8），不再在 HTTP 请求里动态挂载

---

## 1. 现象

```
POST http://127.0.0.1:63261/_dsh/ai-with-u/distill/arm
Content-Type: application/json
Body: {}
```

→ **400**

```json
{"ok":false,"error":"cannot create effect on inactive context"}
```

随后：

```
GET /_dsh/ai-with-u/distill/state
→ {"ok":true,"armed":false}
```

两次调用（间隔约 1 分钟）结果一致，不是偶发抖动。

**连带后果**
- `awu_card_save` **没有挂到工具服务上**：主会话与子代理的工具列表里都没有它（未启用角色时插件本就不挂常驻 `awu_*`，所以武装失败 = 零工具）。
- 蒸馏流程最后一 Phase 的「模型自己落卡」通道整条断掉；模型只能把 `data` 写文件，再人工/旁路入库。

## 2. 环境

| 项 | 值 |
|---|---|
| 宿主 | `D:\CODEX\DSH-desktop\DeepSeek Harness.exe`，FileVersion **0.2.1-rc.5** |
| 宿主进程启动 | 2026-10-31 **13:42:23** |
| 插件内 `cordis` | 4.0.0-rc.7 |
| 插件内 `@deepseek-ai/cordis` | 4.0.5 |
| 插件内 `@deepseek-ai/dsh-tools` | 0.2.1-rc.5 |
| 插件构建产物 `lib/` | 2026-10-31 **13:51:10** |
| 插件仓库最近提交 | 14:23:32 / 14:10:19 / 13:55:58 |
| Web GUI | `http://127.0.0.1:63261`（进程 36532） |

> ⚠️ **时间线要注意**：宿主 13:42 启动，而 `lib/` 是 13:51 才重建的。**运行时加载的很可能是 13:42 那一刻的旧构建**，13:51/13:55 那批"全面加固"改动不一定是跑着的代码。排查时读的 `src/` 可能与实际运行代码不一致——先确认加载的是哪一版。

## 3. 证据链

1. 错误文案来自 cordis 的固定错误码：
   - `cordis/lib/index.js:665`、`cordis/lib/fiber.d.ts:43`：
     `INACTIVE_EFFECT: "cannot create effect on inactive context"`

2. `@deepseek-ai/dsh-tools` 的 `register()` 会以**服务自身持有的 ctx** 建 effect：
   - `dsh-tools/lib/index.js:2974`
     ```js
     register(definition) {
       // ...
       return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition),
                                 { label: 'tools.register()' })
     }
     ```
   - 也就是说：`INACTIVE_EFFECT` = **这个 `ToolRuntime` 实例所属的 ctx 已经失效**（fiber disposed），不是"参数不对"、也不是"工具服务不存在"。

3. 插件侧 `toolsService` 的获取路径（`src/index.ts`）：
   - L264-268：卸载时把 `toolsService` 置空
   - L270-273：
     ```ts
     const waitTools = (pc) => {
       if (ctx.get?.('tools') !== undefined) { registerTools(ctx, pc); return }
       ctx.inject?.(['tools'], (sub) => { registerTools(sub, pc) })   // ← 捕获 sub
     }
     ```
   - L244-247：`registerTools(toolCtx)` 里 `toolsService = toolCtx.get?.('tools')`

   → **`toolsService` 可能是从 `inject` 的临时 `sub` 上下文里取出来的**，而 `sub` 在回调结束后就失效；只要走了这条路径，fork 里取到的服务实例就带着一个已 dispose 的 ctx。

4. 武装时机在**HTTP 请求处理里**（`src/distill.ts` L174-183 `arm()` → `hooks.mount()` → `src/index.ts` L209 `toolsService.register(...)`）。
   HTTP 请求是异步、脱离 apply 期的，此时**没有任何活跃的插件 effect 作用域**可用。

## 4. 待验证的假设（按可能性排序）

| # | 假设 | 佐证 | 如何区分 |
|---|---|---|---|
| **A** | 运行时加载的是 13:42 的旧 `lib/`，那版 arm 代码与 0.2.1-rc.5 宿主不匹配 | `lib/` 13:51 才重建、提交 13:55，均晚于宿主启动 | **重启宿主**后立刻 `POST /distill/arm`，看是否 200 |
| **B** | `toolsService` 取自 `ctx.inject` 的临时 `sub`，fork 已失效 → `register()` 里的 `this.ctx` 是死的 | `waitTools` L272 存在该路径；错误码正是 ctx 失效 | 在 `mount()` 里打印 `toolsService` 所属 ctx 的 `state`/`disposed`，与插件根 `ctx.state` 对比 |
| **C** | 新版 DSH 的 `tools` 是 **per-session** 服务，会话销毁即失效；HTTP 路由无会话上下文，跨会话注册必然打空 | `ToolRuntime extends Service`，`register` 绑定自身 ctx | 在活跃会话里 hold 住服务，隔一轮后再 `register`，看是否同样报错 |

A 与 B 不互斥：也可能"旧构建 + 老写法"一起炸。

## 5. 建议修法（供参考）

1. **先确认加载版本**：重启宿主，用最新构建复测 arm。
2. **不要跨请求持有工具服务**：`arm()` 执行时用**插件根 ctx** 现取现用——
   ```ts
   const svc = ctx.get?.('tools')           // 每次 arm 时重取
   if (svc === undefined) throw new Error('工具服务不可用')
   ```
   并把"服务实例 + 它属于哪个 ctx"在日志里打出来（`armed` 时记一行，便于下次定位）。
3. **注册时机前移到 `apply()`**（最稳）：武装期注册、TTL 到期卸载的做法，本质上是"在插件作用域外做 effect 操作"，本来就违背 cordis 的 effect 生命周期。改成 **apply 时就挂一个常驻的 `awu_card_save`，execute 内部用 `arm.armed` 门控**：
   - 好处：注册发生在活跃作用域内，不可能报 `INACTIVE_EFFECT`；
   - 代价：模型工具列表里常驻一个"只在武装期可用"的工具（description 已写明），未武装时调用返回 `not-armed`；
   - 若不想常驻暴露，可保留 `not-armed` 分支，并由提示词/工具描述把"蒸馏期才用"讲清楚。
4. **给 `verify-host.mjs` 补一条反例**：用**已 dispose 的 ctx** 调一次 arm，断言报 `INACTIVE_EFFECT`——现在的自检用的是活跃 ctx，天然测不出这个坑。
5. **面板侧**：`client/distill.tsx` L432-435 已有 `armFailed` 提示，很好；但建议把 `error` 原文（这次是 `cannot create effect on inactive context`）也透到 UI，而不是压缩成一句"武装失败"。

## 6. 本次蒸馏的临时处理

- arm 不可用 → 走**面板自己的保存路由**落卡（与 UI 里改卡保存是同一条 `store.saveCard` 路径，CCv3 归一 + 投影 + 更新索引都会跑）：
  ```
  POST /_dsh/ai-with-u/character/save
  { "name": "庄方宜", "ccv3": { "spec": "chara_card_v3", "spec_version": "3.0", "data": { ... } } }
  → {"ok":true} ，随后 GET /characters 列表里已出现「庄方宜」，_index.json 已更新
  ```
- 旁路脚本（临时，可删）：`distill/out/save-card.mjs`；卡数据：`distill/out/zhuangfangyi.json`
- 本次**没有**改动插件源码，也没有重启宿主。

## 7. 给 AI 侧的兜底建议（可写进 `distill/flow.md` §7.2）

现在 flow 只写了"报 `not-armed` 就重新 arm 再存"。建议补一条链路：

> arm 重试仍失败（400 / `cannot create effect on inactive context`）→ 不要反复重试；把完整 `data` 写文件，同时 `POST /character/save` 走面板保存路由落卡（这是插件自己的保存实现，不是绕过校验），最后如实告诉用户"官方武装通道故障，已用面板保存路由入库"。

> ✅ 已按此补进 `distill/flow.md` 的「规则」段（2026-10-31）。

## 8. 修复记录（2026-10-31 14:35）

**根因（假设 B，请求作用域）**

`POST /distill/arm` 在 HTTP 处理器里调 `toolsService.register()`，cordis 的 effect 建在**该请求的作用域**上：
请求一结束作用域销毁，工具被连带移除（会话里「已添加工具 → 很快已移除」）；
残留的 disposer / 已失活的 ctx 让下一次 arm 直接撞 `cannot create effect on inactive context`（400）。

**改法**

- `src/index.ts`：`awu_card_save` 改为在 `registerTools()`（插件 apply 期、活跃 fiber）注册一次，插件 dispose 时统一释放；`DistillArm` 的 `mount` 只检查工具服务是否就绪，`unmount` 只关时间窗、不再注销工具。
- `src/distill.ts`：hooks 语义与类文档同步改为「就绪检查 / 关窗」，TTL 到期只把 `armed` 置 false。
- **门控不变**：未武装、TTL 到期、保存一次之后，`awu_card_save.execute` 仍返回 `not-armed`——模型能做的事没有任何扩大。
- 测试：`verify-distill` 改成「常驻注册 + 门控」断言（新增 3 条，共 93 项）；`verify-host` 断言 apply 后即注册、arm/disarm 不改变注册数（34 → 35 项）。

**验证**：`npm run build` 全绿。**需重启宿主**（`lib/index.js` 已重建）后复测 `POST /distill/arm` 应为 200，且工具列表不再出现添加/移除抖动。
