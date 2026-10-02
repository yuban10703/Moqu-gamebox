/**
 * 数独求解器。三个不同用途的求解入口，全部是纯函数：
 *
 * - `solve`：找一个解。生成题目的第一步（造完整合法解）与统一性校验（拿解当校验和）都用它。
 * - `countSolutions`：数解个数，数到 `limit` 就提前退出。**挖空必须保证解唯一**，
 *   所以这是生成器里最热的函数；`limit = 2` 时只要发现第二个解就立即返回。
 * - `solveBySingles`：只用「唯一候选数 / 唯一位置」两种人类可用的推理求解。
 *   用来筛掉「解唯一但必须猜」的题目，保证玩家不需要试错。
 *
 * 位掩码表示：bit d 置位表示数字 d+1 可以填。行/列/宫约束各占一个 9 位掩码，
 * 交集就是候选数。所有掩码都在低 9 位内，不涉及符号位。
 */
import type { Rng } from '@eink/core'

export const SUDOKU_SIZE = 9
export const SUDOKU_CELLS = 81
export const SUDOKU_FULL = 0x1ff // 低 9 位全置位 = 1..9 都能填
/** 一个题的提示数低于 17 时数学上不可能唯一解；生成器用它做安全下限 */
export const SUDOKU_MIN_CLUES = 17

/** 9 个格子里每个格子的行、列、宫下标（预计算，热路径上直接查表） */
const ROW_OF = new Int32Array(SUDOKU_CELLS)
const COL_OF = new Int32Array(SUDOKU_CELLS)
const BOX_OF = new Int32Array(SUDOKU_CELLS)
for (let index = 0; index < SUDOKU_CELLS; index++) {
  const row = Math.floor(index / SUDOKU_SIZE)
  const col = index % SUDOKU_SIZE
  ROW_OF[index] = row
  COL_OF[index] = col
  BOX_OF[index] = Math.floor(row / 3) * 3 + Math.floor(col / 3)
}

/** 取最低置位的下标（`mask & -mask` 只在低 9 位内，不会碰到符号位） */
const BIT_INDEX = ((): Int32Array => {
  const table = new Int32Array(SUDOKU_FULL + 1)
  for (let d = 0; d < SUDOKU_SIZE; d++) table[1 << d] = d
  return table
})()

const POPCOUNT = ((): Int32Array => {
  const table = new Int32Array(SUDOKU_FULL + 1)
  for (let mask = 1; mask <= SUDOKU_FULL; mask++) table[mask] = table[mask >> 1] + (mask & 1)
  return table
})()

function lowestBitIndex(mask: number): number {
  return BIT_INDEX[mask & -mask]!
}

function bitCount(mask: number): number {
  return POPCOUNT[mask]!
}

export function rowOf(index: number): number {
  return ROW_OF[index]!
}

export function colOf(index: number): number {
  return COL_OF[index]!
}

export function boxOf(index: number): number {
  return BOX_OF[index]!
}

/** 棋盘内部表示：0 表示空格，1..9 为已填数字 */
export type Grid = Int8Array

export function createGrid(): Grid {
  return new Int8Array(SUDOKU_CELLS)
}

export function gridFromArray(values: readonly number[]): Grid {
  if (values.length !== SUDOKU_CELLS) throw new Error('sudoku grid must have 81 cells')
  return Int8Array.from(values)
}

export function gridToArray(grid: Grid): number[] {
  return Array.from(grid)
}

/** 盘面是否已经填满（不判断合法性，合法性看 `isConsistent`） */
export function isComplete(grid: Grid): boolean {
  for (let index = 0; index < SUDOKU_CELLS; index++) if (grid[index] === 0) return false
  return true
}

/**
 * 盘面是否无冲突：每个 unit（行/列/宫）里同一个数字最多出现一次。
 * 允许有空格（部分盘面），但**不允许任何已填的值重复**。
 * 回溯计数必须先用它筛一遍输入：掩码式搜索只会在「填」的时候挡冲突，
 * 输入里本来就有的重复它发现不了，会把「填满即 1 个解」误判成有解。
 */
export function isConsistent(grid: Grid): boolean {
  const rowMask = new Int32Array(SUDOKU_SIZE)
  const colMask = new Int32Array(SUDOKU_SIZE)
  const boxMask = new Int32Array(SUDOKU_SIZE)
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    const value = grid[index]!
    if (value === 0) continue
    if (value < 1 || value > SUDOKU_SIZE) return false
    const bit = 1 << (value - 1)
    const row = ROW_OF[index]!
    const col = COL_OF[index]!
    const box = BOX_OF[index]!
    if ((rowMask[row]! & bit) !== 0) return false
    if ((colMask[col]! & bit) !== 0) return false
    if ((boxMask[box]! & bit) !== 0) return false
    rowMask[row]! |= bit
    colMask[col]! |= bit
    boxMask[box]! |= bit
  }
  return true
}

function setMasks(grid: Grid, rowMask: Int32Array, colMask: Int32Array, boxMask: Int32Array): void {
  rowMask.fill(0)
  colMask.fill(0)
  boxMask.fill(0)
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    const value = grid[index]!
    if (value === 0) continue
    const bit = 1 << (value - 1)
    rowMask[ROW_OF[index]!]! |= bit
    colMask[COL_OF[index]!]! |= bit
    boxMask[BOX_OF[index]!]! |= bit
  }
}

function candidatesAt(
  index: number,
  rowMask: Int32Array,
  colMask: Int32Array,
  boxMask: Int32Array,
): number {
  return (
    SUDOKU_FULL &
    ~(rowMask[ROW_OF[index]!]! | colMask[COL_OF[index]!]! | boxMask[BOX_OF[index]!]!)
  )
}

/**
 * 找一个解（就地修改 `grid`）：回溯 + MRV（先填候选最少的格子）。
 * 每个格子的候选数按「该数字在整盘还剩多少位置」升序尝试 —— 先试约束最紧的数字，
 * 能显著降低回溯量。候选顺序由 rng 打乱，所以结果对同种子完全可复现。
 */
export function solve(grid: Grid, rng: Rng): boolean {
  // 输入已经有冲突 → 无解；否则正常回溯（空盘、部分盘都适用）
  if (!isConsistent(grid)) return false
  if (isComplete(grid)) return true
  const rowMask = new Int32Array(SUDOKU_SIZE)
  const colMask = new Int32Array(SUDOKU_SIZE)
  const boxMask = new Int32Array(SUDOKU_SIZE)
  setMasks(grid, rowMask, colMask, boxMask)
  return fillOne(grid, rng, rowMask, colMask, boxMask)
}

function fillOne(
  grid: Grid,
  rng: Rng,
  rowMask: Int32Array,
  colMask: Int32Array,
  boxMask: Int32Array,
): boolean {
  let bestIndex = -1
  let bestMask = 0
  let bestCount = SUDOKU_SIZE + 1
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    if (grid[index] !== 0) continue
    const mask = candidatesAt(index, rowMask, colMask, boxMask)
    const count = bitCount(mask)
    if (count === 0) return false // 有格子无候选，这条路走不通
    if (count < bestCount) {
      bestIndex = index
      bestMask = mask
      bestCount = count
      if (count === 1) break // 单数格不可能更好，直接入选
    }
  }
  if (bestIndex < 0) return true
  const row = ROW_OF[bestIndex]!
  const col = COL_OF[bestIndex]!
  const box = BOX_OF[bestIndex]!
  for (const bit of orderedCandidates(bestMask, rng)) {
    grid[bestIndex] = bit + 1
    rowMask[row]! |= 1 << bit
    colMask[col]! |= 1 << bit
    boxMask[box]! |= 1 << bit
    if (fillOne(grid, rng, rowMask, colMask, boxMask)) return true
    grid[bestIndex] = 0
    rowMask[row]! &= ~(1 << bit)
    colMask[col]! &= ~(1 << bit)
    boxMask[box]! &= ~(1 << bit)
  }
  return false
}

/** 把候选掩码折成数组；用 rng 做 Fisher-Yates 洗牌（确定性） */
function orderedCandidates(mask: number, rng: Rng): number[] {
  const out: number[] = []
  let rest = mask
  while (rest !== 0) {
    const bit = lowestBitIndex(rest)
    out.push(bit)
    rest &= ~(1 << bit)
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/**
 * 数解个数，最多数到 `limit` 个（用于「唯一性」判定：limit = 2）。
 * 不做随机化：只关心个数，顺序无关。
 */
export function countSolutions(grid: Grid, limit = 2): number {
  // 输入本身有重复（或值越界）→ 0 个解；全填满的合法盘 → 1 个解
  if (!isConsistent(grid)) return 0
  if (isComplete(grid)) return 1
  const work = grid.slice()
  const rowMask = new Int32Array(SUDOKU_SIZE)
  const colMask = new Int32Array(SUDOKU_SIZE)
  const boxMask = new Int32Array(SUDOKU_SIZE)
  setMasks(work, rowMask, colMask, boxMask)
  return countRec(work, limit, rowMask, colMask, boxMask)
}

function countRec(
  grid: Grid,
  limit: number,
  rowMask: Int32Array,
  colMask: Int32Array,
  boxMask: Int32Array,
): number {
  let bestIndex = -1
  let bestMask = 0
  let bestCount = SUDOKU_SIZE + 1
  for (let index = 0; index < SUDOKU_CELLS; index++) {
    if (grid[index] !== 0) continue
    const mask = candidatesAt(index, rowMask, colMask, boxMask)
    const count = bitCount(mask)
    if (count === 0) return 0
    if (count < bestCount) {
      bestIndex = index
      bestMask = mask
      bestCount = count
      if (count === 1) break
    }
  }
  if (bestIndex < 0) return 1 // 全填满 → 一个解
  const row = ROW_OF[bestIndex]!
  const col = COL_OF[bestIndex]!
  const box = BOX_OF[bestIndex]!
  let found = 0
  let rest = bestMask
  while (rest !== 0 && found < limit) {
    const bit = lowestBitIndex(rest)
    rest &= ~(1 << bit)
    grid[bestIndex] = bit + 1
    rowMask[row]! |= 1 << bit
    colMask[col]! |= 1 << bit
    boxMask[box]! |= 1 << bit
    found += countRec(grid, limit - found, rowMask, colMask, boxMask)
    grid[bestIndex] = 0
    rowMask[row]! &= ~(1 << bit)
    colMask[col]! &= ~(1 << bit)
    boxMask[box]! &= ~(1 << bit)
  }
  return found
}

export interface UniquenessCheck {
  unique: boolean
  /** 最多只数到 2 个，`2` 表示「至少两个解」 */
  count: number
}

/** 解是否唯一（挖空循环里的核心判定，数到 2 就停） */
export function isUnique(grid: Grid): boolean {
  return countSolutions(grid, 2) === 1
}

export function checkUnique(grid: Grid): UniquenessCheck {
  const count = countSolutions(grid, 2)
  return { unique: count === 1, count }
}

/**
 * 只用「唯一候选数（naked single）」与「唯一位置（hidden single）」求解。
 * 返回是否能解开 —— 用来把「必须猜」的题目挡在门外。
 * `trace` 为真时把每一步推理写进 `steps`，供测试断言推理链确实存在。
 */
export function solveBySingles(grid: Grid, steps?: string[]): boolean {
  const work = grid.slice()
  const rowMask = new Int32Array(SUDOKU_SIZE)
  const colMask = new Int32Array(SUDOKU_SIZE)
  const boxMask = new Int32Array(SUDOKU_SIZE)
  setMasks(work, rowMask, colMask, boxMask)
  let remaining = 0
  for (let index = 0; index < SUDOKU_CELLS; index++) if (work[index] === 0) remaining++

  while (remaining > 0) {
    let placed = false

    // 1) 唯一候选数：某格只剩一个数字可填
    for (let index = 0; index < SUDOKU_CELLS && !placed; index++) {
      if (work[index] !== 0) continue
      const mask = candidatesAt(index, rowMask, colMask, boxMask)
      if (mask === 0) return false // 死局
      if (bitCount(mask) === 1) {
        place(work, steps, index, lowestBitIndex(mask) + 1, rowMask, colMask, boxMask, 'naked')
        remaining--
        placed = true
      }
    }
    if (placed) continue

    // 2) 唯一位置：某行/列/宫内某个数字只剩一个格子可放
    for (let unit = 0; unit < SUDOKU_SIZE && !placed; unit++) {
      for (let d = 0; d < SUDOKU_SIZE && !placed; d++) {
        const bit = 1 << d
        if ((rowMask[unit]! & bit) === 0) {
          const spot = onlySpotInLine(work, rowMask, colMask, boxMask, 'row', unit, bit)
          if (spot >= 0) {
            place(work, steps, spot, d + 1, rowMask, colMask, boxMask, 'hidden-row')
            remaining--
            placed = true
            break
          }
        }
        if ((colMask[unit]! & bit) === 0) {
          const spot = onlySpotInLine(work, rowMask, colMask, boxMask, 'col', unit, bit)
          if (spot >= 0) {
            place(work, steps, spot, d + 1, rowMask, colMask, boxMask, 'hidden-col')
            remaining--
            placed = true
            break
          }
        }
        if ((boxMask[unit]! & bit) === 0) {
          const spot = onlySpotInLine(work, rowMask, colMask, boxMask, 'box', unit, bit)
          if (spot >= 0) {
            place(work, steps, spot, d + 1, rowMask, colMask, boxMask, 'hidden-box')
            remaining--
            placed = true
            break
          }
        }
      }
    }
    if (!placed) return false // 只剩需要试错的局面
  }
  return true
}

type UnitKind = 'row' | 'col' | 'box'

function unitCell(kind: UnitKind, unit: number, slot: number): number {
  if (kind === 'row') return unit * SUDOKU_SIZE + slot
  if (kind === 'col') return slot * SUDOKU_SIZE + unit
  const baseRow = Math.floor(unit / 3) * 3
  const baseCol = (unit % 3) * 3
  return (baseRow + Math.floor(slot / 3)) * SUDOKU_SIZE + (baseCol + (slot % 3))
}

/** 在某个 unit 内找「数字 bit 唯一可放」的格子；找不到返回 -1，超过一个返回 -2 */
function onlySpotInLine(
  grid: Grid,
  rowMask: Int32Array,
  colMask: Int32Array,
  boxMask: Int32Array,
  kind: UnitKind,
  unit: number,
  bit: number,
): number {
  let spot = -1
  for (let slot = 0; slot < SUDOKU_SIZE; slot++) {
    const index = unitCell(kind, unit, slot)
    if (grid[index] !== 0) continue
    if ((candidatesAt(index, rowMask, colMask, boxMask) & bit) === 0) continue
    if (spot >= 0) return -2 // 还有第二个位置 → 不是唯一位置
    spot = index
  }
  return spot
}

function place(
  grid: Grid,
  steps: string[] | undefined,
  index: number,
  value: number,
  rowMask: Int32Array,
  colMask: Int32Array,
  boxMask: Int32Array,
  technique: string,
): void {
  const bit = 1 << (value - 1)
  grid[index] = value
  rowMask[ROW_OF[index]!]! |= bit
  colMask[COL_OF[index]!]! |= bit
  boxMask[BOX_OF[index]!]! |= bit
  if (steps) steps.push(`${technique}:${index}=${value}`)
}
