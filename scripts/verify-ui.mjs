/**
 * UI 纪律自检（静态扫描，不启动宿主、不依赖 lib 产物，可以在 build 最早跑）。
 *
 *   node scripts/verify-ui.mjs
 *
 * 为什么需要它：`styles.ts` 是 4200 行的模板字符串，`index.tsx` 是 4000 行的编排层。
 * 这类文件的回归不是"逻辑错"，而是**纪律漂移**——写死一个字号、漏一条降级、
 * 把注释里的 markdown 反引号写进模板串（真实事故，两次）、把 `data-x={false}`
 * 交给属性存在性选择器（真实事故，一次）。这些都靠肉眼看不住，只能用机器盯。
 *
 * 七条断言（每条都对应一次真实踩坑或明确的设计承诺）：
 *   1. 三份 styles 的模板串里反引号必须 0；`${` 只允许既有插值白名单；花括号平衡
 *   2. @keyframes 闭环：没有死动画、也没有引用不存在的动画名
 *   3. 动画/过渡时长必须走令牌（`var(--awu-t-*)`），历史字面量走白名单且不许增长
 *   4. `styles.ts` 里不许有写死的 font-size 字面量；子视图两份按预算盯住
 *   5. 不允许 `transition: all`
 *   6. 属性选择器一律带值（`[data-x="true"]`），存在性匹配会连 "false" 一起命中
 *   7. 卡片错峰上限 `min(index, 8)` 不得放大
 *
 * 扫描前统一剥掉 CSS 注释：注释里为了讲道理会引用选择器写法，不剥就会误报
 * （本脚本第一版正是这么误报了 5 条）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'client')

let passed = 0
const failures = []
const ok = (label) => { passed++; console.log(`  ✓ ${label}`) }
const fail = (label, detail) => {
  failures.push({ label, detail })
  console.log(`  ✗ ${label}`)
  for (const line of detail) console.log(`      ${line}`)
}
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 剥掉 JS/TS 的注释（`//` 行注释 + `/* … *\/` 块注释，只在引号外生效，
 * 免得把 `https://` 或字符串里的内容当注释切掉）。
 *
 * 为什么需要：注释里为了讲清楚会**引用代码片段**（例如
 * `Math.min(index,12)*CARD_STAGGER` 的反例说明），不剥就会把注释当实现扫 → 假红。
 * 这个脚本第一版就被自己的注释误报过。
 */
const stripTsComments = (source) => {
  let out = ''
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quote !== '') {
      out += ch
      if (ch === '\\') { out += source[i + 1] ?? ''; i += 1; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * 抽出 `const XXX_CSS = \` … \`` 之间真正的 CSS 文本。
 *
 * 收尾特征：一行只有反引号，**允许行尾跟 `//` 注释**（`` ` // CSS 结束 ``）。
 * 不能用「下一个反引号」找——注释里的反引号正是当年事故的成因。
 *
 * 找不到收尾行时**不静默降级**：返回 `closed: false`，由断言 1 明确报出来。
 * （老实现会退化成"扫整个文件"，于是把 installStyles 里的代码模板串当成 CSS，
 * 报出一堆看不懂的假红——比不检查更糟。）
 */
const templateBody = (source) => {
  // 常量名以 `CSS` 结尾：`CSS`（styles.ts）/ `DISTILL_CSS` / `GUIDE_CSS` / 将来任何 `X_CSS`
  const m = source.match(/const ([\w$]*CSS) = `/)
  if (m === null) return { body: '', closed: false, constName: '', reason: '找不到 `const XXX_CSS = \\` 声明' }
  const constName = m[1]
  const from = m.index + m[0].length
  // 收尾：换行 → 反引号 → 可选行尾注释 → 换行或文件尾。CRLF 必须容忍。
  const close = source.slice(from).match(/\r?\n`[ \t]*(?:\/\/[^\n]*)?(?:\r?\n|$)/)
  if (close === null) {
    return {
      body: source.slice(from),
      closed: false,
      constName,
      reason: '找不到收尾行（一行只有反引号）—— 模板串可能被截断，或被改成了别的排版',
    }
  }
  return { body: source.slice(from, from + close.index), closed: true, constName }
}

/**
 * 样式文件自动发现：`client/styles.ts` + 任何 `client/*.styles.ts`。
 * 写死三个文件名的话，以后新加一份 `card.styles.ts` 会**静默漏扫**。
 */
const styleFiles = [
  'client/styles.ts',
  ...readdirSync(clientDir).filter((f) => f.endsWith('.styles.ts')).map((f) => `client/${f}`),
].sort()

const styleBodies = new Map(styleFiles.map((rel) => [rel, templateBody(read(rel))]))
const cssText = [...styleBodies.values()].map((info) => info.body).join('\n')
const cssCode = stripComments(cssText)

const tsxFiles = readdirSync(clientDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
const tsxSources = new Map(tsxFiles.map((f) => [f, stripTsComments(readFileSync(join(clientDir, f), 'utf8'))]))

// ---------------------------------------------------------------- 1. 模板串守卫
{
  const problems = []
  // 插值白名单：三个常量 + **所有被发现的样式模板常量名**（新增一份 X_CSS 时自动放行自身拼接）
  const allowed = new Set(['EASE', 'PANEL_WIDTH', 'PANEL_MAX_H'])
  for (const info of styleBodies.values()) if (info.constName !== '') allowed.add(info.constName)
  for (const [rel, info] of styleBodies) {
    // 收尾行没找到 → 直接红，不静默降级成"扫整文件"
    if (!info.closed) {
      problems.push(`${rel}：${info.reason ?? '模板串没闭合'}`)
      continue
    }
    const body = info.body
    const backticks = (body.match(/`/g) ?? []).length
    if (backticks !== 0) problems.push(`${rel}：模板串体内 ${backticks} 个反引号（注释里也不行，会截断模板串 → 整个插件模块加载失败）`)
    const strangers = [...body.matchAll(/\$\{([^}]*)\}/g)]
      .map((m) => m[1].trim())
      .filter((i) => !allowed.has(i))
    if (strangers.length > 0) problems.push(`${rel}：非白名单插值 ${strangers.join(', ')}`)
    const open = (body.match(/\{/g) ?? []).length
    const close = (body.match(/\}/g) ?? []).length
    if (open !== close) problems.push(`${rel}：花括号不平衡 ${open}/${close}`)
  }
  if (problems.length === 0) {
    ok(`模板串守卫：${styleBodies.size} 份样式、反引号 0 / 插值全部白名单 / 花括号平衡 / 收尾行齐全`)
  } else fail('模板串守卫', problems)
}

// ---------------------------------------------------------------- 2. keyframes 闭环
{
  const TIMING = new Set(['none', 'both', 'infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
    'normal', 'forwards', 'backwards', 'paused', 'running', 'alternate', 'reverse', 'initial', 'inherit',
    'var', 'important', 'step-start', 'step-end', 'cubic-bezier'])
  const declared = new Set([...cssCode.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))
  const used = new Set(
    [...cssCode.matchAll(/animation(?:-name)?\s*:\s*([^;{}]+);/g)]
      .flatMap((m) => m[1].split(/[\s,()]+/))
      .filter((t) => /^[a-z][\w-]*$/.test(t) && !TIMING.has(t)),
  )
  // 第 3 批已把两条方向退场接上（`.awu-detail[data-state="closing"]` / `[data-exit]`），
  // 所以白名单清空：以后任何"定义了没人用"的动画都会直接变红。
  const RESERVED = new Set()
  const dead = [...declared].filter((n) => !used.has(n) && !RESERVED.has(n))
  const missing = [...used].filter((n) => !declared.has(n))
  const problems = []
  if (dead.length > 0) problems.push(`死动画（定义了没人用）：${dead.join(', ')}`)
  if (missing.length > 0) problems.push(`引用了不存在的 keyframes：${missing.join(', ')}`)
  if (problems.length === 0) {
    ok(`keyframes 闭环：${declared.size} 条，全部有引用`)
  } else fail('keyframes 闭环', problems)
}

// ---------------------------------------------------------------- 3. 时长/缓动走令牌
{
  // 历史字面量白名单：环境动画与降级块里的固定值。新增值必须走令牌。
  const ALLOWED_LITERALS = new Set(['.9s', '1.1s', '1.4s', '2.6s', '.01ms', '0ms'])
  const problems = []
  for (const match of cssCode.matchAll(/(?:animation|transition)(?:-[a-z]+)?\s*:\s*([^;{}]+);/g)) {
    const decl = match[1]
    if (/var\(--awu-t-/.test(decl) || /var\(--awu-ease/.test(decl)) continue
    for (const lit of decl.matchAll(/(?<![\w-])(\d*\.?\d+m?s)\b/g)) {
      if (!ALLOWED_LITERALS.has(lit[1])) problems.push(`${match[0].trim()} ← 裸时长 ${lit[1]}`)
    }
  }
  if (problems.length === 0) ok(`时长/缓动：只走令牌（历史字面量白名单 ${ALLOWED_LITERALS.size} 个）`)
  else fail('时长/缓动走令牌', problems.slice(0, 12))
}

// ---------------------------------------------------------------- 4. 写死字号
{
  const literals = [...cssCode.matchAll(/font-size\s*:\s*([^;]+);/g)].map((m) => m[1].trim())
  const hard = literals.filter((v) => !/var\(--awu-fs-/.test(v))
  // main 文件应当为 0；子视图两份有历史遗留，用预算盯住不许增长。
  // 注意：不能用 `font-size\s*:\s*(?!var\()` 这种负向前瞻——`\s*` 会回溯到别的
  // 位置让前瞻通过，147 处 var() 全被误判成字面量（本脚本第二版就踩了）。先取值再判断。
  const budget = 30
  const mainSizes = [...((styleBodies.get('client/styles.ts')?.body) ?? '').matchAll(/font-size\s*:\s*([^;]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => !/^var\(--awu-fs-/.test(v))
  const problems = []
  if (mainSizes.length > 0) problems.push(`client/styles.ts 出现 ${mainSizes.length} 处写死字号：${mainSizes.slice(0, 5).join(' / ')}`)
  if (hard.length > budget) problems.push(`子视图字号字面量 ${hard.length} 处，超预算 ${budget}`)
  if (problems.length === 0) ok(`字号：main 写死 0 处；子视图字面量 ${hard.length} 处（预算 ${budget}，第 3 批收）`)
  else fail('写死字号', problems)
}

// ---------------------------------------------------------------- 5. transition: all
{
  const hits = [...cssCode.matchAll(/transition(?:-property)?\s*:\s*all\b/g)]
  if (hits.length === 0) ok('没有 transition: all')
  else fail('transition: all', [`出现 ${hits.length} 处——会顺带动画布局属性`])
}

// ---------------------------------------------------------------- 6. 属性选择器带值
{
  // 宿主约定：body[data-ds-dark-theme] 是主题标记，属性存在本身即语义（值恒为空串），
  // 不可能出现 "false" 字符串，所以允许存在性匹配。
  const PRESENCE_OK = new Set(['data-ds-dark-theme'])
  const problems = []
  for (const [rel, info] of styleBodies) {
    for (const match of stripComments(info.body).matchAll(/\[(data-[\w-]+)\]/g)) {
      if (PRESENCE_OK.has(match[1])) continue
      problems.push(`${rel}：${match[0]} —— React 会把 {false} 序列化成字符串，改成 [${match[1]}="true"]`)
    }
  }
  if (problems.length === 0) ok('data-* 属性选择器全部带值（宿主主题标记除外）')
  else fail('属性选择器带值', problems.slice(0, 10))
}

// ---------------------------------------------------------------- 7. 卡片错峰上限
{
  const problems = []
  for (const [file, source] of tsxSources) {
    // 7a：`Math.min(index, N) * CARD_STAGGER` —— N 决定"有多少张卡会被错峰"
    for (const match of source.matchAll(/Math\.min\(\s*index\s*,\s*(\d+)\s*\)\s*\*\s*CARD_STAGGER/g)) {
      if (Number(match[1]) > 8) problems.push(`${file}：min(index, ${match[1]}) 超过 8，长列表落位会拖到秒级`)
    }
    // 7b：等价写法里写成**字面量步长**的（`index * 40`、`Math.min(index, 12) * 40`）。
    // 只盯 CARD_STAGGER 会漏掉这种复制粘贴出来的版本；步长 ≥ 40ms 视为"照抄但没走令牌"。
    for (const match of source.matchAll(/Math\.min\(\s*index\s*,\s*(\d+)\s*\)\s*\*\s*(\d+)\b/g)) {
      if (Number(match[1]) > 8) problems.push(`${file}：min(index, ${match[1]}) 超过 8`)
      if (Number(match[2]) >= 40) problems.push(`${file}：错峰步长写死 ${match[2]}ms，改用 CARD_STAGGER 令牌`)
    }
    for (const match of source.matchAll(/\bindex\s*\*\s*(\d+)\s*(?:ms|\})/g)) {
      if (Number(match[1]) >= 40) problems.push(`${file}：错峰步长写死 ${match[1]}ms（index * ${match[1]}），改用 CARD_STAGGER 令牌`)
    }
  }
  if (problems.length === 0) ok('卡片错峰上限 ≤ 8，步长一律走 CARD_STAGGER 令牌')
  else fail('卡片错峰上限/步长', problems)
}

console.log('')
if (failures.length === 0) {
  console.log(`UI 纪律自检全部通过（${passed} 项）。`)
  process.exit(0)
} else {
  console.log(`UI 纪律自检失败：${failures.length} 组不通过。`)
  process.exit(1)
}
