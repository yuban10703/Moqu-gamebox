/**
 * Web 端入口。
 *
 * 注意：这里不用 React StrictMode —— 它会在开发模式下双次挂载 effect，
 * 导致同一份存档在一个渲染周期内提交两次，第二次会被提交栅栏判为冲突并弹出「保存失败」，
 * 属于假警报。正确性由测试覆盖，不靠 StrictMode。
 */
import { createRoot } from 'react-dom/client'
import { createPlatform, type Platform } from '@eink/platform'
import { App } from '@eink/ui'
import '@eink/ui/styles.css'
import { library } from './library.js'

declare global {
  interface Window {
    /** 真机排障用：平台对象（见 bootstrap 里的说明） */
    __einkPlatform?: Platform
  }
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('missing #root')

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
