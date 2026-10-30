/**
 * AI WITH U · 角色卡编辑器 schema
 *
 * 角色卡是「七字段 + 附字段」的中文键名自由 JSON。这里把「怎么呈现、用什么控件」
 * 集中成一份声明式 schema，组件只负责按 schema 渲染——加字段/换控件都只改这一个文件。
 *
 * 三条设计约束：
 *  1. **中文键名原样保留**：键名是后端与提示词共同依赖的契约，不做任何翻译映射；
 *  2. **容忍缺字段**：不是每张卡都齐全（老卡可能没有 `world` / `user_persona`），
 *     缺失时按 schema 给出空控件，用户填了才写回，没填就不产生多余空键；
 *  3. **未知键不丢**：卡里可能有 schema 没声明的字段，保存时原样带回（见 `mergeCard`），
 *     否则一次编辑就会把别人的自定义字段洗掉。
 */
import type { Card } from './api'

/** 单个字段的控件类型。 */
export type FieldKind =
  | 'text'      // 单行 input
  | 'long'      // 多行 textarea
  | 'list'      // 字符串数组，逐条增删改

/** 一个可编辑字段。 */
export interface FieldSpec {
  /** 中文键名（在所属分组对象里的键） */
  key: string
  /** 控件类型 */
  kind: FieldKind
  /** 占位提示 */
  placeholder?: string
  /** 给列表项用的占位提示 */
  itemPlaceholder?: string
}

/** 一个可折叠分组。 */
export interface GroupSpec {
  /** 分组 id（仅 UI 用） */
  id: string
  /** 分组标题 */
  title: string
  /** 分组副标题（说明这块管什么） */
  hint?: string
  /**
   * 分组在卡片里的存放方式：
   *  - `object`：卡片上的一个子对象（如 basic / voice），字段是它的键；
   *  - `top`：直接挂在卡片根上的字段（如 opening / openings）。
   */
  target: 'object' | 'top'
  /** target='object' 时，卡片根上的键名 */
  root?: string
  /** 字段列表 */
  fields: FieldSpec[]
  /** 是否默认展开 */
  open?: boolean
  /** 是否为「灵魂字段」，UI 上要突出 */
  soul?: boolean
  /** 是否选填（缺省时不显示「必填」暗示） */
  optional?: boolean
}

/**
 * 全部分组。顺序即 UI 顺序。
 *
 * 声线（voice）放在第二位并标 `soul`：原 skill 把它当作角色的「灵魂字段」——
 * 决定这个角色听起来像不像他，比剧情背景更影响观感。
 */
export const GROUPS: GroupSpec[] = [
  {
    id: 'basic',
    title: '基本信息',
    hint: '名字之外的第一印象',
    target: 'object',
    root: 'basic',
    open: true,
    fields: [
      { key: '姓名', kind: 'text', placeholder: '角色姓名' },
      { key: '年龄', kind: 'text', placeholder: '如 26' },
      { key: '身份', kind: 'text', placeholder: '如：两个月前搬进你合租房的室友' },
      { key: '一句话背景', kind: 'long', placeholder: '一两句话说清他是谁、和你什么关系' },
    ],
  },
  {
    id: 'voice',
    title: '声线基因',
    hint: '灵魂字段：决定他「听起来」像不像他',
    target: 'object',
    root: 'voice',
    open: true,
    soul: true,
    fields: [
      { key: '对话节奏', kind: 'long', placeholder: '如：快，一次连发 3-4 条；常一句拆成两三条发' },
      { key: '爱用句式', kind: 'list', itemPlaceholder: '一句他常说的话，如「我跟你说」' },
      { key: '自称', kind: 'text', placeholder: '如：我 / 老子 / 本大爷' },
      { key: '对用户的称呼', kind: 'text', placeholder: '如：你的名字；逗你时叫「室友大人」' },
      { key: '情绪口头禅', kind: 'list', itemPlaceholder: '如：兴奋「好耶！」' },
      { key: '禁忌词', kind: 'long', placeholder: '他绝不会说的词或句式' },
      { key: '非语言小动作', kind: 'list', itemPlaceholder: '如：（把两袋菜往你怀里一塞）' },
    ],
  },
  {
    id: 'personality',
    title: '性格核心',
    hint: '外在表现之下的那个矛盾',
    target: 'object',
    root: 'personality',
    fields: [
      { key: '关键词', kind: 'list', itemPlaceholder: '如：外向 / 话痨 / 自来熟' },
      { key: '内在矛盾', kind: 'long', placeholder: '他表面上什么样，实际上在躲什么' },
      { key: '对待亲近之人', kind: 'long', placeholder: '对最亲近的人会有的反差' },
    ],
  },
  {
    id: 'relationship',
    title: '关系定位',
    hint: '从哪开始，怎么互相称呼',
    target: 'object',
    root: 'relationship',
    fields: [
      { key: '关系起点', kind: 'text', placeholder: '如：合租室友，他搬进来两个月' },
      { key: '角色怎么称呼用户', kind: 'text', placeholder: '他叫你什么' },
      { key: '用户怎么称呼角色', kind: 'text', placeholder: '你叫他什么' },
    ],
  },
  {
    id: 'world',
    title: '故事背景',
    hint: '来处、落差、如今的日子',
    target: 'object',
    root: 'world',
    fields: [
      { key: '来处', kind: 'long', placeholder: '他从哪来' },
      { key: '落差', kind: 'long', placeholder: '过去的他和现在的他之间的差' },
      { key: '如今的日子', kind: 'long', placeholder: '现在每天在过什么日子' },
      { key: '你与他的旧', kind: 'long', placeholder: '你们之间过去发生过什么' },
    ],
  },
  {
    id: 'memory_anchor',
    title: '记忆锚点',
    hint: '模型必须记住的具体细节',
    target: 'object',
    root: 'memory_anchor',
    fields: [
      { key: '要点', kind: 'list', itemPlaceholder: '一条具体、可复用的细节' },
    ],
  },
  {
    id: 'dynamic_state',
    title: '动态状态',
    hint: '每次对话开始时的心情与近况',
    target: 'object',
    root: 'dynamic_state',
    fields: [
      { key: '当前情绪', kind: 'text', placeholder: '如：有点累但见到你就精神了' },
      { key: '近况', kind: 'long', placeholder: '最近在忙什么、发生了什么' },
      { key: '此刻在做什么', kind: 'text', placeholder: '如：在厨房煮面' },
    ],
  },
  {
    id: 'interaction_pref',
    title: '互动偏好',
    hint: '回复的手感与边界',
    target: 'object',
    root: 'interaction_pref',
    fields: [
      { key: '回复长度倾向', kind: 'text', placeholder: '如：短，两三句就停' },
      { key: '表情使用', kind: 'text', placeholder: '如：很少用，最多一个' },
      { key: '话题舒适区', kind: 'text', placeholder: '聊什么他最自在' },
      { key: '雷区', kind: 'long', placeholder: '绝对不能碰的话题' },
    ],
  },
  {
    id: 'user_persona',
    title: '你的身份',
    hint: '选填：TA 眼中的你',
    target: 'object',
    root: 'user_persona',
    optional: true,
    fields: [
      { key: '你是谁', kind: 'text', placeholder: '在这个故事里你是谁' },
      { key: '与 TA 的关系', kind: 'text', placeholder: '你们是什么关系' },
      { key: '共同经历', kind: 'long', placeholder: '你们一起经历过什么' },
    ],
  },
  {
    id: 'opening',
    title: '开场白',
    hint: '第一次开口的那句话',
    target: 'top',
    fields: [
      { key: 'opening', kind: 'long', placeholder: '角色的第一句台词（可含动作描写）' },
      { key: 'openings', kind: 'list', itemPlaceholder: '备选开场，换一句开场时轮流用' },
    ],
  },
]

/** 编辑器里的一份草稿：分组 id → 该组的字段值。 */
export type Draft = Record<string, Record<string, string | string[]>>

/** 从任意值安全取成「字符串列表」。 */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => (typeof v === 'string' ? v : String(v)))
  if (typeof value === 'string' && value.trim() !== '') return [value]
  return []
}

/** 从任意值安全取成字符串。 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(v => String(v)).join('、')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** 把卡片转成可编辑草稿。缺失字段填空白，不报错。 */
export function toDraft(card: Card | undefined): Draft {
  const draft: Draft = {}
  for (const group of GROUPS) {
    const bucket = group.target === 'object'
      ? ((card?.[group.root ?? group.id] ?? {}) as Record<string, unknown>)
      : (card ?? {})
    const values: Record<string, string | string[]> = {}
    for (const field of group.fields) {
      const raw = bucket[field.key]
      values[field.key] = field.kind === 'list' ? asList(raw) : asText(raw)
    }
    draft[group.id] = values
  }
  return draft
}

/** 值是否算「空」（空串、全空白项、空数组）。 */
export function isEmptyValue(value: string | string[]): boolean {
  if (Array.isArray(value)) return value.every(item => String(item).trim() === '')
  return String(value).trim() === ''
}

/**
 * 把草稿合并回完整卡片。
 *
 * 关键点（否则会毁数据）：
 *  - 以**原卡为底**做浅合并，schema 之外的字段（自定义键）原样保留；
 *  - 字段清空时**删除该键**而不是写空串/空数组，让卡片保持干净；
 *  - `name` 与 `source` 不参与编辑，直接沿用原值。
 */
export function mergeCard(card: Card | undefined, draft: Draft): Card {
  const base: Card = { ...(card ?? {}) }

  for (const group of GROUPS) {
    const values = draft[group.id]
    if (values === undefined) continue

    if (group.target === 'top') {
      for (const field of group.fields) {
        const value = values[field.key]
        if (value === undefined) continue
        if (isEmptyValue(value)) delete base[field.key]
        else base[field.key] = Array.isArray(value) ? value.filter(v => v.trim() !== '') : value
      }
      continue
    }

    const rootKey = group.root ?? group.id
    const existing = base[rootKey]
    const next: Record<string, unknown> = (
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ) ? { ...(existing as Record<string, unknown>) } : {}

    for (const field of group.fields) {
      const value = values[field.key]
      if (value === undefined) continue
      if (isEmptyValue(value)) {
        // 用户清空了：把键去掉，而不是留一个空串污染卡片
        delete next[field.key]
      } else if (Array.isArray(value)) {
        const items = value.filter(v => String(v).trim() !== '')
        if (items.length === 0) delete next[field.key]
        else next[field.key] = items
      } else {
        next[field.key] = value
      }
    }

    // 整组都空了就连同分组对象一起删掉，避免留下 `{}`
    if (Object.keys(next).length === 0) delete base[rootKey]
    else base[rootKey] = next
  }

  // 身份字段不可编辑，强制沿用原值；缺了就补上，避免写盘丢字段
  if (card?.name !== undefined) base['name'] = card.name
  if (card?.['source'] !== undefined) base['source'] = card['source']

  return base
}

/** 草稿是否有改动（用于「未保存就关闭」的二次确认）。 */
export function isDirty(card: Card | undefined, draft: Draft): boolean {
  const before = JSON.stringify(toDraft(card))
  const after = JSON.stringify(draft)
  return before !== after
}

/** 统计某张卡里有多少个字段「有内容」，用于详情页展示完整度。 */
export function filledCount(card: Card | undefined): { filled: number; total: number } {
  let filled = 0
  let total = 0
  for (const group of GROUPS) {
    const bucket = group.target === 'object'
      ? ((card?.[group.root ?? group.id] ?? {}) as Record<string, unknown>)
      : (card ?? {})
    for (const field of group.fields) {
      total += 1
      const raw = bucket[field.key]
      const value = field.kind === 'list' ? asList(raw) : asText(raw)
      if (!isEmptyValue(value)) filled += 1
    }
  }
  return { filled, total }
}

// ---------------------------------------------------------------- 细化元数据（v2 · 只加不改）

/**
 * 字段的「级别」——只用于 UI 上的徽记与排序提示，**不参与完整度打分**。
 *
 * 为什么不参与：CCv3 的必填性由**投影结果**决定（`description` / `first_mes` 非空才算能用），
 * 34 个结构字段里没有"必填"概念——`voice.自称` 空着卡照样跑。
 * 所以完整度仍由 `filledCount` 报"资料填了几项"，"能不能导出"由 `exportIssues` 体检（见下）。
 */
export type FieldLevel = 'required' | 'recommended' | 'optional'

/** 这条字段最终怎么进上下文（决定预算条如何归类）。 */
export type FieldBudget = 'l1' | 'turn0' | 'never'

/** 会投影到哪一段 CCv3 原生字段；`null` = 不投影（只进 L1 或只做结构化保留）。 */
export type ProjectionPath =
  | 'description'
  | 'personality'
  | 'scenario'
  | 'system_prompt'
  | 'post_history_instructions'
  | 'first_mes'
  | 'alternate_greetings'
  | null

export interface FieldMeta {
  projectsTo: ProjectionPath
  level: FieldLevel
  budget: FieldBudget
  /** 低于这个字数给"建议补全"提示（不算未填） */
  minChars?: number
}

/**
 * 34 个字段的元数据表（键 = `组id.字段名`，字段名与 `GROUPS` 逐字一致，含半角空格）。
 *
 * 投影关系照抄架构稿 §2.2 的映射表；`voice.禁忌词` 与 `interaction_pref.雷区` 走
 * `post_history_instructions`（"历史之后"的语义位），其余声线/互动偏好进 `system_prompt`。
 */
const FIELD_META: Record<string, FieldMeta> = {
  'basic.姓名': { projectsTo: null, level: 'required', budget: 'l1' },
  'basic.年龄': { projectsTo: null, level: 'optional', budget: 'l1' },
  'basic.身份': { projectsTo: 'description', level: 'required', budget: 'l1', minChars: 8 },
  'basic.一句话背景': { projectsTo: 'description', level: 'required', budget: 'l1', minChars: 20 },

  'voice.对话节奏': { projectsTo: 'system_prompt', level: 'recommended', budget: 'l1', minChars: 10 },
  'voice.爱用句式': { projectsTo: 'system_prompt', level: 'recommended', budget: 'l1' },
  'voice.自称': { projectsTo: 'system_prompt', level: 'recommended', budget: 'l1' },
  'voice.对用户的称呼': { projectsTo: 'system_prompt', level: 'recommended', budget: 'l1' },
  'voice.情绪口头禅': { projectsTo: 'system_prompt', level: 'optional', budget: 'l1' },
  'voice.禁忌词': { projectsTo: 'post_history_instructions', level: 'recommended', budget: 'l1' },
  'voice.非语言小动作': { projectsTo: 'system_prompt', level: 'optional', budget: 'l1' },

  'personality.关键词': { projectsTo: 'personality', level: 'recommended', budget: 'l1' },
  'personality.内在矛盾': { projectsTo: 'personality', level: 'recommended', budget: 'l1', minChars: 10 },
  'personality.对待亲近之人': { projectsTo: 'personality', level: 'optional', budget: 'l1' },

  'relationship.关系起点': { projectsTo: null, level: 'recommended', budget: 'l1', minChars: 6 },
  'relationship.角色怎么称呼用户': { projectsTo: null, level: 'optional', budget: 'l1' },
  'relationship.用户怎么称呼角色': { projectsTo: null, level: 'optional', budget: 'l1' },

  'world.来处': { projectsTo: 'scenario', level: 'recommended', budget: 'l1' },
  'world.落差': { projectsTo: 'scenario', level: 'optional', budget: 'l1' },
  'world.如今的日子': { projectsTo: 'scenario', level: 'optional', budget: 'l1' },
  'world.你与他的旧': { projectsTo: 'scenario', level: 'optional', budget: 'l1' },

  'memory_anchor.要点': { projectsTo: null, level: 'optional', budget: 'l1' },

  'dynamic_state.当前情绪': { projectsTo: null, level: 'optional', budget: 'l1' },
  'dynamic_state.近况': { projectsTo: null, level: 'optional', budget: 'l1' },
  'dynamic_state.此刻在做什么': { projectsTo: null, level: 'optional', budget: 'l1' },

  'interaction_pref.回复长度倾向': { projectsTo: 'system_prompt', level: 'recommended', budget: 'l1' },
  'interaction_pref.表情使用': { projectsTo: 'system_prompt', level: 'optional', budget: 'l1' },
  'interaction_pref.话题舒适区': { projectsTo: 'system_prompt', level: 'optional', budget: 'l1' },
  'interaction_pref.雷区': { projectsTo: 'post_history_instructions', level: 'recommended', budget: 'l1' },

  'user_persona.你是谁': { projectsTo: null, level: 'optional', budget: 'l1' },
  'user_persona.与 TA 的关系': { projectsTo: null, level: 'optional', budget: 'l1' },
  'user_persona.共同经历': { projectsTo: null, level: 'optional', budget: 'l1' },

  'opening.opening': { projectsTo: 'first_mes', level: 'required', budget: 'turn0', minChars: 20 },
  'opening.openings': { projectsTo: 'alternate_greetings', level: 'optional', budget: 'turn0' },
}

/** 取某个字段的元数据；表里没有就返回中庸值（未来加字段不会炸）。 */
export function fieldMeta(groupId: string, key: string): FieldMeta {
  return FIELD_META[`${groupId}.${key}`] ?? { projectsTo: null, level: 'recommended', budget: 'l1' }
}

/**
 * 旧 10 组的 id → 中文标题。
 *
 * 给 `distill.tsx` 这类"按旧分组 id 显示"的调用方兜底：`GROUPS` 的字段没变，
 * 但一旦有人只改 id 就会静默丢标题，留一张显式映射比猜安全。
 */
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
}

/** 与架构稿 §5.1 对齐的长度阈值（客户端只提示，不阻断）。 */
export const LENGTH_LIMITS = {
  /** `description` 投影后 */
  descriptionChars: 1200,
  /** L1 静态块（1–12 段合计） */
  l1Chars: 3000,
} as const

export type ExportIssueLevel = 'bad' | 'warn' | 'info'

export interface ExportIssue {
  code:
    | 'empty-description'
    | 'empty-first-mes'
    | 'description-too-long'
    | 'l1-too-long'
    | 'legacy-extra'
    | 'unmapped-native'
  level: ExportIssueLevel
  /** 相关字段（用于"跳到该字段"），可选 */
  groupId?: string
  key?: string
  /** 已格式化的补充数字（字数等） */
  detail?: string
}

function textAt(bucket: Record<string, unknown> | undefined, key: string): string {
  const value = bucket?.[key]
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(item => String(item)).join('、').trim()
  return ''
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** 按码点数字数（emoji 不算两字）。 */
function chars(text: string): number {
  return [...text].length
}

/**
 * 导出体检：判断"这张卡导出到酒馆能不能用"。
 *
 * - 有完整 CCv3 对象时，直接看投影结果（`data.description` 等）；
 * - 只有旧视图时，按结构字段推断（`基础.身份` + `基础.一句话背景` 是否都空）。
 * - **不阻断保存**：返回给 UI 做 pill 与提示即可。
 */
export function exportIssues(card: Card | undefined, ccv3?: Card): ExportIssue[] {
  const issues: ExportIssue[] = []
  const data = asObject(ccv3?.['data'])
  const extensions = asObject(data['extensions'])
  const aiwu = asObject(extensions['aiwu'])
  const legacy = asObject(aiwu['legacy'])
  const imported = asObject(aiwu['imported'])
  const lengthInfo = asObject(aiwu['length'])

  const basic = asObject(card?.['basic'])
  const openingBucket = card ?? {}

  // description：优先看投影，其次看结构
  const projectedDescription = typeof data['description'] === 'string' ? data['description'].trim() : ''
  const structureDescription = `${textAt(basic, '身份')}${textAt(basic, '一句话背景')}`
  const description = projectedDescription !== '' ? projectedDescription : structureDescription
  if (description === '') {
    issues.push({ code: 'empty-description', level: 'bad', groupId: 'basic', key: '一句话背景' })
  } else if (chars(description) > LENGTH_LIMITS.descriptionChars) {
    issues.push({ code: 'description-too-long', level: 'warn', groupId: 'basic', key: '一句话背景', detail: String(chars(description)) })
  }

  // first_mes：优先看投影，其次看 opening
  const projectedFirst = typeof data['first_mes'] === 'string' ? data['first_mes'].trim() : ''
  const structureFirst = textAt(openingBucket, 'opening')
  if (projectedFirst === '' && structureFirst === '') {
    issues.push({ code: 'empty-first-mes', level: 'bad', groupId: 'opening', key: 'opening' })
  }

  // L1 预算：优先用后端现算的值（架构稿 §8.2），拿不到就不猜
  const l1Chars = typeof lengthInfo['l1Chars'] === 'number' ? lengthInfo['l1Chars'] : undefined
  if (l1Chars !== undefined && l1Chars > LENGTH_LIMITS.l1Chars) {
    issues.push({ code: 'l1-too-long', level: 'warn', detail: String(l1Chars) })
  }

  if (Object.keys(asObject(legacy['extra'])).length > 0) {
    issues.push({ code: 'legacy-extra', level: 'info', detail: String(Object.keys(asObject(legacy['extra'])).length) })
  }

  const rawKeys = Object.keys(asObject(imported['raw']))
  if (rawKeys.length > 0) {
    issues.push({ code: 'unmapped-native', level: 'info', detail: String(rawKeys.length) })
  }

  return issues
}