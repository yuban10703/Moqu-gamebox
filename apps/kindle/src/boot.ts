/**
 * Kindle 版入口。
 *
 * 执行顺序（每一级都能独立失败）：
 *   ① polyfills.js  → 补 Promise / Set / Map / Symbol / Array 方法 / classList
 *   ② amd-shim.js   → 极简 AMD 加载器（tsc --module AMD 的产物靠它执行）
 *   ③ kindle.js     → 本文件所在的整包（core + 20 款玩法 + 这套壳层）
 *   ④ 这里           → 能力闸 → i18n → 挂载
 *
 * 为什么用「静态脚本 + AMD」而不是 ES 模块：Kindle 自带浏览器不认识 `type="module"`，
 * 模块脚本会被整段忽略（页面直接白屏）。这一点在 docs/A01-device-baseline.md 里有记录。
 */
import { coreDictEn, coreDictZh, createI18n, detectLocale } from '@eink/core'
import { library } from '@eink/library'
import { el, clear } from './dom.js'
import { startApp, pickLocale } from './app.js'
import { loadSettings } from './store.js'

/** 运行时错误也要可见：老引擎上用户没有控制台可看 */
function showFatal(title: string, detail: string): void {
  const body = document.body
  if (!body) return
  clear(body)
  const wrap = el('div', { style: 'max-width:32em;margin:0 auto;padding:28px 18px;font-size:16px;line-height:1.6;' })
  wrap.appendChild(el('h1', { style: 'font-size:20px;font-weight:700;margin:0 0 14px;' }, title))
  wrap.appendChild(el('p', { style: 'margin:0 0 12px;font-size:14px;' }, detail))
  wrap.appendChild(
    el('p', { style: 'margin:0;font-size:14px;' },
      '请把这一屏拍下来反馈；也可以换一台设备访问 moqu.2333.world。',
    ),
  )
  body.appendChild(wrap)
}

function boot(): void {
  // ---------- 能力闸 ----------
  // 只拦「缺了就一定白屏」的几项；其余（box-shadow / SVG / 渐变）都能降级，不拦。
  const missing: string[] = []
  if (!document.querySelector) missing.push('querySelector')
  if (!window.addEventListener) missing.push('addEventListener')
  if (!document.createElementNS) missing.push('createElementNS')
  if (typeof JSON === 'undefined' || !JSON.parse) missing.push('JSON')
  if (missing.length > 0) {
    showFatal('这台设备缺少必要能力', '缺少：' + missing.join(', '))
    return
  }

  // 语言：设置里选过就以设置为准，否则跟系统
  let settings
  try {
    settings = loadSettings()
  } catch (e) {
    settings = null
  }
  const locale = pickLocale(settings ? settings.locale : null)
  const dicts = library.dicts && library.dicts['zh-CN'] ? library.dicts : { 'zh-CN': coreDictZh, 'en-US': coreDictEn }
  const i18n = createI18n(locale, dicts)

  const root = document.getElementById('k-root')
  if (!root) {
    showFatal('页面结构缺失', '没有找到 #k-root')
    return
  }

  try {
    startApp(root, library)
  } catch (e) {
    showFatal(i18n.t('shell.webview.title'), String(e))
  }
}

// 两种触发时机都兜住：DOM 已就绪就直接跑，否则等 DOMContentLoaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  boot()
} else {
  document.addEventListener('DOMContentLoaded', boot, false)
}
