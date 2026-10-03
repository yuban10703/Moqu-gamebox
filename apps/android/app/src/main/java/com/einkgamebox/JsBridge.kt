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
    @JavascriptInterface
    fun version(): String = BRIDGE_VERSION

    @JavascriptInterface
    fun deviceBaseline(): String = DeviceBaseline.collect(host).toString()

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

    // ---------- 设备能力（与刷新无关） ----------
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
    }
}
