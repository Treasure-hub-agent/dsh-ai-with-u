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

/**
 * 设计语言的全部 CSS。
 *
 * 结构：变量层 → 基底 → 侧栏按钮 → 悬浮面板骨架 → 头部 → 统计 → 卡片墙 →
 *       详情页 → 日记 → 弹层 → 动效 / 无障碍。
 */
const CSS = `
/* ================================================================ 变量层 */
.awu-scope,
.awu-layer {
  --awu-ink: #f6ece0;
  --awu-ink-dim: #bdae9d;
  --awu-ink-mute: #8f8172;
  --awu-ink-faint: #6d6154;
  --awu-line: rgba(244, 208, 160, .11);
  --awu-line-strong: rgba(244, 208, 160, .22);
  --awu-surface: rgba(31, 23, 19, .9);
  --awu-surface-2: rgba(255, 226, 190, .035);
  --awu-surface-3: rgba(255, 226, 190, .065);
  --awu-gold: #e9bd72;
  --awu-gold-hi: #ffd894;
  --awu-rose: #e2917f;
  --awu-pink: #f2b6c6;
  --awu-teal: #86c9bd;
  --awu-danger: #e2796b;
  --awu-grad: linear-gradient(118deg, #ffd894 0%, #e9a37c 46%, #d98ba8 100%);
  --awu-grad-soft: linear-gradient(118deg, rgba(255, 216, 148, .2), rgba(217, 139, 168, .2));
  --awu-serif: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "Georgia", serif;
  --awu-sans: "Inter", "SF Pro Text", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --awu-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", monospace;
  --awu-ease: ${EASE};
  --awu-r-sm: 8px;
  --awu-r-md: 12px;
  --awu-r-lg: 16px;
  --awu-r-xl: 20px;
  --awu-shadow: 0 28px 64px rgba(0, 0, 0, .56), 0 6px 20px rgba(0, 0, 0, .34);
  --awu-scroll: rgba(233, 189, 114, .22);

  /* 宿主的系统滚动条钩子：我们这里换成金色的细棒 */
  --dsh-scrollbar-thumb: var(--awu-scroll);
  --dsh-scrollbar-thumb-hover: rgba(233, 189, 114, .42);
}

/* 浅色主题：把「夜」换成「晨纸」，同一套关系重新配平 */
html:not([data-ds-dark-theme]) .awu-scope,
html:not([data-ds-dark-theme]) .awu-layer {
  /* 浅色不是「把深色反相」，而是同一套关系的重新配平：
     底子换成微暖的宣纸灰（不是纯白），墨色用深褐而不是纯黑，强调色降低明度以保对比。 */
  --awu-ink: #2b2019;
  --awu-ink-dim: #52443a;
  --awu-ink-mute: #7c6b5c;
  --awu-ink-faint: #9a8a7b;
  --awu-line: rgba(120, 82, 40, .16);
  --awu-line-strong: rgba(120, 82, 40, .28);
  --awu-surface: rgba(246, 239, 229, .97);
  --awu-surface-2: rgba(120, 82, 40, .05);
  --awu-surface-3: rgba(120, 82, 40, .09);
  --awu-gold: #8f5f22;
  --awu-gold-hi: #a97230;
  --awu-rose: #9c5232;
  --awu-pink: #9c4468;
  --awu-teal: #2f6b60;
  --awu-danger: #9e3b28;
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
  gap: 10px;
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
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background .2s var(--awu-ease), border-color .2s var(--awu-ease),
    box-shadow .2s var(--awu-ease), transform .12s var(--awu-ease);
}

/* 常驻的极淡暖色，让按钮哪怕不 hover 也不是纯透明 */
.awu-trigger::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(120deg, rgba(255, 216, 148, .07), rgba(217, 139, 168, .05) 60%, transparent);
  opacity: .8;
  pointer-events: none;
  transition: opacity .25s var(--awu-ease);
}

.awu-trigger:hover::before { opacity: 1; }

.awu-trigger:hover {
  border-color: var(--awu-line-strong);
  box-shadow: 0 8px 22px rgba(0, 0, 0, .18), inset 0 1px 0 rgba(255, 232, 200, .07);
}

.awu-trigger:active { transform: scale(.985); }

.awu-trigger[data-open="true"] {
  border-color: rgba(233, 189, 114, .42);
  box-shadow: 0 0 0 1px rgba(233, 189, 114, .16), 0 10px 26px rgba(0, 0, 0, .26);
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
  width: 26px;
  height: 26px;
  border-radius: 9px;
  color: #241a12;
  font-family: var(--awu-serif);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  background: var(--awu-grad);
  box-shadow: 0 2px 8px rgba(233, 163, 124, .34), inset 0 1px 0 rgba(255, 255, 255, .45);
}

.awu-mark::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 12px;
  border: 1px solid rgba(233, 189, 114, .34);
  opacity: 0;
  transition: opacity .3s var(--awu-ease);
}

.awu-trigger[data-live="true"] .awu-mark::after {
  opacity: 1;
  animation: awu-breathe 3.4s ease-in-out infinite;
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
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: .02em;
  line-height: 15px;
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
  font-size: 10.5px;
  line-height: 14px;
  color: var(--awu-ink-mute);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color .2s var(--awu-ease);
}

.awu-trigger[data-live="true"] .awu-triggerName { color: var(--awu-ink-dim); }

/* 状态灯：启用=琥珀呼吸，未启用=暗点，禁用=横杠 */
.awu-lamp {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awu-ink-faint);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, .06);
  transition: background .25s var(--awu-ease), box-shadow .25s var(--awu-ease);
}

.awu-lamp[data-on="true"] {
  background: var(--awu-gold-hi);
  box-shadow: 0 0 0 3px rgba(233, 189, 114, .14), 0 0 10px rgba(255, 216, 148, .7);
  animation: awu-pulse 2.6s ease-in-out infinite;
}

/* 收起态：只剩一枚 36px 的圆徽 */
.awu-layer[data-rail="true"] {
  flex: 0 0 auto;
  width: 36px;
  max-width: 100%;
  height: 36px;
  margin: 0;
}

.awu-layer[data-rail="true"] .awu-trigger {
  flex: 0 0 36px;
  width: 36px;
  max-width: 100%;
  height: 36px;
  min-width: 0;
  padding: 0;
  gap: 0;
  border-radius: 50%;
  justify-content: center;
}

/* 窄轨下文字节点本来就不渲染（条件渲染），这两条是防御：万一别处塞进来也不会换行 */
.awu-layer[data-rail="true"] .awu-triggerText,
.awu-layer[data-rail="true"] .awu-lamp { display: none; }

.awu-layer[data-rail="true"] .awu-mark { width: 24px; height: 24px; border-radius: 50%; font-size: 13px; }

/* ================================================================ 悬浮面板骨架 */
.awu-panel {
  /* fixed 定位；编辑器的「未保存确认」需要在面板内 absolute 覆盖，所以这里也要是包含块 */
  position: fixed;
  z-index: 2147482000;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 452px;
  max-width: calc(100vw - 20px);
  max-height: min(78vh, 720px);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-xl);
  background:
    radial-gradient(120% 70% at 0% 0%, rgba(255, 216, 148, .1), transparent 58%),
    radial-gradient(110% 80% at 100% 0%, rgba(217, 139, 168, .1), transparent 62%),
    radial-gradient(140% 100% at 50% 120%, rgba(134, 201, 189, .06), transparent 60%),
    var(--awu-surface);
  backdrop-filter: blur(26px) saturate(140%);
  -webkit-backdrop-filter: blur(26px) saturate(140%);
  box-shadow: var(--awu-shadow), inset 0 1px 0 rgba(255, 236, 210, .08);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: 13px;
  line-height: 1.6;
  overflow: hidden;
  transform-origin: left bottom;
  animation: awu-panel-in .24s var(--awu-ease);
}

/* 面板顶部那道金线：整套 UI 的「签名」 */
.awu-panel::before {
  content: "";
  position: absolute;
  top: 0;
  left: 22px;
  right: 22px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 216, 148, .8) 22%, rgba(217, 139, 168, .7) 68%, transparent);
  pointer-events: none;
}

/* ================================================================ 头部 */
.awu-head {
  flex: none;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 16px 12px 18px;
}

.awu-headMain { min-width: 0; flex: 1; }

.awu-kicker {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 9.5px;
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
  background: linear-gradient(90deg, rgba(233, 189, 114, .34), transparent);
}

.awu-title {
  margin-top: 6px;
  font-family: var(--awu-serif);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: .04em;
  line-height: 1.25;
  color: var(--awu-ink);
}

.awu-title em {
  font-style: normal;
  background: var(--awu-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.awu-headActions { display: flex; align-items: center; gap: 4px; flex: none; margin-top: -2px; }

.awu-iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--awu-ink-mute);
  cursor: pointer;
  transition: color .18s var(--awu-ease), background .18s var(--awu-ease),
    border-color .18s var(--awu-ease), transform .3s var(--awu-ease);
}

.awu-iconBtn:hover {
  color: var(--awu-ink);
  background: var(--awu-surface-3);
  border-color: var(--awu-line);
}

.awu-iconBtn:active { transform: scale(.94); }
.awu-iconBtn:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }
.awu-iconBtn[data-spin="true"] svg { animation: awu-spin .9s linear infinite; }

/* 启用中的角色横幅 */
.awu-sigil {
  flex: none;
  display: flex;
  align-items: center;
  gap: 11px;
  margin: 0 17px 12px;
  padding: 11px 13px;
  border: 1px solid rgba(233, 189, 114, .26);
  border-radius: var(--awu-r-md);
  background:
    linear-gradient(100deg, rgba(255, 216, 148, .14), rgba(217, 139, 168, .1) 60%, transparent),
    var(--awu-surface-2);
  position: relative;
  overflow: hidden;
}

.awu-sigil::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%, rgba(255, 236, 200, .16) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: awu-sheen 5.2s var(--awu-ease) infinite;
  pointer-events: none;
}

.awu-sigilBody { min-width: 0; flex: 1; }

.awu-sigilName {
  font-family: var(--awu-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .05em;
  line-height: 20px;
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-sigilMeta {
  font-size: 10.5px;
  line-height: 15px;
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-sigilBtns { display: flex; gap: 6px; flex: none; }

/* 空态：未启用时的温柔提示 */
.awu-idle {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 17px 12px;
  padding: 9px 13px;
  border: 1px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-md);
  color: var(--awu-ink-mute);
  font-size: 11.5px;
  line-height: 16px;
}

.awu-idleDot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awu-ink-faint);
}

/* ================================================================ 统计条 */
.awu-stats {
  flex: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 0 17px 12px;
  border-radius: var(--awu-r-md);
  overflow: hidden;
  background: var(--awu-line);
}

.awu-stat {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: 11px 10px 12px;
}

html:not([data-ds-dark-theme]) .awu-stat { background: rgba(255, 252, 245, .55); }

.awu-statNum {
  font-family: var(--awu-serif);
  font-size: 19px;
  font-weight: 600;
  line-height: 24px;
  letter-spacing: .02em;
  color: var(--awu-ink);
  font-variant-numeric: tabular-nums;
}

.awu-statNum small {
  font-family: var(--awu-sans);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--awu-ink-mute);
  margin-left: 4px;
}

/* ================================================================ 分段器 */
.awu-tabs {
  flex: none;
  display: flex;
  gap: 2px;
  margin: 0 17px 12px;
  padding: 3px;
  border: 1px solid var(--awu-line);
  border-radius: 11px;
  background: var(--awu-surface-2);
}

.awu-tab {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .04em;
  cursor: pointer;
  transition: color .18s var(--awu-ease), background .18s var(--awu-ease),
    box-shadow .18s var(--awu-ease);
}

.awu-tab:hover { color: var(--awu-ink-dim); }

.awu-tab[data-on="true"] {
  color: #241a12;
  background: var(--awu-grad);
  box-shadow: 0 2px 10px rgba(233, 163, 124, .28), inset 0 1px 0 rgba(255, 255, 255, .4);
}

html:not([data-ds-dark-theme]) .awu-tab[data-on="true"] { color: #fff8ee; }

.awu-tab:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: -1px; }

/* ================================================================ 滚动主体 */
.awu-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 17px 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-body::-webkit-scrollbar { width: 7px; }
.awu-body::-webkit-scrollbar-track { background: transparent; }
.awu-body::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: 99px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* ================================================================ 角色卡 */
.awu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: 11px;
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
  gap: 9px;
  /* 左右内边距对齐且留足：文字块与边框之间必须有呼吸空间 */
  padding: 14px 16px 13px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background:
    radial-gradient(120% 90% at 0% 0%, rgba(255, 216, 148, .07), transparent 56%),
    var(--awu-surface-2);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: border-color .22s var(--awu-ease), background .22s var(--awu-ease),
    box-shadow .22s var(--awu-ease), transform .22s var(--awu-ease);
  animation: awu-rise .34s var(--awu-ease) backwards;
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
  transition: opacity .3s var(--awu-ease), left .6s var(--awu-ease);
  pointer-events: none;
}

.awu-card:hover {
  transform: translateY(-2px);
  border-color: rgba(233, 189, 114, .3);
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
  box-shadow: 0 0 0 1px rgba(233, 189, 114, .12), 0 10px 30px rgba(233, 163, 124, .16);
  animation: awu-rise .34s var(--awu-ease) backwards, awu-glow 3.6s ease-in-out infinite;
}

.awu-cardChevron {
  flex: none;
  color: var(--awu-ink-faint);
  opacity: 0;
  transform: translateX(-3px);
  transition: opacity .2s var(--awu-ease), transform .2s var(--awu-ease);
}

.awu-card:hover .awu-cardChevron { opacity: 1; transform: translateX(0); }

.awu-cardTop {
  display: flex;
  align-items: center;
  gap: 9px;
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
  width: 34px;
  height: 34px;
  border-radius: 12px;
  font-family: var(--awu-serif);
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  color: #241a12;
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
  border-radius: 15px;
  border: 1px solid rgba(233, 189, 114, .5);
  animation: awu-breathe 3.4s ease-in-out infinite;
}

.awu-cardTitle {
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
  margin: 0 2px;
}

.awu-cardName {
  display: block;
  max-width: 100%;
  font-family: var(--awu-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: .05em;
  line-height: 20px;
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardRole {
  display: block;
  max-width: 100%;
  font-size: 10.5px;
  line-height: 15px;
  color: var(--awu-ink-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-cardBlurb {
  font-size: 11.5px;
  line-height: 18.5px;
  color: var(--awu-ink-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* 中英混排：优先在词/标点处断开，避免行尾只剩一个孤字贴到边框上 */
  word-break: normal;
  overflow-wrap: break-word;
  /* 正文块与左右内边距再多 2px，视觉上离边框更远一点 */
  margin: 0 2px;
  min-height: 37px;
}

/* 两行截断时最后一行的省略号有时会压到最右，给它一点收尾空间 */
.awu-cardBlurb::after { content: ""; }

.awu-cardFoot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 2px;
  min-width: 0;
  font-size: 10px;
  letter-spacing: .04em;
  color: var(--awu-ink-faint);
}

.awu-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 99px;
  border: 1px solid var(--awu-line);
  font-size: 9.5px;
  letter-spacing: .06em;
  color: var(--awu-ink-mute);
  white-space: nowrap;
}

.awu-pill[data-tone="live"] {
  border-color: rgba(233, 189, 114, .44);
  color: var(--awu-gold-hi);
  background: rgba(233, 189, 114, .1);
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
  gap: 5px;
  padding: 5px 11px;
  border: 1px solid var(--awu-line-strong);
  border-radius: 9px;
  background: transparent;
  color: var(--awu-ink-dim);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: .03em;
  cursor: pointer;
  white-space: nowrap;
  transition: color .18s var(--awu-ease), background .18s var(--awu-ease),
    border-color .18s var(--awu-ease), box-shadow .18s var(--awu-ease), transform .12s var(--awu-ease);
}

.awu-btn:hover { color: var(--awu-ink); background: var(--awu-surface-3); border-color: rgba(233, 189, 114, .34); }
.awu-btn:active { transform: scale(.97); }
.awu-btn:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }
.awu-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }

.awu-btn[data-kind="primary"] {
  border-color: transparent;
  color: #241a12;
  background: var(--awu-grad);
  font-weight: 600;
  box-shadow: 0 3px 12px rgba(233, 163, 124, .3), inset 0 1px 0 rgba(255, 255, 255, .38);
}

.awu-btn[data-kind="primary"]:hover { filter: brightness(1.06); }
html:not([data-ds-dark-theme]) .awu-btn[data-kind="primary"] { color: #fff8ee; }

.awu-btn[data-kind="ghost"] { border-color: transparent; color: var(--awu-ink-mute); }
.awu-btn[data-kind="ghost"]:hover { color: var(--awu-ink); border-color: var(--awu-line); }

.awu-btn[data-kind="danger"] { color: var(--awu-danger); border-color: rgba(226, 121, 107, .3); }
.awu-btn[data-kind="danger"]:hover { background: rgba(226, 121, 107, .1); border-color: rgba(226, 121, 107, .55); }

.awu-btn[data-size="sm"] { padding: 3px 8px; font-size: 10.5px; border-radius: 8px; }
.awu-btn[data-size="block"] { width: 100%; padding: 7px 12px; }

/* ================================================================ 详情页 */
.awu-detail { display: flex; flex-direction: column; gap: 14px; animation: awu-slide-in .26s var(--awu-ease); }

/* 详情页导航行：面包屑式「← 返回角色簿 · 角色名」。
   刻意不用按钮描边，而是靠文字色 + hover 底色表达「这是导航」，
   与右侧带边框的启用/删除（动作）形成明确的视觉分层。 */
.awu-detailNav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: -2px;
}

.awu-navBack {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 4px 9px 4px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--awu-gold);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: .03em;
  cursor: pointer;
  white-space: nowrap;
  transition: background .18s var(--awu-ease), color .18s var(--awu-ease),
    border-color .18s var(--awu-ease), transform .12s var(--awu-ease);
}

.awu-navBack:hover {
  color: var(--awu-gold-hi);
  background: rgba(233, 189, 114, .12);
  border-color: rgba(233, 189, 114, .3);
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
  gap: 8px;
  min-width: 0;
  font-size: 10.5px;
  letter-spacing: .08em;
  color: var(--awu-ink-faint);
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
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-lg);
  background:
    radial-gradient(130% 100% at 0% 0%, rgba(255, 216, 148, .1), transparent 60%),
    var(--awu-surface-2);
}

.awu-heroAvatar {
  width: 50px;
  height: 50px;
  border-radius: 17px;
  font-size: 23px;
}

.awu-heroBody { min-width: 0; flex: 1 1 0%; }

.awu-heroName {
  font-family: var(--awu-serif);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: .06em;
  line-height: 25px;
}

.awu-heroSub {
  font-size: 11px;
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
  gap: 6px;
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
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--awu-line);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .18em;
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
  font-size: 9.5px;
  letter-spacing: 0;
  color: var(--awu-ink-faint);
}

.awu-sectionBody { padding: 10px 12px 12px; }

/* 角色卡字段：左边一条极细的金线做「引文」感 */
.awu-field {
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 8px;
  padding: 5px 0;
  font-size: 11.5px;
  line-height: 17px;
  border-bottom: 1px solid rgba(244, 208, 160, .05);
}

.awu-field:last-child { border-bottom: none; }

.awu-fieldKey { color: var(--awu-ink-faint); letter-spacing: .04em; }
.awu-fieldVal { color: var(--awu-ink-dim); word-break: break-word; }
.awu-fieldVal b { color: var(--awu-ink); font-weight: 500; }

/* ================================================================ 日记 */
.awu-diary { display: flex; flex-direction: column; gap: 10px; }

.awu-day {
  border-left: 1px solid rgba(233, 189, 114, .24);
  padding-left: 12px;
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
  box-shadow: 0 0 0 3px rgba(233, 189, 114, .12);
}

.awu-dayDate {
  font-family: var(--awu-mono);
  font-size: 10.5px;
  letter-spacing: .06em;
  color: var(--awu-gold);
  margin-bottom: 3px;
}

.awu-line {
  font-size: 11.5px;
  line-height: 18px;
  color: var(--awu-ink-dim);
  padding: 1px 0;
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.awu-lineMarker {
  flex: none;
  font-family: var(--awu-mono);
  font-size: 9px;
  color: var(--awu-ink-faint);
  min-width: 10px;
}

/* ================================================================ 关系 / 日记维护 */
.awu-relation {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid rgba(233, 189, 114, .24);
  border-radius: var(--awu-r-md);
  background:
    linear-gradient(100deg, rgba(255, 216, 148, .1), transparent 70%),
    var(--awu-surface-2);
}

.awu-relationLabel {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--awu-gold);
  flex: none;
}

.awu-relationTag {
  font-family: var(--awu-serif);
  font-size: 13.5px;
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
  font-size: 10px;
  color: var(--awu-ink-faint);
  font-variant-numeric: tabular-nums;
}

.awu-diaryHead { display: flex; align-items: center; gap: 7px; }

.awu-sectionLabel {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--awu-gold);
}

.awu-count {
  font-family: var(--awu-mono);
  font-size: 10px;
  letter-spacing: 0;
  color: var(--awu-ink-faint);
}

/* 日记行：hover 才浮出「改写」，保持列表干净 */
.awu-line {
  transition: background .16s var(--awu-ease);
  border-radius: 6px;
  margin: 0 -5px;
  padding: 1px 5px;
}

.awu-line:hover { background: var(--awu-surface-2); }

.awu-lineEdit {
  flex: none;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--awu-gold);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  opacity: 0;
  transition: opacity .16s var(--awu-ease), background .16s var(--awu-ease);
}

.awu-line:hover .awu-lineEdit,
.awu-lineEdit:focus-visible { opacity: .9; }
.awu-lineEdit:hover { background: rgba(233, 189, 114, .14); opacity: 1; }

/* 危险操作区：一条红铜色分隔，视觉上明确「这里会删东西」 */
.awu-dangerZone {
  margin-top: 2px;
  border: 1px solid rgba(226, 121, 107, .2);
  border-radius: var(--awu-r-md);
  background: rgba(226, 121, 107, .045);
  overflow: hidden;
}

.awu-dangerZone .awu-sectionHead { border-bottom-color: rgba(226, 121, 107, .18); color: var(--awu-danger); }
.awu-dangerZone .awu-sectionHead::after {
  background: linear-gradient(90deg, rgba(226, 121, 107, .26), transparent);
}

.awu-dangerRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(226, 121, 107, .12);
}

.awu-dangerRow:last-child { border-bottom: none; }

.awu-dangerText { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.awu-dangerText b { font-size: 11.5px; font-weight: 600; color: var(--awu-ink-dim); }
.awu-dangerText b[data-danger="true"] { color: var(--awu-danger); }
.awu-dangerText span { font-size: 10px; line-height: 15px; color: var(--awu-ink-faint); }

.awu-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 84px;
  font-family: var(--awu-sans);
  font-size: 12.5px;
  line-height: 1.65;
  letter-spacing: 0;
  padding: 9px 11px;
}

/* ================================================================ 空态 / 载入 / 错误 */
.awu-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 20px;
  border: 1px dashed var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  text-align: center;
}

.awu-emptyMark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(233, 189, 114, .3);
  color: var(--awu-gold);
  opacity: .8;
}

.awu-emptyTitle {
  font-family: var(--awu-serif);
  font-size: 14px;
  letter-spacing: .06em;
  color: var(--awu-ink-dim);
}

.awu-emptyHint { font-size: 11px; line-height: 17px; color: var(--awu-ink-faint); max-width: 260px; }

.awu-err {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 17px 11px;
  padding: 9px 12px;
  border: 1px solid rgba(226, 121, 107, .34);
  border-radius: var(--awu-r-md);
  background: rgba(226, 121, 107, .1);
  color: var(--awu-danger);
  font-size: 11.5px;
  line-height: 17px;
}

/* 骨架屏 */
.awu-sk { display: flex; flex-direction: column; gap: 9px; padding: 4px 0; }

.awu-skRow {
  height: 62px;
  border-radius: var(--awu-r-md);
  background: linear-gradient(100deg, rgba(255, 226, 190, .04) 20%, rgba(255, 226, 190, .1) 40%, rgba(255, 226, 190, .04) 60%);
  background-size: 300% 100%;
  animation: awu-shimmer 1.4s linear infinite;
}

/* ================================================================ 角色卡编辑器 */

/* 编辑器接管整个面板内容区：纵向三段（标题栏 / 滚动体 / 固定操作条） */
.awu-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  animation: awu-slide-in .24s var(--awu-ease);
}

.awu-editorHead {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 10px 18px;
  border-bottom: 1px solid var(--awu-line);
  position: relative;
}

/* 标题栏下沿一道渐变金线，和面板顶部那道呼应 */
.awu-editorHead::after {
  content: "";
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, rgba(255, 216, 148, .55), rgba(217, 139, 168, .4) 55%, transparent);
  pointer-events: none;
}

.awu-editorHeadMain { min-width: 0; flex: 1; }

.awu-editorKicker {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .26em;
  text-transform: uppercase;
  color: var(--awu-gold);
  opacity: .85;
}

.awu-editorName {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
  min-width: 0;
  font-family: var(--awu-serif);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: .05em;
  color: var(--awu-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-editorSource {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--awu-line-strong);
  border-radius: 99px;
  font-family: var(--awu-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--awu-ink-faint);
}

.awu-editorHeadRight { display: flex; align-items: center; gap: 6px; flex: none; }

.awu-editorProgress {
  font-family: var(--awu-mono);
  font-size: 10.5px;
  letter-spacing: .02em;
  color: var(--awu-ink-faint);
  font-variant-numeric: tabular-nums;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--awu-surface-2);
}

.awu-editorReadonly {
  flex: none;
  padding: 7px 18px 0;
  font-size: 10px;
  line-height: 15px;
  color: var(--awu-ink-faint);
}

.awu-editorBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  scrollbar-width: thin;
  scrollbar-color: var(--awu-scroll) transparent;
}

.awu-editorBody::-webkit-scrollbar { width: 7px; }
.awu-editorBody::-webkit-scrollbar-track { background: transparent; }
.awu-editorBody::-webkit-scrollbar-thumb {
  background: var(--awu-scroll);
  border-radius: 99px;
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
  transition: border-color .2s var(--awu-ease), background .2s var(--awu-ease);
}

.awu-editGroup[data-open="true"] { border-color: var(--awu-line-strong); }

/* 灵魂字段：金色描边 + 暖光底，一眼看出它和别的组不是一个量级 */
.awu-editGroup[data-soul="true"] {
  border-color: rgba(233, 189, 114, .34);
  background:
    linear-gradient(104deg, rgba(255, 216, 148, .09), rgba(217, 139, 168, .05) 60%, transparent),
    var(--awu-surface-2);
  box-shadow: inset 0 1px 0 rgba(255, 236, 200, .07);
}

.awu-editGroupHead {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--awu-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background .16s var(--awu-ease);
}

.awu-editGroupHead:hover { background: var(--awu-surface-3); }
.awu-editGroupHead:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: -2px; }

.awu-editGroupChevron {
  flex: none;
  display: inline-flex;
  color: var(--awu-ink-faint);
  transition: transform .2s var(--awu-ease);
}

.awu-editGroup[data-open="true"] .awu-editGroupChevron { transform: rotate(90deg); }

.awu-editGroupTitle {
  font-family: var(--awu-serif);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: .06em;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awu-editSoulBadge {
  flex: none;
  padding: 1px 7px;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .1em;
  color: #241a12;
  background: var(--awu-grad);
  box-shadow: 0 1px 6px rgba(233, 163, 124, .3);
}

.awu-editOptional {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--awu-line);
  border-radius: 99px;
  font-size: 9px;
  color: var(--awu-ink-faint);
}

.awu-editGroupCount {
  flex: none;
  margin-left: auto;
  font-family: var(--awu-mono);
  font-size: 9.5px;
  color: var(--awu-ink-faint);
  font-variant-numeric: tabular-nums;
}

.awu-editGroupBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 12px 13px;
  border-top: 1px solid var(--awu-line);
  animation: awu-fade .16s var(--awu-ease);
}

.awu-editGroupHint {
  font-size: 10px;
  line-height: 15px;
  color: var(--awu-ink-faint);
  padding-top: 8px;
}

.awu-editGroupHint[data-soul="true"] { color: var(--awu-gold); opacity: .9; }

/* ---- 字段 ---- */
.awu-editField { display: flex; flex-direction: column; gap: 5px; }

.awu-editFieldKey {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .1em;
  color: var(--awu-ink-mute);
}

.awu-editFieldKind {
  font-style: normal;
  font-family: var(--awu-mono);
  font-size: 8.5px;
  font-weight: 400;
  letter-spacing: 0;
  padding: 0 5px;
  border-radius: 4px;
  color: var(--awu-ink-faint);
  background: var(--awu-surface-3);
}

.awu-editInput {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--awu-sans);
  font-size: 12px;
  letter-spacing: 0;
  line-height: 1.6;
  padding: 7px 10px;
}

.awu-editInput::placeholder { font-size: 11px; }

.awu-editArea {
  resize: vertical;
  min-height: 44px;
  overflow-y: auto;
}

/* ---- 列表编辑器 ---- */
.awu-editList { display: flex; flex-direction: column; gap: 6px; }

.awu-editListEmpty {
  font-size: 10.5px;
  color: var(--awu-ink-faint);
  padding: 2px 0 2px 2px;
}

.awu-editListItem { display: flex; align-items: flex-start; gap: 6px; }

.awu-editListIndex {
  flex: none;
  width: 16px;
  padding-top: 8px;
  font-family: var(--awu-mono);
  font-size: 9px;
  color: var(--awu-ink-faint);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.awu-editListText {
  flex: 1;
  min-width: 0;
  resize: vertical;
  min-height: 32px;
  padding: 6px 9px;
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
  border-radius: 7px;
  background: transparent;
  color: var(--awu-ink-faint);
  cursor: pointer;
  opacity: .55;
  transition: opacity .16s var(--awu-ease), color .16s var(--awu-ease),
    background .16s var(--awu-ease), border-color .16s var(--awu-ease);
}

.awu-editListItem:hover .awu-editListRemove { opacity: 1; }
.awu-editListRemove:hover {
  color: var(--awu-danger);
  background: rgba(226, 121, 107, .12);
  border-color: rgba(226, 121, 107, .3);
}
.awu-editListRemove:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }

.awu-editAdd {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px dashed var(--awu-line-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--awu-ink-mute);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
  transition: color .16s var(--awu-ease), border-color .16s var(--awu-ease),
    background .16s var(--awu-ease);
}

.awu-editAdd:hover {
  color: var(--awu-gold);
  border-color: rgba(233, 189, 114, .5);
  background: rgba(233, 189, 114, .08);
}
.awu-editAdd:focus-visible { outline: 2px solid var(--awu-gold); outline-offset: 1px; }

/* ---- 底部固定操作条 ---- */
.awu-editorFoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 16px 13px;
  border-top: 1px solid var(--awu-line-strong);
  background: rgba(20, 14, 11, .5);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

html:not([data-ds-dark-theme]) .awu-editorFoot { background: rgba(252, 247, 240, .75); }

.awu-editorDirty {
  margin-right: auto;
  font-size: 10px;
  letter-spacing: .05em;
  color: var(--awu-ink-faint);
  transition: color .2s var(--awu-ease);
}

.awu-editorDirty[data-dirty="true"] { color: var(--awu-gold); }
.awu-editorDirty[data-dirty="true"]::before {
  content: "●";
  margin-right: 4px;
  font-size: 7px;
  vertical-align: middle;
}

/* ---- 未保存确认 ---- */
.awu-editorConfirm {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(12, 8, 6, .62);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  border-radius: var(--awu-r-xl);
  animation: awu-fade .16s var(--awu-ease);
}

.awu-editorConfirmCard {
  width: 100%;
  max-width: 320px;
  padding: 16px;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-md);
  background: var(--awu-surface);
  box-shadow: var(--awu-shadow);
}

.awu-editorConfirmTitle {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--awu-serif);
  font-size: 14px;
  letter-spacing: .05em;
  color: var(--awu-ink);
}

.awu-editorConfirmText {
  margin-top: 8px;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--awu-ink-dim);
}

.awu-editorConfirmActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

/* 编辑入口：中性动作，与危险操作明确区分 */
.awu-editEntry {
  border-color: rgba(233, 189, 114, .38);
  color: var(--awu-gold);
}

.awu-editEntry:hover {
  color: var(--awu-gold-hi);
  border-color: rgba(233, 189, 114, .62);
  background: rgba(233, 189, 114, .1);
}

/* ================================================================ 弹层（新建 / 删除确认） */
.awu-scrim {
  position: fixed;
  inset: 0;
  z-index: 2147482100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(12, 8, 6, .56);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  animation: awu-fade .16s var(--awu-ease);
}

.awu-dialog {
  width: min(420px, 100%);
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(255, 216, 148, .1), transparent 60%),
    rgba(30, 22, 18, .97);
  box-shadow: var(--awu-shadow);
  color: var(--awu-ink);
  font-family: var(--awu-sans);
  font-size: 13px;
  overflow: hidden;
  animation: awu-dialog-in .22s var(--awu-ease);
}

html:not([data-ds-dark-theme]) .awu-dialog {
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(233, 189, 114, .18), transparent 60%),
    rgba(246, 239, 229, .99);
}

.awu-dialogHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  font-family: var(--awu-serif);
  font-size: 15px;
  letter-spacing: .05em;
}

.awu-dialogBody { padding: 0 16px 4px; overflow-y: auto; }
.awu-dialogFoot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 15px;
}

.awu-hint { font-size: 11.5px; line-height: 18px; color: var(--awu-ink-mute); }
.awu-hint b { color: var(--awu-ink-dim); font-weight: 500; }

.awu-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 11px;
  border: 1px solid var(--awu-line-strong);
  border-radius: 9px;
  background: rgba(0, 0, 0, .18);
  color: var(--awu-ink);
  font: inherit;
  font-family: var(--awu-serif);
  font-size: 14px;
  letter-spacing: .04em;
  outline: none;
  transition: border-color .18s var(--awu-ease), box-shadow .18s var(--awu-ease);
}

html:not([data-ds-dark-theme]) .awu-input { background: rgba(255, 253, 248, .62); }

.awu-input::placeholder { color: var(--awu-ink-faint); font-family: var(--awu-sans); font-size: 12px; letter-spacing: 0; }

.awu-input:focus {
  border-color: rgba(233, 189, 114, .6);
  box-shadow: 0 0 0 3px rgba(233, 189, 114, .13);
}

.awu-label {
  display: block;
  margin: 10px 0 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--awu-gold);
}

.awu-previewName {
  margin-top: 8px;
  font-family: var(--awu-serif);
  font-size: 12px;
  color: var(--awu-ink-mute);
}

.awu-previewName b { color: var(--awu-ink); font-weight: 600; }

.awu-confirmText {
  font-size: 12px;
  line-height: 19px;
  color: var(--awu-ink-dim);
}

.awu-confirmText b { color: var(--awu-ink); font-family: var(--awu-serif); font-weight: 600; }

.awu-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 11px;
  padding: 9px 11px;
  border: 1px solid var(--awu-line);
  border-radius: 10px;
  background: var(--awu-surface-2);
  cursor: pointer;
  font-size: 11.5px;
  line-height: 17px;
  color: var(--awu-ink-dim);
  transition: border-color .18s var(--awu-ease), background .18s var(--awu-ease);
}

.awu-check:hover { border-color: var(--awu-line-strong); background: var(--awu-surface-3); }
.awu-check input { margin: 2px 0 0; accent-color: var(--awu-rose); cursor: pointer; }

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
  0%, 100% { box-shadow: 0 0 0 1px rgba(233, 189, 114, .1), 0 8px 24px rgba(233, 163, 124, .12); }
  50% { box-shadow: 0 0 0 1px rgba(233, 189, 114, .26), 0 12px 32px rgba(233, 163, 124, .22); }
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

@media (prefers-reduced-motion: reduce) {
  .awu-panel,
  .awu-card,
  .awu-detail,
  .awu-dialog,
  .awu-scrim,
  .awu-skRow,
  .awu-card[data-live="true"],
  .awu-sigil::after,
  .awu-trigger[data-live="true"] .awu-mark::after,
  .awu-avatar[data-live="true"]::after,
  .awu-lamp[data-on="true"],
  .awu-iconBtn[data-spin="true"] svg {
    animation: none !important;
  }
  .awu-card, .awu-trigger, .awu-btn { transition-duration: .01ms !important; }
  .awu-card:hover { transform: none; }
}
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
