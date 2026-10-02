package com.einkgamebox

import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * 暴露给网页层的原生桥（window.EinkNative）。
 *
 * 安全边界（对应「原生桥接仅向内置可信内容开放」）：
 * - 只有安装包内置资源会被加载，外链一律交给系统浏览器；
 * - 方法只做存取与设备能力调用，不接受任意文件路径、不接受任意 URL、不执行外部代码。
 *
 * 线程：@JavascriptInterface 方法在 WebView 的 JavaBridge 线程被调用，
 * 因此**绝不阻塞**：需要 UI 的操作（文件选择、系统栏）统一 post 到主线程，
 * 结果通过 JS 回调返回，避免把 JS 线程卡住导致自动保存排队。
 */
class JsBridge(
    private val host: MainActivity,
    private val store: NativeStore,
    private val backend: EinkBackend,
) {
    /**
     * 不做缓存：全刷能力会在「启动时那次验证失败」之后改变结论（从可用改为不可用），
     * 缓存住会让界面一直显示一个点了没用的按钮。
     */
    private fun capability(): RefreshCapability = backend.capability()

    @JavascriptInterface
    fun version(): String = BRIDGE_VERSION

    @JavascriptInterface
    fun deviceBaseline(): String = DeviceBaseline.collect(host, capability()).toString()

    @JavascriptInterface
    fun getRefreshCapability(): String = capabilityJson(capability()).toString()

    // ---------- 存储 ----------
    @JavascriptInterface
    fun saveGet(key: String): String? = store.get(key)

    @JavascriptInterface
    fun savePut(key: String, value: String): String {
        store.put(key, value)
        return ok()
    }

    @JavascriptInterface
    fun saveDelete(key: String): String {
        store.delete(key)
        return ok()
    }

    @JavascriptInterface
    fun saveDeletePrefix(prefix: String): String {
        store.deletePrefix(prefix)
        return ok()
    }

    @JavascriptInterface
    fun saveKeys(prefix: String): String = JSONArray(store.keys(prefix)).toString()

    @JavascriptInterface
    fun saveCas(key: String, expected: String?, value: String): String {
        val (success, current) = store.cas(key, expected, value)
        return if (success) {
            JSONObject().put("ok", true).toString()
        } else {
            JSONObject()
                .put("ok", false)
                .put("current", current ?: JSONObject.NULL)
                .toString()
        }
    }

    @JavascriptInterface
    fun savePutMany(entriesJson: String): String {
        val entries = ArrayList<Pair<String, String>>()
        try {
            val array = JSONArray(entriesJson)
            for (index in 0 until array.length()) {
                val pair = array.getJSONArray(index)
                entries.add(pair.getString(0) to pair.getString(1))
            }
        } catch (error: Throwable) {
            return failure("bad-entries")
        }
        store.putMany(entries)
        return ok()
    }

    // ---------- 屏幕能力 ----------
    @JavascriptInterface
    fun setRefreshProfile(profile: String) = host.runOnUiThread { backend.setProfile(profile) }

    @JavascriptInterface
    fun fullRefresh() = host.runOnUiThread { backend.fullRefresh(host.gameView()) }

    /**
     * 只刷新一个矩形区域（视图坐标，像素；网页侧需把 CSS 坐标乘 DPR）。
     * 典型用途：走一步棋之后只刷棋盘那一块，而不是整屏闪一次。
     */
    @JavascriptInterface
    fun refreshRegion(left: Int, top: Int, right: Int, bottom: Int): String {
        val applied = backend.refreshRegion(left, top, right, bottom)
        return if (applied != null) {
            JSONObject().put("ok", true).put("path", applied).toString()
        } else {
            JSONObject().put("ok", false).put("error", "unsupported").toString()
        }
    }

    /**
     * 进入/退出动画（快刷）模式。退出时只撤销本应用自己开的开关。
     * 返回本次实际使用的路径与当前状态，便于界面显示与事后核对。
     */
    @JavascriptInterface
    fun setAnimationMode(on: Boolean, preferred: String): String {
        val path = backend.setAnimationMode(on, preferred)
        return JSONObject()
            .put("ok", path != null)
            .put("path", path ?: JSONObject.NULL)
            .put("state", backend.animationState())
            .toString()
    }

    @JavascriptInterface
    fun getAnimationState(): String = backend.animationState()

    /** 临时诊断用：逐个尝试还原应用级快刷，并记录每步回读 */
    @JavascriptInterface
    fun tryRevertAppScope(): String = (backend as? OnyxEinkBackend)?.tryRevertAppScope() ?: "unsupported"

    @JavascriptInterface
    fun setFastMode(on: Boolean) = host.runOnUiThread { backend.setFastMode(on) }

    @JavascriptInterface
    fun setFrontLight(level: Int) = host.runOnUiThread { backend.setFrontLight(level) }

    @JavascriptInterface
    fun keepScreenOn(on: Boolean) = host.runOnUiThread { backend.keepScreenOn(host, on) }

    @JavascriptInterface
    fun setFullscreen(on: Boolean) = host.runOnUiThread { backend.setFullscreen(host, on) }

    @JavascriptInterface
    fun setLocale(locale: String) = host.runOnUiThread { host.applyLocale(locale) }

    // ---------- 备份（SAF，异步回调） ----------
    @JavascriptInterface
    fun exportBackup(fileName: String, json: String): String {
        host.startExport(fileName, json)
        return JSONObject().put("ok", true).put("pending", true).toString()
    }

    @JavascriptInterface
    fun importBackup(): String {
        host.startImport()
        return JSONObject().put("ok", true).put("pending", true).toString()
    }

    private fun ok(): String = JSONObject().put("ok", true).toString()

    private fun failure(reason: String): String =
        JSONObject().put("ok", false).put("error", reason).toString()

    companion object {
        const val BRIDGE_VERSION = "1"

        fun capabilityJson(capability: RefreshCapability): JSONObject = JSONObject()
            .put("onyxSdkFound", capability.onyxSdkFound)
            .put("features", JSONArray(capability.features))
            .put("modes", JSONArray(capability.modes))
            .put("fullRefresh", capability.fullRefresh)
            .put("fastMode", capability.fastMode)
            .put("partialProfiles", capability.partialProfiles)
            .put("regionRefresh", capability.regionRefresh)
            .put("animationMode", capability.animationMode)
    }
}
