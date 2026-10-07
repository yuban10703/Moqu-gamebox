/**
 * 对手（白方）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * 确定性约定：白方的全部随机性都来自 `createRng(seed + 游标)`，
 * 绝不使用 Math.random —— 同 seed + 同玩家动作序列必须双端完全一致。
 * 每落一手白棋，游标由调用方 +1（与难度无关），因此
 * 「棋子总数 = 4 + 玩家步数 + 游标」这条不变量在三档难度下都成立，
 * `decode` 用它来拒绝被篡改的存档。
 */
import { createRng, type Rng } from '@eink/core'
import {
  BLACK,
  EMPTY,
  WEIGHTS,
  WHITE,
  countDiscs,
  flipsFor,
  legalMovesFor,
  placeDisc,
  positionalWeight,
  type Disc,
  type Side,
} from './board.js'
import type { DifficultyId } from './meta.js'

/** 行动力在评估里的权重：黑白棋中「能下的点更多」通常比一时多吃几子更重要 */
const MOBILITY_WEIGHT = 12
/** 终局分数：远大于任何中盘评估，保证前瞻以胜负为先 */
const TERMINAL_SCORE = 1_000_000
/** 开局空格多时收窄到 2 层，避免每手都做全盘三层的无用功（难度仍高于 skilled） */
const OPENING_EMPTY_THRESHOLD = 48

/** 各档前瞻层数（供测试与文档引用） */
export function lookaheadDepth(board: readonly Disc[]): number {
  return countDiscs(board).empty > OPENING_EMPTY_THRESHOLD ? 2 : 3
}

/**
 * 为白方选一手棋。返回 null 表示白方无处可下（调用方负责过手）。
 * `cursor` 是本局已经消耗的随机数个数；调用方在真正落子后把它 +1。
 */
export function chooseOpponentMove(
  difficulty: DifficultyId,
  board: readonly Disc[],
  seed: number,
  cursor: number,
): number | null {
  const moves = legalMovesFor(board, WHITE)
  if (moves.length === 0) return null
  const rng = createRng(seed + cursor)
  switch (difficulty) {
    case 'starter':
      // 入门：在合法落点里等概率乱下（仍然只用种子随机，保证可复现）
      return rng.pick(moves)
    case 'skilled':
      // 熟练：贪心 + 角位加权，同分时按种子随机挑一个，避免每局第一步都一模一样
      return pickByGreedy(board, moves, rng)
    case 'challenging':
      // 挑战：在贪心的基础上做 2~3 层 minimax（含行动力与角位评估）
      return pickByLookahead(board, moves, rng)
  }
}

function pickByGreedy(board: readonly Disc[], moves: readonly number[], rng: Rng): number {
  let best = -Infinity
  let tied: number[] = []
  for (const index of moves) {
    // 权重放大 16 倍再叠加翻转数：翻转数只在同权重时起作用（最大差值 12 < 5*16）
    const score = WEIGHTS[index]! * 16 + flipsFor(board, index, WHITE).length
    if (score > best) {
      best = score
      tied = [index]
    } else if (score === best) {
      tied.push(index)
    }
  }
  return rng.pick(tied)
}

function pickByLookahead(board: readonly Disc[], moves: readonly number[], rng: Rng): number {
  const depth = lookaheadDepth(board)
  let best = -Infinity
  let tied: number[] = []
  for (const index of orderMoves(moves)) {
    const placed = placeDisc(board, index, WHITE)
    if (placed === null) continue
    const value = minimax(placed.board, BLACK, depth - 1, -Infinity, Infinity)
    if (value > best) {
      best = value
      tied = [index]
    } else if (value === best) {
      tied.push(index)
    }
  }
  // 同分着法按索引升序排列后再随机取一个：结果只取决于 (seed, cursor)，可复现
  return rng.pick(tied.slice().sort((a, b) => a - b))
}

/** 先搜权重高的点，让 α-β 剪枝更早生效（顺序不影响最终取值） */
function orderMoves(moves: readonly number[]): number[] {
  return moves.slice().sort((a, b) => WEIGHTS[b]! - WEIGHTS[a]! || a - b)
}

/**
 * minimax + α-β 剪枝，返回值一律是「白方视角」的分数。
 * 一方无棋可下时按规则过手：过手不消耗深度，否则深度会被连续过手提前耗尽。
 */
function minimax(board: readonly Disc[], turn: Side, depth: number, alpha: number, beta: number): number {
  const moves = legalMovesFor(board, turn)
  if (moves.length === 0) {
    const opponentMoves = legalMovesFor(board, turn === WHITE ? BLACK : WHITE)
    if (opponentMoves.length === 0) return terminalScore(board)
    return minimax(board, turn === WHITE ? BLACK : WHITE, depth, alpha, beta)
  }
  if (depth <= 0) return evaluate(board)

  const ordered = orderMoves(moves)
  if (turn === WHITE) {
    let value = -Infinity
    for (const index of ordered) {
      const placed = placeDisc(board, index, WHITE)
      if (placed === null) continue
      value = Math.max(value, minimax(placed.board, BLACK, depth - 1, alpha, beta))
      alpha = Math.max(alpha, value)
      if (alpha >= beta) break
    }
    return value
  }
  let value = Infinity
  for (const index of ordered) {
    const placed = placeDisc(board, index, BLACK)
    if (placed === null) continue
    value = Math.min(value, minimax(placed.board, WHITE, depth - 1, alpha, beta))
    beta = Math.min(beta, value)
    if (alpha >= beta) break
  }
  return value
}

/** 终局评估：以棋子数差定胜负，平局为 0 */
function terminalScore(board: readonly Disc[]): number {
  const { black, white } = countDiscs(board)
  if (white === black) return 0
  const margin = white - black
  return white > black ? TERMINAL_SCORE + margin : -TERMINAL_SCORE + margin
}

/** 中盘评估 = 位置权重差 + 行动力差 */
export function evaluate(board: readonly Disc[]): number {
  let positional = 0
  for (let index = 0; index < board.length; index++) {
    const disc = board[index]
    if (disc === EMPTY) continue
    positional += (disc === WHITE ? 1 : -1) * positionalWeight(board, index)
  }
  const mobility = legalMovesFor(board, WHITE).length - legalMovesFor(board, BLACK).length
  return positional + mobility * MOBILITY_WEIGHT
}
