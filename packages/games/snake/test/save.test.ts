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
  canUndo,
  createState,
  decodeState,
  directionOf,
  encodeState,
  gameStatus,
  legalActions,
  reduceState,
  type EncodedSnakeState,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultySpec } from '../src/meta.js'
import { SEED, hamiltonianCycle, stateWith, tick, turn } from './helpers.js'

const SIZE = 12
/** 初始蛇身在 12×12 下是 [78, 77, 76]：第 6 行、蛇头在 (6,6) 朝右 */
const HEAD = 78
const AHEAD = 79

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
    const alive = stateWith('skilled', { body: [5, 6, 7], food: 100 })
    const dead = turn(alive, 'up') // 按下方向键立即走一格，出界即撞墙
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

  it('pendingDir / trimmed 缺失时照常读：老存档不判损坏，缓冲字段不再进状态', () => {
    const raw = encoded(createState(SEED, 'skilled'))
    const legacy = { ...raw, pendingDir: undefined, trimmed: undefined }
    const restored = decodeState(legacy)
    expect(restored.trimmed).toBe(false)
    expect(restored).toEqual(createState(SEED, 'skilled'))
    // 转向现在立即执行：状态里没有"待生效的方向"这个字段（连键都不存在）
    expect(Object.keys(restored)).not.toContain('pendingDir')
  })

  it('老存档里的 pendingDir（哪怕写的是一个方向）照常读，只是不再有"下一个 tick 生效"的语义', () => {
    const raw = encoded(createState(SEED, 'skilled'))
    // 旧版本里 'up' 表示"下一个 tick 转向上"；新版本 tick 只沿当前朝向走，因此这一格照常直行
    const legacy = { ...raw, pendingDir: 'up' }
    const restored = decodeState(legacy)
    expect(restored).toEqual(createState(SEED, 'skilled'))
    expect(directionOf(restored)).toBe('right')
    expect(tick(restored).body[0]).toBe(restored.body[0]! + 1) // 直行，不拐弯
    // 旧存档里"缓冲方向是掉头"也是合法数据（新语义下它根本不被读），不再判成损坏
    expect(() => decodeState({ ...raw, pendingDir: 'left' })).not.toThrow()
  })

  it('老存档里的「只转向不移动」记录：能读、能往返，撤销时被跳过（不会点了没反应）', () => {
    const raw = encoded(createState(SEED, 'skilled'))
    const legacy = {
      ...raw,
      moves: 1,
      body: [AHEAD, HEAD, HEAD - 1],
      history: [
        { kind: 'turn', pendingDir: 'down', moves: 0 }, // 旧语义：只写缓冲、不移动
        { kind: 'step', tail: HEAD - 2, food: raw.food, cursor: raw.cursor, score: 0, pending: 0, moves: 0, auto: true },
      ],
    }
    const restored = decodeState(legacy)
    expect(restored.history.map((entry) => entry.kind)).toEqual(['turn', 'step'])
    expect(restored.moves).toBe(1)
    // 那条转向记录在新语义下不改变任何局面：它不算"玩家操作"，撤销要跳过它去退真正的那一步
    const back = reduceState(restored, { type: 'undo' })
    expect(back.body).toEqual([HEAD, HEAD - 1, HEAD - 2])
    expect(back.moves).toBe(0)
    // 再存档一次：老的 turn 记录原样写回，局面仍然一致
    const again = decodeState(JSON.parse(JSON.stringify(encodeState(restored))))
    expect(again).toEqual(restored)
  })

  it('老存档里的撤销记录没有 auto 字段 → 一律当成玩家操作（撤销语义与旧版一致）', () => {
    const raw = encoded(createState(SEED, 'skilled'))
    const legacy = {
      ...raw,
      moves: 1,
      body: [...raw.body],
      history: [
        { kind: 'step', tail: 76, food: raw.food, cursor: raw.cursor, score: 0, pending: 0, moves: 0 },
      ],
    }
    const restored = decodeState(legacy)
    expect(restored.history[0]!.kind === 'step' && restored.history[0]!.auto).toBeFalsy()
    expect(canUndo(restored)).toBe(true)
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
    // 老字段仍然要校验形状：乱码值说明存档被改过（但"是掉头方向"不再是错误，见上面的旧档兼容测试）
    ['缓冲方向不是合法方向', { ...base(), pendingDir: 'sideways' }],
    [
      'auto 标记不是布尔',
      { ...base(), moves: 1, history: [{ kind: 'death', moves: 0, auto: 'yes' }] },
    ],
    ['trimmed 标记不是布尔', { ...base(), trimmed: 'yes' }],
    [
      '撤销栈里非转向记录多于步数',
      {
        ...base(),
        moves: 1,
        history: [
          { kind: 'step', tail: null, food: base().food, cursor: base().cursor, score: 0, pending: 0, moves: 0 },
          { kind: 'step', tail: null, food: base().food, cursor: base().cursor, score: 0, pending: 0, moves: 1 },
          { kind: 'turn', pendingDir: 'up', moves: 2 },
        ],
      },
    ],
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
