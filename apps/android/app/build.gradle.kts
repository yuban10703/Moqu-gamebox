import org.gradle.internal.os.OperatingSystem

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** 跳过网页资源构建（IDE 里反复编译时用） */
val skipWebBuild: Boolean = (findProperty("skipWebBuild") as String?)?.toBoolean() ?: false

/**
 * 正式签名（可选）：四个值都从环境变量或 gradle 属性读，CI 里由 GitHub Secrets 注入。
 * 齐了且 keystore 文件存在才启用；否则 **release 也回退 debug 签名** ——
 * 这样本地开发、以及还没配 Secrets 的 CI 都能照常构建（只是包与包之间签名不同，升级要先卸载）。
 */
val releaseKeystoreFile: String? = System.getenv("EINK_KEYSTORE_FILE") ?: (findProperty("einkKeystoreFile") as String?)
val releaseKeystorePassword: String? = System.getenv("EINK_KEYSTORE_PASSWORD") ?: (findProperty("einkKeystorePassword") as String?)
val releaseKeyAlias: String? = System.getenv("EINK_KEY_ALIAS") ?: (findProperty("einkKeyAlias") as String?)
val releaseKeyPassword: String? = System.getenv("EINK_KEY_PASSWORD") ?: (findProperty("einkKeyPassword") as String?)
val hasReleaseSigning: Boolean =
    listOf(releaseKeystoreFile, releaseKeystorePassword, releaseKeyAlias, releaseKeyPassword)
        .all { !it.isNullOrBlank() } && file(releaseKeystoreFile!!).exists()

android {
    namespace = "com.einkgamebox"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.einkgamebox"
        // BOOX 设备跨度较大：Android 6.0 起支持，旧机型上通过语法降级 + 能力探测保证可用
        minSdk = 23
        targetSdk = 35
        versionCode = 8
        versionName = "0.1.7"
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseKeystoreFile!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                // minSdk 23：Android 7 以下只认 v1(JAR) 签名，必须同时开 v1+v2
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            // 有正式 keystore 就用正式签名，否则回退 debug（见文件顶部 hasReleaseSigning）
            signingConfig =
                if (hasReleaseSigning) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
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
