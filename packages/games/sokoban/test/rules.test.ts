/**
 * 规则层测试。重点覆盖验收要求里明确点名的边界：
 *   - 连击/重复输入不产生额外移动（按动作顺序处理，不靠时间防抖）；
 *   - 非法动作必须被拒绝，而不是静默吞掉；
 *   - 撤销/重开语义清晰，重开后不能撤销回重开之前；
 *   - 同一动作序列双端得到同一局面（这里先在 Node 侧锁死，真机按 F01 复核）。
 *
 * 注意：本文件用 `reduceOnLevel` 直接针对自定义关卡，不走关卡包查找，
 * 避免测试关卡 id 与真实关卡撞号导致断言对象搞错。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng } from '@eink/core'
import { parseLevel, type LevelDef, type MoveDir } from '../src/level.js'
import {
  derive,
  isLegal,
  legal,
  reduceOnLevel,
  type SokobanAction,
  type SokobanState,
} from '../src/rules.js'
import { reduceWithLevel } from '../src/index.js'
import { PACK } from '../src/pack.js'

/** 一关一箱的最小关卡，便于精确断言每一步的效果 */
const TINY: LevelDef = {
  id: 'TEST-TINY',
  difficulty: 'starter',
  grid: [
    '#######',
    '#     #',
    '#  .  #',
    '#  $  #',
    '#  @  #',
    '#     #',
    '#######',
  ],
  source: { kind: 'generated', roomId: 'test', seed: 1, unpushSteps: 1 },
}

const tiny = parseLevel(TINY)

function fresh(): SokobanState {
  return { difficulty: 'starter', levelId: TINY.id, log: [] }
}

/** 在测试关卡上执行一次动作 */
function act(state: SokobanState, action: SokobanAction): SokobanState {
  return reduceOnLevel(tiny, state, action, null)
}

function move(dir: MoveDir): SokobanAction {
  return { type: 'move', dir }
}

describe('基本移动', () => {
  it('初始局面：0 步 0 推，未完成', () => {
    const position = derive(tiny, [])
    expect(position.moves).toBe(0)
    expect(position.pushes).toBe(0)
    expect(position.solved).toBe(false)
  })

  it('向上推箱一步即完成', () => {
    const position = derive(tiny, [move('up')])
    expect(position.moves).toBe(1)
    expect(position.pushes).toBe(1)
    expect(position.solved).toBe(true)
  })

  it('撞墙的移动被拒绝', () => {
    // 玩家 (3,4) → 向下到 (3,5) 合法；再向下 (3,6) 是墙
    const afterOne = act(fresh(), move('down'))
    expect(derive(tiny, afterOne.log).moves).toBe(1)
    expect(() => act(afterOne, move('down'))).toThrow(IllegalActionError)
  })

  it('箱子后面是墙时被拒绝', () => {
    // 两次向上：箱子 (3,3) → (3,2) 目标点 → (3,1) 顶部通道（此时已离开目标点）
    const once = act(fresh(), move('up'))
    expect(derive(tiny, once.log).solved).toBe(true)
    const twice = act(once, move('up'))
    const position = derive(tiny, twice.log)
    expect(position.solved).toBe(false)
    expect(position.pushes).toBe(2)
    // 第三次向上：箱子已经在最上面一行，后面是墙
    expect(() => act(twice, move('up'))).toThrow(IllegalActionError)
  })

  it('legal() 不包含被墙挡住的方向', () => {
    const once = act(fresh(), move('up'))
    const twice = act(once, move('up'))
    const dirs = legal(tiny, derive(tiny, twice.log))
      .filter((action): action is { type: 'move'; dir: MoveDir } => action.type === 'move')
      .map((action) => action.dir)
    expect(dirs).not.toContain('up')
    expect(dirs).toContain('down')
    expect(dirs).toContain('left')
    expect(dirs).toContain('right')
  })
})

describe('撤销与重开', () => {
  it('撤销回到上一步，且不能无限撤销', () => {
    let current = act(fresh(), move('left'))
    current = act(current, move('up'))
    expect(derive(tiny, current.log).moves).toBe(2)

    current = act(current, { type: 'undo' })
    const afterUndo = derive(tiny, current.log)
    expect(afterUndo.moves).toBe(1)
    expect(afterUndo.solved).toBe(false)
    expect(afterUndo.canUndo).toBe(true)

    current = act(current, { type: 'undo' })
    expect(derive(tiny, current.log).canUndo).toBe(false)
    expect(() => act(current, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('重开清空历史与步数，且无法撤销回重开之前', () => {
    let current = act(fresh(), move('left'))
    current = act(current, { type: 'restart' })
    const position = derive(tiny, current.log)
    expect(position.moves).toBe(0)
    expect(position.pushes).toBe(0)
    expect(position.canUndo).toBe(false)
    expect(position.restarts).toBe(1)
    expect(() => act(current, { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('含撤销的日志重放结果稳定（撤销也是动作）', () => {
    const log: SokobanAction[] = [move('left'), move('up'), { type: 'undo' }, move('up')]
    expect(derive(tiny, log)).toEqual(derive(tiny, log))
  })
})

describe('输入处理与确定性', () => {
  it('被拒绝的输入不会进入日志，也不会改变局面', () => {
    const afterOne = act(fresh(), move('down'))
    expect(() => act(afterOne, move('down'))).toThrow(IllegalActionError)
    expect(afterOne.log).toHaveLength(1)
    expect(derive(tiny, afterOne.log).moves).toBe(1)
  })

  it('按顺序执行 100+ 个合法动作后，日志重放与逐步 reduce 完全一致', () => {
    const level = PACK[3]!
    const rng = createRng(20260101)
    let current: SokobanState = { difficulty: level.def.difficulty, levelId: level.def.id, log: [] }
    let applied = 0
    for (let i = 0; i < 400 && applied < 120; i++) {
      const position = derive(level.parsed, current.log)
      if (position.solved) {
        // 过关后撤销一步继续走，保证输入序列足够长
        current = reduceWithLevel(level.def.id, current, { type: 'undo' })
        continue
      }
      const moves = legal(level.parsed, position).filter(
        (action): action is { type: 'move'; dir: MoveDir } => action.type === 'move',
      )
      if (moves.length === 0) break
      current = reduceWithLevel(level.def.id, current, rng.pick(moves))
      applied++
    }
    expect(applied).toBeGreaterThanOrEqual(100)

    const replayed = derive(level.parsed, current.log)
    const incremental = current.log.reduce<SokobanState>(
      (acc, action) => reduceWithLevel(level.def.id, acc, action),
      { difficulty: level.def.difficulty, levelId: level.def.id, log: [] },
    )
    expect(derive(level.parsed, incremental.log)).toEqual(replayed)
    expect(incremental.log).toEqual(current.log)
  })

  it('isLegal 与 legal 的结论一致', () => {
    const position = derive(tiny, [])
    const allowed = new Set(legal(tiny, position).map((action) => JSON.stringify(action)))
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(isLegal(tiny, position, move(dir))).toBe(allowed.has(JSON.stringify(move(dir))))
    }
  })

  it('过关后才允许进入下一关', () => {
    const level = PACK[0]!
    const start: SokobanState = { difficulty: level.def.difficulty, levelId: level.def.id, log: [] }
    expect(() => reduceWithLevel(level.def.id, start, { type: 'nextLevel' })).toThrow(IllegalActionError)
  })
})
