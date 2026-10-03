/**
 * 白方 AI 测试：三档难度每手合法、可复现，以及「优先吃格 / 优先安全边 / 弃子最少」的战术口径。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  WHITE,
  applyClaim,
  boxIndexAt,
  boxesCompletedBy,
  chooseEdge,
  configFor,
  dotsboxesGame,
  edgesOfBox,
  emptyState,
  openEdges,
  threesAfterClaim,
  type DotsBoxesState,
  type DifficultyId,
} from '../src/index.js'
import { claimedEdgesOfBox, customState } from './helpers.js'

const DIFFICULTIES: DifficultyId[] = ['starter', 'skilled', 'challenging']

/** 用随机黑方 + 指定难度的白方走若干回合，收集过程中的真实局面 */
function sampleStates(difficulty: DifficultyId, plies = 12): DotsBoxesState[] {
  const rng = createRng(20240607)
  const states: DotsBoxesState[] = []
  let state = emptyState(20240607, difficulty)
  for (let step = 0; step < plies; step++) {
    const edges = openEdges(state)
    if (edges.length === 0) break
    states.push(state)
    state = dotsboxesGame.reduce(state, { type: 'claim', index: edges[rng.int(edges.length)]! })
  }
  return states
}

describe('每手合法且可复现', () => {
  it('三档难度对多个真实局面都给出未画的边，且能被 applyClaim 接受', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const state of sampleStates(difficulty)) {
        // 只测白方视角：把轮次改成白方（真实的中间局面轮次是黑方）
        const white: DotsBoxesState = { ...state, turn: WHITE }
        const chosen = chooseWhite(white)
        expect(openEdges(white)).toContain(chosen)
        expect(() => applyClaim(white, chosen)).not.toThrow()
      }
    }
  })

  it('同 seed + 同局面 ⇒ 同一条边（三档都可复现）', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const state of sampleStates(difficulty, 8)) {
        const white: DotsBoxesState = { ...state, turn: WHITE }
        for (const cursor of [0, 1, 5]) {
          const first = chooseWhiteWith(white, cursor)
          const second = chooseWhiteWith(white, cursor)
          expect(first, `${difficulty} cursor ${cursor}`).toBe(second)
        }
      }
    }
  })

  it('starter 会用种子/游标给出不同的选择（不是恒定一条边）', () => {
    const white: DotsBoxesState = { ...emptyState(0, 'starter'), turn: WHITE }
    const chosen = new Set<number>()
    for (let cursor = 0; cursor < 12; cursor++) chosen.add(chooseWhiteWith(white, cursor))
    expect(chosen.size).toBeGreaterThan(1)
  })
})

describe('战术口径', () => {
  it('能立刻占格时必须吃（starter 是纯随机，skilled / challenging 必须吃）', () => {
    const difficulty: DifficultyId = 'starter'
    const config = configFor(difficulty)
    const box = boxIndexAt(1, 1, config)
    const edges = edgesOfBox(box, config)
    const state = customState(difficulty, { claimed: edges.slice(0, 3), turn: WHITE })
    for (const level of ['skilled', 'challenging'] as const) {
      const chosen = chooseWhiteWith(state, 0, level)
      expect(boxesCompletedBy(state, chosen), level).toContain(box)
    }
    // starter 只保证合法
    expect(openEdges(state)).toContain(chooseWhiteWith(state, 0, 'starter'))
  })

  it('有安全边时不送三边格；没有安全边时挑弃子最少的', () => {
    const difficulty: DifficultyId = 'starter'
    const config = configFor(difficulty)
    const box = boxIndexAt(0, 0, config)
    const boxEdges = edgesOfBox(box, config)
    // 只画了两条边：再画其中任意一条都会造出「三边格」，但棋盘上还有大量安全边
    const state = customState(difficulty, { claimed: boxEdges.slice(0, 2), turn: WHITE })
    const safe = openEdges(state).filter((edge) => threesAfterClaim(state, edge).length === 0)
    expect(safe.length).toBeGreaterThan(0)
    for (const level of ['skilled', 'challenging'] as const) {
      const chosen = chooseWhiteWith(state, 0, level)
      expect(threesAfterClaim(state, chosen).length, level).toBe(0)
      expect(safe, level).toContain(chosen)
    }
  })

  it('所有边都会送三边格时，选送出最少的那条', () => {
    const difficulty: DifficultyId = 'starter'
    const config = configFor(difficulty)
    // 把棋盘画到只剩少量边，且这些边都会造出三边格：用真实对局构造太慢，
    // 这里直接摆一个「多个方格都只差一条边」的局面
    const boxes = [
      boxIndexAt(0, 0, config),
      boxIndexAt(0, 1, config),
      boxIndexAt(1, 0, config),
      boxIndexAt(1, 1, config),
    ]
    const claimed = new Set<number>()
    for (const box of boxes) {
      for (const edge of claimedEdgesOfBox(box, 3, difficulty)) claimed.add(edge)
    }
    const state = customState(difficulty, { claimed: [...claimed], turn: WHITE })
    // 有能立刻占格的边时当然先吃，这里验证的是「没得吃」时的弃子选择
    const capture = openEdges(state).some((edge) => boxesCompletedBy(state, edge).length > 0)
    if (!capture) {
      const dangers = openEdges(state).map((edge) => threesAfterClaim(state, edge).length)
      const minDanger = Math.min(...dangers)
      const chosen = chooseWhiteWith(state, 0, 'skilled')
      expect(threesAfterClaim(state, chosen).length).toBe(minDanger)
    } else {
      // 局面里确实能吃：AI 应该去吃
      const chosen = chooseWhiteWith(state, 0, 'skilled')
      expect(boxesCompletedBy(state, chosen).length).toBeGreaterThan(0)
    }
  })

  it('白方永远画自己的边（不替黑方画）', () => {
    const state = { ...emptyState(3, 'skilled'), turn: WHITE }
    const edge = chooseWhiteWith(state, 0)
    expect(applyClaim(state, edge).edges[edge]).toBe(WHITE)
  })
})

describe('性能', () => {
  it('challenging 应手（含连走）< 500ms', () => {
    let worst = 0
    for (const state of sampleStates('challenging', 20)) {
      // 造一个轮到黑方的局面：黑方随便画一条，reduce 内部会跑白方应手
      const edges = openEdges(state)
      if (edges.length === 0) continue
      const started = performance.now()
      dotsboxesGame.reduce(state, { type: 'claim', index: edges[0]! })
      const elapsed = performance.now() - started
      if (elapsed > worst) worst = elapsed
    }
    expect(worst).toBeLessThan(500)
  })
})

// --- 测试内的便捷包装：直接调用 AI（规则层内部也是这么调的） -------------------------

function chooseWhite(state: DotsBoxesState, difficulty: DifficultyId = state.difficulty): number {
  return chooseEdge({ ...state, turn: WHITE }, difficulty, createRng(0))
}

function chooseWhiteWith(
  state: DotsBoxesState,
  cursor: number,
  difficulty: DifficultyId = state.difficulty,
): number {
  return chooseEdge({ ...state, turn: WHITE }, difficulty, createRng(20240607 + cursor))
}
