/**
 * AI WITH U · 动效基础模块（客户端）
 *
 * ⚠️ 单一真源约定：**CSS 侧对应 styles.ts 的 --awu-t-* / --awu-ease*，改这里必须同步那边。**
 *    （反之亦然：styles.ts 的令牌块顶部写了同一句。）
 *    为什么是两份数字：CSS 读不到 JS 常量，JS 也不该在运行时去 getComputedStyle 取时长
 *    —— 那会在首帧强制样式计算，我们已经在为合成层付钱了，不再加一笔。
 *    所以这里只做一件事：两边数值逐字相等，改一处就是改两处。
 *
 * 本文件只放「动效的纯逻辑」：
 *  - 时长/缓动常量（与 CSS 同名同值）
 *  - usePresence：延迟卸载（React 没有退出动画，这层壳把它补上）
 *  - useFinePointer：细指针 + 可悬停（第 2 批的指针跟随高光要用，先落地，零副作用）
 *  - prefersReducedMotion / prefersReducedTransparency：纯读取，SSR 安全
 *
 * 不引 React 之外的依赖；不碰 DOM 结构；不读写别的插件的 DOM（PLUGIN-DEV-GUIDE §2.6）。
 */
import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------- 时长（ms）
// 与 styles.ts 的 :180 一带逐项对应，顺序也一样。
/** 指针跟随 / press 回弹 / 图标微动 */
export const T_FAST = 120
/** hover、色变、焦点环：几乎所有"轻反馈"的默认档 */
export const T_BASE = 200
/** 层级内的位移（详情页 / 编辑器接管进入） */
export const T_MID = 240
/** 大层进入（面板 / sheet） */
export const T_ENTER = 320
/** 退场专用：永远比对应的进入快约 40%（用户已经在等它消失，不该再拖） */
export const T_EXIT = 160
/** 一次性扫光 / 大位移 */
export const T_SLOW = 600
/** 环境层：呼吸、辉光、骨架 shimmer（长到用户不会"读"它） */
export const T_AMBIENT = 3400

// ---------------------------------------------------------------- 缓动
/** 进入：iOS 弹簧收尾，全项目唯一的"主"曲线（= styles.ts 的 --awu-ease） */
export const EASE = 'cubic-bezier(.32,.72,0,1)'
/** 退场 / 位移收尾：起步快、尾巴长，适合"东西离开或落位" */
export const EASE_OUT = 'cubic-bezier(.22,1,.36,1)'
/** 收起 / 被删除：先慢后快，适合"塌陷、缩回" */
export const EASE_IN = 'cubic-bezier(.55,0,1,.45)'

// ---------------------------------------------------------------- 媒体查询：纯读取
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)'

/**
 * matchMedia 的安全包装。
 * 三种失败都要吞掉而不是抛：无 window（SSR / 构建期）、无 matchMedia（老 WebView）、
 * 查询串非法（部分浏览器对不认识的特性直接抛 TypeError）。
 */
function mediaQuery(query: string): MediaQueryList | undefined {
  if (typeof window === 'undefined') return undefined
  if (typeof window.matchMedia !== 'function') return undefined
  try {
    return window.matchMedia(query)
  } catch {
    return undefined
  }
}

/** 用户是否要求减弱动效。CSS 侧有对应的全局守卫（styles.ts 的 prefers-reduced-motion 段）。 */
export function prefersReducedMotion(): boolean {
  const list = mediaQuery(REDUCED_MOTION_QUERY)
  return list !== undefined && list.matches
}

/**
 * 用户是否要求减少透明。
 * 注意：Chromium 支持该特性，但"支持"不等于"会被触发"（默认 no-preference），
 * 所以这里只当开关用，绝不当代替 prefers-reduced-motion 的判据。
 */
export function prefersReducedTransparency(): boolean {
  const list = mediaQuery(REDUCED_TRANSPARENCY_QUERY)
  return list !== undefined && list.matches
}

/**
 * 是否"有指针且能悬停"（鼠标 / 触控板）。
 * 用来闸住 pointermove 类效果：触摸屏上 pointermove 只会在拖拽时零星触发，
 * 绑了只会白烧 CPU 并可能让滚动手势变慢。
 *
 * 首帧用 useState 的惰性初始化拿到媒体状态（不闪一次"未启用"），
 * 再在 effect 里重同步一次并订阅变化（用户中途插上鼠标也应生效）。
 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState<boolean>(() => {
    const list = mediaQuery(FINE_POINTER_QUERY)
    return list !== undefined && list.matches
  })

  useEffect(() => {
    const list = mediaQuery(FINE_POINTER_QUERY)
    if (list === undefined) return
    // 首帧与订阅之间媒体状态可能已经变过（外接鼠标刚插上），补一次
    setFine(list.matches)
    const onChange = (event: MediaQueryListEvent): void => { setFine(event.matches) }
    // addEventListener('change') 在 Safari 14 之前不存在，两条路径都必须清理干净
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange)
      return () => { list.removeEventListener('change', onChange) }
    }
    list.addListener(onChange)
    return () => { list.removeListener(onChange) }
  }, [])

  return fine
}

// ---------------------------------------------------------------- 延迟卸载
/** 层根节点的最小契约：只要能读到 current 即可（React 18/19 的 ref 对象都满足）。 */
export interface PresenceRoot {
  readonly current: HTMLElement | null
}

/** usePresence 的返回值。JSX 里用它挂 data-state，CSS 里用它挑退场规则。 */
export interface PresenceState {
  /** 是否应该留在 DOM 里（含退场期）。false → 调用方必须整块不渲染。 */
  mounted: boolean
  /** 是否正在退场。true 期间：挂 data-state="closing"、Esc 放行、pointer-events 关。 */
  closing: boolean
}

/**
 * 退场态的统一挂载属性。**用它，别手拼字符串**（拼错一个字母就是一条永不触发的 CSS）。
 *
 * JSX：<div className="awu-dialog" {...presenceAttrs(closing)} />
 * CSS：.awu-dialog[data-state="closing"] { animation: awu-exit ... both; }
 */
export function presenceAttrs(closing: boolean): { 'data-state': 'open' | 'closing' } {
  return { 'data-state': closing ? 'closing' : 'open' }
}

/**
 * 把焦点从 root 内部请出去（root 之外的焦点一概不动）。
 *
 * 为什么需要它：a11y.ts 的 useRestoreFocus 只在**真正卸载**时把焦点还给来处；
 * 而延迟卸载把"卸载"推后了 160ms，这段时间里焦点会停在一个 opacity 正在归零、
 * 且已经 pointer-events:none 的节点上 —— 屏幕阅读器念的是一个"看得见却在消失"的东西，
 * Tab 也会从虚空里继续走。所以退场一开始就要主动 blur。
 *
 * 只做 blur 不做事后回焦：回焦交给原来的 useRestoreFocus（时序：blur 先，卸载后回焦）。
 */
export function releaseFocusWithin(root: HTMLElement | null): void {
  if (root === null) return
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active === null) return
  if (!(active instanceof HTMLElement)) return
  if (!root.contains(active)) return
  active.blur()
}

/**
 * 延迟卸载：`open` 变 false 后先保留 DOM 一段时间（默认 160ms = T_EXIT），
 * 让 CSS 有机会把退场动画画完，再真正卸载。
 *
 * 五条时序契约（都是真机上会咬人的那种，改之前先读）：
 *
 * 1. **焦点提前释放**（本 hook 已实现，条件是传入 root）
 *    closing 的第一帧就 `releaseFocusWithin(root)`。不传 root 时调用方必须自己 blur，
 *    否则焦点会停在正在淡出的节点上（见 releaseFocusWithin 的注释）。
 *
 * 2. **滚动锁仍按"卸载"解锁**（调用方责任）
 *    `useScrollLock(true)` 的入参必须是 `mounted` 而不是 `open`。
 *    若跟着 open 走，遮罩还在淡出的 160ms 里就已经能滚到底层页面 —— 那是比"没退场动画"更糟的 bug。
 *
 * 3. **快速连开连关必须清 timer**（本 hook 已实现，双重保险）
 *    进入 effect 先清上一轮 timer；effect 的 cleanup 再清一次。
 *    否则"关了又立刻开"会被上一轮的 setTimeout 在一帧后从 DOM 里摘掉。
 *
 * 4. **closing 期间 escYield 必须放行**（调用方责任）
 *    本项目 Overlay 的 escYield 是为了"内层专注层吃掉 Esc"而设的。
 *    内层一旦进入 closing，它已经没有资格再吞 Esc 了：浏览器里 Esc 是"取消一切"的键，
 *    让用户按两下才关掉外层 = 明显的交互事故。→ 传 `escYield={presence.closing ? false : innerOpen}`。
 *
 * 5. **退出动画必须 animation-fill-mode: both**（CSS 责任，样式在 styles.ts 的退场基元段）
 *    否则动画跑完立即回到 opacity:1，用户看到"淡出→闪回来→消失"。
 *
 * 另：`prefers-reduced-motion: reduce` 时**直接卸载，不排 timer**。
 * 那种情况下 CSS 退场被全局守卫压到 0.01ms，等 160ms 只会变成"点了没反应"。
 */
export function usePresence(open: boolean, exitMs: number = T_EXIT, root?: PresenceRoot): PresenceState {
  const [mounted, setMounted] = useState<boolean>(open)
  const [closing, setClosing] = useState<boolean>(false)
  const timerRef = useRef<number | undefined>(undefined)
  const everMountedRef = useRef<boolean>(open)
  const mountedRef = useRef<boolean>(open)

  // 把 mounted 镜像进 ref：主 effect 不该依赖 state（否则每次卸载又会触发一轮 effect）
  useEffect(() => {
    mountedRef.current = mounted
  }, [mounted])

  useEffect(() => {
    // 契约 3：进门先清上一轮的 timer
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }

    if (open) {
      everMountedRef.current = true
      setMounted(true)
      setClosing(false)
      return
    }

    // 从未打开过（首帧就是关闭态）：没有退场可跑，也别留下 closing=true 的幽灵
    if (!everMountedRef.current) {
      setClosing(false)
      return
    }
    // 已经卸载完了（timer 已跑过）：不要因为 root/deps 变化就重新计一次时
    if (!mountedRef.current) return

    if (root !== undefined) releaseFocusWithin(root.current) // 契约 1

    const ms = prefersReducedMotion() ? 0 : exitMs
    if (ms <= 0) {
      setMounted(false)
      setClosing(false)
      return
    }

    setClosing(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      setMounted(false)
      setClosing(false)
    }, ms)

    return () => {
      // 契约 3 的闭环：effect 重建或组件卸载时都不留悬挂的 setState
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
    }
  }, [open, exitMs, root])

  return { mounted, closing }
}
