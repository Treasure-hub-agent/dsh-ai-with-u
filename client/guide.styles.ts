/**
 * AI WITH U · 使用指南板块样式
 *
 * 独立文件，由 `client/styles.ts` 把 `GUIDE_CSS` 拼进那唯一一份 <style>（集成契约 §二），
 * 不新增第二个 style 标签、不改卸载逻辑、也不碰任何既有的 `.awu-*` 规则。
 *
 * 约定：类名一律 `awu-guide-*` 前缀；颜色只走 `--awu-*` token，一个写死的色值都没有；
 * 字号不低于 11px（序号 / 分节标题这类「标记」按现有面板口径用 10px）。
 */
export const GUIDE_CSS = `
/* ================================================================ 使用指南（面板第 4 个 tab） */

.awu-guide {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 2px;
}

.awu-guide-sec { display: flex; flex-direction: column; gap: 7px; }

/* 分节标题：沿用面板 .awu-sectionHead 的「金色小标 + 细线」，但不带卡片边框，省掉两层内边距 */
.awu-guide-h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--awu-gold);
  opacity: .9;
}

.awu-guide-h::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--awu-line-strong), transparent);
}

.awu-guide-body { display: flex; flex-direction: column; gap: 6px; }

/* 步骤与「标签 + 说明」两种行：同一套 flex 骨架，标签不参与换行 */
.awu-guide-step,
.awu-guide-keyed {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.awu-guide-num {
  flex: none;
  width: 13px;
  font-family: var(--awu-mono);
  font-size: 10px;
  line-height: 18px;
  color: var(--awu-gold);
}

/* 正文：11.5px / 18px，与 .awu-line、.awu-field 同一档（这套面板的正文基准） */
.awu-guide-line {
  font-size: 11.5px;
  line-height: 18px;
  color: var(--awu-ink-dim);
}

.awu-guide-line[data-mono="true"] {
  font-family: var(--awu-mono);
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-ico {
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--awu-gold);
  opacity: .7;
}

.awu-guide-key {
  flex: none;
  font-size: 11.5px;
  line-height: 18px;
  font-weight: 500;
  color: var(--awu-ink-mute);
}

.awu-guide-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--awu-ink-dim);
}

/* 小注：跟正文同一档字号（11px），靠淡一档的墨色退到次要层 */
.awu-guide-note {
  padding-left: 20px;
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-faint);
}

/* 数据路径块：浅底 + 等宽字，和「统计」页的存放位置是同一种读法 */
.awu-guide-path {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
}

.awu-guide-pathLine {
  font-family: var(--awu-mono);
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute);
  word-break: break-all;
}

.awu-guide-pathHint {
  font-size: 11px;
  line-height: 16px;
  color: var(--awu-ink-faint);
  word-break: break-word;
}

/* 常见疑问：问在上答在下，问答对之间比行距再松一点 */
.awu-guide-faq { display: flex; flex-direction: column; gap: 2px; }
.awu-guide-faq + .awu-guide-faq { margin-top: 4px; }

.awu-guide-q {
  font-size: 11.5px;
  line-height: 17px;
  font-weight: 500;
  color: var(--awu-ink-dim);
}

.awu-guide-a {
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute);
}
`
