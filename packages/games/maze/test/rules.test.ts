/**
 * 规则层测试：移动/撞墙、撤销、重开、到达出口判胜、点格子、确定性与路径可重放。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng, type MoveDir } from '@eink/core'
import {
  DIRECTIONS,
  canWalk,
  configFor,
  encodeState,
  gameStatus,
  goalIndex,
  legalActions,
  moveDirBetween,
  reduceMaze,
  selectAction,
  startIndex,
  targetOf,
  type MazeAction,
  type MazeState,
} from '../src/index.js'
import { fresh, shortestPathDirections } from './helpers.js'

/** 当前可走的方向 */
function openDirs(state: MazeState): MoveDir[] {
  const size = configFor(state.difficulty).size
  return DIRECTIONS.filter((dir) => canWalk(state.walls, size, state.player, dir))
}

/** 取当前第一个合法移动 */
function firstMove(state: MazeState): MazeAction {
  const dir = openDirs(state)[0]
  if (!dir) throw new Error('no open direction')
  return { type: 'move', dir }
}

describe('起点与移动', () => {
  it('从左上角出发，移动一格后站位/步数/轨迹都正确', () => {
    const state = fresh()
    expect(state.player).toBe(startIndex(configFor('starter')))
    expect(state.moves).toBe(0)
    expect(state.visited).toEqual([state.player])
    const move = firstMove(state) as { type: 'move'; dir: MoveDir }
    const next = reduceMaze(state, move)
    expect(next.player).toBe(targetOf(state.player, move.dir, configFor('starter').size))
    expect(next.moves).toBe(1)
    expect(next.visited).toEqual([...new Set([state.player, next.player])].sort((a, b) => a - b))
    expect(next.history).toEqual([{ player: state.player, moves: 0 }])
  })

  it('每一步都满足 history.length === moves', () => {
    let state = fresh(7, 'skilled')
    for (let step = 0; step < 10; step++) {
      state = reduceMaze(state, firstMove(state))
      expect(state.history).toHaveLength(state.moves)
    }
  })
})

describe('撞墙与非法方向', () => {
  it('每个走不通的方向都抛 IllegalActionError，且错误信息里带方向', () => {
    const state = fresh()
    const size = configFor(state.difficulty).size
    const blocked = DIRECTIONS.filter((dir) => !canWalk(state.walls, size, state.player, dir))
    // 起点在角落，必然至少有一个方向走不通
    expect(blocked.length).toBeGreaterThan(0)
    for (const dir of blocked) {
      expect(() => reduceMaze(state, { type: 'move', dir }), dir).toThrow(IllegalActionError)
      expect(() => reduceMaze(state, { type: 'move', dir }), dir).toThrow(dir)
    }
  })

  it('非法移动不改变原状态（reduce 是纯函数）', () => {
    const state = fresh(3, 'starter')
    const before = encodeState(state)
    const size = configFor(state.difficulty).size
    const blocked = DIRECTIONS.find((dir) => !canWalk(state.walls, size, state.player, dir))!
    expect(() => reduceMaze(state, { type: 'move', dir: blocked })).toThrow(IllegalActionError)
    expect(encodeState(state)).toEqual(before)
  })

  it('未知方向 / 未知动作明确报错', () => {
    const state = fresh()
    expect(() =>
      reduceMaze(state, { type: 'move', dir: 'sideways' } as unknown as MazeAction),
    ).toThrow(IllegalActionError)
    expect(() => reduceMaze(state, { type: 'nextLevel' } as unknown as MazeAction)).toThrow(
      IllegalActionError,
    )
  })
})

describe('撤销与重开', () => {
  it('撤销后的 encode 与移动前逐字段完全相同（含轨迹）', () => {
    let state = fresh(4242, 'skilled')
    const snapshots = [encodeState(state)]
    for (let step = 0; step < 8; step++) {
      state = reduceMaze(state, firstMove(state))
      snapshots.push(encodeState(state))
    }
    for (let step = 8; step > 0; step--) {
      expect(encodeState(state)).toEqual(snapshots[step])
      state = reduceMaze(state, { type: 'undo' })
    }
    expect(encodeState(state)).toEqual(snapshots[0])
    expect(state.moves).toBe(0)
    expect(state.history).toHaveLength(0)
    expect(state.visited).toEqual([state.player])
  })

  it('走回头路再撤销，轨迹仍然正确（visited 不靠「只增不减」维护）', () => {
    let state = fresh(11, 'starter')
    const start = state.player
    const forward = firstMove(state) as { type: 'move'; dir: MoveDir }
    state = reduceMaze(state, forward)
    const afterFirst = state.visited.slice()
    // 原路返回：visited 不变（两格都已走过）
    state = reduceMaze(state, { type: 'move', dir: reverse(forward.dir) })
    expect(state.player).toBe(start)
    expect(state.visited).toEqual(afterFirst)
    // 撤销回到第一步之后
    state = reduceMaze(state, { type: 'undo' })
    expect(state.visited).toEqual(afterFirst)
  })

  it('没有历史时撤销抛 IllegalActionError', () => {
    expect(() => reduceMaze(fresh(), { type: 'undo' })).toThrow(IllegalActionError)
  })

  it('restart 无条件接受，回到同难度同种子的同一座迷宫起点', () => {
    const state = fresh(777, 'skilled')
    let played = state
    for (let step = 0; step < 5; step++) played = reduceMaze(played, firstMove(played))
    const restarted = reduceMaze(played, { type: 'restart' })
    expect(encodeState(restarted)).toEqual(encodeState(state))
    expect(restarted.moves).toBe(0)
    expect(restarted.history).toHaveLength(0)
  })
})

describe('到达出口判胜', () => {
  it('沿最短路走到出口 → won；结果标题与明细齐全', () => {
    const state = fresh(20240607, 'starter')
    const config = configFor(state.difficulty)
    const path = shortestPathDirections(
      state.walls,
      config.size,
      state.player,
      goalIndex(config),
    )!
    expect(path.length).toBeGreaterThan(0)
    let current = state
    for (const dir of path) current = reduceMaze(current, { type: 'move', dir })
    expect(current.player).toBe(goalIndex(config))
    expect(gameStatus(current)).toBe('won')
    expect(current.moves).toBe(path.length)
  })

  it('won 是位置性的：走出出口回到 playing（本玩法没有终局锁）', () => {
    const state = fresh(20240607, 'starter')
    const config = configFor(state.difficulty)
    const path = shortestPathDirections(state.walls, config.size, state.player, goalIndex(config))!
    let current = state
    for (const dir of path) current = reduceMaze(current, { type: 'move', dir })
    expect(gameStatus(current)).toBe('won')
    const back = openDirs(current)[0]!
    current = reduceMaze(current, { type: 'move', dir: back })
    expect(gameStatus(current)).toBe('playing')
    // 撤销回到出口后又变回 won
    current = reduceMaze(current, { type: 'undo' })
    expect(gameStatus(current)).toBe('won')
  })
})

describe('selectAction（点格子）', () => {
  it('相邻通路格 → move；墙 / 自身 / 斜角 / 越界 → null', () => {
    const state = fresh(5, 'starter')
    const size = configFor(state.difficulty).size
    for (const dir of DIRECTIONS) {
      const target = targetOf(state.player, dir, size)!
      if (canWalk(state.walls, size, state.player, dir)) {
        expect(selectAction(state, target)).toEqual({ type: 'move', dir })
      } else {
        expect(selectAction(state, target), dir).toBeNull()
      }
    }
    expect(selectAction(state, state.player)).toBeNull()
    // 斜角
    const diagonal = targetOf(targetOf(state.player, 'down', size)!, 'right', size)
    if (diagonal !== null) expect(selectAction(state, diagonal)).toBeNull()
    for (const index of [-1, state.walls.length, 1.5, Number.NaN]) {
      expect(selectAction(state, index)).toBeNull()
    }
  })

  it('selectAction 返回的动作一定能被 reduce 接受', () => {
    const state = fresh(9, 'starter')
    const size = configFor(state.difficulty).size
    const dir = DIRECTIONS.find((item) => canWalk(state.walls, size, state.player, item))!
    const target = targetOf(state.player, dir, size)!
    const action = selectAction(state, target)!
    expect(moveDirBetween(state.player, target, size)).toBe(dir)
    expect(reduceMaze(state, action).player).toBe(target)
  })
})

describe('legal / 确定性', () => {
  it('legal 恰好包含走得通的方向 + 有历史时的 undo + restart', () => {
    const state = fresh()
    const moves = legalActions(state).filter((action) => action.type === 'move')
    expect(moves.map((action) => (action as { dir: MoveDir }).dir)).toEqual(openDirs(state))
    expect(legalActions(state)).toContainEqual({ type: 'restart' })
    expect(legalActions(state).some((action) => action.type === 'undo')).toBe(false)
    const played = reduceMaze(state, firstMove(state))
    expect(legalActions(played)).toContainEqual({ type: 'undo' })
  })

  it('同 seed 同动作序列 → encode 完全一致', () => {
    const run = (): unknown => {
      const rng = createRng(99)
      let state = fresh(20240607, 'skilled')
      for (let step = 0; step < 40; step++) {
        const dirs = openDirs(state)
        state = reduceMaze(state, { type: 'move', dir: dirs[rng.int(dirs.length)]! })
      }
      return encodeState(state)
    }
    expect(run()).toEqual(run())
  })
})

/** 反方向（测试里用来「原路返回」） */
function reverse(dir: MoveDir): MoveDir {
  switch (dir) {
    case 'up':
      return 'down'
    case 'down':
      return 'up'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}
