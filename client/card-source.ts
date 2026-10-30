/**
 * AI WITH U · 卡片来源适配（CCv3 过渡期）
 *
 * 后端在过渡期有三种形态，编辑器不该到处 `if (detail.ccv3)`：
 *
 *  1. `transition`  —— `GET /character` 同时给 `card`（旧 34 字段视图，编辑面）与 `ccv3`（完整对象）。
 *     这是架构稿 §6.5 推荐的形态，也是我们最终依赖的形态。
 *  2. `legacy-only` —— 只有旧 `card`（v0.1 后端 / 迁移未完成）。编辑照常，世界书视图隐藏。
 *  3. `native`      —— `card` 本身就是 CCv3 信封（硬切）。此时**没有结构视图**，
 *     人设视图要么用后端另给的 `fields`，要么只能提示"当前后端未提供结构视图"。
 *
 * 这一层只做"判形态 + 取对象"，不做任何数据变换：
 * 结构 → 原生的投影在后端（`fromLegacyView` / 写入时的投影），客户端抄一份必然漂移。
 */
import type { Card, CharacterDetail } from './api'

/** CCv3 信封标识；与 `src/tavern.ts` 的常量保持一致（客户端不 import 宿主代码）。 */
export const CCV3_SPEC = 'chara_card_v3'

export type CardMode = 'transition' | 'legacy-only' | 'native'

/** 后端可能多给这两个键；api.ts 的 `CharacterDetail` 还没声明，这里做局部扩展。 */
export type DetailWithCcV3 = CharacterDetail & {
  /** 完整 CCv3 对象（含 `data.character_book` / `data.extensions.aiwu`） */
  ccv3?: Card
  /** 结构视图（与 `card` 同义，后端若单独给就用它，优先级更高） */
  fields?: Card
}

export interface CardSource {
  mode: CardMode
  /** 34 字段结构视图（编辑面）。`native` 模式下可能是空对象。 */
  view: Card
  /** 完整 CCv3 对象（世界书 / 未知键 / 导出预览）。`legacy-only` 模式下是空对象。 */
  ccv3: Card
  /** 能不能编世界书 */
  hasLorebook: boolean
  /** 结构视图是否可信（`native` 且后端没给 fields 时为 false，UI 要提示） */
  viewTrusted: boolean
}

/** 对象判定（数组不算）；导出给 lorebook-schema 复用，避免两份实现。 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isObject = isObjectLike

/** 从 CCv3 信封里取 `data`；不是信封就返回空对象。 */
export function ccv3Data(ccv3: Card | undefined): Record<string, unknown> {
  if (!isObject(ccv3)) return {}
  if (ccv3['spec'] !== CCV3_SPEC) return {}
  const data = ccv3['data']
  return isObject(data) ? data : {}
}

/** 该 CCv3 对象里有没有可编的世界书条目。 */
export function hasBookEntries(ccv3: Card | undefined): boolean {
  const book = ccv3Data(ccv3)['character_book']
  if (!isObject(book)) return false
  return Array.isArray(book['entries']) && book['entries'].length > 0
}

/**
 * 判定来源形态并取出两套对象。
 *
 * 判据顺序（先强后弱）：
 *  ① 有 `ccv3` 且有 `card`      → transition
 *  ② `card` 自己是 CCv3 信封     → native（结构视图取 `fields`，没有就空）
 *  ③ 其它                        → legacy-only
 */
export function resolveCardSource(detail: DetailWithCcV3 | undefined): CardSource {
  const ccv3: Card = isObject(detail?.ccv3) ? detail.ccv3 : {}
  const fields: Card = isObject(detail?.fields) ? detail.fields : {}
  const card: Card = isObject(detail?.card) ? detail.card : {}

  if (Object.keys(ccv3).length > 0 && Object.keys(fields).length > 0) {
    return { mode: 'transition', view: fields, ccv3, hasLorebook: true, viewTrusted: true }
  }

  if (Object.keys(ccv3).length > 0 && Object.keys(card).length > 0) {
    return { mode: 'transition', view: card, ccv3, hasLorebook: true, viewTrusted: true }
  }

  if (card['spec'] === CCV3_SPEC) {
    const trusted = Object.keys(fields).length > 0
    return { mode: 'native', view: fields, ccv3: card, hasLorebook: true, viewTrusted: trusted }
  }

  return { mode: 'legacy-only', view: card, ccv3: {}, hasLorebook: false, viewTrusted: Object.keys(card).length > 0 }
}

/**
 * 保存时组装三键载荷（架构稿 C7）：`{ name, card, ccv3 }`。
 *
 * - `card` 来自结构草稿（`mergeCard` 的产物）；
 * - `ccv3` 用读取时拿到的完整对象为底，只替换我们要写的部分（世界书由调用方先算好）。
 * - 拿不到完整对象时（legacy-only），退回只发 `card`，让后端走纯结构合并。
 */
export interface SavePayload {
  card: Card
  ccv3?: Card
}

export function buildSavePayload(view: Card, ccv3Next: Card | undefined): SavePayload {
  if (!isObject(ccv3Next) || Object.keys(ccv3Next).length === 0) return { card: view }
  return { card: view, ccv3: ccv3Next }
}
