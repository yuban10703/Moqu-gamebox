// @vitest-environment jsdom
/**
 * 「输掉之后仍然能撤销」的壳层行为（jsdom）。
 *
 * 由来：控制区在 `session.finished` 之后整块让位给结果面板，于是扫雷踩雷输掉时
 * 撤销按钮直接消失 —— 而那一刻正是玩家最需要撤销的时候（用户报障："撤销按钮没有用"）。
 * 现在结果面板会在游戏自己声明了可用的 `undo` 控件时给出「撤销」按钮。
 *
 * 这里用**真实扫雷对局**走一遍：点第一格（首点必安全）→ 点一颗雷 → 结果面板出现
 * → 点撤销 → 回到未输局面（雷不再亮出、结果面板消失、控制区的撤销按钮仍然可用）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { coreDictEn, coreDictZh, createMemoryKv } from '@eink/core'
import { createPlatform } from '@eink/platform'
import {
  CELL_LABEL_KEYS,
  minesweeperEn,
  minesweeperGame,
  minesweeperZh,
  type MinesweeperAction,
} from '@eink/minesweeper'
import { App } from '../src/App.js'
import { defineGame, type GameLibrary } from '../src/registry.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete window.__einkHandleBack
})

const library: GameLibrary = {
  entries: [
    defineGame({
      game: minesweeperGame,
      rulesKeys: ['minesweeper.rules.body'],
      defaultDifficulty: 'starter',
      cellLabelKey: (kind) => CELL_LABEL_KEYS[kind],
    }),
  ],
  dicts: {
    'zh-CN': { ...coreDictZh, ...minesweeperZh },
    'en-US': { ...coreDictEn, ...minesweeperEn },
  },
}

/** 固定时钟：种子来自 Date.now()，固定它才能确定地知道哪一格是雷 */
const NOW = 1_700_000_000_000
const SEED = NOW % 0x7fffffff

function cellAt(index: number): HTMLElement {
  const cell = document.querySelectorAll<HTMLElement>('.eink-board__cell')[index]
  if (!cell) throw new Error(`cell ${index} not found`)
  return cell
}

function mineCells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.eink-board__cell[data-kind="mine"]'))
}

describe('扫雷：踩雷输掉之后仍可撤销（结果面板里的撤销按钮）', () => {
  it('输掉 → 结果面板给出撤销 → 撤销回到踩雷前（未输）局面，且能继续玩', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const platform = await createPlatform({ kv: createMemoryKv(), now: () => NOW })
    render(<App platform={platform} library={library} />)
    await waitFor(() => expect(screen.getByText(/All games/)).toBeTruthy())

    fireEvent.click(screen.getByText('Minesweeper'))
    await waitFor(() => expect(screen.getByText(/How to play/)).toBeTruthy())
    fireEvent.click(screen.getByText('New game'))
    await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy())

    // 用同一颗种子在规则层算出「首点之后哪一格是雷」，避免测试靠运气踩雷
    const probed = minesweeperGame.reduce(minesweeperGame.create(SEED, 'starter'), {
      type: 'reveal',
      index: 0,
    } as MinesweeperAction)
    const mine = probed.mines.find((index) => !probed.revealed.includes(index))!

    // 还没走任何一步：撤销按钮是禁用的
    const undoBefore = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undoBefore.disabled).toBe(true)

    fireEvent.click(cellAt(0))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    expect(mineCells()).toHaveLength(0) // 输之前不亮雷

    fireEvent.click(cellAt(mine))
    await waitFor(() => expect(mineCells().length).toBeGreaterThan(0))
    const result = document.querySelector<HTMLElement>('.eink-section--result')
    expect(result).not.toBeNull()
    // 控制区让位给结果面板，但撤销按钮必须在结果面板里出现且可点
    const undoInResult = within(result!).getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undoInResult.disabled).toBe(false)

    fireEvent.click(undoInResult)
    // 回到踩雷之前：结果面板消失、雷不再亮出、撤销按钮回到控制区且仍可用
    await waitFor(() => expect(document.querySelector('.eink-section--result')).toBeNull())
    expect(mineCells()).toHaveLength(0)
    const undoAfter = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undoAfter.disabled).toBe(false)

    // 撤销之后可以继续正常玩：再点一个隐藏格，棋盘有反应（翻开或插旗都不算坏状态）
    const before = document.querySelectorAll('.eink-board__cell[data-kind="hidden"]').length
    const target = Array.from(
      document.querySelectorAll<HTMLElement>('.eink-board__cell[data-kind="hidden"]'),
    ).find((cell) => cell.getAttribute('aria-label') !== null)!
    fireEvent.click(target)
    await waitFor(() =>
      expect(
        document.querySelectorAll('.eink-board__cell[data-kind="hidden"]').length,
      ).toBeLessThan(before),
    )
  })
})
