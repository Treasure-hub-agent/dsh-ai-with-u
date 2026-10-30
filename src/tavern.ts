/**
 * AI WITH U · 酒馆卡 CCv3 格式层（纯函数，零 IO、零依赖）
 *
 * 这一层只做「格式与文本」，不碰磁盘、不碰时间以外的环境：
 *   1. 识别 / 归一：legacy（本项目 v0.1 的 34 字段）· V2 · V3 → 统一成 CCv3；
 *   2. 迁移：34 字段逐字段映射进 `data.extensions.aiwu`，认不出的键进 `legacy.extra`（不丢数据）；
 *   3. 投影：结构（extensions.aiwu）→ 原生字段（description/personality/scenario/system_prompt/
 *      post_history_instructions/first_mes/alternate_greetings）**单向**生成，原生永不反写结构；
 *   4. 旧视图：`toLegacyView` / `fromLegacyView` 给面板与工具做过渡期兼容（34 字段视图）；
 *   5. 渲染：`renderL1` 把卡 + 外部段落拼成提示词 L1 段（顺序见 docs/design/2026-10-30-tavern-card.md §3.2）；
 *   6. 世界书：`selectLoreEntries` 纯函数选条目（匹配/预算/去重），**默认值待调研定稿**（见 LORE_DEFAULTS）；
 *   7. 宏替换与装饰器；8. 忘却（全卡按句手术）；9. 长度统计与软警告。
 *
 * 设计文档：`docs/design/2026-10-30-tavern-card.md`（本文件的每条规则都能在那找到出处）。
 * @module dsh-ai-with-u/tavern
 */

// ============================================================================ 常量

export const CARD_SPEC = 'chara_card_v3'
export const CARD_SPEC_VERSION = '3.0'
/** `extensions.aiwu` 自身的格式版本，只增不改。 */
export const AWU_SCHEMA = 1

/** `mes_example` 进 L1 的字符预算（§3.4）。 */
export const MES_EXAMPLE_BUDGET = 1200

/** 长度软警告阈值（§5.1）。 */
export const LENGTH_LIMITS = {
  description: 1200,
  l1Static: 3000,
  loreEntry: 800,
  loreTotal: 20000,
  loreEntries: 30,
  cardFile: 200 * 1024,
} as const

/**
 * 世界书默认值。
 *
 * ⏳ 这 4 个值**等 `06-tmp/tavern-study/REPORT.md` 出来再定稿**（设计文档 §4.3 的 W1/W6/W7/W10）。
 * 现在给的是「保守可用」的临时值，只改这里，不改调用方。
 */
export const LORE_DEFAULTS = {
  /** 扫最近几条角色消息（近似 D0..Dn 槽位；`dsh-tavern` 默认 4、universal-worldbook 默认 3 槽）。 */
  scanDepth: 4,
  /** 单轮最多注入几条（`dsh-bard` 默认 12）。 */
  maxEntries: 12,
  /** 单轮字符预算（`dsh-bard` 默认 maxChars=6000；我们没有 tokenizer，按字符算）。 */
  budgetChars: 6000,
  /** 递归激活：第一版**明确不做**（报告 §4.3.3：收益低、放大预算风险）。 */
  recursive: false,
  /** `token_budget`（token）→ 字符的换算系数（中文保守估计 1 token ≈ 1.5 字）。 */
  charsPerToken: 1.5,
} as const

/** 关系五档：非数值档位，由模型现算（与原 store.ts 口径一致）。 */
export const RELATION_BANDS = ['陌生', '认识', '熟悉', '亲近', '亲密'] as const
export type RelationBand = typeof RELATION_BANDS[number]

/** 旧 34 字段的分组键 → 中文显示名。编辑器、迁移提示、旧卡预览共用（设计文档附录 C）。 */
export const LEGACY_GROUP_TITLES: Record<string, string> = {
  basic: '基本信息',
  voice: '声线基因',
  personality: '性格核心',
  relationship: '关系定位',
  world: '故事背景',
  memory_anchor: '记忆锚点',
  dynamic_state: '动态状态',
  interaction_pref: '互动偏好',
  user_persona: '你的身份',
  opening: '开场白',
  openings: '开场白',
}

/** 旧卡顶层键白名单：不在这里的一律进 `legacy.extra`。 */
const LEGACY_TOP_KEYS = new Set([
  'name', 'basic', 'voice', 'personality', 'relationship', 'world',
  'memory_anchor', 'dynamic_state', 'interaction_pref', 'user_persona',
  'opening', 'openings', 'source', 'creator_notes',
])

// ============================================================================ 类型

type Json = Record<string, unknown>

/** 世界书条目（CCv3 `character_book.entries[]`）。 */
export interface CharacterBookEntry {
  keys: string[]
  content: string
  extensions: Json
  enabled: boolean
  insertion_order: number
  use_regex: boolean
  constant?: boolean
  case_sensitive?: boolean
  name?: string
  priority?: number
  id?: number | string
  comment?: string
  selective?: boolean
  secondary_keys?: string[]
  position?: 'before_char' | 'after_char'
}

/** 世界书（CCv3 `character_book`）。 */
export interface CharacterBook {
  name?: string
  description?: string
  scan_depth?: number | null
  token_budget?: number | null
  recursive_scanning?: boolean
  extensions: Json
  entries: CharacterBookEntry[]
}

export interface AiwuBasic {
  [key: string]: unknown
  age?: string
  identity?: string
  background?: string
  /** `basic.姓名` 与 `name` 不一致时的真名（迁移告警用）。 */
  realName?: string
}

export interface AiwuVoice {
  [key: string]: unknown
  pace?: string
  catchphrases?: string[]
  selfRef?: string
  callsUser?: string
  emotes?: string[]
  forbidden?: string
  gestures?: string[]
}

export interface AiwuPersonality {
  [key: string]: unknown
  keywords?: string[]
  contradiction?: string
  towardClose?: string
}

export interface AiwuWorld {
  [key: string]: unknown
  origin?: string
  gap?: string
  nowadays?: string
  sharedPast?: string
}

export interface AiwuRelationship {
  [key: string]: unknown
  startPoint?: string
  charCallsUser?: string
  userCallsChar?: string
}

export interface AiwuUserPersona {
  [key: string]: unknown
  who?: string
  relation?: string
  sharedHistory?: string
  /** `{{user}}` 的替换值；空则渲染成「你」。 */
  displayName?: string
}

export interface AiwuDynamicState {
  [key: string]: unknown
  mood?: string
  recent?: string
  doing?: string
  updated_at?: string
}

export interface AiwuInteractionPref {
  [key: string]: unknown
  length?: string
  emoji?: string
  comfortZone?: string
  taboo?: string
}

export interface AiwuLoreConfig {
  enabled?: boolean
  /** 扫最近几条角色消息（null = 用默认 4）。 */
  scanDepth?: number | null
  /** 单轮字符预算（null = 用默认 6000）。 */
  budgetChars?: number | null
  /** 单轮最多注入几条（null = 用默认 12）。 */
  maxEntries?: number | null
  /** 递归激活（未实现；留字段是为了将来不用改卡）。 */
  recursive?: boolean | null
}

export interface AiwuPromptConfig {
  includeMesExamples?: boolean
  includeSystemPrompt?: boolean
  lengthWarnings?: boolean
  lore?: AiwuLoreConfig
}

export interface AiwuLegacy {
  /** `aiwu-v1`（本项目旧格式）· `native`（外部原生卡）· `png` / `charx` · `unknown` */
  from?: string
  at?: string
  originalName?: string
  /** 旧卡的 `source` 字符串（CCv3 的 `data.source` 是数组，语义不同，不混用）。 */
  source?: string
  /** 认不出的旧键：原样 JSON。 */
  extra?: Json
}

export interface AiwuImported {
  from?: string
  at?: string
  /** 外部卡的原生字段原文（保真用：L1 渲染优先用它）。 */
  raw?: Record<string, string>
}

export interface AiwuExtension {
  schema?: number
  updated_at?: string
  basic?: AiwuBasic
  personality?: AiwuPersonality
  voice?: AiwuVoice
  world?: AiwuWorld
  relationship?: AiwuRelationship
  userPersona?: AiwuUserPersona
  dynamicState?: AiwuDynamicState
  memoryAnchors?: string[]
  interactionPref?: AiwuInteractionPref
  prompt?: AiwuPromptConfig
  legacy?: AiwuLegacy
  imported?: AiwuImported
  [key: string]: unknown
}

/** CCv3 `data`。允许未知键（一律原样保留）。 */
export interface CardData {
  name: string
  description: string
  tags: string[]
  creator: string
  character_version: string
  mes_example: string
  extensions: Json
  system_prompt: string
  post_history_instructions: string
  first_mes: string
  alternate_greetings: string[]
  personality: string
  scenario: string
  creator_notes: string
  character_book?: CharacterBook
  assets?: Array<{ type: string; uri: string; name: string; ext: string }>
  nickname?: string
  creator_notes_multilingual?: Record<string, string>
  source?: string[]
  group_only_greetings: string[]
  creation_date?: number
  modification_date?: number
  [key: string]: unknown
}

export interface CharacterCardV3 {
  spec: string
  spec_version: string
  data: CardData
  [key: string]: unknown
}

/** 旧 34 字段视图（面板与工具在过渡期的读写形状，键名必须与 `client/card-schema.ts` 的 GROUPS 一致）。 */
export interface LegacyCardView {
  name: string
  basic?: Record<string, string>
  voice?: Record<string, string | string[]>
  personality?: Record<string, string | string[]>
  relationship?: Record<string, string>
  world?: Record<string, string>
  memory_anchor?: Record<string, string[]>
  dynamic_state?: Record<string, string>
  interaction_pref?: Record<string, string>
  user_persona?: Record<string, string>
  source?: string
  opening?: string
  openings?: string[]
  [key: string]: unknown
}

export interface NormalizeOptions {
  /** 注入"现在"：纯函数不读系统时钟。省略时不写任何时间戳（保证幂等）。 */
  now?: Date
  /** 卡没有名字时的兜底（一般传目录名）。 */
  fallbackName?: string
  /** 迁移来源标记，默认 `aiwu-v1`。 */
  from?: string
}

// ============================================================================ 基础工具

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rec(value: unknown): Json {
  return isRecord(value) ? value : {}
}

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(v => str(v)).filter(s => s !== '').join('、')
  return ''
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => str(v)).filter(s => s.trim() !== '')
  const one = str(value).trim()
  return one === '' ? [] : [one]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T
}

function isEmptyText(value: unknown): boolean {
  return str(value).trim() === ''
}

/** 本地时区 ISO 8601（带偏移），与 store.localIsoTimestamp 同口径。 */
function isoLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

// ============================================================================ 识别

export function isV3Card(input: unknown): input is CharacterCardV3 {
  if (!isRecord(input)) return false
  if (input['spec'] !== CARD_SPEC) return false
  return isRecord(input['data'])
}

export function isV2Card(input: unknown): boolean {
  if (!isRecord(input)) return false
  return input['spec'] === 'chara_card_v2' && isRecord(input['data'])
}

/** 本项目 v0.1 的 34 字段旧卡：没有 spec、但有中文分组键。 */
export function isLegacyCard(input: unknown): boolean {
  if (!isRecord(input)) return false
  if (input['spec'] !== undefined) return false
  if (typeof input['name'] !== 'string') return false
  return ['basic', 'voice', 'personality', 'relationship', 'world', 'memory_anchor', 'dynamic_state', 'interaction_pref', 'user_persona'].some(
    key => isRecord(input[key]),
  )
}

/** 取 `data.extensions.aiwu`（不存在返回 undefined，**不创建**）。 */
export function awiuOf(card: CharacterCardV3 | CardData): AiwuExtension | undefined {
  const data = isRecord(card) && 'data' in card ? (card as CharacterCardV3).data : (card as CardData)
  const extensions = rec(data.extensions)
  const aiwu = extensions['aiwu']
  return isRecord(aiwu) ? aiwu as AiwuExtension : undefined
}

function ensureAiwu(data: CardData): AiwuExtension {
  const extensions = isRecord(data.extensions) ? data.extensions : {}
  data.extensions = extensions
  const existing = extensions['aiwu']
  const aiwu: AiwuExtension = isRecord(existing) ? existing as AiwuExtension : {}
  extensions['aiwu'] = aiwu
  if (typeof aiwu.schema !== 'number') aiwu.schema = AWU_SCHEMA
  return aiwu
}

/** 卡名：`data.name` 优先（CCv3），兼容顶层 `name`（旧卡）。 */
export function cardName(card: CharacterCardV3 | Json): string {
  if (isV3Card(card)) return str(card.data.name).trim()
  return str(card['name']).trim()
}

/** 卡来源标签：旧卡的 `source` 字符串（`_index.json` 与统计用）。 */
export function cardSource(card: CharacterCardV3 | Json): string {
  if (isV3Card(card)) {
    const legacy = awiuOf(card)?.legacy
    const fromLegacy = str(legacy?.source).trim()
    if (fromLegacy !== '') return fromLegacy
    const source = card.data.source
    if (Array.isArray(source) && source.length > 0) return str(source[0]).trim()
    return 'custom'
  }
  const raw = str(card['source']).trim()
  return raw === '' ? 'custom' : raw
}

// ============================================================================ 归一

/**
 * 任意输入 → 规范化的 CCv3（**纯函数**，不打时间戳除非传了 `opts.now`）。
 *
 * 四种输入：V3（补默认值）· V2（包一层）· legacy（走迁移）· 无法识别（原文塞 `legacy.extra`，不丢）。
 */
export function normalizeCard(input: unknown, opts: NormalizeOptions = {}): CharacterCardV3 {
  if (isV3Card(input)) {
    const card = clone(input)
    fillDataDefaults(card.data, opts)
    deriveFromNative(card.data, opts)
    return card
  }
  if (isV2Card(input)) {
    const source = rec(input)
    const card: CharacterCardV3 = {
      spec: CARD_SPEC,
      spec_version: CARD_SPEC_VERSION,
      data: clone(rec(source['data'])) as unknown as CardData,
    }
    fillDataDefaults(card.data, opts)
    deriveFromNative(card.data, { ...opts, from: opts.from ?? 'native' })
    return card
  }
  if (isLegacyCard(input)) return migrateLegacyCard(rec(input), opts)

  // 无法识别：**不丢**，整包塞进 legacy.extra
  const raw = isRecord(input) ? input : {}
  const name = str(raw['name']).trim() !== '' ? str(raw['name']).trim() : (opts.fallbackName ?? '')
  const data = emptyData(name)
  const aiwu = ensureAiwu(data)
  aiwu.legacy = {
    from: opts.from ?? 'unknown',
    extra: clone(raw),
    ...(opts.now !== undefined ? { at: isoLocal(opts.now) } : {}),
  }
  if (Object.keys(raw).length > 0) {
    data.creator_notes = '⚠️ 这张卡的格式未被识别，原始内容已完整保留在 extensions.aiwu.legacy.extra。'
  }
  if (opts.now !== undefined) stampCardTimes({ spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data }, opts.now)
  return { spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data }
}

function emptyData(name: string): CardData {
  return {
    name,
    description: '',
    tags: [],
    creator: '',
    character_version: '',
    mes_example: '',
    extensions: {},
    system_prompt: '',
    post_history_instructions: '',
    first_mes: '',
    alternate_greetings: [],
    personality: '',
    scenario: '',
    creator_notes: '',
    group_only_greetings: [],
  }
}

function fillDataDefaults(data: CardData, opts: NormalizeOptions): void {
  const anyData = data as unknown as Json
  if (!Array.isArray(anyData['tags'])) data.tags = Array.isArray(anyData['tags']) ? data.tags as string[] : []
  if (!Array.isArray(data.alternate_greetings)) data.alternate_greetings = []
  else data.alternate_greetings = data.alternate_greetings.map(v => str(v)).filter(s => s.trim() !== '')
  if (!Array.isArray(data.group_only_greetings)) data.group_only_greetings = []
  if (!isRecord(data.extensions)) data.extensions = {}
  for (const key of ['description', 'creator', 'character_version', 'mes_example', 'system_prompt',
    'post_history_instructions', 'first_mes', 'personality', 'scenario', 'creator_notes'] as const) {
    if (typeof data[key] !== 'string') data[key] = str(data[key])
  }
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    data.name = str(data.name).trim() !== '' ? str(data.name).trim() : (opts.fallbackName ?? '')
  }
  if (data.character_book !== undefined && !isRecord(data.character_book)) delete data.character_book
  if (data.character_book !== undefined) fillBookDefaults(data.character_book)
}

function fillBookDefaults(book: CharacterBook): void {
  book.entries = Array.isArray(book.entries) ? book.entries : []
  if (!isRecord(book.extensions)) book.extensions = {}
  for (const entry of book.entries) {
    if (!isRecord(entry)) continue
    entry.keys = list(entry.keys)
    entry.content = str(entry.content)
    if (!isRecord(entry.extensions)) entry.extensions = {}
    if (typeof entry.enabled !== 'boolean') entry.enabled = true
    if (typeof entry.insertion_order !== 'number') entry.insertion_order = 100
    if (typeof entry.use_regex !== 'boolean') entry.use_regex = false
  }
}

/**
 * 外部原生卡（V2/V3 但没有 `extensions.aiwu`）→ 尽力反解出结构化镜像。
 *
 * 只填空缺，不覆盖已有内容；同时把原生原文 stash 进 `imported.raw`，
 * 这样 L1 渲染优先用原文（保真），结构只服务编辑器。
 */
export function deriveFromNative(data: CardData, opts: NormalizeOptions = {}): void {
  const extensions = isRecord(data.extensions) ? data.extensions : (data.extensions = {})
  if (isRecord(extensions['aiwu'])) return // 有结构化数据就不动（零覆盖）

  const aiwu = ensureAiwu(data)
  aiwu.legacy = { from: opts.from ?? 'native', ...(opts.now !== undefined ? { at: isoLocal(opts.now) } : {}) }

  const description = str(data.description).trim()
  if (description !== '') {
    aiwu.basic = { background: description }
  }
  if (str(data.personality).trim() !== '') aiwu.personality = { contradiction: str(data.personality).trim() }
  if (str(data.scenario).trim() !== '') aiwu.world = { origin: str(data.scenario).trim() }

  const raw: Record<string, string> = {}
  for (const key of ['description', 'personality', 'scenario', 'mes_example', 'system_prompt', 'post_history_instructions'] as const) {
    const text = str(data[key]).trim()
    if (text !== '') raw[key] = text
  }
  if (Object.keys(raw).length > 0) {
    aiwu.imported = { from: opts.from ?? 'native', raw, ...(opts.now !== undefined ? { at: isoLocal(opts.now) } : {}) }
  }
}

// ============================================================================ 迁移（旧 34 字段 → CCv3）

/**
 * 旧格式迁移（**纯函数**：不打时间戳除非 `opts.now`）。
 *
 * 34 字段逐字段落进 `extensions.aiwu`（映射表见设计文档 §2.2）；
 * 认不出的键原样进 `aiwu.legacy.extra`；最后 `projectNative` 生成原生投影。
 *
 * 幂等：对已经是 V3 的输入走 `normalizeCard`，结果再迁一次字节不变（verify V2 断言）。
 */
export function migrateLegacyCard(input: Json, opts: NormalizeOptions = {}): CharacterCardV3 {
  if (isV3Card(input)) return normalizeCard(input, opts)

  const name = str(input['name']).trim()
  const basic = rec(input['basic'])
  const basicName = str(basic['姓名']).trim()
  const data = emptyData(name !== '' ? name : basicName)
  const aiwu = ensureAiwu(data)

  const now = opts.now
  const extra: Json = {}

  // ---- 已知分组内的未知键 + 未知顶层键：全部留痕，不丢
  const knownGroupKeys: Record<string, string[]> = {
    basic: ['姓名', '年龄', '身份', '一句话背景'],
    voice: ['对话节奏', '爱用句式', '自称', '对用户的称呼', '情绪口头禅', '禁忌词', '非语言小动作'],
    personality: ['关键词', '内在矛盾', '对待亲近之人'],
    relationship: ['关系起点', '角色怎么称呼用户', '用户怎么称呼角色'],
    world: ['来处', '落差', '如今的日子', '你与他的旧'],
    memory_anchor: ['要点'],
    dynamic_state: ['当前情绪', '近况', '此刻在做什么'],
    interaction_pref: ['回复长度倾向', '表情使用', '话题舒适区', '雷区'],
    user_persona: ['你是谁', '与 TA 的关系', '共同经历'],
  }
  for (const [group, allowed] of Object.entries(knownGroupKeys)) {
    const bucket = rec(input[group])
    const leftovers: Json = {}
    for (const [key, value] of Object.entries(bucket)) {
      if (!allowed.includes(key)) leftovers[key] = value
    }
    if (Object.keys(leftovers).length > 0) extra[group] = leftovers
  }
  for (const [key, value] of Object.entries(input)) {
    if (!LEGACY_TOP_KEYS.has(key)) extra[key] = value
  }

  // ---- 34 字段映射（§2.2）
  const basicInfo: AiwuBasic = {}
  if (!isEmptyText(basic['年龄'])) basicInfo.age = str(basic['年龄']).trim()
  if (!isEmptyText(basic['身份'])) basicInfo.identity = str(basic['身份']).trim()
  if (!isEmptyText(basic['一句话背景'])) basicInfo.background = str(basic['一句话背景']).trim()
  if (basicName !== '' && basicName !== data.name) basicInfo.realName = basicName
  if (Object.keys(basicInfo).length > 0) aiwu.basic = basicInfo

  const voiceIn = rec(input['voice'])
  const voice: AiwuVoice = {}
  if (!isEmptyText(voiceIn['对话节奏'])) voice.pace = str(voiceIn['对话节奏']).trim()
  if (list(voiceIn['爱用句式']).length > 0) voice.catchphrases = list(voiceIn['爱用句式'])
  if (!isEmptyText(voiceIn['自称'])) voice.selfRef = str(voiceIn['自称']).trim()
  if (!isEmptyText(voiceIn['对用户的称呼'])) voice.callsUser = str(voiceIn['对用户的称呼']).trim()
  if (list(voiceIn['情绪口头禅']).length > 0) voice.emotes = list(voiceIn['情绪口头禅'])
  if (!isEmptyText(voiceIn['禁忌词'])) voice.forbidden = str(voiceIn['禁忌词']).trim()
  if (list(voiceIn['非语言小动作']).length > 0) voice.gestures = list(voiceIn['非语言小动作'])
  if (Object.keys(voice).length > 0) aiwu.voice = voice

  const personaIn = rec(input['personality'])
  const personality: AiwuPersonality = {}
  if (list(personaIn['关键词']).length > 0) personality.keywords = list(personaIn['关键词'])
  if (!isEmptyText(personaIn['内在矛盾'])) personality.contradiction = str(personaIn['内在矛盾']).trim()
  if (!isEmptyText(personaIn['对待亲近之人'])) personality.towardClose = str(personaIn['对待亲近之人']).trim()
  if (Object.keys(personality).length > 0) aiwu.personality = personality

  const relIn = rec(input['relationship'])
  const relationship: AiwuRelationship = {}
  if (!isEmptyText(relIn['关系起点'])) relationship.startPoint = str(relIn['关系起点']).trim()
  if (!isEmptyText(relIn['角色怎么称呼用户'])) relationship.charCallsUser = str(relIn['角色怎么称呼用户']).trim()
  if (!isEmptyText(relIn['用户怎么称呼角色'])) relationship.userCallsChar = str(relIn['用户怎么称呼角色']).trim()
  if (Object.keys(relationship).length > 0) aiwu.relationship = relationship

  const worldIn = rec(input['world'])
  const world: AiwuWorld = {}
  if (!isEmptyText(worldIn['来处'])) world.origin = str(worldIn['来处']).trim()
  if (!isEmptyText(worldIn['落差'])) world.gap = str(worldIn['落差']).trim()
  if (!isEmptyText(worldIn['如今的日子'])) world.nowadays = str(worldIn['如今的日子']).trim()
  if (!isEmptyText(worldIn['你与他的旧'])) world.sharedPast = str(worldIn['你与他的旧']).trim()
  if (Object.keys(world).length > 0) aiwu.world = world

  const anchors = list(rec(input['memory_anchor'])['要点'])
  if (anchors.length > 0) aiwu.memoryAnchors = anchors

  const stateIn = rec(input['dynamic_state'])
  const dynamicState: AiwuDynamicState = {}
  if (!isEmptyText(stateIn['当前情绪'])) dynamicState.mood = str(stateIn['当前情绪']).trim()
  if (!isEmptyText(stateIn['近况'])) dynamicState.recent = str(stateIn['近况']).trim()
  if (!isEmptyText(stateIn['此刻在做什么'])) dynamicState.doing = str(stateIn['此刻在做什么']).trim()
  if (Object.keys(dynamicState).length > 0) aiwu.dynamicState = dynamicState

  const prefIn = rec(input['interaction_pref'])
  const interactionPref: AiwuInteractionPref = {}
  if (!isEmptyText(prefIn['回复长度倾向'])) interactionPref.length = str(prefIn['回复长度倾向']).trim()
  if (!isEmptyText(prefIn['表情使用'])) interactionPref.emoji = str(prefIn['表情使用']).trim()
  if (!isEmptyText(prefIn['话题舒适区'])) interactionPref.comfortZone = str(prefIn['话题舒适区']).trim()
  if (!isEmptyText(prefIn['雷区'])) interactionPref.taboo = str(prefIn['雷区']).trim()
  if (Object.keys(interactionPref).length > 0) aiwu.interactionPref = interactionPref

  const userIn = rec(input['user_persona'])
  const userPersona: AiwuUserPersona = {}
  if (!isEmptyText(userIn['你是谁'])) userPersona.who = str(userIn['你是谁']).trim()
  if (!isEmptyText(userIn['与 TA 的关系'])) userPersona.relation = str(userIn['与 TA 的关系']).trim()
  if (!isEmptyText(userIn['共同经历'])) userPersona.sharedHistory = str(userIn['共同经历']).trim()
  if (Object.keys(userPersona).length > 0) aiwu.userPersona = userPersona

  // ---- 开场白（逐字搬运，不加前缀）
  const opening = str(input['opening'])
  if (opening.trim() !== '') data.first_mes = opening
  const openings = list(input['openings'])
  if (openings.length > 0) data.alternate_greetings = openings

  // ---- 元信息
  data.creator = 'ai-with-u'
  data.character_version = '1.0'
  const source = str(input['source']).trim()
  aiwu.legacy = {
    from: opts.from ?? 'aiwu-v1',
    originalName: data.name,
    ...(source !== '' ? { source } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
    ...(now !== undefined ? { at: isoLocal(now) } : {}),
  }
  if (Object.keys(extra).length > 0) {
    const groups = Object.keys(extra).join('、')
    data.creator_notes = `⚠️ 迁移时以下字段没有对应位置，已原样保留在 extensions.aiwu.legacy.extra：${groups}`
  }
  if (!isEmptyText(input['creator_notes'])) data.creator_notes = str(input['creator_notes'])

  projectNative(data)
  if (now !== undefined) stampCardTimes({ spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data }, now)
  return { spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data }
}

// ============================================================================ 投影（结构 → 原生，单向）

/** 结构 → 原生字段。空结构不覆盖已有原生内容（保护外部导入/手工改过的字段）。 */
export function projectNative(data: CardData): void {
  const aiwu = awiuOf(data)
  if (aiwu === undefined) return

  const basic = aiwu.basic ?? {}
  const descriptionParts: string[] = []
  if (!isEmptyText(basic.identity)) descriptionParts.push(`身份：${str(basic.identity).trim()}`)
  if (!isEmptyText(basic.background)) descriptionParts.push(`背景：${str(basic.background).trim()}`)
  if (descriptionParts.length > 0) data.description = descriptionParts.join('\n\n')

  const personality = aiwu.personality ?? {}
  const personaParts: string[] = []
  if (list(personality.keywords).length > 0) personaParts.push(`关键词：${list(personality.keywords).join('、')}`)
  if (!isEmptyText(personality.contradiction)) personaParts.push(`内在矛盾：${str(personality.contradiction).trim()}`)
  if (!isEmptyText(personality.towardClose)) personaParts.push(`对待亲近之人：${str(personality.towardClose).trim()}`)
  if (personaParts.length > 0) data.personality = personaParts.join('\n')

  const world = aiwu.world ?? {}
  const worldParts: string[] = []
  if (!isEmptyText(world.origin)) worldParts.push(`来处：${str(world.origin).trim()}`)
  if (!isEmptyText(world.gap)) worldParts.push(`落差：${str(world.gap).trim()}`)
  if (!isEmptyText(world.nowadays)) worldParts.push(`如今的日子：${str(world.nowadays).trim()}`)
  if (!isEmptyText(world.sharedPast)) worldParts.push(`你与他的旧：${str(world.sharedPast).trim()}`)
  if (worldParts.length > 0) data.scenario = worldParts.join('\n')

  const systemPrompt = buildSystemPromptText(aiwu)
  if (systemPrompt !== '') data.system_prompt = systemPrompt

  const postHistory = buildPostHistoryText(aiwu)
  if (postHistory !== '') data.post_history_instructions = postHistory
}

/** 声线 + 互动偏好 → `system_prompt` 的投影文本（与 L1 的「声线/互动偏好」两段内容一致，避免双份）。 */
function buildSystemPromptText(aiwu: AiwuExtension): string {
  const voice = aiwu.voice ?? {}
  const pref = aiwu.interactionPref ?? {}
  const lines: string[] = []
  const voiceLines: string[] = []
  if (!isEmptyText(voice.pace)) voiceLines.push(`对话节奏：${str(voice.pace).trim()}`)
  if (list(voice.catchphrases).length > 0) voiceLines.push(`爱用句式：${list(voice.catchphrases).join('／')}`)
  if (!isEmptyText(voice.selfRef)) voiceLines.push(`自称：${str(voice.selfRef).trim()}`)
  if (!isEmptyText(voice.callsUser)) voiceLines.push(`对用户的称呼：${str(voice.callsUser).trim()}`)
  if (list(voice.emotes).length > 0) voiceLines.push(`情绪口头禅：${list(voice.emotes).join('／')}`)
  if (list(voice.gestures).length > 0) voiceLines.push(`非语言小动作：${list(voice.gestures).join('／')}`)
  if (voiceLines.length > 0) lines.push('【声线基因（最高优先级，决定每一句的措辞）】', ...voiceLines)
  const prefLines: string[] = []
  if (!isEmptyText(pref.length)) prefLines.push(`回复长度倾向：${str(pref.length).trim()}`)
  if (!isEmptyText(pref.emoji)) prefLines.push(`表情使用：${str(pref.emoji).trim()}`)
  if (!isEmptyText(pref.comfortZone)) prefLines.push(`话题舒适区：${str(pref.comfortZone).trim()}`)
  if (prefLines.length > 0) lines.push('【互动偏好】', ...prefLines)
  return lines.join('\n')
}

/** 禁忌词 + 雷区 → `post_history_instructions` 的投影文本。 */
function buildPostHistoryText(aiwu: AiwuExtension): string {
  const lines: string[] = []
  const forbidden = str(aiwu.voice?.forbidden).trim()
  const taboo = str(aiwu.interactionPref?.taboo).trim()
  if (forbidden !== '') lines.push(`禁忌词：${forbidden}`)
  if (taboo !== '') lines.push(`雷区：${taboo}`)
  return lines.length === 0 ? '' : ['【收尾提醒】', ...lines].join('\n')
}

export function stampCardTimes(card: CharacterCardV3, now: Date): void {
  const data = card.data
  const seconds = unixSeconds(now)
  if (typeof data.creation_date !== 'number') data.creation_date = seconds
  data.modification_date = seconds
  const aiwu = awiuOf(data)
  if (aiwu !== undefined) aiwu.updated_at = isoLocal(now)
}

// ============================================================================ 旧视图（过渡期兼容）

/**
 * CCv3 → 旧 34 字段视图（键名逐字对齐 `client/card-schema.ts` 的 GROUPS）。
 *
 * 读的顺序：`awiu` 结构 → （外部卡）原生字段尽力反解 → 空。
 */
export function toLegacyView(card: CharacterCardV3 | Json): LegacyCardView {
  const normalized = isV3Card(card) ? card : normalizeCard(card)
  const data = normalized.data
  const aiwu = awiuOf(normalized) ?? {}
  const importedRaw = rec(aiwu.imported?.raw)

  const pickRaw = (key: string): string => str(importedRaw[key]).trim()
  const view: LegacyCardView = { name: cardName(normalized) }

  const basic: Record<string, string> = { 姓名: view.name }
  if (!isEmptyText(aiwu.basic?.age)) basic['年龄'] = str(aiwu.basic?.age).trim()
  if (!isEmptyText(aiwu.basic?.identity)) basic['身份'] = str(aiwu.basic?.identity).trim()
  let background = str(aiwu.basic?.background).trim()
  if (background === '') background = pickRaw('description') !== '' ? pickRaw('description') : str(data.description).trim()
  if (background !== '') basic['一句话背景'] = background
  view.basic = basic

  const voice: Record<string, string | string[]> = {}
  if (!isEmptyText(aiwu.voice?.pace)) voice['对话节奏'] = str(aiwu.voice?.pace).trim()
  if (list(aiwu.voice?.catchphrases).length > 0) voice['爱用句式'] = list(aiwu.voice?.catchphrases)
  if (!isEmptyText(aiwu.voice?.selfRef)) voice['自称'] = str(aiwu.voice?.selfRef).trim()
  if (!isEmptyText(aiwu.voice?.callsUser)) voice['对用户的称呼'] = str(aiwu.voice?.callsUser).trim()
  if (list(aiwu.voice?.emotes).length > 0) voice['情绪口头禅'] = list(aiwu.voice?.emotes)
  if (!isEmptyText(aiwu.voice?.forbidden)) voice['禁忌词'] = str(aiwu.voice?.forbidden).trim()
  if (list(aiwu.voice?.gestures).length > 0) voice['非语言小动作'] = list(aiwu.voice?.gestures)
  if (Object.keys(voice).length > 0) view.voice = voice

  const personality: Record<string, string | string[]> = {}
  if (list(aiwu.personality?.keywords).length > 0) personality['关键词'] = list(aiwu.personality?.keywords)
  let contradiction = str(aiwu.personality?.contradiction).trim()
  if (contradiction === '') contradiction = pickRaw('personality') !== '' ? pickRaw('personality') : str(data.personality).trim()
  if (contradiction !== '') personality['内在矛盾'] = contradiction
  if (!isEmptyText(aiwu.personality?.towardClose)) personality['对待亲近之人'] = str(aiwu.personality?.towardClose).trim()
  if (Object.keys(personality).length > 0) view.personality = personality

  const relationship: Record<string, string> = {}
  if (!isEmptyText(aiwu.relationship?.startPoint)) relationship['关系起点'] = str(aiwu.relationship?.startPoint).trim()
  if (!isEmptyText(aiwu.relationship?.charCallsUser)) relationship['角色怎么称呼用户'] = str(aiwu.relationship?.charCallsUser).trim()
  if (!isEmptyText(aiwu.relationship?.userCallsChar)) relationship['用户怎么称呼角色'] = str(aiwu.relationship?.userCallsChar).trim()
  if (Object.keys(relationship).length > 0) view.relationship = relationship

  const world: Record<string, string> = {}
  if (!isEmptyText(aiwu.world?.origin)) world['来处'] = str(aiwu.world?.origin).trim()
  if (!isEmptyText(aiwu.world?.gap)) world['落差'] = str(aiwu.world?.gap).trim()
  if (!isEmptyText(aiwu.world?.nowadays)) world['如今的日子'] = str(aiwu.world?.nowadays).trim()
  if (!isEmptyText(aiwu.world?.sharedPast)) world['你与他的旧'] = str(aiwu.world?.sharedPast).trim()
  if (Object.keys(world).length === 0 && str(data.scenario).trim() !== '') {
    world['来处'] = pickRaw('scenario') !== '' ? pickRaw('scenario') : str(data.scenario).trim()
  }
  if (Object.keys(world).length > 0) view.world = world

  const anchors = list(aiwu.memoryAnchors)
  if (anchors.length > 0) view.memory_anchor = { 要点: anchors }

  const dynamicState: Record<string, string> = {}
  if (!isEmptyText(aiwu.dynamicState?.mood)) dynamicState['当前情绪'] = str(aiwu.dynamicState?.mood).trim()
  if (!isEmptyText(aiwu.dynamicState?.recent)) dynamicState['近况'] = str(aiwu.dynamicState?.recent).trim()
  if (!isEmptyText(aiwu.dynamicState?.doing)) dynamicState['此刻在做什么'] = str(aiwu.dynamicState?.doing).trim()
  if (Object.keys(dynamicState).length > 0) view.dynamic_state = dynamicState

  const interactionPref: Record<string, string> = {}
  if (!isEmptyText(aiwu.interactionPref?.length)) interactionPref['回复长度倾向'] = str(aiwu.interactionPref?.length).trim()
  if (!isEmptyText(aiwu.interactionPref?.emoji)) interactionPref['表情使用'] = str(aiwu.interactionPref?.emoji).trim()
  if (!isEmptyText(aiwu.interactionPref?.comfortZone)) interactionPref['话题舒适区'] = str(aiwu.interactionPref?.comfortZone).trim()
  if (!isEmptyText(aiwu.interactionPref?.taboo)) interactionPref['雷区'] = str(aiwu.interactionPref?.taboo).trim()
  if (Object.keys(interactionPref).length > 0) view.interaction_pref = interactionPref

  const userPersona: Record<string, string> = {}
  if (!isEmptyText(aiwu.userPersona?.who)) userPersona['你是谁'] = str(aiwu.userPersona?.who).trim()
  if (!isEmptyText(aiwu.userPersona?.relation)) userPersona['与 TA 的关系'] = str(aiwu.userPersona?.relation).trim()
  if (!isEmptyText(aiwu.userPersona?.sharedHistory)) userPersona['共同经历'] = str(aiwu.userPersona?.sharedHistory).trim()
  if (Object.keys(userPersona).length > 0) view.user_persona = userPersona

  if (str(data.first_mes) !== '') view.opening = str(data.first_mes)
  if (list(data.alternate_greetings).length > 0) view.openings = list(data.alternate_greetings)
  view.source = cardSource(normalized)
  return view
}

/**
 * 旧 34 字段视图 → CCv3（**以现有 CCv3 为底合并，绝不重建对象**）。
 *
 * 这是风险 B 的解药：面板只改一个字段，其余 `extensions.aiwu`、`character_book`、
 * 别人的 extensions 必须原样活下来。
 */
export function fromLegacyView(view: LegacyCardView, base?: CharacterCardV3 | Json): CharacterCardV3 {
  const card: CharacterCardV3 = base === undefined
    ? normalizeCard({ name: view.name })
    : clone(isV3Card(base) ? base : normalizeCard(base))
  const data = card.data
  fillDataDefaults(data, {})
  const aiwu = ensureAiwu(data)
  const before = toLegacyView(card)

  const basicIn = rec(view.basic)
  const voiceIn = rec(view.voice)
  const personaIn = rec(view.personality)
  const relIn = rec(view.relationship)
  const worldIn = rec(view.world)
  const stateIn = rec(view.dynamic_state)
  const prefIn = rec(view.interaction_pref)
  const userIn = rec(view.user_persona)

  if (Object.keys(basicIn).length > 0) {
    const basic: AiwuBasic = { ...(aiwu.basic ?? {}) }
    assignText(basic, 'age', basicIn, '年龄')
    assignText(basic, 'identity', basicIn, '身份')
    assignText(basic, 'background', basicIn, '一句话背景')
    aiwu.basic = compact(basic)
  }
  if (Object.keys(voiceIn).length > 0) {
    const voice: AiwuVoice = { ...(aiwu.voice ?? {}) }
    assignText(voice, 'pace', voiceIn, '对话节奏')
    assignList(voice, 'catchphrases', voiceIn, '爱用句式')
    assignText(voice, 'selfRef', voiceIn, '自称')
    assignText(voice, 'callsUser', voiceIn, '对用户的称呼')
    assignList(voice, 'emotes', voiceIn, '情绪口头禅')
    assignText(voice, 'forbidden', voiceIn, '禁忌词')
    assignList(voice, 'gestures', voiceIn, '非语言小动作')
    aiwu.voice = compact(voice)
  }
  if (Object.keys(personaIn).length > 0) {
    const personality: AiwuPersonality = { ...(aiwu.personality ?? {}) }
    assignList(personality, 'keywords', personaIn, '关键词')
    assignText(personality, 'contradiction', personaIn, '内在矛盾')
    assignText(personality, 'towardClose', personaIn, '对待亲近之人')
    aiwu.personality = compact(personality)
  }
  if (Object.keys(relIn).length > 0) {
    const relationship: AiwuRelationship = { ...(aiwu.relationship ?? {}) }
    assignText(relationship, 'startPoint', relIn, '关系起点')
    assignText(relationship, 'charCallsUser', relIn, '角色怎么称呼用户')
    assignText(relationship, 'userCallsChar', relIn, '用户怎么称呼角色')
    aiwu.relationship = compact(relationship)
  }
  if (Object.keys(worldIn).length > 0) {
    const world: AiwuWorld = { ...(aiwu.world ?? {}) }
    assignText(world, 'origin', worldIn, '来处')
    assignText(world, 'gap', worldIn, '落差')
    assignText(world, 'nowadays', worldIn, '如今的日子')
    assignText(world, 'sharedPast', worldIn, '你与他的旧')
    aiwu.world = compact(world)
  }
  if (isRecord(view.memory_anchor)) {
    const bucket = view.memory_anchor
    // 标准形状是 `{ 要点: string[] }`；但旧卡也出现过 `{ 背景: "..." }` 这种自定义键，
    // 一律拍平成 string[]，**不许因为键名不认识就把记忆丢了**（后者曾是真实数据丢失点）。
    const anchors = '要点' in bucket
      ? list(bucket['要点'])
      : Object.values(bucket).flatMap(value => list(value))
    if (anchors.length > 0) aiwu.memoryAnchors = anchors
  }
  if (Object.keys(stateIn).length > 0) {
    const state: AiwuDynamicState = { ...(aiwu.dynamicState ?? {}) }
    assignText(state, 'mood', stateIn, '当前情绪')
    assignText(state, 'recent', stateIn, '近况')
    assignText(state, 'doing', stateIn, '此刻在做什么')
    aiwu.dynamicState = compact(state)
  }
  if (Object.keys(prefIn).length > 0) {
    const pref: AiwuInteractionPref = { ...(aiwu.interactionPref ?? {}) }
    assignText(pref, 'length', prefIn, '回复长度倾向')
    assignText(pref, 'emoji', prefIn, '表情使用')
    assignText(pref, 'comfortZone', prefIn, '话题舒适区')
    assignText(pref, 'taboo', prefIn, '雷区')
    aiwu.interactionPref = compact(pref)
  }
  if (Object.keys(userIn).length > 0) {
    const persona: AiwuUserPersona = { ...(aiwu.userPersona ?? {}) }
    assignText(persona, 'who', userIn, '你是谁')
    assignText(persona, 'relation', userIn, '与 TA 的关系')
    assignText(persona, 'sharedHistory', userIn, '共同经历')
    aiwu.userPersona = compact(persona)
  }

  if (typeof view.opening === 'string') data.first_mes = view.opening
  if (Array.isArray(view.openings)) data.alternate_greetings = view.openings.map(String).filter(s => s.trim() !== '')

  // 用户在面板改了某个原生投影段 → 该段不再用外部原文（转结构权威）
  clearImportedForChangedSections(aiwu, before, view)

  projectNative(data)
  return { spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data }
}

function assignText(target: Record<string, unknown>, targetKey: string, source: Json, sourceKey: string): void {
  if (!(sourceKey in source)) return
  const value = str(source[sourceKey]).trim()
  if (value === '') delete target[targetKey]
  else target[targetKey] = value
}

function assignList(target: Record<string, unknown>, targetKey: string, source: Json, sourceKey: string): void {
  if (!(sourceKey in source)) return
  const value = list(source[sourceKey])
  if (value.length === 0) delete target[targetKey]
  else target[targetKey] = value
}

function compact<T>(value: T): T {
  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const item = obj[key]
    if (item === undefined || item === null) { delete obj[key]; continue }
    if (typeof item === 'string' && item.trim() === '') delete obj[key]
    if (Array.isArray(item) && item.length === 0) delete obj[key]
  }
  return value
}

/** 结构改动后清掉对应的 `imported.raw` 条目（保真 → 结构权威）。 */
function clearImportedForChangedSections(aiwu: AiwuExtension, before: LegacyCardView, after: LegacyCardView): void {
  const raw = aiwu.imported?.raw
  if (raw === undefined) return
  const sectionOf: Record<string, string[]> = {
    description: ['basic'],
    personality: ['personality'],
    scenario: ['world'],
    system_prompt: ['voice', 'interaction_pref'],
    post_history_instructions: ['voice', 'interaction_pref'],
    mes_example: [],
  }
  const changed = (key: string): boolean => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)
  for (const [rawKey, sections] of Object.entries(sectionOf)) {
    if (!(rawKey in raw)) continue
    if (sections.some(changed)) delete raw[rawKey]
  }
  if (Object.keys(raw).length === 0) delete aiwu.imported
}

// ============================================================================ 宏与装饰器

export type MacroMode = 'stable' | 'live'

export interface MacroContext {
  char: string
  user: string
  mode: MacroMode
  /** 可注入的随机源（测试用）；默认 Math.random。 */
  random?: () => number
}

const COMMENT_MACRO = /\{\{\s*(\/\/[\s\S]*?|comment\s*:[\s\S]*?)\}\}/gu
const SIMPLE_MACRO = /\{\{\s*(char|user)\s*\}\}/gu
const LIST_MACRO = /\{\{\s*(random|pick)\s*:([^{}]*)\}\}/gu
const ROLL_MACRO = /\{\{\s*roll\s*:\s*(?:1?d)?(\d+)\s*\}\}/giu

/**
 * 拆分 `{{random:A,B,C}}` 的参数：支持 `\,` 转义逗号（酒馆写法），去空白。
 */
function splitMacroList(body: string): string[] {
  const items: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '\\' && body[i + 1] === ',') { current += ','; i += 1; continue }
    if (ch === ',') { items.push(current.trim()); current = ''; continue }
    current += ch
  }
  items.push(current.trim())
  return items.filter(item => item !== '')
}

/**
 * 宏替换。
 *
 * `stable` 用于 L1（静态块）：`{{random}}`/`{{pick}}` 取首项、`{{roll}}` 渲染成 `dN`——
 * 因为静态块每轮重新求值，真随机会让前缀缓存每轮失效、设定看着在跳。
 * `live` 用于开场白/候选生成：真随机、真投骰。
 */
export function expandMacros(text: string, ctx: MacroContext): string {
  if (typeof text !== 'string' || text === '') return ''
  const random = ctx.random ?? Math.random
  let out = text.replace(COMMENT_MACRO, '')
  out = out.replace(SIMPLE_MACRO, (_match, name: string) => (name === 'char' ? ctx.char : ctx.user))
  out = out.replace(LIST_MACRO, (_match, _kind: string, body: string) => {
    const items = splitMacroList(body)
    if (items.length === 0) return ''
    if (ctx.mode === 'stable') return items[0] ?? ''
    const index = Math.min(items.length - 1, Math.floor(random() * items.length))
    return items[index] ?? ''
  })
  out = out.replace(ROLL_MACRO, (_match, sides: string) => {
    const n = Number(sides)
    if (!Number.isFinite(n) || n <= 0) return ''
    if (ctx.mode === 'stable') return `d${n}`
    return String(1 + Math.floor(random() * n))
  })
  // ⚠️ 不认识的 `{{xxx}}` **原样保留**（绝不抛错）。
  // 宿主自己的 interpolate 会对未知变量 throw；所以我们把每段都注册成 interpolate:false，
  // 由这一层负责"认识的展开、不认识的原样留着"（Lead 2026-10-30 调研结论）。
  return out
}

/**
 * 剥离世界书条目里的 `@@` 装饰器。
 *
 * 已知的解析进返回值，**未知的整行丢弃**——绝不能把 `@@xxx` 当正文注入。
 */
export function parseDecorators(content: string): { content: string; decorators: Record<string, string> } {
  const decorators: Record<string, string> = {}
  const kept: string[] = []
  for (const line of content.split(/\r?\n/u)) {
    const match = /^\s*@@\s*([^\s]+)\s*(.*)$/u.exec(line)
    if (match === null) { kept.push(line); continue }
    const key = (match[1] ?? '').toLowerCase()
    const value = (match[2] ?? '').trim()
    if (['depth', 'position', 'scan_depth', 'role', 'activate', 'dont_activate', 'probability', 'cooldown'].includes(key)) {
      decorators[key] = value
    }
    // 未知装饰器：整行丢弃（不注入、不报错）
  }
  return { content: kept.join('\n').trim(), decorators }
}

// ============================================================================ 世界书选择（⏳ 默认值待调研定稿）

export interface LoreSelectionDiagnostics {
  scannedChars: number
  hitCount: number
  constantCount: number
  usedChars: number
  budgetChars: number
  maxEntries: number
  /** 首条超预算仍被注入（保证"命中了却什么都没给"不会发生）。 */
  forcedOverBudget: boolean
  droppedByBudget: string[]
  deduped: string[]
}

export interface LoreSelection {
  entries: Array<{ id: string; name: string; position: 'before_char' | 'after_char'; text: string }>
  text: string
  diag: LoreSelectionDiagnostics
}

export interface LoreSelectOptions {
  scanDepth?: number
  budgetChars?: number
  maxEntries?: number
  /** 递归激活（未实现，占位；调用方传 true 会在实现里被忽略并留注释）。 */
  recursive?: boolean
  enabled?: boolean
  charName?: string
  userName?: string
  /** 本轮哨兵（`agentId:turn`）：probability 稳定哈希的种子，同轮结果固定。 */
  turnSeed?: string
}

interface ScoredEntry {
  entry: CharacterBookEntry
  /** 去重键（id/name/内容三选一，带命名空间防撞）。 */
  key: string
  /** 对外暴露的 id（原始 id / name / 内容摘要）。 */
  id: string
  name: string
  position: 'before_char' | 'after_char'
  text: string
  constant: boolean
  priority: number
  order: number
}

function entryIdentity(entry: CharacterBookEntry): string {
  if (entry.id !== undefined && str(entry.id).trim() !== '') return `id:${str(entry.id)}`
  if (!isEmptyText(entry.name)) return `name:${str(entry.name).trim()}`
  return `content:${str(entry.content).trim().slice(0, 64)}`
}

function entryExtensions(entry: CharacterBookEntry): Json {
  return isRecord(entry.extensions) ? entry.extensions : {}
}

/**
 * Unicode 整词边界匹配。
 *
 * ⚠️ 绝不能用 `\W` / `\b`：汉字属于 `\W`，`\b便利贴\b` 在中文里几乎永远不命中
 * （调研报告 §4.4 坑 6，`dsh-tavern` 就踩了）。
 */
function wholeWordHit(needle: string, haystack: string, caseSensitive: boolean): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  try {
    const flags = caseSensitive ? 'u' : 'iu'
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags).test(haystack)
  } catch {
    return caseSensitive ? haystack.includes(needle) : haystack.toLowerCase().includes(needle.toLowerCase())
  }
}

function matchesKey(key: string, text: string, entry: CharacterBookEntry): boolean {
  const needle = key.trim()
  if (needle === '') return false
  const caseSensitive = entry.case_sensitive === true
  if (entry.use_regex === true) {
    try {
      return new RegExp(needle, caseSensitive ? 'u' : 'iu').test(text)
    } catch {
      // 用户写坏正则：退化成字面量匹配（不抛错，否则整轮对话进不去）
      return caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle.toLowerCase())
    }
  }
  const extensions = entryExtensions(entry)
  const wholeWord = extensions['match_whole_words'] === true || extensions['matchWholeWords'] === true
  if (wholeWord) return wholeWordHit(needle, text, caseSensitive)
  return caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle.toLowerCase())
}

/** FNV-1a 稳定哈希：`probability` 用它，**绝不用 `Math.random`**（那会让系统提示每轮变化、KV 缓存全废）。 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * 次级关键词逻辑（四值，与 `dsh-bard` / `dsh-universal-worldbook` 对齐）：
 * `{0: AND_ANY, 1: NOT_ALL, 2: NOT_ANY, 3: AND_ALL}`。
 */
const SELECTIVE_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 } as const

function selectiveLogicOf(entry: CharacterBookEntry): number {
  const raw = entryExtensions(entry)['selectiveLogic'] ?? entryExtensions(entry)['selective_logic']
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string') {
    const upper = raw.trim().toUpperCase()
    const mapped: Record<string, number> = {
      AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3, ANY: 0, NOTALL: 1, NOTANY: 2, ALL: 3,
    }
    if (mapped[upper] !== undefined) return mapped[upper] ?? 0
  }
  return SELECTIVE_LOGIC.AND_ANY
}

function secondaryPasses(entry: CharacterBookEntry, scanned: string): boolean {
  const secondary = list(entry.secondary_keys)
  if (secondary.length === 0) return true
  const hits = secondary.filter(key => matchesKey(key, scanned, entry)).length
  switch (selectiveLogicOf(entry)) {
    case SELECTIVE_LOGIC.NOT_ALL: return hits < secondary.length
    case SELECTIVE_LOGIC.NOT_ANY: return hits === 0
    case SELECTIVE_LOGIC.AND_ALL: return hits === secondary.length
    default: return hits > 0
  }
}

/**
 * 选世界书条目（纯函数）。
 *
 * 规则（已按调研报告 §4.3 定稿）：
 * - `enabled === false` 或 `disable === true` 过滤（**两个字段反义，不能混用**——报告 §4.4 坑 8）；
 * - `constant` 无条件激活；`@@dont_activate` 装饰器只靠 constant；
 * - 关键词匹配：包含匹配（默认忽略大小写）→ `use_regex` → `match_whole_words`（Unicode 边界）；
 * - `secondary_keys` 按 `selectiveLogic` 四值判定；
 * - `probability` 用 FNV-1a 稳定哈希（种子 = 本轮 turnSeed + 条目 id），不破坏缓存；
 * - 排序：`constant` 优先 → `priority` 降序 → `insertion_order` 降序 → 名字；
 * - 去重：id / 名字 / 渲染后内容三选一，同一轮同一条只出现一次；
 * - 预算：`maxEntries`（默认 12）与 `budgetChars`（默认 6000 字，`token_budget` 按 1.5 字/token 换算）；
 *   **首条超预算也注入**（保证"命中了却什么都没注入"不会发生）。
 *
 * 不做：递归激活（第一版明确不做——报告 §4.3.3 第 4 条：收益低、放大预算风险，留 TODO）。
 */
export function selectLoreEntries(
  book: CharacterBook | undefined,
  recentTexts: string[],
  options: LoreSelectOptions = {},
): LoreSelection {
  const empty: LoreSelection = {
    entries: [],
    text: '',
    diag: {
      scannedChars: 0,
      hitCount: 0,
      constantCount: 0,
      usedChars: 0,
      budgetChars: 0,
      maxEntries: 0,
      forcedOverBudget: false,
      droppedByBudget: [],
      deduped: [],
    },
  }
  if (book === undefined || !Array.isArray(book.entries) || book.entries.length === 0 || options.enabled === false) return empty

  const scanDepth = positiveInt(options.scanDepth)
    ?? positiveInt(typeof book.scan_depth === 'number' ? book.scan_depth : undefined)
    ?? LORE_DEFAULTS.scanDepth
  // 按轮滚动：只扫最近 scanDepth 条角色消息（近似 D0..Dn 槽位，工具轮不额外占槽）
  const texts = recentTexts.filter(t => typeof t === 'string' && t.trim() !== '').slice(-scanDepth)
  const scanned = texts.join('\n')
  const turnSeed = options.turnSeed ?? `${texts.length}:${scanned.slice(0, 24)}`
  const tokenBudget = typeof book.token_budget === 'number' && book.token_budget > 0
    ? Math.floor(book.token_budget * LORE_DEFAULTS.charsPerToken)
    : undefined
  const explicitBudget = positiveInt(options.budgetChars)
  const budgetChars = Math.max(0, Math.min(
    explicitBudget ?? Number.MAX_SAFE_INTEGER,
    tokenBudget ?? Number.MAX_SAFE_INTEGER,
    explicitBudget === undefined && tokenBudget === undefined ? LORE_DEFAULTS.budgetChars : Number.MAX_SAFE_INTEGER,
  ))
  const maxEntries = positiveInt(options.maxEntries) ?? LORE_DEFAULTS.maxEntries

  const seen = new Set<string>()
  const seenContent = new Set<string>()
  const deduped: string[] = []
  const scored: ScoredEntry[] = []
  let constantCount = 0
  let hitCount = 0

  for (const rawEntry of book.entries) {
    if (!isRecord(rawEntry)) continue
    const entry = rawEntry as unknown as CharacterBookEntry
    // enabled / disable 反义：卡内 book 用 enabled；防御性地也认 disable（独立 .json 世界书的心智）
    if (entry.enabled === false) continue
    if (entryExtensions(entry)['disable'] === true) continue

    const parsed = parseDecorators(str(entry.content))
    const text = expandMacros(parsed.content, {
      char: options.charName ?? '',
      user: options.userName ?? '你',
      mode: 'stable',
    })
    if (text.trim() === '') continue

    const identity = entryIdentity(entry)
    const displayId = (entry.id !== undefined && str(entry.id).trim() !== '')
      ? str(entry.id).trim()
      : (isEmptyText(entry.name) ? identity : str(entry.name).trim())
    const contentKey = text.replace(/\s+/gu, ' ').trim()
    const isConstant = entry.constant === true || parsed.decorators['activate'] !== undefined

    // 装饰器覆盖：@@dont_activate = 不参与关键词激活，只靠 constant
    const blocked = parsed.decorators['dont_activate'] !== undefined
    const keysHit = !blocked && list(entry.keys).some(key => matchesKey(key, scanned, entry))
    let active = isConstant || (keysHit && secondaryPasses(entry, scanned))

    // probability：稳定哈希，同一轮内结果固定（Math.random 会毁缓存）
    if (active) {
      const probability = Number(entryExtensions(entry)['probability'])
      if (Number.isFinite(probability) && probability > 0 && probability < 100) {
        active = fnv1a(`${turnSeed}:${identity}`) % 100 < probability
      }
    }
    if (!active) continue

    if (seen.has(identity) || seenContent.has(contentKey)) {
      deduped.push(identity)
      continue
    }
    seen.add(identity)
    seenContent.add(contentKey)

    if (isConstant) constantCount += 1
    else hitCount += 1
    scored.push({
      entry,
      key: identity,
      id: displayId,
      name: isEmptyText(entry.name) ? displayId : str(entry.name).trim(),
      position: entry.position === 'before_char' ? 'before_char' : 'after_char',
      text,
      constant: isConstant,
      priority: typeof entry.priority === 'number' ? entry.priority : 0,
      order: typeof entry.insertion_order === 'number' ? entry.insertion_order : 100,
    })
  }

  scored.sort((a, b) => {
    if (a.constant !== b.constant) return a.constant ? -1 : 1
    if (a.priority !== b.priority) return b.priority - a.priority
    if (a.order !== b.order) return b.order - a.order
    return a.name.localeCompare(b.name)
  })

  const kept: ScoredEntry[] = []
  const dropped: string[] = []
  let used = 0
  let forcedOverBudget = false
  for (const item of scored) {
    if (kept.length >= maxEntries) { dropped.push(item.id); continue }
    if (used + item.text.length > budgetChars) {
      // 首条超预算也注入：宁可超一点，也不能"命中了却什么都没给模型"
      if (kept.length === 0) {
        kept.push(item)
        used += item.text.length
        forcedOverBudget = true
        continue
      }
      dropped.push(item.id)
      continue
    }
    used += item.text.length
    kept.push(item)
  }

  const sections: Array<{ title: string; items: ScoredEntry[] }> = [
    { title: '▎先读这些设定（世界书 · before_char）', items: kept.filter(i => i.position === 'before_char') },
    { title: '▎相关设定（世界书命中）', items: kept.filter(i => i.position === 'after_char') },
  ]
  const blocks: string[] = []
  for (const section of sections) {
    if (section.items.length === 0) continue
    blocks.push([section.title, ...section.items.map(i => i.text)].join('\n\n'))
  }

  return {
    entries: kept.map(i => ({ id: i.id, name: i.name, position: i.position, text: i.text })),
    text: blocks.join('\n\n'),
    diag: {
      scannedChars: scanned.length,
      hitCount,
      constantCount,
      usedChars: used,
      budgetChars,
      maxEntries,
      forcedOverBudget,
      droppedByBudget: dropped,
      deduped,
    },
  }
}

function positiveInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

// ============================================================================ L1 渲染

export interface L1Extras {
  /** 世界书命中段（`selectLoreEntries().text`，含小标题）。 */
  loreText?: string
  /** 时间差/当前时间段（**已含标题**，由 prompt.ts 渲染）。 */
  timeGapText?: string
  /** 会话摘要段（已含标题）。 */
  sessionText?: string
  /** 最近日记段（已含标题）。 */
  diaryText?: string
  /** 交互模式段（已含标题）。 */
  modeText?: string
  /** 「关系」输出口径段（已含标题）。 */
  relationHint?: string
}

/** L1 静态块（第 1–12 段）→ 文本。与 `renderL1` 共用，供长度统计。 */
export function renderL1Static(card: CharacterCardV3): string {
  const data = card.data
  const aiwu = awiuOf(card) ?? {}
  const importedRaw = rec(aiwu.imported?.raw)
  const raw = (key: string): string => str(importedRaw[key]).trim()

  const name = cardName(card)
  const macroCtx: MacroContext = {
    char: (typeof data.nickname === 'string' && data.nickname.trim() !== '') ? data.nickname.trim() : name,
    user: str(aiwu.userPersona?.displayName).trim() !== '' ? str(aiwu.userPersona?.displayName).trim() : '你',
    mode: 'stable',
  }
  const expand = (text: string): string => expandMacros(text, macroCtx)
  const parts: string[] = [`## 你现在的身份：${name}`]

  const block = (title: string, body: string): void => {
    const text = body.trim()
    if (text !== '') parts.push(`▎${title}\n${text}`)
  }

  const description = raw('description') !== '' ? raw('description') : str(data.description)
  if (description.trim() !== '') block('角色定义', expand(description))

  const personality = raw('personality') !== '' ? raw('personality') : str(data.personality)
  if (personality.trim() !== '') block('性格核心', expand(personality))

  const voiceLines: string[] = []
  if (!isEmptyText(aiwu.voice?.pace)) voiceLines.push(`对话节奏：${str(aiwu.voice?.pace).trim()}`)
  if (list(aiwu.voice?.catchphrases).length > 0) voiceLines.push(`爱用句式：${list(aiwu.voice?.catchphrases).join('／')}`)
  if (!isEmptyText(aiwu.voice?.selfRef)) voiceLines.push(`自称：${str(aiwu.voice?.selfRef).trim()}`)
  if (!isEmptyText(aiwu.voice?.callsUser)) voiceLines.push(`对用户的称呼：${str(aiwu.voice?.callsUser).trim()}`)
  if (list(aiwu.voice?.emotes).length > 0) voiceLines.push(`情绪口头禅：${list(aiwu.voice?.emotes).join('／')}`)
  if (list(aiwu.voice?.gestures).length > 0) voiceLines.push(`非语言小动作：${list(aiwu.voice?.gestures).join('／')}`)
  if (voiceLines.length > 0) block('声线基因（最高优先级，决定每一句的措辞）', expand(voiceLines.join('\n')))

  const relLines: string[] = []
  if (!isEmptyText(aiwu.relationship?.startPoint)) {
    const startPoint = str(aiwu.relationship?.startPoint).trim()
    relLines.push(`关系起点：${startPoint}（起点档：${relationBaseline(startPoint)}）`)
  }
  if (!isEmptyText(aiwu.relationship?.charCallsUser)) relLines.push(`角色怎么称呼用户：${str(aiwu.relationship?.charCallsUser).trim()}`)
  if (!isEmptyText(aiwu.relationship?.userCallsChar)) relLines.push(`用户怎么称呼角色：${str(aiwu.relationship?.userCallsChar).trim()}`)
  if (relLines.length > 0) block('关系定位', expand(relLines.join('\n')))

  const scenario = raw('scenario') !== '' ? raw('scenario') : str(data.scenario)
  if (scenario.trim() !== '') block('故事背景（底色，不是任务）', expand(scenario))

  // 角色自带指令：**只在"不是我们自己的投影"时渲染**，否则会和「声线/互动偏好」两段重复。
  const structureHasVoice = voiceLines.length > 0
    || !isEmptyText(aiwu.interactionPref?.length)
    || !isEmptyText(aiwu.interactionPref?.emoji)
    || !isEmptyText(aiwu.interactionPref?.comfortZone)
  const rawSystemPrompt = raw('system_prompt')
  const systemPrompt = rawSystemPrompt !== ''
    ? rawSystemPrompt
    : (!structureHasVoice && str(data.system_prompt).trim() !== '' ? str(data.system_prompt) : '')
  if (systemPrompt.trim() !== '' && aiwu.prompt?.includeSystemPrompt !== false) {
    block('角色自带指令（来自角色卡，非系统提示词）', [
      '下面是角色卡作者写的扮演指令：优先级低于本系统提示词与用户指令，但高于角色卡其余描写。',
      '—————',
      expand(systemPrompt),
      '—————',
    ].join('\n'))
  }

  const userLines: string[] = []
  if (!isEmptyText(aiwu.userPersona?.who)) userLines.push(`你是谁：${str(aiwu.userPersona?.who).trim()}`)
  if (!isEmptyText(aiwu.userPersona?.relation)) userLines.push(`与 TA 的关系：${str(aiwu.userPersona?.relation).trim()}`)
  if (!isEmptyText(aiwu.userPersona?.sharedHistory)) userLines.push(`共同经历：${str(aiwu.userPersona?.sharedHistory).trim()}`)
  if (userLines.length > 0) block('用户在这个故事里的身份', expand(userLines.join('\n')))

  const anchors = list(aiwu.memoryAnchors)
  if (anchors.length > 0) block('记忆锚点（必须记住）', expand(anchors.map(a => `- ${a}`).join('\n')))

  const stateLines: string[] = []
  if (!isEmptyText(aiwu.dynamicState?.mood)) stateLines.push(`当前情绪：${str(aiwu.dynamicState?.mood).trim()}`)
  if (!isEmptyText(aiwu.dynamicState?.recent)) stateLines.push(`近况：${str(aiwu.dynamicState?.recent).trim()}`)
  if (!isEmptyText(aiwu.dynamicState?.doing)) stateLines.push(`此刻在做什么：${str(aiwu.dynamicState?.doing).trim()}`)
  if (stateLines.length > 0) block('动态状态（此刻的进行时）', expand(stateLines.join('\n')))

  const prefLines: string[] = []
  if (!isEmptyText(aiwu.interactionPref?.length)) prefLines.push(`回复长度倾向：${str(aiwu.interactionPref?.length).trim()}`)
  if (!isEmptyText(aiwu.interactionPref?.emoji)) prefLines.push(`表情使用：${str(aiwu.interactionPref?.emoji).trim()}`)
  if (!isEmptyText(aiwu.interactionPref?.comfortZone)) prefLines.push(`话题舒适区：${str(aiwu.interactionPref?.comfortZone).trim()}`)
  if (prefLines.length > 0) block('互动偏好', expand(prefLines.join('\n')))

  const mesExample = raw('mes_example') !== '' ? raw('mes_example') : str(data.mes_example)
  if (mesExample.trim() !== '' && aiwu.prompt?.includeMesExamples !== false) {
    block('示例对话（照这个口气说话，别照抄情节）', clipMesExample(expand(mesExample)))
  }

  return parts.join('\n\n')
}

/** `mes_example` 按 `<START>` / `block:` 分块裁剪到预算内（不切半句台词）。 */
export function clipMesExample(text: string, budget = MES_EXAMPLE_BUDGET): string {
  const source = text.trim()
  if (source.length <= budget) return source
  const blocks = source.split(/<START>|\[START\]|block:\s*\d*/iu).map(s => s.trim()).filter(s => s !== '')
  if (blocks.length <= 1) return source.slice(0, budget).trim()
  const kept: string[] = []
  let used = 0
  for (const block of blocks) {
    if (used + block.length > budget && kept.length > 0) break
    kept.push(block)
    used += block.length
  }
  return kept.join('\n\n')
}

/**
 * L1 段渲染（启用时注入的唯一角色段）。
 *
 * 顺序（设计文档 §3.2）：静态人设 1–12 → 世界书 → 时间差 → 会话 → 日记 → 交互模式 → 关系口径 → 收尾提醒。
 * 静态块在前、易变块在后：保住 prompt 前缀缓存。
 */
export function renderL1(card: CharacterCardV3, extras: L1Extras = {}): string {
  const data = card.data
  const aiwu = awiuOf(card) ?? {}
  const parts: string[] = [renderL1Static(card)]

  if (extras.loreText !== undefined && extras.loreText.trim() !== '') parts.push(extras.loreText.trim())
  if (extras.timeGapText !== undefined && extras.timeGapText.trim() !== '') parts.push(extras.timeGapText.trim())
  if (extras.sessionText !== undefined && extras.sessionText.trim() !== '') parts.push(extras.sessionText.trim())
  if (extras.diaryText !== undefined && extras.diaryText.trim() !== '') parts.push(extras.diaryText.trim())
  if (extras.modeText !== undefined && extras.modeText.trim() !== '') parts.push(extras.modeText.trim())
  if (extras.relationHint !== undefined && extras.relationHint.trim() !== '') parts.push(extras.relationHint.trim())

  // 收尾提醒：raw 原文优先；否则结构（禁忌词+雷区）；否则原生（外部卡）
  const importedRaw = rec(aiwu.imported?.raw)
  const rawPost = str(importedRaw['post_history_instructions']).trim()
  const structural = buildPostHistoryText(aiwu)
  const structuralHasContent = str(aiwu.voice?.forbidden).trim() !== '' || str(aiwu.interactionPref?.taboo).trim() !== ''
  let postHistory = ''
  if (rawPost !== '') postHistory = rawPost
  else if (structuralHasContent) postHistory = structural
  else if (str(data.post_history_instructions).trim() !== '') postHistory = str(data.post_history_instructions).trim()
  if (postHistory !== '') {
    const macroCtx: MacroContext = {
      char: (typeof data.nickname === 'string' && data.nickname.trim() !== '') ? data.nickname.trim() : cardName(card),
      user: str(aiwu.userPersona?.displayName).trim() !== '' ? str(aiwu.userPersona?.displayName).trim() : '你',
      mode: 'stable',
    }
    parts.push(['## 收尾提醒（角色卡自带）', '', expandMacros(postHistory, macroCtx)].join('\n'))
  }

  return parts.filter(p => p.trim() !== '').join('\n\n')
}

// ============================================================================ 忘却（全卡按句手术）

export interface ForgetCardResult {
  card: CharacterCardV3
  removed: string[]
  scanned: { fields: number; entries: number; rawFields: number }
  warnings: string[]
}

/** 按句删除命中关键词的句子（句子分隔符保留链）。 */
export function removeSentences(text: string, keywords: string[]): string {
  if (keywords.length === 0 || text === '') return text
  const parts = text.split(/(?<=[。！？!?；;\n])/u)
  const kept = parts.filter(part => !keywords.some(k => part.includes(k)))
  return kept.join('').replace(/\n{3,}/gu, '\n\n').trim()
}

/**
 * 「忘却」：在**卡内一切会被注入/被看到的文本**里按句删除关键词，然后重投影原生字段。
 *
 * 设计文档 §2.7：这是一次"全卡按句手术"，不是"两个字段的补丁"——
 * 所以遍历的是 `extensions.aiwu` 整棵树的字符串叶子，而不是硬编码字段名。
 * 硬编码字段名就会在下次加字段时再次静默失效（Lead P0-1 的根因）。
 */
export function forgetCardText(card: CharacterCardV3, keywords: string[]): ForgetCardResult {
  const next: CharacterCardV3 = clone(card)
  const removed: string[] = []
  const warnings: string[] = []
  const scanned = { fields: 0, entries: 0, rawFields: 0 }
  if (keywords.length === 0) return { card: next, removed, scanned, warnings }

  const hit = (text: string): boolean => keywords.some(k => text.includes(k))

  /** 递归处理一个 JSON 节点，返回"处理后的节点"（字符串按句删、数组逐项删）。 */
  const walk = (node: unknown, path: string, sink: (text: string, path: string) => void): unknown => {
    if (typeof node === 'string') {
      scanned.fields += 1
      sink(node, path)
      if (!hit(node)) return node
      const cleaned = removeSentences(node, keywords)
      removed.push(`${path}：${clipForReport(node)}`)
      return cleaned
    }
    if (Array.isArray(node)) {
      const out: unknown[] = []
      node.forEach((item, index) => {
        if (typeof item === 'string') {
          scanned.fields += 1
          if (hit(item)) {
            removed.push(`${path}[${index}]：${clipForReport(item)}`)
            return
          }
          out.push(item)
          return
        }
        out.push(walk(item, `${path}[${index}]`, sink))
      })
      return out
    }
    if (isRecord(node)) {
      const out: Json = {}
      for (const [key, value] of Object.entries(node)) {
        out[key] = walk(value, path === '' ? key : `${path}.${key}`, sink)
      }
      return out
    }
    return node
  }

  const aiwu = awiuOf(next)
  if (aiwu !== undefined) {
    const skip = new Set(['schema', 'updated_at', 'prompt', 'legacy'])
    for (const [key, value] of Object.entries(aiwu)) {
      if (skip.has(key)) continue
      const result = walk(value, `awiu.${key}`, () => { /* 只计数 */ })
      if (result === undefined) delete aiwu[key]
      else aiwu[key] = result as never
    }
  } else {
    warnings.push('这张卡没有 extensions.aiwu（可能是未识别的外部卡），只能清理原生字段。')
  }

  const data = next.data
  const book = data.character_book
  if (book !== undefined && Array.isArray(book.entries)) {
    const kept: CharacterBookEntry[] = []
    for (const entry of book.entries) {
      scanned.entries += 1
      const content = str(entry.content)
      if (!hit(content)) { kept.push(entry); continue }
      const cleaned = removeSentences(content, keywords)
      if (cleaned.trim() === '') {
        removed.push(`character_book「${isEmptyText(entry.name) ? entryIdentity(entry) : str(entry.name)}」：整条删除`)
        continue
      }
      removed.push(`character_book「${isEmptyText(entry.name) ? entryIdentity(entry) : str(entry.name)}」：${clipForReport(content)}`)
      entry.content = cleaned
      kept.push(entry)
    }
    book.entries = kept
  }

  const imported = aiwu?.imported?.raw
  if (isRecord(imported)) {
    for (const [key, value] of Object.entries(imported)) {
      const text = str(value)
      if (text === '') continue
      scanned.rawFields += 1
      if (!hit(text)) continue
      const cleaned = removeSentences(text, keywords)
      removed.push(`imported.raw.${key}：${clipForReport(text)}`)
      if (cleaned.trim() === '') delete imported[key]
      else imported[key] = cleaned
    }
  }

  if (str(data.first_mes) !== '' && hit(str(data.first_mes))) {
    removed.push(`first_mes：${clipForReport(str(data.first_mes))}`)
    data.first_mes = removeSentences(str(data.first_mes), keywords)
  }
  if (Array.isArray(data.alternate_greetings)) {
    const kept: string[] = []
    data.alternate_greetings.forEach((item, index) => {
      const text = str(item)
      if (hit(text)) {
        removed.push(`alternate_greetings[${index}]：${clipForReport(text)}`)
        return
      }
      kept.push(text)
    })
    data.alternate_greetings = kept
  }

  if (scanned.fields === 0 && scanned.entries === 0 && scanned.rawFields === 0) {
    warnings.push('角色卡里没有可扫描的字段，可能格式未识别——本次只清理了日记与会话。')
  }

  projectNative(data)
  return { card: next, removed, scanned, warnings }
}

function clipForReport(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length <= 60 ? flat : `${flat.slice(0, 59)}…`
}

// ============================================================================ 关系起点档位

/**
 * 关系起点锚定：设定里本来就是恋人/夫妻/家人的卡，起点不该是「陌生」。
 * （口径与原 store.ts 完全一致，搬到这里是为了让 tavern.ts 不反向依赖 store.ts。）
 */
export function relationBaseline(relationshipText: string): RelationBand {
  const text = relationshipText ?? ''
  const has = (...words: string[]): boolean => words.some(w => text.includes(w))
  if (has('夫妻', '丈夫', '妻子', '老公', '老婆', '恋人', '男友', '女友', '伴侣', '爱人', '结婚', '婚约', '未婚妻', '未婚夫')) return '亲密'
  if (has('家人', '兄妹', '姐弟', '亲人', '同居', '室友', '青梅竹马', '未婚')) return '亲近'
  if (has('旧识', '故人', '同学', '同事', '朋友')) return '熟悉'
  if (has('陌生', '初见', '第一次见', '未谋面')) return '陌生'
  return '认识'
}

// ============================================================================ 长度统计与软警告

export interface CardLengthStats {
  descriptionChars: number
  l1StaticChars: number
  loreEntryMaxChars: number
  loreTotalChars: number
  loreEntryCount: number
  cardChars: number
}

export interface LengthWarning {
  code: 'description' | 'l1' | 'lore-entry' | 'lore-total' | 'lore-keys' | 'lore-selective' | 'card-size'
  chars: number
  message: string
}

export function cardLengthStats(card: CharacterCardV3): CardLengthStats {
  const book = card.data.character_book
  const entries = Array.isArray(book?.entries) ? book.entries : []
  const contents = entries.map(e => str(e.content))
  return {
    descriptionChars: str(card.data.description).length,
    l1StaticChars: renderL1Static(card).length,
    loreEntryMaxChars: contents.reduce((max, text) => Math.max(max, text.length), 0),
    loreTotalChars: contents.reduce((sum, text) => sum + text.length, 0),
    loreEntryCount: entries.length,
    cardChars: JSON.stringify(card).length,
  }
}

/** 长度软警告（§5.1）：只提示，不截断、不拒存。 */
export function lengthWarnings(card: CharacterCardV3): LengthWarning[] {
  const aiwu = awiuOf(card)
  if (aiwu?.prompt?.lengthWarnings === false) return []
  const stats = cardLengthStats(card)
  const warnings: LengthWarning[] = []
  if (stats.descriptionChars > LENGTH_LIMITS.description) {
    warnings.push({
      code: 'description',
      chars: stats.descriptionChars,
      message: `角色设定偏长（${stats.descriptionChars} 字），建议把细节拆到世界书：常驻内容每一轮都要重新付费。`,
    })
  }
  if (stats.l1StaticChars > LENGTH_LIMITS.l1Static) {
    warnings.push({
      code: 'l1',
      chars: stats.l1StaticChars,
      message: `这张卡的常驻人设约 ${stats.l1StaticChars} 字，每轮都会注入。`,
    })
  }
  if (stats.loreEntryMaxChars > LENGTH_LIMITS.loreEntry) {
    warnings.push({
      code: 'lore-entry',
      chars: stats.loreEntryMaxChars,
      message: `世界书有一条 ${stats.loreEntryMaxChars} 字，建议拆成多条、各自配关键词，命中更准。`,
    })
  }
  if (stats.loreTotalChars > LENGTH_LIMITS.loreTotal || stats.loreEntryCount > LENGTH_LIMITS.loreEntries) {
    warnings.push({
      code: 'lore-total',
      chars: stats.loreTotalChars,
      message: `世界书偏大（${stats.loreEntryCount} 条 / ${stats.loreTotalChars} 字），命中率会下降，建议合并同主题条目。`,
    })
  }
  const keyless = (card.data.character_book?.entries ?? []).filter(e => list(e.keys).length === 0 && e.constant !== true)
  if (keyless.length > 0) {
    warnings.push({
      code: 'lore-keys',
      chars: 0,
      message: `世界书有 ${keyless.length} 条没有关键词，永远不会被命中（除非标记为常驻）。`,
    })
  }
  const selective = (card.data.character_book?.entries ?? []).filter(e => e.selective === true && list(e.secondary_keys).length > 0)
  if (selective.length > 0) {
    // 真实踩坑点：selective 只是"再要求次级关键词命中"，配错 secondary_keys 会让条目**静默永不命中**
    warnings.push({
      code: 'lore-selective',
      chars: 0,
      message: `世界书有 ${selective.length} 条设了 selective + 次级关键词：只有主关键词和次级关键词同时命中才注入。如果它们老不出现，先检查 secondary_keys。`,
    })
  }
  if (stats.cardChars > LENGTH_LIMITS.cardFile) {
    warnings.push({
      code: 'card-size',
      chars: stats.cardChars,
      message: `卡片文件偏大（${Math.round(stats.cardChars / 1024)} KB），面板加载会变慢。`,
    })
  }
  return warnings
}
