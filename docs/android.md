# Android 壳层说明

## 构建

```bash
npm run setup:android   # 安装 JDK 17 + Android SDK 35 + Gradle 8.14.3 到 .toolchain/
npm run build:apk       # 产出 apps/android/app/build/outputs/apk/debug/app-debug.apk
```

版本组合（已锁定）：JDK 17 (Temurin) + Gradle 8.14.3 + AGP 8.7.3 + Kotlin 2.2.21，
`compileSdk 35` / `targetSdk 35` / `minSdk 23`。

`-PskipWebBuild=true` 可跳过网页资源构建（IDE 里反复编译时用）。

> **历史说明（2026-10-04）**：本项目曾短暂内置过 Onyx SDK（`onyxsdk-device`），
> 现已**完全移除** —— 依赖声明与 Gradle 开关（`onyxBundled` / `-PonyxBundled`）都已删除，
> 应用不再探测或调用任何 BOOX 私有接口。此前实测：内置只换来「整屏全刷」一项
> （BOOX 系统手势本来就有），却让 APK 从 1.5MB 涨到 3.3MB。数据仅作历史参考，见 [A03](A03-dependencies.md)。

## 侧载与调试

```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -s MainActivity   # 壳层日志
```

首次运行请到 **首页 → 诊断**（首页页脚「诊断」按钮；帮助页里也有入口，设置页没有）复制设备基线，回填 [A01](A01-device-baseline.md)。

## 关键设计

| 主题 | 做法 | 原因 |
|---|---|---|
| 资源加载 | `WebViewAssetLoader` → `https://appassets.androidplatform.net/assets/web/index.html` | `file://` 源下 localStorage/IndexedDB 不可靠，存档会丢 |
| 权限 | **不申请任何权限**（含网络） | 完全离线，减少隐私面 |
| 外链 | 一律交给系统浏览器 | 壳内不加载任何外部内容，桥只服务内置可信内容 |
| 长按 / 缩放 / 过度滚动 | 全部关闭 | 墨水屏上这些交互只会造成误操作 |
| textZoom | 固定 100 | 应用自带字号档位，避免与系统字体缩放叠加导致布局失真 |
| 返回键 | 网页层接管（`window.__einkHandleBack`） | 与浏览器历史一致；到首页才退出应用 |
| 文件导入导出 | SAF（`ACTION_CREATE_DOCUMENT` / `ACTION_OPEN_DOCUMENT`） | WebView 内的下载不可靠 |
| 桥调用 | 绝不阻塞 JavaBridge 线程：需要 UI 的操作 post 到主线程，结果用 JS 回调返回 | 阻塞桥会把后续自动保存一起卡住 |

## 签名与发布（尚未完成，属 M5/G04）

- 目前只产出 **debug** 签名 APK；正式签名需生成 keystore 并配置 `signingConfigs`；
- 上架相关（隐私说明、内容分级、目标 API 要求）在决定分发渠道后再核对当时要求；
- 升级路径要求：覆盖安装保留数据（`allowBackup=true`，且存档在应用私有目录）。

## 已知限制

- 本机有 `/dev/kvm`，且两台真机常在网（`10.1.1.53:5555` / `10.1.1.69:5555`，`adb connect` 后即在线）：
  因此除编译级验证外，**可直接侧载确认运行期表现**（WiFi ADB 掉线时先 `forward --remove-all` 再重连）；
- 壳层是**纯通用 Android 实现**：只用平台 API 与 `androidx.webkit`，不含任何厂商 SDK；
  设备差异（屏幕/视口/WebView/存储/触摸点数等）由诊断页如实上报，见 [A01](A01-device-baseline.md)。

## 发布（GitHub Release）

`.github/workflows/release-apk.yml`：push 到 `main` 时先看 `v<versionName>` 这个 tag / release **是否存在** ——
**存在就整个跳过**（版本号没变，不重复发也不白烧构建时间），不存在才走
「`npm ci` → `npm run check` → 装 JDK 17 / Android SDK 35 / Gradle 8.14.3 → `gradle assembleDebug` → 发 Release」。

所以**发新版本只需要改版本号**：

1. `apps/android/app/build.gradle.kts`：`versionName`（例如 `0.2.0`）与 `versionCode`（必须递增，否则设备覆盖安装会被拒）；
2. `package.json` 的 `version` 改成同一个值 —— workflow 会校验两者一致，不一致直接失败（避免改了一个忘另一个）；
3. 提交并 push 到 `main`。

产物是 `moqu-<版本>.apk`（**debug 签名**，可直接侧载；Release 说明里带 `versionCode` 与 SHA-256）。
也可以在 Actions 页面手动触发（`workflow_dispatch`）来重试或补发。
