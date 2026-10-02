#!/usr/bin/env bash
# 构建可侧载的 debug APK。
#
# 前置：先跑一次 bash tools/scripts/setup-android-toolchain.sh
# 产物：apps/android/app/build/outputs/apk/debug/app-debug.apk
#
# 说明：Web 产物由 Gradle 的 syncWebAssets 任务触发 npm 构建（单一事实来源），
# 因此这里不需要单独调用 npm。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

if [ ! -f "${ROOT}/.toolchain/env.sh" ]; then
  echo "缺少 .toolchain/env.sh，请先执行：bash tools/scripts/setup-android-toolchain.sh" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${ROOT}/.toolchain/env.sh"

echo "JAVA_HOME=${JAVA_HOME}"
echo "ANDROID_HOME=${ANDROID_HOME}"
echo "GRADLE_USER_HOME=${GRADLE_USER_HOME}"

cd "${ROOT}/apps/android"
"${GRADLE_BIN}" --no-daemon "$@" assembleDebug

APK="${ROOT}/apps/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "${APK}" ]; then
  echo
  echo "APK: ${APK}"
  ls -lh "${APK}"
  echo
  echo "侧载：adb install -r '${APK}'"
  echo "真机验收：打开应用 → 设置 → 诊断，复制设备基线回填 docs/A01-device-baseline.md"
else
  echo "未找到 APK，构建可能失败" >&2
  exit 1
fi
