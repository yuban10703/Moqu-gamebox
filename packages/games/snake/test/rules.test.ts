/**
 * 规则层测试：初始局面、自动前进（tick）、转向缓冲、吃食物、失败、撤销、胜利。
 *
 * 边界局面全部**手工摆出来**（撞墙 / 撞障碍 / 撞自己 / 填满棋盘），
 * 而不是靠种子碰运气 —— 贪吃蛇的随机性只在食物与障碍位置上，摆好局面才能稳定复现。
 *
 * 本轮的语义变化（用户要求「贪吃蛇要自动前进」）：
 * - 前进只有一条路径：`{ type: 'tick' }`（壳层定时器到点派发），方向 = 缓冲方向或当前朝向；
 * - `{ type: 'turn', dir }` = 玩家转向，写入**单槽缓冲**，下一个 tick 生效；
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
  legalActions,
  placeFood,
  reduceState,
  type SnakeState,
} from '../src/rules.js'
import { DIFFICULTY_IDS, difficultyOrThrow, difficultySpec } from '../src/meta.js'
import { snakeGame } from '../src/index.js'
import { SEED, cycleWithGap, hamiltonianCycle, stateWith, tick, ticks, turn, turnAndTick } from './helpers.js'

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
    expect(state.pendingDir).toBeNull()
    expect(state.trimmed).toBe(false)
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
    const crashed = turnAndTick(stateWith('skilled', { body: [5, 6, 7], food: 100 }), 'up')
    expect(gameStatus(crashed)).toBe('lost')
    expect(() => tick(crashed)).toThrow(IllegalActionError)
    expect(isLegal(crashed, { type: 'tick' })).toBe(false)
  })

  it('回归：老存档里的手动「走一格」动作已不存在（改名成 turn / tick）', () => {
    const state = createState(SEED, 'skilled')
    expect(() => reduceState(state, { type: 'move', dir: 'right' } as never)).toThrow(
      IllegalActionError,
    )
  })
})

describe('转向缓冲', () => {
  it('转向本身不移动：蛇身不动，只记下缓冲方向', () => {
    const before = createState(SEED, 'skilled')
    const turned = turn(before, 'down')
    expect(turned.body).toEqual(before.body)
    expect(turned.moves).toBe(before.moves)
    expect(turned.pendingDir).toBe('down')
    expect(directionOf(turned)).toBe('right') // 朝向仍由蛇身决定，不受缓冲影响
  })

  it('缓冲方向在下一个 tick 生效，并且被消费掉', () => {
    const before = createState(SEED, 'skilled')
    const turned = turn(before, 'down')
    const moved = tick(turned)
    expect(moved.body[0]).toBe(neighborOf(before, 'down'))
    expect(moved.pendingDir).toBeNull()
    // 再走一格就恢复直行（朝下），不会一直往下拐
    expect(directionOf(tick(moved))).toBe('down')
  })

  it('一个 tick 内连按多次只认最后一个合法方向（不丢输入）', () => {
    const before = createState(SEED, 'skilled')
    // 朝右时：上 → 下 → 上，最后一次是「上」
    const mashed = turn(turn(turn(before, 'up'), 'down'), 'up')
    expect(mashed.pendingDir).toBe('up')
    const moved = tick(mashed)
    expect(moved.body[0]).toBe(neighborOf(before, 'up'))
  })

  it('按当前朝向 = 取消缓冲，且不产生撤销记录（合法但无变化的输入）', () => {
    const before = createState(SEED, 'skilled')
    const turned = turn(before, 'up')
    const cancelled = turn(turned, 'right') // 朝右时按「右」= 直行
    expect(cancelled.pendingDir).toBeNull()
    expect(cancelled.moves).toBe(before.moves)
    // 缓冲区从 up 变回 null 是一次真实变化，因此有一条记录；再按一次「右」就完全没有记录了
    const again = turn(cancelled, 'right')
    expect(again).toBe(cancelled)
    expect(again.history).toHaveLength(cancelled.history.length)
  })

  it('原地掉头（相对当前朝向）非法，且不会写进缓冲', () => {
    const state = createState(SEED, 'skilled')
    expect(directionOf(state)).toBe('right')
    expect(() => turn(state, 'left')).toThrow(IllegalActionError)
    expect(isLegal(state, { type: 'turn', dir: 'left' })).toBe(false)
    expect(legalActions(state)).not.toContainEqual({ type: 'turn', dir: 'left' })
    expect(
      legalActions(state).filter((action) => action.type === 'turn'),
    ).toHaveLength(ALL_DIRS.length - 1)
  })

  it('缓冲里已有一个方向时，按它的反向仍然非法（判定基准始终是当前朝向）', () => {
    // 若按缓冲值判定，缓冲里就会攒出一个「相对蛇头是掉头」的方向，tick 一到必然撞脖子
    const turned = turn(createState(SEED, 'skilled'), 'up')
    expect(() => turn(turned, 'left')).toThrow(IllegalActionError)
  })

  it('已经结束之后不能转向', () => {
    const dead = turnAndTick(stateWith('skilled', { body: [5, 6, 7], food: 100 }), 'up')
    expect(gameStatus(dead)).toBe('lost')
    expect(() => turn(dead, 'right')).toThrow(IllegalActionError)
  })
})

describe('吃食物', () => {
  it('吃到食物：分数 +1、游标 +1、食物换到新的空格', () => {
    const before = stateWith('skilled', { food: AHEAD })
    const after = turnAndTick(before, 'right')
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
    const eaten = turnAndTick(stateWith('skilled', { food: AHEAD }), 'right')
    expect(eaten.pending).toBe(difficultySpec('skilled').growth)
    const grown = tick(turn(eaten, pickFreeDir(eaten)))
    expect(grown.pending).toBe(0)
    expect(grown.body).toHaveLength(INITIAL_LENGTH + 1)
  })

  it('挑战档：吃一个食物连长两节', () => {
    const spec = difficultySpec('challenging')
    expect(spec.growth).toBe(2)
    const fresh = createState(SEED, 'challenging')
    const dir = pickFreeDir(fresh, ['down', 'up'])
    // 把食物摆到蛇头正前方：直接吃
    const eaten = tick(turn({ ...fresh, food: neighborOf(fresh, dir) }, dir))
    expect(eaten.score).toBe(1)
    expect(eaten.pending).toBe(spec.growth)
    expect(eaten.body).toHaveLength(INITIAL_LENGTH) // 吃的那一步不掉尾，长度暂时不变
    const first = tick(turn(eaten, pickFreeDir(eaten)))
    expect(first.body).toHaveLength(INITIAL_LENGTH + 1)
    expect(first.pending).toBe(1)
    const second = tick(turn(first, pickFreeDir(first)))
    expect(second.body).toHaveLength(INITIAL_LENGTH + 2)
    expect(second.pending).toBe(0)
  })

  it('走进「这一步正好要离开的尾格」是合法的（尾已让开）', () => {
    // 头 (5,5)=65、脖子 (5,6)=77、(4,6)=76、尾 (4,5)=64：朝左走正好进尾格
    const before = stateWith('skilled', { body: [65, 77, 76, 64], food: 100, score: 1, cursor: 2 })
    const after = tick(turn(before, 'left'))
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
    const after = tick(turn(before, 'up'))
    expect(after.dead).toBe(true)
    expect(gameStatus(after)).toBe('lost')
    expect(after.body).toEqual(before.body)
    expect(after.moves).toBe(before.moves + 1)
    // 致命一步也能撤销：这正是玩家最想退回的时刻（连转向一起退回）
    expect(reduceState(after, { type: 'undo' })).toEqual(before)
  })

  it('穿墙档：同一局面从对边进来，仍然活着', () => {
    const before = stateWith('starter', { body: [5, 6, 7], food: 100 })
    const after = tick(turn(before, 'up'))
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
    const after = tick(turn(before, 'down'))
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
    const after = tick(turn(before, 'left'))
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
    const steps = coordsOf(SIZE, start.body[0]!).y + 1
    let state = turn(start, 'up')
    for (let step = 0; step < steps; step++) state = tick(state)
    expect(gameStatus(state)).toBe('playing')
    expect(coordsOf(SIZE, state.body[0]!).y).toBe(SIZE - 1)
  })
})

describe('撤销：退回玩家上一次操作之前', () => {
  it('转向 + 走三格后撤销：一次撤销回到转向之前（不是只退半格）', () => {
    const start = createState(SEED, 'skilled')
    const after = ticks(turnAndTick(start, 'down'), 3)
    expect(after.moves).toBe(4)
    const back = reduceState(after, { type: 'undo' })
    expect(back).toEqual(start)
  })

  it('撤销把缓冲方向也还原（回到「当时还没转向」的状态）', () => {
    const start = createState(SEED, 'skilled')
    const turned = turn(start, 'down')
    const moved = tick(turned)
    const back = reduceState(moved, { type: 'undo' })
    expect(back.pendingDir).toBeNull()
    expect(back).toEqual(start)
  })

  it('连续两次撤销 = 退回上上次操作之前（自动前进整段回退）', () => {
    const start = createState(SEED, 'skilled')
    const first = turnAndTick(start, 'down') // 玩家操作 1：转向下并自动走一格
    const second = ticks(turnAndTick(first, 'right'), 2) // 玩家操作 2：转向右 + 自动走三格
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
    const eaten = turnAndTick(before, 'right')
    const back = reduceState(eaten, { type: 'undo' })
    expect(back).toEqual(before)
    expect(back.food).toBe(AHEAD)
    expect(back.score).toBe(0)
    expect(back.cursor).toBe(before.cursor)
    // 同种子同局面 → 同一个新食物
    expect(turnAndTick(back, 'right').food).toBe(eaten.food)
  })

  it('玩家一次操作都没做过时撤销按钮不可点（只有自动前进可退）', () => {
    const state = ticks(createState(SEED, 'starter'), 3)
    expect(state.history.length).toBeGreaterThan(0)
    expect(canUndo(state)).toBe(false)
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)
  })

  it('重开清空撤销栈并回到初始局面，之后撤销非法', () => {
    const start = createState(SEED, 'skilled')
    const moved = ticks(turnAndTick(start, 'down'), 2)
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

  /** 每回合「转向 + 自动前进一格」：既持续产生自动记录，也不断留下玩家操作边界 */
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
    expect(isAutoEntry(state.history[0]!) && state.history[0]!.kind !== 'turn').toBe(false)
    expect(canUndo(state)).toBe(true)
  })

  it('裁剪之后仍然能一次撤销回上一条玩家操作（不是退回半格）', () => {
    const state = zigzag(endless(), MAX_HISTORY_ENTRIES + 5)
    // 最后一条是自动前进，它前面才是玩家操作（转向）
    expect(state.history[state.history.length - 1]!.kind).toBe('step')
    expect(isAutoEntry(state.history[state.history.length - 1]!)).toBe(true)
    const back = reduceState(state, { type: 'undo' })
    // 一次撤销至少退掉「最后一段自动前进 + 那条转向」，因此步数与栈长都明显回退
    expect(back.moves).toBeLessThan(state.moves)
    expect(back.history.length).toBeLessThanOrEqual(state.history.length - 2)
    expect(back.pendingDir).toBeNull()
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
    // 速度随难度递增（越难越快），但都快不过刷新下限
    const declared = DIFFICULTY_IDS.map((id) => difficultySpec(id).tickMs)
    expect(declared).toEqual([...declared].sort((a, b) => b - a))
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
    const after = tick(turn(before, 'up'))
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
