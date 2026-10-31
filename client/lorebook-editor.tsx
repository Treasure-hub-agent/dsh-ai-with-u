/**
 * AI WITH U · 世界书分区（角色卡编辑器第 11 块）
 *
 * 为什么单独一个文件而不是塞进 `card-editor.tsx`：那支文件负责「34 字段的 schema 渲染」，
 * 走的是一条纯声明式路径；世界书是**嵌套列表 + 每条独立状态**（展开 / 全屏 / 关键词输入缓冲），
 * 混进去会让两边都难读。分区头 / 折叠 / 输入控件的样式与语义仍与 `FieldGroup` 逐字一致
 * （`awu-editGroup` / `awu-editInput` / `awu-editAdd`），所以看上去还是同一页。
 *
 * 三条纪律（对应 `lorebook-schema.ts` 的注释）：
 *  1. **只改草稿**：这里所有操作都不落盘，保存由编辑器底栏统一发起；
 *  2. **未知键不丢**：条目 / 书级对象原样带着 `unknown` 走，本组件从不重建条目；
 *  3. **体检只提示**：`loreIssues` 的结果展示在分区顶部，**绝不阻断保存**。
 *
 * 顺带把 `editor-focus.tsx`（专注编辑层）接上了：上线前它全项目零引用，但它解决的问题是真的
 * ——设定条目动辄上千字，挤在 240px 的 textarea 里既难读也难改。走「本地缓冲 + 关层才提交」
 * 还顺手避免了打字时整棵树重渲染。壳层的 Esc 要让位（见下面 `onFocusLayerChange`）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import { FocusEditor } from './editor-focus'
import { IconAlert, IconChevron, IconPlus, IconTrash } from './icons'
import {
  LORE_BUDGET,
  LORE_LIMITS,
  countChars,
  createEntry,
  entryLabel,
  loreTotals,
  moveEntry,
  nextInsertionOrder,
  normalizeKeys,
  worstLevel,
} from './lorebook-schema'
import type { LoreBookDraft, LoreEntryDraft, LoreIssue, LoreIssueLevel } from './lorebook-schema'
import type { LoreDroppedInfo } from './lore-diag'
import type { Translate } from './text'

export interface LorebookSectionProps {
  book: LoreBookDraft
  entries: LoreEntryDraft[]
  /** `loreIssues(entries)` 的结果（由编辑器算一次，避免分区头每渲染重跑体检） */
  issues: LoreIssue[]
  /** 世界书是否有改动（分区头上的小圆点） */
  dirty: boolean
  /** 卡里有没有可写的 CCv3 信封（false 时整块只给说明，不给控件） */
  supported: boolean
  /**
   * 「本轮被预算裁掉」的条目（宿主给才显示）。
   *
   * 数据来源见 `lore-diag.ts`：优先 `GET /character` 的 diag，取不到时面板会退到
   * `GET /preview` 的 `lore`；两路都没有就是 `undefined` → 整块不渲染，不报错。
   */
  dropped?: LoreDroppedInfo
  /** 本卡里的酒馆正则脚本条数（>0 时顶部给一条中性说明：已屏蔽，不执行不注入） */
  regexScripts?: number
  onChangeBook: (patch: Partial<LoreBookDraft>) => void
  onChangeEntries: (next: LoreEntryDraft[]) => void
  t: Translate
  /**
   * 全屏长文本层开/关。编辑器壳层据此**把 Esc 让给本层**：
   * 两个 document 级 Esc 监听在 capture 阶段按注册顺序触发，壳层不主动退出，
   * 会出现「按一次 Esc 关掉整个编辑器」。
   */
  onFocusLayerChange?: (open: boolean) => void
}

/** 问题码 → 建议上限（模板里的 `{max}`）。只用于措辞，不参与判断。 */
function limitOf(code: LoreIssue['code']): number {
  if (code === 'content-too-long') return LORE_LIMITS.hardContentChars
  if (code === 'too-many-entries') return LORE_LIMITS.entries
  return 0
}

/** 数值输入：空串按 0 处理，其它按最近的整数（规范里这两个字段都是整数）。 */
function asInt(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

/** 一条世界书条目的折叠行 + 编辑体。 */
function LoreEntryCard(props: {
  entry: LoreEntryDraft
  index: number
  total: number
  open: boolean
  issues: LoreIssue[]
  t: Translate
  onToggle: () => void
  onPatch: (patch: Partial<LoreEntryDraft>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
  onFullscreen: () => void
}): JSX.Element {
  const { entry, index, total, open, issues, t, onToggle, onPatch, onMove, onRemove, onFullscreen } = props

  // 关键词输入缓冲：数组 ↔ 逗号文本不能每敲一个字就互相覆盖
  //（"雾港, " 归一化成 ['雾港'] 再显示回去，逗号会被吃掉，用户根本打不出第二个词）。
  const [keyText, setKeyText] = useState<string>(() => entry.keys.join(', '))
  const [secondaryText, setSecondaryText] = useState<string>(() => entry.secondaryKeys.join(', '))

  const label = entryLabel(entry)
  const shownLabel = label !== '' ? label : t('lore.issueUnnamed', { n: index + 1 })
  /** 这条最严重的等级（只挂一枚徽记，不逐条刷文字；info 只给一个小点） */
  const level: LoreIssueLevel | undefined = worstLevel(issues)

  const changeKeys = (raw: string): void => {
    setKeyText(raw)
    onPatch({ keys: normalizeKeys(raw) })
  }
  const changeSecondary = (raw: string): void => {
    setSecondaryText(raw)
    onPatch({ secondaryKeys: normalizeKeys(raw) })
  }

  return (
    <div className="awu-loreEntry" data-open={open ? 'true' : 'false'} data-level={level ?? 'none'}>
      <div className="awu-loreRow" data-enabled={entry.enabled ? 'true' : 'false'} data-level={level ?? 'none'}>
        <button
          type="button"
          className="awu-loreRowMain"
          aria-expanded={open}
          title={open ? t('lore.collapse') : t('lore.expand')}
          onClick={onToggle}
        >
          <span className="awu-loreRowTitleWrap">
            <span className="awu-loreRowTitle">{shownLabel}</span>
            {level !== undefined && (
              <span
                className="awu-loreRowFlag"
                data-level={level}
                title={t('lore.levelBadge', { level: t(`lore.level.${level}`), n: issues.length })}
                aria-label={t('lore.levelBadge', { level: t(`lore.level.${level}`), n: issues.length })}
              >
                {level === 'info' ? '·' : '!'}
              </span>
            )}
          </span>
          <span className="awu-loreRowMeta">
            {entry.constant
              ? t('lore.constantShort')
              : entry.keys.length === 0
                ? t('lore.noKeysShort')
                : entry.keys.join(' / ')}
          </span>
        </button>
        <span className="awu-loreRowActions">
          <label className="awu-loreRowSwitch" title={t('lore.enabled')}>
            <input
              type="checkbox"
              checked={entry.enabled}
              aria-label={`${t('lore.enabled')}：${shownLabel}`}
              onChange={event => onPatch({ enabled: event.target.checked })}
            />
          </label>
          <button
            type="button"
            className="awu-loreRowBtn"
            disabled={index === 0}
            title={t('lore.moveUp')}
            aria-label={`${t('lore.moveUp')}：${shownLabel}`}
            onClick={() => onMove(-1)}
          >
            <IconChevron size={12} style={{ transform: 'rotate(-90deg)' }} />
          </button>
          <button
            type="button"
            className="awu-loreRowBtn"
            disabled={index >= total - 1}
            title={t('lore.moveDown')}
            aria-label={`${t('lore.moveDown')}：${shownLabel}`}
            onClick={() => onMove(1)}
          >
            <IconChevron size={12} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <button
            type="button"
            className="awu-loreRowBtn"
            title={t('lore.delete')}
            aria-label={`${t('lore.delete')}：${shownLabel}`}
            onClick={onRemove}
          >
            <IconTrash size={12} />
          </button>
        </span>
      </div>

      {open && (
        <div className="awu-loreBody">
          {issues.length > 0 && (
            <ul className="awu-loreEntryIssues">
              {issues.map((issue, i) => (
                <li key={`${issue.code}-${i}`} data-level={issue.level}>
                  <em className="awu-loreIssueLevel">{t(`lore.level.${issue.level}`)}</em>
                  {t(`lore.issue.${issue.code}`, {
                    detail: issue.detail ?? '',
                    max: limitOf(issue.code),
                    count: issue.count ?? 0,
                  })}
                </li>
              ))}
            </ul>
          )}

          <label className="awu-editField">
            <span className="awu-editFieldKey">{t('lore.name')}</span>
            <input
              className="awu-input awu-editInput"
              value={entry.title}
              placeholder={t('lore.namePlaceholder')}
              onChange={event => onPatch({ title: event.target.value })}
            />
          </label>

          <label className="awu-editField">
            <span className="awu-editFieldKey">{t('lore.keys')}</span>
            <input
              className="awu-input awu-editInput"
              value={keyText}
              placeholder={t('lore.keysPlaceholder')}
              onChange={event => changeKeys(event.target.value)}
            />
          </label>

          <label className="awu-editField">
            <span className="awu-editFieldKey">{t('lore.secondaryKeys')}</span>
            <input
              className="awu-input awu-editInput"
              value={secondaryText}
              placeholder={t('lore.secondaryKeysPlaceholder')}
              onChange={event => changeSecondary(event.target.value)}
            />
          </label>

          <div className="awu-editField">
            <span className="awu-editFieldKey">
              {t('lore.content')}
              <em className="awu-editFieldKind">
                {t('lore.chars', { n: countChars(entry.content) })}
              </em>
              <button type="button" className="awu-loreFullscreen" onClick={onFullscreen}>
                {t('lore.fullscreen')}
              </button>
            </span>
            <textarea
              className="awu-input awu-editInput awu-editArea"
              value={entry.content}
              placeholder={t('lore.contentPlaceholder')}
              rows={4}
              /* 这里外层不是 <label>（标题行里还放了一个全屏按钮），标签由 aria-label 补 */
              aria-label={`${t('lore.content')}：${shownLabel}`}
              onChange={event => onPatch({ content: event.target.value })}
            />
          </div>

          <label className="awu-switchRow">
            <input
              type="checkbox"
              checked={entry.constant}
              onChange={event => onPatch({ constant: event.target.checked })}
            />
            <span>{t('lore.constant')}</span>
          </label>

          <div className="awu-loreGrid">
            <label className="awu-editField">
              <span className="awu-editFieldKey">{t('lore.priority')}</span>
              <input
                className="awu-input awu-editInput"
                type="number"
                value={String(entry.priority)}
                onChange={event => onPatch({ priority: asInt(event.target.value, entry.priority) })}
              />
            </label>
            <label className="awu-editField">
              <span className="awu-editFieldKey">{t('lore.order')}</span>
              <input
                className="awu-input awu-editInput"
                type="number"
                value={String(entry.insertionOrder)}
                onChange={event => onPatch({ insertionOrder: asInt(event.target.value, entry.insertionOrder) })}
              />
            </label>
          </div>

          <details className="awu-loreFold">
            <summary>{t('lore.advanced')}</summary>
            <div className="awu-loreAdv">
              <label className="awu-editField">
                <span className="awu-editFieldKey">{t('lore.position')}</span>
                <select
                  className="awu-input awu-editInput"
                  value={entry.position}
                  onChange={event => onPatch({ position: event.target.value === 'before_char' ? 'before_char' : 'after_char' })}
                >
                  <option value="before_char">{t('lore.position.before')}</option>
                  <option value="after_char">{t('lore.position.after')}</option>
                </select>
              </label>
              <label className="awu-switchRow">
                <input
                  type="checkbox"
                  checked={entry.caseSensitive}
                  onChange={event => onPatch({ caseSensitive: event.target.checked })}
                />
                <span>{t('lore.caseSensitive')}</span>
              </label>
              <label className="awu-switchRow">
                <input
                  type="checkbox"
                  checked={entry.selective}
                  onChange={event => onPatch({ selective: event.target.checked })}
                />
                <span>{t('lore.selective')}</span>
              </label>
              <label className="awu-switchRow">
                <input
                  type="checkbox"
                  checked={entry.useRegex}
                  onChange={event => onPatch({ useRegex: event.target.checked })}
                />
                <span>{t('lore.useRegex')}</span>
              </label>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

/** 世界书分区本体。 */
export function LorebookSection(props: LorebookSectionProps): JSX.Element {
  const { book, entries, issues, dirty, supported, dropped, regexScripts, onChangeBook, onChangeEntries, t, onFocusLayerChange } = props

  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState('')
  /** 全屏长文本层正在编辑哪一条（`''` = 没开） */
  const [focusId, setFocusId] = useState('')
  /** 「提示」级问题默认折叠（真卡动辄几十条规模提示，展开会淹没真问题） */
  const [showInfo, setShowInfo] = useState(false)
  /** 「被预算裁掉」明细默认折叠 */
  const [showDropped, setShowDropped] = useState(false)
  // 新条目的本地 id 计数：`lore-0/1…` 已经被既有条目占用，这里换个前缀避免撞 key
  const localSeq = useRef(0)

  useEffect(() => { onFocusLayerChange?.(focusId !== '') }, [focusId, onFocusLayerChange])

  const totals = useMemo(() => loreTotals(entries), [entries])
  /** 没有任何需要动作的问题（error=0 且 warn=0）→ 顶部只给一句「体检通过」 */
  const passes = totals.errors === 0 && totals.warns === 0

  /** 体检结果按条目归堆：展开某条时只显示它自己的问题。 */
  const issuesByEntry = useMemo(() => {
    const map = new Map<string, LoreIssue[]>()
    for (const issue of issues) {
      if (issue.entryId === '') continue
      const bucket = map.get(issue.entryId)
      if (bucket === undefined) map.set(issue.entryId, [issue])
      else bucket.push(issue)
    }
    return map
  }, [issues])

  /** 按等级分组：默认只展开 error + warn，info 折叠（真卡的规模提示动辄几十条） */
  const errorIssues = useMemo(() => issues.filter(issue => issue.level === 'error'), [issues])
  const warnIssues = useMemo(() => issues.filter(issue => issue.level === 'warn'), [issues])
  const infoIssues = useMemo(() => issues.filter(issue => issue.level === 'info'), [issues])

  /** 一条问题的显示：等级徽记 + 归属条目 + 文案（params 一次性给全，模板按需取） */
  const renderIssue = (issue: LoreIssue, keySuffix: string): JSX.Element => {
    const owner = issue.entryId === '' ? undefined : entries.find(entry => entry.id === issue.entryId)
    const ownerIndex = owner === undefined ? -1 : entries.indexOf(owner)
    const name = owner !== undefined
      ? (entryLabel(owner) !== '' ? entryLabel(owner) : t('lore.issueUnnamed', { n: ownerIndex + 1 }))
      : undefined
    return (
      <li key={`${issue.code}-${keySuffix}`} data-level={issue.level}>
        <em className="awu-loreIssueLevel">{t(`lore.level.${issue.level}`)}</em>
        {name !== undefined && <b>{t('lore.issueFor', { name })}</b>}
        {t(`lore.issue.${issue.code}`, {
          detail: issue.detail ?? '',
          max: limitOf(issue.code),
          count: issue.count ?? 0,
        })}
      </li>
    )
  }

  const patchEntry = useCallback((id: string, patch: Partial<LoreEntryDraft>): void => {
    onChangeEntries(entries.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)))
  }, [entries, onChangeEntries])

  const addEntry = useCallback((): void => {
    const id = `lore-n${localSeq.current}`
    localSeq.current += 1
    const next = createEntry(id, nextInsertionOrder(entries))
    onChangeEntries([...entries, next])
    // 新条目直接展开：否则用户点「添加」后看不到任何变化
    setExpanded(id)
    setOpen(true)
  }, [entries, onChangeEntries])

  const removeEntry = useCallback((id: string): void => {
    onChangeEntries(entries.filter(entry => entry.id !== id))
    setExpanded(current => (current === id ? '' : current))
  }, [entries, onChangeEntries])

  const focusEntry = entries.find(entry => entry.id === focusId)

  return (
    <section className="awu-editGroup" data-open={open ? 'true' : 'false'} data-lore="true">
      <button
        type="button"
        className="awu-editGroupHead"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
      >
        <span className="awu-editGroupChevron" aria-hidden="true">
          <IconChevron size={12} />
        </span>
        <span className="awu-editGroupTitle">{t('lore.title')}</span>
        {dirty && <span className="awu-loreDirtyDot" title={t('edit.dirty')} aria-label={t('edit.dirty')} />}
        <span className="awu-editGroupCount">
          {t('lore.entryCount', { n: entries.length })} · {t('lore.chars', { n: totals.chars })}
        </span>
      </button>

      {open && (
        <div className="awu-editGroupBody">
          {!supported ? (
            <div className="awu-editGroupHint">{t('lore.unsupported')}</div>
          ) : (
            <>
              <div className="awu-editGroupHint">{t('lore.hint')}</div>

              {/* 正则脚本：中性信息（不是警告）——本卡带了 N 条，已屏蔽，不会执行也不会进提示词 */}
              {regexScripts !== undefined && regexScripts > 0 && (
                <div className="awu-noteRow" role="status">
                  <span className="awu-noteDot" aria-hidden="true" />
                  <span>{t('regex.blocked', { n: regexScripts })}</span>
                </div>
              )}

              {/*
                本轮被预算裁掉的条目（宿主提供才显示）。数据来自 lore-diag.ts：
                优先 GET /character 的 diag，取不到退 GET /preview.lore，两路都没有就整块不渲染。
              */}
              {dropped !== undefined && dropped.entries.length > 0 && (
                <div className="awu-loreDropped" data-open={showDropped ? 'true' : 'false'}>
                  <button
                    type="button"
                    className="awu-loreDroppedHead"
                    aria-expanded={showDropped}
                    onClick={() => setShowDropped(current => !current)}
                  >
                    <span className="awu-editGroupChevron" aria-hidden="true">
                      <IconChevron size={12} />
                    </span>
                    <IconAlert size={13} />
                    <span className="awu-loreDroppedTitle">
                      {t('lore.dropped.title', { n: dropped.entries.length })}
                    </span>
                    <span className="awu-loreDroppedMeta">
                      {/* 宿主把常驻与关键词拆成两本预算了：有这个字段就分开显示，否则用合并口径 */}
                      {dropped.constantBudgetChars !== undefined
                        ? t('lore.dropped.budgetBoth', {
                          entries: dropped.maxEntries ?? LORE_BUDGET.entries,
                          chars: dropped.budgetChars ?? LORE_BUDGET.chars,
                          constant: dropped.constantBudgetChars,
                        })
                        : t('lore.dropped.budget', {
                          entries: dropped.maxEntries ?? LORE_BUDGET.entries,
                          chars: dropped.budgetChars ?? LORE_BUDGET.chars,
                        })}
                    </span>
                  </button>
                  {showDropped && (
                    <ul className="awu-loreDroppedList">
                      {dropped.entries.map(entry => (
                        <li key={entry.id}>
                          <span className="awu-loreDroppedName">{entry.name}</span>
                          <span className="awu-loreDroppedOrigin">{t(`lore.dropped.${entry.origin}`)}</span>
                          {entry.chars !== undefined && (
                            <span className="awu-loreDroppedChars">{t('lore.chars', { n: entry.chars })}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 一行总览：条数 · 字数 · 常驻 · 本轮预算（预算优先用宿主给的实测值） */}
              <div className="awu-loreSummary">
                {t('lore.summary', {
                  count: totals.count,
                  chars: t('lore.chars', { n: totals.chars }),
                  constant: totals.constantCount,
                  budgetEntries: dropped?.maxEntries ?? LORE_BUDGET.entries,
                  budgetChars: dropped?.budgetChars ?? LORE_BUDGET.chars,
                })}
              </div>

              {/*
                体检结论：**没有任何需要动作的问题**时只给一句「体检通过」，
                不再挂一排「错误 0 / 提醒 0 / 提示 2」的胶囊——主人要的是「有没有事要处理」，
                不是报表。有 error/warn 时才显示分组计数。
              */}
              {passes ? (
                <div className="awu-loreHealth" data-state="ok">
                  <span className="awu-exportPill" data-state="ok">{t('lore.healthPass')}</span>
                </div>
              ) : (
                <div className="awu-loreHealth">
                  {/* 计数为 0 的档位不挂胶囊：0 条没有动作可做，摆出来又是噪声 */}
                  {totals.errors > 0 && (
                    <span className="awu-exportPill" data-state="bad">
                      {t('lore.level.error')} {totals.errors}
                    </span>
                  )}
                  {totals.warns > 0 && (
                    <span className="awu-exportPill" data-state="warn">
                      {t('lore.level.warn')} {totals.warns}
                    </span>
                  )}
                  {totals.infos > 0 && (
                    <span className="awu-exportPill" data-state="warn">
                      {t('lore.level.info')} {totals.infos}
                    </span>
                  )}
                </div>
              )}

              {(errorIssues.length > 0 || warnIssues.length > 0) && (
                <ul className="awu-issueList awu-loreIssueList" role="status" aria-live="polite">
                  {[...errorIssues, ...warnIssues].map((issue, i) => renderIssue(issue, `main-${i}`))}
                </ul>
              )}

              {infoIssues.length > 0 && (
                <div className="awu-loreInfoBlock">
                  <button
                    type="button"
                    className="awu-btn"
                    data-size="sm"
                    data-kind="ghost"
                    aria-expanded={showInfo}
                    onClick={() => setShowInfo(current => !current)}
                  >
                    <IconChevron size={11} style={{ transform: showInfo ? 'rotate(90deg)' : 'none' }} />
                    {showInfo ? t('lore.issues.hideInfo') : t('lore.issues.showInfo', { n: infoIssues.length })}
                  </button>
                  {showInfo && (
                    <ul className="awu-issueList awu-loreIssueList" data-level="info">
                      {infoIssues.map((issue, i) => renderIssue(issue, `info-${i}`))}
                    </ul>
                  )}
                </div>
              )}
              {entries.length === 0 ? (
                <div className="awu-loreEmpty">
                  <div className="awu-editListEmpty">{t('lore.empty')}</div>
                  <div className="awu-hint">{t('lore.emptyHint')}</div>
                  <button type="button" className="awu-editAdd" onClick={addEntry}>
                    <IconPlus size={11} />
                    {t('lore.addFirst')}
                  </button>
                </div>
              ) : (
                <div className="awu-loreList">
                  {entries.map((entry, index) => (
                    <LoreEntryCard
                      key={entry.id}
                      entry={entry}
                      index={index}
                      total={entries.length}
                      open={expanded === entry.id}
                      issues={issuesByEntry.get(entry.id) ?? []}
                      t={t}
                      onToggle={() => setExpanded(current => (current === entry.id ? '' : entry.id))}
                      onPatch={patch => patchEntry(entry.id, patch)}
                      onMove={delta => onChangeEntries(moveEntry(entries, index, delta))}
                      onRemove={() => removeEntry(entry.id)}
                      onFullscreen={() => setFocusId(entry.id)}
                    />
                  ))}
                  <button type="button" className="awu-editAdd" onClick={addEntry}>
                    <IconPlus size={11} />
                    {t('lore.add')}
                  </button>
                </div>
              )}

              {/* 书级设置：折叠起来，默认不动 */}
              <details className="awu-loreFold">
                <summary>{t('lore.book')}</summary>
                <div className="awu-loreAdv">
                  <label className="awu-editField">
                    <span className="awu-editFieldKey">{t('lore.bookName')}</span>
                    <input
                      className="awu-input awu-editInput"
                      value={book.name}
                      placeholder={t('lore.bookNamePlaceholder')}
                      onChange={event => onChangeBook({ name: event.target.value })}
                    />
                  </label>
                  <label className="awu-editField">
                    <span className="awu-editFieldKey">{t('lore.bookDescription')}</span>
                    <input
                      className="awu-input awu-editInput"
                      value={book.description}
                      placeholder={t('lore.bookDescriptionPlaceholder')}
                      onChange={event => onChangeBook({ description: event.target.value })}
                    />
                  </label>
                  <div className="awu-loreGrid">
                    <label className="awu-editField">
                      <span className="awu-editFieldKey">{t('lore.scanDepth')}</span>
                      <input
                        className="awu-input awu-editInput"
                        type="number"
                        value={String(book.scanDepth)}
                        onChange={event => onChangeBook({ scanDepth: asInt(event.target.value, book.scanDepth) })}
                      />
                    </label>
                    <label className="awu-editField">
                      <span className="awu-editFieldKey">{t('lore.tokenBudget')}</span>
                      <input
                        className="awu-input awu-editInput"
                        type="number"
                        value={String(book.tokenBudget)}
                        onChange={event => onChangeBook({ tokenBudget: asInt(event.target.value, book.tokenBudget) })}
                      />
                    </label>
                  </div>
                  <label className="awu-switchRow">
                    <input
                      type="checkbox"
                      checked={book.recursiveScanning}
                      onChange={event => onChangeBook({ recursiveScanning: event.target.checked })}
                    />
                    <span>{t('lore.recursiveScanning')}</span>
                  </label>
                </div>
              </details>
            </>
          )}
        </div>
      )}

      {/* 全屏长文本层：本地缓冲，写完才提交回草稿 */}
      {focusEntry !== undefined && (
        <FocusEditor
          title={t('lore.focusTitle', {
            name: entryLabel(focusEntry) !== '' ? entryLabel(focusEntry) : t('lore.issueUnnamed', { n: entries.indexOf(focusEntry) + 1 }),
          })}
          value={focusEntry.content}
          placeholder={t('lore.contentPlaceholder')}
          labels={{
            back: t('common.cancel'),
            done: t('common.save'),
            chars: (n: number) => t('edit.chars', { n }),
            discardTitle: t('edit.discardTitle'),
            keepEditing: t('edit.keepEditing'),
            discard: t('edit.discard'),
          }}
          onDone={next => {
            patchEntry(focusEntry.id, { content: next })
            setFocusId('')
          }}
          onCancel={() => setFocusId('')}
        />
      )}
    </section>
  )
}
