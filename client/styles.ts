/**
 * AI WITH U · 「夜繭 / Night Cocoon」设计语言
 *
 * 一套只属于角色扮演管理器的视觉体系，刻意不跟随 DSH 默认皮肤：
 *  - 画布：深夜褐黑（不是纯黑），四角各有极淡的光晕，像房间里只留了一盏灯；
 *  - 强调：琥珀金 → 玫瑰金 → 烟霞粉 的渐变，用在徽标、描边、启用态与进度；
 *  - 字体：衬线体承担「人物感」（名字、标题、信件），无衬线体承担「工具感」
 *    （按钮、数字、标签），两套字通过字号/字重/字距形成清晰的三级层级；
 *  - 动效：一档缓入缓出（cubic-bezier(.22,.61,.36,1)），面板「从按钮长出来」，
 *    卡片错峰升起，启用态有一圈缓慢呼吸的辉光。
 *
 * 所有选择器都收敛在 `.awu-*` 前缀下，宿主样式不会被污染。
 * 依赖宿主的地方只有两处：`data-ds-dark-theme` 与 `prefers-reduced-motion`。
 */

/** 统一的缓动与圆角，组件里也用得上。 */
export const EASE = 'cubic-bezier(.22,.61,.36,1)'

import { DISTILL_CSS } from './distill.styles'
import { GUIDE_CSS } from './guide.styles'

/** 面板宽度（px）：CSS 与 JS 共用的唯一来源（index.tsx 的 computePosition 也引用它）。 */
export const PANEL_WIDTH = 452

/** 面板最大高（px）：同上，避免 CSS 与 JS 各写一份魔法数。 */
export const PANEL_MAX_H = 720

/** 卡片错峰升起的每张延迟（ms）：JS 的 animationDelay 与 CSS 的动画节奏共用。 */
export const CARD_STAGGER = 34

/**
 * 设计语言的全部 CSS。
 *
 * 结构：变量层 → 基底 → 侧栏按钮 → 悬浮面板骨架 → 头部 → 统计 → 卡片墙 →
 *       详情页 → 日记 → 弹层 → 动效 / 无障碍。
 */
const CSS = `
/* ================================================================ 变量层 */
/* 弹层是 createPortal 到 document.body 的，挂在 .awu-scope / .awu-layer 之外，
   所以 scrim / dialog 自身也必须进这张变量清单，否则 var(--awu-*) 全是无效声明
   （背景、圆角、z-index、入场动画会集体退化）。
   注意：下面浅色块的 `.awu-*` 类名清单必须与本段**逐字一致**，两边同步增删。 */
.awu-scope,
.awu-layer,
.awu-scrim,
.awu-dialog {
  /* ---- 墨色 4 级 ---- */
  /* ink-faint 只允许用于线条/装饰/禁用态，不得用于文字：实测对面板底色只有 2.93:1（浅色 2.92:1），
     连 WCAG AA-large 的 3.0 都不到。所有 11px 及以下文字一律用 ink-mute（深 4.66:1 / 浅 4.99:1）。 */
  --awu-ink: #f6ece0;
  --awu-ink-dim: #bdae9d;
  --awu-ink-mute: #8f8172;
  --awu-ink-faint: #6d6154;

  /* ---- 线 / 面 ---- */
  --awu-line: rgba(244, 208, 160, .11);
  --awu-line-strong: rgba(244, 208, 160, .22);
  --awu-surface: rgba(31, 23, 19, .9);
  --awu-surface-2: rgba(255, 226, 190, .035);
  --awu-surface-3: rgba(255, 226, 190, .065);
  --awu-surface-field: rgba(0, 0, 0, .18);
  --awu-surface-strip: transparent;
  --awu-surface-foot: rgba(20, 14, 11, .5);
  --awu-surface-dialog: rgba(30, 22, 18, .97);

  /* ---- 强调 ---- */
  --awu-gold: #e9bd72;
  --awu-gold-hi: #ffd894;
  --awu-rose: #e2917f;
  --awu-pink: #f2b6c6;
  --awu-teal: #86c9bd;
  --awu-danger: #e2796b;
  /* 渐变底上的文字色：替掉原先散落在 4 处的 #241a12 与 2 处浅色补丁 */
  --awu-on-accent: #241a12;
  --awu-grad: linear-gradient(118deg, #ffd894 0%, #e9a37c 46%, #d98ba8 100%);
  --awu-grad-soft: linear-gradient(118deg, rgba(255, 216, 148, .2), rgba(217, 139, 168, .2));

  /* ---- 字体 ---- */
  --awu-serif: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "Georgia", serif;
  --awu-sans: "Inter", "SF Pro Text", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --awu-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", monospace;

  /* ---- 字号 9 档 ---- */
  /* 中文下限 11px：9-10px 只给不含汉字的元素（kicker、kind 标签、等宽数字、source 徽）。 */
  --awu-fs-micro: 9px;
  --awu-fs-caption: 10px;
  --awu-fs-label: 11px;
  --awu-fs-body: 12px;
  --awu-fs-body-lg: 13px;
  --awu-fs-control: 14px;
  --awu-fs-title: 15px;
  --awu-fs-headline: 19px;
  --awu-fs-display: 23px;

  /* ---- 行高 4 档（与字号强制配对：title/headline 用 tight；label/caption 用 snug；
     正文用 body；只有日记正文用 loose） ---- */
  --awu-lh-tight: 1.25;
  --awu-lh-snug: 1.4;
  --awu-lh-body: 1.65;
  --awu-lh-loose: 1.8;

  /* ---- 间距 10 档 + 唯一 gutter ---- */
  --awu-gap-1: 2px;
  --awu-gap-2: 4px;
  --awu-gap-3: 6px;
  --awu-gap-4: 8px;
  --awu-gap-5: 10px;
  --awu-gap-6: 12px;
  --awu-gap-7: 16px;
  --awu-gap-8: 20px;
  --awu-gap-9: 24px;
  --awu-gap-10: 32px;
  /* 面板左右唯一内容边距：原先 16 / 17 / 18 / 22 四个值混用，边缘肉眼可见不齐 */
  --awu-gutter: 16px;

  /* ---- 尺寸 7 档 ---- */
  --awu-size-hit: 24px;
  --awu-size-icon: 28px;
  --awu-size-mark: 26px;
  --awu-size-rail: 36px;
  --awu-size-avatar: 34px;
  --awu-size-avatar-lg: 50px;
  --awu-size-empty: 44px;

  /* ---- 圆角 6 档 ---- */
  --awu-r-xs: 4px;
  --awu-r-sm: 8px;
  --awu-r-md: 12px;
  --awu-r-lg: 16px;
  --awu-r-xl: 20px;
  --awu-r-pill: 99px;

  /* ---- 动效：唯一缓动 + 5 个时长 + 1 个环境档 ---- */
  --awu-ease: ${EASE};
  --awu-dur-1: .12s;
  --awu-dur-2: .18s;
  --awu-dur-3: .24s;
  --awu-dur-4: .34s;
  --awu-dur-5: .6s;
  --awu-dur-breathe: 3.4s;

  /* ---- 层：值刻意保持不变，只起名。panel/scrim 是 body 级 portal 与宿主抢栈的经验值，
     调小会被宿主面板顶掉，调大会盖住宿主自己的弹层。改动时只允许整体抬升（scrim = panel + 100）。 ---- */
  --awu-z-panel: 2147482000;
  --awu-z-inset: 5;
  --awu-z-scrim: 2147482100;

  /* ---- 面板与弹层的结构尺码（CSS 与 JS 的单一来源） ---- */
  --awu-panel-w: ${PANEL_WIDTH}px;
  --awu-panel-max-h: ${PANEL_MAX_H}px;
  --awu-dialog-w: 420px;
  --awu-dialog-max-h: 640px;

  --awu-shadow: 0 28px 64px rgba(0, 0, 0, .56), 0 6px 20px rgba(0, 0, 0, .34);
  --awu-scroll: rgba(233, 189, 114, .22);

  /* 宿主的系统滚动条钩子：我们这里换成金色的细棒 */
  --dsh-scrollbar-thumb: var(--awu-scroll);
  --dsh-scrollbar-thumb-hover: rgba(233, 189, 114, .42);
}

/* 浅色主题：把「夜」换成「晨纸」，同一套关系重新配平。
   本块是全文件唯一的浅色覆盖点——组件规则里不得再出现任何主题补丁，
   否则改 token 时浅色态不会跟着变。

   ⚠️ 选择器必须与上面变量块**逐一对齐**：scope / layer / scrim / dialog。
   少一个，那一类节点在浅色宿主里就会退回深色 token（弹层变成暗底亮字，
   而它 portal 在 body 上、没有 .awu-scope 祖先可以兜底）。 */
html:not([data-ds-dark-theme]) .awu-scope,
html:not([data-ds-dark-theme]) .awu-layer,
html:not([data-ds-dark-theme]) .awu-scrim,
html:not([data-ds-dark-theme]) .awu-dialog {
  --awu-ink: #2b2019;
  --awu-ink-dim: #52443a;
  --awu-ink-mute: #756452;
  --awu-ink-faint: #9a8a7b;
  --awu-line: rgba(120, 82, 40, .16);
  --awu-line-strong: rgba(120, 82, 40, .28);
  --awu-surface: rgba(246, 239, 229, .97);
  --awu-surface-2: rgba(120, 82, 40, .05);
  --awu-surface-3: rgba(120, 82, 40, .09);
  --awu-surface-field: rgba(255, 253, 248, .62);
  --awu-surface-strip: rgba(255, 252, 245, .55);
  --awu-surface-foot: rgba(252, 247, 240, .75);
  --awu-surface-dialog: rgba(246, 239, 229, .99);
  --awu-gold: #8f5f22;
  --awu-gold-hi: #a97230;
  --awu-rose: #9c5232;
  --awu-pink: #9c4468;
  --awu-teal: #2f6b60;
  --awu-danger: #9e3b28;
  --awu-on-accent: #fff8ee;
  --awu-grad: linear-gradient(118deg, #d9a95c 0%, #c98457 46%, #b96a86 100%);
  --awu-scroll: rgba(143, 95, 34, .3);
  --awu-shadow: 0 24px 56px rgba(74, 48, 20, .16), 0 4px 14px rgba(74, 48, 20, .09);
}

/* ================================================================ 侧栏按钮 */
.awu-layer {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  /* 不写死 width：宿主的 footerActions 在收起态是 width:auto + justify-content:center，
     写死 100% 会以 0 宽度为基准算出 4px 的怪值。用 stretch + max-width 让它跟着容器走，
     同时在窄容器里也不会把自己撑出去。 */
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  margin: 4px -2px;
  font-family: var(--awu-sans);
  color: var(--awu-ink);
  /* 侧栏是宿主的浅/深皮肤，这里给按钮自己铺一层夜底，形成「入口属于另一个世界」的对比 */
}

.awu-trigger {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-5);
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  height: 44px;
  padding: 0 12px 0 10px;
  border: 1px solid transparent;
  border-radius: var(--awu-r-md);
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  font-size: var(--awu-fs-body-lg);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background var(--awu-dur-3) var(--awu-ease), border-color var(--awu-dur-3) var(--awu-ease),
    box-shadow var(--awu-dur-3) var(--awu-ease), transform var(--awu-dur-1) var(--awu-ease);
}

/* 常驻的极淡暖色，让按钮哪怕不 hover 也不是纯透明 */
.awu-trigger::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(120deg, color-mix(in srgb, var(--awu-gold-hi) 7%, transparent), color-mix(in srgb, var(--awu-pink) 5%, transparent) 60%, transparent);
  opacity: .8;
  pointer-events: none;
  transition: opacity var(--awu-dur-3) var(--awu-ease);
}

.awu-trigger:hover::before { opacity: 1; }

.awu-trigger:hover {
  border-color: var(--awu-line-strong);
  box-shadow: 0 8px 22px rgba(0, 0, 0, .18), inset 0 1px 0 rgba(255, 232, 200, .07);
}

.awu-trigger:active { transform: scale(.985); }

.awu-trigger[data-open="true"] {
  border-color: color-mix(in srgb, var(--awu-gold) 42%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 16%, transparent), 0 10px 26px rgba(0, 0, 0, .26);
}

.awu-trigger:focus-visible {
  outline: 2px solid var(--awu-gold);
  outline-offset: 2px;
}

/* 徽标：字母 + 渐变描边；启用时外圈呼吸 */
.awu-mark {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-mark);
  height: var(--awu-size-mark);
  border-radius: var(--awu-r-sm);
  color: var(--awu-on-accent);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 700;
  line-height: 1;
  background: var(--awu-grad);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--awu-rose) 34%, transparent), inset 0 1px 0 rgba(255, 255, 255, .45);
}

.awu-mark::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: var(--awu-r-md);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 34%, transparent);
  opacity: 0;
  transition: opacity var(--awu-dur-3) var(--awu-ease);
}

.awu-trigger[data-live="true"] .awu-mark::after {
  opacity: 1;
  animation: awu-breathe var(--awu-dur-breathe) ease-in-out infinite;
}

/* 按钮文字区：两行，标签在上、角色名在下 */
.awu-triggerText {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.awu-triggerLabel {
  font-size: var(--awu-fs-body-lg);
  font-weight: 600;
  letter-spacing: .02em;
  line-height: var(--awu-lh-snug);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: var(--awu-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.awu-triggerName {
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--awu-dur-3) var(--awu-ease);
}

.awu-trigger[data-live="true"] .awu-triggerName { color: var(--awu-ink-dim); }

/* 状态灯：启用=琥珀呼吸，未启用=暗点，禁用=横杠 */
.awu-lamp {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awu-ink-mute);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, .06);
  transition: background var(--awu-dur-3) var(--awu-ease), box-shadow var(--awu-dur-3) var(--awu-ease);
}

.awu-lamp[data-on="true"] {
  background: var(--awu-gold-hi);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--awu-gold) 14%, transparent), 0 0 10px color-mix(in srgb, var(--awu-gold-hi) 70%, transparent);
  animation: awu-pulse 2.6s ease-in-out infinite;
}

/* 收起态：只剩一枚 36px 的圆徽 */
.awu-layer[data-rail="true"] {
  flex: 0 0 auto;
  width: var(--awu-size-rail);
  max-width: 100%;
  height: var(--awu-size-rail);
  margin: 0;
}

.awu-layer[data-rail="true"] .awu-trigger {
  flex: 0 0 var(--awu-size-rail);
  width: var(--awu-size-rail);
  max-width: 100%;
  height: var(--awu-size-rail);
  min-width: 0;
  padding: 0;
  gap: 0;
  border-radius: 50%;
  justify-content: center;
}

/* 窄轨下文字节点本来就不渲染（条件渲染），这两条是防御：万一别处塞进来也不会换行 */
.awu-layer[data-rail="true"] .awu-triggerText,
.awu-layer[data-rail="true"] .awu-lamp { display: none; }

.awu-layer[data-rail="true"] .awu-mark { width: var(--awu-size-hit); height: var(--awu-size-hit); border-radius: 50%; font-size: var(--awu-fs-body-lg); }

/* ================================================================ 悬浮面板骨架 */
.awu-panel {
  /* fixed 定位；编辑器的「未保存确认」需要在面板内 absolute 覆盖，所以这里也要是包含块 */
  position: fixed;
  z-index: var(--awu-z-panel);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: var(--awu-panel-w);
  max-width: calc(100vw - 20px);
  max-height: min(78vh, var(--awu-panel-max-h));
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-xl);
  background:
    radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, var(--awu-gold-hi) 10%, transparent), transparent 58%),
    radial-gradient(110% 80% at 100% 0%, color-mix(in srgb, var(--awu-pink) 10%, transparent), transparent 62%),
    radial-gradient(140% 100% at 50% 120%, rgba(134, 201, 189, .06), transparent 60%),
    var(--awu-surface);
  backdrop-filter: blur(26px) saturate(140%);
  -webkit-backdrop-filter: blur(26px) saturate(140%);
  box-shadow: var(--awu-shadow), inset 0 1px 0 rgba(255, 236, 210, .08);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  overflow: hidden;
  transform-origin: left bottom;
  animation: awu-panel-in var(--awu-dur-3) var(--awu-ease);
}

/* 面板顶部那道金线：整套 UI 的「签名」 */
.awu-panel::before {
  content: "";
  position: absolute;
  top: 0;
  left: var(--awu-gutter);
  right: var(--awu-gutter);
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--awu-gold-hi) 80%, transparent) 22%, color-mix(in srgb, var(--awu-pink) 70%, transparent) 68%, transparent);
  pointer-events: none;
}

/* ================================================================ 头部 */
.awu-head {
  flex: none;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-6) var(--awu-gutter) var(--awu-gap-5);
}

.awu-headMain { min-width: 0; flex: 1; }

.awu-kicker {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .26em;
  text-transform: uppercase;
  color: var(--awu-gold);
  opacity: .85;
}

.awu-kicker::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--awu-gold) 34%, transparent), transparent);
}

.awu-title {
  margin-top: var(--awu-gap-2);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: .04em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-ink);
}

.awu-title em {
  font-style: normal;
  background: var(--awu-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.awu-headActions { display: flex; align-items: center; gap: var(--awu-gap-2); flex: none; margin-top: -2px; }

.awu-iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-icon);
  height: var(--awu-size-icon);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--awu-r-sm);
  background: transparent;
  color: var(--awu-ink-mute);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease),
    border-color var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-3) var(--awu-ease);
}

.awu-iconBtn:hover {
  color: var(--awu-ink);
  background: var(--awu-surface-3);
  border-color: var(--awu-line);
}

.awu-iconBtn:active { transform: scale(.94); }
.awu-iconBtn:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }
.awu-iconBtn[data-spin="true"] svg { animation: awu-spin .9s linear infinite; }

/* ---- 状态带：启用 / 未启用 / 提示 / 错误，四种状态共用一套几何 ----
   旧名 .awu-sigil（启用）与 .awu-idle（未启用 / 提示）保留为别名，
   这样 CSS 可以先落地，index.tsx 的 JSX 晚一步切到 .awu-status + data-status 也不掉样式。 */
.awu-status,
.awu-sigil,
.awu-idle {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-5);
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  min-height: 40px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  overflow: hidden;
  color: var(--awu-ink-mute);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
}

/* 左轨 2px：只有 live / alert 有，颜色由状态决定 */
.awu-status[data-status="live"]::before,
.awu-status[data-status="alert"]::before,
.awu-sigil::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--awu-grad);
}

.awu-status[data-status="live"],
.awu-sigil {
  border-color: color-mix(in srgb, var(--awu-gold) 26%, transparent);
  background:
    linear-gradient(100deg,
      color-mix(in srgb, var(--awu-gold-hi) 14%, transparent),
      color-mix(in srgb, var(--awu-pink) 10%, transparent) 60%,
      transparent),
    var(--awu-surface-2);
}

/* 进场扫一次就停：原先 5.2s 无限循环，与卡片辉光、头像呼吸、状态灯四个动画在表达同一件事 */
.awu-status[data-status="live"]::after,
.awu-sigil::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%,
    color-mix(in srgb, var(--awu-gold-hi) 16%, transparent) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: awu-sheen var(--awu-dur-5) var(--awu-ease) 1;
  pointer-events: none;
}

.awu-status[data-status="idle"],
.awu-idle {
  border-style: dashed;
  border-color: var(--awu-line-strong);
}

.awu-status[data-status="info"] {
  background: var(--awu-surface-2);
  color: var(--awu-ink-dim);
}

.awu-status[data-status="alert"] {
  border-color: color-mix(in srgb, var(--awu-danger) 34%, transparent);
  background: color-mix(in srgb, var(--awu-danger) 10%, transparent);
  color: var(--awu-danger);
}

.awu-status[data-status="alert"]::before { background: var(--awu-danger); }

.awu-sigilBody { min-width: 0; flex: 1; }

.awu-sigilName {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .05em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-sigilMeta {
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-sigilBtns { display: flex; gap: var(--awu-gap-3); flex: none; }

/* 未启用提示 / 成功提示的小圆点 */
.awu-idleDot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-ink-faint);
}

/* 面板忙碌：头顶一条 2px 不定进度光带（整块在等，不只是刷新图标在转） */
.awu-panel[data-busy="true"] .awu-head::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--awu-gold-hi), transparent);
  background-size: 45% 100%;
  background-repeat: no-repeat;
  animation: awu-progress 1.1s linear infinite;
}

/* ================================================================ 统计条 */
.awu-stats {
  flex: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  border-radius: var(--awu-r-md);
  overflow: hidden;
  background: var(--awu-line);
}

.awu-stat {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--awu-gap-2);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  background: var(--awu-surface-strip);
}

.awu-statNum {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  line-height: var(--awu-lh-tight);
  letter-spacing: .02em;
  color: var(--awu-ink);
  font-variant-numeric: tabular-nums;
}

.awu-statNum small {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-label);
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--awu-ink-mute);
  margin-left: var(--awu-gap-2);
}

/* ================================================================ 分段器 */
/* 分段器：下划线式。选中的 tab 不再整块渐变填充——
   渐变在同一屏只留给「身份」（头像/徽记）与「唯一主操作」；
   而且加入第 4 个 tab（指南）之后，452px 里等分填充块会挤。 */
.awu-tabs {
  flex: none;
  display: flex;
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  border-bottom: 1px solid var(--awu-line);
}

.awu-tab {
  position: relative;
  flex: none;
  margin-right: var(--awu-gap-7);
  padding: var(--awu-gap-2) 2px var(--awu-gap-3);
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-body-lg);
  font-weight: 500;
  letter-spacing: .06em;
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease);
}

.awu-tab:hover { color: var(--awu-ink-dim); }

.awu-tab[data-on="true"] { color: var(--awu-ink); }

.awu-tab[data-on="true"]::after {
  content: "";
  position: absolute;
  left: 2px;
  right: 2px;
  bottom: -1px;
  height: 2px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-grad);
}

.awu-tab:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: -2px; border-radius: var(--awu-r-xs); }

/* ================================================================ 滚动主体 */
.awu-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 var(--awu-gutter) var(--awu-gap-7);
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-body::-webkit-scrollbar { width: 7px; }
.awu-body::-webkit-scrollbar-track { background: transparent; }
.awu-body::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: var(--awu-r-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* ================================================================ 角色卡 */
.awu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: var(--awu-gap-6);
}

/* 显式归零：grid 子项默认 min-width:auto，中文长句不换行时会把列撑破 */
.awu-grid > * { min-width: 0; }

.awu-card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* grid 子项默认 min-width:auto，长文本会把卡片撑破列宽；显式归零 */
  min-width: 0;
  gap: var(--awu-gap-4);
  /* 左右内边距对齐且留足：文字块与边框之间必须有呼吸空间 */
  padding: var(--awu-gap-6) var(--awu-gutter);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background:
    radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--awu-gold-hi) 7%, transparent), transparent 56%),
    var(--awu-surface-2);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: border-color var(--awu-dur-3) var(--awu-ease), background var(--awu-dur-3) var(--awu-ease),
    box-shadow var(--awu-dur-3) var(--awu-ease), transform var(--awu-dur-3) var(--awu-ease);
  animation: awu-rise var(--awu-dur-4) var(--awu-ease) backwards;
}

/* 卡面左上的一道斜光，hover 时扫过 */
.awu-card::before {
  content: "";
  position: absolute;
  top: -40%;
  left: -60%;
  width: 60%;
  height: 180%;
  background: linear-gradient(100deg, transparent, rgba(255, 236, 200, .1), transparent);
  transform: rotate(12deg);
  opacity: 0;
  transition: opacity var(--awu-dur-3) var(--awu-ease), left var(--awu-dur-5) var(--awu-ease);
  pointer-events: none;
}

.awu-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--awu-gold) 30%, transparent);
  box-shadow: 0 12px 26px rgba(0, 0, 0, .3);
}

.awu-card:hover::before { opacity: 1; left: 120%; }

.awu-card:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 2px; }

/* 启用态：渐变描边 + 外发光 */
.awu-card[data-live="true"] {
  border-color: transparent;
  background:
    linear-gradient(var(--awu-surface), var(--awu-surface)) padding-box,
    var(--awu-grad) border-box;
  border-width: 1px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 12%, transparent), 0 10px 30px color-mix(in srgb, var(--awu-rose) 16%, transparent);
  animation: awu-rise var(--awu-dur-4) var(--awu-ease) backwards, awu-glow 3.6s ease-in-out infinite;
}

.awu-cardChevron {
  flex: none;
  color: var(--awu-ink-mute);
  opacity: 0;
  transform: translateX(-3px);
  transition: opacity var(--awu-dur-3) var(--awu-ease), transform var(--awu-dur-3) var(--awu-ease);
}

.awu-card:hover .awu-cardChevron { opacity: 1; transform: translateX(0); }

.awu-cardTop {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  /* 关键：flex 容器不设 min-width:0 时，子项的 nowrap 文本会把容器撑破，
     于是 text-overflow: ellipsis 根本来不及生效，文字直接被边框裁掉。 */
  min-width: 0;
  overflow: hidden;
}

.awu-avatar {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-avatar);
  height: var(--awu-size-avatar);
  border-radius: var(--awu-r-md);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 700;
  line-height: 1;
  color: var(--awu-on-accent);
  background: var(--awu-grad);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .4), 0 3px 10px rgba(0, 0, 0, .24);
}

/* 四套色相，让卡片墙不至于一片金 */
.awu-avatar[data-hue="1"] { background: linear-gradient(125deg, #d7d0f5, #b7a6d9 55%, #d98ba8); }
.awu-avatar[data-hue="2"] { background: linear-gradient(125deg, #b6e5dc, #86c9bd 55%, #e9bd72); }
.awu-avatar[data-hue="3"] { background: linear-gradient(125deg, #ffe0c2, #e9a37c 55%, #d98ba8); }

.awu-avatar[data-live="true"]::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: calc(var(--awu-r-md) + 3px);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 50%, transparent);
  animation: awu-breathe var(--awu-dur-breathe) ease-in-out infinite;
}

.awu-cardTitle {
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
  margin: 0;
}

.awu-cardName {
  display: block;
  max-width: 100%;
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: .05em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardRole {
  display: block;
  max-width: 100%;
  font-size: var(--awu-fs-label);
  line-height: 15px;
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardBlurb {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* 中英混排：优先在词/标点处断开，避免行尾只剩一个孤字贴到边框上 */
  word-break: normal;
  overflow-wrap: break-word;
  /* 正文块与左右内边距再多 2px，视觉上离边框更远一点 */
  margin: 0;
  min-height: calc(var(--awu-fs-body) * var(--awu-lh-body) * 2);
}

/* 两行截断时最后一行的省略号有时会压到最右，给它一点收尾空间 */

.awu-cardFoot {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  margin: 0;
  min-width: 0;
  font-size: var(--awu-fs-label);
  letter-spacing: .04em;
  color: var(--awu-ink-mute);
}

.awu-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  padding: 2px var(--awu-gap-3);
  border-radius: var(--awu-r-pill);
  border: 1px solid var(--awu-line);
  font-size: var(--awu-fs-label);
  letter-spacing: .06em;
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-pill[data-tone="live"] {
  border-color: color-mix(in srgb, var(--awu-gold) 44%, transparent);
  color: var(--awu-gold-hi);
  background: color-mix(in srgb, var(--awu-gold) 10%, transparent);
}

.awu-pill[data-tone="teal"] {
  border-color: rgba(134, 201, 189, .34);
  color: var(--awu-teal);
}

.awu-pill[data-tone="rose"] {
  border-color: rgba(226, 145, 127, .34);
  color: var(--awu-rose);
}

/* ================================================================ 按钮 */
.awu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--awu-gap-2);
  padding: 5px 11px;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: transparent;
  color: var(--awu-ink-dim);
  font: inherit;
  font-size: var(--awu-fs-body);
  font-weight: 500;
  letter-spacing: .03em;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease),
    border-color var(--awu-dur-2) var(--awu-ease), box-shadow var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-1) var(--awu-ease);
}

.awu-btn:hover { color: var(--awu-ink); background: var(--awu-surface-3); border-color: color-mix(in srgb, var(--awu-gold) 34%, transparent); }
.awu-btn:active { transform: scale(.97); }
.awu-btn:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }
.awu-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }

.awu-btn[data-kind="primary"] {
  border-color: transparent;
  color: var(--awu-on-accent);
  background: var(--awu-grad);
  font-weight: 600;
  box-shadow: 0 3px 12px color-mix(in srgb, var(--awu-rose) 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, .38);
}

.awu-btn[data-kind="primary"]:hover { filter: brightness(1.06); }

.awu-btn[data-kind="ghost"] { border-color: transparent; color: var(--awu-ink-mute); }
.awu-btn[data-kind="ghost"]:hover { color: var(--awu-ink); border-color: var(--awu-line); }

.awu-btn[data-kind="danger"] { color: var(--awu-danger); border-color: color-mix(in srgb, var(--awu-danger) 30%, transparent); }
.awu-btn[data-kind="danger"]:hover { background: color-mix(in srgb, var(--awu-danger) 10%, transparent); border-color: color-mix(in srgb, var(--awu-danger) 55%, transparent); }

.awu-btn[data-size="sm"] { min-height: var(--awu-size-hit); padding: 3px 8px; font-size: var(--awu-fs-label); border-radius: var(--awu-r-sm); }
.awu-btn[data-size="block"] { width: 100%; padding: var(--awu-gap-3) var(--awu-gap-6); }

/* ================================================================ 详情页 */
.awu-detail { display: flex; flex-direction: column; gap: var(--awu-gap-6); animation: awu-slide-in var(--awu-dur-3) var(--awu-ease); }

/* 详情页导航行：面包屑式「← 返回角色簿 · 角色名」。
   刻意不用按钮描边，而是靠文字色 + hover 底色表达「这是导航」，
   与右侧带边框的启用/删除（动作）形成明确的视觉分层。 */
.awu-detailNav {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  min-width: 0;
  margin-bottom: -2px;
}

.awu-navBack {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  flex: none;
  min-height: var(--awu-size-hit);
  padding: var(--awu-gap-2) var(--awu-gap-3);
  border: 1px solid transparent;
  border-radius: var(--awu-r-sm);
  background: transparent;
  color: var(--awu-gold);
  font: inherit;
  font-size: var(--awu-fs-body);
  font-weight: 500;
  letter-spacing: .03em;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease),
    border-color var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-1) var(--awu-ease);
}

.awu-navBack:hover {
  color: var(--awu-gold-hi);
  background: color-mix(in srgb, var(--awu-gold) 12%, transparent);
  border-color: color-mix(in srgb, var(--awu-gold) 30%, transparent);
}

.awu-navBack:active { transform: translateX(-1px); }

.awu-navBack:focus-visible {
  outline: 2px solid var(--awu-gold);
  outline-offset: 1px;
}

.awu-navBack svg { flex: none; }

/* 右侧的极淡分隔点 + 当前角色名，让导航行读起来像路径而不是单个按钮 */
.awu-detailNavTitle {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-4);
  min-width: 0;
  font-size: var(--awu-fs-label);
  letter-spacing: .08em;
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-detailNavTitle::before {
  content: "/";
  flex: none;
  color: var(--awu-line-strong);
  font-family: var(--awu-mono);
}

.awu-detailHero {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-6);
  flex-wrap: wrap;
  padding: var(--awu-gap-6);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background:
    radial-gradient(130% 100% at 0% 0%, color-mix(in srgb, var(--awu-gold-hi) 10%, transparent), transparent 60%),
    var(--awu-surface-2);
}

.awu-heroAvatar {
  width: var(--awu-size-avatar-lg);
  height: var(--awu-size-avatar-lg);
  border-radius: var(--awu-r-lg);
  font-size: var(--awu-fs-display);
}

.awu-heroBody { min-width: 0; flex: 1 1 0%; }

.awu-heroName {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .06em;
  line-height: var(--awu-lh-tight);
}

.awu-heroSub {
  font-size: var(--awu-fs-body);
  color: var(--awu-ink-mute);
  line-height: 16px;
  /* 一行显示完整；真的放不下时省略，而不是折成两行把卡片撑高 */
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 操作按钮单独占一行、右对齐：与上方的「返回」导航在视觉上明确分层 */
.awu-heroActions {
  display: flex;
  gap: var(--awu-gap-3);
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: none;
}

.awu-section {
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
  overflow: hidden;
}

.awu-sectionHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border-bottom: 1px solid var(--awu-line);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--awu-gold);
}

.awu-sectionHead::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--awu-line-strong), transparent);
}

.awu-sectionHead .awu-count {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
}

.awu-sectionBody { padding: var(--awu-gap-4) var(--awu-gap-6) var(--awu-gap-6); }

/* 角色卡字段：左边一条极细的金线做「引文」感 */
.awu-field {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-3) 0;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  border-bottom: 1px solid rgba(244, 208, 160, .05);
}

.awu-field:last-child { border-bottom: none; }

.awu-fieldKey { color: var(--awu-ink-mute); letter-spacing: .04em; }
.awu-fieldVal { color: var(--awu-ink-dim); word-break: break-word; }
.awu-fieldVal b { color: var(--awu-ink); font-weight: 500; }

/* ================================================================ 日记 */
.awu-diary { display: flex; flex-direction: column; gap: var(--awu-gap-5); }

.awu-day {
  border-left: 1px solid color-mix(in srgb, var(--awu-gold) 24%, transparent);
  padding-left: var(--awu-gap-6);
  position: relative;
}

.awu-day::before {
  content: "";
  position: absolute;
  left: -3.5px;
  top: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awu-gold);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--awu-gold) 12%, transparent);
}

.awu-dayDate {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  letter-spacing: .06em;
  color: var(--awu-gold);
  margin-bottom: var(--awu-gap-1);
}

/* 设计语言：衬线体承担人物感 —— 日记正文必须是衬线。
   原先这里漏了 font-family，继承到面板的无衬线体，等于设计和实现各说各话。 */
.awu-line {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-3);
  padding: 1px var(--awu-gap-3);
  margin: 0 calc(var(--awu-gap-3) * -1);
  border-radius: var(--awu-r-xs);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-loose);
  letter-spacing: .01em;
  color: var(--awu-ink-dim);
  transition: background var(--awu-dur-2) var(--awu-ease);
}

.awu-lineMarker {
  flex: none;
  min-width: 12px;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
}

/* ================================================================ 关系 / 日记维护 */
.awu-relation {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 24%, transparent);
  border-radius: var(--awu-r-md);
  background:
    linear-gradient(100deg, color-mix(in srgb, var(--awu-gold-hi) 10%, transparent), transparent 70%),
    var(--awu-surface-2);
}

.awu-relationLabel {
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--awu-gold);
  flex: none;
}

.awu-relationTag {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  letter-spacing: .05em;
  color: var(--awu-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awu-relationMeta {
  margin-left: auto;
  flex: none;
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

.awu-diaryHead { display: flex; align-items: center; gap: var(--awu-gap-3); }

.awu-sectionLabel {
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--awu-gold);
}

.awu-count {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
}

/* 日记行：hover 才浮出「改写」，保持列表干净（基础规则在上面的 .awu-line，不再重复定义） */
.awu-line:hover { background: var(--awu-surface-2); }

.awu-lineEdit {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: var(--awu-size-hit);
  padding: 0 var(--awu-gap-3);
  border: 1px solid transparent;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-gold);
  font: inherit;
  font-size: var(--awu-fs-label);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-line:hover .awu-lineEdit,
.awu-lineEdit:focus-visible { opacity: .9; }
.awu-lineEdit:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; opacity: 1; }
.awu-lineEdit:hover { background: color-mix(in srgb, var(--awu-gold) 14%, transparent); opacity: 1; }

/* 危险操作区：一条红铜色分隔，视觉上明确「这里会删东西」 */
.awu-dangerZone {
  margin-top: 2px;
  border: 1px solid color-mix(in srgb, var(--awu-danger) 20%, transparent);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-danger) 4.5%, transparent);
  overflow: hidden;
}

.awu-dangerZone .awu-sectionHead { border-bottom-color: color-mix(in srgb, var(--awu-danger) 18%, transparent); color: var(--awu-danger); }
.awu-dangerZone .awu-sectionHead::after {
  background: linear-gradient(90deg, color-mix(in srgb, var(--awu-danger) 26%, transparent), transparent);
}

.awu-dangerRow {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-5);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border-bottom: 1px solid color-mix(in srgb, var(--awu-danger) 12%, transparent);
}

.awu-dangerRow:last-child { border-bottom: none; }

.awu-dangerText { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.awu-dangerText b { font-size: var(--awu-fs-body-lg); font-weight: 600; color: var(--awu-ink-dim); }
.awu-dangerText b[data-danger="true"] { color: var(--awu-danger); }
.awu-dangerText span { font-size: var(--awu-fs-body); line-height: var(--awu-lh-body); color: var(--awu-ink-mute); }

.awu-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 84px;
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  letter-spacing: 0;
  padding: var(--awu-gap-4) var(--awu-gap-5);
}

/* ================================================================ 空态 / 载入 / 错误 */
.awu-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-10) var(--awu-gap-8);
  border: 1px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  text-align: center;
}

.awu-emptyMark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-empty);
  height: var(--awu-size-empty);
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--awu-gold) 30%, transparent);
  color: var(--awu-gold);
  opacity: .8;
}

.awu-emptyTitle {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  letter-spacing: .06em;
  color: var(--awu-ink-dim);
}

.awu-emptyHint { font-size: var(--awu-fs-body); line-height: var(--awu-lh-body); color: var(--awu-ink-mute); max-width: 260px; }

/* 错误条：与状态带共用几何（alert 态），保留 .awu-err 类名供既有 JSX 使用 */
.awu-err {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-4);
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border: 1px solid color-mix(in srgb, var(--awu-danger) 34%, transparent);
  border-left: 2px solid var(--awu-danger);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-danger) 10%, transparent);
  color: var(--awu-danger);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
}

/* 骨架屏：形状必须与即将出现的布局一致，否则加载完成会跳一下（CLS） */
.awu-sk { display: flex; flex-direction: column; gap: var(--awu-gap-5); padding: var(--awu-gap-1) 0; }

/* 角色簿：双列卡片形状，高度与真实卡片一致 */
.awu-sk[data-shape="cards"] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: var(--awu-gap-6);
  padding: 0;
}

.awu-skRow {
  height: 62px;
  border-radius: var(--awu-r-md);
  background: linear-gradient(100deg,
    color-mix(in srgb, var(--awu-gold-hi) 4%, transparent) 20%,
    color-mix(in srgb, var(--awu-gold-hi) 10%, transparent) 40%,
    color-mix(in srgb, var(--awu-gold-hi) 4%, transparent) 60%);
  background-size: 300% 100%;
  animation: awu-shimmer 1.4s linear infinite;
}

.awu-sk[data-shape="cards"] .awu-skRow {
  height: calc(var(--awu-gap-6) * 2
    + var(--awu-size-avatar)
    + var(--awu-gap-4) * 2
    + var(--awu-fs-body) * var(--awu-lh-body) * 2
    + var(--awu-fs-label) * var(--awu-lh-snug));
}

/* 详情：首条模拟 hero */
.awu-sk[data-shape="detail"] .awu-skRow:first-child { height: 100px; }

/* ================================================================ 角色卡编辑器 */

/* 编辑器接管整个面板内容区：纵向三段（标题栏 / 滚动体 / 固定操作条） */
.awu-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  animation: awu-slide-in var(--awu-dur-3) var(--awu-ease);
}

.awu-editorHead {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-5) var(--awu-gutter) var(--awu-gap-4);
  border-bottom: 1px solid var(--awu-line);
  position: relative;
}

/* 标题栏下沿一道渐变金线，和面板顶部那道呼应 */
.awu-editorHead::after {
  content: "";
  position: absolute;
  left: var(--awu-gutter);
  right: var(--awu-gutter);
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--awu-gold-hi) 55%, transparent), color-mix(in srgb, var(--awu-pink) 40%, transparent) 55%, transparent);
  pointer-events: none;
}

.awu-editorHeadMain { min-width: 0; flex: 1; }

.awu-editorKicker {
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .26em;
  text-transform: uppercase;
  color: var(--awu-gold);
  opacity: .85;
}

.awu-editorName {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-4);
  margin-top: 4px;
  min-width: 0;
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .05em;
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-editorSource {
  flex: none;
  padding: 2px var(--awu-gap-3);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-pill);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--awu-ink-mute);
}

.awu-editorHeadRight { display: flex; align-items: center; gap: var(--awu-gap-3); flex: none; }

.awu-editorProgress {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
  padding: 2px 7px;
  border-radius: var(--awu-r-xs);
  background: var(--awu-surface-2);
}

.awu-editorReadonly {
  flex: none;
  padding: var(--awu-gap-3) var(--awu-gutter) 0;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
}

.awu-editorBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--awu-gap-4) var(--awu-gutter) var(--awu-gap-6);
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-4);
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-editorBody::-webkit-scrollbar { width: 7px; }
.awu-editorBody::-webkit-scrollbar-track { background: transparent; }
.awu-editorBody::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: var(--awu-r-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* ---- 分组 ---- */
.awu-editGroup {
  /* 纵向 flex 容器里的分组不能参与收缩：否则内容一多，折叠的分组会被压成
     十几像素高、标题文字被裁掉，只剩一条空横条。 */
  flex: none;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
  overflow: hidden;
  transition: border-color var(--awu-dur-3) var(--awu-ease), background var(--awu-dur-3) var(--awu-ease);
}

.awu-editGroup[data-open="true"] { border-color: var(--awu-line-strong); }

/* 灵魂字段：金色描边 + 暖光底，一眼看出它和别的组不是一个量级 */
.awu-editGroup[data-soul="true"] {
  border-color: color-mix(in srgb, var(--awu-gold) 34%, transparent);
  background:
    linear-gradient(104deg, color-mix(in srgb, var(--awu-gold-hi) 9%, transparent), color-mix(in srgb, var(--awu-pink) 5%, transparent) 60%, transparent),
    var(--awu-surface-2);
  box-shadow: inset 0 1px 0 rgba(255, 236, 200, .07);
}

.awu-editGroupHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  width: 100%;
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border: none;
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--awu-dur-2) var(--awu-ease);
}

.awu-editGroupHead:hover { background: var(--awu-surface-3); }
.awu-editGroupHead:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: -2px; }

.awu-editGroupChevron {
  flex: none;
  display: inline-flex;
  color: var(--awu-ink-mute);
  transition: transform var(--awu-dur-3) var(--awu-ease);
}

.awu-editGroup[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }

.awu-editGroupTitle {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: .06em;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-editSoulBadge {
  flex: none;
  padding: 2px var(--awu-gap-3);
  border-radius: var(--awu-r-pill);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .1em;
  color: var(--awu-on-accent);
  background: var(--awu-grad);
  box-shadow: 0 1px 6px color-mix(in srgb, var(--awu-rose) 30%, transparent);
}

.awu-editOptional {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-pill);
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
}

.awu-editGroupCount {
  flex: none;
  margin-left: auto;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

.awu-editGroupBody {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-5);
  padding: var(--awu-gap-1) var(--awu-gap-6) var(--awu-gap-6);
  border-top: 1px solid var(--awu-line);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-editGroupHint {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
  padding-top: var(--awu-gap-4);
}

.awu-editGroupHint[data-soul="true"] { color: var(--awu-gold); opacity: .9; }

/* ---- 字段 ---- */
.awu-editField { display: flex; flex-direction: column; gap: var(--awu-gap-2); }

.awu-editFieldKey {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .1em;
  color: var(--awu-ink-mute);
}

.awu-editFieldKind {
  font-style: normal;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  font-weight: 400;
  letter-spacing: 0;
  padding: 0 5px;
  border-radius: var(--awu-r-xs);
  color: var(--awu-ink-mute);
  background: var(--awu-surface-3);
}

.awu-editInput {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body);
  letter-spacing: 0;
  line-height: var(--awu-lh-body);
  padding: var(--awu-gap-3) var(--awu-gap-5);
}

.awu-editInput::placeholder { font-size: var(--awu-fs-body); }

.awu-editArea {
  resize: vertical;
  min-height: 44px;
  overflow-y: auto;
}

/* ---- 列表编辑器 ---- */
.awu-editList { display: flex; flex-direction: column; gap: var(--awu-gap-3); }

.awu-editListEmpty {
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
  padding: 2px 0 2px 2px;
}

.awu-editListItem { display: flex; align-items: flex-start; gap: var(--awu-gap-3); }

.awu-editListIndex {
  flex: none;
  width: 16px;
  padding-top: var(--awu-gap-4);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.awu-editListText {
  flex: 1;
  min-width: 0;
  resize: vertical;
  min-height: 32px;
  padding: var(--awu-gap-3) var(--awu-gap-4);
}

.awu-editListRemove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-ink-mute);
  cursor: pointer;
  opacity: .55;
  transition: opacity var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease),
    background var(--awu-dur-2) var(--awu-ease), border-color var(--awu-dur-2) var(--awu-ease);
}

.awu-editListItem:hover .awu-editListRemove { opacity: 1; }
.awu-editListRemove:hover {
  color: var(--awu-danger);
  background: color-mix(in srgb, var(--awu-danger) 12%, transparent);
  border-color: color-mix(in srgb, var(--awu-danger) 30%, transparent);
}
.awu-editListRemove:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }

.awu-editAdd {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  min-height: var(--awu-size-hit);
  gap: var(--awu-gap-2);
  padding: var(--awu-gap-2) var(--awu-gap-5);
  border: 1px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-label);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), border-color var(--awu-dur-2) var(--awu-ease),
    background var(--awu-dur-2) var(--awu-ease);
}

.awu-editAdd:hover {
  color: var(--awu-gold);
  border-color: color-mix(in srgb, var(--awu-gold) 50%, transparent);
  background: color-mix(in srgb, var(--awu-gold) 8%, transparent);
}
.awu-editAdd:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }

/* ---- 底部固定操作条 ---- */
.awu-editorFoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-5) var(--awu-gutter);
  border-top: 1px solid var(--awu-line-strong);
  background: var(--awu-surface-foot);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.awu-editorDirty {
  margin-right: auto;
  font-size: var(--awu-fs-label);
  letter-spacing: .05em;
  color: var(--awu-ink-mute);
  transition: color var(--awu-dur-3) var(--awu-ease);
}

.awu-editorDirty[data-dirty="true"] { color: var(--awu-gold); }
/* 用 4px 圆点代替 7px 字形：字形的渲染尺寸不可控，且是 19 档字号里最小的一档 */
.awu-editorDirty[data-dirty="true"]::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-right: var(--awu-gap-1);
  border-radius: var(--awu-r-pill);
  background: currentColor;
  vertical-align: middle;
}

/* ---- 未保存确认 ---- */
.awu-editorConfirm {
  position: absolute;
  inset: 0;
  z-index: var(--awu-z-inset);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(12, 8, 6, .62);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  border-radius: var(--awu-r-xl);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-editorConfirmCard {
  width: 100%;
  max-width: 320px;
  padding: var(--awu-gap-7);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface);
  box-shadow: var(--awu-shadow);
}

.awu-editorConfirmTitle {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  letter-spacing: .05em;
  color: var(--awu-ink);
}

.awu-editorConfirmText {
  margin-top: var(--awu-gap-4);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-editorConfirmActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--awu-gap-4);
  margin-top: var(--awu-gap-6);
}

/* 编辑入口：中性动作，与危险操作明确区分 */
.awu-btn[data-kind="edit"] {
  border-color: color-mix(in srgb, var(--awu-gold) 38%, transparent);
  color: var(--awu-gold);
}

.awu-btn[data-kind="edit"]:hover {
  color: var(--awu-gold-hi);
  border-color: color-mix(in srgb, var(--awu-gold) 62%, transparent);
  background: color-mix(in srgb, var(--awu-gold) 10%, transparent);
}

/* ================================================================ 弹层（新建 / 删除确认） */
.awu-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--awu-z-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--awu-gap-8);
  background: rgba(12, 8, 6, .56);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-dialog {
  width: min(var(--awu-dialog-w), 100%);
  max-height: min(80vh, var(--awu-dialog-max-h));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  background:
    radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--awu-gold-hi) 10%, transparent), transparent 60%),
    var(--awu-surface-dialog);
  box-shadow: var(--awu-shadow);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body-lg);
  overflow: hidden;
  animation: awu-dialog-in var(--awu-dur-3) var(--awu-ease);
}

/* 标题栏与表单之间补一条发丝：原先标题和第一个 label 糊在一起 */
.awu-dialogHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-6) var(--awu-gutter) var(--awu-gap-4);
  border-bottom: 1px solid var(--awu-line);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  letter-spacing: .05em;
}

.awu-dialogBody { padding: 0 var(--awu-gutter) var(--awu-gap-2); overflow-y: auto; }
.awu-dialogFoot {
  display: flex;
  justify-content: flex-end;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-6) var(--awu-gutter) var(--awu-gutter);
}

.awu-hint { font-size: var(--awu-fs-body); line-height: var(--awu-lh-body); color: var(--awu-ink-mute); }
.awu-hint b { color: var(--awu-ink-dim); font-weight: 500; }

.awu-input {
  width: 100%;
  box-sizing: border-box;
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-field);
  color: var(--awu-ink);
  font: inherit;
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-control);
  letter-spacing: .04em;
  outline: none;
  transition: border-color var(--awu-dur-2) var(--awu-ease), box-shadow var(--awu-dur-2) var(--awu-ease);
}

.awu-input::placeholder { color: var(--awu-ink-mute); font-family: var(--awu-sans); font-size: var(--awu-fs-body); letter-spacing: 0; }

.awu-input:focus {
  border-color: color-mix(in srgb, var(--awu-gold) 60%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--awu-gold) 13%, transparent);
}

/* 中文键名不再用 .16em 的大字距：那是拉丁小标题的手法，汉字会被拆得松散 */
.awu-label {
  display: block;
  margin: var(--awu-gap-5) 0 var(--awu-gap-2);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--awu-gold);
}

.awu-previewName {
  margin-top: var(--awu-gap-4);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body);
  color: var(--awu-ink-mute);
}

.awu-previewName b { color: var(--awu-ink); font-weight: 600; }

.awu-confirmText {
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-confirmText b { color: var(--awu-ink); font-family: var(--awu-serif); font-weight: 600; }

.awu-check {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-4);
  margin-top: var(--awu-gap-6);
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
  cursor: pointer;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
  transition: border-color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-check:hover { border-color: var(--awu-line-strong); background: var(--awu-surface-3); }
.awu-check input { margin: 2px 0 0; accent-color: var(--awu-rose); cursor: pointer; }

/* ================================================================ 细化设计补充规则 */
/* 下面这些是「夜繭」细化轮的收口规则：补齐被 JSX 引用但从未定义的类、
   把变体从 class 切回 data-*、以及滚动可达性提示。全部只依赖 --awu-* token。 */

/* 角色簿工具行：index.tsx 原先是一行内联样式 */
.awu-toolbar {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  margin-bottom: var(--awu-gap-5);
  min-height: var(--awu-size-hit);
}

/* 被 index.tsx:1423 使用、但全文件从未定义过：角色簿计数行原先裸继承正文尺寸 */
.awu-statLabel {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-label);
  letter-spacing: .04em;
  color: var(--awu-ink-mute);
}

/* 统计页的存放路径 / 任意单值行（原先字号写在内联样式里） */
.awu-path {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  word-break: break-all;
}

/* 纵向堆叠容器：统计页与日记页原先各有一份内联 gap:11 */
.awu-stack {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-6);
}

/* 头像尺寸变体：不再靠加/删 class（原先 index.tsx 用 awu-heroAvatar 切类） */
.awu-avatar[data-size="hero"],
.awu-heroAvatar {
  width: var(--awu-size-avatar-lg);
  height: var(--awu-size-avatar-lg);
  border-radius: var(--awu-r-lg);
  font-size: var(--awu-fs-display);
}

/* 模式选择弹层：原先字号、内距、对齐全写在 JSX 内联样式里 */
.awu-modeOption {
  width: 100%;
  justify-content: flex-start;
  margin-bottom: var(--awu-gap-4);
  padding: var(--awu-gap-5) var(--awu-gap-6);
  text-align: left;
}

.awu-modeOptionRow { display: inline-flex; align-items: center; gap: var(--awu-gap-4); }
.awu-modeOptionText { display: inline-flex; flex-direction: column; gap: var(--awu-gap-1); }
.awu-modeLabel { font-size: var(--awu-fs-body-lg); font-weight: 600; }
.awu-modeHint { font-size: var(--awu-fs-body); font-weight: 400; color: var(--awu-ink-mute); }

/* 滚动阴影：纯 CSS + scroll timeline；不支持的宿主只是没有阴影，零风险零 JS */
@supports (animation-timeline: scroll()) {
  .awu-body::before {
    content: "";
    position: sticky;
    top: 0;
    display: block;
    height: 1px;
    margin-bottom: -1px;
    background: var(--awu-line-strong);
    opacity: 0;
    animation: awu-scroll-hint linear both;
    animation-timeline: scroll(self);
    animation-range: 0 24px;
  }
  @keyframes awu-scroll-hint {
    from { opacity: 0; }
    to { opacity: 1; }
  }
}
/* ================================================================ 动效 */
@keyframes awu-panel-in {
  from { opacity: 0; transform: translateY(8px) scale(.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes awu-dialog-in {
  from { opacity: 0; transform: translateY(10px) scale(.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes awu-fade { from { opacity: 0; } to { opacity: 1; } }

@keyframes awu-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes awu-slide-in {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes awu-glow {
  0%, 100% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 10%, transparent), 0 8px 24px color-mix(in srgb, var(--awu-rose) 12%, transparent); }
  50% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 26%, transparent), 0 12px 32px color-mix(in srgb, var(--awu-rose) 22%, transparent); }
}

@keyframes awu-breathe {
  0%, 100% { opacity: .35; transform: scale(1); }
  50% { opacity: .9; transform: scale(1.06); }
}

@keyframes awu-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}

@keyframes awu-sheen {
  0%, 55% { transform: translateX(-100%); }
  85%, 100% { transform: translateX(100%); }
}

@keyframes awu-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -50% 0; }
}

@keyframes awu-spin { to { transform: rotate(360deg); } }

/* 面板忙碌光带：awu-panel[data-busy="true"] 时跑，告诉用户「整块在等」 */
@keyframes awu-progress {
  from { background-position: -45% 0; }
  to { background-position: 145% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awu-panel,
  .awu-card,
  .awu-detail,
  .awu-dialog,
  .awu-scrim,
  .awu-skRow,
  .awu-card[data-live="true"],
  .awu-status[data-status="live"]::after,
  .awu-sigil::after,
  .awu-panel[data-busy="true"] .awu-head::after,
  .awu-trigger[data-live="true"] .awu-mark::after,
  .awu-avatar[data-live="true"]::after,
  .awu-lamp[data-on="true"],
  .awu-iconBtn[data-spin="true"] svg {
    animation: none !important;
  }
  .awu-card, .awu-trigger, .awu-btn { transition-duration: .01ms !important; }
  .awu-card:hover { transform: none; }
}

/* ================================================================ 功能模块样式
 * 指南与蒸馏各自维护自己的 CSS 文件（client/guide.styles.ts、client/distill.styles.ts），
 * 在这里拼进同一份样式表：注入点保持唯一，卸载时一次清干净，且基础层在前、功能层在后，
 * 功能层可以安全覆盖基础层。类名前缀分别是 awu-guide-* / awu-distill-*，互不干扰。 */
${GUIDE_CSS}
${DISTILL_CSS}
`

/**
 * 把设计样式注入 `<head>`；同一份样式只注入一次（多实例 / 热重载都安全）。
 * 返回 `false` 表示此前已经注入过。
 */
export function installStyles(): boolean {
  if (typeof document === 'undefined') return false
  const id = 'dsh-ai-with-u/styles.css'
  if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return false
  const el = document.createElement('style')
  el.dataset.plugin = 'dsh-ai-with-u'
  el.dataset.pluginCss = id
  el.textContent = CSS
  document.head.appendChild(el)
  return true
}

/** 供组件内联使用的一次性样式（弹层 scrim 需要在 body 上锁滚动时用到）。 */
export const SCOPED_ATTR = 'data-awu-scoped'
