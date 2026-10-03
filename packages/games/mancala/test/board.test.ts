/**
 * 棋盘模型测试：布局与环形方向、跳过对手的仓、正对面映射、纯局面转移（连走 / 吃子 / 结算）。
 *
 * 方向与吃子的期望值全部由 helpers 的**独立实现**算出并逐一比对，
 * 避免「src 与测试同源、一起错」。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  BLACK,
  BLACK_STORE,
  CELLS,
  COLS,
  GAME_ID,
  INITIAL_STONES,
  PITS_PER_SIDE,
  RING,
  ROWS,
  WHITE,
  WHITE_STORE,
  isFinished,
  isPit,
  isStore,
  initialCells,
  nextCell,
  oppositePit,
  otherSide,
  pitIndexes,
  pitStones,
  ringPosition,
  settle,
  sowOnce,
  storeCount,
  storeOf,
  totalStones,
} from '../src/index.js'
import {
  INITIAL_TOTAL,
  cellAt,
  drawCells,
  independentNext,
  independentOpposite,
  independentSow,
  withCells,
} from './helpers.js'

describe('布局与环形方向', () => {
  it('2 行 × 7 列 = 14 格；白仓 0、白坑 1..6、黑坑 7..12、黑仓 13', () => {
    expect(COLS).toBe(7)
    expect(ROWS).toBe(2)
    expect(CELLS).toBe(14)
    expect(PITS_PER_SIDE).toBe(6)
    expect(GAME_ID).toBe('mancala')
    expect(WHITE_STORE).toBe(0)
    expect(BLACK_STORE).toBe(13)
    expect(storeOf(BLACK)).toBe(13)
    expect(storeOf(WHITE)).toBe(0)
    expect(pitIndexes(BLACK)).toEqual([7, 8, 9, 10, 11, 12])
    expect(pitIndexes(WHITE)).toEqual([1, 2, 3, 4, 5, 6])
    for (let index = 0; index < CELLS; index++) {
      expect(isStore(index)).toBe(index === 0 || index === 13)
      expect(isPit(index)).toBe(!isStore(index))
    }
    expect(Math.floor(BLACK_STORE / COLS)).toBe(1)
    expect(BLACK_STORE % COLS).toBe(6)
    expect(Math.floor(WHITE_STORE / COLS)).toBe(0)
    expect(WHITE_STORE % COLS).toBe(0)
    expect(cellAt(1, 0)).toBe(7)
    expect(cellAt(0, 6)).toBe(6)
  })

  it('RING 是逆时针一圈：[7..12] → 13 → [6..1] → 0 → 回到 7', () => {
    expect([...RING]).toEqual([7, 8, 9, 10, 11, 12, 13, 6, 5, 4, 3, 2, 1, 0])
    expect(new Set(RING).size).toBe(CELLS)
    RING.forEach((cell, position) => expect(ringPosition(cell)).toBe(position))
  })

  it('nextCell 与独立几何实现完全一致（14 格 × 双方）', () => {
    for (let index = 0; index < CELLS; index++) {
      for (const side of [BLACK, WHITE] as const) {
        expect(nextCell(index, side), `cell ${index} side ${side}`).toBe(independentNext(index, side))
      }
    }
  })

  it('跳过对手的仓：黑方从白坑1 直接下到黑坑7，白方从黑坑12 直接上到白坑6', () => {
    expect(nextCell(1, BLACK)).toBe(7)
    expect(nextCell(12, WHITE)).toBe(6)
    expect(nextCell(1, WHITE)).toBe(0)
    expect(nextCell(12, BLACK)).toBe(13)
  })

  it('正对面映射与独立实现一致（黑坑 7..12 ↔ 白坑 6..1）', () => {
    expect(oppositePit(7)).toBe(6)
    expect(oppositePit(12)).toBe(1)
    expect(oppositePit(6)).toBe(7)
    expect(oppositePit(1)).toBe(12)
    for (const pit of [...pitIndexes(BLACK), ...pitIndexes(WHITE)]) {
      expect(oppositePit(pit), `pit ${pit}`).toBe(independentOpposite(pit))
      expect(oppositePit(oppositePit(pit))).toBe(pit)
    }
    expect(oppositePit(BLACK_STORE)).toBe(-1)
    expect(oppositePit(WHITE_STORE)).toBe(-1)
  })

  it('初始摆法：12 个坑各 4 颗、两仓为 0、总数 48', () => {
    const cells = initialCells()
    expect(cells).toHaveLength(CELLS)
    for (const pit of [...pitIndexes(BLACK), ...pitIndexes(WHITE)]) {
      expect(cells[pit], `pit ${pit}`).toBe(INITIAL_STONES)
    }
    expect(cells[WHITE_STORE]).toBe(0)
    expect(cells[BLACK_STORE]).toBe(0)
    expect(totalStones(cells)).toBe(INITIAL_TOTAL)
    expect(INITIAL_TOTAL).toBe(INITIAL_STONES * CELLS - 2 * INITIAL_STONES)
    expect(storeCount(cells, BLACK)).toBe(0)
    expect(storeCount(cells, WHITE)).toBe(0)
    expect(pitStones(cells, BLACK)).toBe(INITIAL_STONES * PITS_PER_SIDE)
  })
})

describe('播种：连走 / 吃子 / 结算', () => {
  it('最后一颗落在自己的仓 → 连走（extraTurn）', () => {
    const state = withCells([[12, 1]], BLACK)
    const { state: next, extraTurn, captured } = sowOnce(state, 12)
    expect(extraTurn).toBe(true)
    expect(captured).toBe(0)
    expect(next.cells[12]).toBe(0)
    expect(storeCount(next.cells, BLACK)).toBe(1)
    expect(next.turn).toBe(BLACK)
  })

  it('与独立实现逐格比对：双方每个坑的一次播种结果完全一致', () => {
    const state = withCells([], BLACK)
    for (const side of [BLACK, WHITE] as const) {
      for (const pit of pitIndexes(side)) {
        const result = sowOnce({ ...state, turn: side }, pit)
        const expected = independentSow(state.cells, pit, side)
        expect(result.state.cells, `side ${side} pit ${pit}\n${drawCells(result.state.cells)}`).toEqual(
          expected.cells,
        )
        expect(result.extraTurn).toBe(expected.extraTurn)
        expect(result.captured).toBe(expected.captured)
      }
    }
  })

  it('落自己空坑且对面非空 → 吃两边；对面为空则不吃', () => {
    const withOpposite = withCells(
      [
        [10, 1],
        [11, 0],
      ],
      BLACK,
    )
    const eaten = sowOnce(withOpposite, 10)
    expect(eaten.extraTurn).toBe(false)
    // 吃子 = 自己坑里最后落下的 1 颗 + 对面白坑2 原有的 4 颗 = 5
    expect(eaten.captured).toBe(5)
    expect(storeCount(eaten.state.cells, BLACK)).toBe(5)
    expect(eaten.state.cells[11]).toBe(0)
    expect(eaten.state.cells[2]).toBe(0)
    expect(eaten.state.turn).toBe(WHITE)

    const emptyOpposite = withCells(
      [
        [10, 1],
        [11, 0],
        [2, 0],
      ],
      BLACK,
    )
    const notEaten = sowOnce(emptyOpposite, 10)
    expect(notEaten.captured).toBe(0)
    expect(notEaten.state.cells[11]).toBe(1)
    expect(storeCount(notEaten.state.cells, BLACK)).toBe(0)
  })

  it('落自己非空坑不吃（只有原本是空坑才吃）', () => {
    const state = withCells(
      [
        [10, 1],
        [11, 3],
      ],
      BLACK,
    )
    const result = sowOnce(state, 10)
    expect(result.captured).toBe(0)
    expect(result.state.cells[11]).toBe(4)
    expect(result.state.cells[2]).toBe(4)
  })

  it('「最后一颗本该落在对手仓」时落在跳过之后的下一格（黑方：白仓0 → 黑坑7）', () => {
    const state = withCells([[7, 13]], BLACK)
    const result = sowOnce(state, 7)
    expect(result.state.cells[WHITE_STORE], '对手的仓不应被播种').toBe(0)
    // 途中第 6 颗直接落进黑仓，最后一颗落回黑坑7 后吃子
    expect(result.captured).toBe(6)
    expect(result.state.cells[7]).toBe(0)
    expect(result.state.cells[6]).toBe(0)
    expect(storeCount(result.state.cells, BLACK)).toBe(7)
    const expected = independentSow(state.cells, 7, BLACK)
    expect(result.state.cells).toEqual(expected.cells)
  })

  it('白方播种时黑仓不被播种', () => {
    const state = withCells([[6, 13]], WHITE)
    const result = sowOnce(state, 6)
    expect(result.state.cells[BLACK_STORE]).toBe(0)
    expect(result.state.cells).toEqual(independentSow(state.cells, 6, WHITE).cells)
  })

  it('非法播种抛 IllegalActionError：越界 / 仓 / 对手的坑 / 空坑', () => {
    const state = withCells([], BLACK)
    expect(() => sowOnce(state, -1)).toThrow(IllegalActionError)
    expect(() => sowOnce(state, CELLS)).toThrow(IllegalActionError)
    expect(() => sowOnce(state, 1.5)).toThrow(IllegalActionError)
    expect(() => sowOnce(state, WHITE_STORE)).toThrow(IllegalActionError)
    expect(() => sowOnce(state, BLACK_STORE)).toThrow(IllegalActionError)
    expect(() => sowOnce(state, 3)).toThrow(IllegalActionError)
    expect(() => sowOnce(withCells([[7, 0]], BLACK), 7)).toThrow(IllegalActionError)
  })

  it('结算：一方坑全空 → 双方坑内石子全部收回各自仓，且幂等', () => {
    const cells = [3, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1]
    expect(isFinished(cells)).toBe(true)
    const settled = settle(cells)
    expect(settled).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3])
    expect(settle(settled)).toEqual(settled)
    expect(totalStones(settled)).toBe(totalStones(cells))
    expect(isFinished([0, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0])).toBe(true)
    expect(isFinished(initialCells())).toBe(false)
  })

  it('播种后轮到谁：落自己仓连走、否则换手；换到白方游标 +1', () => {
    const state = withCells([[12, 1]], BLACK)
    expect(sowOnce(state, 12).state.turn).toBe(BLACK)
    expect(sowOnce(state, 12).state.rngCursor).toBe(0)
    const other = withCells([[7, 1]], BLACK)
    const switched = sowOnce(other, 7)
    expect(switched.state.turn).toBe(WHITE)
    expect(switched.state.rngCursor).toBe(1)
    expect(otherSide(BLACK)).toBe(WHITE)
  })
})
