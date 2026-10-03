/**
 * 规则层测试：结算、拒绝非法交换、稳定性、撤销、确定性、选中态与终局语义。
 *
 * 墨水瓶约束下的三条硬要求在这里钉死：
 * 1. 一次交换 = 一次完整结算（消除 / 下落 / 补充全在一次 reduce 里完成），结算后盘面必须稳定；
 * 2. 换不出三连的交换必须**被拒绝且局面不变**（不扣步数、棋子不动）；
 * 3. 撤销必须回到「交换之前」的完整局面 —— 分数、步数、随机游标、棋盘、最近重排步号全都回退。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  DIFFICULTY_IDS,
  EMPTY,
  areAdjacent,
  cellCount,
  configFor,
  createState,
  decodeState,
  encodeState,
  findGroups,
  findLegalSwaps,
  gameStatus,
  hasLegalSwap,
  indexOf,
  legalActions,
  match3Game,
  pieceCount,
  reduceMatch3,
  remainingMoves,
  selectAction,
  swapCells,
  type DifficultyId,
  type Match3State,
} from '../src/index.js'
import { act, fresh, selectAt } from './helpers.js'

/** 基准盘面：`(row + 2 * col) % 4`，相邻两格必然不同，因此本身没有任何三连 */
function baseBoard(difficulty: DifficultyId): number[] {
  const config = configFor(difficulty)
  const board: number[] = []
  for (let index = 0; index < cellCount(config); index++) {
    board.push((Math.floor(index / config.cols) + 2 * (index % config.cols)) % 4)
  }
  return board
}

function craftedState(board: number[], patch: Partial<Match3State> = {}): Match3State {
  return {
    difficulty: 'starter',
    seed: 1,
    board,
    score: 0,
    moves: 0,
    cursor: 0,
    selected: null,
    lastShuffle: -1,
    history: [],
    ...patch,
  }
}

/**
 * 手工盘面：交换 (0,2) 与 (1,2) 后只在顶行凑出 3 连，
 * 且被消掉的格子在列顶（下面没有棋子要落下来），因此恰好一轮消除、得分必然 30。
 */
function singleClearState(patch: Partial<Match3State> = {}): Match3State {
  const config = configFor('starter')
  const board = baseBoard('starter')
  board[0] = 4
  board[1] = 4
  board[indexOf(1, 2, config)] = 4
  return craftedState(board, patch)
}

/**
 * 手工盘面：连锁两轮的盘面。
 * 交换 (5,2) 与 (6,2) 后第 5 行 cols 0..2 凑成三连 → 消掉 → 第 0 列的棋子落下一格，
 * 让 (5,0)(6,0)(7,0) 变成本来就在 (4,0)(6,0)(7,0) 的同种棋子 → 第二轮再消一次。
 */
function cascadeState(patch: Partial<Match3State> = {}): Match3State {
  const config = configFor('starter')
  const board = baseBoard('starter')
  board[indexOf(5, 0, config)] = 4
  board[indexOf(5, 1, config)] = 4
  board[indexOf(6, 2, config)] = 4
  board[indexOf(4, 0, config)] = 2
  board[indexOf(6, 0, config)] = 2
  board[indexOf(7, 0, config)] = 2
  return craftedState(board, patch)
}

/** 随机合法交换走若干步，返回每一步之后的状态（含起点） */
function randomTrail(state: Match3State, steps: number, seed: number): Match3State[] {
  const rng = createRng(seed)
  const trail: Match3State[] = [state]
  let current = state
  for (let step = 0; step < steps; step++) {
    if (gameStatus(current) !== 'playing') break
    const pairs = findLegalSwaps(current.board, configFor(current.difficulty))
    if (pairs.length === 0) break
    const pair = pairs[rng.int(pairs.length)]!
    current = act(current, { type: 'swap', a: pair[0], b: pair[1] })
    trail.push(current)
  }
  return trail
}

describe('初始局面', () => {
  it('三档难度 × 多个种子：开局无三连、必有可交换的组合、满盘、步数为 0', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      for (let seed = 0; seed < 16; seed++) {
        const state = createState(seed, difficulty)
        expect(findGroups(state.board, config)).toEqual([])
        expect(hasLegalSwap(state.board, config)).toBe(true)
        expect(pieceCount(state)).toBe(cellCount(config))
        expect(state.board.some((kind) => kind === EMPTY)).toBe(false)
        expect(state.moves).toBe(0)
        expect(state.score).toBe(0)
        expect(state.selected).toBeNull()
        expect(state.history).toEqual([])
        expect(gameStatus(state)).toBe('playing')
        expect(remainingMoves(state)).toBe(config.moveLimit)
      }
    }
  })
})

describe('有效交换：消除与计分', () => {
  it('单轮消除：得分恰好 30，游标恰好推进 3 次（每补一枚棋子一次抽取）', () => {
    const config = configFor('starter')
    const state = singleClearState()
    const next = act(state, { type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })
    expect(next.score).toBe(30)
    expect(next.moves).toBe(1)
    expect(next.cursor).toBe(state.cursor + 3)
    expect(findGroups(next.board, config)).toEqual([])
    expect(pieceCount(next)).toBe(cellCount(config))
    expect(next.history).toHaveLength(1)
    // 快照只记真正改动过的格子，并集必须覆盖被消掉的三格
    const changed = new Set(next.history[0]!.at)
    expect(changed.has(indexOf(0, 0, config))).toBe(true)
    expect(changed.has(indexOf(0, 1, config))).toBe(true)
    expect(changed.has(indexOf(0, 2, config))).toBe(true)
    expect(next.history[0]!.at).toHaveLength(next.history[0]!.old.length)
    // 交换前分数与游标都进了快照
    expect(next.history[0]!.score).toBe(0)
    expect(next.history[0]!.cursor).toBe(state.cursor)
  })

  it('连锁两轮：第二轮按 ×2 计分（30×1 + 30×2 = 90），游标推进 6 次', () => {
    const config = configFor('starter')
    const state = cascadeState()
    const next = act(state, { type: 'swap', a: indexOf(5, 2, config), b: indexOf(6, 2, config) })
    expect(next.score).toBe(90)
    expect(next.cursor).toBe(state.cursor + 6)
    expect(findGroups(next.board, config)).toEqual([])
    expect(pieceCount(next)).toBe(cellCount(config))
  })

  it('真实局面里每一步都：盘面稳定、满盘、分数为 10 的倍数且不低于首轮收益', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      const trail = randomTrail(fresh(31, difficulty), 12, 909)
      expect(trail.length).toBeGreaterThan(5)
      for (let step = 1; step < trail.length; step++) {
        const before = trail[step - 1]!
        const after = trail[step]!
        expect(findGroups(after.board, config)).toEqual([])
        expect(pieceCount(after)).toBe(cellCount(config))
        const gained = after.score - before.score
        expect(gained % 10).toBe(0)
        expect(gained).toBeGreaterThanOrEqual(30)
        expect(after.moves).toBe(before.moves + 1)
        // 至少消掉 3 枚棋子 → 至少 3 次抽取
        expect(after.cursor).toBeGreaterThanOrEqual(before.cursor + 3)
      }
    }
  })
})

describe('无匹配的交换被拒绝', () => {
  it('换不出三连：抛 IllegalActionError，且局面（含选中态）完全不变', () => {
    const config = configFor('starter')
    // 手工盘面上 (0,0) 与 (0,1) 同为第 5 种，互换后不会有任何三连
    const state = craftedState(baseBoard('starter'), { selected: 0 })
    const before = JSON.stringify(encodeState(state))
    expect(() => act(state, { type: 'swap', a: 0, b: 1 })).toThrow(IllegalActionError)
    expect(JSON.stringify(encodeState(state))).toBe(before)
    expect(findLegalSwaps(state.board, config).some(([a, b]) => a === 0 && b === 1)).toBe(false)
  })

  it('非相邻 / 越界 / 相同的两格都不是合法交换', () => {
    const state = fresh(5, 'starter')
    const before = JSON.stringify(encodeState(state))
    // (0,0) 与 (1,1) 斜角不相邻
    expect(() => act(state, { type: 'swap', a: 0, b: configFor('starter').cols + 1 })).toThrow(
      IllegalActionError,
    )
    expect(() => act(state, { type: 'swap', a: 3, b: 3 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'swap', a: -1, b: 0 })).toThrow(IllegalActionError)
    expect(() => act(state, { type: 'swap', a: 0, b: 9999 })).toThrow(IllegalActionError)
    expect(JSON.stringify(encodeState(state))).toBe(before)
  })

  it('被拒绝的交换不消耗步数：重试同一对仍然按第一次的结果结算', () => {
    const config = configFor('starter')
    const state = singleClearState()
    const rejected = (): Match3State => act(state, { type: 'swap', a: 0, b: 1 })
    expect(rejected).toThrow(IllegalActionError)
    expect(state.moves).toBe(0)
    const accepted = act(state, { type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })
    expect(accepted.moves).toBe(1)
  })
})

describe('结算后的盘面稳定性（连锁 / 下落 / 补充）', () => {
  it('随机合法交换走 120 步：始终稳定、始终有解、计数自洽', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const config = configFor(difficulty)
      const trail = randomTrail(fresh(20261004, difficulty), 120, 77)
      for (const state of trail) {
        expect(findGroups(state.board, config)).toEqual([])
        expect(hasLegalSwap(state.board, config)).toBe(true)
        expect(pieceCount(state)).toBe(cellCount(config))
        expect(state.history).toHaveLength(state.moves)
        expect(state.moves).toBeLessThanOrEqual(config.moveLimit)
        if (state.moves > 0) {
          const last = state.history[state.history.length - 1]!
          expect(last.cursor).toBeLessThan(state.cursor)
          expect(last.score).toBeLessThanOrEqual(state.score)
        }
      }
    }
  })

  it('没有可交换的组合时自动重排棋盘，并留下可解释的提示', () => {
    // 随机回放在挑战档会碰到死局（8×8 + 5 种几乎不会）；这里固定难度与种子把它钉住
    const difficulty: DifficultyId = 'challenging'
    const config = configFor(difficulty)
    let state = fresh(4, difficulty)
    const rng = createRng(4 * 7919 + 13)
    let found = false
    while (gameStatus(state) === 'playing') {
      const pairs = findLegalSwaps(state.board, config)
      if (pairs.length === 0) break
      const pair = pairs[rng.int(pairs.length)]!
      state = act(state, { type: 'swap', a: pair[0], b: pair[1] })
      if (state.lastShuffle !== -1) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
    // 重排发生在刚走完的那一步，盘面依旧稳定有解
    expect(state.lastShuffle).toBe(state.moves)
    expect(findGroups(state.board, config)).toEqual([])
    expect(hasLegalSwap(state.board, config)).toBe(true)
    // 重排后的局面照样能存档往返
    expect(decodeState(encodeState(state))).toEqual(state)
  })
})

describe('撤销', () => {
  it('撤销回到交换前的完整局面（棋盘 / 分数 / 步数 / 游标 / 最近重排）', () => {
    const state = fresh(11, 'skilled')
    const pairs = findLegalSwaps(state.board, configFor('skilled'))
    const [a, b] = pairs[0]!
    const before = JSON.stringify(encodeState(state))
    const played = act(state, { type: 'swap', a, b })
    const undone = act(played, { type: 'undo' })
    expect(JSON.stringify(encodeState(undone))).toBe(before)
    expect(undone.moves).toBe(0)
    expect(undone.history).toEqual([])
  })

  it('撤销一次只回退一步，可以一路退到开局', () => {
    const difficulty: DifficultyId = 'starter'
    const trail = randomTrail(fresh(3, difficulty), 8, 4242)
    expect(trail.length).toBeGreaterThan(6)
    let state = trail[trail.length - 1]!
    for (let step = trail.length - 2; step >= 0; step--) {
      state = act(state, { type: 'undo' })
      expect(JSON.stringify(encodeState(state))).toBe(JSON.stringify(encodeState(trail[step]!)))
    }
    expect(state.moves).toBe(0)
    expect(() => act(state, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('撤销会同时回退随机游标：撤销后重做同一次交换，结果与第一次完全相同', () => {
    const state = fresh(97, 'challenging')
    const [a, b] = findLegalSwaps(state.board, configFor('challenging'))[0]!
    const first = act(state, { type: 'swap', a, b })
    const undone = act(first, { type: 'undo' })
    const again = act(undone, { type: 'swap', a, b })
    expect(JSON.stringify(encodeState(again))).toBe(JSON.stringify(encodeState(first)))
    expect(again.cursor).toBe(first.cursor)
  })

  it('撤销也会回退「自动重排」：重排那一步撤销后棋盘回到重排之前', () => {
    const difficulty: DifficultyId = 'challenging'
    const config = configFor(difficulty)
    let state = fresh(4, difficulty)
    const rng = createRng(4 * 7919 + 13)
    while (gameStatus(state) === 'playing') {
      const pairs = findLegalSwaps(state.board, config)
      if (pairs.length === 0) break
      const pair = pairs[rng.int(pairs.length)]!
      const before = state
      state = act(state, { type: 'swap', a: pair[0], b: pair[1] })
      if (state.lastShuffle !== -1) {
        const back = act(state, { type: 'undo' })
        expect(back.lastShuffle).toBe(before.lastShuffle)
        expect(JSON.stringify(encodeState(back))).toBe(JSON.stringify(encodeState(before)))
        return
      }
    }
    throw new Error('expected a reshuffling move in this random trail')
  })

  it('没有历史时撤销抛错；非 playing 状态下撤销仍然可用（可以退回重试）', () => {
    const state = fresh(8, 'starter')
    expect(() => act(state, { type: 'undo' })).toThrow(IllegalActionError)
    // 造一个「already won」的局面：分数差一步到位
    const config = configFor('starter')
    const nearWin = singleClearState({ score: config.targetScore - 30 })
    expect(gameStatus(nearWin)).toBe('playing')
    const won = act(nearWin, { type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })
    expect(gameStatus(won)).toBe('won')
    const back = act(won, { type: 'undo' })
    expect(gameStatus(back)).toBe('playing')
    expect(back.score).toBe(config.targetScore - 30)
  })
})

describe('确定性与可复现', () => {
  it('同 seed + 同难度 → 同一开局；不同 seed 不同开局', () => {
    const first = createState(1234, 'skilled')
    expect(JSON.stringify(encodeState(createState(1234, 'skilled')))).toBe(JSON.stringify(encodeState(first)))
    expect(createState(1235, 'skilled').board).not.toEqual(first.board)
  })

  it('同 seed + 同动作序列 → 逐步同编码（双端一致口径）', () => {
    const replay = (): string[] => {
      const trail = randomTrail(fresh(555, 'challenging'), 20, 31337)
      return trail.map((state) => JSON.stringify(encodeState(state)))
    }
    expect(replay()).toEqual(replay())
  })

  it('每一步都能存档往返：decode(encode(state)) 与原状态逐字段相同', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const state of randomTrail(fresh(66, difficulty), 10, 2024)) {
        const decoded = decodeState(encodeState(state))
        expect(decoded).toEqual(state)
        expect(JSON.stringify(encodeState(decoded))).toBe(JSON.stringify(encodeState(state)))
      }
    }
  })
})

describe('选中态语义', () => {
  it('selectAction：未选中→选中；同格→取消；不相邻→移动选中；相邻→交换', () => {
    const config = configFor('starter')
    const state = singleClearState()
    // 未选中 → 选中
    expect(selectAt(state, 5)).toEqual({ type: 'select', index: 5 })
    const selected = act(state, { type: 'select', index: 5 })
    expect(selected.selected).toBe(5)
    // 同格 → 取消（select 动作在 reduce 里翻成 null）
    expect(selectAt(selected, 5)).toEqual({ type: 'select', index: 5 })
    expect(act(selected, { type: 'select', index: 5 }).selected).toBeNull()
    // 不相邻 → 选中态移动过去（比「点了没反应」更符合预期）
    expect(selectAt(selected, 60)).toEqual({ type: 'select', index: 60 })
    expect(act(selected, { type: 'select', index: 60 }).selected).toBe(60)
    // 相邻且能消 → 交换动作
    const pair = selectAt(state, indexOf(0, 2, config))
    expect(pair).toEqual({ type: 'select', index: indexOf(0, 2, config) })
    const armed = act(state, { type: 'select', index: indexOf(0, 2, config) })
    const swap = selectAt(armed, indexOf(1, 2, config))
    expect(swap).toEqual({ type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })
    const after = act(armed, swap!)
    expect(after.score).toBe(30)
    expect(after.selected).toBeNull()
  })

  it('相邻但换不出三连：动作是交换、被拒绝后选中态保留，玩家可以接着点别处', () => {
    const state = act(singleClearState(), { type: 'select', index: 0 })
    const action = selectAt(state, 1)
    expect(action).toEqual({ type: 'swap', a: 0, b: 1 })
    expect(() => act(state, action!)).toThrow(IllegalActionError)
    expect(state.selected).toBe(0)
    expect(state.moves).toBe(0)
  })

  it('越界与终局之后：selectAction 返回 null（点了没反应，不报错）', () => {
    const state = fresh(2, 'starter')
    expect(selectAt(state, -1)).toBeNull()
    expect(selectAt(state, cellCount(configFor('starter')))).toBeNull()
    const won = singleClearState({ score: configFor('starter').targetScore })
    expect(gameStatus(won)).toBe('won')
    expect(selectAt(won, 0)).toBeNull()
    expect(() => act(won, { type: 'select', index: 0 })).toThrow(IllegalActionError)
  })

  it('选中态进存档：encode/decode 往返保留选中格，撤销后选中态清空', () => {
    const selected = act(fresh(9, 'starter'), { type: 'select', index: 42 })
    expect(decodeState(encodeState(selected))).toEqual(selected)
    const [a, b] = findLegalSwaps(selected.board, configFor('starter'))[0]!
    const played = act(selected, { type: 'swap', a, b })
    expect(played.selected).toBeNull()
    expect(act(played, { type: 'undo' }).selected).toBeNull()
  })
})

describe('终局与重开', () => {
  it('达到目标分即 won，之后不再接受交换；步数用尽即 lost', () => {
    const config = configFor('starter')
    const won = singleClearState({ score: config.targetScore - 30 })
    const afterWin = act(won, { type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })
    expect(gameStatus(afterWin)).toBe('won')
    expect(() => act(afterWin, { type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })).toThrow(
      IllegalActionError,
    )

    const lastMove = singleClearState({ moves: config.moveLimit - 1 })
    const afterLast = act(lastMove, { type: 'swap', a: indexOf(0, 2, config), b: indexOf(1, 2, config) })
    expect(afterLast.score).toBe(30)
    expect(gameStatus(afterLast)).toBe('lost')
    expect(remainingMoves(afterLast)).toBe(0)
    const reverted = act(afterLast, { type: 'undo' })
    expect(gameStatus(reverted)).toBe('playing')
    expect(reverted.moves).toBe(config.moveLimit - 1)
  })

  it('重开回到同一盘初始棋盘，分数与撤销栈清空', () => {
    const start = fresh(17, 'skilled')
    const trail = randomTrail(start, 4, 6)
    const played = trail[trail.length - 1]!
    const restarted = act(played, { type: 'restart' })
    expect(restarted.board).toEqual(start.board)
    expect(restarted.score).toBe(0)
    expect(restarted.moves).toBe(0)
    expect(restarted.history).toEqual([])
    expect(restarted.cursor).toBe(start.cursor)
    expect(JSON.stringify(encodeState(restarted))).toBe(JSON.stringify(encodeState(start)))
  })

  it('legal() 里的每个动作都能真正执行（撤销 / 重开 / 选中 / 交换）', () => {
    const state = randomTrail(fresh(21, 'skilled'), 3, 8).pop()!
    const actions = legalActions(state)
    expect(actions.some((action) => action.type === 'undo')).toBe(true)
    expect(actions.some((action) => action.type === 'restart')).toBe(true)
    expect(actions.some((action) => action.type === 'select')).toBe(true)
    const swaps = actions.filter((action) => action.type === 'swap')
    expect(swaps.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(() => reduceMatch3(state, action)).not.toThrow()
    }
    // legal 里的交换都满足相邻；死局校验交给 decode 与不变量测试
    for (const action of swaps) {
      if (action.type === 'swap') expect(areAdjacent(action.a, action.b, configFor(state.difficulty))).toBe(true)
    }
    // 交换 a、b 后能消的判定与 board 层的枚举一致
    for (const action of swaps) {
      if (action.type !== 'swap') continue
      expect(findGroups(swapCells(state.board, action.a, action.b), configFor(state.difficulty)).length).toBeGreaterThan(0)
    }
  })

  it('没有历史 / 终局之后 legal() 依然给出可执行的撤销与重开', () => {
    const start = fresh(4, 'starter')
    const startActions = legalActions(start)
    expect(startActions.some((action) => action.type === 'undo')).toBe(false)
    const won = singleClearState({ score: configFor('starter').targetScore, moves: 1, history: [{ at: [], old: [], score: 0, cursor: 0, lastShuffle: -1 }] })
    const actions = legalActions(won)
    expect(actions.some((action) => action.type === 'swap')).toBe(false)
    expect(actions.some((action) => action.type === 'select')).toBe(false)
    expect(actions.some((action) => action.type === 'undo')).toBe(true)
    expect(actions.some((action) => action.type === 'restart')).toBe(true)
  })

  it('match3Game 的 selectAction / controlAction 与规则层一致', () => {
    const state = fresh(12, 'starter')
    expect(match3Game.controlAction?.(state, 'undo')).toEqual({ type: 'undo' })
    expect(match3Game.controlAction?.(state, 'restart')).toEqual({ type: 'restart' })
    expect(match3Game.controlAction?.(state, 'nope')).toBeNull()
    expect(selectAction(state, 0)).toEqual({ type: 'select', index: 0 })
  })
})
