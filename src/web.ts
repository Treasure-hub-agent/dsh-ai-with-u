/**
 * AI WITH U · Web 路由
 *
 * 面板的全部数据接口。刻意做成纯 REST + JSON，前端只做渲染，
 * 这样面板换成任何技术栈都不影响宿主逻辑。
 *
 * 约定：所有响应都是 `{ ok: true, ... }` / `{ ok: false, error }`，
 * 与 `client/api.ts` 的信封一致；前端只需要认路径和字段名。
 *
 * 指令类接口（忘记 / 改日记 / 全新开始 / 彻底重置 / 关系 / 换一句开场）
 * 与 `tools.ts` 里的 awu_* 工具**共用 Store 的同一份逻辑**，行为一致。
 * @module dsh-ai-with-u/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Store, DiaryEditInput } from './store.js'
import type { PromptController } from './prompt.js'
import { distillFlowInfo } from './distill.js'
import { parseCardBuffer } from './import-card.js'
import { normalizeCard, cardName, toLegacyView } from './tavern.js'

export const ROUTE_PREFIX = '/_dsh/ai-with-u'

/** 普通请求体上限（4 MB）：面板的 JSON 请求远小于这个量。 */
export const BODY_LIMIT = 4 * 1024 * 1024
/**
 * 导入接口的请求体上限（16 MB）。
 * 带立绘的酒馆 PNG 卡常见 3–10 MB，走 base64 还要 ×1.33——4 MB 会让好卡直接进不来。
 * **只对 `/character/import` 放宽**，其余路由保持 4 MB（不放大无谓的攻击面）。
 */
export const IMPORT_BODY_LIMIT = 16 * 1024 * 1024

interface JsonBody { [key: string]: unknown }

function send(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.writeHead(status)
  res.end(bytes)
}

async function readBody(req: IncomingMessage, limitBytes: number = BODY_LIMIT): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > limitBytes) throw new Error(`请求体过大（上限 ${Math.round(limitBytes / 1024 / 1024)} MB）`)
    chunks.push(chunk as Buffer)
  }
  if (total === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('请求体必须是 JSON 对象')
  return parsed as JsonBody
}

export interface RouteHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void> | void
}

/** 写操作之后同步刷新提示词缓存（下一轮组装立刻生效）。 */
async function afterWrite(prompt: PromptController): Promise<void> {
  prompt.invalidate()
  await prompt.refresh()
}

/** 构造全部路由。返回 method+path → handler 的映射，由 index.ts 统一注册。 */
export function buildRoutes(store: Store, prompt: PromptController): Array<{ method: string; path: string; handler: RouteHandler }> {
  const guard = (fn: RouteHandler): RouteHandler => async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send(res, 400, { ok: false, error: message })
    }
  }

  /** 解析「操作哪个角色」：请求体显式 name 优先，否则用当前启用角色。 */
  const resolveName = (body: JsonBody): string => {
    const explicit = String(body['name'] ?? '').trim()
    if (explicit !== '') return explicit
    const active = prompt.characterName
    if (active === undefined) throw new Error('缺少角色名，且当前没有启用角色')
    return active
  }

  return [
    // ------------------------------------------------------------ 总览 / 统计
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/overview`,
      handler: guard(async (_req, res) => {
        const list = await store.listCharacters()
        const active = prompt.snapshot()
        const sourceCount: Record<string, number> = {}
        let totalMemory = 0
        let totalTurns = 0
        for (const item of list) {
          sourceCount[item.source] = (sourceCount[item.source] ?? 0) + 1
          totalMemory += item.memoryCount
          const session = await store.readSession(item.name)
          totalTurns += Number(session?.turn_count ?? 0) || 0
        }
        send(res, 200, {
          ok: true,
          root: store.root,
          active,
          relationTag: prompt.relationTag() ?? '',
          stats: {
            characters: list.length,
            memoryEntries: totalMemory,
            turns: totalTurns,
            bySource: sourceCount,
          },
          recent: list.slice(0, 5).map(i => ({ name: i.name, lastActive: i.lastActive, memoryCount: i.memoryCount })),
        })
      }),
    },
    // ------------------------------------------------------------ 角色列表
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/characters`,
      handler: guard(async (_req, res) => {
        send(res, 200, { ok: true, characters: await store.listCharacters() })
      }),
    },
    // ------------------------------------------------------------ 单角色详情
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/character`,
      handler: guard(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const name = url.searchParams.get('name') ?? ''
        const ccv3 = await store.readCcV3(name)
        if (ccv3 === undefined) { send(res, 404, { ok: false, error: `找不到角色：${name}` }); return }
        const relation = await store.relationState(name)
        send(res, 200, {
          ok: true,
          name,
          // 过渡期双视图（C7）：`card` 保持旧 34 字段语义（面板不改也能活），`ccv3` 是完整对象
          card: toLegacyView(ccv3),
          ccv3,
          diary: await store.readDiary(name),
          session: (await store.readSession(name)) ?? {},
          relation: { tag: `${name}（${relation.baseline}）`, bands: relation.bands, baseline: relation.baseline },
          openingState: await store.openingState(name),
        })
      }),
    },
    // ------------------------------------------------------------ 保存角色卡（C7 三键契约）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/character/save`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = String(body['name'] ?? '').trim()
        if (name === '') throw new Error('缺少角色名')
        const card = body['card']
        const ccv3 = body['ccv3']
        if (card === undefined && ccv3 === undefined) throw new Error('缺少 card 或 ccv3')
        if (card !== undefined && (typeof card !== 'object' || card === null || Array.isArray(card))) {
          throw new Error('card 必须是对象')
        }
        if (ccv3 !== undefined && (typeof ccv3 !== 'object' || ccv3 === null || Array.isArray(ccv3))) {
          throw new Error('ccv3 必须是对象')
        }
        // 结构是权威、原生是投影：给 card 就重投影，extensions.aiwu / character_book 原样保留
        const saved = await store.saveCard({ name, card, ccv3 })
        if (prompt.characterName === name) await afterWrite(prompt)
        send(res, 200, { ok: true, name: saved.name, card: toLegacyView(saved.card), ccv3: saved.card })
      }),
    },
    // ------------------------------------------------------------ 导入酒馆卡（PNG / CHARX / JSON）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/character/import`,
      handler: guard(async (req, res) => {
        // 只这个路由放宽到 16 MB：带立绘的 PNG 卡常超 4 MB
        const body = await readBody(req, IMPORT_BODY_LIMIT)
        const fileName = String(body['fileName'] ?? '').trim()
        const dataBase64 = String(body['dataBase64'] ?? '').trim()
        if (dataBase64 === '') throw new Error('缺少卡文件内容 dataBase64')
        // 解析错误原样透出（解析器已经有成套中文文案，别统一压成"导入失败"）
        const parsed = parseCardBuffer(Buffer.from(dataBase64, 'base64'), fileName)
        const fallbackName = fileName.replace(/\.[^./\\]+$/u, '').trim()
        const ccv3 = normalizeCard(parsed.card, { fallbackName })
        const name = cardName(ccv3).trim()
        if (name === '') throw new Error('无法确定角色名：卡片里没有 name，文件名也推不出来')
        const conflict = (await store.readCcV3(name)) === undefined ? undefined : { name }
        // **不写盘**：用户在面板确认后才走 /character/save
        send(res, 200, {
          ok: true,
          format: parsed.format,
          warnings: parsed.warnings,
          ccv3,
          name,
          ...(conflict === undefined ? {} : { conflict }),
        })
      }),
    },
    // ------------------------------------------------------------ 删除角色
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/character/delete`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = String(body['name'] ?? '').trim()
        const withMemory = body['withMemory'] === true
        if (name === '') throw new Error('缺少角色名')
        if (prompt.characterName === name) await prompt.deactivate()
        await store.deleteCharacter(name, withMemory)
        send(res, 200, { ok: true })
      }),
    },
    // ------------------------------------------------------------ 启用（插）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/activate`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = String(body['name'] ?? '').trim()
        if (name === '') throw new Error('缺少角色名')
        const state = await prompt.activate(name)
        send(res, 200, { ok: true, active: state })
      }),
    },
    // ------------------------------------------------------------ 退出（拔）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/deactivate`,
      handler: guard(async (_req, res) => {
        send(res, 200, { ok: true, active: await prompt.deactivate() })
      }),
    },
    // ------------------------------------------------------------ 切换交互模式
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/mode`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const mode = body['mode'] === 'text' ? 'text' : 'text+action'
        const name = prompt.characterName
        if (name === undefined) throw new Error('当前没有启用角色')
        const active = await prompt.setMode(mode)
        // 会话里的 mode 同步落盘，跨客户端口径一致
        const session = await store.readSession(name)
        if (session !== undefined) await store.writeSession(name, { ...session, mode })
        send(res, 200, { ok: true, active })
      }),
    },
    // ------------------------------------------------------------ 日记编辑
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/diary/save`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = String(body['name'] ?? '').trim()
        const entries = body['entries']
        if (name === '') throw new Error('缺少角色名')
        if (!Array.isArray(entries)) throw new Error('entries 必须是数组')
        const normalized = entries.map((e) => {
          const row = e as JsonBody
          return {
            date: String(row['date'] ?? ''),
            timeline: Array.isArray(row['timeline']) ? row['timeline'].map(String) : [],
            notes: Array.isArray(row['notes']) ? row['notes'].map(String) : [],
          }
        })
        await store.writeDiary(name, normalized)
        if (prompt.characterName === name) await afterWrite(prompt)
        send(res, 200, { ok: true })
      }),
    },
    // ------------------------------------------------------------ 忘记{事情}
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/forget`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = resolveName(body)
        const keyword = String(body['keyword'] ?? '').trim()
        if (keyword === '') throw new Error('缺少要忘记的关键词 keyword')
        const result = await store.forget(name, keyword)
        await afterWrite(prompt)
        send(res, 200, { ok: true, ...result })
      }),
    },
    // ------------------------------------------------------------ 改日记{内容}
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/diary/edit`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = resolveName(body)
        const text = String(body['text'] ?? '').trim()
        if (text === '') throw new Error('缺少改写后的内容 text')
        const patch: DiaryEditInput = {
          text,
          match: typeof body['match'] === 'string' ? body['match'] : undefined,
          date: typeof body['date'] === 'string' ? body['date'] : undefined,
          section: body['section'] === 'notes' ? 'notes' : body['section'] === 'timeline' ? 'timeline' : undefined,
          index: typeof body['index'] === 'number' ? body['index'] : undefined,
        }
        const result = await store.editDiary(name, patch)
        await afterWrite(prompt)
        send(res, 200, { ok: true, ...result })
      }),
    },
    // ------------------------------------------------------------ 全新开始 / 彻底重置
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/session/reset`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = resolveName(body)
        const scope = body['scope'] === 'all' ? 'all' : 'session'
        // 彻底重置是显式二次确认操作：面板必须带 confirmAll: true
        if (scope === 'all' && body['confirmAll'] !== true) {
          throw new Error('彻底重置需要确认（confirmAll: true）')
        }
        const result = scope === 'all'
          ? await store.resetStory(name)
          : await store.resetSession(name)
        await afterWrite(prompt)
        send(res, 200, { ok: true, ...result })
      }),
    },
    // ------------------------------------------------------------ 关系
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/relation`,
      handler: guard(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const explicit = (url.searchParams.get('name') ?? '').trim()
        const name = explicit !== '' ? explicit : prompt.characterName
        if (name === undefined) throw new Error('缺少角色名，且当前没有启用角色')
        const state = await store.relationState(name)
        send(res, 200, { ok: true, ...state, tag: `${state.character}（${state.baseline}）` })
      }),
    },
    // ------------------------------------------------------------ 换一句开场
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/opening/next`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = resolveName(body)
        const raw = body['candidates']
        const candidates = Array.isArray(raw) ? raw.map(String) : []
        const result = await store.rotateOpening(name, { candidates })
        await afterWrite(prompt)
        send(res, 200, { ok: true, ...result })
      }),
    },
    // ------------------------------------------------------------ 开局三态
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/opening/state`,
      handler: guard(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const name = (url.searchParams.get('name') ?? '').trim()
        if (name === '') throw new Error('缺少角色名')
        send(res, 200, { ok: true, ...await store.openingState(name) })
      }),
    },
    // ------------------------------------------------------------ 会话写入（供测试 / 外部客户端）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/session/commit`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const result = await store.commitTurn({
          character: typeof body['name'] === 'string' && body['name'].trim() !== '' ? body['name'].trim() : undefined,
          summary: typeof body['summary'] === 'string' ? body['summary'] : undefined,
          user: typeof body['user'] === 'string' ? body['user'] : undefined,
          assistant: typeof body['assistant'] === 'string' ? body['assistant'] : undefined,
          topic: typeof body['topic'] === 'string' ? body['topic'] : undefined,
          mood: typeof body['mood'] === 'string' ? body['mood'] : undefined,
          turnId: typeof body['turnId'] === 'string' ? body['turnId'] : undefined,
          count: body['count'] !== false,
        })
        await afterWrite(prompt)
        send(res, 200, { ok: true, ...result })
      }),
    },
    // ------------------------------------------------------------ 蒸馏：流程文件 + 要发送的指令
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/distill/flow`,
      handler: guard(async (_req, res) => {
        // 指令里只有 flow.md 的绝对路径与一句要求；流程正文永不进提示词（L2 铁律）
        send(res, 200, { ok: true, ...await distillFlowInfo() })
      }),
    },
    // 注：`POST /distill/parse`（粘贴卡片 JSON → 34 字段校验）已随「改 CCv3 格式」一起挂起，
    // 等 tavern 格式定稿后按新契约重做，见 docs/design/2026-10-30-distill-entry.md §5.2b。
  ]
}
