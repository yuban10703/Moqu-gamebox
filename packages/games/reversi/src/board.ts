/**
 * 棋盘几何与落子翻转规则（纯函数，不感知 GameDef / 对局状态）。
 *
 * 索引约定：行优先 `index = row * 8 + col`，row 0 在棋盘最上方、col 0 在最左边。
 * 初始局面是黑白棋的标准中心四格：
 *   d4 = 白、e5 = 白、e4 = 黑、d5 = 黑（黑先手）。
 * 换成行优先索引：
 *   d4 = 35（row 4 col 3）白、e5 = 28（row 3 col 4）白、
 *   e4 = 36（row 4 col 4）黑、d5 = 27（row 3 col 3）黑。
 * 这四个索引是黑白棋的公共事实，测试会拿它当「方向/翻转实现正确性」的第一道闸门。
 */

export const BOARD_SIZE = 8
export const CELLS = BOARD_SIZE * BOARD_SIZE

/** 格子内容：0 空、1 黑（玩家）、2 白（对手）。用 0 表示空是为了与数组初值一致 */
export type Disc = 0 | 1 | 2
export type Side = 1 | 2

// 用字面量类型（不加 Disc 注解）才能在 `disc !== EMPTY` 时把 Disc 收窄成 Side
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export function otherSide(side: Side): Side {
  return side === BLACK ? WHITE : BLACK
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_SIZE)
}

export function colOf(index: number): number {
  return index % BOARD_SIZE
}

export function indexOf(row: number, col: number): number {
  return row * BOARD_SIZE + col
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

/** 八个方向（行增量、列增量）；顺序固定，保证遍历结果可复现 */
export const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const

export function createInitialBoard(): Disc[] {
  const board: Disc[] = new Array<Disc>(CELLS).fill(EMPTY)
  board[27] = BLACK // d5
  board[28] = WHITE // e5
  board[35] = WHITE // d4
  board[36] = BLACK // e4
  return board
}

/**
 * 在 index 落 side 的棋子后，八个方向上被夹住的对方棋子。
 * 返回空数组表示这一手不合法（夹不住任何棋子，包括格子非空/越界）。
 */
export function flipsFor(board: readonly Disc[], index: number, side: Side): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return []
  if (board[index] !== EMPTY) return []
  const row = rowOf(index)
  const col = colOf(index)
  const opponent = otherSide(side)
  const flips: number[] = []
  for (const [dr, dc] of DIRECTIONS) {
    const line: number[] = []
    let r = row + dr
    let c = col + dc
    while (onBoard(r, c) && board[indexOf(r, c)] === opponent) {
      line.push(indexOf(r, c))
      r += dr
      c += dc
    }
    // 只有当被夹的连续对方棋子后面还有自己的棋子时才算夹住（一步也不夹的不算）
    if (line.length > 0 && onBoard(r, c) && board[indexOf(r, c)] === side) flips.push(...line)
  }
  return flips
}

export function isLegalMove(board: readonly Disc[], index: number, side: Side): boolean {
  return flipsFor(board, index, side).length > 0
}

/** 某一方的全部合法落点（升序，便于断言与复现） */
export function legalMovesFor(board: readonly Disc[], side: Side): number[] {
  const moves: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (isLegalMove(board, index, side)) moves.push(index)
  }
  return moves
}

export interface Placement {
  /** 落子并翻面之后的新棋盘（新数组，原数组不动） */
  board: Disc[]
  /** 被翻面的格子索引 */
  flips: number[]
}

/** 落子并翻面；返回 null 表示非法（此时原棋盘不变） */
export function placeDisc(board: readonly Disc[], index: number, side: Side): Placement | null {
  const flips = flipsFor(board, index, side)
  if (flips.length === 0) return null
  const next = board.slice()
  next[index] = side
  for (const flipped of flips) next[flipped] = side
  return { board: next, flips }
}

export interface DiscCounts {
  black: number
  white: number
  empty: number
}

export function countDiscs(board: readonly Disc[]): DiscCounts {
  let black = 0
  let white = 0
  let empty = 0
  for (const disc of board) {
    if (disc === BLACK) black++
    else if (disc === WHITE) white++
    else empty++
  }
  return { black, white, empty }
}

/** 双方都无处可下即终局：棋盘下满也必然落进这一支（没有空格就没有合法落点） */
export function isTerminal(board: readonly Disc[]): boolean {
  return legalMovesFor(board, BLACK).length === 0 && legalMovesFor(board, WHITE).length === 0
}

/**
 * 位置权重（黑白棋通用表）：角位最高，角旁的 C/X 位为负 ——
 * 角旁格送给对手等于送角，是黑白棋最典型的坏手。
 * 纯贪心与前瞻评估共用这一张表，保证两档难度的「好坏观」一致。
 */
export const WEIGHTS: readonly number[] = [
  120, -20, 20, 5, 5, 20, -20, 120, -20, -40, -5, -5, -5, -5, -40, -20, 20, -5, 15, 3, 3, 15, -5,
  20, 5, -5, 3, 3, 3, 3, -5, 5, 5, -5, 3, 3, 3, 3, -5, 5, 20, -5, 15, 3, 3, 15, -5, 20, -20, -40,
  -5, -5, -5, -5, -40, -20, 120, -20, 20, 5, 5, 20, -20, 120,
]

/** 角旁的对角格（X 位）：权重表里它们是负的，但仅当角还被对手/空格占着时才危险 */
const X_SQUARES: Readonly<Record<number, number>> = { 9: 0, 14: 7, 49: 56, 54: 63 }

/**
 * 单个棋子的静态位置价值。
 * 角旁格一旦被自己拿下（角也归自己），对手就再也抢不到那个角，
 * 这时的 X 位是稳固的边角结构而不是陷阱 —— 所以去掉它的负权重。
 * 这只是评估的细化，`skilled` 的贪心选点仍用原表（它看的是落点本身，不涉及已被翻的子）。
 */
export function positionalWeight(board: readonly Disc[], index: number): number {
  const corner = X_SQUARES[index]
  if (corner !== undefined && board[corner] === board[index]) return 25
  return WEIGHTS[index]!
}
