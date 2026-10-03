/**
 * 展示模型：把局面翻译成「与呈现技术无关」的棋盘与控制项描述。
 * 墨水屏 1-bit：数字用文字，题目给定格与玩家填入格靠 `kind`（given / tile）区分描边，
 * 不依赖灰阶；填错的数字加 `×` 前缀做形状区分。
 */
import type { BoardView, CellKind, CellView, ControlSpec, GameView } from '@eink/core'
import { SUDOKU_CELLS, SUDOKU_SIZE } from './solver.js'
import { CHALLENGE_DIFFICULTY, clueCount, filledCount, isSolved, type SudokuState } from './rules.js'

/**
 * 填错（合法但不符合唯一解）的标记。
 * 曾经做成文字前缀 `×6`；现在改为在格子上画 1px 的叉覆盖住数字（见 CellView.wrong），
 * 数字本身保持整齐。这个常量保留给无障碍文案与测试用。
 */
export const WRONG_MARK = '×'

export function cellKindAt(state: SudokuState, index: number): CellKind {
  if (state.given[index] !== 0) return 'given'
  if (state.filled[index] !== 0) return 'tile'
  return 'empty'
}

export function cellGlyph(state: SudokuState, index: number): string {
  const value = state.filled[index]!
  if (value === 0) return ''
  return String(value)
}

export function buildBoard(state: SudokuState): BoardView {
  const cells: CellView[] = []
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    const kind = cellKindAt(state, index)
    const cell: CellView = {
      index,
      kind,
      glyph: cellGlyph(state, index),
      /*
       * 填错：合法但与唯一解不符 → 交给壳层在格子上画 1px 的叉。
       * **挑战档不打标记**（用户要求）：那一档是纯数独，填什么都由玩家自己判断。
       */
      ...(state.difficulty !== CHALLENGE_DIFFICULTY &&
      cellKindAt(state, index) === 'tile' &&
      state.filled[index] !== 0 &&
      state.filled[index] !== state.solution[index]
        ? { wrong: true }
        : {}),
      // 题目给定 vs 玩家填入：字号 + 字重双重区分（见 styles.css）。
      // 只靠字重不够明显，字号差异在墨水屏上一眼可辨 —— 这也是纸面数独的通行做法
      // （印刷体的题目数字大，自己写的数字小）。
      ...(kind === 'given' ? { textScale: 0.74 } : {}),
      ...(kind === 'tile' ? { textScale: 0.5 } : {}),
    }
    if (state.selected === index) cell.selected = true
    cells.push(cell)
  }
  // 3×3 宫：壳层据此画更粗的宫线（否则 9×9 里所有线一样细，结构不清）
  return { kind: 'grid', cols: SUDOKU_SIZE, rows: SUDOKU_SIZE, cells, groups: { cols: 3, rows: 3 } }
}

/**
 * 控制项：9 个数字键 + 清除。
 * 没选中空格时数字键 `enabled: false`（点了不会产生任何效果，干脆禁用）；
 * 「始终可点、走不通给文字反馈」的规则适用于方向盘，不适用于数字键。
 */
export function buildControls(state: SudokuState): ControlSpec[] {
  const controls: ControlSpec[] = []
  /*
   * 只要选中的是**可编辑的格子**，数字键就可用 —— 包括"已经填过数字"的格子。
   *
   * 这里原先额外要求 `filled === 0`，于是填上一个数字后所有数字键都被禁用，
   * 用户反馈："输入数字后，别的数字按键就不能按了"（规则层其实已经允许覆盖，
   * 卡住的是这个可用性判断）。题目给定格仍然禁用。
   */
  const canFill = state.selected !== null && state.given[state.selected] === 0
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
  controls.push({
    id: 'undo',
    labelKey: 'shell.game.undo',
    role: 'action',
    // 有过一次填入/清除就可撤销；光标（selected）不随撤销回退，撤完可以直接接着填
    enabled: state.history.length > 0,
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
    // 统计文案不带插值参数：壳层对 labelKey 只做 t()。
    // 只保留「已填 x/81」一项：总数已含在分母里（原「总格数 81」是常量），
    // 而「空格数」= 81 − 已填，是同一信息的另一种说法 —— 冗余项会让统计栏多占一行、
    // 在窄屏上直接压缩棋盘高度。
    stats: [{ labelKey: 'sudoku.stat.filled', value: `${filled}/${SUDOKU_CELLS}` }],
    result: solved ? { titleKey: 'sudoku.result.title', details } : null,
    notice: extras.noticeKey ? { textKey: extras.noticeKey } : null,
  }
}
