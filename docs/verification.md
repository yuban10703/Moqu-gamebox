# 验证说明：本机可自动验证 vs 只能真机验证

## 一条命令跑完本机验证

```bash
npm run check
# = typecheck + 全部测试 + 文案对齐与硬编码扫描 + 构建 Web 产物（含 sw.js）
```

## 本机自动验证（已有测试覆盖）

| 领域 | 测试文件 | 覆盖内容 |
|---|---|---|
| 规则 | `packages/games/sokoban/test/rules.test.ts` | 移动/推箱/撤销/重开语义、非法动作拒绝、撤销回退计数、≥100 步随机动作后重放一致 |
| 内容 | `test/levels.test.ts` | 逐关：按 `source` 复算与提交内容一致、见证解法经规则引擎通关、独立 A\* 求解器复核可解性 |
| 存档协议 | `packages/core/test/save.test.ts` | commitId 递增、陈旧提交判为冲突、写入失败原因（io/quota）、pending 恢复/清理/丢弃、损坏与版本不支持、备份往返与冲突策略 |
| 布局 | `packages/core/test/layout.test.ts` | 5 种视口 × 3 档字号 × 3 种棋盘：触摸目标 ≥48、字号 ≥18、棋盘不溢出、整数尺寸、极窄视口不产生非法值 |
| i18n | `packages/core/test/i18n.test.ts`、`packages/games/sokoban/test/dicts.test.ts` | 插值、复数回落、缺词可见、中英基础 key 完全一致 |
| 平台 | `packages/platform/test/platform.test.ts` | IndexedDB 的 CAS 语义、应用存储门面、备份导入三种策略、Android 桥映射、内存降级标记 |
| 壳层 | `packages/ui/test/shell.test.tsx` | 库→详情→游戏→存档全链路、方向输入与提示、按见证解法通关并落盘、设置（语言/字号）即时生效、保存失败可见可重试、损坏存档保留并提示、详情页覆盖需确认、返回键钩子 |
| Android 纯逻辑 | `apps/android/app/src/test/.../RefreshMappingTest.kt` | 档位→模式名映射、按设备实际模式挑选、候选优先级 |

编译级验证：`npm run build:apk` 必须成功产出 APK（`.toolchain` 已就绪时约 1–3 分钟）。

## 只能真机验证（本机无 KVM、无真机、无浏览器）

| 项目 | 为什么不能在本机验证 | 怎么做 |
|---|---|---|
| 触摸到可读画面的延迟 | 依赖面板刷新物理特性 | 目视 + 录屏，记录到 [A06](A06-acceptance.md) |
| 残影与全刷闪烁 | 依赖面板 | 连续 100 步后观察；需要时全刷 |
| 真实可读性（字号/符号） | 墨水屏对比度与观看距离 | 实屏观察五种棋盘符号 |
| BOOX 屏幕接口是否可用 | 依赖系统内是否存在 SDK 类 | 诊断页看 `onyxSdkFound` 与模式清单 |
| 生命周期与进程回收 | 依赖系统行为 | 20 组「暂停→锁屏→唤醒」+ 杀进程恢复 |
| 耗电 | 依赖整机 | 固定前光与刷新档位游玩 30 分钟 |
| 旧 WebView 兼容 | 本机无设备浏览器 | 诊断页看 `webView` 版本；低于 69 会提示更新 |

## 诚实边界

- 本机没有安装浏览器（也无 KVM/模拟器），因此**没有自动化视觉回归**：
  布局正确性靠纯函数不变量测试保证，视觉可读性必须真机判断；
- 桌面截图或模拟器通过**不算**完成（与规划的阶段完成条件一致）；
- 未实测的能力不作为宣传或承诺依据：见 [eink-guidelines](eink-guidelines.md) 与
  [refresh-adaptation](refresh-adaptation.md) 的「明确不承诺」。

## 真机验证（2026-10-03，BOOX Note X2 / Android 11）

真机结果见 [A06 附录](A06-acceptance.md)，截图见 `docs/screens/`。核心结论：

- 应用在真机上可完整游玩：触摸操作、存档、杀进程恢复、完整通关、结果统计与最佳记录均通过；
- **Onyx SDK 在这台设备上不可用**（`onyxSdkFound=false`），应用按设计退回通用模式并给出系统指引；
- 真机暴露了一个 jsdom 测不出来的严重缺陷（`useSession` 因不稳定依赖导致每次渲染都重新加载存档，
  在原生桥上表现为「点了没反应 / 页面卡死」），已修复并补了**经验证有效**的回归测试；
- 附带修掉 4 处只有在实屏上才看得出的文案与布局问题（进度标签未插值、分页文案误用「下一关」、
  `idle` 状态谎称「已保存」、过关面板把按钮挤出首屏）。

排障工具：`tools/scripts/devtools-eval.py`（通过 WebView DevTools 协议在页面里求值，用于真机定位）。


## 网页版冒烟测试（真实浏览器）

真机与浏览器是**两条不同的运行路径**，必须分别验证：

| | 真机（BOOX WebView） | 网页版（浏览器） |
|---|---|---|
| 存储 | 原生 SQLite（`storage kind = android`） | **IndexedDB**（`storage kind = indexeddb`） |
| 刷新能力 | Onyx SDK（全刷可用） | **无**（`onyxSdkFound = false`，如实上报） |
| 语言 | 跟随系统 | **跟随浏览器语言** |
| 屏幕 | 固定设备视口 | 任意视口 |

这些差异在 jsdom 单测里覆盖不到（jsdom 没有真实 IndexedDB 与真实布局），
因此用 Playwright + Chromium 做了真实浏览器冒烟测试。

### 运行方式

```bash
npm run build:web                       # 构建产物
npm run serve:web &                     # 静态服务 → http://127.0.0.1:8899/
# 首次需要装浏览器（装到 gitignored 的 .toolchain/pw，不入项目依赖）
mkdir -p .toolchain/pw && cd .toolchain/pw && npm i playwright \
  && npx playwright install chromium && npx playwright install-deps chromium
npm run smoke:web                       # 运行冒烟测试
```

### 覆盖与结果（19/19 通过）

- 首页 / 详情页 / 游戏页渲染；`platform.kind = web`、`storage.kind = indexeddb`
- **不谎报 BOOX 能力**：网页版 `onyxSdkFound = false`
- 方向键可操作，步数递增（0 → 6）
- 存档提交：界面显示「已保存」，且 **IndexedDB 中 `loadResult() = ok`、存档步数与界面一致**
- **刷新后存档恢复**（6 → 6）
- **语言跟随浏览器**：`locale=en-US` 时界面为英文
- **两种视口逐页断言「主操作都在首屏内」**：1248×903 与 439×847，
  首页/详情页/游戏页均 0 个屏外按钮；统计栏行数固定为 1

截图：`docs/screens/web-01-landscape-game.png`、`web-02-portrait-game.png`

### 过程中踩到的两个坑（脚本自身）

1. **语言**：无头浏览器默认 `en-US`，界面走英文，最初按中文文案断言导致超时 ——
   这反而验证了「语言跟随浏览器」这条行为。测试里显式指定 `locale` 才稳定。
2. **API 名字**：`saves.load()` 返回存档或 null，`saves.loadResult()` 才返回 `{status, envelope}`；
   用错方法会得到 null 而非报错，断言会假失败。
