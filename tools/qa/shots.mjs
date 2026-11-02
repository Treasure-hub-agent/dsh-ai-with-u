/**
 * 面板截图矩阵（开发/验收用，不进 lib、不随插件发布）。
 *
 *   node tools/qa/shots.mjs [--out=目录] [--only=模式] [--port=59621] [--media=reduce-motion,...]
 *
 * 依赖：
 *  - 预览沙盒 `node tools/preview/serve.mjs`（默认 59621，每次请求重打包，所以截的就是当前源码）；
 *  - 本机 chromium（Playwright 自带的优先，其次系统 Chrome/Edge/Chromium）。只走 CDP，不 import playwright。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * **这个脚本会红。** 以前它对三种"假绿"完全无感（导航挂了、打包 500、步骤点到不存在的
 * 元素），一律 `✓` + `exit 0` —— 那样的矩阵只证明"脚本跑完了"，不证明"界面对"。
 * 现在每个场景收集失败项，末尾 `通过 N / 失败 M`，**有失败就 exit 1**：
 *
 *   F1 导航没落到预期 URL（含 about:blank 竞态、端口上是别人的服务）
 *   F2 `/bundle.js` 不是 200 / 是打包失败页 / 体积异常小
 *   F3 步骤里的目标元素不存在（步骤表达式直接 throw，不再用 `?.click()` 吞掉）
 *   F4 截图文件过小（< 40 KB：空白页/纯壁纸的量级）
 *   F5 截图与"同 URL 未操作基线"几乎一致（像素栅格差 < 1.5% → 步骤等于没生效）
 *
 * F5 是这套矩阵的核心断言：**基线 = 同一个 URL、同一个尺寸、什么都不点**。所以它能抓住
 * "选择器改了、面板没打开、弹层没弹出来"这类问题——这类问题以前会产出一张"看起来还行
 * 但少了面板"的图，人眼很难发现。
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 产物：`<out>/<场景名>.png` + `<out>/index.md`（图 ↔ 验收项 ↔ 本次结果）。
 * 默认 `<out>` 在**仓库外**（`<工作区>/06-tmp/ui-audit/matrix`），避免把证据提交进仓库。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 找仓库根：从脚本所在目录往上找 `package.json`（最多 6 层）。
 *
 * 为什么不直接 `join(here,'..','..')`：那样一旦脚本被复制到别处（自测就干过这事），
 * `repoRoot` 会算到 `C:\Users` 这种地方，默认 `--out` 变成 `C:\06-tmp/...` → EPERM。
 */
async function findRepoRoot(start) {
  let dir = start
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      if (typeof pkg.name === 'string' && pkg.name === 'dsh-ai-with-u') return dir
    } catch {}
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}

const repoRoot = await findRepoRoot(here)
/**
 * 工作区根（仓库外）：仓库是 `<work>/01-projects/dsh-ai-with-u`，所以**上两级**就是 `<work>`。
 * （写成三级会落到 `D:\CODEX`，产物跑到工作区外面去 —— 实测踩过一次。）
 */
const workRoot = join(repoRoot, '..', '..')

/** 惰性句柄：统一退出时要先把它们收掉（见 `die`）。 */
let child = null
let wsRef = null

/**
 * 统一退出。
 *
 * ⚠️ 不能直接 `process.exit(code)`：Node 24 + Windows 下，如果此刻 undici 的 fetch
 * 句柄正在收尾，会撞 libuv 断言 `!(handle->flags & UV_HANDLE_CLOSING)` → 进程以
 * **0xC0000409** 崩掉，父进程（CI / 自测脚本）拿到的不是我们的退出码，看起来像"脚本崩了"
 * 而不是"有断言失败"。所以先关 ws、放一拍让句柄收尾，再 exit。
 */
const die = async (code) => {
  try { wsRef?.close?.() } catch {}
  try { child?.kill?.() } catch {}
  await new Promise((r) => setTimeout(r, 30))
  process.exit(code)
}

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}

const outDir = arg('out', join(workRoot, '06-tmp', 'ui-audit', 'matrix'))
const only = arg('only', '')
const port = Number(arg('port', '59621'))
const base = `http://127.0.0.1:${port}`

/** 截图最小体积（字节）：真实面板图 300–900 KB，空白/纯壁纸 3–10 KB。 */
const MIN_SHOT_BYTES = 40 * 1024
/** 与"未操作基线"的最小像素栅格差（0–1，按通道均值）。低于它就是"步骤等于没生效"。 */
const MIN_GRID_DIFF = 0.015

/**
 * 降级态：`--media=reduce-motion` / `reduce-transparency` / `contrast-more`（可逗号组合）。
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

// ---------------------------------------------------------------- 步骤原语
//
// 每一步都是"要么成功、要么 throw"的 async 表达式（CDP 侧开了 awaitPromise，
// 所以 throw 会变成 exceptionDetails，被上面认定为 F3）。
// 等待策略：元素不在就先等 300ms 再看一次（React 渲染/弹层动画），仍不在就失败。

const settle = (ms) => `await new Promise(r => setTimeout(r, ${ms}))`

/** 点一个元素；`text` 给了就按可见文字在候选里挑。 */
const clickStep = (what, selector, text = '') => `(async () => {
  const find = () => ${text === ''
    ? `document.querySelector(${JSON.stringify(selector)})`
    : `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => (e.textContent || '').includes(${JSON.stringify(text)}))`}
  let el = find()
  if (el === null || el === undefined) { ${settle(300)}; el = find() }
  if (el === null || el === undefined) throw new Error('找不到元素：${selector}${text === '' ? '' : ` 含文字「${text}」`}（${what}）')
  el.click()
  return 'clicked ${what}'
})()`

const S = {
  open: () => ({ what: '打开面板', expr: clickStep('侧栏入口', '.awu-trigger') }),
  tab: (text) => ({ what: `切 tab ${text}`, expr: clickStep(`tab「${text}」`, '.awu-tab', text) }),
  card: (index = 0) => ({
    what: `选第 ${index + 1} 张卡`,
    expr: `(async () => {
      let cards = document.querySelectorAll('.awu-card')
      if (cards.length === 0) { ${settle(400)}; cards = document.querySelectorAll('.awu-card') }
      if (cards.length === 0) throw new Error('角色簿里没有卡片（fixture 或列表渲染没到位）')
      cards[${index}].click()
      return 'card ${index}'
    })()`,
  }),
  /** 按可见文字点任意 button（精确文字，避免「编辑」误命中「编辑器」）。 */
  button: (text) => ({
    what: `点按钮「${text}」`,
    expr: `(async () => {
      const find = () => [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === ${JSON.stringify(text)})
      let el = find()
      if (el === undefined) { ${settle(350)}; el = find() }
      if (el === undefined) throw new Error('找不到按钮：文字恰好为「${text}」')
      el.click()
      return 'clicked'
    })()`,
  }),
  /** 按选择器 + 可选文字点（工具栏那种） */
  click: (what, selector, text = '') => ({ what, expr: clickStep(what, selector, text) }),
}

/**
 * 场景表。每项：{ name, url, w, h, steps[], note }
 * `?live=1` = 「已启用一张卡」夹具；`#dark` = 深色；`?bound=1` = 「会话已绑定」夹具。
 */
const SCENES = [
  // ---- 浅色 · 主流程
  { name: 'light-roster', url: '/', w: 1440, h: 900, steps: [S.open(), S.tab('角色簿'), S.card()], note: '浅色 · 角色簿 + 详情（主验收图）' },
  { name: 'light-roster-empty', url: '/', w: 1440, h: 900, steps: [S.open(), S.tab('角色簿')], note: '浅色 · 未选卡空态' },
  { name: 'light-diary', url: '/?live=1', w: 1440, h: 900, steps: [S.open(), S.tab('日记')], note: '浅色 · 日记时间线' },
  { name: 'light-stats', url: '/?live=1', w: 1440, h: 900, steps: [S.open(), S.tab('统计')], note: '浅色 · 统计' },
  { name: 'light-guide', url: '/', w: 1440, h: 900, steps: [S.open(), S.tab('指南')], note: '浅色 · 指南（阅读面排版）' },
  { name: 'light-dialog', url: '/?live=1', w: 1440, h: 900, steps: [S.open(), S.button('自创角色卡')], note: '浅色 · 新建角色弹层' },
  { name: 'light-editor', url: '/?live=1', w: 1440, h: 900, steps: [S.open(), S.tab('角色簿'), S.card(), S.button('编辑'), { what: '等编辑器', expr: `(async () => { ${settle(500)}; if (document.querySelector('.awu-editor') === null) throw new Error('编辑器没打开（.awu-editor 不在）'); return 'ok' })()` }], note: '浅色 · 角色卡编辑器' },
  // ---- 会话已绑定（P1.7：以前所有图都停在「当前会话不可识别」的降级分支）
  { name: 'bound-session', url: '/?bound=1', w: 1440, h: 900, steps: [S.open(), S.tab('角色簿'), S.card(), { what: '断言绑定态', expr: `(async () => {
      ${settle(400)}
      const sigil = document.querySelector('.awu-sigil')
      if (sigil === null) throw new Error('状态带没走「当前会话正在用谁」分支（.awu-sigil 不在）')
      const text = sigil.textContent || ''
      // 「当前会话（已绑定）」是 binding 生效态的关键字样；没它说明还在降级分支
      if (!text.includes('当前会话')) throw new Error('状态带里没有「当前会话」：' + text.slice(0, 40))
      if (!text.includes('已绑定')) throw new Error('状态带里没有「已绑定」（bindings.current 没被认出来）：' + text.slice(0, 60))
      const preset = document.querySelector('.awu-sigilMeta')
      if (preset === null) throw new Error('状态带缺元信息行（.awu-sigilMeta）')
      return 'ok'
    })()` }], note: '会话已绑定 · 状态带「当前会话（已绑定）」+ 预设摘要 + 纪律档位' },
  // ---- 加载态 / 报错态（`?slow=` / `?fail=` 沙盒开关，见 tools/preview/preview.tsx 文件头）
  // 注 1：这两类界面以前从没被截过——沙盒没有 /presets、/preview 路由，面板永远走
  //       「宿主接口还没做」的黄色提示。
  // 注 2：slow 用 30000 而不是 1200/2500/6000。从导航到截图的耗时**不稳定**
  //       （实测 2.6s ~ 10s：目标创建、重试、每一步 700ms 都在里面），任何"够用就好"的
  //       延迟都会偶尔截到"刚加载完"的图（已经撞到两次）。所以直接把延迟拉到远大于
  //       场景时长，保证截图一定落在加载态里 —— 这张图要证明的就是"加载时长什么样"。
  { name: 'preset-loading', url: '/?slow=30000', w: 1200, h: 820, steps: [S.open(), S.click('点工具栏预设', '.awu-toolbarActions .awu-btn', '预设')], note: '加载态 · 预设列表骨架（?slow=30000）' },
  { name: 'preset-error', url: '/?fail=presets', w: 1200, h: 820, steps: [S.open(), S.click('点工具栏预设', '.awu-toolbarActions .awu-btn', '预设'), { what: '断言 ErrorBar', expr: `(async () => {
      ${settle(400)}
      const err = document.querySelector('.awu-dialog .awu-err')
      if (err === null) throw new Error('预设弹层里没有 .awu-err（报错态没渲染出来）')
      return 'ok'
    })()` }], note: '报错态 · 预设列表 ErrorBar（?fail=presets）' },
  { name: 'preview-loading', url: '/?slow=30000', w: 1200, h: 820, steps: [S.open(), S.click('点工具栏预览', '.awu-toolbarActions .awu-btn', '预览')], note: '加载态 · 注入预览 Skeleton（?slow=30000）' },
  { name: 'preview-error', url: '/?fail=preview', w: 1200, h: 820, steps: [S.open(), S.click('点工具栏预览', '.awu-toolbarActions .awu-btn', '预览'), { what: '断言 ErrorBar', expr: `(async () => {
      ${settle(400)}
      const err = document.querySelector('.awu-dialog .awu-err')
      if (err === null) throw new Error('预览弹层里没有 .awu-err（报错态没渲染出来）')
      return 'ok'
    })()` }], note: '报错态 · 注入预览 ErrorBar（?fail=preview）' },
  // ---- 深色 · 同上
  { name: 'dark-roster', url: '/?live=1#dark', w: 1440, h: 900, steps: [S.open(), S.tab('角色簿'), S.card()], note: '深色 · 角色簿 + 详情' },
  { name: 'dark-diary', url: '/?live=1#dark', w: 1440, h: 900, steps: [S.open(), S.tab('日记')], note: '深色 · 日记' },
  { name: 'dark-guide', url: '/#dark', w: 1440, h: 900, steps: [S.open(), S.tab('指南')], note: '深色 · 指南' },
  { name: 'dark-dialog', url: '/?live=1#dark', w: 1440, h: 900, steps: [S.open(), S.button('自创角色卡')], note: '深色 · 弹层' },
  // ---- 窄窗（响应式 / 单栏导航栈）
  { name: 'w1024-roster', url: '/?live=1', w: 1024, h: 768, steps: [S.open(), S.tab('角色簿'), S.card()], note: '1024 · 两栏挤压' },
  { name: 'w900-roster', url: '/?live=1', w: 900, h: 760, steps: [S.open(), S.tab('角色簿'), S.card()], note: '900 · 断点边界' },
  { name: 'w820-list', url: '/?live=1', w: 820, h: 700, steps: [S.open(), S.tab('角色簿')], note: '820 · 单栏列表页' },
  { name: 'w820-detail', url: '/?live=1', w: 820, h: 700, steps: [S.open(), S.tab('角色簿'), S.card()], note: '820 · 单栏详情页（push 后）' },
  { name: 'w560-list', url: '/?live=1', w: 560, h: 700, steps: [S.open(), S.tab('角色簿')], note: '560 · 最窄档' },
]

// ---------------------------------------------------------------- 启动前自检

const failures = []
const fail = (scene, code, detail) => {
  failures.push({ scene, code, detail })
  console.error(`  ✗ ${scene} [${code}] ${detail}`)
}

/** `--only` 语义：末尾带 `*` 是前缀匹配，否则**精确匹配**（不再是 includes）。 */
const matches = (name) => {
  if (only === '') return true
  if (only.endsWith('*')) return name.startsWith(only.slice(0, -1))
  return name === only || only.split(',').map((s) => s.trim()).includes(name)
}
const scenes = SCENES.filter((s) => matches(s.name))
if (scenes.length === 0) {
  console.error(`没有匹配 "${only}" 的场景。`)
  console.error('  --only 语义：精确名（light-roster）或前缀（light-roster 请写 light-*）；多个名字用逗号。')
  console.error(`  可用场景：${SCENES.map((s) => s.name).join(', ')}`)
  await die(1)
}

const CHROME = await findChrome()
if (CHROME === undefined) {
  console.error('找不到 chromium：装 Playwright 浏览器（npx playwright install chromium）或系统 Chrome/Edge')
  await die(1)
}

/**
 * 端口身份校验（P2.11）：59621 上跑的可能**不是本仓库的沙盒**（实测别的进程也能占着它，
 * 而且照样返回 200）。所以先认领：`/index.html` 里必须有本仓库的标题标记。
 */
const identity = await checkSandbox(base)
if (!identity.ok) {
  console.error(`沙盒校验失败（${base}）：${identity.reason}`)
  console.error('  这个端口上不是本仓库的预览沙盒 —— 换 --port=59622 或先起 node tools/preview/serve.mjs')
  await die(1)
}
/** 打包健康度（F2）：编译失败时 serve.mjs 会回 200 的"红字错误页"，必须同时看体积与文案。 */
const bundle = await checkBundle(base)
if (!bundle.ok) {
  console.error(`/bundle.js 不健康：${bundle.reason}`)
  await die(1)
}
console.log(`沙盒 ${base} 已认领（bundle ${(bundle.bytes / 1024).toFixed(0)} KB）· 场景 ${scenes.length}/${SCENES.length}`)

await mkdir(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = await mkdtemp(join(tmpdir(), 'qa-shots-'))
const debugPort = 9000 + Math.floor(Math.random() * 900)
child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--force-color-profile=srgb',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

/** 页面内算 16×16 灰度栅格（用来比"有没有变化"），只依赖 canvas，不引图像库。 */
const GRID_HELPER = `(() => {
  if (window.__awuGrid) return 'already'
  window.__awuGrid = async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob()
    const bmp = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(16, 16)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0, 16, 16)
    const data = ctx.getImageData(0, 0, 16, 16).data
    const out = []
    for (let i = 0; i < data.length; i += 4) out.push((data[i] + data[i + 1] + data[i + 2]) / 3)
    return out
  }
  return 'installed'
})()`

const gridDiff = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 1
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / a.length / 255
}

const rows = []
try {
  const browserWs = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
    return res.ok ? (await res.json()).webSocketDebuggerUrl : undefined
  })
  const ws = new WebSocket(browserWs)
  wsRef = ws
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
    const before = failures.length
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
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid)
      return r.result ?? {}
    }

    // ---- F1 导航
    {
      const url = `${base}${scene.url}`
      let nav = await send('Page.navigate', { url }, sid)
      for (let attempt = 0; attempt < 3 && (nav.error !== undefined || nav.result?.errorText); attempt += 1) {
        await sleep(250)
        nav = await send('Page.navigate', { url }, sid)
      }
      await sleep(1200)
      const evaled = await evaluate(`JSON.stringify({ href: location.href, title: document.title })`)
      const info = typeof evaled.result?.value === 'string' ? JSON.parse(evaled.result.value) : {}
      if (typeof info.href !== 'string' || !info.href.startsWith(`${base}/`)) {
        fail(scene.name, 'F1', `导航没落到 ${base}（停在 ${String(info.href)}）`)
      } else if (!String(info.title).includes('面板预览沙盒')) {
        fail(scene.name, 'F1', `页面标题不是本沙盒（${String(info.title)}）—— 端口上可能是别的服务`)
      }
    }

    // ---- F5 基线（同 URL、同尺寸、什么都不点）
    let baselineGrid = null
    if (scene.steps.length > 0) {
      await evaluate(GRID_HELPER)
      const baselineShot = await send('Page.captureScreenshot', { format: 'png' }, sid)
      const grid = await evaluate(`window.__awuGrid(${JSON.stringify(baselineShot.result.data)})`)
      baselineGrid = grid.result?.value ?? null
      if (baselineGrid === null) fail(scene.name, 'F5', '基线栅格算不出来（canvas 解码失败）')
    }

    // ---- F3 步骤
    for (const step of scene.steps) {
      const r = await evaluate(step.expr)
      if (r.exceptionDetails !== undefined) {
        const detail = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'unknown'
        fail(scene.name, 'F3', `步骤「${step.what}」失败：${String(detail).split('\n')[0].slice(0, 160)}`)
        break   // 一步失败后面就不可信了，别再往下点
      }
      await sleep(step.waitMs ?? 650)
    }
    await sleep(400)

    // ---- F4/F5 截图
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid)
    const buf = Buffer.from(shot.result.data, 'base64')
    const file = join(outDir, `${scene.name}${mediaSuffix}.png`)
    await writeFile(file, buf)

    if (buf.length < MIN_SHOT_BYTES) {
      fail(scene.name, 'F4', `截图只有 ${(buf.length / 1024).toFixed(1)} KB（< ${MIN_SHOT_BYTES / 1024} KB，多半是空白页）`)
    }
    if (baselineGrid !== null) {
      const grid = await evaluate(`window.__awuGrid(${JSON.stringify(shot.result.data)})`)
      const after = grid.result?.value ?? null
      const diff = gridDiff(baselineGrid, after)
      if (diff < MIN_GRID_DIFF) {
        fail(scene.name, 'F5', `截图与"未操作基线"几乎一致（栅格差 ${(diff * 100).toFixed(2)}% < ${(MIN_GRID_DIFF * 100).toFixed(1)}%）：步骤等于没生效`)
      }
    }

    const sceneFailures = failures.length - before
    const size = (await readdir(outDir)).length
    const mark = sceneFailures === 0 ? '✓' : '✗'
    console.log(`${mark} ${scene.name}  ${scene.w}×${scene.h}  ${scene.note}  (${size} 张，${(buf.length / 1024).toFixed(0)} KB，+${Date.now() - sceneStartedAt}ms)`)
    rows.push({ ...scene, file, failures: sceneFailures, bytes: buf.length })
    await send('Target.closeTarget', { targetId: target.targetId })
  }
} finally {
  try { wsRef?.close?.() } catch {}
  try { child?.kill?.() } catch {}
}

// ---------------------------------------------------------------- 索引 + 退出码

const passed = rows.filter((r) => r.failures === 0).length
const failed = rows.length - passed
const md = [
  '# 截图矩阵（本目录）',
  '',
  `> 生成：${new Date().toISOString()} · 沙盒 ${base}/ · 场景 ${rows.length}/${SCENES.length}`,
  `> 命令：\`node tools/qa/shots.mjs${only === '' ? '' : ` --only=${only}`}${mediaArg === '' ? '' : ` --media=${mediaArg}`}\``,
  MEDIA_FEATURES.length === 0 ? '' : `> 降级态：${MEDIA_FEATURES.map((f) => `${f.name}=${f.value}`).join(', ')}`,
  '',
  `**结果：通过 ${passed} 个场景，失败 ${failed} 个。**`,
  '',
  '> 判定口径（脚本会真的红，不是"跑完就算过"）：F1 导航没落到沙盒 / F2 bundle 不健康 /',
  '> F3 步骤点到不存在的元素 / F4 截图 < 40 KB / F5 截图与"同 URL 未操作基线"像素栅格差 < 1.5%。',
  '> 退出码即结论：**0 = 全部通过；非 0 = 有场景失败**，失败清单在脚本输出末尾。',
  '',
  '| 图 | 尺寸 | 体积 | 结果 | 看什么 |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name}${mediaSuffix}.png | ${r.w}×${r.h} | ${(r.bytes / 1024).toFixed(0)} KB | ${r.failures === 0 ? '✅ 通过' : `❌ ${r.failures} 项失败`} | ${r.note} |`),
  '',
  '## 降级态怎么跑',
  '',
  '```',
  'node tools/qa/shots.mjs --media=reduce-motion        --out=<工作区>/06-tmp/ui-audit/matrix-rm',
  'node tools/qa/shots.mjs --media=reduce-transparency  --out=<工作区>/06-tmp/ui-audit/matrix-rt',
  'node tools/qa/shots.mjs --media=contrast-more        --out=<工作区>/06-tmp/ui-audit/matrix-hc',
  '```',
  '',
  '## `--only` 怎么匹配',
  '',
  '- `--only=light-roster` —— **精确**匹配这一个场景（不会连带 `light-roster-empty`）；',
  '- `--only=light-*` —— 前缀匹配（`*` 结尾才算前缀）；',
  '- `--only=dark-roster,dark-diary` —— 逗号分隔精确名单。',
].join('\n')
await writeFile(join(outDir, 'index.md'), md)

if (failures.length > 0) {
  console.error('')
  console.error(`截图矩阵未通过：通过 ${passed} 个场景，失败 ${failed} 个（共 ${failures.length} 项断言失败）。`)
  for (const f of failures) console.error(`  - ${f.scene} [${f.code}] ${f.detail}`)
  console.error(`\n产物（仍是可看的，但别当证据）：${outDir}`)
  await die(1)
}
console.log('')
console.log(`截图矩阵通过：通过 ${passed} 个场景，失败 0 个。`)
console.log(`索引：${join(outDir, 'index.md')}`)

// ---------------------------------------------------------------- 工具函数

/** 认领端口：必须能拿到本仓库沙盒的页面（标题标记）。 */
async function checkSandbox(root) {
  try {
    const res = await fetch(`${root}/index.html`)
    if (!res.ok) return { ok: false, reason: `GET /index.html → HTTP ${res.status}` }
    const html = await res.text()
    if (!html.includes('面板预览沙盒')) {
      return { ok: false, reason: 'index.html 里没有本仓库的标题标记「面板预览沙盒」' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: `连不上：${error instanceof Error ? error.message : String(error)}（先起 node tools/preview/serve.mjs）` }
  }
}

/** 打包健康度：serve.mjs 编译失败时回 200 + 一段写红字的 JS，所以要同时看体积与文案。 */
async function checkBundle(root) {
  try {
    const res = await fetch(`${root}/bundle.js`)
    const code = await res.text()
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    if (code.includes('预览打包失败')) {
      const m = code.match(/预览打包失败[^<]*/)
      return { ok: false, reason: `打包失败页：${String(m?.[0] ?? '').slice(0, 200)}` }
    }
    if (code.length < 200000) return { ok: false, reason: `bundle 只有 ${code.length} 字节（异常小）` }
    return { ok: true, bytes: code.length }
  } catch (error) {
    return { ok: false, reason: `连不上：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 依次尝试常见安装位置（Windows / macOS / Linux）。 */
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
    // Windows
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
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
