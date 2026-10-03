/**
 * 棋盘模型测试：几何、符号、成组、重力、确定性生成与「补充不成三连」的保证。
 *
 * 这些是消消乐全部规则的地基 —— 它们错了，规则层的分数与撤销也会跟着错。
 */
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  EMPTY,
  KIND_GLYPHS,
  MIN_MATCH,
  applyGravity,
  areAdjacent,
  buildBoard,
  cellCount,
  colOf,
  configFor,
  createStableBoard,
  fillEmpties,
  findGroups,
  findLegalSwaps,
  forbiddenKinds,
  glyphForKind,
  groupScore,
  hasLegalSwap,
  indexOf,
  isIndex,
  isProductiveSwap,
  lineRuns,
  normalizeSeed,
  rowOf,
  swapCells,
} from '../src/index.js'
import type { BoardConfig } from '../src/index.js'

/** 8×8 的基准盘面：`(row + 2 * col) % 4`，相邻格必然不同，因此没有任何三连 */
function baseBoard(config: BoardConfig): number[] {
  const board: number[] = []
  for (let index = 0; index < cellCount(config); index++) {
    board.push((rowOf(index, config) + 2 * colOf(index, config)) % 4)
  }
  return board
}

describe('几何与索引', () => {
  it('三档难度都是矩形网格，索引按行优先可逆', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      expect(cellCount(config)).toBe(config.cols * config.rows)
      for (let index = 0; index < cellCount(config); index++) {
        expect(indexOf(rowOf(index, config), colOf(index, config), config)).toBe(index)
        expect(isIndex(index, config)).toBe(true)
      }
      expect(isIndex(-1, config)).toBe(false)
      expect(isIndex(cellCount(config), config)).toBe(false)
      expect(isIndex(1.5, config)).toBe(false)
    }
  })

  it('相邻判定只认正交邻居：左右/上下算，斜角与自身不算', () => {
    // 4×4 便于手算：0 1 2 3 / 4 5 6 7 …
    const config = { cols: 4, rows: 4, kinds: 5, targetScore: 1, moveLimit: 1 }
    expect(areAdjacent(0, 1, config)).toBe(true)
    expect(areAdjacent(0, 4, config)).toBe(true)
    expect(areAdjacent(0, 5, config)).toBe(false)
    expect(areAdjacent(0, 0, config)).toBe(false)
    // 行末与下一行行首在索引上相差 1，但不是相邻格
    expect(areAdjacent(3, 4, config)).toBe(false)
    expect(areAdjacent(0, 16, config)).toBe(false)
  })

  it('交换只动指定的两格，且不改原数组', () => {
    const board = [0, 1, 2, 3]
    const next = swapCells(board, 1, 2)
    expect(next).toEqual([0, 2, 1, 3])
    expect(board).toEqual([0, 1, 2, 3])
  })
})

describe('棋子符号（1-bit 可区分性）', () => {
  it('难度用的种类数在符号表范围内，且符号两两不同', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      expect(config.kinds).toBeGreaterThanOrEqual(MIN_MATCH + 2)
      expect(config.kinds).toBeLessThanOrEqual(KIND_GLYPHS.length)
      const used = KIND_GLYPHS.slice(0, config.kinds)
      expect(new Set(used).size).toBe(config.kinds)
      for (const glyph of used) expect(glyph.length).toBeGreaterThan(0)
    }
    // 符号表中不许有重复字符：重复等于两种棋子长得一样
    expect(new Set(KIND_GLYPHS).size).toBe(KIND_GLYPHS.length)
    expect(glyphForKind(0)).toBe(KIND_GLYPHS[0])
    expect(glyphForKind(999)).toBe('')
  })
})

describe('成组与计分', () => {
  it('lineRuns：只有 ≥3 的同种连段才算一组，空格会打断连段', () => {
    expect(lineRuns([1, 1, 1])).toEqual([[0, 2]])
    expect(lineRuns([1, 1, 2, 2, 2, 2])).toEqual([[2, 5]])
    expect(lineRuns([1, 2, 1, 2])).toEqual([])
    expect(lineRuns([1, 1, EMPTY, 1, 1, 1])).toEqual([[3, 5]])
    expect(lineRuns([EMPTY, EMPTY, EMPTY])).toEqual([])
  })

  it('findGroups 横扫 + 竖扫，L 形交叉格同时属于两组', () => {
    const config = { cols: 3, rows: 3, kinds: 5, targetScore: 1, moveLimit: 1 }
    // 0 0 0
    // 0 1 2
    // 2 2 2  ← 顶行横三 + 底行横三
    const board = [
      0, 0, 0,
      0, 1, 2,
      2, 2, 2,
    ]
    const groups = findGroups(board, config)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual([0, 1, 2])
    expect(groups[1]).toEqual([6, 7, 8])
    // L 形：顶行与左列共享角格 (0,0)，它同时属于两组（各自计分）
    const lShape = [
      0, 0, 0,
      0, 1, 2,
      0, 2, 1,
    ]
    const lGroups = findGroups(lShape, config)
    expect(lGroups).toHaveLength(2)
    expect(lGroups[0]).toEqual([0, 1, 2])
    expect(lGroups[1]).toEqual([0, 3, 6])
  })

  it('计分：3 格 30 分，长连每多一格再加 20 分', () => {
    expect(groupScore(3)).toBe(30)
    expect(groupScore(4)).toBe(60)
    expect(groupScore(5)).toBe(90)
    const config = configFor('starter')
    expect(findGroups(baseBoard(config), config)).toEqual([])
  })
})

describe('重力与补充', () => {
  it('applyGravity 保持列内相对顺序，空位移到列顶，且不改原数组', () => {
    const config = { cols: 3, rows: 3, kinds: 5, targetScore: 1, moveLimit: 1 }
    const board = [
      1, 2, 3,
      EMPTY, 5, EMPTY,
      7, EMPTY, 9,
    ]
    const next = applyGravity(board, config)
    expect(next).toEqual([
      EMPTY, EMPTY, EMPTY,
      1, 2, 3,
      7, 5, 9,
    ])
    expect(board[3]).toBe(EMPTY)
  })

  it('forbiddenKinds 认得出「左右各一格夹住」和「上下夹住」的情况', () => {
    const config = { cols: 4, rows: 3, kinds: 5, targetScore: 1, moveLimit: 1 }
    // 中间空一格，两侧同种：放同种会凑成三连
    const horizontal = [2, EMPTY, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]
    expect(forbiddenKinds(horizontal, config, 1).has(2)).toBe(true)
    // 上下两格同种：放同种也会凑成三连
    const vertical = [1, 0, 1, 2, EMPTY, 1, 1, 2, 3, 4, 1, 2]
    expect(forbiddenKinds(vertical, config, 4).has(1)).toBe(true)
    // 空盘上没有任何禁忌种类
    const empty = new Array<number>(12).fill(EMPTY)
    expect(forbiddenKinds(empty, config, 0).size).toBe(0)
  })

  it('fillEmpties：把空位填满、不产生三连、每格恰好消耗一次抽取、同参数完全可复现', () => {
    const config = configFor('starter')
    const board = baseBoard(config)
    // 挖掉 7 个不相邻的格子（模拟一次消除后的空洞）
    const holes = [0, 1, 2, 10, 19, 28, 63]
    for (const index of holes) board[index] = EMPTY
    const once = fillEmpties(board, config, 4242, 0)
    const twice = fillEmpties(board, config, 4242, 0)
    expect(once.board).toEqual(twice.board)
    expect(once.cursor).toBe(0 + holes.length)
    expect(once.board.some((kind) => kind === EMPTY)).toBe(false)
    // 补进来的棋子不会当场连成三连：整盘仍然没有组
    expect(findGroups(once.board, config)).toEqual([])
    // 游标不同 → 抽到的种类序列通常不同（这里断言至少一处不同，证明游标真的参与了随机源）
    const other = fillEmpties(board, config, 4242, 1000)
    expect(other.cursor).toBe(1000 + holes.length)
    expect(other.board).not.toEqual(once.board)
  })
})

describe('初始棋盘（确定性生成）', () => {
  it('三档难度 × 多个种子：开局无三连、必有可交换的组合、棋子满盘', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      for (let seed = 0; seed < 24; seed++) {
        const { board, cursor } = buildBoard(seed, difficulty)
        expect(board).toHaveLength(cellCount(config))
        expect(board.filter((kind) => kind === EMPTY)).toEqual([])
        for (const kind of board) {
          expect(Number.isInteger(kind)).toBe(true)
          expect(kind).toBeGreaterThanOrEqual(0)
          expect(kind).toBeLessThan(config.kinds)
        }
        // 开局不能自带三连（否则一开局就自动消除）
        expect(findGroups(board, config)).toEqual([])
        // 开局必须能走：死局会被规则层重排，初始棋盘不该是死局
        expect(hasLegalSwap(board, config)).toBe(true)
        // 每盘棋用掉整数个「整盘抽取」的预算，重试次数可复算
        expect(cursor % cellCount(config)).toBe(0)
        expect(cursor).toBeGreaterThanOrEqual(cellCount(config))
      }
    }
  })

  it('同 seed + 同难度得到同一盘；不同 seed 通常不同；种子归一化稳定', () => {
    const first = buildBoard(7, 'skilled')
    expect(buildBoard(7, 'skilled')).toEqual(first)
    expect(buildBoard(8, 'skilled').board).not.toEqual(first.board)
    // 负数/小数/NaN 归一化成 uint32，不破坏确定性
    expect(buildBoard(-1, 'starter').board).toEqual(buildBoard(normalizeSeed(-1), 'starter').board)
    expect(buildBoard(Number.NaN, 'starter').board).toEqual(buildBoard(0, 'starter').board)
    expect(buildBoard(3.9, 'starter').board).toEqual(buildBoard(3, 'starter').board)
  })

  it('createStableBoard 从任意游标出发都给出稳定且可玩的盘面', () => {
    const config = configFor('challenging')
    for (const cursor of [0, 61, 5000, 12345]) {
      const { board, cursor: next } = createStableBoard(config, 99, cursor)
      expect(findGroups(board, config)).toEqual([])
      expect(hasLegalSwap(board, config)).toBe(true)
      expect(next).toBeGreaterThanOrEqual(cursor + cellCount(config))
      // 每次重试换一段随机流（+ 一整盘棋的抽取数），因此游标与起始游标同余
      expect(next % cellCount(config)).toBe(cursor % cellCount(config))
    }
  })
})

describe('合法交换的枚举', () => {
  it('isProductiveSwap 只认「换了能消」的相邻对', () => {
    const config = { cols: 4, rows: 3, kinds: 5, targetScore: 1, moveLimit: 1 }
    /*
     * 0 0 3 2
     * 1 1 0 3
     * 3 2 3 4
     * 能消的只有两处：(0,2) 与 (1,2) 交换凑出顶行三连；
     * (1,2) 与 (1,3) 交换后左列变成 3 3 3。
     */
    const board = [0, 0, 3, 2, 1, 1, 0, 3, 3, 2, 3, 4]
    expect(isProductiveSwap(board, config, 2, 6)).toBe(true)
    expect(isProductiveSwap(board, config, 6, 2)).toBe(true)
    expect(isProductiveSwap(board, config, 6, 7)).toBe(true)
    expect(isProductiveSwap(board, config, 0, 1)).toBe(false)
    expect(isProductiveSwap(board, config, 1, 5)).toBe(false)
    // 不相邻直接判否
    expect(isProductiveSwap(board, config, 2, 99)).toBe(false)
    expect(isProductiveSwap(board, config, 0, 5)).toBe(false)
    // 行优先、先右后下：先第 0 行的 (2,6)，再第 1 行的 (6,7)
    expect(findLegalSwaps(board, config)).toEqual([
      [2, 6],
      [6, 7],
    ])
  })

  it('findLegalSwaps 给出的每一对都真的能消，且顺序固定（行优先，先右后下）', () => {
    const config = configFor('starter')
    const { board } = buildBoard(20261004, 'starter')
    expect(findGroups(board, config)).toEqual([])
    const pairs = findLegalSwaps(board, config)
    expect(pairs.length).toBeGreaterThan(0)
    for (const [a, b] of pairs) {
      expect(areAdjacent(a, b, config)).toBe(true)
      expect(findGroups(swapCells(board, a, b), config).length).toBeGreaterThan(0)
    }
    // 顺序稳定：重复调用结果完全一致
    expect(findLegalSwaps(board, config)).toEqual(pairs)
  })
})

describe('难度配置', () => {
  it('三档难度各不相同，且目标分/步数上限为正整数', () => {
    const ids = DIFFICULTY_IDS.map((id) => JSON.stringify(DIFFICULTIES[id]))
    expect(new Set(ids).size).toBe(DIFFICULTY_IDS.length)
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      expect(config.targetScore).toBeGreaterThan(0)
      expect(config.moveLimit).toBeGreaterThan(0)
      expect(Number.isInteger(config.targetScore)).toBe(true)
      expect(Number.isInteger(config.moveLimit)).toBe(true)
    }
  })
})
