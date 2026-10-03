/**
 * 规则层：状态、动作执行与存档编解码（纯函数，无副作用）。
 *
 * 约定：
 * 1. 移动语义是「玩家朝该方向走一格」；撞墙（或走出棋盘）抛 IllegalActionError，
 *    壳层据此给出明确文字反馈，而不是静默无响应；
 * 2. `won` 是**位置性**的：玩家站在出口就是 won，走出出口会回到 playing ——
 *    本玩法没有失败态，也不做「已结束」前置检查（撤销/重开同样无条件可用）；
 * 3. `visited`（走过的格子）不单独维护：它等于「各次移动前的站位 ∪ 当前站位」，
 *    由 history 推导。这样撤销只要回退 history 就必然与之前 encode 完全一致，
 *    也避免了同一份轨迹在状态里存两遍。
 */
import { IllegalActionError, type GameStatus, type MoveDir } from '@eink/core'
import {
  DIRECTIONS,
  GAME_ID,
  cellCount,
  configFor,
  createWalls,
  difficultyOrThrow,
  goalIndex,
  isMoveDir,
  isWall,
  moveDirBetween,
  normalizeSeed,
  startIndex,
  targetOf,
  type DifficultyId,
} from './board.js'

export type MazeAction =
  /** 玩家朝 dir 走一格；目标越界或撞墙时抛 IllegalActionError */
  | { type: 'move'; dir: MoveDir }
  /** 撤回上一次移动。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到同难度同种子的同一座迷宫。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

/** 一步快照：撤销只需要「移动前的站位 + 移动前的步数」，visited 由 history 推导 */
export interface MazeSnapshot {
  readonly player: number
  readonly moves: number
}

export interface MazeState {
  readonly difficulty: DifficultyId
  /** 生成种子：同 seed + 同难度必然得到同一座迷宫 */
  readonly seed: number
  /** 行优先墙格表：true = 墙（整座迷宫完全由 seed + 难度决定） */
  readonly walls: readonly boolean[]
  /** 玩家所在格索引 */
  readonly player: number
  /** 有效移动次数（撤销会回退） */
  readonly moves: number
  /** 走过的格子（升序去重，含起点）；由 history + player 推导，供「轨迹点」呈现 */
  readonly visited: readonly number[]
  /** 每次移动前的快照；`history.length` 恒等于 `moves` */
  readonly history: readonly MazeSnapshot[]
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

/**
 * 由「各次移动前的站位」与「当前站位」推导走过的格子集合（升序）。
 * history[i].player 是第 i 步之前的位置，因此 ∪ 起来再加上当前位置就是完整轨迹。
 */
export function visitedFrom(
  history: readonly MazeSnapshot[],
  player: number,
): number[] {
  const seen = new Set<number>()
  for (const snapshot of history) seen.add(snapshot.player)
  seen.add(player)
  return [...seen].sort((a, b) => a - b)
}

/** 确定性初始状态：同一座迷宫里的起点，步数 0，历史为空 */
export function createState(seed: number, difficulty: DifficultyId): MazeState {
  const config = configFor(difficulty)
  const normalized = normalizeSeed(seed)
  const walls = createWalls(config, normalized)
  const player = startIndex(config)
  return {
    difficulty,
    seed: normalized,
    walls,
    player,
    moves: 0,
    visited: [player],
    history: [],
  }
}

/** 位置性胜负：站在出口即 won（没有失败态） */
export function gameStatus(state: MazeState): GameStatus {
  return state.player === goalIndex(configFor(state.difficulty)) ? 'won' : 'playing'
}

/** 记一步：把「移动前的站位与步数」压入历史，visited 由新历史推导 */
function advance(state: MazeState, target: number): MazeState {
  const history: MazeSnapshot[] = [...state.history, { player: state.player, moves: state.moves }]
  return {
    ...state,
    player: target,
    moves: state.moves + 1,
    history,
    visited: visitedFrom(history, target),
  }
}

function applyMove(state: MazeState, dir: MoveDir): MazeState {
  if (!isMoveDir(dir)) throw illegal(`maze.illegal.dir:${String(dir)}`)
  const size = configFor(state.difficulty).size
  const target = targetOf(state.player, dir, size)
  // 撞墙 / 走出棋盘：明确拒绝，壳层按 illegalNoticeKey 提示
  if (target === null || isWall(state.walls, target)) throw illegal(`maze.illegal.move:${dir}`)
  return advance(state, target)
}

export function reduceMaze(state: MazeState, action: MazeAction): MazeState {
  switch (action.type) {
    case 'move':
      return applyMove(state, action.dir)

    case 'undo': {
      const previous = state.history[state.history.length - 1]
      if (previous === undefined) throw illegal('maze.illegal.nothing-to-undo')
      const history = state.history.slice(0, -1)
      // 站位/步数回退后，visited 也要按回退后的 history 重新推导，保证 encode 逐字段相同
      return {
        ...state,
        player: previous.player,
        moves: previous.moves,
        history,
        visited: visitedFrom(history, previous.player),
      }
    }

    case 'restart':
      // 同难度同种子重开：回到同一座迷宫的起点，历史清空（到达出口后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`maze.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: MazeState): MazeAction[] {
  const size = configFor(state.difficulty).size
  const out: MazeAction[] = []
  for (const dir of DIRECTIONS) {
    const target = targetOf(state.player, dir, size)
    if (target !== null && !isWall(state.walls, target)) out.push({ type: 'move', dir })
  }
  if (state.history.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 只有与玩家正交相邻、且不是墙的格子才返回 move；其余（自身/墙/斜角/越界）返回 null。
 */
export function selectAction(state: MazeState, index: number): MazeAction | null {
  const size = configFor(state.difficulty).size
  if (!Number.isInteger(index) || index < 0 || index >= state.walls.length) return null
  if (isWall(state.walls, index)) return null
  const dir = moveDirBetween(state.player, index, size)
  if (dir === null) return null
  return { type: 'move', dir }
}

export function encodeState(state: MazeState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    walls: [...state.walls],
    player: state.player,
    moves: state.moves,
    visited: [...state.visited],
    history: state.history.map((snapshot) => ({
      player: snapshot.player,
      moves: snapshot.moves,
    })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`maze.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, total: number, field: string): number {
  const index = readCount(value, field)
  if (index >= total) throw illegal(`maze.illegal.state:${field}`)
  return index
}

function readWalls(value: unknown, total: number, field: string): boolean[] {
  if (!Array.isArray(value) || value.length !== total) throw illegal(`maze.illegal.state:${field}`)
  const walls: boolean[] = []
  for (const cell of value) {
    if (typeof cell !== 'boolean') throw illegal(`maze.illegal.state:${field}`)
    walls.push(cell)
  }
  return walls
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 *
 * 除了字段类型与取值范围，还复核四条不变量：
 * 1. 迷宫可复算：`walls` 必须与同 seed/难度重新生成的迷宫逐格相同
 *    （保证「同 seed 同迷宫」，任何被改过的墙都会在这里被拒绝）；
 * 2. 路径可重放：快照按步数递增；每一步都是两个通路格之间的正交单步；
 *    快照起点必须是迷宫起点；
 * 3. `history.length === moves`，当前位置与最后一份快照相邻；
 * 4. `visited` 恰等于由 history + 当前位置推导出的轨迹集合（升序去重）。
 * decode 只用 seed 重新生成迷宫，不会重放动作。
 */
export function decodeState(raw: unknown): MazeState {
  if (!raw || typeof raw !== 'object') throw illegal('maze.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    walls: unknown
    player: unknown
    moves: unknown
    visited: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const config = configFor(difficulty)
  const total = cellCount(config)

  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('maze.illegal.state:seed')
  const walls = readWalls(value.walls, total, 'walls')
  // 不变量 1：迷宫必须与同 seed/难度生成的结果一致
  const expectedWalls = createWalls(config, seed)
  if (!walls.every((wall, index) => wall === expectedWalls[index])) {
    throw illegal('maze.illegal.state:walls')
  }
  const start = startIndex(config)
  const player = readIndex(value.player, total, 'player')
  if (isWall(walls, player)) throw illegal('maze.illegal.state:player')
  const moves = readCount(value.moves, 'moves')

  if (!Array.isArray(value.history)) throw illegal('maze.illegal.state:history')
  const history: MazeSnapshot[] = []
  for (let position = 0; position < (value.history as unknown[]).length; position++) {
    const entry = (value.history as unknown[])[position]
    if (!entry || typeof entry !== 'object') throw illegal('maze.illegal.state:history-entry')
    const snapshot = entry as { player?: unknown; moves?: unknown }
    const snapshotPlayer = readIndex(snapshot.player, total, 'history-player')
    const snapshotMoves = readCount(snapshot.moves, 'history-moves')
    // 不变量 2：快照顺序 = 步数顺序，且每一步都是通路格之间的合法单步
    if (snapshotMoves !== position) throw illegal('maze.illegal.state:history-order')
    if (isWall(walls, snapshotPlayer)) throw illegal('maze.illegal.state:history-player')
    const previous = history[history.length - 1]
    if (previous && moveDirBetween(previous.player, snapshotPlayer, config.size) === null) {
      throw illegal('maze.illegal.state:history-step')
    }
    history.push({ player: snapshotPlayer, moves: snapshotMoves })
  }
  // 不变量 3：快照数 = 步数；起点必须是迷宫起点（history 为空时玩家自己就是起点）
  if (history.length !== moves) throw illegal('maze.illegal.state:history-length')
  const anchor = history.length > 0 ? history[0]!.player : player
  if (anchor !== start) throw illegal('maze.illegal.state:history-root')
  if (history.length > 0) {
    if (moveDirBetween(history[history.length - 1]!.player, player, config.size) === null) {
      throw illegal('maze.illegal.state:player-step')
    }
  }

  // 不变量 4：visited 必须与推导结果一致（顺序无关，内容必须相同）
  if (!Array.isArray(value.visited)) throw illegal('maze.illegal.state:visited')
  const rawVisited = (value.visited as unknown[]).map((item) => readIndex(item, total, 'visited'))
  const visited = [...new Set(rawVisited)].sort((a, b) => a - b)
  if (visited.length !== rawVisited.length) throw illegal('maze.illegal.state:visited-duplicate')
  for (const index of visited) {
    if (isWall(walls, index)) throw illegal('maze.illegal.state:visited-wall')
  }
  const derived = visitedFrom(history, player)
  if (visited.length !== derived.length || visited.some((index, i) => index !== derived[i])) {
    throw illegal('maze.illegal.state:visited-mismatch')
  }

  return { difficulty, seed, walls, player, moves, visited, history }
}
