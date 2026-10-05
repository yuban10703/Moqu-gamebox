import { legalActions, reduceXiangqi } from '../src/rules.js'
/**
 * 测试专用工具：ASCII 摆盘、构造局面、**独立实现**的将帅安全复核。
 *
 * 两点约定：
 * 1. `stateOf` 按「回合日志」重放盘面，构造出的局面与 rules 的构造性事实一致
 *    （moves / rngCursor / sideToMove / lastMove 都由日志推出），因此 `decode` 会接受它；
 * 2. `positionState` 直接摆一个**任意盘面**（不保证从开局可达），只用于规则单测；
 *    它不能被 decode 接受，测试里不要拿它做存档往返。
 * 3. `facingKings` / `kingAttacked` 是**独立实现**（按棋子逐类判断，与生产代码的
 *    「从目标格向外找攻击者」是两条不同的路径），用来复核生产代码的合法性过滤，
 *    避免「用被测实现验证被测实现」。
 */
import {
  ADVISOR,
  BLACK,
  CANNON,
  CELLS,
  CHARIOT,
  ELEPHANT,
  EMPTY,
  HORSE,
  KING,
  PAWN,
  RED,
  applyMove,
  colOf,
  createInitialBoard,
  findKing,
  indexOf,
  legalMoves,
  makePiece,
  moveFrom,
  moveTo,
  packMove,
  rowOf,
  sideOf,
  typeOf,
  type DifficultyId,
  type Side,
  type XiangqiState,
  type XiangqiTurn,
} from '../src/index.js'

/** ASCII 摆盘：'.' / '·' 空，红方大写、黑方小写（K帅 A仕 B相 N马 R车 C炮 P兵） */
const CHARS: Record<string, number> = {
  '.': EMPTY,
  '·': EMPTY,
  K: makePiece(RED, KING),
  A: makePiece(RED, ADVISOR),
  B: makePiece(RED, ELEPHANT),
  N: makePiece(RED, HORSE),
  R: makePiece(RED, CHARIOT),
  C: makePiece(RED, CANNON),
  P: makePiece(RED, PAWN),
  k: makePiece(BLACK, KING),
  a: makePiece(BLACK, ADVISOR),
  b: makePiece(BLACK, ELEPHANT),
  n: makePiece(BLACK, HORSE),
  r: makePiece(BLACK, CHARIOT),
  c: makePiece(BLACK, CANNON),
  p: makePiece(BLACK, PAWN),
}

const GLYPHS = [
  '.', // EMPTY
  'K', // 红帅
  'A',
  'B',
  'N',
  'R',
  'C',
  'P',
  '?', // 8 不是合法编码
  'k', // 黑将
  'a',
  'b',
  'n',
  'r',
  'c',
  'p',
]

/** 10 行 × 9 列摆盘（行 0 = 黑方底线、行 9 = 红方底线） */
export function boardOf(rows: readonly string[]): number[] {
  if (rows.length !== 10) throw new Error(`expected 10 rows, got ${rows.length}`)
  const board: number[] = []
  for (const row of rows) {
    if (row.length !== 9) throw new Error(`expected 9 columns, got ${row.length}`)
    for (const char of row) {
      const piece = CHARS[char]
      if (piece === undefined) throw new Error(`unknown cell char ${char}`)
      board.push(piece)
    }
  }
  return board
}

/** 盘面转 ASCII，断言失败时的可读输出 */
export function ascii(board: readonly number[]): string[] {
  const rows: string[] = []
  for (let row = 0; row < 10; row++) {
    let line = ''
    for (let col = 0; col < 9; col++) line += GLYPHS[board[indexOf(row, col)] as number] ?? '?'
    rows.push(line)
  }
  return rows
}

export function at(row: number, col: number): number {
  return indexOf(row, col)
}

export function initialBoard(): number[] {
  return createInitialBoard()
}

/** 全空棋盘（单元测试自己放子；正常局面必须有双方将帅） */
export function blankBoard(): number[] {
  return new Array<number>(CELLS).fill(EMPTY)
}

/**
 * 给单测盘面补上双方将帅（红帅 (9,4)、黑将 (0,3)：两列不同、互不照面，也不会互相攻击）。
 * 已经有该方将帅时不动它 —— 这样「测某个兵种走法」时不用每次重摆将帅。
 */
export function withKings(board: number[]): number[] {
  if (findKing(board, RED) < 0) board[at(9, 4)] = makePiece(RED, KING)
  if (findKing(board, BLACK) < 0) board[at(0, 3)] = makePiece(BLACK, KING)
  return board
}

export function packOf(from: number, to: number): number {
  return packMove(from, to)
}

export function countOf(board: readonly number[], side: Side): number {
  let count = 0
  for (const piece of board) {
    if (piece !== EMPTY && sideOf(piece) === side) count++
  }
  return count
}

/** 某一方某个棋子的所有合法落点（**按格号升序**，方便用例里手写期望值比对） */
export function destsOf(board: readonly number[], side: Side, from: number): number[] {
  const out: number[] = []
  for (const move of legalMoves(board, side)) {
    if (moveFrom(move) === from) out.push(moveTo(move))
  }
  return out.sort((a, b) => a - b)
}

/** 某一方全部合法着法（from → to 列表） */
export function movesOf(board: readonly number[], side: Side): Array<{ from: number; to: number }> {
  return legalMoves(board, side).map((move) => ({ from: moveFrom(move), to: moveTo(move) }))
}

/**
 * 由回合日志构造自洽局面：盘面 / 步数 / 游标 / 轮到谁走 / 最后一手都由日志推出，
 * 因此它是「rules 真实会产生的那类状态」，`decode` 会接受。
 * 日志本身不在这里复核（要测的就是重放会不会发现坏日志）。
 */
export function stateOf(turns: readonly XiangqiTurn[], extra: Partial<XiangqiState> = {}): XiangqiState {
  const board = createInitialBoard()
  let blackCount = 0
  let lastMove: number | null = null
  for (const turn of turns) {
    applyMove(board, turn.red)
    lastMove = turn.red
    if (turn.black !== null) {
      applyMove(board, turn.black)
      lastMove = turn.black
      blackCount++
    }
  }
  const sideToMove: Side = turns.length > 0 && (turns[turns.length - 1] as XiangqiTurn).black === null ? BLACK : RED
  return {
    difficulty: 'starter' as DifficultyId,
    seed: 7,
    board,
    sideToMove,
    moves: turns.length,
    rngCursor: blackCount,
    selected: null,
    lastMove,
    opponentPick: extra.opponentPick ?? null,
    history: turns,
    ...extra,
  }
}

/** 直接摆一个任意盘面（不做可达性校验；不能用于 decode 往返） */
export function positionState(
  board: readonly number[],
  extra: Partial<XiangqiState> = {},
): XiangqiState {
  const history = extra.history ?? []
  return {
    difficulty: 'starter',
    seed: 7,
    board: board.slice(),
    sideToMove: RED,
    moves: history.length,
    rngCursor: history.filter((turn) => turn.black !== null).length,
    selected: null,
    lastMove: null,
    opponentPick: extra.opponentPick ?? null,
    ...extra,
    history,
  }
}

/* ------------------------- 独立实现：将帅安全复核 ------------------------- */

/** 独立实现：将帅是否照面（同列且中间无子） */
export function facingKings(board: readonly number[]): boolean {
  const red = board.indexOf(makePiece(RED, KING))
  const black = board.indexOf(makePiece(BLACK, KING))
  if (red < 0 || black < 0) return false
  if (colOf(red) !== colOf(black)) return false
  const col = colOf(red)
  const top = Math.min(rowOf(red), rowOf(black))
  const bottom = Math.max(rowOf(red), rowOf(black))
  for (let row = top + 1; row < bottom; row++) {
    if (board[indexOf(row, col)] !== EMPTY) return false
  }
  return true
}

/** 两点之间（不含端点）的棋子数，用于车/炮的直线判定 */
function piecesBetween(
  board: readonly number[],
  from: number,
  to: number,
): number {
  const dr = Math.sign(rowOf(to) - rowOf(from))
  const dc = Math.sign(colOf(to) - colOf(from))
  if (dr !== 0 && dc !== 0) return -1 // 不在同一条直线上
  let count = 0
  let row = rowOf(from) + dr
  let col = colOf(from) + dc
  while (row !== rowOf(to) || col !== colOf(to)) {
    if (board[indexOf(row, col)] !== EMPTY) count++
    row += dr
    col += dc
  }
  return count
}

/**
 * 独立实现：side 的将/帅是否处于被攻击状态（含将帅照面）。
 * 逐个子按兵种手写判断 —— 与生产代码「从将的位置向外射线扫描」是两条不同路径。
 */
export function kingAttacked(board: readonly number[], side: Side): boolean {
  const king = board.indexOf(makePiece(side, KING))
  if (king < 0) return false
  if (facingKings(board)) return true
  const kingRow = rowOf(king)
  const kingCol = colOf(king)
  const enemy: Side = side === RED ? BLACK : RED
  for (let index = 0; index < CELLS; index++) {
    const piece = board[index] as number
    if (piece === EMPTY || sideOf(piece) !== enemy) continue
    const type = typeOf(piece)
    const row = rowOf(index)
    const col = colOf(index)
    const dr = kingRow - row
    const dc = kingCol - col
    switch (type) {
      case CHARIOT:
        if ((row === kingRow || col === kingCol) && piecesBetween(board, index, king) === 0) return true
        break
      case CANNON:
        if ((row === kingRow || col === kingCol) && piecesBetween(board, index, king) === 1) return true
        break
      case HORSE: {
        const near = (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2)
        if (!near) break
        // 马腿：从马朝着将的方向先直走一格
        const legRow = row + (Math.abs(dr) === 2 ? Math.sign(dr) : 0)
        const legCol = col + (Math.abs(dc) === 2 ? Math.sign(dc) : 0)
        if (board[indexOf(legRow, legCol)] === EMPTY) return true
        break
      }
      case PAWN: {
        // 兵/卒的攻击方向：红方朝上行（行号减小），黑方朝下行
        const forward = enemy === RED ? -1 : 1
        if (row + forward === kingRow && col === kingCol) return true
        const crossed = enemy === RED ? row <= 4 : row >= 5
        if (crossed && row === kingRow && Math.abs(col - kingCol) === 1) return true
        break
      }
      case KING:
        if (Math.abs(dr) + Math.abs(dc) === 1) return true
        break
      default:
        // 士/相够不到对方九宫，不参与
        break
    }
  }
  return false
}

/** 某一步走完后，走子方自己的将是否安全（独立复核用） */
export function moveKeepsKingSafe(board: readonly number[], side: Side, move: number): boolean {
  const work = board.slice()
  applyMove(work, move)
  return !kingAttacked(work, side)
}

/* 测试里偶尔要直接用到这些规则层原语（摆盘、复算），这里统一再导出一次 */
export { makePiece, legalMoves, moveFrom, moveTo, packMove, sideOf, typeOf, EMPTY, RED, BLACK }

/**
 * 把「AI 待应手」的中间态推进到落定。
 *
 * 应手是**两拍**（先选中棋子、500ms 后落子），所以测试里不能只发一次 tick ——
 * 这里循环发到 legal() 里没有 tick 为止，将来加拍数也不用改测试。
 */
export function settle(state: XiangqiState): XiangqiState {
  let current = state
  for (let guard = 0; guard < 8; guard++) {
    const tick = legalActions(current).find((action) => action.type === 'tick')
    if (!tick) break
    current = reduceXiangqi(current, tick)
  }
  return current
}
