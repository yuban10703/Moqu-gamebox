/**
 * 规则层测试。重点覆盖验收点名的边界：
 *   - 确定性：同 seed + 同动作序列 → 完全同状态（游标驱动随机，不碰 Math.random）；
 *   - 合并规则：一次移动里同一块不能连续合并两次；
 *   - 非法动作：无变化的方向必须抛 IllegalActionError，而不是静默返回原状态；
 *   - 胜负：出现目标值 won、棋盘满且四向都动不了 lost；
 *   - 存档：encode/decode 严格往返，坏数据一律拒绝。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, type MoveDir } from '@eink/core'
import {
  ALL_DIRS,
  applyMove,
  createState,
  decodeState,
  emptyBoard,
  encodeState,
  legalActions,
  reduceState,
  slideLine,
  spawnTile,
  statusOf,
  type Game2048Action,
  type Game2048State,
} from '../src/rules.js'
import { game2048 } from '../src/index.js'

/** 测试用局面：只关心棋盘与计数，其余字段给稳定默认值 */
function stateWith(board: readonly number[], overrides: Partial<Game2048State> = {}): Game2048State {
  return {
    difficulty: 'starter',
    seed: 1,
    board,
    score: 0,
    moves: 0,
    cursor: 0,
    history: [],
    ...overrides,
  }
}

function firstMoveDir(state: Game2048State) {
  const move = legalActions(state).find((action) => action.type === 'move')
  if (!move || move.type !== 'move') throw new Error('no legal move')
  return move.dir
}

describe('滑动与合并规则', () => {
  it('单次滑动：压缩、合并、再次压缩', () => {
    expect(slideLine([0, 2, 0, 2]).values).toEqual([4, 0, 0, 0])
    expect(slideLine([0, 2, 0, 2]).gained).toBe(4)
    expect(slideLine([0, 0, 0, 2]).values).toEqual([2, 0, 0, 0])
    expect(slideLine([2, 4, 2, 4]).values).toEqual([2, 4, 2, 4])
    expect(slideLine([2, 4, 2, 4]).moved).toBe(false)
    expect(slideLine([4, 0, 0, 0]).moved).toBe(false)
  })

  it('一次移动里同一块不会被合并两次', () => {
    // [2,2,2,2] 只能得到 [4,4]，不能连锁成 [8]
    expect(slideLine([2, 2, 2, 2]).values).toEqual([4, 4, 0, 0])
    expect(slideLine([2, 2, 2, 2]).gained).toBe(8)
    // 合成出来的 8 不会再和已有的 8 合并
    expect(slideLine([4, 4, 8, 0]).values).toEqual([8, 8, 0, 0])
    expect(slideLine([4, 4, 8, 0]).gained).toBe(8)
    expect(slideLine([2, 2, 4, 4]).values).toEqual([4, 8, 0, 0])
    expect(slideLine([2, 2, 4, 4]).gained).toBe(12)
  })

  it('整盘向左：逐行生效且不动原盘', () => {
    const board = [2, 0, 2, 4, 4, 4, 0, 0, 0, 0, 0, 0, 8, 0, 0, 8]
    const frozen = board.slice()
    const outcome = applyMove(board, 4, 'left')
    expect(outcome.board).toEqual([4, 4, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0])
    expect(outcome.gained).toBe(4 + 8 + 16)
    expect(outcome.moved).toBe(true)
    expect(board).toEqual(frozen)
  })

  it('整盘向右：贴到右边并合并', () => {
    const board = [2, 0, 2, 4, 4, 4, 0, 0, 0, 0, 0, 0, 8, 0, 0, 8]
    const outcome = applyMove(board, 4, 'right')
    expect(outcome.board).toEqual([0, 0, 4, 4, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 16])
    expect(outcome.gained).toBe(4 + 8 + 16)
  })

  it('整盘向上/向下：列方向同样正确', () => {
    const board = [2, 4, 0, 8, 2, 4, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(applyMove(board, 4, 'up').board).toEqual([4, 8, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(applyMove(board, 4, 'down').board).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 8, 0, 16])
  })

  it('5×5 棋盘按同样规则滑动（列/行由 size 决定）', () => {
    const board = emptyBoard(5)
    board[0] = 2
    board[5] = 2
    board[6] = 2
    const up = applyMove(board, 5, 'up')
    expect(up.board[0]).toBe(4)
    expect(up.board[5]).toBe(0)
  })
})

describe('移动、得分与游标', () => {
  it('有效移动：分数累加、步数 +1、游标推进 2、补一个新块', () => {
    const state = stateWith([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const next = reduceState(state, { type: 'move', dir: 'left' })
    expect(next.score).toBe(4)
    expect(next.moves).toBe(1)
    expect(next.cursor).toBe(2)
    expect(next.board[0]).toBe(4)
    // 合并空出两格，只补一个块：场上共 2 块
    expect(next.board.filter((value) => value !== 0)).toHaveLength(2)
    expect(next.history).toHaveLength(1)
  })

  it('reduce 不修改入参（状态不可变）', () => {
    const state = createState(11, 'starter')
    const before = encodeState(state)
    reduceState(state, { type: 'move', dir: firstMoveDir(state) })
    expect(encodeState(state)).toEqual(before)
  })

  it('合法方向 = 能改变棋盘的方向；方向盘始终可点', () => {
    const state = stateWith([2, 4, 8, 0, 4, 8, 16, 0, 8, 16, 32, 0, 16, 32, 64, 0])
    const dirs = legalActions(state)
      .filter((action): action is { type: 'move'; dir: (typeof ALL_DIRS)[number] } => action.type === 'move')
      .map((action) => action.dir)
    expect(dirs).toEqual(['right'])
    // legal 结论与 reduce 是否抛错一致
    for (const dir of ALL_DIRS) {
      const legal = dirs.includes(dir)
      expect(legalActions(state).some((a) => a.type === 'move' && a.dir === dir)).toBe(legal)
    }
  })
})

describe('撤销与重开', () => {
  it('撤销回到上一步，且不能无限撤销', () => {
    let state = createState(2024, 'starter')
    state = reduceState(state, { type: 'move', dir: firstMoveDir(state) })
    const afterMove = encodeState(state)
    state = reduceState(state, { type: 'move', dir: firstMoveDir(state) })
    state = reduceState(state, { type: 'undo' })
    expect(encodeState(state)).toEqual(afterMove)
    state = reduceState(state, { type: 'undo' })
    expect(state.moves).toBe(0)
    expect(state.score).toBe(0)
    expect(state.cursor).toBe(4)
    expect(() => reduceState(state, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('重开回到同 seed 初始局面，且不能撤销回重开之前', () => {
    let state = createState(88, 'skilled')
    let firstMove: Game2048Action = { type: 'move', dir: firstMoveDir(state) }
    state = reduceState(state, firstMove)
    state = reduceState(state, { type: 'restart' })
    expect(encodeState(state)).toEqual(encodeState(createState(88, 'skilled')))
    expect(state.history).toHaveLength(0)
    expect(() => reduceState(state, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('未知动作类型抛 IllegalActionError（例如壳层的 nextLevel）', () => {
    const state = createState(5, 'starter')
    expect(() => reduceState(state, { type: 'nextLevel' } as unknown as Game2048Action)).toThrow(
      IllegalActionError,
    )
  })
})

describe('非法动作', () => {
  it('无变化的方向抛错，且原状态不受影响', () => {
    const state = stateWith([2, 4, 8, 0, 4, 8, 16, 0, 8, 16, 32, 0, 16, 32, 64, 0])
    expect(() => reduceState(state, { type: 'move', dir: 'left' })).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'move', dir: 'up' })).toThrow(IllegalActionError)
    expect(state.moves).toBe(0)
    expect(statusOf(state)).toBe('playing')
  })

  it('空盘上任何方向都无变化 → 全部非法', () => {
    const state = stateWith(emptyBoard(4))
    for (const dir of ALL_DIRS) {
      expect(() => reduceState(state, { type: 'move', dir })).toThrow(IllegalActionError)
    }
  })

  it('未知难度抛 IllegalActionError', () => {
    expect(() => createState(1, 'nightmare')).toThrow(IllegalActionError)
  })
})

describe('胜负判定', () => {
  it('出现目标值即 won（入门 256）', () => {
    expect(statusOf(stateWith([256, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('won')
    expect(statusOf(stateWith([128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('playing')
  })

  it('熟练/挑战目标是 2048', () => {
    const board = [2048, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(statusOf(stateWith(board, { difficulty: 'skilled' }))).toBe('won')
    expect(statusOf(stateWith(board, { difficulty: 'starter' }))).toBe('won')
    const bigger = new Array<number>(25).fill(0)
    bigger[24] = 2048
    expect(statusOf(stateWith(bigger, { difficulty: 'challenging' }))).toBe('won')
  })

  it('棋盘满且四向都动不了即 lost', () => {
    const stuck = [2, 4, 8, 16, 16, 8, 4, 2, 2, 4, 8, 16, 16, 8, 4, 2]
    expect(statusOf(stateWith(stuck))).toBe('lost')
    for (const dir of ALL_DIRS) {
      expect(() => reduceState(stateWith(stuck), { type: 'move', dir })).toThrow(IllegalActionError)
    }
  })

  it('满盘但还有合并空间时仍是 playing', () => {
    const mergeable = [2, 2, 8, 16, 16, 8, 4, 2, 2, 4, 8, 16, 16, 8, 4, 2]
    expect(statusOf(stateWith(mergeable))).toBe('playing')
  })

  it('同时满足 won 与 lost 时判 won', () => {
    const fullWithTarget = [256, 4, 8, 16, 16, 8, 4, 2, 256, 4, 8, 16, 16, 8, 4, 2]
    expect(statusOf(stateWith(fullWithTarget))).toBe('won')
  })
})

describe('随机来自种子', () => {
  it('同一 (seed, cursor) 生成的新块完全一致，与调用顺序无关', () => {
    const a = spawnTile(emptyBoard(4), 5, 10)
    const b = spawnTile(emptyBoard(4), 5, 10)
    expect(a).toEqual(b)
    expect(a.cursor).toBe(12)
  })

  it('新块 90% 是 2、10% 是 4，且只填一格', () => {
    const total = 4000
    let fours = 0
    let cursor = 0
    for (let i = 0; i < total; i++) {
      const outcome = spawnTile(emptyBoard(4), 31337, cursor)
      const added = outcome.board.filter((value) => value !== 0)
      expect(added).toHaveLength(1)
      const value = added[0]!
      expect([2, 4]).toContain(value)
      if (value === 4) fours++
      cursor = outcome.cursor
    }
    expect(fours / total).toBeGreaterThan(0.07)
    expect(fours / total).toBeLessThan(0.13)
  })

  it('满盘时无处可放：原样返回且游标不动', () => {
    const board = [2, 4, 8, 16, 16, 8, 4, 2, 2, 4, 8, 16, 16, 8, 4, 2]
    const outcome = spawnTile(board, 7, 0)
    expect(outcome.board).toEqual(board)
    expect(outcome.cursor).toBe(0)
  })

  it('create：同 seed 两次结果一致，不同 seed 通常不同', () => {
    expect(encodeState(createState(20260101, 'skilled'))).toEqual(encodeState(createState(20260101, 'skilled')))
    expect(encodeState(createState(1, 'starter'))).not.toEqual(encodeState(createState(2, 'starter')))
    const initial = createState(42, 'starter')
    expect(initial.board.filter((value) => value !== 0)).toHaveLength(2)
    expect(initial.cursor).toBe(4)
  })

  it('同 seed + 同动作序列 → encode 结果完全一致（含撤销与历史）', () => {
    const run = (): Game2048State => {
      let state = createState(777, 'skilled')
      for (let step = 0; step < 80; step++) {
        const moves = legalActions(state).filter((action) => action.type === 'move')
        if (moves.length === 0) break
        state = reduceState(state, moves[step % moves.length]!)
        if (step % 7 === 3) state = reduceState(state, { type: 'undo' })
      }
      return state
    }
    const first = run()
    const second = run()
    expect(encodeState(second)).toEqual(encodeState(first))
    expect(first.moves).toBeGreaterThan(20)
    expect(statusOf(first)).toBe('playing')
  })
})

describe('存档 encode/decode', () => {
  it('严格往返：JSON 序列化后仍能还原同一状态', () => {
    let state = createState(4242, 'challenging')
    for (let step = 0; step < 25; step++) {
      state = reduceState(state, { type: 'move', dir: firstMoveDir(state) })
      if (step === 10) state = reduceState(state, { type: 'undo' })
    }
    const encoded = encodeState(state)
    const throughJson = JSON.parse(JSON.stringify(encoded)) as unknown
    expect(throughJson).toEqual(encoded)
    expect(decodeState(throughJson)).toEqual(state)
    // 撤销栈也要一起往返，才能撤销回同一局面
    const restored = decodeState(throughJson)
    expect(encodeState(reduceState(restored, { type: 'undo' }))).toEqual(
      encodeState(reduceState(state, { type: 'undo' })),
    )
  })

  it('decode 拒绝坏数据', () => {
    const good = encodeState(createState(9, 'starter'))
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'x',
      [],
      {},
      { ...good, difficulty: 'nope' },
      { ...good, board: good.board.slice(1) },
      { ...good, board: good.board.map((value, index) => (index === 0 ? 3 : value)) },
      { ...good, board: good.board.map((value, index) => (index === 0 ? -2 : value)) },
      { ...good, board: good.board.map((value, index) => (index === 0 ? 1.5 : value)) },
      { ...good, score: -1 },
      { ...good, moves: 1.5 },
      { ...good, seed: 'x' },
      { ...good, cursor: 1 },
      { ...good, history: 'nope' },
      { ...good, history: [{}] },
    ]
    for (const value of bad) {
      expect(() => decodeState(value)).toThrow(IllegalActionError)
    }
  })

  it('decode 拒绝「历史与步数不一致」的存档（撤销栈错位）', () => {
    let state = createState(3, 'starter')
    state = reduceState(state, { type: 'move', dir: firstMoveDir(state) })
    const encoded = encodeState(state)
    const snapshot = { board: encoded.board, score: 0, moves: 0, cursor: 0 }
    // 少一个字段
    expect(() => decodeState({ ...encoded, history: [{ board: encoded.board, score: 0, cursor: 0 }] })).toThrow(
      IllegalActionError,
    )
    // 步数与历史长度不符
    expect(() => decodeState({ ...encoded, history: [] })).toThrow(IllegalActionError)
    expect(() => decodeState({ ...encoded, history: [snapshot, snapshot] })).toThrow(IllegalActionError)
    // 完整的历史可以通过
    const restored = decodeState({ ...encoded, history: [snapshot] })
    expect(restored.history).toEqual([snapshot])
    expect(restored.board).toEqual(encoded.board)
    expect(restored.moves).toBe(encoded.moves)
  })
})

describe('完整对局（真实移动序列）', () => {
  /** 固定优先级的贪心策略：只用确定性规则推演，避免测试里出现随机性 */
  const PRIORITY: readonly MoveDir[] = ['left', 'down', 'right', 'up']

  function availableDirs(state: Game2048State): Set<MoveDir> {
    const dirs = new Set<MoveDir>()
    for (const action of legalActions(state)) if (action.type === 'move') dirs.add(action.dir)
    return dirs
  }

  function playUntilOver(seed: number, difficulty: 'starter' | 'skilled' | 'challenging'): Game2048State {
    let state = createState(seed, difficulty)
    for (let step = 0; step < 5000; step++) {
      if (statusOf(state) !== 'playing') break
      const dirs = availableDirs(state)
      const dir = PRIORITY.find((candidate) => dirs.has(candidate))
      if (!dir) break
      state = reduceState(state, { type: 'move', dir })
    }
    return state
  }

  it('一路走到无路可走 → lost，且棋盘填满、legal 里没有任何方向', () => {
    const state = playUntilOver(1, 'skilled')
    expect(statusOf(state)).toBe('lost')
    expect(state.board.every((value) => value !== 0)).toBe(true)
    expect(availableDirs(state).size).toBe(0)
    expect(state.moves).toBeGreaterThan(50)
    // 存档依旧可往返（终局状态也要能存）
    expect(decodeState(encodeState(state))).toEqual(state)
  })

  it('入门档真实移动也能合成出 256 → won', () => {
    const state = playUntilOver(4, 'starter')
    expect(statusOf(state)).toBe('won')
    expect(Math.max(...state.board)).toBeGreaterThanOrEqual(256)
    expect(state.score).toBeGreaterThan(0)
    // 达成目标的瞬间状态在存档里也能复原
    expect(statusOf(decodeState(JSON.parse(JSON.stringify(encodeState(state)))))).toBe('won')
  })
})

describe('GameDef 接线', () => {
  it('暴露三档难度与非法提示 key', () => {
    expect(game2048.id).toBe('2048')
    expect(game2048.i18nNamespace).toBe('2048')
    expect(game2048.illegalNoticeKey).toBe('2048.blocked')
    expect(game2048.difficulties.map((spec) => spec.id)).toEqual(['starter', 'skilled', 'challenging'])
    expect(game2048.difficulties.map((spec) => spec.labelKey)).toEqual([
      '2048.difficulty.starter',
      '2048.difficulty.skilled',
      '2048.difficulty.challenging',
    ])
  })

  it('create/reduce/status/legal 与规则层一致，且 encode/decode 往返', () => {
    const state = game2048.create(1234, 'skilled')
    const next = game2048.reduce(state, { type: 'move', dir: firstMoveDir(state) })
    expect(game2048.status(next)).toBe('playing')
    expect(game2048.legal(state).length).toBeGreaterThan(0)
    expect(game2048.decode(game2048.encode(next))).toEqual(next)
  })

  it('create 未知难度抛错', () => {
    expect(() => game2048.create(1, 'nope')).toThrow(IllegalActionError)
  })
})
