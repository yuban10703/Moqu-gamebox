/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  CELLS,
  DIFFICULTY_IDS,
  ENEMY,
  HIT_GLYPH,
  HIT_TEXT_SCALE,
  MISS_GLYPH,
  MISS_TEXT_SCALE,
  PLAYER,
  battleshipGame,
  gameStatus,
  reduceBattleship,
  remainingShipCells,
  selectAction,
  type BattleshipState,
  type DifficultyId,
} from '../src/index.js'
import { enemyShipCells, enemyWaterCells, fresh, playToEnd } from './helpers.js'

function fire(state: BattleshipState, index: number): BattleshipState {
  return battleshipGame.reduce(state, { type: 'fire', index })
}

function statsOf(state: BattleshipState): string[] {
  return battleshipGame.view(state).stats.map((stat) => stat.value)
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(battleshipGame.id).toBe('battleship')
    expect(battleshipGame.i18nNamespace).toBe('battleship')
    expect(battleshipGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(battleshipGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(battleshipGame.illegalNoticeKey).toBe('battleship.illegal.notice')
    expect(battleshipGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(battleshipGame.difficulties.map((item) => item.labelKey)).toEqual([
      'battleship.difficulty.starter',
      'battleship.difficulty.skilled',
      'battleship.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((battleshipGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('contentId = 难度，movesOf = 玩家射击次数', () => {
    const state = fresh(1, 'skilled')
    expect(battleshipGame.contentId!(state)).toBe('skilled')
    expect(battleshipGame.movesOf!(state)).toBe(0)
    const played = fire(state, enemyShipCells(state)[0]!)
    expect(battleshipGame.movesOf!(played)).toBe(1)
    expect(battleshipGame.contentId!(fresh(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(battleshipGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(battleshipGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(battleshipGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('create 拒绝未知难度；三档都是 8×8', () => {
    expect(() => battleshipGame.create(0, 'impossible')).toThrow(IllegalActionError)
    for (const difficulty of DIFFICULTY_IDS) {
      const view = battleshipGame.view(battleshipGame.create(3, difficulty))
      expect(view.board!.cols).toBe(8)
      expect(view.board!.rows).toBe(8)
      expect(view.board!.cells).toHaveLength(CELLS)
    }
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('初始：64 格全是未打过的 floor、没有分组线', () => {
    const view = battleshipGame.view(fresh(1, 'starter'))
    expect(view.board!.kind).toBe('grid')
    expect(view.board!.groups).toBeUndefined()
    expect(view.board!.cells).toHaveLength(CELLS)
    view.board!.cells.forEach((cell, index) => {
      expect(cell.index).toBe(index)
      expect(cell.kind).toBe('floor')
      expect(cell.glyph).toBe('')
      expect(cell.selected).toBeUndefined()
    })
  })

  it('未中 = floor + ○（0.55）；命中 = tile + ✖（0.6）；玩家最后一手 selected', () => {
    const state = fresh(7, 'skilled')
    const hitTarget = enemyShipCells(state)[0]!
    const hit = fire(state, hitTarget)
    const hitCells = battleshipGame.view(hit).board!.cells
    expect(hitCells[hitTarget]).toEqual({
      index: hitTarget,
      kind: 'tile',
      glyph: HIT_GLYPH,
      textScale: HIT_TEXT_SCALE,
      selected: true,
    })

    const missTarget = enemyWaterCells(hit).find((cell) => !hit.playerShots[cell])!
    const missed = fire(hit, missTarget)
    const missCells = battleshipGame.view(missed).board!.cells
    expect(missCells[missTarget]).toEqual({
      index: missTarget,
      kind: 'floor',
      glyph: MISS_GLYPH,
      textScale: MISS_TEXT_SCALE,
      selected: true,
    })
    // 之前那一手不再高亮
    expect(missCells[hitTarget]!.selected).toBeUndefined()
    expect(missCells[hitTarget]!.kind).toBe('tile')
    // 白方打的是我方海域，不影响这张棋盘
    const enemyShotCount = missed.enemyShots.filter(Boolean).length
    expect(enemyShotCount).toBeGreaterThan(0)
    expect(missed.playerShots.filter(Boolean)).toHaveLength(2)
  })

  it('stats 恰好三项恒定输出，且数字准确（我方剩余 / 敌方剩余 / 已射击）', () => {
    const difficulty: DifficultyId = 'skilled'
    const state = fresh(7, difficulty)
    const mine = remainingShipCells(state, PLAYER)
    const foe = remainingShipCells(state, ENEMY)
    expect(battleshipGame.view(state).stats).toEqual([
      { labelKey: 'battleship.stat.mine', value: String(mine) },
      { labelKey: 'battleship.stat.foe', value: String(foe) },
      { labelKey: 'battleship.stat.shots', value: '0' },
    ])

    const hit = fire(state, enemyShipCells(state)[0]!)
    expect(statsOf(hit)).toEqual([String(mine), String(foe - 1), '1'])

    const missed = fire(hit, enemyWaterCells(hit).find((cell) => !hit.playerShots[cell])!)
    // 白方应手打中我方若干格（也可能是 0）：我方剩余必须精确减去这些命中
    const hitsOnMe = missed.enemyShots.filter(
      (shot, index) => shot && missed.playerFleet.mask[index],
    ).length
    expect(missed.enemyShots.filter(Boolean).length).toBeGreaterThan(0)
    expect(statsOf(missed)).toEqual([String(mine - hitsOnMe), String(foe - 1), '2'])
  })

  it('进行中没有结果；胜/负各自给出结果标题与明细', () => {
    expect(battleshipGame.view(fresh()).result).toBeNull()
    expect(battleshipGame.view(fresh()).notice).toBeNull()

    const won = playToEnd(5, 'starter', 'win', fire)
    const wonResult = battleshipGame.view(won).result!
    expect(wonResult.titleKey).toBe('battleship.won.title')
    expect(wonResult.details).toEqual([
      { key: 'battleship.result.sunk', params: { count: won.enemyFleet.ships.length } },
      { key: 'battleship.result.moves', params: { count: won.moves } },
    ])

    const lost = playToEnd(5, 'starter', 'lose', fire)
    const lostResult = battleshipGame.view(lost).result!
    expect(lostResult.titleKey).toBe('battleship.lost.title')
    expect(lostResult.details[1]!.params!.count).toBe(lost.moves)
  })
})

describe('controls', () => {
  it('只声明撤销，不声明 dpad / restart / next-level', () => {
    const controls = battleshipGame.controls(fresh())
    expect(controls).toHaveLength(1)
    const undo = controls[0]!
    expect(undo.id).toBe('undo')
    expect(undo.role).toBe('action')
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.role === 'dpad')).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.id === 'next-level')).toBe(false)
  })

  it('射击过之后 undo 才可用', () => {
    const state = fresh()
    const played = fire(state, 0)
    expect(battleshipGame.controls(played)[0]!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始 / 中盘 / 终局状态都严格往返', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = fresh(2024, difficulty)
      expect(battleshipGame.decode(battleshipGame.encode(state))).toEqual(state)
      expect(
        battleshipGame.decode(JSON.parse(JSON.stringify(battleshipGame.encode(state)))),
      ).toEqual(state)
    }
    let state = fresh(17, 'challenging')
    state = fire(state, enemyShipCells(state)[0]!)
    state = fire(state, enemyShipCells(state)[1]!)
    expect(battleshipGame.decode(battleshipGame.encode(state))).toEqual(state)
    const won = playToEnd(9, 'starter', 'win', fire)
    expect(battleshipGame.decode(battleshipGame.encode(won))).toEqual(won)
    const lost = playToEnd(9, 'starter', 'lose', fire)
    expect(battleshipGame.decode(battleshipGame.encode(lost))).toEqual(lost)
  })

  it('坏数据一律抛 IllegalActionError（GameDef 入口）', () => {
    let played = fresh(23, 'starter')
    played = fire(played, enemyShipCells(played)[0]!)
    const raw = battleshipGame.encode(played) as Record<string, unknown>
    const fakeHit = played.enemyFleet.cells.find((cell) => !played.playerShots[cell])!
    const bad: unknown[] = [
      null,
      undefined,
      'state',
      {},
      { ...raw, difficulty: 'nope' },
      {
        ...raw,
        playerShots: (raw.playerShots as boolean[]).map((shot, index) =>
          index === fakeHit ? true : shot,
        ),
      },
      { ...raw, turn: 'enemy' },
      { ...raw, moves: (raw.moves as number) + 1 },
      { ...raw, log: [0, 0] },
      { ...raw, log: [] },
    ]
    for (const candidate of bad) {
      expect(
        () => battleshipGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 90),
      ).toThrow(IllegalActionError)
    }
  })
})

describe('属性测试', () => {
  it('随机 60 步合法动作：每步 encode→decode 往返一致且能继续对局', () => {
    const rng = createRng(20240607)
    let state = fresh(20240607, 'skilled')
    let applied = 0
    let guard = 0
    while (applied < 60 && guard++ < 200000) {
      if (gameStatus(state) !== 'playing') break
      const action = selectAction(state, rng.int(CELLS))
      if (action === null || action.type !== 'fire') continue
      state = fire(state, action.index)
      applied += 1

      const encoded = battleshipGame.encode(state)
      const decoded = battleshipGame.decode(encoded)
      expect(decoded, `step ${applied}`).toEqual(state)
      expect(battleshipGame.encode(decoded)).toEqual(encoded)
      expect(
        battleshipGame.decode(JSON.parse(JSON.stringify(encoded))),
        `step ${applied}`,
      ).toEqual(state)
      // 局面永远可用（最差也能撤销或重新开始）
      expect(battleshipGame.legal(decoded).length).toBeGreaterThan(0)
      state = decoded
    }
    expect(applied).toBeGreaterThan(0)
  })

  it('一方败后不再接受任何射击动作', () => {
    let state = fresh(31, 'starter')
    let guard = 0
    while (gameStatus(state) === 'playing' && guard++ < 500) {
      // 专打对方的舰格：命中就连打，直到把对方打光
      const target = state.enemyFleet.cells.find((cell) => !state.playerShots[cell])
      state = target === undefined ? fire(state, enemyWaterCells(state)[0]!) : fire(state, target)
    }
    expect(gameStatus(state)).toBe('won')
    expect(selectAction(state, 0)).toBeNull()
    const legal = battleshipGame.legal(state)
    expect(legal.some((action) => action.type === 'fire')).toBe(false)
    expect(legal).toContainEqual({ type: 'undo' })
    expect(() => fire(state, 0)).toThrow(IllegalActionError)
    expect(gameStatus(reduceBattleship(state, { type: 'restart' }))).toBe('playing')
  })
})

describe('性能', () => {
  it('challenging 应手（含连打）< 500ms；单次 decode < 50ms', () => {
    let worstReply = 0
    let state = fresh(7, 'challenging')
    for (let turn = 0; turn < 12 && gameStatus(state) === 'playing'; turn++) {
      const target = state.enemyFleet.cells.find((cell) => !state.playerShots[cell])
      const shot = target ?? enemyWaterCells(state).find((cell) => !state.playerShots[cell])!
      const started = performance.now()
      state = fire(state, shot)
      const elapsed = performance.now() - started
      if (elapsed > worstReply) worstReply = elapsed
    }
    expect(worstReply).toBeLessThan(500)

    const decodedStart = performance.now()
    battleshipGame.decode(battleshipGame.encode(state))
    expect(performance.now() - decodedStart).toBeLessThan(50)
  })
})
