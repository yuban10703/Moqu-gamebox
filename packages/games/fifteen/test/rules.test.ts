/**
 * 规则层测试：方向语义、边界拒绝、点格、撤销/重开、胜负流转、确定性与存档校验。
 * 方向语义统一为「空白格朝该方向移动」——下面用手写 fixture 把四个方向的效果逐一钉死。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  DIRECTIONS,
  createSolvedBoard,
  createState,
  encodeState,
  gameStatus,
  legalActions,
  reduceFifteen,
  selectAction,
  type FifteenAction,
  type FifteenState,
} from '../src/index.js'
import { fixtureState, fresh } from './helpers.js'

/** 取当前第一个合法方向动作（用于「随便走一步」的场合） */
function firstSlide(state: FifteenState): { type: 'slide'; dir: 'up' | 'down' | 'left' | 'right' } {
  const action = legalActions(state).find(
    (item): item is { type: 'slide'; dir: 'up' | 'down' | 'left' | 'right' } =>
      item.type === 'slide',
  )
  if (!action) throw new Error('no legal slide')
  return action
}

describe('方向语义：空白格朝该方向移动', () => {
  /** 空白在正中央（index 4），四个方向各有一块可滑 */
  const center = (): FifteenState => fixtureState([1, 2, 3, 4, 0, 5, 6, 7, 8])

  it('up：把空白上方的数字块滑下来', () => {
    const next = reduceFifteen(center(), { type: 'slide', dir: 'up' })
    expect(next.board).toEqual([1, 0, 3, 4, 2, 5, 6, 7, 8])
    // 等价说法：数字块 2 滑进了原来的空白
    expect(next.board[4]).toBe(2)
    expect(next.board[1]).toBe(0)
  })

  it('down：把空白下方的数字块滑上来', () => {
    const next = reduceFifteen(center(), { type: 'slide', dir: 'down' })
    expect(next.board).toEqual([1, 2, 3, 4, 7, 5, 6, 0, 8])
  })

  it('left：把空白左侧的数字块滑到右边', () => {
    const next = reduceFifteen(center(), { type: 'slide', dir: 'left' })
    expect(next.board).toEqual([1, 2, 3, 0, 4, 5, 6, 7, 8])
  })

  it('right：把空白右侧的数字块滑到左边', () => {
    const next = reduceFifteen(center(), { type: 'slide', dir: 'right' })
    expect(next.board).toEqual([1, 2, 3, 4, 5, 0, 6, 7, 8])
  })

  it('每一步都记一步并留下快照（history.length === moves）', () => {
    let state = center()
    for (const dir of DIRECTIONS) {
      state = reduceFifteen(state, { type: 'slide', dir })
      expect(state.history).toHaveLength(state.moves)
    }
    expect(state.moves).toBe(4)
  })
})

describe('边界：空白格贴边时该方向非法', () => {
  it('空白在左上角：up / left 抛 IllegalActionError，down / right 正常', () => {
    const corner = (): FifteenState => fixtureState([0, 1, 2, 3, 4, 5, 6, 7, 8])
    for (const dir of ['up', 'left'] as const) {
      expect(() => reduceFifteen(corner(), { type: 'slide', dir }), dir).toThrow(IllegalActionError)
      // 明确反馈：错误信息里带上方向，便于定位
      expect(() => reduceFifteen(corner(), { type: 'slide', dir })).toThrow(dir)
    }
    expect(reduceFifteen(corner(), { type: 'slide', dir: 'down' }).board).toEqual([
      3, 1, 2, 0, 4, 5, 6, 7, 8,
    ])
    expect(reduceFifteen(corner(), { type: 'slide', dir: 'right' }).board).toEqual([
      1, 0, 2, 3, 4, 5, 6, 7, 8,
    ])
  })

  it('非法滑动不会改变原状态（reduce 是纯函数）', () => {
    const corner = fixtureState([0, 1, 2, 3, 4, 5, 6, 7, 8])
    const before = encodeState(corner)
    expect(() => reduceFifteen(corner, { type: 'slide', dir: 'up' })).toThrow(IllegalActionError)
    expect(encodeState(corner)).toEqual(before)
  })

  it('selectAction 与 legal() 都承认「空白在中央时四个方向都走得通」', () => {
    const center = fixtureState([1, 2, 3, 4, 0, 5, 6, 7, 8])
    const slides = legalActions(center).filter((action) => action.type === 'slide')
    expect(slides).toHaveLength(4)
    // 四个相邻数字块都能点
    for (const index of [1, 3, 5, 7]) {
      expect(selectAction(center, index)).toEqual({ type: 'tap', index })
    }
  })

  it('未知方向明确报错（存档/壳层误派）', () => {
    const center = fixtureState([1, 2, 3, 4, 0, 5, 6, 7, 8])
    expect(() =>
      reduceFifteen(center, { type: 'slide', dir: 'sideways' } as unknown as FifteenAction),
    ).toThrow(IllegalActionError)
  })
})

describe('点格子（tap）', () => {
  const center = (): FifteenState => fixtureState([1, 2, 3, 4, 0, 5, 6, 7, 8])

  it('相邻的数字块可以滑入空白', () => {
    const next = reduceFifteen(center(), { type: 'tap', index: 5 })
    expect(next.board).toEqual([1, 2, 3, 4, 5, 0, 6, 7, 8])
    expect(next.moves).toBe(1)
  })

  it('不相邻 / 空白格 / 越界：selectAction 返回 null（点了没反应）', () => {
    const state = center()
    // 四角与自身都不可点
    for (const index of [0, 2, 4, 6, 8]) {
      expect(selectAction(state, index), `index ${index}`).toBeNull()
    }
    for (const index of [-1, 9, 1.5, Number.NaN]) {
      expect(selectAction(state, index), `index ${index}`).toBeNull()
    }
  })

  it('直接派发不可点的 tap：reduce 幂等返回原状态（与「点了没反应」一致）', () => {
    const state = center()
    expect(reduceFifteen(state, { type: 'tap', index: 0 })).toBe(state)
    expect(reduceFifteen(state, { type: 'tap', index: 4 })).toBe(state)
    expect(reduceFifteen(state, { type: 'tap', index: 8 })).toBe(state)
    expect(state.moves).toBe(0)
    expect(state.history).toHaveLength(0)
  })

  it('越界 tap 抛错（动作载荷本身非法，不是「点了个死格子」）', () => {
    const state = center()
    for (const index of [-1, 9, 1.5]) {
      expect(() => reduceFifteen(state, { type: 'tap', index })).toThrow(IllegalActionError)
    }
  })

  it('tap 与等价方向的 slide 得到同一局面', () => {
    const state = center()
    const byTap = reduceFifteen(state, { type: 'tap', index: 7 })
    const byDir = reduceFifteen(state, { type: 'slide', dir: 'down' })
    expect(encodeState(byTap)).toEqual(encodeState(byDir))
  })
})

describe('胜负流转：还原即 won，再滑一步回到 playing', () => {
  it('最后一步滑动后判定为 won（本玩法没有失败态）', () => {
    const oneBefore = fixtureState([1, 2, 3, 4, 5, 6, 7, 0, 8])
    expect(gameStatus(oneBefore)).toBe('playing')
    const won = reduceFifteen(oneBefore, { type: 'slide', dir: 'right' })
    expect(won.board).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0])
    expect(gameStatus(won)).toBe('won')
  })

  it('已还原再滑一步变回 playing，且步数继续累加', () => {
    const won = fixtureState([1, 2, 3, 4, 5, 6, 7, 8, 0], { moves: 12, history: [] })
    const again = reduceFifteen(won, { type: 'slide', dir: 'left' })
    expect(again.board).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 8])
    expect(gameStatus(again)).toBe('playing')
    expect(again.moves).toBe(13)
  })

  it('还原后 undo 仍可用（可以退回关键一手）', () => {
    const oneBefore = fixtureState([1, 2, 3, 4, 5, 6, 7, 0, 8])
    const won = reduceFifteen(oneBefore, { type: 'slide', dir: 'right' })
    expect(reduceFifteen(won, { type: 'undo' }).board).toEqual(oneBefore.board)
  })
})

describe('撤销与重开', () => {
  it('撤销后的 encode 与滑动前逐字段完全相同', () => {
    let state = fresh(4242, 'skilled')
    const snapshots = [encodeState(state)]
    for (let step = 0; step < 6; step++) {
      state = reduceFifteen(state, firstSlide(state))
      snapshots.push(encodeState(state))
    }
    // 逐步回退，每一步都必须与当时记录的 encode 完全一致
    for (let step = 6; step > 0; step--) {
      expect(encodeState(state)).toEqual(snapshots[step])
      state = reduceFifteen(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(snapshots[0])
    expect(state.moves).toBe(0)
    expect(state.history).toHaveLength(0)
  })

  it('撤销与点格子也一致：tap 后 undo 回到完全相同状态', () => {
    const state = fresh(99, 'challenging')
    // 找第一个可点的数字块（任何局面都至少有一个与空白相邻的数字块）
    const index = state.board.findIndex((_, position) => selectAction(state, position) !== null)
    expect(index).toBeGreaterThanOrEqual(0)
    const after = reduceFifteen(state, { type: 'tap', index })
    expect(after.moves).toBe(1)
    expect(encodeState(reduceFifteen(after, { type: 'undo' }))).toEqual(encodeState(state))
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceFifteen(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到同难度同种子的初始局面', () => {
    const state = fresh(777, 'skilled')
    let played = state
    for (let step = 0; step < 4; step++) played = reduceFifteen(played, firstSlide(played))
    const restarted = reduceFifteen(played, { type: 'restart' })
    expect(restarted.difficulty).toBe(state.difficulty)
    expect(restarted.seed).toBe(state.seed)
    expect(encodeState(restarted)).toEqual(encodeState(state))
    expect(restarted.moves).toBe(0)
    expect(restarted.history).toHaveLength(0)
  })

  it('还原后 restart 也回到初始局面（不是还原局面）', () => {
    const base = fresh(31415, 'starter')
    // 只把盘面换成已还原局面：restart 只看 seed/difficulty，因此必须回到打乱后的初始局面
    const won: FifteenState = { ...base, board: createSolvedBoard(3) }
    expect(gameStatus(won)).toBe('won')
    const restarted = reduceFifteen(won, { type: 'restart' })
    expect(restarted.moves).toBe(0)
    expect(gameStatus(restarted)).toBe('playing')
    expect(encodeState(restarted)).toEqual(encodeState(base))
  })
})

describe('确定性与壳层兼容动作名', () => {
  it('同 seed 同动作序列 → encode 完全一致', () => {
    const run = (): unknown => {
      let state = createState(20240607, 'skilled')
      const dirs = ['up', 'left', 'down', 'right', 'up', 'right'] as const
      for (const dir of dirs) {
        const action = { type: 'slide' as const, dir }
        // 走不通就换一个合法方向，保证两边序列一致
        const legal = legalActions(state).some(
          (item) => item.type === 'slide' && item.dir === dir,
        )
        state = reduceFifteen(state, legal ? action : firstSlide(state))
      }
      return encodeState(state)
    }
    expect(run()).toEqual(run())
  })

  it('create 归一化种子：负数 / 小数 / NaN 与同值结果一致', () => {
    expect(encodeState(createState(-1, 'starter'))).toEqual(encodeState(createState(0xffffffff, 'starter')))
    expect(encodeState(createState(1.9, 'starter'))).toEqual(encodeState(createState(1, 'starter')))
    expect(encodeState(createState(Number.NaN, 'starter'))).toEqual(encodeState(createState(0, 'starter')))
  })

  it('壳层方向盘派发的 move 与契约动作 slide 等价', () => {
    const state = fresh(31, 'skilled')
    const slideAction = firstSlide(state)
    const bySlide = reduceFifteen(state, slideAction)
    const byMove = reduceFifteen(state, { type: 'move', dir: slideAction.dir })
    expect(encodeState(byMove)).toEqual(encodeState(bySlide))
    // legal() 只输出规范动作名
    expect(legalActions(state).every((action) => action.type !== 'move')).toBe(true)
  })

  it('未知动作明确报错', () => {
    expect(() =>
      reduceFifteen(fresh(), { type: 'nextLevel' } as unknown as FifteenAction),
    ).toThrow(IllegalActionError)
  })
})

describe('legal / selectAction', () => {
  it('legal 恰好包含走得通的方向 + 有历史时的 undo + restart', () => {
    const state = fixtureState([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(legalActions(state)).toEqual([
      { type: 'slide', dir: 'down' },
      { type: 'slide', dir: 'right' },
      { type: 'restart' },
    ])
    const played = reduceFifteen(state, { type: 'slide', dir: 'down' })
    expect(legalActions(played)).toContainEqual({ type: 'undo' })
  })

  it('每个 selectAction 返回的动作都能被 reduce 接受', () => {
    let state = fresh(5, 'skilled')
    for (let step = 0; step < 20; step++) {
      let applied = false
      for (let index = 0; index < state.board.length; index++) {
        const action = selectAction(state, index)
        if (action === null) continue
        state = reduceFifteen(state, action)
        applied = true
        break
      }
      if (!applied) {
        state = reduceFifteen(state, firstSlide(state))
      }
    }
    expect(state.moves).toBe(20)
  })
})
