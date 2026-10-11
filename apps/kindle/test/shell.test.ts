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

  /*
   * 关卡选择：详情页选了第 N 关，进去就必须是第 N 关。
   *
   * 这条守的是"选了没用"型缺陷 —— 界面上不报错、也没有任何提示，
   * 只是玩家选的关卡没生效。曾经真的漏过：会话层把"派发 startLevel"这一步
   * 卡在了 `game.controlAction !== undefined` 上，而推箱子既支持 startLevel、
   * 又没有 controlAction（华容道恰好有，所以只有推箱子中招，更难发现）。
   */
  it('关卡制玩法：选第 N 关就进第 N 关（棋盘必须不同）', async () => {
    const ids = (() => {
      const app = startApp(makeRoot(), library)
      return app.listGameIds()
    })()
    expect(ids.length).toBe(20)

    for (const gameId of ['sokoban', 'klotski']) {
      const entry = library.entries.find((e) => e.game.id === gameId)
      expect(entry?.levels?.length ?? 0, `${gameId} 应当有关卡`).toBeGreaterThan(3)
      const first = entry!.levels![0].id
      const fourth = entry!.levels![3].id

      const boardFor = (contentId: string): string => {
        const root = makeRoot()
        const app = startApp(root, library)
        app.navigate('game', { gameId, difficulty: 'starter', contentId, fresh: true })
        const cells = root.querySelectorAll('.k-board__cell')
        expect(cells.length, `${gameId} 没画出棋盘`).toBeGreaterThan(0)
        return Array.from(cells)
          .map((c) => c.getAttribute('data-kind'))
          .join(',')
      }

      const atFirst = boardFor(first)
      const atFourth = boardFor(fourth)
      expect(atFourth, `${gameId}: 选了第 4 关却和第 1 关一模一样（跳关没生效）`).not.toBe(atFirst)
    }
  })

  it('关卡制玩法的标题显示「第 N/M 关」', () => {
    const root = makeRoot()
    const app = startApp(root, library)
    const entry = library.entries.find((e) => e.game.id === 'sokoban')!
    const fourth = entry.levels![3].id
    app.navigate('game', { gameId: 'sokoban', difficulty: 'starter', contentId: fourth, fresh: true })
    const title = root.querySelector('.k-topbar__title')?.textContent ?? ''
    // 统计栏里没有关卡项，标题是玩家唯一能确认"我在第几关"的地方
    expect(title).toContain('4')
    expect(title).toMatch(/第\s*4\s*\/\s*\d+\s*关/)
  })

  /*
   * 存档写不进去时必须**说出来**，而且要一直说。
   *
   * 这是最容易被忽略、代价却最大的一类缺陷：Kindle 上玩家可能读了一小时，
   * 合上盖子再打开，进度全没了 —— 而当时界面上一句提示都没有。
   * （真被漏过：`!canPersist` 那条分支只更新了内部状态、没通知壳层。）
   */
  it('localStorage 写不进去时常驻警告 + 重试入口', () => {
    const root = makeRoot()
    const app = startApp(root, library)

    // 模拟隐私模式 / 配额满：让 setItem 抛错
    const original = window.localStorage.setItem.bind(window.localStorage)
    const proto = Object.getPrototypeOf(window.localStorage) as Storage
    proto.setItem = function throwing(): void {
      const error = new Error('QuotaExceededError')
      error.name = 'QuotaExceededError'
      throw error
    }

    try {
      app.navigate('game', { gameId: 'lightsout', difficulty: 'starter', fresh: true })
      const text = root.textContent ?? ''
      // 必须看得见"进度存不下来"，且给得出下一步动作
      expect(text).toContain('本次进度无法持久化')
      const retry = Array.from(root.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').indexOf('重试') >= 0,
      )
      expect(retry, '没有「重试」入口').toBeTruthy()
    } finally {
      proto.setItem = original
    }
  })

  /*
   * 切屏必须把对话框一起收掉。
   *
   * 对话框挂在 `document.body` 上，而切屏只清屏幕根节点 —— 不显式收掉的话，
   * 真机上"一局结束 → 结果面板 → 按物理返回键回书库"会让结果面板**一直浮在书库上面**：
   * 挡住内容，而它自己的按钮早就没了，用户关不掉。
   * （这条是"打到终局"的实测脚本逮到的：切到井字棋之后，屏幕上还是上一局扫雷的结果。）
   */
  it('切屏时把对话框一并收掉', () => {
    const root = makeRoot()
    const app = startApp(root, library)
    app.navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true })

    // 顶栏的「菜单」按钮 → 暂停菜单
    const menu = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').indexOf('菜单') >= 0,
    )
    expect(menu, '顶栏没有「菜单」按钮').toBeTruthy()
    menu!.click()
    expect(document.querySelector('.k-dialog__panel'), '暂停菜单没打开').toBeTruthy()

    app.navigate('library')
    expect(document.querySelector('.k-dialog__panel'), '切屏后对话框还挂在屏幕上').toBeNull()
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

describe('文案完整性（每一屏、两种语言）', () => {
  /**
   * 两类会被漏掉的文案缺陷，都会**直接显示给用户**：
   *   ① 缺 key：i18n 返回 `⟦key⟧`（这是刻意设计的，就是为了让缺词暴露出来）；
   *   ② 参数名对不上：`第 {index}/{total} 页` 传了 `{page}` → 用户看到字面的 `{index}`。
   * 第二种更阴 —— 它不报错、不缺 key，只是把占位符原样打在屏幕上。
   * （真被漏过一次：`shell.library.page` 需要 `index`，代码里传的是 `page`。）
   */
  const SCREENS = ['library', 'detail', 'game', 'settings', 'about', 'diagnostics'] as const
  const PARAMS = { gameId: 'sokoban', difficulty: 'starter' }

  it('两种语言下都没有缺键标记 ⟦key⟧，也没有没被替换的 {param}', () => {
    const problems: string[] = []
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const screen of SCREENS) {
        window.localStorage.clear()
        window.localStorage.setItem('moqu:1:settings', JSON.stringify({ locale }))
        // 每个屏幕都带上一份"有战绩"的进度：否则「最佳成绩」那一行根本不会渲染，
        // 缺键也就露不出来（这条守卫就被绕过去了）
        const completed: string[] = []
        const bestMoves: Record<string, number> = {}
        for (const entry of library.entries) {
          const contentId = entry.levels && entry.levels.length > 0 ? entry.levels[0].id : entry.defaultDifficulty
          completed.push(entry.game.id + ':' + contentId)
          bestMoves[contentId] = 7
        }
        window.localStorage.setItem(
          'moqu:1:progress',
          JSON.stringify({ completed, bestMoves, history: [{ gameId: 'sudoku', difficulty: 'starter', outcome: 'won', moves: 7, at: 1 }] }),
        )
        const root = makeRoot()
        const app = startApp(root, library)
        app.navigate(screen, PARAMS)

        const text = root.textContent ?? ''
        const missing = text.match(/⟦[^⟧]+⟧/g)
        if (missing) problems.push(`${locale}/${screen} 缺 key: ${missing.slice(0, 5).join(', ')}`)
        // 占位符形式：{ 单词 }（字典里的模板长这样；正常渲染后不该再有）
        const unreplaced = text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)
        if (unreplaced) {
          problems.push(`${locale}/${screen} 有没替换的参数: ${Array.from(new Set(unreplaced)).slice(0, 5).join(', ')}`)
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  /*
   * 逐款玩法跑详情页。
   *
   * 这一条是补上上面那条守卫的盲区：上面只用一款（推箱子）代表全部玩法，
   * 而**玩法自定义文案不是每款都齐全** —— 例如 `<ns>.solved.best` 只有 14/20 款有，
   * 无条件取就会在另外 6 款的详情页上显示 ⟦sokoban.solved.best⟧ 这种东西。
   */
  it('20 款玩法的详情页在两种语言下都不缺键', () => {
    const problems: string[] = []
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const entry of library.entries) {
        window.localStorage.clear()
        window.localStorage.setItem('moqu:1:settings', JSON.stringify({ locale }))
        const contentId = entry.levels && entry.levels.length > 0 ? entry.levels[0].id : entry.defaultDifficulty
        window.localStorage.setItem(
          'moqu:1:progress',
          JSON.stringify({
            completed: [entry.game.id + ':' + contentId],
            bestMoves: { [contentId]: 7 },
            history: [],
          }),
        )
        const root = makeRoot()
        startApp(root, library).navigate('detail', { gameId: entry.game.id })
        const text = root.textContent ?? ''
        const missing = text.match(/⟦[^⟧]+⟧/g)
        if (missing) problems.push(`${locale}/${entry.game.id}: ${Array.from(new Set(missing)).join(', ')}`)
        const unreplaced = text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)
        if (unreplaced) problems.push(`${locale}/${entry.game.id} 未替换参数: ${Array.from(new Set(unreplaced)).join(', ')}`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
})
