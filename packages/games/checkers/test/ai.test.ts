/**
 * 白方 AI 测试：每手合法、可复现、三档强度差异（贪心/搜索会选吃得更多的连跳）与性能。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  BLACK,
  LOOKAHEAD_DEPTH,
  MAN_VALUE,
  ROOT_LIMIT,
  WHITE,
  chooseOpponentTurn,
  chooseTurn,
  enumerateTurns,
  evaluateBoard,
  initialBoard,
  legalActions,
  reduceCheckers,
  turnCapturedValue,
  type CheckersState,
  type DifficultyId,
  type Piece,
  type Turn,
} from '../src/index.js'
import { boardFromRows, fresh } from './helpers.js'

/** 两个回合是否逐步相同 */
function sameTurn(a: Turn, b: Turn): boolean {
  return (
    a.length === b.length &&
    a.every((move, index) => move.from === b[index]!.from && move.to === b[index]!.to)
  )
}

/** 在白方视角取一个「真实中盘」棋盘：让黑方随机走若干回合 */
function midgameBoards(count: number, seed = 20240607): Piece[][] {
  const boards: Piece[][] = []
  let state: CheckersState = fresh(seed, 'starter')
  const rng = createRng(seed)
  for (let turn = 0; turn < 14; turn++) {
    if (state.turn !== BLACK) break
    const moves = legalActions(state).filter(
      (action): action is { type: 'move'; from: number; to: number } => action.type === 'move',
    )
    if (moves.length === 0) break
    state = reduceCheckers(state, moves[rng.int(moves.length)]!)
    if (boards.length < count) boards.push([...state.board])
  }
  return boards
}

describe('三档难度都给出合法着法', () => {
  const difficulties: DifficultyId[] = ['starter', 'skilled', 'challenging']

  it('起始局面与多个真实中盘局面上，返回的回合都在合法回合集合里', () => {
    const boards = [initialBoard(), ...midgameBoards(4)]
    for (const difficulty of difficulties) {
      for (const board of boards) {
        const rng = createRng(12345)
        const turn = chooseTurn(board, WHITE, difficulty, rng)
        const legalTurns = enumerateTurns(board, WHITE)
        expect(legalTurns.length).toBeGreaterThan(0)
        expect(
          legalTurns.some((candidate) => sameTurn(candidate, turn)),
          `${difficulty}: ${JSON.stringify(turn)}`,
        ).toBe(true)
      }
    }
  })

  it('同 seed + 同局面 ⇒ 同着法（三档都可复现）', () => {
    const boards = [initialBoard(), ...midgameBoards(3)]
    for (const difficulty of difficulties) {
      for (const board of boards) {
        for (const cursor of [0, 1, 2, 7]) {
          const first = chooseOpponentTurn(difficulty, board, 987654321, cursor)
          const second = chooseOpponentTurn(difficulty, board, 987654321, cursor)
          expect(sameTurn(first, second), `${difficulty} cursor ${cursor}`).toBe(true)
        }
      }
    }
  })

  it('随机档会用种子/游标产生不同选择（不是恒定一手）', () => {
    const board = initialBoard()
    const seen = new Set<string>()
    for (let cursor = 0; cursor < 12; cursor++) {
      seen.add(JSON.stringify(chooseOpponentTurn('starter', board, 42, cursor)))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('有吃子时必定吃子（强制吃子由着法生成保证）', () => {
    const board = boardFromRows([
      '........',
      '..b.....',
      '.w......',
      '........',
      '........',
      '........',
      '........',
      'b.......',
    ])
    for (const difficulty of difficulties) {
      const turn = chooseOpponentTurn(difficulty, board, 5, 0)
      expect(turnCapturedValue(board, turn), difficulty).toBeGreaterThan(0)
    }
  })
})

describe('强度差异（贪心与搜索会选更划算的连跳）', () => {
  /** 白兵 (5,4) 有两条吃法：连吃 (4,3)、(2,1) 两子，或只吃 (4,5) 一子 */
  const board = boardFromRows([
    '........',
    '........',
    '.b......',
    '........',
    '...b.b..',
    '....w...',
    '........',
    'b.......',
  ])

  it('skilled / challenging 选中吃两子的连跳', () => {
    for (const difficulty of ['skilled', 'challenging'] as const) {
      const turn = chooseOpponentTurn(difficulty, board, 20240607, 0)
      expect(turn.length, difficulty).toBe(2)
      expect(turnCapturedValue(board, turn), difficulty).toBe(2 * MAN_VALUE)
    }
  })

  it('不同着法都合法（starter 也不会走出非法着法）', () => {
    const legalTurns = enumerateTurns(board, WHITE)
    expect(legalTurns.length).toBeGreaterThanOrEqual(2)
    for (let cursor = 0; cursor < 8; cursor++) {
      const turn = chooseOpponentTurn('starter', board, 7, cursor)
      expect(legalTurns.some((candidate) => sameTurn(candidate, turn))).toBe(true)
    }
  })
})

describe('搜索参数与性能', () => {
  it('三档参数固定：随机与贪心不搜索，挑战档 4 层且有固定分支上限', () => {
    expect(LOOKAHEAD_DEPTH.starter).toBe(0)
    expect(LOOKAHEAD_DEPTH.skilled).toBe(1)
    expect(LOOKAHEAD_DEPTH.challenging).toBeGreaterThanOrEqual(4)
    expect(LOOKAHEAD_DEPTH.challenging).toBeLessThanOrEqual(6)
    expect(ROOT_LIMIT.challenging).toBeGreaterThan(0)
  })

  it('challenging 应手耗时 < 500ms（多个真实中盘局面的最坏值）', () => {
    const boards = [initialBoard(), ...midgameBoards(4, 777)]
    let worst = 0
    for (const board of boards) {
      const started = performance.now()
      chooseOpponentTurn('challenging', board, 20240607, 0)
      const elapsed = performance.now() - started
      if (elapsed > worst) worst = elapsed
    }
    expect(worst).toBeLessThan(500)
  })

  it('evaluateBoard 的双方视角互为相反数（材料项对称）', () => {
    const board = boardFromRows([
      '........',
      'w.......',
      '.b......',
      '..B.....',
      '........',
      '....w...',
      '........',
      'b.......',
    ])
    expect(evaluateBoard(board, BLACK)).toBe(-evaluateBoard(board, WHITE))
    // 起始局面双方完全对称，评估为 0
    expect(evaluateBoard(initialBoard(), BLACK)).toBe(0)
  })
})
