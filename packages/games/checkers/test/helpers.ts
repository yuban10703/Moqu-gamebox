/**
 * 测试夹具。
 *
 * 规则层测试经常需要一个「指定局面」的状态：真实对局走不到、`decode` 又要求日志能重放，
 * 所以这里直接手写状态对象（log 为空），专门用来断言走子/吃子/连跳/升王语义。
 * 需要撤销或存档往返的测试则一律用真实对局（create + move）。
 */
import {
  BLACK,
  EMPTY,
  BLACK_KING,
  BLACK_MAN,
  WHITE_KING,
  WHITE_MAN,
  createState,
  isPlayable,
  type CheckersState,
  type DifficultyId,
  type Piece,
} from '../src/index.js'

/** 真实起始局面（白方强度由难度决定） */
export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): CheckersState {
  return createState(seed, difficulty)
}

/** 直接构造一个指定棋盘的状态；log 为空，因此不能用于 undo/decode 断言 */
export function fixtureState(
  board: readonly Piece[],
  overrides: Partial<CheckersState> = {},
): CheckersState {
  return {
    difficulty: 'starter',
    seed: 1,
    board: [...board],
    turn: BLACK,
    pendingFrom: null,
    selected: null,
    moves: 0,
    rngCursor: 0,
    noProgressPlies: 0,
    lastMove: null,
    log: [],
    ...overrides,
  }
}

export function emptyBoard(): Piece[] {
  return new Array<Piece>(64).fill(EMPTY)
}

const CHAR_TO_PIECE: Record<string, Piece> = {
  b: BLACK_MAN,
  B: BLACK_KING,
  w: WHITE_MAN,
  W: WHITE_KING,
}

/**
 * 用若干行字符串搭棋盘（不足 8 行时后面补空行）：`.` 空、`b/B` 黑兵/黑王、`w/W` 白兵/白王。
 * 浅色格上放子会立刻报错，避免手写索引时把子放到不可走的格子上。
 */
export function boardFromRows(rows: readonly string[]): Piece[] {
  if (rows.length > 8) throw new Error('boardFromRows accepts at most 8 rows')
  const board = emptyBoard()
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    if (row.length !== 8) throw new Error(`row ${r} must have 8 columns`)
    for (let c = 0; c < 8; c++) {
      const char = row[c]!
      if (char === '.') continue
      const piece = CHAR_TO_PIECE[char]
      if (piece === undefined) throw new Error(`unknown cell "${char}" at ${r},${c}`)
      const index = r * 8 + c
      if (!isPlayable(index)) throw new Error(`piece on light square at ${r},${c}`)
      board[index] = piece
    }
  }
  return board
}

/** 把棋盘打印回 8 行字符串（断言失败时便于定位） */
export function rowsOf(board: readonly Piece[]): string[] {
  const chars: Record<number, string> = {
    [BLACK_MAN]: 'b',
    [BLACK_KING]: 'B',
    [WHITE_MAN]: 'w',
    [WHITE_KING]: 'W',
  }
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    for (let c = 0; c < 8; c++) row += chars[board[r * 8 + c]!] ?? '.'
    rows.push(row)
  }
  return rows
}
