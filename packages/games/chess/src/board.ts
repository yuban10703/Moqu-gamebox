/**
 * 国际象棋棋盘几何与走子/攻击判定（纯函数，不感知 GameDef / 对局状态）。
 *
 * 索引约定：行优先 `index = row*8+col`，row 0 = 黑方底线（第 8 横线）、row 7 = 白方底线（第 1 横线）。
 * 参照象棋（xiangqi）的编码：`makePiece(side<<3|type)`，EMPTY=0，WHITE=0 / BLACK=1。
 *
 * 与象棋的差异（都在本文件内消化）：
 * - **易位**：王横移两格视为易位，apply/undo 联动车；合法性条件（王车未动、中间格空、
 *   王不在被将、经过与到达的格子不被攻击）在走子生成里判；
 * - **吃过路兵**：状态里存 epSquare（双步兵身后那格），apply 里把被吃的兵移走；
 * - **升变**：兵到最后一横线**自动升变为后**（v1 取舍，规则文案里写明）。
 *
 * 所有函数零时间引用、零随机：可被规则层与 AI 搜索共用。
 */
export const BOARD_SIZE = 8
export const CELLS = BOARD_SIZE * BOARD_SIZE

export type Piece = number
export type Side = 0 | 1

export const EMPTY = 0
export const WHITE = 0
export const BLACK = 1

export const KING = 1
export const QUEEN = 2
export const ROOK = 3
export const BISHOP = 4
export const KNIGHT = 5
export const PAWN = 6

export function makePiece(side: Side, type: number): Piece {
  return (side << 3) | type
}

export function sideOf(piece: Piece): Side {
  return ((piece >> 3) & 1) as Side
}

export function typeOf(piece: Piece): number {
  return piece & 7
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

/** 着法打包：from<<6 | to（64 格够用） */
export function moveFrom(move: number): number {
  return move >> 6
}

export function moveTo(move: number): number {
  return move & 63
}

export function packMove(from: number, to: number): number {
  return (from << 6) | to
}

/** 易位权位掩码：白王翼 1、白后翼 2、黑王翼 4、黑后翼 8 */
export const CASTLE_WK = 1
export const CASTLE_WQ = 2
export const CASTLE_BK = 4
export const CASTLE_BQ = 8
export const CASTLE_ALL = CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ

const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
] as const

const KING_OFFSETS = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
] as const

const ORTHO = [
  [0, 1], [1, 0], [0, -1], [-1, 0],
] as const

const DIAG = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const

/** 开局摆法：黑方在上（row 0-1）、白方在下（row 6-7），白方先行 */
export function createInitialBoard(): Piece[] {
  const board = new Array<Piece>(CELLS).fill(EMPTY)
  const backRank: number[] = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK]
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[indexOf(0, col)] = makePiece(BLACK, backRank[col]!)
    board[indexOf(1, col)] = makePiece(BLACK, PAWN)
    board[indexOf(6, col)] = makePiece(WHITE, PAWN)
    board[indexOf(7, col)] = makePiece(WHITE, backRank[col]!)
  }
  return board
}

/** index 是否被 bySide 的棋子攻击（用于送将过滤与易位的"经过格不被攻击"） */
export function isSquareAttacked(board: readonly Piece[], index: number, bySide: Side): boolean {
  const r = rowOf(index)
  const c = colOf(index)

  // 兵：白兵朝 row-1 吃，所以被白方攻击要看 row+1 两角是否有白兵；黑方反之
  const pawnRow = bySide === WHITE ? r + 1 : r - 1
  if (onBoard(pawnRow, c - 1)) {
    const p = board[indexOf(pawnRow, c - 1)]
    if (p !== EMPTY && sideOf(p) === bySide && typeOf(p) === PAWN) return true
  }
  if (onBoard(pawnRow, c + 1)) {
    const p = board[indexOf(pawnRow, c + 1)]
    if (p !== EMPTY && sideOf(p) === bySide && typeOf(p) === PAWN) return true
  }

  // 马
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const rr = r + dr
    const cc = c + dc
    if (!onBoard(rr, cc)) continue
    const p = board[indexOf(rr, cc)]
    if (p !== EMPTY && sideOf(p) === bySide && typeOf(p) === KNIGHT) return true
  }

  // 王（易位经过格检测用）
  for (const [dr, dc] of KING_OFFSETS) {
    const rr = r + dr
    const cc = c + dc
    if (!onBoard(rr, cc)) continue
    const p = board[indexOf(rr, cc)]
    if (p !== EMPTY && sideOf(p) === bySide && typeOf(p) === KING) return true
  }

  // 车/后（直）
  for (const [dr, dc] of ORTHO) {
    if (rayHits(board, r, c, dr, dc, bySide, ROOK, QUEEN)) return true
  }
  // 象/后（斜）
  for (const [dr, dc] of DIAG) {
    if (rayHits(board, r, c, dr, dc, bySide, BISHOP, QUEEN)) return true
  }
  return false
}

/** 沿一条射线找第一个子：是 bySide 的 a/b 类子即命中 */
function rayHits(
  board: readonly Piece[],
  r: number,
  c: number,
  dr: number,
  dc: number,
  bySide: Side,
  typeA: number,
  typeB: number,
): boolean {
  let rr = r + dr
  let cc = c + dc
  while (onBoard(rr, cc)) {
    const p = board[indexOf(rr, cc)]
    if (p !== EMPTY) {
      const t = typeOf(p)
      return sideOf(p) === bySide && (t === typeA || t === typeB)
    }
    rr += dr
    cc += dc
  }
  return false
}

/** 可变的搜索/走子位置：棋盘 + 行棋方 + 易位权 + 吃过路兵格 */
export interface MutablePosition {
  board: Piece[]
  sideToMove: Side
  castling: number
  epSquare: number | null
}

/** apply 的还原信息（undo 用） */
export interface UndoInfo {
  /** 移动前 from 上的原子（升变/易位还原靠它） */
  piece: Piece
  /** 被吃掉的子（吃过路兵时是被移走的那枚兵） */
  captured: Piece
  /** 被吃子所在格（吃过路兵时 ≠ to） */
  capturedIndex: number
  /** 应用前的易位权与吃过路兵格 */
  castling: number
  epSquare: number | null
  /** 这手是否易位（undo 要把车放回去） */
  wasCastle: boolean
}

/** 伪合法走子（不含"送将"过滤；易位的中间格/目标格不被攻击已在这里判） */
export function pseudoMoves(pos: MutablePosition): number[] {
  const { board, sideToMove: side, castling, epSquare } = pos
  const moves: number[] = []
  const opp = (side ^ 1) as Side

  for (let from = 0; from < CELLS; from++) {
    const piece = board[from] as Piece
    if (piece === EMPTY || sideOf(piece) !== side) continue
    const t = typeOf(piece)
    const r = rowOf(from)
    const c = colOf(from)

    if (t === KNIGHT || t === KING) {
      const offsets = t === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS
      for (const [dr, dc] of offsets) {
        const rr = r + dr
        const cc = c + dc
        if (!onBoard(rr, cc)) continue
        const target = board[indexOf(rr, cc)] as Piece
        if (target === EMPTY || sideOf(target) === opp) moves.push(packMove(from, indexOf(rr, cc)))
      }
    }

    if (t === ROOK || t === QUEEN || t === BISHOP) {
      const dirs = t === ROOK ? ORTHO : t === BISHOP ? DIAG : [...ORTHO, ...DIAG]
      for (const [dr, dc] of dirs) {
        let rr = r + dr
        let cc = c + dc
        while (onBoard(rr, cc)) {
          const idx = indexOf(rr, cc)
          const target = board[idx] as Piece
          if (target === EMPTY) {
            moves.push(packMove(from, idx))
          } else {
            if (sideOf(target) === opp) moves.push(packMove(from, idx))
            break
          }
          rr += dr
          cc += dc
        }
      }
    }

    if (t === PAWN) {
      const dir = side === WHITE ? -1 : 1
      const startRow = side === WHITE ? 6 : 1
      const one = indexOf(r + dir, c)
      if (board[one] === EMPTY) {
        moves.push(packMove(from, one))
        const two = indexOf(r + 2 * dir, c)
        if (r === startRow && board[two] === EMPTY) moves.push(packMove(from, two))
      }
      for (const dc of [-1, 1]) {
        if (!onBoard(r + dir, c + dc)) continue
        const capIndex = indexOf(r + dir, c + dc)
        const target = board[capIndex] as Piece
        if (target !== EMPTY && sideOf(target) === opp) {
          moves.push(packMove(from, capIndex))
        } else if (capIndex === epSquare) {
          // 吃过路兵：目标格是空格，被吃的兵在身后一格（apply 里处理）
          moves.push(packMove(from, capIndex))
        }
      }
    }
  }

  // 易位（王翼 / 后翼，双方）
  if (side === WHITE) {
    if (
      (castling & CASTLE_WK) !== 0 &&
      board[61] === EMPTY && board[62] === EMPTY &&
      !isSquareAttacked(board, 60, BLACK) &&
      !isSquareAttacked(board, 61, BLACK) &&
      !isSquareAttacked(board, 62, BLACK)
    ) {
      moves.push(packMove(60, 62))
    }
    if (
      (castling & CASTLE_WQ) !== 0 &&
      board[59] === EMPTY && board[58] === EMPTY && board[57] === EMPTY &&
      !isSquareAttacked(board, 60, BLACK) &&
      !isSquareAttacked(board, 59, BLACK) &&
      !isSquareAttacked(board, 58, BLACK)
    ) {
      moves.push(packMove(60, 58))
    }
  } else {
    if (
      (castling & CASTLE_BK) !== 0 &&
      board[5] === EMPTY && board[6] === EMPTY &&
      !isSquareAttacked(board, 4, WHITE) &&
      !isSquareAttacked(board, 5, WHITE) &&
      !isSquareAttacked(board, 6, WHITE)
    ) {
      moves.push(packMove(4, 6))
    }
    if (
      (castling & CASTLE_BQ) !== 0 &&
      board[3] === EMPTY && board[2] === EMPTY && board[1] === EMPTY &&
      !isSquareAttacked(board, 4, WHITE) &&
      !isSquareAttacked(board, 3, WHITE) &&
      !isSquareAttacked(board, 2, WHITE)
    ) {
      moves.push(packMove(4, 2))
    }
  }
  return moves
}

/** 应用一手棋（含易位联动、吃过路兵移除、升变、易位权与 epSquare 更新），返回还原信息 */
export function applyMoveOn(pos: MutablePosition, move: number): UndoInfo {
  const { board } = pos
  const from = moveFrom(move)
  const to = moveTo(move)
  const piece = board[from] as Piece
  const side = sideOf(piece)
  const t = typeOf(piece)

  const info: UndoInfo = {
    piece,
    captured: board[to] as Piece,
    capturedIndex: to,
    castling: pos.castling,
    epSquare: pos.epSquare,
    wasCastle: false,
  }

  board[to] = piece
  board[from] = EMPTY

  if (t === PAWN) {
    if (to === pos.epSquare) {
      // 吃过路兵：被吃的兵在与 from 同行、与 to 同列
      const capIndex = indexOf(rowOf(from), colOf(to))
      info.captured = board[capIndex] as Piece
      info.capturedIndex = capIndex
      board[capIndex] = EMPTY
    }
    const lastRank = side === WHITE ? 0 : 7
    if (rowOf(to) === lastRank) {
      // 升变：v1 自动升后（规则文案写明）
      board[to] = makePiece(side, QUEEN)
    }
  }

  pos.epSquare = null
  if (t === PAWN && Math.abs(rowOf(to) - rowOf(from)) === 2) {
    pos.epSquare = indexOf((rowOf(from) + rowOf(to)) / 2, colOf(from))
  }

  if (t === KING && Math.abs(colOf(to) - colOf(from)) === 2) {
    info.wasCastle = true
    const homeRow = rowOf(from)
    if (colOf(to) === 6) {
      board[indexOf(homeRow, 5)] = board[indexOf(homeRow, 7)] as Piece
      board[indexOf(homeRow, 7)] = EMPTY
    } else {
      board[indexOf(homeRow, 3)] = board[indexOf(homeRow, 0)] as Piece
      board[indexOf(homeRow, 0)] = EMPTY
    }
  }

  let castling = pos.castling
  if (t === KING) {
    castling &= side === WHITE ? ~(CASTLE_WK | CASTLE_WQ) : ~(CASTLE_BK | CASTLE_BQ)
  }
  if (t === ROOK) {
    if (from === 63) castling &= ~CASTLE_WK
    if (from === 56) castling &= ~CASTLE_WQ
    if (from === 7) castling &= ~CASTLE_BK
    if (from === 0) castling &= ~CASTLE_BQ
  }
  // 吃落在角格上的车：对方对应方向的易位权作废
  if (to === 63) castling &= ~CASTLE_WK
  if (to === 56) castling &= ~CASTLE_WQ
  if (to === 7) castling &= ~CASTLE_BK
  if (to === 0) castling &= ~CASTLE_BQ
  pos.castling = castling
  pos.sideToMove = (side ^ 1) as Side
  return info
}

/** 撤销一手棋（与 applyMoveOn 严格互逆） */
export function undoMoveOn(pos: MutablePosition, move: number, info: UndoInfo): void {
  const from = moveFrom(move)
  const to = moveTo(move)
  pos.board[from] = info.piece
  pos.board[to] = info.capturedIndex === to ? info.captured : EMPTY
  if (info.capturedIndex !== to) pos.board[info.capturedIndex] = info.captured
  if (info.wasCastle) {
    const homeRow = rowOf(from)
    if (colOf(to) === 6) {
      pos.board[indexOf(homeRow, 7)] = pos.board[indexOf(homeRow, 5)] as Piece
      pos.board[indexOf(homeRow, 5)] = EMPTY
    } else {
      pos.board[indexOf(homeRow, 0)] = pos.board[indexOf(homeRow, 3)] as Piece
      pos.board[indexOf(homeRow, 3)] = EMPTY
    }
  }
  pos.castling = info.castling
  pos.epSquare = info.epSquare
  pos.sideToMove = sideOf(info.piece)
}

/** 盘面上 side 的王所在格（无王返回 -1） */
export function kingIndexOf(board: readonly Piece[], side: Side): number {
  return board.indexOf(makePiece(side, KING))
}

/**
 * 在调用方自己的可变副本上求**合法**着法（伪合法 + 逐手试走后的送将过滤）。
 * 返回时位置与传入时逐格一致（供搜索与 perft 复用）。
 */
export function legalMovesOn(pos: MutablePosition): number[] {
  const moves = pseudoMoves(pos)
  const legal: number[] = []
  const mover = pos.sideToMove
  const kingIndex = kingIndexOf(pos.board, mover)
  if (kingIndex < 0) return legal
  for (const move of moves) {
    // 王自己走动时，要测的是**新格子**是否被攻击（含易位），不是旧格子
    const movingType = typeOf(pos.board[moveFrom(move)] as Piece)
    const info = applyMoveOn(pos, move)
    const kingSquare = movingType === KING ? moveTo(move) : kingIndex
    if (!isSquareAttacked(pos.board, kingSquare, (mover ^ 1) as Side)) legal.push(move)
    undoMoveOn(pos, move, info)
  }
  return legal
}

/** 可读的棋子字形（白=大写字母、黑=小写字母；测试与调试用） */
export function pieceLetter(piece: Piece): string {
  if (piece === EMPTY) return '.'
  const letters = ['', 'k', 'q', 'r', 'b', 'n', 'p']
  const letter = letters[typeOf(piece)] as string
  return sideOf(piece) === WHITE ? letter.toUpperCase() : letter
}
