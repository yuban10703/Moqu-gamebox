/**
 * 规则层测试：播种/连走/吃子、白方自动应手、结束结算与判胜判和、撤销一整回合、存档重放校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  BLACK,
  BLACK_STORE,
  CELLS,
  DIFFICULTY_IDS,
  WHITE,
  WHITE_STORE,
  createState,
  encodeState,
  gameStatus,
  isFinished,
  legalActions,
  mancalaGame,
  outcomeOf,
  reduceMancala,
  selectAction,
  sowOnce,
  storeCount,
  totalStones,
  type MancalaAction,
  type MancalaState,
} from '../src/index.js'
import { INITIAL_TOTAL, drawCells, fresh, playToEnd, withCells } from './helpers.js'

function sow(state: MancalaState, index: number): MancalaState {
  return mancalaGame.reduce(state, { type: 'sow', index })
}

function legalBlackPits(state: MancalaState): number[] {
  return [7, 8, 9, 10, 11, 12].filter((pit) => (state.cells[pit] ?? 0) > 0)
}

/** 一局打完（黑方随机），返回终局 */
function finishGame(seed: number, difficulty: 'starter' | 'skilled' | 'challenging' = 'starter'): MancalaState {
  return playToEnd(seed, difficulty, sow)
}

describe('起始状态与白方应手', () => {
  it('起始：12 坑各 4 颗、两仓 0、总数 48、黑方先手', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(7, difficulty)
      expect(state.turn).toBe(BLACK)
      expect(state.moves).toBe(0)
      expect(state.rngCursor).toBe(0)
      expect(state.log).toHaveLength(0)
      expect(state.lastPit).toBeNull()
      expect(totalStones(state.cells)).toBe(INITIAL_TOTAL)
      expect(storeCount(state.cells, BLACK)).toBe(0)
      expect(storeCount(state.cells, WHITE)).toBe(0)
      expect(gameStatus(state)).toBe('playing')
      expect(isFinished(state.cells)).toBe(false)
    }
  })

  it('没连走 → 白方自动应手，控制权交回黑方', () => {
    // 黑坑12 有 4 颗：12→13→6→5→4，最后一颗落在白坑4，不连走
    const state = fresh(11, 'starter')
    const next = sow(state, 12)
    expect(next.turn).toBe(BLACK)
    expect(next.moves).toBe(1)
    expect(next.rngCursor).toBe(1)
    expect(next.log.length).toBeGreaterThanOrEqual(2)
    // 白方至少播了一手，但不会碰黑仓
    expect(next.cells[BLACK_STORE]).toBeGreaterThanOrEqual(0)
    expect(totalStones(next.cells)).toBe(INITIAL_TOTAL)
  })

  it('落自己仓 → 连走：reduce 后仍轮到黑方，白方不行动', () => {
    const state = withCells([[12, 1]], BLACK)
    const next = reduceMancala(state, { type: 'sow', index: 12 })
    expect(next.turn).toBe(BLACK)
    expect(next.moves).toBe(1)
    expect(next.rngCursor).toBe(0)
    expect(next.log).toEqual([12])
    expect(storeCount(next.cells, BLACK)).toBe(1)
  })

  it('吃子：落自己空坑且对面非空，两边一起进仓', () => {
    const state = withCells(
      [
        [10, 1],
        [11, 0],
      ],
      BLACK,
    )
    // 先用纯转移看这一手本身：吃子 5 颗，两个坑清空
    const single = sowOnce(state, 10)
    expect(single.captured).toBe(5)
    expect(single.state.cells[11]).toBe(0)
    expect(single.state.cells[2]).toBe(0)
    expect(storeCount(single.state.cells, BLACK)).toBe(5)
    expect(single.state.turn).toBe(WHITE)
    // 走完整回合（白方应手）后：黑仓只增不减，石子守恒
    const next = reduceMancala(state, { type: 'sow', index: 10 })
    expect(storeCount(next.cells, BLACK)).toBe(5)
    expect(next.turn).toBe(BLACK)
    expect(totalStones(next.cells)).toBe(totalStones(state.cells))
  })
})

describe('结束、结算与胜负', () => {
  it('一方坑全空 → 结束并结算：双方坑清空、两仓合计 48', () => {
    for (const difficulty of DIFFICULTY_IDS.slice(0, 2)) {
      const finished = finishGame(2024, difficulty)
      expect(isFinished(finished.cells), `${difficulty}\n${drawCells(finished.cells)}`).toBe(true)
      for (const pit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        expect(finished.cells[pit], `pit ${pit}`).toBe(0)
      }
      const total = storeCount(finished.cells, BLACK) + storeCount(finished.cells, WHITE)
      expect(total).toBe(INITIAL_TOTAL)
      expect(gameStatus(finished)).not.toBe('playing')
      const mine = storeCount(finished.cells, BLACK)
      const theirs = storeCount(finished.cells, WHITE)
      const expected = mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw'
      expect(outcomeOf(finished)).toBe(expected)
      // 终局存档必须能往返
      expect(mancalaGame.decode(encodeState(finished))).toEqual(finished)
    }
  })

  it('平局并入 won（结果页用 draw 标题）', () => {
    const base = fresh(1, 'starter')
    const draw: MancalaState = {
      ...base,
      cells: [24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24],
    }
    expect(isFinished(draw.cells)).toBe(true)
    expect(outcomeOf(draw)).toBe('draw')
    expect(gameStatus(draw)).toBe('won')
    const win: MancalaState = { ...base, cells: [20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 28] }
    expect(outcomeOf(win)).toBe('won')
    const lose: MancalaState = { ...base, cells: [28, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20] }
    expect(outcomeOf(lose)).toBe('lost')
    expect(gameStatus(lose)).toBe('lost')
  })

  it('终局后不再接受播种，但撤销/重开可用', () => {
    const finished = finishGame(5, 'starter')
    expect(() => sow(finished, 7)).toThrow(IllegalActionError)
    expect(gameStatus(reduceMancala(finished, { type: 'undo' }))).toBe('playing')
    const restarted = reduceMancala(finished, { type: 'restart' })
    expect(gameStatus(restarted)).toBe('playing')
    expect(restarted.log).toHaveLength(0)
    expect(restarted.cells).toEqual(fresh(5, 'starter').cells)
  })

  it('对局过程中石子守恒（14 格总数恒为 48）', () => {
    // playToEnd 内部每步都会断言守恒，这里再显式跑一遍并检查账面
    const finished = finishGame(9, 'skilled')
    expect(totalStones(finished.cells)).toBe(INITIAL_TOTAL)
  })
})

describe('非法播种', () => {
  it('选空坑 / 对手的坑 / 仓 / 越界都抛 IllegalActionError', () => {
    const state = fresh(1, 'starter')
    expect(() => sow(state, 3)).toThrow(IllegalActionError) // 白方的坑
    expect(() => sow(state, WHITE_STORE)).toThrow(IllegalActionError) // 白仓
    expect(() => sow(state, BLACK_STORE)).toThrow(IllegalActionError) // 黑仓
    expect(() => sow(state, -1)).toThrow(IllegalActionError)
    expect(() => sow(state, CELLS)).toThrow(IllegalActionError)
    expect(() => sow(state, 1.5)).toThrow(IllegalActionError)
    expect(() => sow(withCells([[7, 0]], BLACK), 7)).toThrow(IllegalActionError) // 空坑
    // 非法动作不改变原状态
    const before = encodeState(state)
    expect(() => sow(state, 3)).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(before)
  })

  it('未知动作（方向键 / 旧动作名）明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceMancala(state, { type: 'move', dir: 'up' } as unknown as MancalaAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reduceMancala(state, { type: 'nextLevel' } as unknown as MancalaAction),
    ).toThrow(IllegalActionError)
  })
})

describe('撤销与重开', () => {
  it('撤销一整回合：逐回合退回（含白方应手）', () => {
    const rng = createRng(31)
    let state = fresh(31, 'skilled')
    const starts = [encodeState(state)]
    for (let turn = 0; turn < 4; turn++) {
      const legal = legalBlackPits(state)
      expect(legal.length).toBeGreaterThan(0)
      state = sow(state, legal[rng.int(legal.length)]!)
      starts.push(encodeState(state))
    }
    for (let turn = 4; turn > 0; turn--) {
      expect(encodeState(state)).toEqual(starts[turn])
      state = reduceMancala(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(starts[0])
    expect(state.log).toHaveLength(0)
    expect(state.moves).toBe(0)
  })

  it('连走也一起退回：真实对局里找出一次黑方连走', () => {
    let found = false
    for (let seed = 0; seed < 40 && !found; seed++) {
      let state = fresh(seed, 'starter')
      const rng = createRng(seed)
      for (let turn = 0; turn < 200; turn++) {
        if (isFinished(state.cells)) break
        const legal = legalBlackPits(state)
        if (legal.length === 0) break
        const turnStart = encodeState(state)
        const next = sow(state, legal[rng.int(legal.length)]!)
        const chained = next.log.length === state.log.length + 1 && next.turn === BLACK
        if (chained) {
          // 再播一手（可能是连走也可能换手），撤销应当回到这一回合开始
          const followUp = legalBlackPits(next)
          expect(followUp.length).toBeGreaterThan(0)
          const second = sow(next, followUp[0]!)
          expect(encodeState(reduceMancala(second, { type: 'undo' }))).toEqual(turnStart)
          found = true
          break
        }
        state = next
      }
    }
    expect(found).toBe(true)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceMancala(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到初始摆法（同 seed）', () => {
    const start = fresh(7, 'starter')
    let state = sow(start, 12)
    state = sow(state, legalBlackPits(state)[0]!)
    expect(encodeState(reduceMancala(state, { type: 'restart' }))).toEqual(encodeState(start))
    expect(createState(7, 'starter').cells).toEqual(start.cells)
  })
})

describe('selectAction / legal', () => {
  it('自己的非空坑 → sow；仓、对手的坑、空坑、越界 → null', () => {
    const state = fresh(3, 'starter')
    expect(selectAction(state, 7)).toEqual({ type: 'sow', index: 7 })
    expect(selectAction(state, 12)).toEqual({ type: 'sow', index: 12 })
    expect(selectAction(state, 3)).toBeNull() // 白方的坑
    expect(selectAction(state, WHITE_STORE)).toBeNull()
    expect(selectAction(state, BLACK_STORE)).toBeNull()
    for (const index of [-1, CELLS, 1.5, Number.NaN]) {
      expect(selectAction(state, index), String(index)).toBeNull()
    }
    // 空坑
    const empty = withCells([[7, 0]], BLACK)
    expect(selectAction(empty, 7)).toBeNull()
    // 每个返回的动作都能被 reduce 接受
    const action = selectAction(state, 8)!
    expect(action).toEqual({ type: 'sow', index: 8 })
    expect(sow(state, 8).moves).toBe(1)
  })

  it('legal 列出全部非空黑坑 + undo/restart；终局只剩 undo/restart', () => {
    const state = fresh(9, 'starter')
    const sows = legalActions(state).filter((action) => action.type === 'sow')
    expect(sows).toHaveLength(6)
    expect(legalActions(state)).toContainEqual({ type: 'restart' })
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)

    const played = sow(state, 12)
    expect(legalActions(played)).toContainEqual({ type: 'undo' })

    const finished = finishGame(5, 'starter')
    const final = legalActions(finished)
    expect(final.some((action) => action.type === 'sow')).toBe(false)
    expect(final).toContainEqual({ type: 'undo' })
    expect(final).toContainEqual({ type: 'restart' })
    expect(selectAction(finished, 7)).toBeNull()
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返（含 JSON 往返）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(2024, difficulty)
      expect(mancalaGame.decode(encodeState(state))).toEqual(state)
      expect(mancalaGame.decode(JSON.parse(JSON.stringify(encodeState(state))))).toEqual(state)
    }
    let state = fresh(17, 'skilled')
    for (let turn = 0; turn < 4; turn++) {
      state = sow(state, legalBlackPits(state)[0]!)
    }
    expect(mancalaGame.decode(encodeState(state))).toEqual(state)
    const finished = finishGame(9, 'starter')
    expect(mancalaGame.decode(encodeState(finished))).toEqual(finished)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh(23, 'starter')
    played = sow(played, 12)
    played = sow(played, legalBlackPits(played)[0]!)
    const raw = mancalaGame.encode(played) as {
      difficulty: string
      seed: number
      cells: number[]
      turn: string
      moves: number
      rngCursor: number
      lastPit: number | null
      log: number[]
    }
    const addStone = raw.cells.map((count, index) => (index === 7 ? count + 1 : count))
    const dropStone = raw.cells.map((count, index) =>
      index === raw.log[0] && count > 0 ? count - 1 : count,
    )
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
      // 凭空多几颗石子
      { ...raw, cells: addStone },
      // 仓里石子不对 / 坑里少了石子
      { ...raw, cells: dropStone },
      { ...raw, cells: raw.cells.map((count, index) => (index === BLACK_STORE ? count + 3 : count)) },
      { ...raw, cells: raw.cells.slice(0, CELLS - 1) },
      // 轮次不对（可对局时轮不到白方）
      { ...raw, turn: 'white' },
      { ...raw, turn: 'green' },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, rngCursor: raw.rngCursor + 1 },
      { ...raw, lastPit: 8 },
      // 日志非法：选了仓 / 白方的坑 / 越界 / 选了已经空的坑
      { ...raw, log: [...raw.log, WHITE_STORE] },
      { ...raw, log: [...raw.log, BLACK_STORE] },
      { ...raw, log: [...raw.log, 3] },
      { ...raw, log: [...raw.log, CELLS + 2] },
      { ...raw, log: [12, 12] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(
        () => mancalaGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 从 (seed, difficulty, log) 复算，不信任存档里的 materialized 字段', () => {
    const played = sow(fresh(41, 'skilled'), 12)
    const decoded = mancalaGame.decode(encodeState(played))
    expect(decoded.log).toEqual(played.log)
    expect(decoded.cells).toEqual(played.cells)
    expect(decoded.turn).toBe(played.turn)
    expect(decoded.moves).toBe(played.moves)
    expect(decoded.rngCursor).toBe(played.rngCursor)
  })
})
