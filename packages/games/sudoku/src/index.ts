/**
 * 数独的 GameDef 实现。
 *
 * 与推箱子的一致点：状态不可变、`reduce` 纯函数、非法动作抛 `IllegalActionError`、
 * `encode`/`decode` 严格往返。
 * 数独特有的两点：
 * - `create(seed, difficultyId)` 必须确定性生成题目（同 seed 同难度同题）；
 * - 题目（given 掩码）与唯一解都存进状态，`decode` 只做校验、绝不重新生成。
 */
import { IllegalActionError, type GameDef, type GameStatus } from '@eink/core'
import {
  CLUE_TARGETS,
  DIFFICULTY_IDS,
  SUDOKU_ID,
  asDifficulty,
  difficultyLabelKey,
  generatePuzzle,
  type DifficultyId,
} from './generate.js'
import {
  legalActions,
  reduceSudoku,
  type SudokuAction,
  type SudokuState,
} from './rules.js'
import { SUDOKU_CELLS, SUDOKU_SIZE, countSolutions, gridFromArray, gridToArray } from './solver.js'
import { buildControls, buildView } from './view.js'

export { sudokuEn, sudokuZh } from './i18n.js'
export {
  CLUE_TARGETS,
  DIFFICULTY_IDS,
  SUDOKU_ID,
  asDifficulty,
  difficultyLabelKey,
  generatePuzzle,
  type DifficultyId,
  type Puzzle,
} from './generate.js'
export {
  SUDOKU_CELLS,
  SUDOKU_MIN_CLUES,
  SUDOKU_SIZE,
  boxOf,
  checkUnique,
  colOf,
  countSolutions,
  createGrid,
  gridFromArray,
  gridToArray,
  isComplete,
  isConsistent,
  isUnique,
  rowOf,
  solve,
  solveBySingles,
  type Grid,
  type UniquenessCheck,
} from './solver.js'
export {
  clueCount,
  emptyCount,
  filledCount,
  hasConflict,
  isSolved,
  legalActions,
  legalDigitsAt,
  reduceSudoku,
  type SudokuAction,
  type SudokuState,
} from './rules.js'
export { WRONG_MARK, buildBoard, buildControls, buildView, cellGlyph, cellKindAt } from './view.js'

export const SUDOKU_RULES_VERSION = 1
export const SUDOKU_CONTENT_VERSION = 1

export function createSudokuState(seed: number, difficulty: DifficultyId): SudokuState {
  const puzzle = generatePuzzle(seed, difficulty)
  return {
    difficulty,
    given: puzzle.given,
    solution: puzzle.solution,
    filled: puzzle.given.slice(),
    selected: null,
  }
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(SUDOKU_ID, reason)
}

function assertCellArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== SUDOKU_CELLS) {
    throw illegal(`sudoku.illegal.state:${label}`)
  }
  for (const cell of value) {
    if (!Number.isInteger(cell) || (cell as number) < 0 || (cell as number) > SUDOKU_SIZE) {
      throw illegal(`sudoku.illegal.state:${label}`)
    }
  }
  return value as number[]
}

/** 提示数目标（给规则层/壳层查表用，避免壳层硬编码难度信息） */
export function clueTargetFor(difficulty: DifficultyId): number {
  return CLUE_TARGETS[difficulty]
}

export const sudokuGame: GameDef<SudokuState, SudokuAction> = {
  id: SUDOKU_ID,
  rulesVersion: SUDOKU_RULES_VERSION,
  contentVersion: SUDOKU_CONTENT_VERSION,
  i18nNamespace: 'sudoku',
  illegalNoticeKey: 'sudoku.illegal.notice',
  difficulties: DIFFICULTY_IDS.map((id) => ({ id, labelKey: difficultyLabelKey(id) })),

  create(seed: number, difficultyId: string): SudokuState {
    return createSudokuState(seed, asDifficulty(difficultyId))
  },

  reduce(state: SudokuState, action: SudokuAction): SudokuState {
    return reduceSudoku(state, action)
  },

  legal(state: SudokuState): readonly SudokuAction[] {
    return legalActions(state)
  },

  selectAction(_state: SudokuState, index: number): SudokuAction | null {
    // 越界返回 null（不可点）；给定格也返回 select，只改选中项，不报错
    if (!Number.isInteger(index) || index < 0 || index >= SUDOKU_CELLS) return null
    return { type: 'select', index }
  },

  status(state: SudokuState): GameStatus {
    // 与唯一解逐格比较：题目唯一解，填满且无冲突即必然相同
    for (let index = 0; index < SUDOKU_CELLS; index++) {
      if (state.filled[index] !== state.solution[index]) return 'playing'
    }
    return 'won'
  },

  view(state: SudokuState) {
    return buildView(state)
  },

  controls(state: SudokuState) {
    return buildControls(state)
  },

  /**
   * 数字键与清除键由游戏自己说明派发什么动作。
   * 壳层只负责把 role:'action' 的控件渲染成按钮并回调这里（它不该知道任何玩法）。
   */
  controlAction(_state: SudokuState, controlId: string): SudokuAction | null {
    if (controlId === 'clear') return { type: 'clear' }
    const match = /^digit-([1-9])$/.exec(controlId)
    if (!match) return null
    return { type: 'set', value: Number(match[1]) }
  },

  /** 无关卡玩法：用难度作为内容 id，这样通关记录与「继续」定位都按难度归类 */
  contentId(state: SudokuState): string {
    return state.difficulty
  },

  encode(state: SudokuState): unknown {
    return {
      difficulty: state.difficulty,
      given: gridToArray(state.given),
      solution: gridToArray(state.solution),
      filled: gridToArray(state.filled),
      selected: state.selected,
    }
  },

  decode(raw: unknown): SudokuState {
    if (!raw || typeof raw !== 'object') throw illegal('sudoku.illegal.state:root')
    const value = raw as Partial<{
      difficulty: unknown
      given: unknown
      solution: unknown
      filled: unknown
      selected: unknown
    }>
    const difficulty = asDifficulty(String(value.difficulty ?? ''))
    const given = assertCellArray(value.given, 'given')
    const solution = assertCellArray(value.solution, 'solution')
    const filled = assertCellArray(value.filled, 'filled')
    const selected = value.selected
    if (selected !== null && selected !== undefined) {
      if (
        !Number.isInteger(selected) ||
        (selected as number) < 0 ||
        (selected as number) >= SUDOKU_CELLS
      ) {
        throw illegal('sudoku.illegal.state:selected')
      }
    }
    for (let index = 0; index < SUDOKU_CELLS; index++) {
      // 给定值必须在解里对得上，否则存档自相矛盾
      if (given[index] !== 0 && given[index] !== solution[index]) {
        throw illegal(`sudoku.illegal.state:given-vs-solution:${index}`)
      }
      // 玩家盘面不能改题目给定格
      if (given[index] !== 0 && filled[index] !== given[index]) {
        throw illegal(`sudoku.illegal.state:overwrite-given:${index}`)
      }
      // 玩家填的值必须与解一致：解唯一，填错一定走不到终局
      if (given[index] === 0 && filled[index] !== 0 && filled[index] !== solution[index]) {
        throw illegal(`sudoku.illegal.state:wrong-digit:${index}`)
      }
    }
    const state: SudokuState = {
      difficulty,
      given: gridFromArray(given),
      solution: gridFromArray(solution),
      filled: gridFromArray(filled),
      selected: selected === undefined ? null : (selected as number | null),
    }
    // 题目数据必须仍然是一道唯一解的题；坏存档在这里就会被拒
    if (countSolutions(state.given, 2) !== 1) {
      throw illegal('sudoku.illegal.state:not-unique')
    }
    return state
  },
}
