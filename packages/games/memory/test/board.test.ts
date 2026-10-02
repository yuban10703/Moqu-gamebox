/**
 * 牌堆与尺寸测试（board.ts）。
 * 覆盖：三档难度规格、洗牌确定性（同 seed 完全可复现、绝不用 Math.random）、
 * 「每张牌恰好出现两次」、符号两两可区分、种子归一化。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRng } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  SYMBOLS,
  cellCount,
  configFor,
  deal,
  glyphForPair,
  memoryGame,
  normalizeSeed,
  pairCount,
  totalCellsOf,
} from '../src/index.js'
import { pairIndices } from './helpers.js'

describe('难度与网格', () => {
  it('三档难度规格：starter 4×3、skilled 4×4、challenging 5×4，且都是对数成整的矩形', () => {
    expect(DIFFICULTIES.starter).toEqual({ cols: 4, rows: 3 })
    expect(DIFFICULTIES.skilled).toEqual({ cols: 4, rows: 4 })
    expect(DIFFICULTIES.challenging).toEqual({ cols: 5, rows: 4 })
    expect(cellCount(DIFFICULTIES.starter)).toBe(12)
    expect(cellCount(DIFFICULTIES.skilled)).toBe(16)
    expect(cellCount(DIFFICULTIES.challenging)).toBe(20)
    expect(pairCount(DIFFICULTIES.starter)).toBe(6)
    expect(pairCount(DIFFICULTIES.skilled)).toBe(8)
    expect(pairCount(DIFFICULTIES.challenging)).toBe(10)
    for (const id of DIFFICULTY_IDS) {
      expect(cellCount(configFor(id)) % 2).toBe(0)
      expect(totalCellsOf(id)).toBe(cellCount(configFor(id)))
      // 对数不超过符号数量，否则会出现两对共用同一符号
      expect(pairCount(configFor(id))).toBeLessThanOrEqual(SYMBOLS.length)
    }
  })

  it('符号两两不同，且都是纯黑白可区分的文字符号', () => {
    expect(new Set(SYMBOLS).size).toBe(SYMBOLS.length)
    for (const symbol of SYMBOLS) {
      expect(symbol.length).toBeGreaterThan(0)
      // 不允许出现颜色/灰阶相关的转义或空白符号
      expect(symbol.trim()).toBe(symbol)
    }
    expect(glyphForPair(0)).toBe('★')
    expect(glyphForPair(3)).toBe('○')
    expect(glyphForPair(99)).toBe('')
  })
})

describe('洗牌确定性', () => {
  it('同 seed + 同难度 + 同游标 → 完全相同的牌面', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [0, 1, 7, 20240607]) {
        const left = deal(seed, 0, difficulty)
        const right = deal(seed, 0, difficulty)
        expect(left).toEqual(right)
        expect(memoryGame.create(seed, difficulty).deck).toEqual(left)
      }
    }
  })

  it('不同 seed 会洗出不同牌面（至少有一组不同，绝不是恒等洗牌）', () => {
    const distinct = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(deal(seed, 0, 'skilled'))),
    )
    expect(distinct.size).toBeGreaterThan(1)
    // 随便挑两个种子，牌面顺序不应恰好相同
    expect(deal(11, 0, 'challenging')).not.toEqual(deal(12, 0, 'challenging'))
  })

  it('游标参与洗牌：同 seed 不同游标 → 不同牌面', () => {
    expect(deal(42, 0, 'skilled')).not.toEqual(deal(42, 1, 'skilled'))
    expect(deal(42, 1, 'skilled')).toEqual(deal(42, 1, 'skilled'))
  })

  it('可以复现 core 的洗牌算法（说明确实用了 createRng 而不是别的随机源）', () => {
    const expected = createRng(1234 + 0).shuffle([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
    expect(deal(1234, 0, 'starter')).toEqual(expected)
  })

  it('洗牌绝不使用 Math.random（把它换成会抛错的桩）', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used')
    })
    try {
      for (const difficulty of DIFFICULTY_IDS) {
        const state = memoryGame.create(20260101, difficulty)
        expect(state.deck).toHaveLength(totalCellsOf(difficulty))
        expect(memoryGame.decode(memoryGame.encode(state))).toEqual(state)
      }
    } finally {
      spy.mockRestore()
    }
  })
})

describe('牌面不变量', () => {
  it('每张牌恰好出现两次：每个 pairId 的计数都是 2，且没有越界 pairId', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [0, 3, 19, 555]) {
        const deck = deal(seed, 0, difficulty)
        const pairs = pairCount(configFor(difficulty))
        expect(deck).toHaveLength(cellCount(configFor(difficulty)))
        const counts = new Array<number>(pairs).fill(0)
        for (const pairId of deck) {
          expect(Number.isInteger(pairId)).toBe(true)
          expect(pairId).toBeGreaterThanOrEqual(0)
          expect(pairId).toBeLessThan(pairs)
          counts[pairId]++
        }
        expect(counts).toEqual(new Array<number>(pairs).fill(2))
        // 每个 pairId 恰好对应两个索引
        expect(pairIndices(deck).size).toBe(pairs)
      }
    }
  })

  it('同一对子的两张不会落在同一个索引上（对数成整，索引两两不同）', () => {
    const deck = deal(77, 0, 'challenging')
    for (const indices of pairIndices(deck).values()) {
      expect(indices).toHaveLength(2)
      expect(indices[0]).not.toBe(indices[1])
    }
  })
})

describe('种子归一化', () => {
  it('负数/小数/NaN 都归一化成 uint32，且不破坏可复现性', () => {
    expect(normalizeSeed(-1)).toBe(0xffffffff)
    expect(normalizeSeed(1.9)).toBe(1)
    expect(normalizeSeed(Number.NaN)).toBe(0)
    expect(normalizeSeed(2 ** 33 + 5)).toBe(5)
    expect(memoryGame.create(-1, 'starter').deck).toEqual(memoryGame.create(0xffffffff, 'starter').deck)
    expect(memoryGame.create(Number.NaN, 'starter').deck).toEqual(memoryGame.create(0, 'starter').deck)
  })
})
