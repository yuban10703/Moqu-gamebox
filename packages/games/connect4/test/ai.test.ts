/**
 * 白方（对手）测试：合法性、可复现性、三档难度行为差异、前瞻层数、评估函数、性能、随机源。
 *
 * 「白方每一手都合法」由独立路径复核：
 * 落点必须等于落子前该列的最低空格（helpers 的 `bottomIndex`），
 * 成四与否由 helpers 的独立实现 `hasFour` 判断，不让被测代码自证。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRng } from '@eink/core'
import {
  BLACK,
  DIFFICULTY_IDS,
  EMPTY,
  WHITE,
  chooseOpponentMove,
  columnFull,
  connect4Game,
  countStones,
  createEmptyBoard,
  encodeState,
  evaluate,
  gameStatus,
  isFull,
  landingIndex,
  lookaheadDepth,
  reduceConnect4,
  validColumns,
  winningColumns,
} from '../src/index.js'
import {
  at,
  boardOf,
  bottomIndex,
  columnsFilledBoard,
  countOf,
  crowdedState,
  diffPlaced,
  hasFour,
  isFullBoard,
  playerColumns,
  winnerOf,
} from './helpers.js'

describe('白方着法合法且可复现', () => {
  it('三档难度 × 多组种子走完整局：每一手都合法，同 seed 同动作序列 encode 一致', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [0, 1, 2, 5, 13]) {
        let state = connect4Game.create(seed, difficulty)
        const rng = createRng(seed * 7919 + 17)
        const script: number[] = []
        let guard = 0
        while (gameStatus(state) === 'playing' && guard++ < 42) {
          const columns = playerColumns(state)
          if (columns.length === 0) break
          const column = columns[rng.int(columns.length)]!
          script.push(column)

          const before = state.board
          const next = reduceConnect4(state, { type: 'drop', column })
          const note = `${difficulty} seed=${seed} column=${column} ply=${state.moves}`
          const placed = diffPlaced(before, next.board)

          // 黑方这一手必须落在该列最低空格
          expect(placed.black, note).toHaveLength(1)
          expect(placed.black[0], note).toBe(bottomIndex(before, column)!)

          const turn = next.history[next.history.length - 1]!
          if (turn.white === null) {
            // 黑方这一手直接终结对局（成四或下满）：白方不应手
            expect(placed.white, note).toHaveLength(0)
            expect(hasFour(next.board, turn.black, BLACK) || isFullBoard(next.board), note).toBe(true)
          } else {
            expect(placed.white, note).toHaveLength(1)
            const whiteIndex = placed.white[0]!
            const afterBlack = before.slice()
            afterBlack[turn.black] = BLACK
            // 白方应手同样受重力约束，且落在白方落子前的盘面上
            expect(whiteIndex, note).toBe(bottomIndex(afterBlack, whiteIndex % 7))
          }

          // 计数不变量：黑子 = 玩家步数、白子 = 游标
          expect(countOf(next.board, BLACK), note).toBe(next.moves)
          expect(countOf(next.board, WHITE), note).toBe(next.rngCursor)
          expect(next.moves, note).toBe(state.moves + 1)
          expect(next.rngCursor - state.rngCursor, note).toBeGreaterThanOrEqual(0)
          expect(next.rngCursor - state.rngCursor, note).toBeLessThanOrEqual(1)
          // 进行中的局面既没有四连也没有下满
          if (gameStatus(next) === 'playing') {
            expect(winnerOf(next.board), note).toBeNull()
            expect(isFullBoard(next.board), note).toBe(false)
          }
          state = next
        }
        expect(state.moves, `${difficulty} seed=${seed}`).toBeGreaterThan(0)
        expect(gameStatus(state), `${difficulty} seed=${seed}`).not.toBe('playing')

        // 同一玩家动作序列重放：逐步与存档都完全一致（白方完全由 seed + 游标决定）
        let replay = connect4Game.create(seed, difficulty)
        for (const column of script) replay = reduceConnect4(replay, { type: 'drop', column })
        expect(encodeState(replay)).toEqual(encodeState(state))
      }
    }
  })

  it('同一局面 + 同一 (seed, 游标) → 同一着法；入门档不同种子会给出变化', () => {
    const board = createEmptyBoard()
    board[at(5, 3)] = BLACK
    const first = chooseOpponentMove('starter', board, 42, 0)
    expect(first).not.toBeNull()
    expect(landingIndex(board, first!)).not.toBeNull()
    expect(chooseOpponentMove('starter', board, 42, 0)).toBe(first)

    const picks = new Set<number>()
    for (let seed = 0; seed < 40; seed++) picks.add(chooseOpponentMove('starter', board, seed, 0)!)
    expect(picks.size).toBeGreaterThan(1)
    for (const pick of picks) expect(landingIndex(board, pick)).not.toBeNull()
  })

  it('游标变化即随机源变化：同一局面不同游标可给出不同应手（但每次都合法）', () => {
    const board = createEmptyBoard()
    board[at(5, 3)] = BLACK
    const picks = new Set<number>()
    for (let cursor = 0; cursor < 30; cursor++) {
      const pick = chooseOpponentMove('starter', board, 7, cursor)
      expect(pick).not.toBeNull()
      expect(validColumns(board)).toContain(pick)
      picks.add(pick!)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('三档难度在多组种子上都返回未满的列，且整局可复现', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [3, 11, 2024]) {
        let state = connect4Game.create(seed, difficulty)
        for (let ply = 0; ply < 10 && gameStatus(state) === 'playing'; ply++) {
          const column = playerColumns(state)[seed % playerColumns(state).length]!
          const before = state.board
          state = reduceConnect4(state, { type: 'drop', column })
          const turn = state.history[state.history.length - 1]!
          if (turn.white !== null) {
            expect(landingIndex(before, turn.white % 7), `${difficulty}/${seed}`).not.toBeNull()
          }
        }
        // 再走一遍完全相同的玩家动作序列，结果必须逐字节一致
        let replay = connect4Game.create(seed, difficulty)
        for (const turn of state.history) {
          replay = reduceConnect4(replay, { type: 'drop', column: turn.black % 7 })
        }
        expect(encodeState(replay)).toEqual(encodeState(state))
      }
    }
  })
})

describe('三档难度的战术行为', () => {
  it('熟练/挑战档：自己一手能成四时必下成四列', () => {
    const board = createEmptyBoard()
    for (const index of [at(5, 0), at(5, 1), at(5, 2)]) board[index] = WHITE
    board[at(5, 6)] = BLACK
    expect(winningColumns(board, WHITE)).toEqual([3])
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 1, 2, 3, 4]) {
        expect(chooseOpponentMove(difficulty, board, seed, 0), `${difficulty} seed=${seed}`).toBe(3)
      }
    }
  })

  it('熟练/挑战档：对手（黑）有成四列时必须去堵', () => {
    const board = createEmptyBoard()
    for (const index of [at(5, 0), at(5, 1), at(5, 2)]) board[index] = BLACK
    board[at(5, 6)] = WHITE
    expect(winningColumns(board, BLACK)).toEqual([3])
    expect(winningColumns(board, WHITE)).toEqual([])
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 1, 2, 3, 4]) {
        expect(chooseOpponentMove(difficulty, board, seed, 0), `${difficulty} seed=${seed}`).toBe(3)
      }
    }
  })

  it('竖排成四的威胁同样会被堵（自下而上补第四子）', () => {
    const board = createEmptyBoard()
    for (const row of [3, 4, 5]) board[at(row, 2)] = BLACK
    expect(winningColumns(board, BLACK)).toEqual([2])
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 1, 2]) {
        expect(chooseOpponentMove(difficulty, board, seed, 0), `${difficulty} seed=${seed}`).toBe(2)
      }
    }
  })

  it('斜向成四的威胁也会被堵', () => {
    const board = createEmptyBoard()
    for (const index of [at(2, 0), at(3, 1), at(4, 2)]) board[index] = BLACK
    expect(winningColumns(board, BLACK)).toEqual([3])
    for (const difficulty of ['skilled', 'challenging'] as const) {
      expect(chooseOpponentMove(difficulty, board, 1, 0)).toBe(3)
    }
  })

  it('三档难度都返回空点，入门档也只给未满的列', () => {
    const board = boardOf([
      '.......',
      '.......',
      '.......',
      '...W...',
      '..WW...',
      'BBBWB..',
    ])
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 12; seed++) {
        const pick = chooseOpponentMove(difficulty, board, seed, seed % 5)
        expect(pick, `${difficulty} seed=${seed}`).not.toBeNull()
        expect(board[landingIndex(board, pick!)!]).toBe(EMPTY)
        expect(columnFull(board, pick!)).toBe(false)
      }
    }
  })

  it('盘面无未满列时返回 null（调用方不会走到，但接口要自洽）', () => {
    const board = createEmptyBoard()
    board.fill(WHITE)
    for (const difficulty of DIFFICULTY_IDS) {
      expect(chooseOpponentMove(difficulty, board, 1, 0)).toBeNull()
    }
  })
})

describe('评估函数与前瞻层数', () => {
  it('空盘评估为 0；白方占优为正、黑方占优为负', () => {
    expect(evaluate(createEmptyBoard())).toBe(0)
    const whiteAdvantage = createEmptyBoard()
    for (const index of [at(5, 3), at(5, 4), at(5, 5)]) whiteAdvantage[index] = WHITE
    expect(evaluate(whiteAdvantage)).toBeGreaterThan(0)
    const blackAdvantage = createEmptyBoard()
    for (const index of [at(5, 3), at(5, 4), at(5, 5)]) blackAdvantage[index] = BLACK
    expect(evaluate(blackAdvantage)).toBeLessThan(0)
  })

  it('前瞻层数始终落在需求要求的 3~4 层内', () => {
    expect(lookaheadDepth(createEmptyBoard())).toBe(3)
    for (const columns of [0, 1, 2, 3, 4, 5]) {
      const depth = lookaheadDepth(columnsFilledBoard(columns))
      expect([3, 4], `filled=${columns}`).toContain(depth)
    }
    // 可落子的列变少（至少两列已满）时自动加深一层
    expect(lookaheadDepth(columnsFilledBoard(2))).toBe(4)
    expect(lookaheadDepth(columnsFilledBoard(1))).toBe(3)
    expect(lookaheadDepth(crowdedState(20).board)).toBe(4)
    expect(lookaheadDepth(crowdedState(2).board)).toBe(3)
  })
})

describe('平局棋谱夹具自检', () => {
  it('crowdedState 是一条真实棋谱：每一步都没有四连，铺满即平局', () => {
    const full = crowdedState(21)
    expect(isFull(full.board)).toBe(true)
    expect(winnerOf(full.board)).toBeNull()
    expect(countOf(full.board, BLACK)).toBe(21)
    expect(countOf(full.board, WHITE)).toBe(21)
    expect(full.moves).toBe(21)
    expect(full.rngCursor).toBe(21)

    // 任意前缀都必须还能继续下（既没有四连也没有下满）
    for (let turns = 1; turns < 21; turns++) {
      const prefix = crowdedState(turns)
      expect(winnerOf(prefix.board), `turns=${turns}`).toBeNull()
      expect(gameStatus(prefix), `turns=${turns}`).toBe('playing')
      expect(countOf(prefix.board, BLACK), `turns=${turns}`).toBe(turns)
      expect(countOf(prefix.board, WHITE), `turns=${turns}`).toBe(turns)
    }
    // 开局几步时所有列都还开着
    const early = crowdedState(2)
    expect(gameStatus(early)).toBe('playing')
    expect(validColumns(early.board)).toHaveLength(7)
  })
})

describe('性能与随机源', () => {
  it('挑战档单次应手 < 500ms（中盘与残局各测）', () => {
    for (const turns of [2, 10, 20]) {
      let state = crowdedState(turns, 'challenging')
      let worst = 0
      for (let ply = 0; ply < 3 && gameStatus(state) === 'playing'; ply++) {
        const column = playerColumns(state)[0]!
        const start = performance.now()
        state = reduceConnect4(state, { type: 'drop', column })
        worst = Math.max(worst, performance.now() - start)
      }
      expect(worst, `turns=${turns}`).toBeLessThan(500)
    }
  })

  it('规则层从不使用 Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    for (const difficulty of DIFFICULTY_IDS) {
      let state = connect4Game.create(7, difficulty)
      for (let ply = 0; ply < 8 && gameStatus(state) === 'playing'; ply++) {
        state = reduceConnect4(state, { type: 'drop', column: playerColumns(state)[0]! })
      }
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('难度 id 越界会被拒绝，不同难度互不串味', () => {
    expect(connect4Game.create(1, 'skilled').difficulty).toBe('skilled')
    expect(() => connect4Game.create(1, 'impossible')).toThrow()
    for (const difficulty of DIFFICULTY_IDS) {
      const state = connect4Game.create(5, difficulty)
      expect(state.difficulty).toBe(difficulty)
      expect(countStones(state.board).empty).toBe(42)
    }
    // 白方强度只影响选点，不影响状态结构：三档难度下计数不变量都成立
    for (const difficulty of DIFFICULTY_IDS) {
      let state = connect4Game.create(2024, difficulty)
      for (const column of [0, 1, 2]) state = reduceConnect4(state, { type: 'drop', column })
      expect(countOf(state.board, BLACK)).toBe(state.moves)
      expect(countOf(state.board, WHITE)).toBe(state.rngCursor)
    }
  })

  it('chooseOpponentMove 返回值类型是列号而不是格子索引', () => {
    const board = createEmptyBoard()
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 8; seed++) {
        const column = chooseOpponentMove(difficulty, board, seed, 0)
        expect(column, `${difficulty} seed=${seed}`).not.toBeNull()
        expect(Number.isInteger(column)).toBe(true)
        expect(column!).toBeGreaterThanOrEqual(0)
        expect(column!).toBeLessThan(7)
      }
    }
  })
})
