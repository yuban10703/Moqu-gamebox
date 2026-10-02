/**
 * 设备基线与刷新能力描述（对应 A01 / E02）。
 *
 * 设计原则：**不硬编码型号对应的刷新模式名**。Android 侧通过反射探测真实存在的
 * 类与方法，把「探测结论」交给这里，界面只据结论显示可用选项或系统指引。
 */
import { APP_VERSION } from './version.js'

export type RefreshProfile = 'quality' | 'balanced' | 'speed'

export interface RefreshCapability {
  /** 是否探测到 BOOX 屏幕接口（Onyx SDK 的 EpdController 等） */
  onyxSdkFound: boolean
  /** 探测到的可用能力名（不含型号相关模式名） */
  features: string[]
  /** 运行时探测到的模式名列表（可能为空） */
  modes: string[]
  /** 整屏全刷是否可用 */
  fullRefresh: boolean
  /** 临时快刷模式是否可用（必须成对进出） */
  fastMode: boolean
  /**
   * 刷新档位（局部模式）是否**验证过**确实生效。
   * 只在真机上回读确认过才算 true —— 「方法存在」不等于「设置生效」。
   */
  partialProfiles: boolean
  /**
   * 区域刷新是否可用：能指定「只刷这个矩形」。
   * 注意这只表示**调用可用**；面板是否真的只动那一块，无法用截图或驱动计数证明，
   * 需要实屏观察（见 docs/refresh-adaptation.md）。
   */
  regionRefresh: boolean
  /**
   * 动画（快刷）模式是否可用：连续运动要靠它才可能流畅。
   * 注意：这几个接口没有「当前是否在动画模式」的查询接口，
   * 因此这里的 true 只表示「接口存在且调用被接受」，不像系统快刷那样能回读验证。
   */
  animationMode: boolean
}

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
  refresh: RefreshCapability
  appVersion: string
  recordedAt: number
}

export const MIN_WEBVIEW_MAJOR = 69

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

export function emptyCapability(): RefreshCapability {
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
    `onyxSdkFound: ${String(baseline.refresh.onyxSdkFound)}`,
    `refreshFeatures: ${baseline.refresh.features.join(',') || 'none'}`,
    `refreshModes: ${baseline.refresh.modes.join(',') || 'none'}`,
    `fullRefresh: ${String(baseline.refresh.fullRefresh)}`,
    `fastMode: ${String(baseline.refresh.fastMode)}`,
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
    refresh: emptyCapability(),
    appVersion: APP_VERSION,
    recordedAt: 0,
    ...partial,
  }
}
