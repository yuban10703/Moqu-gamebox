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
「`npm ci` → `npm run check` → 装 JDK 17 / Android SDK 35 / Gradle 8.14.3 → `gradle assembleRelease` → 发 Release」。

所以**发新版本只需要改版本号**：

1. `apps/android/app/build.gradle.kts`：`versionName`（例如 `0.2.0`）与 `versionCode`（必须递增，否则设备覆盖安装会被拒）；
2. 同步 `package.json`、`apps/web/package.json`、`package-lock.json` 和 `packages/core/src/version.ts` 的应用版本；workflow 会校验根包与 Android 版本一致；
3. 将本版变更写入 `docs/releases/v<版本>.md`，工作流会加入 Release 说明；
4. 提交并 push 到 `main`；工作流以实际构建的提交创建版本标签。

产物是 `moqu-<版本>.apk`（正式 keystore 签名，缺少签名配置时回退 debug；Release 说明里带签名方式、`versionCode` 与 SHA-256）。
也可以在 Actions 页面手动触发（`workflow_dispatch`）来重试或补发。

### 签名：缺 Secrets 时回退 debug（2026-10-05 已接好）

工作流支持**正式 keystore 签名**，但它是可选的 —— gradle 侧的 `hasReleaseSigning` 会在四个值
（`EINK_KEYSTORE_FILE` / `EINK_KEYSTORE_PASSWORD` / `EINK_KEY_ALIAS` / `EINK_KEY_PASSWORD`）
**缺任何一个时回退到 debug 签名**，所以本地开发、以及没配 Secrets 的 CI 都能照常构建。

⚠️ 没配正式签名时**换版本必须先卸载旧版**：AGP 找不到 `~/.android/debug.keystore` 会现场生成一个，
而 CI runner 每次都是全新的 → **每个 Release 的签名都不同**，Android 不允许签名不同的包覆盖安装。
（本机开发不受影响：`~/.android/debug.keystore` 一直在，签名固定。）

#### 配正式签名：三步

```bash
# 0) 用项目自带 JDK 17（或任意 JDK 17+）：source .toolchain/env.sh 后 $JAVA_HOME/bin/keytool

# 1) 生成 keystore —— 放在仓库**外面**（例如 ~/keys），别放工作区里
mkdir -p ~/keys && cd ~/keys
"$JAVA_HOME/bin/keytool" -genkeypair -v -keystore moqu-release.jks -alias moqu \
  -keyalg RSA -keysize 2048 -validity 10950
#    会交互式问 store 密码 / key 密码（别写进命令行，免得留在 shell 历史里）；
#    PKCS12 格式（JDK 9+ 默认）要求 key 密码与 store 密码相同，JDK 会提示；
#    CN/OU/O 随便填，但别填 Android Debug。

# 1b) 记下指纹备查（Release 日志里会打印同一个指纹）
"$JAVA_HOME/bin/keytool" -list -v -keystore moqu-release.jks | grep -E "Alias|SHA256|Valid"

# 2) 转 base64（内容粘进 Secret 时带不带换行都行，workflow 会先 tr -d 掉）
base64 -w0 moqu-release.jks > moqu-release.jks.b64          # Linux / WSL
# macOS（没有 -w）：base64 -i moqu-release.jks -o moqu-release.jks.b64
```

Windows PowerShell（不借 WSL 时）：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\keys\moqu-release.jks")) |
  Set-Content -NoNewline "$HOME\keys\moqu-release.jks.b64"
```

```bash
# 3) 到 GitHub 仓库 → Settings → Secrets and variables → Actions，加四个 Secret：
#    ANDROID_KEYSTORE_BASE64     ← moqu-release.jks.b64 的全部内容
#    ANDROID_KEYSTORE_PASSWORD   ← 第 1 步设的 store 密码
#    ANDROID_KEY_ALIAS           ← moqu
#    ANDROID_KEY_PASSWORD        ← 第 1 步设的 key 密码
#    （名字必须一字不差；`.gitignore` 已忽略 *.jks / *.p12 / *.b64，但仍别把密钥放进工作区）

# 4) 触发一次正式签名的发布：**必须改版本号** —— 已经发过的版本号（例如 v0.1.0）
#    因为 tag 已存在会被 workflow 直接跳过，不会重新构建：
#      apps/android/app/build.gradle.kts：versionName = "0.1.4"、versionCode = 5
#      package.json：version = "0.1.4"（两者不一致 workflow 会直接失败）
```

配好之后下次发布就会用正式签名（工作流会打印签名者与有效期，可据此确认不再是 Debug）。

要求与注意：

- 算法 RSA 2048（或 4096），有效期要长 —— Google Play 要求至少到 2033-10-22 之后；
- `minSdk 23` 要求同时有 **v1(JAR) 签名**：`signingConfigs.release` 里已显式 `enableV1Signing`/`enableV2Signing`；
- **keystore 与密码绝不进仓库**（`.gitignore` 已忽略 `*.keystore`/`*.jks`，但真正的保险是只放 Secrets）；
- **丢了就永远无法覆盖升级**（只能换包名或让用户卸载重装）→ 存密码管理器 + 离线备份；
- 从 debug 签到正式签名后，已装设备要**卸载重装一次**（之后就一直顺了）；
- 想改用 gradle 属性也行（`-PeinkKeystoreFile=...` 等），四个属性名与上面的环境变量一一对应。
