/**
 * AI WITH U · 角色卡编辑器
 *
 * 面板内「全屏」编辑页（不是一堆小弹窗）：面板宽度有限，把十个字段分组 + 世界书
 * 平铺成一页往下滚，比反复开关弹层顺手得多。
 *
 * 布局：
 *  - 顶部：固定的标题栏（角色名 / 完整度 / 关闭），下面跟着分组列表滚动
 *  - 中部：每个分组一张可折叠卡片；声线基因是灵魂字段，标了金色徽记；
 *          第 11 块是世界书（`lorebook-editor.tsx`，条目列表 + 全屏长文本）
 *  - 底部：固定操作条（取消 / 保存），始终可见
 *
 * 数据层完全不在这里：结构草稿在 `card-schema.ts`，世界书草稿在 `lorebook-schema.ts`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'
import { countRegexScripts } from './api'
import type { Card } from './api'
import { ccv3Data } from './card-source'
import { GROUPS, filledCount, isEmptyValue, isDirty, mergeCard, toDraft } from './card-schema'
import { useLayerExit, useStillAttr } from './editor-focus'
import { sourceLabelOf } from './text'
import type { Draft, GroupSpec } from './card-schema'
import { IconChevron, IconClose, IconPlus, IconQuill, IconTrash } from './icons'
import { LorebookSection } from './lorebook-editor'
import { loreIssues, mergeLoreIntoCard, toLoreDraftFromCard } from './lorebook-schema'
import type { LoreBookDraft, LoreEntryDraft } from './lorebook-schema'
import { T_BASE, T_ENTER, T_EXIT, presenceAttrs, usePresence } from './motion'
import type { LoreDroppedInfo } from './lore-diag'
import type { Translate } from './text'

/**
 * 编辑器提交给面板的保存信封。
 *
 * 为什么要分成三条信息：世界书与结构视图**走两条不同的保存链路**（C7 的坑，见 `api.ts`
 * 的 `saveCharacterCcv3`），面板必须先知道「谁变了」才能决定发哪些键、发几次。
 *  `structureChanged` → 发 `{ name, card }`
 *  `loreChanged`      → 发 `{ name, ccv3 }`（整卡回传，只改 data.character_book）
 * 两者都变了就分两步发（先世界书、后结构），任何一步都不把 `card` 与 `ccv3` 混在一起。
 */
export interface CardSavePayload {
  /**
   * 结构视图（`mergeCard` 的产物）。
   *
   * 叫 `view` 而不是 `card`：它不是请求体里那个 `card` 键 —— 面板要按「结构 / 世界书」
   * 两条链路拆开、各自单独发一次。命名沿用 `card-source.ts` 的既有叫法（`buildSavePayload(view, ccv3Next)`）。
   */
  view: Card
  /** 完整 CCv3：世界书有改动时带（已合并 `data.character_book`），否则不带 */
  ccv3?: Card
  /** 结构视图是否有改动 */
  structureChanged: boolean
  /** 世界书是否有改动 */
  loreChanged: boolean
  /** 提交后世界书应有的条目数（回读校验用，防「界面说存了、磁盘没变」） */
  loreEntries: number
}

/** 自适应高度的封顶（px）：超过就在框内滚动，不把整页往下推。 */
const TEXTAREA_MAX_H = 240

/**
 * 合帧的兜底时长（ms）。
 *
 * 正常情况下 rAF 会在下一帧（~16ms）跑测量；但**页面不出帧时 rAF 会一直挂着**
 * （后台标签、最小化窗口、无头环境、GPU 进程被打断……实测在无头 Chromium 里出现过
 * 连续几次输入都不出帧，高度就停在旧值不再长）。所以除了 rAF 再挂一个定时器兜底：
 * 两个回调共用同一份"待办"记录，谁先到谁清掉对方，**一次变化仍然只量一次**。
 */
const MEASURE_FALLBACK_MS = 120

/** 单行输入。 */
function TextField(props: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  multiline?: boolean
}): JSX.Element {
  const { value, placeholder, onChange, multiline = false } = props
  const ref = useRef<HTMLTextAreaElement | null>(null)
  /** 待执行的测量（rAF + 定时器兜底，同一时刻最多一份）。 */
  const pendingRef = useRef<{ frame?: number; timer?: number }>({})
  /** 上一次处理的文本「长度 + 行数」，用来判断这次是只增不减、还是可能变矮。 */
  const prevMetaRef = useRef<{ len: number; lines: number } | null>(null)
  /** 上一帧是不是已经封顶（≥240px）：封顶后继续打字，目标高度必然是同一个值。 */
  const cappedRef = useRef(false)

  /**
   * textarea 自适应高度：让长文本字段随内容长高，而不是在小框里滚动。
   *
   * **旧实现为什么慢**（2026-11-02 性能体检）：
   * ```
   * el.style.height = 'auto'                 // ① 写：把布局打脏
   * el.style.height = min(el.scrollHeight,…) // ② 读 scrollHeight：样式脏了，必须先把
   *                                          //    整棵树重算一遍才能回答 → forced reflow
   * ```
   * 这个 effect 挂在 `[value]` 上，所以是**每个字符一发**：只要当前分组里有长文本在打字，
   * 主线程每键都要付一次同步 layout（几百 µs ~ 数 ms，取决于面板里有多少节点）。
   * 面板一屏同时挂着 10 个分组 + 世界书，这就是编辑器"打字发涩"的直接来源。
   *
   * **现在的顺序（能不读就不读，能写一次就不写两次）**：
   *  0. **零测量快路径**：上一帧已经封顶（≥240px）且这次文本「只增不减」→ 内容只会更长、
   *     目标高度必然是同一个封顶值，于是**连 `scrollHeight` 都不读**。这条覆盖的正是
   *     "长文本一直在打字"这个最热场景（底下实测：40 次输入 41→1 次强制布局）；
   *  1. 必须先读的那一步，先读 `scrollHeight` / `clientHeight` 两个数：此时样式没被打脏，
   *     浏览器可以复用上一帧的布局结果，成本 ≈ 0；
   *  2. 只有「内容溢出」才写 height，而且**不需要先归零**：溢出的 textarea 的
   *     `scrollHeight` 本身就是真实内容高度，一次写就够；
   *  3. 写之前再比一次内联值，相同就**不写**（封顶后的长文本每键目标都是同一个 240px）；
   *  4. 「变矮」是唯一需要把高度归零再量的情形（内容装得下时 `scrollHeight` 等于
   *     `clientHeight`，量不出真实需求高度），它只发生在**删字**与**首次挂载**时；
   *  5. 同一帧内多次触发合并成一次测量：rAF 与一个兜底定时器共用同一份待办，谁先到谁
   *     清掉对方（页面不出帧时 rAF 会一直挂着，只靠它会"高度再也不长"——无头环境实测到过）。
   *
   * **行为与旧实现一致**：随内容长高、封顶 240px、超过封顶出内滚动条、删字缩回去、
   * 首帧按内容定高；视觉兜底仍在 CSS（`.awu-editArea` 是 `height:auto` + `min-height:56px`）。
   *
   * 唯一有意的偏差（更好、不是回归）：用户手动拖拽 `resize: vertical` 把框拉高后继续打字，
   * 新实现不会像旧实现那样把高度拽回 240px（旧实现每键都重算，等于吞掉用户的手动尺寸）。
   */
  useEffect(() => {
    const el = ref.current
    if (el === null) return undefined

    // 行数只用来判断"有没有可能变矮"：换行数变少（或总长变短）才需要归零重量。
    let lines = 0
    for (const ch of value) if (ch === '\n') lines += 1
    const prev = prevMetaRef.current
    const shrunk = prev !== null && (value.length < prev.len || lines < prev.lines)
    /** 首帧走一次完整测量，保证初始高度与旧实现一致。 */
    const first = prev === null
    prevMetaRef.current = { len: value.length, lines }

    const apply = (): void => {
      // 先清掉自己这一份待办：rAF 与兜底定时器共用同一份，谁先到谁清掉对方
      const pending = pendingRef.current
      if (pending.frame !== undefined) { window.cancelAnimationFrame(pending.frame); pending.frame = undefined }
      if (pending.timer !== undefined) { window.clearTimeout(pending.timer); pending.timer = undefined }
      try {
        // ⓪ 零测量快路径：已封顶 + 只增不减 → 目标高度仍是封顶值，一个数都不用读
        if (cappedRef.current && !shrunk) return

        // ① 先读：样式没被打脏，走上一帧的布局缓存
        const content = el.scrollHeight
        const visible = el.clientHeight
        if (content > visible) {
          // ② 溢出：scrollHeight 就是真实内容高度，直接封顶写回（相同则不写）
          const target = Math.min(content, TEXTAREA_MAX_H)
          cappedRef.current = target >= TEXTAREA_MAX_H
          const next = `${target}px`
          if (el.style.height !== next) el.style.height = next
          return
        }
        // ③ 装得下、且不是在变矮 / 首帧：当前高度已经够用，不量也不写
        if (!shrunk && !first) return
        // ④ 变矮 / 首帧：只有这条路径需要"归零再量"
        el.style.height = 'auto'
        const natural = Math.min(el.scrollHeight, TEXTAREA_MAX_H)
        cappedRef.current = natural >= TEXTAREA_MAX_H
        el.style.height = `${natural}px`
      } catch (error) {
        // 量高度失败不该影响输入（老内核 / 元素正在被卸载），留痕后跳过
        console.warn('[ai-with-u] 编辑框自适应高度失败，已跳过', error)
      }
    }

    // 合帧：一帧内最多量一次。先撤销上一份待办（连打 / 粘贴 / 输入法上屏会在一帧里
    // 触发多次），再同时挂 rAF 与定时器兜底 —— 页面不出帧时后者保底。
    const pending = pendingRef.current
    if (pending.frame !== undefined) { window.cancelAnimationFrame(pending.frame); pending.frame = undefined }
    if (pending.timer !== undefined) { window.clearTimeout(pending.timer); pending.timer = undefined }
    pending.frame = window.requestAnimationFrame(apply)
    pending.timer = window.setTimeout(apply, MEASURE_FALLBACK_MS)
    return () => {
      const now = pendingRef.current
      if (now.frame !== undefined) { window.cancelAnimationFrame(now.frame); now.frame = undefined }
      if (now.timer !== undefined) { window.clearTimeout(now.timer); now.timer = undefined }
    }
  }, [value])

  if (multiline) {
    return (
      <textarea
        ref={ref}
        className="awu-input awu-editInput awu-editArea"
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={event => onChange(event.target.value)}
      />
    )
  }
  return (
    <input
      className="awu-input awu-editInput"
      value={value}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
    />
  )
}

/** 字符串列表编辑器：逐条增删改。 */
function ListField(props: {
  /** 字段名：用来给每一条生成可区分的无障碍名称（读屏用户要知道在改第几条）。 */
  label: string
  items: string[]
  itemPlaceholder: string
  onChange: (items: string[]) => void
  t: Translate
}): JSX.Element {
  const { label, items, itemPlaceholder, onChange, t } = props

  const update = (index: number, value: string): void => {
    const next = [...items]
    next[index] = value
    onChange(next)
  }
  const remove = (index: number): void => {
    onChange(items.filter((_, i) => i !== index))
  }
  const add = (): void => {
    onChange([...items, ''])
  }

  return (
    <div className="awu-editList">
      {items.length === 0 && (
        <div className="awu-editListEmpty">{t('edit.listEmpty')}</div>
      )}
      {items.map((item, index) => (
        <div className="awu-editListItem" key={index}>
          <span className="awu-editListIndex">{index + 1}</span>
          <textarea
            className="awu-input awu-editInput awu-editListText"
            value={item}
            placeholder={itemPlaceholder}
            rows={1}
            aria-label={`${label} 第 ${index + 1} 条`}
            onChange={event => update(index, event.target.value)}
          />
          <button
            type="button"
            className="awu-editListRemove"
            title={t('edit.removeItem')}
            aria-label={`${t('edit.removeItem')}：${label} 第 ${index + 1} 条`}
            onClick={() => remove(index)}
          >
            <IconTrash size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="awu-editAdd" onClick={add}>
        <IconPlus size={11} />
        {t('edit.addItem')}
      </button>
    </div>
  )
}

/** 一个可折叠分组。 */
function FieldGroup(props: {
  group: GroupSpec
  values: Record<string, string | string[]>
  open: boolean
  onToggle: () => void
  onFieldChange: (key: string, value: string | string[]) => void
  t: Translate
}): JSX.Element {
  const { group, values, open, onToggle, onFieldChange, t } = props

  /**
   * 折叠体退场（契约 §3「折叠展开/收起」：展开 T_BASE / 收起 T_EXIT）。
   *
   * 展开那条在 CSS 里（`.awu-editGroupBody { animation: awu-fold-in … }`），收起这条**必须**留 DOM：
   * React 直接 `{open && …}` 卸载的话，`.awu-editGroupBody[data-state="closing"]` 没有对象可动。
   * 四处折叠体（这里 / 世界书 `.awu-loreBody` / 日记按月 `.awu-diary` / 预览分段）用的是同一条
   * `usePresence(open, T_EXIT)` + `presenceAttrs(closing)`，所以没有另抽 `useFold` ——
   * 那只会是 `usePresence` 的别名，多一层间接却没有多一行行为（详见汇报）。
   */
  const bodyPresence = usePresence(open, T_EXIT)

  // 该组已填字段数，折叠时也能看出这块有没有内容
  const filled = group.fields.filter(field => !isEmptyValue(values[field.key] ?? '')).length

  return (
    <section className="awu-editGroup" data-soul={group.soul === true ? 'true' : 'false'} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="awu-editGroupHead"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="awu-editGroupChevron" aria-hidden="true">
          <IconChevron size={12} />
        </span>
        <span className="awu-editGroupTitle">{group.title}</span>
        {group.soul === true && (
          <span className="awu-editSoulBadge" title={t('edit.soulHint')}>{t('edit.soulBadge')}</span>
        )}
        {group.optional === true && (
          <span className="awu-editOptional">{t('edit.optional')}</span>
        )}
        <span className="awu-editGroupCount">
          {filled}/{group.fields.length}
        </span>
      </button>

      {bodyPresence.mounted && (
        <div className="awu-editGroupBody" {...presenceAttrs(bodyPresence.closing)}>
          {group.hint !== undefined && (
            <div className="awu-editGroupHint" data-soul={group.soul === true ? 'true' : 'false'}>
              {group.hint}
            </div>
          )}
          {group.fields.map(field => (
            <label className="awu-editField" key={field.key}>
              <span className="awu-editFieldKey">
                {field.key}
                {field.kind === 'list' && <em className="awu-editFieldKind">{t('edit.listKind')}</em>}
              </span>
              {field.kind === 'list' ? (
                <ListField
                  label={field.key}
                  items={Array.isArray(values[field.key]) ? (values[field.key] as string[]) : []}
                  itemPlaceholder={field.itemPlaceholder ?? field.placeholder ?? ''}
                  onChange={next => onFieldChange(field.key, next)}
                  t={t}
                />
              ) : (
                <TextField
                  value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
                  placeholder={field.placeholder ?? ''}
                  multiline={field.kind === 'long'}
                  onChange={next => onFieldChange(field.key, next)}
                />
              )}
            </label>
          ))}
        </div>
      )}
    </section>
  )
}

/** 编辑器主组件。 */
export function CardEditor(props: {
  card: Card
  /** 完整 CCv3（世界书 / 未知键都在这里）；旧后端只给 card 时为空 */
  ccv3?: Card
  /** 本轮被世界书预算裁掉的条目（宿主给才显示；见 lore-diag.ts） */
  droppedLore?: LoreDroppedInfo
  name: string
  source: string
  busy: boolean
  error: string
  onCancel: () => void
  onSave: (next: CardSavePayload) => void
  t: Translate
  /** 父级请求关闭（点侧栏入口 / 点遮罩）：走同一套未保存确认，别无声丢草稿。 */
  closeSignal?: number
  /** 草稿脏状态变化：面板据此在收起前先问一句。 */
  onDirtyChange?: (dirty: boolean) => void
  /**
   * 父级驱动的退场：**保存成功后**由面板置 true，编辑器先播 160ms 退场再被卸载
   * （从前保存成功是 `setEditing(false)` 直接卸载 = 硬切，而「取消」走的是内部
   * `useLayerExit` 的延迟卸载，两条退出路径观感不一致）。
   *
   * 与 `layerExit` 的关系：两者都表达「正在退场」，取或即可 —— 取消路径归本组件，
   * 保存路径归面板，互不覆盖。
   */
  closing?: boolean
}): JSX.Element {
  const {
    card, ccv3, droppedLore, name, source, busy, error, onCancel, onSave, t, closeSignal, onDirtyChange, closing = false,
  } = props

  const [draft, setDraft] = useState<Draft>(() => toDraft(card))
  // 默认展开：基本信息 + 声线（灵魂字段），其余折叠，避免一屏全是输入框
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const group of GROUPS) init[group.id] = group.open === true
    return init
  })
  const [confirmLeave, setConfirmLeave] = useState(false)
  // 世界书草稿：与 34 字段草稿分开存，靠 `loreBase` 的快照判脏
  const [lore, setLore] = useState<{ book: LoreBookDraft; entries: LoreEntryDraft[] }>(() => toLoreDraftFromCard(ccv3))
  const [loreBase] = useState(() => JSON.stringify(toLoreDraftFromCard(ccv3)))
  // 全屏长文本层是否开着：开着时 Esc 归它，壳层不许顺手把编辑器关了
  const [loreFocus, setLoreFocus] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // 两层 role="dialog"：编辑器本体一层，未保存确认再叠一层
  const editorRef = useRef<HTMLDivElement | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)

  /**
   * 编辑器本体的退场：面板用 `editing ? <CardEditor/> : <详情页>` 整块替换，
   * 直接调 `onCancel()` 等于当场卸载 —— `.awu-editor[data-state="closing"]` 就没对象可动。
   * `useLayerExit` 把 `onCancel` 排到 160ms 之后（契约 §2.2）。
   */
  const layerExit = useLayerExit(onCancel, editorRef)
  /** 首帧带着 `data-still` 渲染 = 这次进入不做 blur（入场 `awu-slide-in` 240ms）。 */
  const attachEditor = useStillAttr(editorRef, T_ENTER + 60)
  /** 未保存确认层自己的退场：按「继续编辑」收掉时淡出，而不是硬切。 */
  const confirmPresence = usePresence(confirmLeave, T_EXIT)
  /** 同一套首帧 `data-still`：契约要求三个浮层都带（`.awu-editorConfirm` 的 CSS 规则待补，见汇报）。 */
  const attachConfirm = useStillAttr(confirmRef, T_BASE + 60)

  // 焦点顺序不能换：先记「打开前焦点在哪」，再把焦点送进容器，最后才拦 Tab。
  // 未保存确认打开时压栈成为最上层，Tab 只在确认卡里循环；关掉后焦点回到编辑器。
  //
  // ⚠️ 这里的 `useRestoreFocus(true)` 在当前挂载路径上是**一次空操作**，不是 bug：
  // 面板用 `editing ? <CardEditor/> : <>详情页…</>` 整块替换（index.tsx），编辑器挂载时
  // 「编辑」按钮已随子树卸载、浏览器把焦点退回 body → hook 按「原本是 body 就不记录」
  // 的设计跳过。还焦由面板按稳定 id（#awu-detail-edit）补，见 index.tsx 的 wasEditingRef。
  // 三件套仍然要留：编辑器内部还有一层「未保存确认」要接管焦点。
  useRestoreFocus(true)
  useInitialFocus(editorRef, !layerExit.leaving && !closing)
  useFocusTrap(editorRef, !layerExit.leaving && !closing)
  useRestoreFocus(confirmLeave)
  useInitialFocus(confirmRef, confirmLeave)
  useFocusTrap(confirmRef, confirmLeave && !layerExit.leaving)

  const structureDirty = useMemo(() => isDirty(card, draft), [card, draft])
  const loreDirty = useMemo(() => JSON.stringify(lore) !== loreBase, [lore, loreBase])
  /** 世界书能不能写：需要 `ccv3.data` 这层信封（`mergeLoreIntoCard` 的硬前提）。 */
  const loreSupported = useMemo(() => Object.keys(ccv3Data(ccv3)).length > 0, [ccv3])
  const loreIssueList = useMemo(() => loreIssues(lore.entries), [lore.entries])
  const dirty = structureDirty || loreDirty
  // 把脏状态同步给面板：面板的入口按钮/遮罩/卸载都要先经过这里
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  const progress = useMemo(() => {
    const merged = mergeCard(card, draft)
    return filledCount(merged)
  }, [card, draft])

  const setField = useCallback((groupId: string, key: string, value: string | string[]): void => {
    setDraft(current => ({
      ...current,
      [groupId]: { ...(current[groupId] ?? {}), [key]: value },
    }))
  }, [])

  const toggleGroup = useCallback((groupId: string): void => {
    setOpenGroups(current => ({ ...current, [groupId]: !current[groupId] }))
  }, [])

  const requestClose = (): void => {
    // `closing` = 父级驱动的退场（保存成功）。退场中再问"要不要放弃改动"毫无意义：
    // 层已经 pointer-events:none、120ms 内就会随父级卸载，确认卡只会闪一下（实测 confirm 0→1→0）。
    if (busy || layerExit.leaving || closing) return
    if (dirty) { setConfirmLeave(true); return }
    layerExit.beginLeave()
  }

  /**
   * 确认层里按「放弃」：**不**收确认层，直接把整棵编辑器送进退场。
   *
   * 为什么不 `setConfirmLeave(false)` 再走：那样确认卡会先硬切消失（React 卸载），
   * 底下的编辑页再淡出 —— 同一动作里出现两次视觉事件。让父层带着它一起淡完 160ms 更干净。
   */
  const discardAndLeave = (): void => {
    if (layerExit.leaving || closing) return
    layerExit.beginLeave()
  }

  // 父级请求关闭（点侧栏入口 / 点遮罩收起面板）：不直接卸载，先走同一套未保存确认
  useEffect(() => {
    if (closeSignal === undefined || closeSignal <= 0) return
    requestClose()
    // 只认信号变化：requestClose 每次 render 都是新函数，放进依赖会循环触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal])

  // Esc 关闭：有改动时先弹确认，别让人手一滑丢掉一屏编辑
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 退场期（160ms）不再接 Esc：这层已经在消失，Esc 该落到外层去了。
      // `closing` 也要一起挡 —— 保存成功的退场由父级驱动，`layerExit.leaving` 恒为 false，
      // 只挡它的话 Esc 会走 dirty 分支、在正在淡出的层里弹「未保存确认」。
      if (layerExit.leaving || closing) return
      // 全屏长文本层盖在最上面：Esc 归它（它自己会处理和「返回/丢弃」），
      // 两个 capture 监听按注册顺序跑，壳层不让步就会出现「一次 Esc 关两层」。
      if (loreFocus) return
      event.stopPropagation()
      if (confirmLeave) { setConfirmLeave(false); return }
      if (dirty) { setConfirmLeave(true); return }
      layerExit.beginLeave()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [dirty, confirmLeave, layerExit, loreFocus, closing])

  /**
   * 保存：两条链路分开走（见 `CardSavePayload` 的注释）。
   *
   * 世界书改动时**必须**整卡回传 `ccv3`，结构改动只发 `card`；
   * 面板据此决定一次发一个键、还是先发 ccv3 再发 card。
   */
  const save = (): void => {
    if (busy || closing) return
    const ccv3Next = loreDirty ? mergeLoreIntoCard(ccv3, lore.book, lore.entries) : undefined
    onSave({
      view: mergeCard(card, draft),
      ...(ccv3Next === undefined ? {} : { ccv3: ccv3Next }),
      structureChanged: structureDirty,
      loreChanged: loreDirty,
      loreEntries: lore.entries.length,
    })
  }

  return (
    <div
      ref={attachEditor}
      className="awu-editor"
      role="dialog"
      aria-modal="true"
      aria-label={t('edit.title')}
      /* 退场中整层对读屏不可见：内容正在淡出，念它只会让用户困惑 */
      aria-hidden={layerExit.leaving || closing ? true : undefined}
      /* 退场有两个来源：组件内（取消/遮罩/closeSignal）与父级（保存成功），取或即可 */
      {...presenceAttrs(layerExit.closing || closing === true)}
    >
      {/* 顶部：标题栏 */}
      <header className="awu-editorHead">
        <div className="awu-editorHeadMain">
          <div className="awu-editorKicker">{t('edit.kicker')}</div>
          <div className="awu-editorName">
            {name}
            <span className="awu-editorSource">{sourceLabelOf(source, t)}</span>
          </div>
        </div>
        <div className="awu-editorHeadRight">
          <span className="awu-editorProgress" title={t('edit.progressHint')}>
            {progress.filled}/{progress.total}
          </span>
          <button
            type="button"
            className="awu-iconBtn"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={requestClose}
            disabled={busy}
          >
            <IconClose size={15} />
          </button>
        </div>
      </header>

      {/* 只读提示：改名要动目录，本次不做 */}
      <div className="awu-editorReadonly">
        <span>{t('edit.readonlyHint')}</span>
      </div>

      {error !== '' && (
        <div className="awu-err" style={{ margin: '0 16px 10px' }} role="alert">
          <span>{error}</span>
        </div>
      )}

      {/* 中部：分组列表 */}
      <div className="awu-editorBody" ref={bodyRef}>
        {GROUPS.map(group => (
          <FieldGroup
            key={group.id}
            group={group}
            values={draft[group.id] ?? {}}
            open={openGroups[group.id] === true}
            onToggle={() => toggleGroup(group.id)}
            onFieldChange={(key, value) => setField(group.id, key, value)}
            t={t}
          />
        ))}
        {/* 第 11 个分区：世界书。数据层在 lorebook-schema.ts，保存走 ccv3（见 save()） */}
        <LorebookSection
          book={lore.book}
          entries={lore.entries}
          issues={loreIssueList}
          dirty={loreDirty}
          supported={loreSupported}
          dropped={droppedLore}
          regexScripts={countRegexScripts(ccv3)}
          onChangeBook={patch => setLore(current => ({ ...current, book: { ...current.book, ...patch } }))}
          onChangeEntries={next => setLore(current => ({ ...current, entries: next }))}
          onFocusLayerChange={setLoreFocus}
          t={t}
        />
        <div style={{ height: 8 }} />
      </div>

      {/* 底部：固定操作条 */}
      <footer className="awu-editorFoot">
        <span className="awu-editorDirty" data-dirty={dirty ? 'true' : 'false'}>
          {dirty ? t('edit.dirty') : t('edit.clean')}
        </span>
        <button type="button" className="awu-btn" onClick={requestClose} disabled={busy || closing}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="awu-btn"
          data-kind="primary"
          onClick={save}
          disabled={busy || closing || !dirty}
        >
          {busy ? t('common.busy') : t('edit.save')}
        </button>
      </footer>

      {/* 未保存确认：`confirmLeave` 决定"该开"、presence 决定"还留不留"（收启动画 160ms） */}
      {confirmPresence.mounted && (
        <div
          ref={attachConfirm}
          className="awu-editorConfirm"
          role="dialog"
          aria-modal="true"
          aria-label={t('edit.discardTitle')}
          {...presenceAttrs(confirmPresence.closing)}
        >
          <div className="awu-editorConfirmCard">
            <div className="awu-editorConfirmTitle">
              <IconQuill size={15} />
              {t('edit.discardTitle')}
            </div>
            <div className="awu-editorConfirmText">{t('edit.discardBody')}</div>
            <div className="awu-editorConfirmActions">
              <button type="button" className="awu-btn" onClick={() => setConfirmLeave(false)}>
                {t('edit.keepEditing')}
              </button>
              <button type="button" className="awu-btn" data-kind="danger" onClick={discardAndLeave}>
                {t('edit.discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
