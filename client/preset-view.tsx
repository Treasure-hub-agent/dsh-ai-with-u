/**
 * AI WITH U · 预设面板
 *
 * 「预设」是什么（这段也决定了所有文案口径）：
 * **一组可复用的提示词模块（文风 / 语气 / 越狱 / 回复规则），只描述「怎么说」，不写角色事实。**
 * 它和角色卡**正交**：同一套预设能换任意角色用，同一个角色也能切不同预设。
 * 角色卡负责「我是谁」，预设负责「我怎么说话」。
 *
 * 注入位置是独立段 `aiwu:preset`（order 5080：纪律包之后、角色设定之前），不进 L1、不进世界书。
 *
 * 为什么单独一个文件：这块是「列表 → 编辑 → 导入」三态的一整套面板，
 * 塞进 `index.tsx`（已经 3k 行）只会让那边更难读。外壳（Overlay / 遮罩 / 焦点）仍由
 * `index.tsx` 提供，这里只渲染 `.awu-dialog` 内部。
 *
 * 数据全部自取（与「注入预览」同款做法）：`/presets`、`/preset`、`/preset/*` 都容错调用，
 * 宿主没落地时显示「宿主侧尚未提供该能力」，而不是白屏。
 *
 * 与角色绑定**同构**的启用模型：会话预设 > 全局预设 > 无（会话命中但预设被删 → 视为无，
 * 不回落全局）。子代理固定用全局预设，不继承本会话。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import {
  activatePreset,
  deletePreset,
  errorText,
  fetchPreset,
  fetchPresets,
  importPreset,
  isUnavailable,
  savePreset,
} from './api'
import type { PresetActiveState, PresetDetail, PresetModule, PresetSummary } from './api'
import { FocusEditor } from './editor-focus'
import {
  IconAlert,
  IconBack,
  IconChevron,
  IconPlus,
  IconQuill,
  IconRefresh,
  IconTrash,
} from './icons'
import type { Translate } from './text'

/** 与设计稿对齐的上限（宿主也会拦；这里先就地提示，保存前再挡一道）。 */
export const PRESET_LIMITS = {
  /** 单模块正文字数上限（照 ST 的 MAX_CONTENT_CHARS） */
  moduleChars: 40_000,
  /** 模块数上限 */
  modules: 200,
} as const

/** 按码点数字数（emoji 不算两字），与其它模块同口径。 */
function countChars(text: string): number {
  return [...text].length
}

/**
 * 「重」的参考线（字符/轮）：**与宿主常量对齐（8000）**，只用于**视觉提示**。
 *
 * 真正「要不要拦你一道」的判断也不靠它猜——宿主 `activate` 会在 `warnings` 里给出带数字的原文，
 * 面板优先展示宿主那句；这个常量只负责列表/编辑页的警示色与「重」徽记。
 */
const PRESET_HEAVY_CHARS = 8000

/**
 * 未知宏扫描 —— **逐行镜像宿主 `src/preset.ts` 的 `scanUnsupportedMacros()`**
 * （2026-11-01 用 19 个宏样本收口后的口径；宿主那边有断言锁着，两边必须逐字同源）。
 *
 * 只看宏名不够，还要看**形态**：
 *   - `{{char}}` / `{{user}}`：**小写、无参数**才展开（`{{CHAR}}` 会原样留下）；
 *   - `{{random:A,B}}` / `{{pick:A,B}}`：**必须带 `:` 参数**（`{{random}}` 不展开）；
 *   - `{{roll:6}}` / `{{roll:1d6}}`：**必须带 `:` 参数**，宏名**大小写不敏感**（`{{Roll:6}}` 也展开）；
 *   - `{{comment: …}}`：**必须带冒号**、名字小写；`{{// …}}` 是注释族；
 *   - 其余一律当未知（`{{trim}}` / `{{setvar::x::y}}` / `{{getvar::x}}` / `{{newline}}` /
 *     `{{persona}}` / `{{original}}` / `{{CHAR}}` / `{{random}}` / `{{roll}}` / `{{comment}}`）。
 *
 * 为什么面板要自己扫一遍：导入预览发生在**落库之前**，此时只有客户端解析结果，
 * 宿主还没给 `unsupportedMacros`。落库后若宿主给了，以宿主为准（同口径，不会打架）。
 */

/** `{{…}}` 的通用提取（不含花括号，两侧空白剥掉）——与宿主 `MACRO_RE` 一致。 */
const MACRO_RE = /\{\{\s*([^{}]*?)\s*\}\}/gu

/** 从 `{{xxx:yyy}}` 里取宏名（`xxx`；注释类 `//` 原样当名字）——与宿主 `macroNameOf` 一致。 */
function macroNameOf(body: string): string {
  if (body.startsWith('//')) return '//'
  const match = /^([A-Za-z_][\w-]*)/u.exec(body.trim())
  return match?.[1] ?? ''
}

/** 这个 `{{…}}` 会不会真的被展开 —— 与宿主 `isExpandableMacro` 一致。 */
function isExpandableMacro(name: string, body: string): boolean {
  if (body.startsWith('//')) return true
  switch (name) {
    // 只认小写、无参数
    case 'char':
    case 'user':
      return true
    // 必须带参数（LIST_MACRO 要求 `:`）
    case 'random':
    case 'pick':
      return body.includes(':')
    // 注释：必须带冒号
    case 'comment':
      return /^comment\s*:/u.test(body)
    default:
      // roll 的正则带 i 标志：大小写都算，但必须是 `roll:N` / `roll:1dN`
      return /^roll\s*:\s*(?:1?d)?\d+$/iu.test(body)
  }
}

/**
 * 扫出**无法展开**的 ST 变量 → `宏名 → 次数`。
 *
 * 计数键是宏名（`{{setvar::x::y}}` → `setvar`，`{{CHAR}}` → `CHAR`），与宿主的 `unsupportedMacros` 同键。
 */
export function collectUnknownMacros(modules: PresetModule[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const module of modules) {
    const text = typeof module.content === 'string' ? module.content : ''
    if (text === '') continue
    for (const match of text.matchAll(MACRO_RE)) {
      const body = match[1] ?? ''
      const name = macroNameOf(body)
      // 取不到名字（`{{}}` 这种）不算宏，避免造出空键
      if (name === '' || isExpandableMacro(name, body)) continue
      counts[name] = (counts[name] ?? 0) + 1
    }
  }
  return counts
}

/** 把宏表压成一句人话里的一段：`{{persona}} ×12、{{original}} ×3 等 2 种`。 */
function macrosToText(macros: Record<string, number>, t: Translate, limit = 5): { total: number; text: string } {
  const rows = Object.entries(macros)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
  const total = rows.reduce((sum, [, count]) => sum + count, 0)
  const top = rows.slice(0, limit).map(([name, count]) => `{{${name}}} ×${count}`)
  const rest = rows.length - top.length
  const more = rest > 0 ? ` ${t('preset.macros.more', { n: rest })}` : ''
  return { total, text: `${top.join('、')}${more}` }
}

/** 启用判据：缺省视为启用（ST 的 prompt_order 里没写 enabled 就是开着的）。 */
function isEnabled(module: PresetModule): boolean {
  return module.enabled !== false
}

function enabledCountOf(modules: PresetModule[]): number {
  return modules.filter(isEnabled).length
}

function charsOf(modules: PresetModule[]): number {
  return modules.reduce((sum, module) => sum + countChars(module.content), 0)
}

/** 一行的显示名：没名字就给占位（与模块编辑框的空态一致）。 */
function moduleLabel(module: PresetModule, index: number, t: Translate): string {
  const name = module.name.trim()
  return name !== '' ? name : t('preset.issueUnnamed', { n: index + 1 })
}

/** 正文摘要：压掉换行后取前 N 个码点。 */
function excerpt(text: string, limit = 60): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  const chars = [...flat]
  return chars.length <= limit ? flat : `${chars.slice(0, limit).join('')}…`
}

// ---------------------------------------------------------------- ST 预设预览解析
//
// ⚠️ 这里**只用于「确认前预览」**，落库解析以宿主为准（宿主会回 warnings / dropped）。
// **判据与宿主 `src/preset.ts` 的 `convertStPreset()` 同源**：2026-11-01 拿本机 7 份真实 ST
// 聊天补全预设逐份核对过（`SillyBunny\data\default-user\OpenAI Settings\` 下 Default / Geechan / Pura 等），
// 客户端这份必须跟着宿主走，否则会出现「预览 5 条、落库后 4 条」。
//
// 真原件字段表（7 份一致）：
//  1. `enabled` 在 `prompt_order[].order[i].enabled`，**不在 prompt 对象上**（偶尔有也以 order 为准）；
//  2. `prompt_order` 可能多份（`character_id` 100000 单聊 / 100001 群聊）→ **取 order 条目最多的那份**；
//  3. 条目两种形态：`{identifier, marker, name, system_prompt}`（结构占位）与
//     `{identifier, name, content, role, injection_position, ...}`（有正文）。
//     **`marker: true` 不等于占位**：`nsfw` / `jailbreak` / `enhanceDefinitions` 都带 marker，
//     但它们是有正文的真实模块，必须保留；只有白名单里的 id/名字才是占位。
//  4. 占位按 **identifier/名字白名单**判，不按 marker 一刀切；
//  5. 非正文：只有注释 / 只有宏与标签 / 空内容 / 纯分隔线 / 废稿 / `SPreset` 配置块 / 巨型 JS 块；
//  6. `injection_position === 1` = ST 的 @D 深度注入，本插件没有对应通道 → 并入系统提示并告警；
//  7. `role !== 'system'`（user / assistant）→ 保留但汇总告警（我们只有系统提示段，语义会变）。

/**
 * 结构占位 id —— **与宿主 `ST_STRUCTURAL_IDS` 逐字同源（13 个）**。
 *
 * 这些位置由 ST 运行时填（角色描述、聊天记录、世界书前后……），搬过来只是空标签。
 * **不要按 `marker: true` 一刀切**：nsfw / jailbreak / enhanceDefinitions 也带 marker，
 * 但它们有正文，必须保留（Default.json 实测）。
 *
 * 为什么 `main` 也丢（2026-11-01 定稿，别改回去）：它是 ST 自家的**系统主指令**，
 * 而本插件已经有 L0（角色扮演底线）+ L0.5（纪律包）承担同一职责。搬进来等于**双份注入同义指令**：
 * 既费 token，又容易被模型当成两套规则互相打架。所以宁可丢，让底线只有一份。
 */
const ST_PLACEHOLDERS = new Set([
  'worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality', 'personaDescription',
  'scenario', 'dialogueExamples', 'chatHistory', 'char', '/char', 'main', 'SPresetSettings', 'version_info',
])

/** 丢弃原因码（UI 负责翻译；与宿主的中文原因一一对应，只是换了本地化出口）。 */
type DropReason =
  | 'placeholder' | 'divider' | 'draft' | 'spreset' | 'empty' | 'comment'
  | 'titleOnly' | 'noname' | 'notFound' | 'jsblock' | 'duplicate'

/** 本端解析产出的原因码集合；宿主给的是中文句子，不在这个集合里就原样显示。 */
const DROP_REASONS = new Set<string>([
  'placeholder', 'divider', 'draft', 'spreset', 'empty', 'comment',
  'titleOnly', 'noname', 'notFound', 'jsblock', 'duplicate',
])

/** 名字层面的丢弃规则 —— 与宿主 `ST_DROP_NAME_RES` 同源（各预设作者的约定，跨卡通用）。 */
const ST_DROP_NAME_RULES: Array<{ re: RegExp; reason: DropReason }> = [
  { re: /^----/u, reason: 'divider' },
  { re: /^世界书设定捏$/u, reason: 'titleOnly' },
  { re: /废稿/u, reason: 'draft' },
  { re: /^SPreset/iu, reason: 'spreset' },
]

interface DroppedModule {
  name: string
  reason: DropReason | string
}

export interface PresetPreview {
  name: string
  modules: PresetModule[]
  dropped: DroppedModule[]
  /** 客户端解析出的提示（注入位置 / role / 上限等）；宿主解析后的提示会另外合并进来 */
  warnings: string[]
  /** 无法展开的 ST 变量（预览用；落库后以宿主的 `unsupportedMacros` 为准） */
  unknownMacros: Record<string, number>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 从 ST 的 `prompt_order` 里挑 `order` 条目最多的那一份（与宿主同一判据）。 */
function pickOrderBlock(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  const blocks = asList(raw['prompt_order']).filter(isRecord)
  let best: Array<Record<string, unknown>> = []
  for (const block of blocks) {
    const rows = asList(block['order']).filter(isRecord)
    if (rows.length > best.length) best = rows
  }
  // 兼容「没有 order 外壳、直接给行」的野生写法
  if (best.length === 0) {
    const flat = blocks.filter(block => typeof block['identifier'] === 'string')
    if (flat.length > 0) best = flat
  }
  return best
}

/** 整条只有 `{{// … }}` 注释 → 空串；夹在正文里的只剥注释本身（与宿主 `stripStComments` 同源）。 */
function stripStComments(text: string): string {
  const whole = /^\s*\{\{\/\/\s*([\s\S]*?)\}\}\s*$/u.exec(text)
  if (whole !== null) return ''
  return text.replace(/\{\{\/\/[\s\S]*?\}\}/gu, '')
}

/** 去掉注释 / 宏 / 标签后是否还有实际文字（与宿主 `hasRealText` 同源）。 */
function hasRealText(text: string): boolean {
  const stripped = stripStComments(text)
    .replace(/\{\{[^{}]*\}\}/gu, '')
    .replace(/<\/?[a-zA-Z][^>]*>/gu, '')
    .trim()
  return stripped.length > 0
}

/** 单个模块的字数上限（与 `PRESET_LIMITS.moduleChars` 同源）。 */
const MODULE_CHAR_LIMIT = 40_000
/** 模块数上限（与 `PRESET_LIMITS.modules` 同源）。 */
const MODULE_COUNT_LIMIT = 200

/**
 * 解析一份 ST 预设 JSON（或本插件自己的预设形状）→ 预览数据。
 *
 * 解析不出任何可用模块时抛错（UI 显示错误原文，不压成「导入失败」）。
 */
export function parsePresetJson(raw: unknown, t: Translate): PresetPreview {
  if (!isRecord(raw)) throw new Error(t('preset.import.nothing'))

  // ① 已经是「预设形状」（宿主导出 / 面板自己存的）：直接照搬
  if (Array.isArray(raw['modules'])) {
    const modules: PresetModule[] = asList(raw['modules']).filter(isRecord).map(item => ({
      name: asText(item['name']),
      content: asText(item['content']),
      enabled: item['enabled'] !== false,
    }))
    if (modules.length === 0) throw new Error(t('preset.import.nothing'))
    return { name: asText(raw['name']), modules, dropped: [], warnings: [], unknownMacros: collectUnknownMacros(modules) }
  }

  // ② ST 形状：prompts + prompt_order
  const prompts = asList(raw['prompts']).filter(isRecord)
  const picked = pickOrderBlock(raw)
  const usedOrder = picked.length > 0
  // 没有 prompt_order（野生导出）：按 prompts 原顺序，enabled 取自条目自身
  const order: Array<Record<string, unknown>> = usedOrder
    ? picked
    : prompts.map(prompt => ({ identifier: asText(prompt['identifier']), enabled: prompt['enabled'] !== false }))

  const dropped: DroppedModule[] = []
  const warnings: string[] = []
  const modules: PresetModule[] = []

  /** identifier / name 两套索引：ST 用 identifier 关联，但野生导出偶尔只给 name。 */
  const byIdentifier = new Map<string, Record<string, unknown>>()
  const byName = new Map<string, Record<string, unknown>>()
  for (const prompt of prompts) {
    const identifier = asText(prompt['identifier'])
    if (identifier !== '') byIdentifier.set(identifier, prompt)
    const name = asText(prompt['name'])
    if (name !== '') byName.set(name, prompt)
  }

  let injectPositionOne = 0
  let nonSystemRole = 0
  /** 同名同内容去重（ST 里偶有重复条目） */
  const seen = new Set<string>()
  const nameCount = new Map<string, number>()

  for (const row of order) {
    const identifier = asText(row['identifier'])
    const prompt = byIdentifier.get(identifier) ?? byName.get(identifier)
    if (prompt === undefined) { dropped.push({ name: identifier, reason: 'notFound' }); continue }

    const ident = asText(prompt['identifier'])
    const rawName = asText(prompt['name']).trim()
    if (rawName === '') { dropped.push({ name: ident, reason: 'noname' }); continue }

    // ② 结构占位：**白名单式**（id 或名字命中都算），绝不按 marker 一刀切
    if (ST_PLACEHOLDERS.has(ident) || ST_PLACEHOLDERS.has(rawName)) {
      dropped.push({ name: rawName, reason: 'placeholder' })
      continue
    }
    // ③ 名字层面的非正文约定
    const nameRule = ST_DROP_NAME_RULES.find(rule => rule.re.test(rawName))
    if (nameRule !== undefined) { dropped.push({ name: rawName, reason: nameRule.reason }); continue }

    // ④ 正文
    // 空正文继续丢（同日定稿）：它没有可注入内容。保留成「开着」是隐患；
    // 保留成「关着」又会让 Pura 那种 47 条预设多出 27 个空壳——正是主人最讨厌的面板噪声。
    let content = asText(prompt['content'])
    if (!hasRealText(content)) { dropped.push({ name: rawName, reason: 'empty' }); continue }
    // 巨型且像 JS 配置块（SPreset 一类变体）：不是提示词
    if (countChars(content) > MODULE_CHAR_LIMIT && /^\s*[[{]|function\s|=>/u.test(content.slice(0, 400))) {
      dropped.push({ name: rawName, reason: 'jsblock' })
      continue
    }
    content = stripStComments(content).trim()
    if (content === '') { dropped.push({ name: rawName, reason: 'comment' }); continue }

    // ⑤ 启停只看 prompt_order 的 enabled；未启用保留为 enabled:false（面板可再开）
    const enabled = row['enabled'] !== false
    if (prompt['injection_position'] === 1 || prompt['injectionPosition'] === 1) injectPositionOne += 1
    const role = asText(prompt['role']).trim().toLowerCase()
    if (role !== '' && role !== 'system') nonSystemRole += 1

    // ⑥ 去重 + 重名编号（与宿主一致）
    const key = `${rawName}\u0000${content}`
    if (seen.has(key)) { dropped.push({ name: rawName, reason: 'duplicate' }); continue }
    seen.add(key)
    const used = nameCount.get(rawName) ?? 0
    nameCount.set(rawName, used + 1)
    const moduleName = used === 0 ? rawName : `${rawName} (${used + 1})`

    modules.push({ name: moduleName, content, enabled })
    if (modules.length >= MODULE_COUNT_LIMIT) {
      warnings.push(t('preset.import.warn.cap', { max: MODULE_COUNT_LIMIT }))
      break
    }
  }

  if (!usedOrder) warnings.push(t('preset.import.noOrder'))
  if (injectPositionOne > 0) warnings.push(t('preset.import.warn.inject', { n: injectPositionOne }))
  if (nonSystemRole > 0) warnings.push(t('preset.import.warn.role', { n: nonSystemRole }))
  if (modules.length === 0) throw new Error(t('preset.import.nothing'))
  // 名字回退与宿主一致：raw.name → raw.title（真 ST 导出只有 prompts，没有顶层名字）
  return { name: asText(raw['name']) || asText(raw['title']), modules, dropped, warnings, unknownMacros: collectUnknownMacros(modules) }
}

// ---------------------------------------------------------------- 面板

export interface PresetPanelProps {
  t: Translate
  /** 当前会话 id；空串 = 宿主没给 → 禁用「当前会话使用」（绝不编一个 id 写进去） */
  sessionId: string
  /** 任何改动（保存 / 删除 / 启用 / 导入）之后通知外壳刷新总览 */
  onChanged: () => void
  onClose: () => void
}

type View = 'list' | 'edit' | 'import'

export function PresetPanel(props: PresetPanelProps): JSX.Element {
  const { t, sessionId, onChanged, onClose } = props

  const [view, setView] = useState<View>('list')
  const [list, setList] = useState<PresetSummary[]>([])
  const [active, setActive] = useState<PresetActiveState>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 宿主还没提供预设接口：与「请求失败」分开，别一片红字 */
  const [unavailable, setUnavailable] = useState(false)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | undefined>(undefined)

  /** 正在编辑的预设（`undefined` = 还没读到 / 新建中） */
  const [detail, setDetail] = useState<PresetDetail | undefined>(undefined)
  const [editLoading, setEditLoading] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  /** 删除预设的二次确认（第一下只是亮红，第二下才真删） */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /**
   * 「这个预设很重」的内联确认（**不是全屏弹层**）：点「使用」时不立刻启用，先在这里问一句。
   * `hostText` 是宿主 `activate` 返回过的 warning 原文（单一真源），有就优先展示。
   */
  const [heavyPending, setHeavyPending] = useState<{ scope: 'session' | 'global'; id: string; chars: number; hostText?: string } | undefined>(undefined)
  /** 宿主上次给过的重量提示原文（按 preset id 缓存，下次点「使用」直接用它） */
  const heavyTextRef = useRef<Record<string, string>>({})

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const loadList = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    setUnavailable(false)
    try {
      const result = await fetchPresets()
      if (!aliveRef.current) return
      setList(Array.isArray(result.presets) ? result.presets : [])
      setActive(isRecord(result.active) ? result.active : {})
    } catch (e) {
      if (!aliveRef.current) return
      if (isUnavailable(e)) setUnavailable(true)
      else setError(t('preset.loadFailed', { reason: errorText(e) }))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => { void loadList() }, [loadList])

  const showNotice = useCallback((text: string, tone: 'ok' | 'warn' = 'ok'): void => {
    setNotice({ text, tone })
    // 面板内的轻提示：不抢注意力，成功 6 秒自动走，警告留到下次操作
    if (tone === 'ok') {
      window.setTimeout(() => { if (aliveRef.current) setNotice(current => (current?.text === text ? undefined : current)) }, 6000)
    }
  }, [])

  /** 会话绑定 / 全局的命中判断（与角色绑定同一套语言：本会话 > 全局）。 */
  const sessionPresetId = sessionId !== '' ? (active.sessions?.[sessionId] ?? '') : ''
  const globalPresetId = active.global ?? ''

  /** 打开一份预设进入编辑（自取正文：列表里只有计数，没有正文）。 */
  const openPreset = useCallback((id: string): void => {
    setView('edit')
    setConfirmDelete(false)
    setHeavyPending(undefined)
    setEditLoading(true)
    setError('')
    setDetail(undefined)
    void fetchPreset(id)
      .then(result => {
        if (!aliveRef.current) return
        setDetail({
          id: result.preset.id,
          name: result.preset.name,
          source: result.preset.source,
          modules: result.preset.modules.map(module => ({
            name: asText(module.name),
            content: asText(module.content),
            enabled: module.enabled !== false,
          })),
        })
        setActive(isRecord(result.active) ? result.active : {})
      })
      .catch((e: unknown) => {
        if (!aliveRef.current) return
        if (isUnavailable(e)) setUnavailable(true)
        else setError(t('preset.loadFailed', { reason: errorText(e) }))
      })
      .finally(() => { if (aliveRef.current) setEditLoading(false) })
  }, [t])

  /** 新建：空白草稿（不落盘，保存时才写）。 */
  const startNew = (): void => {
    setView('edit')
    setConfirmDelete(false)
    setHeavyPending(undefined)
    setDetail({ id: '', name: '', source: 'custom', modules: [] })
    setError('')
    setEditLoading(false)
  }

  const refreshAll = useCallback((nextActive?: PresetActiveState): void => {
    void loadList()
    if (nextActive !== undefined) setActive(nextActive)
    onChanged()
  }, [loadList, onChanged])

  // ------------------------------------------------------------ 列表
  if (view === 'list') {
    return (
      <>
        <div className="awu-dialogHead">
          <IconQuill size={16} />
          <span>{t('preset.title')}</span>
          <button
            type="button"
            className="awu-iconBtn"
            style={{ marginLeft: 'auto' }}
            title={t('preset.refresh')}
            aria-label={t('preset.refresh')}
            data-spin={loading ? 'true' : 'false'}
            onClick={() => { void loadList() }}
            disabled={loading}
          >
            <IconRefresh size={14} />
          </button>
        </div>

        <div className="awu-dialogBody">
          <div className="awu-hint" style={{ marginBottom: 10 }}>{t('preset.hint')}</div>

          {notice !== undefined && (
            <div className="awu-status awu-idle" data-status={notice.tone === 'warn' ? 'warn' : 'info'} role="status" style={{ marginBottom: 10 }}>
              <span className="awu-idleDot" aria-hidden="true" />
              <span className="awu-noticeText">{notice.text}</span>
            </div>
          )}

          {unavailable && <div className="awu-hint" data-tone="warn">{t('preset.unavailable')}</div>}
          {error !== '' && (
            <div className="awu-err" role="alert">
              <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
              <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
            </div>
          )}

          {loading && list.length === 0 && <div className="awu-hint" role="status">{t('preset.loading')}</div>}

          {!loading && error === '' && list.length === 0 && (
            <div className="awu-empty" data-kind="empty">
              <span className="awu-emptyMark"><IconQuill size={20} /></span>
              <span className="awu-emptyHint">{t('preset.empty')}</span>
            </div>
          )}

          {list.length > 0 && (
            <div className="awu-loreList">
              {list.map(item => {
                const hereSession = sessionPresetId === item.id
                const hereGlobal = globalPresetId === item.id
                return (
                  <button
                    type="button"
                    className="awu-loreRow awu-presetRow"
                    key={item.id}
                    data-enabled="true"
                    onClick={() => openPreset(item.id)}
                  >
                    <span className="awu-loreRowTitleWrap">
                      <span className="awu-loreRowTitle">{item.name !== '' ? item.name : item.id}</span>
                      {hereSession && <span className="awu-pill" data-tone="live">{t('preset.badge.session')}</span>}
                      {hereGlobal && !hereSession && <span className="awu-pill" data-tone="teal">{t('preset.badge.global')}</span>}
                    </span>
                    <span className="awu-presetMeta">
                      {t('preset.modules', { n: item.moduleCount })}
                      {' · '}
                      {t('preset.moduleRatio', { on: item.enabledCount, total: item.moduleCount })}
                      {' · '}
                      {item.source === 'st' ? t('preset.source.st') : t('preset.source.custom')}
                      {/* 体积：宿主给了才显示（老宿主没这个字段，面板不显示也不猜） */}
                      {item.chars !== undefined && (
                        <span
                          className="awu-presetChars"
                          data-heavy={item.chars > PRESET_HEAVY_CHARS ? 'true' : 'false'}
                          title={t('preset.charsPerTurn', { n: item.chars })}
                        >
                          {' · '}
                          {t('preset.charsApprox', { n: item.chars })}
                          {item.chars > PRESET_HEAVY_CHARS && (
                            <em className="awu-presetHeavy">{t('preset.heavy')}</em>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="awu-loreRowActions">
                      <span className="awu-loreRowBtn" aria-hidden="true"><IconChevron size={12} /></span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="awu-dialogFoot">
          <button type="button" className="awu-btn" onClick={onClose}>{t('common.close')}</button>
          <button type="button" className="awu-btn" onClick={() => { setView('import'); setError('') }}>
            {t('preset.import')}
          </button>
          <button type="button" className="awu-btn" data-kind="primary" onClick={startNew}>
            <IconPlus size={12} />
            {t('preset.new')}
          </button>
        </div>
      </>
    )
  }

  // ------------------------------------------------------------ 编辑
  if (view === 'edit') {
    const modules = detail?.modules ?? []
    const chars = charsOf(modules)
    const enabled = enabledCountOf(modules)
    const moduleOver = modules.some(module => countChars(module.content) > PRESET_LIMITS.moduleChars)
    const countOver = modules.length > PRESET_LIMITS.modules
    const tooLong = modules
      .map((module, index) => ({ module, index }))
      .filter(({ module }) => countChars(module.content) > PRESET_LIMITS.moduleChars)

    const patchModule = (index: number, patch: Partial<PresetModule>): void => {
      setDetail(current => {
        if (current === undefined) return current
        const next = current.modules.map((module, i) => (i === index ? { ...module, ...patch } : module))
        return { ...current, modules: next }
      })
    }
    const moveModule = (index: number, delta: -1 | 1): void => {
      setDetail(current => {
        if (current === undefined) return current
        const target = index + delta
        if (target < 0 || target >= current.modules.length) return current
        const next = [...current.modules]
        const a = next[index]
        const b = next[target]
        if (a === undefined || b === undefined) return current
        next[index] = b
        next[target] = a
        return { ...current, modules: next }
      })
    }
    const addModule = (): void => {
      setDetail(current => {
        if (current === undefined) return current
        return { ...current, modules: [...current.modules, { name: '', content: '', enabled: true }] }
      })
      // 新模块直接全屏编辑：空模块没有内容可看
      setFocusIndex(modules.length)
    }
    const removeModule = (index: number): void => {
      setDetail(current => {
        if (current === undefined) return current
        return { ...current, modules: current.modules.filter((_, i) => i !== index) }
      })
    }

    /** 保存：本地先挡上限，再落库，最后**回读校验**模块数与启用数（防假成功）。 */
    const save = (): void => {
      if (detail === undefined) return
      if (detail.name.trim() === '') { setError(t('preset.editor.saveFailed', { reason: t('preset.editor.nameRequired') })); return }
      if (countOver) { setError(t('preset.editor.limitCount', { n: modules.length, max: PRESET_LIMITS.modules })); return }
      if (moduleOver) {
        const first = tooLong[0]
        setError(t('preset.editor.limitModule', {
          name: first === undefined ? '' : moduleLabel(first.module, first.index, t),
          chars: first === undefined ? 0 : countChars(first.module.content),
          max: PRESET_LIMITS.moduleChars,
        }))
        return
      }
      setError('')
      setEditLoading(true)
      const payload = {
        ...(detail.id !== '' ? { id: detail.id } : {}),
        name: detail.name.trim(),
        modules: modules.map(module => ({ name: module.name, content: module.content, enabled: isEnabled(module) })),
      }
      void savePreset(payload)
        .then(saved => {
          if (!aliveRef.current) return
          const savedId = saved.preset.id
          return fetchPreset(savedId).then(fresh => {
            if (!aliveRef.current) return
            const backModules = fresh.preset.modules.length
            const backEnabled = enabledCountOf(fresh.preset.modules.map(module => ({
              name: asText(module.name),
              content: asText(module.content),
              enabled: module.enabled !== false,
            })))
            if (backModules !== modules.length || backEnabled !== enabled) {
              setError(t('preset.editor.mismatch', { expect: `${modules.length}/${enabled}`, actual: `${backModules}/${backEnabled}` }))
              return
            }
            setDetail({
              id: savedId,
              name: fresh.preset.name,
              source: fresh.preset.source,
              modules: fresh.preset.modules.map(module => ({
                name: asText(module.name),
                content: asText(module.content),
                enabled: module.enabled !== false,
              })),
            })
            showNotice(t('preset.editor.saved', { modules: backModules }), 'ok')
            refreshAll()
          })
        })
        .catch((e: unknown) => {
          if (!aliveRef.current) return
          if (isUnavailable(e)) setUnavailable(true)
          else setError(t('preset.editor.saveFailed', { reason: errorText(e) }))
        })
        .finally(() => { if (aliveRef.current) setEditLoading(false) })
    }

    /** 当前这份预设启用后的字符/轮（宿主 `chars` 优先；没有就按 enabled 口径本地算，**停用模块不算**）。 */
    const perTurnChars = detail !== undefined && detail.chars !== undefined
      ? detail.chars
      : modules.filter(isEnabled).reduce((sum, module) => sum + countChars(module.content), 0)
    const heavy = perTurnChars > PRESET_HEAVY_CHARS

    /** 真正发启用请求（重量确认之后才走这里）。 */
    const requestActivate = (scope: 'session' | 'global', id: string | undefined): void => {
      if (scope === 'session' && sessionId === '') { showNotice(t('preset.noSession'), 'warn'); return }
      setHeavyPending(undefined)
      setEditLoading(true)
      setError('')
      void activatePreset({
        ...(id !== undefined ? { id } : {}),
        scope,
        ...(scope === 'session' ? { sessionId } : {}),
      })
        .then(result => {
          if (!aliveRef.current) return
          setActive(isRecord(result.active) ? result.active : {})
          const chars = result.chars ?? perTurnChars
          const hostWarnings = Array.isArray(result.warnings) ? result.warnings.filter(w => typeof w === 'string' && w !== '') : []
          // 宿主给过重量提示就记住：下次点「使用」时优先用它（单一真源）
          if (id !== undefined && hostWarnings.length > 0) heavyTextRef.current[id] = hostWarnings[0]
          if (id === undefined) {
            showNotice(t('preset.done.none'), 'ok')
          } else if (hostWarnings.length > 0) {
            showNotice(hostWarnings.join('；'), 'warn')
          } else {
            showNotice(
              `${t(scope === 'session' ? 'preset.done.session' : 'preset.done.global', { name: detail?.name ?? '' })} · ${t('preset.charsPerTurn', { n: chars })}`,
              'ok',
            )
          }
          refreshAll(isRecord(result.active) ? result.active : {})
        })
        .catch((e: unknown) => {
          if (!aliveRef.current) return
          if (isUnavailable(e)) setUnavailable(true)
          else setError(errorText(e))
        })
        .finally(() => { if (aliveRef.current) setEditLoading(false) })
    }

    /**
     * 启用 / 关闭：与本会话绑定同构（会话 > 全局 > 无）。
     *
     * 重量门槛（只对「启用某份预设」）：`chars` 超参考线时先出**一行内联确认**，
     * 文案优先用宿主上次给的 warning 原文（含真实数字），没有才退回本地那句。
     */
    const activate = (scope: 'session' | 'global', id: string | undefined): void => {
      if (scope === 'session' && sessionId === '') { showNotice(t('preset.noSession'), 'warn'); return }
      if (id !== undefined && heavy) {
        setHeavyPending({ scope, id, chars: perTurnChars, ...(heavyTextRef.current[id] !== undefined ? { hostText: heavyTextRef.current[id] } : {}) })
        return
      }
      requestActivate(scope, id)
    }

    const removePreset = (): void => {
      if (detail === undefined || detail.id === '') return
      setEditLoading(true)
      void deletePreset(detail.id)
        .then(() => {
          if (!aliveRef.current) return
          showNotice(t('preset.editor.deleted'), 'ok')
          setView('list')
          setDetail(undefined)
          refreshAll()
        })
        .catch((e: unknown) => {
          if (!aliveRef.current) return
          if (isUnavailable(e)) setUnavailable(true)
          else setError(errorText(e))
        })
        .finally(() => { if (aliveRef.current) setEditLoading(false) })
    }

    const sessionHere = detail !== undefined && detail.id !== '' && sessionPresetId === detail.id
    const globalHere = detail !== undefined && detail.id !== '' && globalPresetId === detail.id
    const focusModule = focusIndex >= 0 ? modules[focusIndex] : undefined

    return (
      <>
        <div className="awu-dialogHead">
          <button
            type="button"
            className="awu-navBack"
            onClick={() => { setView('list'); setDetail(undefined); setFocusIndex(-1) }}
          >
            <IconBack size={13} />
            <span>{t('preset.title')}</span>
          </button>
          <span className="awu-count" style={{ marginLeft: 'auto', fontFamily: 'var(--awu-mono)', fontSize: 10.5 }}>
            {t('preset.editor.stats', { modules: modules.length, chars })}
          </span>
        </div>

        <div className="awu-dialogBody">
          {notice !== undefined && (
            <div className="awu-status awu-idle" data-status={notice.tone === 'warn' ? 'warn' : 'info'} role="status" style={{ marginBottom: 10 }}>
              <span className="awu-idleDot" aria-hidden="true" />
              <span className="awu-noticeText">{notice.text}</span>
            </div>
          )}
          {unavailable && <div className="awu-hint" data-tone="warn" style={{ marginBottom: 10 }}>{t('preset.unavailable')}</div>}
          {error !== '' && (
            <div className="awu-err" role="alert" style={{ marginBottom: 10 }}>
              <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
              <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
            </div>
          )}

          <label className="awu-label" htmlFor="awu-preset-name">{t('preset.editor.name')}</label>
          <input
            id="awu-preset-name"
            className="awu-input"
            value={detail?.name ?? ''}
            maxLength={40}
            placeholder={t('preset.editor.namePlaceholder')}
            onChange={event => {
              const next = event.target.value
              setDetail(current => (current === undefined ? current : { ...current, name: next }))
            }}
            disabled={editLoading || detail === undefined}
          />

          {/* 注入体积：启用后每轮真实占用（宿主 `chars` 优先；没有就按 enabled 口径本地算） */}
          <div className="awu-presetWeight" data-heavy={heavy ? 'true' : 'false'}>
            {t('preset.charsPerTurn', { n: perTurnChars })}
            {heavy && <em className="awu-presetHeavy">{t('preset.heavy')}</em>}
          </div>

          {/* 正交说明：预设不写人设，别让用户以为要在这里填角色事实 */}
          <div className="awu-hint" style={{ marginTop: 10 }}>{t('preset.hint')}</div>

          {/* 上限就地提示（不拦输入，保存前挡） */}
          {moduleOver && (
            <div className="awu-hint" data-tone="warn" style={{ marginTop: 8 }}>
              {t('preset.editor.limitModule', {
                name: moduleLabel(tooLong[0]?.module ?? { name: '', content: '', enabled: true }, tooLong[0]?.index ?? 0, t),
                chars: tooLong[0] === undefined ? 0 : countChars(tooLong[0].module.content),
                max: PRESET_LIMITS.moduleChars,
              })}
            </div>
          )}
          {countOver && (
            <div className="awu-hint" data-tone="warn" style={{ marginTop: 8 }}>
              {t('preset.editor.limitCount', { n: modules.length, max: PRESET_LIMITS.modules })}
            </div>
          )}

          {/* 启用（两态 + 不使用）：与角色绑定的 UI 语言一致 */}
          <div className="awu-presetUse">
            <div className="awu-presetUseBtns">
              <button
                type="button"
                className="awu-btn"
                data-size="sm"
                data-kind={sessionHere ? 'primary' : undefined}
                onClick={() => activate('session', detail?.id)}
                disabled={editLoading || detail === undefined || detail.id === '' || sessionId === '' || sessionHere}
              >
                {t('preset.use.session')}
              </button>
              <button
                type="button"
                className="awu-btn"
                data-size="sm"
                data-kind={globalHere ? 'primary' : undefined}
                onClick={() => activate('global', detail?.id)}
                disabled={editLoading || detail === undefined || detail.id === '' || globalHere}
              >
                {t('preset.use.global')}
              </button>
              <button
                type="button"
                className="awu-btn"
                data-size="sm"
                data-kind="ghost"
                onClick={() => {
                  // 「不使用」= 把这个预设从它所在的作用域撤掉（会话优先，其次全局）
                  if (sessionHere) activate('session', undefined)
                  else if (globalHere) activate('global', undefined)
                }}
                disabled={editLoading || (!sessionHere && !globalHere)}
              >
                {t('preset.use.none')}
              </button>
            </div>
            {/*
              重量确认：**内联一行**，不弹全屏层。
              文案优先用宿主 `activate` 给过的 warning 原文（含真实数字），没有才用本地那句。
            */}
            {heavyPending !== undefined && (
              <div className="awu-presetHeavyConfirm" role="alert">
                <span className="awu-presetHeavyText">
                  {heavyPending.hostText ?? t('preset.heavy.confirm', { n: heavyPending.chars })}
                </span>
                <span className="awu-presetHeavyActions">
                  <button
                    type="button"
                    className="awu-btn"
                    data-size="sm"
                    onClick={() => setHeavyPending(undefined)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="awu-btn"
                    data-size="sm"
                    data-kind="primary"
                    onClick={() => requestActivate(heavyPending.scope, heavyPending.id)}
                  >
                    {t('preset.heavy.confirmYes')}
                  </button>
                </span>
              </div>
            )}

            {/* 边界提示常显（不塞 tooltip）：与角色绑定同一套措辞 */}
            <div className="awu-bindHint">
              <b>{t('preset.use.session')}</b>
              <span>{sessionId === '' ? t('preset.noSession') : t('preset.hint.session')}</span>
            </div>
            <div className="awu-bindHint">
              <b>{t('preset.use.global')}</b>
              <span>{t('preset.hint.global')}</span>
            </div>
            <div className="awu-bindHint" data-muted="true">
              <span>{t('preset.hint.subagent')}</span>
            </div>
          </div>

          {/* 模块列表 */}
          <div className="awu-presetModules">
            {modules.length === 0 ? (
              <div className="awu-editListEmpty">{t('preset.editor.empty')}</div>
            ) : (
              modules.map((module, index) => (
                <div className="awu-presetModule" key={index} data-enabled={isEnabled(module) ? 'true' : 'false'}>
                  <div className="awu-presetModuleHead">
                    <label className="awu-switchRow" style={{ minHeight: 24 }}>
                      <input
                        type="checkbox"
                        checked={isEnabled(module)}
                        aria-label={t('preset.editor.enabled')}
                        onChange={event => patchModule(index, { enabled: event.target.checked })}
                      />
                    </label>
                    <input
                      className="awu-input awu-editInput awu-presetModuleName"
                      value={module.name}
                      placeholder={t('preset.editor.moduleNamePlaceholder')}
                      aria-label={`${t('preset.editor.moduleName')} ${index + 1}`}
                      onChange={event => patchModule(index, { name: event.target.value })}
                    />
                    <span className="awu-presetModuleChars">{t('edit.chars', { n: countChars(module.content) })}</span>
                    <button
                      type="button"
                      className="awu-loreRowBtn"
                      disabled={index === 0}
                      title={t('preset.editor.moveUp')}
                      aria-label={`${t('preset.editor.moveUp')}：${moduleLabel(module, index, t)}`}
                      onClick={() => moveModule(index, -1)}
                    >
                      <IconChevron size={12} style={{ transform: 'rotate(-90deg)' }} />
                    </button>
                    <button
                      type="button"
                      className="awu-loreRowBtn"
                      disabled={index >= modules.length - 1}
                      title={t('preset.editor.moveDown')}
                      aria-label={`${t('preset.editor.moveDown')}：${moduleLabel(module, index, t)}`}
                      onClick={() => moveModule(index, 1)}
                    >
                      <IconChevron size={12} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <button
                      type="button"
                      className="awu-loreRowBtn"
                      title={t('preset.editor.deleteModule')}
                      aria-label={`${t('preset.editor.deleteModule')}：${moduleLabel(module, index, t)}`}
                      onClick={() => removeModule(index)}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                  {/* 正文：列表里只给摘要，长文本走全屏编辑器（本地缓冲，关层才提交） */}
                  <button
                    type="button"
                    className="awu-presetModuleBody"
                    onClick={() => setFocusIndex(index)}
                    title={t('preset.editor.editBody')}
                  >
                    {module.content.trim() === '' ? t('preset.editor.bodyPlaceholder') : excerpt(module.content)}
                  </button>
                </div>
              ))
            )}
            <button type="button" className="awu-editAdd" onClick={addModule} disabled={editLoading || detail === undefined}>
              <IconPlus size={11} />
              {t('preset.editor.addModule')}
            </button>
          </div>
        </div>

        <div className="awu-dialogFoot">
          {detail !== undefined && detail.id !== '' && (
            <>
              {confirmDelete && (
                <span className="awu-hint" data-tone="warn" style={{ marginRight: 'auto' }}>
                  {t('preset.editor.deleteConfirm', { name: detail.name })}
                </span>
              )}
              <button
                type="button"
                className="awu-btn"
                data-kind="danger"
                data-size="sm"
                onClick={() => {
                  if (!confirmDelete) { setConfirmDelete(true); return }
                  removePreset()
                }}
                disabled={editLoading}
                title={t('preset.editor.deleteConfirm', { name: detail.name })}
              >
                <IconTrash size={12} />
                {confirmDelete ? t('preset.editor.deleteConfirmYes') : t('preset.editor.delete')}
              </button>
            </>
          )}
          <button type="button" className="awu-btn" onClick={onClose}>{t('common.close')}</button>
          <button
            type="button"
            className="awu-btn"
            data-kind="primary"
            onClick={save}
            disabled={editLoading || detail === undefined}
          >
            {editLoading ? t('common.busy') : t('preset.editor.save')}
          </button>
        </div>

        {/* 全屏正文编辑：复用 editor-focus（本地缓冲 + 关层提交 + 自带焦点三件套） */}
        {focusModule !== undefined && (
          <FocusEditor
            title={t('preset.focusTitle', { name: moduleLabel(focusModule, focusIndex, t) })}
            value={focusModule.content}
            placeholder={t('preset.editor.bodyPlaceholder')}
            labels={{
              back: t('common.cancel'),
              done: t('common.save'),
              chars: (n: number) => t('edit.chars', { n }),
              discardTitle: t('edit.discardTitle'),
              keepEditing: t('edit.keepEditing'),
              discard: t('edit.discard'),
            }}
            onDone={next => { patchModule(focusIndex, { content: next }); setFocusIndex(-1) }}
            onCancel={() => setFocusIndex(-1)}
          />
        )}
      </>
    )
  }

  // ------------------------------------------------------------ 导入
  return (
    <PresetImportView
      t={t}
      onBack={() => setView('list')}
      onImported={(preset, warnings, unsupportedMacros) => {
        // 落库成功后直接进编辑：让用户看到导入结果（模块清单就是他的东西）
        setView('edit')
        setDetail(preset)
        // 宿主的提示（解析口径差异等）合并成一条：只有一条通知位，多行会挤爆
        const macroLine = macrosToText(unsupportedMacros, t)
        const extra = macroLine.total > 0
          ? ` ${t('preset.macros.preview', { n: macroLine.total, list: macroLine.text })}`
          : ''
        showNotice(
          warnings.length === 0
            ? `${t('preset.import.done', { name: preset.name })}${extra}`
            : `${t('preset.import.done', { name: preset.name })} ${t('preset.import.warnings', { n: warnings.length })}：${warnings.join('；')}${extra}`,
          warnings.length === 0 && macroLine.total === 0 ? 'ok' : 'warn',
        )
        refreshAll()
      }}
    />
  )
}

// ---------------------------------------------------------------- 导入视图

function PresetImportView(props: {
  t: Translate
  onBack: () => void
  /** 导入成功：回传落库后的预设 + 宿主侧的提示与未知宏统计（解析细节以宿主为准） */
  onImported: (preset: PresetDetail, warnings: string[], unsupportedMacros: Record<string, number>) => void
}): JSX.Element {
  const { t, onBack, onImported } = props

  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<PresetPreview | undefined>(undefined)
  /** 解析后的原始 JSON（确认时原样交给宿主，由宿主再解析一次并落库） */
  const [parsed, setParsed] = useState<unknown>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const parse = (text: string): void => {
    setError('')
    setPreview(undefined)
    setParsed(undefined)
    const source = text.trim()
    if (source === '') return
    let json: unknown
    try {
      json = JSON.parse(source)
    } catch (e) {
      // JSON 本身就不合法：把解析器的原话透出去，别压成「导入失败」
      setError(t('preset.import.failed', { reason: errorText(e) }))
      return
    }
    try {
      setPreview(parsePresetJson(json, t))
      setParsed(json)
    } catch (e) {
      setError(t('preset.import.failed', { reason: errorText(e) }))
    }
  }

  const readFile = (file: File): void => {
    const reader = new FileReader()
    reader.onerror = () => setError(t('preset.import.readFailed'))
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setRaw(text)
      parse(text)
    }
    reader.readAsText(file)
  }

  /**
   * 「被丢弃」的分组摘要：按原因聚合（**只列非零项**）。
   *
   * 本端解析给的是原因码（翻译），宿主给的是中文原句（原样当分组名）——
   * 两种情况都能聚合，用户不必去数 11 行。
   */
  const dropSummary = (() => {
    if (preview === undefined) return [] as Array<{ label: string; count: number }>
    const buckets = new Map<string, number>()
    for (const item of preview.dropped) {
      const label = DROP_REASONS.has(item.reason)
        ? t(`preset.import.drop.${item.reason}` as const)
        : item.reason
      buckets.set(label, (buckets.get(label) ?? 0) + 1)
    }
    return [...buckets.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
  })()

  /**
   * 保留模块全是停用（或没有可注入内容）时给一条中性说明。
   *
   * 真实场景：ST 的 Default 预设几乎全是结构占位 + 空正文，导入后只剩 1 条且是停用的。
   * 用户很容易以为「我们解析坏了」。这里解释清楚：这些槽位由 ST 运行时填，
   * 本插件改用自带的底线 / 纪律段承担；要文风规则请手动加模块。
   */
  const allDisabled = preview !== undefined
    && preview.modules.length > 0
    && preview.modules.every(module => module.enabled === false)

  /** 未知宏汇总（只用于预览这一行提示；空表时整行不显示） */
  const macros = preview === undefined
    ? { total: 0, text: '' }
    : macrosToText(preview.unknownMacros, t)

  const confirm = (): void => {
    if (parsed === undefined) return
    setBusy(true)
    setError('')
    void importPreset(parsed)
      .then(result => {
        const modules = Array.isArray(result.preset?.modules) ? result.preset.modules : []
        onImported(
          {
            id: result.preset.id,
            name: result.preset.name,
            source: result.preset.source,
            modules: modules.map(module => ({
              name: asText(module.name),
              content: asText(module.content),
              enabled: module.enabled !== false,
            })),
          },
          Array.isArray(result.warnings) ? result.warnings.filter(w => typeof w === 'string') : [],
          // 宿主的未知宏统计（老宿主没有 → 空表；面板用本地扫描结果兜底）
          isRecord(result.unsupportedMacros)
            ? Object.fromEntries(
              Object.entries(result.unsupportedMacros)
                .map(([key, value]) => [key, Number(value)] as const)
                .filter(([, value]) => Number.isFinite(value) && value > 0),
            )
            : {},
        )
      })
      .catch((e: unknown) => {
        // 宿主解析失败的原文直接给（「这份 JSON 不是 ST 预设」这类）
        setError(t('preset.import.failed', { reason: errorText(e) }))
      })
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="awu-dialogHead">
        <button type="button" className="awu-navBack" onClick={onBack}>
          <IconBack size={13} />
          <span>{t('preset.title')}</span>
        </button>
        <span style={{ marginLeft: 'auto' }}>{t('preset.import.title')}</span>
      </div>

      <div className="awu-dialogBody">
        <label className="awu-label" htmlFor="awu-preset-json">{t('preset.import.paste')}</label>
        <textarea
          id="awu-preset-json"
          className="awu-input awu-editArea awu-presetJson"
          value={raw}
          rows={6}
          placeholder={t('preset.import.placeholder')}
          onChange={event => { setRaw(event.target.value); parse(event.target.value) }}
          onDragOver={event => { event.preventDefault() }}
          onDrop={event => {
            event.preventDefault()
            const file = event.dataTransfer.files[0]
            if (file !== undefined) readFile(file)
          }}
        />
        <div className="awu-presetImportBar">
          <button type="button" className="awu-btn" data-size="sm" onClick={() => fileRef.current?.click()}>
            {t('preset.import.pick')}
          </button>
          <span className="awu-hint">{t('preset.import.fileHint')}</span>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="awu-importNative"
            style={{ display: 'none' }}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file !== undefined) readFile(file)
              event.target.value = ''
            }}
          />
        </div>

        {error !== '' && (
          <div className="awu-err" role="alert" style={{ marginTop: 10 }}>
            <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          </div>
        )}

        {preview !== undefined && (
          <div className="awu-presetPreview">
            <div className="awu-importWarnHead" style={{ marginTop: 12 }}>{t('preset.import.previewTitle')}</div>

            <div className="awu-presetPreviewStat">
              {t('preset.import.modules', { n: preview.modules.length, on: enabledCountOf(preview.modules) })}
              {' · '}
              {t('preset.editor.stats', { modules: preview.modules.length, chars: charsOf(preview.modules) })}
            </div>

            {/* 中性说明（不是警告）：导入「几乎没东西进来」时先解释原因，别让人以为解析坏了 */}
            {allDisabled && (
              <div className="awu-noteRow" role="status">
                <span className="awu-noteDot" aria-hidden="true" />
                <span>{t('preset.import.allDisabled')}</span>
              </div>
            )}

            <ul className="awu-presetPreviewList">
              {preview.modules.map((module, index) => (
                <li key={index} data-enabled={isEnabled(module) ? 'true' : 'false'}>
                  <span className="awu-presetPreviewName">{moduleLabel(module, index, t)}</span>
                  <span className="awu-presetPreviewExcerpt">{excerpt(module.content)}</span>
                  {!isEnabled(module) && <span className="awu-pill" data-tone="none">{t('preset.editor.enabled')} off</span>}
                </li>
              ))}
            </ul>

            {preview.dropped.length > 0 && (
              <>
                <div className="awu-importWarnHead" style={{ marginTop: 12 }}>{t('preset.import.dropped', { n: preview.dropped.length })}</div>
                {/*
                  先给一行分组摘要（按 reason 聚合），别让用户去数 11 行：
                  `结构占位 9 · 空内容 2`。**只列非零项** —— 「废稿 0」这种零计数也是噪声，
                  与「提示要有动作」同一条判据。
                */}
                <div className="awu-presetDropSummary">
                  {dropSummary.map(item => (
                    <span className="awu-exportPill" key={item.label} data-state="warn">
                      {item.label} {item.count}
                    </span>
                  ))}
                </div>
                <ul className="awu-importWarns">
                  {preview.dropped.map((item, index) => (
                    <li key={index}>
                      <b>{item.name}</b>
                      {' — '}
                      {DROP_REASONS.has(item.reason)
                        ? t(`preset.import.drop.${item.reason}`)
                        : item.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/*
              未知 ST 变量：中性提示（不是红条）。发生在本端解析之后、落库之前，
              所以数字来自本端扫描；落库后若宿主给了 `unsupportedMacros`，以宿主为准。
            */}
            {macros.total > 0 && (
              <div className="awu-noteRow" role="status">
                <span className="awu-noteDot" aria-hidden="true" />
                <span>{t('preset.macros.preview', { n: macros.total, list: macros.text })}</span>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <>
                <div className="awu-importWarnHead" style={{ marginTop: 12 }}>{t('preset.import.warnings', { n: preview.warnings.length })}</div>
                <ul className="awu-importWarns">
                  {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      <div className="awu-dialogFoot">
        <button type="button" className="awu-btn" onClick={onBack} disabled={busy}>{t('common.cancel')}</button>
        <button
          type="button"
          className="awu-btn"
          data-kind="primary"
          onClick={confirm}
          disabled={busy || parsed === undefined}
        >
          {busy ? t('common.busy') : t('preset.import.confirm')}
        </button>
      </div>
    </>
  )
}
