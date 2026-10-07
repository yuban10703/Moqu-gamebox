/**
 * 规则层测试：初始局面、五连判胜（横/竖/两斜 + 被堵住不算胜）、落子后自动应手、
 * 非法落子、撤销一整回合、重开、合法动作集合。
 *
 * 「构造局面」类用例走 test/helpers.ts 的 ASCII 摆盘与 stateOf（自洽回合日志）；
 * 胜负结论同时用 helpers 的独立实现复核，避免自证。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  createState,
  encodeState,
  gameStatus,
  legalActions,
  makesFive,
  outcomeOf,
  reduceGomoku,
  selectAction,
  gomokuGame,
  type GomokuAction,
  type GomokuTurn,
} from '../src/index.js'
import {
  at,
  boardOf,
  countOf,
  emptyBoard,
  fillNoFiveBoard,
  playerMoves,
  stateOf,
  winnerOf,
  settle,
} from './helpers.js'

/** 横、竖、斜（↘）、反斜（↗）四条轴上的五连坐标 */
const FIVE_LINES: ReadonlyArray<{ name: string; cells: readonly number[] }> = [
  { name: 'horizontal', cells: [at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)] },
  { name: 'vertical', cells: [at(3, 7), at(4, 7), at(5, 7), at(6, 7), at(7, 7)] },
  { name: 'diagonal', cells: [at(3, 3), at(4, 4), at(5, 5), at(6, 6), at(7, 7)] },
  { name: 'anti-diagonal', cells: [at(10, 3), at(9, 4), at(8, 5), at(7, 6), at(6, 7)] },
]

function boardWith(cells: readonly number[], side: 1 | 2, extra: readonly number[] = []): ReturnType<typeof emptyBoard> {
  const board = emptyBoard()
  for (const index of extra) board[index] = side === BLACK ? WHITE : BLACK
  for (const index of cells) board[index] = side
  return board
}

describe('初始局面', () => {
  it('15×15 空盘、步数与游标为 0、无历史', () => {
    const state = createState(1, 'starter')
    expect(state.board).toHaveLength(CELLS)
    expect(state.board.every((stone) => stone === EMPTY)).toBe(true)
    expect(state.moves).toBe(0)
    expect(state.rngCursor).toBe(0)
    expect(state.lastMove).toBeNull()
    expect(state.history).toEqual([])
    expect(gameStatus(state)).toBe('playing')
    expect(gomokuGame.view(state).result).toBeNull()
  })

  it('天元（7,7）= 112 是合法落点，所有空格都算玩家可落点', () => {
    const state = createState(1, 'starter')
    expect(at(7, 7)).toBe(112)
    expect(selectAction(state, 112)).toEqual({ type: 'place', index: 112 })
    expect(playerMoves(state)).toHaveLength(CELLS)
  })
})

describe('五连判胜（横 / 竖 / 两斜）', () => {
  for (const line of FIVE_LINES) {
    it(`${line.name}：黑方五连即胜`, () => {
      const board = boardWith(line.cells, BLACK)
      // 生产实现与独立实现必须一致
      for (const index of line.cells) expect(makesFive(board, index, BLACK), `index ${index}`).toBe(true)
      expect(winnerOf(board)).toBe(BLACK)
      expect(outcomeOf(board)).toBe('black')
    })

    it(`${line.name}：白方五连即白胜`, () => {
      const board = boardWith(line.cells, WHITE)
      expect(winnerOf(board)).toBe(WHITE)
      expect(outcomeOf(board)).toBe('white')
    })
  }

  it('只有四连（一端被对手堵住）不算胜', () => {
    const four = [at(7, 3), at(7, 4), at(7, 5), at(7, 6)]
    const blocked = boardWith(four, BLACK, [at(7, 2)])
    expect(makesFive(blocked, at(7, 4), BLACK)).toBe(false)
    expect(winnerOf(blocked)).toBeNull()
    expect(outcomeOf(blocked)).toBeNull()
    // 另一端也堵上仍然是四连，不算胜
    const bothBlocked = boardWith(four, BLACK, [at(7, 2), at(7, 7)])
    expect(outcomeOf(bothBlocked)).toBeNull()
  })

  it('两端被堵的 5 连仍然是胜（成五不看两端是否被封）', () => {
    const board = boardWith([at(7, 4), at(7, 5), at(7, 6), at(7, 7), at(7, 8)], BLACK, [
      at(7, 3),
      at(7, 9),
    ])
    expect(outcomeOf(board)).toBe('black')
  })

  it('中间有断口的 5 个子不算胜', () => {
    const board = emptyBoard()
    for (const index of [at(7, 3), at(7, 4), at(7, 5), at(7, 7), at(7, 8)]) board[index] = BLACK
    expect(makesFive(board, at(7, 4), BLACK)).toBe(false)
    expect(outcomeOf(board)).toBeNull()
  })

  it('六连也算胜（run 长度 ≥ 5）', () => {
    const board = boardWith(
      [at(7, 2), at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)],
      BLACK,
    )
    expect(outcomeOf(board)).toBe('black')
  })
})

describe('reduce 真实路径下的终局', () => {
  const FOUR_TURNS: readonly GomokuTurn[] = [
    { black: at(7, 3), white: at(0, 0) },
    { black: at(7, 4), white: at(0, 1) },
    { black: at(7, 5), white: at(0, 2) },
    { black: at(7, 6), white: at(0, 3) },
  ]

  it('玩家补上第五子：白方不再应手，status = won，结果标题如实', () => {
    const before = stateOf(FOUR_TURNS)
    expect(gameStatus(before)).toBe('playing')
    const after = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    expect(after.board[at(7, 7)]).toBe(BLACK)
    expect(after.moves).toBe(5)
    // 黑方直接终结，白方不应手 → 白子数不变
    expect(after.rngCursor).toBe(4)
    expect(countOf(after.board, WHITE)).toBe(4)
    expect(after.history[4]).toEqual({ black: at(7, 7), white: null })
    expect(after.lastMove).toBe(at(7, 7))
    expect(gameStatus(after)).toBe('won')
    expect(outcomeOf(after.board)).toBe('black')
    expect(gomokuGame.view(after).result!.titleKey).toBe('gomoku.won.title')
  })

  it('白方最后一手成五：status = lost，结果标题如实', () => {
    const turns: readonly GomokuTurn[] = [
      { black: at(0, 0), white: at(3, 3) },
      { black: at(0, 2), white: at(3, 4) },
      { black: at(0, 4), white: at(3, 5) },
      { black: at(0, 6), white: at(3, 6) },
      { black: at(6, 6), white: at(3, 7) },
    ]
    const state = stateOf(turns)
    expect(outcomeOf(state.board)).toBe('white')
    expect(gameStatus(state)).toBe('lost')
    expect(gomokuGame.view(state).result!.titleKey).toBe('gomoku.lost.title')
  })

  it('棋盘下满且无人成五 = 平局：GameStatus 仍是 won（壳层只渲染非 playing 的结果面板）', () => {
    const board = fillNoFiveBoard()
    expect(winnerOf(board)).toBeNull()
    expect(outcomeOf(board)).toBe('draw')
    const state = stateOf([], { board, moves: 113, rngCursor: 112 })
    expect(gameStatus(state)).toBe('won')
    const view = gomokuGame.view(state)
    expect(view.result!.titleKey).toBe('gomoku.draw.title')
    expect(view.result!.details.map((detail) => detail.key)).toEqual([
      'gomoku.result.moves',
      'gomoku.result.draw',
    ])
  })
})

describe('落子后自动应手', () => {
  it('玩家落子只落黑方；白方应手分两拍（先亮目标格、再落子）', () => {
    const before = createState(1234, 'starter')
    const afterPlace = reduceGomoku(before, { type: 'place', index: 112 })
    expect(afterPlace.board[112]).toBe(BLACK)
    expect(countOf(afterPlace.board, BLACK)).toBe(1)
    expect(countOf(afterPlace.board, WHITE)).toBe(0)
    expect(afterPlace.moves).toBe(1)
    expect(afterPlace.rngCursor).toBe(0)
    expect(afterPlace.lastMove).toBe(112)
    expect(afterPlace.opponentPick).toBeNull()
    expect(afterPlace.history).toEqual([{ black: 112, white: null }])
  
    // 第一拍：只亮出目标格 —— 盘面一格不动，但记下了 AI 挑中的落点
    const picked = reduceGomoku(afterPlace, { type: 'tick' })
    expect(picked.opponentPick).not.toBeNull()
    expect(picked.board).toEqual(afterPlace.board)
    expect(picked.history[0]!.white).toBeNull()
  
    // 第二拍：白子真正落下，回合补上白方那一手
    const landed = reduceGomoku(picked, { type: 'tick' })
    const turn = landed.history[0]!
    expect(turn.white).toBe(picked.opponentPick)
    expect(landed.opponentPick).toBeNull()
    expect(landed.rngCursor).toBe(1)
    expect(landed.lastMove).toBe(turn.white)
    expect(countOf(landed.board, WHITE)).toBe(1)
  })

  it('连续多手后：黑子数 = 步数、白子数 = 游标、最后高亮落在最后一手上', () => {
    let state = createState(99, 'skilled')
    for (let ply = 0; ply < 6 && gameStatus(state) === 'playing'; ply++) {
      state = settle(reduceGomoku(state, { type: 'place', index: playerMoves(state)[0]! }))
    }
    expect(countOf(state.board, BLACK)).toBe(state.moves)
    expect(countOf(state.board, WHITE)).toBe(state.rngCursor)
    expect(state.rngCursor).toBe(state.moves)
    const highlighted = gomokuGame
      .view(state)
      .board!.cells.filter((cell) => cell.lastTo !== undefined)
    expect(highlighted.map((cell) => cell.index)).toEqual([state.lastMove])
  })
})

describe('非法落子与点选映射', () => {
  it('已占用 / 越界 / 非整数索引一律抛 IllegalActionError 且原状态不变', () => {
    const state = reduceGomoku(createState(5, 'starter'), { type: 'place', index: 112 })
    const snapshot = encodeState(state)
    const occupied = state.board.findIndex((stone) => stone !== EMPTY)
    for (const index of [occupied, -1, CELLS, 1.5, Number.NaN]) {
      expect(() => reduceGomoku(state, { type: 'place', index }), `index ${index}`).toThrow(
        IllegalActionError,
      )
    }
    expect(encodeState(state)).toEqual(snapshot)
  })

  it('对局结束后不能再落子', () => {
    const before = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const over = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    expect(gameStatus(over)).toBe('won')
    expect(() => reduceGomoku(over, { type: 'place', index: at(0, 7) })).toThrow(IllegalActionError)
    expect(selectAction(over, at(0, 7))).toBeNull()
  })

  it('未知动作类型明确报错', () => {
    const state = createState(5, 'starter')
    expect(() => reduceGomoku(state, { type: 'nope' } as unknown as GomokuAction)).toThrow(
      IllegalActionError,
    )
  })

  it('selectAction：空格给 place，占用/越界给 null', () => {
    const state = createState(5, 'starter')
    expect(selectAction(state, 0)).toEqual({ type: 'place', index: 0 })
    expect(selectAction(state, -1)).toBeNull()
    expect(selectAction(state, CELLS)).toBeNull()
    expect(selectAction(state, 0.5)).toBeNull()
    const played = reduceGomoku(state, { type: 'place', index: 112 })
    expect(selectAction(played, 112)).toBeNull()
    expect(selectAction(played, played.board.findIndex((stone) => stone === WHITE))).toBeNull()
  })
})

describe('撤销一整回合与重开', () => {
  it('撤销把玩家落子与白方应手一起退回', () => {
    const start = createState(2024, 'skilled')
    const first = settle(reduceGomoku(start, { type: 'place', index: playerMoves(start)[0]! }))
    const second = settle(reduceGomoku(first, { type: 'place', index: playerMoves(first)[0]! }))
    const undone = reduceGomoku(second, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(first))
    expect(undone.moves).toBe(1)
    expect(undone.rngCursor).toBe(1)
    expect(undone.history).toHaveLength(1)
    expect(countOf(undone.board, BLACK)).toBe(1)
    expect(countOf(undone.board, WHITE)).toBe(1)
  })

  it('连撤到开局等于初始状态', () => {
    let state = createState(77, 'starter')
    for (let ply = 0; ply < 3; ply++) {
      state = settle(reduceGomoku(state, { type: 'place', index: playerMoves(state)[0]! }))
    }
    while (state.history.length > 0) state = reduceGomoku(state, { type: 'undo' })
    expect(encodeState(state)).toEqual(encodeState(createState(77, 'starter')))
  })

  it('没有历史时撤销报错；终局后撤销可以回到可下状态', () => {
    const fresh = createState(1, 'starter')
    expect(() => reduceGomoku(fresh, { type: 'undo' })).toThrow(IllegalActionError)

    const before = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const over = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    const back = reduceGomoku(over, { type: 'undo' })
    expect(encodeState(back)).toEqual(encodeState(before))
    expect(gameStatus(back)).toBe('playing')
  })

  it('重开回到同种子同难度的初始状态，终局后也能重开', () => {
    const state = reduceGomoku(createState(31, 'challenging'), { type: 'place', index: 112 })
    expect(encodeState(reduceGomoku(state, { type: 'restart' }))).toEqual(
      encodeState(createState(31, 'challenging')),
    )
    const before = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const over = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    const restarted = reduceGomoku(over, { type: 'restart' })
    expect(restarted.history).toEqual([])
    expect(gameStatus(restarted)).toBe('playing')
  })
})

describe('合法动作集合', () => {
  it('开局只有 225 个 place 与 restart（无历史不能撤销）', () => {
    const actions = legalActions(createState(1, 'starter'))
    expect(actions.filter((action) => action.type === 'place')).toHaveLength(CELLS)
    expect(actions.filter((action) => action.type === 'undo')).toHaveLength(0)
    expect(actions.filter((action) => action.type === 'restart')).toHaveLength(1)
  })

  it('落子后待应手只有 tick/undo/restart；落定后 place 覆盖其余空格', () => {
    const pending = reduceGomoku(createState(1, 'starter'), { type: 'place', index: 112 })
    expect(legalActions(pending).map((action) => action.type)).toEqual(['tick', 'undo', 'restart'])
    const state = settle(pending)
    const places = legalActions(state).filter(
      (action): action is { type: 'place'; index: number } => action.type === 'place',
    )
    expect(places).toHaveLength(CELLS - 2)
    for (const action of places) expect(state.board[action.index]).toBe(EMPTY)
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(true)
  })

  it('对局结束后只剩 undo / restart', () => {
    const before = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const over = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    const types = legalActions(over).map((action) => action.type)
    expect(types).toEqual(['undo', 'restart'])
  })

  it('ASCII 摆盘工具与规则判定一致（防止测试夹具本身写错）', () => {
    const board = boardOf([
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '.......B.......',
      '.....BBBW......',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
    ])
    expect(board[at(7, 7)]).toBe(BLACK)
    expect(board[at(7, 8)]).toBe(WHITE)
    expect(outcomeOf(board)).toBeNull()
  })
})
