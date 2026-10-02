/**
 * 规则层测试：选中、填入、清除、冲突拒绝、胜负判定。
 * 数独的「非法输入要有明确反馈」在这里被逐条钉死：
 * 改题目给定格、未选格子、格子已满、数字越界、行/列/宫冲突都要抛 IllegalActionError。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import { SUDOKU_CELLS, boxOf, colOf, rowOf } from '../src/solver.js'
import {
  createSudokuState,
  legalActions,
  legalDigitsAt,
  reduceSudoku,
  sudokuGame,
  type SudokuAction,
  type SudokuState,
} from '../src/index.js'

const SEED = 20260101
const DIFFICULTY = 'starter' as const

function fresh(): SudokuState {
  return createSudokuState(SEED, DIFFICULTY)
}

function emptyCells(state: SudokuState): number[] {
  const out: number[] = []
  for (let index = 0; index < SUDOKU_CELLS; index++) if (state.given[index] === 0) out.push(index)
  return out
}

function givenCells(state: SudokuState): number[] {
  const out: number[] = []
  for (let index = 0; index < SUDOKU_CELLS; index++) if (state.given[index] !== 0) out.push(index)
  return out
}

/** 把答案按格填进去（跳过会给错解的格子），返回填满的状态 */
function solveAll(state: SudokuState): SudokuState {
  let current = state
  for (const index of emptyCells(current)) {
    const value = current.solution[index]!
    current = reduceSudoku(reduceSudoku(current, { type: 'select', index }), { type: 'set', value })
  }
  return current
}

function act(state: SudokuState, action: SudokuAction): SudokuState {
  return reduceSudoku(state, action)
}

describe('选中格子', () => {
  it('selectAction 对任意 81 格都返回 select（点在给定格上不报错）', () => {
    const state = fresh()
    for (let index = 0; index < SUDOKU_CELLS; index++) {
      expect(sudokuGame.selectAction!(state, index)).toEqual({ type: 'select', index })
    }
  })

  it('selectAction 对越界索引返回 null', () => {
    const state = fresh()
    expect(sudokuGame.selectAction!(state, -1)).toBeNull()
    expect(sudokuGame.selectAction!(state, SUDOKU_CELLS)).toBeNull()
    expect(sudokuGame.selectAction!(state, 1.5)).toBeNull()
  })

  it('选中给定格合法，只改 selected', () => {
    const state = fresh()
    const given = givenCells(state)[0]!
    const next = act(state, { type: 'select', index: given })
    expect(next.selected).toBe(given)
    expect(Array.from(next.filled)).toEqual(Array.from(state.filled))
  })

  it('重复点同一格返回同一状态对象（不产生多余改动）', () => {
    const state = act(fresh(), { type: 'select', index: 0 })
    expect(act(state, { type: 'select', index: 0 })).toBe(state)
  })

  it('越界 select 抛 IllegalActionError', () => {
    expect(() => act(fresh(), { type: 'select', index: 81 })).toThrow(IllegalActionError)
    expect(() => act(fresh(), { type: 'select', index: -1 })).toThrow(IllegalActionError)
    expect(() => act(fresh(), { type: 'select', index: 2.5 })).toThrow(IllegalActionError)
  })
})

describe('填入与清除', () => {
  it('合法数字能填进选中格', () => {
    const state = fresh()
    const index = emptyCells(state)[0]!
    const value = state.solution[index]!
    const next = act(act(state, { type: 'select', index }), { type: 'set', value })
    expect(next.filled[index]).toBe(value)
    expect(next.given[index]).toBe(0)
  })

  it('清除只清玩家填的数字，题目给定格不受影响', () => {
    const state = fresh()
    const index = emptyCells(state)[0]!
    const value = state.solution[index]!
    // 先填一个与解不同但合法的数字，确认清除能撤掉
    const other = legalDigitsAt(state, index).find((digit) => digit !== value)!
    let next = act(act(state, { type: 'select', index }), { type: 'set', value: other })
    expect(next.filled[index]).toBe(other)
    next = act(next, { type: 'clear' })
    expect(next.filled[index]).toBe(0)
    for (const cell of givenCells(state)) expect(next.filled[cell]).toBe(state.given[cell])
  })

  it('清空一个已经空的格子是空操作，不报错', () => {
    const state = fresh()
    const index = emptyCells(state)[0]!
    const selected = act(state, { type: 'select', index })
    expect(act(selected, { type: 'clear' })).toBe(selected)
  })

  it('改题目给定格抛错（set 与 clear 都拒）', () => {
    const state = fresh()
    const given = givenCells(state)[0]!
    const selected = act(state, { type: 'select', index: given })
    expect(() => act(selected, { type: 'set', value: 1 })).toThrow(IllegalActionError)
    expect(() => act(selected, { type: 'clear' })).toThrow(IllegalActionError)
  })

  it('未选中格子就填/清 → 抛错', () => {
    const state = fresh()
    expect(() => act(state, { type: 'set', value: 5 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'clear' })).toThrow(IllegalActionError)
  })

  it('格子已满再填 → 抛错', () => {
    const state = fresh()
    const index = emptyCells(state)[0]!
    const filled = act(act(state, { type: 'select', index }), { type: 'set', value: state.solution[index]! })
    expect(() => act(filled, { type: 'set', value: state.solution[index]! })).toThrow(IllegalActionError)
  })

  it('数字越界 → 抛错', () => {
    const state = act(fresh(), { type: 'select', index: emptyCells(fresh())[0]! })
    expect(() => act(state, { type: 'set', value: 0 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'set', value: 10 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'set', value: 1.5 })).toThrow(IllegalActionError)
  })

  it('非法动作不会改变原状态（纯函数）', () => {
    const state = fresh()
    const snapshot = Array.from(state.filled)
    expect(() => act(state, { type: 'set', value: 5 })).toThrow(IllegalActionError)
    expect(Array.from(state.filled)).toEqual(snapshot)
    expect(state.selected).toBeNull()
  })
})

describe('行 / 列 / 宫冲突检测', () => {
  it('与同行/同列/同宫已有数字重复的填入被拒绝', () => {
    const state = fresh()
    let checked = 0
    let sawRow = false
    let sawCol = false
    let sawBox = false
    for (const index of emptyCells(state)) {
      const allowed = new Set(legalDigitsAt(state, index))
      for (let value = 1; value <= 9; value++) {
        if (allowed.has(value)) continue
        const selected = act(state, { type: 'select', index })
        expect(() => act(selected, { type: 'set', value })).toThrow(IllegalActionError)
        if (peerHas(state, index, value)) checked++
        for (let cell = 0; cell < SUDOKU_CELLS; cell++) {
          if (cell === index || state.filled[cell] !== value) continue
          if (rowOf(cell) === rowOf(index)) sawRow = true
          if (colOf(cell) === colOf(index)) sawCol = true
          if (boxOf(cell) === boxOf(index)) sawBox = true
        }
      }
    }
    // 入门档提示数很多，三种冲突一定都出现过
    expect(checked).toBeGreaterThan(0)
    expect(sawRow).toBe(true)
    expect(sawCol).toBe(true)
    expect(sawBox).toBe(true)
  })

  it('legalDigitsAt 与「同行/列/宫已用数字」互补', () => {
    const state = fresh()
    for (const index of emptyCells(state).slice(0, 20)) {
      const allowed = new Set(legalDigitsAt(state, index))
      const used = new Set<number>()
      for (let cell = 0; cell < SUDOKU_CELLS; cell++) {
        const value = state.filled[cell]!
        if (value === 0) continue
        if (
          rowOf(cell) === rowOf(index) ||
          colOf(cell) === colOf(index) ||
          boxOf(cell) === boxOf(index)
        ) {
          used.add(value)
        }
      }
      for (let value = 1; value <= 9; value++) {
        expect(allowed.has(value)).toBe(!used.has(value))
      }
    }
  })

  it('已填格子的候选为空', () => {
    const state = fresh()
    const given = givenCells(state)[0]!
    expect(legalDigitsAt(state, given)).toEqual([])
  })

  it('legal() 不含冲突数字，含当前格全部合法数字', () => {
    const state = fresh()
    const index = emptyCells(state)[0]!
    const selected = act(state, { type: 'select', index })
    const allowed = legalActions(selected)
    const digits = allowed.filter(
      (action): action is { type: 'set'; value: number } => action.type === 'set',
    )
    expect(new Set(digits.map((action) => action.value))).toEqual(new Set(legalDigitsAt(selected, index)))
    for (const action of digits) {
      expect(() => act(selected, action)).not.toThrow()
    }
  })

  it('legal() 覆盖全部 81 个选中动作', () => {
    const actions = legalActions(fresh())
    const selects = actions.filter((action) => action.type === 'select')
    expect(selects).toHaveLength(SUDOKU_CELLS)
  })
})

/** 该格是否与同行/同列/同宫里已有的这个数字冲突 */
function peerHas(state: SudokuState, index: number, value: number): boolean {
  for (let cell = 0; cell < SUDOKU_CELLS; cell++) {
    if (cell === index || state.filled[cell] !== value) continue
    if (rowOf(cell) === rowOf(index) || colOf(cell) === colOf(index) || boxOf(cell) === boxOf(index)) {
      return true
    }
  }
  return false
}

describe('胜负判定', () => {
  it('初始状态是 playing，且已填数等于提示数', () => {
    const state = fresh()
    expect(sudokuGame.status(state)).toBe('playing')
    let clues = 0
    for (let index = 0; index < SUDOKU_CELLS; index++) if (state.given[index] !== 0) clues++
    expect(state.filled.filter((value) => value !== 0)).toHaveLength(clues)
  })

  it('填到一半仍是 playing', () => {
    let state = fresh()
    const empties = emptyCells(state)
    for (const index of empties.slice(0, Math.floor(empties.length / 2))) {
      const value = state.solution[index]!
      state = act(act(state, { type: 'select', index }), { type: 'set', value })
    }
    expect(sudokuGame.status(state)).toBe('playing')
  })

  it('全部填满且与解一致 → won', () => {
    const state = solveAll(fresh())
    expect(sudokuGame.status(state)).toBe('won')
  })

  it('填错一个数字（不冲突）不会 won，且与解不一致', () => {
    const state = fresh()
    // 找一个答案数字不在同行/列/宫的数字，填错也不冲突
    let target = -1
    for (const index of emptyCells(state)) {
      const wrong = legalDigitsAt(state, index).find((digit) => digit !== state.solution[index])
      if (wrong !== undefined) {
        target = index
        break
      }
    }
    expect(target).toBeGreaterThanOrEqual(0)
    const wrong = legalDigitsAt(state, target).find((digit) => digit !== state.solution[target])!
    const next = act(act(state, { type: 'select', index: target }), { type: 'set', value: wrong })
    expect(next.filled[target]).toBe(wrong)
    expect(sudokuGame.status(next)).toBe('playing')
  })

  it('缺少任一格都不会 won', () => {
    let state = fresh()
    const empties = emptyCells(state)
    for (const index of empties.slice(0, -1)) {
      const value = state.solution[index]!
      state = act(act(state, { type: 'select', index }), { type: 'set', value })
    }
    expect(sudokuGame.status(state)).toBe('playing')
  })

  it('填满全部格子后 selected 仍可继续选中（不因胜利而锁死）', () => {
    const state = solveAll(fresh())
    expect(() => act(state, { type: 'select', index: 0 })).not.toThrow()
  })
})

describe('胜局的可达性', () => {
  it('用合法动作序列能真正走到 won', () => {
    let state = fresh()
    for (const index of emptyCells(state)) {
      state = reduceSudoku(state, sudokuGame.selectAction!(state, index)!)
      state = reduceSudoku(state, { type: 'set', value: state.solution[index]! })
    }
    // 状态确实变化：filled 与 given 不同
    expect(state.filled).not.toEqual(state.given)
    expect(sudokuGame.status(state)).toBe('won')
  })
})
