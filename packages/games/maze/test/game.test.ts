/**
 * GameDef 外壳集成测试：view / controls / stats / encode / decode / 元信息 / 属性测试 / 性能。
 */
import { describe, expect, it } from 'vitest'
import { IllegalActionError, createRng, type MoveDir } from '@eink/core'
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  TRAIL_GLYPH,
  TRAIL_TEXT_SCALE,
  canWalk,
  configFor,
  createWalls,
  floorIndexes,
  goalIndex,
  legalActions,
  mazeGame,
  startIndex,
  type MazeState,
} from '../src/index.js'
import { farFloor, fresh, shortestPathDirections } from './helpers.js'

/** 沿合法方向推进 N 步（方向按固定顺序轮转，保证可复现） */
function advance(state: MazeState, steps: number): MazeState {
  let current = state
  for (let step = 0; step < steps; step++) {
    const dirs = legalActions(current)
      .filter((action): action is { type: 'move'; dir: MoveDir } => action.type === 'move')
      .map((action) => action.dir)
    current = mazeGame.reduce(current, { type: 'move', dir: dirs[step % dirs.length]! })
  }
  return current
}

/** 走到出口 */
function walkToGoal(state: MazeState): MazeState {
  const config = configFor(state.difficulty)
  const path = shortestPathDirections(state.walls, config.size, state.player, goalIndex(config))!
  let current = state
  for (const dir of path) current = mazeGame.reduce(current, { type: 'move', dir })
  return current
}

describe('元信息与注册表接口', () => {
  it('GameDef 元信息符合契约', () => {
    expect(mazeGame.id).toBe('maze')
    expect(mazeGame.i18nNamespace).toBe('maze')
    expect(mazeGame.rulesVersion).toBeGreaterThanOrEqual(1)
    expect(mazeGame.contentVersion).toBeGreaterThanOrEqual(1)
    expect(mazeGame.illegalNoticeKey).toBe('maze.illegal.notice')
    expect(mazeGame.difficulties.map((item) => item.id)).toEqual([...DIFFICULTY_IDS])
    expect(mazeGame.difficulties.map((item) => item.labelKey)).toEqual([
      'maze.difficulty.starter',
      'maze.difficulty.skilled',
      'maze.difficulty.challenging',
    ])
    // 无关卡玩法：不要声明 levels
    expect((mazeGame as { levels?: unknown }).levels).toBeUndefined()
  })

  it('create 按难度给出 11×11 / 15×15 / 21×21，未知难度拒绝', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = mazeGame.create(1, difficulty)
      expect(state.walls).toHaveLength(DIFFICULTIES[difficulty].size ** 2)
      expect(state.player).toBe(startIndex(DIFFICULTIES[difficulty]))
      expect(state.moves).toBe(0)
      expect(state.history).toHaveLength(0)
    }
    expect(() => mazeGame.create(1, 'impossible')).toThrow(IllegalActionError)
  })

  it('contentId = 难度，movesOf = 步数（最佳成绩 = 最少步数）', () => {
    const state = advance(fresh(1, 'skilled'), 4)
    expect(mazeGame.contentId!(state)).toBe('skilled')
    expect(mazeGame.movesOf!(state)).toBe(4)
    expect(mazeGame.contentId!(mazeGame.create(1, 'challenging'))).toBe('challenging')
  })

  it('controlAction 把撤销/重开映射成动作，未知 id 返回 null', () => {
    const state = fresh()
    expect(mazeGame.controlAction!(state, 'undo')).toEqual({ type: 'undo' })
    expect(mazeGame.controlAction!(state, 'restart')).toEqual({ type: 'restart' })
    expect(mazeGame.controlAction!(state, 'next-level')).toBeNull()
  })

  it('壳层直接派发的 undo / restart 都被接受', () => {
    const state = fresh(8, 'starter')
    const played = advance(state, 2)
    expect(mazeGame.decode(mazeGame.encode(mazeGame.reduce(played, { type: 'restart' })))).toEqual(
      state,
    )
    expect(mazeGame.reduce(played, { type: 'undo' }).moves).toBe(played.moves - 1)
  })
})

describe('view / 1-bit 呈现约定', () => {
  it('棋盘尺寸与难度一致、行优先索引、没有分组线', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const size = DIFFICULTIES[difficulty].size
      const view = mazeGame.view(mazeGame.create(3, difficulty))
      expect(view.board).not.toBeNull()
      expect(view.board!.kind).toBe('grid')
      expect(view.board!.cols).toBe(size)
      expect(view.board!.rows).toBe(size)
      expect(view.board!.cells).toHaveLength(size * size)
      view.board!.cells.forEach((cell, index) => expect(cell.index).toBe(index))
      // 迷宫没有宫结构：多一层粗线只会让结构更花
      expect(view.board!.groups).toBeUndefined()
    }
  })

  it('墙 / 通路 / 玩家 / 出口用现成 kind 表达', () => {
    const state = fresh(20240607, 'starter')
    const cells = mazeGame.view(state).board!.cells
    const floors = floorIndexes(state.walls).length
    // 起点是玩家，外墙是墙，出口是 goal
    expect(cells[startIndex(configFor('starter'))]).toEqual({
      index: startIndex(configFor('starter')),
      kind: 'player',
      glyph: '',
    })
    expect(cells[0]!.kind).toBe('wall')
    expect(cells[0]!.glyph).toBe('')
    expect(cells[goalIndex(configFor('starter'))]!.kind).toBe('goal')
    expect(cells.filter((cell) => cell.kind === 'wall')).toHaveLength(state.walls.length - floors)
    // 通路格里有两格不是 floor：玩家所在的起点与出口（各有自己的 kind）
    expect(cells.filter((cell) => cell.kind === 'floor')).toHaveLength(floors - 2)
  })

  it('走过的通路格带轨迹点（glyph · + textScale 0.5），没走过的通路格不带', () => {
    const played = advance(fresh(31, 'starter'), 6)
    const cells = mazeGame.view(played).board!.cells
    const trail = cells.filter((cell) => cell.kind === 'floor' && cell.glyph !== '')
    expect(trail.length).toBeGreaterThan(0)
    for (const cell of trail) {
      expect(cell.glyph).toBe(TRAIL_GLYPH)
      expect(cell.textScale).toBe(TRAIL_TEXT_SCALE)
    }
    // 轨迹格子集合与规则层的 visited 一致（玩家格与出口格各有自己的 kind）
    const goal = goalIndex(configFor('starter'))
    const expected = played.visited.filter((index) => index !== played.player && index !== goal)
    expect(trail.map((cell) => cell.index)).toEqual(expected)
    // 玩家格不画轨迹点
    expect(cells[played.player]!.kind).toBe('player')
    expect(cells[played.player]!.glyph).toBe('')
  })

  it('stats 恰好两项：步数 与 已探索 n/总数', () => {
    const state = advance(fresh(11, 'starter'), 4)
    const view = mazeGame.view(state)
    expect(view.stats).toHaveLength(2)
    expect(view.stats[0]).toEqual({ labelKey: 'maze.stat.moves', value: String(state.moves) })
    expect(view.stats[1]!.labelKey).toBe('maze.stat.explored')
    expect(view.stats[1]!.value).toBe(`${state.visited.length}/${floorIndexes(state.walls).length}`)
  })

  it('进行中没有结果与提示；到达出口后给出结果标题与明细', () => {
    const playing = fresh()
    expect(mazeGame.view(playing).result).toBeNull()
    expect(mazeGame.view(playing).notice).toBeNull()

    const won = walkToGoal(fresh(20240607, 'starter'))
    expect(mazeGame.status(won)).toBe('won')
    const result = mazeGame.view(won).result!
    expect(result.titleKey).toBe('maze.won.title')
    expect(result.details).toEqual([
      { key: 'maze.result.moves', params: { count: won.moves } },
      { key: 'maze.result.explored', params: { count: won.visited.length } },
    ])
  })
})

describe('controls / 方向盘', () => {
  it('四个 dpad 方向 + 一个 undo，且不声明重开/下一关', () => {
    const controls = mazeGame.controls(fresh())
    expect(controls.map((control) => control.id)).toEqual([
      'move-up',
      'move-down',
      'move-left',
      'move-right',
      'undo',
    ])
    const dpad = controls.filter((control) => control.role === 'dpad')
    expect(dpad.map((control) => control.dir)).toEqual(['up', 'down', 'left', 'right'])
    expect(dpad.every((control) => control.enabled)).toBe(true)
    expect(dpad.every((control) => control.labelKey.startsWith('maze.dir.'))).toBe(true)
    const undo = controls.find((control) => control.id === 'undo')!
    expect(undo.labelKey).toBe('shell.game.undo')
    expect(undo.enabled).toBe(false)
    expect(controls.some((control) => control.id === 'restart')).toBe(false)
    expect(controls.some((control) => control.id === 'next-level')).toBe(false)
  })

  it('撞墙方向 tone: muted（但仍可点），走得通的 normal', () => {
    const state = fresh(5, 'starter')
    const size = configFor(state.difficulty).size
    for (const control of mazeGame.controls(state).filter((item) => item.role === 'dpad')) {
      expect(control.enabled).toBe(true)
      const expected = canWalk(state.walls, size, state.player, control.dir!) ? 'normal' : 'muted'
      expect(control.tone, control.dir).toBe(expected)
    }
  })

  it('有历史之后 undo 才可用', () => {
    const state = fresh()
    expect(mazeGame.controls(state).find((control) => control.id === 'undo')!.enabled).toBe(false)
    const played = mazeGame.reduce(state, legalActions(state).find(
      (action): action is { type: 'move'; dir: MoveDir } => action.type === 'move',
    )!)
    expect(mazeGame.controls(played).find((control) => control.id === 'undo')!.enabled).toBe(true)
  })
})

describe('encode / decode', () => {
  it('初始与中盘状态往返一致（含 JSON 往返）', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const state = mazeGame.create(2024, difficulty)
      expect(mazeGame.decode(mazeGame.encode(state))).toEqual(state)
      expect(mazeGame.decode(JSON.parse(JSON.stringify(mazeGame.encode(state))))).toEqual(state)
    }
    const played = advance(fresh(606, 'skilled'), 5)
    expect(played.history).toHaveLength(5)
    const decoded = mazeGame.decode(mazeGame.encode(played))
    expect(decoded).toEqual(played)
    expect(mazeGame.encode(decoded)).toEqual(mazeGame.encode(played))
  })

  it('visited 只比对集合：顺序不同的存档会被规范化而不是拒绝', () => {
    const played = advance(fresh(17, 'starter'), 4)
    const raw = mazeGame.encode(played) as { visited: number[] }
    const shuffled = { ...(mazeGame.encode(played) as Record<string, unknown>), visited: [...raw.visited].reverse() }
    expect(mazeGame.decode(shuffled)).toEqual(played)
  })

  it('坏数据一律抛 IllegalActionError', () => {
    const played = advance(fresh(17, 'starter'), 3)
    const raw = mazeGame.encode(played) as {
      difficulty: string
      seed: number
      walls: boolean[]
      player: number
      moves: number
      visited: number[]
      history: Array<{ player: number; moves: number }>
    }
    const config = configFor('starter')
    const size = config.size
    const wallIndex = raw.walls.findIndex((wall) => wall)
    const floorIndex = raw.walls.findIndex((wall) => !wall && wall !== undefined)
    const teleportFromHistory = farFloor(raw.walls, size, raw.history[0]!.player)
    const teleportFromPlayer = farFloor(raw.walls, size, raw.history[raw.history.length - 1]!.player)
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'state',
      {},
      [],
      { ...raw, difficulty: 'impossible' },
      { ...raw, seed: -1 },
      { ...raw, seed: 1.5 },
      { ...raw, seed: 0x1_0000_0000 },
      { ...raw, walls: 'nope' },
      { ...raw, walls: raw.walls.slice(0, raw.walls.length - 1) },
      { ...raw, walls: [...raw.walls, true] },
      { ...raw, walls: raw.walls.map((wall, index) => (index === 0 ? 1 : wall)) },
      // 墙被改动：与同 seed 复算出的迷宫不一致
      { ...raw, walls: raw.walls.map((wall, index) => (index === wallIndex ? false : wall)) },
      { ...raw, walls: raw.walls.map((wall, index) => (index === floorIndex ? true : wall)) },
      { ...raw, player: -1 },
      { ...raw, player: 1.5 },
      { ...raw, player: raw.walls.length },
      { ...raw, player: wallIndex },
      // 当前位置必须与最后一步相邻
      { ...raw, player: teleportFromPlayer },
      { ...raw, moves: -1 },
      { ...raw, moves: 1.5 },
      { ...raw, moves: raw.moves - 1 },
      { ...raw, moves: raw.moves + 1 },
      { ...raw, history: 'nope' },
      { ...raw, history: [] },
      { ...raw, history: raw.history.map((entry, index) => (index === 0 ? null : entry)) },
      // 快照步数必须与位置一一对应
      { ...raw, history: raw.history.map((entry) => ({ ...entry, moves: 99 })) },
      // 快照起点必须是迷宫起点
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 0 ? { player: teleportFromHistory, moves: 0 } : entry,
        ),
      },
      // 快照之间必须是一步一格，不能瞬移
      {
        ...raw,
        history: raw.history.map((entry, index) =>
          index === 1 ? { ...entry, player: teleportFromHistory } : entry,
        ),
      },
      // 快照里的玩家不能站在墙上
      { ...raw, history: raw.history.map((entry) => ({ ...entry, player: wallIndex })) },
      { ...raw, visited: 'nope' },
      { ...raw, visited: [] },
      { ...raw, visited: [raw.walls.findIndex((wall) => !wall), raw.walls.findIndex((wall) => !wall)] },
      { ...raw, visited: [...raw.visited, wallIndex] },
      { ...raw, visited: raw.visited.slice(1) },
    ]
    for (const candidate of bad) {
      expect(
        () => mazeGame.decode(candidate),
        JSON.stringify(candidate)?.slice(0, 120),
      ).toThrow(IllegalActionError)
    }
  })

  it('decode 只用 seed 重新生成迷宫，不重放动作', () => {
    const played = advance(fresh(55, 'skilled'), 4)
    const decoded = mazeGame.decode(mazeGame.encode(played))
    expect(decoded.walls).toEqual(createWalls(configFor('skilled'), played.seed))
    expect(decoded.player).toBe(played.player)
    expect(decoded.visited).toEqual(played.visited)
  })
})

describe('属性测试', () => {
  it('随机 80 步合法移动：每步 encode→decode 往返一致且能继续走下去', () => {
    const rng = createRng(20240607)
    let state = mazeGame.create(20240607, 'skilled')
    for (let step = 0; step < 80; step++) {
      const dirs = mazeGame
        .legal(state)
        .filter((action): action is { type: 'move'; dir: MoveDir } => action.type === 'move')
      expect(dirs.length, `step ${step}`).toBeGreaterThan(0)
      const dir = dirs[rng.int(dirs.length)]!.dir
      state = mazeGame.reduce(state, { type: 'move', dir })

      // 每一步的存档都必须严格往返；decode 出来的局面仍可继续
      const encoded = mazeGame.encode(state)
      const decoded = mazeGame.decode(encoded)
      expect(decoded, `step ${step}`).toEqual(state)
      expect(mazeGame.encode(decoded)).toEqual(encoded)
      expect(mazeGame.decode(JSON.parse(JSON.stringify(encoded)))).toEqual(state)
      expect(
        mazeGame.legal(decoded).filter((action) => action.type === 'move').length,
      ).toBeGreaterThan(0)
      state = decoded
    }
    expect(state.moves).toBe(80)
  })

  it('随机走 80 步不会走出棋盘或踩到墙上', () => {
    const rng = createRng(7)
    let state = mazeGame.create(7, 'challenging')
    for (let step = 0; step < 80; step++) {
      const dirs = mazeGame
        .legal(state)
        .filter((action): action is { type: 'move'; dir: MoveDir } => action.type === 'move')
      state = mazeGame.reduce(state, { type: 'move', dir: dirs[rng.int(dirs.length)]!.dir })
      expect(state.walls[state.player]).toBe(false)
      expect(state.player).toBeGreaterThanOrEqual(0)
      expect(state.player).toBeLessThan(state.walls.length)
    }
  })
})

describe('性能', () => {
  it('21×21 生成耗时上限（宽松 < 300ms）', () => {
    const started = performance.now()
    for (let seed = 0; seed < 5; seed++) mazeGame.create(seed, 'challenging')
    expect(performance.now() - started).toBeLessThan(300)
  })

  it('21×21 单次生成 + 解码都在宽松上限内', () => {
    const started = performance.now()
    const state = mazeGame.create(20240607, 'challenging')
    mazeGame.decode(mazeGame.encode(state))
    expect(performance.now() - started).toBeLessThan(300)
  })
})
