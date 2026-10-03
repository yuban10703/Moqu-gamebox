/**
 * 测试夹具与**独立实现**的骑士巡游求解器。
 *
 * 求解器完全不复用 src 的走法生成：自己的位移表、自己的边界判定、自己的 Warnsdorff 排序。
 * 带节点上限与 `exhausted` 标志 —— 触顶必须显式失败，绝不能当成「无解」。
 */

const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]

export interface SolveResult {
  /** 完整巡游（含起点，长度 = size²）；null = 无解 */
  readonly solution: readonly number[] | null
  readonly nodes: number
  /** true = 触到节点上限，结论不可信（既不能当有解也不能当无解） */
  readonly exhausted: boolean
}

export function cellIndex(size: number, row: number, col: number): number {
  return row * size + col
}

/** 独立实现：盘内判定 + 马步落点 */
export function movesOn(size: number, index: number): number[] {
  const row = Math.floor(index / size)
  const col = index % size
  const out: number[] = []
  for (const [offsetRow, offsetCol] of OFFSETS) {
    const nextRow = row + offsetRow
    const nextCol = col + offsetCol
    if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) continue
    out.push(cellIndex(size, nextRow, nextCol))
  }
  return out
}

/** 独立实现：from → to 是不是一个马步 */
export function isKnightStep(size: number, from: number, to: number): boolean {
  if (from === to) return false
  return movesOn(size, from).includes(to)
}

/** 未访问的后续落点数量（Warnsdorff 度） */
function degree(size: number, index: number, visited: ReadonlySet<number>): number {
  let count = 0
  for (const onward of movesOn(size, index)) {
    if (!visited.has(onward)) count += 1
  }
  return count
}

/**
 * Warnsdorff + 回溯：每步优先走「后续选择最少」的格子，同分按索引升序（保证可复现）。
 * 找出一条走满 size² 格的巡游；找不到（或在预算内证不出）返回 null。
 */
export function solveKnightTour(size: number, start: number, budget = 500_000): SolveResult {
  const total = size * size
  if (!Number.isInteger(start) || start < 0 || start >= total) {
    throw new Error(`bad start ${start} for size ${size}`)
  }
  const visited = new Set<number>([start])
  const path: number[] = [start]
  let nodes = 0
  let exhausted = false

  const dfs = (current: number): boolean => {
    if (path.length === total) return true
    nodes += 1
    if (nodes > budget) {
      exhausted = true
      return false
    }
    const candidates = movesOn(size, current).filter((to) => !visited.has(to))
    candidates.sort(
      (a, b) => degree(size, a, visited) - degree(size, b, visited) || a - b,
    )
    for (const to of candidates) {
      visited.add(to)
      path.push(to)
      if (dfs(to)) return true
      path.pop()
      visited.delete(to)
    }
    return false
  }

  const solved = dfs(start)
  if (exhausted) return { solution: null, nodes, exhausted: true }
  return { solution: solved ? [...path] : null, nodes, exhausted: false }
}

/** 独立校验一条路径：长度正确、每步都是合法马步、不重复、覆盖全部格子 */
export function inspectTour(
  size: number,
  start: number,
  path: readonly number[],
): { ok: boolean; reason: string } {
  const total = size * size
  if (path.length !== total) return { ok: false, reason: `length ${path.length} != ${total}` }
  if (path[0] !== start) return { ok: false, reason: `starts at ${path[0]}, expected ${start}` }
  const seen = new Set<number>()
  for (let i = 0; i < path.length; i++) {
    const cell = path[i]!
    if (cell < 0 || cell >= total) return { ok: false, reason: `cell ${cell} out of board` }
    if (seen.has(cell)) return { ok: false, reason: `revisits ${cell}` }
    seen.add(cell)
    if (i > 0 && !isKnightStep(size, path[i - 1]!, cell)) {
      return { ok: false, reason: `${path[i - 1]} -> ${cell} is not a knight step` }
    }
  }
  return { ok: true, reason: 'ok' }
}
