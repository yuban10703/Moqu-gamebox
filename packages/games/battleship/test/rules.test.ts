/**
 * 规则层测试：命中/未中/连打、白方自动应手、判胜判负、撤销一整回合与存档重放校验。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError } from '@eink/core'
import {
  CELLS,
  DIFFICULTY_IDS,
  ENEMY,
  PLAYER,
  battleshipGame,
  encodeState,
  gameStatus,
  legalActions,
  placeFleet,
  reduceBattleship,
  remainingShipCells,
  selectAction,
  sunkShips,
  type BattleshipAction,
  type BattleshipState,
} from '../src/index.js'
import { enemyShipCells, enemyWaterCells, fresh, playToEnd } from './helpers.js'

function fire(state: BattleshipState, index: number): BattleshipState {
  return battleshipGame.reduce(state, { type: 'fire', index })
}

/** 玩家还能打的第一发命中（敌舰格） */
function nextHitTarget(state: BattleshipState): number {
  const target = enemyShipCells(state).find((cell) => !state.playerShots[cell])
  if (target === undefined) throw new Error('no enemy ship cell left')
  return target
}

/** 玩家还能打的第一发空弹（敌方海域里非舰格） */
function nextMissTarget(state: BattleshipState): number {
  const target = enemyWaterCells(state).find((cell) => !state.playerShots[cell])
  if (target === undefined) throw new Error('no water cell left')
  return target
}

describe('起始状态与白方应手', () => {
  it('起始：双方舰队摆好、玩家先手、0 步、无历史', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(7, difficulty)
      expect(state.turn).toBe(PLAYER)
      expect(state.moves).toBe(0)
      expect(state.rngCursor).toBe(0)
      expect(state.log).toHaveLength(0)
      expect(state.lastShot).toBeNull()
      expect(state.lastPlayerShot).toBeNull()
      expect(gameStatus(state)).toBe('playing')
    }
  })

  it('未中 → 换手，白方自动应手，控制权交回玩家', () => {
    const state = fresh(11, 'starter')
    const target = nextMissTarget(state)
    const next = fire(state, target)
    expect(next.playerShots[target]).toBe(true)
    expect(next.turn).toBe(PLAYER)
    expect(next.moves).toBe(1)
    expect(next.rngCursor).toBe(1)
    // 玩家 1 发 + 白方至少 1 发
    expect(next.log.length).toBeGreaterThanOrEqual(2)
    expect(next.enemyShots.filter(Boolean).length).toBe(next.log.length - 1)
  })

  it('命中 → 继续射击（连打），不换手、不增加游标、不动我方损失', () => {
    let state = fresh(20240607, 'starter')
    const mineBefore = remainingShipCells(state, PLAYER)
    for (let step = 0; step < 3; step++) {
      state = fire(state, nextHitTarget(state))
      expect(state.turn).toBe(PLAYER)
      expect(state.moves).toBe(step + 1)
      expect(state.rngCursor).toBe(0)
    }
    expect(state.log).toHaveLength(3)
    expect(state.enemyShots.some(Boolean)).toBe(false)
    expect(remainingShipCells(state, PLAYER)).toBe(mineBefore)
    expect(remainingShipCells(state, ENEMY)).toBe(
      state.enemyFleet.cells.filter((cell) => !state.playerShots[cell]).length,
    )
  })

  it('最后一手高亮记录的是玩家那一手', () => {
    const state = fresh(3, 'starter')
    const miss = nextMissTarget(state)
    const next = fire(state, miss)
    // 白方应手会更新 lastShot，但 lastPlayerShot 仍是玩家打的那格
    expect(next.lastPlayerShot).toBe(miss)
    expect(next.lastShot).not.toBeNull()
    if (next.log.length > 1) expect(next.lastShot).toBe(next.log[next.log.length - 1])
  })
})

describe('判胜 / 判负', () => {
  it('把敌舰全部命中 → won；此后不再接受射击', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const finished = playToEnd(2024, difficulty, 'win', fire)
      expect(gameStatus(finished), difficulty).toBe('won')
      expect(remainingShipCells(finished, ENEMY)).toBe(0)
      expect(sunkShips(finished, ENEMY)).toBe(finished.enemyFleet.ships.length)
      expect(remainingShipCells(finished, PLAYER)).toBeGreaterThan(0)
      // 终局存档也必须能往返
      expect(battleshipGame.decode(encodeState(finished))).toEqual(finished)
      expect(() => fire(finished, CELLS - 1)).toThrow(IllegalActionError)
    }
  })

  it('我方舰只全部被打中 → lost', () => {
    const finished = playToEnd(2024, 'starter', 'lose', fire)
    expect(gameStatus(finished)).toBe('lost')
    expect(remainingShipCells(finished, PLAYER)).toBe(0)
    expect(sunkShips(finished, PLAYER)).toBe(finished.playerFleet.ships.length)
    expect(() => fire(finished, 0)).toThrow(IllegalActionError)
    expect(battleshipGame.decode(encodeState(finished))).toEqual(finished)
  })

  it('终局后撤销 / 重开都可用', () => {
    const finished = playToEnd(5, 'starter', 'win', fire)
    expect(gameStatus(reduceBattleship(finished, { type: 'undo' }))).toBe('playing')
    const restarted = reduceBattleship(finished, { type: 'restart' })
    expect(gameStatus(restarted)).toBe('playing')
    expect(restarted.playerShots.some(Boolean)).toBe(false)
  })
})

describe('非法射击', () => {
  it('重复打同一格 / 越界 / 非整数都抛 IllegalActionError', () => {
    const state = fresh(1, 'starter')
    const target = nextMissTarget(state)
    const played = fire(state, target)
    // 玩家已经打过这一格
    expect(() => fire(played, target)).toThrow(IllegalActionError)
    for (const index of [-1, CELLS, 1.5, Number.NaN]) {
      expect(() => fire(played, index), String(index)).toThrow(IllegalActionError)
    }
    // 非法射击不改变原状态
    const before = encodeState(played)
    expect(() => fire(played, target)).toThrow(IllegalActionError)
    expect(encodeState(played)).toEqual(before)
  })

  it('同一格被白方打过不影响玩家再打（两张射击记录互不干扰）', () => {
    let state = fresh(9, 'skilled')
    // 玩家打空 → 白方应手
    state = fire(state, nextMissTarget(state))
    const enemyShot = state.enemyShots.findIndex(Boolean)
    expect(enemyShot).toBeGreaterThanOrEqual(0)
    // 玩家仍然可以打“白方打过的那一格”（不同的海域）
    if (!state.playerShots[enemyShot]) {
      const next = fire(state, enemyShot)
      expect(next.playerShots[enemyShot]).toBe(true)
    }
  })
})

describe('撤销与重开', () => {
  it('撤销一整回合：玩家的连打与白方应手一起退回', () => {
    let state = fresh(31, 'skilled')
    const start = encodeState(state)
    // 第一回合：打空 → 白方应手（可能连续命中，直到它自己也打空）
    state = fire(state, nextMissTarget(state))
    const afterFirstTurn = encodeState(state)
    expect(state.turn).toBe(PLAYER)
    expect(state.log.length).toBeGreaterThanOrEqual(2)

    // 第二回合：连打两发命中 + 一发空弹（空弹后白方再应手）
    state = fire(state, nextHitTarget(state))
    state = fire(state, nextHitTarget(state))
    state = fire(state, nextMissTarget(state))
    expect(state.moves).toBe(4)
    expect(state.turn).toBe(PLAYER)

    // 一次撤销 = 退回第二回合开始的全部内容（连打 + 白方应手）
    const undone = reduceBattleship(state, { type: 'undo' })
    expect(encodeState(undone)).toEqual(afterFirstTurn)
    // 再撤销 → 回到开局
    const twice = reduceBattleship(undone, { type: 'undo' })
    expect(encodeState(twice)).toEqual(start)
    expect(twice.log).toHaveLength(0)
    expect(twice.moves).toBe(0)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceBattleship(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 回到同一布局（同 seed 同难度）', () => {
    const start = fresh(77, 'challenging')
    let state = fire(start, nextMissTarget(start))
    state = fire(state, nextHitTarget(state))
    const restarted = reduceBattleship(state, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(start))
    expect(
      restarted.playerFleet.ships.map((ship) => [ship.start, ship.horizontal]),
    ).toEqual(placeFleet(77, 'challenging', PLAYER).ships.map((ship) => [ship.start, ship.horizontal]))
  })

  it('未知动作（方向键 / 旧动作名）明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceBattleship(state, { type: 'move', dir: 'up' } as unknown as BattleshipAction),
    ).toThrow(IllegalActionError)
    expect(() =>
      reduceBattleship(state, { type: 'nextLevel' } as unknown as BattleshipAction),
    ).toThrow(IllegalActionError)
  })
})

describe('selectAction / legal', () => {
  it('未打过的格 → fire；打过的格与越界 → null', () => {
    const state = fresh(3, 'starter')
    expect(selectAction(state, 0)).toEqual({ type: 'fire', index: 0 })
    for (const index of [-1, CELLS, 1.5, Number.NaN]) {
      expect(selectAction(state, index), String(index)).toBeNull()
    }
    const played = fire(state, 0)
    expect(selectAction(played, 0)).toBeNull()
  })

  it('legal 列出全部未打过的格 + undo/restart；终局只剩 undo/restart', () => {
    const state = fresh(9, 'starter')
    const fires = legalActions(state).filter((action) => action.type === 'fire')
    expect(fires).toHaveLength(CELLS)
    expect(legalActions(state)).toContainEqual({ type: 'restart' })
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)

    const played = fire(state, 0)
    expect(legalActions(played)).toContainEqual({ type: 'undo' })
    expect(legalActions(played).filter((action) => action.type === 'fire')).toHaveLength(
      played.playerShots.filter((shot) => !shot).length,
    )

    const finished = playToEnd(5, 'starter', 'win', fire)
    const final = legalActions(finished)
    expect(final.some((action) => action.type === 'fire')).toBe(false)
    expect(final).toContainEqual({ type: 'undo' })
    expect(final).toContainEqual({ type: 'restart' })
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返（含 JSON 往返）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(2024, difficulty)
      expect(battleshipGame.decode(encodeState(state))).toEqual(state)
      expect(battleshipGame.decode(JSON.parse(JSON.stringify(encodeState(state))))).toEqual(state)
    }
    let state = fresh(17, 'skilled')
    state = fire(state, nextMissTarget(state))
    state = fire(state, nextHitTarget(state))
    expect(battleshipGame.decode(encodeState(state))).toEqual(state)

    const won = playToEnd(5, 'challenging', 'win', fire)
    expect(battleshipGame.decode(encodeState(won))).toEqual(won)
    const lost = playToEnd(5, 'skilled', 'lose', fire)
    expect(battleshipGame.decode(encodeState(lost))).toEqual(lost)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    let played = fresh(23, 'starter')
    played = fire(played, nextMissTarget(played))
    played = fire(played, nextHitTarget(played))
    const raw = battleshipGame.encode(played) as {
      difficulty: string
      seed: number
      playerShips: Array<{ start: number; horizontal: boolean }>
      enemyShips: Array<{ start: number; horizontal: boolean }>
      playerShots: boolean[]
      enemyShots: boolean[]
      turn: string
      moves: number
      rngCursor: number
      lastShot: number | null
      lastPlayerShot: number | null
      log: number[]
    }
    const firstShip = raw.playerShips[0]!
    const freeCell = played.playerShots.findIndex((shot) => !shot)
    const fakeHit = played.enemyFleet.cells.find((cell) => !played.playerShots[cell])!
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
      // 布局与 seed 不符（把玩家的第一艘舰挪一格）
      { ...raw, playerShips: [{ ...firstShip, start: firstShip.start + 1 }, ...raw.playerShips.slice(1)] },
      // 改变 seed 但保留原布局 → 复算出来的舰队不同
      { ...raw, seed: raw.seed + 1 },
      { ...raw, playerShips: raw.playerShips.slice(1) },
      { ...raw, enemyShips: [...raw.enemyShips].reverse() },
      // 凭空多一次命中
      { ...raw, playerShots: raw.playerShots.map((shot, index) => (index === fakeHit ? true : shot)) },
      // 抹掉一次命中
      {
        ...raw,
        playerShots: raw.playerShots.map((shot, index) =>
          index === played.log.find((cell) => played.enemyFleet.mask[cell]) ? false : shot,
        ),
      },
      // 白方射击记录被篡改
      { ...raw, enemyShots: raw.enemyShots.map((shot, index) => (index === 0 ? !shot : shot)) },
      // 轮次不对（可对局时轮不到白方）
      { ...raw, turn: 'enemy' },
      { ...raw, turn: 'green' },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, moves: -1 },
      { ...raw, rngCursor: raw.rngCursor + 1 },
      { ...raw, lastShot: freeCell },
      { ...raw, lastPlayerShot: freeCell },
      // 日志非法：越界 / 同一方重复打同一格
      { ...raw, log: [...raw.log, CELLS + 3] },
      { ...raw, log: [0, 0] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(
        () => battleshipGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 从 (seed, difficulty, log) 复算，不信任存档里的 materialized 字段', () => {
    let played = fresh(41, 'skilled')
    played = fire(played, nextMissTarget(played))
    const decoded = battleshipGame.decode(encodeState(played))
    expect(decoded.log).toEqual(played.log)
    expect(decoded.playerShots).toEqual(played.playerShots)
    expect(decoded.enemyShots).toEqual(played.enemyShots)
    expect(decoded.moves).toBe(played.moves)
    expect(decoded.playerFleet.cells).toEqual(played.playerFleet.cells)
    expect(decoded.enemyFleet.cells).toEqual(played.enemyFleet.cells)
  })
})
