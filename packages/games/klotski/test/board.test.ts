/**
 * 棋盘模型与关卡包测试：几何、开局合法性、滑动判定、关卡顺序与最优步数常量。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  CAO_GOAL,
  CAO_ID,
  CELLS,
  COLS,
  DIFFICULTY_IDS,
  EXIT_CELLS,
  PACK,
  ROWS,
  cellsOf,
  firstLevelId,
  initialPositions,
  insideBoard,
  isLastLevel,
  isSolved,
  levelById,
  levelOrThrow,
  levelsFor,
  nextLevelId,
  occupancy,
  packProgress,
  replaySlides,
  slidePositions,
  targetStart,
  indexOf,
  colOf,
  rowOf,
} from '../src/index.js'

describe('几何', () => {
  it('4×5 共 20 格，索引与行列互逆', () => {
    expect(COLS).toBe(4)
    expect(ROWS).toBe(5)
    expect(CELLS).toBe(20)
    for (let index = 0; index < CELLS; index++) {
      expect(indexOf(rowOf(index), colOf(index))).toBe(index)
    }
    expect(EXIT_CELLS).toEqual([indexOf(4, 1), indexOf(4, 2)])
    expect(CAO_GOAL).toBe(indexOf(3, 1))
  })

  it('cellsOf 按矩形展开；insideBoard 正确判断越界', () => {
    expect(cellsOf(indexOf(0, 1), 2, 2)).toEqual([
      indexOf(0, 1),
      indexOf(0, 2),
      indexOf(1, 1),
      indexOf(1, 2),
    ])
    expect(insideBoard(indexOf(4, 0), 1, 1)).toBe(true)
    // 1×2 放到最后一行会冲出下边界
    expect(insideBoard(indexOf(4, 0), 1, 2)).toBe(false)
    // 2×2 放到最后一列会冲出右边界
    expect(insideBoard(indexOf(3, 3), 2, 2)).toBe(false)
    expect(insideBoard(indexOf(0, 0), 2, 2)).toBe(true)
    expect(insideBoard(-1, 1, 1)).toBe(false)
    expect(insideBoard(20, 1, 1)).toBe(false)
    expect(targetStart(indexOf(0, 1), 2, 2, 'up')).toBeNull()
    expect(targetStart(indexOf(0, 1), 2, 2, 'down')).toBe(indexOf(1, 1))
    expect(targetStart(indexOf(0, 0), 1, 1, 'left')).toBeNull()
    expect(targetStart(indexOf(3, 3), 2, 1, 'right')).toBeNull()
  })
})

describe('关卡包', () => {
  it('四个关卡，id 顺序固定，三档难度都能找到起始关卡', () => {
    expect(PACK).toHaveLength(4)
    expect(PACK.map((level) => level.def.id)).toEqual(['level-1', 'level-2', 'level-3', 'level-4'])
    expect(PACK.map((level) => level.index)).toEqual([1, 2, 3, 4])
    for (const level of PACK) {
      expect(DIFFICULTY_IDS).toContain(level.def.difficulty)
      expect(level.def.optimalMoves).toBeGreaterThan(0)
    }
    expect(levelsFor('starter').map((level) => level.def.id)).toEqual(['level-2'])
    expect(levelsFor('skilled').map((level) => level.def.id)).toEqual(['level-1', 'level-3'])
    expect(levelsFor('challenging').map((level) => level.def.id)).toEqual(['level-4'])
    for (const difficulty of DIFFICULTY_IDS) {
      expect(levelById(firstLevelId(difficulty))).toBeDefined()
    }
  })

  it('下一关按整包顺序推进，最后一关没有下一关', () => {
    expect(nextLevelId('level-1')).toBe('level-2')
    expect(nextLevelId('level-2')).toBe('level-3')
    expect(nextLevelId('level-3')).toBe('level-4')
    expect(nextLevelId('level-4')).toBeNull()
    expect(nextLevelId('nope')).toBeNull()
    expect(isLastLevel('level-4')).toBe(true)
    expect(isLastLevel('level-1')).toBe(false)
  })

  it('进度按整包统计', () => {
    expect(packProgress([])).toEqual({ done: 0, total: 4 })
    expect(packProgress(['level-1', 'level-3'])).toEqual({ done: 2, total: 4 })
    expect(packProgress(['level-1', 'level-1'])).toEqual({ done: 1, total: 4 })
  })

  it('未知关卡抛 IllegalActionError', () => {
    expect(() => levelOrThrow('level-9')).toThrow(IllegalActionError)
  })
})

describe('开局合法性', () => {
  it('每关都是 1 个 2×2 + 4 个 1×2 + 1 个 2×1 + 4 个 1×1，共 18 格、2 个空格', () => {
    for (const level of PACK) {
      const pieces = level.def.pieces
      expect(pieces, level.def.id).toHaveLength(10)
      const shapes = pieces.reduce<Record<string, number>>((acc, piece) => {
        const key = `${piece.width}x${piece.height}`
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {})
      expect(shapes, level.def.id).toEqual({ '2x2': 1, '1x2': 4, '2x1': 1, '1x1': 4 })
      // 曹操且在顶部正中、不在终点
      const cao = pieces.find((piece) => piece.id === CAO_ID)!
      expect(cao.width).toBe(2)
      expect(cao.height).toBe(2)
      expect(cao.start).toBe(indexOf(0, 1))
    }
  })

  it('所有块都在盘内、互不重叠，且恰好留下两个空格', () => {
    for (const level of PACK) {
      const positions = initialPositions(level.def)
      const grid = occupancy(level.def, positions)
      expect(grid.filter((cell) => cell === null), level.def.id).toHaveLength(2)
      expect(grid.filter((cell) => cell !== null)).toHaveLength(18)
      for (const piece of level.def.pieces) {
        const start = positions[piece.id]!
        expect(insideBoard(start, piece.width, piece.height), `${level.def.id}:${piece.id}`).toBe(true)
      }
      expect(isSolved(positions), level.def.id).toBe(false)
    }
  })

  it('每个块 id 唯一、字形非空（视图靠字形表达形状）', () => {
    for (const level of PACK) {
      const ids = level.def.pieces.map((piece) => piece.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const piece of level.def.pieces) expect(piece.glyph.length).toBeGreaterThan(0)
    }
  })
})

describe('滑动判定', () => {
  it('目标格全空才合法；撞块或越界返回 null', () => {
    const level = levelOrThrow('level-1').def
    const positions = initialPositions(level)
    // 曹操往下被关羽挡住
    expect(slidePositions(level, positions, CAO_ID, 'down')).toBeNull()
    // 曹操往左被张飞挡住
    expect(slidePositions(level, positions, CAO_ID, 'left')).toBeNull()
    // 曹操往上/往右越界
    expect(slidePositions(level, positions, CAO_ID, 'up')).toBeNull()
    expect(slidePositions(level, positions, CAO_ID, 'right')).toBeNull()
    // 底行左边的卒可以向右滑（(4,1) 是空格）
    const moved = slidePositions(level, positions, 'pawn-3', 'right')
    expect(moved).not.toBeNull()
    expect(moved!['pawn-3']).toBe(indexOf(4, 1))
    // 原地位置表没有被改写
    expect(positions['pawn-3']).toBe(indexOf(4, 0))
    // 未知块返回 null
    expect(slidePositions(level, positions, 'nope', 'up')).toBeNull()
  })

  it('isSolved 只认曹操左上角到 (3,1)', () => {
    const level = levelOrThrow('level-1').def
    const positions = initialPositions(level)
    expect(isSolved(positions)).toBe(false)
    expect(isSolved({ ...positions, [CAO_ID]: CAO_GOAL })).toBe(true)
    expect(isSolved({ ...positions, [CAO_ID]: CAO_GOAL - 1 })).toBe(false)
  })

  it('replaySlides 从初始摆法重放；非法日志抛 IllegalActionError', () => {
    const level = levelOrThrow('level-1').def
    expect(replaySlides(level, [])).toEqual(initialPositions(level))
    const one = replaySlides(level, [{ id: 'pawn-3', dir: 'right' }])
    expect(one['pawn-3']).toBe(indexOf(4, 1))
    expect(() => replaySlides(level, [{ id: CAO_ID, dir: 'up' }])).toThrow(IllegalActionError)
    expect(() =>
      replaySlides(level, [
        { id: 'pawn-3', dir: 'right' },
        { id: 'pawn-4', dir: 'right' },
      ]),
    ).toThrow(IllegalActionError)
  })
})
