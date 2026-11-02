/**
 * 崩溃探针验收：`PanelBoundary`（P0 的 ErrorBoundary）到底有没有兜住。
 *
 *   node tools/qa/crash.mjs [--port=59621] [--out=06-tmp/ui-audit]
 *
 * 为什么需要它：`PanelBoundary` 上线时只验了「正常路径无回归」——降级路径从来没跑过。
 * 一个没被跑过的 fallback 等于没有 fallback：真崩的时候它自己也可能抛（比如降级 UI 里
 * 又去调那个已经坏掉的 `t`），用户看到的就是白屏。
 *
 * 探针怎么造崩溃：沙盒的 `?crash=1` 只对 `.awu-layer`（面板自己的宿主节点）把
 * `getBoundingClientRect` 改成抛错，抛点在 `useWideLayout` 的 effect 里（见
 * `tools/preview/preview.tsx` 的 installCrashProbe 注释：这条是第 3 次尝试，
 * 前两次「让 t 抛错」与「让 t 返回非字符串」都被 `makeTranslator` 的 try/catch +
 * 中文回落**完全吸收**，崩不了）。React 会把 effect 里抛出的错误路由给最近的错误边界。
 *
 * 断言（4 条）：
 *   1. 降级 UI 出现：能找到一个按钮，文案是「重试」；
 *   2. 面板没渲染：页面里没有 `.awu-trigger`（说明子树确实被卸掉了，不是"半崩"）；
 *   3. 无白屏：`document.body` 有可见内容且高度 > 0；
 *   4. 无未捕获异常：`Runtime.exceptionThrown` 一条都没有（错误被边界接住 = 只有
 *      `componentDidCatch` 打的 console.error，没有 window 级冒泡）。
 * 然后再点一次「重试」：应当**再次**降级（t 一直抛，这是预期），仍然无白屏、无未捕获异常。
 */
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { launch, reporter } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? dflt : hit.slice(name.length + 3)
}
const port = Number(arg('port', '59621'))
const outDir = arg('out', join(here, '../../06-tmp/ui-audit'))

const url = `http://127.0.0.1:${port}/?crash=1`
const r = reporter()
console.log(`崩溃探针：${url}\n`)

const browser = await launch()
try {
  const page = await browser.newPage({ width: 1200, height: 760 })
  await page.goto(url, 1800)

  const probe = await page.eval(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const retry = buttons.find(b => (b.textContent || '').trim() === '重试')
    const body = document.body
    return JSON.stringify({
      marker: document.documentElement.dataset.awuCrashProbe || '',
      retryFound: retry !== undefined,
      retryAria: retry ? (retry.getAttribute('aria-label') || '') : '',
      panelMounted: !!document.querySelector('.awu-trigger'),
      layerFound: !!document.querySelector('.awu-layer'),
      bodyText: (body.innerText || '').trim().slice(0, 80),
      bodyHeight: body.getBoundingClientRect().height,
      buttonCount: buttons.length,
    })
  })()`)
  const first = probe.ok ? JSON.parse(probe.value) : {}
  r.check(probe.ok, '探针页面可求值', probe.ok ? '' : String(probe.error))
  r.check(first.marker === '1', '沙盒进入崩溃场景（html[data-awu-crash-probe]）', `marker=${first.marker}`)
  r.check(first.retryFound === true, '降级 UI 出现且有「重试」按钮', `bodyText="${first.bodyText}"`)
  r.check(first.panelMounted === false, '面板子树已被卸载（没有 .awu-trigger）', `layerFound=${first.layerFound}`)
  r.check(typeof first.bodyHeight === 'number' && first.bodyHeight > 100, '无白屏：body 有实际高度', `${Math.round(first.bodyHeight)}px`)
  r.check(page.exceptions.length === 0, '无未捕获异常（被边界接住）', page.exceptions.length === 0 ? '' : page.exceptions[0].slice(0, 120))
  const boundaryLogged = page.consoleErrors.some((t) => t.includes('面板渲染失败'))
  r.check(boundaryLogged, 'componentDidCatch 留下了上下文日志', boundaryLogged ? '' : '没抓到 "面板渲染失败" 的 console.error')

  await page.screenshot(join(outDir, 'crash-1-fallback.png'))

  // 点「重试」：t 仍然抛 → 应当再次降级（不是白屏、也不是卡死）
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '重试')
    b?.click()
  })()`)
  await page.sleep(600)
  const again = await page.eval(`(() => {
    const retry = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '重试')
    return JSON.stringify({
      retryFound: retry !== undefined,
      panelMounted: !!document.querySelector('.awu-trigger'),
      bodyHeight: document.body.getBoundingClientRect().height,
    })
  })()`)
  const second = again.ok ? JSON.parse(again.value) : {}
  r.check(second.retryFound === true, '点重试后仍显示降级 UI（环境仍然坏着，预期再崩）', '')
  r.check(second.panelMounted === false, '点重试后没有白屏/半挂', `bodyHeight=${Math.round(second.bodyHeight ?? 0)}`)
  r.check(page.exceptions.length === 0, '点重试后依然无未捕获异常', page.exceptions.length === 0 ? '' : page.exceptions[0].slice(0, 120))

  await page.screenshot(join(outDir, 'crash-2-after-retry.png'))
  console.log(`\n截图：${join(outDir, 'crash-1-fallback.png')}`)
  console.log(`      ${join(outDir, 'crash-2-after-retry.png')}`)
} finally {
  await browser.close()
}

r.finish('崩溃探针验收')
