/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  LIT_GLYPH,
  LIT_TEXT_SCALE,
  cellCount,
  configFor,
  gameStatus,
  lightsoutGame,
  scramblePlan,
  type LightsOutState,
} from '../src/index.js'
import { allOff, fixtureState, fresh } from './helpers.js'

/** 沿固定顺序推进 N 步（保证可复现） */
function advance(state: LightsOutState, steps: number, size: number): LightsOutState {
  let current = state
  for (let step = 0; step < steps; step++) {
    current = lightsoutGame.reduce(current, { type: 'toggle', index: step % (size * size) })
  }
  return current
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(lightsoutGame.id).toBe('lightsout')
    expect(lightsoutGame.i18nNamespace).toBe('lightsout')
    expect(lightsoutGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(lightsoutGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(lightsoutGame.illegalNoticeKey).toBe('lightsout.illegal.notice')
    expect(lightsoutGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(lightsoutGame.difficulties.map((item) => item.labelKey)).toEqual([
      'lightsout.difficulty.starter',
      'lightsout.difficulty.skilled',
      'lightsout.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((lightsoutGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('create 按难度给出 5×5 / 5×5 / 6×6，未知难度拒绝', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = lightsoutGame.create(1, difficulty)
      expect(state.lights).toHaveLength(cellCount(DIFFICULTIES[difficulty]))
      expect(gameStatus(state)).toBe('playing')
      expect(state.moves).toBe(0)
      expect(state.history).toHaveLength(0)
    }
    expect(() => lightsoutGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })

  it('contentId = 难度，movesOf = 步数（最佳成绩 = 最少翻转次数）', () => {
    const state = advance(fresh(1, 'skilled'), 4, configFor('skilled').size)
    expect(lightsoutGame.contentId!(state)).toBe('skilled')
    expect(lightsoutGame.movesOf!(state)).toBe(4)
    expect(lightsoutGame.contentId!(lightsoutGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(lightsoutGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(lightsoutGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(lightsoutGame.controlAction!(state, 'hint')).toBeNull()
    expect(lightsoutGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const state = fresh(8, 'starter')
    const played = lightsoutGame.reduce(state, { type: 'toggle', index: 0 })
    expect(
      lightsoutGame.decode(lightsoutGame.encode(lightsoutGame.reduce(played, { type: 'restart' }))),
    ).toEqual(state)
    expect(lightsoutGame.reduce(played, { type: 'undo' }).moves).toBe(0)
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('棋盘尺寸与难度一致、行优先索引、没有分组线', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const size = DIFFICULTIES[difficulty].size
      const view = lightsoutGame.view(lightsoutGame.create(3, difficulty))
      expect(view.board).not.toBeNull()
      expect(view.board!.kind).toBe('grid')
      expect(view.board!.cols).toBe(size)
      expect(view.board!.rows).toBe(size)
      expect(view.board!.cells).toHaveLength(size * size)
      view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
      // 5×5 / 6×6 没有宫结构：多一层线只会更花
      expect(view.board!.groups).toBeUndefined()
    }
  })

  it('亮灯是 tile + ● + textScale 0.62；灭灯是 empty + 空字形', () => {
    const lights = allOff(5)
    lights[0] = true
    lights[12] = true
    const cells = lightsoutGame.view(fixtureState(lights)).board!.cells
    expect(cells[0]).toEqual({
      index: 0,
      kind: 'tile',
      glyph: LIT_GLYPH,
      textScale: LIT_TEXT_SCALE,
    })
    expect(cells[12]).toEqual({
      index: 12,
      kind: 'tile',
      glyph: LIT_GLYPH,
      textScale: LIT_TEXT_SCALE,
    })
    expect(cells[1]).toEqual({ index: 1, kind: 'empty', glyph: '' })
    expect(cells[1]!.textScale).toBeUndefined()
    expect(cells.filter((cell) => cell.kind === 'tile')).toHaveLength(2)
    expect(cells.filter((cell) => cell.kind === 'empty')).toHaveLength(23)
  })

  it('stats 恰好三项：步数 / 已熄灭 / 灯总数', () => {
    const state = advance(fresh(11, 'starter'), 3, 5)
    const view = lightsoutGame.view(state)
    const off = state.lights.filter((lit) => !lit).length
    expect(view.stats).toEqual([
      { labelKey: 'lightsout.stat.moves', value: String(state.moves) },
      { labelKey: 'lightsout.stat.off', value: String(off) },
      { labelKey: 'lightsout.stat.total', value: '25' },
    ])
    expect(lightsoutGame.view(lightsoutGame.create(1, 'challenging')).stats[2]).toEqual({
      labelKey: 'lightsout.stat.total',
      value: '36',
    })
  })

  it('进行中没有结果与提示；全灭后给出结果标题与明细', () => {
    const playing = fresh()
    expect(lightsoutGame.view(playing).result).toBeNull()
    expect(lightsoutGame.view(playing).notice).toBeNull()

    const size = configFor('starter').size
    const won = fixtureState(
      allOff(size),
      { difficulty: 'starter', moves: 9, history: [] },
    )
    expect(gameStatus(won)).toBe('won')
    const result = lightsoutGame.view(won).result!
    expect(result.titleKey).toBe('lightsout.won.title')
    expect(result.details).toEqual([
      { key: 'lightsout.result.moves', params: { count: 9 } },
      { key: 'lightsout.result.lights', params: { count: 25 } },
    ])
  })
})

describe('controls', () => {
  it('只声明撤销（点格子是主要输入），不声明 dpad / 重开 / 下一关', () => {
    const controls = lightsoutGame.controls(fresh())
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

  it('有历史之后 undo 才可用', () => {
    const state = fresh()
    const played = lightsoutGame.reduce(state, { type: 'toggle', index: 6 })
    expect(lightsoutGame.controls(played)[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态往返一致（含 JSON 往返）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = lightsoutGame.create(2024, difficulty)
      expect(lightsoutGame.decode(lightsoutGame.encode(state))).toEqual(state)
      expect(lightsoutGame.decode(JSON.parse(JSON.stringify(lightsoutGame.encode(state))))).toEqual(
        state,
      )
    }
    const played = advance(fresh(606, 'skilled'), 5, 5)
    expect(played.history).toHaveLength(5)
    const decoded = lightsoutGame.decode(lightsoutGame.encode(played))
    expect(decoded).toEqual(played)
    expect(lightsoutGame.encode(decoded)).toEqual(lightsoutGame.encode(played))
  })

  it('解开后的局面也能往返（全灭是可达状态）', () => {
    const freshState = fresh(20240607, 'starter')
    const plan = scramblePlan(configFor('starter'), freshState.seed)
    let state = freshState
    for (const index of plan.toggles) state = lightsoutGame.reduce(state, { type: 'toggle', index })
    expect(gameStatus(state)).toBe('won')
    const decoded = lightsoutGame.decode(lightsoutGame.encode(state))
    expect(decoded).toEqual(state)
    expect(gameStatus(decoded)).toBe('won')
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = advance(fresh(17, 'skilled'), 3, 5)
    // 万一步数极少时已经解开，就再翻一步，保证下面「改成全灭」一定是非法存档
    if (gameStatus(played) !== 'playing') {
      played = lightsoutGame.reduce(played, { type: 'toggle', index: 0 })
    }
    const raw = lightsoutGame.encode(played) as {
      difficulty: string
      seed: number
      rngCursor: number
      lights: boolean[]
      moves: number
      history: number[]
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      [],
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, rngCursor: -1 },
      { ...raw, rngCursor: 1.5 },
      // 游标与同 seed 的打乱结果不符
      { ...raw, rngCursor: raw.rngCursor + 1 },
      { ...raw, lights: 'nope' },
      { ...raw, lights: raw.lights.slice(0, raw.lights.length - 1) },
      { ...raw, lights: [...raw.lights, false] },
      { ...raw, lights: raw.lights.map((lit, index) => (index === 0 ? 1 : lit)) },
      // 被改过的灯：无法由初始谜题按 history 走出
      { ...raw, lights: raw.lights.map((lit, index) => (index === 0 ? !lit : lit)) },
      // 中盘直接写成全灭
      { ...raw, lights: allOff(25) },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, moves: raw.moves - 1 },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, history: 'nope' },
      { ...raw, history: [] },
      { ...raw, history: [...raw.history, 0] },
      { ...raw, history: raw.history.map((index, position) => (position === 0 ? 25 : index)) },
      { ...raw, history: raw.history.map((index, position) => (position === 0 ? 1.5 : index)) },
      // 开局就是全灭（初始谜题由 seed 决定，不可能是全灭）：必须被拒绝
      { ...raw, moves: 0, history: [], lights: allOff(25) },
    ]
    for (const candidate of bad) {
      expect(
        () => lightsoutGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 只用 seed 复算初始谜题，并复核局面可达', () => {
    const played = advance(fresh(55, 'skilled'), 4, 5)
    const decoded = lightsoutGame.decode(lightsoutGame.encode(played))
    expect(decoded.lights).toEqual(played.lights)
    expect(decoded.history).toEqual(played.history)
    expect(decoded.seed).toBe(played.seed)
    expect(decoded.rngCursor).toBe(played.rngCursor)
  })
})

describe('属性测试', () => {
  it('随机 60 步合法翻转：每步 encode→decode 往返一致且能继续走下去', () => {
    const rng = createRng(20240607)
    let state = lightsoutGame.create(20240607, 'skilled')
    const total = state.lights.length
    for (let step = 0; step < 60; step++) {
      // 极小概率随机走回全灭：先撤销一步，保证始终有合法翻转可做
      if (gameStatus(state) !== 'playing') state = lightsoutGame.reduce(state, { type: 'undo' })
      const toggles = lightsoutGame
        .legal(state)
        .filter((action): action is { type: 'toggle'; index: number } => action.type === 'toggle')
      expect(toggles.length, `step ${step}`).toBe(total)
      state = lightsoutGame.reduce(state, toggles[rng.int(toggles.length)]!)

      const encoded = lightsoutGame.encode(state)
      const decoded = lightsoutGame.decode(encoded)
      expect(decoded, `step ${step}`).toEqual(state)
      expect(lightsoutGame.encode(decoded)).toEqual(encoded)
      expect(lightsoutGame.decode(JSON.parse(JSON.stringify(encoded)))).toEqual(state)
      expect(lightsoutGame.legal(decoded).some((action) => action.type === 'toggle')).toBe(true)
      state = decoded
    }
    expect(state.history).toHaveLength(state.moves)
  })

  it('随机翻转不会破坏棋盘尺寸或产生非法值', () => {
    const rng = createRng(7)
    let state = lightsoutGame.create(7, 'challenging')
    const total = state.lights.length
    for (let step = 0; step < 60; step++) {
      if (gameStatus(state) !== 'playing') state = lightsoutGame.reduce(state, { type: 'undo' })
      state = lightsoutGame.reduce(state, { type: 'toggle', index: rng.int(total) })
      expect(state.lights).toHaveLength(total)
      expect(state.lights.every((lit) => typeof lit === 'boolean')).toBe(true)
      for (const index of state.history) {
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(total)
      }
    }
  })
})

describe('性能', () => {
  it('6×6 生成耗时上限（宽松 < 300ms）', () => {
    const started = performance.now()
    for (let seed = 0; seed < 20; seed++) lightsoutGame.create(seed, 'challenging')
    expect(performance.now() - started).toBeLessThan(300)
  })

  it('单次生成 + 解码都在宽松上限内', () => {
    const started = performance.now()
    const state = lightsoutGame.create(20240607, 'challenging')
    lightsoutGame.decode(lightsoutGame.encode(state))
    expect(performance.now() - started).toBeLessThan(300)
  })
})
