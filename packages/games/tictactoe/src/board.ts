/**
 * 井字棋的棋盘几何与连线判定（纯函数，不感知 GameDef / 对局状态）。
 *
 * 索引约定：行优先 `index = row * 3 + col`，row 0 在最上方、col 0 在最左边。
 * 棋盘固定 3×3（三档难度只改对手强度，不改尺寸），因此九格本身就是标准事实：
 * 中心是 4、四角是 0/2/6/8、四边是 1/3/5/7 —— AI、提示与测试都拿它们当基准点。
 *
 * 单独成文件是为了打断依赖环：`engine.ts`（状态机）要用 `ai.ts` 选点，
 * 而 `ai.ts` 又要用这里的连线与落点工具 —— 规矩（棋盘）与策略（对手）分成两层，
 * 依赖就只有一个方向（与五子棋的 board.ts 同一职务）。
 */

export const SIZE = 3
export const CELLS = SIZE * SIZE

/** 格子内容：0 空、1 先手（✕）、2 后手（○） */
export type Mark = 0 | 1 | 2
export type Side = 1 | 2

// 用字面量类型（不加 Mark 注解）才能在 `mark !== EMPTY` 时把 Mark 收窄成 Side
export const EMPTY = 0
export const FIRST = 1
export const SECOND = 2

/** 中心格：熟练档「否则占中心」的目标 */
export const CENTER = 4
/** 四角（升序）：角比边值钱，熟练档占完中心就占角 */
export const CORNERS: readonly number[] = [0, 2, 6, 8]

/**
 * 八条连线（三横、三竖、两斜）。
 * 顺序固定：判定「谁先连成」与 AI 挑点时都按这个顺序遍历，结果与遍历顺序无关（可复现）。
 */
export const LINES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export function otherSide(side: Side): Side {
  return side === FIRST ? SECOND : FIRST
}

export function rowOf(index: number): number {
  return Math.floor(index / SIZE)
}

export function colOf(index: number): number {
  return index % SIZE
}

export function indexOf(row: number, col: number): number {
  return row * SIZE + col
}

export function isIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELLS
}

export function createEmptyBoard(): Mark[] {
  return new Array<Mark>(CELLS).fill(EMPTY)
}

/** 落子；越界或已占用返回 null（原棋盘不动） */
export function placeMark(board: readonly Mark[], index: number, side: Side): Mark[] | null {
  if (!isIndex(index)) return null
  if (board[index] !== EMPTY) return null
  const next = board.slice()
  next[index] = side
  return next
}

/** 某一方已经连成的那条线（三格升序）；没连成返回 null */
export function lineOf(board: readonly Mark[], side: Side): readonly number[] | null {
  for (const line of LINES) {
    if (line.every((index) => board[index] === side)) return line
  }
  return null
}

/**
 * 盘面上连成线的一方；还没人连成（对局未结束或和局）返回 null。
 * 正常对局里第一方连成线时对局立刻结束，不会出现两方同时连成，因此取第一条即可。
 */
export function winnerOf(board: readonly Mark[]): Side | null {
  for (const line of LINES) {
    const head = board[line[0]!]!
    if (head === EMPTY) continue
    if (board[line[1]!] === head && board[line[2]!] === head) return head
  }
  return null
}

/**
 * 立刻能连成线的空点（升序）。
 * 三个用途：AI「能赢就赢 / 对手要赢就堵」、入门档「小概率抓成线」、提示挑正解。
 */
export function winningMoves(board: readonly Mark[], side: Side): number[] {
  const moves: number[] = []
  for (const line of LINES) {
    let empty = -1
    let own = 0
    for (const index of line) {
      const mark = board[index]!
      if (mark === side) own++
      else if (mark === EMPTY) empty = index
      else {
        // 线上有对手的子：这条线永远连不成了，整条作废
        own = -1
        break
      }
    }
    if (own === 2 && empty >= 0) moves.push(empty)
  }
  return moves.sort((a, b) => a - b)
}

export function emptyCells(board: readonly Mark[]): number[] {
  const cells: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (board[index] === EMPTY) cells.push(index)
  }
  return cells
}

export function isFull(board: readonly Mark[]): boolean {
  return board.every((mark) => mark !== EMPTY)
}

export interface MarkCounts {
  first: number
  second: number
  empty: number
}

export function countMarks(board: readonly Mark[]): MarkCounts {
  let first = 0
  let second = 0
  let empty = 0
  for (const mark of board) {
    if (mark === FIRST) first++
    else if (mark === SECOND) second++
    else empty++
  }
  return { first, second, empty }
}
