/**
 * AI WITH U · 浏览器端入口
 *
 * 只在宿主的左侧栏底部贡献一个席位（`sidebar.footer.action`，与「用量余额」同位置）：
 * 收起态显示一枚圆徽，展开态显示「角色管理 / 当前角色名」，点击弹出悬浮面板。
 *
 * 三条硬规矩（都踩过坑）：
 *  1. `inject` 必须列出 apply 里读到的每一个服务 —— Cordis 4 的 Context 是 Proxy，
 *     读未声明的服务会直接抛错，`?.` 兜不住，整条 client fiber 会被判 failed；
 *  2. 声明制插槽必须 `slots.inject(name, () => slots.register(...))` 包住，裸 register
 *     会抛 `slot "xxx" is not declared`；
 *  3. 不能有 `export default`（Loader 会折叠模块并丢掉 inject）。
 * @module dsh-ai-with-u/client
 */
import { Component } from 'react'
import type { ComponentProps, ReactNode } from 'react'

import { CharacterPanel } from './index.js'
import { DockSink } from './distill.js'
import { localeDictionaries, makeTranslator } from './text.js'
import { installStyles } from './styles.js'

/** 本地化命名空间。 */
const NS = 'ai-with-u'

/**
 * 需要客户端服务。
 *
 * - `slots`  —— 注册侧栏席位；
 * - `locale` —— 注册中英文文案例。
 *
 * `effect` 是 cordis 注入到 Context 上的方法（`ctx.effect()`），属于 fiber mixin，
 * 不是可等待的服务；写进 inject 会让 fiber 永远等不到而卡在 pending。
 */
export const inject = ['slots', 'locale']

interface Disposable { (): void }

interface SlotApi {
  register: (
    definition: { name: string; id?: string; order?: number; locale?: string },
    component: unknown,
  ) => Disposable
  /** 声明制插槽：等所有者把席位声明出来后再执行回调；声明撤掉时回调的返回值被清理。 */
  inject: (name: string, callback: () => Disposable) => Disposable
}

interface LocaleApi {
  register: (namespace: string, dictionaries: Record<string, Record<string, string>>) => Disposable
}

interface ClientCtx {
  slots: SlotApi
  locale: LocaleApi
  effect: (callback: () => Disposable | void, label?: string) => Disposable
}

/** 面板组件的 props（`sidebar.footer.action` 由侧栏壳注入 `wide` / `t`）。 */
type PanelProps = ComponentProps<typeof CharacterPanel>

/**
 * 面板渲染异常兜底（全仓唯一的 P0）。
 *
 * 为什么必须有：`sidebar.footer.action` 的 slot entry 一旦在渲染期抛错，React 会卸载
 * 整棵子树，宿主那边表现为「侧栏席位整块消失」——用户看不到任何提示，日志里也只有
 * 一条被吞掉的 warn（同款事故见 `docs/PLUGIN-DEV-GUIDE.md` §2.6「抛错的 slot entry
 * 会整块空白」，以及 `scripts/verify-bundle.mjs` 文件头记录的那次「CSS 模板串被截断
 * → 模块初始化抛错 → 宿主静默跳过整个插件」）。
 *
 * 降级 UI 刻意保持极简：不依赖面板的任何 state / context / 服务，只用 `.awu-layer`
 * （它自己带 `--awu-*` 令牌）与 `.awu-btn`，所以**即使面板 CSS 也没注入成功**，
 * 这里退化成一颗原生按钮也仍然可点。文案走字典，中英同步。
 */
class PanelBoundary extends Component<{ children: ReactNode; t?: PanelProps['t'] }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false }

  /** 渲染期抛错 → 标记降级。这一层只切状态，不碰 DOM。 */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  /** 留一条全上下文日志，方便在宿主 renderer 日志里捞（禁止空 catch 的同一条纪律）。 */
  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    console.error(
      '[ai-with-u] 面板渲染失败，已降级为「重试」按钮（侧栏席位不会整块消失）',
      error,
      info.componentStack ?? '',
    )
  }

  /** 用户点「重试」：清掉降级标记，让 React 重新挂一次面板子树。 */
  private retry = (): void => {
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    // 拿不到宿主的 `t` 时 makeTranslator 会退回本地中文词典，绝不会裸显 key。
    const t = makeTranslator(this.props.t)
    const label = t('panel.crash')
    return (
      <div className="awu-layer" data-rail="true" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="awu-btn"
          data-size="sm"
          title={label}
          aria-label={`${label} · ${t('panel.crashRetry')}`}
          onClick={this.retry}
        >
          {t('panel.crashRetry')}
        </button>
      </div>
    )
  }
}

/**
 * 席位入口：面板外面永远包一层 `PanelBoundary`。
 *
 * 不直接把 `CharacterPanel` 注册进槽位，就是为了让「渲染期异常」只毁掉面板，
 * 不毁掉整个席位。
 */
export function CharacterEntry(props: PanelProps) {
  return (
    <PanelBoundary t={props.t}>
      <CharacterPanel {...props} />
    </PanelBoundary>
  )
}

/** 宿主侧插件上下文；只用到上面三个服务。 */
export function apply(ctx: ClientCtx): void {
  // 样式表全局只注入一次，插件卸载时移除，避免热重载后堆叠
  ctx.effect(() => {
    const injected = installStyles()
    return () => {
      if (!injected) return
      document.querySelector('style[data-plugin="dsh-ai-with-u"]')?.remove()
    }
  }, 'ai-with-u: styles')

  ctx.effect(
    () => ctx.locale.register(NS, localeDictionaries as unknown as Record<string, Record<string, string>>),
    'ai-with-u: dictionaries',
  )

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: NS,
    locale: NS,
    order: 10,
  }, CharacterEntry))

  /*
   * 蒸馏的发送通道（**不提供可见入口**）。
   *
   * 面板挂在 `sidebar.footer.action`，那个席位拿不到 `inputActions`；
   * 只有会话级席位（`conversation.composer.dock`）的标准 props 里才有
   * `inputActions` / `sessionId`。所以这里只挂一个**无渲染**的 DockSink，
   * 把能力存进模块级 sink 供面板里的「蒸馏」按钮调用。
   *
   * 主人明确要求：底部托盘不要再留一个单独的蒸馏按钮 —— 入口只在面板里。
   */
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: `${NS}:distill-sink`,
    locale: NS,
    order: 90,
  }, DockSink))
}

export { CharacterPanel }
