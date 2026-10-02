pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        // BOOX 官方 Maven。注意：该仓库的 HTTPS 握手会失败（DH key too small），
        // 只能走 HTTP，因此必须显式声明 isAllowInsecureProtocol。
        // SDK 默认只以 compileOnly 引入（纯反射调用），只有开启 -PonyxBundled 时才会真正打进去。
        maven {
            url = uri("http://repo.boox.com/repository/maven-public/")
            isAllowInsecureProtocol = true
        }
        maven {
            url = uri("http://repo.boox.com/repository/proxy-public/")
            isAllowInsecureProtocol = true
        }
    }
}

rootProject.name = "eink-gamebox"
include(":app")
