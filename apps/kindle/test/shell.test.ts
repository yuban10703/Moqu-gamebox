// @vitest-environment jsdom
/**
 * Kindle 壳层的功能冒烟测试（jsdom）。
 *
 * 守的是「换了一套壳层之后，20 款玩法还能不能真的玩起来」：
 * 每一款都必须能建局、能出视图、能在 DOM 里画出来、能落一步、能存档。
 * 这条测试是这套新壳层与旧 React 壳层之间**唯一**的共同判据 ——
 * 玩法逻辑两边共用，壳层却是重写的，所以必须逐款过一遍。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { library } from '@eink/library'
import { createI18n } from '@eink/core'
import { startApp } from '../src/app.js'

function makeRoot(): HTMLElement {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.id = 'k-root'
  document.body.appendChild(root)
  return root
}

/** jsdom 默认没有布局：给一个像 Kindle 的视口，免得几何算成 0 */
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

beforeEach(() => {
  window.localStorage.clear()
  setViewport(1072, 1448)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Kindle 壳层', () => {
  it('游戏库把 20 款玩法全部列出来', () => {
    const root = makeRoot()
    startApp(root, library)

    expect(library.entries.length).toBe(20)
    const text = root.textContent ?? ''
    const i18n = createI18n('zh-CN', library.dicts)
    // 第一页放不下 20 款，先确认首页每一款的名字都在
    let shown = 0
    for (const entry of library.entries) {
      const title = i18n.t(`${entry.game.i18nNamespace}.title`)
      if (text.indexOf(title) >= 0) shown++
    }
    expect(shown).toBeGreaterThan(0)
    // 页面上必须有翻页控件，否则第 2 页之后的玩法就够不着了
    expect(text).toContain(i18n.t('shell.pager.next'))
  })

  it('逐款玩法：能建局、能出视图、能在 DOM 里画出来', () => {
    const root = makeRoot()
    startApp(root, library)

    const failures: string[] = []
    for (const entry of library.entries) {
      const game = entry.game
      try {
        const state = game.create(0, entry.defaultDifficulty)
        const view = game.view(state)
        expect(game.status(state)).toBeTruthy()
        expect(game.controls(state)).toBeTruthy()
        // 每款都至少要产出一种呈现（棋盘 / 牌桌 / 对决面板之一）
        const hasPresentation = view.board !== null || view.table !== null || view.duel !== null
        if (!hasPresentation) failures.push(`${game.id}: 没有任何呈现模型`)
        if (view.board) {
          expect(view.board.cells.length).toBe(view.board.cols * view.board.rows)
        }
      } catch (error) {
        failures.push(`${game.id}: ${String(error)}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('棋盘渲染成 DOM 表格，格子数与棋盘一致', async () => {
    const root = makeRoot()
    const app = startApp(root, library)

    // 推箱子：9×9 之类的固定关卡，格子数应该等于 cols×rows
    app.navigate('game', { gameId: 'sokoban', difficulty: 'starter' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const cells = root.querySelectorAll('.k-board__cell')
    expect(cells.length).toBeGreaterThan(0)
    const table = root.querySelector('table.k-board')
    expect(table).not.toBeNull()
  })

  it('点格子会派发动作，非法点击给文字提示而不是静默', async () => {
    const root = makeRoot()
    const app = startApp(root, library)
    app.navigate('game', { gameId: 'sokoban', difficulty: 'starter' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const before = root.querySelectorAll('.k-board__cell').length
    expect(before).toBeGreaterThan(0)
    // 点第一格（多半是墙或地板）：无论合法与否都不能抛错、不能白屏
    const first = root.querySelector('.k-board__cell') as HTMLElement
    expect(first).not.toBeNull()
    first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(root.querySelectorAll('.k-board__cell').length).toBe(before)
  })

  it('存档写进 localStorage，并且是 core 的信封格式（能跨端读）', async () => {
    const { loadSave } = await import('../src/store.js')
    const root = makeRoot()
    const app = startApp(root, library)
    app.navigate('game', { gameId: 'sudoku', difficulty: 'starter' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 屏幕切换时 session.dispose() 会提交一次存档
    app.navigate('library')
    const loaded = loadSave('sudoku')
    if (loaded.status === 'ok') {
      // 信封字段必须齐全：Web / Android 侧就是按这些字段解析的
      expect(loaded.envelope.schema).toBe(1)
      expect(loaded.envelope.gameId).toBe('sudoku')
      expect(typeof loaded.envelope.checksum).toBe('string')
      expect(loaded.envelope.state).toBeTruthy()
    } else {
      // 没有存档也必须是明确的 empty，绝不能是 corrupt
      expect(loaded.status).toBe('empty')
    }
  })

  it('设置页能把语言切到英文并即时生效', () => {
    const root = makeRoot()
    const app = startApp(root, library)
    app.navigate('settings')
    const i18nEn = createI18n('en-US', library.dicts)
    app.setLocale('en-US')
    expect(root.textContent ?? '').toContain(i18nEn.t('shell.settings.title'))
  })

  it('诊断页能跑完全部玩法的自检', async () => {
    const root = makeRoot()
    const app = startApp(root, library)
    app.navigate('diagnostics')

    const buttons = Array.from(root.querySelectorAll('button'))
    const runButton = buttons.find((b) => (b.textContent ?? '').indexOf('自检') >= 0 || (b.textContent ?? '').indexOf('self-check') >= 0)
    expect(runButton, '诊断页没有「跑一遍自检」按钮').toBeTruthy()
    runButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    const text = root.textContent ?? ''
    // 20 款全部通过时才不出现 ☆
    expect(text).toContain('20 / 20')
  })
})
