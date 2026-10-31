/**
 * 把 client/entry.tsx 打包成 DSH Web 客户端要求的模块格式。
 *
 * DSH 的 client-modules 通过 `window.__ModuleLoader__.load({ id, factory })` 加载第三方
 * 浏览器插件（同一格式见已装插件 dsh-usage-stats 的 lib/client.js）。
 *
 * react / react-dom / react/jsx-runtime 一律由宿主提供，走 factory 的 `require`，
 * 不打进 bundle —— 否则会出现第二个 React 实例，hooks 直接炸。
 * 注意不要试图把 `react/jsx-runtime` 换成 `react/jsx-dev-runtime`：后者只导出
 * `jsxDEV`，没有 `jsx` / `jsxs`，换过去后 esbuild 生成的 `jsxs(...)` 调用会变成
 * undefined。宿主的模块表里两个 runtime 都在，保持默认引用即可。
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

/** 外部化的宿主模块：必须是宿主模块表里真实存在的条目。 */
const HOST_MODULES = ['react', 'react-dom', 'react/jsx-runtime']

const result = await build({
  entryPoints: [join(root, 'client', 'entry.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  target: ['chrome120'],
  write: false,
  external: HOST_MODULES,
  logLevel: 'warning',
  sourcemap: false,
  legalComments: 'none',
  // 宿主直接加载这个文件，没人再做二次压缩：不 minify 就是白付 160KB 的读取与解析成本
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
})

const code = result.outputFiles[0].text

const wrapped = `window.__ModuleLoader__.load({ id: "dsh-ai-with-u", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
${code}
return module.exports; } });
`

await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib', 'client.js'), wrapped, 'utf8')

const kb = (Buffer.byteLength(wrapped, 'utf8') / 1024).toFixed(1)
const requires = [...wrapped.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1])
const unique = [...new Set(requires)]
console.log(`lib/client.js 已生成（${kb} KB）`)
console.log(`外部依赖：${unique.join(', ') || '（无）'}`)
