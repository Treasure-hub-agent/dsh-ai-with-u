/**
 * QA 脚本共用的最小 CDP 驱动（开发用，不进 lib、不随插件发布）。
 *
 * 为什么不 import playwright：本机不一定装；而且这套脚本只用到「导航 / 求值 / 截图 /
 * 收控制台与未捕获异常」四件事，几十行 CDP 就够，不引依赖更稳。
 * （`tools/qa/shots.mjs` 是独立自洽的老脚本，暂时没改成用它——改它属于无收益的扰动。）
 *
 * 用法：
 *   import { launch, findChrome } from './cdp.mjs'
 *   const browser = await launch()
 *   const page = await browser.newPage({ width: 1440, height: 900 })
 *   await page.goto('http://127.0.0.1:59621/?crash=1')
 *   const ready = await page.eval('!!document.querySelector(".awu-trigger")')
 *   await page.screenshot('06-tmp/ui-audit/xx.png')
 *   console.log(page.consoleErrors, page.exceptions)
 *   await browser.close()
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 依次尝试 Playwright 的 chromium 与常见系统浏览器。 */
export async function findChrome() {
  const exists = async (p) => { try { return (await stat(p)).isFile() } catch { return false } }
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  try {
    const dirs = (await readdir(root)).filter((d) => d.startsWith('chromium'))
    for (const d of dirs.sort().reverse()) {
      const exe = join(root, d, 'chrome-win64', 'chrome.exe')
      if (await exists(exe)) return exe
    }
  } catch {}
  for (const f of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
    if (await exists(f)) return f
  }
  return undefined
}

async function waitFor(fn, timeout = 15000, label = '等待超时') {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v !== undefined && v !== null) return v
    } catch {}
    if (Date.now() - start > timeout) throw new Error(label)
    await sleep(100)
  }
}

/**
 * 认领端口：确认 `port` 上跑的是**本仓库的**预览沙盒。
 *
 * 为什么必须查：59621 这种固定端口上完全可能是别的进程（实测过——照样返回 200，探针
 * 于是对着别人的页面做断言，全绿但毫无意义）。标记取 `index.html` 的标题，只有本仓库的
 * `tools/preview/index.html` 才有。
 */
export async function assertSandbox(port, base = 'http://127.0.0.1') {
  try {
    const res = await fetch(`${base}:${port}/index.html`)
    if (!res.ok) return { ok: false, reason: `GET /index.html → HTTP ${res.status}` }
    const html = await res.text()
    if (!html.includes('面板预览沙盒')) {
      return { ok: false, reason: 'index.html 里没有本仓库的标题标记「面板预览沙盒」—— 这个端口上是别人的服务' }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: `连不上：${error instanceof Error ? error.message : String(error)}（先起 node tools/preview/serve.mjs）` }
  }
}

/** 起一个浏览器；失败时抛错（调用方决定退出码）。 */
export async function launch() {
  const chrome = await findChrome()
  if (chrome === undefined) throw new Error('找不到 chromium：装 Playwright 浏览器或改 cdp.mjs 里的路径')
  const profile = await mkdtemp(join(tmpdir(), 'qa-cdp-'))
  const port = 9000 + Math.floor(Math.random() * 900)
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--force-color-profile=srgb',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })

  const wsUrl = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`)
    return res.ok ? (await res.json()).webSocketDebuggerUrl : undefined
  }, 15000, '等待 chromium 调试端口超时')

  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, { resolve })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })

  return {
    async newPage({ width = 1440, height = 900, media = [] } = {}) {
      const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
      const { result: attached } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      const sid = attached.sessionId
      const consoleErrors = []
      const exceptions = []
      const consoleAll = []

      // 事件订阅：只有 page 级 session 才能收到这些
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.sessionId !== sid) return
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')
          consoleAll.push({ type: msg.params.type, text })
          if (msg.params.type === 'error') consoleErrors.push(text)
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          exceptions.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? 'unknown')
        }
      })

      await send('Page.enable', {}, sid)
      await send('Runtime.enable', {}, sid)
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid)
      if (media.length > 0) await send('Emulation.setEmulatedMedia', { features: media }, sid)

      const page = {
        sid, consoleErrors, exceptions, consoleAll,
        async goto(url, waitMs = 1400) {
          // 目标刚创建时直接 Page.navigate 偶发 `net::ERR_ABORTED`（about:blank 还在加载就被
          // 打断），表现是"页面停在 about:blank 什么也没有"。重试一次即可，别让探针假失败。
          let res = await send('Page.navigate', { url }, sid)
          for (let attempt = 0; attempt < 3 && res.error !== undefined; attempt += 1) {
            await sleep(250)
            res = await send('Page.navigate', { url }, sid)
          }
          if (res.result?.errorText !== undefined && res.result.errorText !== '') {
            await sleep(300)
            res = await send('Page.navigate', { url }, sid)
          }
          // 导航失败（URL 打错 / 服务没起）时 CDP 只回 error，不会抛异常 —— 记下来
          // 让调用方（或调试时）能看见，否则表现就是"页面停在 about:blank 什么也没有"
          page.lastNavigate = res.error ?? res.result ?? null
          await sleep(waitMs)
          page.href = (await page.eval('location.href')).value
          return page.lastNavigate
        },
        /** 求值：异常不抛出，返回 `{ ok, value }`，让断言自己决定怎么报。 */
        async eval(expression) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid)
          const details = r.result?.exceptionDetails
          if (details !== undefined) {
            return { ok: false, error: details.exception?.description ?? details.text ?? 'eval error' }
          }
          return { ok: true, value: r.result?.result?.value }
        },
        async screenshot(file) {
          // 输出目录可能是"还没建的 06-tmp/ui-audit"：先建再写，别让探针因为 ENOENT 半途而死
          await mkdir(dirname(file), { recursive: true })
          const shot = await send('Page.captureScreenshot', { format: 'png' }, sid)
          await writeFile(file, Buffer.from(shot.result.data, 'base64'))
          return file
        },
        sleep,
      }
      return page
    },
    async close() {
      try { ws.close() } catch {}
      try { child.kill() } catch {}
    },
  }
}

/** 断言小工具：返回 true/false 并累积失败清单，脚本最后统一退出码。 */
export function reporter() {
  let pass = 0
  const failures = []
  return {
    ok(label, detail = '') {
      pass += 1
      console.log(`  ✓ ${label}${detail === '' ? '' : `：${detail}`}`)
    },
    bad(label, detail = '') {
      failures.push(`${label}${detail === '' ? '' : ` —— ${detail}`}`)
      console.log(`  ✗ ${label}${detail === '' ? '' : `：${detail}`}`)
    },
    check(cond, label, detail = '') { if (cond) this.ok(label, detail); else this.bad(label, detail) },
    get failures() { return failures },
    get pass() { return pass },
    finish(title) {
      console.log('')
      if (failures.length > 0) {
        console.log(`${title}未通过：通过 ${pass} 项，失败 ${failures.length} 项。`)
        for (const f of failures) console.log(`  - ${f}`)
        process.exit(1)
      }
      console.log(`${title}通过：通过 ${pass} 项，失败 0 项。`)
    },
  }
}
