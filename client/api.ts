/**
 * AI WITH U · 数据接口层
 *
 * 这里刻意把所有宿主接口收拢成「一个函数一个动作」，组件只认这些函数：
 *  - 后端新增能力（忘记某条记忆 / 改写作风 / 全新开始 / 彻底重置 / 关系进度 /
 *    换开场 / 忘记归档 …）落地时，只需在 `Api` 里补一个同名方法 + 一个路径常量，
 *    组件那边调用一行即可，不必再翻 fetch 细节；
 *  - 未实现（404 / 501）的接口统一抛 `ApiUnavailableError`，UI 可以据此优雅降级
 *    （按钮置灰或提示「宿主侧尚未提供」），而不是弹一堆红字。
 *
 * 约定：所有接口都返回 `{ ok: boolean, error?: string }`，非 ok 一律抛错。
 */

export const API_PREFIX = '/_dsh/ai-with-u'

/** 接口路径常量。新增后端能力时在这里加，和 src/web.ts 一一对应。 */
export const ROUTES = {
  overview: '/overview',
  characters: '/characters',
  character: (name: string) => `/character?name=${encodeURIComponent(name)}`,

  activate: '/activate',
  deactivate: '/deactivate',
  setMode: '/mode',

  saveCharacter: '/character/save',
  deleteCharacter: '/character/delete',
  saveDiary: '/diary/save',

  // ---- 从作品蒸馏角色卡（v3：arm → 发指令 → AI 自己落盘）----
  distillFlow: '/distill/flow',
  distillState: '/distill/state',
  distillArm: '/distill/arm',
  distillDisarm: '/distill/disarm',
  distillParse: '/distill/parse',

  // ---- 记忆与剧情维护（后端 task-1 新增）----
  forget: '/forget',
  diaryEdit: '/diary/edit',
  sessionReset: '/session/reset',
  relation: (name: string) => `/relation?name=${encodeURIComponent(name)}`,
  openingNext: '/opening/next',
  openingState: (name: string) => `/opening/state?name=${encodeURIComponent(name)}`,
} as const

/** 宿主侧还没提供的能力：UI 用来决定「降级展示」而不是「报错」。 */
export class ApiUnavailableError extends Error {
  constructor(public readonly path: string) {
    super(`宿主侧尚未提供该能力：${path}`)
    this.name = 'ApiUnavailableError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...init,
    })
  } catch (error) {
    throw new Error(`连不上宿主接口（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }

  // 404 / 501 有两种截然不同的来源，必须分开：
  //   a) 路由压根没注册（宿主版本旧 / 插件没挂上）→ 宿主落到通用 404，拿不到 JSON 信封；
  //   b) 宿主自己的业务 404（`web.ts` 的「找不到角色：X」）→ 有 `{ ok:false, error }` 信封。
  // 以前一律按 (a) 处理，于是「角色刚被删掉」会被提示成「宿主侧尚未提供该能力」，
  // 而且 ErrorBar 的「重试」永远重试同一个地址。这里改成「先看响应体能不能解析」。
  const missingStatus = res.status === 404 || res.status === 501
  const asUnavailable = (): never => { throw new ApiUnavailableError(path) }

  let text: string
  try {
    text = await res.text()
  } catch (error) {
    throw new Error(`读取宿主响应失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }

  if (text.trim() === '') {
    if (missingStatus) asUnavailable()
    throw new Error(`宿主返回了空响应（HTTP ${res.status}）`)
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    if (missingStatus) asUnavailable()
    throw new Error(`宿主返回了非 JSON 响应（HTTP ${res.status}）`)
  }

  if (typeof body !== 'object' || body === null) {
    if (missingStatus) asUnavailable()
    throw new Error(`宿主返回了无法解析的数据（${path}）`)
  }
  const envelope = body as { ok?: unknown; error?: unknown }
  if (envelope.ok !== true) {
    const message = typeof envelope.error === 'string' && envelope.error !== ''
      ? envelope.error
      : `请求失败（HTTP ${res.status}）`
    throw new Error(message)
  }
  return body as T
}

function post<T>(path: string, payload: unknown = {}): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) })
}

// ---------------------------------------------------------------- 数据类型

/** 角色卡：七字段 schema 的宽松表示，字段值可能是字符串 / 数组 / 嵌套对象。 */
export type CardValue = string | string[] | Record<string, unknown> | number

/**
 * 角色卡。
 *
 * 用索引签名而不是逐字段声明：卡片是自由 JSON，后端允许任意附加字段
 * （`opening` / `openings` / `world` …），逐字段写死会让新字段过不了类型检查。
 * 已知字段用下面的访问器取，取不到就当没有。
 */
export interface Card {
  [key: string]: unknown
}

export interface CharacterSummary {
  name: string
  card: Card
  source: string
  /** ISO 时间戳；空串表示从未互动 */
  lastActive: string
  memoryCount: number
}

export interface ActiveState {
  enabled: boolean
  character?: string
  mode?: 'text' | 'text+action'
  activatedAt?: string
}

export interface Overview {
  ok: true
  root: string
  active: ActiveState
  stats: {
    characters: number
    memoryEntries: number
    turns: number
    bySource: Record<string, number>
  }
  recent: Array<{ name: string; lastActive: string; memoryCount: number }>
}

export interface DiaryEntry {
  date: string
  timeline: string[]
  notes: string[]
}

export interface CharacterDetail {
  ok: true
  name: string
  card: Card
  /**
   * 完整 CCv3 对象（{spec, spec_version, data}）。过渡期后端可能给，也可能只给旧视图。
   * 世界书 / 导出预览 / 未知键都从这里读，结构编辑仍走 card（旧 34 字段视图）。
   */
  ccv3?: Card
  /** 结构视图（与 card 同义；后端若单独给字段就用它）。 */
  fields?: Card
  diary: DiaryEntry[]
  session: { turn_count?: number; last_ts?: string; [key: string]: unknown }
  /** 后端增强字段（老版本可能没有）：关系锚定与开场三态 */
  relation?: RelationState
  openingState?: OpeningState
}

/** 关系：`baseline` 只是卡片文字推断出的「起点锚定」，实际档位由模型现算、不落盘。 */
export interface RelationState {
  character: string
  bands: readonly string[]
  baseline: string
  startText: string
  turnCount: number
  lastActive: string
  diaryEntries: number
  /** 后端给的展示标签，形如「虞照（亲近）」 */
  tag?: string
  note: string
}

/** 开局三态：none = 卡里没有开场；fresh-reset = 刚重置；history = 有历史档案。 */
export interface OpeningState {
  state: 'none' | 'fresh-reset' | 'history'
  opening: string
  openings: string[]
}

/** 「忘记」一次关键词清理的结果。 */
export interface ForgetResult {
  character: string
  keyword: string
  diary: { removedTimeline: string[]; removedNotes: string[]; removedDiaryFile: number }
  session: { removedRecent: string[]; topicCleared: boolean }
  card: { removed: string[] }
  changed: boolean
}

export interface DiaryEditInput {
  /** 改写后的新内容 */
  text: string
  /** 用哪段原文去定位（缺省时按 date/index 定位） */
  match?: string
  date?: string
  section?: 'timeline' | 'notes'
  index?: number
}

export interface DiaryEditResult {
  character: string
  entry: { date: string; section: 'timeline' | 'notes'; index: number }
  before: string
  after: string
  /** 命中的候选条数；>1 说明定位不唯一，后端取了第一条 */
  candidates: number
  sessionUpdated: boolean
}

export interface ResetResult {
  character: string
  scope: 'session' | 'all'
  session: Record<string, unknown>
  /** scope='session'：保留的日记条目数 */
  diaryKept?: number
  /** scope='all'：删除的日记条目数 */
  diaryRemoved?: number
}

export interface OpeningResult {
  character: string
  opening: string
  openings: string[]
  /** true = 有历史档案，本次没动 openings（对话中不重发开场） */
  history: boolean
  /** true = 卡里没有 openings，需要模型生成候选后再带 candidates 调一次 */
  needGenerate?: boolean
  generated?: number
}

// ---------------------------------------------------------------- 动作函数

/** 总览：启用态 + 全局统计。 */
export function fetchOverview(): Promise<Overview> {
  return request<Overview>(ROUTES.overview)
}

/** 角色簿：全部角色及其卡片、记忆条数。 */
export async function fetchCharacters(): Promise<CharacterSummary[]> {
  const body = await request<{ characters?: CharacterSummary[] }>(ROUTES.characters)
  return Array.isArray(body.characters) ? body.characters : []
}

/** 单角色详情：完整角色卡 + 日记 + 会话。 */
export function fetchCharacter(name: string): Promise<CharacterDetail> {
  return request<CharacterDetail>(ROUTES.character(name))
}

/** 启用角色（插入人设）。 */
export function activateCharacter(name: string): Promise<{ active: ActiveState }> {
  return post<{ active: ActiveState }>(ROUTES.activate, { name })
}

/** 退出角色（干净拔出）。 */
export function deactivateCharacter(): Promise<{ active: ActiveState }> {
  return post<{ active: ActiveState }>(ROUTES.deactivate)
}

/** 切换交互模式：text = 纯文本，text+action = 文本+动作。 */
export function setInteractionMode(mode: 'text' | 'text+action'): Promise<{ active: ActiveState }> {
  return post<{ active: ActiveState }>(ROUTES.setMode, { mode })
}

/** 新建 / 覆盖角色卡。 */
/**
 * 保存角色卡。
 *
 * 三键并存（架构稿 C7）：card 是结构视图（编辑面），ccv3 是完整对象（世界书 / 未知键）。
 * 只发 card 时后端走纯结构合并（romLegacyView）；带 ccv3 时以它为底再合并。
 * 不传 ccv3 就不塞这个键，避免用空对象覆盖掉后端的完整数据。
 */
export function saveCharacter(name: string, card: Card, ccv3?: Card): Promise<{ name: string }> {
  return post<{ name: string }>(ROUTES.saveCharacter, ccv3 === undefined ? { name, card } : { name, card, ccv3 })
}

/** 删除角色。withMemory=true 时连同日记一并删除。 */
export function deleteCharacter(name: string, withMemory = false): Promise<unknown> {
  return post(ROUTES.deleteCharacter, { name, withMemory })
}

// ---------------------------------------------------------------- 蒸馏（v2）

/**
 * 蒸馏流程文件信息（随包发布的 `distill/flow.md`）。
 *
 * `instruction` 就是「发进当前会话的那段话」：它只包含流程文件的绝对路径与一句要求，
 * 正文（阶段、字段契约、输出格式）由模型自己去读文件 —— 所以契约永远不进 system prompt，
 * 也不进这段指令（L2 原则的 v2 落地方式）。
 */
export interface DistillFlowInfo {
  ok: true
  /** flow.md 的绝对路径（模型按它去读文件） */
  path: string
  /** 要发进会话的指令全文 */
  instruction: string
  /** instruction 的字符数（面板用来判断会不会太长） */
  chars: number
  /** flow.md 自身的字符数（用于确认文件存在且非空） */
  flowChars: number
}

/** 读蒸馏流程文件与要发送的指令。 */
export function fetchDistillFlow(): Promise<DistillFlowInfo> {
  return request<DistillFlowInfo>(ROUTES.distillFlow)
}

// ---------------------------------------------------------------- 蒸馏（v3：全自动落盘）
//
// 主人要求「AI 直接完成到底直到卡落地保存，没必要让用户自己粘贴回来」。所以流程变成：
//   arm（拿指令 + 开启这次蒸馏窗口）→ 把指令发进会话 → AI 自己跑完并调用 awu_card_save 落盘。
// 面板不再接收/校验卡片，只负责「开始」与「看到新卡」（后者由面板轮询 /characters）。

/** `GET /distill/state`：这次蒸馏窗口的状态。 */
export interface DistillState {
  ok: true
  /** 是否已经 arm 过（AI 的保存工具只在窗口内可用） */
  armed: boolean
  /** 窗口到期时间（ISO）；没有窗口时为 undefined */
  expiresAt?: string
  /** 最近一次由 AI 保存成功的卡（用于「刚才存了一张：xxx」） */
  lastSaved?: { name: string; at: string }
}

/** `POST /distill/arm`：开一次蒸馏窗口，并拿到要发进会话的指令。 */
export interface DistillArmResult {
  ok: true
  /** 要发进当前会话的那段话（含 flow.md 绝对路径 + 要求） */
  instruction: string
  /** flow.md 的绝对路径（调试/展示用，可能缺） */
  path?: string
  /** 窗口到期时间（ISO） */
  expiresAt?: string
}

/** 读这次蒸馏窗口的状态（打不开也不该影响主流程，调用方自己吞错）。 */
export function fetchDistillState(): Promise<DistillState> {
  return request<DistillState>(ROUTES.distillState)
}

/**
 * 开一次蒸馏窗口。
 *
 * 宿主侧会给这次会话盖一个带过期的「允许 AI 落盘」标记——AI 的 `awu_card_save` 只在窗口内可用，
 * 过期自动失效，所以这个函数**总是先调**，再发送指令。
 */
export function armDistill(): Promise<DistillArmResult> {
  return post<DistillArmResult>(ROUTES.distillArm)
}

/** 收掉窗口（用户取消 / 关弹层但没发出去时调用）。幂等。 */
export function disarmDistill(): Promise<unknown> {
  return post(ROUTES.distillDisarm)
}

/**
 * 蒸馏卡片的校验结果（**骨架，签名先定死**）。
 *
 * ⏸ 实现挂起：卡片格式要改成酒馆卡 CCv3（`spec: chara_card_v3` + `character_book`），
 * 宿主的 `POST /distill/parse` 与 34 字段校验等 tavern 格式定稿后重做
 * （存档：docs/design/2026-10-30-distill-entry.md §5.2b / §5.7）。
 * 在那之前调用会拿到「宿主侧尚未提供该能力」（路由未注册 → 404 无信封）。
 */
export interface DistillParseResult {
  ok: true
  card: Record<string, unknown>
  stats: { filled: number; total: number }
  missingGroups: string[]
  missingFields: string[]
  warnings: string[]
  conflict?: { name: string }
}

/**
 * 把模型输出的自由文本校验成一张可进编辑器的卡（**骨架**）。
 *
 * 路由尚未注册，调用会抛 `ApiUnavailableError`；`UI` 侧此刻不接这条路径，
 * 保留函数只为锁住前后端签名，等格式定稿后填实现。
 */
export function parseDistillCard(raw: string): Promise<DistillParseResult> {
  return post<DistillParseResult>(ROUTES.distillParse, { raw })
}

/** 覆写角色日记。 */
export function saveDiary(name: string, entries: DiaryEntry[]): Promise<unknown> {
  return post(ROUTES.saveDiary, { name, entries })
}

/**
 * 忘记某个关键词：从日记、会话最近记录、角色卡里一起清掉。
 * `name` 省略时用当前启用角色。
 */
export function forgetKeyword(keyword: string, name?: string): Promise<ForgetResult> {
  return post<ForgetResult>(ROUTES.forget, { keyword, ...(name === undefined ? {} : { name }) })
}

/** 改写一条日记。`match` 优先；否则按 date/section/index 定位。 */
export function editDiary(name: string, patch: DiaryEditInput): Promise<DiaryEditResult> {
  return post<DiaryEditResult>(ROUTES.diaryEdit, { name, ...patch })
}

/**
 * 全新开始 / 彻底重置。
 *
 * - `scope: 'session'` —— 清空最近记录、心情、话题、轮数，**保留日记**；
 * - `scope: 'all'` —— 连日记一起清空。宿主侧强制要求 `confirmAll: true`，
 *   缺少时返回 400，所以这里一并发出。
 */
export function resetSession(
  scope: 'session' | 'all',
  name?: string,
): Promise<ResetResult> {
  const body: Record<string, unknown> = { scope }
  if (name !== undefined) body['name'] = name
  if (scope === 'all') body['confirmAll'] = true
  return post<ResetResult>(ROUTES.sessionReset, body)
}

/** 关系状态：标签、五档、起点锚定。 */
export function fetchRelation(name: string): Promise<RelationState & { ok: true }> {
  return request<RelationState & { ok: true }>(ROUTES.relation(name))
}

/**
 * 换一句开场。
 *
 * `history: true` 时后端不会改 openings（对话中不重发开场）；
 * `needGenerate: true` 表示卡里没有开场，需要模型生成候选后再带 `candidates` 调一次。
 */
export function nextOpening(name: string, candidates?: string[]): Promise<OpeningResult> {
  const body: Record<string, unknown> = { name }
  if (candidates !== undefined && candidates.length > 0) body['candidates'] = candidates
  return post<OpeningResult>(ROUTES.openingNext, body)
}

/** 开场三态，用来决定「换开场」按钮该显示什么。 */
export function fetchOpeningState(name: string): Promise<OpeningState & { ok: true }> {
  return request<OpeningState & { ok: true }>(ROUTES.openingState(name))
}

/**
 * 组装一张最小可用的角色卡（新建角色用）。
 *
 * 对齐 `src/store.ts` 的 REQUIRED_FIELDS：name / basic / personality / relationship / source。
 * 其余字段留空，交给用户后续在角色卡里补全——最少的信息也要能立刻启用。
 */
export function draftCard(name: string, role: string, blurb: string): Card {
  const basic: Record<string, unknown> = { 姓名: name }
  if (role !== '') basic['身份'] = role
  if (blurb !== '') basic['一句话背景'] = blurb
  return {
    name,
    basic,
    personality: {},
    relationship: {},
    voice: {},
    source: 'custom',
  }
}

/** 判断一个错误是不是「宿主还没提供这个接口」。 */
export function isUnavailable(error: unknown): error is ApiUnavailableError {
  return error instanceof ApiUnavailableError
}

/** 把任意抛出物转成一句人话。 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
