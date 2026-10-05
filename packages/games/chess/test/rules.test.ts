/**
 * 规则层测试：初始局面、两拍式应手、走子合法性、将死/逼和/三次重复/50 回合/子力不足、
 * 易位与吃过路兵与升变、撤销、重开、合法动作集合、encode/decode 往返与坏数据。
 * 走子生成本身已由 perft.test.ts 用公开值交叉验证。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  BLACK,
  CASTLE_ALL,
  EMPTY,
  WHITE,
  chessGame,
  createState,
  encodeState,
  gameStatus,
  legalActions,
  outcomeOf,
  positionHash,
  reduceChess,
} from '../src/index.js'
import { at, boardOf, settle, stateOf } from './helpers.js'

describe('初始局面', () => {
  it('8×8 开局：白方先行、20 个合法动作、无历史无终局', () => {
    const state = createState(1, 'starter')
    expect(state.board).toHaveLength(64)
    expect(state.sideToMove).toBe(WHITE)
    expect(state.moves).toBe(0)
    expect(state.rngCursor).toBe(0)
    expect(state.lastMove).toBeNull()
    expect(state.history).toEqual([])
    expect(state.opponentPick).toBeNull()
    expect(gameStatus(state)).toBe('playing')
    expect(chessGame.view(state).result).toBeNull()
    const moves = legalActions(state).filter((a) => a.type === 'move')
    expect(moves).toHaveLength(20)
    expect(chessGame.tickMs!(state, 'starter')).toBeNull()
  })

  it('第一步走后：白方只落一手，黑方待应手（两拍 tick）', () => {
    const state = createState(1234, 'starter')
    const after = reduceChess(state, { type: 'move', from: at(6, 4), to: at(4, 4) }) // e2-e4
    expect(after.board[at(4, 4)]).toBe(WHITE * 8 + 6)
    expect(after.board[at(6, 4)]).toBe(EMPTY)
    expect(after.moves).toBe(1)
    expect(after.rngCursor).toBe(0)
    expect(after.history).toEqual([{ white: 3364, black: null }]) // from=52(6,4)<<6|to=36(4,4)
    expect(chessGame.tickMs!(after, 'starter')).toBe(450)
    const picked = reduceChess(after, { type: 'tick' })
    expect(picked.opponentPick).not.toBeNull()
    expect(picked.board).toEqual(after.board) // 第一拍盘面不动
    expect(chessGame.tickMs!(picked, 'starter')).toBe(500)
    const landed = settle(after)
    expect(landed.opponentPick).toBeNull()
    expect(landed.rngCursor).toBe(1)
    expect(landed.history[0]!.black).not.toBeNull()
    expect(landed.sideToMove).toBe(WHITE)
  })
})

describe('走子合法性与点选映射', () => {
  it('非法着法抛 IllegalActionError 且原状态不变', () => {
    const state = createState(5, 'starter')
    const snapshot = encodeState(state)
    expect(() => reduceChess(state, { type: 'move', from: at(6, 4), to: at(5, 5) })).toThrow(IllegalActionError)
    expect(() => reduceChess(state, { type: 'move', from: at(7, 3), to: at(5, 4) })).toThrow(IllegalActionError) // 后不能跳
    expect(() => reduceChess(state, { type: 'move', from: -1, to: 0 })).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(snapshot)
  })

  it('白方走后待应手期间不能再走（not-your-turn）', () => {
    let state = createState(5, 'starter')
    state = reduceChess(state, { type: 'move', from: at(6, 4), to: at(4, 4) })
    expect(() => reduceChess(state, { type: 'move', from: at(6, 3), to: at(4, 3) })).toThrow(IllegalActionError)
    const actions = legalActions(state).map((a) => a.type).filter((t, i, arr) => arr.indexOf(t) === i)
    expect(actions).toEqual(['tick', 'undo', 'restart'])
  })

  it('select 只能选自己的白子', () => {
    const state = createState(1, 'starter')
    const selected = reduceChess(state, { type: 'select', index: at(7, 4) })
    expect(selected.selected).toBe(at(7, 4))
    expect(() => reduceChess(state, { type: 'select', index: at(0, 4) })).toThrow(IllegalActionError)
  })
})

describe('终局判定', () => {
  it('傻子将杀终局（手摆）：Qh4 将死白王 → 玩家输', () => {
    // 1.f3 e5 2.g4 Qh4# 的终局：白王 e1 无路可走（e2 被自己的兵挡着，f2/g3 被后攻击）
    const board = boardOf([
      'rnb1kbnr',
      'pppp1ppp',
      '8',
      '4p3',
      '6Pq',
      '5P2',
      'PPPPP2P',
      'RNBQKBNR',
    ])
    const state = stateOf(board, WHITE, { castling: 0 })
    expect(gameStatus(state)).toBe('lost')
    expect(chessGame.view(state).result!.titleKey).toBe('chess.lost.title')
    expect(chessGame.outcomeOf!(state)).toBe('lost')
  })

  it('逼和是平局：黑王 a8、白王 c6、白后 b6、轮黑走 → 无子可动且未被将', () => {
    const board = boardOf(['k7', '8', '1QK5', '8', '8', '8', '8', '8'])
    const state = stateOf(board, BLACK, { castling: 0 })
    expect(outcomeOf(state)).toBe('draw')
    expect(gameStatus(state)).toBe('won') // GameStatus 映射
    expect(chessGame.outcomeOf!(state)).toBe('draw') // 战绩钩子说真话
    expect(chessGame.view(state).result!.titleKey).toBe('chess.draw.title')
  })

  it('三次重复局面判和', () => {
    const board = boardOf(['k7', '8', '1QK5', '8', '8', '8', '8', '8'])
    const hash = positionHash(board, BLACK, CASTLE_ALL, null)
    const state = stateOf(board, BLACK, { castling: 0, repetition: [hash, hash, hash] })
    expect(outcomeOf(state)).toBe('draw')
  })

  it('50 回合规则判和（halfmoveClock = 100）', () => {
    const board = boardOf(['k7', '8', '1QK5', '8', '8', '8', '8', '8'])
    const state = stateOf(board, BLACK, { castling: 0, halfmoveClock: 100 })
    expect(outcomeOf(state)).toBe('draw')
  })

  it('子力不足判和：王 vs 王', () => {
    const board = boardOf(['k7', '8', '8', '8', '8', '8', '8', 'K7'])
    const state = stateOf(board, BLACK, { castling: 0 })
    expect(outcomeOf(state)).toBe('draw')
  })
})

describe('易位 / 吃过路兵 / 升变（规则层走通）', () => {
  it('白方王翼易位：王 g1、车 f1、王翼易位权清掉', () => {
    const board = boardOf(['r3k2r', '8', '8', '8', '8', '8', '8', 'R3K2R'])
    const state = stateOf(board, WHITE, { castling: CASTLE_ALL })
    const after = reduceChess(state, { type: 'move', from: at(7, 4), to: at(7, 6) })
    expect(after.board[at(7, 6)]).toBe(WHITE * 8 + 1)
    expect(after.board[at(7, 5)]).toBe(WHITE * 8 + 3)
    expect(after.board[at(7, 7)]).toBe(EMPTY)
    expect(after.castling & 1).toBe(0)
    expect(after.castling & 2).toBe(0)
    expect(after.castling & 4).toBe(CASTLE_ALL & 4) // 黑方权不动
  })

  it('吃过路兵：白兵 e5 吃到 f6，f5 黑兵被移走', () => {
    const board = boardOf(['k6K', '8', '8', '4Pp2', '8', '8', '8', '8'])
    const state = stateOf(board, WHITE, { castling: 0, epSquare: at(2, 5) })
    const after = reduceChess(state, { type: 'move', from: at(3, 4), to: at(2, 5) })
    expect(after.board[at(2, 5)]).toBe(WHITE * 8 + 6)
    expect(after.board[at(3, 5)]).toBe(EMPTY)
  })

  it('升变：白兵 a7→a8 自动变后', () => {
    const board = boardOf(['7k', 'P7', '8', '8', '8', '8', '8', '7K'])
    const state = stateOf(board, WHITE, { castling: 0 })
    const after = reduceChess(state, { type: 'move', from: at(1, 0), to: at(0, 0) })
    expect(after.board[at(0, 0)]).toBe(WHITE * 8 + 2)
  })
})

describe('撤销与重开', () => {
  it('撤销一整回合：玩家与黑方两手一起退回', () => {
    let state = createState(2024, 'skilled')
    const first = settle(reduceChess(state, { type: 'move', from: at(6, 4), to: at(4, 4) }))
    const second = settle(reduceChess(first, { type: 'move', from: at(6, 3), to: at(4, 3) }))
    const undone = reduceChess(second, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(first))
    expect(undone.moves).toBe(1)
    expect(undone.rngCursor).toBe(1)
  })

  it('连撤到开局等于初始状态；重开回到同种子同难度', () => {
    let state = createState(77, 'starter')
    for (let ply = 0; ply < 3; ply++) {
      state = settle(reduceChess(state, { type: 'move', from: legalActions(state).find((a) => a.type === 'move' && 'from' in a) ? (legalActions(state).find((a) => a.type === 'move') as { from: number }).from : at(6, 4), to: (legalActions(state).find((a) => a.type === 'move') as { to: number }).to }))
    }
    while (state.history.length > 0) state = reduceChess(state, { type: 'undo' })
    expect(encodeState(state)).toEqual(encodeState(createState(77, 'starter')))
  })

  it('没有历史时撤销报错', () => {
    expect(() => reduceChess(createState(1, 'starter'), { type: 'undo' })).toThrow(IllegalActionError)
  })
})

describe('encode / decode', () => {
  it('中途状态往返一致，解码后可以接着下', () => {
    let state = createState(4242, 'challenging')
    for (let ply = 0; ply < 4; ply++) {
      const move = legalActions(state).find((a) => a.type === 'move') as { type: 'move'; from: number; to: number }
      state = settle(reduceChess(state, move))
    }
    const decoded = chessGame.decode(JSON.parse(JSON.stringify(chessGame.encode(state))))
    expect(decoded).toEqual(state)
    const move = legalActions(decoded).find((a) => a.type === 'move') as { type: 'move'; from: number; to: number }
    expect(encodeState(reduceChess(decoded, move))).toEqual(encodeState(reduceChess(state, move)))
  })

  it('待应手中间态（含 opponentPick）也能往返', () => {
    let state = createState(7, 'skilled')
    state = reduceChess(state, { type: 'move', from: at(6, 4), to: at(4, 4) })
    state = reduceChess(state, { type: 'tick' }) // 第一拍：opponentPick 已选
    expect(state.opponentPick).not.toBeNull()
    const decoded = chessGame.decode(JSON.parse(JSON.stringify(chessGame.encode(state))))
    expect(decoded).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let state = createState(3, 'starter')
    state = settle(reduceChess(state, { type: 'move', from: at(6, 4), to: at(4, 4) }))
    const raw = chessGame.encode(state) as Record<string, unknown>
    const bad: unknown[] = [
      null, undefined, 42, 'state', [], {},
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, board: (raw.board as number[]).slice(0, 63) },
      { ...raw, board: (raw.board as number[]).map((c, i) => (i === 0 ? 99 : c)) },
      { ...raw, moves: 2 },
      { ...raw, sideToMove: 1 },
      { ...raw, history: [] },
      { ...raw, castling: 99 },
      { ...raw, opponentPick: 0 },
      { ...raw, lastMove: 9999 },
    ]
    for (const candidate of bad) {
      expect(() => chessGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 80)).toThrow(IllegalActionError)
    }
  })
})

describe('GameDef 契约', () => {
  it('元信息与两拍/对手语义声明', () => {
    expect(chessGame.id).toBe('chess')
    expect(chessGame.rulesVersion).toBe(1)
    expect(chessGame.i18nNamespace).toBe('chess')
    expect(chessGame.illegalNoticeKey).toBe('chess.illegal.notice')
    expect(chessGame.difficulties.map((d) => d.id)).toEqual(['starter', 'skilled', 'challenging'])
    expect(typeof chessGame.tickMs).toBe('function')
    expect(chessGame.tickActor).toBe('opponent')
    expect(typeof chessGame.outcomeOf).toBe('function')
    expect(chessGame.contentId!(chessGame.create(1, 'challenging'))).toBe('challenging')
  })
})
