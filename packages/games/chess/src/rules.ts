/**
 * 对局状态与动作执行（纯函数，无副作用）。
 *
 * 与象棋（xiangqi）/五子棋同一套两拍式应手模型：
 * 1. 玩家派发 `move` 只落白方；黑方的应手由壳层定时派发**两拍 tick** 完成
 *    （第一拍只把选中的着法记进 opponentPick —— 那枚黑子在棋盘上显示为选中态，
 *    第二拍才真正落子）；
 * 2. `undo` 撤销**一整回合**（玩家 + 黑方两手）：回合日志里存的是两手打包着法，
 *    弹掉最后一回合再重放即可还原（不需要黑方重算，因此撤销与 AI 强度无关）；
 * 3. `restart` 无条件接受（壳层的结果面板/暂停菜单会直接派发）。
 *
 * 状态推导：棋盘 / 易位权 / 吃过路兵格 / 半回合计数 / 三次重复哈希 / 步数 / 游标 /
 * 最后一手 / 胜负全部由「回合日志 + 难度 + 种子」决定，因此 `encode` 与 `decode`
 * 只要围绕回合日志做双向校验，就不会出现「自己产生的状态被自己拒绝」。
 *
 * 国际象棋与象棋的关键差异：
 * - **逼和（无子可动且未被将）是平局**，不是输；
 * - 和棋还有：三次重复局面、50 回合规则（半个回合计数 ≥ 100 且无吃子无动兵）、
 *   子力不足（王 vs 王、王+单象 vs 王、王+单马 vs 王）；
 * - 升变 v1 自动升后（board.ts 的 apply 里处理）。
 *
 * 确定性：黑方用 `createRng(seed + 游标)` 选点，同 seed + 同玩家动作序列必然得到同一局面。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  BLACK,
  CASTLE_ALL,
  CELLS,
  EMPTY,
  BISHOP,
  KING,
  KNIGHT,
  WHITE,
  applyMoveOn,
  createInitialBoard,
  isSquareAttacked,
  kingIndexOf,
  legalMovesOn,
  moveFrom,
  moveTo,
  packMove,
  sideOf,
  typeOf,
  type MutablePosition,
  type Piece,
  type Side,
} from './board.js'
import { chooseOpponentMove, type AiPosition } from './ai.js'
import { CHESS_ID, difficultyOrThrow, type DifficultyId } from './meta.js'

export type ChessAction =
  /** 点选自己的棋子（亮出合法落点；再次点己子可改选） */
  | { type: 'select'; index: number }
  /** 走白子：from 必须是自己选中的棋子，to 必须是它的合法落点 */
  | { type: 'move'; from: number; to: number }
  /** 自动步进（壳层按 tickMs 定时派发）：第一拍亮出黑方选中的着法，第二拍才落子 */
  | { type: 'tick' }
  /** 撤销一整回合：回到玩家上次落子之前（黑方的应手一起退回） */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/** 真实结果：白胜（玩家）/ 黑胜（对手）/ 平局 */
export type Outcome = 'white' | 'black' | 'draw'

/** 一回合：玩家的落点 + 黑方的应手（黑方这一手直接终结对局或终局后不应手时为 null） */
export interface ChessTurn {
  white: number | null
  black: number | null
}

export interface ChessState {
  difficulty: DifficultyId
  seed: number
  board: readonly Piece[]
  /** 当前轮到谁（两拍中间态下恒为 BLACK） */
  sideToMove: Side
  /** 玩家（白方）落子数（黑方应手不计入，最佳成绩按它算） */
  moves: number
  /** 黑方应手数，也是随机源游标：每落一手黑棋 +1 */
  rngCursor: number
  /** 玩家点选中的棋子（用于亮出合法落点） */
  selected: number | null
  /** 最后一手的打包着法（双方都算），用于棋盘上的位置标记 */
  lastMove: number | null
  /** 回合日志；`history.length` 恒等于 `moves` */
  history: readonly ChessTurn[]
  /**
   * AI（黑方）已经「选中」但还没落下的应手（打包着法）；null = 还没选。
   * 应手分两拍：第一拍 tick 只把这个着法记下来（那枚黑子显示为选中态），
   * 第二拍 tick 才真正落子。
   */
  opponentPick: number | null
  /** 易位权（board.ts 的 CASTLE_* 位掩码） */
  castling: number
  /** 吃过路兵目标格（上一步双步兵身后那格；没有为 null） */
  epSquare: number | null
  /** 半个回合计数：动兵或吃子清零，否则每手 +1；≥ 100 判和（50 回合规则） */
  halfmoveClock: number
  /** 每次落子后的局面哈希（含行棋方/易位权/吃过路兵格）；同一哈希出现 3 次判和 */
  repetition: readonly string[]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(CHESS_ID, reason)
}

function isIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < CELLS
}

export function createState(seed: number, difficulty: DifficultyId): ChessState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    board: createInitialBoard(),
    sideToMove: WHITE,
    moves: 0,
    rngCursor: 0,
    selected: null,
    lastMove: null,
    history: [],
    opponentPick: null,
    castling: CASTLE_ALL,
    epSquare: null,
    halfmoveClock: 0,
    repetition: [],
  }
}

/** 局面哈希：棋盘 + 行棋方 + 易位权 + 吃过路兵格（三次重复判和用） */
export function positionHash(
  board: readonly Piece[],
  sideToMove: Side,
  castling: number,
  epSquare: number | null,
): string {
  let s = ''
  for (let i = 0; i < CELLS; i++) {
    s += (board[i] as number).toString(36)
    if (i % 8 === 7 && i < 63) s += '/'
  }
  return `${s}|${sideToMove}|${castling}|${epSquare ?? '-'}`
}

/** 当前轮到的一方是否正被将军 */
export function isInCheck(state: ChessState): boolean {
  const king = kingIndexOf(state.board, state.sideToMove)
  if (king < 0) return false
  return isSquareAttacked(state.board, king, (state.sideToMove ^ 1) as Side)
}

/** 把状态转成 AI 搜索用的可变位置 */
export function toAiPosition(state: ChessState): AiPosition {
  return {
    board: state.board.slice(),
    sideToMove: BLACK,
    castling: state.castling,
    epSquare: state.epSquare,
  }
}

/** 子力不足判和：王 vs 王、王+单象 vs 王、王+单马 vs 王 */
export function isInsufficientMaterial(board: readonly Piece[]): boolean {
  let bishops = 0
  let knights = 0
  for (const p of board) {
    if (p === EMPTY) continue
    const t = typeOf(p)
    if (t === KING) continue
    if (t === BISHOP) {
      bishops++
    } else if (t === KNIGHT) {
      knights++
    } else {
      return false // 后 / 车 / 兵在场就不是子力不足
    }
  }
  return (bishops === 0 && knights === 0) || (bishops === 0 && knights === 1) || (bishops === 1 && knights === 0)
}

/**
 * 终局判定（真实结果，含平局）。返回 null = 对局继续。
 * - 轮到的一方被将死（被将且无子可动）→ 对方胜；
 * - 逼和（未被将且无子可动）→ 平局；
 * - 三次重复局面 / 50 回合规则 / 子力不足 → 平局。
 */
export function outcomeOf(state: ChessState): Outcome | null {
  const hasMove = legalMovesOn(toMutable(state)).length > 0
  if (!hasMove) {
    return isInCheck(state) ? (state.sideToMove === WHITE ? 'black' : 'white') : 'draw'
  }
  if (state.halfmoveClock >= 100) return 'draw'
  const current = positionHash(state.board, state.sideToMove, state.castling, state.epSquare)
  let count = 0
  for (const h of state.repetition) if (h === current) count++
  if (count >= 3) return 'draw'
  if (isInsufficientMaterial(state.board)) return 'draw'
  return null
}

function toMutable(state: ChessState): MutablePosition {
  return {
    board: state.board.slice(),
    sideToMove: state.sideToMove,
    castling: state.castling,
    epSquare: state.epSquare,
  }
}

/** 黑方待应手的中间态：最后一回合黑方已落白、黑方还没落（且对局未结束） */
function pending(state: ChessState): boolean {
  const last = state.history[state.history.length - 1]
  return last !== undefined && last.black === null && outcomeOf(state) === null
}

/**
 * 终局判定；但 GameStatus 只有三态。
 * 平局取 `won`：壳层**只在 status !== 'playing' 时**才展示结果面板，
 * 若把平局算作 lost，玩家和棋后会看到「你输了」这种与事实不符的结论。
 * 真实结果由 `view()` 的标题说明（平局用 `chess.draw.title`），战绩由 outcomeOf 钩子判定。
 */
export function gameStatus(state: ChessState): GameStatus {
  const outcome = outcomeOf(state)
  if (outcome === null) return 'playing'
  return outcome === 'black' ? 'lost' : 'won'
}

function isWhiteLegalMove(state: ChessState, move: number): boolean {
  const pos = toMutable(state)
  return legalMovesOn(pos).includes(move)
}

export function reduceChess(state: ChessState, action: ChessAction): ChessState {
  switch (action.type) {
    case 'select': {
      if (outcomeOf(state) !== null) throw illegal('chess.illegal.finished')
      if (pending(state)) throw illegal('chess.illegal.not-your-turn')
      const index = action.index
      if (!isIndex(index)) throw illegal(`chess.illegal.index:${String(index)}`)
      const piece = state.board[index] as Piece
      if (piece === EMPTY || sideOf(piece) !== WHITE) {
        throw illegal(`chess.illegal.not-your-piece:${index}`)
      }
      return { ...state, selected: index }
    }

    case 'move': {
      if (outcomeOf(state) !== null) throw illegal('chess.illegal.finished')
      if (pending(state)) throw illegal('chess.illegal.not-your-turn')
      const { from, to } = action
      if (!isIndex(from) || !isIndex(to)) {
        throw illegal(`chess.illegal.index:${String(from)}-${String(to)}`)
      }
      const move = packMove(from, to)
      if (!isWhiteLegalMove(state, move)) throw illegal(`chess.illegal.move:${String(move)}`)

      const board = state.board.slice()
      const pos: MutablePosition = {
        board,
        sideToMove: WHITE,
        castling: state.castling,
        epSquare: state.epSquare,
      }
      const info = applyMoveOn(pos, move)
      const halfmoveClock =
        typeOf(state.board[from] as Piece) === 6 || info.captured !== EMPTY
          ? 0
          : state.halfmoveClock + 1
      const hash = positionHash(pos.board, pos.sideToMove, pos.castling, pos.epSquare)

      return {
        ...state,
        board,
        sideToMove: pos.sideToMove,
        castling: pos.castling,
        epSquare: pos.epSquare,
        moves: state.moves + 1,
        halfmoveClock,
        repetition: [...state.repetition, hash],
        lastMove: move,
        selected: null,
        history: [...state.history, { white: move, black: null }],
      }
    }

    case 'tick': {
      if (outcomeOf(state) !== null) throw illegal('chess.illegal.tick-finished')
      if (!pending(state)) throw illegal('chess.illegal.tick-no-turn')
      if (state.opponentPick === null) {
        // 第一拍：只「选中」—— 棋盘一格不动，玩家看到 AI 挑了哪枚子
        const reply = chooseOpponentMove(state.difficulty, toAiPosition(state), state.seed, state.rngCursor)
        if (reply === null) throw illegal('chess.illegal.opponent-stuck')
        const pos = toAiPosition(state)
        if (!legalMovesOn(pos).includes(reply)) {
          throw illegal(`chess.illegal.opponent-move:${String(reply)}`)
        }
        return { ...state, opponentPick: reply }
      }
      // 第二拍：真正落子。着法在第一拍就算好了，这里只核对它仍然合法
      const pick = state.opponentPick
      const pos = toAiPosition(state)
      if (!legalMovesOn(pos).includes(pick)) {
        throw illegal(`chess.illegal.opponent-move:${String(pick)}`)
      }
      const from = moveFrom(pick)
      const board = state.board.slice()
      const mpos: MutablePosition = {
        board,
        sideToMove: BLACK,
        castling: state.castling,
        epSquare: state.epSquare,
      }
      const info = applyMoveOn(mpos, pick)
      const halfmoveClock =
        typeOf(state.board[from] as Piece) === 6 || info.captured !== EMPTY
          ? 0
          : state.halfmoveClock + 1
      const hash = positionHash(mpos.board, mpos.sideToMove, mpos.castling, mpos.epSquare)
      const history = state.history.slice()
      const last = history[history.length - 1] as ChessTurn
      history[history.length - 1] = { white: last.white, black: pick }
      return {
        ...state,
        board,
        sideToMove: mpos.sideToMove,
        castling: mpos.castling,
        epSquare: mpos.epSquare,
        rngCursor: state.rngCursor + 1,
        halfmoveClock,
        repetition: [...state.repetition, hash],
        lastMove: pick,
        opponentPick: null,
        history,
      }
    }

    case 'undo': {
      if (state.history.length === 0) throw illegal('chess.illegal.nothing-to-undo')
      const history = state.history.slice(0, -1)
      const replay = replayTurns(history)
      return {
        ...state,
        board: replay.board,
        sideToMove: replay.sideToMove,
        moves: history.length,
        rngCursor: replay.blackCount,
        selected: null,
        lastMove: replay.lastMove,
        castling: replay.castling,
        epSquare: replay.epSquare,
        halfmoveClock: replay.halfmoveClock,
        repetition: replay.repetition,
        opponentPick: null,
        history,
      }
    }

    case 'restart':
      return createState(state.seed, state.difficulty)

    default: {
      const unknown = action as { type?: unknown }
      throw illegal(`chess.illegal.action:${String(unknown.type)}`)
    }
  }
}

interface ReplayResult {
  board: Piece[]
  sideToMove: Side
  blackCount: number
  lastMove: number | null
  castling: number
  epSquare: number | null
  halfmoveClock: number
  repetition: string[]
}

/**
 * 按回合日志重放盘面，同时校验日志本身是否自洽（decode 与 undo 共用）。
 * 规则不变量：
 * - 白方着法必须落在该局面下的合法着法集合里；黑方应手同理（白方直接终局时黑方不应手）；
 * - white === null 只允许出现在最后一回合（两拍式应手的中间态，或白方一手终结对局）；
 * - 易位权 / 吃过路兵格 / 半回合计数 / 重复哈希全部由重放推出，与存档逐一比对。
 */
function replayTurns(turns: readonly ChessTurn[]): ReplayResult {
  const board = createInitialBoard()
  let sideToMove: Side = WHITE
  let castling = CASTLE_ALL
  let epSquare: number | null = null
  let halfmoveClock = 0
  let blackCount = 0
  let lastMove: number | null = null
  const repetition: string[] = []
  const pos: MutablePosition = { board, sideToMove, castling, epSquare }

  for (let position = 0; position < turns.length; position++) {
    const turn = turns[position]!
    const isLast = position === turns.length - 1
    if (turn.white === null) throw illegal('chess.illegal.state:white-missing')

    if (!legalMovesOn(pos).includes(turn.white)) {
      throw illegal(`chess.illegal.state:white-move:${String(turn.white)}`)
    }
    const wFrom = moveFrom(turn.white)
    const wMoving = board[wFrom] as Piece
    const wTarget = board[moveTo(turn.white)] as Piece
    applyMoveOn(pos, turn.white)
    lastMove = turn.white
    halfmoveClock = typeOf(wMoving) === 6 || wTarget !== EMPTY ? 0 : halfmoveClock + 1
    repetition.push(positionHash(board, pos.sideToMove, pos.castling, pos.epSquare))

    if (turn.black === null) {
      // 黑方不应手：白方这一手直接终局，或这是一局还没应手的最后一回合（两拍中间态）
      if (!isLast) throw illegal('chess.illegal.state:turn-after-end')
      continue
    }
    if (!legalMovesOn(pos).includes(turn.black)) {
      throw illegal(`chess.illegal.state:black-move:${String(turn.black)}`)
    }
    const bFrom = moveFrom(turn.black)
    const bMoving = board[bFrom] as Piece
    const bTarget = board[moveTo(turn.black)] as Piece
    applyMoveOn(pos, turn.black)
    lastMove = turn.black
    blackCount++
    halfmoveClock = typeOf(bMoving) === 6 || bTarget !== EMPTY ? 0 : halfmoveClock + 1
    repetition.push(positionHash(board, pos.sideToMove, pos.castling, pos.epSquare))
  }
  return {
    board,
    sideToMove: pos.sideToMove,
    blackCount,
    lastMove,
    castling: pos.castling,
    epSquare: pos.epSquare,
    halfmoveClock,
    repetition,
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: ChessState): ChessAction[] {
  const actions: ChessAction[] = []
  if (outcomeOf(state) === null) {
    if (pending(state)) {
      actions.push({ type: 'tick' })
    } else {
      const pos = toMutable(state)
      for (const move of legalMovesOn(pos)) actions.push({ type: 'move', from: moveFrom(move), to: moveTo(move) })
      for (let index = 0; index < CELLS; index++) {
        const p = state.board[index] as Piece
        if (p !== EMPTY && sideOf(p) === WHITE) actions.push({ type: 'select', index })
      }
    }
  }
  if (state.history.length > 0) actions.push({ type: 'undo' })
  actions.push({ type: 'restart' })
  return actions
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 点己方棋子 = 选中；点选中的棋子的合法落点 = 走子；其余返回 null（点了没反应比弹错误自然）。
 */
export function selectAction(state: ChessState, index: number): ChessAction | null {
  if (!isIndex(index)) return null
  if (outcomeOf(state) !== null) return null
  if (pending(state)) return null
  const piece = state.board[index] as Piece
  if (piece !== EMPTY && sideOf(piece) === WHITE) return { type: 'select', index }
  if (state.selected !== null) {
    const move = packMove(state.selected, index)
    const pos = toMutable(state)
    if (legalMovesOn(pos).includes(move)) {
      return { type: 'move', from: state.selected, to: index }
    }
  }
  return null
}

export function encodeState(state: ChessState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    sideToMove: state.sideToMove,
    moves: state.moves,
    rngCursor: state.rngCursor,
    selected: state.selected,
    lastMove: state.lastMove,
    history: state.history.map((turn) => ({ white: turn.white, black: turn.black })),
    opponentPick: state.opponentPick,
    castling: state.castling,
    epSquare: state.epSquare,
    halfmoveClock: state.halfmoveClock,
    repetition: [...state.repetition],
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`chess.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  const index = readCount(value, field)
  if (index >= CELLS) throw illegal(`chess.illegal.state:${field}`)
  return index
}

function readMove(value: unknown, field: string): number {
  const move = readCount(value, field)
  if (move >= 4096) throw illegal(`chess.illegal.state:${field}`)
  return move
}

function readTurn(value: unknown, position: number): ChessTurn {
  if (!value || typeof value !== 'object') throw illegal('chess.illegal.state:turn')
  const entry = value as { white?: unknown; black?: unknown }
  const white =
    entry.white === null || entry.white === undefined
      ? null
      : readMove(entry.white, `turn-${position}-white`)
  const black =
    entry.black === null || entry.black === undefined
      ? null
      : readMove(entry.black, `turn-${position}-black`)
  return { white, black }
}

function readBoard(value: unknown): Piece[] {
  if (!Array.isArray(value) || value.length !== CELLS) throw illegal('chess.illegal.state:board')
  const board: Piece[] = []
  for (const cell of value) {
    if (!Number.isInteger(cell) || (cell as number) < 0 || (cell as number) > 15) {
      throw illegal('chess.illegal.state:board')
    }
    board.push(cell as Piece)
  }
  return board
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 * 除字段类型与取值外，还做：
 * 1. 用回合日志重放盘面，逐格比对存档里的 board（防手改盘面）；
 * 2. 复核 history.length === moves、rngCursor === 黑方应手数、lastMove/易位权/
 *    吃过路兵格/半回合计数/重复哈希与重放结果一致；
 * 3. opponentPick 只允许出现在「最后一回合黑方未应手」的中间态，且必须是黑方的合法着法
 *    （不重算 AI，保持存档与 AI 强度解耦）。
 */
export function decodeState(raw: unknown): ChessState {
  if (!raw || typeof raw !== 'object') throw illegal('chess.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    board: unknown
    sideToMove: unknown
    moves: unknown
    rngCursor: unknown
    selected: unknown
    lastMove: unknown
    history: unknown
    opponentPick: unknown
    castling: unknown
    epSquare: unknown
    halfmoveClock: unknown
    repetition: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('chess.illegal.state:seed')
  const moves = readCount(value.moves, 'moves')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (!Array.isArray(value.history)) throw illegal('chess.illegal.state:history')
  if (value.history.length !== moves) throw illegal('chess.illegal.state:history-length')

  const history = (value.history as unknown[]).map((entry, position) => readTurn(entry, position))
  const replay = replayTurns(history)
  if (replay.blackCount !== rngCursor) throw illegal('chess.illegal.state:cursor')

  const board = readBoard(value.board)
  for (let index = 0; index < CELLS; index++) {
    if (board[index] !== replay.board[index]) throw illegal('chess.illegal.state:board-log')
  }
  if (value.sideToMove !== replay.sideToMove) throw illegal('chess.illegal.state:side')

  const storedLast = value.lastMove
  const lastMove =
    storedLast === null || storedLast === undefined ? null : readMove(storedLast, 'last-move')
  if (lastMove !== replay.lastMove) throw illegal('chess.illegal.state:last-move')

  const castling = readCount(value.castling, 'castling')
  if (castling !== replay.castling) throw illegal('chess.illegal.state:castling')

  const storedEp = value.epSquare
  const epSquare =
    storedEp === null || storedEp === undefined ? null : readIndex(storedEp, 'ep-square')
  if (epSquare !== replay.epSquare) throw illegal('chess.illegal.state:ep')

  const halfmoveClock = readCount(value.halfmoveClock, 'halfmove')
  if (halfmoveClock !== replay.halfmoveClock) throw illegal('chess.illegal.state:halfmove')

  if (!Array.isArray(value.repetition)) throw illegal('chess.illegal.state:repetition')
  const repetition = (value.repetition as unknown[]).map((entry) => String(entry))
  if (repetition.join('\n') !== replay.repetition.join('\n')) {
    throw illegal('chess.illegal.state:repetition')
  }

  const storedSelected = value.selected
  const selected =
    storedSelected === null || storedSelected === undefined
      ? null
      : readIndex(storedSelected, 'selected')
  if (selected !== null) {
    const p = replay.board[selected] as Piece
    if (p === EMPTY || sideOf(p) !== WHITE) throw illegal('chess.illegal.state:selected')
  }

  // AI 已选中未落下：只允许出现在「最后一回合黑方未应手」的中间态，且必须是黑方的合法着法
  const storedPick = value.opponentPick
  const opponentPick =
    storedPick === null || storedPick === undefined ? null : readMove(storedPick, 'opponent-pick')
  if (opponentPick !== null) {
    if (history.length === 0 || history[history.length - 1]!.black !== null) {
      throw illegal('chess.illegal.state:pick-side')
    }
    const pos: MutablePosition = {
      board: board.slice(),
      sideToMove: BLACK,
      castling: replay.castling,
      epSquare: replay.epSquare,
    }
    if (!legalMovesOn(pos).includes(opponentPick)) throw illegal('chess.illegal.state:pick')
  }

  return {
    difficulty,
    seed,
    board: replay.board,
    sideToMove: replay.sideToMove,
    moves,
    rngCursor,
    selected,
    lastMove: replay.lastMove,
    history,
    opponentPick,
    castling: replay.castling,
    epSquare: replay.epSquare,
    halfmoveClock: replay.halfmoveClock,
    repetition: replay.repetition,
  }
}
