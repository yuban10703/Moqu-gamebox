/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 * 墨水屏 1-bit：数字用文字，题目给定格与玩家填入格靠 `kind`（given / tile）区分描边，
 * 不依赖灰阶；填错的数字加 `×` 前缀做形状区分。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView } from '@eink/core'
import { SUDOKU_CELLS, SUDOKU_SIZE } from './solver.js'
import { clueCount, emptyCount, filledCount, isSolved, type SudokuState } from './rules.js'

/** 填错（合法但不符合唯一解）的标记：形状区分，不靠灰度 */
export const WRONG_MARK = '×'

export function cellKindAt(state: SudokuState, index: number): CellKind {
  if (state.given[index] !== 0) return 'given'
  if (state.filled[index] !== 0) return 'tile'
  return 'empty'
}

export function cellGlyph(state: SudokuState, index: number): string {
  const value = state.filled[index]!
  if (value === 0) return ''
  if (state.given[index] === 0 && value !== state.solution[index]) return `${WRONG_MARK}${value}`
  return String(value)
}

export function buildBoard(state: SudokuState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    const cell: CellView = {
      index,
      kind: cellKindAt(state, index),
      glyph: cellGlyph(state, index),
    }
    if (state.selected === index) cell.selected = true
    cells.push(cell)
  }
  return { kind: 'grid', cols: SUDOKU_SIZE, rows: SUDOKU_SIZE, cells }
}

/**
 * 控制项：9 个数字键 + 清除。
 * 没选中空格时数字键 `enabled: false`（点了不会产生任何效果，干脆禁用）；
 * 「始终可点、走不通给文字反馈」的规则适用于方向盘，不适用于数字键。
 */
export function buildControls(state: SudokuState): ControlSpec[] {
  const controls: ControlSpec[] = []
  const canFill =
    state.selected !== null &&
    state.given[state.selected] === 0 &&
    state.filled[state.selected] === 0
  for (let value = 1; value <= SUDOKU_SIZE; value++) {
    controls.push({
      id: `digit-${value}`,
      // 每个数字一个 key：壳层只做 t(labelKey)，不传插值参数
      labelKey: `sudoku.digit.${value}`,
      role: 'action',
      enabled: canFill,
      emphasis: 'normal',
    })
  }
  controls.push({
    id: 'clear',
    labelKey: 'sudoku.action.clear',
    role: 'action',
    enabled:
      state.selected !== null &&
      state.given[state.selected] === 0 &&
      state.filled[state.selected] !== 0,
    emphasis: 'normal',
  })
  return controls
}

export interface SudokuViewExtras {
  /** 额外提示文字 key（例如非法输入的反馈） */
  noticeKey?: string | undefined
}

export function buildView(state: SudokuState, extras: SudokuViewExtras = {}): GameView {
  const filled = filledCount(state)
  const solved = isSolved(state)
  const details: Array<{ key: string; params?: Record<string, string | number> }> = []
  if (solved) {
    details.push({ key: 'sudoku.result.detail', params: { count: SUDOKU_CELLS } })
    details.push({ key: 'sudoku.result.clues', params: { count: clueCount(state) } })
  }
  return {
    board: buildBoard(state),
    // 统计文案不带插值参数：壳层对 labelKey 只做 t()
    stats: [
      { labelKey: 'sudoku.stat.filled', value: `${filled}/${SUDOKU_CELLS}` },
      { labelKey: 'sudoku.stat.total', value: String(SUDOKU_CELLS) },
      { labelKey: 'sudoku.stat.empty', value: String(emptyCount(state)) },
    ],
    result: solved ? { titleKey: 'sudoku.result.title', details } : null,
    notice: extras.noticeKey ? { textKey: extras.noticeKey } : null,
  }
}
