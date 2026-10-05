/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n / 元信息。
 * 重点：
 *   - 1-bit 呈现约定（● / ○ / 小点提示、不加分组线、stats 只有三项）；
 *   - `encode`/`decode` 严格往返，坏数据（含被改过的盘面与历史）一律抛 IllegalActionError；
 *   - 壳层会取到的 key 在两种语言里都能取到。
 */
import { describe, expect, it } from 'vitest'
import {
  IllegalActionError,
  baseKeys,
  compareDicts,
  coreDictEn,
  coreDictZh,
  createI18n,
  type Dict,
} from '@eink/core'
import {
  BLACK,
  CELLS,
  DIFFICULTY_IDS,
  EMPTY,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  WHITE,
  countDiscs,
  legalActions,
  legalMovesFor,
  reduceReversi,
  reversiEn,
  reversiGame,
  reversiZh,
  type ReversiState,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { settle,  boardOf, fixtureState } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...reversiZh }
const en: Dict = { ...coreDictEn, ...reversiEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function fresh(): ReversiState {
  return reversiGame.create(20240607, 'starter')
}

/** 走 n 手（每手都取当前第一个合法落点），得到真实的中盘状态 */
function advance(state: ReversiState, plies: number): ReversiState {
  let current = state
  for (let ply = 0; ply < plies; ply++) {
    const move = legalActions(current).find(
      (action): action is { type: 'place'; index: number } => action.type === 'place',
    )
    if (!move) break
    current = settle(reduceReversi(current, move))
  }
  return current
}

describe('view / 1-bit 呈现约定', () => {
  it('AI（白方）末手带内框标记（lastTo=1），玩家末手无标记', () => {
    let state = fresh()
    state = settle(reduceReversi(state, { type: 'place', index: legalMovesFor(state.board, BLACK)[0]! }))
    expect(state.lastMove).not.toBeNull()
    expect(state.board[state.lastMove!]).toBe(WHITE) // 白方应手
    const cells = reversiGame.view(state).board!.cells
    const framed = cells.filter((cell) => cell.lastTo !== undefined)
    expect(framed).toHaveLength(1)
    expect(framed[0]!.index).toBe(state.lastMove)
    // 两拍第一拍：目标格（空格）先亮出同款内框
    const pending = reduceReversi(state, { type: 'place', index: legalMovesFor(state.board, BLACK)[0]! })
    const picked = reduceReversi(pending, { type: 'tick' })
    if (picked.opponentPick !== null && picked.opponentPick >= 0) {
      const pickCells = reversiGame.view(picked).board!.cells
      expect(pickCells[picked.opponentPick]!.lastTo).toBe(1)
      expect(picked.board[picked.opponentPick]).toBe(EMPTY) // 还没落
    }
  })

  it('8×8 棋盘、64 格、行优先索引，且没有分组线', () => {
    const view = reversiGame.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(8)
    expect(view.board!.rows).toBe(8)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 8×8 没有宫结构：多一层分组线只会让画面更花
    expect(view.board!.groups).toBeUndefined()
  })

  it('棋子用实心/空心圆（kind: tile），空格为空（kind: empty）', () => {
    const state = fresh()
    const cells = reversiGame.view(state).board!.cells
    expect(cells[27]!.kind).toBe('tile')
    expect(cells[27]!.glyph).toBe('●') // d5 黑
    expect(cells[36]!.kind).toBe('tile')
    expect(cells[36]!.glyph).toBe('●') // e4 黑
    expect(cells[28]!.kind).toBe('tile')
    expect(cells[28]!.glyph).toBe('○') // e5 白
    expect(cells[35]!.kind).toBe('tile')
    expect(cells[35]!.glyph).toBe('○') // d4 白
    expect(cells[0]!.kind).toBe('empty')
    expect(cells[0]!.glyph).toBe('')
    // 棋子不靠灰阶区分：字形不同即可
    expect(cells.filter((cell) => cell.glyph === '●')).toHaveLength(2)
    expect(cells.filter((cell) => cell.glyph === '○')).toHaveLength(2)
  })

  it('合法落点用小点标出（kind: number、glyph ·、字号减半）', () => {
    const state = fresh()
    const cells = reversiGame.view(state).board!.cells
    const hints = cells.filter((cell) => cell.kind === 'number')
    expect(hints.map((cell) => cell.index)).toEqual([20, 29, 34, 43])
    for (const hint of hints) {
      expect(hint.glyph).toBe(HINT_GLYPH)
      expect(hint.textScale).toBe(HINT_TEXT_SCALE)
    }
    // 棋子与空格不带 textScale（用默认字号）
    expect(cells[27]!.textScale).toBeUndefined()
    expect(cells[0]!.textScale).toBeUndefined()
  })

  it('提示点与规则层的合法落点始终一致（含中盘与自动过手之后）', () => {
    const state = advance(fresh(), 9)
    const hints = reversiGame
      .view(state)
      .board!.cells.filter((cell) => cell.kind === 'number')
      .map((cell) => cell.index)
    expect(hints).toEqual(legalMovesFor(state.board, BLACK))
    expect(hints.length).toBeGreaterThan(0)
  })

  it('stats 恰好三项：黑子 / 白子 / 步数', () => {
    const state = advance(fresh(), 3)
    const view = reversiGame.view(state)
    expect(view.stats).toHaveLength(3)
    const counts = countDiscs(state.board)
    expect(view.stats).toEqual([
      { labelKey: 'reversi.stat.black', value: String(counts.black) },
      { labelKey: 'reversi.stat.white', value: String(counts.white) },
      { labelKey: 'reversi.stat.moves', value: String(state.moves) },
    ])
  })

  it('进行中没有结果；自动过手时给出稳定文字提示', () => {
    const state = fresh()
    expect(reversiGame.view(state).result).toBeNull()
    expect(reversiGame.view(state).notice).toBeNull()

    const whiteStuck = fixtureState(
      boardOf([
        'WWWWWWWB',
        'WWBBBBBB',
        'WWWWBBBB',
        'WWWWBBBB',
        'WWWWWBBB',
        'WWBBBBWB',
        'WWWBWWWW',
        '··BBBBBB',
      ]),
      BLACK,
    )
    const after = settle(reduceReversi(whiteStuck, { type: 'place', index: 57 }))
    expect(reversiGame.view(after).notice).toEqual({ textKey: 'reversi.notice.opponentPass' })
  })
})

describe('controls / controlAction', () => {
  it('只声明撤销（重开由壳层渲染），没有历史时禁用', () => {
    const state = fresh()
    const controls = reversiGame.controls(state)
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)

    const played = settle(reduceReversi(state, { type: 'place', index: 20 }))
    expect(reversiGame.controls(played)[0]!.enabled).toBe(true)
  })

  it('controlAction 把按钮映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(reversiGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(reversiGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(reversiGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const played = reduceReversi(fresh(), { type: 'place', index: 20 })
    expect(reduceReversi(played, { type: 'undo' })).toEqual(fresh())
    expect(reduceReversi(played, { type: 'restart' })).toEqual(fresh())
  })
})

describe('encode / decode', () => {
  it('初始局面往返一致（含 JSON 往返）', () => {
    const state = fresh()
    expect(reversiGame.decode(reversiGame.encode(state))).toEqual(state)
    expect(reversiGame.decode(JSON.parse(JSON.stringify(reversiGame.encode(state))))).toEqual(state)
  })

  it('中盘状态（含历史快照）往返一致', () => {
    const state = advance(fresh(), 4)
    expect(state.history).toHaveLength(4)
    const decoded = reversiGame.decode(reversiGame.encode(state))
    expect(decoded).toEqual(state)
    expect(reversiGame.encode(decoded)).toEqual(reversiGame.encode(state))
  })

  it('终局状态往返一致且仍是终局', () => {
    let state = fresh()
    let guard = 0
    while (reversiGame.status(state) === 'playing' && guard++ < 80) {
      const move = legalActions(state).find(
        (action): action is { type: 'place'; index: number } => action.type === 'place',
      )
      if (!move) break
      state = settle(reduceReversi(state, move))
    }
    expect(reversiGame.status(state)).not.toBe('playing')
    const decoded = reversiGame.decode(reversiGame.encode(state))
    expect(decoded).toEqual(state)
    expect(reversiGame.status(decoded)).toBe(reversiGame.status(state))
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const raw = reversiGame.encode(advance(fresh(), 2)) as {
      board: number[]
      history: Array<Record<string, unknown>>
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, board: 'nope' },
      { ...raw, board: raw.board.slice(0, CELLS - 1) },
      { ...raw, board: [...raw.board, EMPTY] },
      { ...raw, board: raw.board.map((cell, index) => (index === 0 ? 3 : cell)) },
      { ...raw, turn: 0 },
      { ...raw, turn: 3 },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: 1.5 },
      { ...raw, moves: -1 },
      { ...raw, notice: 'nope' },
      { ...raw, history: 'nope' },
      // 历史长度与步数不符
      { ...raw, history: raw.history.slice(0, 1) },
      // 历史条目里的盘面被改（棋子数不变量被破坏）
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 0 ? { ...entry, board: (entry.board as number[]).map((cell) => (cell === 0 ? BLACK : cell)) } : entry,
        ),
      },
      // 历史条目的 turn 不是黑方
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? { ...entry, turn: WHITE } : entry)) },
      // 历史条目的手数顺序错乱
      { ...raw, history: raw.history.map((entry, index) => (index === 1 ? { ...entry, moves: 7 } : entry)) },
      // 盘面被多塞一颗子（棋子数 = 4 + 步数 + 游标 不成立）
      (() => {
        const board = raw.board.slice()
        board[board.indexOf(EMPTY)] = BLACK
        return { ...raw, board }
      })(),
    ]
    for (const candidate of bad) {
      expect(() => reversiGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })

  it('非终局且轮到黑方却无处可下 → 拒绝（两拍模型里只有「白方待应手」中间态合法）', () => {
    // 黑方 7 子排满第 8 横线、其余全白：黑方无棋可下，白方在 h8 还能翻掉整行 → 不是终局
    const board = boardOf([
      'W.BBWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
    ])
    const base = {
      difficulty: 'starter',
      seed: 3,
      board: [...board],
      rngCursor: 59, // 4 + 59 = 63 = 盘面棋子总数
      moves: 0,
      notice: null,
      history: [],
    }
    // 白方待应手（有棋可下）→ 合法中间态
    expect(() => reversiGame.decode({ ...base, turn: WHITE })).not.toThrow()
    // 黑方卡死 → 非法：两拍模型里黑方卡死会被自动过手，不可能停在黑方
    expect(() => reversiGame.decode({ ...base, turn: BLACK })).toThrow(IllegalActionError)
  })
})

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(reversiGame.id).toBe('reversi')
    expect(reversiGame.i18nNamespace).toBe('reversi')
    expect(reversiGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(reversiGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(reversiGame.illegalNoticeKey).toBe('reversi.illegal.notice')
    expect(reversiGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(reversiGame.difficulties.map((item) => item.labelKey)).toEqual([
      'reversi.difficulty.starter',
      'reversi.difficulty.skilled',
      'reversi.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((reversiGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家步数', () => {
    const state = advance(fresh(), 3)
    expect(reversiGame.contentId!(state)).toBe('starter')
    expect(reversiGame.movesOf!(state)).toBe(3)
    expect(reversiGame.contentId!(reversiGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('create 对不同难度的存档互不串味，索引越界难度拒绝', () => {
    expect(reversiGame.create(1, 'skilled').difficulty).toBe('skilled')
    expect(() => reversiGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })
})

describe('字典', () => {
  it('中英基础 key 集合完全一致，没有缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': reversiZh, 'en-US': reversiEn })).toEqual([])
    expect([...baseKeys(reversiZh)].sort()).toEqual([...baseKeys(reversiEn)].sort())
  })

  it('壳层必需的 key 都定义了', () => {
    const keys = [
      'reversi.title',
      'reversi.rules.body',
      'reversi.rules.body2',
      'reversi.rules.restart',
      'reversi.illegal.notice',
      'reversi.solved.best',
      'reversi.won.title',
      'reversi.lost.title',
      'reversi.draw.title',
      'reversi.notice.opponentPass',
      'reversi.notice.playerPass',
      ...DIFFICULTY_IDS.map((id) => `reversi.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(zh[key], key).toBeDefined()
      expect(en[key], key).toBeDefined()
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    // 结果明细与最佳成绩走 plural / 带 count 的 t()
    for (const key of ['reversi.result.black', 'reversi.result.white']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
  })

  it('view / controls / 格子标签用到的 key 都能取到，且 t() 的文案没有残留插值', () => {
    const state = fresh()
    const view = reversiGame.view(state)
    const keys: string[] = [
      `${reversiGame.i18nNamespace}.title`,
      `${reversiGame.i18nNamespace}.rules.body`,
      `${reversiGame.i18nNamespace}.rules.restart`,
      reversiGame.illegalNoticeKey!,
      ...view.stats.map((stat) => stat.labelKey),
      ...reversiGame.controls(state).map((control) => control.labelKey),
      ...reversiGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
      'reversi.notice.opponentPass',
      'reversi.notice.playerPass',
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
    // 「最佳成绩」由壳层带 {count} 取，因此单独检查（它必然会含 {count}）
    expect(i18nZh.t('reversi.solved.best', { count: 12 })).toBe('该难度最佳 12 步')
    expect(i18nEn.t('reversi.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
    // 结果标题与明细（zh 走 __other，en 有单复数）都能取到
    const over = fixtureState(
      boardOf([
        'BBBBBBBB',
        'BBBBBBBB',
        'BBBBBBBB',
        'BBBBBBBB',
        'WWWWWWWW',
        'WWWWWWWW',
        'WWWWWWWW',
        'WWWWWWWW',
      ]),
      BLACK,
    )
    const result = reversiGame.view(over).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      expect(i18nZh.plural(detail.key, 32, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 32, detail.params)).not.toContain('⟦')
      expect(i18nEn.plural(detail.key, 1, { count: 1 })).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('格子无障碍标签覆盖黑白棋用到的三种 kind', () => {
    for (const kind of ['tile', 'number', 'empty'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key]).toBeDefined()
      expect(en[key]).toBeDefined()
    }
  })
})
