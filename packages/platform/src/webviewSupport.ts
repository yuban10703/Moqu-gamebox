/**
 * 系统 WebView 能力探测（对应 A01 的「最低要求 WebView ≥ Chrome 110」）。
 *
 * 为什么要有它：原生闸（MainActivity 的 MIN_WEBVIEW_MAJOR）只能读**版本号**，
 * 而"版本号够新、能力却缺"的裁剪实现是存在的；一旦真的白屏，用户看到的是一片空白，
 * 连"哪里不对"都无从说起。这里把判据做成**可注入、可测试的纯函数**，
 * 由 Web 入口在挂载 React 之前调用，不通过就渲染一屏极简提示。
 *
 * **判失败的口径（宁可少拦，不可误伤）**：
 * - 能力缺（容器查询 / dvh）→ 失败；
 * - UA 里能解析出 Chrome 主版本号且 < [MIN_WEBVIEW_MAJOR] → 失败；
 * - 版本解析不到（非 Chrome 内核、UA 被改写、环境不支持）但能力齐全 → **通过**。
 */

/**
 * 最低可用的 WebView（Chromium）主版本号。
 *
 * 与 `apps/web/vite.config.ts` 的 `target: ['chrome110', ...]`、
 * 以及原生闸 `MainActivity.MIN_WEBVIEW_MAJOR` 同步 —— 三处必须一起改。
 */
export const MIN_WEBVIEW_MAJOR = 110

/** 探测输入：缺省读真实的 navigator / CSS.supports，测试可注入假环境 */
export interface WebViewSupportEnv {
  /** 缺省 `navigator.userAgent` */
  ua?: string
  /** 缺省 `CSS.supports`（CSS.supports 不可用时视为"无法判定"，不据此拦人） */
  supports?: (prop: string, value: string) => boolean
}

export interface WebViewSupportReport {
  ok: boolean
  /** 从 UA 解析出的 Chrome 主版本号；解析不到为 null */
  major: number | null
  /** 不满足的判据（失败时非空）：既用于排障，也用于提示页正文 */
  missing: string[]
}

/**
 * 逐项探测的能力。
 * id 同时是失败时写进 `missing` 的字符串：真机排障要能一眼看出缺的是哪一项。
 */
const CAPABILITY_CHECKS: ReadonlyArray<{ id: string; prop: string; value: string }> = [
  // 容器查询单位：styles.css 里 cqw / cqh 共 79 处（连 TSX 内联共 83 处），是排版的主骨架（Chromium 105 起）
  { id: 'container-type: inline-size', prop: 'container-type', value: 'inline-size' },
  // 动态视口高度：整屏布局依赖 100dvh（Chromium 108 起）
  { id: 'height: 100dvh', prop: 'height', value: '100dvh' },
]

/**
 * 缺省的 supports 实现。
 * CSS.supports 本身不可用时（比 Chromium 28 还老的引擎、或非浏览器环境）返回 true：
 * 读不到能力不等于能力缺失，不能凭这一点把设备挡在门外。
 */
function defaultSupports(prop: string, value: string): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true
  try {
    return CSS.supports(prop, value)
  } catch {
    return true
  }
}

/** 从 UA 里取 Chrome 主版本号（`Chrome/156.0.8078.4` → 156）；取不到返回 null */
export function chromeMajorFromUserAgent(ua: string): number | null {
  const match = /Chrome\/(\d+)/.exec(ua)
  if (!match) return null
  const major = Number.parseInt(match[1]!, 10)
  return Number.isFinite(major) ? major : null
}

/** 真实环境探测结果；Web 入口据此决定"挂载还是提示" */
export function detectWebViewSupport(env: WebViewSupportEnv = {}): WebViewSupportReport {
  const ua = env.ua ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  const supports = env.supports ?? defaultSupports

  const missing: string[] = []
  for (const check of CAPABILITY_CHECKS) {
    if (!supports(check.prop, check.value)) missing.push(check.id)
  }

  const major = chromeMajorFromUserAgent(ua)
  // 版本能解析且过低 → 失败；解析不到（major === null）不参与判定
  if (major !== null && major < MIN_WEBVIEW_MAJOR) missing.push(`chrome>=${MIN_WEBVIEW_MAJOR}`)

  return { ok: missing.length === 0, major, missing }
}
