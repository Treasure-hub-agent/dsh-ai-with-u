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
import type { Store, DiaryEditInput, RelationBand } from './store.js'
import { RELATION_BANDS } from './store.js'
import type { PromptController } from './prompt.js'
import type { DistillArm, DistillKind } from './distill.js'
import { distillFlowInfo } from './distill.js'
import { parseCardBuffer } from './import-card.js'
import { normalizeCard, cardName, collectCardWarnings, toLegacyView } from './tavern.js'
import { convertStPreset } from './preset.js'

export const ROUTE_PREFIX = '/_dsh/ai-with-u'

/**
 * 本机回环主机名白名单。
 *
 * 用途是挡 **DNS rebinding**：恶意域名解析到 127.0.0.1 时，浏览器仍会带
 * `Host: evil.example`，这里直接拒。宿主自己的 `isTrustedApiRequest` 只保护
 * `/api` RPC，**不覆盖插件注册的 exact 路由**，所以这层必须插件自己加。
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * 信任的额外主机名（逗号分隔，可选）。
 *
 * 默认只信本机回环。若确实要通过隧道/反代从别的域名访问本机 GUI，
 * 用 `AIWU_TRUSTED_HOSTS=my.tunnel.example` 显式放行——默认拒绝，不靠猜。
 */
function trustedExtraHosts(): Set<string> {
  const raw = process.env['AIWU_TRUSTED_HOSTS'] ?? ''
  return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== ''))
}

/** 来源校验不通过 → 403（与业务错误 400 区分开）。 */
class OriginRejected extends Error {}
/** HTTP 方法不符合路由声明 → 405。 */
class MethodNotAllowed extends Error {}

/** 取单值请求头（Node 可能给 string[]）。 */
function headerOf(req: IncomingMessage, name: string): string {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return (raw[0] ?? '').trim()
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 从 Host 头里取主机名（兼容 `[::1]:50143` 这种 IPv6 写法）。 */
function hostNameOf(host: string): string {
  const value = host.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  return value.split(':')[0] ?? ''
}

/**
 * 来源栅栏：只接受「本机面板自己发的请求」。
 *
 * 三条判据（任何一条不过都拒）：
 *   1. `Host` 必须是本机回环 / 实际监听地址 / 显式放行的主机名；
 *   2. 带 `Origin` 时，必须与 `Host` 同 authority（浏览器跨站请求一定带 Origin）；
 *   3. `Sec-Fetch-Site: cross-site` 直接拒。
 *
 * 这不是 CSRF token 的替代品，但它把「任意网页 POST 删卡」和
 * 「DNS rebinding 读全量卡/日记」两条路都堵死了。
 */
function assertTrustedRequest(req: IncomingMessage): void {
  const host = headerOf(req, 'host')
  if (host === '') throw new OriginRejected('缺少 Host 头，已拒绝')
  const hostName = hostNameOf(host)
  const localAddress = String(req.socket?.localAddress ?? '').toLowerCase()
  const extra = trustedExtraHosts()
  const allowed = hostName !== ''
    && (LOOPBACK_HOSTS.has(hostName) || (localAddress !== '' && hostName === localAddress) || extra.has(hostName) || extra.has(host.toLowerCase()))
  if (!allowed) throw new OriginRejected(`拒绝非本机来源：Host=${host}`)

  const origin = headerOf(req, 'origin')
  if (origin !== '') {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new OriginRejected(`拒绝非法 Origin：${origin}`)
    }
    if (parsed.host.toLowerCase() !== host.toLowerCase()) {
      throw new OriginRejected(`拒绝跨站来源：Origin=${origin} Host=${host}`)
    }
  }
  if (headerOf(req, 'sec-fetch-site').toLowerCase() === 'cross-site') {
    throw new OriginRejected('拒绝跨站请求（Sec-Fetch-Site: cross-site）')
  }
}

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
  // 写操作必须 JSON：`text/plain` 属于「简单请求」，能绕过 CORS 预检直接打进来。
  // 面板自己一直带 application/json（见 client/api.ts），这里收紧不会误伤正常调用。
  if (!headerOf(req, 'content-type').toLowerCase().includes('application/json')) {
    throw new OriginRejected('写操作必须使用 Content-Type: application/json')
  }
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

/**
 * 写操作之后刷新**所有正在用这张卡的槽位**（全局 + 每个绑了它的会话）。
 *
 * 会话绑定存在之后，「改日记/忘记/重置/换开场」不能再只刷全局槽位：
 * 否则绑了这张卡的会话下一轮还是旧人设（用户视角就是"面板改了但角色没变"）。
 */
async function afterWriteFor(prompt: PromptController, character: string): Promise<void> {
  prompt.invalidate()
  await prompt.refreshCharacter(character)
}

/**
 * 解析「时间窗通道」：`distill`（从作品蒸馏，缺省）| `create`（骨架卡 AI 补全）。
 *
 * 缺省 distill 是**向后兼容**（旧面板的 arm 请求不带 kind）；非法值直接 400，
 * 不静默降级——面板写错 kind 时如果悄悄开了蒸馏窗口，用户会拿到一份错的指令。
 */
function parseKind(value: unknown, where: string): DistillKind {
  if (value === undefined || value === null || value === '') return 'distill'
  if (value === 'distill' || value === 'create') return value
  throw new Error(`${where} 的 kind 只能是 distill 或 create（收到 ${String(value)}）`)
}

/**
 * 构造全部路由。返回 method+path → handler 的映射，由 index.ts 统一注册。
 *
 * ⚠️ `webServer.register` 只吃 `{kind, path, handler}`，**`method` 字段从未生效**（host.md P0-1）。
 * 所以改状态的接口在 handler 里自己 `requireMethod(req, 'POST')`，别指望路由表拦。
 */
export function buildRoutes(
  store: Store,
  prompt: PromptController,
  arm?: DistillArm,
): Array<{ method: string; path: string; handler: RouteHandler }> {
  const guard = (fn: RouteHandler): RouteHandler => async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send(res, 400, { ok: false, error: message })
    }
  }

  /** 写操作接口自己校验 HTTP 方法（路由表的 method 是装饰品）。 */
  const requireMethod = (req: IncomingMessage, method: string): void => {
    const actual = String(req.method ?? 'GET').toUpperCase()
    if (actual !== method) throw new Error(`该接口只接受 ${method}（收到 ${actual}）`)
  }

  /** 解析「操作哪个角色」：请求体显式 name 优先，否则用当前启用角色。 */
  const resolveName = (body: JsonBody): string => {
    const explicit = String(body['name'] ?? '').trim()
    if (explicit !== '') return explicit
    const active = prompt.characterName
    if (active === undefined) throw new Error('缺少角色名，且当前没有启用角色')
    return active
  }

  const routes: Array<{ method: string; path: string; handler: RouteHandler }> = [
    // ------------------------------------------------------------ 总览 / 统计
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/overview`,
      handler: guard(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        // 面板知道自己在哪个会话就带上（`?sessionId=`），overview 会告诉它「当前会话启用」该怎么显示
        const querySessionId = (url.searchParams.get('sessionId') ?? '').trim()
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
        // 交互模式与 L1 渲染走同一个解析函数（session.mode > _active.mode > 'text+action'），
        // 否则会出现「面板说纯文本、模型还在写动作」的两套口径。
        const mode = await prompt.resolvedMode(querySessionId === '' ? undefined : querySessionId)
        const bindings = prompt.bindingSnapshot()
        const currentBinding = querySessionId === '' ? undefined : bindings[querySessionId]
        const target = prompt.resolveTarget(querySessionId === '' ? undefined : querySessionId)
        // 预设摘要：面板要能显示「当前生效的是哪套文风」
        const presetTarget = prompt.resolvePreset(querySessionId === '' ? undefined : querySessionId)
        const presetSnapshot = prompt.presetSnapshot()
        send(res, 200, {
          ok: true,
          root: store.root,
          active: { ...active, mode },
          mode,
          // 纪律包档位（off / lite / full）：面板据此显示开关状态
          discipline: prompt.disciplineLevel,
          relationTag: prompt.relationTag() ?? '',
          // ---- 会话绑定（「当前会话启用」按钮的数据源）----
          // 注意：`bindings` 是摘要，不是全量；面板判断「本会话能不能切」看 `sessionId !== ''`
          sessionId: querySessionId,
          bindings: {
            /** 绑定总数 */
            count: Object.keys(bindings).length,
            /** 当前会话的绑定（没绑定 / 没带 sessionId 时为 null） */
            current: currentBinding === undefined
              ? null
              : { sessionId: querySessionId, character: currentBinding.character, boundAt: currentBinding.boundAt },
            /** 当前会话最终用哪个角色（会话绑定 > 全局启用 > 未启用） */
            effective: {
              character: target.character ?? '',
              source: target.source,
            },
            items: Object.entries(bindings).map(([sessionId, binding]) => ({
              sessionId,
              character: binding.character,
              boundAt: binding.boundAt,
            })),
          },
          stats: {
            characters: list.length,
            memoryEntries: totalMemory,
            turns: totalTurns,
            bySource: sourceCount,
          },
          recent: list.slice(0, 5).map(i => ({ name: i.name, lastActive: i.lastActive, memoryCount: i.memoryCount })),
          // 预设摘要（会话预设 > 全局预设 > 无）：面板据此显示"当前生效什么"
          preset: {
            active: presetSnapshot.active,
            current: presetTarget.preset === undefined
              ? null
              : { id: presetTarget.preset.id, name: presetTarget.preset.name },
            source: presetTarget.source,
          },
        })
      }),
    },
    // ------------------------------------------------------------ 提示词预览（纯只读）
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/preview`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'GET')
        // `?sessionId=` 给了就预览「那个会话实际会注入什么」，不给就是全局视角。
        // **纯只读**：不 refresh、不 notify、不写盘。文本来自 PromptController 的真实渲染路径，
        // 绝不在这里重新拼一份（拼一份就等于给"预览与真实注入漂移"开了口子）。
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
        send(res, 200, { ok: true, ...prompt.preview(sessionId === '' ? undefined : sessionId) })
      }),
    },
    // ------------------------------------------------------------ 会话绑定（当前会话启用）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/bind`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = String(body['name'] ?? '').trim()
        const sessionId = String(body['sessionId'] ?? '').trim()
        if (name === '') throw new Error('缺少角色名 name')
        if (sessionId === '') throw new Error('缺少 sessionId（「当前会话启用」必须指名会话）')
        const binding = await store.bindSession(sessionId, name)
        await prompt.reloadBindings()
        prompt.refreshMount()
        send(res, 200, {
          ok: true,
          bound: true,
          character: binding.character,
          sessionId,
          boundAt: binding.boundAt,
        })
      }),
    },
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/unbind`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const sessionId = String(body['sessionId'] ?? '').trim()
        if (sessionId === '') throw new Error('缺少 sessionId')
        const previous = await store.unbindSession(sessionId)
        await prompt.reloadBindings()
        prompt.refreshMount()
        // 解除后该会话回落到全局启用（没有全局启用就是「未启用」）
        const effective = prompt.characterForSession(sessionId) ?? ''
        send(res, 200, {
          ok: true,
          bound: false,
          character: previous?.character ?? '',
          sessionId,
          effective,
        })
      }),
    },
    // ------------------------------------------------------------ 预设（提示词模块组）
    //
    // 预设与角色卡**正交**：预设只描述「怎么说」（文风 / 语气 / 回复规则），不写角色事实。
    // 启用决议与角色绑定同构：会话预设 > 全局预设 > 无（删掉不回落全局）。
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/presets`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'GET')
        const snapshot = prompt.presetSnapshot()
        send(res, 200, {
          ok: true,
          presets: snapshot.entries,
          active: snapshot.active,
        })
      }),
    },
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/preset`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'GET')
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = (url.searchParams.get('id') ?? '').trim()
        if (id === '') throw new Error('缺少预设 id')
        const preset = await store.readPreset(id)
        if (preset === undefined) { send(res, 404, { ok: false, error: `找不到预设：${id}` }); return }
        const snapshot = prompt.presetSnapshot()
        send(res, 200, { ok: true, preset, active: snapshot.active })
      }),
    },
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/preset/save`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const id = typeof body['id'] === 'string' ? body['id'] : undefined
        const preset = await store.savePreset({
          ...(id === undefined ? {} : { id }),
          name: String(body['name'] ?? ''),
          modules: body['modules'],
          ...(body['source'] === 'st' ? { source: 'st' as const } : {}),
        })
        await prompt.reloadPresets()
        prompt.invalidate()
        const stats = { moduleCount: preset.modules.length, enabledCount: preset.modules.filter(m => m.enabled !== false).length }
        send(res, 200, {
          ok: true,
          preset,
          warnings: stats.enabledCount === 0 ? ['这份预设的所有模块都是关闭状态，启用后不会注入任何内容'] : [],
        })
      }),
    },
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/preset/delete`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const id = String(body['id'] ?? '').trim()
        if (id === '') throw new Error('缺少预设 id')
        const result = await store.deletePreset(id)
        // 原本用它的会话要变成「无预设」（不回落全局）：只有删除方知道这个差别，先打标记
        prompt.notePresetDeleted(result.prunedSessions)
        await prompt.reloadPresets()
        prompt.invalidate()
        send(res, 200, { ok: true, prunedSessions: result.prunedSessions, wasGlobal: result.wasGlobal })
      }),
    },
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/preset/import`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const converted = convertStPreset(body['json'], {
          ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}),
        })
        if (!converted.ok) throw new Error(converted.error)
        const preset = await store.savePreset({
          name: converted.name,
          modules: converted.modules,
          source: 'st',
        })
        await prompt.reloadPresets()
        prompt.invalidate()
        send(res, 200, {
          ok: true,
          preset,
          warnings: converted.warnings,
          dropped: converted.dropped,
        })
      }),
    },
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/preset/activate`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const scope = body['scope'] === 'session' ? 'session' : 'global'
        const id = typeof body['id'] === 'string' ? body['id'].trim() : ''
        const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'].trim() : ''
        if (scope === 'session' && sessionId === '') {
          throw new Error('scope=session 时必须给 sessionId')
        }
        const active = await store.setPresetActive({
          scope,
          ...(id === '' ? {} : { id }),
          ...(scope === 'session' ? { sessionId } : {}),
        })
        await prompt.reloadPresets()
        prompt.invalidate()
        // 该会话的预览/面板会立刻反映；容器层的缓存不受影响（预设段本身不进 L1 缓存）
        send(res, 200, { ok: true, active })
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
        const querySessionId = (url.searchParams.get('sessionId') ?? '').trim()
        const ccv3 = await store.readCcV3(name)
        if (ccv3 === undefined) { send(res, 404, { ok: false, error: `找不到角色：${name}` }); return }
        const relation = await store.relationState(name)
        const bindings = prompt.bindingSnapshot()
        const boundSessions = Object.entries(bindings)
          .filter(([, binding]) => binding.character === name)
          .map(([sessionId]) => sessionId)
        const target = prompt.resolveTarget(querySessionId === '' ? undefined : querySessionId)
        send(res, 200, {
          ok: true,
          name,
          // 过渡期双视图（C7）：`card` 保持旧 34 字段语义（面板不改也能活），`ccv3` 是完整对象
          card: toLegacyView(ccv3),
          ccv3,
          diary: await store.readDiary(name),
          session: (await store.readSession(name)) ?? {},
          // tag 用当前档位（落盘值，缺省退回起点档）；baseline 单独给出，面板可以两个都显示
          relation: {
            tag: `${name}（${relation.current}）`,
            bands: relation.bands,
            baseline: relation.baseline,
            current: relation.current,
            log: relation.log,
          },
          // ---- 会话绑定（面板据此画「当前会话启用 / 全局启用」两个按钮的选中态）----
          binding: {
            /** 当前会话（带 `?sessionId=`）是否绑在这张卡上 */
            boundHere: querySessionId !== '' && bindings[querySessionId]?.character === name,
            /** 这张卡被哪些会话绑定（摘要，最多列出全部 sessionId） */
            sessions: boundSessions,
            /** 这张卡是否是全局启用角色 */
            global: prompt.characterName === name,
            /** 当前会话最终用哪个角色（会话绑定 > 全局启用 > 未启用） */
            effective: { character: target.character ?? '', source: target.source },
          },
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
        // 改卡后要刷**所有正在用它的槽位**（全局 + 每个绑了它的会话），否则会话里还是旧人设
        await prompt.refreshCharacter(saved.name)
        // warnings：保存**成功**但值得提示的事（当前是世界书超出建议预算，不拦、不截断）
        send(res, 200, {
          ok: true,
          name: saved.name,
          card: toLegacyView(saved.card),
          ccv3: saved.card,
          warnings: saved.warnings,
        })
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
        // 导入预览就把「世界书超出建议预算」告诉用户：解析器自己的 warnings + 卡片软警告，
        // 这样用户在点"确认导入"之前就知道这本世界书有多大、会不会被截（答：不会截，只是命中变少）。
        const warnings = [...parsed.warnings, ...collectCardWarnings(ccv3)]
        // **不写盘**：用户在面板确认后才走 /character/save
        send(res, 200, {
          ok: true,
          format: parsed.format,
          warnings,
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
        // 删卡连带清掉「绑在这张卡上」的会话绑定：留着就是悬空绑定（绑定的卡没了 = 该会话未启用）
        const pruned = await store.pruneBindingsOf(name)
        if (pruned.length > 0) {
          await prompt.reloadBindings()
          prompt.refreshMount()
        }
        send(res, 200, { ok: true, prunedBindings: pruned })
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
        const explicit = String(body['name'] ?? '').trim()
        const querySessionId = String(body['sessionId'] ?? '').trim()
        const activeName = prompt.characterName

        // ⓪ body 带 sessionId：按**该会话的决议角色**写（会话绑定 > 全局启用），
        //    这样「会话绑了 A、全局启用 B」时，在这个会话里切模式落到 A 身上
        if (querySessionId !== '') {
          const character = prompt.characterForSession(querySessionId)
          if (character !== undefined) {
            const result = await prompt.applyInteractionMode(mode, character)
            send(res, 200, {
              ok: true, active: result.active, name: character, mode,
              sessionId: querySessionId, scope: 'session',
            })
            return
          }
        }

        // ① 有启用角色（body 带不带 name 只要是同一个）：session 权威 + _active 兜底，并刷新 L1 模式段
        if (activeName !== undefined && (explicit === '' || explicit === activeName)) {
          const result = await prompt.applyInteractionMode(mode)
          send(res, 200, { ok: true, active: result.active, name: activeName, mode, scope: 'session' })
          return
        }
        // ② 没启用 / 指定的不是启用中的角色，但 body 带了 name：写那张卡的 session + 对齐全局兜底
        if (explicit !== '') {
          await store.setMode(explicit, mode)
          const active = await prompt.setMode(mode)
          send(res, 200, { ok: true, active, name: explicit, mode, scope: 'session' })
          return
        }
        // ③ 既没启用角色、body 也没带 name：只写全局兜底，**不报错**。
        //    语义 =「这是你对下一个启用角色的默认偏好」——对话模式胶囊在空闲态也要能点。
        const active = await prompt.setMode(mode)
        send(res, 200, { ok: true, active, mode, scope: 'global' })
      }),
    },
    // ------------------------------------------------------------ 纪律包档位
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/discipline`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const level = body['level']
        if (level !== 'off' && level !== 'lite' && level !== 'full') {
          throw new Error(`纪律包档位只能是 off / lite / full（收到 ${String(level)}）`)
        }
        const active = await prompt.setDiscipline(level)
        send(res, 200, { ok: true, discipline: level, active })
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
        await afterWriteFor(prompt, name)
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
        await afterWriteFor(prompt, name)
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
        await afterWriteFor(prompt, name)
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
        await afterWriteFor(prompt, name)
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
        send(res, 200, { ok: true, ...state, tag: `${state.character}（${state.current}）` })
      }),
    },
    // ------------------------------------------------------------ 写回关系档位（里程碑）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/relation/set`,
      handler: guard(async (req, res) => {
        const body = await readBody(req)
        const name = resolveName(body)
        const value = String(body['value'] ?? '').trim()
        if (!(RELATION_BANDS as readonly string[]).includes(value)) {
          // 非法档位走 guard → 400（不静默落成某个默认档）
          throw new Error(`关系档位只能是 ${RELATION_BANDS.join(' / ')}（收到 ${value === '' ? '空' : value}）`)
        }
        const state = await store.setIntimacy(
          name,
          value as RelationBand,
          typeof body['why'] === 'string' ? body['why'] : undefined,
        )
        await afterWriteFor(prompt, name)
        send(res, 200, { ok: true, ...state, tag: `${state.character}（${state.current}）` })
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
        await afterWriteFor(prompt, name)
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
        const written = result.character
        if (written !== undefined) await afterWriteFor(prompt, written)
        else await afterWrite(prompt)
        send(res, 200, { ok: true, ...result })
      }),
    },
    // ------------------------------------------------------------ 流程文件（只读，不武装）
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/distill/flow`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'GET')
        // `?kind=distill`（缺省，向后兼容）| `create`（自创角色 AI 补全）
        const url = new URL(req.url ?? '/', 'http://localhost')
        const kind = parseKind(url.searchParams.get('kind'), 'GET /distill/flow')
        // 指令里只有流程文件的绝对路径与一句要求；流程正文永不进提示词（L2 铁律）
        send(res, 200, { ok: true, ...await distillFlowInfo(kind, url.searchParams.get('name') ?? undefined) })
      }),
    },
    // ------------------------------------------------------------ 临时武装（挂 awu_card_save）
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/distill/arm`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'POST')
        if (arm === undefined) throw new Error('当前宿主未提供时间窗武装能力（工具服务未就绪）')
        // body 可空（旧面板不带 body）：不带就是蒸馏通道
        const body = await readBody(req)
        const kind = parseKind(body['kind'], 'POST /distill/arm')
        const name = typeof body['name'] === 'string' ? body['name'].trim() : ''
        // 先读指令再武装：流程文件缺失时不要先把写卡权力开出去
        const flow = await distillFlowInfo(kind, name)
        const snapshot = arm.arm(undefined, kind)
        send(res, 200, {
          ok: true,
          armed: snapshot.armed,
          // kind 必须回给面板：create 通道的 UI 文案与 distill 不同（同一个窗口，两条入口）
          kind: snapshot.kind,
          expiresAt: snapshot.expiresAt ?? '',
          instruction: flow.instruction,
          path: flow.path,
          chars: flow.chars,
          name: flow.name,
        })
      }),
    },
    {
      method: 'POST',
      path: `${ROUTE_PREFIX}/distill/disarm`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'POST')
        arm?.disarm()
        send(res, 200, { ok: true, ...(arm?.snapshot() ?? { armed: false, kind: 'distill' }) })
      }),
    },
    {
      method: 'GET',
      path: `${ROUTE_PREFIX}/distill/state`,
      handler: guard(async (req, res) => {
        requireMethod(req, 'GET')
        send(res, 200, { ok: true, ...(arm?.snapshot() ?? { armed: false, kind: 'distill' }) })
      }),
    },
  ]

  // 所有路由统一过一遍来源栅栏 + 方法校验。
  // 宿主的 webServer.register 只吃 {kind, path, handler}，路由表里的 `method` 会被丢掉，
  // 所以「GET 也能触发 deactivate」必须在这里自己接住，不能指望宿主。
  return routes.map(route => ({
    ...route,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        assertTrustedRequest(req)
        const actual = String(req.method ?? 'GET').toUpperCase()
        if (actual !== route.method) {
          throw new MethodNotAllowed(`该接口只接受 ${route.method}（收到 ${actual}）`)
        }
      } catch (error) {
        if (error instanceof OriginRejected) {
          send(res, 403, { ok: false, error: error.message })
          return
        }
        if (error instanceof MethodNotAllowed) {
          send(res, 405, { ok: false, error: error.message })
          return
        }
        throw error
      }
      await route.handler(req, res)
    },
  }))
}
