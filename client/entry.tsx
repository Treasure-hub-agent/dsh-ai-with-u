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
import { CharacterPanel } from './index.js'
import { DockSink } from './distill.js'
import { localeDictionaries } from './text.js'
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
  }, CharacterPanel))

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
