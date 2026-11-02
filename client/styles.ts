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
.awu-panelFade,
.awu-scrim,
.awu-dialog {
  /* ---- 材质：三层玻璃 ----
     layer-1 = 面板底（最厚），layer-2 = 卡片/分组，layer-3 = 浮起元素（输入框、分段器底）。
     2026-10-30 主人第二次反馈「没啥液态玻璃感觉、偏白偏实」：面板底从 .72 降到 .58，
     卡片反而比底更实（.34 → 更亮），靠「底更透、层更实」拉开深度；sheen 是顶部高光强度，
     edge 是玻璃边缘的 1px 亮边 —— 这两样是玻璃在平背景上也认得出的关键。 */
  /* 2026-11-02（W1-C）：面板底 .66→.70。理由是两栏骨架落地后，右栏内容直接压在面板底上，
     太透时正文的第一行会被壁纸"顶"起来（对比度抖动）；抬高 4% 只损失一点通透感，
     换的是 1000px 宽正文的稳定底色。卡片/浮起层不动，深度仍然靠"底透、层实"拉开。 */
  --awu-glass-1: rgba(20, 20, 24, .70);
  --awu-glass-2: rgba(72, 72, 82, .44);
  /* 卡面 hover 档：只提亮一档（把灰蓝往白推），不叠加灰罩 */
  --awu-glass-2-hi: rgba(98, 98, 112, .52);
  --awu-glass-3: rgba(120, 120, 128, .20);
  --awu-shadow-card: 0 1px 2px rgba(0, 0, 0, .18);
  --awu-shadow-card-hi: 0 14px 34px rgba(0, 0, 0, .42);
  --awu-sheen: rgba(255, 255, 255, .13);
  --awu-glass-edge: rgba(255, 255, 255, .20);
  /* 大面积（面板底）用轻 blur；强 blur 只留给小面积元素（卡片/按钮/弹层内容），否则 1120×900 会掉帧。
     saturate 150%→138%：面板底下垫的多是灰蓝壁纸，1.5 倍饱和会把整块玻璃往蓝紫推，
     正文的黑白层次反而被压平；138% 是"有玻璃感但不抢色"的临界值。 */
  --awu-blur-panel: blur(20px) saturate(138%);
  --awu-blur: blur(30px) saturate(180%);
  /* 遮罩档：只糊字不磨砂。全视口遮罩上 6px 与 30px 的观感差别很小，成本差 5 倍。 */
  --awu-blur-sm: blur(6px);
  --awu-specular: inset 0 1px 0 rgba(255, 255, 255, .20);
  --awu-scrim-bg: rgba(0, 0, 0, .36);
  /* 降级用：prefers-reduced-transparency 时把玻璃换成实心底，必须有这一档，
     否则「关了透明」还是半透明（旧实现直接写 --awu-surface，就是那个 bug）。 */
  --awu-surface-opaque: #1e1e21;

  /* ---- 墨色 4 级（实测比值见设计文档 §2；faint 只作线条，禁止用于文字） ---- */
  --awu-ink: #f2f2f7;                          /* 12.49:1 */
  --awu-ink-dim: rgba(235, 235, 245, .82);     /* 正文：玻璃更透以后提一档，抵掉背景串色 */
  --awu-ink-mute: rgba(235, 235, 245, .68);    /* 小字下限 */
  --awu-ink-faint: rgba(235, 235, 245, .30);   /* 仅线条/装饰 */

  /* ---- 线 / 面（surface-* 是 glass-* 的语义别名，外部模块按老名字引用） ---- */
  --awu-line: rgba(255, 255, 255, .10);
  --awu-line-strong: rgba(255, 255, 255, .18);
  --awu-surface: var(--awu-glass-1);
  --awu-surface-2: var(--awu-glass-2);
  --awu-surface-3: var(--awu-glass-3);
  --awu-surface-field: rgba(0, 0, 0, .22);
  /* 左栏底：W1-C 起从 transparent 改为"一档微暗"，rail 因此比 main 低半层（凹陷） */
  --awu-surface-strip: rgba(0, 0, 0, .12);
  /* 弹层底 .86→.72：sheet 是"浮在面板之上"的托盘，太实会像另一块面板；
     72% + 30px 模糊 + 顶部 sheen 才有"玻璃托盘"的层次。 */
  --awu-surface-dialog: rgba(30, 30, 32, .72);

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
  --awu-on-character: #2b1d0a;                 /* 角色色底上的字（对 gold 9.55:1） */
  --awu-grad: linear-gradient(135deg, #ffd89b 0%, #e8c07a 52%, #e58a78 100%);
  /* 角色色块（头像/徽标）的立体投影：单独一个 token，因为它压在渐变上、
     深浅两态的强度不一样（深色要压住，浅色要收着），和卡片的 elevation 不是一回事。 */
  --awu-shadow-glyph: inset 0 1px 0 rgba(255, 255, 255, .45), 0 2px 8px rgba(0, 0, 0, .18);

  /* ---- 语义色 ---- */
  --awu-teal: #30d158;                         /*  6.89:1 成功 */
  --awu-danger: #ff6b61;                       /*  5.00:1 */
  --awu-rose: #e58a78;                         /*  5.47:1 */

  /* ---- 字体：正文与控件统一走无衬线黑体（2026-10-30 主人：用黑体会好很多）。
     黑体优先级按「系统里真装了的」排：macOS PingFang → Windows 微软雅黑 UI/雅黑 →
     Linux/通用 Noto Sans SC。衬线只留给「角色名 + 日记正文」两处辨识度。 */
  --awu-sans: -apple-system, "SF Pro Text", "SF Pro Display", "PingFang SC", "Microsoft YaHei UI",
    "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "Segoe UI", sans-serif;
  /* 衬线补上 Windows 的宋体：旧栈里 Georgia 是拉丁衬线，中文会掉回系统默认，
     结果「角色名用宋体」这条设计在 Windows 上根本没生效。 */
  --awu-serif: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif;
  --awu-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", monospace;

  /* ---- 字号 9 档（1120 大窗；中文正文下限 12→13px）----
     2026-10-30 主人第二次反馈「字体辨认困难」：11/12/13 三档整体上抬 1px，
     全部落在整数像素上（避免 0.5px 造成的发虚）。 */
  --awu-fs-micro: 11px;
  --awu-fs-caption: 12px;
  --awu-fs-label: 13px;
  --awu-fs-body: 14px;
  --awu-fs-body-lg: 15px;
  --awu-fs-control: 16px;
  --awu-fs-title: 18px;
  --awu-fs-headline: 22px;
  --awu-fs-display: 26px;

  /* ---- 行高 4 档（与字号强制配对） ---- */
  --awu-lh-tight: 1.25;
  --awu-lh-snug: 1.4;
  --awu-lh-body: 1.65;
  --awu-lh-loose: 1.8;
  /* ---- 整数行高阶梯（W1-C·§2.6）----
     为什么比例与整数两套并存：比例行高给"字号会变"的正文（14/15px 混排时按比例才对），
     整数行高给"高度必须锁死"的地方（卡片四行、岛屿列表行、字段行）。
     2026-10-30 那次「卡片高度差 1-2px，滚动像三块不同尺寸的砖」就是比例行高乘出 .5px 导致的，
     所以 1121/1132/1153/1172 等处的 22/23/18/22 不再写裸 px，统一走这里。
     命名带 -px 是为了和上面的比例档一眼分开；契约 §2.6 里写的 --awu-lh-tight/-body 是笼统指代，
     若直接把它们改成 px 会把 100+ 处比例用法一起改掉（22px 标题配 1.25 = 27.5px，整数化后会挤在一起），
     所以这里额外给两个"契约名 + -px"的别名额，JSX 侧读哪个都行。 */
  --awu-lh-px-18: 18px;
  --awu-lh-px-20: 20px;
  --awu-lh-px-22: 22px;
  --awu-lh-px-23: 23px;
  --awu-lh-px-24: 24px;
  --awu-lh-tight-px: var(--awu-lh-px-22);
  --awu-lh-body-px: var(--awu-lh-px-23);

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
  /* 栏内左右内距的唯一真源：桌面 = gutter(32)，<900 收成 16（见断点块）。
     单独一个令牌是因为"骨架退场的绝对定位"必须和栏内 padding 用同一个值 ——
     absolute 的 left/right 是从 padding box 量的，写 0 会得到"padding box 宽"(336)，
     比内容宽(272) 宽 64px，实测就是那次"骨架退场宽度跳变 + 左移 32px"。 */
  --awu-pane-pad-x: var(--awu-gutter);
  /* 长表单/长文本的阅读宽度：1120 全宽对中文表单太宽，正文收在 760 */
  --awu-content-max: 760px;
  /* 两栏骨架：左栏（列表）固定宽，右栏自适应。
     340→336：336 能被 8 整除（gutter 32 之后剩 272，正好放 4 个 68px 的 tab 位），
     340 会让分段器的 4 格算出 67.5px 的小数宽，最后一条 tab 与右边界差 1px。
     <1100 视口再降到 300（见文件末尾「响应式」段）。 */
  --awu-rail-w: 336px;

  /* ---- 尺寸 7 档 ---- */
  --awu-size-hit: 28px;
  --awu-size-icon: 32px;
  --awu-size-mark: 28px;
  --awu-size-rail: 36px;
  --awu-size-avatar: 38px;
  --awu-size-avatar-lg: 56px;

  /* ---- 圆角 6 档（面板 24 / 卡片 16 / 输入 12 / 按钮 10） ---- */
  --awu-r-xs: 8px;
  --awu-r-sm: 10px;
  --awu-r-md: 12px;
  --awu-r-lg: 16px;
  --awu-r-xl: 24px;
  --awu-r-pill: 999px;
  /* 弹层圆角单独一档：sheet 的 24 与面板 24 数值相同，但语义不同
     （面板是"窗"，sheet 是"托盘"），第 3 批蒸馏弹层不再自己写 16。 */
  --awu-radius-sheet: 24px;

  /* ---- 控件高度 2 档（W1-C：原来 34/38/40/42/44/46 六种）----
     ctrl-h    = 36：按钮默认 / md / block / 输入框 / 下拉
     ctrl-h-sm = 28：工具行小按钮 / 行内 chip 内的高
     其余高度（卡片 46、抽屉头 56）不是控件，留在各自规则里用整数。
     为什么是 36 而不是 34：iOS 触控目标下限 44 达不到时，36 是"能稳点中"的最小整数档，
     34 加上 1px 描边后实际可点区只有 32。 */
  --awu-ctrl-h: 36px;
  --awu-ctrl-h-sm: 28px;

  /* ---- 分隔线：比 --awu-line 更轻的一档 ----
     深色下 line 是 10% 白，在面板底(70%)上仍然是一条清晰实线，统计条/分组头这种
     "只是分区、不是边界"的地方应该几乎看不见（6%）；浅色 14%→8%。 */
  --awu-line-soft: rgba(255, 255, 255, .055);

  /* ---- 焦点环唯一真源（W1-C：原来 24 条规则各写各的，5 种 offset）----
     ring 用 accent 而不是 accent-text：焦点环是非文本装饰，3:1 就够（accent 3.82）；
     offset 两档：普通控件向外 +1（不压内容），沉在容器里的分段/整行头向内 -2（不出界）。 */
  --awu-focus-ring: var(--awu-accent);
  --awu-focus-offset: 1px;
  --awu-focus-offset-inset: -2px;

  /* ---- 卡片指针跟随高光（W1-C·§2.3）----
     只在 hover:hover + pointer:fine 下启用；JSX 把百分比写进 --awu-mx/--awu-my，
     缺省值 (50%, -10%) 就是原来那束"顶部中央"的静态高光，所以没有 JS 时观感与旧版一致。
     浅色必须更弱（.55）：同样的白高光叠在 68% 白卡上就是一块过曝的白斑。 */
  --awu-card-hi: rgba(255, 255, 255, .12);
  /* 一次性扫光（状态带/骨架共用）：深色是白扫，浅色要更亮才看得见 */
  --awu-sheen-sweep: rgba(255, 255, 255, .10);
  /* 骨架屏：底色与扫光分两个 token —— 旧版把 .04/.10 写死，浅色下等于白扫白（对比 1.02） */
  --awu-sk-base: rgba(255, 255, 255, .05);
  --awu-sk-sweep: rgba(255, 255, 255, .14);
  /* 骨架单行高：默认形态与 detail 兜底共用（原来两处各写一次 76px） */
  --awu-sk-row-h: 76px;

  /* ---- 动效令牌 v2（W0-B 地基）----
     语义名是唯一真源；下面的 --awu-dur-* 全部降级为别名，全库 300 处调用一处不改。
     数值与 client/motion.ts 的 T_FAST..T_AMBIENT 逐字相等 —— 改这里必须同步那边。
     各档分工：fast=触感、base=颜色/焦点环、mid=层级内位移、enter=大层进入、
     exit=退场（永远比对应进入快 ~40%，用户在等它消失）、slow=一次性扫光、ambient=呼吸/骨架。 */
  --awu-t-fast: .12s;
  --awu-t-base: .2s;
  --awu-t-mid: .24s;
  --awu-t-enter: .32s;
  --awu-t-exit: .16s;
  --awu-t-slow: .6s;
  --awu-t-ambient: 3.4s;
  /* 别名（旧名，保留以冻结调用方；数值必须与本段上面的语义名一致） */
  --awu-dur-1: var(--awu-t-fast);
  --awu-dur-2: var(--awu-t-base);
  --awu-dur-3: var(--awu-t-mid);
  --awu-dur-4: var(--awu-t-enter);
  --awu-dur-5: var(--awu-t-slow);
  --awu-dur-breathe: var(--awu-t-ambient);
  /* 缓动：进入=主曲线（弹簧收尾）、退场/落位=out、收起/塌陷=in。三档够用，别加第四档。 */
  --awu-ease: ${EASE};
  --awu-ease-out: cubic-bezier(.22,1,.36,1);
  --awu-ease-in: cubic-bezier(.55,0,1,.45);

  /* ---- 层：值刻意不变（设计文档 §5）。panel/scrim 是 body 级 portal 与宿主抢栈的经验值 ---- */
  --awu-z-panel: 2147482000;
  --awu-z-inset: 5;
  --awu-z-scrim: 2147482100;

  /* ---- 结构尺码（CSS 与 JS 的单一来源） ---- */
  --awu-panel-w: ${PANEL_WIDTH}px;
  --awu-panel-pad-y: ${PANEL_MAX_H}px;
  --awu-panel-max-h: calc(100vh - var(--awu-panel-pad-y));
  /* 弹层宽度（W3 单一真源）：620 是从"三个输入框排一行"反推的——
     760 宽下表单会被拉成两条长杠，iOS sheet 的呼吸感就没了。
     蒸馏弹层不再自己写 420/760，直接继承这一档（.awu-distill-dialog 的几何规则已删）。 */
  --awu-dialog-w: 620px;
  --awu-dialog-max-h: 720px;

  --awu-shadow: 0 28px 80px rgba(0, 0, 0, .50), 0 2px 12px rgba(0, 0, 0, .30);
  --awu-scroll: rgba(235, 235, 245, .28);

  /* 宿主的系统滚动条钩子 */
  --dsh-scrollbar-thumb: var(--awu-scroll);
  --dsh-scrollbar-thumb-hover: rgba(235, 235, 245, .48);
}

/* 浅色：晨光玻璃。液态玻璃在浅色下是「白色半透明 + 白色高光」，不是把深色反相。
   判定必须同时看 html 与 body：宿主把 data-ds-dark-theme 打在 **body** 上
   （dsh-client-ui-theme 里是 body[data-ds-dark-theme]{…}），而预览沙盒历史上打在 html 上。
   只判 html 会让 :not() 恒真 → 深色皮肤下浅色令牌永远生效，暗色态根本出不来。 */
html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) :is(.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog) {
  --awu-glass-1: rgba(255, 255, 255, .54);
  --awu-glass-2: rgba(255, 255, 255, .68);
  /* 卡面 hover 档：比静息更白（卡浮起来 = 挡住更多背景） */
  --awu-glass-2-hi: rgba(255, 255, 255, .86);
  --awu-glass-3: rgba(120, 120, 128, .13);
  --awu-shadow-card: 0 1px 2px rgba(30, 30, 40, .05);
  --awu-shadow-card-hi: 0 14px 32px rgba(30, 30, 40, .16), 0 2px 6px rgba(30, 30, 40, .08);
  --awu-sheen: rgba(255, 255, 255, .46);
  --awu-glass-edge: rgba(255, 255, 255, .78);
  --awu-blur-panel: blur(18px) saturate(185%) brightness(1.03);
  --awu-specular: inset 0 1px 0 rgba(255, 255, 255, .95);
  --awu-scrim-bg: rgba(18, 20, 26, .16);
  --awu-surface-opaque: #f6f6f8;

  --awu-ink: #1c1c1e;                          /* 16.44:1 */
  --awu-ink-dim: rgba(60, 60, 67, .88);        /* 正文 */
  --awu-ink-mute: rgba(60, 60, 67, .78);       /* 小字下限 */
  --awu-ink-faint: rgba(60, 60, 67, .30);      /* 仅线条 */

  --awu-line: rgba(60, 60, 67, .14);
  --awu-line-strong: rgba(60, 60, 67, .24);
  --awu-line-soft: rgba(60, 60, 67, .08);
  --awu-card-hi: rgba(255, 255, 255, .55);
  --awu-sheen-sweep: rgba(255, 255, 255, .55);
  --awu-sk-base: rgba(60, 60, 67, .09);
  --awu-sk-sweep: rgba(255, 255, 255, .72);
  --awu-surface-field: rgba(120, 120, 128, .10);
  --awu-surface-strip: rgba(120, 120, 128, .06);
  --awu-surface-dialog: rgba(255, 255, 255, .90);

  --awu-accent: #007aff;
  --awu-accent-strong: #0066cc;
  --awu-accent-text: #0066cc;
  --awu-on-accent: #ffffff;

  --awu-gold: #8a5f1e;                         /*  5.43:1 */
  --awu-on-character: #2b1d0a;
  --awu-grad: linear-gradient(135deg, #f2ce93 0%, #d9a35c 52%, #c98a6e 100%);
  --awu-shadow-glyph: inset 0 1px 0 rgba(255, 255, 255, .85), 0 2px 6px rgba(30, 30, 40, .12);

  --awu-teal: #1e7a33;                         /*  4.62:1 */
  --awu-danger: #d70015;                       /*  5.20:1 */
  --awu-rose: #c0392b;

  --awu-shadow: 0 34px 84px rgba(28, 30, 40, .24), 0 6px 20px rgba(28, 30, 40, .10);
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

.awu-trigger:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

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
  box-shadow: var(--awu-shadow-glyph);
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
  border: 1px solid var(--awu-glass-edge);
  border-radius: var(--awu-r-xl);
  /* 玻璃本体：径向 sheen（左上/顶部高光）+ 一层极淡的竖向亮带 + 透光底色。
     这三层都在内容之下，不遮字；靠它们，纯白背景上也能看出「这块是玻璃」。 */
  background-image:
    radial-gradient(120% 78% at 50% -22%, var(--awu-sheen) 0%, transparent 62%),
    linear-gradient(180deg, var(--awu-glass-edge) 0%, transparent 12%);
  background-color: var(--awu-glass-1);
  backdrop-filter: var(--awu-blur-panel);
  -webkit-backdrop-filter: var(--awu-blur-panel);
  box-shadow:
    var(--awu-shadow),
    inset 0 1px 0 var(--awu-glass-edge),
    inset 0 0 0 1px color-mix(in srgb, var(--awu-glass-edge) 40%, transparent);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  overflow: hidden;
  transform-origin: center;
  /* 2026-11-02（主人报「二段式」后重做）：面板本体不再播任何动画。
     原因见文件末尾「面板进场：玻璃静态、内容淡入」：
     这块玻璃一旦参与动画，backdrop-filter 就要逐帧重算 1.12M px（本机软件合成
     下直接卡在首帧）；而省掉模糊再装回去又会硬切一次（那就是「顿一下」）。
     两条路都被实测否掉，所以玻璃静止、动效交给内容层。 */
  animation: none;
}

/* ---- 面板进场：内容层放大上浮（2026-11-02 四次修订）
   演进与结论：
     ① 直接给面板播动画、动画期摘掉模糊 → animationend 硬切（「二段式」）；
     ② 面板静止 + 外壳纯淡入 → 没有线性感；
     ③ 把放大上浮挪到外壳 → 主人实测「彻底半透明了」。
   ③ 的失败是决定性的：Chromium 里给「含 backdrop-filter 元素的祖先」加 opacity/transform
   会把祖先提升为独立渲染表面，backdrop-filter 采到的就不再是页面背景，玻璃退化成
   「假半透明」，而且可能停在中间帧不回落。所以——

   **铁律：面板本身与它的任何祖先都不能有 opacity / transform / scale 动画。**
   放大上浮只能落在面板**内部**的内容层（内容画在模糊之上，不参与背板采样）。
   玻璃（background + backdrop-filter + 100vmax 压暗）在挂载首帧就完整就位且全程恒定。 */
.awu-panelFade {
  position: fixed;
  inset: 0;
  z-index: 2147482000;
  pointer-events: none;
}

/* 全屏压暗（原来挂在面板的 box-shadow: 0 0 0 100vmax 上）。
   挪到这里是因为：它是面板的"影子"，跟着面板会出现得很硬；而它本身是纯色层，
   放在**外壳的伪元素**上单独淡入既便宜又安全（外壳没有 backdrop-filter，动它不伤玻璃采样）。
   z-index 让它在面板之下：面板自己 z-index 2147482000，伪元素按 DOM 顺序先画。 */
.awu-panelFade::before {
  content: "";
  position: fixed;
  inset: 0;
  background: var(--awu-scrim-bg);
  pointer-events: none;
  /* 基线就是"已压暗"：用 backwards 而不是 both —— 万一环境不跑动画，最坏是压暗瞬现，
     绝不会变成"没有压暗"。 */
  opacity: 1;
  animation: awu-scrim-in var(--awu-t-base) var(--awu-ease-out) backwards;
}

/* 面板自己是 auto：外壳不吞点击，但面板里的一切照常可点 */
.awu-panelFade > .awu-panel {
  pointer-events: auto;
}

/* 进场动效：三段内容依次「放大 + 上浮 + 淡入」，玻璃框不动。
   错开 0 / 40ms / 80ms，每段 200ms —— 整体在 280ms 内收住，读起来是一气呵成的一次落位。
   这些节点都不带 backdrop-filter（面板的模糊在父层），所以缩放不会触发背板重采样。
   fill 用 backwards（不是 both）：基线是"完全可见"，动画不跑时最坏只是没有入场效果，
   绝不会把内容永远停在 opacity:0（这一点上一版真踩过，面板整块看不见）。 */
.awu-panel > .awu-head,
.awu-panel > .awu-status,
.awu-panel > .awu-workspace {
  animation: awu-content-in var(--awu-t-base) var(--awu-ease) backwards;
}

.awu-panel > .awu-status {
  animation-delay: calc(var(--awu-t-fast) / 3);
}

.awu-panel > .awu-workspace {
  animation-delay: calc(var(--awu-t-fast) / 3 * 2);
}


/* ================================================================ 两栏骨架（iOS Split View） */
/* JSX 接线：<div class="awu-workspace"><aside class="awu-rail">…列表…</aside><main class="awu-main">…内容…</main></div>
   两栏各自独立滚动；<900px 收成单栏（.awu-rail 隐藏条件由 JSX 决定，见设计文档 §3.2）。 */
.awu-workspace {
  /* position: relative 是必须的：<900 单栏 push 时 .awu-rail 走绝对定位，
     没有它就会以 .awu-panel（fixed）为基准铺满整个面板、把头部一起盖住。 */
  position: relative;
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
  /* 左栏「凹陷」/ 右栏「浮起」（W1-C·§C6）：
     1) 底一档微暗（--awu-surface-strip = 深 12% 黑 / 浅 6% 灰），rail 因此比 main 低半层；
     2) 分隔线从 border 换成 inset 阴影：border 会占 1px 布局宽（336 变 335，四格算出 67.75），
        inset 不占位、还能和 --awu-line-soft 一起调淡；
     3) 顶部一条极淡的亮边，让"凹陷"有厚度（只有下压没有高光会像一块补丁）。 */
  background: var(--awu-surface-strip);
  box-shadow:
    inset -1px 0 0 var(--awu-line-soft),
    inset 0 1px 0 color-mix(in srgb, var(--awu-glass-edge) 35%, transparent);
  overflow: hidden;
}

.awu-main {
  position: relative; /* .awu-menu 的定位锚点；也是单栏 nav 栈的层基准 */
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 栏内可滚动区（替代旧的 .awu-body 在单栏里的角色） */
.awu-pane {
  /* 骨架退场要脱离文档流（见 .awu-sk[data-state="closing"]），它需要这里当定位上下文 */
  position: relative;
  /* 命名容器（C 条的兜底用）：只有左栏这条列表会用到 .awu-pane，内容宽 236~272px。
     用 inline-size 而不是 size —— 纵向高度仍由 flex 决定，不参与容器查询。 */
  container: awu-list / inline-size;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 左右内距走 --awu-pane-pad-x：骨架退场要按同一个值做绝对定位，
     两处要是各写各的（一处 gutter、一处 gap-7），窄屏下就会差 4px。 */
  padding: var(--awu-gap-6) var(--awu-pane-pad-x) var(--awu-gap-9);
}

/* ---- 滚动条（W1-C：原来三处复制，第四处漏抄）----
   列表 / 右栏正文 / 编辑器正文 / 专注层共用一个真源：细轨 + 静息几乎透明 + 指针进栏或键盘聚焦才显形。
   ⚠️ 新增滚动容器的做法是在下面四条规则里加选择器，**不要**再复制一段 ——
   之前 .awu-focusBody 就是因为没加进来，长文本编辑时用的是系统默认粗滚动条。 */
.awu-pane,
.awu-mainBody,
.awu-editorBody,
.awu-focusBody {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--awu-scroll) 22%, transparent) transparent;
}

.awu-pane:hover,
.awu-pane:focus-within,
.awu-mainBody:hover,
.awu-mainBody:focus-within,
.awu-editorBody:hover,
.awu-editorBody:focus-within,
.awu-focusBody:hover,
.awu-focusBody:focus-within {
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-pane::-webkit-scrollbar,
.awu-mainBody::-webkit-scrollbar,
.awu-editorBody::-webkit-scrollbar,
.awu-focusBody::-webkit-scrollbar { width: 8px; }

.awu-pane::-webkit-scrollbar-track,
.awu-mainBody::-webkit-scrollbar-track,
.awu-editorBody::-webkit-scrollbar-track,
.awu-focusBody::-webkit-scrollbar-track { background: transparent; }

.awu-pane::-webkit-scrollbar-thumb,
.awu-mainBody::-webkit-scrollbar-thumb,
.awu-editorBody::-webkit-scrollbar-thumb,
.awu-focusBody::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: var(--awu-r-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
  transition: background-color var(--awu-dur-2) var(--awu-ease);
}

.awu-pane:hover::-webkit-scrollbar-thumb,
.awu-pane:focus-within::-webkit-scrollbar-thumb,
.awu-mainBody:hover::-webkit-scrollbar-thumb,
.awu-mainBody:focus-within::-webkit-scrollbar-thumb,
.awu-editorBody:hover::-webkit-scrollbar-thumb,
.awu-editorBody:focus-within::-webkit-scrollbar-thumb,
.awu-focusBody:hover::-webkit-scrollbar-thumb,
.awu-focusBody:focus-within::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--awu-scroll) 80%, transparent);
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
  /* 工具栏与列表之间一条发丝：把「操作区 / 内容区」分开，滚动列表从线下开始。
     W1-C：降到 line-soft —— 左栏已经是"凹陷"的底，再叠一条 10% 的实线会显得像切了一刀。 */
  border-bottom: 1px solid var(--awu-line-soft);
}

/* 子块 margin 归零 —— 必须写到「两个类」的权重。写成 .awu-railHead > * 时与后面的
   .awu-tabs 同为 (0,1,0)，而 .awu-tabs 在文件里更靠后，会赢回去；实测分段器被夹成
   双份 gutter（207px 宽），「角色簿」直接变成省略号。 */
.awu-railHead > .awu-distill-entry,
.awu-railHead > .awu-tabs,
.awu-railHead > .awu-toolbar,
.awu-railHead > .awu-railNow { margin: 0; }

/* 窄屏列表态：全局动作（刷新 / 关闭）随 tablist 一起搬进左栏头部（JSX 在 showTabsInRail 时渲染）。
   它自己是个 flex 容器，且会被列向父级 stretch 成整行宽 —— 不右对齐就是孤零零贴左的一排图标。
   用 justify-content 而不是 margin-left:auto：后者只会推容器本身，容器已经满宽了。 */
.awu-railHead > .awu-headActions { justify-content: flex-end; }

/* ================================================================ 右栏顶部（W1-C 新骨架，契约 §2.4）
   JSX 结构：.awu-main > .awu-mainHead（tabs + 全局动作） + .awu-mainBody（四视图）
   为什么要拆：tabs 原来在左栏，切 tab 却影响右栏内容，视线要横跨 1120px；
   归位到右栏顶部后，"切什么"和"看什么"在同一个视觉列里。 */
.awu-mainHead {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-5);
  min-width: 0;
  /* 只用下边一条发丝（line-soft），不加卡片底 —— 它是"栏头"，不是一块内容 */
  padding: var(--awu-gap-5) var(--awu-gutter) var(--awu-gap-4);
  border-bottom: 1px solid var(--awu-line-soft);
}

/* tabs 搬进 mainHead 后自带 margin 会变成双份 gutter（rail 侧由上一段归零） */
.awu-mainHead > .awu-tabs { flex: 1; min-width: 0; margin: 0; }
.awu-mainHead > .awu-headActions { margin-left: auto; flex: none; }

.awu-mainBody {
  /* 同上：骨架退场的定位上下文 */
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 横向一律裁掉：详情页退场会 translateX(8px)，留着 auto 就会在退场那 160ms 里
     抖出一条横向滚动条（整块内容跟着宽 8px 再弹回来）。本设计里滚动容器不需要横向滚动。 */
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: var(--awu-gap-6) var(--awu-pane-pad-x) var(--awu-gap-9);
}

/* tabpanel 容器是可聚焦的（tabIndex=0，供键盘用户跳过 rail 直接进内容区），
   所以焦点环会画在整块内容区上：必须内描边，否则 1px 外环会被 .awu-main 裁掉一半。 */
.awu-mainBody:focus-visible {
  outline: 2px solid var(--awu-focus-ring);
  outline-offset: var(--awu-focus-offset-inset);
}

/* tab 切换 crossfade（契约 §3：T_FAST，只 opacity，不带位移、不带 stagger）。
   做法是给"视图根节点"一条进场动画 —— 视图切换时 React 换的是根节点本身，
   新节点入 DOM 就自动播一次；同一个节点被复用时不会重播（这正是切 tab 与刷新的区别）。
   为什么写在这里而不是文件末尾的动效段：靠**顺序**让各视图自己的进场动画赢
   （.awu-detail 的 awu-slide-in、.awu-guide 等都在本行之后声明），
   这里只兜住"没有自己动画"的那几个视图。 */
.awu-mainBody > * {
  animation: awu-view-in var(--awu-t-fast) var(--awu-ease-out) backwards;
}

/* 左栏"正在看：X"一行（diary tab 下显示，data-empty 时隐藏）。
   data-empty 由 JSX 写；React 传 false 会直接不渲染该属性，所以 [data-empty] 只在"真空"时命中。 */
.awu-railNow {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  flex: none;
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid var(--awu-line-soft);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-railNow b { color: var(--awu-gold); font-weight: 600; }
/* ⚠️ 必须写 ="true"：JSX 侧是 data-empty={cond ? 'true' : 'false'}，
   写成 [data-empty] 会连 "false" 一起命中 → 这一行永远不显示。 */
.awu-railNow[data-empty="true"] { display: none; }

/* 主断点：<900 收成单栏（详情页占满、列表退回全宽）
   W1-C 新增：单栏导航栈（契约 §2.1 的 data-nav）。
   为什么需要：旧版单栏时 rail 不隐藏，选中一张卡后详情排在整张列表**下面**，
   用户得滚过 20 张卡才看到刚点的东西（审查 F35）。现在由 JSX 声明语义，
   CSS 只负责"push 盖住列表、pop 退回列表"的层级；进退位移留给第 2 批的动效。 */
@media (max-width: 900px) {
  .awu-workspace { display: block; overflow-y: auto; }
  .awu-rail { width: 100%; }
  .awu-main { min-height: auto; }
  .awu-pane { padding: var(--awu-gap-5) var(--awu-pane-pad-x) var(--awu-gap-8); }
  .awu-mainBody { padding: var(--awu-gap-5) var(--awu-pane-pad-x) var(--awu-gap-8); }
  .awu-panel {
    --awu-gutter: 20px;
    /* 窄屏的栏内左右内距是 16（不是 20 的 gutter）：这是历史值，骨架退场的绝对定位
       要和它同一个真源，否则窄屏下会差 4px（W4 实测过的"宽度跳变"就是从这类不同源来的）。 */
    --awu-pane-pad-x: var(--awu-gap-7);
  }

  /* push / pop：详情覆盖列表。用 position + z-index 而不是 display:none ——
     display 切换会让 rail 的滚动位置在返回时丢失，且第 2 批要给"覆盖"做位移。
     ⚠️ W2 补 pop（视觉 bug 修复）：JSX 在 pop 期间会把 .awu-main 多留 240ms 让退场播完。
     如果 pop 不像 push 那样把 rail 压到绝对定位的下层，这 240ms 里窄屏看到的是
     「详情页和角色列表上下堆叠」——比没有动画更难看。所以两个方向共用同一条覆盖规则。 */
  .awu-workspace:is([data-nav="push"], [data-nav="pop"]) > .awu-rail {
    position: absolute;
    inset: 0;
    width: 100%;
    visibility: hidden;
    pointer-events: none;
  }
  .awu-workspace:is([data-nav="push"], [data-nav="pop"]) > .awu-main {
    position: relative;
    z-index: var(--awu-z-inset);
    min-height: 100%;
  }
}

/* 中宽：两栏还开着，但左栏收窄一档（336→300），把宽度让给正文。
   901~1099 区间右栏内容区只有 465~663px 时，世界书两栏/字段两列会挤（审查 F34）。 */
@media (max-width: 1099px) {
  :is(.awu-scope, .awu-layer) { --awu-rail-w: 300px; }
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
  /* 统计条那一行只是"分区"，不是边界：用 line-soft（深色 5.5%）几乎看不见，
     但能把标题与右侧动作拉开；用 line(10%) 会变成一条抢眼的横线。 */
  background: var(--awu-line-soft);
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

/* 标题下方的总量元信息（原右栏顶部的三个大计数块）。
   2026-10-30 主人第三轮：「三个计数块太大，视觉重量和内容主体打架」——
   这里做成一行 12px 的小字读数：数字等宽（列对齐）、单位同色、分隔点更淡。
   它现在跟标题同属 headMain，随头部一起走，详情页也不必再让出顶部空间。 */
.awu-counts {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-3);
  margin-top: var(--awu-gap-3);
  font-size: var(--awu-fs-caption);
  line-height: 1.35;
  letter-spacing: .01em;
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-countItem {
  display: inline-flex;
  align-items: baseline;
  gap: var(--awu-gap-2);
}

/* 数字用等宽：三个数字右沿对齐，扫视时不会跳 */
.awu-countItem b {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-body);
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  color: var(--awu-ink-dim);
  font-variant-numeric: tabular-nums;
}

.awu-countSep { color: var(--awu-ink-faint); }

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
.awu-iconBtn:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }
.awu-iconBtn[data-spin="true"] svg { animation: awu-spin .9s linear infinite; }

/* 面板忙碌：头底一条 2px 不定进度光带。
   W2：原来动 background-position（每帧重绘整条），改成"45% 宽的光块 + translateX"，
   位移是合成属性，2px 高的东西也不该占一条 paint 通道。 */
.awu-panel[data-busy="true"] .awu-head::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0;
  width: 45%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--awu-accent), transparent);
  animation: awu-sweep-x 1.1s linear infinite;
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
  gap: var(--awu-gap-4);
  margin: 0 var(--awu-gutter) var(--awu-gap-5);
  padding: var(--awu-gap-3) var(--awu-gap-6);
  min-height: 44px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background-color: var(--awu-glass-2);
  background-image: radial-gradient(120% 140% at 50% -60%, var(--awu-sheen) 0%, transparent 70%);
  overflow: hidden;
  color: var(--awu-ink-mute);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-snug);
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
  background: linear-gradient(100deg, transparent 32%, var(--awu-sheen-sweep) 50%, transparent 68%);
  transform: translateX(-100%);
  animation: awu-sheen var(--awu-dur-5) var(--awu-ease) 1;
  pointer-events: none;
}

/* 未启用 = 安静的一条提示，不再用虚线框（虚线在这套界面里已经借给了拖放区，
   而且「一整条虚线」正是主人说的简陋感的来源）。 */
.awu-status[data-status="idle"],
.awu-idle {
  border-style: solid;
  border-color: var(--awu-line);
  background-color: transparent;
  background-image: none;
}

.awu-status[data-status="info"] {
  background: color-mix(in srgb, var(--awu-accent) 10%, var(--awu-surface-2));
  border-color: color-mix(in srgb, var(--awu-accent) 26%, transparent);
  color: var(--awu-ink-dim);
}

.awu-status[data-status="alert"] {
  /* 2026-11-02 对比度修复（审查 C1）：旧版是「12% 红底 + 红字」= 同色压同色，
     深色 4.17:1 / 浅色 4.33:1，14px 正文不达 4.5。改成中性底，红只留在描边与左轨。
     复算（sRGB 直通 alpha 合成，底 = surface-2 叠面板）：深 4.94:1 / 浅 5.38:1 → 达标。 */
  background: var(--awu-surface-2);
  border-color: color-mix(in srgb, var(--awu-danger) 34%, transparent);
  color: var(--awu-danger);
}

.awu-status[data-status="alert"]::before { background: var(--awu-danger); }

.awu-sigilBody { min-width: 0; flex: 1; }

.awu-sigilName {
  /* 与角色卡名一致：黑体 600 + 角色金（衬线已收回日记正文） */
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .01em;
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

.awu-sigilBtns { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--awu-gap-3); flex: none; }

.awu-idleDot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-ink-faint);
}


/* ================================================================ 分段控制（iOS segmented） */
/* W1-C：选中块改由 .awu-tabs::before 的滑块承担（契约 §2.3）。
   JSX 只需往 .awu-tabs 上写两个内联变量：--awu-tab-i（序号，0 基）/ --awu-tab-n（总数）。
   缺省值按 4 格：没有 JS 变量时滑块停在第一格，观感与旧版"第一个 tab 高亮"一致。 */
.awu-tabs {
  position: relative;
  flex: none;
  display: flex;
  gap: var(--awu-gap-1);
  margin: 0 var(--awu-gutter) var(--awu-gap-6);
  padding: 3px;
  border-radius: var(--awu-r-md);
  background: var(--awu-glass-3);
}

/* 滑块宽度必须把 gap 算进去，否则 4 格时右侧会累积 3 × 2px 的误差：
   可用宽 = 100% − 两侧 padding(3px×2) − (n−1) × gap；
   单格宽 = 可用宽 / n；位移 i × (单格宽 + gap)。
   translateX 的百分比是相对元素自身宽（= 单格宽），所以位移可以直接写成 i × (100% + gap)。 */
.awu-tabs::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 3px;
  bottom: 3px;
  width: calc((100% - 6px - (var(--awu-tab-n, 4) - 1) * var(--awu-gap-1)) / var(--awu-tab-n, 4));
  border-radius: var(--awu-r-sm);
  /* 滑块用 glass-2-hi 而不是 glass-1：glass-1 在深色下是"面板底"(20,20,24,.70)，
     画在更亮的槽(glass-3)上会读成一个黑洞（实测深色下"选中的是凹下去的"）；
     glass-2-hi 在深浅两态都比槽亮，才像一枚被推上去的白色小片。 */
  background: var(--awu-glass-2-hi);
  box-shadow: var(--awu-shadow-card), var(--awu-specular);
  transform: translateX(calc(var(--awu-tab-i, 0) * (100% + var(--awu-gap-1))));
  transition: transform var(--awu-t-mid) var(--awu-ease);
  pointer-events: none;
}

.awu-tab {
  position: relative; /* 压在滑块之上；没有这层，rAF 跟随的雪佛龙会被滑块盖住 */
  z-index: 0;
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
  transition: color var(--awu-dur-2) var(--awu-ease);
}

.awu-tab:hover { color: var(--awu-ink-dim); }

/* 选中态只留文字（底与阴影已交给 ::before 滑块）——
   这两行如果还在，滑块下面会多出一层硬边底，4 格时能明显看到"双底"。 */
.awu-tab[data-on="true"] {
  color: var(--awu-ink);
  font-weight: 600;
}

.awu-tab:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }

/* 顶部滚动阴影：纯 CSS + scroll timeline，不支持就只是没有阴影。
   2026-11-02（W1-C）：原写法是 scroll(self)，但 ::before 是伪元素、自身不是滚动容器，
   按规范时间线不活跃 → 阴影永远停在 opacity:0（等于这条规则从未生效）。
   改成 scroll(nearest)，由最近的滚动祖先（.awu-pane / .awu-mainBody / .awu-editorBody）驱动。 */
@supports (animation-timeline: scroll()) {
  .awu-pane::before,
  .awu-mainBody::before,
  .awu-editorBody::before {
    content: "";
    position: sticky;
    top: 0;
    display: block;
    height: 1px;
    margin-bottom: -1px;
    background: var(--awu-line-strong);
    opacity: 0;
    animation: awu-scroll-hint linear both;
    animation-timeline: scroll(nearest);
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

/* ---- 两张卡的入口（同级并排：蒸馏 / 自创）----
   主人反馈原来「蒸馏角色卡」是一大块、「新建角色」是工具行里的小字，一大一小。
   现在两枚按钮共用 .awu-btn.awu-distill-cta（同尺寸同权重），各占半栏。 */
.awu-ctaRow {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-4);
  min-width: 0;
}

.awu-ctaRow > .awu-distill-entry { flex: 1 1 0; min-width: 0; margin: 0; }
.awu-railHead > .awu-ctaRow { margin: 0; }

/* ---- 模式胶囊（左栏工具栏；不要求先启用角色）---- */
.awu-toolbar[data-wrap="true"] { flex-wrap: wrap; row-gap: var(--awu-gap-3); }

.awu-modePills {
  display: inline-flex;
  gap: 2px;
  min-width: 0;
  padding: 2px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-surface-3);
}

.awu-modePill {
  min-height: 24px;
  padding: 0 var(--awu-gap-4);
  border: none;
  border-radius: var(--awu-r-pill);
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-caption);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease);
}

.awu-modePill:hover { color: var(--awu-ink); }
.awu-modePill[data-on="true"] { background: var(--awu-glass-1); color: var(--awu-ink); box-shadow: var(--awu-specular); }
.awu-modePill:disabled { opacity: .45; cursor: default; }
.awu-modePill:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }

/* ---- 提示条：成功（info）自动淡出，警告（warn）留给人手动关 ---- */
.awu-status[data-status="warn"] {
  background: color-mix(in srgb, var(--awu-gold) 12%, var(--awu-surface-2));
  border-color: color-mix(in srgb, var(--awu-gold) 34%, transparent);
  color: var(--awu-ink-dim);
}

.awu-status[data-status="info"] .awu-idleDot { background: var(--awu-teal); }
.awu-status[data-status="warn"] .awu-idleDot { background: var(--awu-gold); }

/* 软警告是多行文本（每条一行），必须保留换行 */
.awu-noticeText {
  flex: 1;
  min-width: 0;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.awu-noticeClose {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--awu-r-pill);
  background: transparent;
  color: var(--awu-ink-mute);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-noticeClose:hover { color: var(--awu-ink); background: var(--awu-surface-3); }
.awu-noticeClose:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

/* ---- 自创卡弹层：AI 补全勾选的说明文字 ---- */
.awu-newAiHint {
  display: block;
  margin-top: 2px;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
}

/* ---- 导入弹层：拖到虚线框外时的提示 ---- */
.awu-importDropHint { margin-top: var(--awu-gap-3); font-size: var(--awu-fs-label); color: var(--awu-gold); }

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
  /* 卡面高光改由 ::after 承担（W1-C）：原来是 background-image 的静态径向，
     hover 只能整体提亮、无法跟随指针；挪到伪元素后 opacity 可动画，浅色也能单独压强度。 */
  background-color: var(--awu-glass-2);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  box-shadow: var(--awu-shadow-card), var(--awu-specular);
  transition: border-color var(--awu-dur-2) var(--awu-ease), background-color var(--awu-dur-2) var(--awu-ease),
    box-shadow var(--awu-dur-2) var(--awu-ease), transform var(--awu-dur-2) var(--awu-ease);
  animation: awu-rise var(--awu-dur-4) var(--awu-ease) backwards;
}

/* 顶部高光 + 指针跟随 + 启用态呼吸（契约 §2.3 / §3「环境呼吸」）
   ── 伪元素归属（W2 定案，别改）────────────────────────────────────
   .awu-card::before  → 左栏选中蓝轨（[data-selected="true"] 时才有，W1-C）
   .awu-card::after   → **光层**，一个元素两层背景：
        layer 1 = 顶部高光 / 指针跟随（--awu-mx / --awu-my）
        layer 2 = 启用态金色呼吸（只有 [data-live="true"] 时才给 --awu-live-glow 上色）
   为什么呼吸放在这一层：awu-glow 原来动 box-shadow（不可合成、每帧重绘整卡）。
   现在 box-shadow 是**静态**的（见 [data-live] 那段），呼吸只动这一层的 opacity（合成），
   卡片外观的"外圈金环"由静态 box-shadow 提供，"会呼吸的亮度"由这层提供。
   ⚠️ 别把 box-shadow 再写回动画 —— 那就退回每帧 paint 了。 */
.awu-card::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  /* 半径 240px + 圆心在卡片上方 20%：没有 JS 变量时，这束光正好摊成原来那条"顶部横带"；
     指针进来后 JSX 写 --awu-mx/--awu-my，同一层光就变成跟随的小高光（一个公式两种形态）。
     第二层用 var(--awu-live-glow, transparent)：非启用卡取不到变量 → 整层透明，零视觉影响。 */
  background:
    radial-gradient(240px circle at var(--awu-mx, 50%) var(--awu-my, -20%),
      var(--awu-card-hi) 0%, transparent 62%),
    radial-gradient(120% 96% at 50% -8%,
      var(--awu-live-glow, transparent) 0%, transparent 64%);
  opacity: .85;
  transition: opacity var(--awu-t-base) var(--awu-ease);
}

/* 只在"真指针"设备上跟随：触屏没有 hover，不该为一束不会移动的光多开一层合成 */
@media (hover: hover) and (pointer: fine) {
  .awu-card:hover::after { opacity: 1; }
}

/* 用户从面板级开关关掉高光（契约 §2.1 的 data-fx）：退回旧的静态顶部高光，
   即使 JS 还在写 --awu-mx/--awu-my 也不跟随；同时把呼吸也关掉（静态=不呼吸）。 */
.awu-panel[data-fx="off"] .awu-card::after,
.awu-panel[data-fx="off"] .awu-card[data-live="true"]::after {
  background: radial-gradient(120% 70% at 50% -24%, var(--awu-sheen) 0%, transparent 62%);
  animation: none;
  opacity: 1;
}

/* hover：上浮 2px + 卡面提亮一档 + 阴影加深。刻意不写 background: --awu-glass-3，
   那是灰色叠加层，实测整套变暗（主人原话「鼠标移上去变暗不太好看」）。 */
.awu-card:hover {
  transform: translateY(-2px);
  border-color: var(--awu-line-strong);
  background-color: var(--awu-glass-2-hi);
  box-shadow: var(--awu-shadow-card-hi), var(--awu-specular);
}

/* 按下：回到原位，给一点「压下去」的反馈 */
.awu-card:active { transform: translateY(0); box-shadow: var(--awu-shadow-card), var(--awu-specular); }

.awu-card:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

/* 启用中的卡：角色色描边 + 呼吸（不做渐变填充，保持 iOS 干净）。
   W2 去 paint 化：box-shadow 变成**静态**的一档（原来是 awu-glow 在 18%↔34% 之间每帧重画），
   "呼吸感"移到 ::after 的 opacity（合成属性）。外圈金环由这里的静态阴影负责，
   亮度由 --awu-live-glow 那一层负责 —— 两层分离后，动画不再碰 paint。 */
.awu-card[data-live="true"] {
  --awu-live-glow: color-mix(in srgb, var(--awu-gold) 30%, transparent);
  border-color: color-mix(in srgb, var(--awu-gold) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--awu-gold) 26%, transparent),
    0 10px 30px color-mix(in srgb, var(--awu-gold) 16%, transparent), var(--awu-specular);
}

/* 呼吸：opacity .35↔.85，时长走环境档（3.4s），永不重置。
   hover 时停掉呼吸切到常亮 —— 指针已经在卡上，静态全亮更好读，也避免"鼠标一进就抖"。 */
.awu-card[data-live="true"]::after {
  animation: awu-glow-breathe var(--awu-t-ambient) ease-in-out infinite;
}

@media (hover: hover) and (pointer: fine) {
  .awu-card[data-live="true"]:hover::after { animation: none; opacity: 1; }
}

/* 左栏选中态（契约 §2.1）：静态蓝轨，**不呼吸** —— 与 [data-live] 的金色呼吸分开读。
   为什么用伪元素而不是 box-shadow：awu-glow 动画驱动的就是 box-shadow，
   两者写同一个属性会互相覆盖（选中态会被动画帧盖掉）。伪元素不参与那条动画，
   所以「选中 + 启用」能同时看见：左轨蓝、描边金、外圈金呼吸，三条通道互不打架。 */
.awu-card[data-selected="true"]::before {
  content: "";
  position: absolute;
  left: 0;
  top: 14%;
  bottom: 14%;
  width: 2px;
  border-radius: 0 var(--awu-r-pill) var(--awu-r-pill) 0;
  background: var(--awu-accent);
}

.awu-card[data-selected="true"] { border-color: color-mix(in srgb, var(--awu-accent) 45%, transparent); }

/* 同时选中 + 启用：描边交回金色（"在扮演谁"优先），选中由左轨承担 */
.awu-card[data-selected="true"][data-live="true"] { border-color: color-mix(in srgb, var(--awu-gold) 55%, transparent); }

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
  box-shadow: var(--awu-shadow-glyph);
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
  /* 名字：黑体 600 + 角色金。2026-10-30 试过宋体（SimSun），18px 上笔画发虚、
     和 UI 的实心黑体打架；辨识度改由「金色 + 头像色块」承担，衬线只留日记正文。 */
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: .01em;
  line-height: var(--awu-lh-px-22);
  color: var(--awu-gold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardRole {
  display: block;
  max-width: 100%;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-px-18);
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

/* 卡片里的四行（名字 / 角色 / 摘要 / 页脚）全部用整数 px 行高：
   2026-10-30 主人：「卡片高度差 1-2px，滚动时像三块不同尺寸的砖」。
   根因是 1.25/1.4/1.65 这些比例行高乘 14/18px 会算出 22.5 / 23.1 这种小数，
   不同内容的字面高度再叠一层，卡片就长短不一。锁死行高 + 摘要固定 2 行即可。 */
.awu-cardBlurb {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  color: var(--awu-ink-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: normal;
  overflow-wrap: break-word;
  /* 固定两行高：多一行字也截断，少一行字也留白，卡高由这里定死 */
  height: 46px;
  min-height: 0;
}

.awu-cardFoot {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  min-width: 0;
  min-height: var(--awu-lh-px-22);
  line-height: var(--awu-lh-px-22);
  font-size: var(--awu-fs-caption);
  letter-spacing: 0;
  color: var(--awu-ink-mute);
}

.awu-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--awu-gap-2);
  padding: 1px var(--awu-gap-4);
  border-radius: var(--awu-r-pill);
  border: 1px solid var(--awu-line);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-18);
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
  /* 审查 C2：这枚胶囊原本没有底色（青字直接压在卡片玻璃上），实测深 6.82 / 浅 5.40 是达标的。
     补一层中性底是把"底色"变成确定的，不再受下面垫了几层玻璃影响；青只留描边 + 文字。
     复算（底 = surface-2）：深 6.82:1 / 浅 5.40:1，浅色+中灰壁纸最差 4.59:1 → 达标。
     ⚠️ 别再给它加 12% 青底：那会把青字压回 4.2（本轮修的就是这个构造）。 */
  border-color: color-mix(in srgb, var(--awu-teal) 40%, transparent);
  background: var(--awu-surface-2);
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
  /* 控件高度收敛（W1-C·§2.6）：34/38/40/44 四档合成一档 --awu-ctrl-h(36)。
     38 与 36 差 2px 肉眼几乎无差，但四档并排时（工具行 + hero 动作 + 弹层底部）
     会看出"每排高一点点"的参差。 */
  height: var(--awu-ctrl-h);
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
.awu-btn:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }
.awu-btn:disabled { opacity: .42; cursor: not-allowed; transform: none; }

/* 主操作：唯一的高饱和实心块。阴影加深一档，让它在三个动作里明显最重 */
.awu-btn[data-kind="primary"] {
  border-color: transparent;
  background: var(--awu-accent-strong);
  color: var(--awu-on-accent);
  font-weight: 600;
  box-shadow: 0 3px 12px color-mix(in srgb, var(--awu-accent) 34%, transparent);
}

.awu-btn[data-kind="primary"]:hover {
  filter: brightness(1.08);
  background: var(--awu-accent-strong);
  box-shadow: 0 5px 18px color-mix(in srgb, var(--awu-accent) 42%, transparent);
}

.awu-btn[data-kind="ghost"] { border-color: transparent; background: transparent; color: var(--awu-ink-mute); }
.awu-btn[data-kind="ghost"]:hover { background: var(--awu-surface-3); color: var(--awu-ink); }

/* 危险操作：红描边 + 红字，不填底 —— 和主操作分开，也不在静止态喊叫 */
.awu-btn[data-kind="danger"] {
  border-color: color-mix(in srgb, var(--awu-danger) 40%, transparent);
  background: transparent;
  color: var(--awu-danger);
}
.awu-btn[data-kind="danger"]:hover {
  background: color-mix(in srgb, var(--awu-danger) 14%, transparent);
  border-color: color-mix(in srgb, var(--awu-danger) 55%, transparent);
}

/* 编辑入口：中性档 —— 主人要求「编辑=中性」，所以不给蓝色，用常规描边退到次要层
   （旧版是蓝色描边，和主操作抢注意力）。旧类名 awu-editEntry 保留兼容。 */
.awu-btn[data-kind="edit"],
.awu-editEntry {
  border-color: var(--awu-line-strong);
  background: transparent;
  color: var(--awu-ink-dim);
}
.awu-btn[data-kind="edit"]:hover,
.awu-editEntry:hover {
  background: var(--awu-glass-3);
  border-color: var(--awu-line-strong);
  color: var(--awu-ink);
}

/* md 档：详情页 hero 的动作按钮用它（原 sm 28px 太小）。全局定义，弹层里也能用。
   W1-C：高度并入 --awu-ctrl-h；**字重移出 size 档** —— 原来这里写 font-weight:500，
   会盖掉 [data-kind="primary"] 的 600（同为 (0,2,0)，md 在后），
   于是"主操作最重"在主操作 + md 的组合下失效。size 只管几何，字重归 kind。 */
.awu-btn[data-size="md"] {
  height: var(--awu-ctrl-h);
  padding: 0 var(--awu-gap-6);
  font-size: var(--awu-fs-body);
  border-radius: var(--awu-r-sm);
}

.awu-btn[data-size="sm"] { height: var(--awu-ctrl-h-sm); padding: 0 var(--awu-gap-4); font-size: var(--awu-fs-label); border-radius: var(--awu-r-xs); }
.awu-btn[data-size="block"] { width: 100%; height: var(--awu-ctrl-h); }
.awu-btn[data-size="lg"] { height: var(--awu-ctrl-h); padding: 0 var(--awu-gap-8); font-size: var(--awu-fs-body-lg); font-weight: 600; border-radius: var(--awu-r-md); }

/* ================================================================ 详情页 */
.awu-detail {
  display: flex;
  flex-direction: column;
  /* 分组间距 16→20（W1-C）：详情页现在把"删除"下沉到最底部，一屏里会出现 5~6 个分组，
     16px 会让相邻两组的 kicker 贴到上一组的最后一行上。 */
  gap: var(--awu-gap-8);
  max-width: var(--awu-content-max);
  margin: 0 auto;
  animation: awu-slide-in var(--awu-dur-3) var(--awu-ease);
}

/* 「删除」下沉到详情底部（契约 §2.5）：它现在是 .awu-detail 的直接子元素，
   纵向节奏由上面的 gap 负责，不要再叠自己的 margin-top。 */
.awu-detail > .awu-dangerZone { margin-top: 0; }

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
.awu-navBack:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }
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
  gap: var(--awu-gap-7);
  flex-wrap: wrap;
  padding: var(--awu-gap-7);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background-color: var(--awu-glass-2);
  background-image: radial-gradient(120% 90% at 50% -30%, var(--awu-sheen) 0%, transparent 68%);
  box-shadow: var(--awu-shadow-card), var(--awu-specular);
}

.awu-heroBody { min-width: 0; flex: 1 1 0%; }

.awu-heroName {
  /* 与卡片名一致：黑体 600 + 角色金 */
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-headline);
  font-weight: 600;
  letter-spacing: .01em;
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

/* hero 下方的第二行元信息（关系起点 / 最近互动）。
   JSX 侧数据缺失时整块不渲染；这里再兜一条 :empty，避免空 div 撑出 8px 空隙。 */
.awu-heroMeta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--awu-gap-6);
  margin-top: var(--awu-gap-4);
  font-size: var(--awu-fs-caption);
  line-height: 1.4;
  color: var(--awu-ink-mute);
}

.awu-heroMeta:empty { display: none; }

.awu-heroMetaItem {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  gap: var(--awu-gap-2);
  white-space: nowrap;
}

/* 两项之间一个 3px 圆点，落在 gap 正中，比竖线轻 */
.awu-heroMetaItem + .awu-heroMetaItem::before {
  content: "";
  position: absolute;
  left: calc(var(--awu-gap-6) / -2 - 1.5px);
  top: 50%;
  width: 3px;
  height: 3px;
  margin-top: -1.5px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-ink-faint);
}

/* 值比标签重要：同字号、高一档墨色 + 600 */
.awu-heroMetaItem b {
  font-family: var(--awu-sans);
  font-weight: 600;
  color: var(--awu-ink-dim);
}

/* hero 右侧的动作组。
   W1-C 起收敛成「1 主 + 1 次 + 1 个 ⋯」（契约 §2.5）：原来编辑/启用/删除/绑定四五个平铺，
   宽度一挤就折成两行半，而且四个按钮一样重，看不出主次。
   现在的层级：data-tone="primary"（或 data-kind="primary"）1 个实心主操作、
   data-size="md" 1 个中性次要、.awu-menuBtn 收走其余（导出/改模式/换开场白）。
   2026-10-30 主人原话「编辑/启用/删除 三个按钮太小，而且挨得很近」——间距 6→10px 保留。 */
.awu-heroActions {
  position: relative; /* .awu-menu 的定位锚点 */
  display: flex;
  gap: var(--awu-gap-5);
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  flex: none;
}

/* 选择器要压到 (0,3,0) 才吃得掉 .awu-btn[data-size="md"]，两条同权重时后写的赢 */
.awu-heroActions .awu-btn[data-size="md"] {
  height: var(--awu-ctrl-h);
  padding: 0 var(--awu-gap-8);
  gap: var(--awu-gap-3);
  border-radius: var(--awu-r-sm);
  font-size: var(--awu-fs-body);
  font-weight: 600;
}

/* 窄屏：动作等宽铺满一行，避免「两个半」这种最难看的折法 */
@media (max-width: 900px) {
  .awu-heroActions { justify-content: flex-start; }
  .awu-heroActions .awu-btn[data-size="md"] { flex: 1 1 auto; padding: 0 var(--awu-gap-6); }
}

.awu-heroActions .awu-btn svg { flex: none; }

/* ---- ⋯ 溢出菜单（契约 §2.5）----
   JSX 负责开合、Esc / 点外部关闭、焦点归还给 ⋯ 按钮；CSS 只负责"一个从按钮下方长出来的玻璃托盘"。
   为什么不是原生 <details>/popover：菜单项里有危险项与图标，需要统一键盘顺序与焦点归还，
   交给 JSX 的焦点管理比原生 popover 更好控（而且宿主环境里 popover 的顶层行为会被面板 z-index 干扰）。 */
.awu-menuBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--awu-ctrl-h);
  height: var(--awu-ctrl-h);
  padding: 0;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-3);
  color: var(--awu-ink-mute);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-menuBtn:hover { color: var(--awu-ink); background: var(--awu-glass-3); }
.awu-menuBtn:active { transform: scale(.94); }
.awu-menuBtn:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }
.awu-menuBtn[aria-expanded="true"] { color: var(--awu-ink); border-color: var(--awu-accent); }

.awu-menu {
  position: absolute;
  top: calc(100% + var(--awu-gap-2));
  right: 0;
  z-index: var(--awu-z-inset);
  min-width: 208px;
  padding: var(--awu-gap-2);
  border: 1px solid var(--awu-glass-edge);
  border-radius: var(--awu-r-md);
  background-color: var(--awu-surface-dialog);
  backdrop-filter: var(--awu-blur);
  -webkit-backdrop-filter: var(--awu-blur);
  box-shadow: var(--awu-shadow);
  animation: awu-menu-in var(--awu-t-mid) var(--awu-ease);
}

@keyframes awu-menu-in {
  from { opacity: 0; transform: translateY(-4px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* 菜单项：也接受裸 <button>（JSX 侧可能不写类名，两种都认） */
.awu-menuItem,
.awu-menu > button {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  width: 100%;
  min-height: var(--awu-ctrl-h-sm);
  padding: 0 var(--awu-gap-4);
  border: none;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  font-size: var(--awu-fs-body);
  text-align: left;
  cursor: pointer;
}

.awu-menuItem:hover,
.awu-menu > button:hover { background: var(--awu-surface-3); }
.awu-menuItem:focus-visible,
.awu-menu > button:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }
.awu-menuItem[data-kind="danger"],
.awu-menu > button[data-kind="danger"] { color: var(--awu-danger); }
.awu-menuItem[data-kind="danger"]:hover,
.awu-menu > button[data-kind="danger"]:hover { background: color-mix(in srgb, var(--awu-danger) 14%, transparent); }

.awu-menuSep {
  height: 1px;
  margin: var(--awu-gap-2) var(--awu-gap-3);
  background: var(--awu-line-soft);
}

/* ---- 会话绑定 / 全局启用的边界说明（可见文案，不是 tooltip） ---- */
.awu-bindHints {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-2);
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-left: 2px solid color-mix(in srgb, var(--awu-accent) 55%, transparent);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
}

.awu-bindHint {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-3);
  min-width: 0;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-bindHint b {
  flex: none;
  font-weight: 600;
  color: var(--awu-ink);
}

.awu-bindHint span { min-width: 0; }
.awu-bindHint[data-muted="true"] { color: var(--awu-ink-mute); font-size: var(--awu-fs-caption); }

/* ---- 中性信息行（正则脚本已屏蔽之类：**不是警告**，所以不用警告色） ---- */
.awu-noteRow {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-3);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
}

.awu-noteDot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-ink-faint);
}

/* iOS inset grouped list：圆角分组 + 细分隔线 */
/* 分组卡片：与角色卡同一套玻璃材质（描边 + 顶部高光），否则详情页左边是玻璃、
   右边是「白纸」，两种材质拼在一起就显得简陋。 */
.awu-section {
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background-color: var(--awu-glass-2);
  background-image: radial-gradient(130% 60% at 50% -22%, var(--awu-sheen) 0%, transparent 66%);
  overflow: hidden;
  box-shadow: var(--awu-shadow-card), var(--awu-specular);
}

.awu-sectionHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-5) var(--awu-gap-7) var(--awu-gap-4);
  border-bottom: 1px solid var(--awu-line-soft);
  /* 分节标题 = kicker（W1-C 排版收敛）：12px 大写间距 + 墨色退一档。
     原来 13px/600/ink-dim 与字段值（14px/ink）几乎同重，一屏里出现四五个分组时
     「标题」和「内容」读起来是平的；kicker 化之后标题自动退成"标签"。
     大写对中文不生效（没有大小写），只用它压住拉丁/数字；字距仍给中英混排一点呼吸。 */
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--awu-ink-mute);
}

.awu-sectionHead .awu-count { font-family: var(--awu-sans); font-size: var(--awu-fs-caption); letter-spacing: 0; color: var(--awu-ink-mute); }

.awu-sectionBody { padding: 0 var(--awu-gap-7); }

/* iOS 表单行：左标签 + 右内容，行间发丝，最后一行去掉。
   W1-C：标签 13px/ink-mute、值 14px/500/ink（原来两者都是 14px、只差一档墨，
   "标签与值谁更重要"读不出来）；行高改整数 23px 免得同组行高在 2x 屏上差半像素；
   纵向 10→12px，一个分组 8 行时节奏更松。 */
.awu-field {
  display: grid;
  grid-template-columns: 104px 1fr;
  gap: var(--awu-gap-6);
  padding: var(--awu-gap-6) 0;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  border-bottom: 1px solid var(--awu-line-soft);
}

.awu-field:last-child { border-bottom: none; }
.awu-fieldKey { font-size: var(--awu-fs-label); color: var(--awu-ink-mute); }
.awu-fieldVal { font-size: var(--awu-fs-body); font-weight: 500; color: var(--awu-ink); word-break: break-word; }
.awu-fieldVal b { color: var(--awu-ink); font-weight: 600; }
/* 值的第二层（说明/编号/时间戳）：掉回常规字重与次要墨色，避免整行发黑 */
.awu-fieldVal small,
.awu-fieldVal em { font-weight: 400; font-style: normal; color: var(--awu-ink-mute); }

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
  /* 2026-10-30 深夜改判：日记正文也走黑体。
     理由（?live=1 的真实数据）：14px 宋体在玻璃上笔画太细，和周围的实心黑体不在一个重量级，
     整段时间线看着「发虚」。衬线于是只剩头像里那个字形块。 */
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-px-24);
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
.awu-lineEdit:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }
.awu-lineEdit:hover { background: color-mix(in srgb, var(--awu-accent) 14%, transparent); }

/* ---- 记忆回顾：搜索栏 + 按月折叠（diary-review.tsx） ---- */
.awu-review { display: flex; flex-direction: column; gap: var(--awu-gap-5); }

.awu-reviewBar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--awu-gap-4); }

.awu-reviewInput {
  flex: 1 1 180px;
  min-width: 0;
  height: var(--awu-ctrl-h);
  font-size: var(--awu-fs-body);
}

.awu-reviewHits {
  flex: none;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-reviewMonths { display: flex; flex-direction: column; gap: var(--awu-gap-4); }

.awu-reviewMonth {
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  overflow: hidden;
}

.awu-reviewMonth[data-open="true"] { border-color: var(--awu-line-strong); }

.awu-reviewMonthHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  width: 100%;
  min-height: var(--awu-ctrl-h);
  padding: var(--awu-gap-3) var(--awu-gap-5);
  border: none;
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--awu-dur-2) var(--awu-ease);
}

.awu-reviewMonthHead:hover { background: var(--awu-surface-3); }
.awu-reviewMonthHead:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }
.awu-reviewMonth[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }

.awu-reviewMonthTitle { font-size: var(--awu-fs-body); font-weight: 600; }

.awu-reviewMonthMeta {
  margin-left: auto;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-reviewMonth > .awu-diary {
  padding: var(--awu-gap-4) var(--awu-gap-5) var(--awu-gap-5);
  border-top: 1px solid var(--awu-line);
}

/* ---- 注入预览（preview.tsx） ---- */
.awu-previewSummary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--awu-gap-4);
  margin-bottom: var(--awu-gap-5);
}

.awu-previewStat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
}

.awu-previewStatKey { font-size: var(--awu-fs-micro); color: var(--awu-ink-mute); }

.awu-previewStatVal {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-body);
  color: var(--awu-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awu-previewSegs { display: flex; flex-direction: column; gap: var(--awu-gap-3); }

.awu-previewSeg {
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
  overflow: hidden;
}

.awu-previewSeg[data-open="true"] { border-color: var(--awu-line-strong); }

.awu-previewSegHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  width: 100%;
  min-height: var(--awu-ctrl-h);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--awu-dur-2) var(--awu-ease);
}

.awu-previewSegHead:hover { background: var(--awu-surface-3); }
.awu-previewSegHead:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }
.awu-previewSeg[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }

.awu-previewSegLabel {
  min-width: 0;
  overflow: hidden;
  font-size: var(--awu-fs-body);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awu-previewSegId {
  flex: none;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-previewSegMeta {
  flex: none;
  margin-left: auto;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

/* 注入正文：等宽 + 保留换行；长段内部滚动，别把弹层撑爆 */
.awu-previewText {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border-top: 1px solid var(--awu-line);
  background: var(--awu-surface-field);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.awu-previewEmpty {
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border-top: 1px solid var(--awu-line);
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
}

/* 警示语气的普通提示（预览/日记里那种「不是错误、但要你看一眼」的话） */
.awu-hint[data-tone="warn"] { color: var(--awu-gold); }

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

/* 维护区（危险操作）：2026-10-30 深夜改 —— 整块 8% 红底太吵，像整页报错；
   改成「中性玻璃 + 红描边 + 红标题」，危险感由头部和按钮承担，区块本身不喊叫。 */
.awu-dangerZone {
  margin-top: var(--awu-gap-1);
  border: 1px solid color-mix(in srgb, var(--awu-danger) 20%, transparent);
  border-radius: var(--awu-r-lg);
  background-color: var(--awu-glass-2);
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
  padding: var(--awu-gap-5) var(--awu-gap-7);
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
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  letter-spacing: .01em;
  padding: var(--awu-gap-4) var(--awu-gap-5);
}

/* ================================================================ 空态 / 载入 / 错误 */
/* 2026-10-30 主人：「右栏那个巨大虚线框很空」。改法：
   1) 虚线框整个去掉 —— 它把注意力吸到「一块空地」上；
   2) 空态在栏内垂直居中（.awu-pane > .awu-empty 撑满并居中），不再堆在顶部；
   3) 用一圈极淡的径向柔光代替边框，给「空」一点材质，而不是一个框。 */
.awu-empty {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--awu-gap-5);
  padding: var(--awu-gap-10) var(--awu-gap-8);
  border: none;
  text-align: center;
  /* 柔光直接画在自身背景上：不开伪元素，避免 z-index 层级把光晕压到面板底下 */
  background-image: radial-gradient(52% 38% at 50% 40%,
    color-mix(in srgb, var(--awu-accent) 9%, transparent) 0%, transparent 72%);
}

.awu-pane > .awu-empty {
  box-sizing: border-box;
  min-height: 100%;
}

.awu-emptyMark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  border: 1px solid var(--awu-glass-edge);
  background-color: var(--awu-glass-2);
  background-image: radial-gradient(120% 80% at 50% -20%, var(--awu-sheen) 0%, transparent 64%);
  color: var(--awu-accent-text);
  box-shadow: var(--awu-shadow-card), var(--awu-specular);
}

.awu-emptyTitle {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-title);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--awu-ink);
}

.awu-emptyHint {
  font-size: var(--awu-fs-body-lg);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
  max-width: 360px;
}

/* 第二行说明（JSX 里是好几个 .awu-emptyHint）：降一级字号与墨色，
   让空态读起来是「一句主提示 + 一句补充」，而不是两行同样重的话。 */
.awu-emptyHint + .awu-emptyHint {
  margin-top: calc(var(--awu-gap-3) * -1);
  font-size: var(--awu-fs-body);
  color: var(--awu-ink-mute);
  opacity: .85;
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
  /* 审查 C1（与 .awu-status[data-status="alert"] 是同一个构造的两处）：
     12% 红底 + 红字 → 深 4.17 / 浅 4.33，不达 4.5。改中性底，红只留 1px 描边 + 2px 左轨 + 红字。
     复算（底 = surface-2 叠面板）：深 4.94:1 / 浅 5.38:1 → 达标。 */
  background: var(--awu-surface-2);
  color: var(--awu-danger);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
}

/* 骨架屏：形状与即将出现的布局一致（W1-C 重做，审查 A 报告 P0-10）
   旧版把底色与扫光写死成 rgba(255,255,255,.04/.10)：深色下没问题，浅色下白扫白
   → 对比 1.02:1，"正在加载"这个信号直接读不出来（浅色主题唯一的 P0 可见缺陷）。
   现在拆成两个随主题走的 token：--awu-sk-base（底）与 --awu-sk-sweep（扫光），
   深色 = 亮扫、浅色 = 白扫灰底。
   另一处改动：扫光从 background-position 动画改成伪元素 transform 位移 ——
   background-position 不可合成，4~8 行全宽骨架是每帧 0.3~0.6M px 的重绘。 */
.awu-sk { display: flex; flex-direction: column; gap: var(--awu-gap-5); padding: var(--awu-gap-1) 0; }
.awu-sk[data-shape="cards"] { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--awu-gap-6); padding: 0; }

.awu-skRow {
  position: relative;
  /* 行高统一走 --awu-sk-row-h：默认形态、detail 兜底、rows 形态都用它，
     避免出现两处各写 76px 的"同一件事两个数"（W4 审查点名的重复写死值）。 */
  height: var(--awu-sk-row-h);
  border-radius: var(--awu-r-lg);
  background: var(--awu-sk-base);
  overflow: hidden;
}

.awu-skRow::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 32%, var(--awu-sk-sweep) 50%, transparent 68%);
  transform: translateX(-100%);
  animation: awu-sheen 1.4s linear infinite;
}

.awu-sk[data-shape="cards"] .awu-skRow {
  height: calc(var(--awu-gap-6) * 2 + var(--awu-size-avatar) + var(--awu-gap-4) * 2
    + var(--awu-fs-body) * var(--awu-lh-body) * 2 + var(--awu-fs-caption) * var(--awu-lh-snug));
}

.awu-sk[data-shape="detail"] .awu-skRow:first-child { height: 140px; }

/* 形态兜底（W3 收口 C，可选）：detail 形态的意义是「详情页那种一大两小的竖排」，
   在左栏窄列表里（236~272px）它会变成一块 140px 的空白巨石。
   这里用命名容器兜住：只要骨架落在窄栏里，首行自动退回普通行高。
   注意这是**兜底**不是常规路径 —— 列表态本来就该显式传 shape="cards"。 */
@container awu-list (max-width: 420px) {
  .awu-sk[data-shape="detail"] .awu-skRow:first-child { height: var(--awu-sk-row-h); }
}

/* ---- 形态 rows（W4 新增，配合 JSX 把预设列表/预览加载改成单列）----
   与 cards 的区别：cards 是"卡片墙"（网格、按卡高），rows 是"一列行条目"（预设/世界书列表）。
   行距跟真实列表同源（--awu-gap-6 = 12，和 .awu-grid 的 gap 一致），
   行高 84 = 真实行（56 内容 + 上下 14 内距）向上取整，保证"骨架 → 内容"时高度不跳。 */
.awu-sk[data-shape="rows"] {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-6);
  padding: 0;
}

.awu-sk[data-shape="rows"] .awu-skRow {
  /* 84 = 两个控件高(36×2) + 一行间距(12)：等于真实行"56 内容 + 上下内距"向上取整，
     且完全由令牌算出，不新增裸 px（W4 审查点 8 的要求）。 */
  height: calc(var(--awu-ctrl-h) * 2 + var(--awu-gap-6));
}

/* rows 在左栏窄容器里也是单列 —— 不需要容器查询，本来就是一列。 */
@media (max-width: 900px) {
  .awu-sk[data-shape="rows"] { gap: var(--awu-gap-4); }
}

/* ================================================================ 编辑器（整面板接管） */
.awu-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  /* 铺满面板：头部与底部操作栏是「面板级 chrome」，必须顶到两边；
     表单本体由 .awu-editorBody 的对称 padding 收到 760，读起来仍然是 iPad 设置页那种窄栏。
     旧版把整块编辑器收在 880，导致底栏成了一条悬在面板中间的白色横杠。 */
  width: 100%;
  max-width: none;
  margin: 0;
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
  /* 名字：黑体 600 + 角色色（2026-10-30 起不再用衬线；衬线只剩头像/徽标首字） */
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
  /* 滚动条样式不在这里写：见上方「滚动条」统一段（.awu-pane, .awu-editorBody, .awu-focusBody） */
}

/* ---- 分组：iOS inset grouped list ---- */
.awu-editGroup {
  /* 纵向 flex 容器里的分组不能参与收缩，否则折叠的分组会被压成一条空横条 */
  flex: none;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background-color: var(--awu-glass-2);
  background-image: radial-gradient(140% 70% at 50% -30%, var(--awu-sheen) 0%, transparent 68%);
  overflow: hidden;
  box-shadow: var(--awu-shadow-card), var(--awu-specular);
  transition: background var(--awu-dur-2) var(--awu-ease), box-shadow var(--awu-dur-2) var(--awu-ease);
}

/* 展开态只加强描边，不再叠灰度底 —— 灰底会把「正在编辑的这块」压暗，反而像禁用 */
.awu-editGroup[data-open="true"] { border-color: var(--awu-line-strong); }

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
.awu-editGroupHead:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }

.awu-editGroupChevron {
  flex: none;
  display: inline-flex;
  /* 从 ink-faint 提到 ink-mute（W3 收口）：这个箭头是"这里能展开"的**唯一**视觉线索，
     faint 在深色下只有 1.5:1，不达 WCAG 1.4.11 对非文本 UI 的 3:1。
     世界书的两处（.awu-loreDropped / .awu-loreInfoBlock）也复用这个类，一起受益。 */
  color: var(--awu-ink-mute);
  transition: transform var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease);
}

/* 三处可展开容器的 hover：箭头再提一档（原来只给 .awu-editGroup 写了） */
.awu-editGroup:hover .awu-editGroupChevron,
.awu-loreDroppedHead:hover .awu-editGroupChevron,
.awu-loreInfoBlock .awu-btn:hover .awu-editGroupChevron { color: var(--awu-ink-dim); }

/* 展开 = 头部自己的箭头转 90°。
   必须是「.awu-editGroupHead 内部」限定：写成纯后代选择器时，世界书分区一展开，
   里面嵌套的 .awu-loreDropped / .awu-loreInfoBlock 的箭头也会跟着转
   （reviewer 实测：子块 data-open="false" 时 transform 仍是 rotate90）。 */
.awu-editGroup[data-open="true"] > .awu-editGroupHead .awu-editGroupChevron { transform: rotate(90deg); }

/* 兜底：嵌套块的箭头只认自己的展开态。
   用 :not([data-open="true"]) 而不是 [data-open="false"] —— .awu-loreInfoBlock 关闭时
   JSX 是**移掉属性**（data-open 为 undefined），写 ="false" 永远匹配不到。 */
.awu-loreDropped:not([data-open="true"]) .awu-editGroupChevron,
.awu-loreInfoBlock:not([data-open="true"]) .awu-editGroupChevron { transform: none; }

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
  /* 展开动画不再写在这里：四套折叠（编辑分组 / 世界书条目 / 日记月 / 预览段）统一由
     文件末尾「折叠编排」段的一条规则驱动（展开 T_BASE / 收起 T_EXIT），改一处四套同时生效。 */
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
  height: var(--awu-ctrl-h);
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
  min-height: var(--awu-ctrl-h);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  resize: vertical;
}

.awu-editListRemove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--awu-size-hit);
  height: var(--awu-ctrl-h);
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
.awu-editListRemove:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

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
.awu-editAdd:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

/* ---- 底部固定条 ---- */
.awu-editorFoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gutter) var(--awu-gap-5);
  border-top: 1px solid var(--awu-line);
  /* 底栏要「站」在面板上：玻璃底 + 30px 模糊（小面积，允许强模糊） */
  background-color: var(--awu-glass-2);
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
  backdrop-filter: var(--awu-blur-sm);
  -webkit-backdrop-filter: var(--awu-blur-sm);
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
/* W2：遮罩层的 6px 全屏模糊已删除（D 报告「最划算的一刀」）。
   理由：它盖住的是整块 1.3M px 的视口，每帧都要为"下面那一整屏"做一次模糊采样；
   而 scrim 自己已经有 --awu-scrim-bg 的压暗层，去掉模糊后"能不能看清弹层"没有任何变化，
   省的是一条全屏滤镜通道。视觉上唯一的差别是背景里的字不再糊 —— 实测更接近 iOS 的做法。 */
.awu-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--awu-z-scrim);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: var(--awu-gap-6);
  background: var(--awu-scrim-bg);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-dialog {
  position: relative;
  /* 表单弹层宽度：620（令牌 --awu-dialog-w）。760 宽下三个输入框会被拉成两条长杠，
     iOS sheet 的呼吸感就没了；蒸馏弹层同样吃这一档，不再自带 420/760 的兜底值。 */
  width: min(var(--awu-dialog-w), 100%);
  max-height: min(84vh, var(--awu-dialog-max-h));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--awu-glass-edge);
  /* 托盘圆角统一走 --awu-radius-sheet（契约 §2.6）：所有 sheet 一个值。
     蒸馏弹层已改为继承本规则（它自己那条 16px 圆角在 W3 删掉了），所以不再需要桥接选择器。 */
  border-radius: var(--awu-radius-sheet);
  background-color: var(--awu-surface-dialog);
  /* 顶部 sheen 加强到 78%：.86→.72 之后弹层更透，没有顶部高光会读成"一块灰膜" */
  background-image: radial-gradient(130% 78% at 50% -22%, var(--awu-sheen) 0%, transparent 66%);
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

.awu-dialogBody { padding: var(--awu-gap-6) var(--awu-gap-8) var(--awu-gap-5); overflow-y: auto; }

/* 弹层内不要再吃一次 gutter（W1-C，E 报告视觉漂移 #3）：
   .awu-err / .awu-status 自带 margin: 0 var(--awu-gutter)，那是为"贴在面板全宽上"设计的；
   进 .awu-dialogBody（自身已有 20px padding）后 → 实际缩进 32+20=52px，比同级正文多出 32px。
   只归零左右，上下 margin 保留（纵向节奏还是它们自己的）。
   ⚠️ 这两个类在弹层里的调用点：preview.tsx / preset-view.tsx 共 5 处。 */
.awu-dialogBody > .awu-err,
.awu-dialogBody > .awu-status {
  margin-left: 0;
  margin-right: 0;
}

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
  /* 输入框高度并入 --awu-ctrl-h（原 42）：与同一行里的按钮等高，行内不再错位 */
  height: var(--awu-ctrl-h);
  padding: 0 var(--awu-gap-5);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-md);
  /* 输入框必须比面板「实」：玻璃面板透气，字段底也半透明的话，
     壁纸色会从字缝里钻上来，读不清（编辑器里实测最明显）。 */
  background-color: var(--awu-glass-2);
  background-image: radial-gradient(140% 120% at 50% -40%, var(--awu-sheen) 0%, transparent 70%);
  color: var(--awu-ink);
  font: inherit;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-control);
  letter-spacing: 0;
  outline: none;
  box-shadow: var(--awu-specular);
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
/* W2：原来用 --awu-surface（面板底）+ 30px 强模糊盖住整块面板（约 1.0M px），
   违反本文件自己在变量层写的「大面积用轻 blur、强模糊只给小面积」。
   改成弹层级实底（.86/.90）+ --awu-blur-panel（20px）：一层更实、一层更轻，
   专注层本来就该"把下面按住"，用底色而不是用模糊来做到。 */
.awu-focus {
  position: absolute;
  inset: 0;
  z-index: var(--awu-z-inset);
  display: flex;
  flex-direction: column;
  border-radius: var(--awu-r-xl);
  background: var(--awu-surface-dialog);
  backdrop-filter: var(--awu-blur-panel);
  -webkit-backdrop-filter: var(--awu-blur-panel);
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
  font-size: var(--awu-fs-control);
  line-height: var(--awu-lh-loose);
  letter-spacing: .01em;
}

.awu-focusInput::placeholder { color: var(--awu-ink-mute); }

.awu-focusRead {
  font-size: var(--awu-fs-control);
  line-height: var(--awu-lh-loose);
  color: var(--awu-ink-dim);
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
}

.awu-focusRead:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); border-radius: var(--awu-r-xs); }

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

/* ================================================================ 预留模块（已清理，2026-11-02）
   原来这里挂着「世界书两栏 / 词条 chips / CCv3 原生字段 / 编辑器分段」四组样式，
   合计 21 个类、约 171 行，在 client/ 全目录（含 tsx）里引用数为 0 —— 组件从未接线。
   审查 F9 判定为死代码，本轮全部删除（git 历史里还在，接线时按需取回）：
     .awu-loreSplit / .awu-lorePane / .awu-loreDetail
     .awu-editorTabs / .awu-editorTab
     .awu-budgetTag / .awu-levelTag / .awu-fieldCount
     .awu-chips / .awu-chip / .awu-chipX / .awu-chipInput
     .awu-nativeField / .awu-jsonView / .awu-stack
     .awu-modeOption / .awu-modeOptionRow / .awu-modeOptionText / .awu-modeLabel / .awu-modeHint
   接线时的正确做法：在世界书/预设组件落地的那一批里**新写**，并要求那一批同时把类名登记进本文件顶部注释，
   而不是靠"先囤一套皮肤等组件"。死 CSS 的代价是它会随令牌改动漂移（比如这批刚改的 radius/line-soft），
   等真接线时反而要重写一遍。 */

/* 世界书列表（这部分是活的：lorebook-editor.tsx 在用） */
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

/* ---- 世界书条目（lorebook-editor.tsx 落地后补的细节层；容器仍是 .awu-loreRow） ---- */
.awu-loreEntry {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-2);
  box-shadow: var(--awu-specular);
  overflow: hidden;
}

.awu-loreEntry[data-open="true"] { border-color: var(--awu-line-strong); }
.awu-loreEntry[data-issue="true"] { box-shadow: inset 2px 0 0 var(--awu-danger), var(--awu-specular); }
/* 条目自带描边后，行本身不再重复画底与投影 */
.awu-loreEntry .awu-loreRow { border-radius: 0; background: transparent; box-shadow: none; }
.awu-loreEntry .awu-loreRow:hover { background: var(--awu-surface-3); }

.awu-loreRowMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--awu-gap-1);
  padding: var(--awu-gap-2) 0;
  border: none;
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.awu-loreRowMain:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); border-radius: var(--awu-r-xs); }

.awu-loreRowTitleWrap { display: flex; align-items: center; gap: var(--awu-gap-3); max-width: 100%; min-width: 0; }

.awu-loreRowTitle {
  min-width: 0;
  max-width: 100%;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-body);
  font-weight: 600;
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-loreRowMeta {
  max-width: 100%;
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-loreRowFlag {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: var(--awu-r-pill);
  background: color-mix(in srgb, var(--awu-danger) 22%, transparent);
  color: var(--awu-danger);
  font-size: var(--awu-fs-micro);
  font-weight: 700;
  /* 用 flex 居中代替 line-height: 15px（那是个只为"把 ! 垂直居中"而存在的裸 px，
     token 化没有意义；flex 居中在任何字号下都对） */
}

/* 徽记按等级换色：error 红 / warn 金 / info 灰点（真卡的规模提示不该抢眼） */
.awu-loreRowFlag[data-level="warn"] { background: color-mix(in srgb, var(--awu-gold) 22%, transparent); color: var(--awu-gold); }
.awu-loreRowFlag[data-level="info"] { background: var(--awu-surface-3); color: var(--awu-ink-mute); }

.awu-loreRowActions { flex: none; display: inline-flex; align-items: center; gap: var(--awu-gap-1); }

.awu-loreRowSwitch { display: inline-flex; align-items: center; padding: 0 var(--awu-gap-2); cursor: pointer; }
.awu-loreRowSwitch input { accent-color: var(--awu-accent); cursor: pointer; }

.awu-loreRowBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--awu-r-xs);
  background: transparent;
  color: var(--awu-ink-mute);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-loreRowBtn:hover { color: var(--awu-ink); background: var(--awu-surface-3); }
.awu-loreRowBtn:disabled { opacity: .32; cursor: default; background: transparent; }
.awu-loreRowBtn:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

.awu-loreGrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--awu-gap-5); }

.awu-loreFold {
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-field);
}

.awu-loreFold > summary {
  list-style: none;
  padding: var(--awu-gap-3) var(--awu-gap-5);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  color: var(--awu-ink-mute);
  cursor: pointer;
}

.awu-loreFold > summary::-webkit-details-marker { display: none; }
.awu-loreFold > summary:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }
.awu-loreFold[open] > summary { border-bottom: 1px solid var(--awu-line); color: var(--awu-ink); }
.awu-loreFold > .awu-loreAdv { padding: var(--awu-gap-4) var(--awu-gap-5) var(--awu-gap-5); }

.awu-loreFullscreen {
  margin-left: auto;
  min-height: 24px;
  padding: 0 var(--awu-gap-4);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-pill);
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: var(--awu-fs-micro);
  cursor: pointer;
  transition: color var(--awu-dur-2) var(--awu-ease), border-color var(--awu-dur-2) var(--awu-ease);
}

.awu-loreFullscreen:hover { color: var(--awu-accent-text); border-color: var(--awu-accent); }
.awu-loreFullscreen:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

.awu-loreHealth { display: flex; flex-wrap: wrap; align-items: center; gap: var(--awu-gap-4); }

/* 一行总览：条数 · 字数 · 常驻 · 预算 */
.awu-loreSummary {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-mute);
  word-break: break-word;
}

/* 提示级问题的展开/收起容器 */
.awu-loreInfoBlock { display: flex; flex-direction: column; gap: var(--awu-gap-3); align-items: flex-start; }

/* 问题行前的等级徽记（错误/提醒/提示） */
.awu-loreIssueLevel {
  flex: none;
  margin-right: var(--awu-gap-2);
  font-style: normal;
  font-size: var(--awu-fs-micro);
  font-weight: 600;
  padding: 0 var(--awu-gap-2);
  border-radius: var(--awu-r-xs);
  background: var(--awu-surface-3);
  color: var(--awu-ink-mute);
}

.awu-loreIssueList li[data-level="error"] .awu-loreIssueLevel { color: var(--awu-danger); background: color-mix(in srgb, var(--awu-danger) 14%, transparent); }
.awu-loreIssueList li[data-level="warn"] .awu-loreIssueLevel { color: var(--awu-gold); background: color-mix(in srgb, var(--awu-gold) 14%, transparent); }
.awu-loreIssueList li[data-level="error"] { color: var(--awu-ink-dim); }
.awu-loreIssueList li[data-level="info"] { color: var(--awu-ink-mute); }

/* 「被预算裁掉」的警示块（可折叠） */
.awu-loreDropped {
  border: 1px solid color-mix(in srgb, var(--awu-gold) 40%, transparent);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-gold) 10%, transparent);
  overflow: hidden;
}

.awu-loreDroppedHead {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-3);
  width: 100%;
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: none;
  background: transparent;
  color: var(--awu-gold);
  font: inherit;
  font-size: var(--awu-fs-label);
  text-align: left;
  cursor: pointer;
}

.awu-loreDroppedHead:hover { background: color-mix(in srgb, var(--awu-gold) 12%, transparent); }
.awu-loreDroppedHead:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset-inset); }
.awu-loreDropped[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }
/* 世界书「体检说明」那块（lorebook-editor 的信息折叠）：与上面四套折叠同一个箭头语言。
   有了这条，JSX 侧就不必再给 IconChevron 写内联 transform（那份内联是过渡缺失时期的补丁）。 */
.awu-loreInfoBlock[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }

.awu-loreDroppedTitle { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.awu-loreDroppedMeta {
  margin-left: auto;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-loreDroppedList {
  margin: 0;
  padding: var(--awu-gap-2) var(--awu-gap-4) var(--awu-gap-4);
  border-top: 1px solid color-mix(in srgb, var(--awu-gold) 26%, transparent);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-2);
  max-height: 220px;
  overflow-y: auto;
}

.awu-loreDroppedList li { display: flex; align-items: baseline; gap: var(--awu-gap-3); font-size: var(--awu-fs-label); color: var(--awu-ink-dim); }
.awu-loreDroppedName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.awu-loreDroppedOrigin { flex: none; font-size: var(--awu-fs-micro); color: var(--awu-ink-mute); }
.awu-loreDroppedChars { flex: none; margin-left: auto; font-family: var(--awu-mono); font-size: var(--awu-fs-micro); color: var(--awu-ink-mute); }

/* 条目行/折叠卡的等级暗示：错误红、提醒金、提示不描边（只靠行内小点） */
.awu-loreRow[data-level="error"] { box-shadow: inset 2px 0 0 var(--awu-danger), var(--awu-specular); }
.awu-loreRow[data-level="warn"] { box-shadow: inset 2px 0 0 var(--awu-gold), var(--awu-specular); }
.awu-loreEntry[data-level="error"] { box-shadow: inset 2px 0 0 var(--awu-danger), var(--awu-specular); }
.awu-loreEntry[data-level="warn"] { box-shadow: inset 2px 0 0 var(--awu-gold), var(--awu-specular); }

.awu-loreDirtyDot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: var(--awu-r-pill);
  background: var(--awu-accent-text);
}

.awu-loreEmpty { display: flex; flex-direction: column; gap: var(--awu-gap-4); padding: var(--awu-gap-3) 0; }

.awu-loreEntryIssues,
.awu-loreIssueList {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-2);
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-loreEntryIssues { color: var(--awu-ink-dim); }
.awu-loreEntryIssues li[data-level="error"] { color: var(--awu-danger); }
.awu-loreEntryIssues li[data-level="warn"] { color: var(--awu-gold); }
.awu-loreEntryIssues li[data-level="info"] { color: var(--awu-ink-mute); }
.awu-loreIssueList b { color: var(--awu-ink); font-weight: 600; }

/* ---- 预设面板（preset-view.tsx） ----
   预设 = 一组「怎么说」的提示词模块，与角色卡正交；这里只负责列表/编辑/导入的排版。 */
.awu-presetRow {
  width: 100%;
  border: none;
  font: inherit;
  color: var(--awu-ink);
  text-align: left;
}

.awu-presetMeta {
  flex: none;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

/* 两态启用区：按钮 + 常显的边界提示（与角色绑定同一套措辞与排版） */
.awu-presetUse {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-3);
  margin: var(--awu-gap-5) 0 var(--awu-gap-4);
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-left: 2px solid color-mix(in srgb, var(--awu-accent) 55%, transparent);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
}

.awu-presetUseBtns { display: flex; flex-wrap: wrap; gap: var(--awu-gap-3); }
/* 预设体积：列表行「约 N 字符」+ 编辑页「启用后约 M 字符/轮」；超参考线转警示色并挂「重」 */
.awu-presetChars { white-space: nowrap; }
.awu-presetChars[data-heavy="true"] { color: var(--awu-gold); }

.awu-presetHeavy {
  margin-left: var(--awu-gap-2);
  padding: 0 var(--awu-gap-2);
  border-radius: var(--awu-r-xs);
  background: color-mix(in srgb, var(--awu-gold) 18%, transparent);
  color: var(--awu-gold);
  font-style: normal;
  font-size: var(--awu-fs-micro);
  font-weight: 600;
}

.awu-presetWeight {
  margin-top: var(--awu-gap-3);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
}

.awu-presetWeight[data-heavy="true"] { color: var(--awu-gold); }

/* 启用前的重量确认：**内联一行**（不是全屏弹层），问完就地给两个按钮 */
.awu-presetHeavyConfirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--awu-gap-3);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 45%, transparent);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-gold) 10%, transparent);
  animation: awu-fade var(--awu-dur-2) var(--awu-ease);
}

.awu-presetHeavyText {
  flex: 1 1 220px;
  min-width: 0;
  font-size: var(--awu-fs-label);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-presetHeavyActions { display: flex; gap: var(--awu-gap-3); margin-left: auto; }

/* 列表行允许换行：加体积后一行放不下（rail 只有 340px） */
.awu-presetRow { flex-wrap: wrap; row-gap: var(--awu-gap-2); }
.awu-presetRow .awu-presetMeta { flex: 1 1 100%; white-space: normal; }


/* 模块列表 */
.awu-presetModules { display: flex; flex-direction: column; gap: var(--awu-gap-4); }

.awu-presetModule {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-3);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
}

.awu-presetModule[data-enabled="false"] { opacity: .62; }

.awu-presetModuleHead { display: flex; align-items: center; flex-wrap: wrap; gap: var(--awu-gap-3); }

.awu-presetModuleName {
  flex: 1 1 140px;
  min-width: 0;
  height: 32px;
  font-size: var(--awu-fs-body);
}

.awu-presetModuleChars {
  flex: none;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

/* 正文摘要：点一下进全屏编辑（长文本不塞进这个小框） */
.awu-presetModuleBody {
  width: 100%;
  min-height: var(--awu-ctrl-h);
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-xs);
  background: var(--awu-surface-field);
  color: var(--awu-ink-dim);
  font: inherit;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  text-align: left;
  cursor: text;
  overflow-wrap: anywhere;
  transition: border-color var(--awu-dur-2) var(--awu-ease), color var(--awu-dur-2) var(--awu-ease);
}

.awu-presetModuleBody:hover { border-color: var(--awu-accent); color: var(--awu-ink); }
.awu-presetModuleBody:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); }

/* 导入：JSON 输入区 + 预览列表 */
.awu-presetJson {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-snug);
  min-height: 120px;
}

.awu-presetImportBar {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  margin-top: var(--awu-gap-3);
}

.awu-presetPreview { display: flex; flex-direction: column; gap: var(--awu-gap-3); }

/* 「被丢弃」的分组摘要：一行胶囊（只列非零项），不让用户去数 11 行 */
.awu-presetDropSummary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--awu-gap-2);
  margin-top: var(--awu-gap-2);
}
.awu-presetPreviewStat {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
}

.awu-presetPreviewList {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-2);
  max-height: 260px;
  overflow-y: auto;
}

.awu-presetPreviewList li {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-3);
  padding: var(--awu-gap-2) var(--awu-gap-3);
  border-radius: var(--awu-r-xs);
  background: var(--awu-surface-2);
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-dim);
}

.awu-presetPreviewList li[data-enabled="false"] { opacity: .6; }

.awu-presetPreviewName { flex: none; font-weight: 600; color: var(--awu-ink); white-space: nowrap; }

.awu-presetPreviewExcerpt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--awu-ink-mute);
}

/* ---- 导入角色卡弹层（index.tsx 的 ImportDialog） ---- */
.awu-importDrop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--awu-gap-5);
  padding: var(--awu-gap-9) var(--awu-gap-6);
  border: 1.5px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  background: var(--awu-surface-field);
  color: var(--awu-ink-mute);
  text-align: center;
  transition: border-color var(--awu-dur-2) var(--awu-ease), background var(--awu-dur-2) var(--awu-ease);
}

.awu-importDrop[data-busy="true"] { opacity: .6; }
.awu-importDropTitle { font-size: var(--awu-fs-body-lg); color: var(--awu-ink-dim); line-height: var(--awu-lh-body); }

/* 原生 file input：**不藏起来**（键盘用户要能 Tab 到它并回车打开选择框），只把字号收小 */
.awu-importNative {
  width: 100%;
  max-width: 420px;
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
}

.awu-importNative:focus-visible { outline: 2px solid var(--awu-focus-ring); outline-offset: var(--awu-focus-offset); border-radius: var(--awu-r-xs); }

.awu-importView { display: flex; flex-direction: column; gap: var(--awu-gap-5); }

.awu-importFileRow { display: flex; align-items: baseline; gap: var(--awu-gap-3); min-width: 0; }
.awu-importFileLabel { flex: none; font-size: var(--awu-fs-label); font-weight: 600; color: var(--awu-ink-mute); }
.awu-importFileSize { flex: none; margin-left: auto; font-family: var(--awu-mono); font-size: var(--awu-fs-micro); color: var(--awu-ink-mute); }

.awu-importMeta {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-1);
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface-2);
}

.awu-importConflict {
  display: flex;
  align-items: flex-start;
  gap: var(--awu-gap-3);
  padding: var(--awu-gap-4) var(--awu-gap-5);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 40%, transparent);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-gold) 10%, transparent);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-importConflict[data-confirm="true"] {
  border-color: color-mix(in srgb, var(--awu-danger) 50%, transparent);
  background: color-mix(in srgb, var(--awu-danger) 12%, transparent);
}

.awu-importConflict b { color: var(--awu-ink); font-weight: 600; }

.awu-importWarnHead { font-size: var(--awu-fs-label); font-weight: 600; color: var(--awu-ink-mute); }

/* 警告分组：解析 / 世界书 / 不支持的酒馆特性 —— 警示色标题，正文保持中性 */
.awu-importWarnGroups { display: flex; flex-direction: column; gap: var(--awu-gap-4); }

.awu-importWarnGroup {
  padding: var(--awu-gap-3) var(--awu-gap-4);
  border: 1px solid color-mix(in srgb, var(--awu-gold) 30%, transparent);
  border-radius: var(--awu-r-md);
  background: color-mix(in srgb, var(--awu-gold) 7%, transparent);
}

.awu-importWarnGroupTitle {
  margin-bottom: var(--awu-gap-2);
  font-size: var(--awu-fs-label);
  font-weight: 600;
  color: var(--awu-gold);
}

.awu-importWarnMore {
  margin-top: var(--awu-gap-2);
  font-size: var(--awu-fs-label);
  color: var(--awu-ink-mute);
}

.awu-importWarns {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-2);
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-body);
  color: var(--awu-ink-dim);
}

.awu-issueList { display: flex; flex-direction: column; gap: var(--awu-gap-3); }

.awu-path {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-snug);
  color: var(--awu-ink-mute);
  word-break: break-all;
}

/* ================================================================ 跨批过渡：使用指南排版（第 3 批收回）
   这里的规则本该写在 guide.styles.ts（那是第 3 批的写域，本轮不动），但排版是第 1 批的验收项，
   所以先用 (0,2,0) 的选择器在本文件末尾压过去，等第 3 批把 guide 的 12/13/14 三档换成令牌后整段删除。
   目标（契约 §E）：阅读宽 760 居中、正文 14/23。 */
.awu-guide { max-width: var(--awu-content-max); margin: 0 auto; }
.awu-guide .awu-guide-line,
.awu-guide .awu-guide-text,
.awu-guide .awu-guide-key,
.awu-guide .awu-guide-a,
.awu-guide .awu-guide-q { font-size: var(--awu-fs-body); line-height: var(--awu-lh-px-23); }
.awu-guide .awu-guide-note,
.awu-guide .awu-guide-pathLine,
.awu-guide .awu-guide-pathHint { font-size: var(--awu-fs-label); line-height: var(--awu-lh-px-20); }
.awu-guide .awu-guide-h { font-size: var(--awu-fs-caption); }

/* 空态的第二行说明（.awu-emptySub 在 index.tsx 里用了很久，但一直没规则 → 掉回继承的 14px/ink）。
   这里补一条：比主提示低一档字号与墨色，和 .awu-emptyHint + .awu-emptyHint 的层级保持同一种读法。 */
.awu-emptySub {
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-mute);
  max-width: 360px;
}

/* 空态的 data-kind 之前是「白挂」（JSX 写了 9 处，CSS 一处没认）：这里给徽标上色，
   让「出错了 / 还没有日记 / 还没选人」三种空态在扫视时能分开。
   diary 用角色金、error 用红、pick/empty 沿用系统蓝。 */
.awu-empty[data-kind="diary"] .awu-emptyMark { color: var(--awu-gold); }
.awu-empty[data-kind="error"] .awu-emptyMark {
  color: var(--awu-danger);
  border-color: color-mix(in srgb, var(--awu-danger) 40%, transparent);
}
.awu-empty[data-kind="pick"] .awu-emptyMark { color: var(--awu-accent-text); }

/* ================================================================ 字体归属（最后统一裁决）
   **事实（2026-11-02 校正）**：衬线现在只剩两处字形块 —— .awu-mark 与 .awu-avatar 的姓名首字。
   角色名（.awu-cardName / .awu-heroName / .awu-sigilName / .awu-editorName）与日记正文（.awu-line）
   已在 2026-10-30 的「辨认困难」修复里改成黑体，各自规则内就写着 --awu-sans。
   下面这张表是把"输入类控件"统一压成黑体的兜底：它们原先各自写了 --awu-serif，
   被本段覆盖后那 7 条声明就是死声明 —— 本轮已把源头的 font-family 一并删掉（只留这张表做兜底）。
   ⚠️ 不要再照旧注释去"恢复角色名衬线"：会改完没反应（本段在文件末尾，同权重靠顺序赢）。 */
.awu-textarea,
.awu-editArea,
.awu-editListText,
.awu-editorName,
.awu-previewName,
.awu-focusInput,
.awu-focusRead { font-family: var(--awu-sans); }

/* ================================================================ 动效 */
/* 面板进场（2026-11-02 三次修订）：跑在外壳 .awu-panelFade 上，玻璃本身不动。
   见上方 .awu-panelFade 段的三段演进说明 —— 这里只留 keyframes，不要再把 animation
   加回 .awu-panel（那会把「动画期换模糊」的硬切重新引回来）。 */
/* ================================================================ 动效 */
/* 面板进场（2026-11-02 四次修订）：跑在面板**内部的内容层**上，玻璃框完全不动。
   见 .awu-panelFade 段的四条演进 —— 结论是「含 backdrop-filter 的元素及其祖先都不能动
   opacity/transform」，所以放大上浮只能落在内容上。 */
@keyframes awu-content-in {
  from { opacity: 0; scale: .98; transform: translateY(6px); }
  to { opacity: 1; scale: 1; transform: translateY(0); }
}

/* 全屏压暗淡入（外壳伪元素，见 .awu-panelFade::before）。纯色层，只动 opacity。 */
@keyframes awu-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 面板退场（2026-11-02 五次修订）：**玻璃框依然不动**，只有内容层淡出 + 外壳压暗淡出。
   为什么不能给 .awu-panel 挂动画：它是含 backdrop-filter 的元素，任何 animation/will-change
   都会把它提升成独立渲染表面 → 背板采样退化（主人看到的「彻底半透明」就是这个）；
   而且退场那 160ms 里玻璃会重新采样，反而更卡。
   所以分工是：玻璃原地不动 → 内容（head/status/workspace）淡出 → 外壳 ::before 的压暗淡出
   → usePresence 到点把整棵树摘掉。 */
@keyframes awu-content-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-2px); }
}

@keyframes awu-scrim-out {
  from { opacity: 1; }
  to { opacity: 0; }
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

/* 启用态呼吸（W2）：只动 opacity。
   旧版 awu-glow 动的是两个 box-shadow（0 0 0 1px / 0 10px 30px），box-shadow 不可合成、
   每帧都要重画整张卡（含圆角与渐变），一个"启用中"的卡就是常年 10%~15% 的 paint。
   现在外圈金环是静态 box-shadow，呼吸落在 .awu-card::after 的 opacity 上（合成，零 paint）。 */
@keyframes awu-glow-breathe {
  0%, 100% { opacity: .35; }
  50% { opacity: .85; }
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

/* 横向扫过（W2）：替代原来动 background-position 的两条循环动画。
   用在"忙碌进度条"（45% 宽的光块）上，位移是合成属性。
   骨架屏早前已改成 .awu-skRow::after + awu-sheen，这里不再需要 shimmer。 */
@keyframes awu-sweep-x {
  from { transform: translateX(-100%); }
  to { transform: translateX(223%); }
}

@keyframes awu-spin { to { transform: rotate(360deg); } }

/* tab 切换 crossfade（契约 §3）：120ms、只 opacity、不带位移、不带 stagger。
   挂在 .awu-mainBody > *（见该规则处的注释）与显式 [data-view-state="enter"] 上。 */
@keyframes awu-view-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 折叠展开/收起（契约 §3：展开 T_BASE / 收起 T_EXIT，四套折叠共用）。
   只动 opacity：高度动画会触发布局（reflow），在 340px 列表里尤其明显；
   折叠体的高度本来就是"瞬间到位"，让内容淡进来比整块长出来更安静。
   收起那条要配合 JSX 在折叠体上挂 presence，否则 React 卸载时元素已经没了。 */
@keyframes awu-fold-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes awu-fold-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* ---- 折叠编排（契约 §3：展开 T_BASE / 收起 T_EXIT）----
   四套折叠体共用这一条，别再给单个组件写 animation：
     1) 卡编辑器分组  .awu-editGroupBody
     2) 世界书条目    .awu-loreBody
     3) 日记按月      .awu-reviewMonth > .awu-diary
     4) 注入预览分段  .awu-previewText / .awu-previewEmpty
   收起那条在退场段（.awu-*[data-state="closing"]），前提是 JSX 用 usePresence 留 160ms。 */
.awu-editGroupBody,
.awu-loreBody,
.awu-reviewMonth > .awu-diary,
.awu-previewText,
.awu-previewEmpty {
  animation: awu-fold-in var(--awu-t-base) var(--awu-ease-out) backwards;
}

/* ---- 提示条编排（契约 §3：notice 进场 / 退场）----
   进场用 awu-rise（T_BASE，8px 上浮）；退场用 awu-exit-rise（T_EXIT）。
   .awu-notice 是契约里的新类名；同时兜住还没有这个类的旧写法
   （提示条当前是 .awu-status[data-status="info"|"warn"]，验收前的面板就是它）。 */
.awu-notice,
.awu-status[data-status="info"],
.awu-status[data-status="warn"] {
  animation: awu-rise var(--awu-t-base) var(--awu-ease) backwards;
}

/* ---- 视图编排（契约 §3：tab 切换 T_FAST crossfade，不带位移、不带 stagger）----
   语义澄清（W2，与 index.tsx owner 对表过）：这是 **animation，不是 transition**。
   animation 在元素**入 DOM** 时自动播一次，所以最稳的用法是上面那条零依赖的
   「.awu-mainBody > *」（挂在 ~700 行，靠顺序输给各视图自己的动画）。
   曾经还有一条「容器显式声明」的写法（.awu-mainBody[data-view-state="enter"]），
   JSX 侧已整段删除（他们的注释也写了：animation 路线上"下一帧摘属性"会把动画一起摘掉，
   淡入被截断 = 等于没做）。第 3 批（2026-11-02）CSS 侧同步删掉，不留下无人写入的钩子。
   awu-view-in 的唯一引用就是 .awu-mainBody > * 那条，别一起删。 */

/* ---- 骨架退场（JSX 用 data-state="closing" 标 160ms 再卸载）----
   骨架是"加载中"的替身，淡出比硬消失少一次闪；只动 opacity。
   ⚠️ 必须同时脱离文档流，否则"骨架 + 内容"上下并存 160ms 像页面抖了一下。
   水平方向用 inset-inline: var(--awu-pane-pad-x) 而不是 0：
   absolute 的 left/right 是从**padding box** 量的，写 0 会得到 336px（=内容 272 + 两侧 32 的 padding），
   再因为 left 贴到 padding 外沿而整体左移 32px —— 实测的"宽度跳变 272→336"就是这个。
   垂直方向保持 auto：元素停在自己的静态位置（与淡出前同一处），不跳。
   宽度与容器内容宽严格相等，所以不会产生横向滚动。 */
.awu-sk[data-state="closing"] {
  position: absolute;
  inset-inline: var(--awu-pane-pad-x);
  animation: awu-exit var(--awu-t-exit) var(--awu-ease-out) both;
  pointer-events: none;
}

/* ---- 提示条退场（.awu-status 系）----
   注意别和进场撞车：进场是按 [data-status="info"|"warn"] 命中的 awu-rise，
   这里按 [data-state="closing"] 命中，两条同权重 (0,2,0)，**本段在后面所以它赢**。
   如果哪天把这段挪到进场之前，提示条就会"退场时又升一次"，别动顺序。 */
.awu-status[data-state="closing"] {
  animation: awu-exit-rise var(--awu-t-exit) var(--awu-ease-out) both;
  pointer-events: none;
}

/* ---- FLIP 期间抑制 hover 位移（契约 §2.1 的 data-flipping）----
   JSX 删卡时用 WAAPI 跑位移动画，同时挂 data-flipping="true"。
   WAAPI 的 transform 优先级高于 CSS，但**动画结束的那一帧**属性若还没摘，
   :hover 的 translateY(-2px) 会立刻接管 → 卡片在归位后自己弹一下。
   这里把位移与过渡都按住：归位只由 FLIP 负责，hover 只管颜色与阴影。 */
.awu-card[data-flipping="true"],
.awu-card[data-flipping="true"]:hover,
.awu-card[data-flipping="true"]:active {
  transform: none;
}

/* ---- 按压编排（契约 §3「按压」：T_FAST，卡片 .995 / 按钮 .97 / 图标件 .94）----
   这 13 个控件此前只有 :hover 没有 :active，点下去只有"结果"没有"触感"。
   为什么集中写在这里：它们各自的 transition 只列了颜色属性，逐个补 transform 要改 13 处；
   这里用一条并集 transition 覆盖（属性是超集，不会丢原有过渡），并集中标注尺寸档。
   reduced-motion 下由全局守卫统一用「*:active 归零」关掉（见文件末尾降级段）。 */
.awu-tab,
.awu-modePill,
.awu-loreRow,
.awu-loreRowBtn,
.awu-editGroupHead,
.awu-reviewMonthHead,
.awu-previewSegHead,
.awu-check,
.awu-noticeClose,
.awu-editListRemove,
.awu-editAdd,
.awu-lineEdit,
.awu-importDrop {
  transition:
    transform var(--awu-t-fast) var(--awu-ease),
    color var(--awu-t-base) var(--awu-ease),
    background var(--awu-t-base) var(--awu-ease),
    border-color var(--awu-t-base) var(--awu-ease),
    opacity var(--awu-t-base) var(--awu-ease);
}

/* 按钮 / 整行：.97 */
.awu-tab:active,
.awu-modePill:active,
.awu-loreRow:active,
.awu-editGroupHead:active,
.awu-reviewMonthHead:active,
.awu-previewSegHead:active,
.awu-check:active,
.awu-editAdd:active { transform: scale(.97); }

/* 图标件 / 次要动作：.94（和已有的 .awu-btn / .awu-iconBtn 同档） */
.awu-loreRowBtn:active,
.awu-noticeClose:active,
.awu-editListRemove:active,
.awu-lineEdit:active { transform: scale(.94); }

/* 拖放区属于"卡片族"：只给一点点下沉（它不是按钮，压太多会像被点坏了） */
.awu-importDrop:active { transform: scale(.995); }

/* ---- 退场基元（W0-B 地基 + W2 补完，与 client/motion.ts 的 usePresence 配对）----
   React 卸载即销毁，所以"退场"永远是两件事：JS 晚 T_EXIT(160ms) 再卸载 + CSS 把这 160ms 画完。
   分工：motion.ts 的 usePresence 负责计时与焦点释放；本段负责画面。
   四条铁律（改任何一条之前先读）：
     1. 必须 animation-fill-mode: both —— 否则动画跑完瞬间闪回 opacity:1 再消失；
     2. **只动 opacity / 位移，位移一律 ≤ 12px；绝不动 filter / width / height / top / left**；
     3. 退场永远比对应进入快（T_EXIT 对 T_ENTER/T_MID），且**不做 stagger**；
     4. 退场期的命中策略见本段后面那条 pointer-events 规则。
   接入方式：根节点展开 motion.ts 的 presenceAttrs(closing)，即 data-state="closing"。 */

/* 通用退场：只淡出。面板 / scrim / dialog / 专注层 / 编辑器 / 确认卡都走这条。 */
@keyframes awu-exit {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* sheet 向下退：与 awu-sheet-in 的 y24 反向，但只走 12px —— 退场位移要小于进入，
   否则看起来像"被弹出去"，而用户的心理预期是"收回去"。 */
@keyframes awu-exit-down {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(12px); }
}

/* 横向退场（W2，契约 §3「list→detail」）：±8px。
   方向语义：进详情 = 内容从右侧来 → 返回列表时用 left（回右侧去）；
   反过来（从详情退回列表 = 列表从左侧来）用 right。
   8px 刻意小：横向一多就与"整页横滑"混读，这里只要一个方向暗示。 */
@keyframes awu-exit-right {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(8px); }
}

@keyframes awu-exit-left {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(-8px); }
}

/* 向上退场（W2）：notice 条（"向上飘走"）与骨架→内容 用。同样 8px，纯 opacity + 位移。 */
@keyframes awu-exit-rise {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-8px); }
}

/* 大层：只淡出（160ms）。data-state 由 presenceAttrs() 提供。
   ⚠️ 这里**没有** .awu-panel：面板是含 backdrop-filter 的玻璃，它不能播动画（见下面面板退场段）。
   其余五个（scrim / dialog / focus / editor / editorConfirm）都不是玻璃本体的采样源。 */
.awu-scrim[data-state="closing"],
.awu-dialog[data-state="closing"],
.awu-focus[data-state="closing"],
.awu-editor[data-state="closing"],
.awu-editorConfirm[data-state="closing"] {
  animation: awu-exit var(--awu-t-exit) var(--awu-ease-out) both;
  /* 只在退场这 160ms 里买一次层提升，结束后随卸载一起消失 */
  will-change: opacity;
}

/* ---- 面板退场：玻璃不动，只让内容淡出 + 外壳压暗淡出 ----
   选择器写 (0,3,0) 是为了压过进场那条 (.awu-panel > .awu-head = (0,2,0))。
   进场用 backwards（基线可见），退场用 both（跑完保持透明，撑到 usePresence 卸载）。 */
.awu-panel[data-state="closing"] > .awu-head,
.awu-panel[data-state="closing"] > .awu-status,
.awu-panel[data-state="closing"] > .awu-workspace {
  animation: awu-content-out var(--awu-t-exit) var(--awu-ease-in) both;
  pointer-events: none;
}

/* 外壳压暗同步淡出。data-state 挂在 .awu-panel 上（presenceAttrs 的目标是面板本身），
   所以用 :has() 从外壳反查 —— Chromium 105+ 支持；万一不支持，最坏只是压暗在 160ms 后
   随整棵树一起消失，不会留下"永远压暗"的残影。 */
.awu-panelFade:has(> .awu-panel[data-state="closing"])::before {
  animation: awu-scrim-out var(--awu-t-exit) var(--awu-ease-in) both;
}

/* 只给"有父层接着兜点击"的那几层关掉命中：dialog/focus/editorConfirm 在 scrim 里、
   editor 在面板里，把它们的点击放过去只会落到仍然拦着的父层，不会漏到宿主。
   面板与 scrim 自己**保留**命中：它们是最后一道屏，退场期漏点击 = 点到宿主聊天区。 */
.awu-dialog[data-state="closing"],
.awu-focus[data-state="closing"],
.awu-editor[data-state="closing"],
.awu-editorConfirm[data-state="closing"] { pointer-events: none; }

/* 选择器权重 (0,2,0) 高于进入规则 (0,1,0)，不需要 !important */
.awu-dialog[data-state="closing"] { animation-name: awu-exit-down; }

/* ---- 详情页方向退场（契约 §3「list→detail」：进入 +8px 从右、返回 −8px 回右）----
   两条横向 keyframes 从 W2 起就写在下面（awu-exit-right / -left），但一直只有定义没有引用
   —— verify-ui 的 keyframes 闭环为此开了白名单。第 3 批接上：
     · 默认（只有 data-state="closing"）：向右退。这是"从详情回列表"的方向，
       内容往它来的方向走，列表从左侧回到视野；
     · 需要反方向时 JSX 在同一个节点上挂 data-exit="left"（或 "right" 显式声明），显式优先。
   fill-mode 用 both（= backwards + forwards），不用单 backwards：
     · backwards 负责"动画开始前就是 from 态"（本例 delay=0，实际不生效）；
     · forwards 负责"动画结束后保持 to 态"（opacity 0）—— 这段才是关键。
       只写 backwards，160ms 动画跑完到 motion.ts 真正卸载之间会闪回一帧可见（React 卸载
       至少晚一个微任务，实测能看到"淡出后又亮一下"）。铁律里的"动画不跑不能隐身"由
       animation 本身保证：animation-name 不生效时不会有关键帧，元素保持原样可见。 */
.awu-detail[data-state="closing"] {
  animation: awu-exit-right var(--awu-t-exit) var(--awu-ease-out) both;
}

/* 显式方向：只认 .awu-detail 上的属性（不用全局裸属性选择器 ——
   挂 [data-exit] 的可能是任何视图，裸选择器会顺手给它加上"不可点 + 裁切"）。
   方向规则的权重 (0,2,0) 与上面那条相同，靠顺序赢。 */
.awu-detail[data-exit="right"] {
  animation: awu-exit-right var(--awu-t-exit) var(--awu-ease-out) both;
}

.awu-detail[data-exit="left"] {
  animation: awu-exit-left var(--awu-t-exit) var(--awu-ease-out) both;
}

/* 三条共用一份"退场期约束"（原来在每条里各写一遍）：
   pointer-events 关掉命中；overflow + contain 按住横向溢出 ——
   translateX(8px) 会让滚动容器多出 8px 可用宽，在 .awu-mainBody 上抖出一条横向滚动条
   （Windows 上尤其明显）；contain: layout paint 给内部重排/重绘一个稳定边界。 */
.awu-detail[data-state="closing"],
.awu-detail[data-exit="right"],
.awu-detail[data-exit="left"] {
  pointer-events: none;
  overflow: hidden;
  contain: layout paint;
}

/* 四套折叠体的**收起**（展开见下面「折叠编排」段）。
   ⚠️ 前提：JSX 用 usePresence 让折叠体在树上多待 160ms；React 直接卸载的话这里没有对象可动。 */
.awu-editGroupBody[data-state="closing"],
.awu-loreBody[data-state="closing"],
.awu-reviewMonth > .awu-diary[data-state="closing"],
.awu-previewText[data-state="closing"],
.awu-previewEmpty[data-state="closing"] {
  animation: awu-fold-out var(--awu-t-exit) var(--awu-ease-in) both;
  pointer-events: none;
}

/* notice 条的上飘退场（进场见下面「提示条编排」段） */
.awu-notice[data-state="closing"] {
  animation: awu-exit-rise var(--awu-t-exit) var(--awu-ease-out) both;
  pointer-events: none;
}

/* 卡片退场（契约 §3「删卡」：淡出 T_FAST，随后 FLIP 用 T_BASE 塌陷）。
   为什么是 T_FAST(120ms) 而不是 T_EXIT(160ms)：删卡是一组动作的第一步，
   后面还接着 FLIP 位移；淡出多 40ms 就会让人觉得"点完没反应"。
   命中权重 (0,2,0) > 卡片的进场 (0,1,0)，且本段在文件末尾，顺序上也赢。
   📌 第 4 批：JSX 现在给删卡卡片挂了内联 opacity + 120ms 过渡当兜底，
   本规则落地后**那段内联可以删**（保留也不冲突：内联 transition 只影响 transition 通道，
   真正在跑的是这条 animation）。 */
.awu-card[data-state="closing"] {
  animation: awu-exit var(--awu-t-fast) var(--awu-ease-out) both;
  pointer-events: none;
}

/* ---- 关于 data-still（契约 §2.1）：这里不再有任何规则 ----
   历史三段演进，结论是「这条属性在 CSS 侧无事可做」：
     1. 最初它做 backdrop-filter:none + 摘大投影省模糊，但 blur 不可过渡，
        animationend 那一刻摘属性 = 一次硬切（实测 t≈401ms 从 none 跳到
        blur(18px) saturate(1.85)）→ 观感「先发白、顿一下」；
     2. 之后只剩 will-change: opacity/transform/scale 当"层提升"，可给含 backdrop-filter
        的元素加 will-change 会让它变成独立渲染表面、背板采样退化（主人看到的「彻底半透明」），
        连最近一条挂在 .awu-dialog / .awu-focus / .awu-editorConfirmCard 上的也一并删了；
     3. 现在面板/弹层的进场全靠外壳 .awu-panelFade 的纯 opacity 淡入，玻璃本体不播任何动画，
        自然也不需要层提升。
   JSX 侧继续挂 data-still="true" 无害（没有任何选择器命中它），第 4 批可以顺手摘掉。 */

/* ================================================================ 无障碍：降低透明度（W1-C 补齐）
   降级 = 真·不透明。旧实现有两个问题，这里一起修：
     1) 只点了 4 个元素（面板/弹层/专注层/确认卡），8 个模糊面里另外 4 个仍在模糊；
     2) 用的是 background-color 覆盖 —— 卡面/输入/按钮/胶囊二十来条规则引用 --awu-glass-*，
        逐个列举必漏（旧版就漏了 6 类，用户开了降级后卡片还是透的）。
   新做法：**就地重写玻璃令牌**。后代全部自动变实底，新增组件也不再需要往这里加选择器；
   再单独把 8 个 backdrop-filter 面关掉（这个没法用令牌表达）。
   --awu-specular 用"透明 inset 零阴影"而不是 none：它常年出现在
   box-shadow: var(--awu-shadow-card), var(--awu-specular) 这类列表里，写 none 会让整条声明失效。 */
@media (prefers-reduced-transparency: reduce) {
  :is(.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog) {
    --awu-glass-1: #1e1e21;        /* 面板底 */
    --awu-glass-2: #26262b;        /* 卡片 / 分组 / 状态带 / 输入框 */
    --awu-glass-2-hi: #2c2c32;     /* 卡面 hover */
    --awu-glass-3: #333338;        /* 浮起件 / 分段槽 / 小按钮底 */
    --awu-surface-field: #1a1a1d;
    --awu-surface-strip: #191919;  /* 左栏（保持"比右栏暗一档"的凹陷关系） */
    --awu-surface-dialog: #232327;
    --awu-surface-opaque: #1e1e21;
    --awu-sheen: transparent;      /* 实底上再来一层顶部高光就是脏 */
    --awu-specular: inset 0 0 0 0 transparent;
    --awu-scrim-bg: rgba(0, 0, 0, .55); /* 遮罩不糊了，改由更深的压暗承担 */
    --awu-line: rgba(255, 255, 255, .14);
    --awu-line-soft: rgba(255, 255, 255, .07);
  }

  html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) :is(.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog) {
    --awu-glass-1: #f4f4f7;
    --awu-glass-2: #ffffff;
    --awu-glass-2-hi: #fbfbfd;
    --awu-glass-3: #e9e9ee;
    --awu-surface-field: #ececf0;
    --awu-surface-strip: #eeeef2;
    --awu-surface-dialog: #ffffff;
    --awu-surface-opaque: #f6f6f8;
    --awu-sheen: transparent;
    --awu-specular: inset 0 0 0 0 transparent;
    --awu-scrim-bg: rgba(18, 20, 26, .32);
    --awu-line: rgba(60, 60, 67, .18);
    --awu-line-soft: rgba(60, 60, 67, .10);
  }

  /* 全部 8 个模糊面（与代码里每一处 backdrop-filter 声明逐一对应）：
     trigger / panel / menu / editorFoot / editorConfirm / editorConfirmCard / dialog / focus。
     两条实测校准（W4 审查）：
       · 补 .awu-menu —— 弹出菜单实测仍是 blur(30px) saturate(1.8)，上一版漏了它，
         症状是"开了降低透明度只有菜单还糊"；
       · 去掉 .awu-scrim —— 它已经不再声明 backdrop-filter（实测 computed 就是 none），
         留在清单里属于"清单比现实多一项"，会让下一个人误以为遮罩还带模糊。 */
  .awu-trigger,
  .awu-panel,
  .awu-menu,
  .awu-editorFoot,
  .awu-editorConfirm,
  .awu-editorConfirmCard,
  .awu-dialog,
  .awu-focus {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background-image: none;
  }

  /* 实底上 1px 玻璃亮边会显脏，换常规分隔线。
     压暗不再挂在面板 box-shadow 上（已挪到 .awu-panelFade::before 单独淡入），这里只留投影。 */
  .awu-panel,
  .awu-dialog,
  .awu-focus,
  .awu-editorConfirmCard { border-color: var(--awu-line-strong); }
  .awu-panel { box-shadow: 0 24px 64px rgba(0, 0, 0, .35); }
  .awu-card,
  .awu-section,
  .awu-editGroup,
  .awu-loreEntry,
  .awu-loreRow { box-shadow: inset 0 0 0 1px var(--awu-line); }
}

/* ================================================================ 无障碍：减弱动效（全局守卫）
   2026-11-02（W0-B）：从「逐个选择器点名」改成「全局护栏」。
   旧清单靠手工维护，新增动画必然漏 —— 审查实测已漏 3 条（scroll-hint / .awu-editGroupBody /
   .awu-presetHeavyConfirm），且随着动画数量增长只会继续漏。
   现在分工：星号管住"未来的所有动画与过渡"，下面只处理星号管不到的例外。
   注意：prefers-reduced-transparency 是另一段，W1-C 已把它补齐（8 个模糊面 + 全部半透明面）。 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    /* 关键：animation-delay 也必须归零。卡片错峰是用 inline animation-delay 写的
       （index.tsx 的 CARD_STAGGER，最长 272ms），配合 backwards 会让卡片在这段时间里
       始终 opacity:0 —— 只管 duration 的话，减弱动效用户反而看到"空白 272ms 后突然出现"。 */
    animation-delay: 0ms !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }

  /* 例外①：scroll-timeline 动画不认 animation-duration（进度由滚动位置驱动，duration 恒为 auto），
     唯一有效的关闭方式就是 animation: none。W1-C 起滚动容器有三个，逐个列上。 */
  .awu-pane::before,
  .awu-mainBody::before,
  .awu-editorBody::before { animation: none !important; }

  /* 例外②：几条"只跑一次"的淡入（四套折叠 + 重量确认条）。守卫压到 0.01ms 已等价瞬时，
     这里显式关掉，省掉一次 keyframe 求值 + 一次伪元素重绘。 */
  .awu-editGroupBody,
  .awu-loreBody,
  .awu-reviewMonth > .awu-diary,
  .awu-previewText,
  .awu-previewEmpty,
  .awu-presetHeavyConfirm { animation: none !important; }

  /* 例外③：加载转圈属于"必要信息"（停转读起来像卡死），WCAG 2.3.3 也不要求关它。 */
  .awu-iconBtn[data-spin="true"] svg {
    animation: awu-spin .9s linear infinite !important;
  }

  /* 例外④（W2，契约 §2.1）：指针跟随高光在减弱动效下一律退回**静态**顶部高光。
     只压 transition 是不够的 —— 守卫管的是"时长"，而 JS 每帧写 --awu-mx/--awu-my
     会让 background 的径向渐变中心一直变，那是逐帧重绘，比动画还贵。
     这里把 background 换成一条不含 var() 的固定值：变量继续写、但已无人引用，paint 归零。 */
  .awu-card::after {
    background: radial-gradient(120% 70% at 50% -24%, var(--awu-sheen) 0%, transparent 62%);
    animation: none !important;
    opacity: 1;
  }

  /* 星号只管"时长"，不管"有没有动"：装饰性位移仍需显式归零。 */
  .awu-card:hover { transform: none; }
  /* 按压反馈同理：W2 补的 13 个 :active scale 在减弱动效下必须完全失效
     （instant 的缩放虽然不"动"，但一按一跳仍是前庭刺激）。 */
  *:active { transform: none !important; }
  /* 退场也只保留透明度：带位移的那条（awu-exit-down / -left / -right / -rise）本身就是运动。 */
  .awu-dialog[data-state="closing"] { animation-name: awu-exit; }
  .awu-notice[data-state="closing"] { animation-name: awu-exit; }
  /* 详情页的横向退场同理：减弱动效下只淡出，不做 ±8px 位移 */
  .awu-detail[data-state="closing"] { animation-name: awu-exit; }
  /* 常驻合成层在降级下没有意义：别为一个不会播的动画锁住 1120x900 的层。 */
  .awu-panel { will-change: auto; }
}

/* ================================================================ 无障碍：高对比（prefers-contrast: more）
   原则：**不改布局，只把"读"变清楚**。三条主线：
     1) 墨色抬档：ink-mute 直接提到 ink-dim 那一档 —— 12~13px 的小字（字段 key、说明、时间戳）
        在高对比模式下是重灾区；ink-faint 保持不动，它本来只画线，抬档会把分隔线画成实线；
     2) 分隔线抬档：line / line-strong 各提一级，卡片之间、行之间靠线分界的地方不再糊成一片；
     3) 玻璃降噪：sheen 关掉（顶部高光在半透背景上就是一层雾），backdrop-filter 去掉 saturate
        与 brightness —— 高对比模式下"玻璃质感"直接等于对比度损失，模糊只保留几何所需的半径。
   必须写在变量作用域里：面板本体在 .awu-scope、侧栏入口在 .awu-layer、面板外壳在 .awu-panelFade、
   弹层与遮罩是 portal 出来的 .awu-scrim / .awu-dialog，五个都得进清单（和浅色块的清单逐字一致）。 */
@media (prefers-contrast: more) {
  :is(.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog) {
    --awu-ink-mute: rgba(235, 235, 245, .82);       /* 原本 .68，抬到 ink-dim 那一档 */
    --awu-line: rgba(255, 255, 255, .18);           /* 原本 .10，抬到原 line-strong */
    --awu-line-strong: rgba(255, 255, 255, .32);    /* 原本 .18 */
    --awu-sheen: transparent;                       /* 关顶部高光 */
    --awu-blur: blur(30px);                         /* 去掉 saturate(180%) */
    --awu-blur-panel: blur(20px);                   /* 去掉 saturate(138%) */
    --awu-card-hi: rgba(255, 255, 255, .06);        /* 指针高光 .12 → 一半：越 hover 越糊就白改了 */
    --awu-glass-2-hi: rgba(98, 98, 112, .48);       /* hover 提亮幅度收一半（.52 → .48） */
    /* 玻璃本体一起抬：小字压在壁纸上正是高对比要解决的那件事。
       .70/.44 时 14px 正文在浅灰壁纸上会"浮"，抬到 .84/.56 后正文底色才稳。 */
    --awu-glass-1: rgba(20, 20, 24, .84);
    --awu-glass-2: rgba(72, 72, 82, .56);
    --awu-scrim-bg: rgba(0, 0, 0, .50);             /* 压暗加深，别让亮壁纸把正文对比拉回去 */
    --awu-focus-ring-w: 3px;                        /* 焦点环宽度（唯一真源，见下一条规则） */
  }

  /* 浅色必须单独一份：浅色块的变量选择器权重更高，只写上面那份在浅色下会被它压掉。 */
  html:not([data-ds-dark-theme]) body:not([data-ds-dark-theme]) :is(.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog) {
    --awu-ink-mute: rgba(60, 60, 67, .88);          /* 原本 .78 */
    --awu-line: rgba(60, 60, 67, .24);              /* 原本 .14 */
    --awu-line-strong: rgba(60, 60, 67, .34);       /* 原本 .24 */
    --awu-sheen: transparent;
    --awu-blur: blur(30px);
    --awu-blur-panel: blur(20px);
    --awu-card-hi: rgba(255, 255, 255, .28);        /* 原本 .55（浅色下过曝，高对比只留一点位置感） */
    --awu-glass-2-hi: rgba(255, 255, 255, .77);     /* 原本 .86 */
    --awu-glass-1: rgba(255, 255, 255, .72);        /* 原本 .54 —— 高对比下小字不能浮在壁纸上 */
    --awu-glass-2: rgba(255, 255, 255, .84);        /* 原本 .68 */
    --awu-scrim-bg: rgba(18, 20, 26, .30);          /* 原本 .16 */
    --awu-focus-ring-w: 3px;
  }

  /* 焦点环加粗到 3px（宽度走令牌 --awu-focus-ring-w）。
     25 条规则都写成 outline: 2px solid var(--awu-focus-ring) 简写，逐条改要动 25 处；
     这里用 outline-width 单独覆盖（style/color 仍由简写提供），!important 才有资格压过 (0,2,0) 的简写。
     用 outline-width 而不是重写 outline：verify-a11y ⑦ 只认 outline: 简写里的写死颜色，
     这里不产生新的写死值，也保住"25 条都在走 token"这条信号。 */
  *:focus-visible { outline-width: var(--awu-focus-ring-w) !important; }
}

/* ================================================================ 无障碍：强制颜色（forced-colors: active）
   Windows「高对比主题」/ 强制颜色模式下系统接管全部颜色，但那**不会**顺手关掉 backdrop-filter：
   实测此时仍是 blur(20px) saturate(1.38)，于是文字底下永远混着一层"系统实色 + 模糊 + 饱和"，
   还会把系统给的背景色洗淡。sheen 与 specular 同理 —— 渐变与阴影不受 forced-colors 的颜色替换，
   会以半透明白的形式继续叠在系统色上。
   这里用 * 而不是枚举：系统接管后任何一处残留模糊都是错的，枚举必然漏（上一版降透明清单就漏过 .awu-menu）。 */
@media (forced-colors: active) {
  *,
  *::before,
  *::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  :is(.awu-scope, .awu-layer, .awu-panelFade, .awu-scrim, .awu-dialog) {
    --awu-sheen: transparent;                        /* 顶部高光 = 系统色上的白雾 */
    --awu-glass-edge: transparent;                   /* 面板顶部的 1px 亮边渐变 */
    --awu-specular: inset 0 0 0 0 transparent;       /* 玻璃高光描边 */
  }
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
