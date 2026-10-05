/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n / 元信息。
 * 重点：
 *   - 1-bit 呈现约定（● / ○、最后一手加粗放大且**不反白**、不加分组线、stats 只有三项）；
 *   - `encode`/`decode` 严格往返，坏数据一律抛 IllegalActionError；
 *   - 属性测试：随机走若干合法动作后 encode→decode 必须往返一致
 *     （项目曾因「decode 拒绝游戏自己产生的状态」出过事故，这条用例是第一道闸门）。
 */
import { describe, expect, it } from 'vitest'
import {
  IllegalActionError,
  baseKeys,
  compareDicts,
  coreDictEn,
  coreDictZh,
  createI18n,
  createRng,
  type Dict,
} from '@eink/core'
import {
  BLACK,
  CELLS,
  DIFFICULTY_IDS,
  EMPTY,
  WHITE,
  cellGlyphAt,
  cellKindAt,
  countStones,
  encodeState,
  gomokuEn,
  gomokuGame,
  gomokuZh,
  legalActions,
  reduceGomoku,
  type GomokuState,
} from '../src/index.js'
import { CELL_LABEL_KEYS } from '../src/view.js'
import { at, crowdedState, fillNoFiveBoard, playerMoves, settle, stateOf } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...gomokuZh }
const en: Dict = { ...coreDictEn, ...gomokuEn }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function fresh(): GomokuState {
  return gomokuGame.create(20240607, 'starter')
}

/** 走 n 手（每手都取当前第一个合法落点），得到真实的中盘状态 */
function advance(state: GomokuState, plies: number): GomokuState {
  let current = state
  for (let ply = 0; ply < plies; ply++) {
    current = settle(current)
    const move = legalActions(current).find(
      (action): action is { type: 'place'; index: number } => action.type === 'place',
    )
    if (!move) break
    current = gomokuGame.reduce(current, move)
  }
  return settle(current)
}

/** 一直走到终局（玩家每手取第一个合法点） */
function playToEnd(state: GomokuState): GomokuState {
  let current = state
  let guard = 0
  while (gomokuGame.status(current) === 'playing' && guard++ < CELLS) {
    const move = legalActions(current).find(
      (action): action is { type: 'place'; index: number } => action.type === 'place',
    )
    if (!move) break
    current = settle(gomokuGame.reduce(current, move))
  }
  return current
}

/** 用固定种子的随机策略走若干步（含撤销/重开），返回走过的状态序列 */
function walkRandom(state: GomokuState, steps: number, seed: number): GomokuState[] {
  const rng = createRng(seed)
  const trail: GomokuState[] = [state]
  let current = state
  for (let step = 0; step < steps; step++) {
    const actions = legalActions(current)
    const action = actions[rng.int(actions.length)]
    if (!action) break
    current = gomokuGame.reduce(current, action)
    trail.push(current)
  }
  return trail
}

describe('view / 1-bit 呈现约定', () => {
  it('15×15 棋盘、225 格、行优先索引，且没有分组线', () => {
    const view = gomokuGame.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(15)
    expect(view.board!.rows).toBe(15)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 15×15 没有宫结构：多一层分组线只会让画面更花
    expect(view.board!.groups).toBeUndefined()
  })

  it('棋子用实心/空心圆（kind: tile），空格为空（kind: empty、glyph 空）', () => {
    const state = advance(fresh(), 5)
    const cells = gomokuGame.view(state).board!.cells
    for (let index = 0; index < CELLS; index++) {
      const stone = state.board[index]
      if (stone === EMPTY) {
        expect(cells[index]!.kind).toBe('empty')
        expect(cells[index]!.glyph).toBe('')
        expect(cells[index]!.selected).toBeUndefined()
      } else {
        // 所有棋子都是 tile：末手不再借 'given'（玩家的放大效果已按用户要求去掉）
        expect(cells[index]!.kind).toBe('tile')
        expect(cells[index]!.glyph).toBe(stone === BLACK ? '●' : '○')
      }
    }
    expect(cells.filter((cell) => cell.glyph === '●')).toHaveLength(countStones(state.board).black)
    expect(cells.filter((cell) => cell.glyph === '○')).toHaveLength(countStones(state.board).white)
    expect(cellKindAt(state, state.lastMove!)).toBe('tile')
    expect(cellGlyphAt(state, state.lastMove!)).not.toBe('')
  })

  it('末手标记：只有 AI 的末手带内框，玩家末手与其余棋子完全一致', () => {
    /*
     * 演进：最初末手用「加粗 + 放大一档」（kind 'given'），用户后来要求去掉放大
     * （棋子大小不一看起来像"这颗子有问题"，且 ●/○ 是几何字形，加粗也看不出差异），
     * 于是玩家末手不做任何特殊标记；AI（白方）末手改用内框描边（data-last-to）。
     * 全程不反白：反白会把棋子本体一起翻转（AI 白子在黑底上看着像黑块，用户报过）。
     */
    const state = advance(fresh(), 4)
    expect(state.lastMove).not.toBeNull()
    const board = gomokuGame.view(state).board!
    const marked = board.cells.filter((cell) => cell.lastTo !== undefined)
    expect(marked.map((cell) => cell.index)).toEqual([state.lastMove])
    expect(board.cells.every((cell) => cell.selected === undefined)).toBe(true)
    // 全盘棋子大小一致、没有 given 放大：玩家末手与其它子完全一样
    for (const cell of board.cells) {
      expect(cell.kind).not.toBe('given')
      expect(cell.textScale).toBeUndefined()
    }
    // advance 走 4 手 → 末手是 AI 的白子 → 带双线内框
    expect(marked[0]!.kind).toBe('tile')
    expect(marked[0]!.lastTo).toBe(1)
    // 开局没有历史也没有最后一手
    expect(gomokuGame.view(fresh()).board!.cells.some((cell) => cell.kind === 'given')).toBe(false)
  })

  it('棋子不靠灰阶区分：只用两种字形；玩家末手无标记、AI 末手内框', () => {
    const state = advance(fresh(), 4)
    const board = gomokuGame.view(state).board!
    const glyphs = new Set(board.cells.map((cell) => cell.glyph))
    expect([...glyphs].sort()).toEqual(['', '○', '●'])
    for (const cell of board.cells) {
      if (cell.index === state.lastMove) {
        // AI（白方）的末手：内框描边（双线框），不放大
        expect(cell.lastTo).toBe(1)
        expect(cell.textScale).toBeUndefined()
      } else {
        expect(cell.textScale).toBeUndefined()
        expect(cell.lastTo).toBeUndefined()
      }
    }
  })

  it('stats 恰好三项：黑子 / 白子 / 步数', () => {
    const state = advance(fresh(), 4)
    const view = gomokuGame.view(state)
    expect(view.stats).toHaveLength(3)
    const counts = countStones(state.board)
    expect(view.stats).toEqual([
      { labelKey: 'gomoku.stat.black', value: String(counts.black) },
      { labelKey: 'gomoku.stat.white', value: String(counts.white) },
      { labelKey: 'gomoku.stat.moves', value: String(state.moves) },
    ])
    expect(state.moves).toBe(4)
    expect(counts.black).toBe(4)
  })

  it('进行中没有结果也没有提示', () => {
    const view = gomokuGame.view(fresh())
    expect(view.result).toBeNull()
    expect(view.notice).toBeNull()
  })

  it('黑方成五：结果标题写赢，明细带步数', () => {
    const before = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const over = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    const result = gomokuGame.view(over).result!
    expect(result.titleKey).toBe('gomoku.won.title')
    expect(result.details).toEqual([{ key: 'gomoku.result.moves', params: { count: 5 } }])
  })

  it('白方成五：结果标题写输', () => {
    const state = stateOf([
      { black: at(0, 0), white: at(3, 3) },
      { black: at(0, 2), white: at(3, 4) },
      { black: at(0, 4), white: at(3, 5) },
      { black: at(0, 6), white: at(3, 6) },
      { black: at(6, 6), white: at(3, 7) },
    ])
    expect(gomokuGame.view(state).result!.titleKey).toBe('gomoku.lost.title')
  })

  it('平局：标题如实写平局，并带一条「盘满无人成五」的明细', () => {
    const state = stateOf([], { board: fillNoFiveBoard(), moves: 113, rngCursor: 112 })
    const result = gomokuGame.view(state).result!
    expect(gomokuGame.status(state)).toBe('won') // 平局并入 won，壳层才会渲染结果面板
    expect(result.titleKey).toBe('gomoku.draw.title')
    expect(result.details).toEqual([
      { key: 'gomoku.result.moves', params: { count: 113 } },
      { key: 'gomoku.result.draw' },
    ])
    // 但**战绩**要知道真相：平局不是通关，壳层据此不写 completed / bestMoves
    // （审计实测：满盘平局被记成 completed:['starter'] + bestMoves + history.won=true）
    expect(gomokuGame.outcomeOf!(state)).toBe('draw')
  })

  it('outcomeOf 与 status 的分工：胜/负/平局三态都如实', () => {
    const beforeWin = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const won = reduceGomoku(beforeWin, { type: 'place', index: at(7, 7) })
    expect(gomokuGame.status(won)).toBe('won')
    expect(gomokuGame.outcomeOf!(won)).toBe('won')

    const lost = stateOf([
      { black: at(0, 0), white: at(3, 3) },
      { black: at(0, 2), white: at(3, 4) },
      { black: at(0, 4), white: at(3, 5) },
      { black: at(0, 6), white: at(3, 6) },
      { black: at(6, 6), white: at(3, 7) },
    ])
    expect(gomokuGame.status(lost)).toBe('lost')
    expect(gomokuGame.outcomeOf!(lost)).toBe('lost')
  })

  it("tickActor 是 'opponent'：应手计时不该被玩家的选点重置", () => {
    // 与 session.ts 的输入延迟补偿配套：等待白方应手期间连点棋盘不能把白方无限拖住
    expect(gomokuGame.tickActor).toBe('opponent')
  })
})

describe('controls / controlAction', () => {
  it('只声明撤销（重开由壳层渲染），没有历史时禁用', () => {
    const state = fresh()
    const controls = gomokuGame.controls(state)
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    // 不声明 restart / next-level / dpad / levels
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)

    const played = reduceGomoku(state, { type: 'place', index: 112 })
    expect(gomokuGame.controls(played)[0]!.enabled).toBe(true)
  })

  it('controlAction 把按钮映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(gomokuGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(gomokuGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(gomokuGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const played = reduceGomoku(fresh(), { type: 'place', index: 112 })
    expect(encodeState(reduceGomoku(played, { type: 'undo' }))).toEqual(encodeState(fresh()))
    expect(encodeState(reduceGomoku(played, { type: 'restart' }))).toEqual(encodeState(fresh()))
  })
})

describe('encode / decode', () => {
  it('初始局面往返一致（含 JSON 往返）', () => {
    const state = fresh()
    expect(gomokuGame.decode(gomokuGame.encode(state))).toEqual(state)
    expect(gomokuGame.decode(JSON.parse(JSON.stringify(gomokuGame.encode(state))))).toEqual(state)
  })

  it('中盘状态（含回合日志）往返一致', () => {
    // 用无五连图案铺出的自洽中盘局面：盘面密但一定还能继续下
    const state = crowdedState(20, 'skilled')
    expect(state.history).toHaveLength(20)
    expect(gomokuGame.status(state)).toBe('playing')
    const decoded = gomokuGame.decode(gomokuGame.encode(state))
    expect(decoded).toEqual(state)
    expect(gomokuGame.encode(decoded)).toEqual(gomokuGame.encode(state))
    // decode 后的状态还能继续走，且与原始状态逐格一致
    const index = playerMoves(decoded)[0]!
    expect(encodeState(reduceGomoku(decoded, { type: 'place', index }))).toEqual(
      encodeState(reduceGomoku(state, { type: 'place', index })),
    )
  })

  it('随机对局中途的状态也能往返一致，并且解码后可以接着下', () => {
    // 从 3 手的中盘开始随机走：undo/restart 会回退，从空盘走 14 步不保证到中盘
    const trail = walkRandom(advance(fresh(), 3), 14, 4242)
    const found = trail.find((item) => gomokuGame.status(item) === 'playing' && item.moves >= 3)
    expect(found).toBeDefined()
    const state = settle(found!)
    expect(state).toBeDefined()
    const decoded = gomokuGame.decode(gomokuGame.encode(state))
    expect(decoded).toEqual(state)
    const index = playerMoves(decoded)[0]!
    expect(encodeState(reduceGomoku(decoded, { type: 'place', index }))).toEqual(
      encodeState(reduceGomoku(state, { type: 'place', index })),
    )
  })

  it('终局状态往返一致且仍是终局', () => {
    const state = playToEnd(fresh())
    expect(gomokuGame.status(state)).not.toBe('playing')
    const decoded = gomokuGame.decode(gomokuGame.encode(state))
    expect(decoded).toEqual(state)
    expect(gomokuGame.encode(decoded)).toEqual(gomokuGame.encode(state))
    expect(gomokuGame.status(decoded)).toBe(gomokuGame.status(state))
    expect(gomokuGame.view(decoded).result).toEqual(gomokuGame.view(state).result)
  })

  it('撤销之后的状态往返一致', () => {
    const state = reduceGomoku(advance(fresh(), 5), { type: 'undo' })
    expect(state.moves).toBe(4)
    expect(gomokuGame.decode(gomokuGame.encode(state))).toEqual(state)
  })

  /**
   * 属性测试：随机执行若干「合法动作」（place / undo / restart）后，
   * encode→decode 必须往返一致，且解码出来的状态可以继续对局。
   * 这条用例专门盯住「decode 拒绝游戏自己产生的状态」这类事故。
   */
  it('属性：随机合法动作序列的任意一步都能 encode→decode 往返一致', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [11, 12, 13, 14]) {
        const trail = walkRandom(gomokuGame.create(seed, difficulty), 40, seed * 31 + 7)
        expect(trail.length).toBeGreaterThan(20)
        for (const state of trail) {
          const raw = gomokuGame.encode(state)
          const decoded = gomokuGame.decode(JSON.parse(JSON.stringify(raw)))
          expect(decoded, `${difficulty} seed=${seed} moves=${state.moves}`).toEqual(state)
          expect(gomokuGame.encode(decoded)).toEqual(raw)
        }
        // 解码后的状态继续对局：与原始状态分头走同样的玩家动作，结果必须一致
        let restored = settle(gomokuGame.decode(gomokuGame.encode(trail[trail.length - 1]!)))
        let original = settle(trail[trail.length - 1]!)
        const rng = createRng(seed)
        for (let step = 0; step < 6 && gomokuGame.status(original) === 'playing'; step++) {
          const moves = playerMoves(original)
          if (moves.length === 0) break
          const index = moves[rng.int(moves.length)]!
          restored = settle(reduceGomoku(restored, { type: 'place', index }))
          original = settle(reduceGomoku(original, { type: 'place', index }))
          expect(gomokuGame.encode(restored)).toEqual(gomokuGame.encode(original))
        }
      }
    }
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const state = advance(fresh(), 3)
    const raw = gomokuGame.encode(state) as {
      board: number[]
      history: Array<Record<string, unknown>>
      lastMove: number | null
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      [],
      {},
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, board: 'nope' },
      { ...raw, board: raw.board.slice(0, CELLS - 1) },
      { ...raw, board: [...raw.board, EMPTY] },
      { ...raw, board: raw.board.map((cell, index) => (index === 0 ? 3 : cell)) },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: 99 },
      { ...raw, history: 'nope' },
      { ...raw, history: raw.history.slice(0, 1) },
      // 盘面被改：多塞一颗黑子
      (() => {
        const board = raw.board.slice()
        const empty = board.indexOf(EMPTY)
        board[empty] = BLACK
        return { ...raw, board }
      })(),
      // 盘面被改：把一颗黑子换成白子
      (() => {
        const board = raw.board.slice()
        board[board.indexOf(BLACK)] = WHITE
        return { ...raw, board }
      })(),
      // 回合日志里黑子落在已占用点
      { ...raw, history: raw.history.map((entry, index) => (index === 1 ? { ...entry, black: (raw.history[0] as { black: number }).black } : entry)) },
      // 回合日志里白子越界
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? { ...entry, white: CELLS } : entry)) },
      // 回合日志条目不是对象
      { ...raw, history: raw.history.map((entry, index) => (index === 2 ? 7 : entry)) },
      // lastMove 与日志推导值不符
      { ...raw, lastMove: raw.lastMove === 7 ? 8 : 7 },
      // lastMove 越界
      { ...raw, lastMove: CELLS },
      // 中间回合白方不应手（两拍式只允许最后一回合待应手）
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? { ...entry, white: null } : entry)) },
      // 没有待应手时却带 opponentPick
      { ...raw, opponentPick: 0 },
      // 待应手但 opponentPick 越界
      { ...raw, history: raw.history.map((entry, index) => (index === raw.history.length - 1 ? { ...entry, white: null } : entry)), opponentPick: CELLS },
    ]
    for (const candidate of bad) {
      expect(() => gomokuGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })

  it('被篡改成「黑方成五后白方还应手」的日志会被拒绝', () => {
    const before = stateOf([
      { black: at(7, 3), white: at(0, 0) },
      { black: at(7, 4), white: at(0, 1) },
      { black: at(7, 5), white: at(0, 2) },
      { black: at(7, 6), white: at(0, 3) },
    ])
    const over = reduceGomoku(before, { type: 'place', index: at(7, 7) })
    const raw = gomokuGame.encode(over) as {
      history: Array<{ black: number; white: number | null }>
    }
    const tampered = {
      ...(gomokuGame.encode(over) as Record<string, unknown>),
      history: raw.history.map((turn, position) =>
        position === raw.history.length - 1 ? { ...turn, white: at(0, 4) } : turn,
      ),
    }
    expect(() => gomokuGame.decode(tampered)).toThrow(IllegalActionError)
  })
})

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(gomokuGame.id).toBe('gomoku')
    expect(gomokuGame.i18nNamespace).toBe('gomoku')
    expect(gomokuGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(gomokuGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(gomokuGame.illegalNoticeKey).toBe('gomoku.illegal.notice')
    expect(gomokuGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(gomokuGame.difficulties.map((item) => item.labelKey)).toEqual([
      'gomoku.difficulty.starter',
      'gomoku.difficulty.skilled',
      'gomoku.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((gomokuGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家步数', () => {
    const state = advance(fresh(), 3)
    expect(gomokuGame.contentId!(state)).toBe('starter')
    expect(gomokuGame.movesOf!(state)).toBe(3)
    expect(gomokuGame.contentId!(gomokuGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('create 对不同难度互不串味，未知难度被拒绝', () => {
    expect(gomokuGame.create(1, 'skilled').difficulty).toBe('skilled')
    expect(() => gomokuGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })
})

describe('字典', () => {
  it('中英基础 key 集合完全一致，没有缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': gomokuZh, 'en-US': gomokuEn })).toEqual([])
    expect([...baseKeys(gomokuZh)].sort()).toEqual([...baseKeys(gomokuEn)].sort())
  })

  it('壳层必需的 key 都定义了', () => {
    const keys = [
      'gomoku.title',
      'gomoku.rules.body',
      'gomoku.rules.body2',
      'gomoku.rules.restart',
      'gomoku.illegal.notice',
      'gomoku.won.title',
      'gomoku.lost.title',
      'gomoku.draw.title',
      'gomoku.stat.black',
      'gomoku.stat.white',
      'gomoku.stat.moves',
      'gomoku.cell.tile',
      'gomoku.cell.empty',
      'gomoku.result.draw',
      ...DIFFICULTY_IDS.map((id) => `gomoku.difficulty.${id}`),
    ]
    for (const key of keys) {
      expect(zh[key], key).toBeDefined()
      expect(en[key], key).toBeDefined()
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
      expect(i18nZh.t(key), key).not.toMatch(/\{\w+\}/)
      expect(i18nEn.t(key), key).not.toMatch(/\{\w+\}/)
    }
    // 结果明细与最佳成绩走 plural / 带 count 的 t()
    for (const key of ['gomoku.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    // 「最佳成绩」由壳层带 {count} 取，因此单独检查（它必然会含 {count}）
    expect(i18nZh.t('gomoku.solved.best', { count: 12 })).toContain('12')
    expect(i18nEn.t('gomoku.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
  })

  it('view / controls / 格子标签用到的 key 都能取到（两种语言都不缺）', () => {
    const state = advance(fresh(), 2)
    const view = gomokuGame.view(state)
    const keys: string[] = [
      `${gomokuGame.i18nNamespace}.title`,
      `${gomokuGame.i18nNamespace}.rules.body`,
      `${gomokuGame.i18nNamespace}.rules.restart`,
      gomokuGame.illegalNoticeKey!,
      ...view.stats.map((stat) => stat.labelKey),
      ...gomokuGame.controls(state).map((control) => control.labelKey),
      ...gomokuGame.difficulties.map((difficulty) => difficulty.labelKey),
      ...(Object.values(CELL_LABEL_KEYS).filter(Boolean) as string[]),
    ]
    for (const key of keys) {
      expect(i18nZh.t(key), key).not.toContain('⟦')
      expect(i18nEn.t(key), key).not.toContain('⟦')
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('结果标题与明细在两种语言里都能取到，且没有残留插值', () => {
    const win = reduceGomoku(
      stateOf([
        { black: at(7, 3), white: at(0, 0) },
        { black: at(7, 4), white: at(0, 1) },
        { black: at(7, 5), white: at(0, 2) },
        { black: at(7, 6), white: at(0, 3) },
      ]),
      { type: 'place', index: at(7, 7) },
    )
    const result = gomokuGame.view(win).result!
    expect(i18nZh.t(result.titleKey)).not.toContain('⟦')
    expect(i18nEn.t(result.titleKey)).not.toContain('⟦')
    for (const detail of result.details) {
      if (detail.params) {
        expect(i18nZh.plural(detail.key, Number(detail.params.count), detail.params)).not.toContain('⟦')
        expect(i18nEn.plural(detail.key, 1, { count: 1 })).not.toContain('⟦')
      } else {
        expect(i18nZh.t(detail.key)).not.toContain('⟦')
        expect(i18nEn.t(detail.key)).not.toContain('⟦')
      }
    }
    const draw = gomokuGame.view(
      stateOf([], { board: fillNoFiveBoard(), moves: 113, rngCursor: 112 }),
    ).result!
    for (const detail of draw.details) {
      if (detail.params) {
        expect(i18nEn.plural(detail.key, 113, detail.params)).not.toContain('⟦')
      } else {
        expect(i18nEn.t(detail.key)).not.toContain('⟦')
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('格子无障碍标签覆盖五子棋用到的两种 kind', () => {
    for (const kind of ['tile', 'empty'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key]).toBeDefined()
      expect(en[key]).toBeDefined()
    }
  })
})
