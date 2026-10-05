/**
 * 白方（对手）测试：合法性、可复现性、三档难度行为差异、前瞻层数、性能、随机源。
 *
 * 「白方每一手都合法」由两条独立路径复核：
 * 1. 用 helpers 的 diffPlaced/hasFive/countOf 逐步检查盘面只多了「黑一手 + 白一手」，
 *    白子落在原空点上、且离已有棋子不超过 2 格（AI 的候选范围）；
 * 2. 落点是否在盘内、是否成五由 helpers 的独立实现判断，不让被测代码自证。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRng } from '@eink/core'
import {
  BLACK,
  CELLS,
  DIFFICULTY_IDS,
  EMPTY,
  WHITE,
  chooseOpponentMove,
  countStones,
  createEmptyBoard,
  encodeState,
  evaluate,
  gameStatus,
  immediateWins,
  lookaheadDepth,
  reduceGomoku,
  gomokuGame,
  type DifficultyId,
  type GomokuState,
  type Stone,
} from '../src/index.js'
import {
  at,
  countOf,
  crowdedState,
  diffPlaced,
  distanceToNearestStone,
  hasFive,
  isFullBoard,
  playerMoves,
  winnerOf,
  settle,
} from './helpers.js'

/** 白方应手必须满足的独立复核条件 */
function assertLegalReply(
  before: readonly Stone[],
  after: readonly Stone[],
  state: GomokuState,
  difficulty: DifficultyId,
  note: string,
): void {
  const placed = diffPlaced(before, after)
  expect(placed.black, note).toHaveLength(1)
  const blackIndex = placed.black[0]!
  expect(before[blackIndex], note).toBe(EMPTY)

  if (state.moves > 0 && state.history[state.history.length - 1]!.white === null) {
    // 黑方这一手直接终结对局：白方不应手
    expect(placed.white, note).toHaveLength(0)
    expect(hasFive(after, blackIndex, BLACK), note).toBe(true)
    return
  }
  expect(placed.white, note).toHaveLength(1)
  const whiteIndex = placed.white[0]!
  expect(before[whiteIndex], note).toBe(EMPTY)
  // AI 只在已有棋子附近选点：入门档 1 格内，熟练/挑战档 2 格内（以黑方刚落子之后的盘面为准）
  expect(distanceToNearestStone(after, whiteIndex), note).toBeLessThanOrEqual(
    difficulty === 'starter' ? 1 : 2,
  )
  expect(hasFive(after, whiteIndex, WHITE), note || 'white five').toBe(
    winnerOf(after) === WHITE,
  )
}

describe('白方着法合法且可复现', () => {
  it('三档难度 × 多组种子走完整局：每一手都合法，同 seed 同动作序列 encode 一致', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [0, 1, 2, 5, 13]) {
        let state = gomokuGame.create(seed, difficulty)
        const rng = createRng(seed * 7919 + 17)
        const script: number[] = []
        let guard = 0
        while (gameStatus(state) === 'playing' && guard++ < 225) {
          const moves = playerMoves(state)
          if (moves.length === 0) break
          const index = moves[rng.int(moves.length)]!
          script.push(index)
          const before = state.board
          const placed = reduceGomoku(state, { type: 'place', index })
          const next = settle(placed)
          const note = `${difficulty} seed=${seed} move=${index}`

          assertLegalReply(before, next.board, next, difficulty, note)
          // 计数不变量：黑子 = 玩家步数、白子 = 游标，且每步最多增殖两子
          expect(countOf(next.board, BLACK), note).toBe(next.moves)
          expect(countOf(next.board, WHITE), note).toBe(next.rngCursor)
          expect(next.moves, note).toBe(state.moves + 1)
          expect(next.rngCursor - state.rngCursor, note).toBeGreaterThanOrEqual(0)
          expect(next.rngCursor - state.rngCursor, note).toBeLessThanOrEqual(1)
          // 进行中的局面既没有五连也没有下满
          if (gameStatus(next) === 'playing') {
            expect(winnerOf(next.board), note).toBeNull()
            expect(isFullBoard(next.board), note).toBe(false)
          }
          state = next
        }
        expect(state.moves, `${difficulty} seed=${seed}`).toBeGreaterThan(0)
        expect(gameStatus(state), `${difficulty} seed=${seed}`).not.toBe('playing')

        // 同一玩家动作序列重放：逐步与存档都完全一致（白方完全由 seed + 游标决定）
        let replay = gomokuGame.create(seed, difficulty)
        for (const index of script) replay = settle(reduceGomoku(replay, { type: 'place', index }))
        expect(encodeState(replay)).toEqual(encodeState(state))
      }
    }
  })

  it('同一局面 + 同一 (seed, 游标) → 同一着法；入门档不同种子会给出变化', () => {
    const board = createEmptyBoard()
    board[112] = BLACK
    const first = chooseOpponentMove('starter', board, 42, 0)
    expect(first).not.toBeNull()
    expect(board[first!]).toBe(EMPTY)
    expect(chooseOpponentMove('starter', board, 42, 0)).toBe(first)

    const picks = new Set<number>()
    for (let seed = 0; seed < 40; seed++) picks.add(chooseOpponentMove('starter', board, seed, 0)!)
    expect(picks.size).toBeGreaterThan(1)
    for (const pick of picks) {
      expect(board[pick]).toBe(EMPTY)
      expect(distanceToNearestStone(board, pick)).toBeLessThanOrEqual(1)
    }
  })

  it('游标变化即随机源变化：同一局面不同游标可给出不同应手（但每次都合法）', () => {
    const board = createEmptyBoard()
    board[112] = BLACK
    const picks = new Set<number>()
    for (let cursor = 0; cursor < 30; cursor++) {
      const pick = chooseOpponentMove('starter', board, 7, cursor)
      expect(pick).not.toBeNull()
      expect(distanceToNearestStone(board, pick!)).toBeLessThanOrEqual(1)
      picks.add(pick!)
    }
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('三档难度的战术行为', () => {
  it('熟练/挑战档：自己一手能成五时必下成五点', () => {
    const board = createEmptyBoard()
    for (const index of [at(7, 3), at(7, 4), at(7, 5), at(7, 6)]) board[index] = WHITE
    board[at(0, 0)] = BLACK
    board[at(0, 1)] = BLACK
    const wins = immediateWins(board, WHITE)
    expect(wins).toEqual([at(7, 2), at(7, 7)])
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 1, 2, 3, 4]) {
        expect(chooseOpponentMove(difficulty, board, seed, 0), `${difficulty} seed=${seed}`).toBeOneOf(wins)
      }
    }
  })

  it('熟练/挑战档：对手（黑）有成五点时必须去堵', () => {
    const board = createEmptyBoard()
    for (const index of [at(7, 3), at(7, 4), at(7, 5), at(7, 6)]) board[index] = BLACK
    for (const index of [at(0, 0), at(0, 1), at(0, 2)]) board[index] = WHITE
    const blocks = immediateWins(board, BLACK)
    expect(blocks).toEqual([at(7, 2), at(7, 7)])
    expect(immediateWins(board, WHITE)).toEqual([])
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 1, 2, 3, 4]) {
        const pick = chooseOpponentMove(difficulty, board, seed, 0)
        expect(blocks, `${difficulty} seed=${seed} pick=${pick}`).toContain(pick)
      }
    }
  })

  it('三档难度都返回空点，且入门档不会跑到离棋子 2 格以外的空区', () => {
    const board = createEmptyBoard()
    board[at(7, 7)] = BLACK
    board[at(7, 8)] = WHITE
    board[at(8, 8)] = BLACK
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 12; seed++) {
        const pick = chooseOpponentMove(difficulty, board, seed, seed % 5)
        expect(pick).not.toBeNull()
        expect(board[pick!]).toBe(EMPTY)
        expect(distanceToNearestStone(board, pick!)).toBeLessThanOrEqual(2)
      }
    }
  })

  it('盘面无空点候选时返回 null（调用方不会走到，但接口要自洽）', () => {
    const board = createEmptyBoard()
    board.fill(WHITE)
    expect(chooseOpponentMove('starter', board, 1, 0)).toBeNull()
  })
})

describe('评估与前瞻层数', () => {
  it('空盘评估为 0；白方占优为正、黑方占优为负', () => {
    expect(evaluate(createEmptyBoard())).toBe(0)
    const whiteAdvantage = createEmptyBoard()
    for (const index of [at(7, 3), at(7, 4), at(7, 5)]) whiteAdvantage[index] = WHITE
    expect(evaluate(whiteAdvantage)).toBeGreaterThan(0)
    const blackAdvantage = createEmptyBoard()
    for (const index of [at(7, 3), at(7, 4), at(7, 5)]) blackAdvantage[index] = BLACK
    expect(evaluate(blackAdvantage)).toBeLessThan(0)
  })

  it('前瞻层数始终落在需求要求的 2~3 层内', () => {
    expect(lookaheadDepth(createEmptyBoard())).toBe(3)
    for (const turns of [10, 40, 60, 80, 100]) {
      const board = crowdedState(turns).board
      const depth = lookaheadDepth(board)
      expect([2, 3], `turns=${turns}`).toContain(depth)
    }
    // 中盘候选点多，自动收窄到 2 层；空盘只有天元一个候选，用 3 层
    expect(lookaheadDepth(crowdedState(60).board)).toBe(2)
  })
})

describe('性能与随机源', () => {
  it('挑战档单次应手 < 500ms（中盘与残局各测）', () => {
    for (const turns of [40, 90]) {
      let state = crowdedState(turns, 'challenging')
      let worst = 0
      for (let ply = 0; ply < 3 && gameStatus(state) === 'playing'; ply++) {
        const index = playerMoves(state)[0]!
        const placed = reduceGomoku(state, { type: 'place', index })
        const start = performance.now()
        state = reduceGomoku(placed, { type: 'tick' }) // 第一拍 tick 才是真正的选点决策
        worst = Math.max(worst, performance.now() - start)
        state = settle(state)
      }
      expect(worst, `turns=${turns}`).toBeLessThan(500)
    }
  })

  it('规则层从不使用 Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    for (const difficulty of DIFFICULTY_IDS) {
      let state = gomokuGame.create(7, difficulty)
      for (let ply = 0; ply < 8 && gameStatus(state) === 'playing'; ply++) {
        state = settle(reduceGomoku(state, { type: 'place', index: playerMoves(state)[0]! }))
      }
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('难度 id 越界会被拒绝，不同难度互不串味', () => {
    expect(gomokuGame.create(1, 'skilled').difficulty).toBe('skilled')
    expect(() => gomokuGame.create(1, 'impossible')).toThrow()
    for (const difficulty of DIFFICULTY_IDS) {
      const state = gomokuGame.create(5, difficulty)
      expect(state.difficulty).toBe(difficulty)
      expect(countStones(state.board).empty).toBe(CELLS)
    }
    // 白方强度只影响选点，不影响状态结构：三档难度下计数不变量都成立
    for (const difficulty of DIFFICULTY_IDS) {
      let state = gomokuGame.create(2024, difficulty)
      for (const index of [0, 1, 2]) state = settle(reduceGomoku(state, { type: 'place', index }))
      expect(countOf(state.board, BLACK)).toBe(state.moves)
      expect(countOf(state.board, WHITE)).toBe(state.rngCursor)
    }
  })
})
