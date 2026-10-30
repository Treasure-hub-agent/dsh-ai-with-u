/**
 * 蒸馏全自动自检（临时武装 + `awu_card_save` + 路由）
 *
 * 直接 import 编译产物（lib/*.js），在 mkdtemp 沙箱里跑，不碰用户真实存档。
 *
 * 覆盖（对应 task-8 的验收清单）：
 *   1. 未武装：工具不可见，直接调用被拒（`code: not-armed`），不写盘
 *   2. arm → 工具可见 → save → 落盘是 CCv3 + 索引更新 + **自动 disarm**
 *   3. 保存一次后再调用 → 工具已卸下 / 被拒
 *   4. 重名不带 overwrite → `name-conflict` + 已有卡摘要 + **盘上字节不变**
 *   5. 重名带 overwrite:true → `action: updated`
 *   6. 非法名字（路径分隔符 / `..` / Windows 保留名 / 非法字符 / 超长）→ 报错且不写盘
 *   7. TTL 到期 → 工具自动卸下、状态变 false、再调用被拒
 *   8. 路由：`POST /distill/arm`、`POST /distill/disarm`、`GET /distill/state`，以及方法校验
 *   9. 非法 data → `invalid-data` 且不写盘
 *  10. 端到端：arm → save 一张最小卡 → `readCardView(name)` 能读到
 *
 * 运行：node scripts/verify-distill.mjs
 */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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

const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-distill-verify-'))
process.env['AIWU_STORAGE_ROOT'] = sandbox
console.log(`沙箱存储根：${sandbox}`)

const { Store } = await import(lib('store.js'))
const { DistillArm, DISTILL_ARM_TTL_MS, saveCardFromModel } = await import(lib('distill.js'))
const { createCardSaveTool } = await import(lib('tools.js'))
const { buildRoutes } = await import(lib('web.js'))

const store = new Store(sandbox)

// ---------------------------------------------------------------- 夹具

/** 假工具服务：记录当前"可见"的工具，disposer 负责移除。 */
const makeToolService = () => {
  const registry = new Map()
  return {
    registry,
    register(tool) {
      registry.set(tool.name, tool)
      return () => { registry.delete(tool.name) }
    },
  }
}

/**
 * 造一个 arm + 配套的工具服务。
 * `hooks.mount` 里当场 new 工具（模拟 index.ts 里 `tools.register(createCardSaveTool(store, arm))`）。
 */
function makeArm(options = {}) {
  const service = options.service ?? makeToolService()
  let clock = options.now ?? Date.parse('2026-10-30T22:00:00+08:00')
  let arm
  const mounted = []
  arm = new DistillArm({
    mount: () => {
      if (options.toolsReady === false) return false
      mounted.push(service.register(createCardSaveTool(store, arm)))
      return true
    },
    unmount: () => {
      const disposer = mounted.pop()
      if (typeof disposer === 'function') disposer()
    },
  }, () => clock)
  return {
    arm,
    service,
    registry: service.registry,
    advance(ms) { clock += ms },
    now: () => clock,
  }
}

const cardPathOf = (name) => join(sandbox, 'characters', name, 'card.json')
const exists = async (path) => {
  try { await stat(path); return true } catch { return false }
}
const bytesHash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const characterDirs = async () => {
  try {
    return (await readdir(join(sandbox, 'characters'), { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name)
  } catch { return [] }
}

const MINIMAL = {
  description: '身份：从作品里蒸馏出来的角色',
  personality: '关键词：护短、嘴硬',
  first_mes: '（他抬眼看了看你）回来了。',
}

// ================================================================ 1. 未武装

section('1. 未武装：工具不可见、调用被拒、不写盘')
{
  const { arm, registry } = makeArm()
  check(registry.size === 0, '未武装时工具服务里没有 awu_card_save')
  check(arm.snapshot().armed === false, '未武装时 armed=false')

  const tool = createCardSaveTool(store, arm)
  const result = await tool.execute({ name: '未武装角色', data: MINIMAL }, {})
  check(result.ok === false && result.code === 'not-armed', `直接调用被拒（code=${result.code}）`)
  check(!(await exists(cardPathOf('未武装角色'))), '未武装时没有写盘')
}

// ================================================================ 2. 武装 → 工具可见

section('2. arm → 工具可见（参数 schema / 描述要点）')
{
  const { arm, registry } = makeArm()
  const snapshot = arm.arm()
  check(snapshot.armed === true, 'arm 后 armed=true')
  check(typeof snapshot.expiresAt === 'string' && snapshot.expiresAt !== '', `返回 expiresAt：${snapshot.expiresAt}`)

  const tool = registry.get('awu_card_save')
  check(tool !== undefined, 'arm 后工具服务里出现 awu_card_save')
  check(tool?.parameters?.name?.required === true, '参数 name 必填')
  check(tool?.parameters?.data?.required === true, '参数 data 必填')
  check(tool?.parameters?.data?.additionalProperties === true, 'data 是开放对象（additionalProperties: true）')
  check(tool?.parameters?.overwrite?.type === 'boolean', 'overwrite 是可选布尔')
  check(tool?.description?.includes('只在蒸馏武装期间可用') === true, '描述写明"只在蒸馏武装期间可用"')
  check(tool?.description?.includes('自动失效') === true, '描述写明"保存后自动失效"')
  check(tool?.description?.includes('name-conflict') === true, '描述写了重名怎么处理')

  // 数组类参数一律用 items（本工具没有数组参数，这里断言 schema 里没有历史错法 item）
  const serialized = JSON.stringify(tool?.parameters ?? {})
  check(!serialized.includes('"item"'), '参数 schema 里没有 `item`（历史错法）')
}

// ================================================================ 3. save → 落盘 + 索引 + 自动 disarm

section('3. save → CCv3 落盘 + 索引更新 + 自动 disarm')
{
  const { arm, registry } = makeArm()
  arm.arm()
  const tool = registry.get('awu_card_save')
  const NAME = '蒸馏角色'
  const result = await tool.execute({ name: NAME, data: MINIMAL }, {})
  check(result.ok === true && result.action === 'created', `保存成功（action=${result.action}）`)
  check(result.name === NAME, '返回规范化的名字')
  check(result.stats?.total === 34, `stats.total = ${result.stats?.total}（34 字段契约）`)
  check(typeof result.stats?.filled === 'number' && result.stats.filled > 0, `stats.filled = ${result.stats?.filled}`)
  check(Array.isArray(result.warnings) && result.warnings.length > 0, `给了 ${result.warnings?.length} 条软警告（不阻断保存）`)

  const raw = JSON.parse(await readFile(cardPathOf(NAME), 'utf8'))
  check(raw.spec === 'chara_card_v3' && raw.spec_version === '3.0', '盘上是 CCv3')
  check(raw.data?.name === NAME, 'data.name 已写成角色名')
  check(raw.data?.description?.includes('蒸馏'), '内容原样落盘')

  const index = await store.readIndex()
  check(index[NAME] !== undefined, '索引已更新（面板列表能读到）')

  check(registry.size === 0, `保存成功后工具自动卸下（registry=${registry.size}）`)
  check(arm.snapshot().armed === false, '保存成功后 armed=false（自动 disarm）')
  check(arm.snapshot().lastSaved?.name === NAME, `lastSaved.name = ${arm.snapshot().lastSaved?.name}`)
}

// ================================================================ 4. 保存一次后再调用被拒

section('4. 保存一次后再调用 → 工具已不可用')
{
  const { arm, registry } = makeArm()
  arm.arm()
  const tool = registry.get('awu_card_save')
  await tool.execute({ name: '一次性角色', data: MINIMAL }, {})
  const before = (await characterDirs()).length
  const again = await tool.execute({ name: '第二张', data: MINIMAL }, {})
  check(again.ok === false && again.code === 'not-armed', `再调用被拒（code=${again.code}）`)
  check((await characterDirs()).length === before, '第二张没有落盘')
}

// ================================================================ 5. 重名冲突

section('5. 重名不带 overwrite → name-conflict + 摘要 + 盘上字节不变')
{
  const NAME = '重名角色'
  await saveCardFromModel(store, { name: NAME, data: MINIMAL })
  const hashBefore = await bytesHash(cardPathOf(NAME))

  const { arm, registry } = makeArm()
  arm.arm()
  const tool = registry.get('awu_card_save')
  const conflict = await tool.execute({
    name: NAME,
    data: { description: '完全不同的新内容', first_mes: '（新的开场）' },
  }, {})
  check(conflict.ok === false && conflict.code === 'name-conflict', `重名被拒（code=${conflict.code}）`)
  check(conflict.existing?.name === NAME, '返回已有卡名字')
  check(typeof conflict.existing?.filled === 'number', `返回已有卡完整度 filled=${conflict.existing?.filled}`)
  check(typeof conflict.existing?.identity === 'string' && conflict.existing.identity !== '', '返回已有卡身份摘要（模型据此决定改名/覆盖）')
  check(String(conflict.error).includes('overwrite'), '错误文案提示可以用 overwrite: true')
  check(await bytesHash(cardPathOf(NAME)) === hashBefore, '**盘上字节完全没变**（拒绝时不写盘）')
  check(arm.snapshot().armed === true, '冲突不算成功，武装仍在（可以改名重试）')

  const overwritten = await tool.execute({
    name: NAME,
    data: { description: '覆盖后的新内容', first_mes: '（覆盖后的开场）' },
    overwrite: true,
  }, {})
  check(overwritten.ok === true && overwritten.action === 'updated', `overwrite:true → action=${overwritten.action}`)
  const raw = JSON.parse(await readFile(cardPathOf(NAME), 'utf8'))
  check(raw.data?.description === '覆盖后的新内容', '覆盖后内容已更新')
}

// ================================================================ 6. 非法名字

section('6. 非法名字 → invalid-name 且不写盘')
{
  const before = (await characterDirs()).length
  const badNames = [
    ['路径分隔符 /', 'a/b'],
    ['反斜杠 \\', 'a\\b'],
    ['上跳 ..', '..'],
    ['点 .', '.'],
    ['Windows 保留名 CON', 'CON'],
    ['Windows 保留名 nul（大小写不敏感）', 'nul'],
    ['保留名带扩展名 COM1.txt', 'COM1.txt'],
    ['非法字符 :', 'a:b'],
    ['非法字符 ?', 'a?b'],
    ['非法字符 |', 'a|b'],
    ['结尾的点（ Windows 会裁掉）', '名字.'],
    ['超长名字', 'x'.repeat(65)],
    ['空名字', '   '],
  ]
  for (const [label, badName] of badNames) {
    const outcome = await saveCardFromModel(store, { name: badName, data: MINIMAL })
    check(outcome.ok === false && outcome.code === 'invalid-name', `${label} → ${outcome.code}`, outcome.ok ? '意外写入' : outcome.error)
  }
  check((await characterDirs()).length === before, '全部非法名字都没有建目录/写盘')
}

// ================================================================ 7. TTL 到期

section('7. TTL 到期 → 工具自动卸下、状态 false、再调用被拒')
{
  const { arm, registry, advance } = makeArm()
  arm.arm(DISTILL_ARM_TTL_MS)
  check(registry.size === 1 && arm.snapshot().armed === true, '武装成功')
  advance(DISTILL_ARM_TTL_MS - 1000)
  check(arm.snapshot().armed === true, '差 1 秒仍有效')
  advance(1001)
  const expired = arm.snapshot()
  check(expired.armed === false, '到期后 armed=false')
  check(registry.size === 0, `到期后工具被自动卸下（registry=${registry.size}）`)

  const tool = createCardSaveTool(store, arm)
  const outcome = await tool.execute({ name: '过期角色', data: MINIMAL }, {})
  check(outcome.ok === false && outcome.code === 'not-armed', '到期后调用被拒')
  check(!(await exists(cardPathOf('过期角色'))), '到期后没有写盘')
}

// ================================================================ 8. 路由

section('8. 路由：/distill/arm · /distill/state · /distill/disarm（含方法校验）')
{
  const { arm, registry } = makeArm()
  const fakePrompt = {
    characterName: undefined,
    snapshot: () => ({ enabled: false }),
    relationTag: () => '',
    invalidate: () => {},
    refresh: async () => {},
    activate: async () => ({ enabled: false }),
  }
  const routes = buildRoutes(store, fakePrompt, arm)
  const route = (path) => routes.find(r => r.path === `/_dsh/ai-with-u${path}`)

  const fakeRes = () => {
    const out = { status: 0, body: undefined }
    return {
      out,
      setHeader() {},
      writeHead(status) { out.status = status },
      end(bytes) { try { out.body = JSON.parse(String(bytes)) } catch { out.body = String(bytes) } },
    }
  }
  const fakeReq = (method) => ({ method, url: '/', async *[Symbol.asyncIterator]() {} })

  const res1 = fakeRes()
  await route('/distill/arm').handler(fakeReq('POST'), res1)
  check(res1.out.status === 200 && res1.out.body?.ok === true, `POST /distill/arm → ${res1.out.status}`)
  check(typeof res1.out.body?.instruction === 'string' && res1.out.body.instruction.includes('flow.md'),
    'arm 返回指令文本（含 flow.md 路径）')
  check(typeof res1.out.body?.path === 'string', 'arm 返回 flow 绝对路径')
  check(typeof res1.out.body?.expiresAt === 'string' && res1.out.body.expiresAt !== '', 'arm 返回到期时间')
  check(registry.size === 1, 'arm 之后工具已挂载')

  const res2 = fakeRes()
  await route('/distill/state').handler(fakeReq('GET'), res2)
  check(res2.out.body?.ok === true && res2.out.body?.armed === true, 'GET /distill/state 显示已武装')

  const res3 = fakeRes()
  await route('/distill/arm').handler(fakeReq('GET'), res3)
  check(res3.out.status === 400 && String(res3.out.body?.error).includes('POST'), `GET /distill/arm 被方法校验拒绝（${res3.out.status}）`)

  const res4 = fakeRes()
  await route('/distill/disarm').handler(fakeReq('POST'), res4)
  check(res4.out.status === 200 && res4.out.body?.armed === false, 'POST /distill/disarm 解除武装')
  check(registry.size === 0, 'disarm 之后工具已卸下')

  const res5 = fakeRes()
  await route('/distill/state').handler(fakeReq('GET'), res5)
  check(res5.out.body?.armed === false, 'GET /distill/state 显示已解除')
}

// ================================================================ 9. 非法 data

section('9. 非法 data → invalid-data 且不写盘')
{
  const before = (await characterDirs()).length
  const cases = [
    ['data 不是对象', '不是对象'],
    ['data 是数组', []],
    ['data 是空对象', {}],
    ['data 全空白', { description: '   ', personality: '  ', first_mes: '' }],
  ]
  for (const [label, data] of cases) {
    const outcome = await saveCardFromModel(store, { name: '非法数据角色', data })
    check(outcome.ok === false && outcome.code === 'invalid-data', `${label} → ${outcome.code}`, outcome.ok ? '意外写入' : outcome.error)
  }
  check((await characterDirs()).length === before, '非法 data 都没有写盘')
}

// ================================================================ 10. 端到端

section('10. 端到端：arm → save 最小卡 → readCardView 能读到')
{
  const { arm, registry } = makeArm()
  arm.arm()
  const NAME = '端到端角色'
  const outcome = await registry.get('awu_card_save').execute({
    name: NAME,
    data: {
      description: '身份：住在楼下的邻居',
      personality: '关键词：安静、细心',
      first_mes: '（他提着一袋橘子站在门口）……正好，多买了。',
      alternate_greetings: ['（他把伞递给你）外面在下雨。', '（他在楼下招手）等我两分钟。'],
      extensions: {
        aiwu: {
          schema: 1,
          voice: { selfRef: '我', callsUser: '你', pace: '慢，一句话说完就停' },
          relationship: { startPoint: '邻居，搬来半年' },
        },
      },
    },
  }, {})
  check(outcome.ok === true, '端到端保存成功')

  const view = await store.readCardView(NAME)
  check(view?.name === NAME, `readCardView 读到 name=${view?.name}`)
  check(view?.basic?.['身份'] === '住在楼下的邻居', '旧视图能读到身份')
  check(view?.opening?.includes('橘子'), '旧视图能读到开场白')
  check(Array.isArray(view?.openings) && view.openings.length === 2, 'alternate_greetings 进了旧视图的 openings')
  check(view?.voice?.['自称'] === '我', '模型给的 extensions.aiwu.voice 被保留（没被投影洗掉）')

  // 面板侧的「新卡」判据：索引里有 + 视图读得出
  const index = await store.readIndex()
  check(index[NAME] !== undefined, '索引里有这张新卡（面板列表可见）')
  check(arm.snapshot().lastSaved?.name === NAME, 'lastSaved 供面板提示「新卡已保存」')
}

// ================================================================ 汇总

await rm(sandbox, { recursive: true, force: true })
console.log(`\n${failed === 0 ? '蒸馏全自动自检全部通过' : '有失败项'}：${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exitCode = 1
