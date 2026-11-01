/**
 * dsh-ai-with-u · 角色扮演管理器
 *
 * 定位：聊天走正常 DSH 会话，插件只管「人设插拔 + 管理 + 查看」。
 *
 * 加载时序（全部经读源码核实）：
 *   1. 种子预置卡（幂等，characters/ 存在则不碰）
 *   2. 恢复上次启用态（_active.json）
 *   3. 等 systemPrompt 就绪 → 注册 L0 常驻段 + L1 可空角色段
 *   4. 等 tools 就绪 → 绑定启用/退出钩子，动态挂载 awu_* 工具
 *   5. 等 webServer 就绪 → 注册 /_dsh/ai-with-u/* 面板接口
 *   6. 挂 agent 事件钩子 → 每轮对话后把会话状态写进 session.json
 *
 * 三条服务依赖都用 ctx.inject() 声明式等待，缺哪个就少一个功能，
 * 插件本身不会因宿主裁剪服务而加载失败。
 *
 * 会话写入（本文件的关键职责，修复「session.json 只读不写」）：
 *   - `agent/pre-step`（waterfall）：每轮开始时刷新提示词缓存，让「距上次互动」
 *     用的是磁盘上最新的 last_ts；
 *   - `agent/turn-stopping`（serial）：一轮真正结束时把 turn_count / last_ts /
 *     recent 写进 session.json，再刷新缓存供下一轮组装使用。
 * 必须用 turn-stopping 而不是 pre-step 来计数：pre-step 在工具循环里每步都会触发，
 * 用它计数会把一轮对话算成好几轮。
 * @module dsh-ai-with-u
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context, Inject } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { Store } from './store.js'
import { PromptController } from './prompt.js'
import { createTools, createCardSaveTool } from './tools.js'
import { DistillArm } from './distill.js'
import { buildRoutes, ROUTE_PREFIX } from './web.js'

export const name = 'ai-with-u'

/**
 * 硬依赖只有 systemPrompt —— 没有人设注入，这个插件就失去意义。
 * tools / webServer / agents 走 ctx.get / ctx.inject 可选等待。
 *
 * 类型直接来自宿主真实包（`@deepseek-ai/cordis` 的 `Inject`），所以「写成对象形式」
 * 或「把 mixin 方法当服务名」这两类历史错误现在会在 tsc 阶段直接报错，
 * 而不是等到插件 failed 却不给原因。
 */
export const inject: Inject = ['systemPrompt']

/** 复用宿主 `PromptSection` 的真实形状（name / order / text / interpolate）。 */
type SectionInput = PromptSection

interface AnyCtx {
  systemPrompt: { section: (input: SectionInput) => () => void }
  tools?: { register: (tool: unknown) => () => void }
  webServer?: {
    register: (input: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: unknown, res: unknown) => void | Promise<void>
    }) => () => void
  }
  logger?: {
    info: (msg: string, ...args: unknown[]) => void
    warn: (msg: string, ...args: unknown[]) => void
    error: (msg: string, ...args: unknown[]) => void
  }
  /**
   * 读服务但不触发 inject 校验。Cordis 4 的 Context 是 Proxy，访问未在 inject
   * 里声明的服务会直接抛 `cannot get property "x" without inject`，所以可选服务
   * 一律走 ctx.get() 探测。
   *
   * 语义（cordis `reflect.ts` 源码核实）：`get()` 只查 isolate 映射与 store，
   * **不看 inject 声明**；未激活的服务返回 undefined。所以它能用来探测「就绪没」，
   * 但声明式 `ctx.inject([...], cb)` 仍然更稳（宿主会等依赖，不需要轮询）。
   */
  get?: (name: string, strict?: boolean) => unknown
  inject?: (deps: string[], callback: (ctx: AnyCtx) => void | (() => void)) => void
  effect?: (fn: () => (() => void) | void, label?: string) => void
  on?: (name: string, listener: (...args: never[]) => unknown, options?: unknown) => (() => void)
}

/** agent 事件里我们真正用到的字段（宽松类型，宿主换版本也不至于崩）。 */
interface AgentLike {
  id?: string
  session?: SessionLike
}
interface SessionLike {
  id?: string
  log?: Array<{ type?: string; seq?: number; data?: unknown }>
  snapshotEvents?: (from?: number, to?: number) => Array<{ type?: string; data?: unknown }>
  events?: Array<{ type?: string; data?: unknown }>
}

interface TurnStoppingPayload { agent?: AgentLike; turn?: number; signal?: AbortSignal }
interface PreStepPayload { agent?: AgentLike; signal?: AbortSignal; turn?: number; step?: number }

function makeLogger(ctx: AnyCtx) {
  const l = ctx.logger
  return {
    info: (m: string, ...a: unknown[]): void => { l?.info(`[ai-with-u] ${m}`, ...a) },
    warn: (m: string, ...a: unknown[]): void => { l?.warn(`[ai-with-u] ${m}`, ...a) },
    error: (m: string, ...a: unknown[]): void => { l?.error(`[ai-with-u] ${m}`, ...a) },
  }
}

/**
 * 从 session 的事件日志里取本轮摘要素材：最后一条用户消息与最后一条模型回复。
 * 事件结构经读 dsh-session 源码核实：user 消息就是 `data` 本身，
 * assistant 消息在 `data.message`，两者的 text 块都是 `{type:'text', text}`。
 */
/** 从一条消息事件里抽纯文本（`data.content` 里所有 text 块拼接）。 */
function textOfMessage(message: unknown): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const b = block as { type?: string; text?: unknown }
      return b.type === 'text' && typeof b.text === 'string' ? b.text : ''
    })
    .filter(s => s !== '')
    .join(' ')
    .trim()
}

/** 取会话日志里最近若干条 user / assistant 文本（按时间升序），给世界书做关键词素材。 */
export function extractRecentTexts(session: SessionLike | undefined, limit = 6): string[] {
  if (session === undefined) return []
  let events: Array<{ type?: string; data?: unknown }> = []
  try {
    if (typeof session.snapshotEvents === 'function') events = session.snapshotEvents()
    else if (Array.isArray(session.log)) events = session.log
    else if (Array.isArray(session.events)) events = session.events
  } catch (error) {
    process.stderr.write(`[ai-with-u] 读取会话事件失败，世界书命中素材为空：${error instanceof Error ? error.message : String(error)}\n`)
    return []
  }
  const texts: string[] = []
  for (let i = events.length - 1; i >= 0 && texts.length < limit; i -= 1) {
    const event = events[i]
    if (event === undefined) continue
    let text = ''
    if (event.type === 'user/message') text = textOfMessage(event.data)
    else if (event.type === 'assistant/message') {
      text = textOfMessage((event.data as { message?: unknown } | undefined)?.message)
    }
    if (text !== '') texts.push(text)
  }
  return texts.reverse()
}

export function extractTurnTexts(session: SessionLike | undefined): { user: string; assistant: string } {
  const empty = { user: '', assistant: '' }
  if (session === undefined) return empty
  let events: Array<{ type?: string; data?: unknown }> = []
  try {
    if (typeof session.snapshotEvents === 'function') events = session.snapshotEvents()
    else if (Array.isArray(session.log)) events = session.log
    else if (Array.isArray(session.events)) events = session.events
  } catch (error) {
    // 会话日志读不出来时本轮摘要为空是安全的，但原因必须留痕
    process.stderr.write(`[ai-with-u] 读取会话事件失败，本轮摘要留空：${error instanceof Error ? error.message : String(error)}\n`)
    return empty
  }
  const textOf = textOfMessage
  let user = ''
  let assistant = ''
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event === undefined) continue
    if (user === '' && event.type === 'user/message') user = textOf(event.data)
    else if (assistant === '' && event.type === 'assistant/message') {
      const message = (event.data as { message?: unknown } | undefined)?.message
      assistant = textOf(message)
    }
    if (user !== '' && assistant !== '') break
  }
  return { user, assistant }
}

export function apply(context: Context): () => void {
  // 内部仍用宽松 duck type：服务是可选的、宿主版本会漂移；
  // 入口签名用真实 Context 已经能挡住「apply 形状不对」这类契约错误。
  const ctx = context as unknown as AnyCtx
  const log = makeLogger(ctx)
  const store = new Store()
  const presetRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets')
  const disposers: Array<() => void> = []
  let prompt: PromptController | undefined

  // ---------------------------------------------------------------- 0. 蒸馏武装（内存态）
  /**
   * 「时间窗武装」：`awu_card_save` 常驻挂载，`armed` 只控制它是否可用。
   *
   * 三条设计约束（主人拍板）：
   *   1. **不落盘**：重启即失效——避免模型在任何会话里突然获得写卡能力；
   *   2. **与角色启用无关**：蒸馏不需要先启用角色，所以这条挂载路径不经过 `createTools`；
   *   3. **工具服务未就绪就武装失败**：不能"面板说武装了、模型却没有工具"。
   *
   * 与早期版本的差别只有一处：注册时机从「HTTP 请求里动态挂载」改成「插件 apply 时注册一次」。
   * 门控（`not-armed`）没有变，模型在未武装期依然拿不到写卡能力。
   */
  let toolsService: AnyCtx['tools'] | undefined
  let cardSaveDisposer: (() => void) | undefined
  /**
   * ⚠️ 2026-10-31 修：`awu_card_save` 改为**插件作用域内一次性注册**，不再由
   * `POST /distill/arm` 动态挂载。
   *
   * 原因：HTTP 处理器里调 `tools.register()` 会在**请求作用域**里建 effect，请求结束
   * 该作用域销毁，工具被连带移除（会话里的表现就是「已添加工具 → 很快又已移除」）；
   * 再次武装时还会撞上 `cannot create effect on inactive context`（400）。
   *
   * 现在的门控在工具内部：`arm.armed` 为 false 时 `awu_card_save` 一律返回 `not-armed`，
   * 与「工具不存在」对模型的效果一致，但注册发生在活跃的插件 fiber 里，不可能失效。
   */
  const distillArm = new DistillArm({
    mount: (): boolean => {
      if (toolsService === undefined) {
        log.warn('蒸馏武装失败：工具服务未就绪')
        return false
      }
      return true
    },
    unmount: (): void => {
      log.info('蒸馏武装：时间窗已关闭（awu_card_save 保留，调用会返回 not-armed）')
    },
  })

  // ---------------------------------------------------------------- 1+2. 初始化
  /** 初始化完成后回调解锁，避免轮询。 */
  const ready = new Promise<PromptController>((resolve, reject) => {
    void (async () => {
      const seeded = await store.seedPresets(presetRoot)
      if (seeded > 0) log.info(`已种入 ${seeded} 张预置角色卡`)
      const pc = new PromptController(store, { sys: ctx.systemPrompt, logger: log })
      await pc.restore()
      pc.install()
      prompt = pc
      const active = pc.snapshot()
      log.info(active.enabled
        ? `已恢复启用角色：${active.character ?? ''}`
        : '当前未启用角色（干净状态）')
      resolve(pc)
    })().catch((error: unknown) => {
      log.error('初始化失败：%s', error instanceof Error ? error.message : String(error))
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })

  // ---------------------------------------------------------------- 3. 工具（可选）
  const pendingSync: Array<() => void> = []
  const registerTools = (toolCtx: AnyCtx, pc: PromptController): void => {
    const tools = toolCtx.get?.('tools') as AnyCtx['tools']
    if (tools === undefined) return
    toolsService = tools
    // 写卡工具在插件作用域内注册一次即可（见上面对 INACTIVE_EFFECT 的说明）
    if (cardSaveDisposer === undefined) {
      cardSaveDisposer = tools.register(createCardSaveTool(store, distillArm))
      log.info('已挂载 awu_card_save（常驻，仅蒸馏武装期可用）')
    }
    let toolDisposers: Array<() => void> = []
    const sync = (): void => {
      // 工具该不该挂：**全局启用** 或 **至少有一个会话绑定**（会话绑定下也要能记日记/查关系）
      const should = pc.characterName !== undefined
        || Object.values(pc.bindingSnapshot()).some(binding => binding.dead !== true)
      if (should && toolDisposers.length === 0) {
        toolDisposers = createTools(store, pc).map(t => tools.register(t))
        log.info(`已挂载 ${toolDisposers.length} 个 awu_* 工具`)
      } else if (!should && toolDisposers.length > 0) {
        for (const d of toolDisposers.reverse()) d()
        toolDisposers = []
        log.info('已卸下 awu_* 工具')
      }
    }
    pendingSync.push(() => { sync() })
    sync()
    disposers.push(() => {
      // 先关时间窗，再卸常驻工具，最后把服务引用清掉（避免卸载后还能 mount）
      distillArm.disarm()
      if (cardSaveDisposer !== undefined) {
        cardSaveDisposer()
        cardSaveDisposer = undefined
      }
      toolsService = undefined
      for (const d of toolDisposers.reverse()) d()
    })
  }

  const waitTools = (pc: PromptController): void => {
    if (ctx.get?.('tools') !== undefined) { registerTools(ctx, pc); return }
    ctx.inject?.(['tools'], (sub) => { registerTools(sub, pc) })
  }

  // ---------------------------------------------------------------- 4. Web 路由（可选）
  const registerRoutes = (webCtx: AnyCtx, pc: PromptController): void => {
    const web = webCtx.get?.('webServer') as AnyCtx['webServer']
    if (web === undefined) return
    for (const route of buildRoutes(store, pc, distillArm)) {
      disposers.push(web.register({
        kind: 'exact',
        path: route.path,
        handler: (req, res) => route.handler(req as never, res as never),
      }))
    }
    log.info(`已注册面板接口：${ROUTE_PREFIX}/*`)
  }

  const waitWeb = (pc: PromptController): void => {
    if (ctx.get?.('webServer') !== undefined) { registerRoutes(ctx, pc); return }
    ctx.inject?.(['webServer'], (sub) => { registerRoutes(sub, pc) })
  }

  // ---------------------------------------------------------------- 5. 会话写入钩子
  /** 从 agent 上取会话 id（`agent.session.id` 优先，退 `agent.id`）——会话绑定的唯一键。 */
  const sessionIdOfAgent = (agent: AgentLike | undefined): string | undefined => {
    const fromSession = agent?.session?.id
    if (typeof fromSession === 'string' && fromSession.trim() !== '') return fromSession.trim()
    const fromAgent = agent?.id
    return typeof fromAgent === 'string' && fromAgent.trim() !== '' ? fromAgent.trim() : undefined
  }

  /**
   * 一轮对话结束 → 写 session.json。
   *
   * 按**该会话的决议角色**写（会话绑定 > 全局启用 > 未启用）：会话绑了 A、全局启用 B 时，
   * 这个会话的轮次必须落在 A 的 session.json 上，否则两个角色的记忆会互相串。
   * 写失败**只记日志不抛**（原 skill run_config §三），turnId 用 `agentId:turn` 去重。
   */
  const commitTurnFromAgent = async (agent: AgentLike | undefined, turn: number | undefined): Promise<void> => {
    const pc = prompt
    if (pc === undefined) return
    const sessionId = sessionIdOfAgent(agent)
    const character = pc.characterForSession(sessionId)
    if (character === undefined) return
    const session = agent?.session
    const texts = extractTurnTexts(session)
    const turnId = `${String(agent?.id ?? session?.id ?? 'agent')}:${String(turn ?? '?')}`
    try {
      const result = await store.commitTurn({
        character,
        user: texts.user,
        assistant: texts.assistant,
        turnId,
        // 统一口径：session.mode 优先于 _active.mode（见 store.resolveInteractionMode）。
        // 直接写 snapshot().mode 会用全局兜底值覆盖用户在会话里切过的模式。
        mode: await pc.resolvedMode(sessionId),
        // topic / mood 由 awu_diary_write 在同一次写盘事务里维护（不在这里编造）
      })
      if (result.written) {
        log.info(`会话已写盘：${character}（会话 ${sessionId ?? '全局'}）第 ${String(result.session?.turn_count ?? 0)} 轮`)
        await pc.refresh(log, sessionId === undefined ? undefined : { sessionId })
      }
    } catch (error) {
      log.error('写 session.json 失败（本轮降级为纯上下文，下轮重试）：%s',
        error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * 每轮开始时刷新缓存（**只刷这个会话的槽位**）：既保证时间差读到磁盘上最新的 last_ts，
   * 也把「最近几条对话原文」交给世界书做关键词匹配（`session.recent` 摘要会被截断，原文更准）。
   */
  const refreshBeforeStep = async (agent: AgentLike | undefined, turn: number | undefined): Promise<void> => {
    const pc = prompt
    if (pc === undefined) return
    try {
      const sessionId = sessionIdOfAgent(agent)
      if (pc.characterForSession(sessionId) === undefined) return
      const session = agent?.session
      const recentTexts = extractRecentTexts(session)
      const turnKey = `${String(agent?.id ?? session?.id ?? 'agent')}:${String(turn ?? '?')}`
      await pc.refresh(log, { recentTexts, turnKey, ...(sessionId === undefined ? {} : { sessionId }) })
    } catch (error) {
      log.error('轮前刷新提示词缓存失败：%s', error instanceof Error ? error.message : String(error))
    }
  }

  const registerAgentHooks = (): void => {
    // ctx.on 返回 Cordis effect disposer（源码核实：register → fiber.effect）。
    // 通过 ctx.get 探测一次，避免 Proxy 直接读属性抛 `without inject`。
    const events = ctx.get?.('events') as { on?: AnyCtx['on'] } | undefined
    const on: AnyCtx['on'] | undefined = typeof events?.on === 'function'
      ? events.on.bind(events)
      : ctx.on
    if (typeof on !== 'function') {
      log.warn('宿主没有 ctx.on，会话状态不会自动写盘（面板手动接口仍可用）')
      return
    }
    // 子代理 / 任务看板 / 定时会话都是独立 agent；它们的一轮对话不该写进
    // 用户角色的 session.json（否则 L1 的「上次聊到哪」会被无关内容污染）。
    // 宿主 registry 用 `roots()` 明确给出「没有 owner 的顶层 agent」，直接用它判定。
    const agents = ctx.get?.('agents') as { roots?: () => AgentLike[] } | undefined
    const isSubAgent = (agent: AgentLike | undefined): boolean => {
      if (agent === undefined || typeof agents?.roots !== 'function') return false
      try {
        const roots = agents.roots()
        // 取不到根列表时按「不是子代理」处理：宁可多写一轮，也不静默丢掉主会话
        return roots.length > 0 && !roots.includes(agent)
      } catch {
        return false
      }
    }
    const safe = (label: string, fn: () => Promise<void>): void => {
      // 事件回调里绝不抛出：Cordis 的 hooks 是同步派发的，抛错会被宿主吞成一条 warn，
      // 这里自己兜住并把原因打全，便于排查。
      void fn().catch((error: unknown) => {
        log.error('%s 处理失败：%s', label, error instanceof Error ? error.message : String(error))
      })
    }

    // pre-step 是 waterfall：必须调用 next() 把控制权交下去，否则这一轮就进不去了。
    // 刷新只是「尽力而为」，不 await 它的结果也能保证 next() 被调用。
    const disposePre = on('agent/pre-step', ((payload: PreStepPayload, next: () => unknown) => {
      if (!isSubAgent(payload?.agent)) {
        safe('agent/pre-step', () => refreshBeforeStep(payload?.agent, payload?.turn))
      }
      return next()
    }) as never)
    if (typeof disposePre === 'function') disposers.push(disposePre)

    // turn-stopping 是 serial：一轮真正收尾时触发，只在这里计数（pre-step 每步都会触发）
    const disposeStop = on('agent/turn-stopping', ((payload: TurnStoppingPayload) => {
      if (isSubAgent(payload?.agent)) return
      safe('agent/turn-stopping', () => commitTurnFromAgent(payload?.agent, payload?.turn))
    }) as never)
    if (typeof disposeStop === 'function') disposers.push(disposeStop)

    log.info('已挂载会话钩子：agent/pre-step（轮前刷新）+ agent/turn-stopping（轮后写盘），仅根 agent 生效')
  }

  // 等服务就绪后再挂：初始化是异步的，必须等 prompt 构造好
  void ready.then((pc) => {
    pc.onStateChange(() => { for (const fn of pendingSync) fn() })
    waitTools(pc)
    waitWeb(pc)
    registerAgentHooks()
  }).catch((error: unknown) => {
    // 初始化失败的日志已在上面打过，这里只补一句上下文，不静默吞掉
    log.error('插件未完成初始化，工具与面板接口不会挂载：%s',
      error instanceof Error ? error.message : String(error))
  })

  // ---------------------------------------------------------------- 卸载
  return () => {
    distillArm.disarm()
    prompt?.uninstall()
    for (const d of disposers.reverse()) {
      try { d() } catch (error) {
        log.warn('释放注册项失败：%s', error instanceof Error ? error.message : String(error))
      }
    }
    disposers.length = 0
    log.info('已卸载')
  }
}
