/**
 * 测试专用工具：ASCII 摆盘与「直接构造局面」。
 *
 * 注意：`fixtureState` **不做可达性校验**，因此它的 history/moves/游标可能与盘面不自洽
 * （`decode` 会拒绝这种数据）。它只服务于「构造某个局面看规则怎么走」的用例；
 * 存档往返、确定性这类用例一律走 `reversiGame.create` + `reduce` 的真实路径。
 */
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  countDiscs,
  createInitialBoard,
  placeDisc,
  type Disc,
  type ReversiState,
  type Side,
} from '../src/index.js'

const CHARS: Record<string, Disc> = { '.': EMPTY, '·': EMPTY, B: BLACK, W: WHITE }

/** 8 行 × 8 列：'.' 空、'B' 黑、'W' 白 */
export function boardOf(rows: readonly string[]): Disc[] {
  if (rows.length !== 8) throw new Error(`expected 8 rows, got ${rows.length}`)
  const board: Disc[] = []
  for (const row of rows) {
    if (row.length !== 8) throw new Error(`expected 8 columns, got ${row}`)
    for (const char of row) {
      const disc = CHARS[char]
      if (disc === undefined) throw new Error(`unknown cell char ${char}`)
      board.push(disc)
    }
  }
  return board
}

/** 盘面转 ASCII，断言失败时的可读输出 */
export function ascii(board: readonly Disc[]): string[] {
  const glyphs = ['.', 'B', 'W']
  const rows: string[] = []
  for (let row = 0; row < 8; row++) {
    rows.push(board.slice(row * 8, row * 8 + 8).map((disc) => glyphs[disc]!).join(''))
  }
  return rows
}

export function fixtureState(
  board: readonly Disc[],
  turn: Side,
  extra: Partial<ReversiState> = {},
): ReversiState {
  return {
    difficulty: 'starter',
    seed: 7,
    board,
    turn,
    rngCursor: 0,
    moves: 0,
    notice: null,
    history: [],
    ...extra,
  }
}

/**
 * 独立于生产代码的「应手校验器」：按规则重放玩家这一手之后的所有过手与白方应手。
 * 白方着法直接用 `chooseOpponentMove` 求出来，并断言它确实在合法落点里 ——
 * 这样「白方永远只下合法棋」由测试独立复核，而不是由被测代码自证。
 */
export interface OracleResult {
  board: Disc[]
  whiteMoves: number[]
  passes: number
}

export function replayOracle(
  state: ReversiState,
  index: number,
  choose: (board: readonly Disc[], cursor: number) => number | null,
): OracleResult {
  const placed = placeDisc(state.board, index, BLACK)
  if (placed === null) throw new Error(`oracle: black move ${index} is not legal`)
  let board = placed.board
  let turn: Side = WHITE
  let cursor = state.rngCursor
  const whiteMoves: number[] = []
  let passes = 0
  let guard = 0
  while (guard++ < 4 * CELLS) {
    const blackMoves = legalMoves(board, BLACK)
    const whiteMovesNow = legalMoves(board, WHITE)
    if (blackMoves.length === 0 && whiteMovesNow.length === 0) break
    if (turn === BLACK) {
      if (blackMoves.length === 0) {
        passes++
        turn = WHITE
        continue
      }
      break
    }
    if (whiteMovesNow.length === 0) {
      passes++
      turn = BLACK
      continue
    }
    const choice = choose(board, cursor)
    if (choice === null) throw new Error('oracle: opponent returned no move while moves exist')
    if (!whiteMovesNow.includes(choice)) {
      throw new Error(`oracle: opponent move ${choice} is not legal (legal: ${whiteMovesNow.join(',')})`)
    }
    const stepped = placeDisc(board, choice, WHITE)
    if (stepped === null) throw new Error('oracle: place failed')
    board = stepped.board
    whiteMoves.push(choice)
    cursor++
    turn = BLACK
  }
  return { board, whiteMoves, passes }
}

function legalMoves(board: readonly Disc[], side: Side): number[] {
  const moves: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (placeDisc(board, index, side) !== null) moves.push(index)
  }
  return moves
}

export function sameBoard(a: readonly Disc[], b: readonly Disc[]): boolean {
  return a.length === b.length && a.every((disc, index) => disc === b[index])
}

export { BLACK, CELLS, EMPTY, WHITE, countDiscs, createInitialBoard }
