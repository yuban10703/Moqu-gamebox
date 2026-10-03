/**
 * 直棋规则层：动作、白方自动应手、撤销一整回合与存档编解码（纯函数，无副作用）。
 *
 * 与前面几款同一套「动作日志即存档」：
 * - 日志只记 place/move/remove（`select` 只是界面选中，不进日志、不计步）；
 * - 轮到谁、处在哪个阶段、还要吃几个子，全部由规则从日志复算；
 * - `undo` 把日志截断到最近一次**黑方回合起点**再重放：
 *   玩家的落子/移动 + 成三吃子 + 白方应手（含白方吃子）一起退回；
 * - `decode` 从 `(seed, difficulty, log)` 复算点位占用、阶段、手数、pendingRemove、已吃子数并逐字段比对。
 *
 * 白方应手在同一次 reduce 内算完（含成三后的吃子）；随机只来自
 * `createRng(seed + 白方回合数)`。
 */
import { IllegalActionError, createRng, type GameStatus } from '@eink/core'
import { chooseAction } from './ai.js'
import {
  BLACK,
  POINT_COUNT,
  STONES_PER_SIDE,
  WHITE,
  applyAction,
  createBoardState,
  difficultyOrThrow,
  inRange,
  isTerminal,
  otherPlayer,
  rawActions,
  stonesLeft,
  stuckPlayer,
  type DifficultyId,
  type LoggedAction,
  type NinemensState,
  type Player,
} from './board.js'

export type NinemensAction =
  | LoggedAction
  /** 界面选中/改选自己的子（只影响高亮，不是规则动作） */
  | { readonly type: 'select'; readonly index: number }
  /** 撤回一整回合（落子/移动 + 成三吃子 + 白方应手）。没有历史时抛错 */
  | { readonly type: 'undo' }
  /** 重开：回到空盘、双方各 9 子在手上。壳层会无条件派发，必须接受 */
  | { readonly type: 'restart' }

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError('ninemens', reason)
}

export function createState(seed: number, difficulty: DifficultyId): NinemensState {
  return createBoardState(seed, difficulty)
}

/**
 * 胜负（无平局口径：直棋在这一实现里不引入和棋，见 rules.body2）：
 * - 一方只剩 2 子（在场 + 手上 ≤ 2）→ 该方负；
 * - 轮到某方却没有一个合法动作 → 该方负。
 */
export function gameStatus(state: NinemensState): GameStatus {
  if (stonesLeft(state, BLACK) <= 2) return 'lost'
  if (stonesLeft(state, WHITE) <= 2) return 'won'
  const stuck = stuckPlayer(state)
  if (stuck !== null) return stuck === BLACK ? 'lost' : 'won'
  return 'playing'
}

export function isOver(state: NinemensState): boolean {
  return gameStatus(state) !== 'playing'
}

function assertPlaying(state: NinemensState): void {
  if (isTerminal(state) || stuckPlayer(state) !== null) throw illegal('game already finished')
}

interface DerivedShape {
  readonly state: NinemensState
  /** 每一次黑方回合在 log 中的起始下标（撤销按它截断） */
  readonly blackTurnStarts: readonly number[]
}

/** 从 `(seed, difficulty, log)` 重放（非法日志会在 applyAction 里抛错） */
export function deriveWithMeta(
  seed: number,
  difficulty: DifficultyId,
  log: readonly LoggedAction[],
): DerivedShape {
  let state = createBoardState(seed, difficulty)
  const blackTurnStarts: number[] = []
  let turnStart = true
  for (let index = 0; index < log.length; index++) {
    if (state.turn === BLACK && turnStart) blackTurnStarts.push(index)
    const before = state.turn
    state = applyAction(state, log[index]!).state
    // 换手了 ⇒ 下一条是新回合；成三继续吃子/连走则仍是同一回合
    turnStart = state.turn !== before
  }
  return { state, blackTurnStarts }
}

export function deriveState(
  seed: number,
  difficulty: DifficultyId,
  log: readonly LoggedAction[],
): NinemensState {
  return deriveWithMeta(seed, difficulty, log).state
}

/** 白方应手：`cursor` 是本回合开始前已应手过的白方回合数 */
function resolveOpponent(state: NinemensState, cursor: number): NinemensState {
  if (state.turn !== WHITE) return state
  const rng = createRng(state.seed + cursor)
  let current = state
  let guard = 0
  while (current.turn === WHITE && !isOver(current)) {
    // 每回合动作数有限，正常不可能走满循环；多一层护栏避免实现出错时死循环
    if (guard++ > POINT_COUNT * 4) throw illegal('ninemens.illegal.opponent-loop')
    const action = chooseAction(current, current.difficulty, rng)
    current = applyAction(current, action).state
  }
  return current
}

export function reduceNinemens(
  state: NinemensState,
  action: NinemensAction,
): NinemensState {
  switch (action.type) {
    case 'select': {
      assertPlaying(state)
      if (!inRange(action.index)) throw illegal(`ninemens.illegal.point:${String(action.index)}`)
      if (state.points[action.index] !== BLACK) throw illegal(`ninemens.illegal.not-yours:${action.index}`)
      // 选中只是界面状态：不清日志、不计步、不换手
      return { ...state, selected: state.selected === action.index ? null : action.index }
    }

    case 'place':
    case 'move':
    case 'remove': {
      assertPlaying(state)
      // 白方应手用的游标是「本回合开始前」的值：applyAction 之后游标才 +1
      const cursor = state.rngCursor
      // 落子/移动之后旧选中没有意义；吃子阶段也清除选中，避免高亮误导
      const cleared: NinemensState = { ...state, selected: null }
      const next = applyAction(cleared, action).state
      return resolveOpponent(next, cursor)
    }

    case 'undo': {
      const { blackTurnStarts } = deriveWithMeta(state.seed, state.difficulty, state.log)
      const start = blackTurnStarts[blackTurnStarts.length - 1]
      if (start === undefined) throw illegal('ninemens.illegal.nothing-to-undo')
      const reverted = deriveState(state.seed, state.difficulty, state.log.slice(0, start))
      // 选中只有在「撤销后仍然是黑方自己的子」时才保留，否则清掉
      const selected =
        reverted.selected !== null &&
        inRange(reverted.selected) &&
        reverted.points[reverted.selected] === BLACK
          ? reverted.selected
          : null
      return { ...reverted, selected }
    }

    case 'restart':
      // 同种子重开：回到空盘（对局结束后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      const unknown = action as { type?: unknown }
      throw illegal(`ninemens.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: NinemensState): NinemensAction[] {
  const out: NinemensAction[] = []
  if (!isOver(state)) out.push(...rawActions(state))
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。判据顺序：
 * 1. 非点位 / 越界 → null；
 * 2. 正等吃子（pendingRemove > 0）→ 点到**可吃的对方子**给 remove，否则 null；
 * 3. 落子期 → 空点位给 place，已占用 → null；
 * 4. 移动/飞子期 → 点自己的子给 select（选中/改选）；
 *    点到「已选中那一步能到的空点」给 move，其余 → null（只提供当前合法的那一步）。
 */
export function selectAction(state: NinemensState, index: number): NinemensAction | null {
  if (isOver(state)) return null
  if (!inRange(index)) return null
  if (state.pendingRemove > 0) {
    const victim = otherPlayer(state.turn)
    if (state.points[index] !== victim) return null
    const removable = rawActions(state)
    return removable.some((action) => action.type === 'remove' && action.index === index)
      ? { type: 'remove', index }
      : null
  }
  if (state.phase === 'placing') {
    return state.points[index] === null ? { type: 'place', index } : null
  }
  if (state.points[index] === state.turn) return { type: 'select', index }
  if (state.points[index] === null && state.selected !== null) {
    const legal = rawActions(state).some(
      (action) => action.type === 'move' && action.from === state.selected && action.to === index,
    )
    if (legal) return { type: 'move', from: state.selected, to: index }
  }
  return null
}

export function encodeState(state: NinemensState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    points: [...state.points],
    inHand: { ...state.inHand },
    removed: { ...state.removed },
    turn: state.turn,
    phase: state.phase,
    pendingRemove: state.pendingRemove,
    selected: state.selected,
    moves: state.moves,
    rngCursor: state.rngCursor,
    log: state.log.map((entry) => ({ ...entry })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`ninemens.illegal.state:${field}`)
  }
  return value
}

function readPoints(value: unknown): (Player | null)[] {
  if (!Array.isArray(value) || value.length !== POINT_COUNT) {
    throw illegal('ninemens.illegal.state:points')
  }
  return value.map((item) => {
    if (item === null) return null
    if (item === BLACK || item === WHITE) return item
    throw illegal('ninemens.illegal.state:points')
  })
}

function readSideCount(value: unknown, field: string): Record<Player, number> {
  if (!value || typeof value !== 'object') throw illegal(`ninemens.illegal.state:${field}`)
  const record = value as { black?: unknown; white?: unknown }
  return {
    black: readCount(record.black, field),
    white: readCount(record.white, field),
  }
}

function readLog(value: unknown): LoggedAction[] {
  if (!Array.isArray(value)) throw illegal('ninemens.illegal.state:log')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw illegal('ninemens.illegal.state:log')
    const entry = item as { type?: unknown; index?: unknown; from?: unknown; to?: unknown }
    if (entry.type === 'place' || entry.type === 'remove') {
      const index = readCount(entry.index, 'log')
      if (index >= POINT_COUNT) throw illegal('ninemens.illegal.state:log')
      return { type: entry.type, index }
    }
    if (entry.type === 'move') {
      const from = readCount(entry.from, 'log')
      const to = readCount(entry.to, 'log')
      if (from >= POINT_COUNT || to >= POINT_COUNT) throw illegal('ninemens.illegal.state:log')
      return { type: 'move', from, to }
    }
    throw illegal('ninemens.illegal.state:log')
  })
}

function samePoints(a: readonly (Player | null)[], b: readonly (Player | null)[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * 严格校验存档：从 `(seed, difficulty, log)` 重放并逐字段比对。
 * 重放会拒绝非法日志（占位已满还落子、跨线移动、乱吃子），
 * 比对则拒绝「凭空多一个子」「阶段不对」「pendingRemove 不对」这类篡改。
 */
export function decodeState(raw: unknown): NinemensState {
  if (!raw || typeof raw !== 'object') throw illegal('ninemens.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    points: unknown
    inHand: unknown
    removed: unknown
    turn: unknown
    phase: unknown
    pendingRemove: unknown
    selected: unknown
    moves: unknown
    rngCursor: unknown
    log: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('ninemens.illegal.state:seed')
  const log = readLog(value.log)
  const derived = deriveWithMeta(seed, difficulty, log)

  const points = readPoints(value.points)
  if (!samePoints(points, derived.state.points)) {
    throw illegal('ninemens.illegal.state:points-mismatch')
  }
  const inHand = readSideCount(value.inHand, 'inHand')
  if (inHand.black !== derived.state.inHand.black || inHand.white !== derived.state.inHand.white) {
    throw illegal('ninemens.illegal.state:in-hand-mismatch')
  }
  const removed = readSideCount(value.removed, 'removed')
  if (removed.black !== derived.state.removed.black || removed.white !== derived.state.removed.white) {
    throw illegal('ninemens.illegal.state:removed-mismatch')
  }
  // 不变量：在场 + 被吃 + 手上 = 9（存档里也必须成立）
  for (const player of [BLACK, WHITE] as const) {
    const onBoard = points.filter((owner) => owner === player).length
    if (onBoard + removed[player] + inHand[player] !== STONES_PER_SIDE) {
      throw illegal('ninemens.illegal.state:stone-invariant')
    }
  }
  const turn = value.turn === BLACK || value.turn === WHITE ? value.turn : null
  if (turn === null || turn !== derived.state.turn) {
    throw illegal('ninemens.illegal.state:turn-mismatch')
  }
  const phase = value.phase
  if (phase !== 'placing' && phase !== 'moving' && phase !== 'flying') {
    throw illegal('ninemens.illegal.state:phase')
  }
  if (phase !== derived.state.phase) throw illegal('ninemens.illegal.state:phase-mismatch')
  const pendingRemove = readCount(value.pendingRemove, 'pendingRemove')
  if (pendingRemove !== derived.state.pendingRemove) {
    throw illegal('ninemens.illegal.state:pending-mismatch')
  }
  const moves = readCount(value.moves, 'moves')
  if (moves !== derived.state.moves) throw illegal('ninemens.illegal.state:moves-mismatch')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (rngCursor !== derived.state.rngCursor) {
    throw illegal('ninemens.illegal.state:cursor-mismatch')
  }
  // `selected` 是界面状态：只做弱校验（必须是空或是黑方自己的子）
  const selected =
    value.selected === null || value.selected === undefined
      ? null
      : readCount(value.selected, 'selected')
  if (selected !== null) {
    if (selected >= POINT_COUNT) throw illegal('ninemens.illegal.state:selected')
    if (points[selected] !== BLACK || derived.state.turn !== BLACK) {
      throw illegal('ninemens.illegal.state:selected')
    }
  }
  return { ...derived.state, selected }
}
