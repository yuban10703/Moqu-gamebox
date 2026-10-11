/**
 * 应用外壳：i18n、设置、路由、屏幕生命周期。
 *
 * 路由是**栈**而不是单值：Kindle 的物理返回键（上报 Esc 或 Backspace）必须能回上一屏，
 * 而浏览器 history API 在老引擎上不可靠（pushState 有，popstate 行为不一致），
 * 因此自己维护一份栈，物理键一律走 `back()`。
 */
import { createI18n, detectLocale, type DictSet, type I18n } from '@eink/core'
import type { GameLibrary } from '@eink/ui'
import { el, clear } from './dom.js'
import { loadSettings, saveSettings, type KindleSettings } from './store.js'
import type { Screen, ScreenCtx, ScreenName, ScreenParams } from './screen-ctx.js'
import { renderLibrary } from './screens/library.js'
import { renderDetail } from './screens/detail.js'
import { renderGame } from './screens/game.js'
import { renderSettings } from './screens/settings.js'
import { renderAbout } from './screens/about.js'
import { renderDiagnostics } from './screens/diagnostics.js'

const SCREENS: Record<string, Screen> = {
  library: renderLibrary,
  detail: renderDetail,
  game: renderGame,
  settings: renderSettings,
  about: renderAbout,
  diagnostics: renderDiagnostics,
}

/** 屏幕可用区域：Kindle 上窗口尺寸就是可视区，不需要 dvh 那套 */
function viewport(): { width: number; height: number } {
  const width = window.innerWidth || document.documentElement.clientWidth || 800
  const height = window.innerHeight || document.documentElement.clientHeight || 600
  return { width: width, height: height }
}

/**
 * 真机排障用的全局句柄。
 *
 * 与 Web 版把平台对象挂到 `window.__einkPlatform` 同一个理由：
 * Kindle 上没有 DevTools、没有控制台，出问题时只能靠"在地址栏里塞一段 JS"或
 * 自检页读到运行时状态。有它才能问出「现在在哪一屏、库加载了几款、语言是什么」。
 */
declare global {
  interface Window {
    __moquApp?: AppHandle
  }
}

export interface AppHandle {
  navigate(screen: ScreenName, params?: ScreenParams): void
  back(): void
  setLocale(locale: 'zh-CN' | 'en-US'): void
  render(): void
  /** 当前运行时摘要（排障与自检页用；不要拿它做业务判断） */
  status(): { screen: ScreenName; params: ScreenParams; locale: string; games: number }
  /** 全部玩法 id（探索脚本与诊断页用；顺序与游戏库一致） */
  listGameIds(): string[]
  /**
   * 某个玩法是否支持「点棋盘操作」（由登记表里有没有 selectAction 决定）。
   * 探索脚本靠它区分两种情况：**点棋盘本该有反应却没反应**（缺陷）
   * 与**这个玩法本来就是方向键驱动、点棋盘没反应是设计如此**（不是缺陷）。
   */
  isCellSelectable(gameId: string): boolean
}

export function startApp(root: HTMLElement, library: GameLibrary): AppHandle {
  let settings: KindleSettings = loadSettings()
  let dicts: DictSet = library.dicts
  let i18n: I18n = createI18n(settings.locale, dicts)

  let currentCleanup: (() => void) | null = null
  let currentScreen: ScreenName = 'library'
  let currentParams: ScreenParams = {}
  const stack: Array<{ screen: ScreenName; params: ScreenParams }> = []
  let statusText: string | null = null

  function rebuildI18n(): void {
    i18n = createI18n(settings.locale, dicts)
  }

  const handle: AppHandle = {
    navigate: function navigate(screen: ScreenName, params?: ScreenParams): void {
      const next = params ?? {}
      // 同屏不算前进（避免返回键要按两次才退出去）
      if (screen !== currentScreen || JSON.stringify(next) !== JSON.stringify(currentParams)) {
        stack.push({ screen: currentScreen, params: currentParams })
      }
      statusText = null
      renderScreen(screen, next)
    },

    back: function back(): void {
      const previous = stack.pop()
      if (!previous) {
        if (currentScreen !== 'library') renderScreen('library', {})
        return
      }
      statusText = null
      renderScreen(previous.screen, previous.params)
    },

    setLocale: function setLocale(locale: 'zh-CN' | 'en-US'): void {
      settings.locale = locale
      saveSettings(settings)
      rebuildI18n()
      renderScreen(currentScreen, currentParams)
    },

    render: function render(): void {
      renderScreen(currentScreen, currentParams)
    },

    status: function status(): { screen: ScreenName; params: ScreenParams; locale: string; games: number } {
      return {
        screen: currentScreen,
        params: currentParams,
        locale: settings.locale,
        games: library.entries.length,
      }
    },

    listGameIds: function listGameIds(): string[] {
      const out: string[] = []
      for (let i = 0; i < library.entries.length; i++) out.push(library.entries[i].game.id)
      return out
    },

    isCellSelectable: function isCellSelectable(gameId: string): boolean {
      for (let i = 0; i < library.entries.length; i++) {
        const game = library.entries[i].game
        if (game.id === gameId) return typeof game.selectAction === 'function'
      }
      return false
    },
  }

  function renderScreen(screen: ScreenName, params: ScreenParams): void {
    const renderer = SCREENS[screen]
    if (!renderer) {
      // 未知屏幕（不该发生）：退回库页，而不是白屏
      renderScreen('library', {})
      return
    }
    // 清掉上一屏：先解绑事件，再清 DOM —— 顺序反了会让解绑函数拿到已移除的节点
    if (currentCleanup) {
      try {
        currentCleanup()
      } catch (e) {
        /* 清理失败不能让整页卡住 */
      }
      currentCleanup = null
    }
    clear(root)

    currentScreen = screen
    currentParams = params

    const size = viewport()
    const ctx: ScreenCtx = {
      t: function t(key: string, tParams?: Record<string, string | number>): string {
        return i18n.t(key, tParams)
      },
      plural: function plural(key: string, count: number, tParams?: Record<string, string | number>): string {
        return i18n.plural(key, count, tParams)
      },
      has: function has(key: string): boolean {
        return i18n.has(key)
      },
      locale: settings.locale,
      library: library,
      settings: settings,
      updateSettings: function updateSettings(patch: Partial<KindleSettings>): void {
        for (const key in patch) {
          if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
          ;(settings as unknown as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
        }
        saveSettings(settings)
        if (patch.locale !== undefined) {
          rebuildI18n()
        }
      },
      navigate: handle.navigate,
      back: handle.back,
      params: params,
      width: size.width,
      height: size.height,
      setStatus: function setStatus(text: string | null): void {
        statusText = text
        renderStatus()
      },
    }

    try {
      currentCleanup = renderer(root, ctx)
    } catch (e) {
      // 任何一屏崩了都不能白屏：显示可读的错误并允许回到库页
      clear(root)
      root.appendChild(
        el('div', { style: 'padding:24px;text-align:center;font-size:15px;line-height:1.6;' },
          el('div', { style: 'font-weight:700;margin-bottom:8px;' }, 'screen error'),
          el('div', { style: 'font-size:12px;' }, String(e)),
        ),
      )
      const back = el('button', { style: 'margin-top:16px;height:44px;padding:0 18px;border:1px solid #000;background:#fff;' }, 'back')
      back.addEventListener('click', function goBack(): void {
        stack.length = 0
        renderScreen('library', {})
      }, false)
      root.appendChild(back)
      currentCleanup = null
    }
  }

  function renderStatus(): void {
    const existing = document.getElementById('k-status')
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
    if (!statusText) return
    const node = el('div', { id: 'k-status', style: 'padding:6px 10px;background:#000;color:#fff;font-size:13px;' }, statusText)
    root.insertBefore(node, root.firstChild)
  }

  // 物理返回键：老引擎上 Escape/Backspace 都可能出现；同时兜住 Kindle 的返回手势
  document.addEventListener(
    'keydown',
    function onKeydown(event: Event): void {
      const e = event as KeyboardEvent
      const code = e.keyCode || 0
      if ((code === 27 || code === 8) && currentScreen !== 'game') {
        // 对局页的 Esc 是「暂停菜单」，由该屏自己处理
        e.preventDefault()
        handle.back()
      }
    },
    false,
  )

  // 窗口尺寸变了（横竖屏切换）就重画：几何是算出来的，不重画就会溢出
  let resizeTimer: number | null = null
  window.addEventListener(
    'resize',
    function onResize(): void {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(function redraw(): void {
        resizeTimer = null
        renderScreen(currentScreen, currentParams)
      }, 250)
    },
    false,
  )

  rebuildI18n()
  renderScreen('library', {})
  window.__moquApp = handle
  return handle
}

/** 语言探测：navigator.languages 在老引擎上可能不存在，逐级回退 */
export function pickLocale(preferred: 'zh-CN' | 'en-US' | null): 'zh-CN' | 'en-US' {
  if (preferred) return preferred
  try {
    const nav = navigator as Navigator & { languages?: string[] }
    const list = nav.languages && nav.languages.length > 0 ? nav.languages : [nav.language]
    return detectLocale(list as string[])
  } catch (e) {
    return 'zh-CN'
  }
}
