/**
 * WebView 能力探测（第二道闸）的纯函数测试。
 *
 * 重点是**判失败口径的边界**：缺能力要拦、版本能解析且 <110 要拦，
 * 但"版本解析不到 + 能力齐全"必须放行 —— 否则非 Chrome 内核（或 UA 被改写的）设备会被误伤，
 * 那比"漏拦一个怪实现"更糟：能用的设备被自己挡在门外。
 */
import { describe, expect, it } from 'vitest'
import {
  chromeMajorFromUserAgent,
  detectWebViewSupport,
  MIN_WEBVIEW_MAJOR,
} from '../src/webviewSupport.js'

/** 造一个真实形状的 Android WebView UA */
function androidUa(chromeMajor: number): string {
  return (
    'Mozilla/5.0 (Linux; Android 11; NoteX2) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `Chrome/${chromeMajor}.0.5481.65 Safari/537.36`
  )
}

/** 只对指定能力返回 false 的假 supports（其余一律支持） */
function supportsExcept(...unsupported: string[]): (prop: string, value: string) => boolean {
  return (prop, value) => !unsupported.includes(`${prop}: ${value}`)
}

const ALL_SUPPORTED = (): boolean => true

describe('detectWebViewSupport', () => {
  it('① 能力齐 + Chrome 156 → 通过，并报出主版本号', () => {
    const report = detectWebViewSupport({ ua: androidUa(156), supports: ALL_SUPPORTED })
    expect(report).toEqual({ ok: true, major: 156, missing: [] })
  })

  it('② 缺容器查询 → 失败，且 missing 点名 container-type', () => {
    const report = detectWebViewSupport({
      ua: androidUa(156),
      supports: supportsExcept('container-type: inline-size'),
    })
    expect(report.ok).toBe(false)
    expect(report.missing).toContain('container-type: inline-size')
    expect(report.major).toBe(156)
  })

  it('③ 缺 dvh → 失败，且 missing 点名 height: 100dvh', () => {
    const report = detectWebViewSupport({
      ua: androidUa(156),
      supports: supportsExcept('height: 100dvh'),
    })
    expect(report.ok).toBe(false)
    expect(report.missing).toContain('height: 100dvh')
  })

  it('④ Chrome 109 → 失败（能力再齐也没用）', () => {
    const report = detectWebViewSupport({ ua: androidUa(109), supports: ALL_SUPPORTED })
    expect(report.ok).toBe(false)
    expect(report.major).toBe(109)
    expect(report.missing).toContain(`chrome>=${MIN_WEBVIEW_MAJOR}`)
  })

  it('⑤ 版本解析不到但能力齐全 → 通过（边界：别误伤）', () => {
    const firefoxUa = 'Mozilla/5.0 (X11; Linux x86_64; rv:110.0) Gecko/20100101 Firefox/110.0'
    expect(detectWebViewSupport({ ua: firefoxUa, supports: ALL_SUPPORTED })).toEqual({
      ok: true,
      major: null,
      missing: [],
    })
  })

  it('⑥ 阈值边界：110 通过、109 失败', () => {
    expect(detectWebViewSupport({ ua: androidUa(110), supports: ALL_SUPPORTED }).ok).toBe(true)
    expect(detectWebViewSupport({ ua: androidUa(109), supports: ALL_SUPPORTED }).ok).toBe(false)
  })

  it('能力缺 + 版本过低 → missing 两项都点名（排障要看到全部原因）', () => {
    const report = detectWebViewSupport({
      ua: androidUa(100),
      supports: supportsExcept('container-type: inline-size', 'height: 100dvh'),
    })
    expect(report.ok).toBe(false)
    expect(report.missing).toEqual([
      'container-type: inline-size',
      'height: 100dvh',
      `chrome>=${MIN_WEBVIEW_MAJOR}`,
    ])
  })

  it('UA 解析：只认 Chrome/数字，取不到就是 null', () => {
    expect(chromeMajorFromUserAgent(androidUa(110))).toBe(110)
    expect(chromeMajorFromUserAgent('')).toBeNull()
    expect(chromeMajorFromUserAgent('Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36')).toBeNull()
  })

  it('缺省参数在非浏览器环境（node）下不抛异常，且不误判为失败', () => {
    // vitest 默认 node 环境：没有 CSS.supports（走"无法判定"分支），UA 里也没有 Chrome/
    const report = detectWebViewSupport()
    expect(report.major).toBeNull()
    expect(report.ok).toBe(true)
  })
})
