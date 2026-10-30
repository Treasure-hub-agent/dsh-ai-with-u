/**
 * AI WITH U · 文案与角色卡解析
 *
 * 文案走宿主 locale 服务（`ctx.locale.register` + 槽位注入的 `t`），所以这里
 * 只提供两种语言的字典和一份「找不到就用中文」的兜底翻译器。
 * 角色卡解析单独放一处：卡是七字段的自由 JSON，UI 需要的只是几种稳定读法。
 */
import type { Card, CharacterSummary, DiaryEntry } from './api'

// ---------------------------------------------------------------- 语言字典

/** 字典键集合（中文是 source of truth；英文漏项在开发期一眼可见）。 */
const zh = {
  'badge.label': '角色管理',
  'badge.none': '未启用角色',
  'badge.busy': '切换中…',
  'badge.title': '角色扮演 · AI WITH U',
  'badge.open': '打开角色管理器',

  'panel.kicker': 'AI WITH U',
  'panel.title': '角色管理器',
  'panel.close': '收起面板',
  'panel.refresh': '刷新数据',
  'panel.tab.roster': '角色簿',
  'panel.tab.diary': '日记',
  'panel.tab.stats': '统计',

  'stats.characters': '角色',
  'stats.memory': '记忆',
  'stats.turns': '对话',

  'active.none.title': '当前没有启用角色',
  'active.none.hint': '挑一张角色卡启用，人设即刻插上；退出时干净拔出，不留痕迹。',
  'active.since': '已启用',
  'active.mode.text': '纯文本',
  'active.mode.action': '文本 + 动作',
  'active.exit': '退出',
  'active.mode.switch': '切换模式',

  'roster.empty.title': '角色簿还是空的',
  'roster.empty.hint': '新建一张角色卡就能开始；也可以把原 ai-with-u 的 characters 目录搬进插件目录。',
  'roster.new': '新建角色',
  'roster.count': '共 {n} 位',
  'roster.memory': '{n} 条记忆',
  'roster.never': '从未互动',
  'roster.enable': '启用',
  'roster.enabled': '启用中',
  'roster.detail': '查看',
  'roster.open': '打开 {name} 的角色页',

  'diary.pick': '先启用或选择一位角色，才能翻它的日记。',
  'diary.empty': '还没有写下任何一天。你们聊过的内容会被自动记进来。',
  'diary.marker.timeline': '时',
  'diary.marker.notes': '记',

  'stats.title': '这一册的厚度',
  'stats.characters.full': '位角色',
  'stats.memory.full': '条记忆',
  'stats.turns.full': '轮对话',
  'stats.source': '角色来源',
  'stats.recent': '最近活跃',
  'stats.root': '存放位置',
  'stats.none': '暂无数据',

  'detail.back': '返回',
  'detail.card': '角色卡',
  'detail.personality': '性格',
  'detail.voice': '声音',
  'detail.relationship': '关系',
  'detail.activate': '启用',
  'detail.activateReplace': '替换启用',
  'detail.deactivate': '退出',
  'detail.delete': '删除',
  'detail.diary': '最近日记',
  'detail.diaryEmpty': '这位角色还没有日记。',

  'new.title': '新建角色',
  'new.name': '角色名',
  'new.namePlaceholder': '例如：虞照',
  'new.role': '身份',
  'new.rolePlaceholder': '可选，例如：合租室友',
  'new.blurb': '一句话背景',
  'new.blurbPlaceholder': '可选，一句话说清他/她是谁、和你什么关系',
  'new.preview': '会创建：',
  'new.confirm': '创建',
  'new.cancel': '取消',
  'new.nameRequired': '先给角色起个名字。',
  'new.nameTaken': '这个名字已经有人用了。',

  'delete.title': '删除角色',
  'delete.body': '要删掉「{name}」吗？这一步不会自动备份。',
  'delete.withMemory': '连同日记与记忆一起删除（不可恢复）',
  'delete.keepMemory': '角色卡删除后，日记文件会保留在磁盘上。',
  'delete.confirm': '确认删除',
  'delete.cancel': '再想想',

  'mode.title': '切换交互模式',
  'mode.text': '纯文本',
  'mode.textHint': '不输出动作神态，只靠语气与断句表达',
  'mode.action': '文本 + 动作',
  'mode.actionHint': '动作神态用括号包起来，与台词分清界限',

  'common.loading': '载入中…',
  'common.retry': '重试',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.unknown': '未知',
  'common.noMemory': '0 条记忆',
  'common.busy': '处理中…',
  'common.close': '关闭',

  // ---- 记忆与剧情维护 ----
  'relation.title': '关系',
  'relation.baseline': '起点',
  'relation.turns': '{n} 轮',
  'relation.note': '档位由模型根据对话现算，这里只显示起点锚定。',
  'relation.none': '暂无关系档案',

  'opening.title': '开场',
  'opening.next': '换一句开场',
  'opening.none': '这张卡里还没有开场白。',
  'opening.history': '已有历史档案：对话进行中不会重发开场，改由模型换声气顺口接。',
  'opening.fresh': '已重置，下一次对话从开场白开始。',
  'opening.needGenerate': '卡里没有开场候选，需要模型先生成几句才能换。',
  'opening.rotated': '开场已换。',

  'diary.actions': '维护',
  'diary.edit': '改写',
  'diary.editTitle': '改写这条日记',
  'diary.editHint': '改写后的完整文字；保存后会同步更新会话摘要。',
  'diary.editDone': '已改写。',
  'diary.editMulti': '命中了 {n} 条，写的是第一条。想改别的请用更精确的原文。',
  'diary.editRequired': '内容不能为空。',

  'forget.title': '忘记某事',
  'forget.hint': '输入关键词，会从日记、会话最近记录和角色卡里一起清掉。',
  'forget.keyword': '关键词',
  'forget.keywordPlaceholder': '例如：医院的约定',
  'forget.do': '忘记',
  'forget.nothing': '没有找到包含该关键词的记忆。',
  'forget.done': '已忘记：{diary} 条日记、{session} 条会话记录、{card} 处角色卡。',
  'forget.keywordRequired': '先输入要忘记的关键词。',

  'reset.title': '重新开始',
  'reset.session': '全新开始',
  'reset.sessionHint': '清空最近记录、心情、话题与轮数，日记保留。',
  'reset.all': '彻底重置',
  'reset.allHint': '连日记一起清空，回到初见状态。不可恢复。',
  'reset.sessionDone': '已全新开始，保留 {n} 条日记。',
  'reset.allDone': '已彻底重置，清除 {n} 条日记。',
  'reset.confirmTitle': '彻底重置「{name}」？',
  'reset.confirmBody': '这会删除全部日记与会话记忆，角色卡本身保留。这一步无法撤销。',
  'reset.confirmWord': '彻底重置',

  // ---- 角色卡编辑器 ----
  'detail.edit': '编辑',
  'edit.title': '编辑角色卡',
  'edit.kicker': '角色卡编辑',
  'edit.progressHint': '已填写字段 / 总字段',
  'edit.readonlyHint': '角色名与来源为只读：改名涉及目录重命名，暂不支持在面板内修改。',
  'edit.saved': '角色卡已保存',
  'edit.soulBadge': '灵魂字段',
  'edit.soulHint': '声线决定这个角色「听起来」像不像他，比剧情更影响观感',
  'edit.optional': '选填',
  'edit.listKind': '列表',
  'edit.listEmpty': '还没有条目',
  'edit.addItem': '添加一条',
  'edit.removeItem': '删除这条',
  'edit.save': '保存',
  'edit.dirty': '有未保存的改动',
  'edit.clean': '暂无改动',
  'edit.discardTitle': '放弃未保存的改动？',
  'edit.discardBody': '你在角色卡上的修改还没有保存，关掉就没了。',
  'edit.keepEditing': '继续编辑',
  'edit.discard': '放弃改动',
}

type Dict = { [K in keyof typeof zh]: string }

const en: Dict = {
  'badge.label': 'Characters',
  'badge.none': 'No character',
  'badge.busy': 'Switching…',
  'badge.title': 'Roleplay · AI WITH U',
  'badge.open': 'Open character manager',

  'panel.kicker': 'AI WITH U',
  'panel.title': 'Character Manager',
  'panel.close': 'Close panel',
  'panel.refresh': 'Refresh',
  'panel.tab.roster': 'Roster',
  'panel.tab.diary': 'Diary',
  'panel.tab.stats': 'Stats',

  'stats.characters': 'Characters',
  'stats.memory': 'Memories',
  'stats.turns': 'Turns',

  'active.none.title': 'No character active',
  'active.none.hint': 'Pick a card and enable it — the persona plugs in instantly and unplugs cleanly.',
  'active.since': 'Active since',
  'active.mode.text': 'Text only',
  'active.mode.action': 'Text + action',
  'active.exit': 'Exit',
  'active.mode.switch': 'Switch mode',

  'roster.empty.title': 'Your roster is empty',
  'roster.empty.hint': 'Create a card to begin, or move an existing characters folder into the plugin directory.',
  'roster.new': 'New character',
  'roster.count': '{n} total',
  'roster.memory': '{n} memories',
  'roster.never': 'Never used',
  'roster.enable': 'Enable',
  'roster.enabled': 'Active',
  'roster.detail': 'View',
  'roster.open': 'Open {name}',

  'diary.pick': 'Enable or pick a character to read its diary.',
  'diary.empty': 'No days written yet. Conversations are recorded here automatically.',
  'diary.marker.timeline': 'T',
  'diary.marker.notes': 'N',

  'stats.title': 'How thick this volume is',
  'stats.characters.full': 'characters',
  'stats.memory.full': 'memories',
  'stats.turns.full': 'turns',
  'stats.source': 'By source',
  'stats.recent': 'Recently active',
  'stats.root': 'Storage location',
  'stats.none': 'No data yet',

  'detail.back': 'Back',
  'detail.card': 'Character card',
  'detail.personality': 'Personality',
  'detail.voice': 'Voice',
  'detail.relationship': 'Relationship',
  'detail.activate': 'Enable',
  'detail.activateReplace': 'Switch to this',
  'detail.deactivate': 'Exit',
  'detail.delete': 'Delete',
  'detail.diary': 'Recent diary',
  'detail.diaryEmpty': 'This character has no diary yet.',

  'new.title': 'New character',
  'new.name': 'Name',
  'new.namePlaceholder': 'e.g. Yuzhao',
  'new.role': 'Role',
  'new.rolePlaceholder': 'Optional, e.g. roommate',
  'new.blurb': 'One-line background',
  'new.blurbPlaceholder': 'Optional, one line about who they are to you',
  'new.preview': 'Will create: ',
  'new.confirm': 'Create',
  'new.cancel': 'Cancel',
  'new.nameRequired': 'Give the character a name first.',
  'new.nameTaken': 'That name is already taken.',

  'delete.title': 'Delete character',
  'delete.body': 'Delete “{name}”? This cannot be undone.',
  'delete.withMemory': 'Also delete diary and memories (permanent)',
  'delete.keepMemory': 'The diary file stays on disk if you keep memories.',
  'delete.confirm': 'Delete',
  'delete.cancel': 'Keep it',

  'mode.title': 'Interaction mode',
  'mode.text': 'Text only',
  'mode.textHint': 'No action beats; tone and pauses carry it',
  'mode.action': 'Text + action',
  'mode.actionHint': 'Action beats in parentheses, separate from speech',

  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.unknown': 'Unknown',
  'common.noMemory': '0 memories',
  'common.busy': 'Working…',
  'common.close': 'Close',

  'relation.title': 'Relationship',
  'relation.baseline': 'Start',
  'relation.turns': '{n} turns',
  'relation.note': 'The live band is computed by the model from the conversation; this shows only the starting anchor.',
  'relation.none': 'No relationship record yet',

  'opening.title': 'Opening',
  'opening.next': 'Next opening',
  'opening.none': 'This card has no opening lines.',
  'opening.history': 'History exists: the opening is not replayed mid-conversation; the model changes tone instead.',
  'opening.fresh': 'Reset — the next turn starts from the opening.',
  'opening.needGenerate': 'No candidate openings in the card; the model must generate some first.',
  'opening.rotated': 'Opening rotated.',

  'diary.actions': 'Maintain',
  'diary.edit': 'Rewrite',
  'diary.editTitle': 'Rewrite this diary line',
  'diary.editHint': 'The full replacement text; the session summary updates too.',
  'diary.editDone': 'Rewritten.',
  'diary.editMulti': '{n} matches; the first was rewritten. Use more exact text for a different one.',
  'diary.editRequired': 'Text cannot be empty.',

  'forget.title': 'Forget something',
  'forget.hint': 'Enter a keyword to remove it from the diary, recent session records and the card.',
  'forget.keyword': 'Keyword',
  'forget.keywordPlaceholder': 'e.g. the hospital promise',
  'forget.do': 'Forget',
  'forget.nothing': 'Nothing matched that keyword.',
  'forget.done': 'Forgotten: {diary} diary lines, {session} session records, {card} card fields.',
  'forget.keywordRequired': 'Enter a keyword first.',

  'reset.title': 'Start over',
  'reset.session': 'Fresh start',
  'reset.sessionHint': 'Clears recent records, mood, topic and turn count. The diary stays.',
  'reset.all': 'Full reset',
  'reset.allHint': 'Clears the diary too, back to a first meeting. Irreversible.',
  'reset.sessionDone': 'Fresh start done; {n} diary entries kept.',
  'reset.allDone': 'Full reset done; {n} diary entries cleared.',
  'reset.confirmTitle': 'Fully reset “{name}”?',
  'reset.confirmBody': 'This deletes the entire diary and session memory. The character card itself stays. It cannot be undone.',
  'reset.confirmWord': 'Full reset',

  'detail.edit': 'Edit',
  'edit.title': 'Edit character card',
  'edit.kicker': 'CARD EDITOR',
  'edit.progressHint': 'Filled fields / total',
  'edit.readonlyHint': 'Name and source are read-only: renaming would move the folder, which the panel does not do yet.',
  'edit.saved': 'Character card saved',
  'edit.soulBadge': 'Soul field',
  'edit.soulHint': 'Voice decides whether the character sounds like himself — it shapes the feel more than the plot does.',
  'edit.optional': 'Optional',
  'edit.listKind': 'list',
  'edit.listEmpty': 'No items yet',
  'edit.addItem': 'Add item',
  'edit.removeItem': 'Remove item',
  'edit.save': 'Save',
  'edit.dirty': 'Unsaved changes',
  'edit.clean': 'No changes',
  'edit.discardTitle': 'Discard unsaved changes?',
  'edit.discardBody': 'Your edits to this character card have not been saved; closing loses them.',
  'edit.keepEditing': 'Keep editing',
  'edit.discard': 'Discard',
}

export const localeDictionaries = { zh, en }

/** 翻译器：`t('roster.memory', { n: 3 })`。缺失的 key 原样返回，开发期一眼能看出来。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * 生成一个翻译器。
 *
 * 宿主会在槽位注入 `t`（已绑定本插件命名空间）；拿不到时（例如早期版本）
 * 退回本地中文词典，保证文案永远不会是裸 key。
 */
export function makeTranslator(t?: (key: string, params?: Record<string, string | number>) => string): Translate {
  const fallback = zh as Record<string, string>
  return (key, params) => {
    let template: string | undefined
    if (typeof t === 'function') {
      try {
        const value = t(key, params)
        // 宿主在缺 key 时通常回显 key 本身
        if (typeof value === 'string' && value !== '' && value !== key) template = value
      } catch {
        template = undefined
      }
    }
    if (template === undefined) template = fallback[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name]
      return value === undefined ? match : String(value)
    })
  }
}

// ---------------------------------------------------------------- 角色卡解析

/** 从任意值里取出第一个非空字符串。 */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      const parts = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      if (parts.length > 0) return parts.join(' · ')
    }
  }
  return ''
}

/** 记录型字段转成「键 → 可读值」数组，用于详情页的字段表。 */
export function entriesOf(value: unknown): Array<[string, string]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const out: Array<[string, string]> = []
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const text = firstString(raw, typeof raw === 'number' ? String(raw) : undefined)
    if (text !== '') out.push([key, text])
  }
  return out
}

/** 角色的「身份」一句话：身份 → 关系起点 → 一句话背景。 */
export function roleOf(card: Card | undefined): string {
  if (card === undefined) return ''
  const basic = (card.basic ?? {}) as Record<string, unknown>
  const rel = (card.relationship ?? {}) as Record<string, unknown>
  return firstString(basic['身份'], basic['身份/职业'], rel['关系起点'], basic['一句话背景'])
}

/** 简介：一句话背景，缺省时退到身份。 */
export function blurbOf(card: Card | undefined): string {
  if (card === undefined) return ''
  const basic = (card.basic ?? {}) as Record<string, unknown>
  return firstString(basic['一句话背景'], basic['身份'], (card.personality as Record<string, unknown> | undefined)?.['内在矛盾'])
}

/** 名字首字：中文取第一个汉字，拉丁取首字母大写。 */
export function initialOf(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '？'
  const first = Array.from(trimmed)[0] ?? '？'
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

/** 由名字派生的稳定色相（0-3），让卡片墙的色彩分布不随机跳动。 */
export function hueOf(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return hash % 4
}

/** 「最近活跃」的短格式：今天 / 昨天 / N 天前 / 日期。 */
export function relativeDay(iso: string): string {
  if (iso === '') return ''
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  const now = new Date()
  const dayMs = 86400000
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startThen = new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime()
  const days = Math.round((startToday - startThen) / dayMs)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
}

/** 日记按日期倒序，空行剔除。 */
export function sortedDiary(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries]
    .map(entry => ({
      date: entry.date,
      timeline: entry.timeline.filter(line => line.trim() !== ''),
      notes: entry.notes.filter(line => line.trim() !== ''),
    }))
    .filter(entry => entry.timeline.length > 0 || entry.notes.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** 角色簿排序：启用的置顶，其余按最近活跃时间倒序。 */
export function sortRoster(list: CharacterSummary[], activeName?: string): CharacterSummary[] {
  return [...list].sort((a, b) => {
    const aLive = a.name === activeName ? 1 : 0
    const bLive = b.name === activeName ? 1 : 0
    if (aLive !== bLive) return bLive - aLive
    return (b.lastActive || '').localeCompare(a.lastActive || '')
  })
}

/** 统计条要显示的三项数字。 */
export interface StatTriple {
  characters: number
  memory: number
  turns: number
}

/** 有总览就用总览（含轮数），否则从角色簿现算。 */
export function statTriple(
  overview: { stats?: Partial<StatTriple> & { memoryEntries?: number } } | undefined,
  list: CharacterSummary[],
): StatTriple {
  const fromList = () => ({
    characters: list.length,
    memory: list.reduce((sum, item) => sum + item.memoryCount, 0),
    turns: 0,
  })
  if (overview?.stats === undefined) return fromList()
  const raw = overview.stats
  const fallback = fromList()
  // 后端字段叫 memoryEntries（见 src/web.ts），这里做一次归一，缺什么补什么
  return {
    characters: Number(raw.characters ?? fallback.characters),
    memory: Number(raw.memory ?? raw.memoryEntries ?? fallback.memory),
    turns: Number(raw.turns ?? 0),
  }
}
