/**
 * AI WITH U · 存储层
 *
 * 磁盘格式（v0.2.0 起）：
 *   {root}/_index.json                       角色索引（path 只存相对路径）
 *   {root}/characters/<角色名>/card.json     **酒馆卡 CCv3**（旧 34 字段卡读时归一，首次写盘落成 CCv3）
 *   {root}/characters/<角色名>/card.v1.bak.json  旧卡原件（首次迁移前写一次，回滚用）
 *   {root}/characters/<角色名>/diary.md      日记（按天分组：时间线 + 心情札记）
 *   {root}/characters/<角色名>/session.json  会话状态
 *   {root}/_active.json                      当前启用（插拔）状态
 *
 * 三条铁律（v0.2.0 新增，见 docs/design/2026-10-30-tavern-card.md）：
 *   1. **读时归一**：盘上是旧格式也能读（`normalizeCard` 在内存里补成 CCv3），
 *      只有真正写盘时才落成 CCv3——所以旧卡不会在"某次升级后凭空消失"。
 *   2. **保存契约 C7**：`saveCard({name, card?, ccv3?})`——`card` 是旧 34 字段结构视图（编辑面），
 *      `ccv3` 是原始 CCv3；结构是权威、原生是投影；`extensions.aiwu` 与 `character_book` 一律原样保留。
 *   3. **写盘按角色串行**（`locked`）：`atomicWrite` 只防半个文件，防不了"读-改-写"丢更新；
 *      同一角色的写操作排队执行，跨角色并行。
 *
 * 所有写操作走原子写（临时文件 + rename），避免 DSH 崩溃时留下半个 JSON。
 * 会话状态的唯一写入口是 {@link Store.commitTurn}。
 * @module dsh-ai-with-u/store
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  type CharacterCardV3,
  type CardData,
  type LegacyCardView,
  normalizeCard,
  toLegacyView,
  fromLegacyView,
  cardName,
  cardSource,
  collectCardWarnings,
  forgetCardText,
  relationBaseline,
  removeSentences,
  stampCardTimes,
  assertCardLimits,
  RELATION_BANDS,
  type RelationBand,
} from './tavern.js'

export { relationBaseline, removeSentences, RELATION_BANDS }
export type { RelationBand }

export const INDEX_FILE = '_index.json'
export const ACTIVE_FILE = '_active.json'
/**
 * 会话绑定表（`{ [sessionId]: { character, boundAt } }`）。
 *
 * 「当前会话启用」写在这里，与全局启用（`_active.json`）互不影响；
 * 决议优先级：**会话绑定 > 全局启用 > 未启用**（见 `prompt.PromptController` 的解析方法）。
 */
export const SESSIONS_FILE = '_sessions.json'
/** 单个会话 id 的长度上限（它只是 JSON 的键，但要挡住异常长的垃圾输入）。 */
export const SESSION_ID_MAX_CHARS = 200
export const CHARACTERS_DIR = 'characters'
/** 旧格式卡的原件备份（首次迁移写一次，回滚用）。 */
export const BACKUP_FILE = 'card.v1.bak.json'
/** 损坏文件的改名前缀（不静默当成"不存在"）。 */
export const CORRUPT_PREFIX = 'card.json.corrupt-'

/** session.json 的 recent 滚动窗口上限（原 skill session_continuity §二：最近 3-5 轮）。 */
export const RECENT_WINDOW = 5
/** 单条 recent 摘要长度上限，防一条长消息吃掉整个窗口的 token 预算。 */
export const RECENT_ITEM_MAX_CHARS = 120
/** 关系档位变更日志上限：只留最近 50 条（超出丢最旧），防 session.json 无限膨胀。 */
export const RELATION_LOG_LIMIT = 50

/** 交互模式的真实取值（`session.json.mode` 与 `_active.json.mode` 共用）。 */
export type InteractionMode = 'text' | 'text+action'
export const INTERACTION_MODES: readonly InteractionMode[] = ['text', 'text+action']

/** 关系档位变更日志的一条。`from` 是变更前的档位（首次为起点档）。 */
export interface RelationLogItem {
  at: string
  from: string
  to: string
  why?: string
}

/** 一条会话绑定：这个会话用哪张卡（与全局启用无关）。 */
export interface SessionBinding {
  character: string
  /** 绑定时刻（本地时区 ISO，带偏移）。 */
  boundAt: string
}

export type SessionBindings = Record<string, SessionBinding>

/** 会话 id 规范化：只做「非空 + 长度」校验（它是 JSON 键，不落文件系统路径）。 */
export function normalizeSessionId(sessionId: string): string {
  const trimmed = String(sessionId ?? '').trim()
  if (trimmed === '') throw new Error('缺少 sessionId（会话绑定必须指名是哪个会话）')
  if ([...trimmed].length > SESSION_ID_MAX_CHARS) {
    throw new Error(`sessionId 太长（上限 ${SESSION_ID_MAX_CHARS} 字符）`)
  }
  return trimmed
}

/**
 * 交互模式的**统一解析顺序**：`session.json.mode` > `_active.json.mode` > `'text+action'`。
 *
 * 为什么 session 优先：会话文件是「这个角色在这个存档里怎么聊」的权威，
 * `_active.json` 只是全局兜底（旧版本只写过它，升级后不能丢掉用户的 text 选择）。
 * L1 渲染（prompt.ts）与 `/overview`（web.ts）都必须走这一个函数，否则两边会打架。
 */
export function resolveInteractionMode(
  session: Pick<SessionState, 'mode'> | undefined,
  active: Pick<ActiveState, 'mode'> | undefined,
): InteractionMode {
  const fromSession = session?.mode
  if (fromSession === 'text' || fromSession === 'text+action') return fromSession
  const fromActive = active?.mode
  if (fromActive === 'text' || fromActive === 'text+action') return fromActive
  return 'text+action'
}

/** 从 session.state 里读当前关系档位；脏值（手改/旧档）一律当作没写。 */
export function intimacyOf(session: Pick<SessionState, 'intimacy'> | undefined): RelationBand | undefined {
  const value = session?.intimacy
  return typeof value === 'string' && (RELATION_BANDS as readonly string[]).includes(value)
    ? value as RelationBand
    : undefined
}

/** 关系档位日志（只取结构合法的条目，最多 RELATION_LOG_LIMIT 条）。 */
export function relationLogOf(session: Pick<SessionState, 'relation_log'> | undefined): RelationLogItem[] {
  const raw = session?.relation_log
  if (!Array.isArray(raw)) return []
  return raw
    .filter(item => isRecord(item) && typeof item['at'] === 'string')
    .map(item => ({
      at: String(item['at']),
      from: String(item['from'] ?? ''),
      to: String(item['to'] ?? ''),
      ...(typeof item['why'] === 'string' && item['why'].trim() !== '' ? { why: item['why'].trim() } : {}),
    }))
    .slice(-RELATION_LOG_LIMIT)
}

/**
 * 跨进程锁参数。
 *
 * `locked()` 的 Map 只在**单个 Store 实例**内互斥；两个 DSH 实例（桌面 + web profile、
 * 或两个窗口）共用同一个数据根时仍会互相踩（实测 20 次并发只落 10 轮 + `EPERM rename`）。
 * 所以临界区里再拿一把文件锁：`<root>/.locks/<key>.lock`，独占创建，用完即删。
 */
const LOCK_DIR = '.locks'
/** 等锁上限：正常写盘是毫秒级，8 秒还没拿到基本是死锁/权限问题，宁可报错也别挂死。 */
const LOCK_WAIT_MS = 8000
/** 超过这个时间没释放的锁视为崩溃残留，直接清掉（避免一次崩溃永久锁死角色）。 */
const LOCK_STALE_MS = 15000

/** 锁文件名：可读前缀 + FNV 短哈希，避免中文/特殊字符在不同文件系统上出问题。 */
function lockKeyOf(key: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const prefix = key.replace(/[^\w.-]/gu, '_').slice(0, 24)
  return `${prefix}-${hash.toString(16)}`
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

type Json = Record<string, unknown>

/** 当前启用状态。enabled=false 表示「已干净拔出」。 */
export interface ActiveState {
  enabled: boolean
  character?: string
  /** 启用时的 ISO 时间戳（含时区偏移），用于时间差感知。 */
  activatedAt?: string
  /** 会话交互模式：text | text+action */
  mode?: InteractionMode
  /**
   * 纪律包档位：off（不注入）/ lite（默认）/ full（lite + 语态锚点 + 日记自检）。
   * 和 mode 一样是「用户偏好」，`deactivate` 时保留，下次启用沿用。
   */
  discipline?: 'off' | 'lite' | 'full'
}

/** Windows 保留设备名（大小写不敏感，带扩展名同样保留）。 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** 角色名长度上限：留足余量给 `characters/<名>/card.v1.bak.json` 这类长路径。 */
export const NAME_MAX_CHARS = 64

/**
 * 角色名校验与规范化（**唯一入口**：目录名、索引键、`awu_card_save` 都走它）。
 *
 * v0.2.0 收紧（原文只拦 `/ \ . ..`）：
 *   - Windows 非法字符 `: * ? " < > |` 与控制字符；
 *   - 结尾的空格/点（NTFS 会静默裁掉，导致"名字看着一样但目录不同"）；
 *   - Windows 保留设备名（`CON` / `NUL` / `COM1` …，建目录会失败或建到意外位置）；
 *   - 超长名字（`NAME_MAX_CHARS`）。
 *
 * 只做"能不能安全当目录名"的判断，不做任何语义猜测。
 */
export function normalizeCharacterName(name: string): string {
  // 先做 NFC 归一：macOS 导出的卡常是 NFD，`é` 两种写法会变成两个视觉相同、实际不同的目录
  const trimmed = String(name ?? '').normalize('NFC').trim()
  if (trimmed === '') throw new Error('角色名不能为空')
  if (trimmed === '.' || trimmed === '..') throw new Error(`角色名不能是 ${trimmed}`)
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`角色名不能包含路径分隔符：${trimmed}`)
  }
  if (/[:*?"<>|]/u.test(trimmed)) {
    throw new Error(`角色名不能包含 Windows 非法字符 : * ? " < > |：${trimmed}`)
  }
  // eslint-disable-next-line no-control-regex -- 故意的：控制字符必须拦
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`角色名不能包含控制字符：${JSON.stringify(trimmed)}`)
  }
  if (/[. ]$/u.test(trimmed)) {
    throw new Error(`角色名结尾不能是空格或点（Windows 会静默裁掉）：${trimmed}`)
  }
  const base = trimmed.split('.')[0]?.toUpperCase() ?? ''
  if (WINDOWS_RESERVED.has(base)) {
    throw new Error(`「${trimmed}」是 Windows 保留设备名，不能用作角色名`)
  }
  if ([...trimmed].length > NAME_MAX_CHARS) {
    throw new Error(`角色名太长（上限 ${NAME_MAX_CHARS} 个字符）：${trimmed.slice(0, 20)}…`)
  }
  return trimmed
}

/** 内部别名：所有路径拼装都走同一份校验。 */
function normalizeName(name: string): string {
  return normalizeCharacterName(name)
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 原子写：先写 .tmp 再 rename，避免读到半个文件。 */
/** 拒绝把存储根指向盘符根或系统目录。 */
function assertSafeRoot(root: string): void {
  const parsed = parse(root)
  if (parsed.root === root) throw new Error(`存储根不能是磁盘根目录：${root}`)
  const lower = root.toLowerCase()
  const systemRoot = parsed.root.toLowerCase()
  const forbidden = ['\\windows', '\\program files', '\\program files (x86)', '\\programdata']
  if (forbidden.some(dir => lower === `${systemRoot}${dir}` || lower.startsWith(`${systemRoot}${dir}\\`))) {
    throw new Error(`存储根不能指向系统目录：${root}`)
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    // 先刷盘再 rename：断电时宁可慢一点，也不要出现「文件名换了、内容还是半截」
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/**
 * 读 JSON。
 *
 * ⚠️ 这里是 `host.md` 的 P0-23：**损坏绝不能当成"不存在"**。
 * 文件不存在（首次使用）返回 undefined 且不留痕；JSON 语法错误则把文件改名成
 * `<file>.corrupt-<时间戳>` 备份、stderr 留痕、仍返回 undefined——
 * 让调用方（`ensureIndex`）能把这张卡继续留在索引里，用户不会看到"卡凭空消失"。
 */
async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    // 文件不存在是正常状态（首次使用），不需要报错；其余错误要留痕
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      process.stderr.write(`[ai-with-u] 读取失败：${file}（${error instanceof Error ? error.message : String(error)}）\n`)
    }
    return undefined
  }
  try {
    // 记事本 / 某些导出工具会写 UTF-8 BOM；JSON.parse 见到 BOM 直接抛，
    // 旧行为会把整张卡当「损坏」改名隔离（用户视角=卡凭空消失）。这里统一剥掉。
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const backup = `${file}.corrupt-${Date.now()}`
    try {
      await rename(file, backup)
      process.stderr.write(`[ai-with-u] 文件损坏，已备份并跳过：${file} → ${backup}（${reason}）\n`)
    } catch (renameError) {
      process.stderr.write(`[ai-with-u] 文件损坏且备份失败：${file}（${reason}；备份失败：${renameError instanceof Error ? renameError.message : String(renameError)}）\n`)
    }
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
  /** 当前关系档位（五档之一，由模型按里程碑写回；缺省时以卡内起点档为准）。 */
  intimacy?: RelationBand
  /** 档位变更日志（上限 {@link RELATION_LOG_LIMIT} 条，超出丢最旧）。 */
  relation_log?: RelationLogItem[]
}

/** 一轮对话的写入素材，由宿主侧事件钩子采集后交给 {@link Store.commitTurn}。 */
export interface TurnInput {
  user?: string
  assistant?: string
  character?: string
  turnId?: string
  count?: boolean
  mode?: InteractionMode
  summary?: string
  topic?: string
  mood?: string
  now?: Date
}

/** 一轮写入的结果。written=false 时 reason 说明为什么没写。 */
export interface TurnCommitResult {
  written: boolean
  reason?: string
  character?: string
  session?: SessionState
}

/** `saveCard` 的入参（C7 三键契约）。 */
export interface SaveCardInput {
  name: string
  /** 旧 34 字段结构视图（编辑面）。给了就重投影原生字段。 */
  card?: unknown
  /** 原始 CCv3。没给 card 时以它为底；给了 card 时它当底做结构覆盖。 */
  ccv3?: unknown
}

/**
 * `saveCard` 的返回：落盘的卡 + **软警告**（当前只有世界书超限这一类）。
 *
 * 警告是「保存成功但想让你知道」的信息，调用方可以直接丢掉（`writeCard` / 预置卡种入就不看它），
 * 面板/导入预览则应该透给用户 —— 文案与判定都在 `tavern.collectCardWarnings`（单一真源）。
 */
export interface SaveCardResult {
  name: string
  card: CharacterCardV3
  warnings: string[]
}

/** 列表项：`card` 是旧视图（面板读它），`ccv3` 是完整对象（世界书等原生字段从这走）。 */
export interface CharacterListItem {
  name: string
  card: LegacyCardView
  ccv3: CharacterCardV3
  source: string
  lastActive: string
  memoryCount: number
}

export class Store {
  readonly root: string
  /**
   * 同轮去重：按**角色**记录最近一次写入的 turnId，避免 pre-step 与 turn-stopping 双写。
   * 按角色分开是必须的——多个会话同时启用不同角色时，共用一个字段会让去重互相踩掉。
   */
  private readonly lastTurnId = new Map<string, string>()
  /** 按 key 串行化写操作（`#index` 全局一把，其余按角色名）。 */
  private readonly queues = new Map<string, Promise<void>>()

  constructor(root?: string) {
    const resolved = resolve(expandHome(
      root ?? process.env['AIWU_STORAGE_ROOT'] ?? join(homedir(), '.dsh', 'ai-with-u'),
    ))
    // 删除角色是递归的：存储根指错一次就是系统级事故（盘符根 / Windows 目录直接拒绝）
    assertSafeRoot(resolved)
    this.root = resolved
  }

  private dir(name: string): string {
    return join(this.root, CHARACTERS_DIR, normalizeName(name))
  }

  cardPath(name: string): string { return join(this.dir(name), 'card.json') }
  backupPath(name: string): string { return join(this.dir(name), BACKUP_FILE) }
  diaryPath(name: string): string { return join(this.dir(name), 'diary.md') }
  sessionPath(name: string): string { return join(this.dir(name), 'session.json') }

  /**
   * 按 key 串行执行（解决 `host.md` P0-2：读-改-写丢更新）。
   * 前一个任务失败不阻塞后一个；队尾结算后自动清理，避免 Map 无限增长。
   *
   * 实例内队列负责「同进程不并发」，文件锁负责「跨实例/跨进程不并发」——
   * 两者缺一都会丢更新（实测量级：20 次并发丢 10 次）。
   */
  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const run = async (): Promise<T> => {
      const release = await this.acquireFileLock(key)
      try {
        return await fn()
      } finally {
        await release()
      }
    }
    const current = previous.then(run, run)
    const tail = current.then(() => undefined, () => undefined)
    this.queues.set(key, tail)
    try {
      return await current
    } finally {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    }
  }

  /**
   * 取一把跨进程锁（独占创建 lockfile）。
   *
   * 崩溃残留用 mtime 判定：超过 {@link LOCK_STALE_MS} 直接清掉，否则一次强杀会让该角色永远写不进去。
   */
  private async acquireFileLock(key: string): Promise<() => Promise<void>> {
    const dir = join(this.root, LOCK_DIR)
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${lockKeyOf(key)}.lock`)
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      try {
        const handle = await open(file, 'wx')
        try { await handle.writeFile(`${process.pid} ${Date.now()}`, 'utf8') } finally { await handle.close() }
        return async () => { await rm(file, { force: true }) }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code !== 'EEXIST') throw error
        try {
          const info = await stat(file)
          if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
            await rm(file, { force: true })
            continue
          }
        } catch {
          // 锁文件刚被别人删掉/还没建好：直接重试
          continue
        }
        if (Date.now() > deadline) throw new Error(`等待存储锁超时（${key}），可能有另一个 DSH 实例正在写入`)
        await sleep(15)
      }
    }
  }

  // ---------------------------------------------------------------- 索引

  async readIndex(): Promise<Record<string, IndexEntry>> {
    return (await readJson<Record<string, IndexEntry>>(join(this.root, INDEX_FILE))) ?? {}
  }

  /**
   * 索引自检：索引缺失 / 损坏 / 条目失效时扫描 characters/ 目录重建。
   * 刻意不静默丢卡（对齐原项目 character_card.md §3.1）：
   * **有 `.corrupt-` 备份的卡即使 card.json 已被改名，也保留索引条目**。
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
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        process.stderr.write(`[ai-with-u] 扫描 characters/ 失败：${error instanceof Error ? error.message : String(error)}\n`)
      }
      names = []
    }

    // 损坏备份保护：这些名字即使卡文件读不出来也不从索引里消失
    const preserved: Record<string, IndexEntry> = {}
    for (const [name, entry] of Object.entries(index)) {
      const target = resolve(this.root, entry?.path ?? '')
      const dir = dirname(target)
      if (await hasCorruptBackup(dir)) preserved[name] = entry
    }

    let needsRebuild = Object.keys(index).length === 0 && names.length > 0
    for (const [name, entry] of Object.entries(index)) {
      const target = resolve(this.root, entry?.path ?? '')
      if (!existsSync(target)) needsRebuild = true
    }
    // 反向对账：目录里多出来、索引里没有的卡（手动拷入 / 删除与保存交错产生的孤儿）
    // 以前只有「索引为空 / 条目失效」才重建，于是这些卡永远看不见。
    if (!needsRebuild) {
      const known = new Set(Object.values(index).map(entry => entry?.path ?? ''))
      for (const dirName of names) {
        if (!known.has(`${CHARACTERS_DIR}/${dirName}/card.json`)) { needsRebuild = true; break }
      }
    }

    if (needsRebuild) {
      const rebuilt: Record<string, IndexEntry> = {}
      for (const dirName of names) {
        const dir = join(dirRoot, dirName)
        const raw = await readJson<Json>(join(dir, 'card.json'))
        if (raw === undefined) {
          // 卡文件缺失或损坏：目录里有备份就保留（不静默丢卡），彻底没有才记 broken
          const backup = await hasCorruptBackup(dir)
          if (backup || existsSync(join(dir, BACKUP_FILE))) {
            const session = await readJson<SessionState>(join(dir, 'session.json'))
            const keptByName = preserved[dirName]
            rebuilt[dirName] = {
              path: `${CHARACTERS_DIR}/${dirName}/card.json`,
              last_active: session?.last_ts ?? keptByName?.last_active ?? '',
              source: keptByName?.source ?? 'custom',
            }
          } else {
            broken.push(dirName)
          }
          continue
        }
        const card = normalizeCard(raw, { fallbackName: dirName })
        // 目录名是主键（saveCard 会把 data.name 对齐目录名）：旧实现用卡内名字当索引键，
        // 一旦用户手改过 card.json 的 name，面板就会「索引里有、列表里没有」。
        const session = await readJson<SessionState>(join(dir, 'session.json'))
        rebuilt[dirName] = {
          path: `${CHARACTERS_DIR}/${dirName}/card.json`,
          last_active: session?.last_ts ?? '',
          source: cardSource(card),
        }
      }
      for (const [name, entry] of Object.entries(preserved)) {
        if (rebuilt[name] === undefined) rebuilt[name] = entry
      }
      index = rebuilt
      await atomicWrite(join(this.root, INDEX_FILE), `${JSON.stringify(rebuilt, null, 2)}\n`)
    }
    return { index, rebuilt: needsRebuild, broken }
  }

  private async touchIndex(name: string, source?: string, lastActive?: string): Promise<void> {
    await this.locked('#index', async () => {
      const index = await this.readIndex()
      index[name] = {
        path: `${CHARACTERS_DIR}/${normalizeName(name)}/card.json`,
        last_active: lastActive ?? localIsoTimestamp(),
        source: source ?? index[name]?.source ?? 'custom',
      }
      await atomicWrite(join(this.root, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`)
    })
  }

  // ---------------------------------------------------------------- 角色卡

  async listCharacters(): Promise<CharacterListItem[]> {
    const { index } = await this.ensureIndex()
    const out: CharacterListItem[] = []
    for (const [name, entry] of Object.entries(index)) {
      const ccv3 = await this.readCcV3(name)
      if (ccv3 === undefined) continue
      const view = toLegacyView(ccv3)
      const diary = await this.readDiary(name)
      const session = await this.readSession(name)
      out.push({
        name,
        card: view,
        ccv3,
        source: entry.source ?? cardSource(ccv3),
        lastActive: entry.last_active || session?.last_ts || '',
        memoryCount: diary.reduce((n, d) => n + d.timeline.length, 0),
      })
    }
    out.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''))
    return out
  }

  /**
   * 读角色卡的**旧 34 字段视图**（面板编辑面，也是既有调用方的默认形状）。
   *
   * 为什么默认给旧视图：`web.ts` / `tools.ts` / 面板 / 既有自检全都按 `card.basic` 这种形状读，
   * 读接口保持旧形状 = 92 项会话自检与前端一行都不用改（Lead 2026-10-30 决策 A）。
   * 完整 CCv3 走 {@link Store.readCcV3}。
   */
  async readCard(name: string): Promise<LegacyCardView | undefined> {
    const card = await this.readCcV3(name)
    return card === undefined ? undefined : toLegacyView(card)
  }

  /** `readCard` 的别名（语义更直白，给新代码用）。 */
  async readCardView(name: string): Promise<LegacyCardView | undefined> {
    return this.readCard(name)
  }

  /**
   * 读角色卡 → 规范化的 CCv3（**内存里归一**，不写盘）。
   * 旧格式卡在这一步被 `normalizeCard` 补成 CCv3，所以调用方永远只看一种形状。
   */
  async readCcV3(name: string): Promise<CharacterCardV3 | undefined> {
    const raw = await readJson<Json>(this.cardPath(name))
    if (raw === undefined) return undefined
    return normalizeCard(raw, { fallbackName: normalizeName(name) })
  }

  /**
   * 保存角色卡（**C7 三键契约**）。
   *
   * - 只给 `card`：以现有 CCv3 为底，用结构视图覆盖 → 重投影原生字段；
   *   `extensions.aiwu` 没被覆盖的键、`character_book`、别人的 `extensions.*` 原样保留。
   * - 只给 `ccv3`：`normalizeCard` 补默认值（结构从原生反推，只填空不覆盖）。
   * - 都给：以 `ccv3` 为底，再用 `card` 覆盖结构。
   *
   * 首次把旧格式卡写成 CCv3 之前，先落一份 `card.v1.bak.json`（不覆盖已有备份）；
   * 备份失败则整体失败（宁可不迁移，也不留半截）。
   *
   * 返回值带 `warnings`：五个原生位超限仍抛错（无预算直进提示词），世界书超限只警告不拦
   * （注入有预算，见 `tavern.collectCardWarnings`）。**绝不静默截断**。
   */
  async saveCard(input: SaveCardInput): Promise<SaveCardResult> {
    const safe = normalizeName(input.name)
    return this.locked(safe, async () => {
      // Windows 文件系统大小写不敏感：`Alice` 与 `alice` 会写进同一目录、互相覆盖日记。
      // 保存前挡住「仅大小写/编码不同」的重名，比事后修补便宜得多。
      await this.assertNoCaseVariant(safe)
      const existingRaw = await readJson<Json>(this.cardPath(safe))
      const base = isRecord(input.ccv3) ? input.ccv3 : existingRaw
      const hasCard = input.card !== undefined && isRecord(input.card)
      const hasCcv3 = input.ccv3 !== undefined && isRecord(input.ccv3)
      if (!hasCard && !hasCcv3) throw new Error('保存角色卡需要 card（旧 34 字段视图）或 ccv3（完整 CCv3）之一')

      let next: CharacterCardV3
      if (hasCard && isRecord(input.card)) {
        next = fromLegacyView(input.card as LegacyCardView, base as CharacterCardV3 | Json | undefined)
      } else {
        next = normalizeCard(base, { fallbackName: safe })
      }
      // 目录名是主键：卡内名字跟目录名走（改卡名不在本轮范围，见设计文档 M3）
      next.data.name = safe
      if (!Array.isArray(next.data.tags)) next.data.tags = []
      // 只有「无预算直进提示词」的五个原生位是硬拦；世界书超限走软警告（不拦、不截断）
      assertCardLimits(next)
      const warnings = collectCardWarnings(next)
      stampCardTimes(next, new Date())
      await this.writeCardUnlocked(safe, next, existingRaw)
      return { name: safe, card: next, warnings }
    })
  }

  /** 有没有「只有大小写/Unicode 归一不同」的既有目录（会落到同一个 Windows 目录）。 */
  private async assertNoCaseVariant(name: string): Promise<void> {
    const dirRoot = join(this.root, CHARACTERS_DIR)
    let entries: string[] = []
    try {
      entries = await readdir(dirRoot)
    } catch {
      return
    }
    const fold = (value: string): string => value.normalize('NFC').toLowerCase()
    const mine = fold(name)
    const clash = entries.find(entry => entry !== name && fold(entry) === mine)
    if (clash !== undefined) {
      throw new Error(`已存在仅大小写/编码不同的角色「${clash}」：Windows 上两者会写进同一目录，请换一个名字`)
    }
  }

  /**
   * 低层写卡：`ccv3` 形状直接落，旧视图则按 C7 合并。
   * （`forget` / `rotateOpening` / 预置卡种入都用它，调用方负责持锁。）
   */
  async writeCard(name: string, card: unknown): Promise<void> {
    const safe = normalizeName(name)
    if (isRecord(card) && card['spec'] === 'chara_card_v3' && isRecord(card['data'])) {
      await this.saveCard({ name: safe, ccv3: card })
      return
    }
    await this.saveCard({ name: safe, card })
  }

  /** 真正落盘的一步：备份旧卡 → 原子写 → 更新索引。调用方必须已持锁。 */
  private async writeCardUnlocked(name: string, card: CharacterCardV3, existingRaw: Json | undefined): Promise<void> {
    // 防御：forget / rotateOpening 等调用方可能没传 existingRaw。
    // 不自己读一次就会漏写 card.v1.bak.json（旧格式卡被就地升级后无原件可回滚）。
    const onDisk = existingRaw ?? await readJson<Json>(this.cardPath(name))
    const legacyOnDisk = onDisk !== undefined && onDisk['spec'] !== 'chara_card_v3'
    if (legacyOnDisk) {
      const backup = this.backupPath(name)
      if (!existsSync(backup)) {
        await atomicWrite(backup, `${JSON.stringify(onDisk, null, 2)}\n`)
      }
    }
    await atomicWrite(this.cardPath(name), `${JSON.stringify(card, null, 2)}\n`)
    await this.touchIndex(name, cardSource(card))
  }

  async deleteCharacter(name: string, withMemory = false): Promise<void> {
    const safe = normalizeName(name)
    // 删除也走按角色锁：否则它与并发的 saveCard 交错，会留下「文件在、索引没了」的孤儿目录
    await this.locked(safe, async () => {
      if (withMemory) {
        await rm(this.dir(safe), { recursive: true, force: true })
      } else {
        await rm(this.cardPath(safe), { force: true })
      }
      await this.locked('#index', async () => {
        const index = await this.readIndex()
        delete index[safe]
        await atomicWrite(join(this.root, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`)
      })
    })
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
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        process.stderr.write(`[ai-with-u] 读取日记失败：${this.diaryPath(name)}（${error instanceof Error ? error.message : String(error)}）\n`)
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
      // 日期分隔符放宽：模型常写 `2026-10-05` / `2026/10/05`，旧解析器只认空格，
      // 写进去就再也读不回来（下一次写入还会把它整段删掉）。
      const dateMatch = /^##\s+(\d{4})\s*[-/. ]\s*(\d{1,2})\s*[-/. ]\s*(\d{1,2})\s*$/u.exec(line)
      if (dateMatch !== null) {
        const pad = (n: string): string => n.padStart(2, '0')
        current = {
          date: `${dateMatch[1]} ${pad(dateMatch[2] ?? '')} ${pad(dateMatch[3] ?? '')}`,
          timeline: [],
          notes: [],
        }
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
      // 札记段：`>` 只是写入器的装饰，用户/模型手写时常常没有它；
      // 以前不带 `>` 的行会被静默丢弃、下一次重写就永久消失，这里一律收下。
      else if (section === 'notes') current.notes.push(body.replace(/^>\s*/u, '').trim())
    }
    return entries
  }

  /** 追加式写入：同日追加到当天段落（同角色串行，防并发丢更新）。 */
  async appendDiary(name: string, date: string, timeline: string[], notes: string[]): Promise<void> {
    const safe = normalizeName(name)
    // 写入侧必须先规范化：否则 `2026-10-05` 会落成解析器永远匹配不到的块
    const canonical = normalizeDiaryDate(date)
    await this.locked(safe, async () => {
      await this.appendDiaryUnlocked(safe, canonical, timeline, notes)
    })
  }

  /**
   * 写日记 **并在同一个临界区里**更新会话的 topic / mood（`awu_diary_write` 用）。
   *
   * 为什么必须同一事务：日记与 session 是两个文件，分两次 `locked` 会与并发 `commitTurn`
   * 交错，出现「日记写成功、topic 被后写的 commitTurn 覆盖」这类静默丢更新。
   * 这里读改写全在一个锁里，等价于原有 `commitTurn` 的原子性。
   *
   * topic / mood 传空串等价于「不改」：模型没把握时不要清空已有话题。
   */
  async appendDiaryWithNote(
    name: string,
    date: string,
    timeline: string[],
    notes: string[],
    note: { topic?: string; mood?: string } = {},
  ): Promise<SessionState | undefined> {
    const safe = normalizeName(name)
    const canonical = normalizeDiaryDate(date)
    const topic = typeof note.topic === 'string' ? note.topic.trim() : ''
    const mood = typeof note.mood === 'string' ? note.mood.trim() : ''
    return this.locked(safe, async () => {
      await this.appendDiaryUnlocked(safe, canonical, timeline, notes)
      if (topic === '' && mood === '') return this.readSession(safe)
      const previous = (await this.readSession(safe)) ?? {}
      const next: SessionState = { ...previous }
      if (topic !== '') next.topic = topic
      if (mood !== '') next.mood = mood
      await this.writeSessionUnlocked(safe, next)
      return next
    })
  }

  /** 日记追加的实现（调用方必须已持该角色的锁）。 */
  private async appendDiaryUnlocked(
    name: string,
    canonicalDate: string,
    timeline: string[],
    notes: string[],
  ): Promise<void> {
    const entries = await this.readDiary(name)
    const existing = entries.find(e => e.date === canonicalDate)
    if (existing !== undefined) {
      existing.timeline.push(...timeline)
      existing.notes.push(...notes)
    } else {
      entries.push({ date: canonicalDate, timeline: [...timeline], notes: [...notes] })
    }
    await this.writeDiaryUnlocked(name, entries)
  }

  async writeDiary(name: string, entries: DiaryEntry[]): Promise<void> {
    const safe = normalizeName(name)
    // 面板整体覆盖写盘也走同一个规范化，别让一条脏日期毁掉整份日记
    const normalized = entries.map(entry => ({ ...entry, date: normalizeDiaryDate(entry.date) }))
    await this.locked(safe, async () => { await this.writeDiaryUnlocked(safe, normalized) })
  }

  private async writeDiaryUnlocked(name: string, entries: DiaryEntry[]): Promise<void> {
    // 条目内换行会破坏「一行一条」的格式：写入前拍平，避免自己写出读不回来的文件
    const flatten = (item: string): string => String(item ?? '').replace(/\s*\r?\n\s*/gu, ' ').trim()
    const blocks = [`# ${name}的日记`]
    for (const entry of entries) {
      blocks.push(`\n## ${entry.date}`)
      const timeline = entry.timeline.map(flatten).filter(s => s !== '')
      if (timeline.length > 0) {
        blocks.push('**时间线**')
        for (const item of timeline) blocks.push(`  ${item}`)
      }
      const notes = entry.notes.map(flatten).filter(s => s !== '')
      if (notes.length > 0) {
        blocks.push('\n**心情札记**')
        for (const item of notes) blocks.push(`> ${item}`)
      }
    }
    await atomicWrite(this.diaryPath(name), `${blocks.join('\n')}\n`)
  }

  // ---------------------------------------------------------------- 会话

  async readSession(name: string): Promise<SessionState | undefined> {
    return readJson<SessionState>(this.sessionPath(name))
  }

  async writeSession(name: string, session: SessionState): Promise<void> {
    const safe = normalizeName(name)
    await this.locked(safe, async () => { await this.writeSessionUnlocked(safe, session) })
  }

  /**
   * 带锁切换交互模式。
   *
   * 旧实现是「读 → 锁外写」，与并发的 `commitTurn` 撞上会丢一轮 recent；
   * 统一收进 Store 后，读改写在同一个临界区里完成。
   *
   * v0.2.0 起：没有 session.json 时**建一个最小的**（只含 mode）——
   * 「切换纯文本」是用户的明确动作，不能因为还没聊过就静默丢掉（awu_mode / POST /mode 都靠它）。
   */
  async setMode(name: string, mode: InteractionMode): Promise<SessionState> {
    const safe = normalizeName(name)
    return this.locked(safe, async () => {
      const session = (await this.readSession(safe)) ?? {}
      const next: SessionState = { ...session, mode }
      await this.writeSessionUnlocked(safe, next)
      return next
    })
  }

  private async writeSessionUnlocked(name: string, session: SessionState): Promise<void> {
    await atomicWrite(this.sessionPath(name), `${JSON.stringify(session, null, 2)}\n`)
    await this.touchIndex(name, undefined, session.last_ts)
  }

  /**
   * 把一轮对话合并进 session.json（**核心写入口**）。
   *
   * 语义（逐条对齐原 skill `extended/session_continuity.md`）：
   *   - `turn_count`：仅对话轮 +1（展示类指令传 count=false 不计数），跨会话累计；
   *   - `last_ts`：本地时区 ISO 8601，**带 UTC 偏移**；
   *   - `recent`：滚动窗口，新摘要追加到末尾，超出 {@link RECENT_WINDOW} 的从头部丢弃；
   *   - `topic` / `mood`：显式给出才覆盖；
   *   - `mode`：交互模式随写盘同步（**不再默认篡改**成 `text+action`，见 host.md P0-4）。
   *
   * 同一 turnId 重复调用只写一次（幂等）。角色未启用时不制造会话文件。
   */
  async commitTurn(input: TurnInput = {}): Promise<TurnCommitResult> {
    const name = input.character ?? await this.activeCharacter()
    if (name === undefined) return { written: false, reason: '当前没有启用角色' }
    const safe = normalizeName(name)
    if (input.turnId !== undefined && this.lastTurnId.get(safe) === input.turnId) {
      return { written: false, reason: '本轮已写入', character: safe, session: await this.readSession(safe) }
    }

    return this.locked(safe, async () => {
      if (input.turnId !== undefined && this.lastTurnId.get(safe) === input.turnId) {
        return { written: false, reason: '本轮已写入', character: safe, session: await this.readSession(safe) }
      }
      const previous = (await this.readSession(safe)) ?? {}
      const summary = normalizeSummary(input)
      const recent = [...(previous.recent ?? [])]
      if (summary !== undefined) {
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

      await this.writeSessionUnlocked(safe, next)
      if (input.turnId !== undefined) this.lastTurnId.set(safe, input.turnId)
      return { written: true, character: safe, session: next }
    })
  }

  /** 当前启用角色（读 _active.json）。 */
  async activeCharacter(): Promise<string | undefined> {
    const active = await this.readActive()
    return active.enabled ? active.character : undefined
  }

  // ---------------------------------------------------------------- 指令：忘记

  /**
   * 「忘记{事情}」：三处同步定点清理。
   *
   *   ① diary.md：命中的时间线条目整条删除；心情札记按条删除；
   *   ② session.json：`recent` 中相关摘要删除，`topic` 命中则清空；
   *   ③ card.json：**全卡按句手术**（`forgetCardText`）——遍历 `extensions.aiwu` 整棵树 +
   *      世界书条目 + 外部原文 + 开场白，删完重投影原生字段。
   *
   * ⚠️ v0.1 只认 `memory_anchor` / `dynamic_state` 两个旧键，迁到 CCv3 后会**静默失效**
   * （界面提示成功、卡里一个字没少）。现在返回 `card.scanned`，扫过 0 处会带 warning。
   */
  async forget(name: string, keyword: string): Promise<ForgetResult> {
    const safe = normalizeName(name)
    const keywords = splitKeywords(keyword)
    if (keywords.length === 0) throw new Error('请给出要忘记的内容')
    const hit = (text: string): boolean => keywords.some(k => text.includes(k))

    return this.locked(safe, async () => {
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
      if (diaryChanged) await this.writeDiaryUnlocked(safe, kept)

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
        if (sessionChanged) await this.writeSessionUnlocked(safe, nextSession)
      }

      // ③ 角色卡（全卡按句手术）
      const card = await this.readCcV3(safe)
      let removedCard: string[] = []
      let scanned = { fields: 0, entries: 0, rawFields: 0 }
      let cardWarnings: string[] = []
      if (card !== undefined) {
        const result = forgetCardText(card, keywords)
        removedCard = result.removed
        scanned = result.scanned
        cardWarnings = result.warnings
        if (removedCard.length > 0) {
          stampCardTimes(result.card, new Date())
          await this.writeCardUnlocked(safe, result.card, undefined)
        }
      }

      return {
        character: safe,
        keyword: keywords.join('|'),
        diary: { removedTimeline, removedNotes, removedDiaryFile: removedTimeline.length + removedNotes.length },
        session: { removedRecent: (session?.recent ?? []).filter(item => hit(item)), topicCleared: sessionChanged && hit(session?.topic ?? '') },
        card: { removed: removedCard, scanned, warnings: cardWarnings },
        changed: diaryChanged || sessionChanged || removedCard.length > 0,
      }
    })
  }

  // ---------------------------------------------------------------- 指令：改日记

  /** 「改日记{内容}」：就地改写 diary 中对应条目（多条命中按最新一条改写）。 */
  async editDiary(name: string, patch: DiaryEditInput): Promise<DiaryEditResult> {
    const safe = normalizeName(name)
    return this.locked(safe, async () => {
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
      await this.writeDiaryUnlocked(safe, entries)

      // 同步：该事若也出现在 session.recent 摘要里，一并更新
      const session = await this.readSession(safe)
      let sessionUpdated = false
      if (session !== undefined && Array.isArray(session.recent) && before !== undefined) {
        const recent = session.recent.map(item => (item === before ? text : item))
        if (recent.some((item, i) => item !== session.recent?.[i])) {
          await this.writeSessionUnlocked(safe, { ...session, recent })
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
    })
  }

  // ---------------------------------------------------------------- 指令：重置

  /**
   * 「全新开始」：会话状态归零，日记保留。
   *
   * 亲密度与变更日志**保留**：那是「角色记得用户这个人」的一部分（关系里程碑不是聊天记录），
   * 和日记同一档语义。「彻底重置」才连它们一起清掉。
   */
  async resetSession(name: string, now: Date = new Date()): Promise<ResetResult> {
    const safe = normalizeName(name)
    return this.locked(safe, async () => {
      const previous = (await this.readSession(safe)) ?? {}
      const next: SessionState = {
        recent: [],
        turn_count: 0,
        last_ts: localIsoTimestamp(now),
        mode: previous.mode ?? await this.activeMode(),
        ...(previous.intimacy === undefined ? {} : { intimacy: previous.intimacy }),
        ...(previous.relation_log === undefined ? {} : { relation_log: previous.relation_log }),
      }
      await this.writeSessionUnlocked(safe, next)
      const diary = await this.readDiary(safe)
      return {
        character: safe,
        scope: 'session',
        session: next,
        diaryKept: diary.reduce((n, d) => n + d.timeline.length + d.notes.length, 0),
      }
    })
  }

  /** 「彻底重置」：会话状态 + diary.md 全部清空（含亲密度与日志），角色卡不动。 */
  async resetStory(name: string, now: Date = new Date()): Promise<ResetResult> {
    const safe = normalizeName(name)
    return this.locked(safe, async () => {
      const previous = (await this.readSession(safe)) ?? {}
      const diary = await this.readDiary(safe)
      const removedDiary = diary.reduce((n, d) => n + d.timeline.length + d.notes.length, 0)
      // 删日记前先留一份可回滚的备份：这是不可逆操作，宁可多一个文件也不让记忆直接蒸发
      const diaryBackup = await this.backupDiary(safe)
      await rm(this.diaryPath(safe), { force: true })
      const next: SessionState = {
        recent: [],
        turn_count: 0,
        last_ts: localIsoTimestamp(now),
        mode: previous.mode ?? await this.activeMode(),
      }
      await this.writeSessionUnlocked(safe, next)
      return {
        character: safe,
        scope: 'all',
        session: next,
        diaryRemoved: removedDiary,
        ...(diaryBackup === undefined ? {} : { diaryBackup }),
      }
    })
  }

  /** 把 diary.md 复制成 `diary.md.bak-<时间戳>`；没有日记或读失败时返回 undefined。 */
  private async backupDiary(name: string): Promise<string | undefined> {
    const path = this.diaryPath(name)
    try {
      const text = await readFile(path, 'utf8')
      if (text.trim() === '') return undefined
      const stamp = localIsoTimestamp().replace(/[^\d]/gu, '')
      const backup = `${path}.bak-${stamp}`
      await atomicWrite(backup, text)
      return backup
    } catch {
      return undefined
    }
  }

  private async activeMode(): Promise<string | undefined> {
    return (await this.readActive()).mode
  }

  // ---------------------------------------------------------------- 指令：关系

  /**
   * 「关系」：当前档位 + 起点锚定 + 客观依据。
   *
   * v0.2.0 起档位**落盘**（`session.intimacy`）：面板显示起点档、对话里模型现算，两边会打架，
   * 所以统一成「session 里的当前档位优先，没有才用卡内起点档」。`baseline` 仍保持原语义
   * （关系定位文本推出的起点），`current` 是实际当前档位，`log` 是里程碑变更历史。
   */
  async relationState(name: string): Promise<RelationState> {
    const safe = normalizeName(name)
    const card = await this.readCcV3(safe)
    const view = card === undefined ? undefined : toLegacyView(card)
    const session = await this.readSession(safe)
    const diary = await this.readDiary(safe)
    const rel = view?.['relationship']
    const startText = isRecord(rel)
      ? Object.values(rel).map(v => (Array.isArray(v) ? v.join('；') : String(v ?? ''))).join('；')
      : ''
    const baseline = relationBaseline(startText)
    const turns = Number(session?.turn_count ?? 0) || 0
    const diaryCount = diary.reduce((n, d) => n + d.timeline.length + d.notes.length, 0)
    return {
      character: safe,
      baseline,
      current: intimacyOf(session) ?? baseline,
      turns,
      diaryCount,
      bands: RELATION_BANDS,
      log: relationLogOf(session),
      startText,
      // 兼容旧字段：client/api.ts 的 RelationState 仍在读这三个
      turnCount: turns,
      lastActive: session?.last_ts ?? '',
      diaryEntries: diaryCount,
      note: '档位由模型判定、按里程碑写回 session.json；此处给当前档位、起点锚定与变更日志',
    }
  }

  /**
   * 写回当前关系档位（`awu_relation set` / `POST /relation/set`）。
   *
   * 校验档位 → 在同一个临界区里读改写 session（`intimacy` + 追加 `relation_log`，超上限丢最旧）→
   * 返回**写完之后**的 relationState。`from` 取变更前档位（没有就用起点档），
   * 这样日志能自解释「从哪一档到哪一档」。
   *
   * 日志追加条件：**同档且没写 why = 纯噪音，不追加**；同档但 why 非空照记
   * （表白这类「没进档的里程碑」值得留痕）。档位本身无论如何都写回。
   */
  async setIntimacy(name: string, value: RelationBand, why?: string): Promise<RelationState> {
    const safe = normalizeName(name)
    if (!(RELATION_BANDS as readonly string[]).includes(value)) {
      throw new Error(`关系档位只能是 ${RELATION_BANDS.join(' / ')}：${String(value)}`)
    }
    const trimmedWhy = typeof why === 'string' ? why.trim() : ''
    await this.locked(safe, async () => {
      const previous = (await this.readSession(safe)) ?? {}
      const baseline = await this.startBand(safe)
      const from = intimacyOf(previous) ?? baseline
      const log = [...relationLogOf(previous)]
      // 同档且没写原因不追加（否则日志被「没变化」刷满）
      if (!(from === value && trimmedWhy === '')) {
        log.push({
          at: localIsoTimestamp(),
          from,
          to: value,
          ...(trimmedWhy === '' ? {} : { why: trimmedWhy }),
        })
      }
      const next: SessionState = {
        ...previous,
        intimacy: value,
        // 只留最近 RELATION_LOG_LIMIT 条：超出丢最旧（slice 保留尾部 = 最新）
        relation_log: log.slice(-RELATION_LOG_LIMIT),
      }
      await this.writeSessionUnlocked(safe, next)
    })
    return this.relationState(safe)
  }

  /** 卡内「关系定位」推出的起点档（读不到卡时按「认识」）。 */
  private async startBand(name: string): Promise<RelationBand> {
    const card = await this.readCcV3(name)
    if (card === undefined) return '认识'
    const rel = toLegacyView(card)['relationship']
    const text = isRecord(rel)
      ? Object.values(rel).map(v => (Array.isArray(v) ? v.join('；') : String(v ?? ''))).join('；')
      : ''
    return relationBaseline(text)
  }

  // ---------------------------------------------------------------- 指令：换一句开场

  /**
   * 「换一句开场」：从 `data.alternate_greetings` 轮换下一句（游标靠顺序持久化）。
   * 无历史档案 → 取下一句并移到末尾；有历史 → 不动；缺失 → needGenerate。
   */
  async rotateOpening(name: string, options: { save?: boolean; candidates?: string[] } = {}): Promise<OpeningResult> {
    const safe = normalizeName(name)
    return this.locked(safe, async () => {
      const card = await this.readCcV3(safe)
      if (card === undefined) throw new Error(`找不到角色卡：${safe}`)
      const session = await this.readSession(safe)
      const diary = await this.readDiary(safe)
      const hasHistory = (session?.recent?.length ?? 0) > 0
        || (typeof session?.topic === 'string' && session.topic.trim() !== '')
        || diary.some(d => d.timeline.length > 0 || d.notes.length > 0)

      const openings = Array.isArray(card.data.alternate_greetings)
        ? card.data.alternate_greetings.map(String).filter(s => s.trim() !== '')
        : []
      const saveCandidates = (options.candidates ?? []).map(String).filter(s => s.trim() !== '')

      if (saveCandidates.length > 0) {
        const merged = [...openings, ...saveCandidates.filter(c => !openings.includes(c))]
        const chosen = merged.find(c => !openings.includes(c)) ?? merged[0] ?? ''
        const rest = merged.filter(s => s !== chosen)
        const next: CharacterCardV3 = { ...card, data: { ...card.data, alternate_greetings: [...rest, chosen] } }
        stampCardTimes(next, new Date())
        await this.writeCardUnlocked(safe, next, undefined)
        return { character: safe, opening: chosen, openings: [...rest, chosen], history: hasHistory, generated: saveCandidates.length }
      }

      const fallback = typeof card.data.first_mes === 'string' ? card.data.first_mes : ''
      if (openings.length === 0) {
        return { character: safe, opening: fallback, openings: [], history: hasHistory, needGenerate: true }
      }
      if (hasHistory) {
        return { character: safe, opening: openings[0] ?? '', openings, history: true }
      }

      const [nextOpening, ...rest] = openings
      const rotated = [...rest, nextOpening ?? '']
      const next: CharacterCardV3 = { ...card, data: { ...card.data, alternate_greetings: rotated } }
      stampCardTimes(next, new Date())
      await this.writeCardUnlocked(safe, next, undefined)
      return { character: safe, opening: nextOpening ?? '', openings: rotated, history: false }
    })
  }

  /** 按三态判定开局方式（无历史档案 / 全新开始之后 / 有历史档案）。 */
  async openingState(name: string): Promise<{ state: 'none' | 'fresh-reset' | 'history'; opening: string; openings: string[] }> {
    const safe = normalizeName(name)
    const card = await this.readCcV3(safe)
    const session = await this.readSession(safe)
    const diary = await this.readDiary(safe)
    const hasDiary = diary.some(d => d.timeline.length > 0 || d.notes.length > 0)
    const hasSession = (session?.recent?.length ?? 0) > 0
      || (typeof session?.topic === 'string' && session.topic.trim() !== '')
    const openings = Array.isArray(card?.data.alternate_greetings) ? card.data.alternate_greetings.map(String) : []
    const opening = typeof card?.data.first_mes === 'string' ? card.data.first_mes : ''
    if (hasSession) return { state: 'history', opening, openings }
    if (hasDiary) return { state: 'fresh-reset', opening, openings }
    return { state: 'none', opening, openings }
  }

  // ---------------------------------------------------------------- 会话绑定

  /** 读绑定表；文件不存在 / 损坏都当空表（损坏会被 `readJson` 改名留痕，不会静默吞掉卡）。 */
  async readBindings(): Promise<SessionBindings> {
    const raw = await readJson<SessionBindings>(join(this.root, SESSIONS_FILE))
    if (!isRecord(raw)) return {}
    const out: SessionBindings = {}
    for (const [sessionId, value] of Object.entries(raw)) {
      if (!isRecord(value)) continue
      const character = typeof value['character'] === 'string' ? value['character'].trim() : ''
      if (character === '') continue
      const boundAt = typeof value['boundAt'] === 'string' ? value['boundAt'].trim() : ''
      out[sessionId] = { character, boundAt: boundAt === '' ? localIsoTimestamp() : boundAt }
    }
    return out
  }

  /** 写绑定表（**调用方必须已持 `#sessions` 锁**）。 */
  private async writeBindingsUnlocked(bindings: SessionBindings): Promise<void> {
    await atomicWrite(join(this.root, SESSIONS_FILE), `${JSON.stringify(bindings, null, 2)}\n`)
  }

  /**
   * 绑定一个会话到某张卡（「当前会话启用」）。
   *
   * 卡不存在直接拒（绑到不存在的卡 = 那个会话之后会静默未启用，用户看不懂）；
   * 写盘走 `#sessions` 键的跨进程锁——桌面 + web profile 共用数据根时，
   * 绑定表与 `_index.json` 同级对待，不共用锁就会互相丢更新。
   */
  async bindSession(sessionId: string, character: string): Promise<SessionBinding> {
    const sid = normalizeSessionId(sessionId)
    const name = normalizeName(character)
    if ((await this.readCcV3(name)) === undefined) throw new Error(`找不到角色卡：${name}`)
    return this.locked('#sessions', async () => {
      const bindings = await this.readBindings()
      const binding: SessionBinding = { character: name, boundAt: localIsoTimestamp() }
      bindings[sid] = binding
      await this.writeBindingsUnlocked(bindings)
      return binding
    })
  }

  /** 解除一个会话的绑定；返回该会话原先绑的是谁（没绑过返回 undefined）。 */
  async unbindSession(sessionId: string): Promise<SessionBinding | undefined> {
    const sid = normalizeSessionId(sessionId)
    return this.locked('#sessions', async () => {
      const bindings = await this.readBindings()
      const previous = bindings[sid]
      if (previous === undefined) return undefined
      delete bindings[sid]
      await this.writeBindingsUnlocked(bindings)
      return previous
    })
  }

  /**
   * 清理指向「已删除角色卡」的绑定，返回被清掉的 sessionId。
   *
   * 为什么必须清：绑定指向不存在的卡时，那个会话应当**明确未启用**（并且我们连同绑定一起清掉），
   * 而不是静默回落到全局角色——否则用户以为在跟 A 聊，其实在跟 B 聊。
   */
  async pruneBindings(): Promise<string[]> {
    return this.locked('#sessions', async () => {
      const bindings = await this.readBindings()
      const pruned: string[] = []
      for (const [sessionId, binding] of Object.entries(bindings)) {
        let alive = false
        try {
          alive = (await this.readCcV3(binding.character)) !== undefined
        } catch {
          // 卡名本身就是脏的（手改过 `_sessions.json`）：按"卡不在"处理
          alive = false
        }
        if (!alive) { pruned.push(sessionId); delete bindings[sessionId] }
      }
      if (pruned.length > 0) await this.writeBindingsUnlocked(bindings)
      return pruned
    })
  }

  /** 删卡时连带清掉指向它的绑定（返回被清掉的 sessionId 列表）。 */
  async pruneBindingsOf(character: string): Promise<string[]> {
    const name = normalizeName(character)
    return this.locked('#sessions', async () => {
      const bindings = await this.readBindings()
      const pruned = Object.entries(bindings)
        .filter(([, binding]) => binding.character === name)
        .map(([sessionId]) => sessionId)
      if (pruned.length === 0) return pruned
      for (const sessionId of pruned) delete bindings[sessionId]
      await this.writeBindingsUnlocked(bindings)
      return pruned
    })
  }

  // ---------------------------------------------------------------- 插拔状态

  async readActive(): Promise<ActiveState> {
    return (await readJson<ActiveState>(join(this.root, ACTIVE_FILE))) ?? { enabled: false }
  }

  async writeActive(state: ActiveState): Promise<void> {
    await atomicWrite(join(this.root, ACTIVE_FILE), `${JSON.stringify(state, null, 2)}\n`)
  }

  /**
   * 首次使用时幂等种入预置卡：仅当 characters/ 目录不存在时执行一次。
   *
   * 预置卡现在本身就是 CCv3（2026-10-30 换过），种入用原子写直接落盘；
   * 旧格式卡的迁移回归由 `scripts/fixtures/legacy-cards` 承担，不再依赖预置卡。
   */
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
          const raw = JSON.parse(await readFile(src, 'utf8')) as Json
          const name = normalizeName(cardName(raw) !== '' ? cardName(raw) : entry.name)
          const dst = this.cardPath(name)
          if (existsSync(dst)) continue
          await mkdir(dirname(dst), { recursive: true })
          // 旧格式原样写（迁移在读取时发生，第二次写盘才落成 CCv3）
          await writeFile(dst, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
          await this.touchIndex(name, cardSource(raw))
          seeded += 1
        } catch (error) {
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

/** 目录里有没有 `.corrupt-` 备份（有就说明卡是坏过而不是没了）。 */
async function hasCorruptBackup(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir)
    return names.some(name => name.startsWith(CORRUPT_PREFIX))
  } catch {
    return false
  }
}

// -------------------------------------------------------------------- 指令辅助

export interface RelationState {
  character: string
  /** 起点档（由卡内「关系定位」推出，语义未变）。 */
  baseline: RelationBand
  /** 当前档位（session.intimacy，缺省退回 baseline）。 */
  current: RelationBand
  /** 累计对话轮数。 */
  turns: number
  /** 日记条目总数（时间线 + 札记）。 */
  diaryCount: number
  bands: readonly RelationBand[]
  /** 里程碑变更日志（最多 {@link RELATION_LOG_LIMIT} 条）。 */
  log: RelationLogItem[]
  startText: string
  /** @deprecated 与 `turns` 同值，保留给既有面板（client/api.ts）。 */
  turnCount: number
  lastActive: string
  /** @deprecated 与 `diaryCount` 同值，保留给既有面板。 */
  diaryEntries: number
  note: string
}

export interface ForgetResult {
  character: string
  keyword: string
  diary: { removedTimeline: string[]; removedNotes: string[]; removedDiaryFile: number }
  session: { removedRecent: string[]; topicCleared: boolean }
  card: {
    removed: string[]
    /** 扫过的字段数 / 世界书条目数 / 外部原文字段数——`fields===0` 说明格式没被识别。 */
    scanned: { fields: number; entries: number; rawFields: number }
    warnings: string[]
  }
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
  /** 「彻底重置」删日记前的备份文件（存在即有值，可据此提示用户去哪找回）。 */
  diaryBackup?: string
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

/** `YYYY MM DD` / `YYYY-MM-DD` / `YYYY/MM/DD` / `YYYY.MM.DD` 统一成日记分组标题格式。 */
function normalizeDiaryDate(input: string): string {
  const m = /^(\d{4})[\s\-/.](\d{1,2})[\s\-/.](\d{1,2})$/u.exec(input.trim())
  if (m === null) throw new Error(`日期格式应为 YYYY MM DD（也接受 - / . 分隔）：${input}`)
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`日期不合法：${input}`)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${m[1]} ${pad(month)} ${pad(day)}`
}

/**
 * 从候选里选一条改写目标：显式 index 优先；否则取**最新一条**
 * （日期大的优先，同日取末尾）。
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

/** 重新导出，方便其它模块不需要再 import tavern。 */
export type { CharacterCardV3, CardData, LegacyCardView }
