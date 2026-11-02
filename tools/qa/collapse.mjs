/**
 * 折叠退场的实机采样：`.awu-loreBody` / `.awu-diary` / `.awu-preview*` 三处。
 *
 *   node tools/qa/collapse.mjs [--port=59621] [--out=06-tmp/ui-audit]
 *
 * 为什么需要它：动效接线的报告里有三条写着「缺 fixture 未验」——世界书行、日记按月、
 * 注入预览分段。它们的"退场 160ms"是靠 `usePresence` 延迟卸载 + CSS
 * `[data-state="closing"]` 配合的，**肉眼几乎看不出对错**：DOM 多留 160ms 你看不出来，
 * 提前卸载你也看不出来（只是动画一闪即过）。只能用 MutationObserver 记时间戳。
 *
 * 采样口径（每次只量"从点击到状态变化"的间隔，用页面内 performance.now 计时，
 * 避免 CDP 往返把时间糊掉）：
 *   · 展开：目标节点出现、且 `data-state === 'open'`（**不能残留 closing**）；
 *   · 收起：`data-state` 变成 `closing` 要落在 ≤80ms（第一帧就该挂上）；
 *           节点被移出 DOM 要落在 120–260ms（T_EXIT=160ms + 调度抖动）；
 *           并且**只允许一次** attr→closing 与一次 removed（防止"抖两下"）。
 */
import { dirname, join } from 'node:path'
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
const base = `http://127.0.0.1:${port}`

/** 页面内的记录器：只盯 `data-state` 属性与子树增删。 */
const INSTALL_RECORDER = `(() => {
  if (window.__fold) return 'already'
  const state = { events: [], t0: 0 }
  const now = () => Math.round(performance.now() - state.t0)
  const cls = (el) => (typeof el.className === 'string' ? el.className : '').slice(0, 60)
  const obs = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') {
        state.events.push({ kind: 'attr', at: now(), cls: cls(m.target), state: m.target.getAttribute('data-state') })
      } else if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n.nodeType === 1) state.events.push({ kind: 'added', at: now(), cls: cls(n), state: n.getAttribute?.('data-state') ?? null })
        for (const n of m.removedNodes) if (n.nodeType === 1) state.events.push({ kind: 'removed', at: now(), cls: cls(n), state: n.getAttribute?.('data-state') ?? null })
      }
    }
  })
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'], childList: true })
  window.__fold = state
  window.__foldReset = () => { state.events = []; state.t0 = performance.now(); return 'reset' }
  window.__foldRead = () => JSON.stringify(state.events)
  return 'installed'
})()`

/** 点一个「按 selector 选到、再按文本过滤」的按钮。 */
const clickBy = (selector, text) => `(() => {
  const list = [...document.querySelectorAll(${JSON.stringify(selector)})]
  const hit = ${text === '' ? 'list[0]' : `list.find(e => (e.textContent || '').includes(${JSON.stringify(text)}))`}
  if (hit === undefined) return 'not-found'
  hit.click()
  return 'clicked'
})()`

const sel = { lore: '.awu-loreBody', diary: '.awu-diary', preview: '.awu-previewText, .awu-previewEmpty' }

const browser = await launch()
try {
  /**
   * 一个场景：进到"目标折叠体已展开"的状态 → 重置计时 → 点收起 → 读事件。
   * `expand` / `target` 都是页面内表达式片段。
   */
  const runScene = async (name, url, { setup, expand, target, shotName }) => {
    const page = await browser.newPage({ width: 1440, height: 940 })
    await page.goto(url, 1600)
    const installed = await page.eval(INSTALL_RECORDER)
    if (!installed.ok) return { page, fail: `记录器注入失败：${installed.error}` }
    for (const step of setup) {
      const r = await page.eval(step)
      await page.sleep(650)
      if (!r.ok) return { page, fail: `准备步骤抛错：${r.error}` }
    }

    // 展开：有的折叠体默认就是开的（日记按月），别盲点两次把它"点回去"。
    // 先看现在有没有：没有才点开；已经有了就直接量"收起"。
    const present = await page.eval(`document.querySelector(${JSON.stringify(target)}) !== null`)
    let expandRes = { ok: true, value: present.ok && present.value === true ? 'already-open' : 'not-open' }
    if (present.ok && present.value !== true) {
      expandRes = await page.eval(expand)
      await page.sleep(500)
    }
    const openedState = await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(target)})
      if (el === null) return 'absent'
      return el.getAttribute('data-state') ?? 'no-attr'
    })()`)

    // 重置计时 → 收起
    await page.eval('window.__foldReset()')
    const collapseRes = await page.eval(expand)   // 同一个头按钮再点一次 = 收起
    await page.sleep(520)
    const eventsRaw = await page.eval('window.__foldRead()')
    await page.screenshot(join(outDir, shotName))

    return {
      page,
      name,
      expandRes,
      collapseRes,
      openedState: openedState.ok ? openedState.value : `eval-error:${openedState.error}`,
      events: eventsRaw.ok ? JSON.parse(eventsRaw.value) : [],
    }
  }

  const results = []

  // ---- ① 世界书行 `.awu-loreBody`（需要 ccv3 卡；编辑器里展开世界书分组）
  results.push(await runScene('世界书行 .awu-loreBody', `${base}/?live=1`, {
    setup: [
      clickBy('.awu-trigger', ''),
      clickBy('.awu-tab', '角色簿'),
      clickBy('.awu-card', ''),
      `(() => { const b = document.getElementById('awu-detail-edit'); if (b === null) return 'no-edit'; b.click(); return 'clicked' })()`,
      clickBy('.awu-editGroupHead', '世界书'),
    ],
    expand: clickBy('.awu-loreRowMain', ''),
    target: sel.lore,
    shotName: 'collapse-1-lore.png',
  }))

  // ---- ② 日记按月 `.awu-diary`
  results.push(await runScene('日记按月 .awu-diary', `${base}/?live=1`, {
    setup: [clickBy('.awu-trigger', ''), clickBy('.awu-tab', '日记')],
    expand: clickBy('.awu-reviewMonthHead', ''),
    target: sel.diary,
    shotName: 'collapse-2-diary.png',
  }))

  // ---- ③ 注入预览分段 `.awu-previewText` / `.awu-previewEmpty`
  results.push(await runScene('预览分段 .awu-preview*', `${base}/?live=1`, {
    setup: [clickBy('.awu-trigger', ''), clickBy('.awu-toolbarActions .awu-btn', '预览')],
    expand: clickBy('.awu-previewSegHead', ''),
    target: sel.preview,
    shotName: 'collapse-3-preview.png',
  }))

  // ---------------------------------------------------------------- 断言
  const r = reporter()
  console.log('')
  for (const res of results) {
    if (res.fail !== undefined) { r.bad(res.name, res.fail); continue }
    const { events, openedState } = res
    const closing = events.filter((e) => e.kind === 'attr' && e.state === 'closing')
    const removed = events.filter((e) => e.kind === 'removed' && String(e.cls).includes(targetClassOf(res)))
    const open = events.filter((e) => e.kind === 'added' && e.state === 'open')
    console.log(`—— ${res.name}`)
    console.log(`   展开后 data-state = ${openedState}；事件 ${events.length} 条：${events.slice(0, 6).map((e) => `${e.kind}@${e.at}ms${e.state === null ? '' : `(${e.state})`}`).join(' ')}`)
    r.check(openedState === 'open', `${res.name} 展开时 data-state=open（无 closing 残留）`, `实际 ${openedState}`)
    r.check(closing.length >= 1, `${res.name} 收起时挂上 closing`, closing.length === 0 ? '没有 closing 事件' : `${closing[0].at}ms`)
    if (closing.length > 0) r.check(closing[0].at <= 80, `${res.name} closing 落在 ≤80ms`, `${closing[0].at}ms`)
    r.check(closing.length <= 1, `${res.name} closing 只挂一次（无抖动）`, `${closing.length} 次`)
    r.check(removed.length === 1, `${res.name} 退场后节点被移除一次`, `${removed.length} 次`)
    if (removed.length > 0) {
      r.check(removed[0].at >= 120 && removed[0].at <= 260, `${res.name} 卸载落在 120–260ms（T_EXIT=160）`, `${removed[0].at}ms`)
    }
    if (open.length > 0) console.log(`   展开事件在 t=${open[0].at}ms 前完成（重置前，仅参考）`)
  }

  console.log(`\n截图：${['collapse-1-lore.png', 'collapse-2-diary.png', 'collapse-3-preview.png'].map((f) => join(outDir, f)).join('\n      ')}`)
  r.finish('折叠退场采样')
} finally {
  await browser.close()
}

/** 从场景名推出目标节点的 class 片段（用来在 removed 事件里认出它）。 */
function targetClassOf(res) {
  if (res.name.includes('lore')) return 'awu-loreBody'
  if (res.name.includes('日记')) return 'awu-diary'
  return 'awu-preview'
}
