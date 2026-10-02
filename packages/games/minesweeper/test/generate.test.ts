/**
 * 布雷与邻域计算的单元测试。
 * 重点是「确定性」与「首点必安全」这两条硬约束，以及洪水式连锁的边界。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  adjacentMineCount,
  cellCount,
  DIFFICULTY_IDS,
  DIFFICULTIES,
  expandChain,
  mulberry32,
  neighborsOf,
  placeMines,
  type BoardConfig,
} from '../src/index.js'

describe('mulberry32 与 core 的随机源一致', () => {
  it('同一 seed 的随机序列逐位相同（防止两处实现漂移）', () => {
    for (const seed of [0, 1, 2, 42, 123456789, 0xffffffff]) {
      const local = mulberry32(seed)
      const core = createRng(seed)
      for (let i = 0; i < 8; i++) {
        expect(local()).toBe(core.next())
      }
    }
  })

  it('不同 seed 的序列不同，且取值落在 [0,1)', () => {
    const a = mulberry32(7)
    const b = mulberry32(8)
    const values = [a(), a(), a(), b(), b(), b()]
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(values[0]).not.toBe(values[3])
  })
})

describe('邻域计算', () => {
  const config: BoardConfig = { cols: 5, rows: 5, mineCount: 1 }

  it('角 3 个、边 5 个、中心 8 个，且都不含自身、不越界', () => {
    expect(neighborsOf(config, 0).sort((a, b) => a - b)).toEqual([1, 5, 6])
    expect(neighborsOf(config, 2)).toHaveLength(5)
    expect(neighborsOf(config, 12)).toHaveLength(8)
    for (const index of [0, 2, 12, 24]) {
      const list = neighborsOf(config, index)
      expect(list).not.toContain(index)
      expect(new Set(list).size).toBe(list.length)
      for (const neighbor of list) {
        expect(neighbor).toBeGreaterThanOrEqual(0)
        expect(neighbor).toBeLessThan(cellCount(config))
      }
    }
  })

  it('adjacentMineCount 只数 8 邻域里的雷', () => {
    const mines = new Set([0, 24])
    expect(adjacentMineCount(mines, config, 6)).toBe(1)
    expect(adjacentMineCount(mines, config, 12)).toBe(0)
    expect(adjacentMineCount(mines, config, 0)).toBe(0)
  })
})

describe('placeMines', () => {
  it('雷数固定、无重复、升序，且消耗的随机数个数等于雷数', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const result = placeMines(config, 12345, 0)
      expect(result.mines).toHaveLength(config.mineCount)
      expect(new Set(result.mines).size).toBe(config.mineCount)
      expect([...result.mines].sort((a, b) => a - b)).toEqual(result.mines)
      expect(result.cursor).toBe(config.mineCount)
    }
  })

  it('同 seed 同首点完全一致；不同 seed 会产生不同雷图', () => {
    const config = DIFFICULTIES.starter
    const center = 40
    const first = placeMines(config, 99, center)
    expect(placeMines(config, 99, center)).toEqual(first)
    const layouts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => placeMines(config, seed, center).mines.join(',')),
    )
    expect(layouts.size).toBeGreaterThan(1)
  })

  it('首点及其 8 邻域内绝无雷（多难度 × 多种子 × 多落点）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const total = cellCount(config)
      const firsts = [0, config.cols - 1, config.cols, centerOf(config), total - 1]
      for (const seed of [0, 1, 7, 42, 99991]) {
        for (const first of firsts) {
          const { mines } = placeMines(config, seed, first)
          const safe = new Set([first, ...neighborsOf(config, first)])
          for (const mine of mines) expect(safe.has(mine)).toBe(false)
        }
      }
    }
  })

  it('首点越界时抛错', () => {
    const config = DIFFICULTIES.starter
    expect(() => placeMines(config, 1, -1)).toThrow()
    expect(() => placeMines(config, 1, cellCount(config))).toThrow()
    expect(() => placeMines(config, 1, 1.5)).toThrow()
  })
})

function centerOf(config: BoardConfig): number {
  return Math.floor(config.rows / 2) * config.cols + Math.floor(config.cols / 2)
}

describe('expandChain（洪水式连锁）', () => {
  const config: BoardConfig = { cols: 5, rows: 5, mineCount: 1 }

  it('从一个 0 雷格出发连锁翻开整片 0 区，但不动雷和旗子', () => {
    const mines = new Set([0])
    const flags = new Set([12])
    const opened = expandChain(config, mines, flags, new Set(), 24)
    // 25 格 − 1 颗雷 − 1 面旗
    expect(opened).toHaveLength(23)
    expect(opened).not.toContain(0)
    expect(opened).not.toContain(12)
    expect(opened).toContain(24)
    expect(opened).toContain(6)
    expect([...opened].sort((a, b) => a - b)).toEqual(opened)
  })

  it('从数字格出发只翻开它自己，不连锁', () => {
    const mines = new Set([0])
    const opened = expandChain(config, mines, new Set(), new Set(), 1)
    expect(opened).toEqual([1])
  })

  it('已有翻开集合会被保留（不会因为连锁而丢格子）', () => {
    const opened = expandChain(config, new Set([0]), new Set(), new Set([7]), 1)
    expect(opened).toEqual([1, 7])
  })
})
