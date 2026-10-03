/**
 * 测试夹具与**独立实现**的盘面几何（点位 / 邻接边 / 成三线）。
 *
 * 独立实现按「坐标 + 行列表」直接推导，不使用 src 的 RING_EDGES / RADIAL_EDGES / MILL_LINES，
 * 这样方向或连线写错时能被抓出来。
 */
import {
  BLACK,
  STONES_PER_SIDE,
  WHITE,
  createBoardState,
  phaseOf,
  type DifficultyId,
  type NinemensState,
  type Player,
} from '../src/index.js'

export const SIZE = 7
export const POINT_TOTAL = 24

export function fresh(seed = 20240607, difficulty: DifficultyId = 'starter'): NinemensState {
  return createBoardState(seed, difficulty)
}

/** 环内位置 → 坐标（独立判据：三环 min=k、max=6-k、mid=3） */
export function ringPoint(ring: number, position: number): readonly [number, number] {
  const min = ring
  const max = 6 - ring
  const mid = 3
  const table: ReadonlyArray<readonly [number, number]> = [
    [min, min],
    [min, mid],
    [min, max],
    [mid, max],
    [max, max],
    [max, mid],
    [max, min],
    [mid, min],
  ]
  return table[position]!
}

/** 独立实现：24 个点位坐标（紧凑索引 = ring*8+position） */
export function independentCoords(): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = []
  for (let ring = 0; ring < 3; ring++) {
    for (let position = 0; position < 8; position++) out.push(ringPoint(ring, position))
  }
  return out
}

function coordOf(points: ReadonlyArray<readonly [number, number]>, index: number) {
  return points[index]!
}

/** 独立实现：环边（同环相邻位置）+ 径向边（相邻环同方位边中点） */
export function independentEdges(): Array<readonly [number, number]> {
  const points = independentCoords()
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
  const seen = new Map<string, readonly [number, number]>()
  for (let ring = 0; ring < 3; ring++) {
    for (let position = 0; position < 8; position++) {
      const a = ring * 8 + position
      const b = ring * 8 + ((position + 1) % 8)
      seen.set(key(a, b), [a, b])
    }
  }
  for (let ring = 0; ring + 1 < 3; ring++) {
    for (const position of [1, 3, 5, 7]) {
      const a = ring * 8 + position
      const b = (ring + 1) * 8 + position
      seen.set(key(a, b), [a, b])
    }
  }
  void points
  void coordOf
  return [...seen.values()]
}

/** 独立实现：成三线（同行按列排序每 3 个一段；同列按行排序每 3 个一段） */
export function independentMills(): number[][] {
  const points = independentCoords()
  const byRow = new Map<number, number[]>()
  const byCol = new Map<number, number[]>()
  points.forEach(([row, col], index) => {
    if (!byRow.has(row)) byRow.set(row, [])
    byRow.get(row)!.push(col * 100 + index)
    if (!byCol.has(col)) byCol.set(col, [])
    byCol.get(col)!.push(row * 100 + index)
  })
  const lines: number[][] = []
  for (const groups of [byRow, byCol]) {
    for (const [, list] of groups) {
      const sorted = [...list].sort((a, b) => a - b).map((item) => item % 100)
      for (let start = 0; start + 3 <= sorted.length; start += 3) {
        lines.push(sorted.slice(start, start + 3))
      }
    }
  }
  return lines
}

export interface FixtureOptions {
  readonly turn?: Player
  readonly inHand?: { readonly black: number; readonly white: number }
  readonly removed?: { readonly black: number; readonly white: number }
  readonly pendingRemove?: number
  readonly selected?: number | null
  readonly difficulty?: DifficultyId
}

/**
 * 手工摆一个局面。默认把「手上」按 9 − 在场算出（被吃为 0），
 * 需要飞子期时显式给 `inHand: { black: 0, white: 0 }`。
 */
export function fixture(
  black: readonly number[],
  white: readonly number[],
  options: FixtureOptions = {},
): NinemensState {
  const base = fresh(1, options.difficulty ?? 'starter')
  const points = new Array<Player | null>(POINT_TOTAL).fill(null)
  for (const point of black) points[point] = BLACK
  for (const point of white) points[point] = WHITE
  const removed = options.removed ?? { black: 0, white: 0 }
  const inHand = options.inHand ?? {
    black: Math.max(0, STONES_PER_SIDE - black.length - removed.black),
    white: Math.max(0, STONES_PER_SIDE - white.length - removed.white),
  }
  const partial: NinemensState = {
    ...base,
    points,
    inHand: { ...inHand },
    removed: { ...removed },
    turn: options.turn ?? BLACK,
    pendingRemove: options.pendingRemove ?? 0,
    selected: options.selected ?? null,
  }
  return { ...partial, phase: phaseOf(partial) }
}

/** 独立实现的「某方在场子数」 */
export function independentBoardCount(state: NinemensState, player: Player): number {
  return state.points.filter((owner) => owner === player).length
}

/** 独立实现的不变量检查：在场 + 被吃 + 手上 = 9 */
export function invariantProblems(state: NinemensState): string[] {
  const problems: string[] = []
  for (const player of [BLACK, WHITE] as const) {
    const onBoard = independentBoardCount(state, player)
    const total = onBoard + state.removed[player] + state.inHand[player]
    if (total !== STONES_PER_SIDE) {
      problems.push(`${player}: ${onBoard} + ${state.removed[player]} + ${state.inHand[player]} = ${total}`)
    }
  }
  return problems
}

/** 用坐标画盘（用 src 的 POINTS 反查，仅供调试输出） */
export function describeBoard(state: NinemensState): string {
  const rows: string[] = []
  for (let row = 0; row < SIZE; row++) {
    let line = ''
    for (let col = 0; col < SIZE; col++) {
      const point = state.points.findIndex(
        (_, index) => independentCoords()[index]![0] === row && independentCoords()[index]![1] === col,
      )
      if (point < 0) line += ' .'
      else if (state.points[point] === BLACK) line += ' B'
      else if (state.points[point] === WHITE) line += ' W'
      else line += ' o'
    }
    rows.push(line)
  }
  return rows.join('\n')
}
