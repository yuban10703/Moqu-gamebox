/**
 * 测试专用工具：ASCII 摆盘、构造状态、推进两拍应手。
 * 摆盘用 FEN 风格的行（大写=白、小写=黑、数字=连续空格），8 行从上到下。
 */
import {
  BLACK,
  CASTLE_ALL,
  CELLS,
  EMPTY,
  WHITE,
  createInitialBoard,
  indexOf,
  legalActions,
  reduceChess,
  type Piece,
  type Side,
} from '../src/index.js'

/** 8 行 × 8 列摆盘（大写=白、小写=黑、数字=空格数） */
export function boardOf(rows: readonly string[]): Piece[] {
  if (rows.length !== 8) throw new Error(`expected 8 rows, got ${rows.length}`)
  const board = new Array<Piece>(CELLS).fill(EMPTY)
  const types: Record<string, number> = { k: 1, q: 2, r: 3, b: 4, n: 5, p: 6 }
  for (let r = 0; r < 8; r++) {
    let col = 0
    for (const ch of rows[r]!) {
      if (ch >= '1' && ch <= '8') {
        col += Number(ch)
        continue
      }
      const type = types[ch.toLowerCase()]
      if (type === undefined) throw new Error(`bad piece char ${ch}`)
      board[indexOf(r, col)] = (ch === ch.toLowerCase() ? BLACK : WHITE) * 8 + type
      col++
    }
    if (col !== 8) throw new Error(`bad row length: ${rows[r]}`)
  }
  return board
}

export function at(row: number, col: number): number {
  return indexOf(row, col)
}

/** 直接构造一个状态（不做可达性校验；只用于终局判定/视图类测试，不用于 decode 往返） */
export function stateOf(
  board: readonly Piece[],
  side: Side,
  extra: Record<string, unknown> = {},
): import('../src/index.js').ChessState {
  return {
    difficulty: 'starter',
    seed: 7,
    board: board.slice(),
    sideToMove: side,
    moves: 0,
    rngCursor: 0,
    selected: null,
    lastMove: null,
    history: [],
    opponentPick: null,
    castling: CASTLE_ALL,
    epSquare: null,
    halfmoveClock: 0,
    repetition: [],
    ...extra,
  }
}

/** 把「黑方待应手」的中间态推进到落定（两拍 tick） */
export function settle(state: import('../src/index.js').ChessState): import('../src/index.js').ChessState {
  let current = state
  for (let guard = 0; guard < 8; guard++) {
    const tick = legalActions(current).find((action) => action.type === 'tick')
    if (!tick) break
    current = reduceChess(current, tick)
  }
  return current
}

export { createInitialBoard, EMPTY }
