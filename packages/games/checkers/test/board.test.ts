/**
 * 棋盘模型测试：起始局面、深色格、走子/吃子生成、强制吃子、连跳枚举、升王与计数。
 */
import { describe, expect, it } from 'vitest'
import {
  BLACK,
  BLACK_KING,
  BLACK_MAN,
  EMPTY,
  KING_VALUE,
  MAN_VALUE,
  PLAYABLE_INDEXES,
  WHITE,
  WHITE_KING,
  WHITE_MAN,
  applyMove,
  applyTurn,
  captureMovesFor,
  captureMovesFrom,
  countPieces,
  enumerateTurns,
  indexOf,
  initialBoard,
  isPlayable,
  legalMovesFor,
  pieceValue,
  promoteAt,
  promotedPiece,
  quietMovesFrom,
} from '../src/index.js'
import { boardFromRows, emptyBoard } from './helpers.js'

describe('棋盘与起始局面', () => {
  it('8×8、32 个深色格，浅色格不可放子', () => {
    expect(PLAYABLE_INDEXES).toHaveLength(32)
    expect(isPlayable(indexOf(0, 1))).toBe(true)
    expect(isPlayable(indexOf(0, 0))).toBe(false)
    expect(isPlayable(indexOf(7, 0))).toBe(true)
    expect(isPlayable(indexOf(7, 7))).toBe(false)
    for (const index of [-1, 64, 1.5, Number.NaN]) expect(isPlayable(index)).toBe(false)
  })

  it('起始局面：双方各 12 枚兵，白在上三行、黑在下三行，中间两行空', () => {
    const board = initialBoard()
    expect(countPieces(board)).toEqual({ black: 12, white: 12, blackKings: 0, whiteKings: 0 })
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const index = indexOf(row, col)
        if (!isPlayable(index)) {
          expect(board[index], `${row},${col}`).toBe(EMPTY)
          continue
        }
        if (row <= 2) expect(board[index], `${row},${col}`).toBe(WHITE_MAN)
        else if (row >= 5) expect(board[index], `${row},${col}`).toBe(BLACK_MAN)
        else expect(board[index], `${row},${col}`).toBe(EMPTY)
      }
    }
  })
})

describe('走子生成', () => {
  it('兵只能向前斜走一格（黑方向上、白方向下）', () => {
    const blackMan = boardFromRows(['........', '........', '.b......'])
    expect(quietMovesFrom(blackMan, indexOf(2, 1))).toEqual([
      { from: indexOf(2, 1), to: indexOf(1, 0), captured: null },
      { from: indexOf(2, 1), to: indexOf(1, 2), captured: null },
    ])
    const whiteMan = boardFromRows(['........', '........', '.w......'])
    expect(quietMovesFrom(whiteMan, indexOf(2, 1))).toEqual([
      { from: indexOf(2, 1), to: indexOf(3, 0), captured: null },
      { from: indexOf(2, 1), to: indexOf(3, 2), captured: null },
    ])
  })

  it('王可以前后斜走一格', () => {
    const king = boardFromRows(['........', '........', '.B......'])
    expect(quietMovesFrom(king, indexOf(2, 1))).toEqual([
      { from: indexOf(2, 1), to: indexOf(1, 0), captured: null },
      { from: indexOf(2, 1), to: indexOf(1, 2), captured: null },
      { from: indexOf(2, 1), to: indexOf(3, 0), captured: null },
      { from: indexOf(2, 1), to: indexOf(3, 2), captured: null },
    ])
  })

  it('落点有子 / 走出棋盘都不生成着法', () => {
    // (2,1) 前方 (1,0) 有自己的子 → 只剩 (1,2)
    const blocked = boardFromRows(['........', 'b.......', '.b......'])
    expect(quietMovesFrom(blocked, indexOf(2, 1)).map((move) => move.to)).toEqual([indexOf(1, 2)])
    // (0,1) 再往前就出界
    const edge = boardFromRows(['.b......'])
    expect(quietMovesFrom(edge, indexOf(0, 1))).toEqual([])
  })
})

describe('吃子生成（含兵的后向吃子）', () => {
  it('跳过相邻敌子落到其后空格才算吃子；兵可前可后', () => {
    const forward = boardFromRows(['........', '..w.....', '.b......'])
    expect(captureMovesFrom(forward, indexOf(2, 1))).toEqual([
      { from: indexOf(2, 1), to: indexOf(0, 3), captured: indexOf(1, 2) },
    ])
    const backward = boardFromRows(['........', '........', '.b......', '..w.....'])
    expect(captureMovesFrom(backward, indexOf(2, 1))).toEqual([
      { from: indexOf(2, 1), to: indexOf(4, 3), captured: indexOf(3, 2) },
    ])
  })

  it('王四方向都能吃', () => {
    const king = boardFromRows(['........', '..w.....', '.B......', '..w.....'])
    const targets = captureMovesFrom(king, indexOf(2, 1)).map((move) => move.to)
    expect(targets).toContain(indexOf(0, 3))
    expect(targets).toContain(indexOf(4, 3))
  })

  it('中间是空 / 中间是自己人 / 落点有子 都不算吃子', () => {
    // 中间 (1,2) 是空的
    const overEmpty = boardFromRows(['........', '........', '.b......'])
    expect(captureMovesFrom(overEmpty, indexOf(2, 1))).toEqual([])
    // 中间 (1,2) 是自己的子
    const ownPiece = boardFromRows(['........', '..b.....', '.b......'])
    expect(captureMovesFrom(ownPiece, indexOf(2, 1))).toEqual([])
    // 中间是敌子但落点 (0,3) 被自己的子占着
    const landingTaken = boardFromRows(['...b....', '..w.....', '.b......'])
    expect(captureMovesFrom(landingTaken, indexOf(2, 1))).toEqual([])
  })
})

describe('强制吃子', () => {
  it('存在吃子时 legalMovesFor 只返回吃子着法', () => {
    // 黑兵 (2,1) 可以吃 (1,2)；同时 (2,1)→(1,0) 与 (6,3) 的走子都还在
    const board = boardFromRows([
      '........',
      '..w.....',
      '.b......',
      '........',
      '........',
      '........',
      '...b....',
    ])
    const quiet = [
      ...quietMovesFrom(board, indexOf(2, 1)),
      ...quietMovesFrom(board, indexOf(6, 3)),
    ]
    expect(quiet.length).toBeGreaterThan(0)
    const legal = legalMovesFor(board, BLACK)
    expect(legal).toHaveLength(1)
    expect(legal[0]).toEqual({
      from: indexOf(2, 1),
      to: indexOf(0, 3),
      captured: indexOf(1, 2),
    })
    // 白方也有吃子（跳过 (2,1)），因此它同样只能吃
    const whiteLegal = legalMovesFor(board, WHITE)
    expect(whiteLegal.length).toBeGreaterThan(0)
    expect(whiteLegal.every((move) => move.captured !== null)).toBe(true)
  })

  it('没有吃子时才返回走子', () => {
    const board = boardFromRows(['........', '........', '.b......', '........', '.w......'])
    const whiteMoves = legalMovesFor(board, WHITE)
    expect(whiteMoves.length).toBeGreaterThan(0)
    expect(whiteMoves.every((move) => move.captured === null)).toBe(true)
    expect(captureMovesFor(board, WHITE)).toEqual([])
    expect(captureMovesFor(board, BLACK)).toEqual([])
  })
})

describe('连跳枚举', () => {
  it('一步吃之后还有吃子 → 必须继续，最终展开成一个完整回合', () => {
    const board = boardFromRows(['........', '....w...', '........', '..w.....', '.b......'])
    const turns = enumerateTurns(board, BLACK)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toEqual([
      { from: indexOf(4, 1), to: indexOf(2, 3), captured: indexOf(3, 2) },
      { from: indexOf(2, 3), to: indexOf(0, 5), captured: indexOf(1, 4) },
    ])
  })

  it('有多种吃法时每一种都是一个完整回合', () => {
    const board = boardFromRows(['........', '........', '........', '..w.w...', '...b....'])
    const turns = enumerateTurns(board, BLACK)
    expect(turns).toHaveLength(2)
    expect(turns.map((turn) => turn[0]!.to).sort((a, b) => a - b)).toEqual([
      indexOf(2, 1),
      indexOf(2, 5),
    ])
  })

  it('没有合法着法时返回空数组（无子可动）', () => {
    expect(enumerateTurns(boardFromRows(['.b......']), BLACK)).toEqual([])
  })
})

describe('落子与升王', () => {
  it('applyMove 移动棋子并移除被跳过的敌子，不改原数组', () => {
    const board = boardFromRows(['........', '..w.....', '.b......'])
    const move = captureMovesFrom(board, indexOf(2, 1))[0]!
    const next = applyMove(board, move)
    expect(next[indexOf(2, 1)]).toBe(EMPTY)
    expect(next[indexOf(1, 2)]).toBe(EMPTY)
    expect(next[indexOf(0, 3)]).toBe(BLACK_MAN)
    // 原盘面不变
    expect(board[indexOf(2, 1)]).toBe(BLACK_MAN)
    expect(board[indexOf(1, 2)]).toBe(WHITE_MAN)
  })

  it('兵到达对方底线升王；王保持不变', () => {
    expect(promotedPiece(BLACK_MAN, indexOf(0, 1))).toBe(BLACK_KING)
    expect(promotedPiece(BLACK_MAN, indexOf(1, 0))).toBe(BLACK_MAN)
    expect(promotedPiece(WHITE_MAN, indexOf(7, 0))).toBe(WHITE_KING)
    expect(promotedPiece(BLACK_KING, indexOf(0, 1))).toBe(BLACK_KING)
  })

  it('promoteAt 只在底线返回新棋盘', () => {
    const notLastRow = boardFromRows(['........', 'b.......'])
    expect(promoteAt(notLastRow, indexOf(1, 0))).toBeNull()
    const lastRow = boardFromRows(['.b......'])
    const promoted = promoteAt(lastRow, indexOf(0, 1))
    expect(promoted).not.toBeNull()
    expect(promoted![indexOf(0, 1)]).toBe(BLACK_KING)
    // 原棋盘不变
    expect(lastRow[indexOf(0, 1)]).toBe(BLACK_MAN)
  })

  it('applyTurn 会把连跳走完并在最后升王', () => {
    const board = boardFromRows(['........', '....w...', '........', '..w.....', '.b......'])
    const turn = enumerateTurns(board, BLACK)[0]!
    const next = applyTurn(board, turn)
    expect(next[indexOf(0, 5)]).toBe(BLACK_KING)
    expect(next[indexOf(4, 1)]).toBe(EMPTY)
    expect(next[indexOf(3, 2)]).toBe(EMPTY)
    expect(next[indexOf(1, 4)]).toBe(EMPTY)
    expect(countPieces(next)).toEqual({ black: 1, white: 0, blackKings: 1, whiteKings: 0 })
  })
})

describe('计数与子力价值', () => {
  it('countPieces 区分兵与王', () => {
    const board = boardFromRows(['.B......', '..b.....', '.w......', '..W.....'])
    expect(countPieces(board)).toEqual({ black: 2, white: 2, blackKings: 1, whiteKings: 1 })
    expect(countPieces(emptyBoard())).toEqual({ black: 0, white: 0, blackKings: 0, whiteKings: 0 })
  })

  it('王比兵值钱，空为 0', () => {
    expect(pieceValue(BLACK_MAN)).toBe(MAN_VALUE)
    expect(pieceValue(BLACK_KING)).toBe(KING_VALUE)
    expect(pieceValue(EMPTY)).toBe(0)
    expect(KING_VALUE).toBeGreaterThan(MAN_VALUE)
  })
})
