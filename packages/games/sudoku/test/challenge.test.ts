import { describe, expect, it } from 'vitest'
import { sudokuGame, SUDOKU_CELLS } from '../src/index.js'
import { CHALLENGE_DIFFICULTY } from '../src/rules.js'

/**
 * 挑战难度 = 纯数独（用户要求："挑战难度不加标记，什么数字都可以填进去"）。
 * 其余两档保持既有辅助：冲突拦下、猜错了打标记（后者已由 game.test.ts 覆盖）。
 */
function firstEmpty(state: ReturnType<typeof sudokuGame.create>): number {
  for (let i = 0; i < SUDOKU_CELLS; i++) if (state.given[i] === 0) return i
  return -1
}

/** 找一个"与同行/同列/同宫已有数字冲突"的值 */
function conflictingValue(state: ReturnType<typeof sudokuGame.create>, index: number): number {
  const row = Math.floor(index / 9)
  const col = index % 9
  const used = new Set<number>()
  for (let k = 0; k < 9; k++) {
    used.add(state.given[row * 9 + k]!)
    used.add(state.given[k * 9 + col]!)
  }
  for (let v = 1; v <= 9; v++) if (used.has(v)) return v
  return 1
}

describe('数独 · 挑战难度不加辅助', () => {
  const seed = 1234567

  it('挑战档：冲突数字能填进去，且不打 wrong 标记', () => {
    const state = sudokuGame.create(seed, CHALLENGE_DIFFICULTY)
    const index = firstEmpty(state)
    expect(index).toBeGreaterThanOrEqual(0)
    const selected = sudokuGame.reduce(state, { type: 'select', index } as never)
    const value = conflictingValue(selected, index)
    const placed = sudokuGame.reduce(selected, { type: 'set', value } as never)
    expect(placed.filled[index]).toBe(value)
    const cell = sudokuGame.view(placed).board!.cells[index]!
    expect(cell.glyph).toBe(String(value))
    expect(cell.wrong).toBeUndefined()
  })

  it('入门/熟练档：冲突数字仍被拒绝（抛 IllegalActionError）', () => {
    for (const difficulty of ['starter', 'skilled']) {
      const state = sudokuGame.create(seed, difficulty)
      const index = firstEmpty(state)
      const selected = sudokuGame.reduce(state, { type: 'select', index } as never)
      const value = conflictingValue(selected, index)
      expect(() => sudokuGame.reduce(selected, { type: 'set', value } as never)).toThrow()
    }
  })
})
