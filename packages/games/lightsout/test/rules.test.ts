/**
 * 规则层测试：翻转语义、边界、撤销、重开、达到全灭判胜、非法输入与确定性。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  cellCount,
  configFor,
  createState,
  crossIndexes,
  encodeState,
  gameStatus,
  legalActions,
  litCount,
  reduceLightsOut,
  remainingLights,
  selectAction,
  toggleCross,
  type LightsOutAction,
  type LightsOutState,
} from '../src/index.js'
import { allOff, fixtureState, fresh } from './helpers.js'

/** 未解开的夹具：只亮最后一格（用于观察翻转效果，同时避开「已解开」锁） */
function base(size = 5): LightsOutState {
  const lights = allOff(size)
  lights[size * size - 1] = true
  return fixtureState(lights)
}

/** 从「只亮最后一格」开始连续翻转给定格子（用于构造想要的局面） */
function played(indices: readonly number[], size = 5): LightsOutState {
  let state = base(size)
  for (const index of indices) state = reduceLightsOut(state, { type: 'toggle', index })
  return state
}

describe('翻转语义与边界', () => {
  it('角落翻 3 格、边翻 4 格、内部翻 5 格', () => {
    // 基准局面只亮最后一格 (4,4)，且它不在下面三个十字里，因此亮灯数 = 1 + 十字大小
    expect(litCount(reduceLightsOut(base(), { type: 'toggle', index: 0 }).lights)).toBe(4)
    expect(litCount(reduceLightsOut(base(), { type: 'toggle', index: 2 }).lights)).toBe(5)
    expect(litCount(reduceLightsOut(base(), { type: 'toggle', index: 12 }).lights)).toBe(6)
  })

  it('翻转的正是十字邻域（含自身），其他格不变', () => {
    const state = reduceLightsOut(base(), { type: 'toggle', index: 12 })
    const cross = new Set(crossIndexes(12, 5))
    state.lights.forEach((lit, index) => {
      const expected = cross.has(index) || index === 24
      expect(lit, `index ${index}`).toBe(expected)
    })
  })

  it('同一格连翻两次回到原状态', () => {
    const start = base()
    const once = reduceLightsOut(start, { type: 'toggle', index: 7 })
    const twice = reduceLightsOut(once, { type: 'toggle', index: 7 })
    expect(twice.lights).toEqual(start.lights)
    expect(twice.moves).toBe(2)
  })

  it('每次翻转都记一步并留下历史（history.length === moves）', () => {
    const state = played([0, 2, 12])
    expect(state.moves).toBe(3)
    expect(state.history).toEqual([0, 2, 12])
    expect(state.history).toHaveLength(state.moves)
    expect(remainingLights(state)).toBe(litCount(state.lights))
  })
})

describe('非法输入', () => {
  it('越界 / 非整数索引抛 IllegalActionError', () => {
    const state = base()
    for (const index of [-1, 25, 1.5, Number.NaN]) {
      expect(() => reduceLightsOut(state, { type: 'toggle', index }), String(index)).toThrow(
        IllegalActionError,
      )
    }
    // 非法翻转不改变原状态
    const before = encodeState(state)
    expect(() => reduceLightsOut(state, { type: 'toggle', index: 99 })).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(before)
  })

  it('未知动作（含壳层方向键派发的 move）明确报错', () => {
    const state = base()
    expect(() => reduceLightsOut(state, { type: 'move', dir: 'up' } as unknown as LightsOutAction)).toThrow(
      IllegalActionError,
    )
    expect(() => reduceLightsOut(state, { type: 'nextLevel' } as unknown as LightsOutAction)).toThrow(
      IllegalActionError,
    )
  })
})

describe('达到全灭判胜', () => {
  it('最后一翻把灯全灭 → won；结果可被 view 取到', () => {
    const size = 5
    // 只亮「以 12 为中心的十字」，再翻 12 即全灭
    const almost = fixtureState(toggleCross(allOff(size), size, 12))
    expect(gameStatus(almost)).toBe('playing')
    const won = reduceLightsOut(almost, { type: 'toggle', index: 12 })
    expect(litCount(won.lights)).toBe(0)
    expect(gameStatus(won)).toBe('won')
    expect(won.moves).toBe(1)
  })

  it('解开后不再接受新的翻转（避免误触把刚解开的谜题又点亮），但撤销/重开可用', () => {
    const size = 5
    const won = reduceLightsOut(fixtureState(toggleCross(allOff(size), size, 12)), {
      type: 'toggle',
      index: 12,
    })
    expect(gameStatus(won)).toBe('won')
    expect(() => reduceLightsOut(won, { type: 'toggle', index: 0 })).toThrow(IllegalActionError)
    expect(selectAction(won, 0)).toBeNull()
    // 撤销退回上一个局面后又能继续玩
    const back = reduceLightsOut(won, { type: 'undo' })
    expect(gameStatus(back)).toBe('playing')
    expect(selectAction(back, 0)).toEqual({ type: 'toggle', index: 0 })
    // 重开总是可用
    expect(gameStatus(reduceLightsOut(won, { type: 'restart' }))).toBe('playing')
  })
})

describe('撤销与重开', () => {
  it('撤销后的 encode 与翻转前逐字段完全相同（逐步回退）', () => {
    let state = fresh(4242, 'skilled')
    const snapshots = [encodeState(state)]
    const sequence = [0, 1, 7, 12, 24, 6, 18, 3]
    for (const index of sequence) {
      state = reduceLightsOut(state, { type: 'toggle', index })
      snapshots.push(encodeState(state))
    }
    for (let step = sequence.length; step > 0; step--) {
      expect(encodeState(state)).toEqual(snapshots[step])
      state = reduceLightsOut(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(snapshots[0])
    expect(state.moves).toBe(0)
    expect(state.history).toHaveLength(0)
  })

  it('先翻再撤同一些格子（对合性质）', () => {
    const state = fresh(99, 'challenging')
    let current = state
    for (const index of [0, 5, 35, 17]) {
      current = reduceLightsOut(current, { type: 'toggle', index })
    }
    for (let i = 0; i < 4; i++) current = reduceLightsOut(current, { type: 'undo' })
    expect(encodeState(current)).toEqual(encodeState(state))
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceLightsOut(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到同难度同种子的同一道谜题', () => {
    const state = fresh(777, 'skilled')
    let current = state
    for (const index of [0, 6, 12, 18]) current = reduceLightsOut(current, { type: 'toggle', index })
    const restarted = reduceLightsOut(current, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(state))
    expect(restarted.moves).toBe(0)
    expect(restarted.history).toHaveLength(0)
  })
})

describe('selectAction / legal', () => {
  it('每一格都可以点：合法索引返回 toggle，越界返回 null', () => {
    const state = fresh(5, 'starter')
    for (let index = 0; index < state.lights.length; index++) {
      expect(selectAction(state, index)).toEqual({ type: 'toggle', index })
    }
    for (const index of [-1, state.lights.length, 1.5, Number.NaN]) {
      expect(selectAction(state, index)).toBeNull()
    }
  })

  it('selectAction 返回的动作一定能被 reduce 接受', () => {
    const state = fresh(3, 'starter')
    const action = selectAction(state, 12)!
    const next = reduceLightsOut(state, action)
    expect(next.moves).toBe(1)
    expect(next.history).toEqual([12])
  })

  it('legal 在可玩时包含全部格子 + restart，解开后只剩 undo/restart', () => {
    const state = fresh(9, 'starter')
    const toggles = legalActions(state).filter((action) => action.type === 'toggle')
    expect(toggles).toHaveLength(state.lights.length)
    expect(legalActions(state)).toContainEqual({ type: 'restart' })
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)
    const playedOnce = reduceLightsOut(state, { type: 'toggle', index: 0 })
    expect(legalActions(playedOnce)).toContainEqual({ type: 'undo' })

    const size = configFor('starter').size
    const won = reduceLightsOut(fixtureState(toggleCross(allOff(size), size, 12)), {
      type: 'toggle',
      index: 12,
    })
    expect(legalActions(won).some((action) => action.type === 'toggle')).toBe(false)
    expect(legalActions(won)).toContainEqual({ type: 'restart' })
  })
})

describe('确定性', () => {
  it('同 seed 同动作序列 → encode 完全一致', () => {
    const run = (): unknown => {
      let state = createState(20240607, 'skilled')
      const sequence = [0, 1, 6, 7, 12, 18, 19, 24, 5, 11]
      for (const index of sequence) {
        if (gameStatus(state) !== 'playing') state = reduceLightsOut(state, { type: 'undo' })
        state = reduceLightsOut(state, { type: 'toggle', index })
      }
      return encodeState(state)
    }
    expect(run()).toEqual(run())
  })

  it('create 归一化种子：负数 / 小数 / NaN 与同值结果一致', () => {
    expect(encodeState(createState(-1, 'starter'))).toEqual(
      encodeState(createState(0xffffffff, 'starter')),
    )
    expect(encodeState(createState(1.9, 'starter'))).toEqual(encodeState(createState(1, 'starter')))
    expect(encodeState(createState(Number.NaN, 'starter'))).toEqual(
      encodeState(createState(0, 'starter')),
    )
  })

  it('create 的棋盘尺寸与难度一致、开局不是全灭', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const state = createState(11, difficulty)
      expect(state.lights).toHaveLength(cellCount(configFor(difficulty)))
      expect(gameStatus(state)).toBe('playing')
      expect(state.moves).toBe(0)
    }
  })
})
