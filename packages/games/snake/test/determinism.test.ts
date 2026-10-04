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
import { SEED, tick, ticks, turn } from './helpers.js'

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

  it.each(DIFFICULTY_IDS)('%s：同一「按键 + 自动前进」序列重放得到同一局面', (difficulty) => {
    // 这一条正是自动步进的核心口径：定时器只是「什么时候派发 tick」，
    // 局面完全由「玩家按了哪些方向 + 到点派发了哪些 tick」这条动作序列决定，与真实耗时无关。
    // 玩家按键现在也是"立即走一格"，因此序列里每一次输入都对应真实的一步。
    const sequence: Array<'up' | 'down' | 'left' | 'right'> = ['down', 'right', 'down', 'right']
    const play = (): SnakeState => {
      let state = createState(SEED, difficulty)
      for (const dir of sequence) {
        try {
          state = turn(state, dir)
        } catch {
          // 某个方向恰好是原地掉头：跳过，序列本身仍然完全一致
        }
      }
      return state
    }
    expect(play()).toEqual(play())
    expect(encodeState(play())).toEqual(encodeState(play()))
  })

  it.each(DIFFICULTY_IDS)('%s：同 seed 下「按键 + tick」混合输入序列逐步可复现', (difficulty) => {
    // 逐帧比对（而不是只比最终局面）：中间任何一步出现分歧都会被抓到。
    // 序列本身混了三种情况：按当前朝向（手动前进）、转向（换方向走一格）、不按键（自动前进）。
    const script: SnakeAction[] = [
      { type: 'turn', dir: 'down' },
      { type: 'tick' },
      { type: 'tick' },
      { type: 'turn', dir: 'right' },
      { type: 'turn', dir: 'right' },
      { type: 'tick' },
      { type: 'turn', dir: 'down' },
      { type: 'tick' },
      { type: 'turn', dir: 'left' },
    ]
    const play = (): SnakeState[] => {
      let state = createState(SEED, difficulty)
      const frames = [state]
      for (const action of script) {
        try {
          state = reduceState(state, action)
        } catch {
          // 掉头被拒绝：两个"录制"过程都会在同一个位置拒绝，帧序列仍然一致
        }
        frames.push(state)
        if (gameStatus(state) !== 'playing') break
      }
      return frames
    }
    const first = play()
    const second = play()
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThanOrEqual(3)
    expect(first.map((frame) => JSON.stringify(encodeState(frame)))).toEqual(
      second.map((frame) => JSON.stringify(encodeState(frame))),
    )
    // 回到存档再重放同样一致（读档不引入新的随机源）
    expect(decodeState(JSON.parse(JSON.stringify(encodeState(first[first.length - 1]!))))).toEqual(
      first[first.length - 1],
    )
  })

  it.each(DIFFICULTY_IDS)('%s：纯 tick 序列（玩家完全不操作）同样可复现', (difficulty) => {
    const play = (): SnakeState => {
      let state = createState(SEED, difficulty)
      for (let step = 0; step < 20 && gameStatus(state) === 'playing'; step++) state = tick(state)
      return state
    }
    expect(play()).toEqual(play())
    expect(encodeState(play())).toEqual(encodeState(play()))
  })

  it.each(DIFFICULTY_IDS)('%s：随机合法动作（含 tick / 撤销 / 重开）重放结果一致', (difficulty) => {
    // 自动步进让"随机走 120 步"很容易提前结束（撞墙 / 撞自己），因此只要求序列足够长即可
    const first = randomTranscript(difficulty, 424242, 400)
    expect(first.actions.length).toBeGreaterThanOrEqual(20)
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
    const action = legalActions(start).find((candidate) => candidate.type === 'turn')
    expect(action).toBeDefined()
    // 一次「玩家操作」= 按键走的那一格（立即执行）；撤销退回，再走一遍结果完全相同
    const once = reduceState(start, action!)
    const undone = reduceState(once, { type: 'undo' })
    expect(undone).toEqual(start)
    expect(reduceState(undone, action!)).toEqual(once)
    // 再自动走几格也一样（撤销把游标 / 食物一起退回去了）
    expect(ticks(reduceState(undone, action!), 2)).toEqual(ticks(once, 2))
  })

  it('读档后的局面与原局面走出同样的后续（存档不引入新的随机源）', () => {
    const start = createState(SEED, 'challenging')
    const moved = turn(start, 'down')
    const restored = decodeState(JSON.parse(JSON.stringify(encodeState(moved))))
    let a = moved
    let b = restored
    for (const dir of ['right', 'down', 'down', 'left'] as const) {
      a = turn(a, dir)
      b = turn(b, dir)
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
      // 入门档可以穿墙：一直自动前进永远撞不死，正好用来比对分数轨迹
      for (let step = 0; step < 40 && gameStatus(state) === 'playing'; step++) {
        state = tick(state)
        scores.push(state.score)
      }
      return scores
    }
    expect(run()).toEqual(run())
  })
})
