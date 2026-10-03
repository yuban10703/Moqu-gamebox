/**
 * 规则层测试：选中/跳吃两步交互、非法跳吃、单步撤销（含选中态）、重开、判胜与确定性。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  HOLE_INDEXES,
  countPegs,
  createState,
  encodeState,
  gameStatus,
  indexOf,
  legalActions,
  pegsolitaireGame,
  reducePegSolitaire,
  selectAction,
  type PegAction,
  type PegState,
} from '../src/index.js'
import { boardWith, fixtureState, fresh } from './helpers.js'

const A = indexOf(2, 2)
const B = indexOf(2, 3)
const C = indexOf(2, 4)
const D = indexOf(3, 2)
const E = indexOf(4, 2)
const F = indexOf(5, 2)

describe('选中语义（select 不算一步）', () => {
  it('点棋子选中；再点同一枚取消；点另一枚改选', () => {
    const state = fresh()
    const selected = reducePegSolitaire(state, { type: 'select', index: A })
    expect(selected.selected).toBe(A)
    expect(selected.moves).toBe(0)
    expect(selected.history).toHaveLength(0)
    expect(reducePegSolitaire(selected, { type: 'select', index: A }).selected).toBeNull()
    expect(reducePegSolitaire(selected, { type: 'select', index: B }).selected).toBe(B)
  })

  it('点空孔 = 清除选中；没有选中时点空孔仍保持无选中', () => {
    const center = indexOf(3, 3) // starter 的中心空孔
    const selected = reducePegSolitaire(fresh(), { type: 'select', index: A })
    expect(reducePegSolitaire(selected, { type: 'select', index: center }).selected).toBeNull()
    expect(reducePegSolitaire(fresh(), { type: 'select', index: center }).selected).toBeNull()
  })

  it('点非孔位（缺角）抛 IllegalActionError', () => {
    const state = fresh()
    for (const index of [indexOf(0, 0), indexOf(6, 6), -1, 49, 1.5]) {
      expect(() => reducePegSolitaire(state, { type: 'select', index }), String(index)).toThrow(
        IllegalActionError,
      )
    }
  })
})

describe('跳吃', () => {
  it('选中起点后跳吃：被跳过的棋子被拿走、选中态清空、记一步', () => {
    const state = fixtureState(boardWith([A, B]))
    const selected = reducePegSolitaire(state, { type: 'select', index: A })
    const jumped = reducePegSolitaire(selected, { type: 'jump', from: A, to: C })
    expect(jumped.pegs[A]).toBe(false)
    expect(jumped.pegs[B]).toBe(false)
    expect(jumped.pegs[C]).toBe(true)
    expect(countPegs(jumped.pegs)).toBe(1)
    expect(jumped.selected).toBeNull()
    expect(jumped.moves).toBe(1)
    expect(jumped.history).toEqual([{ from: A, to: C, jumped: B }])
    expect(jumped.history).toHaveLength(jumped.moves)
  })

  it('没有选中就跳 → 报错', () => {
    const state = fixtureState(boardWith([A, B]))
    expect(() => reducePegSolitaire(state, { type: 'jump', from: A, to: C })).toThrow(
      IllegalActionError,
    )
  })

  it('jump 的 from 必须正是当前选中的棋子', () => {
    const state = fixtureState(boardWith([A, B, D]))
    const selected = reducePegSolitaire(state, { type: 'select', index: B })
    expect(() => reducePegSolitaire(selected, { type: 'jump', from: A, to: C })).toThrow(
      IllegalActionError,
    )
  })

  it('斜跳 / 中间空 / 落点有子 / 起点无子 / 非孔位都抛 IllegalActionError', () => {
    const diagonal = fixtureState(boardWith([indexOf(3, 3), indexOf(4, 4)]))
    const selectedDiagonal = reducePegSolitaire(diagonal, { type: 'select', index: indexOf(3, 3) })
    expect(() =>
      reducePegSolitaire(selectedDiagonal, {
        type: 'jump',
        from: indexOf(3, 3),
        to: indexOf(4, 4),
      }),
    ).toThrow(IllegalActionError)

    // 中间是空孔
    const overEmpty = fixtureState(boardWith([A, C]))
    const selectedOverEmpty = reducePegSolitaire(overEmpty, { type: 'select', index: A })
    expect(() => reducePegSolitaire(selectedOverEmpty, { type: 'jump', from: A, to: C })).toThrow(
      IllegalActionError,
    )

    // 落点有棋子：A、B、C 都有子时 A 无法跳到 C
    const occupied = fixtureState(boardWith([A, B, C, D]))
    const selectedOccupied = reducePegSolitaire(occupied, { type: 'select', index: A })
    expect(() => reducePegSolitaire(selectedOccupied, { type: 'jump', from: A, to: C })).toThrow(
      IllegalActionError,
    )

    // 非孔位（缺角）作为落点
    const normal = fixtureState(boardWith([A, B, indexOf(2, 1)]))
    const selectedNormal = reducePegSolitaire(normal, { type: 'select', index: A })
    expect(() =>
      reducePegSolitaire(selectedNormal, { type: 'jump', from: A, to: indexOf(0, 0) }),
    ).toThrow(IllegalActionError)
    expect(() =>
      reducePegSolitaire(selectedNormal, { type: 'jump', from: indexOf(0, 0), to: A }),
    ).toThrow(IllegalActionError)
  })

  it('非法跳吃不改变原状态（reduce 是纯函数）', () => {
    const state = fixtureState(boardWith([A, B]))
    const before = encodeState(state)
    expect(() => reducePegSolitaire(state, { type: 'jump', from: A, to: C })).toThrow(
      IllegalActionError,
    )
    expect(encodeState(state)).toEqual(before)
  })
})

describe('selectAction 的四个分支', () => {
  it('有棋子的孔 → select；已选中且是合法落点 → jump', () => {
    const pegs = boardWith([A, B])
    const state = fixtureState(pegs)
    expect(selectAction(state, A)).toEqual({ type: 'select', index: A })
    expect(selectAction(state, indexOf(3, 3))).toBeNull() // 空孔且无选中
    const selected = reducePegSolitaire(state, { type: 'select', index: A })
    expect(selectAction(selected, C)).toEqual({ type: 'jump', from: A, to: C })
  })

  it('已有选中但 index 不合法 → select（改选/清除）', () => {
    const state = fixtureState(boardWith([A, B]))
    const selected = reducePegSolitaire(state, { type: 'select', index: A })
    // 点另一个有棋子的孔 → 改选
    expect(selectAction(selected, B)).toEqual({ type: 'select', index: B })
    // 点一个既没子也不是落点的孔 → 改选（reduce 里表现为清除选中）
    const farEmpty = indexOf(0, 2)
    expect(selectAction(selected, farEmpty)).toEqual({ type: 'select', index: farEmpty })
    expect(reducePegSolitaire(selected, selectAction(selected, farEmpty)!).selected).toBeNull()
  })

  it('非孔位 / 越界 / 已解开都返回 null', () => {
    const state = fixtureState(boardWith([A, B]))
    for (const index of [indexOf(0, 0), -1, 49, 1.5]) {
      expect(selectAction(state, index), String(index)).toBeNull()
    }
    const won = reducePegSolitaire(
      reducePegSolitaire(state, { type: 'select', index: A }),
      { type: 'jump', from: A, to: C },
    )
    expect(gameStatus(won)).toBe('won')
    expect(selectAction(won, C)).toBeNull()
    expect(selectAction(won, B)).toBeNull()
  })

  it('selectAction 返回的动作一定能被 reduce 接受', () => {
    const state = fresh('starter')
    const jump = legalActions(state).find(
      (action): action is { type: 'jump'; from: number; to: number } => action.type === 'jump',
    )!
    const selected = reducePegSolitaire(state, selectAction(state, jump.from)!)
    expect(selected.selected).toBe(jump.from)
    const target = selectAction(selected, jump.to)
    expect(target).toEqual({ type: 'jump', from: jump.from, to: jump.to })
    expect(reducePegSolitaire(selected, target!).moves).toBe(1)
  })
})

describe('撤销与重开', () => {
  it('单步撤销逐字段还原（含选中态）：撤销回到跳吃前那一刻', () => {
    let state = fixtureState(boardWith([A, B, D, E]))
    const beforeJump = encodeState(
      reducePegSolitaire(state, { type: 'select', index: A }),
    )
    state = reducePegSolitaire(state, { type: 'select', index: A })
    state = reducePegSolitaire(state, { type: 'jump', from: A, to: C })
    expect(state.moves).toBe(1)
    const undone = reducePegSolitaire(state, { type: 'undo' })
    expect(encodeState(undone)).toEqual(beforeJump)
    // 选中态确实回来了（跳吃前正是它被选中）
    expect(undone.selected).toBe(A)
    expect(undone.moves).toBe(0)
    expect(undone.history).toHaveLength(0)
  })

  it('连续两次跳吃后逐步撤销，每一步都与当时的 encode 完全一致', () => {
    let state = fixtureState(boardWith([A, B, D, E]))
    state = reducePegSolitaire(state, { type: 'select', index: A })
    const snapshot1 = encodeState(state)
    state = reducePegSolitaire(state, { type: 'jump', from: A, to: C })
    state = reducePegSolitaire(state, { type: 'select', index: D })
    const snapshot2 = encodeState(state)
    state = reducePegSolitaire(state, { type: 'jump', from: D, to: F })
    expect(state.moves).toBe(2)
    expect(countPegs(state.pegs)).toBe(2)

    state = reducePegSolitaire(state, { type: 'undo' })
    expect(encodeState(state)).toEqual(snapshot2)
    state = reducePegSolitaire(state, { type: 'undo' })
    expect(encodeState(state)).toEqual(snapshot1)
  })

  it('没有历史时撤销抛 IllegalActionError（选中不算一步）', () => {
    const selected = reducePegSolitaire(fresh(), { type: 'select', index: A })
    expect(() => reducePegSolitaire(selected, { type: 'undo' })).toThrow(IllegalActionError)
    expect(() => reducePegSolitaire(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 回到同一难度的起始布局，选中与历史都清空', () => {
    const initial = fresh('skilled')
    // 从真实局面上取一步合法跳吃（不同起始布局的可行跳吃不同，不能写死）
    const jump = legalActions(initial).find(
      (action): action is { type: 'jump'; from: number; to: number } => action.type === 'jump',
    )!
    let state = reducePegSolitaire(initial, { type: 'select', index: jump.from })
    state = reducePegSolitaire(state, { type: 'jump', from: jump.from, to: jump.to })
    expect(state.moves).toBe(1)
    const restarted = reducePegSolitaire(state, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(initial))
    expect(restarted.selected).toBeNull()
    expect(restarted.moves).toBe(0)
    expect(restarted.history).toHaveLength(0)
  })
})

describe('判胜与终局', () => {
  /** 两枚棋子 + 一个空落点：一步跳吃即剩一枚 */
  function almostWon(): PegState {
    return fixtureState(boardWith([A, B]))
  }

  it('只剩一枚棋子 → won', () => {
    expect(gameStatus(almostWon())).toBe('playing')
    let state = reducePegSolitaire(almostWon(), { type: 'select', index: A })
    state = reducePegSolitaire(state, { type: 'jump', from: A, to: C })
    expect(countPegs(state.pegs)).toBe(1)
    expect(gameStatus(state)).toBe('won')
  })

  it('解开后不再接受选中/跳吃，但撤销与重开可用', () => {
    let state = reducePegSolitaire(almostWon(), { type: 'select', index: A })
    state = reducePegSolitaire(state, { type: 'jump', from: A, to: C })
    expect(gameStatus(state)).toBe('won')
    expect(() => reducePegSolitaire(state, { type: 'select', index: C })).toThrow(IllegalActionError)
    expect(() => reducePegSolitaire(state, { type: 'jump', from: C, to: A })).toThrow(
      IllegalActionError,
    )
    expect(gameStatus(reducePegSolitaire(state, { type: 'undo' }))).toBe('playing')
    expect(gameStatus(reducePegSolitaire(state, { type: 'restart' }))).toBe('playing')
  })

  it('未知动作（方向键 / 旧存档）明确报错', () => {
    const state = fresh()
    expect(() =>
      reducePegSolitaire(state, { type: 'move', dir: 'up' } as unknown as PegAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reducePegSolitaire(state, { type: 'nextLevel' } as unknown as PegAction),
    ).toThrow(IllegalActionError)
  })
})

describe('legal / 确定性', () => {
  it('可玩时 legal 包含全部孔位的 select + 全部合法跳吃，跳过后追加 undo', () => {
    const state = fresh('starter')
    const actions = legalActions(state)
    const selects = actions.filter((action) => action.type === 'select')
    expect(selects).toHaveLength(HOLE_INDEXES.length)
    expect(actions).toContainEqual({ type: 'restart' })
    expect(actions.some((action) => action.type === 'undo')).toBe(false)
    const jump = actions.find(
      (action): action is { type: 'jump'; from: number; to: number } => action.type === 'jump',
    )!
    const played = reducePegSolitaire(
      reducePegSolitaire(state, { type: 'select', index: jump.from }),
      { type: 'jump', from: jump.from, to: jump.to },
    )
    expect(played.moves).toBe(1)
    expect(legalActions(played)).toContainEqual({ type: 'undo' })
  })

  it('同难度同动作序列 → encode 完全一致', () => {
    const run = (): unknown => {
      let state = createState('skilled')
      for (let step = 0; step < 4; step++) {
        const jump = legalActions(state).find(
          (action): action is { type: 'jump'; from: number; to: number } => action.type === 'jump',
        )
        if (!jump) break
        state = reducePegSolitaire(state, { type: 'select', index: jump.from })
        state = reducePegSolitaire(state, { type: 'jump', from: jump.from, to: jump.to })
      }
      return encodeState(state)
    }
    expect(run()).toEqual(run())
  })

  it('create 忽略 seed：同难度永远同一局面', () => {
    expect(pegsolitaireGame.create(1, 'starter')).toEqual(pegsolitaireGame.create(2, 'starter'))
    expect(pegsolitaireGame.create(1, 'challenging').pegs).toEqual(
      createState('challenging').pegs,
    )
  })
})
