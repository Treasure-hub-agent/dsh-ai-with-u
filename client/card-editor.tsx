/**
 * AI WITH U · 角色卡编辑器
 *
 * 面板内「全屏」编辑页（不是一堆小弹窗）：面板宽度有限，把十个分组平铺成一页
 * 往下滚，比反复开关弹层顺手得多。
 *
 * 布局：
 *  - 顶部：固定的标题栏（角色名 / 完整度 / 关闭），下面跟着分组列表滚动
 *  - 中部：每个分组一张可折叠卡片；声线基因是灵魂字段，标了金色徽记
 *  - 底部：固定操作条（取消 / 保存），始终可见
 *
 * 数据层完全不在这里：草稿的读写、合并、脏检查都在 `card-schema.ts`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import { useFocusTrap, useInitialFocus, useRestoreFocus } from './a11y'
import type { Card } from './api'
import { GROUPS, filledCount, isEmptyValue, isDirty, mergeCard, toDraft } from './card-schema'
import type { Draft, FieldSpec, GroupSpec } from './card-schema'
import { IconChevron, IconPlus, IconQuill, IconTrash } from './icons'
import type { Translate } from './text'

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
  items: string[]
  itemPlaceholder: string
  onChange: (items: string[]) => void
  t: Translate
}): JSX.Element {
  const { items, itemPlaceholder, onChange, t } = props

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
            onChange={event => update(index, event.target.value)}
          />
          <button
            type="button"
            className="awu-editListRemove"
            title={t('edit.removeItem')}
            aria-label={t('edit.removeItem')}
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
  name: string
  source: string
  busy: boolean
  error: string
  onCancel: () => void
  onSave: (next: Card) => void
  t: Translate
}): JSX.Element {
  const { card, name, source, busy, error, onCancel, onSave, t } = props

  const [draft, setDraft] = useState<Draft>(() => toDraft(card))
  // 默认展开：基本信息 + 声线（灵魂字段），其余折叠，避免一屏全是输入框
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const group of GROUPS) init[group.id] = group.open === true
    return init
  })
  const [confirmLeave, setConfirmLeave] = useState(false)
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

  const dirty = useMemo(() => isDirty(card, draft), [card, draft])
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

  // Esc 关闭：有改动时先弹确认，别让人手一滑丢掉一屏编辑
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (confirmLeave) { setConfirmLeave(false); return }
      if (dirty) { setConfirmLeave(true); return }
      onCancel()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [dirty, confirmLeave, onCancel])

  const save = (): void => {
    if (busy) return
    onSave(mergeCard(card, draft))
  }

  return (
    <div ref={editorRef} className="awu-editor" role="dialog" aria-modal="true" aria-label={t('edit.title')}>
      {/* 顶部：标题栏 */}
      <header className="awu-editorHead">
        <div className="awu-editorHeadMain">
          <div className="awu-editorKicker">{t('edit.kicker')}</div>
          <div className="awu-editorName">
            {name}
            <span className="awu-editorSource">{source !== '' ? source : t('common.unknown')}</span>
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
