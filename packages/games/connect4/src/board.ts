/**
 * 四子棋棋盘几何与四连判定（纯函数，不感知 GameDef / 对局状态）。
 *
 * 棋盘竖放 7 列 × 6 行，索引约定沿用五子棋：行优先 `index = row * COLS + col`，
 * row 0 在最上方、col 0 在最左边。区别在于棋子受**重力**约束：只能落在某列
 * **最低的空格**上，因此「列」才是唯一的输入维度，`landingIndex(board, column)`
 * 负责把列号翻译成落点索引。
 *
 * 行 0 在上方意味着「最低」= 行号最大的一格（row = ROWS - 1）；渲染、AI 与落子
 * 全都走 `landingIndex`，不允许各自扫描，否则三者对「最低」的理解迟早会分叉。
 *
 * 四连只可能出现在四条轴上：横、竖、两条斜线（正反斜线互为反向，同一条轴扫描两次即可），
 * 所以 `DIRECTIONS` 只列 4 条；`runLength` 会朝正反两个方向各数一遍。
 */

export const BOARD_COLS = 7
export const BOARD_ROWS = 6
export const CELLS = BOARD_COLS * BOARD_ROWS

export type Stone = 0 | 1 | 2
export type Side = 1 | 2

// 用字面量类型（不加 Stone 注解）才能在 `stone !== EMPTY` 时把 Stone 收窄成 Side
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export function otherSide(side: Side): Side {
  return side === BLACK ? WHITE : BLACK
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_COLS)
}

export function colOf(index: number): number {
  return index % BOARD_COLS
}

export function indexOf(row: number, col: number): number {
  return row * BOARD_COLS + col
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS
}

export function isColumn(column: number): boolean {
  return Number.isInteger(column) && column >= 0 && column < BOARD_COLS
}

export function isIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELLS
}

/** 四条轴（行增量、列增量）；顺序固定，保证遍历与同分择优的结果可复现 */
export const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const

export function createEmptyBoard(): Stone[] {
  return new Array<Stone>(CELLS).fill(EMPTY)
}

export interface StoneCounts {
  black: number
  white: number
  empty: number
}

export function countStones(board: readonly Stone[]): StoneCounts {
  let black = 0
  let white = 0
  let empty = 0
  for (const stone of board) {
    if (stone === BLACK) black++
    else if (stone === WHITE) white++
    else empty++
  }
  return { black, white, empty }
}

export function isFull(board: readonly Stone[]): boolean {
  for (const stone of board) {
    if (stone === EMPTY) return false
  }
  return true
}

/**
 * 列内最低空格的索引；列已满或列号越界返回 null。
 *
 * 「列满」只需看最上面一格（row 0）：重力保证棋子只会从下往上堆，
 * 顶部有子就说明整列填满了，不必逐格扫描。
 */
export function landingIndex(board: readonly Stone[], column: number): number | null {
  if (!isColumn(column)) return null
  for (let row = BOARD_ROWS - 1; row >= 0; row--) {
    const index = indexOf(row, column)
    if (board[index] === EMPTY) return index
  }
  return null
}

export function columnFull(board: readonly Stone[], column: number): boolean {
  return isColumn(column) && board[indexOf(0, column)] !== EMPTY
}

/** 还能落子的列（升序）。顺序固定， AI 的遍历与同分择优都依赖它可复现 */
export function validColumns(board: readonly Stone[]): number[] {
  const columns: number[] = []
  for (let column = 0; column < BOARD_COLS; column++) {
    if (board[indexOf(0, column)] === EMPTY) columns.push(column)
  }
  return columns
}

/**
 * 假设 index 处是 side 的子时的连子长度（含 index 本身）。
 *
 * 只用于「自己这一手 / 假设自己下这一手」的场景：调用方保证 board[index] 为 EMPTY（试探落子）
 * 或 side（已落子复核）。若 board[index] 是对手的子，结果没有意义。
 */
export function runLength(
  board: readonly Stone[],
  index: number,
  side: Side,
  dr: number,
  dc: number,
): number {
  const row = rowOf(index)
  const col = colOf(index)
  let count = 1
  for (const sign of [1, -1] as const) {
    let r = row + sign * dr
    let c = col + sign * dc
    while (onBoard(r, c) && board[indexOf(r, c)] === side) {
      count++
      r += sign * dr
      c += sign * dc
    }
  }
  return count
}

/**
 * index 处落 side 后是否成四（横/竖/两斜任意一条轴达到 4 连）。
 *
 * 数的是**连续**同色子：对手子或棋盘边界都会终止计数，因此
 * 「三连被堵」「断口四子」都不算胜，只有真正挨在一起的 4 个才算。
 */
export function makesFour(board: readonly Stone[], index: number, side: Side): boolean {
  for (const [dr, dc] of DIRECTIONS) {
    if (runLength(board, index, side, dr, dc) >= 4) return true
  }
  return false
}

/** index 处成四的那条线（升序索引）；没成四返回 null */
export function findFour(board: readonly Stone[], index: number, side: Side): number[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    if (runLength(board, index, side, dr, dc) < 4) continue
    const line = [index]
    const row = rowOf(index)
    const col = colOf(index)
    for (const sign of [1, -1] as const) {
      let r = row + sign * dr
      let c = col + sign * dc
      while (onBoard(r, c) && board[indexOf(r, c)] === side) {
        line.push(indexOf(r, c))
        r += sign * dr
        c += sign * dc
      }
    }
    return line.sort((a, b) => a - b)
  }
  return null
}

/**
 * 往 column 落 side 的子；返回新棋盘。
 * 列号越界或列已满返回 null（原棋盘不动），与 `landingIndex` 同一套判定。
 */
export function dropStone(board: readonly Stone[], column: number, side: Side): Stone[] | null {
  const index = landingIndex(board, column)
  if (index === null) return null
  const next = board.slice()
  next[index] = side
  return next
}
