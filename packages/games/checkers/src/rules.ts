/**
 * 跳棋规则层：状态、走子/吃子/连跳、白方自动应手、撤销与存档编解码（纯函数，无副作用）。
 *
 * 核心设计（与 pegsolitaire/记忆配对同一套「动作日志即存档」思路）：
 * - 状态里除了材料化好的棋盘，还保存**双方所有落子的动作日志** `log`；
 *   棋盘/轮次/连跳状态/步数/游标/无进展回合数全部可以由 `(seed, difficulty, log)` 重放出来。
 *   于是 decode 可以「重放并逐字段比对」：棋子凭空变化、pendingFrom 指向非法子、
 *   白方连续两手这类坏数据在重放时就会因为「着法非法」被拒绝 —— 绝不会出现「decode 拒绝自己状态」。
 * - `undo` = 把日志截断到最近一次**黑方回合起点**再重放，因此连跳中途撤销也能精确回到回合开始，
 *   且撤销会连同白方的应手一起退回（一次撤销 = 一整回合）。
 * - 白方应手在 `move` 的同一次 reduce 内算完：壳层不需要驱动 AI，也没有「等白方走棋」的中间态。
 *   应手随机性只来自 `createRng(seed + 白方回合数)`，绝不使用 Math.random。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import { chooseOpponentTurn } from './ai.js'
import {
  BLACK,
  BOARD_SIZE,
  CELLS,
  EMPTY,
  PLAYABLE_INDEXES,
  WHITE,
  applyMove,
  captureMovesFrom,
  countPieces,
  difficultyOrThrow,
  initialBoard,
  isPlayable,
  legalMovesFor,
  normalizeSeed,
  otherSide,
  promoteAt,
  sideOf,
  type DifficultyId,
  type Piece,
  type Side,
} from './board.js'

export type CheckersAction =
  /** 选中/取消选中自己的棋子（选中是界面状态，不计步、不进日志） */
  | { type: 'select'; index: number }
  /** 一步走/吃（连跳的每一步都用它）；连跳未完成时只接受 pendingFrom 的后续吃子 */
  | { type: 'move'; from: number; to: number }
  /** 撤回一整回合（玩家一步 + 白方应手，含连跳的全部步骤） */
  | { type: 'undo' }
  /** 重开：回到起始局面。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

/** 日志里的一步（只有起止点；被吃的子在重放时现算） */
export interface Step {
  readonly from: number
  readonly to: number
}

export interface CheckersState {
  readonly difficulty: DifficultyId
  /** 应手种子：同 seed + 同动作序列必然得到同一局面 */
  readonly seed: number
  readonly board: readonly Piece[]
  /** 当前该谁走。可对局时恒为黑方（白方应手在同一次 reduce 内算完） */
  readonly turn: Side
  /** 连跳中：必须继续用这枚棋子吃子；null 表示回合已结束或还没开始吃 */
  readonly pendingFrom: number | null
  /** 玩家当前选中的棋子（界面状态，不参与重放） */
  readonly selected: number | null
  /** 玩家步数：一个回合算一步（连跳算一步） */
  readonly moves: number
  /** 已应手过的白方回合数：白方每回合用 createRng(seed + 该值) 取一次随机流 */
  readonly rngCursor: number
  /** 连续没有吃子/升王的半回合数，达到 DRAW_PLIES 判和（和三态里的 draw） */
  readonly noProgressPlies: number
  /** 上一步（黑白都算），用于棋盘上标出「上一步」 */
  readonly lastMove: Step | null
  /** 双方全部落子的动作日志（连跳的每一步都在里面） */
  readonly log: readonly Step[]
}

/** 40 个半回合（双方各 20 步）没有吃子/升王即判和：避免残局无限磨棋 */
export const DRAW_PLIES = 80

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError('checkers', reason)
}

/** 起始局面：双方各 12 枚兵；本玩法没有随机性，难度只影响白方强度 */
export function createState(seed: number, difficulty: DifficultyId): CheckersState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    board: initialBoard(),
    turn: BLACK,
    pendingFrom: null,
    selected: null,
    moves: 0,
    rngCursor: 0,
    noProgressPlies: 0,
    lastMove: null,
    log: [],
  }
}

interface DerivedShape {
  readonly state: CheckersState
  /** 每一次黑方回合在 log 中的起始下标（撤销按它截断） */
  readonly blackTurnStarts: readonly number[]
}

/**
 * 单步落子：校验合法性 → 落子/吃子 → 判定连跳或回合结束（升王、换边、游标推进）。
 * reduce 与 decode 重放共用它，保证两条路径语义完全一致。
 */
function applyStep(state: CheckersState, step: Step): CheckersState {
  const side = state.turn
  const legal =
    state.pendingFrom !== null
      ? captureMovesFrom(state.board, state.pendingFrom)
      : legalMovesFor(state.board, side)
  const move = legal.find((item) => item.from === step.from && item.to === step.to)
  if (move === undefined) throw illegal(`checkers.illegal.move:${step.from}->${step.to}`)

  const board = applyMove(state.board, move)
  const captured = move.captured !== null
  let noProgressPlies = captured ? 0 : state.noProgressPlies + 1
  const log = [...state.log, { from: step.from, to: step.to }]

  if (captured && captureMovesFrom(board, step.to).length > 0) {
    // 还有后续吃子：连跳强制继续，轮次与步数都不变
    return {
      ...state,
      board,
      pendingFrom: step.to,
      selected: null,
      noProgressPlies,
      lastMove: step,
      log,
    }
  }

  // 回合结束：先升王（连跳途中经过底线不升级），再换边
  let finalBoard = board
  const promoted = promoteAt(finalBoard, step.to)
  if (promoted !== null) {
    finalBoard = promoted
    noProgressPlies = 0
  }
  const moves = side === BLACK ? state.moves + 1 : state.moves
  const turn = otherSide(side)
  // 白方每回合消耗一次随机流：在「轮到白方」时推进游标，重放与 reduce 都会走到这一步
  const rngCursor = turn === WHITE ? state.rngCursor + 1 : state.rngCursor
  return {
    ...state,
    board: finalBoard,
    turn,
    pendingFrom: null,
    selected: null,
    moves,
    rngCursor,
    noProgressPlies,
    lastMove: step,
    log,
  }
}

/** 从 `(seed, difficulty, log)` 重放出一个完整状态；非法日志抛 IllegalActionError */
export function deriveWithMeta(
  seed: number,
  difficulty: DifficultyId,
  log: readonly Step[],
): DerivedShape {
  let state = createState(seed, difficulty)
  const blackTurnStarts: number[] = []
  for (let index = 0; index < log.length; index++) {
    if (state.turn === BLACK && state.pendingFrom === null) blackTurnStarts.push(index)
    state = applyStep(state, log[index]!)
  }
  return { state, blackTurnStarts }
}

export function deriveState(
  seed: number,
  difficulty: DifficultyId,
  log: readonly Step[],
): CheckersState {
  return deriveWithMeta(seed, difficulty, log).state
}

/**
 * 白方应手：`cursor` 是本回合开始前已应手过的白方回合数。
 * 只有轮到白方且对局未结束时才应手；连跳会在循环里逐步走完。
 */
function resolveOpponent(state: CheckersState, cursor: number): CheckersState {
  if (state.turn !== WHITE) return state
  if (gameStatus(state) !== 'playing') return state
  const turn = chooseOpponentTurn(state.difficulty, state.board, state.seed, cursor)
  let current = state
  for (const move of turn) current = applyStep(current, { from: move.from, to: move.to })
  return current
}

/**
 * 胜负判定：子被吃光或无子可动即负；`noProgressPlies` 达到上限判和。
 * 和三态协议只有 playing/won/lost，平局并入 `won`（与黑白棋、五子棋同一取舍），
 * 真实结果由 `outcomeOf` 给结果页用。
 */
export function gameStatus(state: CheckersState): GameStatus {
  const { black, white } = countPieces(state.board)
  if (black === 0) return 'lost'
  if (white === 0) return 'won'
  if (legalMovesFor(state.board, state.turn).length === 0) {
    return state.turn === BLACK ? 'lost' : 'won'
  }
  if (state.noProgressPlies >= DRAW_PLIES) return 'won'
  return 'playing'
}

/** 真实结果（结果页标题用）：won / lost / draw */
export function outcomeOf(state: CheckersState): 'won' | 'lost' | 'draw' {
  const { black, white } = countPieces(state.board)
  if (black === 0) return 'lost'
  if (white === 0) return 'won'
  if (legalMovesFor(state.board, state.turn).length === 0) {
    return state.turn === BLACK ? 'lost' : 'won'
  }
  if (state.noProgressPlies >= DRAW_PLIES) return 'draw'
  return 'won'
}

function assertPlayable(state: CheckersState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

export function reduceCheckers(state: CheckersState, action: CheckersAction): CheckersState {
  switch (action.type) {
    case 'select': {
      assertPlayable(state)
      // 连跳中不能改选：必须把这次连跳走完
      if (state.pendingFrom !== null) throw illegal('checkers.illegal.must-continue')
      if (!isPlayable(action.index)) throw illegal(`checkers.illegal.select:${String(action.index)}`)
      const piece = state.board[action.index]!
      if (sideOf(piece) === state.turn) {
        return {
          ...state,
          selected: state.selected === action.index ? null : action.index,
        }
      }
      // 点空格或对方棋子 = 清除选中（点了没反应比报错自然）
      return { ...state, selected: null }
    }

    case 'move': {
      assertPlayable(state)
      // 白方应手用的游标是「本回合开始前」的值：applyStep 之后游标才 +1
      const cursor = state.rngCursor
      const next = applyStep(state, { from: action.from, to: action.to })
      return resolveOpponent(next, cursor)
    }

    case 'undo': {
      const { blackTurnStarts } = deriveWithMeta(state.seed, state.difficulty, state.log)
      const start = blackTurnStarts[blackTurnStarts.length - 1]
      if (start === undefined) throw illegal('checkers.illegal.nothing-to-undo')
      // 截断到最近一次黑方回合起点：玩家这一步与白方应手一起退回
      return deriveState(state.seed, state.difficulty, state.log.slice(0, start))
    }

    case 'restart':
      // 同难度同种子重开：回到起始局面（输/赢后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`checkers.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: CheckersState): CheckersAction[] {
  const out: CheckersAction[] = []
  if (gameStatus(state) === 'playing') {
    if (state.pendingFrom !== null) {
      // 连跳中：只允许这枚棋子的后续吃子
      for (const move of captureMovesFrom(state.board, state.pendingFrom)) {
        out.push({ type: 'move', from: move.from, to: move.to })
      }
    } else {
      for (const move of legalMovesFor(state.board, state.turn)) {
        out.push({ type: 'move', from: move.from, to: move.to })
      }
      for (const index of PLAYABLE_INDEXES) {
        if (sideOf(state.board[index]!) === state.turn) out.push({ type: 'select', index })
      }
    }
  }
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 *
 * - 连跳中：只提供 pendingFrom 的后续吃子落点（其余一律 null）—— 玩家不可能点到必然抛错的位置；
 * - 点自己的棋子 → select（选中/取消）；
 * - 已选中且 index 是**当前合法着法的落点** → move（强制吃子时只给吃子落点）；
 * - 已选中但 index 不是落点 → select（改选/清除）；
 * - 点空格且没有选中 → null（点了没反应）。
 */
export function selectAction(state: CheckersState, index: number): CheckersAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!isPlayable(index)) return null
  if (state.pendingFrom !== null) {
    const continuation = captureMovesFrom(state.board, state.pendingFrom)
    return continuation.some((move) => move.to === index)
      ? { type: 'move', from: state.pendingFrom, to: index }
      : null
  }
  if (sideOf(state.board[index]!) === state.turn) return { type: 'select', index }
  if (state.selected !== null) {
    const legal = legalMovesFor(state.board, state.turn).filter(
      (move) => move.from === state.selected,
    )
    if (legal.some((move) => move.to === index)) {
      return { type: 'move', from: state.selected, to: index }
    }
    return { type: 'select', index }
  }
  return null
}

export function encodeState(state: CheckersState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    turn: state.turn,
    pendingFrom: state.pendingFrom,
    selected: state.selected,
    moves: state.moves,
    rngCursor: state.rngCursor,
    noProgressPlies: state.noProgressPlies,
    lastMove: state.lastMove === null ? null : { from: state.lastMove.from, to: state.lastMove.to },
    log: state.log.map((step) => ({ from: step.from, to: step.to })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`checkers.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  const index = readCount(value, field)
  if (index >= CELLS) throw illegal(`checkers.illegal.state:${field}`)
  return index
}

function readBoard(value: unknown): Piece[] {
  if (!Array.isArray(value) || value.length !== CELLS) {
    throw illegal('checkers.illegal.state:board')
  }
  const board: Piece[] = []
  for (let index = 0; index < CELLS; index++) {
    const piece = value[index]
    if (piece !== 0 && piece !== 1 && piece !== 2 && piece !== 3 && piece !== 4) {
      throw illegal('checkers.illegal.state:board')
    }
    if (piece !== EMPTY && !isPlayable(index)) throw illegal('checkers.illegal.state:board')
    board.push(piece)
  }
  return board
}

function readSide(value: unknown): Side {
  if (value === BLACK) return BLACK
  if (value === WHITE) return WHITE
  throw illegal('checkers.illegal.state:turn')
}

function readLog(value: unknown): Step[] {
  if (!Array.isArray(value)) throw illegal('checkers.illegal.state:log')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw illegal('checkers.illegal.state:log-entry')
    const step = entry as { from?: unknown; to?: unknown }
    return { from: readIndex(step.from, 'log-from'), to: readIndex(step.to, 'log-to') }
  })
}

function readNullableIndex(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  return readIndex(value, field)
}

function readLastMove(value: unknown): Step | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') throw illegal('checkers.illegal.state:lastMove')
  const step = value as { from?: unknown; to?: unknown }
  return { from: readIndex(step.from, 'lastMove-from'), to: readIndex(step.to, 'lastMove-to') }
}

function readSelected(value: unknown, board: readonly Piece[]): number | null {
  if (value === null || value === undefined) return null
  const index = readIndex(value, 'selected')
  // 选中的必须是自己的（黑方）棋子
  if (sideOf(board[index]!) !== BLACK) throw illegal('checkers.illegal.state:selected')
  return index
}

function sameStep(a: Step | null, b: Step | null): boolean {
  if (a === null || b === null) return a === b
  return a.from === b.from && a.to === b.to
}

/**
 * 严格校验存档：从 `(seed, difficulty, log)` 重放，并逐字段比对存档里的材料化状态。
 * 重放本身会拒绝一切非法着法（含「白方连续两手」「棋子凭空变化」这类篡改），
 * 因此这里不需要再手工罗列规则不变量。
 */
export function decodeState(raw: unknown): CheckersState {
  if (!raw || typeof raw !== 'object') throw illegal('checkers.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    board: unknown
    turn: unknown
    pendingFrom: unknown
    selected: unknown
    moves: unknown
    rngCursor: unknown
    noProgressPlies: unknown
    lastMove: unknown
    log: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('checkers.illegal.state:seed')
  const log = readLog(value.log)
  const derived = deriveWithMeta(seed, difficulty, log)

  const board = readBoard(value.board)
  if (!board.every((piece, index) => piece === derived.state.board[index])) {
    throw illegal('checkers.illegal.state:board-mismatch')
  }
  const turn = readSide(value.turn)
  if (turn !== derived.state.turn) throw illegal('checkers.illegal.state:turn-mismatch')
  const pendingFrom = readNullableIndex(value.pendingFrom, 'pendingFrom')
  if (pendingFrom !== derived.state.pendingFrom) {
    throw illegal('checkers.illegal.state:pending-mismatch')
  }
  const moves = readCount(value.moves, 'moves')
  if (moves !== derived.state.moves) throw illegal('checkers.illegal.state:moves-mismatch')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (rngCursor !== derived.state.rngCursor) {
    throw illegal('checkers.illegal.state:cursor-mismatch')
  }
  const noProgressPlies = readCount(value.noProgressPlies, 'noProgressPlies')
  if (noProgressPlies !== derived.state.noProgressPlies) {
    throw illegal('checkers.illegal.state:progress-mismatch')
  }
  const lastMove = readLastMove(value.lastMove)
  if (!sameStep(lastMove, derived.state.lastMove)) {
    throw illegal('checkers.illegal.state:last-move-mismatch')
  }
  // 可对局时必然是黑方该走（白方应手在同一次 reduce 内算完，不会把控制权交出去）
  if (gameStatus(derived.state) === 'playing' && derived.state.turn !== BLACK) {
    throw illegal('checkers.illegal.state:white-to-move')
  }
  const selected = readSelected(value.selected, derived.state.board)
  return { ...derived.state, selected }
}

/** 棋盘尺寸/格数的常量导出，供视图与测试复用 */
export { BOARD_SIZE }
