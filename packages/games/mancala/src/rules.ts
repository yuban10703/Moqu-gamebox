/**
 * 播棋规则层：动作、白方自动应手、撤销一整回合与存档编解码（纯函数，无副作用）。
 *
 * 与 dotsboxes / battleship 同一套「动作日志即存档」：
 * - 日志只记「播了哪个坑」；轮到谁由规则推出（连走或换手），因此重放可以完整复算；
 * - `undo` 把日志截断到最近一次**黑方回合起点**再重放：玩家的连走与白方应手一起退回；
 * - `decode` 从 `(seed, difficulty, log)` 复算 14 格石子、轮次、步数、游标与终局结算，
 *   被篡改的「凭空多几颗石子」「仓里石子不对」都会被拒绝。
 *
 * 白方应手在同一次 reduce 内算完（含连走）；随机只来自 `createRng(seed + 白方回合数)`。
 */
import { IllegalActionError, createRng, type GameStatus } from '@eink/core'
import { choosePit } from './ai.js'
import {
  BLACK,
  CELLS,
  WHITE,
  createBoardState,
  difficultyOrThrow,
  isFinished,
  isPit,
  inRange,
  legalPits,
  pitIndexes,
  sowOnce,
  storeCount,
  totalStones,
  type DifficultyId,
  type MancalaState,
} from './board.js'

export type MancalaAction =
  /** 从自己的某个坑播种。空坑 / 对手的坑 / 仓 / 越界 / 终局都抛 IllegalActionError */
  | { type: 'sow'; index: number }
  /** 撤回一整回合（玩家的连走 + 白方应手）。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到同种子的初始摆法。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError('mancala', reason)
}

export function createState(seed: number, difficulty: DifficultyId): MancalaState {
  return createBoardState(seed, difficulty)
}

/**
 * 胜负：一方 6 坑全空即结束（结算已完成），比仓中石子：多者胜，相同为平局。
 * 三态协议只有 playing/won/lost，平局并入 `won`（与五子棋、点格棋同一取舍），
 * 真实结果由 `outcomeOf` 给结果页用。
 */
export function gameStatus(state: MancalaState): GameStatus {
  if (!isFinished(state.cells)) return 'playing'
  const mine = storeCount(state.cells, BLACK)
  const theirs = storeCount(state.cells, WHITE)
  return theirs > mine ? 'lost' : 'won'
}

/** 真实结果（结果页标题用）：won / lost / draw */
export function outcomeOf(state: MancalaState): 'won' | 'lost' | 'draw' {
  const mine = storeCount(state.cells, BLACK)
  const theirs = storeCount(state.cells, WHITE)
  if (mine > theirs) return 'won'
  if (mine < theirs) return 'lost'
  return 'draw'
}

function assertPlaying(state: MancalaState): void {
  if (isFinished(state.cells)) throw illegal('game already finished')
}

interface DerivedShape {
  readonly state: MancalaState
  /** 每一次黑方回合在 log 中的起始下标（撤销按它截断） */
  readonly blackTurnStarts: readonly number[]
}

/**
 * 从 `(seed, difficulty, log)` 重放。
 * 连走（落自己仓）保持轮次不变，否则换手；一方无子可走时结算，轮次完全由规则推出。
 */
export function deriveWithMeta(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): DerivedShape {
  let state = createBoardState(seed, difficulty)
  const blackTurnStarts: number[] = []
  let turnStart = true
  for (let index = 0; index < log.length; index++) {
    if (state.turn === BLACK && turnStart) blackTurnStarts.push(index)
    const before = state.turn
    state = sowOnce(state, log[index]!).state
    // 换手了 ⇒ 下一条是新回合；连走则仍是同一回合
    turnStart = state.turn !== before
  }
  return { state, blackTurnStarts }
}

export function deriveState(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): MancalaState {
  return deriveWithMeta(seed, difficulty, log).state
}

/**
 * 白方应手：`cursor` 是本回合开始前已应手过的白方回合数。
 * 只有轮到白方且对局未结束时才应手；连走（落白方仓）会在循环里走完。
 */
function resolveOpponent(state: MancalaState, cursor: number): MancalaState {
  if (state.turn !== WHITE) return state
  if (isFinished(state.cells)) return state
  const rng = createRng(state.seed + cursor)
  let current = state
  let guard = 0
  while (current.turn === WHITE && !isFinished(current.cells)) {
    // 坑里石子有限，正常不可能走满循环；多一层护栏避免实现出错时死循环
    if (guard++ > CELLS * 4) throw illegal('mancala.illegal.opponent-loop')
    const pit = choosePit(current, current.difficulty, rng)
    current = sowOnce(current, pit).state
  }
  return current
}

export function reduceMancala(state: MancalaState, action: MancalaAction): MancalaState {
  switch (action.type) {
    case 'sow': {
      assertPlaying(state)
      // 白方应手用的游标是「本回合开始前」的值：sowOnce 之后游标才 +1
      const cursor = state.rngCursor
      const next = sowOnce(state, action.index).state
      return resolveOpponent(next, cursor)
    }

    case 'undo': {
      const { blackTurnStarts } = deriveWithMeta(state.seed, state.difficulty, state.log)
      const start = blackTurnStarts[blackTurnStarts.length - 1]
      if (start === undefined) throw illegal('mancala.illegal.nothing-to-undo')
      // 截断到最近一次黑方回合起点：玩家的连走与白方应手一起退回
      return deriveState(state.seed, state.difficulty, state.log.slice(0, start))
    }

    case 'restart':
      // 同种子重开：回到初始摆法（对局结束后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`mancala.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: MancalaState): MancalaAction[] {
  const out: MancalaAction[] = []
  if (!isFinished(state.cells)) {
    for (const pit of legalPits(state, BLACK)) out.push({ type: 'sow', index: pit })
  }
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 只有**自己的非空坑**才返回 sow；仓、对手的坑、空坑、越界都返回 null ——
 * 点了没反应比报错自然，也让壳层不可能点到必然抛错的位置。
 */
export function selectAction(state: MancalaState, index: number): MancalaAction | null {
  if (isFinished(state.cells)) return null
  if (!inRange(index) || !isPit(index)) return null
  if (!pitIndexes(BLACK).includes(index)) return null
  if ((state.cells[index] ?? 0) === 0) return null
  return { type: 'sow', index }
}

export function encodeState(state: MancalaState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    cells: [...state.cells],
    turn: state.turn,
    moves: state.moves,
    rngCursor: state.rngCursor,
    lastPit: state.lastPit,
    log: [...state.log],
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`mancala.illegal.state:${field}`)
  }
  return value
}

function readCells(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== CELLS) {
    throw illegal('mancala.illegal.state:cells')
  }
  return value.map((item) => readCount(item, 'cells'))
}

function readLog(value: unknown): number[] {
  if (!Array.isArray(value)) throw illegal('mancala.illegal.state:log')
  return value.map((item) => {
    const pit = readCount(item, 'log')
    if (pit >= CELLS || !isPit(pit)) throw illegal('mancala.illegal.state:log')
    return pit
  })
}

function sameCells(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * 严格校验存档：从 `(seed, difficulty, log)` 重放，并逐字段比对存档里的材料化状态。
 * 重放会拒绝「选了空坑/对手坑/仓」，比对则拒绝「凭空多几颗石子」「仓里石子不对」
 * 「轮次/步数/游标/终局结算对不上」。
 */
export function decodeState(raw: unknown): MancalaState {
  if (!raw || typeof raw !== 'object') throw illegal('mancala.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    cells: unknown
    turn: unknown
    moves: unknown
    rngCursor: unknown
    lastPit: unknown
    log: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('mancala.illegal.state:seed')
  const log = readLog(value.log)
  const derived = deriveWithMeta(seed, difficulty, log)

  const cells = readCells(value.cells)
  if (!sameCells(cells, derived.state.cells)) {
    throw illegal('mancala.illegal.state:cells-mismatch')
  }
  // 石子守恒：任何合法局面总数都等于初始总数（12 坑 × 4）
  const expectedTotal = totalStones(createBoardState(seed, difficulty).cells)
  if (totalStones(cells) !== expectedTotal) {
    throw illegal('mancala.illegal.state:stone-count')
  }
  const turn = value.turn === BLACK || value.turn === WHITE ? value.turn : null
  if (turn === null || turn !== derived.state.turn) {
    throw illegal('mancala.illegal.state:turn-mismatch')
  }
  const moves = readCount(value.moves, 'moves')
  if (moves !== derived.state.moves) throw illegal('mancala.illegal.state:moves-mismatch')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (rngCursor !== derived.state.rngCursor) {
    throw illegal('mancala.illegal.state:cursor-mismatch')
  }
  const lastPit =
    value.lastPit === null || value.lastPit === undefined ? null : readCount(value.lastPit, 'lastPit')
  if (lastPit !== derived.state.lastPit) {
    throw illegal('mancala.illegal.state:last-pit-mismatch')
  }
  // 可对局时必然是黑方该走（白方应手在同一次 reduce 内算完，不会把控制权交出去）
  if (!isFinished(derived.state.cells) && derived.state.turn !== BLACK) {
    throw illegal('mancala.illegal.state:white-to-move')
  }
  return derived.state
}
