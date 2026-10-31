/**
 * 会话状态持久化 + 原 skill 指令自检
 *
 * 直接 import 编译产物（lib/*.js）在临时目录里跑真实逻辑，不碰用户真实存档：
 *   AIWU_STORAGE_ROOT 指向一个新建的临时存储根。
 *
 * 覆盖：
 *   1. session.json 写入：turn_count / last_ts（带时区偏移）/ recent 滚动窗口
 *   2. 「忘记{事情}」：日记 + 会话摘要 + 卡内记忆锚点/动态状态 三处同步清理（CCv3 下是全卡按句手术）
 *   3. 「改日记{内容}」：就地改写命中的一条，其他条目不动
 *   4. 「全新开始」：会话归零、mode 保留、日记保留
 *   5. 「彻底重置」：会话 + 日记全清
 *   6. 「关系」：非数值档位 + 起点锚定 + 不落盘
 *   7. 「换一句开场」：openings 轮换并持久化游标；有历史档案时不轮换；缺 openings 时生成
 *   8. 宿主事件钩子：agent/turn-stopping 真的会把 session.json 写出来
 *
 * 运行：node scripts/verify-session.mjs
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root0 = new URL('..', import.meta.url).pathname
const root = process.platform === 'win32' ? root0.replace(/^\/([A-Za-z]:)/, '$1') : root0
const lib = (name) => pathToFileURL(join(root, 'lib', name)).href

let failed = 0
let passed = 0
const ok = (msg) => { passed += 1; console.log(`  ✓ ${msg}`) }
const fail = (msg) => { failed += 1; console.error(`  ✗ ${msg}`) }
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))
const section = (title) => console.log(`\n${title}`)

// ---------------------------------------------------------------- 临时存储根

const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-verify-'))
process.env['AIWU_STORAGE_ROOT'] = sandbox
console.log(`沙箱存储根：${sandbox}`)

const { Store, localIsoTimestamp, RELATION_BANDS } = await import(lib('store.js'))
const { createTools } = await import(lib('tools.js'))
const { buildRoutes } = await import(lib('web.js'))

const store = new Store(sandbox)
const NAME = '测试角色'

/** 造一张带 openings 的卡并落盘。 */
const CARD = {
  name: NAME,
  basic: { 姓名: NAME, 身份: '合租室友' },
  personality: { 关键词: ['话多', '爱笑'] },
  voice: { 节奏: '短句连发' },
  relationship: { 关系起点: '合租室友，他搬进来两个月', 角色怎么称呼用户: '你的名字' },
  memory_anchor: { 背景: '两个月前搬进来。他妈妈催他回家过年。' },
  dynamic_state: { 近况: '最近在准备考试，有点焦虑。' },
  interaction_pref: { 长度: '短' },
  source: 'custom',
  opening: '（他把便利贴贴在你显示器边上）记得吃早饭。',
  openings: ['A 版开场：诶你回来了！', 'B 版开场：今天吃什么？', 'C 版开场：帮我把门开着。'],
}
await store.writeCard(NAME, CARD)
await store.writeActive({ enabled: true, character: NAME, mode: 'text+action' })
await store.appendDiary(NAME, '2026 10 01', [
  '[事实] TA 说下周三要考试，压力很大',
  '[在推进] 约好考完一起去吃火锅',
], ['他今天看起来好累，想让他早点休息。'])
await store.appendDiary(NAME, '2026 10 02', [
  '[事实] TA 说想换工作',
], ['得找机会问问 TA 面试的事。'])

// ---------------------------------------------------------------- 1. session 写入

section('1. session.json 写入（turn_count / last_ts / recent）')
{
  const before = await store.readSession(NAME)
  check(before === undefined, '写入前没有 session.json')

  const r1 = await store.commitTurn({ character: NAME, user: '我下周三考试', assistant: '那你别熬夜了', turnId: 't1' })
  check(r1.written === true, '第 1 轮写入成功')
  check(r1.session.turn_count === 1, `turn_count = 1（实际 ${r1.session.turn_count}）`)

  const onDisk = JSON.parse(await readFile(join(sandbox, 'characters', NAME, 'session.json'), 'utf8'))
  check(typeof onDisk.last_ts === 'string' && /[+-]\d{2}:\d{2}$/.test(onDisk.last_ts),
    `last_ts 带时区偏移：${onDisk.last_ts}`)
  check(Math.abs(Date.parse(onDisk.last_ts) - Date.now()) < 60_000, 'last_ts 是当前时间')
  check(Array.isArray(onDisk.recent) && onDisk.recent.length === 1, `recent 已写入：${JSON.stringify(onDisk.recent)}`)
  check(onDisk.recent[0].includes('考试'), 'recent 里含本轮摘要')
  // P0-4 修法：不传 mode 时**不编造**默认值（旧实现会写成 text+action，覆盖用户的 text 选择）
  check(onDisk.mode === undefined || onDisk.mode === 'text+action',
    `不传 mode 时不编造：${String(onDisk.mode)}`)
  // 「不篡改用户选择」用另一张卡验证，避免污染本节的轮次计数
  const MODE_NAME = `${NAME}-mode`
  await store.writeCard(MODE_NAME, { ...CARD, name: MODE_NAME })
  const withMode = await store.commitTurn({ character: MODE_NAME, user: '显式 mode', turnId: 'mode-1', mode: 'text' })
  check(withMode.session?.mode === 'text', '显式传 mode 时落盘')
  const keepMode = await store.commitTurn({ character: MODE_NAME, user: '不传 mode', turnId: 'mode-2' })
  check(keepMode.session?.mode === 'text', '不传 mode 时保留已有值（不篡改用户的 text 选择）')
  await store.deleteCharacter(MODE_NAME, true)

  // 同 turnId 重复触发只写一次
  const dup = await store.commitTurn({ character: NAME, user: '重复', turnId: 't1' })
  check(dup.written === false, `同轮去重生效：${dup.reason}`)

  // 展示类指令不计数
  await store.commitTurn({ character: NAME, summary: '（看了日记）', turnId: 't1b', count: false })
  const afterNoCount = await store.readSession(NAME)
  check(afterNoCount.turn_count === 1, `count=false 不加轮次（turn_count=${afterNoCount.turn_count}）`)

  // 滚动窗口：连续 7 轮，只保留最近 5 条
  for (let i = 2; i <= 7; i += 1) {
    await store.commitTurn({ character: NAME, user: `第 ${i} 轮用户消息`, assistant: `第 ${i} 轮回复`, turnId: `t${i}` })
  }
  const s7 = await store.readSession(NAME)
  check(s7.turn_count === 7, `累计 7 轮（实际 ${s7.turn_count}）`)
  check(s7.recent.length === 5, `recent 滚动窗口 = 5 条（实际 ${s7.recent.length}）`)
  check(s7.recent[s7.recent.length - 1].includes('第 7 轮'), '最后一条是第 7 轮')
  check(!s7.recent.some(x => x.includes('第 2 轮')), '最早的几轮已被挤出窗口')

  // 超长消息被截断，不会撑爆窗口
  await store.commitTurn({ character: NAME, user: 'x'.repeat(500), turnId: 'long' })
  const sl = await store.readSession(NAME)
  check(sl.recent.every(x => x.length <= 140), '单条摘要长度受控')

  // 本地时间戳格式：保留本地墙上时间 + 显式偏移（不写死 +08:00，CI 在 UTC 也过）
  const stampDate = new Date(2026, 7, 8, 22, 30, 0)
  const iso = localIsoTimestamp(stampDate)
  check(/^2026-08-08T22:30:00[+-]\d{2}:\d{2}$/u.test(iso) && Date.parse(iso) === stampDate.getTime(),
    `last_ts 格式对齐原 skill 示例（本地时间 + 显式偏移）：${iso}`)
}

// ---------------------------------------------------------------- 2. 忘记

section('2. 「忘记{事情}」三处同步清理')
{
  const before = await store.readDiary(NAME)
  const r = await store.forget(NAME, '考试')
  check(r.changed === true, 'forget 报告有变更')
  check(r.diary.removedTimeline.length >= 1, `删掉时间线：${JSON.stringify(r.diary.removedTimeline)}`)

  const after = await store.readDiary(NAME)
  const allTimeline = after.flatMap(d => d.timeline)
  check(!allTimeline.some(t => t.includes('考试')), '日记里已无「考试」条目')
  check(allTimeline.some(t => t.includes('火锅')), '无关条目「火锅」保留')
  check(allTimeline.some(t => t.includes('换工作')), '另一天的无关条目保留')

  const card = await store.readCardView(NAME)
  const dynText = Object.values(card.dynamic_state ?? {}).join('')
  check(!dynText.includes('考试'), `card.dynamic_state 里的「考试」已清掉：${JSON.stringify(card.dynamic_state)}`)
  const anchorText = Object.values(card.memory_anchor ?? {}).join('')
  check(anchorText.includes('过年'), 'memory_anchor 里不相关的句子保留')

  const session = await store.readSession(NAME)
  check(!(session.recent ?? []).some(x => x.includes('考试')), '会话摘要里的相关内容已清掉')

  // 无命中的词不产生变更
  const r2 = await store.forget(NAME, '根本不存在的词')
  check(r2.changed === false, '无命中时不产生变更')
}

// ---------------------------------------------------------------- 3. 改日记

section('3. 「改日记{内容}」就地改写')
{
  await store.appendDiary(NAME, '2026 10 03', ['[事实] TA 说想去看海'], ['想陪 TA 去。'])
  const before = await store.readDiary(NAME)
  const beforeAll = before.flatMap(d => [...d.timeline, ...d.notes])

  const r = await store.editDiary(NAME, { match: '去看海', text: '[完结] TA 说已经去过海边了' })
  check(r.before.includes('去看海'), `定位到原条目：${r.before}`)
  check(r.after === '[完结] TA 说已经去过海边了', `改写后内容正确：${r.after}`)

  const after = await store.readDiary(NAME)
  const afterAll = after.flatMap(d => [...d.timeline, ...d.notes])
  check(afterAll.includes('[完结] TA 说已经去过海边了'), '新内容已落盘')
  check(!afterAll.some(t => t === '[事实] TA 说想去看海'), '旧内容已消失')
  check(afterAll.includes('想陪 TA 去。'), '同段其他条目未被误改')
  check(afterAll.length === beforeAll.length, '只替换一条，条目总数不变')

  // 按日期定位
  const r2 = await store.editDiary(NAME, { date: '2026 10 02', text: '[完结] TA 已经换了工作' })
  check(r2.entry.date === '2026 10 02', `按日期定位成功：${r2.entry.date}`)

  // 找不到就明确报错，不静默
  let threw = ''
  try { await store.editDiary(NAME, { match: '绝不存在的内容', text: 'x' }) } catch (e) { threw = e.message }
  check(threw.includes('没有匹配'), `无命中时明确报错：${threw}`)
}

// ---------------------------------------------------------------- 4. 全新开始

section('4. 「全新开始」：会话归零、日记保留')
{
  await store.appendDiary(NAME, '2026 10 04', ['[事实] 全新开始前的记忆'], [])
  const createdAt = new Date('2026-10-05T09:00:00')
  const beforeSession = await store.readSession(NAME)
  const beforeDiary = await store.readDiary(NAME)
  check(beforeSession.turn_count > 0, `重置前 turn_count=${beforeSession.turn_count}`)

  const r = await store.resetSession(NAME, createdAt)
  check(r.scope === 'session', 'scope = session')
  check(r.session.turn_count === 0, 'turn_count 归零')
  check(Array.isArray(r.session.recent) && r.session.recent.length === 0, 'recent 清空')
  check(r.session.topic === undefined, 'topic 清空')
  check(r.session.mood === undefined, 'mood 清空')
  check(r.session.mode === 'text+action', `mode 保留：${r.session.mode}`)
  check(r.session.last_ts.startsWith('2026-10-05T09:00:00'), `last_ts 重置为当前时间：${r.session.last_ts}`)

  const afterDiary = await store.readDiary(NAME)
  check(afterDiary.length === beforeDiary.length, `日记保留（${afterDiary.length} 天）`)
  check(afterDiary.flatMap(d => d.timeline).some(t => t.includes('全新开始前的记忆')), '日记内容确实还在')
  check(r.diaryKept > 0, `返回值报告保留日记 ${r.diaryKept} 条`)
}

// ---------------------------------------------------------------- 5. 彻底重置

section('5. 「彻底重置」：会话 + 日记全清')
{
  const r = await store.resetStory(NAME)
  check(r.scope === 'all', 'scope = all')
  check(r.diaryRemoved > 0, `报告清掉了 ${r.diaryRemoved} 条日记`)
  const diary = await store.readDiary(NAME)
  check(diary.length === 0, 'diary.md 已清空')
  const session = await store.readSession(NAME)
  check(session.turn_count === 0 && session.recent.length === 0, '会话已归零')
  check(session.mode === 'text+action', 'mode 仍保留')

  let rawDiary = ''
  try { rawDiary = await readFile(join(sandbox, 'characters', NAME, 'diary.md'), 'utf8') } catch { rawDiary = '(文件不存在)' }
  check(!rawDiary.includes('记忆'), 'diary.md 里已无历史条目')

  const card = await store.readCardView(NAME)
  check(card !== undefined && card.name === NAME, '角色卡本身不受重置影响')
}

// ---------------------------------------------------------------- 6. 关系

section('6. 「关系」：非数值档位、现算不落盘')
{
  const r = await store.relationState(NAME)
  check(Array.isArray(r.bands) && r.bands.length === 5, `五档：${r.bands.join(' / ')}`)
  check(RELATION_BANDS.join() === '陌生,认识,熟悉,亲近,亲密', '档位顺序与原 skill 一致')
  check(['陌生', '认识', '熟悉', '亲近', '亲密'].includes(r.baseline), `起点锚定：${r.baseline}`)
  check(r.baseline === '亲近' || r.baseline === '熟悉', `「合租室友」设定不该落到「陌生」：${r.baseline}`)
  check(typeof r.turnCount === 'number', `给出客观依据 turnCount=${r.turnCount}`)

  // 夫妻/恋人类设定起点应落在亲密档
  const { relationBaseline } = await import(lib('store.js'))
  check(relationBaseline('三年前家里安排你们结婚，之后同住一屋') === '亲密', '夫妻设定 → 亲密')
  check(relationBaseline('名义上的兄妹') === '亲近', '兄妹设定 → 亲近')
  check(relationBaseline('完全的陌生人，第一次见面') === '陌生', '陌生设定 → 陌生')

  // 不落盘：session.json 里不能出现任何档位字段
  await store.commitTurn({ character: NAME, user: '我们是什么关系', turnId: 'rel' })
  const raw = JSON.parse(await readFile(join(sandbox, 'characters', NAME, 'session.json'), 'utf8'))
  const text = JSON.stringify(raw)
  check(!/intimacy|亲密度|好感度|relation_band/u.test(text), `session.json 无档位字段：${Object.keys(raw).join(',')}`)
}

// ---------------------------------------------------------------- 7. 换一句开场

section('7. 「换一句开场」：openings 轮换')
{
  // 有历史档案（recent 非空）→ 不轮换、不写盘
  const withHistory = await store.rotateOpening(NAME)
  check(withHistory.history === true, '有历史档案时 history=true')
  const cardAfterHistory = await store.readCardView(NAME)
  check(JSON.stringify(cardAfterHistory.openings) === JSON.stringify(CARD.openings), '有历史档案时不动 openings')

  // 全新开始 → 无历史档案 → 轮换
  await store.resetStory(NAME)
  const r1 = await store.rotateOpening(NAME)
  check(r1.history === false, '重置后 history=false')
  check(r1.opening === CARD.openings[0], `取到第一句：${r1.opening}`)
  check(r1.openings[r1.openings.length - 1] === CARD.openings[0], '取出的句子被移到数组末尾（游标持久化）')

  const card1 = await store.readCardView(NAME)
  check(JSON.stringify(card1.openings) === JSON.stringify(r1.openings), '顺序已写入 card.json')

  const r2 = await store.rotateOpening(NAME)
  check(r2.opening === CARD.openings[1], `再换一句取到第二句：${r2.opening}`)
  const r3 = await store.rotateOpening(NAME)
  check(r3.opening === CARD.openings[2], `第三次取到第三句：${r3.opening}`)

  // openings 缺失 → needGenerate，模型生成后写入
  const bare = { ...CARD, openings: [] }
  await store.writeCard(NAME, bare)
  await store.resetStory(NAME)
  const r4 = await store.rotateOpening(NAME)
  check(r4.needGenerate === true, 'openings 缺失时 needGenerate=true')
  const r5 = await store.rotateOpening(NAME, { candidates: ['新生成的 1', '新生成的 2'] })
  check(r5.opening === '新生成的 1', `生成候选后采用第一句：${r5.opening}`)
  const card5 = await store.readCardView(NAME)
  check(card5.openings.includes('新生成的 1') && card5.openings.includes('新生成的 2'), '生成的候选已写入 card.json')

  // 开局三态判定
  const st1 = await store.openingState(NAME)
  check(st1.state === 'none', `空档案 → state=none（实际 ${st1.state}）`)
  await store.appendDiary(NAME, '2026 10 06', ['[事实] 有点小事'], [])
  const st2 = await store.openingState(NAME)
  check(st2.state === 'fresh-reset', `有日记无会话 → state=fresh-reset（实际 ${st2.state}）`)
  await store.commitTurn({ character: NAME, user: 'hi', turnId: 'hi' })
  const st3 = await store.openingState(NAME)
  check(st3.state === 'history', `有会话摘要 → state=history（实际 ${st3.state}）`)
}

// ---------------------------------------------------------------- 8. 工具 & 路由形状

section('8. 工具与 REST 接口一致暴露')
{
  const fakePrompt = {
    characterName: NAME,
    snapshot: () => ({ enabled: true, character: NAME, mode: 'text+action' }),
    invalidate: () => {},
    refresh: async () => {},
  }
  const tools = createTools(store, fakePrompt)
  const names = tools.map(t => t.name)
  const required = ['awu_forget', 'awu_diary_edit', 'awu_session_reset', 'awu_relation', 'awu_opening_next']
  check(required.every(n => names.includes(n)), `指令工具齐全：${names.join(', ')}`)
  check(names.every(n => n.startsWith('awu_')), '全部保持 awu_ 前缀')

  // 工具确实能跑通（与 store 逻辑一致）
  await store.appendDiary(NAME, '2026 10 07', ['[事实] 工具删我'], [])
  const forgetTool = tools.find(t => t.name === 'awu_forget')
  const out = await forgetTool.execute({ keyword: '工具删我' }, {})
  check(out.diary.removedTimeline.length === 1, 'awu_forget 工具实际生效')

  const resetTool = tools.find(t => t.name === 'awu_session_reset')
  let threw = ''
  try { await resetTool.execute({ scope: 'all' }, {}) } catch (e) { threw = e.message }
  check(threw.includes('确认'), `彻底重置未确认时拒绝执行：${threw}`)

  const relationTool = tools.find(t => t.name === 'awu_relation')
  const rel = await relationTool.execute({}, {})
  check(Array.isArray(rel.bands) && rel.bands.length === 5, 'awu_relation 返回五档')

  // REST 路由
  const routes = buildRoutes(store, fakePrompt)
  const paths = routes.map(r => `${r.method} ${r.path}`)
  const requiredPaths = [
    '/forget', '/diary/edit', '/session/reset', '/relation', '/opening/next',
  ].map(p => `POST ${'/'.concat('_dsh/ai-with-u').concat(p)}`)
  const requiredPathsWithGet = requiredPaths.map((p, i) => (i === 3 ? p.replace('POST', 'GET') : p))
  check(requiredPathsWithGet.every(p => paths.includes(p)), `REST 路由齐全：\n      ${paths.join('\n      ')}`)
  check(paths.every(p => p.includes('/_dsh/ai-with-u/')), '全部挂在 /_dsh/ai-with-u/ 下')
}

// ---------------------------------------------------------------- 9. 宿主事件钩子

section('9. 宿主钩子：agent/turn-stopping 真正写盘')
{
  // 用一个最小假 ctx 复现宿主接线，验证钩子确实触发写入
  const handlers = new Map()
  const sections = new Map()
  const disposers = []
  const logs = []
  const rootAgent = { id: 'session-test', session: undefined }
  const childAgent = { id: 'child-agent', session: { id: 'child-agent' } }
  // 宿主 registry 的 roots() = 没有 owner 的顶层 agent（用户主会话）
  const fakeAgents = { roots: () => [rootAgent] }
  const fakeCtx = {
    systemPrompt: { section: (input) => { sections.set(input.name, input); return () => sections.delete(input.name) } },
    logger: {
      info: (m, ...a) => logs.push(['info', m, ...a]),
      warn: (m, ...a) => logs.push(['warn', m, ...a]),
      error: (m, ...a) => logs.push(['error', m, ...a]),
    },
    get: (n) => (n === 'agents' ? fakeAgents : undefined),
    on: (event, listener) => {
      handlers.set(event, listener)
      const dispose = () => handlers.delete(event)
      disposers.push(dispose)
      return dispose
    },
  }
  const { apply } = await import(lib('index.js'))
  const disposeAll = apply(fakeCtx)
  // 等初始化（seedPresets 会跳过，因为 characters/ 已存在）
  await new Promise(r => setTimeout(r, 300))
  check(handlers.has('agent/turn-stopping'), '已注册 agent/turn-stopping')
  check(handlers.has('agent/pre-step'), '已注册 agent/pre-step')

  // 构造一个只含 message 事件的假 session
  const fakeSession = {
    id: 'session-test',
    snapshotEvents: () => [
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '钩子测试：我明天搬家' }] } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '那我帮你叫车' }] } } },
    ],
  }
  // 先清空 session 以便验证写入
  rootAgent.session = fakeSession
  await store.writeSession(NAME, { recent: [], turn_count: 0, mode: 'text+action' })
  const turnHandler = handlers.get('agent/turn-stopping')
  turnHandler({ agent: rootAgent, turn: 1 })
  await new Promise(r => setTimeout(r, 300))

  const written = JSON.parse(await readFile(join(sandbox, 'characters', NAME, 'session.json'), 'utf8'))
  check(written.turn_count === 1, `钩子写入 turn_count=1（实际 ${written.turn_count}）`)
  check(/[+-]\d{2}:\d{2}$/.test(written.last_ts), `钩子写入带偏移的 last_ts：${written.last_ts}`)
  check(written.recent.length === 1 && written.recent[0].includes('搬家'), `钩子写入 recent：${JSON.stringify(written.recent)}`)
  check(written.recent[0].includes('叫车'), 'recent 同时含角色回复')

  // pre-step 必须调用 next()，否则整轮被卡住
  const preHandler = handlers.get('agent/pre-step')
  let nextCalled = false
  const decision = { kind: 'enter', messages: [] }
  const returned = preHandler({ agent: { id: 'session-test', session: fakeSession }, signal: new AbortController().signal }, () => { nextCalled = true; return decision })
  check(nextCalled === true, 'agent/pre-step 正确调用 next()（不会卡住对话）')
  check(returned === decision, 'pre-step 把 next() 的决策原样返回')

  // 同一轮重复触发不会重复计数
  turnHandler({ agent: { id: 'session-test', session: fakeSession }, turn: 1 })
  await new Promise(r => setTimeout(r, 300))
  const written2 = JSON.parse(await readFile(join(sandbox, 'characters', NAME, 'session.json'), 'utf8'))
  check(written2.turn_count === 1, `同一轮不重复计数（turn_count=${written2.turn_count}）`)

  // 子代理的一轮不该写进角色会话（P2-2 方案 A：只认根 agent）
  turnHandler({ agent: childAgent, turn: 2 })
  await new Promise(r => setTimeout(r, 300))
  const written3 = JSON.parse(await readFile(join(sandbox, 'characters', NAME, 'session.json'), 'utf8'))
  check(written3.turn_count === 1, `子代理的轮次不写进角色 session（turn_count=${written3.turn_count}）`)
  check(!(written3.recent ?? []).some(item => String(item).includes('child')), '子代理内容没进 recent')

  // 没有错误日志
  const errors = logs.filter(l => l[0] === 'error')
  check(errors.length === 0, `钩子运行期间无错误日志${errors.length > 0 ? '：' + JSON.stringify(errors) : ''}`)

  // 卸载会释放钩子
  disposeAll()
  check(!handlers.has('agent/turn-stopping'), '卸载后钩子已释放')
}

// ---------------------------------------------------------------- 10. 日记往返（P1-2）

section('10. 日记往返：日期写法与手写札记都不许丢')
{
  await store.resetStory(NAME)
  // 模型常写连字符日期：写入侧必须先规范化，否则解析器永远读不回来
  await store.appendDiary(NAME, '2026-10-05', ['[事实] 连字符日期'], ['心里记着'])
  const afterWrite = await store.readDiary(NAME)
  check(afterWrite.length === 1 && afterWrite[0].date === '2026 10 05',
    `连字符日期写入后规范化为 2026 10 05（实际 ${JSON.stringify(afterWrite.map(e => e.date))}）`)
  check(afterWrite[0].timeline.length === 1 && afterWrite[0].notes.length === 1, '时间线与札记都读得回来')

  // 手写没有 `>` 的札记行：读得到，且下一次写入不会被整段重写删掉
  const diaryPath = join(sandbox, 'characters', NAME, 'diary.md')
  await writeFile(diaryPath, '# 手写日记\n\n## 2026 10 08\n**时间线**\n  手写一条\n\n**心情札记**\n没有引用符号的一行\n', 'utf8')
  const hand = await store.readDiary(NAME)
  check(hand.length === 1 && hand[0].notes[0] === '没有引用符号的一行',
    `手写札记读得回来（实际 ${JSON.stringify(hand[0]?.notes)}）`)
  await store.appendDiary(NAME, '2026 10 09', ['新的一天'], [])
  const merged = await readFile(diaryPath, 'utf8')
  check(merged.includes('没有引用符号的一行'), '再写一天后，手写札记仍在（不会被整段重写删掉）')

  // 非法日期必须显式报错，而不是写出读不回来的块
  let dateErr = ''
  try { await store.appendDiary(NAME, '2026-13-40', ['坏的'], []) } catch (e) { dateErr = e.message }
  check(dateErr.includes('日期'), `非法日期被拒绝：${dateErr}`)

  // 条目内换行会被拍平，避免写出破坏「一行一条」的文件
  await store.appendDiary(NAME, '2026 10 10', ['第一行\n第二行'], [])
  const flat = await store.readDiary(NAME)
  check(flat.find(e => e.date === '2026 10 10')?.timeline[0] === '第一行 第二行', '多行条目写入时拍平成一行')
  await store.resetStory(NAME)
}

// ---------------------------------------------------------------- 11. REST 来源栅栏（P1-1）

section('11. REST 来源栅栏：跨站写/删与 DNS rebinding 都要挡住')
{
  const fakePrompt = {
    characterName: NAME,
    snapshot: () => ({ enabled: true, character: NAME, mode: 'text+action' }),
    invalidate: () => {},
    refresh: async () => {},
  }
  const routes = buildRoutes(store, fakePrompt)
  const routeOf = (suffix) => routes.find(r => r.path === `/_dsh/ai-with-u${suffix}`)
  const makeRes = () => {
    const out = { status: 0, body: '' }
    return {
      out,
      res: { setHeader: () => {}, writeHead: s => { out.status = s }, end: b => { out.body = String(b ?? '') } },
    }
  }
  const makeReq = (opts = {}) => {
    const body = opts.body ?? ''
    const headers = { host: '127.0.0.1:50143', ...(opts.headers ?? {}) }
    return {
      method: opts.method ?? 'POST',
      url: '/x',
      headers,
      socket: { localAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() { if (body !== '') yield Buffer.from(body) },
    }
  }
  const call = async (method, suffix, opts = {}) => {
    const route = routeOf(suffix)
    if (route === undefined) return { status: -1, body: '' }
    const { out, res } = makeRes()
    await route.handler(makeReq({ method, ...opts }), res)
    return out
  }

  check((await call('GET', '/distill/state')).status === 200, '同源本机请求放行')
  check((await call('GET', '/distill/state', { headers: { host: 'evil.example' } })).status === 403, '陌生 Host 被拒（DNS rebinding）')
  check((await call('POST', '/distill/disarm', { headers: { origin: 'https://evil.example' } })).status === 403, '跨站 Origin 被拒（CSRF）')
  check((await call('GET', '/distill/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status === 403, 'Sec-Fetch-Site: cross-site 被拒')
  check((await call('GET', '/deactivate')).status === 405, '写接口只收 POST（GET 不再有副作用）')
  const plain = await call('POST', '/forget', { headers: { 'content-type': 'text/plain' }, body: '{"keyword":"x"}' })
  check(plain.status === 400 || plain.status === 403, `text/plain 请求体被拒（${plain.status}）`)
}

// ---------------------------------------------------------------- 12. 彻底重置的备份（P2-10）

section('12. 彻底重置前先备份日记（不可逆操作留退路）')
{
  await store.appendDiary(NAME, '2026 10 11', ['要保住的记忆'], [])
  const result = await store.resetStory(NAME)
  check(typeof result.diaryBackup === 'string' && result.diaryBackup.includes('.bak-'),
    `彻底重置返回备份路径：${String(result.diaryBackup)}`)
  const backupText = await readFile(String(result.diaryBackup), 'utf8')
  check(backupText.includes('要保住的记忆'), '备份文件里确实有被删的日记')
  check((await store.readDiary(NAME)).length === 0, '重置后日记已清空')
}

// ---------------------------------------------------------------- 清理

await rm(sandbox, { recursive: true, force: true })
console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`)
if (failed > 0) {
  console.error('会话状态 / 指令自检未通过。')
  process.exit(1)
}
console.log('会话状态与指令自检全部通过。')
