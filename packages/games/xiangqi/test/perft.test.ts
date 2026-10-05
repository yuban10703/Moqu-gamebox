/**
 * 独立验证：**开局合法着法数 = 44**（象棋公认的 perft(1)）。
 *
 * 为什么单开一个文件、且不引用包内任何夹具：本项目有过「求解器与产品代码犯了同一个
 * 边界错误、互为印证」的事故（见 docs/handover.md §5b），所以关键不变量要有一条
 * **独立来源**的断言。44 这个数是公开的 perft(1)，不是从本实现里跑出来再抄回去的。
 *
 * 逐子手算（红方，行 0 在上、红在 7~9 行）：
 *   车 (9,0)/(9,8)：向上 (8,x)(7,x) 两格（再上被己方炮? 不 —— (7,0) 空，(6,0) 是己方兵）→ 各 2
 *   马 (9,1)/(9,7)：各 2 —— (9,1) 只能到 (7,0)/(7,2)；(8,3) 不行，因为它的马腿是 (9,2)，
 *                   而那里是己方的相（这一条是独立核算时被实现纠正过来的）
 *   相 (9,2)/(9,6)：各 2
 *   仕 (9,3)/(9,5)：各 1
 *   帅 (9,4)：1
 *   炮 (7,1)/(7,7)：横向各 6 + 下 1 + 上 5（(6,1)(5,1)(4,1)(3,1) 四格静走，
 *                   再以黑炮 (2,1) 为炮架吃 (0,1) 的黑马）= 各 12
 *   兵 (6,0)(6,2)(6,4)(6,6)(6,8)：各 1（未过河，只能向前）
 *   合计 4 + 4 + 4 + 2 + 1 + 24 + 5 = 44
 */
import { describe, expect, it } from 'vitest'
import { BLACK, RED, createInitialBoard, legalMoves, moveFrom } from '../src/board.js'
import { xiangqiGame } from '../src/index.js'

/** 按「起点格」分组，统计每类的着法数 —— 某类算错时能直接指出是哪一类 */
function countByOrigin(moves: readonly number[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const move of moves) {
    const from = moveFrom(move)
    map.set(from, (map.get(from) ?? 0) + 1)
  }
  return map
}

describe('开局着法数（独立核算，来源为公开的 perft(1)）', () => {
  it('红方 44 步、黑方 44 步', () => {
    const board = createInitialBoard()
    expect(legalMoves(board, RED)).toHaveLength(44)
    expect(legalMoves(board, BLACK)).toHaveLength(44)
  })

  it('逐类核算红方 44 步（车 2/2、马 2/2、相 2/2、仕 1/1、帅 1、炮 12/12、兵 1×5）', () => {
    const byOrigin = countByOrigin(legalMoves(createInitialBoard(), RED))
    const expectAt = (row: number, col: number, count: number) => {
      expect(byOrigin.get(row * 9 + col) ?? 0, `(${row},${col}) 的着法数`).toBe(count)
    }
    expectAt(9, 0, 2)
    expectAt(9, 8, 2) // 车
    expectAt(9, 1, 2)
    expectAt(9, 7, 2) // 马（(9,2) 的相挡住 (8,3) 那条马腿）
    expectAt(9, 2, 2)
    expectAt(9, 6, 2) // 相
    expectAt(9, 3, 1)
    expectAt(9, 5, 1) // 仕
    expectAt(9, 4, 1) // 帅
    expectAt(7, 1, 12)
    expectAt(7, 7, 12) // 炮
    for (const col of [0, 2, 4, 6, 8]) expectAt(6, col, 1) // 兵
    expect(byOrigin.size, '有棋子没产生任何着法（或出现了不该出现的起点）').toBe(16)
  })

  it('走壳层那条路（GameDef.legal）能拿到同样 44 个着法 —— 公开面与内部实现一致', () => {
    const state = xiangqiGame.create(1, 'starter')
    const actions = xiangqiGame.legal(state)
    // 壳层口径的合法动作里既有 select（选中态，不计步、不进日志）也有 move
    const moves = actions.filter((action) => action.type === 'move')
    expect(moves).toHaveLength(44)
    // 选中动作按「可动的棋子」给：开局有 16 枚子可动，外加 1 个「取消选中」
    const selects = actions.filter((action) => action.type === 'select')
    expect(selects.length).toBeGreaterThanOrEqual(16)
  })
})
