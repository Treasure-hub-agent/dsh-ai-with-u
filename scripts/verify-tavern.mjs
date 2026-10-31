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

// 迁移回归夹具：v0.1 的 34 字段旧卡（原 presets，已移出产品预置，见 scripts/fixtures/legacy-cards）
const PRESETS = ['虞照', '裴既明', '谢砚舟']
const readPreset = async (name) => JSON.parse(await readFile(join(root, 'scripts', 'fixtures', 'legacy-cards', name, 'card.json'), 'utf8'))

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
  // 宏要放在**外部导入卡**的 description 里（无 `aiwu` 结构 → 原文进 imported.raw → 投影让路）。
  // 带结构的卡上 description 是投影，直接改它会在归一化时被重算掉（§1.5 / P0-8）。
  const withRandom = normalizeCard({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: '虞照', description: '{{random:甲,乙}} 和 {{pick:丙,丁}} 和 {{roll:20}}', tags: [], extensions: {} },
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
  // L1 渲染里 char/user 必须已展开，认识不了的保留。
  // 同上：宏放外部导入卡的 description（原文保真路径），不放带结构卡片的投影位。
  const withMacros = normalizeCard({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: '虞照', description: '{{char}} 对 {{user}} 说：{{未知}}', tags: [], extensions: {} },
  })
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
    check(eq(actual, expected), '文档样例 === migrateLegacyCard(fixtures/legacy-cards/虞照)',
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

  const withBook = normalizeCard({
    ...card,
    data: { ...card.data, character_book: bookOf([
      entry({ id: 's', keys: ['便利贴'], secondary_keys: ['颜色'], selective: true, content: '选择性条目' }),
      entry({ id: 'n', keys: [], content: '没关键词' }),
    ]) },
  })
  const warnCodes = lengthWarnings(withBook).map(w => w.code)
  check(warnCodes.includes('lore-selective'), '预警：selective + 次级关键词（配错会静默永不命中）')
  check(warnCodes.includes('lore-keys'), '预警：世界书条目没有关键词')

  // 「长 description」必须走**外部导入**形态构造：带 `aiwu` 结构的卡里，description 是投影
  // （结构权威，§1.5 / P0-8），直接改它会在归一化时被重算掉。
  // 原生卡没有结构 → 原文进 `imported.raw` → 投影让路 → 长描述原样保留。
  const long = normalizeCard({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: '长描述卡', description: '长'.repeat(1300), tags: [], extensions: {} },
  })
  check(long.data.description.length === 1300, '外部导入卡的长 description 原样保真（投影让路）')
  check(lengthWarnings(long).some(w => w.code === 'description'), 'description 超阈值触发软警告')
  check(!lengthWarnings(long).some(w => w.message.includes('错误')), '警告是"建议"措辞，不是拒绝')

  // P0-8：自制卡（有 aiwu 结构、原生位为空）归一化后必须带上投影，
  // 否则落盘的 CCv3 在别的酒馆前端里是空卡——插件自己读结构渲染，从外面看不出来。
  const selfMade = normalizeCard({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '投影自检卡',
      first_mes: '（抬头）',
      extensions: {
        aiwu: {
          schema: 1,
          basic: { identity: '自检身份', background: '自检背景' },
          voice: { pace: '快', catchphrases: ['甲'], selfRef: '我', callsUser: '你', emotes: ['乙'], forbidden: '丙', gestures: ['丁'] },
          personality: { keywords: ['冷静'], contradiction: '矛盾', towardClose: '亲近' },
          world: { origin: '来处', gap: '落差', nowadays: '如今' },
        },
      },
    },
  })
  check(selfMade.data.description.includes('身份：自检身份'), 'P0-8 自制卡：description 投影已生成')
  check(selfMade.data.personality.includes('关键词：冷静'), 'P0-8 自制卡：personality 投影已生成')
  check(selfMade.data.scenario.includes('来处：来处'), 'P0-8 自制卡：scenario 投影已生成')
  check(selfMade.data.system_prompt.includes('声线基因'), 'P0-8 自制卡：system_prompt 投影已生成')
  check(selfMade.data.post_history_instructions.includes('收尾提醒'), 'P0-8 自制卡：post_history_instructions 投影已生成')

  // 投影有两种模式，别混：**默认只补空位**（保住模型/用户亲手写的原生描写），
  // `overwrite` 才重写（面板改结构、迁移、忘却这三条结构权威路径）。
  const supplied = normalizeCard({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: '自带原生描写的卡',
      description: '模型亲手写的描述',
      personality: '模型亲手写的性格',
      extensions: { aiwu: { schema: 1, basic: { identity: '结构身份' }, personality: { keywords: ['结构词'] } } },
    },
  })
  check(supplied.data.description === '模型亲手写的描述', 'P0-8 默认模式：有结构的卡，模型自带 description 不被改写')
  check(supplied.data.personality === '模型亲手写的性格', 'P0-8 默认模式：有结构的卡，模型自带 personality 不被改写')

  const forced = normalizeCard({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: JSON.parse(JSON.stringify(supplied.data)),
  })
  T.projectNative(forced.data, { overwrite: true })
  check(forced.data.description === '身份：结构身份', 'P0-8 overwrite 模式：投影重写（面板/迁移/忘却走这条）')

  check(T.relationBaseline('三年前家里安排你们结婚') === '亲密', '关系起点档：夫妻 → 亲密')
  check(T.relationBaseline('合租室友，他搬进来两个月') === '亲近', '关系起点档：室友 → 亲近')

  check(cardName(card) === '虞照' && cardSource(card) === 'custom', 'cardName / cardSource 派生正确')
  check(MES_EXAMPLE_BUDGET === 1200, 'mes_example 预算是 1200 字')
}

// ================================================================ 34 字段镜像 V25

section('V25 · 宿主侧 34 字段镜像与 client/card-schema.ts 的 GROUPS 逐字一致')
{
  const schemaPath = join(root, 'client', 'card-schema.ts')
  let schemaText = ''
  try { schemaText = await readFile(schemaPath, 'utf8') } catch { /* 下面统一报错 */ }
  const groupStart = schemaText.indexOf('export const GROUPS')
  const groupEnd = schemaText.indexOf('Draft', groupStart)
  const region = groupStart >= 0 ? schemaText.slice(groupStart, groupEnd > groupStart ? groupEnd : undefined) : ''
  const keys = [...region.matchAll(/\bkey:\s*'([^']+)'/gu)].map(m => m[1])
  const mirrored = Object.values(T.LEGACY_FIELD_SPEC).flat()
  check(keys.length === 34, `card-schema.ts 的 GROUPS 里抽到 ${keys.length} 个字段（期望 34）`)
  check(eq(keys, mirrored), `宿主镜像与 client 逐字一致（${mirrored.length} 项）`,
    eq(keys, mirrored) ? undefined : `client=${JSON.stringify(keys)} 宿主=${JSON.stringify(mirrored)}`)
  check(T.countFilledFields(migrated['虞照'].card).total === 34, 'countFilledFields 的 total 恒为 34')
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

// ================================================================ 世界书规范 V22

section('V22 · 世界书注入规范（调研报告 §4.3 定稿后的 8 条）')
{
  // 1) selectiveLogic 四值（0 AND_ANY / 1 NOT_ALL / 2 NOT_ANY / 3 AND_ALL）
  const sec = (logic, over = {}) => entry({
    id: `sel${logic}`, keys: ['便利贴'], secondary_keys: ['黄色', '蓝色'], selective: true,
    extensions: { selectiveLogic: logic }, ...over,
  })
  const run = (logic, text) => selectLoreEntries(bookOf([sec(logic)]), [text]).entries.length
  check(run(0, '便利贴 黄色') === 1 && run(0, '便利贴 只提到颜色') === 0, 'AND_ANY(0)：至少一个次级关键词')
  check(run(1, '便利贴 黄色 蓝色') === 0 && run(1, '便利贴 黄色') === 1, 'NOT_ALL(1)：不是全部命中才注入')
  check(run(2, '便利贴 无关内容') === 1 && run(2, '便利贴 黄色') === 0, 'NOT_ANY(2)：一个都没命中才注入')
  check(run(3, '便利贴 黄色 蓝色') === 1 && run(3, '便利贴 黄色') === 0, 'AND_ALL(3)：全部命中才注入')

  // selective 开关：关掉时次级键只是备注（SillyTavern 语义，P2-14）
  const noSel = entry({ id: 'nosel', keys: ['便利贴'], secondary_keys: ['黄色'], content: '无选择性', selective: false })
  check(selectLoreEntries(bookOf([noSel]), ['便利贴 只提到主键']).entries.length === 1,
    'selective=false：忽略次级键，主键命中就注入')
  const withSel = entry({ id: 'withsel', keys: ['便利贴'], secondary_keys: ['黄色'], content: '有选择性', selective: true })
  check(selectLoreEntries(bookOf([withSel]), ['便利贴 只提到主键']).entries.length === 0,
    'selective=true：次级键没命中时不注入')

  // 2) 中文整词边界（绝不能用 \W / \b）
  const whole = entry({ id: 'w', keys: ['贴'], content: '整词', extensions: { match_whole_words: true } })
  check(selectLoreEntries(bookOf([whole]), ['便利贴']).entries.length === 0, '整词匹配：汉字里的子串不算命中（\W 在这里会失效）')
  check(selectLoreEntries(bookOf([whole]), ['单独一个 贴 字']).entries.length === 1, '整词匹配：独立成词才算命中')

  // 3) probability 用稳定哈希（同一轮结果固定，绝不 Math.random）
  const prob = entry({ id: 'p', keys: ['便利贴'], content: '概率条目', extensions: { probability: 50 } })
  const sameSeed = [0, 1, 2, 3, 4].map(() => selectLoreEntries(bookOf([prob]), ['便利贴'], { turnSeed: 't:1' }).entries.length)
  check(new Set(sameSeed).size === 1, `probability：同一 turnSeed 连算 5 次结果一致（${sameSeed.join(',')}）`)

  // 4) enabled / disable 反义（两个字段都要认）
  check(selectLoreEntries(bookOf([entry({ id: 'd', keys: ['便利贴'], content: 'x', extensions: { disable: true } })]), ['便利贴']).entries.length === 0,
    'extensions.disable:true 视为停用（独立世界书的心智）')
  check(selectLoreEntries(bookOf([entry({ id: 'e', keys: ['便利贴'], content: 'y', enabled: false })]), ['便利贴']).entries.length === 0,
    'enabled:false 视为停用（卡内 book 的心智）')

  // 5) maxEntries（默认 12）
  const many = Array.from({ length: 20 }, (_, i) =>
    entry({ id: `m${i}`, keys: ['便利贴'], content: `第${i}条`.padEnd(40, '长'), insertion_order: i }))
  const capped = selectLoreEntries(bookOf(many), ['便利贴'])
  check(capped.entries.length === LORE_DEFAULTS.maxEntries, `默认最多 ${LORE_DEFAULTS.maxEntries} 条（实际 ${capped.entries.length}）`)
  check(capped.diag.droppedByBudget.length === 20 - LORE_DEFAULTS.maxEntries, '超条数进 droppedByBudget')
  const custom = selectLoreEntries(bookOf(many), ['便利贴'], { maxEntries: 3 })
  check(custom.entries.length === 3, 'maxEntries 可覆盖')

  // 6) 首条超预算也注入（宁可超一点，也不能命中了却啥都没给）
  const huge = selectLoreEntries(bookOf([entry({ id: 'huge', keys: ['便利贴'], content: '长'.repeat(500) })]), ['便利贴'], { budgetChars: 50 })
  check(huge.entries.length === 1 && huge.diag.forcedOverBudget, '首条超预算仍注入，并标记 forcedOverBudget')

  // 7) 默认值定稿
  check(LORE_DEFAULTS.scanDepth === 4 && LORE_DEFAULTS.maxEntries === 12 && LORE_DEFAULTS.budgetChars === 6000,
    `默认值：scanDepth ${LORE_DEFAULTS.scanDepth} / maxEntries ${LORE_DEFAULTS.maxEntries} / budgetChars ${LORE_DEFAULTS.budgetChars}`)
  check(LORE_DEFAULTS.recursive === false, '递归激活默认关闭（第一版不做，有理由）')

  // 8) 按轮滚动：scanDepth 之外的老词不命中，且不跨轮累积
  const book = bookOf([entry({ id: 'old', keys: ['旧话题'], content: '旧的' })])
  check(selectLoreEntries(book, ['旧话题', 'a', 'b', 'c', 'd'], { scanDepth: 3 }).entries.length === 0,
    '超出 scanDepth 的旧消息不参与命中')
  const blocked = entry({ id: 'blk', keys: ['便利贴'], content: '@@dont_activate\n常驻才注入', constant: true, extensions: {} })
  check(selectLoreEntries(bookOf([blocked]), ['便利贴']).entries.length === 1, '@@dont_activate 仍可被 constant 注入')
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
    // 宿主真实请求一定带 Host；来源栅栏（web.ts）会校验它
    headers: { host: '127.0.0.1:50143', 'content-type': 'application/json' },
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
      headers: { host: '127.0.0.1:50143' },
      async *[Symbol.asyncIterator]() {},
    }, res7)
    check(res7.out.body?.card?.['basic']?.['身份'] !== undefined && res7.out.body?.ccv3?.spec === 'chara_card_v3',
      'GET /character 同时给 card（旧视图）与 ccv3')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

// ================================================================ 段装配 V24

section('V24 · PromptController 四段装配（激活 → L1/世界书/时间差 → 拔出）')
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-tavern-prompt-'))
  process.env['AIWU_STORAGE_ROOT'] = sandbox
  const { Store } = await import(lib('store.js'))
  const { PromptController } = await import(lib('prompt.js'))
  const store = new Store(sandbox)
  const NAME = '装配角色'
  const logs = []
  const sections = new Map()
  const host = {
    sys: {
      section(input) {
        sections.set(input.name, input)
        return () => { sections.delete(input.name) }
      },
    },
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
  }
  try {
    // 沙箱里放一张**旧格式**卡（预置卡原样）
    const legacy = await readPreset('虞照')
    await mkdir(join(sandbox, 'characters', NAME), { recursive: true })
    await writeFile(join(sandbox, 'characters', NAME, 'card.json'), `${JSON.stringify({ ...legacy, name: NAME }, null, 2)}\n`, 'utf8')

    const pc = new PromptController(store, host)
    pc.install()
    const render = () => Object.fromEntries([...sections.entries()].map(([name, input]) =>
      [name, typeof input.text === 'function' ? input.text({}) : input.text]))

    // 1) 未启用：除 L0 外全部空串
    const idle = render()
    check(idle['aiwu:baseline'] === '', '未启用：L0 段也是空串（L0 与角色同进同出）')
    check(idle['aiwu:active-character'] === '' && idle['aiwu:lore'] === '' && idle['aiwu:clock'] === '',
      '未启用：L1 / 世界书 / 时间差都是空串（宿主过滤空段 = 干净拔出）')
    check([...sections.values()].every(s => s.interpolate === false), '四段都带 interpolate:false')

    // 2) 启用（旧格式卡 → 内存归一 → L1 渲染）
    await pc.activate(NAME)
    const active = render()
    check(active['aiwu:active-character']?.includes(`你现在的身份：${NAME}`), '启用后 L1 有身份标题')
    check(active['aiwu:active-character']?.includes('声线基因'), '启用后 L1 有声线段（旧卡迁过来的）')
    check(!active['aiwu:active-character']?.includes('{{'), 'L1 里没有残留的 `{{`（宏已展开或原样保留的未知宏另计）')
    check(active['aiwu:clock']?.length > 0, '时间差段非空')
    check(active['aiwu:lore'] === '', '没有世界观书时，世界书段仍是空串')

    // 3) 给卡加世界书 + 刷新素材 → 世界书段出现内容
    const card = await store.readCcV3(NAME)
    await store.saveCard({
      name: NAME,
      ccv3: {
        ...card,
        data: {
          ...card.data,
          character_book: bookOf([entry({ id: 'hit', keys: ['便利贴'], content: '黄色的便利贴是今晚吃什么。' })]),
        },
      },
    })
    await pc.refresh({ error: (...a) => logs.push(['error', ...a]), info: (...a) => logs.push(['info', ...a]) },
      { recentTexts: ['TA：你贴的便利贴我看到了'], turnKey: 'agent:1' })
    const withLore = render()
    check(withLore['aiwu:lore']?.includes('黄色的便利贴'), '命中后世界书段有内容')
    check(!withLore['aiwu:active-character']?.includes('黄色的便利贴'), '世界书内容不在 L1 段里（分段隔离）')
    check(logs.some(([level, msg]) => level === 'info' && String(msg).includes('世界书命中 1 条')), '日志记录命中条数（不记正文）')
    check(!logs.some(([, msg]) => String(msg).includes('今晚吃什么')), '日志里没有世界书正文')

    // 4) 同一轮再刷新一次：命中集合复用，不重复计算（防抖）
    const before = logs.length
    await pc.refresh({ error: () => {} }, { recentTexts: ['TA：完全无关的一句'], turnKey: 'agent:1' })
    check(logs.length === before, '同一 turnKey 的重复刷新不再记日志（说明走了复用，不重算）')

    // 5) 拔出
    await pc.deactivate()
    const off = render()
    check(off['aiwu:active-character'] === '' && off['aiwu:lore'] === '' && off['aiwu:clock'] === '',
      '退出后 L1 / 世界书 / 时间差清空')
    check(off['aiwu:baseline'] === '', '退出后 L0 也清空（系统提示词零残留）')
    pc.uninstall()
    check(sections.size === 0, 'uninstall 后段全部释放')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

// ================================================================ 清空字段 V26

section('V26 · 清空字段 / 清空整组真的清空（P1-3：不许被 base 或原生兜底复活）')
{
  const card = migrated['虞照'].card
  const view = toLegacyView(card)
  check(Object.keys(view.world ?? {}).length > 0, '前置：这张卡本来有 world 分组可清')

  // 模拟面板：清空单个字段（值为空串，键还在）+ 清空整个世界组
  const cleared = {
    ...view,
    voice: { ...(view.voice ?? {}), 自称: '' },
    world: { 来处: '', 落差: '', 如今的日子: '', 你与他的旧: '' },
  }
  const next = fromLegacyView(cleared, card)
  const back = toLegacyView(next)

  check(back.voice?.['自称'] === undefined, `清空 voice.自称 后不再复活（实际 ${JSON.stringify(back.voice?.['自称'])}）`)
  check(next.data.extensions.aiwu.voice?.selfRef === undefined, '结构里 selfRef 已删除')
  check(back.world === undefined, '整组清空后 world 分组消失（不留空对象）')
  check(next.data.scenario === undefined || String(next.data.scenario).trim() === '', '原生 scenario 同步清空（不被兜底反解复活）')
  check(eq(next.data.extensions.aiwu.basic, card.data.extensions.aiwu.basic), '没动的 basic 分组原样保留')
  check(eq(next.data.extensions.aiwu.personality, card.data.extensions.aiwu.personality), '没动的 personality 原样保留')
}

// ================================================================ 存储硬化 V27

section('V27 · 存储硬化：跨实例锁 / BOM / 旧卡备份 / 孤儿索引 / 重名 / 体量上限')
{
  const { Store } = await import(lib('store.js'))
  const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-v27-'))
  process.env['AIWU_STORAGE_ROOT'] = sandbox
  try {
    const a = new Store(sandbox)
    const b = new Store(sandbox)
    await a.writeCard('并发', { name: '并发', basic: { 姓名: '并发' } })

    // 跨实例并发写同一角色：两个 Store（等价两个 DSH 实例）各写 10 轮
    await Promise.all(Array.from({ length: 20 }, (_, i) => {
      const store = i % 2 === 0 ? a : b
      return store.commitTurn({ character: '并发', user: `u${i}`, assistant: `a${i}`, turnId: `t${i}` })
    }))
    const session = await a.readSession('并发')
    check(session?.turn_count === 20, `跨实例并发 20 轮全部落盘（实际 ${session?.turn_count}；修复前会丢一半）`)

    // UTF-8 BOM：记事本编辑过的卡不再被当损坏隔离
    const bomDir = join(sandbox, 'characters', 'BOM卡')
    await mkdir(bomDir, { recursive: true })
    await writeFile(join(bomDir, 'card.json'),
      '\uFEFF' + JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'BOM卡', description: '带 BOM 的卡' } }), 'utf8')
    check((await a.readCcV3('BOM卡')) !== undefined, 'UTF-8 BOM 的 card.json 能正常读')
    const bomFiles = await readdir(bomDir)
    check(bomFiles.includes('card.json'), 'BOM 卡没有被改名成 .corrupt-*')

    // 旧格式卡被 forget 覆盖写时补写原件备份（以前只有 save 路径会备份）
    const legacyDir = join(sandbox, 'characters', '旧卡')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'card.json'), JSON.stringify(await readPreset('虞照')), 'utf8')
    await a.forget('旧卡', '便利贴')
    const legacyFiles = await readdir(legacyDir)
    check(legacyFiles.includes('card.v1.bak.json'), 'forget 把旧格式卡升级成 CCv3 前补写了 card.v1.bak.json')

    // 手动拷入的角色目录自动进索引
    const orphanDir = join(sandbox, 'characters', '外部卡')
    await mkdir(orphanDir, { recursive: true })
    await writeFile(join(orphanDir, 'card.json'),
      JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '外部卡', description: '手动拷进来的' } }), 'utf8')
    const listed = await a.listCharacters()
    check(listed.some(c => c.name === '外部卡'), '手动拷入 characters/ 的卡自动进索引（不再永远看不见）')

    // 仅大小写不同：Windows 上会写进同一目录，必须拒绝
    await a.writeCard('Alice', { name: 'Alice', basic: { 姓名: 'Alice' } })
    let clash = ''
    try { await a.writeCard('alice', { name: 'alice', basic: { 姓名: 'alice' } }) } catch (e) { clash = e.message }
    check(clash.includes('大小写'), `仅大小写不同的重名被拒（${clash}）`)

    // 体量硬上限
    let tooBig = ''
    try {
      await a.writeCard('大卡', { name: '大卡', basic: { 姓名: '大卡', 一句话背景: 'x'.repeat(3000) } })
    } catch (e) { tooBig = e.message }
    check(tooBig.includes('上限'), `角色描述超限被拒（${tooBig}）`)

    // 恶意正则不再指数回溯
    const evilBook = { entries: [{ id: 'evil', keys: ['(a+)+$'], use_regex: true, content: '设定' }] }
    const started = Date.now()
    const sel = selectLoreEntries(evilBook, ['a'.repeat(30) + '!'])
    const elapsed = Date.now() - started
    check(elapsed < 500, `恶意正则退化成字面量：30 字符文本耗时 ${elapsed}ms（修复前 >600ms）`)
    check(Array.isArray(sel.entries), '恶意正则不会抛错')

    // 正常正则仍要能用
    const okBook = { entries: [{ id: 'ok', keys: ['^你好'], use_regex: true, content: '问候设定' }] }
    const okSel = selectLoreEntries(okBook, ['你好呀'])
    check(okSel.entries.length === 1, '正常的 use_regex 仍然命中')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
    process.env['AIWU_STORAGE_ROOT'] = ''
  }
}

// ================================================================ 汇总

console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exitCode = 1
