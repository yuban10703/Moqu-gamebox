/**
 * 布雷与邻域计算：扫雷里唯一有随机性的地方。
 *
 * 为什么不用 Math.random：规则层必须可重放（存档只存状态，双端要同结果），
 * 所以随机性只能来自种子。这里实现的是与 @eink/core `createRng` 完全相同的
 * mulberry32 算法；test/generate.test.ts 会逐位比对两者的序列，防止实现漂移。
 *
 * 布雷是**延迟**的：第一次翻开之后才放雷，并排除首点及其 8 邻域 —— 经典扫雷的
 * 「首点必安全」规则。首点前状态里的 `mines` 是空数组。
 */
import { IllegalActionError } from '@eink/core'
import { cellCount, GAME_ID, type BoardConfig } from './difficulty.js'

/** mulberry32：32 位状态、实现短、跨平台结果一致 */
export function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 行优先索引 → 坐标 */
export function coordsOf(config: BoardConfig, index: number): { x: number; y: number } {
  return { x: index % config.cols, y: Math.floor(index / config.cols) }
}

/** 8 邻域（不含自身，自动裁掉出界方向） */
export function neighborsOf(config: BoardConfig, index: number): number[] {
  const { x, y } = coordsOf(config, index)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= config.cols || ny >= config.rows) continue
      out.push(ny * config.cols + nx)
    }
  }
  return out
}

/** 首点安全区 = 首点自身 + 8 邻域 */
export function neighborhoodOf(config: BoardConfig, index: number): number[] {
  return [index, ...neighborsOf(config, index)]
}

export function adjacentMineCount(
  mines: ReadonlySet<number>,
  config: BoardConfig,
  index: number,
): number {
  let count = 0
  for (const neighbor of neighborsOf(config, index)) if (mines.has(neighbor)) count++
  return count
}

export interface PlacementResult {
  /** 升序的雷位置 */
  readonly mines: readonly number[]
  /** 布雷消耗的随机数个数（写进状态，便于存档与重现时核对） */
  readonly cursor: number
}

/**
 * 在第一次翻开 `firstIndex` 之后布雷。
 *
 * 用部分 Fisher–Yates 从候选格（去掉首点 9 格）里抽 mineCount 个：
 * 交换次数固定 = mineCount，因此消耗的随机数个数可预测（cursor === mineCount）。
 */
export function placeMines(config: BoardConfig, seed: number, firstIndex: number): PlacementResult {
  const total = cellCount(config)
  if (!Number.isInteger(firstIndex) || firstIndex < 0 || firstIndex >= total) {
    throw new IllegalActionError(GAME_ID, `first click out of range: ${firstIndex}`)
  }
  const safe = new Set(neighborhoodOf(config, firstIndex))
  const candidates: number[] = []
  for (let index = 0; index < total; index++) if (!safe.has(index)) candidates.push(index)
  if (config.mineCount > candidates.length) {
    throw new IllegalActionError(GAME_ID, 'not enough safe cells for the mine count')
  }
  const next = mulberry32(seed)
  let cursor = 0
  for (let i = 0; i < config.mineCount; i++) {
    const span = candidates.length - i
    const j = i + (Math.floor(next() * span) % span)
    cursor++
    const swap = candidates[i]!
    candidates[i] = candidates[j]!
    candidates[j] = swap
  }
  return { mines: candidates.slice(0, config.mineCount).sort((a, b) => a - b), cursor }
}

/**
 * 洪水式连锁翻开：从 start 出发，凡「周围 0 雷」的格子就把它的 8 邻域也纳入。
 * 已插旗的格子不会被自动翻开（旗子的含义就是「别再动这一格」）。
 * 返回新的已翻开集合（升序），便于状态比较。
 */
export function expandChain(
  config: BoardConfig,
  mines: ReadonlySet<number>,
  flags: ReadonlySet<number>,
  revealed: ReadonlySet<number>,
  start: number,
): number[] {
  const opened = new Set(revealed)
  const stack = [start]
  while (stack.length > 0) {
    const index = stack.pop()!
    if (opened.has(index) || flags.has(index)) continue
    opened.add(index)
    if (adjacentMineCount(mines, config, index) === 0) {
      for (const neighbor of neighborsOf(config, index)) {
        if (!opened.has(neighbor)) stack.push(neighbor)
      }
    }
  }
  return [...opened].sort((a, b) => a - b)
}
