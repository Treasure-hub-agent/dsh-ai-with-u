/**
 * AI WITH U · 从作品蒸馏角色卡（v2）的工作台样式
 *
 * 约定（见 docs/design/2026-10-30-integration-contract.md §二）：
 *  - 类名一律 awu-distill-* 前缀，不碰别人的 awu-*；
 *  - 这里只出一个模板串，由 client/styles.ts 的 CSS 模板串末尾拼接注入，不新增 style 标签；
 *  - 颜色/字号/行高/间距只用 --awu-* token。
 *
 * 第 3 批（2026-11-02）收口说明：
 *  1) **删掉了所有 var() 回退值**。旧注释的理由是「弹层 createPortal 到 body，在 token 作用域外」，
 *     这个前提早已失效 —— styles.ts 的变量清单（.awu-scope / .awu-layer / .awu-scrim / .awu-dialog）
 *     从 2026-10-30 起就把弹层根节点纳入了，且弹层元素本身带 .awu-dialog 类。
 *     留下的那套回退色（#8f8172 / #bdae9d / #f6ece0 …）是"夜繭"时代的象牙色，被玻璃化淘汰，
 *     一旦哪个 token 改名就会静默把整块 UI 拉回旧皮肤 —— 这类"第二份真相"必须删。
 *  2) 几何（宽度 / 圆角 / 最大高度 / 颜色 / 字体）不再自定：全部继承 .awu-dialog
 *     （宽度走 --awu-dialog-w=620、圆角走 --awu-radius-sheet=24）。所以 .awu-distill-dialog
 *     在 CSS 里已没有规则，它只是 JSX 侧的一个标记位，留着无害。
 *  3) 删掉了随「粘贴校验」一起挂起的四组死样式（分隔线 / 进度条 / 分组徽标 / 定名行）
 *     与没人用的 .awu-distill-sendRow —— 在 JSX 里引用数为 0。
 *
 * ⚠️ 本文件整个是一个 JS 模板串：注释里不要出现反引号和美元符号加大括号。
 */

export const DISTILL_CSS = `
/* ================================================================ 蒸馏（v2） */

/* ---- 角色簿顶部的蒸馏主入口 ----
   尺寸 / 配色一律交给 data-kind="primary" 与宿主 token，不写死宽高；
   只用 flex 排版，宽度随容器走（内联在工具行里=内容宽，独占一块=撑满）。 */
.awu-distill-entry {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-3);
  min-width: 0;
}

.awu-distill-entry .awu-distill-cta { width: 100%; }

.awu-distill-cta {
  justify-content: center;
  gap: var(--awu-gap-3);
  min-width: 0;
}

.awu-distill-entryHint {
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-px-18);
  text-align: center;
  color: var(--awu-ink-mute);
}

/* ---- 第二步的状态条（已发送 / 只填入 / 失败）----
   v3 全自动之后弹层只剩两步：确认 → 已发送，所以这一步的反馈要够清楚，
   但又不能抢主按钮。用 surface + tone 表达，底色不写死。 */
.awu-distill-status {
  margin: var(--awu-gap-1) 0 var(--awu-gap-4);
  padding: var(--awu-gap-5) var(--awu-gap-6);
  border: 1px solid var(--awu-line);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-dim);
}

.awu-distill-status[data-tone="ok"] {
  border-color: var(--awu-line-strong);
  color: var(--awu-teal);
}
.awu-distill-status[data-tone="warn"] { color: var(--awu-gold); }
.awu-distill-status[data-tone="danger"] { color: var(--awu-danger); }

.awu-distill-close { margin-left: auto; }

/* ---- 说明区 ---- */
.awu-distill-why {
  margin: 0 0 var(--awu-gap-5);
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-mute);
}

.awu-distill-steps {
  display: flex;
  flex-direction: column;
  gap: var(--awu-gap-3);
  margin: 0 0 var(--awu-gap-6);
  padding: 0;
  list-style: none;
}

.awu-distill-steps li {
  display: flex;
  gap: var(--awu-gap-3);
  align-items: flex-start;
  font-size: var(--awu-fs-caption);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-dim);
}

.awu-distill-num {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-pill);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  color: var(--awu-gold);
}

/* ---- 提示条：ok / warn / danger 三档 ---- */
.awu-distill-warn {
  margin: var(--awu-gap-3) 0 0;
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-mute);
}
.awu-distill-warn[data-tone="ok"] { color: var(--awu-teal); }
.awu-distill-warn[data-tone="warn"] { color: var(--awu-gold); }
.awu-distill-warn[data-tone="danger"] { color: var(--awu-danger); }

/* ---- 粘贴框（也用于「手动兜底」的只读指令）---- */
.awu-distill-paste {
  display: block;
  width: 100%;
  min-height: 104px;
  max-height: 200px;
  box-sizing: border-box;
  margin-top: var(--awu-gap-1);
  padding: var(--awu-gap-4) var(--awu-gap-6);
  resize: vertical;
  border: 1px solid var(--awu-line-strong);
  border-radius: var(--awu-r-sm);
  background: var(--awu-surface-2);
  color: var(--awu-ink);
  font-family: var(--awu-mono);
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-px-18);
  outline: none;
}

.awu-distill-paste::placeholder {
  font-family: var(--awu-sans);
  font-size: var(--awu-fs-caption);
  color: var(--awu-ink-mute);
}

.awu-distill-paste:focus { border-color: var(--awu-gold); }

.awu-distill-hint {
  margin-top: var(--awu-gap-6);
  font-size: var(--awu-fs-micro);
  line-height: var(--awu-lh-px-18);
  color: var(--awu-ink-mute);
}
`
