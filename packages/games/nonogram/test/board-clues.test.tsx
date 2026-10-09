// @vitest-environment jsdom
/**
 * 线索带的渲染回归（壳层 Board 的那条新分支）。
 *
 * 为什么这条测试放在游戏包里：外壳只允许改 `BoardView`（加两个可选字段）与
 * `Board`（有线索时渲染线索带），而这一段是**数织唯一依赖壳层排版**的地方 ——
 * 线索带画不出来 / 画错位置，游戏就不可玩。放在这里就跟着游戏一起被守住：
 *   1. 没有线索时**一个元素都不多**（其余 17 款玩法的 DOM 与几何完全不变）；
 *   2. 有线索时行/列线索带按题目渲染，数字与游戏给出的完全一致（含全白行的 0）；
 *   3. 组件只给"形状数据"（列数 / 行数 / 线索最多几段），**行内样式里不许出现 px** ——
 *      线索带的厚度与格子尺寸仍然全部由 CSS 算（styles.css 的 .eink-board-clues）。
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Board } from '@eink/ui'
import type { BoardView } from '@eink/core'
import { clueText, colCluesOf, nonogramGame, puzzleOf, rowCluesOf } from '../src/index.js'

function boardOf(seed: number, difficulty: string, withClues = true): BoardView {
  const state = nonogramGame.create(seed, difficulty)
  const board = nonogramGame.view(state).board
  if (!board) throw new Error('nonogram always has a board')
  if (withClues) return board
  const { rowClues: _row, colClues: _col, ...rest } = board
  return rest
}

describe('线索带只在游戏给了线索时渲染', () => {
  it('没有线索：不包外层、不出现任何线索元素（DOM 与从前一致）', () => {
    const { container } = render(<Board board={boardOf(0, 'starter', false)} />)
    expect(container.querySelector('.eink-board-clues')).toBeNull()
    expect(container.querySelectorAll('.eink-board-clues__top')).toHaveLength(0)
    expect(container.querySelectorAll('.eink-board-clues__left')).toHaveLength(0)
    // 棋盘本身照旧：25 个格子 + 形状变量，行内样式里没有像素
    const board = container.querySelector('.eink-board') as HTMLElement
    expect(container.querySelectorAll('.eink-board__cell')).toHaveLength(25)
    expect(board.style.getPropertyValue('--board-cols')).toBe('5')
    expect(board.getAttribute('style') ?? '').not.toMatch(/px/)
  })

  it('有线索：左侧 5 条行线索、顶部 5 条列线索，数字与题目一致', () => {
    const state = nonogramGame.create(0, 'starter')
    const puzzle = puzzleOf(state)
    const { container } = render(<Board board={boardOf(0, 'starter')} />)
    expect(container.querySelector('.eink-board-clues')).not.toBeNull()

    const lines = [...container.querySelectorAll('.eink-board-clues__left .eink-board-clues__line')]
    expect(lines).toHaveLength(5)
    expect(lines.map((line) => line.textContent)).toEqual(
      rowCluesOf(puzzle).map((clue) => clueText(clue).join('')),
    )

    const stacks = [...container.querySelectorAll('.eink-board-clues__top .eink-board-clues__stack')]
    expect(stacks).toHaveLength(5)
    expect(stacks.map((stack) => stack.textContent)).toEqual(
      colCluesOf(puzzle).map((clue) => clueText(clue).join('')),
    )

    // 棋盘仍然是那 25 个格子（线索带没有挤掉任何一格）
    expect(container.querySelectorAll('.eink-board__cell')).toHaveLength(25)
    const board = container.querySelector('.eink-board') as HTMLElement
    expect(board.getAttribute('aria-rowcount')).toBe('5')
    expect(board.getAttribute('aria-colcount')).toBe('5')
  })

  it('10×10：全白的行/列显示成 0，线索段数（最多 5）作为数据交给 CSS', () => {
    // 挑战 2 是火箭：最左与最右两列全白
    const { container } = render(<Board board={boardOf(1, 'challenging')} />)
    const wrapper = container.querySelector('.eink-board-clues') as HTMLElement
    expect(wrapper.style.getPropertyValue('--board-cols')).toBe('10')
    expect(wrapper.style.getPropertyValue('--board-rows')).toBe('10')
    // rocket 的列线索里有两列是 ['0']，行线索最多 3 段
    expect(Number(wrapper.style.getPropertyValue('--clue-left-count'))).toBeGreaterThan(0)
    expect(Number(wrapper.style.getPropertyValue('--clue-top-count'))).toBeGreaterThan(0)
    expect(Number(wrapper.style.getPropertyValue('--clue-top-count'))).toBeLessThanOrEqual(5)
    const zeros = [...container.querySelectorAll('.eink-board-clues__stack')].filter(
      (stack) => stack.textContent === '0',
    )
    expect(zeros.length).toBeGreaterThan(0)
    // 行内样式只有"形状与段数"，一个像素都没有（尺寸全部由 CSS 算）
    expect(wrapper.getAttribute('style') ?? '').not.toMatch(/px/)
  })

  it('棋子/格子状态照旧：黑格是实心黑、叉带字形、空格是空的', () => {
    const state = nonogramGame.create(0, 'starter')
    let marked = nonogramGame.reduce(state, { type: 'cycle', index: 0 })
    marked = nonogramGame.reduce(marked, { type: 'cycle', index: 1 })
    marked = nonogramGame.reduce(marked, { type: 'cycle', index: 1 })
    const board = nonogramGame.view(marked).board!
    const { container } = render(<Board board={board} />)
    const cells = [...container.querySelectorAll('.eink-board__cell')]
    expect(cells[0]!.getAttribute('data-kind')).toBe('mine')
    expect(cells[1]!.getAttribute('data-kind')).toBe('flag')
    expect(cells[1]!.textContent).toBe('✕')
    expect(cells[2]!.getAttribute('data-kind')).toBe('empty')
    // 线索带之外的格子数不变
    expect(cells).toHaveLength(25)
  })
})
