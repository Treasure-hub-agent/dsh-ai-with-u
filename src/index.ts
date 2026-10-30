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
import { Store } from './store.js'
import { PromptController } from './prompt.js'
import { createTools } from './tools.js'
import { buildRoutes, ROUTE_PREFIX } from './web.js'

export const name = 'ai-with-u'

/**
 * 硬依赖只有 systemPrompt —— 没有人设注入，这个插件就失去意义。
 * tools / webServer / agents 走 ctx.get / ctx.inject 可选等待。
 * 注意：Cordis 的 Inject 类型是 `(keyof M)[] | {name: interceptConfig}`，
 * 写成 {required, optional} 会被误解析成服务名，导致插件挂起。
 */
export const inject: string[] = ['systemPrompt']

interface SectionInput {
  name: string
  order: number
  text: string | ((ctx: unknown) => string)
}

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
   * 注意：ctx.get(name, strict=true) 对「还没激活」的服务返回 undefined，
   * 这也是探测「服务是否就绪」的可靠方式。
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
  const textOf = (message: unknown): string => {
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

export function apply(ctx: AnyCtx): () => void {
  const log = makeLogger(ctx)
  const store = new Store()
  const presetRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets')
  const disposers: Array<() => void> = []
  let prompt: PromptController | undefined

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
    let toolDisposers: Array<() => void> = []
    const sync = (): void => {
      const should = pc.characterName !== undefined
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
    disposers.push(() => { for (const d of toolDisposers.reverse()) d() })
  }

  const waitTools = (pc: PromptController): void => {
    if (ctx.get?.('tools') !== undefined) { registerTools(ctx, pc); return }
    ctx.inject?.(['tools'], (sub) => { registerTools(sub, pc) })
  }

  // ---------------------------------------------------------------- 4. Web 路由（可选）
  const registerRoutes = (webCtx: AnyCtx, pc: PromptController): void => {
    const web = webCtx.get?.('webServer') as AnyCtx['webServer']
    if (web === undefined) return
    for (const route of buildRoutes(store, pc)) {
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
  /**
   * 一轮对话结束 → 写 session.json。
   *
   * 只在启用角色时写；写失败**只记日志不抛**（原 skill run_config §三：文件不可写
   * 时降级为纯上下文，对话不中断，下轮重试）。turnId 用 `agentId:turn` 去重，
   * 同一轮重复触发只写一次。
   */
  const commitTurnFromAgent = async (agent: AgentLike | undefined, turn: number | undefined): Promise<void> => {
    const pc = prompt
    if (pc === undefined) return
    const character = pc.characterName
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
        mode: pc.snapshot().mode,
      })
      if (result.written) {
        log.info(`会话已写盘：${character} 第 ${String(result.session?.turn_count ?? 0)} 轮`)
        await pc.refresh(log)
      }
    } catch (error) {
      log.error('写 session.json 失败（本轮降级为纯上下文，下轮重试）：%s',
        error instanceof Error ? error.message : String(error))
    }
  }

  /** 每轮开始时刷新缓存，保证时间差读到的是磁盘上最新的 last_ts。 */
  const refreshBeforeStep = async (agent: AgentLike | undefined): Promise<void> => {
    const pc = prompt
    if (pc === undefined || pc.characterName === undefined) return
    try {
      await pc.refresh(log)
    } catch (error) {
      log.error('轮前刷新提示词缓存失败：%s', error instanceof Error ? error.message : String(error))
    }
    void agent
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
      safe('agent/pre-step', () => refreshBeforeStep(payload?.agent))
      return next()
    }) as never)
    if (typeof disposePre === 'function') disposers.push(disposePre)

    // turn-stopping 是 serial：一轮真正收尾时触发，只在这里计数（pre-step 每步都会触发）
    const disposeStop = on('agent/turn-stopping', ((payload: TurnStoppingPayload) => {
      safe('agent/turn-stopping', () => commitTurnFromAgent(payload?.agent, payload?.turn))
    }) as never)
    if (typeof disposeStop === 'function') disposers.push(disposeStop)

    log.info('已挂载会话钩子：agent/pre-step（轮前刷新）+ agent/turn-stopping（轮后写盘）')
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
