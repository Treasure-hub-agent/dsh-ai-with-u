/**
 * AI WITH U · 从作品蒸馏角色卡（v2：消息通道）
 *
 * 为什么是「发一条消息」而不是「加一个工具」：面板拿不到模型，只能把话递进会话；
 * 流程正文放随包发布的 `distill/flow.md`，指令里只给绝对路径 —— 正文永远不进 system prompt。
 *
 * 本文件当前只做**发送通道**（2026-10-30 22:00 起）：
 *  - `DockSink`   —— 挂在 `conversation.composer.dock` 的**无头**贡献：把 `inputActions` /
 *    `sessionId` / `useInput` 快照存进模块级 sink，供侧栏面板取用（`sidebar.footer.action`
 *    这个席位拿不到 `inputActions`，必须借会话作用域插槽转一手）。
 *  - `DockEntry`  —— 同一位置的**可见**小入口（可选注册），只填入不发。
 *  - `DistillDialog` —— 面板侧确认弹层：发送指令 / 复制兜底 / 如实回显状态。
 *
 * ⏸ **卡片回填已挂起**：主人把卡片格式改成酒馆卡 CCv3（`spec: chara_card_v3` + `character_book`），
 * 原来的「粘贴 JSON → 34 字段校验 → 进 CardEditor」等 tavern 格式定稿后按新契约重做
 * （存档：`docs/design/2026-10-30-distill-entry.md` §5.2b / §5.7 / §8）。
 * 因此本文件现在没有任何 `parseDistillCard` 依赖，也不写盘。
 *
 * 发送契约（2026-10-14 / 10-17 对已安装 desktop 0.2.0-rc.2 实测，来源：本机 dsh-story 头部注释）：
 *  - `InputActions = { captureInsertion(), insertText(text, span) → boolean, setDraft(text), …, submit() }`；
 *  - `insertText` 在「草稿版本变化 / adjudicating / submitting / 已卸载」时返回 false，**必须判返回值**；
 *  - `submit()` 提交的是 `projection.clipboardText`，同一 tick 里 `insertText` 后紧跟 `submit()` 可靠；
 *  - `submit` **不在官方插件文档里**（只文档化 captureInsertion/insertText）→ 必须
 *    `typeof === 'function'` 防御 + 失败降级，绝不允许它把 slot 渲染或用户草稿搞坏。
 *
 * @module dsh-ai-with-u/client/distill
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'

import { errorText, fetchDistillFlow } from './api'
import type { DistillFlowInfo } from './api'
import { IconClose, IconQuill } from './icons'
import type { Translate } from './text'

// ---------------------------------------------------------------- 输入框 sink

/** slot 注入的 `inputActions`：只声明我们真正会碰的成员。 */
interface ActionBag { [key: string]: unknown }

let sinkActions: ActionBag | undefined
let sinkSession = ''
let sinkInput: { phase?: string; draft?: string } | undefined

const sinkListeners = new Set<() => void>()

function notifySink(): void {
  for (const listener of sinkListeners) {
    try {
      listener()
    } catch (error) {
      // 全项目禁止空 catch：订阅方自己炸了要留痕，但不能连累其它订阅（DEVELOPMENT.md 坑 7）
      console.error('[ai-with-u] 蒸馏 sink 订阅回调失败', error)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** 取 `inputActions` 上的一个方法；不是函数就返回 undefined（宿主版本差异的兜底）。 */
function actionFn(name: string): ((...args: unknown[]) => unknown) | undefined {
  const raw = sinkActions?.[name]
  return typeof raw === 'function' ? raw as (...args: unknown[]) => unknown : undefined
}

/**
 * 读 slot 注入的 `useInput` 快照（拿 `phase` 与 `draft`）。
 *
 * 写法与已安装的 `dsh-story` 同款：slot 把 hook 当 prop 注入，缺了就不调用。这确实是
 * 「条件调用 hook」，但它是宿主这套 slot 约定的既定用法，且同一 slot 的 prop 在手挂载
 * 期间是稳定的；换成别处没有的更安全写法反而要碰宿主内部 API。
 */
function useInputSnapshot(useInput: unknown): { phase?: string; draft?: string } | undefined {
  let snapshot: unknown
  if (typeof useInput === 'function') {
    try {
      snapshot = (useInput as (select: (value: unknown) => unknown) => unknown)((value: unknown) => value)
    } catch (error) {
      console.error('[ai-with-u] 读 useInput 快照失败', error)
      snapshot = undefined
    }
  }
  const record = asRecord(snapshot)
  if (record === undefined) return undefined
  return {
    phase: typeof record['phase'] === 'string' ? record['phase'] : undefined,
    draft: typeof record['draft'] === 'string' ? record['draft'] : undefined,
  }
}

/**
 * 无头 dock 贡献：把会话作用域的能力转交给面板。
 *
 * 在 `entry.tsx` 里注册到 `conversation.composer.dock`（kind=list / scope=session）；
 * 组件本身**不渲染任何东西**，只做转交。
 */
export function DockSink(props: {
  inputActions?: unknown
  sessionId?: string
  useInput?: unknown
  useChat?: unknown
}): JSX.Element | null {
  const { inputActions, sessionId, useInput } = props
  const input = useInputSnapshot(useInput)

  useEffect(() => {
    sinkActions = asRecord(inputActions)
    sinkSession = typeof sessionId === 'string' ? sessionId : ''
    notifySink()
    return () => {
      sinkActions = undefined
      sinkSession = ''
      sinkInput = undefined
      notifySink()
    }
  }, [inputActions, sessionId])

  useEffect(() => {
    // 快照只更新、不通知：它不是「能不能发」的判据，避免每次输入都触发面板重渲染
    sinkInput = input
  }, [input])

  return null
}

/** dock 是否已拿到可用的输入框（决定面板按钮写「发送」还是「输入框未就绪」）。 */
export function composerReady(): boolean {
  return actionFn('insertText') !== undefined
}

/** 订阅 composerReady() 的 React 版本（面板重渲染时才知道 dock 到位了）。 */
export function useComposerReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => composerReady())
  useEffect(() => {
    const update = (): void => setReady(composerReady())
    sinkListeners.add(update)
    update()
    return () => { sinkListeners.delete(update) }
  }, [])
  return ready
}

/** 当前 sink 绑定的会话 id（多会话时用于提示；空串 = 没绑定）。 */
export function composerSessionId(): string {
  return sinkSession
}

// ---------------------------------------------------------------- 发送

/**
 * 发送结果。
 *
 * - `sent`   —— 指令已进会话并已提交；
 * - `filled` —— 只填进了输入框，没提交（`note` 说明原因：`busy` 会话正在生成 / `no-submit` 宿主没暴露 submit）；
 * - 失败一律把 `instruction` 原样带回来，面板负责显示 + 复制兜底。
 *
 * ⚠️ 相对约定的两处扩展（不影响只读 `ok` / `mode` 的调用方）：失败原因多了 `flow-failed`
 * （读不到 flow.md），成功/失败都多了 `note` / `error`。
 */
export type SendResult =
  | { ok: true; mode: 'sent' | 'filled'; instruction: string; note?: 'busy' | 'no-submit' }
  | {
    ok: false
    reason: 'no-dock' | 'flow-failed' | 'insert-failed' | 'submit-failed'
    instruction: string
    error?: string
  }

/** 只在「输入框空着」或调用方明确允许时插入，避免把用户的草稿切碎。 */
function draftIsEmpty(): boolean {
  const draft = sinkInput?.draft
  return draft === undefined || draft.trim() === ''
}

/**
 * 把蒸馏指令发进当前会话：读 flow → `insertText` → （可用则）`submit`。
 *
 * 每一步都防御式：任何一步不成立都返回可操作的结果，绝不抛给面板、绝不假装发成功。
 */
export async function sendDistillInstruction(): Promise<SendResult> {
  let instruction: string
  try {
    instruction = (await fetchDistillFlow()).instruction
  } catch (error) {
    return { ok: false, reason: 'flow-failed', instruction: '', error: errorText(error) }
  }

  const insertText = actionFn('insertText')
  if (insertText === undefined) {
    return { ok: false, reason: 'no-dock', instruction }
  }

  const capture = actionFn('captureInsertion')
  let span: unknown
  if (capture !== undefined) {
    try {
      span = capture.call(sinkActions)
    } catch (error) {
      console.error('[ai-with-u] captureInsertion 失败，改用无 span 插入', error)
      span = undefined
    }
  }

  let inserted = false
  try {
    inserted = insertText.call(sinkActions, instruction, span) === true
    // captureInsertion 给了 span 却没插进去：再试一次不带 span（不同宿主版本对 span 要求不同）
    if (!inserted && span !== undefined && span !== null) {
      inserted = insertText.call(sinkActions, instruction) === true
    }
  } catch (error) {
    console.error('[ai-with-u] insertText 抛错', error)
    inserted = false
  }
  if (!inserted) {
    return { ok: false, reason: 'insert-failed', instruction }
  }

  // 已知 phase 不干净（adjudicating / submitting）时 submit 会被宿主静默吞掉 —— 不要装作发出去了
  const phase = sinkInput?.phase
  if (phase !== undefined && phase !== 'plain') {
    return { ok: true, mode: 'filled', instruction, note: 'busy' }
  }

  const submit = actionFn('submit')
  if (submit === undefined) {
    return { ok: true, mode: 'filled', instruction, note: 'no-submit' }
  }
  try {
    // 同一 tick 里 insertText 之后紧跟 submit() 是可靠的（submit 提交的是 clipboardText 投影）
    await Promise.resolve(submit.call(sinkActions))
    return { ok: true, mode: 'sent', instruction }
  } catch (error) {
    console.error('[ai-with-u] submit 失败，已保留输入框内容', error)
    return { ok: false, reason: 'submit-failed', instruction, error: errorText(error) }
  }
}

// ---------------------------------------------------------------- 复制兜底

/** 复制到剪贴板；失败不抛错（面板会显示可手动选中的文本）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text)
      return true
    }
  } catch (error) {
    console.error('[ai-with-u] 写剪贴板失败', error)
  }
  return false
}

// ---------------------------------------------------------------- 可见的 dock 入口

/**
 * 输入框上方的「蒸馏」小入口（可选注册）。
 *
 * **只填入、不发送**：用户此刻就在输入框旁边，自己按回车最安全，也避免「点一下就把一整个
 * 流程塞进正在生成的回合里」。输入框已有文字时不动它，只提示先清空。
 */
export function DockEntry(props: { t: Translate }): JSX.Element {
  const { t } = props
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current) }, [])

  const flash = useCallback((text: string): void => {
    setNote(text)
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNote(''), 6000)
  }, [])

  const onClick = (): void => {
    if (busy) return
    if (!draftIsEmpty()) { flash(t('distill.dockDraftNotEmpty')); return }
    setBusy(true)
    void fetchDistillFlow()
      .then(info => {
        const insertText = actionFn('insertText')
        if (insertText === undefined) { flash(t('distill.dockUnavailable')); return }
        let ok = false
        try {
          ok = insertText.call(sinkActions, info.instruction) === true
        } catch (error) {
          console.error('[ai-with-u] dock 入口插入失败', error)
        }
        flash(ok ? t('distill.dockFilled') : t('distill.dockUnavailable'))
      })
      .catch((error: unknown) => flash(errorText(error)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="awu-distill-dock">
      <button
        type="button"
        className="awu-distill-dockBtn"
        title={t('distill.entryTitle')}
        onClick={onClick}
        disabled={busy}
      >
        <IconQuill size={11} />
        {t('distill.entry')}
      </button>
      {note !== '' && <span className="awu-distill-dockNote">{note}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- 弹层

/** 弹层打开期间锁住 body 滚动（与面板弹层同款行为，见 index.tsx 的 useScrollLock）。 */
function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [active])
}

export interface DistillDialogProps {
  t: Translate
  /** 用户主动关闭（遮罩 / Esc / 关闭按钮）。 */
  onClose: () => void
  /** 「这件事算完成了」：发送成功后通知外层（外层可据此刷新或什么都不做）。 */
  onDone: () => void
}

/**
 * 蒸馏确认弹层：发送指令 → 回显结果 → 复制兜底。
 *
 * 不写盘、不解析卡片：卡片回填等 CCv3 格式定稿（见文件头）。
 */
export function DistillDialog(props: DistillDialogProps): JSX.Element {
  const { t, onClose, onDone } = props
  const ready = useComposerReady()

  const [phase, setPhase] = useState<'idle' | 'sending'>('idle')
  const [flow, setFlow] = useState<DistillFlowInfo | undefined>(undefined)
  const [flowError, setFlowError] = useState('')
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | undefined>(undefined)
  const [manual, setManual] = useState('')

  useBodyScrollLock(true)

  useEffect(() => {
    let alive = true
    void fetchDistillFlow()
      .then(info => { if (alive) setFlow(info) })
      .catch((error: unknown) => { if (alive) setFlowError(errorText(error)) })
    return () => { alive = false }
  }, [])

  // Esc 关闭：正在发送时不关，避免用户以为发出去了其实还在跑
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (phase !== 'idle') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [phase, onClose])

  const reasonText = (reason: 'no-dock' | 'flow-failed' | 'insert-failed' | 'submit-failed'): string => {
    if (reason === 'no-dock') return t('distill.noDock')
    if (reason === 'flow-failed') return t('distill.flowFailed')
    if (reason === 'insert-failed') return t('distill.insertFailed')
    return t('distill.submitFailed')
  }

  const onSend = (): void => {
    if (phase !== 'idle') return
    setPhase('sending')
    setNote(undefined)
    void sendDistillInstruction()
      .then(next => {
        setManual(next.instruction)
        if (!next.ok) {
          setNote({ tone: 'err', text: reasonText(next.reason) })
          return
        }
        if (next.mode === 'sent') {
          setNote({ tone: 'ok', text: t('distill.sent') })
          onDone()
        } else if (next.note === 'busy') {
          setNote({ tone: 'warn', text: t('distill.busyFilled') })
        } else {
          setNote({ tone: 'warn', text: t('distill.filled') })
        }
      })
      .finally(() => setPhase('idle'))
  }

  const onCopy = (): void => {
    const text = manual !== '' ? manual : (flow?.instruction ?? '')
    if (text === '') return
    void copyText(text).then(ok => {
      setManual(text)
      setNote(ok
        ? { tone: 'ok', text: t('distill.copied') }
        : { tone: 'warn', text: t('distill.copyFailed') })
    })
  }

  return createPortal(
    <div
      className="awu-scrim"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && phase === 'idle') onClose() }}
    >
      <div className="awu-dialog awu-distill-dialog" role="dialog" aria-modal="true" aria-label={t('distill.title')}>
        <div className="awu-dialogHead">
          <IconQuill size={16} />
          <span>{t('distill.title')}</span>
          <button
            type="button"
            className="awu-iconBtn awu-distill-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <IconClose size={14} />
          </button>
        </div>

        <div className="awu-dialogBody">
          <div className="awu-distill-why">{t('distill.why')}</div>

          <ol className="awu-distill-steps">
            <li><span className="awu-distill-num">1</span><span>{t('distill.step1')}</span></li>
            <li><span className="awu-distill-num">2</span><span>{t('distill.step2')}</span></li>
            <li><span className="awu-distill-num">3</span><span>{t('distill.step3')}</span></li>
          </ol>

          {flowError !== '' && <div className="awu-distill-warn" data-tone="danger">{flowError}</div>}

          <div className="awu-distill-sendRow">
            <button
              type="button"
              className="awu-btn"
              data-kind="primary"
              data-size="sm"
              onClick={onSend}
              disabled={phase !== 'idle' || flow === undefined || !ready}
              title={ready ? t('distill.send') : t('distill.noDock')}
            >
              <IconQuill size={12} />
              {ready ? t('distill.send') : t('distill.noDockShort')}
            </button>
            <button type="button" className="awu-btn" data-size="sm" onClick={onCopy} disabled={phase !== 'idle'}>
              {t('distill.copy')}
            </button>
          </div>

          {note !== undefined && (
            <div
              className="awu-distill-warn"
              data-tone={note.tone === 'err' ? 'danger' : note.tone === 'warn' ? 'warn' : 'ok'}
            >
              {note.text}
            </div>
          )}

          {manual !== '' && (
            <textarea
              className="awu-distill-paste"
              style={{ minHeight: 64 }}
              readOnly
              value={manual}
              onFocus={event => event.currentTarget.select()}
              aria-label={t('distill.copy')}
            />
          )}

          <div className="awu-distill-hint">{t('distill.noProgress')}</div>
        </div>

        <div className="awu-dialogFoot">
          <button type="button" className="awu-btn" data-size="sm" onClick={onClose} disabled={phase !== 'idle'}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 面板侧的「蒸馏」按钮：自带弹层，接线只需要一行。
 *
 * ```tsx
 * <DistillButton t={t} />
 * ```
 */
export function DistillButton(props: { t: Translate; label?: string }): JSX.Element {
  const { t, label } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="awu-btn"
        data-size="sm"
        data-kind="ghost"
        title={t('distill.entryTitle')}
        onClick={() => setOpen(true)}
      >
        <IconQuill size={12} />
        {label ?? t('distill.entry')}
      </button>
      {open && (
        <DistillDialog
          t={t}
          onClose={() => setOpen(false)}
          onDone={() => setOpen(false)}
        />
      )}
    </>
  )
}
