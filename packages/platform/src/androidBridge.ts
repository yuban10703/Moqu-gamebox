/**
 * Android（BOOX）原生桥的 JS 侧契约。
 *
 * 设计要点：
 * - 桥只对**内置可信内容**开放（`EinkNative` 由壳层注入，且壳层只加载本地资源、外链一律走系统浏览器）；
 * - 所有存储操作走原生 SQLite 事务：`commitCas` / `setMany` 由原生保证原子性，
 *   提交协议本身仍然复用 @eink/core（同一套逻辑在两端都被测试覆盖）；
 * - 设备能力一律「探测后回报」，不在 JS 侧硬编码型号与模式名。
 */
import type { DeviceBaseline, KvBackend, RefreshCapability, RefreshProfile } from '@eink/core'

export interface BridgeResult {
  ok: boolean
  error?: string
  current?: string | null
}

export interface EinkNativeBridge {
  readonly version: string
  /** 返回 JSON 字符串（DeviceBaseline） */
  deviceBaseline(): string
  getRefreshCapability(): string

  saveGet(key: string): string | null
  savePut(key: string, value: string): string
  saveDelete(key: string): string
  saveDeletePrefix(prefix: string): string
  /** 返回 JSON 数组 */
  saveKeys(prefix: string): string
  /** 返回 JSON：{ok:true} 或 {ok:false,current} */
  saveCas(key: string, expected: string | null, value: string): string
  /** 入参为 JSON 数组 [[key,value],...]，单事务原子写入 */
  savePutMany(entriesJson: string): string

  setRefreshProfile(profile: RefreshProfile): void
  fullRefresh(): void
  /** 成对调用；壳层在页面切换/退出时也会强制恢复 */
  setFastMode(on: boolean): void
  setFrontLight(level: number): void
  keepScreenOn(on: boolean): void
  setFullscreen(on: boolean): void
  setLocale(locale: string): void

  exportBackup(fileName: string, json: string): string
  /** 立即返回 {ok:true,pending:true}；真正的文件内容由 __EINK_IMPORT_RESULT__ 回调送达 */
  importBackup(): string
}

declare global {
  interface Window {
    EinkNative?: EinkNativeBridge
    /** 壳层读取文件后回调（SAF 是异步的，不能用返回值同步等待） */
    __EINK_IMPORT_RESULT__?: (payload: string) => void
    /** 壳层写完文件后回调 */
    __EINK_EXPORT_RESULT__?: (payload: string) => void
    /** 网页层决定系统返回键的行为：返回 true 表示已处理 */
    __einkHandleBack?: () => boolean
  }
}

export function isAndroidBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.EinkNative === 'object' && window.EinkNative !== null
}

function parseResult(raw: string): BridgeResult {
  try {
    const value = JSON.parse(raw) as BridgeResult
    return { ok: value.ok === true, ...(value.error ? { error: value.error } : {}), current: value.current ?? null }
  } catch {
    return { ok: false, error: 'bad-bridge-response' }
  }
}

export function createAndroidKv(bridge: EinkNativeBridge): KvBackend {
  return {
    async get(key) {
      const value = bridge.saveGet(key)
      return value === null || value === undefined ? null : value
    },
    async del(key) {
      const result = parseResult(bridge.saveDelete(key))
      if (!result.ok) throw new Error(result.error ?? 'bridge delete failed')
    },
    async keys(prefix) {
      try {
        const parsed = JSON.parse(bridge.saveKeys(prefix)) as unknown
        return Array.isArray(parsed) ? parsed.map((item) => String(item)).sort() : []
      } catch {
        return []
      }
    },
    async commitCas(key, expectedValue, newValue) {
      const result = parseResult(bridge.saveCas(key, expectedValue, newValue))
      if (result.ok) return { ok: true }
      return { ok: false, current: result.current ?? null }
    },
    async setMany(entries) {
      if (entries.length === 0) return
      const result = parseResult(bridge.savePutMany(JSON.stringify(entries)))
      if (!result.ok) throw new Error(result.error ?? 'bridge setMany failed')
    },
  }
}

export function readAndroidBaseline(bridge: EinkNativeBridge): DeviceBaseline | null {
  try {
    return JSON.parse(bridge.deviceBaseline()) as DeviceBaseline
  } catch {
    return null
  }
}

export function readAndroidRefreshCapability(bridge: EinkNativeBridge): RefreshCapability | null {
  try {
    const parsed = JSON.parse(bridge.getRefreshCapability()) as RefreshCapability
    if (typeof parsed?.onyxSdkFound !== 'boolean') return null
    return {
      onyxSdkFound: parsed.onyxSdkFound,
      features: Array.isArray(parsed.features) ? parsed.features : [],
      modes: Array.isArray(parsed.modes) ? parsed.modes : [],
      fullRefresh: parsed.fullRefresh === true,
      fastMode: parsed.fastMode === true,
      // 缺省视为「未验证」：宁可少显示一个开关，也不要显示一个点了没用的
      partialProfiles: parsed.partialProfiles === true,
    }
  } catch {
    return null
  }
}

/**
 * 导出备份：Android 走 SAF（WebView 内的下载不可靠）。
 *
 * 为什么不在桥调用里同步等待用户选文件：@JavascriptInterface 的调用会占用 WebView 的
 * JavaBridge 线程，如果那里阻塞等待文件对话框，后续所有桥调用（包括自动保存）都会排队卡住。
 * 因此桥立即返回「已发起」，真正的结果由壳层回调 __EINK_EXPORT_RESULT__ 送达。
 */
export function androidExportBackup(
  bridge: EinkNativeBridge,
  fileName: string,
  text: string,
  timeoutMs = 600_000,
): Promise<BridgeResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: BridgeResult): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      delete window.__EINK_EXPORT_RESULT__
      resolve(result)
    }
    const timer = window.setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    window.__EINK_EXPORT_RESULT__ = (payload) => finish(parseResult(payload))
    try {
      const ack = parseResult(bridge.exportBackup(fileName, text))
      if (!ack.ok) finish(ack)
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : 'export-failed' })
    }
  })
}

/** 导入备份：同样由壳层回调送内容进来 */
export function androidImportBackup(
  bridge: EinkNativeBridge,
  timeoutMs = 600_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (payload: string | null): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      delete window.__EINK_IMPORT_RESULT__
      resolve(payload)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    window.__EINK_IMPORT_RESULT__ = (payload) => {
      const parsed = parseResult(payload)
      if (!parsed.ok) {
        finish(null)
        return
      }
      const raw: string = payload
      try {
        const value = JSON.parse(raw) as { data?: string }
        finish(value.data ?? null)
      } catch {
        finish(null)
      }
    }
    try {
      const ack = parseResult(bridge.importBackup())
      if (!ack.ok) finish(null)
    } catch {
      finish(null)
    }
  })
}

/** 硬件按键（翻页键）→ 事件；壳层也会转发系统返回键语义 */
export interface HardwareKeyEvent {
  type: 'pageTurn' | 'back' | 'menu'
  dir?: -1 | 1
}

export function onHardwareKey(handler: (event: HardwareKeyEvent) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const listener = (raw: Event): void => {
    const detail = (raw as CustomEvent<HardwareKeyEvent>).detail
    if (detail && typeof detail.type === 'string') handler(detail)
  }
  window.addEventListener('eink:hardware', listener)
  return () => window.removeEventListener('eink:hardware', listener)
}
