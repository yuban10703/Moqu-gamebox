/**
 * 棋盘几何与走子规则（纯函数：零随机、零时间引用、不修改传入的盘面）。
 *
 * 坐标约定（与展示模型一致）：
 * - 9 列 × 10 行，行优先索引 `index = row * 9 + col`；
 * - **行 0 是黑方底线（棋盘上方）、行 9 是红方底线（棋盘下方）**，红方先手、向上（行号减小）走；
 * - 红方九宫 = 行 7..9、列 3..5；黑方九宫 = 行 0..2、列 3..5；
 * - 河界在行 4 与行 5 之间：红方过河 = 行 ≤ 4，黑方过河 = 行 ≥ 5。
 *
 * 棋子编码：`side << 3 | type`（低 3 位兵种、第 4 位阵营），0 恒为空格。
 * 因此红方是 1..7、黑方是 9..15，`EMPTY === 0` 可以直接用真假判断。
 *
 * 着法编码：打包成一个整数 `from | (to << 7)` —— 90 格 < 128，7 位装得下。
 * 规则层与 AI 之间只传这种整数，避免每层搜索构造大量小对象。
 */
export const COLS = 9
export const ROWS = 10
export const CELLS = COLS * ROWS

/** 阵营：红方（玩家，下方，先手）/ 黑方（对手，上方） */
export const RED = 0
export const BLACK = 1
export type Side = typeof RED | typeof BLACK

export function otherSide(side: Side): Side {
  return (side ^ 1) as Side
}

/** 空格。棋子编码见文件头，红 1..7 / 黑 9..15 */
export const EMPTY = 0

/** 兵种（低 3 位；0 留给空格） */
export const KING = 1
export const ADVISOR = 2
export const ELEPHANT = 3
export const HORSE = 4
export const CHARIOT = 5
export const CANNON = 6
export const PAWN = 7
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7

export function makePiece(side: Side, type: PieceType): number {
  return (side << 3) | type
}

export function sideOf(piece: number): Side {
  return ((piece >> 3) & 1) as Side
}

export function typeOf(piece: number): number {
  return piece & 7
}

/** 合法的棋子编码：空格，或「阵营位 + 1..7 兵种」 */
export function isPieceCode(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 15 &&
    (value === EMPTY || (value & 7) !== 0)
  )
}

export function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CELLS
}

/* ---------------------------------- 几何 ---------------------------------- */

export function indexOf(row: number, col: number): number {
  return row * COLS + col
}

export function rowOf(index: number): number {
  return Math.floor(index / COLS)
}

export function colOf(index: number): number {
  return index % COLS
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS
}

/** 九宫：列 3..5，红方行 7..9 / 黑方行 0..2 */
export function inPalace(side: Side, row: number, col: number): boolean {
  if (col < 3 || col > 5) return false
  return side === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2
}

/** 自己这一侧（象不过河用）：红方行 5..9、黑方行 0..4 */
export function onOwnHalf(side: Side, row: number): boolean {
  return side === RED ? row >= 5 && row <= 9 : row >= 0 && row <= 4
}

/** 过河：红方行 ≤ 4、黑方行 ≥ 5（兵过河后才能横走） */
export function hasCrossedRiver(side: Side, row: number): boolean {
  return side === RED ? row <= 4 : row >= 5
}

/* -------------------------------- 着法编码 -------------------------------- */

export function packMove(from: number, to: number): number {
  return (from & 0x7f) | ((to & 0x7f) << 7)
}

export function moveFrom(move: number): number {
  return move & 0x7f
}

export function moveTo(move: number): number {
  return (move >> 7) & 0x7f
}

/** 着法编码是否合法（两端都在盘内、且不是原地不动） */
export function isMoveCode(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return false
  const from = moveFrom(value)
  const to = moveTo(value)
  return isIndex(from) && isIndex(to) && from !== to && value < (1 << 14)
}

/* -------------------------------- 初始局面 -------------------------------- */

/** 标准开局：红方在下、黑方在上，红先（车马象士将士象马车 / 炮 / 兵） */
export function createInitialBoard(): number[] {
  const board: number[] = new Array<number>(CELLS).fill(EMPTY)
  const backRank: readonly PieceType[] = [
    CHARIOT,
    HORSE,
    ELEPHANT,
    ADVISOR,
    KING,
    ADVISOR,
    ELEPHANT,
    HORSE,
    CHARIOT,
  ]
  for (let col = 0; col < COLS; col++) {
    board[indexOf(0, col)] = makePiece(BLACK, backRank[col] as PieceType)
    board[indexOf(9, col)] = makePiece(RED, backRank[col] as PieceType)
  }
  board[indexOf(2, 1)] = makePiece(BLACK, CANNON)
  board[indexOf(2, 7)] = makePiece(BLACK, CANNON)
  board[indexOf(7, 1)] = makePiece(RED, CANNON)
  board[indexOf(7, 7)] = makePiece(RED, CANNON)
  for (let col = 0; col < COLS; col += 2) {
    board[indexOf(3, col)] = makePiece(BLACK, PAWN)
    board[indexOf(6, col)] = makePiece(RED, PAWN)
  }
  return board
}

/* -------------------------------- 走子生成 -------------------------------- */

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

const DIAG: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]

const HORSE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]

/** 马腿：走日字时先直走的那一格（|dr| 或 |dc| 为 2 的方向上前进一格） */
function horseLeg(from: number, dr: number, dc: number): number {
  const row = rowOf(from)
  const col = colOf(from)
  const legRow = Math.abs(dr) === 2 ? row + dr / 2 : row
  const legCol = Math.abs(dc) === 2 ? col + dc / 2 : col
  return indexOf(legRow, legCol)
}

/**
 * 单个棋子的**伪合法**着法（只按兵种走法判断，不检查走完后自己是否被将军）。
 * 结果按「车/炮按方向顺序、其它按固定方向表顺序」稳定生成 —— 顺序稳定是确定性的前提之一。
 */
export function generatePieceMoves(
  board: readonly number[],
  from: number,
  piece: number,
  out: number[],
): void {
  const side = sideOf(piece)
  const type = typeOf(piece)
  const row = rowOf(from)
  const col = colOf(from)

  /** 目标格不能是己方子 */
  const canLand = (to: number): boolean => {
    const target = board[to] as number
    return target === EMPTY || sideOf(target) !== side
  }

  switch (type) {
    case KING: {
      // 帅/将：九宫内直走一步（「将帅照面」不作为一种走法 —— 照面局面本身非法，
      // 因此不存在「沿空列飞过去吃对方将」的合法着法）
      for (const [dr, dc] of ORTHO) {
        const r = row + dr
        const c = col + dc
        if (!inPalace(side, r, c)) continue
        const to = indexOf(r, c)
        if (canLand(to)) out.push(packMove(from, to))
      }
      break
    }
    case ADVISOR: {
      // 仕/士：九宫内斜走一步
      for (const [dr, dc] of DIAG) {
        const r = row + dr
        const c = col + dc
        if (!inPalace(side, r, c)) continue
        const to = indexOf(r, c)
        if (canLand(to)) out.push(packMove(from, to))
      }
      break
    }
    case ELEPHANT: {
      // 相/象：走田字，象眼被占则塞眼；且不能过河
      for (const [dr, dc] of DIAG) {
        const r = row + dr * 2
        const c = col + dc * 2
        if (!onBoard(r, c) || !onOwnHalf(side, r)) continue
        if (board[indexOf(row + dr, col + dc)] !== EMPTY) continue
        const to = indexOf(r, c)
        if (canLand(to)) out.push(packMove(from, to))
      }
      break
    }
    case HORSE: {
      // 马：走日字，马腿被占则别腿
      for (const [dr, dc] of HORSE_STEPS) {
        const r = row + dr
        const c = col + dc
        if (!onBoard(r, c)) continue
        if (board[horseLeg(from, dr, dc)] !== EMPTY) continue
        const to = indexOf(r, c)
        if (canLand(to)) out.push(packMove(from, to))
      }
      break
    }
    case CHARIOT: {
      // 车：直线滑行，遇到第一个子为止（是敌子则可吃）
      for (const [dr, dc] of ORTHO) {
        let r = row + dr
        let c = col + dc
        while (onBoard(r, c)) {
          const to = indexOf(r, c)
          const target = board[to] as number
          if (target === EMPTY) {
            out.push(packMove(from, to))
          } else {
            if (sideOf(target) !== side) out.push(packMove(from, to))
            break
          }
          r += dr
          c += dc
        }
      }
      break
    }
    case CANNON: {
      // 炮：不吃子时走法同车；吃子必须**隔一个子**（炮架），隔两个及以上不能吃
      for (const [dr, dc] of ORTHO) {
        let r = row + dr
        let c = col + dc
        // 炮架之前：只能落在空格上
        while (onBoard(r, c) && board[indexOf(r, c)] === EMPTY) {
          out.push(packMove(from, indexOf(r, c)))
          r += dr
          c += dc
        }
        if (!onBoard(r, c)) continue
        // 越过炮架，再找第一个子：是敌子就能吃
        r += dr
        c += dc
        while (onBoard(r, c) && board[indexOf(r, c)] === EMPTY) {
          r += dr
          c += dc
        }
        if (!onBoard(r, c)) continue
        const to = indexOf(r, c)
        const target = board[to] as number
        if (sideOf(target) !== side) out.push(packMove(from, to))
      }
      break
    }
    case PAWN: {
      // 兵/卒：未过河只能向前；过河后可横走一步，但永远不能后退
      const forward = side === RED ? -1 : 1
      const r = row + forward
      if (onBoard(r, col)) {
        const to = indexOf(r, col)
        if (canLand(to)) out.push(packMove(from, to))
      }
      if (hasCrossedRiver(side, row)) {
        for (const dc of [-1, 1]) {
          const c = col + dc
          if (c < 0 || c >= COLS) continue
          const to = indexOf(row, c)
          if (canLand(to)) out.push(packMove(from, to))
        }
      }
      break
    }
    default:
      // 空编码 / 非法兵种：不产生任何着法
      break
  }
}

/** 某一方所有伪合法着法（稳定顺序：按格子索引升序、同格按方向表顺序） */
export function generateMoves(board: readonly number[], side: Side): number[] {
  const out: number[] = []
  for (let from = 0; from < CELLS; from++) {
    const piece = board[from] as number
    if (piece === EMPTY || sideOf(piece) !== side) continue
    generatePieceMoves(board, from, piece, out)
  }
  return out
}

/* -------------------------------- 落子/回退 ------------------------------- */

/** 落子（就地修改，返回被吃的子，供 undoMove 还原）；调用方保证 work 是自己的可变副本 */
export function applyMove(work: number[], move: number): number {
  const from = moveFrom(move)
  const to = moveTo(move)
  const captured = work[to] as number
  work[to] = work[from] as number
  work[from] = EMPTY
  return captured
}

export function undoMove(work: number[], move: number, captured: number): void {
  const from = moveFrom(move)
  const to = moveTo(move)
  work[from] = work[to] as number
  work[to] = captured
}

export function findKing(board: readonly number[], side: Side): number {
  const king = makePiece(side, KING)
  for (let index = 0; index < CELLS; index++) {
    if (board[index] === king) return index
  }
  return -1
}

/* -------------------------------- 被攻击判定 ------------------------------ */

/**
 * target 是否被 bySide 攻击 —— **只用于判断将/帅安全**。
 *
 * 为什么可以只看四种子：
 * - 车：沿四条直线遇到的第一个子；
 * - 炮：越过炮架后的第二个子；
 * - 马：八个马步来源格，且马腿未被占；
 * - 兵/卒：正面一格，或过河后横向一格；
 * - 将/帅：同一直线上的第一个子。**将帅照面**（同列且中间无子）由此一并算作「被攻击」，
 *   于是「任何走法造成照面即非法」和「不得送将」用同一条过滤实现。
 *
 * 士/相永远够不到对方的九宫（士不出九宫、相不过河），因此对将帅安全没有影响，不参与判定。
 */
export function isAttacked(board: readonly number[], target: number, bySide: Side): boolean {
  const row = rowOf(target)
  const col = colOf(target)

  for (const [dr, dc] of ORTHO) {
    let r = row + dr
    let c = col + dc
    while (onBoard(r, c) && board[indexOf(r, c)] === EMPTY) {
      r += dr
      c += dc
    }
    if (!onBoard(r, c)) continue
    const first = board[indexOf(r, c)] as number
    if (sideOf(first) === bySide) {
      const type = typeOf(first)
      // 车直线攻击；将/帅：相邻可吃 + 同列照面（远程）
      if (type === CHARIOT || type === KING) return true
    }
    // 炮：隔着 first 这个炮架再找第二个子
    r += dr
    c += dc
    while (onBoard(r, c) && board[indexOf(r, c)] === EMPTY) {
      r += dr
      c += dc
    }
    if (!onBoard(r, c)) continue
    const second = board[indexOf(r, c)] as number
    if (sideOf(second) === bySide && typeOf(second) === CANNON) return true
  }

  // 马：从目标格倒推八个马步来源格
  for (const [dr, dc] of HORSE_STEPS) {
    const hr = row + dr
    const hc = col + dc
    if (!onBoard(hr, hc)) continue
    const horse = indexOf(hr, hc)
    const piece = board[horse] as number
    if (piece === EMPTY || sideOf(piece) !== bySide || typeOf(piece) !== HORSE) continue
    if (board[horseLeg(horse, -dr, -dc)] !== EMPTY) continue
    return true
  }

  // 兵/卒
  const pawn = makePiece(bySide, PAWN)
  if (bySide === RED) {
    if (row + 1 < ROWS && board[indexOf(row + 1, col)] === pawn) return true
    if (hasCrossedRiver(RED, row)) {
      if (col > 0 && board[indexOf(row, col - 1)] === pawn) return true
      if (col + 1 < COLS && board[indexOf(row, col + 1)] === pawn) return true
    }
  } else {
    if (row - 1 >= 0 && board[indexOf(row - 1, col)] === pawn) return true
    if (hasCrossedRiver(BLACK, row)) {
      if (col > 0 && board[indexOf(row, col - 1)] === pawn) return true
      if (col + 1 < COLS && board[indexOf(row, col + 1)] === pawn) return true
    }
  }

  return false
}

/** 某一方的将/帅是否正被将军（含将帅照面）；盘上没有该方的将时视为不被将军 */
export function isKingInCheck(board: readonly number[], side: Side): boolean {
  const king = findKing(board, side)
  if (king < 0) return false
  return isAttacked(board, king, otherSide(side))
}

/* ------------------------------ 合法着法过滤 ------------------------------ */

/**
 * 在**调用方自己的可变副本**上求合法着法：逐手试走，走完后自己的将/帅不能被攻击
 * （含照面），再原样回退 —— 函数返回时 work 与传入时逐格一致。
 *
 * 之所以要一个「就地」版本：AI 每层都要生成合法着法，每次都复制 90 格会拖慢搜索。
 */
export function legalMovesOn(work: number[], side: Side): number[] {
  const moves = generateMoves(work, side)
  const kingFrom = findKing(work, side)
  const out: number[] = []
  for (const move of moves) {
    const captured = applyMove(work, move)
    const kingAt = kingFrom < 0 ? -1 : moveFrom(move) === kingFrom ? moveTo(move) : kingFrom
    const safe = kingAt < 0 || !isAttacked(work, kingAt, otherSide(side))
    undoMove(work, move, captured)
    if (safe) out.push(move)
  }
  return out
}

/** 合法着法（不改动传入的盘面）：送将、照面、被牵制的子都被过滤掉 */
export function legalMoves(board: readonly number[], side: Side): number[] {
  return legalMovesOn(board.slice(), side)
}

/* --------------------------------- 小工具 -------------------------------- */

export function sameBoard(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}

/** 某一方在盘上的棋子数（统计栏用） */
export function countPieces(board: readonly number[], side: Side): number {
  let count = 0
  for (let index = 0; index < CELLS; index++) {
    const piece = board[index] as number
    if (piece !== EMPTY && sideOf(piece) === side) count++
  }
  return count
}
