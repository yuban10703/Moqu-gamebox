/**
 * 规则层测试：初始局面、八方向翻转、非法落子、自动过手、终局判定、撤销。
 *
 * 「构造局面」类用例用 test/helpers.ts 的 ASCII 摆盘 + fixtureState（不做可达性校验），
 * 真实对局路径（确定性、存档往返）一律走 reversiGame.create + reduce。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  countDiscs,
  createInitialBoard,
  createState,
  encodeState,
  flipsFor,
  gameStatus,
  legalActions,
  legalMovesFor,
  placeDisc,
  reduceReversi,
  reversiGame,
  selectAction,
  type Disc,
  type Side,
} from '../src/index.js'
import { settle,  boardOf, fixtureState } from './helpers.js'

/** 与生产代码独立的八方向表，避免「用被测表验证被测表」 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]

const CENTER = 27 // row 3 col 3（d5，初始局面的黑子位置）

function at(dr: number, dc: number, distance: number): number {
  return (3 + dr * distance) * 8 + (3 + dc * distance)
}

function emptyBoard(): Disc[] {
  return new Array<Disc>(CELLS).fill(EMPTY)
}

describe('初始局面', () => {
  it('中心四格按标准摆法：d4/e5 白、e4/d5 黑', () => {
    const board = createInitialBoard()
    expect(board).toHaveLength(CELLS)
    expect(board[27]).toBe(BLACK) // d5
    expect(board[28]).toBe(WHITE) // e5
    expect(board[35]).toBe(WHITE) // d4
    expect(board[36]).toBe(BLACK) // e4
    expect(countDiscs(board)).toEqual({ black: 2, white: 2, empty: 60 })
  })

  it('黑方恰好 4 个合法落点：c4/d3/e6/f5', () => {
    // 黑白棋的标准事实：初始局面黑方只有 4 个落点（34=c4、43=d3、20=e6、29=f5）。
    // 方向或翻转实现错了，这个数字立刻就不对。
    expect(legalMovesFor(createInitialBoard(), BLACK)).toEqual([20, 29, 34, 43])
    expect(legalMovesFor(createInitialBoard(), WHITE)).toEqual([19, 26, 37, 44])
  })
})

describe('八个方向的夹子与翻转', () => {
  it('每个方向单独验证：白子在距离 1/2、黑子在距离 3 → 一子夹两子', () => {
    for (const [dr, dc] of DIRS) {
      const board = emptyBoard()
      board[at(dr, dc, 3)] = BLACK
      board[at(dr, dc, 1)] = WHITE
      board[at(dr, dc, 2)] = WHITE
      const expected = [at(dr, dc, 1), at(dr, dc, 2)]
      expect(flipsFor(board, CENTER, BLACK), `direction ${dr},${dc}`).toEqual(expected)

      const placed = placeDisc(board, CENTER, BLACK)
      expect(placed).not.toBeNull()
      expect(placed!.flips).toEqual(expected)
      expect(placed!.board[CENTER]).toBe(BLACK)
      for (const index of expected) expect(placed!.board[index]).toBe(BLACK)
      expect(placed!.board[at(dr, dc, 3)]).toBe(BLACK)
    }
  })

  it('八个方向同时夹住 → 一手翻 16 子', () => {
    const board = emptyBoard()
    const expected: number[] = []
    for (const [dr, dc] of DIRS) {
      board[at(dr, dc, 3)] = BLACK
      for (const distance of [1, 2]) {
        board[at(dr, dc, distance)] = WHITE
        expected.push(at(dr, dc, distance))
      }
    }
    expect(expected).toHaveLength(16)
    expect(flipsFor(board, CENTER, BLACK).sort((a, b) => a - b)).toEqual(
      expected.slice().sort((a, b) => a - b),
    )
    const placed = placeDisc(board, CENTER, BLACK)!
    expect(countDiscs(placed.board).white).toBe(0)
  })

  it('夹不住任何棋子的空格不合法（一端没有己方棋子 / 中间有空格）', () => {
    // 一条白子后面没有黑子：不构成夹
    const noAnchor = emptyBoard()
    noAnchor[36] = WHITE
    noAnchor[44] = WHITE
    expect(flipsFor(noAnchor, 28, BLACK)).toEqual([])
    // 白子与黑子之间隔着空格：中间断开了，不构成夹
    const gap = emptyBoard()
    gap[36] = WHITE
    gap[20] = BLACK
    expect(flipsFor(gap, 44, BLACK)).toEqual([])
    // 已占用格子永远不合法
    expect(flipsFor(createInitialBoard(), 27, BLACK)).toEqual([])
  })
})

describe('非法落子与点选映射', () => {
  it('夹不住子的空格抛 IllegalActionError 并保留原状态', () => {
    const state = createState(1, 'starter')
    expect(() => settle(reduceReversi(state, { type: 'place', index: 0 }))).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(encodeState(createState(1, 'starter')))
  })

  it('已占用格子、越界、非整数索引一律拒绝', () => {
    const state = createState(1, 'starter')
    for (const index of [27, 28, 35, 36, -1, 64, 1.5, Number.NaN]) {
      expect(() => settle(reduceReversi(state, { type: 'place', index })), `index ${index}`).toThrow(
        IllegalActionError,
      )
    }
  })

  it('selectAction：已占用的格子返回 null，夹不住子的空格照样返回 place（让 reduce 给提示）', () => {
    const state = createState(1, 'starter')
    expect(selectAction(state, 27)).toBeNull() // 已占用：点了没反应
    expect(selectAction(state, -1)).toBeNull()
    expect(selectAction(state, 64)).toBeNull()
    expect(selectAction(state, 20)).toEqual({ type: 'place', index: 20 }) // 合法点
    expect(selectAction(state, 0)).toEqual({ type: 'place', index: 0 }) // 非法空点：交给 reduce 报错
    expect(() => reduceReversi(state, selectAction(state, 0)!)).toThrow(IllegalActionError)
  })

  it('legalActions 开局给出四个合法落点与重开，没有撤销', () => {
    const actions = legalActions(createState(1, 'starter'))
    expect(actions.filter((action) => action.type === 'place')).toEqual([
      { type: 'place', index: 20 },
      { type: 'place', index: 29 },
      { type: 'place', index: 34 },
      { type: 'place', index: 43 },
    ])
    expect(actions.some((action) => action.type === 'undo')).toBe(false)
    expect(actions.some((action) => action.type === 'restart')).toBe(true)
  })

  it('重开无条件可用，并回到同种子同难度的初始局面', () => {
    let state = createState(2024, 'challenging')
    state = settle(reduceReversi(state, { type: 'place', index: 20 }))
    expect(reduceReversi(state, { type: 'restart' })).toEqual(createState(2024, 'challenging'))
    // 终局后重开也要可用
    const over = fixtureState(boardOf(['BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'BBBBBBBB', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW']), BLACK)
    expect(gameStatus(over)).toBe('won')
    expect(reduceReversi(over, { type: 'restart' })).toEqual(createState(over.seed, over.difficulty))
  })
})

describe('自动过手', () => {
  // 真实对局里搜出来的局面：白方已无处可下，黑方还有 57（row7 col1）可走；
  // 黑方落子后白方仍然无棋可下，于是自动过手并把回合交回黑方。
  const WHITE_STUCK = boardOf([
    'WWWWWWWB',
    'WWBBBBBB',
    'WWWWBBBB',
    'WWWWBBBB',
    'WWWWWBBB',
    'WWBBBBWB',
    'WWWBWWWW',
    '··BBBBBB',
  ])

  it('白方无棋可下 → 同一次 reduce 内跳过，回合交回玩家并给出提示', () => {
    const before = fixtureState(WHITE_STUCK, BLACK)
    expect(legalMovesFor(WHITE_STUCK, WHITE)).toEqual([])
    expect(legalMovesFor(WHITE_STUCK, BLACK)).toContain(57)

    const after = settle(reduceReversi(before, { type: 'place', index: 57 }))
    expect(after.turn).toBe(BLACK)
    expect(after.notice).toBe('opponentPass')
    expect(after.moves).toBe(1)
    // 白方没有落子 → 随机游标不动，棋子只多了玩家这一颗
    expect(after.rngCursor).toBe(0)
    expect(countDiscs(after.board).black + countDiscs(after.board).white).toBe(
      countDiscs(WHITE_STUCK).black + countDiscs(WHITE_STUCK).white + 1,
    )
    expect(reversiGame.view(after).notice).toEqual({ textKey: 'reversi.notice.opponentPass' })
    // 过手之后玩家仍能继续落子
    expect(legalActions(after).some((action) => action.type === 'place')).toBe(true)
  })

  it('双方都无棋可下 → 对局结束（棋盘没下满也结束）', () => {
    // 真实对局：黑方走 24 之后双方都无处可下，白方 35 : 28 领先
    const before = fixtureState(
      boardOf([
        'BWWWWWWB',
        'WWWWWWBW',
        'WWBWBBWW',
        '·WBBBBWW',
        'BWBBWWWW',
        'BWBBBWWW',
        'BBBBBBWW',
        '·WWWWWWW',
      ]),
      BLACK,
    )
    const after = settle(reduceReversi(before, { type: 'place', index: 24 }))
    expect(countDiscs(after.board)).toEqual({ black: 28, white: 35, empty: 1 })
    expect(gameStatus(after)).toBe('lost')
    expect(legalActions(after).filter((action) => action.type === 'place')).toEqual([])
    expect(reversiGame.view(after).result?.titleKey).toBe('reversi.lost.title')
  })
})

describe('终局与胜负', () => {
  const BLACK_WINS = boardOf([
    '.BBBBBBB',
    'WBBBBBBB',
    'WBBBBBWB',
    'WBBBWWWB',
    'WWWBBWWB',
    'WWWWWBWB',
    'WWWWWWBB',
    'WWWWWWBB',
  ])
  const DRAW = boardOf([
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'WWWWWWWW',
    'WWWWWWWW',
    'WWWWWWWW',
    'WWWWWWWW',
  ])

  it('黑子多 → won 并由 view 给出胜局标题', () => {
    const state = fixtureState(BLACK_WINS, BLACK)
    expect(countDiscs(BLACK_WINS)).toEqual({ black: 33, white: 30, empty: 1 })
    expect(gameStatus(state)).toBe('won')
    const view = reversiGame.view(state)
    expect(view.result?.titleKey).toBe('reversi.won.title')
    expect(view.result?.details).toEqual([
      { key: 'reversi.result.black', params: { count: 33 } },
      { key: 'reversi.result.white', params: { count: 30 } },
    ])
  })

  it('白子多 → lost', () => {
    const inverted = BLACK_WINS.map((disc) => (disc === EMPTY ? EMPTY : disc === BLACK ? WHITE : BLACK))
    expect(gameStatus(fixtureState(inverted, BLACK))).toBe('lost')
    expect(reversiGame.view(fixtureState(inverted, BLACK)).result?.titleKey).toBe(
      'reversi.lost.title',
    )
  })

  it('平局：status 取 won（壳层只在 won 时给结果面板），但结果标题如实写平局', () => {
    const state = fixtureState(DRAW, BLACK)
    expect(gameStatus(state)).toBe('won')
    const view = reversiGame.view(state)
    expect(view.result?.titleKey).toBe('reversi.draw.title')
    expect(view.result?.details).toEqual([
      { key: 'reversi.result.black', params: { count: 32 } },
      { key: 'reversi.result.white', params: { count: 32 } },
    ])
  })

  it('棋盘下满即结束：没有空格就没有合法落点', () => {
    const full = DRAW
    expect(legalMovesFor(full, BLACK)).toEqual([])
    expect(legalMovesFor(full, WHITE)).toEqual([])
    expect(gameStatus(fixtureState(full, BLACK))).not.toBe('playing')
    // 终局后玩家再点空格：reduce 明确拒绝（selectAction 则静默返回 null）
    const state = fixtureState(full, BLACK)
    expect(selectAction(state, 0)).toBeNull()
  })

  it('进行中 status 为 playing 且没有结果', () => {
    const state = createState(3, 'starter')
    expect(gameStatus(state)).toBe('playing')
    expect(reversiGame.view(state).result).toBeNull()
  })
})

describe('撤销一整回合', () => {
  it('玩家落子 + 白方应手一起退回，encode 与落子前完全一致', () => {
    const start = createState(424242, 'skilled')
    const played = settle(reduceReversi(start, { type: 'place', index: 20 }))
    expect(played.moves).toBe(1)
    expect(played.rngCursor).toBe(1) // 白方应了一手
    const undone = reduceReversi(played, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(start))
    expect(undone).toEqual(start)
  })

  it('连续两回合后撤销一次回到上一回合（不是回到开局）', () => {
    const start = createState(77, 'challenging')
    const first = settle(reduceReversi(start, { type: 'place', index: 34 }))
    const secondMove = legalActions(first).find((action) => action.type === 'place')!
    const second = reduceReversi(first, secondMove)
    expect(second.moves).toBe(2)
    const undone = reduceReversi(second, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(first))
  })

  it('撤销还原随机游标：重下同一手得到完全相同的结果', () => {
    const start = createState(9, 'starter')
    const played = settle(reduceReversi(start, { type: 'place', index: 43 }))
    const undone = reduceReversi(played, { type: 'undo' })
    expect(encodeState(settle(reduceReversi(undone, { type: 'place', index: 43 })))).toEqual(
      encodeState(played),
    )
  })

  it('没有可撤销的回合时抛 IllegalActionError', () => {
    expect(() => reduceReversi(createState(1, 'starter'), { type: 'undo' })).toThrow(
      IllegalActionError,
    )
  })

  it('终局后仍能撤销关键一手（结果面板重开/回退都可用）', () => {
    const before = fixtureState(
      boardOf([
        'BWWWWWWB',
        'WWWWWWBW',
        'WWBWBBWW',
        '·WBBBBWW',
        'BWBBWWWW',
        'BWBBBWWW',
        'BBBBBBWW',
        '·WWWWWWW',
      ]),
      BLACK,
    )
    const over = settle(reduceReversi(before, { type: 'place', index: 24 }))
    expect(gameStatus(over)).toBe('lost')
    const back = reduceReversi(over, { type: 'undo' })
    expect(gameStatus(back)).toBe('playing')
    expect(encodeState(back)).toEqual(encodeState(before))
  })
})

describe('未知动作', () => {
  it('壳层不会派发的动作明确报错（避免静默无响应）', () => {
    const state = createState(1, 'starter')
    expect(() => reduceReversi(state, { type: 'nextLevel' } as never)).toThrow(IllegalActionError)
  })
})

describe('对局完整性（真实路径）', () => {
  it('走一整局：始终能走到终局，棋子增殖不变量成立', () => {
    let state = createState(20240607, 'skilled')
    let guard = 0
    while (gameStatus(state) === 'playing' && guard++ < 100) {
      const move = legalActions(state).find((action) => action.type === 'place')
      if (!move) break
      state = settle(reduceReversi(state, move))
      const { black, white } = countDiscs(state.board)
      // 每手恰好增殖一子：总数 = 4 + 玩家步数 + 白方手数
      expect(black + white).toBe(4 + state.moves + state.rngCursor)
      expect(state.history).toHaveLength(state.moves)
    }
    expect(gameStatus(state)).not.toBe('playing')
  })

  it('棋盘常量与双方取值自洽', () => {
    const sides: Side[] = [BLACK, WHITE]
    expect(sides).toEqual([1, 2])
    expect(CELLS).toBe(64)
    expect(createInitialBoard()).toHaveLength(CELLS)
  })
})
