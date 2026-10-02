/**
 * 游戏元信息与白方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * 为什么元信息放在 ai.ts：难度档就是「对手强度档」，而本文件是规则层与视图层共同依赖的
 * 最低层模块（rules 需要难度来选 AI，AI 本身也按难度分层）。把难度 id 放在这里可以避免
 * `rules ↔ ai` 出现依赖环，同时不必像五子棋那样单开 meta.ts。
 *
 * - starter：在所有未满的列里等概率随机 —— 仍是「随机合法列」，但不做任何战术判断；
 * - skilled：启发式 —— 自己一手成四就赢，对手一手成四就堵，否则按棋型分挑列；
 * - challenging：启发式 + 3~4 层 minimax（α-β 剪枝，固定分支上限），挑最佳应手。
 *
 * 确定性约定：三档难度的随机性都来自 `createRng(seed + 游标)`，绝不使用 Math.random；
 * 每落一手白棋由调用方把游标 +1，因此同 seed + 同玩家动作序列必然得到同一局面。
 */
import { IllegalActionError, createRng, type Rng } from '@eink/core'
import {
  BLACK,
  BOARD_COLS,
  BOARD_ROWS,
  CELLS,
  DIRECTIONS,
  EMPTY,
  WHITE,
  colOf,
  indexOf,
  isFull,
  landingIndex,
  makesFour,
  onBoard,
  otherSide,
  rowOf,
  validColumns,
  type Side,
  type Stone,
} from './board.js'

export const CONNECT4_ID = 'connect4'
/** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
export const CONNECT4_RULES_VERSION = 1
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const CONNECT4_CONTENT_VERSION = 1

/** 三档难度只影响白方（对手）强度，棋盘尺寸与规则完全相同 */
export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(CONNECT4_ID, `bad difficulty: ${value}`)
  return value
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `${CONNECT4_ID}.difficulty.${id}`
}

/** 成四的终局分：远大于任何中盘棋型，前瞻据此以胜负为先 */
const TERMINAL_SCORE = 1_000_000_000

/**
 * 4 格窗口的分值表（下标 = 窗口里己方子数，窗口内出现对手子则整窗作废）。
 * 2 子与 3 子的差距拉得很大：一个「活三」的价值远高于两个「二」。
 */
const WINDOW_SCORES: readonly number[] = [0, 1, 24, 420]

/** 防御权重略大于 1：对手的成四/活三必须优先堵，不能只顾自己做大 */
const DEFENSE_WEIGHT = 1.15

/**
 * 固定的分支上限 = 棋盘列数（7）。四子棋的分支天然被重力压到 7，
 * 因此这里就是**满宽搜索**：上限固定，是否剪枝只由 α-β 与启发式排序决定，
 * 与时间/机器无关，同局面必然搜到同一批着法。
 */
const BRANCH_LIMIT = BOARD_COLS

/** 中列加权：同样的子数，越靠中间的价值越高（这是四子棋最基本的局面常识） */
const COLUMN_WEIGHTS: readonly number[] = [0, 1, 2, 3, 2, 1, 0]
const CENTER_BONUS = 4

/** 候选列不超过这个数（至少两列已满/接近残局）时加深一层 */
const DEEP_CANDIDATE_THRESHOLD = 5

/** 本轮难度对应的前瞻层数（需求要求 3~4 层） */
export function lookaheadDepth(board: readonly Stone[]): number {
  return validColumns(board).length <= DEEP_CANDIDATE_THRESHOLD ? 4 : 3
}

/**
 * 为白方选一列。返回 null 表示没有任何未满的列（棋盘已满，正常对局不会走到这一步）。
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
    case 'starter':
      return pickRandom(board, rng)
    case 'skilled':
      return pickByHeuristic(board, rng)
    case 'challenging':
      return pickByLookahead(board, rng)
  }
}

function pickRandom(board: readonly Stone[], rng: Rng): number | null {
  const columns = validColumns(board)
  return columns.length === 0 ? null : rng.pick(columns)
}

/** 所有落子后立刻成四的列（升序）。返回非空就说明该方一手取胜 */
export function winningColumns(board: readonly Stone[], side: Side): number[] {
  const wins: number[] = []
  for (const column of validColumns(board)) {
    const index = landingIndex(board, column)
    if (index === null) continue
    if (makesFour(board, index, side)) wins.push(column)
  }
  return wins
}

/**
 * 单点棋型分：把 index 当作已经放了 side 的子，扫描四条轴上包含它的 4 格窗口。
 * 窗口里只要有对手子或越界就整窗作废；否则按己方子数查表累加。
 * 好处是天然覆盖「跳三」这类有间隙的棋型，不需要为每种棋型单独写规则。
 */
function pointScore(board: readonly Stone[], index: number, side: Side): number {
  const row = rowOf(index)
  const col = colOf(index)
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = -3; offset <= 0; offset++) {
      let own = 0
      let blocked = false
      for (let step = 0; step < 4; step++) {
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

/** 进攻 + 防守 + 中列偏好的合成分：既看自己下这里能得到什么，也看对手下这里能得到什么 */
function heuristicScore(board: readonly Stone[], column: number, side: Side): number {
  const index = landingIndex(board, column)
  if (index === null) return -Infinity
  return (
    pointScore(board, index, side) +
    pointScore(board, index, otherSide(side)) * DEFENSE_WEIGHT +
    COLUMN_WEIGHTS[column]! * CENTER_BONUS
  )
}

/** 按启发式分降序排序，同分按列号升序（结果只取决于局面，与遍历顺序无关） */
function orderColumns(board: readonly Stone[], columns: readonly number[], side: Side): number[] {
  return columns
    .map((column) => ({ column, score: heuristicScore(board, column, side) }))
    .sort((a, b) => b.score - a.score || a.column - b.column)
    .map((entry) => entry.column)
}

/** 在候选列里取启发式分最高的；同分在升序集合上按种子随机挑一个 */
function pickHighest(
  board: readonly Stone[],
  columns: readonly number[],
  side: Side,
  rng: Rng,
): number | null {
  if (columns.length === 0) return null
  let best = -Infinity
  let tied: number[] = []
  for (const column of columns) {
    const score = heuristicScore(board, column, side)
    if (score > best) {
      best = score
      tied = [column]
    } else if (score === best) {
      tied.push(column)
    }
  }
  return rng.pick(tied)
}

/**
 * 熟练档：先看自己能不能一手成四，再看对手有没有成四列必须堵，最后按启发式挑最好的列。
 * 这两步显式判定比只靠权重更可靠：同一列双方都能成四时，必须先落子取胜。
 */
function pickByHeuristic(board: readonly Stone[], rng: Rng): number | null {
  const win = winningColumns(board, WHITE)
  if (win.length > 0) return rng.pick(win)
  const block = winningColumns(board, BLACK)
  const pool = block.length > 0 ? block : validColumns(board)
  return pickHighest(board, pool, WHITE, rng)
}

/** 挑战档：在熟练档的战术判定之上，对启发式排序后的列做 α-β 前瞻 */
function pickByLookahead(board: readonly Stone[], rng: Rng): number | null {
  const win = winningColumns(board, WHITE)
  if (win.length > 0) return rng.pick(win)
  const block = winningColumns(board, BLACK)
  const pool = block.length > 0 ? block : validColumns(board)
  if (pool.length === 0) return null

  const depth = lookaheadDepth(board)
  const root = orderColumns(board, pool, WHITE).slice(0, BRANCH_LIMIT)
  let best = -Infinity
  let tied: number[] = []
  for (const column of root) {
    const index = landingIndex(board, column)
    if (index === null) continue
    const placed = board.slice()
    placed[index] = WHITE
    const value = makesFour(placed, index, WHITE)
      ? TERMINAL_SCORE
      : search(placed, BLACK, depth - 1, -Infinity, Infinity)
    if (value > best) {
      best = value
      tied = [column]
    } else if (value === best) {
      tied.push(column)
    }
  }
  if (tied.length === 0) return rng.pick(pool)
  // 同分着法按列号升序后再随机取一个：结果只取决于 (局面, seed, 游标)，可复现
  return rng.pick(tied.slice().sort((a, b) => a - b))
}

/**
 * minimax + α-β 剪枝，返回值一律是「白方视角」的分数。
 * 一落子就成四时直接返回终局分、不再递归 —— 既省时间，也避免深度不够时看不清胜负。
 */
function search(
  board: readonly Stone[],
  turn: Side,
  depth: number,
  alpha: number,
  beta: number,
): number {
  // 盘满且无人成四 = 平局；放在深度判断之前，避免把「填满的盘面」评估成优势
  if (isFull(board)) return 0
  if (depth <= 0) return evaluate(board)
  const pool = validColumns(board)
  if (pool.length === 0) return 0
  const moves = orderColumns(board, pool, turn).slice(0, BRANCH_LIMIT)

  if (turn === WHITE) {
    let value = -Infinity
    for (const column of moves) {
      const index = landingIndex(board, column)
      if (index === null) continue
      const placed = board.slice()
      placed[index] = WHITE
      const candidate = makesFour(placed, index, WHITE)
        ? TERMINAL_SCORE
        : search(placed, BLACK, depth - 1, alpha, beta)
      if (candidate > value) value = candidate
      if (value > alpha) alpha = value
      if (alpha >= beta) break
    }
    return value === -Infinity ? 0 : value
  }

  let value = Infinity
  for (const column of moves) {
    const index = landingIndex(board, column)
    if (index === null) continue
    const placed = board.slice()
    placed[index] = BLACK
    const candidate = makesFour(placed, index, BLACK)
      ? -TERMINAL_SCORE
      : search(placed, WHITE, depth - 1, alpha, beta)
    if (candidate < value) value = candidate
    if (value < beta) beta = value
    if (alpha >= beta) break
  }
  return value === Infinity ? 0 : value
}

/**
 * 盘面评估（白方视角）：把所有「4 格窗口」的价值加起来 ——
 * 己方窗口加分、对手窗口减分，混色窗口无价值；再加上中列偏好。
 * 逐窗口扫描比按棋子逐点数更快，也更稳定（不会重复计算同一条线）。
 */
export function evaluate(board: readonly Stone[]): number {
  let score = 0
  for (const [dr, dc] of DIRECTIONS) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        if (!onBoard(row + 3 * dr, col + 3 * dc)) continue
        let black = 0
        let white = 0
        for (let step = 0; step < 4; step++) {
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
  for (let index = 0; index < CELLS; index++) {
    const stone = board[index]
    if (stone === EMPTY) continue
    const weighted = COLUMN_WEIGHTS[colOf(index)]! * CENTER_BONUS
    score += stone === WHITE ? weighted : -weighted
  }
  return score
}
