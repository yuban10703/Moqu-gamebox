/**
 * 对局状态与动作执行（纯函数，无副作用）。
 *
 * 现代化改动（相对旧版）：
 * 1. 玩家派发 `place` 只落黑子；白方的应手由壳层定时派发**两拍 tick** 完成 ——
 *    第一拍把选中的落点记进 opponentPick（目标格亮出内框），第二拍才真正落子；
 *    白方无处可下时 opponentPick = -1（过手哨兵），第二拍执行过手并给提示；
 * 2. 黑方（玩家）无处可下时在 tick 第二拍里**自动过手**（黑白棋规则），提示由 view 映射；
 * 3. `undo` 撤销**一整回合**：靠快照栈回到玩家上次落子之前（快照粒度 = 一整回合）；
 * 4. `restart` 无条件接受。
 *
 * 确定性：白方用 `createRng(seed + 游标)` 选点，同 seed + 同玩家动作序列必然得到同一局面。
 * 棋子增殖不变量（decode 用它拒绝篡改）：初始 4 子，此后每手恰好 +1 子、过手不加子，
 * 因此「棋子总数 = 4 + moves + rngCursor」在三档难度下都成立。
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
  /** 自动步进（壳层按 tickMs 定时派发）：第一拍亮出白方选中的落点，第二拍才落子 */
  | { type: 'tick' }
  /** 撤销一整回合：回到玩家上次落子之前（白方的应手一起退回） */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/** 真实结果：黑胜（玩家）/ 白胜（对手）/ 平局 */
export type Outcome = 'black' | 'white' | 'draw'

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
  /** 落这份快照时的最后一手标记（撤销后原位还原，位置标记不丢） */
  lastMove: number | null
}

export interface ReversiState extends ReversiSnapshot {
  difficulty: DifficultyId
  seed: number
  /** 最后一枚落下的棋子（双方都算；过手不更新），用于 AI 末手的内框标记 */
  lastMove: number | null
  /**
   * AI（白方）已经「选中」但还没落下的应手：棋盘格索引，-1 = 白方过手；null = 还没选。
   * 应手分两拍：第一拍 tick 只把这个点记下来（目标格亮出内框），第二拍 tick 才真正落子。
   */
  opponentPick: number | null
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
    lastMove: null,
    opponentPick: null,
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
    lastMove: state.lastMove,
  }
}

/** 白方待应手的中间态：轮到白方且对局未结束 */
function pending(board: readonly Disc[], turn: Side): boolean {
  return turn === WHITE && !isTerminal(board)
}

/**
 * 终局判定只看棋子数；但 GameStatus 只有三态。
 * 平局取 `won`：壳层**只在 status !== 'playing' 时**才展示结果面板，
 * 若把平局算作 lost，玩家在棋盘下满/双方都无处可下后将看到「你输了」这种与事实不符的结论。
 * 真实结果由 `outcomeOf` 与 view 的标题说明（平局用 `reversi.draw.title`）。
 */
export function gameStatus(state: ReversiState): GameStatus {
  const outcome = outcomeOf(state)
  if (outcome === null) return 'playing'
  return outcome === 'white' ? 'lost' : 'won'
}

export function outcomeOf(state: ReversiState): Outcome | null {
  if (!isTerminal(state.board)) return null
  const { black, white } = countDiscs(state.board)
  if (black > white) return 'black'
  if (white > black) return 'white'
  return 'draw'
}

function assertPlayable(state: ReversiState): void {
  if (outcomeOf(state) !== null) throw illegal('reversi.illegal.finished')
}

export function reduceReversi(state: ReversiState, action: ReversiAction): ReversiState {
  switch (action.type) {
    case 'place': {
      assertPlayable(state)
      if (pending(state.board, state.turn)) throw illegal('reversi.illegal.not-your-turn')
      const index = action.index
      if (!Number.isInteger(index) || index < 0 || index >= CELLS) {
        throw illegal(`reversi.illegal.index:${String(index)}`)
      }
      if (state.board[index] !== EMPTY) throw illegal(`reversi.illegal.occupied:${index}`)
      const placed = placeDisc(state.board, index, BLACK)
      // 夹不住任何棋子：明确拒绝并保留提示，而不是让盘面进入奇怪状态
      if (placed === null) throw illegal(`reversi.illegal.blocked:${index}`)
      return {
        ...state,
        board: placed.board,
        turn: WHITE,
        moves: state.moves + 1,
        notice: null,
        lastMove: index,
        history: [...state.history, snapshotOf(state)],
      }
    }

    case 'tick': {
      assertPlayable(state)
      if (!pending(state.board, state.turn)) throw illegal('reversi.illegal.tick-no-turn')
      if (state.opponentPick === null) {
        // 第一拍：只「选中」—— 棋盘一格不动，玩家看到 AI 要在哪里落子
        const reply = chooseOpponentMove(state.difficulty, state.board, state.seed, state.rngCursor)
        if (reply === null) {
          // 白方无处可下：过手（用 -1 当哨兵），第二拍才执行
          return { ...state, opponentPick: -1 }
        }
        if (!Number.isInteger(reply) || reply < 0 || reply >= CELLS) {
          throw illegal(`reversi.illegal.opponent-move:${String(reply)}`)
        }
        if (state.board[reply] !== EMPTY || legalMovesFor(state.board, WHITE).indexOf(reply) < 0) {
          throw illegal(`reversi.illegal.opponent-move:${String(reply)}`)
        }
        return { ...state, opponentPick: reply }
      }
      // 第二拍：真正落子 / 过手。着法在第一拍就算好了，这里只核对它仍然合法
      const pick = state.opponentPick
      if (pick === -1) {
        if (legalMovesFor(state.board, WHITE).length !== 0) {
          throw illegal('reversi.illegal.opponent-pass')
        }
        const afterPass = { ...state, turn: BLACK as Side, notice: 'opponentPass' as ReversiNotice, opponentPick: null }
        // 黑方（玩家）也无处可下 → 自动过手（否则玩家被永远卡住）
        return autoPassPlayerIfStuck(afterPass)
      }
      if (state.board[pick] !== EMPTY || legalMovesFor(state.board, WHITE).indexOf(pick) < 0) {
        throw illegal(`reversi.illegal.opponent-move:${String(pick)}`)
      }
      const placed = placeDisc(state.board, pick, WHITE)
      if (placed === null) throw illegal(`reversi.illegal.opponent-move:${String(pick)}`)
      const after: ReversiState = {
        ...state,
        board: placed.board,
        turn: BLACK,
        rngCursor: state.rngCursor + 1,
        lastMove: pick,
        opponentPick: null,
      }
      return autoPassPlayerIfStuck(after)
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
        lastMove: previous.lastMove,
        opponentPick: null,
        history: state.history.slice(0, -1),
      }
    }

    case 'restart':
      return createState(state.seed, state.difficulty)

    default: {
      const unknown = action as { type?: unknown }
      throw illegal(`reversi.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 黑方（玩家）无处可下而白方有棋可下：自动过手（黑白棋规则），并把控制权交还壳层 */
function autoPassPlayerIfStuck(state: ReversiState): ReversiState {
  if (isTerminal(state.board)) return state
  if (state.turn !== BLACK) return state
  if (legalMovesFor(state.board, BLACK).length > 0) return state
  return { ...state, turn: WHITE, notice: 'playerPass' }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: ReversiState): ReversiAction[] {
  const actions: ReversiAction[] = []
  if (outcomeOf(state) === null) {
    if (pending(state.board, state.turn)) {
      actions.push({ type: 'tick' })
    } else {
      for (const index of legalMovesFor(state.board, BLACK)) actions.push({ type: 'place', index })
    }
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
  if (outcomeOf(state) !== null) return null
  if (pending(state.board, state.turn)) return null
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
    lastMove: state.lastMove,
    opponentPick: state.opponentPick,
    history: state.history.map((snapshot) => ({
      board: [...snapshot.board],
      turn: snapshot.turn,
      rngCursor: snapshot.rngCursor,
      moves: snapshot.moves,
      notice: snapshot.notice,
      lastMove: snapshot.lastMove,
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
 * 除字段类型与取值外，还复核：
 * 1. 棋子总数 = 4（初始四子）+ 玩家步数 + 白方手数（游标）；
 * 2. `history.length === moves`：每次玩家落子恰好留一份快照，快照按手数递增、游标单调不减，
 *    且都停在轮到玩家的时候；
 * 3. lastMove（若存在）必须落在黑子或白子上（过手不清除）；
 * 4. opponentPick 只允许出现在「轮到白方且对局未结束」的中间态：-1 当且仅当白方无处可下，
 *    否则必须是白方的合法落点；非终局且轮到黑方时黑方必须有棋可下。
 * decode 只搬运存档里的盘面，不会重放随机数重算白方着法（存档与 AI 强度解耦）。
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
    lastMove: unknown
    opponentPick: unknown
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

  const storedLast = value.lastMove
  const lastMove =
    storedLast === null || storedLast === undefined ? null : readCount(storedLast, 'last-move')
  if (lastMove !== null) {
    if (lastMove >= CELLS) throw illegal('reversi.illegal.state:last-move')
    if (board[lastMove] === EMPTY) throw illegal('reversi.illegal.state:last-move')
  }

  const storedPick = value.opponentPick
  const opponentPick =
    storedPick === null || storedPick === undefined ? null : Number(storedPick)
  if (opponentPick !== null) {
    if (!Number.isInteger(opponentPick) || opponentPick < -1 || opponentPick >= CELLS) {
      throw illegal('reversi.illegal.state:pick')
    }
    if (!pending(board, turn)) {
      throw illegal('reversi.illegal.state:pick-side')
    }
    if (opponentPick === -1) {
      if (legalMovesFor(board, WHITE).length !== 0) throw illegal('reversi.illegal.state:pick')
    } else if (legalMovesFor(board, WHITE).indexOf(opponentPick) < 0) {
      throw illegal('reversi.illegal.state:pick')
    }
  }

  if (!Array.isArray(value.history)) throw illegal('reversi.illegal.state:history')
  const history: ReversiSnapshot[] = (value.history as unknown[]).map((entry, position) => {
    if (!entry || typeof entry !== 'object') throw illegal('reversi.illegal.state:history-entry')
    const snapshot = entry as Partial<Record<keyof ReversiSnapshot, unknown>>
    const snapshotBoard = readBoard(snapshot.board, 'history-board')
    const snapshotTurn = readSide(snapshot.turn, 'history-turn')
    if (snapshotTurn !== BLACK) throw illegal('reversi.illegal.state:history-turn')
    const snapshotCursor = readCount(snapshot.rngCursor, 'history-cursor')
    const snapshotMoves = readCount(snapshot.moves, 'history-moves')
    const snapshotNotice = readNotice(snapshot.notice, 'history-notice')
    const storedSnapLast = snapshot.lastMove
    const snapshotLastMove =
      storedSnapLast === null || storedSnapLast === undefined
        ? null
        : readCount(storedSnapLast, 'history-last-move')
    if (snapshotLastMove !== null && (snapshotLastMove >= CELLS || snapshotBoard[snapshotLastMove] === EMPTY)) {
      throw illegal('reversi.illegal.state:history-last-move')
    }
    if (snapshotMoves !== position) throw illegal('reversi.illegal.state:history-order')
    assertDiscTotal(snapshotBoard, snapshotMoves, snapshotCursor, 'history-disc-count')
    return {
      board: snapshotBoard,
      turn: BLACK,
      rngCursor: snapshotCursor,
      moves: snapshotMoves,
      notice: snapshotNotice,
      lastMove: snapshotLastMove,
    }
  })

  if (history.length !== moves) throw illegal('reversi.illegal.state:history-length')
  assertDiscTotal(board, moves, rngCursor, 'disc-count')
  let previousCursor = 0
  for (const snapshot of history) {
    if (snapshot.rngCursor < previousCursor) throw illegal('reversi.illegal.state:cursor-order')
    previousCursor = snapshot.rngCursor
  }
  if (rngCursor < previousCursor) throw illegal('reversi.illegal.state:cursor-order')
  if (!isTerminal(board)) {
    if (turn === BLACK && legalMovesFor(board, BLACK).length === 0) {
      throw illegal('reversi.illegal.state:stuck')
    }
  }

  return { difficulty, seed, board, turn, rngCursor, moves, notice, lastMove, opponentPick, history }
}
