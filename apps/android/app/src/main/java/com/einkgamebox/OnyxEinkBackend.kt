package com.einkgamebox

import android.content.Context
import android.os.Build
import android.util.Log
import android.view.View
import java.lang.reflect.Method

/**
 * BOOX（Onyx）屏幕接口的**纯反射**实现。
 *
 * 为什么不直接依赖 SDK：
 * - SDK 传递依赖很重（fastjson2 / batik / rxjava…），打进 APK 既大又容易冲突；
 * - 不同固件暴露的类与方法签名并不一致（例如 setWebViewContrastOptimize
 *   在 onyxsdk-base 1.6.53 与 onyxsdk-device 1.3.6 的常量池里都找不到）；
 * - 设备上没有这些类时，反射失败可以被安全地降级成「通用模式」，而不是崩溃。
 *
 * 因此这里做的是：探测 → 记录能力 → 只调用确实存在且签名匹配的方法。
 */
class OnyxEinkBackend(context: Context) : BaseEinkBackend(context) {

    private val epdController: Class<*>? = tryLoad("com.onyx.android.sdk.api.device.epd.EpdController")
    private val updateModeClass: Class<*>? = tryLoad("com.onyx.android.sdk.api.device.epd.UpdateMode")
    private val frontLightClass: Class<*>? = tryLoad("com.onyx.android.sdk.api.device.FrontLightController")

    private val availableModes: List<String> = readModeNames(updateModeClass)
    private val invalidateMethod: Method? = findStatic(epdController, "invalidate", View::class.java, updateModeClass)
    private val setViewModeMethod: Method? =
        findStatic(epdController, "setViewDefaultUpdateMode", View::class.java, updateModeClass)
    private val fastModeMethod: Method? =
        findStatic(epdController, "applyApplicationFastMode", String::class.java, Boolean::class.javaPrimitiveType, Boolean::class.javaPrimitiveType)
    private val frontLightMethod: Method? = findFrontLight()

    private var currentView: View? = null
    private var fastModeOn = false

    override val backendName = "onyx"

    fun bindView(view: View) {
        currentView = view
    }

    override fun capability(): RefreshCapability {
        val features = buildList {
            if (epdController != null) add("EpdController")
            if (updateModeClass != null) add("UpdateMode")
            if (invalidateMethod != null) add("fullRefresh")
            if (setViewModeMethod != null) add("partialMode")
            if (fastModeMethod != null) add("fastMode")
            if (frontLightClass != null) add("FrontLightController")
        }
        return RefreshCapability(
            onyxSdkFound = epdController != null && updateModeClass != null,
            features = features,
            modes = availableModes,
            fullRefresh = invalidateMethod != null && modeValue(RefreshMapping.fullRefreshCandidates()) != null,
            fastMode = fastModeMethod != null,
        )
    }

    override fun setProfile(profile: String) {
        val view = currentView ?: return
        val method = setViewModeMethod ?: return
        val mode = modeValue(RefreshMapping.partialCandidates(profile)) ?: return
        invoke(method, view, mode)
    }

    override fun fullRefresh(target: View?) {
        val view = target ?: currentView ?: return
        val method = invalidateMethod ?: return
        val mode = modeValue(RefreshMapping.fullRefreshCandidates()) ?: return
        invoke(method, view, mode)
    }

    override fun setFastMode(on: Boolean) {
        val method = fastModeMethod ?: return
        if (on == fastModeOn) return
        fastModeOn = on
        try {
            // applyApplicationFastMode(app, enable, clear)
            method.invoke(null, context.packageName, on, on)
        } catch (error: Throwable) {
            Log.w(TAG, "applyApplicationFastMode failed", error)
        }
    }

    override fun setFrontLight(level: Int) {
        val method = frontLightMethod ?: return
        try {
            method.invoke(null, context, level.coerceIn(0, 100))
        } catch (error: Throwable) {
            Log.w(TAG, "setFrontLight failed", error)
        }
    }

    override fun release() {
        // 退出前必须把临时快刷模式恢复，避免把设备留在非正常状态
        if (fastModeOn) {
            fastModeOn = false
            try {
                fastModeMethod?.invoke(null, context.packageName, false, true)
            } catch (error: Throwable) {
                Log.w(TAG, "release fast mode failed", error)
            }
        }
    }

    private fun findFrontLight(): Method? {
        val target = frontLightClass ?: return null
        return target.methods.firstOrNull { method ->
            method.name.startsWith("setFrontLight") &&
                method.parameterTypes.contains(Context::class.java) &&
                method.parameterTypes.any { it == Int::class.javaPrimitiveType }
        }
    }

    private fun modeValue(candidates: List<String>): Any? {
        val name = RefreshMapping.actualName(candidates, availableModes) ?: return null
        val clazz = updateModeClass ?: return null
        // 枚举常量优先
        clazz.enumConstants?.firstOrNull { (it as Enum<*>).name.equals(name, ignoreCase = true) }?.let { return it }
        // 少数固件用静态字段暴露模式名
        return try {
            clazz.getField(name).get(null)
        } catch (error: Throwable) {
            null
        }
    }

    private fun invoke(method: Method, vararg args: Any?) {
        try {
            method.invoke(null, *args)
        } catch (error: Throwable) {
            Log.w(TAG, "invoke ${method.name} failed", error)
        }
    }

    companion object {
        private const val TAG = "OnyxEinkBackend"

        fun isLikelyOnyx(): Boolean {
            if (Build.MANUFACTURER.equals("onyx", ignoreCase = true)) return true
            return tryLoad("com.onyx.android.sdk.api.device.epd.EpdController") != null
        }

        fun tryLoad(name: String): Class<*>? = try {
            Class.forName(name)
        } catch (error: Throwable) {
            null
        }

        private fun findStatic(
            owner: Class<*>?,
            name: String,
            vararg parameters: Class<*>?,
        ): Method? {
            if (owner == null) return null
            val wanted = parameters.toList()
            if (wanted.any { it == null }) return null
            return owner.methods.firstOrNull { method ->
                method.name == name &&
                    java.lang.reflect.Modifier.isStatic(method.modifiers) &&
                    method.parameterTypes.toList() == wanted
            }
        }

        private fun readModeNames(modeClass: Class<*>?): List<String> {
            if (modeClass == null) return emptyList()
            modeClass.enumConstants
                ?.mapNotNull { (it as? Enum<*>)?.name }
                ?.let { if (it.isNotEmpty()) return it }
            return modeClass.fields
                .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && it.type == modeClass }
                .map { it.name }
        }
    }
}

/** 后端工厂：探测失败一律回退通用后端 */
object EinkBackendFactory {
    fun create(context: Context): EinkBackend = try {
        if (OnyxEinkBackend.isLikelyOnyx()) OnyxEinkBackend(context) else NoopEinkBackend(context)
    } catch (error: Throwable) {
        NoopEinkBackend(context)
    }
}
