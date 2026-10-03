/**
 * 离线状态。
 *
 * 必须诚实：只有确认资源已经进缓存（或资源本来就内置在安装包里）才显示「已可离线」；
 * 首次访问时 Service Worker 还没接管页面，这段时间显示「正在准备离线资源」。
 */

export type OfflineState = 'unavailable' | 'preparing' | 'ready'

export interface OfflineController {
  state(): OfflineState
  subscribe(listener: (state: OfflineState) => void): () => void
  ensure(): Promise<OfflineState>
  dispose(): void
}

/** 安装包内置资源：从启动那一刻就是离线可用 */
export function createBundledOffline(): OfflineController {
  let state: OfflineState = 'ready'
  const listeners = new Set<(state: OfflineState) => void>()
  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async ensure() {
      return state
    },
    dispose() {
      listeners.clear()
      state = 'ready'
    },
  }
}

interface PrecacheMessage {
  type: 'eink:precache'
  cache: string
  files: number
}

function isPrecacheMessage(value: unknown): value is PrecacheMessage {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PrecacheMessage).type === 'eink:precache' &&
    typeof (value as PrecacheMessage).cache === 'string'
  )
}

export interface ServiceWorkerOfflineOptions {
  swUrl: string
  scope?: string
}

export function createServiceWorkerOffline(options: ServiceWorkerOfflineOptions): OfflineController {
  const supported =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined'
  let state: OfflineState = supported ? 'preparing' : 'unavailable'
  const listeners = new Set<(state: OfflineState) => void>()
  let disposed = false

  const setState = (next: OfflineState): void => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
  }

  const onMessage = (event: MessageEvent): void => {
    if (isPrecacheMessage(event.data)) setState('ready')
  }

  if (supported) {
    navigator.serviceWorker.addEventListener('message', onMessage)
    // 已经接管过页面的 SW 会直接回答当前缓存状态
    navigator.serviceWorker.controller?.postMessage({ type: 'eink:query' })
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async ensure() {
      if (!supported || disposed) return state
      try {
        await navigator.serviceWorker.register(options.swUrl, {
          ...(options.scope ? { scope: options.scope } : {}),
        })
        const registration = await navigator.serviceWorker.ready
        registration.active?.postMessage({ type: 'eink:query' })
        // 已经控制页面时，再问一次，避免错过安装期间广播的消息
        navigator.serviceWorker.controller?.postMessage({ type: 'eink:query' })
      } catch {
        setState('unavailable')
      }
      return state
    },
    dispose() {
      disposed = true
      if (supported) navigator.serviceWorker.removeEventListener('message', onMessage)
      listeners.clear()
    },
  }
}
