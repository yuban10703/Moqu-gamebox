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
import { topBar, button, field, pager } from './common.js'
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

  let page = 0

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

    /*
     * 分页：这个版本**刻意不做滚动**，而自检页的内容（20 项能力 + 20 款玩法结果 +
     * 报告框）远高于一屏 —— 竖屏内容约 892px、可用只有 730，横屏更是只有 522。
     * 不分页的话，底部那截（包括「跑一遍自检」按钮与报告）永远看不见也点不到。
     *
     * 做法与游戏库一致：先把所有内容建成块，**离屏量出每块的真实高度**，
     * 再按可用高度贪心装箱。量出来再排，比"估个行高"可靠得多
     * （游戏库当初就是估行高估错、把分页器顶出了屏幕）。
     */
    const blocks = collectBlocks()
    const pages = packPages(blocks)
    if (page >= pages.length) page = pages.length - 1
    if (page < 0) page = 0
    const current = pages[page] ?? []
    for (let i = 0; i < current.length; i++) body.appendChild(current[i])
    root.appendChild(body)

    const footer = el('div', { class: 'k-footer', style: 'padding:6px 10px;border-top:1px solid #000;' })
    if (pages.length > 1) {
      footer.appendChild(
        pager(ctx, page, pages.length, function go(next: number): void {
          page = next
          draw()
        }),
      )
    }
    footer.appendChild(button(ctx.t('shell.settings.title'), function settings(): void { ctx.navigate('settings') }, { small: true }))
    footer.appendChild(button(ctx.t('shell.nav.about'), function about(): void { ctx.navigate('about') }, { small: true }))
    root.appendChild(footer)
  }

  /** 把这一页要显示的所有内容建成"块"（标题 / 行 / 按钮 / 报告框） */
  function collectBlocks(): HTMLElement[] {
    const blocks: HTMLElement[] = []
    const section = function section(key: string): HTMLElement {
      return el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:6px 0;' }, ctx.t(key))
    }
    const line = function line(text: string, extra?: HTMLElement): HTMLElement {
      const row = el('div', { style: 'line-height:1.5;' })
      row.appendChild(el('span', {}, text))
      if (extra) row.appendChild(extra)
      return row
    }

    blocks.push(section('shell.diagnostics.device'))
    const probes = runProbes()
    for (let i = 0; i < probes.length; i++) {
      const item = probes[i]
      // ★/☆ 表示支持与否：老引擎上没有颜色，形状最可靠
      const mark = item.ok ? '★' : '☆'
      blocks.push(
        line(
          mark + ' ' + item.key,
          item.detail ? el('span', { style: 'font-size:11px;' }, ' — ' + item.detail) : undefined,
        ),
      )
    }

    blocks.push(section('shell.kindle.gameCheck'))
    if (checks === null) {
      blocks.push(
        button(ctx.t('shell.kindle.runCheck'), function run(): void {
          const result = runGameChecks(ctx)
          checks = result.checks
          totalMs = result.totalMs
          page = 0
          draw()
        }, { primary: true }),
      )
    } else {
      let passed = 0
      for (let i = 0; i < checks.length; i++) if (checks[i].ok) passed++
      blocks.push(el('div', { style: 'font-weight:700;margin-bottom:4px;' }, passed + ' / ' + checks.length + ' · ' + String(totalMs) + ' ms'))
      for (let i = 0; i < checks.length; i++) {
        const check = checks[i]
        blocks.push(
          line(
            (check.ok ? '★ ' : '☆ ') + check.id,
            el('span', { style: 'font-size:11px;' }, ' ' + String(check.ms) + ' ms' + (check.detail ? ' · ' + check.detail : '')),
          ),
        )
      }
      blocks.push(
        button(ctx.t('shell.kindle.runCheck'), function rerun(): void {
          const result = runGameChecks(ctx)
          checks = result.checks
          totalMs = result.totalMs
          page = 0
          draw()
        }, { small: true }),
      )
    }

    blocks.push(section('shell.diagnostics.saves'))
    blocks.push(line(ctx.t('shell.diagnostics.saves') + ': ' + String(listSaves().length)))
    const progress = loadProgress()
    blocks.push(line(ctx.t('shell.detail.progress') + ': ' + String((progress.completed ?? []).length)))
    blocks.push(line(ctx.t('shell.common.version') + ': ' + APP_VERSION))
    blocks.push(line(ctx.t('shell.settings.language') + ': ' + ctx.locale))

    blocks.push(section('shell.kindle.report'))
    /*
     * 报告框：一行一行贴出来，用户可以直接拍照或抄下来反馈。
     * 不提供「复制到剪贴板」—— Kindle 浏览器没有 navigator.clipboard，假装有反而是骗人。
     */
    const report: string[] = []
    report.push('kindle-report v' + APP_VERSION)
    report.push('ua=' + (navigator.userAgent || '?'))
    report.push('viewport=' + String(window.innerWidth) + 'x' + String(window.innerHeight))
    for (let i = 0; i < probes.length; i++) report.push(probes[i].key + '=' + (probes[i].ok ? '1' : '0'))
    if (checks !== null) report.push('games=' + String(checks.length) + ' total_ms=' + String(totalMs))
    const area = el('textarea', {
      style: 'width:100%;height:84px;font-size:11px;box-sizing:border-box;border:1px solid #000;',
    })
    ;(area as HTMLTextAreaElement).value = report.join('\n')
    area.setAttribute('readonly', 'readonly')
    blocks.push(area)

    return blocks
  }

  /**
   * 按**实测高度**把块装进页里。
   *
   * 先把块放进一个离屏容器量一次（宽度与真实主内容一致，否则换行不同、量不准），
   * 再用可用高度贪心装箱。可用高度 = 页脚顶 − 主内容顶 − 分页器高度。
   */
  function packPages(blocks: HTMLElement[]): HTMLElement[][] {
    const probe = el('div', {
      style:
        'position:absolute;left:-99999px;top:0;width:' + Math.max(200, ctx.width - 28) + 'px;' +
        'font-size:13px;line-height:1.5;',
    })
    for (let i = 0; i < blocks.length; i++) probe.appendChild(blocks[i])
    document.body.appendChild(probe)
    const heights: number[] = []
    for (let i = 0; i < blocks.length; i++) heights.push(blocks[i].getBoundingClientRect().height)
    if (probe.parentNode) probe.parentNode.removeChild(probe)

    // 可用高度：页脚（含分页器）预算从视口里扣掉
    const available = Math.max(200, ctx.height - 130 - 96)
    const pages: HTMLElement[][] = []
    let current: HTMLElement[] = []
    let used = 0
    for (let i = 0; i < blocks.length; i++) {
      const h = heights[i]
      if (current.length > 0 && used + h > available) {
        pages.push(current)
        current = []
        used = 0
      }
      current.push(blocks[i])
      used += h
    }
    if (current.length > 0) pages.push(current)
    return pages.length > 0 ? pages : [[]]
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
