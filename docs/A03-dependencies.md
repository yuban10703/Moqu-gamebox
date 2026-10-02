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

## BOOX（Onyx）官方 SDK —— 实测结论

以下均为访问 `http://repo.boox.com` 实测所得：

| 事实 | 结论 |
|---|---|
| 仓库 HTTPS 握手失败（`dh key too small`） | 只能用 HTTP，Gradle 必须 `isAllowInsecureProtocol = true` |
| `onyxsdk-device:1.3.6`（`maven-public`） | 248 KB，88 个类；**EPD 接口在这里**：`com.onyx.android.sdk.api.device.epd.EpdController`、`EpdDeviceManager`、`UpdateMode`、`UpdateOption`、`FrontLightController`、`DeviceEnvironment` |
| `onyxsdk-base`（`maven-public` 最新 1.6.53；`proxy-public` 只到 1.5.5） | 986 KB，660 个类；只有 `DeviceUtils` / `DeviceInfoUtil`，**没有任何 EPD 类** |
| 传递依赖 | base → device 1.0.4 + fastjson + easypermissions + commonsIO + rxjava2/rxandroid + eventbus；device → fastjson2 + batik/xmlgraphics（大量 exclusions）；pen 1.2.1 → base 1.6.4 + fst |
| 文档里的 `setWebViewContrastOptimize` | 在 `onyxsdk-base 1.6.53` 与 `onyxsdk-device 1.3.6` 的常量池里**都找不到**（与公开文档不一致） |

由此确定接入方式：

1. **默认零依赖**：不把 SDK 声明为 `implementation`，而是按类名做**纯反射**调用；
   APK 里不出现 fastjson2 / batik / rxjava，也就没有相应的体积与冲突风险。
2. **能力探测而非硬编码**：`UpdateMode` 的名字、前光方法签名、快刷方法签名都按运行时探测结果决定；
   探测不到的档位在设置页显示为不可用（不假装能用）。
3. **逃生口**：万一某台设备的系统里确实没有这些类，可用 `-PonyxBundled` 让 Gradle
   把 `onyxsdk-device` 打进来（已配置对 batik 相关组的 exclusions）。
4. 详细适配说明见 [refresh-adaptation.md](refresh-adaptation.md)。

### `-PonyxBundled` 变体（已实测）

需要应用内控制刷新时可用 `./gradlew -PonyxBundled=true assembleDebug` 把 SDK 打进 APK：

- 体积 1.4MB → 3.4MB（batik 相关组未被拉入）；
- SDK 清单声明的 4 个权限（ACCESS_WIFI_STATE / CHANGE_WIFI_STATE / BLUETOOTH / DUMP）
  已在本项目清单里用 `tools:node="remove"` 剥掉，最终 APK 仍然是**零权限**；
- 真机结论：整屏全刷可用（`refreshScreen(GC)`），刷新档位不可用（写入被接受但不生效）。
  详见 [refresh-adaptation.md](refresh-adaptation.md)。

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
