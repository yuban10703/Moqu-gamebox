/**
 * 规则层测试：落子/移动/飞子、成三与吃子限制、胜负、撤销一整回合、selectAction 与存档重放校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK,
  MILL_LINES,
  POINT_COUNT,
  STONES_PER_SIDE,
  WHITE,
  areAdjacent,
  boardCount,
  createState,
  emptyPoints,
  encodeState,
  gameStatus,
  isInMill,
  legalActions,
  ninemensGame,
  otherPlayer,
  phaseOf,
  rawActions,
  removablePoints,
  selectAction,
  stonesLeft,
  stuckPlayer,
  type NinemensAction,
  type NinemensState,
} from '../src/index.js'
import { describeBoard, fixture, fresh, invariantProblems } from './helpers.js'

function act(state: NinemensState, action: NinemensAction): NinemensState {
  return ninemensGame.reduce(state, action)
}

/** 落子期推进：黑方按 `pick` 落子/吃子，直到黑方手上落完（白方由规则层应手） */
function finishPlacement(seed: number, pick: (state: NinemensState) => number): NinemensState {
  let state = fresh(seed, 'starter')
  let guard = 0
  while (state.inHand[BLACK] > 0 && gameStatus(state) === 'playing') {
    if (guard++ > 200) throw new Error('placement did not finish')
    if (state.pendingRemove > 0) {
      state = act(state, { type: 'remove', index: removablePoints(state, WHITE)[0]! })
    } else {
      state = act(state, { type: 'place', index: pick(state) })
    }
  }
  return state
}

/** 一直走「第一个合法动作」，直到终局 */
function playToEnd(seed: number, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter') {
  let state = fresh(seed, difficulty)
  const rng = createRng(seed)
  let guard = 0
  const problems: string[] = []
  while (gameStatus(state) === 'playing') {
    if (guard++ > 600) throw new Error(`game did not finish\n${describeBoard(state)}`)
    const actions = rawActions(state)
    if (actions.length === 0) break
    // 黑方随机选一个合法动作（确定性种子），保证每局都能走到终局
    state = act(state, actions[rng.int(actions.length)]!)
    problems.push(...invariantProblems(state))
  }
  return { state, problems, plies: guard }
}

describe('落子期', () => {
  it('双方各落 9 子后进入移动/飞子期；之后再落子抛错', () => {
    const state = finishPlacement(2024, (current) => emptyPoints(current)[0]!)
    expect(state.inHand).toEqual({ black: 0, white: 0 })
    expect(phaseOf(state)).not.toBe('placing')
    expect(invariantProblems(state)).toEqual([])
    if (gameStatus(state) === 'playing') {
      expect(['moving', 'flying']).toContain(phaseOf(state))
      expect(() => act(state, { type: 'place', index: emptyPoints(state)[0]! })).toThrow(
        IllegalActionError,
      )
    }
  })

  it('落到已占用的点位 / 越界 / 非整数都抛 IllegalActionError', () => {
    let state = fresh(1, 'starter')
    state = act(state, { type: 'place', index: 8 })
    expect(() => act(state, { type: 'place', index: 8 })).toThrow(IllegalActionError)
    for (const index of [-1, POINT_COUNT, 1.5, Number.NaN]) {
      expect(() => act(state, { type: 'place', index }), String(index)).toThrow(IllegalActionError)
    }
    // 非法动作不改变原状态
    const before = encodeState(state)
    expect(() => act(state, { type: 'place', index: 8 })).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(before)
  })
})

describe('移动期与飞子期', () => {
  const moving = fixture([0, 8, 9, 16], [1, 2, 3, 4], { inHand: { black: 0, white: 0 } })

  it('只能沿连接线走一格：不相邻的空点抛错，相邻的可以走', () => {
    expect(phaseOf(moving)).toBe('moving')
    // 0 的邻居是 1(白子) 和 7(空) → 只能走 7
    const neighbor = 7
    expect(areAdjacent(0, neighbor)).toBe(true)
    const moved = act(moving, { type: 'move', from: 0, to: neighbor })
    expect(moved.points[0]).toBeNull()
    expect(moved.points[neighbor]).toBe(BLACK)
    // 不相邻的空点（16 是空的且与 0 不相邻）
    expect(areAdjacent(0, 16)).toBe(false)
    expect(() => act(moving, { type: 'move', from: 0, to: 16 })).toThrow(IllegalActionError)
    // 目标已占用
    expect(() => act(moving, { type: 'move', from: 0, to: 1 })).toThrow(IllegalActionError)
    // 不能移动别人的子
    expect(() => act(moving, { type: 'move', from: 1, to: 10 })).toThrow(IllegalActionError)
    // 不能移动空点位
    expect(() => act(moving, { type: 'move', from: 10, to: 11 })).toThrow(IllegalActionError)
  })

  it('飞子期只在正好剩 3 子时开启：4 子不能飞，3 子可以飞', () => {
    const four = fixture([0, 8, 9, 16], [1, 2, 3], {
      inHand: { black: 0, white: 0 },
      removed: { black: 5, white: 6 },
    })
    expect(stonesLeft(four, BLACK)).toBe(4)
    expect(phaseOf(four)).toBe('moving')
    expect(() => act(four, { type: 'move', from: 0, to: 16 })).toThrow(IllegalActionError)

    const three = fixture([0, 8, 16], [1, 2, 3], {
      inHand: { black: 0, white: 0 },
      removed: { black: 6, white: 6 },
    })
    expect(phaseOf(three)).toBe('flying')
    const flown = act(three, { type: 'move', from: 0, to: 22 })
    expect(flown.points[22]).toBe(BLACK)
    expect(flown.points[0]).toBeNull()
  })
})

describe('成三与吃子', () => {
  it('横线与竖线都能成三（同一子属于两条线时算两次）', () => {
    // 行 0 的线 = [0,1,2]（(0,0),(0,3),(0,6)）
    const horizontal = fixture([0, 1], [8, 9, 10, 11], { inHand: { black: 7, white: 5 } })
    const formedH = act(horizontal, { type: 'place', index: 2 })
    expect(formedH.pendingRemove).toBe(1)
    expect(formedH.turn).toBe(BLACK)

    // 列 0 的线 = [0,7,6]
    const vertical = fixture([0, 7], [8, 9, 10, 11], { inHand: { black: 7, white: 5 } })
    const formedV = act(vertical, { type: 'place', index: 6 })
    expect(formedV.pendingRemove).toBe(1)

    // 双成三：行 1 = [8,9,10]，列 3 = [1,9,17]；在 9 落子同时补上两条线
    const double = fixture([8, 10, 1, 17], [11, 12, 13, 14], { inHand: { black: 5, white: 5 } })
    const formedTwo = act(double, { type: 'place', index: 9 })
    expect(formedTwo.pendingRemove).toBe(2)
    expect(MILL_LINES.filter((line) => line.includes(9)).length).toBe(2)
  })

  it('吃子限制：不能吃三连里的子，除非对方所有子都在三连里', () => {
    // 白方有三连 [0,1,2]，另外还有一颗在 12
    const state = fixture([8, 9, 10, 11], [0, 1, 2, 12], {
      inHand: { black: 5, white: 5 },
      pendingRemove: 1,
    })
    expect(isInMill(state, 0, WHITE)).toBe(true)
    expect(isInMill(state, 12, WHITE)).toBe(false)
    expect(removablePoints(state, WHITE)).toEqual([12])
    expect(act(state, { type: 'remove', index: 12 }).points[12]).toBeNull()

    const protectedState = fixture([8, 9, 10, 11], [0, 1, 2, 13], {
      inHand: { black: 5, white: 5 },
      pendingRemove: 1,
    })
    expect(() => act(protectedState, { type: 'remove', index: 0 })).toThrow(IllegalActionError)
    // 不能吃自己的子
    expect(() => act(protectedState, { type: 'remove', index: 8 })).toThrow(IllegalActionError)
    // 没有待吃子时不能吃
    expect(() =>
      act(fixture([8], [0], { inHand: { black: 8, white: 8 } }), { type: 'remove', index: 0 }),
    ).toThrow(IllegalActionError)
  })

  it('对方所有子都在三连里时可以吃三连中的子', () => {
    const state = fixture([8, 9, 10, 11], [0, 1, 2], {
      inHand: { black: 5, white: 6 },
      pendingRemove: 1,
    })
    expect(removablePoints(state, WHITE)).toEqual([0, 1, 2])
    const removed = act(state, { type: 'remove', index: 0 })
    expect(removed.points[0]).toBeNull()
    expect(removed.removed.white).toBe(1)
  })

  it('吃满后换手并回到正常流程（双成三要吃两次）', () => {
    const state = fixture([8, 10, 1, 17], [11, 12, 13, 14], { inHand: { black: 5, white: 5 } })
    const afterPlace = act(state, { type: 'place', index: 9 })
    expect(afterPlace.pendingRemove).toBe(2)
    const firstRemove = act(afterPlace, { type: 'remove', index: 11 })
    expect(firstRemove.pendingRemove).toBe(1)
    expect(firstRemove.turn).toBe(BLACK)
    // 第二次吃子后换手给白方（白方由规则层立刻应手，所以最终又轮到黑方或直接终局）
    const secondRemove = act(firstRemove, { type: 'remove', index: 12 })
    expect(secondRemove.pendingRemove).toBe(0)
    expect(secondRemove.removed.white).toBe(2)
    if (gameStatus(secondRemove) === 'playing') expect(secondRemove.turn).toBe(BLACK)
  })
})

describe('胜负', () => {
  it('把对方吃到只剩 2 子 → 胜', () => {
    // 白方总共只有 3 子（手上 0、被吃 6）且全在三连里 → 可以吃；黑方在 9 落子成三
    const state = fixture([8, 10, 1, 17], [0, 1, 2], {
      inHand: { black: 5, white: 0 },
      removed: { black: 0, white: 6 },
      pendingRemove: 0,
    })
    const mill = act(state, { type: 'place', index: 9 })
    expect(mill.pendingRemove).toBeGreaterThan(0)
    const win = act(mill, { type: 'remove', index: 0 })
    expect(boardCount(win, WHITE)).toBe(2)
    expect(stonesLeft(win, WHITE)).toBe(2)
    expect(gameStatus(win)).toBe('won')
    expect(() => act(win, { type: 'place', index: 21 })).toThrow(IllegalActionError)
  })

  it('对方无子可动 → 胜（4 子全被堵死，且不到飞子期）', () => {
    const blocked = fixture([0, 5, 9, 10, 11], [1, 2, 3, 4], {
      inHand: { black: 0, white: 0 },
      removed: { black: 4, white: 5 },
      turn: WHITE,
    })
    expect(stonesLeft(blocked, WHITE)).toBe(4)
    expect(phaseOf(blocked)).toBe('moving')
    expect(rawActions(blocked)).toHaveLength(0)
    expect(stuckPlayer(blocked)).toBe(WHITE)
    expect(gameStatus(blocked)).toBe('won')
  })

  it('自己无子可动 → 负', () => {
    // 黑方 4 子全被白方堵死（0/5/9/10/11 换成白子）
    const mine = fixture([1, 2, 3, 4], [0, 5, 9, 10, 11], {
      inHand: { black: 0, white: 0 },
      removed: { black: 5, white: 4 },
      turn: BLACK,
    })
    expect(gameStatus(mine)).toBe('lost')
    expect(() => act(mine, { type: 'select', index: 0 })).toThrow(IllegalActionError)
  })

  it('完整对局能走到终局，且过程中不变量恒成立', () => {
    for (const difficulty of ['starter', 'skilled'] as const) {
      const { state, problems, plies } = playToEnd(2024, difficulty)
      expect(problems, `${difficulty}: ${problems.join('; ')}`).toEqual([])
      expect(plies).toBeGreaterThan(0)
      expect(gameStatus(state)).not.toBe('playing')
      const loser = stonesLeft(state, BLACK) <= 2 ? BLACK : WHITE
      expect(stonesLeft(state, loser)).toBeLessThanOrEqual(2)
      // 终局存档必须能往返
      expect(ninemensGame.decode(encodeState(state))).toEqual(state)
      expect(invariantProblems(state)).toEqual([])
    }
  })
})

describe('撤销与重开', () => {
  it('撤销一整回合：落子 + 成三吃子 + 白方应手一起退回', () => {
    let state = fresh(31, 'skilled')
    const starts: string[] = [JSON.stringify(encodeState(state))]
    let guard = 0
    for (let turn = 0; turn < 4; turn++) {
      // 本回合：先做完黑方的动作（含成三后的吃子），白方应手由 reduce 内部完成
      while (guard++ < 100) {
        const actions = rawActions(state)
        const action = actions[0]!
        state = act(state, action)
        if (state.turn === BLACK || gameStatus(state) !== 'playing') break
      }
      starts.push(JSON.stringify(encodeState(state)))
      if (gameStatus(state) !== 'playing') break
    }
    expect(starts.length).toBeGreaterThan(2)
    // 逐回合撤销
    for (let turn = starts.length - 1; turn > 0; turn--) {
      expect(JSON.stringify(encodeState(state)), `turn ${turn}`).toBe(starts[turn])
      state = act(state, { type: 'undo' })
    }
    expect(JSON.stringify(encodeState(state))).toBe(starts[0])
    expect(state.log).toHaveLength(0)
    expect(state.moves).toBe(0)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => act(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到空盘', () => {
    const start = fresh(7, 'starter')
    let state = act(start, { type: 'place', index: 8 })
    // 白方应手可能占掉 0，所以取「当前第一个空点位」
    state = act(state, { type: 'place', index: emptyPoints(state)[0]! })
    expect(encodeState(act(state, { type: 'restart' }))).toEqual(encodeState(start))
    expect(createState(7, 'starter')).toEqual(start)
  })

  it('未知动作（方向键 / 旧动作名）明确报错', () => {
    const state = fresh()
    expect(() =>
      act(state, { type: 'move', dir: 'up' } as unknown as NinemensAction),
    ).toThrow(IllegalActionError)
  })
})

describe('selectAction', () => {
  it('落子期：空点位 → place；已占用 / 越界 / 非整数 → null', () => {
    const state = fresh(3, 'starter')
    expect(selectAction(state, 8)).toEqual({ type: 'place', index: 8 })
    expect(selectAction(state, -1)).toBeNull()
    expect(selectAction(state, POINT_COUNT)).toBeNull()
    expect(selectAction(state, 1.5)).toBeNull()
    const placed = act(state, { type: 'place', index: 8 })
    expect(selectAction(placed, 8)).toBeNull()
  })

  it('移动期：点自己的子 = select（再点一次取消）；点合法相邻空点 = move；其余 null', () => {
    const state = fixture([0, 8, 9, 16], [1, 2, 3, 4], { inHand: { black: 0, white: 0 } })
    expect(selectAction(state, 0)).toEqual({ type: 'select', index: 0 })
    const selected = act(state, { type: 'select', index: 0 })
    expect(selected.selected).toBe(0)
    // 相邻空点 7 → move
    expect(selectAction(selected, 7)).toEqual({ type: 'move', from: 0, to: 7 })
    // 不相邻的空点 20 → null
    expect(selectAction(selected, 20)).toBeNull()
    // 对方的子 → null（不能直接吃）
    expect(selectAction(selected, 1)).toBeNull()
    // 点自己的另一颗子 → 改选
    expect(selectAction(selected, 8)).toEqual({ type: 'select', index: 8 })
    expect(selectAction(selected, 16)).toEqual({ type: 'select', index: 16 })
    // 再点同一颗 → 取消选中
    expect(act(selected, { type: 'select', index: 0 }).selected).toBeNull()
    // 返回的 move 一定能被 reduce 接受
    const move = selectAction(selected, 7)!
    expect(act(selected, move).points[7]).toBe(BLACK)
  })

  it('飞子期：选中后可以点到任意空点', () => {
    const state = fixture([0, 8, 16], [1, 2, 3], {
      inHand: { black: 0, white: 0 },
      removed: { black: 6, white: 6 },
    })
    const selected = act(state, { type: 'select', index: 0 })
    expect(selectAction(selected, 23)).toEqual({ type: 'move', from: 0, to: 23 })
  })

  it('待吃子：点可吃的对方子 → remove；点受保护的子 / 自己的子 → null', () => {
    const state = fixture([8, 9, 10, 11], [0, 1, 2, 12], {
      inHand: { black: 5, white: 5 },
      pendingRemove: 1,
    })
    expect(selectAction(state, 12)).toEqual({ type: 'remove', index: 12 })
    expect(selectAction(state, 0)).toBeNull()
    expect(selectAction(state, 8)).toBeNull()
    expect(selectAction(state, 20)).toBeNull()
  })

  it('终局后所有点击都是 null', () => {
    const won = fixture([8, 10, 1, 17], [0, 1, 2], {
      inHand: { black: 5, white: 0 },
      removed: { black: 0, white: 6 },
      pendingRemove: 1,
    })
    const over = act(won, { type: 'remove', index: 0 })
    expect(stonesLeft(over, WHITE)).toBe(2)
    expect(gameStatus(over)).toBe('won')
    for (let point = 0; point < POINT_COUNT; point++) {
      expect(selectAction(over, point)).toBeNull()
    }
  })

  it('legal 列出全部合法动作 + undo/restart；终局只剩 undo/restart', () => {
    const state = fresh(9, 'starter')
    const actions = legalActions(state)
    expect(actions.filter((action) => action.type === 'place')).toHaveLength(POINT_COUNT)
    expect(actions).toContainEqual({ type: 'restart' })
    expect(actions.some((action) => action.type === 'undo')).toBe(false)
    const played = act(state, { type: 'place', index: 0 })
    expect(legalActions(played)).toContainEqual({ type: 'undo' })
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返（含 JSON 往返）', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const state = fresh(2024, difficulty)
      expect(ninemensGame.decode(encodeState(state))).toEqual(state)
      expect(ninemensGame.decode(JSON.parse(JSON.stringify(encodeState(state))))).toEqual(state)
    }
    const mid = finishPlacement(17, (current) => emptyPoints(current)[0]!)
    expect(ninemensGame.decode(encodeState(mid))).toEqual(mid)
    const { state: finished } = playToEnd(5, 'starter')
    expect(ninemensGame.decode(encodeState(finished))).toEqual(finished)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh(23, 'starter')
    played = act(played, { type: 'place', index: 8 })
    played = act(played, { type: 'place', index: 0 })
    const raw = ninemensGame.encode(played) as {
      difficulty: string
      seed: number
      points: Array<string | null>
      inHand: { black: number; white: number }
      removed: { black: number; white: number }
      turn: string
      phase: string
      pendingRemove: number
      selected: number | null
      moves: number
      rngCursor: number
      log: Array<Record<string, unknown>>
    }
    const first = raw.log[0] as { index: number }
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
      // 凭空多一个子（点位被填上但没有对应日志）
      { ...raw, points: raw.points.map((owner, index) => (index === 20 ? 'black' : owner)) },
      // 抹掉一个子
      { ...raw, points: raw.points.map((owner, index) => (index === first.index ? null : owner)) },
      // 阶段 / 手数 / 待吃子 / 轮次 / 游标不对
      { ...raw, phase: 'moving' },
      { ...raw, phase: 'nonsense' },
      { ...raw, pendingRemove: 1 },
      { ...raw, turn: 'white' },
      { ...raw, turn: 'green' },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, rngCursor: raw.rngCursor + 1 },
      // 不变量被破坏：手上子数对不上
      { ...raw, inHand: { black: raw.inHand.black + 1, white: raw.inHand.white } },
      { ...raw, removed: { black: 3, white: raw.removed.white } },
      // 日志非法：重复落同一格 / 跨线移动 / 落子期之外落子
      { ...raw, log: [first, first] },
      { ...raw, log: [{ type: 'place', index: 8 }, { type: 'place', index: 8 }] },
      { ...raw, log: [{ type: 'place', index: 8 }, { type: 'move', from: 8, to: 22 }] },
      { ...raw, log: [{ type: 'move', from: 8, to: 9 }] },
      { ...raw, log: [{ type: 'remove', index: 8 }] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(
        () => ninemensGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 从 (seed, difficulty, log) 复算，不信任 materialized 字段', () => {
    const played = act(fresh(41, 'skilled'), { type: 'place', index: 8 })
    const decoded = ninemensGame.decode(encodeState(played))
    expect(decoded.log).toEqual(played.log)
    expect(decoded.points).toEqual(played.points)
    expect(decoded.turn).toBe(played.turn)
    expect(decoded.phase).toBe(played.phase)
    expect(decoded.moves).toBe(played.moves)
    expect(decoded.inHand).toEqual(played.inHand)
  })

  it('movesOf 只数玩家动作（select 不计）', () => {
    let state = fresh(1, 'starter')
    expect(ninemensGame.movesOf!(state)).toBe(0)
    state = act(state, { type: 'place', index: 8 })
    expect(ninemensGame.movesOf!(state)).toBe(1)
    const moving = fixture([0, 8, 9, 16], [1, 2, 3, 4], { inHand: { black: 0, white: 0 } })
    const selected = act(moving, { type: 'select', index: 0 })
    expect(ninemensGame.movesOf!(selected)).toBe(moving.moves)
    const moved = act(selected, { type: 'move', from: 0, to: 7 })
    expect(ninemensGame.movesOf!(moved)).toBe(moving.moves + 1)
    expect(otherPlayer(WHITE)).toBe(BLACK)
    expect(STONES_PER_SIDE).toBe(9)
  })
})
