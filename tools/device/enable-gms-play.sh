#!/usr/bin/env bash
#
# 打开/关闭 BOOX 固件里的 GMS 总开关（gms_enable），让侧载的 Google Play 商店能启动。
#
# 用法：
#   tools/device/enable-gms-play.sh [设备地址] [on|off|status]
#   tools/device/enable-gms-play.sh                       # 默认 10.1.1.69:5555 status
#   tools/device/enable-gms-play.sh 10.1.1.69:5555 on
#
# 背景（安装过程属设备折腾，项目文档里不再记）：
#   BOOX 国行固件在 framework 的 ActivityStarter 里加了闸门，
#   只要 gms_enable=false 就拒绝启动 com.android.vending，
#   报 SecurityException: This app is not allowed to start because Google Play is disabled.
#   官方只在「设置」应用联网问 BOOX 服务器（checkGooglePlay）通过后才把该键写成 true，
#   国行机器问不到 true，所以商店启动即崩。本脚本用 app_process 直接在设备上调用
#   ONYX 自己的框架 API（OnyxMMKVConfigHelper.saveValue）把键写成 true。
#
# 前置：bash tools/scripts/setup-android-toolchain.sh（需要 JDK 17 + build-tools 里的 d8）
set -euo pipefail

DEVICE="${1:-10.1.1.69:5555}"
CMD="${2:-status}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/tools/device/gms/SetGms.java"
BUILD="${ROOT}/.toolchain/gms-helper"
REMOTE_DEX="/data/local/tmp/gms.dex"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

case "$CMD" in
  on|off|status) ;;
  *) die "第二个参数只能是 on / off / status（收到：$CMD）" ;;
esac

[ -f "${ROOT}/.toolchain/env.sh" ] || die "缺少 .toolchain/env.sh，请先执行：bash tools/scripts/setup-android-toolchain.sh"
# shellcheck source=/dev/null
source "${ROOT}/.toolchain/env.sh"
ADB="${ANDROID_HOME}/platform-tools/adb"
D8="${ANDROID_HOME}/build-tools/35.0.0/d8"
ANDROID_JAR="${ANDROID_HOME}/platforms/android-35/android.jar"
[ -x "$ADB" ] || die "找不到 adb：$ADB"
[ -x "$D8" ] || die "找不到 d8：$D8"

step "1/4 连接设备 $DEVICE"
if [[ "$DEVICE" == *:* ]]; then
  "$ADB" connect "$DEVICE" >/dev/null 2>&1 || true
fi
"$ADB" -s "$DEVICE" shell echo ok >/dev/null 2>&1 \
  || die "设备不可达（$DEVICE）。WiFi ADB 掉线时需在设备上重新开启无线调试。"

step "2/4 编译辅助 dex（app_process 用，纯反射、不依赖 ONYX SDK）"
rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex"
"${JAVA_HOME}/bin/javac" --release 8 -nowarn -d "$BUILD/classes" "$SRC"
"$D8" --lib "$ANDROID_JAR" --min-api 23 --output "$BUILD/dex" "$BUILD/classes/SetGms.class" >/dev/null
"$ADB" -s "$DEVICE" push "$BUILD/dex/classes.dex" "$REMOTE_DEX" >/dev/null

step "3/4 执行 SetGms $CMD"
# CLASSPATH 只放我们的 dex；framework 类由 app_process 自己挂载，因此能直接反射到 ONYX 隐藏 API。
"$ADB" -s "$DEVICE" shell "CLASSPATH=${REMOTE_DEX} app_process /system/bin SetGms ${CMD}"

if [ "$CMD" = "on" ]; then
  step "4/4 确认商店状态并试启动"
  # BOOX 会把新装的第三方包置为 DISABLED_USER，需要显式 enable（与自家应用侧载同款坑）。
  "$ADB" -s "$DEVICE" shell pm enable --user 0 com.android.vending >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE" shell am force-stop com.android.vending >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE" logcat -c >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE" shell am start -n com.android.vending/.AssetBrowserActivity >/dev/null 2>&1 || true
  sleep 12
  FOCUS="$("$ADB" -s "$DEVICE" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)"
  CRASH="$("$ADB" -s "$DEVICE" logcat -d 2>/dev/null | grep -c 'FATAL EXCEPTION' || true)"
  echo "前台窗口：${FOCUS:-（取不到）}"
  echo "本次启动的崩溃数：${CRASH}"
  if printf '%s' "$FOCUS" | grep -q 'com.android.vending'; then
    printf '\n\033[1m✓ Play 商店已能在前台运行（未登录时会停在登录页）。\033[0m\n'
  else
    printf '\n✗ 商店没有到前台，检查上面 SetGms 的读回值是否为 true。\n' >&2
    exit 1
  fi
else
  step "4/4 跳过（仅 on 会试启动商店）"
fi
