/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BOARD_SIZE,
  CELLS,
  DIFFICULTY_IDS,
  HINT_GLYPH,
  HINT_TEXT_SCALE,
  OPTION_TEXT_SCALE,
  VISITED_GLYPH,
  VISITED_TEXT_SCALE,
  colOf,
  gameStatus,
  indexOf,
  knightstourGame,
  legalTargets,
  reduceKnight,
  rowOf,
  selectAction,
  warnsdorffNext,
  type KnightState,
} from '../src/index.js'
import { solveKnightTour } from './helpers.js'

function fresh(seed = 20240607, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter'): KnightState {
  return knightstourGame.create(seed, difficulty)
}

function firstTarget(state: KnightState): number {
  const target = legalTargets(state)[0]
  if (target === undefined) throw new Error('no legal target')
  return target
}

/** 用独立求解器走满一局 */
function playFullTour(state: KnightState): KnightState {
  const path = solveKnightTour(BOARD_SIZE, state.start).solution!
  let current = state
  for (const to of path.slice(1)) current = reduceKnight(current, { type: 'move', to })
  return current
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(knightstourGame.id).toBe('knightstour')
    expect(knightstourGame.i18nNamespace).toBe('knightstour')
    expect(knightstourGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(knightstourGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(knightstourGame.illegalNoticeKey).toBe('knightstour.illegal.notice')
    expect(knightstourGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(knightstourGame.difficulties.map((item) => item.labelKey)).toEqual([
      'knightstour.difficulty.starter',
      'knightstour.difficulty.skilled',
      'knightstour.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((knightstourGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 步数', () => {
    const state = fresh(1, 'skilled')
    expect(knightstourGame.contentId!(state)).toBe('skilled')
    expect(knightstourGame.movesOf!(state)).toBe(0)
    const moved = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    expect(knightstourGame.movesOf!(moved)).toBe(1)
    expect(knightstourGame.contentId!(fresh(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开/提示映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(knightstourGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(knightstourGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(knightstourGame.controlAction!(state, 'hint')).toEqual({ type: 'hint' })
    expect(knightstourGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('create 拒绝未知难度；三档难度棋盘都是 8×8', () => {
    expect(() => knightstourGame.create(0, 'impossible')).toThrow(IllegalActionError)
    for (const difficulty of DIFFICULTY_IDS) {
      const state = knightstourGame.create(3, difficulty)
      expect(state.difficulty).toBe(difficulty)
      expect(state.visited).toHaveLength(1)
      expect(knightstourGame.view(state).board!.cells).toHaveLength(CELLS)
    }
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('8×8 棋盘、64 格、行优先索引，且没有分组线', () => {
    const view = knightstourGame.view(fresh())
    expect(view.board).not.toBeNull()
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.cols).toBe(BOARD_SIZE)
    expect(view.board!.rows).toBe(BOARD_SIZE)
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
    expect(view.board!.groups).toBeUndefined()
  })

  it('起始状态：马所在格是 player，可跳落点是 number + ·（更小字号），其余是空 floor', () => {
    const state = fresh()
    const cells = knightstourGame.view(state).board!.cells
    expect(cells[state.start]).toEqual({ index: state.start, kind: 'player', glyph: '' })
    const options = legalTargets(state)
    for (const to of options) {
      expect(cells[to]).toEqual({
        index: to,
        kind: 'number',
        glyph: VISITED_GLYPH,
        textScale: OPTION_TEXT_SCALE,
      })
    }
    // 其余格子都是未访问的空地板
    expect(cells.filter((cell) => cell.kind === 'floor')).toHaveLength(CELLS - 1 - options.length)
    for (const cell of cells.filter((item) => item.kind === 'floor')) {
      expect(cell.glyph).toBe('')
      expect(cell.textScale).toBeUndefined()
    }
  })

  it('走过之后：起点是 goal、马是 player、路过的格子留 ·（0.5 字号）', () => {
    let state = fresh(20240607, 'skilled')
    state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    const middle = state.current
    state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    const cells = knightstourGame.view(state).board!.cells
    expect(cells[state.current]!.kind).toBe('player')
    expect(cells[state.start]!.kind).toBe('goal')
    expect(cells[state.start]!.glyph).toBe('')
    expect(cells[middle]).toEqual({
      index: middle,
      kind: 'floor',
      glyph: VISITED_GLYPH,
      textScale: VISITED_TEXT_SCALE,
    })
  })

  it('提示开启：推荐落点用 ★，并且在 notice 里给出稳定提示', () => {
    let state = reduceKnight(fresh(5, 'starter'), { type: 'hint' })
    state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    const view = knightstourGame.view(state)
    const hint = warnsdorffNext(state.current, state.visited)!
    const cells = view.board!.cells
    expect(cells[hint]).toEqual({
      index: hint,
      kind: 'number',
      glyph: HINT_GLYPH,
      textScale: HINT_TEXT_SCALE,
    })
    expect(view.notice).toEqual({ textKey: 'knightstour.notice.hint' })
    // 其它可跳落点仍是小点
    for (const to of legalTargets(state)) {
      if (to === hint) continue
      expect(cells[to]!.glyph).toBe(VISITED_GLYPH)
      expect(cells[to]!.textScale).toBe(OPTION_TEXT_SCALE)
    }
    // 关掉提示后 notice 消失、★ 变回小点
    const off = knightstourGame.view(reduceKnight(state, { type: 'hint' }))
    expect(off.notice).toBeNull()
    expect(off.board!.cells[hint]!.glyph).toBe(VISITED_GLYPH)
  })

  it('stats 恰好三项恒定输出：步数 / 已访问 n/64 / 起点坐标（1 起）', () => {
    const state = fresh(20240607, 'starter')
    const view = knightstourGame.view(state)
    expect(view.stats).toEqual([
      { labelKey: 'knightstour.stat.moves', value: '0' },
      { labelKey: 'knightstour.stat.visited', value: `1/${CELLS}` },
      {
        labelKey: 'knightstour.stat.start',
        value: `${rowOf(state.start) + 1},${colOf(state.start) + 1}`,
      },
    ])
  })

  it('进行中没有结果；走满 64 格后给出结果标题与明细', () => {
    const playing = fresh()
    expect(knightstourGame.view(playing).result).toBeNull()

    const won = playFullTour(playing)
    expect(gameStatus(won)).toBe('won')
    const result = knightstourGame.view(won).result!
    expect(result.titleKey).toBe('knightstour.won.title')
    expect(result.details).toEqual([
      { key: 'knightstour.result.moves', params: { count: CELLS - 1 } },
      { key: 'knightstour.result.visited', params: { count: CELLS } },
    ])
    // 走满后不再有可跳落点，提示也停用
    expect(knightstourGame.view(won).notice).toBeNull()
  })

  it('起点坐标是 1 起的行列（不是索引）', () => {
    const state = fresh(1, 'challenging')
    const cell = knightstourGame.view(state).board!.cells[state.start]!
    expect(cell.kind).toBe('player')
    const value = knightstourGame.view(state).stats[2]!.value
    expect(value).toBe(`${rowOf(state.start) + 1},${colOf(state.start) + 1}`)
    expect(value).not.toBe(String(state.start))
    void indexOf
  })
})

describe('controls', () => {
  it('只声明撤销 +（入门难度）提示开关，不声明 dpad / restart / next-level', () => {
    const starter = knightstourGame.controls(fresh(1, 'starter'))
    expect(starter.map((control) => control.id)).toEqual(['undo', 'hint'])
    expect(starter.some((control) => control.role === 'dpad')).toBe(false)
    expect(starter.some((control) => control.id === 'restart')).toBe(false)
    expect(starter.some((control) => control.id === 'next-level')).toBe(false)
    expect(starter[0]!.labelKey).toBe('shell.game.undo')
    expect(starter[0]!.enabled).toBe(false)
    expect(starter[1]!.labelKey).toBe('knightstour.control.hint.off')
    expect(starter[1]!.emphasis).toBe('normal')

    // 其它难度只有撤销
    for (const difficulty of ['skilled', 'challenging'] as const) {
      const controls = knightstourGame.controls(fresh(1, difficulty))
      expect(controls.map((control) => control.id)).toEqual(['undo'])
    }
  })

  it('提示开启后是 primary 且文案换成「开」；走过一步后 undo 才可用', () => {
    const state = fresh(1, 'starter')
    const on = reduceKnight(state, { type: 'hint' })
    const controls = knightstourGame.controls(on)
    expect(controls[1]!.labelKey).toBe('knightstour.control.hint.on')
    expect(controls[1]!.emphasis).toBe('primary')
    expect(knightstourGame.controls(reduceKnight(state, { type: 'move', to: firstTarget(state) }))[0]!.enabled).toBe(
      true,
    )
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(2024, difficulty)
      expect(knightstourGame.decode(knightstourGame.encode(state))).toEqual(state)
      expect(
        knightstourGame.decode(JSON.parse(JSON.stringify(knightstourGame.encode(state)))),
      ).toEqual(state)
    }
    let state = fresh(17, 'skilled')
    for (let step = 0; step < 5; step++) state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    expect(knightstourGame.decode(knightstourGame.encode(state))).toEqual(state)

    const won = playFullTour(fresh(4, 'challenging'))
    expect(knightstourGame.decode(knightstourGame.encode(won))).toEqual(won)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = fresh(17, 'starter')
    played = reduceKnight(played, { type: 'move', to: firstTarget(played) })
    const raw = knightstourGame.encode(played) as Record<string, unknown>
    const visited = raw.visited as number[]
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, difficulty: 'nope' },
      { ...raw, visited: [...visited, 40] },
      { ...raw, current: 40 },
      { ...raw, start: 40 },
      { ...raw, moves: (raw.moves as number) + 2 },
      { ...raw, log: [...(raw.log as number[]), 40] },
      { ...raw, log: [(raw.start as number) + 1] },
    ]
    for (const candidate of bad) {
      expect(() => knightstourGame.decode(candidate), JSON.stringify(candidate)?.slice(0, 90)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致且局面可继续', () => {
    const rng = createRng(20240607)
    let state = fresh(20240607, 'starter')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 200000) {
      if (gameStatus(state) === 'won') {
        state = reduceKnight(state, { type: 'restart' })
        continue
      }
      // 走进死路（没有合法落点）时撤销一步；退无可退就重新开始
      if (legalTargets(state).length === 0) {
        state =
          state.log.length > 0
            ? reduceKnight(state, { type: 'undo' })
            : reduceKnight(state, { type: 'restart' })
        continue
      }
      // 模拟随机点击：只有点到合法马步才会产生动作
      const action = selectAction(state, rng.int(CELLS))
      if (action === null) continue
      state = reduceKnight(state, action)
      applied += 1

      const encoded = knightstourGame.encode(state)
      const decoded = knightstourGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(knightstourGame.encode(decoded)).toEqual(encoded)
      expect(knightstourGame.decode(JSON.parse(JSON.stringify(encoded))), `step ${applied}`).toEqual(
        state,
      )
      // 局面永远可用：要么还有落点，要么能撤销/重开
      expect(
        legalTargets(decoded).length > 0 ||
          decoded.log.length > 0 ||
          gameStatus(decoded) === 'won',
        `step ${applied}`,
      ).toBe(true)
      state = decoded
    }
    expect(applied).toBe(60)
    expect(state.moves).toBeGreaterThan(0)
  })

  it('随机走子永远不会重复访问或离开棋盘', () => {
    const rng = createRng(7)
    let state = fresh(7, 'challenging')
    for (let step = 0; step < 60; step++) {
      if (gameStatus(state) === 'won' || legalTargets(state).length === 0) {
        state = state.log.length > 0 ? reduceKnight(state, { type: 'undo' }) : reduceKnight(state, { type: 'restart' })
        continue
      }
      const action = selectAction(state, rng.int(CELLS))
      if (action === null) continue
      state = reduceKnight(state, action)
      expect(new Set(state.visited).size).toBe(state.visited.length)
      expect(state.visited.length).toBe(state.moves + 1)
      for (const cell of state.visited) {
        expect(cell).toBeGreaterThanOrEqual(0)
        expect(cell).toBeLessThan(CELLS)
      }
    }
  })
})

describe('性能', () => {
  it('中盘存档解码 < 50ms', () => {
    let state = fresh(3, 'skilled')
    for (let step = 0; step < 30 && legalTargets(state).length > 0; step++) {
      state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    }
    const started = performance.now()
    const decoded = knightstourGame.decode(knightstourGame.encode(state))
    expect(performance.now() - started).toBeLessThan(50)
    expect(decoded).toEqual(state)
  })

  it('走满后的存档解码也 < 50ms', () => {
    const won = playFullTour(fresh(5, 'starter'))
    const started = performance.now()
    const decoded = knightstourGame.decode(knightstourGame.encode(won))
    expect(performance.now() - started).toBeLessThan(50)
    expect(decoded.visited).toHaveLength(CELLS)
  })
})
