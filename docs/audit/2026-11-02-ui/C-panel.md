# C · 主面板（Overlay / 列表 / 详情 / 弹层族）UI·UX 逐屏逐态审查

- 仓库：`D:\CODEX\deepseek-work\01-projects\dsh-ai-with-u` @ `a7b5799`
- 审查对象：`client/index.tsx`（3205 行 / 3009 非空）、`client/text.ts`（1241 行）、`client/styles.ts`（3587 行，仅取与面板语义相关的规则）、`client/entry.tsx`（85 行）
- 方式：**只读**代码走查（未改动任何 client 文件、未 build、未在浏览器里实机复验）。凡涉及「实测观感」的结论均标 ⚠️待确认。
- 行号口径：`read` 工具的物理行号（含空行）；`客户` 侧文件行号一律写 `文件:行`。

---

## 0. 结论摘要

| 级别 | 条数 | 主题 |
|---|---|---|
| P0 | 1 | 左栏「选中态」完全缺失 → 日记页可在无声中切换操作对象（重置/忘记/改写会落错角色） |
| P1 | 10 | 头部空间与主 CTA 错配、tabs 与两栏语义冲突、<900px 堆叠把右栏推到几屏之外、详情页 5 个同排动作+删除无隔离、危险确认口径不一致、「最近日记」显示全部、刷新无 loading 反馈、术语三套口径、i18n 硬编码标题、useWideLayout 的 prop 覆盖实测值 |
| P2 | 14 | 卡片无选中/来源/体积信息、无搜索排序筛选、空态无引导按钮、按钮 28/24/22px、改写成功无提示、「重选文件」破坏按钮序、无导出、模态尺寸/焦点一致性余项、轮询 JSON.stringify 全量、50+ 卡无 memo 等 |

**设计感提升空间最大的 3 处**（详见 §11）：
1. **左栏只有「列表」没有「选中」** —— 主从结构缺一半，选中态、当前会话绑定态、tab 对应态三个信号全缺。
2. **1120px 的头部只放标题+2 个图标，两个主 CTA 被塞进 340px 窄栏** —— 空间分配与信息层级反向。
3. **详情页 hero 5 个同权动作平铺（含删除）** —— 风险梯度只有颜色，没有位置与分组。

---

## 1. 面板骨架真实还原（渲染结构，`index.tsx:2580-3201`）

```
div.awu-layer[data-rail]                      2581-2585
├─ button.awu-trigger（侧栏入口：圆徽 / 两行）  2587-2618
└─ portal → div.awu-panel.awu-scope [data-busy] 2620-2641   ← 1120 × calc(100vh-80px)，居中，position:fixed
   ├─ [编辑态] CardEditor 整块接管               2646-2660
   └─ fragment
      ├─ div.awu-head                          2664-2707
      │   ├─ headMain：kicker + 标题「角色管理器」 + counts(角色·记忆·对话)   2665-2685
      │   └─ headActions：刷新(IconBtn 32) + 关闭(IconBtn 32)                2686-2706
      ├─ 状态带（四态一形）                      2714-2800
      │   ├─ live：Avatar + 名字 +「当前会话（已绑定/沿用全局）· 模式」+ 全局行 + 4 枚按钮  2714-2778
      │   └─ idle：点 + 「当前没有启用角色」+ 「从左栏选一张卡 →」                          2780-2799
      ├─ ErrorBar（error）                       2802
      ├─ 提示条（notice，ok 5s 自动走 / warn 常驻）2803-2823
      └─ div.awu-workspace（两栏）               2830-3100
         ├─ aside.awu-rail (340px, 独立滚动)     2831-2980
         │   ├─ railHead：CTA 行(蒸馏/自创) → 分段器(4 tab) → toolbar(计数+模式胶囊+预设/预览/导入) 2837-2950
         │   └─ pane：Skeleton(cards) / empty / grid>CharacterTile×N                               2952-2979
         └─ main.awu-main (flex:1, 独立滚动)     2982-3099
             └─ pane#awu-tabpanel[role=tabpanel]：roster(detail|pick) / diary / stats / guide      2983-3098
      ├─ 7 个弹层（new/import/preview/preset/delete/mode/editDiary/forget/resetAll×2）           3103-3196
```

**一屏内的控件总数**：head 2 + 状态带 4 + railHead 2+4+6 = 18 个可点目标挤在首屏（不含卡片）。左栏 340px 里塞了 12 个；1120px 宽的头部只有 2 个。

---

## 2. 信息架构与视觉层级

### P1-1　头部空间与主 CTA 分配反向（最影响「设计感」的一处）
- 证据：`index.tsx:2664-2707`（head 仅 kicker+标题+3 个数字+2 个 iconBtn）、`index.tsx:2842-2859`（蒸馏/自创两枚主 CTA 被放进 `awu-ctaRow`，各占左栏 340px 的一半 ≈ 158px）、`client/styles.ts:895-903`。
- 现象：全屏 1120 宽的主面板，右侧 ~780px 的头部与工作区上方没有主行动入口；两个「创建」类主操作被压成 158px 宽的小按钮挤在左栏，`data-kind="primary"` 的蓝色实心块（`styles.ts:1236-1242`）出现在最窄的区域。
- 影响：首屏视线落点是「标题 + 一排数字」，而不是「能做什么」；主 CTA 与 3 个 ghost 小按钮（预设/预览/导入）在同一视觉带宽里抢注意力（`index.tsx:2911-2948`）。
- 建议：把「蒸馏 / 自创」提升到 `awu-head` 右侧（`headActions` 前方），左栏头只留搜索 + 排序 + 模式胶囊；空态时再用 CTA 占位。
- P1 / 工作量 M

### P1-2　分段控件放在左栏，但内容渲染在右栏 —— 语义冲突
- 证据：`index.tsx:2861-2878`（`.awu-tabs` 在 `awu-rail > awu-railHead` 内）、`index.tsx:2983-3098`（四个 tab 的内容全部渲染在 `awu-main` 里）、`styles.ts:800-840`。
- 现象：分段器在视觉上属于「左栏的头」，但它切换的是右栏内容；切到「统计/指南」时左栏角色列表仍在，点击卡片会 `setDetailName`（`index.tsx:2974`）但右栏毫无反应（死点击）；切到「日记」时左栏点击又会静默换人（见 P0-1）。
- 影响：同一个控件在四个 tab 下含义不同（切右栏 / 改左栏选中），用户无法建立「tabs 管什么」的心智模型；两栏 split view 的语义（左=选谁，右=看什么）被分段器破坏。
- 建议：tabs 移到 `awu-main` 顶部（作为右栏视图切换器），或改成左栏顶部的「角色簿 / 日记」两段（统计与指南下沉到头部 iconBtn）。
- P1 / 工作量 M

### P2-1　统计数字两处重复
- 证据：`index.tsx:2672-2684`（头部 counts：角色/记忆/对话）、`index.tsx:3059-3065`（统计 tab 同一组 Field）。同一份 `statTriple`（`text.ts:1223-1241`）。
- 影响：头部数字是「仪表盘」，统计 tab 首屏又把它抄一遍，右栏一大块空间被重复信息占住；`stats.bySource`（真正有信息量的）反被推到第二屏。
- 建议：头部保留数字，统计 tab 首屏直接给「来源分布 + 最近活跃 + 存放位置」，把三项统计改成 tab 内的一行 meta。
- P2 / 工作量 S

### P2-2　状态带承担了「状态 + 4 个动作 + 2 行元信息」四件事
- 证据：`index.tsx:2714-2778`（Avatar、名字、`当前会话（已绑定）· 模式`、`全局：xxx`、`openingNote`、4 枚按钮）；两个 icon-only 按钮（模式切换 2745-2755、换开场 2756-2765）只有 `title`，无可见文字。
- 影响：一条 44px 高的状态带里塞 2 行文字 + 4 个按钮，是首屏最拥挤的一块；icon-only 按钮（IconMotion / IconRefresh）发现性差——「换一句开场」尤其不可能被猜到（刷新图标）。
- 建议：状态带只留「谁在生效 + 全局是谁」+ 1 个主取消入口；模式与开场挪进详情页 hero 或 overflow 菜单，且给文字。
- P2 / 工作量 M

---

## 3. 列表页（`CharacterTile`，`index.tsx:424-466`）

### P0-1　左栏没有「选中态」，且日记页可在无声中换操作对象
- 证据：
  - `index.tsx:2964-2978`：`<CharacterTile … live={live && item.name === liveName} onOpen={setDetailName} />` —— 只传了「全局启用」，**没有传「当前详情/当前日记对象」**；
  - `index.tsx:437-445`：卡片只有 `data-live`，无 `data-selected` / `aria-current`；
  - `index.tsx:1997-2005`：`viewName = tab==='diary' ? (detailName || 启用角色) : detailName`，`loadDetail(viewName)`；
  - `index.tsx:2259-2263 / 2277 / 2301`：`editDiary / forgetKeyword / resetSession` **一律把 `viewName` 当操作对象写盘**；
  - `client/styles.ts:1050-1055`：只有 `[data-live="true"]` 的金色描边，没有选中态样式。
- 现象：在「日记」tab（或详情页已打开 B、再点左栏 A）时，左栏切换对象只换右栏内容，左栏 A/B 两张卡外观完全一致；页面没有任何「当前在看谁」的标记。此时点「彻底重置」= 落到刚点过的那张卡。
- 影响：**可造成对错误角色的不可逆数据删除**（`reset.all` 清日记+会话，`text.ts:357-362`），用户主观上以为还在原角色。这是本次审查唯一的数据风险级 UI 缺陷。
- 建议：① `CharacterTile` 增加 `selected` prop → `data-selected` + 左侧 2px 金/蓝轨 + 名字加粗（与 `data-live` 区分：live=全局启用=金色呼吸，selected=当前查看=蓝色静态轨）；② 左栏顶部固定一条「正在看：<名字>」面包屑；③ 在日记/统计/指南 tab 下，卡片点击前先在头行提示「将切换日记对象」。
- P0 / 工作量 S（样式 + 1 个 prop，1 天内）

### P1-3　<900px 时两栏纵向堆叠，右栏被推到列表下方几屏之外
- 证据：`client/styles.ts:563-570`（`@media (max-width:900px){ .awu-workspace{display:block; overflow-y:auto} .awu-rail{width:100%} .awu-main{min-height:auto} }`）、`client/styles.ts:475-476` 注释「（.awu-rail 隐藏条件由 JSX 决定）」——但 `index.tsx:2830-2980` **没有任何断点判断**，列表永远完整渲染。
- 现象：视口 <900px（分屏/窄窗笔记本，侧栏展开时很容易触发）→ 左栏变整宽、列表全高铺开，右栏详情/日记被挤到列表末尾之后；配合面板自身 `height: calc(100vh-80px)` 的固定高度，要在同一滚动容器里滚过 20 张卡才看得到内容。
- 影响：窄窗下基本不可用；且注释与实现不符，后续维护者会以为 JSX 已经处理。
- 建议：窄屏改成「tab 内切换」（列表/详情二选一）或给 rail 一个 `max-height: 40vh` + 收到详情时自动折叠列表；同步修正注释。
- P1 / 工作量 M

### P2-3　卡片信息位不够：没有「来源」、没有「体积/重量」、没有绑定态
- 证据：`index.tsx:446-463`（Avatar + 名字 + `roleOf` + 2 行 blurb + foot: `启用中` pill / `N 条记忆` pill / 相对日期）；`client/api.ts:CharacterSummary`（`name / card / source / lastActive / memoryCount`，无字节数）；`text.ts:1177-1191`（`sourceLabelOf` 已实现、仅统计页使用 3075）。
- 现象：`source`（custom/distill/import）已经从接口拿到，但**列表卡不显示来源**；卡片的「重量」（世界书条目/token/JSON 体积）完全没有；`bindings` 里「本会话绑定」的卡在列表里与普通卡无差别（`live` 只反映全局，见 P0-1）。
- 影响：50+ 卡时无法按来源/重量判断「这张卡会不会把上下文撑爆」；`stats.source` 的信息被浪费。
- 建议：foot 行第三个 pill 显示来源（`sourceLabelOf`）；详情页 hero 显示体积（`JSON.stringify(ccv3).length` 近似 + 世界书条目数，`countRegexScripts` 同款即可算）；绑定卡加 `teal` pill（`data-tone="teal"` 已有样式 `styles.ts:1198-1201`）。
- P2 / 工作量 S

### P2-4　无搜索 / 无排序 / 无筛选（50+ 卡必然踩）
- 证据：`index.tsx:2880-2905`（toolbar 只有「共 N 位」+ 模式胶囊）；`text.ts:1206-1213`（`sortRoster` 只按「启用置顶 + lastActive 倒序」）。
- 影响：左栏单列（见下条）+ 340px 宽，50 张卡要滚 ~10 屏；按名字找卡等于人肉扫描。日记页已有搜索（`diary-review.tsx`），列表页却没有——标准不一致。
- 建议：railHead 下方加一行 32px 搜索框（复用 `.awu-reviewInput` 样式）+「最近/名称/来源」小排序器；与 DiaryReview 的搜索栏同构。
- P2 / 工作量 M

### P2-5　栅格在 340px 左栏里恒为单列，`auto-fill minmax(240px)` 是空转
- 证据：`styles.ts:1000-1004`（`.awu-grid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}`）、`styles.ts:161`（`--awu-rail-w:340px`）、`styles.ts:509-519`（`.awu-pane` 左右各 32px gutter）→ 可用宽 276px < 240×2，永远 1 列。
- 影响：以「卡片墙」的规格写，实际得到「一行一张的长列表」；卡片内 blurb 固定 2 行 46px（`styles.ts:1161-1163`），一张卡 ~146px 高，信息密度低。1120 宽的面板里，列表只占 30%，右栏留白很多。
- 建议：`--awu-rail-w` 提到 380-420px 让 2 列成立（1 列 240 太窄，实测应 ⚠️待确认）；或明确改成「列表行」形态（头像+名字+来源+最近活跃单行 56px），把省下的纵向还给密度。
- P2 / 工作量 S-M（若加宽 rail，需要复看 tabs/toolbar 换行）

### P2-6　空态与 pick 空态同屏重复
- 证据：`index.tsx:2956-2962`（roster empty：图标 +「角色簿还是空的」+ 一句 hint，**无按钮**）、`index.tsx:3012-3016`（右栏 pick：「从左栏选一张卡」+ hint）。
- 现象：空库时同屏出现两个空态，一个说「建卡」一个说「选卡」，但没有任何一个带可点动作（CTA 在上方 railHead，间距 32px+）。
- 建议：左栏空态内嵌「自创 / 导入」两枚按钮（复用 `openDialog`）；右栏 pick 空态在列表为空时改为不渲染。
- P2 / 工作量 S

### 已达标（列表页）
- 长名字/长来源截断齐全：`.awu-cardName`/`.awu-cardRole` 单行 ellipsis（`styles.ts:1112-1137`）、`.awu-cardTop` 显式 `min-width:0;overflow:hidden`（`styles.ts:1057-1064`）、grid 子项 `min-width:0`（`styles.ts:1007`）。
- 无头像场景统一走「首字 + 名字派生色相」Avatar（`index.tsx:286-299`、`text.ts:1137-1149`），不会出现空头像框。
- 卡片高度锁定（整数 px 行高 + blurb 定高 46px），`styles.ts:1147-1164` 的注释已记录过「卡片高度差 1-2px」的历史问题。
- 出场动画延迟上限 `Math.min(index,8)`（`index.tsx:441`），50+ 卡不会排长队。

---

## 4. 详情页（`CharacterDetailView`，`index.tsx:1369-1590`）

### P1-4　hero 动作区 5 个同权按钮平铺，删除只靠颜色隔离
- 证据：`index.tsx:1487-1536`（编辑 / 当前会话启用 / 解除绑定 / 全局启用|退出全局 / 删除，5 个 `data-size="md"` 40px 按钮，`gap:10px`）、`styles.ts:1433-1458`。
- 现象：删除（红色描边）与「全局启用」相距 10px；`boundHere` 时并排 6 个按钮（编辑+绑定+解除+全局+删除），760px 内容宽内必然折行（`styles.ts:1434` 允许 wrap）。
- 影响：风险梯度只有颜色一档（正确但不够）；折行后「删除」可能落到第二行开头，与主操作左右相邻，误触窗口变小但没有分组保护。
- 建议：主行动最多 2 枚（全局启用 / 编辑），「解除本会话绑定 / 换开场 / 删除」收进 `⋯` 菜单；删除与 DiaryView 的「彻底重置」同款 dangerZone 放在页面底部（`index.tsx:1665-1698` 已有现成样式，一致性也更好）。
- P1 / 工作量 M

### P1-5　「最近日记」Section 实际渲染全部日记
- 证据：`index.tsx:1585-1587`（`<Section title={t('detail.diary')} count={detail.diary.length}><DiaryList entries={detail.diary}/></Section>`）、`index.tsx:373-412`（`DiaryList` → `sortedDiary(entries)` 全量、无截断）、`text.ts:161`（标题「最近日记 / Recent diary」）。
- 现象：标题承诺「最近」，实现给全量。常见卡日记 30-200 条 → 详情页被日记淹没，重启/二进制的 `Section` 分组（角色卡/性格/声音/关系）被推到首屏之外可视区。
- 影响：详情页的信息层级被最长的那块内容劫持；且没有「查看全部 → 日记 tab」的出口。
- 建议：详情页只显示最近 3 天 / 前 8 行 +「在日记里看全部（N）」按钮（`setTab('diary')` + `setDetailName(name)`）；全量留给 `DiaryReview`（它已有搜索/折叠/导出）。
- P1 / 工作量 S

### P2-7　边界说明 3 段常驻长文案（首屏密度过高）
- 证据：`index.tsx:1543-1555`（3 条 `bind.hint.*`，`text.ts:229-231`，每条一句完整中文）；`styles.ts:1461-1489`。
- 影响：占掉首屏 ~72px 高；而它解释的「子代理不吃会话绑定」是低频信息。设计意图（可见、不塞 tooltip）是对的，但常驻 3 段过量。
- 建议：保留 1 行「本会话绑定 / 全局启用 的区别」，其余折进 `details` 或 `?` 弹出（保持可见性而非 tooltip）。
- P2 / 工作量 S

### P2-8　详情页缺「导出卡」与「世界书概览」
- 证据：`index.tsx:1487-1536` 无导出；`client/card-editor.tsx` 全文无导出实现（仅 `CardSavePayload` / `CardEditor` 两个导出符号）；详情页唯一的世界书信号是「正则已屏蔽」`index.tsx:1558-1563`。
- 影响：任务清单里的「导出」动作在当前 UI 不存在；用户看不到这张卡的世界书条目数/预算（编辑器里才有，进编辑器算「要改」的心理成本）。
- 建议：hero 的 overflow 菜单加「导出 CCv3 JSON」；「角色卡」Section 顶部加一行 `世界书 N 条 · 常驻 M 条`（`toLoreDraftFromCard` 已在 `index.tsx:936` 用过，零新依赖）。
- P2 / 工作量 M（导出）/ S（世界书计数）

### 已达标（详情页）
- 空数据分支齐全：无日记→`diary.empty`（`index.tsx:381-383`）；无正则→整块不渲染（1558）；无关系快照→不显示（2488）；无 basic/personality/voice/relationship→对应 Section 不渲染（1565-1584）。
- 加载失败有独立「错误 + 重试 + 返回」三段（`index.tsx:1402-1427`），且 detail 错误不再污染全局 `error`（`index.tsx:1988-1989`）——这是正确的分层。
- 「返回」被做成独立导航行、与动作组分离（`index.tsx:1442-1454`），符合「导航 ≠ 动作」。
- 关系起点/最近互动填进 hero 空隙（`index.tsx:1472-1485`），`heroMeta:empty` 兜空（`styles.ts:1396`）。
- 字段行 `grid-template-columns:104px 1fr` + `word-break:break-word`（`styles.ts:1544-1556`），长值不溢出。

---

## 5. 弹层族（7 个 Dialog）

### 一致性总览

| 维度 | 状态 |
|---|---|
| 尺寸 | ✅ 全部走 `.awu-dialog`（`width:min(620px,100%)`，`styles.ts:2456-2476`）+ `awu-dialogHead/Body/Foot`；preview/preset 也复用同一壳（`preview.tsx:126/143/224`、`preset-view.tsx:546/563/639` 等三处） |
| 标题结构 | ⚠️ 8/9 处是「icon + span」；`EditDiaryDialog` 在标题右端塞了 `date · marker`（`index.tsx:1250-1252`，借用 `.awu-count` 类 + 4 条内联样式） |
| 按钮顺序 | ✅ 基本 [次要][主要/危险]（`index.tsx:735-764 / 1091-1123 / 1157-1168 / 1268-1279 / 1325-1330 / 1357-1362`）；❌ `ImportDialog` preview 段是 [取消][重选文件(ghost)][确认]（`1096-1121`） |
| Esc / 点遮罩 | ✅ 全部经 `Overlay`（`index.tsx:216-277`），Esc 捕获阶段 + `onMouseDown` 判 target，含 `escYield` 内层让位 |
| 焦点管理 | ✅ 全部 `useRestoreFocus/useInitialFocus/useFocusTrap`（`index.tsx:235-237`）；初始焦点落第一个可聚焦元素（`a11y.ts: useInitialFocus`）→ 危险弹层会先落到「连同日记一起删除」的 checkbox（`index.tsx:1147-1154`），Space 可误勾 |
| 危险二次确认 | ❌ 口径不一：覆盖导入=两步（`index.tsx:1102-1115`）；删除=一步（`1159-1167`）；彻底重置=一步（`1357-1362`） |

### P1-6　危险确认的标准不一致（删除/重置 一步，覆盖导入 两步）
- 证据：`index.tsx:1102-1115`（必须先点「覆盖并导入」再点「确认覆盖」）、`index.tsx:1157-1168`（删除一次点击即执行）、`index.tsx:1357-1362`（彻底重置一次点击即执行）；文案层 `delete.body` 写「不会自动备份」（`text.ts:190`），`reset.confirmBody` 写「无法撤销」（`text.ts:362`）。
- 影响：破坏最谨慎的那个流程的信任度——用户会问「为什么导入要确认两次，删角色不用？」；而删除恰恰是不可恢复的。
- 建议：统一为「危险弹层 = 输入/勾选式确认」：删除沿用已有 checkbox，但把它变成必勾（未勾时 confirm 置灰）+ 二次点击确认按钮；或全部改为「长按/两步」。任一方案，7 个弹层只允许一种。
- P1 / 工作量 S

### P2-9　ModeDialog 点选即生效并关层，没有「应用 / 取消」语义
- 证据：`index.tsx:1194-1213`（每个选项是 `<button>`，`onClick={() => onPick(value)}`）；`index.tsx:2249`（`onModePick` → `applyMode(next, () => setDialog(''))`）；底部只有 `common.cancel`（`1226-1228`）。
- 影响：误点即写盘（写全局兜底或当前卡），且弹层立刻消失；`data-kind="primary"` 被借来表示「当前选中」（`1201`），把「选中态」和「主操作」两种语义混在一个色块上。
- 建议：改成 radio 列表 + 明确的「应用」按钮；选中态用 `aria-checked` + 左侧勾，不借用 primary 底色。
- P2 / 工作量 S

### P2-10　ImportDialog 按钮序与「重选文件」定位
- 证据：`index.tsx:1091-1123`；`text.ts:118`（`import.retry`＝「重选文件」）。
- 影响：`dialogFoot` 是 `justify-content:flex-end`（`styles.ts:2503-2509`），三个按钮右对齐时「重选文件」夹在取消与确认之间，读起来像第二个主行动；其它弹层都是两枚。
- 建议：把「重选文件」降级为文件行右侧的图标/文字链接（`index.tsx:1009-1013` 那行旁边），底栏回到两枚。
- P2 / 工作量 S

### P2-11　EditDiaryDialog 标题右端的元信息（样式借类）
- 证据：`index.tsx:1247-1253`（`<span className="awu-count" style={{marginLeft:'auto', fontFamily:'var(--awu-mono)', fontSize:10.5, color:'var(--awu-gold)'}}>`）。
- 影响：弹层标题只在这一次出现「右对齐小字」，且字号 10.5px 小于全站最小 token `--awu-fs-micro:11px`（`styles.ts:130`），是唯一一处绕过 token 的字号。
- 建议：下沉到 body 第一行（作为 hint 前缀），标题回到 icon+span。
- P2 / 工作量 S

### P2-12　改写成功后无任何反馈
- 证据：`index.tsx:2264-2271`（`editDiary().then(() => { setDialog(''); dismissNotice(); return reload() })` —— 只关闭、只清提示，不 `showNotice`）；对照 `onForget`（2279-2288）与 `onReset`（2303-2304）都给了 notice；`text.ts:341` 的 `diary.editDone`「已改写。」**全仓库无引用**。
- 影响：改完日记点保存 → 弹层关、列表刷新，用户无法确认「是不是改成功了」，而且刚被 `dismissNotice()` 清掉了上一条提示。
- 建议：`showNotice(t('diary.editDone'))`；顺手把 `diary.editMulti`（命中多条只有第一条被改，`text.ts:342`）接上——后端结果里若有多命中应当提示。
- P2 / 工作量 S

### 已达标（弹层族）
- 壳统一：`Overlay` 单点实现 Esc / 遮罩 / 焦点陷阱 / 文件拖放吞噬 / `resetHostDropState`（`index.tsx:216-277`），7 个弹层零分叉。
- 忙碌锁：`locked = busy || panelBusy` 在 New（`520`）/ Import（`862`）内统一，弹层内所有按钮 `disabled={locked}`，防重复提交到位。
- 错误与业务结果分离：Import 把「读文件失败」与「后端解析失败」分开 catch（`index.tsx:897-921`），错误原样透出，不压成「导入失败」。
- 软警告展示有明确分寸：`ok` 5s 自动消失、`warn` 常驻（`index.tsx:1902-1913`、`text.ts:219`）。

---

## 6. 状态完备性

### P1-7　「刷新」按钮点击几乎无反馈（图标不转）
- 证据：`index.tsx:2687-2696`（`data-spin={busy}`，`onClick={() => { void reload(); if (viewName !== '') void loadDetail(viewName) }}`）；`reload`（`1925-1949`）不 `setBusy`、只在 finally `setLoading(false)`，而 `loading` 初值为 `true` 之后再也不会回到 `true`。
- 影响：点刷新 → 图标保持静止、列表无骨架、无提示条（`reload` 成功时 `setError('')` 不产生可见变化）→ 用户以为按钮坏了会连点，5s 轮询 + focus 监听（`1954-1960`）又叠几层请求。
- 建议：`onClick` 内走 `run(() => reload())`（已有 busy 光带 `styles.ts:672-684` 会亮），或给刷新按钮独立的 `refreshing` state 驱动 spin；同时 `disabled` 它。
- P1 / 工作量 S

### P2-13　Skeleton 与真实布局的近似度
- 证据：`index.tsx:306-317`（3 个 `awu-skRow`，`label` 默认硬编码 `'载入中…'`）；`styles.ts:1994-2014`（cards 形态高度用 token 算式 ≈141px；真实卡 `styles.ts:1009-1176` ≈146px）。
- 结论：`shape="cards"` 与真实卡高差 ~5px，**不会明显跳版**，这条做得好；但详情/日记默认形态只有 3 行 76px（`styles.ts:1998-2007`），与详情页（nav 24 + hero ~140 + 3~5 个 Section）差得远，切过去会有一次明显重排。
- 建议：补 `data-shape="detail"` 的真实结构（nav 行 + hero 方块 + 2 个分组块），别只放大第一行。
- P2 / 工作量 S

### 三分支空态 / 错误态核查

| 场景 | 分支 | 结论 |
|---|---|---|
| 角色簿 | loading → Skeleton(cards) ✅ / empty（无按钮 ❌ P2-6）/ error → 顶部 ErrorBar + 左栏空白 ⚠️ | 有 error 时左栏既非骨架也非空态，只剩一条红条；右栏仍显示「从左栏选一张卡」（`3012`）→ 引导与事实相反 |
| 日记 | 未选/未启用（`3019-3024`）/ 有卡无日记（`1653-1658`，有 hint 无动作）/ 加载失败（`3038-3055`，有重试）/ loading（`3037`） | 三态分离干净（✅ 已达标）；「有卡无日记」缺一个「去聊两句 / 换开场」的引导动作 |
| 详情 | 无数据（`1403` 空 Skeleton ⚠️）/ error（`1402-1427` 完整）/ loading（`1399`） | `detail===undefined && error===''` 时渲染**无 label 的 Skeleton**（`1403`），会走到硬编码中文「载入中…」（`310`） |
| 统计 | 无 bySource / 无 recent → `stats.none`（`3067-3068, 3079-3080`）；root 缺失 → 「—」（`3091`） | ✅ |
| 禁用态 | 批量动作、卡片、模式胶囊、toolbar 3 枚均 `disabled={busy}`；**唯一漏网=刷新**（见 P1-7） | 基本达标 |

### P2-14　长任务无进度、`formatSize` 位置
- 证据：`index.tsx:803-807`（`formatSize` 只在导入路径用：`890 / 1002 / 1012`）；导入解析中只有一行 `import.parsing`（`1020-1022`）；保存卡片的「ccv3 → card → 回读」三步（`2342-2352`）无任何文字进度，只有顶部 2px 光带。
- 影响：16MB 上限的卡（`api.ts IMPORT_LIMITS`）在解析/保存时可能数秒，用户看到的是「静止的界面 + 一条扫光」。
- 建议：保存卡片时在编辑器顶栏显示「保存世界书 → 保存结构 → 回读校验」三步状态；`formatSize` 提到共用工具（`text.ts` 或 `client/format.ts`），因为卡片「体积」提示也要用它（P2-3）。
- P2 / 工作量 S-M

---

## 7. 文案与 i18n

### P1-8　面板标题硬编码中文，绕过了字典
- 证据：`index.tsx:2667`（`<div className="awu-title">角色<em>管理器</em></div>`）、`text.ts:21`（`'panel.title': 'Character Manager'` 已存在但未被使用）。
- 影响：英文界面里最显眼的 H1 仍是中文；`em` 拆分强调色也导致无法直接用 `t('panel.title')`，必须改成 `<em>` 包裹最后两字的结构化文案。
- 建议：新增 `panel.title.lead` / `panel.title.accent` 两键（zh：角色/管理器；en：Character/Manager），或直接整串 + CSS 着色。
- P1 / 工作量 S

### P2-15　中文标点硬编码进 tsx（英文界面里会露全角）
- 证据：`index.tsx:2726`（`（${t('active.sessionBound')}）`）、`2732`（`{t('active.global')}：`）、`2482/2484`（`${entry.name}（${current}）`）。
- 建议：改为两段 `span` + `·`/空格分隔，或用字典键 `active.sessionMeta` 承载括号。
- P2 / 工作量 S

### P2-16　Skeleton 默认 label 硬编码
- 证据：`index.tsx:310`（`{props.label ?? '载入中…'}`）；调用点 `1403`、`3057` 未传 label。
- 建议：`t('common.loading')` 必须由调用方传入（把 `label` 改成必填），或到 `text.ts` 取兜底。
- P2 / 工作量 S

### 术语一致性（P1-9）
- 证据与现状：
  - 「本会话」通道有 3 种叫法：`detail.bindSession`＝「当前会话启用」（`text.ts:156`）、`detail.bindSessionOff`＝「解除本会话绑定」（`157`）、`active.sessionBound`＝「已绑定」（`63`）、`bind.hint.session` 又说「跟这个角色走」（`229`）；
  - 「全局」通道 2 种：`detail.globalOn`＝「全局启用」/`detail.globalOff`＝「退出全局」（`158-159`）、`active.gExit`＝「退出全局」（`59`）。
- 影响：「启用」在用户心智里通常指全局开关（卡片 foot 的 `roster.enabled`＝「启用中」也是全局，`text.ts:76`），而详情页把一个会话级绑定也叫「启用」——这正是两个通道最容易混淆的地方（`index.tsx:1499-1503` 的注释也承认要「互不覆盖」）。
- 建议：全站固定两组词：**「本会话绑定 / 解除绑定」**（session）与**「全局启用 / 退出全局」**（global）；`roster.enabled` 改为「全局」或「全局中」；`active.sessionBound/Inherit` 改成「已绑定 / 沿用全局」保持不变（已清晰）。
- P1 / 工作量 S（改 6-8 个键 + 复看 3 处组合句）

### 字典对齐（✅ 已达标，别重做）
- `text.ts:538` 用 `type Dict = { [K in keyof typeof zh]: string }` 强约束，实测 zh 490 / en 490 键**完全一致**（脚本比对：missing 0 / extra 0）——这会编译期报错，等于永久的漏项防线。
- `makeTranslator`（`text.ts:1074-1094`）在宿主缺 key / 抛错时退回中文兜底，不会露出裸 key。
- 全量扫描 `index.tsx` 的非注释中文行，除 §7 已列的 3 处外没有其他用户可见硬编码（`786-787` 的正则分组关键词、`819` 的 FileReader 错误串、console 日志不算 UI 文案）。

### 死文案（P2-17）
- 已确认无引用的键（脚本 + 人工复核）：`relation.note`（「档位由模型现算，这里只显示起点锚定」，`text.ts:225`）、`detail.diaryEmpty`（`162`）、`opening.none`/`opening.fresh`（`331/333`）、`diary.actions`（`337`）、`diary.editDone`/`diary.editMulti`/`diary.editRequired`（`341-343`）、`forget.nothing`（`350`，与 `forget.none` `197` 重复定义两套同义文案）、`active.since`（`56`）、`roster.enable`/`roster.detail`（`75/77`）、`stats.*.full`（`139-141`）、`common.noMemory`（`215`）、`preview.entry`/`import.entry`/`distill.entry`（`25/86/511`，入口名已被 `*.entryShort` 取代）。
- 影响：`relation.note` 是唯一一条解释「起点 ≠ 当前档」的文案（详情页 heroMeta 写「关系起点」、日记页 tag 显示「名字（当前档）」），删掉文案而保留 UI 会让人误读 `relation.baseline`。
- 建议：要么接上（详情页 `relation.baselineShort` 旁加 title/hint），要么删键——不要留 59 个键（含动态拼接的误报，真实死键约 14 个）在字典里。
- P2 / 工作量 S

---

## 8. 手感细节

### 8.1 < 32px 的可点目标清单（P2-18）
| 目标 | 尺寸 | 出处 |
|---|---|---|
| `.awu-btn[data-size="sm"]`（全局 28px 高） | 28px | `styles.ts:1288`；使用点 15+ 处：`index.tsx:325, 1417, 1641, 1672, 1687, 2747, 2758, 2768, 2773, 2913, 2925, 2937, 3048` |
| `.awu-modePill` | 24px（min-height） | `styles.ts:917-919`；`index:2891-2904`（两枚） |
| `.awu-noticeClose` | 22×22 | `styles.ts:956-961`；`index:2813-2821` |
| `.awu-lineEdit`（日记「改写」） | 28px + **默认 opacity:0** | `styles.ts:1624-1642`；`index:388-398` |
| `.awu-navBack`（详情返回） | 28px（min-height） | `styles.ts:1304-1310`；`index:1407, 1443` |
| `.awu-iconBtn` | 32×32 | ✅ 达标（`styles.ts:651-657`） |
| `.awu-tab` | ≈32-34px（padding 6/8 + 14px 行） | ✅ 达标（`styles.ts:811-829`） |
| `.awu-check` 的 checkbox | 原生 ~13px，但整块 label 可点 | ✅ 达标（`styles.ts:2562-2579`） |

- 关键一条：`.awu-lineEdit` 只在 `.awu-line:hover` 或 `:focus-visible` 时 `opacity:1`（`styles.ts:1641-1642`）→ **触摸/无 hover 设备上「改写」按钮永远不可见**，键盘用户要靠 Tab 盲试。
- 建议：`sm` 档提到 32px（或 icon-only 按钮强制 32 + `padding` 补足热区）；`lineEdit` 在小屏/`@media (hover:none)` 下常显。

### 8.2 危险操作不可撤销 / 无前置备份（P1-10 的一半）
- 证据：`text.ts:190-192`（`delete.body`「这一步不会自动备份」、`delete.keepMemory`「日记文件会保留在磁盘上」）、`index.tsx:2194-2202`（删除后仅 `showNotice`，无回调/无回收站）。
- 影响：删除是永久操作，UI 只给了一句提示，没有任何「先导出日记 / 先复制目录」的一键通道（导出 markdown 只在日记页的 DiaryReview 里）。
- 建议：DeleteDialog 内加一行「先导出这张卡的日记（markdown）」按钮；与 P1-6 的二次确认一起改。
- P1 / 工作量 M

### 8.3 键盘可达性
- ✅ Tab 顺序合理：head → 状态带 → rail（CTA → tabs → toolbar → 卡片）→ main pane（`tabIndex=0`，`index.tsx:2988`）→ 详情动作组；分段器有 roving tabindex + ←/→/Home/End（`2556-2577`）。
- ⚠️ Enter 语义三套：New 的 3 个 input 都绑 `Enter=提交`（`613-615`，role/blurb 里按 Enter 也会直接建卡）；Forget 是 Enter（`1319`）；EditDiary 是 **Ctrl/⌘+Enter**（`1262-1264`）。三处同类「单输入弹层」三种提交键。
- ⚠️ 危险弹层初始焦点：`useInitialFocus` 落第一个可聚焦元素 → DeleteDialog 落在「连同日记一起删除」checkbox（`1147`），Space 直接勾选不可恢复项。
- 建议：EditDiary 改为 Enter 提交 / Shift+Enter 换行（与另两处统一），或在两处都写清快捷键；危险弹层给取消按钮 `autofocus`。

### 8.4 防重复提交
- ✅ 主路径均 `busy` 或 `locked` 挡住（New `520/602`、Import `862/925`、Delete/Reset/Forget/EditDiary 的 `disabled={busy}`、模式胶囊 `disabled={busy}` 与 `applyMode` 的 `if (busy) return` `2226`）。
- ❌ 刷新按钮（P1-7）；5s 轮询 + `window focus` 双通道（`1954-1960, 2047-2051`）没有 in-flight 去重，切窗口焦点时可能重叠请求。
- 建议：`reloadQuietly` 加 `if (quietInFlight) return`。

### 8.5 滚动区
- 面板内并存 3 个滚动容器：`.awu-rail > .awu-pane`、`.awu-main > .awu-pane`（`styles.ts:509-519`）、`.awu-dialogBody`（`2501`）；窄屏下 `.awu-workspace` 又变成第 4 个（`565`）。
- `.awu-pane` 用 `overscroll-behavior: contain` ✅ 不会把滚动传给宿主；顶部滚动影用 `animation-timeline: scroll()` 渐进增强（`styles.ts:863-879`）✅。
- ⚠️ 两栏独立滚动的代价：宽屏下左右不同步是预期的，但**切 tab 时右栏滚动位置不复位**（`awu-pane` 无 key），从长日记切到统计会停在半空。建议给 `awu-tabpanel` 内容加 `key={tab}` 或切 tab 时 `scrollTop=0`。

---

## 9. 代码层面的 UI 风险

### P2-19　3205 行单文件，建议的拆分边界
- 现状：18 个组件 + 1 个 1400 行的主组件 + 6 个内部 hook 全在 `index.tsx`；`CharacterPanel` 本体 `1768-3203`（1435 行）。
- 建议边界（按依赖方向，从上到下）：
  1. `client/panel/primitives.tsx` —— `Dot / Avatar / Skeleton / ErrorBar / Field / Section / DiaryList / formatSize`（`281-412`、`803-807`），无状态、被所有视图复用；
  2. `client/panel/dialogs.tsx` —— `New / Import / Delete / Mode / EditDiary / Forget / ResetAll`（`484-1365`）+ `ImportWarnGroup`/`groupImportWarnings`（`775-800`），彼此无依赖，可整块搬走；
  3. `client/panel/detail-view.tsx` —— `CharacterDetailView`（`1369-1590`）；
  4. `client/panel/diary-view.tsx` —— `DiaryView`（`1601-1701`）；
  5. `client/panel/data.ts` —— `reload / reloadQuietly / loadDetail / relation / statTriple` 相关 state（`1781-2051`、`2400-2527`）；
  6. `client/panel/chrome.tsx` —— head + 状态带 + tabs + toolbar（`2664-2949`）；
  7. `index.tsx` 只留 `CharacterPanel` 的编排 + 弹层路由（约 400 行）。
- 拆分前提：先把 `t`、`busy`、`run`、`showNotice` 抽成一个 `PanelContext`，否则 props 钻孔会更长。工作量 L。

### 每 render 重建的对象 / 函数（P2-20）
- `panelStyle`（`index.tsx:2544-2554`）每次 render 新对象 → 传给 `div.style`，React 会逐属性 diff（可接受，但可 `useMemo` 零依赖）。
- `TAB_IDS`（`2558-2563`）在组件体内定义 → 每次 render 新数组，并且被 `onTabKey` 闭包捕获；应提到模块级常量。
- `ModeDialog.options`（`1183-1186`）每次 render 重建（含 2 个 JSX icon）；`DiaryView` 里多处内联 `style={{...}}`（`1644, 1666, 1684...`）。
- `CharacterTile`（`424-466`）**没有 `memo`**，且 `reload`/`reloadQuietly` 每次都返回新 `list` 数组与新 `item` 对象（`1931/2016`）→ 50 张卡每 5 秒全量重渲染 + 每张卡重建 `style={{animationDelay}}`（`441`）；由于 `item` 引用每次都变，直接加 `memo` 也无效，必须先在数据层做「相同则复用旧对象」或在 `memo` 里按 `name/memoryCount/lastActive/card` 比较。
- `detailSaysBoundHere` / `isBoundHere`（`2433-2464`）是 render 内定义的闭包函数，被 `CharacterDetailView` 当 props 用时无记忆化意义（`CharacterDetailView` 也未 memo）→ 每次 `busy` 翻转都整块重渲。
- 建议：`CharacterTile` 加 `memo` + 自定义比较；`TAB_IDS`/`MODE_OPTIONS` 同级提到模块；`panelStyle` useMemo。

### P2-21　5 秒轮询的签名成本
- 证据：`index.tsx:2025-2033`（`JSON.stringify([chars, active, sessionId, bindings, stats, preset])`）——`chars` 里每项含**整张 `card` 对象**（`api.ts: CharacterSummary.card`）。
- 影响：50 张卡时每 5 秒序列化一次全量卡片 JSON（含世界书/长文本），在弱机上会掉帧；而它只是为了「数据没变就别 setState」。
- 建议：签名退化成 `chars.map(c => c.name + '|' + c.lastActive + '|' + c.memoryCount).join()`，或后端提供 `updatedAt`/etag。
- P2 / 工作量 S

### P1-11（⚠️待确认）　`useWideLayout` 的两个 effect 互相打架
- 证据：`index.tsx:1721-1760`。
  - `1733-1741`：实测宽度优先，量不到才退回 prop；注释明确写「不能只信 `wide` prop … 只按 prop 判断会把没传当宽态，于是 36px 轨道塞 44px 按钮（线上踩过）」；
  - `1755-1757`：**`propWide !== undefined` 时无条件 `setWide(propWide)`**，注释又说「宿主主动告诉我们的比测量更权威」。
- 结论：只要宿主传了 `wide: true` 而实际容器仍是收起的 36px 轨道（切换动画中、宿主渲染路径滞后一帧），第二 effect 就会覆盖实测值 → 复现注释里描述的线上事故。两段注释逻辑互斥，实现选择了后者。
- 影响：窄轨里塞两行文字（字被挤成竖排、按钮溢出轨道）；且 `useEffect` 依赖 `[ref, guess, propWide]` 里 `guess` 又由 `propWide` 派生，prop 变化会重挂 ResizeObserver。
- 建议：删掉第二个 effect，统一「实测优先，prop 仅用于首帧 guess」；`ResizeObserver` 回调里 `setWide` 前先 `if (next === wide) return`（当前靠 React bail-out，但仍会跑一次 re-render 调度）；依赖收敛为 `[ref, propWide]`。⚠️ 是否真的踩到取决于宿主是否传 `wide`，需实机复看（本阶段只读，未验证）。
- P1 / 工作量 S

### 其余
- 两套 busy 管理并存：`run()`（`2053-2067`）与 `applyMode` 自行 `setBusy`（`2229-2246`）、`onEditDiary/onForget/onReset/onSaveCard` 又各自 `setBusy(true)` + `finally`（`2254-2309`）→ 4 份几乎相同的 async 包装。建议统一走 `run()` 或抽 `usePanelAction`。
- `dialogError` 由 Forget 与 EditDiary 共用一份（`1835`），当前靠 `openDialog` 清空（`2251`）兜住；一旦以后有弹层不走 `openDialog` 就会串错误。建议并入各弹层自己的 state。
- 大量 `style={{...}}` 内联兜底（`2793, 2738, 2857, 3060, 3090` 等）与 `styles.ts` 的设计 token 体系并行，是「样式全在 styles.ts」这一约定的漏点；建议后续统一收到类名上。

---

## 10. 已做得好、不要重做

1. **`Overlay` 单点封装弹层行为**：Esc（捕获阶段）+ 点遮罩（`mousedown` 判 target）+ 焦点陷阱/回原 + `escYield` 给内层专注编辑器让路 + 文件拖放吞噬 + 卸载兜底 `resetHostDropState`（`index.tsx:216-277`）。改弹层时不要各写一份。
2. **i18n 字典的映射类型强约束**：`type Dict = { [K in keyof typeof zh]: string }`（`text.ts:538`），zh/en 490↔490 全等，漏项编译期就报。**不要**改成 `Record<string,string>`。
3. **i18n 附件完整**：`sourceLabelOf` 把 URL 缩域名 + 三来源映射（`text.ts:1177-1191`）、`relativeDay` 走字典（`1152-1169`）、`makeTranslator` 缺 key 退中文（`1074-1094`）。
4. **空态三分支分离**（`index.tsx:1594-1600` 注释、`3019-3055`）：没选卡 / 选了没日记 / 加载失败，三种完全不同的文案与动作。这是真机反馈换来的，别合并回去。
5. **详情错误不再污染全局 `error`**（`1985-1992`），详情区就地展示 + 重试（`1402-1427`）。
6. **风险梯度只做在颜色与描边上**：主操作唯一蓝色实底、危险红描边不填底、编辑中性（`styles.ts:1236-1277`、`1426-1450` 的长注释记录了主人三轮反馈）——这套决定是对的，改进时保留语义，只调位置/分组（见 P1-4）。
7. **卡片高度锁定**：整数 px 行高 + blurb 定高 46px + 2 行 clamp（`styles.ts:1147-1164`），解决了「滚动时像三块不同尺寸的砖」。
8. **hover 不改灰罩、只提亮**（`styles.ts:1035-1042`）——主人明确说过「移上去变暗不好看」，别为了「常态对比」改回去。
9. **对比度写在 token 注释里**（`styles.ts:228-257`，每色标了 5.0-16:1），并把 `--awu-fs-*` 抬到整数像素（`127-138`）。
10. **无障碍兜底齐全**：`focus-visible` 在 trigger/iconBtn/btn/tab/card/modePill/noticeClose/lineEdit/navBack 全覆盖；`prefers-reduced-motion` / `prefers-reduced-transparency` 两套降级（`3529-3564`）；骨架屏带 `role="status" aria-live`（`308`）。
11. **窄轨只渲染圆徽、文字节点不进 DOM**（`index.tsx:2606-2618` + `styles.ts:430-431`）——比 `display:none` 可靠，别退回去。
12. **骨架 `shape="cards"` 与真实卡高度对齐**（`styles.ts:1994-2014`，差 ~5px）。
13. **保存后回读校验**（名字 `930-935`、世界书条目数 `936-938`、`2351-2357`）——UI 层的「假成功」防线，任何重构都必须保留。
14. **拖放三处兜底**（`index.tsx:2089-2118`、`2635-2640`、`dragdrop.ts`）：宿主的「文件拖入」遮罩永久卡死是 P0 级历史问题，注释写得很清楚，别简化。

---

## 11. 「设计感提升空间最大」的 3 处（按投入产出排序）

1. **左栏补齐主从结构（P0-1 + P1-2）**：选中态（`data-selected` 静态蓝轨）+「正在看：X」面包屑 + tabs 归位右栏。这一处同时解决「不知道在看谁」「死点击」「误删错人」三个问题，且只是样式 + 1 个 prop + tabs 挪位置，**S-M**。
2. **重新分配 1120 的头部（P1-1 + P2-1）**：主 CTA 上提到头部右侧，左栏只留搜索/排序/模式，统计数字不再两处重复。面板会立刻从「左栏很挤 + 右栏很空」变成「上行动 / 下分栏」，**M**。
3. **详情页动作区降噪（P1-4 + P1-5 + P2-7）**：hero 只留 1 主 1 次 + `⋯` 菜单，删除下沉到页面底部 dangerZone，边界说明压到 1 行 + 展开，「最近日记」真正只给最近 8 行 + 出口。这一屏现在有 6 个按钮 + 3 段说明 + 无限日记，是三块里最需要收的，**M**。

---

## 12. ⚠️ 待确认 / 未验证项

- **未在浏览器实机复验任何观感**（本阶段只读，且禁止 build）。以下结论依赖代码与 CSS 推理，建议实机确认：卡高是否真的 ~146px；`awu-grid` 在 340px rail 内是否恒 1 列；<900px 堆叠的实际观感；`--awu-rail-w` 加到 400 后 tabs/toolbar 是否换行。
- **宿主是否真的传 `wide` prop**（决定 P1-11 是否触发）。需看宿主 `sidebar.footer.action` 的 slot props 注入，本仓库内不可见。
- **`import.limit` / `import.tooLarge` 文案里的「16 MB」是硬写**（`text.ts:93-95`），而实际上限来自 `api.IMPORT_LIMITS`；若后端改上限，文案会随口不一致。未核对 `IMPORT_LIMITS` 当前值是否为 16MB 换算值。
- **日记「改写」多命中**（`text.ts:342` `diary.editMulti`）后端是否真的返回多命中计数——当前前端只看 `removedTimeline` 之类的 forget 结果，editDiary 的返回体未在本次审查范围。
- `styles.ts` 中 `.awu-sigil` / `.awu-idle` 作为 `.awu-status` 的别名保留（`styles.ts:686-690`），`index.tsx` 仍在用旧类（`2715, 2780, 2805`）→ 功能正常，但类名与「四态一形」的命名意图已脱节，属技术债，非缺陷。

---

## 13. 判定速查（按文件:行）

| # | 级别 | 文件:行 | 一句话 |
|---|---|---|---|
| P0-1 | P0 | `index.tsx:2964-2978` / `437-445` / `1997-2005` / `2259-2304` | 左栏无选中态，日记页可无声换操作对象 → 重置/忘记可能落错角色 |
| P1-1 | P1 | `index.tsx:2664-2707` / `2842-2859` | 头部只放 2 个图标，主 CTA 挤在 340px 左栏 |
| P1-2 | P1 | `index.tsx:2861-2878` / `2983-3098` | 分段器在左栏、内容在右栏，语义冲突 + 死点击 |
| P1-3 | P1 | `styles.ts:563-570` | <900px 纵向堆叠，右栏被推到列表下方；注释与实现不符 |
| P1-4 | P1 | `index.tsx:1487-1536` | hero 5-6 个同排动作，删除仅靠颜色隔离 |
| P1-5 | P1 | `index.tsx:1585-1587` / `373-412` | 「最近日记」渲染全部日记，无出口 |
| P1-6 | P1 | `index.tsx:1102-1115` vs `1157-1168` vs `1357-1362` | 危险确认：导入两步、删除/重置一步 |
| P1-7 | P1 | `index.tsx:2687-2696` | 刷新按钮无 loading 反馈、不禁用 |
| P1-8 | P1 | `index.tsx:2667` vs `text.ts:21` | 面板标题硬编码中文 |
| P1-9 | P1 | `text.ts:63/76/156-159/229` | 「启用/绑定/本会话/全局」三套口径 |
| P1-10 | P1 | `text.ts:190-192` / `index.tsx:2194-2202` | 删除不可撤销且无前置备份通道 |
| P1-11 | P1 ⚠️ | `index.tsx:1755-1757` | `useWideLayout` 用 prop 覆盖实测宽度，可能复现窄轨撑破 |
| P2-1..21 | P2 | 见各节 | 统计重复、状态带过载、卡片信息位、无搜索、栅格空转、空态、骨架形态、术语死键、<32px 目标、弹层按钮序、改写无提示、拆分与 memo、轮询签名等 |
