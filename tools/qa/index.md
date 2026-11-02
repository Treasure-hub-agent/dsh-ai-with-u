# QA / 取证工具链（`tools/qa/`）

> 全部**仅开发用**：这些脚本不进 `lib/`、不随插件发布、也不属于 `npm run build` 的任何一步。
> 它们只读源码 / 驱动一个 headless Chromium 去看沙盒页面。

## 一、四个脚本各管什么

| 脚本 | 一句话 | 依赖 |
|---|---|---|
| `shots.mjs` | 截图矩阵（浅色/深色/窄窗/降级态），产物 + `index.md` | 沙盒 59621 |
| `crash.mjs` | 验 `PanelBoundary` 的**降级路径**（`?crash=1`）：出「重试」、不白屏、无未捕获异常 | 沙盒 59621 |
| `collapse.mjs` | 三处折叠体（世界书行 / 日记按月 / 预览分段）的**退场时序**采样 | 沙盒 59621 |
| `states.mjs` | 加载态 / 报错态（`?slow=` / `?fail=`）的实机采样 | 沙盒 59621 |
| `cdp.mjs` | 上面三个共用的最小 CDP 驱动（不引 playwright）+ 断言小工具 | — |

```bash
# 先起沙盒（每次请求重新打包，所以改完 client 刷新即可）
node tools/preview/serve.mjs

# 然后随便跑
node tools/qa/shots.mjs                    # 截图矩阵 → 06-tmp/ui-audit/matrix/
node tools/qa/shots.mjs --only=preset      # 只跑名字含 preset 的场景
node tools/qa/crash.mjs                    # 崩溃探针（10 条断言）
node tools/qa/collapse.mjs                 # 折叠时序（每处 6 条断言）
node tools/qa/states.mjs                   # 加载/报错态（15 条断言）
node tools/qa/shots.mjs --media=reduce-motion --out=06-tmp/ui-audit/matrix-rm
```

所有脚本都支持 `--out=<目录>` 改产物落点，退出码 0 = 全过。

## 二、沙盒场景开关（`tools/preview/preview.tsx` 文件头有完整说明）

| 开关 | 作用 | 用来验 |
|---|---|---|
| `?live=1` | 模拟「已启用一张卡」 | 启用态横幅 / 日记时间线 / 详情页 |
| `?dark=1` | 强制深色 | 深色态（`index.html` 里打 `data-ds-dark-theme`） |
| `?slow=1200` | 所有 fixture 响应延迟 N ms | 骨架屏 / 加载提示 |
| `?fail=presets` | 该路由返回 500 + `{ok:false,error}` | ErrorBar（可逗号组合、`all` 全挂） |
| `?fail=preview` | 同上（注入预览） | ErrorBar |
| `?crash=1` | 让面板量自己尺寸时抛错（只对 `.awu-layer`） | `PanelBoundary` 降级 UI / 重试 |

> `?crash=1` 为什么不是「传一个会抛错的 `t`」：面板的 `t` 一律经 `makeTranslator` 包一层，
> 它对每次调用都 try/catch 并回落中文词典 —— 抛错的 `t` 会被**完全吸收**，崩不了。
> 往 fixture 里塞毒对象也不行：请求走 `res.text()` + `JSON.parse`，毒对象在
> `JSON.stringify` 那一步就被序列化成了普通 JSON。详见 `tools/preview/preview.tsx`
> 里 `installCrashProbe` 的三次踩坑记录。

## 三、截图矩阵的场景表

`shots.mjs` 的 `SCENES` 就是验收清单，跑完会在产物目录生成 `index.md`（图 ↔ 验收项对照表）。
当前覆盖：浅色主流程 7 张 · 加载/报错态 4 张 · 深色 4 张 · 窄窗 5 张（1024/900/820/560）。

> 加载态场景用 `?slow=30000`，不是 1200。原因：从导航到截图的耗时**不稳定**
> （实测 2.6s ~ 10s，头一次跑还要等 esbuild 重打包），任何"够用就好"的延迟都会偶尔
> 截到"刚加载完"的图（已经撞到两次）。把延迟拉到远大于场景时长，才能保证那张图
> 截到的就是加载态。场景表里也写了这条原因，改的时候别手贱调小。

## 四、三个「以前没验过」的遗留项与它们的证据

| 遗留 | 现状态 | 证据 |
|---|---|---|
| 预设/预览的 loading 与报错态从没实跑过 | 沙盒补了 `/presets` `/preset` `/preview` 三条路由 + `?slow` / `?fail` | `states.mjs` 15 条断言全过；截图 `state-1…6-*.png` |
| ErrorBoundary 崩溃路径没活验 | `?crash=1` + `crash.mjs` 10 条断言 | `crash-1-fallback.png` / `crash-2-after-retry.png` |
| 三处折叠「缺 fixture 未验」 | fixture 补了 `ccv3.data.character_book`（4 条世界书）+ 跨月日记 + 六段预览 | `collapse.mjs` 每处 6 条断言，实测 `closing@2ms` / `removed@165ms` |

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
