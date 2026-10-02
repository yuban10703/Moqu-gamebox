/**
 * 对局状态与动作执行（纯函数，无副作用）。
 *
 * 三件事让壳层不需要认识任何玩法：
 * 1. 玩家只派发 `place`：白方的应手在**同一次 reduce 内**算完（见 `resolveTurn`），
 *    因此壳层不必驱动 AI，也不存在「等白方走棋」的中间态；
 * 2. `undo` 撤销**一整回合**（玩家 + 白方两手）：靠快照栈回到玩家上次落子之前；
 * 3. `restart` 无条件接受（壳层的结果面板/暂停菜单会直接派发）。
 *
 * 确定性：白方用 `createRng(seed + 游标)` 选点，同 seed + 同玩家动作序列必然得到同一局面。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  countDiscs,
  createInitialBoard,
  isTerminal,
  legalMovesFor,
  placeDisc,
  type Disc,
  type Side,
} from './board.js'
import { chooseOpponentMove } from './ai.js'
import { REVERSI_ID, difficultyOrThrow, type DifficultyId } from './meta.js'

export type ReversiAction =
  /** 在 index 落黑子（玩家）。非法落子抛 IllegalActionError，由壳层给出明确提示 */
  | { type: 'place'; index: number }
  /** 撤销一整回合：回到玩家上次落子之前（白方的应手一起退回） */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/**
 * 一次过手的提示。存语义标记而不是文案，文案由 view 映射成 i18n key。
 * - opponentPass：白方无处可下，已跳过
 * - playerPass：黑方（玩家）无处可下，已自动跳过
 */
export type ReversiNotice = 'opponentPass' | 'playerPass'

/** 一步快照：撤销的粒度是「一整回合」，所以只需在玩家落子前留档 */
export interface ReversiSnapshot {
  board: readonly Disc[]
  turn: Side
  rngCursor: number
  moves: number
  notice: ReversiNotice | null
}

export interface ReversiState extends ReversiSnapshot {
  difficulty: DifficultyId
  seed: number
  /** 玩家每次落子前的快照栈；`history.length` 恒等于 `moves` */
  history: readonly ReversiSnapshot[]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(REVERSI_ID, reason)
}

export function createState(seed: number, difficulty: DifficultyId): ReversiState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    board: createInitialBoard(),
    turn: BLACK,
    rngCursor: 0,
    moves: 0,
    notice: null,
    history: [],
  }
}

function snapshotOf(state: ReversiState): ReversiSnapshot {
  return {
    board: state.board.slice(),
    turn: state.turn,
    rngCursor: state.rngCursor,
    moves: state.moves,
    notice: state.notice,
  }
}

/**
 * 终局判定只看棋子数；但 GameStatus 只有三态。
 * 平局取 `won`：壳层**只在 status === 'won' 时**才展示结果面板（`session.solved`），
 * 若把平局算作 lost，玩家在棋盘下满/双方都无处可下后将看不到任何终局提示。
 * 真实结果由 `view()` 的标题说明（平局用 `reversi.draw.title`），
 * 进度也按「完成该难度」记录，符合「没有输就是过关」的宽松口径。
 */
export function gameStatus(state: ReversiState): GameStatus {
  if (!isTerminal(state.board)) return 'playing'
  const { black, white } = countDiscs(state.board)
  return black >= white ? 'won' : 'lost'
}

/**
 * 玩家落子后把「过手 + 白方应手」一次算完，直到重新轮到玩家或对局结束。
 * 循环一定收敛：每轮要么落一子（最多 60 手），要么过手；双方都过手时 isTerminal 立刻成立。
 */
function resolveTurn(state: ReversiState): ReversiState {
  let board = state.board
  let turn = state.turn
  let rngCursor = state.rngCursor
  let notice = state.notice
  let guard = 0
  while (guard++ < 4 * CELLS) {
    if (isTerminal(board)) break
    const moves = legalMovesFor(board, turn)
    if (moves.length === 0) {
      // 无棋可下必须自动过手（黑白棋规则），提示文案由 view 映射
      notice = turn === WHITE ? 'opponentPass' : 'playerPass'
      turn = turn === WHITE ? BLACK : WHITE
      continue
    }
    if (turn === BLACK) break // 重新轮到玩家，把控制权交回壳层
    const choice = chooseOpponentMove(state.difficulty, board, state.seed, rngCursor)
    if (choice === null) throw illegal('opponent stuck')
    const placed = placeDisc(board, choice, WHITE)
    if (placed === null) throw illegal(`opponent illegal move: ${choice}`)
    board = placed.board
    // 每落一手白棋游标 +1（与难度无关），保证 decode 的棋子数不变量成立
    rngCursor += 1
    turn = BLACK
  }
  return { ...state, board, turn, rngCursor, notice }
}

function assertPlayable(state: ReversiState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

export function reduceReversi(state: ReversiState, action: ReversiAction): ReversiState {
  switch (action.type) {
    case 'place': {
      assertPlayable(state)
      const index = action.index
      if (!Number.isInteger(index) || index < 0 || index >= CELLS) {
        throw illegal(`reversi.illegal.index:${String(index)}`)
      }
      if (state.board[index] !== EMPTY) throw illegal(`reversi.illegal.occupied:${index}`)
      const placed = placeDisc(state.board, index, BLACK)
      // 夹不住任何棋子：明确拒绝并保留提示，而不是让盘面进入奇怪状态
      if (placed === null) throw illegal(`reversi.illegal.blocked:${index}`)
      const next: ReversiState = {
        ...state,
        board: placed.board,
        turn: WHITE,
        moves: state.moves + 1,
        notice: null,
        history: [...state.history, snapshotOf(state)],
      }
      return resolveTurn(next)
    }

    case 'undo': {
      const previous = state.history[state.history.length - 1]
      if (previous === undefined) throw illegal('reversi.illegal.nothing-to-undo')
      // 连白方的应手一起退回：快照取的是玩家落子之前，因此 board/turn/游标/提示一次还原
      return {
        ...state,
        board: previous.board,
        turn: previous.turn,
        rngCursor: previous.rngCursor,
        moves: previous.moves,
        notice: previous.notice,
        history: state.history.slice(0, -1),
      }
    }

    case 'restart':
      // 同难度同种子重开：回到初始局面，历史清空（输赢后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`reversi.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: ReversiState): ReversiAction[] {
  const actions: ReversiAction[] = []
  if (gameStatus(state) === 'playing') {
    for (const index of legalMovesFor(state.board, BLACK)) actions.push({ type: 'place', index })
  }
  if (state.history.length > 0) actions.push({ type: 'undo' })
  actions.push({ type: 'restart' })
  return actions
}

/**
 * 「点了第 index 个格子」→ 动作。
 * - 越界/已占用的格子返回 null：点了没反应比弹错误自然（手机端误触很常见）；
 * - 夹不住子的空格**照样**返回 place，让 reduce 抛错、壳层给出明确文字反馈。
 */
export function selectAction(state: ReversiState, index: number): ReversiAction | null {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return null
  if (gameStatus(state) !== 'playing') return null
  if (state.board[index] !== EMPTY) return null
  return { type: 'place', index }
}

export function encodeState(state: ReversiState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    turn: state.turn,
    rngCursor: state.rngCursor,
    moves: state.moves,
    notice: state.notice,
    history: state.history.map((snapshot) => ({
      board: [...snapshot.board],
      turn: snapshot.turn,
      rngCursor: snapshot.rngCursor,
      moves: snapshot.moves,
      notice: snapshot.notice,
    })),
  }
}

function readBoard(value: unknown, field: string): Disc[] {
  if (!Array.isArray(value) || value.length !== CELLS) throw illegal(`reversi.illegal.state:${field}`)
  const board: Disc[] = []
  for (const cell of value) {
    if (cell !== 0 && cell !== 1 && cell !== 2) throw illegal(`reversi.illegal.state:${field}`)
    board.push(cell as Disc)
  }
  return board
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`reversi.illegal.state:${field}`)
  }
  return value
}

function readSide(value: unknown, field: string): Side {
  if (value !== BLACK && value !== WHITE) throw illegal(`reversi.illegal.state:${field}`)
  return value
}

function readNotice(value: unknown, field: string): ReversiNotice | null {
  if (value === null || value === undefined) return null
  if (value !== 'opponentPass' && value !== 'playerPass') {
    throw illegal(`reversi.illegal.state:${field}`)
  }
  return value
}

/**
 * 棋子增殖不变量：初始 4 子，此后每手（玩家的 place、白方的应手）恰好 +1 子，
 * 过手不加子，因此 `棋子总数 = 4 + moves + rngCursor` 在三档难度下都成立。
 */
function assertDiscTotal(board: readonly Disc[], moves: number, cursor: number, field: string): void {
  const { empty } = countDiscs(board)
  if (empty !== CELLS - (4 + moves + cursor)) throw illegal(`reversi.illegal.state:${field}`)
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 * 除了字段类型与取值，还复核四条不变量：
 * 1. 棋子总数 = 4（初始四子）+ 玩家步数 + 白方手数（游标）：每手恰好增殖一子；
 * 2. `history.length === moves`：每次玩家落子恰好留一份快照；
 * 3. 快照按手数递增、游标单调不减，且都停在轮到玩家的时候；
 * 4. 非终局状态必须轮到黑方且黑方有棋可下（resolveTurn 的出口只有这两种）。
 * decode 只搬运存档里的盘面，不会重放随机数重算白方着法。
 */
export function decodeState(raw: unknown): ReversiState {
  if (!raw || typeof raw !== 'object') throw illegal('reversi.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    board: unknown
    turn: unknown
    rngCursor: unknown
    moves: unknown
    notice: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('reversi.illegal.state:seed')
  const board = readBoard(value.board, 'board')
  const turn = readSide(value.turn, 'turn')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  const moves = readCount(value.moves, 'moves')
  const notice = readNotice(value.notice, 'notice')

  if (!Array.isArray(value.history)) throw illegal('reversi.illegal.state:history')
  const history: ReversiSnapshot[] = (value.history as unknown[]).map((entry, position) => {
    if (!entry || typeof entry !== 'object') throw illegal('reversi.illegal.state:history-entry')
    const snapshot = entry as Partial<Record<keyof ReversiSnapshot, unknown>>
    const snapshotBoard = readBoard(snapshot.board, 'history-board')
    // 快照永远是「玩家该落子」的瞬间留下的
    const snapshotTurn = readSide(snapshot.turn, 'history-turn')
    if (snapshotTurn !== BLACK) throw illegal('reversi.illegal.state:history-turn')
    const snapshotCursor = readCount(snapshot.rngCursor, 'history-cursor')
    const snapshotMoves = readCount(snapshot.moves, 'history-moves')
    const snapshotNotice = readNotice(snapshot.notice, 'history-notice')
    if (snapshotMoves !== position) throw illegal('reversi.illegal.state:history-order')
    assertDiscTotal(snapshotBoard, snapshotMoves, snapshotCursor, 'history-disc-count')
    return {
      board: snapshotBoard,
      turn: BLACK,
      rngCursor: snapshotCursor,
      moves: snapshotMoves,
      notice: snapshotNotice,
    }
  })

  if (history.length !== moves) throw illegal('reversi.illegal.state:history-length')
  assertDiscTotal(board, moves, rngCursor, 'disc-count')
  // 快照的游标必须单调不减，且不超过当前游标（否则是手改过的存档）
  let previousCursor = 0
  for (const snapshot of history) {
    if (snapshot.rngCursor < previousCursor) throw illegal('reversi.illegal.state:cursor-order')
    previousCursor = snapshot.rngCursor
  }
  if (rngCursor < previousCursor) throw illegal('reversi.illegal.state:cursor-order')
  if (!isTerminal(board)) {
    if (turn !== BLACK) throw illegal('reversi.illegal.state:turn')
    if (legalMovesFor(board, BLACK).length === 0) throw illegal('reversi.illegal.state:stuck')
  }

  return { difficulty, seed, board, turn, rngCursor, moves, notice, history }
}
