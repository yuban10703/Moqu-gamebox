/**
 * 测试专用工具：ASCII 摆盘、按回合日志构造自洽局面、独立于生产代码的四连复核。
 *
 * 注意三点：
 * 1. `stateOf` 按「回合日志」重放盘面，重放时**强制重力**（每个落点必须是该列当时的最低空格），
 *    因此构造出的局面与 rules 的构造性事实一致（moves / rngCursor / lastMove 都由日志推出），
 *    `decode` 会接受它；
 * 2. `hasFour` / `winnerOf` / `bottomIndex` 都是**独立实现**，用于复核生产代码的结论，
 *    避免「用被测实现验证被测实现」；
 * 3. `crowdedState` 铺出的盘面是「阶梯棋盘」：任何 4 个相邻格都不会同色，
 *    因此铺满也不会出现四连，可以安全地用来测 AI 性能与存档往返。
 */
import {
  BLACK,
  BOARD_COLS,
  BOARD_ROWS,
  CELLS,
  EMPTY,
  WHITE,
  createEmptyBoard,
  indexOf,
  isFull,
  landingIndex,
  colOf,
  type Connect4State,
  type Connect4Turn,
  type DifficultyId,
  type Side,
  type Stone,
} from '../src/index.js'

const CHARS: Record<string, Stone> = { '.': EMPTY, '·': EMPTY, B: BLACK, W: WHITE }

/** 6 行 × 7 列（自上而下）：'.' 空、'B' 黑、'W' 白 */
export function boardOf(rows: readonly string[]): Stone[] {
  if (rows.length !== BOARD_ROWS) throw new Error(`expected ${BOARD_ROWS} rows, got ${rows.length}`)
  const board: Stone[] = []
  for (const row of rows) {
    if (row.length !== BOARD_COLS) {
      throw new Error(`expected ${BOARD_COLS} columns, got ${row.length}`)
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
  for (let row = 0; row < BOARD_ROWS; row++) {
    rows.push(
      board
        .slice(row * BOARD_COLS, row * BOARD_COLS + BOARD_COLS)
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

/** 独立实现的四连判定：index 处是 side 的子时是否连成 4 个以上 */
export function hasFour(board: readonly Stone[], index: number, side: Side): boolean {
  const row = Math.floor(index / BOARD_COLS)
  const col = index % BOARD_COLS
  for (const [dr, dc] of AXES) {
    let count = 1
    for (const sign of [1, -1]) {
      let r = row + sign * dr
      let c = col + sign * dc
      while (
        r >= 0 &&
        r < BOARD_ROWS &&
        c >= 0 &&
        c < BOARD_COLS &&
        board[r * BOARD_COLS + c] === side
      ) {
        count++
        r += sign * dr
        c += sign * dc
      }
    }
    if (count >= 4) return true
  }
  return false
}

/** 独立实现的胜负判定：盘面上先找到谁的 4 连 */
export function winnerOf(board: readonly Stone[]): Side | null {
  for (let index = 0; index < CELLS; index++) {
    const stone = board[index]
    if (stone === EMPTY) continue
    if (hasFour(board, index, stone)) return stone
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

/**
 * 独立实现的「该列最低空格」：自上而下扫一遍，记住**最后一个**空格。
 * 生产代码自下而上找第一个空格；两种写法互为复核（而不是照抄同一种循环）。
 */
export function bottomIndex(board: readonly Stone[], column: number): number | null {
  let lowest: number | null = null
  for (let row = 0; row < BOARD_ROWS; row++) {
    if (board[row * BOARD_COLS + column] === EMPTY) lowest = row * BOARD_COLS + column
  }
  return lowest
}

/** 落子（就地修改传入的盘面），返回落点索引；列已满时抛错 */
export function dropInto(board: Stone[], column: number, side: Side): number {
  const index = bottomIndex(board, column)
  if (index === null) throw new Error(`column ${column} is full`)
  board[index] = side
  return index
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
 * 重放时校验重力：落点不是该列当时的最低空格就抛错（防止夹具本身写错）。
 */
export function stateOf(
  turns: readonly Connect4Turn[],
  extra: Partial<Connect4State> = {},
): Connect4State {
  const board = createEmptyBoard()
  let whiteCount = 0
  let lastMove: number | null = null
  for (const turn of turns) {
    const black = bottomIndex(board, colOf(turn.black))
    if (black !== turn.black) throw new Error(`black ${turn.black} violates gravity`)
    board[turn.black] = BLACK
    lastMove = turn.black
    if (turn.white !== null) {
      const white = bottomIndex(board, colOf(turn.white))
      if (white !== turn.white) throw new Error(`white ${turn.white} violates gravity`)
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

/** 玩家当前可落子的列（等价于规则层的 drop 动作集合） */
export function playerColumns(state: Connect4State): number[] {
  const columns: number[] = []
  for (let column = 0; column < BOARD_COLS; column++) {
    if (bottomIndex(state.board, column) !== null) columns.push(column)
  }
  return columns
}

/**
 * 「中盘/残局」夹具用的落子列次序（42 手 = 21 回合，黑先，颜色按手数交替）。
 *
 * 它是一条**真实的平局棋谱**：按这个次序落子，任何一步之后盘面都不会出现四连，
 * 铺满 42 格正好是「满盘无四连」的平局。次序由一次离线 DFS（每步只挑不产生四连的列）搜出，
 * 这里硬编码下来，保证夹具确定、不依赖随机搜索。
 *
 * 为什么不用「阶梯棋盘」之类的取色图案：阶梯棋盘（(row+col) 同色）在两条斜线上
 * 恰好同色，会直接连成四 —— 夹具必须真的能下得出来，否则 decode 与胜负断言都会自欺。
 */
const DRAW_DROP_COLUMNS: readonly number[] = [
  3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 0, 1, 1,
  1, 1, 1, 1, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6,
]

/** 把列次序配成「一回合 = 黑一手 + 白一手」的日志 */
function drawTurns(): Connect4Turn[] {
  const turns: Connect4Turn[] = []
  for (let position = 0; position + 1 < DRAW_DROP_COLUMNS.length; position += 2) {
    turns.push({
      black: bottomIndexFromColumn(position),
      white: bottomIndexFromColumn(position + 1),
    })
  }
  return turns
}

/** 第 t 手落在哪一格：按列次序重放前 t 手，再取该列最低空格 */
function bottomIndexFromColumn(position: number): number {
  const board = createEmptyBoard()
  for (let step = 0; step < position; step++) {
    const column = DRAW_DROP_COLUMNS[step]!
    const index = bottomIndex(board, column)
    if (index === null) throw new Error(`draw fixture column ${column} overflowed`)
    board[index] = step % 2 === 0 ? BLACK : WHITE
  }
  const column = DRAW_DROP_COLUMNS[position]!
  const index = bottomIndex(board, column)
  if (index === null) throw new Error(`draw fixture column ${column} overflowed`)
  return index
}

/**
 * 构造一个「中盘/残局」自洽局面：按平局棋谱铺 N 回合（黑 N 手 + 白 N 手）。
 * 盘面密但没有任何四连，适合测 AI 性能、前瞻层数与存档往返；N = 21 时就是平局。
 */
export function crowdedState(turns: number, difficulty: DifficultyId = 'starter'): Connect4State {
  const log = drawTurns().slice(0, turns)
  return stateOf(log, { difficulty })
}

/**
 * 铺满整盘且没有任何四连的盘面（黑 21 / 白 21）。
 * 取色规则 `(col + 2 * row) % 4 < 2`：横竖斜四个方向上同色连续段都不超过 2，可用于测平局。
 */
export function fillNoFourBoard(): Stone[] {
  const board = createEmptyBoard()
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      board[indexOf(row, col)] = (col + 2 * row) % 4 < 2 ? BLACK : WHITE
    }
  }
  return board
}

/**
 * 只保留前 count 列、其余全空的盘面（用于构造「可落子列变少」的局面，触发更深的前瞻）。
 * 直接取 `fillNoFourBoard` 的前 count 列：整盘没有四连，取子集更不可能有。
 */
export function columnsFilledBoard(count: number): Stone[] {
  const board = fillNoFourBoard()
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = count; col < BOARD_COLS; col++) {
      board[indexOf(row, col)] = EMPTY
    }
  }
  return board
}

export { BLACK, BOARD_COLS, BOARD_ROWS, CELLS, EMPTY, WHITE, colOf, indexOf, isFull, landingIndex }
