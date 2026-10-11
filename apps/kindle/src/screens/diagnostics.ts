/**
 * 设备自检页。
 *
 * 存在的理由：Kindle 各代固件的浏览器差异很大，而**能力必须实测**，不能靠型号猜
 * （项目里已经有过一次教训：对 BOOX 的 WebView 能力做了防御性猜测，实测发现完全不成立）。
 * 所以这一页把「这台设备上到底有什么」直接摊开给用户看，并且能一键跑一遍全部玩法的自检。
 */
import { APP_VERSION } from '@eink/core'
import { el, clear, on } from '../dom.js'
import type { Screen, ScreenCtx } from '../screen-ctx.js'
import { listSaves, loadProgress, storageAvailable } from '../store.js'
import { topBar, button, field } from './common.js'
import { svgSupported } from '../render/svg.js'

interface Probe {
  key: string
  ok: boolean
  detail: string
}

function probe(key: string, fn: () => string | boolean): Probe {
  try {
    const value = fn()
    if (value === false) return { key: key, ok: false, detail: '' }
    return { key: key, ok: true, detail: value === true ? '' : value }
  } catch (e) {
    return { key: key, ok: false, detail: String(e) }
  }
}

function runProbes(): Probe[] {
  const out: Probe[] = []
  const nav = navigator as Navigator & { userAgent: string }

  out.push(probe('engine', function engine(): string {
    return nav.userAgent ? nav.userAgent : 'unknown'
  }))
  out.push(probe('viewport', function viewport(): string {
    return String(window.innerWidth) + '×' + String(window.innerHeight)
  }))
  out.push(probe('devicePixelRatio', function dpr(): string {
    return String(window.devicePixelRatio ? window.devicePixelRatio : 1)
  }))
  out.push(probe('localStorage', function ls(): string | false {
    if (!storageAvailable()) return false
    const used = JSON.stringify(listSaves()).length
    return String(used) + ' B'
  }))
  out.push(probe('xhr', function xhr(): boolean {
    return !!window.XMLHttpRequest
  }))
  out.push(probe('xhr2', function xhr2(): boolean {
    // responseType / onload：老引擎可能只有 XHR1
    if (!window.XMLHttpRequest) return false
    const request = new window.XMLHttpRequest()
    return 'onload' in request && 'responseType' in request
  }))
  out.push(probe('json', function json(): boolean {
    return !!window.JSON && typeof window.JSON.parse === 'function'
  }))
  out.push(probe('svg', function svg(): boolean {
    return svgSupported()
  }))
  out.push(probe('promise', function promise(): boolean {
    return typeof Promise !== 'undefined'
  }))
  out.push(probe('setMap', function setMap(): boolean {
    return typeof Set !== 'undefined' && typeof Map !== 'undefined'
  }))
  out.push(probe('querySelector', function qs(): boolean {
    return !!document.querySelector
  }))
  out.push(probe('classList', function cl(): boolean {
    return !!document.documentElement.classList
  }))
  out.push(probe('addEventListener', function ael(): boolean {
    return !!window.addEventListener
  }))
  out.push(probe('touch', function touch(): boolean {
    return 'ontouchstart' in window || (navigator && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 0)
  }))
  out.push(probe('keydown', function keydown(): boolean {
    return 'onkeydown' in window
  }))
  out.push(probe('boxShadow', function boxShadow(): boolean {
    // 1-bit 上「选中/末手」全靠 inset 阴影，缺了就得换成边框
    const node = document.createElement('div')
    try {
      node.style.setProperty('box-shadow', 'inset 0 0 0 2px #000', '')
      return node.style.getPropertyValue('box-shadow') !== ''
    } catch (e) {
      return false
    }
  }))
  out.push(probe('borderRadius', function borderRadius(): boolean {
    const node = document.createElement('div')
    try {
      node.style.setProperty('border-radius', '4px', '')
      return node.style.getPropertyValue('border-radius') !== ''
    } catch (e) {
      return false
    }
  }))
  out.push(probe('repeatingGradient', function gradient(): boolean {
    const node = document.createElement('div')
    try {
      node.style.setProperty('background-image', 'repeating-linear-gradient(45deg,#eee,#eee 3px,#ddd 3px,#ddd 6px)', '')
      return node.style.getPropertyValue('background-image') !== ''
    } catch (e) {
      return false
    }
  }))
  out.push(probe('cssVariables', function cssVars(): boolean {
    const node = document.createElement('div')
    try {
      node.style.setProperty('--k-probe', '1', '')
      return node.style.getPropertyValue('--k-probe') === '1'
    } catch (e) {
      return false
    }
  }))
  out.push(probe('cssGrid', function cssGrid(): boolean {
    const node = document.createElement('div')
    try {
      node.style.setProperty('display', 'grid', '')
      return node.style.getPropertyValue('display') === 'grid'
    } catch (e) {
      return false
    }
  }))
  return out
}

interface GameCheck {
  id: string
  ok: boolean
  ms: number
  detail: string
}

function runGameChecks(ctx: ScreenCtx): { checks: GameCheck[]; totalMs: number } {
  const checks: GameCheck[] = []
  const now = function now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  }
  const started = now()
  for (let i = 0; i < ctx.library.entries.length; i++) {
    const entry = ctx.library.entries[i]
    const game = entry.game
    const began = now()
    try {
      const state = game.create(0, entry.defaultDifficulty)
      const view = game.view(state)
      game.controls(state)
      game.status(state)
      game.encode(state)
      game.decode(game.encode(state))
      const cells = view.board ? view.board.cells.length : 0
      checks.push({
        id: game.id,
        ok: true,
        ms: Math.round(now() - began),
        detail: String(cells) + ' cells',
      })
    } catch (e) {
      checks.push({ id: game.id, ok: false, ms: Math.round(now() - began), detail: String(e) })
    }
  }
  return { checks: checks, totalMs: Math.round(now() - started) }
}

export const renderDiagnostics: Screen = function renderDiagnostics(root: HTMLElement, ctx: ScreenCtx): () => void {
  const unbinds: Array<() => void> = []
  let checks: GameCheck[] | null = null
  let totalMs = 0

  function draw(): void {
    clear(root)
    root.appendChild(
      topBar(ctx, {
        title: ctx.t('shell.diagnostics.title'),
        onBack: function back(): void {
          ctx.navigate('library')
        },
      }),
    )

    const body = el('div', { class: 'k-main', style: 'font-size:13px;line-height:1.5;' })

    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:6px 0;' }, ctx.t('shell.diagnostics.device')))
    const probes = runProbes()
    for (let i = 0; i < probes.length; i++) {
      const item = probes[i]
      // 用形状标记支持与否：老引擎上没有颜色可言，★/☆ 在 1-bit 上也能分辨
      const mark = item.ok ? '★' : '☆'
      body.appendChild(
        el('div', { style: 'line-height:1.5;' },
          el('span', { style: 'font-weight:700;' }, mark + ' ' + item.key),
          item.detail ? el('span', { style: 'font-size:11px;' }, ' — ' + item.detail) : null,
        ),
      )
    }

    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:12px 0 6px;' }, ctx.t('shell.kindle.gameCheck')))
    if (checks === null) {
      body.appendChild(
        button(ctx.t('shell.kindle.runCheck'), function run(): void {
          const result = runGameChecks(ctx)
          checks = result.checks
          totalMs = result.totalMs
          draw()
        }, { primary: true }),
      )
    } else {
      let passed = 0
      for (let i = 0; i < checks.length; i++) if (checks[i].ok) passed++
      body.appendChild(
        el('div', { style: 'font-weight:700;margin-bottom:6px;' },
          passed + ' / ' + checks.length + ' · ' + String(totalMs) + ' ms'),
      )
      for (let i = 0; i < checks.length; i++) {
        const check = checks[i]
        body.appendChild(
          el('div', { style: 'line-height:1.5;' },
            el('span', { style: 'font-weight:700;' }, (check.ok ? '★ ' : '☆ ') + check.id),
            el('span', { style: 'font-size:11px;' }, ' ' + String(check.ms) + ' ms' + (check.detail ? ' · ' + check.detail : '')),
          ),
        )
      }
      body.appendChild(
        button(ctx.t('shell.kindle.runCheck'), function rerun(): void {
          const result = runGameChecks(ctx)
          checks = result.checks
          totalMs = result.totalMs
          draw()
        }, { small: true }),
      )
    }

    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:12px 0 6px;' }, ctx.t('shell.diagnostics.saves')))
    body.appendChild(field(ctx.t('shell.diagnostics.saves'), String(listSaves().length)))
    const progress = loadProgress()
    body.appendChild(field(ctx.t('shell.detail.progress'), String((progress.completed ?? []).length)))
    body.appendChild(field(ctx.t('shell.common.version'), APP_VERSION))
    body.appendChild(field(ctx.t('shell.settings.language'), ctx.locale))

    /*
     * 自检报告：一行一行贴出来，用户可以直接拍照或抄下来反馈。
     * 不提供「复制到剪贴板」：Kindle 浏览器没有 navigator.clipboard，假装有反而是骗人。
     */
    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:12px 0 6px;' }, ctx.t('shell.kindle.report')))
    const report: string[] = []
    report.push('kindle-report v' + APP_VERSION)
    report.push('ua=' + (navigator.userAgent || '?'))
    report.push('viewport=' + String(window.innerWidth) + 'x' + String(window.innerHeight))
    for (let i = 0; i < probes.length; i++) {
      report.push(probes[i].key + '=' + (probes[i].ok ? '1' : '0'))
    }
    if (checks !== null) report.push('games=' + String(checks.length) + ' total_ms=' + String(totalMs))
    const area = el('textarea', {
      style: 'width:100%;height:110px;font-size:11px;box-sizing:border-box;border:1px solid #000;',
    })
    ;(area as HTMLTextAreaElement).value = report.join('\n')
    area.setAttribute('readonly', 'readonly')
    body.appendChild(area)

    root.appendChild(body)

    const footer = el('div', { class: 'k-footer', style: 'padding:6px 10px;border-top:1px solid #000;' })
    footer.appendChild(button(ctx.t('shell.settings.title'), function settings(): void { ctx.navigate('settings') }, { small: true }))
    footer.appendChild(button(ctx.t('shell.nav.about'), function about(): void { ctx.navigate('about') }, { small: true }))
    root.appendChild(footer)
  }

  unbinds.push(
    on(document, 'keydown', function keydown(event: Event): void {
      const code = (event as KeyboardEvent).keyCode || 0
      if (code === 27 || code === 8) {
        event.preventDefault()
        ctx.navigate('library')
      }
    }),
  )

  draw()
  return function cleanup(): void {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]()
  }
}
