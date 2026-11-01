/**
 * AI WITH U · 专注编辑层（长文本整屏编辑）
 *
 * 解决两个问题（见 `docs/design/2026-10-30-tavern-editor.md` §4）：
 *
 *  1. **手感**：编辑器每敲一个字都会在顶层做一次整卡 `JSON.stringify` + `mergeCard` + 全树重渲染。
 *     这一层把文本先收进**本地缓冲**，打字期间父组件一次都不重渲染，关层时才提交。
 *  2. **视野**：超过阈值的长文本不再挤在 240px 的 textarea 里滚，而是占满面板高度、
 *     560-760 的舒适行宽（`--awu-content-max`）。
 *
 * 焦点：自带「还焦 → 初始聚焦 → 焦点陷阱」三件套（复用 `client/a11y.ts` 的栈），
 * 因此壳层不需要为它再加 hook；壳层的 Esc 处理必须在 `focusKey !== null` 时直接 return，
 * 把 Esc 让给本层（否则会一次关两层）。
 *
 * 文案全部由 props 传入（`labels` / `hint`），本组件不依赖 `text.ts` 的键，
 * 便于先落地组件、后合字典。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MutableRefObject } from 'react'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'
import { IconBack } from './icons'
import { T_BASE, T_EXIT, presenceAttrs, usePresence } from './motion'
import type { PresenceRoot } from './motion'

export interface FocusEditorLabels {
  /** 返回（同「取消」） */
  back: string
  /** 完成（写回） */
  done: string
  /** 字数：`(count) => '2,140 字'` */
  chars: (count: number) => string
  /** 丢弃确认标题 */
  discardTitle: string
  /** 继续编辑 */
  keepEditing: string
  /** 丢弃 */
  discard: string
}

export interface FocusEditorProps {
  /** 字段名（已翻译） */
  title: string
  /** 打开时的初始值 */
  value: string
  placeholder?: string
  /** 只读模式（CCv3 导出预览里看长段落） */
  readOnly?: boolean
  /** 底部提示（已翻译）；不传则不显示 */
  hint?: string
  /** 提示是否为"警告"语气（变色，不阻断） */
  warn?: boolean
  labels: FocusEditorLabels
  /** 点「完成」或 Cmd/Ctrl+Enter：把缓冲写回 */
  onDone: (next: string) => void
  /** 点「返回」/Esc：丢弃缓冲 */
  onCancel: () => void
  /**
   * 本层**开始退场**（不是"已经卸载"）。
   *
   * 父级据此把「Esc 让位」立刻放行：契约 §2.2-契约 4 —— closing 期间这层已经没有资格再吃 Esc，
   * 否则用户要按两下才能关掉外层（一次给 dying 的层，一次给外层）。
   * 父级拿不到这个信号时也能工作，只是那 160ms 里 Esc 会被白白吞掉。
   */
  onClosing?: () => void
}

/** 按码点数字数（emoji 不算两字）。 */
function countChars(text: string): number {
  return [...text].length
}

// ---------------------------------------------------------------- 图层退场（本模块承载）
/*
 * 为什么两个小动效 helper 放在**本文件**：第 3 批的写域是六个组件文件，其中
 * `editor-focus.tsx` 是唯一的**叶子**（只依赖 a11y / icons / motion，没有任何组件模块引用它以外的
 * 兄弟模块对外暴露的组件），所以把共享 helper 放这里不会产出循环依赖：
 *   `card-editor.tsx` → `editor-focus.tsx`  ✔ 无环
 * 放进 `motion.ts` 不行（那是第 2 批独占的动效基础模块，只做纯逻辑 + 通用 presence），
 * 放进 `card-editor.tsx` 会形成 `lorebook-editor → editor-focus → card-editor → lorebook-editor` 的环。
 */

/** `useLayerExit` 的返回值。 */
export interface LayerExit {
  /** 根节点是否还该留在树上。False = 退场期已结束，父级可以真卸载了。 */
  mounted: boolean
  /** 正在退场：把它展开成 `presenceAttrs(closing)` 挂到根节点。 */
  closing: boolean
  /** 已经点过退场（退场期内的重复点击/连按 Esc 一律忽略）。 */
  leaving: boolean
  /**
   * 开始退场。`exit` 是**真正卸载的那一刻**要执行的收尾（默认用 `onExit`）。
   * 不传 exit 时执行 hooks 入参里的 `onExit`。
   */
  beginLeave: (exit?: () => void) => void
}

/**
 * 图层退场：把「卸载」推迟 `T_EXIT`(160ms)，让 CSS 有机会把 `[data-state="closing"]` 画完。
 *
 * 为什么必须推迟：本批三层（`.awu-editor` / `.awu-focus` / `.awu-editorConfirm`）的**挂载权都在父级**
 * （`index.tsx` 的 `editing`、世界书/预设的 `focusIndex`）。组件里直接调父级回调 = 立刻卸载 =
 * 动画对象当场消失，退场动画永远播不出来。所以这里把回调排队到 presence 结束再执行。
 *
 * 与 `usePresence` 的分工：presence 只回答「现在该不该在树上」；本 hook 负责
 * 「把父级的卸载动作挪到 presence 结束之后」，并保证只执行一次（`doneRef`）。
 * `prefers-reduced-motion` 时 `usePresence` 直接给 `mounted=false`，于是这里同一个 effect
 * 立刻收尾 —— 没有 160ms 的空等，符合契约 §4。
 *
 * `root` 传给 presence 后，退场第一帧就会 `releaseFocusWithin`（焦点不会停在正在淡出的节点上）。
 */
export function useLayerExit(onExit: () => void, root?: PresenceRoot): LayerExit {
  const [leaving, setLeaving] = useState(false)
  const pendingExitRef = useRef<(() => void) | undefined>(undefined)
  const doneRef = useRef(false)
  const presence = usePresence(!leaving, T_EXIT, root)

  const beginLeave = useCallback((exit?: () => void): void => {
    if (doneRef.current || pendingExitRef.current !== undefined) return
    pendingExitRef.current = exit
    setLeaving(true)
  }, [])

  useEffect(() => {
    // `mounted` 初始为 true（图层刚打开），这里只在退场期跑完之后收尾
    if (presence.mounted || doneRef.current) return undefined
    doneRef.current = true
    const exit = pendingExitRef.current
    pendingExitRef.current = undefined
    // onExit 的身份每次 render 都可能变，用 ref 之外的方式兜住重复调用由 doneRef 负责
    ;(exit ?? onExit)()
    return undefined
    // 只认 mounted 的变化：onExit 进依赖是为了拿到最新的闭包，doneRef 保证不会重复执行
  }, [presence.mounted, onExit])

  return { mounted: presence.mounted, closing: presence.closing, leaving, beginLeave }
}

/**
 * `data-still` 的两端：**commit 阶段**给根节点挂上（首帧就带，这一帧不做 blur），
 * 入场动画结束（或 `holdMs` 兜底）后摘掉。
 *
 * 为什么不能用 effect 挂：passive effect 在首帧之后才跑，那时 CSS 已经开始画 blur 了，
 * 「带着 data-still 渲染 = 这次进入不要 blur」这条语义就失效（同 index.tsx 面板根的写法）。
 *
 * `holdMs` 兜底必须有：`prefers-reduced-motion` 把时长压到 0.01ms 后 `animationend` 可能压根不来，
 * 属性留在上面 = `backdrop-filter` 永久关掉 + `will-change` 常驻。
 */
export function useStillAttr<T extends HTMLElement>(
  ref: MutableRefObject<T | null>,
  holdMs: number,
): (node: T | null) => void {
  /**
   * 节点身份单独存一份 state，而不是只在 effect 里读 `ref.current`。
   *
   * 为什么：图层**条件挂载**时（`.awu-editorConfirm` 就是这样），effect 第一次跑在父组件挂载的那一帧，
   * 那时 `ref.current` 还是 null，而 deps 不会再变 → 监听与兜底定时器**一个都装不上**，
   * 结果 `data-still` 由 ref 回调挂上去后再也没人摘（实测：确认层 400ms 后仍是 true，blur 被永久关掉）。
   * 用 state 存节点身份，节点出现/消失都会让 effect 重跑，两个图层形态都覆盖。
   */
  const [node, setNode] = useState<T | null>(null)

  const attach = useCallback((next: T | null): void => {
    ref.current = next
    if (next !== null) next.setAttribute('data-still', 'true')
    setNode(next)
  }, [ref])

  useEffect(() => {
    const el = node
    if (el === null) return undefined
    const clear = (): void => { el.removeAttribute('data-still') }
    // 只认根节点自己的动画：子元素的 animationstart/end 会冒上来，不过滤会把 blur 提前摘掉
    const onStart = (event: AnimationEvent): void => {
      if (event.target === el) el.setAttribute('data-still', 'true')
    }
    const onEnd = (event: AnimationEvent): void => {
      if (event.target === el) clear()
    }
    el.addEventListener('animationstart', onStart)
    el.addEventListener('animationend', onEnd)
    const fallback = window.setTimeout(clear, holdMs)
    return () => {
      window.clearTimeout(fallback)
      el.removeEventListener('animationstart', onStart)
      el.removeEventListener('animationend', onEnd)
      clear()
    }
  }, [holdMs, node])

  return attach
}


export function FocusEditor(props: FocusEditorProps): JSX.Element {
  const { title, value, placeholder, readOnly = false, hint, warn = false, labels, onDone, onCancel, onClosing } = props

  // 本地缓冲：打字期间只改这里，父组件零重渲染
  const [text, setText] = useState(value)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * 退场：`onCancel` 放到 presence 结束之后再调，否则父级当场卸载、`.awu-focus` 的
   * `[data-state="closing"]` 永远播不出来。`onDone` 那条路（写完提交）同理。
   */
  const layerExit = useLayerExit(onCancel, rootRef)
  const attachRoot = useStillAttr(rootRef, T_BASE + 60)

  // 顺序不能换：先记「打开前焦点在哪」，再把焦点送进容器，最后拦 Tab。
  //
  // 退场期把陷阱关掉（Tab 不该再被一个正在淡出的节点抢走）；还焦仍由 `useRestoreFocus(true)`
  // 在真正卸载时执行 —— 那里才是「焦点该回到开头那个按钮」的时刻。
  useRestoreFocus(true)
  useInitialFocus(rootRef, true, readOnly ? '.awu-focusRead' : '.awu-focusInput')
  useFocusTrap(rootRef, !layerExit.leaving)

  /** 走退场：先通知父级「本层不再吃 Esc」，再把真正的卸载动作排到 160ms 后。 */
  const beginLeave = useCallback((exit?: () => void): void => {
    // 契约 §2.2-契约 4：closing 期间 escYield 必须放行，否则用户要按两下才能关外层
    onClosing?.()
    if (exit === undefined) layerExit.beginLeave()
    else layerExit.beginLeave(exit)
  }, [layerExit, onClosing])

  const count = useMemo(() => countChars(text), [text])
  const dirty = text !== value

  // 打开时把光标推到末尾（继续写而不是从头改）
  useEffect(() => {
    if (readOnly) return
    const el = inputRef.current
    if (el === null) return
    try {
      el.setSelectionRange(el.value.length, el.value.length)
    } catch {
      // 某些内核在没聚焦时不允许 setSelectionRange，忽略即可
    }
  }, [readOnly])

  const requestCancel = useCallback(() => {
    if (readOnly || !dirty) { beginLeave(); return }
    setConfirmDiscard(true)
  }, [beginLeave, dirty, readOnly])

  const commit = useCallback(() => {
    if (readOnly) { beginLeave(); return }
    beginLeave(() => { onDone(text) })
  }, [beginLeave, onDone, readOnly, text])

  // Esc / Cmd+Enter：捕获阶段自己处理，壳层负责把 Esc 让给本层
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 退场期的 160ms 里什么都不再接：这层已经在消失，Esc 该落到外层去了
      if (layerExit.leaving) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (confirmDiscard) { setConfirmDiscard(false); return }
        requestCancel()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        commit()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [commit, confirmDiscard, layerExit.leaving, requestCancel])

  return (
    <div
      ref={attachRoot}
      className="awu-focus"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      {...presenceAttrs(layerExit.closing)}
    >
      <header className="awu-focusHead">
        <button
          type="button"
          className="awu-navBack"
          onClick={requestCancel}
          aria-label={labels.back}
          title={labels.back}
        >
          <IconBack size={13} />
          <span>{labels.back}</span>
        </button>
        <span className="awu-focusTitle" title={title}>{title}</span>
        <span className="awu-focusCount">{labels.chars(count)}</span>
        {!readOnly && (
          <button type="button" className="awu-btn" data-kind="primary" onClick={commit}>
            {labels.done}
          </button>
        )}
      </header>

      <div className="awu-focusBody">
        {readOnly ? (
          <div className="awu-focusRead" tabIndex={0}>{text}</div>
        ) : (
          <textarea
            ref={inputRef}
            className="awu-focusInput"
            value={text}
            placeholder={placeholder ?? ''}
            spellCheck={false}
            onChange={event => setText(event.target.value)}
          />
        )}
      </div>

      {confirmDiscard ? (
        <footer className="awu-focusFoot">
          <span className="awu-focusHint">{labels.discardTitle}</span>
          <button type="button" className="awu-btn" onClick={() => setConfirmDiscard(false)}>
            {labels.keepEditing}
          </button>
          <button type="button" className="awu-btn" data-kind="danger" onClick={() => beginLeave()}>
            {labels.discard}
          </button>
        </footer>
      ) : hint !== undefined && hint !== '' ? (
        <footer className="awu-focusFoot">
          <span className="awu-focusHint" data-over={warn ? 'true' : 'false'}>{hint}</span>
        </footer>
      ) : null}
    </div>
  )
}
