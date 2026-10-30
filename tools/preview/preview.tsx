/**
 * 面板预览沙盒（仅开发用，不进 lib，不随插件发布）。
 *
 * 目的：把 `CharacterPanel` 从宿主里摘出来，单独跑在一个普通网页里，
 * 这样可以**真正在浏览器里看 DOM、量尺寸、测 hover**，改一行 CSS 刷新就能看，
 * 不用点活的 DSH、也不会干扰主人正在用的窗口。
 *
 * 做法：
 *  - 用 `fixtures.json`（从活插件 REST 抓下来的真实响应）顶替 fetch；
 *  - 自己造一个最小 translator（直接复用 `client/text.ts` 的 zh 字典）；
 *  - 挂一个虚拟壁纸背景，玻璃材质才看得出来（`backdrop-filter` 需要有东西可透）。
 */
import { createRoot } from 'react-dom/client'
import { CharacterPanel } from '../../client/index'
import { installStyles } from '../../client/styles'
import { localeDictionaries } from '../../client/text'
import fixtures from './fixtures.json'

const zh = (localeDictionaries as { zh: Record<string, string> }).zh

/** 与宿主 `t(key, params)` 同签名的最小实现：缺失键原样返回，和线上行为一致。 */
function translate(key: string, params?: Record<string, string | number>): string {
  const raw = zh[key] ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole)
}

/** 按路径把请求映射到固定响应。 */
const ROUTES: Array<[RegExp, string, (url: URL) => unknown]> = [
  [/\/overview$/, 'overview', () => (fixtures as Record<string, unknown>).overview],
  [/\/characters$/, 'characters', () => (fixtures as Record<string, unknown>).characters],
  [/\/character$/, 'character', () => (fixtures as Record<string, unknown>).character],
  [/\/relation$/, 'relation', () => (fixtures as Record<string, unknown>).relation],
  [/\/opening\/state$/, 'opening', () => ({ ok: true, state: 'none', opening: '', openings: [] })],
]

const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), window.location.origin)
  if (!url.pathname.startsWith('/_dsh/ai-with-u')) return originalFetch(input, init)
  for (const [pattern, , build] of ROUTES) {
    if (pattern.test(url.pathname)) {
      return new Response(JSON.stringify(build(url)), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }
  // 未覆盖的接口：给一个「能力缺失」的 404（与宿主未注册路由时的行为一致）
  return new Response('', { status: 404 })
}) as typeof fetch

installStyles()

const host = document.getElementById('root')
if (host !== null) {
  createRoot(host).render(
    <CharacterPanel wide t={translate} />,
  )
}
