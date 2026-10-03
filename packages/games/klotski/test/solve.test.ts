/**
 * 可解性验证：四个关卡全部由**独立实现的 BFS**求出最短滑动序列，再用规则层逐步执行到 won；
 * 同时用构造的无解局面证明求解器不恒真（区分度）。
 */
import { describe, expect, it } from 'vitest'
import {
  CAO_GOAL,
  CAO_ID,
  LEVELS,
  createState,
  encodeState,
  gameStatus,
  klotskiGame,
  type LevelDef,
} from '../src/index.js'
import { parsePieces, solveKlotski, type SolverPiece } from './helpers.js'

/** 把关卡定义转成独立求解器认识的块表（id 与规则层一致，解可以直接回放） */
function solverPieces(level: LevelDef): SolverPiece[] {
  return level.pieces.map((piece) => ({
    id: piece.id,
    glyph: piece.glyph,
    width: piece.width,
    height: piece.height,
    start: piece.start,
  }))
}

describe('四个关卡都可解（独立 BFS + 规则层执行）', () => {
  for (const level of LEVELS) {
    it(`${level.id}：解出最短序列并把每一步交给规则层执行到 won`, () => {
      const result = solveKlotski(solverPieces(level))
      // 触顶说明结论不可信，必须显式失败
      expect(result.exhausted, `${level.id} 求解触顶`).toBe(false)
      expect(result.solution, `${level.id} 应当有解`).not.toBeNull()
      // 独立求解器给的是最短解，必须与本关声明的「最少步数」一致
      expect(result.solution!.length, `${level.id} 最优步数`).toBe(level.optimalMoves)

      let state = createState(level.id)
      for (const move of result.solution!) {
        state = klotskiGame.reduce(state, { type: 'slide', id: move.id, dir: move.dir })
        // 每一步的存档都必须严格往返（历史事故：decode 拒绝自己产出的状态）
        expect(klotskiGame.decode(encodeState(state)), `${level.id} ${state.moves}`).toEqual(state)
      }
      expect(gameStatus(state)).toBe('won')
      expect(state.positions[CAO_ID]).toBe(CAO_GOAL)
      expect(state.moves).toBe(result.solution!.length)
      expect(state.log).toHaveLength(state.moves)
    }, 30000)
  }

  /*
   * 性能冒烟守卫，不是正确性断言：它挡的是"某个关卡突然变得算不出来"这种灾难性退化。
   * 界限刻意宽松（15s）：本机在同时跑多个浏览器/构建任务时，同一份代码实测会从 ~2s 涨到 5.3s，
   * 3s 的旧界限会**假红**（2026-10-04 实测 5.32s 导致 npm run verify 失败，与代码改动无关）。
   */
  it('四关求解总耗时 < 15s（宽松冒烟界限，见上方注释）', () => {
    const started = performance.now()
    for (const level of LEVELS) {
      const result = solveKlotski(solverPieces(level))
      expect(result.solution).not.toBeNull()
    }
    expect(performance.now() - started).toBeLessThan(15000)
  }, 60000)
})

describe('求解器区分度', () => {
  it('构造的无解局面被判无解且未触顶', () => {
    // 曹操离终点只差一步（左上角在 (2,1)，需要下移到 (3,1)），但：
    // - (4,1)(4,2) 被关羽与卒永久占住；
    // - (1,2) 的卒、左上的张飞、右上的黄忠把它的其它方向也堵死。
    // 整个可达分量只有几个状态，BFS 能穷尽后返回 null（不是触顶）。
    const pieces = parsePieces(['.马.黄', '张马p黄', '张曹曹赵', 'q曹曹赵', '关关rs'])
    const result = solveKlotski(pieces, 200_000)
    expect(result.exhausted).toBe(false)
    expect(result.solution).toBeNull()
    expect(result.visited).toBeLessThan(100)
  })

  it('曹操已经在终点的局面给出 0 步解（而不是 null）', () => {
    const pieces = parsePieces(['张马黄.', '张马黄.', '赵关关r', '赵曹曹p', 'q曹曹s'])
    const result = solveKlotski(pieces, 200_000)
    expect(result.exhausted).toBe(false)
    expect(result.solution).toEqual([])
  })
})
