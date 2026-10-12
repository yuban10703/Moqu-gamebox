// @vitest-environment jsdom
/**
 * Kindle 壳层的功能冒烟测试（jsdom）。
 *
 * 守的是「换了一套壳层之后，20 款玩法还能不能真的玩起来」：
 * 每一款都必须能建局、能出视图、能在 DOM 里画出来、能落一步、能存档。
 * 这条测试是这套新壳层与旧 React 壳层之间**唯一**的共同判据 ——
 * 玩法逻辑两边共用，壳层却是重写的，所以必须逐款过一遍。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  /*
   * 开新局必须换种子。
   *
   * 这里原先四处都写死 `game.create(0, difficulty)`，后果不是"稍微单调"，而是
   * **所有靠种子生成的玩法每局完全一样**：扫雷雷区、记忆配对洗牌、2048 出块、
   * 斗地主牌、恶魔轮盘赌装填顺序全部固定。
   * 更糟的是 core 的 mulberry32 里有 `state = (seed >>> 0) || 0x9e3779b9` ——
   * 种子 0 会落到那个固定常量，所以那是"唯一那一局"，不是"某一局"。
   */
  it('开新局换种子：靠随机生成的玩法不能每局一模一样', () => {
    const seeds: number[] = []
    const states: string[] = []
    // 同毫秒内连开几局会拿到同一个种子（真实操作里不可能，但测试里会）——把时钟推着走
    let clock = 1700000000000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000))
    try {
      for (let i = 0; i < 3; i++) {
        window.localStorage.clear()
        const root = makeRoot()
        const app = startApp(root, library)
        app.navigate('game', { gameId: 'minesweeper', difficulty: 'starter', fresh: true })
        // 存档是在**第一次落子**时才写的（开局本身不落盘），所以先点一格；
        // 扫雷的雷区是首点之后才铺的 —— 这一步之后存档里就带上了真正的雷区
        const cell = root.querySelector('.k-board__cell') as HTMLElement | null
        expect(cell, '棋盘没渲染出格子').toBeTruthy()
        cell!.click()
        const raw = window.localStorage.getItem('moqu:1:save:minesweeper')
        expect(raw, '开新局之后没有写入存档').toBeTruthy()
        const envelope = JSON.parse(raw!) as { seed: number; state: unknown }
        seeds.push(envelope.seed)
        states.push(JSON.stringify(envelope.state))
      }
    } finally {
      spy.mockRestore()
    }
    expect(seeds, `三局的种子分别是 ${seeds.join(', ')}`).not.toEqual([0, 0, 0])
    expect(new Set(seeds).size, `种子没有变化：${seeds.join(', ')}`).toBe(3)
    expect(new Set(states).size, '三局的雷区完全一样').toBe(3)
  })

  /*
   * 「重开」对两类玩法语义不同（与现代版一致）：
   *   · 无关卡（扫雷/数织/记忆…）：**换一局** —— 游戏自己的规则文案就是这么写的
   *     （数织「重开会换一道题」、记忆「重新洗牌」、扫雷「重新放置地雷」）。
   *     壳层原先一律只调 session.restart()，等于把游戏承诺的语义做没了。
   *   · 有关卡（推箱子/华容道）：回到**本关**初始局面，不能换种子、更不能退回第 1 关。
   */
  it('重开：无关卡玩法换新一局，有关卡玩法仍在同一关', () => {
    let clock = 1700000000000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000))
    try {
      const readSeed = (id: string): number => {
        const raw = window.localStorage.getItem('moqu:1:save:' + id)
        expect(raw, `${id} 没有存档`).toBeTruthy()
        return (JSON.parse(raw!) as { seed: number }).seed
      }
      /** 点当前对话框里指定文字的按钮 */
      const pressInDialog = (label: string): void => {
        const panel = document.querySelector('.k-dialog__panel')
        expect(panel, '没有打开的对话框').toBeTruthy()
        const btn = Array.from(panel!.querySelectorAll('button')).find(
          (b) => (b.textContent ?? '').trim() === label,
        )
        expect(btn, `对话框里没有「${label}」`).toBeTruthy()
        btn!.click()
      }
      /**
       * 走暂停菜单重开（所有玩法都有这条路）。
       * 倒 T 方向键布局的玩法还有 ↻ 角落按钮，但那是布局的空格子顺手放的，
       * 无关卡玩法大多没有方向键，所以测试走通用路径。
       */
      const pressRestart = (host: HTMLElement): void => {
        const menu = Array.from(host.querySelectorAll('button')).find(
          (b) => (b.textContent ?? '').indexOf('菜单') >= 0,
        )
        expect(menu, '顶栏找不到「菜单」').toBeTruthy()
        menu!.click()
        pressInDialog('重新开始') // 暂停菜单里的那一项
        pressInDialog('重新开始') // 确认框
      }

      // —— 无关卡：扫雷 ——
      window.localStorage.clear()
      let root = makeRoot()
      startApp(root, library).navigate('game', { gameId: 'minesweeper', difficulty: 'starter', fresh: true })
      ;(root.querySelector('.k-board__cell') as HTMLElement).click()
      const before = readSeed('minesweeper')
      pressRestart(root)
      const after = readSeed('minesweeper')
      expect(after, '扫雷重开之后还是同一套雷区').not.toBe(before)

      // —— 有关卡：推箱子 ——
      window.localStorage.clear()
      root = makeRoot()
      startApp(root, library).navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true })
      const levelBefore = (root.textContent ?? '').match(/第\s*\d+\s*\/\s*\d+\s*关/)?.[0] ?? ''
      const boardBefore = root.querySelector('.k-board')?.outerHTML ?? ''
      pressRestart(root)
      const levelAfter = (root.textContent ?? '').match(/第\s*\d+\s*\/\s*\d+\s*关/)?.[0] ?? ''
      const boardAfter = root.querySelector('.k-board')?.outerHTML ?? ''
      expect(levelBefore, '推箱子标题里没有关卡号').not.toBe('')
      expect(levelAfter, '推箱子重开之后换了关').toBe(levelBefore)
      expect(boardAfter, '推箱子重开之后不是本关初始局面').toBe(boardBefore)
    } finally {
      spy.mockRestore()
    }
  })

  /*
   * 未翻开的格子必须与已翻开的空格**看得出区别**。
   *
   * 扫雷的未翻格与已翻开空格原本都是一样的白底细边框，玩家分不清哪格还没点。
   * 做法是整盘铺一层 45° 斜纹（逐格铺会让线在格边错位），未翻格透明透出斜纹、
   * 已翻格白底盖住它。这里断言的就是这个"成对"的关系 ——
   * 只改一半（例如只在样式表里写透明，而格子背景是行内白）就会失效：
   * 先前正是如此，样式表那条规则被行内样式压过去，等于没写。
   */
  it('未翻格与已翻开格有区分（扫雷 / 记忆）', () => {
    const styleOf = (el: Element | null): string => (el ? el.getAttribute('style') ?? '' : '')
    for (const id of ['minesweeper', 'memory']) {
      window.localStorage.clear()
      const root = makeRoot()
      startApp(root, library).navigate('game', { gameId: id, difficulty: 'starter', fresh: true })
      const table = root.querySelector('.k-board') as HTMLElement
      expect(styleOf(table), `${id} 没铺斜纹`).toContain('background-image')

      const hidden = root.querySelector('.k-board__cell[data-kind="hidden"]')
      expect(hidden, `${id} 没有未翻格`).toBeTruthy()
      expect(styleOf(hidden), `${id} 的未翻格不是透明的（斜纹会被盖住）`).toContain('background:transparent')

      // 翻一格，同一块盘上直接对比"未翻 vs 已翻"
      ;(root.querySelector('.k-board__cell') as HTMLElement).click()
      const revealed = root.querySelector(
        '.k-board__cell[data-kind="empty"], .k-board__cell[data-kind="number"], .k-board__cell[data-kind="tile"]',
      )
      expect(revealed, `${id} 翻不开格子`).toBeTruthy()
      expect(styleOf(revealed), `${id} 的已翻格应该是白底（好把斜纹盖住）`).toContain('background:#fff')
    }
  })

  /*
   * 倒 T 方向键上排的 ↶ / ↻ 必须与方向键**同尺寸**。
   *
   * 它们带的是 .k-btn（下限 48×48），方向键是 .k-dpad__btn（下限 72×72）——
   * 差这一档，上排就成 48/72/48、下排 72/72/72，三列边界对不上，
   * 「上」没有对在「下」正上方（用户报的"按钮错位"）。
   * 加这个类，样式表才能把两者拉到同一尺寸（几何断言在 kindle-audit.mjs 里）。
   */
  it('倒 T 方向键的角落按钮带 k-dpad__corner（与方向键同尺寸）', () => {
    const root = makeRoot()
    startApp(root, library).navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true })
    const pad = root.querySelector('.k-dpad--tee') as HTMLElement | null
    expect(pad, '推箱子应该有倒 T 方向键').toBeTruthy()
    const corners = pad!.querySelectorAll('.k-dpad__corner')
    expect(corners.length, '上排两侧的 ↶ / ↻ 没有 k-dpad__corner 类').toBe(2)
    expect(pad!.querySelectorAll('.k-dpad__btn').length, '方向键数量不对').toBe(4)
  })

  /*
   * 墙 / 障碍必须画出来。
   *
   * `wall` 是玩法与壳层的约定：贪吃蛇的视图注释写着「障碍 = 斜纹底（kind 'wall'，
   * 壳层用纹理而不是灰度）」，推箱子的墙同样是 `wall`。
   * 而渲染器原先在图形分支里对 `wall` 直接 return null、格子又是白底 ——
   * 于是**墙是隐形的**：推箱子看起来"还没走到边框就被拦住"（用户报的），
   * 贪吃蛇会撞上看不见的东西。
   */
  it('墙 / 障碍有可见纹理（推箱子 / 贪吃蛇）', () => {
    const cases: Array<[string, string]> = [
      ['sokoban', 'starter'],
      ['snake', 'challenging'], // 入门档是「可穿墙」，本来就没障碍；挑战档才有
    ]
    for (const [id, difficulty] of cases) {
      window.localStorage.clear()
      const root = makeRoot()
      startApp(root, library).navigate('game', { gameId: id, difficulty, fresh: true })
      const walls = root.querySelectorAll('.k-board__cell[data-kind="wall"]')
      expect(walls.length, `${id} 这一档应该有墙/障碍`).toBeGreaterThan(0)
      const table = root.querySelector('.k-board') as HTMLElement
      expect(table.getAttribute('style') ?? '', `${id} 没铺斜纹（墙看不见）`).toContain('background-image')
      const style = walls[0].getAttribute('style') ?? ''
      expect(style, `${id} 的墙格不是透明的（斜纹会被自己的白底盖住）`).toContain('background:transparent')
    }
  })

  /*
   * 提示条必须**常驻占位**，高度不随提示出现而变。
   *
   * 原先它只在有内容时才插进文档流，于是每次「这个方向走不通」都把棋盘往下推 74px
   * （实测），而且 .k-main 的高度是钉死的、棋盘还会跟着缩小 ——
   * 墨水屏上等于"眼睛刚对准就换了一屏"。
   * 几何断言（真实浏览器量棋盘有没有动）在 kindle-audit.mjs 里；
   * 这里守的是 DOM 层面的前提：无论有没有提示，这个盒子都在、且 min-height 一样。
   */
  it('提示条常驻占位：有没有提示都在，且预留高度一致', () => {
    const root = makeRoot()
    startApp(root, library).navigate('game', { gameId: 'sokoban', difficulty: 'starter', fresh: true })
    const readBand = (): { count: number; minHeight: string } => {
      const bands = root.querySelectorAll('.k-notice--band')
      const el0 = bands[0] as HTMLElement | undefined
      return { count: bands.length, minHeight: el0 ? el0.style.minHeight : '' }
    }
    const before = readBand()
    expect(before.count, '没有提示时提示条就不见了').toBe(1)
    expect(before.minHeight, '提示条没有预留高度').not.toBe('')

    // 撞墙 → 出提示
    const right = Array.from(root.querySelectorAll('.k-dpad__btn')).find(
      (b) => (b.textContent ?? '').trim() === '右',
    ) as HTMLElement | undefined
    expect(right, '找不到「右」方向键').toBeTruthy()
    right!.click()
    const after = readBand()
    expect(after.count, '有提示时提示条数量变了').toBe(before.count)
    expect(after.minHeight, '有提示时预留高度变了（棋盘会被推动）').toBe(before.minHeight)
  })

  /*
   * 翻页后离开再返回，必须回到原来那一页。
   *
   * 页号原先只是书库屏幕函数里的局部变量，于是"翻到第 2 页 → 进详情/对局 → 返回"
   * 永远回到第 1 页（用户报的）。现在它放在 ScreenParams 里，随返回栈一起保存。
   *
   * 顺带守第二条：**翻页不能压栈** —— 否则返回键要按好几次才退得出书库。
   */
  it('书库翻页后离开再返回，仍在原来那一页；且翻页不压栈', () => {
    const root = makeRoot()
    const app = startApp(root, library)
    const pagerText = (): string => (root.querySelector('.k-pager') as HTMLElement | null)?.textContent ?? ''
    const nextPage = (): void => {
      const btns = Array.from(root.querySelectorAll('.k-pager button'))
      expect(btns.length, '分页器没渲染出来').toBeGreaterThan(1)
      ;(btns[btns.length - 1] as HTMLElement).click()
    }

    expect(pagerText(), '第一页就找不到分页器').toContain('1 /')
    nextPage()
    expect(pagerText(), '没能翻到第 2 页').toContain('2 /')

    // 翻页本身不该进返回栈：此时按返回应当原地不动（栈是空的）
    app.back()
    expect(pagerText(), '翻页被压进了返回栈（返回键会先在页之间来回走）').toContain('2 /')

    // 进详情再返回：应当回到第 2 页
    ;(root.querySelector('.k-list__item') as HTMLElement).click()
    expect(root.querySelector('.k-pager'), '详情页不该有分页器').toBeNull()
    app.back()
    expect(pagerText(), '从详情页返回后没回到原来那一页').toContain('2 /')
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
