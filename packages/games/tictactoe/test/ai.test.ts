/**
 * 三档对手强度的行为断言。
 *
 * 每一档都要有**能区分它档位**的证词，否则「三档难度」只是三个名字：
 * - 入门：会看漏送上门的机会（所以玩家赢得了他）；也能偶尔抓住机会；
 * - 熟练：能赢就赢、该堵就堵、先中心后角；
 * - 挑战：随机乱下的玩家赢不了它，正着下的玩家也只能和棋（绝不输）。
 *
 * 摆盘用 ASCII（见 helpers.boardFrom），比日志直观；所有挑点都用固定种子，
 * 因此断言不会因为随机而闪断。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  CENTER,
  CORNERS,
  EMPTY,
  FIRST,
  SECOND,
  boardOf,
  chooseOpponentMove,
  bestMove,
  countMarks,
  emptyCells,
  outcomeOf,
  type Mark,
  type Side,
  type TictactoeState,
} from '../src/index.js'
import { boardFrom, playVsComputer, winner } from './helpers.js'

/** 后手（○）自己已经摆好两个、只差一格连线；先手（✕）也有威胁 */
const BOTH_THREATEN = ['...', 'OO.', 'XX.']
/** 只有先手（✕）有威胁：第一行 0/1 已连成两个，再下 2 就赢 */
const FIRST_THREATENS = ['XX.', '.O.', '...']

function legal(board: readonly Mark[], move: number | null): void {
  expect(move).not.toBeNull()
  expect(board[move!]).toBe(EMPTY)
}

function randomEmpty(board: readonly Mark[], rng: ReturnType<typeof createRng>): number {
  return rng.pick(emptyCells(board))
}

describe('入门档（starter）', () => {
  it('会看漏送到眼前的连线：对方只差一格就连线时，它并不总是去堵', () => {
    const board = boardFrom(FIRST_THREATENS)
    const moves = new Set<number>()
    for (let seed = 0; seed < 40; seed++) {
      const move = chooseOpponentMove('starter', board, SECOND, seed, 4)
      legal(board, move)
      moves.add(move!)
    }
    // 该堵的那一格是 2：随机落子只是偶尔撞上它，多数种子会放对手连成线
    expect(moves.has(2)).toBe(true)
    expect([...moves].some((move) => move !== 2)).toBe(true)
  })

  it('小概率抓成线：自己有一步取胜时，有些种子会抓住、有些会看漏', () => {
    const board = boardFrom(BOTH_THREATEN)
    let taken = 0
    let missed = 0
    for (let seed = 0; seed < 40; seed++) {
      const move = chooseOpponentMove('starter', board, SECOND, seed, 2)
      legal(board, move)
      if (move === 5) taken++
      else missed++
    }
    expect(taken).toBeGreaterThan(0)
    expect(missed).toBeGreaterThan(0)
  })

  it('乱下的代价：玩家抓着自己的连线走，就能在入门档身上赢下一局', () => {
    // ✕ 的策略：能连成线就连；不能就堵 ○ 的线；再不能就占中心 —— 一手不错的业余下法
    const greedyX = (state: TictactoeState): number => {
      const board = boardOf(state)
      const win = winningOf(board, FIRST)
      if (win !== null) return win
      const block = winningOf(board, SECOND)
      if (block !== null) return block
      if (board[CENTER] === EMPTY) return CENTER
      const empties = emptyCells(board)
      return empties[0]!
    }
    const results = new Set<string>()
    for (let seed = 0; seed < 30; seed++) {
      const final = playVsComputer('starter', seed, greedyX)
      const outcome = outcomeOf(final)
      expect(outcome).not.toBeNull()
      results.add(String(outcome))
    }
    // 30 个种子里一定有几局是玩家赢的（否则「入门会失误」无从谈起）
    expect(results.has('first')).toBe(true)
  })
})

/** 测试里自己写一份「一步取胜」的找法（不用生产代码的 winningMoves） */
function winningOf(board: readonly Mark[], side: Side): number | null {
  for (let index = 0; index < board.length; index++) {
    if (board[index] !== EMPTY) continue
    const next = board.slice()
    next[index] = side
    if (winner(next) === side) return index
  }
  return null
}

describe('熟练档（skilled）', () => {
  it('能赢就赢：一步取胜的格子直接走', () => {
    const board = boardFrom(BOTH_THREATEN)
    expect(chooseOpponentMove('skilled', board, SECOND, 12345, 3)).toBe(5)
  })

  it('该堵就堵：对方一步取胜时去堵那一格', () => {
    const board = boardFrom(FIRST_THREATENS)
    expect(chooseOpponentMove('skilled', board, SECOND, 12345, 3)).toBe(2)
  })

  it('没有战术目标时占中心，中心被占则占角', () => {
    const open = boardFrom(['X..', '...', '...'])
    expect(chooseOpponentMove('skilled', open, SECOND, 7, 1)).toBe(CENTER)

    const centered = boardFrom(['...', '.X.', '..O'])
    const move = chooseOpponentMove('skilled', centered, SECOND, 7, 3)
    expect(move).not.toBeNull()
    expect(CORNERS).toContain(move!)
    legal(centered, move)
  })

  it('永远不会下在已占用的格子上（随机走 60 局逐步复核）', () => {
    const rng = createRng(20261010)
    for (let seed = 0; seed < 60; seed++) {
      const final = playVsComputer('skilled', seed, (state) => randomEmpty(boardOf(state), rng))
      expect(outcomeOf(final)).not.toBeNull()
      /*
       * 每局都必须是「双方轮流在空格上落子」的合法棋局：
       * 应手若落在已占用的格子上，reduce 会直接抛错（上面的 playVsComputer 就会失败）；
       * 这里再复核手数关系 —— 先手要么与后手同数，要么多一手。
       */
      const counts = countMarks(boardOf(final))
      expect(counts.first - counts.second === 0 || counts.first - counts.second === 1).toBe(true)
    }
  })
})

describe('挑战档（challenging）', () => {
  it('绝不输：先手怎么乱下都赢不了它', () => {
    const rng = createRng(4242)
    const outcomes = new Set<string>()
    for (let seed = 0; seed < 60; seed++) {
      const final = playVsComputer('challenging', seed, (state) => randomEmpty(boardOf(state), rng))
      const outcome = outcomeOf(final)
      expect(outcome, `seed=${seed} 局面=${JSON.stringify(final.log)}`).not.toBe('first')
      outcomes.add(String(outcome))
    }
    // 它不只是「不输」：乱下的先手会被它反杀（说明它在主动找胜机，而不是一路求和）
    expect(outcomes.has('second')).toBe(true)
  })

  it('正着下也只能和棋：双方都用完整搜索时，先手赢不了', () => {
    for (let seed = 0; seed < 12; seed++) {
      const final = playVsComputer('challenging', seed, (state) => bestMove(boardOf(state), FIRST)!)
      expect(outcomeOf(final), `seed=${seed} 局面=${JSON.stringify(final.log)}`).toBe('draw')
    }
  })

  it('能赢就赢、该堵就堵', () => {
    const win = boardFrom(BOTH_THREATEN)
    expect(chooseOpponentMove('challenging', win, SECOND, 99, 3)).toBe(5)
    const block = boardFrom(FIRST_THREATENS)
    expect(chooseOpponentMove('challenging', block, SECOND, 99, 3)).toBe(2)
  })

  it('同种子同局面 → 同一手（结果只取决于局面、种子与游标）', () => {
    const board = boardFrom(['X..', '...', '..O'])
    for (const level of ['starter', 'skilled', 'challenging'] as const) {
      const first = chooseOpponentMove(level, board, SECOND, 314159, 5)
      const again = chooseOpponentMove(level, board, SECOND, 314159, 5)
      expect(again, level).toBe(first)
    }
  })

  it('提示给出的是正解：先手能连成线时提示那一格，绝不给废棋', () => {
    const board = boardFrom(['XX.', '.O.', 'O..'])
    expect(bestMove(board, FIRST)).toBe(2)
    // 后手在同一格既堵住先手、自己又连成斜线（2/4/6）—— 也是 2
    expect(bestMove(board, SECOND)).toBe(2)
  })
})
