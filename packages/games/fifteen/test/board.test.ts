/**
 * 棋盘模型与「打乱必须可解」的测试。
 *
 * 可解性用**独立于实现**的逆序数奇偶性判据在这里重新实现一遍（`solvableByParity`），
 * 再拿它去检查 `scrambleBoard` 的产物 —— 不让「构造方式」自己证明自己。
 */
import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DIRECTIONS,
  canSlide,
  colOf,
  createSolvedBoard,
  indexOf,
  inversions,
  isSolvable,
  isSolved,
  placedCount,
  rowOf,
  scrambleBoard,
  slide,
  slideTile,
  targetOf,
} from '../src/index.js'

/** 独立实现的逆序数（忽略空白格） */
function parityInversions(board: readonly number[]): number {
  const tiles: number[] = []
  for (const value of board) if (value !== 0) tiles.push(value)
  let count = 0
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[i]! > tiles[j]!) count += 1
    }
  }
  return count
}

/** 独立实现的可解性判据：奇数宽度看逆序数；偶数宽度加上「空白行从下往上数」 */
function solvableByParity(board: readonly number[], size: number): boolean {
  const parity = parityInversions(board)
  if (size % 2 === 1) return parity % 2 === 0
  const blank = board.indexOf(0)
  const blankRowFromBottom = size - Math.floor(blank / size)
  return (parity + blankRowFromBottom) % 2 === 1
}

describe('坐标与已还原局面', () => {
  it('rowOf / colOf / indexOf 行优先且互为逆运算', () => {
    for (const size of [3, 4, 5]) {
      for (let index = 0; index < size * size; index++) {
        expect(indexOf(rowOf(index, size), colOf(index, size), size)).toBe(index)
      }
      expect(indexOf(0, 0, size)).toBe(0)
      expect(indexOf(size - 1, size - 1, size)).toBe(size * size - 1)
    }
  })

  it('已还原局面是 1..N−1 加末尾空白，且 isSolved 只认这一种', () => {
    for (const size of [3, 4, 5]) {
      const solved = createSolvedBoard(size)
      expect(solved).toHaveLength(size * size)
      expect(solved[solved.length - 1]).toBe(0)
      expect(isSolved(solved, size)).toBe(true)
      // 空白跑到别处不算还原
      const moved = solved.slice()
      moved[moved.length - 1] = moved[0]!
      moved[0] = 0
      expect(isSolved(moved, size)).toBe(false)
    }
  })

  it('placedCount 只数归位的数字块，空白格不计入', () => {
    expect(placedCount([1, 2, 3, 4, 5, 6, 7, 8, 0], 3)).toBe(8)
    expect(placedCount([2, 1, 3, 4, 5, 6, 7, 8, 0], 3)).toBe(6)
    // 数字块跑到最后一格（本该是空白的位置）不算归位
    expect(placedCount([1, 2, 3, 4, 5, 6, 7, 0, 8], 3)).toBe(7)
  })
})

describe('逆序数与可解性判据', () => {
  it('逆序数：已还原为 0，交换相邻两块为 1', () => {
    expect(inversions(createSolvedBoard(3))).toBe(0)
    expect(inversions([1, 2, 3, 4, 5, 6, 8, 7, 0])).toBe(1)
    // 空白格被忽略：逆序数只看数字块
    expect(inversions([0, 2, 1, 3, 4, 5, 6, 7, 8])).toBe(1)
  })

  it('3×3：逆序数为偶才可解（经典无解盘为奇）', () => {
    expect(isSolvable(createSolvedBoard(3), 3)).toBe(true)
    expect(isSolvable([1, 2, 3, 4, 5, 6, 8, 7, 0], 3)).toBe(false)
    // 空白位置不影响奇数宽度的判据
    expect(isSolvable([1, 2, 3, 4, 5, 6, 8, 7, 0], 3)).toBe(
      solvableByParity([1, 2, 3, 4, 5, 6, 8, 7, 0], 3),
    )
  })

  it('4×4（偶数宽度）：判据与独立实现逐盘一致', () => {
    const size = 4
    const solved = createSolvedBoard(size)
    expect(isSolvable(solved, size)).toBe(true)
    expect(solvableByParity(solved, size)).toBe(true)
    // 交换两块会把奇偶性翻转成无解
    const swapped = solved.slice()
    swapped[0] = 2
    swapped[1] = 1
    expect(isSolvable(swapped, size)).toBe(false)
    expect(solvableByParity(swapped, size)).toBe(false)
    // 空白格所在行也参与偶数宽度的判据
    const blankMoved = solved.slice()
    blankMoved[15] = blankMoved[11]!
    blankMoved[11] = 0
    expect(isSolvable(blankMoved, size)).toBe(solvableByParity(blankMoved, size))
  })

  it('实现与独立判据在多组随机排列上完全一致（避免判据写反）', () => {
    // 用固定序列手工构造若干排列，覆盖两种奇偶性
    for (const size of [3, 4, 5]) {
      const solved = createSolvedBoard(size)
      const variants: number[][] = [solved]
      for (let k = 1; k <= 8; k++) {
        const board = solved.slice()
        // 循环左移 k 位：产生不同的逆序数奇偶
        const head = board.splice(0, k)
        board.push(...head)
        variants.push(board)
      }
      for (const board of variants) {
        expect(isSolvable(board, size), `${size}: ${board.join(',')}`).toBe(
          solvableByParity(board, size),
        )
      }
    }
  })
})

describe('滑动与点格', () => {
  it('targetOf / canSlide：空白格贴边时对应方向走不通', () => {
    const size = 3
    // 空白在左上角：上、左都出界
    expect(targetOf(0, 'up', size)).toBeNull()
    expect(targetOf(0, 'left', size)).toBeNull()
    expect(targetOf(0, 'down', size)).toBe(3)
    expect(targetOf(0, 'right', size)).toBe(1)
    // 空白在右下角
    expect(targetOf(8, 'down', size)).toBeNull()
    expect(targetOf(8, 'right', size)).toBeNull()
    expect(targetOf(8, 'up', size)).toBe(5)
    expect(targetOf(8, 'left', size)).toBe(7)

    const board = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    for (const dir of DIRECTIONS) {
      expect(canSlide(board, size, dir)).toBe(targetOf(0, dir, size) !== null)
    }
  })

  it('slide 交换空白与目标格；走不通返回 null（不改原棋盘）', () => {
    const board = [1, 2, 3, 4, 0, 5, 6, 7, 8]
    const up = slide(board, 3, 'up')
    expect(up).toEqual([1, 0, 3, 4, 2, 5, 6, 7, 8])
    expect(slide(board, 3, 'left')).toEqual([1, 2, 3, 0, 4, 5, 6, 7, 8])
    expect(slide(board, 3, 'right')).toEqual([1, 2, 3, 4, 5, 0, 6, 7, 8])
    expect(slide(board, 3, 'down')).toEqual([1, 2, 3, 4, 7, 5, 6, 0, 8])
    // 原棋盘不被原地改写
    expect(board).toEqual([1, 2, 3, 4, 0, 5, 6, 7, 8])

    const corner = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    expect(slide(corner, 3, 'up')).toBeNull()
    expect(slide(corner, 3, 'left')).toBeNull()
  })

  it('slideTile 只接受与空白正交相邻的数字块', () => {
    const board = [1, 2, 3, 4, 0, 5, 6, 7, 8]
    expect(slideTile(board, 3, 1)).toEqual([1, 0, 3, 4, 2, 5, 6, 7, 8])
    expect(slideTile(board, 3, 3)).toEqual([1, 2, 3, 0, 4, 5, 6, 7, 8])
    expect(slideTile(board, 3, 5)).toEqual([1, 2, 3, 4, 5, 0, 6, 7, 8])
    expect(slideTile(board, 3, 7)).toEqual([1, 2, 3, 4, 7, 5, 6, 0, 8])
    // 对角、隔行、越界、空白格自身都不可滑
    for (const index of [0, 2, 4, 6, 8, -1, 9, 1.5]) {
      expect(slideTile(board, 3, index)).toBeNull()
    }
  })
})

describe('打乱：构造性可解 + 独立验证', () => {
  it('三档难度都要足够多的打乱步数（3×3 也 ≥ 60）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(DIFFICULTIES[difficulty].scrambleSteps).toBeGreaterThanOrEqual(60)
    }
  })

  it('多组种子 × 三档难度：打乱后都不是已还原局面，且逆序数判据认定可解', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const solved = createSolvedBoard(config.size)
      for (let seed = 0; seed < 40; seed++) {
        const { board, cursor } = scrambleBoard(config, seed)
        expect(board).toHaveLength(config.size * config.size)
        expect([...board].sort((a, b) => a - b)).toEqual([...solved].sort((a, b) => a - b))
        // 初始局面不能就是已还原局面
        expect(isSolved(board, config.size)).toBe(false)
        // 独立判据（逆序数奇偶性）认定可解
        expect(solvableByParity(board, config.size), `seed ${seed}`).toBe(true)
        // 实现与独立判据一致
        expect(isSolvable(board, config.size), `seed ${seed}`).toBe(true)
        expect(cursor).toBeGreaterThanOrEqual(config.scrambleSteps)
      }
    }
  })

  it('同 seed 同难度完全确定；不同 seed 会给出不同局面', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      const a = scrambleBoard(config, 12345)
      const b = scrambleBoard(config, 12345)
      expect(a.board).toEqual(b.board)
      expect(a.cursor).toBe(b.cursor)
      let different = 0
      for (let seed = 0; seed < 8; seed++) {
        if (scrambleBoard(config, seed).board.join() !== a.board.join()) different += 1
      }
      expect(different).toBeGreaterThan(0)
    }
  })

  it('滑动保持「可解」这一不变量：从打乱局面随机走 60 步仍在可解分量内', () => {
    // 逆序数判据在每次滑动下保持不变（这正是「构造性打乱必可解」的原因）：
    // 从已还原局面出发随机游走，得到的所有局面都必然可解。
    for (const difficulty of DIFFICULTY_IDS) {
      const config = DIFFICULTIES[difficulty]
      let { board } = scrambleBoard(config, 7)
      for (let step = 0; step < 60; step++) {
        const dir = DIRECTIONS[step % DIRECTIONS.length]!
        const next = slide(board, config.size, dir)
        if (next === null) continue
        board = next
        expect(solvableByParity(board, config.size)).toBe(true)
        expect(isSolvable(board, config.size)).toBe(true)
      }
    }
  })

  it('打乱后若恰好是已还原局面，必须退回重打（cursor 表明用了一次以上尝试）', () => {
    // 3×3 只走 12 步时，随机游走有一定概率绕回还原态：
    // 这批种子里必然出现「第一次尝试失败 → 换随机流重打」的情况。
    // 断言的是「结果永远不是已还原 + 至少发生过一次重打」，不依赖某个具体种子。
    const config = { size: 3, scrambleSteps: 12 }
    let retried = 0
    for (let seed = 0; seed < 3000; seed++) {
      const result = scrambleBoard(config, seed)
      expect(isSolved(result.board, config.size), `seed ${seed}`).toBe(false)
      if (result.cursor > config.scrambleSteps) retried += 1
    }
    expect(retried).toBeGreaterThan(0)
  })

  it('打乱后的棋盘有且只有一个空白格', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const { board } = scrambleBoard(DIFFICULTIES[difficulty], 7)
      expect(board.filter((value) => value === 0)).toHaveLength(1)
    }
  })
})
