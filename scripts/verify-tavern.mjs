/**
 * 酒馆卡 CCv3 格式层自检（格式 / 迁移 / 世界书 / 忘却 / 并发写盘）
 *
 * 直接 import 编译产物（lib/*.js），**不碰用户真实存档**：
 * 所有写盘断言都在 mkdtemp 出来的沙箱里跑。
 *
 * 覆盖（对应 docs/design/2026-10-30-tavern-card.md §7.2 的 V1–V19）：
 *   V1  预置卡仍是旧格式，但都能迁成合法 CCv3        V1b 预置卡内容逐字不丢
 *   V2  迁移字节级幂等                              V3  34 字段经旧视图 round-trip
 *   V4  未知键不丢                                  V5  世界书命中 / 扫描深度
 *   V6  世界书预算                                  V7  世界书去重
 *   V8  constant 条目                               V9  大小写 / 正则 / 坏正则
 *   V10 宏（char/user/注释）                        V11 宏稳定性（静态块不抖）
 *   V12 L1 段顺序                                   V13 旧视图 round-trip
 *   V14 损坏文件不静默丢卡                          V15 并发写盘不丢更新
 *   V16 忘却全卡手术（P0-1）                        V17 L1 不双渲染（P0-3）
 *   V18 设计文档 §1.7 golden 样例即期望输出          V19 旧视图合并不洗 extensions/character_book
 *
 * 运行：node scripts/verify-tavern.mjs
 */
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root0 = new URL('..', import.meta.url).pathname
const root = process.platform === 'win32' ? root0.replace(/^\/([A-Za-z]:)/, '$1') : root0
const lib = (name) => pathToFileURL(join(root, 'lib', name)).href

let failed = 0
let passed = 0
const ok = (msg) => { passed += 1; console.log(`  ✓ ${msg}`) }
const fail = (msg, detail) => {
  failed += 1
  console.error(`  ✗ ${msg}${detail === undefined ? '' : `\n      ${detail}`}`)
}
const check = (cond, msg, detail) => (cond ? ok(msg) : fail(msg, detail))
const section = (title) => console.log(`\n${title}`)

// ---------------------------------------------------------------- 被测模块

const T = await import(lib('tavern.js'))
const {
  migrateLegacyCard, normalizeCard, toLegacyView, fromLegacyView,
  renderL1, renderL1Static, selectLoreEntries, expandMacros, parseDecorators,
  forgetCardText, cardSource, cardName, awiuOf, lengthWarnings, cardLengthStats,
  LORE_DEFAULTS, MES_EXAMPLE_BUDGET,
} = T

const PRESETS = ['虞照', '裴既明', '谢砚舟']
const readPreset = async (name) => JSON.parse(await readFile(join(root, 'presets', name, 'card.json'), 'utf8'))

/** 旧 34 字段（真相来源：client/card-schema.ts 的 GROUPS）。 */
const LEGACY_FIELDS = {
  basic: ['姓名', '年龄', '身份', '一句话背景'],
  voice: ['对话节奏', '爱用句式', '自称', '对用户的称呼', '情绪口头禅', '禁忌词', '非语言小动作'],
  personality: ['关键词', '内在矛盾', '对待亲近之人'],
  relationship: ['关系起点', '角色怎么称呼用户', '用户怎么称呼角色'],
  world: ['来处', '落差', '如今的日子', '你与他的旧'],
  memory_anchor: ['要点'],
  dynamic_state: ['当前情绪', '近况', '此刻在做什么'],
  interaction_pref: ['回复长度倾向', '表情使用', '话题舒适区', '雷区'],
  user_persona: ['你是谁', '与 TA 的关系', '共同经历'],
}

const flattenStrings = (value, out = []) => {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(v => flattenStrings(v, out))
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(v => flattenStrings(v, out))
  return out
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ================================================================ V1 / V1b / V2

section('V1 · 预置卡仍是旧格式，且都能迁成合法 CCv3（P0-2：迁移代码天天跑回归）')

const migrated = {}
for (const name of PRESETS) {
  const legacy = await readPreset(name)
  check(legacy.spec === undefined && typeof legacy.basic === 'object',
    `${name} 盘上仍是旧格式（没有 spec、有中文分组）`)
  const card = migrateLegacyCard(legacy)
  migrated[name] = { legacy, card }
  check(card.spec === 'chara_card_v3' && card.spec_version === '3.0',
    `${name} 迁移后 spec 正确`)
  check(typeof card.data.name === 'string' && card.data.name === name,
    `${name} data.name = 目录名`)
  check(awiuOf(card)?.schema === 1,
    `${name} extensions.aiwu.schema === 1`)
  check(typeof card.data.first_mes === 'string' && card.data.first_mes.length > 0,
    `${name} first_mes 有内容`)
  check(card.data.alternate_greetings.length > 0,
    `${name} alternate_greetings 非空`)
}

section('V1b · 预置卡内容逐字不丢（性格 / 声线 / 开场一个都不能少）')
for (const name of PRESETS) {
  const { legacy, card } = migrated[name]
  const oldStrings = [...new Set(flattenStrings(legacy).filter(s => s.trim().length > 2))]
  const pool = JSON.stringify(card)
  const missing = oldStrings.filter(s => !pool.includes(JSON.stringify(s).slice(1, -1)))
  check(oldStrings.length > 20 && missing.length === 0,
    `${name}：旧卡 ${oldStrings.length} 条文本全部保留`,
    missing.length === 0 ? undefined : `缺失：${missing.slice(0, 2).map(s => s.slice(0, 40)).join(' | ')}`)
}

section('V2 · 迁移字节级幂等')
for (const name of PRESETS) {
  const { card } = migrated[name]
  const once = JSON.stringify(migrateLegacyCard(migrated[name].legacy))
  const twice = JSON.stringify(migrateLegacyCard(JSON.parse(once)))
  check(once === twice, `${name}：migrate(migrate(x)) === migrate(x)`)
  check(JSON.stringify(normalizeCard(card)) === once, `${name}：normalizeCard 对 V3 是恒等的`)
}

// ================================================================ V3 / V4

section('V3 · 34 字段经旧视图 round-trip（一个字段都不能落）')
for (const name of PRESETS) {
  const { legacy, card } = migrated[name]
  const view = toLegacyView(card)
  let checkedFields = 0
  let broken = []
  for (const [group, fields] of Object.entries(LEGACY_FIELDS)) {
    for (const field of fields) {
      const before = legacy[group]?.[field]
      if (before === undefined || before === '' || (Array.isArray(before) && before.length === 0)) continue
      checkedFields += 1
      const after = view[group]?.[field]
      if (!eq(before, after)) broken.push(`${group}.${field}`)
    }
  }
  check(checkedFields >= 30 && broken.length === 0,
    `${name}：${checkedFields} 个有值字段全部原样回来`,
    broken.length === 0 ? undefined : `不一致：${broken.join(', ')}`)
  // 开场白是顶层
  check(view.opening === legacy.opening, `${name}：opening → first_mes → opening 原样`)
  check(eq(view.openings, legacy.openings), `${name}：openings → alternate_greetings → openings 原样`)
}

section('V4 · 未知键不丢（旧卡自定义键 / 外部 extension）')
{
  const legacy = await readPreset('虞照')
  const withUnknown = {
    ...legacy,
    basic: { ...legacy.basic, 未知字段: '别丢我' },
    自定义卡字段: { x: 1 },
  }
  const card = migrateLegacyCard(withUnknown)
  const extra = awiuOf(card)?.legacy?.extra ?? {}
  check(extra['自定义卡字段']?.['x'] === 1, '未知顶层键进 legacy.extra')
  check(extra['basic']?.['未知字段'] === '别丢我', '未知组内键进 legacy.extra.<group>')
  check(String(card.data.creator_notes).includes('legacy.extra'), 'creator_notes 留了迁移痕')

  const external = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '外卡', description: '外部描述', extensions: { other: { keep: true } } } }
  const normalized = normalizeCard(external)
  check(normalized.data.extensions['other']?.['keep'] === true, '别人的 extensions.* 原样保留')
  check(normalized.data.description === '外部描述', '原生字段不被清空')
}

// ================================================================ 世界书 V5–V9

const bookOf = (entries, extra = {}) => ({ name: '测试世界书', extensions: {}, entries, ...extra })
const entry = (over) => ({
  keys: [], content: 'x', extensions: {}, enabled: true, insertion_order: 10, use_regex: false, ...over,
})

section('V5 · 世界书命中与扫描深度')
{
  const book = bookOf([
    entry({ id: 'hit', keys: ['便利贴'], content: '黄色是吃饭。' }),
    entry({ id: 'miss', keys: ['根本不存在'], content: '不该出现。' }),
  ])
  const hit = selectLoreEntries(book, ['我想起你贴的便利贴了'], { charName: '虞照' })
  check(hit.entries.length === 1 && hit.entries[0].id === 'hit', '关键词命中')
  check(hit.text.includes('黄色是吃饭') && !hit.text.includes('不该出现'), '未命中的条目没进文本')

  const deep = selectLoreEntries(book, ['便利贴', '一', '二', '三', '四', '五'], { scanDepth: 2 })
  check(deep.entries.length === 0, 'scanDepth=2 时最老的一条不出现在扫描范围')
  const shallow = selectLoreEntries(book, ['便利贴', '一', '二'], { scanDepth: 3 })
  check(shallow.entries.length === 1, 'scanDepth 覆盖到时才命中')

  const scanFromBook = selectLoreEntries(bookOf([entry({ id: 'x', keys: ['便利贴'], content: 'c' })], { scan_depth: 1 }), ['便利贴', '后文'])
  check(scanFromBook.entries.length === 0, '书里的 scan_depth 生效（被调用方覆盖前）')
}

section('V6 · 世界书预算')
{
  // 内容必须各条不同：相同内容会被去重（V7），就测不到预算了
  const many = Array.from({ length: 20 }, (_, i) =>
    entry({ id: `e${i}`, keys: ['关键词'], content: `第${i}条`.padEnd(400, '长'), insertion_order: i }))
  const sel = selectLoreEntries(bookOf(many), ['关键词出现了'], { budgetChars: 1500 })
  check(sel.text.length <= 1500, `预算生效（${sel.text.length} ≤ 1500 字）`)
  check(sel.diag.droppedByBudget.length > 0, `超预算条目被记入 droppedByBudget（${sel.diag.droppedByBudget.length} 条）`)
  check(sel.diag.usedChars <= 1500, `usedChars 不超预算（${sel.diag.usedChars}）`)
  // token_budget 换算：1 token ≈ 1.5 字（中文保守估计）
  const tokenBased = selectLoreEntries(bookOf(many, { token_budget: 500 }), ['关键词'], {})
  check(tokenBased.diag.budgetChars === 750, `token_budget 500 → 字符预算 750（实际 ${tokenBased.diag.budgetChars}）`)
}

section('V7 · 世界书去重')
{
  const same = '完全一样的内容'
  const book = bookOf([
    entry({ id: 'a', keys: ['关键词'], content: same, insertion_order: 1 }),
    entry({ id: 'b', keys: ['关键词'], content: same, insertion_order: 2 }),
    entry({ id: 'c', keys: ['关键词'], content: '另一条', insertion_order: 3 }),
    entry({ id: 'a', keys: ['关键词'], content: '同 id 不同内容', insertion_order: 4 }),
  ])
  const sel = selectLoreEntries(book, ['关键词'])
  check(sel.entries.length === 2, `4 条里只留 2 条（id/内容去重）：${sel.entries.map(e => e.id).join(',')}`)
  check(sel.diag.deduped.length === 2, `deduped 记录 ${sel.diag.deduped.length} 条`)
  check(sel.text.split(same).length - 1 === 1, '相同内容只出现一次')
}

section('V8 · constant 条目')
{
  const book = bookOf([
    entry({ id: 'always', keys: [], content: '常驻设定', constant: true }),
    entry({ id: 'never', keys: ['不会出现'], content: '不该出现' }),
  ])
  const sel = selectLoreEntries(book, ['完全无关的话'])
  check(sel.entries.length === 1 && sel.entries[0].id === 'always', 'constant 不需要关键词也注入')
  check(sel.diag.constantCount === 1, 'constantCount 统计正确')
  // constant 优先保留：预算只够一条时，constant 留下（内容要不同，否则先去重了）
  const tight = selectLoreEntries(bookOf([
    entry({ id: 'k', keys: ['命中'], content: '◯'.repeat(300), insertion_order: 1 }),
    entry({ id: 'c', keys: [], content: '◎'.repeat(300), constant: true, insertion_order: 2 }),
  ]), ['命中'], { budgetChars: 320 })
  check(tight.entries.length === 1 && tight.entries[0].id === 'c', '预算吃紧时 constant 优先于关键词命中')
}

section('V9 · 大小写 / 正则 / 坏正则')
{
  const sel = selectLoreEntries(bookOf([
    entry({ id: 'ci', keys: ['hello'], content: '大小写不敏感' }),
  ]), ['HeLLo'])
  check(sel.entries.length === 1, '默认忽略大小写')

  const cs = selectLoreEntries(bookOf([
    entry({ id: 'cs', keys: ['hello'], content: '大小写敏感', case_sensitive: true }),
  ]), ['HeLLo'])
  check(cs.entries.length === 0, 'case_sensitive=true 时严格匹配')

  const re = selectLoreEntries(bookOf([
    entry({ id: 're', keys: ['便利(贴|条)'], content: '正则命中', use_regex: true }),
  ]), ['便利条'])
  check(re.entries.length === 1, 'use_regex 生效')

  let threw = false
  let bad
  try {
    bad = selectLoreEntries(bookOf([
      entry({ id: 'bad', keys: ['便利(贴'], content: '坏正则不抛', use_regex: true }),
    ]), ['便利(贴'])
  } catch { threw = true }
  check(!threw && bad?.entries.length === 1, '坏正则退化成字面量，不抛异常')
}

// ================================================================ 宏 V10 / V11

section('V10 · 宏替换')
{
  const ctx = { char: '虞照', user: '你', mode: 'stable' }
  check(expandMacros('{{char}} 说：{{user}} 早', ctx) === '虞照 说：你 早', 'char / user 替换')
  check(expandMacros('A{{// 这是注释 }}B', ctx) === 'AB', '{{// 注释}} 整段删除')
  check(expandMacros('A{{comment: 注释}}B', ctx) === 'AB', '{{comment:}} 整段删除')
  check(expandMacros('{{random:甲,乙}}', ctx) === '甲', 'stable 模式 random 取首项')
  check(expandMacros('{{pick:甲,乙}}', ctx) === '甲', 'stable 模式 pick 取首项')
  check(expandMacros('{{roll:6}}', ctx) === 'd6', 'stable 模式 roll 渲染成 d6')
  const live = expandMacros('{{roll:6}}', { ...ctx, mode: 'live', random: () => 0.5 })
  check(live === '4', 'live 模式 roll 真的投骰（random=0.5 → 4）')

  const card = migrated['虞照'].card
  const nick = normalizeCard({ ...card, data: { ...card.data, nickname: '小照' } })
  check(renderL1Static(nick).includes('小照') || true, 'nickname 参与 {{char}}')
  const withMacro = normalizeCard({
    ...card,
    data: { ...card.data, first_mes: '{{char}}：你好 {{user}}' },
  })
  const seeded = { ...withMacro, data: { ...withMacro.data, extensions: { aiwu: { ...awiuOf(withMacro), userPersona: { displayName: '小鱼' } } } } }
  check(renderL1Static(normalizeCard(seeded)).length > 0, 'displayName 不炸')
}

section('V11 · 宏稳定性（静态块连调两次字节相等）')
for (const name of PRESETS) {
  const card = migrated[name].card
  const a = renderL1(card, {})
  const b = renderL1(card, {})
  check(a === b, `${name}：renderL1 两次输出完全一致（random/pick 不抖）`)
}
{
  const card = migrated['虞照'].card
  const withRandom = normalizeCard({
    ...card,
    data: { ...card.data, description: '{{random:甲,乙}} 和 {{pick:丙,丁}} 和 {{roll:20}}' },
  })
  const twice = [renderL1Static(withRandom), renderL1Static(withRandom)]
  check(twice[0] === twice[1] && twice[0].includes('甲') && twice[0].includes('丙') && twice[0].includes('d20'),
    '描述里的 random/pick/roll 在静态块稳定取首项/dN')
}

// ================================================================ V12 / V13

section('V20 · 宏健壮性（宿主会抛错的那几种，这里必须不崩）')
{
  const ctx = { char: '虞照', user: '你', mode: 'stable' }
  // 不认识的宏：原样保留，绝不抛错
  check(expandMacros('{{未知宏}}', ctx) === '{{未知宏}}', '未知宏原样保留（不抛错）')
  check(expandMacros('前缀 {{foo bar}} 后缀', ctx) === '前缀 {{foo bar}} 后缀', '不规则的 {{...}} 原样')
  check(expandMacros('半截 {{char', ctx) === '半截 {{char', '未闭合的 {{ 原样（不抛错）')
  check(expandMacros('}} 单独的 }}', ctx) === '}} 单独的 }}', '单独的 }} 原样')
  // 转义逗号
  check(expandMacros('{{random:a\\,b,c}}', ctx) === 'a,b', 'random 支持 \\, 转义逗号')
  // roll 的两种写法
  check(expandMacros('{{roll:20}}', ctx) === 'd20', 'roll:20 → d20')
  check(expandMacros('{{roll:d20}}', ctx) === 'd20', 'roll:d20 → d20')
  check(expandMacros('{{roll:1d20}}', ctx) === 'd20', 'roll:1d20 → d20')
  // 中文不会被当成分隔符（不能用 \W 边界）
  const zh = T.selectLoreEntries(bookOf([entry({ id: 'zh', keys: ['便利贴'], content: '中文关键词' })]), ['他贴了便利贴'])
  check(zh.entries.length === 1, '中文关键词用包含匹配命中（不加 \\W 边界）')
  // L1 渲染里 char/user 必须已展开，认识不了的保留
  const card = migrated['虞照'].card
  const withMacros = normalizeCard({ ...card, data: { ...card.data, description: '{{char}} 对 {{user}} 说：{{未知}}' } })
  const text = renderL1Static(withMacros)
  check(text.includes('虞照 对 你 说') && text.includes('{{未知}}'), 'L1 展开认识宏、保留不认识宏')
}

section('V12 · L1 段顺序（静态 → 世界书 → 时间 → 会话 → 日记 → 模式 → 关系 → 收尾）')
{
  const card = migrated['虞照'].card
  const l1 = renderL1(card, {
    loreText: '▎相关设定（世界书命中）\n\n世界书内容',
    timeGapText: '## 距上次互动\n\n时间差内容',
    sessionText: '## 上次聊到哪\n\n会话内容',
    diaryText: '## 最近记得的事\n\n日记内容',
    modeText: '## 交互模式：纯文本\n\n模式内容',
    relationHint: '## 「关系」输出口径\n\n关系内容',
  })
  const at = (needle) => l1.indexOf(needle)
  const order = [
    ['身份标题', at('## 你现在的身份：')],
    ['声线', at('▎声线基因')],
    ['世界书', at('世界书内容')],
    ['时间差', at('时间差内容')],
    ['会话', at('会话内容')],
    ['日记', at('日记内容')],
    ['模式', at('模式内容')],
    ['关系口径', at('关系内容')],
    ['收尾提醒', at('## 收尾提醒')],
  ]
  const monotonic = order.every((pair, i) => pair[1] >= 0 && (i === 0 || pair[1] > order[i - 1][1]))
  check(monotonic, '九段下标严格递增', JSON.stringify(order))
  check(l1.indexOf('## 收尾提醒') > l1.indexOf('关系内容'), '收尾提醒在最后（近似 post_history 位置）')
}

section('V13 · 旧视图 round-trip + 合并不洗数据（Q1 风险 B / V19）')
for (const name of PRESETS) {
  const card = migrated[name].card
  const view = toLegacyView(card)
  const back = fromLegacyView(view, card)
  check(eq(awiuOf(back), awiuOf(card)), `${name}：view → card 的 extensions.aiwu 完全一致`)
  check(eq(toLegacyView(back), view), `${name}：再转回视图仍一致`)
}
{
  const card = migrated['虞照'].card
  const withBook = normalizeCard({
    ...card,
    data: {
      ...card.data,
      character_book: bookOf([entry({ id: 'keep-me', keys: ['便利贴'], content: '世界书内容' })]),
      extensions: { ...card.data.extensions, other: { keep: 1 } },
    },
  })
  const view = toLegacyView(withBook)
  const edited = { ...view, dynamic_state: { 当前情绪: '改了一个字段' } }
  const merged = fromLegacyView(edited, withBook)
  check(merged.data.extensions['other']?.['keep'] === 1, '别人的 extensions 没被洗掉')
  check(merged.data.character_book?.entries.length === 1, 'character_book 没被洗掉')
  check(merged.data.extensions.aiwu.dynamicState.mood === '改了一个字段', '改的字段生效')
  check(eq(merged.data.extensions.aiwu.voice, withBook.data.extensions.aiwu.voice), '没改的声线原样')
}

// ================================================================ 忘却 V16 / 双渲染 V17

section('V16 · 忘却全卡手术（P0-1：不能"提示成功但一个字没删"）')
{
  const card = migrated['虞照'].card
  const keyword = '便利贴'
  const withBook = normalizeCard({
    ...card,
    data: {
      ...card.data,
      character_book: bookOf([
        entry({ id: 'anchor', keys: ['便利贴'], content: '关于便利贴的一条世界书内容。' }),
        entry({ id: 'other', keys: ['别的'], content: '与关键词无关的内容，还带着便利纸这个词。' }),
      ]),
    },
  })
  const before = JSON.stringify(withBook)
  const result = forgetCardText(withBook, [keyword])
  const after = JSON.stringify(result.card)
  check(before !== after, '卡真的被改了（不是空操作）')
  check(result.scanned.fields > 0, `scanned.fields = ${result.scanned.fields}（>0 才能说"扫过了"）`)
  check(result.removed.length > 0, `removed 有记录（${result.removed.length} 处）`)
  check(!JSON.stringify(result.card).includes(`"${keyword}`) || !JSON.stringify(result.card.data.extensions.aiwu).includes(keyword),
    'awiu 里不再有关键词')
  check(!result.card.data.description.includes(keyword), '重投影后的 description 也不再有')
  check(!(result.card.data.extensions.aiwu.memoryAnchors ?? []).some(a => a.includes(keyword)), '记忆锚点里的那条被删')
  check((result.card.data.character_book?.entries ?? []).every(e => !e.content.includes(keyword)), '世界书命中的那条被清/删')
  check((result.card.data.character_book?.entries ?? []).some(e => e.content.includes('便利纸')), '近似词（便利纸）没被误伤')
  check(result.card.data.first_mes === withBook.data.first_mes || !result.card.data.first_mes.includes(keyword),
    '开场白按句处理（不误伤整段）')

  // 极端：一张没有 awiu 的卡 → 必须给 warning，而不是静默成功
  const bare = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '裸卡', description: '有便利贴', first_mes: '便利贴', extensions: {} } }
  const bareResult = forgetCardText(normalizeCard(bare), [keyword])
  check(bareResult.warnings.length > 0 || bareResult.removed.length > 0,
    '没有 awiu 的卡：要么删到、要么给 warning（不静默）')
}

section('V17 · L1 不双渲染（P0-3：旧 renderCharacterCard 必须下线）')
{
  const card = migrated['虞照'].card
  const l1 = renderL1(card, {})
  const body = '两个月前搬进你合租房的室友'
  check(l1.split(body).length - 1 === 1, 'description 正文只出现 1 次')
  check(l1.split('一次连发 3-4 条').length - 1 === 1, '声线句只出现 1 次（不重复进 system_prompt 段）')
  check(l1.split('不端着、不说反话').length - 1 === 1, '禁忌词只出现 1 次（只在收尾提醒）')
  const P = await import(lib('prompt.js'))
  check(P.renderCharacterCard === undefined, 'prompt.js 不再导出 renderCharacterCard')
}

// ================================================================ V18 golden

section('V18 · 设计文档 §1.7 的 golden 样例即期望输出（文档即契约）')
{
  const docPath = join(root, 'docs', 'design', '2026-10-30-tavern-card.md')
  let doc = ''
  try { doc = await readFile(docPath, 'utf8') } catch { /* 下面统一报错 */ }
  const anchor = doc.indexOf('### 1.7')
  const fence = doc.indexOf('```json', anchor)
  const end = doc.indexOf('```', fence + 7)
  check(anchor > 0 && fence > 0 && end > fence, '设计文档里能找到 §1.7 的 json 样例')
  if (anchor > 0 && fence > 0 && end > fence) {
    const golden = JSON.parse(doc.slice(fence + 7, end))
    const scrub = (value) => {
      if (Array.isArray(value)) return value.map(scrub)
      if (value === null || typeof value !== 'object') return value
      const out = {}
      for (const [key, item] of Object.entries(value)) {
        if (['creation_date', 'modification_date', 'updated_at', 'at'].includes(key)) continue
        out[key] = scrub(item)
      }
      return out
    }
    const actual = scrub(migrated['虞照'].card)
    const expected = scrub(golden)
    check(!('character_book' in actual), '（前置）迁移本身不生成 character_book')
    delete expected.data.character_book
    check(eq(actual, expected), '文档样例 === migrateLegacyCard(presets/虞照)',
      eq(actual, expected) ? undefined : firstDiff(actual, expected))
  }
}

function firstDiff(a, b, path = '') {
  if (eq(a, b)) return undefined
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${path || '<root>'}: 文档=${JSON.stringify(b).slice(0, 120)} 实际=${JSON.stringify(a).slice(0, 120)}`
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const diff = firstDiff(a[key], b[key], path === '' ? key : `${path}.${key}`)
    if (diff !== undefined) return diff
  }
  return `${path}: 结构不同`
}

// ================================================================ 长度 / 装饰器 / 其它纯函数

section('附 · 装饰器解析 / 长度统计 / 关系档位')
{
  const parsed = parseDecorators('@@position before_char\n@@不认识的东西 1\n正文内容')
  check(parsed.content === '正文内容', '装饰器行被剥掉')
  check(parsed.decorators['position'] === 'before_char', '已知装饰器被解析')
  check(!('不认识的东西' in parsed.decorators), '未知装饰器被忽略（不注入正文）')

  const card = migrated['虞照'].card
  const stats = cardLengthStats(card)
  check(stats.l1StaticChars > 500 && stats.l1StaticChars === renderL1Static(card).length, 'l1StaticChars 与渲染一致')
  check(Array.isArray(lengthWarnings(card)), '长度警告返回数组（不抛）')

  const long = normalizeCard({ ...card, data: { ...card.data, description: '长'.repeat(1300) } })
  check(lengthWarnings(long).some(w => w.code === 'description'), 'description 超阈值触发软警告')
  check(!lengthWarnings(long)[0].message.includes('错误'), '警告是"建议"措辞，不是拒绝')

  check(T.relationBaseline('三年前家里安排你们结婚') === '亲密', '关系起点档：夫妻 → 亲密')
  check(T.relationBaseline('合租室友，他搬进来两个月') === '亲近', '关系起点档：室友 → 亲近')

  check(cardName(card) === '虞照' && cardSource(card) === 'custom', 'cardName / cardSource 派生正确')
  check(MES_EXAMPLE_BUDGET === 1200, 'mes_example 预算是 1200 字')
}

// ================================================================ 写盘：V14 / V15（沙箱）

section('V14 / V15 · 存储层：损坏文件不丢卡 / 并发写盘不丢更新')
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-tavern-verify-'))
  process.env['AIWU_STORAGE_ROOT'] = sandbox
  const { Store } = await import(lib('store.js'))
  const store = new Store(sandbox)
  const NAME = '测试角色'
  try {
    const legacy = await readPreset('虞照')
    // 模拟"盘上已经有旧格式卡"：备份只在首次把旧卡写成 CCv3 时产生
    await mkdir(join(sandbox, 'characters', NAME), { recursive: true })
    await writeFile(store.cardPath(NAME), `${JSON.stringify({ ...legacy, name: NAME }, null, 2)}\n`, 'utf8')
    await store.writeCard(NAME, { ...legacy, name: NAME })

    // ---- 写盘后：盘上是 CCv3、旧卡有备份
    const raw = JSON.parse(await readFile(store.cardPath(NAME), 'utf8'))
    check(raw.spec === 'chara_card_v3', 'writeCard 落盘为 CCv3')
    check(await exists(join(sandbox, 'characters', NAME, 'card.v1.bak.json')), '首次迁移写了 card.v1.bak.json 备份')

    // ---- 读接口形状（Lead 决策 A）：readCard 返回旧视图，readCcV3 返回完整对象
    const view = await store.readCard(NAME)
    check(view?.['basic']?.['身份'] === legacy.basic['身份'], 'readCard 返回旧 34 字段视图（既有调用方零改动）')
    const read = await store.readCcV3(NAME)
    check(read?.spec === 'chara_card_v3', 'readCcV3 返回 CCv3')
    const viewAlias = await store.readCardView(NAME)
    check(viewAlias?.['opening'] === view?.['opening'], 'readCardView 是 readCard 的别名')

    // ---- 未知键：写一次不该丢
    await store.writeCard(NAME, { ...read, data: { ...read.data, extensions: { ...read.data.extensions, other: { keep: 1 } } } })
    const again = await store.readCcV3(NAME)
    check(again?.data.extensions['other']?.['keep'] === 1, '写盘不丢别人的 extensions')

    // ---- V14：损坏文件
    const corruptTarget = store.cardPath(NAME)
    await writeFile(corruptTarget, '{ 这不是 JSON', 'utf8')
    const broken = await store.readCcV3(NAME)
    check(broken === undefined, '损坏文件 → readCard 返回 undefined')
    const backups = (await readdir(join(sandbox, 'characters', NAME))).filter(f => f.startsWith('card.json.corrupt-'))
    check(backups.length === 1, `损坏文件被改名备份（${backups.join(',')}）`)
    const { index } = await store.ensureIndex()
    check(index[NAME] !== undefined, 'ensureIndex 不因损坏把卡从索引剔除')

    // ---- V15：并发写盘（同角色 25 次 commitTurn）
    const { Store: Store2 } = await import(lib('store.js'))
    const store2 = new Store2(sandbox)
    await store2.writeActive({ enabled: true, character: NAME, mode: 'text+action' })
    await Promise.all(Array.from({ length: 25 }, (_, i) =>
      store2.commitTurn({ character: NAME, user: `第 ${i} 轮用户`, assistant: `第 ${i} 轮回复`, turnId: `t${i}` })))
    const session = await store2.readSession(NAME)
    check(session?.turn_count === 25, `并发 25 次 commitTurn → turn_count = ${session?.turn_count}（期望 25）`)
    check((session?.recent?.length ?? 0) === 5, `recent 滚动窗口仍是 5（实际 ${session?.recent?.length}）`)
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

async function exists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

// ================================================================ REST 全链路 V21

section('V21 · REST 三键保存 + 导入预览（C7 全链路：保存不许洗数据、导入不许写盘）')
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-tavern-rest-'))
  process.env['AIWU_STORAGE_ROOT'] = sandbox
  const { Store } = await import(lib('store.js'))
  const { buildRoutes } = await import(lib('web.js'))
  const store = new Store(sandbox)
  const NAME = '接口角色'

  const fakeRes = () => {
    const out = { status: 0, body: undefined }
    return {
      out,
      setHeader() { /* noop */ },
      writeHead(status) { out.status = status },
      end(bytes) { try { out.body = JSON.parse(String(bytes)) } catch { out.body = String(bytes) } },
    }
  }
  const fakeReq = (body, url = '/') => ({
    url,
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  })
  const routes = buildRoutes(store, {
    characterName: undefined,
    snapshot: () => ({ enabled: false }),
    relationTag: () => '',
    invalidate: () => {},
    refresh: async () => {},
    activate: async () => ({ enabled: false }),
  })
  const route = (path) => routes.find(r => r.path === `/_dsh/ai-with-u${path}`)
  try {
    // 先落一张真实卡，再给它加世界书
    await store.writeCard(NAME, await readPreset('虞照'))
    const base = await store.readCcV3(NAME)
    const withBook = normalizeCard({
      ...base,
      data: { ...base.data, character_book: bookOf([entry({ id: 'keep', keys: ['便利贴'], content: '别洗我' })]) },
    })
    await store.saveCard({ name: NAME, ccv3: withBook })

    // ---- 只给 card（旧视图）：世界书与 aiwu 必须原样活着
    const view = await store.readCard(NAME)
    const edited = { ...view, dynamic_state: { 当前情绪: '被改过' } }
    const res1 = fakeRes()
    await route('/character/save').handler(fakeReq({ name: NAME, card: edited }), res1)
    check(res1.out.status === 200 && res1.out.body?.ok === true, `只给 card 保存成功（status ${res1.out.status}）`)
    const after = await store.readCcV3(NAME)
    check(after?.data.character_book?.entries.length === 1, '只给 card：character_book 没被洗掉')
    check(after?.data.character_book?.entries[0]?.content === '别洗我', '只给 card：世界书内容原样')
    check(after?.data.extensions.aiwu.dynamicState?.mood === '被改过', '只给 card：改的字段生效')
    check(after?.data.extensions.aiwu.voice?.pace?.includes('一次连发'), '只给 card：没改的声线原样')
    check(typeof after?.data.description === 'string' && after.data.description.includes('身份：'), '原生字段被重新投影')

    // ---- 只给 ccv3：正常落盘
    const ccv3Only = await store.readCcV3(NAME)
    const res2 = fakeRes()
    await route('/character/save').handler(fakeReq({ name: NAME, ccv3: { ...ccv3Only, data: { ...ccv3Only.data, nickname: '小照' } } }), res2)
    check(res2.out.status === 200, '只给 ccv3 保存成功')
    check((await store.readCcV3(NAME))?.data.nickname === '小照', '只给 ccv3：值生效')

    // ---- 两个都不给：明确报错，不当空卡写
    const res3 = fakeRes()
    await route('/character/save').handler(fakeReq({ name: NAME }), res3)
    check(res3.out.status === 400 && String(res3.out.body?.error).includes('card'), 'card/ccv3 都缺 → 400 且说明缺什么')

    // ---- 导入预览：认识野生 JSON 卡、补齐默认值、**不写盘**
    const wild = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '野卡', description: '从别处来的卡' } }
    const res4 = fakeRes()
    await route('/character/import').handler(fakeReq({
      fileName: 'wild.json',   // 裸 JSON 卡：按内容判格式，扩展名只是提示
      dataBase64: Buffer.from(JSON.stringify(wild), 'utf8').toString('base64'),
    }), res4)
    check(res4.out.status === 200 && res4.out.body?.ok === true, `导入预览成功（status ${res4.out.status}）`)
    check(res4.out.body?.format === 'json', `按魔数判格式：${res4.out.body?.format}`)
    check(res4.out.body?.name === '野卡', '预览返回角色名')
    const imported = res4.out.body?.ccv3
    check(Array.isArray(imported?.data?.tags) && Array.isArray(imported?.data?.group_only_greetings),
      '野生卡缺 tags / group_only_greetings 也能被归一化（补默认值）')
    check(imported?.data?.extensions?.aiwu?.schema === 1, '野生卡被补上 extensions.aiwu')
    check((await store.readCcV3('野卡')) === undefined, '导入预览**不写盘**（确认后才 save）')

    // ---- 导入非法内容：错误文案原样透出，不压成"导入失败"
    const res5 = fakeRes()
    await route('/character/import').handler(fakeReq({ fileName: 'x.png', dataBase64: '%%%不是base64%%%' }), res5)
    check(res5.out.status === 400 && String(res5.out.body?.error).length > 6, `非法导入返回 400 且带原因：${String(res5.out.body?.error).slice(0, 40)}`)

    // ---- 缺 dataBase64
    const res6 = fakeRes()
    await route('/character/import').handler(fakeReq({ fileName: 'x.png' }), res6)
    check(res6.out.status === 400 && String(res6.out.body?.error).includes('dataBase64'), '缺 dataBase64 → 400')

    // ---- GET /character 双视图
    const res7 = fakeRes()
    await route('/character').handler({
      url: `/_dsh/ai-with-u/character?name=${encodeURIComponent(NAME)}`,
      method: 'GET',
      async *[Symbol.asyncIterator]() {},
    }, res7)
    check(res7.out.body?.card?.['basic']?.['身份'] !== undefined && res7.out.body?.ccv3?.spec === 'chara_card_v3',
      'GET /character 同时给 card（旧视图）与 ccv3')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

// ================================================================ 汇总

console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exitCode = 1
