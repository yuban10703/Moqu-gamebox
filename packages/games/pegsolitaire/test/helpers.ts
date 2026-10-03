/**
 * 测试夹具与**独立实现**的孔明棋求解器。
 *
 * 「三种起始布局都可解」不能只靠「这是经典布局」的假设：
 * 这里用完全独立的棋盘逻辑（自己的孔位判定与跳吃生成）做 DFS + 状态去重，
 * 求出「只剩 1 枚棋子」的完整跳吃序列，再交给规则层逐步执行到 won。
 */
import { createState, type DifficultyId, type PegState } from '../src/index.js'

const SIZE = 7

/** 独立的孔位判定：7×7 去掉四个 2×2 角块 */
function isHoleCell(index: number): boolean {
  const row = Math.floor(index / SIZE)
  const col = index % SIZE
  const edgeRow = row <= 1 || row >= SIZE - 2
  const edgeCol = col <= 1 || col >= SIZE - 2
  return !(edgeRow && edgeCol)
}

/** 33 个孔位（独立算出，便于和 src 的结果交叉比对） */
export const SOLVER_HOLES: readonly number[] = (() => {
  const out: number[] = []
  for (let index = 0; index < SIZE * SIZE; index++) if (isHoleCell(index)) out.push(index)
  return out
})()

export interface SolverJump {
  readonly from: number
  readonly to: number
}

export interface SolveResult {
  /** 解出的跳吃序列；null = 无解 */
  readonly solution: readonly SolverJump[] | null
  readonly nodes: number
  /** true = 触到节点上限，结论不可信（既不能当有解也不能当无解） */
  readonly exhausted: boolean
}

/**
 * 独立的合法跳吃生成。
 *
 * 注意必须用「行/列 +/-2」而不是「索引 +/-2」：索引加减 2 会在行尾回绕到下一行
 * （例如索引 22 → 20），那样会生成棋盘上根本不存在的斜向跳吃。
 * 这正是 src 的 jumpedIndex 会校验同一行/同一列的原因。
 */
function legalJumps(pegs: readonly boolean[]): SolverJump[] {
  const out: SolverJump[] = []
  const steps: ReadonlyArray<readonly [number, number]> = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ]
  for (const from of SOLVER_HOLES) {
    if (!pegs[from]) continue
    const row = Math.floor(from / SIZE)
    const col = from % SIZE
    for (const [deltaRow, deltaCol] of steps) {
      const toRow = row + deltaRow
      const toCol = col + deltaCol
      if (toRow < 0 || toRow >= SIZE || toCol < 0 || toCol >= SIZE) continue
      const to = toRow * SIZE + toCol
      const jumped = (row + deltaRow / 2) * SIZE + (col + deltaCol / 2)
      if (!isHoleCell(to) || !isHoleCell(jumped)) continue
      if (pegs[jumped] && !pegs[to]) out.push({ from, to })
    }
  }
  return out
}

function countOf(pegs: readonly boolean[]): number {
  let count = 0
  for (const index of SOLVER_HOLES) if (pegs[index]) count += 1
  return count
}

function keyOf(pegs: readonly boolean[]): string {
  let key = ''
  for (const index of SOLVER_HOLES) key += pegs[index] ? '1' : '0'
  return key
}

/**
 * DFS + 状态去重（失败状态记忆化）求解。
 *
 * 目标只取决于「棋子集合」（剩 1 枚），与历史无关，所以按棋子集合记忆失败状态是可靠的；
 * 加上节点上限，保证测试不会挂死（触顶时 `exhausted = true`，调用方必须显式区分）。
 */
export function solvePegSolitaire(
  startPegs: readonly boolean[],
  budget = 5_000_000,
): SolveResult {
  const pegs = [...startPegs]
  const failed = new Set<string>()
  const path: SolverJump[] = []
  let remaining = countOf(pegs)
  let nodes = 0
  let exhausted = false

  const dfs = (): boolean => {
    if (remaining === 1) return true
    nodes += 1
    if (nodes > budget) {
      exhausted = true
      return false
    }
    const key = keyOf(pegs)
    if (failed.has(key)) return false
    for (const jump of legalJumps(pegs)) {
      const jumped = (jump.from + jump.to) / 2
      pegs[jump.from] = false
      pegs[jumped] = false
      pegs[jump.to] = true
      path.push(jump)
      remaining -= 1
      if (dfs()) return true
      remaining += 1
      path.pop()
      pegs[jump.to] = false
      pegs[jump.from] = true
      pegs[jumped] = true
    }
    failed.add(key)
    return false
  }

  const solved = dfs()
  if (exhausted) return { solution: null, nodes, exhausted: true }
  return { solution: solved ? [...path] : null, nodes, exhausted: false }
}

/** 真实初始局面（起始布局固定，与 seed 无关） */
export function fresh(difficulty: DifficultyId = 'starter'): PegState {
  return createState(difficulty)
}

/** 直接构造指定棋子表的状态（跳过重放校验，专门断言选中/跳吃语义） */
export function fixtureState(
  pegs: readonly boolean[],
  overrides: Partial<PegState> = {},
): PegState {
  return {
    difficulty: overrides.difficulty ?? 'starter',
    pegs: [...pegs],
    selected: null,
    moves: 0,
    history: [],
    ...overrides,
  }
}

/** 空棋盘（49 格全空），用于手工摆放棋子 */
export function emptyBoard(): boolean[] {
  return new Array<boolean>(SIZE * SIZE).fill(false)
}

/** 在空棋盘上放指定棋子（只允许放在孔位上） */
export function boardWith(indexes: readonly number[]): boolean[] {
  const pegs = emptyBoard()
  for (const index of indexes) {
    if (!isHoleCell(index)) throw new Error(`index ${index} is not a hole`)
    pegs[index] = true
  }
  return pegs
}
