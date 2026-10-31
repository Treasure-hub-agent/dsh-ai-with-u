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
import { mkdtemp, readdir, rm } from 'node:fs/promises'
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
check(sectionNames.includes('aiwu:active-character'), 'L1 角色段已注册（未启用时为空串）')
check(sectionNames.includes('aiwu:lore'), '世界书段已注册（垫底 order 10300）')
check(sectionNames.includes('aiwu:clock'), '时间差段已注册（最后 order 10350）')

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
const renderedIdle = sp.render()
check(!renderedIdle.includes('角色扮演底线'), '未启用时系统提示词里没有 L0 底线（L0 与角色同进同出）')
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

if (routeOf('/distill/arm') === undefined) {
  fail('没有注册 /distill/arm 路由')
} else {
  const before = registered.tools.length
  const res1 = fakeRes()
  await routeOf('/distill/arm').handler(fakeReq('POST'), res1)
  check(res1.out.status === 200 && res1.out.body?.ok === true, `POST /distill/arm → ${res1.out.status}`)
  check(registered.tools.includes('awu_card_save'), 'arm 之后 awu_card_save 真的挂到了工具服务上')
  check(registered.tools.length === before + 1, `工具数 ${before} → ${registered.tools.length}`)

  const res2 = fakeRes()
  await routeOf('/distill/disarm').handler(fakeReq('POST'), res2)
  check(res2.out.body?.armed === false, 'disarm 接口报告已解除')
  check(!registered.tools.includes('awu_card_save'), 'disarm 之后工具被卸下')
  check(registered.tools.length === before, `工具数回到 ${before}`)
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
  check(renderedOn.length > 500, `启用后渲染长度 ${renderedOn.length} 字符`)

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
