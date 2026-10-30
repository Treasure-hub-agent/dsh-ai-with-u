/**
 * 产物「能不能被加载」自检。
 *
 * 为什么需要它：`tsc` 只查类型、esbuild 只转译，两者都**不执行**模块。
 * 一个写在 CSS 模板串注释里的反引号会把模板提前截断，剩下的文字变成 JS 表达式——
 * 例如 `.awu-rail` 后面的 `- rail` 被当成减法，模块初始化即抛
 * `ReferenceError: rail is not defined`。宿主加载 client module 失败后**静默跳过**，
 * 表现是「侧栏入口消失、面板打不开」，而构建、类型检查、其余四套自检全绿。
 * （2026-10-30 真实事故，排查成本约 20 分钟）
 *
 * 做法：用最小 DOM stub 把 `lib/client.js` 真正 import 一遍，拿到
 * `window.__ModuleLoader__` 注册的 factory，再**执行 factory**（这一步才会跑模块体），
 * 最后断言导出形状与 `apply/inject` 的存在。
 */
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = process.cwd()
const require = createRequire(resolve(root, 'package.json'))

let pass = 0
let fail = 0
const check = (ok, label, detail = '') => {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${label}${detail !== '' ? `：${detail}` : ''}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}${detail !== '' ? `：${detail}` : ''}`)
  }
}

const store = {}
const makeEl = () => ({
  dataset: {}, style: {}, textContent: '',
  appendChild() {}, remove() {}, setAttribute() {}, removeAttribute() {},
})

globalThis.window = {
  __ModuleLoader__: { load: spec => { store.spec = spec } },
  addEventListener() {}, removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  innerWidth: 1440, innerHeight: 900,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: makeEl,
  head: makeEl(),
  body: makeEl(),
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
}

console.log('客户端产物加载自检：')

let spec
try {
  await import(pathToFileURL(resolve(root, 'lib/client.js')).href)
  spec = store.spec
  check(spec !== undefined, '产物向 __ModuleLoader__ 注册了模块')
} catch (error) {
  check(false, '产物自身语法/求值可执行', error instanceof Error ? error.message : String(error))
}

if (spec !== undefined) {
  check(spec.id === 'dsh-ai-with-u', 'module id 正确', String(spec.id))
  check(typeof spec.factory === 'function', 'factory 是函数')

  if (typeof spec.factory === 'function') {
    try {
      // 关键一步：执行 factory —— 模块体在这一刻跑，模板串截断之类的错误会在这里抛
      const mod = spec.factory(name => require(name))
      check(true, 'factory 执行未抛错（模块初始化安全）')
      check(typeof mod.apply === 'function', '导出 apply 函数')
      check(Array.isArray(mod.inject), 'export inject 是数组', JSON.stringify(mod.inject))
      check(typeof mod.CharacterPanel === 'function' || typeof mod.CharacterPanel === 'object',
        '导出 CharacterPanel 组件')
      check(mod.default === undefined, '没有 export default（Cordis loader 会丢 inject）')
      const text = String(mod.apply)
      check(text.length > 0, 'apply 源码非空')
    } catch (error) {
      check(false, 'factory 执行未抛错（模块初始化安全）',
        error instanceof Error ? `${error.message} —— 宿主会静默跳过整个插件` : String(error))
    }
  }
}

console.log('')
if (fail > 0) {
  console.log(`客户端产物加载自检失败：通过 ${pass} 项，失败 ${fail} 项。`)
  console.log('提示：这类错误 tsc/esbuild 都查不出来，通常是 styles 模板串里混进了反引号或 ${...}。')
  process.exit(1)
}
console.log(`客户端产物加载自检全部通过（${pass} 项）。`)
