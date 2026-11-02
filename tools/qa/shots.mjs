/**
 * 面板截图矩阵（开发/验收用，不进 lib、不随插件发布）。
 *
 *   node tools/qa/shots.mjs [--out=目录] [--only=名字片段] [--port=59621]
 *
 * 依赖：
 *  - 预览沙盒 `node tools/preview/serve.mjs`（默认 59621，每次请求重打包，所以截的就是当前源码）；
 *  - 本机 Playwright 的 chromium（`%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe`），
 *    没有 Playwright 模块也不要紧——本脚本只用 CDP，不 import playwright。
 *
 * 为什么不用 bsk_*：DSH 桌面版不是可注入 Chromium，browser-skill 连不上（见 docs/PLUGIN-DEV-GUIDE.md）。
 * 为什么不用 `chrome --screenshot`：那种方式没法点击，面板默认是收起的。
 *
 * 产物：`<out>/<场景名>.png`，外加 `index.md`（每张图对应哪条验收项）。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const outDir = arg('out', join(here, '../../06-tmp/ui-audit/matrix'))
const only = arg('only', '')
const port = Number(arg('port', '59621'))

/**
 * 降级态：`--media=reduce-motion` / `--media=reduce-transparency` / `--media=contrast-more`（可逗号组合）。
 * 走 CDP 的 Emulation.setEmulatedMedia，等价于系统里打开对应开关。
 */
const mediaArg = arg('media', '')
const MEDIA_FEATURES = []
if (mediaArg.includes('reduce-motion')) MEDIA_FEATURES.push({ name: 'prefers-reduced-motion', value: 'reduce' })
if (mediaArg.includes('reduce-transparency')) MEDIA_FEATURES.push({ name: 'prefers-reduced-transparency', value: 'reduce' })
if (mediaArg.includes('contrast-more')) MEDIA_FEATURES.push({ name: 'prefers-contrast', value: 'more' })
const mediaSuffix = MEDIA_FEATURES.length === 0
  ? ''
  : `--${MEDIA_FEATURES.map((f) => f.name.replace('prefers-', '')).join('+')}`

/** 常用点击步骤：打开面板。面板默认收起，任何场景都要先点侧栏入口。 */
const OPEN = `document.querySelector('.awu-trigger')?.click()`
/** 打开面板 → 切到「角色簿」→ 选第一张卡（详情页）。 */
const DETAIL = `${OPEN};setTimeout(()=>{const tab=[...document.querySelectorAll('.awu-tab')].find(e=>e.textContent.includes('角色簿'));tab?.click();
setTimeout(()=>document.querySelectorAll('.awu-card')[0]?.click(),250)},250)`
/** 按可见文字点按钮。 */
const clickText = (text) => `${OPEN};setTimeout(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim().includes('${text}'))?.click()},350)`
/** 按可见文字点 tab。 */
const tabOf = (text) => `${OPEN};setTimeout(()=>{[...document.querySelectorAll('.awu-tab')].find(e=>e.textContent.includes('${text}'))?.click()},300)`

/**
 * 场景表。每项：{ name, url, w, h, steps[], note }
 * `url` 里的 `?live=1` 表示「已启用一张卡」的夹具，`#dark` 走深色。
 */
const SCENES = [
  // ---- 浅色 · 主流程
  { name: 'light-roster', url: '/', w: 1440, h: 900, steps: [DETAIL], note: '浅色 · 角色簿 + 详情（主验收图）' },
  { name: 'light-roster-empty', url: '/', w: 1440, h: 900, steps: [OPEN, tabOf('角色簿')], note: '浅色 · 未选卡空态' },
  { name: 'light-diary', url: '/?live=1', w: 1440, h: 900, steps: [tabOf('日记')], note: '浅色 · 日记时间线' },
  { name: 'light-stats', url: '/?live=1', w: 1440, h: 900, steps: [tabOf('统计')], note: '浅色 · 统计' },
  { name: 'light-guide', url: '/', w: 1440, h: 900, steps: [tabOf('指南')], note: '浅色 · 指南（阅读面排版）' },
  { name: 'light-dialog', url: '/?live=1', w: 1440, h: 900, steps: [clickText('自创角色卡')], note: '浅色 · 新建角色弹层' },
  { name: 'light-editor', url: '/?live=1', w: 1440, h: 900, steps: [DETAIL, `setTimeout(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='编辑')?.click()},700)`], note: '浅色 · 角色卡编辑器' },
  // ---- 加载态 / 报错态（`?slow=` / `?fail=` 沙盒开关，见 tools/preview/preview.tsx 文件头）
  // 注 1：这两类界面以前从没被截过——沙盒没有 /presets、/preview 路由，面板永远走
  //       「宿主接口还没做」的黄色提示。
  // 注 2：slow 用 30000 而不是 1200/2500/6000。从导航到截图的耗时**不稳定**
  //       （实测 2.6s ~ 10s：目标创建、重试、每一步 700ms 都在里面），任何"够用就好"的
  //       延迟都会偶尔截到"刚加载完"的图（已经撞到两次）。所以直接把延迟拉到远大于
  //       场景时长，保证截图一定落在加载态里 —— 这张图要证明的就是"加载时长什么样"。
  { name: 'preset-loading', url: '/?slow=30000', w: 1200, h: 820, steps: [clickText('预设')], note: '加载态 · 预设列表骨架（?slow=30000）' },
  { name: 'preset-error', url: '/?fail=presets', w: 1200, h: 820, steps: [clickText('预设')], note: '报错态 · 预设列表 ErrorBar（?fail=presets）' },
  { name: 'preview-loading', url: '/?slow=30000', w: 1200, h: 820, steps: [clickText('预览')], note: '加载态 · 注入预览 Skeleton（?slow=30000）' },
  { name: 'preview-error', url: '/?fail=preview', w: 1200, h: 820, steps: [clickText('预览')], note: '报错态 · 注入预览 ErrorBar（?fail=preview）' },
  // ---- 深色 · 同上
  { name: 'dark-roster', url: '/?live=1#dark', w: 1440, h: 900, steps: [DETAIL], note: '深色 · 角色簿 + 详情' },
  { name: 'dark-diary', url: '/?live=1#dark', w: 1440, h: 900, steps: [tabOf('日记')], note: '深色 · 日记' },
  { name: 'dark-guide', url: '/#dark', w: 1440, h: 900, steps: [tabOf('指南')], note: '深色 · 指南' },
  { name: 'dark-dialog', url: '/?live=1#dark', w: 1440, h: 900, steps: [clickText('自创角色卡')], note: '深色 · 弹层' },
  // ---- 窄窗（响应式 / 单栏导航栈）
  { name: 'w1024-roster', url: '/?live=1', w: 1024, h: 768, steps: [DETAIL], note: '1024 · 两栏挤压' },
  { name: 'w900-roster', url: '/?live=1', w: 900, h: 760, steps: [DETAIL], note: '900 · 断点边界' },
  { name: 'w820-list', url: '/?live=1', w: 820, h: 700, steps: [tabOf('角色簿')], note: '820 · 单栏列表页' },
  { name: 'w820-detail', url: '/?live=1', w: 820, h: 700, steps: [DETAIL], note: '820 · 单栏详情页（push 后）' },
  { name: 'w560-list', url: '/?live=1', w: 560, h: 700, steps: [tabOf('角色簿')], note: '560 · 最窄档' },
]

const CHROME = await findChrome()
if (CHROME === undefined) {
  console.error('找不到 chromium：请装 Playwright 浏览器（npx playwright install chromium）或改 CHROME 路径')
  process.exit(1)
}

const scenes = SCENES.filter((s) => only === '' || s.name.includes(only))
if (scenes.length === 0) {
  console.error(`没有匹配 "${only}" 的场景`)
  process.exit(1)
}

await mkdir(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = await mkdtemp(join(tmpdir(), 'qa-shots-'))
const debugPort = 9000 + Math.floor(Math.random() * 900)
const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--force-color-profile=srgb',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

const rows = []
try {
  const browserWs = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
    return res.ok ? (await res.json()).webSocketDebuggerUrl : undefined
  })
  const ws = new WebSocket(browserWs)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })

  for (const scene of scenes) {
    const sceneStartedAt = Date.now()
    const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
    const { result: attached } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    const sid = attached.sessionId
    await send('Page.enable', {}, sid)
    await send('Runtime.enable', {}, sid)
    await send('Emulation.setDeviceMetricsOverride', {
      width: scene.w, height: scene.h, deviceScaleFactor: 1, mobile: false,
    }, sid)
    if (MEDIA_FEATURES.length > 0) {
      await send('Emulation.setEmulatedMedia', { features: MEDIA_FEATURES }, sid)
    }
    // 目标刚创建就导航，偶发 `net::ERR_ABORTED`（about:blank 还没加载完就被打断），
    // 结果是截到一张几乎空白的图 —— 这种"假截图"比没截更糟，所以失败就重试，并留痕。
    {
      let nav = await send('Page.navigate', { url: `http://127.0.0.1:${port}${scene.url}` }, sid)
      for (let attempt = 0; attempt < 3 && (nav.error !== undefined || nav.result?.errorText); attempt += 1) {
        await sleep(250)
        nav = await send('Page.navigate', { url: `http://127.0.0.1:${port}${scene.url}` }, sid)
      }
      const href = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sid)
      const got = href.result?.result?.value
      if (typeof got !== 'string' || !got.startsWith(`http://127.0.0.1:${port}`)) {
        console.error(`  ! ${scene.name} 导航失败（停在 ${String(got)}）—— 这张图不可信`)
      }
    }
    await sleep(1200)
    for (const code of scene.steps) {
      const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }, sid)
      if (r.result?.exceptionDetails !== undefined) {
        console.error(`  ! ${scene.name} 的 eval 抛错：${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`)
      }
      await sleep(700)
    }
    await sleep(400)
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid)
    const file = join(outDir, `${scene.name}${mediaSuffix}.png`)
    await writeFile(file, Buffer.from(shot.result.data, 'base64'))
    const size = (await readdir(outDir)).length
    // 打一下"从导航到截图"的耗时：加载态场景靠它判断到底有没有落在 loading 窗口里
    console.log(`✓ ${scene.name}  ${scene.w}×${scene.h}  ${scene.note}  (${size} 张，+${Date.now() - sceneStartedAt}ms)`)
    rows.push({ ...scene, file })
    await send('Target.closeTarget', { targetId: target.targetId })
  }
} finally {
  child.kill()
}

// 索引：验收时按这张表逐条过
const md = [
  '# 截图矩阵（本目录）',
  '',
  `> 生成：${new Date().toISOString()} · 沙盒 http://127.0.0.1:${port}/ · 场景 ${rows.length} 个`,
  `> 命令：\`node tools/qa/shots.mjs${only === '' ? '' : ` --only=${only}`}${mediaArg === '' ? '' : ` --media=${mediaArg}`}\``,
  MEDIA_FEATURES.length === 0 ? '' : `> 降级态：${MEDIA_FEATURES.map((f) => `${f.name}=${f.value}`).join(', ')}`,
  '',
  '| 图 | 尺寸 | 看什么 |',
  '|---|---|---|',
  ...rows.map((r) => `| ${r.name}${mediaSuffix}.png | ${r.w}×${r.h} | ${r.note} |`),
  '',
  '## 降级态怎么跑',
  '',
  '```',
  'node tools/qa/shots.mjs --media=reduce-motion        --out=06-tmp/ui-audit/matrix-rm',
  'node tools/qa/shots.mjs --media=reduce-transparency  --out=06-tmp/ui-audit/matrix-rt',
  'node tools/qa/shots.mjs --media=contrast-more        --out=06-tmp/ui-audit/matrix-hc',
  '```',
].join('\n')
await writeFile(join(outDir, 'index.md'), md)
console.log(`\n索引：${join(outDir, 'index.md')}`)

/** 依次尝试常见安装位置。 */
async function findChrome() {
  const exists = async (p) => { try { const s = await stat(p); return s.isFile() } catch { return false } }
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  try {
    const dirs = (await readdir(root)).filter((d) => d.startsWith('chromium'))
    for (const d of dirs.sort().reverse()) {
      const exe = join(root, d, 'chrome-win64', 'chrome.exe')
      if (await exists(exe)) return exe
    }
  } catch {}
  const fallbacks = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]
  for (const f of fallbacks) {
    if (await exists(f)) return f
  }
  return undefined
}

async function waitFor(fn, timeout = 15000) {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v !== undefined && v !== null) return v
    } catch {}
    if (Date.now() - start > timeout) throw new Error('等待 chromium 调试端口超时')
    await sleep(120)
  }
}
