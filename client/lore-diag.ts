/**
 * AI WITH U · 世界书「被预算裁掉」诊断的读取层
 *
 * 宿主 `selectLoreEntries` 每轮只注入 **12 条 / 6000 字**（超了会按优先级裁），但面板以前
 * 看不到「裁掉了哪些」——用户只会觉得"我明明写了这条设定，AI 却不知道"。
 * 宿主正在把 `constantDropped` / `keywordDropped`（`{id,name,chars}`）塞进 diag，本文件负责：
 *
 *  1. **容错读取**：宿主挂在哪儿、字段叫什么、条目是对象还是字符串，都尽量认；
 *  2. **两路兜底**：`GET /character`（`detail.diag`）优先，拿不到就让调用方去问 `GET /preview`
 *     （`preview.lore`）；两路都没有 → 返回 `undefined`，面板整块不显示（**不报错**）。
 *
 * 设计原则：这里只做"读懂"，不做 UI 判断。返回 `undefined` 就等于"宿主没提供"，别编数据。
 */
import type { CharacterDetail, LoreDiagPayload, PreviewData } from './api'

/** 被预算裁掉的一条（`chars` 拿不到时不显示字数）。 */
export interface DroppedLoreEntry {
  /** 宿主给的 id（可能缺；只用于 React key） */
  id: string
  /** 条目名（宿主给的 name；缺了用 id 兜底） */
  name: string
  /** 字数（老宿主 / 老字段没有） */
  chars?: number
  /** 被裁原因：常驻超预算 / 关键词命中超预算 / 未知（老字段不分类） */
  origin: 'constant' | 'keyword' | 'unknown'
}

export interface LoreDroppedInfo {
  entries: DroppedLoreEntry[]
  /** 本轮注入条数上限（宿主给才显示） */
  maxEntries?: number
  /** 关键词命中那本的字符预算（宿主给才显示） */
  budgetChars?: number
  /** 常驻条目单独一本预算（宿主拆开后才给；老宿主没有） */
  constantBudgetChars?: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** 一条被裁条目：对象 `{id,name,chars}` / 字符串（老字段只给名字）都认。 */
function toDroppedEntry(value: unknown, origin: DroppedLoreEntry['origin'], index: number): DroppedLoreEntry | undefined {
  if (typeof value === 'string') {
    const name = value.trim()
    if (name === '') return undefined
    return { id: `dropped-${origin}-${index}`, name, origin }
  }
  const record = asRecord(value)
  if (record === undefined) return undefined
  const name = typeof record['name'] === 'string' && record['name'].trim() !== ''
    ? record['name'].trim()
    : (typeof record['id'] === 'string' || typeof record['id'] === 'number' ? String(record['id']) : '')
  if (name === '') return undefined
  return {
    id: typeof record['id'] === 'string' || typeof record['id'] === 'number'
      ? String(record['id'])
      : `dropped-${origin}-${index}`,
    name,
    chars: asNumber(record['chars']),
    origin,
  }
}

function readList(value: unknown, origin: DroppedLoreEntry['origin']): DroppedLoreEntry[] {
  if (!Array.isArray(value)) return []
  const out: DroppedLoreEntry[] = []
  value.forEach((item, index) => {
    const entry = toDroppedEntry(item, origin, index)
    if (entry !== undefined) out.push(entry)
  })
  return out
}

/** 从任意"diag 形状"的对象里凑出一份被裁明细；一条都没有就返回 undefined。 */
function readFromPayload(payload: unknown): LoreDroppedInfo | undefined {
  const record = asRecord(payload)
  if (record === undefined) return undefined

  const entries = [
    ...readList(record['constantDropped'], 'constant'),
    ...readList(record['keywordDropped'], 'keyword'),
    // 老字段：只有一个名字列表，不知道分类也不知道字数
    ...readList(record['droppedByBudget'], 'unknown'),
  ]
  if (entries.length === 0) return undefined

  return {
    entries,
    maxEntries: asNumber(record['maxEntries'] ?? record['max_entries']),
    budgetChars: asNumber(record['budgetChars'] ?? record['budget_chars']),
    constantBudgetChars: asNumber(record['constantBudgetChars'] ?? record['constant_budget_chars']),
  }
}

/** 把任意值里可能藏着 diag 的几个位置都试一遍（宿主挂哪儿都不至于白屏）。 */
function firstPayload(candidates: unknown[]): LoreDroppedInfo | undefined {
  for (const candidate of candidates) {
    const info = readFromPayload(candidate)
    if (info !== undefined) return info
  }
  return undefined
}

/** `GET /character` 的详情：优先 `detail.diag`，其次世界书扩展里的几个可疑位置。 */
export function readLoreDroppedFromDetail(detail: CharacterDetail | undefined): LoreDroppedInfo | undefined {
  if (detail === undefined) return undefined
  const ccv3 = detail.ccv3
  const data = asRecord(asRecord(ccv3)?.['data'])
  const extensions = asRecord(data?.['extensions'])
  const aiwu = asRecord(extensions?.['aiwu'])
  return firstPayload([
    detail.diag,
    aiwu?.['diag'],
    aiwu?.['loreDiag'],
    data?.['diag'],
  ])
}

/** `GET /preview` 的 `lore`：宿主新字段与老计数混在一起，只认被裁列表。 */
export function readLoreDroppedFromPreview(preview: PreviewData | undefined): LoreDroppedInfo | undefined {
  if (preview === undefined) return undefined
  return readFromPayload(preview.lore)
}

/** 只给「宿主到底提不提供」判断用（面板据此决定要不要去问 preview）。 */
export function hasDroppedLore(info: LoreDroppedInfo | undefined): info is LoreDroppedInfo {
  return info !== undefined && info.entries.length > 0
}

/** 收集宿主给的两个预算值（可能只在一个 payload 里有）。 */
export function loreBudgetOf(payload: LoreDiagPayload | undefined): { maxEntries?: number; budgetChars?: number } {
  return {
    maxEntries: asNumber(payload?.maxEntries),
    budgetChars: asNumber(payload?.budgetChars),
  }
}
