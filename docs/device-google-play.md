# 在 BOOX P6+ 上安装 Google Play 商店（真机实测）

状态：**已完成并端到端验证通过**（2026-10-03/04 实测，设备 `10.1.1.69:5555`）。
已登录 Google 账号、Play 保护机制正常、商店成功下载并安装了应用更新。

本文只记录在目标设备上实际发生的事，命令都可以照抄复现；未验证的部分会明确标注。

---

## 一、速览

| 项目 | 值 | 来源 |
|---|---|---|
| 设备 | ONYX **P6Plus**（`ro.product.model=P6Plus`，brand Onyx） | `getprop` |
| Android | **13（SDK 33）**，arm64-v8a | `getprop` |
| 固件 | `2026-06-17_20-21_4.2-rel_0617_761aff926`，fingerprint `ONYX/TabBoox/TabBoox:13/TKQ1.230615.001/GV2.027.SQ83A` | `getprop` |
| 屏幕 / 存储 | 824×1648 / density 300；`/data` 可用 101 GB | `screencap` / `df` |
| Google Play 服务（GMS） | **本来就有**：`23.37.17`，`/product/priv-app/GmsCore` | `dumpsys package` |
| Google 服务框架（GSF） | **本来就有**：`13-8768315`，`/system_ext/priv-app/GoogleServicesFramework` | `dumpsys package` |
| Google Play 商店 | **原本完全没有**（`pm list packages -u` 搜不到任何 `vending`） | `pm list packages` |
| 本次安装 | `com.android.vending` `53.3.21-31 [0] [PR] 986224237`（versionCode 85332130） | `aapt2 dump badging` |
| 结果 | 启动 **0 次崩溃**，前台窗口 `com.android.vending/…AssetBrowserActivity`；未登录时停在官方登录页 |
| 账号 | 已登录 `yuban10703@gmail.com`（`dumpsys account` 可见 `type=com.google`） |
| 安装链路 | **实测通过**：`com.google.android.contactkeys`（00:00:59）、`com.quicinc.voice.activation`（00:00:55）由商店下载并更新完成 | `dumpsys window` + `logcat` |

一句话：**这台机器不是「缺 GMS」，而是「GMS 齐了、商店被抽掉，而且固件主动禁止它启动」**。

---

## 二、直接侧载会崩，根因在 framework（关键）

第一次 `adb install` 成功后启动，立刻崩：

```
java.lang.RuntimeException: Unable to start activity ComponentInfo{com.android.vending/com.google.android.finsky.activities.MainActivity}:
    java.lang.SecurityException: This app is not allowed to start because Google Play is disabled.
    at com.android.server.wm.ActivityStarter.executeRequest(ActivityStarter.java:865)
```

抛异常的是 **system_server 的 `ActivityStarter`**（不是商店自己），所以这是 BOOX 在 AOSP 上打的补丁。
把 `services.jar` 拉下来反汇编，闸门判据链是这样的：

```
ActivityStarter.executeRequest()
  └─ android.onyx.utils.ActivityManagerHelper.isDisallow(pkg)
       └─ ActivityManagerHelper.gmsEnabled()
            └─ android.onyx.optimization.OnyxMMKVConfigHelper.getBool("gms_enable")
                 └─ /onyxconfig/mmkv/onyx_config     ← 系统级 MMKV（Tencent KV），权限 777
```

也就是：**只要 `gms_enable=false`，`com.android.vending` 这类包一律不许启动。**

那谁会把 `gms_enable` 写成 true？BOOX 设置应用里有个动作：

```
com.onyx.common.setting.action.CheckGMSAction
  h() → ContentService.checkGooglePlay(Build.MODEL)   // 联网问 BOOX 服务器要 "allowed"
  j() → DeviceConfig.getCheckGMS() && isDomesticType() // 国行/海外机型判定
  m()/s() → OnyxSystemMMKVUtils.putBool("gms_enable", allowed)
```

也就是说 **官方开关是「服务器说了算」**：国行机器问不到 `allowed=true`，`gms_enable` 就一直为 false，商店装了也起不来。
（本次实测里，手动打开「设置」应用**没有**把我们已经置为 true 的值改回去；但按上面的逻辑，联网检查后仍有被写回 false 的可能，见第七节。）

> 顺带排除：`settings global phone_play_store_availability` 虽然当前是 0，但改成 1 **无效**（实测仍崩），它不是这道闸门，已还原为 0。

---

## 三、解法与用法

既然闸门读的是 MMKV 里的 `gms_enable`，就用 `app_process` 在设备本地直接调用 **ONYX 自己的框架 API** 把它置 true（不改系统分区、不需要 root）：

```bash
# 打开（默认设备 10.1.1.69:5555）
bash tools/device/enable-gms-play.sh 10.1.1.69:5555 on

# 只看当前值
bash tools/device/enable-gms-play.sh 10.1.1.69:5555 status

# 想还原成固件默认（商店会重新被拦）
bash tools/device/enable-gms-play.sh 10.1.1.69:5555 off
```

脚本做的事：编译 `tools/device/gms/SetGms.java`（纯反射，不依赖 ONYX SDK）→ `d8` 打包 → push 到 `/data/local/tmp/gms.dex` → `app_process` 执行 → 顺带 `pm enable` 并试启动商店验证前台窗口。

实测输出：

```
gms_enable(读前) = false
已写入 gms_enable = true
gms_enable(读回) = true
ActivityManagerHelper.gmsEnabled() = true
前台窗口：  mCurrentFocus=Window{… com.android.vending/com.android.vending.AssetBrowserActivity}
本次启动的崩溃数：0
✓ Play 商店已能在前台运行（未登录时会停在登录页）。
```

---

## 四、完整安装步骤（照抄即可）

```bash
ADB=.toolchain/android-sdk/platform-tools/adb
$ADB connect 10.1.1.69:5555

# 1) 取原版商店 APK（脚本按设备条件挑变体，并打印 sha256）
python3 tools/device/fetch-play-store.py --out tools/apk-inbox
# → google-play-store-53-3-21-release-universal-a12plus.apk

# 2) 装机（-g 直接把运行时权限一并授予）
$ADB -s 10.1.1.69:5555 install -r -g tools/apk-inbox/play-store-53.3.21-arm64-a12plus.apk

# 3) 打开 GMS 开关（不做这步，第 4 步必崩）
bash tools/device/enable-gms-play.sh 10.1.1.69:5555 on

# 4) 已由脚本代为启动；手动启动等价于：
$ADB -s 10.1.1.69:5555 shell am start -n com.android.vending/.AssetBrowserActivity
```

踩过的坑：

1. **`pm enable` 不能省**。BOOX 会把新装的第三方包置成 `DISABLED_USER`（自家应用侧载同样如此），脚本里已经内置；
2. **顺序很重要**：先装 APK、再开 `gms_enable`。反过来的话第一次启动就是一次崩溃记录；
3. APKMirror 上 **arm64-v8a + Android 12+ 那个变体是 split BUNDLE**（多个 APK），单装 base 会缺拆分件；
   要一个文件搞定就用 **universal + Android 12+**（本次用的就是它，minSdk 31，含 arm64/armv7/x86/x86_64）。

---

## 五、验收证据

| 检查 | 结果 |
|---|---|
| 启动崩溃 | **0 次**（`logcat -d \| grep -c 'FATAL EXCEPTION'` = 0） |
| 前台窗口 | `com.android.vending/com.android.vending.AssetBrowserActivity`（脚本判定通过） |
| 登录页 | 正常显示「登录即可查找最新的 Android 应用、游戏、电影、音乐等精彩内容」 |
| 桌面图标 | `cmd package query-activities -c android.intent.category.LAUNCHER` 能查到 `com.android.vending/.AssetBrowserActivity` |
| 包状态 | `installed=true hidden=false enabled=1`（BOOX 只在极少数情况下置 disabled，本次未触发） |
| **安装权限** | `INSTALL_PACKAGES` / `DELETE_PACKAGES` **granted=true** —— ROM 的 `privapp-permissions-google-product.xml` 里本来就给 `com.android.vending` 开了特权，即使它装在 `/data/app` 也拿到了 |
| **装 App 链路** | **端到端通过**：商店下载 → `PackageInstallerSession: Marking session … as applied` → `PACKAGE_ADDED`；`com.google.android.contactkeys`、`com.quicinc.voice.activation` 更新落地（`lastUpdateTime` = 2026-10-04 00:00:5x） |
| Play 保护机制 | 商店「管理应用和设备」页显示「未发现任何有害应用 · Play 保护机制在 1 分钟前进行了扫描」 |
| 网络 | 设备直连 Google 正常：`curl https://www.google.com` → 200，DNS 8 ms（ICMP 被丢包是正常的，别被 `ping` 误导） |
| 截图 | `tools/apk-inbox/play_02.png`（登录页）、`play_03.png`（GMS 账号登录页） |

---

## 六、用户侧已完成 / 仍需留意

1. ~~登录 Google 账号~~ —— **已完成**，商店已在正常拉取与更新应用。
2. **认证状态**（只有出问题时才需要处理）：进 `Play 商店 → 设置 → 关于 → Play Protect 认证`。
   若显示「设备未获得 Play 保护机制认证」，用同一个 Google 账号打开
   <https://www.google.com/android/uncertified/> 注册本机 Android ID（当前为 `43de0fc8301ccffa`，可用
   `adb shell settings get secure android_id` 复核），几分钟后重启商店即可。
   本次实测未见该提示。
3. **更新 Google Play 服务**（可选）：系统里的 GMS 仍是 2023 年的 `23.37.17`，商店已是 2026 年的版本，
   实测能正常工作；若日后提示「需要更新 Google Play 服务」，再按「Android 13 + arm64 变体」侧载升级。

---

## 七、风险、边界与回退（如实说明）

- **开关可能被写回 false**：`gms_enable` 的最终解释权在 BOOX 服务器（`checkGooglePlay`）。
  本次实测中，手动打开「设置」应用后它没有被改写；但固件若在某次联网检查后写回 false，
  **重跑一次 `enable-gms-play.sh … on` 即可**（`/data/local/tmp/gms.dex` 在重启后依然存在）。
- **重启持久性尚未验证**：MMKV 值落在 `/onyxconfig`（独立分区，持久），但「重启后 BOOX 开机流程会不会重判」没测。
  未做重启测试的原因是：本机 WiFi ADB 靠 `service.adb.tcp.port=5555`（非持久属性），
  重启后可能需要在设备上重新打开无线调试 —— 不想在你的设备上造成「失联」状态。
  想验证的话，重启后先跑一次 `status`，需要时再 `on`。
- **没有 root、没有改系统分区**：全程只动了 `/onyxconfig/mmkv/onyx_config` 里的一个键 + `/data/app` 里一个普通应用。
  完全回退：
  ```bash
  bash tools/device/enable-gms-play.sh 10.1.1.69:5555 off
  .toolchain/android-sdk/platform-tools/adb -s 10.1.1.69:5555 uninstall com.android.vending
  ```
- **GMS 版本偏老**：系统里的 GMS 是 2023 年的 `23.37.17`，而商店是 2026 年的 `53.3.21`。
  实测能起、能进登录流程；若后续出现「需要更新 Google Play 服务」之类的提示，再考虑把 GMS 也侧载升级
  （GMS 是系统应用，只能以「更新」形式装进 `/data`，需匹配 Android 13 + arm64 变体）。

---

## 附录 A：本次使用的 APK

| 项目 | 值 |
|---|---|
| 文件名 | `tools/apk-inbox/play-store-53.3.21-arm64-a12plus.apk`（该目录在 `.gitignore` 里，不入库） |
| 大小 / sha256 | 107,704,713 字节 / `6213d6f1a51bc442db2986e843aa2df7f3625e3b6f6759a77e909e4ea16ed881` |
| 包名 / 版本 | `com.android.vending` / versionCode `85332130`，versionName `53.3.21-31 [0] [PR] 986224237` |
| minSdk / targetSdk | 31 / 37 |
| 变体 | universal（arm64-v8a + armeabi-v7a + x86 + x86_64），nodpi，Android 12+ |
| 签名 | `CN=Android, O=Google Inc.`，证书 SHA-256 `7ce83c1b71f3d572fed04c8d40c5cb10ff75e6d87d9df6fbd53f0468c2905053` |
| 来源 | APKMirror `google-play-store-53-3-21-release`（脚本 `tools/device/fetch-play-store.py` 可复现解析过程） |

复核命令：

```bash
BT=.toolchain/android-sdk/build-tools/35.0.0
$BT/aapt2 dump badging tools/apk-inbox/play-store-53.3.21-arm64-a12plus.apk | head -3
JAVA_HOME=.toolchain/jdk17 $BT/apksigner verify --print-certs tools/apk-inbox/play-store-53.3.21-arm64-a12plus.apk
```

## 附录 B：排错命令清单

```bash
ADB=.toolchain/android-sdk/platform-tools/adb -s 10.1.1.69:5555

# 商店到底装没装（含已卸载的系统应用）
$ADB shell "pm list packages -u | grep -i vending"

# 是不是被闸门拦了：看 system_server 抛的 SecurityException
$ADB logcat -c; $ADB shell am start -n com.android.vending/.AssetBrowserActivity
$ADB logcat -d | grep -A3 "SecurityException: This app is not allowed"

# 开关当前值（不依赖 adb 到 PC 的脚本）
bash tools/device/enable-gms-play.sh 10.1.1.69:5555 status

# 商店权限/状态
$ADB shell "dumpsys package com.android.vending | grep -E 'enabled=|INSTALL_PACKAGES'"

# 截图（注意：不要用 exec-out，会插入一行 'capture from screenshot!' 破坏 PNG 头）
$ADB shell screencap -p /sdcard/x.png && $ADB pull /sdcard/x.png .
```

## 附录 C：取 Android ID / GSF ID 的各条路（2026-10-04 实测）

常见的网上写法是 `adb root` 之后用 sqlite3 读 GSF 的 `gservices.db`：

```bash
adb root
adb shell 'sqlite3 /data/user/$(cmd activity get-current-user)/*/*/gservices.db \
  "select * from main where name = \"android_id\";"'
```

**在这台 P6+ 上这条路走不通，而且不止 root 一个障碍**（逐条实测）：

| 障碍 | 实测结果 |
|---|---|
| `adb root` | ✗ `adbd cannot run as root in production builds`（`ro.build.type=user`、`ro.debuggable=0`、`ro.secure=1`），shell 始终是 `uid=2000(shell)` |
| 设备上有 `sqlite3` 吗 | ✗ `which sqlite3` 为空 —— Android 不预装，只有 userdebug/eng 固件通常才带；少了它，有 root 也得先 push 一个静态二进制 |
| 直接读目录 | ✗ `ls /data/data/com.google.android.gsf/databases/` → `Permission denied` |
| `run-as com.google.android.gsf` | ✗ `package not debuggable`（run-as 只对 debuggable 应用有效） |
| `su` | ✗ 设备上没有 su |
| GSF 的 content provider | ✗ `content query --uri content://com.google.android.gsf.gservices` → `SecurityException … requires com.google.android.providers.gsf.permission.READ_GSERVICES`（signature 级，shell 拿不到）；也没有 checkin/gsf 的 binder 服务可 `dumpsys` |

**免 root 能拿到的那个值**（也正是认证注册页要填的 Android ID）：

```bash
$ADB shell settings get secure android_id
# → 43de0fc8301ccffa（本机 2026-10-04 实测）
```

两点说明：

1. `gservices.db` 里 `main.android_id` 与 `Settings.Secure.ANDROID_ID` 在绝大多数机器上是同一个 16 位十六进制值
   （GSF checkin 用的就是它），但**本机无法证实** —— 证实它需要 root，而 root 拿不到，所以这里只写"通常一致"；
   Android 8 起 SSAID 对**应用**是按签名密钥分域的，`settings` 读到的是框架侧的基础值。
2. 顺带一提，`select * from main where name = "android_id"` 里的双引号在 SQLite 里是**标识符**语法，
   靠 SQLite 的兼容行为才被当成字符串；换单引号更稳妥。

实际上这台机器多半**不需要**注册认证：商店已能正常下载并安装应用更新，
而未认证设备恰恰是在下载/安装这一步被拦下报「此设备未获得 Play 保护机制认证」的。
要确认就进 `Play 商店 → 设置 → 关于 → Play Protect 认证`。

相关文档：[A01 设备基线](A01-device-baseline.md)（两台设备的采集数据）、[A06 验收流程](A06-acceptance.md)。
