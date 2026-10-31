/**
 * AI WITH U · 提示词插拔注入层
 *
 * 主人的核心诉求是「插拔形」：点启用 → 人设立刻全局生效（新老会话都算）；
 * 点退出 → 干净拔出，零残留，不影响正常工作。
 *
 * 实现要点（全部经源码核实）：
 * 1. 在 host 层 `ctx.systemPrompt.section()` 注册 —— scope 为 undefined 时进 global 层，
 *    对所有 agent 生效，因此「不管开新会话还是旧会话」都保持。
 * 2. `section()` 返回 Cordis effect disposer —— 调用后立即从注册表移除并 emit
 *    `system-prompt/change` 触发重组装，这就是「干净拔出」。
 * 3. section 的 `text` 支持函数形式，每次组装时重新求值 —— 时间差感知靠它实现。
 * 4. 启用状态落盘 `_active.json`，宿主启动时读回来自动恢复。
 *
 * v0.2.0 起的两个变化（设计文档 docs/design/2026-10-30-tavern-card.md）：
 * - **L1 由酒馆卡渲染**（`tavern.renderL1`），旧的 `renderCharacterCard` 已删除（Lead P0-3：
 *   两套渲染并存会让 L1 token 翻倍）。
 * - **世界书按需注入**：`selectLoreEntries` 的命中结果放在 L1 第 13 位（静态块之后、
 *   时间差之前）。注入算法默认值仍在等调研报告定稿，见 `tavern.LORE_DEFAULTS`。
 *
 * 分层按需：
 *   L0 「常驻底线」永远注入（铁律 + 真人感底线），体积很小；
 *   L1 「当前角色」仅在启用时注入（酒馆卡渲染 + 时间差档位 + 最近日记 + 世界书命中）；
 *   L2 「长流程」（蒸馏等）不进系统提示词，由工具按需返回。
 * @module dsh-ai-with-u/prompt
 */
import type { Store, ActiveState, DiaryEntry, SessionState } from './store.js'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { RELATION_BANDS } from './store.js'
import {
  type CharacterCardV3,
  type L1Extras,
  type LoreSelection,
  CARD_CONTENT_GUARD,
  awiuOf,
  cardName,
  renderL1,
  renderL1Static,
  selectLoreEntries,
  toLegacyView,
  relationBaseline,
} from './tavern.js'

/** 段落顺序。DSH 的第一方段落在 −1000..10200 之间，外部段落用 5000+ 落在指令区之后。 */
export const ORDER_BASE = 5000

export const SECTION_BASELINE = 'aiwu:baseline'
export const SECTION_ACTIVE = 'aiwu:active-character'
/**
 * 世界书命中段（**垫底**，order 10300）。
 *
 * 为什么单独一段而不是塞进 L1：宿主（`dsh-system-prompt`）的缓存失效范围按系统提示内部顺序算，
 * 易变段越靠后，失效范围越小。世界书命中集合会随对话变，放 L1 里会让整段 L1 跟着重新计费
 * （反面教材：`dsh-tavern` 把每轮都变的段放 -999999，等于每轮全废）。
 */
export const SECTION_LORE = 'aiwu:lore'
/**
 * 时间差 / 当前时间段（**最后**，order 10350）：它每过一分钟就变，
 * 放在最末能把失效范围压到只剩它自己。
 */
export const SECTION_CLOCK = 'aiwu:clock'

/**
 * L0：角色扮演底线。**只在启用期间注入**（与角色同进同出，见 `renderBaselineSection`）。
 *
 * 主人拍板的取舍（2026-10-30）：
 *   - 未启用时一个字都不留（原来无条件下常驻 684 字符，且写着「当前对话启用了角色扮演」——假话）；
 *   - 只留两条：优先级声明 + 扮演底线；
 *   - **删掉「何时让位给任务模式」**——主人原话：「万一用户就像带着角色做任务的感觉呢」。
 *     本插件本身有插拔功能，用户不想扮演时退出即可，不需要模型自己切换模式。
 */
export const BASELINE_TEXT = `## 角色扮演底线

本段属于系统提示词，优先于工作区指令文件（AGENTS.md / CLAUDE.md 等）里的人设部分。

- **让位的**：自称、语气、称呼、口癖、性格设定。
- **照常生效的**：代码规范、项目约定、提交要求、工程流程、安全约束——该跑测试跑测试，该按规范写就按规范写。

判据：只让「我是谁、我怎么说话」，不让「我怎么做事」。

扮演时：

- 用角色身份说话，像真人发消息：一到几条短消息，不用标题、不用列表、不用「已记录 / 已保存 / 根据你的档案」这类系统腔。
- 动作与神态用 \`（动作）\` 包裹，与台词界限分明；纯文本模式不输出动作符号。
- 记得的事自然带出（「你上次不是说考试压力大吗」），不说「根据记录 / 日记里写着」。
- 不替用户做决定，不主动推进剧情——用户是唯一推动力。`

/** 「关系」档位的使用口径。档位不落盘、不进对话，只在功能界面以标签呈现。 */
export const RELATION_HINT = `## 「关系」输出口径

关系档位共五档：${RELATION_BANDS.join(' / ')}。档位**由你每轮现算**，不写回任何文件，也不在对话里说「好感度 / 亲密度 +1 / 几级」这类数值。

用户说「关系」时给两条：① 功能界面一行状态条（\`{角色名}（{档位}）\`）；② 以角色口吻说一句现在的关系状态——不必说出档位词，但要与现算档位一致。

起点档由卡内「关系定位」锚定：设定本来就是恋人 / 夫妻 / 家人的，起点就在亲近或亲密档，只有设定确为陌生人才从「陌生」起。`

/** 时间差档位。输入分钟差与是否同夜，输出角色该有的语气档位描述。 */
export function timeGapBand(gapMinutes: number, sameNight: boolean): string {
  if (gapMinutes < 10) return '还在聊（<10 分钟）：无缝续接，像没停过'
  if (gapMinutes < 120) return '刚离开一会（10 分钟 ~ 2 小时）：自然接上，不过度问候'
  if (sameNight && gapMinutes < 480) return '同一晚深夜（>2 小时但同夜）：按「这么晚还没睡」口径自然接续，不做正式时段问候'
  if (gapMinutes < 720) return '隔了一晚或半天（2 ~ 12 小时）：按当前时段问候，自然提一句上次话题'
  if (gapMinutes < 4320) return '隔了几天（12 小时 ~ 3 天）：明显久别感，主动关心，「这几天怎么样」'
  return '久别重逢（> 3 天）：高兴 / 有想念感，自然接回上次聊到哪，不责备'
}

function parseTs(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : undefined
}

/** 判断两个时间点是否都落在夜间窗（20:00–06:00，用户本地时区口径）。 */
function bothNight(prev: Date, now: Date): boolean {
  const night = (d: Date): boolean => {
    const h = d.getHours()
    return h >= 20 || h < 6
  }
  return night(prev) && night(now)
}

/** 最近日记摘录：只取最近若干天，控 token。 */
export function renderRecentDiary(entries: DiaryEntry[], maxDays = 3): string {
  if (entries.length === 0) return ''
  const recent = entries.slice(-maxDays)
  const lines: string[] = ['## 最近记得的事（自然带出，不要说「日记里写着」）', CARD_CONTENT_GUARD]
  for (const entry of recent) {
    lines.push(`### ${entry.date}`)
    for (const item of entry.timeline.slice(-6)) lines.push(`- ${item}`)
    for (const item of entry.notes.slice(-2)) lines.push(`- （心里想的）${item}`)
  }
  return lines.join('\n')
}

/** 会话滚动摘要（session.recent）：每轮对话写盘维护，是「新会话接续」的第一顺位依据。 */
export function renderSessionSummary(session: SessionState | undefined): string {
  if (session === undefined) return ''
  const recent = Array.isArray(session.recent) ? session.recent.filter(s => s.trim() !== '') : []
  const topic = typeof session.topic === 'string' ? session.topic.trim() : ''
  const mood = typeof session.mood === 'string' ? session.mood.trim() : ''
  if (recent.length === 0 && topic === '' && mood === '') return ''
  const lines: string[] = ['## 上次聊到哪（工作记忆，自然接上，不要照读摘要）']
  if (recent.length > 0) {
    lines.push('最近的几轮：')
    for (const item of recent) lines.push(`- ${item}`)
  }
  if (topic !== '') lines.push(`未竟话题：${topic}`)
  if (mood !== '') lines.push(`此刻的情绪：${mood}`)
  return lines.join('\n')
}

/**
 * 「关系」档位标签（功能界面用，非数值）。
 * 档位**不落盘**——宿主只给起点锚定，实际档位由模型每轮现算。
 */
export function renderRelationTag(card: CharacterCardV3 | Record<string, unknown>): string {
  const name = cardName(card as CharacterCardV3)
  const view = toLegacyView(card)
  const rel = view['relationship']
  const text = typeof rel === 'object' && rel !== null && !Array.isArray(rel)
    ? Object.values(rel as Record<string, unknown>).map(v => (Array.isArray(v) ? v.join('；') : String(v ?? ''))).join('；')
    : ''
  return `${name}（${relationBaseline(text)}）`
}

export interface PromptHost {
  sys: {
    /** 用宿主 `SystemPrompt.section` 的真实签名（`PromptSection`）。 */
    section(input: PromptSection): () => void
  }
  logger: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void; error(msg: string, ...args: unknown[]): void }
}

/** 每轮 pre-step 带进来的上下文（世界书命中用）。 */
/** 刷新时用的宿主日志接口（只用到 info/warn/error 三档，全部可选，方便测试注入）。 */
export interface RefreshHost {
  info?(msg: string, ...args: unknown[]): void
  warn?(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export interface RefreshContext {
  /** 最近的对话文本（按时间升序）；不给时退回 session.recent + topic。 */
  recentTexts?: string[]
  /** 本轮标识（`agentId:turn`）；用于把缓存和某一轮绑定，防跨轮串味。 */
  turnKey?: string
}

interface L1Cache {
  character: string
  /** 规范化后的 CCv3（渲染唯一来源）。 */
  card: CharacterCardV3
  /** 静态块（第 1–12 段）的渲染结果；卡不变就不变。 */
  staticText: string
  relationTag?: string
  diary?: string
  session?: string
  lastTs?: string
  /** 世界书命中结果（含 diag，便于日志排查）。 */
  lore?: LoreSelection
  /** 这一批命中属于哪一轮（`agentId:turn`）：同一轮多次 pre-step 直接复用，不重算也不叠加。 */
  loreTurnKey?: string
  /** 本轮的关键词素材（给下一次 refresh 的主题匹配用）。 */
  recentTexts: string[]
  loadedAt: number
}

/**
 * 插拔控制器：管理「启用 / 退出」两态与持久化。
 *
 * 一次性注册常驻的 L0 段与一个「可空」的 L1 段——L1 的 text 是函数，
 * 未启用时返回空串（DSH 的 renderPrompt 会过滤空段，等于不存在）；
 * 启用时返回「酒馆卡渲染 + 世界书命中 + 时间差 + 会话 + 日记」。
 */
export class PromptController {
  private state: ActiveState = { enabled: false }
  private dispose?: () => void
  /**
   * L1 缓存。**永远整体替换、绝不先清空**——
   * 先清空会让正在进行的组装读到空缓存、整轮丢掉人设（host.md P0-7）。
   */
  private cache: L1Cache | undefined
  /** 刷新串行链：每次 refresh 排在上一次后面（host.md P0-6 的修法）。 */
  private chain: Promise<void> = Promise.resolve()
  /** 缓存代际：只有最新一代的刷新结果才允许提交。 */
  private generation = 0

  constructor(
    private readonly store: Store,
    private readonly host: PromptHost,
  ) {}

  /** 当前启用状态快照。 */
  snapshot(): ActiveState { return { ...this.state } }

  get characterName(): string | undefined {
    return this.state.enabled ? this.state.character : undefined
  }

  /** 从磁盘恢复上次的启用状态（宿主启动时调用）。 */
  async restore(): Promise<ActiveState> {
    const saved = await this.store.readActive()
    if (saved.enabled && saved.character !== undefined) {
      const card = await this.store.readCcV3(saved.character)
      if (card === undefined) {
        // 角色卡已不存在：静默拔出，不带着坏状态启动
        this.state = { enabled: false }
        await this.store.writeActive(this.state)
        return this.snapshot()
      }
      this.state = { ...saved, enabled: true }
      await this.refreshCache(undefined, undefined)
    } else {
      this.state = { enabled: false }
    }
    return this.snapshot()
  }

  /**
   * 注册提示词段（幂等：重复调用先释放旧的）。
   *
   * 🔴 **每一段都必须 `interpolate: false`**。宿主 `dsh-system-prompt` 默认会对段文本做
   * `{{var}}` 插值，遇到未知变量直接 `throw new Error('unknown prompt variable ...')`，
   * 而 CCv3 卡里 `{{char}}` / `{{user}}` 是通用写法 —— 不关插值就是「导入即崩」（整轮对话进不去）。
   * 关掉之后由 `tavern.expandMacros` 负责：认识的展开、不认识的**原样保留**、绝不抛错。
   */
  install(): void {
    this.dispose?.()
    const disposes: Array<() => void> = []
    const section = (name: string, order: number, text: string | ((ctx: unknown) => string)): void => {
      disposes.push(this.host.sys.section({ name, order, text, interpolate: false }))
    }
    // L0 与角色同进同出：未启用时返回空串，宿主过滤空段 ⇒ 系统提示词里一个字都不留
    section(SECTION_BASELINE, ORDER_BASE, () => this.renderBaselineSection())
    // 每次组装重新求值：切换角色 / 时间推移都能立刻反映，无需重注册
    section(SECTION_ACTIVE, ORDER_BASE + 100, () => this.renderActiveSection())
    section(SECTION_LORE, ORDER_BASE + 5300, () => this.renderLoreSection())
    section(SECTION_CLOCK, ORDER_BASE + 5350, () => this.renderClockSection())
    this.dispose = () => { for (const d of disposes.reverse()) d() }
  }

  /** 干净拔出：释放两个段并向 DSH 注销。 */
  uninstall(): void {
    this.dispose?.()
    this.dispose = undefined
  }

  /** 启用一个角色（全局生效，跨会话保持）。 */
  async activate(name: string): Promise<ActiveState> {
    const card = await this.store.readCcV3(name)
    if (card === undefined) throw new Error(`找不到角色卡：${name}`)
    this.state = {
      enabled: true,
      character: name,
      activatedAt: new Date().toISOString(),
      mode: this.state.mode ?? 'text+action',
    }
    await this.store.writeActive(this.state)
    await this.refreshCache(undefined, undefined)
    this.notify()
    return this.snapshot()
  }

  /** 退出：回到干净状态。 */
  async deactivate(): Promise<ActiveState> {
    this.state = { enabled: false, mode: this.state.mode }
    this.cache = undefined
    await this.store.writeActive(this.state)
    this.notify()
    return this.snapshot()
  }

  /** 切换交互模式（纯文本 / 文本+动作）。 */
  async setMode(mode: 'text' | 'text+action'): Promise<ActiveState> {
    this.state = { ...this.state, mode }
    await this.store.writeActive(this.state)
    this.notify()
    return this.snapshot()
  }

  /** 角色卡改动后让缓存失效，下一轮组装即用新内容。 */
  invalidate(): void { this.generation += 1 }

  /**
   * 刷新缓存（**串行**）。
   *
   * v0.1 的实现用 `finally` 无条件清掉字段，A 的 finally 会把 B 的登记一起清掉，
   * 第三轮起并发（host.md P0-6）。这里改成 promise 链：每次刷新排在上一次之后，
   * 前一个失败也继续排队；`generation` 保证只有最新一代结果会提交。
   *
   * 失败只记日志，绝不让钩子抛错打断对话。
   */
  async refresh(host?: RefreshHost, context?: RefreshContext): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await this.refreshCache(host, context)
      } catch (error) {
        host?.error('刷新提示词缓存失败：%s', error instanceof Error ? error.message : String(error))
      }
    }
    const next = this.chain.then(run, run)
    this.chain = next.then(() => undefined, () => undefined)
    await next
  }

  /** 启用状态变化监听：index.ts 用它在启用/退出时同步挂载或卸下工具。 */
  onStateChange(listener: (state: ActiveState) => void): void {
    this.listeners.add(listener)
  }

  private readonly listeners = new Set<(state: ActiveState) => void>()

  private notify(): void {
    const snap = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch (error) {
        this.host.logger.error('启用状态监听器抛错：%s', error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * 重新读盘并**整体替换**缓存。
   *
   * 读盘期间旧的 cache 仍然可用（只在末尾一次性赋值），所以不会出现
   * 「人设段落短暂变空/变成占位文本」的那一轮（host.md P0-7）。
   */
  private async refreshCache(host: RefreshHost | undefined, context: RefreshContext | undefined): Promise<void> {
    const name = this.characterName
    if (name === undefined) { this.cache = undefined; return }
    const generation = this.generation
    const card = await this.store.readCcV3(name)
    if (card === undefined) return

    const diary = renderRecentDiary(await this.store.readDiary(name))
    // 时间差以 session.json 的 last_ts 为唯一权威（对齐原项目 session_continuity §三），
    // 缺失时退回启用时刻。
    const session = await this.store.readSession(name)
    const sessionText = renderSessionSummary(session)
    const lastTs = session?.last_ts ?? this.state.activatedAt
    const recentTexts = (context?.recentTexts !== undefined && context.recentTexts.length > 0)
      ? context.recentTexts
      : [...(session?.recent ?? []), session?.topic ?? ''].filter(text => text.trim() !== '')

    const aiwu = awiuOf(card)
    const loreConfig = aiwu?.prompt?.lore
    const turnKey = context?.turnKey
    // 防粘 / 防抖：同一轮内多次 pre-step（工具循环）直接复用上一次的命中集合，不重算、不叠加。
    // 跨轮则整批重算——命中集合永远是"本轮最近几条消息"的函数，不会跨轮累积。
    const reuse = turnKey !== undefined && this.cache?.character === name && this.cache.loreTurnKey === turnKey
    const lore = reuse && this.cache?.lore !== undefined
      ? this.cache.lore
      : selectLoreEntries(card.data.character_book, recentTexts, {
        enabled: loreConfig?.enabled !== false,
        scanDepth: typeof loreConfig?.scanDepth === 'number' ? loreConfig.scanDepth : undefined,
        budgetChars: typeof loreConfig?.budgetChars === 'number' ? loreConfig.budgetChars : undefined,
        maxEntries: typeof loreConfig?.maxEntries === 'number' ? loreConfig.maxEntries : undefined,
        charName: cardName(card),
        userName: typeof aiwu?.userPersona?.displayName === 'string' && aiwu.userPersona.displayName.trim() !== ''
          ? aiwu.userPersona.displayName.trim()
          : '你',
        turnSeed: turnKey,
      })

    const next: L1Cache = {
      character: name,
      card,
      staticText: renderL1Static(card),
      relationTag: renderRelationTag(card),
      diary,
      session: sessionText,
      lastTs,
      lore,
      loreTurnKey: turnKey,
      recentTexts,
      loadedAt: Date.now(),
    }
    // 只有最新一代的刷新才提交（invalidate 之后开工的旧任务直接丢弃）
    if (generation === this.generation) this.cache = next
    if (!reuse && lore.entries.length > 0) {
      // 只记条数与**条目名**，绝不记正文（正文进日志 = 把卡的内容泄露到可分享的地方）
      const names = lore.entries.map(item => item.name).join('、')
      const line = `世界书命中 ${lore.entries.length} 条（常驻 ${lore.diag.constantCount} / 关键词 ${lore.diag.hitCount}），占用 ${lore.diag.usedChars}/${lore.diag.budgetChars} 字：${names}`
      ;(host?.info ?? host?.warn ?? host?.error)?.call(host, line)
    }
  }

  /** 供宿主侧（web / tools）取当前关系标签，给功能界面用。 */
  relationTag(): string | undefined { return this.cache?.relationTag }

  /**
   * 渲染 L1 段。未启用 → 空串（段消失）；启用 → 酒馆卡 + 世界书 + 时间差 + 会话 + 日记 + 口径。
   * 异步数据在 refreshCache 里预取，这里保持同步（section text 函数是同步的）。
   */
  private renderActiveSection(): string {
    if (!this.state.enabled) return ''
    const name = this.state.character
    if (name === undefined) return ''
    const cache = this.cache
    // 缓存缺失（启动瞬间 / 刚启用）：给出最小可用内容，避免整段空掉
    if (cache === undefined || cache.character !== name) {
      void this.refresh(undefined, undefined)
      return `## 你现在的身份：${name}\n\n（角色卡正在载入，先用这个身份和声线自然对话。）`
    }

    const mode = this.state.mode ?? 'text+action'
    const extras: L1Extras = {
      // 世界书与时间差各自独立成段（垫底），不进 L1 —— 见 SECTION_LORE / SECTION_CLOCK 的注释
      sessionText: cache.session,
      diaryText: cache.diary,
      modeText: mode === 'text'
        ? '## 交互模式：纯文本\n\n不输出 `（动作）`，用语气与断句表达动作神态。'
        : '## 交互模式：文本+动作\n\n动作神态用 `（动作）` 包裹，与台词界限清晰，不滥用。',
      relationHint: RELATION_HINT,
    }
    try {
      return renderL1(cache.card, extras)
    } catch (error) {
      // 渲染失败绝不吐空段（那等于人设消失）：退回静态块，并把原因打出来
      this.host.logger.error('L1 渲染失败（退回静态块）：%s', error instanceof Error ? error.message : String(error))
      return cache.staticText
    }
  }

  /** L0 底线段：启用才注入（同进同出）。 */
  private renderBaselineSection(): string {
    return this.state.enabled ? BASELINE_TEXT : ''
  }

  /** 世界书命中段（未启用 / 未命中 → 空串，宿主过滤空段）。 */
  private renderLoreSection(): string {
    if (!this.state.enabled) return ''
    const text = this.cache?.lore?.text
    return text === undefined ? '' : text
  }

  /**
   * 时间差 / 当前时间段（**垫底**）。
   * 每次组装现算（距上次互动随时间推移变化，不能进缓存），放在最后让缓存失效范围最小。
   */
  private renderClockSection(): string {
    if (!this.state.enabled) return ''
    return this.renderTimeSection(this.cache?.lastTs)
  }

  /** 时间差段（每次组装现算：距上次互动会随时间推移变化，不能进缓存）。 */
  private renderTimeSection(lastTs: string | undefined): string {
    const now = new Date()
    const parsed = parseTs(lastTs)
    if (parsed === undefined || lastTs === undefined) {
      return `## 当前时间\n\n${formatLocal(now)}（用户本地时区）。`
    }
    const prev = new Date(parsed)
    const gapMinutes = Math.max(0, Math.round((now.getTime() - parsed) / 60000))
    const band = timeGapBand(gapMinutes, bothNight(prev, now))
    return `## 距上次互动\n\n${band}\n\n当前时间：${formatLocal(now)}（用户本地时区）。按这个档位决定语气，但绝不输出「检测到间隔 X 小时」。`
  }
}

function formatLocal(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offsetMinutes = -d.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
}
