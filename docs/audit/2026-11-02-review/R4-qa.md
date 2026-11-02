# R4 自检/取证基建可信度审查（只读）

- 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u` @ `98e2b06`
- 审查员：reviewer-qa（只读）。未改 `client/**`、`tools/**`、`scripts/**`，未跑 `npm run build`。
- 手段：静态读 + **构造反例**（全部在 `D:\CODEX\deepseek-work\06-tmp\qa-r4\` 下做副本注入，仓库原文件零改动）
  + 实跑 `verify-ui`（7/7）、`verify-a11y`（8/8）、`shots.mjs`（20 场景全跑）、`crash.mjs`、`states.mjs`、`collapse.mjs` + 自写 CDP 探针。
- 背景已读：`03-reference/dsh-dev-kb/02-踩坑清单.md` #39、`09-UI取证工具链.md` 全文。

## 总判

- **静态护栏（verify-ui 7 条 / verify-a11y 8 条）是真的**：15 条全部构造出违规样本并按预期变红（见 §3）；但存在 6 处「漏检形态」和 2 处「误报形态」。
- **`?crash` 探针的脆弱性：会红，已实测**。把探针改成「不再抛错」（模拟 `useWideLayout` 改实现）→ `crash.mjs` **5 红 / exit 1**。
  但 `crash.mjs` **不能归因**：换一个「别的 bug 把面板崩掉 + 探针完全没触发」的沙盒 → **10/10 全绿 / exit 0**。
- **截图矩阵不是断言**：`shots.mjs` 没有任何失败通道。服务没起 / bundle 编译失败 / 步骤点了不存在的元素，三种情况都**照打 ✓、照写 index.md、exit 0**（实测，见 §1）。
- **fixture 与真实契约已漂移**：`/overview` 少 5 个字段、`/character` 少 `binding` 与 `relation.current/log`、`/preview` 少 `preset`。
  直接后果：矩阵里“当前会话绑定”永远显示降级文案（截图可证），**会话绑定/预设摘要/纪律档位这些界面零覆盖**。
- `states.mjs` 的第 ③ 条断言测的是 fixture 自己写的“500”，不是 UI 行为（构造同一信封、文案不含 500 → 该条变红，UI 却完全正确）。

| 编号 | 位置 | 一句话 | P | 实测 |
|---|---|---|---|---|
| R4-Q1 | `tools/qa/shots.mjs:155-183,209` + `tools/qa/index.md:29` | 截图矩阵没有失败通道：导航失败/打包失败/空画面都 exit 0，与「退出码 0 = 全过」矛盾 | P0 | ✅ |
| R4-Q2 | `tools/qa/shots.mjs:47-54,168-174` | 步骤 `?.click()` 吞 null、步骤结果不校验：点不存在的元素仍 ✓，截图只剩壁纸 | P1 | ✅ |
| R4-Q3 | `tools/qa/crash.mjs:64-92` + `tools/preview/preview.tsx:169` | 崩溃不可归因：任何别的崩溃都让 10 条断言全绿，探针是否真触发零断言 | P1 | ✅ |
| R4-Q4 | `tools/qa/states.mjs:104` + `client/api.ts:146-150` + `src/web.ts:191-198` | 「错误文案里带上了 HTTP 状态」是假断言：宿主无 500 路径，client 也不补状态码 | P1 | ✅ |
| R4-Q5 | `tools/preview/fixtures.json`（`overview/liveOverview/character/preview/opening`） | fixture 契约漂移 → 绑定/预设/纪律三块界面在矩阵里永远走降级分支 | P1 | ✅（图证） |
| R4-Q6 | `tools/qa/states.mjs:68-77,97` | ErrorBar 的「重试」按钮只采集不断言；② 固定 sleep 余量实测仅 ~0.4s | P2 | ✅ |
| R4-Q7 | `tools/qa/collapse.mjs:153-165` | `closing` 事件不按目标 class 过滤（`removed` 过滤了）→ 可被别的元素满足 | P2 | 静态（当前实测全为同节点） |
| R4-Q8 | `scripts/verify-ui.mjs:46-56` | 模板串边界靠「独占一行的收尾反引号」：收尾行带行尾注释 → 退化成扫整文件 → 误报红 | P2 | ✅ |
| R4-Q9 | `scripts/verify-ui.mjs:169-171` | #7 不剥 JS 行注释（注释里的 `Math.min(index,12)*CARD_STAGGER` 误报红）；乘数写成字面量 `* 40` 则漏检 | P2 | ✅ |
| R4-Q10 | `scripts/verify-a11y.mjs:139-157` | 图标按钮启发式：体内有 `props.` 就跳过 → 裸图标按钮漏检；`onPointerDown` 类可点击 div 不查；`{err}`/`{error.message}` 漏 | P2 | ✅ |
| R4-Q11 | `scripts/verify-a11y.mjs:74,101` | 只剥块注释 → `// t('不存在键')` 误报红；`<div onClick>` 写在字符串里也误报红 | P2 | ✅ |
| R4-Q12 | `scripts/verify-a11y.mjs:392-399` | ⑦ 只认 `outline:` 简写，`outline-color:#f00` 漏检 | P2 | ✅ |
| R4-Q13 | `scripts/verify-ui.mjs:58` / `scripts/verify-a11y.mjs:68` | 样式文件白名单硬编码 3 个：新增 `client/*.styles.ts` 两个脚本都看不见 | P2 | ✅ |
| R4-Q14 | `scripts/verify-ui.mjs:69` | 插值白名单三文件共用（`GUIDE_CSS`/`DISTILL_CSS` 在 styles.ts 的允许集里，跨文件放行） | P2 | 静态 |
| R4-Q15 | `tools/qa/crash.mjs:91` | 断言文案「没有白屏/半挂」实际断言 `panelMounted===false`，`bodyHeight` 只进 detail | P2 | ✅ |
| R4-Q16 | `tools/qa/shots.mjs:29` + `tools/qa/index.md:68` | 默认产物落在**仓库内** `06-tmp/ui-audit`（文档写成“仓库外”），且 `.gitignore` 没有 `06-tmp/` | P2 | ✅ |
| R4-Q17 | `tools/qa/cdp.mjs:26-40` / `shots.mjs:213-231` / `serve.mjs:34` | 换机不可复现：findChrome 只有 Windows 路径；端口固定；不校验 59621 上是不是本仓库的沙盒 | P2 | ✅ |
| R4-Q18 | `package.json:78` + `.github/workflows/publish-github-packages.yml` | 10 个 verify 脚本都接上了（无漏接），但 4 个 QA 脚本不进 build/CI，也没有 `npm run qa` 入口 | P2 | 静态 |
| R4-Q19 | `tools/preview/preview.tsx:79` | `?slow=` 被 `Math.min(10000, …)` 截断：场景注释写 `?slow=30000`，实际 10s | P2 | 静态 |
| R4-Q20 | 任务书/`shots.mjs` | 场景数 20（7+4+4+5），不是「21 场景」；`--only=light-roster` 会连带匹配 `light-roster-empty` | P2 | ✅ |

---

## 1. R4-Q1 / Q2 截图矩阵没有断言，失败也全绿（P0）

**文件:行**：`tools/qa/shots.mjs:155-166`（导航校验）、`:168-174`（步骤求值）、`:176-183`（截图+✓ 日志）、`:209`（写 index.md）；
`tools/qa/index.md:29`「所有脚本都支持 `--out=<目录>` 改产物落点，**退出码 0 = 全过**」；`tools/qa/index.md:3-4`「只读源码 / 驱动 headless Chromium」。

- **现象**：
  1. 导航失败只 `console.error("… 这张图不可信")`，**不进入任何失败状态**；脚本结尾没有基于失败数的 `process.exit(1)`。
  2. 步骤用 `?.click()`（`:47-54` 的 `OPEN`/`clickText`/`tabOf`），元素不存在时静默；`:169-172` 只在 eval **抛异常**时报错，而 `?.click()` 永不抛。
  3. **没有任何空白图 / “画面里没有面板”的检测**：没有像素统计、没有 `#root.childElementCount`、没有关键选择器断言。
  4. 文件头注释说“校验 `location.href`，不合预期就大声报”——实际只是 stderr 一行，退出码与产物照旧；KB `09` §4⑦ 的“这张图不可信”在脚本层没有执行机制。
- **构造的反例（三种，全部落在 `06-tmp/qa-r4/`）**：
  - **A. 服务没起**：`node tools/qa/shots.mjs --only=light-diary --port=59999 --out=…/blank`
    → stderr `! light-diary 导航失败（停在 chrome-error://chromewebdata/）—— 这张图不可信`，紧接着 `✓ light-diary … (1 张，+13284ms)`，写出 23,452 B 的错误页 PNG + `index.md`，**EXIT=0**。
  - **B. client 有语法错误 / 打包失败**（沙盒副本 `broken`，`/bundle.js` 返回 500）：
    → **一条警告都没有**，`✓ light-diary (1 张，+3236ms)`，626,855 B 的图（只有壁纸、面板根空），**EXIT=0**。注意此时 `location.href` 是对的，所以连 A 那行 stderr 都没有。
  - **C. 步骤点不存在的元素**（副本 `shots-noop-step.mjs`，把 `light-stats` 的 steps 换成 `document.querySelector('#no-such-tab')?.click()`）：
    → `✓ light-stats … (1 张，+3330ms)`，848,428 B 的纯壁纸图，**EXIT=0**；同批真 `light-stats-renamed` 是 576,038 B。两张图并存时，除了肉眼看，脚本层面无法区分。
- **为什么是假绿**：矩阵是本次验收的**主证据**（`06-tmp/ui-audit/matrix` 20 张）。只要“截图 + ✓”出现，阅读报告的人会认为 20 个场景都渲染到了；而脚本对“渲染到了没有”零断言，退出码也恒 0。KB `09` §4⑦ 的空白假截图风险，脚本只做了一半（href 检查）且不阻断。
- **建议**：
  - 每个场景加 `expect`（进入该状态必须存在的选择器/文本，如 `light-roster → .awu-detail`），截图前 assert；失败计入 failures。
  - 结算：`failures.length > 0 → process.exit(1)`，并把失败场景写进 `index.md` 顶部（红行）。
  - 图片层兜底：截图后统计 PNG 尺寸/字节下限或抽样像素方差（纯壁纸/纯白直接判失败）；至少断言 `document.querySelector('#root').children.length > 0`。
  - `location.href` 不匹配时放进 failures，而不是 stderr。

## 2. R4-Q3 崩溃探针：**会红**，但崩溃不可归因（P1）

**文件:行**：`tools/qa/crash.mjs:64-71,90-92`；`tools/preview/preview.tsx:169`（marker 无条件打）。

- **先回答关键问题：`useWideLayout` 改成不再抛错，断言真的会红吗？——会。**
  构造副本 `06-tmp/qa-r4/noop`（只把 `installCrashProbe` 的 `throw` 换成注释，`html[data-awu-crash-probe]` 仍然照打），用真脚本跑：
  ```
  ✗ 降级 UI 出现且有「重试」按钮：bodyText="角色管理\n未启用角色"
  ✗ 面板子树已被卸载（没有 .awu-trigger）：layerFound=true
  ✗ componentDidCatch 留下了上下文日志：没抓到 "面板渲染失败"
  ✗ 点重试后仍显示降级 UI …
  ✗ 点重试后没有白屏/半挂：bodyHeight=760
  崩溃探针验收未通过：通过 5 项，失败 5 项。   EXIT=1
  ```
  所以“探针静默失效”这一条**当前是被守住的**（依赖的是“面板正常挂载”这个相反事实）。
- **但探针是否真的触发，零断言**：`marker` 只证明 URL 进的是崩溃场景分支（`preview.tsx:169` 与抛错无关）。
  构造副本 `06-tmp/qa-r4/other`：探针保持不抛（同 noop），另把 fixture 的 `overview.stats` 设成 `null` → 面板在 `statTriple` 里因**别的 TypeError** 崩掉。结果：
  ```
  ✓ … ✓ 崩溃探针验收通过：通过 10 项，失败 0 项。  EXIT=0
  ```
  （`probeShimInstalled=false`，探针从未抛过。）也就是说：**任何其他渲染 bug 崩掉面板，这条用例都会绿**，而报告会写“崩溃探针通过”。
- **可用的修复证据（已实测可归因）**：探针的错误会出现在 `consoleErrors` 里。
  - 真沙盒：`consoleErrors` 含 `Error: crash probe：?crash=1 让 .awu-layer 的 getBoundingClientRect 抛错` + `[ai-with-u] 面板渲染失败…`；
  - noop：0 条；other：只有 `TypeError: Cannot read properties of null (reading 'characters')`。
  所以加一条 `r.check(page.consoleErrors.some(t => t.includes('crash probe')), '探针确实触发（崩溃归因）')` 即可：真沙盒绿、另两种红。
- **建议**：① 加“探针真的抛了”的断言（consoleErrors 匹配 / `window.__crashProbeHits` 计数）；② `marker` 保留但别当证据；③ 顺带把 `:91` 的文案改准（见 R4-Q15）。

## 3. R4-Q4 `states.mjs` 第 ③ 条是 fixture 自证（P1）

**文件:行**：`tools/qa/states.mjs:104`；`client/api.ts:146-150`；`src/web.ts:191-198`（`guard` 一律 400，全仓 grep 不到 `send(res, 500`）；`tools/preview/preview.tsx:149`。

- **现象**：断言「③ 错误文案里带上了 HTTP 状态」用 `fail.errText.includes('500')`。这个 “500” 来自 fixture 自己拼的文案 `沙盒注入的失败：/presets 返回 500（URL 上带了 ?fail=）`；
  client 的真实逻辑是：`envelope.ok !== true` 时 `message = envelope.error`（非空就直接用），**不会把 HTTP 状态拼进去**。宿主也没有 500 响应（未命中的路由/业务错误是 400/403/404/405）。
- **构造的反例**：副本 `06-tmp/qa-r4/fails`（HTTP 状态仍 500、信封仍 `{ok:false,error}`，只把文案里的 “500” 三个字删掉）→ `states.mjs` **14/15，唯一红的就是 ③**，而 UI 行为（红条 + role=alert + 无列表行）完全正确。
- **判断**：`?fail=` 的**信封形状是真契约**（`{ok:false,error}` 与 `web.ts` 一致，error 原文也被 client 透出），所以错误路径不是假路径；假的是这条断言的**结论**：它证明的是 fixture 文案，不是 UI 会显示状态码。
- **建议**：改成「显示 `envelope.error` 原文」或让 fixture 用宿主真实形状（400 + `找不到预设：x` 这类文案）；如果要保留“状态码可见”的承诺，那属于 client 改动（`请求失败（HTTP n）` 只在 error 为空时才出现），不能靠 fixture 断言。
- **附带**：`states.mjs:97` 采集了 `retry: !!err.querySelector('button')`，**从未断言**——文件头承诺的「ErrorBar（红色错误条 + 重试）」只验了一半；同理 ⑤ 也没有点重试。

## 4. R4-Q5 fixture 与真实契约漂移，导致矩阵“界面缺块”不报错（P1）

**位置**：`tools/preview/fixtures.json`；消费方 `tools/preview/preview.tsx:104-116`；真实响应 `src/web.ts:244-293`（overview）、`:507-535`（character）、`:307`（preview）、`:836`（opening/state）、`client/api.ts:216-239`（Overview 类型）。

抽 3 组核对（字段级）：

| 路由 | 真实（web.ts）有的字段 | fixture 有的字段 | 后果 |
|---|---|---|---|
| `/overview` | `mode` `discipline` `sessionId` `bindings{count,current,effective,items}` `preset{active,current,source}` `stats` `recent` `root` `active` `relationTag` | 只有 `root` `active` `relationTag` `stats` `recent` | 面板读不到会话/预设/纪律 → 全部走 `undefined` 分支；`client/index.tsx:2863` 把 `ov.preset` 当签名一部分，缺了等于“无预设” |
| `/character` | 含 `binding{boundHere,sessions,global,effective}`；`relation{tag,bands,baseline,current,log}` | 无 `binding`；`relation` 只有 `tag/bands/baseline` | 详情页的「当前会话启用 / 全局启用」永远画成“当前会话不可识别”（`client/index.tsx:3301` 起大量 optional 分支）；关系档位的 `current/log` 不显示 |
| `/preview` | `{active,mode,discipline,total,segments,lore,preset}`（`src/prompt.ts:187-228`） | 除 `preset` 外都有 | 预览弹层里“当前预设摘要”这一块在沙盒不存在 |

- **图证**（本次矩阵，`06-tmp/qa-r4/matrix/`）：`light-roster.png` / `dark-roster.png` / `w820-detail.png` 里都出现「**绑定到本会话** 当前会话不可识别，只能用全局启用。」——这是降级分支的文案，不是真实启用态。矩阵名“角色簿 + 详情”成立，但“会话绑定 / 预设摘要 / 纪律档位”这些整块界面**一次都没被截到**。
- 另有 `/opening/state` 是手写的 `{ok:true,state:'none',opening:'',openings:[]}`（`preview.tsx:108`），而真实 `store.openingState` 返回含 `character` 的对象（`client/api.ts:515-519`）——多一个 `state`、少 `character`，同样不是抓包来的。
- **建议**：像 KB `09` §2 说的那样“fixtures 从真实插件抓”，至少补 `live+session` 一份（`sessionId` + `bindings` + `character.binding` + `overview.preset`），并新增 `?live=1&session=1` 场景把绑定态纳入矩阵；`/opening/state` 改成真实形状。否则矩阵通过 ≠ 这些界面通过。

## 5. R4-Q6 `states.mjs` 的两处“固定等待”与漏断言（P2）

- `states.mjs:77` 用 `await page.sleep(2600)` 等 `?slow=2500` 落地。实测（`probe-states-timing.mjs`）：列表骨架消失 ≈ 4.68–4.80s（从导航算），② 的采样点 ≈ 5.17–5.26s → **余量只有 ~0.4s**；① 的采样点 2.57–2.64s、骨架消失 4.68–4.80s（余量 ~2.1s，安全）。冷机/CI 上 ② 有假红风险，且与本仓库自己在 `shots.mjs:72-75` 写的“固定延迟不可靠，要用夸张值/条件等待”原则相反。
- `states.mjs:97` 的 `retry` 从未断言（见 R4-Q4 附带）。
- 建议：把 ②/⑥ 的等待改成带超时的条件轮询（`rows===3` / `segs===6` 最多等 10s），并对 ErrorBar 的“重试”按钮做一次点击 + 观察。

## 6. R4-Q7 `collapse.mjs` 的 closing 不按目标过滤（P2）

- `collapse.mjs:153` 的 `closing` 只按 `e.state === 'closing'` 过滤，**没有像 `removed`（:154）那样按目标 class 过滤**；`openedState` 是对目标取值的，但 `closing`/`open` 事件不是。
- 现在可信：本次实跑 3 个场景各只有 2 条事件（`attr@2ms(closing)` + `removed@166-169ms`），`removed` 已带 class 过滤，所以归因目前成立；但如果同一时刻别的元素也进 `closing`，`closing.length <= 1` 反而会假红，或 `closing>=1` 被别的元素满足而真正目标没退场（那要同时 `removed` 也命中，概率低）。
- 建议：`closing` 也按 `targetClassOf(res)` 过滤（或记录 `m.target` 的 class 并在断言里匹配），并且把“`removed` 的节点 = 刚 `closing` 的节点”作为一条断言。

## 7. 静态护栏的漏检/误报（R4-Q8 ~ Q14，P2）

> 下面每条都做了“复制 `client/` + `scripts/` 到 `06-tmp/qa-r4/vt/` 后注入违规”的黑盒验证（`inject.ps1`，28 个样本）。

**误报（红点不是真问题，违反 `verify-a11y.mjs:30` 自己的“宁可 skip 也不误报”）**
- **Q8**：`verify-ui.mjs:53` 靠 `/\r?\n`[ \t]*\r?\n/` 找收尾反引号。把样式模板的收尾行改成 `` `// css end `` → `templateBody` 找不到收尾，`source.slice(from)` **退化成扫整个文件**，把 `installStyles` 里的模板串当 CSS → `✗ 模板串守卫`。实测 U13。
- **Q9**：`verify-ui.mjs:169-171` 直接扫 `.tsx` 原文，不剥 JS 注释：`index.tsx` 末尾加一行 `// Math.min(index, 12) * CARD_STAGGER` → `✗ 卡片错峰上限`（实测）。同一条规则对 **乘数字面量** 漏检：`Math.min(index, 12) * 40` → 绿（U12）。
- **Q11**：`verify-a11y.mjs:74` 只剥 `/* */`，行注释里的 `t('不存在的键')` → `✗ t() 用了字典里没有的键`（A14）；`jsxTags`（:101）不排除字符串，`const html = '<div onClick="x">'` → `✗ 非 button 元素绑了 onClick`（A15）。两者都是静态误报，会逼人改注释。

**漏检（假绿形态）**
- **Q10**：`verify-a11y.mjs:150` 里 body 出现 `props.` 就直接 `continue`（当作“有文案”）：`<button type="button"><IconAlert />{props.notice}</button>` → 绿（A10）。`maybeClickable`（:116）没有 `onPointerDown` 等替代事件：`<div onPointerDown={…}/>` → 绿（A9）。错误变量只认 4 个名字：`{err}`、`{error.message}` → 绿（A11）。
- **Q12**：`verify-a11y.mjs:392-397` 只匹配 `outline:` 简写；`.x:focus-visible{outline:none;outline-color:#f00}` → 绿（A12）。
- **Q13**：`verify-ui.mjs:58` / `verify-a11y.mjs:68` 的样式文件是硬编码 3 个。新建 `client/probe.styles.ts`（写死 `font-size:13px` + `transition:all` + `[data-probe]` 存在性选择器）→ verify-ui 绿（U11）；新建含反引号事故的 `probe2.styles.ts` → verify-a11y 绿（A13）。
- **Q14**：`verify-ui.mjs:69` 的 `allowed` 三个文件共用，`GUIDE_CSS`/`DISTILL_CSS` 在 `styles.ts` 的模板里也被允许（verify-a11y 已按文件区分，可对齐）。

**建议汇总**：剥注释要同时剥 `//`；JSX 扫描先剔除字符串/模板串；`Math.min(index, N)` 允许任意乘数（或直接禁字面量延迟）并对模板串收尾解析失败**报红并提示“结构假设变了”**；样式文件改成 `readdir(client).filter(f => f.endsWith('.styles.ts'))` 并把“未登记的新样式文件”本身算一条红；图标按钮/可点击元素/错误变量改为“白名单 + 显式 skip”而不是启发式 continue。

## 8. R4-Q15 ~ Q20 之外的小项

- **Q15 `crash.mjs:91`**：`r.check(second.panelMounted === false, '点重试后没有白屏/半挂', bodyHeight=…)`——断言的是“面板没挂载”，文案说的是“没有白屏”。noop 反例里 `bodyHeight=760`（有内容）却判“失败”，说明这条不是白屏检查。
- **Q16 产物落点**：`shots.mjs:29` / `crash.mjs:37` / `collapse.mjs:30` / `states.mjs:32` 默认 `join(here,'../../06-tmp/ui-audit')` = **仓库内** `…/dsh-ai-with-u/06-tmp/ui-audit`；`index.md:68` 却写“仓库外的工作区目录”，`.gitignore` 也没有 `06-tmp/`（只有 `.tmp/`、`tmp/`）。跑一次 QA 就脏 `git status`。建议默认写到工作区或补 `.gitignore`，并改文档。
- **Q17 换机**：`cdp.mjs:26-40` / `shots.mjs:213-231` 的 `findChrome` 只查 `%LOCALAPPDATA%\ms-playwright` 与 Windows 的 Chrome/Edge 路径；macOS/Linux 即使装了 Playwright 也找不到（KB `09` 说脚本可复制到新项目）。`serve.mjs:34` 固定 59621，脚本不校验端口上是不是**本仓库**的沙盒——本次实测 59621 上有一个 2 小时前起的 `node tools/preview/serve.mjs`（PID 15000，9:49:53），QA 脚本照用不误；如果那是另一个 checkout，整套举证就是别人的代码。建议：serve.mjs 暴露 `/__stamp`（git HEAD + client 文件 mtime/哈希），QA 脚本启动前校验；跨平台补 `~/Library/Caches/ms-playwright`、`~/.cache/ms-playwright`。
- **Q18 build 链**：`package.json:78` 串了 10 个 verify（bundle/ui/a11y/wiring/verify/tavern/distill/import/session/host），**没有漏接**；`.github/workflows/publish-github-packages.yml` 也跑 `npm run build`。缺的是：`tools/qa/*` 完全在 build/CI 之外（文档已说明是有意的），但没有 `npm run qa`/`qa:matrix` 入口把“起沙盒 + 4 个脚本 + 汇总”固化下来，也没有任何“最近一次跑过”的痕迹（报告只能手抄）。`verify-ui`/`verify-a11y` 是纯静态，放在 `tsc`+`build-client` 之后可以前置以更快失败（非必须）。
- **Q19**：`preview.tsx:79` `Math.min(10000, Number(...))` 把 `?slow=30000` 截成 10s；`shots.mjs:72-75` 的注释与 `index.md:53-56` 都说 30000。当前 10s 仍远大于 3s 场景时长，不影响结论，但注释与实现不符。
- **Q20**：`SCENES` 实际 20 项（浅 7 / 加载报错 4 / 深 4 / 窄 5），任务书里的“21 场景”与代码不符（`index.md:51` 写的是 20，正确）。另外 `--only=light-roster` 会连带跑 `light-roster-empty`（子串匹配），实测本次 `--only` 跑了 2 张。

---

## 9. 已确认可信（怎么验的）

1. **`verify-ui` 7 条护栏全部会红**：在副本里逐条注入 —— ① 反引号（U1）/ 非白名单插值（U2）/ 花括号不平衡（U3）；② 死动画（U4）/ 引用不存在 keyframes（U5）；③ 裸时长 160ms（U6）；④ `styles.ts` 写死字号（U7）；⑤ `transition: all`（U8）；⑥ `[data-probe]` 存在性选择器（U9）；⑦ `min(index,12)*CARD_STAGGER`（U10）→ **10/10 全部 EXIT=1，报错文案正确**。基线 `node scripts/verify-ui.mjs` = 7/7 绿。
2. **`verify-a11y` 8 条护栏全部会红**：A1 `div+onClick`、A2 裸图标按钮、A3 缺 `type`、A4 `.awu-err` 无 role、A5 zh 有键 en 缺键、A6 `t('字典外键')`、A7 非白名单插值、A8 `outline:2px solid #ff0000` → **8/8 EXIT=1**；基线 8/8 绿（491 键对称、637 处 `t()`、119 个 button、14 个图标按钮）。
3. **`?crash` 探针失效会被抓到**：noop 变体 → 5 红 / EXIT=1（上文 §2）。**这是对“会不会静默变成不崩”的直接回答。**
4. **`crash.mjs` 在真实沙盒是 10/10 绿**（`06-tmp/qa-r4/crash-real/`），且探针错误在 `consoleErrors` 里可归因（real=有 / noop=无 / other=无另因），修复断言已有可用证据。
5. **`--media` 真的设到了页面**（不是只传了参数）：
   - `matchMedia`：基线三项 false → 三特性全开后 `{motion:true,transparency:true,contrast:true}`（本机 chromium 支持 `prefers-reduced-transparency`）；
   - 计算样式：`reduce-motion` → `.awu-card` `animation-duration: 1e-05s`；`reduce-transparency` → `.awu-panel` `backdrop-filter:none`、`background-color: rgb(244,244,247)`；`contrast-more` → `backdrop-filter: blur(20px)`；
   - 端到端：`shots.mjs --only=light-roster --media=reduce-transparency` 的 PNG SHA256 与基线不同（E9B92C… vs 5EAC51…）。
6. **`states.mjs` 15/15 绿**，且加载态断言真的看到了骨架（① `skeleton=1 status=["载入中…"] rows=0`，④ `skeleton=2 segs=0`），② 实测列表落地 ~4.7s。
7. **`collapse.mjs` 18/18 绿**，三处都是 `closing@2ms` + `removed@166/167/169ms`（落在 120–260ms）、`data-state=open` 无残留；`removed` 按目标 class 过滤，归因成立。
8. **深色态是真的**：`index.html:30-40` 用 `body[data-ds-dark-theme]`（与宿主一致，不是 html），`dark-roster.png` 实测面板为深色。
9. **矩阵场景抽查与宣称一致**：`light-roster`（角色簿+虞照详情）、`light-dialog`（自创角色卡弹层+焦点环）、`preset-loading`（预设弹层骨架）、`w820-detail`（820 单栏详情）四张图逐张看过，内容与场景名一致；整轮 20 场景耗时 2.6–3.7s/张，无 stderr 警告。
10. **沙盒路由覆盖与真实路由一致**：`/overview /characters /character /relation /presets /preset /preview` 在 `preview.tsx:104-116` 与 `web.ts` 的 `${ROUTE_PREFIX}/…` 一一对应（`$` 锚定、pathname 匹配，`?sessionId`/`?name` 不影响）；`?fail=` 的 `{ok:false,error}` 信封与宿主 guard 一致（状态码不具代表性，见 Q4）。
11. **build 链无漏接**：`package.json:78` 覆盖 `scripts/` 下全部 10 个 `verify-*.mjs`，且 `publish` CI 会跑 `npm run build`。

## 10. 复现实验（全部在 `D:\CODEX\deepseek-work\06-tmp\qa-r4\`）

```powershell
# 静态护栏红灯自测（复制 client+scripts 到副本，逐个注入 28 个样本）
pwsh -NoProfile -File .\inject.ps1

# 崩溃探针：noop=探针不再抛错；other=探针不抛错但别的 bug 崩
pwsh -NoProfile -File .\make-variants.ps1
cd noop;  $env:PORT=59622; node serve.mjs      # 另开窗口
cd other; $env:PORT=59623; node serve.mjs
node tools/qa/crash.mjs --port=59622            # 期望 5 红 exit 1
node tools/qa/crash.mjs --port=59623            # 期望 10 绿 exit 0（假绿证明）
node probe-crash-attr.mjs 59621 real; node probe-crash-attr.mjs 59622 noop; node probe-crash-attr.mjs 59623 other

# 媒体模拟端到端
node probe-media.mjs; node probe-media2.mjs

# states ③ 的 fixture 自证 + 采样余量
pwsh -NoProfile -File .\make-fails.ps1; cd fails; $env:PORT=59624; node serve.mjs
node tools/qa/states.mjs --port=59624           # 期望 14/15，唯一红 =「带上了 HTTP 状态」
node probe-states-timing.mjs

# 矩阵失败通道
node tools/qa/shots.mjs --only=light-diary --port=59999 --out=…   # 期望 ✓ exit 0（假绿）
node shots-noop-step.mjs --only=light-stats --out=…               # 期望 ✓ exit 0（纯壁纸）
```

## 11. 未覆盖 / 说明

- 未跑 `npm run build`（按任务要求），因此没验证 `verify-*` 在 CI（ubuntu）上的实际行为；本报告里所有“红/绿”均在本机 Windows + 本机 chromium 上实测。
- `verify-ui` 的“字号预算 30”当前实际 0 处（不是 30 处），预算没起到“钉住存量”的作用（P2 nit，可选）。
- `docs/PLUGIN-DEV-GUIDE.md` 未纳入本轮（不在审查范围）。
- `tools/qa/index.md:8` 表格叫“四个脚本”但列了 5 行（含 cdp.mjs 驱动），属文档 nit。
