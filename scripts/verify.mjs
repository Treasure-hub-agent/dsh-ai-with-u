/**
 * 构建后自检：拦住会让插件在 DSH 里「failed 但不说原因」的几类打包错误。
 *
 * 背景：2026-10-30 首次安装时插件启动失败，诊断日志只写 `dsh-ai-with-u: failed`
 * 不给原因，根因是两条叠加的问题：
 *   1. `ln -sfn` 在 Windows Git Bash 下静默退化成目录拷贝，DSH 读到的是旧代码；
 *   2. 旧代码把 `inject` 写成了 `{ required, optional }` 对象——Cordis 的
 *      `Inject = (keyof M)[] | { name: interceptConfig }`，对象形式会被当成
 *      「服务名 → 拦截配置」映射，于是插件卡在等待 `required`/`optional` 两个
 *      不存在的服务上，表现为 failed 且无堆栈。
 *
 * 所以这里做三件事：校验导出形状、校验 inject 是数组、校验产物比源码新。
 */
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
let failed = false

const fail = (msg) => { console.error(`  ✗ ${msg}`); failed = true }
const ok = (msg) => { console.log(`  ✓ ${msg}`) }

// ---------------------------------------------------------------- 1. 导出形状
// Windows 上 join 出来的盘符路径不能直接 import，必须走 file:// URL
const mod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
console.log('导出检查：')
if (typeof mod.name === 'string' && mod.name !== '') ok(`name = ${mod.name}`)
else fail('缺少字符串导出 name')

if (typeof mod.apply === 'function') ok('apply 是函数')
else fail('缺少 apply 函数')

if (mod.default === undefined) ok('无 default 导出')
else fail('存在 default 导出 —— Cordis Loader 会折叠模块并丢掉 inject')

// ---------------------------------------------------------------- 2. inject 形式
console.log('inject 检查：')
const inject = mod.inject
if (!Array.isArray(inject)) {
  fail(`inject 必须是数组，实际是 ${JSON.stringify(inject)} —— 对象形式会被误解析成服务名，插件将卡在 pending`)
} else if (inject.length === 0) {
  fail('inject 为空数组，等于没有声明任何服务依赖')
} else {
  ok(`inject = [${inject.join(', ')}]`)
  // 拼错的常见形态：把 required/optional 这类单词当服务名带进来
  const suspicious = inject.filter(n => ['required', 'optional', 'services'].includes(n))
  if (suspicious.length > 0) fail(`inject 里混进了非服务名：${suspicious.join(', ')}`)
}

// ---------------------------------------------------------------- 3. 产物新鲜度
console.log('产物检查：')
const pairs = [
  ['src/index.ts', 'lib/index.js'],
  ['src/prompt.ts', 'lib/prompt.js'],
  ['src/store.ts', 'lib/store.js'],
  ['src/tools.ts', 'lib/tools.js'],
  ['src/web.ts', 'lib/web.js'],
  ['client/index.tsx', 'lib/client.js'],
]
for (const [src, out] of pairs) {
  try {
    const [a, b] = await Promise.all([stat(join(root, src)), stat(join(root, out))])
    if (b.mtimeMs + 1000 < a.mtimeMs) fail(`${out} 比 ${src} 旧，重新构建`)
    else ok(`${out} 已是最新`)
  } catch {
    fail(`${out} 不存在`)
  }
}

// ---------------------------------------------------------------- 4. 前端产物格式
console.log('前端产物检查：')
try {
  const client = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  if (client.includes('window.__ModuleLoader__.load(')) ok('client.js 是 ModuleLoader 格式')
  else fail('client.js 缺少 window.__ModuleLoader__.load 包装，浏览器端不会加载')
  if (/require\("react"\)/.test(client)) ok('react 走 require（宿主提供）')
  else fail('未把 react 外部化，bundle 会重复打包 React 实例')
} catch {
  fail('无法读取 lib/client.js')
}

if (failed) {
  console.error('\n自检未通过，请修复后再安装。')
  process.exit(1)
}
console.log('\n自检全部通过。')
