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
    /** 刷新档位（局部模式）是否**验证过**确实生效，而不是「方法存在」 */
    val partialProfiles: Boolean = false,
    /** 区域刷新是否**验证过**真的能调用（能只刷指定矩形） */
    val regionRefresh: Boolean = false,
)

/**
 * 屏幕能力后端。默认 Noop：在非 BOOX 设备上也能正常运行，绝不因为缺少 SDK 而崩溃。
 */
interface EinkBackend {
    val backendName: String
    fun capability(): RefreshCapability
    /**
     * 绑定承载网页的视图。局部刷新模式是按「视图」设置的，
     * 不绑定就会出现「能力探测说支持、调用却静默返回」的假象。
     */
    fun bindView(view: View, onVerified: Runnable)
    fun setProfile(profile: String)
    fun fullRefresh(target: View?)
    /**
     * 只刷新指定矩形区域（视图坐标系，像素）。
     * 返回实际生效的实现名；不支持或全部失败返回 null。
     */
    fun refreshRegion(left: Int, top: Int, right: Int, bottom: Int): String?
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

    /** 通用设备没有区域刷新能力 */
    override fun refreshRegion(left: Int, top: Int, right: Int, bottom: Int): String? = null

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
        partialProfiles = false,
        regionRefresh = false,
    )

    override fun bindView(view: View, onVerified: Runnable) = onVerified.run()
    override fun setProfile(profile: String) = Unit
    override fun fullRefresh(target: View?) = Unit
    override fun refreshRegion(left: Int, top: Int, right: Int, bottom: Int): String? = null
    override fun setFastMode(on: Boolean) = Unit
}
