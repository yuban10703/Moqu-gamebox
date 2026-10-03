/**
 * 骑士巡游规则层：状态、走子、撤销与存档编解码（纯函数，无副作用）。
 *
 * 与 klotski / pegsolitaire 同一套「动作日志即存档」：
 * - 起点由 `(seed, difficulty)` 决定；当前位置、访问集合、步数都能从 `(seed, difficulty, log)` 重放出来；
 * - `undo` 把日志截断一步再重放，因此撤销后的 encode 与上一步之前逐字段相同；
 * - `decode` 重放日志并逐字段比对（起点、当前位置、访问集合、步数）：
 *   「凭空多访问一格」「跳了非马步」「起点不一致」都会在重放或比对时被拒绝。
 *
 * 提示（hint）只是**显示开关**：它不进日志、不改访问集合，也不计步。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  CELLS,
  GAME_ID,
  difficultyOrThrow,
  difficultySpec,
  inRange,
  insertVisited,
  isKnightMove,
  knightMoves,
  normalizeSeed,
  pickStart,
  type DifficultyId,
} from './board.js'

export type KnightAction =
  /** 跳到 to：必须是合法马步且未访问过，否则抛 IllegalActionError */
  | { type: 'move'; to: number }
  /** 退回上一步。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到由 seed 决定的起点。壳层会无条件派发，必须接受 */
  | { type: 'restart' }
  /** 切换提示模式（只有 starter 有提示）。不改棋局、不计步、不进日志 */
  | { type: 'hint' }

export interface KnightState {
  readonly difficulty: DifficultyId
  /** 起点种子：同 seed + 同难度必然同起点 */
  readonly seed: number
  /** 起始格（由 seed + 难度决定，重开后回到这里） */
  readonly start: number
  /** 马当前所在格 */
  readonly current: number
  /** 已访问格（升序，恒含起点） */
  readonly visited: readonly number[]
  /** 步数 = 走过的边数（撤销会回退） */
  readonly moves: number
  /** 每一步的落点；`log.length` 恒等于 `moves` */
  readonly log: readonly number[]
  /** 提示模式是否开启（只有 starter 能开启） */
  readonly hintOn: boolean
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

/** 重放结果（decode 与 reduce 共用同一套语义） */
export interface TourState {
  readonly start: number
  readonly current: number
  readonly visited: readonly number[]
  readonly moves: number
}

/**
 * 从 `(seed, difficulty, log)` 重放：起点由 seed + 难度决定，
 * 之后每一步都必须是从当前位置出发、落到未访问格的合法马步。
 */
export function deriveTour(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): TourState {
  const start = pickStart(seed, difficulty)
  let current = start
  let visited: number[] = [start]
  const seen = new Set<number>([start])
  for (const to of log) {
    if (!inRange(to)) throw illegal(`knightstour.illegal.move:${String(to)}`)
    if (!isKnightMove(current, to)) throw illegal(`knightstour.illegal.move:${current}->${to}`)
    if (seen.has(to)) throw illegal(`knightstour.illegal.revisit:${to}`)
    visited = insertVisited(visited, to)
    seen.add(to)
    current = to
  }
  return { start, current, visited, moves: log.length }
}

export function createState(seed: number, difficulty: DifficultyId): KnightState {
  const normalized = normalizeSeed(seed)
  const tour = deriveTour(normalized, difficulty, [])
  return {
    difficulty,
    seed: normalized,
    start: tour.start,
    current: tour.current,
    visited: tour.visited,
    moves: tour.moves,
    log: [],
    hintOn: false,
  }
}

/** 走满 64 格即胜；本玩法没有失败态（走进死路可以撤销/重开） */
export function gameStatus(state: KnightState): GameStatus {
  return state.visited.length >= CELLS ? 'won' : 'playing'
}

/** 当前还允许跳的落点（升序） */
export function legalTargets(state: KnightState): number[] {
  const seen = new Set(state.visited)
  return knightMoves(state.current).filter((to) => !seen.has(to))
}

function assertPlaying(state: KnightState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

export function reduceKnight(
  state: KnightState,
  action: KnightAction,
): KnightState {
  switch (action.type) {
    case 'move': {
      assertPlaying(state)
      const to = action.to
      // 三类非法输入都明确报错：越界 / 不是马步 / 已经访问过
      if (!inRange(to)) throw illegal(`knightstour.illegal.move:${String(to)}`)
      if (!isKnightMove(state.current, to)) {
        throw illegal(`knightstour.illegal.move:${state.current}->${to}`)
      }
      if (state.visited.includes(to)) throw illegal(`knightstour.illegal.revisit:${to}`)
      return {
        ...state,
        current: to,
        visited: insertVisited(state.visited, to),
        moves: state.moves + 1,
        log: [...state.log, to],
      }
    }

    case 'undo': {
      const last = state.log[state.log.length - 1]
      if (last === undefined) throw illegal('knightstour.illegal.nothing-to-undo')
      const log = state.log.slice(0, -1)
      const tour = deriveTour(state.seed, state.difficulty, log)
      return {
        ...state,
        current: tour.current,
        visited: tour.visited,
        moves: tour.moves,
        log,
      }
    }

    case 'restart':
      // 回到由 seed 决定的起点（走满 / 走进死路后也必须可用）
      return createState(state.seed, state.difficulty)

    case 'hint': {
      if (!difficultySpec(state.difficulty).hint) {
        throw illegal(`knightstour.illegal.hint:${state.difficulty}`)
      }
      // 提示只是显示开关：不动 current / visited / log / moves
      return { ...state, hintOn: !state.hintOn }
    }

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`knightstour.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: KnightState): KnightAction[] {
  const out: KnightAction[] = []
  if (gameStatus(state) === 'playing') {
    for (const to of legalTargets(state)) out.push({ type: 'move', to })
    if (difficultySpec(state.difficulty).hint) out.push({ type: 'hint' })
  }
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 只有合法马步且未访问的格子才返回 move；其余（越界 / 已访问 / 不是马步 / 原地）返回 null ——
 * 点了没反应比报错自然，也让壳层不可能点到必然抛错的位置。
 */
export function selectAction(state: KnightState, index: number): KnightAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!inRange(index)) return null
  if (state.visited.includes(index)) return null
  if (!isKnightMove(state.current, index)) return null
  return { type: 'move', to: index }
}

export function encodeState(state: KnightState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    start: state.start,
    current: state.current,
    visited: [...state.visited],
    moves: state.moves,
    log: [...state.log],
    hintOn: state.hintOn,
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`knightstour.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  const index = readCount(value, field)
  if (index >= CELLS) throw illegal(`knightstour.illegal.state:${field}`)
  return index
}

function readLog(value: unknown): number[] {
  if (!Array.isArray(value)) throw illegal('knightstour.illegal.state:log')
  return value.map((item) => readIndex(item, 'log'))
}

function readIndexList(value: unknown): number[] {
  if (!Array.isArray(value)) throw illegal('knightstour.illegal.state:visited')
  const out = value.map((item) => readIndex(item, 'visited'))
  // 访问集合必须是升序去重的规范形式（encode 永远这样写）
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && out[i]! <= out[i - 1]!) throw illegal('knightstour.illegal.state:visited')
  }
  return out
}

/**
 * 严格校验存档：从 `(seed, difficulty, log)` 重放，并逐字段比对存档里的材料化状态。
 * 重放本身会拒绝非马步与重复访问，比对则拒绝「凭空多访问一格」「起点被改」这类篡改。
 */
export function decodeState(raw: unknown): KnightState {
  if (!raw || typeof raw !== 'object') throw illegal('knightstour.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    start: unknown
    current: unknown
    visited: unknown
    moves: unknown
    log: unknown
    hintOn: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('knightstour.illegal.state:seed')
  const log = readLog(value.log)
  const tour = deriveTour(seed, difficulty, log)

  const start = readIndex(value.start, 'start')
  if (start !== tour.start) throw illegal('knightstour.illegal.state:start-mismatch')
  const current = readIndex(value.current, 'current')
  if (current !== tour.current) throw illegal('knightstour.illegal.state:current-mismatch')
  const visited = readIndexList(value.visited)
  if (
    visited.length !== tour.visited.length ||
    visited.some((index, position) => index !== tour.visited[position])
  ) {
    throw illegal('knightstour.illegal.state:visited-mismatch')
  }
  const moves = readCount(value.moves, 'moves')
  if (moves !== tour.moves) throw illegal('knightstour.illegal.state:moves-mismatch')

  let hintOn = false
  if (value.hintOn !== null && value.hintOn !== undefined) {
    if (typeof value.hintOn !== 'boolean') throw illegal('knightstour.illegal.state:hint')
    // 只有 starter 提供提示，其它难度不应出现开启状态
    if (value.hintOn && !difficultySpec(difficulty).hint) {
      throw illegal('knightstour.illegal.state:hint')
    }
    hintOn = value.hintOn
  }

  return {
    difficulty,
    seed,
    start: tour.start,
    current: tour.current,
    visited: tour.visited,
    moves: tour.moves,
    log,
    hintOn,
  }
}
