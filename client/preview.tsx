/**
 * AI WITH U · 注入预览
 *
 * 回答一个用户最常问的问题：「我这张卡，这一轮到底往提示词里塞了什么？」
 *
 * 数据只有一个只读接口：`GET /preview`（见 `api.ts` 的 `PreviewData`）。它给的是**当前会话
 * 下一次请求**的拼装快照：L0 底线、纪律包、L1 角色设定、世界书命中、时间差……每段带
 * `order` / `chars` / `text`。本组件只负责展示，不改任何状态、不写盘。
 *
 * 为什么内容本体交出去（`PromptPreview` 只渲染 `.awu-dialog` 内部）：
 * 遮罩 / 焦点三件套 / Esc 都在 `index.tsx` 的 `Overlay` 里，重复一份必然漂移；
 * 这里只做「三段概要 + 逐段折叠」。
 *
 * 容错：`GET /preview` 404（宿主还没做）→ 抛 `ApiUnavailableError` → 显示「接口未就绪」；
 * 其余错误原样透出。字段一律按可选处理，缺段缺字段都不会炸。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import { errorText, fetchPreview, isUnavailable } from './api'
import type { PreviewData, PreviewSegment } from './api'
import { IconAlert, IconChevron, IconRefresh, IconSpark } from './icons'
import type { Translate } from './text'

/** 宿主约定里 L1 角色设定段的 id（用来算「L1 字符数」）。 */
const L1_SEGMENT_ID = 'aiwu:active-character'

/** 段列表按 order 升序；缺 order 的排到最后（NaN 不参与比较）。 */
function sortSegments(segments: PreviewSegment[]): PreviewSegment[] {
  return [...segments].sort((a, b) => {
    const oa = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER
    const ob = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER
    return oa - ob
  })
}

/** 拨掉宿主可能塞进来的脏字段（老版本 / 未来版本都别炸）。 */
function normalizePreview(raw: PreviewData): PreviewData {
  const segments = Array.isArray(raw.segments) ? raw.segments : []
  const clean = segments
    .filter(seg => seg !== null && typeof seg === 'object')
    .map((seg, index) => ({
      id: typeof seg.id === 'string' && seg.id !== '' ? seg.id : `segment-${index}`,
      order: Number.isFinite(seg.order) ? Number(seg.order) : index,
      label: typeof seg.label === 'string' && seg.label !== '' ? seg.label : '',
      chars: Number.isFinite(seg.chars) ? Number(seg.chars) : (typeof seg.text === 'string' ? [...seg.text].length : 0),
      text: typeof seg.text === 'string' ? seg.text : '',
    }))
  const total = Number.isFinite(raw.total) ? Number(raw.total) : clean.reduce((sum, seg) => sum + seg.chars, 0)
  return {
    ok: true,
    active: raw.active ?? { enabled: false },
    segments: clean,
    total,
    mode: typeof raw.mode === 'string' ? raw.mode : undefined,
    discipline: typeof raw.discipline === 'string' ? raw.discipline : undefined,
  }
}

/** 纪律包档位的显示名（未知值原样显示）。 */
function disciplineLabel(value: string | undefined, t: Translate): string {
  if (value === undefined || value === '') return '—'
  if (value === 'off') return t('preview.discipline.off')
  if (value === 'lite') return t('preview.discipline.lite')
  if (value === 'full') return t('preview.discipline.full')
  return value
}

/**
 * 注入预览正文（渲染在面板的 `Overlay` 里）。
 *
 * `onClose` 只给底部「关闭」用；Esc / 点遮罩由外面那层 `Overlay` 处理。
 */
export function PromptPreview(props: { t: Translate; onClose: () => void }): JSX.Element {
  const { t, onClose } = props

  const [data, setData] = useState<PreviewData | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 宿主接口没就绪（404 无信封）：与「请求失败」分开，前者不该红字 */
  const [unavailable, setUnavailable] = useState(false)
  /** 哪些段展开了（key = 段 id）；默认全折叠，避免一屏几百行 */
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const load = useCallback((): void => {
    setLoading(true)
    setError('')
    setUnavailable(false)
    void fetchPreview()
      .then(raw => {
        if (!aliveRef.current) return
        setData(normalizePreview(raw))
      })
      .catch((e: unknown) => {
        if (!aliveRef.current) return
        setData(undefined)
        if (isUnavailable(e)) setUnavailable(true)
        else setError(errorText(e))
      })
      .finally(() => { if (aliveRef.current) setLoading(false) })
  }, [])

  // 打开即读一次；面板里的数据只在点「刷新」时变，免得看的时候自己跳
  useEffect(() => { load() }, [load])

  const segments = useMemo(() => (data === undefined ? [] : sortSegments(data.segments)), [data])
  const l1Chars = useMemo(
    () => segments.filter(seg => seg.id === L1_SEGMENT_ID).reduce((sum, seg) => sum + seg.chars, 0),
    [segments],
  )
  const enabled = data?.active?.enabled === true
  const activeName = data?.active?.character ?? ''

  const toggle = (id: string): void => {
    setOpenIds(current => ({ ...current, [id]: !(current[id] === true) }))
  }

  return (
    <>
      <div className="awu-dialogHead">
        <IconSpark size={16} />
        <span>{t('preview.title')}</span>
        <button
          type="button"
          className="awu-iconBtn"
          style={{ marginLeft: 'auto' }}
          title={t('preview.refresh')}
          aria-label={t('preview.refresh')}
          data-spin={loading ? 'true' : 'false'}
          onClick={load}
          disabled={loading}
        >
          {loading ? <IconSpark size={14} /> : <IconRefresh size={14} />}
        </button>
      </div>

      <div className="awu-dialogBody">
        <div className="awu-hint" style={{ marginBottom: 10 }}>{t('preview.hint')}</div>

        {loading && data === undefined && (
          <div className="awu-hint" role="status">{t('preview.loading')}</div>
        )}

        {unavailable && <div className="awu-hint" data-tone="warn">{t('preview.unavailable')}</div>}

        {error !== '' && (
          <div className="awu-err" role="alert">
            <IconAlert size={14} style={{ flex: 'none', marginTop: 1 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{t('preview.failed', { reason: error })}</span>
          </div>
        )}

        {data !== undefined && (
          <>
            {!enabled && <div className="awu-hint" data-tone="warn" style={{ marginBottom: 10 }}>{t('preview.inactive')}</div>}

            {/* 三段概要：总字符 / L1 / 纪律包档位 */}
            <div className="awu-previewSummary">
              <div className="awu-previewStat">
                <span className="awu-previewStatKey">{t('preview.total')}</span>
                <span className="awu-previewStatVal">{t('preview.chars', { n: data.total })}</span>
              </div>
              <div className="awu-previewStat">
                <span className="awu-previewStatKey">{t('preview.l1')}</span>
                <span className="awu-previewStatVal">{t('preview.chars', { n: l1Chars })}</span>
              </div>
              <div className="awu-previewStat">
                <span className="awu-previewStatKey">{t('preview.discipline')}</span>
                <span className="awu-previewStatVal">{disciplineLabel(data.discipline, t)}</span>
              </div>
              {enabled && activeName !== '' && (
                <div className="awu-previewStat">
                  <span className="awu-previewStatKey">{t('preview.activeLabel')}</span>
                  <span className="awu-previewStatVal">{activeName}</span>
                </div>
              )}
            </div>

            {segments.length === 0 ? (
              <div className="awu-hint">{t('preview.noSegments')}</div>
            ) : (
              <div className="awu-previewSegs">
                {segments.map(seg => {
                  const open = openIds[seg.id] === true
                  const empty = seg.text.trim() === ''
                  const title = seg.label !== '' ? seg.label : seg.id
                  return (
                    <section className="awu-previewSeg" key={seg.id} data-open={open ? 'true' : 'false'}>
                      <button
                        type="button"
                        className="awu-previewSegHead"
                        aria-expanded={open}
                        onClick={() => toggle(seg.id)}
                      >
                        <span className="awu-editGroupChevron" aria-hidden="true">
                          <IconChevron size={12} />
                        </span>
                        <span className="awu-previewSegLabel">{title}</span>
                        <span className="awu-previewSegId">{seg.id}</span>
                        <span className="awu-previewSegMeta">
                          {t('preview.order', { n: seg.order })} · {t('preview.chars', { n: seg.chars })}
                        </span>
                      </button>
                      {open && (
                        empty
                          ? <div className="awu-previewEmpty">{t('preview.emptySegment')}</div>
                          : <pre className="awu-previewText">{seg.text}</pre>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="awu-dialogFoot">
        <button type="button" className="awu-btn" onClick={load} disabled={loading}>
          {t('preview.refresh')}
        </button>
        <button type="button" className="awu-btn" data-kind="primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </>
  )
}
