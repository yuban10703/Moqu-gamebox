// @vitest-environment jsdom
/**
 * 对局页控制区的摆法（用**真实的游戏登记表** apps/web/src/library.ts，守住各游戏的实际配置）：
 *
 * - 十字方向盘的四款（推箱子 / 2048 / 贪吃蛇 / 数字华容道）改为倒 T：
 *   撤销 / 重开收进上排两侧，控制区不再另起一行；
 * - 数字华容道点方块即可滑动，方向键**默认收起**，暂停菜单里可重新打开；
 * - 俄罗斯方块是平铺一行，撤销 / 重开照旧单独一行；
 * - 能滑动的玩法在详情页补一句「暂停菜单里关掉方向按钮，棋盘更大」，点格子的玩法不提。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { coreDictEn, createMemoryKv } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { App } from '../src/App.js'
import { library } from '../../../apps/web/src/library.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete window.__einkHandleBack
})

/*
 * 提示是**壳层通用文案**（`shell.detail.swipeHint`）：从字典里取，不写死字符串 ——
 * 文案会随「尽量不折叠」的预算被压缩（本轮就从 62 字压到 20 字），
 * 写死会让一条纯文案改动把布局测试弄红。
 */
const SWIPE_HINT = coreDictEn['shell.detail.swipeHint']!

async function mount() {
  const platform = await createPlatform({ kv: createMemoryKv(), now: () => 1_700_000_000_000 })
  const utils = render(<App platform={platform} library={library} />)
  await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())
  return utils
}

async function openDetail(title: string): Promise<void> {
  fireEvent.click(screen.getByText(title))
  await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
}

async function startGame(title: string): Promise<void> {
  await openDetail(title)
  fireEvent.click(screen.getByText('New game'))
  await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy())
}

describe('倒 T：撤销 / 重开收进方向键两侧', () => {
  for (const title of ['Sokoban', '2048', 'Snake']) {
    it(`${title}：两侧格子是「撤销 / 重开」，控制区不再有单独的操作行`, async () => {
      const { container } = await mount()
      await startGame(title)
      expect(container.querySelector('.eink-dpad--tee')).not.toBeNull()
      expect(container.querySelector('.eink-dpad-tee__corner--left')?.textContent).toBe('Undo')
      expect(container.querySelector('.eink-dpad-tee__corner--right')?.textContent).toBe('Restart')
      expect(container.querySelector('.eink-controls__actions')).toBeNull()
    })
  }

  it('两侧的「重开」照旧先弹确认框（误触不会直接丢局）', async () => {
    const { container } = await mount()
    await startGame('Sokoban')
    const restart = container.querySelector('.eink-dpad-tee__corner--right button') as HTMLButtonElement
    fireEvent.click(restart)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('数字华容道：方向键默认收起', () => {
  it('开局没有方向键、撤销 / 重开留在单独一行；暂停菜单里打开后变成倒 T', async () => {
    const { container } = await mount()
    await startGame('Fifteen Puzzle')
    expect(container.querySelector('.eink-dpad')).toBeNull()
    expect(container.querySelector('.eink-controls__actions')?.textContent).toContain('Undo')

    fireEvent.click(screen.getByText('Pause'))
    fireEvent.click(screen.getByText('D-pad: Off'))
    await waitFor(() => expect(screen.getByText('D-pad: On')).toBeTruthy())
    fireEvent.click(screen.getAllByText('Resume')[0]!)
    await waitFor(() => expect(container.querySelector('.eink-dpad--tee')).not.toBeNull())
    expect(container.querySelector('.eink-controls__actions')).toBeNull()
  })
})

describe('俄罗斯方块：平铺一行', () => {
  it('方向键平铺，撤销 / 重开单独一行', async () => {
    const { container } = await mount()
    await startGame('Tetris')
    expect(container.querySelector('.eink-dpad--row')).not.toBeNull()
    expect(container.querySelector('.eink-dpad-tee')).toBeNull()
    expect(container.querySelector('.eink-controls__actions')?.textContent).toContain('Undo')
  })
})

describe('详情页的「关方向键、棋盘更大」提示', () => {
  for (const title of ['Sokoban', '2048', 'Snake', 'Tetris']) {
    it(`${title}：能滑动，玩法说明里有提示`, async () => {
      await mount()
      await openDetail(title)
      expect(screen.getByText(SWIPE_HINT)).toBeTruthy()
    })
  }

  for (const title of ['Fifteen Puzzle', 'Sudoku', 'Klotski']) {
    it(`${title}：靠点格子操作（不接管滑动），不提示`, async () => {
      await mount()
      await openDetail(title)
      expect(screen.queryByText(SWIPE_HINT)).toBeNull()
    })
  }
})

/*
 * 暂停：不弹整屏遮罩（用户要求），棋盘照常可见、状态条写「已暂停」，
 * 控制区原地换成暂停菜单；原控制区只隐藏不移除（高度不变，棋盘不跳）。
 */
describe('暂停：原地换成暂停菜单，不弹页面', () => {
  it('暂停后没有对话框；棋盘仍在；状态条写 Paused；控制区换成四个菜单键', async () => {
    const { container } = await mount()
    await startGame('Sokoban')
    fireEvent.click(screen.getByText('Pause'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('grid')).toBeTruthy()
    expect(container.querySelector('.eink-statusstrip')?.textContent).toContain('Paused')

    const stack = container.querySelector('.eink-controls-stack') as HTMLElement
    expect(stack.dataset.paused).toBe('yes')
    // 原控制区仍在 DOM 里占位，但对读屏与点击都不可达
    const controls = stack.querySelector('.eink-controls') as HTMLElement
    expect(controls.getAttribute('aria-hidden')).toBe('true')
    expect(controls.hasAttribute('inert')).toBe(true)

    const menu = stack.querySelector('.eink-pausebar') as HTMLElement
    expect(menu.getAttribute('role')).toBe('group')
    expect([...menu.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Resume',
      'Restart',
      'D-pad: On',
      'Back to library',
    ])
  })

  it('继续：菜单消失、方向键回来、状态条不再写 Paused', async () => {
    const { container } = await mount()
    await startGame('Sokoban')
    fireEvent.click(screen.getByText('Pause'))
    const menu = container.querySelector('.eink-pausebar') as HTMLElement
    fireEvent.click([...menu.querySelectorAll('button')].find((button) => button.textContent === 'Resume')!)

    expect(container.querySelector('.eink-pausebar')).toBeNull()
    expect((container.querySelector('.eink-controls-stack') as HTMLElement).dataset.paused).toBe('no')
    expect(container.querySelector('.eink-controls')?.hasAttribute('inert')).toBe(false)
    expect(container.querySelector('.eink-statusstrip')?.textContent ?? '').not.toContain('Paused')
  })

  it('菜单里的「重新开始」照旧先确认；「返回游戏库」回到首页', async () => {
    const { container } = await mount()
    await startGame('Sokoban')
    fireEvent.click(screen.getByText('Pause'))
    const button = (label: string): HTMLButtonElement =>
      [...(container.querySelector('.eink-pausebar') as HTMLElement).querySelectorAll('button')].find(
        (node) => node.textContent === label,
      )!
    fireEvent.click(button('Restart'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    // 取消重开：仍处于暂停，菜单还在原处
    expect(container.querySelector('.eink-pausebar')).not.toBeNull()
    fireEvent.click(button('Back to library'))
    await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())
  })

  it('没有方向键的玩法：菜单里不给方向键开关（三个键）', async () => {
    const { container } = await mount()
    await startGame('Sudoku')
    fireEvent.click(screen.getByText('Pause'))
    const labels = [...(container.querySelector('.eink-pausebar') as HTMLElement).querySelectorAll('button')].map(
      (button) => button.textContent,
    )
    expect(labels).toEqual(['Resume', 'Restart', 'Back to library'])
  })
})

describe('暂停菜单：原控制区只有一行高时排成一行', () => {
  it('实测高度放不下两行 48px 键：菜单单行 + 短文案（重开 / 游戏库）', async () => {
    // jsdom 没有布局：把控制区叠放容器的实测高度模拟成「一行按钮」的 60px
    const real = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('eink-controls-stack')) {
        return { x: 0, y: 0, top: 0, left: 0, right: 415, bottom: 60, width: 415, height: 60, toJSON: () => ({}) } as DOMRect
      }
      return real.call(this)
    })
    const { container } = await mount()
    await startGame('Klotski')
    fireEvent.click(screen.getByText('Pause'))
    const menu = container.querySelector('.eink-pausebar') as HTMLElement
    expect(menu.dataset.compact).toBe('yes')
    expect([...menu.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Resume',
      'Restart',
      'Library',
    ])
  })
})
