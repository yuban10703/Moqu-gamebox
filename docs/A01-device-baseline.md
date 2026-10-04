# A01 · 目标设备基线

状态：**已用真机采集（2026-10-03）**。数据来自设备 `adb` 实测 + 应用内「设置 → 诊断」。

## 已采集设备

| 项目 | 值 | 来源 |
|---|---|---|
| 型号 | BOOX **Note X2** | `ro.product.model` = NoteX2，`ro.product.manufacturer` = ONYX |
| 屏幕尺寸 | 10.3 吋 | 型号规格 |
| 分辨率（物理） | 1872 × 1404（当前为横屏） | `wm size` / 诊断页 `screen` |
| 系统密度 | 240（dpi 基准 160 → DPR 1.5） | `wm density` |
| 黑白 / 彩色 | 黑白（待你确认是否为彩屏版本） | 待确认 |
| Android 版本 | 11（API 30） | `ro.build.version.release` / `ro.build.version.sdk` |
| 固件 | `D60_SMT_V02_2022_0309`（incremental 1658） | `ro.build.display.id` |
| 系统 WebView | **156.0.8078.4**（com.google.android.webview） | `dumpsys webviewupdate` / 诊断页 |
| CSS 视口（横屏） | **1248 × 903 @ DPR 1.5** | 诊断页 `viewport(css)` |
| CSS 视口（竖屏） | 待测 | — |
| 触摸点数 / 粗指针 | 5 / coarse=true | 诊断页 `touch` |
| 实体按键 | 待采集（诊断页未展示 `hardwareKeys` 字段） | — |
| 触笔 | 待采集 | — |
| BOOX 屏幕接口 / 刷新控制 | **不适用**：相关能力与 SDK 已于 2026-10-04 从应用里完全移除 | 见下方「关于 Onyx SDK（历史）」 |

## 运行环境基线（2026-10-03 复核，构建目标据此确定）

两台设备都用 devtools 实测了引擎与特性支持（`navigator.userAgent` + `CSS.supports`）：

| 能力 | BOOX P6Plus | BOOX NoteX2 |
|---|---|---|
| 引擎 | **Chromium 146**（Android 13）| **Chromium 156**（Android 11）|
| CSS 变量 / grid / flex gap | ✓ / ✓ / ✓ | ✓ / ✓ / ✓ |
| `:has()` / `dvh` / 容器查询 | ✓ / ✓ / ✓ | ✓ / ✓ / ✓ |
| `color-mix` / subgrid | ✓ / ✓ | ✓ / ✓ |

结论与决定：

- **构建目标改为"现代常青浏览器基线"** `['chrome110','edge110','firefox110','safari16']`
  （原先写的是 `['chrome69','safari12']`，理由是"BOOX 的系统 WebView 可能很旧"——
  那是一条**没有实测的防御性猜测**，实测后不成立：156/146 远超该目标）。
  实测收益：JS 410 KB → 406 KB，可选链与空值合并不再被降级掉（`?.` 79 处、`??` 151 处得以保留）。
- **明确不支持 Kindle 自带浏览器**：它是很老的 WebKit，不认 `type="module"`
  → 脚本不执行 → `<div id="root">` 永远为空 → **白屏**；此外也不支持 CSS 变量与 grid
  （本应用 CSS 有约 190 处 `var(--)`、10 处 `display:grid`）。Kindle 还是封闭平台，装不了我们的 APK。
  用户已决定不为它做兼容版。
- `minSdk 23` / `targetSdk 35` 在实机（API 30 / 33）运行正常；
- 视口 1248×903 属于「≥1200 宽」档：基准字号 22px、按钮高 48px、7×7 棋盘格子 **71px**（真机实测；离线模型按当前方向键摆法算是 83px）—— 远超 48px 门槛。

## 关于 Onyx SDK（历史记录）

> **历史说明（2026-10-04）**：Onyx SDK（`onyxsdk-device`）及其 Gradle 开关已从项目中**完全移除**，
> 应用不再依赖它，也不存在任何开关或后手。以下检查与结论是移除前的实测记录，仅作历史参考。

| 检查 | 结果 |
|---|---|
| `/system/framework` 下是否有 onyx jar | **没有**（64 个条目里无任何 onyx 相关） |
| 全盘搜索 `*onyx*` | 只有系统原生库与自家应用：`/system/lib/libonyx_epd_listener.so`、`libonyx_neo_dither.so`、`/system/priv-app/OnyxOtaService`、`/system/etc/sysconfig/onyx_whitelist.xml` 等 |
| 第三方应用能否 `Class.forName("...EpdController")` | **不能**（当时的诊断页报 `onyxSdkFound=false`，应用自动退回通用模式，未崩溃） |

结论：这台 Note X2 上第三方应用**拿不到** Java 层的 Onyx 屏幕接口。因此：

1. 应用如实显示「当前设备不支持直接控制刷新」，并给出系统设置指引 —— 符合「不把未验证能力写成可用」的原则；
2. （已作废）曾用内置 SDK 的构建做过能力实测，但 SDK 只换来一项系统本就有手势的能力、代价是 APK 翻倍；
   该 SDK 及开关现已彻底删除，不再提供启用方式；
3. 网页端（Neo 浏览器）同样无法直接控制刷新，只能依赖系统的「应用优化/刷新模式」。

## 实测观察记录

| 观察项 | 结论 | 备注 |
|---|---|---|
| 输入是否跟手 | 是 | 合成触摸（`input tap`）与真实点击均能触发；应用内即时出画 |
| 单步操作残影 | 轻微，可接受 | 未做长时间观察，待 100 步连续测试 |
| 整屏全刷 | 应用无法触发（SDK 不可用）；系统手势可用 | — |
| 文字最小可读字号 | 标准档（18/20px）完全可读 | 三个棋盘符号在 1-bit 下区分清楚 |
| 棋盘格子可点尺寸 | 71 CSS px（7×7 关卡，真机实测） | 远高于 48px |
| 返回键 | 正常：应用内返回、系统返回键均按预期 | 系统返回键由网页层 `__einkHandleBack` 接管 |
| 关卡分页 | 正常：16 关分 2 页，上一页/下一页文案正确 | — |
| 存档持久化 | **通过**：杀进程后重启，步数 1 被恢复；SQLite 库 20KB | 落在 `/data/data/com.einkgamebox/databases/eink-gamebox.db` |
| 完整通关 | **通过**：第 1 关走完出现「过关」面板，统计与最佳记录正确 | 结果面板曾把按钮挤出首屏，已修（过关后方向盘让位） |
| 覆盖安装保留数据 | 通过 | `adb install -r` 后进度仍在 |

## 本机部署注意事项（实测踩到的）

1. **BOOX 会把新装的第三方包置为 `disabled`（`enabled=3` / DISABLED_USER）**，
   表现为 `am start` 报 `Activity class does not exist`、桌面图标点了没反应。
   解决：`adb shell pm enable --user 0 com.einkgamebox`。
   （正常从应用商店/文件管理器安装可能不会触发；侧载时需要留意。）
2. **`adb exec-out screencap -p` 的输出前面会被塞一行 `capture from screenshot!`**，
   导致 PNG 头部损坏。正确做法：`adb shell screencap -p /sdcard/x.png` 再 `adb pull`。
3. 抓图与排障脚本：`tools/scripts/devtools-eval.py`（在页面里求值，需要 debug 构建）。

## 原始记录（诊断页复制）

```
appVersion: 0.1.0
platform: android
manufacturer/model: ONYX NoteX2
androidSdk: 30
webView: 156.0.8078.4
viewport(css): 1248x903 @dpr 1.5
screen(px): 1872x1404
locale: zh-CN
touch: maxTouchPoints=5 coarse=true
onyxSdkFound: false
refreshFeatures: none
refreshModes: none
fullRefresh: false
fastMode: false
webViewSufficient: true
storage: android
```

> 这是 2026-10-03 旧构建复制出来的原始记录：其中 `onyxSdkFound` / `refreshFeatures` / `refreshModes` /
> `fullRefresh` / `fastMode` 几个字段随 SDK 与刷新链路一起被删除，现版诊断页不再输出它们。

## 第二台设备：BOOX P6Plus（用于跨设备对比）

| 项目 | 数值 |
|---|---|
| 连接 | `adb connect 10.1.1.69:5555` |
| 厂商 / 型号 | ONYX / **P6Plus**（brand Onyx，fingerprint `ONYX/TabBoox/TabBoox`） |
| Android | **13（SDK 33）**，incremental 592 |
| 屏幕 | 物理 824×1648，density 300 → **CSS 视口 439×847 @dpr 1.875（竖屏）** |
| WebView | Chrome/146.0.7680.178 |
| 触摸 | 5 点，coarse |
| 存储 | `android`（原生 SQLite，与 Note X2 相同） |
| 波形 | `onyx waveform sg` |
| 侧载注意 | 与 Note X2 相同：安装后包被置为 `enabled=3`（DISABLED_USER），**需要再执行一次 `pm enable --user 0`**；启动器还会标 `isAutoFreeze:true isEACEnabled:true` |

### Google Play 商店（2026-10-03 追加；安装过程属设备折腾，不记在项目文档里）

| 检查 | 结果 |
|---|---|
| GMS / GSF | **系统自带**：`GmsCore 23.37.17`（`/product/priv-app`）、`GoogleServicesFramework 13-8768315`（`/system_ext/priv-app`） |
| Play 商店 | 出厂**没有**（`pm list packages -u` 无 `vending`）；已侧载 `53.3.21-31`（universal / minSdk 31）并跑通 |
| 固件闸门 | `gms_enable=false` 时 framework 的 `ActivityStarter.executeRequest()` 直接拒绝启动 `com.android.vending`（`SecurityException: … Google Play is disabled.`）；该键在 `/onyxconfig/mmkv/onyx_config`，写入接口是 `OnyxMMKVConfigHelper.saveValue` |
| 已给权限 | `com.android.vending` 的 `INSTALL_PACKAGES` / `DELETE_PACKAGES` 实测 `granted=true`（来自 ROM 的 `privapp-permissions-google-product.xml` 白名单，即使装在 `/data/app`） |

### 跨设备能力对比（历史数据：SDK 已移除）

> **历史说明（2026-10-04）**：下表是**移除前**用内置 SDK 的旧构建（`-PonyxBundled=true`）实测的数据。
> Onyx SDK 与那个 Gradle 开关现已从项目中完全移除，应用不再依赖它，也没有任何启用方式；
> 这些数字仅作历史参考，不代表现版本的行为。

| 探测项 | Note X2（Android 11） | P6Plus（Android 13） |
|---|---|---|
| `onyxSdkFound` | true | true |
| 整屏全刷 `refreshScreen(GC)` | ✓ 可用 | ✓ 可用 |
| 区域刷新 `refreshScreenRegion` | ✓ 调用成功（实测整屏刷新，故上报 false） | ✓ 同 |
| 档位 `setViewDefaultUpdateMode` | 接受但回读不生效 | 接受但回读不生效 |
| 动画模式 `animationMode` | true | true |
| 应用级刷新模式（系统默认） | `FAST` | `FAST` |

**两台截然不同的设备（Android 11 vs 13、10.3" 横屏 vs 6" 竖屏）结论完全一致**，
说明这些 API 层结论不是某台机器的特例。

### 应用级刷新模式的基线（重要教训）

在两台设备上、**全新安装且从未调用过任何开启接口**时，`getAppScopeRefreshMode()`
读回就是 `FAST` —— 这是**系统对本应用的默认设置**，不是我们改出来的。

早先曾误判为「我们打开了一个应用内关不掉的单向开关」，根因是**没有先读基线值**：
先读基线 → 再改 → 再复查，是判断「这次调用到底有没有造成变化」的唯一可靠顺序。
当时把启动逻辑改为**只读取并记录**，不再自动"还原"（那是在还原一个本就不存在的东西）。
**后续：整条刷新链路（含这段读取逻辑）已随 Onyx SDK 一起删除，见 EinkBackend.kt。**
