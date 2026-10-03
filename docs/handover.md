# 交接说明（墨水屏游戏盒子）

## 0. 检查点（第 35 轮，已验证）

| 项 | 值 |
|---|---|
| 提交数 | 72（工作区干净）|
| 游戏 | **18 款** |
| 单元测试 | **1286**（`npm run check`）|
| 探索套件 | 5 个（`npm run explore`），断言数见运行输出 |
| 一键验证 | `npm run verify` 全绿 |
| 文档核对 | `npm run check:docs`（并入 `npm run check`）：命令/路径/游戏数与现实不符即失败 |
| 接入完整性 | `npm run check:games`（并入 `npm run check`）：逐款核对 5 个接入点 + i18n + 无 Math.random + 有测试 |
| 真机 | `tools/device/verify-device.sh 10.1.1.69:5555 9333` 全绿（9 款审计，退出码可信）|
| 构建 | Onyx SDK **默认内置**（3.4MB；排除后 2.5MB）|
| 视口覆盖 | 竖屏 / 正常横屏 / 极矮横屏 / 最大字号 / **极矮横屏+最大字号（最受限组合）** |
| 已闭环的布局项 | 首页大字号溢出、棋盘裁切、方向盘越界、极矮横屏棋盘、密集网格坍缩 |

**先看一眼状态**：`npm run status`（游戏数 / 测试数 / 套件数 / 真机入口 / 元检查 / 工作区 / 最近提交）。

**接手只需两步**：① 按第 5 节装一次 Playwright；② `npm run verify`。
真机再加一条 `tools/device/verify-device.sh`（需要设备在同一网络）。


> 面向"下一个人（或下一轮的我）"：这个项目当前是什么状态、有哪些不能违反的约定、
> 怎么继续加游戏、还有哪些没做完。所有结论都来自真机或可重复的自动化验证。

## 1. 项目形态

npm workspaces monorepo，TypeScript 严格模式，**DOM/SVG 优先（无 Canvas）**、**纯黑白 1-bit（不用灰度/颜色）**、无动画。

```
packages/core          纯函数内核：GameDef 契约、种子随机、存档协议、布局计算、i18n、诊断
packages/platform      平台适配：IndexedDB（Web）/ 原生 SQLite（Android）、Onyx 刷新、备份导入导出
packages/ui            React 壳层：屏幕、组件、样式（styles.css 是唯一的样式来源）
packages/games/*       9 款游戏，每款一个独立包（见下）
apps/web               网页版入口 + library.ts（**游戏注册表，唯一一处登记**）
apps/android           BOOX WebView 壳 + Onyx SDK（反射调用；**默认打进 APK**，见下）
tools/scripts          verify-all / 5 个探索套件 / 静态服务 / i18n 扫描 / 构建与部署脚本
docs/                  架构、验收、墨水屏规范、刷新适配、真机基线、本交接说明
```

## 2. 游戏契约（`packages/core/src/types.ts`）

必填：`id` `rulesVersion` `contentVersion` `i18nNamespace` `difficulties` `create(seed,difficulty)`
`reduce(state,action)` `legal(state)` `status(state)` `view(state)` `controls(state)` `encode/decode`。

可选钩子（**新游戏按需实现，壳层会根据是否提供来接线**）：
- `selectAction(state,index)`：点格子 → 动作（数独/扫雷/黑白棋/数字华容道/五子棋/四子棋/记忆配对用）
- `controlAction(state,controlId)`：点自定义按钮 → 动作（数字键盘、标记模式、方向键等）
- `contentId(state)`：内容 id（无关卡玩法返回难度 id）
- `movesOf(state)`：计步（用于"最佳成绩"）

呈现约定：
- `CellView.glyph` 是**格内文字**（数字类玩法直接放数字）；`kind` 决定壳层画图形还是显示文字
- `kind` 取值：推箱子的 7 种 + 通用 `empty/hidden/flag/mine/number/tile/given`
- `selected` 高亮当前格；`textScale` 由游戏声明字号系数（默认 0.66）
- `BoardView.groups`：每 N×M 格一组，壳层画更粗的分组线（数独 3×3 用）
- `ControlSpec.role='dpad'` 画方向盘、`'action'` 画按钮；**壳层自有 id**：`undo`/`restart`/`nextLevel`/`next-level`/`move-<dir>`
- 结果面板由 `status !== 'playing'` 触发（`view.result` 提供标题与明细）——**失败也有终局 UI**

## 3. 不能违反的约定（每条都有代价换来的）

1. **只用纯黑白**：灰度靠抖动，快刷是 1-bit，运动中会被压平/起噪点；状态用形状、线宽、字重、填充区分。
2. **无动画/过渡**（`styles.css` 里全局禁用），状态变化靠重绘。
3. **确定性**：游戏内随机一律 `createRng(seed + 游标)`，**禁止 `Math.random`**（测试会抓）。
4. **`decode` 必须接受游戏自己产生的一切状态**：曾因"填入必须等于解"的过严校验，导致玩家填错一个数字后存档再也打不开。
   守线：`packages/ui/test/games-contract.test.ts`（9 款 × 各难度 × 随机 60 步合法动作，每步 encode→decode 往返）。
5. **`minCell` 是硬下限**：可用区不足时宁可棋盘被裁几像素，也不能让格子坍缩（真机曾坍缩到 1px）。
6. **出现/消失的元素高度必须恒定**（用 `height` 不用 `min-height`），否则画面会位移。
7. **固定视口高的页面必须写 `flex: 0 0 auto`** 覆盖 `.eink-screen` 的 `flex:1`；长内容用
   `eink-screen--sticky-footer` + `.eink-screen__content`（内容滚动、页脚固定）。
8. **`flex` 项上不要用 `margin: 0 auto`**：会悄悄关掉 `align-items: stretch`，让"按实测尺寸反算"的棋盘形成反馈环并锁死。
9. **文案一律走 i18n key**，中英基础 key 集合必须一致（`tools/scripts/check-i18n.mjs` 会扫源码里的硬编码中文）。
10. **布局修复必须在真机复验**：同一视口在 Chromium 与 Android WebView 上的可用高度能差几十像素，
    足以让结论反转（已有两次教训）。

## 4. 加一款新游戏：完整步骤

1. 建 `packages/games/<id>/`：`package.json`（`@eink/<id>`，依赖 `@eink/core: "*"`）、`src/`、`test/`。
2. 实现 `GameDef`（照最近完成的 `reversi`/`gomoku`/`fifteen`/`memory`/`connect4` 抄结构）。
3. 写测试：规则边界、确定性、非法输入抛错、encode/decode 往返 + 坏数据、
   **属性测试**（随机合法动作若干步，每步 encode→decode 往返）、AI（若有）合法且可复现、性能。
4. 接入（5 处，缺一不可；`npm run check:games` 会逐条核对）：
   - `tsconfig.json` paths 与 `vitest.config.ts` alias 各加一条
   - `npm install`（建立 `node_modules/@eink/<id>` 软链）
   - `apps/web/src/library.ts`：`defineGame({...})` + 两份字典合并
   - `packages/ui/src/screens/LibraryScreen.tsx` 的 `hostGlyph` 加一个 1-bit 字形
   - `packages/ui/test/games-contract.test.ts` 的 `GAMES` 数组加入该游戏
5. 跑 `npm run verify`（单测 + 5 个探索套件），再上真机 `tools/device/verify-device.sh` 验收。

### 5b. 给子代理写规格时的清单（两次遗漏换来的）

写 spawn 规格时，**必须逐条点明**下列壳层约定，否则实现方一定会漏，而且要到"最大字号档位详情页"这种边角场景才暴露：

- **壳层自有的控件 id**：`undo` / `restart` / `nextLevel` / `next-level` / `move-<dir>`。
  **关卡制玩法必须由游戏声明 `next-level`**（壳层只在控件的 id 出现时才渲染「下一关」；
  最后一关 `enabled:false`）—— 不能只声明 `undo`。
- **关卡进度的约定键**：`<ns>.progress.notSolved`（列表里未通关关卡的状态文字），
  以及 `levels` / `indexOfLevel` / `progressFor` 的注册方式。
- **棋盘字符不参与 i18n**：块/棋子字形（如 曹/关/卒）要在源码里标注 `i18n-exempt`，
  否则 `check-i18n` 会把它们当硬编码中文。
- **`select` 类动作**（两步选择的选中态）要写进动作联合，并在契约测试的动作清单里被接受；
  它不计步、不进日志。
- **`decode` 必须是重放式**：从 `(seed/contentId, log)` 复算并逐字段比对 ——
  这是本项目出过「decode 拒绝自己产生的状态」严重事故后的硬要求。
- **可解性验证要含区分度**：求解器必须有 `exhausted` 标志（触顶必须显式失败，不能当无解），
  并且至少有一个构造的**无解**局面被判无解 —— 证明判据不恒真。
- **独立实现要真独立**：求解器不许复用产品代码的走法生成（华容道那次两者犯了同一个边界错误，
  互为"印证"直到算出 77 步 vs 真实 116 步才暴露）。
- **规格不是权威，几何/事实才是**：写坐标类玩法（网格编码、行列奇偶、索引换算）时，
  一定要在规格里写清"点在哪个坐标类上"的**判据**（例如"(R+1)² 个交叉点"），
  而不是只写结论；点格棋那次我把奇偶写反了，实现方按几何正确的方式做并来问，
  若它照抄就会把斜纹画在方格中间。
  同理：实现方发现规格与事实冲突时**应该来问**，不要照抄 —— 这是被鼓励的行为。

## 5. 验证体系

**首次准备（新克隆的仓库必需，一次即可）**：探索套件用 Playwright，它装在 **gitignored** 的 `.toolchain/pw`：

```bash
mkdir -p .toolchain/pw && cd .toolchain/pw && npm init -y && npm i playwright
npx playwright install chromium && npx playwright install-deps chromium   # 需要 root 装系统库
```

`npm run verify` 会先检查该依赖，缺失时直接打印上面这几行命令（而不是抛 ERR_MODULE_NOT_FOUND）。

```
npm run check      类型检查 + 707 个单测 + i18n + web 构建
npm run explore    5 个探索套件（真实 Chromium，真实交互）：
                   ui 98 / data 9 / flows 17 / maxscale 60 / landscape 52 项断言
npm run verify     上面全部串起来，自带静态服务，结束打印汇总表与退出码
```

真机流程：`adb connect <ip:port>` → `tools/scripts/build-apk.sh` → `adb install -r` →
`pm enable` 两次（侧载后可能被禁用）→ `am start` → `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>` →
用 `tools/scripts/devtools-eval.py` 在页面里取值/点击。

**真机一键验收（推荐入口）**：

```bash
tools/device/verify-device.sh 10.1.1.69:5555 9333
```

依次完成：连接 → 构建 APK → 安装 → 授权 → 启动 → 端口转发 → **逐款游戏审计**。
脚本里固化了四个踩过的坑：侧载后要 `pm enable` **两次**；WiFi ADB 掉线要先
`forward --remove-all` 再重建（否则指向失效进程）；设备息屏会让取值变成陈旧数据（每步前先唤醒）；
WebView 调试端口名带 pid（必须先取 pid 才能转发）。

**另外三个审计脚本（`tools/device/`）**：
- `audit-games.py <ws文件> [难度|-] <adb序列号>`：逐款开局并输出棋盘尺寸、格子大小、屏外按钮、缺键
- `measure-board.py <ws文件> <adb序列号> <游戏名>`：测量单个游戏的区域/棋盘几何与四边裁切量
- `shot-games.py <ws文件> <adb序列号>`：逐款开局并截图到 `docs/screens/`

（这些脚本此前只存在于未纳入版本控制的 `.toolchain/` 里，交接时容易丢失，现正式入库。）

## 5b. 构建决策：Onyx SDK 默认内置

`apps/android/app/build.gradle.kts` 里 `onyxBundled` 的默认值已由 `false` 改为 `true`：

- **依据**：本项目在真机上验证过的刷新能力（整屏全刷、动画模式探测、应用级刷新档位）都依赖 SDK 反射调用；
- **实测体积代价很小**：内置 **3.4MB** / 不内置 **2.5MB**，只差约 **0.9MB**；
- **如何排除**：`./gradlew -PonyxBundled=false assembleDebug`（若在意体积或不想引入 SDK 传递依赖）。

## 6. 未结项与已知限制

| 项 | 状态 |
|---|---|
| Note X2 的全量游戏审计 | **外部依赖**：设备连续多轮 `No route to host`，代码侧已就绪 |
| 极矮横屏（879×407）棋盘 | **基本解决**（第 42 轮）。做法：该档位隐藏统计栏（信息在竖屏/正常横屏仍可见）、状态条压到 28px。真机实测棋盘区 **44 → 104px**，棋盘 94px 完整放下（上/下余量各 5px，即"裁切"为负）、格子 12px（绝对下限，未坍缩）、屏外按钮 0。<br>**残留（真机实测的精确边界）**：这一档棋盘区高 104px，在 12px 绝对下限下**约 7 行以内放得下**（推箱子 7 行 ✓ 完整放下；迷宫 11×11 仍上下各裁 19px ✗）—— 407px 视口的固有约束。<br>**已闭环**（第 45/46 轮）：放不下时状态条提示「棋盘放不下，建议竖屏游玩」，真机双向验证过（放不下→提示出现 ✓；放得下→不出现 ✓）。|
| 首页游戏较多 + 1.5× 字号时需滚动 | 已定为合格标准（可滚动 + 页脚固定 + 无不可达按钮），不再压小卡片 |
| 计时按"最后一次落盘时刻"记录 | 粒度问题而非缺陷（已记录） |
| M4 真机项 | SAF 备份导出/导入人工验收、20 次息屏唤醒、100 步残影观察、硬件翻页键（已实现滚动）|

## 7. 设备事实（实测）

| 设备 | 视口 | 备注 |
|---|---|---|
| BOOX NoteX2（10.1.1.49:5555） | 1248×903 @1.5 | Android 11；本轮离线 |
| ONYX P6Plus（10.1.1.69:5555） | 439×847 @1.875 | Android 13；字号档位 1.5×（根字号 26px）；横屏 879×407 |

两台均：`onyxSdkFound/fullRefresh/animationMode=true`、`regionRefresh/partialProfiles=false`（区域刷新调用成功但面板整屏刷新）、
app-scope 默认 `FAST`（系统默认，非本项目所致）、存储 `android`（SQLite）。


## 8. 各游戏棋盘的实测尺寸（P6Plus 竖屏 439×847，1.5× 字号）

布局改动时先看这张表：格子越小越接近 24px 硬下限，越容易在极端视口下出问题。

| 游戏 | 棋盘 | 格子 | 备注 |
|---|---|---|---|
| 播棋 2×7 | 待真机实测 | — | 坑内石子数用数字字形 |
| 海战棋 8×8 | 410×410 | 50px | 单棋盘视图（敌方海域）|
| 点格棋 3×3 | 409×409 | 57px | 网格编码表达线（点/方格/边）|
| 骑士巡游 8×8 | 298×298 | 36px | 全盘巡游，已访问留痕 |
| 华容道 4×5 | 294×365 | 71px | 关卡制，块用字形表达形状 |
| 跳棋 8×8 | 410×410 | 50px | 深色格可放子，纯 1-bit |
| 孔明棋 7×7 去四角 | 409×409 | 57px | 33 孔（7×7 去四角），纯 1-bit |
| 关灯游戏 5×5 | 415×415 | **81px** | 纯开关两态，最宽松 |
| 迷宫 11×11 | 263×263 | 23px | 新增；方向盘驱动，格子可小于触摸下限（两级下限）|
| 五子棋 15×15 | 415×415 | **27px** | 最紧，离 24px 下限仅 3px |
| 扫雷 挑战 16×16 | 394×394 | **24px** | **已触下限**（再大的网格会溢出可用区）|
| 数独 9×9 | 343×343 | 37px | |
| 四子棋 7×6 | 409×352 | 57px | |
| 黑白棋 8×8 | 410×410 | 50px | |
| 推箱子 挑战（11×9）| 310×220 | 30px | 横向列数决定格子 |
| 记忆配对 5×4 | 414×313 | 101px | 最宽松 |
| 数字华容道 3×3 | 271×271 | 87px | |
| 2048 5×5（挑战）| 210×210 | 40px | |

十八款全部：**屏外按钮 0、无缺键** ✓

**已加自动化守卫**：`packages/ui/test/games-contract.test.ts` 里有一条用例，
对**全部游戏 × 各难度**断言「按 minCell 算出的棋盘能放得进常用视口」——
新游戏若引入过密的网格（例如 19×19 在 415px 宽下需要 466px）会**提交即被拦下**，
不必等到真机上才发现。

> 写这条守卫时踩了个坑：初版断言 `cell >= minCell`，但 `computeBoardLayout` 内部本来就把格子钳在 minCell 上，
> **断言恒真、等于没测** ✗。有意义的判据是「按 minCell 算出来放不放得下」。

> 结论：**当前最紧的是 16×16 扫雷（已在下限）与 15×15 五子棋（27px）**。
> 要再加更大的网格类玩法（例如 19×19 围棋盘），必须先决定：缩小下限（会影响可点性）
> 还是允许棋盘区滚动（本项目区域刷新不可用，滚动残影风险高）。
