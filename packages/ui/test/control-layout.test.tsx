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
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryKv } from '@eink/core'
import { createPlatform } from '@eink/platform'
import { App } from '../src/App.js'
import { library } from '../../../apps/web/src/library.js'

afterEach(() => {
  cleanup()
  delete window.__einkHandleBack
})

const SWIPE_HINT = /Turn off the direction buttons in the pause menu for a bigger board/

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
    fireEvent.click(screen.getByText('Show direction buttons: Off'))
    await waitFor(() => expect(screen.getByText('Show direction buttons: On')).toBeTruthy())
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
