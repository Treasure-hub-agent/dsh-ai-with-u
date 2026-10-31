/**
 * AI WITH U · 文件拖放与宿主拖放状态的交界
 *
 * 为什么单独一个文件：面板（`index.tsx`）与蒸馏弹层（`distill.tsx`）都要「吞掉文件拖放」，
 * 而**吞掉之后必须复位宿主那边的拖放深度计数器**——这两件事必须成对出现，写两份早晚漂移。
 *
 * 宿主实现（2026-10-31 从 `app.asar` 反查，不是猜的）：
 *
 * ```js
 * installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive)
 *   document.addEventListener('dragenter', e => { if Files → dragDepth++; setDragActive(true) })   // 冒泡
 *   document.addEventListener('dragleave', e => { if Files → dragDepth = max(0, dragDepth-1);
 *                                                 if (dragDepth === 0) setDragActive(false) })
 *   document.addEventListener('drop',      e => { if Files → reset(); if (canAcceptDrop) onAddFiles(...) })
 *   window.addEventListener('dragend', reset)     // ← reset = dragDepth=0 + setDragActive(false)
 * ```
 *
 * 于是有两个坑叠在一起：
 *  1. 我们把 `drop` `stopPropagation()` 掉了（不拦的话角色卡会被当成附件发进对话）
 *     → 宿主 `onDrop` 不跑 → 不 `reset()`；
 *  2. 从系统拖进来的文件**没有源元素**，浏览器根本不会派发 `dragend` → 也没有兜底复位。
 *
 * 结果：聊天区那块「文件或图片拖动到此处即可添加」的遮罩永久卡住，必须再拖一次文件才消失
 * （真机 P0，2026-10-31）。修法有两半，都在这一个文件里：
 *
 *  - `resetHostDropState()`：每吞掉一次 drop 就往 `window` 发一个 `dragend`。这**不是 hack**，
 *    宿主的 `reset` 就挂在 `window` 的 `dragend` 上，我们只是命中那个公开复位口
 *    （同事件名、同 reset 函数，不碰它的内部状态）；
 *  - `swallowFileDrag()`：统一「吞掉 + 复位」，保证任何调用点都不会只做一半。
 *
 * 另一半（让遮罩根本不点亮）在 `index.tsx` 的文档捕获监听里：拖入阶段（`dragenter`）
 * 就对「目标在我们容器内」的事件 `stopPropagation`（**不 preventDefault**），
 * 宿主的深度计数器压根不会 +1。这里提供 `isInsideOurLayers()` 供那个监听判断。
 */

/** React 合成事件与原生事件都满足的最小形状（只用到这四样）。 */
export interface DragLikeEvent {
  /** 事件名（`dragenter` / `dragover` / `drop` …）：只有 drop 需要复位宿主状态。 */
  type: string
  dataTransfer: DataTransfer | null
  preventDefault: () => void
  stopPropagation: () => void
}

/**
 * 这次拖拽里有没有文件。
 *
 * 只对「拖文件」动手：面板内拖一段选中的文字、拖 scrollbar 之类必须照常工作，
 * 一刀切 `preventDefault` 会把它们全废掉（宿主 composer 也会跟着失灵）。
 */
export function dragHasFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  const types = event.dataTransfer?.types
  if (types === undefined) return false
  return Array.from(types).includes('Files')
}

/** 事件目标是不是落在我们自己的层里（面板 / 任何弹层遮罩）。 */
export function isInsideOurLayers(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.awu-scrim, .awu-panel') !== null
}

/**
 * 复位宿主的拖放状态（见文件头的实现还原）。
 *
 * 幂等：宿主 `reset` 只是把深度归零 + 关遮罩，多调几次没有副作用。
 * 任何「我们吞掉了一次文件 drop」的路径末尾都该调它——漏一处就是一处真机卡死。
 */
export function resetHostDropState(): void {
  try {
    window.dispatchEvent(new Event('dragend'))
  } catch (error) {
    // 无 window / 事件构造被禁的极端环境不该影响主流程，但必须留痕（禁止空 catch）
    console.warn('[ai-with-u] 复位宿主拖放状态失败', error)
  }
}

/**
 * 吞掉落在我们容器上的文件拖放，并在 drop 时复位宿主状态。
 *
 * - `preventDefault`：允许/接管这次 drop（拖放区要靠它拿文件）；
 * - `stopPropagation`：不让它冒到宿主 composer（那边会把文件当附件收下）；
 * - drop 时再补一次 `resetHostDropState()`：宿主的 `onDrop → reset()` 已经被我们截掉了。
 */
export function swallowFileDrag(event: DragLikeEvent): void {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'drop') resetHostDropState()
}
