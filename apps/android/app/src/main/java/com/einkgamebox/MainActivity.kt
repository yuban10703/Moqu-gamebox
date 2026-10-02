package com.einkgamebox

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.util.Locale

/**
 * 壳层主界面：一个全屏 WebView，加载安装包内置的网页资源。
 *
 * 关键决策：
 * - 用 [WebViewAssetLoader] 把资源映射到 https://appassets.androidplatform.net/，
 *   而不是 file://：只有 https 源下的 localStorage / IndexedDB 才是可靠且可持久的。
 * - 不申请网络权限，安装包内置全部资源，飞行模式首次启动即可游玩。
 * - 系统返回键交给网页层决定（网页层用浏览器历史实现返回），到底层才退出应用。
 * - 长按、缩放、过度滚动全部关闭：墨水屏上这些交互只会帮倒忙。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var store: NativeStore
    private lateinit var backend: EinkBackend
    private var pendingExportText: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        store = NativeStore(this)
        backend = EinkBackendFactory.create(this)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.WHITE)
            isLongClickable = false
            setOnLongClickListener { true }
            overScrollMode = View.OVER_SCROLL_NEVER
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                mediaPlaybackRequiresUserGesture = true
                cacheMode = WebSettings.LOAD_DEFAULT
                // 应用自己提供字号档位（标准/大/特大），因此固定 textZoom 避免与系统字体缩放叠加
                textZoom = 100
                useWideViewPort = true
                loadWithOverviewMode = false
            }
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == ASSET_HOST) return false
                // 外链一律交给系统浏览器，壳内不加载任何外部内容
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (error: Throwable) {
                    Log.w(TAG, "cannot open external url", error)
                    true
                }
            }
        }

        webView.addJavascriptInterface(JsBridge(this, store, backend), "EinkNative")
        setContentView(webView)
        // 局部刷新模式是按视图设置的：必须先绑定承载网页的视图，否则调用会静默无效
        backend.bindView(webView) { webView.post { notifyCapabilityChanged() } }
        webView.loadUrl("https://$ASSET_HOST/assets/web/index.html")

        // 兜底：万一验证回调没跑到（例如后端是通用实现），也再通知一次
        webView.postDelayed({ notifyCapabilityChanged() }, CAPABILITY_NOTIFY_DELAY_MS)
    }

    fun gameView(): View = webView

    /** 让网页层决定返回行为；到底层（首页）时才真正退出应用 */
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (!::webView.isInitialized) {
            super.onBackPressed()
            return
        }
        webView.evaluateJavascript("(window.__einkHandleBack && window.__einkHandleBack()) === true") { result ->
            if (result != "true") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        // 退出前恢复临时快刷模式，避免把设备留在非正常刷新状态
        backend.release()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("EinkNative")
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun notifyCapabilityChanged() {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript(
            "window.__einkCapabilityChanged && window.__einkCapabilityChanged()",
            null,
        )
    }

    fun applyLocale(locale: String) {
        val configuration = Configuration(resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(locale))
        resources.updateConfiguration(configuration, resources.displayMetrics)
    }

    // ---------- 备份导出 / 导入（SAF） ----------

    fun startExport(fileName: String, json: String) {
        pendingExportText = json
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, fileName)
        }
        runOnUiThread {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST_EXPORT)
        }
    }

    fun startImport() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        runOnUiThread {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST_IMPORT)
        }
    }

    @Deprecated("Uses the classic SAF callback to avoid an extra dependency for a single file picker")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_EXPORT -> {
                if (resultCode != RESULT_OK || data?.data == null) {
                    pendingExportText = null
                    notifyJs("__EINK_EXPORT_RESULT__", resultJson(false, "cancelled"))
                    return
                }
                val text = pendingExportText
                pendingExportText = null
                if (text == null) {
                    notifyJs("__EINK_EXPORT_RESULT__", resultJson(false, "nothing-to-export"))
                    return
                }
                val uri: Uri = data.data!!
                try {
                    contentResolver.openOutputStream(uri)?.use { stream ->
                        stream.write(text.toByteArray(Charsets.UTF_8))
                    }
                    notifyJs("__EINK_EXPORT_RESULT__", resultJson(true, null))
                } catch (error: Throwable) {
                    Log.w(TAG, "export failed", error)
                    notifyJs("__EINK_EXPORT_RESULT__", resultJson(false, "write-failed"))
                }
            }

            REQUEST_IMPORT -> {
                if (resultCode != RESULT_OK || data?.data == null) {
                    notifyJs("__EINK_IMPORT_RESULT__", resultJson(false, "cancelled"))
                    return
                }
                try {
                    val text = contentResolver.openInputStream(data.data!!)?.use { stream ->
                        stream.bufferedReader(Charsets.UTF_8).readText()
                    }
                    if (text == null) {
                        notifyJs("__EINK_IMPORT_RESULT__", resultJson(false, "read-failed"))
                    } else {
                        notifyJs("__EINK_IMPORT_RESULT__", resultJson(true, null, text))
                    }
                } catch (error: Throwable) {
                    Log.w(TAG, "import failed", error)
                    notifyJs("__EINK_IMPORT_RESULT__", resultJson(false, "read-failed"))
                }
            }
        }
    }

    private fun resultJson(ok: Boolean, error: String?, data: String? = null): String {
        val json = JSONObject().put("ok", ok)
        if (error != null) json.put("error", error)
        if (data != null) json.put("data", data)
        return json.toString()
    }

    /** 把 JSON 作为 JS 字符串字面量安全地回传给网页层 */
    private fun notifyJs(callbackName: String, payloadJson: String) {
        val quoted = JSONObject.quote(payloadJson)
        webView.evaluateJavascript("window.$callbackName && window.$callbackName($quoted)", null)
    }

    companion object {
        private const val TAG = "MainActivity"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val REQUEST_EXPORT = 1001
        private const val REQUEST_IMPORT = 1002
        /** 给能力验证留出时间（验证要驱动一次真实全刷，耗时以百毫秒计） */
        private const val CAPABILITY_NOTIFY_DELAY_MS = 1200L
    }
}
