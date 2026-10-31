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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'

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
import { PromptPreview } from './preview'
import { SCOPED_ATTR, installStyles, CARD_STAGGER, PANEL_MAX_H, PANEL_WIDTH } from './styles'
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

/** 成功类提示条的存活时间（ms）。警告类不吃这个时间，留到用户手动关。 */
const NOTICE_TTL_MS = 5000

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
 * 读 `/overview.bindings`（`sessionId → 角色名`）。
 *
 * 容错到底：宿主可能给 `Record<string,string>`、也可能给 `{sessionId,name}[]`；
 * 认不出来就返回空表 —— 空表等于「不知道」，界面据此只显示全局，绝不瞎猜。
 */
function readBindings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as { sessionId?: unknown; name?: unknown; character?: unknown }
      const key = typeof row.sessionId === 'string' ? row.sessionId : ''
      const name = typeof row.name === 'string' ? row.name : typeof row.character === 'string' ? row.character : ''
      if (key !== '' && name !== '') out[key] = name
    }
    return out
  }
  if (typeof value !== 'object' || value === null) return out
  for (const [key, name] of Object.entries(value as Record<string, unknown>)) {
    if (key !== '' && typeof name === 'string' && name !== '') out[key] = name
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

/** 滚动锁：弹层打开时锁住 body 滚动，关掉立刻还原。 */
function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [active])
}

/**
 * 弹层通用行为：Esc 关闭 + 点击遮罩关闭 + 焦点陷阱（Tab 不出去、关闭后焦点回原位）。
 *
 * 另外**吞掉落在弹层上的文件拖放**：`.awu-scrim` 是 fixed 全屏遮罩，用户拖一张卡进来时
 * 目标就是它，但事件会继续冒到宿主 composer，图片会被当成附件发出去（真机踩过）。
 * `swallowFileDrag` 现在还会在 drop 时复位宿主的拖放计数器（否则聊天区遮罩会永久卡死，
 * 见 `dragdrop.ts` 文件头），拖放区在内层先接住，所以真正的拖放不受影响。
 */
function Overlay(props: {
  label: string
  onClose: () => void
  children: JSX.Element | JSX.Element[]
  /** 弹层里「没落在拖放区上」的文件：默认只是吞掉；传了就顺手回调（用于给一句提示） */
  onFilesDropped?: (files: FileList) => void
}): JSX.Element {
  const { label, onClose, children, onFilesDropped } = props
  const boxRef = useRef<HTMLDivElement | null>(null)
  useScrollLock(true)

  // 焦点顺序不能换：先记回来处 → 再把焦点送进容器 → 最后拦 Tab。
  useRestoreFocus()
  useInitialFocus(boxRef, true)
  useFocusTrap(boxRef, true)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 兜底：弹层卸载时再复位一次——万一拖放在中途被别的东西吃掉（Esc、焦点切换）
  // 没走到 drop，宿主的计数器也得有人归零
  useEffect(() => () => { resetHostDropState() }, [])

  return createPortal(
    <div
      className="awu-scrim"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
      onDragOver={swallowFileDrag}
      onDrop={event => {
        swallowFileDrag(event)
        const files = event.dataTransfer?.files
        if (files !== undefined && files.length > 0) onFilesDropped?.(files)
      }}
    >
      <div ref={boxRef} className="awu-dialog" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- 小组件

function Dot({ on }: { on: boolean }): JSX.Element {
  return <span className="awu-lamp" data-on={on ? 'true' : 'false'} aria-hidden="true" />
}

/** 角色徽标：渐变底 + 名字首字。 */
function Avatar(props: { name: string; size?: 'normal' | 'hero'; live?: boolean }): JSX.Element {
  const { name, size = 'normal', live = false } = props
  return (
    <span
      className={size === 'hero' ? 'awu-avatar awu-heroAvatar' : 'awu-avatar'}
      data-size={size}
      data-hue={String(hueOf(name))}
      data-live={live ? 'true' : 'false'}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  )
}

/**
 * 骨架屏。`shape` 交给 CSS 决定形态（`data-shape`）：
 *  - `detail`（默认）：详情页那种竖排行；
 *  - `cards`：角色簿加载时的卡片网格，避免加载完从 62px 竖条突然跳成两列卡片。
 */
function Skeleton(props: { shape?: 'detail' | 'cards'; label?: string }): JSX.Element {
  return (
    <div className="awu-sk" data-shape={props.shape ?? 'detail'} role="status" aria-live="polite">
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {props.label ?? '载入中…'}
      </span>
      <div className="awu-skRow" />
      <div className="awu-skRow" />
      <div className="awu-skRow" />
    </div>
  )
}

function ErrorBar(props: { message: string; onRetry?: () => void; t: Translate }): JSX.Element {
  return (
    <div className="awu-status awu-err" data-status="alert" role="alert">
      <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
      <span style={{ flex: 1, minWidth: 0 }}>{props.message}</span>
      {props.onRetry !== undefined && (
        <button type="button" className="awu-btn" data-size="sm" onClick={props.onRetry}>
          {props.t('common.retry')}
        </button>
      )}
    </div>
  )
}

/** 一行「键 · 值」。 */
function Field({ k, v, title }: { k: string; v: string; title?: string }): JSX.Element {
  return (
    <div className="awu-field">
      <span className="awu-fieldKey" title={title ?? k}>{k}</span>
      <span className="awu-fieldVal">{v}</span>
    </div>
  )
}

/**
 * 把「来源」键缩成可读标签。
 *
 * stats.bySource 的键来自 CCv3 的 data.source：自产卡是 distill / import / custom，
 * 但外部导入卡可能写整条 URL（规范允许）。直接把 URL 铺进 Field 会和右侧计数挤在一起，
 * 所以 URL 一律缩成域名，完整值走 title 悬停。
 */
/**
 * 角色来源与相对日期的显示统一放在 `client/text.ts`（编辑器与面板共用同一套映射）。
 */

/** 分段字段（性格/声音/关系）的小节。 */
function Section(props: { title: string; count?: number; children: JSX.Element | JSX.Element[] | null }): JSX.Element {
  const { title, count, children } = props
  return (
    <div className="awu-section">
      <div className="awu-sectionHead">
        <span>{title}</span>
        {count !== undefined && <span className="awu-count">{count}</span>}
      </div>
      <div className="awu-sectionBody">{children}</div>
    </div>
  )
}

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

function CharacterTile(props: {
  item: CharacterSummary
  live: boolean
  busy: boolean
  t: Translate
  index: number
  onOpen: (name: string) => void
}): JSX.Element {
  const { item, live, busy, t, index, onOpen } = props
  const role = roleOf(item.card)
  const blurb = blurbOf(item.card)
  const when = relativeDay(item.lastActive, t)
  return (
    <button
      type="button"
      className="awu-card"
      data-live={live ? 'true' : 'false'}
      style={{ animationDelay: `${Math.min(index, 8) * CARD_STAGGER}ms` }}
      onClick={() => onOpen(item.name)}
      aria-label={t('roster.open', { name: item.name })}
      disabled={busy}
    >
      <span className="awu-cardTop">
        <Avatar name={item.name} live={live} />
        <span className="awu-cardTitle">
          <span className="awu-cardName">{item.name}</span>
          <span className="awu-cardRole">{role !== '' ? role : t('common.unknown')}</span>
        </span>
        <span className="awu-cardChevron" aria-hidden="true">
          <IconChevron size={13} />
        </span>
      </span>
      <span className="awu-cardBlurb">{blurb !== '' ? blurb : t('roster.never')}</span>
      <span className="awu-cardFoot">
        {live && <span className="awu-pill" data-tone="live">{t('roster.enabled')}</span>}
        <span className="awu-pill" data-tone={item.memoryCount > 0 ? 'teal' : 'none'}>
          {t('roster.memory', { n: item.memoryCount })}
        </span>
        {when !== '' && <span style={{ marginLeft: 'auto' }}>{when}</span>}
      </span>
    </button>
  )
}

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

  return (
    <Overlay label={t('new.title')} onClose={close}>
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

            {error !== '' && <div className="awu-hint" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{error}</div>}
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
    <Overlay label={t('import.title')} onClose={close} onFilesDropped={() => setDropHint(t('import.dropHint'))}>
      <div className="awu-dialogHead">
        <IconImport size={16} />
        <span>{t('import.title')}</span>
      </div>

      <div className="awu-dialogBody">
        <div className="awu-hint" style={{ marginBottom: 10 }}>{t('import.hint')}</div>

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

            {error !== '' && (
              <div className="awu-err" role="alert">
                <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
                <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
              </div>
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
  return (
    <Overlay label={t('delete.title')} onClose={onCancel}>
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
            onChange={event => setWithMemory(event.target.checked)}
          />
          <span>{t('delete.withMemory')}</span>
        </label>
        {!withMemory && <div className="awu-hint" style={{ marginTop: 8 }}>{t('delete.keepMemory')}</div>}
      </div>
      <div className="awu-dialogFoot">
        <button type="button" className="awu-btn" onClick={onCancel} disabled={busy}>{t('delete.cancel')}</button>
        <button
          type="button"
          className="awu-btn"
          data-kind="danger"
          onClick={() => onConfirm(withMemory)}
          disabled={busy}
        >
          {busy ? t('common.busy') : t('delete.confirm')}
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
    <Overlay label={t('mode.title')} onClose={onCancel}>
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
        <button type="button" className="awu-btn" data-kind="ghost" onClick={onCancel}>{t('common.cancel')}</button>
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
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const submit = (): void => {
    if (text.trim() === '') return
    onSave(text.trim())
  }
  return (
    <Overlay label={t('diary.editTitle')} onClose={onCancel}>
      <div className="awu-dialogHead">
        <IconQuill size={16} />
        <span>{t('diary.editTitle')}</span>
        <span className="awu-count" style={{ marginLeft: 'auto', fontFamily: 'var(--awu-mono)', fontSize: 10.5, color: 'var(--awu-gold)' }}>
          {target.date} · {t(`diary.marker.${target.section}`)}
        </span>
      </div>
      <div className="awu-dialogBody">
        <div className="awu-hint" style={{ marginBottom: 8 }}>{t('diary.editHint')}</div>
        <textarea
          ref={ref}
          className="awu-input awu-textarea"
          value={text}
          rows={4}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit() }
          }}
        />
        {error !== '' && <div className="awu-hint" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{error}</div>}
      </div>
      <div className="awu-dialogFoot">
        <button type="button" className="awu-btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button
          type="button"
          className="awu-btn"
          data-kind="primary"
          onClick={submit}
          disabled={busy || text.trim() === ''}
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
    <Overlay label={t('forget.title')} onClose={onCancel}>
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
          <div className="awu-hint" style={{ color: 'var(--awu-danger)', marginTop: 8 }}>{local !== '' ? local : error}</div>
        )}
      </div>
      <div className="awu-dialogFoot">
        <button type="button" className="awu-btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
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
  return (
    <Overlay label={t('reset.title')} onClose={onCancel}>
      <div className="awu-dialogHead">
        <IconAlert size={16} />
        <span>{fresh ? t('reset.sessionTitle', { name }) : t('reset.confirmTitle', { name })}</span>
      </div>
      <div className="awu-dialogBody">
        <div className="awu-confirmText">{fresh ? t('reset.sessionBody') : t('reset.confirmBody')}</div>
      </div>
      <div className="awu-dialogFoot">
        <button type="button" className="awu-btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button type="button" className="awu-btn" data-kind="danger" onClick={onConfirm} disabled={busy}>
          {busy ? t('common.busy') : (fresh ? t('reset.sessionWord') : t('reset.confirmWord'))}
        </button>
      </div>
    </Overlay>
  )
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
}): JSX.Element {
  const {
    detail, loading, error, relation, live, boundHere, sessionId, busy, t,
    onBack, onRetry, onBindSession, onUnbindSession, onActivate, onDeactivate, onDelete, onEdit,
  } = props

  if (loading) return <Skeleton label={t('common.loading')} />

  // 加载失败：detail 已被清空，必须显式给出「空态 + 重试」，否则只会永远转圈
  if (detail === undefined) {
    if (error === '') return <Skeleton />
    return (
      <div className="awu-detail">
        <div className="awu-detailNav">
          <button type="button" className="awu-navBack" onClick={onBack} aria-label={t('detail.back')} title={t('detail.back')}>
            <IconBack size={13} />
            <span>{t('detail.back')}</span>
          </button>
        </div>
        <div className="awu-empty" data-kind="error">
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

  return (
    <div className="awu-detail">
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
        <Avatar name={detail.name} size="hero" live={live} />
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
              <span className="awu-heroMetaItem" data-role="relation">
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
          {/* 编辑是中性动作：既不是主操作（启用）也不是危险操作（删除），单独一档样式 */}
          <button
            type="button"
            className="awu-btn awu-editEntry" data-kind="edit"
            data-size="md"
            onClick={onEdit}
            disabled={busy}
          >
            <IconQuill size={12} />
            {t('detail.edit')}
          </button>
          {/*
            双态动作组：本会话绑定 / 全局启用，**互不覆盖**两条通道。
            - 当前会话启用：只影响这个会话（拿不到 sessionId 时禁用，不瞎编 id）
            - 全局启用：所有未绑定会话都用它；已绑定会话不变
          */}
          <button
            type="button"
            className="awu-btn"
            data-size="md"
            data-kind={boundHere ? undefined : 'primary'}
            onClick={onBindSession}
            disabled={busy || sessionId === '' || boundHere}
          >
            <IconPower size={12} />
            {t('detail.bindSession')}
          </button>
          {boundHere && (
            <button type="button" className="awu-btn" data-size="md" onClick={onUnbindSession} disabled={busy}>
              <IconEject size={12} />
              {t('detail.bindSessionOff')}
            </button>
          )}
          {live ? (
            <button type="button" className="awu-btn" data-size="md" onClick={onDeactivate} disabled={busy}>
              <IconEject size={12} />
              {t('detail.globalOff')}
            </button>
          ) : (
            <button type="button" className="awu-btn" data-size="md" onClick={onActivate} disabled={busy}>
              <IconPower size={12} />
              {t('detail.globalOn')}
            </button>
          )}
          <button type="button" className="awu-btn" data-size="md" data-kind="danger" onClick={onDelete} disabled={busy}>
            <IconTrash size={12} />
            {t('detail.delete')}
          </button>
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
        <DiaryList entries={detail.diary} t={t} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- 日记页

/**
 * 日记页内容。
 *
 * 抽出来是因为「空」有**三种**，之前混成一种：没选角色 / 选了但没日记 / 加载失败。
 * 真机上「选了卡没启用」被错显示成「先启用或选择一位角色」，根因是上游 `viewName` 只认启用角色；
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

      {/* 维护：全新开始 / 彻底重置 */}
      <div className="awu-dangerZone">
        <div className="awu-sectionHead">{t('reset.title')}</div>
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
      if (width > 0) {
        setWide(width >= RAIL_MAX_WIDTH)
        return
      }
      // 量不到宽度时按 prop 决定；prop 也没有就保持窄轨
      setWide(propWide === undefined ? false : propWide)
    }

    measure()

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ref, guess, propWide])

  // prop 明确给了值时，跟随 prop（宿主主动告诉我们的比测量更权威）
  useEffect(() => {
    if (propWide !== undefined) setWide(propWide)
  }, [propWide])

  return wide
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

  const [detailName, setDetailName] = useState('')
  const [detail, setDetail] = useState<CharacterDetail | undefined>(undefined)
  const [detailLoading, setDetailLoading] = useState(false)
  // 详情单独持有一份错误：失败时 detail 会被清空，只靠全局 error 的话详情区会永久停在骨架屏
  const [detailError, setDetailError] = useState('')

  const [dialog, setDialog] = useState<'' | 'new' | 'import' | 'preview' | 'delete' | 'mode' | 'editDiary' | 'forget' | 'resetAll' | 'resetSession'>('')
  const [deleteTarget, setDeleteTarget] = useState('')
  const [editTarget, setEditTarget] = useState<DiaryTarget | undefined>(undefined)
  const [dialogError, setDialogError] = useState('')
  const [relation, setRelation] = useState<RelationState | undefined>(undefined)
  const [openingNote, setOpeningNote] = useState('')

  // 角色卡编辑器
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState('')
  // 编辑器草稿是否脏：面板收起/卸载前必须据此拦一道，否则一屏编辑无声丢失
  const [editorDirty, setEditorDirty] = useState(false)
  // 递增信号：面板要求编辑器「走一遍未保存确认」（点入口/点遮罩时用）
  const [editorCloseSignal, setEditorCloseSignal] = useState(0)
  /**
   * 「本轮被世界书预算裁掉」的条目（打开编辑器时解析一次）。
   *
   * 来源优先 `GET /character` 的 diag（宿主新加），拿不到才去问 `GET /preview` 的 `lore`；
   * 都没有就保持 undefined → 世界书分区里那块警示**整块不显示**（不报错、不打扰）。
   */
  const [droppedLore, setDroppedLore] = useState<LoreDroppedInfo | undefined>(undefined)

  // 编辑器关掉后清脏标记，避免下次打开误拦
  useEffect(() => {
    if (!editing) setEditorDirty(false)
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
  const aliveRef = useRef(true)

  // 面板本身也要有焦点语义：打开时把焦点送进去、Tab 不跑回宿主、关闭后还回触发按钮。
  // 编辑器/弹层打开时它们的陷阱会压在栈顶，这里不用额外处理。
  useRestoreFocus(open)
  useInitialFocus(panelRef, open)
  useFocusTrap(panelRef, open)

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

  const dismissNotice = useCallback((): void => {
    clearNoticeTimer()
    setNotice(undefined)
  }, [clearNoticeTimer])

  const showNotice = useCallback((text: string, tone: 'ok' | 'warn' = 'ok'): void => {
    if (text === '') return
    // 新提示覆盖旧提示：先把旧计时器清掉，否则旧计时器会提前把新提示卷走
    clearNoticeTimer()
    setNotice({ text, tone })
    if (tone === 'ok') {
      noticeTimer.current = window.setTimeout(() => {
        noticeTimer.current = undefined
        setNotice(undefined)
      }, NOTICE_TTL_MS)
    }
  }, [clearNoticeTimer])

  // 卸载时把计时器收掉，别让它去 setState 一个已经死掉的组件
  useEffect(() => () => { clearNoticeTimer() }, [clearNoticeTimer])

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
        fetchOverview().catch(() => undefined),
      ])
      if (!aliveRef.current) return
      setList(chars)
      if (ov !== undefined) {
        setOverview(ov)
        setActive(ov.active ?? { enabled: false })
        // 会话绑定：老宿主没有这两个字段 → 空串 / 空表（界面自动退化成只用全局）
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
  }, [])

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
      const body = await fetchCharacter(name)
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

  // 详情页看「选中的角色」，日记页看「选中的角色 → 否则当前启用角色」
  // （原来日记页只看启用角色，「选了卡但没启用」就会错显示成空态——真机反馈 #1）
  const viewName = tab === 'diary'
    ? (detailName !== '' ? detailName : (active.enabled ? (active.character ?? '') : ''))
    : detailName
  /** 日记页真正要展示的角色名（空串 = 既没选也没启用）。 */
  const diaryTarget = tab === 'diary' ? viewName : ''
  useEffect(() => {
    if (viewName === '') { setDetail(undefined); return }
    void loadDetail(viewName)
  }, [viewName, loadDetail])

  /**
   * 静默刷新：只更新列表与总览，不动 loading / error / notice。
   *
   * 用途：蒸馏改成「AI 全程自己建卡并落盘」之后，新卡是在会话里产生的，
   * 面板不会自己知道。开着面板时轮询一次，用户就不用点刷新了。
   * 失败**不打扰用户**（下一轮再试），但要在 console 留痕，方便排查接口挂了。
   */
  const reloadQuietly = useCallback(async (): Promise<void> => {
    try {
      const [chars, ov] = await Promise.all([fetchCharacters(), fetchOverview().catch(() => undefined)])
      if (!aliveRef.current) return
      // 5 秒轮询：数据没变就别 setState（否则整棵树每 5 秒白重渲染一次）
      const signature = JSON.stringify([chars, ov?.active ?? null])
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
  }, [])

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
      if (dialog !== '') return
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
      if (event.key === 'Escape' && dialog === '' && !editing) {
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
  }, [open, dialog, editing, editorDirty])

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
      await deleteCharacter(target, withMemory)
      if (detailName === target) { setDetailName(''); setDetail(undefined) }
      showNotice(withMemory ? t('delete.doneWithMemory') : t('delete.done'), 'ok')
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
  const openDialog = (which: 'new' | 'import' | 'preview' | 'mode' | 'forget' | 'resetAll' | 'resetSession' | ''): void => { setDialogError(''); setDialog(which) }

  // -------------------------------------------------------- 维护动作（新接口）
  const onEditDiary = (text: string): void => {
    if (editTarget === undefined) return
    setBusy(true)
    setDialogError('')
    // 改的是「正在看的那位」的日记，不是启用角色的（看别人的日记时别改错人）
    void editDiary(viewName, {
      text,
      date: editTarget.date,
      section: editTarget.section,
      index: editTarget.index,
    }).then(() => {
      setDialog('')
      dismissNotice()
      return reload()
    }).catch((error: unknown) => {
      setDialogError(errorText(error))
    }).finally(() => { if (aliveRef.current) setBusy(false) })
  }

  const onForget = (keyword: string): void => {
    setBusy(true)
    setDialogError('')
    // 同理：显式带上正在看的那位，否则「忘记」会落到启用角色身上（改错人）
    void forgetKeyword(keyword, viewName === '' ? undefined : viewName).then(result => {
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
    void resetSession(scope).then(result => {
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
        setEditing(false)
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
    if (liveName === '') return
    setBusy(true)
    setOpeningNote('')
    void nextOpening(liveName).then(result => {
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

  const currentDetail = detailName !== '' && detailName === detail?.name ? detail : undefined
  // 日记页用的是 viewName 加载来的那一份，只要名字对得上就认（可能不是启用角色）
  const diaryDetail = diaryTarget !== '' && detail !== undefined && detail.name === diaryTarget ? detail : undefined
  /**
   * 本会话绑定的角色（`bindings[sessionId]`）。
   *
   * 宿主没给 bindings 时退一步读 `GET /character` 的容错字段（只对「当前打开的那张卡」有效）：
   * 这样做的好处是「绑定刚被别处改过、overview 还没刷新」时详情页也不会闪成未绑定。
   */
  const boundName = sessionId !== ''
    ? (bindings[sessionId] ?? (currentDetail?.boundHere === true && currentDetail.name !== '' ? currentDetail.name : ''))
    : ''
  /** 本会话实际生效的角色：绑定优先，其次全局 */
  const sessionName = boundName !== '' ? boundName : globalName
  const sessionBound = boundName !== ''
  /** 同一张卡既绑了本会话又是全局角色：只显示一次，标「本会话 / 全局」 */
  const bothSame = boundName !== '' && boundName === globalName

  /** 详情页这张卡是否已绑定在本会话（优先 bindings，其次 GET /character 的容错字段） */
  const isBoundHere = (name: string): boolean => {
    if (name === '' || sessionId === '') return false
    if (bindings[sessionId] !== undefined) return bindings[sessionId] === name
    return currentDetail?.name === name
      && (currentDetail?.boundHere === true || currentDetail?.boundSessionId === sessionId)
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
  // ⚠️ 居中**不能用 transform**：面板有入场动画 `awu-panel-in`，动画运行期间 keyframes 里的
  // transform 会覆盖内联 transform —— 窗口会先出现在右半边，动画结束才「跳」回正中（主人实测到过）。
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
    setTab(TAB_IDS[next].id)
    document.getElementById(TAB_IDS[next].node)?.focus()
  }

  // -------------------------------------------------------- 渲染
  return (
    <div
      ref={layerRef}
      className="awu-layer"
      data-rail={wide ? 'false' : 'true'}
      {...{ [SCOPED_ATTR]: '' }}
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

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className="awu-panel awu-scope"
          style={panelStyle}
          data-busy={busy ? 'true' : 'false'}
          role="dialog"
          aria-modal="false"
          aria-label={t('panel.title')}
          {...{ [SCOPED_ATTR]: '' }}
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
              onCancel={() => setEditing(false)}
              onSave={onSaveCard}
              t={t}
            />
          ) : (
          <>
          {/* 头部 */}
          <div className="awu-head">
            <div className="awu-headMain">
              <div className="awu-kicker">{t('panel.kicker')}</div>
              <div className="awu-title">角色<em>管理器</em></div>
              {/*
                三个总量指标：原来占右栏顶部一整条，视觉重量和正文打架（主人反馈「太大了」）。
                收成标题下方一行紧凑元信息，右栏空间全部还给内容。
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
            <div className="awu-headActions">
              <button
                type="button"
                className="awu-iconBtn"
                title={t('panel.refresh')}
                aria-label={t('panel.refresh')}
                data-spin={busy ? 'true' : 'false'}
                onClick={() => { void reload(); if (viewName !== '') void loadDetail(viewName) }}
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
                <div className="awu-sigilMeta">
                  {t('active.session')}
                  {sessionBound ? `（${t('active.sessionBound')}）` : `（${t('active.sessionInherit')}）`}
                  {' · '}
                  {active.mode === 'text' ? t('active.mode.text') : t('active.mode.action')}
                </div>
                {!bothSame && (
                  <div className="awu-sigilMeta">
                    {t('active.global')}：{globalName !== '' ? globalName : t('active.globalNone')}
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
              <div className="awu-sigilBtns">
                <button
                  type="button"
                  className="awu-btn"
                  data-size="sm"
                  data-kind="ghost"
                  title={t('active.mode.switch')}
                  onClick={() => openDialog('mode')}
                  disabled={busy}
                >
                  {active.mode === 'text' ? <IconText size={12} /> : <IconMotion size={12} />}
                </button>
                <button
                  type="button"
                  className="awu-btn"
                  data-size="sm"
                  title={t('opening.next')}
                  onClick={onNextOpening}
                  disabled={busy}
                >
                  <IconRefresh size={12} />
                </button>
                {/* 取消入口按状态给：会话绑定 → 解除本会话绑定；全局 → 退出全局 */}
                {sessionBound && (
                  <button type="button" className="awu-btn" data-size="sm" onClick={onUnbindSession} disabled={busy}>
                    {t('detail.bindSessionOff')}
                  </button>
                )}
                {globalName !== '' && (
                  <button type="button" className="awu-btn" data-size="sm" onClick={onDeactivate} disabled={busy}>
                    {t('active.gExit')}
                  </button>
                )}
              </div>
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
                onClick={() => setTab('roster')}
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
            head 与状态带全宽；工具行/分段器归左栏（它们操作的对象就是左栏那张列表），
            统计条归右栏顶部当仪表行。窄屏（<900px）由 CSS 断点自动收成单栏。
          */}
          <div className="awu-workspace">
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

                <div className="awu-tabs" role="tablist" aria-label={t('panel.title')} onKeyDown={onTabKey}>
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
                      onClick={() => setTab(item.id)}
                    >
                      {t(`panel.tab.${item.id}`)}
                    </button>
                  ))}
                </div>

                <div className="awu-toolbar" data-wrap="true">
                  <span className="awu-statLabel" style={{ fontFamily: 'var(--awu-mono)' }}>
                    {t('roster.count', { n: roster.length })}
                  </span>

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

                  <div className="awu-toolbarActions">
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
                      {t('preview.entry')}
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
                      {t('import.entry')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="awu-pane">
                {loading && <Skeleton shape="cards" label={t('common.loading')} />}

                {/* 接口失败时不要再显示「角色簿还是空的」——那会把错误误导成「你没建卡」 */}
                {!loading && error === '' && roster.length === 0 && (
                  <div className="awu-empty" data-kind="empty">
                    <span className="awu-emptyMark"><IconBook size={20} /></span>
                    <span className="awu-emptyTitle">{t('roster.empty.title')}</span>
                    <span className="awu-emptyHint">{t('roster.empty.hint')}</span>
                  </div>
                )}

                {!loading && roster.length > 0 && (
                  <div className="awu-grid">
                    {roster.map((item, index) => (
                      <CharacterTile
                        key={item.name}
                        item={item}
                        index={index}
                        live={live && item.name === liveName}
                        busy={busy}
                        t={t}
                        onOpen={setDetailName}
                      />
                    ))}
                  </div>
                )}
              </div>
            </aside>

            <main className="awu-main">
              <div
                className="awu-pane"
                id="awu-tabpanel"
                role="tabpanel"
                aria-labelledby={tabNode}
                tabIndex={0}
                aria-busy={busy}
              >
                {tab === 'roster' && (detailName !== '' ? (
                  <CharacterDetailView
                    detail={currentDetail}
                    loading={detailLoading}
                    error={detailError}
                    relation={relation}
                    live={live && liveName === detailName}
                    boundHere={isBoundHere(detailName)}
                    sessionId={sessionId}
                    busy={busy}
                    t={t}
                    onBack={() => { setDetailName(''); setDetail(undefined); setDetailError('') }}
                    onRetry={() => { void loadDetail(detailName) }}
                    onBindSession={() => onBindSession(detailName)}
                    onUnbindSession={onUnbindSession}
                    onActivate={() => onActivate(detailName)}
                    onDeactivate={onDeactivate}
                    onDelete={() => openDelete(detailName)}
                    onEdit={() => { setEditError(''); setEditing(true) }}
                  />
                ) : (
                  <div className="awu-empty" data-kind="pick">
                    <span className="awu-emptyMark"><IconBook size={20} /></span>
                    <span className="awu-emptyHint">{t('roster.pick')}</span>
                    <span className="awu-emptySub">{t('roster.pickHint')}</span>
                  </div>
                ))}

            {tab === 'diary' && (diaryTarget === '' ? (
              /* ① 既没选也没启用：告诉他去哪挑卡 */
              <div className="awu-empty" data-kind="diary">
                <span className="awu-emptyMark"><IconQuill size={20} /></span>
                <span className="awu-emptyHint">{t('diary.pick')}</span>
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
              <div className="awu-empty" data-kind="error">
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
              <Skeleton />
            ))}
            {tab === 'stats' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                <Section title={t('stats.title')}>
                  <Field k={t('stats.characters')} v={String(stats.characters)} />
                  <Field k={t('stats.memory')} v={String(stats.memory)} />
                  <Field k={t('stats.turns')} v={String(stats.turns)} />
                </Section>
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
                </Section>
              </div>
            )}

                {tab === 'guide' && <GuideView t={t} />}
              </div>
            </main>
          </div>

          {/* 弹层 */}
          {dialog === 'new' && (
            <NewCharacterDialog
              existing={list.map(item => item.name)}
              panelBusy={busy}
              onCancel={() => setDialog('')}
              onCreated={onCardCreated}
              t={t}
            />
          )}
          {dialog === 'import' && (
            <ImportDialog
              panelBusy={busy}
              onCancel={() => setDialog('')}
              onImported={onImported}
              t={t}
            />
          )}
          {/* 注入预览：只读快照，内容本体在 preview.tsx（遮罩/焦点用这里的 Overlay） */}
          {dialog === 'preview' && (
            <Overlay label={t('preview.title')} onClose={() => setDialog('')}>
              <PromptPreview t={t} onClose={() => setDialog('')} />
            </Overlay>
          )}
          {dialog === 'delete' && (
            <DeleteDialog
              name={deleteTarget}
              busy={busy}
              onCancel={() => setDialog('')}
              onConfirm={onDeleteConfirmed}
              t={t}
            />
          )}
          {dialog === 'mode' && (
            <ModeDialog
              current={mode}
              busy={busy}
              onCancel={() => setDialog('')}
              onPick={onModePick}
              t={t}
            />
          )}
          {dialog === 'editDiary' && editTarget !== undefined && (
            <EditDiaryDialog
              target={editTarget}
              busy={busy}
              error={dialogError}
              onCancel={() => setDialog('')}
              onSave={onEditDiary}
              t={t}
            />
          )}
          {dialog === 'forget' && (
            <ForgetDialog
              busy={busy}
              error={dialogError}
              onCancel={() => setDialog('')}
              onForget={onForget}
              t={t}
            />
          )}
          {dialog === 'resetAll' && (
            <ResetAllDialog
              name={liveName}
              busy={busy}
              scope="all"
              onCancel={() => setDialog('')}
              onConfirm={() => onReset('all')}
              t={t}
            />
          )}
          {dialog === 'resetSession' && (
            <ResetAllDialog
              name={liveName}
              busy={busy}
              scope="session"
              onCancel={() => setDialog('')}
              onConfirm={() => onReset('session')}
              t={t}
            />
          )}
          </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** 兼容旧名：早期版本注册的是 settings.section，保留导出避免外部引用断裂。 */
