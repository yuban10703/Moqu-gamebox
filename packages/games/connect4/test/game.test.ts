/**
 * GameDef 外壳集成测试：view / controls / encode / decode / i18n / 元信息。
 * 重点：
 *   - 1-bit 呈现约定（● / ○、最后一手 selected 高亮、列提示用 number+·+textScale 0.5、
 *     不加分组线、stats 只有三项）；
 *   - `encode`/`decode` 严格往返，坏数据一律抛 IllegalActionError（含重力被篡改的日志）；
 *   - 属性测试：随机走 60 步合法动作（drop / undo / restart）后 encode→decode 必须往返一致
 *     且解码出来的状态可以继续对局（项目曾因「decode 拒绝游戏自己产生的状态」出过事故，
 *     这条用例是第一道闸门）。
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
  connect4En,
  connect4Game,
  connect4Zh,
  countStones,
  droppableIndexes,
  encodeState,
  landingIndex,
  legalActions,
  reduceConnect4,
  type Connect4State,
} from '../src/index.js'
import { CELL_LABEL_KEYS, HINT_GLYPH, HINT_TEXT_SCALE } from '../src/view.js'
import { at, bottomIndex, crowdedState, playerColumns, stateOf } from './helpers.js'

const zh: Dict = { ...coreDictZh, ...connect4Zh }
const en: Dict = { ...coreDictEn, ...connect4En }
const i18nZh = createI18n('zh-CN', { 'zh-CN': zh, 'en-US': en })
const i18nEn = createI18n('en-US', { 'zh-CN': zh, 'en-US': en })

function fresh(): Connect4State {
  return connect4Game.create(20240607, 'starter')
}

/** 走 n 手（每手都取当前第一个合法列），得到真实的中盘状态 */
function advance(state: Connect4State, plies: number): Connect4State {
  let current = state
  for (let ply = 0; ply < plies; ply++) {
    const move = legalActions(current).find(
      (action): action is { type: 'drop'; column: number } => action.type === 'drop',
    )
    if (!move) break
    current = connect4Game.reduce(current, move)
  }
  return current
}

/** 一直走到终局（玩家每手取第一个合法列） */
function playToEnd(state: Connect4State): Connect4State {
  let current = state
  let guard = 0
  while (connect4Game.status(current) === 'playing' && guard++ < 42) {
    const move = legalActions(current).find(
      (action): action is { type: 'drop'; column: number } => action.type === 'drop',
    )
    if (!move) break
    current = connect4Game.reduce(current, move)
  }
  return current
}

/** 用固定种子的随机策略走若干步（含撤销/重开），返回走过的状态序列 */
function walkRandom(state: Connect4State, steps: number, seed: number): Connect4State[] {
  const rng = createRng(seed)
  const trail: Connect4State[] = [state]
  let current = state
  for (let step = 0; step < steps; step++) {
    const actions = legalActions(current)
    const action = actions[rng.int(actions.length)]
    if (!action) break
    current = connect4Game.reduce(current, action)
    trail.push(current)
  }
  return trail
}

/** 期望的列提示集合：每个未满列的最低空格（与生产实现独立的写法）；终局后不再提示 */
function expectedHints(state: Connect4State): number[] {
  if (connect4Game.status(state) !== 'playing') return []
  const hints: number[] = []
  for (let column = 0; column < 7; column++) {
    const index = bottomIndex(state.board, column)
    if (index !== null) hints.push(index)
  }
  return hints
}

describe('view / 1-bit 呈现约定', () => {
  it('7 列 × 6 行棋盘、42 格、行优先索引，且没有分组线', () => {
    const view = connect4Game.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(7)
    expect(view.board!.rows).toBe(6)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    // 7×6 没有宫结构：多一层分组线只会让画面更花
    expect(view.board!.groups).toBeUndefined()
  })

  it('棋子用实心/空心圆（kind: tile），空格为空（kind: empty、glyph 空）', () => {
    const state = advance(fresh(), 4)
    const cells = connect4Game.view(state).board!.cells
    const hints = expectedHints(state)
    for (let index = 0; index < CELLS; index++) {
      const stone = state.board[index]
      if (stone !== EMPTY) {
        expect(cells[index]!.kind).toBe('tile')
        expect(cells[index]!.glyph).toBe(stone === BLACK ? '●' : '○')
        expect(cells[index]!.textScale).toBeUndefined()
      } else if (hints.includes(index)) {
        expect(cells[index]!.kind).toBe('number')
        expect(cells[index]!.glyph).toBe(HINT_GLYPH)
        expect(cells[index]!.textScale).toBe(HINT_TEXT_SCALE)
      } else {
        expect(cells[index]!.kind).toBe('empty')
        expect(cells[index]!.glyph).toBe('')
        expect(cells[index]!.textScale).toBeUndefined()
      }
    }
    expect(cells.filter((cell) => cell.glyph === '●')).toHaveLength(countStones(state.board).black)
    expect(cells.filter((cell) => cell.glyph === '○')).toHaveLength(countStones(state.board).white)
    expect(cellKindAt(state, state.lastMove!)).toBe('tile')
    expect(cellGlyphAt(state, state.lastMove!)).not.toBe('')
  })

  it('列提示只出现在「可落子列的最低空格」上，落子后沿列上移', () => {
    const before = fresh()
    const hints = expectedHints(before)
    expect(hints).toEqual([35, 36, 37, 38, 39, 40, 41])
    expect(droppableIndexes(before)).toEqual(hints)
    for (const index of hints) {
      expect(cellKindAt(before, index)).toBe('number')
      expect(cellGlyphAt(before, index)).toBe(HINT_GLYPH)
    }
    // 该列最低空格之上的空格不带提示
    expect(cellKindAt(before, at(4, 3))).toBe('empty')

    const after = connect4Game.reduce(before, { type: 'drop', column: 3 })
    expect(after.board[at(5, 3)]).toBe(BLACK)
    expect(cellKindAt(after, at(5, 3))).toBe('tile')
    // 列 3 的提示上升到索引 31（列内次低格）；白方的应手列同样上移一格
    expect(droppableIndexes(after)).toContain(at(4, 3))
    const whiteIndex = after.board.findIndex((stone) => stone === WHITE)
    expect(droppableIndexes(after)).toContain(at(4, whiteIndex % 7))
    expect(droppableIndexes(after)).not.toContain(at(5, 3))
  })

  it('终局后不再有列提示，但棋子照常呈现', () => {
    const over = playToEnd(fresh())
    expect(connect4Game.status(over)).not.toBe('playing')
    const view = connect4Game.view(over)
    expect(droppableIndexes(over)).toEqual([])
    expect(view.board!.cells.some((cell) => cell.kind === 'number')).toBe(false)
    expect(view.board!.cells.some((cell) => cell.glyph === '●')).toBe(true)
  })

  it('最后一手用 selected 高亮，且全盘只有它一个高亮', () => {
    const state = advance(fresh(), 3)
    expect(state.lastMove).not.toBeNull()
    const selected = connect4Game
      .view(state)
      .board!.cells.filter((cell) => cell.selected)
      .map((cell) => cell.index)
    expect(selected).toEqual([state.lastMove])
    // 开局没有历史也没有最后一手
    expect(connect4Game.view(fresh()).board!.cells.some((cell) => cell.selected)).toBe(false)
  })

  it('棋子不靠灰阶区分：只用两种棋子字形加一种提示点', () => {
    const state = advance(fresh(), 4)
    const glyphs = new Set(connect4Game.view(state).board!.cells.map((cell) => cell.glyph))
    expect([...glyphs].sort()).toEqual(['', HINT_GLYPH, '○', '●'].sort())
  })

  it('stats 恰好三项：黑子 / 白子 / 步数', () => {
    const state = advance(fresh(), 4)
    const view = connect4Game.view(state)
    expect(view.stats).toHaveLength(3)
    const counts = countStones(state.board)
    expect(view.stats).toEqual([
      { labelKey: 'connect4.stat.black', value: String(counts.black) },
      { labelKey: 'connect4.stat.white', value: String(counts.white) },
      { labelKey: 'connect4.stat.moves', value: String(state.moves) },
    ])
    expect(state.moves).toBe(4)
    expect(counts.black).toBe(4)
  })

  it('进行中没有结果也没有提示', () => {
    const view = connect4Game.view(fresh())
    expect(view.result).toBeNull()
    expect(view.notice).toBeNull()
  })

  it('黑方成四：结果标题写赢，明细带步数', () => {
    const before = stateOf([
      { black: at(5, 0), white: at(5, 6) },
      { black: at(5, 1), white: at(4, 6) },
      { black: at(5, 2), white: at(3, 6) },
    ])
    const over = reduceConnect4(before, { type: 'drop', column: 3 })
    const result = connect4Game.view(over).result!
    expect(result.titleKey).toBe('connect4.won.title')
    expect(result.details).toEqual([{ key: 'connect4.result.moves', params: { count: 4 } }])
  })

  it('白方成四：结果标题写输', () => {
    const state = stateOf([
      { black: at(5, 0), white: at(5, 3) },
      { black: at(5, 1), white: at(4, 3) },
      { black: at(4, 0), white: at(3, 3) },
      { black: at(4, 1), white: at(2, 3) },
    ])
    expect(connect4Game.view(state).result!.titleKey).toBe('connect4.lost.title')
  })

  it('平局：标题如实写平局，并带一条「盘满无人成四」的明细', () => {
    const state = crowdedState(21)
    const result = connect4Game.view(state).result!
    expect(connect4Game.status(state)).toBe('won') // 平局并入 won，壳层才会渲染结果面板
    expect(result.titleKey).toBe('connect4.draw.title')
    expect(result.details).toEqual([
      { key: 'connect4.result.moves', params: { count: 21 } },
      { key: 'connect4.result.draw' },
    ])
  })
})

describe('controls / controlAction', () => {
  it('只声明撤销（重开由壳层渲染），没有历史时禁用', () => {
    const state = fresh()
    const controls = connect4Game.controls(state)
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    // 不声明 restart / next-level / dpad / levels
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)

    const played = reduceConnect4(state, { type: 'drop', column: 3 })
    expect(connect4Game.controls(played)[0]!.enabled).toBe(true)
  })

  it('controlAction 把按钮映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(connect4Game.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(connect4Game.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(connect4Game.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const played = reduceConnect4(fresh(), { type: 'drop', column: 5 })
    expect(encodeState(reduceConnect4(played, { type: 'undo' }))).toEqual(encodeState(fresh()))
    expect(encodeState(reduceConnect4(played, { type: 'restart' }))).toEqual(encodeState(fresh()))
  })
})

describe('encode / decode', () => {
  it('初始局面往返一致（含 JSON 往返）', () => {
    const state = fresh()
    expect(connect4Game.decode(connect4Game.encode(state))).toEqual(state)
    expect(connect4Game.decode(JSON.parse(JSON.stringify(connect4Game.encode(state))))).toEqual(
      state,
    )
  })

  it('中盘状态（含回合日志）往返一致', () => {
    const state = crowdedState(20, 'skilled')
    expect(state.history).toHaveLength(20)
    expect(connect4Game.status(state)).toBe('playing')
    const decoded = connect4Game.decode(connect4Game.encode(state))
    expect(decoded).toEqual(state)
    expect(connect4Game.encode(decoded)).toEqual(connect4Game.encode(state))
    // decode 后的状态还能继续走，且与原始状态逐格一致
    const column = playerColumns(decoded)[0]!
    expect(encodeState(reduceConnect4(decoded, { type: 'drop', column }))).toEqual(
      encodeState(reduceConnect4(state, { type: 'drop', column })),
    )
  })

  it('随机对局中途的状态也能往返一致，并且解码后可以接着下', () => {
    const trail = walkRandom(fresh(), 12, 4242)
    const state = trail.find(
      (item) => connect4Game.status(item) === 'playing' && item.moves >= 3,
    )!
    expect(state).toBeDefined()
    const decoded = connect4Game.decode(connect4Game.encode(state))
    expect(decoded).toEqual(state)
    const column = playerColumns(decoded)[0]!
    expect(encodeState(reduceConnect4(decoded, { type: 'drop', column }))).toEqual(
      encodeState(reduceConnect4(state, { type: 'drop', column })),
    )
  })

  it('终局状态往返一致且仍是终局', () => {
    const state = playToEnd(fresh())
    expect(connect4Game.status(state)).not.toBe('playing')
    const decoded = connect4Game.decode(connect4Game.encode(state))
    expect(decoded).toEqual(state)
    expect(connect4Game.encode(decoded)).toEqual(connect4Game.encode(state))
    expect(connect4Game.status(decoded)).toBe(connect4Game.status(state))
    expect(connect4Game.view(decoded).result).toEqual(connect4Game.view(state).result)
  })

  it('平局状态（满盘无四连）往返一致', () => {
    const state = crowdedState(21, 'challenging')
    expect(connect4Game.decode(connect4Game.encode(state))).toEqual(state)
    expect(connect4Game.view(connect4Game.decode(connect4Game.encode(state))).result).toEqual(
      connect4Game.view(state).result,
    )
  })

  it('撤销之后的状态往返一致', () => {
    const state = reduceConnect4(advance(fresh(), 5), { type: 'undo' })
    expect(state.moves).toBe(4)
    expect(connect4Game.decode(connect4Game.encode(state))).toEqual(state)
  })

  /**
   * 属性测试：随机执行 60 步「合法动作」（drop / undo / restart）后，
   * encode→decode 必须往返一致，且解码出来的状态可以继续对局。
   * 这条用例专门盯住「decode 拒绝游戏自己产生的状态」这类事故。
   */
  it('属性：随机 60 步合法动作的每一步都能 encode→decode 往返并继续对局', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of [11, 12, 13, 14]) {
        const trail = walkRandom(connect4Game.create(seed, difficulty), 60, seed * 31 + 7)
        expect(trail.length).toBeGreaterThan(50)
        for (const state of trail) {
          const raw = connect4Game.encode(state)
          const decoded = connect4Game.decode(JSON.parse(JSON.stringify(raw)))
          expect(decoded, `${difficulty} seed=${seed} moves=${state.moves}`).toEqual(state)
          expect(connect4Game.encode(decoded)).toEqual(raw)
        }
        // 解码后的状态继续对局：与原始状态分头走同样的玩家动作，结果必须一致
        let restored = connect4Game.decode(connect4Game.encode(trail[trail.length - 1]!))
        let original = trail[trail.length - 1]!
        const rng = createRng(seed)
        for (let step = 0; step < 8 && connect4Game.status(original) === 'playing'; step++) {
          const columns = playerColumns(original)
          if (columns.length === 0) break
          const column = columns[rng.int(columns.length)]!
          restored = reduceConnect4(restored, { type: 'drop', column })
          original = reduceConnect4(original, { type: 'drop', column })
          expect(connect4Game.encode(restored)).toEqual(connect4Game.encode(original))
        }
      }
    }
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const state = advance(fresh(), 3)
    const raw = connect4Game.encode(state) as {
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
        board[board.indexOf(EMPTY)] = BLACK
        return { ...raw, board }
      })(),
      // 盘面被改：把一颗黑子换成白子
      (() => {
        const board = raw.board.slice()
        board[board.indexOf(BLACK)] = WHITE
        return { ...raw, board }
      })(),
      // 回合日志里黑子落在已占用点
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 1 ? { ...entry, black: (raw.history[0] as { black: number }).black } : entry,
        ),
      },
      // 回合日志里白子越界
      {
        ...raw,
        history: raw.history.map((entry, index) => (index === 0 ? { ...entry, white: CELLS } : entry)),
      },
      // 回合日志条目不是对象
      { ...raw, history: raw.history.map((entry, index) => (index === 2 ? 7 : entry)) },
      // 白方应手被抹掉（黑方这一手并没有终结对局）
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === raw.history.length - 1 ? { ...entry, white: null } : entry,
        ),
      },
      // lastMove 与日志推导值不符
      { ...raw, lastMove: raw.lastMove === 7 ? 8 : 7 },
      // lastMove 越界
      { ...raw, lastMove: CELLS },
    ]
    for (const candidate of bad) {
      expect(() => connect4Game.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })

  it('被篡改成「棋子悬在半空」的日志会被拒绝（重力不变量）', () => {
    const state = advance(fresh(), 2)
    const raw = connect4Game.encode(state) as {
      board: number[]
      history: Array<{ black: number; white: number | null }>
    }
    const first = raw.history[0]!
    const column = first.black % 7
    // 第一手必然落在该列最低格；把它改成该列最上面一格 = 悬在半空
    expect(first.black).toBe(at(5, column))
    const tampered = {
      ...(raw as unknown as Record<string, unknown>),
      history: raw.history.map((entry, index) =>
        index === 0 ? { ...entry, black: at(0, column) } : entry,
      ),
    }
    expect(() => connect4Game.decode(tampered)).toThrow(IllegalActionError)
  })

  it('被篡改成「黑方成四后白方还应手」的日志会被拒绝', () => {
    const before = stateOf([
      { black: at(5, 0), white: at(5, 6) },
      { black: at(5, 1), white: at(4, 6) },
      { black: at(5, 2), white: at(3, 6) },
    ])
    const over = reduceConnect4(before, { type: 'drop', column: 3 })
    const raw = connect4Game.encode(over) as {
      history: Array<{ black: number; white: number | null }>
    }
    const tampered = {
      ...(connect4Game.encode(over) as Record<string, unknown>),
      history: raw.history.map((turn, position) =>
        position === raw.history.length - 1 ? { ...turn, white: at(5, 4) } : turn,
      ),
    }
    expect(() => connect4Game.decode(tampered)).toThrow(IllegalActionError)
  })
})

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(connect4Game.id).toBe('connect4')
    expect(connect4Game.i18nNamespace).toBe('connect4')
    expect(connect4Game.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(connect4Game.contentVersion).toBeGreaterThanOrEqual(1)
    expect(connect4Game.illegalNoticeKey).toBe('connect4.illegal.notice')
    expect(connect4Game.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(connect4Game.difficulties.map((item) => item.labelKey)).toEqual([
      'connect4.difficulty.starter',
      'connect4.difficulty.skilled',
      'connect4.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((connect4Game as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家步数', () => {
    const state = advance(fresh(), 3)
    expect(connect4Game.contentId!(state)).toBe('starter')
    expect(connect4Game.movesOf!(state)).toBe(3)
    expect(connect4Game.contentId!(connect4Game.create(1, 'challenging'))).toBe('challenging')
  })

  it('create 对不同难度互不串味，未知难度被拒绝', () => {
    expect(connect4Game.create(1, 'skilled').difficulty).toBe('skilled')
    expect(() => connect4Game.create(1, 'impossible')).toThrow(IllegalActionError)
  })

  it('selectAction 是壳层点格子的入口：列未满给 drop，列已满给 null', () => {
    const state = fresh()
    expect(connect4Game.selectAction!(state, at(2, 6))).toEqual({ type: 'drop', column: 6 })
    const full = stateOf([
      { black: at(5, 0), white: at(4, 0) },
      { black: at(3, 0), white: at(2, 0) },
      { black: at(1, 0), white: at(0, 0) },
    ])
    expect(connect4Game.selectAction!(full, at(0, 0))).toBeNull()
    expect(connect4Game.selectAction!(full, 0)).toBeNull()
    expect(landingIndex(full.board, 0)).toBeNull()
  })
})

describe('字典', () => {
  it('中英基础 key 集合完全一致，没有缺失/多余/复数不完整', () => {
    expect(compareDicts({ 'zh-CN': connect4Zh, 'en-US': connect4En })).toEqual([])
    expect([...baseKeys(connect4Zh)].sort()).toEqual([...baseKeys(connect4En)].sort())
  })

  it('壳层必需的 key 都定义了', () => {
    const keys = [
      'connect4.title',
      'connect4.rules.body',
      'connect4.rules.body2',
      'connect4.rules.restart',
      'connect4.illegal.notice',
      'connect4.won.title',
      'connect4.lost.title',
      'connect4.draw.title',
      'connect4.stat.black',
      'connect4.stat.white',
      'connect4.stat.moves',
      'connect4.cell.tile',
      'connect4.cell.empty',
      'connect4.cell.number',
      'connect4.result.draw',
      ...DIFFICULTY_IDS.map((id) => `connect4.difficulty.${id}`),
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
    for (const key of ['connect4.result.moves']) {
      expect(en[`${key}__one`], key).toBeDefined()
      expect(en[`${key}__other`], key).toBeDefined()
      expect(zh[`${key}__other`], key).toBeDefined()
    }
    // 「最佳成绩」由壳层带 {count} 取，因此单独检查（它必然会含 {count}）
    expect(i18nZh.t('connect4.solved.best', { count: 12 })).toContain('12')
    expect(i18nEn.t('connect4.solved.best', { count: 1 })).not.toMatch(/\{\w+\}/)
  })

  it('view / controls / 格子标签用到的 key 都能取到（两种语言都不缺）', () => {
    const state = advance(fresh(), 2)
    const view = connect4Game.view(state)
    const keys: string[] = [
      `${connect4Game.i18nNamespace}.title`,
      `${connect4Game.i18nNamespace}.rules.body`,
      `${connect4Game.i18nNamespace}.rules.restart`,
      connect4Game.illegalNoticeKey!,
      ...view.stats.map((stat) => stat.labelKey),
      ...connect4Game.controls(state).map((control) => control.labelKey),
      ...connect4Game.difficulties.map((difficulty) => difficulty.labelKey),
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
    const win = reduceConnect4(
      stateOf([
        { black: at(5, 0), white: at(5, 6) },
        { black: at(5, 1), white: at(4, 6) },
        { black: at(5, 2), white: at(3, 6) },
      ]),
      { type: 'drop', column: 3 },
    )
    const lost = stateOf([
      { black: at(5, 0), white: at(5, 3) },
      { black: at(5, 1), white: at(4, 3) },
      { black: at(4, 0), white: at(3, 3) },
      { black: at(4, 1), white: at(2, 3) },
    ])
    const draw = crowdedState(21)
    for (const state of [win, lost, draw]) {
      const result = connect4Game.view(state).result!
      expect(i18nZh.t(result.titleKey), result.titleKey).not.toContain('⟦')
      expect(i18nEn.t(result.titleKey), result.titleKey).not.toContain('⟦')
      for (const detail of result.details) {
        if (detail.params) {
          expect(
            i18nZh.plural(detail.key, Number(detail.params.count), detail.params),
          ).not.toContain('⟦')
          expect(i18nEn.plural(detail.key, 1, { count: 1 })).not.toContain('⟦')
        } else {
          expect(i18nZh.t(detail.key)).not.toContain('⟦')
          expect(i18nEn.t(detail.key)).not.toContain('⟦')
        }
      }
    }
    expect(i18nZh.missingKeys()).toEqual([])
    expect(i18nEn.missingKeys()).toEqual([])
  })

  it('格子无障碍标签覆盖四子棋用到的三种 kind', () => {
    for (const kind of ['tile', 'empty', 'number'] as const) {
      const key = CELL_LABEL_KEYS[kind]!
      expect(zh[key]).toBeDefined()
      expect(en[key]).toBeDefined()
    }
    expect(droppableIndexes(fresh())).toHaveLength(7)
  })
})
