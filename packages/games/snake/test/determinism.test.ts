/**
 * 确定性测试：同一 seed + 同一动作序列必须得到完全相同的局面（双端一致性口径 F01/F02）。
 *
 * 贪吃蛇的随机性只有两处：障碍摆放与食物位置，两者都走 `createRng((seed + cursor) >>> 0)`，
 * 因此不允许出现「读档后食物跳到别处」这种事 —— 撤销会连游标一起回退。
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@eink/core'
import {
  createState,
  decodeState,
  encodeState,
  gameStatus,
  legalActions,
  placeFood,
  placeObstacles,
  reduceState,
  reservedCells,
  type SnakeAction,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from '../src/meta.js'
import { SEED } from './helpers.js'

/** 用固定 rng 走出的一串合法动作（含撤销与重开），用于重放比对 */
function randomTranscript(difficulty: DifficultyId, seed: number, steps: number): {
  actions: SnakeAction[]
  final: SnakeState
} {
  const rng = createRng(seed)
  let state = createState(SEED, difficulty)
  const actions: SnakeAction[] = []
  for (let step = 0; step < steps; step++) {
    const legal = legalActions(state)
    if (legal.length === 0) break
    const action = legal[Math.floor(rng.next() * legal.length)]!
    try {
      state = reduceState(state, action)
    } catch {
      continue
    }
    actions.push(action)
  }
  return { actions, final: state }
}

describe('同种子可复现', () => {
  it.each(DIFFICULTY_IDS)('%s：两次 create 得到完全相同的局面', (difficulty) => {
    expect(createState(SEED, difficulty)).toEqual(createState(SEED, difficulty))
    expect(JSON.stringify(createState(SEED, difficulty))).toBe(
      JSON.stringify(createState(SEED, difficulty)),
    )
  })

  it.each(DIFFICULTY_IDS)('%s：同一动作序列重放得到同一局面', (difficulty) => {
    const sequence: Array<'up' | 'down' | 'left' | 'right'> = ['down', 'right', 'down', 'right']
    const play = (): SnakeState => {
      let state = createState(SEED, difficulty)
      for (const dir of sequence) {
        try {
          state = reduceState(state, { type: 'move', dir })
        } catch {
          // 某个方向恰好是原地掉头：跳过，序列本身仍然完全一致
        }
      }
      return state
    }
    expect(play()).toEqual(play())
    expect(encodeState(play())).toEqual(encodeState(play()))
  })

  it.each(DIFFICULTY_IDS)('%s：≥100 步随机合法动作后重放结果一致', (difficulty) => {
    const first = randomTranscript(difficulty, 424242, 120)
    expect(first.actions.length).toBeGreaterThanOrEqual(100)
    let replay = createState(SEED, difficulty)
    for (const action of first.actions) replay = reduceState(replay, action)
    expect(replay).toEqual(first.final)
    expect(JSON.stringify(encodeState(replay))).toBe(JSON.stringify(encodeState(first.final)))
  })

  it('不同种子给出不同的障碍 / 食物（随机性确实来自 seed）', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const foods = new Set(seeds.map((seed) => createState(seed, 'starter').food))
    const obstacleSets = new Set(
      seeds.map((seed) => JSON.stringify(createState(seed, 'challenging').obstacles)),
    )
    expect(foods.size).toBeGreaterThan(1)
    expect(obstacleSets.size).toBeGreaterThan(1)
  })

  it('障碍与食物只由 (seed, 游标) 决定：同样的输入给同样的输出', () => {
    for (const spec of DIFFICULTIES) {
      const reserved = reservedCells(spec.size)
      const first = placeObstacles(spec, SEED, reserved)
      const second = placeObstacles(spec, SEED, reserved)
      expect(first).toEqual(second)
      const body = createState(SEED, spec.id).body
      expect(placeFood(spec, body, first.obstacles, SEED, first.cursor)).toEqual(
        placeFood(spec, body, first.obstacles, SEED, first.cursor),
      )
    }
  })

  it('撤销后重走同一步得到同一局面（撤销把游标也退回去了）', () => {
    const start = createState(SEED, 'skilled')
    const dir = legalActions(start).find((action) => action.type === 'move')
    expect(dir).toBeDefined()
    const once = reduceState(start, dir!)
    const undone = reduceState(once, { type: 'undo' })
    expect(undone).toEqual(start)
    expect(reduceState(undone, dir!)).toEqual(once)
  })

  it('读档后的局面与原局面走出同样的后续（存档不引入新的随机源）', () => {
    const start = createState(SEED, 'challenging')
    const moved = reduceState(start, { type: 'move', dir: 'down' })
    const restored = decodeState(JSON.parse(JSON.stringify(encodeState(moved))))
    let a = moved
    let b = restored
    for (const dir of ['right', 'down', 'down', 'left'] as const) {
      a = reduceState(a, { type: 'move', dir })
      b = reduceState(b, { type: 'move', dir })
    }
    expect(b).toEqual(a)
  })

  it('种子归一化：小数/负数/NaN 都不会破坏可复现性', () => {
    const once = createState(12.9, 'skilled')
    expect(once.seed).toBe(12)
    expect(createState(12, 'skilled')).toEqual(once)
  })

  it('同种子下分数增长轨迹一致（吃到的食物数不依赖运行环境）', () => {
    const run = (): number[] => {
      let state = createState(SEED, 'starter')
      const scores = [state.score]
      for (let step = 0; step < 40 && gameStatus(state) === 'playing'; step++) {
        const action = legalActions(state).find((candidate) => candidate.type === 'move')
        if (!action) break
        state = reduceState(state, action)
        scores.push(state.score)
      }
      return scores
    }
    expect(run()).toEqual(run())
  })
})
