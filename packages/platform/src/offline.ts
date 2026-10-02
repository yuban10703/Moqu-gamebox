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
  /** 强制重新向原生读取能力清单（用于「验证完成」通知之后） */
  refreshCapability(): RefreshCapability
  setProfile(profile: RefreshProfile): void
  /** 整屏全刷：清除残影 */
  fullRefresh(): void
  /** 临时快刷模式，必须成对进入/退出 */
  setFastMode(on: boolean): void
  /**
   * 只刷新指定矩形（**视图像素**坐标，即 CSS 坐标 × DPR）。
   * 返回实际生效的实现名；不可用返回 null。
   */
  refreshRegion(rect: { left: number; top: number; right: number; bottom: number }): string | null
  /**
   * 进入/退出动画（快刷）模式。返回本次实际使用的路径与状态；
   * 退出时只撤销本应用自己开的开关。
   */
  setAnimationMode(
    on: boolean,
    preferred?: 'auto' | 'animation',
  ): { ok: boolean; path: string | null; state: string }
  /** 当前动画/快刷状态摘要 */
  animationState(): string
  /**
   * 原生刷新泵：把高频整屏全刷放到原生侧做。
   * 网页里每帧同步调桥会占满主线程（触摸收不到、渲染进程还可能被杀），因此搬到原生侧。
   */
  startRefreshPump(intervalMs: number, maxDurationMs: number): boolean
  stopRefreshPump(): string
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
    partialProfiles: false,
    regionRefresh: false,
    animationMode: false,
  }
  return {
    capability: () => capability,
    refreshCapability: () => capability,
    setProfile: () => {
      stats.profileChanges++
    },
    fullRefresh: () => {
      stats.fullRefreshes++
    },
    setFastMode: () => undefined,
    refreshRegion: () => null,
    setAnimationMode: () => ({ ok: false, path: null, state: 'unsupported' }),
    animationState: () => 'unsupported',
    startRefreshPump: () => false,
    stopRefreshPump: () => 'unsupported',
    stats: () => ({ ...stats }),
    dispose: () => undefined,
  }
}

export function createAndroidRefresh(bridge: {
  setRefreshProfile(profile: RefreshProfile): void
  fullRefresh(): void
  setFastMode(on: boolean): void
  getRefreshCapability(): string
  refreshRegion?(left: number, top: number, right: number, bottom: number): string
  setAnimationMode?(on: boolean, preferred: string): string
  getAnimationState?(): string
  startRefreshPump?(intervalMs: number, maxDurationMs: number): string
  stopRefreshPump?(): string
}): RefreshController {
  const stats: RefreshStats = { fullRefreshes: 0, profileChanges: 0 }

  const readCapability = (): RefreshCapability => {
    try {
      const parsed = JSON.parse(bridge.getRefreshCapability()) as RefreshCapability
      return {
        onyxSdkFound: parsed?.onyxSdkFound === true,
        features: Array.isArray(parsed?.features) ? parsed.features : [],
        modes: Array.isArray(parsed?.modes) ? parsed.modes : [],
        fullRefresh: parsed?.fullRefresh === true,
        fastMode: parsed?.fastMode === true,
        partialProfiles: parsed?.partialProfiles === true,
        regionRefresh: parsed?.regionRefresh === true,
        animationMode: parsed?.animationMode === true,
      }
    } catch {
      // 探测失败就按「不支持」处理，界面给出系统指引
      return {
        onyxSdkFound: false,
        features: [],
        modes: [],
        fullRefresh: false,
        fastMode: false,
        partialProfiles: false,
        regionRefresh: false,
        animationMode: false,
      }
    }
  }

  // 缓存能力清单：这些能力要真机调用过才知道结论（全刷能不能用、档位是否生效、区域刷新是否可用），
  // 而原生侧的验证是启动后异步完成的。若一开始就固化成「未验证」，界面会一直少一个本来可用的功能。
  // 因此：只要还有能力项处于「未验证」状态，就按需重读，但**上限 8 次**——避免在真正不支持的设备上每次渲染都过一次同步桥。
  let capability = readCapability()
  let fastModeOn = false
  return {
    capability: () => capability,
    refreshCapability: () => {
      capability = readCapability()
      return capability
    },
    setProfile: (profile) => {
      stats.profileChanges++
      try {
        bridge.setRefreshProfile(profile)
      } catch {
        // 桥调用失败不应影响游玩
      }
      capability = readCapability()
    },
    fullRefresh: () => {
      stats.fullRefreshes++
      try {
        bridge.fullRefresh()
      } catch {
        // 同上
      }
      capability = readCapability()
    },
    refreshRegion: (rect) => {
      if (typeof bridge.refreshRegion !== 'function') return null
      try {
        // 必须**在桥对象上直接调用**：把 Java 桥的方法取出来再调用会脱离接收者，
        // 调用会静默失效（实测返回 undefined，且原生侧完全收不到请求）。
        const parsed = JSON.parse(
          bridge.refreshRegion(rect.left, rect.top, rect.right, rect.bottom),
        ) as { ok?: boolean; path?: string }
        capability = readCapability()
        return parsed.ok === true ? (parsed.path ?? 'unknown') : null
      } catch {
        return null
      }
    },
    setAnimationMode: (on, preferred = 'auto') => {
      if (typeof bridge.setAnimationMode !== 'function') {
        return { ok: false, path: null, state: 'unsupported' }
      }
      try {
        // 与 refreshRegion 同理：必须在桥对象上直接调用，取出方法再调会静默失效
        const parsed = JSON.parse(bridge.setAnimationMode(on, preferred)) as {
          ok?: boolean
          path?: string | null
          state?: string
        }
        capability = readCapability()
        return {
          ok: parsed.ok === true,
          path: typeof parsed.path === 'string' ? parsed.path : null,
          state: parsed.state ?? '—',
        }
      } catch {
        return { ok: false, path: null, state: 'error' }
      }
    },
    animationState: () => {
      if (typeof bridge.getAnimationState !== 'function') return 'unsupported'
      try {
        return bridge.getAnimationState()
      } catch {
        return 'error'
      }
    },
    startRefreshPump: (intervalMs, maxDurationMs) => {
      if (typeof bridge.startRefreshPump !== 'function') return false
      try {
        const parsed = JSON.parse(bridge.startRefreshPump(intervalMs, maxDurationMs)) as {
          ok?: boolean
        }
        return parsed.ok === true
      } catch {
        return false
      }
    },
    stopRefreshPump: () => {
      if (typeof bridge.stopRefreshPump !== 'function') return 'unsupported'
      try {
        const parsed = JSON.parse(bridge.stopRefreshPump()) as { stats?: string }
        return parsed.stats ?? '—'
      } catch {
        return 'error'
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
