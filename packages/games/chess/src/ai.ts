/**
 * 黑方（对手）AI：三档难度、完全确定性（seed + 游标驱动，零 Math.random / 零时钟）。
 *
 * - starter：在合法着法里等概率随机（随机源 `createRng(seed + 游标)`）；
 * - skilled：一步前瞻（吃子优先 + 子力/位置评估）；
 * - challenging：3 层 α-β + MVV-LVA 着法排序 + 吃子静止搜索（4 层）。
 *
 * 评估函数**固定以白方视角**计分（白方优势为正），不含「轮到谁走谁占便宜」的项 ——
 * 那个项在深搜 + 静止搜索里会随叶子奇偶随机加减，把搜索系统性带歪
 * （本仓库在中国象棋/五子棋的对局引擎实验里实测踩过：同局面换边各自 +200）。
 */
import { createRng, type Rng } from '@eink/core'
import {
  BISHOP,
  BLACK,
  EMPTY,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  applyMoveOn,
  isSquareAttacked,
  kingIndexOf,
  legalMovesOn,
  moveFrom,
  moveTo,
  rowOf,
  sideOf,
  typeOf,
  undoMoveOn,
  type Piece,
  type Side,
} from './board.js'
import type { DifficultyId } from './meta.js'

/** AI 搜索用的位置（与规则层同构，不含回合日志） */
export interface AiPosition {
  board: Piece[]
  sideToMove: Side
  castling: number
  epSquare: number | null
}

/** 子力价值（兵 100 / 马 320 / 象 330 / 车 500 / 后 900 / 王不参与） */
const PIECE_VALUE: ReadonlyArray<number> = [0, 0, 900, 500, 330, 320, 100]
const MATE = 1000000

const valueOf = (piece: Piece): number => PIECE_VALUE[typeOf(piece)] ?? 0

/**
 * 白方视角的静态评估（正 = 白优）。只含子力 + 兵推进，**刻意不含行棋方加成**。
 */
export function evaluate(pos: AiPosition): number {
  let score = 0
  for (let index = 0; index < 64; index++) {
    const p = pos.board[index] as Piece
    if (p === EMPTY) continue
    const t = typeOf(p)
    let value = valueOf(p)
    if (t === PAWN) {
      // 兵越靠近底线越值钱（升变在望）
      const r = rowOf(index)
      value += sideOf(p) === WHITE ? (6 - r) * 5 : (r - 1) * 5
    }
    score += sideOf(p) === WHITE ? value : -value
  }
  return score
}

/** MVV-LVA 简化排序：吃子优先，吃大子更优先 */
function orderScore(pos: AiPosition, move: number): number {
  const target = pos.board[moveTo(move)] as Piece
  if (target === EMPTY) return 0
  return valueOf(target) * 10 - valueOf(pos.board[moveFrom(move)] as Piece)
}

/** 吃子静止搜索（防地平线效应：边缘外白丢子） */
function quiesce(pos: AiPosition, side: Side, alpha: number, beta: number, depth: number): number {
  const stand = side === WHITE ? evaluate(pos) : -evaluate(pos)
  if (depth <= 0) return stand
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  const caps = legalMovesOn(pos).filter((move) => pos.board[moveTo(move)] !== EMPTY)
  caps.sort((a, b) => orderScore(pos, b) - orderScore(pos, a))
  for (const move of caps) {
    const info = applyMoveOn(pos, move)
    const score = -quiesce(pos, (side ^ 1) as Side, -beta, -alpha, depth - 1)
    undoMoveOn(pos, move, info)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

function negamax(
  pos: AiPosition,
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  const moves = legalMovesOn(pos)
  if (moves.length === 0) {
    // 无子可动：被将死 = 输（国际象棋里逼和是平局，不是输）
    const king = kingIndexOf(pos.board, side)
    if (king >= 0 && isSquareAttacked(pos.board, king, (side ^ 1) as Side)) return -MATE + ply
    return 0
  }
  if (depth === 0) return quiesce(pos, side, alpha, beta, 4)
  moves.sort((a, b) => orderScore(pos, b) - orderScore(pos, a))
  let best = -Infinity
  for (const move of moves) {
    const info = applyMoveOn(pos, move)
    const score = -negamax(pos, (side ^ 1) as Side, depth - 1, -beta, -alpha, ply + 1)
    undoMoveOn(pos, move, info)
    if (score > best) best = score
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }
  return best
}

function pickBest(pos: AiPosition, side: Side, depth: number, _rng: Rng): number | null {
  const moves = legalMovesOn(pos)
  if (moves.length === 0) return null
  moves.sort((a, b) => orderScore(pos, b) - orderScore(pos, a))
  let bestMove = moves[0] as number
  let bestScore = -Infinity
  // 根节点每个着法都**全窗口**搜索取精确值：不能用逐步收缩的 alpha 窗口 ——
  // 窗口收缩会让后续着法 fail-high 成同一个上界，全平之后谁当选就靠"抖动"了，
  // 实测因此放过白送的后（本仓库在象棋引擎实验里踩过同款坑）。
  for (const move of moves) {
    const info = applyMoveOn(pos, move)
    const raw = -negamax(pos, (side ^ 1) as Side, depth - 1, -Infinity, Infinity, 1)
    undoMoveOn(pos, move, info)
    if (raw > bestScore) {
      bestScore = raw
      bestMove = move
    }
  }
  return bestMove
}

/**
 * 为黑方选一手棋。返回 null 表示没有可选点（正常对局不会走到这一步）。
 * `cursor` 是本局已经落下的黑子数；调用方在真正落子后把它 +1。
 */
export function chooseOpponentMove(
  difficulty: DifficultyId,
  pos: AiPosition,
  seed: number,
  cursor: number,
): number | null {
  const rng = createRng((seed + cursor) >>> 0)
  switch (difficulty) {
    case 'starter': {
      const moves = legalMovesOn(pos)
      if (moves.length === 0) return null
      return moves[rng.int(moves.length)] as number
    }
    case 'skilled':
      return pickBest(pos, BLACK, 1, rng)
    case 'challenging':
      return pickBest(pos, BLACK, 3, rng)
  }
}

// 供测试引用的常量
export { BISHOP, KNIGHT, PAWN, QUEEN, ROOK, MATE }
