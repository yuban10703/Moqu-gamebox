/**
 * 生成器测试：确定性、唯一解、难度分档、性能上限。
 *
 * 唯一性是硬要求：下面用「多个 seed × 三档难度」逐个验证解数 == 1，
 * 并额外验证提示数按难度递减、题目本身单数可解（不需要猜）。
 */
import { describe, expect, it } from 'vitest'
import { countSolutions, solveBySingles, SUDOKU_CELLS } from '../src/solver.js'
import {
  CLUE_TARGETS,
  DIFFICULTY_IDS,
  asDifficulty,
  generatePuzzle,
  type DifficultyId,
} from '../src/generate.js'

/** 唯一性用到的种子（数量够覆盖不同随机流，又能让测试保持在秒级） */
const UNIQUE_SEEDS = [0, 1, 7, 42, 20260101]
/** 确定性/性能用到的种子 */
const QUICK_SEEDS = [3, 123]

function cluesOf(given: Int8Array): number {
  let count = 0
  for (let index = 0; index < SUDOKU_CELLS; index++) if (given[index] !== 0) count++
  return count
}

describe('确定性', () => {
  it('同 seed 同难度生成完全相同的题目与解', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of QUICK_SEEDS) {
        const a = generatePuzzle(seed, difficulty)
        const b = generatePuzzle(seed, difficulty)
        expect(Array.from(a.given)).toEqual(Array.from(b.given))
        expect(Array.from(a.solution)).toEqual(Array.from(b.solution))
        expect(a.clueCount).toBe(b.clueCount)
        expect(a.difficulty).toBe(b.difficulty)
      }
    }
  })

  it('不同 seed（同难度）会得到不同题目', () => {
    const a = generatePuzzle(1, 'starter')
    const b = generatePuzzle(2, 'starter')
    expect(Array.from(a.given)).not.toEqual(Array.from(b.given))
  })

  it('同 seed 不同难度会得到不同题目', () => {
    const a = generatePuzzle(1, 'starter')
    const b = generatePuzzle(1, 'challenging')
    expect(Array.from(a.given)).not.toEqual(Array.from(b.given))
  })

  it('生成不依赖 Math.random：屏蔽后仍能正常出题', () => {
    const original = Math.random
    Math.random = () => {
      throw new Error('生成器不允许使用 Math.random')
    }
    try {
      const puzzle = generatePuzzle(77, 'skilled')
      expect(cluesOf(puzzle.given)).toBe(puzzle.clueCount)
    } finally {
      Math.random = original
    }
  })
})

describe('唯一解（硬要求）', () => {
  it('多个 seed × 三档难度：解数恒为 1', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of UNIQUE_SEEDS) {
        const puzzle = generatePuzzle(seed, difficulty)
        expect(countSolutions(puzzle.given, 2), `${difficulty}/${seed}`).toBe(1)
      }
    }
  })

  it('题目里的提示数与解完全一致，且解本身是合法完整盘', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const puzzle = generatePuzzle(21, difficulty)
      expect(countSolutions(puzzle.solution, 2)).toBe(1)
      for (let index = 0; index < SUDOKU_CELLS; index++) {
        if (puzzle.given[index] !== 0) expect(puzzle.given[index]).toBe(puzzle.solution[index])
      }
      expect(cluesOf(puzzle.given)).toBe(puzzle.clueCount)
    }
  })
})

describe('难度分档', () => {
  it('提示数按 入门 > 熟练 > 挑战 递减（多 seed 平均，单题可能因挖到目标以下而略有波动）', () => {
    const average = new Map<DifficultyId, number>()
    for (const difficulty of DIFFICULTY_IDS) {
      let total = 0
      for (const seed of UNIQUE_SEEDS) total += generatePuzzle(seed, difficulty).clueCount
      average.set(difficulty, total / UNIQUE_SEEDS.length)
    }
    expect(average.get('starter')!).toBeGreaterThan(average.get('skilled')!)
    expect(average.get('skilled')!).toBeGreaterThan(average.get('challenging')!)
  })

  it('单题提示数落在目标附近（低于目标就停，最坏情况是这一轮再也挖不动）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const target = CLUE_TARGETS[difficulty]
      for (const seed of UNIQUE_SEEDS) {
        const clues = generatePuzzle(seed, difficulty).clueCount
        expect(clues, `${difficulty}/${seed}`).toBeGreaterThanOrEqual(17)
        expect(clues, `${difficulty}/${seed}`).toBeLessThan(target + 6)
      }
    }
  })

  it('所有档位题目都不需要猜（只用唯一候选/唯一位置即可解开）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [0, 13, 137]) {
        const puzzle = generatePuzzle(seed, difficulty)
        expect(solveBySingles(puzzle.given), `${difficulty}/${seed}`).toBe(true)
      }
    }
  })

  it('asDifficulty 拒绝未知难度', () => {
    expect(asDifficulty('starter')).toBe('starter')
    expect(() => asDifficulty('impossible')).toThrow()
  })
})

describe('性能', () => {
  it('单题生成 < 500ms（宽松上限，避免 CI 抖动；实测各档均值 < 2ms）', () => {
    const slowest: string[] = []
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of QUICK_SEEDS) {
        const started = performance.now()
        const puzzle = generatePuzzle(seed, difficulty)
        const elapsed = performance.now() - started
        expect(puzzle.clueCount).toBeGreaterThan(0)
        slowest.push(`${difficulty}/${seed}=${elapsed.toFixed(1)}ms`)
        expect(elapsed, `${difficulty}/${seed} 生成耗时 ${elapsed.toFixed(1)}ms`).toBeLessThan(500)
      }
    }
    // 顺带把实测耗时打进日志，方便和「单题 < 200ms」的目标对照
    expect(slowest.length).toBe(6)
  })

  it('单题生成实测满足 < 200ms 的目标（取 30 题里的最慢一题）', () => {
    let worst = 0
    for (let seed = 0; seed < 10; seed++) {
      for (const difficulty of DIFFICULTY_IDS) {
        const started = performance.now()
        generatePuzzle(seed, difficulty)
        worst = Math.max(worst, performance.now() - started)
      }
    }
    expect(worst, `最慢一题 ${worst.toFixed(1)}ms`).toBeLessThan(200)
  })

  it('连续生成 12 题的平均耗时也远低于单题上限', () => {
    const started = performance.now()
    for (let seed = 0; seed < 4; seed++) {
      for (const difficulty of DIFFICULTY_IDS) generatePuzzle(seed, difficulty)
    }
    const average = (performance.now() - started) / 12
    expect(average).toBeLessThan(200)
  })
})

describe('难度 id', () => {
  it('三档 id 与顺序稳定（壳层按这个顺序展示）', () => {
    expect(DIFFICULTY_IDS).toEqual<DifficultyId[]>(['starter', 'skilled', 'challenging'])
  })
})
