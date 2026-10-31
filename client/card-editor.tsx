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
import type { Card } from './api'
import { ccv3Data } from './card-source'
import { GROUPS, filledCount, isEmptyValue, isDirty, mergeCard, toDraft } from './card-schema'
import { sourceLabelOf } from './text'
import type { Draft, GroupSpec } from './card-schema'
import { IconChevron, IconPlus, IconQuill, IconTrash } from './icons'
import { LorebookSection } from './lorebook-editor'
import { loreIssues, mergeLoreIntoCard, toLoreDraftFromCard } from './lorebook-schema'
import type { LoreBookDraft, LoreEntryDraft } from './lorebook-schema'
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

/** 单行输入。 */
function TextField(props: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  multiline?: boolean
}): JSX.Element {
  const { value, placeholder, onChange, multiline = false } = props
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // textarea 自适应高度：让长文本字段随内容长高，而不是在小框里滚动
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
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

      {open && (
        <div className="awu-editGroupBody">
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
}): JSX.Element {
  const { card, ccv3, name, source, busy, error, onCancel, onSave, t, closeSignal, onDirtyChange } = props

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

  // 焦点顺序不能换：先记「打开前焦点在哪」，再把焦点送进容器，最后才拦 Tab。
  // 未保存确认打开时压栈成为最上层，Tab 只在确认卡里循环；关掉后焦点回到编辑器。
  useRestoreFocus(true)
  useInitialFocus(editorRef, true)
  useFocusTrap(editorRef, true)
  useRestoreFocus(confirmLeave)
  useInitialFocus(confirmRef, confirmLeave)
  useFocusTrap(confirmRef, confirmLeave)

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
    if (busy) return
    if (dirty) { setConfirmLeave(true); return }
    onCancel()
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
      // 全屏长文本层盖在最上面：Esc 归它（它自己会处理和「返回/丢弃」），
      // 两个 capture 监听按注册顺序跑，壳层不让步就会出现「一次 Esc 关两层」。
      if (loreFocus) return
      event.stopPropagation()
      if (confirmLeave) { setConfirmLeave(false); return }
      if (dirty) { setConfirmLeave(true); return }
      onCancel()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [dirty, confirmLeave, loreFocus, onCancel])

  /**
   * 保存：两条链路分开走（见 `CardSavePayload` 的注释）。
   *
   * 世界书改动时**必须**整卡回传 `ccv3`，结构改动只发 `card`；
   * 面板据此决定一次发一个键、还是先发 ccv3 再发 card。
   */
  const save = (): void => {
    if (busy) return
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
    <div ref={editorRef} className="awu-editor" role="dialog" aria-modal="true" aria-label={t('edit.title')}>
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
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
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
        <button type="button" className="awu-btn" onClick={requestClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="awu-btn"
          data-kind="primary"
          onClick={save}
          disabled={busy || !dirty}
        >
          {busy ? t('common.busy') : t('edit.save')}
        </button>
      </footer>

      {/* 未保存确认 */}
      {confirmLeave && (
        <div ref={confirmRef} className="awu-editorConfirm" role="dialog" aria-modal="true" aria-label={t('edit.discardTitle')}>
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
              <button type="button" className="awu-btn" data-kind="danger" onClick={onCancel}>
                {t('edit.discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
