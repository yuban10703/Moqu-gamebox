/**
 * 离线状态与刷新控制。
 *
 * 两个都必须诚实：
 * - 离线：只有确认资源已经进缓存（或资源本来就内置在安装包里）才显示「已可离线」；
 *   首次访问时 Service Worker 还没接管页面，这段时间显示「正在准备离线资源」。
 * - 刷新：**网页无法直接控制墨水屏刷新**。浏览器里不假装能做（能力清单全为 false），
 *   只给出系统设置指引；只有原生桥探测到 BOOX 接口时才开放对应能力。
 */
import type { RefreshCapability, RefreshProfile } from '@eink/core'

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

export interface RefreshStats {
  fullRefreshes: number
  profileChanges: number
}

export interface RefreshController {
  capability(): RefreshCapability
  setProfile(profile: RefreshProfile): void
  /** 整屏全刷：清除残影 */
  fullRefresh(): void
  /** 临时快刷模式，必须成对进入/退出 */
  setFastMode(on: boolean): void
  stats(): RefreshStats
  dispose(): void
}

export function createWebRefresh(): RefreshController {
  const stats: RefreshStats = { fullRefreshes: 0, profileChanges: 0 }
  const capability: RefreshCapability = {
    onyxSdkFound: false,
    features: [],
    modes: [],
    fullRefresh: false,
    fastMode: false,
  }
  return {
    capability: () => capability,
    setProfile: () => {
      stats.profileChanges++
    },
    fullRefresh: () => {
      stats.fullRefreshes++
    },
    setFastMode: () => undefined,
    stats: () => ({ ...stats }),
    dispose: () => undefined,
  }
}

export function createAndroidRefresh(bridge: {
  setRefreshProfile(profile: RefreshProfile): void
  fullRefresh(): void
  setFastMode(on: boolean): void
  getRefreshCapability(): string
}): RefreshController {
  const stats: RefreshStats = { fullRefreshes: 0, profileChanges: 0 }
  let capability: RefreshCapability = {
    onyxSdkFound: false,
    features: [],
    modes: [],
    fullRefresh: false,
    fastMode: false,
  }
  try {
    const parsed = JSON.parse(bridge.getRefreshCapability()) as RefreshCapability
    capability = {
      onyxSdkFound: parsed?.onyxSdkFound === true,
      features: Array.isArray(parsed?.features) ? parsed.features : [],
      modes: Array.isArray(parsed?.modes) ? parsed.modes : [],
      fullRefresh: parsed?.fullRefresh === true,
      fastMode: parsed?.fastMode === true,
    }
  } catch {
    // 探测失败就按「不支持」处理，界面给出系统指引
  }
  let fastModeOn = false
  return {
    capability: () => capability,
    setProfile: (profile) => {
      stats.profileChanges++
      try {
        bridge.setRefreshProfile(profile)
      } catch {
        // 桥调用失败不应影响游玩
      }
    },
    fullRefresh: () => {
      stats.fullRefreshes++
      try {
        bridge.fullRefresh()
      } catch {
        // 同上
      }
    },
    setFastMode: (on) => {
      if (on === fastModeOn) return
      fastModeOn = on
      try {
        bridge.setFastMode(on)
      } catch {
        // 同上
      }
    },
    stats: () => ({ ...stats }),
    dispose: () => {
      // 退出/切页时必须恢复，避免把设备留在快刷模式
      if (fastModeOn) {
        fastModeOn = false
        try {
          bridge.setFastMode(false)
        } catch {
          // 忽略
        }
      }
    },
  }
}

/**
 * 兜底守卫：页面隐藏、退出或返回时强制退出快刷模式。
 * 「需要时恢复应用临时改变的模式」——不能把设备留在临时状态里。
 */
export function installFastModeGuard(controller: RefreshController): () => void {
  if (typeof window === 'undefined') return () => undefined
  const release = (): void => controller.setFastMode(false)
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') release()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', release)
  window.addEventListener('blur', release)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', release)
    window.removeEventListener('blur', release)
  }
}
