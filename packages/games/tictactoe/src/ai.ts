/**
 * 对手（后手 ○）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在空格里等概率随机 —— 但有约四分之一的概率抓住**送到眼前**的成线机会。
 *   它因此会看漏、会输，这正是「入门」该有的样子（每手必堵的入门档等于没有难度）；
 * - skilled：贪心三步 —— 能赢就赢、对手要赢就堵，否则占中心、再占角（角比边值钱）；
 * - challenging：完整 minimax —— **绝不输**，玩家下得再好也只是和局。
 *   3×3 的全树只有几十万个节点，算全比写启发式更简单也更可靠（不需要评估函数）。
 *
 * 确定性约定：全部随机性来自 `createRng(seed + 游标)`，绝不使用 Math.random；
 * 每落一手对手的棋由调用方把游标 +1（同 seed + 同玩家动作序列必然得到同一局面）。
 */
import { createRng, type Rng } from '@eink/core'
import {
  CENTER,
  CORNERS,
  EMPTY,
  emptyCells,
  isFull,
  lineOf,
  otherSide,
  placeMark,
  winningMoves,
  type Mark,
  type Side,
} from './board.js'

/** 三档对手强度（第四档「双人同屏」没有电脑，不属于对手档） */
export const OPPONENT_LEVELS = ['starter', 'skilled', 'challenging'] as const
export type OpponentLevel = (typeof OPPONENT_LEVELS)[number]

/**
 * 入门档抓住成线机会的概率。
 * 刻意取小（四分之一）：入门档要**经常**看漏，玩家才有机会赢下第一局。
 */
const STARTER_TAKE_WIN_CHANCE = 0.25

/**
 * 终局分（赢 = +WIN_SCORE）。分数再按「已经下了几手」加减：
 * 越早赢分越高、越晚输分越高 —— 没有这一层，AI 会在必胜局面里随便绕圈子（多下几步也无所谓）。
 */
const WIN_SCORE = 10

/**
 * 为 `side`（对电脑时就是后手 ○）选一手。
 * 返回 null 表示没有空格（对局已结束，正常流程不会走到这里，调用方也只在对局中才问）。
 * `cursor` 是本局已经落下的手数（= 日志长度），由调用方在真正落子后递增。
 */
export function chooseOpponentMove(
  level: OpponentLevel,
  board: readonly Mark[],
  side: Side,
  seed: number,
  cursor: number,
): number | null {
  const moves = emptyCells(board)
  if (moves.length === 0) return null
  const rng = createRng(seed + cursor)
  switch (level) {
    case 'starter': {
      // 先掷一次骰子决定「这次看不看得见成线机会」，再在候选里随机挑一个
      const wins = winningMoves(board, side)
      if (wins.length > 0 && rng.next() < STARTER_TAKE_WIN_CHANCE) return rng.pick(wins)
      return rng.pick(moves)
    }
    case 'skilled':
      return pickGreedy(board, side, rng)
    case 'challenging':
      return pickBest(board, side, (tied) => rng.pick(tied))
  }
}

/**
 * 提示用：当前该走的那一方的最优解（与挑战档共用同一套搜索，因此提示给出的就是这个局面的正解）。
 * 同分着法直接取索引最小的那个：提示要么是唯一的，要么几条都对，不必掷骰子。
 */
export function bestMove(board: readonly Mark[], side: Side): number | null {
  return pickBest(board, side, (tied) => tied[0]!)
}

/**
 * 熟练档：能赢就赢 → 对手要赢就堵 → 占中心 → 占角 → 剩下的边。
 * 前两步用显式判定而不是靠权重，避免「同一格双方都能成线」时把必胜的一手让出去。
 */
function pickGreedy(board: readonly Mark[], side: Side, rng: Rng): number {
  const win = winningMoves(board, side)
  if (win.length > 0) return win[0]!
  const block = winningMoves(board, otherSide(side))
  if (block.length > 0) return block[0]!
  if (board[CENTER] === EMPTY) return CENTER
  const corners = CORNERS.filter((index) => board[index] === EMPTY)
  if (corners.length > 0) return rng.pick(corners)
  return rng.pick(emptyCells(board))
}

/**
 * 完整 minimax 挑点（挑战档与提示共用）：返回 `side` 的最佳落点。
 * 有一步取胜的着法就直接走（既快又不会因为深度记分把必胜看成和棋）；
 * 其余情况由 `pickTie` 在**同分**着法里决定取哪一个（挑战档随机、提示取最小索引）。
 */
function pickBest(
  board: readonly Mark[],
  side: Side,
  pickTie: (tied: readonly number[]) => number,
): number | null {
  const moves = emptyCells(board)
  if (moves.length === 0) return null
  const wins = winningMoves(board, side)
  if (wins.length > 0) return pickTie(wins)

  let best = -Infinity
  let tied: number[] = []
  for (const index of moves) {
    const placed = placeMark(board, index, side)
    if (placed === null) continue
    const value = search(placed, otherSide(side), side, 1, -Infinity, Infinity)
    if (value > best) {
      best = value
      tied = [index]
    } else if (value === best) {
      tied.push(index)
    }
  }
  return tied.length === 0 ? null : pickTie(tied.sort((a, b) => a - b))
}

/**
 * minimax + α-β 剪枝：返回值一律是 `me` 视角的分数。
 *
 * `ply` 是**已经落下**的手数（根节点下第一手为 1）。终局在「上一手落子的一方连成线」时判定 ——
 * 不需要单独判断当前该走的一方，因为只有刚落子的那一方可能连成线。
 */
function search(
  board: readonly Mark[],
  turn: Side,
  me: Side,
  ply: number,
  alpha: number,
  beta: number,
): number {
  const mover = otherSide(turn)
  if (lineOf(board, mover) !== null) {
    return mover === me ? WIN_SCORE - ply : ply - WIN_SCORE
  }
  if (isFull(board)) return 0

  const moves = emptyCells(board)
  if (turn === me) {
    let value = -Infinity
    for (const index of moves) {
      const placed = placeMark(board, index, turn)
      if (placed === null) continue
      value = Math.max(value, search(placed, mover, me, ply + 1, alpha, beta))
      alpha = Math.max(alpha, value)
      if (alpha >= beta) break
    }
    return value
  }
  let value = Infinity
  for (const index of moves) {
    const placed = placeMark(board, index, turn)
    if (placed === null) continue
    value = Math.min(value, search(placed, mover, me, ply + 1, alpha, beta))
    beta = Math.min(beta, value)
    if (alpha >= beta) break
  }
  return value
}
