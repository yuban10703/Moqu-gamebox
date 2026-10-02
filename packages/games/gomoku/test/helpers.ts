/**
 * 测试专用工具：ASCII 摆盘、构造自洽局面、独立于生产代码的连子复核。
 *
 * 注意两点：
 * 1. `stateOf` 按「回合日志」重放盘面，构造出的局面与 rules 的构造性事实一致
 *    （moves / rngCursor / lastMove 都由日志推出），因此 `decode` 会接受它；
 * 2. `hasFive` / `winnerOf` 是**独立实现**的连子判定，用于复核生产代码的胜负结论，
 *    避免「用被测实现验证被测实现」。
 */
import {
  BLACK,
  BOARD_SIZE,
  CELLS,
  EMPTY,
  WHITE,
  createEmptyBoard,
  indexOf,
  isFull,
  type GomokuState,
  type GomokuTurn,
  type Side,
  type Stone,
} from '../src/index.js'
import type { DifficultyId } from '../src/index.js'

const CHARS: Record<string, Stone> = { '.': EMPTY, '·': EMPTY, B: BLACK, W: WHITE }

/** 15 行 × 15 列：'.' 空、'B' 黑、'W' 白 */
export function boardOf(rows: readonly string[]): Stone[] {
  if (rows.length !== BOARD_SIZE) throw new Error(`expected ${BOARD_SIZE} rows, got ${rows.length}`)
  const board: Stone[] = []
  for (const row of rows) {
    if (row.length !== BOARD_SIZE) {
      throw new Error(`expected ${BOARD_SIZE} columns, got ${row.length}`)
    }
    for (const char of row) {
      const stone = CHARS[char]
      if (stone === undefined) throw new Error(`unknown cell char ${char}`)
      board.push(stone)
    }
  }
  return board
}

/** 盘面转 ASCII，断言失败时的可读输出 */
export function ascii(board: readonly Stone[]): string[] {
  const glyphs = ['.', 'B', 'W']
  const rows: string[] = []
  for (let row = 0; row < BOARD_SIZE; row++) {
    rows.push(
      board
        .slice(row * BOARD_SIZE, row * BOARD_SIZE + BOARD_SIZE)
        .map((stone) => glyphs[stone]!)
        .join(''),
    )
  }
  return rows
}

export function emptyBoard(): Stone[] {
  return createEmptyBoard()
}

export function at(row: number, col: number): number {
  return indexOf(row, col)
}

/** 与生产代码独立的四条轴表 */
const AXES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]

/** 独立实现的连子判定：index 处是 side 的子时是否连成 5 个以上 */
export function hasFive(board: readonly Stone[], index: number, side: Side): boolean {
  const row = Math.floor(index / BOARD_SIZE)
  const col = index % BOARD_SIZE
  for (const [dr, dc] of AXES) {
    let count = 1
    for (const sign of [1, -1]) {
      let r = row + sign * dr
      let c = col + sign * dc
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r * BOARD_SIZE + c] === side) {
        count++
        r += sign * dr
        c += sign * dc
      }
    }
    if (count >= 5) return true
  }
  return false
}

/** 独立实现的胜负判定：盘面上先找到谁的 5 连 */
export function winnerOf(board: readonly Stone[]): Side | null {
  for (let index = 0; index < CELLS; index++) {
    const stone = board[index]
    if (stone === EMPTY) continue
    if (hasFive(board, index, stone)) return stone
  }
  return null
}

export function isFullBoard(board: readonly Stone[]): boolean {
  return board.every((stone) => stone !== EMPTY)
}

export function countOf(board: readonly Stone[], side: Side): number {
  let count = 0
  for (const stone of board) if (stone === side) count++
  return count
}

/** 到最近棋子的切比雪夫距离；盘面为空时返回 Infinity */
export function distanceToNearestStone(board: readonly Stone[], index: number): number {
  return distanceToNearestSide(board, index, null)
}

/** 到最近某一方棋子的切比雪夫距离（side 为 null 表示任意一方）；没有该方棋子时返回 Infinity */
export function distanceToNearestSide(
  board: readonly Stone[],
  index: number,
  side: Side | null,
): number {
  const row = Math.floor(index / BOARD_SIZE)
  const col = index % BOARD_SIZE
  let best = Infinity
  for (let other = 0; other < CELLS; other++) {
    const stone = board[other]
    if (stone === EMPTY) continue
    if (side !== null && stone !== side) continue
    const otherRow = Math.floor(other / BOARD_SIZE)
    const otherCol = other % BOARD_SIZE
    const distance = Math.max(Math.abs(otherRow - row), Math.abs(otherCol - col))
    if (distance < best) best = distance
  }
  return best
}

export interface PlacementDiff {
  black: number[]
  white: number[]
}

/** 两次 reduce 之间新落下的子（按颜色分开），用于独立复核「黑一手 + 白一手」 */
export function diffPlaced(before: readonly Stone[], after: readonly Stone[]): PlacementDiff {
  const black: number[] = []
  const white: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (before[index] !== EMPTY || after[index] === EMPTY) continue
    if (after[index] === BLACK) black.push(index)
    else white.push(index)
  }
  return { black, white }
}

/**
 * 由回合日志构造自洽局面：棋盘 / 步数 / 游标 / 最后一手都由日志推出，
 * 因此它是「rules 真实会产生的那类状态」，decode 会接受。
 */
export function stateOf(turns: readonly GomokuTurn[], extra: Partial<GomokuState> = {}): GomokuState {
  const board = createEmptyBoard()
  let whiteCount = 0
  let lastMove: number | null = null
  for (const turn of turns) {
    board[turn.black] = BLACK
    lastMove = turn.black
    if (turn.white !== null) {
      board[turn.white] = WHITE
      whiteCount++
      lastMove = turn.white
    }
  }
  return {
    difficulty: 'starter',
    seed: 7,
    board,
    moves: turns.length,
    rngCursor: whiteCount,
    lastMove,
    history: turns,
    ...extra,
  }
}

/** 玩家当前可落点（等价于规则层的 place 动作集合） */
export function playerMoves(state: GomokuState): number[] {
  const moves: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (state.board[index] === EMPTY) moves.push(index)
  }
  return moves
}

/**
 * 无五连填充图案：`(row*2 + col) % 4 < 2` 时黑、否则白。
 * 四个方向上的同色连续段都不超过 2，因此整盘填满也不会出现五连（可用来测平局）。
 */
function patternStone(row: number, col: number): Stone {
  return (row * 2 + col) % 4 < 2 ? BLACK : WHITE
}

export function fillNoFiveBoard(): Stone[] {
  const board = createEmptyBoard()
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      board[indexOf(row, col)] = patternStone(row, col)
    }
  }
  return board
}

/**
 * 构造一个「中盘/残局」自洽局面：按无五连图案铺 N 回合（黑 N 手 + 白 N 手），
 * 盘面密但没有任何五连，适合测 AI 性能与前瞻层数。
 */
export function crowdedState(turns: number, difficulty: DifficultyId = 'starter'): GomokuState {
  const blacks: number[] = []
  const whites: number[] = []
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const index = indexOf(row, col)
      if (patternStone(row, col) === BLACK) blacks.push(index)
      else whites.push(index)
    }
  }
  const log: GomokuTurn[] = []
  for (let position = 0; position < turns; position++) {
    log.push({ black: blacks[position]!, white: whites[position]! })
  }
  return stateOf(log, { difficulty })
}

export { BLACK, BOARD_SIZE, CELLS, EMPTY, WHITE, createEmptyBoard, indexOf, isFull }
