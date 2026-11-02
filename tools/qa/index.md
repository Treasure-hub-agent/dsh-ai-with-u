# QA / 取证工具链（`tools/qa/`）

> 全部**仅开发用**：这些脚本不进 `lib/`、不随插件发布、也不属于 `npm run build` 的任何一步。
> 它们只读源码 / 驱动一个 headless Chromium 去看沙盒页面。

## 一、四个脚本各管什么

| 脚本 | 一句话 | 断言数 | 依赖 |
|---|---|---|---|
| `shots.mjs` | 截图矩阵（浅色/深色/窄窗/加载态/报错态/会话绑定），产物 + `index.md` | 每场景 F1–F5 五类 | 沙盒 |
| `crash.mjs` | 验 `PanelBoundary` 的**降级路径**（`?crash=1`）：出「重试」、不白屏、无未捕获异常、**崩的是探针那个错** | 11 | 沙盒 |
| `collapse.mjs` | 三处折叠体（世界书行 / 日记按月 / 预览分段）的**退场时序**采样 | 18（每处 6） | 沙盒 |
| `states.mjs` | 加载态 / 报错态（`?slow=` / `?fail=`）+ 面板「重试」真能重发请求 | 23 | 沙盒 |
| `cdp.mjs` | 上面三个共用的最小 CDP 驱动（不引 playwright）+ 断言小工具 + `assertSandbox` | — | — |

```bash
# 先起沙盒（每次请求重新打包，所以改完 client 刷新即可）
node tools/preview/serve.mjs          # 默认 59621；被测时可用 PORT=59622 另起一个

# npm 入口（同样**不进 build**，见第二节）
npm run qa:matrix
npm run qa:crash
npm run qa:collapse
npm run qa:states

# 直连
node tools/qa/shots.mjs                     # 全量矩阵 → <工作区>/06-tmp/ui-audit/matrix/
node tools/qa/shots.mjs --only=preset-*     # 前缀匹配（`*` 结尾才当前缀）
node tools/qa/shots.mjs --only=light-roster # 精确匹配这一个场景
node tools/qa/shots.mjs --media=reduce-motion
```

**退出码就是结论**：`0` = 所有断言通过；`非 0` = 有失败（末尾会列 `场景 [F1..F5] 原因`）。
所有脚本都支持 `--out=<目录>` 改产物落点，默认写到**仓库外**的 `<工作区>/06-tmp/ui-audit/`。

> 端口会先**认领**：`assertSandbox` 检查 `index.html` 的标题标记。59621 上可能是别人的
> 服务（照样返回 200），认不出就直接 `exit 1` 并提示换端口 —— 不然后面的断言全是自欺。

## 一·五、为什么这些脚本**不进 build**

`npm run build` 必须是「只读源码 + 产物」的纯离线流程；QA 脚本要
**真的起 Chromium、点页面、截图**，还要一个活着的沙盒服务（`tools/preview/serve.mjs`）。
把它塞进 build 会有三个后果：CI 无浏览器必红、构建时间从秒级涨到分钟级、
以及"构建失败"与"界面长歪了"混在同一个红灯里。所以它们只做 `npm run qa:*` 入口。

## 一·六、截图矩阵怎么判红（F1–F5）

| 码 | 判据 |
|---|---|
| F1 | 导航没落到本沙盒（about:blank 竞态 / 端口上是别的服务 / 404） |
| F2 | `/bundle.js` 非 200、是打包失败页、或体积异常小（< 200 KB） |
| F3 | 步骤点到不存在的元素（步骤表达式直接 throw，不再 `?.click()` 吞掉） |
| F4 | 截图 < 40 KB（空白页/纯壁纸量级） |
| F5 | 截图与"同 URL、同尺寸、什么都不点"的基线**像素栅格差 < 1.5%**（步骤等于没生效） |

F5 是这套矩阵的关键：它抓的是"选择器改了、面板没打开、弹层没弹出来"这类问题——
以前会产出一张"看起来还行但少了面板"的图，人眼很难发现。

## 二、沙盒场景开关（`tools/preview/preview.tsx` 文件头有完整说明）

| 开关 | 作用 | 用来验 |
|---|---|---|
| `?live=1` | 模拟「已启用一张卡」 | 启用态横幅 / 日记时间线 / 详情页 |
| `?bound=1` | 模拟「本会话已绑定」（带 sessionId + bindings.current + preset.current） | 会话绑定 / 预设摘要 / 纪律档位 |
| `?dark=1` | 强制深色 | 深色态（`index.html` 里打 `data-ds-dark-theme`） |
| `?slow=1200` | 所有 fixture 响应延迟 N ms | 骨架屏 / 加载提示 |
| `?fail=presets` | 该路由返回 **400** + `{ok:false,error}`（宿主唯一会用的失败形状，见 web.ts 的 guard） | ErrorBar（可逗号组合、`all` 全挂） |
| `?fail=preview` | 同上（注入预览） | ErrorBar |
| `?fail=characters` | 同上（角色簿） | 面板级 ErrorBar + 真的能点的「重试」 |
| `?crash=1` | 让面板量自己尺寸时抛错（只对 `.awu-layer`） | `PanelBoundary` 降级 UI / 重试 |

> `?crash=1` 为什么不是「传一个会抛错的 `t`」：面板的 `t` 一律经 `makeTranslator` 包一层，
> 它对每次调用都 try/catch 并回落中文词典 —— 抛错的 `t` 会被**完全吸收**，崩不了。
> 往 fixture 里塞毒对象也不行：请求走 `res.text()` + `JSON.parse`，毒对象在
> `JSON.stringify` 那一步就被序列化成了普通 JSON。详见 `tools/preview/preview.tsx`
> 里 `installCrashProbe` 的三次踩坑记录。

## 三、截图矩阵的场景表

`shots.mjs` 的 `SCENES` 就是验收清单，跑完会在产物目录生成 `index.md`（图 ↔ 验收项对照表）。
当前覆盖：浅色主流程 7 张 · 会话绑定 1 张 · 加载/报错态 4 张 · 深色 4 张 · 窄窗 5 张 = **21 个场景**。`--only` 是精确名或 `prefix*`（见上文）。

> 加载态场景用 `?slow=30000`，不是 1200。原因：从导航到截图的耗时**不稳定**
> （实测 2.6s ~ 10s，头一次跑还要等 esbuild 重打包），任何"够用就好"的延迟都会偶尔
> 截到"刚加载完"的图（已经撞到两次）。把延迟拉到远大于场景时长，才能保证那张图
> 截到的就是加载态。场景表里也写了这条原因，改的时候别手贱调小。

## 四、三个「以前没验过」的遗留项与它们的证据

| 遗留 | 现状态 | 证据 |
|---|---|---|
| 预设/预览的 loading 与报错态从没实跑过 | 沙盒补了 `/presets` `/preset` `/preview` 三条路由 + `?slow` / `?fail` | `states.mjs` **23** 条断言全过（含"UI 显示的是宿主信封原文"与"重试真的重发请求"）；截图 `state-*.png` |
| ErrorBoundary 崩溃路径没活验 | `?crash=1` + `crash.mjs` **11** 条断言（含"崩的是 crash probe 那个错"的归因断言） | `crash-1-fallback.png` / `crash-2-after-retry.png` |
| 三处折叠「缺 fixture 未验」 | fixture 补了 `ccv3.data.character_book`（4 条世界书）+ 跨月日记 + 六段预览 | `collapse.mjs` 每处 6 条断言（共 18），实测 `closing@2ms` / `removed@165ms` |

## 五、产物落点

默认 `06-tmp/ui-audit/`（仓库外的工作区目录）：

```
06-tmp/ui-audit/
├── matrix/                     shots.mjs 默认产物（含 index.md）
├── matrix-rm/ matrix-rt/ matrix-hc/   降级态矩阵
├── crash-1-fallback.png        崩溃降级 UI
├── crash-2-after-retry.png     点重试后仍是降级 UI
├── collapse-1-lore.png         世界书行（收起后）
├── collapse-2-diary.png        日记按月
├── collapse-3-preview.png      预览分段
└── state-1…6-*.png             加载态 / 报错态
```
