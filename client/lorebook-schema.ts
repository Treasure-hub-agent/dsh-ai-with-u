/**
 * AI WITH U · 世界书（CCv3 `character_book`）草稿层
 *
 * 纯数据：读 → 草稿 → 合并回 CCv3。没有 React、没有副作用，可以单独对着 JSON 自检。
 *
 * 三条纪律：
 *  1. **未知键不丢**：book 级与 entry 级的未声明字段都原样存在 `unknown` 里，合并时先铺底再覆盖；
 *  2. **本地 id 不落盘**：`id` 只用于 React key 与条目对齐，写回时剔除；
 *  3. **不给遗漏的字段塞默认值**：写回时只写规范字段，读到的 `priority` 若是字符串也照实写回（不偷偷改类型）；
 *     但 `keys` 一定过滤空串（空 key 会让条目在检索里变成噪声）。
 */
import { ccv3Data, isObjectLike } from './card-source'

/** V3 规范里 `position` 的两个取值。 */
export type LorePosition = 'before_char' | 'after_char'

/** 一条世界书条目的草稿。 */
export interface LoreEntryDraft {
  /** 本地稳定 id（`lore-0` / `lore-1`…），不落盘 */
  id: string
  /** 条目标题（规范字段 `name`），显示在列表行 */
  title: string
  /** 主关键词（命中任一即触发） */
  keys: string[]
  /** 次级关键词（`selective` 为 true 时与主关键词同时命中才触发） */
  secondaryKeys: string[]
  content: string
  comment: string
  enabled: boolean
  /** 常驻：不看关键词，每轮都带 */
  constant: boolean
  insertionOrder: number
  priority: number
  position: LorePosition
  caseSensitive: boolean
  selective: boolean
  useRegex: boolean
  /** 该条目上不属于上述字段的内容（`extensions`、未来新增字段），原样带回 */
  unknown: Record<string, unknown>
}

/** 整个世界书的草稿（书级设置 + 条目）。 */
export interface LoreBookDraft {
  name: string
  description: string
  scanDepth: number
  tokenBudget: number
  recursiveScanning: boolean
  unknown: Record<string, unknown>
}

/**
 * 体检等级。
 *
 * 真卡（89 条 / 9.9 万字）在旧规则下报了 **323 条「问题」**，而真正会失效的只有 2 条。
 * 所以规则必须分级：
 *  - `error`：这条/这本书**真的不会生效**（没关键词也不是常驻、内容为空）；
 *  - `warn`：多半是配置失误，但玩法上还成立；
 *  - `info`：只是「知道一下」的规模提示（真卡常态，不该刷屏）。
 */
export type LoreIssueLevel = 'error' | 'warn' | 'info'

/**
 * 问题码。
 *
 * ⚠️ 2026-10-31 真卡适配后**删掉了两条规则**：
 *  - `order-collision`：ST 的 `insertion_order` 同值极常见（真卡里 22 条同为 20），
 *    同序按数组顺序排，本来就不冲突 —— 报它是纯噪声。
 *  - `selective-without-secondary`：`selective:true` + 空 secondary 在 ST 里等于该字段无效，
 *    功能完全正常（真卡 57 条命中），没有可执行动作，干脆不报。
 */
export type LoreIssueCode =
  | 'no-keys'
  | 'empty-content'
  | 'duplicate-keys'
  | 'content-too-long'
  | 'too-many-entries'
  | 'book-too-large'

export interface LoreIssue {
  /** 条目级问题给条目 id；书级/聚合类问题给空串 */
  entryId: string
  code: LoreIssueCode
  level: LoreIssueLevel
  /** 给 UI 直接显示的补充信息（关键词、字数、占比等），已格式化 */
  detail?: string
  /** 聚合类问题（如重复关键词）带上的条数 */
  count?: number
}

/**
 * 注入预算（与宿主 `selectLoreEntries` 的默认值一致：**12 条 / 6000 字**）。
 *
 * 体检用它来判断"这条占了多少预算"——真卡单条 800~2600 字是常态，
 * 拿 800 字当硬线只会制造噪声。
 */
export const LORE_BUDGET = {
  entries: 12,
  chars: 6000,
} as const

/** 体积参考线（只用于 info 提示，不阻断保存）。 */
export const LORE_LIMITS = {
  contentChars: 800,
  totalChars: 20_000,
  entries: 30,
} as const

export const BOOK_DEFAULTS = {
  name: '',
  description: '',
  scanDepth: 2,
  tokenBudget: 500,
  recursiveScanning: false,
} as const

/**
 * 新条目的默认值。
 * `selective` 默认 **false**：规范里它要求同时命中 `secondary_keys`，
 * 默认开会让每条新条目都"看着配了却永不命中"，这也是 architect 踩到的坑之一。
 */
export const ENTRY_DEFAULTS = {
  enabled: true,
  constant: false,
  insertionOrder: 100,
  priority: 10,
  position: 'after_char' as LorePosition,
  caseSensitive: false,
  selective: false,
  useRegex: false,
} as const

const ENTRY_MANAGED = [
  'name', 'keys', 'secondary_keys', 'content', 'comment', 'enabled', 'constant',
  'insertion_order', 'priority', 'position', 'case_sensitive', 'selective', 'use_regex',
] as const

const BOOK_MANAGED = ['name', 'description', 'scan_depth', 'token_budget', 'recursive_scanning', 'entries'] as const

// ---------------------------------------------------------------- 取值工具

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => (typeof item === 'string' ? item : String(item))).filter(s => s.trim() !== '')
  if (typeof value === 'string' && value.trim() !== '') return [value]
  return []
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === 'true') return true
  if (value === 0 || value === 'false') return false
  return fallback
}

function asPosition(value: unknown): LorePosition {
  if (value === 'before_char' || value === 'before_character') return 'before_char'
  if (value === 'after_char' || value === 'after_character') return 'after_char'
  // 部分实现用 0/1 表示 before/after
  if (value === 0 || value === '0') return 'before_char'
  return 'after_char'
}

/** 把对象里不属于 `managed` 的键原样收进 unknown。 */
function pickUnknown(source: Record<string, unknown>, managed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!managed.includes(key)) out[key] = value
  }
  return out
}

/** 按码点数字数（emoji 不算两个字）。 */
export function countChars(text: string): number {
  return [...text].length
}

// ---------------------------------------------------------------- 关键词

/** 把逗号/顿号/分号/换行切成关键词数组（去空、去首尾空白）。 */
export function normalizeKeys(raw: string): string[] {
  return raw
    .split(/[,，、;；\n\r\t]+/)
    .map(part => part.trim())
    .filter(part => part !== '')
}

/** 追加热键词（大小写不敏感去重，保留首次出现的大小写）。 */
export function appendKeys(existing: string[], raw: string): string[] {
  const seen = new Set(existing.map(key => key.toLowerCase()))
  const next = [...existing]
  for (const key of normalizeKeys(raw)) {
    const lower = key.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    next.push(key)
  }
  return next
}

/** 按值移除一个关键词（用于 chip 的 ×）。 */
export function removeKey(keys: string[], target: string): string[] {
  const lower = target.toLowerCase()
  return keys.filter(key => key.toLowerCase() !== lower)
}

// ---------------------------------------------------------------- 读

function toEntryDraft(raw: unknown, id: string): LoreEntryDraft {
  const source = isObjectLike(raw) ? raw : {}
  return {
    id,
    title: asText(source['name']),
    keys: asList(source['keys']),
    secondaryKeys: asList(source['secondary_keys']),
    content: asText(source['content']),
    comment: asText(source['comment']),
    enabled: asBoolean(source['enabled'], ENTRY_DEFAULTS.enabled),
    constant: asBoolean(source['constant'], ENTRY_DEFAULTS.constant),
    insertionOrder: asNumber(source['insertion_order'], ENTRY_DEFAULTS.insertionOrder),
    priority: asNumber(source['priority'], ENTRY_DEFAULTS.priority),
    position: asPosition(source['position']),
    caseSensitive: asBoolean(source['case_sensitive'], ENTRY_DEFAULTS.caseSensitive),
    selective: asBoolean(source['selective'], ENTRY_DEFAULTS.selective),
    useRegex: asBoolean(source['use_regex'], ENTRY_DEFAULTS.useRegex),
    unknown: pickUnknown(source, ENTRY_MANAGED),
  }
}

/**
 * 从完整 CCv3 对象（或直接给 `character_book`）读出草稿。
 * `seed` 只影响本地 id 前缀，方便多本书共存时 key 不撞。
 */
export function toLoreDraft(ccv3OrBook: unknown, seed = 'lore'): { book: LoreBookDraft; entries: LoreEntryDraft[] } {
  const bookRaw = isObjectLike(ccv3OrBook)
    ? (isObjectLike((ccv3OrBook as Record<string, unknown>)['character_book'])
      ? (ccv3OrBook as Record<string, unknown>)['character_book']
      : (isObjectLike(ccv3OrBook) && 'entries' in (ccv3OrBook as Record<string, unknown>) ? ccv3OrBook : {}))
    : {}
  const source = isObjectLike(bookRaw) ? bookRaw : {}
  const entryRaw = Array.isArray(source['entries']) ? source['entries'] : []

  const book: LoreBookDraft = {
    name: asText(source['name']),
    description: asText(source['description']),
    scanDepth: asNumber(source['scan_depth'], BOOK_DEFAULTS.scanDepth),
    tokenBudget: asNumber(source['token_budget'], BOOK_DEFAULTS.tokenBudget),
    recursiveScanning: asBoolean(source['recursive_scanning'], BOOK_DEFAULTS.recursiveScanning),
    unknown: pickUnknown(source, BOOK_MANAGED),
  }

  const entries = entryRaw.map((item, index) => toEntryDraft(item, `${seed}-${index}`))
  return { book, entries }
}

/** 直接从 CCv3 信封读世界书草稿（内部走 `ccv3Data`，避免调用方重复解包）。 */
export function toLoreDraftFromCard(ccv3: Record<string, unknown> | undefined, seed = 'lore'): { book: LoreBookDraft; entries: LoreEntryDraft[] } {
  const data = ccv3Data(ccv3)
  return toLoreDraft(data['character_book'], seed)
}

// ---------------------------------------------------------------- 写

function toEntryRaw(entry: LoreEntryDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entry.unknown }
  const keys = entry.keys.map(key => key.trim()).filter(key => key !== '')
  out['keys'] = keys

  const secondary = entry.secondaryKeys.map(key => key.trim()).filter(key => key !== '')
  if (secondary.length > 0) out['secondary_keys'] = secondary
  else delete out['secondary_keys']

  out['content'] = entry.content
  out['enabled'] = entry.enabled
  out['constant'] = entry.constant
  out['insertion_order'] = entry.insertionOrder
  out['priority'] = entry.priority
  out['position'] = entry.position
  out['case_sensitive'] = entry.caseSensitive
  out['selective'] = entry.selective
  out['use_regex'] = entry.useRegex

  const title = entry.title.trim()
  if (title !== '') out['name'] = title
  else delete out['name']

  const comment = entry.comment.trim()
  if (comment !== '') out['comment'] = comment
  else delete out['comment']

  return out
}

/**
 * 把草稿合并回 `character_book`。
 *
 * 以读到的对象为底（`unknown` 就是"底"），只覆盖我们管理的字段；
 * 条目顺序 = 草稿数组顺序（UI 的 ↑↓ 已经交换过 order 值）。
 */
export function mergeLore(original: unknown, book: LoreBookDraft, entries: LoreEntryDraft[]): Record<string, unknown> {
  const into = isObjectLike(original) ? { ...original } : {}
  const out: Record<string, unknown> = { ...book.unknown }

  out['name'] = book.name
  out['description'] = book.description
  out['scan_depth'] = Math.max(0, Math.round(book.scanDepth))
  out['token_budget'] = Math.max(0, Math.round(book.tokenBudget))
  out['recursive_scanning'] = book.recursiveScanning
  out['entries'] = entries.map(toEntryRaw)

  // 原对象上其余未知顶层键保留（`into` 只是为了拿到"底"，未知键已在 book.unknown 里）
  for (const [key, value] of Object.entries(into)) {
    if (!(key in out)) out[key] = value
  }
  return out
}

/**
 * 把世界书写回完整 CCv3 对象（保持信封与 `data` 里其它键不动）。
 * 拿不到信封时返回 `undefined`，调用方退回只发结构（C7 的降级分支）。
 */
export function mergeLoreIntoCard(
  ccv3: Record<string, unknown> | undefined,
  book: LoreBookDraft,
  entries: LoreEntryDraft[],
): Record<string, unknown> | undefined {
  if (!isObjectLike(ccv3)) return undefined
  const data = ccv3['data']
  if (!isObjectLike(data)) return undefined
  const nextData: Record<string, unknown> = { ...data }
  nextData['character_book'] = mergeLore(data['character_book'], book, entries)
  return { ...ccv3, data: nextData }
}

// ---------------------------------------------------------------- 排序 / 增删

/** 按 `insertion_order` 升序（稳定排序；同值保持原顺序）。 */
export function sortEntries(entries: LoreEntryDraft[]): LoreEntryDraft[] {
  return [...entries].sort((a, b) => a.insertionOrder - b.insertionOrder)
}

/** 下一条的插入顺序：现有最大值 + 1（空列表从 0 开始）。 */
export function nextInsertionOrder(entries: LoreEntryDraft[]): number {
  if (entries.length === 0) return 0
  return entries.reduce((max, entry) => (entry.insertionOrder > max ? entry.insertionOrder : max), -1) + 1
}

/** 新建一条空白条目（id 由调用方给，保证 React key 稳定）。 */
export function createEntry(id: string, order: number): LoreEntryDraft {
  return {
    id,
    title: '',
    keys: [],
    secondaryKeys: [],
    content: '',
    comment: '',
    enabled: ENTRY_DEFAULTS.enabled,
    constant: ENTRY_DEFAULTS.constant,
    insertionOrder: order,
    priority: ENTRY_DEFAULTS.priority,
    position: ENTRY_DEFAULTS.position,
    caseSensitive: ENTRY_DEFAULTS.caseSensitive,
    selective: ENTRY_DEFAULTS.selective,
    useRegex: ENTRY_DEFAULTS.useRegex,
    unknown: {},
  }
}

/**
 * 上移 / 下移一位：交换数组位置 **并** 交换两条的 `insertion_order` 值，
 * 这样"数组顺序 = 落盘顺序"这个不变式不需要额外归一化。
 */
export function moveEntry(entries: LoreEntryDraft[], index: number, delta: -1 | 1): LoreEntryDraft[] {
  const target = index + delta
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) return entries
  const next = [...entries]
  const a = entries[index]
  const b = entries[target]
  if (a === undefined || b === undefined) return entries
  next[index] = { ...b, insertionOrder: a.insertionOrder }
  next[target] = { ...a, insertionOrder: b.insertionOrder }
  return next
}

// ---------------------------------------------------------------- 体检

/**
 * 结构问题检测（分级版）。
 *
 * 只报"用户很可能没意识到"的问题；**不阻断保存**（架构稿 §5.2：不拒绝保存）。
 * 真卡（89 条 / 9.9 万字 / 89 条 use_regex）实测：旧规则 323 条，其中只有 2 条真问题；
 * 现在 error 只留「真的不会生效」这两种，其余降为 info，且重复关键词**按关键词聚合成一条**。
 */
export function loreIssues(entries: LoreEntryDraft[]): LoreIssue[] {
  const issues: LoreIssue[] = []

  /** 关键词 → 拥有它的条目（聚合用；ST 允许多条共用关键词，这不是错） */
  const keyOwners = new Map<string, { key: string; ids: string[] }>()

  for (const entry of entries) {
    const keys = entry.keys.map(key => key.trim()).filter(key => key !== '')

    // error ①：非常驻且没关键词 —— 永远命不中（architect 实测撞过，必须报）
    if (!entry.constant && keys.length === 0) {
      issues.push({ entryId: entry.id, code: 'no-keys', level: 'error' })
    }

    // error ②：内容为空 —— 注入了也等于没注入
    if (entry.content.trim() === '') {
      issues.push({ entryId: entry.id, code: 'empty-content', level: 'error' })
    }

    // info：单条偏大。真卡 800~2600 字是常态，所以只报"占本轮预算多少"，不是硬伤
    const chars = countChars(entry.content)
    if (chars > LORE_LIMITS.contentChars) {
      const percent = Math.round((chars / LORE_BUDGET.chars) * 100)
      issues.push({
        entryId: entry.id,
        code: 'content-too-long',
        level: 'info',
        detail: `${chars} 字 · ${percent}%`,
      })
    }

    for (const key of keys) {
      const lower = key.toLowerCase()
      const bucket = keyOwners.get(lower)
      if (bucket === undefined) keyOwners.set(lower, { key, ids: [entry.id] })
      else bucket.ids.push(entry.id)
    }
  }

  // info：多个条目共享关键词 —— ST 里本来就会一起注入，是按关键词**聚合报一条**
  //（真卡里 110 条命中其实只来自少数几个词，逐条报就是刷屏）
  for (const { key, ids } of keyOwners.values()) {
    if (ids.length > 1) {
      issues.push({ entryId: '', code: 'duplicate-keys', level: 'info', detail: key, count: ids.length })
    }
  }

  const totalChars = entries.reduce((sum, entry) => sum + countChars(entry.content), 0)
  // warn：这两条不是"知道就好"，而是**内容真的会进不去提示词**（超条数/超总量会被预算裁掉）。
  // 判据与「任何因预算而消失的内容都必须能被看见」一致：会丢内容的给 warn，只是体量偏大的给 info。
  if (entries.length > LORE_LIMITS.entries) {
    issues.push({ entryId: '', code: 'too-many-entries', level: 'warn', detail: String(entries.length) })
  }
  if (totalChars > LORE_LIMITS.totalChars) {
    issues.push({ entryId: '', code: 'book-too-large', level: 'warn', detail: String(totalChars) })
  }

  return issues
}

/** 等级排序：给条目行挑"最严重的那级"用。 */
const LEVEL_RANK: Record<LoreIssueLevel, number> = { info: 1, warn: 2, error: 3 }

/** 一组问题里最严重的等级（没有问题时返回 undefined）。 */
export function worstLevel(issues: LoreIssue[]): LoreIssueLevel | undefined {
  let worst: LoreIssueLevel | undefined
  for (const issue of issues) {
    if (worst === undefined || LEVEL_RANK[issue.level] > LEVEL_RANK[worst]) worst = issue.level
  }
  return worst
}

/** 世界书汇总（给 UI 显示一行总览 + 分组计数）。 */
export interface LoreTotals {
  count: number
  chars: number
  /** 常驻条目数（不看关键词，每轮都带） */
  constantCount: number
  errors: number
  warns: number
  infos: number
}

export function loreTotals(entries: LoreEntryDraft[]): LoreTotals {
  const issues = loreIssues(entries)
  return {
    count: entries.length,
    chars: entries.reduce((sum, entry) => sum + countChars(entry.content), 0),
    constantCount: entries.filter(entry => entry.constant).length,
    errors: issues.filter(issue => issue.level === 'error').length,
    warns: issues.filter(issue => issue.level === 'warn').length,
    infos: issues.filter(issue => issue.level === 'info').length,
  }
}

/** 条目在列表行里显示的名字：标题 → 备注 → 首个关键词 → 空。 */
export function entryLabel(entry: LoreEntryDraft): string {
  const title = entry.title.trim()
  if (title !== '') return title
  const comment = entry.comment.trim()
  if (comment !== '') return comment
  const key = entry.keys.find(item => item.trim() !== '')
  return key === undefined ? '' : key
}
