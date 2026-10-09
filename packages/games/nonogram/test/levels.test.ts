/**
 * 题库与线索推导测试。覆盖验收点：
 *   1. 位图自洽：每行等长、只用 `#`/`.`、题号唯一、尺寸符合难度约定；
 *   2. 线索推导的边界：满行 / 间隔行 / 空行（写成 0）/ 单格 / 首尾空；
 *   3. 行线索与列线索互相一致（黑格总数相同），且与**手算的期望值**一致（不是自己等于自己）；
 *   4. **每道题恰好一解** —— 手写位图不唯一时，玩家严格按线索推出的"正确答案"可能过不了关；
 *   5. 题号 ← 种子（同 seed 同题、负数/小数不炸）、越界取题抛错。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  DIFFICULTY_IDS,
  PUZZLES,
  PUZZLES_BY_DIFFICULTY,
  blackTotal,
  cellCountOf,
  clueOf,
  clueText,
  colCluesOf,
  colLine,
  colsOf,
  countSolutions,
  difficultyOrThrow,
  maxClueLength,
  puzzleAt,
  puzzleById,
  puzzleIndexFor,
  puzzlesFor,
  rowCluesOf,
  rowLine,
  rowsOf,
  solutionBits,
} from '../src/index.js'

/** 手算的期望值（写死在测试里，才有资格叫"独立校验"） */
const HAND_CHECKED: ReadonlyArray<{ id: string; rows: number[][]; cols: number[][] }> = [
  {
    // 入门 1：十字 —— 正中一行与正中一列都是满的，行/列线索因此完全相同
    id: 'starter-1',
    rows: [[1], [1], [5], [1], [1]],
    cols: [[1], [1], [5], [1], [1]],
  },
  {
    // 入门 5：沙漏 —— 上下满行、中间孤点
    id: 'starter-5',
    rows: [[5], [3], [1], [3], [5]],
    cols: [
      [1, 1],
      [2, 2],
      [5],
      [2, 2],
      [1, 1],
    ],
  },
  {
    // 熟练 6：蝴蝶结 —— 中间两行/两列各是一整段，向外逐层收窄
    id: 'skilled-6',
    rows: [[10], [8], [6], [4], [2], [2], [4], [6], [8], [10]],
    cols: [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [10],
      [10],
      [4, 4],
      [3, 3],
      [2, 2],
      [1, 1],
    ],
  },
  {
    // 挑战 2：火箭 —— 左右两列全空（线索写 0），中间两列整列涂满
    id: 'challenging-2',
    rows: [[2], [4], [4], [4], [4], [6], [8], [2], [2], [4]],
    cols: [
      [],
      [1],
      [2],
      [6, 1],
      [10],
      [10],
      [6, 1],
      [2],
      [1],
      [],
    ],
  },
]

describe('线索推导的边界', () => {
  it('满行：整行涂满就是一段', () => {
    expect(clueOf([true, true, true])).toEqual([3])
    expect(clueOf([true])).toEqual([1])
  })

  it('间隔行：每个数字一段，段间至少一个空格', () => {
    expect(clueOf([true, false, true])).toEqual([1, 1])
    expect(clueOf([true, false, false, true, true])).toEqual([1, 2])
    expect(clueOf([false, true, true, false, true])).toEqual([2, 1])
  })

  it('空行：推导出来是空数组，显示成 ["0"]（空数组在界面等于"什么都没印"）', () => {
    expect(clueOf([false, false, false])).toEqual([])
    expect(clueOf([])).toEqual([])
    expect(clueText([])).toEqual(['0'])
    expect(clueText([3])).toEqual(['3'])
    expect(clueText([2, 1])).toEqual(['2', '1'])
  })

  it('首尾空格不影响段长', () => {
    expect(clueOf([false, true, true, false])).toEqual([2])
  })
})

describe('题库自洽', () => {
  it('题量在 12～20 之间，每个难度都有题、题号唯一', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(12)
    expect(PUZZLES.length).toBeLessThanOrEqual(20)
    const ids = PUZZLES.map((puzzle) => puzzle.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const difficulty of DIFFICULTY_IDS) {
      expect(puzzlesFor(difficulty).length).toBeGreaterThan(0)
      for (const puzzle of puzzlesFor(difficulty)) {
        expect(puzzle.difficulty).toBe(difficulty)
        expect(puzzleById(puzzle.id)).toBe(puzzle)
      }
    }
  })

  it('尺寸符合难度约定：入门 5×5，熟练 / 挑战 10×10', () => {
    for (const puzzle of puzzlesFor('starter')) {
      expect([colsOf(puzzle), rowsOf(puzzle)]).toEqual([5, 5])
    }
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const puzzle of puzzlesFor(difficulty)) {
        expect([colsOf(puzzle), rowsOf(puzzle)]).toEqual([10, 10])
      }
    }
  })

  it('位图只用 # 与 .，且每行等长', () => {
    for (const puzzle of PUZZLES) {
      const width = colsOf(puzzle)
      expect(width).toBeGreaterThan(0)
      for (const row of puzzle.solution) {
        expect(row).toHaveLength(width)
        expect(/^[#.]+$/.test(row)).toBe(true)
      }
    }
  })

  it('行线索与列线索的黑格总数一致，且等于位图里的黑格数', () => {
    for (const puzzle of PUZZLES) {
      const byRow = rowCluesOf(puzzle).reduce((sum, clue) => sum + clue.reduce((a, b) => a + b, 0), 0)
      const byCol = colCluesOf(puzzle).reduce((sum, clue) => sum + clue.reduce((a, b) => a + b, 0), 0)
      expect(byRow, puzzle.id).toBe(blackTotal(puzzle))
      expect(byCol, puzzle.id).toBe(blackTotal(puzzle))
      expect(solutionBits(puzzle).filter(Boolean)).toHaveLength(blackTotal(puzzle))
    }
  })

  it('线索里的数字都 ≥ 1（0 只以"整行全白"的显示形式出现）', () => {
    for (const puzzle of PUZZLES) {
      for (const clue of [...rowCluesOf(puzzle), ...colCluesOf(puzzle)]) {
        for (const value of clue) expect(value).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('线索带最多只有 5 段（10×10）/ 3 段（5×5）—— 壳层按它留线索带的厚度', () => {
    for (const puzzle of puzzlesFor('starter')) {
      expect(maxClueLength(rowCluesOf(puzzle))).toBeLessThanOrEqual(3)
      expect(maxClueLength(colCluesOf(puzzle))).toBeLessThanOrEqual(3)
    }
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const puzzle of puzzlesFor(difficulty)) {
        expect(maxClueLength(rowCluesOf(puzzle))).toBeLessThanOrEqual(5)
        expect(maxClueLength(colCluesOf(puzzle))).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('线索推导与手算期望一致', () => {
  for (const expected of HAND_CHECKED) {
    it(`${expected.id} 的行/列线索与手算一致`, () => {
      const puzzle = puzzleById(expected.id)
      expect(puzzle, expected.id).toBeDefined()
      expect(rowCluesOf(puzzle!)).toEqual(expected.rows)
      expect(colCluesOf(puzzle!)).toEqual(expected.cols)
      // 显示文本与推导结果同源（唯一区别是全白行写 0）
      expect(rowCluesOf(puzzle!).map((clue) => clueText(clue))).toEqual(
        expected.rows.map((clue) => (clue.length === 0 ? ['0'] : clue.map(String))),
      )
    })
  }

  it('rowLine / colLine 直接读位图，越界抛错', () => {
    const puzzle = puzzleById('starter-1')!
    expect(rowLine(puzzle, 2)).toEqual([true, true, true, true, true])
    expect(colLine(puzzle, 2)).toEqual([true, true, true, true, true])
    expect(colLine(puzzle, 0)).toEqual([false, false, true, false, false])
    expect(() => rowLine(puzzle, 5)).toThrow(IllegalActionError)
    expect(() => colLine(puzzle, -1)).toThrow(IllegalActionError)
  })

  it('cellCountOf = 列 × 行', () => {
    expect(cellCountOf(puzzleById('starter-1')!)).toBe(25)
    expect(cellCountOf(puzzleById('skilled-1')!)).toBe(100)
  })
})

describe('每道题恰好一解', () => {
  /*
   * 这是内容质量的门槛：唯一解不成立时，「按线索推理」与「与答案逐格比对」会分叉——
   * 玩家推出了另一张满足全部线索的图，界面却说过不了关（而且检查会说"没有一行不符"）。
   */
  for (const puzzle of PUZZLES) {
    it(`${puzzle.id} 只有一种解`, () => {
      expect(countSolutions(puzzle, 2)).toBe(1)
    })
  }

  it('答案本身就是一解（自检：求解器不是永远返回 0）', () => {
    for (const puzzle of PUZZLES) {
      expect(countSolutions(puzzle, 1)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('题号 ← 种子', () => {
  it('同一 seed 同一难度总是同一道题，且落在题库范围内', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const count = puzzlesFor(difficulty).length
      for (const seed of [0, 1, 5, 6, 17, 999, 123456]) {
        const index = puzzleIndexFor(seed, difficulty)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(count)
        expect(index).toBe(seed % count)
        expect(puzzleIndexFor(seed, difficulty)).toBe(index)
      }
    }
  })

  it('负数与小数种子不会炸（归一化后仍落在范围内）', () => {
    expect(puzzleIndexFor(-1, 'starter')).toBe(5)
    expect(puzzleIndexFor(-7, 'starter')).toBe(5)
    expect(puzzleIndexFor(2.9, 'starter')).toBe(2)
    expect(puzzleIndexFor(Number.NaN, 'starter')).toBe(0)
    expect(puzzleIndexFor(Number.POSITIVE_INFINITY, 'starter')).toBe(0)
  })

  it('题号越界 / 非整数明确抛错', () => {
    expect(() => puzzleAt('starter', 6)).toThrow(IllegalActionError)
    expect(() => puzzleAt('starter', -1)).toThrow(IllegalActionError)
    expect(() => puzzleAt('starter', 1.5)).toThrow(IllegalActionError)
    expect(puzzleAt('starter', 5).id).toBe('starter-6')
  })

  it('未知难度明确抛错', () => {
    expect(() => difficultyOrThrow('endless')).toThrow(IllegalActionError)
    expect(difficultyOrThrow('skilled')).toBe('skilled')
    expect(Object.keys(PUZZLES_BY_DIFFICULTY).sort()).toEqual([...DIFFICULTY_IDS].sort())
  })
})
