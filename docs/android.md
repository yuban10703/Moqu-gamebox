# Android 壳层说明

## 构建

```bash
npm run setup:android   # 安装 JDK 17 + Android SDK 35 + Gradle 8.14.3 到 .toolchain/
npm run build:apk       # 产出 apps/android/app/build/outputs/apk/debug/app-debug.apk
```

版本组合（已锁定）：JDK 17 (Temurin) + Gradle 8.14.3 + AGP 8.7.3 + Kotlin 2.2.21，
`compileSdk 35` / `targetSdk 35` / `minSdk 23`。

`-PskipWebBuild=true` 可跳过网页资源构建（IDE 里反复编译时用）；
`-PonyxBundled=true` 会把 `onyxsdk-device` 打进 APK（仅当目标设备系统里确实没有这些类时才需要）。

## 侧载与调试

```bash
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -s MainActivity OnyxEinkBackend   # 壳层与 Onyx 探测日志
```

首次运行请到 **设置 → 诊断** 复制设备基线，回填 [A01](A01-device-baseline.md)。

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
| 临时快刷 | 成对进出；页面隐藏、`blur`、退出、`onDestroy` 都会强制恢复 | 不能把设备留在非正常刷新状态 |

## 签名与发布（尚未完成，属 M5/G04）

- 目前只产出 **debug** 签名 APK；正式签名需生成 keystore 并配置 `signingConfigs`；
- 上架相关（隐私说明、内容分级、目标 API 要求）在决定分发渠道后再核对当时要求；
- 升级路径要求：覆盖安装保留数据（`allowBackup=true`，且存档在应用私有目录）。

## 已知限制

- 本机无 `/dev/kvm`、无真机连接：**只能做编译级验证**，运行期表现必须侧载后确认；
- BOOX 系统里是否存在 Onyx SDK 类需真机确认；探测结果会在诊断页显示
  （`onyxSdkFound` 与可用模式名），这也是 [A01](A01-device-baseline.md) 的核心字段。
