/**
 * 题目生成（确定性）。
 *
 * 流程：
 *   1. 用 `createRng(seed)`（mulberry32）造一个完整合法解；
 *   2. 按「旋转对称组」整体挖空：一个格子与它绕中心旋转 180° 的伙伴同组，
 *      每挖一组就用解计数求解器验一次唯一性（数到 2 个解即否决并回填）；
 *   3. 提示数降到难度目标值即停。
 *
 * 三个关键取舍：
 * - **绝不使用 Math.random**：随机数全部来自 `createRng(seed)`；同 seed 同难度必然同题。
 * - **每一组挖空都验唯一解**（硬要求），而不是先挖完再验；否决即回填，候选态始终唯一。
 * - 挖空是「降到目标以下就收」而不是「必须等于目标」：一组一次去掉 2 个提示，
 *   可能一步越过目标；宁可提示数略少（题更难）也不为凑数继续挖（耗时不可控）。
 */
import { IllegalActionError, createRng, type Rng } from '@eink/core'
import {
  SUDOKU_CELLS,
  SUDOKU_MIN_CLUES,
  SUDOKU_SIZE,
  countSolutions,
  createGrid,
  isUnique,
  solve,
  solveBySingles,
  type Grid,
} from './solver.js'

export const SUDOKU_ID = 'sudoku'
export const SUDOKU_SIZE_FULL = SUDOKU_SIZE

/** 难度档位：提示数递减 */
export type DifficultyId = 'starter' | 'skilled' | 'challenging'

export const DIFFICULTY_IDS: readonly DifficultyId[] = ['starter', 'skilled', 'challenging']

/** 每档的目标提示数（入门 / 熟练 / 挑战 = 45 / 34 / 26） */
export const CLUE_TARGETS: Record<DifficultyId, number> = {
  starter: 45,
  skilled: 34,
  challenging: 26,
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `sudoku.difficulty.${id}`
}

export function asDifficulty(value: string): DifficultyId {
  if ((DIFFICULTY_IDS as readonly string[]).includes(value)) return value as DifficultyId
  throw new IllegalActionError(SUDOKU_ID, `sudoku.illegal.difficulty:${value}`)
}

export interface Puzzle {
  difficulty: DifficultyId
  /** 题目（提示数之外为 0） */
  given: Grid
  /** 唯一的完整解 */
  solution: Grid
  /** 题目里的提示数个数 */
  clueCount: number
}

/** 造一个完整合法解：等价于对一个空盘找一个随机解 */
function randomSolution(rng: Rng): Grid {
  const grid = createGrid()
  if (!solve(grid, rng)) {
    // 空盘一定有解；走到这里说明求解器坏了，明确报错而不是继续
    throw new Error('sudoku: failed to build a complete solution')
  }
  return grid
}

/** 绕中心旋转 180° 的对称位置（对称挖空观感整齐，也顺手把计算量减半） */
function mirrorIndex(index: number): number {
  return SUDOKU_CELLS - 1 - index
}

/** 一个格子及其镜像组成的挖空组（优先整体挖，保持题目对称） */
function removalGroup(index: number): number[] {
  const mirror = mirrorIndex(index)
  return mirror === index ? [index] : [index, mirror]
}

/** 统计每个空格当前可填数字的个数（MRV 值） */
function optionCounts(grid: Grid): Int32Array {
  const rowUsed = new Int32Array(SUDOKU_SIZE)
  const colUsed = new Int32Array(SUDOKU_SIZE)
  const boxUsed = new Int32Array(SUDOKU_SIZE)
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    const value = grid[index]!
    if (value === 0) continue
    const bit = 1 << (value - 1)
    const row = (index / SUDOKU_SIZE) | 0
    const col = index % SUDOKU_SIZE
    rowUsed[row]! |= bit
    colUsed[col]! |= bit
    boxUsed[((row / 3) | 0) * 3 + ((col / 3) | 0)]! |= bit
  }
  const out = new Int32Array(SUDOKU_CELLS)
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    if (grid[index] !== 0) continue
    const row = (index / SUDOKU_SIZE) | 0
    const col = index % SUDOKU_SIZE
    const box = ((row / 3) | 0) * 3 + ((col / 3) | 0)
    let mask = 0x1ff & ~(rowUsed[row]! | colUsed[col]! | boxUsed[box]!)
    let count = 0
    while (mask !== 0) {
      count += mask & 1
      mask >>= 1
    }
    out[index] = count
  }
  return out
}

function countClues(grid: Grid): number {
  let count = 0
  for (let index = 0; index < SUDOKU_CELLS; index++) if (grid[index] !== 0) count++
  return count
}

interface Candidate {
  group: number[]
  /** 组内格子的最小候选数（越小越先挖，唯一性检查的搜索树越小） */
  options: number
}

/**
 * 收集本轮可挖的组，按 MRV 升序排序；次序用种子洗牌固定，
 * 因此同 seed 的挖空顺序完全一致。
 */
function digCandidates(grid: Grid, rng: Rng, pool: readonly number[]): Candidate[] {
  const options = optionCounts(grid)
  const seen = new Set<number>()
  const items: Candidate[] = []
  for (const index of pool) {
    if (seen.has(index) || grid[index] === 0) continue
    const group = removalGroup(index).filter((cell) => grid[cell] !== 0)
    if (group.length === 0) continue
    // 伙伴格在后续遍历里直接跳过，保证每个组只处理一次
    for (const cell of group) seen.add(cell)
    seen.add(mirrorIndex(index))
    let min = SUDOKU_SIZE + 1
    for (const cell of group) min = Math.min(min, options[cell]!)
    items.push({ group, options: min })
  }
  const order = new Map<number, number>()
  rng.shuffle(items.map((_, position) => position)).forEach((value, position) => {
    order.set(value, position)
  })
  return items
    .map((item, position) => ({ item, position }))
    .sort(
      (a, b) =>
        a.item.options - b.item.options ||
        (order.get(a.position) ?? 0) - (order.get(b.position) ?? 0),
    )
    .map((entry) => entry.item)
}

/**
 * 挖空：每挖一组先记下原值，唯一性被破坏就整组回填。
 * 返回时 `grid` 一定仍是唯一解盘面。
 */
function dig(grid: Grid, target: number, rng: Rng, maxPasses = 3): void {
  for (let pass = 0; pass < maxPasses; pass++) {
    if (countClues(grid) <= target) return
    const pool: number[] = []
    for (let index = 0; index < SUDOKU_CELLS; index++) if (grid[index] !== 0) pool.push(index)
    for (const candidate of digCandidates(grid, rng, rng.shuffle(pool))) {
      if (countClues(grid) <= target) return
      const removed: Array<{ index: number; value: number }> = []
      for (const cell of candidate.group) {
        if (grid[cell] === 0) continue
        removed.push({ index: cell, value: grid[cell]! })
        grid[cell] = 0
      }
      if (removed.length === 0) continue
      if (!isUnique(grid)) {
        for (const entry of removed) grid[entry.index] = entry.value
      }
    }
  }
}

export interface GenerateOptions {
  /** 是否要求「只用唯一候选数/唯一位置就能解」（默认 true）：题目不允许需要猜 */
  requireSingles?: boolean
  /**
   * 公平性重试上限（默认 6）。重试用 seed 派生新随机流，仍然完全确定性。
   * 实测「挑战档一挖到底的题目只有约 72% 能靠单数解开」，6 次重试后
   * 600 个 (seed × 档位) 样本全部命中，不需要退回兜底结果。
   */
  maxAttempts?: number
}

/**
 * 生成一道题。返回的 `given` 与 `solution` 都是独立数组，调用方可以安全持有。
 * 生成器自身的正确性由测试保证：解数恒为 1、`solution` 是 `given` 的解、同 seed 完全一致。
 */
export function generatePuzzle(
  seed: number,
  difficulty: DifficultyId,
  options: GenerateOptions = {},
): Puzzle {
  const target = Math.max(SUDOKU_MIN_CLUES, CLUE_TARGETS[difficulty])
  const requireSingles = options.requireSingles ?? true
  const maxAttempts = options.maxAttempts ?? 6
  let fallback: Puzzle | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng((seed + attempt * 0x9e3779b1) >>> 0)
    const solution = randomSolution(rng)
    const given = solution.slice()
    dig(given, target, rng)
    const puzzle: Puzzle = { difficulty, given, solution, clueCount: countClues(given) }
    if (!requireSingles || solveBySingles(given)) return puzzle
    fallback = puzzle
  }
  // 极端情况下没挑到「不用猜」的盘面：退回最后一个仍然唯一解的结果，不丢功能
  if (fallback && countSolutions(fallback.given, 2) === 1) return fallback
  throw new Error(`sudoku: unable to generate a fair puzzle for seed ${seed} (${difficulty})`)
}
