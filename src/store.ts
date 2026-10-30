/**
 * AI WITH U · 存储层
 *
 * 兼容原 ai-with-u skill 的磁盘格式，直接复用用户已有的角色卡与日记：
 *   {root}/_index.json                 角色索引（path 只存相对路径）
 *   {root}/characters/<角色名>/card.json   七字段角色卡
 *   {root}/characters/<角色名>/diary.md    日记（按天分组：时间线 + 心情札记）
 *   {root}/characters/<角色名>/session.json 会话状态
 *   {root}/_active.json                当前启用（插拔）状态
 *
 * 所有写操作走原子写（临时文件 + rename），避免 DSH 崩溃时留下半个 JSON。
 *
 * 会话状态的写入口只有 {@link Store.commitTurn}：每轮对话结束后由宿主事件钩子
 * 调用一次，负责 turn_count / last_ts / recent / topic / mood / mode 的滚动更新。
 * 这是「时间差感知」的地基（prompt.ts 读 session.last_ts）。
 * @module dsh-ai-with-u/store
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const INDEX_FILE = '_index.json'
export const ACTIVE_FILE = '_active.json'
export const CHARACTERS_DIR = 'characters'

/** 角色卡七字段（对齐原项目 schema/character_card.schema.json）。 */
export const REQUIRED_FIELDS = ['name', 'basic', 'personality', 'relationship', 'source']
export const FULL_FIELDS = [
  'name', 'basic', 'personality', 'voice', 'relationship',
  'memory_anchor', 'dynamic_state', 'interaction_pref', 'source',
]

/** session.json 的 recent 滚动窗口上限（原 skill session_continuity §二：最近 3-5 轮）。 */
export const RECENT_WINDOW = 5
/** 单条 recent 摘要长度上限，防一条长消息吃掉整个窗口的 token 预算。 */
export const RECENT_ITEM_MAX_CHARS = 120

type Json = Record<string, unknown>

/** 当前启用状态。enabled=false 表示「已干净拔出」。 */
export interface ActiveState {
  enabled: boolean
  character?: string
  /** 启用时的 ISO 时间戳（含时区偏移），用于时间差感知。 */
  activatedAt?: string
  /** 会话交互模式：text | text+action */
  mode?: 'text' | 'text+action'
}

/** 折叠路径中可能残留的 / 与 \，统一成当前平台分隔符。 */
function normalizeName(name: string): string {
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') throw new Error('角色名不能为空')
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
    throw new Error(`角色名不能包含路径分隔符：${trimmed}`)
  }
  return trimmed
}

/** 原子写：先写 .tmp 再 rename，避免读到半个文件。 */
async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, content, 'utf8')
  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // 文件不存在是正常状态（首次使用），不需要报错
    return undefined
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    // 文件存在但 JSON 损坏：绝不能静默当成「不存在」，否则用户会看到卡/日记凭空消失
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[ai-with-u] 文件损坏，已按不存在处理：${file}（${reason}）\n`)
    return undefined
  }
}

/**
 * 本地时区的 ISO 8601 时间戳，**带 UTC 偏移**（如 `2026-08-08T22:30:00+08:00`）。
 * 原 skill session_continuity §三 要求 last_ts 保留偏移——`toISOString()` 给的是
 * UTC（`...Z`），跨时区读回会算错时间差，所以这里手写偏移。
 */
export function localIsoTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** 本地日期分组标题：`YYYY MM DD`（原 skill diary_memory §一 的日期格式）。 */
export function localDiaryDate(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()} ${pad(date.getMonth() + 1)} ${pad(date.getDate())}`
}

export interface IndexEntry {
  path: string
  last_active?: string
  source?: string
}

export interface DiaryEntry {
  date: string
  timeline: string[]
  notes: string[]
}

export interface SessionState {
  recent?: string[]
  mood?: string
  topic?: string
  mode?: string
  last_ts?: string
  turn_count?: number
}

/** 一轮对话的写入素材，由宿主侧事件钩子采集后交给 {@link Store.commitTurn}。 */
export interface TurnInput {
  /** 本轮用户说的话（已截断）。 */
  user?: string
  /** 本轮角色回复（已截断）。 */
  assistant?: string
  /** 显式指定会话所属角色；省略时回落 _active.json 的当前角色。 */
  character?: string
  /** 显式指定对话轮 id，用于同轮去重；省略则每调用一次都算一轮。 */
  turnId?: string
  /** 是否计入 turn_count（展示/查询类指令不计）。默认 true。 */
  count?: boolean
  /** 当前交互模式，写回 session.mode。 */
  mode?: 'text' | 'text+action'
  /** 显式指定摘要（优先于 user/assistant 拼装）。 */
  summary?: string
  /** 显式指定未竟话题；省略则保留原值（不做模型侧猜测）。 */
  topic?: string
  /** 显式指定情绪。 */
  mood?: string
  /** 现在时刻，测试可注入。 */
  now?: Date
}

/** 一轮写入的结果。written=false 时 reason 说明为什么没写。 */
export interface TurnCommitResult {
  written: boolean
  reason?: string
  character?: string
  session?: SessionState
}

export class Store {
  readonly root: string
  /** 同轮去重：记录最近一次写入的 turnId，避免 pre-step 与 turn-stopping 双写。 */
  private lastTurnId: string | undefined

  constructor(root?: string) {
    this.root = resolve(expandHome(
      root ?? process.env['AIWU_STORAGE_ROOT'] ?? join(homedir(), '.dsh', 'ai-with-u'),
    ))
  }

  private dir(name: string): string {
    return join(this.root, CHARACTERS_DIR, normalizeName(name))
  }

  cardPath(name: string): string { return join(this.dir(name), 'card.json') }
  diaryPath(name: string): string { return join(this.dir(name), 'diary.md') }
  sessionPath(name: string): string { return join(this.dir(name), 'session.json') }

  // ---------------------------------------------------------------- 索引

  async readIndex(): Promise<Record<string, IndexEntry>> {
    return (await readJson<Record<string, IndexEntry>>(join(this.root, INDEX_FILE))) ?? {}
  }

  /**
   * 索引自检：索引缺失 / 损坏 / 条目失效时扫描 characters/ 目录重建。
   * 刻意不静默丢卡（对齐原项目 character_card.md §3.1）。
   */
  async ensureIndex(): Promise<{ index: Record<string, IndexEntry>; rebuilt: boolean; broken: string[] }> {
    const broken: string[] = []
    let index = await this.readIndex()
    const dirRoot = join(this.root, CHARACTERS_DIR)
    let names: string[] = []
    try {
      names = (await readdir(dirRoot, { withFileTypes: true }))
        .filter(e => e.isDirectory())
        .map(e => e.name)
    } catch (error) {
      // characters/ 还没建是正常状态；真出错（权限等）要留痕
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        const reason = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[ai-with-u] 扫描 characters/ 失败：${reason}\n`)
      }
      names = []
    }

    let needsRebuild = Object.keys(index).length === 0 && names.length > 0
    for (const [name, entry] of Object.entries(index)) {
      const target = resolve(this.root, entry?.path ?? '')
      if (!existsSync(target)) {
        // 路径失效：按角色名重定位
        if (existsSync(this.cardPath(name))) needsRebuild = true
        else needsRebuild = true
      }
    }

    if (needsRebuild) {
      const rebuilt: Record<string, IndexEntry> = {}
      for (const dirName of names) {
        const card = await readJson<Json>(join(dirRoot, dirName, 'card.json'))
        if (card === undefined || typeof card !== 'object') {
          broken.push(dirName)
          continue
        }
        const name = typeof card['name'] === 'string' && card['name'].trim() !== ''
          ? card['name'].trim()
          : dirName
        const session = await readJson<SessionState>(join(dirRoot, dirName, 'session.json'))
        rebuilt[name] = {
          path: `${CHARACTERS_DIR}/${dirName}/card.json`,
          last_active: session?.last_ts ?? '',
          source: typeof card['source'] === 'string' ? card['source'] : 'custom',
        }
      }
      index = rebuilt
      await atomicWrite(join(this.root, INDEX_FILE), `${JSON.stringify(rebuilt, null, 2)}\n`)
    }
    return { index, rebuilt: needsRebuild, broken }
  }

  private async touchIndex(name: string, source?: string, lastActive?: string): Promise<void> {
    const index = await this.readIndex()
    index[name] = {
      path: `${CHARACTERS_DIR}/${normalizeName(name)}/card.json`,
      last_active: lastActive ?? localIsoTimestamp(),
      source: source ?? index[name]?.source ?? 'custom',
    }
    await atomicWrite(join(this.root, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`)
  }

  // ---------------------------------------------------------------- 角色卡

  async listCharacters(): Promise<Array<{
    name: string; card: Json; source: string; lastActive: string; memoryCount: number
  }>> {
    const { index } = await this.ensureIndex()
    const out: Array<{ name: string; card: Json; source: string; lastActive: string; memoryCount: number }> = []
    for (const [name, entry] of Object.entries(index)) {
      const card = await readJson<Json>(this.cardPath(name))
      if (card === undefined) continue
      const diary = await this.readDiary(name)
      const session = await this.readSession(name)
      out.push({
        name,
        card,
        source: entry.source ?? (typeof card['source'] === 'string' ? card['source'] : 'custom'),
        lastActive: entry.last_active || session?.last_ts || '',
        memoryCount: diary.reduce((n, d) => n + d.timeline.length, 0),
      })
    }
    out.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''))
    return out
  }

  async readCard(name: string): Promise<Json | undefined> {
    return readJson<Json>(this.cardPath(name))
  }

  async writeCard(name: string, card: Json): Promise<void> {
    const safe = normalizeName(name)
    const payload: Json = { ...card, name: safe }
    await atomicWrite(this.cardPath(safe), `${JSON.stringify(payload, null, 2)}\n`)
    await this.touchIndex(safe, typeof payload['source'] === 'string' ? payload['source'] : undefined)
  }

  async deleteCharacter(name: string, withMemory = false): Promise<void> {
    const safe = normalizeName(name)
    if (withMemory) {
      await rm(this.dir(safe), { recursive: true, force: true })
    } else {
      await rm(this.cardPath(safe), { force: true })
    }
    const index = await this.readIndex()
    delete index[safe]
    await atomicWrite(join(this.root, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`)
  }

  // ---------------------------------------------------------------- 日记

  /**
   * 解析 diary.md：`## YYYY MM DD` 分天，`**时间线**` 与 `**心情札记**` 两段。
   * 格式判定宽松——原项目允许模型手写，容错比严格更重要。
   */
  async readDiary(name: string): Promise<DiaryEntry[]> {
    return this.parseDiaryText(await this.readDiaryText(name), name)
  }

  /** 读日记原文；不存在时返回空串。展示「原文」视图与定点改写都用它。 */
  async readDiaryText(name: string): Promise<string> {
    try {
      return await readFile(this.diaryPath(name), 'utf8')
    } catch (error) {
      // 日记文件还没写是正常状态；其余错误要留痕
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        const reason = error instanceof Error ? error.message : String(error)
        process.stderr.write(`[ai-with-u] 读取日记失败：${this.diaryPath(name)}（${reason}）\n`)
      }
      return ''
    }
  }

  parseDiaryText(text: string, name: string): DiaryEntry[] {
    const entries: DiaryEntry[] = []
    let current: DiaryEntry | undefined
    let section: 'timeline' | 'notes' | undefined
    for (const raw of text.split(/\r?\n/u)) {
      const line = raw.trimEnd()
      const dateMatch = /^##\s+(\d{4})\s+(\d{2})\s+(\d{2})\s*$/u.exec(line)
      if (dateMatch !== null) {
        current = { date: `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`, timeline: [], notes: [] }
        entries.push(current)
        section = undefined
        continue
      }
      if (current === undefined) continue
      if (/^\*\*时间线\*\*/u.test(line)) { section = 'timeline'; continue }
      if (/^\*\*心情札记\*\*/u.test(line)) { section = 'notes'; continue }
      const body = line.replace(/^-\s+/u, '').trim()
      if (body === '') continue
      if (section === 'timeline') current.timeline.push(body)
      else if (section === 'notes' && body.startsWith('>')) current.notes.push(body.replace(/^>\s*/u, '').trim())
    }
    return entries
  }

  /** 追加式写入：同日追加到当天段落，绝不覆盖已有内容（对齐原项目 diary_memory §四）。 */
  async appendDiary(name: string, date: string, timeline: string[], notes: string[]): Promise<void> {
    const safe = normalizeName(name)
    const entries = await this.readDiary(safe)
    const existing = entries.find(e => e.date === date)
    if (existing !== undefined) {
      existing.timeline.push(...timeline)
      existing.notes.push(...notes)
    } else {
      entries.push({ date, timeline: [...timeline], notes: [...notes] })
    }
    await this.writeDiary(safe, entries)
  }

  async writeDiary(name: string, entries: DiaryEntry[]): Promise<void> {
    const safe = normalizeName(name)
    const blocks = [`# ${safe}的日记`]
    for (const entry of entries) {
      blocks.push(`\n## ${entry.date}`)
      if (entry.timeline.length > 0) {
        blocks.push('**时间线**')
        for (const item of entry.timeline) blocks.push(`  ${item}`)
      }
      if (entry.notes.length > 0) {
        blocks.push('\n**心情札记**')
        for (const item of entry.notes) blocks.push(`> ${item}`)
      }
    }
    await atomicWrite(this.diaryPath(safe), `${blocks.join('\n')}\n`)
  }

  // ---------------------------------------------------------------- 会话

  async readSession(name: string): Promise<SessionState | undefined> {
    return readJson<SessionState>(this.sessionPath(name))
  }

  async writeSession(name: string, session: SessionState): Promise<void> {
    const safe = normalizeName(name)
    await atomicWrite(this.sessionPath(safe), `${JSON.stringify(session, null, 2)}\n`)
    await this.touchIndex(safe, undefined, session.last_ts)
  }

  /**
   * 把一轮对话合并进 session.json（**核心写入口**，修复「session.json 只读不写」）。
   *
   * 语义（逐条对齐原 skill `extended/session_continuity.md`）：
   *   - `turn_count`：仅对话轮 +1（展示类指令传 count=false 不计数），跨会话累计；
   *   - `last_ts`：本地时区 ISO 8601，**带 UTC 偏移**；
   *   - `recent`：滚动窗口，新摘要追加到末尾，超出 {@link RECENT_WINDOW} 的从头部丢弃；
   *   - `topic` / `mood`：显式给出才覆盖，否则保留旧值（不做猜测式改写）；
   *   - `mode`：交互模式随写盘同步。
   *
   * 同一 turnId 重复调用只写一次（幂等），避免 pre-step 与 turn-stopping 双写。
   * 角色未启用时**不制造**会话文件，返回 written=false。
   */
  async commitTurn(input: TurnInput = {}): Promise<TurnCommitResult> {
    const name = input.character ?? await this.activeCharacter()
    if (name === undefined) return { written: false, reason: '当前没有启用角色' }
    if (input.turnId !== undefined && this.lastTurnId === input.turnId) {
      return { written: false, reason: '本轮已写入', character: name, session: await this.readSession(name) }
    }

    const previous = (await this.readSession(name)) ?? {}
    const summary = normalizeSummary(input)
    const recent = [...(previous.recent ?? [])]
    if (summary !== undefined) {
      // 相邻重复摘要不重复堆叠
      if (recent[recent.length - 1] !== summary) recent.push(summary)
      while (recent.length > RECENT_WINDOW) recent.shift()
    }

    const next: SessionState = {
      ...previous,
      recent,
      turn_count: Math.max(0, Number(previous.turn_count ?? 0) || 0) + (input.count === false ? 0 : 1),
      last_ts: localIsoTimestamp(input.now ?? new Date()),
    }
    if (input.topic !== undefined) next.topic = input.topic
    if (input.mood !== undefined) next.mood = input.mood
    if (input.mode !== undefined) next.mode = input.mode
    else if (previous.mode === undefined) next.mode = 'text+action'

    await this.writeSession(name, next)
    if (input.turnId !== undefined) this.lastTurnId = input.turnId
    return { written: true, character: name, session: next }
  }

  /** 当前启用角色（读 _active.json）。 */
  async activeCharacter(): Promise<string | undefined> {
    const active = await this.readActive()
    return active.enabled ? active.character : undefined
  }

  // ---------------------------------------------------------------- 指令：忘记

  /**
   * 「忘记{事情}」：三处同步定点清理（对齐原 skill diary_memory §二「忘记」）。
   *
   *   ① diary.md：命中的时间线条目整条删除；心情札记**按条**删除，只删命中的那几条；
   *      日期分组因此变空则保留空分组（不强制删组）。
   *   ② session.json：`recent` 中相关摘要删除，`topic` 命中则清空。
   *   ③ card.json：`memory_anchor` / `dynamic_state` 里含关键词的句子就地删去，
   *      `relationship` 等其余字段不动（改卡属于「改{角色名}的{字段}」的范畴）。
   *
   * `keyword` 支持 `|` 分隔的多关键词（任一命中即算）。
   */
  async forget(name: string, keyword: string): Promise<ForgetResult> {
    const safe = normalizeName(name)
    const keywords = splitKeywords(keyword)
    if (keywords.length === 0) throw new Error('请给出要忘记的内容')
    const hit = (text: string): boolean => keywords.some(k => text.includes(k))

    // ① 日记
    const entries = await this.readDiary(safe)
    const removedTimeline: string[] = []
    const removedNotes: string[] = []
    const kept: DiaryEntry[] = []
    for (const entry of entries) {
      const timeline = entry.timeline.filter((item) => {
        if (!hit(item)) return true
        removedTimeline.push(`${entry.date}｜${item}`)
        return false
      })
      const notes = entry.notes.filter((item) => {
        if (!hit(item)) return true
        removedNotes.push(`${entry.date}｜${item}`)
        return false
      })
      kept.push({ date: entry.date, timeline, notes })
    }
    const diaryChanged = removedTimeline.length + removedNotes.length > 0
    if (diaryChanged) await this.writeDiary(safe, kept)

    // ② 会话摘要
    const session = await this.readSession(safe)
    let sessionChanged = false
    let nextSession: SessionState | undefined
    if (session !== undefined) {
      nextSession = { ...session }
      if (Array.isArray(session.recent)) {
        const recent = session.recent.filter(item => !hit(item))
        if (recent.length !== session.recent.length) { nextSession.recent = recent; sessionChanged = true }
      }
      if (typeof session.topic === 'string' && hit(session.topic)) { nextSession.topic = ''; sessionChanged = true }
      if (sessionChanged) await this.writeSession(safe, nextSession)
    }

    // ③ 角色卡
    const card = await this.readCard(safe)
    const removedCard: string[] = []
    let nextCard: Json | undefined
    if (card !== undefined) {
      nextCard = { ...card }
      for (const field of ['memory_anchor', 'dynamic_state']) {
        const value = card[field]
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
        const cleaned: Json = {}
        for (const [key, raw] of Object.entries(value as Json)) {
          if (typeof raw !== 'string') { cleaned[key] = raw; continue }
          const next = removeSentences(raw, keywords)
          if (next !== raw) removedCard.push(`${field}.${key}：${raw}`)
          if (next.trim() !== '') cleaned[key] = next
          else removedCard.push(`${field}.${key}（整条清空）`)
        }
        nextCard[field] = cleaned
      }
      if (removedCard.length > 0) await this.writeCard(safe, nextCard)
    }

    return {
      character: safe,
      keyword: keywords.join('|'),
      diary: { removedTimeline, removedNotes, removedDiaryFile: removedTimeline.length + removedNotes.length },
      session: { removedRecent: (session?.recent ?? []).filter(item => hit(item)), topicCleared: sessionChanged && hit(session?.topic ?? '') },
      card: { removed: removedCard },
      changed: diaryChanged || sessionChanged || removedCard.length > 0,
    }
  }

  // ---------------------------------------------------------------- 指令：改日记

  /**
   * 「改日记{内容}」：就地改写 diary 中对应条目（对齐 diary_memory §二「改」）。
   *
   * 定位顺序：`date`（`YYYY MM DD`）→ `match` 关键词 → `index`（entries 下的第几条，
   * 从 0 起）。多条命中按**最新一条**改写（date 大的优先、同日取末尾），
   * 与 returned `候选` 一并返回给调用方以便逐条确认。
   */
  async editDiary(name: string, patch: DiaryEditInput): Promise<DiaryEditResult> {
    const safe = normalizeName(name)
    const entries = await this.readDiary(safe)
    const candidates: Array<{ date: string; section: 'timeline' | 'notes'; index: number; text: string }> = []
    for (const entry of entries) {
      entry.timeline.forEach((text, index) => candidates.push({ date: entry.date, section: 'timeline', index, text }))
      entry.notes.forEach((text, index) => candidates.push({ date: entry.date, section: 'notes', index, text }))
    }
    if (candidates.length === 0) throw new Error('日记还是空的，没有可改的条目')

    let pool = candidates
    if (patch.date !== undefined && patch.date.trim() !== '') {
      const date = normalizeDiaryDate(patch.date)
      pool = pool.filter(c => c.date === date)
      if (pool.length === 0) throw new Error(`日记里没有 ${date} 的条目`)
    }
    const match = typeof patch.match === 'string' ? patch.match.trim() : ''
    if (match !== '') {
      const keywords = splitKeywords(match)
      pool = pool.filter(c => keywords.some(k => c.text.includes(k)))
      if (pool.length === 0) throw new Error(`没有匹配「${match}」的日记条目`)
    }
    if (patch.section === 'timeline' || patch.section === 'notes') {
      const narrowed = pool.filter(c => c.section === patch.section)
      if (narrowed.length > 0) pool = narrowed
    }

    const target = pickTarget(entries, pool, patch.index)
    const entry = entries.find(e => e.date === target.date)
    /* v8 ignore next -- pickTarget 只会返回来自 entries 的候选 */
    if (entry === undefined) throw new Error(`找不到日期分组：${target.date}`)

    const text = typeof patch.text === 'string' ? patch.text.trim() : ''
    if (text === '') throw new Error('请给出改写后的内容 text')

    const before = target.section === 'timeline' ? entry.timeline[target.index] : entry.notes[target.index]
    if (target.section === 'timeline') entry.timeline[target.index] = text
    else entry.notes[target.index] = text
    await this.writeDiary(safe, entries)

    // 同步：该事若也出现在 session.recent 摘要里，一并更新
    const session = await this.readSession(safe)
    let sessionUpdated = false
    if (session !== undefined && Array.isArray(session.recent) && before !== undefined) {
      const recent = session.recent.map(item => (item === before ? text : item))
      if (recent.some((item, i) => item !== session.recent?.[i])) {
        await this.writeSession(safe, { ...session, recent })
        sessionUpdated = true
      }
    }

    return {
      character: safe,
      entry: { date: target.date, section: target.section, index: target.index },
      before: before ?? '',
      after: text,
      candidates: pool.length,
      sessionUpdated,
    }
  }

  // ---------------------------------------------------------------- 指令：重置

  /**
   * 「全新开始」：会话状态归零，**日记保留**（session_continuity §六）。
   * `recent` / `mood` / `topic` / `turn_count` 归零，`last_ts` 重置为当前时间，
   * `mode` 交互模式保留。
   */
  async resetSession(name: string, now: Date = new Date()): Promise<ResetResult> {
    const safe = normalizeName(name)
    const previous = (await this.readSession(safe)) ?? {}
    const next: SessionState = {
      recent: [],
      turn_count: 0,
      last_ts: localIsoTimestamp(now),
      mode: previous.mode ?? await this.activeMode(),
    }
    await this.writeSession(safe, next)
    const diary = await this.readDiary(safe)
    return {
      character: safe,
      scope: 'session',
      session: next,
      diaryKept: diary.reduce((n, d) => n + d.timeline.length + d.notes.length, 0),
    }
  }

  /**
   * 「彻底重置」：会话状态 + diary.md 全部清空，一切归零（session_continuity §六）。
   * 角色卡不动（本人在不在「认识过」，卡还在；卡要删走「删除{角色名}」）。
   */
  async resetStory(name: string, now: Date = new Date()): Promise<ResetResult> {
    const safe = normalizeName(name)
    const previous = (await this.readSession(safe)) ?? {}
    const diary = await this.readDiary(safe)
    const removedDiary = diary.reduce((n, d) => n + d.timeline.length + d.notes.length, 0)
    await rm(this.diaryPath(safe), { force: true })
    const next: SessionState = {
      recent: [],
      turn_count: 0,
      last_ts: localIsoTimestamp(now),
      mode: previous.mode ?? await this.activeMode(),
    }
    await this.writeSession(safe, next)
    return {
      character: safe,
      scope: 'all',
      session: next,
      diaryRemoved: removedDiary,
    }
  }

  private async activeMode(): Promise<string | undefined> {
    return (await this.readActive()).mode
  }

  // ---------------------------------------------------------------- 指令：关系

  /**
   * 「关系」：非数值档位（陌生 / 认识 / 熟悉 / 亲近 / 亲密），**现算不落盘**
   * （session_continuity §一）。
   *
   * 落盘里没有档位字段，所以这里给出「当前累计轮次 / 最近互动 / 关系起点」
   * 三个客观依据，档位本身由模型结合日记与近况现算；宿主侧只提供
   * {@link relationBaseline} 作为**起点锚定**（设定本来就是夫妻/恋人的卡，
   * 起点就该落在亲近档，而不是「陌生」）。
   */
  async relationState(name: string): Promise<RelationState> {
    const safe = normalizeName(name)
    const card = await this.readCard(safe)
    const session = await this.readSession(safe)
    const diary = await this.readDiary(safe)
    const startText = typeof card?.['relationship'] === 'object' && card['relationship'] !== null
      ? Object.values(card['relationship'] as Json).map(v => (Array.isArray(v) ? v.join('；') : String(v ?? ''))).join('；')
      : ''
    return {
      character: safe,
      bands: RELATION_BANDS,
      baseline: relationBaseline(startText),
      startText,
      turnCount: Number(session?.turn_count ?? 0) || 0,
      lastActive: session?.last_ts ?? '',
      diaryEntries: diary.reduce((n, d) => n + d.timeline.length + d.notes.length, 0),
      note: '档位由模型现算、不落盘；此处只给客观依据与起点锚定',
    }
  }

  // ---------------------------------------------------------------- 指令：换一句开场

  /**
   * 「换一句开场」：从 `card.json` 的 `openings` 里轮换下一句
   * （character_card §2.5「轮换语义与持久化」）。
   *
   *   - 无历史档案（session.recent / topic 皆空，或 diary 也一样空）：
   *     取下一句，并把该句**移到 openings 末尾**——游标靠顺序自然持久化；
   *   - 有历史档案：**不动 openings、不重发开场**，返回 `history: true`，
   *     由模型按同一句意换声线切面顺口说一句；
   *   - `openings` 缺失：返回 `needGenerate: true`，由模型按声线即时生成候选并写回。
   *
   * `save: true` 时把模型生成的候选追加进 openings（不覆盖已有句）。
   */
  async rotateOpening(name: string, options: { save?: boolean; candidates?: string[] } = {}): Promise<OpeningResult> {
    const safe = normalizeName(name)
    const card = await this.readCard(safe)
    if (card === undefined) throw new Error(`找不到角色卡：${safe}`)
    const session = await this.readSession(safe)
    const diary = await this.readDiary(safe)
    const hasHistory = (session?.recent?.length ?? 0) > 0
      || (typeof session?.topic === 'string' && session.topic.trim() !== '')
      || diary.some(d => d.timeline.length > 0 || d.notes.length > 0)

    const openings = Array.isArray(card['openings']) ? card['openings'].map(String).filter(s => s.trim() !== '') : []
    const saveCandidates = (options.candidates ?? []).map(String).filter(s => s.trim() !== '')

    // 生成模式：模型给了候选 → 追加进 openings 并采用第一句
    if (saveCandidates.length > 0) {
      const merged = [...openings, ...saveCandidates.filter(c => !openings.includes(c))]
      const chosen = merged.find(c => !openings.includes(c)) ?? merged[0] ?? ''
      const rest = merged.filter(s => s !== chosen)
      await this.writeCard(safe, { ...card, openings: [...rest, chosen] })
      return { character: safe, opening: chosen, openings: [...rest, chosen], history: hasHistory, generated: saveCandidates.length }
    }

    if (openings.length === 0) {
      const fallback = typeof card['opening'] === 'string' ? card['opening'] : ''
      return { character: safe, opening: fallback, openings: [], history: hasHistory, needGenerate: true }
    }
    if (hasHistory) {
      return { character: safe, opening: openings[0] ?? '', openings, history: true }
    }

    const [next, ...rest] = openings
    const rotated = [...rest, next ?? '']
    await this.writeCard(safe, { ...card, openings: rotated })
    return { character: safe, opening: next ?? '', openings: rotated, history: false }
  }

  /**
   * 按 §四 三态判定开局方式（无历史档案 / 全新开始之后 / 有历史档案），
   * 供面板与工具决定「首条消息用 opening 还是时间差接续」。
   */
  async openingState(name: string): Promise<{ state: 'none' | 'fresh-reset' | 'history'; opening: string; openings: string[] }> {
    const safe = normalizeName(name)
    const card = await this.readCard(safe)
    const session = await this.readSession(safe)
    const diary = await this.readDiary(safe)
    const hasDiary = diary.some(d => d.timeline.length > 0 || d.notes.length > 0)
    const hasSession = (session?.recent?.length ?? 0) > 0
      || (typeof session?.topic === 'string' && session.topic.trim() !== '')
    const openings = Array.isArray(card?.['openings']) ? card['openings'].map(String) : []
    const opening = typeof card?.['opening'] === 'string' ? card['opening'] : ''
    if (hasSession) return { state: 'history', opening, openings }
    if (hasDiary) return { state: 'fresh-reset', opening, openings }
    return { state: 'none', opening, openings }
  }

  // ---------------------------------------------------------------- 插拔状态

  async readActive(): Promise<ActiveState> {
    return (await readJson<ActiveState>(join(this.root, ACTIVE_FILE))) ?? { enabled: false }
  }

  async writeActive(state: ActiveState): Promise<void> {
    await atomicWrite(join(this.root, ACTIVE_FILE), `${JSON.stringify(state, null, 2)}\n`)
  }

  /** 首次使用时幂等种入预置卡：仅当 characters/ 目录不存在时执行一次。 */
  async seedPresets(presetRoot: string): Promise<number> {
    const dirRoot = join(this.root, CHARACTERS_DIR)
    if (existsSync(dirRoot)) return 0
    let seeded = 0
    try {
      await mkdir(dirRoot, { recursive: true })
      const entries = await readdir(presetRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const src = join(presetRoot, entry.name, 'card.json')
        try {
          const card = JSON.parse(await readFile(src, 'utf8')) as Json
          const name = typeof card['name'] === 'string' && card['name'].trim() !== ''
            ? card['name'].trim()
            : entry.name
          const dst = this.cardPath(name)
          if (existsSync(dst)) continue
          await mkdir(dirname(dst), { recursive: true })
          await writeFile(dst, `${JSON.stringify(card, null, 2)}\n`, 'utf8')
          await this.touchIndex(name, typeof card['source'] === 'string' ? card['source'] : 'custom')
          seeded += 1
        } catch (error) {
          // 单张卡损坏不阻断其余种子；但要留下原因，不静默吞掉
          process.stderr.write(`[ai-with-u] 预置卡 ${entry.name} 种入失败：${error instanceof Error ? error.message : String(error)}\n`)
        }
      }
    } catch (error) {
      process.stderr.write(`[ai-with-u] 预置卡种入失败：${error instanceof Error ? error.message : String(error)}\n`)
      return seeded
    }
    return seeded
  }
}

// -------------------------------------------------------------------- 指令辅助

/** 「关系」五档：非数值档位，由模型现算。 */
export const RELATION_BANDS = ['陌生', '认识', '熟悉', '亲近', '亲密'] as const
export type RelationBand = typeof RELATION_BANDS[number]

export interface RelationState {
  character: string
  bands: readonly string[]
  baseline: RelationBand
  startText: string
  turnCount: number
  lastActive: string
  diaryEntries: number
  note: string
}

/**
 * 关系起点锚定：设定里本来就是恋人/夫妻/家人/旧识的卡，起点不该是「陌生」
 * （session_continuity §一「起点档由卡内关系定位锚定」）。
 */
export function relationBaseline(relationshipText: string): RelationBand {
  const text = relationshipText ?? ''
  // 按「从最亲密往回退」的顺序判断：先定高亲密度的设定，再退到社交关系，
  // 否则像「家里安排你们结婚」这种既有「家」字又是夫妻的设定会被低档抢先命中。
  const has = (...words: string[]): boolean => words.some(w => text.includes(w))
  if (has('夫妻', '丈夫', '妻子', '老公', '老婆', '恋人', '男友', '女友', '伴侣', '爱人', '结婚', '婚约', '未婚妻', '未婚夫')) return '亲密'
  if (has('家人', '兄妹', '姐弟', '亲人', '同居', '室友', '青梅竹马', '未婚')) return '亲近'
  if (has('旧识', '故人', '同学', '同事', '朋友')) return '熟悉'
  if (has('陌生', '初见', '第一次见', '未谋面')) return '陌生'
  return '认识'
}

export interface ForgetResult {
  character: string
  keyword: string
  diary: { removedTimeline: string[]; removedNotes: string[]; removedDiaryFile: number }
  session: { removedRecent: string[]; topicCleared: boolean }
  card: { removed: string[] }
  changed: boolean
}

export interface DiaryEditInput {
  date?: string
  match?: string
  section?: 'timeline' | 'notes'
  index?: number
  text: string
}

export interface DiaryEditResult {
  character: string
  entry: { date: string; section: 'timeline' | 'notes'; index: number }
  before: string
  after: string
  candidates: number
  sessionUpdated: boolean
}

export interface ResetResult {
  character: string
  scope: 'session' | 'all'
  session: SessionState
  diaryKept?: number
  diaryRemoved?: number
}

export interface OpeningResult {
  character: string
  opening: string
  openings: string[]
  history: boolean
  needGenerate?: boolean
  generated?: number
}

/** 关键词切分：`|` / `｜` / 逗号 / 顿号都算分隔符；空项丢弃。 */
export function splitKeywords(input: string): string[] {
  return String(input ?? '')
    .split(/[|｜,，、]/u)
    .map(s => s.trim())
    .filter(s => s !== '')
}

/** 拼装轮次摘要：`TA: …／角色: …`，单项截断到 RECENT_ITEM_MAX_CHARS。 */
function normalizeSummary(input: TurnInput): string | undefined {
  const clip = (text: string): string => {
    const flat = text.replace(/\s+/gu, ' ').trim()
    return flat.length <= RECENT_ITEM_MAX_CHARS ? flat : `${flat.slice(0, RECENT_ITEM_MAX_CHARS - 1)}…`
  }
  if (typeof input.summary === 'string' && input.summary.trim() !== '') return clip(input.summary)
  const parts: string[] = []
  if (typeof input.user === 'string' && input.user.trim() !== '') parts.push(`TA：${clip(input.user)}`)
  if (typeof input.assistant === 'string' && input.assistant.trim() !== '') parts.push(`角色：${clip(input.assistant)}`)
  return parts.length > 0 ? parts.join('／') : undefined
}

/** 从一段文字里删掉命中关键词的句子，返回清理后的文字（句子分隔符保留）。 */
export function removeSentences(text: string, keywords: string[]): string {
  const parts = text.split(/(?<=[。！？!?；;\n])/u)
  const kept = parts.filter(part => !keywords.some(k => part.includes(k)))
  const out = kept.join('').replace(/\n{3,}/gu, '\n\n').trim()
  return out
}

/** `YYYY MM DD` / `YYYY-MM-DD` / `YYYY/MM/DD` 统一成日记分组标题格式。 */
function normalizeDiaryDate(input: string): string {
  const m = /^(\d{4})[\s\-/](\d{1,2})[\s\-/](\d{1,2})$/u.exec(input.trim())
  if (m === null) throw new Error(`日期格式应为 YYYY MM DD：${input}`)
  const pad = (n: string): string => n.padStart(2, '0')
  return `${m[1]} ${pad(m[2] ?? '')} ${pad(m[3] ?? '')}`
}

/**
 * 从候选里选一条改写目标：显式 index 优先；否则取**最新一条**
 * （日期大的优先，同日取末尾）——对齐 diary_memory §二「改」的多条命中规则。
 */
function pickTarget(
  entries: DiaryEntry[],
  pool: Array<{ date: string; section: 'timeline' | 'notes'; index: number; text: string }>,
  index: number | undefined,
): { date: string; section: 'timeline' | 'notes'; index: number; text: string } {
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0) {
    const picked = pool[index]
    if (picked !== undefined) return picked
    throw new Error(`index 越界：命中 ${pool.length} 条，index=${index}`)
  }
  const order = new Map(entries.map((e, i) => [e.date, i]))
  const sorted = [...pool].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) return byDate
    const byEntry = (order.get(a.date) ?? 0) - (order.get(b.date) ?? 0)
    if (byEntry !== 0) return byEntry
    return a.index - b.index
  })
  const last = sorted[sorted.length - 1]
  /* v8 ignore next -- pool 非空由调用方保证 */
  if (last === undefined) throw new Error('没有可改的条目')
  return last
}

/** 展开 ~ 前缀（Windows 上也走同一套规则）。 */
export function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}
