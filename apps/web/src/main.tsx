/**
 * Web 端入口。
 *
 * 注意：这里不用 React StrictMode —— 它会在开发模式下双次挂载 effect，
 * 导致同一份存档在一个渲染周期内提交两次，第二次会被提交栅栏判为冲突并弹出「保存失败」，
 * 属于假警报。正确性由测试覆盖，不靠 StrictMode。
 *
 * 入口还有一道「WebView 能力闸」（见下方 bootstrap）：能力不足时**不挂载应用本体**，
 * 只渲染一屏极简提示 —— 应用一挂载就要渲染整棵依赖容器查询单位（cqw/cqh）的界面，
 * 在老 WebView 上结果只会是一片白，用户连"该怎么修"都看不到。
 */
import { createRoot } from 'react-dom/client'
import { createPlatform, type Platform } from '@eink/platform'
import { coreDictEn, coreDictZh, createI18n, detectLocale } from '@eink/core'
import { App } from '@eink/ui'
import '@eink/ui/styles.css'
import { library } from './library.js'
// 直接引到文件，而不是走 @eink/platform 的出口：这是**入口专用**的一道闸，
// 不属于上层界面使用的平台门面，也就不进 platform 的公共 API。
import { detectWebViewSupport, MIN_WEBVIEW_MAJOR } from '../../../packages/platform/src/webviewSupport.js'

declare global {
  interface Window {
    /** 真机排障用：平台对象（见 bootstrap 里的说明） */
    __einkPlatform?: Platform
    /** 真机排障用：WebView 能力闸的判据（被拦下时尤其需要看到它） */
    __einkWebViewSupport?: ReturnType<typeof detectWebViewSupport>
  }
}

/*
 * 提示页的样式**全部内联**，且只用最老的引擎也认的属性：
 * 我们自己的 CSS（容器查询单位 79 处、100dvh）正是跑不动的那部分，
 * 拿它去渲染"你为什么跑不动"的说明，等于用坏掉的东西解释它为什么坏。
 */
const NOTICE_STYLE = {
  wrap: 'box-sizing:border-box;max-width:42em;margin:0 auto;padding:24px 20px;background:#fff;color:#000;font-family:system-ui,-apple-system,sans-serif;line-height:1.5;',
  title: 'margin:0 0 16px;font-size:20px;font-weight:700;',
  body: 'margin:0 0 12px;font-size:16px;',
  missing: 'margin:0 0 12px;font-size:14px;',
  hint: 'margin:0;font-size:14px;',
} as const

function noticeParagraph(style: string, text: string): HTMLParagraphElement {
  const element = document.createElement('p')
  element.setAttribute('style', style)
  element.textContent = text
  return element
}

/** 能力不足时的极简提示页：纯 DOM + 内联样式，文案全部走字典（中英各一套） */
function renderWebViewNotice(
  container: HTMLElement,
  major: number | null,
  missing: string[],
): void {
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages
  const locale = detectLocale(
    languages && languages.length > 0 ? languages : [navigator.language],
  )
  const i18n = createI18n(locale, { 'zh-CN': coreDictZh, 'en-US': coreDictEn })

  const wrap = document.createElement('div')
  wrap.setAttribute('style', NOTICE_STYLE.wrap)

  const title = document.createElement('h1')
  title.setAttribute('style', NOTICE_STYLE.title)
  title.textContent = i18n.t('shell.webview.title')
  wrap.appendChild(title)

  // 版本号读不到时不编造数字（与原生提示页同一口径）
  wrap.appendChild(
    noticeParagraph(
      NOTICE_STYLE.body,
      major === null
        ? i18n.t('shell.webview.bodyUnknown')
        : i18n.t('shell.webview.body', {
            current: String(major),
            required: String(MIN_WEBVIEW_MAJOR),
          }),
    ),
  )

  // 排障信息：缺的到底是哪一项，写清楚（真机上报问题时这一行最有用）
  const missingText =
    missing.length > 0 ? missing.join(', ') : `chrome>=${MIN_WEBVIEW_MAJOR}`
  wrap.appendChild(
    noticeParagraph(
      NOTICE_STYLE.missing,
      i18n.t('shell.webview.missing', { missing: missingText }),
    ),
  )

  wrap.appendChild(noticeParagraph(NOTICE_STYLE.hint, i18n.t('shell.webview.hint')))

  container.textContent = ''
  container.appendChild(wrap)
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('missing #root')

  /*
   * 第二道闸（第一道在原生 MainActivity）：兜住"版本号够新、能力却缺"的怪实现。
   * 判失败的口径见 packages/platform/src/webviewSupport.ts：
   * 缺能力 → 拦；版本能解析且 < 110 → 拦；版本解析不到但能力齐 → 放行（不误伤）。
   */
  const support = detectWebViewSupport()
  window.__einkWebViewSupport = support
  if (!support.ok) {
    renderWebViewNotice(container, support.major, support.missing)
    return
  }

  const platform = await createPlatform({
    // 开发模式下不注册 Service Worker（避免缓存遮挡本地改动）
    ...(import.meta.env.PROD ? { swUrl: './sw.js' } : {}),
  })

  // 真机排障用：把平台对象挂到 window，便于用 WebView DevTools 直接查看运行时状态
  // （能力缓存、刷新统计等），否则这些问题只能靠猜。
  window.__einkPlatform = platform

  createRoot(container).render(<App platform={platform} library={library} />)
}

void bootstrap()
