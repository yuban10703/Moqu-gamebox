/**
 * 测试夹具与**独立实现**的图论工具。
 *
 * 「完美迷宫」的验证不能复用 src 里的生成逻辑，否则等于自证；
 * 这里用普通的 BFS / DFS 在墙格表上重新走一遍：连通性、树边数、起点到出口的简单路径条数。
 */
import type { MoveDir } from '@eink/core'
import {
  DIRECTIONS,
  createState,
  targetOf,
  type DifficultyId,
  type MazeState,
} from '../src/index.js'

/** 真实初始局面（迷宫由 seed + 难度确定性生成），用于需要合法存档的断言 */
export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): MazeState {
  return createState(seed, difficulty)
}

/** 与规则层无关的 BFS：从 from 到 to 的最短路（按方向序列返回）；不可达返回 null */
export function shortestPathDirections(
  walls: readonly boolean[],
  size: number,
  from: number,
  to: number,
): MoveDir[] | null {
  const previous = new Map<number, { from: number; dir: MoveDir }>()
  const queue: number[] = [from]
  const seen = new Set<number>([from])
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === to) break
    for (const dir of DIRECTIONS) {
      const next = targetOf(current, dir, size)
      if (next === null || walls[next] || seen.has(next)) continue
      seen.add(next)
      previous.set(next, { from: current, dir })
      queue.push(next)
    }
  }
  if (from !== to && !previous.has(to)) return null
  const dirs: MoveDir[] = []
  let node = to
  while (node !== from) {
    const step = previous.get(node)
    if (!step) return null
    dirs.unshift(step.dir)
    node = step.from
  }
  return dirs
}

/** 全部通路格索引 */
export function floorsOf(walls: readonly boolean[]): number[] {
  const out: number[] = []
  for (let index = 0; index < walls.length; index++) if (!walls[index]) out.push(index)
  return out
}

/** 从起点出发能走到的通路格数量（独立 BFS，用于连通性检查） */
export function reachableCount(walls: readonly boolean[], size: number, start: number): number {
  const seen = new Set<number>([start])
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dir of DIRECTIONS) {
      const next = targetOf(current, dir, size)
      if (next === null || walls[next] || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen.size
}

/** 通路格之间的无向相邻边数（每对只数一次） */
export function floorEdgeCount(walls: readonly boolean[], size: number): number {
  let edges = 0
  for (let index = 0; index < walls.length; index++) {
    if (walls[index]) continue
    // 只数「右」和「下」两个方向，避免同一条边数两次
    for (const dir of ['right', 'down'] as const) {
      const next = targetOf(index, dir, size)
      if (next !== null && !walls[next]) edges += 1
    }
  }
  return edges
}

/**
 * 起点到出口的简单路径条数（最多数到 limit 条就提前返回）。
 * 完美迷宫应当**恰好 1 条**；这是比「连通 + 边数」更直接的独立性判据。
 */
export function countSimplePaths(
  walls: readonly boolean[],
  size: number,
  from: number,
  to: number,
  limit = 2,
): number {
  let found = 0
  const onPath = new Set<number>([from])
  const walk = (current: number): void => {
    if (found >= limit) return
    if (current === to) {
      found += 1
      return
    }
    for (const dir of DIRECTIONS) {
      const next = targetOf(current, dir, size)
      if (next === null || walls[next] || onPath.has(next)) continue
      onPath.add(next)
      walk(next)
      onPath.delete(next)
    }
  }
  walk(from)
  return found
}

/** 找一个通路格：与 from 不相邻（用于构造「瞬移」类坏数据） */
export function farFloor(walls: readonly boolean[], size: number, from: number): number {
  for (let index = 0; index < walls.length; index++) {
    if (walls[index] || index === from) continue
    const dir = DIRECTIONS.some((direction) => targetOf(from, direction, size) === index)
    if (!dir) return index
  }
  throw new Error('no non-adjacent floor cell found')
}
