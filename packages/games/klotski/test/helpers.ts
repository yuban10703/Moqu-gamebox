/**
 * 测试夹具与**独立实现**的华容道求解器。
 *
 * 「四个关卡都可解」不能靠「这是经典布局」的假设：这里用完全独立的棋盘逻辑
 * （自己的占位判定与滑动生成）做 BFS，求出到达胜利条件的最短滑动序列，
 * 再交给规则层逐步执行到 won。带节点上限与 `exhausted` 标志，触顶必须显式失败。
 *
 * 华容道局面数很小（带棋子身份约 6.6 万），BFS 足以求最短解。
 */
import type { MoveDir } from '@eink/core'

export const SOLVER_COLS = 4
export const SOLVER_ROWS = 5
export const SOLVER_CELLS = SOLVER_COLS * SOLVER_ROWS
/** 曹操左上角到达 (row 3, col 1) 即胜利 */
export const SOLVER_GOAL = 3 * SOLVER_COLS + 1

export interface SolverPiece {
  readonly id: string
  readonly glyph: string
  readonly width: number
  readonly height: number
  readonly start: number
}

export interface SolverMove {
  readonly id: string
  readonly dir: MoveDir
}

export interface SolveResult {
  /** 最短滑动序列；null = 无解 */
  readonly solution: readonly SolverMove[] | null
  readonly visited: number
  /** true = 触到节点上限，结论不可信（既不能当有解也不能当无解） */
  readonly exhausted: boolean
}

const DIRS: ReadonlyArray<readonly [MoveDir, number, number]> = [
  ['up', -1, 0],
  ['down', 1, 0],
  ['left', 0, -1],
  ['right', 0, 1],
]

function cellsOf(start: number, width: number, height: number): number[] {
  const row = Math.floor(start / SOLVER_COLS)
  const col = start % SOLVER_COLS
  const out: number[] = []
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) out.push((row + r) * SOLVER_COLS + (col + c))
  }
  return out
}

function inside(start: number, width: number, height: number): boolean {
  if (!Number.isInteger(start) || start < 0 || start >= SOLVER_CELLS) return false
  const row = Math.floor(start / SOLVER_COLS)
  const col = start % SOLVER_COLS
  return row + height <= SOLVER_ROWS && col + width <= SOLVER_COLS
}

/** 单块沿 dir 滑一格后的左上角；越界返回 null */
function targetStart(start: number, width: number, height: number, dir: MoveDir): number | null {
  const row = Math.floor(start / SOLVER_COLS)
  const col = start % SOLVER_COLS
  const delta = DIRS.find(([name]) => name === dir)
  if (!delta) return null
  const nextRow = row + delta[1]
  const nextCol = col + delta[2]
  // 必须先按行列判边界：nextRow * 4 + 4 会「绕」到下一行，只查 index 查不出来
  if (nextRow < 0 || nextRow >= SOLVER_ROWS || nextCol < 0 || nextCol >= SOLVER_COLS) return null
  const next = nextRow * SOLVER_COLS + nextCol
  if (!inside(next, width, height)) return null
  return next
}

/**
 * 用若干行字符串搭一个局面：每行 4 个字符，`.` 空；同一块用同一个字符。
 * 相同字符的连通格会被合并成一个矩形块（`卒` 有 4 块，按扫描顺序得到不同 id）。
 * 这样写字面布局时不容易把方块摆错。
 */
export function parsePieces(rows: readonly string[]): SolverPiece[] {
  if (rows.length !== SOLVER_ROWS) throw new Error('parsePieces expects 5 rows')
  rows.forEach((row, index) => {
    if (row.length !== SOLVER_COLS) throw new Error(`row ${index} must have 4 columns`)
  })
  const seen: boolean[] = new Array<boolean>(SOLVER_CELLS).fill(false)
  const pieces: SolverPiece[] = []
  const counters = new Map<string, number>()
  for (let index = 0; index < SOLVER_CELLS; index++) {
    if (seen[index]) continue
    const glyph = rows[Math.floor(index / SOLVER_COLS)]![index % SOLVER_COLS]!
    if (glyph === '.') {
      seen[index] = true
      continue
    }
    // 连通块（同字符、正交相邻）
    const cells: number[] = []
    const stack = [index]
    seen[index] = true
    while (stack.length > 0) {
      const current = stack.pop()!
      cells.push(current)
      const row = Math.floor(current / SOLVER_COLS)
      const col = current % SOLVER_COLS
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= SOLVER_ROWS || c < 0 || c >= SOLVER_COLS) continue
        const next = r * SOLVER_COLS + c
        if (seen[next]) continue
        if (rows[r]![c] !== glyph) continue
        seen[next] = true
        stack.push(next)
      }
    }
    const minRow = Math.min(...cells.map((cell) => Math.floor(cell / SOLVER_COLS)))
    const maxRow = Math.max(...cells.map((cell) => Math.floor(cell / SOLVER_COLS)))
    const minCol = Math.min(...cells.map((cell) => cell % SOLVER_COLS))
    const maxCol = Math.max(...cells.map((cell) => cell % SOLVER_COLS))
    const width = maxCol - minCol + 1
    const height = maxRow - minRow + 1
    if (cells.length !== width * height) {
      throw new Error(`piece "${glyph}" is not a rectangle`)
    }
    const suffix = counters.get(glyph) ?? 0
    counters.set(glyph, suffix + 1)
    pieces.push({
      id: suffix === 0 ? glyph : `${glyph}#${suffix}`,
      glyph,
      width,
      height,
      start: minRow * SOLVER_COLS + minCol,
    })
  }
  return pieces
}

/** 独立求解器：BFS 求「曹操左上角到 (3,1)」的最短滑动序列 */
export function solveKlotski(pieces: readonly SolverPiece[], budget = 200_000): SolveResult {
  const total = pieces.length
  const caoIndex = pieces.findIndex((piece) => piece.width === 2 && piece.height === 2)
  if (caoIndex < 0) throw new Error('no 2x2 piece')
  const start: number[] = pieces.map((piece) => piece.start)
  const caoShape = pieces[caoIndex]!

  // 同形状的块彼此可互换（四个卒、若干竖将）：按「形状分组 + 组内位置排序」做规范化 key，
  // 把状态空间从 60 多万压到 2.6 万；解里引用的仍是具体块，因此可以直接交给规则层执行。
  const shapeGroups: Array<{ shape: string; indices: number[] }> = []
  for (let i = 0; i < total; i++) {
    const shape = `${pieces[i]!.width}x${pieces[i]!.height}`
    const group = shapeGroups.find((item) => item.shape === shape)
    if (group) group.indices.push(i)
    else shapeGroups.push({ shape, indices: [i] })
  }
  for (const group of shapeGroups) group.indices.sort((a, b) => a - b)
  shapeGroups.sort((a, b) => (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0))

  const keyOf = (positions: readonly number[]): string =>
    shapeGroups
      .map((group) => {
        const sorted = group.indices.map((index) => positions[index]!).sort((a, b) => a - b)
        return `${group.shape}:${sorted.join(',')}`
      })
      .join('|')

  const startKey = keyOf(start)
  if (start[caoIndex] === SOLVER_GOAL) {
    return { solution: [], visited: 1, exhausted: false }
  }
  const parent = new Map<string, { prev: string; move: SolverMove }>()
  const queue: number[][] = [start]
  let head = 0
  const visited = new Set<string>([startKey])
  // 占用图只按局面构建一次（1-based 的块下标），生成候选时临时把自己的格子清掉再恢复
  const grid = new Uint8Array(SOLVER_CELLS)
  while (head < queue.length) {
    const current = queue[head++]!
    const currentKey = keyOf(current)
    grid.fill(0)
    for (let i = 0; i < total; i++) {
      for (const cell of cellsOf(current[i]!, pieces[i]!.width, pieces[i]!.height)) {
        grid[cell] = i + 1
      }
    }
    for (let index = 0; index < total; index++) {
      const piece = pieces[index]!
      const start = current[index]!
      const own = cellsOf(start, piece.width, piece.height)
      for (const cell of own) grid[cell] = 0
      for (const [dir] of DIRS) {
        const nextStart = targetStart(start, piece.width, piece.height, dir)
        if (nextStart === null) continue
        let blocked = false
        for (const cell of cellsOf(nextStart, piece.width, piece.height)) {
          if (grid[cell] !== 0) {
            blocked = true
            break
          }
        }
        if (blocked) continue
        const nextPositions = [...current]
        nextPositions[index] = nextStart
        const nextKey = keyOf(nextPositions)
        if (visited.has(nextKey)) continue
        visited.add(nextKey)
        parent.set(nextKey, { prev: currentKey, move: { id: piece.id, dir } })
        if (nextStart === SOLVER_GOAL && index === caoIndex) {
          const solution: SolverMove[] = []
          let key = nextKey
          while (key !== startKey) {
            const step = parent.get(key)!
            solution.unshift(step.move)
            key = step.prev
          }
          return { solution, visited: visited.size, exhausted: false }
        }
        if (visited.size > budget) {
          return { solution: null, visited: visited.size, exhausted: true }
        }
        queue.push(nextPositions)
      }
      for (const cell of own) grid[cell] = index + 1
    }
  }
  void caoShape
  return { solution: null, visited: visited.size, exhausted: false }
}
