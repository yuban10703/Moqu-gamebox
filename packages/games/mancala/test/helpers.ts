/**
 * 测试夹具与**独立实现**的播种几何。
 *
 * `independentNext` / `independentOpposite` 完全按「行列 + 上下行」的直观几何写，
 * 不使用 src 的 RING / nextCell / oppositePit —— 这样方向或跳过规则写错时能被抓出来。
 */
import { createRng } from '@eink/core'
import {
  BLACK,
  COLS,
  ROWS,
  WHITE,
  createState,
  totalStones,
  type DifficultyId,
  type MancalaState,
  type Side,
} from '../src/index.js'

export const INITIAL_TOTAL = 48

export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): MancalaState {
  return createState(seed, difficulty)
}

export function rowOfTest(index: number): number {
  return Math.floor(index / COLS)
}

export function colOfTest(index: number): number {
  return index % COLS
}

export function cellAt(row: number, col: number): number {
  return row * COLS + col
}

/** 只按几何走一步（不考虑跳过）：沿 2×7 的外圈逆时针 */
function geometricNext(index: number): number {
  const row = rowOfTest(index)
  const col = colOfTest(index)
  // 下行（黑方）：黑坑 0..5 从左往右 → 黑仓 6 → 沿右侧上行到白坑6
  if (row === 1 && col < 6) return index + 1
  if (row === 1 && col === 6) return cellAt(0, 6)
  // 上行（白方）：白坑 6..2 从右往左 → 白坑1 → 白仓0 → 沿左侧下行到黑坑7
  if (row === 0 && col > 0) return index - 1
  if (row === 0 && col === 0) return cellAt(1, 0)
  throw new Error(`geometricNext: bad cell ${index}`)
}

/** 独立实现的逆时针下一格：几何走一步；若踩到对手的仓，就再从那个仓走一步 */
export function independentNext(index: number, side: Side): number {
  const skipped = side === WHITE ? 13 : 0 // 对手的仓
  const first = geometricNext(index)
  return first === skipped ? geometricNext(first) : first
}

/** 独立实现的正对面坑：上下两行列号之和 = 6（两个仓分别在左上与右下） */
export function independentOpposite(index: number): number {
  const row = rowOfTest(index)
  const col = colOfTest(index)
  if (row === 0 && col === 0) return -1 // 白仓
  if (row === 1 && col === 6) return -1 // 黑仓
  return row === 1 ? cellAt(0, 6 - col) : cellAt(1, 6 - col)
}

/** 独立实现的一次播种（返回 14 格结果、最后一格、是否连走、吃了多少） */
export function independentSow(
  cells: readonly number[],
  pit: number,
  side: Side,
): { cells: number[]; last: number; extraTurn: boolean; captured: number } {
  const next = [...cells]
  const stones = next[pit] ?? 0
  next[pit] = 0
  let cursor = pit
  let last = pit
  let emptyBeforeLast = false
  for (let stone = 0; stone < stones; stone++) {
    cursor = independentNext(cursor, side)
    emptyBeforeLast = (next[cursor] ?? 0) === 0
    next[cursor] = (next[cursor] ?? 0) + 1
    last = cursor
  }
  const ownStore = side === BLACK ? 13 : 0
  const extraTurn = last === ownStore
  let captured = 0
  const isOwnPit = side === BLACK ? last >= 7 && last <= 12 : last >= 1 && last <= 6
  if (!extraTurn && isOwnPit && emptyBeforeLast) {
    const opposite = independentOpposite(last)
    const oppositeStones = opposite >= 0 ? next[opposite] ?? 0 : 0
    if (oppositeStones > 0) {
      captured = (next[last] ?? 0) + oppositeStones
      next[ownStore] = (next[ownStore] ?? 0) + captured
      next[last] = 0
      next[opposite] = 0
    }
  }
  return { cells: next, last, extraTurn, captured }
}

/** 手工摆一个局面（只改 cells，其它字段按初始状态） */
export function customState(cells: readonly number[], turn: Side = BLACK): MancalaState {
  const base = fresh(1, 'starter')
  return { ...base, cells: [...cells], turn }
}

/** 在初始摆法上按 [索引, 数量] 覆盖若干格 */
export function withCells(overrides: ReadonlyArray<readonly [number, number]>, turn: Side = BLACK): MancalaState {
  const base = fresh(1, 'starter')
  const cells = [...base.cells]
  for (const [index, count] of overrides) cells[index] = count
  return { ...base, cells, turn }
}

/** 把 14 格画成两行，便于断言失败时看清局面 */
export function drawCells(cells: readonly number[]): string {
  const row = (line: readonly number[]) => line.map((count) => String(count).padStart(2, ' ')).join(' ')
  return [
    `白  ${row(cells.slice(0, COLS))}`,
    `黑  ${row(cells.slice(COLS, COLS * ROWS))}`,
  ].join('\n')
}

/**
 * 把一局打完：黑方按 `pick` 选坑（默认随机），白方由规则层应手。
 * 返回终局状态；若 5000 手还没结束就抛错（说明规则里出了死循环）。
 */
export function playToEnd(
  seed: number,
  difficulty: DifficultyId,
  claim: (state: MancalaState, index: number) => MancalaState,
  pick?: (state: MancalaState, rng: ReturnType<typeof createRng>) => number,
): MancalaState {
  const rng = createRng(seed)
  let state = fresh(seed, difficulty)
  let guard = 0
  while (state.cells.reduce((sum, count) => sum + count, 0) > 0) {
    // 结束判据：任一方坑全空（规则层会立刻结算）
    const minePits = [7, 8, 9, 10, 11, 12].reduce((sum, pit) => sum + (state.cells[pit] ?? 0), 0)
    const theirPits = [1, 2, 3, 4, 5, 6].reduce((sum, pit) => sum + (state.cells[pit] ?? 0), 0)
    if (minePits === 0 || theirPits === 0) break
    if (guard++ > 5000) throw new Error('game did not finish')
    const legal = [7, 8, 9, 10, 11, 12].filter((pit) => (state.cells[pit] ?? 0) > 0)
    if (legal.length === 0) break
    const pit = pick ? pick(state, rng) : legal[rng.int(legal.length)]!
    state = claim(state, pit)
    if (totalStones(state.cells) !== INITIAL_TOTAL) {
      throw new Error(`stone count changed: ${drawCells(state.cells)}`)
    }
  }
  return state
}
