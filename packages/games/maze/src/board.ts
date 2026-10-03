/**
 * 迷宫棋盘模型：难度尺寸、坐标换算与**确定性完美迷宫生成**。
 *
 * 为什么用「奇数边长 + 墙格占格」的表示法：
 * 每格在棋盘上就是一个 CellView，墙与通路用现成的 kind（wall / floor）表达，
 * 壳层不需要知道任何迷宫概念；奇数边长让「通路格」正好落在奇数坐标上（1,1 … size−2），
 * 天然留出一圈外墙，标准生成算法可以直接跑。
 *
 * 生成算法：递归回溯（用显式栈，避免深递归）。它在「通路格图」上做一次 DFS，
 * 只在访问新格时凿开中间的墙，因此得到的是**生成树**：
 * - 任意两格之间恰有一条通路（完美迷宫，无环）；
 * - 通路格之间的相邻边数 = 通路格数 − 1。
 *
 * 随机性全部来自 core 的 createRng(seed)，绝不使用 Math.random：
 * 同 seed + 同难度必然得到同一座迷宫。
 */
import { IllegalActionError, createRng, type MoveDir } from '@eink/core'

export const GAME_ID = 'maze'

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BoardConfig {
  /** 奇数边长：通路格位于 1..size−2 的奇数坐标上 */
  readonly size: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  starter: { size: 11 },
  skilled: { size: 15 },
  challenging: { size: 21 },
}

/** 固定顺序：生成、合法动作列表、方向盘都按它输出，保证同 seed 结果稳定可比对 */
export const DIRECTIONS: readonly MoveDir[] = ['up', 'down', 'left', 'right']

const DIRECTION_DELTAS: Record<MoveDir, { readonly row: number; readonly col: number }> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
}

export function isMoveDir(value: unknown): value is MoveDir {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function configFor(difficulty: DifficultyId): BoardConfig {
  return DIFFICULTIES[difficulty]
}

export function cellCount(config: BoardConfig): number {
  return config.size * config.size
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同迷宫」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function rowOf(index: number, size: number): number {
  return Math.floor(index / size)
}

export function colOf(index: number, size: number): number {
  return index % size
}

export function indexOf(row: number, col: number, size: number): number {
  return row * size + col
}

function onBoard(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size
}

/** 从 index 朝 dir 走一格的落点；走出棋盘返回 null */
export function targetOf(index: number, dir: MoveDir, size: number): number | null {
  const delta = DIRECTION_DELTAS[dir]
  if (!delta) return null
  const row = rowOf(index, size) + delta.row
  const col = colOf(index, size) + delta.col
  if (!onBoard(row, col, size)) return null
  return indexOf(row, col, size)
}

/** 相邻两格之间的方向；不相邻返回 null */
export function moveDirBetween(from: number, to: number, size: number): MoveDir | null {
  const deltaRow = rowOf(to, size) - rowOf(from, size)
  const deltaCol = colOf(to, size) - colOf(from, size)
  if (deltaRow === -1 && deltaCol === 0) return 'up'
  if (deltaRow === 1 && deltaCol === 0) return 'down'
  if (deltaRow === 0 && deltaCol === -1) return 'left'
  if (deltaRow === 0 && deltaCol === 1) return 'right'
  return null
}

/** 正交相邻的格子（不含自身，已按固定顺序排列） */
export function orthogonalNeighbors(index: number, size: number): number[] {
  const out: number[] = []
  for (const dir of DIRECTIONS) {
    const target = targetOf(index, dir, size)
    if (target !== null) out.push(target)
  }
  return out
}

export function isWall(walls: readonly boolean[], index: number): boolean {
  return walls[index] === true
}

export function floorIndexes(walls: readonly boolean[]): number[] {
  const out: number[] = []
  for (let index = 0; index < walls.length; index++) if (!walls[index]) out.push(index)
  return out
}

/** 玩家起点：左上角的通路格 */
export function startIndex(config: BoardConfig): number {
  return indexOf(1, 1, config.size)
}

/** 出口：右下角的通路格 */
export function goalIndex(config: BoardConfig): number {
  return indexOf(config.size - 2, config.size - 2, config.size)
}

/** 玩家站在 player 时能否朝 dir 走一格（目标必须在棋盘内且不是墙） */
export function canWalk(
  walls: readonly boolean[],
  size: number,
  player: number,
  dir: MoveDir,
): boolean {
  const target = targetOf(player, dir, size)
  return target !== null && !isWall(walls, target)
}

/**
 * 生成完美迷宫：返回行优先的墙格表（true = 墙）。
 *
 * 递归回溯（显式栈）：
 * 1. 初始全是墙，从 (1,1) 通路格出发；
 * 2. 每步收集「隔一格、尚未访问」的邻居（固定按 up/down/left/right 顺序，保证确定），
 *    用 rng.int 选一个，凿开中间的墙并走过去；没有未访问邻居就回退；
 * 3. DFS 覆盖全部通路格，凿开的每条连接都是一条树边 ⇒ 无环、任意两点通路唯一。
 */
export function createWalls(config: BoardConfig, seed: number): boolean[] {
  const { size } = config
  const walls = new Array<boolean>(cellCount(config)).fill(true)
  const rng = createRng(normalizeSeed(seed))
  const start = startIndex(config)
  walls[start] = false
  const stack: number[] = [start]

  while (stack.length > 0) {
    const current = stack[stack.length - 1]!
    // 候选 = 隔一格且还没被凿开的通路格；连同要凿开的墙一起记下
    const candidates: Array<{ cell: number; between: number }> = []
    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTAS[dir]
      const row = rowOf(current, size) + delta.row * 2
      const col = colOf(current, size) + delta.col * 2
      // 通路格的合法范围是 1..size−2（奇数坐标）：越界说明这一步要走出迷宫
      if (row < 1 || row > size - 2 || col < 1 || col > size - 2) continue
      const cell = indexOf(row, col, size)
      if (!walls[cell]) continue
      const between = indexOf(
        rowOf(current, size) + delta.row,
        colOf(current, size) + delta.col,
        size,
      )
      candidates.push({ cell, between })
    }
    if (candidates.length === 0) {
      stack.pop()
      continue
    }
    const picked = candidates[rng.int(candidates.length)]!
    walls[picked.between] = false
    walls[picked.cell] = false
    stack.push(picked.cell)
  }
  return walls
}
