# A03 · 内容与依赖来源

状态：已核验（依赖坐标与限制均为实测结果，非文档推测）。

## 运行时依赖

| 依赖 | 版本 | 用途 | 许可/条件 |
|---|---|---|---|
| React / React DOM | 19.3.x | 壳层 UI | MIT |
| TypeScript | 5.9.x（**刻意不用 7.x**：生态兼容风险） | 类型与构建 | Apache-2.0 |
| Vite / @vitejs/plugin-react | 8.3.x / 6.1.x | Web 构建 | MIT |
| Vitest / jsdom / @testing-library/* | 5.0.x / 30.x / 16.x | 测试 | MIT |
| fake-indexeddb | 6.x | IndexedDB 测试替身 | Apache-2.0 |
| androidx.webkit | 1.12.1 | WebViewAssetLoader（https 源加载内置资源） | Apache-2.0 |
| Kotlin stdlib | 2.2.21 | Android 壳 | Apache-2.0 |
| JUnit | 4.13.2 | 壳层单元测试 | EPL-1.0 |

**没有引入**通用游戏引擎、状态管理库、i18n 库、UI 组件库：壳层规模小，
自建几十行的实现比引入依赖更可控，也避免在旧 WebView 上增加兼容面。

## BOOX（Onyx）官方 SDK —— 历史记录（该 SDK 已完全移除）

> **历史说明（2026-10-04）**：本项目曾评估并短期内置过 Onyx SDK（`onyxsdk-device`）。
> 该 SDK 与相关 Gradle 开关**现已从项目中完全删除**：应用不再声明、下载或反射调用它，
> 也不存在任何启用方式。下面是对 `http://repo.boox.com` 的实测记录，仅作历史参考。

| 事实 | 结论 |
|---|---|
| 仓库 HTTPS 握手失败（`dh key too small`） | 只能用 HTTP，Gradle 必须 `isAllowInsecureProtocol = true` |
| `onyxsdk-device:1.3.6`（`maven-public`） | 248 KB，88 个类；**EPD 接口在这里**：`com.onyx.android.sdk.api.device.epd.EpdController`、`EpdDeviceManager`、`UpdateMode`、`UpdateOption`、`FrontLightController`、`DeviceEnvironment` |
| `onyxsdk-base`（`maven-public` 最新 1.6.53；`proxy-public` 只到 1.5.5） | 986 KB，660 个类；只有 `DeviceUtils` / `DeviceInfoUtil`，**没有任何 EPD 类** |
| 传递依赖 | base → device 1.0.4 + fastjson + easypermissions + commonsIO + rxjava2/rxandroid + eventbus；device → fastjson2 + batik/xmlgraphics（大量 exclusions）；pen 1.2.1 → base 1.6.4 + fst |
| 文档里的 `setWebViewContrastOptimize` | 在 `onyxsdk-base 1.6.53` 与 `onyxsdk-device 1.3.6` 的常量池里**都找不到**（与公开文档不一致） |

据此曾确定的接入方式（**已作废**，相关代码、依赖声明与开关都已删除）：

1. **零依赖**：不把 SDK 声明为 `implementation`，只按类名做**纯反射**调用；
2. **能力探测而非硬编码**：`UpdateMode` 的名字、前光方法签名、快刷方法签名都按运行时探测结果决定；
3. **最终放弃内置**：这些类不在系统里，反射要能用就必须把 SDK 打进来；
   而实测它只换来「整屏全刷」一项有效能力（BOOX 系统手势本来就有），代价是 APK 从 1.5MB 涨到 3.3MB。
   因此不再内置，随后（2026-10-04）连开关与依赖一并彻底移除。
4. 当时的适配说明见 [refresh-adaptation.md](refresh-adaptation.md)（同为历史记录）。

### 内置 SDK 的体积代价（历史实测，仅供参考）

内置 SDK 的旧构建（`./gradlew -PonyxBundled=true assembleDebug`，该开关现已删除）：

- 体积 **1.5MB → 3.3MB**（2026-10-04 实测；batik 相关组未被拉入）；
- SDK 清单声明的 4 个权限（ACCESS_WIFI_STATE / CHANGE_WIFI_STATE / BLUETOOTH / DUMP）
  当时在本项目清单里用 `tools:node="remove"` 剥掉；**这些声明现已连同 SDK 一起删除**，
  最终 APK 依旧是**零权限**；
- 真机结论：整屏全刷可用（`refreshScreen(GC)`），刷新档位不可用（写入被接受但不生效）。

## 内容来源（无第三方题库）

| 内容 | 来源 | 校验方式 |
|---|---|---|
| 推箱子房间模板（6 个） | 自绘（`packages/games/sokoban/src/level.ts`） | 格式校验：外圈必须为墙、箱子数=目标数、唯一玩家 |
| 推箱子关卡（16 关） | 固定种子**反向拉动**生成（`src/generate.ts`），天然可解 | ① 按 `source` 复算与提交内容逐字符一致；② 见证解法用规则引擎重放必须通关；③ 独立 A\* 求解器复核（预算内失败仅允许「超时」，不允许判定无解） |
| 字体 | 系统字体（中文回退链），**不打包任何字体** | — |
| 图标 | 自绘 1-bit SVG（`apps/web/public/icon.svg`） | 只用黑白与线型表达 |

关卡重新生成：`npm run gen:levels`（会改写 `packages/games/sokoban/src/levels.ts`，之后必须重跑测试）。

## 未来引入外部内容时的检查项

- [ ] 题库/关卡集的许可是否允许再分发（含商用）；
- [ ] 是否可从内容本身追溯到来源与版本号；
- [ ] 是否需要独立的内容版本号（`contentVersion`）与迁移路径；
- [ ] 是否会改变 `contentVersion` 从而影响旧存档的兼容判断。
