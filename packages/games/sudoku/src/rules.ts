/**
 * 状态派生与动作执行（纯函数）。
 *
 * 单独成文件是为了避免 `index.ts`（GameDef 装配）与 `view.ts`（展示模型）
 * 互相 import 形成循环依赖。
 */
import { IllegalActionError } from '@eink/core'
import { SUDOKU_CELLS, SUDOKU_SIZE, boxOf, colOf, rowOf, type Grid } from './solver.js'
import { SUDOKU_ID, type DifficultyId } from './generate.js'

export type SudokuAction =
  /** 点第 index 个格子（行优先）。点给定格也允许，只改选中项 */
  | { type: 'select'; index: number }
  /** 往选中格填入 value（1..9） */
  | { type: 'set'; value: number }
  /** 清除选中格（只清玩家填的，清不掉题目给定格） */
  | { type: 'clear' }

export interface SudokuState {
  difficulty: DifficultyId
  /** 题目：0 表示空格，1..9 为给定值 */
  given: Grid
  /** 唯一解（题目数据的一部分，必须存进状态） */
  solution: Grid
  /** 当前盘面：给定值 + 玩家填入 */
  filled: Grid
  /** 当前选中的格子索引，未选中为 null */
  selected: number | null
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(SUDOKU_ID, reason)
}

/** 某格当前可以合法填入的数字（行/列/宫都不冲突）；已有数字的格子返回空数组 */
export function legalDigitsAt(state: SudokuState, index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= SUDOKU_CELLS) return []
  if (state.filled[index] !== 0) return []
  const row = rowOf(index)
  const col = colOf(index)
  const box = boxOf(index)
  const used = new Set<number>()
  for (let cell = 0; cell < SUDOKU_CELLS; cell++) {
    const value = state.filled[cell]!
    if (value === 0) continue
    if (rowOf(cell) === row || colOf(cell) === col || boxOf(cell) === box) used.add(value)
  }
  const out: number[] = []
  for (let value = 1; value <= SUDOKU_SIZE; value++) if (!used.has(value)) out.push(value)
  return out
}

/** 填入的格子是否与所在行/列/宫冲突（decode 时要防坏存档带冲突盘面） */
export function hasConflict(state: SudokuState, index: number): boolean {
  const value = state.filled[index]!
  if (value === 0) return false
  for (let cell = 0; cell < SUDOKU_CELLS; cell++) {
    if (cell === index) continue
    if (state.filled[cell] !== value) continue
    const sameLine =
      rowOf(cell) === rowOf(index) || colOf(cell) === colOf(index) || boxOf(cell) === boxOf(index)
    if (sameLine) return true
  }
  return false
}

/** 已填格数（含题目给定格） */
export function filledCount(state: SudokuState): number {
  let count = 0
  for (let index = 0; index < SUDOKU_CELLS; index++) if (state.filled[index] !== 0) count++
  return count
}

export function emptyCount(state: SudokuState): number {
  return SUDOKU_CELLS - filledCount(state)
}

/** 题目给定的提示数 */
export function clueCount(state: SudokuState): number {
  let count = 0
  for (let index = 0; index < SUDOKU_CELLS; index++) if (state.given[index] !== 0) count++
  return count
}

/** 与唯一解完全一致才算赢（题目唯一解，所以等价于「无冲突地填满全部格子」） */
export function isSolved(state: SudokuState): boolean {
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    if (state.filled[index] !== state.solution[index]) return false
  }
  return true
}

export function reduceSudoku(state: SudokuState, action: SudokuAction): SudokuState {
  switch (action.type) {
    case 'select': {
      const index = action.index
      if (!Number.isInteger(index) || index < 0 || index >= SUDOKU_CELLS) {
        throw illegal(`sudoku.illegal.select:${String(index)}`)
      }
      if (state.selected === index) return state
      return { ...state, selected: index }
    }
    case 'set': {
      const value = action.value
      if (!Number.isInteger(value) || value < 1 || value > SUDOKU_SIZE) {
        throw illegal(`sudoku.illegal.value:${String(value)}`)
      }
      const index = state.selected
      if (index === null) throw illegal('sudoku.illegal.noselect')
      if (state.given[index] !== 0) throw illegal(`sudoku.illegal.given:${index}`)
      if (state.filled[index] !== 0) throw illegal(`sudoku.illegal.occupied:${index}`)
      if (!legalDigitsAt(state, index).includes(value)) {
        // 行/列/宫冲突：明确拒绝，而不是让盘面进入矛盾态
        throw illegal(`sudoku.illegal.conflict:${index}=${value}`)
      }
      const filled = state.filled.slice()
      filled[index] = value
      return { ...state, filled }
    }
    case 'clear': {
      const index = state.selected
      if (index === null) throw illegal('sudoku.illegal.noselect')
      if (state.given[index] !== 0) throw illegal(`sudoku.illegal.given:${index}`)
      if (state.filled[index] === 0) return state // 已经是空的：无事发生，不算非法
      const filled = state.filled.slice()
      filled[index] = 0
      return { ...state, filled }
    }
    default: {
      // 运行期拿到未知动作（例如旧版本存档）时明确报错
      throw illegal(`sudoku.illegal.action:${String((action as { type?: unknown }).type)}`)
    }
  }
}

export function legalActions(state: SudokuState): SudokuAction[] {
  const actions: SudokuAction[] = []
  for (let index = 0; index < SUDOKU_CELLS; index++) actions.push({ type: 'select', index })
  const index = state.selected
  if (index !== null && state.given[index] === 0) {
    if (state.filled[index] === 0) {
      for (const value of legalDigitsAt(state, index)) actions.push({ type: 'set', value })
    } else {
      actions.push({ type: 'clear' })
    }
  }
  return actions
}
