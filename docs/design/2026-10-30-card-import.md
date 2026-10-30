# 酒馆卡导入（PNG / CHARX / JSON）· 解析器与流程设计（2026-10-30）

> 负责人：distill-designer（共享任务板 `task-7`）
> 代码：`src/import-card.ts`（解析器，纯函数零 IO）、`scripts/verify-import.mjs`（47 项自检，夹具现造）
> 前置：`docs/design/2026-10-30-tavern-card.md`（CCv3 存储与投影，tavern-architect）
> 边界：本设计**只做容器解析 + 前端流程**。`card.json` 落盘走 architect 的双入口 `POST /character/save`；`src/web.ts` 归 architect，本文只提契约要求。

---

## 0. 一页结论

| 问题 | 结论 |
|---|---|
| 支持什么 | `.png`（tEXt/iTXt 里的 `ccv3` / `chara`）、`.charx`（zip 里的 `card.json`）、裸 `.json`（V3 / V2 / 只有 `data`） |
| 出口 | `parseCardBuffer(buf: Buffer, fileName?: string): { card: CharacterCardV3Like, format: 'png'\|'charx'\|'json', warnings: string[] }` |
| 纯函数 | 不读文件、不写盘、不打时间戳、不碰 store。**同一份字节永远得到同一份结果** |
| 判定顺序 | **魔数优先**（PNG 签名 / `PK\x03\x04`），扩展名只用来「提示不一致」，最后兜底当 JSON |
| 归一化 | V2 包一层成 V3；只有 `data` 的补 `spec`；`spec_version` 非 V3 一律写 `3.0` |
| 剥掉什么 | `assets`（不落地立绘）、`regex_scripts`（不接 muv 系）——**剥离但告警**，其余键一个不动 |
| 不做什么 | 34 字段旧卡迁移（归 `normalizeCard`）、世界书算法、`embeded://` 资源、加密 zip、ZIP64 |
| 硬闸 | 输入 64 MB、解出的 `card.json` 8 MB（zip 炸弹闸）；两者都只防误传，正常卡差三个数量级 |
| 测试 | 47 项断言，夹具在内存里现造（3×3 PNG / 手写 zip），**不依赖任何真实酒馆卡** |

---

## 1. PNG：从 chunk 里抠出 base64 卡片

### 1.1 字节布局

```
8 字节签名  89 50 4E 47 0D 0A 1A 0A
chunk 序列  [长度(4, 大端)][类型(4, latin1)][数据(N)][CRC(4)]
             IHDR → (tEXt|iTXt)? → IDAT* → (tEXt|iTXt)? → IEND
```

- **`tEXt` 数据** = `keyword(1..79, latin1)` + `0x00` + `text(latin1)`；
  `text` 是 **base64 的 UTF-8 JSON**，解出来就是整张卡。
- **`iTXt` 数据** = `keyword` + `0x00` + `flag(1)` + `method(1)` + `lang` + `0x00` + `translated` + `0x00` + `text`。
  `flag=0` 明文 UTF-8，`flag=1` 是 **deflate 压缩**（用 `zlib.inflateSync`）。真实世界两种都有，所以都支持。
- **keyword 优先级**：`ccv3`（V3）优先 → `chara`（V1/V2）回退。命中 `chara` 时给一条「这是 V2 卡」的告警，但仍然能读。

### 1.2 四个必须做对的细节

| # | 细节 | 做法 |
|---|---|---|
| P1 | **`tEXt` 可能在 IDAT 之后** | 不能用「遇到 IDAT 就收工」；扫到 `IEND` 为止，IDAT 的数据整块跳过（只看长度）。 |
| P2 | 长度是**大端** 4 字节 | `buf.readUInt32BE(offset)`。写成 LE 会把 0x0000F3A2 读成巨大值，直接越界。 |
| P3 | **CRC 不校验** | 只要 `offset + 8 + length + 4 <= buf.length` 就跳过。校 CRC 会让「被图床重压过」的卡读不出来，收益为零。 |
| P4 | **截断要容忍** | chunk 长度越界时 `truncated = true`，用已经读到的 chunk 继续；最后附一条「PNG 看起来不完整」告警。硬崩会让用户以为自己的卡坏了。 |

### 1.3 找不到卡片时说什么

| 情况 | 报错 |
|---|---|
| 有 `tEXt` 但 keyword 不是 ccv3/chara | `这张 PNG 里有卡片数据，但 keyword 不认识（找到：chub）；本插件只认 ccv3 与 chara` |
| 没有任何 tEXt/iTXt | `这张 PNG 里没有 tEXt/iTXt 卡片数据（keyword 应为 ccv3 或 chara）——它可能只是张普通图片` |
| base64 非法 | `PNG 的 ccv3 段 的卡片文本不是合法 base64：可能不是酒馆卡，或者被别的工具改写过` |
| base64 解出空 | `PNG 的 ccv3 段 的 base64 解出来是空的` |

> 报错里带**找到了什么**（keyword 列表），比「读不出来」有用得多：用户能立刻判断这是不是别的卡格式。

---

## 2. CHARX：手写 zip 中央目录

`.charx` 就是 zip，根目录 `card.json` 是 CCv3 本体（`embeded://` 资源一律忽略）。**不引依赖**：`node:zlib.inflateRawSync` + 手写目录解析。

### 2.1 解析步骤

```
① 找 EOCD：从 len-22 往前扫，最多回溯 64 KB（zip 允许尾部注释），命中 0x06054B50
② 读 EOCD：totalEntries(+10,2) / cdSize(+12,4) / cdOffset(+16,4)
③ 遍历中央目录（每条 46 字节固定头）：
     0x02014B50 | 标志(+8,2) | 方法(+10,2) | 压缩后大小(+20,4) | 原始大小(+24,4)
     文件名长(+28,2) | extra 长(+30,2) | 注释长(+32,2) | 本地头偏移(+42,4) | 文件名(+46)
④ 选 Entry：优先名字 === 'card.json'；否则 endsWith('/card.json')（取层级最浅的）
⑤ 读本地头（0x04034B50）：数据起点 = 本地头偏移 + 30 + 文件名长(+26,2) + extra 长(+28,2)
⑥ 方法 0 → 原样；方法 8 → inflateRawSync；其它 → 明确报错
```

### 2.2 四个坑（都在代码里钉住了）

| # | 坑 | 处理 |
|---|---|---|
| Z1 | **本地头的 size 可能是 0** | 当标志位 bit3（数据描述符）置位时，本地头里的压缩/原始大小都是 0，真实尺寸只在中央目录里。**尺寸一律用中央目录的**，否则读到空数据。 |
| Z2 | 文件名可能是 UTF-8 且带反斜杠 | `toString('utf8')` + 把 `\` 归一成 `/` 再匹配。 |
| Z3 | **ZIP64** | `totalEntries === 0xFFFF` 或 `cdOffset === 0xFFFFFFFF` → 直接报错「这是 ZIP64 包，本插件暂不支持」。不做静默降级。 |
| Z4 | **加密 / 不支持的方法** | 标志位 bit0 置位 → `加密条目，本插件不支持加密 zip`；方法不是 0/8 → `用了不支持的压缩方法 12（只支持 store=0 / deflate=8）`。**都要报准确值**，不能「解压失败」四个字。 |

### 2.3 zip 炸弹闸

先看中央目录里的 `uncompressedSize`（> 8 MB 直接拒绝），再给 `inflateRawSync` 传 `maxOutputLength`，最后再验一次实际长度。三道闸，成本一行代码。

### 2.4 报错表

| 情况 | 报错 |
|---|---|
| 文件 < 22 字节 | `这个 ZIP 太小了，读不到中央目录（文件可能不完整）` |
| 找不到 EOCD | `找不到 ZIP 的中央目录（End of Central Directory）——文件可能被截断，或者根本不是 zip` |
| 中央目录越界 | `ZIP 中央目录越界：文件被截断，或者声明的大小与实际不符` |
| 没有 `card.json` | `这个 CHARX 里没有 card.json（根目录应有它）。包内条目：readme.txt / assets/…`（**列出来**） |
| `card.json` 过大的 | `card.json 解出来有 12.3 MB，超过上限 8.0 MB` |
| 本地头损坏 | `CHARX 的本地文件头损坏（card.json），文件可能被截断` |

---

## 3. 裸 JSON 与 V2 → V3 归一

### 3.1 spec 判定表（与 `tavern-card.md` §2.1 对齐）

| 输入 | 动作 | 告警 |
|---|---|---|
| `{spec:'chara_card_v3', data:{…}}` | 原样，保留它自带的 `spec_version` | — |
| `{spec:'chara_card_v2', data:{…}}` | 包一层 `{spec:'chara_card_v3', spec_version:'3.0', data}`（V2 的 `character_book` 结构兼容，直接带过来） | `这是 V2 卡…已包成 V3 形状` |
| `{data:{…}}`（无 spec） | 同 V2 处理 | `卡片缺 spec 字段，已按 V2 形状处理并补上 spec` |
| `{spec:'chara_card_v1'}` 等其它 spec | **报错**：`不认识的卡片 spec：xxx（只认 chara_card_v3 / chara_card_v2）` | — |
| 本插件 v0.1 旧卡（顶层有 `basic`/`voice`/…） | **报错并指路**：`这是本插件 v0.1 的旧格式卡（10 组中文键），不走导入通道：请放在 characters/ 目录里由迁移路径（normalizeCard）读入` | — |
| 完全不是卡 | `这个 JSON 不是酒馆卡：顶层既没有 spec、也没有 data（CCv3/V2 都要 data 对象）` | — |

> **为什么旧卡不在这里迁移**：`normalizeCard`（`src/tavern.ts`）已经是 34 字段 → CCv3 的唯一迁移入口。导入通道再写一份，两条路径迟早给出不同的结果，而且「同一张卡走不同入口得到不同的卡」是最难查的那类 bug。所以这里**只认酒馆容器，不认我们自己的旧格式**。

### 3.2 后处理（原地，都在 `toCardV3` 里）

| 处理 | 规则 | 告警 |
|---|---|---|
| 名字 | `data.name` trim；为空保留空并告警（目录名由调用方定） | `卡里没有名字（data.name 为空），需要用户在面板里补一个再保存` |
| `assets` | **整键删除**（含空数组也删，保持卡面干净） | `已忽略 N 个 assets（本轮不做立绘落地…）` |
| `regex_scripts` | **整键删除** | `已忽略 regex_scripts（本插件不执行酒馆的正则脚本）` |
| `spec_version` | 非 V3 输入一律写 `3.0`；V3 保留原值 | — |
| `character_book` | **原样透传**（算法在 `tavern-card.md` §4，不归本模块） | — |

### 3.3 不做「整包原文复制」

`tavern-card.md` §1.4 有 `extensions.aiwu.imported.raw` 的保真区。本解析器**不写它**，理由：

- 对 V2/V3 卡，**原生字段（`description`/`personality`/`scenario`/…）就是原文本身**，导入后原样保留在 `data` 里，L1 优先用它们 —— 不存在「被我们的投影覆盖」的情况，也就没有需要备份的原文；
- 整包复制会把 `character_book`（可能几十 KB）再存一份，收益为零。

真正需要留痕的只有**来源**：`extensions.aiwu.legacy.from = 'png' | 'charx' | 'json'` + `at`。这两个由**保存路径**写入（它有 clock，符合 `normalizeCard` 纯函数的约定）。

---

## 4. 出口契约

```ts
export type CardFormat = 'png' | 'charx' | 'json'

export interface CharacterCardV3Like {
  spec: 'chara_card_v3'
  spec_version?: string
  data: { name?: string; description?: string; /* … */ [key: string]: unknown }
  [key: string]: unknown
}

export interface ParsedCardFile {
  card: CharacterCardV3Like      // 已归一成 V3 形状
  format: CardFormat             // 按魔数判定，不看扩展名
  warnings: string[]             // 非致命，必须原样展示给用户
}

export const IMPORT_LIMITS = { maxBytes: 64 * 1024 * 1024, maxCardBytes: 8 * 1024 * 1024 }

export function parseCardBuffer(buf: Buffer, fileName?: string): ParsedCardFile
```

**约定**：

- 所有失败都 `throw new Error(中文、可操作、指出下一步)`，由 `web.ts` 的 `guard` 压成 `400 {ok:false,error}`（既有信封，不加 `code`）。
- `warnings` **不许静默丢弃**：前端必须逐条展示（它是「为什么这张卡少了点什么」的唯一解释）。
- `fileName` 只用于两件事：扩展名与魔数不符时加告警；`.png`/`.charx` 但魔数不对时给出更准的报错。**格式判定永远看字节**。

### 4.1 扩展名与内容不符（真实世界的常态）

| 现象 | 行为 |
|---|---|
| `.png` 其实是 zip | 按 CHARX 读 + 告警 `扩展名是 .png，但文件内容其实是 ZIP/CHARX；已按 CHARX 读` |
| `.charx` 其实是 PNG | 按 PNG 读 + 同款告警 |
| `.json` 其实是 PNG/ZIP | 按魔数读，不告警（用户可能只是随手改名） |
| `.png` 但签名不对、也不是 zip | 报错 `这个 .png 的签名不对（不是有效 PNG），也不是 ZIP/CHARX；文件可能损坏或根本不是图片` |

---

## 5. 与 CCv3 迁移的分工（谁干什么）

```
浏览器                        宿主（Node）                          磁盘
─────────────────────────────────────────────────────────────────────────────
<input type=file>
  ↓ ArrayBuffer → base64
POST /character/import  ──►  readBody（⚠ 需要放宽上限，见 §7.2）
  {fileName, dataBase64}      ↓ Buffer.from(base64)
                              parseCardBuffer()      ← 本模块（纯、无 IO）
                              ↓ {card, format, warnings}
                              （可选）normalizeCard(card)   ← architect：补默认值
  ◄── {ok, card, format, warnings, name}
用户看预览 → 确认
POST /character/save    ──►  双入口：{name, ccv3}       ← architect
  {name, ccv3}                ↓ writeCard()（补 legacy.from / at / touchIndex）
                                                              characters/<name>/card.json
```

**本模块的边界就在 `parseCardBuffer` 的返回值**：它不知道 `name` 从哪来（目录名）、不碰 `_index.json`、不打时间戳。这三件事全是保存路径的。

### 5.1 与 `tavern.ts` 的类型分工（已核对 `src/tavern.ts:338-360`）

```
parseCardBuffer()  →  CharacterCardV3Like（本模块，宽松：只保证 spec / spec_version / data）
normalizeCard()    →  CharacterCardV3     （architect，宽松入、严格出：fillDataDefaults + deriveFromNative）
```

- `parseCardBuffer` 的返回类型**故意**比 `tavern.ts` 的 `CharacterCardV3` 松：外部卡常常缺 `tags` /
  `creator` / `group_only_greetings`，甚至没有 `data.name`。让解析器去补默认值，等于把归一化职责劈成两半，
  两处默认值迟早不一致。
- `normalizeCard(input: unknown, opts)` 收 `unknown`，所以直接喂 `parseCardBuffer(...).card` 即可，
  **不需要任何适配层**。
- 存放时的 `spec_version`：解析器已经规范成 `3.0`；`normalizeCard` 的 V3 分支不会再改它。

### 5.2 接线路由只有两行

```ts
// architect 的 src/web.ts，POST /character/import
const buf = Buffer.from(String(body['dataBase64'] ?? ''), 'base64')
const parsed = parseCardBuffer(buf, String(body['fileName'] ?? ''))
send(res, 200, { ok: true, ...parsed, name: normalizeCard(parsed.card).data.name })
```

真正落盘仍是用户在面板确认后走 `POST /character/save { name, ccv3 }`（`writeCard` 负责
`legacy.from = parsed.format`、`at` 与 `touchIndex`）。

---

## 6. 前端流程设计（实现等 CCv3 定稿后再动）

### 6.1 入口

放在角色簿头部工具行，与「新建角色」「蒸馏」并列（`client/index.tsx:1422-1437` 那一行，当前已是三按钮的容量上限）：

```
│  共 3 位                    [⇥ 导入卡] [✒ 蒸馏] [＋ 新建角色] │
```

空态（`index.tsx:1441-1447`）也给一个，理由同蒸馏：**空角色簿最需要的就是"把已有的卡搬进来"**。

### 6.2 四态

```
idle ──选文件──► parsing ──成功──► preview ──确认──► 交给 CardEditor
                     └──失败──► error（可重选）
```

**preview 卡片要显示什么**（按重要性排序）：

```
┌─ 导入角色卡 ─────────────────────────────────┐
│ 📄 虞照.png · png · 1.8 MB                   │
│                                              │
│  虞照                    26 岁 · 合租室友     │
│  话多得要命，每天出门前给你留一张便利贴。      │
│  「诶诶诶！你几点回来啊」（first_mes 前 60 字）│
│  世界书：3 条 · 标签：2 个                     │
│                                              │
│  ⚠ 2 条提醒                                  │
│    · 已忽略 2 个 assets（本轮不做立绘落地）    │
│    · 这是 V2 卡，已包成 V3 形状               │
│                                              │
│  ⚠ 已有同名角色「虞照」，保存会覆盖它的卡      │
│                                              │
│                           [取消]  [进编辑器确认] │
└──────────────────────────────────────────────┘
```

- 预览字段全部来自 `card.data`，**不做自己的解析**（`name` / `description` 首段 / `first_mes` 截断 / `character_book.entries.length` / `tags.length`）。
- 重名检查在客户端用现有列表做一次即时提示（`index.tsx` 的 `list`），最终以保存路径为准。
- **warnings 用列表逐条展示**，不折叠、不合并计数——用户就是靠它判断「卡为什么少了东西」。

### 6.3 文案键（`import.*`，给 Lead 合并 `client/text.ts` 用）

| key | zh | en |
|---|---|---|
| `import.entry` | 导入卡 | Import |
| `import.entryTitle` | 从 PNG / CHARX / JSON 导入角色卡 | Import a card from PNG / CHARX / JSON |
| `import.title` | 导入角色卡 | Import character card |
| `import.pick` | 选一个 .png / .charx / .json 文件 | Pick a .png / .charx / .json file |
| `import.drop` | 也可以把文件拖进来 | Or drop the file here |
| `import.parsing` | 解析中… | Parsing… |
| `import.failed` | 这个文件没能读出卡片：{reason} | Could not read a card from this file: {reason} |
| `import.tooLarge` | 文件 {mb} MB，超过上限 {max} MB | {mb} MB exceeds the {max} MB limit |
| `import.warnings` | {n} 条提醒 | {n} notices |
| `import.nameTaken` | 已有同名角色「{name}」，保存会覆盖它的卡 | A character named “{name}” exists; saving overwrites its card |
| `import.openEditor` | 进编辑器确认 | Open in editor |
| `import.done` | 已导入「{name}」 | Imported “{name}” |

### 6.4 前端读取文件的两条路（推荐 A）

| | A. 前端只传字节，宿主解析（**推荐**） | B. 前端自己解析 |
|---|---|---|
| 代码 | `<input type=file>` → `arrayBuffer()` → base64 → `POST /character/import` | 把 `import-card.ts` 的逻辑搬进 `client/`（或 esbuild 共享） |
| 好处 | 解析器只有一份、可单测、错误文案统一 | 不占请求体、不受 body 上限约束 |
| 代价 | 要一条新路由 + **放宽 `readBody` 上限**（§7.2） | 逻辑双份，PNG/zip 解析进浏览器 bundle（+8 KB）且无法复用 47 项自检 |

选 A。`client/` 已经有「一个函数一个动作」的 `api.ts` 约定，加一个 `importCard(fileName, dataBase64)` 即可。

---

## 7. 需要别人配合的两件事

### 7.1 一条新路由（architect 的 `src/web.ts`）

```jsonc
POST /_dsh/ai-with-u/character/import
{ "fileName": "虞照.png", "dataBase64": "<文件的 base64>" }

200 { "ok": true, "card": {…CCv3…}, "format": "png", "warnings": ["…"], "name": "虞照" }
400 { "ok": false, "error": "这张 PNG 里没有 tEXt/iTXt 卡片数据…" }
```

handler 本体就是三行：`Buffer.from(dataBase64,'base64')` → `parseCardBuffer(buf, fileName)` → `send(200, {ok:true, ...})`。**不落盘**（保存走既有 `/character/save`）。

### 7.2 `readBody` 必须支持可选上限（**否则真实卡导不进来**）

`src/web.ts:32-44` 现在硬编码 4 MB。酒馆 PNG 卡带立绘常见 3–10 MB，base64 再 ×1.33 → 必然超。改法（约 6 行、向后兼容）：

```ts
// src/web.ts:32
async function readBody(req: IncomingMessage, limitBytes = 4 * 1024 * 1024): Promise<JsonBody> {
  // …原逻辑不变，只把 `4 * 1024 * 1024` 换成 limitBytes
}
// 只有 /character/import 传大的：
const body = await readBody(req, 16 * 1024 * 1024)
```

16 MB 对 base64 是约 12 MB 二进制，覆盖「带两张立绘的卡」；解析器自己的 64 MB 是纯函数闸，跟这条无关。

---

## 8. 测试（`scripts/verify-import.mjs`，47 项全绿）

**不依赖真实酒馆卡**：PNG 与 zip 都在内存里现造。

| 夹具 | 怎么造的 | 验证点 |
|---|---|---|
| 3×3 PNG（`ccv3`） | IHDR(3×3, RGB8) + `deflateSync` 的 IDAT（3 行 × (filter+9) 字节）+ `tEXt('ccv3', base64)` + IEND，**每个 chunk 自己算 CRC32** | format/name/`character_book` 原样带过来/干净卡 0 告警 |
| 同款但 `tEXt` 在 **IDAT 之前** | 调 chunk 顺序 | P1（不能遇到 IDAT 就收工） |
| 截断 PNG | 先放 `tEXt` 再切掉 IDAT 尾巴 20 字节 | P4（chunk 越界 → truncated 告警，卡仍读得到） |
| `chara` 段（V2） | keyword 换 `chara`，payload 换 V2 | 回退 + V2 告警 |
| 普通 PNG / 错 keyword / 坏 base64 | 造三种坏样本 | 三条报错文案 |
| CHARX（store / deflate） | 手写 local header + 中央目录 + EOCD（含 CRC32） | 两种压缩都能读 |
| CHARX + `assets/cover.png` | 多塞一个条目 | 只读 `card.json` + 「其它条目」告警 |
| CHARX 嵌套目录 | `mycard/card.json` | 取最浅 + 告警 |
| CHARX 反斜杠路径 | `mycard\card.json` | Z2（`\` 归一成 `/` 后仍命中） |
| CHARX 数据描述符模式 | 本地头 CRC/大小全写 0、置 flag bit3，真实值只在中央目录 | Z1（尺寸一律信中央目录，否则读到空数据） |
| 缺 card.json / 加密 / 方法 12 / 抹掉 EOCD | 手写坏 zip | 四条准确报错 |
| 裸 JSON：V3 / V2 / 只有 data / 缺名字 / assets+regex_scripts / v0.1 旧卡 / 非卡 / 坏 JSON | 直接 `JSON.stringify` | 归一与分流的全部分支 |
| 杂项：空 Buffer / `.png` 其实是 zip / 随机字节 / 假 png | — | 魔数优先 + 四条报错 |

跑法：

```powershell
npm run build:host
node scripts/verify-import.mjs     # 期望：酒馆卡导入自检全部通过（通过 47 项，失败 0 项）
```

**待 Lead 加一行**（`package.json`，我不动它）：

```jsonc
"verify:import": "node scripts/verify-import.mjs",
// 以及把它们串进 build：
"build": "... && node scripts/verify.mjs && node scripts/verify-import.mjs && node scripts/verify-session.mjs && node scripts/verify-host.mjs"
```

---

## 9. 明确不做

| 不做 | 理由 |
|---|---|
| `assets` / `embeded://` 立绘落地 | 需要磁盘布局、图片尺寸、清理策略；与「先能导入」相比是独立功能 |
| `regex_scripts` | muv 系专用（`<USER>`/`<BOT>` 占位符那套），本插件不执行脚本，剥掉并告知 |
| 世界书注入算法 | 归 `tavern-card.md` §4（⏳ 调研中）；本模块只透传 `character_book` |
| 加密 zip / ZIP64 | 真实酒馆卡极少见；报准确错比半吊子支持好 |
| 写盘 / 建目录 / 更新索引 | 走 architect 的双入口 `/character/save`（`writeCard` 已负责 `touchIndex`） |
| 34 字段旧卡迁移 | 归 `normalizeCard`（`src/tavern.ts`），本模块遇到就指路 |
| 一张 PNG 里多张卡 | 酒馆卡规范是一张一卡；多张时只取第一个命中的关键字 |

## 10. 风险

| 风险 | 影响 | 预案 |
|---|---|---|
| 真实卡的 tEXt 用了非标准 keyword（如 `chub`、`V2`） | 读不出来 | 报错里**列出找到的 keyword**，用户能判断；若确认有第三种主流写法，再进 `PNG_KEYWORDS`（一行） |
| PNG 被图床重压、tEXt 被剥掉 | 读不出卡 | 报「没有 tEXt」，并提示「这张图可能被压缩过，请用原始文件」 |
| base64 经 HTTP 后体积膨胀导致 body 超限 | 大卡导不进来 | §7.2 放宽到 16 MB；前端在选文件时就按 `IMPORT_LIMITS.maxBytes` 拦一次 |
| `inflateRawSync` 遇到恶意 zip 炸弹 | 内存 | 三道闸（中央目录声明值 / `maxOutputLength` / 解出后复验） |
| 卡里 `data.name` 与文件名不一致 | 目录名叫什么 | 预览里把「文件名」和「卡内名字」都显示出来，由用户确认；最终以用户确认的名字为准（保存路径的既有语义） |

## 11. 验收步骤

1. `npm run build:host` → 0 error（`src/import-card.ts` 进 `lib/`）。
2. `node scripts/verify-import.mjs` → **47 项全绿**。
3. Lead 加 `package.json` 的 `verify:import` 一行后，`npm run build` 仍三套自检全绿（+ 新增第四套）。
4. （等 CCv3 定稿）architect 加 `POST /character/import` 后：拿一张真实酒馆卡（PNG 与 CHARX 各一张）跑一次，确认 `card.data.name` / `description` / `character_book` 都在，`warnings` 里能看到 assets 被忽略。
5. （等前端接入）手验：选文件 → 预览分支正确 → 重名提示 → 进编辑器 → 保存后磁盘上是 CCv3。
