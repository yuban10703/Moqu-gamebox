/**
 * AI 测试：三档只走合法着法、确定性（同 seed 同局面同着法）、无 Math.random、战术抽查。
 * 走子生成本身已由 perft 用公开值交叉验证。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BLACK,
  WHITE,
  chooseOpponentMove,
  createState,
  legalMovesOn,
  moveFrom,
  moveTo,
  reduceChess,
  type AiPosition,
  type ChessState,
} from '../src/index.js'
import { at, boardOf, settle } from './helpers.js'

function posOf(state: ChessState): AiPosition {
  return { board: state.board.slice(), sideToMove: BLACK, castling: state.castling, epSquare: state.epSquare }
}

describe('三档只走合法着法', () => {
  for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
    it(`${difficulty}：多组种子、多步应手都在合法集合里`, () => {
      for (const seed of [0, 1, 2, 5, 13]) {
        let state = createState(seed, difficulty)
        for (let ply = 0; ply < 10; ply++) {
          const move = (legalMovesOn({
            board: state.board.slice(), sideToMove: WHITE, castling: state.castling, epSquare: state.epSquare,
          }) as number[])[0]!
          state = settle(reduceChess(state, { type: 'move', from: moveFrom(move), to: moveTo(move) }))
          const reply = state.history[state.history.length - 1]!.black
          if (reply === null) break // 白方直接终局
          // 应手真的落在盘上且是黑子（tick 落子前已在规则层校验合法性，非法会直接抛错）
          expect(state.board[moveTo(reply)]! & 8).toBe(8) // side 位 = 黑
        }
      }
    })
  }
})

describe('确定性与随机源', () => {
  it('同一局面 + 同一 (seed, 游标) → 同一着法', () => {
    const board = boardOf(['rnbqkbnr', 'pppppppp', '8', '8', '4P3', '8', 'PPPP1PPP', 'RNBQKBNR'])
    const pos: AiPosition = { board, sideToMove: BLACK, castling: 15, epSquare: null }
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const first = chooseOpponentMove(difficulty, pos, 42, 0)
      expect(first).not.toBeNull()
      expect(chooseOpponentMove(difficulty, pos, 42, 0)).toBe(first)
    }
  })

  it('入门档不同种子会给出变化（随机性存在但不越界）', () => {
    const board = boardOf(['rnbqkbnr', 'pppppppp', '8', '8', '4P3', '8', 'PPPP1PPP', 'RNBQKBNR'])
    const pos: AiPosition = { board, sideToMove: BLACK, castling: 15, epSquare: null }
    const picks = new Set<number>()
    for (let seed = 0; seed < 40; seed++) picks.add(chooseOpponentMove('starter', pos, seed, 0)!)
    expect(picks.size).toBeGreaterThan(1)
  })

  it('规则层与 AI 不使用 Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      let state = createState(7, difficulty)
      for (let ply = 0; ply < 6; ply++) {
        const move = legalMovesOn({
          board: state.board.slice(), sideToMove: WHITE, castling: state.castling, epSquare: state.epSquare,
        })[0] as number
        state = settle(reduceChess(state, { type: 'move', from: moveFrom(move), to: moveTo(move) }))
      }
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('战术抽查', () => {
  it('挑战/熟练档：能吃后时必吃（白后无人保护）', () => {
    // 黑马 d4 可吃白后 e2（无保护），黑王 h8、白王 e1 远离
    const board = boardOf([
      '7k',
      '8',
      '8',
      '8',
      '3n4',
      '8',
      '4Q3',
      '4K3',
    ])
    const pos: AiPosition = { board, sideToMove: BLACK, castling: 0, epSquare: null }
    for (const difficulty of ['skilled', 'challenging'] as const) {
      const pick = chooseOpponentMove(difficulty, pos, 7, 0)!
      expect(moveFrom(pick)).toBe(at(4, 3))
      expect(moveTo(pick)).toBe(at(6, 4))
    }
  })

  it('挑战档：白方一步将杀时，黑方会躲开被将死的局面', () => {
    // 黑王 h8、白后 g7 将，黑王只能吃后或走 g8 —— 搜索不会选导致被将死的着法（这里是可吃的）
    const board = boardOf(['7k', '6Q1', '8', '8', '8', '8', '8', '4K3'])
    const pos: AiPosition = { board, sideToMove: BLACK, castling: 0, epSquare: null }
    const pick = chooseOpponentMove('challenging', pos, 3, 0)!
    expect(moveTo(pick)).toBe(at(1, 6)) // g7 上的白后
  })
})

describe('耗时（只打印，不做时间断言）', () => {
  it('三档单步决策耗时', () => {
    let state = createState(11, 'challenging')
    for (let ply = 0; ply < 6; ply++) {
      const move = legalMovesOn({
        board: state.board.slice(), sideToMove: WHITE, castling: state.castling, epSquare: state.epSquare,
      })[0] as number
      state = settle(reduceChess(state, { type: 'move', from: moveFrom(move), to: moveTo(move) }))
    }
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const pos = posOf(state)
      const start = performance.now()
      chooseOpponentMove(difficulty, pos, 11, state.rngCursor)
      const elapsed = performance.now() - start
      console.log(`  chess ${difficulty}: ${elapsed.toFixed(1)}ms`)
    }
  })
})
