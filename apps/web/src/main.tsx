/**
 * Web 端入口。
 *
 * 注意：这里不用 React StrictMode —— 它会在开发模式下双次挂载 effect，
 * 导致同一份存档在一个渲染周期内提交两次，第二次会被提交栅栏判为冲突并弹出「保存失败」，
 * 属于假警报。正确性由测试覆盖，不靠 StrictMode。
 */
import { createRoot } from 'react-dom/client'
import { createPlatform } from '@eink/platform'
import { App } from '@eink/ui'
import '@eink/ui/styles.css'
import { library } from './library.js'

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('missing #root')

  const platform = await createPlatform({
    // 开发模式下不注册 Service Worker（避免缓存遮挡本地改动）
    ...(import.meta.env.PROD ? { swUrl: './sw.js' } : {}),
  })

  createRoot(container).render(<App platform={platform} library={library} />)
}

void bootstrap()
