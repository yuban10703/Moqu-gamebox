/**
 * 规则层测试：走子合法性、撤销（含访问集合与步数）、重开、走满判胜、提示开关与存档校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  CELLS,
  knightstourGame,
  createState,
  encodeState,
  gameStatus,
  indexOf,
  isKnightMove,
  knightMoves,
  legalActions,
  legalTargets,
  pickStart,
  reduceKnight,
  selectAction,
  type KnightAction,
  type KnightState,
} from '../src/index.js'
import { solveKnightTour } from './helpers.js'

function fresh(seed = 20240607, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter'): KnightState {
  return createState(seed, difficulty)
}

/** 取当前第一个合法落点 */
function firstTarget(state: KnightState): number {
  const target = legalTargets(state)[0]
  if (target === undefined) throw new Error('no legal target')
  return target
}

describe('走子合法性', () => {
  it('起点由 seed 决定；起始状态：0 步、只访问起点', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const state = fresh(7, difficulty)
      expect(state.start).toBe(pickStart(7, difficulty))
      expect(state.current).toBe(state.start)
      expect(state.visited).toEqual([state.start])
      expect(state.moves).toBe(0)
      expect(state.log).toHaveLength(0)
      expect(state.hintOn).toBe(false)
      expect(gameStatus(state)).toBe('playing')
    }
  })

  it('从角落出发正好有两个合法马步，其它位移都抛 IllegalActionError', () => {
    // 找一个从角出发的局面（starter 的候选只有四个角）
    const state = fresh(3, 'starter')
    const targets = legalTargets(state).sort((a, b) => a - b)
    expect(targets).toHaveLength(2)
    for (const to of targets) expect(isKnightMove(state.current, to)).toBe(true)

    // 非马步（横竖/斜走/隔一格）都非法
    const row = Math.floor(state.current / 8)
    const col = state.current % 8
    const illegal: number[] = []
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const index = indexOf(r, c)
        if (index === state.current) continue
        if (isKnightMove(state.current, index)) continue
        illegal.push(index)
      }
    }
    // 抽前若干个非马步逐一验证都会抛错
    for (const to of illegal.slice(0, 12)) {
      expect(() => reduceKnight(state, { type: 'move', to }), `->${to}`).toThrow(
        IllegalActionError,
      )
    }
    void row
    void col
  })

  it('越界 / 原地 / 已访问格都抛 IllegalActionError', () => {
    const state = fresh(11, 'starter')
    for (const to of [-1, CELLS, 1.5, Number.NaN]) {
      expect(() => reduceKnight(state, { type: 'move', to }), String(to)).toThrow(
        IllegalActionError,
      )
    }
    expect(() => reduceKnight(state, { type: 'move', to: state.current })).toThrow(
      IllegalActionError,
    )
    // 走一步之后，落点与原起点都已被访问
    const to = firstTarget(state)
    const moved = reduceKnight(state, { type: 'move', to })
    expect(() => reduceKnight(moved, { type: 'move', to: state.current })).toThrow(
      IllegalActionError,
    )
    expect(() => reduceKnight(moved, { type: 'move', to })).toThrow(IllegalActionError)
    // 非法走子不改变原状态
    const before = encodeState(state)
    expect(() => reduceKnight(state, { type: 'move', to: state.current })).toThrow(
      IllegalActionError,
    )
    expect(encodeState(state)).toEqual(before)
  })

  it('合法走子：当前位置/访问集合/步数/日志一起前进', () => {
    const state = fresh(20240607, 'skilled')
    const to = firstTarget(state)
    const moved = reduceKnight(state, { type: 'move', to })
    expect(moved.current).toBe(to)
    expect(moved.visited).toEqual([state.start, to].sort((a, b) => a - b))
    expect(moved.moves).toBe(1)
    expect(moved.log).toEqual([to])
    expect(moved.start).toBe(state.start)
  })
})

describe('撤销与重开', () => {
  it('撤销逐字段还原（含访问集合与步数）', () => {
    let state = fresh(4, 'challenging')
    const snapshots = [encodeState(state)]
    for (let step = 0; step < 8; step++) {
      state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
      snapshots.push(encodeState(state))
    }
    for (let step = 8; step > 0; step--) {
      expect(encodeState(state)).toEqual(snapshots[step])
      state = reduceKnight(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(snapshots[0])
    expect(state.moves).toBe(0)
    expect(state.visited).toEqual([state.start])
    expect(state.current).toBe(state.start)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceKnight(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 回到由 seed 决定的起点（提示模式也一起关掉）', () => {
    const start = fresh(99, 'starter')
    let state = reduceKnight(start, { type: 'hint' })
    state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    const restarted = reduceKnight(state, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(start))
    expect(restarted.hintOn).toBe(false)
    expect(restarted.current).toBe(restarted.start)
  })
})

describe('提示开关', () => {
  it('starter 可以开关提示，且完全不影响棋局', () => {
    const state = fresh(5, 'starter')
    const on = reduceKnight(state, { type: 'hint' })
    expect(on.hintOn).toBe(true)
    expect(on.current).toBe(state.current)
    expect(on.visited).toEqual(state.visited)
    expect(on.moves).toBe(0)
    expect(on.log).toHaveLength(0)
    expect(reduceKnight(on, { type: 'hint' }).hintOn).toBe(false)
  })

  it('其它难度没有提示：派发 hint 会报错', () => {
    for (const difficulty of ['skilled', 'challenging'] as const) {
      expect(() => reduceKnight(fresh(1, difficulty), { type: 'hint' })).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('selectAction / legal', () => {
  it('合法马步且未访问 → move；其余一律 null', () => {
    const state = fresh(8, 'starter')
    for (const to of legalTargets(state)) {
      expect(selectAction(state, to)).toEqual({ type: 'move', to })
    }
    // 已访问（起点）
    expect(selectAction(state, state.start)).toBeNull()
    // 非马步
    expect(selectAction(state, indexOf(0, 1))).toBeNull()
    // 越界
    for (const index of [-1, CELLS, 1.5, Number.NaN]) {
      expect(selectAction(state, index), String(index)).toBeNull()
    }
    // 每个返回的动作都能被 reduce 接受
    const action = selectAction(state, firstTarget(state))!
    expect(reduceKnight(state, action).moves).toBe(1)
  })

  it('走满之后 selectAction 返回 null', () => {
    const state = fresh(2, 'skilled')
    const tour = solveKnightTour(8, state.start).solution!
    let current = state
    for (const to of tour.slice(1)) current = reduceKnight(current, { type: 'move', to })
    expect(gameStatus(current)).toBe('won')
    for (const index of legalTargets(current)) {
      expect(selectAction(current, index)).toBeNull()
    }
    void knightMoves
  })

  it('legal 在可玩时列出全部合法落点（starter 还包含 hint），走满后只剩 undo/restart', () => {
    const state = fresh(6, 'starter')
    const moves = legalActions(state).filter((action) => action.type === 'move')
    expect(moves.map((action) => (action as { to: number }).to).sort((a, b) => a - b)).toEqual(
      legalTargets(state),
    )
    expect(legalActions(state)).toContainEqual({ type: 'hint' })
    expect(legalActions(fresh(6, 'skilled'))).not.toContainEqual({ type: 'hint' })
    expect(legalActions(state)).toContainEqual({ type: 'restart' })
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)

    const tour = solveKnightTour(8, state.start).solution!
    let current = state
    for (const to of tour.slice(1)) current = reduceKnight(current, { type: 'move', to })
    const finished = legalActions(current)
    expect(finished.some((action) => action.type === 'move')).toBe(false)
    expect(finished.some((action) => action.type === 'hint')).toBe(false)
    expect(finished).toContainEqual({ type: 'undo' })
    expect(finished).toContainEqual({ type: 'restart' })
  })

  it('未知动作（方向键 / 旧动作名）明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceKnight(state, { type: 'move', dir: 'up' } as unknown as KnightAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reduceKnight(state, { type: 'nextLevel' } as unknown as KnightAction),
    ).toThrow(IllegalActionError)
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态严格往返（含 JSON 往返）', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const state = fresh(2024, difficulty)
      expect(knightstourGame.decode(knightstourGame.encode(state))).toEqual(state)
      expect(
        knightstourGame.decode(JSON.parse(JSON.stringify(knightstourGame.encode(state)))),
      ).toEqual(state)
    }
    let state = fresh(17, 'skilled')
    for (let step = 0; step < 10; step++) {
      state = reduceKnight(state, { type: 'move', to: firstTarget(state) })
    }
    const decoded = knightstourGame.decode(knightstourGame.encode(state))
    expect(decoded).toEqual(state)
    expect(knightstourGame.encode(decoded)).toEqual(knightstourGame.encode(state))
  })

  it('提示开关也随存档往返', () => {
    const state = reduceKnight(fresh(3, 'starter'), { type: 'hint' })
    const decoded = knightstourGame.decode(knightstourGame.encode(state))
    expect(decoded.hintOn).toBe(true)
    expect(decoded).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh(21, 'starter')
    played = reduceKnight(played, { type: 'move', to: firstTarget(played) })
    const raw = knightstourGame.encode(played) as {
      difficulty: string
      seed: number
      start: number
      current: number
      visited: number[]
      moves: number
      log: number[]
      hintOn: boolean
    }
    const other = indexOf(3, 3)
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
      // 起点被改（必须由 seed + 难度复算）
      { ...raw, start: other },
      // 当前位置与日志重放不一致
      { ...raw, current: other },
      // 凭空多访问一格 / 访问集合不一致
      { ...raw, visited: [...raw.visited, other] },
      { ...raw, visited: [raw.start] },
      { ...raw, visited: [...raw.visited].reverse() },
      // 步数与日志不一致
      { ...raw, moves: raw.moves + 1 },
      { ...raw, moves: -1 },
      { ...raw, log: [] },
      { ...raw, log: [...raw.log, 99] },
      // 跳了非马步（起点 → 相邻格）
      { ...raw, log: [raw.start + 1], current: raw.start + 1, visited: [raw.start, raw.start + 1].sort((a, b) => a - b) },
      // 重复访问同一格
      { ...raw, log: [...raw.log, raw.log[0]!] },
      { ...raw, hintOn: 'yes' },
      // 非 starter 难度不允许开启提示
      {
        ...(knightstourGame.encode(fresh(3, 'skilled')) as Record<string, unknown>),
        hintOn: true,
      },
    ]
    for (const candidate of bad) {
      expect(
        () => knightstourGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 从 (seed, difficulty, log) 复算，不信任存档里的 materialized 字段', () => {
    const played = reduceKnight(fresh(31, 'challenging'), {
      type: 'move',
      to: firstTarget(fresh(31, 'challenging')),
    })
    const decoded = knightstourGame.decode(knightstourGame.encode(played))
    expect(decoded.current).toBe(played.current)
    expect(decoded.visited).toEqual(played.visited)
    expect(decoded.moves).toBe(played.moves)
    expect(decoded.start).toBe(pickStart(31, 'challenging'))
  })
})
