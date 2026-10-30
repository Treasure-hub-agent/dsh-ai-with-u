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

/** 问题码。前两条是「静默永不命中」——architect 实测撞过，必须在面板上提示。 */
export type LoreIssueCode =
  | 'no-keys'
  | 'selective-without-secondary'
  | 'empty-content'
  | 'duplicate-keys'
  | 'order-collision'
  | 'content-too-long'
  | 'too-many-entries'
  | 'book-too-large'

export interface LoreIssue {
  entryId: string
  code: LoreIssueCode
  /** 给 UI 直接显示的补充信息（关键词、字数等），已格式化 */
  detail?: string
}

/** 与架构稿 §5.1 对齐的阈值（客户端只做提示，不阻断保存）。 */
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
 * 结构问题检测。
 *
 * 只报"用户很可能没意识到"的问题；**不阻断保存**（架构稿 §5.2：不拒绝保存）。
 * 前两条是「静默永不命中」，必须在面板上显式提示。
 */
export function loreIssues(entries: LoreEntryDraft[]): LoreIssue[] {
  const issues: LoreIssue[] = []

  const keyOwners = new Map<string, string[]>()
  const orderOwners = new Map<number, string[]>()

  for (const entry of entries) {
    const keys = entry.keys.map(key => key.trim()).filter(key => key !== '')
    const secondary = entry.secondaryKeys.map(key => key.trim()).filter(key => key !== '')

    // ① 没关键词：常驻条目不需要关键词，其余就是"永远命不中"
    if (!entry.constant && keys.length === 0) {
      issues.push({ entryId: entry.id, code: 'no-keys' })
    }

    // ② selective 要求次级关键词同时命中；没有次级就是永不命中
    if (entry.selective && !entry.constant && secondary.length === 0) {
      issues.push({ entryId: entry.id, code: 'selective-without-secondary' })
    }

    if (entry.content.trim() === '') {
      issues.push({ entryId: entry.id, code: 'empty-content' })
    }

    const chars = countChars(entry.content)
    if (chars > LORE_LIMITS.contentChars) {
      issues.push({ entryId: entry.id, code: 'content-too-long', detail: String(chars) })
    }

    for (const key of keys) {
      const lower = key.toLowerCase()
      const owners = keyOwners.get(lower)
      if (owners === undefined) keyOwners.set(lower, [entry.id])
      else owners.push(entry.id)
    }

    const orderOwnersList = orderOwners.get(entry.insertionOrder)
    if (orderOwnersList === undefined) orderOwners.set(entry.insertionOrder, [entry.id])
    else orderOwnersList.push(entry.id)
  }

  for (const [key, owners] of keyOwners) {
    if (owners.length > 1) {
      for (const entryId of owners) issues.push({ entryId, code: 'duplicate-keys', detail: key })
    }
  }

  for (const [order, owners] of orderOwners) {
    if (owners.length > 1) {
      for (const entryId of owners) issues.push({ entryId, code: 'order-collision', detail: String(order) })
    }
  }

  const totalChars = entries.reduce((sum, entry) => sum + countChars(entry.content), 0)
  if (entries.length > LORE_LIMITS.entries) {
    issues.push({ entryId: '', code: 'too-many-entries', detail: String(entries.length) })
  }
  if (totalChars > LORE_LIMITS.totalChars) {
    issues.push({ entryId: '', code: 'book-too-large', detail: String(totalChars) })
  }

  return issues
}

/** 世界书汇总（给 UI 显示 "5 条 · 1,234 字"）。 */
export function loreTotals(entries: LoreEntryDraft[]): { count: number; chars: number; issues: number } {
  const issues = loreIssues(entries)
  return {
    count: entries.length,
    chars: entries.reduce((sum, entry) => sum + countChars(entry.content), 0),
    issues: issues.filter(issue => issue.code === 'no-keys' || issue.code === 'selective-without-secondary').length,
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
