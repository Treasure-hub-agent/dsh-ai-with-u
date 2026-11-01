/**
 * 接线体检：静态扫源码，抓「后端做了、前端没接」这类断线。
 *
 * 为什么需要它：`tsc` 只查「类型对不对」，不查「有没有人调用」。
 * 一段 17 KB 的 `client/lorebook-schema.ts` 可以零 import 地躺在仓库里，
 * 一个 `POST /character/import` 路由可以在 `src/web.ts` 注册完就没下文——
 * 这两种状态下类型检查、打包、其余自检**全是绿的**，但用户打开面板
 * 看不到「导入角色卡」，也改不了世界书。
 * （2026-10-31 开工时的真实状态：导入接口已实现但面板零入口；lorebook-schema 全项目无引用）
 *
 * 所以这里只看「接线」：源码文本里有没有那条路、有没有那个调用。
 * 纯静态、零依赖、不执行被检代码——它能证明「接了线」，不能证明「线通着」，
 * 后者是 `verify-tavern` / `verify-import` / 真机 F5 的事。
 *
 * 约定：
 *  - 失败文案写两件事：**缺什么** + **该找谁**（宿主侧 = host-core / 客户端 = client-ui）；
 *  - 静态启发式拿不准时**宁可 [skip] 也不误报**——红点必须都是真问题，否则没人看；
 *  - 断言只认「文案 key + 结构特征」，**不写死行号**：客户端文件一直在动，行号断言活不过一天；
 *  - 这是「体检表」：已串进 `npm run build`（`verify-bundle` 之后），也可 `npm run verify:wiring` 单跑。
 *
 * 跑法：`node scripts/verify-wiring.mjs`；退出码非 0 即有问题。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

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
const note = (text) => { console.log(`    · ${text}`) }
const head = (title) => { console.log(`\n${title}`) }

// ---------------------------------------------------------------- 读取与工具

/** 读一个项目内文件；不存在返回 undefined（断言自己决定怎么报）。 */
async function readSource(relPath) {
  try {
    return await readFile(join(root, relPath), 'utf8')
  } catch {
    return undefined
  }
}

/** client/ 下所有 .ts/.tsx（相对项目根的 posix 风格路径）。 */
async function listClientSources() {
  const out = []
  const walk = async (dir) => {
    let entries = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (/\.tsx?$/u.test(entry.name)) out.push(relative(root, full).split(sep).join('/'))
    }
  }
  await walk(join(root, 'client'))
  return out.sort()
}

// ---------------------------------------------------------------- 静态解析小工具

/**
 * 从 `start` 指向的 `(` / `{` / `[` 开始，返回配对到闭合括号的整段文本。
 * 启发式：不处理「字符串里出现括号」的极端情况，够用即可。
 */
function sliceBalanced(text, start) {
  const open = text[start]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : undefined
  if (close === undefined) return undefined
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) depth += 1
    else if (text[i] === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return undefined
}

/**
 * 取 `src/web.ts` 里某条路由的处理块：从 `` path: `${ROUTE_PREFIX}/xxx` `` 到下一个 `path:` 为止。
 * 拿不到返回 undefined（调用方自己决定判红还是 skip）。
 */
function sliceRoute(source, fragment) {
  const needle = '${ROUTE_PREFIX}' + fragment + '`'
  const at = source.indexOf(needle)
  if (at < 0) return undefined
  const next = source.indexOf('path:', at + needle.length)
  return source.slice(at, next < 0 ? Math.min(source.length, at + 3000) : next)
}

/**
 * 读 `const NAME = ...` 的字符串内容（支持反引号模板、单双引号、`+` 拼接）。
 *
 * 目的只有一个：**数清真正会进提示词的字符数**。
 * 模板里的 `${...}` 插值会尽量解析——`${OTHER_CONST}` 这种同文件常量引用会递归展开
 * （`full = lite + 两段` 是很常见的写法，不展开就会把 full 量成只剩尾巴）；
 * 展开不了的（`${BANDS.join(' / ')}` 这类）按 0 字符计，并在返回里标 unresolved。
 *
 * 返回 `{ text, literals, unresolved }`；找不到声明返回 undefined。
 */
function readConstText(source, name, seen = new Set()) {
  if (seen.has(name)) return undefined
  seen.add(name)
  const decl = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=`, 'u').exec(source)
  if (decl === null) return undefined
  const from = decl.index + decl[0].length
  // 语句边界：到下一条顶层声明或顶层注释为止。
  // 只认 `const` 不够——中间可能夹着 `export type DisciplineLevel = 'off' | 'lite' | 'full'`，
  // 那行的字面量会被当成正文多算 14 字（2026-10-31 实际踩到：750 vs 736）。
  const stopMatch = /\n(?:export\s+)?(?:const|let|var|type|interface|function|class|async\s+function)\s|\n\/\*\*|\n\/\//u.exec(source.slice(from))
  const end = stopMatch === null ? Math.min(source.length, from + 20000) : from + stopMatch.index
  const chunk = source.slice(from, end)

  let text = ''
  let literals = 0
  let unresolved = 0
  let i = 0
  while (i < chunk.length) {
    const ch = chunk[i]
    if (ch === '`' || ch === "'" || ch === '"') {
      literals += 1
      const quote = ch
      i += 1
      while (i < chunk.length) {
        const cur = chunk[i]
        if (cur === '\\') {
          const esc = chunk[i + 1]
          text += esc === 'n' ? '\n' : esc === 't' ? '\t' : (esc ?? '')
          i += 2
          continue
        }
        if (cur === quote) { i += 1; break }
        if (quote === '`' && cur === '$' && chunk[i + 1] === '{') {
          let depth = 1
          let j = i + 2
          while (j < chunk.length && depth > 0) {
            if (chunk[j] === '{') depth += 1
            else if (chunk[j] === '}') depth -= 1
            j += 1
          }
          const expr = chunk.slice(i + 2, j - 1).trim()
          const inner = /^[A-Za-z0-9_$]+$/u.test(expr) ? readConstText(source, expr, seen) : undefined
          if (inner !== undefined) text += inner.text
          else unresolved += 1
          i = j
          continue
        }
        text += cur
        i += 1
      }
      continue
    }
    i += 1
  }
  return { text, literals, unresolved }
}

/** 从 `index` 处往回找最近的 `export function NAME(` / `export const NAME = ... =>`。 */
function enclosingExportName(source, index) {
  const before = source.slice(0, index)
  let best
  for (const m of before.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gu)) {
    if (best === undefined || (m.index ?? 0) > best.at) best = { name: m[1], at: m.index ?? 0 }
  }
  for (const m of before.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/gu)) {
    if (best === undefined || (m.index ?? 0) > best.at) best = { name: m[1], at: m.index ?? 0 }
  }
  return best?.name
}

/** 某符号是否在 `client/` 里的其它文件被 import 或调用。返回首个命中文件。 */
async function findClientUser(symbol, selfPaths, files) {
  const importRe = new RegExp(`import\\s+[\\s\\S]{0,400}?\\b${symbol}\\b[\\s\\S]{0,400}?from\\s+['"][^'"]*api['"]`, 'u')
  const callRe = new RegExp(`\\b${symbol}\\s*\\(`, 'u')
  for (const file of files) {
    if (selfPaths.includes(file)) continue
    const src = await readSource(file)
    if (src === undefined) continue
    if (importRe.test(src) || callRe.test(src)) return file
  }
  return undefined
}

const clientFiles = await listClientSources()

// ================================================================ 1. 导入入口
head('[1] 客户端 · 角色卡导入入口（后端 POST /character/import 已就绪）')
{
  const api = (await readSource('client/api.ts')) ?? ''
  if (api === '') {
    bad('client/api.ts 可读', '文件不存在或读不到 —— 客户端源码结构变了，先找 client-ui 确认')
  } else if (!api.includes('character/import')) {
    bad('client/api.ts 里有 character/import 路由',
      '缺 ROUTES 项与调用函数：面板永远发不出导入请求，用户只能手动往 characters/ 目录里塞卡。'
      + '后端 src/web.ts 已注册 POST /character/import（16 MB、解析不落盘），补前端一行即可。该找 client-ui')
  } else {
    ok('client/api.ts 里有 character/import 路由')
    // 顺着路由常量找是哪个导出函数在调它，避免写死函数名
    const routeKey = /([A-Za-z0-9_$]+)\s*:\s*['"`]\/character\/import['"`]/u.exec(api)?.[1]
    let owner
    if (routeKey !== undefined) {
      const useAt = api.indexOf(`ROUTES.${routeKey}`)
      if (useAt >= 0) owner = enclosingExportName(api, useAt)
    }
    if (owner === undefined) {
      const literalAt = api.indexOf('character/import')
      owner = enclosingExportName(api, literalAt)
    }
    if (owner === undefined) {
      skipped('有组件调用导入函数', 'api.ts 里有路由字符串但看不出调它的导出函数名，静态判定不了（可能 inline post）')
    } else {
      const user = await findClientUser(owner, ['client/api.ts'], clientFiles)
      if (user === undefined) {
        bad('有组件调用导入函数',
          `client/api.ts 导出 ${owner}() 但 client/ 里没有任何组件调用它 —— 这就是「后端做了前端没接」，`
          + '类型检查全绿、面板上没有入口。该找 client-ui（入口放角色簿左栏，与「新建角色」「蒸馏角色卡」同区）')
      } else {
        ok('有组件调用导入函数', `${owner}() ← ${user}`)
      }
    }
  }
}

// ================================================================ 2. 世界书编辑
head('[2] 客户端 · 世界书编辑器接线（client/lorebook-schema.ts 数据层已就绪）')
{
  const dataLayer = 'client/lorebook-schema.ts'
  const importRe = /from\s+['"][^'"]*lorebook-schema['"]|require\(\s*['"][^'"]*lorebook-schema['"]\s*\)/u
  let consumer
  for (const file of clientFiles) {
    if (file === dataLayer) continue
    const src = await readSource(file)
    if (src !== undefined && importRe.test(src)) { consumer = file; break }
  }
  if (consumer === undefined) {
    bad('有组件 import 世界书数据层',
      `${dataLayer}（toLoreDraft / mergeLore / mergeLoreIntoCard / moveEntry / loreIssues）全项目零引用 —— `
      + '世界书数据层是死代码，面板里没有第 11 个分区，用户看不到也改不了 character_book。'
      + '该找 client-ui（角色卡编辑器新增「世界书（设定条目）」分区）')
  } else {
    ok('有组件 import 世界书数据层', `${dataLayer} ← ${consumer}`)
  }

  const text = await readSource('client/text.ts')
  if (text === undefined) {
    bad('client/text.ts 可读', '文件不存在或读不到，文案无处可查 —— 该找 client-ui')
  } else {
    const keys = [...text.matchAll(/['"`]((?:lorebook|worldbook|world-book|lore)\.[A-Za-z0-9_.]+)['"`]/gu)].map(m => m[1])
    if (keys.length === 0) {
      bad('client/text.ts 里有世界书文案 key',
        '没有 lorebook.* / worldbook.* / lore.* 形态的 key —— 世界书分区的标题、按钮、空态只能裸显 key 或写死中文，'
        + '英文界面直接露底。该找 client-ui（中英双字典都要补）')
    } else {
      const unique = [...new Set(keys)]
      ok('client/text.ts 里有世界书文案 key', `${unique.length} 个（如 ${unique.slice(0, 3).join(' / ')}）`)
    }
  }
}

// ================================================================ 3. 死路由已清
head('[3] 客户端 · 死路由已清（宿主没有 /distill/parse，留着就是永远抛 ApiUnavailableError）')
{
  const api = (await readSource('client/api.ts')) ?? ''
  if (api === '') {
    bad('client/api.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else {
    const leftoverRoute = api.includes('distill/parse')
    const leftoverFn = /\bparseDistillCard\b/u.test(api)
    if (leftoverRoute || leftoverFn) {
      const what = [leftoverRoute ? 'ROUTES.distillParse' : '', leftoverFn ? 'parseDistillCard()' : '']
        .filter(Boolean).join(' + ')
      bad('client/api.ts 不再出现 distill/parse 与 parseDistillCard',
        `还留着 ${what}：src/web.ts 从没注册过这条路由，调用必抛 ApiUnavailableError，`
        + '属于「骨架等格式定稿」的残留。该找 client-ui 删掉（连同注释里的「⏸ 实现挂起」段）')
    } else {
      ok('client/api.ts 不再出现 distill/parse 与 parseDistillCard')
    }
    // 非致命提醒：别处注释里还提到这条死路由，读者会以为它有实现
    const others = []
    for (const file of clientFiles) {
      if (file === 'client/api.ts') continue
      const src = await readSource(file)
      if (src !== undefined && src.includes('distill/parse')) others.push(file)
    }
    if (others.length > 0) note(`另有注释提到 distill/parse（不影响运行，顺带看过即可）：${others.join('、')}`)
  }
}

// ================================================================ 4. 纪律包 L0.5
head('[4] 宿主侧 · 纪律包 L0.5（aiwu:discipline / order 5050 / 文本长度）')
{
  const prompt = await readSource('src/prompt.ts')
  if (prompt === undefined) {
    bad('src/prompt.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const hasId = prompt.includes('aiwu:discipline') || /SECTION_DISCIPLINE\s*=\s*['"]aiwu:discipline['"]/u.test(prompt)
    if (!hasId) {
      bad('src/prompt.ts 里有 aiwu:discipline 段',
        '没有纪律包这一段的常量/名字：L0 还是那 365 字的底线，原 skill 的禁止词库、消息形态、'
        + '输入识别、内容边界全缺，模型会回「作为一个 AI 我无法…」。该找 host-core')
    } else {
      ok('src/prompt.ts 里有 aiwu:discipline 段')
    }

    // order：静态解析 section(SECTION_DISCIPLINE, <expr>, ...) 里的表达式
    const base = Number(/export\s+const\s+ORDER_BASE\s*=\s*(\d+)/u.exec(prompt)?.[1] ?? 5000)
    const evalOrder = (expr) => {
      const text = expr.trim()
      if (/^\d+$/u.test(text)) return Number(text)
      if (/^ORDER_BASE$/u.test(text)) return base
      const plus = /^ORDER_BASE\s*\+\s*(\d+)$/u.exec(text)
      if (plus !== null) return base + Number(plus[1])
      const sum = /^(\d+)\s*\+\s*(\d+)$/u.exec(text)
      if (sum !== null) return Number(sum[1]) + Number(sum[2])
      return undefined
    }
    let order
    let orderExpr = ''
    for (const m of prompt.matchAll(/section\(\s*([A-Za-z0-9_]+|'[^']+'|"[^"]+")\s*,\s*([^,\n]+),/gu)) {
      const target = m[1].replace(/['"]/gu, '')
      if (target !== 'SECTION_DISCIPLINE' && target !== 'aiwu:discipline') continue
      orderExpr = m[2].trim()
      order = evalOrder(orderExpr)
      break
    }
    if (order === undefined) {
      if (hasId) {
        bad('aiwu:discipline 段的 order = 5050',
          `找到段名但解析不出 section() 里的 order 表达式（看到「${orderExpr}」）—— `
          + '要么没在 install() 里注册（段名写了没人挂，等于没写），要么 order 用了非常量表达式。该找 host-core')
      } else {
        bad('aiwu:discipline 段的 order = 5050', '段本身不存在，order 无从谈起 —— 该找 host-core')
      }
    } else if (order === 5050) {
      ok('aiwu:discipline 段的 order = 5050', orderExpr)
    } else {
      bad('aiwu:discipline 段的 order = 5050',
        `实际算出来是 ${order}（表达式「${orderExpr}」）。5050 是刻意选的：baseline 5000 之后（底线先立）、`
        + 'active 5100 之前（角色卡之前先立行为纪律），而且早于易变的日记/世界书/时间差段，不烧缓存。该找 host-core')
    }

    // 文本长度：lite 必检；full 存在则一起检
    const specs = [
      { name: 'DISCIPLINE_TEXT', min: 200, max: 900, label: 'lite 版纪律文本 DISCIPLINE_TEXT' },
      { name: 'DISCIPLINE_FULL_TEXT', min: 200, max: 1400, label: 'full 版纪律文本 DISCIPLINE_FULL_TEXT', optional: true },
    ]
    for (const spec of specs) {
      const found = readConstText(prompt, spec.name)
      if (found === undefined) {
        if (spec.optional === true) skipped(spec.label, '没有这个常量——若 lite/full 用别的名字或共用一份文本，在脚本里改一下名字')
        else bad(spec.label, `src/prompt.ts 里没有 const ${spec.name} —— 纪律包没有正文，段是空的。该找 host-core`)
        continue
      }
      const length = found.text.length
      const caveat = found.unresolved > 0 ? `（另有 ${found.unresolved} 处运行时插值未计入）` : ''
      if (found.literals === 0) {
        bad(spec.label, `找到了 ${spec.name} 但读不出字符串字面量（可能整体引用了别的常量）—— 该找 host-core 或在此脚本放宽`)
      } else if (length < spec.min || length > spec.max) {
        bad(spec.label,
          `实际 ${length} 字符，期望 ${spec.min}..${spec.max}（每轮都进系统提示词，太长会挤掉角色卡，太短压不住 AI 腔）。该找 host-core`)
      } else {
        ok(spec.label, `${length} 字符${caveat}`)
      }
    }
  }
}

// ================================================================ 5. 新工具
head('[5] 宿主侧 · 新工具 awu_mode 与 awu_relation 的 set')
{
  const tools = await readSource('src/tools.ts')
  if (tools === undefined) {
    bad('src/tools.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    if (/name:\s*['"]awu_mode['"]/u.test(tools)) {
      ok('src/tools.ts 里有 name: \'awu_mode\'')
    } else {
      bad('src/tools.ts 里有 name: \'awu_mode\'',
        '模型没有切换模式的工具：用户说「切纯文本」只能去点面板，插件里等于聋了。该找 host-core')
    }

    const relationAt = tools.indexOf("name: 'awu_relation'")
    if (relationAt < 0) {
      bad('awu_relation 的 parameters 里有 set',
        'src/tools.ts 里找不到 awu_relation 工具本身 —— 先找 host-core 确认工具还在不在')
    } else {
      // 取这个工具定义到下一个工具定义之间的一段，找 parameters 里的 set
      const nextTool = tools.indexOf("name: 'awu_", relationAt + 10)
      const block = tools.slice(relationAt, nextTool < 0 ? relationAt + 4000 : nextTool)
      const paramsAt = block.indexOf('parameters:')
      const params = paramsAt < 0 ? '' : (sliceBalanced(block, block.indexOf('{', paramsAt)) ?? '')
      if (/\bset\s*:/u.test(params)) {
        ok('awu_relation 的 parameters 里有 set')
      } else {
        bad('awu_relation 的 parameters 里有 set',
          'awu_relation 还是纯查询（parameters 里没有 set）：档位只能在面板改，'
          + '模型判定「关系变了」却没有写回通道，「查看不写回」的口径也没处落地。该找 host-core（可选 set + why）')
      }
    }
  }
}

// ================================================================ 6. 会话字段
head('[6] 宿主侧 · SessionState 新增 intimacy / relation_log')
{
  const store = await readSource('src/store.ts')
  if (store === undefined) {
    bad('src/store.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const at = store.indexOf('export interface SessionState')
    if (at < 0) {
      bad('src/store.ts 里有 SessionState', '找不到 export interface SessionState —— 会话状态结构变了，先找 host-core')
    } else {
      const body = sliceBalanced(store, store.indexOf('{', at)) ?? ''
      if (body === '') {
        bad('SessionState 结构可解析', 'SessionState 的括号没配平，静态读不出字段（脚本问题或源码语法错）—— 先找 host-core 确认')
      } else {
        const hasIntimacy = /\bintimacy\??\s*:/u.test(body)
        const hasLog = /\brelation_log\??\s*:/u.test(body)
        if (hasIntimacy) ok('SessionState 里有 intimacy')
        else {
          bad('SessionState 里有 intimacy',
            '会话里没有亲密度字段：面板显示基线、对话里模型现算，两边永远对不上。该找 host-core')
        }
        if (hasLog) ok('SessionState 里有 relation_log')
        else {
          bad('SessionState 里有 relation_log',
            '关系变化没有留痕（没有 relation_log 数组）—— 档位跳变时无从回溯「为什么变」。该找 host-core（上限 50 条，超出丢最旧）')
        }
        // 五档只在「内联字面量联合类型」时才查：写成 `RelationBand` 别名（定义在 tavern.ts）是正常写法，不误报
        const intimacyType = /\bintimacy\??\s*:\s*([^\n]+)/u.exec(body)?.[1] ?? ''
        const inlineUnion = /['"]/u.test(intimacyType)
        const bands = ['陌生', '认识', '熟悉', '亲近', '亲密']
        const missing = bands.filter(band => !intimacyType.includes(band))
        if (hasIntimacy && inlineUnion && missing.length > 0) {
          note(`intimacy 的内联联合类型里少了这几档：${missing.join('、')}（写成类型别名时本检查自动跳过）`)
        }
      }
    }
  }
}

// ================================================================ 7. 世界书保存契约
head('[7] 客户端 · 世界书保存契约（C7：世界书的改动必须随 ccv3 走，否则被静默吞掉）')
{
  // 只在「真正产世界书」的文件里看保存载荷：数据层自己不算
  const DATA_LAYER = ['client/lorebook-schema.ts', 'client/card-source.ts', 'client/api.ts']
  const producers = []
  for (const file of clientFiles) {
    if (DATA_LAYER.includes(file)) continue
    const src = await readSource(file)
    if (src !== undefined && /\bmergeLoreIntoCard\s*\(/u.test(src)) producers.push({ file, src })
  }
  if (producers.length === 0) {
    skipped('世界书保存走 ccv3',
      '还没有组件真正调用 mergeLoreIntoCard —— 世界书编辑器没接线，保存路径无从检查')
  } else {
    let judged = 0
    let mixed = false
    for (const { file, src } of producers) {
      // 任何 save* 调用都算候选（saveCharacter / saveCharacterCcv3 / saveCard / onSaveCard / onSave …）
      let carried = false
      for (const call of src.matchAll(/\b([A-Za-z0-9_$]*[Ss]ave[A-Za-z0-9_$]*)\s*\(/gu)) {
        const paren = src.indexOf('(', call.index)
        const argText = sliceBalanced(src, paren) ?? ''
        if (!/\bccv3\b/u.test(argText)) continue
        judged += 1
        carried = true
        // 混发 card：store.saveCard 以 ccv3 为底、card 覆盖结构（src/store.ts:571-581），
        // character_book 不会被吞——所以这是「契约洁净度」问题而不是丢数据问题，记 note 不判红
        if (/\bcard\s*:/u.test(argText) || /,\s*card\s*[,)]/u.test(argText)) {
          mixed = true
          note(`${file}：${call[1]}(…) 同时带 card 与 ccv3 —— store 以 ccv3 为底、card 覆盖结构，`
            + 'character_book 不会丢（src/store.ts:571-581）；但写法上「一次只发一个键」更不容易被后人改坏')
        }
      }
      if (carried) ok(`${file} 的世界书保存走了 ccv3`)
      else {
        bad(`${file} 的世界书保存走了 ccv3`,
          '这个文件调用了 mergeLoreIntoCard（说明它产世界书），但所有 save* 调用都没带 ccv3 —— '
          + '只发 card 时后端以磁盘旧卡为底重投影，character_book 按原卡保留：用户改的世界书被静默吞掉，'
          + '还提示保存成功。正确写法是整卡回传 { name, ccv3 }（GET /character 拿到的 ccv3，只改 data.character_book）。该找 client-ui')
      }
    }
    if (judged === 0) {
      skipped('世界书保存走 ccv3',
        '调用了 mergeLoreIntoCard 但没找到带 ccv3 的保存调用（可能走的是父组件回调变量），静态判定不了')
    } else if (mixed) {
      skipped('世界书保存载荷不传 card 键（洁净度）',
        '实现选择了混发 card + ccv3。按现有 store 语义不丢数据，故不判失败；但若以后有人把 base 改成磁盘旧卡就会复发，'
        + '建议与 client 注释里写的「两步发、不混」对齐口径（Lead 定夺）')
    } else {
      ok('世界书保存载荷不传 card 键', '一次只发一个键，符合 C7')
    }
  }
}

// ================================================================ 8. 产物 vs 源码
head('[8] 产物 · lib/prompt.js 里的纪律包与源码一致（build 漂移检查）')
{
  /**
   * 为什么查这个：纪律包是「每轮都进系统提示词」的文本，`tsc` 对模板串的处理、
   * 以及「改了 src 却没重编」这两种情况，前面七组都看不见——它们只读源码。
   * 这里拿产物反查一遍：段名进没进产物、lite/full 文本与源码是否逐字一致。
   *
   * 判定要保守：产物比源码旧 = 还没 build（正常研发态），[skip] 不报红；
   * 只有「产物是新的、内容却和源码不一样」才是真漂移。
   */
  const srcPrompt = await readSource('src/prompt.ts')
  const libPrompt = await readSource('lib/prompt.js')

  if (srcPrompt === undefined) {
    bad('src/prompt.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else if (libPrompt === undefined) {
    skipped('lib/prompt.js 里的纪律包与源码一致', '还没 build（lib/prompt.js 不存在）')
  } else {
    let fresh
    try {
      const [a, b] = await Promise.all([stat(join(root, 'src/prompt.ts')), stat(join(root, 'lib/prompt.js'))])
      fresh = b.mtimeMs + 1000 >= a.mtimeMs
    } catch {
      fresh = undefined
    }
    if (fresh === false) {
      skipped('lib/prompt.js 里的纪律包与源码一致',
        'lib/prompt.js 比 src/prompt.ts 旧：还没重新 build，等 C2 全量构建后再查（这不是失败）')
    } else if (fresh === undefined) {
      skipped('lib/prompt.js 里的纪律包与源码一致', '拿不到文件时间戳，无法判断产物新旧')
    } else {
      if (libPrompt.includes('aiwu:discipline')) {
        ok('产物里有 aiwu:discipline 段名')
      } else {
        bad('产物里有 aiwu:discipline 段名',
          'lib/prompt.js 里找不到 aiwu:discipline —— 产物是旧的或段没被编译进去，宿主加载后纪律包等于不存在。'
          + '先重新 build（npm run build）；仍缺就是 host-core 的段注册没写进 install()')
      }

      // 去空白后逐字比：tsc 会保留模板串（target ES2022），缩进/换行位置差异不该算漂移
      const squash = (value) => value.replace(/\s+/gu, '')
      for (const name of ['DISCIPLINE_TEXT', 'DISCIPLINE_FULL_TEXT']) {
        const fromSource = readConstText(srcPrompt, name)
        const fromLib = readConstText(libPrompt, name)
        const label = `${name} 产物与源码逐字一致`
        if (fromSource === undefined) {
          // 源码没有这个常量：[4] 已经报过，这里只提示产物不该独有
          if (fromLib !== undefined) note(`产物里有 ${name} 但源码没有——产物比源码新？先重新 build`)
          continue
        }
        if (fromLib === undefined) {
          bad(label,
            `lib/prompt.js 里找不到 ${name} 的字符串内容 —— 要么没重新 build，要么产物里不是字面量。该找 host-core 复核 emit`)
        } else if (squash(fromSource.text) === squash(fromLib.text)) {
          ok(label, `${fromLib.text.length} 字符`)
        } else {
          bad(label,
            `源码 ${fromSource.text.length} 字符 vs 产物 ${fromLib.text.length} 字符，内容不一致 —— `
            + '改了 src/prompt.ts 却没重新 build，或者 emit 把文本改写了。纪律包每轮都进提示词，'
            + '差的这一段会直接说话，必须先对齐产物再发版。该找 host-core / 重跑 npm run build')
        }
      }
    }
  }
}

// ================================================================ 9. 自创卡 AI 补全
head('[9] 自创角色卡 · AI 补全接线（client arm kind=create → web.ts 读 kind → flow-create.md）')
{
  // 客户端：得有一处真发 kind:'create' 的 arm 调用
  let createFile
  for (const file of clientFiles) {
    const src = await readSource(file)
    if (src !== undefined && /kind\s*:\s*['"]create['"]/u.test(src)) { createFile = file; break }
  }
  if (createFile === undefined) {
    bad('client 里有 kind: \'create\' 的 arm 调用',
      '「让 AI 补全人设」没接线：新建弹层落完骨架卡就结束了，宿主那条 create 通道没人调用，'
      + '用户勾了「AI 补全」也只会得到一张空卡。该找 client-ui（勾选后 POST /distill/arm {kind:\'create\'}）')
  } else {
    const src = (await readSource(createFile)) ?? ''
    if (/armDistill|distillArm|distill\/arm/u.test(src)) {
      ok('client 里有 kind: \'create\' 的 arm 调用', createFile)
    } else {
      bad('client 里有 kind: \'create\' 的 arm 调用',
        `${createFile} 出现了 kind:'create' 但同文件看不到对 arm 的调用（armDistill / ROUTES.distillArm / distill/arm）——`
        + '像是只写了类型或常量，没真发请求。该找 client-ui')
    }
  }

  // 宿主：arm 路由得读 kind
  const web = await readSource('src/web.ts')
  if (web === undefined) {
    bad('src/web.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const block = sliceRoute(web, '/distill/arm')
    if (block === undefined) {
      bad('web.ts 的 arm 路由读 kind', '找不到 POST /distill/arm 路由块 —— 该找 host-core')
    } else if (!/\bkind\b/u.test(block)) {
      bad('web.ts 的 arm 路由读 kind',
        'arm 路由不读 kind 参数：前端传 kind:\'create\' 会被忽略，仍然武装成蒸馏模式，'
        + 'AI 拿到的还是 flow.md（「从作品蒸馏」手册），补全流程会跑偏。该找 host-core')
    } else {
      // kind 的取值校验可能落在 web.ts，也可能落在 distill.ts（arm(ttl, kind)），两处都认
      const distill = (await readSource('src/distill.ts')) ?? ''
      const knowsCreate = /create/u.test(web) || /['"]create['"]/u.test(distill)
      if (!knowsCreate) {
        bad('web.ts 的 arm 路由读 kind',
          'arm 路由提到了 kind，但全项目（src/web.ts 与 src/distill.ts）都没有 create 这个取值 —— '
          + 'kind 可能只透传了 distill，create 分支没实现。该找 host-core')
      } else {
        ok('web.ts 的 arm 路由读 kind')
      }
    }
  }

  // 执行手册：flow-create.md
  let flowSize
  try {
    flowSize = (await stat(join(root, 'distill', 'flow-create.md'))).size
  } catch {
    flowSize = undefined
  }
  if (flowSize === undefined) {
    bad('distill/flow-create.md 存在',
      '没有这份执行手册：create 模式下 AI 没有可执行的流程说明，只能瞎编。'
      + '该找 host-core（照着 distill/flow.md 的结构写「骨架卡补全」手册：先问 3-5 个问题 → 按 CCv3 补字段 → 不编造标 [待补] → awu_card_save overwrite:true）')
  } else if (flowSize <= 2000) {
    bad('distill/flow-create.md 大于 2000 字节',
      `实际 ${flowSize} 字节：太短，装不下一份能约束住模型的执行手册（flow.md 是它的同构参照）。该找 host-core`)
  } else {
    ok('distill/flow-create.md 大于 2000 字节', `${(flowSize / 1024).toFixed(1)} KB`)
  }
}

// ================================================================ 10. 世界书软警告
head('[10] 世界书超限改软警告（tavern 不抛错 → web save 返回 warnings → client 类型收 warnings）')
{
  const tavern = await readSource('src/tavern.ts')
  if (tavern === undefined) {
    bad('src/tavern.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const hasCollect = /export\s+function\s+collectCardWarnings|const\s+collectCardWarnings/u.test(tavern)
    // 逐段看：bookEntry / bookTotal 的上限判断里还有没有 throw
    const throwsOnBook = []
    for (const m of tavern.matchAll(/CARD_HARD_LIMITS\.(bookEntry|bookTotal)/gu)) {
      const window = tavern.slice(Math.max(0, m.index - 400), m.index + 600)
      if (/throw\s+new Error/u.test(window)) throwsOnBook.push(m[1])
    }
    if (throwsOnBook.length > 0) {
      bad('tavern 对世界书超限不再抛错',
        `CARD_HARD_LIMITS.${[...new Set(throwsOnBook)].join(' / ')} 附近仍有 throw —— 大卡还是会被硬拦在门外`
        + '（主人那条「世界书总字数超限（98869，上限 20000）：请精简后再保存」就是这么来的）。'
        + '技术依据：世界书注入本来就有预算（12 条 / 6000 字），超大书不会撑爆提示词；'
        + '该改成 collectCardWarnings 产出的软警告，五个原生字段（description 等）继续硬拦。该找 host-core')
    } else {
      ok('tavern 对世界书超限不再抛错', hasCollect ? '已有 collectCardWarnings' : '未见 book 相关 throw')
      if (!hasCollect) note('没看到 collectCardWarnings：警告文案可能写在别处，确认它是单一真源即可')
    }
  }

  const web = await readSource('src/web.ts')
  if (web === undefined) {
    bad('src/web.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const saveBlock = sliceRoute(web, '/character/save')
    if (saveBlock === undefined) {
      bad('save 响应含 warnings', '找不到 POST /character/save 路由块 —— 该找 host-core')
    } else if (!/warnings/u.test(saveBlock)) {
      bad('save 响应含 warnings',
        '/character/save 的响应里没有 warnings：世界书超限即便不再拦，用户也看不到任何提示，'
        + '导入时「保存成功但设定被截」会变成无声的事故。该找 host-core')
    } else {
      ok('save 响应含 warnings')
    }
  }

  const api = (await readSource('client/api.ts')) ?? ''
  if (api === '') {
    bad('client/api.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else {
    // 保存函数的返回类型里要带上 warnings（可以直接写，也可以引用一个含 warnings 的结果类型）
    const sig = [...api.matchAll(/export\s+function\s+saveCharacter[A-Za-z0-9_]*\s*\(/gu)]
      .map(m => api.slice(m.index, api.indexOf('{', m.index + m[0].length)))
    const typeWithWarnings = /interface\s+Save[A-Za-z0-9_]*Result[^{]*\{[\s\S]{0,400}?warnings/u.test(api)
      || /type\s+Save[A-Za-z0-9_]*Result\s*=[\s\S]{0,400}?warnings/u.test(api)
    if (sig.length === 0) {
      bad('client 保存返回类型含 warnings', 'client/api.ts 里找不到 saveCharacter* 函数 —— 该找 client-ui 确认保存入口改了什么')
    } else if (sig.some(text => /warnings/u.test(text)) || typeWithWarnings) {
      ok('client 保存返回类型含 warnings')
    } else {
      bad('client 保存返回类型含 warnings',
        'saveCharacter* 的返回类型没有 warnings：面板拿不到警告就没法展示「设定超出预算」这类提示，'
        + 'TS 还会把后端多出来的字段当不存在。该找 client-ui')
    }
  }
}

// ================================================================ 11. 提示条自动消失
head('[11] 提示条自动消失（notice 计时器 + 清理 + 可关闭）')
{
  const src = await readSource('client/index.tsx')
  const text = (await readSource('client/text.ts')) ?? ''
  if (src === undefined) {
    bad('client/index.tsx 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else {
    // 计时器：某个 setTimeout 的上下文里得提到 notice
    let timer = false
    for (const m of src.matchAll(/setTimeout\s*\(/gu)) {
      const window = src.slice(Math.max(0, m.index - 400), m.index + 600)
      if (/setNotice|notice/iu.test(window)) { timer = true; break }
    }
    const clears = /clearTimeout\s*\(/u.test(src)
    if (!timer) {
      bad('notice 有自动消失计时器',
        '提示条没有计时器：设了就一直在（主人原文「提示条常驻不消失」）。'
        + '该找 client-ui（成功类 5 秒自动消失；错误类留待手动关；新提示覆盖旧计时器）')
    } else if (!clears) {
      bad('notice 有自动消失计时器',
        '有 setTimeout 但全文件没有 clearTimeout：新提示覆盖旧提示时旧计时器还在跑，会把新提示提前清掉。该找 client-ui')
    } else {
      ok('notice 有自动消失计时器', 'setTimeout + clearTimeout 都在')
    }

    // 可关闭：notice 专属文案 key，或一个直接 setNotice('') 的按钮
    // （通用 `common.close` 不算：仓库里本来就有，用它判绿等于没判）
    const hasKey = /['"`]notice\.(close|dismiss|hide)[A-Za-z0-9_.]*['"`]/u.test(text)
    const hasButton = /onClick=\{\(\)\s*=>\s*setNotice\(['"]{2}\)\}/u.test(src)
    if (hasKey || hasButton) {
      ok('提示条有可关闭入口')
    } else {
      bad('提示条有可关闭入口',
        '提示条没有专门的可关闭入口（既没有 notice.close 之类的文案 key，也没有直接 setNotice(\'\') 的按钮）：'
        + '自动消失失效时用户只能刷新页面。该找 client-ui')
    }
  }
}

// ================================================================ 12. 按钮文案与同级
head('[12] 「自创角色卡」文案与同级（中英各一 + 与「蒸馏角色卡」同一工具栏）')
{
  const text = await readSource('client/text.ts')
  if (text === undefined) {
    bad('client/text.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else {
    // 中文文案：找到「自创角色卡」所在的 key，再去英文字典里看同名 key 的值是不是英文
    const zhHit = /['"]([A-Za-z0-9_.]+)['"]\s*:\s*['"]自创角色卡['"]/u.exec(text)
    if (zhHit === null) {
      const stillOld = /['"]roster\.new['"]\s*:\s*['"]新建角色['"]/u.test(text)
      bad('中文文案「自创角色卡」',
        '没有「自创角色卡」这条文案'
        + (stillOld ? '（`roster.new` 还是「新建角色」）' : '')
        + '：主人要的是和「蒸馏角色卡」对仗的名字。该找 client-ui（连同英文一起改）')
    } else {
      const key = zhHit[1]
      const occurrences = [...text.matchAll(new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]\\s*:\\s*['"]([^'"]*)['"]`, 'gu'))]
      const english = occurrences.map(m => m[1]).find(value => !/[\u4e00-\u9fff]/u.test(value))
      if (english === undefined) {
        bad('英文文案与中文对齐',
          `key \`${key}\` 只有中文值：英文界面会裸显 key 或回落到中文。该找 client-ui（中英双字典都补）`)
      } else {
        ok('中英文案齐全', `「自创角色卡」/「${english}」= ${key}`)
      }
    }

    // 同级：两个按钮得在同一段 JSX / 同一工具栏容器里
    const index = await readSource('client/index.tsx')
    if (index === undefined) {
      bad('client/index.tsx 可读', '文件不存在或读不到 —— 该找 client-ui')
    } else {
      const createKey = zhHit?.[1]
      if (createKey === undefined) {
        // 文案还没改就别判同级：拿旧 key 顶上去只会得到一个假的绿点
        skipped('与「蒸馏角色卡」同级', '「自创角色卡」文案还不存在（见上一条），同级关系等文案落地后再判')
      } else {
        const createPattern = new RegExp(`t\\(\\s*['"]${createKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]`, 'u')
        const at = (re) => { const m = re.exec(index); return m === null ? undefined : m.index }
        const createAt = at(createPattern)
        // 「蒸馏角色卡」按钮在 distill.tsx 的 DistillEntry 里，index.tsx 只负责挂载它 —— 两种写法都认
        const distillAt = at(/<DistillEntry|t\(\s*['"]distill\.entry['"]/u)
        if (createAt === undefined) {
          bad('「自创角色卡」按钮在面板里',
            'index.tsx 里找不到引用「自创角色卡」文案的按钮 —— 文案加了但界面还在用旧 key。该找 client-ui')
        } else if (distillAt === undefined) {
          bad('与「蒸馏角色卡」同级',
            'index.tsx 里既找不到 <DistillEntry> 也找不到 t(\'distill.entry\') —— 同级判断没有参照物。'
            + '该找 client-ui 确认蒸馏入口是否被挪走或改名')
        } else {
          const from = Math.min(createAt, distillAt)
          const to = Math.max(createAt, distillAt)
          const between = index.slice(from, to)
          const sameContainer = between.length <= 2500 || /awu-toolbar|awu-railActions|awu-btnRow/u.test(between)
          if (sameContainer) {
            ok('与「蒸馏角色卡」同级', `两者相距 ${between.length} 字符`)
          } else {
            bad('与「蒸馏角色卡」同级',
              `「自创角色卡」与「蒸馏角色卡」相距 ${between.length} 字符，中间还夹着别的区块 —— `
              + '主人要的是同一行同级并排（原来一大一小）。该找 client-ui')
          }
          // 尺寸一致：只记提醒，不判红（JSX 结构可能用数据属性从父级继承）
          const createBtn = index.slice(createAt, createAt + 400)
          const distillBtn = index.slice(distillAt, distillAt + 400)
          const sizeOf = (chunk) => (/(data-size="(sm|md)")/u.exec(chunk)?.[1] ?? '未标')
          const [a, b] = [sizeOf(createBtn), sizeOf(distillBtn)]
          if (a !== b) note(`尺寸可能不一致：「自创角色卡」${a} vs 「蒸馏角色卡」${b}（人眼过一遍真机）`)
        }
      }
    }
  }
}

// ================================================================ 13. mode 三段契约
head('[13] 对话模式无目标不报错（POST /mode 三段：有启用→session / 带 name→该角色 / 都没有→全局兜底）')
{
  const web = await readSource('src/web.ts')
  const block = web === undefined ? undefined : sliceRoute(web, '/mode')
  if (web === undefined) {
    bad('src/web.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else if (block === undefined) {
    bad('POST /mode 路由定位', '找不到 `${ROUTE_PREFIX}/mode` 路由块 —— 模式接口改名了？该找 host-core')
  } else {
    // ① 不能再走会抛错的硬解析：resolveName 在没有 name 且没启用角色时直接 throw
    const hardResolve = /resolveName\s*\(/u.test(block)
    const throwOnMissing = /缺少角色名|没有启用角色/u.test(block)
    if (hardResolve || throwOnMissing) {
      bad('mode 无目标时不抛错',
        (hardResolve ? '路由仍在用 resolveName(body)：' : '路由里还有「缺少角色名 / 没有启用角色」的报错：')
        + '没启用角色、也没指定 name 时会直接 400。面板工具栏的模式胶囊正是这种场景'
        + '（主人第 4 条验收：不启用角色也要能切模式），点下去就报错 = 看着修了、实际没修。'
        + '契约：都没有目标时只写全局兜底 `_active.mode`，不写 session、不报错。该找 host-core')
    } else {
      ok('mode 无目标时不抛错', '没有走 resolveName 的硬解析')
    }

    // ② 返回值要能区分作用域
    const hasScope = /\bscope\b/u.test(block) && /global/u.test(block)
    if (hasScope) {
      ok('mode 返回 scope 区分作用域', '含 global 分支')
    } else {
      bad('mode 返回 scope 区分作用域',
        '响应里没有 scope 字段（契约：都要写全局兜底时返回 {ok, mode, scope:\'global\'}）—— '
        + '面板无法区分「真切了这张卡」还是「只改了全局偏好」，提示文案只能瞎猜。该找 host-core')
    }

    // ③ 全局兜底得真的写下去
    if (/prompt\.setMode\s*\(|setMode\s*\(\s*mode/u.test(block)) {
      ok('mode 无目标时写全局兜底', 'prompt.setMode 在路由块里')
    } else {
      bad('mode 无目标时写全局兜底',
        '路由块里看不到 prompt.setMode(mode)：没有目标角色时模式偏好就落不了盘，胶囊点了等于没点。该找 host-core')
    }
  }
}

// ================================================================ 14. 补全按名覆盖
head('[14] 补全手册的名字约束（flow-create.md 必须钉死「按给定名字 + overwrite 覆盖」）')
{
  let flow
  try {
    flow = await readFile(join(root, 'distill', 'flow-create.md'), 'utf8')
  } catch {
    flow = undefined
  }
  if (flow === undefined) {
    skipped('flow-create.md 钉死按给定名字保存', '文件还不存在（见 [9]），建好后再判')
  } else {
    // ① 名字一致性口径：别让模型按自己推断的名字落盘
    const namesPinned = /以[^\n]{0,14}名字[^\n]{0,8}为准|保持原名|不要改名|禁止改名|别改名|卡名[^\n]{0,10}为准/u.test(flow)
      || (/骨架卡名字|指令里给的名字|给定的名字/u.test(flow) && /名字/u.test(flow))
    if (namesPinned) {
      ok('flow-create.md 钉死按给定名字保存')
    } else {
      bad('flow-create.md 钉死按给定名字保存',
        '手册里没有「卡名以给定/面板名字为准、不许改名」这类硬约束：AI 很容易按自己推断的更好听的名字落盘，'
        + '`awu_card_save` 的 overwrite 按名字匹配 → 结果是**多出一张壳卡**，而原来那张骨架卡还是空的。'
        + '该找 host-core（在流程开头写死「必须用指令里给的骨架卡名字」）')
    }

    // ② 覆盖而非新建
    const overwritePinned = /overwrite["'\s:]{0,8}true/u.test(flow) && /覆盖同名|覆盖[^\n]{0,8}骨架|不是新建/u.test(flow)
    if (overwritePinned) {
      ok('flow-create.md 要求 overwrite:true 覆盖同名骨架卡')
    } else {
      bad('flow-create.md 要求 overwrite:true 覆盖同名骨架卡',
        '没有把「带 overwrite:true 覆盖同名骨架卡（不是新建）」写清楚：不带会被工具拒成 name-conflict，'
        + '或者模型退回新建，收尾就变成「角色簿里两张同名卡」。该找 host-core')
    }
  }
}

// ================================================================ 15. 提示词预览器
head('[15] 注入预览器接线（web.ts /preview → 用真实渲染函数 → client 有路由与展示）')
{
  const web = await readSource('src/web.ts')
  const webPreview = web === undefined ? undefined : sliceRoute(web, '/preview')
  if (web === undefined) {
    bad('src/web.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else if (webPreview === undefined) {
    bad('web.ts 有 /preview 路由',
      '宿主没有注册 `${ROUTE_PREFIX}/preview`：面板的「注入预览」拿不到数据，只能自己瞎猜提示词长什么样。'
      + '该找 host-core（GET /preview 返回各段的段名 / 字符数 / 正文）')
  } else {
    ok('web.ts 有 /preview 路由')

    // 预览必须复用真实渲染函数，否则「预览」和「实际注入」是两套文本，等于没有预览
    const promptSrc = await readSource('src/prompt.ts')
    const renderRefs = /renderActiveSection|renderBaselineSection|renderLoreSection|renderClockSection|renderDisciplineSection|SECTION_BASELINE|SECTION_DISCIPLINE|SECTION_ACTIVE|renderL1/u
    const inWeb = renderRefs.test(webPreview)
    const inPrompt = promptSrc !== undefined && /preview/iu.test(promptSrc) && renderRefs.test(promptSrc)
    if (inWeb || inPrompt) {
      ok('预览用的是真实渲染路径', inWeb ? '/preview 路由块里直接引用段渲染' : 'prompt.ts 里有预览入口且引用段渲染')
    } else if (promptSrc !== undefined && /preview/iu.test(promptSrc)) {
      bad('预览用的是真实渲染路径',
        'prompt.ts / web.ts 里出现了 preview，但看不到对真实段渲染的引用（SECTION_* / render*Section / renderL1）—— '
        + '预览可能另写了一套拼装逻辑，那样它显示的和实际注入的迟早漂移。该找 host-core')
    } else {
      bad('预览用的是真实渲染路径',
        'prompt.ts 与 web.ts 都没有「预览 + 真实渲染」的接法：预览接不上真实提示词，等于给用户看假数据。该找 host-core')
    }
  }

  const api = (await readSource('client/api.ts')) ?? ''
  const text = (await readSource('client/text.ts')) ?? ''
  if (api === '') {
    bad('client/api.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else if (!api.includes('/preview')) {
    bad('client 有 /preview 调用与展示',
      'client/api.ts 里没有 preview 路由常量/调用：面板的注入预览点了没反应。该找 client-ui')
  } else {
    const routeKey = /([A-Za-z0-9_$]+)\s*:\s*['"`]\/preview['"`]/u.exec(api)?.[1]
    let owner
    if (routeKey !== undefined) {
      const useAt = api.indexOf(`ROUTES.${routeKey}`)
      if (useAt >= 0) owner = enclosingExportName(api, useAt)
    }
    if (owner === undefined) owner = enclosingExportName(api, api.indexOf('/preview'))
    const user = owner === undefined ? undefined : await findClientUser(owner, ['client/api.ts'], clientFiles)
    const hasUi = /['"`]preview\.[A-Za-z0-9_.]+['"`]/u.test(text)
    if (owner !== undefined && user !== undefined) {
      ok('client 有 /preview 调用与展示', `${owner}() ← ${user}`)
    } else if (owner !== undefined) {
      bad('client 有 /preview 调用与展示',
        `client/api.ts 导出了 ${owner}() 但没有被任何组件调用：预览接口通了，界面上没有入口。该找 client-ui`)
    } else if (!hasUi) {
      bad('client 有 /preview 调用与展示',
        'client/api.ts 里有 /preview 字符串但看不出封装函数，也没有 preview.* 文案 key：预览入口未接。该找 client-ui')
    } else {
      skipped('client 有 /preview 调用与展示', '有 preview.* 文案 key 但静态看不出 api 封装（可能走了通用 request）')
    }

    // 文案 key 是否真的在字典里：组件写了 t('preview.xxx') 但 text.ts 没这个 key，
    // 用户看到的就是 `preview.activeLabel` 这种裸 key（makeTranslator 会 fallback 到 key 本身）。
    // 这类「组件接了、文案没接」的问题类型检查和渲染都不会报错。
    // 扫**所有** client 文件取并集：预览面板可能被好几个组件引用（入口、章节、空态）。
    const usedKeys = new Set()
    const usedIn = []
    for (const file of clientFiles) {
      const src = await readSource(file)
      if (src === undefined) continue
      const keys = [...src.matchAll(/t\(\s*['"](preview\.[A-Za-z0-9_.]+)['"]/gu)].map(m => m[1])
      if (keys.length === 0) continue
      usedIn.push(file)
      for (const key of keys) usedKeys.add(key)
    }
    const used = [...usedKeys].sort()
    if (used.length === 0) {
      skipped('预览文案 key 在字典里（中英各一）', '还没找到用 preview.* 文案的组件')
    } else {
      const missing = used.filter(key => {
        // 字典里同一个 key 会出现两次（zh + en）；只出现一次说明只补了一半
        const hits = text.split(`'${key}'`).length - 1
        return hits < 2
      })
      if (missing.length === 0) {
        ok('预览文案 key 在字典里（中英各一）', `${used.length} 个 key，来自 ${usedIn.join(' / ')}`)
      } else {
        bad('预览文案 key 在字典里（中英各一）',
          `${usedIn.join(' / ')} 共用了 ${used.length} 个 preview.* key，但 client/text.ts 里缺 ${missing.length} 个（中英各一才算齐）：`
          + `${missing.slice(0, 6).join('、')}${missing.length > 6 ? ' …' : ''}。`
          + 'makeTranslator 找不到就回落成 key 本身，界面上会直接裸显 `preview.activeLabel` 这种字样。该找 client-ui')
      }
    }
  }
}

// ================================================================ 16. 宿主拖放复位
head('[16] 宿主拖放状态复位（吞 drop 后补 dragend + 捕获阶段拦 dragenter + 监听随面板卸载）')
{
  const src = await readSource('client/index.tsx')
  if (src === undefined) {
    bad('client/index.tsx 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else {
    // ① 复位动作至少两处：吞 drop 的路径 + 关闭时的 cleanup。
    //    dispatchEvent 本体与封装函数调用分开数，封装函数自己的定义行不算调用点。
    const lines = src.split('\n')
    const triggers = lines.filter(line => /dispatchEvent\(\s*new\s+Event\(\s*['"]dragend['"]/u.test(line)
      || (/\bresetHostDropState\s*\(\s*\)/u.test(line) && !/=>|function|const\s+resetHostDropState/u.test(line)))
    if (triggers.length === 0) {
      bad('吞掉 drop 后补发 dragend 复位（两处：吞 drop 路径 + 关闭 cleanup）',
        'client 里既没有 `dispatchEvent(new Event(\'dragend\'))` 也没有 `resetHostDropState()`。'
        + '宿主是文档级深度计数器（dragenter +1 / dragleave -1 / drop reset / window 的 dragend reset）：'
        + '我们 stopPropagation 掉 drop 后它的 onDrop 不跑，系统拖入的文件又没有源元素、不派发 dragend，'
        + '计数器永远停在 1 → 遮罩永久卡在「文件或图片拖动到此处即可添加」。这就是主人报的 P0。该找 client-ui')
    } else if (triggers.length === 1) {
      bad('吞掉 drop 后补发 dragend 复位（两处：吞 drop 路径 + 关闭 cleanup）',
        '只找到 1 处复位：「拖进来但没 drop 就把面板关掉」这条路径没人复位，遮罩照样卡。'
        + '该找 client-ui（cleanup 里再补一次 dragend）')
    } else {
      ok('吞掉 drop 后补发 dragend 复位（两处：吞 drop 路径 + 关闭 cleanup）', `${triggers.length} 处`)
    }

    // ② 拦 in-container 的 dragenter，让宿主计数器根本不 +1
    const enterCalls = [...src.matchAll(/addEventListener\(\s*['"]dragenter['"]/gu)]
    const captureEnter = enterCalls.filter(m => /,\s*true\s*\)|capture\s*:\s*true/u.test(src.slice(m.index, m.index + 160)))
    if (enterCalls.length === 0) {
      bad('dragenter 也在捕获阶段拦下',
        '没有监听 dragenter：宿主在 document 上一 dragenter 就 +1 并亮遮罩，我们只拦 drop 等于「先让它亮、再强行不放」，'
        + '每次都得靠复位兜底，多一层脆弱。该找 client-ui（文件类 dragenter 同样 stopPropagation）')
    } else if (captureEnter.length === 0) {
      bad('dragenter 也在捕获阶段拦下',
        '监听了 dragenter 但不在捕获阶段（缺 `true` 或 `{capture:true}`）：宿主在 document 上按冒泡顺序监听，'
        + '我们冒泡阶段拦等于拦在自己后面，计数器已经 +1。该找 client-ui')
    } else {
      ok('dragenter 也在捕获阶段拦下', `${captureEnter.length} 处`)
    }

    // ③ 闭环的关键（Lead 点名要独立质疑的一条）：监听必须随面板/弹层卸载。
    //    常驻监听 + capture + stopPropagation = 宿主从此再也收不到文件拖放，比遮罩卡死更糟。
    const dragEnterAt = enterCalls[0]?.index
    if (dragEnterAt === undefined) {
      skipped('document 监听随面板卸载', '还没有 dragenter 监听可判（见上一条）')
    } else {
      const effectAt = src.slice(0, dragEnterAt).lastIndexOf('useEffect(')
      const tail = effectAt < 0 ? '' : src.slice(effectAt, dragEnterAt + 3000)
      const cleans = /removeEventListener\(\s*['"]dragenter['"]/u.test(tail)
      const guarded = /if\s*\(\s*!?\s*(open|dialog)\b/u.test(tail) || /\[\s*(open|dialog)\b[^\]]*\]/u.test(tail)
      if (cleans && guarded) {
        ok('document 监听随面板卸载', '有 open/dialog 守卫 + removeEventListener 清理')
      } else if (!cleans) {
        bad('document 监听随面板卸载',
          '挂了 document 级监听但没有 removeEventListener：监听会一直留在 document 上，配合 capture + stopPropagation，'
          + '**面板关掉之后宿主彻底收不到文件拖放**——这比遮罩卡死更糟。该找 client-ui')
      } else {
        bad('document 监听随面板卸载',
          '有清理，但看不出这个 effect 依赖面板开关（没有 `if (open/dialog)` 守卫或依赖数组）：'
          + '监听可能常驻，同样会把宿主的拖放永久挡掉。该找 client-ui')
      }
    }
  }
}

// ================================================================ 17. 记忆回顾
head('[17] 记忆回顾（日记搜索 / 按月折叠 / 导出 markdown）')
{
  const text = (await readSource('client/text.ts')) ?? ''
  const parts = []
  for (const file of clientFiles) {
    const src = await readSource(file)
    if (src !== undefined) parts.push(src)
  }
  const all = parts.join('\n')

  // ① 导出 markdown：要有真正生成文件的代码，不能只有文案
  const exportTech = /URL\.createObjectURL|new Blob\(|\.download\s*=/u.test(all)
  const exportText = /导出|['"`][A-Za-z0-9_.]*[Ee]xport[A-Za-z0-9_.]*['"]/u.test(text)
  if (exportTech && exportText) {
    ok('有导出 markdown 的实现（Blob / 下载链接 + 文案）')
  } else if (exportText) {
    bad('有导出 markdown 的实现（Blob / 下载链接 + 文案）',
      '有导出文案但没有生成文件的代码（`new Blob(` / `URL.createObjectURL` / `a.download`）：按钮点了没东西落地。该找 client-ui')
  } else {
    bad('有导出 markdown 的实现（Blob / 下载链接 + 文案）',
      '看不到「导出日记」整条链路（文案 key 与文件生成代码都没有）：记忆回顾少了把档案拿出去的能力。该找 client-ui')
  }

  // ② 搜索 + 按月折叠
  const hasSearch = /['"`][A-Za-z0-9_.]*[Ss]earch[A-Za-z0-9_.]*['"]\s*:/u.test(text)
    || /placeholder=\{[^}]*search/iu.test(all)
  const hasMonth = /groupByMonth|monthKey|byMonth|按月|月份/u.test(all)
    || /['"`][A-Za-z0-9_.]*[Mm]onth[A-Za-z0-9_.]*['"]/u.test(text)
  if (hasSearch && hasMonth) {
    ok('有日记搜索与按月折叠')
  } else if (!hasSearch) {
    bad('有日记搜索与按月折叠',
      '找不到日记搜索（没有 search 文案 key，也没有 search 输入框）：日记一多只能靠肉眼翻。该找 client-ui')
  } else {
    bad('有日记搜索与按月折叠',
      '有搜索但没有按月折叠的痕迹（无 groupByMonth / monthKey / 月份 文案 key）：长档案还是连续平铺。该找 client-ui')
  }
}

// ================================================================ 18. 常驻预算分离
head('[18] 常驻条目独立预算（constant allowance，不再和关键词命中抢同一口 6000 字）')
{
  const tavern = await readSource('src/tavern.ts')
  if (tavern === undefined) {
    bad('src/tavern.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    // ① 有常驻专属预算
    const constantBudget = /constantBudgetChars|constantBudget|constantAllowance|constantChars/u.test(tavern)
    if (constantBudget) {
      ok('tavern 有常驻专属预算')
    } else {
      bad('tavern 有常驻专属预算',
        '找不到常驻专属预算（constantBudgetChars 之类）：`constant: true` 的条目只能和关键词命中共用同一个 6000 字预算。'
        + '真卡实测 7 条常驻共 10512 字 → 2 条被静默裁掉，而常驻条目本来就是「必须一直生效」的那类，被裁是最难察觉的失效。'
        + '该找 host-core（常驻单独给一份 allowance，且优先于关键词命中占预算）')
    }

    // ② 诊断里要把「被裁」拆成两类，否则用户/日志分不清是谁抢了预算
    if (/constantDropped/u.test(tavern) && /keywordDropped/u.test(tavern)) {
      ok('diag 分开了 constantDropped / keywordDropped')
    } else if (/droppedByBudget/u.test(tavern)) {
      bad('diag 分开了 constantDropped / keywordDropped',
        '只有笼统的 `droppedByBudget`：分不清被裁的是常驻还是命中条目，面板和日志都没法给出可执行的解释。'
        + '该找 host-core（diagnostics 里拆成 constantDropped 与 keywordDropped）')
    } else {
      bad('diag 分开了 constantDropped / keywordDropped',
        'diagnostics 里看不到任何「被裁条目」的记录：超出预算的条目会彻底消失，用户只会觉得「设定怎么没生效」。该找 host-core')
    }
  }

  // ③ 日志要带上被裁条目名（只记条数等于什么都没记）
  const promptSrc = await readSource('src/prompt.ts')
  if (promptSrc === undefined) {
    bad('src/prompt.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else if (/constantDropped|keywordDropped|droppedByBudget/u.test(promptSrc)) {
    ok('世界书日志会带被裁条目名')
  } else {
    bad('世界书日志会带被裁条目名',
      'prompt.ts 的世界书日志没有引用任何「被裁」列表：预算不足时日志里只有命中条数，用户与维护者都不知道少了哪几条。'
      + '该找 host-core（日志带上 constantDropped / keywordDropped 的名字，正文仍不记）')
  }
}

// ================================================================ 19. key 宏展开
head('[19] key 匹配前展开宏（{{user}} / {{char}} 写在关键词里也能命中）')
{
  const tavern = await readSource('src/tavern.ts')
  if (tavern === undefined) {
    bad('src/tavern.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    // matchesKey 的函数体（用括号配对取，别写行号）
    const defAt = /function\s+matchesKey\s*\(/u.exec(tavern)
    let body = ''
    if (defAt !== null) {
      const braceAt = tavern.indexOf('{', defAt.index + defAt[0].length)
      body = braceAt < 0 ? '' : (sliceBalanced(tavern, braceAt) ?? '')
    }
    if (defAt === null) {
      bad('matchesKey 可定位', 'src/tavern.ts 里找不到 function matchesKey —— 匹配函数改名了？该找 host-core')
    } else {
      const expandsInMatch = /expandMacros/u.test(body)
      // 也允许在调用点展开（matchesKey(expandMacros(key, ctx), …)）
      const callSites = [...tavern.matchAll(/matchesKey\s*\(/gu)]
        .filter(m => !/function\s*$/u.test(tavern.slice(Math.max(0, m.index - 20), m.index)))
      const expandsAtCall = callSites.some(m => /expandMacros/u.test(tavern.slice(m.index, m.index + 160)))
      // 也允许「先把 key 列表整体展开再传进来」——这是比函数内展开更省事的写法：
      // 一个 expandKeyList(keys, ctx) 同时覆盖主 key 与 secondary_keys（本轮 D 的实现就是这种）。
      const keyListHelper = /function\s+expandKey\w*\s*\(/u.test(tavern)
        || /expandMacros\(\s*key\b|key\s*=>\s*expandMacros\(/u.test(tavern)
      const helperWired = keyListHelper
        && /expandKey\w*\(\s*entry\.keys|expandKey\w*\(\s*keys/u.test(tavern)
      if (expandsInMatch || expandsAtCall || helperWired) {
        ok('key 在匹配前展开宏',
          expandsInMatch ? 'matchesKey 内部展开' : expandsAtCall ? '调用点展开' : '先把 key 列表整体展开（expandKeyList）')
      } else {
        bad('key 在匹配前展开宏',
          'matchesKey 拿到的是**原始 key 字符串**：卡里把关键词写成 `{{user}}`（酒馆卡里很常见）时，'
          + '匹配文本里是展开后的用户名，两边永远对不上 → 该条目永不命中，用户只会觉得「这条设定从来没生效过」。'
          + '该找 host-core（匹配前对 key 走 expandMacros，secondary_keys 同理）')
      }

      // 次级关键词：同一类问题，容易只修主 key 忘了它
      const secAt = /function\s+secondaryPasses\s*\(/u.exec(tavern)
      const secExpandedAtList = /expandKey\w*\(\s*entry\.secondary_keys|expandKey\w*\(\s*secondary/u.test(tavern)
      if (secExpandedAtList) {
        ok('secondary_keys 也展开宏', '在 key 列表层展开（expandKeyList(entry.secondary_keys)）')
      } else if (secAt === null) {
        skipped('secondary_keys 也展开宏', '找不到 secondaryPasses —— 可能改名或内联了')
      } else {
        const secBrace = tavern.indexOf('{', secAt.index + secAt[0].length)
        const secBody = secBrace < 0 ? '' : (sliceBalanced(tavern, secBrace) ?? '')
        const secExpands = /expandMacros/u.test(secBody)
          || [...tavern.matchAll(/secondaryPasses\s*\(/gu)].some(m => /expandMacros/u.test(tavern.slice(m.index, m.index + 200)))
        if (secExpands) ok('secondary_keys 也展开宏', 'secondaryPasses 内部或调用点')
        else if (expandsInMatch || helperWired) note('主 key 已展开，但 secondary_keys 看不到展开：次级关键词含 {{user}} 时仍会永不命中（同一类坑的下一层）')
        else skipped('secondary_keys 也展开宏', '主 key 还没展开，先修上面那条')
      }
    }
  }
}

// ================================================================ 20. 体检分级
head('[20] 世界书体检分级（error / warn / info，且删掉 ST 语义误报的 order-collision）')
{
  const schema = await readSource('client/lorebook-schema.ts')
  if (schema === undefined) {
    bad('client/lorebook-schema.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else {
    // ① issue 带 level（只看 LoreIssue 的接口体，不当全文搜）
    const issueAt = /export\s+interface\s+LoreIssue\s*\{/u.exec(schema)
    const issueBody = issueAt === null ? '' : (sliceBalanced(schema, schema.indexOf('{', issueAt.index)) ?? '')
    const levelType = /export\s+type\s+LoreIssueLevel\s*=\s*([^\n]+)/u.exec(schema)?.[1] ?? ''
    const tiers = ['error', 'warn', 'info'].filter(tier => levelType.includes(tier))
    if (/\blevel\s*:/u.test(issueBody) && tiers.length === 3) {
      ok('issue 类型带 level（三档）', 'error / warn / info')
    } else if (/\blevel\s*:/u.test(issueBody)) {
      bad('issue 类型带 level（三档）',
        `LoreIssue 有 level 字段，但等级类型里只看到 ${tiers.length}/3 档（${tiers.join(' / ') || '无'}）——`
        + '分不清「必须改」和「知道就行」。该找 client-ui')
    } else {
      bad('issue 类型带 level（三档）',
        'LoreIssue 没有 `level`：所有提示都是同一档，用户分不清「必须改」和「知道就行」——'
        + '真卡上 323 条提示里只有 2 条是真问题，其余全是噪音，就是没有分级的直接后果。该找 client-ui')
    }

    // ② order-collision 已删。只看**代码里的字符串字面量**：注释里往往正写着「已删掉 order-collision」，
    //    按裸词搜会把解释性注释当成残留（本轮自己踩过一次）。
    if (/['"]order-collision['"]/u.test(schema) || /code:\s*['"]order-collision/u.test(schema)) {
      bad('order-collision 误报已删',
        '`order-collision` 还在检查表里：酒馆卡的 `insertion_order` 撞车是合法且常见的写法（真卡 22 条同为 20，同序按数组顺序排），'
        + '把它当问题报，一张真卡就能刷出上百条假告警，冲掉真正要看的那两条。该找 client-ui 删掉这条检查')
    } else {
      ok('order-collision 误报已删')
    }
  }

  // ③ 面板要真的**消费** level（只看数据层有 level 不等于界面分了档）
  const editor = (await readSource('client/lorebook-editor.tsx')) ?? ''
  const editorUsesLevel = /issue\.level|data-level=|LEVEL_RANK|\berrors\b|\bwarns\b|\binfos\b/u.test(editor)
  if (editorUsesLevel) {
    ok('面板按三档分组渲染')
  } else {
    bad('面板按三档分组渲染',
      '数据层有 level，但编辑器里看不到任何按等级分组/标注的痕迹（没有 issue.level / data-level / errors·warns·infos）——'
      + '用户看到的还是一条平铺长列表：323 条里那 2 条真问题照样会被埋掉。该找 client-ui（「N 条必须处理 / M 条建议 / K 条提示」分组）')
  }
}

// ================================================================ 21. 不执行但不删
head('[21] 不执行的正则脚本要「保留 + 告警」（ST 卡是用户资产，删字段不可逆）')
{
  const imp = await readSource('src/import-card.ts')
  if (imp === undefined) {
    bad('src/import-card.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    // ① ST 把正则脚本放在 data.extensions.regex_scripts，只认顶层等于没检查
    const knowsStLocation = /extensions[^\n]{0,40}regex_scripts/u.test(imp)
      || /regex_scripts/u.test(imp) && /data\.extensions/u.test(imp)
    if (knowsStLocation) {
      ok('识别 ST 位置 data.extensions.regex_scripts')
    } else {
      bad('识别 ST 位置 data.extensions.regex_scripts',
        'import-card.ts 只认顶层 `data.regex_scripts`：酒馆卡实际把脚本放在 `data.extensions.regex_scripts`，'
        + '于是真卡的脚本既不告警也不被处理，用户以为它在工作。该找 host-core（两个位置都认）')
    }

    // ② 不再删字段：删了将来导出/回灌 ST 就缺东西（Lead 2026-11-01 裁决）
    const deletes = [...imp.matchAll(/delete\s+[^\n]*regex_scripts/gu)].map(m => m[0].trim())
    if (deletes.length === 0) {
      ok('不再 delete regex_scripts（保留字段）')
    } else {
      bad('不再 delete regex_scripts（保留字段）',
        `还在删字段（${deletes.join(' / ')}）：ST 卡是用户资产，删了不可逆——将来导出/回灌酒馆会缺东西。`
        + '「用户以为它在工作」应该用告警 + 面板标注解决，而不是删数据。该找 host-core（保留两个位置，只出告警）')
    }

    // ③ 导入预览要明说「不执行」，且要说清两侧都不做（否则用户会以为是「暂时没接」）
    //   允许引用单一真源常量：警告里插 `${ST_SCRIPT_STANCE}` 比复制一份文案更好，
    //   只要常量本身写清了「不执行 + 正则 + 显示侧」就算满足（上一版判据在这里误报过一次）。
    const tavernSrc = await readSource('src/tavern.ts')
    const stanceText = /export\s+const\s+ST_SCRIPT_STANCE\s*=\s*['"`]([^'"`]+)['"`]/u.exec(tavernSrc ?? '')?.[1] ?? ''
    const stanceCovers = /不执行/u.test(stanceText) && /正则/u.test(stanceText) && /显示侧/u.test(stanceText)
    const warnNear = [...imp.matchAll(/warnings\.push\(\s*[`'"]([^`'"]{0,200})/gu)].map(m => m[1])
    const saysNoExecDirect = warnNear.some(text => /不执行/.test(text) && /正则|regex/u.test(text) && /显示/.test(text))
    const saysNoExecViaStance = warnNear.some(text => /ST_SCRIPT_STANCE/.test(text)) && stanceCovers
    if (saysNoExecDirect || saysNoExecViaStance) {
      ok('导入预览警告说明「不执行酒馆正则脚本（提示词侧与显示侧）」',
        saysNoExecViaStance && !saysNoExecDirect ? '引用 ST_SCRIPT_STANCE 单一真源' : '')
    } else {
      bad('导入预览警告说明「不执行酒馆正则脚本（提示词侧与显示侧）」',
        '没有一条警告说清「不执行 + 正则 + 显示侧」（直接写或引用 ST_SCRIPT_STANCE 都行）：'
        + '只写「已忽略」用户会以为以后会支持；必须写明「提示词侧与显示侧都不执行；显示层 DSH 没有扩展点」。该找 host-core')
    }

    // ④ depth_prompt 保留但不生效，非空时必须提示
    const depthAt = imp.indexOf('depth_prompt')
    if (depthAt < 0) {
      bad('depth_prompt 非空时出警告',
        'import-card.ts 里没有 depth_prompt 的检查：字段随卡留着，但既不生效也不提示，用户会以为深度提示词生效了。该找 host-core')
    } else {
      const window = imp.slice(Math.max(0, depthAt - 500), depthAt + 900)
      if (/warnings\.push/u.test(window)) {
        ok('depth_prompt 非空时出警告')
      } else {
        bad('depth_prompt 非空时出警告',
          '提到了 depth_prompt 但附近没有 warnings.push：警告要么没写、要么写在别处没法判。该找 host-core（非空时提示「保留但不生效」）')
      }
    }
  }
}

// ================================================================ 22. 角色绑定
head('[22] 角色绑定（会话作用域：/bind · 决议优先级 · LRU 上限 · 工具层按会话）')
{
  const web = await readSource('src/web.ts')
  const promptSrc = await readSource('src/prompt.ts')
  const tools = await readSource('src/tools.ts')

  // ① 绑定 / 解绑路由
  if (web === undefined) {
    bad('src/web.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const bind = sliceRoute(web, '/bind')
    const unbind = sliceRoute(web, '/unbind')
    if (bind !== undefined && unbind !== undefined) {
      ok('有 /bind 与 /unbind 路由')
    } else {
      bad('有 /bind 与 /unbind 路由',
        `缺 ${[bind === undefined ? '/bind' : '', unbind === undefined ? '/unbind' : ''].filter(Boolean).join(' 与 ')}：`
        + '「当前会话启用」没有落点，面板只能退回全局启用——两种作用域就会退化成一种。该找 host-core')
    }
  }

  // ② 决议函数同时有 session / global 两个来源
  if (promptSrc === undefined) {
    bad('src/prompt.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const defAt = /resolveTarget\s*\(\s*sessionId/u.exec(promptSrc) ?? /resolveTarget\s*\(/u.exec(promptSrc)
    const braceAt = defAt === null ? -1 : promptSrc.indexOf('{', defAt.index + defAt[0].length)
    const body = braceAt < 0 ? '' : (sliceBalanced(promptSrc, braceAt) ?? '')
    if (defAt === null || body === '') {
      bad('决议函数 resolveTarget 存在',
        'prompt.ts 里找不到 resolveTarget 这类「按会话决议角色」的函数：每个段/工具各自算一遍，迟早算出不同答案。该找 host-core')
    } else {
      const hasSession = /source:\s*'session'/u.test(body) || /\bbindings\s*\[/u.test(body)
      const hasGlobal = /source:\s*'global'/u.test(body)
      if (hasSession && hasGlobal) {
        ok('决议同时覆盖会话绑定与全局启用')
      } else {
        bad('决议同时覆盖会话绑定与全局启用',
          `决议函数里${hasSession ? '' : '没看到会话绑定分支'}${!hasSession && !hasGlobal ? '、' : ''}${hasGlobal ? '' : '没看到全局兜底分支'}：`
          + '优先级必须写死成「会话绑定 > 全局启用 > 未启用」，两条来源缺一条就会串台。该找 host-core')
      }

      // ③ 出错方向必须安全：绑卡被删 → 该会话未启用，**不回退全局**
      const deadHandled = /deadSlots/u.test(promptSrc) && /deadSlots\.has\s*\(/u.test(body) && /source:\s*'none'/u.test(body)
      if (deadHandled) {
        ok('绑卡被删时不回落全局', 'deadSlots → source: none')
      } else {
        bad('绑卡被删时不回落全局',
          '看不到「绑定的卡被删 → 该会话明确未启用」的处理（deadSlots / source:none）：'
          + '一旦回落到全局，用户会以为在跟 A 聊、其实在跟 B 聊——**这个方向的错误比不隔离更糟**。该找 host-core')
      }
    }

    // ④ 按会话缓存 + 上限（渲染路径一次组装要调五次，必须有界）
    if (/SESSION_CACHE_LIMIT|CACHE_LIMIT/u.test(promptSrc) && /Map</u.test(promptSrc)) {
      ok('按会话缓存且有上限', (/(?:SESSION_)?CACHE_LIMIT\s*=\s*(\d+)/u.exec(promptSrc)?.[1] ?? '?') + ' 条')
    } else {
      bad('按会话缓存且有上限',
        '没看到「按会话缓存 + 容量上限」：不按会话缓存会在多会话间串味；不设上限则长跑必泄漏。该找 host-core')
    }
  }

  // ⑤ 工具层也按会话决议（否则「提示词隔离、工具串台」比不隔离更糟）
  if (tools === undefined) {
    bad('src/tools.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const codeOnly = tools.split('\n')
      .filter(line => !/^\s*(\*|\/\/|\/\*)/u.test(line))
      .join('\n')
    const stillGlobal = /prompt\.characterName/u.test(codeOnly)
    const bySession = /characterForSession|resolveTarget/u.test(codeOnly) && /sessionIdOf/u.test(codeOnly)
    if (!stillGlobal && bySession) {
      ok('工具层按会话决议角色', 'characterForSession + sessionIdOf')
    } else if (stillGlobal) {
      bad('工具层按会话决议角色',
        'tools.ts 的代码里仍在用 `prompt.characterName`（全局值）：会话绑定 A、全局启用 B 时，'
        + '提示词是 A、写日记/查关系却写到 B 上——**这种「一半隔离」比完全不隔离更危险**。该找 host-core')
    } else {
      bad('工具层按会话决议角色',
        'tools.ts 里看不到按会话取角色的痕迹（characterForSession / resolveTarget + sessionIdOf）。该找 host-core')
    }
  }
}

// ================================================================ 23. 正则屏蔽 + 去字数提醒
head('[23] 正则屏蔽可证明（ST_SCRIPT_STANCE 全链路）与「字数提醒」已删')
{
  const tavern = await readSource('src/tavern.ts')
  if (tavern === undefined) {
    bad('src/tavern.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const stance = /export\s+const\s+ST_SCRIPT_STANCE\s*=\s*['"`]([^'"`]+)['"`]/u.exec(tavern)?.[1]
    if (stance === undefined) {
      bad('有 ST_SCRIPT_STANCE 口径常量',
        '没有把「不执行酒馆正则脚本」写成代码常量：日志、面板、导入警告各写一份文案，早晚漂移成三种说法。该找 host-core')
    } else if (!/不执行/u.test(stance) || !/显示侧/u.test(stance)) {
      bad('有 ST_SCRIPT_STANCE 口径常量',
        `口径文案不完整（${stance}）：要同时说清「不执行」与「显示侧也不执行」，否则读者以为是「暂时没接」。该找 host-core`)
    } else {
      ok('有 ST_SCRIPT_STANCE 口径常量', stance.slice(0, 40))
    }
  }

  // 屏蔽要有「可证明」的断言，不是口头保证
  const tavernVerify = await readSource('scripts/verify-tavern.mjs')
  if (tavernVerify === undefined) {
    skipped('正则屏蔽有自检证明', '读不到 scripts/verify-tavern.mjs')
  } else {
    const markerTest = /ST_SCRIPT_STANCE/u.test(tavernVerify)
    const byteEqual = (tavernVerify.match(/renderL1(?:Static)?\(\w+\)\s*===\s*renderL1/u) ?? []).length > 0
      || /逐字相同/u.test(tavernVerify)
    const preserves = /原样保留/u.test(tavernVerify)
    if (markerTest && byteEqual && preserves) {
      ok('正则屏蔽有自检证明', '口径常量 + 逐字相同 + 字段保留')
    } else {
      bad('正则屏蔽有自检证明',
        'verify-tavern.mjs 里缺屏蔽证明：需要三条——① 特征串不出现在 L1/preview ② 去掉脚本后文本逐字相同 ③ 字段原样保留。'
        + `当前命中：口径 ${markerTest ? '✓' : '✗'} / 逐字相同 ${byteEqual ? '✓' : '✗'} / 保留 ${preserves ? '✓' : '✗'}。该找 host-core`)
    }
  }

  // 字数提醒已删（只看字符串字面量：注释里往往正写着「book-too-large 已删」）
  const schema = await readSource('client/lorebook-schema.ts')
  if (schema === undefined) {
    bad('client/lorebook-schema.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  } else if (/['"]book-too-large['"]/u.test(schema)) {
    bad('book-too-large（字数提醒）已删',
      '`book-too-large` 还在：主人明确要求「字数超出」这条提醒不要（世界书按需注入，字数本身不是问题），'
      + '留着只会继续制造噪音。该找 client-ui 整条删掉（code + 文案）')
  } else {
    ok('book-too-large（字数提醒）已删', '只剩条数提醒')
  }

  // 面板要让用户看见「已屏蔽」
  const text = (await readSource('client/text.ts')) ?? ''
  const blockedKey = [...text.matchAll(/['"]([A-Za-z0-9_.]*(?:regex|script)[A-Za-z0-9_.]*)['"]\s*:\s*['"]([^'"]*屏蔽[^'"]*)['"]/gu)]
  if (blockedKey.length > 0) {
    ok('面板有「正则已屏蔽」中性文案', `${blockedKey[0][1]} = ${blockedKey[0][2].slice(0, 30)}…`)
  } else {
    bad('面板有「正则已屏蔽」中性文案',
      '没有一条「本卡含 N 条酒馆正则脚本，已屏蔽」的文案：用户看不到屏蔽状态，就会以为脚本在生效（或以为卡坏了）。'
      + '该找 client-ui（中性信息，不是红条）')
  }
}

// ================================================================ 24. 预设接线
head('[24] 预设接线（6 条 REST + aiwu:preset 段 order 5080 + 客户端视图）')
{
  const web = await readSource('src/web.ts')
  const promptSrc = await readSource('src/prompt.ts')
  const presetSrc = await readSource('src/preset.ts')
  const api = (await readSource('client/api.ts')) ?? ''

  // ① 6 条 REST
  if (web === undefined) {
    bad('src/web.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const routes = ['/presets', '/preset', '/preset/save', '/preset/delete', '/preset/import', '/preset/activate']
    const missing = routes.filter(route => sliceRoute(web, route) === undefined)
    if (missing.length === 0) ok('6 条预设 REST 路由齐全')
    else {
      bad('6 条预设 REST 路由齐全',
        `缺 ${missing.join(' ')}：预设列表/详情/保存/删除/导入/启用任一缺口，面板对应按钮就是死按钮。该找 host-core`)
    }
  }

  // ② 段与 order：aiwu:preset = 5080（ORDER_BASE + 80）
  if (promptSrc === undefined) {
    bad('src/prompt.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    const base = Number(/export\s+const\s+ORDER_BASE\s*=\s*(\d+)/u.exec(promptSrc)?.[1] ?? 5000)
    const hasId = promptSrc.includes('aiwu:preset')
    let order
    let expr = ''
    for (const m of promptSrc.matchAll(/section\(\s*([A-Za-z0-9_]+|'[^']+'|"[^"]+")\s*,\s*([^,\n]+),/gu)) {
      const target = m[1].replace(/['"]/gu, '')
      if (target !== 'SECTION_PRESET' && target !== 'aiwu:preset') continue
      expr = m[2].trim()
      if (/^ORDER_BASE\s*\+\s*(\d+)$/u.test(expr)) order = base + Number(/(\d+)$/u.exec(expr)[1])
      else if (/^\d+$/u.test(expr)) order = Number(expr)
      break
    }
    if (!hasId) {
      bad('有 aiwu:preset 段（order 5080）',
        'prompt.ts 里没有 aiwu:preset：预设保存了也进不了提示词，用户会以为「启用了没效果」。该找 host-core')
    } else if (order !== 5080) {
      bad('有 aiwu:preset 段（order 5080）',
        `段在，但 order 算出来是 ${order ?? '解析不出'}（期望 5080 = ORDER_BASE + 80）：`
        + '预设是「文风/规则」，必须排在纪律包(5050)之后（硬约束优先）、角色卡(5100)之前（稳定段靠前，不随角色变而重算）。该找 host-core')
    } else {
      ok('有 aiwu:preset 段（order 5080）', expr)
    }
  }

  // ③ 转化器
  if (presetSrc === undefined) {
    bad('src/preset.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else if (/export\s+function\s+convertStPreset/u.test(presetSrc)) {
    ok('有 convertStPreset 转化器')
  } else {
    bad('有 convertStPreset 转化器',
      'src/preset.ts 里找不到 convertStPreset：没有转化器就没有「导入 ST 预设」这条链路。该找 host-core')
  }

  // ④ 客户端 6 个函数 + 视图
  const apiRoutes = ['/presets', '/preset?', '/preset/save', '/preset/delete', '/preset/import', '/preset/activate']
  const apiMissing = apiRoutes.filter(route => !api.includes(route.replace('?', '')))
  if (api === '') bad('client/api.ts 可读', '文件不存在或读不到 —— 该找 client-ui')
  else if (apiMissing.length === 0) ok('client/api.ts 有 6 个预设接口')
  else {
    bad('client/api.ts 有 6 个预设接口',
      `client/api.ts 里缺 ${apiMissing.join(' ')}：面板发不出对应请求。该找 client-ui`)
  }

  let viewOk = false
  try {
    const view = await readSource('client/preset-view.tsx')
    viewOk = typeof view === 'string' && view.length > 2000
  } catch {
    viewOk = false
  }
  if (viewOk) ok('有 client/preset-view.tsx')
  else {
    bad('有 client/preset-view.tsx',
      '找不到预设面板视图（或文件异常小）：接口通了但界面上没有入口，用户只能用 curl。该找 client-ui')
  }
}

// ================================================================ 25. ST 判据对齐
head('[25] ST 预设判据对齐真原件（结构占位白名单 · 不按 marker 一刀切 · 两侧同源）')
{
  const presetSrc = await readSource('src/preset.ts')
  const viewSrc = (await readSource('client/preset-view.tsx')) ?? ''
  if (presetSrc === undefined) {
    bad('src/preset.ts 可读', '文件不存在或读不到 —— 该找 host-core')
  } else {
    // ① 结构占位是白名单（含 ST 的槽位标识）
    const whitelistBlock = /ST_STRUCTURAL_IDS\s*=\s*new\s+Set\(\s*\[([\s\S]{0,800}?)\]/u.exec(presetSrc)?.[1] ?? ''
    const ids = [...whitelistBlock.matchAll(/['"]([A-Za-z/][A-Za-z0-9_/]*)['"]/gu)].map(m => m[1])
    const need = ['worldInfoBefore', 'chatHistory', 'main']
    const lack = need.filter(id => !ids.includes(id))
    if (whitelistBlock !== '' && ids.length >= 10 && lack.length === 0) {
      ok('结构占位用白名单判定', `${ids.length} 项（含 worldInfoBefore / chatHistory / main）`)
    } else {
      bad('结构占位用白名单判定',
        whitelistBlock === ''
          ? '找不到 ST_STRUCTURAL_IDS 白名单：结构占位若按名字/位置猜，迟早把真内容当占位丢掉。该找 host-core'
          : `白名单只有 ${ids.length} 项，缺 ${lack.join(' / ')}（ST 的槽位标识要用白名单钉死，13 项是实测口径）。该找 host-core`)
    }

    // ② 绝不按 marker 一刀切（marker 只许出现在注释里）
    const codeLines = presetSrc.split('\n').filter(line => !/^\s*(\*|\/\/|\/\*)/u.test(line))
    const markerInCode = codeLines.filter(line => /\bmarker\b/u.test(line))
    const markerDrops = markerInCode.filter(line => /continue|dropped\.push/u.test(line))
    if (markerDrops.length > 0) {
      bad('不按 marker:true 一刀切',
        `代码里有按 marker 丢弃的分支（${markerDrops[0].trim().slice(0, 60)}）：marker:true ≠ 结构占位——`
        + 'nsfw / jailbreak / enhanceDefinitions 都带 marker 但有正文，一刀切会把真内容丢掉。该找 host-core')
    } else {
      ok('不按 marker:true 一刀切', markerInCode.length === 0 ? '代码里不引用 marker' : '只在无丢弃的语境出现')
    }

    // ③ 多份 prompt_order 取条目最多的
    const picksLargest = /candidate\.length\s*>\s*order\.length|length\s*>\s*\w+\.length/u.test(presetSrc)
      && /prompt_order/u.test(presetSrc)
    if (picksLargest) ok('多份 prompt_order 取条目最多的一份')
    else {
      bad('多份 prompt_order 取条目最多的一份',
        '看不到「取条目最多的那份 prompt_order」的选择逻辑：ST 常同时给单聊/群聊两份 order，'
        + '拿错那份会漏掉条目（表现为「导入后少了一大半」）。该找 host-core')
    }

    // ④ 两侧同源（宽松启发式）
    const sameSource = /同源|真原件/u.test(presetSrc)
    const viewSame = /同源|真原件/u.test(viewSrc)
    if (sameSource && viewSame) ok('宿主与客户端判据同源（都注明对真原件）')
    else if (viewSame) ok('宿主与客户端判据同源', '仅客户端注明（宿主注释缺一句同源说明，不阻塞）')
    else {
      skipped('宿主与客户端判据同源',
        '两侧注释都没写「同源 / 真原件」：判据可能各写一套（面包屑对不上）。建议补注释，但静态判不出真实差异')
    }
  }
}

// ================================================================ 汇总
console.log('')
if (fail > 0) {
  console.log(`接线体检未通过：通过 ${pass} 项，失败 ${fail} 项${skip > 0 ? `，跳过 ${skip} 项` : ''}。`)
  console.log('\n失败清单：')
  for (const line of failures) console.log(`  - ${line}`)
  console.log('\n如果这些改动正在别人手里：别自己改 src/ 或 client/，把上面每条的归属（host-core / client-ui）报给 Lead。')
  process.exit(1)
}
console.log(`接线体检全部通过（${pass} 项${skip > 0 ? `，跳过 ${skip} 项` : ''}）。`)
