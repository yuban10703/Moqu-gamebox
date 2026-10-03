/**
 * 白方 AI 测试：三档难度每手合法、可复现，以及「成三优先 / 挡对方成三」的战术口径。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  BLACK,
  WHITE,
  applyAction,
  chooseAction,
  gameStatus,
  ninemensGame,
  rawActions,
  removablePoints,
  type DifficultyId,
  type NinemensState,
} from '../src/index.js'
import { fixture, fresh, invariantProblems } from './helpers.js'

const DIFFICULTIES: DifficultyId[] = ['starter', 'skilled', 'challenging']

/** 走进若干回合，收集真实局面 */
function sampleStates(difficulty: DifficultyId, plies = 8): NinemensState[] {
  const rng = createRng(20240607)
  const states: NinemensState[] = []
  let state = fresh(20240607, difficulty)
  for (let ply = 0; ply < plies && gameStatus(state) === 'playing'; ply++) {
    states.push(state)
    const actions = rawActions(state)
    if (actions.length === 0) break
    state = ninemensGame.reduce(state, actions[rng.int(actions.length)]!)
  }
  return states
}

/** 把局面交给白方（AI 内部按 state.turn 行棋，这里统一换成白方行棋） */
function whiteToMove(state: NinemensState): NinemensState {
  return { ...state, turn: WHITE }
}

describe('每手合法且可复现', () => {
  it('三档难度在多组种子/局面下都只选合法动作', () => {
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 0; seed < 6; seed++) {
        const state = fresh(seed, difficulty)
        for (let cursor = 0; cursor < 3; cursor++) {
          const action = chooseAction(state, difficulty, createRng(seed + cursor))
          expect(rawActions(state)).toContainEqual(action)
          expect(() => applyAction(state, action)).not.toThrow()
        }
      }
      for (const state of sampleStates(difficulty)) {
        const white = whiteToMove(state)
        if (gameStatus(white) !== 'playing') continue
        const action = chooseAction(white, difficulty, createRng(3))
        expect(rawActions(white)).toContainEqual(action)
      }
    }
  })

  it('同 seed + 同局面 ⇒ 同一手（三档都可复现）', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const state of sampleStates(difficulty, 6)) {
        const white = whiteToMove(state)
        if (gameStatus(white) !== 'playing') continue
        for (const cursor of [0, 2, 5]) {
          expect(chooseAction(white, difficulty, createRng(cursor))).toEqual(
            chooseAction(white, difficulty, createRng(cursor)),
          )
        }
      }
    }
  })

  it('starter 会用随机流给出不同的选择（不是恒定一手）', () => {
    const state = fresh(0, 'starter')
    const keys = new Set<string>()
    for (let cursor = 0; cursor < 24; cursor++) {
      keys.add(JSON.stringify(chooseAction(state, 'starter', createRng(cursor))))
    }
    expect(keys.size).toBeGreaterThan(1)
  })
})

describe('战术口径', () => {
  it('能成三就成三（skilled / challenging）', () => {
    // 白方在 [0,1]，行 0 的线是 [0,1,2]：落 2 即成一三
    const state = fixture([8, 9, 10, 11], [0, 1], {
      turn: WHITE,
      inHand: { black: 5, white: 7 },
    })
    for (const difficulty of ['skilled', 'challenging'] as const) {
      const action = chooseAction(state, difficulty, createRng(0))
      expect(action).toEqual({ type: 'place', index: 2 })
      const after = applyAction(state, action).state
      expect(after.pendingRemove).toBe(1)
    }
  })

  it('不能成三时优先挡对方成三（skilled）', () => {
    // 黑方在 [0,1]（行 0 的线 [0,1,2]，第三点 2 空着 = 威胁）
    // 白方在 [8,11]：这两点所在的线都只差 2 颗子，白方自己一步成不了三
    const state = fixture([0, 1], [8, 11], {
      turn: WHITE,
      inHand: { black: 7, white: 7 },
    })
    const action = chooseAction(state, 'skilled', createRng(0))
    expect(action).toEqual({ type: 'place', index: 2 })
    // 挡住之后黑方不再有「一步成三」的落点
    const after = applyAction(state, action).state
    const blackMillMoves = rawActions({ ...after, turn: BLACK, pendingRemove: 0 }).filter(
      (candidate) => candidate.type === 'place' && candidate.index === 2,
    )
    expect(blackMillMoves).toHaveLength(0)
  })

  it('待吃子时只吃可吃的对方子', () => {
    const state = fixture([8, 9, 10, 11], [0, 1, 2, 12], {
      turn: WHITE,
      inHand: { black: 5, white: 5 },
      pendingRemove: 1,
    })
    const removable = removablePoints(state, BLACK)
    for (const difficulty of DIFFICULTIES) {
      const action = chooseAction(state, difficulty, createRng(1))
      expect(action).toEqual({ type: 'remove', index: removable[0] })
    }
  })

  it('challenging 不会自杀：在「只剩 3 子」的飞子期也能给出合法动作', () => {
    const state = fixture([0, 8, 16], [1, 2, 3], {
      turn: WHITE,
      inHand: { black: 0, white: 0 },
      removed: { black: 6, white: 6 },
    })
    // 白方也只剩 3 子 → 进入飞子期，应当可以飞到任意空点
    const action = chooseAction(state, 'challenging', createRng(0))
    expect(rawActions(state)).toContainEqual(action)
    expect(invariantProblems(applyAction(state, action).state)).toEqual([])
  })
})

describe('性能', () => {
  it('challenging 单次选点 < 100ms（实测量级 20ms；整回合应手另有 game 测试把关）', () => {
    const state = fresh(3, 'challenging')
    const started = performance.now()
    for (let cursor = 0; cursor < 10; cursor++) chooseAction(state, 'challenging', createRng(cursor))
    expect((performance.now() - started) / 10).toBeLessThan(100)
  })
})
