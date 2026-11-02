/**
 * AI WITH U · 侧栏入口与悬浮面板
 *
 * 形态：`sidebar.footer.action` 席位里的一个按钮 —— 收起态是一枚圆徽，展开态是
 * 「角色管理 / 当前角色名」两行。点开在按钮右侧弹出一块悬浮面板（portal 到 body，
 * 按 `getBoundingClientRect()` 定位，只算一次 + resize/scroll 时重算）。
 *
 * 设计语言的 CSS 在 `styles.ts`，文案与角色卡解析在 `text.ts`，接口在 `api.ts`；
 * 这个文件只管「状态机 + 布局」，尽量不写魔法数字以外的样式细节。
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'
import { DialogLayerContext, ErrorBar, Field, Overlay, RequestCloseButton, Section, Skeleton, useScrollLock } from './parts'
// 动效单一真源（契约 §1）：时长/缓动只从这里取，不在 JSX 里写字面量。
// pop 帧用 T_MID（= CSS 的 --awu-t-mid），退场用 T_EXIT（= --awu-t-exit）。
import { EASE, T_BASE, T_ENTER, T_EXIT, T_MID, presenceAttrs, prefersReducedMotion, useFinePointer, usePresence } from './motion'

import {
  activateCharacter,
  bindCharacter,
  countRegexScripts,
  deactivateCharacter,
  deleteCharacter,
  errorText,
  fetchCharacter,
  fetchCharacters,
  fetchOverview,
  fetchPreview,
  importCharacter,
  saveCharacter,
  saveCharacterCcv3,
  draftCard,
  setInteractionMode,
  editDiary,
  forgetKeyword,
  resetSession,
  fetchRelation,
  nextOpening,
  unbindCharacter,
  IMPORT_LIMITS,
} from './api'
import { CardEditor } from './card-editor'
import type { CardSavePayload } from './card-editor'
import { DiaryReview } from './diary-review'
import type { DiaryTarget } from './diary-review'
import {
  DistillEntry,
  armAndSendInstruction,
  copyToClipboard,
  createArm,
  sendFailureText,
  useComposerReady,
  useComposerSession,
  useDistillOverlayOpen,
} from './distill'
import {
  dragHasFiles,
  isInsideOurLayers,
  resetHostDropState,
  swallowFileDrag,
} from './dragdrop'
import { GuideView, guideFirstRun, markGuideSeen } from './guide'
import type {
  ActiveState,
  Card,
  CharacterDetail,
  CharacterSummary,
  DiaryEntry,
  ImportCharacterResult,
  InteractionMode,
  Overview,
  RelationState,
} from './api'
import {
  IconAlert,
  IconBack,
  IconBook,
  IconChevron,
  IconClose,
  IconEject,
  IconImport,
  IconMask,
  IconMotion,
  IconPlus,
  IconPower,
  IconQuill,
  IconRefresh,
  IconSpark,
  IconSpinner,
  IconText,
  IconTrash,
} from './icons'
import { hasDroppedLore, readLoreDroppedFromDetail, readLoreDroppedFromPreview } from './lore-diag'
import type { LoreDroppedInfo } from './lore-diag'
import { toLoreDraftFromCard } from './lorebook-schema'
import { PresetPanel } from './preset-view'
import { PromptPreview } from './preview'
import { installStyles, CARD_STAGGER, PANEL_MAX_H, PANEL_WIDTH } from './styles'
import {
  blurbOf,
  entriesOf,
  hueOf,
  initialOf,
  makeTranslator,
  relativeDay,
  roleOf,
  sourceLabelOf,
  sortRoster,
  sortedDiary,
  statTriple,
} from './text'
import type { Translate } from './text'

/** 槽位注入的 props（`sidebar.footer.action` 由侧栏壳提供 `wide`）。 */
export interface FooterActionProps {
  wide?: boolean
  t?: Translate
  [key: string]: unknown
}

type Tab = 'roster' | 'diary' | 'stats' | 'guide'

/** 面板里的弹层种类（空串 = 没有弹层）。抽成别名是为了「退场期还要渲染上一张」的 ref 好标类型。 */
type PanelDialog = 'new' | 'import' | 'preview' | 'preset' | 'delete' | 'mode' | 'editDiary' | 'forget' | 'resetAll' | 'resetSession'

/** 成功类提示条的存活时间（ms）。警告类不吃这个时间，留到用户手动关。 */
const NOTICE_TTL_MS = 5000

/** 删卡淡出的时长（= motion.ts 的 T_FAST / CSS 的 --awu-t-fast）。 */
const T_FAST_LOCAL = 120

/** 左栏的两枚模式胶囊（顺序即展示顺序）。 */
const MODE_OPTIONS: Array<{ value: InteractionMode; labelKey: string; hintKey: string }> = [
  { value: 'text', labelKey: 'mode.text', hintKey: 'mode.textHint' },
  { value: 'text+action', labelKey: 'mode.action', hintKey: 'mode.actionHint' },
]

/** 面板与按钮之间的间距（px）。 */
/** 面板最小可用宽/高，用于贴边时的兜底夹取。 */

// 面板定位：居中大窗 + 遮罩（对齐 dsh-context 的 .lc-modal-card 形态）。
// 尺寸由 styles.ts 的 PANEL_WIDTH / PANEL_MAX_H 统一给出，这里只负责把窗口摆到视口中间。
// 早期版本是「贴着侧栏按钮弹出、算左侧/底部坐标」的小气泡，改成大窗后那套锚点计算已删除。

/**
 * 保存信封守卫：编辑器提交的 `CardSavePayload` 与「裸结构卡」区分开。
 *
 * 判据是 `structureChanged` / `loreChanged` 两个布尔——它们是编辑器算出来的**链路指示**，
 * 面板据此知道该发 `card`、发 `ccv3`，还是两步都发（见 `onSaveCard`）。
 */
/**
 * 读 `/overview.bindings`（转成面板用的 `sessionId → 角色名` 表）。
 *
 * 三种形状都认（容错到底，2026-11-01 对齐宿主后补第三分支，见审查 H5）：
 *  1. 宿主本体：包装对象 `{count, current, effective, items:[{sessionId, character, boundAt}]}` —— **items 的角色键叫 `character`**；
 *  2. 纯数组：`[{sessionId, name|character}]`；
 *  3. 旧扁平 map：`Record<sessionId, 角色名>`。
 * 认不出来就返回空表 —— 空表等于「不知道」，界面据此只显示全局，绝不瞎猜。
 */
function readBindings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(value)) {
    return readBindingRows(value)
  }
  if (typeof value !== 'object' || value === null) return out
  const record = value as Record<string, unknown>
  // 宿主形状：`items` 是摘要数组；认出他就取 items，别落到第 3 分支把 count 之类的数字键当会话 id
  if (Array.isArray(record['items'])) {
    return readBindingRows(record['items'])
  }
  for (const [key, name] of Object.entries(record)) {
    if (key !== '' && typeof name === 'string' && name !== '') out[key] = name
  }
  return out
}

/** 绑定行数组 → `sessionId → 角色名`（行的角色键 `character` / `name` 都认）。 */
function readBindingRows(rows: unknown[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of rows) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as { sessionId?: unknown; name?: unknown; character?: unknown }
    const key = typeof row.sessionId === 'string' ? row.sessionId : ''
    const name = typeof row.name === 'string' ? row.name : typeof row.character === 'string' ? row.character : ''
    if (key !== '' && name !== '') out[key] = name
  }
  return out
}

function isSavePayload(value: unknown): value is CardSavePayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as { view?: unknown; structureChanged?: unknown; loreChanged?: unknown }
  return typeof payload.view === 'object' && payload.view !== null
    && typeof payload.structureChanged === 'boolean'
    && typeof payload.loreChanged === 'boolean'
}

// 弹层壳（Overlay / DialogLayerContext / useScrollLock）已搬到 `./parts`：
// 那是 distill 侧也要复用的叶子模块，放在这里会因为 import 环被卡住。

// ---------------------------------------------------------------- 小组件

function Dot({ on }: { on: boolean }): JSX.Element {
  return <span className="awu-lamp" data-on={on ? 'true' : 'false'} aria-hidden="true" />
}

/**
 * 角色徽标：渐变底 + 名字首字。
 *
 * `morph` 打上 `data-morph="avatar"`：列表卡与详情 hero **两处同名**，第 2 批的
 * list→detail 共享元素动画（FLIP）靠这个属性配对（契约 §2.1）。
 */
function Avatar(props: { name: string; size?: 'normal' | 'hero'; live?: boolean; morph?: boolean }): JSX.Element {
  const { name, size = 'normal', live = false, morph = false } = props
  return (
    <span
      className={size === 'hero' ? 'awu-avatar awu-heroAvatar' : 'awu-avatar'}
      data-size={size}
      data-hue={String(hueOf(name))}
      data-live={live ? 'true' : 'false'}
      data-morph={morph ? 'avatar' : undefined}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  )
}

// 骨架屏 / 错误条 / 字段行 / 分组块已搬到 `./parts`（纯零件，distill 侧也要用同一份）。

/** 日记视图（详情页与日记页共用）。 */
// `DiaryTarget` 与「按行改写」的类型定义搬到了 `diary-review.tsx`（日记页那块要复用），
// 这里只做再导出，保证 `EditDiaryDialog` 等旧引用不用改。
export type { DiaryTarget } from './diary-review'

function DiaryList(props: {
  entries: DiaryEntry[]
  t: Translate
  /** 传了就显示「改写」按钮 */
  onEdit?: (target: DiaryTarget) => void
}): JSX.Element {
  const { entries, t, onEdit } = props
  const days = sortedDiary(entries)
  if (days.length === 0) {
    return <div className="awu-emptyHint" style={{ padding: '10px 0' }}>{t('diary.empty')}</div>
  }
  const row = (line: string, date: string, section: 'timeline' | 'notes', index: number): JSX.Element => (
    <div className="awu-line" key={`${section}-${index}`}>
      <span className="awu-lineMarker">{t(`diary.marker.${section}`)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{line}</span>
      {onEdit !== undefined && (
        <button
          type="button"
          className="awu-lineEdit"
          title={t('diary.edit')}
          aria-label={t('diary.edit')}
          onClick={() => onEdit({ date, section, index, text: line })}
        >
          {t('diary.edit')}
        </button>
      )}
    </div>
  )
  return (
    <div className="awu-diary">
      {days.map(day => (
        <div className="awu-day" key={day.date}>
          <div className="awu-dayDate">{day.date}</div>
          {day.timeline.map((line, index) => row(line, day.date, 'timeline', index))}
          {day.notes.map((line, index) => row(line, day.date, 'notes', index))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 小工具

/** 卡片来源是只读展示字段，取不到就给空串。 */
function sourceOf(card: Card | undefined): string {
  const value = card?.['source']
  return typeof value === 'string' ? value : ''
}

// ---------------------------------------------------------------- 角色卡

/**
 * 角色卡（左栏）。
 *
 * 三个状态必须彼此可辨（2026-11-02 C 报告 P0-1 / P2-3）：
 *  - `data-live="true"`     全局启用（金色呼吸，契约里保留原语义）
 *  - `data-selected="true"` 当前正在查看的对象（静态蓝轨）—— 以前完全没做，
 *                           于是「日记 tab 点一下别的卡」在界面上没有任何痕迹
 *  - `boundHere`            本会话绑定（粉色 pill）—— 以前列表里看不出来
 * `data-card-id` 是第 2 批 FLIP 的稳定身份；`Avatar` 打 `data-morph` 供共享元素配对。
 */
interface CharacterTileProps {
  item: CharacterSummary
  /** 全局启用（宿主 `_active`） */
  live: boolean
  /** 本会话绑定 */
  boundHere: boolean
  /** 当前正在查看（详情页 / 日记页的对象） */
  selected: boolean
  /** 正在淡出（删卡第 1 段） */
  deleting?: boolean
  busy: boolean
  t: Translate
  index: number
  onOpen: (name: string) => void
}

function CharacterTileBase(props: CharacterTileProps): JSX.Element {
  const { item, live, boundHere, selected, deleting = false, busy, t, index, onOpen } = props
  const role = roleOf(item.card)
  const blurb = blurbOf(item.card)
  const when = relativeDay(item.lastActive, t)
  // 来源：接口一直带着（CharacterSummary.source），以前只在统计页用了一次（C 报告 P2-3）。
  const source = sourceLabelOf(typeof item.source === 'string' ? item.source : '', t)
  const meta = [role !== '' ? role : t('common.unknown'), source].filter(part => part !== '').join(' · ')
  return (
    <button
      type="button"
      className="awu-card"
      data-card-id={item.name}
      data-live={live ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      /* 删卡淡出：属性给 CSS 用（`.awu-card[data-state="closing"]`），内联 opacity/transition
         作为属性落地前的兜底，保证两段动效（淡出 → FLIP 塌陷）在两种状态下都成立。 */
      data-state={deleting ? 'closing' : undefined}
      style={{
        animationDelay: `${Math.min(index, 8) * CARD_STAGGER}ms`,
        opacity: deleting ? 0 : undefined,
        transition: deleting ? 'opacity 120ms linear' : undefined,
      }}
      onClick={() => onOpen(item.name)}
      aria-current={selected ? 'true' : undefined}
      aria-label={t('roster.open', { name: item.name })}
      disabled={busy}
    >
      <span className="awu-cardTop">
        <Avatar name={item.name} live={live} morph />
        <span className="awu-cardTitle">
          <span className="awu-cardName">{item.name}</span>
          <span className="awu-cardRole">{meta}</span>
        </span>
        <span className="awu-cardChevron" aria-hidden="true">
          <IconChevron size={13} />
        </span>
      </span>
      <span className="awu-cardBlurb">{blurb !== '' ? blurb : t('roster.never')}</span>
      <span className="awu-cardFoot">
        {live && <span className="awu-pill" data-tone="live">{t('roster.enabled')}</span>}
        {boundHere && <span className="awu-pill" data-tone="rose">{t('roster.boundHere')}</span>}
        <span className="awu-pill" data-tone={item.memoryCount > 0 ? 'teal' : 'none'}>
          {t('roster.memory', { n: item.memoryCount })}
        </span>
        {when !== '' && <span style={{ marginLeft: 'auto' }}>{when}</span>}
      </span>
    </button>
  )
}

/**
 * 卡片的重渲染闸门（第 2 批性能项）。
 *
 * 为什么不能只 `memo(CharacterTile)`：每次 `reload` / 5s 轮询都返回**全新**的 item 对象，
 * 浅比较永远不等，等于没 memo。所以这里按「真正会被渲染的字段」比较：
 * 名字 / 来源 / 最近活跃 / 记忆数 / 各种态 + 两个派生字符串（身份、一句话背景）。
 * 派生字符串用 roleOf/blurbOf 现算：纯字段挑选，比一次 React 重渲染便宜得多，
 * 而且卡片被编辑后（同一 name、内容变了）也能正确重渲。
 */
function areTilePropsEqual(prev: CharacterTileProps, next: CharacterTileProps): boolean {
  if (prev.item.name !== next.item.name) return false
  if (prev.item.source !== next.item.source) return false
  if (prev.item.lastActive !== next.item.lastActive) return false
  if (prev.item.memoryCount !== next.item.memoryCount) return false
  if (prev.live !== next.live) return false
  if (prev.boundHere !== next.boundHere) return false
  if (prev.selected !== next.selected) return false
  if (prev.deleting !== next.deleting) return false
  if (prev.busy !== next.busy) return false
  if (prev.index !== next.index) return false
  if (prev.t !== next.t) return false
  if (prev.onOpen !== next.onOpen) return false
  return roleOf(prev.item.card) === roleOf(next.item.card) && blurbOf(prev.item.card) === blurbOf(next.item.card)
}

const CharacterTile = memo(CharacterTileBase, areTilePropsEqual)

// ---------------------------------------------------------------- 自创角色卡弹层

/** 自创卡落档后的收尾信息：面板据此刷新列表、打开新卡、显示提示。 */
export interface CreatedCardInfo {
  name: string
  /** 已翻译好的提示文案（软警告会拼成多行） */
  notice: string
  tone: 'ok' | 'warn'
}

/** 保存提示里把软警告拼进去：有警告就整条转成警示色（不是红条，也不拦保存）。 */
function composeSavedNotice(base: string, warnings: string[], t: Translate): string {
  if (warnings.length === 0) return base
  return `${base}\n${t('notice.warnHead', { n: warnings.length })}\n${warnings.join('\n')}`
}

function NewCharacterDialog(props: {
  existing: string[]
  /** 面板级忙碌（别的动作在跑时不要重复提交） */
  panelBusy: boolean
  onCancel: () => void
  onCreated: (info: CreatedCardInfo) => void
  t: Translate
}): JSX.Element {
  const { existing, panelBusy, onCancel, onCreated, t } = props
  // 会话输入框是否就绪：勾了「AI 补全」却拿不到输入框时，按钮要如实说明（与蒸馏入口同款）
  const composerReady = useComposerReady()

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [blurb, setBlurb] = useState('')
  /** 勾选后：先落骨架卡，再把补全指令发进当前会话 */
  const [aiFill, setAiFill] = useState(false)
  const [error, setError] = useState('')
  /** form = 填表；result = 骨架卡已落盘，正在回显「发没发出去」 */
  const [step, setStep] = useState<'form' | 'result'>('form')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | undefined>(undefined)
  /** 指令原文：发不出去时给用户「复制」兜底 */
  const [manual, setManual] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  /** 骨架卡已落盘的名字：关层时要通知面板刷新并打开它 */
  const [created, setCreated] = useState('')

  const inputRef = useRef<HTMLInputElement | null>(null)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])
  useEffect(() => { inputRef.current?.focus() }, [])

  const locked = busy || panelBusy

  /**
   * 关层：
   *  - 骨架卡已落盘 → 通知面板（刷新 + 打开这张卡），提示文案按「发没发出去」如实给；
   *  - 还没落盘 → 就是普通取消。
   */
  const close = (): void => {
    if (locked) return
    if (created === '') { onCancel(); return }
    const fallback = t('new.aiFillSent')
    const text = note === undefined ? fallback : note.text
    onCreated({
      name: created,
      notice: composeSavedNotice(text, warnings, t),
      tone: note !== undefined && note.tone === 'ok' && warnings.length === 0 ? 'ok' : 'warn',
    })
  }

  const submitForm = (trimmed: string): void => {
    setBusy(true)
    setError('')
    void saveCharacter(trimmed, draftCard(trimmed, role.trim(), blurb.trim()))
      .then(saved => {
        if (!aliveRef.current) return
        const warns = saved.warnings ?? []
        onCreated({
          name: trimmed,
          notice: composeSavedNotice(t('new.done', { name: trimmed }), warns, t),
          tone: warns.length === 0 ? 'ok' : 'warn',
        })
      })
      .catch((e: unknown) => { if (aliveRef.current) setError(t('new.saveFailed', { reason: errorText(e) })) })
      .finally(() => { if (aliveRef.current) setBusy(false) })
  }

  /**
   * 勾了「AI 补全」的提交：**先落骨架卡，再 arm(create) → 发送**。
   *
   * 顺序不能反：AI 的落盘工具只在 arm 出来的窗口内可用；而骨架卡必须先存在，
   * 否则 AI 补完也没处落（它补的是同一张卡）。发送通道与蒸馏入口共用
   * `armAndSendInstruction`，降级（输入框不可用 / 提交失败）一律把指令原文摆出来给「复制」。
   */
  const submitWithAi = (trimmed: string): void => {
    setBusy(true)
    setError('')
    void (async () => {
      let warns: string[] = []
      try {
        const saved = await saveCharacter(trimmed, draftCard(trimmed, role.trim(), blurb.trim()))
        warns = saved.warnings ?? []
      } catch (e) {
        if (aliveRef.current) setError(t('new.saveFailed', { reason: errorText(e) }))
        return
      }
      if (!aliveRef.current) return
      setCreated(trimmed)
      setWarnings(warns)

      const outcome = await armAndSendInstruction(createArm(trimmed))
      if (!aliveRef.current) return
      setStep('result')
      if (!outcome.armed) {
        setNote({ tone: 'err', text: t('new.aiArmFailed', { reason: outcome.armError ?? '' }) })
        return
      }
      setManual(outcome.instruction)
      const send = outcome.send
      if (send === undefined || !send.ok) {
        const reason = send === undefined ? t('distill.insertFailed') : sendFailureText(send.reason, t)
        setNote({ tone: 'err', text: reason })
        return
      }
      if (send.mode === 'sent') setNote({ tone: 'ok', text: t('new.aiFillSent') })
      else if (send.note === 'busy') setNote({ tone: 'warn', text: t('new.aiFillFilledBusy') })
      else setNote({ tone: 'warn', text: t('new.aiFillFilled') })
    })().catch((e: unknown) => {
      if (aliveRef.current) setError(errorText(e))
    }).finally(() => { if (aliveRef.current) setBusy(false) })
  }

  const submit = (): void => {
    if (locked) return
    const trimmed = name.trim()
    if (trimmed === '') { setError(t('new.nameRequired')); return }
    if (existing.includes(trimmed)) { setError(t('new.nameTaken')); return }
    // 勾了补全却拿不到会话输入框：和按钮置灰保持一致，别让回车绕过这道闸
    if (aiFill && !composerReady) { setError(t('distill.noDock')); return }
    setError('')
    if (aiFill) submitWithAi(trimmed)
    else submitForm(trimmed)
  }

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') { event.preventDefault(); submit() }
  }

  const copyInstruction = (): void => {
    if (manual === '') return
    void copyToClipboard(manual).then(ok => {
      setNote({ tone: ok ? 'ok' : 'warn', text: ok ? t('distill.copied') : t('distill.copyFailed') })
    })
  }

  const failedToSend = note !== undefined && note.tone === 'err'
  const toneColor = note === undefined
    ? 'var(--awu-ink-mute)'
    : note.tone === 'err' ? 'var(--awu-danger)' : note.tone === 'warn' ? 'var(--awu-gold)' : 'var(--awu-teal)'

  // busy 期间不许 Esc/点遮罩关掉：弹层里的按钮早就 disabled，只有 Overlay 这条路能绕过守卫
  return (
    <Overlay label={t('new.title')} onClose={close} onRequestClose={() => !locked}>
      <div className="awu-dialogHead">
        <IconMask size={16} />
        <span>{t('new.title')}</span>
      </div>

      <div className="awu-dialogBody">
        {step === 'form' ? (
          <>
            <label className="awu-label" htmlFor="awu-new-name">{t('new.name')}</label>
            <input
              id="awu-new-name"
              ref={inputRef}
              className="awu-input"
              value={name}
              maxLength={24}
              placeholder={t('new.namePlaceholder')}
              onChange={event => setName(event.target.value)}
              onKeyDown={onKey}
            />
            <label className="awu-label" htmlFor="awu-new-role">{t('new.role')}</label>
            <input
              id="awu-new-role"
              className="awu-input"
              value={role}
              maxLength={40}
              placeholder={t('new.rolePlaceholder')}
              onChange={event => setRole(event.target.value)}
              onKeyDown={onKey}
            />
            <label className="awu-label" htmlFor="awu-new-blurb">{t('new.blurb')}</label>
            <input
              id="awu-new-blurb"
              className="awu-input"
              value={blurb}
              maxLength={80}
              placeholder={t('new.blurbPlaceholder')}
              onChange={event => setBlurb(event.target.value)}
              onKeyDown={onKey}
            />
            {name.trim() !== '' && (
              <div className="awu-previewName">
                {t('new.preview')}
                <b>{name.trim()}</b>
                {role.trim() !== '' && <span> · {role.trim()}</span>}
              </div>
            )}

            {/* 可选：让 AI 把这张骨架卡补全（走与蒸馏同一条发送通道，kind='create'） */}
            <label className="awu-check">
              <input
                type="checkbox"
                checked={aiFill}
                disabled={locked}
                onChange={event => setAiFill(event.target.checked)}
              />
              <span>
                <b>{t('new.aiFill')}</b>
                <span className="awu-newAiHint">{t('new.aiFillHint')}</span>
              </span>
            </label>
            {aiFill && !composerReady && (
              <div className="awu-hint" style={{ color: 'var(--awu-gold)', marginTop: 8 }}>{t('distill.noDock')}</div>
            )}

            {/* role="alert"：重名 / 必填 / 保存失败都是「提交后才知道」的结果，读屏必须念 */}
            {error !== '' && <div className="awu-hint" role="alert" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{error}</div>}
          </>
        ) : (
          <>
            {created !== '' && (
              <div className="awu-previewName" style={{ marginTop: 0 }}>
                {t('new.createdTag')}
                <b>{created}</b>
              </div>
            )}
            {note !== undefined && (
              <div className="awu-hint" role="status" aria-live="polite" style={{ color: toneColor, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                {note.text}
              </div>
            )}
            {warnings.length > 0 && (
              <>
                <div className="awu-importWarnHead" style={{ marginTop: 12 }}>{t('new.saveWarnHead', { name: created })}</div>
                <ul className="awu-importWarns">
                  {warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                </ul>
              </>
            )}
            {failedToSend && manual !== '' && (
              <>
                <label className="awu-label" htmlFor="awu-new-manual">{t('distill.copy')}</label>
                <textarea
                  id="awu-new-manual"
                  className="awu-distill-paste"
                  style={{ minHeight: 88 }}
                  readOnly
                  value={manual}
                  onFocus={event => event.currentTarget.select()}
                />
              </>
            )}
          </>
        )}
      </div>

      <div className="awu-dialogFoot">
        {step === 'form' ? (
          <>
            <button type="button" className="awu-btn" onClick={close} disabled={locked}>
              {t('new.cancel')}
            </button>
            <button
              type="button"
              className="awu-btn"
              data-kind="primary"
              onClick={submit}
              disabled={locked || (aiFill && !composerReady)}
              title={aiFill && !composerReady ? t('distill.noDock') : t('new.confirm')}
            >
              {busy ? t('common.busy') : (aiFill ? t('new.confirmAi') : t('new.confirm'))}
            </button>
          </>
        ) : (
          <>
            {failedToSend && manual !== '' && (
              <button type="button" className="awu-btn" onClick={copyInstruction}>
                {t('distill.copy')}
              </button>
            )}
            <button type="button" className="awu-btn" data-kind="primary" onClick={close} disabled={locked}>
              {t('common.close')}
            </button>
          </>
        )}
      </div>
    </Overlay>
  )
}


// ---------------------------------------------------------------- 导入角色卡弹层

// ---------------------------------------------------------------- 导入警告分组

/** 导入弹层的警告分组：解析提示 / 世界书提示 / 不支持的酒馆特性（正则脚本、立绘等）。 */
type ImportWarnGroup = 'parse' | 'lore' | 'unsupported'

/** 每组最多先显示几条（其余折成「还有 N 条」）。 */
const IMPORT_WARN_PREVIEW = 3

/**
 * 分组靠文案关键字匹配，**顺序有讲究**：
 * 「不支持的酒馆特性」先判 —— 「包内还有 N 个其它条目（assets 等）」这种句子同时含「条目」，
 * 归到世界书里就错了。宿主新加的警告只要提到这些词就能落进对应组。
 */
const IMPORT_WARN_MATCHERS: Array<{ group: ImportWarnGroup; pattern: RegExp }> = [
  { group: 'unsupported', pattern: /assets|立绘|regex|正则|脚本|深度|depth|递归|probability|weight/i },
  { group: 'lore', pattern: /世界书|character_book|条目|设定|预算|token|关键词/i },
]

/** 把一串警告按组归类（组顺序固定，空组不出现）。 */
function groupImportWarnings(warnings: string[]): Array<{ group: ImportWarnGroup; items: string[] }> {
  const buckets: Record<ImportWarnGroup, string[]> = { parse: [], lore: [], unsupported: [] }
  for (const warning of warnings) {
    const matched = IMPORT_WARN_MATCHERS.find(matcher => matcher.pattern.test(warning))
    buckets[matched?.group ?? 'parse'].push(warning)
  }
  return (['parse', 'lore', 'unsupported'] as const)
    .filter(group => buckets[group].length > 0)
    .map(group => ({ group, items: buckets[group] }))
}

/** 人类可读的文件大小（1024 进制，保留一位小数）。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 把文件读成纯 base64（不带 `data:...;base64,` 前缀）。
 *
 * 用 `readAsDataURL` 而不是「arrayBuffer + btoa 手动分段」：前者是浏览器原生实现，
 * 编解码不占 JS 主线程；后者要把 10 MB 的二进制串切块喂 `String.fromCharCode`，
 * 逐块同步跑，面板会明显卡一下（16 MB 上限下这点很致命）。
 */
function readFileBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => { reject(new Error(`读文件失败：${file.name}`)) }
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : ''
      const comma = raw.indexOf(',')
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 导入卡：选文件 → 解析预览 → 确认保存（冲突需二次确认）。
 *
 * 三段状态全在一个弹层里，不写盘的那一段（解析）由后端保证；保存走
 * `saveCharacterCcv3`（**只发 ccv3**）—— 导入卡最常带 `character_book`，
 * 只让 ccv3 当权威，世界书就不会被「结构重投影」那条分支搅进去。存完回读校验名字与条目数。
 */
function ImportDialog(props: {
  /** 面板级忙碌（别的动作在跑时，别让导入也挤进来） */
  panelBusy: boolean
  onCancel: () => void
  /** 确认保存后的收尾：`warnings` 是后端软提示（世界书超限等），面板用警示色展示 */
  onImported: (name: string, warnings: string[]) => void
  t: Translate
}): JSX.Element {
  const { panelBusy, onCancel, onImported, t } = props

  const [stage, setStage] = useState<'pick' | 'preview'>('pick')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | undefined>(undefined)
  const [parsed, setParsed] = useState<ImportCharacterResult | undefined>(undefined)
  const [error, setError] = useState('')
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  /** 拖到虚线框外时的提示：不静默吞掉，用户得知道该往哪放 */
  const [dropHint, setDropHint] = useState('')

  const inputRef = useRef<HTMLInputElement | null>(null)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const locked = busy || panelBusy

  /** 清空已读文件：关层/取消/重选都要落到这里，别把上一张卡的内容留在内存与输入框里。 */
  const reset = useCallback((): void => {
    setStage('pick')
    setBusy(false)
    setFile(undefined)
    setParsed(undefined)
    setError('')
    setConfirmOverwrite(false)
    setDropHint('')
    // <input type=file> 的值不清掉，重选同一个文件不会触发 change
    if (inputRef.current !== null) inputRef.current.value = ''
  }, [])

  const close = (): void => {
    if (locked) return
    reset()
    onCancel()
  }

  /** 校验 + 解析。解析错误原样透出后端文案，不压成「导入失败」。 */
  const accept = (picked: File): void => {
    setError('')
    setConfirmOverwrite(false)
    if (!/\.(png|charx|json|zip)$/iu.test(picked.name)) { setError(t('import.badType')); return }
    if (picked.size === 0) { setError(t('import.empty')); return }
    if (picked.size > IMPORT_LIMITS.fileBytes) {
      setError(t('import.tooLarge', { size: formatSize(picked.size), max: formatSize(IMPORT_LIMITS.fileBytes) }))
      return
    }
    setFile(picked)
    setParsed(undefined)
    setStage('preview')
    setBusy(true)
    void (async () => {
      // 读文件与解析分开 catch：前者是本地 FileReader 失败（自己出文案），
      // 后者是后端解析失败（原样透出后端 error，别压成「导入失败」）。
      let dataBase64 = ''
      try {
        dataBase64 = await readFileBase64(picked)
      } catch (e) {
        if (!aliveRef.current) return
        console.error('[ai-with-u] 读卡文件失败', e)
        setError(t('import.readFailed', { name: picked.name }))
        setBusy(false)
        return
      }
      try {
        const result = await importCharacter({ fileName: picked.name, dataBase64 })
        if (!aliveRef.current) return
        setParsed(result)
      } catch (e) {
        if (!aliveRef.current) return
        setError(errorText(e))
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }

  /** 确认保存：只发 ccv3，存完回读校验（名字 + 世界书条目数）。 */
  const save = (): void => {
    if (parsed === undefined || locked) return
    setBusy(true)
    setError('')
    void (async () => {
      try {
        const saved = await saveCharacterCcv3(parsed.name, parsed.ccv3)
        const fresh = await fetchCharacter(parsed.name)
        if (!aliveRef.current) return
        if (fresh.name !== parsed.name) {
          throw new Error(t('import.mismatch', { expect: parsed.name, actual: fresh.name }))
        }
        const expect = toLoreDraftFromCard(parsed.ccv3).entries.length
        const actual = toLoreDraftFromCard(fresh.ccv3).entries.length
        if (expect !== actual) throw new Error(t('lore.saveMismatch', { expect, actual }))
        // 保存阶段的软警告（世界书超限等）交给面板用警示色展示：保存本身是成功的
        onImported(parsed.name, saved.warnings ?? [])
      } catch (e) {
        if (!aliveRef.current) return
        setError(errorText(e))
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }

  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    // 内层拖放区自己接住：preventDefault 允许 drop，stopPropagation 保证事件不会冒到
    // 弹层遮罩 / 面板 / 宿主 composer；`swallowFileDrag` 在 drop 时还会顺手复位宿主的
    // 拖放计数器（漏这一步 = 聊天区遮罩永久卡死，真机 P0，见 dragdrop.ts）
    swallowFileDrag(event)
    setDropHint('')
    if (locked) return
    const picked = event.dataTransfer.files[0]
    if (picked !== undefined) accept(picked)
  }

  const onPickFile = (event: ReactChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files?.[0]
    if (picked !== undefined) accept(picked)
  }

  return (
    <Overlay
      label={t('import.title')}
      onClose={close}
      onRequestClose={() => !locked}
      onFilesDropped={() => setDropHint(t('import.dropHint'))}
    >
      <div className="awu-dialogHead">
        <IconImport size={16} />
        <span>{t('import.title')}</span>
      </div>

      <div className="awu-dialogBody">
        <div className="awu-hint" style={{ marginBottom: 10 }}>{t('import.hint')}</div>

        {/*
          错误条必须放在「阶段判断」**外面**：选文件阶段的三条校验（类型不对 / 空文件 /
          超限，见上面 accept()）都会写 error 然后 return，压根不会进 preview ——
          从前 error 只在 preview 分支渲染，于是那三种失败是**完全静默**的：
          用户拖错文件，界面上一个字都不出现。
          role="alert" 顺带让读屏把原因念出来（原来只靠视觉）。
        */}
        {error !== '' && (
          <div className="awu-err" role="alert" style={{ marginBottom: 10 }}>
            <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          </div>
        )}

        {stage === 'pick' ? (
          <div
            className="awu-importDrop"
            data-busy={locked ? 'true' : 'false'}
            onDragOver={event => { event.preventDefault(); event.stopPropagation() }}
            onDrop={onDrop}
          >
            <IconImport size={24} />
            <div className="awu-importDropTitle">{t('import.pickHint')}</div>
            <button
              type="button"
              className="awu-btn"
              data-kind="primary"
              onClick={() => inputRef.current?.click()}
              disabled={locked}
            >
              {t('import.pick')}
            </button>
            <input
              id="awu-import-file"
              ref={inputRef}
              type="file"
              className="awu-importNative"
              accept=".png,.charx,.json,.zip,image/png,application/json,application/zip"
              onChange={onPickFile}
            />
            <div className="awu-hint">{t('import.limit', { max: formatSize(IMPORT_LIMITS.fileBytes) })}</div>
            {dropHint !== '' && (
              <div className="awu-importDropHint" role="status" aria-live="polite">{dropHint}</div>
            )}
          </div>
        ) : (
          <div className="awu-importView" aria-live="polite">
            <div className="awu-importFileRow">
              <span className="awu-importFileLabel">{t('import.fileName')}</span>
              <span className="awu-path">{file?.name ?? ''}</span>
              {file !== undefined && <span className="awu-importFileSize">{formatSize(file.size)}</span>}
            </div>

            {/* 预览阶段再把文件拖进来：告诉他先点「重选文件」，别指望它静默替换 */}
            {dropHint !== '' && (
              <div className="awu-importDropHint" role="status" aria-live="polite">{dropHint}</div>
            )}

            {busy && parsed === undefined && error === '' && (
              <div className="awu-hint" role="status">{t('import.parsing')}</div>
            )}

            {parsed !== undefined && (
              <>
                <div className="awu-importMeta">
                  <Field k={t('import.name')} v={parsed.name} />
                  <Field k={t('import.format')} v={t(`import.format.${parsed.format}`)} />
                </div>

                {parsed.conflict !== undefined && (
                  <div className="awu-importConflict" role="status" data-confirm={confirmOverwrite ? 'true' : 'false'}>
                    <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{t('import.conflictTitle', { name: parsed.conflict.name })}</b>
                      <br />
                      {confirmOverwrite
                        ? t('import.overwriteConfirm', { name: parsed.conflict.name })
                        : t('import.conflictBody')}
                    </span>
                  </div>
                )}

                {/* 正则脚本：中性信息（不是警告）——卡里带了 N 条，已屏蔽，不执行也不进提示词 */}
                {countRegexScripts(parsed.ccv3) > 0 && (
                  <div className="awu-noteRow" role="status">
                    <span className="awu-noteDot" aria-hidden="true" />
                    <span>{t('regex.blocked', { n: countRegexScripts(parsed.ccv3) })}</span>
                  </div>
                )}

                <div className="awu-importWarnHead">
                  {parsed.warnings.length === 0
                    ? t('import.noWarnings')
                    : t('import.warnings', { n: parsed.warnings.length })}
                </div>
                {parsed.warnings.length > 0 && (
                  <div className="awu-importWarnGroups">
                    {groupImportWarnings(parsed.warnings).map(({ group, items }) => {
                      const shown = items.slice(0, IMPORT_WARN_PREVIEW)
                      const rest = items.length - shown.length
                      return (
                        <div className="awu-importWarnGroup" key={group}>
                          <div className="awu-importWarnGroupTitle">{t(`import.warnGroup.${group}`)}</div>
                          <ul className="awu-importWarns">
                            {shown.map((warning, index) => (
                              <li key={`${group}-${index}-${warning}`}>{warning}</li>
                            ))}
                          </ul>
                          {rest > 0 && (
                            <div className="awu-importWarnMore">{t('import.warnGroup.more', { n: rest })}</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="awu-dialogFoot">
        {stage === 'pick' ? (
          <button type="button" className="awu-btn" onClick={close} disabled={locked}>{t('common.cancel')}</button>
        ) : (
          <>
            <button type="button" className="awu-btn" onClick={close} disabled={locked}>
              {t('common.cancel')}
            </button>
            <button type="button" className="awu-btn" data-kind="ghost" onClick={reset} disabled={locked}>
              {t('import.retry')}
            </button>
            {parsed === undefined ? null : parsed.conflict !== undefined && !confirmOverwrite ? (
              <button
                type="button"
                className="awu-btn"
                data-kind="danger"
                onClick={() => setConfirmOverwrite(true)}
                disabled={locked}
              >
                {t('import.overwrite')}
              </button>
            ) : parsed.conflict !== undefined ? (
              <button type="button" className="awu-btn" data-kind="danger" onClick={save} disabled={locked}>
                {busy ? t('common.busy') : t('import.overwriteYes')}
              </button>
            ) : (
              <button type="button" className="awu-btn" data-kind="primary" onClick={save} disabled={locked}>
                {busy ? t('common.busy') : t('import.confirm')}
              </button>
            )}
          </>
        )}
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------- 删除确认弹层

function DeleteDialog(props: {
  name: string
  busy: boolean
  onCancel: () => void
  onConfirm: (withMemory: boolean) => void
  t: Translate
}): JSX.Element {
  const { name, busy, onCancel, onConfirm, t } = props
  const [withMemory, setWithMemory] = useState(false)
  /**
   * 两步确认（C 报告 P1-6）：覆盖导入早就是「先点一次，再确认一次」，
   * 而删除 / 彻底重置只点一下就写盘 —— 最不可恢复的两个操作反而最少确认。
   * 这里把删除也改成两步：第一次只上膛（按钮变成「确认执行」并出现红字提示），
   * 第二次才真的删。勾选框与提示不参与上膛，改动选项会自动复位。
   */
  const [armed, setArmed] = useState(false)
  return (
    <Overlay
      label={t('delete.title')}
      onClose={onCancel}
      onRequestClose={() => {
        if (busy) return false
        // 已经「上膛」的危险操作：第一次 Esc/点遮罩只卸膛，不直接关（避免把已确认的意图丢掉）
        if (armed) { setArmed(false); return false }
        return true
      }}
    >
      <div className="awu-dialogHead">
        <IconTrash size={16} />
        <span>{t('delete.title')}</span>
      </div>
      <div className="awu-dialogBody">
        <div className="awu-confirmText">{t('delete.body', { name })}</div>
        <label className="awu-check">
          <input
            type="checkbox"
            checked={withMemory}
            onChange={event => { setWithMemory(event.target.checked); setArmed(false) }}
          />
          <span>{t('delete.withMemory')}</span>
        </label>
        {!withMemory && <div className="awu-hint" style={{ marginTop: 8 }}>{t('delete.keepMemory')}</div>}
        {armed && (
          <div className="awu-hint" role="alert" style={{ marginTop: 8, color: 'var(--awu-danger)' }}>
            {t('common.armedHint')}
          </div>
        )}
      </div>
      <div className="awu-dialogFoot">
        <RequestCloseButton label={t('delete.cancel')} fallback={onCancel} disabled={busy}>{t('delete.cancel')}</RequestCloseButton>
        <button
          type="button"
          className="awu-btn"
          data-kind="danger"
          onClick={() => {
            if (!armed) { setArmed(true); return }
            onConfirm(withMemory)
          }}
          disabled={busy}
        >
          {busy ? t('common.busy') : (armed ? t('common.armedOk') : t('delete.confirm'))}
        </button>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------- 模式切换弹层

function ModeDialog(props: {
  current: string
  busy: boolean
  onCancel: () => void
  onPick: (mode: 'text' | 'text+action') => void
  t: Translate
}): JSX.Element {
  const { current, busy, onCancel, onPick, t } = props
  const options: Array<{ value: 'text' | 'text+action'; icon: JSX.Element; label: string; hint: string }> = [
    { value: 'text+action', icon: <IconMotion size={16} />, label: t('mode.action'), hint: t('mode.actionHint') },
    { value: 'text', icon: <IconText size={16} />, label: t('mode.text'), hint: t('mode.textHint') },
  ]
  return (
    <Overlay label={t('mode.title')} onClose={onCancel} onRequestClose={() => !busy}>
      <div className="awu-dialogHead">
        <IconMotion size={16} />
        <span>{t('mode.title')}</span>
      </div>
      <div className="awu-dialogBody">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            className="awu-btn"
            data-size="block"
            style={{ marginBottom: 8, justifyContent: 'flex-start', padding: '10px 12px', textAlign: 'left' } as CSSProperties}
            data-kind={current === option.value ? 'primary' : undefined}
            onClick={() => onPick(option.value)}
            disabled={busy}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {option.icon}
              <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{option.label}</span>
                <span style={{ fontSize: 10.5, opacity: 0.78, fontWeight: 400 }}>{option.hint}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="awu-dialogFoot">
        <RequestCloseButton label={t('common.cancel')} fallback={onCancel} disabled={busy} className="awu-btn" >{t('common.cancel')}</RequestCloseButton>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------- 改写日记弹层

function EditDiaryDialog(props: {
  target: DiaryTarget
  busy: boolean
  error: string
  onCancel: () => void
  onSave: (text: string) => void
  t: Translate
}): JSX.Element {
  const { target, busy, error, onCancel, onSave, t } = props
  const [text, setText] = useState(target.text)
  /** 本地校验提示：空内容点保存时给「下一步」而不是静默失效（`diary.editRequired` 一直没被引用过）。 */
  const [local, setLocal] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const submit = (): void => {
    if (text.trim() === '') { setLocal(t('diary.editRequired')); return }
    setLocal('')
    onSave(text.trim())
  }
  return (
    <Overlay label={t('diary.editTitle')} onClose={onCancel} onRequestClose={() => !busy}>
      <div className="awu-dialogHead">
        <IconQuill size={16} />
        <span>{t('diary.editTitle')}</span>
      </div>
      <div className="awu-dialogBody">
        <div className="awu-hint" style={{ marginBottom: 8 }}>{t('diary.editHint')}</div>
        {/* 日期/归类原本塞在标题右端（还借了 .awu-count 的类 + 4 条内联样式）：
            降级成正文第一行的元信息，标题回到「icon + 标题」的统一结构。 */}
        <div className="awu-sectionLabel" style={{ marginBottom: 6 }}>
          {target.date} · {t(`diary.marker.${target.section}`)}
        </div>
        <textarea
          ref={ref}
          className="awu-input awu-textarea"
          value={text}
          rows={4}
          onChange={event => { setText(event.target.value); if (local !== '') setLocal('') }}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
          }}
        />
        {local !== '' && <div className="awu-hint" role="alert" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{local}</div>}
        {error !== '' && <div className="awu-hint" role="alert" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{error}</div>}
      </div>
      <div className="awu-dialogFoot">
        <RequestCloseButton label={t('common.cancel')} fallback={onCancel} disabled={busy}>{t('common.cancel')}</RequestCloseButton>
        <button
          type="button"
          className="awu-btn"
          data-kind="primary"
          onClick={submit}
          disabled={busy}
        >
          {busy ? t('common.busy') : t('common.save')}
        </button>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------- 忘记某事弹层

function ForgetDialog(props: {
  busy: boolean
  error: string
  onCancel: () => void
  onForget: (keyword: string) => void
  t: Translate
}): JSX.Element {
  const { busy, error, onCancel, onForget, t } = props
  const [keyword, setKeyword] = useState('')
  const [local, setLocal] = useState('')
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const submit = (): void => {
    if (keyword.trim() === '') { setLocal(t('forget.keywordRequired')); return }
    setLocal('')
    onForget(keyword.trim())
  }
  return (
    <Overlay label={t('forget.title')} onClose={onCancel} onRequestClose={() => !busy}>
      <div className="awu-dialogHead">
        <IconQuill size={16} />
        <span>{t('forget.title')}</span>
      </div>
      <div className="awu-dialogBody">
        <div className="awu-hint" style={{ marginBottom: 10 }}>{t('forget.hint')}</div>
        <label className="awu-label" htmlFor="awu-forget-kw">{t('forget.keyword')}</label>
        <input
          id="awu-forget-kw"
          ref={ref}
          className="awu-input"
          value={keyword}
          placeholder={t('forget.keywordPlaceholder')}
          onChange={event => setKeyword(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit() } }}
        />
        {(local !== '' || error !== '') && (
          <div className="awu-hint" role="alert" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{local !== '' ? local : error}</div>
        )}
      </div>
      <div className="awu-dialogFoot">
        <RequestCloseButton label={t('common.cancel')} fallback={onCancel} disabled={busy}>{t('common.cancel')}</RequestCloseButton>
        <button type="button" className="awu-btn" data-kind="danger" onClick={submit} disabled={busy}>
          {busy ? t('common.busy') : t('forget.do')}
        </button>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------- 彻底重置确认

function ResetAllDialog(props: {
  name: string
  busy: boolean
  /** session = 全新开始（保留日记）；all = 彻底重置（连日记清空）。 */
  scope: 'session' | 'all'
  onCancel: () => void
  onConfirm: () => void
  t: Translate
}): JSX.Element {
  const { name, busy, scope, onCancel, onConfirm, t } = props
  const fresh = scope === 'session'
  /** 两步确认：与 DeleteDialog / ImportDialog 同一口径（见 DeleteDialog 里的说明）。 */
  const [armed, setArmed] = useState(false)
  return (
    <Overlay
      label={t('reset.title')}
      onClose={onCancel}
      onRequestClose={() => {
        if (busy) return false
        if (armed) { setArmed(false); return false }
        return true
      }}
    >
      <div className="awu-dialogHead">
        <IconAlert size={16} />
        <span>{fresh ? t('reset.sessionTitle', { name }) : t('reset.confirmTitle', { name })}</span>
      </div>
      <div className="awu-dialogBody">
        <div className="awu-confirmText">{fresh ? t('reset.sessionBody') : t('reset.confirmBody')}</div>
        {armed && (
          <div className="awu-hint" role="alert" style={{ marginTop: 8, color: 'var(--awu-danger)' }}>
            {t('common.armedHint')}
          </div>
        )}
      </div>
      <div className="awu-dialogFoot">
        <RequestCloseButton label={t('common.cancel')} fallback={onCancel} disabled={busy}>{t('common.cancel')}</RequestCloseButton>
        <button
          type="button"
          className="awu-btn"
          data-kind="danger"
          onClick={() => {
            if (!armed) { setArmed(true); return }
            onConfirm()
          }}
          disabled={busy}
        >
          {busy ? t('common.busy') : (armed ? t('common.armedOk') : (fresh ? t('reset.sessionWord') : t('reset.confirmWord')))}
        </button>
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------- 溢出菜单（⋯）

/** ⋯ 菜单里的一项。 */
interface CardMenuItem {
  key: string
  label: string
  onSelect: () => void
  /** 在这一项之前画一条 `.awu-menuSep` 分隔线（按语义分组，不按数量硬塞） */
  sepBefore?: boolean
  /** 危险项（红字 + 红 hover），目前详情页把删除下沉到 dangerZone，留着给以后用 */
  danger?: boolean
}

/**
 * 详情页的「⋯」溢出菜单（契约 §2.5 `.awu-menuBtn` / `.awu-menu`）。
 *
 * 三条行为：
 *  - **Esc 关菜单且不再往上传**：面板自己在 document 捕获阶段监听 Esc 收起整块面板；
 *    菜单若不 stopPropagation，「关菜单」会连带把面板一起关掉。这正是 `Overlay` 里
 *    `escYield` 要解决的同一类冲突，这里沿用同一套「内层先吃掉」的让位协议；
 *  - 点外部（pointerdown 捕获）关菜单；滚动/缩放也关（菜单是 absolute 锚点，不跟滚）；
 *  - 关掉后焦点回到 ⋯ 按钮；点菜单项时**先**还焦再执行动作 —— 若动作打开弹层，
 *    弹层自己的 initialFocus/restoreFocus 会接力，不会把焦点抢回来。
 *
 * 布局归属（2026-11-02 与 CSS 侧对表后确定）：菜单**就地渲染**在 `.awu-heroActions` 里，
 * 定位完全交给 CSS（`.awu-menu{ position:absolute; top:100%; right:0 }`，锚点是
 * `.awu-heroActions{ position:relative }`）。JSX 不写任何内联定位/外观；
 * `aria-expanded` 是 CSS 的选中态钩子（`.awu-menuBtn[aria-expanded="true"]`），开合必须同步。
 */
function CardMenu(props: {
  label: string
  items: CardMenuItem[]
  busy: boolean
  /** 给内层让位（与 Overlay 的 escYield 同义；详情页里目前恒为 false） */
  escYield?: boolean
}): JSX.Element {
  const { label, items, busy, escYield = false } = props
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useInitialFocus(menuRef, open)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) === true) return
      if (btnRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || escYield) return
      event.preventDefault()
      // 必须 stopPropagation：面板自己在 **document 捕获** 阶段监听 Esc 收起整块面板，
      // 而同一节点上的其它捕获监听不会被 stopPropagation 拦（只有 stopImmediatePropagation 能）。
      // 所以这条监听挂在 **window 捕获** 上（捕获顺序 window → document），
      // 才能真正做到「内层先吃 Esc」——与 Overlay 的 escYield 是同一套让位协议。
      event.stopPropagation()
      setOpen(false)
      btnRef.current?.focus()
    }
    const closeNow = (): void => { setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', closeNow, true)
    window.addEventListener('resize', closeNow)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', closeNow, true)
      window.removeEventListener('resize', closeNow)
    }
  }, [open, escYield])

  /**
   * 菜单内的方向键导航（`role="menu"` 的配套义务：↑↓ 换项、Home/End 首尾）。
   * 不实现这段的话，`role="menu"` 只是给读屏的一个假承诺 —— Tab 仍能走，但键盘用户
   * 会按 ↑↓ 期待移动却毫无反应。
   */
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const root = menuRef.current
    if (root === null) return
    const nodes = Array.from(root.querySelectorAll<HTMLButtonElement>('.awu-menuItem'))
    if (nodes.length === 0) return
    event.preventDefault()
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? nodes.length - 1
        : (current + step + nodes.length) % nodes.length
    nodes[next].focus()
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="awu-menuBtn"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { if (!busy) setOpen(current => !current) }}
        disabled={busy}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="awu-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map(item => (
            <Fragment key={item.key}>
              {item.sepBefore === true && <div className="awu-menuSep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className="awu-menuItem"
                data-kind={item.danger === true ? 'danger' : undefined}
                onClick={() => {
                  setOpen(false)
                  btnRef.current?.focus()
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  )
}

/** 详情页「最近日记」只给这么多行（跨天累加，超出由「在日记里看全部」接手）。 */
const DETAIL_DIARY_LINES = 8

/**
 * 取最近 N 行日记（天倒序，行内先时间线后札记）。
 *
 * `DiaryList` 按天分组渲染，所以这里返回的仍是「按天的 DiaryEntry」，只是每天的
 * 行数被裁剪过；调用方不需要知道裁剪细节。
 */
function recentDiaryLines(entries: DiaryEntry[], maxLines: number): DiaryEntry[] {
  const out: DiaryEntry[] = []
  let used = 0
  for (const day of sortedDiary(entries)) {
    if (used >= maxLines) break
    const room = maxLines - used
    const timeline = day.timeline.slice(0, room)
    const notes = day.notes.slice(0, Math.max(0, room - timeline.length))
    if (timeline.length === 0 && notes.length === 0) continue
    out.push({ date: day.date, timeline, notes })
    used += timeline.length + notes.length
  }
  return out
}

// ---------------------------------------------------------------- 共享元素（list ↔ detail 头像）

/** 量出来的矩形快照（只留四个数：DOMRect 是活对象，跨渲染/跨卸载不该长期持有）。 */
interface MorphRect {
  left: number
  top: number
  width: number
  height: number
}

function rectOf(el: Element): MorphRect {
  const rect = el.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** 按 `data-card-id` 找左栏那张卡的头像（不用属性选择器拼字符串：卡名可能带引号）。 */
function findCardAvatar(name: string): HTMLElement | null {
  if (typeof document === 'undefined' || name === '') return null
  for (const card of Array.from(document.querySelectorAll<HTMLElement>('.awu-card[data-card-id]'))) {
    if (card.getAttribute('data-card-id') !== name) continue
    const avatar = card.querySelector<HTMLElement>('[data-morph="avatar"]')
    return avatar
  }
  return null
}

/**
 * 头像共享元素（list → detail 的「同一张卡长大了」）。
 *
 * 做法是纯 WAAPI + 内联 transform，不引新 CSS：
 *  1. 点卡时记下那张卡 avatar 的矩形（`openCharacter` 里）；
 *  2. 详情页挂载、数据到位后量 hero avatar 的矩形；
 *  3. 用 `translate(dx,dy) scale(s)` → `none` 画 240ms（T_MID + EASE）；
 *  4. 期间挂 `data-morphing="true"`（给 CSS/调试一个抓手，也避免 hover 位移抢 transform）。
 *
 * 只做 translate + scale，不做宽高动画：两个 avatar 的圆角/字号本就不同，
 * 插值宽高会在中途出现"字被拉伸"的瞬间，而 transform 走合成层、不触发重排。
 */
function morphAvatar(from: MorphRect, target: HTMLElement): Animation | null {
  const to = rectOf(target)
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return null
  const scale = from.width / to.width
  const dx = (from.left + from.width / 2) - (to.left + to.width / 2)
  const dy = (from.top + from.height / 2) - (to.top + to.height / 2)
  target.setAttribute('data-morphing', 'true')
  const animation = target.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'translate(0, 0) scale(1)' }],
    { duration: T_MID, easing: EASE },
  )
  const done = (): void => {
    target.removeAttribute('data-morphing')
    animation.onfinish = null
    animation.oncancel = null
  }
  animation.onfinish = done
  animation.oncancel = done
  // 兜底：元素被打断/隐藏时 finish/cancel 可能不来，属性留着就永远关着 hover 那一层
  window.setTimeout(done, T_MID + 80)
  return animation
}

// ---------------------------------------------------------------- 角色详情

function CharacterDetailView(props: {
  detail: CharacterDetail | undefined
  loading: boolean
  error: string
  relation: RelationState | undefined
  /** 全局启用的就是这张卡 */
  live: boolean
  /** 这张卡已绑定到**当前会话** */
  boundHere: boolean
  /** 当前会话 id；空串 = 宿主没给，无法绑定 */
  sessionId: string
  busy: boolean
  t: Translate
  onBack: () => void
  onRetry: () => void
  /** 把这张卡绑定到当前会话 */
  onBindSession: () => void
  /** 解除本会话绑定 */
  onUnbindSession: () => void
  /** 全局启用 / 退出全局（同一个按钮的两态） */
  onActivate: () => void
  onDeactivate: () => void
  onDelete: () => void
  onEdit: () => void
  /** 跳到「日记」tab 看这位的全量日记 */
  onOpenDiary: () => void
  /** 导出这张卡的 CCv3 JSON（纯前端 Blob，不碰接口） */
  onExport: () => void
  /** ⋯ 菜单：切交互模式 */
  onSwitchMode: () => void
  /** ⋯ 菜单：换一句开场 */
  onNextOpening: () => void
  /** 进详情前记下的卡片头像矩形（共享元素的起点）；undefined = 不播 */
  morphFrom?: { name: string; rect: MorphRect }
  /** 播完（或跳过）后通知面板清掉起点，避免重复播放 */
  onMorphDone?: () => void
  /** 正在退场（160ms 向左淡出）：根节点挂 data-state，期间不吃指针事件。 */
  closing?: boolean
  /** 面板持有的根节点 ref：`usePresence` 要拿它做退场首帧的焦点释放与卸载后还焦。 */
  rootRef?: React.RefObject<HTMLDivElement | null>
}): JSX.Element {
  const {
    detail, loading, error, relation, live, boundHere, sessionId, busy, t,
    onBack, onRetry, onBindSession, onUnbindSession, onActivate, onDeactivate, onDelete, onEdit,
    onOpenDiary, onExport, onSwitchMode, onNextOpening, morphFrom, onMorphDone, closing = false, rootRef,
  } = props

  /**
   * 共享元素：hero 头像从卡片头像的位置「长」到自己的位置。
   *
   * 时序要注意：详情页先渲染 Skeleton（detail 还没到），hero 此时**不存在**，
   * 所以不能只在挂载时跑一次 —— 依赖 `detail`，等数据到位、hero 进 DOM 的那一帧再量。
   * `morphTriedRef` 保证一张卡只播一次（loading → error → retry 不会反复播）。
   */
  // 父级传了 ref 就用它（usePresence 必须拿同一个节点）；没传则自己兜一个
  const localDetailRootRef = useRef<HTMLDivElement | null>(null)
  const detailRootRef = rootRef ?? localDetailRootRef
  const morphTriedRef = useRef(false)
  useLayoutEffect(() => {
    if (detail === undefined || morphTriedRef.current) return undefined
    morphTriedRef.current = true
    const done = (): void => { onMorphDone?.() }
    if (morphFrom === undefined || morphFrom.name !== detail.name || prefersReducedMotion()) {
      done()
      return undefined
    }
    const hero = detailRootRef.current?.querySelector<HTMLElement>('.awu-detailHero [data-morph="avatar"]') ?? null
    const animation = hero === null ? null : morphAvatar(morphFrom.rect, hero)
    if (animation === null) done()
    return () => {
      // 换人/卸载时停掉：残留的 WAAPI 动画会跟着新节点跑（translate 到旧卡片的位置）
      try { animation?.cancel() } catch { /* 已结束的动画 cancel 会抛，忽略 */ }
      if (hero !== null) hero.removeAttribute('data-morphing')
    }
  }, [detail, morphFrom, onMorphDone])

  /**
   * 退场开始：先把还在播的头像 morph 停掉并摘属性。
   *
   * 两个动画作用在**同一个元素**上（hero avatar）：morph 写 transform、退场写 opacity/位移，
   * 期间还挂着 `data-morphing` 会让"退场中"和"共享元素"两套状态同时为真。
   * 退场是"离开"，优先级更高，所以这里主动 cancel（cancel 会触发 morph 自己的 cleanup）。
   */
  useEffect(() => {
    if (!closing) return
    const hero = detailRootRef.current?.querySelector<HTMLElement>('.awu-detailHero [data-morph="avatar"]') ?? null
    if (hero === null) return
    for (const animation of hero.getAnimations()) {
      try { animation.cancel() } catch { /* 已结束 */ }
    }
    hero.removeAttribute('data-morphing')
  }, [closing])

  if (loading) return <Skeleton label={t('common.loading')} />

  // 加载失败：detail 已被清空，必须显式给出「空态 + 重试」，否则只会永远转圈
  if (detail === undefined) {
    if (error === '') return <Skeleton label={t('common.loading')} />
    return (
      <div className="awu-detail">
        <div className="awu-detailNav">
          <button type="button" className="awu-navBack" onClick={onBack} aria-label={t('detail.back')} title={t('detail.back')}>
            <IconBack size={13} />
            <span>{t('detail.back')}</span>
          </button>
        </div>
        {/* role="alert"：整块视图被换成错误态时，读屏要主动念一次（a11y 脚本 ④ 的 skip 项） */}
        <div className="awu-empty" data-kind="error" role="alert">
          <span className="awu-emptyMark"><IconAlert size={20} /></span>
          <span className="awu-emptyTitle">{t('detail.loadFailed')}</span>
          <span className="awu-emptyHint">{error}</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="awu-btn" data-size="sm" onClick={onRetry} disabled={busy}>
              {t('common.retry')}
            </button>
            <button type="button" className="awu-btn" data-size="sm" onClick={onBack}>
              {t('detail.back')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const card = detail.card
  const basic = entriesOf(card.basic)
  const personality = entriesOf(card.personality)
  const voice = entriesOf(card.voice)
  const relationship = entriesOf(card.relationship)
  const turns = Number(detail.session?.turn_count ?? 0) || 0
  // 标题写「最近日记」就得真的只给最近几条（C 报告 P1-5：以前是整份日记全渲染）。
  const recentDiary = recentDiaryLines(detail.diary, DETAIL_DIARY_LINES)

  return (
    <div
      className="awu-detail"
      ref={detailRootRef}
      /*
        退场（遗留 1）：方向恒为向左 —— 返回落点是左栏列表，进/出不该有两个方向。
        pointer-events 在退场期关掉：否则 160ms 里还能点到正在淡出的「删除 / 重置」。
        ⚠️ 玻璃铁律：这里只给**详情内容**加 opacity/transform 动画，
        `.awu-panel` 及其祖先一律不动（KB 08 §3）。
      */
      {...presenceAttrs(closing)}
      data-exit={closing ? 'left' : undefined}
      style={closing ? { pointerEvents: 'none' } : undefined}
    >
      {/*
        返回是一条独立的「导航」，不是「动作」：
        放在详情内容的左上角、单独一行，和启用/删除这类会改变状态的操作彻底分开。
      */}
      <div className="awu-detailNav">
        <button
          type="button"
          className="awu-navBack"
          onClick={onBack}
          aria-label={t('detail.back')}
          title={t('detail.back')}
        >
          <IconBack size={13} />
          <span>{t('detail.back')}</span>
        </button>
        <span className="awu-detailNavTitle">{detail.name}</span>
      </div>

      <div className="awu-detailHero">
        <Avatar name={detail.name} size="hero" live={live} morph />
        <div className="awu-heroBody">
          <div className="awu-heroName">{detail.name}</div>
          <div className="awu-heroSub">
            {roleOf(card) !== '' ? roleOf(card) : t('common.unknown')}
            {' · '}
            {t('roster.memory', { n: detail.diary.reduce((n, d) => n + d.timeline.length, 0) })}
            {' · '}
            {turns} {t('stats.turns')}
          </div>
          {/*
            第二行元信息：把 hero 左右之间那块空处填上「关系起点 / 最近互动」。
            这两项在详情数据里本来就有（relation.baseline、session.last_ts），
            只是原先只画在「日记」tab 里，详情页看不到。
          */}
          <div className="awu-heroMeta">
            {relation !== undefined && relation.baseline !== '' && (
              /* title 挂 relation.note：这句话解释了「起点 ≠ 当前档」，以前它是个零引用死键 */
              <span className="awu-heroMetaItem" data-role="relation" title={t('relation.note')}>
                {t('relation.baselineShort')}
                <b>{relation.baseline}</b>
              </span>
            )}
            {(relation?.lastActive ?? detail.session?.last_ts ?? '') !== '' && (
              <span className="awu-heroMetaItem" data-role="active">
                {t('detail.lastActive')}
                <b>{relativeDay(String(relation?.lastActive ?? detail.session?.last_ts ?? ''), t)}</b>
              </span>
            )}
          </div>
        </div>
        <div className="awu-heroActions">
          {/*
            动作收敛成「1 主 + 1 次 + ⋯」（契约 §2.5，C 报告 P1-4）：
            - 主：本会话绑定（已绑定时**同位置**变「解除绑定」，不再并排两枚）
            - 次：编辑
            - ⋯：全局启用 / 退出全局、切模式、换开场、导出（危险项不在这里）
            主按钮同时写 `data-tone="primary"`（契约给 CSS 的钩子）与 `data-kind="primary"`
            （现有 .awu-btn 主色规则）：两边都在，样式合并期任一侧都不会丢样子。
          */}
          {boundHere ? (
            <button type="button" className="awu-btn" data-size="md" onClick={onUnbindSession} disabled={busy}>
              <IconEject size={12} />
              {t('detail.bindSessionOff')}
            </button>
          ) : (
            <button
              type="button"
              className="awu-btn"
              data-size="md"
              data-kind="primary"
              data-tone="primary"
              onClick={onBindSession}
              disabled={busy || sessionId === ''}
              title={sessionId === '' ? t('bind.noSession') : t('bind.hint.session')}
            >
              <IconPower size={12} />
              {t('detail.bindSession')}
            </button>
          )}
          <button
            type="button"
            /* 稳定 id：编辑器关闭后按它还焦（见 CharacterPanel 里的 wasEditingRef 说明） */
            id="awu-detail-edit"
            className="awu-btn awu-editEntry" data-kind="edit"
            data-size="md"
            onClick={onEdit}
            disabled={busy}
          >
            <IconQuill size={12} />
            {t('detail.edit')}
          </button>
          <CardMenu
            label={t('detail.more')}
            busy={busy}
            items={[
              live
                ? { key: 'global', label: t('detail.globalOff'), onSelect: onDeactivate }
                : { key: 'global', label: t('detail.globalOn'), onSelect: onActivate },
              { key: 'mode', label: t('active.mode.switch'), onSelect: onSwitchMode, sepBefore: true },
              { key: 'opening', label: t('opening.next'), onSelect: onNextOpening },
              { key: 'export', label: t('detail.export'), onSelect: onExport, sepBefore: true },
            ]}
          />
        </div>
      </div>

      {/*
        边界说明**可见**（不塞 tooltip）：两种启用各自影响谁、以及子代理不吃会话绑定。
        这是主人明确要求的「边界清晰」，也是以后不被当成 bug 报上来的依据。
      */}
      <div className="awu-bindHints">
        <div className="awu-bindHint">
          <b>{t('detail.bindSession')}</b>
          <span>{sessionId === '' ? t('bind.noSession') : t('bind.hint.session')}</span>
        </div>
        <div className="awu-bindHint">
          <b>{t('detail.globalOn')}</b>
          <span>{t('bind.hint.global')}</span>
        </div>
        <div className="awu-bindHint" data-muted="true">
          <span>{t('bind.hint.subagent')}</span>
        </div>
      </div>

      {/* 正则脚本：中性信息（不是警告）——本卡带了 N 条，已屏蔽 */}
      {countRegexScripts(detail.ccv3) > 0 && (
        <div className="awu-noteRow" role="status">
          <span className="awu-noteDot" aria-hidden="true" />
          <span>{t('regex.blocked', { n: countRegexScripts(detail.ccv3) })}</span>
        </div>
      )}

      {basic.length > 0 && (
        <Section title={t('detail.card')}>
          {basic.map(([k, v]) => <Field key={k} k={k} v={v} />)}
        </Section>
      )}
      {personality.length > 0 && (
        <Section title={t('detail.personality')}>
          {personality.map(([k, v]) => <Field key={k} k={k} v={v} />)}
        </Section>
      )}
      {voice.length > 0 && (
        <Section title={t('detail.voice')}>
          {voice.map(([k, v]) => <Field key={k} k={k} v={v} />)}
        </Section>
      )}
      {relationship.length > 0 && (
        <Section title={t('detail.relationship')}>
          {relationship.map(([k, v]) => <Field key={k} k={k} v={v} />)}
        </Section>
      )}
      <Section title={t('detail.diary')} count={detail.diary.length}>
        {detail.diary.length === 0 ? (
          <div className="awu-emptyHint" style={{ padding: '10px 0' }}>{t('detail.diaryEmpty')}</div>
        ) : (
          <>
            <DiaryList entries={recentDiary} t={t} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0 10px' }}>
              <button type="button" className="awu-btn" data-size="sm" data-kind="ghost" onClick={onOpenDiary}>
                {t('detail.diaryMore', { n: detail.diary.length })}
              </button>
            </div>
          </>
        )}
      </Section>

      {/*
        危险操作下沉到页面最底部、与「改点什么」彻底分开（C 报告 P1-4）：
        hero 里只留 1 主 + 1 次 + ⋯，删除改在这里，复用日记页那套 dangerZone 样式。
      */}
      <div className="awu-dangerZone">
        <div className="awu-sectionHead">{t('diary.actions')}</div>
        <div className="awu-dangerRow">
          <div className="awu-dangerText">
            <b data-danger="true">{t('detail.delete')}</b>
            <span>{t('detail.deleteHint')}</span>
          </div>
          <button
            type="button"
            className="awu-btn"
            data-size="sm"
            data-kind="danger"
            onClick={onDelete}
            disabled={busy}
          >
            {t('detail.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 日记页

/**
 * 日记页内容。
 *
 * 抽出来是因为「空」有**三种**，之前混成一种：没选角色 / 选了但没日记 / 加载失败。
 * 真机上「选了卡没启用」被错显示成「先启用或选择一位角色」，根因是上游只认启用角色；
 * 这里按名字渲染，并把「没日记」单独给一句话，别让用户以为选错了卡。
 */
function DiaryView(props: {
  entry: CharacterDetail
  /**
   * 已经格式化好的关系条（`undefined` = 这条不显示）。
   *
   * 由面板按「看谁的日记显示谁的关系」算好再传进来：`tag` 是「名字（当前档）」，
   * `meta` 是「N 轮 · 几天前」。这里不碰 `RelationState`，省得又拿启用角色的数据贴错人。
   */
  relation: { tag: string; meta: string } | undefined
  busy: boolean
  t: Translate
  onForget: () => void
  onEdit: (target: DiaryTarget) => void
  onReset: (scope: 'session' | 'all') => void
}): JSX.Element {
  const { entry, relation, busy, t, onForget, onEdit, onReset } = props
  const empty = entry.diary.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {/*
        关系条：当前档在左、轮数/最近在右。数据来自「这张卡自己」——GET /character 会按卡
        带回 relation（current 是落盘当前档，baseline 才是起点），面板那份实时 relation
        只在快照缺失时兜底。
      */}
      {relation !== undefined && (
        <div className="awu-relation">
          <span className="awu-relationLabel">{t('relation.title')}</span>
          <span className="awu-relationTag">
            {relation.tag !== '' ? relation.tag : t('relation.none')}
          </span>
          {relation.meta !== '' && <span className="awu-relationMeta">{relation.meta}</span>}
        </div>
      )}

      <div className="awu-diaryHead">
        <span className="awu-sectionLabel">{entry.name}</span>
        <span className="awu-count">{entry.diary.length}</span>
        <button
          type="button"
          className="awu-btn"
          data-size="sm"
          data-kind="ghost"
          style={{ marginLeft: 'auto' }}
          onClick={onForget}
          disabled={busy}
        >
          <IconQuill size={12} />
          {t('forget.title')}
        </button>
      </div>

      {empty ? (
        <div className="awu-empty" data-kind="diary">
          <span className="awu-emptyMark"><IconQuill size={20} /></span>
          <span className="awu-emptyTitle">{t('diary.emptyFor', { name: entry.name })}</span>
          <span className="awu-emptyHint">{t('diary.emptyForHint')}</span>
        </div>
      ) : (
        /* 记忆回顾：搜索 / 按月折叠 / 导出 markdown（纯前端，见 diary-review.tsx） */
        <DiaryReview name={entry.name} entries={entry.diary} t={t} onEdit={onEdit} />
      )}

      {/* 维护：全新开始 / 彻底重置。标题用 `diary.actions`（「维护」）——
          原来复用了 `reset.title`（「重新开始」），等于把区块标题和其中一行按钮写成了同一个词。 */}
      <div className="awu-dangerZone">
        <div className="awu-sectionHead">{t('diary.actions')}</div>
        <div className="awu-dangerRow">
          <div className="awu-dangerText">
            <b>{t('reset.session')}</b>
            <span>{t('reset.sessionHint')}</span>
          </div>
          <button
            type="button"
            className="awu-btn"
            data-size="sm"
            onClick={() => onReset('session')}
            disabled={busy}
          >
            {t('reset.session')}
          </button>
        </div>
        <div className="awu-dangerRow">
          <div className="awu-dangerText">
            <b data-danger="true">{t('reset.all')}</b>
            <span>{t('reset.allHint')}</span>
          </div>
          <button
            type="button"
            className="awu-btn"
            data-size="sm"
            data-kind="danger"
            onClick={() => onReset('all')}
            disabled={busy}
          >
            {t('reset.all')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 主组件

/**
 * 判断侧栏是否处于「宽态」。
 *
 * 不能只信 `wide` prop：宿主在不同版本 / 不同渲染路径下可能传 `undefined`、
 * 不传，或者值滞后一帧。只按 prop 判断的话，`props.wide !== false` 会把
 * 「没传」当成宽态，于是收起的 36px 轨道里塞进 44px 高的两行按钮——文字被挤成
 * 竖排、按钮溢出轨道（线上就踩过这个）。
 *
 * 所以以**实测容器宽度**为准，prop 只用来做首帧的初始猜测：
 *  - 量到宽度 < RAIL_MAX_WIDTH → 窄轨；
 *  - 量到足够宽 → 宽态；
 *  - 量不到（首帧、display:none、SSR）→ 退回 prop，prop 也没有就按窄轨处理
 *    （宁可少显示文字，也不能把布局撑破）。
 */
const RAIL_MAX_WIDTH = 96

/**
 * 判断侧栏是否处于「宽态」。
 *
 * **实测宽度是唯一真源**，`propWide` 只在「量不到宽度」时兜底（首帧、display:none、SSR）：
 *  - 量到宽度 < RAIL_MAX_WIDTH → 窄轨；
 *  - 量到足够宽 → 宽态；
 *  - 量不到 → 用 prop；prop 也没有就按窄轨（宁可少显示文字，也不能把布局撑破）。
 *
 * 2026-11-02 收敛（C 报告 P1-11）：原先这里还有第二个 effect，在 `propWide !== undefined`
 * 时**无条件** `setWide(propWide)`，把实测值覆盖掉 —— 只要宿主在收起动画中先传了
 * `wide: true`，36px 轨道就会重新塞进 44px 的两行按钮（正是这段注释描述过的线上事故）。
 * 现在只剩一条来源：`measure()`；prop 只参与「量不到时」的兜底。
 */
function useWideLayout(ref: React.RefObject<HTMLElement | null>, propWide: boolean | undefined): boolean {
  // 首帧用 prop 猜；拿不到 prop 时先按窄轨渲染，量完再纠正
  const guess = propWide === undefined ? false : propWide
  const [wide, setWide] = useState(guess)

  useEffect(() => {
    const el = ref.current
    if (el === null) {
      setWide(guess)
      return undefined
    }

    const measure = (): void => {
      const width = el.getBoundingClientRect().width
      const next = width > 0 ? width >= RAIL_MAX_WIDTH : (propWide === undefined ? false : propWide)
      // 同值不落 state：ResizeObserver 每次回调都 setWide 会白排一次渲染
      setWide(current => (current === next ? current : next))
    }

    measure()

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ref, propWide, guess])

  return wide
}

/** 与 `styles.ts` 唯一断点一致：<900 收单栏。 */
const NARROW_VIEWPORT = 900

/** 每帧只写一次（多次 pointermove 合到一帧），避免 50 张卡的网格上逐事件触发布局。 */
interface GlassPoint { el: HTMLElement; x: number; y: number }

/**
 * 指针跟随玻璃高光（契约 §2.1 / §6 的「指针高光」条目）。
 *
 * CSS 侧已就绪：`.awu-card::after` 用 `radial-gradient(240px circle at var(--awu-mx,50%) var(--awu-my,-20%), …)`
 * —— 没有变量时它就是原来那束「顶部中央静态高光」，所以 JS 不写变量 = 退化成旧观感，绝不会坏。
 *
 * 三个约束（都是「不这么做就会卡」的）：
 *  1. **事件委托在网格容器上**，不给 50 张卡各挂一份监听；
 *  2. **rAF 合帧**：同一帧内只写最后一次坐标，`pointermove` 本身不再触发布局；
 *  3. 只在 `fine pointer` 且用户没要求 reduced-motion 时绑定（触摸屏上这束光不会动，绑了纯烧 CPU）。
 *
 * 复位：`pointerleave` 走捕获阶段（该事件不冒泡），把两个自定义属性**删掉**而不是写回 50%/-20%，
 * 这样 CSS 的 `var(…, 默认值)` 兜底语义才成立。
 */
function useCardGlassFx(rootRef: React.RefObject<HTMLElement | null>, enabled: boolean, mounted: boolean): void {
  useEffect(() => {
    const root = rootRef.current
    if (!enabled || !mounted || root === null) return undefined
    let raf = 0
    let watchdog = 0
    let pending: GlassPoint | undefined

    const flush = (): void => {
      raf = 0
      if (watchdog !== 0) { window.clearTimeout(watchdog); watchdog = 0 }
      const point = pending
      pending = undefined
      if (point === undefined) return
      point.el.style.setProperty('--awu-mx', `${point.x}%`)
      point.el.style.setProperty('--awu-my', `${point.y}%`)
    }

    /**
     * rAF 合帧 + **64ms 看门狗**。
     *
     * 只用 rAF 会有一个真机可见的坑：首帧/长任务/后台标签页时 rAF 可能迟迟不来，
     * 那束光就"卡住不动"（CDP 里就复现了：pointermove 已经进了 handler，变量却没写上）。
     * 看门狗保证最坏 64ms 也会落一次写；正常路径仍然是一帧一次。
     */
    const schedule = (): void => {
      if (raf !== 0) return
      const frame = window.requestAnimationFrame(() => { flush() })
      raf = frame
      watchdog = window.setTimeout(() => {
        if (raf !== frame) return
        window.cancelAnimationFrame(frame)
        flush()
      }, 64)
    }

    const cardOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null
      const card = target.closest('.awu-card')
      if (!(card instanceof HTMLElement)) return null
      return root.contains(card) ? card : null
    }

    const onMove = (event: PointerEvent): void => {
      const card = cardOf(event.target)
      if (card === null) return
      const rect = card.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pending = {
        el: card,
        x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
        y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
      }
      schedule()
    }

    const onLeave = (event: PointerEvent): void => {
      const card = cardOf(event.target)
      if (card === null) return
      card.style.removeProperty('--awu-mx')
      card.style.removeProperty('--awu-my')
    }

    root.addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerleave', onLeave, true)
    root.addEventListener('pointercancel', onLeave, true)
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      if (watchdog !== 0) window.clearTimeout(watchdog)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave, true)
      root.removeEventListener('pointercancel', onLeave, true)
    }
  }, [rootRef, enabled, mounted])
}

/**
 * 列表 FLIP（契约 §3「删卡 / 排序」）：用 WAAPI 把「顺序或数量变了」这件事画出来。
 *
 * 只做 Y 轴：卡片墙是单列/两列竖向流，X 位移在换列时会显得很吵（而且和 hover 上浮撞）。
 * 与 `.awu-card:hover { transform: translateY(-2px) }` 的冲突：WAAPI 动画在运行期**优先于**
 * CSS transform（animations 覆盖普通声明），但动画结束后残留的 hover 位移仍会让卡片跳 2px，
 * 所以期间给卡片挂 `data-flipping="true"`，CSS 侧据此临时关掉 hover 位移（本文件不写这条规则）。
 *
 * `enabled=false`（reduced-motion）时整段跳过，并把上一帧快照清掉，避免恢复动效时补一段旧位移。
 */
function useListFlip(
  rootRef: React.RefObject<HTMLElement | null>,
  deps: readonly unknown[],
  enabled: boolean,
): void {
  const prevRects = useRef<Map<string, DOMRect> | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    if (!enabled) { prevRects.current = null; return }

    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.awu-card[data-card-id]'))
    const next = new Map<string, DOMRect>()
    for (const el of nodes) {
      const id = el.getAttribute('data-card-id')
      if (id !== null) next.set(id, el.getBoundingClientRect())
    }
    const prev = prevRects.current
    prevRects.current = next
    if (prev === null) return

    for (const el of nodes) {
      const id = el.getAttribute('data-card-id')
      if (id === null) continue
      const before = prev.get(id)
      const after = next.get(id)
      if (before === undefined || after === undefined) continue
      const dy = before.top - after.top
      if (Math.abs(dy) < 1) continue
      el.setAttribute('data-flipping', 'true')
      const animation = el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: T_BASE, easing: EASE },
      )
      /**
       * 兜底计时器 + 事件双保险：元素如果被重渲染/隐藏打断，WAAPI 的 finish/cancel
       * 不一定会来，属性会永久留在卡上（hover 位移就永远被关掉了）。
       */
      let timer = 0
      const clear = (): void => {
        if (timer !== 0) { window.clearTimeout(timer); timer = 0 }
        el.removeAttribute('data-flipping')
      }
      animation.onfinish = clear
      animation.oncancel = clear
      timer = window.setTimeout(clear, T_BASE + 60)
    }
    // 注意：deps 必须**展开**。直接传 `deps` 会因为它每次 render 都是新数组而每次都跑一遍
    // 布局测量（50 张卡 = 每帧 50 次 getBoundingClientRect），那是比不动画更贵的事。
  }, [rootRef, enabled, ...deps])
}


/**
 * 视口是否窄于 `maxWidth`。
 *
 * 为什么 JSX 必须自己知道窄不窄：`<900` 的「单栏导航栈」是**状态机**
 * （契约 §2.1 `data-nav=split|push|pop`），不是 CSS 藏一藏就能对的东西 ——
 * 被藏起来的那一列里，滚动位置、焦点、tablist 都还活着，会出现
 * 「tab 点不到」「焦点跑到看不见的地方」这类问题。所以这里量视口，
 * 由 JSX 决定 `data-nav` 取值、以及 tablist 放进哪一列。
 */
function useNarrowViewport(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    let media: MediaQueryList
    try {
      media = window.matchMedia(query)
    } catch {
      return undefined
    }
    const onChange = (): void => { setNarrow(media.matches) }
    onChange()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }
    // 老 WebView 只有已废弃的 addListener
    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [query])

  return narrow
}

/**
 * 侧栏底部入口 + 悬浮面板。
 *
 * `wide` 由侧栏壳注入：false 表示侧栏收起（56px 窄轨），此时**只渲染圆徽**，
 * 文字节点根本不进 DOM（不靠 CSS 藏），彻底避免窄容器里的逐字换行。
 */
export function CharacterPanel(props: FooterActionProps): JSX.Element {
  const t = useMemo(() => makeTranslator(props.t), [props.t])

  // 样式兜一次底：正常由 entry 的 effect 注入；万一组件先于 effect 挂载、
  // 或宿主做了模块热替换导致 effect 没重跑，这里保证 .awu-* 规则一定在。
  useEffect(() => { installStyles() }, [])

  const layerRef = useRef<HTMLDivElement | null>(null)
  const wide = useWideLayout(layerRef, typeof props.wide === 'boolean' ? props.wide : undefined)
  /** 视口是否 <900（单栏导航栈只在窄屏生效）。 */
  const narrow = useNarrowViewport(NARROW_VIEWPORT)

  const [open, setOpen] = useState(false)
  // 首次打开面板时把「指南」当一次落地页（读 localStorage 标记，隐私模式下按已看过处理）
  const [tab, setTab] = useState<Tab>(() => (guideFirstRun() ? 'guide' : 'roster'))
  const [list, setList] = useState<CharacterSummary[]>([])
  const [overview, setOverview] = useState<Overview | undefined>(undefined)
  const [active, setActive] = useState<ActiveState>({ enabled: false })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /**
   * 提示条。
   *
   * `ok` 类 5 秒后自动消失（还得能手动关）；`warn` 类（保存时的软警告）**留到用户手动关**
   * ——把「世界书超限」这种要人处理的提示卷走，比常驻更难查。错误走 `ErrorBar`，不吃这条路径。
   */
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)
  /** 提示条是否在退场（配合 data-state）。 */
  const [noticeClosing, setNoticeClosing] = useState(false)

  /**
   * 交互模式。
   *
   * `modePref` 是「本地的临时选择」：没有启用角色时宿主只写全局兜底（scope='global'），
   * 面板拿不到会话状态，只能自己记住这次选择，等启用角色后立刻补一次 `/mode`。
   */
  const [modePref, setModePref] = useState<InteractionMode | undefined>(undefined)

  /**
   * 会话级绑定。
   *
   * - `sessionId`：宿主 `/overview.sessionId`（当前这个会话的 id）。**拿不到就是空串**，
   *   面板据此禁用「当前会话启用」——绝不在客户端编一个 id 写进绑定表。
   * - `bindings`：`sessionId → 角色名`，只影响列出的会话；没列出的继续用全局。
   */
  const [sessionId, setSessionId] = useState('')
  const [bindings, setBindings] = useState<Record<string, string>>({})

  /**
   * 面板自己的会话 id 来源（审查 H4 修复的另一半）：
   * 面板在 `sidebar.footer.action` 席位拿不到 `sessionId` prop，只能借 DockSink
   * 的模块级 sink 转交（与输入框能力同一份真源）。拿它去拼 `?sessionId=` 请求，
   * 宿主识别后会在 `overview.sessionId` 原样回显，回显值才写进上面的 `sessionId` state
   * ——宿主不认的 id 不会变成「可用」。
   */
  const sinkSessionId = useComposerSession()
  /**
   * 蒸馏弹层是否开着。它自己的 `open` 在 `DistillButton` 里，不在面板的 `dialog` 状态中，
   * 所以面板级 Esc 必须单独问一句，否则 Esc 会把面板和弹层一起关掉。
   */
  const distillOverlayOpen = useDistillOverlayOpen()
  /** 会话 id 的镜像 ref：loadDetail 要在稳定的 useCallback 里读最新值，不让回调身份跟着变。 */
  const sessionIdRef = useRef('')
  useEffect(() => { sessionIdRef.current = sinkSessionId }, [sinkSessionId])

  const [detailName, setDetailName] = useState('')
  const [detail, setDetail] = useState<CharacterDetail | undefined>(undefined)
  const [detailLoading, setDetailLoading] = useState(false)
  // 详情单独持有一份错误：失败时 detail 会被清空，只靠全局 error 的话详情区会永久停在骨架屏
  const [detailError, setDetailError] = useState('')

  /**
   * 单栏导航栈（契约 §2.1 `data-nav`）。
   *
   * - `split`：宽屏 = 两栏并排；窄屏 = 「列表列」。
   * - `push` ：窄屏 = 内容列（详情 / 日记 / 统计 / 指南）覆盖列表。
   * - `pop`  ：从内容退回列表的过渡帧（`T_MID`），到点自动落回 `split`。
   *
   * 为什么是 JS 状态机而不是 CSS 断点：窄屏下两列不再是「同时可见」，而是「谁在上面」。
   * 两列各自有滚动位置与焦点，被 CSS 藏起来的那列仍活着 —— 所以栈必须由这里推。
   */
  const [navState, setNavState] = useState<'split' | 'push' | 'pop'>('split')
  const popTimer = useRef<number | undefined>(undefined)

  const clearPopTimer = useCallback((): void => {
    if (popTimer.current !== undefined) {
      window.clearTimeout(popTimer.current)
      popTimer.current = undefined
    }
  }, [])
  useEffect(() => () => { clearPopTimer() }, [clearPopTimer])

  /**
   * 骨架退场（契约 §3「骨架 → 内容」）：`loading` 结束后骨架再留 160ms 淡出，
   * 与内容的 `awu-rise` 交叉。直接同帧硬切会看到「骨架 → 内容」的瞬移。
   */
  const skeletonPresence = usePresence(loading, T_EXIT)

  /** 左栏过滤词（名字 / 身份 / 来源 / 一句话背景）。 */
  const [query, setQuery] = useState('')
  /** 正在淡出的卡名（删卡第 1 段；空串 = 没有在删）。 */
  const [deletingName, setDeletingName] = useState('')

  /**
   * 头像共享元素的「起点」与「回程起点」。
   *
   * 进向：点卡时立刻量卡片头像（那一刻列表还在，rect 才是真的）。
   * 出向：返回时量 hero 头像，等详情卸载后让卡片头像从 hero 的位置收回来。
   * 两处都用 state（不是 ref）：详情页要在首次渲染时就读到起点，ref 变更不会触发渲染。
   */
  const [morphFrom, setMorphFrom] = useState<{ name: string; rect: MorphRect } | undefined>(undefined)
  const returnMorphRef = useRef<{ name: string; rect: MorphRect } | null>(null)

  const [dialog, setDialog] = useState<'' | PanelDialog>('')
  /**
   * 弹层宿主的退场（契约 §2.2）。
   *
   * 退场要求「关掉之后还在 DOM 里待 160ms」，但弹层的渲染分支是 `dialog === 'x'` ——
   * `setDialog('')` 一执行分支就没了，动画无从谈起。所以这里记住**上一次的弹层种类**，
   * 退场期继续渲染它（各弹层自己的 deleteTarget / editTarget 等数据都还在 state 里）。
   */
  const dialogPresence = usePresence(dialog !== '', T_EXIT)
  const lastDialogRef = useRef<PanelDialog>('new')
  useEffect(() => {
    if (dialog !== '') lastDialogRef.current = dialog
  }, [dialog])
  const [deleteTarget, setDeleteTarget] = useState('')
  const [editTarget, setEditTarget] = useState<DiaryTarget | undefined>(undefined)
  const [dialogError, setDialogError] = useState('')
  const [relation, setRelation] = useState<RelationState | undefined>(undefined)
  const [openingNote, setOpeningNote] = useState('')

  // 角色卡编辑器
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState('')
  // 「本层要 Esc」的汇总开关（preset 的 `onFocusLayerChange`）：专注层打开、
  // 有未保存改动、或确认弹着 都为 true —— 这时 Overlay 的 Esc 必须让位。
  // 命名保留旧名避免大面积改名，语义以 Overlay 里 escYield 的注释为准。
  const [presetFocusOpen, setPresetFocusOpen] = useState(false)
  // 编辑器草稿是否脏：面板收起/卸载前必须据此拦一道，否则一屏编辑无声丢失
  const [editorDirty, setEditorDirty] = useState(false)
  // 递增信号：面板要求编辑器「走一遍未保存确认」（点入口/点遮罩时用）
  const [editorCloseSignal, setEditorCloseSignal] = useState(0)
  /**
   * 保存成功后的编辑器退场（C 项）：置 true → 编辑器播 160ms 再被卸载。
   * 「取消」路径由 card-editor 自己的 `useLayerExit` 负责，这条只补保存路径，
   * 两条退出方式观感才一致（从前保存成功是 `setEditing(false)` 直接硬切）。
   */
  const [editorClosing, setEditorClosing] = useState(false)
  const editorExitTimer = useRef<number | undefined>(undefined)
  /**
   * 「本轮被世界书预算裁掉」的条目（打开编辑器时解析一次）。
   *
   * 来源优先 `GET /character` 的 diag（宿主新加），拿不到才去问 `GET /preview` 的 `lore`；
   * 都没有就保持 undefined → 世界书分区里那块警示**整块不显示**（不报错、不打扰）。
   */
  const [droppedLore, setDroppedLore] = useState<LoreDroppedInfo | undefined>(undefined)

  /**
   * 面板收起 → 编辑器必须一起退出（修 6）。
   *
   * 现状：编辑器开着时点面板外，面板只是 `open=false`，`editing` 仍是 true；
   * 再点入口重开，看到的还是那屏编辑器（用户预期是回到详情/列表）。
   * 所以 `open=false` 时显式清掉编辑态与退场标记，并收掉保存退场遗留的计时器。
   */
  useEffect(() => {
    if (open) return
    if (editing) setEditing(false)
    setEditorClosing(false)
    if (editorExitTimer.current !== undefined) {
      window.clearTimeout(editorExitTimer.current)
      editorExitTimer.current = undefined
    }
  }, [open, editing])

  // 编辑器关掉后清脏标记，避免下次打开误拦；顺便复位退场标记
  useEffect(() => {
    if (editing) return
    setEditorDirty(false)
    setEditorClosing(false)
    if (editorExitTimer.current !== undefined) {
      window.clearTimeout(editorExitTimer.current)
      editorExitTimer.current = undefined
    }
  }, [editing])

  /**
   * 关掉编辑器后把焦点还给「编辑」按钮。
   *
   * 为什么通用 hook 做不到：编辑态是**整块替换**（下面渲染处的
   * `editing && currentDetail ? <CardEditor/> : <>详情页…</>`），「编辑」按钮随详情页子树
   * 一起卸载；`a11y.ts` 的 `useRestoreFocus` 在编辑器挂载的 effect 里读 `activeElement`，
   * 那一刻浏览器已经把焦点退回 `body`，于是它按「原本就是 body → 不记录」的设计跳过，
   * 焦点就留在 body 上（读屏用户失去上下文）。这里用按钮的稳定 id 补一次：关编辑器时
   * 详情页已经重新挂载，按 id 取到的是**新节点**，正好可以接住焦点。
   *
   * 两条兜底：保存成功那条路径会先 `setDetail(fresh)` 再关编辑器，节点可能晚一帧 →
   * 再补一帧 rAF；仍取不到就放弃（绝不瞎抢别处的焦点）。
   */
  const wasEditingRef = useRef(false)
  useEffect(() => {
    if (editing) { wasEditingRef.current = true; return undefined }
    if (!wasEditingRef.current) return undefined
    wasEditingRef.current = false
    if (typeof document === 'undefined') return undefined
    const focusEdit = (): boolean => {
      const el = document.getElementById('awu-detail-edit')
      if (el === null) return false
      try { el.focus({ preventScroll: true }) } catch { el.focus() }
      return true
    }
    if (focusEdit()) return undefined
    if (typeof window === 'undefined') return undefined
    const raf = window.requestAnimationFrame(() => { focusEdit() })
    return () => window.cancelAnimationFrame(raf)
  }, [editing])

  // 有未保存草稿时拦一下页面关闭/刷新（宿主关窗也走 beforeunload）
  useEffect(() => {
    if (!open || !editing || !editorDirty) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [open, editing, editorDirty])

  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  /**
   * 面板根的**回调 ref**：在 commit 阶段同步挂 `data-still="true"`。
   *
   * CSS 的语义是「带着 data-still 渲染 = 这次进入不要 blur」，所以这个属性必须出现在
   * 首帧的 DOM 上。用 effect 去补一定晚一帧（passive effect 在首帧之后才跑），那就没意义了；
   * 回调 ref 在 commit 里同步执行，是能拿到的最早时机。摘除仍交给 animationend + 兜底 timer。
   */
  const attachPanelRef = useCallback((node: HTMLDivElement | null): void => {
    panelRef.current = node
    if (node !== null) node.setAttribute('data-still', 'true')
  }, [])
  const aliveRef = useRef(true)
  /** 角色卡网格容器：FLIP 的测量根（高光的事件委托点在面板根，见 useCardGlassFx 的调用处）。 */
  const gridRef = useRef<HTMLDivElement | null>(null)

  /**
   * 面板延迟卸载：`open=false` 后先留 160ms 让 CSS 画完退场，再摘 DOM（契约 §2.2）。
   * 焦点释放由 hook 负责（传了 root），滚动锁必须按 `mounted` 而不是 `open`。
   */
  const panelPresence = usePresence(open, T_EXIT, panelRef)
  useScrollLock(panelPresence.mounted)

  // 面板本身也要有焦点语义：打开时把焦点送进去、Tab 不跑回宿主、关闭后还回触发按钮。
  // 编辑器/弹层打开时它们的陷阱会压在栈顶，这里不用额外处理。
  useRestoreFocus(open)
  useInitialFocus(panelRef, open)
  useFocusTrap(panelRef, open)

  /**
   * 面板动效期去模糊（契约 §2.1 的 `data-still`）。
   *
   * 只在**面板自身**的 animationstart/end 上挂摘：`animationstart` 会从子元素冒上来
   * （卡片的错峰进入、发光），所以必须用 `event.target === el` 过滤，否则卡片一动就把
   * 整个面板的 backdrop-filter 摘了。
   */
  useEffect(() => {
    const el = panelRef.current
    if (el === null) return undefined
    const clearStill = (): void => { el.removeAttribute('data-still') }
    const onStart = (event: AnimationEvent): void => {
      if (event.target === el) el.setAttribute('data-still', 'true')
    }
    const onEnd = (event: AnimationEvent): void => {
      if (event.target === el) clearStill()
    }
    el.addEventListener('animationstart', onStart)
    el.addEventListener('animationend', onEnd)
    /*
      首次挂载时入场动画**已经开始**了：passive effect 在首帧之后才执行，
      等它挂监听会漏掉 animationstart（实测 data-still 一直不出现）。
      所以挂载即视为"正在动画"，再由 animationend 或兜底计时器摘掉；
      兜底计时器同时覆盖「动画被 prefers-reduced-motion 压到 0.01ms 后 animationend 也没来」
      这种边角（那种情况下属性留着才是 bug：backdrop-filter 会永久关掉）。
    */
    // 首帧的 'true' 由 attachPanelRef 在 commit 里挂好；这里只负责摘。
    const fallback = window.setTimeout(clearStill, T_ENTER + 60)
    return () => {
      window.clearTimeout(fallback)
      el.removeEventListener('animationstart', onStart)
      el.removeEventListener('animationend', onEnd)
      clearStill()
    }
  }, [panelPresence.mounted])

  // -------------------------------------------------------- 指针高光 / 列表 FLIP 的开关
  /** 细指针（鼠标/触控板）才跟随；触摸屏上这束光不会动，绑了纯烧 CPU。 */
  const finePointer = useFinePointer()
  /** 用户要求减弱动效：高光与 FLIP 都直接不绑（CSS 那边还有一层全局守卫）。 */
  const reducedMotion = useMemo(() => prefersReducedMotion(), [])

  /**
   * 玻璃高光的总开关（契约 §2.1 `[data-fx="off"]` 的 JSX 侧）。
   *
   * 现在**恒为开**：主人还没定「关掉高光」的入口放哪（预计第 3 批的设置项）。
   * 留这个常量 + `data-fx` 的接线，是为了将来接一个开关时只改一行；
   * 关闭时面板根挂 `data-fx="off"`，CSS 会把 `.awu-card::after` 退回静态顶部高光。
   */
  const GLASS_FX_ENABLED = true
  const glassFxOn = GLASS_FX_ENABLED && finePointer && !reducedMotion
  // 挂点用**面板根**而不是网格：网格会随 loading 反复挂卸（骨架↔内容），
  // 监听绑在网格上就会在第二次 loading 时丢掉。面板根的生命周期与开关一致。
  useCardGlassFx(panelRef, glassFxOn, panelPresence.mounted)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // -------------------------------------------------------- 提示条（成功自动走，警告留给人看）

  const clearNoticeTimer = useCallback((): void => {
    if (noticeTimer.current !== undefined) {
      window.clearTimeout(noticeTimer.current)
      noticeTimer.current = undefined
    }
  }, [])

  /**
   * 提示条的退场（契约 §2.3 notice 条目）：先挂 `data-state="closing"` 让它淡出 160ms，
   * 再从 state 里删。直接 `setNotice(undefined)` 是硬切，等于没有退场。
   * reduced-motion 下直接删（CSS 退场被全局守卫压到 0.01ms，等 160ms 只会像"点了没反应"）。
   */
  const noticeExitTimer = useRef<number | undefined>(undefined)
  const clearNoticeExit = useCallback((): void => {
    if (noticeExitTimer.current !== undefined) {
      window.clearTimeout(noticeExitTimer.current)
      noticeExitTimer.current = undefined
    }
  }, [])

  const dismissNotice = useCallback((): void => {
    clearNoticeTimer()
    // 已经在退场：不要重置计时（连点关闭按钮会把退场无限后推）
    if (noticeExitTimer.current !== undefined) return
    if (prefersReducedMotion()) { setNotice(undefined); setNoticeClosing(false); return }
    setNoticeClosing(true)
    noticeExitTimer.current = window.setTimeout(() => {
      noticeExitTimer.current = undefined
      setNotice(undefined)
      setNoticeClosing(false)
    }, T_EXIT)
  }, [clearNoticeTimer])

  /** TTL 到点时调用最新的 dismiss（避免 showNotice 依赖 dismissNotice 形成循环）。 */
  const dismissNoticeRef = useRef(dismissNotice)
  useEffect(() => { dismissNoticeRef.current = dismissNotice }, [dismissNotice])

  const showNotice = useCallback((text: string, tone: 'ok' | 'warn' = 'ok'): void => {
    if (text === '') return
    // 新提示覆盖旧提示：先把旧计时器清掉，否则旧计时器会提前把新提示卷走
    clearNoticeTimer()
    // 上一轮还没退完就来了新提示：中断退场，直接换成"已打开"
    clearNoticeExit()
    setNoticeClosing(false)
    setNotice({ text, tone })
    if (tone === 'ok') {
      noticeTimer.current = window.setTimeout(() => {
        noticeTimer.current = undefined
        dismissNoticeRef.current()
      }, NOTICE_TTL_MS)
    }
  }, [clearNoticeTimer, clearNoticeExit])

  // 卸载时把两个计时器都收掉，别让它去 setState 一个已经死掉的组件
  useEffect(() => () => { clearNoticeTimer(); clearNoticeExit() }, [clearNoticeTimer, clearNoticeExit])

  /** 带软警告的「保存成功」：有警告整条转警示色并附逐条明细（不拦保存，也不是红条）。 */
  const notifySaved = useCallback((base: string, warnings: string[]): void => {
    if (warnings.length === 0) { showNotice(base, 'ok'); return }
    showNotice(composeSavedNotice(base, warnings, t), 'warn')
  }, [showNotice, t])

  // -------------------------------------------------------- 数据
  const reload = useCallback(async (): Promise<void> => {
    try {
      const [chars, ov] = await Promise.all([
        fetchCharacters(),
        // 带上「面板所在会话」：宿主只认 query（web.ts:222-223），不带的运行是全局视角；
        // sink 还没就绪时原样按空串发（宿主回显空 → 界面走「当前会话不可识别」降级）。
        fetchOverview(sinkSessionId).catch(() => undefined),
      ])
      if (!aliveRef.current) return
      setList(chars)
      if (ov !== undefined) {
        setOverview(ov)
        setActive(ov.active ?? { enabled: false })
        // 会话绑定：老宿主没有这几个字段 → 空串 / 空表（界面自动退化成只用全局）
        setSessionId(typeof ov.sessionId === 'string' ? ov.sessionId : '')
        setBindings(readBindings(ov.bindings))
      }
      setError('')
    } catch (e) {
      if (!aliveRef.current) return
      setError(errorText(e))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [sinkSessionId])

  useEffect(() => { void reload() }, [reload])

  // 面板打开时静默刷新一次：外部（模型/工具）可能刚改过启用状态
  useEffect(() => {
    if (!open) return undefined
    void reload()
    const onFocus = (): void => { void reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [open, reload])

  // 打开过面板就记下「指南已看过」（标记只在浏览器 localStorage，不碰插件数据目录）
  useEffect(() => {
    if (open) markGuideSeen()
  }, [open])

  const detailSeq = useRef(0)
  /** 最后一次静默刷新的数据签名：相同就跳过 setState，避免 5 秒一次的无意义整树渲染。 */
  const quietSig = useRef('')

  const loadDetail = useCallback(async (name: string): Promise<void> => {
    if (name === '') { setDetail(undefined); setDetailError(''); return }
    // 快速切换角色时，旧请求的响应可能晚到：只认最后一次发起的那个
    const seq = detailSeq.current + 1
    detailSeq.current = seq
    setDetailLoading(true)
    try {
      // 详情页的绑定兜底（binding.boundHere）是宿主按 query 上的 sessionId 算的，
      // 不带就把那格退化成全局视角 —— 这里带上面板所在会话（ref，防止回调身份抖动）。
      const body = await fetchCharacter(name, sessionIdRef.current)
      if (!aliveRef.current || seq !== detailSeq.current) return
      setDetail(body)
      setDetailError('')
      setError('')
    } catch (e) {
      if (!aliveRef.current || seq !== detailSeq.current) return
      setDetail(undefined)
      // 不再顶到全局 error：这条错误属于详情区，由 CharacterDetailView 就地展示 + 重试
      setDetailError(errorText(e))
    } finally {
      if (aliveRef.current && seq === detailSeq.current) setDetailLoading(false)
    }
  }, [])

  /**
   * 「正在看谁」= `detailName`，**唯一真源**（C 报告 P0-1 → 本批 A2 的核心）。
   *
   * 从前这里是 `viewName = tab === 'diary' ? (detailName || 启用角色) : detailName`，
   * 而三个写盘动作（改写日记 / 忘记 / 彻底重置）都拿它当操作对象。于是「在日记 tab
   * 点一下左栏另一张卡」会**静默**换掉操作对象：界面上没有选中痕迹，用户以为还在原来那位，
   * 一次「彻底重置」就清错了卡。
   *
   * 现在只有一条路：切到日记 tab 时**显式**把默认对象写进 `detailName`（默认值 effect 在
   * `sessionName` 算出来之后，见下方），此后所有读写都用 `detailName`；
   * tab 不再参与「对象是谁」的推断。
   */
  const subjectName = detailName
  /** 日记页要展示的角色名（空串 = 既没选也没启用）。 */
  const diaryTarget = tab === 'diary' ? subjectName : ''
  useEffect(() => {
    // 空串时**不清 `detail`**：详情退场那 160ms 还要用它渲染上一次那张卡
    // （清掉的话 `currentDetail` 变 undefined，视图会退回骨架屏，`data-exit` 动画就没对象了）。
    // 串卡风险由 `currentDetail` / `diaryDetail` 的名字守卫挡住，不会显示错人。
    if (subjectName === '') return
    void loadDetail(subjectName)
  }, [subjectName, loadDetail])

  /**
   * 头部「刷新」按钮。
   *
   * 从前的写法是 `onClick={() => { void reload(); if (viewName !== '') void loadDetail(viewName) }}`：
   * 两个请求都发，但**不驱动 busy、也不重开 loading** —— 图标不转、骨架不出、界面毫无反应，
   * 而且按钮没有防连点，用户以为没生效就会连点（每点一次两发请求）。
   *
   * 现在：busy 驱动图标转圈（`data-spin` + `IconSpinner` 早就在位），loading 让角色簿骨架
   * 重新出现一次作为"正在取数"的明确信号；busy 期间的重复点击直接吃掉。
   */
  const onRefresh = useCallback((): void => {
    if (busy) return
    setBusy(true)
    setLoading(true)
    void (async () => {
      try {
        await reload()
        if (subjectName !== '') await loadDetail(subjectName)
      } finally {
        // reload 自己会把 loading 收掉；这里兜住 loadDetail 抛错/卸载的情况
        if (aliveRef.current) { setBusy(false); setLoading(false) }
      }
    })()
  }, [busy, reload, loadDetail, subjectName])

  /**
   * 静默刷新：只更新列表与总览，不动 loading / error / notice。
   *
   * 用途：蒸馏改成「AI 全程自己建卡并落盘」之后，新卡是在会话里产生的，
   * 面板不会自己知道。开着面板时轮询一次，用户就不用点刷新了。
   * 失败**不打扰用户**（下一轮再试），但要在 console 留痕，方便排查接口挂了。
   */
  const reloadQuietly = useCallback(async (): Promise<void> => {
    // 页面在后台（切走标签页 / 面板被遮住）：这一轮什么都不会被看到，直接不请求。
    // 回到前台时 panel 的 focus 监听会补一次刷新，不会漏数据。
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const [chars, ov] = await Promise.all([
        fetchCharacters(),
        // 同 reload：带上「面板所在会话」，5 秒轮询也要按会话视角刷新绑定 / 预设
        fetchOverview(sinkSessionId).catch(() => undefined),
      ])
      if (!aliveRef.current) return
      // 5 秒轮询：数据没变就别 setState（否则整棵树每 5 秒白重渲染一次）。
      // 签名必须覆盖**整份 overview 的会话相关部分**（active / bindings / stats / preset）：
      // 漏了的话 stats 页与绑定徽标在轮询路径上永远不更新（2026-11-01 审查低危项）。
      /*
        轻量签名（第 2 批性能项）：从前这里是 `JSON.stringify([chars, …])`，
        而每张 `chars[i]` 都带**整份 card**（世界书 / 长文本）—— 50 张卡就是每 5 秒
        序列化一次全量卡片，弱机上足够掉帧。现在只取「界面上会变的那几个标量」：
        名字 / 来源 / 最近活跃 / 记忆数，加上 overview 的会话相关部分。
        卡片正文被改动时 lastActive 会跟着变，所以不会漏刷。
      */
      const rosterSig = chars
        .map(item => `${item.name}|${item.source}|${item.lastActive}|${item.memoryCount}`)
        .join(',')
      const signature = [
        rosterSig,
        ov?.active?.character ?? '',
        ov?.active?.enabled === true ? '1' : '0',
        ov?.active?.mode ?? '',
        ov?.sessionId ?? '',
        ov?.bindings === undefined ? '' : JSON.stringify(ov.bindings),
        ov?.stats === undefined ? '' : `${ov.stats.characters}|${ov.stats.memoryEntries}|${ov.stats.turns}|${JSON.stringify(ov.stats.bySource)}`,
        ov?.preset === undefined ? '' : JSON.stringify(ov.preset),
        (ov?.recent ?? []).map(item => `${item.name}|${item.lastActive}|${item.memoryCount}`).join(','),
      ].join('#')
      if (signature === quietSig.current) return
      quietSig.current = signature
      setList(chars)
      if (ov !== undefined) {
        setOverview(ov)
        setActive(ov.active ?? { enabled: false })
        setSessionId(typeof ov.sessionId === 'string' ? ov.sessionId : '')
        setBindings(readBindings(ov.bindings))
      }
    } catch (error) {
      console.warn('[ai-with-u] 面板静默刷新失败（下轮重试）：', error)
    }
  }, [sinkSessionId])

  useEffect(() => {
    if (!open) return undefined
    const timer = window.setInterval(() => { void reloadQuietly() }, 5000)
    return () => window.clearInterval(timer)
  }, [open, reloadQuietly])

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    // 新动作开始时把上一条提示收掉，免得「上一个操作的结果」挂在新动作头上
    dismissNotice()
    try {
      await fn()
      await reload()
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      if (aliveRef.current) setBusy(false)
    }
  }, [reload, dismissNotice])

  // -------------------------------------------------------- 拖放兜底（宿主计数器）
  //
  // 宿主的「文件或图片拖动到此处即可添加」遮罩由 **document 级深度计数器** 驱动（app.asar 反查）：
  //   dragenter → depth++ / 亮遮罩    dragleave → depth-- / 归零才关
  //   drop      → reset()            window 的 dragend → reset()   ← 唯一的两个复位口
  //
  // 我们从系统拖进来的文件没有源元素，浏览器不会派发 dragend；而我们的各层又把 drop
  // stopPropagation 掉了（不拦的话卡会被当附件发进对话）→ 宿主的 `onDrop → reset()` 也不跑。
  // 两个复位口一起失效 = 聊天区遮罩永久卡死（真机 P0，2026-10-31）。
  //
  // 于是这里做两件事：
  //  1. **不在面板上方点亮遮罩**：`dragenter` 在捕获阶段就 stopPropagation（**不 preventDefault**，
  //     否则会废掉后续 dragover/drop 的默认行为），且只对「目标在我们容器里」的拖拽动手 →
  //     宿主的 depth++ 压根不执行；
  //  2. **吞掉的 drop 一律复位**：目标在我们容器里的交给各层自己的处理器（它们都走
  //     `swallowFileDrag` → 内部已 reset）；弹层打开时落在容器外的也由这里拦下并 reset。
  //
  // 只在面板打开期间挂、关面板立刻卸载并补一次 reset —— 这样「关掉面板后拖文件进对话框」
  // 完全回到宿主自己的逻辑（那正是 QA 要复验的行为）。
  // 挂载点是 `open`（不是 `dialog`）：遮罩不该在「面板开着但没弹层」时也被点亮。
  useEffect(() => {
    if (!open) return undefined
    const onDragEnter = (event: DragEvent): void => {
      if (!dragHasFiles(event)) return
      // 只掐掉冒泡，不碰默认行为：后面的 dragover/drop 还要正常到达我们的处理器
      if (isInsideOurLayers(event.target)) event.stopPropagation()
    }
    const swallowOutside = (event: DragEvent): void => {
      if (!dragHasFiles(event)) return
      if (isInsideOurLayers(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      // 被我们拦下的 drop 同样要让宿主计数器归零（否则遮罩照样卡住）
      if (event.type === 'drop') resetHostDropState()
    }
    document.addEventListener('dragenter', onDragEnter, true)
    // 弹层打开时遮罩铺满全屏，容器外的 drop 属于「漏网」：拦掉别让它进对话。
    // 面板开着但没弹层时**不拦容器外**——聊天区仍可正常接收拖入的文件。
    if (dialog !== '') {
      document.addEventListener('dragover', swallowOutside, true)
      document.addEventListener('drop', swallowOutside, true)
    }
    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', swallowOutside, true)
      document.removeEventListener('drop', swallowOutside, true)
      // 兜底：面板关闭（或卸载）时再复位一次，覆盖任何没走到 drop 的路径
      resetHostDropState()
    }
  }, [open, dialog])

  // -------------------------------------------------------- 定位
  // 面板已改成「居中大窗 + 遮罩」（对齐 dsh-context 的 .lc-modal-card 形态），
  // 不再贴着侧栏按钮弹出，因此不需要按锚点算位置，也不需要监听 resize/scroll 重排。

  // 点外部 / Esc 收起（面板与弹层都 portal 到 body，按 composedPath 判断归属）
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (dialog !== '' || dialogPresence.closing) return
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      const inside = path.includes(panelRef.current as EventTarget)
        || path.includes(layerRef.current as EventTarget)
        || (event.target instanceof Node
          && ((panelRef.current?.contains(event.target) ?? false) || (layerRef.current?.contains(event.target) ?? false)))
      // 蒸馏弹层也是 portal 到 body 的 `.awu-scrim`：点它不算「点外部」，
      // 否则点弹层里的任何按钮都会先把整个面板关掉（主 CTA 直接不可用）。
      const inNestedLayer = event.target instanceof Element && event.target.closest('.awu-scrim') !== null
      if (inside || inNestedLayer) return
      // 编辑器有未保存草稿：不能直接收起面板，转成「走编辑器确认」
      if (editing && editorDirty) { setEditorCloseSignal(n => n + 1); return }
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // 编辑器打开时 dialog 恰好是空串 —— 必须显式排除 editing，否则 Esc 会先关面板、
      // 编辑器随之卸载，用户未保存的改动一起没了。
      // 蒸馏弹层同理：它不在面板的 `dialog` 状态里（由 `DistillButton` 自己持有 open），
      // 不排除的话在蒸馏弹层里按 Esc 会把面板和弹层一起关掉（实测复现，2026-11-02 修）。
      /*
        口径统一（修 4）：弹层退场期（`dialogPresence.closing`）仍算「弹层开着」——
        与 Overlay 那边一致（它退场期同样吃掉 Esc）。否则内层正在淡出、外层顺手把整个面板关掉，
        两层对"这次 Esc 归谁"的理解不同，用户会看到"按一下关两层"。
      */
      if (event.key === 'Escape' && dialog === '' && !dialogPresence.closing && !editing && !distillOverlayOpen) {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, dialog, dialogPresence.closing, editing, editorDirty, distillOverlayOpen])

  // -------------------------------------------------------- 动作
  //
  // 启用有两条互不覆盖的通道：
  //  - **本会话绑定**（`/bind`）：只影响当前 sessionId 这个会话，其它会话照旧用全局；
  //  - **全局启用**（`/activate`）：所有**未绑定**会话都用它，已绑定的会话不受影响。
  // 两条都可以同时存在（同一张卡也可以同时是两者），所以界面上是两个独立入口。

  /** 绑定到当前会话。拿不到 sessionId 时只给一句提示，绝不编一个 id 写进去。 */
  const onBindSession = (name: string): void => {
    if (sessionId === '') { showNotice(t('bind.noSession'), 'warn'); return }
    void run(() => bindCharacter(name, sessionId))
      .then(ok => { if (ok) showNotice(t('bind.done.session', { name }), 'ok') })
  }
  /** 解除本会话绑定（这个会话回到全局角色）。 */
  const onUnbindSession = (): void => {
    if (sessionId === '') return
    void run(() => unbindCharacter(sessionId))
      .then(ok => { if (ok) showNotice(t('bind.done.unbind'), 'ok') })
  }
  /** 全局启用：所有未绑定会话都会切到它。 */
  const onActivate = (name: string): void => {
    // 没有启用角色时点过模式胶囊 → 这次启用后立刻把偏好补写到该角色的会话上
    const pref = modePref
    void run(async () => {
      await activateCharacter(name)
      if (pref !== undefined) await setInteractionMode(pref, name)
    }).then(ok => {
      if (!ok) return
      if (pref !== undefined) setModePref(undefined)
      showNotice(t('bind.done.global', { name }), 'ok')
    })
  }
  /** 退出全局（本会话若已绑定，仍继续用绑定的角色）。 */
  const onDeactivate = (): void => {
    void run(() => deactivateCharacter()).then(ok => { if (ok) showNotice(t('bind.done.exitGlobal'), 'ok') })
  }
  const onDeleteConfirmed = (withMemory: boolean): void => {
    const target = deleteTarget
    setDialog('')
    void run(async () => {
      /*
        删卡的两段动效（契约 §3「删卡」）：
          1. 先给这张卡 `data-state="closing"`（+ T_FAST=120ms 的淡出），让"它要没了"看得见；
          2. 请求回来后列表少一项，`useListFlip` 量到别人的位置变了，自动做 Y 轴塌陷。
        第 1 步必须**在请求之前**：请求一回来列表就重排，卡片直接消失，淡出没机会播。
        reduced-motion 下整段跳过（不让用户为 120ms 的淡出多等一次往返）。
      */
      const fade = prefersReducedMotion() ? 0 : T_FAST_LOCAL
      if (fade > 0) {
        setDeletingName(target)
        await new Promise<void>(resolve => { window.setTimeout(resolve, fade) })
      }
      try {
        await deleteCharacter(target, withMemory)
        // 删掉的正是当前详情：只清名字（触发退场），**不清 `detail`** ——
        // 清掉的话这 160ms 里视图会退回骨架屏，退场动画就没对象了（与 closeDetail 同一口径）。
        if (detailName === target) setDetailName('')
        showNotice(withMemory ? t('delete.doneWithMemory') : t('delete.done'), 'ok')
      } finally {
        setDeletingName('')
      }
    })
  }

  /**
   * 自创卡落档后的收尾（弹层自己负责保存/发送，这里只做面板动作）。
   *
   * 提示文案由弹层组织（它知道骨架卡存了没有、指令发出去没有、有没有软警告），
   * 面板只管关层、刷新、打开新卡、把提示显示出来。
   */
  const onCardCreated = (info: CreatedCardInfo): void => {
    setDialog('')
    setTab('roster')
    setDetailName(info.name)
    showNotice(info.notice, info.tone)
    void reload()
  }

  /**
   * 切交互模式。
   *
   * 不要求先启用角色：有选中卡片就把 `name` 一起发（写进那张卡的会话），
   * 都没有时宿主只写全局兜底并回 `scope: 'global'`，面板据此换提示语气。
   * 成功后在本地记一份 `modePref`，等启用角色时立刻补发一次 `/mode`。
   */
  const applyMode = (next: InteractionMode, after?: () => void): void => {
    if (busy) return
    const targetName = detailName !== '' ? detailName : undefined
    const liveTarget = live && (targetName === undefined || targetName === liveName)
    setBusy(true)
    dismissNotice()
    void setInteractionMode(next, targetName)
      .then(result => {
        const scope = result.scope ?? 'session'
        if (scope === 'global') {
          setModePref(next)
          showNotice(t('mode.pending'), 'ok')
        } else {
          // 写的是「当前启用角色」时以后端为准；写的是选中的非启用卡时保留本地回显
          setModePref(liveTarget ? undefined : next)
          showNotice(t('mode.picked', { mode: next === 'text' ? t('mode.text') : t('mode.action') }), 'ok')
        }
        after?.()
        return reload()
      })
      .catch((e: unknown) => { setError(errorText(e)) })
      .finally(() => { if (aliveRef.current) setBusy(false) })
  }

  const onModePick = (next: InteractionMode): void => { applyMode(next, () => setDialog('')) }
  const openDelete = (name: string): void => { setDeleteTarget(name); setDialogError(''); setDialog('delete') }
  const openDialog = (which: 'new' | 'import' | 'preview' | 'preset' | 'mode' | 'forget' | 'resetAll' | 'resetSession' | ''): void => { setDialogError(''); setDialog(which) }

  // -------------------------------------------------------- 维护动作（新接口）
  const onEditDiary = (text: string): void => {
    if (editTarget === undefined) return
    setBusy(true)
    setDialogError('')
    // 改的是「正在看的那位」的日记，不是启用角色的（看别人的日记时别改错人）
    void editDiary(detailName, {
      text,
      date: editTarget.date,
      section: editTarget.section,
      index: editTarget.index,
    }).then(() => {
      setDialog('')
      // 改写成功要给一句反馈：原来只 `dismissNotice()` 就静默关层，用户看不出来存没存住。
      // `diary.editDone` 这个 key 字典里早就有（zh/en 各一条）但一直是零引用，正好用上。
      showNotice(t('diary.editDone'), 'ok')
      return reload()
    }).catch((error: unknown) => {
      setDialogError(errorText(error))
    }).finally(() => { if (aliveRef.current) setBusy(false) })
  }

  const onForget = (keyword: string): void => {
    setBusy(true)
    setDialogError('')
    // 同理：显式带上正在看的那位，否则「忘记」会落到启用角色身上（改错人）
    void forgetKeyword(keyword, detailName === '' ? undefined : detailName).then(result => {
      setDialog('')
      showNotice(
        result.changed
          ? t('forget.done', {
            diary: result.diary.removedTimeline.length + result.diary.removedNotes.length,
            session: result.session.removedRecent.length,
            card: result.card.removed.length,
          })
          : t('forget.none'),
        'ok',
      )
      return reload()
    }).catch((error: unknown) => {
      setDialogError(errorText(error))
    }).finally(() => { if (aliveRef.current) setBusy(false) })
  }

  const onReset = (scope: 'session' | 'all'): void => {
    setBusy(true)
    setDialogError('')
    // 重置的是「正在看的那位」（日记页里展示的角色），不是启用角色 ——
    // 开着角色 A、翻角色 B 的日记点「彻底重置」，被清的必须是 B。
    // 与同页 forgetKeyword / editDiary 同一口径：看不了谁就不带 name，宿主回落当前启用角色。
    void resetSession(scope, detailName === '' ? undefined : detailName).then(result => {
      setDialog('')
      if (scope === 'session') showNotice(t('reset.sessionDone', { n: result.diaryKept ?? 0 }), 'ok')
      else showNotice(t('reset.allDone', { n: result.diaryRemoved ?? 0 }), 'ok')
      return reload()
    }).catch((error: unknown) => {
      setDialogError(errorText(error))
    }).finally(() => { if (aliveRef.current) setBusy(false) })
  }

  /**
   * 保存角色卡。
   *
   * **两条链路分开走**（C7 语义，见 `api.ts` 的 `saveCharacterCcv3`）：
   *  - 结构改动 → `saveCharacter(name, card)`：后端以磁盘上的 CCv3 为底重投影，
   *    既有 `data.character_book` / `extensions` 原样保留；
   *  - 世界书改动 → `saveCharacterCcv3(name, ccv3)`：**只发 ccv3**，整卡回传、只改
   *    `data.character_book`。不把 `card` 一起发，世界的权威就只有一份，不用猜 store
   *    在「结构重投影」与「原生整卡」之间取了哪份底稿。
   * 两者都变了就分两步：先世界书（ccv3），再结构（card，此时磁盘上的 book 已是新的）。
   *
   * 保存成功后**重新 GET 一次**再关闭编辑器，并逐项校验：
   * 世界书条目数对不上 = 假成功，直接把错误抛回编辑器顶栏，不关层。
   */
  const onSaveCard = (next: Card | CardSavePayload): void => {
    const targetName = detailName
    if (targetName === '') return
    // 旧调用方（如果还有）只给裸结构卡：按「结构有改动、没碰世界书」处理
    const payload: CardSavePayload = isSavePayload(next)
      ? next
      : { view: next as Card, structureChanged: true, loreChanged: false, loreEntries: 0 }
    setBusy(true)
    setEditError('')
    void (async () => {
      // 两条链路都会回 warnings（世界书超限等）：收集起来一并展示，不拦保存
      const warnings: string[] = []
      try {
        // 世界书改了却没带上整卡：宁可不存也不造出「假成功」
        if (payload.loreChanged && payload.ccv3 === undefined) {
          throw new Error(t('lore.unsupported'))
        }
        if (payload.loreChanged && payload.ccv3 !== undefined) {
          const saved = await saveCharacterCcv3(targetName, payload.ccv3)
          warnings.push(...(saved.warnings ?? []))
        }
        if (payload.structureChanged || !payload.loreChanged) {
          const saved = await saveCharacter(targetName, payload.view)
          warnings.push(...(saved.warnings ?? []))
        }
        // 回读校验：以后端实际落盘的内容为准
        const fresh = await fetchCharacter(targetName)
        if (!aliveRef.current) return
        if (payload.loreChanged) {
          const actual = toLoreDraftFromCard(fresh.ccv3).entries.length
          if (actual !== payload.loreEntries) {
            throw new Error(t('lore.saveMismatch', { expect: payload.loreEntries, actual }))
          }
        }
        setDetail(fresh)
        /*
          保存成功不再直接 `setEditing(false)`（那会当场卸载、`.awu-editor` 的退场动画没对象可动）。
          改成：先置 `editorClosing` 让根节点挂上 `data-state="closing"`，T_EXIT 之后再真正卸载。
          计时器只用一个（重复保存不会叠加），并在 `editing` 变 false 时统一清掉。
        */
        setEditorClosing(true)
        if (editorExitTimer.current !== undefined) window.clearTimeout(editorExitTimer.current)
        editorExitTimer.current = window.setTimeout(() => {
          editorExitTimer.current = undefined
          if (aliveRef.current) setEditing(false)
        }, T_EXIT)
        notifySaved(payload.loreChanged && !payload.structureChanged ? t('lore.saved') : t('edit.saved'), warnings)
        await reload()
      } catch (error) {
        if (!aliveRef.current) return
        setEditError(errorText(error))
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }

  /** 导入完成：关层 → 刷新列表 → 直接打开这张新卡 → 提示（软警告用警示色，不红条）。 */
  const onImported = (name: string, warnings: string[]): void => {
    setDialog('')
    setTab('roster')
    setDetailName(name)
    notifySaved(t('import.done', { name }), warnings)
    void reload()
  }

  const onNextOpening = (): void => {
    // 换的是「本会话实际生效的角色」：绑定优先，其次全局。
    // 按钮只长在状态带（sessionName 非空才渲染）里，以前判 liveName 导致
    // 「绑定了但没全局启用」时点了没反应（宿主 /opening/next 支持显式 name，web.ts:812-824）。
    if (sessionName === '') return
    setBusy(true)
    setOpeningNote('')
    void nextOpening(sessionName).then(result => {
      if (result.needGenerate === true) setOpeningNote(t('opening.needGenerate'))
      else if (result.history) setOpeningNote(t('opening.history'))
      else setOpeningNote(t('opening.rotated'))
      return reload()
    }).catch((error: unknown) => {
      setOpeningNote(errorText(error))
    }).finally(() => { if (aliveRef.current) setBusy(false) })
  }


  // -------------------------------------------------------- 派生
  const roster = useMemo(
    () => sortRoster(list, active.enabled ? active.character : undefined),
    [list, active],
  )
  const stats = useMemo(() => statTriple(overview, list), [overview, list])
  /** 全局启用（`_active`）的角色：所有**未绑定**会话都用它 */
  const live = active.enabled && active.character !== undefined
  const liveName = active.character ?? ''
  const globalName = live ? liveName : ''


  // 启用中的角色变了就重拉一次关系档案（放在 liveName 之后，避免 TDZ）
  useEffect(() => {
    if (liveName === '') { setRelation(undefined); setOpeningNote(''); return undefined }
    setOpeningNote('')
    let cancelled = false
    void fetchRelation(liveName)
      .then(state => { if (!cancelled && aliveRef.current) setRelation(state) })
      .catch(() => { if (!cancelled) setRelation(undefined) })
    return () => { cancelled = true }
  }, [liveName])

  /**
   * 详情视图的退场（契约 §2.2 / 遗留 1）：返回列表时先跑 160ms 再卸载，方向恒为「向左」。
   *
   * 为什么方向只有一种：`data-exit="left"` 对应「回到左栏列表」。窄屏 push 返回走的是
   * 同一条路径（`closeDetail`），所以不另做一套右退。
   *
   * 退场期间要继续渲染**上一次那张详情**，否则 `detailName` 一清空、分支就没了，
   * 动画对象也随之消失（和弹层宿主 `lastDialogRef` 是同一个问题）。
   *
   * 判据必须是 **`mounted` 而不是 `closing`**：`closing` 是在「open 变 false」之后的一个
   * effect 里才置 true 的，中间那次 commit 里它仍是 false —— 用 closing 判断的话，
   * 点返回的瞬间（t≈6ms）详情会被摘掉、骨架屏出现，下一帧（t≈11ms）再挂回来，
   * 退场动画实际跑在**新节点**上（离散事件碰巧在 paint 前 flush 才没被看见，非离散触发就闪骨架）。
   * `mounted` 从 open 变 false 起就一直为 true（直到 160ms 后才翻），中间不会掉。
   */
  const detailOpen = tab === 'roster' && detailName !== ''
  const detailRootRef = useRef<HTMLDivElement | null>(null)
  const detailPresence = usePresence(detailOpen, T_EXIT, detailRootRef)
  const lastDetailNameRef = useRef('')
  useEffect(() => {
    if (detailName !== '') lastDetailNameRef.current = detailName
  }, [detailName])
  /** 退场期沿用上一次的名字；为空串 = 真的没有详情可渲染。 */
  const detailSubject = detailName !== '' ? detailName : (detailPresence.mounted ? lastDetailNameRef.current : '')

  /**
   * 详情卸载后还焦（修 2）。
   *
   * `usePresence` 传了 root，会在**退场第一帧**把焦点请出详情（不能停在正在淡出、
   * 且 pointer-events:none 的节点上）；卸载完成后由这里把焦点还给「进来之前的那张卡」——
   * 用 `data-card-id` 反查（卡片是 <button>，天然可聚焦），取不到就退到左栏列表容器
   * （`.awu-rail .awu-pane`，`tabIndex={-1}` 只可编程聚焦，不进 Tab 序列）。
   */
  const prevDetailMountedRef = useRef(false)
  useEffect(() => {
    const wasMounted = prevDetailMountedRef.current
    prevDetailMountedRef.current = detailPresence.mounted
    if (!wasMounted || detailPresence.mounted) return
    if (typeof document === 'undefined') return
    const name = lastDetailNameRef.current
    const card = Array.from(document.querySelectorAll<HTMLElement>('.awu-card[data-card-id]'))
      .find(el => el.getAttribute('data-card-id') === name) ?? null
    const target = card ?? document.querySelector<HTMLElement>('.awu-rail .awu-pane')
    if (target === null) return
    try {
      target.focus({ preventScroll: true })
    } catch {
      target.focus()
    }
  }, [detailPresence.mounted])

  const currentDetail = detailSubject !== '' && detailSubject === detail?.name ? detail : undefined
  // 日记页用的是 detailName 加载来的那一份，只要名字对得上就认（可能不是启用角色）
  const diaryDetail = diaryTarget !== '' && detail !== undefined && detail.name === diaryTarget ? detail : undefined

  /**
   * 详情数据自带的「这张卡绑在本会话」信号。
   *
   * 优先读宿主本体的嵌套形状 `binding:{boundHere, sessions, global}`（`src/web.ts:524-533`）；
   * 自定义宿主 / 断更版本没有嵌套对象时，退回旧扁平字段（boundHere / boundSessionId，向后兼容别删）。
   * 请求侧已把面板所在会话随 `?sessionId=` 送去（见 `fetchCharacter`），宿主才算得出这格。
   */
  const detailSaysBoundHere = (name: string): boolean => {
    if (sessionId === '' || name === '' || currentDetail === undefined || currentDetail.name !== name) return false
    const binding = currentDetail.binding
    if (typeof binding === 'object' && binding !== null) {
      if (binding.boundHere === true) return true
      if (Array.isArray(binding.sessions) && binding.sessions.includes(sessionId)) return true
    }
    // 旧扁平容错字段（向后兼容自定义宿主，别删）
    return currentDetail.boundHere === true || currentDetail.boundSessionId === sessionId
  }

  /**
   * 本会话绑定的角色（`bindings[sessionId]`）。
   *
   * 绑定表认不出时，退一步信当前打开的那张卡自带的绑定信号（见上）：
   * 这样做的好处是「绑定刚被别处改过、overview 还没刷新」时详情页也不会闪成未绑定。
   */
  const boundName = sessionId !== ''
    ? (bindings[sessionId] ?? (currentDetail !== undefined && detailSaysBoundHere(currentDetail.name) ? currentDetail.name : ''))
    : ''
  /** 本会话实际生效的角色：绑定优先，其次全局 */
  const sessionName = boundName !== '' ? boundName : globalName
  const sessionBound = boundName !== ''
  /** 同一张卡既绑了本会话又是全局角色：只显示一次，标「本会话 / 全局」 */
  const bothSame = boundName !== '' && boundName === globalName

  /**
   * 切到日记 tab 且还没指定对象 → **显式**落到「本会话实际生效的角色」。
   *
   * 必须写 state，而不是在渲染期用 `tab==='diary' ? … : …` 推断：推断式写法会让
   * 「对象是谁」随 tab 漂移，而三个写盘动作读的正是它 —— 这就是 P0-1 的根因。
   * 只在 `detailName === ''` 时写一次，用户之后点左栏换人不会被覆盖回去。
   */
  useEffect(() => {
    if (tab !== 'diary' || detailName !== '' || sessionName === '') return
    setDetailName(sessionName)
  }, [tab, detailName, sessionName])

  /** 窄屏 → 宽屏：两栏同时可见，栈清空。 */
  useEffect(() => {
    if (narrow) return
    clearPopTimer()
    setNavState('split')
  }, [narrow, clearPopTimer])

  /** 窄屏下「选中了某张卡」= 详情在栈顶（返回时先清 detailName，所以两条不会打架）。 */
  useEffect(() => {
    if (narrow && tab === 'roster' && detailName !== '') setNavState('push')
  }, [narrow, tab, detailName])

  /**
   * 左栏点卡 = 「选谁」。
   *
   * 三个 tab 三种含义，必须一次说清（否则就是审查里那条「死点击 / 静默换人」）：
   *  - 角色簿：打开详情（窄屏 push）；
   *  - 日记：只换选中对象，留在日记页（页内会显示「正在看：X」）；
   *  - 统计 / 指南：这两个页面跟「谁」无关，点卡必须**跳到角色簿**再打开详情 ——
   *    以前这里什么都不发生，用户会以为面板卡死了。
   */
  const openCharacter = useCallback((name: string): void => {
    clearPopTimer()
    // 共享元素的起点：必须在 setDetailName 之前量（那一刻卡片还在布局里）
    const avatar = findCardAvatar(name)
    setMorphFrom(avatar === null ? undefined : { name, rect: rectOf(avatar) })
    setDetailName(name)
    if (tab === 'stats' || tab === 'guide') setTab('roster')
    if (narrow) setNavState('push')
  }, [clearPopTimer, narrow, tab])

  /** 退回列表（窄屏 pop 一帧再落 split）；**不清**选中对象。 */
  const returnToList = useCallback((): void => {
    if (!narrow) return
    clearPopTimer()
    setNavState('pop')
    popTimer.current = window.setTimeout(() => {
      popTimer.current = undefined
      setNavState('split')
    }, T_MID)
  }, [clearPopTimer, narrow])

  /** 详情页「返回」：清掉选中对象再退回列表。 */
  const closeDetail = useCallback((): void => {
    // 回程起点：返回那一刻 hero 还在，先量下来；真正播放要等详情卸载之后（见下面的 effect）
    const hero = typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>('.awu-detailHero [data-morph="avatar"]')
    returnMorphRef.current = hero === null || detailName === '' ? null : { name: detailName, rect: rectOf(hero) }
    setDetailName('')
    // 注意：**不清 `detail`** —— 退场 160ms 里还要拿它渲染上一次那张详情。
    // 下一次打开会由 `loadDetail` 覆盖（`currentDetail` 有名字守卫，不会串卡）。
    setDetailError('')
    returnToList()
  }, [returnToList, detailName])

  /**
   * 切 tab。
   *
   * 窄屏上 tab 切的是「内容列」，所以 push；唯独「角色簿 + 还没选卡」留在列表
   * （这时内容列只有一句「从左栏选一张卡」，把用户推过去没有意义）。
   */
  const onTabPick = useCallback((next: Tab): void => {
    clearPopTimer()
    setTab(next)
    if (!narrow) return
    setNavState(next === 'roster' && detailName === '' ? 'split' : 'push')
  }, [clearPopTimer, narrow, detailName])

  /** 左栏过滤：名字 / 身份 / 一句话背景 / 来源，小写包含匹配。 */
  const visibleRoster = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (keyword === '') return roster
    return roster.filter(item => {
      const role = roleOf(item.card)
      const blurb = blurbOf(item.card)
      const source = typeof item.source === 'string' ? item.source : ''
      return `${item.name} ${role} ${blurb} ${source}`.toLowerCase().includes(keyword)
    })
  }, [roster, query])

  // 列表 FLIP：筛选/搜索/删卡导致的顺序或数量变化，用 Y 轴位移画出来（reduced-motion 跳过）
  useListFlip(gridRef, [visibleRoster], !reducedMotion)

  /**
   * 导出这张卡：纯前端 Blob，不碰任何接口（因此也不改数据流）。
   *
   * 优先导 `ccv3`（完整规范对象，含世界书 / extensions），宿主没给才退 `card`。
   * 文件名滤掉 Windows 非法字符，否则会静默失败。
   */
  const onExportDetail = useCallback((): void => {
    if (detail === undefined) return
    const safeName = detail.name.replace(/[\\/:*?"<>|]/g, '_')
    try {
      const payload = detail.ccv3 ?? detail.card
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}.ccv3.json`
      anchor.click()
      window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
      showNotice(t('detail.exportDone'), 'ok')
    } catch (e) {
      showNotice(t('detail.exportFailed', { reason: errorText(e) }), 'warn')
    }
  }, [detail, showNotice, t])

  /**
   * 出向共享元素：详情卸载后，让左栏那张卡的头像从 hero 的位置「缩回去」。
   *
   * 为什么放在 `detailName === ''` 之后：hero 节点已随详情卸载，量不到了；
   * 起点在 `closeDetail` 里就存好了。窄屏下左栏是 visibility:hidden，播放看不见但也无害。
   */
  useEffect(() => {
    if (detailName !== '') return undefined
    const pending = returnMorphRef.current
    if (pending === null) return undefined
    returnMorphRef.current = null
    if (prefersReducedMotion()) return undefined
    const card = findCardAvatar(pending.name)
    if (card === null) return undefined
    const animation = morphAvatar(pending.rect, card)
    return () => { try { animation?.cancel() } catch { /* 已结束 */ } }
  }, [detailName])

  /** 详情页「最近日记」的出口：带着这位进日记 tab。 */
  const onOpenDiaryOf = useCallback((name: string): void => {
    clearPopTimer()
    setDetailName(name)
    setTab('diary')
    if (narrow) setNavState('push')
  }, [clearPopTimer, narrow])

  /** 详情页这张卡是否已绑定在本会话（优先 bindings 表，其次详情数据自带的绑定信号） */
  const isBoundHere = (name: string): boolean => {
    if (name === '' || sessionId === '') return false
    if (bindings[sessionId] !== undefined) return bindings[sessionId] === name
    return detailSaysBoundHere(name)
  }

  /**
   * 日记页的关系条：**看谁的日记就显示谁的关系**。
   *
   * 优先级：`GET /character` 带回来的该卡快照（`current` = 当前档，`baseline` = 起点）→
   * 快照里的 `tag` → 该卡 `baseline` → （仅当它就是启用角色时）面板那份 `/relation` 实时状态。
   * 轮数 / 最近互动统一取这张卡的 session，绝不把启用角色的数字贴上去。
   */
  const diaryRelation = useMemo(() => {
    const entry = diaryDetail
    if (entry === undefined) return undefined
    const snapshot = entry.relation
    const current = typeof snapshot?.current === 'string' ? snapshot.current.trim() : ''
    const baseline = typeof snapshot?.baseline === 'string' ? snapshot.baseline.trim() : ''
    const snapshotTag = typeof snapshot?.tag === 'string' ? snapshot.tag.trim() : ''

    let tag = ''
    if (current !== '') tag = `${entry.name}（${current}）`
    else if (snapshotTag !== '') tag = snapshotTag
    else if (baseline !== '') tag = `${entry.name}（${baseline}）`
    else if (entry.name === liveName && relation !== undefined) tag = relation.tag ?? relation.baseline

    // 快照与实时状态都没有：宁可不显示这条，也不编一个档位出来
    if (tag === '') return undefined

    const turns = Number(entry.session?.turn_count ?? 0) || 0
    const when = relativeDay(String(entry.session?.last_ts ?? ''), t)
    const meta = [t('relation.turns', { n: turns }), when].filter(part => part !== '').join(' · ')
    return { tag, meta }
  }, [diaryDetail, liveName, relation, t])

  /**
   * 打开卡片编辑器时解析「本轮被裁掉」的世界书条目。
   *
   * 两路数据都容错：`GET /character` 的 diag 优先；没有就退 `GET /preview` 的 `lore`；
   * 两路都拿不到（老宿主 / 接口未就绪 / 只读失败）就保持 undefined，世界书里那块警示不渲染。
   * 失败**不打扰用户**（console 留痕即可）——这只是锦上添花的诊断。
   */
  useEffect(() => {
    if (!editing || currentDetail === undefined) { setDroppedLore(undefined); return undefined }
    const fromDetail = readLoreDroppedFromDetail(currentDetail)
    if (hasDroppedLore(fromDetail)) {
      setDroppedLore(fromDetail)
      return undefined
    }
    let cancelled = false
    setDroppedLore(undefined)
    void fetchPreview()
      .then(preview => {
        if (cancelled || !aliveRef.current) return
        const fromPreview = readLoreDroppedFromPreview(preview)
        setDroppedLore(hasDroppedLore(fromPreview) ? fromPreview : undefined)
      })
      .catch((error: unknown) => {
        console.warn('[ai-with-u] 读 /preview 的世界书预算明细失败（不显示被裁条目）', error)
      })
    return () => { cancelled = true }
  }, [editing, currentDetail])

  /** 胶囊当前高亮哪个：启用角色以后端为准，否则用本地偏好（默认「文本+动作」）。 */
  const mode: InteractionMode = live
    ? (active.mode ?? 'text+action')
    : (modePref ?? 'text+action')

  // 侧栏徽记显示**本会话**实际生效的角色（绑定优先，其次全局）
  const badgeName = (() => {
    if (busy) return t('badge.busy')
    if (sessionName !== '') return sessionName
    return t('badge.none')
  })()

  // 居中大窗，尺寸对齐 dsh-context 的**主面板**（.lc-ov-card）：
  //   width: min(1120px, 100vw - 32px)  height: calc(100vh - 80px)
  // 数值仍由 styles.ts 的 PANEL_WIDTH / PANEL_MAX_H（这里当上下留白用）统一给出。
  //
  // ⚠️ 居中**不能用 transform**：面板外面有 .awu-panelFade 外壳（进场淡入），面板自己也在动画体系里
  // （退场时 data-state="closing" 会跑 awu-exit 的 translateY）；任何 keyframes 里的 transform
  // 都会覆盖内联 transform —— 窗口会先出现在右半边，动画结束才「跳」回正中（主人实测到过）。
  // 改用 left/right:0 + margin:0 auto + 固定宽度居中，transform 就完整留给动画用。
  // `bottom: auto` 必须写：旧样式里 .awu-panel 是贴底定位的，不覆盖会和 top 同时生效把窗口拉长。
  const panelStyle: CSSProperties = {
    left: 0,
    right: 0,
    marginLeft: 'auto',
    marginRight: 'auto',
    top: `${PANEL_MAX_H / 2}px`,
    bottom: 'auto',
    width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
    height: `calc(100vh - ${PANEL_MAX_H}px)`,
    maxHeight: 'none',
  }

  // 分段器：roving tabindex + 方向键 / Home / End。
  // 面板里只有一个 tabpanel（.awu-body），所以 aria-controls 永远指向存在的元素。
  const TAB_IDS: Array<{ id: Tab; node: string }> = [
    { id: 'roster', node: 'awu-tab-roster' },
    { id: 'diary', node: 'awu-tab-diary' },
    { id: 'stats', node: 'awu-tab-stats' },
    { id: 'guide', node: 'awu-tab-guide' },
  ]
  const tabIndex = Math.max(0, TAB_IDS.findIndex(item => item.id === tab))
  const tabNode = TAB_IDS[tabIndex].node

  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // 带修饰键的组合（⌘/Ctrl + ←）留给宿主或输入法，不抢
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? TAB_IDS.length - 1 : -1
    if (delta === 0 && jump < 0) return
    event.preventDefault()
    const next = jump >= 0 ? jump : (tabIndex + delta + TAB_IDS.length) % TAB_IDS.length
    onTabPick(TAB_IDS[next].id)
    document.getElementById(TAB_IDS[next].node)?.focus()
  }

  // -------------------------------------------------------- 渲染

  /**
   * 窄屏「单栏导航栈」的对外取值（契约 §2.1 `.awu-workspace[data-nav]`）。
   * 宽屏恒为 `split`：两栏同时可见，栈没有意义。
   */
  const navAttr: 'split' | 'push' | 'pop' = narrow ? navState : 'split'
  /**
   * 窄屏列表态：tablist 必须跟到左栏。
   *
   * 这不是「把 tab 藏起来」——恰恰相反：窄屏 `split` 时内容列整体不在视口里，
   * tablist 若留在 `mainHead` 里就跟着一起不可达，用户永远切不了 tab。
   * 所以 tablist 同一时刻只存在于**可见的那一列**（宽屏恒在 mainHead）。
   */
  const showTabsInRail = narrow && navState === 'split'
  /** 内容列是否覆盖在列表上（决定 mainHead 出不出「返回列表」）。 */
  const contentOnTop = narrow && navState !== 'split'
  /** 退场期继续渲染「刚关掉的那一层」（见 dialogPresence 的说明）。 */
  const shownDialog: '' | PanelDialog = dialog !== '' ? dialog : (dialogPresence.closing ? lastDialogRef.current : '')
  /** 契约 §2.3：滑块位置由 JSX 写这两个内联变量，CSS 只读。 */
  const tabsStyle = { '--awu-tab-i': tabIndex, '--awu-tab-n': TAB_IDS.length } as CSSProperties
  const tabsNode = (
    <div className="awu-tabs" role="tablist" aria-label={t('panel.title')} onKeyDown={onTabKey} style={tabsStyle}>
      {TAB_IDS.map(item => (
        <button
          key={item.id}
          id={item.node}
          type="button"
          role="tab"
          className="awu-tab"
          data-on={tab === item.id ? 'true' : 'false'}
          aria-selected={tab === item.id}
          aria-controls="awu-tabpanel"
          tabIndex={tab === item.id ? 0 : -1}
          onClick={() => onTabPick(item.id)}
        >
          {t(`panel.tab.${item.id}`)}
        </button>
      ))}
    </div>
  )
  /*
    视图进入动画**不在这里挂**（2026-11-02 与 CSS 侧对齐）：CSS 把 `awu-view-in`（120ms，只 opacity，
    fill-mode:both）写在 `.awu-mainBody > *` 上 —— 视图根节点换人时自然播一次，零 JSX 依赖。
    原先我打算打一帧 `data-view-state="enter"` 再下一帧摘，但那是 transition 路线；
    animation 路线上「下一帧摘属性」会把动画一起摘掉，淡入被截断 = 等于没做。所以这里删干净。
    代价：同一个视图根节点内的内容变化（例如详情页换了张卡）不会重播 —— 这条由
    `<CharacterDetailView key={detailName}>` 的重挂载补上（见下面 tab === 'roster' 那段）。
  */

  /** 右栏头部右侧的全局动作：窄屏「返回列表」+ 刷新 + 关闭。 */
  const mainHeadActions = (
    <div className="awu-headActions">
      {contentOnTop && !(tab === 'roster' && detailName !== '') && (
        <button
          type="button"
          className="awu-btn"
          data-size="sm"
          data-kind="ghost"
          onClick={returnToList}
        >
          <IconBack size={12} />
          {t('panel.backToList')}
        </button>
      )}
      <button
        type="button"
        className="awu-iconBtn"
        title={t('panel.refresh')}
        aria-label={t('panel.refresh')}
        data-spin={busy ? 'true' : 'false'}
        aria-busy={busy}
        onClick={onRefresh}
        disabled={busy}
      >
        {busy ? <IconSpinner size={15} /> : <IconRefresh size={15} />}
      </button>
      <button
        type="button"
        className="awu-iconBtn"
        title={t('panel.close')}
        aria-label={t('panel.close')}
        onClick={() => setOpen(false)}
      >
        <IconClose size={15} />
      </button>
    </div>
  )

  return (
    <div
      ref={layerRef}
      className="awu-layer"
      data-rail={wide ? 'false' : 'true'}
    >
      <button
        ref={buttonRef}
        type="button"
        className="awu-trigger"
        data-live={sessionName !== '' ? 'true' : 'false'}
        data-open={open ? 'true' : 'false'}
        title={wide ? t('badge.title') : `${t('badge.title')} · ${badgeName}`}
        aria-label={wide ? t('badge.open') : `${t('badge.open')} · ${badgeName}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // 已打开时再点入口 = 收起；但编辑器有未保存草稿就先问一句
          if (open && editing && editorDirty) { setEditorCloseSignal(n => n + 1); return }
          setOpen(!open)
        }}
      >
        <span className="awu-mark" aria-hidden="true">
          {sessionName !== '' ? initialOf(sessionName) : <IconMask size={14} />}
        </span>
        {/*
          窄轨态只渲染圆徽：文字节点**根本不进 DOM**。
          靠 CSS `display:none` 藏是不够的——容器被压到 36px 时，只要文字节点
          还在参与布局，就会出现逐字换行、按钮被撑出轨道。
        */}
        {wide && (
          <span className="awu-triggerText">
            <span className="awu-triggerLabel">{t('badge.label')}</span>
            <span className="awu-triggerName" title={badgeName}>{badgeName}</span>
          </span>
        )}
        {wide && <Dot on={sessionName !== ''} />}
      </button>

      {/* 退场期仍 mounted（160ms）：`open` 一翻转就摘 DOM 的话，CSS 退场根本没有机会播 */}
      {panelPresence.mounted && typeof document !== 'undefined' && createPortal(
        /*
          进场外壳（2026-11-02，主人报「二段式」后加的）：
          面板玻璃自己**不播任何动画** —— 它带 backdrop-filter: blur(18px)，动它就要逐帧
          重算 1.1M px；而为了省这个把模糊摘掉、animationend 再装回去就是一次硬切
          （实测 t≈401ms 从 none 跳到 blur(18px)，观感「先发白、顿一下」）。
          所以玻璃挂载即完整就位，由这层外壳做一次纯 opacity 淡入：模糊只算一次，
          100vmax 压暗跟着整层一起淡，不存在换档。
          外壳 pointer-events: none（面板自己 auto），点面板外仍然落到宿主。
        */
        <div className="awu-panelFade">
        <div
          ref={attachPanelRef}
          className="awu-panel awu-scope"
          style={panelStyle}
          data-busy={busy ? 'true' : 'false'}
          /* 契约 §2.2：退场由 data-state="closing" 驱动（CSS 侧已有 awu-exit / awu-exit-down） */
          {...presenceAttrs(panelPresence.closing)}
          aria-hidden={panelPresence.closing ? true : undefined}
          /* 契约 §2.1：托盘级开关。现在恒开（GLASS_FX_ENABLED），关掉时挂 "off" 让 CSS 退回静态高光 */
          data-fx={glassFxOn ? undefined : 'off'}
          role="dialog"
          /*
            这里是 `aria-modal="true"`：面板**行为上已经是模态**（Tab 被 `useFocusTrap`
            关在里面、Esc 收起、点外面收起、`box-shadow: 0 0 0 100vmax` 铺一层压暗），
            从前的 `"false"` 会让读屏以为「背景还能操作」，与键盘行为自相矛盾。
            （2026-11-02 无障碍检查 D 报告 §1.3 第一条；a11y-merge.md §5 当时的设计是
            「面板不加陷阱、Tab 放出去」，实际实现走了模态，所以语义跟着行为走。）
          */
          aria-modal="true"
          aria-label={t('panel.title')}
          /*
            面板自己也吞掉文件拖放：不吞的话，卡文件会冒到宿主 composer 被当附件发出去。
            `swallowFileDrag` 在 drop 时还会复位宿主的拖放计数器 —— 否则聊天区的
            「文件或图片拖动到此处即可添加」遮罩会永久卡死（真机 P0，见 dragdrop.ts）。
          */
          onDragOver={swallowFileDrag}
          onDrop={event => {
            swallowFileDrag(event)
            // 吞掉之后必须给一句反馈：不然用户拖了半天，界面一点动静都没有（qa 复核提的口子）
            if (dragHasFiles(event)) showNotice(t('panel.dropCard'), 'ok')
          }}
        >
          {/*
            编辑态：编辑器整块接管面板内容区（头部牌子保留）。
            面板宽度只有 452px，把十个分组 + 世界书塞进小弹窗会非常难用，所以做成「面板内全屏」。
          */}
          {editing && currentDetail !== undefined ? (
            <CardEditor
              card={currentDetail.card}
              ccv3={currentDetail.ccv3}
              droppedLore={droppedLore}
              name={currentDetail.name}
              source={sourceOf(currentDetail.card)}
              busy={busy}
              error={editError}
              closeSignal={editorCloseSignal}
              onDirtyChange={setEditorDirty}
              closing={editorClosing}
              onCancel={() => setEditing(false)}
              onSave={onSaveCard}
              t={t}
            />
          ) : (
          <>
          {/*
            头部只留「这是什么 + 一行总量」。刷新/关闭这类全局动作归右栏 `awu-mainHead`
            （契约 §2.4）—— 1120px 宽的头部原来只放两枚图标、而主 CTA 挤在 340px 左栏，
            空间分配是反的（C 报告 P1-1）。
            标题改走字典：`panel.title` 早就存在，但这里以前是硬编码「角色管理器」，
            英文界面下最显眼的 H1 一直是中文（C 报告 P1-8）。
          */}
          <div className="awu-head">
            <div className="awu-headMain">
              <div className="awu-kicker">{t('panel.kicker')}</div>
              <div className="awu-title">{t('panel.title')}</div>
              {/*
                三个总量指标：原来占右栏顶部一整条，视觉重量和正文打架（主人反馈「太大了」）。
                收成标题下方一行紧凑元信息；「统计」tab 里不再重复这三个数字（C 报告 P2-1）。
              */}
              <div className="awu-counts" role="group" aria-label={t('stats.title')}>
                <span className="awu-countItem" data-metric="characters">
                  <b>{stats.characters}</b>{t('stats.characters')}
                </span>
                <span className="awu-countSep" aria-hidden="true">·</span>
                <span className="awu-countItem" data-metric="memory">
                  <b>{stats.memory}</b>{t('stats.memory')}
                </span>
                <span className="awu-countSep" aria-hidden="true">·</span>
                <span className="awu-countItem" data-metric="turns">
                  <b>{stats.turns}</b>{t('stats.turns')}
                </span>
              </div>
            </div>
          </div>

          {/*
            本会话正在用谁。
            **两种状态同时表达**：本会话（绑定 / 沿用全局）+ 全局（谁 / 未启用）。
            同一张卡两者都命中时只显示一次角色名，并标「本会话 / 全局」（bothSame）。
          */}
          {sessionName !== '' ? (
            <div className="awu-status awu-sigil" data-status="live">
              <Avatar name={sessionName} live />
              <div className="awu-sigilBody">
                <div className="awu-sigilName">
                  {sessionName}
                  {bothSame && (
                    <span className="awu-pill" data-tone="live" style={{ marginLeft: 6 }}>{t('active.both')}</span>
                  )}
                </div>
                {/*
                  标点不再硬编码全角括号/冒号（英文界面会露出中文标点，C 报告 P2-15）：
                  两段 span + 「·」分隔，各语言各自自己的写法。
                */}
                <div className="awu-sigilMeta">
                  <span>{t('active.session')}</span>
                  <span>{' · '}{sessionBound ? t('active.sessionBound') : t('active.sessionInherit')}</span>
                  <span>{' · '}{active.mode === 'text' ? t('active.mode.text') : t('active.mode.action')}</span>
                </div>
                {!bothSame && (
                  <div className="awu-sigilMeta">
                    <span>{t('active.global')}</span>
                    <span>{' · '}{globalName !== '' ? globalName : t('active.globalNone')}</span>
                  </div>
                )}
                {openingNote !== '' && (
                  <div
                    role="status"
                    style={{ fontSize: 11, color: 'var(--awu-ink-mute)', marginTop: 2, lineHeight: 1.4 }}
                  >
                    {openingNote}
                  </div>
                )}
              </div>
              {/*
                状态带**只显示状态**，不再放动作（第 2 批收口，契约 §6「退出全局入口」）。
                原因：这里是「谁在生效」的仪表，放按钮会让同一件事有两个入口
                （「退出全局」原先在状态带和详情页 ⋯ 菜单各一份）。
                现在取消类动作唯一的入口是详情页的 hero（解除绑定）/ ⋯ 菜单（退出全局）。
                代价：没打开任何卡时没有"退出全局"的入口 —— 已淘汰的卡点进去就有，
                第 3 批如果要做"全局开关"设置项，应该做在 ⋯ 菜单而不是这里。
              */}
            </div>
          ) : (
            <div className="awu-status awu-idle" data-status="idle">
              <span className="awu-idleDot" aria-hidden="true" />
              <span>
                <b style={{ color: 'var(--awu-ink-dim)', fontWeight: 500 }}>{t('active.none.title')}</b>
                {' '}
                {t('active.none.hint')}
              </span>
              {/* 状态带右侧原本空着，给一个直达入口：跳到角色簿 */}
              <button
                type="button"
                className="awu-btn"
                data-size="sm"
                data-kind="ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => onTabPick('roster')}
              >
                {t('roster.pick')}
                <span aria-hidden="true"> →</span>
              </button>
            </div>
          )}

          {error !== '' && <ErrorBar message={error} onRetry={() => { void reload() }} t={t} />}
          {notice !== undefined && (
            <div
              className="awu-status awu-idle"
              data-status={notice.tone === 'warn' ? 'warn' : 'info'}
              /* 退场：先挂 closing 淡出 160ms，再从 state 删（见 dismissNotice） */
              {...presenceAttrs(noticeClosing)}
              role="status"
              aria-live="polite"
              style={{ marginTop: -4 }}
            >
              <span className="awu-idleDot" aria-hidden="true" />
              <span className="awu-noticeText">{notice.text}</span>
              <button
                type="button"
                className="awu-noticeClose"
                aria-label={t('notice.close')}
                title={t('notice.close')}
                onClick={dismissNotice}
              >
                <IconClose size={12} />
              </button>
            </div>
          )}

          {/*
            两栏骨架（iOS Split View）：左栏是「选谁」，右栏是「看什么」。
            head 与状态带全宽；`awu-mainHead`（tabs + 全局动作）在右栏顶部。
            `data-nav` 是契约 §2.1 的窄屏导航栈语义：宽屏恒 `split`，
            `<900` 时由 JSX 推 `push` / `pop`（CSS 只负责按这个值画，见 styles.ts 的 <900 段）。
          */}
          <div className="awu-workspace" data-nav={navAttr}>
            <aside className="awu-rail">
              {/*
                左栏头部（自带内边距的容器）：两张卡的入口 → 分段器 → 计数 / 模式 / 导入。
                这些块必须包在有 gutter 的容器里 —— `.awu-rail` 自身没有 padding，
                直接放子元素会贴着边框（实测「共 3 位」被面板左沿切掉）。
              */}
              <div className="awu-railHead">
                {/*
                  两张卡同级并排：蒸馏（从作品里做）/ 自创（从零写）。
                  主人真机反馈「原来一大一小」——所以两者共用同一套按钮类与尺寸，扶手都撑满半栏。
                */}
                <div className="awu-ctaRow">
                  <DistillEntry t={t} label={t('cta.distill')} hint={t('cta.distillHint')} />
                  <div className="awu-distill-entry">
                    <button
                      type="button"
                      className="awu-btn awu-distill-cta"
                      data-kind="primary"
                      title={t('new.title')}
                      aria-haspopup="dialog"
                      onClick={() => openDialog('new')}
                      disabled={busy}
                    >
                      <IconPlus size={14} />
                      {t('cta.selfCreate')}
                    </button>
                    <div className="awu-distill-entryHint">{t('cta.selfCreateHint')}</div>
                  </div>
                </div>

                {/*
                  分段器归位右栏（契约 §2.4）：宽屏时它渲染在 `.awu-mainHead` 里，
                  只有窄屏「列表态」才临时搬到左栏 —— 否则内容列被整体移出视口时
                  tab 会跟着不可达。切 tab 走 `onTabPick`（窄屏顺手 push 内容列）。
                */}
                {showTabsInRail && tabsNode}
                {/*
                  窄屏列表态没有内容列 → mainHead 不在了，刷新/关闭会跟着一起消失。
                  这两个是面板级动作（关掉整个面板、重取数据），不能让它们依赖"哪一列在显示"，
                  所以在列表态把它们跟 tabs 一起搬到左栏头部（同一时刻只存在一处）。
                */}
                {showTabsInRail && mainHeadActions}

                <div className="awu-toolbar" data-wrap="true">
                  {/*
                    过滤行（契约 §2.4 说的「过滤」）：50+ 张卡时左栏是单列，没有搜索只能人肉滚
                    （C 报告 P2-4）。用现成的 `.awu-input.awu-reviewInput` 尺寸，不新造类名。
                    有词时计数变成「命中 / 全部」，让过滤结果可验证。
                  */}
                  <input
                    type="search"
                    className="awu-input awu-reviewInput"
                    value={query}
                    placeholder={t('roster.searchPlaceholder')}
                    aria-label={t('roster.searchPlaceholder')}
                    onChange={event => setQuery(event.target.value)}
                  />
                  {query !== '' ? (
                    <>
                      <span className="awu-statLabel" style={{ fontFamily: 'var(--awu-mono)' }}>
                        {`${visibleRoster.length}/${roster.length}`}
                      </span>
                      <button
                        type="button"
                        className="awu-btn"
                        data-size="sm"
                        data-kind="ghost"
                        onClick={() => setQuery('')}
                      >
                        {t('diary.searchClear')}
                      </button>
                    </>
                  ) : (
                    <span className="awu-statLabel" style={{ fontFamily: 'var(--awu-mono)' }}>
                      {t('roster.count', { n: roster.length })}
                    </span>
                  )}

                  {/*
                    模式胶囊：主人反馈「改模式的地方藏在启用状态条的小图标里，没启用就看不见」。
                    这里显式摆出来，**不要求先启用角色**：有选中卡片就写进那张卡，
                    都没有时宿主只写全局兜底（scope='global'），启用后由 onActivate 补一次。
                  */}
                  <div className="awu-modePills" role="group" aria-label={t('mode.title')}>
                    {MODE_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        className="awu-modePill"
                        data-on={mode === option.value ? 'true' : 'false'}
                        aria-pressed={mode === option.value}
                        title={t(option.hintKey)}
                        onClick={() => applyMode(option.value)}
                        disabled={busy}
                      >
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>

                  {/*
                    工具行已经挤（计数 + 模式胶囊 + 三个入口）：三枚都压成小按钮，
                    完整名字进 title，主操作仍然只有「蒸馏 / 自创」那两枚大 CTA。
                  */}
                  <div className="awu-toolbarActions">
                    <button
                      type="button"
                      className="awu-btn"
                      data-size="sm"
                      data-kind="ghost"
                      onClick={() => openDialog('preset')}
                      disabled={busy}
                      title={t('preset.hint')}
                    >
                      <IconQuill size={12} />
                      {t('preset.entry')}
                    </button>
                    <button
                      type="button"
                      className="awu-btn"
                      data-size="sm"
                      data-kind="ghost"
                      onClick={() => openDialog('preview')}
                      disabled={busy}
                      title={t('preview.hint')}
                    >
                      <IconSpark size={12} />
                      {t('preview.entryShort')}
                    </button>
                    <button
                      type="button"
                      className="awu-btn"
                      data-size="sm"
                      data-kind="ghost"
                      onClick={() => openDialog('import')}
                      disabled={busy}
                      title={t('import.title')}
                    >
                      <IconImport size={12} />
                      {t('import.entryShort')}
                    </button>
                  </div>
                </div>

                {/*
                  「正在看：<名字>」（契约 §2.4 `.awu-railNow`）。
                  这是 P0-1 的**第二道保险**：选中态高亮解决「看得到」，这一行解决
                  「当前对象是谁一目了然」—— 尤其日记 tab 下，卡片可能已经滚出视口。
                  注意 `data-empty` 只在**真空**时才写：CSS 用的是 `[data-empty]`（属性存在性）
                  匹配，若写成 `data-empty="false"`，React 会把 false 序列化成字符串，
                  属性照样存在 → 这一行会被永远隐藏。
                */}
                {tab === 'diary' && (
                  <div className="awu-railNow" data-empty={detailName === '' ? 'true' : undefined}>
                    <span className="awu-sectionLabel">{t('rail.now')}</span>
                    <b>{detailName !== '' ? detailName : '—'}</b>
                  </div>
                )}
              </div>

              {/* tabIndex={-1}：只可编程聚焦（详情卸载后还焦的兜底落点），不进 Tab 序列 */}
              <div className="awu-pane" tabIndex={-1}>
                {skeletonPresence.mounted && (
                  <Skeleton shape="cards" label={t('common.loading')} closing={skeletonPresence.closing} />
                )}

                {/* 接口失败时不要再显示「角色簿还是空的」——那会把错误误导成「你没建卡」 */}
                {!loading && error === '' && roster.length === 0 && (
                  <div className="awu-empty" data-kind="empty">
                    <span className="awu-emptyMark"><IconBook size={20} /></span>
                    <span className="awu-emptyTitle">{t('roster.empty.title')}</span>
                    <span className="awu-emptyHint">{t('roster.empty.hint')}</span>
                    {/* 空态给真按钮（C 报告 P2-6）：原来只有一句话，行动入口在 32px 之外的头部 */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="awu-btn"
                        data-kind="primary"
                        onClick={() => openDialog('new')}
                        disabled={busy}
                      >
                        <IconPlus size={12} />
                        {t('cta.selfCreate')}
                      </button>
                      <button type="button" className="awu-btn" onClick={() => openDialog('import')} disabled={busy}>
                        <IconImport size={12} />
                        {t('import.entryShort')}
                      </button>
                    </div>
                  </div>
                )}

                {/* 有过滤词但零命中：要说清「是过滤没中」，别让用户以为卡全丢了 */}
                {!loading && error === '' && roster.length > 0 && visibleRoster.length === 0 && (
                  <div className="awu-empty" data-kind="empty">
                    <span className="awu-emptyHint">{t('roster.searchEmpty', { keyword: query.trim() })}</span>
                    <button type="button" className="awu-btn" data-size="sm" onClick={() => setQuery('')}>
                      {t('diary.searchClear')}
                    </button>
                  </div>
                )}

                {!loading && visibleRoster.length > 0 && (
                  <div
                    ref={gridRef}
                    className="awu-grid"
                    /* 骨架 → 内容的登场：骨架先退 160ms（presence），内容这一层再 rise 200ms，
                       不同帧硬切。keyframes `awu-rise` 是 CSS 侧的全局真源，这里只引用。 */
                    style={{ animation: 'awu-rise 200ms var(--awu-ease) both' }}
                  >
                    {visibleRoster.map((item, index) => (
                      <CharacterTile
                        key={item.name}
                        item={item}
                        index={index}
                        live={live && item.name === liveName}
                        boundHere={isBoundHere(item.name)}
                        selected={detailName !== '' && item.name === detailName}
                        deleting={deletingName !== '' && item.name === deletingName}
                        busy={busy}
                        t={t}
                        onOpen={openCharacter}
                      />
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/*
              窄屏导航栈的「栈」真的在这里生效：`split` / `pop` 只挂列表列，内容列不渲染。
              为什么不留给 CSS：styles.ts 里只定义了 `[data-nav="push"]` 覆盖列表规则，
              `split` 下两列会回到「上下堆叠」，而那正是要修的那个洞（滚过 20 张卡才看到详情）。
              这里也**没有**用 hidden 属性把 rail 摘掉 —— 那是 CSS 的 visibility 负责的。
            */}
            {/*
              `pop` 期间也要挂着内容列：退场位移得先看得见才谈得上"退"。
              （`split` 仍然不挂 —— 那才是「列表是根」的形态。）
            */}
            {(!narrow || navState === 'push' || navState === 'pop') && (
            <main className="awu-main" data-nav-state={narrow ? navState : undefined}>
              {/*
                右栏头部（契约 §2.4）：tabs 归位到这里，右端放全局动作。
                窄屏列表态下 tablist 会临时搬到左栏（见 `showTabsInRail`），
                这里就只剩动作区。
              */}
              <div className="awu-mainHead">
                {!showTabsInRail && tabsNode}
                {mainHeadActions}
              </div>
              <div
                className="awu-mainBody"
                id="awu-tabpanel"
                role="tabpanel"
                aria-labelledby={tabNode}
                tabIndex={0}
                aria-busy={busy}
              >
                {/*
                  详情渲染条件直接看 `detailSubject`（与上面同一个判据，单一真源）：
                  - 首帧 presence 还没 mounted 但 detailName 已有 → 渲染（不闪空态）；
                  - 退场期 detailName 已空、mounted 仍 true → 继续渲染（动画有对象）；
                  - 160ms 后 mounted 翻 false → detailSubject 归空 → 落回「未选卡」。
                */}
                {tab === 'roster' && (detailSubject !== '' ? (
                  <CharacterDetailView
                    /* 换卡就重挂：`.awu-detail` 的 CSS 进场（awu-slide-in，从右 +8px）才会真的重播；
                       否则同一个 tab 内换对象只是内容替换，没有任何"进去了"的手感。 */
                    key={detailSubject}
                    rootRef={detailRootRef}
                    detail={currentDetail}
                    loading={detailLoading}
                    error={detailError}
                    relation={relation}
                    live={live && liveName === detailSubject}
                    boundHere={isBoundHere(detailSubject)}
                    closing={detailPresence.closing}
                    sessionId={sessionId}
                    busy={busy}
                    t={t}
                    onBack={closeDetail}
                    onRetry={() => { void loadDetail(detailSubject) }}
                    onBindSession={() => onBindSession(detailSubject)}
                    onUnbindSession={onUnbindSession}
                    onActivate={() => onActivate(detailSubject)}
                    onDeactivate={onDeactivate}
                    onDelete={() => openDelete(detailSubject)}
                    onEdit={() => { setEditError(''); setEditorClosing(false); setEditing(true) }}
                    onOpenDiary={() => onOpenDiaryOf(detailSubject)}
                    onExport={onExportDetail}
                    onSwitchMode={() => openDialog('mode')}
                    onNextOpening={onNextOpening}
                    morphFrom={morphFrom}
                    onMorphDone={() => { setMorphFrom(undefined) }}
                  />
                ) : (
                  /* 未选卡：给「往左看」的箭头指引 + 一个次级行动（C 报告 P2-6 / A5） */
                  <div className="awu-empty" data-kind="pick">
                    <span className="awu-emptyMark"><IconBook size={20} /></span>
                    <span className="awu-emptyHint">
                      <span aria-hidden="true">← </span>
                      {t('roster.pick')}
                    </span>
                    <span className="awu-emptySub">{t('roster.pickHint')}</span>
                    <button
                      type="button"
                      className="awu-btn"
                      data-size="sm"
                      style={{ marginTop: 4 }}
                      onClick={() => openDialog('new')}
                      disabled={busy}
                    >
                      <IconPlus size={12} />
                      {t('cta.selfCreate')}
                    </button>
                  </div>
                ))}

            {tab === 'diary' && (diaryTarget === '' ? (
              /* ① 既没选也没启用：告诉他去哪挑卡 —— 给箭头 + 一个真按钮（A5） */
              <div className="awu-empty" data-kind="diary">
                <span className="awu-emptyMark"><IconQuill size={20} /></span>
                <span className="awu-emptyHint">
                  <span aria-hidden="true">← </span>
                  {t('diary.pick')}
                </span>
                <button
                  type="button"
                  className="awu-btn"
                  data-size="sm"
                  onClick={() => onTabPick('roster')}
                >
                  {t('roster.pick')}
                </button>
              </div>
            ) : diaryDetail !== undefined ? (
              /* ② 选中了（无论启用与否）就走正常日记页；「没日记」由 DiaryView 自己给空态 */
              <DiaryView
                entry={diaryDetail}
                relation={diaryRelation}
                busy={busy}
                t={t}
                onForget={() => openDialog('forget')}
                onEdit={target => { setEditTarget(target); setDialogError(''); setDialog('editDiary') }}
                onReset={scope => openDialog(scope === 'session' ? 'resetSession' : 'resetAll')}
              />
            ) : detailLoading ? (
              <Skeleton label={t('common.loading')} />
            ) : detailError !== '' ? (
              /* ③ 加载失败：给错误原文 + 重试，别伪装成「没有日记」 */
              <div className="awu-empty" data-kind="error" role="alert">
                <span className="awu-emptyMark"><IconAlert size={20} /></span>
                <span className="awu-emptyTitle">{t('diary.loadFailed')}</span>
                <span className="awu-emptyHint">{detailError}</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="awu-btn"
                    data-size="sm"
                    onClick={() => { void loadDetail(diaryTarget) }}
                    disabled={busy}
                  >
                    {t('common.retry')}
                  </button>
                </div>
              </div>
            ) : (
              <Skeleton label={t('common.loading')} />
            ))}
            {tab === 'stats' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {/*
                  「统计」tab 不再重复头部的三个数字（C 报告 P2-1）：那里已经是仪表盘，
                  这里只给分项（来源分布 / 最近活跃）与去向（存放位置 + 备份说明）。
                */}
                <Section title={t('stats.source')}>
                  {Object.keys(overview?.stats.bySource ?? {}).length === 0
                    ? <div className="awu-hint">{t('stats.none')}</div>
                    : Object.entries(overview?.stats.bySource ?? {}).map(([key, value]) => (
                      /*
                       * `source` 在 CCv3 里是「这张卡的出处」，理论上很短（distill / import / custom）。
                       * 但外部导入卡可能塞整条 URL —— 直接把 URL 铺进 Field 会和右侧数字挤在一起，
                       * 所以这里把 URL 缩成域名显示，完整值挂在 title 上。
                       */
                      <Field key={key} k={sourceLabelOf(key, t)} title={key} v={t('stats.source.count', { n: value })} />
                    ))}
                </Section>
                <Section title={t('stats.recent')}>
                  {(overview?.recent ?? []).length === 0
                    ? <div className="awu-hint">{t('stats.none')}</div>
                    : (overview?.recent ?? []).map(item => (
                      <Field
                        key={item.name}
                        k={item.name}
                        v={`${t('roster.memory', { n: item.memoryCount })}${relativeDay(item.lastActive, t) !== '' ? ` · ${relativeDay(item.lastActive, t)}` : ''}`}
                      />
                    ))}
                </Section>
                <Section title={t('stats.root')}>
                  <div className="awu-hint" style={{ fontFamily: 'var(--awu-mono)', fontSize: 10.5, wordBreak: 'break-all' }}>
                    {overview?.root !== undefined && overview.root !== '' ? overview.root : '—'}
                  </div>
                  {/* 数据位置 + 备份口径放在一起：这是「统计」这一页唯一能直接指导动作的信息 */}
                  <div className="awu-hint" style={{ marginTop: 6 }}>{t('guide.data.backup')}</div>
                </Section>
              </div>
            )}

                {tab === 'guide' && <GuideView t={t} />}
              </div>
            </main>
            )}
          </div>

          {/*
            弹层宿主（契约 §2.2）：退场期继续渲染「刚关掉的那一层」，并用 context 把
            closing 广播给 Overlay（scrim 与 dialog 都要挂 data-state，否则遮罩硬切）。
          */}
          {dialogPresence.mounted && (
          <DialogLayerContext.Provider value={dialogPresence.closing}>
          {/* 弹层 */}
          {shownDialog === 'new' && (
            <NewCharacterDialog
              existing={list.map(item => item.name)}
              panelBusy={busy}
              onCancel={() => setDialog('')}
              onCreated={onCardCreated}
              t={t}
            />
          )}
          {shownDialog === 'import' && (
            <ImportDialog
              panelBusy={busy}
              onCancel={() => setDialog('')}
              onImported={onImported}
              t={t}
            />
          )}
          {/* 注入预览：只读快照，内容本体在 preview.tsx（遮罩/焦点用这里的 Overlay） */}
          {shownDialog === 'preview' && (
            <Overlay label={t('preview.title')} onClose={() => setDialog('')}>
              <PromptPreview t={t} onClose={() => setDialog('')} />
            </Overlay>
          )}
          {/* 预设：列表 / 编辑 / 导入三态，内容本体在 preset-view.tsx */}
          {shownDialog === 'preset' && (
            <Overlay label={t('preset.title')} onClose={() => setDialog('')} escYield={presetFocusOpen}>
              <PresetPanel
                t={t}
                sessionId={sessionId}
                onFocusLayerChange={setPresetFocusOpen}
                onChanged={() => { void reload() }}
                onClose={() => setDialog('')}
              />
            </Overlay>
          )}
          {shownDialog === 'delete' && (
            <DeleteDialog
              name={deleteTarget}
              busy={busy}
              onCancel={() => setDialog('')}
              onConfirm={onDeleteConfirmed}
              t={t}
            />
          )}
          {shownDialog === 'mode' && (
            <ModeDialog
              current={mode}
              busy={busy}
              onCancel={() => setDialog('')}
              onPick={onModePick}
              t={t}
            />
          )}
          {shownDialog === 'editDiary' && editTarget !== undefined && (
            <EditDiaryDialog
              target={editTarget}
              busy={busy}
              error={dialogError}
              onCancel={() => setDialog('')}
              onSave={onEditDiary}
              t={t}
            />
          )}
          {shownDialog === 'forget' && (
            <ForgetDialog
              busy={busy}
              error={dialogError}
              onCancel={() => setDialog('')}
              onForget={onForget}
              t={t}
            />
          )}
          {shownDialog === 'resetAll' && (
            <ResetAllDialog
              // 名字用「正在看的角色」：弹窗标题必须与实际被重置的对象一致（同 onReset 的口径）
              name={detailName}
              busy={busy}
              scope="all"
              onCancel={() => setDialog('')}
              onConfirm={() => onReset('all')}
              t={t}
            />
          )}
          {shownDialog === 'resetSession' && (
            <ResetAllDialog
              name={detailName}
              busy={busy}
              scope="session"
              onCancel={() => setDialog('')}
              onConfirm={() => onReset('session')}
              t={t}
            />
          )}
          </DialogLayerContext.Provider>
          )}
          </>
          )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** 兼容旧名：早期版本注册的是 settings.section，保留导出避免外部引用断裂。 */
