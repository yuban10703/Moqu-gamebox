package com.einkgamebox

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import java.lang.reflect.Method
import java.lang.reflect.Modifier

/**
 * BOOX（Onyx）屏幕接口的**纯反射**实现。
 *
 * 为什么用反射而不是直接依赖 SDK：
 * - SDK 传递依赖重（fastjson2 / batik…），打进 APK 既大又容易冲突；
 * - 不同固件暴露的类与方法并不一致；
 * - 设备上没有这些类时可以安全降级，而不是崩溃。
 *
 * 真机实测（Note X2 + onyxsdk-device 1.3.6）得到两条重要结论，本类据此设计：
 * 1. `EpdController.invalidate(View, UpdateMode)` 会抛 `AssertionError`
 *    （SDK 内部 SDMDevice 断言失败，根因是它没能识别这台机型），
 *    但 `setViewDefaultUpdateMode` / `refreshScreen` / `repaintEveryThing` 可以正常工作。
 *    → 因此整屏全刷按**候选顺序尝试**，谁成功就用谁，全失败才改口说不支持。
 * 2. `getViewDefaultUpdateMode(View)` 可以**回读**已设置的局部模式 →
 *    于是「设置档位」这件事可以被验证，而不是只汇报「我调用过了」。
 */
class OnyxEinkBackend(context: Context) : BaseEinkBackend(context) {

    private val epdController: Class<*>? = tryLoad("com.onyx.android.sdk.api.device.epd.EpdController")
    private val updateModeClass: Class<*>? = tryLoad("com.onyx.android.sdk.api.device.epd.UpdateMode")
    private val frontLightClass: Class<*>? = tryLoad("com.onyx.android.sdk.api.device.FrontLightController")

    private val availableModes: List<String> = readModeNames(updateModeClass)

    private val setViewModeMethod: Method? =
        findStatic(epdController, "setViewDefaultUpdateMode", View::class.java, updateModeClass)
    private val getViewModeMethod: Method? =
        findStatic(epdController, "getViewDefaultUpdateMode", View::class.java)

    /** 整屏全刷的候选实现，按优先级排列：先试专用的，再试通用的 */
    private val fullRefreshCandidates: List<Pair<String, Method>> = listOfNotNull(
        findStatic(epdController, "refreshScreen", View::class.java, updateModeClass)
            ?.let { "refreshScreen" to it },
        findStatic(epdController, "repaintEveryThing", updateModeClass)
            ?.let { "repaintEveryThing" to it },
        findStatic(epdController, "applyTransientUpdate", updateModeClass)
            ?.let { "applyTransientUpdate" to it },
        findStatic(epdController, "invalidate", View::class.java, updateModeClass)
            ?.let { "invalidate" to it },
    )

    private val deviceManagerClass: Class<*>? =
        tryLoad("com.onyx.android.sdk.api.device.EpdDeviceManager")

    /** 动画模式：EpdDeviceManager.enterAnimationUpdate / exitAnimationUpdate */
    private val enterAnimationMethod: Method? =
        findStatic(deviceManagerClass, "enterAnimationUpdate", Boolean::class.javaPrimitiveType)
    private val exitAnimationMethod: Method? =
        findStatic(deviceManagerClass, "exitAnimationUpdate", Boolean::class.javaPrimitiveType)

    /**
     * 只读的系统快刷状态查询。
     * 曾经支持过 `applySystemFastMode(boolean)`，但已移除：那是**整机级**开关、
     * 会改变用户其它应用的刷新行为，属于擅自改动设备全局设置；
     * 而且真机上根本开不起来（调用被接受但回读始终 false）。
     * 这里保留只读查询，仅用于诊断页展示当前状态。
     */
    private val inSystemFastModeMethod: Method? = findStatic(epdController, "inSystemFastMode")
    private val isInFastModeMethod: Method? = findStatic(epdController, "isInFastMode")

    /** 一次性模式切换：applyTransientUpdate / clearTransientUpdate */
    private val applyTransientMethod: Method? =
        findStatic(epdController, "applyTransientUpdate", updateModeClass)
    private val clearTransientMethod: Method? =
        findStatic(epdController, "clearTransientUpdate", Boolean::class.javaPrimitiveType)

    private val frontLightMethod: Method? = findFrontLight()

    /**
     * 区域刷新的候选实现。坐标是**视图坐标系**（像素），因此网页侧要把 CSS 坐标乘 DPR。
     * `refreshScreenRegion` 是专门做这件事的；六参数的 `invalidate` 是退路。
     */
    private val regionRefreshCandidates: List<Pair<String, Method>> = listOfNotNull(
        findStatic(
            epdController, "refreshScreenRegion", View::class.java,
            Int::class.javaPrimitiveType, Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, updateModeClass,
        )?.let { "refreshScreenRegion" to it },
        findStatic(
            epdController, "invalidate", View::class.java,
            Int::class.javaPrimitiveType, Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, updateModeClass,
        )?.let { "invalidateRegion" to it },
    )

    private var currentView: View? = null
    private var fastModeOn = false
    /** 已进入的动画/快刷路径，退出时必须按原路退出 */
    private var activeAnimationPath: String? = null

    /** 实际验证成功的全刷实现名；一旦全部失败就置为空并改口为「不支持」 */
    private var workingFullRefresh: String? = null
    private var fullRefreshAttempted = false
    private var lastFullRefreshError: String? = null
    /** 区域刷新同样只认「实测可用」的实现 */
    private var workingRegionRefresh: String? = null
    private var regionRefreshAttempted = false
    private var lastRegionError: String? = null
    /**
     * 局部模式（刷新档位）是否**验证过**确实生效。
     * 默认 false：未经验证就不算可用；只有「写入与当前不同的模式后读回真的变了」才算通过。
     */
    private var partialModeVerified: Boolean = false

    override val backendName = "onyx"

    override fun bindView(view: View, onVerified: Runnable) {
        currentView = view
        view.post {
            // 启动第一件事：清掉上一次可能遗留的动画/快刷状态。
            // 实测隐患：应用在动画模式中被强杀（用户点不动停止只能杀进程）时，
            // 退出逻辑根本没机会跑，于是设备可能留在快刷状态。
            if (exitAnimationMethod != null) {
                Log.i(TAG, "startup cleanup: exitAnimationUpdate to clear any leftover animation state")
                invokeOrNull(exitAnimationMethod, true)
            }
            activeAnimationPath = null
            // 顺序很重要：先验证局部模式，再做全刷。
            // 因为刚做完全刷时 getViewDefaultUpdateMode 会短暂返回全刷用的模式（GC），
            // 那时再验证会被这个瞬态骗成「写入生效了」。
            verifyPartialMode(view)
            setProfile(DEFAULT_PROFILE)
            // 启动时做一次真实全刷：既清理残影，也顺带验证这条路到底能不能走通。
            // 未验证前 capability 只声明「方法存在」，验证失败后立刻改口，避免界面留着点了没用的按钮。
            fullRefresh(view)
            // 顺带用一个小到几乎看不见的矩形验证区域刷新这条路（4×4 像素）
            refreshRegion(0, 0, 4, 4)
            // 全部验证结束后再通知网页重新读取能力清单。
            // 用固定延时通知是不够的：验证本身要驱动一次真实全刷（百毫秒级），
            // 通知早于验证完成时，网页读到的是「未验证」的值，功能会被静默禁用。
            onVerified.run()
        }
    }

    /**
     * 验证「档位是否真的生效」。
     *
     * 注意不能只做「写入后回读是否等于请求值」——那在「请求值恰好等于当前值」时也会成立，
     * 属于假阳性（实测：请求 DU 时设备本来就是 DU，于是"验证通过"）。
     * 真正的验证必须是：写一个与当前**不同**的值，然后观察读回是否发生了变化。
     */
    private fun verifyPartialMode(view: View) {
        val method = setViewModeMethod ?: return
        val before = readBackMode(view) ?: return
        val probes = RefreshMapping.partialCandidates(DEFAULT_PROFILE) + RefreshMapping.partialCandidates("speed")
        val probeName = probes.firstOrNull { !it.equals(before, ignoreCase = true) } ?: return
        val probe = modeValue(listOf(probeName)) ?: return
        invokeForResult(method, view, probe)
        val after = readBackMode(view)
        // 判据必须同时满足两点：写入了与当前不同的值，且读回确实变成了请求的值。
        // 只看「发生了变化」会被别的瞬态骗到（实测：全刷刚结束时读回是 GC，写任何值都会"变化"）。
        partialModeVerified = after != null &&
            after.equals(probeName, ignoreCase = true) &&
            !probeName.equals(before, ignoreCase = true)
        Log.i(
            TAG,
            "partial mode verification: before=$before probe=$probeName after=${after ?: "n/a"} " +
                "verified=$partialModeVerified",
        )
    }

    /** 仅看系统属性判设备身份（与「类是否打进 APK」无关） */
    private fun isOnyxDevice(): Boolean =
        Build.MANUFACTURER.equals("onyx", ignoreCase = true) ||
            Build.BRAND.equals("onyx", ignoreCase = true)

    override fun capability(): RefreshCapability {
        // 「类存在」与「设备确实是 BOOX」必须分开判断：开启 -PonyxBundled 后类总是存在，
        // 只用类存在做判断会在普通安卓设备上谎报支持；而那些调用在非 BOOX 设备上必然失败。
        val classesPresent = epdController != null && updateModeClass != null
        val onyxDevice = isOnyxDevice()
        val supported = classesPresent && onyxDevice

        // 全刷：尝试过并且全部失败 → 如实报告不支持
        val fullRefreshUsable = supported &&
            fullRefreshCandidates.isNotEmpty() &&
            !(fullRefreshAttempted && workingFullRefresh == null)

        val features = buildList {
            if (classesPresent) add("sdk-classes")
            if (workingRegionRefresh != null) add("regionRefreshNotHonored:updatesFullScreen")
            if (onyxDevice) add("onyx-device")
            if (setViewModeMethod != null) add("partialMode")
            if (getViewModeMethod != null) add("partialModeReadback")
            fullRefreshCandidates.forEach { add("fullRefreshCandidate:${it.first}") }
            workingFullRefresh?.let { add("fullRefreshWorks:$it") }
            lastFullRefreshError?.let { add("fullRefreshError:$it") }
            regionRefreshCandidates.forEach { add("regionRefreshCandidate:${it.first}") }
            workingRegionRefresh?.let { add("regionRefreshWorks:$it") }
            lastRegionError?.let { add("regionRefreshError:$it") }
            if (enterAnimationMethod != null) add("animationCandidate:enterAnimationUpdate")
            if (applyTransientMethod != null) add("animationCandidate:applyTransientUpdate")
            if (inSystemFastModeMethod != null) add("animationReadback:inSystemFastMode")
            add("animationVerified:no-readback-api")
            activeAnimationPath?.let { add("animationActive:$it") }
            if (frontLightClass != null) add("FrontLightController")
        }

        return RefreshCapability(
            onyxSdkFound = supported,
            features = features,
            modes = availableModes,
            fullRefresh = fullRefreshUsable,
            fastMode = false, // 3 参数的 applyApplicationFastMode 在 1.3.6 不存在；5 参数版语义未知，不猜
            partialProfiles = supported && setViewModeMethod != null && partialModeVerified,
            // 区域刷新：真机实测「传了区域仍然整屏刷新」，因此报告为不可用，
            // 并把证据留在 features 里，避免后续再有人被这个 API 名骗一次。
            regionRefresh = false,
            animationMode = supported &&
                (enterAnimationMethod != null || applyTransientMethod != null),
        )
    }

    override fun setProfile(profile: String) {
        val view = currentView ?: return
        val mode = modeValue(RefreshMapping.partialCandidates(profile)) ?: return
        val requested = modeName(mode)
        val method = setViewModeMethod ?: return

        // 只做视图级设置，并且通过「写入前后读回是否变化」来判定是否真的生效。
        //
        // 刻意不做「系统级」回退（setSystemDefaultUpdateMode）：那是整机默认值，
        // 一个游戏应用不该为了自己的档位去改用户其它应用的显示行为。
        val before = readBackMode(view)
        val accepted = invokeForResult(method, view, mode) != false
        val after = readBackMode(view)
        // 生效的判据：读回等于请求值，且与写入前不同（否则只是「本来就是它」）
        val effective = after != null &&
            after.equals(requested, ignoreCase = true) &&
            !requested.equals(before, ignoreCase = true)
        partialModeVerified = effective
        Log.i(
            TAG,
            "partial mode: profile=$profile requested=$requested before=${before ?: "n/a"} " +
                "after=${after ?: "n/a"} accepted=$accepted verified=$effective",
        )
    }

    override fun fullRefresh(target: View?) {
        val view = target ?: currentView ?: return
        if (fullRefreshCandidates.isEmpty()) return
        val mode = modeValue(RefreshMapping.fullRefreshCandidates()) ?: return

        fullRefreshAttempted = true
        for ((name, method) in fullRefreshCandidates) {
            val arguments = method.parameterTypes.map { type ->
                when {
                    type == View::class.java -> view
                    type == updateModeClass -> mode
                    else -> null
                }
            }.toTypedArray()
            if (arguments.any { it == null }) continue
            try {
                val result = method.invoke(null, *arguments)
                if (result is Boolean && !result) {
                    Log.w(TAG, "full refresh via $name returned false")
                    lastFullRefreshError = "$name:returned-false"
                    continue
                }
                workingFullRefresh = name
                lastFullRefreshError = null
                Log.i(TAG, "full refresh applied via $name mode=${modeName(mode)}")
                return
            } catch (error: Throwable) {
                val cause = (error.cause ?: error)
                lastFullRefreshError = "$name:${cause.javaClass.simpleName}"
                Log.w(TAG, "full refresh via $name failed: ${cause.javaClass.simpleName}: ${cause.message}")
            }
        }
        // 所有候选都失败：记下来，capability 从此改口为不支持
        workingFullRefresh = null
        Log.w(TAG, "no working full refresh path on this device ($lastFullRefreshError)")
    }

    override fun setAnimationMode(on: Boolean, preferred: String): String? {
        val view = currentView

        if (!on) {
            val path = activeAnimationPath ?: return null
            // 只撤销「我们自己开的那一个」。
            // 特别注意：绝不能无条件调用 applySystemFastMode(false) ——
            // 那会把用户在系统设置里自己打开的快刷关掉，属于擅自改动整机设置。
            when (path) {
                "enterAnimationUpdate" -> invokeOrNull(exitAnimationMethod, true)
                "applyTransientUpdate" -> invokeOrNull(clearTransientMethod, true)
            }
            activeAnimationPath = null
            cancelAnimationWatchdog()
            Log.i(TAG, "animation mode OFF via $path, state=${animationState()}")
            return path
        }


        // preferred 指定了就走哪条路：不指定会走下面的优先级链，测出来的可能不是你想测的那个
        if (preferred == "animation" && enterAnimationMethod != null) {
            val accepted = try {
                enterAnimationMethod.invoke(null, true)
                true
            } catch (error: Throwable) {
                false
            }
            if (accepted) {
                activeAnimationPath = "enterAnimationUpdate"
                armAnimationWatchdog()
                Log.i(TAG, "animation mode ON via enterAnimationUpdate (preferred)")
                return activeAnimationPath
            }
            return null
        }

        // 未指定时按优先级尝试，谁没抛异常用谁。
        // 说明：这几个接口都是 void，没有公开的「当前是否在动画模式」查询接口，
        // 因此这里只能确认「调用被接受且未抛异常」，无法像系统快刷那样回读验证 ——
        // 能力清单里把这一点如实标出来（animationVerified:no-readback-api）。
        if (enterAnimationMethod != null) {
            val accepted = try {
                enterAnimationMethod.invoke(null, true)
                true
            } catch (error: Throwable) {
                Log.w(TAG, "enterAnimationUpdate failed: ${(error.cause ?: error).javaClass.simpleName}")
                false
            }
            if (accepted) {
                activeAnimationPath = "enterAnimationUpdate"
                armAnimationWatchdog()
                Log.i(TAG, "animation mode ON via enterAnimationUpdate")
                return activeAnimationPath
            }
        }
        // 2) 一次性模式（ANIMATION 快刷）
        val animationMode = modeValue(listOf("ANIMATION", "ANIMATION_QUALITY", "ANIMATION_MONO", "DU"))
        if (applyTransientMethod != null && animationMode != null) {
            val ok = invokeOrNull(applyTransientMethod, animationMode)
            if (ok != false) {
                activeAnimationPath = "applyTransientUpdate"
                armAnimationWatchdog()
                Log.i(TAG, "animation mode ON via applyTransientUpdate(${modeName(animationMode)})")
                return activeAnimationPath
            }
        }
        // 刻意不再尝试系统级快刷：整机级开关会影响其它应用，本机也不可用，产品里不引入。
        if (view == null) return null
        Log.w(TAG, "no working animation mode path")
        return null
    }

    override fun animationState(): String {
        val animationOn = activeAnimationPath != null
        val systemFast = readBool(inSystemFastModeMethod)
        val fastMode = readBool(isInFastModeMethod)
        return "animation=$animationOn(${activeAnimationPath ?: "-"})" +
            " systemFast=${systemFast ?: "n/a"} fastMode=${fastMode ?: "n/a"}"
    }

    /**
     * 动画模式的原生看门狗。
     *
     * 为什么必须有：退出动画模式目前靠网页调用。可一旦网页冻住、渲染进程被杀、
     * 或者进程被强杀，这个调用就没机会执行，设备会被留在快刷状态
     * （真机上已经发生过一次，只能杀进程，且下一次启动才被清掉）。
     * 看门狗不依赖网页，到时自动退出。
     */
    private fun armAnimationWatchdog() {
        cancelAnimationWatchdog()
        val runnable = Runnable {
            if (activeAnimationPath != null) {
                Log.w(TAG, "animation watchdog fired - forcing exit after ${ANIMATION_WATCHDOG_MS}ms")
                setAnimationMode(false, "auto")
            }
        }
        watchdogRunnable = runnable
        watchdogHandler.postDelayed(runnable, ANIMATION_WATCHDOG_MS)
    }

    private fun cancelAnimationWatchdog() {
        watchdogRunnable?.let { watchdogHandler.removeCallbacks(it) }
        watchdogRunnable = null
    }

    private fun readBool(method: Method?): Boolean? {
        if (method == null) return null
        return try {
            method.invoke(null) as? Boolean
        } catch (error: Throwable) {
            null
        }
    }

    private fun invokeOrNull(method: Method?, vararg args: Any?): Any? {
        if (method == null) return null
        return try {
            method.invoke(null, *args)
        } catch (error: Throwable) {
            Log.w(TAG, "invoke ${method.name} failed: ${(error.cause ?: error).javaClass.simpleName}")
            null
        }
    }

    private val watchdogHandler = Handler(Looper.getMainLooper())
    private var watchdogRunnable: Runnable? = null

    override fun setFastMode(on: Boolean) {
        // 保留旧入口：映射到动画模式（不指定路径，走优先级链）
        setAnimationMode(on, "auto")
        fastModeOn = on
    }

    override fun setFrontLight(level: Int) {
        val method = frontLightMethod ?: return
        try {
            method.invoke(null, context, level.coerceIn(0, 100))
        } catch (error: Throwable) {
            Log.w(TAG, "setFrontLight failed", error)
        }
    }

    override fun refreshRegion(left: Int, top: Int, right: Int, bottom: Int): String? {
        val view = currentView ?: return null
        if (regionRefreshCandidates.isEmpty()) return null
        if (right <= left || bottom <= top) return null
        val mode = modeValue(RefreshMapping.regionCandidates()) ?: return null

        regionRefreshAttempted = true
        for ((name, method) in regionRefreshCandidates) {
            // 四个 int 参数按签名顺序填 left/top/right/bottom
            val intIndices = method.parameterTypes.withIndex()
                .filter { it.value == Int::class.javaPrimitiveType }
                .map { it.index }
            if (intIndices.size != 4) continue
            val values = listOf(left, top, right, bottom)
            val arguments = arrayOfNulls<Any?>(method.parameterTypes.size)
            method.parameterTypes.forEachIndexed { index, type ->
                arguments[index] = when {
                    type == View::class.java -> view
                    type == updateModeClass -> mode
                    type == Int::class.javaPrimitiveType -> values[intIndices.indexOf(index)]
                    else -> null
                }
            }
            if (arguments.any { it == null }) continue
            try {
                val result = method.invoke(null, *arguments)
                if (result is Boolean && !result) {
                    lastRegionError = "$name:returned-false"
                    continue
                }
                workingRegionRefresh = name
                lastRegionError = null
                Log.i(TAG, "region refresh via $name rect=[$left,$top,$right,$bottom] mode=${modeName(mode)}")
                return name
            } catch (error: Throwable) {
                val cause = error.cause ?: error
                lastRegionError = "$name:${cause.javaClass.simpleName}"
                Log.w(TAG, "region refresh via $name failed: ${cause.javaClass.simpleName}: ${cause.message}")
            }
        }
        workingRegionRefresh = null
        Log.w(TAG, "no working region refresh path ($lastRegionError)")
        return null
    }

    override fun release() {
        fastModeOn = false
        cancelAnimationWatchdog()
    }

    private fun readBackMode(view: View): String? {
        val method = getViewModeMethod ?: return null
        return try {
            modeName(method.invoke(null, view))
        } catch (error: Throwable) {
            null
        }
    }

    /** 调用并把返回值（若有）交出来，供上层判断 SDK 自己的结论 */
    private fun invokeForResult(method: Method, vararg args: Any?): Any? = try {
        method.invoke(null, *args)
    } catch (error: Throwable) {
        Log.w(TAG, "invoke ${method.name} failed", error)
        false
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
        clazz.enumConstants?.firstOrNull { (it as Enum<*>).name.equals(name, ignoreCase = true) }
            ?.let { return it }
        return try {
            clazz.getField(name).get(null)
        } catch (error: Throwable) {
            null
        }
    }

    private fun modeName(mode: Any?): String = when (mode) {
        null -> "null"
        is Enum<*> -> mode.name
        else -> mode.toString()
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
        /** 启动时用于验证局部模式是否真的生效 */
        private const val DEFAULT_PROFILE = "quality"
        /** 动画模式的最长驻留时间：到点由原生强制退出，不依赖网页 */
        private const val ANIMATION_WATCHDOG_MS = 60_000L

        fun isLikelyOnyx(): Boolean {
            if (Build.MANUFACTURER.equals("onyx", ignoreCase = true)) return true
            return tryLoad("com.onyx.android.sdk.api.device.epd.EpdController") != null
        }

        fun tryLoad(name: String): Class<*>? = try {
            Class.forName(name)
        } catch (error: Throwable) {
            null
        }

        private fun findStatic(owner: Class<*>?, name: String, vararg parameters: Class<*>?): Method? {
            if (owner == null) return null
            val wanted = parameters.toList()
            if (wanted.any { it == null }) return null
            return owner.methods.firstOrNull { method ->
                method.name == name &&
                    Modifier.isStatic(method.modifiers) &&
                    method.parameterTypes.toList() == wanted
            }
        }

        private fun readModeNames(modeClass: Class<*>?): List<String> {
            if (modeClass == null) return emptyList()
            modeClass.enumConstants
                ?.mapNotNull { (it as? Enum<*>)?.name }
                ?.let { if (it.isNotEmpty()) return it }
            return modeClass.fields
                .filter { Modifier.isStatic(it.modifiers) && it.type == modeClass }
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
