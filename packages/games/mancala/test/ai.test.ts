/**
 * 白方 AI 测试：三档难度每手合法、可复现，以及「连走优先 / 吃子优先」的战术口径。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  BLACK,
  DIFFICULTY_IDS,
  WHITE,
  choosePit,
  greedyScore,
  legalPits,
  mancalaGame,
  sowOnce,
  type DifficultyId,
  type MancalaState,
} from '../src/index.js'
import { fresh, withCells } from './helpers.js'

const WHITE_PITS = [1, 2, 3, 4, 5, 6]

/** 走进若干回合，收集真实局面（黑方随机） */
function sampleStates(difficulty: DifficultyId): MancalaState[] {
  const rng = createRng(20240607)
  const states: MancalaState[] = []
  let state = fresh(20240607, difficulty)
  for (let turn = 0; turn < 6; turn++) {
    states.push(state)
    const legal = [7, 8, 9, 10, 11, 12].filter((pit) => (state.cells[pit] ?? 0) > 0)
    if (legal.length === 0) break
    state = mancalaGame.reduce(state, { type: 'sow', index: legal[rng.int(legal.length)]! })
  }
  return states
}

/** 构造一个「轮到白方」的局面：白坑按 overrides 覆盖，其余白坑清零 */
function whiteTurn(overrides: ReadonlyArray<readonly [number, number]>, blackPits?: ReadonlyArray<readonly [number, number]>): MancalaState {
  const base = withCells(
    [
      ...WHITE_PITS.map((pit) => [pit, 0] as const),
      ...(blackPits ?? []),
    ],
    WHITE,
  )
  const cells = [...base.cells]
  for (const [index, count] of overrides) cells[index] = count
  return { ...base, cells, turn: WHITE }
}

describe('每手合法且可复现', () => {
  it('三档难度在多组种子/局面下都只选自己合法的非空坑', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (let seed = 0; seed < 8; seed++) {
        const state = fresh(seed, difficulty)
        for (let cursor = 0; cursor < 4; cursor++) {
          const pit = choosePit(state, difficulty, createRng(seed + cursor))
          expect(state.turn, '起始局面轮到黑方').toBe(BLACK)
          expect(legalPits(state, state.turn)).toContain(pit)
          expect(state.cells[pit]).toBeGreaterThan(0)
          expect(() => sowOnce(state, pit)).not.toThrow()
        }
      }
      for (const state of sampleStates(difficulty)) {
        const pit = choosePit(state, difficulty, createRng(1))
        expect(legalPits(state, state.turn)).toContain(pit)
      }
    }
  })

  it('同 seed + 同局面 ⇒ 同一手（三档都可复现）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const state of sampleStates(difficulty)) {
        for (const cursor of [0, 2, 7]) {
          expect(choosePit(state, difficulty, createRng(cursor)), `${difficulty} ${cursor}`).toBe(
            choosePit(state, difficulty, createRng(cursor)),
          )
        }
      }
    }
  })

  it('starter 会用随机流给出不同的选择（不是恒定一坑）', () => {
    const state = fresh(0, 'starter')
    const chosen = new Set<number>()
    for (let cursor = 0; cursor < 24; cursor++) chosen.add(choosePit(state, 'starter', createRng(cursor)))
    expect(chosen.size).toBeGreaterThan(1)
  })
})

describe('战术口径', () => {
  it('skilled：能连走就连走（优先于吃子）', () => {
    // 白坑1 只有 1 颗 → 下一格正好是白仓 0（连走）；白坑2 有 4 颗 → 落黑坑8，不连走
    const state = whiteTurn([
      [1, 1],
      [2, 4],
    ])
    const pit = choosePit(state, 'skilled', createRng(0))
    expect(sowOnce(state, pit).extraTurn).toBe(true)
    expect(pit).toBe(1)
    expect(greedyScore(state, 1)).toBe(2)
    expect(greedyScore(state, 2)).toBe(0)
  })

  it('skilled：没有连走机会时能吃就吃', () => {
    // 白坑4 放 1 颗 → 下一格是空的白坑3 → 吃对面黑坑10；白坑2 播 4 颗不连走也不吃
    const state = whiteTurn(
      [
        [4, 1],
        [2, 4],
      ],
      [[10, 4]],
    )
    const pit = choosePit(state, 'skilled', createRng(0))
    const result = sowOnce(state, pit)
    expect(result.captured).toBeGreaterThan(0)
    expect(pit).toBe(4)
  })

  it('challenging：在同样的局面上也能找到连走与吃子', () => {
    const chainState = whiteTurn([
      [1, 1],
      [2, 4],
    ])
    expect(sowOnce(chainState, choosePit(chainState, 'challenging', createRng(0))).extraTurn).toBe(true)
    const captureState = whiteTurn(
      [
        [4, 1],
        [2, 4],
      ],
      [[10, 4]],
    )
    expect(
      sowOnce(captureState, choosePit(captureState, 'challenging', createRng(0))).captured,
    ).toBeGreaterThan(0)
  })

  it('白方只在自己那行选坑（不会替黑方播种）', () => {
    const state = fresh(3, 'skilled')
    const pit = choosePit(state, 'skilled', createRng(0))
    expect([7, 8, 9, 10, 11, 12]).toContain(pit)
    expect(() => sowOnce({ ...state, turn: BLACK }, pit)).not.toThrow()
  })
})

describe('性能', () => {
  it('challenging 单次选坑 < 50ms（整回合应手另有 game 测试把关）', () => {
    const state = fresh(3, 'challenging')
    const started = performance.now()
    for (let cursor = 0; cursor < 30; cursor++) choosePit(state, 'challenging', createRng(cursor))
    expect((performance.now() - started) / 30).toBeLessThan(50)
  })
})
