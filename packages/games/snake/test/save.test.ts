/**
 * 存档测试：往返一致、撤销栈进存档、缺字段的兼容、损坏存档必须被拒绝。
 *
 * 对应契约里的两条硬要求：
 * - 游戏自己走出来的**任何**局面都必须能被自己的 decode 接受（跨游戏契约测试同款口径）；
 * - 被篡改 / 截断的存档必须抛错，让壳层明确告诉用户「存档已损坏」，而不是带着半个局面继续玩。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import {
  INITIAL_LENGTH,
  NO_FOOD,
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  reduceState,
  type EncodedSnakeState,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultySpec } from '../src/meta.js'
import { SEED, hamiltonianCycle } from './helpers.js'

const SIZE = 12

function encoded(state: SnakeState): EncodedSnakeState {
  return JSON.parse(JSON.stringify(encodeState(state))) as EncodedSnakeState
}

function roundTrip(state: SnakeState): SnakeState {
  return decodeState(encoded(state))
}

describe('存档往返', () => {
  it.each(DIFFICULTY_IDS)('%s：初始局面往返完全一致', (difficulty) => {
    const state = createState(SEED, difficulty)
    expect(roundTrip(state)).toEqual(state)
    // 再编码一次也必须完全相同（decode 不会重新摆障碍或食物）
    expect(encoded(roundTrip(state))).toEqual(encoded(state))
  })

  it('随机走 60 步（含撤销与重开），每一步都能往返', () => {
    const rng = createRng(SEED)
    for (const difficulty of DIFFICULTY_IDS) {
      let state = createState(SEED, difficulty)
      for (let step = 0; step < 60; step++) {
        expect(roundTrip(state)).toEqual(state)
        const actions = legalActions(state)
        if (actions.length === 0) break
        const action = actions[Math.floor(rng.next() * actions.length)]!
        try {
          state = reduceState(state, action)
        } catch {
          continue
        }
      }
      // 走完一轮后仍然自洽
      expect(roundTrip(state)).toEqual(state)
    }
  })

  it('撞死之后的状态照样能存能读（dead 与撤销栈一起进存档）', () => {
    const alive = createState(SEED, 'skilled')
    let dead = alive
    while (gameStatus(dead) === 'playing') dead = reduceState(dead, { type: 'move', dir: 'up' })
    expect(gameStatus(dead)).toBe('lost')
    const restored = roundTrip(dead)
    expect(restored).toEqual(dead)
    expect(restored.dead).toBe(true)
    // 读回来的局面必须还能撤销回撞上之前
    expect(gameStatus(reduceState(restored, { type: 'undo' }))).toBe('playing')
  })

  it('撤销栈不装整盘快照：填满棋盘的存档仍然很小', () => {
    const cycle = hamiltonianCycle(SIZE)
    const score = (SIZE * SIZE - INITIAL_LENGTH) / difficultySpec('skilled').growth
    const state = decodeState({
      ...encoded(createState(SEED, 'skilled')),
      body: cycle,
      food: NO_FOOD,
      score,
      cursor: 1 + score,
    })
    expect(gameStatus(state)).toBe('won')
    // 144 格的蛇身 + 全部字段（没有历史）远小于「每步一份快照」的量级
    expect(JSON.stringify(encodeState(state)).length).toBeLessThan(1200)
  })
})

describe('缺字段的存档（旧档兼容）', () => {
  it('history 缺失或为 null 时按空栈处理，不判成损坏', () => {
    const raw = encoded(createState(SEED, 'challenging'))
    const withoutHistory = { ...raw, history: undefined }
    const nullHistory = { ...raw, history: null }
    expect(decodeState(withoutHistory).history).toEqual([])
    expect(decodeState(nullHistory).history).toEqual([])
    // 即使步数不为 0 也照样能读（撤销栈只是「没有」，不是「不一致」）
    const moved = { ...withoutHistory, moves: 3 }
    expect(decodeState(moved).moves).toBe(3)
  })
})

describe('损坏的存档必须被拒绝', () => {
  const base = (): EncodedSnakeState => encoded(createState(SEED, 'challenging'))

  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['数组', []],
    ['字符串', 'snake'],
    ['空对象', {}],
    ['未知难度', { ...base(), difficulty: 'nightmare' }],
    ['种子为负', { ...base(), seed: -1 }],
    ['种子超范围', { ...base(), seed: 0x1_0000_0000 }],
    ['蛇身为空', { ...base(), body: [] }],
    ['蛇身出现重复格', { ...base(), body: [0, 0, 0] }],
    ['蛇身越界', { ...base(), body: [0, 1, 999] }],
    ['蛇身不连续', { ...base(), body: [0, 1, 50] }],
    ['障碍数量不对', { ...base(), obstacles: [3] }],
    ['障碍未排序', { ...base(), obstacles: [9, 3, 4, 5, 6, 7, 8, 10] }],
    ['障碍压在蛇身上', { ...base(), obstacles: [78, 3, 4, 5, 6, 7, 8, 10] }],
    ['食物越界', { ...base(), food: 999 }],
    ['食物压在蛇身上', { ...base(), food: 78 }],
    ['食物压在障碍上', { ...base(), food: base().obstacles[0]! }],
    ['棋盘没满却没有食物', { ...base(), food: NO_FOOD }],
    ['蛇长与分数 / 待长节数不符', { ...base(), score: 5 }],
    ['游标与分数不符', { ...base(), cursor: 99 }],
    ['步数与撤销栈长度不符', { ...base(), moves: 2 }],
    ['撤销栈不是数组', { ...base(), history: {} }],
    ['撤销栈条目类型不对', { ...base(), moves: 1, history: [{ kind: 'nope', moves: 0 }] }],
    [
      '撤销栈尾格越界',
      { ...base(), moves: 1, history: [{ kind: 'step', tail: 999, food: 1, cursor: 9, score: 0, pending: 0, moves: 0 }] },
    ],
    [
      '撤销栈食物越界',
      { ...base(), moves: 1, history: [{ kind: 'step', tail: null, food: -5, cursor: 9, score: 0, pending: 0, moves: 0 }] },
    ],
    [
      '撤销栈负数字段',
      { ...base(), moves: 1, history: [{ kind: 'step', tail: null, food: 1, cursor: -1, score: 0, pending: 0, moves: 0 }] },
    ],
    ['dead 与撤销栈末条不一致', { ...base(), dead: true }],
    [
      '末条是 death 但 dead 为假',
      {
        ...base(),
        moves: 1,
        dead: false,
        history: [{ kind: 'death', moves: 0 }],
      },
    ],
    [
      '末条是 step 却标记 dead',
      {
        ...base(),
        moves: 1,
        dead: true,
        history: [{ kind: 'step', tail: null, food: 1, cursor: 9, score: 0, pending: 0, moves: 0 }],
      },
    ],
  ]

  it.each(cases)('%s → 抛 IllegalActionError', (_name, raw) => {
    expect(() => decodeState(raw)).toThrow(IllegalActionError)
  })

  it('棋盘填满却还留着食物：食物必然压在蛇身上，因此同样被拒绝', () => {
    const cycle = hamiltonianCycle(SIZE)
    const score = (SIZE * SIZE - INITIAL_LENGTH) / difficultySpec('skilled').growth
    const raw = { ...encoded(createState(SEED, 'skilled')), body: cycle, score, cursor: 1 + score }
    expect(raw.food).not.toBe(NO_FOOD)
    expect(() => decodeState(raw)).toThrow(IllegalActionError)
  })

  it('合法存档不会被误伤（对照组）', () => {
    expect(() => decodeState(base())).not.toThrow()
  })
})
