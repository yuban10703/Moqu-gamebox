package com.einkgamebox

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 壳层主界面：一个全屏 WebView，加载安装包内置的网页资源。
 *
 * 关键决策：
 * - 用 [WebViewAssetLoader] 把资源映射到 https://appassets.androidplatform.net/，
 *   而不是 file://：只有 https 源下的 localStorage / IndexedDB 才是可靠且可持久的。
 * - 不申请网络权限，安装包内置全部资源，飞行模式首次启动即可游玩。
 * - 系统返回键交给网页层决定（网页层用浏览器历史实现返回），到底层才退出应用。
 * - 长按、缩放、过度滚动全部关闭：墨水屏上这些交互只会帮倒忙。
 * - **系统 WebView 过旧时根本不创建 WebView**，改为纯原生提示页（见 onCreate 里的闸）。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var store: NativeStore
    private lateinit var backend: EinkBackend
    private var pendingExportText: String? = null
    private val backupIo = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        /*
         * 原生闸（第一道，也是最关键的一道）：系统 WebView 版本低于 [MIN_WEBVIEW_MAJOR] 时
         * **绝不创建 WebView、绝不加载页面**，只显示纯原生提示页。
         *
         * 为什么必须在这里拦：网页产物按 chrome110 构建，界面重度依赖容器查询单位（cqw/cqh：styles.css 里 79 处）
         * 与 100dvh，老 WebView 加载后只会渲染出一片空白 —— 真机上用户报过「装上就是白屏」。
         * 白屏没有任何信息量，用户只会以为应用坏了；这里把它换成一句看得懂的说明 + 更新指引。
         *
         * 版本读不到（null）时**一律放行**：WebView 未选定 / 被禁用 / 厂商改写版本号时，
         * 不能凭「读不到」就判成「太旧」，否则会把本来能用的设备挡在门外。
         */
        val webViewMajor = currentWebViewMajor()
        if (webViewMajor != null && webViewMajor < MIN_WEBVIEW_MAJOR) {
            Log.w(TAG, "system webview $webViewMajor < $MIN_WEBVIEW_MAJOR: show native notice instead")
            setContentView(buildWebViewTooOldView(webViewMajor))
            return
        }

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

            /**
             * 渲染进程崩溃自愈。
             *
             * 为什么必须有：渲染进程一死，网页就变成一张**冻住的死图**，
             * 点什么都没反应 —— 用户会以为「按钮坏了」。真机上已经踩到过
             * （日志：Scheduling restart of crashed service
             * com.einkgamebox/org.chromium.content.app.SandboxedProcessService0），
             * 当时只能杀进程。这里返回 true 表示已处理，避免整个应用被一起干掉，
             * 并立刻清理设备状态、重新加载页面。
             */
            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail,
            ): Boolean {
                val didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash()
                Log.w(TAG, "renderer process gone: didCrash=$didCrash - reloading UI")
                view.postDelayed({
                    if (::webView.isInitialized && !isFinishing) {
                        webView.loadUrl("https://$ASSET_HOST/assets/web/index.html")
                    }
                }, RENDERER_RESTART_DELAY_MS)
                return true
            }

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
        webView.loadUrl("https://$ASSET_HOST/assets/web/index.html")
    }

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
        backupIo.shutdownNow()
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("EinkNative")
            webView.destroy()
        }
        super.onDestroy()
    }

    fun applyLocale(locale: String) {
        val configuration = Configuration(resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(locale))
        resources.updateConfiguration(configuration, resources.displayMetrics)
    }

    // ---------- WebView 版本闸 ----------

    /**
     * 读系统 WebView 的主版本号；**读不到返回 null**（调用方据此放行）。
     *
     * 两条路覆盖全部 API 段，不需要引入任何新依赖（不用 androidx.webkit）：
     * - API 26+：`WebView.getCurrentWebViewPackage()` 的 versionName，取**开头数字**
     *   （"156.0.8078.4" → 156）；WebView 未选定/被禁用时它返回 null；
     * - API 23~25：`WebSettings.getDefaultUserAgent()` 里正则取 `Chrome/(\d+)`。
     *
     * 整段包在 try/catch 里：读版本号失败绝不能变成启动失败（那才是真的白屏）。
     */
    private fun currentWebViewMajor(): Int? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebView.getCurrentWebViewPackage()?.versionName?.let(::leadingMajor)
        } else {
            CHROME_UA_REGEX.find(WebSettings.getDefaultUserAgent(this))?.groupValues?.get(1)?.toIntOrNull()
        }
    } catch (error: Throwable) {
        Log.w(TAG, "cannot read system webview version - letting it through", error)
        null
    }

    /**
     * 系统 WebView 过旧时的**纯原生**提示页。
     *
     * 为什么必须是纯原生：网页产物按 chrome110 构建，老引擎连脚本都可能解析不了 ——
     * 用网页去解释「你为什么白屏」，只会得到第二张白屏。这里只用 LinearLayout + TextView，
     * 全程序化构造（不加 XML 资源），也不引用任何网页 CSS。
     *
     * 中英两段同屏：原生侧读不到网页的 i18n 字典，而这类设备很可能是非中文用户手里的旧机器。
     * 版本号传 null 时不显示具体数字，只写「未能识别」（当前闸只在读到数字时才触发，这里保留该分支）。
     */
    private fun buildWebViewTooOldView(major: Int?): View {
        val density = resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density + 0.5f).toInt()

        val title = TextView(this).apply {
            text = "系统 WebView 版本过低" // i18n-exempt：原生提示页不走网页 i18n，中英同屏
            textSize = 22f
            setTextColor(Color.BLACK)
            setTypeface(typeface, Typeface.BOLD)
        }

        val body = TextView(this).apply {
            // 提示页文案是原生的、中英同屏，不走网页 i18n 字典（故字面量行标 i18n-exempt）
            text = if (major == null) {
                "未能识别当前系统 WebView 版本，本游戏需要 $MIN_WEBVIEW_MAJOR 及以上。" // i18n-exempt
            } else {
                "当前版本 $major，本游戏需要 $MIN_WEBVIEW_MAJOR 及以上。" // i18n-exempt
            }
            textSize = 18f
            setTextColor(Color.BLACK)
        }

        val howTo = TextView(this).apply {
            text = "请更新「Android System WebView」：打开应用商店搜索更新；" + // i18n-exempt
                "部分设备可在「设置 → 应用管理 → 显示系统应用 → Android System WebView」中更新。" // i18n-exempt
            textSize = 16f
            setTextColor(Color.BLACK)
        }

        val english = TextView(this).apply {
            text = "System WebView is too old. This game needs Chromium $MIN_WEBVIEW_MAJOR " +
                "or newer. Please update \"Android System WebView\" from your app store " +
                "(on some devices: Settings → Apps → Show system apps → Android System WebView)."
            textSize = 14f
            setTextColor(Color.BLACK)
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(28), dp(28), dp(28), dp(28))
        }
        listOf(title, body, howTo, english).forEach { view ->
            layout.addView(
                view,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { bottomMargin = dp(14) },
            )
        }
        return layout
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
                val uri = data.data!!
                backupIo.execute {
                    try {
                        val text = contentResolver.openInputStream(uri)?.use { BackupReader.readText(it) }
                        if (text == null) {
                            notifyJs("__EINK_IMPORT_RESULT__", resultJson(false, "read-failed"))
                        } else {
                            notifyJs("__EINK_IMPORT_RESULT__", resultJson(true, null, text))
                        }
                    } catch (error: Exception) {
                        Log.w(TAG, "import failed", error)
                        val reason = if (error.message == "backup-too-large") "backup-too-large" else "read-failed"
                        notifyJs("__EINK_IMPORT_RESULT__", resultJson(false, reason))
                    }
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
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                webView.evaluateJavascript("window.$callbackName && window.$callbackName($quoted)", null)
            }
        }
    }

    companion object {
        private const val TAG = "MainActivity"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val REQUEST_EXPORT = 1001
        private const val REQUEST_IMPORT = 1002
        /** 渲染进程崩溃后重新加载页面的延迟 */
        private const val RENDERER_RESTART_DELAY_MS = 600L

        /**
         * 最低可用的系统 WebView 主版本号。
         *
         * 与 `apps/web/vite.config.ts` 的 `target: ['chrome110', ...]` 同步：
         * 界面里有 79 处容器查询单位（cqw/cqh，Chromium 105 起；连 TSX 内联共 83 处）、整屏的 `100dvh`（108 起），
         * 低于 110 的设备加载后只会白屏 —— 所以这个数字不能比构建目标更宽松。
         * 同一阈值还出现在 packages/platform/src/webviewSupport.ts 与 DiagnosticsScreen.tsx，四处一起改。
         */
        private const val MIN_WEBVIEW_MAJOR = 110
        /** 版本号**开头**的数字，例如 "156.0.8078.4" → "156" */
        private val LEADING_DIGITS_REGEX = Regex("^\\s*(\\d+)")
        /** 老 WebView 的 UA 里的内核版本，例如 "Chrome/51.0.2704.106" → "51" */
        private val CHROME_UA_REGEX = Regex("Chrome/(\\d+)")

        /** 取版本号开头的数字；不是数字开头返回 null（读不到就不判、不拦） */
        private fun leadingMajor(versionName: String): Int? =
            LEADING_DIGITS_REGEX.find(versionName)?.groupValues?.get(1)?.toIntOrNull()
    }
}
