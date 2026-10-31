/**
 * AI WITH U · 记忆回顾（日记页增强）
 *
 * 三件事，全是前端，不碰后端：
 *  1. **搜索**：按关键词过滤，时间线 / 心情札记都搜；大小写不敏感（`toLowerCase`），
 *     全半角不敏感（`normalize('NFKC')`，中文输入法里常见的全角字母/数字都归一）。
 *     只过滤、**不改行号**——每一行都带着它在原日记里的 `section + index`，
 *     这样搜索状态下点「改写」仍然改的是正确那一条。
 *  2. **按月折叠**：日期串可能是 `2026 10 05` / `2026-10-05`（解析器两种都认），
 *     这里只取年月分组，标题形如「2026 年 10 月」；默认只展开最近一个月（搜索时全展开）。
 *  3. **导出 markdown**：内容**逐字对齐 store 的 diary.md 结构**
 *     （`src/store.ts` 的 `writeDiaryUnlocked`：`# {名}的日记` / `## 日期` / `**时间线**` /
 *     两空格缩进行 / `**心情札记**` / `> 引用行`），导出件可以直接当备份、也能再塞回磁盘。
 *
 * 为什么单独一个文件：`index.tsx` 已经很长，而这一块是「纯函数 + 列表 UI」，
 * 单独放便于对着日记格式自检（`diaryToMarkdown` 是纯函数）。
 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { DiaryEntry } from './api'
import { IconChevron, IconDownload, IconQuill } from './icons'
import type { Translate } from './text'

/** 一条可改写的日记行（与原日记里的位置一一对应）。 */
export interface DiaryTarget {
  date: string
  section: 'timeline' | 'notes'
  index: number
  text: string
}

/** 分组里的一行。 */
interface ReviewLine {
  text: string
  section: 'timeline' | 'notes'
  /** 在原 `entry.timeline` / `entry.notes` 里的下标（改写要用） */
  index: number
}

interface ReviewDay {
  date: string
  lines: ReviewLine[]
}

interface ReviewMonth {
  /** `2026-10` 这种稳定 key */
  key: string
  year: string
  month: string
  days: ReviewDay[]
}

/** 大小写 + 全半角都归一，用于匹配与搜索。 */
function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

/** 从 `2026 10 05` / `2026-10-05` / `2026/10/05` 里取年月；解析不出来时返回 undefined。 */
function monthOf(date: string): { key: string; year: string; month: string } | undefined {
  const matched = /^(\d{4})\D*(\d{1,2})/u.exec(date.trim())
  if (matched === null) return undefined
  const year = matched[1]
  const month = matched[2].padStart(2, '0')
  return { key: `${year}-${month}`, year, month }
}

/** 条目内换行会破坏「一行一条」：导出前拍平（与 store 写盘同一规则）。 */
function flatten(text: string): string {
  return String(text ?? '').replace(/\s*\r?\n\s*/gu, ' ').trim()
}

/**
 * 日记 → markdown（**逐字对齐 store 的 diary.md 结构**）。
 *
 * 结构（`src/store.ts:860` `writeDiaryUnlocked`）：
 * ```
 * # 名字的日记
 *
 * ## 2026 10 05
 * **时间线**
 *   xxx
 *
 * **心情札记**
 * > xxx
 * ```
 * 空段整段省略；末尾一个换行。
 */
export function diaryToMarkdown(name: string, entries: DiaryEntry[]): string {
  const blocks: string[] = [`# ${name}的日记`]
  for (const entry of entries) {
    blocks.push(`\n## ${entry.date}`)
    const timeline = entry.timeline.map(flatten).filter(item => item !== '')
    if (timeline.length > 0) {
      blocks.push('**时间线**')
      for (const item of timeline) blocks.push(`  ${item}`)
    }
    const notes = entry.notes.map(flatten).filter(item => item !== '')
    if (notes.length > 0) {
      blocks.push('\n**心情札记**')
      for (const item of notes) blocks.push(`> ${item}`)
    }
  }
  return `${blocks.join('\n')}\n`
}

/** 下载一个文本文件（Blob + 隐藏 a）。失败不抛：面板另有可见的兜底提示价值不大。 */
function downloadText(fileName: string, text: string): void {
  try {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // 立刻 revoke 在部分内核会让下载直接失败，隔一拍再放
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    console.error('[ai-with-u] 导出日记失败', error)
  }
}

/** 文件名里的日期戳：`YYYYMMDD`。 */
function stampOf(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}${month}${day}`
}

/**
 * 记忆回顾：搜索 + 按月折叠 + 导出。
 *
 * `entries` 为空时由外层（`DiaryView`）走「还没有日记」的空态，这里不重复处理。
 */
export function DiaryReview(props: {
  name: string
  entries: DiaryEntry[]
  t: Translate
  onEdit: (target: DiaryTarget) => void
}): JSX.Element {
  const { name, entries, t, onEdit } = props
  const [keyword, setKeyword] = useState('')
  /** 用户手动折叠/展开过的月份（未出现的月份按「最近一个月默认展开」算） */
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({})

  /** 全部月份（新→旧），带每一天的行与原始下标。 */
  const months = useMemo<ReviewMonth[]>(() => {
    const byMonth = new Map<string, ReviewMonth>()
    // 日期倒序：与 `sortedDiary` 同口径（新的一天在前）
    const days = [...entries].sort((a, b) => b.date.localeCompare(a.date))
    for (const entry of days) {
      const lines: ReviewLine[] = [
        ...entry.timeline.map((text, index) => ({ text, section: 'timeline' as const, index })),
        ...entry.notes.map((text, index) => ({ text, section: 'notes' as const, index })),
      ].filter(line => line.text.trim() !== '')
      if (lines.length === 0) continue
      const month = monthOf(entry.date)
      const key = month?.key ?? 'unknown'
      const bucket = byMonth.get(key)
      if (bucket === undefined) {
        byMonth.set(key, {
          key,
          year: month?.year ?? '',
          month: month?.month ?? '',
          days: [{ date: entry.date, lines }],
        })
      } else {
        bucket.days.push({ date: entry.date, lines })
      }
    }
    return [...byMonth.values()]
  }, [entries])

  const foldedKeyword = fold(keyword.trim())

  /** 搜索后的月份（只留命中的行；行号保持原样）。 */
  const filtered = useMemo<ReviewMonth[]>(() => {
    if (foldedKeyword === '') return months
    const out: ReviewMonth[] = []
    for (const month of months) {
      const days: ReviewDay[] = []
      for (const day of month.days) {
        const lines = day.lines.filter(line => fold(line.text).includes(foldedKeyword))
        if (lines.length > 0) days.push({ date: day.date, lines })
      }
      if (days.length > 0) out.push({ ...month, days })
    }
    return out
  }, [months, foldedKeyword])

  const hitCount = useMemo(
    () => filtered.reduce((sum, month) => sum + month.days.reduce((n, day) => n + day.lines.length, 0), 0),
    [filtered],
  )

  const latestMonthKey = months.length > 0 ? months[0].key : ''

  const isOpen = (key: string): boolean => {
    // 搜索时全展开：看不见命中的行，搜索就没意义
    if (foldedKeyword !== '') return true
    const manual = openOverride[key]
    if (manual !== undefined) return manual
    return key === latestMonthKey
  }

  const toggleMonth = (key: string): void => {
    setOpenOverride(current => ({ ...current, [key]: !(current[key] ?? key === latestMonthKey) }))
  }

  const onExport = (): void => {
    const fileName = `${name}-日记-${stampOf(new Date())}.md`
    downloadText(fileName, diaryToMarkdown(name, entries))
  }

  const searchId = 'awu-diary-search'

  return (
    <div className="awu-review">
      <div className="awu-reviewBar">
        <input
          id={searchId}
          className="awu-input awu-reviewInput"
          type="search"
          value={keyword}
          placeholder={t('diary.searchPlaceholder')}
          aria-label={t('diary.search')}
          onChange={event => setKeyword(event.target.value)}
        />
        {foldedKeyword !== '' && (
          <>
            <span className="awu-reviewHits">{t('diary.hitCount', { n: hitCount })}</span>
            <button
              type="button"
              className="awu-btn"
              data-size="sm"
              data-kind="ghost"
              onClick={() => setKeyword('')}
            >
              {t('diary.searchClear')}
            </button>
          </>
        )}
        <button
          type="button"
          className="awu-btn"
          data-size="sm"
          data-kind="ghost"
          style={{ marginLeft: 'auto' }}
          onClick={onExport}
          title={t('diary.exportHint')}
        >
          <IconDownload size={12} />
          {t('diary.export')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="awu-empty" data-kind="diary">
          <span className="awu-emptyMark"><IconQuill size={20} /></span>
          <span className="awu-emptyHint">{t('diary.noMatch', { keyword: keyword.trim() })}</span>
        </div>
      ) : (
        <div className="awu-reviewMonths">
          {filtered.map(month => {
            const open = isOpen(month.key)
            const lineCount = month.days.reduce((n, day) => n + day.lines.length, 0)
            const title = month.year === ''
              ? month.key
              : t('diary.monthTitle', { year: month.year, month: month.month })
            return (
              <section className="awu-reviewMonth" key={month.key} data-open={open ? 'true' : 'false'}>
                <button
                  type="button"
                  className="awu-reviewMonthHead"
                  aria-expanded={open}
                  onClick={() => toggleMonth(month.key)}
                >
                  <span className="awu-editGroupChevron" aria-hidden="true">
                    <IconChevron size={12} />
                  </span>
                  <span className="awu-reviewMonthTitle">{title}</span>
                  <span className="awu-reviewMonthMeta">{t('diary.hitCount', { n: lineCount })}</span>
                </button>
                {open && (
                  <div className="awu-diary">
                    {month.days.map(day => (
                      <div className="awu-day" key={`${month.key}-${day.date}`}>
                        <div className="awu-dayDate">{day.date}</div>
                        {day.lines.map(line => (
                          <div className="awu-line" key={`${line.section}-${line.index}`}>
                            <span className="awu-lineMarker">{t(`diary.marker.${line.section}`)}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>{line.text}</span>
                            <button
                              type="button"
                              className="awu-lineEdit"
                              title={t('diary.edit')}
                              aria-label={t('diary.edit')}
                              onClick={() => onEdit({
                                date: day.date,
                                section: line.section,
                                index: line.index,
                                text: line.text,
                              })}
                            >
                              {t('diary.edit')}
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
