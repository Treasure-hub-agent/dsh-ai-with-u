/**
 * AI WITH U · 从作品蒸馏角色卡（v3：全自动落盘）
 *
 * 为什么是「发一条消息」而不是「加一个工具」：面板拿不到模型，只能把话递进会话；
 * 流程正文放随包发布的 `distill/flow.md`，指令里只给绝对路径 —— 正文永远不进 system prompt。
 *
 * v3（2026-10-30 22:1x，主人原话：「应该是 AI 直接完成到底直到卡落地保存，并且插件中可以直接读取到
 * 新卡，没必要让用户自己粘贴回来，那样太麻烦」）：
 *  - 流程变成 **arm → 发指令 → AI 自己跑完并调 `awu_card_save` 落盘**；
 *  - 弹层只剩两步：**确认** → **已发送**；粘贴框 / 校验视图 / `parseDistillCard` 接线全部删掉；
 *  - 面板靠轮询 `/characters` 看到新卡（Lead 侧实现），本文件不阻塞弹层、也不写盘。
 *
 * 三个组件：
 *  - `DockSink`   —— 挂在 `conversation.composer.dock` 的**无头**贡献：把 `inputActions` /
 *    `sessionId` / `useInput` 快照存进模块级 sink，供侧栏面板取用（`sidebar.footer.action`
 *    这个席位拿不到 `inputActions`，必须借会话作用域插槽转一手）。
 *  - `DistillDialog` / `DistillButton` / `DistillEntry` —— 面板侧的两步入场。
 *
 * 历史：同一位置的可见小入口 `DockEntry` 从未注册过（主人明确要求底部托盘不留蒸馏按钮），
 * 且要填的 `dock*` 文案一起成了死代码，已删除（2026-10-31，任务 3）。
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

import { armDistill, disarmDistill, errorText, fetchDistillFlow, fetchDistillState } from './api'
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
 * （没拿到指令，且 `/distill/flow` 兜底也失败），成功/失败都多了 `note` / `error`。
 */
export type SendResult =
  | { ok: true; mode: 'sent' | 'filled'; instruction: string; note?: 'busy' | 'no-submit' }
  | {
    ok: false
    reason: 'no-dock' | 'flow-failed' | 'insert-failed' | 'submit-failed'
    instruction: string
    error?: string
  }

/**
 * 把蒸馏指令发进当前会话：`insertText` → （可用则）`submit`。
 *
 * v3 起指令由调用方传入（`POST /distill/arm` 的返回值）——**arm 必须先做**，因为 AI 的落盘工具
 * 只在那个窗口内可用。传空时退回 `GET /distill/flow`（兜底：只把指令填进输入框，不参与正式流程）。
 *
 * 每一步都防御式：任何一步不成立都返回可操作的结果，绝不抛给面板、绝不假装发成功。
 */
export async function sendDistillInstruction(instructionInput?: string): Promise<SendResult> {
  let instruction = typeof instructionInput === 'string' ? instructionInput.trim() : ''
  if (instruction === '') {
    try {
      instruction = (await fetchDistillFlow()).instruction
    } catch (error) {
      return { ok: false, reason: 'flow-failed', instruction: '', error: errorText(error) }
    }
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

  /** 两步：确认 → 已发送。没有第三步，也不再接收任何粘贴内容。 */
  const [step, setStep] = useState<'confirm' | 'result'>('confirm')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | undefined>(undefined)
  const [manual, setManual] = useState('')
  const [savedNote, setSavedNote] = useState('')
  /** 指令是否真的发出去了 —— 决定关弹层时该 onDone() 还是 disarm()。 */
  const sentRef = useRef(false)

  useBodyScrollLock(true)

  // 开门先看一眼窗口状态：上一次刚存过卡就给一句上下文，别让用户以为要重来
  useEffect(() => {
    let alive = true
    void fetchDistillState()
      .then(state => {
        if (!alive) return
        const name = state.lastSaved?.name ?? ''
        if (name !== '') setSavedNote(t('distill.lastSaved', { name }))
      })
      .catch((error: unknown) => {
        // 状态接口只做锦上添花：读不到不影响主流程，但要留痕（禁止空 catch）
        console.error('[ai-with-u] 读 /distill/state 失败（不影响蒸馏）', error)
      })
    return () => { alive = false }
  }, [t])

  /**
   * 关闭：**没发出去就 disarm**，把这次窗口收掉（否则上一条 arm 会一直挂着）；
   * 发出去了才 onDone()，让外层刷新/收尾。
   */
  const close = useCallback((): void => {
    if (!sentRef.current) {
      void disarmDistill().catch((error: unknown) => {
        console.error('[ai-with-u] 取消蒸馏时 disarm 失败（不影响使用）', error)
      })
    } else {
      onDone()
    }
    onClose()
  }, [onClose, onDone])

  // Esc 关闭：正在 arm/send 时不关，避免用户以为发出去了其实还在跑
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [busy, close])

  const reasonText = (reason: 'no-dock' | 'flow-failed' | 'insert-failed' | 'submit-failed'): string => {
    if (reason === 'no-dock') return t('distill.noDock')
    if (reason === 'flow-failed') return t('distill.flowFailed')
    if (reason === 'insert-failed') return t('distill.insertFailed')
    return t('distill.submitFailed')
  }

  /**
   * 「开始蒸馏」= arm（开窗口拿指令）→ 发送通道 → 停在第二步如实回显。
   *
   * 顺序不能反：AI 的落盘工具只在 arm 出来的窗口内可用，先发指令再 arm 会让它存不了卡。
   */
  const onStart = (): void => {
    if (busy) return
    setBusy(true)
    setNote(undefined)
    setManual('')
    void (async () => {
      let instruction = ''
      try {
        instruction = (await armDistill()).instruction
      } catch (error) {
        setStep('result')
        setNote({ tone: 'err', text: t('distill.armFailed', { reason: errorText(error) }) })
        return
      }
      const sent = await sendDistillInstruction(instruction)
      setManual(sent.instruction)
      setStep('result')
      if (!sent.ok) {
        setNote({ tone: 'err', text: reasonText(sent.reason) })
        return
      }
      sentRef.current = true
      if (sent.mode === 'sent') setNote({ tone: 'ok', text: t('distill.sent') })
      else if (sent.note === 'busy') setNote({ tone: 'warn', text: t('distill.busyFilled') })
      else setNote({ tone: 'warn', text: t('distill.filled') })
    })().catch((error: unknown) => {
      setStep('result')
      setNote({ tone: 'err', text: errorText(error) })
    }).finally(() => setBusy(false))
  }

  const onCopy = (): void => {
    if (manual === '') return
    void copyText(manual).then(ok => {
      setNote({
        tone: ok ? 'ok' : 'warn',
        text: ok ? t('distill.copied') : t('distill.copyFailed'),
      })
    })
  }

  const failed = note !== undefined && note.tone === 'err'

  return createPortal(
    <div
      className="awu-scrim"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) close() }}
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
            onClick={close}
            disabled={busy}
          >
            <IconClose size={14} />
          </button>
        </div>

        <div className="awu-dialogBody">
          {step === 'confirm' ? (
            <>
              <div className="awu-distill-why">{t('distill.why')}</div>

              <ol className="awu-distill-steps">
                <li><span className="awu-distill-num">1</span><span>{t('distill.step1')}</span></li>
                <li><span className="awu-distill-num">2</span><span>{t('distill.step2')}</span></li>
                <li><span className="awu-distill-num">3</span><span>{t('distill.step3')}</span></li>
              </ol>

              {savedNote !== '' && <div className="awu-distill-warn" data-tone="ok">{savedNote}</div>}
              {!ready && <div className="awu-distill-warn" data-tone="warn">{t('distill.noDock')}</div>}

              <div className="awu-distill-hint">{t('distill.savedHint')}</div>
            </>
          ) : (
            <>
              {note !== undefined && (
                <div
                  className="awu-distill-status"
                  data-tone={note.tone === 'err' ? 'danger' : note.tone === 'warn' ? 'warn' : 'ok'}
                >
                  {note.text}
                </div>
              )}

              {!failed && <div className="awu-distill-hint">{t('distill.savedHint')}</div>}

              {failed && manual !== '' && (
                <>
                  <label className="awu-label" htmlFor="awu-distill-manual">{t('distill.copy')}</label>
                  <textarea
                    id="awu-distill-manual"
                    className="awu-distill-paste"
                    style={{ minHeight: 72 }}
                    readOnly
                    value={manual}
                    onFocus={event => event.currentTarget.select()}
                  />
                </>
              )}

              <div className="awu-distill-hint">{t('distill.noProgress')}</div>
            </>
          )}
        </div>

        <div className="awu-dialogFoot">
          {step === 'confirm' ? (
            <>
              <button type="button" className="awu-btn" onClick={close} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="awu-btn"
                data-kind="primary"
                onClick={onStart}
                disabled={busy || !ready}
                title={ready ? t('distill.start') : t('distill.noDock')}
              >
                <IconQuill size={13} />
                {busy ? t('common.busy') : ready ? t('distill.start') : t('distill.noDockShort')}
              </button>
            </>
          ) : (
            <>
              {failed && manual !== '' && (
                <button type="button" className="awu-btn" onClick={onCopy}>
                  {t('distill.copy')}
                </button>
              )}
              <button type="button" className="awu-btn" data-kind="primary" onClick={close}>
                {t('distill.done')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 面板侧的「蒸馏角色卡」主入口按钮：自带弹层，接线只需要一行。
 *
 * 2026-10-30 视觉反馈后重做（主人原话：「'蒸馏'按钮在面板上有些小了不明显」）：
 *  - 从 `data-size="sm"` + `data-kind="ghost"`（被「新建角色」压住的小字）改成 **默认尺寸 + primary**；
 *  - 文案从「蒸馏」改成完整的「蒸馏角色卡」（`distill.title`），图标保留；
 *  - **不写死尺寸/颜色**：尺寸与配色全部交给 `data-*` 和 `awu-distill-*` 类，面板从 452px 改到 720px
 *    大窗、以及液态玻璃视觉都不需要动这个组件。
 *
 * ```tsx
 * <DistillButton t={t} />          // 只要按钮
 * <DistillEntry t={t} />           // 按钮 + 一行说明（角色簿顶部的独立一块，推荐）
 * ```
 */
export function DistillButton(props: { t: Translate; label?: string }): JSX.Element {
  const { t, label } = props
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="awu-btn awu-distill-cta"
        data-kind="primary"
        title={t('distill.entryTitle')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <IconQuill size={14} />
        {label ?? t('distill.title')}
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

/**
 * 角色簿顶部的**独立一块**：主 CTA + 一行极短说明。
 *
 * 为什么单独做一个组件而不是把说明塞进 `DistillButton`：按钮可以在工具行里内联用，
 * 而「CTA + 说明」是块级排版（`awu-distill-entry` 用 flex 竖排，宽度随容器走），两者共用一个按钮。
 *
 * 文案回退：`distill.entryHint` 还没并进 `client/text.ts` 时，`makeTranslator` 会把 key 原样返回
 * （`text.ts` 的兜底行为），这里检测到「原样返回」就退到已有的 `distill.entryTitle`，
 * 保证在 Lead 合并文案之前界面上也不会出现裸 key。
 */
export function DistillEntry(props: { t: Translate; label?: string }): JSX.Element {
  const { t, label } = props
  const raw = t('distill.entryHint')
  const hint = raw === 'distill.entryHint' ? t('distill.entryTitle') : raw
  return (
    <div className="awu-distill-entry">
      <DistillButton t={t} label={label} />
      <div className="awu-distill-entryHint">{hint}</div>
    </div>
  )
}
