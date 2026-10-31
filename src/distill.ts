/**
 * AI WITH U · 从作品蒸馏角色卡（v2：消息通道）
 *
 * 职责边界（2026-10-30 22:00 调整）：
 *   - 本文件**只负责**：定位并读取 `distill/flow.md`、生成要发进当前会话的指令文本。
 *   - **卡片格式与校验已挂起**：主人拍板改成酒馆卡 CCv3（`spec: chara_card_v3`，含 `character_book`），
 *     原来的「10 组 34 字段 + V1–V13 校验」随格式一起重做。那部分设计存档在
 *     `docs/design/2026-10-30-distill-entry.md` §5.6 / §5.7 / 附录 B，等 tavern 格式定稿再回来。
 *
 * 所以这里除「读一个 markdown 文件」之外**零 IO、零依赖**，也不会随格式变化而改。
 * @module dsh-ai-with-u/distill
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Store } from './store.js'
import { normalizeCharacterName } from './store.js'
import {
  CARD_SPEC,
  CARD_SPEC_VERSION,
  countFilledFields,
  lengthWarnings,
  normalizeCard,
  toLegacyView,
  type CharacterCardV3,
  type LegacyCardView,
} from './tavern.js'

/** 流程文件名（放在包根的 `distill/` 下，随 `package.json` 的 files 发布）。 */
export const DISTILL_FLOW_FILE = 'flow.md'

/**
 * `distill/flow.md` 的绝对路径。
 *
 * 与 `src/index.ts:152` 定位 `presets/` 的写法一致：本文件编译到 `lib/distill.js`，
 * 所以 `dirname(import.meta.url)/..` 就是包根。
 */
export function distillFlowPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'distill', DISTILL_FLOW_FILE)
}

export interface DistillFlowFile {
  path: string
  text: string
  chars: number
}

/** 读流程文件全文。缺失或空白都用「可操作」的中文报错，不吞异常。 */
export async function readDistillFlow(): Promise<DistillFlowFile> {
  const path = distillFlowPath()
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    const reason = error instanceof Error ? error.message : String(error)
    if (code === 'ENOENT') {
      throw new Error(`找不到蒸馏流程文件：${path}（插件安装不完整：distill/flow.md 应随包发布）`)
    }
    throw new Error(`读取蒸馏流程文件失败：${path}（${reason}）`)
  }
  if (text.trim() === '') throw new Error(`蒸馏流程文件是空的：${path}`)
  return { path, text, chars: text.length }
}

/**
 * 生成要发进当前会话的那段指令。
 *
 * 设计约束（L2 铁律）：指令里**只有**绝对路径 + 行为要求，**不放**任何字段契约正文。
 * 契约正文由模型自己去读 md —— 这样这段指令即使被贴进会话，也只是一句「去读这个文件」。
 * 卡片格式（CCv3）最终也写在 md 里，这段指令**不需要跟着改**。
 */
export function buildDistillInstruction(flowPath: string): string {
  return [
    '请帮我从作品里蒸馏一张角色卡。',
    '',
    '第一步：完整读取这份流程文件，按它执行：',
    flowPath,
    '',
    '要求：',
    '1. 读完先只回一句「流程已读，请给我作品名或角色名」，不要提前开讲。',
    '2. **把活派出去**：蒸馏要跑六 Phase、多次联网核实，很占上下文。',
    '   如果你有子代理能力（subagent / spawn / task 一类），就把它整单派给一个子代理去做，',
    '   你只负责转交素材、汇报结果、需要我拍板时来问我；**不要在当前会话里跑完整流程**。',
    '   没有子代理能力时才自己跑，但同样要压缩中间过程（一次只问一个问题、不要刷屏）。',
    '3. **先联网核实再动笔**：官方资料、百科、作品 wiki、角色台词/语音都要查，至少两个来源对得上才算事实。',
    '   检索工具不可用时才退回模型知识，并明确告诉我哪些内容是凭记忆写的。',
    '4. 该存卡的时候直接调用 awu_card_save({ name, data }) 存进插件，不要把卡贴给我、不要输出 JSON 代码块。',
    '5. 重名先问我要不要覆盖；其它 awu_* 工具不要动。',
    '',
    '作品：（在这里贴正文，或只给作品名 + 角色名；只给名字我也会先联网核实再动笔）',
  ].join('\n')
}

export interface DistillFlowInfo {
  path: string
  instruction: string
  chars: number
  flowChars: number
}

/** `GET /distill/flow` 的返回体（不含信封里的 ok）。 */
export async function distillFlowInfo(): Promise<DistillFlowInfo> {
  const flow = await readDistillFlow()
  const instruction = buildDistillInstruction(flow.path)
  return { path: flow.path, instruction, chars: instruction.length, flowChars: flow.chars }
}

// ============================================================================ v3：全自动蒸馏（时间窗门控 + 常驻 awu_card_save）

/**
 * 武装有效期：2 小时。
 * 够长到"用户点开始蒸馏、读完作品、聊几轮补充细节、最后出卡"；够短到"忘了取消也不会长期开门"。
 */
export const DISTILL_ARM_TTL_MS = 2 * 60 * 60 * 1000

/**
 * 时间窗对工具服务要做的事（由 `index.ts` 提供）。
 *
 * ⚠️ 这里**不再注册/注销工具**：`awu_card_save` 在插件作用域内常驻注册，
 * 由 `arm.armed` 门控（未武装时 execute 返回 `not-armed`）。
 * 早期版本在 HTTP 请求里动态 register，请求作用域一销毁工具就被移除，
 * 再次武装还会报 `cannot create effect on inactive context`。
 */
export interface DistillArmHooks {
  /** 检查工具服务是否就绪；未就绪返回 false（**武装必须失败**，不能装作成功）。 */
  mount(): boolean
  /** 关闭时间窗（仅日志与状态，不注销工具）。 */
  unmount(): void
}

export interface DistillArmSnapshot {
  armed: boolean
  /** 到期时刻（本地时区 ISO）；未武装时不出现。 */
  expiresAt?: string
  /** 最近一次通过 `awu_card_save` 落盘的结果（面板用来显示"新卡已保存"）。 */
  lastSaved?: { name: string; at: string }
}

function isoNow(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/**
 * 蒸馏武装（**内存态，绝不落盘**）。
 *
 * 语义：
 *   - `arm()`：打开时间窗 + 记 TTL；工具服务未就绪则抛错（不假武装）。
 *   - 成功保存一次 → 自动 `disarm()`（主人要求：这份"能写卡的权力"只开一次门）。
 *   - `snapshot().armed` 在 TTL 到期的瞬间自动变成 false（`awu_card_save` 随即返回 `not-armed`）。
 *   - 重启即失效：没有任何状态写到磁盘上（避免模型在任何会话里突然能写卡）。
 *   - 工具本身常驻注册，创建/销毁只发生在插件 apply/dispose 的活跃作用域里。
 */
export class DistillArm {
  private expiresAtMs: number | undefined
  private mounted = false
  private saved: { name: string; at: string } | undefined

  constructor(
    private readonly hooks: DistillArmHooks,
    /** 可注入时钟（自检用）：默认 `Date.now`。 */
    private readonly now: () => number = () => Date.now(),
  ) {}

  get armed(): boolean {
    if (this.expiresAtMs === undefined) return false
    if (this.now() >= this.expiresAtMs) {
      // TTL 到期：先卸工具再清状态，绝不把"已过期但还挂着工具"的状态露出去
      this.disarm()
      return false
    }
    return true
  }

  /** 武装（重复调用等于续期）。工具挂不上就抛错——不允许"看起来武装了但模型没有工具"。 */
  arm(ttlMs: number = DISTILL_ARM_TTL_MS): DistillArmSnapshot {
    if (!this.mounted) {
      const ok = this.hooks.mount()
      if (!ok) throw new Error('宿主未提供工具服务，无法武装 awu_card_save（蒸馏工具挂不上去）')
      this.mounted = true
    }
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.max(1000, Math.floor(ttlMs)) : DISTILL_ARM_TTL_MS
    this.expiresAtMs = this.now() + ttl
    return this.snapshot()
  }

  /** 手动收：卸工具 + 清 TTL（保存完成后也走这里）。 */
  disarm(): void {
    this.expiresAtMs = undefined
    if (!this.mounted) return
    this.mounted = false
    try {
      this.hooks.unmount()
    } catch {
      // 卸载失败不能让调用方崩：记一次日志的成本比让"取消蒸馏"报错低
      this.mounted = false
    }
  }

  /** 给工具用：保存成功一次 → 记一笔 + 自动收权。 */
  markSaved(name: string): void {
    this.saved = { name, at: isoNow(new Date(this.now())) }
    this.disarm()
  }

  snapshot(): DistillArmSnapshot {
    const armed = this.armed
    const snap: DistillArmSnapshot = { armed }
    if (armed && this.expiresAtMs !== undefined) snap.expiresAt = isoNow(new Date(this.expiresAtMs))
    if (this.saved !== undefined) snap.lastSaved = { ...this.saved }
    return snap
  }
}

// ---------------------------------------------------------------- 模型落卡（唯一写入口）

export interface SaveCardRequest {
  name?: unknown
  data?: unknown
  overwrite?: unknown
}

export interface SaveCardSuccess {
  ok: true
  name: string
  action: 'created' | 'updated'
  stats: { filled: number; total: number }
  warnings: string[]
}

export interface SaveCardFailure {
  ok: false
  code: 'invalid-name' | 'invalid-data' | 'name-conflict'
  error: string
  /** 重名时给模型看的已有卡摘要（让它在"改名 / 覆盖"之间做决定）。 */
  existing?: {
    name: string
    filled: number
    identity: string
    background: string
    opening: string
  }
}

export type SaveCardOutcome = SaveCardSuccess | SaveCardFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clip(text: unknown, max: number): string {
  const flat = String(text ?? '').replace(/\s+/gu, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** 已有卡摘要（给"重名"错误体用；只给最少够判断的信息，不把整张卡吐给模型）。 */
function summarizeExistingCard(view: LegacyCardView): NonNullable<SaveCardFailure['existing']> {
  const basic = isRecord(view.basic) ? view.basic : {}
  return {
    name: String(view.name ?? ''),
    filled: countFilledFields(view).filled,
    identity: clip(basic['身份'], 40),
    background: clip(basic['一句话背景'], 80),
    opening: clip(view.opening, 60),
  }
}

/**
 * 模型落卡的**唯一通道**（`awu_card_save` 的实现体）。
 *
 * 不抛错：所有失败都返回 `{ ok:false, code, error }`，让模型自己读到原因并纠正
 * （工具抛错在 DSH 里会变成一条笼统的失败，模型看不到"重名了、已有卡长这样"这种关键信息）。
 *
 * 校验顺序（写盘前全部过一遍）：
 *   1. 名字：`normalizeCharacterName`（路径分隔符 / Windows 非法字符 / 保留设备名 / 长度）；
 *   2. `data` 必须是对象，且至少有一项实质内容（description / personality / scenario / first_mes / mes_example）；
 *   3. 重名：已存在且没带 `overwrite: true` → 拒绝并给摘要（**不写盘**）；
 *   4. `normalizeCard` 补默认值 → `saveCard` 落 CCv3 + 更新索引。
 */
export async function saveCardFromModel(store: Store, input: SaveCardRequest): Promise<SaveCardOutcome> {
  let name: string
  try {
    name = normalizeCharacterName(typeof input.name === 'string' ? input.name : '')
  } catch (error) {
    return { ok: false, code: 'invalid-name', error: error instanceof Error ? error.message : String(error) }
  }

  const data = input.data
  if (!isRecord(data)) {
    return { ok: false, code: 'invalid-data', error: 'data 必须是对象（CCv3 的 data 部分：description / personality / first_mes / character_book …）' }
  }
  const substantive = ['description', 'personality', 'scenario', 'first_mes', 'mes_example']
    .some(key => String(data[key] ?? '').trim() !== '')
  if (!substantive) {
    return {
      ok: false,
      code: 'invalid-data',
      error: 'data 里没有任何实质内容：description / personality / scenario / first_mes / mes_example 至少要有一样',
    }
  }

  const existing = await store.readCardView(name)
  if (existing !== undefined && input.overwrite !== true) {
    return {
      ok: false,
      code: 'name-conflict',
      error: `已有同名角色「${name}」，本次没有写盘。先问用户：改名，还是覆盖？要覆盖就带 overwrite: true 再调用一次。`,
      existing: summarizeExistingCard(existing),
    }
  }

  const card = normalizeCard(
    { spec: CARD_SPEC, spec_version: CARD_SPEC_VERSION, data: { ...data, name } },
    { fallbackName: name, from: 'distill', now: new Date() },
  )
  const saved = await store.saveCard({ name, ccv3: card })
  const view = toLegacyView(saved.card)
  const warnings: string[] = lengthWarnings(saved.card).map(w => w.message)
  const voice = isRecord(view.voice) ? view.voice : {}
  const anchors = isRecord(view.memory_anchor) ? view.memory_anchor['要点'] : undefined
  if (String(view.opening ?? '').trim() === '' && !(Array.isArray(view.openings) && view.openings.length > 0)) {
    warnings.push('没有开场白（first_mes / alternate_greetings 都为空），第一次对话会从空白开始。')
  }
  if (Object.keys(voice).length === 0) {
    warnings.push('声线字段全空——「声线基因」是决定"像不像他"的灵魂字段，建议补到 extensions.aiwu.voice。')
  }
  if (!Array.isArray(anchors) || anchors.length === 0) {
    warnings.push('没有记忆锚点（extensions.aiwu.memoryAnchors），角色会缺少可复用的具体细节。')
  }

  return {
    ok: true,
    name: saved.name,
    action: existing === undefined ? 'created' : 'updated',
    stats: countFilledFields(view),
    warnings,
  }
}

/** 便于测试：显式引用一下类型，避免 tsc 认为导入未使用。 */
export type { CharacterCardV3 }