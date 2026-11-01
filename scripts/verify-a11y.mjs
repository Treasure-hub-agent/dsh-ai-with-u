/**
 * 无障碍静态自检（纯静态扫描：不启动宿主、不读 lib 产物、不执行被检代码）。
 *
 * 为什么单独一套：`tsc` 只查类型，`verify-bundle` 只查产物形状，`verify-wiring`
 * 只管"后端有没有接到前端"。**无障碍这类"约定"没有任何编译器管**——把 `<li>` 写成
 * `<li onClick>`、给图标按钮漏 `aria-label`、把错误提示做成纯视觉 div，类型检查、
 * 打包、其余七套自检全都是绿的，用户却用不了。
 *
 * 七类护栏（每条都写清「为什么」，改动前先读完）：
 *   ① 可点击元素必须是真 `<button>`：全仓当前 0 处 `div/li/span + onClick`。
 *      这是一次性做完的底子（键盘可达 / 焦点顺序 / 读屏角色全靠它），必须当回归护栏守住。
 *   ② 图标型按钮必须有可访问名（`aria-label` / `aria-labelledby` / `title`）：
 *      只有 svg 的按钮对读屏是"无名按钮"，念出来就是「按钮」两个字。
 *   ③ `<button>` 必须显式 `type="button"`：不写时 HTML 默认 `type="submit"`，
 *      一旦将来把它包进 `<form>`，点一下就会提交整个表单。
 *   ④ 错误/校验提示必须能被念出来（`role="alert"` / `aria-live`）：错误只在视觉上出现，
 *      读屏用户等于没收到（"关键词必填"这类校验最容易漏）。
 *   ⑤ 中英字典必须完全对称，且 `t('字面量')` 都能在字典里找到：
 *      `Dict` 类型只能保证 `en` 的键覆盖 `zh`，保证不了"组件写的键存在"；
 *      单侧缺键的后果是英文界面裸显 key 或回落中文。动态拼接键无法静态校验，只计数。
 *   ⑥ 样式模板串里不许出现反引号、`${}` 只用白名单：
 *      2026-10-30 真实事故——CSS 注释里写了一个反引号，模板提前结束，后面的
 *      `.awu-rail` 被当成减法表达式，模块初始化抛 ReferenceError，宿主静默跳过整个插件，
 *      而构建、类型检查、其余自检全绿（排查成本 20 分钟）。
 *   ⑦ 焦点环不许写死颜色（`outline: 2px solid #xxx`）：必须走 token，否则深/浅色态、
 *      高对比模式下焦点环会变隐形。第 1 批已统一收敛成 `var(--awu-accent)`。
 *
 * 约定（与 `verify-wiring.mjs` 同款）：
 *  - 失败信息一律带 `文件:行`，能直接跳过去；
 *  - 静态启发式拿不准时**宁可 [skip] 也不误报**——红点必须都是真问题；
 *  - 不写死行号断言（客户端文件一直在动），只认结构特征；
 *  - 这是"护栏"，不是"验收"：它证明不了键盘真好用，那是手验的事。
 *
 * 跑法：`node scripts/verify-a11y.mjs`；退出码非 0 即有问题。
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const clientDir = join(root, 'client')

let pass = 0
let fail = 0
let skip = 0
const failures = []

const ok = (label, detail = '') => {
  pass += 1
  console.log(`  ✓ ${label}${detail === '' ? '' : `：${detail}`}`)
}
const bad = (label, detail) => {
  fail += 1
  failures.push(`${label} —— ${detail}`)
  console.log(`  ✗ ${label}：${detail}`)
}
const skipped = (label, why) => {
  skip += 1
  console.log(`  ⊘ [skip] ${label}：${why}`)
}

// ---------------------------------------------------------------- 读取源文件

const names = (await readdir(clientDir)).filter(n => n.endsWith('.tsx') || n.endsWith('.ts')).sort()
const src = new Map()
for (const name of names) src.set(name, await readFile(join(clientDir, name), 'utf8'))
const tsxNames = names.filter(n => n.endsWith('.tsx'))
const styleNames = ['styles.ts', 'guide.styles.ts', 'distill.styles.ts'].filter(n => src.has(n))

/** 行号（1 起），用于把失败指到文件:行。 */
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** 去掉块注释（`/* … *\/`，也覆盖 JSX 的 `{/* … *\/}` 与 JSDoc），避免扫描到注释里的示例代码。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/**
 * 从 `from`（指向 `<`）开始找这个开标签的结束 `>`。
 * 跳过字符串（单双引号、模板串）与 `{…}` 里的内容，避免被属性里的 `>` 骗。
 */
function findTagEnd(text, from) {
  let depth = 0
  let quote = ''
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (quote !== '') {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') { depth += 1; continue }
    if (ch === '}') { depth = Math.max(0, depth - 1); continue }
    if (ch === '>' && depth === 0) return i + 1
  }
  return -1
}

/** 收集所有 JSX 标签：{ name, index, tag }。 */
function jsxTags(text) {
  const out = []
  for (const m of text.matchAll(/<([A-Za-z][A-Za-z0-9]*)\b/g)) {
    const end = findTagEnd(text, m.index)
    if (end < 0) continue
    out.push({ name: m[1].toLowerCase(), index: m.index, tag: text.slice(m.index, end) })
  }
  return out
}

console.log('无障碍静态自检（只读源码，不启动宿主）：')

// ================================================================ ① 结构

console.log('')
console.log('① 可点击元素必须是真 button（全仓 0 处 div/li/span + onClick）')
{
  const maybeClickable = new Set(['div', 'li', 'ul', 'ol', 'span', 'p', 'section', 'aside', 'a', 'td', 'tr', 'label'])
  let hits = 0
  for (const name of tsxNames) {
    const text = stripComments(src.get(name))
    for (const t of jsxTags(text)) {
      if (!maybeClickable.has(t.name)) continue
      if (!/\bonClick\b/.test(t.tag)) continue
      hits += 1
      bad('① 非 button 元素绑了 onClick', `${name}:${lineOf(text, t.index)} <${t.name}> —— 换成 <button type="button">，或加 role+tabIndex+onKeyDown`)
    }
  }
  if (hits === 0) ok('① 没有 div/li/span 之类的 onClick', `${tsxNames.length} 个 .tsx 全扫过`)
}

// ================================================================ ② 图标按钮名字

console.log('')
console.log('② 图标型按钮必须有可访问名（aria-label / aria-labelledby / title）')
{
  let icons = 0
  let naked = 0
  for (const name of tsxNames) {
    const text = stripComments(src.get(name))
    for (const m of text.matchAll(/<button\b/g)) {
      const openEnd = findTagEnd(text, m.index)
      if (openEnd < 0) continue
      const attrs = text.slice(m.index, openEnd)
      const closeIdx = text.indexOf('</button>', openEnd)
      if (closeIdx < 0) continue
      const body = text.slice(openEnd, closeIdx)
      // 注意 `\b`：`<IconSpinner` 里 `Icon` 后面紧跟字母，`/<(Icon|svg)\b/` 永远匹配不上
      // （第一版就踩了这个坑，导致只认出 1 个图标按钮）。这里显式吃掉组件名后缀。
      if (!/<(?:Icon[A-Za-z0-9]*|svg)[\s/>]/.test(body)) continue
      // 有文案（t('…') / labels.x / 变量）就不算图标按钮
      if (/\bt\(|labels\.|props\./.test(body)) continue
      const stripped = body.replace(/<[^>]*>/g, '').replace(/\{[^{}]*\}/g, '').trim()
      if (/[A-Za-z\u4e00-\u9fff]{2,}/.test(stripped)) continue
      icons += 1
      if (/aria-label=|aria-labelledby=|title=/.test(attrs)) continue
      naked += 1
      bad('② 图标按钮缺可访问名', `${name}:${lineOf(text, m.index)} —— 补 aria-label（title 只能当兜底）`)
    }
  }
  if (naked === 0) ok('② 图标按钮都有名字', `共 ${icons} 个图标按钮`)
}

// ================================================================ ③ button type

console.log('')
console.log('③ <button> 必须显式 type="button"（否则默认 submit）')
{
  let total = 0
  let missing = 0
  for (const name of tsxNames) {
    const text = stripComments(src.get(name))
    for (const m of text.matchAll(/<button\b/g)) {
      const openEnd = findTagEnd(text, m.index)
      if (openEnd < 0) continue
      total += 1
      if (/\btype=/.test(text.slice(m.index, openEnd))) continue
      missing += 1
      bad('③ button 没写 type', `${name}:${lineOf(text, m.index)} —— 补 type="button"`)
    }
  }
  if (missing === 0) ok('③ 所有 button 都写了 type', `共 ${total} 个 <button>`)
}

// ================================================================ ④ 错误可播报

console.log('')
console.log('④ 错误/校验提示能被读屏念出来（role="alert" / aria-live）')
{
  let errNodes = 0
  let silent = 0
  let emptyStates = 0
  for (const name of tsxNames) {
    const text = stripComments(src.get(name))
    // ④-1 `.awu-err` 这一类"错误块"必须自带 role / aria-live
    for (const t of jsxTags(text)) {
      if (!/awu-err/.test(t.tag)) continue
      errNodes += 1
      if (/role="alert"|aria-live/.test(t.tag)) continue
      silent += 1
      bad('④ .awu-err 没有 role="alert"', `${name}:${lineOf(text, t.index)} —— 读屏不会播报这条错误`)
    }
    // ④-2 直接渲染错误变量（{error} / {dialogError} …）的节点，附近必须有 live 语义
    for (const m of text.matchAll(/\{\s*(error|dialogError|editError|detailError)\s*\}/g)) {
      // 属性上的 `error={editError}` 只是传 prop，不是渲染出来的文本 → 不算
      if (/=\s*$/.test(text.slice(Math.max(0, m.index - 2), m.index))) continue
      const windowStart = Math.max(0, m.index - 400)
      const near = text.slice(windowStart, m.index)
      if (/role="alert"|role="status"|aria-live/.test(near)) continue
      // 整块视图替换的错误空态（`.awu-empty`）不算"静默提示"：它是用户主动操作后
      // 整片内容被换掉，读屏会重新朗读新内容；仍然建议补 role="alert"，但不作为硬红线。
      const enclosing = near.slice(near.lastIndexOf('<'))
      if (/awu-empty/.test(enclosing)) { emptyStates += 1; continue }
      silent += 1
      bad('④ 错误文本没有 live 语义', `${name}:${lineOf(text, m.index)} —— 该元素或其容器补 role="alert"`)
    }
  }
  if (silent === 0) ok('④ 错误提示都可播报', `检查了 ${errNodes} 个 .awu-err 块 + 所有错误变量渲染点`)
  if (emptyStates > 0) {
    skipped('④ 错误空态块（.awu-empty 里的 {error}）',
      `${emptyStates} 处：整块视图替换而非静默提示，不强制 role="alert"（想更严格可补，会与"视图切换是否播报"的策略耦合）`)
  }
  // 已知缺口（不属于本断言范围，别把它算成通过）：
  // distill.tsx 的 `.awu-distill-status`（发送结果）目前仍是纯视觉 div，已交给第 3 批补
  // role="status"；本断言只覆盖 `error*` 变量与 `.awu-err`，故意不去放宽成"扫所有 status 类"。
  if (src.has('distill.tsx') && !/awu-distill-status[^>]*role=|role="status"/.test(src.get('distill.tsx'))) {
    skipped('④ 蒸馏结果条（.awu-distill-status）', '仍是纯视觉节点，已登记给第 3 批；本断言不覆盖')
  }
}

// ================================================================ ⑤ 字典对称

console.log('')
console.log('⑤ 中英字典对称 + t(\'字面量\') 键都存在')
{
  const textSrc = src.get('text.ts')
  if (textSrc === undefined) {
    bad('⑤ text.ts 可读', 'client/text.ts 不存在')
  } else {
    const zhStart = textSrc.indexOf('const zh = {')
    const enStart = textSrc.indexOf('const en: Dict = {')
    if (zhStart < 0 || enStart < 0 || enStart < zhStart) {
      bad('⑤ 字典结构可解析', 'text.ts 里找不到 `const zh = {` / `const en: Dict = {`，脚本假设的结构变了')
    } else {
      const KEY_RE = /^\s{2}'([^']+)':/gm
      const keysOf = (body) => [...body.matchAll(KEY_RE)].map(m => m[1]).filter((k, i, a) => a.indexOf(k) === i)
      const zhKeys = keysOf(textSrc.slice(zhStart, enStart))
      const enKeys = keysOf(textSrc.slice(enStart))
      const missing = zhKeys.filter(k => !enKeys.includes(k))
      const extra = enKeys.filter(k => !zhKeys.includes(k))
      if (missing.length === 0 && extra.length === 0) {
        ok('⑤ zh / en 键集完全对称', `各 ${zhKeys.length} 个键`)
      } else {
        if (missing.length > 0) bad('⑤ en 缺键', `${missing.length} 个：${missing.slice(0, 8).join(', ')}`)
        if (extra.length > 0) bad('⑤ en 多键', `${extra.length} 个：${extra.slice(0, 8).join(', ')}`)
      }

      // 组件里写的字面量键必须能在字典里找到
      const allKeys = new Set(zhKeys)
      let literalUses = 0
      let unknown = 0
      let dynamic = 0
      let indirect = 0
      for (const [name, text0] of src) {
        if (name === 'text.ts') continue
        const text = stripComments(text0)
        for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
          literalUses += 1
          if (allKeys.has(m[1])) continue
          unknown += 1
          bad('⑤ t() 用了字典里没有的键', `${name}:${lineOf(text, m.index)} '${m[1]}'`)
        }
        for (const m of text.matchAll(/\bt\(\s*"([^"]+)"/g)) {
          literalUses += 1
          if (allKeys.has(m[1])) continue
          unknown += 1
          bad('⑤ t() 用了字典里没有的键', `${name}:${lineOf(text, m.index)} "${m[1]}"`)
        }
        dynamic += [...text.matchAll(/\bt\(\s*`/g)].length
        indirect += [...text.matchAll(/\bt\(\s*[A-Za-z_$][\w$.]*\s*[,)]/g)].length
      }
      // 动态模板键（t(`a.${b}`)）没法静态校验，只计数并报阈值：
      // 超过 40 处说明"文案键不再可枚举"，那时候这条护栏就该升级成别的手段了。
      const DYNAMIC_LIMIT = 40
      if (dynamic > DYNAMIC_LIMIT) {
        bad('⑤ 动态拼接键过多', `${dynamic} 处（上限 ${DYNAMIC_LIMIT}）—— 键不再可枚举，护栏会失效`)
      } else if (unknown === 0) {
        ok('⑤ t() 字面量键都在字典里', `${literalUses} 处引用；动态拼接 ${dynamic} 处、变量传入 ${indirect} 处跳过（上限 ${DYNAMIC_LIMIT}）`)
      }
    }
  }
}

// ================================================================ ⑥ CSS 模板串

console.log('')
console.log('⑥ CSS 模板串里没有反引号、${} 只用白名单（上一轮真实事故的护栏）')

/** 找出所有模板串：{ index, end, body, exprs }（处理 `${}` 嵌套与字符串）。 */
function templateLiterals(text) {
  const out = []
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '`') continue
    const start = i
    let j = i + 1
    let body = ''
    const exprs = []
    let closed = false
    while (j < text.length) {
      const ch = text[j]
      if (ch === '\\') { body += ch + (text[j + 1] ?? ''); j += 2; continue }
      if (ch === '`') { closed = true; j += 1; break }
      if (ch === '$' && text[j + 1] === '{') {
        let depth = 1
        let k = j + 2
        let expr = ''
        while (k < text.length && depth > 0) {
          const c = text[k]
          if (c === '{') depth += 1
          else if (c === '}') { depth -= 1; if (depth === 0) break }
          expr += c
          k += 1
        }
        exprs.push(expr.trim())
        body += '\u0000'   // 占位：表示这里是一个插值
        j = k + 1
        continue
      }
      body += ch
      j += 1
    }
    if (!closed) { out.push({ index: start, end: -1, body, exprs, closed: false }); break }
    out.push({ index: start, end: j, body, exprs, closed: true })
    i = j - 1
  }
  return out
}

{
  const WHITELIST = {
    'styles.ts': ['EASE', 'PANEL_WIDTH', 'PANEL_MAX_H', 'GUIDE_CSS', 'DISTILL_CSS', 'id'],
    'guide.styles.ts': [],
    'distill.styles.ts': [],
  }
  let problems = 0
  let bigTemplates = 0
  for (const name of styleNames) {
    const text = src.get(name)
    const allowed = WHITELIST[name] ?? []
    const ticks = (text.match(/`/g) ?? []).length
    // ⑥-1 反引号必须成对：有奇数个就说明有一个反引号跑进了模板串里，
    //      这正是那次事故的形态（模板被提前截断，剩下的 CSS 变成 JS 表达式）。
    if (ticks % 2 !== 0) {
      problems += 1
      bad('⑥ 反引号数量为奇数', `${name} 共 ${ticks} 个 —— 有反引号跑进了模板串（模板被截断）`)
    }
    for (const t of templateLiterals(text)) {
      if (!t.closed) {
        problems += 1
        bad('⑥ 模板串没有闭合', `${name}:${lineOf(text, t.index)} —— 从第 ${lineOf(text, t.index)} 行的反引号开始没结束`)
        continue
      }
      // ⑥-2 插值白名单（只对"像 CSS 的"大模板做，`style[...]` 这类小模板只看是否在白名单）
      for (const expr of t.exprs) {
        if (allowed.includes(expr)) continue
        problems += 1
        bad('⑥ 模板串里出现非白名单插值', `${name}:${lineOf(text, t.index)} \${${expr}} —— 允许：${allowed.join(', ') || '（无）'}`)
      }
      if (t.body.length > 1000) {
        bigTemplates += 1
        // ⑥-3 一次性的 CSS 模板串：正文里出现反引号是不可能的（模板会当场结束），
        //      所以这里检查"闭合之后紧跟的文本"是不是新的语句——被截断时这里会是
        //      `.awu-rail` 之类 CSS 残留，语法上却是合法 JS（当年就是这么混过去的）。
        const after = text.slice(t.end, t.end + 40)
        if (!/^[\s]*(?:$|\/\*\*|\/\/|export|const|function|\}|\))/.test(after)) {
          problems += 1
          bad('⑥ CSS 模板串疑似被提前截断', `${name}:${lineOf(text, t.end)} 闭合后紧跟 ${JSON.stringify(after.slice(0, 24))}`)
        }
      }
    }
  }
  if (problems === 0) ok('⑥ CSS 模板串安全', `${styleNames.length} 个样式文件，${bigTemplates} 个大模板逐串解析过`)
}

// ================================================================ ⑦ 焦点环 token

console.log('')
console.log('⑦ 焦点环不许写死颜色（outline: Npx solid 必须跟 var(...)）')
{
  let literal = 0
  let rings = 0
  for (const name of styleNames) {
    const text = src.get(name)
    for (const m of text.matchAll(/outline:\s*([^;{}]+);/g)) {
      const value = m[1].trim()
      if (!/^[\d.]+px\s+solid\s+/.test(value)) continue
      rings += 1
      if (/^[\d.]+px\s+solid\s+var\(/.test(value)) continue
      literal += 1
      bad('⑦ 焦点环写死了颜色', `${name}:${lineOf(text, m.index)} outline: ${value} —— 换成 var(--awu-accent)`)
    }
  }
  if (literal === 0) ok('⑦ 焦点环都走 token', `共 ${rings} 条 outline 规则`)
}

// ================================================================ 汇总

console.log('')
if (fail > 0) {
  console.log(`无障碍自检未通过：通过 ${pass} 项，失败 ${fail} 项${skip > 0 ? `，跳过 ${skip} 项` : ''}。`)
  console.log('\n失败清单（文件:行）：')
  for (const line of failures) console.log(`  - ${line}`)
  console.log('\n如果这些改动正在别人手里：别自己改 client/，把上面每条的归属报给 Lead。')
  process.exit(1)
}
console.log(`无障碍自检通过：通过 ${pass} 项，失败 0 项${skip > 0 ? `，跳过 ${skip} 项` : ''}。`)
