/**
 * 点格棋规则层：动作、白方自动应手、撤销一整回合与存档编解码（纯函数，无副作用）。
 *
 * 核心设计与 checkers 同一套「动作日志即存档」：
 * - 状态里除了材料化的边/方格/轮次/比分，还有双方全部画线的日志 `log`；
 * - `log` 不含「谁画的」——因为轮次转移规则是确定的（画完占不到格才换手），
 *   重放时按同一套规则复算即可；
 * - `undo` 把日志截断到最近一次**黑方回合起点**再重放：玩家的连走全部步骤与白方应手一起退回；
 * - `decode` 重放日志并逐字段比对（边、方格归属、轮次、比分、步数、游标）：
 *   「凭空多一个方格」「画了不存在的边」「轮次不对」都会被拒绝。
 *
 * 白方应手在同一次 reduce 内算完（含连走）；随机只来自 `createRng(seed + 白方回合数)`。
 */
import { IllegalActionError, createRng, type GameStatus } from '@eink/core'
import { chooseEdge } from './ai.js'
import {
  BLACK,
  WHITE,
  applyClaim,
  configFor,
  countScores,
  difficultyOrThrow,
  emptyState,
  inRange,
  isBoardFull,
  isEdge,
  openEdges,
  type DifficultyId,
  type DotsBoxesState,
  type Side,
} from './board.js'

export type DotsBoxesAction =
  /** 画一条边（index 是边所在的格）。已画过 / 不是边 / 越界都抛 IllegalActionError */
  | { type: 'claim'; index: number }
  /** 撤回一整回合（玩家的连走全部步骤 + 白方应手）。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到空棋盘。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError('dotsboxes', reason)
}

/** 起始局面：空棋盘，黑方先手 */
export function createState(seed: number, difficulty: DifficultyId): DotsBoxesState {
  return emptyState(seed, difficulty)
}

/**
 * 胜负：全部边画完才结束；占领格多者胜，相同为平局。
 * 三态协议只有 playing/won/lost，平局并入 `won`（与五子棋、黑白棋同一取舍），
 * 真实结果由 `outcomeOf` 给结果页用。
 */
export function gameStatus(state: DotsBoxesState): GameStatus {
  if (!isBoardFull(state)) return 'playing'
  const { black, white } = countScores(state.owners)
  return white > black ? 'lost' : 'won'
}

/** 真实结果（结果页标题用）：won / lost / draw */
export function outcomeOf(state: DotsBoxesState): 'won' | 'lost' | 'draw' {
  const { black, white } = countScores(state.owners)
  if (black > white) return 'won'
  if (black < white) return 'lost'
  return 'draw'
}

function assertPlaying(state: DotsBoxesState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

interface DerivedShape {
  readonly state: DotsBoxesState
  /** 每一次黑方回合在 log 中的起始下标（撤销按它截断） */
  readonly blackTurnStarts: readonly number[]
}

/**
 * 从 `(seed, difficulty, log)` 重放。
 * 画完一条边若占不到格就换手，占到了就同一方继续走 —— 轮次完全由规则推出。
 */
export function deriveWithMeta(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): DerivedShape {
  let state = emptyState(seed, difficulty)
  const blackTurnStarts: number[] = []
  let turnStart = true
  for (let index = 0; index < log.length; index++) {
    if (state.turn === BLACK && turnStart) blackTurnStarts.push(index)
    const before = state.turn
    state = applyClaim(state, log[index]!)
    // 换手了 ⇒ 下一条是新回合；占格连走则仍是同一回合
    turnStart = state.turn !== before
  }
  return { state, blackTurnStarts }
}

export function deriveState(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): DotsBoxesState {
  return deriveWithMeta(seed, difficulty, log).state
}

/**
 * 白方应手：`cursor` 是本回合开始前已应手过的白方回合数。
 * 只有轮到白方且对局未结束时才应手；连走（占格后再走）会在循环里走完。
 */
function resolveOpponent(state: DotsBoxesState, cursor: number): DotsBoxesState {
  if (state.turn !== WHITE) return state
  if (gameStatus(state) !== 'playing') return state
  const rng = createRng(state.seed + cursor)
  let current = state
  let guard = 0
  while (current.turn === WHITE && gameStatus(current) === 'playing') {
    // 画线数有限，正常不可能走满循环；多一层护栏避免实现出错时死循环
    if (guard++ > current.edges.length) throw illegal('dotsboxes.illegal.opponent-loop')
    const edge = chooseEdge(current, current.difficulty, rng)
    current = applyClaim(current, edge)
  }
  return current
}

export function reduceDotsBoxes(
  state: DotsBoxesState,
  action: DotsBoxesAction,
): DotsBoxesState {
  switch (action.type) {
    case 'claim': {
      assertPlaying(state)
      // 白方应手用的游标是「本回合开始前」的值：applyClaim 之后游标才 +1
      const cursor = state.rngCursor
      const next = applyClaim(state, action.index)
      return resolveOpponent(next, cursor)
    }

    case 'undo': {
      const { blackTurnStarts } = deriveWithMeta(state.seed, state.difficulty, state.log)
      const start = blackTurnStarts[blackTurnStarts.length - 1]
      if (start === undefined) throw illegal('dotsboxes.illegal.nothing-to-undo')
      // 截断到最近一次黑方回合起点：玩家的连走全部步骤与白方应手一起退回
      return deriveState(state.seed, state.difficulty, state.log.slice(0, start))
    }

    case 'restart':
      // 同难度同种子重开：回到空棋盘（对局结束后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`dotsboxes.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: DotsBoxesState): DotsBoxesAction[] {
  const out: DotsBoxesAction[] = []
  if (gameStatus(state) === 'playing') {
    for (const edge of openEdges(state)) out.push({ type: 'claim', index: edge })
  }
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 只有**未画的边**才返回 claim；点（奇行奇列）、方格（偶行偶列）、已画的边、越界都返回 null ——
 * 点了没反应比报错自然，也让壳层不可能点到必然抛错的位置。
 */
export function selectAction(state: DotsBoxesState, index: number): DotsBoxesAction | null {
  if (gameStatus(state) !== 'playing') return null
  const config = configFor(state.difficulty)
  if (!inRange(index, config) || !isEdge(index, config)) return null
  if (state.edges[index] !== null) return null
  return { type: 'claim', index }
}

export function encodeState(state: DotsBoxesState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    edges: [...state.edges],
    owners: [...state.owners],
    turn: state.turn,
    moves: state.moves,
    rngCursor: state.rngCursor,
    lastEdge: state.lastEdge,
    log: [...state.log],
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`dotsboxes.illegal.state:${field}`)
  }
  return value
}

function readSideList(value: unknown, field: string): (Side | null)[] {
  if (!Array.isArray(value)) throw illegal(`dotsboxes.illegal.state:${field}`)
  return value.map((item) => {
    if (item === null) return null
    if (item === BLACK || item === WHITE) return item
    throw illegal(`dotsboxes.illegal.state:${field}`)
  })
}

function readLog(value: unknown, cells: number): number[] {
  if (!Array.isArray(value)) throw illegal('dotsboxes.illegal.state:log')
  return value.map((item) => {
    const edge = readCount(item, 'log')
    if (edge >= cells) throw illegal('dotsboxes.illegal.state:log')
    return edge
  })
}

/** 逐格比对两个数组（长度已由构造保证一致） */
function sameList(a: readonly (Side | null)[], b: readonly (Side | null)[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * 严格校验存档：从 `(seed, difficulty, log)` 重放，并逐字段比对存档里的材料化状态。
 * 重放会拒绝「不是边」「画过的边」这类非法日志，比对则拒绝
 * 「凭空多一个方格」「轮次不对」「比分对不上」这类篡改。
 */
export function decodeState(raw: unknown): DotsBoxesState {
  if (!raw || typeof raw !== 'object') throw illegal('dotsboxes.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    edges: unknown
    owners: unknown
    turn: unknown
    moves: unknown
    rngCursor: unknown
    lastEdge: unknown
    log: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const config = configFor(difficulty)
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('dotsboxes.illegal.state:seed')
  const log = readLog(value.log, config.cells)
  const derived = deriveWithMeta(seed, difficulty, log)

  const edges = readSideList(value.edges, 'edges')
  if (edges.length !== config.cells || !sameList(edges, derived.state.edges)) {
    throw illegal('dotsboxes.illegal.state:edges-mismatch')
  }
  const owners = readSideList(value.owners, 'owners')
  if (owners.length !== config.cells || !sameList(owners, derived.state.owners)) {
    throw illegal('dotsboxes.illegal.state:owners-mismatch')
  }
  const turn = value.turn === BLACK || value.turn === WHITE ? value.turn : null
  if (turn === null || turn !== derived.state.turn) {
    throw illegal('dotsboxes.illegal.state:turn-mismatch')
  }
  const moves = readCount(value.moves, 'moves')
  if (moves !== derived.state.moves) throw illegal('dotsboxes.illegal.state:moves-mismatch')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (rngCursor !== derived.state.rngCursor) {
    throw illegal('dotsboxes.illegal.state:cursor-mismatch')
  }
  const lastEdge =
    value.lastEdge === null || value.lastEdge === undefined
      ? null
      : readCount(value.lastEdge, 'lastEdge')
  if (lastEdge !== derived.state.lastEdge) {
    throw illegal('dotsboxes.illegal.state:last-edge-mismatch')
  }
  // 可对局时必然是黑方该走（白方应手在同一次 reduce 内算完，不会把控制权交出去）
  if (gameStatus(derived.state) === 'playing' && derived.state.turn !== BLACK) {
    throw illegal('dotsboxes.illegal.state:white-to-move')
  }

  return derived.state
}
