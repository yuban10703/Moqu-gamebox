# Kindle 版（兼容优先的第二套壳层）

给 **Kindle 自带浏览器**（老 WebKit）用的墨趣。与 Web/Android 版共用同一份游戏逻辑，
壳层是重写的：没有 React、没有构建期模块系统、没有 CSS 变量与 grid。

> 目标设备：Kindle Paperwhite 6（KPW6）一类**封闭、老引擎**的阅读器。
> 它装不了我们的 APK，只能用自带浏览器打开一个网页 —— 这就是这一版存在的全部理由。

## 技术选型对照（需求里那张表 → 实际实现）

| 需求里的模块 | 建议方案 | 实际做了什么 | 说明 |
|---|---|---|---|
| 页面结构 | HTML5 | `<html>` + 经典脚本 + `<noscript>` 兜底 | **不用** `type="module"`：Kindle 会整段忽略模块脚本，这正是当初白屏的根因 |
| 页面样式 | CSS | `kindle.css` 1414 行 | 纯遗留 CSS：无变量、无 grid、无 `calc()`、无容器查询、无 `gap`（守卫测试钉住） |
| 游戏逻辑 | JavaScript | **原样复用** 20 款玩法的 TypeScript 规则层 | 规则层本来就与呈现技术无关，这版一行没改 —— 现有 1800+ 条测试继续有效 |
| 棋盘渲染 | DOM 元素 | `<table>` + 内联 SVG，按格渲染 | 不用 Canvas（无法承诺局部刷新）、不用覆盖层（两套坐标系在真机错过位） |
| 网络请求 | XMLHttpRequest | 自检页与诊断页用它探测 XHR / XHR2 能力 | 应用本身**不发任何网络请求**（100% 离线，见下面一行）；XHR 在这里是"能力探针"而不是"资源加载器" |
| 实时通信 | HTTP 轮询 / WebSocket 可选 | **不做** | 按确认的范围：保持 100% 离线，不引入联机后端。斗地主的联机骨架（`packages/games/doudizhu/src/net`）在 Kindle 版里没有被接线 |
| 本地存储 | localStorage（需实测） | localStorage + core 的存档信封 | 自检页会实测读写；写入失败（配额/隐私模式）降级为"可玩但不落盘"并明确提示。**没有** IndexedDB、没有 CAS |
| 后端接口 | HTTP/HTTPS + JSON | **不要后端** | 产物是纯静态文件，可丢到任意托管；没有账号、没有权限、没有服务端 |
| Android 端 | Kotlin/Java + WebView | 不适用 | 沿用仓库既有的 APK 线（BOOX）；Kindle 是封闭平台装不了 APK，所以这条线存在的意义就是"网页" |
| 构建工具 | TypeScript、Vite 等，仅开发期 | **TypeScript + tsc**（不用 Vite） | 实测 Vite 8 的 rolldown **不支持 ES2015 以下**，无法产出 ES5；改用 `tsc --target ES5 --module AMD --outFile` |

> 需求里那句「以上是建议的技术选型，并不代表 KPW6 已经支持所有对应 API」正是这一版的出发点：
> 目标基线取的是**最保守的一档**（纯 ES5 + 无变量/无 grid 的 CSS），
> 这样无论 KPW6 的引擎新旧都能跑 —— ES5 是新引擎的子集。
> 真实能力由 `check.html` 在设备上测，不靠型号猜。

## 为什么是"第二套壳层"而不是"再降级一次 Web 版"

`docs/A01-device-baseline.md` 里记着之前的结论：**明确不支持 Kindle 自带浏览器**。
当时的理由是实测出来的，不是猜的：

- 它不认 `<script type="module">`，模块脚本被整段忽略 → `#root` 永远为空 → **白屏**；
- 它没有 CSS 变量与 grid，而 `packages/ui/src/styles.css` 里有约 190 处 `var(--)`、10 处 `display:grid`；
- 主界面排版的主骨架是**容器查询单位**（`cqw/cqh`，79 处）—— 那是 Chromium 105 起步的能力，
  在老 WebKit 上不是"样式差一点"，而是"整屏没有尺寸依据"。

也就是说，把 Web 版"降级"是行不通的：需要换的不是语法，是**布局手段与渲染方式**。
所以 Kindle 版是独立的一条构建线，产物在 `apps/kindle/dist/`。

## 架构：逻辑全复用，壳层全重写

```
packages/core          ─┐
packages/games/*（20）  ├─ 原样复用（纯 TS，无 DOM/React 依赖）
packages/library        ─┘   20 款玩法的登记表（Web 与 Kindle 共用同一份）
                              ↓
apps/kindle/src/            新壳层（ES5 目标）
  dom.ts                    极简 DOM 工具（建节点 + textContent，不拼 innerHTML）
  store.ts                  localStorage + core 的信封格式
  session.ts                会话状态机（对齐 packages/ui/src/session.ts 的语义）
  render/board.ts           棋盘渲染（BoardView → <table> + 内联 SVG）
  render/cards.ts           牌桌渲染（斗地主 / 空当接龙）
  render/duel.ts            对决面板渲染（恶魔轮盘赌）
  render/controls.ts        方向键 + 动作按钮
  screens/*                 库 / 详情 / 对局 / 设置 / 关于 / 诊断
  app.ts                    路由（自维护栈，物理返回键走它）
  boot.ts                   入口：能力闸 → i18n → 挂载
```

关键点：**玩法一行都没改**。`packages/core` 与 20 个 `packages/games/*` 里没有任何
DOM、React、WebView 依赖，`GameDef.view()` 产出的是**与呈现技术无关**的展示模型
（见 `packages/core/src/types.ts` 的文件头注释）。所以换壳层不动规则，20 款玩法的测试
与真机验收结论全部继续有效。

`packages/library` 是从 `apps/web/src/library.ts` **移出来**的（原路径**已移除**）：现在两个前端共用一份登记表，
再加游戏只需要改一处（`tools/scripts/check-games.mjs` 这道守卫也已指向新位置）。

## 工具链：为什么绕开 Vite

Vite 8 的打包器是 rolldown。实测（本仓库当前版本）：

```
$ node -e "require('rolldown').build({transform:{target:'es5'}})"
Error: [BUNDLER_INITIALIZE_ERROR] Invalid target 'es5'.
  Rolldown only supports ES2015 (ES6) and later.
```

也就是说，**整条 Vite 线无法产出 ES5**。而 `tsc` 可以：
`--target ES5` 会把 `async/await`、`class`、迭代、解构、可选链全部降级，
并内联 `__awaiter` / `__generator` / `__values` 等运行时辅助函数。

于是 Kindle 线的构建是：

```
tsc --target ES5 --module AMD --outFile dist/kindle.js
      （core + 20 款玩法 + 新壳层，一次编译成一个文件）
        ↓
public/polyfills.js   ES2015+ 的**运行时方法**补齐
public/amd-shim.js    60 行的 AMD 执行器（tsc 的 AMD 产物靠它跑起来）
        ↓
tools/scripts/build-kindle.mjs  复制资源 → ES5 守卫 → 体积报告
```

`module: AMD` 的选择理由：`tsc` 只有配 `outFile` 才能把多文件合成一份，
而 `outFile` 只支持 `amd` 与 `system` 两种模块格式。AMD 的 `define(name, deps, factory)`
用一个极小的执行器就能跑，且**产物本身仍是纯 ES5**。

### 语法与 API 是两件事

`tsc --target ES5` 只降**语法**，不补 **API**。所以产物的运行还依赖 `polyfills.js`
补齐的那些方法。这份清单不是猜的 —— 是把 `packages/core`、`packages/games/*`、
`packages/library`、`apps/kindle/src` 全量扫过一遍、统计实际调用点之后列出来的：

| 方法 | 规范版本 | 共用代码里的调用点数 |
|---|---|---|
| `Array.prototype.includes` | ES2016 | 106 |
| `Number.isInteger` / `isFinite` | ES2015 | 80+ |
| `Object.entries` / `values` / `fromEntries` | ES2017 / ES2019 | 5 |
| `String.prototype.startsWith` | ES2015 | 4 |
| `Array.prototype.flatMap` / `flat` | ES2019 | 2 |
| `Array.prototype.at` | ES2022 | 1 |
| `String.prototype.repeat` / `padStart` / `codePointAt` | ES2015 / ES2017 | 各 1 |
| `Number.parseInt` | ES2015 | 1 |

另外还补了 `Promise`、`Symbol`、`Set`、`Map`、`Object.assign`、`Array.from`、
`Array.prototype.find/findIndex`、`classList`，以及 —— 容易被漏掉的一个 ——
**`Array.prototype[Symbol.iterator]`**：`tsc` 的 `--downlevelIteration` 产物
（`__values` / `__read` / `__spreadArray`）会读这个键，而老引擎的数组上没有它。

`tsconfig.json` 的 `lib` 里**只声明确实补过**的那几个（`ES2016.Array.Include`、
`ES2017.String`、`ES2017.Object`、`ES2019.Array`、`ES2022.Array` 等）——
类型层放行、运行时缺失是最难查的一类问题，不允许出现。

## 布局手段：没有变量 / grid / container query 之后剩下的东西

| 现代做法（Web 版） | Kindle 版的做法 |
|---|---|
| `display:grid` 摆棋盘 | `<table>` + `table-layout:fixed`（等宽等高、无缝隙、不错行） |
| 容器查询 `cqw/cqh` 算格子边长 | **JS 算成像素**：`computeCellSize(cols, rows, width, height)`，取宽高两种约束的较小值，钳在 24–96px |
| CSS 变量传尺寸 | 内联 `style` 属性（`getAttribute('style')` 累加） |
| 现代 flex + `gap` | `float` / `display:inline-block` / `display:table-cell` + `margin` |
| `calc()` | 全部预先在 JS 里算好 |
| 覆盖层放整盘文字 | **一律按格渲染**（覆盖层与网格是两套坐标系，历史上真机整体错过位） |

1-bit 的呈现规则与 Web 版一致：**形状、线宽、反白**区分状态，绝不用灰度；
`flash` 反白、`banner` 横幅、`wrong` 覆盖叉、`lastFrom` 圆点、`lastTo` 内框、
`disc` 圆片、`groups` 加粗分组线，都按 `packages/ui/src/components.tsx` 的几何原样搬过来。

## 存档：格式相同，协议简化（这一点必须说清楚）

**相同的部分**：信封就是 `packages/core/src/save.ts` 的 `SaveEnvelopeV1`
（`schema/gameId/rulesVersion/contentVersion/difficulty/seed/state/moves/session/progress/updatedAt/commitId/checksum`），
键名是 `moqu:1:save:<gameId>`。也就是说 **Kindle 的存档可以导到 Web/Android 上继续**，
反之亦然（设置页有导出按钮，出来的是一段 JSON）。

**不同的部分**：Kindle 版**没有** pending/committed 两阶段提交与 CAS。
那套协议解决的是「多标签页 / 多端并发写，绝不静默覆盖别人刚写的进度」，
而 Kindle 浏览器是单进程单标签，`localStorage.setItem` 对单键本身就是原子的。
代价是：

- 并发写不会被告警（在 Kindle 上造不出这个场景）；
- 写入失败（配额满、隐私模式）降级为「本局可玩但不落盘」，并在界面上明确提示
  （`shell.storage.failed`），不假装保存成功；
- **坏档绝不静默覆盖**：读不出来时保留原始记录、提示用户，并从新局开始（与 Web 版同一口径）。

## 设备能力：**本仓库没有 KPW6 实测数据**

这一点必须直说，不能含糊：

- 本仓库的实测基线只有两台 BOOX（Chromium 146 / 156，见 `docs/A01-device-baseline.md`）；
- **没有任何一台 Kindle 上的实测记录**。KPW6 固件版本、引擎版本、可用 API 都**未经验证**；
- 因此 Kindle 版的目标基线取的是**最保守的一档**：纯 ES5 语法 + 无变量/无 grid 的 CSS +
  XHR/localStorage。这是"能在很老的 WebKit 上跑"的写法；如果 KPW6 的引擎其实很新，
  这套写法**照样能跑**（ES5 是子集），只是没有用到新能力而已。
- 你的需求说明里那句「以上是建议的技术选型，并不代表 KPW6 已经支持所有对应 API」——
  正是这个意思，所以这一版选了向下兼容而不是向上试探。

### 怎么在真机上把能力测清楚

打开 `check.html`（设备自检页）。它**不依赖任何外部文件**（无 CSS、无脚本引入），
所以在主应用跑不起来的时候它照样能用 —— 这正是它的用途。它会逐项打印：

- 环境：UA、视口、DPR、platform
- 主应用真正依赖的：`querySelector` / `addEventListener` / `createElementNS(SVG)` /
  `JSON` / `localStorage` 读写 / `XMLHttpRequest`（含 XHR2 的 `onload`+`responseType`）
- ES5 语法与常用方法：`forEach/indexOf/map`、`Object.keys`、`Object.defineProperty`、
  `Function.prototype.bind`、`Date.now` 等
- 样式能力：`border-radius`、`box-shadow`（含 `inset`）、`repeating-linear-gradient`、
  CSS 变量、`display:grid`、`display:table-cell`
- 交互：`touch` 事件、`keydown` 事件
- **实测耗时**：构建一个 81 格棋盘用多少毫秒（老 CPU 上最关键的指标）

页面底部会生成一段可直接选中复制的自检报告文本。

主应用内也有一个「诊断」页（`shell.diagnostics.title`），除了同样的能力探测之外，
还能**一键把 20 款玩法全部跑一遍**（`create → view → controls → status → encode → decode`），
逐款报出耗时。这一条比什么都直接：哪一款在真机上慢或直接抛错，一眼就能看到。

## 构建与运行

```bash
npm run build:kindle     # 构建到 apps/kindle/dist/（含 ES5 守卫与体积报告）
npm run serve:kindle     # 起一个绑定 0.0.0.0 的局域网服务，并打印 Kindle 能用的地址
npm run smoke:kindle     # 真实 Chromium 冒烟（31 项，截图落在 .kindle-shots/）
npm run check:es5        # 只跑手写脚本的 ES5 守卫
```

`smoke:kindle` 需要先 `build:kindle` 并起好服务（与 `smoke:web` 同一套约定）：

```bash
npm run build:kindle && node tools/scripts/serve-kindle.mjs apps/kindle/dist 8791 &
npm run smoke:kindle
```

Kindle 上的用法：把 `apps/kindle/dist/` 丢到任意静态托管（和 Web 版一样），
或者用 `npm run serve:kindle` 在本机起服务、让 Kindle 通过同一个 WiFi 打开它打印出来的
「局域网」地址。**注意**：Kindle 连不上绑在 `127.0.0.1` 的服务，
所以这个脚本特意绑 `0.0.0.0` 并打印本机局域网 IP。

`dist/` 是纯静态产物（`index.html` + 4 个 JS/CSS + `check.html`），没有服务端、没有权限要求。

## 部署到 Cloudflare Pages

Kindle 版与 Web 版是**两个独立的 Pages 项目**（产物不同：`apps/kindle/dist` vs `apps/web/dist`），
不要指向同一个项目。分支用 `kindle`。

### 面板里怎么填（Git 集成）

完整的字段表与踩坑记录见 [deploy-cloudflare.md](deploy-cloudflare.md)，这里只列要填的值：

| 字段 | 值 |
|---|---|
| 连接仓库 | 同一个仓库 |
| 生产分支（Production branch） | `kindle` |
| 框架预设（Framework preset） | `None` |
| 根目录（Root directory） | 留空（仓库根） |
| 构建命令（Build command） | `npm run build:kindle` |
| 构建输出目录（Build output directory） | `apps/kindle/dist` |

依赖安装不用自己加：Pages 检测到 `package-lock.json` 会先跑 `npm ci`。
如果构建日志里报找不到 `tsc`，把构建命令改成 `npm ci && npm run build:kindle` 即可。

**环境变量**：`NODE_VERSION` = `24`（与 Web 版那个 Pages 项目、以及仓库根的 `.nvmrc` 保持一致；
`.nvmrc` 不一定被构建镜像读取，显式设最稳。这套构建只用到 `tsc` 与 Node 自带的 fs/child_process）。

### 三个容易踩的点

1. **别走 Workers 那条路，也别和 Web 版共用项目。**
   仓库根的 `wrangler.jsonc` 声明的是一个 **Worker**，它的静态资源目录写死指向 `apps/web/dist`
   —— 那是现代版。Kindle 走的是 **Pages**，Pages 的构建配置只有「构建命令 + 输出目录」，
   不读这个文件（两套路线的关系与既有结论见 [deploy-cloudflare.md](deploy-cloudflare.md)）。
   真正要核对的是面板里那两格：构建命令 `npm run build:kindle`、输出目录 `apps/kindle/dist`。
2. **不要开 SPA 回退（Single-page application fallback）**。这个站点是多页静态：
   `/` 是 index.html、`/check.html` 是自检页，没有客户端路由，回退只会把 404 变成首页。
3. **产物文件名没有内容哈希**（`kindle.js` / `kindle.css` 名字固定），
   Pages 默认的长缓存会让你重新部署后、设备上仍是旧版。
   构建时已经带了一个 `_headers`（见 `apps/kindle/public/_headers`），
   把所有响应设成 `max-age=0, must-revalidate`：没变就是一次廉价的 304，变了立刻生效。

### 部署完，先在设备上做什么

用 Kindle 打开 `https://<你的域名>/check.html`（零依赖的自检页），**不要先开首页**：

- 能打开 = TLS / 网络 / 渲染链路都是通的（很老的 Kindle 上，HTTPS 本身可能就是第一道坎，
  这与我们的代码无关，但会先表现为"打不开"）；
- 再按自检页的结论判断能力；
- 最后才打开首页；如果首页白屏但自检页正常，那就是 bundle 层面的问题，
  把自检页底部那段报告抄下来即可定位。

### 如果你看到的是「部署命令 / 预览命令」这两格

那说明建的是 **Workers（Workers Builds）**，不是 Pages —— Pages 的构建配置里**只有**
「构建命令 + 构建输出目录」两格，没有部署命令（Cloudflare 读构建命令的退出码，成功后自己上传产物）。
两条路的区别见 [deploy-cloudflare.md](deploy-cloudflare.md) 开头那张表。

仓库根的 `wrangler.jsonc` 在本分支上**就是 Kindle 的配置**
（`name = moqu-gamebox-kindle`、`assets.directory = ./apps/kindle/dist`），所以部署命令直接用默认值即可：

| 字段 | 值 |
|---|---|
| 构建命令（Build command） | `npm run build:kindle` —— 必填，留空会直接跳到部署并报 `assets.directory ... does not exist` |
| 部署命令（Deploy command） | 留默认 `npx wrangler deploy` |
| 预览命令（Preview command） | 留默认 `npx wrangler preview`（或 `npx wrangler versions upload` 拿版本 URL） |
| 根目录（Root directory） | 留空（npm workspaces 单仓，依赖必须在根装） |
| 构建变量 | 一般不用设：镜像默认 Node 24.18 且会读仓库根的 `.nvmrc`；要固定则设 `NODE_VERSION=24` |

配置里的 `name` 必须与你在 Cloudflare 上那个 Worker 同名（现为 `moqu-gamebox-kindle`）。

### 换个方式：本地构建后直传

不想让 Cloudflare 跑构建（或者想在本地先看一眼）时，产物目录被 gitignore，所以要先本地构建：

```bash
npm run deploy:cf    # = build:kindle + wrangler pages deploy（项目名 moqu-gamebox-kindle，分支 kindle）
```

首次要先把项目建出来：

```bash
npx --yes wrangler pages project create moqu-gamebox-kindle --production-branch=kindle
```

## 测试

新增两道守卫，都挂在 `npm test` 里：

- `apps/kindle/test/es5-guard.test.ts`
  - 手写的 `polyfills.js` / `amd-shim.js` 必须**逐字节纯 ES5**；
  - `index.html` / `check.html` 的**内联脚本**同样必须是纯 ES5
    （它们先于一切执行，最不能出错）；
  - 入口页必须是**经典脚本**且按 `polyfills → amd-shim → kindle` 顺序同步加载
    （`type="module"` 或 `async/defer` 都会让这套链路失效）；
  - 构建产物 `dist/*.js` 存在时一并检查（这就是 tsc 的 downlevel 有没有漏的判据）；
  - `kindle.css` 里不得出现 `var(--)`、`display:grid`、`cqw/cqh/dvh`、`:has()`、
    `color-mix()`、`@container`、`calc()`、`minmax()/clamp()`、`gap`
    —— 每一条都是"BOOX 上没事、Kindle 上整块失效"的东西。
- `apps/kindle/test/shell.test.ts`（jsdom）
  - 游戏库把登记表里的玩法列出来，且有翻页控件；
  - **逐款玩法**：建局、出视图、必须有呈现模型（棋盘/牌桌/对决之一）、
    棋盘的 `cells.length === cols × rows`；
  - 棋盘真的渲染成 DOM `<table>`，格子类名正确；
  - 点格子不抛错、不白屏；
  - 存档写进 localStorage 且是 core 的信封格式（字段齐全，能跨端读）；
  - 设置页切语言即时生效；
  - 诊断页跑完全部自检后显示 `20 / 20`。
- `apps/kindle/test/artifact-boot.test.ts`（jsdom）—— **最重要的一条**
  - 把 `dist/` 里**真正要发给 Kindle 的那三个文件**按 `index.html` 的顺序跑一遍：
    `polyfills.js` → `amd-shim.js` → `kindle.js`；
  - 断言 AMD 真的执行了 160+ 个模块、**没有卡在等待依赖的模块**（`pending === 0`）；
  - 断言壳层挂载后渲染出了游戏库（看得到「推箱子」与「下一页」）；
  - 断言 polyfill 补齐的那些方法确实都在（含 `Array.prototype[Symbol.iterator]`）。

  这条测试的价值：这套链路上**每一环都不在源码里** —— 语法降级、AMD 执行、
  运行时补齐、挂载渲染。逐环"看起来都对"没有意义，串起来跑一次才算数。
  它已经逮住过一个真 bug：`polyfills.js` 里写 `var Symbol = ...` 会在 IIFE 作用域内
  **遮蔽**全局 Symbol，赋值又只在 `if` 分支里发生 —— 于是在**原生就有 Symbol** 的引擎上，
  后面的 `Array.prototype[Symbol.iterator] = ...` 直接抛错（Kindle 上没有原生 Symbol，
  所以只有现代浏览器会踩到，属于"在开发机上炸、在目标机上不炸"的反向 bug）。

守卫逻辑（`findEs5Violations`）放在 `tools/scripts/check-es5.mjs`，
**构建脚本与测试共用同一份实现** —— 两处各写一份判据迟早会分叉。

Kindle 版有四条真实浏览器的脚本，分工不重叠：

| 脚本 | 命令 | 查什么 |
|---|---|---|
| `kindle-smoke.mjs` | `npm run smoke:kindle` | 冒烟：渲染出来了、没有报错（31 项） |
| `kindle-explore.mjs` | `npm run explore:kindle` | 探索：把 UI 点一遍，撞"点了没反应"（含滑动、终局、极端视口） |
| `kindle-audit.mjs` | `npm run audit:kindle` | **全量**：所有页面 × 20 款玩法 × 横竖屏，逐项量尺寸 |
| `kindle-play.mjs` | `npm run play:kindle` | **玩法**：40 组（20 款 × 2 方向）各做 18 次输入，验推进/撤销/重开 |

`kindle-audit.mjs` 量的是排版，每一项都是能量出来的，不靠肉眼：
缺键 ⟦key⟧ / 未替换参数、整页滚动、主内容与呈现区被页脚盖住或被裁、
触摸目标小于 44×44、文字溢出容器。

`kindle-play.mjs` 量的是玩法：局面**有没有推进**（不是"点了不报错"就算数）、
撤销能否退回上一步、重开能否回到本局初始局面（自动步进的玩法跳过这条）、
全程无未捕获异常。

`tools/scripts/kindle-explore.mjs`（`npm run explore:kindle`）是**探索式缺陷探测**：
把 UI 真的点一遍 —— 20 款玩法逐款走「详情 → 开局 → 点棋盘 → 点控件 → 方向键 → 撤销 → 暂停菜单」，
再加触摸滑动、视口矩阵（竖屏/横屏/小屏/极矮横屏的裁切）、以及把一局井字棋打到终局。
每一步都查：无 JS 错误、无缺键、无未替换参数、页脚在视口内、不滚动、按钮有文字，
以及**「合法操作必须有反应」**（区分"被拒绝但有提示"和"完全没反应"）。

另外还有一条**真实 Chromium** 的冒烟脚本 `tools/scripts/kindle-smoke.mjs`（31 项断言）：
启动链路 → 游戏库 → 逐款玩法（棋盘 / 牌桌 / 对决三种呈现面各取几款）→ 自检页，
每步都验「无缺键、无未替换参数、页脚主操作在视口内、整页不滚动」。

它存在的理由很具体：jsdom 的三条守卫**都没有真实布局**，而 Kindle 版最特别的地方恰恰是布局
（容器查询 / grid / 现代 flex 全不可用，格子边长是 JS 算出来的，页面不能滚动）。
它已经逮住两个真缺陷，两个都是**只看代码看不出来**的那种：

| 缺陷 | 现象 | 根因 |
|---|---|---|
| 分页按"每行 56px"猜 | 第一页塞 8 项后溢出，**分页器被顶出屏幕**（后 12 款玩法够不着） | 实际行高约 93px；且漏算了 CSS 给绝对定位页脚预留的 `margin-bottom:168px`。现改为**量顶栏底边到页脚顶边的那条带子**，不再依赖任何常数 |
| `shell.library.page` 应传 `{index}` | 屏幕上印着字面的 `第 {index}/2 页` | 缺 key 会显示 `⟦key⟧`（刻意设计，容易发现），但**参数名对不上不会报错**，只是把占位符原样打出来 —— 更阴 |

后一类现在由 `shell.test.ts` 的「文案完整性」用例兜住：两种语言 × 6 个屏幕，
既查 `⟦key⟧` 也查残留的 `{param}`。

## 自测记录：这一轮找到并修掉的缺陷

用 `tools/scripts/kindle-explore.mjs`（真实 Chromium，把 UI 真的点一遍）逐款玩法扫出来的。
记在这里是因为**其中几条只有"把产物跑起来"才看得见** —— 本地 vitest 跑的是源码，
走的是原生 class / 非 ES5 路径，全都正常。

| # | 现象 | 根因 | 守卫 |
|---|---|---|---|
| 1 | 非法操作变成未捕获异常：**点了没反应 + 控制台报错**（扫出 10 处） | `tsc --target ES5` 把 `class extends Error` 降级后原型链是断的（`Error.call(this)` 返回新对象），`instanceof IllegalActionError` **恒为 false** —— 规则层的 isLegal 与壳层的提示全失效 | core 里 `linkErrorSubclass` 接回原型；`artifact-boot.test.ts` 对**产物**断言 instanceof（撤掉修复就红，已验证） |
| 2 | 关卡制玩法选了第 N 关，进去永远是第 1 关 | 会话把"派发 startLevel"卡在了 `game.controlAction !== undefined` 上，而**推箱子既支持 startLevel、又没有 controlAction**（华容道恰好有，所以只有推箱子中招） | `shell.test.ts`：选第 4 关的棋盘必须与第 1 关不同（撤掉修复就红） |
| 3 | 结果面板显示 ⟦tictactoe.result.moves⟧ | 字典里只有 `__one`/`__other` 复数键，壳层却用普通 `t()` 取 | 壳层补 `ctx.plural`；探索脚本打通一局井字棋到终局 |
| 4 | 详情页印出「本关最佳 {count} 步」 | 该键的值**本身含 `{count}`**，却被当纯标签用 `t()` 取（参数没传） | 逐款详情页守卫（20 款 ×2 语言，且预置战绩让这一行真的渲染出来） |
| 5 | 存储写不进去时**一句提示都没有** —— 玩家读一小时才发现进度全丢 | `!canPersist` 分支只更新内部状态、没通知壳层；且等到第一次落盘才检查 | 开局即报 + 常驻警告行（带「重试」）；`shell.test.ts` 模拟 setItem 抛错 |
| 6 | 「这里不能这样点」在后续成功走子后仍挂在屏幕顶上 | 壳层清了内部状态但没回调，界面不知道要收 | 提示统一走 `setNotice()`，变化必回调 |
| 7 | 结果面板的明细全挤在一行 | 文本节点里的 `\n` 在 HTML 里是空格 | `showDialog({ bodyLines })` 逐行建节点 |
| 8 | 设置页写着「用滑动操作」，但**壳层根本没实现滑动** | 提示与实现脱节；且提示放错了地方（设置页与具体玩法无关） | 实现触摸滑动（判据同 `supportsSwipe`）；提示改到详情页且只在真能滑动时显示；探索脚本逐款验滑动 |
| 9 | 推箱子的标题与统计栏都不显示"第几关" | 标题只显示了难度，而关卡制玩法隐藏了难度区 | 标题显示「第 N/M 关」；`shell.test.ts` 断言 |

**同一轮里我自己的探针也误报过两次**，一并记下来，因为它们说明"测试红了"不等于"应用坏了"：

- 一开始用 `textContent` 做界面快照，而「选中」这类反馈**只改样式与 data 属性、不改文字**
  —— 于是 klotski/sudoku 的"点了有反应"被误判成"没反应"。改用 `outerHTML`。
- 井字棋"走不到终局"：探针固定点第 i 格，一直在点已被对手占掉的格子。改成每次点一个 `data-kind="empty"` 的格子后，5 步就正常出结果面板。
- 另外「推箱子/2048/贪吃蛇/俄罗斯方块点棋盘没反应」是**设计如此**（方向键驱动、没有 `selectAction`），
  不是缺陷 —— 探索脚本现在会先问 `isCellSelectable()` 再决定要不要求"有反应"。

## 自测记录（第二轮）：把每一屏、每一款、每个方向都量一遍

第一轮靠"点几下 + 抽样四个视口"，漏掉了整类问题。这一轮换成**穷举**：
所有页面 × 20 款玩法 × 横竖屏，逐项量尺寸；再加 40 组玩法实测。
第一轮 9 条，这一轮又找出 4 类，**全部是"页面上不报错、只是内容看不见/点不到"**：

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 数织的棋盘高 1383px，一屏只有 1024 —— 被裁掉一半 | 线索带按"占一格"估尺寸，而线索字号又随格子等比放大：5 段列线索要 5 行文字，把那一行撑到 **748px**。同时 CSS 里 `.k-board__clue-col` 是 `float:left`（为浮动布局写的），而渲染器输出的是 `<th>` —— 浮动作用在表格单元格上会打乱行高计算 | 线索字号固定、带子厚度按**线索条数**算；CSS 改成表格单元格语义 |
| 2 | 中国象棋/国际象棋竖屏溢出 7~31px；斗地主横屏手牌被切、有张牌落在屏幕外 | 棋盘高度是拿**常量**估的（顶栏 52、统计 30、页脚 60~150），而实测是顶栏 65、统计 65、页脚竖屏 156/横屏 100、吃子盘 48×2 —— 差得很远 | 渲染后按**实测**的可用带子收敛，最多 4 次 |
| 3 | 收敛了两次仍差 30~70px（斗地主 756px 缩不动、恶魔轮盘赌 588px） | 牌桌/对决渲染器的尺寸是按 `ctx.height` **比例**推的，而斗地主总高由**宽度**决定 —— 压高度预算它纹丝不动（实测：预算 858 → 720，渲染高度仍是 756）。另外空当接龙的根元素是 `.k-piles`，收敛逻辑压根没量到它 | 收敛逻辑补上 `.k-piles`；仍不行则整体缩放（下限 0.85）；对决面板先砍"对战记录"这块有让步空间的 |
| 4 | 诊断页内容 892px、可用只有 730（横屏 522）—— 底部包括「跑一遍自检」按钮与报告永远够不着 | 这个版本刻意不做滚动，而自检页内容天然高于一屏 | 按**实测块高**贪心分页（与游戏库同一套做法） |

另外加了一条**保底**：极矮屏幕（实测 900×520、600×800）上对决面板要 730px、可用只剩 390px，
缩放会低于 0.85（字糊、触摸目标掉到 44px 以下）——这时改为**允许主内容滚动**。
"能滚一下够到底部"比"缩到看不清"或"裁掉看不见"都好；常规视口仍是不滚动的。

**这一轮我又误报了 5 次**，都记下来，因为它们说明"测试红了"要先怀疑探针：

- 把 `.k-dpad button` 的**最后一个**当成「重开」——实际 DOM 顺序是 `↶, 上, ↻, 左, 下, 右`，
  于是"重开"点成了"右方向"。
- 推箱子/2048 **有棋盘但点不动**（方向键驱动、没有 `selectAction`），我却一直在点格子。
- 牌桌与对决面板里根本没有 `.k-board__cell`，我还在那儿点。
- 恶魔轮盘赌两侧各 8 个**空道具位**是常驻的，点了什么都不会发生；该按渲染器暴露的
  `data-selectable` / `data-stealable` 筛。
- 数字华容道要点**数字块**，而我的启发式"优先点空格"点的正是那个空位；
  另外我把"有提示"当成了"不算问题"，与统计行的口径不一致 —— 同一份数据两个结论。

## 已知限制

1. **没有 KPW6 实测**（见上）。当前的验证止步于：
   - jsdom：ES5 纯度、产物能启动、20 款玩法逐款建局、文案完整性；
   - **真实 Chromium**（`smoke:kindle`，31 项）：启动链路、游戏库分页、7 款玩法的三种呈现面、
     自检页、无未捕获错误。

   也就是说「代码能在浏览器里正确渲染」是有证据的；**「KPW6 的引擎认不认这些语法与 CSS」
   仍然没有证据** —— 这正是 ES5 守卫与 `check.html` 存在的原因。
   真机上还需要实测的：触摸精度与抖动（决定"点格子"是否会被判成滑动）、
   翻页键上报的键码、整屏刷新后的残影与对比度。
2. **单包 1.5 MB（未压缩）/ 374 KB（gzip）**。没有做按玩法分包：`tsc --outFile` 会把
   可达模块全部内联，而"每款玩法一个文件"需要先给 `packages/core` 单独发 `.d.ts`、
   再把壳层改成读"构建期生成的元数据清单"（否则游戏库列表本身就要加载全部玩法）。
   体积分布（实测，按包聚合）：

   | 部分 | 未压缩 | 说明 |
   |---|---|---|
   | 壳层（`apps/kindle/src`） | 178 KB | 渲染器 + 屏幕 + 会话 |
   | `packages/core` | 106 KB | 含 27 KB 的 `storage.ts`（Kindle 版其实没用到它的两阶段协议） |
   | 20 款玩法 | 1057 KB | 最大的四款：中国象棋 88、斗地主 82、国际象棋 78、恶魔轮盘赌 67 |
   | `packages/library` | 15 KB | 20 款玩法的登记表 |

   作为对照，同一份玩法在 Web 版里是 **189 KB（gzip，已压缩）**；
   Kindle 版没有做压缩，所以是 374 KB —— 差距主要来自"未 minify"而不是"代码变多"。
   真机上如果解析时间不可接受，下一步的优先顺序是：
   ① 先接一个不引入新语法的压缩步骤（当前工具链里没有可用的 ES5 安全压缩器）；
   ② 再考虑按玩法分包。
3. **物理键映射是按常见键码猜的**：方向键 37–40、`U` 撤销、`R` 重开、`Esc/Backspace` 返回。
   Kindle 各代的翻页键上报什么键码没有实测，`check.html` 里的 `keydown` 一项只能确认事件存在，
   具体键码需要真机按一遍（诊断页已经把 UA 与视口打出来，方便对账）。
4. **没有音效、没有动画**（与 Web 版一致，墨水屏上这两样只会添乱）。
5. **不提供联机**：保持 100% 离线（`packages/games/doudizhu/src/net` 的联机骨架在 Kindle 版里没有被接线）。
