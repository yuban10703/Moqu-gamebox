/**
 * 白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在已有棋子周围 1 格内的空点里等概率随机 —— 仍是「随机合法点」，
 *   但不会把白棋下到离战场很远的空角（那样棋局会变成玩家一个人的表演）；
 * - skilled：棋型启发式 —— 5 格窗口打分（连子越长越值钱）+ 堵对手（防御权重略高于进攻）；
 * - challenging：启发式排序后做 2~3 层 minimax（α-β 剪枝），挑最佳应手。
 *
 * 确定性约定：三档难度的随机性都来自 `createRng(seed + 游标)`，绝不使用 Math.random；
 * 每落一手白棋由调用方把游标 +1，因此同 seed + 同玩家动作序列必然得到同一局面。
 */
import { createRng, type Rng } from '@eink/core'
import {
  BLACK,
  BOARD_SIZE,
  CELLS,
  DIRECTIONS,
  EMPTY,
  WHITE,
  colOf,
  indexOf,
  makesFive,
  nearbyMoves,
  onBoard,
  otherSide,
  placeStone,
  rowOf,
  type Side,
  type Stone,
} from './board.js'
import type { DifficultyId } from './meta.js'

/** 搜索/启发式只看已有棋子周围 2 格内的空点（战术上够用，分支可控） */
const SEARCH_RADIUS = 2
/** 前瞻每一层最多展开的着法数：足够覆盖威胁点，又不会让分支爆炸 */
const BRANCH_LIMIT = 8
/** 根节点启发式排序后进入前瞻的着法数 */
const ROOT_LIMIT = 12
/** 候选点多于这个数时收窄到 2 层（中盘分支多，2 层已能看清对手的成五/活四） */
const DEEP_CANDIDATE_THRESHOLD = 28
/** 成五的分值：远大于任何中盘棋型，前瞻据此以胜负为先 */
const TERMINAL_SCORE = 1_000_000_000
/** 防御权重略大于 1：对手的成五/活四必须优先堵，不能只顾自己做大 */
const DEFENSE_WEIGHT = 1.15

/**
 * 5 格窗口的分值表（下标 = 窗口里己方子数，窗口内出现对手子则整窗作废）。
 * 越长的连子越值钱，且差距拉得很大，避免「两个二」被误判成比「一个三」更好。
 */
const WINDOW_SCORES: readonly number[] = [0, 1, 20, 240, 3600, 1_200_000]

/** 本轮难度对应的前瞻层数（需求要求 2~3 层） */
export function lookaheadDepth(board: readonly Stone[]): number {
  return nearbyMoves(board, SEARCH_RADIUS).length > DEEP_CANDIDATE_THRESHOLD ? 2 : 3
}

/**
 * 为白方选一手棋。返回 null 表示没有可选点（棋盘为空，正常对局不会走到这一步）。
 * `cursor` 是本局已经落下的白子数；调用方在真正落子后把它 +1。
 */
export function chooseOpponentMove(
  difficulty: DifficultyId,
  board: readonly Stone[],
  seed: number,
  cursor: number,
): number | null {
  const rng = createRng(seed + cursor)
  switch (difficulty) {
    case 'starter': {
      const moves = nearbyMoves(board, 1)
      return moves.length === 0 ? null : rng.pick(moves)
    }
    case 'skilled':
      return pickByHeuristic(board, rng)
    case 'challenging':
      return pickByLookahead(board, rng)
  }
}

/** 所有能立刻成五的空点（升序）。返回非空就说明该方一手取胜 */
export function immediateWins(board: readonly Stone[], side: Side): number[] {
  const wins: number[] = []
  for (let index = 0; index < CELLS; index++) {
    if (board[index] !== EMPTY) continue
    if (makesFive(board, index, side)) wins.push(index)
  }
  return wins
}

/**
 * 单点棋型分：把 index 当作已经放了 side 的子，扫描四条轴上包含它的 5 个窗口。
 * 窗口里只要有对手子（或越界）就整窗作废；否则按己方子数查表累加。
 * 好处是天然覆盖「跳三」「跳四」这类有间隙的棋型，不需要为每种棋型单独写规则。
 */
function pointScore(board: readonly Stone[], index: number, side: Side): number {
  const row = rowOf(index)
  const col = colOf(index)
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = -4; offset <= 0; offset++) {
      let own = 0
      let blocked = false
      for (let step = 0; step < 5; step++) {
        const r = row + (offset + step) * dr
        const c = col + (offset + step) * dc
        if (!onBoard(r, c)) {
          blocked = true
          break
        }
        const cell = indexOf(r, c)
        if (cell === index) {
          own++
          continue
        }
        const stone = board[cell]
        if (stone === side) own++
        else if (stone !== EMPTY) {
          blocked = true
          break
        }
      }
      if (!blocked) total += WINDOW_SCORES[own] ?? 0
    }
  }
  return total
}

/** 进攻 + 防守的合成分：既看自己下这里能得到什么，也看对手下这里能得到什么 */
function heuristicScore(board: readonly Stone[], index: number, side: Side): number {
  return pointScore(board, index, side) + pointScore(board, index, otherSide(side)) * DEFENSE_WEIGHT
}

/** 按启发式分降序排序，同分按索引升序（结果只取决于局面，与遍历顺序无关） */
function orderByScore(board: readonly Stone[], moves: readonly number[], side: Side): number[] {
  return moves
    .map((index) => ({ index, score: heuristicScore(board, index, side) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.index)
}

/** 在候选点里取启发式分最高的；同分在升序集合上按种子随机挑一个 */
function pickHighest(
  board: readonly Stone[],
  moves: readonly number[],
  side: Side,
  rng: Rng,
): number | null {
  if (moves.length === 0) return null
  let best = -Infinity
  let tied: number[] = []
  for (const index of moves) {
    const score = heuristicScore(board, index, side)
    if (score > best) {
      best = score
      tied = [index]
    } else if (score === best) {
      tied.push(index)
    }
  }
  return rng.pick(tied)
}

/**
 * 熟练档：先看自己能不能一手成五，再看对手有没有成五点必须堵，最后按启发式挑最好的点。
 * 这两步显式判定比只靠权重更可靠（例如同一格双方都能成五时，必须先落子取胜）。
 */
function pickByHeuristic(board: readonly Stone[], rng: Rng): number | null {
  const win = immediateWins(board, WHITE)
  if (win.length > 0) return rng.pick(win)
  const block = immediateWins(board, BLACK)
  const pool = block.length > 0 ? block : nearbyMoves(board, SEARCH_RADIUS)
  return pickHighest(board, pool, WHITE, rng)
}

/** 挑战档：在熟练档的战术判定之上，对启发式排序后的前若干个点做 α-β 前瞻 */
function pickByLookahead(board: readonly Stone[], rng: Rng): number | null {
  const win = immediateWins(board, WHITE)
  if (win.length > 0) return rng.pick(win)
  const block = immediateWins(board, BLACK)
  const pool = block.length > 0 ? block : nearbyMoves(board, SEARCH_RADIUS)
  if (pool.length === 0) return null

  const depth = lookaheadDepth(board)
  const root = orderByScore(board, pool, WHITE).slice(0, ROOT_LIMIT)
  let best = -Infinity
  let tied: number[] = []
  for (const index of root) {
    const placed = placeStone(board, index, WHITE)
    if (placed === null) continue
    const value = search(placed, BLACK, depth - 1, -Infinity, Infinity)
    if (value > best) {
      best = value
      tied = [index]
    } else if (value === best) {
      tied.push(index)
    }
  }
  if (tied.length === 0) return rng.pick(pool)
  // 同分着法按索引升序后再随机取一个：结果只取决于 (局面, seed, 游标)，可复现
  return rng.pick(tied.slice().sort((a, b) => a - b))
}

/**
 * minimax + α-β 剪枝，返回值一律是「白方视角」的分数。
 * 一落子就成五时直接返回终局分、不再递归 —— 既省时间，也避免深度不够时看不清胜负。
 */
function search(
  board: readonly Stone[],
  turn: Side,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth <= 0) return evaluate(board)
  const pool = nearbyMoves(board, SEARCH_RADIUS)
  if (pool.length === 0) return 0 // 盘满：平局
  const moves = orderByScore(board, pool, turn).slice(0, BRANCH_LIMIT)

  if (turn === WHITE) {
    let value = -Infinity
    for (const index of moves) {
      const placed = placeStone(board, index, WHITE)
      if (placed === null) continue
      const candidate = makesFive(placed, index, WHITE)
        ? TERMINAL_SCORE
        : search(placed, BLACK, depth - 1, alpha, beta)
      if (candidate > value) value = candidate
      if (value > alpha) alpha = value
      if (alpha >= beta) break
    }
    return value === -Infinity ? 0 : value
  }

  let value = Infinity
  for (const index of moves) {
    const placed = placeStone(board, index, BLACK)
    if (placed === null) continue
    const candidate = makesFive(placed, index, BLACK)
      ? -TERMINAL_SCORE
      : search(placed, WHITE, depth - 1, alpha, beta)
    if (candidate < value) value = candidate
    if (value < beta) beta = value
    if (alpha >= beta) break
  }
  return value === Infinity ? 0 : value
}

/**
 * 盘面评估（白方视角）：把所有「5 格窗口」的价值加起来 ——
 * 己方窗口加分、对手窗口减分，混色窗口无价值。
 * 逐窗口扫描比按棋子逐点数更快，也更稳定（不会重复计算同一条线）。
 */
export function evaluate(board: readonly Stone[]): number {
  let score = 0
  for (const [dr, dc] of DIRECTIONS) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (!onBoard(row + 4 * dr, col + 4 * dc)) continue
        let black = 0
        let white = 0
        for (let step = 0; step < 5; step++) {
          const stone = board[indexOf(row + step * dr, col + step * dc)]
          if (stone === BLACK) black++
          else if (stone === WHITE) white++
        }
        if (black > 0 && white > 0) continue
        if (white > 0) score += WINDOW_SCORES[white] ?? 0
        else if (black > 0) score -= WINDOW_SCORES[black] ?? 0
      }
    }
  }
  return score
}
