/**
 * 求解器测试。
 * 重点是把「唯一解」这个硬要求钉死：
 *   - 完整合法盘恰好 1 个解；
 *   - 冲突盘 0 个解；
 *   - 空盘远多于 1 个解；
 *   - 从生成题目里再挖掉一个关键提示 → 解数立刻变成 2（证明唯一性检查真的在起作用）。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  SUDOKU_CELLS,
  boxOf,
  checkUnique,
  colOf,
  countSolutions,
  createGrid,
  gridFromArray,
  isComplete,
  isConsistent,
  isUnique,
  rowOf,
  solve,
  solveBySingles,
  type Grid,
} from '../src/solver.js'
import { generatePuzzle, type DifficultyId } from '../src/generate.js'

const DIFFICULTIES: readonly DifficultyId[] = ['starter', 'skilled', 'challenging']

function givensOf(values: number[]): Grid {
  return Int8Array.from(values)
}

describe('基本求解', () => {
  it('空盘有解，且填满后是合法完整盘', () => {
    const grid = createGrid()
    expect(solve(grid, createRng(1))).toBe(true)
    expect(isComplete(grid)).toBe(true)
    for (let index = 0; index < SUDOKU_CELLS; index++) {
      const value = grid[index]!
      for (let other = index + 1; other < SUDOKU_CELLS; other++) {
        if (grid[other] !== value) continue
        const sameLine =
          rowOf(index) === rowOf(other) || colOf(index) === colOf(other) || boxOf(index) === boxOf(other)
        expect(sameLine).toBe(false)
      }
    }
  })

  it('同种子的完整解完全相同（求解器本身也确定性）', () => {
    const a = createGrid()
    const b = createGrid()
    solve(a, createRng(20260101))
    solve(b, createRng(20260101))
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('完整合法盘解数为 1，全填满但冲突的盘解数为 0，部分冲突的盘也是 0', () => {
    const solution = generatePuzzle(9, 'starter').solution
    expect(countSolutions(solution, 2)).toBe(1)
    expect(isConsistent(solution)).toBe(true)

    // 同一行内交换两格 → 行冲突，全填满但无解
    const broken = solution.slice()
    broken[0] = solution[1]!
    broken[1] = solution[0]!
    expect(isComplete(broken)).toBe(true)
    expect(isConsistent(broken)).toBe(false)
    expect(countSolutions(broken, 2)).toBe(0)
    expect(solve(broken, createRng(1))).toBe(false)

    // 空出两格，但同一行里已经出现重复 → 无解
    const partial = solution.slice()
    partial[10] = 0
    partial[11] = 0
    partial[0] = solution[1]!
    expect(countSolutions(partial, 2)).toBe(0)
  })

  it('空盘解数远多于 1（limit 生效，不会真的全枚举）', () => {
    expect(countSolutions(createGrid(), 2)).toBe(2)
  })

  it('已知唯一解题目：解数为 1', () => {
    const given = givensOf([
      5, 3, 0, 0, 7, 0, 0, 0, 0,
      6, 0, 0, 1, 9, 5, 0, 0, 0,
      0, 9, 8, 0, 0, 0, 0, 6, 0,
      8, 0, 0, 0, 6, 0, 0, 0, 3,
      4, 0, 0, 8, 0, 3, 0, 0, 1,
      7, 0, 0, 0, 2, 0, 0, 0, 6,
      0, 6, 0, 0, 0, 0, 2, 8, 0,
      0, 0, 0, 4, 1, 9, 0, 0, 5,
      0, 0, 0, 0, 8, 0, 0, 7, 9,
    ])
    expect(checkUnique(given)).toEqual({ unique: true, count: 1 })
    expect(isUnique(given)).toBe(true)
  })

  it('挖掉关键提示后解数变 2 —— 证明唯一性判定真的在数第二个解', () => {
    const puzzle = generatePuzzle(3, 'skilled')
    let sawMultiple = false
    for (let index = 0; index < SUDOKU_CELLS && !sawMultiple; index++) {
      if (puzzle.given[index] === 0) continue
      const loosened = puzzle.given.slice()
      loosened[index] = 0
      if (countSolutions(loosened, 2) === 2) sawMultiple = true
    }
    expect(sawMultiple).toBe(true)
  })

  it('单数推理能解开入门档，且推理链非空', () => {
    const puzzle = generatePuzzle(11, 'starter')
    const steps: string[] = []
    expect(solveBySingles(puzzle.given, steps)).toBe(true)
    expect(steps.length).toBe(puzzle.clueCount === 81 ? 0 : 81 - puzzle.clueCount)
  })

  it('gridFromArray 只接受 81 格（坏数据在入口就被拒）', () => {
    expect(() => gridFromArray([1, 2, 3])).toThrow()
    expect(gridFromArray(new Array(81).fill(0)).length).toBe(81)
  })
})

describe('生成题目自身的解一致性', () => {
  it('每档题目：给定的提示数与解一致，且解恰好是唯一解', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of [0, 5, 99]) {
        const puzzle = generatePuzzle(seed, difficulty)
        expect(countSolutions(puzzle.given, 2)).toBe(1)
        expect(countSolutions(puzzle.solution, 2)).toBe(1)
        for (let index = 0; index < SUDOKU_CELLS; index++) {
          if (puzzle.given[index] !== 0) expect(puzzle.given[index]).toBe(puzzle.solution[index])
        }
      }
    }
  })
})
