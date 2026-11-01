/**
 * AI WITH U · 使用指南板块样式
 *
 * 独立文件，由 client/styles.ts 把 GUIDE_CSS 拼进那唯一一份 style（集成契约 §二），
 * 不新增第二个 style 标签、不改卸载逻辑、也不碰任何既有的 awu-* 规则。
 *
 * 约定：类名一律 awu-guide-* 前缀；颜色 / 字号 / 行高 / 间距只走 --awu-* token。
 *
 * 第 3 批（2026-11-02）收口：
 *  - 阅读宽 680 → **760 居中**（与详情页/编辑器正文同一个 --awu-content-max，四个 tab 的正文列对齐）；
 *  - 正文 13/22 → **14/23**：13px 在 1120 大窗里偏小，且与字段值（14）不同档，切 tab 时字号会"跳一下"；
 *  - 14 处写死的 font-size 全部并进 --awu-fs-*（子视图字号字面量归零）；
 *  - 行高统一走整数阶梯 --awu-lh-px-18/20/22/23（中文正文按整数像素落位，避免 2x 屏上半像素发虚）。
 *
 * ⚠️ 本段是 JS 模板串的一部分：注释与规则里禁止出现反引号和美元符号加大括号，
 *    出现的话模板会被从中间截断，整个模块初始化即抛错（2026-10-30 的真实事故）。
 */

export const GUIDE_CSS = `
/* ================================================================ 使用指南（面板第 4 个 tab） */

.awu-guide {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-8);
  padding-bottom: var(--awu-gap-1);
  /* 阅读宽度：760 = --awu-content-max（详情页/编辑器正文同宽），并居中 ——
     左侧栏 336 + 右栏正文列居中是这套两栏骨架的阅读节奏，指南不该比详情页窄一截。 */
  max-width: var(--awu-content-max);
  margin: 0 auto;
}

.awu-guide-sec { display: flex; flex-direction: column; gap: var(--awu-gap-4); }

/* 分节标题：沿用面板 .awu-sectionHead 的「金色小标 + 细线」，但不带卡片边框，省掉两层内边距 */
.awu-guide-h {
  display: flex;
  align-items: center;
  gap: var(--awu-gap-4);
  margin: 0;
  /* 分节标题要比正文"更硬"但不更大：caption 字号 + 600 + 字距 + 金色，
     正文 14px 常规。旧版 11px 会让层级反过来（正文比标题大）。 */
  font-size: var(--awu-fs-caption);
  font-weight: 600;
  line-height: var(--awu-lh-px-18);
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--awu-gold);
  opacity: .95;
}

.awu-guide-h::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--awu-line-strong), transparent);
}

.awu-guide-body { display: flex; flex-direction: column; gap: var(--awu-gap-4); }

/* 步骤与「标签 + 说明」两种行：同一套 flex 骨架，标签不参与换行 */
.awu-guide-step,
.awu-guide-keyed {
  display: flex;
  align-items: baseline;
  gap: var(--awu-gap-4);
}

.awu-guide-num {
  flex: none;
  width: 16px;
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-px-23);
  color: var(--awu-gold);
}

/* 正文：14px / 23px。这是整个面板的正文基准（与 .awu-fieldVal 同档），别再往下压。 */
.awu-guide-line {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  color: var(--awu-ink-dim);
}

.awu-guide-line[data-mono="true"] {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-20);
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-ico {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--awu-gold);
  opacity: .8;
}

.awu-guide-key {
  flex: none;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  font-weight: 500;
  color: var(--awu-ink-mute);
}

.awu-guide-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  color: var(--awu-ink-dim);
}

/* 置顶提示：比正文高一级的信息块。背景走 token（深色态下是同色系更暗的一档），不做硬编码。 */
.awu-guide-alert {
  display: flex;
  gap: var(--awu-gap-6);
  align-items: flex-start;
  padding: var(--awu-gap-6) var(--awu-gap-7);
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-lg);
  background: color-mix(in srgb, var(--awu-gold) 10%, transparent);
}

.awu-guide-alertMark {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: var(--awu-fs-label);
  font-weight: 700;
  /* 这个字的底色是 --awu-gold，而 gold 在深浅两态是一亮一暗（深色 #e8c07a / 浅色 #8a5f1e），
     所以字色必须反向：--awu-surface-opaque 正好是"深色态近黑 / 浅色态近白"的那一档。
     不要换成 --awu-on-character（两态都是深棕，浅色金底上会糊成一片）。 */
  color: var(--awu-surface-opaque);
  background: var(--awu-gold);
}

.awu-guide-alertBody { display: flex; flex-direction: column; gap: var(--awu-gap-2); min-width: 0; }

.awu-guide-alertTitle {
  font-size: var(--awu-fs-body);
  font-weight: 600;
  line-height: var(--awu-lh-px-20);
  color: var(--awu-ink);
}

.awu-guide-alertText {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  color: var(--awu-ink-dim);
}

/* 小注：比正文低一级，但仍用 ink-mute —— ink-faint 是线条专用，12px 上会看不清 */
.awu-guide-note {
  padding-left: var(--awu-gap-9);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-20);
  color: var(--awu-ink-mute);
}

/* 数据路径块：浅底 + 等宽字，和「统计」页的存放位置是同一种读法 */
.awu-guide-path {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-2);
  padding: var(--awu-gap-5) var(--awu-gap-6);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
}

.awu-guide-pathLine {
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-20);
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-pathHint {
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-20);
  color: var(--awu-ink-mute);
  word-break: break-word;
}

/* 常见疑问：问在上答在下，问答对之间比行距再松一点 */
.awu-guide-faq { display: flex; flex-direction: column; gap: var(--awu-gap-1); }
.awu-guide-faq + .awu-guide-faq { margin-top: var(--awu-gap-3); }

.awu-guide-q {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-20);
  font-weight: 600;
  color: var(--awu-ink-dim);
}

.awu-guide-a {
  font-size: var(--awu-fs-body);
  line-height: var(--awu-lh-px-23);
  color: var(--awu-ink-mute);
}
`
