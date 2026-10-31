/**
 * 真实 cordis 宿主验证：确认插件在 cordis 4 的 Proxy Context 下真的能加载。
 *
 * 这个脚本解决的是项目里踩过的三个坑（见 scripts/verify.mjs 头注释）：
 *   1. inject 写成对象 → 卡在 pending；
 *   2. 访问未在 inject 里声明的服务属性 → 直接抛 `cannot get property ... without inject`；
 *   3. export default → Loader 折叠模块丢掉 inject。
 *
 * 这里用仓库里真实的 cordis 4 跑一遍：最小 systemPrompt 服务 + 一个假 webServer，
 * 断言 apply() 能完成、段注册成功、REST 路由注册成功、卸载能干净释放。
 *
 * 运行：node scripts/verify-host.mjs
 */
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const rootRaw = new URL('..', import.meta.url).pathname
const root = process.platform === 'win32' ? rootRaw.replace(/^\/([A-Za-z]:)/, '$1') : rootRaw
const lib = (name) => pathToFileURL(join(root, 'lib', name)).href

/**
 * 用哪张卡做启用验证：**从预置卡里取第一张**，不写死名字。
 *
 * 2026-10-30 踩过：预置卡从三张测试卡（虞照/裴既明/谢砚舟）换成蒸馏的 IP 卡之后，
 * 这里写死的 虞照 直接 400，连带后面 5 条断言全红——而失败信息看起来像「L0 坏了」，
 * 实际只是夹具名字过期。夹具依赖产品数据的名字，是这次换卡的连带风险。
 */
const ACTIVE_NAME = (await readdir(join(root, 'presets'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)[0]

let failed = 0
let passed = 0
const ok = (m) => { passed += 1; console.log(`  ✓ ${m}`) }
const fail = (m) => { failed += 1; console.error(`  ✗ ${m}`) }
const check = (c, m) => (c ? ok(m) : fail(m))

const sandbox = await mkdtemp(join(tmpdir(), 'aiwu-host-'))
process.env['AIWU_STORAGE_ROOT'] = sandbox
// 预置卡种入会扫包内 presets/，这里是真实目录，保留

const { Context, Service } = await import(pathToFileURL(join(root, 'node_modules', 'cordis', 'lib', 'index.js')).href)
const plugin = await import(lib('index.js'))
/** 预览必须与真实注入逐字一致，所以直接拿纪律包常量做对照。 */
const { DISCIPLINE_TEXT } = await import(lib('prompt.js'))

console.log('真实 cordis 宿主验证：')

// ---------------------------------------------------------------- 最小宿主服务
// 注意：这里刻意不调用 this.emit()——cordis 的 Service 并不提供 emit，
// 误用会让 apply() 在安装中途抛错，看起来像插件本身的问题。
class FakeSystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
    this.layers = new Map()
  }
  section(input) {
    this.layers.set(input.name, input)
    return () => { this.layers.delete(input.name) }
  }
  render() {
    return [...this.layers.values()]
      .sort((a, b) => a.order - b.order)
      .map(s => (typeof s.text === 'function' ? s.text({}) : s.text))
      .filter(t => t !== '')
      .join('\n\n')
  }
}

const registered = { routes: [], tools: [] }
class FakeWebServer extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
  }
  register(route) {
    registered.routes.push(route)
    return () => {
      const i = registered.routes.indexOf(route)
      if (i >= 0) registered.routes.splice(i, 1)
    }
  }
}

class FakeTools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
  }
  register(tool) {
    registered.tools.push(tool.name)
    return () => {
      const i = registered.tools.indexOf(tool.name)
      if (i >= 0) registered.tools.splice(i, 1)
    }
  }
}

const logs = []
const app = new Context()
app.on('internal/warn', (...args) => logs.push(['warn', ...args]))
const sysFiber = app.registry.plugin(FakeSystemPrompt, {})
await sysFiber

// 用 logger 收集插件日志
let applyError
let pluginFiber
let cleanupFn
try {
  // 包一层：cordis 的插件返回值（卸载函数）不直接暴露，用 wrapper 接住它，
  // 这样卸载断言测的是插件自己的清理逻辑，而不是 cordis 的 fiber 生命周期。
  const wrapper = {
    name: 'ai-with-u-wrapper',
    inject: plugin.inject,
    apply: (ctx) => { cleanupFn = plugin.apply(ctx) },
  }
  pluginFiber = app.registry.plugin(wrapper, {})
} catch (error) {
  applyError = error
}
if (applyError !== undefined) {
  fail(`app.plugin() 同步抛错：${applyError.message}`)
} else {
  ok('app.plugin() 没有同步抛错')
}

// 等服务就绪 + 初始化（seedPresets + prompt.restore 都是异步）
await app.registry.plugin(FakeWebServer, {})
await app.registry.plugin(FakeTools, {})
try { await pluginFiber } catch (error) { applyError = applyError ?? error }
await new Promise(r => setTimeout(r, 900))

// ---------------------------------------------------------------- 断言
check(app.registry.size > 0, `插件已进入 registry（${app.registry.size} 个条目）`)
// FiberState：0 PENDING / 1 LOADING / 2 ACTIVE / 3 RELOADING / 4 UNLOADING / 5 FAILED
check(pluginFiber?.state === 2, `插件 fiber 达到 ACTIVE(2)，实际 ${pluginFiber?.state}`)

// systemPrompt 段注册成功 → 这就是「人设注入」真的挂上了
const sp = app.systemPrompt
const sectionNames = [...sp.layers.keys()]
check(sectionNames.includes('aiwu:baseline'), `L0 常驻段已注册：${sectionNames.join(', ')}`)
check(sectionNames.includes('aiwu:discipline'), 'L0.5 纪律包段已注册（order 5050）')
check(sectionNames.includes('aiwu:active-character'), 'L1 角色段已注册（未启用时为空串）')
check(sectionNames.includes('aiwu:lore'), '世界书段已注册（垫底 order 10300）')
check(sectionNames.includes('aiwu:clock'), '时间差段已注册（最后 order 10350）')
const aiwuSections = sectionNames.filter(n => String(n).startsWith('aiwu:'))
check(aiwuSections.length === 5, `aiwu 段共 5 个（四段 → 五段）：${aiwuSections.join(', ')}`)

// 🔴 宿主默认会对段文本做 {{var}} 插值，未知变量直接抛错 → 我们的段必须全部 interpolate:false
const ourSections = [...sp.layers.values()].filter(s => String(s.name).startsWith('aiwu:'))
const interpolated = ourSections.filter(s => s.interpolate !== false).map(s => s.name)
check(interpolated.length === 0,
  `所有 aiwu 段都关掉了宿主插值（interpolate:false）${interpolated.length === 0 ? '' : '：漏了 ' + interpolated.join(',')}`)
const loreSection = sp.layers.get('aiwu:lore')
const clockSection = sp.layers.get('aiwu:clock')
check(loreSection?.order === 10300, `世界书段 order = ${String(loreSection?.order)}（期望 10300，易变段垫底）`)
check((clockSection?.order ?? 0) > (loreSection?.order ?? 0),
  `时间差段在最后：clock ${String(clockSection?.order)} > lore ${String(loreSection?.order)}`)
const disciplineSection = sp.layers.get('aiwu:discipline')
const baselineSection = sp.layers.get('aiwu:baseline')
const activeSection = sp.layers.get('aiwu:active-character')
check(disciplineSection?.order === 5050, `纪律包段 order = ${String(disciplineSection?.order)}（期望 5050）`)
check((disciplineSection?.order ?? 0) > (baselineSection?.order ?? 0)
  && (disciplineSection?.order ?? 0) < (activeSection?.order ?? 0),
  `纪律包段位于 baseline(${String(baselineSection?.order)}) 与 active(${String(activeSection?.order)}) 之间`)
const renderedIdle = sp.render()
check(!renderedIdle.includes('角色扮演底线'), '未启用时系统提示词里没有 L0 底线（L0 与角色同进同出）')
check(!renderedIdle.includes('真人感纪律'), '未启用时也没有 L0.5 纪律包')
const idleDiscipline = disciplineSection === undefined
  ? ''
  : (typeof disciplineSection.text === 'function' ? disciplineSection.text({}) : String(disciplineSection.text))
check(idleDiscipline === '', `未启用时纪律包段返回空串（实际 ${idleDiscipline.length} 字符）`)
check(renderedIdle.trim() === '', `未启用时宿主渲染结果为空（实际 ${renderedIdle.length} 字符）`)

// webServer 路由注册成功
const paths = registered.routes.map(r => r.path)
check(paths.some(p => p.endsWith('/overview')), `REST 路由已注册 ${registered.routes.length} 条`)
check(paths.every(p => p.startsWith('/_dsh/ai-with-u/')), '路由都以 /_dsh/ai-with-u/ 开头')

// 关键：cordis 4 的 Proxy Context 没抛 `without inject`
const injectErrors = [...app.registry.values()]
  .flatMap(rt => (rt.fiber?.error ? [rt.fiber.error] : []))
  .map(e => (e instanceof Error ? e.message : String(e)))
check(!injectErrors.some(e => e.includes('without inject')),
  `没有 "without inject" 错误${injectErrors.length > 0 ? '：' + JSON.stringify(injectErrors) : ''}`)
check(!injectErrors.some(e => e.includes('pending')),
  '没有卡在 pending 的 fiber')

// fiber 状态一览（注册表键是插件函数本身，取可读名字即可）
const info = [...app.registry.values()].map((rt) => `${rt.name ?? '(匿名插件)'}:${rt.fiber?.state}`)
console.log(`      注册表：${info.join(' | ')}`)

// ---------------------------------------------------------------- 蒸馏临时武装（验证 index.ts 的接线）
const fakeRes = () => {
  const out = { status: 0, body: undefined }
  return {
    out,
    setHeader() {},
    writeHead(status) { out.status = status },
    end(bytes) { try { out.body = JSON.parse(String(bytes)) } catch { out.body = String(bytes) } },
  }
}
const fakeReq = (method, body) => ({
  method,
  url: '/',
  // 真实宿主请求一定带 Host；来源栅栏（web.ts）会校验它
  headers: { host: '127.0.0.1:50143', 'content-type': 'application/json' },
  async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
})
const routeOf = (suffix) => registered.routes.find(r => r.path.endsWith(suffix))

// ---------------------------------------------------------------- 提示词预览（未启用态）
// 预览必须走真实渲染路径，所以下面「未启用」与「启用后」两处都拿真实宿主段文本来对。
if (routeOf('/preview') === undefined) {
  fail('没有注册 /preview 路由')
} else {
  const idlePreview = fakeRes()
  await routeOf('/preview').handler(fakeReq('GET'), idlePreview)
  const body = idlePreview.out.body ?? {}
  check(idlePreview.out.status === 200 && body.ok === true, `GET /preview（未启用）→ ${idlePreview.out.status}`)
  check(body.active?.enabled === false, '未启用：active.enabled=false')
  check(body.active?.character === undefined, '未启用：不带 character')
  check(body.discipline === 'lite', `未启用：discipline 仍是全局偏好 lite（${String(body.discipline)}）`)
  check(Array.isArray(body.segments) && body.segments.length === 5,
    `未启用：仍然返回五段（实际 ${body.segments?.length}）`)
  check(body.segments.every(s => s.text === '' && s.chars === 0), '未启用：五段 text 全为空串、chars 全 0')
  check(body.total === 0, `未启用：total=0（实际 ${String(body.total)}）`)
  check(body.segments.map(s => s.id).join() === [
    'aiwu:baseline', 'aiwu:discipline', 'aiwu:active-character', 'aiwu:lore', 'aiwu:clock',
  ].join(), '未启用：段 id 顺序固定')
}

if (routeOf('/distill/arm') === undefined) {
  fail('没有注册 /distill/arm 路由')
} else {
  const before = registered.tools.length
  check(registered.tools.includes('awu_card_save'), 'apply 之后 awu_card_save 常驻注册（不依赖 arm）')
  const res1 = fakeRes()
  await routeOf('/distill/arm').handler(fakeReq('POST'), res1)
  check(res1.out.status === 200 && res1.out.body?.ok === true, `POST /distill/arm → ${res1.out.status}`)
  check(registered.tools.includes('awu_card_save'), 'arm 之后工具仍在')
  check(registered.tools.length === before, `arm 不改变工具数（${before}）`)

  const res2 = fakeRes()
  await routeOf('/distill/disarm').handler(fakeReq('POST'), res2)
  check(res2.out.body?.armed === false, 'disarm 接口报告已解除')
  check(registered.tools.includes('awu_card_save'), 'disarm 之后工具仍注册（门控在工具内部，不再注销）')
  check(registered.tools.length === before, `disarm 不改变工具数（${registered.tools.length}）`)
}

// ---------------------------------------------------------------- L0 同进同出（启用出现 / 退出归零）
if (routeOf('/activate') === undefined || routeOf('/deactivate') === undefined) {
  fail('没有注册 /activate 或 /deactivate 路由')
} else {
  const resOn = fakeRes()
  await routeOf('/activate').handler(fakeReq('POST', { name: ACTIVE_NAME }), resOn)
  check(resOn.out.status === 200 && resOn.out.body?.ok === true, `POST /activate ${ACTIVE_NAME} → ${resOn.out.status}`)
  const renderedOn = sp.render()
  check(renderedOn.includes('角色扮演底线'), '启用后 L0 底线出现')
  check(renderedOn.includes('你现在的身份'), '启用后 L1 角色段出现')
  check(renderedOn.includes('人设部分'), 'L0 文案是精简后的新版（含「人设部分」判据）')
  check(!renderedOn.includes('何时让位给任务模式'), 'L0 里不再有「何时让位给任务模式」整节')
  check(renderedOn.includes('真人感纪律'), '启用后 L0.5 纪律包出现（缺省 lite）')
  check(renderedOn.includes('禁止词库') && renderedOn.includes('作为一个人工智能'), '纪律包含禁止词库')
  check(renderedOn.length > 500, `启用后渲染长度 ${renderedOn.length} 字符`)

  // 纪律包三档切换（REST /discipline）
  const levels = ['full', 'off', 'lite']
  for (const level of levels) {
    const res = fakeRes()
    await routeOf('/discipline').handler(fakeReq('POST', { level }), res)
    check(res.out.status === 200 && res.out.body?.discipline === level, `POST /discipline ${level} → ${res.out.status}`)
    const text = sp.render()
    if (level === 'full') check(text.includes('语态锚点'), 'full 档出现语态锚点')
    if (level === 'off') {
      check(!text.includes('真人感纪律'), 'off 档纪律包消失')
      check(text.includes('角色扮演底线'), 'off 档只关纪律包，L0 底线仍在')
    }
    if (level === 'lite') check(!text.includes('语态锚点'), 'lite 档没有 full 专属内容')
  }
  const badRes = fakeRes()
  await routeOf('/discipline').handler(fakeReq('POST', { level: '超级' }), badRes)
  check(badRes.out.status === 400, `非法纪律包档位 → ${badRes.out.status}`)

  // /overview 也要暴露 discipline（面板开关状态的数据源）
  const overviewRes = fakeRes()
  await routeOf('/overview').handler(fakeReq('GET'), overviewRes)
  check(overviewRes.out.body?.discipline === 'lite',
    `GET /overview 返回 discipline=${String(overviewRes.out.body?.discipline)}`)

  // 启用后 awu_* 工具（含新增的 awu_mode）真的挂上了
  check(registered.tools.includes('awu_mode'), '启用后挂载 awu_mode 工具')
  check(registered.tools.includes('awu_relation'), '启用后挂载 awu_relation 工具')
  check(registered.tools.includes('awu_diary_write'), '启用后挂载 awu_diary_write 工具')

  // ---------------------------------------------------------------- 提示词预览（启用态）
  const previewRes = fakeRes()
  await routeOf('/preview').handler(fakeReq('GET'), previewRes)
  const pv = previewRes.out.body ?? {}
  check(previewRes.out.status === 200 && pv.ok === true, `GET /preview（启用后）→ ${previewRes.out.status}`)
  check(pv.active?.enabled === true && pv.active?.character === ACTIVE_NAME,
    `active = ${JSON.stringify(pv.active)}`)
  check(Array.isArray(pv.segments) && pv.segments.length === 5, `启用后五段齐全（${pv.segments?.length}）`)
  const orders = (pv.segments ?? []).map(s => s.order)
  check(orders.every((v, i) => i === 0 || orders[i - 1] < v), `segments 按 order 升序：${orders.join(' < ')}`)
  check(pv.total === (pv.segments ?? []).reduce((n, s) => n + s.chars, 0),
    `total = 各段 chars 之和（${String(pv.total)}）`)
  check((pv.segments ?? []).every(s => s.chars === s.text.length), 'chars 都是 String.length（不是字节数）')
  check(pv.discipline === 'lite', `preview.discipline=${String(pv.discipline)}`)
  check(pv.mode === 'text+action' || pv.mode === 'text', `preview.mode=${String(pv.mode)}`)

  // 🔴 关键：预览必须与"真正会注进提示词的那段文本"逐字一致（这里用真实宿主注册的段函数对）
  const previewById = new Map((pv.segments ?? []).map(s => [s.id, s]))
  const strictIds = ['aiwu:baseline', 'aiwu:discipline', 'aiwu:active-character', 'aiwu:lore']
  const mismatch = []
  for (const id of strictIds) {
    const section = sp.layers.get(id)
    const real = section === undefined
      ? ''
      : (typeof section.text === 'function' ? section.text({}) : String(section.text))
    const got = previewById.get(id)?.text ?? ''
    if (real !== got) mismatch.push(`${id}（preview ${got.length} 字 / 真实 ${real.length} 字）`)
  }
  check(mismatch.length === 0,
    `预览与真实宿主段逐字一致${mismatch.length === 0 ? '' : '：' + mismatch.join('、')}`)
  check(previewById.get('aiwu:discipline')?.text === DISCIPLINE_TEXT,
    '纪律包段与 DISCIPLINE_TEXT 逐字一致')
  const l1Preview = previewById.get('aiwu:active-character')
  const l1Real = sp.layers.get('aiwu:active-character')?.text({}) ?? ''
  check(l1Preview?.chars === l1Real.length && l1Preview.chars > 500,
    `L1 段 chars=${l1Preview?.chars} 与真实段长度 ${l1Real.length} 一致`)

  // 时间差段是现算的（分钟分辨率），只对标题：正文允许"分钟边界"这种天然差异
  const clockPreview = previewById.get('aiwu:clock')?.text ?? ''
  const clockReal = sp.layers.get('aiwu:clock')?.text({}) ?? ''
  check(clockPreview.split('\n')[0] === clockReal.split('\n')[0],
    `时间差段标题一致（${clockPreview.split('\n')[0]}）`)
  // lore 统计来自 cache.lore.diag（constantCount/hitCount 是「候选」计数，count 是「实际注入」条数，
  // 两者不相等是正常的：超出预算的被丢掉了）
  check(['count', 'constantCount', 'hitCount', 'usedChars', 'budgetChars'].every(k => Number.isInteger(pv.lore?.[k])),
    `lore 统计都是整数：${JSON.stringify(pv.lore)}`)
  check(pv.lore.constantCount + pv.lore.hitCount >= pv.lore.count,
    `候选条数 ≥ 实际注入条数（${pv.lore.constantCount}+${pv.lore.hitCount} ≥ ${pv.lore.count}）`)
  check(typeof pv.lore.budgetChars === 'number' && pv.lore.budgetChars > 0,
    `lore.budgetChars=${String(pv.lore?.budgetChars)}`)

  // ---------------------------------------------------------------- 纯只读：调用前后磁盘零变化
  const { Store: HostStore } = await import(lib('store.js'))
  const hostStore = new HostStore(sandbox)
  await hostStore.commitTurn({ character: ACTIVE_NAME, user: '只读自检', turnId: 'preview-readonly' })
  const activePath = join(sandbox, '_active.json')
  const sessionPath = join(sandbox, 'characters', ACTIVE_NAME, 'session.json')
  const snapshotOf = async () => ({
    activeMtime: (await stat(activePath)).mtimeMs,
    sessionMtime: (await stat(sessionPath)).mtimeMs,
    activeBytes: await readFile(activePath, 'utf8'),
    sessionBytes: await readFile(sessionPath, 'utf8'),
  })
  const beforeIo = await snapshotOf()
  await routeOf('/preview').handler(fakeReq('GET'), fakeRes())
  await routeOf('/preview').handler(fakeReq('GET'), fakeRes())
  const afterIo = await snapshotOf()
  check(beforeIo.activeMtime === afterIo.activeMtime, '_active.json mtime 未被 preview 改动')
  check(beforeIo.sessionMtime === afterIo.sessionMtime, 'session.json mtime 未被 preview 改动')
  check(beforeIo.activeBytes === afterIo.activeBytes, '_active.json 字节未变（只读）')
  check(beforeIo.sessionBytes === afterIo.sessionBytes, 'session.json 字节未变（只读）')

  const resOff = fakeRes()
  await routeOf('/deactivate').handler(fakeReq('POST'), resOff)
  check(resOff.out.status === 200, `POST /deactivate → ${resOff.out.status}`)
  const renderedOff = sp.render()
  check(renderedOff.trim() === '', `退出后系统提示词归零（实际 ${renderedOff.length} 字符）`)
  check(!renderedOff.includes('角色扮演'), '退出后连"角色扮演"字样都没有')
}

// ---------------------------------------------------------------- 卸载
// 说明：cordis 的 Fiber 卸载是两层——fiber 自身的 effect 卸载由 parent fiber 驱动，
// 在裸 Context 里直接 dispose 会停在 UNLOADING(4)，那不是插件的问题。
// 这里直接验证**插件自己返回的卸载函数**：它必须把 web 路由、系统提示词段、
// 事件钩子全部释放干净（这也是宿主真正调用的一条路径）。
const routesBefore = registered.routes.length
const sectionsBefore = [...app.get('systemPrompt').layers.keys()].filter(n => n.startsWith('aiwu:')).length
check(typeof cleanupFn === 'function', '插件返回了卸载函数')
cleanupFn()
await new Promise(r => setTimeout(r, 200))
check(registered.routes.length === 0,
  `卸载后 REST 路由已释放（${routesBefore} → ${registered.routes.length}）`)
check([...app.get('systemPrompt').layers.keys()].filter(n => n.startsWith('aiwu:')).length === 0,
  `卸载后 systemPrompt 段已全部移除（${sectionsBefore} → 0）`)

await rm(sandbox, { recursive: true, force: true })
console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`)
if (failed > 0) {
  console.error('cordis 宿主验证未通过。')
  process.exit(1)
}
console.log('cordis 宿主验证全部通过。')
