/**
 * 跳棋（国际跳棋简化版）的棋盘模型：8×8 深色格、棋子、走子/吃子生成与回合枚举。
 *
 * 采用的简化规则（与规则文案保持一致）：
 * - 只有深色格 `(row + col) % 2 === 1` 能放子；(row+col)%2===0 的浅色格在视图里画成墙；
 * - 双方各 12 枚兵，占各自 3 行；黑方在下（row 5~7）先手，向上走；白方在上（row 0~2），向下走；
 * - **兵只能向前斜走一格**；吃子则是跳过相邻的敌子落到其后的空格，方向**可前可后**，且可连跳；
 * - 兵走到对方底线升王（在**整个回合结束时**判定：连跳途中经过底线不升级，符合国际跳棋口径）；
 * - 王斜走一格（前后皆可），吃子同样四方向；
 * - **吃子必须吃**：只要存在吃子着法，所有非吃子着法都非法；一次吃子后若还有后续吃子，必须继续吃（连跳强制）。
 *
 * 本文件只做纯计算（棋盘/着法），不涉及任何随机性。
 */
import { IllegalActionError } from '@eink/core'

export const GAME_ID = 'checkers'

export const BOARD_SIZE = 8

export const CELLS = BOARD_SIZE * BOARD_SIZE

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

/** 对局方：黑方是玩家（先手，在棋盘下方），白方由规则层自动应手 */
export type Side = 'black' | 'white'

export const BLACK: Side = 'black'
export const WHITE: Side = 'white'

/** 棋子编码：0 = 空；1/2 = 黑兵/黑王；3/4 = 白兵/白王 */
export const EMPTY = 0
export const BLACK_MAN = 1
export const BLACK_KING = 2
export const WHITE_MAN = 3
export const WHITE_KING = 4

export type Piece = 0 | 1 | 2 | 3 | 4

/** 每方起始兵力 */
export const PIECES_PER_SIDE = 12

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
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

/** 深色格才能放子；浅色格在视图里是墙 */
export function isPlayable(index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return false
  return (rowOf(index) + colOf(index)) % 2 === 1
}

export const PLAYABLE_INDEXES: readonly number[] = (() => {
  const out: number[] = []
  for (let index = 0; index < CELLS; index++) if (isPlayable(index)) out.push(index)
  return out
})()

export function otherSide(side: Side): Side {
  return side === BLACK ? WHITE : BLACK
}

export function sideOf(piece: Piece): Side | null {
  if (piece === BLACK_MAN || piece === BLACK_KING) return BLACK
  if (piece === WHITE_MAN || piece === WHITE_KING) return WHITE
  return null
}

export function isKing(piece: Piece): boolean {
  return piece === BLACK_KING || piece === WHITE_KING
}

export function isMan(piece: Piece): boolean {
  return piece === BLACK_MAN || piece === WHITE_MAN
}

/** 兵的前进方向：黑方向上（行号减小），白方向下 */
export function forwardDir(side: Side): -1 | 1 {
  return side === BLACK ? -1 : 1
}

/** 兵到达对方底线后升王；没到就返回原棋子 */
export function promotedPiece(piece: Piece, index: number): Piece {
  if (piece === BLACK_MAN && rowOf(index) === 0) return BLACK_KING
  if (piece === WHITE_MAN && rowOf(index) === BOARD_SIZE - 1) return WHITE_KING
  return piece
}

/** 起始局面：黑兵占 row 5~7 的深色格，白兵占 row 0~2 的深色格 */
export function initialBoard(): Piece[] {
  const board = new Array<Piece>(CELLS).fill(EMPTY)
  for (const index of PLAYABLE_INDEXES) {
    const row = rowOf(index)
    if (row >= BOARD_SIZE - 3) board[index] = BLACK_MAN
    else if (row <= 2) board[index] = WHITE_MAN
  }
  return board
}

export interface PieceCounts {
  readonly black: number
  readonly white: number
  readonly blackKings: number
  readonly whiteKings: number
}

export function countPieces(board: readonly Piece[]): PieceCounts {
  let black = 0
  let white = 0
  let blackKings = 0
  let whiteKings = 0
  for (const piece of board) {
    if (piece === BLACK_MAN) black += 1
    else if (piece === BLACK_KING) {
      black += 1
      blackKings += 1
    } else if (piece === WHITE_MAN) white += 1
    else if (piece === WHITE_KING) {
      white += 1
      whiteKings += 1
    }
  }
  return { black, white, blackKings, whiteKings }
}

/** 棋子基础价值（王比兵值钱），供 AI 评估与测试使用 */
export const MAN_VALUE = 100
export const KING_VALUE = 165

export function pieceValue(piece: Piece): number {
  if (piece === EMPTY) return 0
  return isKing(piece) ? KING_VALUE : MAN_VALUE
}

/** 一步走/吃：captured 为被跳过的敌子索引，普通走子为 null */
export interface Move {
  readonly from: number
  readonly to: number
  readonly captured: number | null
}

/** 一个完整回合：连跳会被展开成多步；普通走子只有一步 */
export type Turn = readonly Move[]

const DIAGONALS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]

function stepTo(index: number, deltaRow: number, deltaCol: number, times: number): number | null {
  const row = rowOf(index) + deltaRow * times
  const col = colOf(index) + deltaCol * times
  if (!onBoard(row, col)) return null
  return indexOf(row, col)
}

/** 该格棋子能斜走到的空格（兵只向前，王前后皆可） */
export function quietMovesFrom(board: readonly Piece[], index: number): Move[] {
  const piece = board[index]
  if (piece === undefined || piece === EMPTY) return []
  const side = sideOf(piece)!
  const out: Move[] = []
  for (const [deltaRow, deltaCol] of DIAGONALS) {
    if (!isKing(piece) && deltaRow !== forwardDir(side)) continue
    const to = stepTo(index, deltaRow, deltaCol, 1)
    if (to === null) continue
    if (board[to] === EMPTY) out.push({ from: index, to, captured: null })
  }
  return out
}

/** 该格棋子能进行的单次吃子（跳过相邻敌子落到其后空格；兵也允许向后吃） */
export function captureMovesFrom(board: readonly Piece[], index: number): Move[] {
  const piece = board[index]
  if (piece === undefined || piece === EMPTY) return []
  const side = sideOf(piece)!
  const out: Move[] = []
  for (const [deltaRow, deltaCol] of DIAGONALS) {
    const mid = stepTo(index, deltaRow, deltaCol, 1)
    const to = stepTo(index, deltaRow, deltaCol, 2)
    if (mid === null || to === null) continue
    const target = board[mid]
    // 只能跳过敌子，且落点必须是空格
    if (target !== EMPTY && sideOf(target) !== side && board[to] === EMPTY) {
      out.push({ from: index, to, captured: mid })
    }
  }
  return out
}

/** 某一方的全部单步吃子 */
export function captureMovesFor(board: readonly Piece[], side: Side): Move[] {
  const out: Move[] = []
  for (const index of PLAYABLE_INDEXES) {
    if (sideOf(board[index]!) !== side) continue
    out.push(...captureMovesFrom(board, index))
  }
  return out
}

/** 某一方的全部单步走子（不含吃子） */
export function quietMovesFor(board: readonly Piece[], side: Side): Move[] {
  const out: Move[] = []
  for (const index of PLAYABLE_INDEXES) {
    if (sideOf(board[index]!) !== side) continue
    out.push(...quietMovesFrom(board, index))
  }
  return out
}

/**
 * 某一方的合法单步着法：**吃子必须吃** —— 只要存在吃子，就只返回吃子着法。
 * 返回值按格子索引升序、方向固定顺序排列，保证确定性。
 */
export function legalMovesFor(board: readonly Piece[], side: Side): Move[] {
  const captures = captureMovesFor(board, side)
  if (captures.length > 0) return captures
  return quietMovesFor(board, side)
}

/** 执行一步：移动棋子并移除被跳过的敌子；返回新数组，不改原数组 */
export function applyMove(board: readonly Piece[], move: Move): Piece[] {
  const next = board.slice()
  next[move.to] = next[move.from]!
  next[move.from] = EMPTY
  if (move.captured !== null) next[move.captured] = EMPTY
  return next
}

/** 回合结束时按落点升王；没有升王返回 null */
export function promoteAt(board: readonly Piece[], index: number): Piece[] | null {
  const piece = board[index]!
  const promoted = promotedPiece(piece, index)
  if (promoted === piece) return null
  const next = board.slice()
  next[index] = promoted
  return next
}

/**
 * 枚举某一方的完整回合（连跳展开成多步）。
 *
 * 递归展开：一步吃子后若该棋子还能继续吃，就必须继续；到不能再吃为止才算一个完整回合。
 * `limit` 是安全上限：分支极端膨胀时按生成顺序截断（生成顺序是确定的，因此结果仍可复现）。
 */
export function enumerateTurns(
  board: readonly Piece[],
  side: Side,
  limit = 512,
): Turn[] {
  const out: Turn[] = []
  const firsts = legalMovesFor(board, side)
  const walk = (current: readonly Piece[], move: Move, steps: readonly Move[]): void => {
    if (out.length >= limit) return
    const next = applyMove(current, move)
    const nextSteps = [...steps, move]
    const continuations = move.captured !== null ? captureMovesFrom(next, move.to) : []
    if (continuations.length === 0) {
      out.push(nextSteps)
      return
    }
    for (const continuation of continuations) walk(next, continuation, nextSteps)
  }
  for (const move of firsts) walk(board, move, [])
  return out
}

/** 把一个完整回合落到棋盘上（含回合结束时的升王） */
export function applyTurn(board: readonly Piece[], turn: Turn): Piece[] {
  let next: Piece[] = board.slice()
  for (const move of turn) next = applyMove(next, move)
  const last = turn[turn.length - 1]
  if (last === undefined) return board.slice()
  return promoteAt(next, last.to) ?? next
}

/** 一个回合吃掉的子力总和（AI 排序用） */
export function turnCapturedValue(board: readonly Piece[], turn: Turn): number {
  let total = 0
  for (const move of turn) {
    if (move.captured !== null) total += pieceValue(board[move.captured]!)
  }
  return total
}

/** 校验一个棋盘数组是否是合法的跳棋棋盘（长度、取值、只落在深色格） */
export function assertBoardShape(board: readonly Piece[]): void {
  if (!Array.isArray(board) || board.length !== CELLS) {
    throw new IllegalActionError(GAME_ID, 'bad board shape')
  }
  for (let index = 0; index < CELLS; index++) {
    const piece = board[index]
    if (piece !== EMPTY && !isPlayable(index)) {
      throw new IllegalActionError(GAME_ID, `piece on light square ${index}`)
    }
  }
}
