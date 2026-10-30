/**
 * AI WITH U · 「Liquid Glass」设计语言（v0.3.0 换血版）
 *
 * 从「夜繭 / Night Cocoon」（暖褐 + 琥珀金）整体换成 iOS 液态玻璃。原因见
 * `docs/design/2026-10-30-liquid-glass.md`：面板从小气泡变成 1120px 的主面板
 * （对齐 dsh-context 的 `.lc-ov-card`），需要「明亮、层叠、有材质」的语言，
 * 而不是深夜烛光。
 *
 * 三条保留（换血不是全丢）：
 *  1. **衬线体只留给「人物感」**：角色名 + 日记正文。这两处是产品辨识度；
 *  2. **对比度纪律**：ink 四级仍然按实测比值管着（ink-faint 只作线条，不作文字）；
 *  3. **状态走 data-*、颜色走 token**：不写死色值，不靠加删 class。
 *
 * 依赖宿主的地方只有两处：`data-ds-dark-theme`（主题）与 `prefers-reduced-motion`（降级）。
 */

import { DISTILL_CSS } from './distill.styles'
import { GUIDE_CSS } from './guide.styles'

/** 统一缓动：iOS 弹簧曲线。整套动效只用这一档（+ 少数线性「机器转动」类）。 */
export const EASE = 'cubic-bezier(.32,.72,0,1)'

/**
 * 面板宽度（px）：CSS 与 JS 共用的唯一来源。
 *
 * 2026-10-30 主人两次反馈：先是 452px 小气泡改角色卡太吃力，改成居中大窗后仍嫌小。
 * 最终对齐已装的 dsh-context「上下文洞察」**主面板**（不是它的小模态）：
 *   .lc-ov-card  { width: min(1120px, 100vw - 32px); height: calc(100% - 80px) }
 *   .lc-modal-card { width: min(720px, 100vw - 48px) }   ← 那是它的明细小弹窗，别抄错
 */
export const PANEL_WIDTH = 1120

/** 面板上下留白（px）：主面板高度 = calc(100vh - 这个值)，与 dsh-context 一致。 */
export const PANEL_MAX_H = 80

/** 卡片错峰升起的每张延迟（ms）：JS 的 animationDelay 与 CSS 的动画节奏共用。 */
export const CARD_STAGGER = 34

/**
 * 设计语言的全部 CSS。
 *
 * 结构：变量层 → 浅色覆盖 → 侧栏入口 → 面板骨架 → 两栏骨架 → 头部 → 状态带 →
 *       统计条 → 分段控制 → 滚动主体 → 角色簿 → 按钮 → 详情页 → 日记 → 维护区 →
 *       空态/骨架/错误 → 编辑器 → 弹层(sheet) → 专注层 → 预留模块 → 动效 → 无障碍。
 */
const CSS = `
/* ================================================================ 变量层（深色为默认） */
/* 弹层与面板都是 createPortal 到 document.body 的，挂在 .awu-scope / .awu-layer 之外，
   所以 scrim / dialog 自身也必须进这张变量清单，否则 var(--awu-*) 全是无效声明。
   注意：下面浅色块的类名清单必须与本段**逐字一致**，两边同步增删。 */
.awu-scope,
.awu-layer,
.awu-scrim,
.awu-dialog {
  /* ---- 材质：三层玻璃 ----
     layer-1 = 面板底（最厚），layer-2 = 卡片/分组，layer-3 = 浮起元素（输入框、分段器底）。 */
  --awu-glass-1: rgba(28, 28, 30, .72);
  --awu-glass-2: rgba(58, 58, 60, .42);
  --awu-glass-3: rgba(120, 120, 128, .22);
  /* 大面积（面板底）用轻 blur；强 blur 只留给小面积元素（卡片/按钮/弹层内容），否则 1120×900 会掉帧 */
  --awu-blur-panel: blur(16px) saturate(160%);
  --awu-blur: blur(30px) saturate(180%);
  --awu-specular: inset 0 1px 0 rgba(255, 255, 255, .20);
  --awu-scrim-bg: rgba(0, 0, 0, .34);

  /* ---- 墨色 4 级（实测比值见设计文档 §2；faint 只作线条，禁止用于文字） ---- */
  --awu-ink: #f2f2f7;                          /* 12.49:1 */
  --awu-ink-dim: rgba(235, 235, 245, .75);     /*  7.31:1 正文 */
  --awu-ink-mute: rgba(235, 235, 245, .60);    /*  5.29:1 小字下限 */
  --awu-ink-faint: rgba(235, 235, 245, .28);   /*  2.26:1 仅线条/装饰 */

  /* ---- 线 / 面（surface-* 是 glass-* 的语义别名，外部模块按老名字引用） ---- */
  --awu-line: rgba(255, 255, 255, .10);
  --awu-line-strong: rgba(255, 255, 255, .18);
  --awu-surface: var(--awu-glass-1);
  --awu-surface-2: var(--awu-glass-2);
  --awu-surface-3: var(--awu-glass-3);
  --awu-surface-field: rgba(0, 0, 0, .22);
  --awu-surface-strip: transparent;
  --awu-surface-foot: rgba(28, 28, 30, .55);
  --awu-surface-dialog: rgba(30, 30, 32, .86);

  /* ---- 强调：iOS 系统蓝。三档分工 ----
     accent        = 非文字装饰（辉光、描边、选中底）
     accent-strong = 填充底（上面放白字，实测 4.81:1）
     accent-text   = 用作文字/图标（实测 6.03:1；accent 当文字只有 3.82，不达标） */
  --awu-accent: #0a84ff;
  --awu-accent-strong: #0a6fe0;
  --awu-accent-text: #5ab0ff;
  --awu-on-accent: #ffffff;

  /* ---- 角色专属色：旧暖金降级到这里，只出现在头像/角色名/启用态辉光 ---- */
  --awu-gold: #e8c07a;                         /*  8.13:1 */
  --awu-gold-hi: #ffd89b;                      /* 10.32:1 */
  --awu-on-character: #2b1d0a;                 /* 角色色底上的字（对 gold 9.55:1） */
  --awu-grad: linear-gradient(135deg, #ffd89b 0%, #e8c07a 52%, #e58a78 100%);
  --awu-grad-soft: linear-gradient(135deg, rgba(255, 216, 148, .18), rgba(229, 138, 120, .14));

  /* ---- 语义色 ---- */
  --awu-teal: #30d158;                         /*  6.89:1 成功 */
  --awu-danger: #ff6b61;                       /*  5.00:1 */
  --awu-rose: #e58a78;                         /*  5.47:1 */
  --awu-pink: #f2b8c6;                         /*  8.26:1 */

  /* ---- 字体：无衬线为主；衬线只给「角色名 + 日记正文」 ---- */
  --awu-sans: -apple-system, "SF Pro Text", "SF Pro Display", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  --awu-serif: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "Georgia", serif;
  --awu-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", monospace;

  /* ---- 字号 9 档（1120 大窗：比 452 时代整体上浮 1px；中文下限 12px） ---- */
  --awu-fs-micro: 10px;
  --awu-fs-caption: 11px;
  --awu-fs-label: 12px;
  --awu-fs-body: 13px;
  --awu-fs-body-lg: 14px;
  --awu-fs-control: 15px;
  --awu-fs-title: 18px;
  --awu-fs-headline: 22px;
  --awu-fs-display: 26px;

  /* ---- 行高 4 档（与字号强制配对） ---- */
  --awu-lh-tight: 1.25;
  --awu-lh-snug: 1.4;
  --awu-lh-body: 1.65;
  --awu-lh-loose: 1.8;

  /* ---- 间距 10 档 + 唯一 gutter（1120 宽用 32） ---- */
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
  --awu-gutter: 32px;
  /* 长表单/长文本的阅读宽度：1120 全宽对中文表单太宽，正文收在 760 */
  --awu-content-max: 760px;
  /* 两栏骨架：左栏（列表）固定宽，右栏自适应 */
  --awu-rail-w: 340px;

  /* ---- 尺寸 7 档 ---- */
  --awu-size-hit: 28px;
  --awu-size-icon: 32px;
  --awu-size-mark: 28px;
  --awu-size-rail: 36px;
  --awu-size-avatar: 38px;
  --awu-size-avatar-lg: 56px;
  --awu-size-empty: 56px;

  /* ---- 圆角 6 档（面板 24 / 卡片 16 / 输入 12 / 按钮 10） ---- */
  --awu-r-xs: 8px;
  --awu-r-sm: 10px;
  --awu-r-md: 12px;
  --awu-r-lg: 16px;
  --awu-r-xl: 24px;
  --awu-r-pill: 999px;

  /* ---- 动效：弹簧缓动 + 5 个时长 + 1 个环境档 ---- */
  --awu-ease: ${EASE};
  --awu-dur-1: .12s;
  --awu-dur-2: .18s;
  --awu-dur-3: .24s;
  --awu-dur-4: .34s;
  --awu-dur-5: .6s;
  --awu-dur-breathe: 3.4s;

  /* ---- 层：值刻意不变（设计文档 §5）。panel/scrim 是 body 级 portal 与宿主抢栈的经验值 ---- */
  --awu-z-panel: 2147482000;
  --awu-z-inset: 5;
  --awu-z-scrim: 2147482100;

  /* ---- 结构尺码（CSS 与 JS 的单一来源） ---- */
  --awu-panel-w: ${PANEL_WIDTH}px;
  --awu-panel-pad-y: ${PANEL_MAX_H}px;
  --awu-panel-max-h: calc(100vh - var(--awu-panel-pad-y));
  --awu-dialog-w: 760px;
  --awu-dialog-max-h: 720px;

  --awu-shadow: 0 28px 80px rgba(0, 0, 0, .50), 0 2px 12px rgba(0, 0, 0, .30);
  --awu-scroll: rgba(235, 235, 245, .28);

  /* 宿主的系统滚动条钩子 */
  --dsh-scrollbar-thumb: var(--awu-scroll);
  --dsh-scrollbar-thumb-hover: rgba(235, 235, 245, .48);
}

/* 浅色：晨光玻璃。液态玻璃在浅色下是「白色半透明 + 白色高光」，不是把深色反相。
   选择器必须与上面变量块逐字一致。 */
html:not([data-ds-dark-theme]) .awu-scope,
html:not([data-ds-dark-theme]) .awu-layer,
html:not([data-ds-dark-theme]) .awu-scrim,
html:not([data-ds-dark-theme]) .awu-dialog {
  --awu-glass-1: rgba(255, 255, 255, .72);
  --awu-glass-2: rgba(255, 255, 255, .62);
  --awu-glass-3: rgba(120, 120, 128, .14);
  --awu-blur-panel: blur(16px) saturate(170%);
  --awu-specular: inset 0 1px 0 rgba(255, 255, 255, .92);
  --awu-scrim-bg: rgba(0, 0, 0, .20);

  --awu-ink: #1c1c1e;                          /* 16.44:1 */
  --awu-ink-dim: rgba(60, 60, 67, .82);        /*  6.22:1 */
  --awu-ink-mute: rgba(60, 60, 67, .72);       /*  4.69:1 */
  --awu-ink-faint: rgba(60, 60, 67, .28);      /*  1.65:1 仅线条 */

  --awu-line: rgba(60, 60, 67, .14);
  --awu-line-strong: rgba(60, 60, 67, .24);
  --awu-surface-field: rgba(120, 120, 128, .10);
  --awu-surface-strip: rgba(120, 120, 128, .06);
  --awu-surface-foot: rgba(255, 255, 255, .62);
  --awu-surface-dialog: rgba(255, 255, 255, .90);

  --awu-accent: #007aff;
  --awu-accent-strong: #0066cc;
  --awu-accent-text: #0066cc;
  --awu-on-accent: #ffffff;

  --awu-gold: #8a5f1e;                         /*  5.43:1 */
  --awu-gold-hi: #a9722a;
  --awu-on-character: #2b1d0a;
  --awu-grad: linear-gradient(135deg, #f2ce93 0%, #d9a35c 52%, #c98a6e 100%);
  --awu-grad-soft: linear-gradient(135deg, rgba(217, 163, 92, .18), rgba(201, 138, 110, .14));

  --awu-teal: #1e7a33;                         /*  4.62:1 */
  --awu-danger: #d70015;                       /*  5.20:1 */
  --awu-rose: #c0392b;
  --awu-pink: #b03a63;

  --awu-shadow: 0 24px 60px rgba(30, 30, 34, .16), 0 2px 8px rgba(30, 30, 34, .08);
  --awu-scroll: rgba(60, 60, 67, .30);
  --dsh-scrollbar-thumb-hover: rgba(60, 60, 67, .48);
}

/* ================================================================ 侧栏入口 */
.awu-layer {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  /* 不写死 width：宿主收起态是 width:auto + justify-content:center，
     写死 100% 会以 0 宽度为基准算出 4px 的怪值。 */
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  margin: 4px -2px;
  font-family: var(--awu-sans);
  color: var(--awu-ink);
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
  padding: 0 var(--awu-gap-6) 0 var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-glass-2);
  color: var(--awu-ink);
  font: inherit;
  font-size: var(--awu-fs-body);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  backdrop-filter: var(--awu-blur);
  -webkit-backdrop-filter: var(--awu-blur);
  box-shadow: var(--awu-specular);
  transition: background var(--awu-dur-2) var(--awu-ease), border-color var(--awu-dur-2) var(--awu-ease),
    box-shadow var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-1) var(--awu-ease);
}

.awu-trigger:hover { background: var(--awu-glass-3); border-color: var(--awu-line-strong); }
.awu-trigger:active { transform: scale(.985); }

.awu-trigger[data-open="true"] {
  border-color: var(--awu-accent);
  box-shadow: 0 0 0 1px var(--awu-accent), var(--awu-specular);
}

.awu-trigger:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 2px; }

/* 徽标：角色专属色渐变 + 名字首字（衬线） */
.awu-mark {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-mark);
  height: var(--awu-size-mark);
  border-radius: var(--awu-r-xs);
  color: var(--awu-on-character);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 700;
  line-height: 1;
  background: var(--awu-grad);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .45), 0 2px 8px rgba(0, 0, 0, .18);
}

/* 启用态：一圈很淡的角色色呼吸（整份 UI 里唯一的暖色动效） */
.awu-mark::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: var(--awu-r-md);
  border: 1px solid var(--awu-gold);
  opacity: 0;
  transition: opacity var(--awu-dur-3) var(--awu-ease);
}

.awu-trigger[data-live="true"] .awu-mark::after {
  opacity: .8;
  animation: awu-breathe var(--awu-dur-breathe) ease-in-out infinite;
}

.awu-triggerText {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--awu-gap-1);
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.awu-triggerLabel {
  font-size: var(--awu-fs-body);
  font-weight: 600;
  letter-spacing: .01em;
  line-height: var(--awu-lh-snug);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--awu-ink);
}

.awu-triggerName {
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--awu-dur-2) var(--awu-ease);
}

.awu-trigger[data-live="true"] .awu-triggerName { color: var(--awu-gold); }

/* 状态灯：启用=系统绿呼吸，未启用=灰点 */
.awu-lamp {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awu-ink-faint);
  transition: background var(--awu-dur-2) var(--awu-ease), box-shadow var(--awu-dur-2) var(--awu-ease);
}

.awu-lamp[data-on="true"] {
  background: var(--awu-teal);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--awu-teal) 18%, transparent);
  animation: awu-pulse 2.6s ease-in-out infinite;
}

/* 收起态：36px 圆徽 */
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
  border-radius: var(--awu-r-pill);
  justify-content: center;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.awu-layer[data-rail="true"] .awu-trigger:hover { background: var(--awu-glass-3); border-color: var(--awu-line); }
.awu-layer[data-rail="true"] .awu-triggerText,
.awu-layer[data-rail="true"] .awu-lamp { display: none; }
.awu-layer[data-rail="true"] .awu-mark { width: var(--awu-size-hit); height: var(--awu-size-hit); border-radius: var(--awu-r-pill); font-size: var(--awu-fs-body-lg); }

/* ================================================================ 面板骨架 */
/* 1120 × (100vh − 80) 的主面板：顶部对齐 + 水平居中 + 全屏压暗。
   定位的真实来源是 index.tsx 的 panelStyle（inline 优先），这里的值只是"没有 inline 时的兜底"。 */
.awu-panel {
  position: fixed;
  z-index: var(--awu-z-panel);
  left: 0;
  right: 0;
  margin: 0 auto;
  top: calc(var(--awu-panel-pad-y) / 2);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(var(--awu-panel-w), calc(100vw - 32px));
  height: var(--awu-panel-max-h);
  max-height: var(--awu-panel-max-h);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-xl);
  background: var(--awu-surface);
  backdrop-filter: var(--awu-blur-panel);
  -webkit-backdrop-filter: var(--awu-blur-panel);
  box-shadow: var(--awu-shadow), 0 0 0 100vmax var(--awu-scrim-bg), var(--awu-specular);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  overflow: hidden;
  transform-origin: center;
  will-change: transform, opacity;
  animation: awu-panel-in var(--awu-dur-3) var(--awu-ease);
}

/* ================================================================ 两栏骨架（iOS Split View） */
/* JSX 接线：<div class="awu-workspace"><aside class="awu-rail">…列表…</aside><main class="awu-main">…内容…</main></div>
   两栏各自独立滚动；<900px 收成单栏（.awu-rail 隐藏条件由 JSX 决定，见设计文档 §3.2）。 */
.awu-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.awu-rail {
  flex: none;
  width: var(--awu-rail-w);
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--awu-line);
  overflow: hidden;
}

.awu-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 栏内可滚动区（替代旧的 .awu-body 在单栏里的角色） */
.awu-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--awu-gap-6) var(--awu-gutter) var(--awu-gap-9);
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-pane::-webkit-scrollbar { width: 8px; }
.awu-pane::-webkit-scrollbar-track { background: transparent; }
.awu-pane::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: var(--awu-r-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* 左栏头部：蒸馏 CTA → 分段器 → 计数行 的唯一 gutter 容器。
   成因（2026-10-30 主人截图）：这些块原先直接挂在 .awu-rail 下，而 rail 自身没有 padding，
   于是「共 3 位」贴着面板左沿被切、CTA 左右顶死边框，只有下面的卡片列表缩进了 32px。
   现在由容器统一给左右 gutter，子块自己的 margin 归零（否则双份内边距），纵向节奏交给 gap。
   ⚠️ 这段注释里不能出现反引号 —— CSS 整个是 JS 模板串，反引号会把它从中间截断，
   后面的文字变成 JS 表达式（实测导致 rail is not defined，整个插件模块加载失败、侧栏入口消失）。 */
.awu-railHead {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-5) var(--awu-gutter) var(--awu-gap-4);
}

.awu-railHead > * { margin: 0; }

/* 唯一断点：<900 收成单栏（详情页占满、列表退回全宽） */
@media (max-width: 900px) {
  .awu-workspace { display: block; overflow-y: auto; }
  .awu-rail { width: 100%; border-right: none; }
  .awu-main { min-height: auto; }
  .awu-pane { padding: var(--awu-gap-5) var(--awu-gap-7) var(--awu-gap-8); }
  .awu-panel { --awu-gutter: 20px; }
}

/* ================================================================ 头部 */
.awu-head {
  flex: none;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-7) var(--awu-gutter) var(--awu-gap-5);
}

.awu-headMain { min-width: 0; flex: 1; }

.awu-kicker {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--awu-ink-mute);
}

.awu-kicker::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--awu-line);
}

.awu-title {
  margin-top: var(--awu-gap-2);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-headline);
  font-weight: 700;
  letter-spacing: -.015em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-ink);
}

.awu-title em { font-style: normal; color: var(--awu-accent-text); }

.awu-headActions { display: flex; align-items: center; gap: var(--awu-gap-2); flex: none; }

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
    border-color var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-1) var(--awu-ease);
}

.awu-iconBtn:hover { color: var(--awu-ink); background: var(--awu-surface-3); border-color: var(--awu-line); }
.awu-iconBtn:active { transform: scale(.94); }
.awu-iconBtn:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 1px; }
.awu-iconBtn[data-spin="true"] svg { animation: awu-spin .9s linear infinite; }

/* 面板忙碌：头底一条 2px 不定进度光带 */
.awu-panel[data-busy="true"] .awu-head::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--awu-accent), transparent);
  background-size: 45% 100%;
  background-repeat: no-repeat;
  animation: awu-progress 1.1s linear infinite;
}

/* ================================================================ 状态带（四态一形） */
/* 旧名 .awu-sigil（启用）与 .awu-idle（未启用 / 提示）保留为别名，JSX 晚一步切过来也不掉样式。 */
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
  min-height: 48px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  overflow: hidden;
  color: var(--awu-ink-mute);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
}

/* live = 角色专属色：左侧 2px 色轨 + 一点点角色色底 */
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
  border-color: color-mix(in srgb, var(--awu-gold) 34%, transparent);
  background: linear-gradient(100deg, color-mix(in srgb, var(--awu-gold) 12%, transparent), transparent 62%),
    var(--awu-surface-2);
}

/* 进场扫一次就停（不再无限循环） */
.awu-status[data-status="live"]::after,
.awu-sigil::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 32%, rgba(255, 255, 255, .10) 50%, transparent 68%);
  transform: translateX(-100%);
  animation: awu-sheen var(--awu-dur-5) var(--awu-ease) 1;
  pointer-events: none;
}

.awu-status[data-status="idle"],
.awu-idle {
  border-style: dashed;
  border-color: var(--awu-line-strong);
  background: transparent;
}

.awu-status[data-status="info"] {
  background: color-mix(in srgb, var(--awu-accent) 10%, var(--awu-surface-2));
  border-color: color-mix(in srgb, var(--awu-accent) 26%, transparent);
  color: var(--awu-ink-dim);
}

.awu-status[data-status="alert"] {
  background: color-mix(in srgb, var(--awu-danger) 12%, var(--awu-surface-2));
  border-color: color-mix(in srgb, var(--awu-danger) 34%, transparent);
  color: var(--awu-danger);
}

.awu-status[data-status="alert"]::before { background: var(--awu-danger); }

.awu-sigilBody { min-width: 0; flex: 1; }

.awu-sigilName {
  /* 衬线只给「人物感」：当前启用角色的名字 */
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .02em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-gold);
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

.awu-idleDot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-ink-faint);
}

/* ================================================================ 统计条 */
.awu-stats {
  flex: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 0 var(--awu-gutter) var(--awu-gap-6);
  border-radius: var(--awu-r-lg);
  overflow: hidden;
  background: var(--awu-line);
}

.awu-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--awu-gap-1);
  padding: var(--awu-gap-5) var(--awu-gap-4);
  background: var(--awu-surface-2);
}

.awu-statNum {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  line-height: var(--awu-lh-tight);
  letter-spacing: -.01em;
  color: var(--awu-ink);
  font-variant-numeric: tabular-nums;
}

.awu-statNum small {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-caption);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  margin-left: var(--awu-gap-2);
}

/* ================================================================ 分段控制（iOS segmented） */
.awu-tabs {
  flex: none;
  display: flex;
  gap: var(--awu-gap-1);
  margin: 0 var(--awu-gutter) var(--awu-gap-6);
  padding: 3px;
  border-radius: var(--awu-r-md);
  background: var(--awu-glass-3);
}

.awu-tab {
  flex: 1;
  min-width: 0;
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: none;
  border-radius: var(--awu-r-sm);
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-body);
  font-weight: 500;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease),
    box-shadow var(--awu-dur-2) var(--awu-ease);
}

.awu-tab:hover { color: var(--awu-ink-dim); }

.awu-tab[data-on="true"] {
  color: var(--awu-ink);
  font-weight: 600;
  background: var(--awu-glass-1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .18), var(--awu-specular);
}

.awu-tab:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: -2px; }

/* ================================================================ 滚动主体（单栏时代的 .awu-body，保留） */
.awu-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--awu-gap-6) var(--awu-gutter) var(--awu-gap-9);
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-body::-webkit-scrollbar { width: 8px; }
.awu-body::-webkit-scrollbar-track { background: transparent; }
.awu-body::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: var(--awu-r-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* 顶部滚动阴影：纯 CSS + scroll timeline，不支持就只是没有阴影 */
@supports (animation-timeline: scroll()) {
  .awu-body::before,
  .awu-pane::before {
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
  @keyframes awu-scroll-hint { from { opacity: 0; } to { opacity: 1; } }
}

/* ================================================================ 角色簿 */
.awu-toolbar {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  margin-bottom: var(--awu-gap-5);
  min-height: var(--awu-size-hit);
}

.awu-toolbarActions { margin-left: auto; display: flex; align-items: center; gap: var(--awu-gap-3); }

/* 被 index.tsx 使用、曾长期没有定义的计数行 */
.awu-statLabel {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-label);
  font-weight: 500;
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

/* 蒸馏入口（独立一块，见 distill.styles.ts；这里只兜底一条基线，不覆盖它的规则） */
.awu-distill-entry { margin-bottom: var(--awu-gap-6); }

.awu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--awu-gap-6);
}

/* grid 子项默认 min-width:auto，中文长句会把列撑破 */
.awu-grid > * { min-width: 0; }

.awu-card {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-6) var(--awu-gap-6) var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  box-shadow: var(--awu-specular);
  transition: border-color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease),
    box-shadow var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-2) var(--awu-ease);
  animation: awu-rise var(--awu-dur-4) var(--awu-ease) backwards;
}

.awu-card:hover {
  transform: translateY(-1px);
  border-color: var(--awu-line-strong);
  background: var(--awu-glass-3);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .22), var(--awu-specular);
}

.awu-card:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 2px; }

/* 启用中的卡：角色色描边 + 呼吸（不做渐变填充，保持 iOS 干净） */
.awu-card[data-live="true"] {
  border-color: color-mix(in srgb, var(--awu-gold) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 22%, transparent),
    0 10px 30px color-mix(in srgb, var(--awu-gold) 16%, transparent), var(--awu-specular);
  animation: awu-rise var(--awu-dur-4) var(--awu-ease) backwards, awu-glow 3.6s ease-in-out infinite;
}

.awu-cardTop {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  /* 关键：不设 min-width:0 时，子项 nowrap 文本会把容器撑破，ellipsis 来不及生效 */
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
  border-radius: var(--awu-r-xs);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 700;
  line-height: 1;
  color: var(--awu-on-character);
  background: var(--awu-grad);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .45), 0 2px 8px rgba(0, 0, 0, .18);
}

/* 三套色相：让卡片墙不至于一片金（仍是角色色系，不抢系统蓝） */
.awu-avatar[data-hue="1"] { background: linear-gradient(125deg, #d7d0f5, #b7a6d9 55%, #d98ba8); }
.awu-avatar[data-hue="2"] { background: linear-gradient(125deg, #b6e5dc, #86c9bd 55%, #e8c07a); }
.awu-avatar[data-hue="3"] { background: linear-gradient(125deg, #ffe0c2, #e58a78 55%, #d98ba8); }

.awu-avatar[data-live="true"]::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: calc(var(--awu-r-xs) + 3px);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 55%, transparent);
  animation: awu-breathe var(--awu-dur-breathe) ease-in-out infinite;
}

.awu-avatar[data-size="hero"],
.awu-heroAvatar {
  width: var(--awu-size-avatar-lg);
  height: var(--awu-size-avatar-lg);
  border-radius: var(--awu-r-md);
  font-size: var(--awu-fs-display);
}

.awu-cardTitle {
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
}

.awu-cardName {
  display: block;
  max-width: 100%;
  /* 名字：衬线 + 角色色 */
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: .01em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-gold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardRole {
  display: block;
  max-width: 100%;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardChevron {
  flex: none;
  color: var(--awu-ink-faint);
  transition: color var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-2) var(--awu-ease);
}

.awu-card:hover .awu-cardChevron { color: var(--awu-ink-mute); transform: translateX(2px); }

.awu-cardBlurb {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: normal;
  overflow-wrap: break-word;
  min-height: calc(var(--awu-fs-body) * var(--awu-lh-body) * 2);
}

.awu-cardFoot {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  min-width: 0;
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
}

.awu-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  padding: 2px var(--awu-gap-4);
  border-radius: var(--awu-r-pill);
  border: 1px solid var(--awu-line);
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-pill[data-tone="live"] {
  border-color: color-mix(in srgb, var(--awu-gold) 45%, transparent);
  color: var(--awu-gold);
  background: color-mix(in srgb, var(--awu-gold) 12%, transparent);
}

.awu-pill[data-tone="teal"] {
  border-color: color-mix(in srgb, var(--awu-teal) 40%, transparent);
  color: var(--awu-teal);
}

.awu-pill[data-tone="rose"] {
  border-color: color-mix(in srgb, var(--awu-rose) 40%, transparent);
  color: var(--awu-rose);
}

/* ================================================================ 按钮 */
.awu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--awu-gap-3);
  height: 34px;
  padding: 0 var(--awu-gap-6);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-3);
  color: var(--awu-ink);
  font: inherit;
  font-size: var(--awu-fs-body);
  font-weight: 500;
  letter-spacing: 0;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--awu-dur-2) var(--awu-ease), border-color var(--awu-dur-2) var(--awu-ease),
    color var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-1) var(--awu-ease);
}

.awu-btn:hover { background: var(--awu-glass-3); border-color: var(--awu-line-strong); }
.awu-btn:active { transform: scale(.97); }
.awu-btn:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 1px; }
.awu-btn:disabled { opacity: .42; cursor: not-allowed; transform: none; }

.awu-btn[data-kind="primary"] {
  border-color: transparent;
  background: var(--awu-accent-strong);
  color: var(--awu-on-accent);
  font-weight: 600;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--awu-accent) 28%, transparent);
}

.awu-btn[data-kind="primary"]:hover { filter: brightness(1.08); background: var(--awu-accent-strong); }

.awu-btn[data-kind="ghost"] { border-color: transparent; background: transparent; color: var(--awu-ink-mute); }
.awu-btn[data-kind="ghost"]:hover { background: var(--awu-surface-3); color: var(--awu-ink); }

.awu-btn[data-kind="danger"] {
  border-color: color-mix(in srgb, var(--awu-danger) 34%, transparent);
  background: transparent;
  color: var(--awu-danger);
}
.awu-btn[data-kind="danger"]:hover { background: color-mix(in srgb, var(--awu-danger) 12%, transparent); }

/* 编辑入口：中性偏蓝，与危险/主操作分开（旧类名 awu-editEntry 保留兼容） */
.awu-btn[data-kind="edit"],
.awu-editEntry {
  border-color: color-mix(in srgb, var(--awu-accent) 34%, transparent);
  background: transparent;
  color: var(--awu-accent-text);
}
.awu-btn[data-kind="edit"]:hover,
.awu-editEntry:hover { background: color-mix(in srgb, var(--awu-accent) 12%, transparent); }

.awu-btn[data-size="sm"] { height: var(--awu-size-hit); padding: 0 var(--awu-gap-4); font-size: var(--awu-fs-label); border-radius: var(--awu-r-xs); }
.awu-btn[data-size="block"] { width: 100%; height: 40px; }
.awu-btn[data-size="lg"] { height: 44px; padding: 0 var(--awu-gap-8); font-size: var(--awu-fs-body-lg); font-weight: 600; border-radius: var(--awu-r-md); }

/* ================================================================ 详情页 */
.awu-detail {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-6);
  max-width: var(--awu-content-max);
  margin: 0 auto;
  animation: awu-slide-in var(--awu-dur-3) var(--awu-ease);
}

.awu-detailNav { display: flex; align-items: center; gap: var(--awu-gap-4); min-width: 0; }

.awu-navBack {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  flex: none;
  min-height: var(--awu-size-hit);
  padding: var(--awu-gap-2) var(--awu-gap-4);
  border: 1px solid transparent;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-accent-text);
  font: inherit;
  font-size: var(--awu-fs-body);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease);
}

.awu-navBack:hover { background: color-mix(in srgb, var(--awu-accent) 12%, transparent); }
.awu-navBack:active { transform: translateX(-1px); }
.awu-navBack:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 1px; }
.awu-navBack svg { flex: none; }

.awu-detailNavTitle {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-4);
  min-width: 0;
  font-size: var(--awu-fs-label);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-detailNavTitle::before {
  content: "/";
  flex: none;
  color: var(--awu-ink-faint);
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
  background: var(--awu-surface-2);
  box-shadow: var(--awu-specular);
}

.awu-heroBody { min-width: 0; flex: 1 1 0%; }

.awu-heroName {
  /* 名字：衬线 + 角色色 */
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .02em;
  line-height: var(--awu-lh-tight);
  color: var(--awu-gold);
}

.awu-heroSub {
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
  line-height: var(--awu-lh-snug);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-heroActions { display: flex; gap: var(--awu-gap-3); flex-wrap: wrap; justify-content: flex-end; flex: none; }

/* iOS inset grouped list：圆角分组 + 细分隔线 */
.awu-section {
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  overflow: hidden;
  box-shadow: var(--awu-specular);
}

.awu-sectionHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gap-6) var(--awu-gap-3);
  border-bottom: 1px solid var(--awu-line);
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
}

.awu-sectionHead .awu-count { font-family: var(--awu-sans); font-size: var(--awu-fs-caption); letter-spacing: 0; color: var(--awu-ink-mute); }

.awu-sectionBody { padding: 0 var(--awu-gap-6); }

/* iOS 表单行：左标签 + 右内容，行间发丝，最后一行去掉 */
.awu-field {
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-4) 0;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  border-bottom: 1px solid var(--awu-line);
}

.awu-field:last-child { border-bottom: none; }
.awu-fieldKey { color: var(--awu-ink-mute); }
.awu-fieldVal { color: var(--awu-ink-dim); word-break: break-word; }
.awu-fieldVal b { color: var(--awu-ink); font-weight: 500; }

/* 分组外的小标题（供 iOS「标签在卡外」使用） */
.awu-sectionLabel {
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
}

/* ================================================================ 日记（正文衬线，人物感锚点） */
.awu-diary { display: flex; flex-direction: column; gap: var(--awu-gap-6); }

.awu-day {
  position: relative;
  padding-left: var(--awu-gap-6);
  border-left: 1px solid color-mix(in srgb, var(--awu-gold) 30%, transparent);
}

.awu-day::before {
  content: "";
  position: absolute;
  left: -3.5px;
  top: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awu-gold);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--awu-gold) 16%, transparent);
}

.awu-dayDate {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  letter-spacing: .02em;
  color: var(--awu-gold);
  margin-bottom: var(--awu-gap-2);
}

.awu-line {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-3);
  padding: 2px var(--awu-gap-3);
  margin: 0 calc(var(--awu-gap-3) * -1);
  border-radius: var(--awu-r-xs);
  /* 设计语言：衬线体承担人物感 —— 日记正文必须是衬线 */
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-loose);
  letter-spacing: .01em;
  color: var(--awu-ink-dim);
  transition: background var(--awu-dur-2) var(--awu-ease);
}

.awu-line:hover { background: var(--awu-surface-3); }

.awu-lineMarker {
  flex: none;
  min-width: 14px;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
}

.awu-lineEdit {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: var(--awu-size-hit);
  padding: 0 var(--awu-gap-3);
  border: 1px solid transparent;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-accent-text);
  font: inherit;
  font-size: var(--awu-fs-label);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-line:hover .awu-lineEdit,
.awu-lineEdit:focus-visible { opacity: 1; }
.awu-lineEdit:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 1px; }
.awu-lineEdit:hover { background: color-mix(in srgb, var(--awu-accent) 14%, transparent); }

/* ================================================================ 关系 / 维护区 */
.awu-relation {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  box-shadow: var(--awu-specular);
}

.awu-relationLabel {
  flex: none;
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
}

.awu-relationTag {
  font-size: var(--awu-fs-body-lg);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--awu-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awu-relationMeta {
  margin-left: auto;
  flex: none;
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

.awu-diaryHead { display: flex; align-items: center; gap: var(--awu-gap-3); }

.awu-count {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

.awu-dangerZone {
  margin-top: var(--awu-gap-1);
  border-radius: var(--awu-r-lg);
  background: color-mix(in srgb, var(--awu-danger) 8%, var(--awu-surface-2));
  overflow: hidden;
}

.awu-dangerZone .awu-sectionHead {
  border-bottom-color: color-mix(in srgb, var(--awu-danger) 20%, transparent);
  color: var(--awu-danger);
}

.awu-dangerRow {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-5);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border-bottom: 1px solid color-mix(in srgb, var(--awu-danger) 14%, transparent);
}

.awu-dangerRow:last-child { border-bottom: none; }

.awu-dangerText { display: flex; flex-direction: column; gap: var(--awu-gap-1); min-width: 0; flex: 1; }
.awu-dangerText b { font-size: var(--awu-fs-body); font-weight: 600; color: var(--awu-ink); }
.awu-dangerText b[data-danger="true"] { color: var(--awu-danger); }
.awu-dangerText span { font-size: var(--awu-fs-label); line-height: var(--awu-lh-body); color: var(--awu-ink-mute); }

.awu-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 110px;
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  letter-spacing: .01em;
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
  border-radius: var(--awu-r-pill);
  background: var(--awu-surface-3);
  color: var(--awu-accent-text);
}

.awu-emptyTitle {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--awu-ink);
}

.awu-emptyHint {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
  max-width: 460px;
}

/* 错误条：与状态带共用几何（alert 态） */
.awu-err {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-4);
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  border: 1px solid color-mix(in srgb, var(--awu-danger) 34%, transparent);
  border-left: 2px solid var(--awu-danger);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-danger) 12%, var(--awu-surface-2));
  color: var(--awu-danger);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
}

/* 骨架屏：形状与即将出现的布局一致 */
.awu-sk { display: flex; flex-direction: column; gap: var(--awu-gap-5); padding: var(--awu-gap-1) 0; }
.awu-sk[data-shape="cards"] { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--awu-gap-6); padding: 0; }

.awu-skRow {
  height: 76px;
  border-radius: var(--awu-r-lg);
  background: linear-gradient(100deg,
    rgba(255, 255, 255, .04) 20%,
    rgba(255, 255, 255, .10) 40%,
    rgba(255, 255, 255, .04) 60%);
  background-size: 300% 100%;
  animation: awu-shimmer 1.4s linear infinite;
}

.awu-sk[data-shape="cards"] .awu-skRow {
  height: calc(var(--awu-gap-6) * 2 + var(--awu-size-avatar) + var(--awu-gap-4) * 2
    + var(--awu-fs-body) * var(--awu-lh-body) * 2 + var(--awu-fs-caption) * var(--awu-lh-snug));
}

.awu-sk[data-shape="detail"] .awu-skRow:first-child { height: 140px; }

/* ================================================================ 编辑器（整面板接管） */
.awu-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  /* 1120 大窗下编辑器收成 880 居中：像 iPad 设置页，而不是把表单拉满整屏 */
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  animation: awu-slide-in var(--awu-dur-3) var(--awu-ease);
}

.awu-editorHead {
  flex: none;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-6) var(--awu-gutter) var(--awu-gap-4);
  border-bottom: 1px solid var(--awu-line);
}

.awu-editorHeadMain { min-width: 0; flex: 1; }

.awu-editorKicker {
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--awu-ink-mute);
}

.awu-editorName {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-4);
  margin-top: var(--awu-gap-2);
  min-width: 0;
  /* 名字：衬线 + 角色色 */
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--awu-gold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-editorSource {
  flex: none;
  padding: 1px var(--awu-gap-4);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-pill);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  font-weight: 500;
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
}

.awu-editorHeadRight { display: flex; align-items: center; gap: var(--awu-gap-4); flex: none; }

.awu-editorProgress {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
  padding: 2px var(--awu-gap-4);
  border-radius: var(--awu-r-xs);
  background: var(--awu-surface-3);
}

.awu-editorReadonly {
  flex: none;
  padding: var(--awu-gap-3) var(--awu-gutter) 0;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
}

/* 正文区：单栏 + 760 居中。1120 下不做两栏——表单是"一条往下读"的流程，
   拆两栏会打断顺序；长文本交给专注层（见设计文档 §4 的判断）。 */
.awu-editorBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--awu-gap-6) max(var(--awu-gutter), calc((100% - var(--awu-content-max)) / 2)) var(--awu-gap-9);
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-5);
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-editorBody::-webkit-scrollbar { width: 8px; }
.awu-editorBody::-webkit-scrollbar-track { background: transparent; }
.awu-editorBody::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: var(--awu-r-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* ---- 分组：iOS inset grouped list ---- */
.awu-editGroup {
  /* 纵向 flex 容器里的分组不能参与收缩，否则折叠的分组会被压成一条空横条 */
  flex: none;
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  overflow: hidden;
  box-shadow: var(--awu-specular);
  transition: background var(--awu-dur-2) var(--awu-ease), box-shadow var(--awu-dur-2) var(--awu-ease);
}

.awu-editGroup[data-open="true"] { background: var(--awu-glass-3); }

/* 灵魂字段：角色色描边（保留 v0.1 的"这块最重要"信号） */
.awu-editGroup[data-soul="true"] {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--awu-gold) 40%, transparent), var(--awu-specular);
}

.awu-editGroupHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  width: 100%;
  min-height: 56px;
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
.awu-editGroupHead:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: -2px; }

.awu-editGroupChevron {
  flex: none;
  display: inline-flex;
  color: var(--awu-ink-faint);
  transition: transform var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease);
}

.awu-editGroup:hover .awu-editGroupChevron { color: var(--awu-ink-mute); }
.awu-editGroup[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }

.awu-editGroupTitle {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body-lg);
  font-weight: 600;
  letter-spacing: 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-editSoulBadge {
  flex: none;
  padding: 1px var(--awu-gap-4);
  border-radius: var(--awu-r-pill);
  font-size: var(--awu-fs-micro);
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--awu-on-character);
  background: var(--awu-grad);
}

.awu-editOptional {
  flex: none;
  padding: 1px var(--awu-gap-3);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-pill);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
}

.awu-editGroupCount {
  flex: none;
  margin-left: auto;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

.awu-editGroupBody {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-5);
  padding: var(--awu-gap-2) var(--awu-gap-6) var(--awu-gap-6);
  border-top: 1px solid var(--awu-line);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-editGroupHint {
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
  padding-top: var(--awu-gap-4);
}

.awu-editGroupHint[data-soul="true"] { color: var(--awu-gold); }

/* ---- 字段：标签在上、控件在下 ---- */
.awu-editField { display: flex; flex-direction: column; gap: var(--awu-gap-3); }

.awu-editFieldKey {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--awu-ink-mute);
}

.awu-editFieldKind {
  font-style: normal;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  font-weight: 400;
  letter-spacing: 0;
  padding: 0 var(--awu-gap-3);
  border-radius: var(--awu-r-xs);
  color: var(--awu-ink-mute);
  background: var(--awu-surface-3);
}

.awu-editInput {
  width: 100%;
  box-sizing: border-box;
  height: 40px;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body);
  letter-spacing: 0;
  line-height: var(--awu-lh-snug);
  padding: 0 var(--awu-gap-5);
}

.awu-editInput::placeholder { font-size: var(--awu-fs-body); }

.awu-editArea {
  height: auto;
  min-height: 56px;
  padding: var(--awu-gap-4) var(--awu-gap-5);
  resize: vertical;
  overflow-y: auto;
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
}

/* ---- 列表编辑器 ---- */
.awu-editList { display: flex; flex-direction: column; gap: var(--awu-gap-3); }
.awu-editListEmpty { font-size: var(--awu-fs-label); color: var(--awu-ink-mute); padding: var(--awu-gap-2) 0; }
.awu-editListItem { display: flex; align-items: flex-start; gap: var(--awu-gap-3); }

.awu-editListIndex {
  flex: none;
  width: 20px;
  padding-top: var(--awu-gap-5);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.awu-editListText {
  flex: 1;
  min-width: 0;
  height: auto;
  min-height: 40px;
  padding: var(--awu-gap-3) var(--awu-gap-4);
  resize: vertical;
  font-family: var(--awu-serif);
}

.awu-editListRemove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-hit);
  height: 40px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-ink-mute);
  cursor: pointer;
  opacity: .7;
  transition: opacity var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease),
    background var(--awu-dur-2) var(--awu-ease);
}

.awu-editListItem:hover .awu-editListRemove { opacity: 1; }
.awu-editListRemove:hover { color: var(--awu-danger); background: color-mix(in srgb, var(--awu-danger) 12%, transparent); }
.awu-editListRemove:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 1px; }

.awu-editAdd {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  min-height: var(--awu-size-hit);
  padding: 0 var(--awu-gap-5);
  border: 1px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-label);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), border-color var(--awu-dur-2) var(--awu-ease),
    background var(--awu-dur-2) var(--awu-ease);
}

.awu-editAdd:hover { color: var(--awu-accent-text); border-color: var(--awu-accent); background: color-mix(in srgb, var(--awu-accent) 10%, transparent); }
.awu-editAdd:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 1px; }

/* ---- 底部固定条 ---- */
.awu-editorFoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gutter) var(--awu-gap-5);
  border-top: 1px solid var(--awu-line);
  background: var(--awu-surface-foot);
  backdrop-filter: var(--awu-blur);
  -webkit-backdrop-filter: var(--awu-blur);
}

.awu-editorDirty {
  margin-right: auto;
  font-size: var(--awu-fs-label);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
  transition: color var(--awu-dur-2) var(--awu-ease);
}

.awu-editorDirty[data-dirty="true"] { color: var(--awu-accent-text); }
.awu-editorDirty[data-dirty="true"]::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: var(--awu-gap-2);
  border-radius: var(--awu-r-pill);
  background: currentColor;
  vertical-align: middle;
}

/* ---- 未保存确认（编辑器内浮层） ---- */
.awu-editorConfirm {
  position: absolute;
  inset: 0;
  z-index: var(--awu-z-inset);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--awu-gap-8);
  background: var(--awu-scrim-bg);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: var(--awu-r-xl);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-editorConfirmCard {
  width: 100%;
  max-width: 420px;
  padding: var(--awu-gap-7);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface);
  backdrop-filter: var(--awu-blur);
  -webkit-backdrop-filter: var(--awu-blur);
  box-shadow: var(--awu-shadow), var(--awu-specular);
}

.awu-editorConfirmTitle {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--awu-ink);
}

.awu-editorConfirmText {
  margin-top: var(--awu-gap-4);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-editorConfirmActions { display: flex; justify-content: flex-end; gap: var(--awu-gap-4); margin-top: var(--awu-gap-6); }

/* ================================================================ 弹层（iOS sheet：底部浮起 + grabber） */
.awu-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--awu-z-scrim);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: var(--awu-gap-6);
  background: var(--awu-scrim-bg);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-dialog {
  position: relative;
  width: min(var(--awu-dialog-w), 100%);
  max-height: min(84vh, var(--awu-dialog-max-h));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-xl);
  background: var(--awu-surface-dialog);
  backdrop-filter: var(--awu-blur);
  -webkit-backdrop-filter: var(--awu-blur);
  box-shadow: var(--awu-shadow), var(--awu-specular);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body);
  overflow: hidden;
  animation: awu-sheet-in var(--awu-dur-4) var(--awu-ease);
}

/* grabber：sheet 的抓把（纯装饰） */
.awu-dialog::before {
  content: "";
  flex: none;
  width: 36px;
  height: 5px;
  margin: var(--awu-gap-3) auto var(--awu-gap-1);
  border-radius: var(--awu-r-pill);
  background: var(--awu-line-strong);
}

.awu-dialogHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gap-8) var(--awu-gap-4);
  border-bottom: 1px solid var(--awu-line);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: 0;
}

.awu-dialogBody { padding: var(--awu-gap-5) var(--awu-gap-8) var(--awu-gap-2); overflow-y: auto; }

.awu-dialogFoot {
  display: flex;
  justify-content: flex-end;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-5) var(--awu-gap-8) var(--awu-gap-6);
  border-top: 1px solid var(--awu-line);
}

.awu-hint { font-size: var(--awu-fs-body); line-height: var(--awu-lh-body); color: var(--awu-ink-mute); }
.awu-hint b { color: var(--awu-ink-dim); font-weight: 500; }

.awu-input {
  width: 100%;
  box-sizing: border-box;
  height: 42px;
  padding: 0 var(--awu-gap-5);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-field);
  color: var(--awu-ink);
  font: inherit;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-control);
  letter-spacing: 0;
  outline: none;
  transition: border-color var(--awu-dur-2) var(--awu-ease), box-shadow var(--awu-dur-2) var(--awu-ease);
}

.awu-input::placeholder { color: var(--awu-ink-mute); font-size: var(--awu-fs-body); }
.awu-input:focus {
  border-color: var(--awu-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--awu-accent) 22%, transparent);
}

.awu-label {
  display: block;
  margin: var(--awu-gap-5) 0 var(--awu-gap-3);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
}

.awu-previewName {
  margin-top: var(--awu-gap-4);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-body-lg);
  color: var(--awu-ink-mute);
}

.awu-previewName b { color: var(--awu-gold); font-weight: 600; }

.awu-confirmText { font-size: var(--awu-fs-body-lg); line-height: var(--awu-lh-body); color: var(--awu-ink-dim); }
.awu-confirmText b { color: var(--awu-ink); font-weight: 600; }

.awu-check {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-4);
  margin-top: var(--awu-gap-5);
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
  cursor: pointer;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
  transition: border-color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-check:hover { border-color: var(--awu-line-strong); background: var(--awu-surface-3); }
.awu-check input { margin: 3px 0 0; accent-color: var(--awu-accent); cursor: pointer; }

/* ================================================================ 专注编辑层（长文本整屏） */
.awu-focus {
  position: absolute;
  inset: 0;
  z-index: var(--awu-z-inset);
  display: flex;
  flex-direction: column;
  border-radius: var(--awu-r-xl);
  background: var(--awu-surface);
  backdrop-filter: var(--awu-blur);
  -webkit-backdrop-filter: var(--awu-blur);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-focusHead {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gutter);
  border-bottom: 1px solid var(--awu-line);
}

.awu-focusTitle {
  flex: 1;
  min-width: 0;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-focusCount {
  flex: none;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

.awu-focusBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--awu-gutter) max(var(--awu-gutter), calc((100% - var(--awu-content-max)) / 2));
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-focusInput {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--awu-ink);
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-control);
  line-height: var(--awu-lh-loose);
  letter-spacing: .01em;
}

.awu-focusInput::placeholder { color: var(--awu-ink-mute); }

.awu-focusRead {
  font-family: var(--awu-serif);
  font-size: var(--awu-fs-control);
  line-height: var(--awu-lh-loose);
  color: var(--awu-ink-dim);
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
}

.awu-focusRead:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: 4px; border-radius: var(--awu-r-xs); }

.awu-focusFoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gutter) var(--awu-gap-5);
  border-top: 1px solid var(--awu-line);
}

.awu-focusHint { flex: 1; min-width: 0; font-size: var(--awu-fs-body); line-height: var(--awu-lh-body); color: var(--awu-ink-mute); }
.awu-focusHint[data-over="true"] { color: var(--awu-gold); }

/* ================================================================ 预留模块（世界书 / 词条 / CCv3 预览 / 编辑器分段） */
/* 对应组件尚未接线（见 2026-10-30-tavern-editor.md），规则先按新语言定死，
   免得组件落地时再改一次皮肤。 */

/* 世界书两栏：左条目列表 + 右条目内容（<900 收成单栏手风琴） */
.awu-loreSplit {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: var(--awu-gap-6);
  align-items: start;
}

.awu-lorePane { min-width: 0; display: flex; flex-direction: column; gap: var(--awu-gap-3); }
.awu-loreDetail { min-width: 0; display: flex; flex-direction: column; gap: var(--awu-gap-5); }

@media (max-width: 900px) {
  .awu-loreSplit { grid-template-columns: minmax(0, 1fr); }
}

.awu-editorTabs {
  flex: none;
  display: flex;
  gap: var(--awu-gap-1);
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  padding: 3px;
  border-radius: var(--awu-r-md);
  background: var(--awu-glass-3);
}

.awu-editorTab {
  flex: 1;
  min-width: 0;
  padding: var(--awu-gap-2) var(--awu-gap-4);
  border: none;
  border-radius: var(--awu-r-sm);
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-body);
  cursor: pointer;
  transition: background var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease);
}

.awu-editorTab[data-active="true"] { background: var(--awu-glass-1); color: var(--awu-ink); box-shadow: var(--awu-specular); }
.awu-editorTab:focus-visible { outline: 2px solid var(--awu-accent); outline-offset: -2px; }

.awu-exportPill {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  padding: 2px var(--awu-gap-4);
  border-radius: var(--awu-r-pill);
  background: var(--awu-surface-3);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-exportPill[data-state="ok"] { color: var(--awu-teal); background: color-mix(in srgb, var(--awu-teal) 14%, transparent); }
.awu-exportPill[data-state="warn"] { color: var(--awu-gold); background: color-mix(in srgb, var(--awu-gold) 14%, transparent); }
.awu-exportPill[data-state="bad"] { color: var(--awu-danger); background: color-mix(in srgb, var(--awu-danger) 14%, transparent); }

.awu-budgetTag,
.awu-levelTag {
  flex: none;
  padding: 0 var(--awu-gap-3);
  border-radius: var(--awu-r-pill);
  font-size: var(--awu-fs-micro);
  font-weight: 500;
  letter-spacing: .02em;
  color: var(--awu-ink-mute);
  background: var(--awu-surface-3);
}

.awu-levelTag[data-level="required"] { color: var(--awu-accent-text); background: color-mix(in srgb, var(--awu-accent) 16%, transparent); }
.awu-levelTag[data-level="recommended"] { color: var(--awu-gold); background: color-mix(in srgb, var(--awu-gold) 14%, transparent); }
.awu-budgetTag[data-budget="never"] { opacity: .7; }
.awu-budgetTag[data-budget="l1"] { color: var(--awu-accent-text); }

.awu-fieldCount {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
  font-variant-numeric: tabular-nums;
}

/* 词条 chips（世界书关键词 / 标签） */
.awu-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--awu-gap-3);
  min-height: 42px;
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-field);
  max-height: 132px;
  overflow-y: auto;
}

.awu-chips:focus-within { border-color: var(--awu-accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--awu-accent) 18%, transparent); }

.awu-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  height: var(--awu-size-hit);
  padding: 0 var(--awu-gap-2) 0 var(--awu-gap-4);
  border-radius: var(--awu-r-pill);
  background: var(--awu-surface-3);
  font-size: var(--awu-fs-label);
  color: var(--awu-ink);
  white-space: nowrap;
}

.awu-chipX {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--awu-r-pill);
  background: transparent;
  color: var(--awu-ink-mute);
  font-size: var(--awu-fs-caption);
  line-height: 1;
  cursor: pointer;
}

.awu-chipX:hover { background: var(--awu-surface-2); color: var(--awu-ink); }

.awu-chipInput {
  flex: 1;
  min-width: 140px;
  height: var(--awu-size-hit);
  border: none;
  outline: none;
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  font-size: var(--awu-fs-body);
}

.awu-chipInput::placeholder { color: var(--awu-ink-mute); }

/* 世界书列表 */
.awu-loreList { display: flex; flex-direction: column; gap: var(--awu-gap-3); }

.awu-loreRow {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  min-height: 56px;
  padding: var(--awu-gap-3) var(--awu-gap-5);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  box-shadow: var(--awu-specular);
  cursor: pointer;
  transition: background var(--awu-dur-2) var(--awu-ease);
}

.awu-loreRow:hover { background: var(--awu-surface-3); }
.awu-loreRow[data-issue="true"] { box-shadow: inset 2px 0 0 var(--awu-danger), var(--awu-specular); }
.awu-loreRow[data-enabled="false"] { opacity: .6; }

.awu-loreBody { display: flex; flex-direction: column; gap: var(--awu-gap-4); padding: var(--awu-gap-4) var(--awu-gap-5) var(--awu-gap-6); border-top: 1px solid var(--awu-line); }
.awu-loreAdv { display: flex; flex-direction: column; gap: var(--awu-gap-4); }

.awu-switchRow {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  min-height: 32px;
  font-size: var(--awu-fs-body);
  color: var(--awu-ink-dim);
  cursor: pointer;
}

.awu-switchRow input { accent-color: var(--awu-accent); cursor: pointer; }

/* CCv3 预览段 */
.awu-nativeField { display: flex; flex-direction: column; gap: var(--awu-gap-2); padding: var(--awu-gap-4) 0; border-bottom: 1px solid var(--awu-line); }
.awu-nativeField:last-child { border-bottom: none; }
.awu-nativeField[data-source="raw"] { border-left: 2px solid color-mix(in srgb, var(--awu-gold) 50%, transparent); padding-left: var(--awu-gap-4); }
.awu-nativeField[data-source="unmapped"] { border-left: 2px solid color-mix(in srgb, var(--awu-accent) 50%, transparent); padding-left: var(--awu-gap-4); }

.awu-jsonView {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: var(--awu-gap-4);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-field);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.awu-issueList { display: flex; flex-direction: column; gap: var(--awu-gap-3); }
.awu-stack { display: flex; flex-direction: column; gap: var(--awu-gap-6); }

.awu-path {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-modeOption { width: 100%; justify-content: flex-start; height: auto; padding: var(--awu-gap-5) var(--awu-gap-6); margin-bottom: var(--awu-gap-4); text-align: left; }
.awu-modeOptionRow { display: inline-flex; align-items: center; gap: var(--awu-gap-4); }
.awu-modeOptionText { display: inline-flex; flex-direction: column; gap: var(--awu-gap-1); }
.awu-modeLabel { font-size: var(--awu-fs-body-lg); font-weight: 600; }
.awu-modeHint { font-size: var(--awu-fs-body); font-weight: 400; color: var(--awu-ink-mute); }

/* ================================================================ 动效 */
/* 入场：居中放大淡入。刻意不用 translateX —— 面板靠 left/right/margin:auto 居中，
   keyframes 里任何 transform 都会在那个 200ms 内覆盖布局，窗口会先偏到一边再跳回来。
   scale 用独立属性，避免与 transform 打架。 */
@keyframes awu-panel-in {
  from { opacity: 0; scale: .985; transform: translateY(6px); }
  to { opacity: 1; scale: 1; transform: translateY(0); }
}

@keyframes awu-sheet-in {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes awu-fade { from { opacity: 0; } to { opacity: 1; } }

@keyframes awu-rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes awu-slide-in {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes awu-glow {
  0%, 100% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 18%, transparent), 0 8px 24px color-mix(in srgb, var(--awu-gold) 12%, transparent); }
  50% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 34%, transparent), 0 12px 32px color-mix(in srgb, var(--awu-gold) 20%, transparent); }
}

@keyframes awu-breathe {
  0%, 100% { opacity: .35; transform: scale(1); }
  50% { opacity: .85; transform: scale(1.05); }
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

@keyframes awu-progress {
  from { background-position: -45% 0; }
  to { background-position: 145% 0; }
}

@media (prefers-reduced-transparency: reduce) {
  .awu-panel, .awu-dialog, .awu-focus, .awu-editorConfirmCard {
    background: var(--awu-surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .awu-panel,
  .awu-card,
  .awu-detail,
  .awu-dialog,
  .awu-scrim,
  .awu-focus,
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
