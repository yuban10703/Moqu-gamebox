---
title: 国行 BOOX P6+ 装 Google Play：闸门藏在 framework 的一个布尔值里
date: 2026-10-04 02:10:00
tags:
  - BOOX
  - 墨水屏
  - Android
  - 逆向
categories:
  - 折腾
description: 国行 BOOX P6+ 自带 GMS 却没有商店，侧载后启动即崩。顺着 SecurityException 挖进 system_server，发现拦路的只是 MMKV 里的一个布尔值，用 app_process 反射调用厂商 API 解决，全程无需 root。
---

一台国行 BOOX P6+（ONYX P6Plus，Android 13），自带 Google Play 服务却唯独没有商店；把商店侧载进去，**安装成功，一启动就崩**。顺着崩溃栈挖到 `system_server`，最后发现拦路的只是 MMKV 里的一个布尔值 —— 全程不需要 root。

<!-- more -->

## 现象：装得上，起不来

先看家底：`com.google.android.gms`、`com.google.android.gsf` 都在系统里，连 `privapp-permissions-google-product.xml` 都给 `com.android.vending` 写好了特权白名单 —— 固件本来就是带商店编译的，国行版本只是把商店抠掉了。

于是取官方签名 APK 侧载：

```bash
adb install -r -g play-store-53.3.21.apk     # Success
adb shell pm enable --user 0 com.android.vending
adb shell am start -n com.android.vending/.AssetBrowserActivity
```

结果启动即崩：

```
java.lang.SecurityException: This app is not allowed to start because Google Play is disabled.
    at com.android.server.wm.ActivityStarter.executeRequest(ActivityStarter.java:865)
```

注意抛异常的是 **system_server**，不是商店自己 —— 跟商店版本、签名、权限都无关，是厂商在 framework 里加了闸门。

## 根因：一个读 MMKV 的布尔值

`services.jar` 可以直接 `adb exec-out cat` 拉下来。手写个精简 DEX 解析器定位报错字符串，判据链一目了然：

```
ActivityStarter.executeRequest()
  └─ ActivityManagerHelper.isDisallow(pkg)
       └─ ActivityManagerHelper.gmsEnabled()
            └─ OnyxMMKVConfigHelper.getBool("gms_enable")
                 └─ /onyxconfig/mmkv/onyx_config
```

那谁把它写成 `true`？BOOX 设置应用里的 `CheckGMSAction`：**联网调 `checkGooglePlay(Build.MODEL)` 问自家服务器要 `allowed`**，再配合 `isDomesticType()` 判定。国行机器永远问不到 `true`，商店装了也起不来 —— 能力被做成了服务端开关。

顺带排除一条红鲱鱼：`settings global phone_play_store_availability=0` 名字最像元凶，改成 1 照样崩。

## 解法：不 root，调用厂商自己的 API

既然闸门读的是 MMKV 键，而该文件权限是 777，就没必要 root；更稳的做法是**直接调用 ONYX 自己的 API 去写**，让厂商代码处理 MMKV 的格式与 CRC。

`app_process` 能以 shell 身份跑自定义 dex，且挂载 system 的 boot classpath —— framework 的隐藏 API 对它完全可见：

```java
Class<?> helper = Class.forName("android.onyx.optimization.OnyxMMKVConfigHelper");
Class<?>[] sig = { String.class, boolean.class };
helper.getDeclaredMethod("saveValue", sig).invoke(null, "gms_enable", true);
```

```bash
javac --release 8 -d out SetGms.java
d8 --lib android.jar --output dex out/SetGms.class
adb push dex/classes.dex /data/local/tmp/gms.dex
adb shell "CLASSPATH=/data/local/tmp/gms.dex app_process /system/bin SetGms on"
# → gms_enable(读回) = true / ActivityManagerHelper.gmsEnabled() = true
```

商店随即正常启动，启动崩溃 0 次。

## 验证：要能装 App，不只是能打开

商店装在 `/data/app`，但特权权限其实是授予状态：

```bash
adb shell "dumpsys package com.android.vending | grep INSTALL_PACKAGES"
#   android.permission.INSTALL_PACKAGES: granted=true
```

登录账号后，商店的「管理应用和设备」页显示 Play 保护机制已完成扫描、两项更新进行中；日志侧证据是：

```
PackageInstallerSession: Marking session 1104775103 as applied
BroadcastQueue: … Intent { act=android.intent.action.PACKAGE_ADDED … }
```

`com.google.android.contactkeys`、`com.quicinc.voice.activation` 的 `lastUpdateTime` 变成了当下 —— 下载、安装整条链路跑通。

## 踩过的坑

- BOOX 会把新装第三方包置为 `DISABLED_USER`，报「Activity class does not exist」，需再 `pm enable --user 0 <包名>`；
- `ping play.google.com` 100% 丢包不代表没网（ICMP 被丢），用 `curl -w '%{http_code}'` 才准；
- APKMirror 上 `arm64-v8a + Android 12+` 是 split BUNDLE，单装 base 会缺拆分件，选 `universal + Android 12+` 一个文件搞定；
- 页面上的版本列表不是「最新在前」，按顺序取第一个会拿到 2017 年的 8.0.22；
- `adb root` 读 `gservices.db` 这条路在 production build 上根本走不通（`adbd cannot run as root`，而且机器上连 `sqlite3` 都没有）；想要 Android ID，`settings get secure android_id` 免 root 就有。

## 复现

```bash
ADB="adb -s <设备IP>:5555"
python3 tools/device/fetch-play-store.py --out tools/apk-inbox     # 取原版 APK
$ADB install -r -g tools/apk-inbox/<商店>.apk
bash tools/device/enable-gms-play.sh <设备IP>:5555 on              # 开闸门
$ADB shell am start -n com.android.vending/.AssetBrowserActivity
```

不想用脚本也行，关键就两步：先 `install`，再把 `gms_enable` 写成 `true`（顺序反了第一次启动会崩一次）。

## 边界

- 开关解释权在 BOOX 服务器，某次联网检查后可能被写回 `false`，重跑一次脚本即可；
- **重启持久性未验证**：值落在 `/onyxconfig`（持久分区），但开机流程会不会重判没测 —— 这台机器的 WiFi ADB 靠非持久属性，重启可能失联，不想让设备进入连不上的状态；
- 全程没 root、没动系统分区，回退只需 `enable-gms-play.sh … off` 加 `adb uninstall com.android.vending`。

整个过程最值钱的不是找到那个键，而是**没有停在第一个像答案的地方**：异常是系统服务抛的，就不该去翻商店的版本；名字最像开关的设置项，实测一次就能否掉。厂商把能力做成服务端开关，用户在自己的设备上就得玩这种猫鼠游戏 —— 好在这次的对手是 framework，它读什么，我们就喂什么。

<!--
Hexo 使用说明（渲染后不可见，可删）：
1. 直接把本文件丢进 `source/_posts/` 即可；正文里那个 more 标记之前的内容会作为首页摘要。
2. 全文无图片，纯文字 + 代码块，任何主题都能正常渲染。
3. 已脱敏：不含设备 IP、Google 账号、Android ID、序列号。
4. 完整工程记录（逐条实测命令、验收数据、排错清单）在仓库 docs/device-google-play.md。
-->
