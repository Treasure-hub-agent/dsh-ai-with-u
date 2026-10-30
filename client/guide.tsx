/**
 * AI WITH U · 使用指南（面板第 4 个 tab）
 *
 * 定位：让新用户 60 秒内知道「怎么用 / 能干什么 / 数据在哪 / 常见疑问」。
 * 纯展示组件：只接收翻译函数 `t`，不 fetch、不读写角色数据，也不订阅宿主状态。
 *
 * 唯一的状态副作用是首次引导标记：读写在浏览器 `localStorage`，**不落插件数据目录**
 * （`~/.dsh/ai-with-u/`），删掉只会让「指南」再当一次落地页，不丢任何记忆。
 * 读取 / 写入由 `index.tsx` 在面板打开时调用 `guideFirstRun()` / `markGuideSeen()`。
 */
import type { JSX } from 'react'

import { IconBook, IconQuill, IconSpark } from './icons'
import type { Translate } from './text'

/** 首次引导标记：`awu.` 前缀 + 功能名 + 版本号；以后改版直接升到 v2 重新引导。 */
export const GUIDE_SEEN_KEY = 'awu.guide.seen.v1'

/** 是否该把「指南」当首屏。读不到（隐私模式 / 无 storage）就当作已看过，宁可少打扰。 */
export function guideFirstRun(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) !== '1'
  } catch (error) {
    console.warn('[ai-with-u] 读取指南首次标记失败，按已看过处理', error)
    return false
  }
}

/** 记下「看过了」。写失败不影响使用，只留一条警告方便排查。 */
export function markGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, '1')
  } catch (error) {
    console.warn('[ai-with-u] 写入指南首次标记失败（localStorage 不可用）', error)
  }
}

// ---------------------------------------------------------------- 小组件

function GuideSection(props: { title: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <section className="awu-guide-sec">
      <h3 className="awu-guide-h">{props.title}</h3>
      <div className="awu-guide-body">{props.children}</div>
    </section>
  )
}

/** 带序号的一步。 */
function Step(props: { index: number; text: string }): JSX.Element {
  return (
    <div className="awu-guide-step">
      <span className="awu-guide-num">{props.index}</span>
      <span className="awu-guide-text">{props.text}</span>
    </div>
  )
}

/** 一行说明；`mono` 用于路径这类需要等宽对齐的内容。 */
function Line(props: { text: string; mono?: boolean }): JSX.Element {
  return (
    <div className="awu-guide-line" data-mono={props.mono === true ? 'true' : 'false'}>
      {props.text}
    </div>
  )
}

/** 「标签 + 说明」一行；标签可以带一枚 16 格视野的内联图标。 */
function KeyLine(props: { icon?: JSX.Element; name: string; text: string }): JSX.Element {
  return (
    <div className="awu-guide-keyed">
      {props.icon !== undefined && (
        <span className="awu-guide-ico" aria-hidden="true">{props.icon}</span>
      )}
      <span className="awu-guide-key">{props.name}</span>
      <span className="awu-guide-text">{props.text}</span>
    </div>
  )
}

/** 一条问答。 */
function Faq(props: { q: string; a: string }): JSX.Element {
  return (
    <div className="awu-guide-faq">
      <div className="awu-guide-q">{props.q}</div>
      <div className="awu-guide-a">{props.a}</div>
    </div>
  )
}

// ---------------------------------------------------------------- 主体

/**
 * 指南正文。六节：三步上手 / 它能帮什么 / 面板三块 / 8 个工具 / 数据在哪 / 常见疑问。
 * 每节 3-5 条，首屏覆盖前四节；数据与问答在下半屏，属于「回头查」的部分。
 */
export function GuideView(props: { t: Translate }): JSX.Element {
  const { t } = props
  return (
    <div className="awu-guide">
      <GuideSection title={t('guide.quickstart.title')}>
        <Step index={1} text={t('guide.quickstart.step1')} />
        <Step index={2} text={t('guide.quickstart.step2')} />
        <Step index={3} text={t('guide.quickstart.step3')} />
      </GuideSection>

      <GuideSection title={t('guide.help.title')}>
        <Line text={t('guide.help.1')} />
        <Line text={t('guide.help.2')} />
        <Line text={t('guide.help.3')} />
        <Line text={t('guide.help.4')} />
      </GuideSection>

      <GuideSection title={t('guide.sections.title')}>
        <KeyLine
          icon={<IconBook size={11} />}
          name={t('guide.sections.rosterName')}
          text={t('guide.sections.roster')}
        />
        <KeyLine
          icon={<IconQuill size={11} />}
          name={t('guide.sections.diaryName')}
          text={t('guide.sections.diary')}
        />
        <KeyLine
          icon={<IconSpark size={11} />}
          name={t('guide.sections.statsName')}
          text={t('guide.sections.stats')}
        />
      </GuideSection>

      <GuideSection title={t('guide.tools.title')}>
        <KeyLine name={t('guide.tools.diaryName')} text={t('guide.tools.diary')} />
        <KeyLine name={t('guide.tools.fixesName')} text={t('guide.tools.fixes')} />
        <KeyLine name={t('guide.tools.identityName')} text={t('guide.tools.identity')} />
        <KeyLine name={t('guide.tools.openingName')} text={t('guide.tools.opening')} />
        <div className="awu-guide-note">{t('guide.tools.note')}</div>
      </GuideSection>

      <GuideSection title={t('guide.data.title')}>
        <div className="awu-guide-path">
          <div className="awu-guide-pathLine">{t('guide.data.root')}</div>
          <div className="awu-guide-pathLine">{t('guide.data.rootWindows')}</div>
          <div className="awu-guide-pathHint">{t('guide.data.rootHint')}</div>
        </div>
        <Line text={t('guide.data.layout')} />
        <Line text={t('guide.data.backup')} />
        <Line text={t('guide.data.import')} />
        <div className="awu-guide-note">{t('guide.data.note')}</div>
      </GuideSection>

      <GuideSection title={t('guide.faq.title')}>
        <Faq q={t('guide.faq.q1')} a={t('guide.faq.a1')} />
        <Faq q={t('guide.faq.q2')} a={t('guide.faq.a2')} />
        <Faq q={t('guide.faq.q3')} a={t('guide.faq.a3')} />
      </GuideSection>
    </div>
  )
}
