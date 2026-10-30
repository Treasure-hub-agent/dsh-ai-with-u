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
import type { JSX } from 'react'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'
import { IconBack } from './icons'

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
}

/** 按码点数字数（emoji 不算两字）。 */
function countChars(text: string): number {
  return [...text].length
}

export function FocusEditor(props: FocusEditorProps): JSX.Element {
  const { title, value, placeholder, readOnly = false, hint, warn = false, labels, onDone, onCancel } = props

  // 本地缓冲：打字期间只改这里，父组件零重渲染
  const [text, setText] = useState(value)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // 顺序不能换：先记「打开前焦点在哪」，再把焦点送进容器，最后拦 Tab。
  useRestoreFocus(true)
  useInitialFocus(rootRef, true, readOnly ? '.awu-focusRead' : '.awu-focusInput')
  useFocusTrap(rootRef, true)

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
    if (readOnly) { onCancel(); return }
    if (!dirty) { onCancel(); return }
    setConfirmDiscard(true)
  }, [dirty, onCancel, readOnly])

  const commit = useCallback(() => {
    if (readOnly) { onCancel(); return }
    onDone(text)
  }, [onCancel, onDone, readOnly, text])

  // Esc / Cmd+Enter：捕获阶段自己处理，壳层负责把 Esc 让给本层
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
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
  }, [commit, confirmDiscard, requestCancel])

  return (
    <div ref={rootRef} className="awu-focus" role="dialog" aria-modal="true" aria-label={title}>
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
          <button type="button" className="awu-btn" data-kind="danger" onClick={onCancel}>
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
