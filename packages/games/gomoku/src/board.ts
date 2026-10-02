/**
 * 五子棋棋盘几何与连子判定（纯函数，不感知 GameDef / 对局状态）。
 *
 * 索引约定：行优先 `index = row * 15 + col`，row 0 在最上方、col 0 在最左边。
 * 棋盘固定 15×15（三档难度只改白方强度，不改尺寸），因此棋盘本身就是标准事实：
 * 天元（7,7）的索引是 112，测试与 AI 都拿它当基准点。
 *
 * 连子只可能出现在四条轴上：横、竖、两条斜线（正反斜线互为反向，同一条轴扫描两次即可），
 * 所以 `DIRECTIONS` 只列 4 条；`runLength` 会朝正反两个方向各数一遍。
 */

export const BOARD_SIZE = 15
export const CELLS = BOARD_SIZE * BOARD_SIZE

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
 * index 处落 side 后是否成五（横/竖/两斜任意一条轴达到 5 连）。
 *
 * 「被对手堵住一端不算胜」：这里数的是**连续**同色子，对手子或棋盘边界都会终止计数，
 * 因此 4 连加一端被封只有 4，不构成五连。
 */
export function makesFive(board: readonly Stone[], index: number, side: Side): boolean {
  for (const [dr, dc] of DIRECTIONS) {
    if (runLength(board, index, side, dr, dc) >= 5) return true
  }
  return false
}

/** index 处成五的那条线（升序索引）；没成五返回 null */
export function findFive(board: readonly Stone[], index: number, side: Side): number[] | null {
  for (const [dr, dc] of DIRECTIONS) {
    if (runLength(board, index, side, dr, dc) < 5) continue
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

/** 落子；返回新棋盘，越界或已占用返回 null（原棋盘不动） */
export function placeStone(board: readonly Stone[], index: number, side: Side): Stone[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return null
  if (board[index] !== EMPTY) return null
  const next = board.slice()
  next[index] = side
  return next
}

/**
 * 「在已有棋子附近」的空点（切比雪夫距离 ≤ radius）。
 *
 * 为什么需要：五子棋的合法落点理论上是任意空格，但离战场很远的点既无战术价值、
 * 又会让搜索分支爆炸。三档难度都在这个集合里选点（入门档只取 radius 1，
 * 因此它仍然是「随机合法点」，只是不会飘到空角去）。
 * 棋盘为空时（正常对局不会出现）退化为天元。
 */
export function nearbyMoves(board: readonly Stone[], radius: number): number[] {
  const marked = new Uint8Array(CELLS)
  let hasStone = false
  for (let index = 0; index < CELLS; index++) {
    if (board[index] === EMPTY) continue
    hasStone = true
    const row = rowOf(index)
    const col = colOf(index)
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = row + dr
        const c = col + dc
        if (onBoard(r, c)) marked[indexOf(r, c)] = 1
      }
    }
  }
  const moves: number[] = []
  if (!hasStone) {
    const center = indexOf(7, 7)
    if (board[center] === EMPTY) moves.push(center)
    return moves
  }
  for (let index = 0; index < CELLS; index++) {
    if (marked[index] === 1 && board[index] === EMPTY) moves.push(index)
  }
  return moves
}
