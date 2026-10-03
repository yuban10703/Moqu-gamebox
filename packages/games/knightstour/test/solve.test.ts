/**
 * 可解性验证：独立 Warnsdorff 求解器（不复用 src 的任何走法生成）求出 64 格巡游，
 * 再用规则层逐步执行到 won；并用小棋盘上「不存在完整巡游」证明判据有区分度。
 */
import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  createState,
  encodeState,
  gameStatus,
  knightstourGame,
} from '../src/index.js'
import { inspectTour, solveKnightTour } from './helpers.js'

describe('三档难度多组种子都能走满 64 格', () => {
  it('独立求解器给出的路径长度 = 64、每步都是合法马步，规则层执行到 won', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 6; seed++) {
        const state = createState(seed, difficulty)
        const result = solveKnightTour(BOARD_SIZE, state.start)
        // 触顶说明结论不可信，必须显式失败
        expect(result.exhausted, `${difficulty} seed ${seed} 求解触顶`).toBe(false)
        expect(result.solution, `${difficulty} seed ${seed} 应当有解`).not.toBeNull()

        const path = result.solution!
        expect(path).toHaveLength(CELLS)
        const check = inspectTour(BOARD_SIZE, state.start, path)
        expect(check.ok, `${difficulty} seed ${seed}: ${check.reason}`).toBe(true)

        // 把整条路径交给规则层逐步执行；每 8 步校验一次存档往返（不必每步都做，省时间）
        let current = state
        for (let step = 1; step < path.length; step++) {
          current = knightstourGame.reduce(current, { type: 'move', to: path[step]! })
          if (step % 8 === 0) {
            expect(knightstourGame.decode(encodeState(current)), `${difficulty} ${seed} ${step}`).toEqual(
              current,
            )
          }
        }
        expect(gameStatus(current)).toBe('won')
        expect(current.moves).toBe(CELLS - 1)
        expect(current.visited).toHaveLength(CELLS)
        expect(new Set(current.visited).size).toBe(CELLS)
        expect(current.current).toBe(path[path.length - 1])
      }
    }
  }, 60000)

  it('求解耗时 < 3s（三档难度 × 4 组种子）', () => {
    const started = performance.now()
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 4; seed++) {
        const state = createState(seed, difficulty)
        const result = solveKnightTour(BOARD_SIZE, state.start)
        expect(result.solution).toHaveLength(CELLS)
      }
    }
    expect(performance.now() - started).toBeLessThan(3000)
  }, 30000)
})

describe('求解器区分度', () => {
  it('3×3 与 4×4 上不存在完整巡游：判无解且未触顶', () => {
    // 3×3 从正中出发（1*3+1 = 4）：马无处可去
    const confined = solveKnightTour(3, 4)
    expect(confined.exhausted).toBe(false)
    expect(confined.solution).toBeNull()

    // 3×3 从角出发：能走几步，但 9 格永远走不满
    const tiny = solveKnightTour(3, 0)
    expect(tiny.exhausted).toBe(false)
    expect(tiny.solution).toBeNull()

    // 4×4 上根本不存在骑士巡游（经典结论）
    const four = solveKnightTour(4, 0)
    expect(four.exhausted).toBe(false)
    expect(four.solution).toBeNull()
  })

  it('同一个求解器在 8×8 上给出完整巡游（不是恒返回 null）', () => {
    const result = solveKnightTour(BOARD_SIZE, 0)
    expect(result.exhausted).toBe(false)
    expect(result.solution).toHaveLength(CELLS)
    expect(inspectTour(BOARD_SIZE, 0, result.solution!).ok).toBe(true)
    // 节点数远小于上限：Warnsdorff 排序让它几乎不回溯
    expect(result.nodes).toBeLessThan(500_000)
  })
})
