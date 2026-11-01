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
import type { Store, ActiveState, DiaryEntry, SessionState, InteractionMode, RelationBand, SessionBindings } from './store.js'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { RELATION_BANDS, intimacyOf, resolveInteractionMode } from './store.js'
import {
  PRESET_VERSION,
  presetStats,
  renderPresetText,
  type Preset,
  type PresetActive,
  type PresetIndexEntry,
} from './preset.js'
import {
  type CharacterCardV3,
  type L1Extras,
  type LoreDroppedEntry,
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

/**
 * 每会话 L1 缓存的**上限**（LRU）。
 *
 * 会话结束没有可靠事件可依赖，所以不做主动回收，只做「有上限的淘汰 + 访问时按需重建」：
 * 32 个会话足够覆盖正常使用，再多就是开一百个窗口的极端情况，此时每轮多读一次卡也有代价上限。
 */
export const SESSION_CACHE_LIMIT = 32

export const SECTION_BASELINE = 'aiwu:baseline'
/**
 * 纪律包段（L0.5，order 5050）。
 *
 * 落在 baseline(5000) 之后、active(5100) 之前：它比 L1 稳定（只随档位变），
 * 放在 L1 之前能让「换个角色」不至于连带重算这段的全部 token。
 */
export const SECTION_DISCIPLINE = 'aiwu:discipline'
/**
 * 预设段（文风 / 语气 / 回复规则，order 5080）。
 *
 * 位置：纪律包(5050) 之后、L1(5100) 之前——
 *   · 排在纪律包之后：用户级负面约束优先级更高；
 *   · 排在 L1 之前：预设只在**切换预设**时变，放在 L1 前可以让「换角色」不连带重算预设。
 *
 * 预设与角色卡**正交**：角色卡管「我是谁」，预设管「我怎么说话」。
 */
export const SECTION_PRESET = 'aiwu:preset'
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
  /** 这次预览对应的会话 id（空串 = 全局视角）。 */
  sessionId: string
  /** 决议来源：会话绑定 / 全局启用 / 未启用。 */
  source: 'session' | 'global' | 'none'
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
  /**
   * 当前生效的预设摘要（无预设 / 被删了就是 null）。
   *
   * 预设与角色卡**正交**：换角色不换预设，换预设不动角色。
   */
  preset: { id: string; name: string; source: 'st' | 'custom'; moduleCount: number; enabledCount: number } | null
  /**
   * 世界书命中快照。
   *
   * 常驻与关键词是**两本预算**，所以有两组数（`usedChars/budgetChars` 是关键词，
   * `constantUsedChars/constantBudgetChars` 是常驻）；`constantDropped` / `keywordDropped`
   * 直接列出「哪些设定没进提示词」，面板可以原样展示，不要只报条数。
   */
  lore: {
    count: number
    constantCount: number
    hitCount: number
    /** 实际注入的条数（候选数见 constantCount / hitCount）。 */
    constantKeptCount: number
    keywordKeptCount: number
    usedChars: number
    budgetChars: number
    constantUsedChars: number
    constantBudgetChars: number
    constantDropped: LoreDroppedEntry[]
    keywordDropped: LoreDroppedEntry[]
    /** 本轮按「深度注入」声明、但被当普通设定注入的条数（ST position 4 / @@depth）。 */
    unsupportedDepthN: number
    /** 首条常驻超额度仍被注入（说明人设比预算重要）。 */
    forcedConstantOverBudget: boolean
  }
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
  /**
   * 这次刷新是给哪个会话刷的（`agent.session.id`，退 `agent.id`）。
   * 不给 = 全局（面板 / 无会话组装）；给了但该会话没绑定 → 仍按全局角色刷（决议优先级）。
   */
  sessionId?: string
}

/**
 * 一个会话/全局槽位的决议结果。
 *
 * 决议优先级（**写死**，改动要同步改自检）：**会话绑定 > 全局启用 > 未启用**。
 */
export interface SessionTarget {
  /** 决议出来的角色；`undefined` = 未启用。 */
  character?: string
  /** 缓存槽位的键：绑定会话用自己的 sessionId，全局 / 无会话用 `''`。 */
  key: string
  source: 'session' | 'global' | 'none'
  /** 会话绑了卡但卡已被删：该会话**视为未启用**（绝不回落到全局）。 */
  dead?: boolean
}

/**
 * 从 DSH 的 assembly 上下文里读会话 id（纯防御式，拿不到就返回 undefined）。
 *
 * `AssembleContext` 里 `agent`（以及同体的 `scope`）就是 Agent 对象；diagnostics 场景没有 agent，
 * 这时必须**退回全局**而不是抛错（类型注释原话：「absent on diagnostics」）。
 */
export function readSessionId(source: unknown): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const record = source as Record<string, unknown>
  const candidates: unknown[] = [record['agent'], record['scope'], record]
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const item = candidate as Record<string, unknown>
    const session = item['session']
    if (typeof session === 'object' && session !== null) {
      const id = (session as Record<string, unknown>)['id']
      if (typeof id === 'string' && id.trim() !== '') return id.trim()
    }
    const id = item['id']
    if (typeof id === 'string' && id.trim() !== '') return id.trim()
  }
  return undefined
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
   * L1 缓存（**按会话分槽**）。
   *
   * 键：绑定会话用自己的 `sessionId`，全局 / 无会话用 `''`。
   * 每个槽位都是**整体替换、绝不先清空**——先清空会让正在进行的组装读到空缓存、
   * 整轮丢掉人设（host.md P0-7）。容量上限见 {@link SESSION_CACHE_LIMIT}（LRU 淘汰，
   * 淘汰后下一次组装按需重建，不影响正确性）。
   */
  private readonly caches = new Map<string, L1Cache>()
  /** 会话绑定表（**内存镜像**：渲染路径只读它，绝不读盘）。 */
  private bindings: SessionBindings = {}
  // ---------------------------------------------------------------- 预设（提示词模块组）
  /**
   * 预设启用态（`_presets_active.json` 的内存镜像）。
   * 决议优先级：**会话预设 > 全局预设 > 无**（与角色绑定同构）。
   */
  private presetActive: PresetActive = { version: PRESET_VERSION }
  /** 预设索引（列表摘要；面板读它）。 */
  private presetIndex: PresetIndexEntry[] = []
  /**
   * **被引用的**预设正文镜像（`id → Preset`）。
   *
   * 只镜像「启用态里引用到的」那几份：渲染路径零读盘，又不会把 200 份预设全塞内存。
   * 新增引用时（REST 启用 / 启动）会把正文读进来；不再引用时丢掉。
   */
  private readonly presetBodies = new Map<string, Preset>()
  /** 会话启用的预设被删过的会话：视为**无预设**，连全局都不回退（与角色绑定的 deadSlots 同构）。 */
  private readonly deadPresetSessions = new Set<string>()
  /** 正在排刷新的槽位：同一次组装里五段各调一次，不能排五次 refresh。 */
  private readonly refreshing = new Set<string>()
  /** 绑定指向的卡已被删的槽位：渲染直接空串，且**不再刷新**（避免每轮空转）。 */
  private readonly deadSlots = new Set<string>()
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

  // ---------------------------------------------------------------- 会话决议（纯内存）

  /**
   * 决议一个会话用哪张卡：**会话绑定 > 全局启用 > 未启用**。
   *
   * 纯内存（渲染路径会在一次组装里被调五次，绝不能每个段都读一次盘）；
   * 绑定表由 {@link restore} / {@link reloadBindings} 从 `_sessions.json` 灌进来。
   *
   * `dead` 有**两个来源**，都必须判为未启用：
   *   1. 内存里的 `deadSlots`（本轮运行期发现卡没了）；
   *   2. 磁盘绑定条目上的 `dead: true`（上一个进程删过卡 / 启动 prune 标记过）。
   * 只看内存会把「重启后」的保证弄丢——2026-11-01 真机复测抓到的正是这个。
   */
  resolveTarget(sessionId?: string): SessionTarget {
    if (sessionId !== undefined) {
      // 绑定的卡被删过：这个会话**明确未启用**，连全局都不回退
      // （回退的话用户以为在跟 A 聊、其实在跟 B 聊；重新绑定会自动解除这个状态）
      if (this.deadSlots.has(sessionId)) return { key: sessionId, source: 'none', dead: true }
      const bound = this.bindings[sessionId]
      if (bound !== undefined) {
        if (bound.dead === true) return { key: sessionId, source: 'none', dead: true }
        return { character: bound.character, key: sessionId, source: 'session' }
      }
    }
    const globalName = this.characterName
    if (globalName === undefined) return { key: '', source: 'none' }
    return { character: globalName, key: '', source: 'global' }
  }

  /**
   * 会话决议出的角色（给工具层用）。
   *
   * 子代理有自己的 agent/sessionId，查不到绑定 → 这里自然退回全局角色：
   * **子代理不继承父会话绑定**（已写进文档，不是隔离漏了）。
   */
  characterForSession(sessionId?: string): string | undefined {
    return this.resolveTarget(sessionId).character
  }

  /** 当前绑定表快照（面板/自检用；不含正文），按 sessionId 排序稳定输出。 */
  bindingSnapshot(): SessionBindings {
    const out: SessionBindings = {}
    for (const sessionId of Object.keys(this.bindings).sort()) {
      const binding = this.bindings[sessionId]
      if (binding !== undefined) out[sessionId] = { ...binding }
    }
    return out
  }

  /** 重新从磁盘读绑定表（REST `/bind` `/unbind` / 删卡后调用）。 */
  async reloadBindings(): Promise<SessionBindings> {
    this.bindings = await this.store.readBindings()
    // 解除内存 dead 标记的两种情形：用户**显式解绑**（条目没了 → 回落全局）、或重新绑了活卡。
    // 磁盘上 `dead:true` 的条目继续判为未启用（重启保证就靠它）。
    for (const sessionId of [...this.deadSlots]) {
      const binding = this.bindings[sessionId]
      if (binding === undefined || binding.dead !== true) this.deadSlots.delete(sessionId)
    }
    return this.bindingSnapshot()
  }

  /**
   * 把一批会话标成「绑定的卡已被删」（内存 deadSlots）。
   *
   * 删除方（删卡路由）知道**哪些会话受影响**，磁盘上的 `dead:true` 保证重启后仍然成立；
   * 这个方法是让**当前进程**立刻生效，不用等下一次 refresh 才发现。
   */
  noteBindingsDead(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
      if (sid === '') continue
      this.deadSlots.add(sid)
      this.caches.delete(sid)
      this.refreshing.delete(sid)
    }
  }

  /**
   * 按会话预热缓存（写操作允许刷新：`/bind` 之后面板带 sessionId 看预览就是真内容，不是占位）。
   */
  async refreshSession(sessionId: string): Promise<void> {
    this.caches.delete(sessionId)
    await this.refresh(undefined, { sessionId })
  }

  // ---------------------------------------------------------------- 预设决议（纯内存）

  /**
   * 载入预设镜像：索引 + 启用态 + **被引用到的正文**（渲染路径之后只读内存）。
   *
   * 顺序很重要：先 `prunePresets()`（清索引里文件已丢的、启用态里指向不存在预设的），
   * 再灌内存——这样「预设被手删」不会变成每轮渲染时的空转。
   */
  async loadPresets(): Promise<void> {
    try {
      const pruned = await this.store.prunePresets()
      const stuck = pruned.sessions
      if (pruned.presets.length > 0 || stuck.length > 0 || pruned.globalCleared) {
        this.host.logger.warn(
          '预设清理：%d 个预设文件已不存在，%d 个会话的启用已失效%s',
          pruned.presets.length,
          stuck.length,
          pruned.globalCleared ? '，全局预设已失效' : '',
        )
      }
      // 这些会话原本启用的预设被删了：标记为「无预设」，**不回落全局**
      for (const sessionId of stuck) this.deadPresetSessions.add(sessionId)
    } catch (error) {
      this.host.logger.warn('预设清理失败（继续载入）：%s', error instanceof Error ? error.message : String(error))
    }
    this.presetIndex = await this.store.listPresetEntries()
    this.presetActive = await this.store.readPresetActive()
    // 启用态里已不存在的会话条目（被 prune 掉后可能还留着活引用）保持现状
    await this.warmPresetBodies()
  }

  /** 重新读启用态并补齐正文镜像（REST 写完后调用）。 */
  async reloadPresets(): Promise<void> {
    this.presetIndex = await this.store.listPresetEntries()
    this.presetActive = await this.store.readPresetActive()
    // 内存里的 dead 标记只在「磁盘也不再标记 dead」时清掉（重新启用 / 用户显式取消启用都会清）
    for (const sessionId of [...this.deadPresetSessions]) {
      const persisted = this.presetActive.deadSessions?.[sessionId] !== undefined
      const live = this.presetActive.sessions?.[sessionId] !== undefined
      if (!persisted && !live) this.deadPresetSessions.delete(sessionId)
    }
    await this.warmPresetBodies()
  }

  /**
   * 预设被删除后，把「原本用它的会话」标成**无预设**（不回落全局）。
   *
   * 为什么不能只靠 `reloadPresets()`：删除时 `_presets_active.json` 里的会话条目已被清掉，
   * 光看文件分不清「本来就没启用」和「启用的那份刚被删」——只有调用方（删除方）知道这个差别。
   * 与角色绑定的 deadSlots 同构；该会话重新启用任意预设时会自动解除。
   */
  notePresetDeleted(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) {
      if (typeof sessionId !== 'string' || sessionId.trim() === '') continue
      this.deadPresetSessions.add(sessionId.trim())
      const id = this.presetActive.sessions?.[sessionId]
      if (id !== undefined) {
        delete this.presetActive.sessions?.[sessionId]
        this.presetBodies.delete(id)
      }
    }
  }

  /** 把启用态引用到的预设正文读进内存；不再引用的丢掉（避免 200 份正文常驻）。 */
  private async warmPresetBodies(): Promise<void> {
    const referenced = new Set<string>()
    if (this.presetActive.global !== undefined) referenced.add(this.presetActive.global)
    for (const id of Object.values(this.presetActive.sessions ?? {})) referenced.add(id)
    for (const id of [...this.presetBodies.keys()]) {
      if (!referenced.has(id)) this.presetBodies.delete(id)
    }
    for (const id of referenced) {
      if (this.presetBodies.has(id)) continue
      const preset = await this.store.readPreset(id)
      if (preset !== undefined) this.presetBodies.set(id, preset)
    }
  }

  /**
   * 决议一个会话用哪份预设：**会话预设 > 全局预设 > 无**。
   *
   * 会话启用但预设已不存在 → **无预设**（`dead`），**不回落全局**。判据有两个来源：
   *   1. 内存 `deadPresetSessions`（本轮运行期发现）；
   *   2. 磁盘 `_presets_active.json` 的 `deadSessions`（上个进程/启动 prune 标记过）——
   *      只看内存会把「重启后」的保证弄丢（与角色绑定同一个坑，2026-11-01 真机复测抓过）。
   * 子代理有自己的 agent/sessionId，查不到会话预设 → 用全局预设（**不继承父会话**）。
   */
  resolvePreset(sessionId?: string): { id?: string; preset?: Preset; source: 'session' | 'global' | 'none'; dead?: boolean } {
    if (sessionId !== undefined) {
      const id = this.presetActive.sessions?.[sessionId]
      if (id !== undefined) {
        const preset = this.presetBodies.get(id)
        if (preset === undefined) return { id, source: 'none', dead: true }
        return { id, preset, source: 'session' }
      }
      const deadRecord = this.presetActive.deadSessions?.[sessionId]
      if (this.deadPresetSessions.has(sessionId) || deadRecord !== undefined) {
        return { ...(deadRecord === undefined ? {} : { id: deadRecord.id }), source: 'none', dead: true }
      }
    }
    const globalId = this.presetActive.global
    if (globalId === undefined) return { source: 'none' }
    const preset = this.presetBodies.get(globalId)
    if (preset === undefined) return { id: globalId, source: 'none', dead: true }
    return { id: globalId, preset, source: 'global' }
  }

  /** 预设启用态快照（面板/自检用；含索引摘要）。 */
  presetSnapshot(): { active: PresetActive; entries: PresetIndexEntry[]; loaded: string[] } {
    const active: PresetActive = { version: PRESET_VERSION }
    if (this.presetActive.global !== undefined) active.global = this.presetActive.global
    if (this.presetActive.sessions !== undefined) active.sessions = { ...this.presetActive.sessions }
    if (this.presetActive.deadSessions !== undefined) active.deadSessions = { ...this.presetActive.deadSessions }
    return {
      active,
      entries: this.presetIndex.map(entry => ({ ...entry })),
      loaded: [...this.presetBodies.keys()].sort(),
    }
  }

  /** 从磁盘恢复上次的启用状态（宿主启动时调用）。 */
  async restore(): Promise<ActiveState> {
    // 启动把「绑定卡已不存在」的条目标成 dead（**不删**）：重启后仍要能判为「未启用」
    try {
      const dead = await this.store.pruneBindings()
      if (dead.length > 0) {
        this.noteBindingsDead(dead)
        this.host.logger.warn('启动时把 %d 条指向已删卡的会话绑定标为失效：%s', dead.length, dead.join('、'))
      }
    } catch (error) {
      this.host.logger.warn('清理会话绑定失败（继续启动）：%s', error instanceof Error ? error.message : String(error))
    }
    this.bindings = await this.store.readBindings()
    // 预设镜像同批载入（含悬空引用清理）：渲染路径之后只读内存
    try {
      await this.loadPresets()
    } catch (error) {
      this.host.logger.warn('载入预设失败（继续启动）：%s', error instanceof Error ? error.message : String(error))
    }
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
   *
   * 🔵 **按会话隔离（A 方案）**：段是**全局注册一次**的，但每次都宿主都会把本次 assembly 的
   * `AssembleContext`（`{ agent, scope: agent, signal? }`）传给 `text(context)`，
   * 所以我们在这里读 `context.agent` 的 sessionId，按「会话绑定 > 全局启用」渲染对应角色。
   * 两个会话各自组装各自拿到不同文本 —— 这是提示词级真隔离，不是障眼法。
   */
  install(): void {
    this.dispose?.()
    const disposes: Array<() => void> = []
    const section = (name: string, order: number, text: string | ((ctx: unknown) => string)): void => {
      disposes.push(this.host.sys.section({ name, order, text, interpolate: false }))
    }
    // L0 与角色同进同出：未启用时返回空串，宿主过滤空段 ⇒ 系统提示词里一个字都不留
    section(SECTION_BASELINE, ORDER_BASE, (ctx: unknown) => this.renderBaselineSection(ctx))
    // L0.5 纪律包：order 5050，落在 baseline(5000) 之后、active(5100) 之前
    section(SECTION_DISCIPLINE, ORDER_BASE + 50, (ctx: unknown) => this.renderDisciplineSection(ctx))
    // 预设段：order 5080，纪律包之后、L1 之前；没启用预设时返回空串（宿主过滤空段）
    section(SECTION_PRESET, ORDER_BASE + 80, (ctx: unknown) => this.renderPresetSection(ctx))
    // 每次组装重新求值：切换角色 / 时间推移都能立刻反映，无需重注册
    section(SECTION_ACTIVE, ORDER_BASE + 100, (ctx: unknown) => this.renderActiveSection(ctx))
    section(SECTION_LORE, ORDER_BASE + 5300, (ctx: unknown) => this.renderLoreSection(ctx))
    section(SECTION_CLOCK, ORDER_BASE + 5350, (ctx: unknown) => this.renderClockSection(ctx))
    this.dispose = () => { for (const d of disposes.reverse()) d() }
  }

  /** 干净拔出：释放全部段（baseline / discipline / active / lore / clock）并向 DSH 注销。 */
  uninstall(): void {
    this.dispose?.()
    this.dispose = undefined
  }

  /** 启用一个角色（**全局**生效，跨会话保持；会话绑定优先于它）。 */
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

  /** 退出：回到干净状态（mode / discipline 这些用户偏好保留；**会话绑定一条都不动**）。 */
  async deactivate(): Promise<ActiveState> {
    this.state = { enabled: false, mode: this.state.mode, discipline: this.state.discipline }
    this.caches.delete('')
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
   * `character` 给了就写那张卡的 session（会话绑定的角色），否则写全局启用角色的。
   * 写完立刻 `refresh()`，否则 L1 的「交互模式」段要等下一轮 pre-step 才更新。
   */
  async applyInteractionMode(
    mode: InteractionMode,
    character?: string,
  ): Promise<{ active: ActiveState; session?: SessionState }> {
    const active = await this.setMode(mode)
    const name = character ?? this.characterName
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

  /**
   * 统一的交互模式解析（`session.mode` > `_active.json.mode` > `text+action`），给 /overview 用。
   * `sessionId` 给了就按该会话的决议角色读它的 session.json。
   */
  async resolvedMode(sessionId?: string): Promise<InteractionMode> {
    const name = this.characterForSession(sessionId)
    const session = name === undefined ? undefined : await this.store.readSession(name)
    return resolveInteractionMode(session, this.state)
  }

  /** 某个会话决议角色的 session 快照（工具层/自检用；没有角色时 undefined）。 */
  async sessionStateFor(sessionId?: string): Promise<SessionState | undefined> {
    const name = this.characterForSession(sessionId)
    return name === undefined ? undefined : this.store.readSession(name)
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

  /** 绑定表变化后让宿主同步一次「工具该不该挂着」（与启停同一套回调）。 */
  refreshMount(): void { this.notify() }

  /**
   * 某张卡改动后，刷新所有「正在用它的会话槽位」（含全局槽位）。
   *
   * 拆开刷是为了不污染别人：会话 X 绑着 A、会话 Y 绑着 B 时，改 A 不该让 Y 的缓存白读一遍卡。
   */
  async refreshCharacter(character: string): Promise<void> {
    const globalName = this.characterName
    if (globalName === character) await this.refresh(undefined, undefined)
    for (const [sessionId, binding] of Object.entries(this.bindings)) {
      if (binding.character !== character) continue
      await this.refresh(undefined, { sessionId })
    }
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
   * 重新读盘并**整体替换某个槽位的缓存**（槽位 = 某个会话，或全局 `''`）。
   *
   * 读盘期间旧缓存仍然可用（末尾一次性替换），所以不会出现「人设段落短暂变空」的那一轮（host.md P0-7）。
   *
   * 决议与失效：
   *   - 会话绑定的卡被删 → **清绑定 + 标记 deadSlots + 日志**，该会话按未启用处理，**不回落到全局**；
   *   - 没有绑定 / 无会话 → 用全局启用角色；
   *   - 两处都没有 → 清掉该槽位缓存。
   */
  private async refreshCache(host: RefreshHost | undefined, context: RefreshContext | undefined): Promise<void> {
    const sessionId = context?.sessionId
    const target = this.resolveTarget(sessionId)
    if (target.character === undefined) {
      this.caches.delete(target.key)
      return
    }
    const name = target.character
    const cacheKey = target.key
    const generation = this.generation
    const card = await this.store.readCcV3(name)
    if (card === undefined) {
      if (target.source === 'session' && sessionId !== undefined) {
        // 绑定的卡被删：该会话视为未启用，绝不静默回落到全局（否则用户以为在跟 A 聊，其实在跟 B 聊）。
        // **绑定条目不删、改成 dead 留痕**：只清内存的话，重启之后这个保证就丢了。
        this.deadSlots.add(cacheKey)
        this.caches.delete(cacheKey)
        const line = `会话 ${sessionId} 绑定的角色「${name}」已不存在：该会话按未启用处理（绑定已标为失效）`
        ;(host?.warn ?? host?.info ?? host?.error)?.call(host, line)
        this.host.logger.warn(line)
        try {
          const dead = await this.store.markBindingsDead(name)
          this.noteBindingsDead(dead)
          this.bindings = await this.store.readBindings()
        } catch { /* 标记失败不阻断渲染路径：内存 deadSlots 仍然生效 */ }
      }
      return
    }
    this.deadSlots.delete(cacheKey)

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
    const previous = this.caches.get(cacheKey)
    const reuse = turnKey !== undefined && previous?.character === name && previous.loreTurnKey === turnKey
    const lore = reuse && previous?.lore !== undefined
      ? previous.lore
      : selectLoreEntries(card.data.character_book, recentTexts, {
        enabled: loreConfig?.enabled !== false,
        scanDepth: typeof loreConfig?.scanDepth === 'number' ? loreConfig.scanDepth : undefined,
        budgetChars: typeof loreConfig?.budgetChars === 'number' ? loreConfig.budgetChars : undefined,
        // 常驻与关键词分开预算：卡级可覆盖常驻额度（默认 12000，见 LORE_DEFAULTS）
        constantBudgetChars: typeof loreConfig?.constantBudgetChars === 'number' ? loreConfig.constantBudgetChars : undefined,
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
    if (generation === this.generation) this.putCache(cacheKey, next)
    if (!reuse && lore.entries.length > 0) {
      // 只记条数与**条目名**，绝不记正文（正文进日志 = 把卡的内容泄露到可分享的地方）。
      // 被预算裁掉的条目也要点名：真卡里「7 条常驻被裁 2 条」静默发生过，日志是唯一排查线索。
      const names = lore.entries.map(item => item.name).join('、')
      const diag = lore.diag
      const cut = [...diag.constantDropped, ...diag.keywordDropped]
      const cutText = cut.length === 0
        ? ''
        : `；被裁 ${cut.length} 条（${cut.map(item => item.name).join('、')}）`
      const depthText = diag.unsupportedDepthN > 0 ? `；${diag.unsupportedDepthN} 条按深度注入（本轮按普通设定注入）` : ''
      const line = `世界书注入 ${lore.entries.length} 条（常驻 ${diag.constantKeptCount}/${diag.constantCount}、`
        + `关键词 ${diag.keywordKeptCount}/${diag.hitCount}）`
        + `，关键词占用 ${diag.usedChars}/${diag.budgetChars} 字，常驻占用 ${diag.constantUsedChars}/${diag.constantBudgetChars} 字`
        + `${cutText}${depthText}：${names}`
      ;(host?.info ?? host?.warn ?? host?.error)?.call(host, line)
    }
  }

  /** 缓存槽位数（自检 / 面板诊断用；正常情况下 ≤ {@link SESSION_CACHE_LIMIT}）。 */
  get cacheCount(): number { return this.caches.size }

  /** 缓存槽位的键（自检用：看清哪些会话在缓存里）。 */
  cacheKeys(): string[] { return [...this.caches.keys()] }

  /** 供宿主侧（web / tools）取当前关系标签，给功能界面用（全局槽位）。 */
  relationTag(): string | undefined { return this.cacheOf('')?.relationTag }

  // ---------------------------------------------------------------- 缓存槽位

  /** 取槽位缓存（LRU：命中后移到队尾，最旧的在头部）。 */
  private cacheOf(key: string): L1Cache | undefined {
    const cache = this.caches.get(key)
    if (cache === undefined) return undefined
    this.caches.delete(key)
    this.caches.set(key, cache)
    return cache
  }

  /** 写入槽位缓存（LRU 上限 {@link SESSION_CACHE_LIMIT}，超了淘汰最旧的）。 */
  private putCache(key: string, cache: L1Cache): void {
    this.caches.delete(key)
    this.caches.set(key, cache)
    while (this.caches.size > SESSION_CACHE_LIMIT) {
      const oldest = this.caches.keys().next().value
      if (oldest === undefined) break
      this.caches.delete(oldest)
    }
  }

  /**
   * 排一次该槽位的刷新（**同一次组装里五段都会走到这里，去重**）。
   *
   * 只读预览不会走这条路径：`preview()` 绝不因为看一眼就触发 refresh。
   */
  private scheduleRefresh(key: string, sessionId: string | undefined): void {
    if (this.refreshing.has(key)) return
    this.refreshing.add(key)
    void this.refresh(undefined, sessionId === undefined ? undefined : { sessionId })
      .finally(() => { this.refreshing.delete(key) })
  }

  /**
   * 渲染 L1 段（按会话决议）。未启用 → 空串；有角色但缓存还没好 → 占位 + 排一次刷新。
   * 异步数据在 refreshCache 里预取，这里保持同步（section text 函数是同步的）。
   */
  private renderActiveSection(ctx?: unknown): string {
    const sessionId = readSessionId(ctx)
    const target = this.resolveTarget(sessionId)
    if (target.character === undefined) return ''
    const cache = this.cacheOf(target.key)
    if (cache === undefined || cache.character !== target.character) {
      this.scheduleRefresh(target.key, sessionId)
      return activePlaceholderText(target.character)
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
   *   - L1：对应槽位的缓存（**最近一次 refresh 的快照**，不是实时重读卡与日记）；
   *   - 世界书：`cache.lore.diag`（同样是快照）；
   *   - 时间差：现算（它本来每轮都在变）。
   *
   * `sessionId` 给了就看「那个会话实际会注入什么」（按 会话绑定 > 全局启用 决议）；
   * 不给 = 全局视角（面板默认）。
   */
  preview(sessionId?: string): PreviewSnapshot {
    const target = this.resolveTarget(sessionId)
    const character = target.character
    const cache = character === undefined ? undefined : this.cacheOf(target.key)
    const segment = (id: string, order: number, label: string, text: string): PreviewSegment =>
      ({ id, order, label, chars: text.length, text })
    const discipline = this.disciplineLevel
    const presetTarget = this.resolvePreset(sessionId)
    const presetText = this.presetText(presetTarget, sessionId)

    const segments: PreviewSegment[] = [
      segment(SECTION_BASELINE, ORDER_BASE, '角色扮演底线', this.renderBaselineText(character !== undefined)),
      segment(SECTION_DISCIPLINE, ORDER_BASE + 50, `纪律包（${discipline}）`, this.renderDisciplineText(character !== undefined)),
      // 预设段（order 5080）：纪律包之后、L1 之前；没启用预设时 chars 为 0、text 为空串
      segment(SECTION_PRESET, ORDER_BASE + 80,
        presetTarget.preset === undefined ? '文风预设（未启用）' : `文风预设（${presetTarget.preset.name}）`,
        presetText),
      segment(SECTION_ACTIVE, ORDER_BASE + 100, '角色卡 L1',
        character === undefined
          ? ''
          : cache === undefined ? activePlaceholderText(character) : this.renderActiveText(cache)),
      segment(SECTION_LORE, ORDER_BASE + 5300, '世界书命中', this.renderLoreText(cache)),
      segment(SECTION_CLOCK, ORDER_BASE + 5350, '时间差 / 当前时间', this.renderClockText(cache)),
    ]

    const diag = cache?.lore?.diag
    return {
      active: { enabled: character !== undefined, ...(character === undefined ? {} : { character }) },
      sessionId: sessionId ?? '',
      source: target.source,
      // 与 L1 段实际渲染用的是同一个值：cache.mode 就是 refresh 时 resolveInteractionMode 的结果
      mode: cache?.mode ?? resolveInteractionMode(undefined, this.state),
      discipline,
      preset: presetTarget.preset === undefined
        ? null
        : {
          id: presetTarget.preset.id,
          name: presetTarget.preset.name,
          source: presetTarget.preset.source,
          moduleCount: presetStats(presetTarget.preset.modules).moduleCount,
          enabledCount: presetStats(presetTarget.preset.modules).enabledCount,
        },
      segments,
      total: segments.reduce((sum, item) => sum + item.chars, 0),
      lore: {
        count: cache?.lore?.entries.length ?? 0,
        constantCount: diag?.constantCount ?? 0,
        hitCount: diag?.hitCount ?? 0,
        constantKeptCount: diag?.constantKeptCount ?? 0,
        keywordKeptCount: diag?.keywordKeptCount ?? 0,
        usedChars: diag?.usedChars ?? 0,
        // `selectLoreEntries` 在「卡里没有世界书」时返回的 diag 全是 0（早退分支），
        // 这里回落到默认预算——否则面板会显示「预算 0」，看着像坏了。
        budgetChars: diag?.budgetChars !== undefined && diag.budgetChars > 0
          ? diag.budgetChars
          : LORE_DEFAULTS.budgetChars,
        constantUsedChars: diag?.constantUsedChars ?? 0,
        constantBudgetChars: diag?.constantBudgetChars !== undefined && diag.constantBudgetChars > 0
          ? diag.constantBudgetChars
          : LORE_DEFAULTS.constantBudgetChars,
        // 被裁条目明细：面板要能逐条说「这条设定没进提示词」，只报条数等于没说
        constantDropped: diag?.constantDropped ?? [],
        keywordDropped: diag?.keywordDropped ?? [],
        unsupportedDepthN: diag?.unsupportedDepthN ?? 0,
        forcedConstantOverBudget: diag?.forcedConstantOverBudget ?? false,
      },
    }
  }

  /** L0.5 纪律包段 / 预设段 / L1 段共用的「有没有角色」判定。 */
  private renderPresetSection(ctx?: unknown): string {
    const sessionId = readSessionId(ctx)
    return this.presetText(this.resolvePreset(sessionId), sessionId)
  }

  /** 预设段的真实文本（段渲染与 `preview()` 共用；纯内存）。 */
  private presetText(target: { preset?: Preset }, sessionId?: string): string {
    if (target.preset === undefined) return ''
    // `{{char}}` / `{{user}}` 取**该会话决议角色**的卡名与人设称呼；用户没设称呼时用「你」
    const roleTarget = this.resolveTarget(sessionId)
    const cache = roleTarget.character === undefined ? undefined : this.cacheOf(roleTarget.key)
    const char = cache === undefined ? (roleTarget.character ?? '') : cardName(cache.card)
    const displayName = cache === undefined ? '' : (awiuOf(cache.card)?.userPersona?.displayName ?? '')
    const user = displayName.trim() !== '' ? displayName.trim() : '你'
    return renderPresetText(target.preset, { char, user, mode: 'stable' })
  }

  /**
   * L0 底线段：该会话/全局有角色才注入（同进同出）。
   * 段渲染收 assembly 上下文；`preview()` 直接传已决议的「有没有角色」。
   */
  private renderBaselineSection(ctx?: unknown): string {
    return this.renderBaselineText(this.hasCharacter(ctx))
  }

  private renderBaselineText(hasCharacter: boolean): string {
    return hasCharacter ? BASELINE_TEXT : ''
  }

  /**
   * L0.5 纪律包段：没角色 / 档位 off → 空串（宿主过滤空段）。
   * 每次组装现算，切换档位立刻生效（不需要刷新缓存，也不影响 L1 的缓存前缀）。
   */
  private renderDisciplineSection(ctx?: unknown): string {
    return this.renderDisciplineText(this.hasCharacter(ctx))
  }

  private renderDisciplineText(hasCharacter: boolean): string {
    if (!hasCharacter) return ''
    const level = this.disciplineLevel
    if (level === 'off') return ''
    return level === 'full' ? DISCIPLINE_FULL_TEXT : DISCIPLINE_TEXT
  }

  /** 世界书命中段（没角色 / 未命中 → 空串，宿主过滤空段）。 */
  private renderLoreSection(ctx?: unknown): string {
    return this.renderLoreText(this.cacheFrom(ctx))
  }

  private renderLoreText(cache: L1Cache | undefined): string {
    return cache?.lore?.text ?? ''
  }

  /**
   * 时间差 / 当前时间段（**垫底**）。
   * 每次组装现算（距上次互动随时间推移变化，不能进缓存），放在最后让缓存失效范围最小。
   */
  private renderClockSection(ctx?: unknown): string {
    return this.renderClockText(this.cacheFrom(ctx))
  }

  private renderClockText(cache: L1Cache | undefined): string {
    if (cache === undefined) return ''
    return this.renderTimeSection(cache.lastTs)
  }

  /**
   * 段渲染的解析辅助：真实组装收到 assembly 上下文（按会话决议），
   * `preview()` 直接传已决议的缓存 / 布尔（预览不触发刷新，也不重读盘）。
   */
  private hasCharacter(ctx?: unknown): boolean {
    return this.resolveTarget(readSessionId(ctx)).character !== undefined
  }

  private cacheFrom(ctx?: unknown): L1Cache | undefined {
    const target = this.resolveTarget(readSessionId(ctx))
    if (target.character === undefined) return undefined
    return this.cacheOf(target.key)
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
