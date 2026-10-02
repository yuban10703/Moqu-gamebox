/**
 * 测试夹具。
 *
 * 规则层之外的测试经常需要一个「指定盘面」的状态：走真实的 `create`（打乱）拿不到想要的形状，
 * 走 `decode` 又要满足一堆存档不变量。这里直接手写状态对象，专门用来断言滑动语义。
 */
import { configFor, type DifficultyId } from '../src/board.js'
import { createState, type FifteenState } from '../src/rules.js'

/** 由棋盘长度反推难度（3×3 / 4×4 / 5×5） */
export function difficultyOfBoard(board: readonly number[]): DifficultyId {
  const size = Math.round(Math.sqrt(board.length))
  if (size === 3) return 'starter'
  if (size === 4) return 'skilled'
  if (size === 5) return 'challenging'
  throw new Error(`unsupported board size ${size}`)
}

export function fixtureState(
  board: readonly number[],
  overrides: Partial<FifteenState> = {},
): FifteenState {
  const difficulty = overrides.difficulty ?? difficultyOfBoard(board)
  return {
    difficulty,
    seed: 1,
    rngCursor: 0,
    board: [...board],
    moves: 0,
    history: [],
    ...overrides,
  }
}

/** 真实初始局面（走过打乱），用于撤销/重开这类需要合法存档的断言 */
export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): FifteenState {
  return createState(seed, difficulty)
}

/** 棋盘尺寸（断言里反复用，避免各处重复查表） */
export function sizeOf(difficulty: DifficultyId): number {
  return configFor(difficulty).size
}
