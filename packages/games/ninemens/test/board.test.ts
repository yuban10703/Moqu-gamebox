/**
 * 棋盘几何测试：24 点位 / 32 条邻接边 / 16 条成三线 / 阶段推导 / 起始局面。
 *
 * 期望值全部由 helpers 的**独立实现**按坐标算出并逐一比对（不复用 src 的环序常量）。
 * 注意经典盘面的边数是 **32**（24 条环边 + 8 条径向边）而不是 28：
 * 径向线确实是 4 条，但每条被中间方框的边中点分成 2 段；度数分布 12×2 + 8×3 + 4×4 = 64 = 2×32 可以自证。
 */
import { describe, expect, it } from 'vitest'
import {
  ADJACENCY_EDGES,
  ADJACENT,
  BLACK,
  BOARD_SIZE,
  GRID_CELLS,
  MILL_LINES,
  POINTS,
  POINTS_PER_RING,
  POINT_AT_GRID,
  POINT_COUNT,
  RADIAL_EDGES,
  RADIAL_LINES,
  RING_COUNT,
  RING_EDGES,
  STONES_PER_SIDE,
  WHITE,
  areAdjacent,
  boardCount,
  colOf,
  createBoardState,
  degreeOf,
  emptyPoints,
  gridIndexOf,
  isPointAtGrid,
  otherPlayer,
  phaseOf,
  pointAtGrid,
  pointsOf,
  rowOf,
  stonesLeft,
} from '../src/index.js'
import {
  SIZE,
  fixture,
  fresh,
  independentBoardCount,
  independentCoords,
  independentEdges,
  independentMills,
  invariantProblems,
} from './helpers.js'

describe('点位判据', () => {
  it('7×7 网格里恰好 24 个点位、25 个非点位', () => {
    expect(BOARD_SIZE).toBe(7)
    expect(GRID_CELLS).toBe(49)
    expect(POINT_COUNT).toBe(24)
    expect(POINTS).toHaveLength(24)
    expect(POINT_AT_GRID.filter((point) => point >= 0)).toHaveLength(24)
    expect(POINT_AT_GRID.filter((point) => point < 0)).toHaveLength(25)
    expect(RING_COUNT).toBe(3)
    expect(POINTS_PER_RING).toBe(8)
  })

  it('点位坐标 = 三个同心方框（边长 7/5/3）的四个角 + 四条边中点', () => {
    const expected = independentCoords()
    POINTS.forEach((point, index) => {
      expect([point.row, point.col], `point ${index}`).toEqual([...expected[index]!])
    })
    // 每个环 8 个点：4 个角（行列都是 min/max）+ 4 个边中点（一个方向是 3）
    for (let ring = 0; ring < RING_COUNT; ring++) {
      const ringPoints = POINTS.filter((point) => point.ring === ring)
      expect(ringPoints).toHaveLength(8)
      const corners = ringPoints.filter(
        (point) => [0, 2, 4, 6].includes(point.position),
      )
      const midpoints = ringPoints.filter((point) => [1, 3, 5, 7].includes(point.position))
      expect(corners).toHaveLength(4)
      expect(midpoints).toHaveLength(4)
      for (const corner of corners) {
        expect([corner.row, corner.col].filter((value) => value === ring || value === 6 - ring)).toHaveLength(2)
      }
      for (const midpoint of midpoints) {
        expect([midpoint.row, midpoint.col]).toContain(3)
      }
    }
  })

  it('网格格 ↔ 点位索引是一一对应的（用坐标互查）', () => {
    for (const point of POINTS) {
      const grid = gridIndexOf(point.index)
      expect(Math.floor(grid / BOARD_SIZE)).toBe(point.row)
      expect(grid % BOARD_SIZE).toBe(point.col)
      expect(pointAtGrid(grid)).toBe(point.index)
      expect(isPointAtGrid(grid)).toBe(true)
      expect(rowOf(point.index)).toBe(point.row)
      expect(colOf(point.index)).toBe(point.col)
    }
    let count = 0
    for (let grid = 0; grid < GRID_CELLS; grid++) if (isPointAtGrid(grid)) count += 1
    expect(count).toBe(24)
  })
})

describe('连接线判据', () => {
  it('环边 24 条 + 径向边 8 条 = 32 条邻接边，且与独立几何实现一致', () => {
    expect(RING_EDGES).toHaveLength(24)
    expect(RADIAL_LINES).toHaveLength(4)
    expect(RADIAL_EDGES).toHaveLength(8)
    expect(ADJACENCY_EDGES).toHaveLength(32)

    const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
    const mine = new Set(ADJACENCY_EDGES.map(([a, b]) => key(a, b)))
    const theirs = new Set(independentEdges().map(([a, b]) => key(a, b)))
    expect([...mine].sort()).toEqual([...theirs].sort())
  })

  it('每条线两端都是点位、无自环、无重复、且对称', () => {
    const seen = new Set<string>()
    for (const [a, b] of ADJACENCY_EDGES) {
      expect(a).not.toBe(b)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(POINT_COUNT)
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`
      expect(seen.has(key), `duplicate edge ${key}`).toBe(false)
      seen.add(key)
      expect(ADJACENT[a]).toContain(b)
      expect(ADJACENT[b]).toContain(a)
      expect(areAdjacent(a, b)).toBe(true)
      expect(areAdjacent(b, a)).toBe(true)
    }
    // 相邻表只含真正相邻的点
    for (let point = 0; point < POINT_COUNT; point++) {
      for (const neighbor of ADJACENT[point]!) {
        expect(areAdjacent(point, neighbor)).toBe(true)
        expect(neighbor).not.toBe(point)
      }
      expect(new Set(ADJACENT[point]).size).toBe(ADJACENT[point]!.length)
    }
  })

  it('经典盘面的度数特征：12 个角点度数 2、8 个边中点度数 3、4 个中框边中点度数 4', () => {
    const distribution = new Map<number, number>()
    for (const point of POINTS) {
      const degree = degreeOf(point.index)
      distribution.set(degree, (distribution.get(degree) ?? 0) + 1)
    }
    expect([...distribution.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [2, 12],
      [3, 8],
      [4, 4],
    ])
    // 度数和 = 2 × 边数
    const sum = POINTS.reduce((total, point) => total + degreeOf(point.index), 0)
    expect(sum).toBe(2 * ADJACENCY_EDGES.length)
    expect(sum).toBe(64)
    // 度数 4 的恰好是中框（ring 1）的四个边中点 —— 也就是「径向线」上的中间枢纽
    const hubs = POINTS.filter((point) => degreeOf(point.index) === 4)
    expect(hubs.map((point) => point.index).sort((a, b) => a - b)).toEqual([9, 11, 13, 15])
    for (const hub of hubs) {
      expect(hub.ring).toBe(1)
      expect([1, 3, 5, 7]).toContain(hub.position)
    }
  })

  it('径向线只有 4 条：每条串起三个环同方位的边中点，相邻两环之间连一段', () => {
    expect(RADIAL_LINES).toHaveLength(4)
    for (const line of RADIAL_LINES) {
      expect(line).toHaveLength(3)
      const coords = line.map((point) => [rowOf(point), colOf(point)])
      // 三个点共线：行相同或者列相同
      const sameRow = coords.every(([row]) => row === coords[0]![0])
      const sameCol = coords.every(([, col]) => col === coords[0]![1])
      expect(sameRow || sameCol, `radial line ${line.join('-')}`).toBe(true)
      // 相邻两点必须有邻接边，间隔两点之间没有（不是一跳）
      expect(areAdjacent(line[0]!, line[1]!)).toBe(true)
      expect(areAdjacent(line[1]!, line[2]!)).toBe(true)
      expect(areAdjacent(line[0]!, line[2]!)).toBe(false)
    }
  })
})

describe('成三线判据', () => {
  it('恰好 16 条成三线（8 行 + 8 列），每条 3 个共线点位且段内相邻', () => {
    expect(MILL_LINES).toHaveLength(16)
    const key = (line: readonly number[]) => [...line].sort((a, b) => a - b).join('-')
    const mine = new Set(MILL_LINES.map(key))
    expect(mine.size).toBe(16)
    const theirs = new Set(independentMills().map(key))
    expect([...mine].sort()).toEqual([...theirs].sort())

    for (const line of MILL_LINES) {
      expect(line).toHaveLength(3)
      const rows = new Set(line.map((point) => rowOf(point)))
      const cols = new Set(line.map((point) => colOf(point)))
      expect(rows.size === 1 || cols.size === 1, `line ${line.join('-')}`).toBe(true)
      expect(areAdjacent(line[0]!, line[1]!)).toBe(true)
      expect(areAdjacent(line[1]!, line[2]!)).toBe(true)
    }
  })

  it('行线 8 条、列线 8 条；行 3 被中间的非点位 (3,3) 分成两段', () => {
    const horizontal = MILL_LINES.filter((line) => new Set(line.map((point) => rowOf(point))).size === 1)
    const vertical = MILL_LINES.filter((line) => new Set(line.map((point) => colOf(point))).size === 1)
    expect(horizontal).toHaveLength(8)
    expect(vertical).toHaveLength(8)
    // (3,3) 不是点位 ⇒ 行 3 的两段分别落在列 0..2 与 4..6
    const rowThree = horizontal.filter((line) => rowOf(line[0]!) === 3)
    expect(rowThree).toHaveLength(2)
    const cols = rowThree.map((line) => line.map((point) => colOf(point)).sort((a, b) => a - b))
    expect(cols.sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 1, 2],
      [4, 5, 6],
    ])
    // 中间格不是点位
    expect(isPointAtGrid(3 * BOARD_SIZE + 3)).toBe(false)
  })
})

describe('阶段与起始局面', () => {
  it('阶段判据：手上还有子 → 落子期；手上空了且在场 3 子 → 飞子期；否则移动期', () => {
    const start = fresh()
    expect(phaseOf(start)).toBe('placing')
    expect(start.inHand).toEqual({ black: STONES_PER_SIDE, white: STONES_PER_SIDE })
    expect(start.turn).toBe(BLACK)
    expect(start.points.every((owner) => owner === null)).toBe(true)
    expect(start.removed).toEqual({ black: 0, white: 0 })
    expect(start.pendingRemove).toBe(0)
    expect(start.selected).toBeNull()
    expect(start.log).toHaveLength(0)

    const moving = fixture([0, 1, 2, 3], [4, 5, 6, 7], { inHand: { black: 0, white: 0 } })
    expect(phaseOf(moving)).toBe('moving')
    const flying = fixture([0, 1, 2], [4, 5, 6], {
      inHand: { black: 0, white: 0 },
      removed: { black: 6, white: 6 },
    })
    expect(phaseOf(flying)).toBe('flying')
    expect(stonesLeft(flying, BLACK)).toBe(3)
    // 只剩 4 子时还不能飞
    expect(
      phaseOf(fixture([0, 1, 2, 3], [4, 5, 6], { inHand: { black: 0, white: 0 }, removed: { black: 5, white: 6 } })),
    ).toBe('moving')
    expect(phaseOf({ ...moving, turn: WHITE, inHand: { black: 0, white: 3 } })).toBe('placing')
  })

  it('棋子计数与空点位、不变量', () => {
    const state = fixture([0, 1, 2], [7, 8])
    expect(boardCount(state, BLACK)).toBe(3)
    expect(boardCount(state, WHITE)).toBe(2)
    expect(independentBoardCount(state, BLACK)).toBe(3)
    expect(pointsOf(state, BLACK)).toEqual([0, 1, 2])
    expect(emptyPoints(state)).toHaveLength(POINT_COUNT - 5)
    expect(stonesLeft(state, BLACK)).toBe(STONES_PER_SIDE)
    expect(invariantProblems(state)).toEqual([])
    expect(otherPlayer(BLACK)).toBe(WHITE)
    expect(SIZE).toBe(7)
    expect(createBoardState(1, 'starter').seed).toBe(1)
  })
})
