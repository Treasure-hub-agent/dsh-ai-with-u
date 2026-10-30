/**
 * AI WITH U · 使用指南板块样式
 *
 * 独立文件，由 `client/styles.ts` 把 `GUIDE_CSS` 拼进那唯一一份 <style>（集成契约 §二），
 * 不新增第二个 style 标签、不改卸载逻辑、也不碰任何既有的 `.awu-*` 规则。
 *
 * 约定：类名一律 `awu-guide-*` 前缀；颜色只走 `--awu-*` token，一个写死的色值都没有。
 *
 * ⚠️ 这段字符串是 JS 模板串的一部分：注释与规则里禁止出现反引号和美元符号加大括号，
 *    出现的话模板会被从中间截断，整个模块初始化即抛错（2026-10-30 的事故）。
 *
 * 2026-10-30 主人口径：「指南里的内容字体可以大一些，现在太小了」。
 * 旧版正文 11.5px / 行高 18px 偏小，现统一到正文 13px / 行高 22px（≈1.7），
 * 次级文字（小注、路径提示）12px / 19-20px，分节标题 11px 只作标记。
 */
export const GUIDE_CSS = `
/* ================================================================ 使用指南（面板第 4 个 tab） */

.awu-guide {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 2px;
  /* 阅读宽度：13px 中文正文一行 50 多字太累眼，收到 680px（约 34 字/行） */
  max-width: 680px;
}

.awu-guide-sec { display: flex; flex-direction: column; gap: 9px; }

/* 分节标题：沿用面板 .awu-sectionHead 的「金色小标 + 细线」，但不带卡片边框，省掉两层内边距 */
.awu-guide-h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  /* 分节标题必须大于正文的「视觉重量」：12px 加粗 + 金色，正文 13px 常规，
     旧版 11px 会让层级反过来（正文比标题大），读起来就乱。 */
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
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

.awu-guide-body { display: flex; flex-direction: column; gap: 8px; }

/* 步骤与「标签 + 说明」两种行：同一套 flex 骨架，标签不参与换行 */
.awu-guide-step,
.awu-guide-keyed {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.awu-guide-num {
  flex: none;
  width: 16px;
  font-family: var(--awu-mono);
  font-size: 11px;
  line-height: 22px;
  color: var(--awu-gold);
}

/* 正文：13px / 22px（≈1.7 行高）。这是整个面板的正文基准，别再往下压。 */
.awu-guide-line {
  font-size: 13px;
  line-height: 22px;
  color: var(--awu-ink-dim);
}

.awu-guide-line[data-mono="true"] {
  font-family: var(--awu-mono);
  font-size: 12px;
  line-height: 20px;
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
  font-size: 13px;
  line-height: 22px;
  font-weight: 500;
  color: var(--awu-ink-mute);
}

.awu-guide-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--awu-ink-dim);
}

/* 小注：比正文低一级，但仍用 ink-mute —— ink-faint 是线条专用，12px 上会看不清 */
.awu-guide-note {
  padding-left: 24px;
  font-size: 12px;
  line-height: 20px;
  color: var(--awu-ink-mute);
}

/* 数据路径块：浅底 + 等宽字，和「统计」页的存放位置是同一种读法 */
.awu-guide-path {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
}

.awu-guide-pathLine {
  font-family: var(--awu-mono);
  font-size: 12px;
  line-height: 19px;
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-pathHint {
  font-size: 12px;
  line-height: 19px;
  color: var(--awu-ink-mute);
  word-break: break-word;
}

/* 常见疑问：问在上答在下，问答对之间比行距再松一点 */
.awu-guide-faq { display: flex; flex-direction: column; gap: 3px; }
.awu-guide-faq + .awu-guide-faq { margin-top: 6px; }

.awu-guide-q {
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
  color: var(--awu-ink-dim);
}

.awu-guide-a {
  font-size: 13px;
  line-height: 21px;
  color: var(--awu-ink-mute);
}
`
