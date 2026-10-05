/**
 * 对局状态与动作执行（纯函数，无副作用）。
 *
 * 三件事让壳层不需要认识任何玩法：
 * 1. 玩家派发 `place` 只落黑子；白方的应手由壳层定时派发**两拍 tick** 完成
 *    （第一拍只亮出 AI 选中的目标格、第二拍才落子 —— 用户要求「先亮一下再落子」），
 *    因此存在「等白方走棋」的中间态，壳层用 `tickMs` 驱动；
 *    弹掉最后一回合再重放即可还原（不需要白方重算，因此撤销与 AI 强度无关）；
 * 3. `restart` 无条件接受（壳层的结果面板/暂停菜单会直接派发）。
 *
 * 状态推导：棋盘 / 步数 / 游标 / 最后一手 / 胜负全部由「回合日志 + 难度 + 种子」决定，
 * 因此 `encode` 与 `decode` 只要围绕回合日志做双向校验，就不会出现「自己产生的状态被自己拒绝」。
 *
 * 确定性：白方用 `createRng(seed + 游标)` 选点，同 seed + 同玩家动作序列必然得到同一局面。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  createEmptyBoard,
  isFull,
  makesFive,
  type Stone,
} from './board.js'
import { chooseOpponentMove } from './ai.js'
import { GOMOKU_ID, difficultyOrThrow, type DifficultyId } from './meta.js'

export type GomokuAction =
  /** 在 index 落黑子（玩家）。非法落子抛 IllegalActionError，由壳层给出明确提示 */
  | { type: 'place'; index: number }
  /** 自动步进（壳层按 tickMs 定时派发）：第一拍亮出白方选中的落点，第二拍才落子 */
  | { type: 'tick' }
  /** 撤销一整回合：回到玩家上次落子之前（白方的应手一起退回） */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/** 真实结果：黑胜（玩家）/ 白胜（对手）/ 平局（棋盘下满且无人成五） */
export type Outcome = 'black' | 'white' | 'draw'

/** 一回合：玩家的落点 + 白方的应手（黑方这一手直接终结对局时白方不应手，为 null） */
export interface GomokuTurn {
  black: number
  white: number | null
}

export interface GomokuState {
  difficulty: DifficultyId
  seed: number
  board: readonly Stone[]
  /** 玩家落子数（白方应手不计入，最佳成绩按它算） */
  moves: number
  /** 白方应手数（= 白子数），也是随机源游标：每落一手白棋 +1 */
  rngCursor: number
  /** 最后一手的落点（双方都算），用于棋盘上「加重描边」高亮 */
  lastMove: number | null
  /**
   * AI（白方）已经「选中」但还没落下的应手（棋盘格索引）；null = 还没选。
   * 应手分两拍：第一拍 tick 只把这个点记下来（目标格在棋盘上亮出内框），
   * 第二拍 tick 才真正落下白子。
   */
  readonly opponentPick: number | null
  /** 回合日志；`history.length` 恒等于 `moves` */
  history: readonly GomokuTurn[]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GOMOKU_ID, reason)
}

function isIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < CELLS
}

export function createState(seed: number, difficulty: DifficultyId): GomokuState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    board: createEmptyBoard(),
    moves: 0,
    rngCursor: 0,
    lastMove: null,
    opponentPick: null,
    history: [],
  }
}

/**
 * 真实结果：先看有没有五连，再看棋盘是否下满。
 * 遍历时按索引升序找第一条五连 —— 正常对局里不可能双方同时成五（先成五的一方直接终局）。
 */
export function outcomeOf(board: readonly Stone[]): Outcome | null {
  for (let index = 0; index < CELLS; index++) {
    const stone = board[index]
    if (stone === EMPTY) continue
    if (makesFive(board, index, stone)) return stone === BLACK ? 'black' : 'white'
  }
  return isFull(board) ? 'draw' : null
}

/**
 * 终局判定；但 GameStatus 只有三态。
 * 平局取 `won`：壳层**只在 status !== 'playing' 时**才展示结果面板，
 * 若把平局算作 lost，玩家在棋盘下满后会看到「你输了」这种与事实不符的结论。
 * 真实结果由 `view()` 的标题说明（平局用 `gomoku.draw.title`）。
 */
export function gameStatus(state: GomokuState): GameStatus {
  const outcome = outcomeOf(state.board)
  if (outcome === null) return 'playing'
  return outcome === 'white' ? 'lost' : 'won'
}

interface ReplayResult {
  board: Stone[]
  whiteCount: number
  lastMove: number | null
}

/**
 * 按回合日志重放盘面，同时校验日志本身是否自洽（decode 与 undo 共用）。
 *
 * 规则不变量（都是 reduce 的构造性事实，因此校验不会误伤自己产生的状态）：
 * - 两个落点都必须在棋盘内，且落子时该格必须是空的；
 * - 黑方落子直接成五或把棋盘下满时，白方必须不应手（white === null），且这必须是最后一回合；
 * - 白方应手成五或下满棋盘时，这必须是最后一回合（对局已经结束）。
 */
function replayTurns(turns: readonly GomokuTurn[]): ReplayResult {
  const board = createEmptyBoard()
  let whiteCount = 0
  let lastMove: number | null = null
  for (let position = 0; position < turns.length; position++) {
    const turn = turns[position]!
    if (!isIndex(turn.black) || board[turn.black] !== EMPTY) {
      throw illegal(`gomoku.illegal.state:black:${String(turn.black)}`)
    }
    board[turn.black] = BLACK
    lastMove = turn.black
    const blackFive = makesFive(board, turn.black, BLACK)
    const fullAfterBlack = isFull(board)
    const isLast = position === turns.length - 1

    if (turn.white === null) {
      // 白方不应手只有两种合法解释：黑方这一手直接终局，或这是一局还没应手的
      // 最后一回合（两拍式应手的中间态）。两种情况都只允许出现在最后一回合。
      if (!isLast) throw illegal('gomoku.illegal.state:turn-after-end')
      continue
    }
    if (blackFive || fullAfterBlack) throw illegal('gomoku.illegal.state:reply-after-end')
    if (!isIndex(turn.white) || board[turn.white] !== EMPTY) {
      throw illegal(`gomoku.illegal.state:white:${String(turn.white)}`)
    }
    board[turn.white] = WHITE
    lastMove = turn.white
    whiteCount++
    if ((makesFive(board, turn.white, WHITE) || isFull(board)) && !isLast) {
      throw illegal('gomoku.illegal.state:turn-after-end')
    }
  }
  return { board, whiteCount, lastMove }
}

/** 是否有「白方待应手」的中间态：最后一回合黑方已落、白方还没落（对局未结束） */
function pending(state: GomokuState): boolean {
  const last = state.history[state.history.length - 1]
  return last !== undefined && last.white === null
}

function assertPlayable(state: GomokuState): void {
  if (outcomeOf(state.board) !== null) throw illegal('gomoku.illegal.finished')
}

export function reduceGomoku(state: GomokuState, action: GomokuAction): GomokuState {
  switch (action.type) {
    case 'place': {
      assertPlayable(state)
      if (pending(state)) throw illegal('gomoku.illegal.not-your-turn')
      const index = action.index
      if (!isIndex(index)) throw illegal(`gomoku.illegal.index:${String(index)}`)
      if (state.board[index] !== EMPTY) throw illegal(`gomoku.illegal.occupied:${index}`)
    
      const board = state.board.slice()
      board[index] = BLACK
      // 只落黑方这一手：白方应手改由随后两拍 tick 完成（先亮目标格、再落子）
      return {
        ...state,
        board,
        moves: state.moves + 1,
        lastMove: index,
        history: [...state.history, { black: index, white: null }],
      }
    }
    
    case 'tick': {
      assertPlayable(state)
      if (!pending(state)) throw illegal('gomoku.illegal.tick-no-turn')
      if (state.opponentPick === null) {
        // 第一拍：只「选中」—— 棋盘一格不动，玩家看到 AI 要在哪里落子
        const reply = chooseOpponentMove(state.difficulty, state.board, state.seed, state.rngCursor)
        if (reply === null) throw illegal('gomoku.illegal.opponent-stuck')
        if (!isIndex(reply) || state.board[reply] !== EMPTY) {
          throw illegal(`gomoku.illegal.opponent-move:${String(reply)}`)
        }
        return { ...state, opponentPick: reply }
      }
      // 第二拍：真正落子。着法在第一拍就算好了，这里只核对它仍然合法
      const pick = state.opponentPick
      if (!isIndex(pick) || state.board[pick] !== EMPTY) {
        throw illegal(`gomoku.illegal.opponent-move:${String(pick)}`)
      }
      const board = state.board.slice()
      board[pick] = WHITE
      const history = state.history.slice()
      const last = history[history.length - 1] as GomokuTurn
      history[history.length - 1] = { black: last.black, white: pick }
      return {
        ...state,
        board,
        rngCursor: state.rngCursor + 1,
        lastMove: pick,
        opponentPick: null,
        history,
      }
    }
    
    case 'undo': {
      if (state.history.length === 0) throw illegal('gomoku.illegal.nothing-to-undo')
      // 连白方的应手一起退回：弹掉最后一回合并按剩余日志重放，玩家与白方两手同时消失
      const history = state.history.slice(0, -1)
      const replay = replayTurns(history)
      return {
        ...state,
        board: replay.board,
        moves: history.length,
        rngCursor: replay.whiteCount,
        lastMove: replay.lastMove,
        opponentPick: null,
        history,
      }
    }

    case 'restart':
      // 同难度同种子重开：回到空棋盘，历史清空（输赢后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`gomoku.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: GomokuState): GomokuAction[] {
  const actions: GomokuAction[] = []
  if (outcomeOf(state.board) === null) {
    if (pending(state)) {
      // 白方待应手：只接受 tick（玩家这一手已经落在盘上了）
      actions.push({ type: 'tick' })
    } else {
      for (let index = 0; index < CELLS; index++) {
        if (state.board[index] === EMPTY) actions.push({ type: 'place', index })
      }
    }
  }
  if (state.history.length > 0) actions.push({ type: 'undo' })
  actions.push({ type: 'restart' })
  return actions
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 越界/已占用/对局结束的格子返回 null：点了没反应比弹错误自然（手机端误触很常见）。
 */
export function selectAction(state: GomokuState, index: number): GomokuAction | null {
  if (!isIndex(index)) return null
  if (outcomeOf(state.board) !== null) return null
  if (pending(state)) return null
  if (state.board[index] !== EMPTY) return null
  return { type: 'place', index }
}

export function encodeState(state: GomokuState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    moves: state.moves,
    rngCursor: state.rngCursor,
    lastMove: state.lastMove,
    opponentPick: state.opponentPick,
    history: state.history.map((turn) => ({ black: turn.black, white: turn.white })),
  }
}

function readBoard(value: unknown): Stone[] {
  if (!Array.isArray(value) || value.length !== CELLS) throw illegal('gomoku.illegal.state:board')
  const board: Stone[] = []
  for (const cell of value) {
    if (cell !== EMPTY && cell !== BLACK && cell !== WHITE) throw illegal('gomoku.illegal.state:board')
    board.push(cell as Stone)
  }
  return board
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`gomoku.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  const index = readCount(value, field)
  if (index >= CELLS) throw illegal(`gomoku.illegal.state:${field}`)
  return index
}

function readTurn(value: unknown, position: number): GomokuTurn {
  if (!value || typeof value !== 'object') throw illegal('gomoku.illegal.state:turn')
  const entry = value as { black?: unknown; white?: unknown }
  const black = readIndex(entry.black, `turn-${position}-black`)
  const white =
    entry.white === null || entry.white === undefined
      ? null
      : readIndex(entry.white, `turn-${position}-white`)
  return { black, white }
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 * 除了字段类型与取值，还做三件事：
 * 1. 用回合日志重放盘面，逐格比对存档里的 board（防手改盘面）；
 * 2. 复核 `history.length === moves` 与 `rngCursor === 白子数`；
 * 3. 复核 `lastMove` 与重放结果一致。
 * 由于白方着法只取决于 (难度, 盘面, seed, 游标)，重放不需要调用 AI，因此 decode 与难度强度无关。
 */
export function decodeState(raw: unknown): GomokuState {
  if (!raw || typeof raw !== 'object') throw illegal('gomoku.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    board: unknown
    moves: unknown
    rngCursor: unknown
    lastMove: unknown
    opponentPick: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('gomoku.illegal.state:seed')
  const moves = readCount(value.moves, 'moves')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (!Array.isArray(value.history)) throw illegal('gomoku.illegal.state:history')
  if (value.history.length !== moves) throw illegal('gomoku.illegal.state:history-length')

  const history = (value.history as unknown[]).map((entry, position) => readTurn(entry, position))
  const replay = replayTurns(history)
  if (replay.whiteCount !== rngCursor) throw illegal('gomoku.illegal.state:cursor')

  const board = readBoard(value.board)
  for (let index = 0; index < CELLS; index++) {
    if (board[index] !== replay.board[index]) throw illegal('gomoku.illegal.state:board-log')
  }

  const storedLast = value.lastMove
  const lastMove =
    storedLast === null || storedLast === undefined ? null : readIndex(storedLast, 'last-move')
  if (lastMove !== replay.lastMove) throw illegal('gomoku.illegal.state:last-move')
  
  // AI 已选中未落下：只允许出现在「最后一回合白方未应手」的中间态，且必须是空格的合法落点
  const storedPick = value.opponentPick
  const opponentPick =
    storedPick === null || storedPick === undefined ? null : readIndex(storedPick, 'opponent-pick')
  if (opponentPick !== null) {
    if (history.length === 0 || history[history.length - 1]!.white !== null) {
      throw illegal('gomoku.illegal.state:pick-side')
    }
    if (replay.board[opponentPick] !== EMPTY) throw illegal('gomoku.illegal.state:pick')
  }

  return { difficulty, seed, board: replay.board, moves, rngCursor, opponentPick, lastMove: replay.lastMove, history }
}
