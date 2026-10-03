/**
 * 状态派生与动作执行（纯函数）。
 *
 * 单独成文件是为了避免 `index.ts`（GameDef 装配）与 `view.ts`（展示模型）
 * 互相 import 形成循环依赖。
 */
import { IllegalActionError } from '@eink/core'
import { SUDOKU_CELLS, SUDOKU_SIZE, boxOf, colOf, rowOf, type Grid } from './solver.js'
import { SUDOKU_ID, type DifficultyId } from './generate.js'

/** 挑战档：不加任何辅助 —— 不拦冲突、不打标记 */
export const CHALLENGE_DIFFICULTY: DifficultyId = 'challenging'

export type SudokuAction =
  /** 点第 index 个格子（行优先）。点给定格也允许，只改选中项 */
  | { type: 'select'; index: number }
  /** 往选中格填入 value（1..9） */
  | { type: 'set'; value: number }
  /** 清除选中格（只清玩家填的，清不掉题目给定格） */
  | { type: 'clear' }
  /** 撤销上一次填入 / 清除（含"直接覆盖已填格"）；没有可撤销的动作时明确抛错 */
  | { type: 'undo' }

/**
 * 一条「逆操作」：撤销时把这一格恢复成动作之前的值。
 * 存逆操作而不是整盘快照：9×9 每步 81 个数字，快照栈会让存档白胖一大圈。
 * `selected`（光标）不属于棋步，撤销不回退它 —— 玩家撤销后通常想立刻改填另一个数字。
 */
export interface SudokuUndoEntry {
  readonly index: number
  /** 动作之前该格的值（0 = 空） */
  readonly previous: number
}

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
  /** 撤销栈：每次被接受的填入 / 清除压入一条逆操作 */
  history: readonly SudokuUndoEntry[]
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
      /*
       * 直接改写已填的格子（用户要求："填入数字后可以直接修改，而不需要清除后再填"）。
       * 不再拒绝已填格；判冲突时要把这一格**先当作空格** ——
       * 因为 legalDigitsAt 对已填格直接返回空数组，不这么做会把任何数字都判成冲突。
       */
      const isEmpty = state.filled[index] === 0
      const forCheck: SudokuState = isEmpty
        ? state
        : { ...state, filled: state.filled.map((cell, i) => (i === index ? 0 : cell)) as SudokuState['filled'] }
      if (state.difficulty !== CHALLENGE_DIFFICULTY && !legalDigitsAt(forCheck, index).includes(value)) {
        /*
         * 行/列/宫冲突：明确拒绝，而不是让盘面进入矛盾态。
         * **挑战档例外**：那一档要的是纯数独 —— 什么数字都能填，由玩家自己负责一致性
         * （用户要求："挑战难度不加标记，什么数字都可以填进去"）。
         * 注意过关判定仍逐格比对唯一解，所以乱填不会被判过关。
         */
        throw illegal(`sudoku.illegal.conflict:${index}=${value}`)
      }
      // 填入与原来相同的数字：无事发生，也不该占一格撤销历史
      if (state.filled[index] === value) return state
      const filled = state.filled.slice()
      filled[index] = value
      const entry: SudokuUndoEntry = { index, previous: state.filled[index]! }
      return { ...state, filled, history: [...state.history, entry] }
    }
    case 'clear': {
      const index = state.selected
      if (index === null) throw illegal('sudoku.illegal.noselect')
      if (state.given[index] !== 0) throw illegal(`sudoku.illegal.given:${index}`)
      if (state.filled[index] === 0) return state // 已经是空的：无事发生，不算非法
      const filled = state.filled.slice()
      filled[index] = 0
      const entry: SudokuUndoEntry = { index, previous: state.filled[index]! }
      return { ...state, filled, history: [...state.history, entry] }
    }
    case 'undo': {
      const entry = state.history[state.history.length - 1]
      if (!entry) throw illegal('sudoku.illegal.nothing-to-undo')
      // 题目给定格永远不可写：存档被篡改出这样的逆操作时明确拒绝
      if (state.given[entry.index] !== 0) throw illegal(`sudoku.illegal.given:${entry.index}`)
      const filled = state.filled.slice()
      filled[entry.index] = entry.previous
      return { ...state, filled, history: state.history.slice(0, -1) }
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
  if (state.history.length > 0) actions.push({ type: 'undo' })
  return actions
}
