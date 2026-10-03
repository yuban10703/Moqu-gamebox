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

describe('数独 · 已填格可以直接改写', () => {
  const seed = 7654321

  /** 取一个"不冲突"的数字（只看题目给定值，足够用于全新盘面） */
  function legalValue(state: ReturnType<typeof sudokuGame.create>, index: number, exclude?: number): number {
    const row = Math.floor(index / 9)
    const col = index % 9
    const boxRow = Math.floor(row / 3) * 3
    const boxCol = Math.floor(col / 3) * 3
    const used = new Set<number>()
    for (let k = 0; k < 9; k++) {
      used.add(state.given[row * 9 + k]!)
      used.add(state.given[k * 9 + col]!)
      for (let b = 0; b < 3; b++) {
        used.add(state.given[(boxRow + Math.floor(k / 3)) * 9 + boxCol + (k % 3)]!)
      }
    }
    for (let v = 1; v <= 9; v++) if (!used.has(v) && v !== exclude) return v
    return 1
  }

  function firstEmptyIndex(state: ReturnType<typeof sudokuGame.create>): number {
    for (let i = 0; i < SUDOKU_CELLS; i++) if (state.given[i] === 0) return i
    return -1
  }

  it('填过之后能直接改成另一个数字（不必先清除）', () => {
    const state = sudokuGame.create(seed, 'starter')
    const index = firstEmptyIndex(state)
    // 第二个值取唯一解在该格的值（按定义与给定值不冲突）；第一个值取"另一个合法数字"
    const v2 = state.solution[index]!
    const v1 = legalValue(state, index, v2)
    expect(v1).not.toBe(v2)
    const selected = sudokuGame.reduce(state, { type: 'select', index } as never)
    const first = sudokuGame.reduce(selected, { type: 'set', value: v1 } as never)
    const second = sudokuGame.reduce(first, { type: 'set', value: v2 } as never)
    expect(first.filled[index]).toBe(v1)
    expect(second.filled[index]).toBe(v2)
    /*
     * 覆盖是一次普通动作，因此天然可撤回一步：规则层的 `undo` 会把这一格
     * 恢复成覆盖之前的值（v1），再撤一次才回到空格（详见 rules.test.ts 的「撤销」）。
     */
    const undone = sudokuGame.reduce(second, { type: 'undo' } as never)
    expect(undone.filled[index]).toBe(v1)
    expect(sudokuGame.reduce(undone, { type: 'undo' } as never).filled[index]).toBe(0)
  })

  it('填同一个数字是幂等的（不会因为"自己和自己冲突"被拒）', () => {
    const state = sudokuGame.create(seed, 'starter')
    const index = firstEmptyIndex(state)
    const v = legalValue(state, index)
    const selected = sudokuGame.reduce(state, { type: 'select', index } as never)
    const once = sudokuGame.reduce(selected, { type: 'set', value: v } as never)
    const again = sudokuGame.reduce(once, { type: 'set', value: v } as never)
    expect(again.filled[index]).toBe(v)
  })

  it('题目给定格仍然不能改', () => {
    const state = sudokuGame.create(seed, 'starter')
    let given = -1
    for (let i = 0; i < SUDOKU_CELLS; i++) if (state.given[i] !== 0) { given = i; break }
    const selected = sudokuGame.reduce(state, { type: 'select', index: given } as never)
    expect(() => sudokuGame.reduce(selected, { type: 'set', value: 1 } as never)).toThrow()
  })
})
