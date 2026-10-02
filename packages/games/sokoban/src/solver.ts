/**
 * 关卡求解器（A*，按移动步数最优）。
 *
 * 用途仅限**内容验证**：证明提交进仓库的关卡确实可解，并为难度分级提供参考的最优步数。
 * 明确不把它做成游戏内提示功能 —— 未经验证的能力不对外承诺。
 * 规则层不依赖本模块，因此它不会进入游戏运行时（只被测试与工具引用）。
 *
 * 启发函数：每个箱子到最近目标点的距离（多源 BFS，忽略箱子阻挡）之和。
 * 该启发是可采纳的（每推一次最多让一个箱子靠近一步），因此 A* 给出的步数是最优的。
 */
import {
  ALL_DIRS,
  dirDelta,
  isGoal,
  isWall,
  type MoveDir,
  type ParsedLevel,
} from './level.js'

export interface SolveInput {
  player: number
  boxes: readonly number[]
}

export type SolveResult =
  | { ok: true; moves: MoveDir[]; pushes: number; expanded: number }
  | { ok: false; reason: 'unsolvable' | 'limit'; expanded: number }

export interface SolveOptions {
  maxExpanded?: number
}

interface Node {
  player: number
  boxes: number[]
  boxesKey: string
  g: number
  parent: number
  move: MoveDir | null
}

export function solve(
  level: ParsedLevel,
  input: SolveInput,
  options: SolveOptions = {},
): SolveResult {
  const maxExpanded = options.maxExpanded ?? 200_000
  const dist = goalDistanceMap(level)
  const start: Node = {
    player: input.player,
    boxes: [...input.boxes].sort((a, b) => a - b),
    boxesKey: keyOf(input.boxes),
    g: 0,
    parent: -1,
    move: null,
  }

  if (isSolved(level, start.boxes)) {
    return { ok: true, moves: [], pushes: 0, expanded: 0 }
  }

  const nodes: Node[] = [start]
  const best = new Map<string, number>()
  best.set(nodeKey(start), 0)
  const open = new MinHeap()
  open.push(heuristic(start.boxes, dist), 0)

  let expanded = 0
  while (open.size > 0) {
    const top = open.pop()!
    const node = nodes[top.index]!
    // 该状态已被更优路径取代
    if (best.get(nodeKey(node)) !== node.g) continue
    if (isSolved(level, node.boxes)) {
      return {
        ok: true,
        moves: reconstruct(nodes, top.index),
        pushes: countPushes(nodes, top.index),
        expanded,
      }
    }
    if (expanded++ > maxExpanded) {
      return { ok: false, reason: 'limit', expanded }
    }

    for (const dir of ALL_DIRS) {
      const delta = dirDelta(dir, level.cols)
      const nextPlayer = node.player + delta
      if (isWall(level, nextPlayer)) continue
      const boxAt = node.boxes.indexOf(nextPlayer)
      let nextBoxes = node.boxes
      if (boxAt >= 0) {
        const beyond = nextPlayer + delta
        if (isWall(level, beyond) || node.boxes.includes(beyond)) continue
        nextBoxes = node.boxes.slice()
        nextBoxes[boxAt] = beyond
        nextBoxes.sort((a, b) => a - b)
      }
      const child: Node = {
        player: nextPlayer,
        boxes: nextBoxes,
        boxesKey: keyOf(nextBoxes),
        g: node.g + 1,
        parent: top.index,
        move: dir,
      }
      const ck = nodeKey(child)
      const seen = best.get(ck)
      if (seen !== undefined && seen <= child.g) continue
      best.set(ck, child.g)
      nodes.push(child)
      open.push(child.g + heuristic(nextBoxes, dist), nodes.length - 1, child.g)
    }
  }
  return { ok: false, reason: 'unsolvable', expanded }
}

function nodeKey(node: Node): string {
  return `${node.boxesKey}|${node.player}`
}

function keyOf(boxes: readonly number[]): string {
  return [...boxes].sort((a, b) => a - b).join(',')
}

function isSolved(level: ParsedLevel, boxes: readonly number[]): boolean {
  return boxes.every((cell) => isGoal(level, cell))
}

function reconstruct(nodes: Node[], index: number): MoveDir[] {
  const out: MoveDir[] = []
  let cursor = index
  while (cursor >= 0) {
    const node = nodes[cursor]!
    if (node.move) out.push(node.move)
    cursor = node.parent
  }
  return out.reverse()
}

function countPushes(nodes: Node[], index: number): number {
  let pushes = 0
  let cursor = index
  while (cursor >= 0) {
    const node = nodes[cursor]!
    if (node.parent >= 0) {
      const parent = nodes[node.parent]!
      if (parent.boxesKey !== node.boxesKey) pushes++
    }
    cursor = node.parent
  }
  return pushes
}

/** 每个格子到最近目标点的距离（多源 BFS，忽略箱子；只用于启发函数） */
function goalDistanceMap(level: ParsedLevel): Int32Array {
  const dist = new Int32Array(level.cols * level.rows).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < level.staticGrid.length; i++) {
    if (isGoal(level, i)) {
      dist[i] = 0
      queue.push(i)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!
    for (const dir of ALL_DIRS) {
      const next = cell + dirDelta(dir, level.cols)
      if (isWall(level, next)) continue
      if (dist[next] !== -1) continue
      dist[next] = dist[cell]! + 1
      queue.push(next)
    }
  }
  return dist
}

function heuristic(boxes: readonly number[], dist: Int32Array): number {
  let sum = 0
  for (const cell of boxes) {
    const d = dist[cell]!
    sum += d < 0 ? 0 : d
  }
  return sum
}

/** 简单二叉最小堆；同优先级按插入顺序稳定出队 */
class MinHeap {
  private readonly priorities: number[] = []
  private readonly indexes: number[] = []
  private readonly gValues: number[] = []

  get size(): number {
    return this.priorities.length
  }

  push(priority: number, index: number, g = 0): void {
    this.priorities.push(priority)
    this.indexes.push(index)
    this.gValues.push(g)
    let child = this.priorities.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.less(child, parent)) {
        this.swap(child, parent)
        child = parent
      } else break
    }
  }

  pop(): { index: number; g: number } | null {
    if (this.priorities.length === 0) return null
    const index = this.indexes[0]!
    const g = this.gValues[0]!
    const last = this.priorities.length - 1
    this.swap(0, last)
    this.priorities.pop()
    this.indexes.pop()
    this.gValues.pop()
    let parent = 0
    for (;;) {
      const left = parent * 2 + 1
      const right = left + 1
      let smallest = parent
      if (left < this.priorities.length && this.less(left, smallest)) smallest = left
      if (right < this.priorities.length && this.less(right, smallest)) smallest = right
      if (smallest === parent) break
      this.swap(parent, smallest)
      parent = smallest
    }
    return { index, g }
  }

  private less(a: number, b: number): boolean {
    const pa = this.priorities[a]!
    const pb = this.priorities[b]!
    if (pa !== pb) return pa < pb
    return a < b
  }

  private swap(a: number, b: number): void {
    const p = this.priorities[a]!
    this.priorities[a] = this.priorities[b]!
    this.priorities[b] = p
    const i = this.indexes[a]!
    this.indexes[a] = this.indexes[b]!
    this.indexes[b] = i
    const g = this.gValues[a]!
    this.gValues[a] = this.gValues[b]!
    this.gValues[b] = g
  }
}
