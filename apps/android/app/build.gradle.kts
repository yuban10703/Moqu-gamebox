import org.gradle.internal.os.OperatingSystem

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
 * 是否把 BOOX SDK 一并打进 APK。**默认内置**（此前的默认是不内置，现已反转并附实测依据）。
 *
 * 与 Onyx SDK 的关系（2026-10-04 重新实测后改口径）
 * 本项目在 BOOX 上验证过的刷新能力（整屏全刷 / 档位回读 / 动画模式探测）都靠**反射**调用 SDK 类，
 * 而那些类**不在系统里** —— 所以要把 SDK 打进来反射才找得到。
 * 但实测收益极小、代价很大：
 *   · 真正生效的只有「整屏全刷」一项（档位调用被接受但回读不变；区域刷新实际刷整屏；前光未使用）；
 *   · 而整屏全刷在 BOOX 上**系统手势本来就有**，应用内按钮只是便利；
 *   · 体积代价：内置 3.3MB / 不内置 1.5MB —— **差 1.8MB，超过整个 APK 的一半**
 *     （早先注释里写的"只差约 0.9MB"是错的，已按实测更正）。
 * 因此**默认不内置**。设备上探测不到 SDK 时会如实上报「不支持」并隐藏相关按钮，不会崩溃。
 *
 * 想恢复应用内全刷（或做 SDK 能力实验）时显式打进来：
 *   ./gradlew -PonyxBundled=true assembleDebug
 */
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
        // 仅在 -PonyxBundled=true 时打进 APK（默认不内置，理由见文件顶部）。
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

/**
 * 把 Web 端产物同步进 assets。
 * 用 Sync 而不是 Copy：Web 产物的文件名带内容哈希，Copy 会把旧哈希文件留在 APK 里，
 * 既浪费体积也容易让人误判「改的到底是哪一版」。
 */
val copyWebAssets by tasks.registering(Sync::class) {
    dependsOn(syncWebAssets)
    val dist = file("${rootProject.projectDir.parentFile.parentFile}/apps/web/dist")
    from(dist)
    into(layout.buildDirectory.dir("web-dist/web"))
}

tasks.named("preBuild") {
    dependsOn(copyWebAssets)
}
