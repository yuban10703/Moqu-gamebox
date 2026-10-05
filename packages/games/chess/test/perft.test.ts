/**
 * perft 交叉验证：用公开的走法树节点数核对走子生成。
 *
 * 开局 perft(1..4) = 20 / 400 / 8902 / 197281 是国际象棋的事实常量；
 * Kiwipete 局面 perft(3) = 97862（含吃过路兵与双方向易位）；
 * 易位局面 perft(1..3) = 26 / 568 / 13744；
 * 吃过路兵专用局面 perft(1..3) = 14 / 191 / 2812。
 * 任何一处对不上都说明走子/送将过滤有 bug —— 这类测试是规则层的命根子。
 */
import { describe, expect, it } from 'vitest'
import {
  BLACK,
  CASTLE_ALL,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  EMPTY,
  WHITE,
  applyMoveOn,
  createInitialBoard,
  indexOf,
  legalMovesOn,
  packMove,
  undoMoveOn,
  type MutablePosition,
  type Piece,
} from '../src/board.js'

/** 按「行字符串 + 易位权 + ep」摆一个位置（行从上到下 = 黑方到白方） */
function positionOf(
  rows: readonly string[],
  side: 0 | 1,
  castling: number,
  ep: string | null = null,
): MutablePosition {
  if (rows.length !== 8) throw new Error('bad position rows')
  const board = new Array<Piece>(64).fill(EMPTY)
  for (let r = 0; r < 8; r++) {
    let col = 0
    for (const ch of rows[r]!) {
      if (ch >= '1' && ch <= '8') {
        col += Number(ch)
        continue
      }
      const lower = ch.toLowerCase()
      const types: Record<string, number> = { k: 1, q: 2, r: 3, b: 4, n: 5, p: 6 }
      const type = types[lower]
      if (type === undefined) throw new Error(`bad piece char ${ch}`)
      board[indexOf(r, col)] = (ch === lower ? BLACK : WHITE) * 8 + type
      col++
    }
    if (col !== 8) throw new Error(`bad row length: ${rows[r]}`)
  }
  return {
    board,
    sideToMove: side as 0 | 1,
    castling,
    epSquare: ep === null ? null : parseEp(ep),
  }
}

/** 'e3' 这种代数格 → 索引 */
function parseEp(ep: string): number {
  const file = ep.charCodeAt(0) - 97
  const rank = 8 - Number(ep[1]) // rank 1 = row 7
  return indexOf(rank, file)
}

function perft(pos: MutablePosition, depth: number): number {
  if (depth === 0) return 1
  const moves = legalMovesOn(pos)
  if (depth === 1) return moves.length
  let nodes = 0
  for (const move of moves) {
    const info = applyMoveOn(pos, move)
    nodes += perft(pos, depth - 1)
    undoMoveOn(pos, move, info)
  }
  return nodes
}

describe('开局走法树（公开值交叉验证）', () => {
  const cases: ReadonlyArray<[number, number]> = [
    [1, 20],
    [2, 400],
    [3, 8902],
    [4, 197281],
  ]
  for (const [depth, expected] of cases) {
    it(`perft(${depth}) = ${expected}`, () => {
      const pos: MutablePosition = {
        board: createInitialBoard(),
        sideToMove: WHITE,
        castling: CASTLE_ALL,
        epSquare: null,
      }
      expect(perft(pos, depth)).toBe(expected)
    }, 120000)
  }
})

describe('Kiwipete 局面（吃过路兵 + 双方向易位）', () => {
  it('perft(3) = 97862', () => {
    const pos = positionOf(
      [
        'r3k2r',
        'p1ppqpb1',
        'bn2pnp1',
        '3PN3',
        '1p2P3',
        '2N2Q1p',
        'PPPBBPPP',
        'R3K2R',
      ],
      WHITE,
      CASTLE_ALL,
    )
    expect(perft(pos, 3)).toBe(97862)
  }, 120000)
})

describe('易位专用局面', () => {
  it('perft(1..3) = 26 / 568 / 13744', () => {
    const pos = positionOf(
      ['r3k2r', '8', '8', '8', '8', '8', '8', 'R3K2R'],
      WHITE,
      CASTLE_ALL,
    )
    expect(perft(pos, 1)).toBe(26)
    expect(perft(pos, 2)).toBe(568)
    expect(perft(pos, 3)).toBe(13744)
  }, 120000)
})

describe('吃过路兵专用局面（含钉子过滤）', () => {
  it('perft(1..3) = 14 / 191 / 2812', () => {
    const pos = positionOf(
      ['8', '2p5', '3p4', 'KP5r', '1R3p1k', '8', '4P1P1', '8'],
      WHITE,
      0,
      null,
    )
    expect(perft(pos, 1)).toBe(14)
    expect(perft(pos, 2)).toBe(191)
    expect(perft(pos, 3)).toBe(2812)
  }, 120000)
})

describe('apply / undo 互逆与易位权维护', () => {
  it('任意一手 apply 后 undo 恢复原状（易位局面抽查）', () => {
    const pos = positionOf(
      ['r3k2r', '8', '8', '8', '8', '8', '8', 'R3K2R'],
      WHITE,
      CASTLE_ALL,
    )
    const before = JSON.stringify(pos)
    for (const move of legalMovesOn(pos)) {
      const info = applyMoveOn(pos, move)
      undoMoveOn(pos, move, info)
      expect(JSON.stringify(pos)).toBe(before)
    }
  })

  it('王车易位：王到 g1、车到 f1、双方王翼易位权清掉', () => {
    const pos = positionOf(
      ['r3k2r', '8', '8', '8', '8', '8', '8', 'R3K2R'],
      WHITE,
      CASTLE_ALL,
    )
    applyMoveOn(pos, packMove(60, 62))
    expect(pos.board[62]).toBe(WHITE * 8 + 1) // 白王到 g1
    expect(pos.board[61]).toBe(WHITE * 8 + 3) // 白车到 f1
    expect(pos.board[63]).toBe(EMPTY)
    expect(pos.castling & CASTLE_WK).toBe(0)
    expect(pos.castling & CASTLE_WQ).toBe(0)
    expect(pos.castling & CASTLE_BK).toBe(CASTLE_BK) // 黑方权不动
    expect(pos.castling & CASTLE_BQ).toBe(CASTLE_BQ)
  })

  it('吃过路兵：白兵 e5 吃到 f6，f5 那枚黑兵被移走', () => {
    // 黑兵 f7-f5 双步后，白兵 e5 可吃过路兵到 f6（f5 的黑兵被移走）
    const pos = positionOf(
      ['8', '8', '8', '4Pp2', '8', '8', '8', '8'],
      WHITE,
      0,
      'f6',
    )
    // e5 = row 3 col 4；f5 = row 3 col 5；f6 = row 2 col 5
    const ep = indexOf(2, 5)
    expect(pos.epSquare).toBe(ep)
    const move = packMove(indexOf(3, 4), ep)
    const info = applyMoveOn(pos, move)
    expect(pos.board[ep]).toBe(WHITE * 8 + 6) // 白兵到 f6
    expect(pos.board[indexOf(3, 5)]).toBe(EMPTY) // f5 黑兵被移走
    expect(info.captured).toBe(BLACK * 8 + 6)
    expect(info.capturedIndex).toBe(indexOf(3, 5))
    undoMoveOn(pos, move, info)
    expect(pos.board[indexOf(3, 5)]).toBe(BLACK * 8 + 6)
    expect(pos.board[indexOf(3, 4)]).toBe(WHITE * 8 + 6)
    expect(pos.board[ep]).toBe(EMPTY)
  })

  it('升变：白兵 a7→a8 自动变后，undo 还原成兵', () => {
    const pos = positionOf(
      ['8', '8', '8', '8', '8', '8', '8', '8'],
      WHITE,
      0,
      null,
    )
    pos.board[indexOf(1, 0)] = WHITE * 8 + 6 // 白兵放 a7（row 1）
    const move = packMove(indexOf(1, 0), indexOf(0, 0))
    const info = applyMoveOn(pos, move)
    expect(pos.board[indexOf(0, 0)]).toBe(WHITE * 8 + 2) // 升后
    undoMoveOn(pos, move, info)
    expect(pos.board[indexOf(1, 0)]).toBe(WHITE * 8 + 6) // 还原成兵
    expect(pos.board[indexOf(0, 0)]).toBe(EMPTY)
  })
})
