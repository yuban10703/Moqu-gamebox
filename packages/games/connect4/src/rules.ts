/**
 * 对局状态与动作执行（纯函数，无副作用）。
 *
 * 三件事让壳层不需要认识任何玩法：
 * 1. 玩家只派发 `drop`：白方的应手在**同一次 reduce 内**算完，
 *    因此壳层不必驱动 AI，也不存在「等白方走棋」的中间态；
 * 2. `undo` 撤销**一整回合**（玩家 + 白方两手）：回合日志里存的是两个落点索引，
 *    弹掉最后一回合再重放即可还原（不需要白方重算，因此撤销与 AI 强度无关）；
 * 3. `restart` 无条件接受（壳层的结果面板/暂停菜单会直接派发）。
 *
 * 状态推导：棋盘 / 步数 / 游标 / 最后一手 / 胜负全部由「回合日志 + 难度 + 种子」决定，
 * 因此 `encode` 与 `decode` 只要围绕回合日志做双向校验，就不会出现「自己产生的状态被自己拒绝」。
 *
 * 重力：日志里存的是**落点索引**而不是列号。重放时除「该格必须为空」外，
 * 还要求它就是该列当时的最低空格 —— 这条不变量由 reduce 构造性地保证，
 * 手改日志把棋子悬在半空会被 decode 拒绝。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  WHITE,
  colOf,
  createEmptyBoard,
  isFull,
  isColumn,
  isIndex,
  landingIndex,
  makesFour,
  validColumns,
  type Stone,
} from './board.js'
import { CONNECT4_ID, chooseOpponentMove, difficultyOrThrow, type DifficultyId } from './ai.js'

export type Connect4Action =
  /** 往 column 落黑子（玩家）。列已满/越界抛 IllegalActionError，由壳层给出明确提示 */
  | { type: 'drop'; column: number }
  /** 撤销一整回合：回到玩家上次落子之前（白方的应手一起退回） */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/** 真实结果：黑胜（玩家）/ 白胜（对手）/ 平局（棋盘下满且无人成四） */
export type Outcome = 'black' | 'white' | 'draw'

/** 一回合：玩家的落点 + 白方的应手（黑方这一手直接终结对局时白方不应手，为 null） */
export interface Connect4Turn {
  black: number
  white: number | null
}

export interface Connect4State {
  difficulty: DifficultyId
  seed: number
  board: readonly Stone[]
  /** 玩家落子数（白方应手不计入，最佳成绩按它算） */
  moves: number
  /** 白方应手数（= 白子数），也是随机源游标：每落一手白棋 +1 */
  rngCursor: number
  /** 最后一手的落点（双方都算），用于棋盘上「加重描边」高亮 */
  lastMove: number | null
  /** 回合日志；`history.length` 恒等于 `moves` */
  history: readonly Connect4Turn[]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(CONNECT4_ID, reason)
}

export function createState(seed: number, difficulty: DifficultyId): Connect4State {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    board: createEmptyBoard(),
    moves: 0,
    rngCursor: 0,
    lastMove: null,
    history: [],
  }
}

/**
 * 真实结果：先看有没有四连，再看棋盘是否下满。
 * 遍历时按索引升序找第一条四连 —— 正常对局里不可能双方同时成四（先成四的一方直接终局）。
 */
export function outcomeOf(board: readonly Stone[]): Outcome | null {
  for (let index = 0; index < CELLS; index++) {
    const stone = board[index]
    if (stone === EMPTY) continue
    if (makesFour(board, index, stone)) return stone === BLACK ? 'black' : 'white'
  }
  return isFull(board) ? 'draw' : null
}

/**
 * 终局判定；但 GameStatus 只有三态。
 * 平局取 `won`：壳层**只在 status !== 'playing' 时**才展示结果面板，
 * 若把平局算作 lost，玩家在棋盘下满后会看到「你输了」这种与事实不符的结论。
 * 真实结果由 `view()` 的标题说明（平局用 `connect4.draw.title`）。
 */
export function gameStatus(state: Connect4State): GameStatus {
  const outcome = outcomeOf(state.board)
  if (outcome === null) return 'playing'
  return outcome === 'white' ? 'lost' : 'won'
}

/**
 * 校验日志里的落点：必须在盘内、落子时该格为空、且是该列当时的最低空格（重力不变量）。
 * 三者都是 reduce 的构造性事实，因此这里的校验不会误伤游戏自己产生的状态。
 */
function assertLanded(board: readonly Stone[], index: number, field: string): void {
  if (!isIndex(index)) throw illegal(`connect4.illegal.state:${field}`)
  if (board[index] !== EMPTY) throw illegal(`connect4.illegal.state:${field}`)
  if (landingIndex(board, colOf(index)) !== index) {
    throw illegal(`connect4.illegal.state:gravity:${field}`)
  }
}

interface ReplayResult {
  board: Stone[]
  whiteCount: number
  lastMove: number | null
}

/**
 * 按回合日志重放盘面，同时校验日志本身是否自洽（decode 与 undo 共用）。
 *
 * 规则不变量：
 * - 两个落点都必须通过 `assertLanded`（盘内 / 空 / 落在该列最低空格）；
 * - 黑方落子直接成四或把棋盘下满时，白方必须不应手（white === null），且这必须是最后一回合；
 * - 白方应手成四或下满棋盘时，这必须是最后一回合（对局已经结束）。
 */
function replayTurns(turns: readonly Connect4Turn[]): ReplayResult {
  const board = createEmptyBoard()
  let whiteCount = 0
  let lastMove: number | null = null
  for (let position = 0; position < turns.length; position++) {
    const turn = turns[position]!
    assertLanded(board, turn.black, `black:${String(turn.black)}`)
    board[turn.black] = BLACK
    lastMove = turn.black
    const blackFour = makesFour(board, turn.black, BLACK)
    const fullAfterBlack = isFull(board)
    const isLast = position === turns.length - 1

    if (turn.white === null) {
      // 白方不应手只有一种合法解释：黑方这一手已经把对局终结
      if (!blackFour && !fullAfterBlack) throw illegal('connect4.illegal.state:white-missing')
      if (!isLast) throw illegal('connect4.illegal.state:turn-after-end')
      continue
    }
    if (blackFour || fullAfterBlack) throw illegal('connect4.illegal.state:reply-after-end')
    assertLanded(board, turn.white, `white:${String(turn.white)}`)
    board[turn.white] = WHITE
    lastMove = turn.white
    whiteCount++
    if ((makesFour(board, turn.white, WHITE) || isFull(board)) && !isLast) {
      throw illegal('connect4.illegal.state:turn-after-end')
    }
  }
  return { board, whiteCount, lastMove }
}

function assertPlayable(state: Connect4State): void {
  if (outcomeOf(state.board) !== null) throw illegal('connect4.illegal.finished')
}

export function reduceConnect4(state: Connect4State, action: Connect4Action): Connect4State {
  switch (action.type) {
    case 'drop': {
      assertPlayable(state)
      const column = action.column
      if (!isColumn(column)) throw illegal(`connect4.illegal.column:${String(column)}`)
      const index = landingIndex(state.board, column)
      if (index === null) throw illegal(`connect4.illegal.full:${column}`)

      const board = state.board.slice()
      board[index] = BLACK
      const turn: Connect4Turn = { black: index, white: null }
      let lastMove = index

      // 黑方这一手没终结对局才轮到白方；白方应手必须在这同一次 reduce 内算完
      if (!makesFour(board, index, BLACK) && !isFull(board)) {
        const replyColumn = chooseOpponentMove(state.difficulty, board, state.seed, state.rngCursor)
        if (replyColumn === null) throw illegal('connect4.illegal.opponent-stuck')
        const reply = landingIndex(board, replyColumn)
        if (reply === null) throw illegal(`connect4.illegal.opponent-move:${String(replyColumn)}`)
        board[reply] = WHITE
        turn.white = reply
        lastMove = reply
      }

      return {
        ...state,
        board,
        moves: state.moves + 1,
        rngCursor: state.rngCursor + (turn.white === null ? 0 : 1),
        lastMove,
        history: [...state.history, turn],
      }
    }

    case 'undo': {
      if (state.history.length === 0) throw illegal('connect4.illegal.nothing-to-undo')
      // 连白方的应手一起退回：弹掉最后一回合并按剩余日志重放，玩家与白方两手同时消失
      const history = state.history.slice(0, -1)
      const replay = replayTurns(history)
      return {
        ...state,
        board: replay.board,
        moves: history.length,
        rngCursor: replay.whiteCount,
        lastMove: replay.lastMove,
        history,
      }
    }

    case 'restart':
      // 同难度同种子重开：回到空棋盘，历史清空（输赢后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`connect4.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: Connect4State): Connect4Action[] {
  const actions: Connect4Action[] = []
  if (outcomeOf(state.board) === null) {
    for (const column of validColumns(state.board)) actions.push({ type: 'drop', column })
  }
  if (state.history.length > 0) actions.push({ type: 'undo' })
  actions.push({ type: 'restart' })
  return actions
}

/**
 * 「点了第 index 个格子」→ 动作。
 *
 * 四子棋只认列：任何一格都能代表它所在的列，落点仍由重力决定。
 * 第 0 行恰好占索引 0..6，所以直接传列号（0..6）与传该列顶部格子的索引等价，
 * 两种调用方式不会给出不同结果。
 * 越界/列已满/对局结束返回 null：点了没反应比弹错误自然（手机端误触很常见）。
 */
export function selectAction(state: Connect4State, index: number): Connect4Action | null {
  if (!isIndex(index)) return null
  if (outcomeOf(state.board) !== null) return null
  const column = colOf(index)
  if (landingIndex(state.board, column) === null) return null
  return { type: 'drop', column }
}

export function encodeState(state: Connect4State): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    moves: state.moves,
    rngCursor: state.rngCursor,
    lastMove: state.lastMove,
    history: state.history.map((turn) => ({ black: turn.black, white: turn.white })),
  }
}

function readBoard(value: unknown): Stone[] {
  if (!Array.isArray(value) || value.length !== CELLS) throw illegal('connect4.illegal.state:board')
  const board: Stone[] = []
  for (const cell of value) {
    if (cell !== EMPTY && cell !== BLACK && cell !== WHITE) throw illegal('connect4.illegal.state:board')
    board.push(cell as Stone)
  }
  return board
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`connect4.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  const index = readCount(value, field)
  if (index >= CELLS) throw illegal(`connect4.illegal.state:${field}`)
  return index
}

function readTurn(value: unknown, position: number): Connect4Turn {
  if (!value || typeof value !== 'object') throw illegal('connect4.illegal.state:turn')
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
 * 1. 用回合日志重放盘面（含重力校验），逐格比对存档里的 board（防手改盘面）；
 * 2. 复核 `history.length === moves` 与 `rngCursor === 白子数`；
 * 3. 复核 `lastMove` 与重放结果一致。
 * 由于白方着法只取决于 (难度, 盘面, seed, 游标)，重放不需要调用 AI，因此 decode 与难度强度无关。
 */
export function decodeState(raw: unknown): Connect4State {
  if (!raw || typeof raw !== 'object') throw illegal('connect4.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    board: unknown
    moves: unknown
    rngCursor: unknown
    lastMove: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('connect4.illegal.state:seed')
  const moves = readCount(value.moves, 'moves')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (!Array.isArray(value.history)) throw illegal('connect4.illegal.state:history')
  if (value.history.length !== moves) throw illegal('connect4.illegal.state:history-length')

  const history = (value.history as unknown[]).map((entry, position) => readTurn(entry, position))
  const replay = replayTurns(history)
  if (replay.whiteCount !== rngCursor) throw illegal('connect4.illegal.state:cursor')

  const board = readBoard(value.board)
  for (let index = 0; index < CELLS; index++) {
    if (board[index] !== replay.board[index]) throw illegal('connect4.illegal.state:board-log')
  }

  const storedLast = value.lastMove
  const lastMove =
    storedLast === null || storedLast === undefined ? null : readIndex(storedLast, 'last-move')
  if (lastMove !== replay.lastMove) throw illegal('connect4.illegal.state:last-move')

  return { difficulty, seed, board: replay.board, moves, rngCursor, lastMove: replay.lastMove, history }
}
