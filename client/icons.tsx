/**
 * AI WITH U · 图标
 *
 * 全部内联 SVG，不依赖任何图标库（宿主图标集随时会改导出名，硬引用等于埋雷）。
 * 统一 16 格视野、描边 1.4、圆头圆角，和设计语言里的细线金边对得上。
 */
import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function icon(children: JSX.Element): (props: IconProps) => JSX.Element {
  // 多个兄弟 <path> 在 JSX 里是一个 Fragment，props.children 是数组。
  // 直接把数组塞进 svg 会触发 React 的 key 警告，这里在模块加载时一次加工好。
  const raw = (children as { props?: { children?: unknown } }).props?.children
  const parts: JSX.Element[] = Array.isArray(raw)
    ? (raw as JSX.Element[]).map((child, index) => <g key={index}>{child}</g>)
    : [<g key="single">{children}</g>]
  return function AwuIcon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {parts}
      </svg>
    )
  }
}

/** 剧场面具：牌面感的曲线轮廓，用作侧栏入口与空态。 */
export const IconMask = icon(
  <>
    <path d="M2.2 4.1c1.6-1 3.9-1 5.8 0 1.9-1 4.2-1 5.8 0v5.1c0 2.1-1.9 3.7-4.2 3.7-1 0-1.6-.3-1.6-.3s-.6.3-1.6.3C4.1 12.9 2.2 11.3 2.2 9.2z" />
    <path d="M5.1 6.6c.5-.5 1.2-.5 1.7 0M9.2 6.6c.5-.5 1.2-.5 1.7 0" />
    <path d="M6.4 9.4c.9.7 2.3.7 3.2 0" />
  </>,
)

/** 书册：角色簿。 */
export const IconBook = icon(
  <>
    <path d="M3 3.1h6.2A2.8 2.8 0 0 1 12 5.9v7.4H5.8A2.8 2.8 0 0 1 3 10.5z" />
    <path d="M3 10.5h9" />
    <path d="M5.6 5.6h3.6" />
  </>,
)

/** 羽毛笔：日记。 */
export const IconQuill = icon(
  <>
    <path d="M13 2.6c-3.6.3-6.4 2.4-7.7 5.3-.4.9-.6 1.8-.6 2.7" />
    <path d="M4.7 10.6 3 13.4l2.9-.6" />
    <path d="M7.6 6.6c1.1-.9 2.4-1.5 3.7-1.7" />
  </>,
)

/** 星轨：统计。 */
export const IconSpark = icon(
  <>
    <path d="M8 2.2 9.4 6l3.8 1.4L9.4 8.8 8 12.6 6.6 8.8 2.8 7.4 6.6 6z" />
    <path d="M12.6 11.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" />
  </>,
)

/** 刷新。 */
export const IconRefresh = icon(
  <>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7" />
    <path d="M13.2 2.6v2.8h-2.8" />
  </>,
)

/** 关闭。 */
export const IconClose = icon(<path d="M4 4l8 8M12 4l-8 8" />)

/** 返回。 */
export const IconBack = icon(<path d="M9.8 3.4 5.2 8l4.6 4.6" />)

/** 前进 / 进入详情。 */
export const IconChevron = icon(<path d="M6.2 3.4 10.8 8l-4.6 4.6" />)

/** 加号。 */
export const IconPlus = icon(<path d="M8 3.4v9.2M3.4 8h9.2" />)

/** 电源：启用。 */
export const IconPower = icon(
  <>
    <path d="M8 2.6v4.6" />
    <path d="M11.6 4.6a5 5 0 1 1-7.2 0" />
  </>,
)

/** 拔出：退出。 */
export const IconEject = icon(
  <>
    <path d="M8 2.4 12.2 8.6H3.8z" />
    <path d="M3.8 11.4h8.4" />
  </>,
)

/** 垃圾桶。 */
export const IconTrash = icon(
  <>
    <path d="M3.2 4.6h9.6" />
    <path d="M6.2 4.6V3.2h3.6v1.4" />
    <path d="M4.5 4.6l.6 8c0 .5.4.8.9.8h4c.5 0 .9-.3.9-.8l.6-8" />
    <path d="M6.8 7.2v3.6M9.2 7.2v3.6" />
  </>,
)

/** 文本模式。 */
export const IconText = icon(
  <>
    <path d="M3.2 4.2h9.6M8 4.2v8.4" />
    <path d="M6.2 12.6h3.6" />
  </>,
)

/** 动作模式。 */
export const IconMotion = icon(
  <>
    <path d="M3.4 11.6c1.4-3.4 3.2-5.6 5.2-6.6" />
    <path d="M8.6 5c1.6.3 3.1 1.2 4 2.6" />
    <circle cx="4.4" cy="4.4" r="1.1" />
  </>,
)

/** 正在运行的小转圈（占位用，CSS 给它转）。 */
export const IconSpinner = icon(
  <>
    <path d="M8 2.4a5.6 5.6 0 1 1-5.6 5.6" opacity="0.9" />
  </>,
)

/** 警告 / 错误。 */
export const IconAlert = icon(
  <>
    <path d="M8 2.8 14 13H2z" />
    <path d="M8 6.6v3M8 11.2v.1" />
  </>,
)
