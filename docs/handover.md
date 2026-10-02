# 交接说明（墨水屏游戏盒子）

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
apps/android           BOOX WebView 壳 + Onyx SDK（反射调用，-PonyxBundled 可打进 APK）
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
4. 接入（4 处，缺一不可）：
   - `tsconfig.json` paths 与 `vitest.config.ts` alias 各加一条
   - `npm install`（建立 `node_modules/@eink/<id>` 软链）
   - `apps/web/src/library.ts`：`defineGame({...})` + 两份字典合并
   - `packages/ui/src/screens/LibraryScreen.tsx` 的 `hostGlyph` 加一个 1-bit 字形
   - `packages/ui/test/games-contract.test.ts` 的 `GAMES` 数组加入该游戏
5. 跑 `npm run verify`（单测 + 5 个探索套件），再上真机 `tools/scripts/build-apk.sh` + adb 安装验收。

## 5. 验证体系

```
npm run check      类型检查 + 706 个单测 + i18n + web 构建
npm run explore    5 个探索套件（真实 Chromium，真实交互）：
                   ui 98 / data 9 / flows 17 / maxscale 60 / landscape 52 项断言
npm run verify     上面全部串起来，自带静态服务，结束打印汇总表与退出码
```

真机流程：`adb connect <ip:port>` → `tools/scripts/build-apk.sh` → `adb install -r` →
`pm enable` 两次（侧载后可能被禁用）→ `am start` → `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>` →
用 `tools/scripts/devtools-eval.py` 在页面里取值/点击。

## 6. 未结项与已知限制

| 项 | 状态 |
|---|---|
| Note X2 的 9 款游戏审计 | **外部依赖**：设备连续多轮 `No route to host`，代码侧已就绪 |
| 极矮横屏（879×407）棋盘被裁几像素 | 已判定：浮层方向盘方案在 1-bit 屏上不成立（会实心遮住棋盘）；当前策略是"格子可点、按钮可达 ＞ 棋盘完整可见"。可选方向：棋盘滚动缩放、或提示竖屏游玩 |
| 首页在 9 款 + 1.5× 字号下需滚动 | 已定为合格标准（可滚动 + 页脚固定 + 无不可达按钮），不再压小卡片 |
| 计时按"最后一次落盘时刻"记录 | 粒度问题而非缺陷（已记录） |
| M4 真机项 | SAF 备份导出/导入人工验收、20 次息屏唤醒、100 步残影观察、硬件翻页键（已实现滚动）|

## 7. 设备事实（实测）

| 设备 | 视口 | 备注 |
|---|---|---|
| BOOX NoteX2（10.1.1.49:5555） | 1248×903 @1.5 | Android 11；本轮离线 |
| ONYX P6Plus（10.1.1.69:5555） | 439×847 @1.875 | Android 13；字号档位 1.5×（根字号 26px）；横屏 879×407 |

两台均：`onyxSdkFound/fullRefresh/animationMode=true`、`regionRefresh/partialProfiles=false`（区域刷新调用成功但面板整屏刷新）、
app-scope 默认 `FAST`（系统默认，非本项目所致）、存储 `android`（SQLite）。
