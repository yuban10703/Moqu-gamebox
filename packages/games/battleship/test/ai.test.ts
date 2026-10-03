/**
 * 白方 AI 测试：三档难度每手合法（不会打已打过的格）、可复现，以及 hunt / target / 延伸的口径。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  CELLS,
  DIFFICULTY_IDS,
  colOf,
  chooseShot,
  huntCells,
  lineExtensionCells,
  rowOf,
  targetCells,
  unresolvedShips,
  type BattleshipState,
  type DifficultyId,
} from '../src/index.js'
import { fresh } from './helpers.js'

function withEnemyShots(state: BattleshipState, cells: readonly number[]): BattleshipState {
  const marks = new Set(cells)
  return { ...state, enemyShots: state.enemyShots.map((_, index) => marks.has(index)) }
}

/** 独立算一个格的正交四邻 */
function orthogonalNeighbors(index: number): number[] {
  const row = rowOf(index)
  const col = colOf(index)
  const out: number[] = []
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const r = row + dr
    const c = col + dc
    if (r < 0 || r >= 8 || c < 0 || c >= 8) continue
    out.push(r * 8 + c)
  }
  return out
}

/** 走进若干回合，收集真实局面 */
function sampleStates(difficulty: DifficultyId): BattleshipState[] {
  const rng = createRng(20240607)
  const states: BattleshipState[] = []
  let state = fresh(20240607, difficulty)
  for (let turn = 0; turn < 8; turn++) {
    states.push(state)
    // 玩家随机挑一个没打过的格（可能命中也可能空，用来造出各种白方局面）
    const untried: number[] = []
    for (let index = 0; index < CELLS; index++) if (!state.playerShots[index]) untried.push(index)
    if (untried.length === 0) break
    state = { ...state, turn: 'player' }
    const fired = untried[rng.int(untried.length)]!
    // 直接改射击记录构造局面（不走规则层，只是为了给 AI 各种输入）
    state = { ...state, playerShots: state.playerShots.map((_, index) => index === fired || state.playerShots[index]) }
    if (!state.enemyFleet.mask[fired]) break
  }
  return states
}

describe('每手合法且可复现', () => {
  it('三档难度在多组种子/局面上都只打没打过的格', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 6; seed++) {
        const state = fresh(seed, difficulty)
        for (let cursor = 0; cursor < 4; cursor++) {
          const shot = chooseShot(state, difficulty, createRng(seed + cursor))
          expect(state.enemyShots[shot], `${difficulty} seed ${seed} cursor ${cursor}`).toBe(false)
          expect(shot).toBeGreaterThanOrEqual(0)
          expect(shot).toBeLessThan(CELLS)
        }
      }
      for (const state of sampleStates(difficulty)) {
        const shot = chooseShot(state, difficulty, createRng(1))
        expect(state.enemyShots[shot]).toBe(false)
      }
    }
  })

  it('同 seed + 同局面 ⇒ 同一手（三档都可复现）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const state of sampleStates(difficulty)) {
        for (const cursor of [0, 3, 9]) {
          const first = chooseShot(state, difficulty, createRng(cursor))
          const second = chooseShot(state, difficulty, createRng(cursor))
          expect(first, `${difficulty} cursor ${cursor}`).toBe(second)
        }
      }
    }
  })

  it('starter 会用随机流给出不同的选择（不是恒定一格）', () => {
    const state = fresh(0, 'starter')
    const chosen = new Set<number>()
    for (let cursor = 0; cursor < 16; cursor++) chosen.add(chooseShot(state, 'starter', createRng(cursor)))
    expect(chosen.size).toBeGreaterThan(1)
  })
})

describe('hunt / target 口径', () => {
  it('没有命中时按「隔格扫描」打（只打行列同色的格）', () => {
    const state = fresh(2024, 'skilled')
    const misses: number[] = []
    for (let index = 0; index < CELLS && misses.length < 6; index++) {
      if (!state.playerFleet.mask[index]) misses.push(index)
    }
    const noHits = withEnemyShots(state, misses)
    for (const difficulty of ['skilled', 'challenging'] as const) {
      const shot = chooseShot(noHits, difficulty, createRng(0))
      expect(noHits.enemyShots[shot]).toBe(false)
      expect((rowOf(shot) + colOf(shot)) % 2, `${difficulty} 应该在隔格扫描`).toBe(0)
      expect(huntCells(noHits)).toContain(shot)
    }
  })

  it('有命中时集火四邻', () => {
    for (const difficulty of ['skilled', 'challenging'] as const) {
      for (let seed = 0; seed < 5; seed++) {
        const state = fresh(seed, difficulty === 'skilled' ? 'starter' : 'skilled')
        const ship = state.playerFleet.ships.find((item) => item.length >= 3)!
        const hit = ship.cells[0]!
        const hitState = withEnemyShots(state, [hit])
        expect(unresolvedShips(hitState).map((item) => item.id)).toContain(ship.id)
        const shot = chooseShot(hitState, difficulty, createRng(seed))
        // 命中格的竖邻/横邻里，属于该舰的下一个格也一定是候选（集火）
        expect(orthogonalNeighbors(hit), `${difficulty} seed ${seed}`).toContain(shot)
        expect(targetCells(hitState)).toContain(shot)
      }
    }
  })

  it('challenging 会沿命中线延伸（skilled 只保证打在四邻）', () => {
    for (let seed = 0; seed < 6; seed++) {
      const state = fresh(seed, 'challenging')
      const ship = state.playerFleet.ships.find((item) => !item.horizontal && item.length >= 3)
      if (!ship) continue
      const hits = [ship.cells[0]!, ship.cells[1]!]
      const hitState = withEnemyShots(state, hits)
      const shot = chooseShot(hitState, 'challenging', createRng(seed))
      // 竖舰的两个相邻命中 → 下一手应当沿同一条竖线延伸（两端之一）
      const forward = ship.cells[2]!
      const backward = ship.cells[0]! - 8
      const candidates = [forward, backward].filter((cell) => cell >= 0 && !hitState.enemyShots[cell])
      expect(candidates, `seed ${seed}`).toContain(shot)
      expect(lineExtensionCells(hitState)).toContain(shot)
    }
  })

  it('已击沉的舰不再被集火（只剩它时回到扫格）', () => {
    const state = fresh(7, 'skilled')
    const ship = state.playerFleet.ships[0]!
    const sunk = withEnemyShots(state, ship.cells)
    expect(unresolvedShips(sunk)).toHaveLength(0)
    expect(targetCells(sunk)).toEqual([])
    const shot = chooseShot(sunk, 'skilled', createRng(0))
    expect(ship.cells).not.toContain(shot)
    expect((rowOf(shot) + colOf(shot)) % 2).toBe(0)
  })

  it('打满 64 格后没有可打的格 → 抛错（不会死循环或返回非法格）', () => {
    const state = fresh(1, 'starter')
    const full = withEnemyShots(
      state,
      Array.from({ length: CELLS }, (_, index) => index),
    )
    expect(() => chooseShot(full, 'skilled', createRng(0))).toThrow()
  })
})

describe('性能', () => {
  it('challenging 单次选格 < 50ms（应手整回合另有 game 测试把关）', () => {
    const state = fresh(3, 'challenging')
    const started = performance.now()
    for (let cursor = 0; cursor < 50; cursor++) chooseShot(state, 'challenging', createRng(cursor))
    const perCall = (performance.now() - started) / 50
    expect(perCall).toBeLessThan(50)
  })
})
