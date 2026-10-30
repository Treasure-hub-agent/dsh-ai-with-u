/**
 * 打包预览沙盒并起一个静态服务（仅开发用）。
 *
 *   node tools/preview/serve.mjs
 *
 * **每次请求 /bundle.js 都重新打包**（esbuild 约 100ms），所以改完 `client/**`
 * 只要在浏览器里刷新页面就能看到最新效果，不用重启服务。
 * 服务端口默认 59621，可用 PORT 环境变量覆盖。
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const bundleOnce = async () => {
  const result = await build({
    entryPoints: [join(here, 'preview.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    target: ['chrome120'],
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  return result.outputFiles[0].text
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' }
const port = Number(process.env.PORT ?? 59621)

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname === '/' ? '/index.html' : url.pathname
  if (path === '/bundle.js') {
    try {
      const code = await bundleOnce()
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' })
      res.end(code)
    } catch (error) {
      // 把编译错误直接回给浏览器，QA 一眼能看到是哪个文件、哪一行
      const message = error instanceof Error ? (error.message || String(error)) : String(error)
      res.writeHead(500, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(`document.body.innerHTML = '<pre style="padding:24px;font:13px ui-monospace;color:#b00;white-space:pre-wrap">' + ${JSON.stringify(`预览打包失败：\n${message}`)} + '</pre>';`)
    }
    return
  }
  try {
    const file = join(here, path)
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`预览沙盒: http://127.0.0.1:${port}/  （每次刷新自动重打包）`)
})
