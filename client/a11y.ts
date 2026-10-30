/**
 * AI WITH U · 焦点管理（无障碍 A1 / A2 / A3）
 *
 * 为什么单独一个文件：`index.tsx` 的弹层与 `card-editor.tsx` 的编辑器分属两位写者，
 * 焦点逻辑只写一份，两边共用同一套语义（谁在最上层谁接管 Tab、关闭后焦点回原位）。
 *
 * 三个 hook 的职责严格分开，组合顺序有讲究：
 *
 * ```ts
 * useRestoreFocus()                 // ① 先记下「打开前焦点在哪」（必须在别人抢焦点之前）
 * useInitialFocus(boxRef, true)     // ② 再把焦点送进容器
 * useFocusTrap(boxRef, true)        // ③ 最后拦住 Tab
 * ```
 *
 * 嵌套（编辑器 → 未保存确认）靠模块级栈解决：后打开的层压栈，只有栈顶那一层处理 Tab；
 * 关掉上一层后，下一层自动恢复接管。
 *
 * 容错原则：所有 DOM / 焦点 API 都包 try/catch。浏览器差异（旧内核不支持
 * `focus({preventScroll})`、宿主策略禁用 focus、弹层恰好在动画中间被卸载）只
 * `console.warn` 一条，**绝不允许把异常抛进 React 渲染**。
 */
import { useEffect } from 'react'
import type { RefObject } from 'react'

/** 可聚焦元素。`disabled` 直接写进选择器，省得每轮再判断一遍属性。 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 焦点层栈：后进先出，只有栈顶处理 Tab。 */
const trapStack: HTMLElement[] = []

/** 统一的告警出口：带插件前缀，方便在宿主 renderer 日志里捞。 */
function warn(where: string, error: unknown): void {
  console.warn(`[ai-with-u] ${where}失败，已跳过`, error)
}

/** 聚焦并尽量不引起滚动跳动；老内核不支持 FocusOptions 时回退到无参调用。 */
function focusElement(element: HTMLElement | null): boolean {
  if (element === null) return false
  try {
    element.focus({ preventScroll: true })
    return true
  } catch (error) {
    warn('聚焦（preventScroll）', error)
  }
  try {
    element.focus()
    return true
  } catch (error) {
    warn('聚焦', error)
    return false
  }
}

/** 当前焦点元素；读不到就当作没有。 */
function currentFocus(): HTMLElement | null {
  try {
    return document.activeElement instanceof HTMLElement ? document.activeElement : null
  } catch (error) {
    warn('读取当前焦点', error)
    return null
  }
}

/** 容器内「看得见」的可聚焦元素（`display:none` / 未布局的元素会被 `getClientRects` 排除）。 */
function visibleItems(root: HTMLElement): HTMLElement[] {
  try {
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    return items.filter(item => {
      try {
        return item.getClientRects().length > 0
      } catch (error) {
        warn('测量可聚焦元素', error)
        return true
      }
    })
  } catch (error) {
    warn('查询可聚焦元素', error)
    return []
  }
}

/** 栈顶容器；栈空时返回 `null`（正常流程不会空着还收到 Tab）。 */
function stackTop(): HTMLElement | null {
  return trapStack.length === 0 ? null : (trapStack[trapStack.length - 1] ?? null)
}

/** 把 `root` 从栈里摘掉（按最后一次出现的位置，容忍重复压栈）。 */
function popTrap(root: HTMLElement): void {
  const at = trapStack.lastIndexOf(root)
  if (at >= 0) trapStack.splice(at, 1)
}

// ---------------------------------------------------------------- ① 还焦

/**
 * 记住「激活前焦点在哪」，在 `active` 变回 false（或组件卸载）时还回去。
 *
 * - 元素已被移出 DOM（`isConnected === false`）就跳过，不把焦点丢给 `body`；
 * - 打开前的焦点是 `body`（鼠标点击空白处等）时不记录，避免关闭后焦点莫名落到 body；
 * - **必须在同一组 hook 里最先调用**，否则记录到的是被 `useInitialFocus` 挪走之后的焦点。
 */
export function useRestoreFocus(active = true): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const previous = currentFocus()
    const restoreTo = previous !== null && previous !== document.body ? previous : null
    return () => {
      if (restoreTo === null) return
      try {
        if (restoreTo.isConnected && !restoreTo.hasAttribute('disabled')) focusElement(restoreTo)
      } catch (error) {
        warn('恢复焦点', error)
      }
    }
  }, [active])
}

// ---------------------------------------------------------------- ② 初始聚焦

/**
 * 打开时把焦点送进容器：
 * 显式 `selector` → `[autofocus]` → 第一个可见可聚焦元素 → 容器自身（补 `tabindex="-1"`）。
 *
 * 两条保护：
 * 1. 子组件已经自己聚焦（三个弹层里的输入框）时不再抢——`activeElement` 已在容器内就退出；
 *    子组件的 effect 比这里晚跑也没关系，它们会落到同一个输入框上。
 * 2. 容器不存在（条件渲染的 ref 还是 null）时静默跳过，等下次 `active` 变化再试。
 */
export function useInitialFocus<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  selector?: string,
): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const root = ref.current
    if (root === null) return undefined
    try {
      const explicit = selector === undefined ? null : root.querySelector<HTMLElement>(selector)
      const focused = currentFocus()
      const alreadyInside = focused !== null && root.contains(focused)
      if (explicit === null && alreadyInside) return undefined
      const target = explicit ?? root.querySelector<HTMLElement>('[autofocus]') ?? visibleItems(root)[0] ?? null
      if (target !== null) {
        focusElement(target)
        return undefined
      }
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      focusElement(root)
      return undefined
    } catch (error) {
      warn('初始聚焦', error)
      return undefined
    }
  }, [ref, active, selector])
}

// ---------------------------------------------------------------- ③ 焦点陷阱

/**
 * Tab / Shift+Tab 在容器内循环；焦点跑到容器外（鼠标点到别处）时，下一次 Tab 会拉回边界。
 *
 * - 只处理 `Tab`，**Esc 交给调用方**（`Overlay` 与 `CardEditor` 都有各自的 Esc 逻辑，
 *   trap 再拦一次会打乱它们的「有改动先确认」判断）；
 * - 嵌套时只有栈顶处理，避免上下两层同时 `preventDefault` 抢焦点；
 * - 容器里一个可聚焦元素都没有时，Tab 原地不动（`preventDefault`），不会逃出去。
 */
export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const root = ref.current
    if (root === null) return undefined

    const onKey = (event: KeyboardEvent): void => {
      try {
        if (event.key !== 'Tab') return
        if (stackTop() !== root) return
        const items = visibleItems(root)
        if (items.length === 0) {
          event.preventDefault()
          return
        }
        const head = items[0]
        const tail = items[items.length - 1]
        const focused = currentFocus()
        const inside = focused !== null && root.contains(focused)
        if (event.shiftKey && (focused === head || !inside)) {
          event.preventDefault()
          focusElement(tail)
        } else if (!event.shiftKey && (focused === tail || !inside)) {
          event.preventDefault()
          focusElement(head)
        }
      } catch (error) {
        warn('焦点循环', error)
      }
    }

    try {
      trapStack.push(root)
      document.addEventListener('keydown', onKey, true)
    } catch (error) {
      warn('安装焦点陷阱', error)
      popTrap(root)
      return undefined
    }
    return () => {
      try {
        document.removeEventListener('keydown', onKey, true)
        popTrap(root)
      } catch (error) {
        warn('卸载焦点陷阱', error)
      }
    }
  }, [ref, active])
}
