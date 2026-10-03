package com.einkgamebox

import android.app.Activity
import android.content.Context
import android.view.View
import android.view.WindowManager

/**
 * 设备能力后端：只保留与屏幕刷新**无关**的设备能力（前光、全屏、常亮）。
 *
 * 刷新那一条链路（档位 / 全刷 / 区域刷新 / 快刷动画 / 能力探测）已整条删除，
 * 界面也不再暴露入口。
 */
interface EinkBackend {
    fun setFullscreen(activity: Activity?, on: Boolean)
    fun keepScreenOn(activity: Activity?, on: Boolean)
}

/**
 * 与设备无关的部分（全屏、常亮）放在这里。
 * 刻意**不用 androidx.core 的 WindowInsetsController**：目标是 Android 6–12 的墨水屏设备，
 * 平台自带的 systemUiVisibility 在这些版本上足够可靠，也不额外引入依赖。
 */
open class BaseEinkBackend(protected val context: Context) : EinkBackend {

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

}

/** 后端工厂：只有通用实现，不做任何厂商探测 */
object EinkBackendFactory {
    fun create(context: Context): EinkBackend = BaseEinkBackend(context)
}
