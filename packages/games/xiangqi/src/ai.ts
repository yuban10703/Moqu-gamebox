/**
 * 黑方（对手）策略：三档难度只改这一处，规则层与呈现层都不感知强度差异。
 *
 * - starter：在**合法**着法里等概率随机（随机源 `createRng(seed + 游标)`，绝不使用 Math.random）；
 * - skilled：2 层 α-β（自己一手 + 对手最佳应手）＋ 子力价值与位置项；
 * - challenging：3 层 α-β（分支过大时退到 2 层）＋ **MVV-LVA 走法排序**（先吃子、按被吃子价值排），
 *   并在每个节点做「无子可动 = 输」的终局判定，因此能找到一步杀。
 *
 * 确定性：同一 `(局面, 难度, seed, 游标)` 必然给出同一着法 ——
 * 搜索本身完全确定（着法顺序由排序键与着法编码决定），只有「同分着法取哪一个」用随机源定，
 * 而随机源只依赖 `(seed, 游标)`。三档都是纯函数：不修改传入的盘面、不读写任何外部状态。
 *
 * 性能：着法用整数编码、盘面用扁平数组就地 make/unmake、每个节点只复制一次盘面
 * （合法着法在原地上试走再回退），避免每层构造大量对象。
 */
import { createRng, type Rng } from '@eink/core'
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
  legalMoves,
  legalMovesOn,
  moveFrom,
  moveTo,
  otherSide,
  rowOf,
  sideOf,
  typeOf,
  undoMove,
  type Side,
} from './board.js'
import type { DifficultyId } from './meta.js'

/**
 * 子力价值（按兵种索引，单位约为「一个兵的百分之一」）。
 * 车 > 炮 ≈ 马 > 士 = 相 > 兵，与象棋通用估值同序。
 */
export const PIECE_VALUE: readonly number[] = [
  0, // EMPTY
  10_000, // KING：被将死就直接终局，这里只是一个很大的数
  200, // ADVISOR
  200, // ELEPHANT
  400, // HORSE
  900, // CHARIOT
  450, // CANNON
  100, // PAWN
]

/** 马的机动性权重：以「4 个可用点」为基准，多了加分、被憋住减分 */
const HORSE_MOBILITY = 4
/** 炮的机动性权重：略小于马（炮的价值更依赖炮架与局面） */
const CANNON_MOBILITY = 2

/** 各列的中心度（两翼低、中路高） */
const CENTER_FILE: readonly number[] = [0, 4, 8, 12, 14, 12, 8, 4, 0]

/** 兵/卒按推进程度的价值（红方视角的行号：行 6 是红兵起点，行 ≤ 4 已过河） */
const PAWN_RANK: readonly number[] = [60, 85, 80, 65, 45, 10, 0, 0, 0, 0]

/** 兵/卒的中路权重（边兵作用小） */
const PAWN_FILE: readonly number[] = [0, 2, 4, 8, 12, 8, 4, 2, 0]

/** 马靠边会被憋住，边线的马价值明显下降 */
const HORSE_FILE: readonly number[] = [-14, -6, 0, 2, 4, 2, 0, -6, -14]

/** 帅/将留在底线最安全（出到九宫上层容易被车马炮抽杀） */
const KING_RANK: readonly number[] = [-16, -8, 0, 0, 0, 0, 0, 0, 0, 0]

/** 马步偏移（模块级常量：评估函数在每个叶子节点都要用，不能每次新建数组） */
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

/** 直线方向（炮的机动性用） */
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

function buildTables(): number[][] {
  // 索引 0（空格）留一张全 0 表，避免调用处再判空
  const tables: number[][] = []
  for (let type = 0; type <= PAWN; type++) tables.push(new Array<number>(CELLS).fill(0))
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const index = row * 9 + col
      tables[KING]![index] = KING_RANK[row] as number
      tables[CHARIOT]![index] = CENTER_FILE[col] as number
      tables[CANNON]![index] = CENTER_FILE[col] as number
      // 马：中路 + 挺进对方半场（红方行号越小越靠前）
      tables[HORSE]![index] =
        (HORSE_FILE[col] as number) + Math.max(0, 6 - row) * 5 + (CENTER_FILE[col] as number) / 2
      tables[PAWN]![index] = (PAWN_RANK[row] as number) + (PAWN_FILE[col] as number)
      // 士/相在有固定岗位，不给位置分（价值全在子力上）
      tables[ADVISOR]![index] = 0
      tables[ELEPHANT]![index] = 0
    }
  }
  return tables
}

/** 位置价值表：红方视角的 90 格（黑方镜像取用）。
 *  必须在各分项常量之后求值 —— 否则模块初始化时会踩到 TDZ（const 尚未初始化）。 */
const PST: readonly (readonly number[])[] = buildTables()

/** 镜像格：把红方视角的表用到黑方身上（上下翻转，左右对称因此无需翻转列） */
function mirror(index: number): number {
  return (9 - rowOf(index)) * 9 + colOf(index)
}

/** 马在当前局面的可用落点数（只数不重复走子的机动性，用于评估） */
function horseMobility(board: readonly number[], from: number): number {
  const row = rowOf(from)
  const col = colOf(from)
  const side = sideOf(board[from] as number)
  let count = 0
  for (const [dr, dc] of HORSE_STEPS) {
    const r = row + dr
    const c = col + dc
    if (r < 0 || r > 9 || c < 0 || c > 8) continue
    const legRow = Math.abs(dr) === 2 ? row + dr / 2 : row
    const legCol = Math.abs(dc) === 2 ? col + dc / 2 : col
    if (board[legRow * 9 + legCol] !== EMPTY) continue
    const target = board[r * 9 + c] as number
    if (target !== EMPTY && sideOf(target) === side) continue
    count++
  }
  return count
}

/** 炮的可用落点数（不含吃子质量，只看活动空间） */
function cannonMobility(board: readonly number[], from: number): number {
  const row = rowOf(from)
  const col = colOf(from)
  const side = sideOf(board[from] as number)
  let count = 0
  for (const [dr, dc] of ORTHO) {
    let r = row + dr
    let c = col + dc
    while (r >= 0 && r <= 9 && c >= 0 && c <= 8 && board[r * 9 + c] === EMPTY) {
      count++
      r += dr
      c += dc
    }
    if (r < 0 || r > 9 || c < 0 || c > 8) continue
    // 越过炮架：只有找到敌子才有吃子点
    r += dr
    c += dc
    while (r >= 0 && r <= 9 && c >= 0 && c <= 8 && board[r * 9 + c] === EMPTY) {
      r += dr
      c += dc
    }
    if (r < 0 || r > 9 || c < 0 || c > 8) continue
    const target = board[r * 9 + c] as number
    if (sideOf(target) !== side) count++
  }
  return count
}

/**
 * 局面评估（**side 视角**，正数表示对 side 有利）：子力 + 位置项 + 马炮机动性。
 * 只遍历一遍棋盘，不做任何分配，因此在搜索叶子节点上也能跑得很快。
 */
export function evaluate(board: readonly number[], side: Side): number {
  let score = 0
  for (let index = 0; index < CELLS; index++) {
    const piece = board[index] as number
    if (piece === EMPTY) continue
    const owner = sideOf(piece)
    const type = typeOf(piece)
    const table = PST[type] as readonly number[]
    let value =
      (PIECE_VALUE[type] as number) + (table[owner === RED ? index : mirror(index)] as number)
    if (type === HORSE) value += (horseMobility(board, index) - 4) * HORSE_MOBILITY
    else if (type === CANNON) value += cannonMobility(board, index) * CANNON_MOBILITY
    score += owner === side ? value : -value
  }
  return score
}

/** 将死/困毙的分值（配合层数让「更快将死」优先）；远大于任何子力差 */
export const MATE_SCORE = 10_000_000

/** 深度上限对应的搜索层数：入门不搜、熟练 2 层、挑战 3 层（分支爆掉时退到 2 层） */
const SKILLED_DEPTH = 2
const CHALLENGING_DEPTH = 3
/** 根节点合法着法多到这个数以上时，挑战档退到 2 层，保证单步决策的时间上界 */
const WIDE_BRANCH = 44

/** 挑战档这次的搜索层数（只依赖局面，因此同局面必然同层数 —— 确定性不受影响） */
export function challengingDepth(board: readonly number[], side: Side): number {
  return legalMoves(board, side).length > WIDE_BRANCH ? SKILLED_DEPTH : CHALLENGING_DEPTH
}

/**
 * 走法排序（MVV-LVA）：先试吃子，被吃子越值钱、动用的子越便宜越靠前。
 * 同分按着法编码升序，保证顺序完全确定（与排序稳定性无关）。
 */
function orderMoves(board: readonly number[], moves: readonly number[]): number[] {
  const scored = moves.map((move) => {
    const target = board[moveTo(move)] as number
    const score =
      target === EMPTY
        ? 0
        : (PIECE_VALUE[typeOf(target)] as number) * 16 -
          (PIECE_VALUE[typeOf(board[moveFrom(move)] as number)] as number)
    return { move, score }
  })
  scored.sort((a, b) => b.score - a.score || a.move - b.move)
  return scored.map((entry) => entry.move)
}

/**
 * negamax + α-β。返回值是**轮到 side 走时**的分数（正数对 side 有利）。
 * 无合法着法（将死或困毙）直接返回负的将死分 —— 象棋里两种都算输。
 */
function negamax(
  work: number[],
  side: Side,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
): number {
  if (depth <= 0) return evaluate(work, side)
  const moves = legalMovesOn(work, side)
  if (moves.length === 0) return -MATE_SCORE + ply
  const ordered = orderMoves(work, moves)
  let best = -Infinity
  for (const move of ordered) {
    const captured = applyMove(work, move)
    const value = -negamax(work, otherSide(side), depth - 1, ply + 1, -beta, -alpha)
    undoMove(work, move, captured)
    if (value > best) best = value
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

/**
 * 根节点搜索：返回最佳着法；没有合法着法时返回 null。
 * 同分着法用随机源挑一个（结果只取决于局面与 (seed, 游标)，可复现），让同一难度的对局有变化。
 */
function searchBestMove(work: number[], side: Side, depth: number, rng: Rng): number | null {
  const moves = legalMovesOn(work, side)
  if (moves.length === 0) return null
  const ordered = orderMoves(work, moves)
  let best = -Infinity
  let tied: number[] = []
  let alpha = -Infinity
  for (const move of ordered) {
    const captured = applyMove(work, move)
    const value = -negamax(work, otherSide(side), depth - 1, 1, -Infinity, -alpha)
    undoMove(work, move, captured)
    if (value > best) {
      best = value
      tied = [move]
    } else if (value === best) {
      tied.push(move)
    }
    if (best > alpha) alpha = best
  }
  return rng.pick(tied)
}

/**
 * 为某一方选一手棋。`cursor` 是本局该方已经走过的步数（随机源游标）；
 * 调用方在真正落子后把它 +1。返回 null 表示该方无子可动（对局已经结束）。
 */
export function chooseMove(
  difficulty: DifficultyId,
  board: readonly number[],
  side: Side,
  seed: number,
  cursor: number,
): number | null {
  const rng = createRng(seed + cursor)
  switch (difficulty) {
    case 'starter': {
      // 入门档：合法着法里等概率随机（不是「随便走一步」——非法着法一律不选）
      const moves = legalMoves(board, side)
      return moves.length === 0 ? null : rng.pick(moves)
    }
    case 'skilled':
      return searchBestMove(board.slice(), side, SKILLED_DEPTH, rng)
    case 'challenging':
      return searchBestMove(board.slice(), side, challengingDepth(board, side), rng)
  }
}

/** 黑方（对手）应手。规则层只调这一个入口 */
export function chooseOpponentMove(
  difficulty: DifficultyId,
  board: readonly number[],
  seed: number,
  cursor: number,
): number | null {
  return chooseMove(difficulty, board, BLACK, seed, cursor)
}
