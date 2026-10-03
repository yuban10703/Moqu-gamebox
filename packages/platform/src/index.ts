/**
 * @eink/platform —— 平台适配层：存储、离线、设备基线。
 * 上层（UI 与壳）只依赖这里的门面，不直接接触 IndexedDB / 桥 / Service Worker。
 */
import type { DeviceBaseline, KvBackend } from '@eink/core'
import { createAppStorage, type AppStorage } from './appStorage.js'
import {
  androidExportBackup,
  androidImportBackup,
  isAndroidBridgeAvailable,
  onHardwareKey,
  type EinkNativeBridge,
  type HardwareKeyEvent,
} from './androidBridge.js'
import {
  createBundledOffline,
  createServiceWorkerOffline,
  type OfflineController,
} from './offline.js'
import { collectBaseline } from './baseline.js'

export * from './indexeddb.js'
export * from './androidBridge.js'
export * from './appStorage.js'
export * from './offline.js'
export * from './baseline.js'

export interface Platform {
  kind: 'android' | 'web'
  storage: AppStorage
  offline: OfflineController
  baseline(): DeviceBaseline
  onHardwareKey(handler: (event: HardwareKeyEvent) => void): () => void
  exportBackup(fileName: string, text: string): Promise<{ ok: boolean; error?: string }>
  /** Android：走 SAF 选文件；Web：返回 null，由界面用 <input type=file> 处理 */
  importBackup(): Promise<string | null>
  dispose(): void
}

export interface PlatformOptions {
  /** Web 端 Service Worker 地址（Android 端不需要，资源内置） */
  swUrl?: string
  now?: () => number
  /** 测试注入 */
  kv?: KvBackend
  bridge?: EinkNativeBridge | null
}

function downloadText(fileName: string, text: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function createPlatform(options: PlatformOptions = {}): Promise<Platform> {
  const bridge =
    options.bridge ?? (isAndroidBridgeAvailable() ? window.EinkNative! : null)
  const kind: 'android' | 'web' = bridge ? 'android' : 'web'
  const offline =
    kind === 'android'
      ? createBundledOffline()
      : options.swUrl
        ? createServiceWorkerOffline({ swUrl: options.swUrl })
        : createBundledOffline()

  const storage = await createAppStorage({
    bridge,
    ...(options.now ? { now: options.now } : {}),
    ...(options.kv ? { kv: options.kv } : {}),
  })

  return {
    kind,
    storage,
    offline,
    baseline: () => collectBaseline({ bridge, ...(options.now ? { now: options.now } : {}) }),
    onHardwareKey,
    async exportBackup(fileName, text) {
      if (bridge) {
        const result = await androidExportBackup(bridge, fileName, text)
        return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'export-failed' }
      }
      downloadText(fileName, text)
      return { ok: true }
    },
    async importBackup() {
      if (bridge) return androidImportBackup(bridge)
      return null
    },
    dispose() {
      offline.dispose()
    },
  }
}
