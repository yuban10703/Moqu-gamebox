/**
 * 棋盘编码与规则转移测试：点/方格/边的判定、边的相邻方格、画线占格与换手、边界情况。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  BLACK,
  DIFFICULTIES,
  WHITE,
  applyClaim,
  boxIndexAt,
  boxesCompletedBy,
  boxesOfEdge,
  configFor,
  countScores,
  edgeIndexes,
  edgesOfBox,
  emptyState,
  inRange,
  indexOf,
  isBoardFull,
  isBox,
  isDot,
  isEdge,
  isHorizontalEdge,
  openEdges,
  remainingEdges,
  threesAfterClaim,
} from '../src/index.js'
import { claimedEdgesOfBox, customState } from './helpers.js'

describe('棋盘编码', () => {
  it('三档尺寸：3×3 / 4×4 / 5×5 方格 → 7×7 / 9×9 / 11×11 网格', () => {
    expect(DIFFICULTIES.starter.gridSize).toBe(7)
    expect(DIFFICULTIES.starter.cells).toBe(49)
    expect(DIFFICULTIES.starter.boxCount).toBe(9)
    expect(DIFFICULTIES.starter.edgeCount).toBe(24)
    expect(DIFFICULTIES.skilled.gridSize).toBe(9)
    expect(DIFFICULTIES.skilled.cells).toBe(81)
    expect(DIFFICULTIES.skilled.boxCount).toBe(16)
    expect(DIFFICULTIES.skilled.edgeCount).toBe(40)
    expect(DIFFICULTIES.challenging.gridSize).toBe(11)
    expect(DIFFICULTIES.challenging.cells).toBe(121)
    expect(DIFFICULTIES.challenging.boxCount).toBe(25)
    expect(DIFFICULTIES.challenging.edgeCount).toBe(60)
  })

  it('奇行奇列是点、偶行偶列是方格、其余是边；三类数量相加等于格数', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const config = configFor(difficulty)
      let dots = 0
      let boxes = 0
      let edges = 0
      for (let index = 0; index < config.cells; index++) {
        if (isDot(index, config)) dots += 1
        else if (isBox(index, config)) boxes += 1
        else if (isEdge(index, config)) edges += 1
      }
      expect(boxes, `${difficulty} 方格`).toBe(config.boxCount)
      expect(edges, `${difficulty} 边`).toBe(config.edgeCount)
      expect(dots, `${difficulty} 点`).toBe((config.boxes + 1) ** 2)
      expect(dots + boxes + edges).toBe(config.cells)
      expect(edgeIndexes(config)).toHaveLength(config.edgeCount)
    }
  })

  it('点与方格不是边；越界一律不算', () => {
    const config = configFor('starter')
    expect(isEdge(indexOf(0, 1, config), config)).toBe(true) // 横边
    expect(isEdge(indexOf(1, 0, config), config)).toBe(true) // 竖边
    expect(isEdge(indexOf(0, 0, config), config)).toBe(false) // 方格
    expect(isEdge(indexOf(1, 1, config), config)).toBe(false) // 点
    expect(isHorizontalEdge(indexOf(0, 1, config), config)).toBe(true)
    expect(isHorizontalEdge(indexOf(1, 0, config), config)).toBe(false)
    for (const index of [-1, config.cells, 1.5, Number.NaN]) {
      expect(inRange(index, config), String(index)).toBe(false)
      expect(isEdge(index, config), String(index)).toBe(false)
    }
  })

  it('每个方格四条边、每条边一到两个相邻方格，两边互为逆映射', () => {
    const config = configFor('starter')
    for (let row = 0; row < config.boxes; row++) {
      for (let col = 0; col < config.boxes; col++) {
        const box = boxIndexAt(row, col, config)
        const edges = edgesOfBox(box, config)
        expect(edges).toHaveLength(4)
        expect(new Set(edges).size).toBe(4)
        for (const edge of edges) {
          expect(isEdge(edge, config)).toBe(true)
          expect(boxesOfEdge(edge, config)).toContain(box)
        }
        // 没有被两个方格共用的边，就是贴着棋盘外框的那几条：
        // 角上的方格有 2 条、边上的方格有 1 条、内部方格 0 条
        const shared = edges.filter((edge) => boxesOfEdge(edge, config).length === 2)
        const borderSides =
          (row === 0 ? 1 : 0) +
          (row === config.boxes - 1 ? 1 : 0) +
          (col === 0 ? 1 : 0) +
          (col === config.boxes - 1 ? 1 : 0)
        expect(shared.length).toBe(4 - borderSides)
      }
    }
    // 每条边最多属于两个方格
    for (const edge of edgeIndexes(config)) {
      expect(boxesOfEdge(edge, config).length).toBeGreaterThanOrEqual(1)
      expect(boxesOfEdge(edge, config).length).toBeLessThanOrEqual(2)
    }
  })
})

describe('画线、占格与换手', () => {
  it('画到第四条边时方格归当前玩家，并且当前玩家连走', () => {
    const difficulty = 'starter' as const
    const box = boxIndexAt(0, 0, configFor(difficulty))
    const edges = claimedEdgesOfBox(box, 3, difficulty)
    // 前三条边由黑方画好（谁画的不影响归属规则）
    const state = customState(difficulty, { claimed: edges, turn: BLACK })
    expect(state.turn).toBe(BLACK)
    const fourth = edgesOfBox(box, configFor(difficulty)).find((edge) => !edges.includes(edge))!
    const next = applyClaim(state, fourth)
    expect(next.owners[box]).toBe(BLACK)
    expect(countScores(next.owners)).toEqual({ black: 1, white: 0 })
    // 连走：仍然是黑方，步数 +1
    expect(next.turn).toBe(BLACK)
    expect(next.moves).toBe(1)
    expect(next.log).toHaveLength(1)
    expect(next.lastEdge).toBe(fourth)
  })

  it('没占到格就换手；换到白方时随机游标 +1', () => {
    const difficulty = 'starter' as const
    const state = customState(difficulty, { turn: BLACK })
    const edge = openEdges(state)[0]!
    const next = applyClaim(state, edge)
    expect(next.owners.every((owner) => owner === null)).toBe(true)
    expect(next.turn).toBe(WHITE)
    expect(next.rngCursor).toBe(1)
    expect(next.edges[edge]).toBe(BLACK)
  })

  it('白方占格后同样连走，游标不再增加', () => {
    const difficulty = 'starter' as const
    const box = boxIndexAt(0, 0, configFor(difficulty))
    const edges = claimedEdgesOfBox(box, 3, difficulty)
    const state = customState(difficulty, { claimed: edges, turn: WHITE })
    const fourth = edgesOfBox(box, configFor(difficulty)).find((edge) => !edges.includes(edge))!
    const next = applyClaim(state, fourth)
    expect(next.owners[box]).toBe(WHITE)
    expect(next.turn).toBe(WHITE)
    expect(next.rngCursor).toBe(0)
    expect(next.moves).toBe(0) // 白方画线不计入玩家步数
  })

  it('boxesCompletedBy / threesAfterClaim 与几何一致', () => {
    const difficulty = 'starter' as const
    const config = configFor(difficulty)
    const box = boxIndexAt(1, 1, config)
    const edges = edgesOfBox(box, config)
    const three = customState(difficulty, { claimed: edges.slice(0, 3) })
    expect(boxesCompletedBy(three, edges[3]!)).toEqual([box])
    // 只有两条边时，画第三条会造出「三边格」
    const two = customState(difficulty, { claimed: edges.slice(0, 2) })
    expect(boxesCompletedBy(two, edges[2]!)).toEqual([])
    expect(threesAfterClaim(two, edges[2]!)).toContain(box)
  })

  it('非法画线抛 IllegalActionError：越界 / 点 / 方格 / 已画过', () => {
    const difficulty = 'starter' as const
    const config = configFor(difficulty)
    const state = customState(difficulty, { claimed: [indexOf(0, 1, config)], turn: BLACK })
    for (const index of [-1, config.cells, 1.5]) {
      expect(() => applyClaim(state, index), String(index)).toThrow(IllegalActionError)
    }
    expect(() => applyClaim(state, indexOf(0, 0, config))).toThrow(IllegalActionError) // 方格
    expect(() => applyClaim(state, indexOf(1, 1, config))).toThrow(IllegalActionError) // 点
    expect(() => applyClaim(state, indexOf(0, 1, config))).toThrow(IllegalActionError) // 已画
    // 非法画线不改变原状态
    expect(state.edges[indexOf(0, 1, config)]).toBe(BLACK)
  })

  it('openEdges / remainingEdges / isBoardFull 的口径一致', () => {
    const difficulty = 'starter' as const
    const config = configFor(difficulty)
    let state = emptyState(1, difficulty)
    expect(openEdges(state)).toHaveLength(config.edgeCount)
    expect(remainingEdges(state)).toBe(config.edgeCount)
    expect(isBoardFull(state)).toBe(false)
    const first = openEdges(state)[0]!
    state = applyClaim(state, first)
    expect(openEdges(state)).toHaveLength(config.edgeCount - 1)
    expect(remainingEdges(state)).toBe(config.edgeCount - 1)
    // 把所有边画满
    for (const edge of openEdges(state)) state = applyClaim(state, edge)
    expect(isBoardFull(state)).toBe(true)
    expect(remainingEdges(state)).toBe(0)
    expect(countScores(state.owners).black + countScores(state.owners).white).toBe(config.boxCount)
  })
})
