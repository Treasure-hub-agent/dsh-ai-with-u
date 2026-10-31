/**
 * 酒馆卡导入自检：**现造夹具**，不依赖任何真实酒馆卡。
 *
 * 覆盖：
 *   1. PNG（tEXt ccv3 / tEXt chara=V2 / tEXt 放在 IDAT 之前 / 被截断的 PNG）
 *   2. CHARX（store 与 deflate 两种压缩 / 缺 card.json / 加密条目 / 不支持的压缩方法 / 嵌套一层目录）
 *   3. 裸 JSON（V3 / V2 / 只有 data / 本插件 v0.1 旧卡 / 完全不是卡）
 *   4. 归一化细节（assets 剥离、regex_scripts 剥离、缺名字告警、扩展名与内容不符）
 *
 * 依赖：`npm run build:host` 产出的 `lib/import-card.js`。
 * 用法：`node scripts/verify-import.mjs`
 */
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateRawSync, deflateSync } from 'node:zlib'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

let pass = 0
let failed = 0
const ok = (msg) => { console.log(`  ✓ ${msg}`); pass += 1 }
const fail = (msg) => { console.error(`  ✗ ${msg}`); failed += 1 }
const eq = (label, actual, expected) => {
  if (actual === expected) ok(`${label} = ${JSON.stringify(actual)}`)
  else fail(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}
const truthy = (label, value) => {
  if (value) ok(label)
  else fail(`${label}（实际为假值）`)
}
const throws = (label, fn, needle) => {
  try {
    fn()
    fail(`${label}：期望抛错但没抛`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (needle === undefined || message.includes(needle)) ok(`${label} → ${message.slice(0, 52)}…`)
    else fail(`${label}：报错文案不含「${needle}」：${message}`)
  }
}

// ---------------------------------------------------------------- 夹具工具

/** CRC32（PNG chunk 与 zip 条目都要）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 打一个 PNG chunk：长度(大端) + 类型 + 数据 + CRC。 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/** tEXt chunk：keyword \0 text。 */
function textChunk(keyword, text) {
  return pngChunk('tEXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(text, 'latin1'),
  ]))
}

/**
 * 造一张 3×3 RGB PNG，并可把卡片文本塞在 IDAT 之前或之后。
 * @param {object} options
 * @param {unknown} options.card 要编码进 tEXt 的 JSON 对象
 * @param {string} [options.keyword] tEXt 的 keyword
 * @param {'before'|'after'} [options.position] 相对 IDAT 的位置
 * @param {number} [options.truncate] 末尾切掉多少字节（模拟截断）
 */
function makePng(options) {
  const keyword = options.keyword ?? 'ccv3'
  const position = options.position ?? 'after'
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(3, 0)      // width
  ihdr.writeUInt32BE(3, 4)      // height
  ihdr[8] = 8                   // bit depth
  ihdr[9] = 2                   // color type: truecolor
  ihdr[10] = 0                  // compression
  ihdr[11] = 0                  // filter
  ihdr[12] = 0                  // interlace

  // 每行：filter(0) + 3 像素 × 3 通道 = 10 字节
  const raw = Buffer.alloc(3 * 10)
  for (let y = 0; y < 3; y += 1) {
    raw[y * 10] = 0
    for (let x = 0; x < 9; x += 1) raw[y * 10 + 1 + x] = (x * 29 + y * 17) & 0xff
  }
  const idat = deflateSync(raw)

  const base64 = Buffer.from(JSON.stringify(options.card), 'utf8').toString('base64')
  const text = textChunk(keyword, base64)
  const parts = [PNG_SIG, pngChunk('IHDR', ihdr)]
  if (position === 'before') parts.push(text)
  parts.push(pngChunk('IDAT', idat))
  if (position === 'after') parts.push(text)
  parts.push(pngChunk('IEND', Buffer.alloc(0)))

  let buf = Buffer.concat(parts)
  if (options.truncate !== undefined && options.truncate > 0) {
    buf = buf.subarray(0, buf.length - options.truncate)
  }
  return buf
}

/**
 * 造一个 zip（.charx）。
 * @param {Array<{name: string, data: unknown, method?: number, encrypted?: boolean, descriptor?: boolean}>} entries
 */
function makeZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const method = entry.method ?? 0
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const crc = crc32(raw)
    const nameBuf = Buffer.from(entry.name, 'utf8')
    // bit0 = 加密；bit3 = 数据描述符（此时本地头里的 CRC/大小全写 0，真实值只在中央目录）
    const flags = (entry.encrypted === true ? 1 : 0) | (entry.descriptor === true ? 8 : 0)
    const localHasSizes = entry.descriptor !== true

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)          // 时间
    local.writeUInt16LE(0, 12)          // 日期
    local.writeUInt32LE(localHasSizes ? crc : 0, 14)
    local.writeUInt32LE(localHasSizes ? payload.length : 0, 18)
    local.writeUInt32LE(localHasSizes ? raw.length : 0, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)          // extra
    localParts.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)        // version made by
    central.writeUInt16LE(20, 6)        // version needed
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)        // extra
    central.writeUInt16LE(0, 32)        // comment
    central.writeUInt16LE(0, 34)        // disk start
    central.writeUInt16LE(0, 36)        // internal attrs
    central.writeUInt32LE(0, 38)        // external attrs
    central.writeUInt32LE(offset, 42)   // local header offset
    centralParts.push(central, nameBuf)

    offset += 30 + nameBuf.length + payload.length
  }

  const localBlock = Buffer.concat(localParts)
  const centralBlock = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBlock.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([localBlock, centralBlock, eocd])
}

// ---------------------------------------------------------------- 夹具数据

const V3_CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '夹具甲',
    description: '三行像素里长出来的角色。',
    personality: '沉得住气',
    scenario: '在一个只有 9 个像素的世界里。',
    first_mes: '你好，我是甲。',
    alternate_greetings: ['又见面了。', '今天也来了。'],
    tags: ['test'],
    character_book: {
      name: '甲的设定集',
      entries: [{ keys: ['像素'], content: '像素是这个世界的基本单位。', enabled: true, insertion_order: 1 }],
    },
  },
}

const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '夹具乙',
    description: 'V2 卡。',
    personality: 'older',
    first_mes: '我来自 v2。',
    alternate_greetings: [],
  },
}

// ---------------------------------------------------------------- 开跑

console.log('酒馆卡导入自检：')

let parseCardBuffer
try {
  const fresh = await stat(join(root, 'src', 'import-card.ts'))
  const built = await stat(join(root, 'lib', 'import-card.js')).catch(() => undefined)
  if (built === undefined) throw new Error('lib/import-card.js 不存在，先跑 npm run build:host')
  if (built.mtimeMs + 1000 < fresh.mtimeMs) throw new Error('lib/import-card.js 比源码旧，先跑 npm run build:host')
  const mod = await import(pathToFileURL(join(root, 'lib', 'import-card.js')).href)
  parseCardBuffer = mod.parseCardBuffer
  ok(`模块加载：export parseCardBuffer = ${typeof parseCardBuffer}`)
} catch (error) {
  console.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// ---- 1. PNG ------------------------------------------------------
console.log('PNG：')
{
  const png = makePng({ card: V3_CARD, keyword: 'ccv3', position: 'after' })
  const result = parseCardBuffer(png, 'fixture.png')
  eq('format', result.format, 'png')
  eq('spec', result.card.spec, 'chara_card_v3')
  eq('data.name', result.card.data.name, '夹具甲')
  eq('warnings 数（干净卡）', result.warnings.length, 0)
  truthy('character_book 原样带过来', result.card.data.character_book !== undefined)

  // tEXt 在 IDAT 之前也要能读到
  const before = parseCardBuffer(makePng({ card: V3_CARD, position: 'before' }), 'before.png')
  eq('tEXt 在 IDAT 之前时 data.name', before.card.data.name, '夹具甲')

  // V2 用 chara 段
  const v2 = parseCardBuffer(makePng({ card: V2_CARD, keyword: 'chara' }), 'v2.png')
  eq('chara 段 → spec', v2.card.spec, 'chara_card_v3')
  eq('chara 段 → name', v2.card.data.name, '夹具乙')
  truthy('V2 有告警', v2.warnings.some(w => w.includes('V2')))

  // 截断：把 tEXt 放在 IDAT 之前，再切掉 IDAT 的尾巴 —— chunk 长度越界可被识别为「不完整」，
  // 而卡片文本已经读到，所以「尽力读取」这条路径能被验证到。
  const cut = parseCardBuffer(makePng({ card: V3_CARD, position: 'before', truncate: 20 }), 'cut.png')
  eq('截断 PNG 仍读到 name', cut.card.data.name, '夹具甲')
  truthy('截断 PNG 有「不完整」告警', cut.warnings.some(w => w.includes('不完整')))

  // 没有卡片段的普通 PNG
  const plain = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', Buffer.concat([Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0])])),
    pngChunk('IDAT', deflateSync(Buffer.alloc(2 * 7))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  throws('普通 PNG（无 tEXt）', () => parseCardBuffer(plain, 'plain.png'), '没有 tEXt')

  // keyword 不认识
  throws(
    'keyword 不认识',
    () => parseCardBuffer(makePng({ card: V3_CARD, keyword: 'chub' }), 'chub.png'),
    'keyword 不认识',
  )

  // base64 被改写
  const bad = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', Buffer.concat([Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0])])),
    textChunk('ccv3', '这不是 base64!!!'),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  throws('base64 非法', () => parseCardBuffer(bad, 'bad.png'), 'base64')
}

// ---- 2. CHARX ----------------------------------------------------
console.log('CHARX：')
{
  const stored = parseCardBuffer(makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD), method: 0 }]), 'a.charx')
  eq('store 方式 format', stored.format, 'charx')
  eq('store 方式 name', stored.card.data.name, '夹具甲')

  const deflated = parseCardBuffer(makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD), method: 8 }]), 'b.charx')
  eq('deflate 方式 name', deflated.card.data.name, '夹具甲')

  // 带一个 assets 条目：只读 card.json，其余忽略并告警
  const withAssets = parseCardBuffer(makeZip([
    { name: 'card.json', data: JSON.stringify(V3_CARD), method: 8 },
    { name: 'assets/cover.png', data: 'not-a-real-png', method: 0 },
  ]), 'c.charx')
  truthy('忽略其它条目有告警', withAssets.warnings.some(w => w.includes('其它条目')))

  // 嵌套一层目录
  const nested = parseCardBuffer(makeZip([{ name: 'mycard/card.json', data: JSON.stringify(V3_CARD) }]), 'd.charx')
  eq('嵌套 card.json 仍可读', nested.card.data.name, '夹具甲')
  truthy('嵌套有告警', nested.warnings.some(w => w.includes('不在包根目录')))

  // 文件名用反斜杠（Windows 打的 zip 偶尔这样）
  const backslash = parseCardBuffer(makeZip([{ name: 'mycard\\card.json', data: JSON.stringify(V3_CARD) }]), 'i.charx')
  eq('反斜杠路径仍可读', backslash.card.data.name, '夹具甲')

  // 数据描述符模式：本地头里 CRC/大小全是 0，真实值只在中央目录（Z1 的核心用例）
  const descriptor = parseCardBuffer(
    makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD), method: 8, descriptor: true }]),
    'j.charx',
  )
  eq('数据描述符模式（本地头 size=0）仍可读', descriptor.card.data.name, '夹具甲')

  // 缺 card.json
  throws(
    '缺 card.json',
    () => parseCardBuffer(makeZip([{ name: 'readme.txt', data: 'hi' }]), 'e.charx'),
    '没有 card.json',
  )

  // 加密条目
  throws(
    '加密条目',
    () => parseCardBuffer(makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD), encrypted: true }]), 'f.charx'),
    '加密',
  )

  // 不支持的压缩方法（12 = bzip2）
  throws(
    '不支持压缩方法',
    () => parseCardBuffer(makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD), method: 12 }]), 'g.charx'),
    '压缩方法',
  )

  // 中央目录被抹掉
  const zip = makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD) }])
  const broken = Buffer.from(zip)
  broken.fill(0, zip.length - 22)
  throws('EOCD 缺失', () => parseCardBuffer(broken, 'h.charx'), '中央目录')
}

// ---- 3. 裸 JSON ---------------------------------------------------
console.log('裸 JSON：')
{
  const v3 = parseCardBuffer(Buffer.from(JSON.stringify(V3_CARD), 'utf8'), 'card.json')
  eq('V3 format', v3.format, 'json')
  eq('V3 name', v3.card.data.name, '夹具甲')

  const v2 = parseCardBuffer(Buffer.from(JSON.stringify(V2_CARD), 'utf8'), 'card.json')
  eq('V2 → spec', v2.card.spec, 'chara_card_v3')
  eq('V2 → spec_version', v2.card.spec_version, '3.0')
  truthy('V2 有告警', v2.warnings.some(w => w.includes('V2')))

  const bare = parseCardBuffer(Buffer.from(JSON.stringify({ data: { name: '裸 data' } }), 'utf8'), 'bare.json')
  eq('只有 data → name', bare.card.data.name, '裸 data')
  truthy('缺 spec 有告警', bare.warnings.some(w => w.includes('缺 spec')))

  // 缺名字
  const noName = parseCardBuffer(Buffer.from(JSON.stringify({ spec: 'chara_card_v3', data: {} }), 'utf8'), 'noname.json')
  truthy('缺名字有告警', noName.warnings.some(w => w.includes('没有名字')))

  // assets / regex_scripts 剥离
  const heavy = parseCardBuffer(Buffer.from(JSON.stringify({
    spec: 'chara_card_v3',
    data: {
      name: '夹具丙',
      assets: [{ type: 'icon', uri: 'embeded://assets/1.png', name: 'a' }],
      regex_scripts: [{ scriptName: 'x' }],
    },
  }), 'utf8'), 'heavy.json')
  eq('assets 已剥离', heavy.card.data.assets, undefined)
  eq('regex_scripts 已剥离', heavy.card.data.regex_scripts, undefined)
  truthy('assets 有告警', heavy.warnings.some(w => w.includes('assets')))
  truthy('regex_scripts 有告警', heavy.warnings.some(w => w.includes('regex_scripts')))

  // 本插件 v0.1 旧卡：明确指向迁移路径
  throws(
    'v0.1 旧 10 组卡',
    () => parseCardBuffer(Buffer.from(JSON.stringify({
      name: '旧卡',
      basic: { 姓名: '旧卡' },
      voice: { 自称: '我' },
    }), 'utf8'), 'legacy.json'),
    'normalizeCard',
  )

  // 不是卡
  throws('普通 JSON', () => parseCardBuffer(Buffer.from('{"hello":1}', 'utf8'), 'x.json'), '不是酒馆卡')

  // 坏 JSON
  throws('坏 JSON', () => parseCardBuffer(Buffer.from('{"spec": ', 'utf8'), 'y.json'), 'JSON 解析失败')
}

// ---- 4. 杂项 ------------------------------------------------------
console.log('杂项：')
{
  throws('空 Buffer', () => parseCardBuffer(Buffer.alloc(0), 'empty.png'), '空的')

  // .png 其实是 zip：按内容读，给 warning
  const disguised = parseCardBuffer(makeZip([{ name: 'card.json', data: JSON.stringify(V3_CARD) }]), 'disguised.png')
  eq('扩展名说谎 → 仍按 charx 读', disguised.format, 'charx')
  truthy('扩展名不符有告警', disguised.warnings.some(w => w.includes('扩展名')))

  // 完全无法识别
  throws('随机字节', () => parseCardBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), 'x.bin'), '无法识别')

  // .png 但签名不对
  throws('假 png', () => parseCardBuffer(Buffer.from('not a png at all', 'utf8'), 'fake.png'), '签名不对')
}

// ---------------------------------------------------------------- iTXt 解压炸弹

console.log('\nPNG iTXt：解压上限（P2-6）')
{
  /** iTXt chunk：keyword \0 flag(1) method(1) lang \0 translated \0 text */
  const itxtChunk = (keyword, payload, compressed) => pngChunk('iTXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, compressed ? 1 : 0, 0]),
    Buffer.from([0]), // language tag
    Buffer.from([0]), // translated keyword
    payload,
  ]))

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(3, 0)
  ihdr.writeUInt32BE(3, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const idat = pngChunk('IDAT', deflateSync(Buffer.alloc(3 * 10)))

  // 9 MB 的 'a' 压完只有 ~9 KB：旧代码会全量解出来，新代码必须拒绝
  const bomb = deflateSync(Buffer.alloc(9 * 1024 * 1024, 0x61))
  const png = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    itxtChunk('ccv3', bomb, true),
    idat,
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  throws('iTXt 解压炸弹被拒', () => parseCardBuffer(png, 'bomb.png'), '超过上限')

  // 正常的小 iTXt 仍要能读（ccv3 段的正文是 base64 的 JSON）
  const okText = Buffer.from(Buffer.from(JSON.stringify(V3_CARD), 'utf8').toString('base64'), 'utf8')
  const okPng = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    itxtChunk('ccv3', deflateSync(okText), true),
    idat,
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  eq('压缩的 iTXt 正常卡仍可导入', parseCardBuffer(okPng, 'ok.png').format, 'png')
}

console.log('')
if (failed > 0) {
  console.error(`酒馆卡导入自检未通过：失败 ${failed} 项，通过 ${pass} 项。`)
  process.exit(1)
}
console.log(`酒馆卡导入自检全部通过（通过 ${pass} 项，失败 0 项）。`)
