/**
 * 规则层测试：画线与连走、白方自动应手、撤销一整回合、判胜/判和与存档重放校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK,
  DIFFICULTIES,
  WHITE,
  boxIndexAt,
  boxIndexes,
  configFor,
  countScores,
  dotsboxesGame,
  edgesOfBox,
  emptyState,
  encodeState,
  gameStatus,
  indexOf,
  legalActions,
  openEdges,
  outcomeOf,
  reduceDotsBoxes,
  selectAction,
  type DotsBoxesAction,
  type DotsBoxesState,
  type Side,
} from '../src/index.js'
import { customState } from './helpers.js'

function fresh(seed = 20240607, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter'): DotsBoxesState {
  return emptyState(seed, difficulty)
}

function claimEdge(state: DotsBoxesState, index: number): DotsBoxesState {
  return reduceDotsBoxes(state, { type: 'claim', index })
}

/** 用随机合法边把一局打完（黑方随机、白方按 starter 难度应手） */
function playFullGame(seed: number, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter'): DotsBoxesState {
  const rng = createRng(seed)
  let state = fresh(seed, difficulty)
  let guard = 0
  while (gameStatus(state) === 'playing') {
    const edges = openEdges(state)
    if (edges.length === 0) break
    if (guard++ > 5000) throw new Error('game did not finish')
    state = claimEdge(state, edges[rng.int(edges.length)]!)
  }
  return state
}

describe('起始状态与白方应手', () => {
  it('起始：空棋盘、黑方先手、0 步、无历史', () => {
    const state = fresh()
    expect(state.turn).toBe(BLACK)
    expect(state.moves).toBe(0)
    expect(state.rngCursor).toBe(0)
    expect(state.log).toHaveLength(0)
    expect(state.lastEdge).toBeNull()
    expect(state.owners.every((owner) => owner === null)).toBe(true)
    expect(gameStatus(state)).toBe('playing')
  })

  it('画一条边没占到格 → 白方自动应手（含连走），控制权交回黑方', () => {
    const state = fresh(11, 'starter')
    const edge = openEdges(state)[0]!
    const next = claimEdge(state, edge)
    expect(next.edges[edge]).toBe(BLACK)
    expect(next.turn).toBe(BLACK)
    expect(next.moves).toBe(1)
    expect(next.rngCursor).toBe(1)
    // 黑方 1 条 + 白方至少 1 条；开局不可能占格，所以正好 2 条
    expect(next.log).toHaveLength(2)
    expect(next.log[0]).toBe(edge)
    expect(countScores(next.owners)).toEqual({ black: 0, white: 0 })
  })

  it('占到格时当前玩家继续走（连走），不换手、不增加游标', () => {
    const difficulty = 'starter' as const
    const box = boxIndexAt(0, 0, configFor(difficulty))
    const edges = edgesOfBox(box, configFor(difficulty))
    const state = customState(difficulty, { claimed: edges.slice(0, 3), turn: BLACK })
    const next = claimEdge(state, edges[3]!)
    expect(next.owners[box]).toBe(BLACK)
    expect(next.turn).toBe(BLACK)
    expect(next.moves).toBe(1)
    expect(next.rngCursor).toBe(0)
    expect(next.log).toEqual([edges[3]!])
    expect(gameStatus(next)).toBe('playing')
  })
})

describe('判胜 / 判和', () => {
  it('一局打完：分数之和 = 方格数，终局状态与 result 一致', () => {
    for (const difficulty of ['starter', 'skilled'] as const) {
      const state = playFullGame(2024, difficulty)
      expect(gameStatus(state), difficulty).not.toBe('playing')
      const scores = countScores(state.owners)
      expect(scores.black + scores.white).toBe(DIFFICULTIES[difficulty].boxCount)
      expect(openEdges(state)).toHaveLength(0)
      const expected =
        scores.black > scores.white ? 'won' : scores.black < scores.white ? 'lost' : 'draw'
      expect(outcomeOf(state)).toBe(expected)
      // decode 必须接受自己产出的终局
      expect(dotsboxesGame.decode(encodeState(state))).toEqual(state)
    }
  })

  it('平局并入 won（结果页用 draw 标题）', () => {
    // 真实对局很少正好打成平局，这里在一局画满的棋盘上把归属均分来验证映射：
    // 4×4 = 16 个方格，8 黑 8 白 —— 只有方格数为偶数时才可能出现平局
    const difficulty = 'skilled' as const
    const config = configFor(difficulty)
    const finished = playFullGame(5, difficulty)
    const owners = new Array<Side | null>(config.cells).fill(null)
    boxIndexes(config).forEach((box, index) => {
      owners[box] = index < config.boxCount / 2 ? BLACK : WHITE
    })
    const state = { ...finished, owners }
    expect(countScores(state.owners)).toEqual({
      black: config.boxCount / 2,
      white: config.boxCount / 2,
    })
    // 平局在状态里也并入 won（壳层据此展示结果面板）
    expect(gameStatus(state)).toBe('won')
    expect(outcomeOf(state)).toBe('draw')
  })
})

describe('撤销与重开', () => {
  it('撤销一整回合：玩家的连走与白方应手一起退回', () => {
    let state = fresh(31, 'skilled')
    const snapshots = [encodeState(state)]
    for (let turn = 0; turn < 4; turn++) {
      state = claimEdge(state, openEdges(state)[0]!)
      snapshots.push(encodeState(state))
    }
    for (let turn = 4; turn > 0; turn--) {
      expect(encodeState(state)).toEqual(snapshots[turn])
      state = reduceDotsBoxes(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(snapshots[0])
    expect(state.log).toHaveLength(0)
  })

  it('连走中途撤销回到回合开始（真实对局里找出一次黑方占格连走）', () => {
    let found = false
    for (let seed = 0; seed < 30 && !found; seed++) {
      let state = fresh(seed, 'starter')
      const rng = createRng(seed)
      for (let turn = 0; turn < 200; turn++) {
        if (gameStatus(state) !== 'playing') break
        const turnStart = encodeState(state)
        const before = countScores(state.owners).black
        const edges = openEdges(state)
        const edge = edges[rng.int(edges.length)]!
        state = claimEdge(state, edge)
        // 黑方刚占了一格并且还在连走
        if (countScores(state.owners).black > before && state.turn === BLACK) {
          expect(encodeState(reduceDotsBoxes(state, { type: 'undo' }))).toEqual(turnStart)
          found = true
          break
        }
      }
    }
    expect(found).toBe(true)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceDotsBoxes(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到空棋盘', () => {
    const start = fresh(7, 'skilled')
    const played = claimEdge(start, openEdges(start)[0]!)
    expect(encodeState(reduceDotsBoxes(played, { type: 'restart' }))).toEqual(encodeState(start))
  })

  it('对局结束后只能撤销/重开，不能继续画线', () => {
    const finished = playFullGame(5, 'starter')
    expect(gameStatus(finished)).not.toBe('playing')
    expect(() => claimEdge(finished, 0)).toThrow(IllegalActionError)
    expect(gameStatus(reduceDotsBoxes(finished, { type: 'undo' }))).toBe('playing')
    expect(gameStatus(reduceDotsBoxes(finished, { type: 'restart' }))).toBe('playing')
  })
})

describe('selectAction / legal', () => {
  it('未画的边 → claim；点、方格、已画的边、越界 → null', () => {
    const difficulty = 'starter' as const
    const config = configFor(difficulty)
    const state = fresh(3, difficulty)
    const edge = indexOf(0, 1, config)
    expect(selectAction(state, edge)).toEqual({ type: 'claim', index: edge })
    // 点与方格
    expect(selectAction(state, indexOf(0, 0, config))).toBeNull()
    expect(selectAction(state, indexOf(1, 1, config))).toBeNull()
    // 越界
    for (const index of [-1, config.cells, 1.5, Number.NaN]) {
      expect(selectAction(state, index), String(index)).toBeNull()
    }
    // 已画的边
    const played = claimEdge(state, edge)
    expect(selectAction(played, edge)).toBeNull()
    // 每个返回的动作都能被 reduce 接受
    const action = selectAction(state, edge)
    expect(action).toEqual({ type: 'claim', index: edge })
    expect(claimEdge(state, edge).edges[edge]).toBe(BLACK)
  })

  it('legal 列出全部未画的边 + undo/restart；终局只剩 undo/restart', () => {
    const state = fresh(9, 'starter')
    const claims = legalActions(state).filter((action) => action.type === 'claim')
    expect(claims).toHaveLength(DIFFICULTIES.starter.edgeCount)
    expect(legalActions(state)).toContainEqual({ type: 'restart' })
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)
    const played = claimEdge(state, openEdges(state)[0]!)
    expect(legalActions(played)).toContainEqual({ type: 'undo' })

    const finished = playFullGame(5, 'starter')
    const final = legalActions(finished)
    expect(final.some((action) => action.type === 'claim')).toBe(false)
    expect(final).toContainEqual({ type: 'undo' })
    expect(final).toContainEqual({ type: 'restart' })
  })

  it('未知动作（方向键 / 旧动作名）明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceDotsBoxes(state, { type: 'move', dir: 'up' } as unknown as DotsBoxesAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reduceDotsBoxes(state, { type: 'nextLevel' } as unknown as DotsBoxesAction),
    ).toThrow(IllegalActionError)
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返（含 JSON 往返）', () => {
    for (const difficulty of ['starter', 'skilled', 'challenging'] as const) {
      const state = fresh(2024, difficulty)
      expect(dotsboxesGame.decode(encodeState(state))).toEqual(state)
      expect(dotsboxesGame.decode(JSON.parse(JSON.stringify(encodeState(state))))).toEqual(state)
    }
    let state = fresh(17, 'skilled')
    for (let turn = 0; turn < 6; turn++) state = claimEdge(state, openEdges(state)[0]!)
    expect(dotsboxesGame.decode(encodeState(state))).toEqual(state)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh(23, 'skilled')
    played = claimEdge(played, openEdges(played)[0]!)
    played = claimEdge(played, openEdges(played)[0]!)
    const raw = dotsboxesGame.encode(played) as {
      difficulty: string
      seed: number
      edges: Array<string | null>
      owners: Array<string | null>
      turn: string
      moves: number
      rngCursor: number
      lastEdge: number | null
      log: number[]
    }
    const config = configFor('skilled')
    const claimedEdge = raw.log[0]!
    const freeEdge = openEdges(played)[0]!
    const emptyBox = boxIndexAt(0, 0, config)
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
      // 凭空多一个方格
      {
        ...raw,
        owners: raw.owners.map((owner, index) => (index === emptyBox ? BLACK : owner)),
      },
      // 边被抹掉一条
      { ...raw, edges: raw.edges.map((owner, index) => (index === claimedEdge ? null : owner)) },
      // 轮次不对（可对局时轮不到白方）
      { ...raw, turn: WHITE },
      { ...raw, turn: 'green' },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, moves: -1 },
      { ...raw, rngCursor: raw.rngCursor + 1 },
      { ...raw, lastEdge: freeEdge },
      { ...raw, lastEdge: raw.log[raw.log.length - 1]! + 1 },
      // 日志本身非法：画了一个点 / 画了方格 / 重复画同一条边 / 越界
      { ...raw, log: [indexOf(1, 1, config)] },
      { ...raw, log: [indexOf(0, 0, config)] },
      { ...raw, log: [claimedEdge, claimedEdge] },
      { ...raw, log: [config.cells + 5] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(
        () => dotsboxesGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 从 (seed, difficulty, log) 复算，不信任存档里的 materialized 字段', () => {
    const played = claimEdge(fresh(41, 'starter'), openEdges(fresh(41, 'starter'))[0]!)
    const decoded = dotsboxesGame.decode(encodeState(played))
    expect(decoded.log).toEqual(played.log)
    expect(decoded.edges).toEqual(played.edges)
    expect(decoded.turn).toBe(played.turn)
    expect(decoded.moves).toBe(played.moves)
  })
})
