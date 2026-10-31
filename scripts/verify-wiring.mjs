/**
 * 接线体检：静态扫源码，抓「后端做了、前端没接」这类断线。
 *
 * 为什么需要它：`tsc` 只查「类型对不对」，不查「有没有人调用」。
 * 一段 17 KB 的 `client/lorebook-schema.ts` 可以零 import 地躺在仓库里，
 * 一个 `POST /character/import` 路由可以在 `src/web.ts` 注册完就没下文——
 * 这两种状态下类型检查、打包、七套自检**全是绿的**，但用户打开面板
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
 *  - 这是「体检表」不是「构建步」：不串进 `npm run build`，手动跑。
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
