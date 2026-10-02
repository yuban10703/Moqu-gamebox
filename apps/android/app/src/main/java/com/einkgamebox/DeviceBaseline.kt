package com.einkgamebox

import android.content.Context
import android.hardware.input.InputManager
import android.os.Build
import android.util.DisplayMetrics
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * 设备基线采集（对应 A01）。真机跑一次诊断页即可回填文档表格。
 * 只采集设备能力，不采集任何用户标识。
 */
object DeviceBaseline {

    fun collect(context: Context, capability: RefreshCapability): JSONObject {
        val metrics: DisplayMetrics = context.resources.displayMetrics

        val hardwareKeys = JSONArray()
        if (KeyCharacterMap.deviceHasKey(KeyEvent.KEYCODE_PAGE_UP)) hardwareKeys.put("pageUp")
        if (KeyCharacterMap.deviceHasKey(KeyEvent.KEYCODE_PAGE_DOWN)) hardwareKeys.put("pageDown")
        if (KeyCharacterMap.deviceHasKey(KeyEvent.KEYCODE_BACK)) hardwareKeys.put("back")
        if (KeyCharacterMap.deviceHasKey(KeyEvent.KEYCODE_VOLUME_UP)) hardwareKeys.put("volumeUp")
        if (KeyCharacterMap.deviceHasKey(KeyEvent.KEYCODE_VOLUME_DOWN)) hardwareKeys.put("volumeDown")

        val stylusSupported = detectStylus(context)

        val webViewVersion = try {
            WebViewCompat.getCurrentWebViewPackage(context)?.versionName
        } catch (error: Throwable) {
            null
        }

        return JSONObject().apply {
            put("platform", "android")
            put("manufacturer", Build.MANUFACTURER ?: "")
            put("model", Build.MODEL ?: "")
            put("androidSdk", Build.VERSION.SDK_INT)
            put("webViewVersion", webViewVersion ?: JSONObject.NULL)
            put("userAgent", System.getProperty("http.agent") ?: "")
            put("locale", java.util.Locale.getDefault().toString())
            put("screen", JSONObject().put("width", metrics.widthPixels).put("height", metrics.heightPixels))
            put("touch", JSONObject().put("maxTouchPoints", 1).put("coarse", true))
            put("hardwareKeys", hardwareKeys)
            put("stylusSupported", stylusSupported)
            put(
                "refresh",
                JSONObject()
                    .put("onyxSdkFound", capability.onyxSdkFound)
                    .put("features", JSONArray(capability.features))
                    .put("modes", JSONArray(capability.modes))
                    .put("fullRefresh", capability.fullRefresh)
                    .put("fastMode", capability.fastMode),
            )
        }
    }

    /**
     * 触笔探测：按输入设备的 source 位判断。
     * 注意 `PackageManager` 里**没有**触摸笔的 FEATURE_* 常量（已核对 android-35 的 android.jar），
     * 所以这里用 InputManager 而不是 hasSystemFeature。
     */
    private fun detectStylus(context: Context): Boolean = try {
        val manager = context.getSystemService(Context.INPUT_SERVICE) as? InputManager
        manager?.inputDeviceIds?.any { id ->
            val device = manager.getInputDevice(id)
            device != null && (device.sources and InputDevice.SOURCE_STYLUS) == InputDevice.SOURCE_STYLUS
        } ?: false
    } catch (error: Throwable) {
        false
    }
}
