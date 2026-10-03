/**
 * 设备基线采集（对应 A01）。
 * 目标是把「目标设备表」需要的信息一次性采全，真机上点一下诊断页即可回填文档。
 */
import { APP_VERSION, createBaseline, type DeviceBaseline } from '@eink/core'
import type { EinkNativeBridge } from './androidBridge.js'
import { isAndroidBridgeAvailable, readAndroidBaseline } from './androidBridge.js'

export interface BaselineInput {
  bridge?: EinkNativeBridge | null
  now?: () => number
}

function webViewport(): { width: number; height: number; dpr: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0, dpr: 1 }
  const viewport = window.visualViewport
  const width = Math.round(viewport?.width ?? window.innerWidth)
  const height = Math.round(viewport?.height ?? window.innerHeight)
  return { width, height, dpr: Number(window.devicePixelRatio?.toFixed(3) ?? 1) }
}

export function collectWebBaseline(now: () => number = () => Date.now()): DeviceBaseline {
  const viewport = webViewport()
  const coarse =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  return createBaseline({
    platform: 'web',
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    locale: typeof navigator === 'undefined' ? 'zh-CN' : navigator.language,
    viewport,
    screen:
      typeof window === 'undefined'
        ? null
        : { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0 },
    touch:
      typeof navigator === 'undefined'
        ? { maxTouchPoints: 0, coarse: false }
        : { maxTouchPoints: navigator.maxTouchPoints ?? 0, coarse },
    appVersion: APP_VERSION,
    recordedAt: now(),
  })
}

export function collectBaseline(input: BaselineInput): DeviceBaseline {
  const now = input.now ?? (() => Date.now())
  const web = collectWebBaseline(now)
  const bridge = input.bridge ?? (isAndroidBridgeAvailable() ? window.EinkNative! : null)
  if (!bridge) return web

  const native = readAndroidBaseline(bridge)
  if (!native) {
    return { ...web, platform: 'android' }
  }
  // 原生报上来的字段优先，缺失的用网页实测值补齐（视口必须是网页侧的实测值）
  return {
    ...web,
    ...native,
    platform: 'android',
    viewport: web.viewport,
    touch: web.touch,
    screen: native.screen ?? web.screen,
    appVersion: APP_VERSION,
    recordedAt: now(),
  }
}
