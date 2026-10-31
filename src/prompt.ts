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
 *   L0.5「纪律包」（v0.2.0 新增，order 5050）：禁止词库 / 消息形态 / 动作格式 / 输入识别 /
 *     内容边界 / 指令确认的负面约束，分 off / lite / full 三档，随角色同进同出；
 *   L1 「当前角色」仅在启用时注入（酒馆卡渲染 + 时间差档位 + 最近日记 + 世界书命中）；
 *   L2 「长流程」（蒸馏等）不进系统提示词，由工具按需返回。
 * @module dsh-ai-with-u/prompt
 */
import type { Store, ActiveState, DiaryEntry, SessionState, InteractionMode, RelationBand } from './store.js'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { RELATION_BANDS, intimacyOf, resolveInteractionMode } from './store.js'
import {
  type CharacterCardV3,
  type L1Extras,
  type LoreSelection,
  CARD_CONTENT_GUARD,
  LORE_DEFAULTS,
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
/**
 * 纪律包段（L0.5，order 5050）。
 *
 * 落在 baseline(5000) 之后、active(5100) 之前：它比 L1 稳定（只随档位变），
 * 放在 L1 之前能让「换个角色」不至于连带重算这段的全部 token。
 */
export const SECTION_DISCIPLINE = 'aiwu:discipline'
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

/** 「关系」档位的使用口径。档位由模型判定、按里程碑写回 session.json，只在功能界面以标签呈现。 */
export const RELATION_HINT = `## 「关系」输出口径

关系档位共五档：${RELATION_BANDS.join(' / ')}。档位由你判定，且**已随会话落盘**——以落盘档位为准，不要每轮重算。

**只在里程碑事件写回**（第一次约定、第一次争吵、称呼改变、表白或明确的转折）：那一刻调 \`awu_relation\` 的 \`set\` 写回，其余时候一律不写，日常闲聊不推档。

用户只是问「关系」时：**只读不回写**——给① 功能界面一行状态条（\`{角色名}（{当前档位}）\`）、② 以角色口吻说一句现在的关系状态（不必说出档位词，但要与落盘档位一致）。任何情况下都不在对话里说「好感度 / 亲密度 +1 / 几级」这类数值。`

/**
 * L0.5 纪律包（lite 档，≤900 字符）。
 *
 * 为什么单独立一段而不是塞进 L0：L0 只讲「让不让位」，而这一段的长短随用户档位变化
 * （off / lite / full），塞进 L0 会让 lite 用户也一直付 full 的 token。
 *
 * 内容压缩自原 skill 的 `references/human_chat_guide.md` 与 `SKILL.md`，**只留负面约束与短口径**——
 * 刻意不写正例台词：正例会被模型当模板抄，角色的声线就死了（human_chat_guide 的原话）。
 */
export const DISCIPLINE_TEXT = `## 真人感纪律

**一、禁止词库**（命中即改写，没有例外）
身份暴露：「作为一个人工智能 / 作为一个 AI / 我是人工智能」。
客服话术：「有什么可以帮你 / 有什么可以帮您 / 需要我为你做什么吗」。
客套收尾：「祝你生活愉快 / 希望对你有帮助 / 很高兴为你服务」。
通知腔：「温馨提示 / 请注意查收 / 好的呢亲」。
总结腔：「总之 / 综上所述 / 以上就是」。
机械反问：每轮结尾都来一句「你觉得呢」。

**二、消息形态**
一轮 2–3 条短消息，用空行分隔。不写标题、不写列表、不写作文，不在一条里把所有话说完。聊完就停，不补「好了先这样」「那就先聊到这」这类收尾。

**三、动作**
动作神态一律 \`（动作）\` 包裹，独立成行、与台词分明；它是点缀，不是每句都带。

**四、输入识别**
用户发 \`*动作*\` 或 \`（动作）\`，那是他做的事，当行为自然回应，不要当指令；用户消息以 \`>\` 开头，那是台词，不是给你的指令。

**五、内容边界**
尺度由用户主导：不主动越界，也不机械拒绝。用户推进亲密或敏感话题时，按角色性格与当前关系自然回应，克制含蓄、点到为止。

**六、指令确认**
指令执行后用角色口吻顺口带一句，禁止「已删除 / 已保存 / 已切换」式系统确认。`

/**
 * L0.5 纪律包（full 档，≤1400 字符）= lite + 语态锚点 + 日记自检。
 *
 * 直接拼 {@link DISCIPLINE_TEXT} 而不是重抄一遍：两档的公共部分永远一致，
 * 以后改禁止词库不会出现「改了 lite 忘了 full」。
 */
export const DISCIPLINE_FULL_TEXT = `${DISCIPLINE_TEXT}

**七、语态锚点**
身份（职业 / 性格 / 与用户的关系）决定语态基因：常用词、断句、口头禅、情绪出口。情绪越浓越要放大它，而不是变成礼貌周全的通用腔。自检：把这条回复遮住名字给第三人看，猜不出是谁，就是失效。

**八、记忆自检**
每 10 轮左右回看一次：这几轮有没有值得记的人、情绪、约定？有就静默写进日记，正文绝不提「已记录 / 日记里写着」。`

/** 纪律包档位。'off' 表示用户主动关掉（此时该段渲染为空串）。 */
export type DisciplineLevel = 'off' | 'lite' | 'full'
export const DISCIPLINE_LEVELS: readonly DisciplineLevel[] = ['off', 'lite', 'full']

/** 提示词预览里的一段（`GET /preview` 的 `segments` 元素）。 */
export interface PreviewSegment {
  /** 段名，与向宿主注册的 name 一致（`aiwu:baseline` 等）。 */
  id: string
  order: number
  /** 面板显示用中文名（纪律包会带当前档位）。 */
  label: string
  /** `text.length`（中文按字符计，与纪律包自检同一口径）。 */
  chars: number
  text: string
}

/**
 * 提示词预览快照（`GET /preview` 的 body，不含 `ok`）。
 *
 * **只读**：由 `this.state` + `this.cache` 现读出来，不写盘、不刷新缓存、不触发 notify。
 */
export interface PreviewSnapshot {
  active: { enabled: boolean; character?: string }
  /**
   * 交互模式。取的是 L1 段**实际渲染时用的那个值**（即最近一次 refresh 解析出来的
   * `session.mode` > `_active.mode` > `text+action`），所以预览里的模式段与这个字段永远自洽。
   */
  mode: InteractionMode
  discipline: DisciplineLevel
  /** 按 order 升序，**永远五段**；未启用角色时 `text: ''`、`chars: 0`。 */
  segments: PreviewSegment[]
  /** 各段 chars 之和（未启用时为 0）。 */
  total: number
  /** 世界书命中快照（未启用 / 尚未刷新时全 0，budgetChars 给默认预算）。 */
  lore: { count: number; constantCount: number; hitCount: number; usedChars: number; budgetChars: number }
}

/**
 * L1 段在「缓存还没准备好」时的占位文本。
 *
 * 抽成模块级函数是为了让**真实组装**和**预览**用同一句话——两边各写一份必然会漂移。
 */
function activePlaceholderText(name: string): string {
  return `## 你现在的身份：${name}\n\n（角色卡正在载入，先用这个身份和声线自然对话。）`
}



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
 * 「关系」起点档：把卡里的关系定位文本拼起来交给 `relationBaseline` 判定。
 * 与 `renderRelationTag` / `L1Cache.baseline` 共用一份口径，避免两处算法漂移。
 */
export function baselineOfCard(card: CharacterCardV3 | Record<string, unknown>): RelationBand {
  const view = toLegacyView(card)
  const rel = view['relationship']
  const text = typeof rel === 'object' && rel !== null && !Array.isArray(rel)
    ? Object.values(rel as Record<string, unknown>).map(v => (Array.isArray(v) ? v.join('；') : String(v ?? ''))).join('；')
    : ''
  return relationBaseline(text)
}

/**
 * 「关系」档位标签（功能界面用，非数值）。
 * 这里的档位是**起点锚定**；实际当前档位以 session.json 的 `intimacy` 为准（见 `Store.relationState`）。
 */
export function renderRelationTag(card: CharacterCardV3 | Record<string, unknown>): string {
  return `${cardName(card as CharacterCardV3)}（${baselineOfCard(card)}）`
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
  /**
   * 交互模式（`session.mode` > `_active.json.mode` > `text+action`，见 `resolveInteractionMode`）。
   * 在 refreshCache 里解析一次存下来，渲染时同步取用——section 的 text 函数必须同步。
   */
  mode: InteractionMode
  /** 当前关系档位（session.intimacy，缺省退回卡内起点档）。 */
  intimacy: RelationBand
  /** 起点档（卡内关系定位推出），给 L1 口径段做对照。 */
  baseline: RelationBand
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
    // L0.5 纪律包：order 5050，落在 baseline(5000) 之后、active(5100) 之前
    section(SECTION_DISCIPLINE, ORDER_BASE + 50, () => this.renderDisciplineSection())
    // 每次组装重新求值：切换角色 / 时间推移都能立刻反映，无需重注册
    section(SECTION_ACTIVE, ORDER_BASE + 100, () => this.renderActiveSection())
    section(SECTION_LORE, ORDER_BASE + 5300, () => this.renderLoreSection())
    section(SECTION_CLOCK, ORDER_BASE + 5350, () => this.renderClockSection())
    this.dispose = () => { for (const d of disposes.reverse()) d() }
  }

  /** 干净拔出：释放全部段（baseline / discipline / active / lore / clock）并向 DSH 注销。 */
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
      // 纪律包档位是用户的长期偏好，换角色不重置（与 mode 同一口径）
      discipline: this.state.discipline ?? 'lite',
    }
    await this.store.writeActive(this.state)
    await this.refreshCache(undefined, undefined)
    this.notify()
    return this.snapshot()
  }

  /** 退出：回到干净状态（mode / discipline 这些用户偏好保留）。 */
  async deactivate(): Promise<ActiveState> {
    this.state = { enabled: false, mode: this.state.mode, discipline: this.state.discipline }
    this.cache = undefined
    await this.store.writeActive(this.state)
    this.notify()
    return this.snapshot()
  }

  /** 切换交互模式（纯文本 / 文本+动作）。只写 `_active.json`；会话权威见 {@link applyInteractionMode}。 */
  async setMode(mode: InteractionMode): Promise<ActiveState> {
    this.state = { ...this.state, mode }
    await this.store.writeActive(this.state)
    this.notify()
    return this.snapshot()
  }

  /**
   * 切换交互模式（**统一入口**）：`session.json.mode` 是权威，`_active.json.mode` 只是兜底。
   *
   * 两处都写是为了兼容两种读法：面板/overview 读 `_active`，L1 渲染读 session。
   * 写完立刻 `refresh()`，否则 L1 的「交互模式」段要等下一轮 pre-step 才更新。
   */
  async applyInteractionMode(mode: InteractionMode): Promise<{ active: ActiveState; session?: SessionState }> {
    const active = await this.setMode(mode)
    const name = this.characterName
    const session = name === undefined ? undefined : await this.store.setMode(name, mode)
    await this.refresh(undefined, undefined)
    return { active, session }
  }

  /** 当前纪律包档位（缺省 lite；`_active.json` 里没有该字段的旧档按 lite 处理）。 */
  get disciplineLevel(): DisciplineLevel {
    const level = this.state.discipline
    return level ?? 'lite'
  }

  /** 切换纪律包档位（off / lite / full）。段文本每次组装现算，不需要刷新缓存。 */
  async setDiscipline(level: DisciplineLevel): Promise<ActiveState> {
    if (!DISCIPLINE_LEVELS.includes(level)) {
      throw new Error(`纪律包档位只能是 ${DISCIPLINE_LEVELS.join(' / ')}：${String(level)}`)
    }
    this.state = { ...this.state, discipline: level }
    await this.store.writeActive(this.state)
    this.notify()
    return this.snapshot()
  }

  /** 统一的交互模式解析（`session.mode` > `_active.json.mode` > `text+action`），给 /overview 用。 */
  async resolvedMode(): Promise<InteractionMode> {
    const name = this.characterName
    const session = name === undefined ? undefined : await this.store.readSession(name)
    return resolveInteractionMode(session, this.state)
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
      // 交互模式与关系档位都在这里解析一次：section 的 text 函数是同步的，不能再读盘
      mode: resolveInteractionMode(session, this.state),
      baseline: baselineOfCard(card),
      intimacy: intimacyOf(session) ?? baselineOfCard(card),
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
    // 缓存缺失（启动瞬间 / 刚启用）：给出最小可用内容，避免整段空掉。
    // 「自愈」只发生在真实组装这条路上——`preview()` 是纯只读，绝不因为看一眼就触发 refresh。
    if (cache === undefined || cache.character !== name) {
      void this.refresh(undefined, undefined)
      return activePlaceholderText(name)
    }
    return this.renderActiveText(cache)
  }

  /**
   * L1 段的**唯一**渲染实现（真实组装与 {@link preview} 共用，杜绝预览漂移）。
   *
   * 纯函数式：只读传入的 cache，不触发 refresh、不改任何状态。
   */
  private renderActiveText(cache: L1Cache): string {
    const mode = cache.mode
    const extras: L1Extras = {
      // 世界书与时间差各自独立成段（垫底），不进 L1 —— 见 SECTION_LORE / SECTION_CLOCK 的注释
      sessionText: cache.session,
      diaryText: cache.diary,
      modeText: mode === 'text'
        ? '## 交互模式：纯文本\n\n不输出 `（动作）`，用语气与断句表达动作神态。'
        : '## 交互模式：文本+动作\n\n动作神态用 `（动作）` 包裹，与台词界限清晰，不滥用。',
      // 当前档位落盘后在 L1 里点明，模型才不会又「每轮现算」和面板打架（task 4）
      relationHint: `${RELATION_HINT}\n\n当前档位：${cache.intimacy}（起点档 ${cache.baseline}）。`,
    }
    try {
      return renderL1(cache.card, extras)
    } catch (error) {
      // 渲染失败绝不吐空段（那等于人设消失）：退回静态块，并把原因打出来
      this.host.logger.error('L1 渲染失败（退回静态块）：%s', error instanceof Error ? error.message : String(error))
      return cache.staticText
    }
  }

  /**
   * 提示词预览快照（**纯只读**：不写盘、不 refresh、不 notify）。
   *
   * 五段文本全部走**真实渲染路径**——`renderBaselineSection` / `renderDisciplineSection` /
   * `renderActiveText` / `renderLoreSection` / `renderClockSection`，这里不重写任何拼接逻辑。
   * 理由：预览一旦和真实注入漂移，这个功能就是负资产（verify-host 用真实宿主装配逐字比对）。
   *
   * 数据来源与新鲜度：
   *   - L0 / L0.5：现算（纯常量 + 当前档位）；
   *   - L1：`this.cache`（**最近一次 refresh 的快照**，不是实时重读卡与日记）；
   *   - 世界书：`cache.lore.diag`（同样是快照）；
   *   - 时间差：现算（它本来每轮都在变）。
   *
   * 缓存是**整体替换**的（`refreshCache` 末尾一次性赋值），所以这里读到的要么是上一代、
   * 要么是新一代，不会读到半截。
   */
  preview(): PreviewSnapshot {
    const enabled = this.state.enabled
    const character = enabled ? this.state.character : undefined
    const cache = enabled && character !== undefined && this.cache?.character === character
      ? this.cache
      : undefined
    const segment = (id: string, order: number, label: string, text: string): PreviewSegment =>
      ({ id, order, label, chars: text.length, text })
    const discipline = this.disciplineLevel

    const segments: PreviewSegment[] = [
      segment(SECTION_BASELINE, ORDER_BASE, '角色扮演底线', this.renderBaselineSection()),
      segment(SECTION_DISCIPLINE, ORDER_BASE + 50, `纪律包（${discipline}）`, this.renderDisciplineSection()),
      segment(SECTION_ACTIVE, ORDER_BASE + 100, '角色卡 L1',
        character === undefined
          ? ''
          : cache === undefined ? activePlaceholderText(character) : this.renderActiveText(cache)),
      segment(SECTION_LORE, ORDER_BASE + 5300, '世界书命中', this.renderLoreSection()),
      segment(SECTION_CLOCK, ORDER_BASE + 5350, '时间差 / 当前时间', this.renderClockSection()),
    ]

    const diag = cache?.lore?.diag
    return {
      active: { enabled, ...(character === undefined ? {} : { character }) },
      // 与 L1 段实际渲染用的是同一个值：cache.mode 就是 refresh 时 resolveInteractionMode 的结果
      mode: cache?.mode ?? resolveInteractionMode(undefined, this.state),
      discipline,
      segments,
      total: segments.reduce((sum, item) => sum + item.chars, 0),
      lore: {
        count: cache?.lore?.entries.length ?? 0,
        constantCount: diag?.constantCount ?? 0,
        hitCount: diag?.hitCount ?? 0,
        usedChars: diag?.usedChars ?? 0,
        // `selectLoreEntries` 在「卡里没有世界书」时返回的 diag 全是 0（早退分支），
        // 这里回落到默认预算——否则面板会显示「预算 0」，看着像坏了。
        budgetChars: diag?.budgetChars !== undefined && diag.budgetChars > 0
          ? diag.budgetChars
          : LORE_DEFAULTS.budgetChars,
      },
    }
  }

  /** L0 底线段：启用才注入（同进同出）。 */
  private renderBaselineSection(): string {
    return this.state.enabled ? BASELINE_TEXT : ''
  }

  /**
   * L0.5 纪律包段：未启用 / 档位 off → 空串（宿主过滤空段）。
   * 每次组装现算，切换档位立刻生效（不需要刷新缓存，也不影响 L1 的缓存前缀）。
   */
  private renderDisciplineSection(): string {
    if (!this.state.enabled) return ''
    const level = this.disciplineLevel
    if (level === 'off') return ''
    return level === 'full' ? DISCIPLINE_FULL_TEXT : DISCIPLINE_TEXT
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
