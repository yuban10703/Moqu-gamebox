/**
 * 规则层测试：初始局面、离散步进、吃食物、失败、撤销、胜利。
 *
 * 边界局面全部**手工摆出来**（撞墙 / 撞障碍 / 撞自己 / 填满棋盘），
 * 而不是靠种子碰运气 —— 贪吃蛇的随机性只在食物与障碍位置上，摆好局面才能稳定复现。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, type MoveDir } from '@eink/core'
import {
  ALL_DIRS,
  DIR_DELTA,
  INITIAL_LENGTH,
  NO_FOOD,
  OPPOSITE_DIR,
  coordsOf,
  createState,
  directionOf,
  freeCellCount,
  gameStatus,
  indexOf,
  isLegal,
  legalActions,
  placeFood,
  reduceState,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultyOrThrow, difficultySpec } from '../src/meta.js'
import { SEED, cycleWithGap, hamiltonianCycle, stateWith } from './helpers.js'

const SIZE = 12
/** 初始蛇身在 12×12 下是 [78, 77, 76]：第 6 行、蛇头在 (6,6) 朝右 */
const HEAD = 78
const AHEAD = 79

/** 蛇头朝 dir 走一格的落点 */
function neighborOf(state: SnakeState, dir: MoveDir): number {
  const spec = difficultySpec(state.difficulty)
  const head = coordsOf(spec.size, state.body[0]!)
  const delta = DIR_DELTA[dir]
  return indexOf(spec.size, head.x + delta.dx, head.y + delta.dy)
}

/** 从候选方向里挑一个「不吃到食物、不撞障碍、不撞自己、也不是原地掉头」的 */
function pickFreeDir(state: SnakeState, dirs: readonly MoveDir[] = ALL_DIRS): MoveDir {
  const blocked = OPPOSITE_DIR[directionOf(state)]
  for (const dir of dirs) {
    if (dir === blocked) continue
    const cell = neighborOf(state, dir)
    if (state.obstacles.includes(cell) || state.body.includes(cell) || cell === state.food) continue
    return dir
  }
  throw new Error('测试局面里没有可走的方向')
}

describe('初始状态', () => {
  it.each(DIFFICULTY_IDS)('%s：蛇身、障碍、食物、计数都符合契约', (difficulty) => {
    const spec = difficultySpec(difficulty)
    const state = createState(SEED, difficulty)
    expect(state.difficulty).toBe(difficulty)
    expect(state.seed).toBe(SEED)
    expect(state.body).toHaveLength(INITIAL_LENGTH)
    expect(state.obstacles).toHaveLength(spec.obstacles)
    expect(state.score).toBe(0)
    expect(state.moves).toBe(0)
    expect(state.pending).toBe(0)
    expect(state.dead).toBe(false)
    expect(state.history).toEqual([])
    expect(state.cursor).toBe(spec.obstacles + 1)
    expect(gameStatus(state)).toBe('playing')
    expect(freeCellCount(state)).toBe(spec.size * spec.size - spec.obstacles - INITIAL_LENGTH)

    // 蛇身都在棋盘内、互不重复
    expect(new Set(state.body).size).toBe(state.body.length)
    for (const cell of state.body) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThan(spec.size * spec.size)
    }
    // 食物不在蛇身也不在障碍上
    expect(state.food).toBeGreaterThanOrEqual(0)
    expect(state.body).not.toContain(state.food)
    expect(state.obstacles).not.toContain(state.food)
    // 障碍升序且不与蛇身重叠
    expect([...state.obstacles].sort((a, b) => a - b)).toEqual([...state.obstacles])
    expect(state.obstacles.filter((cell) => state.body.includes(cell))).toEqual([])
  })

  it('初始朝向是右（由脖子指向蛇头推出，不需要额外字段）', () => {
    expect(directionOf(createState(SEED, 'skilled'))).toBe('right')
    expect(createState(SEED, 'skilled').body).toEqual([HEAD, HEAD - 1, HEAD - 2])
  })

  it('未知难度一律拒绝', () => {
    expect(() => createState(SEED, 'nope' as never)).toThrow(IllegalActionError)
    expect(() => difficultyOrThrow('nope')).toThrow(IllegalActionError)
  })

  it('初始局面里蛇头正前方是空的（开局第一步不会必死）', () => {
    const state = createState(SEED, 'challenging')
    expect(state.obstacles).not.toContain(AHEAD)
    expect(() => reduceState(state, { type: 'move', dir: 'right' })).not.toThrow()
  })
})

describe('离散步进与吃食物', () => {
  it('按一次方向键只走一格：蛇头到相邻格、蛇尾同时离开', () => {
    const before = createState(SEED, 'skilled')
    const after = reduceState(before, { type: 'move', dir: 'down' })
    expect(after.body[0]).toBe(neighborOf(before, 'down'))
    expect(after.body).toHaveLength(INITIAL_LENGTH) // 没吃到食物就不变长
    expect(after.moves).toBe(1)
    expect(after.history).toHaveLength(1)
    expect(after.dead).toBe(false)
    expect(gameStatus(after)).toBe('playing')
  })

  it('吃到食物：分数 +1、游标 +1、食物换到新的空格', () => {
    const before = stateWith('skilled', { food: AHEAD })
    const after = reduceState(before, { type: 'move', dir: 'right' })
    expect(after.body[0]).toBe(AHEAD)
    expect(after.score).toBe(1)
    expect(after.cursor).toBe(before.cursor + 1)
    expect(after.food).not.toBe(AHEAD)
    expect(after.body).not.toContain(after.food)
    expect(after.obstacles).not.toContain(after.food)
    // 吃到的那一步不掉尾：先记下待长节数，下一步才真正变长
    expect(after.pending).toBe(difficultySpec('skilled').growth)
    expect(after.body).toHaveLength(INITIAL_LENGTH)
  })

  it('入门/熟练档：吃一个食物长一节（下一步才长）', () => {
    const eaten = reduceState(stateWith('skilled', { food: AHEAD }), { type: 'move', dir: 'right' })
    expect(eaten.pending).toBe(difficultySpec('skilled').growth)
    const grown = reduceState(eaten, { type: 'move', dir: pickFreeDir(eaten) })
    expect(grown.pending).toBe(0)
    expect(grown.body).toHaveLength(INITIAL_LENGTH + 1)
  })

  it('挑战档：吃一个食物连长两节', () => {
    const spec = difficultySpec('challenging')
    expect(spec.growth).toBe(2)
    const fresh = createState(SEED, 'challenging')
    const dir = pickFreeDir(fresh, ['down', 'up'])
    // 把食物摆到蛇头正前方：直接吃
    const eaten = reduceState({ ...fresh, food: neighborOf(fresh, dir) }, { type: 'move', dir })
    expect(eaten.score).toBe(1)
    expect(eaten.pending).toBe(spec.growth)
    expect(eaten.body).toHaveLength(INITIAL_LENGTH) // 吃的那一步不掉尾，长度暂时不变
    const first = reduceState(eaten, { type: 'move', dir: pickFreeDir(eaten) })
    expect(first.body).toHaveLength(INITIAL_LENGTH + 1)
    expect(first.pending).toBe(1)
    const second = reduceState(first, { type: 'move', dir: pickFreeDir(first) })
    expect(second.body).toHaveLength(INITIAL_LENGTH + 2)
    expect(second.pending).toBe(0)
  })

  it('走进「这一步正好要离开的尾格」是合法的（尾已让开）', () => {
    // 头 (5,5)=65、脖子 (5,6)=77、(4,6)=76、尾 (4,5)=64：朝左走正好进尾格
    const before = stateWith('skilled', { body: [65, 77, 76, 64], food: 100, score: 1, cursor: 2 })
    const after = reduceState(before, { type: 'move', dir: 'left' })
    expect(after.dead).toBe(false)
    expect(after.body).toEqual([64, 65, 77, 76])
    expect(gameStatus(after)).toBe('playing')
  })
})

describe('非法动作被明确拒绝', () => {
  it('原地掉头：抛错、不在 legal 里、isLegal 为假', () => {
    const state = createState(SEED, 'skilled')
    expect(directionOf(state)).toBe('right')
    expect(() => reduceState(state, { type: 'move', dir: 'left' })).toThrow(IllegalActionError)
    expect(isLegal(state, { type: 'move', dir: 'left' })).toBe(false)
    expect(legalActions(state)).not.toContainEqual({ type: 'move', dir: 'left' })
    expect(legalActions(state).filter((action) => action.type === 'move')).toHaveLength(
      ALL_DIRS.length - 1,
    )
  })

  it('已经结束之后不能再走', () => {
    const alive = stateWith('skilled', { body: [5, 6, 7], food: 100 })
    const dead = reduceState(alive, { type: 'move', dir: 'up' })
    expect(gameStatus(dead)).toBe('lost')
    expect(() => reduceState(dead, { type: 'move', dir: 'right' })).toThrow(IllegalActionError)
    expect(legalActions(dead).some((action) => action.type === 'move')).toBe(false)
  })

  it('没有可撤销的步骤时撤销抛错（而不是静默返回原状态）', () => {
    const state = createState(SEED, 'skilled')
    expect(() => reduceState(state, { type: 'undo' })).toThrow(IllegalActionError)
    expect(isLegal(state, { type: 'undo' })).toBe(false)
  })

  it('未知动作抛错（壳层可能派发 nextLevel / startLevel）', () => {
    const state = createState(SEED, 'skilled')
    expect(() => reduceState(state, { type: 'nextLevel' } as never)).toThrow(IllegalActionError)
    expect(() => reduceState(state, { type: 'startLevel', levelId: 'x' } as never)).toThrow(
      IllegalActionError,
    )
  })
})

describe('失败：撞墙 / 撞障碍 / 撞自己', () => {
  it('实心墙档：从顶行再往上走即结束，蛇身保持不动', () => {
    const before = stateWith('skilled', { body: [5, 6, 7], food: 100 })
    const after = reduceState(before, { type: 'move', dir: 'up' })
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
    expect(after.moves).toBe(before.moves + 1)
    // 致命一步也能撤销：这正是玩家最想退回的时刻
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('穿墙档：同一局面从对边进来，仍然活着', () => {
    const before = stateWith('starter', { body: [5, 6, 7], food: 100 })
    const after = reduceState(before, { type: 'move', dir: 'up' })
    expect(after.dead).toBe(false)
    expect(gameStatus(after)).toBe('playing')
    expect(after.body[0]).toBe(indexOf(SIZE, coordsOf(SIZE, before.body[0]!).x, SIZE - 1))
  })

  it('挑战档：撞上场内障碍同样结束', () => {
    // 头 (5,5)=65 朝右，正下方 (5,6)=77 摆一块障碍
    const obstacles = [1, 2, 3, 77, 100, 101, 102, 103]
    const before = stateWith('challenging', {
      body: [65, 64, 63],
      obstacles,
      food: 120,
      cursor: obstacles.length + 1,
    })
    const after = reduceState(before, { type: 'move', dir: 'down' })
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
  })

  it('撞到自己（不是正要离开的尾格）即结束', () => {
    // 头 (5,5)=65、脖子 (5,6)=77、(4,6)=76、(4,5)=64、尾 (3,5)=63：朝左走撞到身体中段
    const before = stateWith('skilled', {
      body: [65, 77, 76, 64, 63],
      food: 100,
      score: 2,
      cursor: 3,
    })
    const after = reduceState(before, { type: 'move', dir: 'left' })
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('一直往上走必然撞墙（不依赖种子的自然走法）', () => {
    let state = createState(SEED, 'skilled')
    for (let step = 0; step < SIZE && gameStatus(state) === 'playing'; step++) {
      state = reduceState(state, { type: 'move', dir: 'up' })
    }
    expect(gameStatus(state)).toBe('lost')
    expect(state.moves).toBeLessThanOrEqual(SIZE + 1)
  })

  it('穿墙档同样步数不会撞墙（难度差异是规则差异，不是速度差异）', () => {
    const start = createState(SEED, 'starter')
    const steps = coordsOf(SIZE, start.body[0]!).y + 1
    let state = start
    for (let step = 0; step < steps; step++) {
      state = reduceState(state, { type: 'move', dir: 'up' })
    }
    expect(gameStatus(state)).toBe('playing')
    expect(coordsOf(SIZE, state.body[0]!).y).toBe(SIZE - 1)
  })
})

describe('撤销', () => {
  it('走一步再撤销，局面与初始完全一致（含游标与历史）', () => {
    const start = createState(SEED, 'skilled')
    const moved = reduceState(start, { type: 'move', dir: 'down' })
    expect(reduceState(moved, { type: 'undo' })).toEqual(start)
  })

  it('吃食物后撤销：食物、分数、游标、待长节数全部还原，再吃一次结果相同', () => {
    const before = stateWith('skilled', { food: AHEAD })
    const eaten = reduceState(before, { type: 'move', dir: 'right' })
    const back = reduceState(eaten, { type: 'undo' })
    expect(back).toEqual(before)
    expect(back.food).toBe(AHEAD)
    expect(back.score).toBe(0)
    expect(back.cursor).toBe(before.cursor)
    // 同种子同局面 → 同一个新食物
    expect(reduceState(back, { type: 'move', dir: 'right' }).food).toBe(eaten.food)
  })

  it('连走多步后逐步撤销能回到初始局面', () => {
    const start = createState(SEED, 'skilled')
    let state = start
    for (const dir of ['down', 'right', 'down', 'right', 'up'] as const) {
      state = reduceState(state, { type: 'move', dir })
    }
    expect(state.moves).toBe(5)
    for (let step = 0; step < 5; step++) state = reduceState(state, { type: 'undo' })
    expect(state).toEqual(start)
  })

  it('重开清空撤销栈并回到初始局面，之后撤销非法', () => {
    const start = createState(SEED, 'skilled')
    const moved = reduceState(reduceState(start, { type: 'move', dir: 'down' }), {
      type: 'move',
      dir: 'right',
    })
    const restarted = reduceState(moved, { type: 'restart' })
    expect(restarted).toEqual(start)
    expect(restarted.history).toEqual([])
    expect(() => reduceState(restarted, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('撤销栈只存逆操作：每条记录都只有几个数字，不复制整条蛇身', () => {
    let state = createState(SEED, 'skilled')
    for (let step = 0; step < 40 && gameStatus(state) === 'playing'; step++) {
      const action = legalActions(state).find((candidate) => candidate.type === 'move')
      if (!action || action.type !== 'move') break
      state = reduceState(state, action)
    }
    expect(state.history.length).toBe(state.moves)
    expect(state.moves).toBeGreaterThan(3)
    for (const entry of state.history) {
      for (const value of Object.values(entry)) expect(Array.isArray(value)).toBe(false)
    }
  })
})

describe('胜利：填满棋盘', () => {
  it('整块棋盘被蛇身填满 → won，且不再有合法移动', () => {
    const cycle = hamiltonianCycle(SIZE)
    expect(cycle).toHaveLength(SIZE * SIZE)
    const score = (SIZE * SIZE - INITIAL_LENGTH) / difficultySpec('skilled').growth
    const won = stateWith('skilled', { body: cycle, food: NO_FOOD, score, cursor: 1 + score })
    expect(freeCellCount(won)).toBe(0)
    expect(gameStatus(won)).toBe('won')
    expect(legalActions(won).some((action) => action.type === 'move')).toBe(false)
    expect(() => reduceState(won, { type: 'move', dir: 'down' })).toThrow(IllegalActionError)
  })

  it('吃掉最后一个空格 → won（食物变成「没有食物」）', () => {
    const { body } = cycleWithGap(SIZE, 13)
    const before = stateWith('skilled', {
      body,
      food: 13,
      // 还欠一节没长出来：这一步是「长身子」的步，蛇尾不动，因此棋盘正好被填满
      score: 141,
      pending: 1,
      cursor: 1 + 141,
    })
    expect(before.body).toHaveLength(SIZE * SIZE - 1)
    expect(gameStatus(before)).toBe('playing')
    const after = reduceState(before, { type: 'move', dir: 'up' })
    expect(after.body).toHaveLength(SIZE * SIZE)
    expect(after.score).toBe(142)
    expect(after.food).toBe(NO_FOOD)
    expect(gameStatus(after)).toBe('won')
  })

  it('没有空格时 placeFood 返回 NO_FOOD，但游标照常前进（保证不变量可校验）', () => {
    const spec = difficultySpec('skilled')
    const placed = placeFood(spec, hamiltonianCycle(SIZE), [], SEED, 7)
    expect(placed.food).toBe(NO_FOOD)
    expect(placed.cursor).toBe(8)
  })

  it('棋盘未满时绝不会出现「没有食物」', () => {
    const state = createState(SEED, 'skilled')
    expect(state.food).not.toBe(NO_FOOD)
    expect(freeCellCount(state)).toBeGreaterThan(0)
  })
})
