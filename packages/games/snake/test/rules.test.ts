/**
 * 规则层测试：初始局面、自动前进（tick）、**立即转向**、吃食物、失败、撤销、胜利。
 *
 * 边界局面全部**手工摆出来**（撞墙 / 撞障碍 / 撞自己 / 填满棋盘），
 * 而不是靠种子碰运气 —— 贪吃蛇的随机性只在食物与障碍位置上，摆好局面才能稳定复现。
 *
 * 本轮的语义变化（用户反馈：「延迟太高了，点按钮后应该立即换向，而不是等固定延迟」）：
 * - 前进有两条路径，规则完全一样：`{ type: 'tick' }`（壳层定时器到点派发，沿当前朝向）
 *   与 `{ type: 'turn', dir }`（玩家按下方向键，改朝向并**当帧**走一格）；
 * - 唯一的差别是撤销记录上的 `auto` 标记：tick 带、玩家按键不带；
 * - **没有缓冲槽**：「上→左」连点就是先走一格再走一格，两步都生效、不会丢输入；
 * - 转向撞上墙 / 障碍 / 自己 = 当场结束（和自动爬过去同一条规则），但可用撤销退回；
 * - 撤销 = 退回**玩家上一次操作之前**（自动前进的那几格一起退回）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IllegalActionError, MIN_TICK_MS, type MoveDir } from '@eink/core'
import {
  ALL_DIRS,
  DIR_DELTA,
  INITIAL_LENGTH,
  MAX_HISTORY_ENTRIES,
  NO_FOOD,
  OPPOSITE_DIR,
  canUndo,
  coordsOf,
  createState,
  decodeState,
  directionOf,
  encodeState,
  freeCellCount,
  gameStatus,
  indexOf,
  isAutoEntry,
  isLegal,
  isSkippedByUndo,
  legalActions,
  placeFood,
  reduceState,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultyOrThrow, difficultySpec } from '../src/meta.js'
import { snakeGame } from '../src/index.js'
import { SEED, cycleWithGap, hamiltonianCycle, stateWith, tick, ticks, turn } from './helpers.js'

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
    expect(state.trimmed).toBe(false)
    expect(state.history).toEqual([])
    // 状态里没有「待生效的方向」：转向是立即执行的，不需要缓冲槽
    expect(Object.keys(state)).not.toContain('pendingDir')
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

  it('初始局面里蛇头正前方是空的（开局第一格不会必死）', () => {
    const state = createState(SEED, 'challenging')
    expect(state.obstacles).not.toContain(AHEAD)
    expect(() => tick(state)).not.toThrow()
  })
})

describe('自动前进（tick）', () => {
  it('一次 tick 前进一格：蛇头到相邻格、蛇尾同时离开，方向 = 当前朝向', () => {
    const before = createState(SEED, 'skilled')
    const after = tick(before)
    expect(after.body[0]).toBe(neighborOf(before, 'right'))
    expect(after.body).toHaveLength(INITIAL_LENGTH) // 没吃到食物就不变长
    expect(after.moves).toBe(1)
    expect(after.dead).toBe(false)
    expect(gameStatus(after)).toBe('playing')
  })

  it('连续 tick 一直朝同一方向走，直到撞墙（不依赖任何玩家输入）', () => {
    const start = createState(SEED, 'skilled')
    const head = coordsOf(SIZE, start.body[0]!)
    const untilWall = SIZE - 1 - head.x // 蛇头右侧还剩几格
    let state = ticks(start, untilWall)
    expect(state.dead).toBe(false)
    expect(coordsOf(SIZE, state.body[0]!).x).toBe(SIZE - 1)
    // 再走一格就出界
    state = tick(state)
    expect(state.dead).toBe(true)
    expect(gameStatus(state)).toBe('lost')
    expect(state.moves).toBe(untilWall + 1)
  })

  it('已经结束之后 tick 抛错（壳层据此安全停表）', () => {
    const crashed = turn(stateWith('skilled', { body: [5, 6, 7], food: 100 }), 'up')
    expect(gameStatus(crashed)).toBe('lost')
    expect(() => tick(crashed)).toThrow(IllegalActionError)
    expect(isLegal(crashed, { type: 'tick' })).toBe(false)
  })

  it('回归：老存档里的手动「走一格」动作已不存在（动作名是 turn / tick）', () => {
    const state = createState(SEED, 'skilled')
    expect(() => reduceState(state, { type: 'move', dir: 'right' } as never)).toThrow(
      IllegalActionError,
    )
  })
})

describe('立即转向：按下方向键当帧就走一格', () => {
  it('转向本身就走一格：不需要任何 tick，action 之后局面立刻改变', () => {
    const before = createState(SEED, 'skilled')
    const after = turn(before, 'down')
    // 这就是用户要的语义：reduce 返回时蛇头已经在新方向上，而不是"记下方向等下一格"
    expect(after.body[0]).toBe(neighborOf(before, 'down'))
    expect(after.moves).toBe(before.moves + 1)
    expect(directionOf(after)).toBe('down')
    expect(gameStatus(after)).toBe('playing')
    // 尾巴同时离开，长度不变（没吃到食物）
    expect(after.body).toHaveLength(INITIAL_LENGTH)
    expect(after.body).not.toContain(before.body[before.body.length - 1])
  })

  it('连续快速点两个方向不丢输入：上 → 左 = 真的先上一格、再左一格', () => {
    const before = createState(SEED, 'skilled')
    const up = turn(before, 'up')
    const left = turn(up, 'left')
    expect(up.body[0]).toBe(neighborOf(before, 'up'))
    expect(left.body[0]).toBe(neighborOf(up, 'left'))
    expect(directionOf(left)).toBe('left')
    expect(left.moves).toBe(before.moves + 2)
    // 两步都是玩家操作（撤销时会整段退回，而不是只退掉最后一步）
    expect(left.history.map((entry) => isAutoEntry(entry))).toEqual([false, false])
  })

  it('按当前朝向 = 手动往前走一格（不能用来把蛇按住不动）', () => {
    const before = createState(SEED, 'skilled')
    const straight = turn(before, 'right') // 初始朝向就是右
    expect(straight.body[0]).toBe(neighborOf(before, 'right'))
    expect(straight.moves).toBe(before.moves + 1)
    expect(directionOf(straight)).toBe('right')
    // 连点同一个方向 = 连续前进
    expect(turn(straight, 'right').body[0]).toBe(neighborOf(straight, 'right'))
  })

  it('原地掉头（相对当前朝向）非法：局面与步数都不变，也不会写进历史', () => {
    const state = createState(SEED, 'skilled')
    expect(directionOf(state)).toBe('right')
    expect(() => turn(state, 'left')).toThrow(IllegalActionError)
    expect(isLegal(state, { type: 'turn', dir: 'left' })).toBe(false)
    expect(legalActions(state)).not.toContainEqual({ type: 'turn', dir: 'left' })
    expect(
      legalActions(state).filter((action) => action.type === 'turn'),
    ).toHaveLength(ALL_DIRS.length - 1)
    expect(state.moves).toBe(0)
    expect(state.history).toEqual([])
  })

  it('刚转向之后立刻按反方向同样非法（判定基准永远是当前朝向，不是上一步的朝向）', () => {
    // 朝右 → 按上（蛇头已经在上方、朝向变成上）→ 再按下就是掉头，必须被拒绝
    const turned = turn(createState(SEED, 'skilled'), 'up')
    expect(directionOf(turned)).toBe('up')
    expect(() => turn(turned, 'down')).toThrow(IllegalActionError)
    // 垂直方向仍然随便转
    expect(directionOf(turn(turned, 'left'))).toBe('left')
  })

  it('已经结束之后不能转向', () => {
    const dead = turn(stateWith('skilled', { body: [5, 6, 7], food: 100 }), 'up')
    expect(gameStatus(dead)).toBe('lost')
    expect(() => turn(dead, 'right')).toThrow(IllegalActionError)
  })
})

describe('立即转向会撞上去时：当场结束（与自动前进同一条规则）', () => {
  it('按向墙：当场死亡、蛇身不动、这一步算玩家操作（撤销能退回）', () => {
    const before = stateWith('skilled', { body: [5, 6, 7], food: 100 }) // 头 (5,0) 朝左
    const after = turn(before, 'up') // 上方出界
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body) // 撞死时蛇头不进入墙里
    expect(after.moves).toBe(before.moves + 1)
    // 关键：这一步不带 auto，因此撤销按钮可点、一次撤销就回到按下之前
    expect(isAutoEntry(after.history[after.history.length - 1]!)).toBe(false)
    expect(isSkippedByUndo(after.history[after.history.length - 1]!)).toBe(false)
    expect(canUndo(after)).toBe(true)
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('按向自己的身体：同样当场结束，且撤销回得去', () => {
    // 头 (5,5)=65、脖子 (5,6)=77、(4,6)=76、(4,5)=64、尾 (3,5)=63：朝左按就是撞身体中段
    const before = stateWith('skilled', {
      body: [65, 77, 76, 64, 63],
      food: 100,
      score: 2,
      cursor: 3,
    })
    const after = turn(before, 'left')
    expect(after.dead).toBe(true)
    expect(after.body).toEqual(before.body)
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('按向场内障碍：同样当场结束（挑战档）', () => {
    const obstacles = [1, 2, 3, 77, 100, 101, 102, 103]
    const before = stateWith('challenging', {
      body: [65, 64, 63],
      obstacles,
      food: 120,
      cursor: obstacles.length + 1,
    })
    const after = turn(before, 'down') // 正下方 (5,6)=77 是障碍
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
  })

  it('穿墙档：按向边界不是死，而是从对边进来', () => {
    const before = stateWith('starter', { body: [5, 6, 7], food: 100 })
    const after = turn(before, 'up')
    expect(after.dead).toBe(false)
    expect(after.body[0]).toBe(indexOf(SIZE, coordsOf(SIZE, before.body[0]!).x, SIZE - 1))
  })

  it('走进「这一步正好要离开的尾格」不算撞自己（尾已让开）', () => {
    // 头 (5,5)=65、脖子 (5,6)=77、(4,6)=76、尾 (4,5)=64：朝左走正好进尾格
    const before = stateWith('skilled', { body: [65, 77, 76, 64], food: 100, score: 1, cursor: 2 })
    const after = turn(before, 'left')
    expect(after.dead).toBe(false)
    expect(after.body).toEqual([64, 65, 77, 76])
    expect(gameStatus(after)).toBe('playing')
  })
})

describe('吃食物', () => {
  it('吃到食物：分数 +1、游标 +1、食物换到新的空格', () => {
    const before = stateWith('skilled', { food: AHEAD })
    const after = turn(before, 'right')
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
    const eaten = turn(stateWith('skilled', { food: AHEAD }), 'right')
    expect(eaten.pending).toBe(difficultySpec('skilled').growth)
    const grown = turn(eaten, pickFreeDir(eaten))
    expect(grown.pending).toBe(0)
    expect(grown.body).toHaveLength(INITIAL_LENGTH + 1)
  })

  it('挑战档：吃一个食物连长两节', () => {
    const spec = difficultySpec('challenging')
    expect(spec.growth).toBe(2)
    const fresh = createState(SEED, 'challenging')
    const dir = pickFreeDir(fresh, ['down', 'up'])
    // 把食物摆到蛇头正前方：直接吃
    const eaten = turn({ ...fresh, food: neighborOf(fresh, dir) }, dir)
    expect(eaten.score).toBe(1)
    expect(eaten.pending).toBe(spec.growth)
    expect(eaten.body).toHaveLength(INITIAL_LENGTH) // 吃的那一步不掉尾，长度暂时不变
    const first = turn(eaten, pickFreeDir(eaten))
    expect(first.body).toHaveLength(INITIAL_LENGTH + 1)
    expect(first.pending).toBe(1)
    const second = turn(first, pickFreeDir(first))
    expect(second.body).toHaveLength(INITIAL_LENGTH + 2)
    expect(second.pending).toBe(0)
  })

  it('走进「这一步正好要离开的尾格」是合法的（尾已让开）', () => {
    // 头 (5,5)=65、脖子 (5,6)=77、(4,6)=76、尾 (4,5)=64：朝左走正好进尾格
    const before = stateWith('skilled', { body: [65, 77, 76, 64], food: 100, score: 1, cursor: 2 })
    const after = turn(before, 'left')
    expect(after.dead).toBe(false)
    expect(after.body).toEqual([64, 65, 77, 76])
    expect(gameStatus(after)).toBe('playing')
  })
})

describe('非法动作被明确拒绝', () => {
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
    const after = turn(before, 'up')
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
    expect(after.moves).toBe(before.moves + 1)
    // 致命一步也能撤销：这正是玩家最想退回的时刻（连转向一起退回）
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('穿墙档：同一局面从对边进来，仍然活着', () => {
    const before = stateWith('starter', { body: [5, 6, 7], food: 100 })
    const after = turn(before, 'up')
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
    const after = turn(before, 'down')
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
    const after = turn(before, 'left')
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('一直朝上（靠自动前进）必然撞墙，不依赖种子的自然走法', () => {
    let state = createState(SEED, 'skilled')
    state = turn(state, 'up')
    for (let step = 0; step < SIZE && gameStatus(state) === 'playing'; step++) state = tick(state)
    expect(gameStatus(state)).toBe('lost')
    expect(state.moves).toBeLessThanOrEqual(SIZE + 1)
  })

  it('穿墙档同样步数不会撞墙（难度差异是规则差异，不只是速度差异）', () => {
    const start = createState(SEED, 'starter')
    // 玩家先按上走一格，再让它自动爬到顶行并从对边进来（穿墙档不会撞墙）
    const turned = turn(start, 'up')
    const steps = coordsOf(SIZE, turned.body[0]!).y + 1
    let state = turned
    for (let step = 0; step < steps; step++) state = tick(state)
    expect(gameStatus(state)).toBe('playing')
    expect(coordsOf(SIZE, state.body[0]!).y).toBe(SIZE - 1)
  })
})

describe('撤销：退回玩家上一次操作之前', () => {
  it('转向 + 走三格后撤销：一次撤销回到转向之前（不是只退半格）', () => {
    const start = createState(SEED, 'skilled')
    const after = ticks(turn(start, 'down'), 3)
    expect(after.moves).toBe(4)
    const back = reduceState(after, { type: 'undo' })
    expect(back).toEqual(start)
  })

  it('一次按键（立即走一格）+ 撤销 = 精确回到按下之前', () => {
    const start = createState(SEED, 'skilled')
    const moved = turn(start, 'down')
    expect(moved.moves).toBe(1)
    expect(reduceState(moved, { type: 'undo' })).toEqual(start)
  })

  it('连续两次撤销 = 退回上上次操作之前（自动前进整段回退）', () => {
    const start = createState(SEED, 'skilled')
    const first = turn(start, 'down') // 玩家操作 1：按下 = 立即走一格
    const second = ticks(turn(first, 'right'), 2) // 玩家操作 2：再按一次 + 自动走两格
    const once = reduceState(second, { type: 'undo' })
    expect(once).toEqual(first)
    const twice = reduceState(once, { type: 'undo' })
    expect(twice).toEqual(start)
  })

  it('自动前进的记录带 auto 标记，玩家操作不带（撤销据此分段）', () => {
    const state = ticks(turn(createState(SEED, 'skilled'), 'down'), 2)
    expect(state.history.map((entry) => isAutoEntry(entry))).toEqual([false, true, true])
  })

  it('吃食物后撤销：食物、分数、游标、待长节数全部还原，再吃一次结果相同', () => {
    const before = stateWith('skilled', { food: AHEAD })
    const eaten = turn(before, 'right')
    const back = reduceState(eaten, { type: 'undo' })
    expect(back).toEqual(before)
    expect(back.food).toBe(AHEAD)
    expect(back.score).toBe(0)
    expect(back.cursor).toBe(before.cursor)
    // 同种子同局面 → 同一个新食物
    expect(turn(back, 'right').food).toBe(eaten.food)
  })

  it('玩家一次操作都没做过时撤销按钮不可点（只有自动前进可退）', () => {
    const state = ticks(createState(SEED, 'starter'), 3)
    expect(state.history.length).toBeGreaterThan(0)
    expect(canUndo(state)).toBe(false)
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)
  })

  it('重开清空撤销栈并回到初始局面，之后撤销非法', () => {
    const start = createState(SEED, 'skilled')
    const moved = ticks(turn(start, 'down'), 2)
    const restarted = reduceState(moved, { type: 'restart' })
    expect(restarted).toEqual(start)
    expect(restarted.history).toEqual([])
    expect(() => reduceState(restarted, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('撤销栈只存逆操作：每条记录都只有几个数字，不复制整条蛇身', () => {
    let state = createState(SEED, 'skilled')
    for (let step = 0; step < 40 && gameStatus(state) === 'playing'; step++) {
      const action = legalActions(state).find((candidate) => candidate.type === 'tick')
      if (!action) break
      state = reduceState(state, action)
    }
    expect(state.moves).toBeGreaterThan(3)
    for (const entry of state.history) {
      for (const value of Object.values(entry)) expect(Array.isArray(value)).toBe(false)
    }
  })
})

describe('撤销栈封顶（自动步进不能把存档撑爆）', () => {
  /** 穿墙档 + 没有障碍：斜着来回转向可以无限走下去（不会撞墙也不会撞到自己） */
  function endless(): SnakeState {
    return stateWith('starter', { body: [100, 101, 102], food: 5 })
  }

  /** 每回合「玩家转向 + 自动前进一格」：既持续产生自动记录，也不断留下玩家操作边界 */
  function zigzag(state: SnakeState, rounds: number): SnakeState {
    let next = state
    for (let round = 0; round < rounds; round++) {
      next = tick(turn(next, round % 2 === 0 ? 'up' : 'right'))
    }
    return next
  }

  it('超过上限后裁剪，并且裁到一条玩家操作上（栈底不是自动步进）', () => {
    const state = zigzag(endless(), MAX_HISTORY_ENTRIES + 40)
    expect(state.history.length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES)
    expect(state.trimmed).toBe(true)
    expect(isSkippedByUndo(state.history[0]!)).toBe(false)
    expect(canUndo(state)).toBe(true)
  })

  it('裁剪之后仍然能一次撤销回上一条玩家操作（不是退回半格）', () => {
    const state = zigzag(endless(), MAX_HISTORY_ENTRIES + 5)
    // 最后一条是自动前进，它前面才是玩家操作（按键走的那一格）
    expect(state.history[state.history.length - 1]!.kind).toBe('step')
    expect(isAutoEntry(state.history[state.history.length - 1]!)).toBe(true)
    const back = reduceState(state, { type: 'undo' })
    // 一次撤销至少退掉「最后一段自动前进 + 那条玩家操作」，因此步数与栈长都明显回退
    expect(back.moves).toBeLessThan(state.moves)
    expect(back.history.length).toBeLessThanOrEqual(state.history.length - 2)
    expect(canUndo(back)).toBe(true)
    // 撤销后的局面照样能存档往返
    expect(decodeState(JSON.parse(JSON.stringify(encodeState(back))))).toEqual(back)
  })

  it('裁剪过的存档步数大于撤销栈长度，且 decode 认这个状态', () => {
    const state = zigzag(endless(), MAX_HISTORY_ENTRIES + 5)
    expect(state.moves).toBeGreaterThan(state.history.length)
    const restored = decodeState(JSON.parse(JSON.stringify(encodeState(state))))
    expect(restored).toEqual(state)
    expect(restored.trimmed).toBe(true)
  })
})

describe('自动步进的声明：规则层零时间引用', () => {
  it('源码里没有定时器与 Math.random / Date.now（间隔由壳层会话驱动）', () => {
    for (const name of ['rules.ts', 'view.ts', 'index.ts', 'meta.ts']) {
      const text = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
      // 先去掉注释：本项目注释里到处写着"没有定时器"，直接 grep 会全部误报
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, name).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|performance\.now/)
      expect(code, name).not.toMatch(/Math\.random|Date\.now/)
    }
  })

  it('tickMs 是纯函数：同局面同间隔、不低于 400ms 硬下限、结束后返回 null', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = createState(SEED, difficulty)
      const declared = snakeGame.tickMs!(state, difficulty)
      expect(declared).toBe(difficultySpec(difficulty).tickMs)
      expect(declared!).toBeGreaterThanOrEqual(MIN_TICK_MS)
      // 纯函数：只由 state 决定，跟调用时刻无关
      expect(snakeGame.tickMs!(state, difficulty)).toBe(declared)
    }
    // 结束之后必须返回 null —— 壳层据此停表（用没有障碍的 skilled 档填满棋盘）
    const score = (SIZE * SIZE - INITIAL_LENGTH) / difficultySpec('skilled').growth
    const won = stateWith('skilled', {
      body: hamiltonianCycle(SIZE),
      food: NO_FOOD,
      score,
      cursor: 1 + score,
    })
    expect(gameStatus(won)).toBe('won')
    expect(snakeGame.tickMs!(won, 'skilled')).toBeNull()
  })

  it('三档间隔**完全相同**：统一 500ms，且不低于 400ms 硬下限', () => {
    /*
     * 用户要求"不同难度的延迟应该统一"：难度差异一律由**规则**承担
     * （穿墙 / 障碍 / 每食长两节），不由手速承担。这条用例钉住三件事，
     * 任何一件被破坏都要红 —— 而不是只检查"大于 0"那种放水判据。
     */
    const declared = DIFFICULTY_IDS.map((id) => difficultySpec(id).tickMs)
    // 1) 三档一模一样（差 1ms 都算没统一，不是"三个相近的值"）
    expect(new Set(declared).size).toBe(1)
    expect(declared).toEqual([500, 500, 500])
    // 2) 统一值就是选定的 500ms：BOOX 整屏刷新实测约 2 次/秒，500ms 正好卡在
    //    "不产生残影"的边界上。这里写死字面量：改 meta.ts 必须同时改这里，
    //    不允许节奏悄悄漂移（"我们选定的值"是需求的一部分）。
    expect(declared[0]).toBe(500)
    // 3) 不低于 core 的硬下限 —— 且统一值**不靠壳层钳位兜底**：
    //    声明 300ms 会被钳回 400ms，但那是"不诚实的声明"，这条就是拦住它的。
    expect(MIN_TICK_MS).toBe(400)
    expect(declared[0]).toBeGreaterThanOrEqual(MIN_TICK_MS)
    for (const id of DIFFICULTY_IDS) {
      // 每个难度**自己声明的**值都达标，并且与壳层实际拿到的值一致
      expect(difficultySpec(id).tickMs).toBeGreaterThanOrEqual(MIN_TICK_MS)
      expect(snakeGame.tickMs!(createState(SEED, id), id)).toBe(declared[0])
    }
    /*
     * 4) "统一"在源码层面也成立：三档引用的是**同一个具名常量**，
     *    而不是三处各写一个恰好相等的字面量（那样任何一个档位被单独改掉时，
     *    值相等断言仍可能因为"改回同一个数"而看不出结构被破坏）。
     */
    const meta = readFileSync(new URL('../src/meta.ts', import.meta.url), 'utf8')
    expect(meta).toMatch(/const SNAKE_TICK_MS\s*=\s*500\b/)
    expect(meta.match(/tickMs:\s*SNAKE_TICK_MS\b/g) ?? []).toHaveLength(DIFFICULTY_IDS.length)
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
    expect(legalActions(won).some((action) => action.type === 'turn')).toBe(false)
    expect(legalActions(won).some((action) => action.type === 'tick')).toBe(false)
    expect(() => tick(won)).toThrow(IllegalActionError)
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
    const after = turn(before, 'up')
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
