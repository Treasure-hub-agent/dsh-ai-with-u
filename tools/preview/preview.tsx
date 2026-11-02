/**
 * 面板预览沙盒（**仅开发用**：`tools/preview/**` 不进 `lib/`、不随插件发布，也不参与
 * `npm run build` 的任何一步；它只是把插件客户端摘到一个普通网页里跑）。
 *
 * 目的：把 `CharacterPanel` 从宿主里摘出来，单独跑在一个普通网页里，
 * 这样可以**真正在浏览器里看 DOM、量尺寸、测 hover**，改一行 CSS 刷新就能看，
 * 不用点活的 DSH、也不会干扰主人正在用的窗口。
 *
 * 做法：
 *  - 用 `fixtures.json`（沙盒合成数据）顶替 fetch；
 *  - 自己造一个最小 translator（直接复用 `client/text.ts` 的 zh 字典）；
 *  - 挂一个虚拟壁纸背景，玻璃材质才看得出来（`backdrop-filter` 需要有东西可透）。
 *
 * ── 场景开关（都只影响沙盒，URL 上叠加即可） ────────────────────────────────
 *   ?live=1             模拟「已启用一张卡」：overview.active 打开、详情带日记与会话，
 *                       用来验收日记时间线、启用态横幅这些「只有启用后才出现」的界面。
 *   ?dark=1             强制深色（`index.html` 里那条 html[data-ds-dark-theme] 开关）。
 *   ?slow=1200          所有 fixture 响应延迟 N 毫秒 —— 用来**真的看到**骨架屏 / 加载提示。
 *   ?fail=presets       对应路由返回 HTTP 500 + `{ok:false,error}` 信封 —— 用来**真的看到**
 *   ?fail=preview       ErrorBar（在此之前沙盒没这两条路由，面板永远走「宿主接口未就绪」的
 *   ?fail=all           黄色提示分支，红色错误条从来没被实机看到过）。
 *   ?crash=1            渲染期崩溃探针：给面板传一个「一调用就抛错」的 `t`，并用
 *                       `CharacterEntry`（内含 `PanelBoundary`）包住 —— 验证 P0 的
 *                       ErrorBoundary 降级路径：**显示「重试」而不是白屏**。
 *                       点重试会再崩一次（预期），重点是无白屏、无未捕获崩栈。
 */
import { createRoot } from 'react-dom/client'
import { CharacterPanel } from '../../client/index'
import { CharacterEntry } from '../../client/entry'
import { installStyles } from '../../client/styles'
import { localeDictionaries } from '../../client/text'
import fixtures from './fixtures.json'

const zh = (localeDictionaries as { zh: Record<string, string> }).zh
const data = fixtures as Record<string, unknown>

/** 与宿主 `t(key, params)` 同签名的最小实现：缺失键原样返回，和线上行为一致。 */
function translate(key: string, params?: Record<string, string | number>): string {
  const raw = zh[key] ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole)
}

/**
 * 崩溃探针的注入点：让面板在**量自己的尺寸时**抛错（`useWideLayout` 的 effect 里）。
 *
 * ⚠️ 三次踩坑记录（前两次都崩不了 —— 这两条本身是重要结论，别把它当"探针没写好"）：
 *  1. `t = () => { throw new Error('crash') }`：**崩不了**。面板里的 `t` 一律经
 *     `text.ts` 的 `makeTranslator` 包一层，它对每次调用都 try/catch（宿主 translator
 *     坏掉时回落中文词典）→ 异常被安静吸收，面板照常渲染。
 *  2. `t` 返回非字符串（指望 React 抛 "Objects are not valid as a React child"）：
 *     同样**崩不了**。makeTranslator 只认 `typeof value === 'string'`，其余一律回落
 *     中文词典 —— 这个翻译层是**完整防火墙**。
 *  3. 往 `/overview` 塞「读什么都抛」的 Proxy：**崩不了**。因为 `request()` 走的是
 *     `res.text()` + `JSON.parse`，任何毒对象都会在 `JSON.stringify` 那一步被序列化成
 *     普通 JSON —— 序列化同样是防火墙。
 *
 * 所以崩溃只能注入到「面板直接摸的运行环境」上。这里改 `Element.prototype.
 * getBoundingClientRect`：只对 `.awu-layer`（面板自己的宿主节点）抛错，其余元素照旧。
 * 抛点是 `index.tsx` 的 `useWideLayout` —— 它在 effect 里量容器宽度；React 会把
 * effect 里抛出的错误路由给最近的错误边界（与渲染期错误同一套降级路径）。
 *
 * 仍然用**真实的** `CharacterEntry`（内部就是 `PanelBoundary`）包住面板，不另写探针边界。
 */
function installCrashProbe(): void {
  const originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    if (this.classList !== undefined && this.classList.contains('awu-layer')) {
      throw new Error('crash probe：?crash=1 让 .awu-layer 的 getBoundingClientRect 抛错')
    }
    return originalRect.call(this)
  }
}

/** 场景参数（只读一次；改 URL 刷新即可换场景）。 */
const query = new URLSearchParams(window.location.search)
const scenario = query.get('live') === '1' ? 'live' : 'default'
const slowMs = Math.max(0, Math.min(10000, Number(query.get('slow') ?? '0') || 0))
const failKeys = new Set(
  (query.get('fail') ?? '').split(',').map(s => s.trim()).filter(s => s !== ''),
)
const crashProbe = query.get('crash') === '1'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** 一条 fixture 路由。`key` 同时是 `?fail=` 里用来点名的那一段。 */
interface RouteSpec {
  key: string
  pattern: RegExp
  build: (url: URL) => unknown
}

/** 单条预设详情：按 `?id=` 取，取不到就回第一条（列表里点哪个都不至于白屏）。 */
function presetDetail(url: URL): unknown {
  const details = (data.presetDetails ?? {}) as Record<string, unknown>
  const wanted = url.searchParams.get('id') ?? ''
  if (wanted !== '' && details[wanted] !== undefined) return details[wanted]
  const first = Object.keys(details)[0]
  return first === undefined ? { ok: false, error: '沙盒没有预设详情 fixture' } : details[first]
}

/** 按路径把请求映射到固定响应。 */
const ROUTES: RouteSpec[] = [
  { key: 'overview', pattern: /\/overview$/, build: () => data.overview },
  { key: 'characters', pattern: /\/characters$/, build: () => data.characters },
  { key: 'character', pattern: /\/character$/, build: () => data.character },
  { key: 'relation', pattern: /\/relation$/, build: () => data.relation },
  { key: 'opening', pattern: /\/opening\/state$/, build: () => ({ ok: true, state: 'none', opening: '', openings: [] }) },
  /*
   * 「怎么说」的三个只读接口。注意顺序无关（`/presets` 用 $ 锚定，不会被 `/preset` 吃掉），
   * 但两条都要在，否则面板里的预设列表与注入预览永远走「宿主还没做」的降级分支。
   */
  { key: 'presets', pattern: /\/presets$/, build: () => data.presets },
  { key: 'preset', pattern: /\/preset$/, build: presetDetail },
  { key: 'preview', pattern: /\/preview$/, build: () => data.preview },
]

/** `?live=1`：把 overview / character 换成「已启用」那份。 */
if (scenario === 'live' && data.liveOverview !== undefined) {
  const liveOverview = data.liveOverview
  const liveDetail = data.liveDetail
  ROUTES.unshift(
    { key: 'overview', pattern: /\/overview$/, build: () => liveOverview },
    { key: 'character', pattern: /\/character$/, build: () => liveDetail },
  )
}

/** `?crash=1`：先把面板的运行环境弄坏（见 installCrashProbe 的注释）。 */
if (crashProbe) installCrashProbe()

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

/** 被 `?fail=` 点名的路由：500 + `{ok:false,error}` 信封（api.ts 会把它变成一条 ErrorBar 文案）。 */
const failed = (key: string): boolean => failKeys.has(key) || failKeys.has('all')

const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), window.location.origin)
  if (!url.pathname.startsWith('/_dsh/ai-with-u')) return originalFetch(input, init)
  // ?slow=N：慢响应。故意放在匹配之前 —— 连"未覆盖接口"的 404 也一起慢，
  // 这样加载态是稳定的，不会出现"某几条快几条慢"的抖动。
  if (slowMs > 0) await sleep(slowMs)
  for (const route of ROUTES) {
    if (!route.pattern.test(url.pathname)) continue
    if (failed(route.key)) {
      return jsonResponse({ ok: false, error: `沙盒注入的失败：/${route.key} 返回 500（URL 上带了 ?fail=）` }, 500)
    }
    return jsonResponse(route.build(url))
  }
  // 未覆盖的接口：给一个「能力缺失」的 404（与宿主未注册路由时的行为一致）
  return new Response('', { status: 404 })
}) as typeof fetch

installStyles()

const host = document.getElementById('root')
if (host !== null) {
  createRoot(host).render(
    // 崩溃场景也走**真实的** `CharacterEntry`（内部就是 `PanelBoundary`），
    // 不另写一个探针专用边界 —— 要验的就是线上那一层。
    crashProbe
      ? <CharacterEntry wide t={translate} />
      : <CharacterPanel wide t={translate} />,
  )
  // 让 CDP 探测脚本知道"这是崩溃场景"，省得靠 DOM 反推
  if (crashProbe) document.documentElement.dataset.awuCrashProbe = '1'
  if (slowMs > 0) document.documentElement.dataset.awuSlow = String(slowMs)
  if (failKeys.size > 0) document.documentElement.dataset.awuFail = [...failKeys].join(',')
}
