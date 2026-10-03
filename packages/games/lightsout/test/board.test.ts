/**
 * 棋盘模型测试：难度配置、十字翻转的边界、确定性与打乱。
 *
 * 「必定可解」用两条互不相同的路径验证：
 *   1. 构造性：把打乱用的翻转序列原样再翻一遍 → 必然回到全灭（对合运算）；
 *   2. 独立性：test/helpers.ts 里用 GF(2) 高斯消元独立判定「存在解」，并给出解序列再验证一次。
 * 关灯游戏并非所有局面都有解（5×5 的方程矩阵秩 23 < 25），因此第 2 条不是同义反复。
 */
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  cellCount,
  createLights,
  crossIndexes,
  isAllOff,
  litCount,
  replay,
  scramblePlan,
  toggleCross,
} from '../src/index.js'
import { allOff, solveLightsOut } from './helpers.js'

describe('难度与尺寸', () => {
  it('三档配置：5×5（6 次翻转）/ 5×5（12 次）/ 6×6（20 次）', () => {
    expect(DIFFICULTY_IDS).toEqual(['starter', 'skilled', 'challenging'])
    expect(DIFFICULTIES.starter).toEqual({ size: 5, scrambleSteps: 6 })
    expect(DIFFICULTIES.skilled).toEqual({ size: 5, scrambleSteps: 12 })
    expect(DIFFICULTIES.challenging).toEqual({ size: 6, scrambleSteps: 20 })
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      expect(cellCount(config)).toBe(config.size ** 2)
      expect(config.scrambleSteps).toBeGreaterThan(0)
    }
  })
})

describe('十字翻转的边界', () => {
  it('角落 3 格、边 4 格、内部 5 格，且都含自身', () => {
    const size = 5
    // 左上角 (0,0)：自身 + 右 + 下
    expect(crossIndexes(0, size).sort((a, b) => a - b)).toEqual([0, 1, 5])
    // 右下角 (4,4)：自身 + 上 + 左
    expect(crossIndexes(24, size).sort((a, b) => a - b)).toEqual([19, 23, 24])
    // 上边非角 (0,2)：自身 + 左右 + 下
    expect(crossIndexes(2, size).sort((a, b) => a - b)).toEqual([1, 2, 3, 7])
    // 左边非角 (2,0)：自身 + 上下 + 右
    expect(crossIndexes(10, size).sort((a, b) => a - b)).toEqual([5, 10, 11, 15])
    // 正中央 (2,2)：自身 + 上下左右
    expect(crossIndexes(12, size).sort((a, b) => a - b)).toEqual([7, 11, 12, 13, 17])

    expect(crossIndexes(0, size)).toHaveLength(3)
    expect(crossIndexes(2, size)).toHaveLength(4)
    expect(crossIndexes(12, size)).toHaveLength(5)
  })

  it('每个十字都含自身、无重复、不越界，且关系对称（i 影响 j ⇔ j 影响 i）', () => {
    for (const size of [5, 6]) {
      const total = size * size
      for (let index = 0; index < total; index++) {
        const cross = crossIndexes(index, size)
        expect(cross).toContain(index)
        expect(new Set(cross).size).toBe(cross.length)
        for (const target of cross) {
          expect(target).toBeGreaterThanOrEqual(0)
          expect(target).toBeLessThan(total)
          expect(crossIndexes(target, size)).toContain(index)
        }
      }
    }
  })

  it('toggleCross 只翻十字范围，翻两次等于没翻，且不改动入参', () => {
    const size = 5
    const off = allOff(size)
    const after = toggleCross(off, size, 12)
    expect(after.filter(Boolean)).toHaveLength(5)
    for (const index of crossIndexes(12, size)) expect(after[index]).toBe(true)
    expect(after[0]).toBe(false)
    // 对合
    expect(toggleCross(after, size, 12)).toEqual(off)
    // 入参未被改写
    expect(off.every((lit) => !lit)).toBe(true)

    // 角落只翻 3 格
    const corner = toggleCross(off, size, 24)
    expect(litCount(corner)).toBe(3)
  })
})

describe('确定性打乱', () => {
  it('同 seed 同难度完全一致（图案 / 翻转序列 / 游标）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const first = scramblePlan(config, 12345)
      const second = scramblePlan(config, 12345)
      expect(second.lights).toEqual(first.lights)
      expect(second.toggles).toEqual(first.toggles)
      expect(second.cursor).toBe(first.cursor)
      // createLights 是同一个入口的便捷包装
      expect(createLights(config, 12345)).toEqual(first.lights)
    }
  })

  it('不同 seed 会生成不同谜题', () => {
    const config = DIFFICULTIES.starter
    const base = scramblePlan(config, 1).lights.join()
    let different = 0
    for (let seed = 0; seed < 8; seed++) {
      if (scramblePlan(config, seed).lights.join() !== base) different += 1
    }
    expect(different).toBeGreaterThan(0)
  })

  it('负数 / 小数 / NaN 种子被归一化，与同值结果一致', () => {
    const config = DIFFICULTIES.starter
    expect(scramblePlan(config, -1)).toEqual(scramblePlan(config, 0xffffffff))
    expect(scramblePlan(config, 1.9)).toEqual(scramblePlan(config, 1))
    expect(scramblePlan(config, Number.NaN)).toEqual(scramblePlan(config, 0))
  })

  it('打乱步数与翻转序列长度一致，且开局一定不是已解局面', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      for (let seed = 0; seed < 12; seed++) {
        const puzzle = scramblePlan(config, seed)
        expect(puzzle.toggles).toHaveLength(config.scrambleSteps)
        expect(isAllOff(puzzle.lights), `seed ${seed}`).toBe(false)
        expect(litCount(puzzle.lights)).toBeGreaterThan(0)
        expect(puzzle.cursor).toBeGreaterThanOrEqual(config.scrambleSteps)
      }
    }
  })

  it('打乱若翻回全灭局面会退回重打（cursor 表明用了一次以上尝试）', () => {
    // 3×3 + 4 步的小配置里，「A、B、A、B」这类翻转会让 XOR 归零：
    // 这批种子里必然出现「第一次尝试失败 → 换随机流重打」的情况。
    const config = { size: 3, scrambleSteps: 4 }
    let retried = 0
    for (let seed = 0; seed < 500; seed++) {
      const puzzle = scramblePlan(config, seed)
      expect(isAllOff(puzzle.lights), `seed ${seed}`).toBe(false)
      if (puzzle.cursor > config.scrambleSteps) retried += 1
    }
    expect(retried).toBeGreaterThan(0)
  })
})

describe('必定可解', () => {
  it('构造性：把打乱用的翻转序列再走一遍，必然回到全灭', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      for (let seed = 0; seed < 20; seed++) {
        const puzzle = scramblePlan(config, seed)
        const solved = replay(puzzle.lights, config.size, puzzle.toggles)
        expect(isAllOff(solved), `${difficulty} seed ${seed}`).toBe(true)
      }
    }
  })

  it('独立性：GF(2) 高斯消元判定存在解，且解序列真的能打成全灭', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      for (let seed = 0; seed < 20; seed++) {
        const puzzle = scramblePlan(config, seed)
        const solution = solveLightsOut(puzzle.lights, config.size)
        expect(solution, `${difficulty} seed ${seed} 应当有解`).not.toBeNull()
        // 解用独立求解器算出，再用规则层的翻转验证一遍
        expect(isAllOff(replay(puzzle.lights, config.size, solution!))).toBe(true)
      }
    }
  })

  it('独立判据有区分度：5×5 上确实存在无解图案（求解器返回 null）', () => {
    const size = 5
    // 单个亮灯的局面里，一部分有解、一部分无解 —— 若求解器永远返回解，这条会失败
    const single = []
    for (let index = 0; index < size * size; index++) {
      const lights = allOff(size)
      lights[index] = true
      single.push(solveLightsOut(lights, size))
    }
    expect(single.some((solution) => solution !== null)).toBe(true)
    expect(single.some((solution) => solution === null)).toBe(true)
  })
})
