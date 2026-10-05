/**
 * 规则层测试：每一类棋子的走法边界、将帅安全（送将/照面）、终局判定、状态机语义。
 *
 * 两条独立复核路径（避免「用被测实现验证被测实现」）：
 * - 期望的落点集合全部**手写**在用例里，不调用任何生成器；
 * - 合法性过滤用 helpers 里独立实现的 `kingAttacked` / `facingKings`（按棋子逐类判断，
 *   与生产代码「从将的位置向外射线扫描」是两条不同的算法）交叉验证。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  ADVISOR,
  BLACK,
  CANNON,
  CELLS,
  CHARIOT,
  ELEPHANT,
  EMPTY,
  HORSE,
  KING,
  PAWN,
  RED,
  applyMove,
  createInitialBoard,
  encodeState,
  gameStatus,
  generateMoves,
  hasCrossedRiver,
  inCheck,
  inPalace,
  isDrawnByRepetition,
  legalActions,
  legalMoves,
  makePiece,
  moveFrom,
  moveTo,
  occurrenceCount,
  packMove,
  reduceXiangqi,
  selectAction,
  typeOf,
  type XiangqiState,
  type XiangqiTurn,
} from '../src/index.js'
import {
  ascii,
  at,
  blankBoard,
  boardOf,
  destsOf,
  facingKings,
  initialBoard,
  kingAttacked,
  moveKeepsKingSafe,
  movesOf,
  positionState,
  stateOf,
} from './helpers.js'

/** 单测摆盘底座：红帅 (9,4) + 黑将 (0,3) —— 两列不同、互不攻击，绝大多数用例直接在上面放子 */
function base(): number[] {
  const board = blankBoard()
  board[at(9, 4)] = makePiece(RED, KING)
  board[at(0, 3)] = makePiece(BLACK, KING)
  return board
}

/** 断言失败时附带 ASCII 盘面，排错更快 */
function expectDests(board: readonly number[], from: number, expected: readonly number[]): void {
  expect(destsOf(board, RED, from), `\n${ascii(board).join('\n')}`).toEqual(
    [...expected].sort((a, b) => a - b),
  )
}

describe('开局与走子生成的总量', () => {
  it('标准开局：双方各 44 种合法着法（象棋公认的开局着法数）', () => {
    const board = createInitialBoard()
    expect(legalMoves(board, RED)).toHaveLength(44)
    expect(legalMoves(board, BLACK)).toHaveLength(44)
  })

  it('perft：开局走法树的规模与象棋公认值一致（44 / 1920 / 79666）', () => {
    // 手工实现的三层走法树计数（不调用生产代码的搜索，只调用合法着法生成）
    const perft = (board: number[], side: 0 | 1, depth: number): number => {
      const moves = legalMoves(board, side)
      if (depth <= 1) return moves.length
      let nodes = 0
      for (const move of moves) {
        const work = board.slice()
        applyMove(work, move)
        const child = perft(work, side === RED ? BLACK : RED, depth - 1)
        nodes += child
      }
      return nodes
    }
    const board = createInitialBoard()
    expect(perft(board, RED, 1)).toBe(44)
    expect(perft(board, RED, 2)).toBe(1920)
    expect(perft(board, RED, 3)).toBe(79666)
  })

  it('摆盘 ASCII 与初始局面一致（红在下、黑在上）', () => {
    expect(ascii(createInitialBoard())).toEqual([
      'rnbakabnr',
      '.........',
      '.c.....c.',
      'p.p.p.p.p',
      '.........',
      '.........',
      'P.P.P.P.P',
      '.C.....C.',
      '.........',
      'RNBAKABNR',
    ])
  })

  it('生成的着法永远不落在己方子上，起点一定是自己的子', () => {
    const board = createInitialBoard()
    for (const side of [RED, BLACK] as const) {
      for (const move of generateMoves(board, side)) {
        const from = moveFrom(move)
        const to = moveTo(move)
        expect(from).toBeGreaterThanOrEqual(0)
        expect(to).toBeLessThan(CELLS)
        const target = board[to] as number
        expect(target === EMPTY || ((target >> 3) & 1) !== side).toBe(true)
        expect(((board[from] as number) >> 3) & 1).toBe(side)
        expect(typeOf(board[from] as number)).toBeGreaterThanOrEqual(KING)
      }
    }
  })

  it('仕/帅不出九宫、相不过河、兵不后退（开局与中局都成立）', () => {
    const board = createInitialBoard()
    for (const side of [RED, BLACK] as const) {
      for (const move of legalMoves(board, side)) {
        const from = moveFrom(move)
        const to = moveTo(move)
        const type = typeOf(board[from] as number)
        const toRow = Math.floor(to / 9)
        const toCol = to % 9
        const fromRow = Math.floor(from / 9)
        if (type === KING || type === ADVISOR) {
          expect(inPalace(side, toRow, toCol), `${type} 出九宫 ${from}->${to}`).toBe(true)
        }
        if (type === ELEPHANT) {
          expect(side === RED ? toRow >= 5 : toRow <= 4, `象过河 ${from}->${to}`).toBe(true)
        }
        if (type === PAWN) {
          expect(side === RED ? toRow <= fromRow : toRow >= fromRow, `兵后退 ${from}->${to}`).toBe(true)
          if (toRow === fromRow) {
            expect(hasCrossedRiver(side, fromRow), `未过河横走 ${from}->${to}`).toBe(true)
          }
        }
      }
    }
  })
})

describe('车：直线走、遇子止', () => {
  it('空盘上的车：四条直线共 16 个落点（下方被己方帅挡住一格）', () => {
    const board = base()
    const from = at(4, 4)
    board[from] = makePiece(RED, CHARIOT)
    const expected: number[] = []
    for (let col = 0; col < 9; col++) if (col !== 4) expected.push(at(4, col))
    for (let row = 0; row < 9; row++) if (row !== 4) expected.push(at(row, 4))
    expectDests(board, from, expected)
  })

  it('己方子挡住不能吃，敌子可以吃但不能穿过去', () => {
    const board = base()
    const from = at(4, 4)
    board[from] = makePiece(RED, CHARIOT)
    board[at(4, 6)] = makePiece(RED, PAWN)
    board[at(4, 2)] = makePiece(BLACK, PAWN)
    const dests = destsOf(board, RED, from)
    expect(dests).toContain(at(4, 5))
    expect(dests).not.toContain(at(4, 6))
    expect(dests).toContain(at(4, 3))
    expect(dests).toContain(at(4, 2)) // 吃
    expect(dests).not.toContain(at(4, 1)) // 不能穿过去
  })
})

describe('马：走日字、别马腿', () => {
  it('空盘上的马有 8 个落点', () => {
    const board = base()
    const from = at(4, 4)
    board[from] = makePiece(RED, HORSE)
    expectDests(board, from, [
      at(2, 3),
      at(2, 5),
      at(3, 2),
      at(3, 6),
      at(5, 2),
      at(5, 6),
      at(6, 3),
      at(6, 5),
    ])
  })

  it('别马腿：马腿被占时那两个方向的日字走不了（横向腿同理，敌子一样别腿）', () => {
    const board = base()
    const from = at(4, 4)
    board[from] = makePiece(RED, HORSE)
    board[at(3, 4)] = makePiece(BLACK, PAWN) // 挡住向上的马腿 → (2,3)/(2,5) 走不了
    board[at(4, 3)] = makePiece(RED, PAWN) // 挡住向左的马腿 → (3,2)/(5,2) 走不了
    expect(destsOf(board, RED, from)).toEqual(
      [at(3, 6), at(5, 6), at(6, 3), at(6, 5)].sort((a, b) => a - b),
    )
    // 腿上是敌子也照样别腿（不是「吃腿」）
    expect(destsOf(board, RED, from)).not.toContain(at(2, 3))
    expect(destsOf(board, RED, from)).not.toContain(at(3, 2))
  })

  it('马可以吃子，但不能落在己方子上', () => {
    const board = base()
    const from = at(4, 4)
    board[from] = makePiece(RED, HORSE)
    board[at(2, 3)] = makePiece(RED, PAWN)
    board[at(6, 5)] = makePiece(BLACK, PAWN)
    const dests = destsOf(board, RED, from)
    expect(dests).not.toContain(at(2, 3))
    expect(dests).toContain(at(6, 5))
  })
})

describe('相/象：走田字、塞象眼、不过河', () => {
  it('底线相只有 2 个田字落点，中路相有 4 个', () => {
    const corner = base()
    corner[at(9, 2)] = makePiece(RED, ELEPHANT)
    expectDests(corner, at(9, 2), [at(7, 0), at(7, 4)])

    const middle = base()
    middle[at(7, 4)] = makePiece(RED, ELEPHANT)
    expectDests(middle, at(7, 4), [at(5, 2), at(5, 6), at(9, 2), at(9, 6)])
  })

  it('塞象眼：田字中心有子就走不过去（敌我一样塞）', () => {
    const board = base()
    const from = at(7, 4)
    board[from] = makePiece(RED, ELEPHANT)
    board[at(6, 3)] = makePiece(BLACK, PAWN) // (7,4)->(5,2) 的象眼
    board[at(8, 5)] = makePiece(RED, PAWN) // (7,4)->(9,6) 的象眼
    expectDests(board, from, [at(5, 6), at(9, 2)])
  })

  it('象不过河：河沿上的相只剩回己方半场的两个落点', () => {
    const board = base()
    const from = at(5, 2)
    board[from] = makePiece(RED, ELEPHANT)
    // (3,0)、(3,4) 都在河对岸 → 非法
    expectDests(board, from, [at(7, 0), at(7, 4)])

    const blackSide = base()
    blackSide[at(4, 2)] = makePiece(BLACK, ELEPHANT)
    const dests = destsOf(blackSide, BLACK, at(4, 2))
    expect(dests.length).toBeGreaterThan(0)
    for (const to of dests) expect(Math.floor(to / 9)).toBeLessThanOrEqual(4)
  })
})

describe('仕/士与帅/将：不出九宫', () => {
  it('九宫中心的仕有 4 个斜向落点', () => {
    const board = base()
    const from = at(8, 4)
    board[from] = makePiece(RED, ADVISOR)
    expectDests(board, from, [at(7, 3), at(7, 5), at(9, 3), at(9, 5)])
  })

  it('九宫角上的仕只有 1 个落点：出九宫的斜走非法', () => {
    const board = base()
    const from = at(7, 3)
    board[from] = makePiece(RED, ADVISOR)
    // (6,2)、(6,4)、(8,2) 都在九宫外 → 只剩 (8,4)
    expectDests(board, from, [at(8, 4)])
  })

  it('帅在九宫内直走一步；出九宫与斜走都非法', () => {
    // 黑将放 (0,8)：既不与红帅同列，也不干扰下面的落点判断
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, KING)
    board[at(0, 8)] = makePiece(BLACK, KING)
    expectDests(board, at(9, 4), [at(8, 4), at(9, 3), at(9, 5)])

    const top = blankBoard()
    top[at(7, 3)] = makePiece(RED, KING)
    top[at(0, 8)] = makePiece(BLACK, KING)
    // (6,3) 出宫、(7,2)/(7,4) 是斜走（(7,4) 还在九宫里但帅不能斜走）
    expectDests(top, at(7, 3), [at(8, 3), at(7, 4)])
  })

  it('仕/帅的所有合法落点都在九宫内', () => {
    const board = base()
    board[at(7, 3)] = makePiece(RED, ADVISOR)
    board[at(9, 5)] = makePiece(RED, ADVISOR)
    for (const from of [at(7, 3), at(9, 5), at(9, 4)]) {
      for (const to of destsOf(board, RED, from)) {
        expect(inPalace(RED, Math.floor(to / 9), to % 9), `出九宫 ${from}->${to}`).toBe(true)
      }
    }
  })
})

describe('炮：不吃子时走法同车，吃子必须隔一个炮架', () => {
  it('空盘上的炮不吃子，只能走空格（16 个落点）', () => {
    const board = base()
    const from = at(4, 4)
    board[from] = makePiece(RED, CANNON)
    const expected: number[] = []
    for (let col = 0; col < 9; col++) if (col !== 4) expected.push(at(4, col))
    for (let row = 0; row < 9; row++) if (row !== 4) expected.push(at(row, 4))
    expectDests(board, from, expected)
  })

  it('隔一个子可以吃，隔两个子不能吃，没有炮架时紧贴的敌子也吃不到', () => {
    // 炮架 (4,5)、目标 (4,7)：隔一子，可吃
    const one = base()
    one[at(4, 4)] = makePiece(RED, CANNON)
    one[at(4, 5)] = makePiece(RED, PAWN)
    one[at(4, 7)] = makePiece(BLACK, PAWN)
    const oneDests = destsOf(one, RED, at(4, 4))
    expect(oneDests).toContain(at(4, 7))
    expect(oneDests).toContain(at(4, 3)) // 炮架之前照常走空格
    expect(oneDests).not.toContain(at(4, 6)) // 翻过炮架也只能吃第一个子，不能落空格

    // 炮架 (4,5) + 己方子 (4,6)：隔两个子，吃不到 (4,7) 的敌子
    const two = base()
    two[at(4, 4)] = makePiece(RED, CANNON)
    two[at(4, 5)] = makePiece(RED, PAWN)
    two[at(4, 6)] = makePiece(RED, PAWN)
    two[at(4, 7)] = makePiece(BLACK, PAWN)
    const twoDests = destsOf(two, RED, at(4, 4))
    expect(twoDests).not.toContain(at(4, 7))
    expect(twoDests).not.toContain(at(4, 6))

    // 没有炮架：紧贴的敌子吃不到
    const tight = base()
    tight[at(4, 4)] = makePiece(RED, CANNON)
    tight[at(4, 5)] = makePiece(BLACK, PAWN)
    expect(destsOf(tight, RED, at(4, 4))).not.toContain(at(4, 5))
  })

  it('炮可以隔着炮架吃对方的车（纵向同理）', () => {
    const board = base()
    board[at(5, 0)] = makePiece(RED, CANNON)
    board[at(5, 3)] = makePiece(RED, PAWN) // 炮架
    board[at(5, 6)] = makePiece(BLACK, CHARIOT) // 黑车
    expect(destsOf(board, RED, at(5, 0))).toContain(at(5, 6))

    const vertical = base()
    vertical[at(6, 8)] = makePiece(RED, CANNON)
    vertical[at(4, 8)] = makePiece(BLACK, PAWN) // 炮架（黑卒）
    vertical[at(1, 8)] = makePiece(BLACK, CHARIOT)
    expect(destsOf(vertical, RED, at(6, 8))).toContain(at(1, 8))
  })
})

describe('兵/卒：未过河只能向前，过河后可横走且不能后退', () => {
  it('红兵未过河只有向前一步（河沿上也不例外）', () => {
    const board = base()
    board[at(6, 4)] = makePiece(RED, PAWN)
    expectDests(board, at(6, 4), [at(5, 4)])

    const edge = base()
    edge[at(5, 4)] = makePiece(RED, PAWN)
    expectDests(edge, at(5, 4), [at(4, 4)]) // 行 5 还没过河 → 不能横走
  })

  it('红兵过河后可以横走，但永远不能后退；到底线只能横走', () => {
    const board = base()
    board[at(4, 4)] = makePiece(RED, PAWN)
    expectDests(board, at(4, 4), [at(3, 4), at(4, 3), at(4, 5)])

    const back = blankBoard()
    back[at(9, 4)] = makePiece(RED, KING)
    back[at(0, 6)] = makePiece(BLACK, KING)
    back[at(0, 4)] = makePiece(RED, PAWN)
    expectDests(back, at(0, 4), [at(0, 3), at(0, 5)])
  })

  it('黑卒对称：过河（行 ≥ 5）后才能横走，也不能后退', () => {
    const board = base()
    board[at(3, 4)] = makePiece(BLACK, PAWN)
    expect(destsOf(board, BLACK, at(3, 4))).toEqual([at(4, 4)])

    const crossed = base()
    crossed[at(5, 4)] = makePiece(BLACK, PAWN)
    expect(destsOf(crossed, BLACK, at(5, 4))).toEqual([at(5, 3), at(5, 5), at(6, 4)])

    const back = blankBoard()
    back[at(9, 0)] = makePiece(RED, KING)
    back[at(0, 3)] = makePiece(BLACK, KING)
    back[at(9, 4)] = makePiece(BLACK, PAWN)
    expect(destsOf(back, BLACK, at(9, 4))).toEqual([at(9, 3), at(9, 5)])
  })

  it('边线上的兵只剩两个方向', () => {
    const board = base()
    board[at(4, 0)] = makePiece(RED, PAWN)
    expectDests(board, at(4, 0), [at(3, 0), at(4, 1)])
  })
})

describe('将帅安全：不得送将、不得照面', () => {
  it('被牵制的车不能离开这条线（送将被拒）', () => {
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, KING)
    board[at(5, 4)] = makePiece(RED, CHARIOT) // 挡在黑车与红帅之间的车
    board[at(0, 4)] = makePiece(BLACK, CHARIOT)
    board[at(0, 8)] = makePiece(BLACK, KING)
    expect(kingAttacked(board, RED)).toBe(false) // 有子挡着，不算被将军

    const dests = destsOf(board, RED, at(5, 4))
    // 沿列 4 可以走（含吃黑车），但任何离开列 4 的走法都会送将
    expect(dests).toContain(at(0, 4))
    expect(dests).toContain(at(4, 4))
    expect(dests).toContain(at(6, 4))
    for (const to of dests) expect(to % 9).toBe(4)
    expect(dests).not.toContain(at(5, 3))
  })

  it('被将军时只能应将：每一种应手走完后都不再被将军', () => {
    const quiet = blankBoard()
    quiet[at(9, 4)] = makePiece(RED, KING)
    quiet[at(7, 4)] = makePiece(RED, CHARIOT)
    quiet[at(0, 4)] = makePiece(BLACK, CHARIOT)
    quiet[at(0, 8)] = makePiece(BLACK, KING)
    expect(kingAttacked(quiet, RED)).toBe(false)
    expect(inCheck(positionState(quiet), RED)).toBe(false)

    const checked = blankBoard()
    checked[at(9, 4)] = makePiece(RED, KING)
    checked[at(6, 3)] = makePiece(RED, CHARIOT)
    checked[at(0, 4)] = makePiece(BLACK, CHARIOT)
    checked[at(0, 8)] = makePiece(BLACK, KING)
    expect(inCheck(positionState(checked), RED)).toBe(true)
    const replies = movesOf(checked, RED)
    expect(replies.length).toBeGreaterThan(0)
    for (const move of replies) {
      // 每一种应手走完后都不能再被将军（独立实现复核）
      expect(
        moveKeepsKingSafe(checked, RED, packMove(move.from, move.to)),
        `${move.from}->${move.to}\n${ascii(checked).join('\n')}`,
      ).toBe(true)
    }
    // 只有「垫将」与「走帅」两类应手
    expect(replies).toContainEqual({ from: at(6, 3), to: at(6, 4) })
    expect(replies).toContainEqual({ from: at(9, 4), to: at(9, 3) })
  })

  it('任何走法都不能造成将帅照面', () => {
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, KING)
    board[at(5, 4)] = makePiece(RED, PAWN) // 唯一的挡子，挡住两个将
    board[at(0, 4)] = makePiece(BLACK, KING)
    expect(facingKings(board)).toBe(false)
    // 兵一旦横走（或后退）两个将就照面 → 只有向前这一步合法
    expect(destsOf(board, RED, at(5, 4))).toEqual([at(4, 4)])
    // 挡子还在时，红帅沿列上下走都合法
    const blocked = destsOf(board, RED, at(9, 4))
    expect(blocked).toContain(at(8, 4))
    expect(blocked).toContain(at(9, 3))
    expect(blocked).toContain(at(9, 5))

    // 挡子一没就是照面局面：红帅沿这一列怎么走都还是照面 → 只能离开这一列
    const open = board.slice()
    open[at(5, 4)] = EMPTY
    expect(facingKings(open)).toBe(true)
    const escape = destsOf(open, RED, at(9, 4))
    expect(escape).toContain(at(9, 3))
    expect(escape).toContain(at(9, 5))
    expect(escape).not.toContain(at(8, 4))
  })

  it('照面局面本身被判定为「将受到攻击」', () => {
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, KING)
    board[at(0, 4)] = makePiece(BLACK, KING)
    expect(facingKings(board)).toBe(true)
    expect(kingAttacked(board, RED)).toBe(true)
    expect(kingAttacked(board, BLACK)).toBe(true)
  })

  it('属性：连续 24 手的每个合法着法走完后，走子方的将都不被攻击（独立实现复核）', () => {
    const board = createInitialBoard()
    for (let ply = 0; ply < 24; ply++) {
      const side = ply % 2 === 0 ? RED : BLACK
      expect(kingAttacked(board, side)).toBe(false)
      const moves = legalMoves(board, side)
      expect(moves.length).toBeGreaterThan(0)
      for (const move of moves) {
        expect(
          moveKeepsKingSafe(board, side, move),
          `ply=${ply} ${moveFrom(move)}->${moveTo(move)}\n${ascii(board).join('\n')}`,
        ).toBe(true)
      }
      applyMove(board, moves[ply % moves.length] as number)
      expect(kingAttacked(board, side)).toBe(false)
      expect(facingKings(board)).toBe(false)
    }
  })
})

describe('将军 / 将死 / 困毙', () => {
  it('将军：被车照着就是 inCheck，但仍能应将', () => {
    const board = blankBoard()
    board[at(9, 4)] = makePiece(RED, KING)
    board[at(0, 4)] = makePiece(BLACK, CHARIOT)
    board[at(0, 0)] = makePiece(BLACK, KING)
    const state = positionState(board)
    expect(inCheck(state, RED)).toBe(true)
    expect(legalMoves(board, RED).length).toBeGreaterThan(0)
    expect(gameStatus(state)).toBe('playing')
  })

  it('将死：黑方被将军且无路可走 → status won', () => {
    const board = boardOf([
      'R...k....', // (0,0) 红车吊住黑将；(0,4) 黑将
      '.....R...', // (1,5) 红车封住 (0,5) 与 (1,4)
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '...K.....', // 红帅 (9,3)：与黑将不同列，不照面
    ])
    const state = positionState(board, { sideToMove: BLACK })
    expect(inCheck(state, BLACK)).toBe(true)
    expect(legalMoves(board, BLACK)).toHaveLength(0)
    expect(gameStatus(state)).toBe('won')
  })

  it('困毙：黑方没有被将军但无子可动 → 同样判红方胜', () => {
    const board = boardOf([
      '....k....', // 黑将 (0,4)
      '...R.....', // (1,3) 红车封 (0,3) 与 (1,4)
      '.....R...', // (2,5) 红车封 (0,5)
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '...K.....',
    ])
    const state = positionState(board, { sideToMove: BLACK })
    expect(inCheck(state, BLACK)).toBe(false)
    expect(legalMoves(board, BLACK)).toHaveLength(0)
    expect(gameStatus(state)).toBe('won')
  })

  it('红方被将死 → status lost', () => {
    const board = boardOf([
      '...k.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.....r...', // (8,5) 黑车封 (8,4)
      'r...K....', // (9,0) 黑车将军；(9,4) 红帅
    ])
    const state = positionState(board)
    expect(inCheck(state, RED)).toBe(true)
    expect(legalMoves(board, RED)).toHaveLength(0)
    expect(gameStatus(state)).toBe('lost')
  })

  it('红方被困毙 → 也判负', () => {
    const board = boardOf([
      '...k.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.....r...', // (7,5) 黑车封 (9,5)
      '...r.....', // (8,3) 黑车封 (9,3) 与 (8,4)
      '....K....', // 红帅 (9,4)：没有被将军
    ])
    const state = positionState(board)
    expect(inCheck(state, RED)).toBe(false)
    expect(legalMoves(board, RED)).toHaveLength(0)
    expect(gameStatus(state)).toBe('lost')
  })

  it('终局后 reduce 拒绝继续走子', () => {
    const board = boardOf([
      '...k.....',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '.....r...',
      'r...K....',
    ])
    const state = positionState(board)
    expect(gameStatus(state)).toBe('lost')
    expect(() => reduceXiangqi(state, { type: 'move', from: at(9, 4), to: at(9, 3) })).toThrow(
      IllegalActionError,
    )
  })
})

describe('三次重复局面判和', () => {
  /** 双方车沿边线来回走：4 个回合后回到初始局面第三次 → 判和 */
  const LOOP: XiangqiTurn[] = [
    { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
    { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
    { red: packMove(at(9, 0), at(8, 0)), black: packMove(at(0, 0), at(1, 0)) },
    { red: packMove(at(8, 0), at(9, 0)), black: packMove(at(1, 0), at(0, 0)) },
  ]

  it('同一局面第三次出现（黑方应手后）判和：和棋并入 won，之后不能再走', () => {
    const state = stateOf(LOOP)
    expect(state.moves).toBe(4)
    expect(occurrenceCount(state.board, state.sideToMove, state.history)).toBe(3)
    expect(isDrawnByRepetition(state)).toBe(true)
    expect(gameStatus(state)).toBe('won') // 和棋并入 won，壳层才会渲染结果面板
    expect(() => reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })).toThrow(
      IllegalActionError,
    )
  })

  it('红方一手造成第三次重复 → 黑方不再应手（black 为 null），仍是最后一回合', () => {
    const drawnAfterRed = stateOf([...LOOP, { red: packMove(at(9, 0), at(8, 0)), black: null }])
    expect(drawnAfterRed.history).toHaveLength(5)
    expect(drawnAfterRed.sideToMove).toBe(BLACK)
    expect(isDrawnByRepetition(drawnAfterRed)).toBe(true)
    expect(gameStatus(drawnAfterRed)).toBe('won')
  })

  it('只重复两次不算和（第 2、3 回合结束时各只出现两次）', () => {
    // 第 2 回合结束：回到初始局面（第二次）
    const twoRounds = stateOf(LOOP.slice(0, 2))
    expect(occurrenceCount(twoRounds.board, twoRounds.sideToMove, twoRounds.history)).toBe(2)
    expect(isDrawnByRepetition(twoRounds)).toBe(false)
    expect(gameStatus(twoRounds)).toBe('playing')

    // 第 3 回合结束：第 1 回合结束时的局面（第二次）
    const threeRounds = stateOf(LOOP.slice(0, 3))
    expect(occurrenceCount(threeRounds.board, threeRounds.sideToMove, threeRounds.history)).toBe(2)
    expect(isDrawnByRepetition(threeRounds)).toBe(false)
    expect(gameStatus(threeRounds)).toBe('playing')
  })
})

describe('动作语义：select / move / undo / restart', () => {
  it('select 只是界面状态：不计步、不进日志、可取消', () => {
    const state = stateOf([])
    const selected = reduceXiangqi(state, { type: 'select', index: at(9, 0) })
    expect(selected.selected).toBe(at(9, 0))
    expect(selected.moves).toBe(0)
    expect(selected.history).toHaveLength(0)
    expect(selected.board).toEqual(state.board)
    expect(selected.lastMove).toBeNull()
    expect(encodeState(selected)).toEqual({
      ...(encodeState(state) as Record<string, unknown>),
      selected: at(9, 0),
    })
    expect(reduceXiangqi(selected, { type: 'select', index: at(9, 0) }).selected).toBeNull()
  })

  it('select 拒绝空格、对方的子与越界格', () => {
    const state = stateOf([])
    expect(() => reduceXiangqi(state, { type: 'select', index: at(5, 4) })).toThrow(IllegalActionError)
    expect(() => reduceXiangqi(state, { type: 'select', index: at(0, 0) })).toThrow(IllegalActionError)
    expect(() => reduceXiangqi(state, { type: 'select', index: -1 })).toThrow(IllegalActionError)
    expect(() => reduceXiangqi(state, { type: 'select', index: CELLS })).toThrow(IllegalActionError)
  })

  it('selectAction：点自己的子选中、点高亮落点走子、点别处返回 null', () => {
    const state = stateOf([])
    expect(selectAction(state, at(9, 0))).toEqual({ type: 'select', index: at(9, 0) })
    expect(selectAction(state, at(5, 4))).toBeNull() // 空格且没选中
    expect(selectAction(state, at(0, 0))).toBeNull() // 对方的子

    const selected = reduceXiangqi(state, { type: 'select', index: at(9, 0) })
    expect(selectAction(selected, at(8, 0))).toEqual({ type: 'move', from: at(9, 0), to: at(8, 0) })
    expect(selectAction(selected, at(8, 1))).toBeNull() // 车走不到
    expect(selectAction(selected, at(9, 1))).toEqual({ type: 'select', index: at(9, 1) }) // 改选
  })

  it('move 只走红方；黑方应手分两拍（先选中、再落子），日志存两手', () => {
    const state = stateOf([])
    const afterMove = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
    expect(afterMove.moves).toBe(1)
    expect(afterMove.history).toHaveLength(1)
    const pending = afterMove.history[0] as XiangqiTurn
    expect(pending.red).toBe(packMove(at(9, 0), at(8, 0)))
    expect(pending.black).toBeNull()
    expect(afterMove.sideToMove).toBe(BLACK)
    expect(afterMove.rngCursor).toBe(0)
    expect(afterMove.selected).toBeNull()
    expect(afterMove.opponentPick).toBeNull()
    expect(afterMove.lastMove).toBe(pending.red)

    // 第一拍：只「选中」——盘面一格不动，但记下了 AI 挑中的着法
    const picked = reduceXiangqi(afterMove, { type: 'tick' })
    expect(picked.opponentPick).not.toBeNull()
    expect(picked.board).toEqual(afterMove.board)
    expect(picked.history[0]!.black).toBeNull()
    expect(picked.sideToMove).toBe(BLACK)

    // 第二拍：真正落子，回合补上黑方那一手
    const landed = reduceXiangqi(picked, { type: 'tick' })
    const turn = landed.history[0] as XiangqiTurn
    expect(turn.black).toBe(picked.opponentPick)
    expect(landed.opponentPick).toBeNull()
    expect(landed.sideToMove).toBe(RED)
    expect(landed.rngCursor).toBe(1)
    expect(landed.lastMove).toBe(turn.black)
  })

  it('非法着法被明确拒绝（原地、越界、走法不合兵种、吃自己的子、走空点）', () => {
    const state = stateOf([])
    const bad: Array<{ from: number; to: number }> = [
      { from: at(9, 0), to: at(9, 0) },
      { from: at(9, 0), to: CELLS },
      { from: at(9, 0), to: -1 },
      { from: at(9, 0), to: at(7, 1) }, // 车不能拐弯
      { from: at(9, 1), to: at(8, 1) }, // 马不走日字
      { from: at(9, 0), to: at(9, 1) }, // 车不能吃自己的马
      { from: at(9, 4), to: at(9, 3) }, // 帅不能吃自己的仕
      { from: at(7, 1), to: at(2, 1) }, // 炮不能直接吃挡在前面的子（没隔炮架）
      { from: at(7, 1), to: at(7, 7) }, // 炮不能吃自己的炮
      { from: at(6, 0), to: at(5, 1) }, // 兵不能斜走
      { from: at(5, 4), to: at(4, 4) }, // 空点不能走
    ]
    for (const move of bad) {
      expect(() => reduceXiangqi(state, { type: 'move', ...move }), JSON.stringify(move)).toThrow(
        IllegalActionError,
      )
    }
  })

  it('undo 退掉整整一回合（红黑两手一起），无历史时明确报错', () => {
    const state = stateOf([])
    const played = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
    const undone = reduceXiangqi(played, { type: 'undo' })
    expect(encodeState(undone)).toEqual(encodeState(state))
    expect(undone.history).toHaveLength(0)
    expect(undone.rngCursor).toBe(0)
    expect(undone.lastMove).toBeNull()
    expect(() => reduceXiangqi(state, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('undo 后原来选中的格子若已不是红子，选中被清掉（存档才不会自相矛盾）', () => {
    const state = stateOf([])
    const played = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
    const selected = reduceXiangqi(played, { type: 'select', index: at(8, 0) })
    const undone = reduceXiangqi(selected, { type: 'undo' })
    expect(undone.board[at(8, 0)]).toBe(EMPTY)
    expect(undone.selected).toBeNull()
    // 没动过的子仍然保持选中
    const other = reduceXiangqi(played, { type: 'select', index: at(9, 2) })
    expect(reduceXiangqi(other, { type: 'undo' }).selected).toBe(at(9, 2))
  })

  it('restart 回到同种子同难度的标准开局，终局后也能用', () => {
    const state = stateOf([])
    const played = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
    expect(encodeState(reduceXiangqi(played, { type: 'restart' }))).toEqual(encodeState(state))

    const mated = positionState(
      boardOf([
        '...k.....',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.....r...',
        'r...K....',
      ]),
    )
    expect(gameStatus(mated)).toBe('lost')
    const restarted = reduceXiangqi(mated, { type: 'restart' })
    expect(gameStatus(restarted)).toBe('playing')
    expect(restarted.board).toEqual(initialBoard())
  })

  it('未知动作明确报错；legal() 含选中/走子/重开，走一手后只剩 tick 与撤销', () => {
    const state = stateOf([])
    expect(() => reduceXiangqi(state, { type: 'nope' } as unknown as { type: 'undo' })).toThrow(
      IllegalActionError,
    )
    const actions = legalActions(state)
    expect(actions.filter((action) => action.type === 'select')).toHaveLength(16)
    expect(actions.filter((action) => action.type === 'move')).toHaveLength(44)
    expect(actions.some((action) => action.type === 'restart')).toBe(true)
    expect(actions.some((action) => action.type === 'undo')).toBe(false)

    const played = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
    // 黑方待应手：这一拍只给 tick（不是玩家输入），撤销/重开照旧可用
    const pendingActions = legalActions(played)
    expect(pendingActions.filter((action) => action.type === 'tick')).toHaveLength(1)
    expect(pendingActions.filter((action) => action.type === 'select')).toHaveLength(0)
    expect(pendingActions.some((action) => action.type === 'undo')).toBe(true)
    expect(pendingActions.some((action) => action.type === 'restart')).toBe(true)
  })

  it('legal() 里的每一个动作都能真正执行', () => {
    let state: XiangqiState = stateOf([])
    for (let round = 0; round < 3; round++) {
      for (const action of legalActions(state)) {
        expect(() => reduceXiangqi(state, action), JSON.stringify(action)).not.toThrow()
      }
      state = reduceXiangqi(state, { type: 'move', from: at(9, 0), to: at(8, 0) })
      state = reduceXiangqi(state, { type: 'undo' })
    }
  })

  it('照面判定与生产代码一致（独立实现交叉验证）', () => {
    const facing = blankBoard()
    facing[at(9, 4)] = makePiece(RED, KING)
    facing[at(0, 4)] = makePiece(BLACK, KING)
    expect(facingKings(facing)).toBe(true)
    const blocked = facing.slice()
    blocked[at(4, 4)] = makePiece(RED, PAWN)
    expect(facingKings(blocked)).toBe(false)
    expect(facingKings(base())).toBe(false)
  })
})
