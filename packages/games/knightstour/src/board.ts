/**
 * 骑士巡游棋盘模型：8×8 棋盘、马步几何与**由 seed 决定的起始格**。
 *
 * 三档难度的棋盘完全相同，区别只有两处（写进难度配置，规则层与视图层都从这里取）：
 * - 起始格所在区域：角 / 边 / 中央；
 * - 是否提供可开启的提示（只有 starter 有）。
 *
 * 随机性只用于「从候选起始格里挑一个」，来自 core 的 createRng(seed)，绝不使用 Math.random：
 * 同 seed + 同难度必然从同一格出发。
 */
import { IllegalActionError, createRng } from '@eink/core'

export const GAME_ID = 'knightstour'

export const BOARD_SIZE = 8
export const CELLS = BOARD_SIZE * BOARD_SIZE

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

/** 起始格区域：角（4 格）/ 边（24 格，不含角）/ 中央（4 格） */
export type StartRegion = 'corner' | 'edge' | 'center'

export interface DifficultySpec {
  readonly region: StartRegion
  /** 是否提供可开启的提示（提示只改「怎么显示」，不改棋局） */
  readonly hint: boolean
}

export const DIFFICULTIES: Record<DifficultyId, DifficultySpec> = {
  starter: { region: 'corner', hint: true },
  skilled: { region: 'edge', hint: false },
  challenging: { region: 'center', hint: false },
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function difficultySpec(difficulty: DifficultyId): DifficultySpec {
  return DIFFICULTIES[difficulty]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同起点」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_SIZE)
}

export function colOf(index: number): number {
  return index % BOARD_SIZE
}

export function indexOf(row: number, col: number): number {
  return row * BOARD_SIZE + col
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

export function inRange(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELLS
}

/** 马的八个位移（固定顺序：先纵向两格，再横向两格） */
export const KNIGHT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]

/** from → to 是否是一个马步（只看几何，不看访问状态） */
export function isKnightMove(from: number, to: number): boolean {
  if (!inRange(from) || !inRange(to) || from === to) return false
  const deltaRow = rowOf(to) - rowOf(from)
  const deltaCol = colOf(to) - colOf(from)
  return KNIGHT_OFFSETS.some(
    ([offsetRow, offsetCol]) => offsetRow === deltaRow && offsetCol === deltaCol,
  )
}

/** 从 index 出发的全部马步落点（都在盘内，顺序固定） */
export function knightMoves(index: number): number[] {
  if (!inRange(index)) return []
  const row = rowOf(index)
  const col = colOf(index)
  const out: number[] = []
  for (const [offsetRow, offsetCol] of KNIGHT_OFFSETS) {
    const nextRow = row + offsetRow
    const nextCol = col + offsetCol
    if (onBoard(nextRow, nextCol)) out.push(indexOf(nextRow, nextCol))
  }
  return out
}

/** 某一档难度的候选起始格（升序） */
export function startCandidates(difficulty: DifficultyId): number[] {
  const region = difficultySpec(difficulty).region
  const out: number[] = []
  for (let index = 0; index < CELLS; index++) {
    const row = rowOf(index)
    const col = colOf(index)
    const onEdgeRow = row === 0 || row === BOARD_SIZE - 1
    const onEdgeCol = col === 0 || col === BOARD_SIZE - 1
    const isCorner = onEdgeRow && onEdgeCol
    const isEdge = (onEdgeRow || onEdgeCol) && !isCorner
    if (region === 'corner' && isCorner) out.push(index)
    else if (region === 'edge' && isEdge) out.push(index)
    else if (region === 'center' && rowOf(index) >= 3 && rowOf(index) <= 4 && col >= 3 && col <= 4) {
      out.push(index)
    }
  }
  return out
}

/** 由 seed + 难度决定起始格（同 seed 必然同起点） */
export function pickStart(seed: number, difficulty: DifficultyId): number {
  const candidates = startCandidates(difficulty)
  const rng = createRng(normalizeSeed(seed))
  return rng.pick(candidates)
}

/** 巡游是否走满全部 64 格 */
export function isTourComplete(visitedCount: number): boolean {
  return visitedCount >= CELLS
}

/** 升序插入访问集合（保证状态可以用深比较直接比对） */
export function insertVisited(visited: readonly number[], index: number): number[] {
  const out = [...visited, index]
  out.sort((a, b) => a - b)
  return out
}

/**
 * 提示用的推荐落点：在当前所有合法马步里挑「后续选择最少」的那一格（Warnsdorff 规则）。
 * 返回 null 表示无路可走。它只读状态、不改状态，`view` 与提示模式都用它。
 */
export function warnsdorffNext(current: number, visited: readonly number[]): number | null {
  const visitedSet = new Set(visited)
  let best: number | null = null
  let bestDegree = Number.POSITIVE_INFINITY
  for (const to of knightMoves(current)) {
    if (visitedSet.has(to)) continue
    let degree = 0
    for (const onward of knightMoves(to)) {
      if (onward !== current && !visitedSet.has(onward)) degree += 1
    }
    // knightMoves 按索引升序返回，因此「严格小于才替换」= 同分取索引最小的那个；
    // 提示必须完全确定，否则同一局面每次渲染都可能指向不同的格子
    if (degree < bestDegree) {
      best = to
      bestDegree = degree
    }
  }
  return best
}
