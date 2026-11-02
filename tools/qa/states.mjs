/**
 * 加载态 / 报错态的实机采样（`?slow=` / `?fail=` 两个沙盒开关）。
 *
 *   node tools/qa/states.mjs [--port=59621] [--out=06-tmp/ui-audit]
 *
 * 为什么需要它：这两类界面以前**从来没被跑过** —— 沙盒里没有 `/presets`、`/preview`
 * 路由，面板永远走「宿主接口还没做」的黄色提示分支，于是：
 *   · Skeleton / 加载提示（`?slow=`）没人见过；
 *   · ErrorBar（`?fail=`，红色错误条 + 重试）没人见过。
 * 一个没被跑过的降级 UI 和一个没写的降级 UI 在验收上是等价的（都是"不知道长什么样"）。
 *
 * 断言覆盖：
 *   ① 慢响应期间能看到骨架/加载提示，且**不是**空列表；
 *   ② 慢响应结束后列表真的出来了，且「重体积」标记（chars 24856 > 8000）在位；
 *   ③ `?fail=presets` 出 ErrorBar（role=alert），且没有列表行；
 *   ④ 慢响应期间预览弹层出 Skeleton；
 *   ⑤ `?fail=preview` 预览弹层出 ErrorBar；
 *   ⑥ 正常 fixture：预览 6 段 + 三段概要（总字符 / L1 / 纪律包）。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertSandbox, launch, reporter } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const port = Number(arg('port', '59621'))
const outDir = arg('out', join(here, '../../06-tmp/ui-audit'))
const base = `http://127.0.0.1:${port}`

const OPEN = `(() => { const b = document.querySelector('.awu-trigger'); if (b === null) return 'no-trigger'; b.click(); return 'ok' })()`
const clickText = (text, selector = 'button') => `(() => {
  const hit = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => (e.textContent || '').includes(${JSON.stringify(text)}))
  if (hit === undefined) return 'not-found'
  hit.click()
  return 'ok'
})()`

// 端口认领（P2.11）：59621 上可能是别人的服务，认不出本沙盒就直接退出，
// 否则探针会对着别人的页面做断言 —— 全绿但毫无意义。
const identity = await assertSandbox(port)
if (!identity.ok) {
  console.error(`沙盒校验失败（http://127.0.0.1:${port}）：${identity.reason}`)
  process.exit(1)
}

const browser = await launch()
const r = reporter()

try {
  // ---------------------------------------------------------------- ① 预设：慢响应
  {
    const page = await browser.newPage({ width: 1200, height: 820 })
    await page.goto(`${base}/?slow=2500`, 1600)
    await page.eval(OPEN)
    await page.sleep(500)
    await page.eval(clickText('预设', '.awu-toolbarActions .awu-btn'))
    await page.sleep(400)
    const during = await page.eval(`(() => JSON.stringify({
      skeleton: document.querySelectorAll('.awu-dialog .awu-sk').length,
      status: [...document.querySelectorAll('.awu-dialog [role="status"]')].map(e => (e.textContent || '').trim().slice(0, 20)),
      rows: document.querySelectorAll('.awu-presetRow').length,
      err: document.querySelectorAll('.awu-err').length,
    }))()`)
    const inLoad = during.ok ? JSON.parse(during.value) : {}
    console.log(`① 预设慢响应中：skeleton=${inLoad.skeleton} status=${JSON.stringify(inLoad.status)} rows=${inLoad.rows} err=${inLoad.err}`)
    r.check((inLoad.skeleton ?? 0) >= 1 || (inLoad.status ?? []).length > 0, '① 慢响应期间显示骨架/加载提示', `skeleton=${inLoad.skeleton} status=${JSON.stringify(inLoad.status)}`)
    r.check(inLoad.rows === 0, '① 慢响应期间还没有列表行（不是"空列表"假象）', `rows=${inLoad.rows}`)
    await page.screenshot(join(outDir, 'state-1-preset-loading.png'))

    // 等慢响应落地：列表出现 + 重体积标记
    await page.sleep(2600)
    const after = await page.eval(`(() => JSON.stringify({
      rows: document.querySelectorAll('.awu-presetRow').length,
      heavy: document.querySelectorAll('.awu-presetHeavy').length,
      chars: [...document.querySelectorAll('.awu-presetChars')].map(e => (e.textContent || '').trim()).slice(0, 3),
      status: document.querySelectorAll('[role="status"]').length,
    }))()`)
    const loaded = after.ok ? JSON.parse(after.value) : {}
    console.log(`   慢响应结束：${after.ok ? after.value : after.error}`)
    r.check(loaded.rows === 3, '② 预设列表出来了（3 条）', `rows=${loaded.rows}`)
    r.check(loaded.heavy === 1, '② 重体积标记在位（chars 24856 > 8000）', `heavy=${loaded.heavy}`)
    await page.screenshot(join(outDir, 'state-2-preset-list.png'))
  }

  // ---------------------------------------------------------------- ③ 预设：宿主 400
  //
  // 断言的是**宿主真的会返回的形状**：`src/web.ts:191-198` 的 guard 把任何异常统一下成
  // `400 + {ok:false,error:<原文>}`，没有 500 路径。沙盒也照这个形状注入（见
  // tools/preview/preview.tsx 的 `failed`），否则就是在验证"沙盒自己捏的东西"——
  // 那种断言等于 fixture 自证。
  {
    const page = await browser.newPage({ width: 1200, height: 820 })
    await page.goto(`${base}/?fail=presets`, 1600)
    await page.eval(OPEN)
    await page.sleep(500)
    await page.eval(clickText('预设', '.awu-toolbarActions .awu-btn'))
    await page.sleep(1000)
    const res = await page.eval(`(() => {
      const err = document.querySelector('.awu-err')
      return JSON.stringify({
        errFound: err !== null,
        errText: err === null ? '' : (err.textContent || '').trim().slice(0, 120),
        role: err === null ? '' : (err.getAttribute('role') || ''),
        rows: document.querySelectorAll('.awu-presetRow').length,
      })
    })()`)
    const fail = res.ok ? JSON.parse(res.value) : {}
    console.log(`③ ?fail=presets：${res.ok ? res.value : res.error}`)
    r.check(fail.errFound === true, '③ 预设列表错误时出 ErrorBar', fail.errText ?? '')
    r.check(fail.role === 'alert', '③ ErrorBar 带 role=alert（读屏能播报）', `role=${fail.role}`)
    // 关键：UI 显示的是宿主信封里的 error 原文（不是 client 自己拼的通用文案）
    r.check(
      String(fail.errText).includes('沙盒注入 400'),
      '③ UI 显示的是宿主信封里的 error 原文（400 形状）',
      fail.errText ?? '',
    )
    r.check(!String(fail.errText).includes('500'), '③ 不再出现世界上不存在的 500 文案', fail.errText ?? '')
    r.check(fail.rows === 0, '③ 出错时没有列表行', `rows=${fail.rows}`)
    await page.screenshot(join(outDir, 'state-3-preset-error.png'))
  }

  // ---------------------------------------------------------------- ③b 面板 ErrorBar 的「重试」是真的能点
  //
  // 预设/预览弹层里的错误条是各自手写的 div（没有重试按钮），带「重试」的那条是面板级
  // `ErrorBar`（parts.tsx）。用 `?fail=characters` 触发它 —— **不能**用 `?fail=overview`：
  // `reload()` 对 overview 是 `.catch(() => undefined)` 故意咽掉的，面板不会因此报错。
  // 并且**验证点下去真的重新发请求** —— 只断言"按钮存在"等于没验（死按钮也能过）。
  {
    const page = await browser.newPage({ width: 1200, height: 820 })
    await page.goto(`${base}/?fail=characters`, 1600)
    // 包一层 fetch 计数器（在页面里），用来证明重试真的重发了请求
    await page.eval(`(() => {
      if (window.__awuReq) return 'already'
      window.__awuReq = []
      const orig = window.fetch
      window.fetch = (input, init) => { window.__awuReq.push(String(input)); return orig(input, init) }
      return 'installed'
    })()`)
    await page.eval(OPEN)
    await page.sleep(1200)
    const before = await page.eval(`(() => {
      const err = document.querySelector('.awu-status.awu-err')
      const btn = err === null ? null : [...err.querySelectorAll('button')].find(b => !b.disabled)
      return JSON.stringify({
        errFound: err !== null,
        errText: err === null ? '' : (err.textContent || '').trim().slice(0, 80),
        role: err === null ? '' : (err.getAttribute('role') || ''),
        retry: btn === undefined || btn === null ? null : (btn.textContent || '').trim(),
        retryDisabled: btn === null ? null : btn.disabled === true,
        reqs: (window.__awuReq || []).length,
      })
    })()`)
    const panelErr = before.ok ? JSON.parse(before.value) : {}
    console.log(`③b ?fail=characters：${before.ok ? before.value : before.error}`)
    r.check(panelErr.errFound === true, '③b 面板级 ErrorBar 出现', panelErr.errText ?? '')
    r.check(panelErr.role === 'alert', '③b 面板级 ErrorBar 带 role=alert', `role=${panelErr.role}`)
    r.check(panelErr.retry !== null && panelErr.retry !== '', '③b 有「重试」按钮', `retry=${JSON.stringify(panelErr.retry)}`)
    r.check(panelErr.retryDisabled === false, '③b 「重试」按钮可点（未 disabled）', `disabled=${panelErr.retryDisabled}`)
    await page.eval(`(() => {
      const err = document.querySelector('.awu-status.awu-err')
      const btn = err === null ? null : [...err.querySelectorAll('button')].find(b => !b.disabled)
      btn?.click()
      return btn === null ? 'no-btn' : 'clicked'
    })()`)
    await page.sleep(900)
    const after = await page.eval(`(() => JSON.stringify({
      reqs: (window.__awuReq || []).length,
      overviewHits: (window.__awuReq || []).filter(u => u.includes('/characters')).length,
      stillErr: document.querySelector('.awu-status.awu-err') !== null,
    }))()`)
    const afterClick = after.ok ? JSON.parse(after.value) : {}
    console.log(`   点重试后：${after.ok ? after.value : after.error}`)
    r.check(
      (afterClick.reqs ?? 0) > (panelErr.reqs ?? 0),
      '③b 点「重试」真的重新发了请求（不是死按钮）',
      `reqs ${panelErr.reqs} → ${afterClick.reqs}`,
    )
    r.check((afterClick.overviewHits ?? 0) >= 2, '③b 重试打的是 /characters', `hits=${afterClick.overviewHits}`)
    r.check(afterClick.stillErr === true, '③b 仍然失败时错误条还在（没被清空骗人）', `stillErr=${afterClick.stillErr}`)
    await page.screenshot(join(outDir, 'state-3b-panel-retry.png'))
  }

  // ---------------------------------------------------------------- ④ 预览：慢响应（Skeleton）
  {
    const page = await browser.newPage({ width: 1200, height: 820 })
    await page.goto(`${base}/?slow=2500`, 1600)
    await page.eval(OPEN)
    await page.sleep(500)
    await page.eval(clickText('预览', '.awu-toolbarActions .awu-btn'))
    await page.sleep(400)
    const during = await page.eval(`(() => JSON.stringify({
      skeleton: document.querySelectorAll('.awu-sk').length,
      segs: document.querySelectorAll('.awu-previewSeg').length,
    }))()`)
    const inLoad = during.ok ? JSON.parse(during.value) : {}
    console.log(`④ 预览慢响应中：${during.ok ? during.value : during.error}`)
    r.check(inLoad.skeleton >= 1, '④ 慢响应期间出 Skeleton', `skeleton=${inLoad.skeleton}`)
    r.check(inLoad.segs === 0, '④ 慢响应期间还没有分段', `segs=${inLoad.segs}`)
    await page.screenshot(join(outDir, 'state-4-preview-loading.png'))

    await page.sleep(2600)
    const after = await page.eval(`(() => JSON.stringify({
      segs: document.querySelectorAll('.awu-previewSeg').length,
      stats: [...document.querySelectorAll('.awu-previewStatVal')].map(e => (e.textContent || '').trim()),
    }))()`)
    const loaded = after.ok ? JSON.parse(after.value) : {}
    console.log(`   预览加载完成：${after.ok ? after.value : after.error}`)
    r.check(loaded.segs === 6, '⑥ 预览 6 段（fixture 六段注入快照）', `segs=${loaded.segs}`)
    r.check((loaded.stats ?? []).length >= 3, '⑥ 三段概要在位（总字符 / L1 / 纪律包）', JSON.stringify(loaded.stats))
    await page.screenshot(join(outDir, 'state-5-preview-loaded.png'))
  }

  // ---------------------------------------------------------------- ⑤ 预览：500
  {
    const page = await browser.newPage({ width: 1200, height: 820 })
    await page.goto(`${base}/?fail=preview`, 1600)
    await page.eval(OPEN)
    await page.sleep(500)
    await page.eval(clickText('预览', '.awu-toolbarActions .awu-btn'))
    await page.sleep(1000)
    const res = await page.eval(`(() => {
      const err = document.querySelector('.awu-err')
      return JSON.stringify({
        errFound: err !== null,
        errText: err === null ? '' : (err.textContent || '').trim().slice(0, 80),
        role: err === null ? '' : (err.getAttribute('role') || ''),
        segs: document.querySelectorAll('.awu-previewSeg').length,
      })
    })()`)
    const fail = res.ok ? JSON.parse(res.value) : {}
    console.log(`⑤ ?fail=preview：${res.ok ? res.value : res.error}`)
    r.check(fail.errFound === true, '⑤ 注入预览错误时出 ErrorBar', fail.errText ?? '')
    r.check(fail.role === 'alert', '⑤ ErrorBar 带 role=alert', `role=${fail.role}`)
    r.check(fail.segs === 0, '⑤ 出错时没有分段', `segs=${fail.segs}`)
    await page.screenshot(join(outDir, 'state-6-preview-error.png'))
  }

  console.log(`\n截图：${join(outDir, 'state-1-preset-loading.png')} 等 6 张（state-1…state-6）`)
} finally {
  await browser.close()
}

r.finish('加载态/报错态采样')
