/**
 * 规则层测试：选中/滑动、非法滑动、撤销（不撤回选中）、重开、selectAction 各分支与存档校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  CAO_ID,
  CELLS,
  EXIT_CELLS,
  createState,
  encodeState,
  gameStatus,
  indexOf,
  klotskiGame,
  legalActions,
  levelOrThrow,
  reduceKlotski,
  selectAction,
  type KlotskiAction,
  type KlotskiState,
} from '../src/index.js'

/** 取关卡初始局面 */
function fresh(levelId = 'level-1'): KlotskiState {
  return createState(levelId)
}

/** 找一个当前可滑动的动作 */
function firstSlide(state: KlotskiState): { type: 'slide'; id: string; dir: 'up' | 'down' | 'left' | 'right' } {
  const action = legalActions(state).find(
    (item): item is { type: 'slide'; id: string; dir: 'up' | 'down' | 'left' | 'right' } =>
      item.type === 'slide',
  )
  if (!action) throw new Error('no slide')
  return action
}

describe('起始状态', () => {
  it('四关都能创建，且都是「进行中、0 步、无选中、无日志」', () => {
    for (const id of ['level-1', 'level-2', 'level-3', 'level-4']) {
      const state = createState(id)
      expect(state.levelId).toBe(id)
      expect(state.moves).toBe(0)
      expect(state.log).toHaveLength(0)
      expect(state.selected).toBeNull()
      expect(gameStatus(state)).toBe('playing')
    }
  })

  it('未知关卡抛 IllegalActionError', () => {
    expect(() => createState('level-9')).toThrow(IllegalActionError)
  })

  it('GameDef 按难度给出该难度第一关', () => {
    expect(klotskiGame.create(0, 'starter').levelId).toBe('level-1')
    expect(klotskiGame.create(0, 'skilled').levelId).toBe('level-3')
    expect(klotskiGame.create(0, 'challenging').levelId).toBe('level-4')
    expect(() => klotskiGame.create(0, 'impossible')).toThrow(IllegalActionError)
  })
})

describe('选中与滑动', () => {
  it('select 选中/取消选中；未知块抛错', () => {
    const state = fresh()
    const selected = reduceKlotski(state, { type: 'select', id: CAO_ID })
    expect(selected.selected).toBe(CAO_ID)
    expect(selected.moves).toBe(0)
    expect(selected.log).toHaveLength(0)
    expect(reduceKlotski(selected, { type: 'select', id: CAO_ID }).selected).toBeNull()
    expect(() => reduceKlotski(state, { type: 'select', id: 'nope' })).toThrow(IllegalActionError)
  })

  it('slide 只走一格；被挡住 / 越界 / 未知块 / 非法方向都抛错', () => {
    const state = fresh()
    // 曹操在 level-1 顶部正中：下被关羽挡、左被张飞挡、上/右越界
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(() => reduceKlotski(state, { type: 'slide', id: CAO_ID, dir })).toThrow(
        IllegalActionError,
      )
    }
    expect(() => reduceKlotski(state, { type: 'slide', id: 'nope', dir: 'up' })).toThrow(
      IllegalActionError,
    )
    expect(() =>
      reduceKlotski(state, { type: 'slide', id: CAO_ID, dir: 'sideways' as never }),
    ).toThrow(IllegalActionError)

    const moved = reduceKlotski(state, { type: 'slide', id: 'pawn-3', dir: 'right' })
    expect(moved.positions['pawn-3']).toBe(indexOf(4, 1))
    expect(moved.positions['pawn-4']).toBe(indexOf(4, 3))
    expect(moved.moves).toBe(1)
    expect(moved.log).toEqual([{ id: 'pawn-3', dir: 'right' }])
    // 滑动不改选中态
    const selected = reduceKlotski(state, { type: 'select', id: CAO_ID })
    const slid = reduceKlotski(selected, { type: 'slide', id: 'pawn-3', dir: 'right' })
    expect(slid.selected).toBe(CAO_ID)
    // 非法滑动不改变原状态
    const before = encodeState(state)
    expect(() => reduceKlotski(state, { type: 'slide', id: CAO_ID, dir: 'up' })).toThrow(
      IllegalActionError,
    )
    expect(encodeState(state)).toEqual(before)
  })
})

describe('撤销与重开', () => {
  it('撤销逐字段还原（含位置、步数、日志）', () => {
    const start = fresh('level-1')
    const before = encodeState(start)
    const slides: Array<{ id: string; dir: 'up' | 'down' | 'left' | 'right' }> = [
      { id: 'pawn-3', dir: 'right' },
      { id: 'pawn-4', dir: 'left' },
      // 两个卒让开后，赵云（竖将 (2,0)-(3,0)）才能往下滑
      { id: 'zhao', dir: 'down' },
    ]
    let state = start
    const snapshots = [encodeState(state)]
    for (const slide of slides) {
      state = reduceKlotski(state, { type: 'slide', ...slide })
      snapshots.push(encodeState(state))
    }
    for (let step = slides.length; step > 0; step--) {
      expect(encodeState(state)).toEqual(snapshots[step])
      state = reduceKlotski(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(before)
  })

  it('撤销不撤回选中：先选中再滑动，撤销后那块仍然选中', () => {
    const start = fresh('level-1')
    const selected = reduceKlotski(start, { type: 'select', id: 'pawn-3' })
    const slid = reduceKlotski(selected, { type: 'slide', id: 'pawn-3', dir: 'right' })
    expect(slid.selected).toBe('pawn-3')
    const undone = reduceKlotski(slid, { type: 'undo' })
    expect(undone.selected).toBe('pawn-3')
    expect(undone.positions['pawn-3']).toBe(indexOf(4, 0))
    expect(undone.moves).toBe(0)
    expect(undone.log).toHaveLength(0)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceKlotski(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到本关初始摆法', () => {
    const start = fresh('level-3')
    let state = reduceKlotski(start, firstSlide(start))
    state = reduceKlotski(state, { type: 'select', id: CAO_ID })
    const restarted = reduceKlotski(state, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(start))
    expect(restarted.selected).toBeNull()
  })
})

describe('selectAction', () => {
  it('点块 → select；已选中时点旁边的合法空格 → slide', () => {
    const state = fresh('level-1')
    // 点曹操占用的格
    expect(selectAction(state, indexOf(0, 1))).toEqual({ type: 'select', id: CAO_ID })
    expect(selectAction(state, indexOf(1, 2))).toEqual({ type: 'select', id: CAO_ID })
    // 点空格但没有选中 → null
    expect(selectAction(state, EXIT_CELLS[0]!)).toBeNull()
    // 选中底行左边的卒，点它右边的空格 → 向右滑
    const selected = reduceKlotski(state, { type: 'select', id: 'pawn-3' })
    expect(selectAction(selected, indexOf(4, 1))).toEqual({
      type: 'slide',
      id: 'pawn-3',
      dir: 'right',
    })
    // 返回的动作一定能被 reduce 接受
    const action = selectAction(selected, indexOf(4, 1))!
    expect(reduceKlotski(selected, action).moves).toBe(1)
  })

  it('已选中时点另一块 → 改选（select）', () => {
    const state = fresh('level-1')
    const selected = reduceKlotski(state, { type: 'select', id: CAO_ID })
    expect(selectAction(selected, indexOf(0, 0))).toEqual({ type: 'select', id: 'zhang' })
    // 点被选中的那块自己 → select（由 reduce 取消选中）
    expect(selectAction(selected, indexOf(0, 1))).toEqual({ type: 'select', id: CAO_ID })
  })

  it('只提供当前合法的那一步：方向被别的块挡住时返回 null', () => {
    // level-4：黄忠竖将在 (2,3)-(3,3)，向左要 (2,2)+(3,2)，而 (2,2) 被关羽占着
    const state = fresh('level-4')
    const selected = reduceKlotski(state, { type: 'select', id: 'huang' })
    expect(selected.positions['huang']).toBe(indexOf(2, 3))
    // 向左要 (2,2)+(3,2)，(2,2) 被关羽占着 → 不给 slide
    expect(selectAction(selected, indexOf(3, 2))).toBeNull()
    // (3,1) 虽是空格但与黄忠不相邻 → 也不给 slide
    expect(selectAction(selected, indexOf(3, 1))).toBeNull()
    // (4,3) 被卒占着 → 直接改选那个卒
    expect(selectAction(selected, indexOf(4, 3))).toEqual({ type: 'select', id: 'pawn-4' })
    // 往上 (1,3) 是马超，直接就是另一块 → 改选
    expect(selectAction(selected, indexOf(1, 3))).toEqual({ type: 'select', id: 'ma' })
  })

  it('越界 / 未选中时点空格 都返回 null', () => {
    const state = fresh('level-1')
    for (const index of [-1, CELLS, 1.5, Number.NaN]) {
      expect(selectAction(state, index), String(index)).toBeNull()
    }
    for (let index = 0; index < CELLS; index++) {
      const action = selectAction(state, index)
      if (action === null) continue
      // 未选中时只会给出 select
      expect(action.type).toBe('select')
    }
  })
})

describe('未知动作', () => {
  it('方向键 / 旧动作名明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceKlotski(state, { type: 'move', dir: 'up' } as unknown as KlotskiAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reduceKlotski(state, { type: 'nextLevel' } as unknown as KlotskiAction),
    ).toThrow(IllegalActionError)
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态严格往返（含 JSON 往返）', () => {
    for (const id of ['level-1', 'level-2', 'level-3', 'level-4']) {
      const state = createState(id)
      expect(klotskiGame.decode(klotskiGame.encode(state))).toEqual(state)
      expect(klotskiGame.decode(JSON.parse(JSON.stringify(klotskiGame.encode(state))))).toEqual(
        state,
      )
    }
    let state = fresh('level-1')
    const slides = [
      { id: 'pawn-3', dir: 'right' as const },
      { id: 'pawn-4', dir: 'left' as const },
      { id: 'zhao', dir: 'down' as const },
    ]
    for (const slide of slides) state = reduceKlotski(state, { type: 'slide', ...slide })
    expect(state.moves).toBe(3)
    const decoded = klotskiGame.decode(klotskiGame.encode(state))
    expect(decoded).toEqual(state)
    expect(klotskiGame.encode(decoded)).toEqual(klotskiGame.encode(state))
  })

  it('选中态随存档往返（选中不参与重放，但要保留）', () => {
    const state = reduceKlotski(fresh('level-1'), { type: 'select', id: 'guan' })
    const decoded = klotskiGame.decode(klotskiGame.encode(state))
    expect(decoded.selected).toBe('guan')
    expect(decoded).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh('level-1')
    played = reduceKlotski(played, { type: 'slide', id: 'pawn-3', dir: 'right' })
    played = reduceKlotski(played, { type: 'slide', id: 'pawn-4', dir: 'left' })
    const raw = klotskiGame.encode(played) as {
      levelId: string
      positions: Record<string, number>
      selected: string | null
      moves: number
      log: Array<{ id: string; dir: string }>
    }
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      [],
      { ...raw, levelId: 'level-9' },
      { ...raw, levelId: 42 },
      { ...raw, log: 'nope' },
      { ...raw, log: [] },
      { ...raw, log: [{ id: 'nope', dir: 'up' }] },
      { ...raw, log: [{ id: 'pawn-3', dir: 'sideways' }] },
      { ...raw, log: [raw.log[0]!, raw.log[0]!] },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, positions: 'nope' },
      // 块数量不对（少一个 / 多一个）
      {
        ...raw,
        positions: Object.fromEntries(
          Object.entries(raw.positions).filter(([id]) => id !== 'pawn-4'),
        ),
      },
      { ...raw, positions: { ...raw.positions, extra: 0 } },
      // 块越界（曹操放到最后一列）
      { ...raw, positions: { ...raw.positions, [CAO_ID]: indexOf(3, 3) } },
      // 块重叠（两个块都在同一个格子）
      { ...raw, positions: { ...raw.positions, [CAO_ID]: raw.positions['zhang']! } },
      // 位置表与日志重放结果不一致（棋子凭空变化）
      { ...raw, positions: { ...raw.positions, [CAO_ID]: indexOf(1, 1) } },
      // 选中不存在的块
      { ...raw, selected: 'nope' },
      { ...raw, selected: 42 },
    ]
    for (const candidate of bad) {
      expect(
        () => klotskiGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 只用关卡 id + 日志重放，不读存档里的位置表', () => {
    const played = reduceKlotski(fresh('level-2'), { type: 'slide', id: 'pawn-4', dir: 'left' })
    const decoded = klotskiGame.decode(klotskiGame.encode(played))
    expect(decoded.positions).toEqual(played.positions)
    expect(decoded.positions['pawn-4']).toBe(played.positions['pawn-4'])
    expect(levelOrThrow(played.levelId).def.id).toBe('level-2')
  })
})
