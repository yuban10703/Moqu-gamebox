/**
 * 规则层测试：初始局面、四连判胜（横/竖/两斜 + 三连不算 + 被堵不算）、落子后自动应手、
 * 列满/越界抛错、撤销一整回合、重开、合法动作集合与点选映射。
 *
 * 「构造局面」类用例走 test/helpers.ts 的 ASCII 摆盘与 stateOf（自洽回合日志，含重力校验）；
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
  findFour,
  gameStatus,
  landingIndex,
  legalActions,
  makesFour,
  outcomeOf,
  reduceConnect4,
  selectAction,
  connect4Game,
  type Connect4Action,
  type Connect4Turn,
} from '../src/index.js'
import {
  at,
  boardOf,
  bottomIndex,
  countOf,
  crowdedState,
  emptyBoard,
  fillNoFourBoard,
  playerColumns,
  stateOf,
  winnerOf,
} from './helpers.js'

/** 横、竖、↘、↗ 四条轴上的四连坐标（都在最下方两行内，视觉上贴近真实棋局） */
const FOUR_LINES: ReadonlyArray<{ name: string; cells: readonly number[] }> = [
  { name: 'horizontal', cells: [at(5, 0), at(5, 1), at(5, 2), at(5, 3)] },
  { name: 'vertical', cells: [at(2, 2), at(3, 2), at(4, 2), at(5, 2)] },
  { name: 'diagonal', cells: [at(2, 0), at(3, 1), at(4, 2), at(5, 3)] },
  { name: 'anti-diagonal', cells: [at(2, 3), at(3, 2), at(4, 1), at(5, 0)] },
]

function boardWith(
  cells: readonly number[],
  side: 1 | 2,
  extra: readonly number[] = [],
): ReturnType<typeof emptyBoard> {
  const board = emptyBoard()
  for (const index of extra) board[index] = side === BLACK ? WHITE : BLACK
  for (const index of cells) board[index] = side
  return board
}

describe('初始局面', () => {
  it('7 列 × 6 行空盘、步数与游标为 0、无历史', () => {
    const state = createState(1, 'starter')
    expect(state.board).toHaveLength(CELLS)
    expect(CELLS).toBe(42)
    expect(state.board.every((stone) => stone === EMPTY)).toBe(true)
    expect(state.moves).toBe(0)
    expect(state.rngCursor).toBe(0)
    expect(state.lastMove).toBeNull()
    expect(state.history).toEqual([])
    expect(gameStatus(state)).toBe('playing')
    expect(connect4Game.view(state).result).toBeNull()
  })

  it('空盘每列的最低空格都在最下面一行：列 3 → 索引 38', () => {
    const state = createState(1, 'starter')
    expect(at(0, 0)).toBe(0)
    expect(at(5, 3)).toBe(38)
    expect(landingIndex(state.board, 3)).toBe(38)
    expect(bottomIndex(state.board, 3)).toBe(38)
    // 第 0 行恰好占索引 0..6：传格子索引与传列号等价
    expect(selectAction(state, 38)).toEqual({ type: 'drop', column: 3 })
    expect(selectAction(state, 3)).toEqual({ type: 'drop', column: 3 })
    expect(playerColumns(state)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe('四连判胜（横 / 竖 / 两斜）', () => {
  for (const line of FOUR_LINES) {
    it(`${line.name}：黑方四连即胜`, () => {
      const board = boardWith(line.cells, BLACK)
      // 生产实现与独立实现必须一致
      for (const index of line.cells) expect(makesFour(board, index, BLACK), `index ${index}`).toBe(true)
      expect(winnerOf(board)).toBe(BLACK)
      expect(outcomeOf(board)).toBe('black')
      expect(findFour(board, line.cells[0]!, BLACK)).toEqual([...line.cells].sort((a, b) => a - b))
    })

    it(`${line.name}：白方四连即白胜`, () => {
      const board = boardWith(line.cells, WHITE)
      expect(winnerOf(board)).toBe(WHITE)
      expect(outcomeOf(board)).toBe('white')
    })
  }

  it('三连不算胜，被对手堵住的三连也不算胜', () => {
    const three = [at(5, 0), at(5, 1), at(5, 2)]
    const open = boardWith(three, BLACK)
    expect(makesFour(open, at(5, 1), BLACK)).toBe(false)
    expect(winnerOf(open)).toBeNull()
    expect(outcomeOf(open)).toBeNull()

    const blocked = boardWith(three, BLACK, [at(5, 3)])
    expect(makesFour(blocked, at(5, 1), BLACK)).toBe(false)
    expect(outcomeOf(blocked)).toBeNull()
    expect(findFour(blocked, at(5, 1), BLACK)).toBeNull()
  })

  it('断口的四子、两对分离的子都不算胜', () => {
    const gap = boardWith([at(5, 0), at(5, 1), at(5, 3), at(5, 4)], BLACK)
    expect(outcomeOf(gap)).toBeNull()
    const pairs = boardWith([at(5, 0), at(5, 1), at(5, 4), at(5, 5)], BLACK)
    expect(outcomeOf(pairs)).toBeNull()
    // 斜线上的断口同样不算
    const diagonalGap = boardWith([at(2, 0), at(3, 1), at(5, 3)], BLACK)
    expect(outcomeOf(diagonalGap)).toBeNull()
  })

  it('两端被对手堵住的 4 连仍然是胜（成四只看是否连续）', () => {
    const board = boardWith([at(5, 2), at(5, 3), at(5, 4), at(5, 5)], BLACK, [at(5, 1), at(5, 6)])
    expect(outcomeOf(board)).toBe('black')
  })
})

describe('reduce 真实路径下的终局', () => {
  const THREE_TURNS: readonly Connect4Turn[] = [
    { black: at(5, 0), white: at(5, 6) },
    { black: at(5, 1), white: at(4, 6) },
    { black: at(5, 2), white: at(3, 6) },
  ]

  it('玩家补上第四子：白方不再应手，status = won，结果标题如实', () => {
    const before = stateOf(THREE_TURNS)
    expect(gameStatus(before)).toBe('playing')
    const after = reduceConnect4(before, { type: 'drop', column: 3 })
    expect(after.board[at(5, 3)]).toBe(BLACK)
    expect(after.moves).toBe(4)
    // 黑方直接终结，白方不应手 → 白子数不变
    expect(after.rngCursor).toBe(3)
    expect(countOf(after.board, WHITE)).toBe(3)
    expect(after.history[3]).toEqual({ black: at(5, 3), white: null })
    expect(after.lastMove).toBe(at(5, 3))
    expect(gameStatus(after)).toBe('won')
    expect(outcomeOf(after.board)).toBe('black')
    expect(connect4Game.view(after).result!.titleKey).toBe('connect4.won.title')
  })

  it('白方最后一手成四：status = lost，结果标题如实', () => {
    const turns: readonly Connect4Turn[] = [
      { black: at(5, 0), white: at(5, 3) },
      { black: at(5, 1), white: at(4, 3) },
      { black: at(4, 0), white: at(3, 3) },
      { black: at(4, 1), white: at(2, 3) },
    ]
    const state = stateOf(turns)
    expect(outcomeOf(state.board)).toBe('white')
    expect(gameStatus(state)).toBe('lost')
    expect(connect4Game.view(state).result!.titleKey).toBe('connect4.lost.title')
  })

  it('棋盘下满且无人成四 = 平局：GameStatus 仍是 won（壳层只渲染非 playing 的结果面板）', () => {
    // 阶梯棋盘铺满 21 回合（黑 21 / 白 21）也不会有四连，是真实可下出来的平局
    const played = crowdedState(21)
    expect(played.moves).toBe(21)
    expect(played.rngCursor).toBe(21)
    expect(played.board.every((stone) => stone !== EMPTY)).toBe(true)
    expect(winnerOf(played.board)).toBeNull()
    expect(outcomeOf(played.board)).toBe('draw')
    expect(gameStatus(played)).toBe('won')
    const view = connect4Game.view(played)
    expect(view.result!.titleKey).toBe('connect4.draw.title')

    // 独立摆出的满盘无四连图案也得到同样结论
    const board = fillNoFourBoard()
    expect(countOf(board, BLACK)).toBe(21)
    expect(countOf(board, WHITE)).toBe(21)
    expect(winnerOf(board)).toBeNull()
    expect(outcomeOf(board)).toBe('draw')
  })
})

describe('落子后自动应手', () => {
  it('玩家落子后白方立刻应手：同一次 reduce 内盘面多出黑白各一子', () => {
    const before = createState(1234, 'starter')
    const after = reduceConnect4(before, { type: 'drop', column: 3 })
    expect(after.board[landingIndex(before.board, 3)!]).toBe(BLACK)
    expect(countOf(after.board, BLACK)).toBe(1)
    expect(countOf(after.board, WHITE)).toBe(1)
    expect(after.moves).toBe(1)
    expect(after.rngCursor).toBe(1)
    const white = after.board.findIndex((stone) => stone === WHITE)
    // 白子同样受重力约束：它就在自己那一列的最低空格上
    const beforeBlack = before.board.slice()
    beforeBlack[landingIndex(beforeBlack, 3)!] = BLACK
    expect(white).toBe(bottomIndex(beforeBlack, white % 7))
    expect(after.lastMove).toBe(white)
    expect(after.history).toEqual([{ black: landingIndex(before.board, 3), white }])
  })

  it('连续多手后：黑子数 = 步数、白子数 = 游标、最后高亮落在最后一手上', () => {
    let state = createState(99, 'skilled')
    for (let ply = 0; ply < 6 && gameStatus(state) === 'playing'; ply++) {
      state = reduceConnect4(state, { type: 'drop', column: playerColumns(state)[0]! })
    }
    expect(countOf(state.board, BLACK)).toBe(state.moves)
    expect(countOf(state.board, WHITE)).toBe(state.rngCursor)
    expect(state.rngCursor).toBeLessThanOrEqual(state.moves)
    const highlighted = connect4Game.view(state).board!.cells.filter((cell) => cell.selected)
    expect(highlighted.map((cell) => cell.index)).toEqual([state.lastMove])
  })

  it('每一手都遵守重力：新落的子在落子前那一刻就是该列最低空格', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      let state = createState(2024, difficulty)
      for (let ply = 0; ply < 8 && gameStatus(state) === 'playing'; ply++) {
        const before = state.board.slice()
        const column = playerColumns(state)[0]!
        const next = reduceConnect4(state, { type: 'drop', column })
        const black = bottomIndex(before, column)!
        expect(next.board[black], `${difficulty} ply=${ply}`).toBe(BLACK)
        if (next.history[ply]!.white !== null) {
          const afterBlack = before.slice()
          afterBlack[black] = BLACK
          const whiteIndex = next.history[ply]!.white!
          expect(whiteIndex).toBe(bottomIndex(afterBlack, whiteIndex % 7))
        }
        state = next
      }
    }
  })
})

describe('非法落子与点选映射', () => {
  it('列满后不能再落子：抛 IllegalActionError，原状态不变', () => {
    // 同列交替黑白填满（3 黑 3 白），既不带四连又把该列塞满
    const state = stateOf([
      { black: at(5, 0), white: at(4, 0) },
      { black: at(3, 0), white: at(2, 0) },
      { black: at(1, 0), white: at(0, 0) },
    ])
    expect(gameStatus(state)).toBe('playing')
    expect(landingIndex(state.board, 0)).toBeNull()
    const snapshot = encodeState(state)
    expect(() => reduceConnect4(state, { type: 'drop', column: 0 })).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(snapshot)
    // 列已满 → 该列不可点，合法动作里也没有它
    expect(selectAction(state, at(0, 0))).toBeNull()
    expect(selectAction(state, 0)).toBeNull()
    const drops = legalActions(state).filter(
      (action): action is { type: 'drop'; column: number } => action.type === 'drop',
    )
    expect(drops.map((action) => action.column)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('列号越界 / 非整数一律抛 IllegalActionError', () => {
    const state = createState(5, 'starter')
    for (const column of [-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => reduceConnect4(state, { type: 'drop', column }), `column ${column}`).toThrow(
        IllegalActionError,
      )
    }
  })

  it('对局结束后不能再落子', () => {
    const before = stateOf([
      { black: at(5, 0), white: at(5, 6) },
      { black: at(5, 1), white: at(4, 6) },
      { black: at(5, 2), white: at(3, 6) },
    ])
    const over = reduceConnect4(before, { type: 'drop', column: 3 })
    expect(gameStatus(over)).toBe('won')
    expect(() => reduceConnect4(over, { type: 'drop', column: 6 })).toThrow(IllegalActionError)
    expect(selectAction(over, at(0, 6))).toBeNull()
  })

  it('未知动作类型明确报错', () => {
    const state = createState(5, 'starter')
    expect(() => reduceConnect4(state, { type: 'nope' } as unknown as Connect4Action)).toThrow(
      IllegalActionError,
    )
  })

  it('selectAction：空格给 drop，越界给 null；点在列中任意一格都落到该列', () => {
    const state = createState(5, 'starter')
    expect(selectAction(state, 0)).toEqual({ type: 'drop', column: 0 })
    expect(selectAction(state, at(2, 4))).toEqual({ type: 'drop', column: 4 })
    expect(selectAction(state, -1)).toBeNull()
    expect(selectAction(state, CELLS)).toBeNull()
    expect(selectAction(state, 0.5)).toBeNull()
    const played = reduceConnect4(state, { type: 'drop', column: 4 })
    // 列 4 只剩 5 个空位，但点的仍是这一列 → 仍返回 drop
    expect(selectAction(played, at(0, 4))).toEqual({ type: 'drop', column: 4 })
    const full = stateOf([
      { black: at(5, 0), white: at(4, 0) },
      { black: at(3, 0), white: at(2, 0) },
      { black: at(1, 0), white: at(0, 0) },
    ])
    expect(selectAction(full, at(3, 0))).toBeNull()
  })
})

describe('撤销一整回合与重开', () => {
  it('撤销把玩家落子与白方应手一起退回', () => {
    const start = createState(2024, 'skilled')
    const first = reduceConnect4(start, { type: 'drop', column: playerColumns(start)[0]! })
    const second = reduceConnect4(first, { type: 'drop', column: playerColumns(first)[0]! })
    const undone = reduceConnect4(second, { type: 'undo' })
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
      state = reduceConnect4(state, { type: 'drop', column: playerColumns(state)[0]! })
    }
    while (state.history.length > 0) state = reduceConnect4(state, { type: 'undo' })
    expect(encodeState(state)).toEqual(encodeState(createState(77, 'starter')))
  })

  it('没有历史时撤销报错；终局后撤销可以回到可下状态', () => {
    const fresh = createState(1, 'starter')
    expect(() => reduceConnect4(fresh, { type: 'undo' })).toThrow(IllegalActionError)

    const before = stateOf([
      { black: at(5, 0), white: at(5, 6) },
      { black: at(5, 1), white: at(4, 6) },
      { black: at(5, 2), white: at(3, 6) },
    ])
    const over = reduceConnect4(before, { type: 'drop', column: 3 })
    const back = reduceConnect4(over, { type: 'undo' })
    expect(encodeState(back)).toEqual(encodeState(before))
    expect(gameStatus(back)).toBe('playing')
    // 撤回后那一列又能落子
    expect(selectAction(back, at(0, 3))).toEqual({ type: 'drop', column: 3 })
  })

  it('重开回到同种子同难度的初始状态，终局后也能重开', () => {
    const state = reduceConnect4(createState(31, 'challenging'), { type: 'drop', column: 3 })
    expect(encodeState(reduceConnect4(state, { type: 'restart' }))).toEqual(
      encodeState(createState(31, 'challenging')),
    )
    const before = stateOf([
      { black: at(5, 0), white: at(5, 6) },
      { black: at(5, 1), white: at(4, 6) },
      { black: at(5, 2), white: at(3, 6) },
    ])
    const over = reduceConnect4(before, { type: 'drop', column: 3 })
    const restarted = reduceConnect4(over, { type: 'restart' })
    expect(restarted.history).toEqual([])
    expect(gameStatus(restarted)).toBe('playing')
  })
})

describe('合法动作集合', () => {
  it('开局 7 个 drop 与 restart（无历史不能撤销）', () => {
    const actions = legalActions(createState(1, 'starter'))
    expect(actions.filter((action) => action.type === 'drop')).toHaveLength(7)
    expect(actions.filter((action) => action.type === 'undo')).toHaveLength(0)
    expect(actions.filter((action) => action.type === 'restart')).toHaveLength(1)
  })

  it('落子后 drop 只覆盖未满的列，且出现 undo', () => {
    const state = reduceConnect4(createState(1, 'starter'), { type: 'drop', column: 3 })
    const drops = legalActions(state).filter(
      (action): action is { type: 'drop'; column: number } => action.type === 'drop',
    )
    expect(drops).toHaveLength(7)
    for (const action of drops) expect(landingIndex(state.board, action.column)).not.toBeNull()
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(true)
  })

  it('对局结束后只剩 undo / restart', () => {
    const before = stateOf([
      { black: at(5, 0), white: at(5, 6) },
      { black: at(5, 1), white: at(4, 6) },
      { black: at(5, 2), white: at(3, 6) },
    ])
    const over = reduceConnect4(before, { type: 'drop', column: 3 })
    const types = legalActions(over).map((action) => action.type)
    expect(types).toEqual(['undo', 'restart'])
  })

  it('ASCII 摆盘工具与规则判定一致（防止测试夹具本身写错）', () => {
    const board = boardOf([
      '.......',
      '.......',
      '.......',
      '...W...',
      '..WW...',
      'BBBWB..',
    ])
    expect(board[at(5, 0)]).toBe(BLACK)
    expect(board[at(5, 3)]).toBe(WHITE)
    expect(board[at(0, 0)]).toBe(EMPTY)
    expect(outcomeOf(board)).toBeNull()
  })
})
