/**
 * 规则层测试：走子/吃子/连跳、强制吃子、升王、白方自动应手、撤销一整回合、判负与存档校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  BLACK,
  BLACK_KING,
  BLACK_MAN,
  DRAW_PLIES,
  EMPTY,
  WHITE,
  captureMovesFrom,
  checkersGame,
  countPieces,
  createState,
  encodeState,
  gameStatus,
  indexOf,
  legalActions,
  outcomeOf,
  reduceCheckers,
  selectAction,
  type CheckersAction,
  type CheckersState,
} from '../src/index.js'
import { boardFromRows, fixtureState, fresh } from './helpers.js'

/** 取当前第一个合法着法动作 */
function firstMove(state: CheckersState): { type: 'move'; from: number; to: number } {
  const action = legalActions(state).find(
    (item): item is { type: 'move'; from: number; to: number } => item.type === 'move',
  )
  if (!action) throw new Error('no legal move')
  return action
}

/** 某个动作是不是吃子 */
function isCapture(state: CheckersState, move: { from: number; to: number }): boolean {
  return captureMovesFrom(state.board, move.from).some((candidate) => candidate.to === move.to)
}

function roundTrip(raw: unknown): CheckersState {
  return checkersGame.decode(raw)
}

describe('起始状态与白方应手', () => {
  it('起始：黑先手、双方各 12 子、日志为空', () => {
    const state = fresh()
    expect(state.turn).toBe(BLACK)
    expect(countPieces(state.board)).toEqual({ black: 12, white: 12, blackKings: 0, whiteKings: 0 })
    expect(state.moves).toBe(0)
    expect(state.log).toHaveLength(0)
    expect(state.rngCursor).toBe(0)
    expect(gameStatus(state)).toBe('playing')
  })

  it('黑方走一步后白方自动应手，把控制权交回黑方（一次 reduce 走完一整个回合）', () => {
    const state = fresh(20240607, 'starter')
    const move = firstMove(state)
    const next = reduceCheckers(state, move)
    expect(next.board[move.from]).toBe(EMPTY)
    expect(next.board[move.to]).toBe(BLACK_MAN)
    expect(next.turn).toBe(BLACK)
    expect(next.moves).toBe(1)
    expect(next.rngCursor).toBe(1)
    // 玩家一步 + 白方应手至少一步；起始局面双方都只能走子，所以无进展回合数是 2
    expect(next.log.length).toBeGreaterThanOrEqual(2)
    expect(next.noProgressPlies).toBe(2)
  })
})

describe('强制吃子', () => {
  const board = boardFromRows(['........', '..w.....', '.b......', '........', '........', '..w.....'])

  it('有吃子时走子非法（抛 IllegalActionError）', () => {
    const state = fixtureState(board)
    expect(() =>
      reduceCheckers(state, { type: 'move', from: indexOf(2, 1), to: indexOf(1, 0) }),
    ).toThrow(IllegalActionError)
  })

  it('吃子合法：跳过敌子落到其后空格，并移除被跳过的棋子（底线升王）', () => {
    const state = fixtureState(board)
    const next = reduceCheckers(state, { type: 'move', from: indexOf(2, 1), to: indexOf(0, 3) })
    expect(next.board[indexOf(2, 1)]).toBe(EMPTY)
    expect(next.board[indexOf(1, 2)]).toBe(EMPTY)
    expect(next.board[indexOf(0, 3)]).toBe(BLACK_KING)
    expect(next.moves).toBe(1)
    // 白方还有一子，应手之后控制权回到黑方
    expect(next.turn).toBe(BLACK)
    expect(next.rngCursor).toBe(1)
  })

  it('斜走 / 隔一格 / 落点有子 都抛 IllegalActionError', () => {
    const state = fixtureState(board)
    for (const to of [indexOf(0, 1), indexOf(1, 2), indexOf(3, 0)]) {
      expect(() => reduceCheckers(state, { type: 'move', from: indexOf(2, 1), to }), String(to)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('连跳（pendingFrom 由状态记录，壳层不感知）', () => {
  /** 黑兵 (4,1) 连吃 (3,2)、(1,4) 到 (0,5)；另有黑兵 (6,1) 与白兵 (6,3) 让对局继续 */
  const board = boardFromRows([
    '........',
    '....w...',
    '........',
    '..w.....',
    '.b......',
    '........',
    '.b.w....',
  ])

  it('第一跳后进入连跳：只能继续用这枚棋子吃，选中/别的子都不行', () => {
    const state = fixtureState(board)
    const mid = reduceCheckers(state, { type: 'move', from: indexOf(4, 1), to: indexOf(2, 3) })
    expect(mid.pendingFrom).toBe(indexOf(2, 3))
    expect(mid.moves).toBe(0)
    expect(mid.log).toHaveLength(1)
    // 连跳途中还是兵，不升级
    expect(mid.board[indexOf(2, 3)]).toBe(BLACK_MAN)
    // 换别的棋子走 → 非法
    expect(() =>
      reduceCheckers(mid, { type: 'move', from: indexOf(6, 1), to: indexOf(5, 0) }),
    ).toThrow(IllegalActionError)
    // 走一个不是吃子的落点 → 非法
    expect(() =>
      reduceCheckers(mid, { type: 'move', from: indexOf(2, 3), to: indexOf(1, 2) }),
    ).toThrow(IllegalActionError)
    // 连跳途中不能改选
    expect(() => reduceCheckers(mid, { type: 'select', index: indexOf(6, 1) })).toThrow(
      IllegalActionError,
    )
  })

  it('继续吃掉第二子后回合结束并升王，白方应手后回到黑方', () => {
    const state = fixtureState(board)
    const mid = reduceCheckers(state, { type: 'move', from: indexOf(4, 1), to: indexOf(2, 3) })
    const done = reduceCheckers(mid, { type: 'move', from: indexOf(2, 3), to: indexOf(0, 5) })
    expect(done.pendingFrom).toBeNull()
    expect(done.board[indexOf(0, 5)]).toBe(BLACK_KING)
    expect(done.board[indexOf(1, 4)]).toBe(EMPTY)
    expect(done.moves).toBe(1)
    expect(done.log).toHaveLength(3)
    expect(done.turn).toBe(BLACK)
  })
})

describe('升王与王的能力', () => {
  it('兵走到对方底线升王', () => {
    // 场上必须还有白子，否则会被判「对方子被吃光」而直接结束
    const promote = fixtureState(
      boardFromRows(['........', 'b.......', '........', '........', '.w......']),
    )
    const next = reduceCheckers(promote, { type: 'move', from: indexOf(1, 0), to: indexOf(0, 1) })
    expect(next.board[indexOf(0, 1)]).toBe(BLACK_KING)
  })

  it('王可以前后走、也可以向后吃', () => {
    const king = fixtureState(boardFromRows(['........', '........', '.w......', '..B.....', '.w......']))
    const captures = captureMovesFrom(king.board, indexOf(3, 2)).map((move) => move.to)
    // 向前吃（跳过 (2,1) 到 (1,0)）与向后吃（跳过 (4,1) 到 (5,0)）都要有
    expect(captures).toContain(indexOf(1, 0))
    expect(captures).toContain(indexOf(5, 0))
  })
})

describe('胜负判定', () => {
  it('对方子被吃光 → won；自己子被吃光 → lost', () => {
    const blackOnly = fixtureState(boardFromRows(['........', 'b.......']))
    expect(gameStatus(blackOnly)).toBe('won')
    expect(outcomeOf(blackOnly)).toBe('won')
    const whiteOnly = fixtureState(boardFromRows(['.w......']))
    expect(gameStatus(whiteOnly)).toBe('lost')
    expect(outcomeOf(whiteOnly)).toBe('lost')
  })

  it('轮到谁走却无子可动 → 该方负', () => {
    // 黑兵在底线（(0,1)），无法再前进；双方都还有子，所以不是「吃光」
    expect(gameStatus(fixtureState(boardFromRows(['.b.w....'])))).toBe('lost')
    // 白兵在底线 (7,0)，轮到白走同样无子可动
    const whiteStuck = boardFromRows([
      '........',
      '........',
      '........',
      '........',
      '........',
      'b.......',
      '........',
      'w.......',
    ])
    expect(gameStatus(fixtureState(whiteStuck, { turn: WHITE }))).toBe('won')
  })

  it('长时间无吃子/升王 → 判和（三态里并入 won，结果页显示和棋）', () => {
    const board = boardFromRows(['........', '........', '.b......', '........', '.w......'])
    const state = fixtureState(board, { noProgressPlies: DRAW_PLIES - 1 })
    const next = reduceCheckers(state, { type: 'move', from: indexOf(2, 1), to: indexOf(1, 0) })
    expect(next.noProgressPlies).toBeGreaterThanOrEqual(DRAW_PLIES)
    expect(gameStatus(next)).toBe('won')
    expect(outcomeOf(next)).toBe('draw')
  })
})

describe('撤销与重开', () => {
  it('撤销一整回合：玩家一步 + 白方应手一起退回', () => {
    const start = fresh(4242, 'starter')
    const before = encodeState(start)
    const played = reduceCheckers(start, firstMove(start))
    expect(played.moves).toBe(1)
    const undone = reduceCheckers(played, { type: 'undo' })
    expect(encodeState(undone)).toEqual(before)
  })

  it('连跳中途撤销能回退到回合开始（真实对局里找出一次连跳，并顺带验证连跳中的存档往返）', () => {
    let found = false
    for (let seed = 0; seed < 30 && !found; seed++) {
      let state = createState(seed, 'starter')
      for (let turn = 0; turn < 120; turn++) {
        if (gameStatus(state) !== 'playing') break
        const turnStart = encodeState(state)
        const moves = legalActions(state).filter(
          (item): item is { type: 'move'; from: number; to: number } => item.type === 'move',
        )
        if (moves.length === 0) break
        const capture = moves.find((move) => isCapture(state, move))
        state = reduceCheckers(state, capture ?? moves[0]!)
        if (state.pendingFrom !== null) {
          // 连跳中的状态也必须能严格往返
          expect(roundTrip(encodeState(state))).toEqual(state)
          const undone = reduceCheckers(state, { type: 'undo' })
          expect(encodeState(undone)).toEqual(turnStart)
          found = true
          break
        }
      }
    }
    expect(found).toBe(true)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceCheckers(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到起始局面', () => {
    const start = fresh(777, 'skilled')
    const played = reduceCheckers(start, firstMove(start))
    const restarted = reduceCheckers(played, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(start))
  })
})

describe('选中与 selectAction', () => {
  it('选中自己的棋子、再点取消；点空格或对方棋子清除选中', () => {
    const state = fresh()
    const own = indexOf(5, 0)
    const selected = reduceCheckers(state, { type: 'select', index: own })
    expect(selected.selected).toBe(own)
    expect(reduceCheckers(selected, { type: 'select', index: own }).selected).toBeNull()
    expect(reduceCheckers(selected, { type: 'select', index: indexOf(4, 1) }).selected).toBeNull()
    expect(reduceCheckers(selected, { type: 'select', index: indexOf(0, 1) }).selected).toBeNull()
    // 浅色格不能选
    expect(() => reduceCheckers(state, { type: 'select', index: indexOf(0, 0) })).toThrow(
      IllegalActionError,
    )
  })

  it('selectAction 四个分支：自己的子 → select；合法落点 → move；非法 → select；空格无选中 → null', () => {
    const state = fresh()
    expect(selectAction(state, indexOf(5, 0))).toEqual({ type: 'select', index: indexOf(5, 0) })
    expect(selectAction(state, indexOf(3, 0))).toBeNull()
    expect(selectAction(state, indexOf(0, 0))).toBeNull()

    const selected = reduceCheckers(state, { type: 'select', index: indexOf(5, 0) })
    expect(selectAction(selected, indexOf(4, 1))).toEqual({
      type: 'move',
      from: indexOf(5, 0),
      to: indexOf(4, 1),
    })
    // 不合法（而且不是自己的子）→ 改选/清除
    expect(selectAction(selected, indexOf(3, 2))).toEqual({ type: 'select', index: indexOf(3, 2) })
  })

  it('强制吃子时只提供吃子落点（不会给出必然抛错的位置）', () => {
    const board = boardFromRows([
      '........',
      '..w.....',
      '.b......',
      '........',
      '........',
      '........',
      '...b....',
    ])
    const state = fixtureState(board)
    const selected = reduceCheckers(state, { type: 'select', index: indexOf(2, 1) })
    // (1,0) 是几何上的走子落点，但强制吃子时它非法 → selectAction 不给 move
    expect(selectAction(selected, indexOf(1, 0))).toEqual({ type: 'select', index: indexOf(1, 0) })
    const action = selectAction(selected, indexOf(0, 3))
    expect(action).toEqual({ type: 'move', from: indexOf(2, 1), to: indexOf(0, 3) })
    expect(reduceCheckers(selected, action!).moves).toBe(1)
  })

  it('连跳中只提供后续吃子落点', () => {
    const board = boardFromRows(['........', '....w...', '........', '..w.....', '.b......'])
    const state = fixtureState(board)
    const mid = reduceCheckers(state, { type: 'move', from: indexOf(4, 1), to: indexOf(2, 3) })
    expect(selectAction(mid, indexOf(0, 5))).toEqual({
      type: 'move',
      from: indexOf(2, 3),
      to: indexOf(0, 5),
    })
    expect(selectAction(mid, indexOf(1, 2))).toBeNull()
    expect(selectAction(mid, indexOf(4, 1))).toBeNull()
  })

  it('每个 selectAction 返回的动作都能被 reduce 接受（真实对局连续走 12 步）', () => {
    let state = fresh(9, 'starter')
    let applied = 0
    for (let step = 0; step < 12; step++) {
      if (gameStatus(state) !== 'playing') break
      const action = legalActions(state).find(
        (item): item is { type: 'move'; from: number; to: number } => item.type === 'move',
      )
      if (!action) break
      if (state.pendingFrom !== null) {
        // 连跳中：直接点落点即可，不需要再选中
        const direct = selectAction(state, action.to)
        expect(direct).toEqual({ type: 'move', from: action.from, to: action.to })
        state = reduceCheckers(state, direct!)
      } else {
        const selected = selectAction(state, action.from)
        expect(selected).toEqual({ type: 'select', index: action.from })
        const withSelection = reduceCheckers(state, selected!)
        const move = selectAction(withSelection, action.to)
        expect(move).toEqual({ type: 'move', from: action.from, to: action.to })
        state = reduceCheckers(withSelection, move!)
      }
      applied += 1
    }
    expect(applied).toBeGreaterThan(0)
    expect(state.moves).toBeGreaterThan(0)
  })
})

describe('未知动作', () => {
  it('方向键 / 旧动作名明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceCheckers(state, { type: 'slide', dir: 'up' } as unknown as CheckersAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reduceCheckers(state, { type: 'nextLevel' } as unknown as CheckersAction),
    ).toThrow(IllegalActionError)
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态严格往返（含 JSON 往返）', () => {
    const start = fresh(2024, 'skilled')
    expect(roundTrip(encodeState(start))).toEqual(start)
    let state = start
    for (let turn = 0; turn < 3; turn++) state = reduceCheckers(state, firstMove(state))
    expect(state.moves).toBe(3)
    const decoded = roundTrip(encodeState(state))
    expect(decoded).toEqual(state)
    expect(encodeState(decoded)).toEqual(encodeState(state))
    expect(roundTrip(JSON.parse(JSON.stringify(encodeState(state))))).toEqual(state)
  })

  it('选中态随存档往返（选中不参与重放，但要保留）', () => {
    const start = fresh()
    const selected = reduceCheckers(start, { type: 'select', index: indexOf(5, 0) })
    const decoded = roundTrip(encodeState(selected))
    expect(decoded.selected).toBe(indexOf(5, 0))
    expect(decoded).toEqual(selected)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh(17, 'starter')
    played = reduceCheckers(played, firstMove(played))
    played = reduceCheckers(played, firstMove(played))
    const raw = encodeState(played) as {
      difficulty: string
      seed: number
      board: number[]
      turn: string
      pendingFrom: number | null
      selected: number | null
      moves: number
      rngCursor: number
      noProgressPlies: number
      lastMove: { from: number; to: number } | null
      log: Array<{ from: number; to: number }>
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      [],
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      // 棋盘：长度、取值、浅色格放子、棋子凭空变化
      { ...raw, board: 'nope' },
      { ...raw, board: raw.board.slice(0, raw.board.length - 1) },
      { ...raw, board: raw.board.map((piece, index) => (index === 0 ? 9 : piece)) },
      { ...raw, board: raw.board.map((piece, index) => (index === 0 ? 1 : piece)) },
      { ...raw, board: raw.board.map((piece, index) => (index === 1 ? 0 : piece)) },
      { ...raw, turn: 'green' },
      { ...raw, turn: 'white' },
      { ...raw, pendingFrom: 99 },
      { ...raw, pendingFrom: 1.5 },
      { ...raw, pendingFrom: indexOf(3, 0) },
      { ...raw, selected: 99 },
      { ...raw, selected: indexOf(0, 1) },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: raw.rngCursor + 1 },
      { ...raw, noProgressPlies: -1 },
      { ...raw, noProgressPlies: raw.noProgressPlies + 1 },
      { ...raw, lastMove: null },
      { ...raw, lastMove: { from: 99, to: 0 } },
      { ...raw, log: 'nope' },
      { ...raw, log: [] },
      { ...raw, log: [{ from: 99, to: 0 }] },
      { ...raw, log: raw.log.slice(0, raw.log.length - 1) },
      // 「白方连续两手」：重复白方那一步，重放时会被当成黑方的非法着法
      { ...raw, log: [raw.log[0]!, raw.log[1]!, raw.log[1]!] },
    ]
    for (const candidate of bad) {
      expect(
        () => roundTrip(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })
})
