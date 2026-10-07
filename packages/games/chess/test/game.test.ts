/**
 * GameDef / 视图呈现测试：圆片棋子、位置标记、两拍选中、吃子架、统计与结果文案。
 */
import { describe, expect, it } from 'vitest'
import {
  BLACK,
  WHITE,
  chessGame,
  legalActions,
  reduceChess,
  type ChessState,
} from '../src/index.js'
import { at, boardOf, settle, stateOf } from './helpers.js'

function fresh(): ChessState {
  return chessGame.create(20240607, 'starter')
}

function advance(state: ChessState, plies: number): ChessState {
  let current = state
  for (let ply = 0; ply < plies; ply++) {
    current = settle(current)
    const move = legalActions(current).find(
      (a): a is { type: 'move'; from: number; to: number } => a.type === 'move',
    )
    if (!move) break
    current = chessGame.reduce(current, move)
  }
  return settle(current)
}

describe('棋盘呈现', () => {
  it('8×8 网格、32 枚棋子、字母字形、圆片明暗区分两方', () => {
    const view = chessGame.view(fresh())
    expect(view.board!.cols).toBe(8)
    expect(view.board!.rows).toBe(8)
    const cells = view.board!.cells
    expect(cells).toHaveLength(64)
    const discs = cells.filter((c) => c.disc !== undefined)
    expect(discs).toHaveLength(32)
    expect(discs.filter((c) => c.disc === 'light')).toHaveLength(16)
    expect(discs.filter((c) => c.disc === 'dark')).toHaveLength(16)
    const glyphs = new Set(cells.map((c) => c.glyph ?? ''))
    expect(glyphs.has('K')).toBe(true)
    expect(glyphs.has('Q')).toBe(true)
    expect(glyphs.has('P')).toBe(true)
  })

  it('走一手后：白方起点圆点（空心）+ 终点单框、黑方应手圆点（实心）+ 双框', () => {
    const state = advance(fresh(), 1)
    const cells = chessGame.view(state).board!.cells
    const fromWhite = cells.find((c) => c.lastFrom === 0)
    const toWhite = cells.find((c) => c.lastTo === 0)
    const fromBlack = cells.find((c) => c.lastFrom === 1)
    const toBlack = cells.find((c) => c.lastTo === 1)
    expect(fromWhite).toBeDefined()
    expect(toWhite).toBeDefined()
    expect(fromBlack).toBeDefined()
    expect(toBlack).toBeDefined()
    expect(toBlack!.glyph).not.toBe('')
  })

  it('两拍第一拍：选中的黑子显示为选中态，第二拍落子', () => {
    let state = reduceChess(fresh(), { type: 'move', from: at(6, 4), to: at(4, 4) })
    state = reduceChess(state, { type: 'tick' })
    const pickFrom = state.history[0]!.white !== null ? null : null
    const cells = chessGame.view(state).board!.cells
    const selected = cells.filter((c) => c.selected)
    expect(selected).toHaveLength(1)
    expect(selected[0]!.disc).toBe('dark')
    expect(selected[0]!.index).toBe((state.opponentPick! >> 6) & 63)
    expect(pickFrom).toBeNull()
  })

  it('选中己方棋子亮出合法落点（goal）', () => {
    // 开局王被自己的子围死，没有路走 —— 选兵 e2 才是好例子
    const state = reduceChess(fresh(), { type: 'select', index: at(6, 4) })
    const cells = chessGame.view(state).board!.cells
    expect(cells.find((c) => c.index === at(6, 4))!.selected).toBe(true)
    const goals = cells.filter((c) => c.kind === 'goal')
    expect(goals).toHaveLength(2)
    // e2-e4 双步在合法集合里
    expect(cells.find((c) => c.index === at(4, 4))!.kind).toBe('goal')
  })
})

describe('吃子架与统计', () => {
  it('吃子架：白方战果在上、黑方战果在下，按 后/车/象/马/兵 排列', () => {
    // 黑方少一个兵、白方少一个马：战果 = 对方损失
    const board = boardOf([
      'rnbqkbnr', 'ppppppp1', '8', '8', '8', '8', 'PPPPPPPP', 'RNBQKB1R',
    ])
    const state = stateOf(board, WHITE, { castling: 0 })
    const captured = chessGame.view(state).captured!
    expect(captured.top).toBe('P')
    expect(captured.bottom).toBe('N')
  })

  it('统计三项：白子 / 黑子 / 步数', () => {
    const state = advance(fresh(), 2)
    const stats = chessGame.view(state).stats!
    expect(stats).toHaveLength(3)
    expect(stats[0]!.labelKey).toBe('chess.stat.white')
    expect(stats[2]!.labelKey).toBe('chess.stat.moves')
    expect(stats[2]!.value).toBe(String(state.moves))
  })
})

describe('结果文案', () => {
  it('白方将死黑方 → 你赢了', () => {
    const board = boardOf(['7k', '6QK', '8', '8', '8', '8', '8', '8'])
    const state = stateOf(board, BLACK, { castling: 0 })
    expect(chessGame.status(state)).toBe('won')
    expect(chessGame.view(state).result!.titleKey).toBe('chess.won.title')
  })

  it('逼和 → 和棋标题（GameStatus 仍是 won）', () => {
    const board = boardOf(['k7', '8', '1QK5', '8', '8', '8', '8', '8'])
    const state = stateOf(board, BLACK, { castling: 0 })
    expect(chessGame.status(state)).toBe('won')
    expect(chessGame.view(state).result!.titleKey).toBe('chess.draw.title')
    expect(chessGame.outcomeOf!(state)).toBe('draw')
  })
})

describe('注册表接口', () => {
  it('contentId = 难度，movesOf = 玩家步数，难度三档', () => {
    expect(chessGame.contentId!(fresh())).toBe('starter')
    expect(chessGame.movesOf!(fresh())).toBe(0)
    expect(chessGame.difficulties.map((d) => d.id)).toEqual(['starter', 'skilled', 'challenging'])
  })
})
