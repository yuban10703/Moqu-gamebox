package com.einkgamebox

import android.app.Activity
import android.content.Context
import android.view.View
import android.view.WindowManager

/** 屏幕刷新能力探测结果，原样交给 JS（不额外解释，避免误导） */
data class RefreshCapability(
    val onyxSdkFound: Boolean,
    val features: List<String>,
    val modes: List<String>,
    val fullRefresh: Boolean,
    val fastMode: Boolean,
)

/**
 * 屏幕能力后端。默认 Noop：在非 BOOX 设备上也能正常运行，绝不因为缺少 SDK 而崩溃。
 */
interface EinkBackend {
    val backendName: String
    fun capability(): RefreshCapability
    fun setProfile(profile: String)
    fun fullRefresh(target: View?)
    fun setFastMode(on: Boolean)
    fun setFrontLight(level: Int)
    fun setFullscreen(activity: Activity?, on: Boolean)
    fun keepScreenOn(activity: Activity?, on: Boolean)
    fun release()
}

/**
 * 与设备无关的部分（全屏、常亮）放在这里。
 * 刻意**不用 androidx.core 的 WindowInsetsController**：目标是 Android 6–12 的墨水屏设备，
 * 平台自带的 systemUiVisibility 在这些版本上足够可靠，也不额外引入依赖。
 */
abstract class BaseEinkBackend(protected val context: Context) : EinkBackend {

    @Suppress("DEPRECATION")
    override fun setFullscreen(activity: Activity?, on: Boolean) {
        val window = activity?.window ?: return
        val decor = window.decorView
        decor.systemUiVisibility = if (on) {
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        } else {
            View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    override fun keepScreenOn(activity: Activity?, on: Boolean) {
        val window = activity?.window ?: return
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun setFrontLight(level: Int) = Unit

    override fun release() = Unit
}

/** 非 BOOX 设备 / SDK 不可用时的通用后端：明确报告「不支持」，界面据此给出系统指引 */
class NoopEinkBackend(context: Context) : BaseEinkBackend(context) {
    override val backendName = "generic"
    override fun capability() = RefreshCapability(
        onyxSdkFound = false,
        features = emptyList(),
        modes = emptyList(),
        fullRefresh = false,
        fastMode = false,
    )

    override fun setProfile(profile: String) = Unit
    override fun fullRefresh(target: View?) = Unit
    override fun setFastMode(on: Boolean) = Unit
}
