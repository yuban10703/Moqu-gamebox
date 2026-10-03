/**
 * 生成器测试：难度尺寸、确定性与**完美性**（任意两点恰有一条通路）。
 *
 * 完美性全部用 test/helpers.ts 里独立实现的 BFS / DFS 判定，不复用生成逻辑：
 *   1. 外墙一圈必须是墙，起点 (1,1) / 出口 (size−2,size−2) 必须是通路；
 *   2. 全部通路格连通；
 *   3. 通路格之间的相邻边数 = 通路格数 − 1（连通且边数 = 点数 − 1 ⇒ 生成树，无环）；
 *   4. 起点到出口的简单路径恰好 1 条（最直接的「通路唯一」判据）。
 */
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DIRECTIONS,
  cellCount,
  createWalls,
  goalIndex,
  indexOf,
  moveDirBetween,
  orthogonalNeighbors,
  startIndex,
  targetOf,
} from '../src/index.js'
import { countSimplePaths, floorEdgeCount, floorsOf, reachableCount } from './helpers.js'

describe('难度与尺寸', () => {
  it('三档尺寸是 11 / 15 / 21，且都是奇数（标准生成需要）', () => {
    expect(DIFFICULTY_IDS).toEqual(['starter', 'skilled', 'challenging'])
    expect(DIFFICULTIES.starter.size).toBe(11)
    expect(DIFFICULTIES.skilled.size).toBe(15)
    expect(DIFFICULTIES.challenging.size).toBe(21)
    for (const difficulty of DIFFICULTY_IDS) {
      expect(DIFFICULTIES[difficulty].size % 2).toBe(1)
      expect(cellCount(DIFFICULTIES[difficulty])).toBe(DIFFICULTIES[difficulty].size ** 2)
    }
  })

  it('起点/出口落在 1 与 size−2 的奇数坐标上', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      expect(startIndex(config)).toBe(indexOf(1, 1, config.size))
      expect(goalIndex(config)).toBe(indexOf(config.size - 2, config.size - 2, config.size))
    }
  })
})

describe('确定性', () => {
  it('同 seed 同难度逐格相同（重复生成 3 次）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const first = createWalls(config, 12345)
      expect(createWalls(config, 12345)).toEqual(first)
      expect(createWalls(config, 12345)).toEqual(first)
    }
  })

  it('不同 seed 会生成不同迷宫', () => {
    const config = DIFFICULTIES.starter
    const base = createWalls(config, 1).join()
    let different = 0
    for (let seed = 0; seed < 8; seed++) {
      if (createWalls(config, seed).join() !== base) different += 1
    }
    expect(different).toBeGreaterThan(0)
  })

  it('负数 / 小数 / NaN 种子被归一化，与同值结果一致', () => {
    const config = DIFFICULTIES.starter
    expect(createWalls(config, -1)).toEqual(createWalls(config, 0xffffffff))
    expect(createWalls(config, 1.9)).toEqual(createWalls(config, 1))
    expect(createWalls(config, Number.NaN)).toEqual(createWalls(config, 0))
  })
})

describe('完美迷宫性质（多组种子 × 三档难度）', () => {
  it('外墙一圈是墙，起点与出口是通路', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const size = config.size
      for (let seed = 0; seed < 6; seed++) {
        const walls = createWalls(config, seed)
        for (let col = 0; col < size; col++) {
          expect(walls[indexOf(0, col, size)], `seed ${seed} 上边`).toBe(true)
          expect(walls[indexOf(size - 1, col, size)], `seed ${seed} 下边`).toBe(true)
        }
        for (let row = 0; row < size; row++) {
          expect(walls[indexOf(row, 0, size)], `seed ${seed} 左边`).toBe(true)
          expect(walls[indexOf(row, size - 1, size)], `seed ${seed} 右边`).toBe(true)
        }
        expect(walls[startIndex(config)], `seed ${seed} 起点`).toBe(false)
        expect(walls[goalIndex(config)], `seed ${seed} 出口`).toBe(false)
      }
    }
  })

  it('全格连通 + 边数 = 通路格数 − 1（生成树，无环）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const size = config.size
      // 通路格数：cellCount = (奇数坐标格) + (凿开的连接)；生成树上连接数 = 格数 − 1
      const cellLattice = ((size - 1) / 2) ** 2
      for (let seed = 0; seed < 12; seed++) {
        const walls = createWalls(config, seed)
        const floors = floorsOf(walls)
        expect(floors.length, `seed ${seed} 通路格数`).toBe(2 * cellLattice - 1)
        // 连通：从起点能走遍所有通路格
        expect(reachableCount(walls, size, startIndex(config)), `seed ${seed} 连通性`).toBe(
          floors.length,
        )
        // 无环：连通 + 边数 = 点数 − 1 ⇒ 树
        expect(floorEdgeCount(walls, size), `seed ${seed} 边数`).toBe(floors.length - 1)
      }
    }
  })

  it('起点到出口的简单路径恰好 1 条（任意两点通路唯一）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      for (let seed = 0; seed < 12; seed++) {
        const walls = createWalls(config, seed)
        expect(
          countSimplePaths(walls, config.size, startIndex(config), goalIndex(config), 2),
          `seed ${seed}`,
        ).toBe(1)
      }
    }
  })

  it('21×21 的迷宫也满足完美性（抽样）', () => {
    const config = DIFFICULTIES.challenging
    const walls = createWalls(config, 20240607)
    const floors = floorsOf(walls)
    expect(reachableCount(walls, config.size, startIndex(config))).toBe(floors.length)
    expect(floorEdgeCount(walls, config.size)).toBe(floors.length - 1)
    expect(countSimplePaths(walls, config.size, startIndex(config), goalIndex(config), 2)).toBe(1)
  })
})

describe('坐标工具', () => {
  it('targetOf 越界返回 null，moveDirBetween 与它互逆', () => {
    const size = 11
    const start = indexOf(1, 1, size)
    expect(targetOf(start, 'up', size)).toBe(indexOf(0, 1, size))
    expect(targetOf(start, 'left', size)).toBe(indexOf(1, 0, size))
    expect(targetOf(indexOf(0, 0, size), 'up', size)).toBeNull()
    expect(targetOf(indexOf(0, 0, size), 'left', size)).toBeNull()
    for (const dir of DIRECTIONS) {
      const target = targetOf(start, dir, size)
      if (target !== null) expect(moveDirBetween(start, target, size)).toBe(dir)
    }
    // 不相邻 / 自身都返回 null
    expect(moveDirBetween(start, start, size)).toBeNull()
    expect(moveDirBetween(start, indexOf(3, 3, size), size)).toBeNull()
  })

  it('orthogonalNeighbors 顺序稳定且不含自身', () => {
    const size = 11
    expect(orthogonalNeighbors(indexOf(1, 1, size), size)).toEqual([
      indexOf(0, 1, size),
      indexOf(2, 1, size),
      indexOf(1, 0, size),
      indexOf(1, 2, size),
    ])
    for (const index of [indexOf(0, 0, size), indexOf(5, 5, size), indexOf(10, 10, size)]) {
      const neighbors = orthogonalNeighbors(index, size)
      expect(neighbors).not.toContain(index)
      expect(new Set(neighbors).size).toBe(neighbors.length)
    }
  })
})
