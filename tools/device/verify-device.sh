#!/usr/bin/env bash
#
# 真机一键验收：连接 → 构建 → 安装 → 授权 → 启动 → 端口转发 → 逐款游戏审计
#
# 用法：tools/device/verify-device.sh [设备地址] [转发端口]
#   tools/device/verify-device.sh 10.1.1.69:5555 9333
#
# 这里固化了几个踩过的坑：
#   1. 侧载后包可能处于 DISABLED_USER 状态 —— 必须 `pm enable` 两次才会生效；
#   2. WiFi ADB 常掉线 —— 每次先 forward --remove-all 再重建，否则转发指向失效进程；
#   3. 设备息屏后 WebView 停止渲染，取值会得到陈旧数据 —— 每一步前先 KEYCODE_WAKEUP；
#   4. WebView 的调试端口名带 pid，所以必须先拿到 pid 才能转发。
set -euo pipefail

DEVICE="${1:-10.1.1.69:5555}"
PORT="${2:-9333}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB="${ROOT}/.toolchain/android-sdk/platform-tools/adb"
APK="${ROOT}/apps/android/app/build/outputs/apk/debug/app-debug.apk"
WS_FILE="${ROOT}/.toolchain/ws-$(echo "$DEVICE" | tr '.:' '__').txt"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

[ -x "$ADB" ] || die "找不到 adb：$ADB"

step "1/7 连接设备 $DEVICE"
if [[ "$DEVICE" == *:* ]]; then
  "$ADB" connect "$DEVICE" >/dev/null 2>&1 || true
fi
"$ADB" -s "$DEVICE" shell echo ok >/dev/null 2>&1 \
  || die "设备不可达（$DEVICE）。WiFi ADB 掉线时需在设备上重新开启无线调试；被防火墙挡住会报 No route to host。"

# 现版本只有一种构建配置：Onyx SDK 已完全移除（无任何开关）
# （该构建开关已随 Onyx SDK 一并删除，现版本只有一种构建配置）
# 显式传参等于绕过默认值，默认值错了也发现不了。
(cd "$ROOT" && source .toolchain/env.sh && cd apps/android && "$GRADLE_BIN" --no-daemon assembleDebug >/dev/null) \
  || die "构建失败"
[ -f "$APK" ] || die "没有找到产物：$APK"

step "3/7 安装"
"$ADB" -s "$DEVICE" install -r "$APK" | tail -1

step "4/7 授权（侧载后需 enable 两次）"
"$ADB" -s "$DEVICE" shell pm enable --user 0 com.einkgamebox >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" shell pm enable --user 0 com.einkgamebox >/dev/null 2>&1 || true

step "5/7 启动"
"$ADB" -s "$DEVICE" shell am force-stop com.einkgamebox >/dev/null 2>&1 || true
sleep 2
"$ADB" -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" shell am start -n com.einkgamebox/.MainActivity >/dev/null 2>&1
sleep 12

step "6/7 端口转发"
PID="$("$ADB" -s "$DEVICE" shell pidof com.einkgamebox | tr -d '\r')"
[ -n "$PID" ] || die "应用没有起来（pid 为空）"
"$ADB" -s "$DEVICE" forward --remove-all >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" forward "tcp:$PORT" "localabstract:webview_devtools_remote_$PID" >/dev/null
WS="$(curl -sS "http://127.0.0.1:$PORT/json/list" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["webSocketDebuggerUrl"])')"
[ -n "$WS" ] || die "拿不到 WebView 调试地址（端口 $PORT）"
printf '%s' "$WS" > "$WS_FILE"
echo "调试地址已写入 $WS_FILE"

step "7/7 逐款游戏审计"
python3 "$ROOT/tools/device/audit-games.py" "$WS_FILE" - "$DEVICE"

printf '\n\033[1m完成。截图可用 tools/device/shot-games.py；测量几何用 measure-board.py。\033[0m\n'
