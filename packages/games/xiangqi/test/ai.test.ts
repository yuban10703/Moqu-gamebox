/**
 * 对手（黑方）策略测试：合法性、确定性、三档难度的战术行为、纯函数性、耗时。
 *
 * 「黑方每一步都合法」由两条独立路径复核：
 * 1. 重放整局，把黑方应手放到「红方走完之后的那个局面」里，检查它确实在合法着法集合里；
 * 2. 再用 helpers 的独立实现 `kingKeepsSafe` 复核走完后黑方自己不被将军。
 *
 * 性能只**测量并打印**，不写死时间断言（规格要求：实现要高效，但断言不绑机器）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createRng } from '@eink/core'
import {
  BLACK,
  DIFFICULTY_IDS,
  MATE_SCORE,
  RED,
  applyMove,
  challengingDepth,
  chooseMove,
  chooseOpponentMove,
  createInitialBoard,
  evaluate,
  gameStatus,
  isKingInCheck,
  legalMoves,
  makePiece,
  moveFrom,
  moveTo,
  occurrenceCount,
  packMove,
  reduceXiangqi,
  xiangqiGame,
  type DifficultyId,
  type XiangqiState,
} from '../src/index.js'
import { at, blankBoard, boardOf, kingAttacked, moveKeepsKingSafe, settle } from './helpers.js'

/** 红方随机走、黑方由被测 AI 应手，一直走到终局或步数上限；返回终局状态 */
function playGame(seed: number, difficulty: DifficultyId, playerSeed: number): XiangqiState {
  const rng = createRng(playerSeed)
  let state = xiangqiGame.create(seed, difficulty)
  for (let ply = 0; ply < 200 && gameStatus(state) === 'playing'; ply++) {
    const redMoves = legalMoves(state.board, RED)
    if (redMoves.length === 0) break
    const move = redMoves[rng.int(redMoves.length)] as number
    const before = state.board.slice()
    const history = state.history
    const afterMove = reduceXiangqi(state, { type: 'move', from: moveFrom(move), to: moveTo(move) })
    // AI 应手由壳层分两拍派发（先选中、500ms 后落子）：测试里用 settle 一次推完
    const next = settle(afterMove)
    const turn = next.history[next.history.length - 1]!
    const afterRed = before.slice()
    applyMove(afterRed, move)
    const note = `${difficulty} seed=${seed} ply=${ply}`
    if (turn.black === null) {
      // 没有应手只能有一个解释：红方这一手已经终结对局（黑方无子可动 / 三次重复判和）
      const stuck = legalMoves(afterRed, BLACK).length === 0
      const drawn = occurrenceCount(afterRed, BLACK, history) + 1 >= 3
      expect(stuck || drawn, note).toBe(true)
    } else {
      expect(legalMoves(afterRed, BLACK), note).toContain(turn.black)
      // 独立复核：黑方走完后自己不被将军，也没有照面
      expect(moveKeepsKingSafe(afterRed, BLACK, turn.black), note).toBe(true)
      const afterBlack = afterRed.slice()
      applyMove(afterBlack, turn.black)
      expect(kingAttacked(afterBlack, BLACK), note).toBe(false)
    }
    state = next
  }
  return state
}

/** 一步杀局面（黑方走）：黑车 (8,7)->(9,7) 即成杀 */
function mateInOneBoard(): number[] {
  return boardOf([
    '...k.....', // 黑将 (0,3)
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    'r......r.', // (8,0) 封 (8,4)；(8,7) 待杀
    '...AK....', // 红仕 (9,3)、红帅 (9,4)
  ])
}

/** 白吃局：红车悬空无保护，黑车可以白吃（+900） */
function hangingChariotBoard(): number[] {
  return boardOf([
    '...k.....',
    '.........',
    '.........',
    '.........',
    'r....R...', // (4,0) 黑车、(4,5) 红车（无人保护）
    '.........',
    '.........',
    '.........',
    '.........',
    '....K....', // 红帅 (9,4)
  ])
}

describe('三档难度都只走合法着法', () => {
  it('随机对局走到终局：黑方每一手都在当时的合法着法里，且不送将', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [1, 8, 21]) {
        const state = playGame(seed, difficulty, seed * 17 + 3)
        // 不要求一定分出胜负（随机走也可能被拖到 200 步上限），但状态必须自洽
        expect(state.moves).toBe(state.history.length)
        expect(encodeRoundTrip(state)).toBe(true)
      }
    }
  })

  it('至少有一局在随机玩家面前分出胜负（三档都能推进对局）', () => {
    let finished = 0
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [1, 8, 21]) {
        if (gameStatus(playGame(seed, difficulty, seed * 17 + 3)) !== 'playing') finished++
      }
    }
    expect(finished).toBeGreaterThan(0)
  })

  it('无子可动时返回 null（接口自洽，正常对局走不到）', () => {
    // 先把红方将死，再问「红方该怎么走」——三档都必须回答 null
    const board = mateInOneBoard()
    const after = board.slice()
    applyMove(after, packMove(at(8, 7), at(9, 7)))
    expect(legalMoves(after, RED)).toHaveLength(0)
    for (const difficulty of DIFFICULTY_IDS) {
      expect(chooseMove(difficulty, after, RED, 5, 0), difficulty).toBeNull()
    }
  })
})

describe('确定性与纯函数性', () => {
  it('同一 (局面, 难度, seed, 游标) → 同一着法；三档都不改传入的盘面', () => {
    const board = createInitialBoard()
    const snapshot = board.slice()
    for (const difficulty of DIFFICULTY_IDS) {
      const first = chooseOpponentMove(difficulty, board, 42, 0)
      const second = chooseOpponentMove(difficulty, board, 42, 0)
      expect(first, difficulty).toBe(second)
      expect(first).not.toBeNull()
      expect(legalMoves(board, BLACK)).toContain(first as number)
    }
    expect(board).toEqual(snapshot)
  })

  it('入门档：随机但在合法着法里，换种子/换游标会给出不同着法', () => {
    const board = createInitialBoard()
    const legal = new Set(legalMoves(board, BLACK))
    const picks = new Set<number>()
    for (let seed = 0; seed < 40; seed++) {
      const pick = chooseOpponentMove('starter', board, seed, 0) as number
      expect(legal.has(pick)).toBe(true)
      picks.add(pick)
    }
    expect(picks.size).toBeGreaterThan(1)

    const byCursor = new Set<number>()
    for (let cursor = 0; cursor < 40; cursor++) {
      const pick = chooseOpponentMove('starter', board, 7, cursor) as number
      expect(legal.has(pick)).toBe(true)
      byCursor.add(pick)
    }
    expect(byCursor.size).toBeGreaterThan(1)
  })

  it('同一难度同一局面重复调用结果一致；不同难度可以给出不同着法（但不是必须）', () => {
    const state = playGame(3, 'starter', 11)
    for (const difficulty of ['skilled', 'challenging'] as const) {
      const board = state.board
      const picks = new Set<number>()
      for (let repeat = 0; repeat < 3; repeat++) {
        picks.add(chooseOpponentMove(difficulty, board, 5, 2) as number)
      }
      expect(picks.size, difficulty).toBe(1)
    }
  })

  it('规则层与 AI 都不使用 Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    for (const difficulty of DIFFICULTY_IDS) {
      playGame(4, difficulty, 13)
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('三档难度的战术行为', () => {
  it('熟练/挑战档：一步杀局面里能找到杀棋（不要求入门档）', () => {
    const board = mateInOneBoard()
    // 先确认这确实是一步杀局面：存在一手让红方无子可动且被将军
    const mates = legalMoves(board, BLACK).filter((move) => {
      const after = board.slice()
      applyMove(after, move)
      return legalMoves(after, RED).length === 0 && isKingInCheck(after, RED)
    })
    expect(mates.length).toBeGreaterThan(0)

    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 1, 2, 3, 5]) {
        const chosen = chooseOpponentMove(difficulty, board, seed, 0) as number
        expect(chosen, `${difficulty} seed=${seed}`).not.toBeNull()
        const after = board.slice()
        applyMove(after, chosen)
        expect(legalMoves(after, RED).length, `${difficulty} seed=${seed} 没找到杀棋`).toBe(0)
        expect(isKingInCheck(after, RED)).toBe(true)
      }
    }
  })

  it('熟练/挑战档：能白吃悬空的车（子力估值起作用）', () => {
    const board = hangingChariotBoard()
    const capture = packMove(at(4, 0), at(4, 5))
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (const seed of [0, 2, 9]) {
        const chosen = chooseOpponentMove(difficulty, board, seed, 0)
        expect(chosen, `${difficulty} seed=${seed}`).toBe(capture)
      }
    }
    // 入门档不看估值：只保证合法
    const starter = chooseOpponentMove('starter', board, 0, 0) as number
    expect(legalMoves(board, BLACK)).toContain(starter)
  })

  it('挑战档搜索层数落在 2~3 之间（分支过大时退到 2 层）', () => {
    expect([2, 3]).toContain(challengingDepth(createInitialBoard(), BLACK))
    expect([2, 3]).toContain(challengingDepth(hangingChariotBoard(), BLACK))
  })

  it('评估函数：双方视角互为相反数，多一个车的一方为正', () => {
    const initial = createInitialBoard()
    // 双方视角互为相反数（注意 0 与 -0 的坑：相加判断而不是直接取负比较）
    expect(evaluate(initial, RED) + evaluate(initial, BLACK)).toBe(0)
    expect(Math.abs(evaluate(initial, RED))).toBeLessThan(60) // 开局基本均势

    const bare = blankBoard()
    bare[at(9, 4)] = makePiece(RED, 1)
    bare[at(0, 3)] = makePiece(BLACK, 1)
    const withRedChariot = bare.slice()
    withRedChariot[at(8, 0)] = makePiece(RED, 5)
    expect(evaluate(withRedChariot, RED)).toBeGreaterThan(evaluate(bare, RED))
    expect(evaluate(withRedChariot, BLACK)).toBeLessThan(evaluate(bare, BLACK))

    // 过河兵比没动过的兵值钱（位置项）
    const pawnBack = bare.slice()
    pawnBack[at(6, 4)] = makePiece(RED, 7)
    const pawnCrossed = bare.slice()
    pawnCrossed[at(3, 4)] = makePiece(RED, 7)
    expect(evaluate(pawnCrossed, RED)).toBeGreaterThan(evaluate(pawnBack, RED))
    // 将死分值远大于任何子力差
    expect(MATE_SCORE).toBeGreaterThan(100 * 900)
  })

  it('机动性计入评估：同子力、同马位，被堵住四条腿的马明显更差', () => {
    const bare = blankBoard()
    bare[at(9, 4)] = makePiece(RED, 1)
    bare[at(0, 3)] = makePiece(BLACK, 1)
    // 被憋住：四个黑卒正好占住 (5,4) 这匹马的四个马腿
    const blocked = bare.slice()
    blocked[at(5, 4)] = makePiece(RED, 4)
    for (const cell of [at(4, 4), at(6, 4), at(5, 3), at(5, 5)]) {
      blocked[cell] = makePiece(BLACK, 7)
    }
    // 同样的子力、同样的马位，只把 4 个黑卒挪到不挡路的地方（位置分几乎相同）
    const free = bare.slice()
    free[at(5, 4)] = makePiece(RED, 4)
    for (const cell of [at(4, 5), at(6, 5), at(5, 2), at(5, 6)]) {
      free[cell] = makePiece(BLACK, 7)
    }
    expect(evaluate(free, RED)).toBeGreaterThan(evaluate(blocked, RED))
  })
})

describe('耗时（只测量并打印，不做时间断言）', () => {
  it('三档单步决策耗时', () => {
    const board = createInitialBoard()
    const mid = mateInOneBoard()
    const measure = (label: string, run: () => unknown, runs: number): void => {
      // 预热一次，避免把首次 JIT 编译算进去
      run()
      const start = performance.now()
      for (let i = 0; i < runs; i++) run()
      const per = (performance.now() - start) / runs
      // eslint-disable-next-line no-console
      console.log(`[xiangqi] ${label}: ${per.toFixed(1)}ms/步`)
    }
    measure('starter 开局', () => chooseOpponentMove('starter', board, 3, 0), 50)
    measure('skilled 开局', () => chooseOpponentMove('skilled', board, 3, 0), 20)
    measure('challenging 开局', () => chooseOpponentMove('challenging', board, 3, 0), 20)
    measure('challenging 残局', () => chooseOpponentMove('challenging', mid, 3, 0), 20)
    measure('challenging 中局', () => {
      const state = playGame(9, 'starter', 5)
      return chooseOpponentMove('challenging', state.board, 3, 0)
    }, 10)
    expect(true).toBe(true)
  })
})

/** 存档往返是否稳定（AI 测试里也顺手守一条） */
function encodeRoundTrip(state: XiangqiState): boolean {
  const raw = xiangqiGame.encode(state)
  const decoded = xiangqiGame.decode(JSON.parse(JSON.stringify(raw)))
  return JSON.stringify(xiangqiGame.encode(decoded)) === JSON.stringify(raw)
}
