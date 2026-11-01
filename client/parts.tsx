/**
 * AI WITH U · 面板共享零件（无面板状态依赖）
 *
 * 这里只放「任何一层弹层/任何一屏都能直接用」的纯零件：滚动锁、弹层壳、骨架屏、错误条、
 * 字段行与分组块。判断标准：**不读 CharacterPanel 的任何 state、不调 api、不碰面板编排**。
 *
 * 为什么单独成文件（2026-11-02 收尾轮）：
 *  - `distill.tsx` 里还有一份自建的 scrim + dialog 副本（第 3 批要换回这里的 `Overlay`），
 *    它不能 import `index.tsx`（那边 import 了 distill，会成环）——零件必须住在一个双方都能引的叶子模块；
 *  - `index.tsx` 已经 4000+ 行，把「与业务无关的壳」拆走能少一层认知负担。
 *
 * 依赖纪律：只允许 import `a11y` / `motion` / `icons` / `text` / `dragdrop` 这类叶子模块。
 * **禁止 import `./index`**（循环依赖；构建期不一定报错，运行期会拿到 undefined 组件）。
 */
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'
import { resetHostDropState, swallowFileDrag } from './dragdrop'
import { IconAlert } from './icons'
import { T_ENTER, presenceAttrs, releaseFocusWithin } from './motion'
import type { Translate } from './text'

/**
 * 滚动锁：弹层打开时锁住 body 滚动，关掉立刻还原。
 *
 * 注意调用时机（契约 §2.2 时序 2）：传的是 **mounted** 而不是 open。
 * 退场那 160ms 里如果就解锁，遮罩还在淡出、底层页面却能滚了，比没有退场更糟。
 */
export function useScrollLock(active: boolean): void {
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
 * 弹层「正在退场」的广播。
 *
 * 为什么用 context 而不是 prop：`Overlay` 有 9 处调用点（7 个确认/表单弹层 +
 * preview + preset），逐个传 closing 既啰嗦又容易漏；而退场状态本来就是
 * 「宿主这一批弹层」共享的，context 是它正确的粒度。
 */
export const DialogLayerContext = createContext<boolean>(false)

/**
 * 弹层通用行为：Esc 关闭 + 点击遮罩关闭 + 焦点陷阱（Tab 不出去、关闭后焦点回原位）。
 *
 * 另外**吞掉落在弹层上的文件拖放**：`.awu-scrim` 是 fixed 全屏遮罩，用户拖一张卡进来时
 * 目标就是它，但事件会继续冒到宿主 composer，图片会被当成附件发出去（真机踩过）。
 * `swallowFileDrag` 现在还会在 drop 时复位宿主的拖放计数器（否则聊天区遮罩会永久卡死，
 * 见 `dragdrop.ts` 文件头），拖放区在内层先接住，所以真正的拖放不受影响。
 */
export function Overlay(props: {
  label: string
  onClose: () => void
  children: JSX.Element | JSX.Element[]
  /** 弹层里「没落在拖放区上」的文件：默认只是吞掉；传了就顺手回调（用于给一句提示） */
  onFilesDropped?: (files: FileList) => void
  /**
   * 「本层要先吃 Esc」：为 true 时 Overlay 的 Esc 处理**直接 return**，把 Esc 让给层内。
   *
   * 语义是「谁该处理这次 Esc」，不只等于「专注编辑层开着」（2026-11-02 与 preset 侧对齐）：
   * 内层会自己处理的情形至少三种 —— 模块专注编辑层打开、有未保存改动、
   * 丢弃确认弹着；三种都要求 Esc 先由内层消费（比如先弹「放弃改动？」），
   * 否则一次 Esc 会同时触发内层下线与 `onClose`，未保存的编辑无声全丢。
   *
   * 所以调用方（目前是 preset 的 `onFocusLayerChange`）给的是一个**汇总后的布尔**，
   * 而不是「专注层开关」本身。约定见 `editor-focus.tsx:12-13`，
   * 正确做法参照 `card-editor.tsx` 的 loreFocus 让位。
   */
  escYield?: boolean
}): JSX.Element {
  const { label, onClose, children, onFilesDropped, escYield = false } = props
  const boxRef = useRef<HTMLDivElement | null>(null)
  /**
   * 退场态由宿主（CharacterPanel 的弹层宿主）通过 context 广播：
   * `closing` 期间这一层还在 DOM 里跑 160ms 退场动画，但已经不该再吃 Esc / 抢焦点。
   * 滚动锁仍然按 **mounted** 走（`useScrollLock(true)`，卸载时才解）。
   */
  const closing = useContext(DialogLayerContext)
  const scrimRef = useRef<HTMLDivElement | null>(null)

  /**
   * scrim 与 dialog 的**回调 ref**：commit 阶段同步挂 `data-still="true"`
   * （契约 §6：带着它渲染 = 这次进入不 blur；effect 补会晚一帧，等于没做）。
   * 摘除由下面的 effect 负责（animationend + 兜底 timer）。
   */
  const attachScrim = useCallback((node: HTMLDivElement | null): void => {
    scrimRef.current = node
    if (node !== null) node.setAttribute('data-still', 'true')
  }, [])
  const attachBox = useCallback((node: HTMLDivElement | null): void => {
    boxRef.current = node
    if (node !== null) node.setAttribute('data-still', 'true')
  }, [])

  useScrollLock(true)

  // 焦点顺序不能换：先记回来处 → 再把焦点送进容器 → 最后拦 Tab。
  useRestoreFocus()
  useInitialFocus(boxRef, true)
  useFocusTrap(boxRef, true)
  // 退场第一帧就把焦点请出去：否则焦点停在正在归零、且 pointer-events:none 的节点上
  useEffect(() => {
    if (closing) releaseFocusWithin(boxRef.current)
  }, [closing])

  /** 首帧的 data-still 由回调 ref 挂上；这里在入场动画结束（或 320ms 兜底）后摘掉。 */
  useEffect(() => {
    const nodes = [scrimRef.current, boxRef.current].filter((el): el is HTMLDivElement => el !== null)
    const clear = (event: AnimationEvent): void => {
      if (event.target instanceof HTMLElement) event.target.removeAttribute('data-still')
    }
    for (const node of nodes) node.addEventListener('animationend', clear)
    const fallback = window.setTimeout(() => {
      for (const node of nodes) node.removeAttribute('data-still')
    }, T_ENTER + 60)
    return () => {
      window.clearTimeout(fallback)
      for (const node of nodes) node.removeEventListener('animationend', clear)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 退场中不再响应 Esc（这一层已经在走了，再 close 一次只会重置计时）
        if (closing) return
        // 内层专注编辑层开着：Esc 归它，壳层什么都不做（也不 stopPropagation，
        // 内层自己会 stop；不同文档级监听靠注册顺序不会互相拦掉）。
        if (escYield) return
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, escYield, closing])

  // 兜底：弹层卸载时再复位一次——万一拖放在中途被别的东西吃掉（Esc、焦点切换）
  // 没走到 drop，宿主的计数器也得有人归零
  useEffect(() => () => { resetHostDropState() }, [])

  return createPortal(
    <div
      ref={attachScrim}
      className="awu-scrim"
      role="presentation"
      /* scrim 与 dialog 都要挂 data-state：只挂 dialog 的话遮罩层会硬切消失（契约 §2.2） */
      {...presenceAttrs(closing)}
      onMouseDown={event => {
        if (event.target === event.currentTarget && !closing) onClose()
      }}
      onDragOver={swallowFileDrag}
      onDrop={event => {
        swallowFileDrag(event)
        const files = event.dataTransfer?.files
        if (files !== undefined && files.length > 0) onFilesDropped?.(files)
      }}
    >
      <div
        ref={attachBox}
        className="awu-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={closing ? true : undefined}
        {...presenceAttrs(closing)}
      >
        {/* TODO（第 3 批）：`distill.tsx:483` 还有一份自建的 scrim + dialog 副本，
            退场属性得两边同步；第 3 批把它换回这里的 Overlay 之后这段注释可删。 */}
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * 骨架屏。`shape` 交给 CSS 决定形态（`data-shape`）：
 *  - `detail`（默认）：详情页那种竖排行；
 *  - `cards`：角色簿加载时的卡片网格，避免加载完从 62px 竖条突然跳成两列卡片。
 *
 * `closing` 由调用方的 `usePresence` 驱动：退场 160ms 只动 opacity，到点再真正卸载。
 */
export function Skeleton(props: { shape?: 'detail' | 'cards'; label?: string; closing?: boolean }): JSX.Element {
  return (
    <div
      className="awu-sk"
      data-shape={props.shape ?? 'detail'}
      role="status"
      aria-live="polite"
      aria-hidden={props.closing === true ? true : undefined}
      /* 退场 160ms：由调用方的 usePresence 决定何时真正卸载（契约 §2.2） */
      {...presenceAttrs(props.closing === true)}
    >
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {props.label ?? '载入中…'}
      </span>
      <div className="awu-skRow" />
      <div className="awu-skRow" />
      <div className="awu-skRow" />
    </div>
  )
}

/** 错误条：与状态带共用几何（alert 态），重试按钮可选。 */
export function ErrorBar(props: { message: string; onRetry?: () => void; t: Translate }): JSX.Element {
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
export function Field({ k, v, title }: { k: string; v: string; title?: string }): JSX.Element {
  return (
    <div className="awu-field">
      <span className="awu-fieldKey" title={title ?? k}>{k}</span>
      <span className="awu-fieldVal">{v}</span>
    </div>
  )
}

/** 分段字段（性格/声音/关系）的小节。 */
export function Section(props: {
  title: string
  count?: number
  children: JSX.Element | JSX.Element[] | null
}): JSX.Element {
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
