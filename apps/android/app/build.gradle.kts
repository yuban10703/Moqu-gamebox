import org.gradle.internal.os.OperatingSystem

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** 是否把 BOOX SDK 一并打进 APK。默认 false（纯反射，零依赖，也不受 SDK 传递依赖影响）。 */
val onyxBundled: Boolean = (findProperty("onyxBundled") as String?)?.toBoolean() ?: false
/** 跳过网页资源构建（IDE 里反复编译时用） */
val skipWebBuild: Boolean = (findProperty("skipWebBuild") as String?)?.toBoolean() ?: false

android {
    namespace = "com.einkgamebox"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.einkgamebox"
        // BOOX 设备跨度较大：Android 6.0 起支持，旧机型上通过语法降级 + 能力探测保证可用
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            // 正式签名与上架合规在 M5 之后单独处理（见 docs/android.md）
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // 网页产物是构建生成物，不提交进仓库
    sourceSets {
        getByName("main") {
            assets.srcDirs("$buildDir/web-dist")
        }
    }

    lint {
        abortOnError = false
    }

    buildFeatures {
        // 壳层需要 BuildConfig.DEBUG 来决定是否开启 WebView 远程调试
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    if (onyxBundled) {
        // 逃生口：万一某台设备系统里没有 Onyx SDK 类，可以用这个开关把 SDK 打进来。
        // 该 SDK 传递依赖很重（fastjson2 / batik 等），因此默认不启用。
        implementation("com.onyx.android.sdk:onyxsdk-device:1.3.6") {
            exclude(group = "net.sf.saxon")
            exclude(group = "org.xmlresolver")
            exclude(group = "com.twelvemonkeys.imageio")
            exclude(group = "com.twelvemonkeys.common")
        }
    } else {
        compileOnly("com.onyx.android.sdk:onyxsdk-device:1.3.6")
    }
    testImplementation("junit:junit:4.13.2")
}

/**
 * 把 Web 端产物同步进 assets。
 * 单一事实来源：Web 打包由 npm 负责，Gradle 只负责搬运与触发。
 */
val syncWebAssets by tasks.registering(Exec::class) {
    group = "build"
    description = "构建 Web 端产物并作为 APK 内置资源（离线可用）"
    workingDir = rootProject.projectDir.parentFile.parentFile // 仓库根目录
    val npm = if (OperatingSystem.current().isWindows) "npm.cmd" else "npm"
    commandLine(npm, "run", "build:web")
    onlyIf { !skipWebBuild }
    doLast {
        // Service Worker 必须放在资源目录里一起打包
        val dist = file("${rootProject.projectDir.parentFile.parentFile}/apps/web/dist")
        if (!dist.exists()) throw GradleException("web dist not found: ${dist}")
    }
}

val copyWebAssets by tasks.registering(Copy::class) {
    dependsOn(syncWebAssets)
    val dist = file("${rootProject.projectDir.parentFile.parentFile}/apps/web/dist")
    from(dist)
    into(layout.buildDirectory.dir("web-dist/web"))
}

tasks.named("preBuild") {
    dependsOn(copyWebAssets)
}
