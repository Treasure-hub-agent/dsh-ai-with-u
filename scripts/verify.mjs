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
import { readFile, readdir, stat } from 'node:fs/promises'
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
// 与 verify-wiring 的口径分工（两处都写注释，防止只改一边再度分叉）：
//   · 这里做「产物比源码旧 → fail」：新鲜度是硬契约，改了源码没重编必须在安装前拦住；
//   · wiring 第 8 节做「产物↔源码逐字比对 → 产物旧则 [skip]」：内容一致性检查
//     在产物还没编出来时无从比对，skip 不算失败（scripts/verify-wiring.mjs 同款注释）。
console.log('产物检查：')
// 动态生成映射：src/*.ts → lib/*.js。写死列表会漏掉后加的模块
// （tavern / import-card / distill 就是这样长期没被新鲜度检查覆盖的）。
const pairs = (await readdir(join(root, 'src')))
  .filter(name => name.endsWith('.ts'))
  .map(name => [`src/${name}`, `lib/${name.replace(/\.ts$/u, '.js')}`])

// 前端产物是单文件 bundle（entry.tsx 打包进 lib/client.js）：配对对象是
// client/ 全目录的最大 mtime，而不是某个入口文件——entry import 的
// distill/text/styles/preset-view 等模块改了同样必须重编。
// （旧写法只盯 client/index.tsx，改其余文件单独 npm run verify 会假绿。）
const clientLatest = async () => {
  const walk = async (dir) => {
    const out = []
    for (const dirent of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, dirent.name)
      if (dirent.isDirectory()) out.push(...await walk(path))
      else out.push(path)
    }
    return out
  }
  const files = await walk(join(root, 'client'))
  const stamps = await Promise.all(files.map(p => stat(p).then(s => s.mtimeMs)))
  return Math.max(...stamps)
}

for (const [src, out] of pairs) {
  try {
    const [a, b] = await Promise.all([stat(join(root, src)), stat(join(root, out))])
    if (b.mtimeMs + 1000 < a.mtimeMs) fail(`${out} 比 ${src} 旧，重新构建`)
    else ok(`${out} 已是最新`)
  } catch {
    fail(`${out} 不存在`)
  }
}
{
  const out = 'lib/client.js'
  try {
    const [latest, b] = [await clientLatest(), await stat(join(root, out))]
    if (b.mtimeMs + 1000 < latest) fail(`${out} 比 client/ 下最新源文件旧，重新构建`)
    else ok(`${out} 已是最新（对照 client/ 全目录最大 mtime）`)
  } catch {
    fail(`${out} 不存在或 client/ 无法遍历`)
  }
}
// 孤儿产物：lib 里有 .js，但 src 里没有同名 .ts（多半是改完没清干净的旧模块）
// lib/client.js 是前端 bundle，pair 不来自 src/*.ts，这里显式补进期望集合
{
  const expected = new Set([...pairs.map(([, out]) => out), 'lib/client.js'])
  const libFiles = (await readdir(join(root, 'lib'))).filter(name => name.endsWith('.js'))
  for (const name of libFiles) {
    if (!expected.has(`lib/${name}`)) fail(`lib/${name} 没有对应的源文件（孤儿产物，删掉或补回 src）`)
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
