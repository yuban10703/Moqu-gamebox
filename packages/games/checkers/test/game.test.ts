/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK_MAN,
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  DRAW_PLIES,
  EMPTY,
  PIECE_TEXT_SCALE,
  checkersGame,
  countPieces,
  indexOf,
  initialBoard,
  legalActions,
  type CheckersState,
} from '../src/index.js'
import { boardFromRows, fixtureState, fresh } from './helpers.js'

function firstMove(state: CheckersState): { type: 'move'; from: number; to: number } {
  const action = legalActions(state).find(
    (item): item is { type: 'move'; from: number; to: number } => item.type === 'move',
  )
  if (!action) throw new Error('no legal move')
  return action
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(checkersGame.id).toBe('checkers')
    expect(checkersGame.i18nNamespace).toBe('checkers')
    expect(checkersGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(checkersGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(checkersGame.illegalNoticeKey).toBe('checkers.illegal.notice')
    expect(checkersGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(checkersGame.difficulties.map((item) => item.labelKey)).toEqual([
      'checkers.difficulty.starter',
      'checkers.difficulty.skilled',
      'checkers.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((checkersGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家回合数', () => {
    const start = fresh(1, 'skilled')
    const state = checkersGame.reduce(start, firstMove(start))
    expect(checkersGame.contentId!(state)).toBe('skilled')
    expect(checkersGame.movesOf!(state)).toBe(1)
    expect(checkersGame.contentId!(checkersGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(checkersGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(checkersGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(checkersGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('create 拒绝未知难度；不同难度规则相同、只有白方强度不同', () => {
    expect(() => checkersGame.create(0, 'impossible')).toThrow(IllegalActionError)
    for (const difficulty of DIFFICULTY_IDS) {
      const state = checkersGame.create(1, difficulty)
      expect(state.board).toEqual(initialBoard())
      expect(countPieces(state.board)).toEqual({
        black: 12,
        white: 12,
        blackKings: 0,
        whiteKings: 0,
      })
    }
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('8×8 棋盘、64 格、行优先索引，且没有分组线', () => {
    const view = checkersGame.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(BOARD_SIZE)
    expect(view.board!.rows).toBe(BOARD_SIZE)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    expect(view.board!.groups).toBeUndefined()
  })

  it('浅色格是 wall、深色空格是 empty、棋子是 tile + 字形 + textScale 0.6', () => {
    const cells = checkersGame.view(fresh()).board!.cells
    expect(cells[indexOf(0, 0)]).toEqual({ index: indexOf(0, 0), kind: 'wall', glyph: '' })
    expect(cells[indexOf(3, 0)]).toEqual({ index: indexOf(3, 0), kind: 'empty', glyph: '' })
    expect(cells[indexOf(5, 0)]).toEqual({
      index: indexOf(5, 0),
      kind: 'tile',
      glyph: '●',
      textScale: PIECE_TEXT_SCALE,
    })
    expect(cells[indexOf(0, 1)]!.kind).toBe('tile')
    expect(cells[indexOf(0, 1)]!.glyph).toBe('○')
    expect(cells.filter((cell) => cell.kind === 'wall')).toHaveLength(32)
    expect(cells.filter((cell) => cell.kind === 'tile')).toHaveLength(24)
  })

  it('王用带点的圆（◉ / ◎）与兵区分', () => {
    const board = boardFromRows(['.B......', '........', '.w......'])
    const cells = checkersGame.view(fixtureState(board)).board!.cells
    expect(cells[indexOf(0, 1)]!.glyph).toBe('◉')
    expect(cells[indexOf(2, 1)]!.glyph).toBe('○')
  })

  it('选中的棋子标 selected；上一步的起止格也标出来', () => {
    const start = fresh()
    const selected = checkersGame.reduce(start, { type: 'select', index: indexOf(5, 0) })
    const cells = checkersGame.view(selected).board!.cells
    expect(cells[indexOf(5, 0)]!.selected).toBe(true)
    expect(cells.filter((cell) => cell.selected === true)).toHaveLength(1)

    const played = checkersGame.reduce(start, firstMove(start))
    const lastMove = played.lastMove!
    const playedCells = checkersGame.view(played).board!.cells
    expect(playedCells[lastMove.from]!.selected).toBe(true)
    expect(playedCells[lastMove.to]!.selected).toBe(true)
  })

  it('stats 恰好三项：黑子 / 白子 / 步数', () => {
    const played = checkersGame.reduce(fresh(11, 'starter'), firstMove(fresh(11, 'starter')))
    const view = checkersGame.view(played)
    const counts = countPieces(played.board)
    expect(view.stats).toEqual([
      { labelKey: 'checkers.stat.black', value: String(counts.black) },
      { labelKey: 'checkers.stat.white', value: String(counts.white) },
      { labelKey: 'checkers.stat.moves', value: String(played.moves) },
    ])
  })

  it('进行中没有结果与提示；胜负和棋都给结果页', () => {
    expect(checkersGame.view(fresh()).result).toBeNull()
    expect(checkersGame.view(fresh()).notice).toBeNull()

    const won = fixtureState(boardFromRows(['.b......']))
    const wonResult = checkersGame.view(won).result!
    expect(wonResult.titleKey).toBe('checkers.won.title')
    expect(wonResult.details).toEqual([
      { key: 'checkers.result.black', params: { count: 1 } },
      { key: 'checkers.result.white', params: { count: 0 } },
      { key: 'checkers.result.moves', params: { count: 0 } },
    ])

    const lost = fixtureState(boardFromRows(['.w......']))
    expect(checkersGame.view(lost).result!.titleKey).toBe('checkers.lost.title')

    const draw = fixtureState(boardFromRows(['........', '........', '.b......', '........', '.w......']), {
      noProgressPlies: DRAW_PLIES,
    })
    expect(checkersGame.view(draw).result!.titleKey).toBe('checkers.draw.title')
  })
})

describe('controls', () => {
  it('只声明撤销（点格子是主要输入），不声明 dpad / 重开 / 下一关', () => {
    const controls = checkersGame.controls(fresh())
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.id === 'next-level')).toBe(false)
  })

  it('走过一整个回合之后 undo 才可用', () => {
    const start = fresh()
    const played = checkersGame.reduce(start, firstMove(start))
    expect(checkersGame.controls(played)[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返', () => {
    const start = checkersGame.create(2024, 'skilled')
    expect(checkersGame.decode(checkersGame.encode(start))).toEqual(start)
    let state = start
    for (let turn = 0; turn < 4; turn++) state = checkersGame.reduce(state, firstMove(state))
    expect(checkersGame.decode(checkersGame.encode(state))).toEqual(state)
    expect(
      checkersGame.decode(JSON.parse(JSON.stringify(checkersGame.encode(state)))),
    ).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = fresh(17, 'starter')
    played = checkersGame.reduce(played, firstMove(played))
    const raw = checkersGame.encode(played) as Record<string, unknown>
    const log = raw.log as Array<{ from: number; to: number }>
    const board = raw.board as number[]
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, difficulty: 'nope' },
      { ...raw, board: board.map((piece, index) => (index === indexOf(0, 1) ? EMPTY : piece)) },
      { ...raw, board: board.map((piece, index) => (index === indexOf(3, 0) ? BLACK_MAN : piece)) },
      { ...raw, log: [log[0]!, log[1]!, log[1]!] },
      { ...raw, log: log.slice(0, log.length - 1) },
      { ...raw, moves: (raw.moves as number) + 3 },
    ]
    for (const candidate of bad) {
      expect(() => checkersGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致，且仍能继续对局', () => {
    const rng = createRng(20240607)
    let state = checkersGame.create(20240607, 'starter')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 50000) {
      if (checkersGame.status(state) !== 'playing') {
        state = checkersGame.reduce(state, { type: 'restart' })
        continue
      }
      // 模拟随机点击：点到「自己的子 / 合法落点」才产生动作，其余点了没反应
      const index = rng.int(CELLS)
      const action = checkersGame.selectAction!(state, index)
      if (action === null) continue
      state = checkersGame.reduce(state, action)
      applied += 1

      const encoded = checkersGame.encode(state)
      const decoded = checkersGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(checkersGame.encode(decoded)).toEqual(encoded)
      expect(checkersGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(
        state,
      )
      if (checkersGame.status(state) === 'playing') {
        expect(
          checkersGame.legal(state).some((item) => item.type === 'move'),
          `step ${applied} 应当还有合法着法`,
        ).toBe(true)
      }
      state = decoded
    }
    expect(applied).toBe(60)
    // 每一步的存档都必须严格往返（上面已逐步断言）；这里确认对局没有卡在非法状态
    expect(['playing', 'won', 'lost']).toContain(checkersGame.status(state))
  })

  it('随机走完整局：每一步都合法、终局明确、全程可往返', () => {
    const rng = createRng(7)
    for (let seed = 0; seed < 4; seed++) {
      let state = checkersGame.create(seed, 'starter')
      let turns = 0
      while (checkersGame.status(state) === 'playing' && turns < 200) {
        const moves = checkersGame
          .legal(state)
          .filter(
            (item): item is { type: 'move'; from: number; to: number } => item.type === 'move',
          )
        expect(moves.length).toBeGreaterThan(0)
        state = checkersGame.reduce(state, moves[rng.int(moves.length)]!)
        turns += 1
        expect(checkersGame.decode(checkersGame.encode(state))).toEqual(state)
      }
      if (turns < 200) expect(checkersGame.status(state)).not.toBe('playing')
      expect(checkersGame.movesOf!(state)).toBeGreaterThan(0)
    }
  })

  it('真实终局状态也能严格往返（曾经出过 decode 拒绝自己状态的事故）', () => {
    const rng = createRng(4242)
    const outcomes = new Set<string>()
    for (let seed = 0; seed < 6; seed++) {
      let state = checkersGame.create(seed, 'starter')
      let guard = 0
      while (checkersGame.status(state) === 'playing' && guard++ < 250) {
        const moves = checkersGame
          .legal(state)
          .filter(
            (item): item is { type: 'move'; from: number; to: number } => item.type === 'move',
          )
        state = checkersGame.reduce(state, moves[rng.int(moves.length)]!)
      }
      if (checkersGame.status(state) === 'playing') continue
      expect(checkersGame.decode(checkersGame.encode(state))).toEqual(state)
      expect(checkersGame.decode(JSON.parse(JSON.stringify(checkersGame.encode(state))))).toEqual(
        state,
      )
      outcomes.add(checkersGame.status(state))
    }
    expect(outcomes.size).toBeGreaterThan(0)
  })

  it('白子的位置永远在深色格（不会因为任何操作跑到浅色格）', () => {
    const rng = createRng(99)
    let state = checkersGame.create(99, 'skilled')
    for (let turn = 0; turn < 30; turn++) {
      if (checkersGame.status(state) !== 'playing') break
      const moves = checkersGame
        .legal(state)
        .filter((item): item is { type: 'move'; from: number; to: number } => item.type === 'move')
      state = checkersGame.reduce(state, moves[rng.int(moves.length)]!)
      for (let index = 0; index < CELLS; index++) {
        if ((Math.floor(index / 8) + (index % 8)) % 2 === 0) {
          expect(state.board[index], `index ${index}`).toBe(EMPTY)
        }
      }
    }
  })
})

describe('性能', () => {
  it('challenging 白方应手 < 500ms（多个真实局面取最坏值）', () => {
    const rng = createRng(20240607)
    let worst = 0
    for (let seed = 0; seed < 3; seed++) {
      let state = checkersGame.create(seed, 'challenging')
      for (let turn = 0; turn < 4; turn++) {
        if (checkersGame.status(state) !== 'playing') break
        const moves = checkersGame
          .legal(state)
          .filter((item): item is { type: 'move'; from: number; to: number } => item.type === 'move')
        const move = moves[rng.int(moves.length)]!
        const started = performance.now()
        state = checkersGame.reduce(state, move)
        const elapsed = performance.now() - started
        if (elapsed > worst) worst = elapsed
      }
    }
    expect(worst).toBeLessThan(500)
  })

  it('存档/解码一整个中盘在宽松上限内', () => {
    let state = checkersGame.create(5, 'skilled')
    for (let turn = 0; turn < 8; turn++) {
      if (checkersGame.status(state) !== 'playing') break
      state = checkersGame.reduce(state, firstMove(state))
    }
    const started = performance.now()
    checkersGame.decode(checkersGame.encode(state))
    expect(performance.now() - started).toBeLessThan(300)
  })
})
