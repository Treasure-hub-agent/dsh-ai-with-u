/**
 * AI WITH U · 酒馆卡导入（容器解析：PNG / CHARX(zip) / 裸 JSON）
 *
 * 设计边界（见 `docs/design/2026-10-30-card-import.md`）：
 *  - **纯函数、零 IO**：不读文件、不写盘、不打时间戳、不碰 store。调用方给 Buffer，这里只吐结构。
 *  - **零新依赖**：只用 `node:zlib`（CHARX 的 deflate、压缩 iTXt 都要它）。
 *  - **只负责容器与外壳**：把字节变成「CCv3 形状的对象」。34 字段旧卡 → CCv3 的迁移**不在这里**，
 *    归 `src/tavern.ts` 的 `normalizeCard`。这里遇到旧格式会给出指向它的明确报错。
 *  - **不做**：`assets` 立绘落地、`regex_scripts`（muv 系）、世界书算法。`assets` 一律剥掉并告警。
 *
 * Tavern 卡的两代容器约定（本篇按实际字节实现，不猜）：
 *  - PNG：`tEXt` chunk，keyword 为 `ccv3`（V3）或 `chara`（V2），text 是 **base64 的 UTF-8 JSON**。
 *    chunk 可以出现在 IDAT 之前或之后，长度是**大端** 4 字节，尾部 4 字节 CRC（我们不校验，但要能跳过）。
 *  - CHARX：本质是 zip，**根目录 `card.json`** 就是 CCv3 本体；`embeded://` 资源一概忽略。
 *
 * @module dsh-ai-with-u/import-card
 */
import { inflateRawSync, inflateSync } from 'node:zlib'

// ---------------------------------------------------------------- 类型

/** 容器格式。与 `docs/design/2026-10-30-tavern-card.md` 的 `legacy.from` / `imported.from` 对齐。 */
export type CardFormat = 'png' | 'charx' | 'json'

/**
 * CCv3 卡片的**最小结构**（宽松）：只保证 `spec` / `spec_version` / `data` 三个位置，其余键原样透传。
 *
 * ⚠️ 这是**归一化之前**的形状，故意比 `src/tavern.ts` 的 `CharacterCardV3`（`CardData` 一堆必填）
 * 更松：外部卡常常缺 `tags` / `creator` / `group_only_greetings`，甚至没有名字。
 * 正确链路是
 *
 * ```ts
 * const loose = parseCardBuffer(buf, fileName).card   // 本文件，只保证结构位置
 * const card = normalizeCard(loose)                    // src/tavern.ts，补默认值 → CharacterCardV3
 * ```
 *
 * 所以不要把这里的类型换成 `CharacterCardV3`——那会逼解析器去编造默认值，把归一化职责劈成两半。
 */
export interface CharacterCardV3Like {
  spec: 'chara_card_v3'
  spec_version?: string
  data: {
    name?: string
    description?: string
    personality?: string
    scenario?: string
    mes_example?: string
    system_prompt?: string
    post_history_instructions?: string
    first_mes?: string
    alternate_greetings?: string[]
    character_book?: Record<string, unknown>
    extensions?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ParsedCardFile {
  /** 已归一成 V3 形状（V2 会包一层，裸 data 会补 spec） */
  card: CharacterCardV3Like
  /** 实际命中的容器（按**魔数**判定，不看扩展名） */
  format: CardFormat
  /** 非致命问题：缺名字、assets 被剥离、V2 被包层、扩展名与内容不符…… */
  warnings: string[]
}

/** 硬闸。两者都不为「正常卡」设计，只防内存炸弹与误传大文件。 */
export const IMPORT_LIMITS = {
  /** 输入 Buffer 上限 */
  maxBytes: 64 * 1024 * 1024,
  /** 解出来的 card.json 上限（zip 炸弹闸） */
  maxCardBytes: 8 * 1024 * 1024,
} as const

/** ZIP 里我们唯一认的文件名。 */
const CHARX_ENTRY = 'card.json'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** PNG tEXt/iTXt 的 keyword 优先级：V3 优先，其次 V2。 */
const PNG_KEYWORDS = ['ccv3', 'chara'] as const

// ---------------------------------------------------------------- 小工具

function isPng(buf: Buffer): boolean {
  return buf.length >= PNG_SIGNATURE.length && buf.subarray(0, 8).equals(PNG_SIGNATURE)
}

function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50
}

function extensionOf(fileName: string): string {
  const name = typeof fileName === 'string' ? fileName.trim().toLowerCase() : ''
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** `JSON.parse` 的报错翻成带行列的中文。 */
function describeJsonError(error: unknown, text: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const detail = message.replace(/^JSON\.parse:\s*/u, '')
  const at = /at position (\d+)/u.exec(message)
  if (at === null || at[1] === undefined) return `JSON 解析失败：${detail}`
  const pos = Number(at[1])
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  const column = pos - before.lastIndexOf('\n')
  return `JSON 解析失败（第 ${pos} 个字符，第 ${line} 行第 ${column} 列）：${detail}`
}

/** 去掉 UTF-8 BOM 再按 UTF-8 解码。 */
function decodeUtf8(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8')
  }
  return buf.toString('utf8')
}

// ---------------------------------------------------------------- PNG

/** 一条候选卡片文本：来自 tEXt / iTXt。 */
interface PngTextChunk { keyword: string; text: string }

/**
 * 扫 PNG chunk，收集 `ccv3` / `chara` 的文本。
 *
 * 只走到 IEND 为止；IDAT 的数据整块跳过（卡片常放在 IDAT 之后，所以不能遇到 IDAT 就收工）。
 * CRC 一律不校验（长度正确就能跳过），截断时给的是「文件可能不完整」而不是崩。
 */
function scanPngTextChunks(buf: Buffer): { chunks: PngTextChunk[]; truncated: boolean } {
  const chunks: PngTextChunk[] = []
  let truncated = false
  let offset = PNG_SIGNATURE.length
  let sawHeader = false

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    // 尾部 4 字节是 CRC：长度越界说明文件被截断，容忍已收到的部分
    if (dataEnd + 4 > buf.length) { truncated = true; break }

    if (type === 'IHDR') sawHeader = true
    const data = buf.subarray(dataStart, dataEnd)
    if (type === 'tEXt') {
      const zero = data.indexOf(0)
      if (zero > 0 && zero < data.length) {
        chunks.push({
          keyword: data.toString('latin1', 0, zero),
          text: data.toString('latin1', zero + 1),
        })
      }
    } else if (type === 'iTXt') {
      const parsed = parseItxt(data)
      if (parsed !== undefined) chunks.push(parsed)
    }

    offset = dataEnd + 4
    if (type === 'IEND') break
  }

  if (!sawHeader) truncated = true
  return { chunks, truncated }
}

/**
 * 解 iTXt：`keyword\0 flag(1) method(1) lang\0 translated\0 text`。
 *
 * flag=0 明文，flag=1 是 deflate 压缩。部分酒馆卡用 iTXt 存 `ccv3`，所以顺手支持。
 */
function parseItxt(data: Buffer): PngTextChunk | undefined {
  const zero = data.indexOf(0)
  if (zero <= 0 || zero + 3 > data.length) return undefined
  const keyword = data.toString('latin1', 0, zero)
  const flag = data[zero + 1]
  let cursor = zero + 3
  const langEnd = data.indexOf(0, cursor)
  if (langEnd < 0) return undefined
  cursor = langEnd + 1
  const translatedEnd = data.indexOf(0, cursor)
  if (translatedEnd < 0) return undefined
  cursor = translatedEnd + 1
  const body = data.subarray(cursor)
  if (flag === 1) {
    try {
      return { keyword, text: inflateSync(body).toString('utf8') }
    } catch {
      // 压缩流坏了：当作这条 chunk 没有，交给上层报「没找到卡片文本」
      return undefined
    }
  }
  if (flag !== 0) return undefined
  return { keyword, text: body.toString('utf8') }
}

/** base64 → UTF-8 JSON 文本。 */
function decodeBase64Json(text: string, label: string): string {
  const raw = text.trim()
  if (raw === '') throw new Error(`${label} 的卡片文本是空的（base64 段没有内容）`)
  if (!/^[A-Za-z0-9+/=\s]+$/u.test(raw)) {
    throw new Error(`${label} 的卡片文本不是合法 base64：可能不是酒馆卡，或者被别的工具改写过`)
  }
  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length === 0) throw new Error(`${label} 的 base64 解出来是空的`)
  return decodeUtf8(decoded)
}

function parsePng(buf: Buffer): ParsedCardFile {
  const warnings: string[] = []
  const { chunks, truncated } = scanPngTextChunks(buf)
  if (truncated) warnings.push('PNG 看起来不完整（没有 IHDR 或有 chunk 越界），已尽力读取能拿到的部分')

  if (chunks.length === 0) {
    throw new Error('这张 PNG 里没有 tEXt/iTXt 卡片数据（keyword 应为 ccv3 或 chara）——它可能只是张普通图片')
  }

  for (const keyword of PNG_KEYWORDS) {
    const hit = chunks.find(chunk => chunk.keyword === keyword)
    if (hit === undefined) continue
    if (keyword === 'chara') {
      warnings.push('这张卡用的是 V1/V2 的 chara 段（没有 ccv3），已按 V2 处理并包成 V3 形状')
    }
    const json = decodeBase64Json(hit.text, `PNG 的 ${keyword} 段`)
    const parsed = parseJsonText(json, 'png')
    return { ...parsed, format: 'png', warnings: [...warnings, ...parsed.warnings] }
  }

  const seen = chunks.map(chunk => chunk.keyword).join(' / ')
  throw new Error(`这张 PNG 里有卡片数据，但 keyword 不认识（找到：${seen}）；本插件只认 ccv3 与 chara`)
}

// ---------------------------------------------------------------- CHARX（zip）

interface ZipEntry {
  name: string
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

/**
 * 找 EOCD（`0x06054b50`）。zip 允许尾部有最多 64 KB 注释，所以从末尾往前扫。
 * @returns EOCD 偏移；找不到返回 -1。
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  const minOffset = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

/** 读中央目录，列出条目。ZIP64 明确报错（我们不做）。 */
function readCentralDirectory(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) throw new Error('这个 ZIP 太小了，读不到中央目录（文件可能不完整）')
  const eocd = findEndOfCentralDirectory(buf)
  if (eocd < 0) {
    throw new Error('找不到 ZIP 的中央目录（End of Central Directory）——文件可能被截断，或者根本不是 zip')
  }
  const totalEntries = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('这是 ZIP64 包，本插件暂不支持（请用普通 zip 重新打包成 .charx）')
  }
  if (cdOffset + cdSize > buf.length) {
    throw new Error('ZIP 中央目录越界：文件被截断，或者声明的大小与实际不符')
  }

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < totalEntries; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      // 条数声明与实际不符：已经读到的够用就继续，交给上层判断
      break
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const uncompressedSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/gu, '/')
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (entries.length === 0) throw new Error('ZIP 中央目录里一个条目都没有')
  return entries
}

/** 按中央目录的描述把某个条目的数据取出来（解压）。 */
function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if ((entry.flags & 0x1) !== 0) {
    throw new Error(`CHARX 里的 ${entry.name} 是加密条目，本插件不支持加密 zip`)
  }
  const local = entry.localOffset
  if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) {
    throw new Error(`CHARX 的本地文件头损坏（${entry.name}），文件可能被截断`)
  }
  // 本地头里的 size 在「数据描述符」模式下是 0，所以尺寸一律用中央目录的
  const nameLen = buf.readUInt16LE(local + 26)
  const extraLen = buf.readUInt16LE(local + 28)
  const dataStart = local + 30 + nameLen + extraLen
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buf.length) {
    throw new Error(`CHARX 的 ${entry.name} 数据越界：文件被截断`)
  }
  const data = buf.subarray(dataStart, dataEnd)

  if (entry.method === 0) return Buffer.from(data)          // stored
  if (entry.method === 8) {                                  // deflate
    try {
      return inflateRawSync(data, { maxOutputLength: IMPORT_LIMITS.maxCardBytes })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`CHARX 的 ${entry.name} 解压失败：${reason}`)
    }
  }
  throw new Error(`CHARX 的 ${entry.name} 用了不支持的压缩方法 ${entry.method}（本插件只支持 store=0 / deflate=8）`)
}

function parseCharx(buf: Buffer): ParsedCardFile {
  const warnings: string[] = []
  const entries = readCentralDirectory(buf)

  // 根目录优先；允许嵌套一层（有些工具会套一层文件夹），取层级最浅的那个
  const candidates = entries
    .map(entry => ({ entry, depth: entry.name.split('/').length }))
    .filter(({ entry }) => entry.name === CHARX_ENTRY || entry.name.endsWith(`/${CHARX_ENTRY}`))
    .sort((a, b) => a.depth - b.depth)
  if (candidates.length === 0) {
    const sample = entries.slice(0, 6).map(entry => entry.name).join(' / ')
    throw new Error(`这个 CHARX 里没有 ${CHARX_ENTRY}（根目录应有它）。包内条目：${sample}${entries.length > 6 ? ' …' : ''}`)
  }
  const chosen = candidates[0] as { entry: ZipEntry; depth: number }
  if (chosen.entry.name !== CHARX_ENTRY) {
    warnings.push(`card.json 不在包根目录（实际在 ${chosen.entry.name}），已按最浅的那个读取`)
  }
  if (chosen.entry.uncompressedSize > IMPORT_LIMITS.maxCardBytes) {
    throw new Error(`${CHARX_ENTRY} 解出来有 ${mb(chosen.entry.uncompressedSize)}，超过上限 ${mb(IMPORT_LIMITS.maxCardBytes)}`)
  }

  const raw = readZipEntry(buf, chosen.entry)
  if (raw.length > IMPORT_LIMITS.maxCardBytes) {
    throw new Error(`${CHARX_ENTRY} 实际解出 ${mb(raw.length)}，超过上限 ${mb(IMPORT_LIMITS.maxCardBytes)}`)
  }
  if (entries.length > 1) {
    const ignored = entries.length - 1
    warnings.push(`包内还有 ${ignored} 个其它条目（assets 等），本插件只读 ${CHARX_ENTRY}，其余忽略`)
  }

  const parsed = parseJsonText(decodeUtf8(raw), 'charx')
  return { ...parsed, format: 'charx', warnings: [...warnings, ...parsed.warnings] }
}

// ---------------------------------------------------------------- JSON / 归一

/** 解析一段 JSON 文本并归一成 CCv3。 */
function parseJsonText(text: string, format: CardFormat): Omit<ParsedCardFile, 'format'> {
  if (text.trim() === '') throw new Error('卡片 JSON 是空的')
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (error) {
    throw new Error(describeJsonError(error, text))
  }
  const warnings: string[] = []
  const card = toCardV3(obj, format, warnings)
  return { card, warnings }
}

/**
 * 把任意「酒馆卡形状」的值归一成 CCv3。
 *
 * 只认三种（与 `tavern-card.md` §2.1 的 V3 / V2 / 裸 data 对齐）：
 *  - `{ spec: 'chara_card_v3', data: {...} }` → 原样（补 `spec_version`）
 *  - `{ spec: 'chara_card_v2', data: {...} }` → 包一层 V3（V2 的 character_book 结构兼容）
 *  - `{ data: {...} }`（没有 spec）→ 按 V2 处理并告警
 *
 * **本插件 v0.1 的 10 组中文键旧卡不在这里迁移**：直接报错指向 `src/tavern.ts` 的 normalizeCard，
 * 免得两条迁移路径互相打架。
 */
function toCardV3(value: unknown, format: CardFormat, warnings: string[]): CharacterCardV3Like {
  if (!isPlainObject(value)) {
    throw new Error('卡片 JSON 的顶层必须是对象（现在不是）')
  }

  const spec = typeof value.spec === 'string' ? value.spec.trim() : ''
  let data: Record<string, unknown>
  let isV3 = false

  if (spec === 'chara_card_v3') {
    if (!isPlainObject(value.data)) throw new Error('这是 CCv3 卡，但缺少 data 对象（卡片已损坏）')
    data = { ...value.data }
    isV3 = true
  } else if (spec === 'chara_card_v2') {
    if (!isPlainObject(value.data)) throw new Error('这是 CCv2 卡，但缺少 data 对象（卡片已损坏）')
    data = { ...value.data }
    warnings.push('这是 V2 卡（spec: chara_card_v2），已包成 V3 形状；character_book 结构兼容，原样带过来了')
  } else if (spec === '') {
    if (!isPlainObject(value.data)) {
      const legacyHints = ['basic', 'voice', 'personality', 'relationship', 'memory_anchor', 'dynamic_state']
      const looksLegacy = legacyHints.some(key => key in value)
      throw new Error(looksLegacy
        ? '这是本插件 v0.1 的旧格式卡（10 组中文键），不走导入通道：请放在 characters/ 目录里由迁移路径（normalizeCard）读入'
        : '这个 JSON 不是酒馆卡：顶层既没有 spec、也没有 data（CCv3/V2 都要 data 对象）')
    }
    data = { ...value.data }
    warnings.push('卡片缺 spec 字段，已按 V2 形状（data 对象）处理并补上 spec: chara_card_v3')
  } else {
    throw new Error(`不认识的卡片 spec：${spec}（本插件只认 chara_card_v3 / chara_card_v2）`)
  }

  // ---- 名字 ----
  const rawName = typeof data.name === 'string' ? data.name.trim() : ''
  if (rawName === '') {
    warnings.push('卡里没有名字（data.name 为空），需要用户在面板里补一个再保存')
  } else {
    data.name = rawName
  }

  // ---- assets：本插件不落地立绘，剥掉但记账 ----
  if (Array.isArray(data.assets)) {
    const count = data.assets.length
    if (count > 0) {
      warnings.push(`已忽略 ${count} 个 assets（本轮不做立绘落地，卡片其余内容不受影响）`)
    }
    delete data.assets
  }

  // ---- regex_scripts：muv 系的东西，明确不接，剥掉 ----
  if ('regex_scripts' in data) {
    delete data.regex_scripts
    warnings.push('已忽略 regex_scripts（本插件不执行酒馆的正则脚本，仅作提示）')
  }

  return {
    spec: 'chara_card_v3',
    // 只有本来就是 V3 的卡才信任它自带的 spec_version；V2/裸 data 一律改写成 3.0
    spec_version: isV3 && typeof value.spec_version === 'string' && value.spec_version.trim() !== ''
      ? value.spec_version
      : '3.0',
    data,
  }
}

// ---------------------------------------------------------------- 入口

/**
 * 把一份「可能是酒馆卡」的字节解析成 CCv3 结构。
 *
 * 判定顺序：**先看魔数**（PNG / ZIP），再看扩展名，最后兜底当 JSON 试——
 * 因为真实世界最常见的坑是「.png 其实是 charx」「.charx 其实是裸 json」。
 *
 * @param buf 文件字节。函数不会保留引用，需要的部分都复制出来。
 * @param fileName 仅用于**提示**（扩展名与魔数不符时给 warning），不参与格式判定。
 * @throws Error 中文、可操作、指出下一步该干什么。
 */
export function parseCardBuffer(buf: Buffer, fileName = ''): ParsedCardFile {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('文件是空的（0 字节），读不出卡片')
  }
  if (buf.length > IMPORT_LIMITS.maxBytes) {
    throw new Error(`文件过大（${mb(buf.length)}），上限 ${mb(IMPORT_LIMITS.maxBytes)}`)
  }

  const ext = extensionOf(fileName)
  const extensionSays = ext === '' ? '' : `.${ext}`

  if (isPng(buf)) {
    if (ext !== '' && ext !== 'png') {
      // 内容说了算，只提示
      const parsed = parsePng(buf)
      parsed.warnings.unshift(`扩展名是 ${extensionSays}，但文件内容其实是 PNG；已按 PNG 读`)
      return parsed
    }
    return parsePng(buf)
  }

  if (isZip(buf)) {
    const parsed = parseCharx(buf)
    if (ext !== '' && ext !== 'charx' && ext !== 'zip') {
      parsed.warnings.unshift(`扩展名是 ${extensionSays}，但文件内容其实是 ZIP/CHARX；已按 CHARX 读`)
    }
    return parsed
  }

  if (ext === 'png') {
    throw new Error('这个 .png 的签名不对（不是有效 PNG），也不是 ZIP/CHARX；文件可能损坏或根本不是图片')
  }
  if (ext === 'charx' || ext === 'zip') {
    throw new Error(`这个 .${ext} 的 ZIP 签名不对（不是有效 zip），也不是 PNG；文件可能损坏`)
  }

  // 兜底：当 JSON 试。文本类扩展名（json/txt/无扩展名）都走这里。
  //
  // 分开处理「读不出 JSON」与「读出了但不是卡」：后者自带可操作的中文报错（比如「这是本插件
  // v0.1 的旧格式卡，请走迁移路径」），再包一层「无法识别」只会把关键信息埋掉。
  const text = decodeUtf8(buf)
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `无法识别的文件${extensionSays === '' ? '' : `（扩展名 ${extensionSays}）`}：`
      + `既不是 PNG（签名不对）、也不是 ZIP/CHARX，按 JSON 也读不出来 —— ${describeJsonError(error, text)}`,
    )
  }
  const warnings: string[] = []
  const card = toCardV3(obj, 'json', warnings)
  return { card, format: 'json', warnings }
}
