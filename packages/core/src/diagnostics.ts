/**
 * 设备基线描述（对应 A01）。
 *
 * 只记录网页/壳层能真实读到的设备事实；能力类结论不在这里固化成字段。
 */
import { APP_VERSION } from './version.js'

export interface DeviceBaseline {
  platform: 'web' | 'android' | 'unknown'
  manufacturer: string
  model: string
  androidSdk: number | null
  webViewVersion: string | null
  userAgent: string
  viewport: { width: number; height: number; dpr: number }
  locale: string
  /** CSS 视口与屏幕物理尺寸的关系，用于判断「不是整体缩放」 */
  screen: { width: number; height: number } | null
  touch: { maxTouchPoints: number; coarse: boolean }
  hardwareKeys: string[]
  stylusSupported: boolean
  appVersion: string
  recordedAt: number
}

export const MIN_WEBVIEW_MAJOR = 110

export function webViewMajor(version: string | null | undefined): number | null {
  if (!version) return null
  const match = /(\d+)/.exec(version)
  return match ? Number.parseInt(match[1]!, 10) : null
}

export function isWebViewSufficient(version: string | null | undefined): boolean {
  const major = webViewMajor(version)
  if (major === null) return true // 无法判定时不阻断
  return major >= MIN_WEBVIEW_MAJOR
}

/** 供诊断页复制、并粘贴进 docs/A01-device-baseline.md 的纯文本 */
export function formatBaseline(baseline: DeviceBaseline): string {
  const lines = [
    `appVersion: ${baseline.appVersion}`,
    `platform: ${baseline.platform}`,
    `manufacturer/model: ${baseline.manufacturer} ${baseline.model}`.trim(),
    `androidSdk: ${baseline.androidSdk ?? 'n/a'}`,
    `webView: ${baseline.webViewVersion ?? 'n/a'}`,
    `viewport(css): ${baseline.viewport.width}x${baseline.viewport.height} @dpr ${baseline.viewport.dpr}`,
    `screen(px): ${baseline.screen ? `${baseline.screen.width}x${baseline.screen.height}` : 'n/a'}`,
    `locale: ${baseline.locale}`,
    `touch: maxTouchPoints=${baseline.touch.maxTouchPoints} coarse=${String(baseline.touch.coarse)}`,
    `hardwareKeys: ${baseline.hardwareKeys.join(',') || 'none'}`,
    `stylus: ${String(baseline.stylusSupported)}`,
    `webViewSufficient: ${String(isWebViewSufficient(baseline.webViewVersion))}`,
    `recordedAt: ${new Date(baseline.recordedAt).toISOString()}`,
  ]
  return lines.join('\n')
}

export function createBaseline(partial: Partial<DeviceBaseline> = {}): DeviceBaseline {
  return {
    platform: 'unknown',
    manufacturer: '',
    model: '',
    androidSdk: null,
    webViewVersion: null,
    userAgent: '',
    viewport: { width: 0, height: 0, dpr: 1 },
    locale: 'zh-CN',
    screen: null,
    touch: { maxTouchPoints: 0, coarse: false },
    hardwareKeys: [],
    stylusSupported: false,
    appVersion: APP_VERSION,
    recordedAt: 0,
    ...partial,
  }
}
