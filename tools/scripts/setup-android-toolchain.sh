#!/usr/bin/env bash
# 安装 Android 构建链到工作区内的 .toolchain/（不依赖 apt，不使用 /tmp，可重复执行）。
#
# 版本是本仓库锁定并经实测的组合：
#   JDK 17 (Temurin) + Android SDK platform 35 / build-tools 35.0.0 + Gradle 8.14.3 + AGP 8.13.2
#
# 用法：
#   bash tools/scripts/setup-android-toolchain.sh
#   source .toolchain/env.sh && cd apps/android && ./gradlew assembleDebug
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TC="${ROOT}/.toolchain"
JDK="${TC}/jdk17"
SDK="${TC}/android-sdk"
GRADLE_DIST="${TC}/gradle-8.14.3"
GRADLE_VERSION="8.14.3"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"

mkdir -p "${TC}"

log() { printf '\n=== %s ===\n' "$*"; }
# 系统里没有 unzip，统一用 python3 解压
unzip_py() { python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"; }

log "JDK 17 (Temurin)"
if [ ! -x "${JDK}/bin/javac" ]; then
  curl -fL --retry 3 --retry-delay 2 -o "${TC}/jdk17.tar.gz" "${JDK_URL}"
  rm -rf "${JDK}"
  mkdir -p "${JDK}"
  tar -xzf "${TC}/jdk17.tar.gz" -C "${JDK}" --strip-components=1
  rm -f "${TC}/jdk17.tar.gz"
fi
export JAVA_HOME="${JDK}"
export PATH="${JDK}/bin:${PATH}"
java -version

log "Android cmdline-tools"
if [ ! -f "${SDK}/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -fL --retry 3 --retry-delay 2 -o "${TC}/cmdline-tools.zip" "${CMDLINE_TOOLS_URL}"
  mkdir -p "${SDK}/cmdline-tools"
  unzip_py "${TC}/cmdline-tools.zip" "${SDK}/cmdline-tools"
  rm -rf "${SDK}/cmdline-tools/latest"
  mv "${SDK}/cmdline-tools/cmdline-tools" "${SDK}/cmdline-tools/latest"
  rm -f "${TC}/cmdline-tools.zip"
fi
# python3 的 zipfile 不保留可执行位，必须显式补上（否则 sdkmanager: Permission denied）
chmod +x "${SDK}/cmdline-tools/latest/bin/"* 2>/dev/null || true
export ANDROID_HOME="${SDK}"
export ANDROID_SDK_ROOT="${SDK}"
SDKMANAGER="${SDK}/cmdline-tools/latest/bin/sdkmanager"

log "接受 SDK 许可"
yes 2>/dev/null | "${SDKMANAGER}" --sdk_root="${SDK}" --licenses >/dev/null 2>&1 || true

log "安装 SDK 组件（platform-tools / platform 35 / build-tools 35.0.0）"
"${SDKMANAGER}" --sdk_root="${SDK}" "platform-tools" "platforms;android-35" "build-tools;35.0.0"

log "Gradle ${GRADLE_VERSION}"
if [ ! -f "${GRADLE_DIST}/bin/gradle" ]; then
  curl -fL --retry 3 --retry-delay 2 -o "${TC}/gradle.zip" \
    "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
  unzip_py "${TC}/gradle.zip" "${TC}"
  rm -f "${TC}/gradle.zip"
fi
chmod +x "${GRADLE_DIST}/bin/"* 2>/dev/null || true

log "写入 ${TC}/env.sh（供后续命令 source）"
cat > "${TC}/env.sh" <<EOF
# 由 tools/scripts/setup-android-toolchain.sh 生成
export JAVA_HOME="${JDK}"
export ANDROID_HOME="${SDK}"
export ANDROID_SDK_ROOT="${SDK}"
export GRADLE_USER_HOME="${TC}/gradle-home"
export GRADLE_BIN="${GRADLE_DIST}/bin/gradle"
export PATH="${JDK}/bin:${SDK}/platform-tools:${GRADLE_DIST}/bin:\$PATH"
EOF

"${GRADLE_DIST}/bin/gradle" --version
log "完成：source .toolchain/env.sh"
