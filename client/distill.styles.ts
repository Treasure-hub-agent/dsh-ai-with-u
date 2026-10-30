/**
 * AI WITH U · 从作品蒸馏角色卡（v2）的工作台样式
 *
 * 约定（见 `docs/design/2026-10-30-integration-contract.md` §二）：
 *  - 类名一律 `awu-distill-*`，不碰别人的 `awu-*`；
 *  - 这里只出一个模板串，由 `client/styles.ts` 的 CSS 模板串末尾拼接注入，**不新增 `<style>` 标签**；
 *  - 颜色只用 `--awu-*` token。
 *
 * ⚠️ 为什么每个 token 都写成 `var(--token, 回退值)`：
 * 本弹层用 `createPortal` 挂到 `document.body`，而 `--awu-*` 只定义在 `.awu-scope` / `.awu-layer`
 * 两个作用域上（`styles.ts:36-37`），**弹层在作用域外**，变量取不到就是无效声明。
 * 带上回退值后，无论将来 styles.ts 是否把弹层纳入 token 作用域，这里都不会塌。
 * 同理，宽度 / 圆角 / 最大高度都在 `.awu-distill-dialog` 上显式兜一遍。
 */

export const DISTILL_CSS = `
/* ================================================================ 蒸馏（v2） */

/* ---- 角色簿顶部的蒸馏主入口（2026-10-30 视觉反馈后重做）----
   主人反馈：「'蒸馏'按钮在面板上有些小了不明显」。所以：
     - 尺寸 / 配色一律交给 data-kind="primary" 与宿主 token，**不写死宽高**；
     - 面板从 452px 改成 720px 大窗、换液态玻璃视觉时，这里一个字都不用动；
     - 只用 flex 排版，宽度随容器走（内联在工具行里=内容宽，独占一块=撑满）。
   注意：本文件整个是一个 JS 模板串，注释里不要出现反引号。 */
.awu-distill-entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.awu-distill-entry .awu-distill-cta {
  width: 100%;
}
.awu-distill-cta {
  justify-content: center;
  gap: 6px;
  min-width: 0;
}
.awu-distill-entryHint {
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  color: var(--awu-ink-mute, #8f8172);
}

.awu-distill-dialog {
  width: min(var(--awu-dialog-w, 420px), 100%);
  max-height: min(84vh, var(--awu-dialog-max-h, 660px));
  border-radius: var(--awu-r-lg, 16px);
  color: var(--awu-ink, #f6ece0);
  font-family: var(--awu-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
}

.awu-distill-close { margin-left: auto; }

/* ---- 说明区 ---- */
.awu-distill-why {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 17px;
  color: var(--awu-ink-mute, #8f8172);
}

.awu-distill-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.awu-distill-steps li {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  font-size: 11.5px;
  line-height: 17px;
  color: var(--awu-ink-dim, #bdae9d);
}
.awu-distill-num {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border: 1px solid var(--awu-line-strong, rgba(244, 208, 160, .22));
  border-radius: 50%;
  font-family: var(--awu-mono, ui-monospace, monospace);
  font-size: 9.5px;
  color: var(--awu-gold, #e9bd72);
}

/* ---- 发送 / 校验按钮行 ---- */
.awu-distill-sendRow {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 10px 0 2px;
}

/* ---- 提示条：ok / warn / danger 三档 ---- */
.awu-distill-warn {
  margin: 6px 0 0;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--awu-ink-mute, #8f8172);
}
.awu-distill-warn[data-tone="ok"] { color: var(--awu-teal, #86c9bd); }
.awu-distill-warn[data-tone="warn"] { color: var(--awu-gold, #e9bd72); }
.awu-distill-warn[data-tone="danger"] { color: var(--awu-danger, #e2796b); }

/* ---- 粘贴框（也用于「手动兜底」的只读指令）---- */
.awu-distill-paste {
  display: block;
  width: 100%;
  min-height: 104px;
  max-height: 200px;
  box-sizing: border-box;
  margin-top: 2px;
  padding: 8px 11px;
  resize: vertical;
  border: 1px solid var(--awu-line-strong, rgba(244, 208, 160, .22));
  border-radius: var(--awu-r-sm, 8px);
  background: var(--awu-surface-2, rgba(255, 226, 190, .035));
  color: var(--awu-ink, #f6ece0);
  font-family: var(--awu-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
  outline: none;
}
.awu-distill-paste::placeholder {
  font-family: var(--awu-sans, system-ui, sans-serif);
  font-size: 11.5px;
  color: var(--awu-ink-mute, #8f8172);
}
.awu-distill-paste:focus { border-color: var(--awu-gold, #e9bd72); }

/* ---- ⏸ 以下三组（分隔线 / 校验进度条 / 分组徽标 / 定名行）随「粘贴校验」一起挂起：
   卡片格式改酒馆卡 CCv3，POST /distill/parse 与 34 字段校验等 tavern 定稿后重做。
   样式先留着，等校验 UI 回来直接接上；在那之前 TSX 不会渲染这几个类（无副作用）。
   注意：本文件整个是一个 JS 模板串，注释里不要出现反引号。 ---- */
.awu-distill-sep {
  height: 1px;
  margin: 14px 0 10px;
  background: var(--awu-line, rgba(244, 208, 160, .11));
}

.awu-distill-meter {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 10px 0 6px;
  font-family: var(--awu-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--awu-ink-dim, #bdae9d);
}
.awu-distill-bar {
  flex: 1 1 auto;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--awu-surface-3, rgba(255, 226, 190, .065));
}
.awu-distill-bar > span {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--awu-grad, linear-gradient(118deg, #ffd894 0%, #e9a37c 46%, #d98ba8 100%));
  transition: width .26s var(--awu-ease, cubic-bezier(.22, .61, .36, 1));
}

.awu-distill-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0 8px;
}
.awu-distill-tag {
  padding: 1px 6px;
  border: 1px solid var(--awu-line, rgba(244, 208, 160, .11));
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 15px;
  color: var(--awu-ink-mute, #8f8172);
}
.awu-distill-tag[data-missing="true"] {
  border-color: var(--awu-line-strong, rgba(244, 208, 160, .22));
  color: var(--awu-danger, #e2796b);
}

/* ---- 定名行 ---- */
.awu-distill-nameRow {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.awu-distill-nameRow .awu-input { flex: 1 1 auto; }

.awu-distill-hint {
  margin-top: 12px;
  font-size: 10px;
  line-height: 15px;
  color: var(--awu-ink-mute, #8f8172);
}

/* ================================================================ 输入框上方的小入口
   这一块渲染在宿主的 composer 里，**完全在 .awu-scope 之外**，拿不到任何 --awu-* token，
   所以只用 currentColor + 透明度，让宿主主题自己决定颜色（不写死色值）。 */
.awu-distill-dock {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.awu-distill-dockBtn {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 2px 9px;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  opacity: .58;
  cursor: pointer;
  transition: opacity .18s cubic-bezier(.22, .61, .36, 1);
}
.awu-distill-dockBtn:hover { opacity: .95; }
.awu-distill-dockBtn:disabled { opacity: .3; cursor: default; }
.awu-distill-dockNote {
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  line-height: 15px;
  opacity: .72;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .awu-distill-bar > span { transition: none !important; }
  .awu-distill-dockBtn { transition: none !important; }
}
`
