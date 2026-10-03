/**
 * 棋盘模型测试：33 孔布局、三档起始布局、跳吃合法性与边界。
 */
import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  CENTER,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  HOLE_INDEXES,
  applyJump,
  colOf,
  configFor,
  countPegs,
  indexOf,
  initialPegs,
  isHole,
  isLegalJump,
  jumpTargets,
  jumpedIndex,
  legalJumps,
  pegsolitaireGame,
  rowOf,
} from '../src/index.js'
import { SOLVER_HOLES, boardWith } from './helpers.js'

describe('33 孔棋盘', () => {
  it('7×7 去掉四个 2×2 角块，恰好 33 个孔位', () => {
    expect(BOARD_SIZE).toBe(7)
    expect(HOLE_INDEXES).toHaveLength(33)
    // 独立算出的孔位与 src 一致
    expect([...HOLE_INDEXES]).toEqual([...SOLVER_HOLES])
  })

  it('第 0/1/5/6 行只有 3 个孔（第 2~4 列），第 2~4 行有 7 个', () => {
    for (const row of [0, 1, 5, 6]) {
      let count = 0
      for (let col = 0; col < BOARD_SIZE; col++) if (isHole(indexOf(row, col))) count += 1
      expect(count, `row ${row}`).toBe(3)
    }
    for (const row of [2, 3, 4]) {
      let count = 0
      for (let col = 0; col < BOARD_SIZE; col++) if (isHole(indexOf(row, col))) count += 1
      expect(count, `row ${row}`).toBe(7)
    }
  })

  it('四个角块不是孔位，边上与中心是孔位', () => {
    for (const [row, col] of [
      [0, 0],
      [1, 1],
      [0, 6],
      [6, 0],
      [5, 5],
      [6, 6],
      [1, 5],
      [5, 1],
    ] as const) {
      expect(isHole(indexOf(row, col)), `${row},${col}`).toBe(false)
    }
    for (const [row, col] of [
      [0, 2],
      [0, 4],
      [2, 0],
      [3, 3],
      [6, 4],
      [6, 2],
      [4, 6],
    ] as const) {
      expect(isHole(indexOf(row, col)), `${row},${col}`).toBe(true)
    }
    expect(CENTER).toBe(indexOf(3, 3))
    for (const index of [-1, 49, 1.5, Number.NaN]) expect(isHole(index), String(index)).toBe(false)
  })

  it('rowOf / colOf / indexOf 互为逆运算', () => {
    for (const index of HOLE_INDEXES) {
      expect(indexOf(rowOf(index), colOf(index))).toBe(index)
    }
  })
})

describe('三档起始布局', () => {
  it('starter 只有中心空；skilled 中心与其正上方空；challenging 是非对称起始', () => {
    expect(DIFFICULTIES.starter.emptyHoles).toEqual([CENTER])
    expect(DIFFICULTIES.skilled.emptyHoles).toEqual([CENTER, indexOf(2, 3)])
    expect(DIFFICULTIES.challenging.emptyHoles).toEqual([CENTER, indexOf(6, 4)])
    // 空孔都在孔位上
    for (const difficulty of DIFFICULTY_IDS) {
      for (const index of configFor(difficulty).emptyHoles) {
        expect(isHole(index), `${difficulty} ${index}`).toBe(true)
      }
    }
  })

  it('起始布局：非空孔全部有棋子，非孔位永远没有棋子', () => {
    expect(countPegs(initialPegs('starter'))).toBe(32)
    expect(countPegs(initialPegs('skilled'))).toBe(31)
    expect(countPegs(initialPegs('challenging'))).toBe(31)
    for (const difficulty of DIFFICULTY_IDS) {
      const pegs = initialPegs(difficulty)
      const empty = new Set(configFor(difficulty).emptyHoles)
      for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index++) {
        if (!isHole(index)) expect(pegs[index], `${difficulty} ${index}`).toBe(false)
        else expect(pegs[index], `${difficulty} ${index}`).toBe(!empty.has(index))
      }
    }
  })

  it('challenging 的起始在棋盘的 8 个对称变换下都会变样（真正非对称）', () => {
    const center = DIFFICULTIES.challenging.emptyHoles[0]!
    const extra = DIFFICULTIES.challenging.emptyHoles[1]!
    expect(center).toBe(CENTER)
    const row = rowOf(extra)
    const col = colOf(extra)
    // 只要额外空孔不在中行/中列/两条对角线上，就没有任何非平凡对称能固定它
    expect(row).not.toBe(3)
    expect(col).not.toBe(3)
    expect(row).not.toBe(col)
    expect(row + col).not.toBe(6)
  })

  it('起始布局与 seed 无关（本玩法没有随机性）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(pegsolitaireGame.create(1, difficulty)).toEqual(
        pegsolitaireGame.create(987654321, difficulty),
      )
    }
    expect(pegsolitaireGame.create(0, 'starter').pegs).toEqual(initialPegs('starter'))
  })
})

describe('跳吃合法性', () => {
  it('正交隔一子落空孔才合法： jumpedIndex 指出被跳过的格子', () => {
    const pegs = boardWith([indexOf(2, 2), indexOf(2, 3)])
    expect(jumpedIndex(indexOf(2, 2), indexOf(2, 4))).toBe(indexOf(2, 3))
    expect(isLegalJump(pegs, indexOf(2, 2), indexOf(2, 4))).toBe(true)
    // 竖直方向同理
    const vertical = boardWith([indexOf(2, 2), indexOf(3, 2)])
    expect(jumpedIndex(indexOf(2, 2), indexOf(4, 2))).toBe(indexOf(3, 2))
    expect(isLegalJump(vertical, indexOf(2, 2), indexOf(4, 2))).toBe(true)
  })

  it('斜跳 / 隔一格（不是隔两格）/ 越界都不合法', () => {
    const pegs = boardWith([indexOf(3, 3), indexOf(4, 4), indexOf(3, 4)])
    expect(jumpedIndex(indexOf(3, 3), indexOf(4, 4))).toBeNull() // 斜线
    expect(isLegalJump(pegs, indexOf(3, 3), indexOf(4, 4))).toBe(false)
    expect(jumpedIndex(indexOf(3, 3), indexOf(3, 4))).toBeNull() // 只隔一格
    expect(isLegalJump(pegs, indexOf(3, 3), indexOf(3, 4))).toBe(false)
    expect(jumpedIndex(indexOf(0, 2), -12)).toBeNull() // 走出棋盘
    expect(jumpedIndex(49, indexOf(3, 3))).toBeNull()
    expect(jumpedIndex(indexOf(0, 0), indexOf(0, 2))).toBeNull() // 起点不是孔位
  })

  it('中间没有棋子 / 落点有棋子 / 起点没有棋子都不合法', () => {
    // 中间是空孔
    const overEmpty = boardWith([indexOf(2, 2), indexOf(2, 4)])
    expect(isLegalJump(overEmpty, indexOf(2, 2), indexOf(2, 4))).toBe(false)
    // 落点有棋子
    const occupied = boardWith([indexOf(2, 2), indexOf(2, 3), indexOf(2, 4)])
    expect(isLegalJump(occupied, indexOf(2, 2), indexOf(2, 4))).toBe(false)
    // 起点没有棋子
    const noPeg = boardWith([indexOf(2, 3)])
    expect(isLegalJump(noPeg, indexOf(2, 2), indexOf(2, 4))).toBe(false)
  })

  it('applyJump 拿掉起点与被跳过的棋子，落点放上棋子（不改原数组）', () => {
    const pegs = boardWith([indexOf(2, 2), indexOf(2, 3)])
    const next = applyJump(pegs, indexOf(2, 2), indexOf(2, 4))
    expect(next[indexOf(2, 2)]).toBe(false)
    expect(next[indexOf(2, 3)]).toBe(false)
    expect(next[indexOf(2, 4)]).toBe(true)
    expect(countPegs(next)).toBe(1)
    // 原数组不变
    expect(countPegs(pegs)).toBe(2)
    expect(pegs[indexOf(2, 2)]).toBe(true)
  })

  it('jumpTargets / legalJumps 只列出真正可行的跳吃', () => {
    const pegs = boardWith([indexOf(2, 2), indexOf(2, 3), indexOf(3, 3)])
    // (2,2) 可以跳过 (2,3) 落到 (2,4)
    expect(jumpTargets(pegs, indexOf(2, 2))).toEqual([indexOf(2, 4)])
    const jumps = legalJumps(pegs)
    expect(jumps).toContainEqual({
      from: indexOf(2, 2),
      to: indexOf(2, 4),
      jumped: indexOf(2, 3),
    })
    // (2,3) 竖直方向可以跳过 (3,3) 落到 (4,3)
    expect(jumps).toContainEqual({
      from: indexOf(2, 3),
      to: indexOf(4, 3),
      jumped: indexOf(3, 3),
    })
    // 空孔没有可跳目标
    expect(jumpTargets(pegs, indexOf(0, 2))).toEqual([])
  })
})
