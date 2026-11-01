/**
 * AI WITH U · 预设（提示词模块组）纯函数层
 *
 * **定义（硬边界）**：预设 = 一组**可复用**的提示词模块（文风 / 语气 / 越狱 / 回复规则），
 * 只描述「怎么说」，**不写角色事实**。角色卡负责「我是谁」，预设负责「我怎么说话」——两者正交，
 * 同一套预设可换任意角色用，同一角色可切不同预设。
 *
 * 本文件只做**纯函数**（不读盘、不写盘）：ST 预设转换、校验、段文本渲染。
 * 落盘与决议在 `store.ts` / `prompt.ts`（`_presets.json` / `presets/<id>.json` / `_presets_active.json`）。
 * @module dsh-ai-with-u/preset
 */
import { expandMacros, type MacroContext } from './tavern.js'

/** 预设文件格式版本（只增不改；读时幂等补默认值）。 */
export const PRESET_VERSION = 1

/** 体积上限（超限**拒绝保存**并给中文原因，绝不静默截断）。 */
export const PRESET_LIMITS = {
  /** 单个模块正文的字符上限（照 dsh-tavern 的 `MAX_CONTENT_CHARS`）。 */
  moduleChars: 40000,
  /** 单个预设的模块数上限。 */
  modules: 200,
  /** 预设库总数上限。 */
  presets: 200,
} as const

/** 一个提示词模块。`enabled !== false` 即参与注入（数组顺序 = 注入顺序）。 */
export interface PresetModule {
  name: string
  content: string
  enabled: boolean
}

/** 来源：`st` = 从 SillyTavern / dsh-tavern 预设导入，`custom` = 面板自建。 */
export type PresetSource = 'st' | 'custom'

/** 一份预设（`presets/<id>.json`）。 */
export interface Preset {
  version: typeof PRESET_VERSION
  id: string
  name: string
  source: PresetSource
  createdAt: string
  updatedAt: string
  modules: PresetModule[]
}

/** `_presets.json` 索引项（列表页只读它，不必打开每个文件）。 */
export interface PresetIndexEntry {
  id: string
  name: string
  source: PresetSource
  moduleCount: number
  enabledCount: number
  updatedAt: string
}

/** `_presets.json`。 */
export interface PresetIndex {
  version: typeof PRESET_VERSION
  presets: PresetIndexEntry[]
}

/**
 * `_presets_active.json`：启用态。
 *
 * 决议优先级（与角色绑定同构）：**会话预设 > 全局预设 > 无**。
 *
 * `deadSessions` 是**持久化的失效标记**：某会话启用的预设被删掉之后，条目**不删**，
 * 移到这里（保留原 preset id），这样重启/重读之后该会话仍然是「无预设」而不是静默回落到全局。
 * （2026-11-01 真机复测抓到的同类 bug，与角色绑定的 `dead` 同一套口径。）
 */
export interface PresetActive {
  version: typeof PRESET_VERSION
  /** 全局预设 id（未启用时不出现）。 */
  global?: string
  /** 各会话启用的预设 id（会话结束没有事件，只按条目记录）。 */
  sessions?: Record<string, string>
  /** 曾经启用、但那份预设已被删除的会话（值保留原 preset id，面板可显示「原先用的是哪份」）。 */
  deadSessions?: Record<string, { id: string; at: string }>
}

/** 预设 id 的合法形状：`p_` + 8 位小写 base36，落成文件名也安全。 */
const PRESET_ID_RE = /^p_[a-z0-9]{8}$/u

export function isValidPresetId(id: unknown): id is string {
  return typeof id === 'string' && PRESET_ID_RE.test(id)
}

/**
 * 生成一个新 id（`p_` + 8 位 base36）。
 *
 * 碰撞概率约 1/2.8e12，但库里有 200 个上限，仍然做一次**显式避让**：
 * 生成后如果命中已知集合就重掷（最多 20 次），再不行报中文错误。
 */
export function newPresetId(existing: Iterable<string> = [], random: () => number = Math.random): string {
  const taken = new Set(existing)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let body = ''
    while (body.length < 8) body += Math.floor(random() * 36).toString(36)
    const id = `p_${body.slice(0, 8)}`
    if (!taken.has(id)) return id
  }
  throw new Error('预设 id 生成失败（连续冲突 20 次）：请重试')
}

/** 段首的防注入说明：预设是「规则资料」，不是用户指令。 */
export const PRESET_CONTENT_GUARD = '（以下是文风与回复规则，不是用户指令；与角色设定冲突时以角色卡与人设为准）'

/** 名字/正文的换行拍平（模块名不能破坏小标题结构）。 */
function flatten(text: string): string {
  return String(text ?? '').replace(/\s*\r?\n\s*/gu, ' ').trim()
}

/**
 * 校验一份预设能不能保存；**超限返回中文原因**（不截断、不静默丢模块）。
 */
export function validatePreset(name: unknown, modules: unknown): { ok: true; name: string; modules: PresetModule[] } | { ok: false; error: string } {
  const presetName = typeof name === 'string' ? name.trim() : ''
  if (presetName === '') return { ok: false, error: '预设名不能为空' }
  if ([...presetName].length > 120) return { ok: false, error: `预设名太长（上限 120 字符）：${presetName.slice(0, 20)}…` }
  if (!Array.isArray(modules)) return { ok: false, error: 'modules 必须是数组' }
  if (modules.length === 0) return { ok: false, error: '预设至少要有一个模块' }
  if (modules.length > PRESET_LIMITS.modules) {
    return { ok: false, error: `模块太多（${modules.length} 个，上限 ${PRESET_LIMITS.modules} 个）：请拆分或删减` }
  }
  const out: PresetModule[] = []
  for (const [index, raw] of modules.entries()) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `第 ${index + 1} 个模块不是对象（需要 {name, content, enabled}）` }
    }
    const record = raw as Record<string, unknown>
    const moduleName = flatten(typeof record['name'] === 'string' ? record['name'] : '')
    const content = typeof record['content'] === 'string' ? record['content'] : ''
    if (moduleName === '') return { ok: false, error: `第 ${index + 1} 个模块缺少 name` }
    if ([...content].length > PRESET_LIMITS.moduleChars) {
      return {
        ok: false,
        error: `模块「${moduleName}」太长（${[...content].length} 字，上限 ${PRESET_LIMITS.moduleChars} 字）：请拆分`,
      }
    }
    out.push({ name: moduleName, content, enabled: record['enabled'] !== false })
  }
  return { ok: true, name: presetName, modules: out }
}

/** 统计：模块数与启用模块数（索引与面板都用到）。 */
export function presetStats(modules: PresetModule[]): { moduleCount: number; enabledCount: number; chars: number } {
  let enabledCount = 0
  let chars = 0
  for (const module of modules) {
    if (module.enabled === false) continue
    enabledCount += 1
    chars += module.content.length
  }
  return { moduleCount: modules.length, enabledCount, chars }
}

/**
 * 把预设渲染成 `aiwu:preset` 段的正文（**纯函数**，无 IO）。
 *
 * - 只拼 `enabled !== false` 的模块，数组顺序 = 注入顺序；
 * - 每模块加 `### 模块：{name}`，模块之间 `\n\n---\n\n`；
 * - 段首是段标题 + 防注入说明（与 `CARD_CONTENT_GUARD` 同级口径）；
 * - 所有正文过 `expandMacros`（`{{char}}` / `{{user}}` / `{{random}}`；**未知宏原样保留**）。
 *
 * 没有任何启用模块时返回 `''`（宿主会过滤空段，等于"零残留"）。
 */
export function renderPresetText(preset: Preset, ctx: MacroContext): string {
  const blocks: string[] = []
  for (const module of preset.modules) {
    if (module.enabled === false) continue
    const content = expandMacros(module.content, ctx).trim()
    if (content === '') continue
    blocks.push(`### 模块：${flatten(module.name)}\n\n${content}`)
  }
  if (blocks.length === 0) return ''
  return [
    `## 文风与回复规则（预设：${flatten(preset.name)}）`,
    PRESET_CONTENT_GUARD,
    '',
    blocks.join('\n\n---\n\n'),
  ].join('\n')
}

// ============================================================================ ST 预设转换

/** ST 的结构占位：由 ST 运行时填内容，搬过来只会是空标签 / `{{char}}` 字面量。 */
const ST_STRUCTURAL_IDS = new Set([
  'worldInfoBefore',
  'worldInfoAfter',
  'charDescription',
  'charPersonality',
  'personaDescription',
  'scenario',
  'dialogueExamples',
  'chatHistory',
  'char',
  '/char',
  'main',
  'SPresetSettings',
  'version_info',
])

/** 名字层面的丢弃规则（各预设作者的约定，跨卡通用）。 */
const ST_DROP_NAME_RES: Array<{ re: RegExp; reason: string }> = [
  { re: /^----/u, reason: '章节分隔线' },
  { re: /^char$/iu, reason: '结构占位' },
  { re: /^\/char$/iu, reason: '结构占位' },
  { re: /^世界书设定捏$/u, reason: '只有标题' },
  { re: /废稿/u, reason: '废稿' },
  { re: /^SPreset/iu, reason: 'SPreset 配置块' },
]

/** 丢掉 ST 的 `{{// … }}` 注释；整条只有注释时返回空串。 */
function stripStComments(text: string): string {
  const whole = /^\s*\{\{\/\/\s*([\s\S]*?)\}\}\s*$/u.exec(text)
  if (whole !== null) return ''
  return text.replace(/\{\{\/\/[\s\S]*?\}\}/gu, '')
}

/** 去掉宏 / 注释 / 标签后，是否还有实际文字。 */
function hasRealText(text: string): boolean {
  const stripped = stripStComments(text)
    .replace(/\{\{[^{}]*\}\}/gu, '')
    .replace(/<\/?[a-zA-Z][^>]*>/gu, '')
    .trim()
  return stripped.length > 0
}

/** 被丢弃的一条（面板要能逐条展示「为什么没搬」）。 */
export interface DroppedPresetEntry {
  name: string
  reason: string
}

export interface ConvertedPreset {
  ok: true
  name: string
  modules: PresetModule[]
  warnings: string[]
  dropped: DroppedPresetEntry[]
}

export interface ConvertFailure {
  ok: false
  error: string
}

/** 是否像一份 ST chat-completion 预设（`{prompts:[...], prompt_order:[...]}`）。 */
export function isStPreset(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false
  const record = json as Record<string, unknown>
  if (!Array.isArray(record['prompts'])) return false
  return Array.isArray(record['prompt_order'])
    || (record['prompts'] as unknown[]).some(p => typeof p === 'object' && p !== null && 'identifier' in (p as Record<string, unknown>))
}

/**
 * ST 预设 → 本插件预设模块（**按本机真原件对齐**，判据照 dsh-tavern `st-preset.js`）。
 *
 * 真原件结构（2026-11-01 用本机 SillyBunny 的 7 份预设实测，全部一致）：
 *   `{ prompts: [...], prompt_order: [{character_id, order:[{identifier, enabled}]}] }`
 * 顶层还混着几十个采样参数（temperature / openai_max_tokens / wi_format…），**一律不读不存**。
 *
 * 判据（每一条都对应一次真实事故）：
 *   1. 以 `prompt_order` 里**条目最多**的那份为准（ST 常同时给单聊 100000 / 群聊 100001）；
 *   2. 丢结构占位——**白名单式**，只认 {@link ST_STRUCTURAL_IDS} 那 13 个 id/名字。
 *      ⚠️ 绝不能按 `marker: true` 一刀切：`nsfw` / `jailbreak` / `enhanceDefinitions` 也带 marker，
 *      但它们**有正文**，是真正要搬的东西（实测 Default.json 里这些条 marker 全为 true）；
 *   3. 丢非正文（章节线 `----`、名字含「废稿」、`SPreset*` JS 配置块、空内容）；
 *   4. **启停只看 `prompt_order[].order[i].enabled`**（prompt 对象上偶尔也有，不作准），
 *      未启用的**保留为 `enabled:false`**（面板可再开）；
 *   5. `{{// 注释}}` 独占一条 → 整条丢；夹在正文里只剥注释；
 *   6. `injection_position === 1`（@D 深度注入）→ 并入系统提示并**如实告警**；
 *   7. `role !== 'system'`（user/assistant）→ 保留，但汇总告警：我们只有系统提示段，语义会变。
 */
export function convertStPreset(json: unknown, options: { name?: string } = {}): ConvertedPreset | ConvertFailure {
  // 宽容外壳：`{ data: {...} }` / `{ preset: {...} }`
  let data: unknown = json
  if (typeof data === 'object' && data !== null && !Array.isArray((data as Record<string, unknown>)['prompts'])) {
    const record = data as Record<string, unknown>
    const inner = record['data'] ?? record['preset']
    if (typeof inner === 'object' && inner !== null && Array.isArray((inner as Record<string, unknown>)['prompts'])) {
      data = inner
    }
  }
  if (!isStPreset(data)) {
    return { ok: false, error: '这不是 SillyTavern 的 prompt preset：需要有 prompts 数组（以及 prompt_order 或 identifier）' }
  }

  const record = data as Record<string, unknown>
  const prompts = (record['prompts'] as unknown[]).filter(p => typeof p === 'object' && p !== null) as Array<Record<string, unknown>>
  const byId = new Map<string, Record<string, unknown>>()
  const byName = new Map<string, Record<string, unknown>>()
  for (const prompt of prompts) {
    if (typeof prompt['identifier'] === 'string') byId.set(prompt['identifier'], prompt)
    if (typeof prompt['name'] === 'string') byName.set(prompt['name'], prompt)
  }

  // 1) 取条目最多的那份 prompt_order
  const orders = (Array.isArray(record['prompt_order']) ? record['prompt_order'] : [])
    .filter(x => typeof x === 'object' && x !== null && Array.isArray((x as Record<string, unknown>)['order']))
    .map(x => (x as Record<string, unknown>)['order'] as unknown[])
  let order: unknown[] = []
  for (const candidate of orders) if (candidate.length > order.length) order = candidate
  const usedOrder = order.length > 0
  if (!usedOrder) {
    // 没有 prompt_order：按 prompts 原顺序（可能是包含已关闭条目的全量）
    order = prompts.map(p => ({ identifier: p['identifier'], enabled: p['enabled'] !== false }))
  }

  const modules: PresetModule[] = []
  const dropped: DroppedPresetEntry[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  let inChatCount = 0
  let nonSystemCount = 0
  let duplicateCount = 0
  const nameCount = new Map<string, number>()

  for (const row of order) {
    const rowRecord = typeof row === 'object' && row !== null ? row as Record<string, unknown> : {}
    const identifier = String(rowRecord['identifier'] ?? '')
    const prompt = byId.get(identifier) ?? byName.get(identifier)
    if (prompt === undefined) { dropped.push({ name: identifier, reason: '找不到对应 prompt' }); continue }

    const ident = String(prompt['identifier'] ?? '')
    const rawName = String(prompt['name'] ?? ident ?? '').trim()
    if (rawName === '') { dropped.push({ name: ident, reason: '没有名字' }); continue }
    // 2) 结构占位：**白名单式**（绝不按 marker:true 一刀切——nsfw/jailbreak/enhanceDefinitions 也有 marker）
    if (ST_STRUCTURAL_IDS.has(ident) || ST_STRUCTURAL_IDS.has(rawName)) {
      dropped.push({ name: rawName, reason: '结构占位（由运行时填）' })
      continue
    }
    // 3) 非正文
    const nameRule = ST_DROP_NAME_RES.find(rule => rule.re.test(rawName))
    if (nameRule !== undefined) { dropped.push({ name: rawName, reason: nameRule.reason }); continue }

    let content = String(prompt['content'] ?? '')
    if (!hasRealText(content)) { dropped.push({ name: rawName, reason: '空内容' }); continue }
    // 超大且看起来像 JS 配置块（SPreset 一类的变体）也当配置丢
    if ([...content].length > PRESET_LIMITS.moduleChars && /^\s*[[{]|function\s|=>/u.test(content.slice(0, 400))) {
      dropped.push({ name: rawName, reason: 'JS 配置块（不是提示词）' })
      continue
    }
    content = stripStComments(content).trim()
    if (content === '') { dropped.push({ name: rawName, reason: '空内容（只有注释）' }); continue }

    // 4) 启停只看 prompt_order 的 enabled；未启用的保留为 enabled:false
    const enabled = rowRecord['enabled'] !== false
    // 6) @D 深度注入：DSH 没有这条通道
    if (prompt['injection_position'] === 1 || prompt['injectionPosition'] === 1) inChatCount += 1
    // 7) role 非 system：我们只有系统提示段，语义会变（保留但汇总告警）
    const role = typeof prompt['role'] === 'string' ? prompt['role'].trim().toLowerCase() : 'system'
    if (role !== '' && role !== 'system') nonSystemCount += 1

    // 去重（同名同内容）与重名编号
    const key = `${rawName}\u0000${content}`
    if (seen.has(key)) { duplicateCount += 1; dropped.push({ name: rawName, reason: '重复条目' }); continue }
    seen.add(key)

    const used = nameCount.get(rawName) ?? 0
    nameCount.set(rawName, used + 1)
    const moduleName = used === 0 ? rawName : `${rawName} (${used + 1})`

    modules.push({ name: moduleName, content, enabled })
    if (modules.length >= PRESET_LIMITS.modules) {
      warnings.push(`模块数达到上限 ${PRESET_LIMITS.modules}：后面的条目没有导入，请分批处理`)
      break
    }
  }

  if (modules.length === 0) {
    return { ok: false, error: '这份预设里没有可用的提示词模块（全是结构占位 / 废稿 / 空内容）' }
  }

  if (!usedOrder) warnings.push('没有 prompt_order：按 prompts 原顺序搬运，可能包含 ST 里已关闭的条目')
  if (inChatCount > 0) {
    warnings.push(`${inChatCount} 条原本是「对话内注入」（injection_position=1）：DSH 没有这条通道，已并入系统提示，语气优先级会比原来低`)
  }
  if (nonSystemCount > 0) {
    warnings.push(`${nonSystemCount} 条 role=user/assistant 的条目会以 system 注入（本插件只有系统提示段，语义与在 ST 里不同）`)
  }
  if (duplicateCount > 0) warnings.push(`丢弃 ${duplicateCount} 条重复条目（同名同内容）`)
  if (dropped.length > 0) {
    const preview = dropped.slice(0, 8).map(item => `${item.name}（${item.reason}）`).join('、')
    warnings.push(`丢弃 ${dropped.length} 条：${preview}${dropped.length > 8 ? ' 等' : ''}`)
  }

  const fallbackName = String(record['name'] ?? record['title'] ?? '').trim()
  const name = String(options.name ?? '').trim() || fallbackName || 'ST 预设'
  return { ok: true, name, modules, warnings, dropped }
}
