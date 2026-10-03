/**
 * 白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在**全部合法回合**里等概率随机（吃子必须吃由着法生成保证）；
 * - skilled：贪心 + 1 层 —— 回合分值 = 立即吃到的子力 + 局面评估 − 对手下一步能吃掉的最大子力；
 * - challenging：启发式排序后做 4 层 negamax（α-β 剪枝），根节点/内层都设**固定分支上限**。
 *
 * 确定性约定：随机性只来自调用方传入的 `createRng(seed + 游标)`，绝不使用 Math.random；
 * 分支上限是**固定常量**、着法排序带下标兜底，因此同 seed + 同局面必然选出同一着法。
 */
import { createRng, type Rng } from '@eink/core'
import {
  BLACK,
  BOARD_SIZE,
  EMPTY,
  KING_VALUE,
  MAN_VALUE,
  PLAYABLE_INDEXES,
  WHITE,
  applyTurn,
  captureMovesFor,
  enumerateTurns,
  isKing,
  otherSide,
  pieceValue,
  promotedPiece,
  rowOf,
  sideOf,
  turnCapturedValue,
  type DifficultyId,
  type Piece,
  type Side,
  type Turn,
} from './board.js'

/** 三档难度的前瞻层数：一个完整回合算一层 */
export const LOOKAHEAD_DEPTH: Record<DifficultyId, number> = {
  starter: 0,
  skilled: 1,
  challenging: 4,
}

/** 根节点进入搜索的候选上限（固定值，保证搜索代价与结果可复现） */
export const ROOT_LIMIT: Record<DifficultyId, number> = {
  starter: 512,
  skilled: 24,
  challenging: 12,
}

/** 搜索内层每层展开的候选上限 */
export const BRANCH_LIMIT = 8

/** 枚举完整回合的安全上限（连跳分支极端膨胀时按确定顺序截断） */
export const ENUM_LIMIT = 512

/** 无子可动视为输棋；用远小于任何真实评估值的常量表示 */
const LOSS_SCORE = -1_000_000

/** 兵每前进一步的加权：让 AI 不只是在原地磨蹭 */
const ADVANCEMENT_WEIGHT = 4

/** 立即吃子的加权：优先吃掉眼前的子（材料优势最终也会体现在评估里） */
const CAPTURE_WEIGHT = 3

/** 局面评估（从 side 的视角）：子力 + 兵的前进程度 */
export function evaluateBoard(board: readonly Piece[], side: Side): number {
  let score = 0
  for (const index of PLAYABLE_INDEXES) {
    const piece = board[index]!
    if (piece === EMPTY) continue
    const value = pieceValue(piece) + advancementBonus(piece, index)
    score += sideOf(piece) === side ? value : -value
  }
  return score
}

function advancementBonus(piece: Piece, index: number): number {
  if (isKing(piece)) return 0
  const row = rowOf(index)
  // 黑方向上走（行号减小），白方向下走
  const advanced = sideOf(piece) === BLACK ? BOARD_SIZE - 1 - row : row
  return advanced * ADVANCEMENT_WEIGHT
}

/** 该方一个回合最多能吃掉多少子力（没有吃子则为 0） */
export function maxCapturedValue(board: readonly Piece[], side: Side): number {
  if (captureMovesFor(board, side).length === 0) return 0
  let best = 0
  for (const turn of enumerateTurns(board, side, 64)) {
    const value = turnCapturedValue(board, turn)
    if (value > best) best = value
  }
  return best
}

/** 升王奖励：让搜索愿意把兵送到对方底线 */
function promotionBonus(board: readonly Piece[], turn: Turn): number {
  const last = turn[turn.length - 1]
  if (last === undefined) return 0
  const piece = board[last.from]!
  return promotedPiece(piece, last.to) !== piece ? KING_VALUE - MAN_VALUE : 0
}

/** 着法排序：吃得多、能升王的排前面；同分用原始下标兜底，保证顺序稳定 */
export function orderTurns(board: readonly Piece[], turns: readonly Turn[]): Turn[] {
  return turns
    .map((turn, index) => ({
      turn,
      index,
      score: turnCapturedValue(board, turn) * 2 + promotionBonus(board, turn),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.turn)
}

/** 贪心（skilled）用的回合分值：立即收益 + 局面 − 对手的反吃威胁 */
function greedyScore(board: readonly Piece[], side: Side, turn: Turn): number {
  const next = applyTurn(board, turn)
  const captured = turnCapturedValue(board, turn) * CAPTURE_WEIGHT
  return captured + evaluateBoard(next, side) - maxCapturedValue(next, otherSide(side))
}

function pickBestByScore(
  turns: readonly Turn[],
  scoreOf: (turn: Turn) => number,
  rng: Rng,
): Turn {
  let best = -Infinity
  let bestTurns: Turn[] = []
  for (const turn of turns) {
    const score = scoreOf(turn)
    if (score > best) {
      best = score
      bestTurns = [turn]
    } else if (score === best) {
      bestTurns.push(turn)
    }
  }
  // 同分着法用确定性随机源挑一个：强度不变，但同分时不会永远走同一条线
  return rng.pick(bestTurns)
}

function negamax(
  board: readonly Piece[],
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth <= 0) return evaluateBoard(board, side)
  const turns = orderTurns(board, enumerateTurns(board, side, ENUM_LIMIT)).slice(
    0,
    BRANCH_LIMIT,
  )
  // 无子可动（或子被吃光）= 输：越早输越糟，所以带一点深度惩罚
  if (turns.length === 0) return LOSS_SCORE + (10 - depth)
  let value = -Infinity
  let lower = alpha
  for (const turn of turns) {
    const next = applyTurn(board, turn)
    const score = -negamax(next, otherSide(side), depth - 1, -beta, -lower)
    if (score > value) value = score
    if (value > lower) lower = value
    if (lower >= beta) break
  }
  return value
}

/** 为一个完整回合选着法（`side` 通常是白方，但函数本身不假设） */
export function chooseTurn(
  board: readonly Piece[],
  side: Side,
  difficulty: DifficultyId,
  rng: Rng,
): Turn {
  const turns = enumerateTurns(board, side, ENUM_LIMIT)
  if (turns.length === 0) throw new Error('checkers: no legal turn')
  if (difficulty === 'starter') return rng.pick(turns)
  if (difficulty === 'skilled') {
    return pickBestByScore(turns, (turn) => greedyScore(board, side, turn), rng)
  }
  const ordered = orderTurns(board, turns).slice(0, ROOT_LIMIT[difficulty])
  const depth = LOOKAHEAD_DEPTH[difficulty]
  return pickBestByScore(
    ordered,
    (turn) => -negamax(applyTurn(board, turn), otherSide(side), depth - 1, -Infinity, Infinity),
    rng,
  )
}

/**
 * 白方应手入口：游标是本局已经应手过的白方回合数，调用方在真正应手后把它 +1。
 * 这里自己创建 `createRng(seed + cursor)`，与规则层的确定性约定一致。
 */
export function chooseOpponentTurn(
  difficulty: DifficultyId,
  board: readonly Piece[],
  seed: number,
  cursor: number,
): Turn {
  return chooseTurn(board, WHITE, difficulty, createRng(seed + cursor))
}

/** 棋子价值常量在 AI 模块再导出一次，方便测试断言 */
export { KING_VALUE, MAN_VALUE }
