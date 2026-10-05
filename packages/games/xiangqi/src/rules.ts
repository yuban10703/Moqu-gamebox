/**
 * 对局状态与动作执行（纯函数，无副作用）。
 *
 * 与五子棋同一套做法，壳层因此不需要认识任何玩法：
 * 1. 玩家只派发 `move`：黑方的应手在**同一次 reduce 内**算完，因此壳层不必驱动 AI，
 *    也不存在「等黑方走棋」的中间态；
 * 2. `undo` 撤销**一整个回合**（红方一手 + 黑方应手）：日志里存两手，弹掉最后一回合再重放即可；
 * 3. `restart` 无条件接受（壳层的结果面板/暂停菜单会直接派发）；
 * 4. `select` 只是界面状态：不计步、不进日志（否则「点一下自己的子」也会变成一步棋）。
 *
 * 状态推导：盘面 / 轮到谁走 / 步数 / 游标 / 最后一手全部由「回合日志 + 种子 + 难度」决定，
 * 因此 `encode`/`decode` 只要围绕日志做双向校验，就不会出现「自己产生的状态被自己拒绝」。
 *
 * 终局判定：
 * - 将死与困毙都判负（无合法着法的一方输）；
 * - **同一局面（盘面 + 轮到谁走）第三次出现判和**（不做竞赛级的长将/长捉判负）；
 * - `GameStatus` 只有 playing/won/lost 三态，和棋并入 `won`（否则玩家会看到「你输了」这种与事实
 *   不符的结论），结果页标题由 `view()` 如实写成「和棋」—— 与五子棋的取舍一致。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  BLACK,
  CELLS,
  EMPTY,
  RED,
  applyMove,
  createInitialBoard,
  isIndex,
  isKingInCheck,
  isMoveCode,
  isPieceCode,
  legalMoves,
  moveFrom,
  moveTo,
  packMove,
  sameBoard,
  sideOf,
  type Side,
} from './board.js'
import { chooseOpponentMove } from './ai.js'
import { XIANGQI_ID, difficultyOrThrow, type DifficultyId } from './meta.js'

export type XiangqiAction =
  /** 选中/取消选中自己的棋子（界面状态：不计步、不进日志） */
  | { type: 'select'; index: number }
  /** 走子：把 from 上的红方棋子走到 to（非法着法抛 IllegalActionError） */
  | { type: 'move'; from: number; to: number }
  /**
   * 黑方应手：由壳层按 `tickMs` 延时派发（红方一手之后隔一小拍再落子）。
   * 为什么不让 `move` 直接带上黑方应手：用户要求「AI 落子前有个小延迟」，
   * 而规则层禁止 setTimeout —— 本项目里「延时」一律走壳层的 tick 机制
   * （下限 400ms，玩家每次有效输入后壳层会重置计时）。
   */
  | { type: 'tick' }
  /** 撤销一整个回合（红方一手 + 黑方应手一起退回） */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/** 一回合：红方（玩家）的着法 + 黑方（对手）的应手（红方这一手直接终局时为 null） */
export interface XiangqiTurn {
  readonly red: number
  readonly black: number | null
}

export interface XiangqiState {
  readonly difficulty: DifficultyId
  readonly seed: number
  /** 90 格盘面（行优先，行 0 = 黑方底线） */
  readonly board: readonly number[]
  /** 轮到谁走；黑方只在「红方一手已经终局」的收尾局面里出现 */
  readonly sideToMove: Side
  /** 玩家（红方）落子数，恒等于 `history.length` */
  readonly moves: number
  /** 黑方应手数，也是随机源游标 */
  readonly rngCursor: number
  /** 界面状态：选中的红方棋子格（不计步、不进日志） */
  readonly selected: number | null
  /** 最后一手（双方都算），棋盘上加粗放大标出 */
  readonly lastMove: number | null
  /**
   * AI 已经「选中」但还没落下的着法（打包整数），null = 还没选。
   * 用户要求「AI 落子前先选中棋子，500ms 后落子」，所以应手分两拍：
   * 第一拍 tick 只填这个字段（那枚黑子在棋盘上显示为选中态），第二拍才真正落子。
   */
  readonly opponentPick: number | null
  readonly history: readonly XiangqiTurn[]
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(XIANGQI_ID, reason)
}

export function createState(seed: number, difficulty: DifficultyId): XiangqiState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    board: createInitialBoard(),
    sideToMove: RED,
    moves: 0,
    rngCursor: 0,
    selected: null,
    lastMove: null,
    opponentPick: null,
    history: [],
  }
}

/* ------------------------------ 局面重复（判和） ----------------------------- */

/** 局面键：盘面 + 轮到谁走（象棋判和的口径就是这两项都相同） */
function positionKey(board: readonly number[], side: Side): string {
  let key = side === RED ? 'r' : 'b'
  for (let index = 0; index < CELLS; index++) {
    key += String.fromCharCode(48 + (board[index] as number))
  }
  return key
}

/**
 * 本局出现过的每个局面（含初始局面），按时间顺序交给回调。
 * 对局结束时最后一方落子之后的局面也在其中 —— 因此 `history` 的末尾就是「当前局面」。
 */
function forEachPosition(
  history: readonly XiangqiTurn[],
  visit: (board: readonly number[], side: Side) => void,
): void {
  const work = createInitialBoard()
  let side: Side = RED
  visit(work, side)
  for (const turn of history) {
    applyMove(work, turn.red)
    side = BLACK
    visit(work, side)
    if (turn.black !== null) {
      applyMove(work, turn.black)
      side = RED
      visit(work, side)
    }
  }
}

/**
 * 局面（盘面 + 轮到谁走）在本局里出现过几次。传入 `state` 的当前局面时结果 ≥ 1。
 * 判和口径：`>= 3` 就是三次重复局面。
 */
export function occurrenceCount(
  board: readonly number[],
  side: Side,
  history: readonly XiangqiTurn[],
): number {
  let count = 0
  forEachPosition(history, (current, currentSide) => {
    if (currentSide === side && sameBoard(current, board)) count++
  })
  return count
}

/** 当前局面是否是「第三次出现」→ 判和 */
export function isDrawnByRepetition(state: XiangqiState): boolean {
  return occurrenceCount(state.board, state.sideToMove, state.history) >= 3
}

/* --------------------------------- 终局判定 -------------------------------- */

/**
 * 终局判定：先看三次重复判和，再看无合法着法。
 * 和棋并入 `won` 只是为了让壳层渲染结果面板，真实结果由 `view()` 的标题说明。
 */
export function gameStatus(state: XiangqiState): GameStatus {
  if (isDrawnByRepetition(state)) return 'won'
  const moves = legalMoves(state.board, state.sideToMove)
  if (moves.length === 0) return state.sideToMove === RED ? 'lost' : 'won'
  return 'playing'
}

/* --------------------------------- 日志重放 -------------------------------- */

interface ReplayResult {
  board: number[]
  sideToMove: Side
  blackCount: number
  lastMove: number | null
}

/**
 * 按回合日志重放盘面，同时校验日志本身是否自洽（decode 与 undo 共用）。
 *
 * 规则不变量（都是 reduce 的构造性事实，因此校验不会误伤自己产生的状态）：
 * - 每一手都必须是**当时的合法着法**（含不得送将、不得照面）；
 * - 红方一手已经把对局终结（三次重复判和 / 黑方无子可动）时，黑方必须不应手，且这必须是最后一回合；
 * - 黑方不应手又不能解释为终局 → 拒绝；
 * - 对局已经结束之后不允许再有着法。
 */
function replayTurns(turns: readonly XiangqiTurn[]): ReplayResult {
  const board = createInitialBoard()
  let side: Side = RED
  let blackCount = 0
  let lastMove: number | null = null
  // 局面出现次数：一边重放一边累计（O(手数)，不必每手重算整局）
  const seen = new Map<string, number>()
  seen.set(positionKey(board, side), 1)

  const record = (nextSide: Side): boolean => {
    const key = positionKey(board, nextSide)
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count >= 3
  }

  for (let position = 0; position < turns.length; position++) {
    const turn = turns[position] as XiangqiTurn
    const isLast = position === turns.length - 1

    if (!isMoveCode(turn.red) || !legalMoves(board, RED).includes(turn.red)) {
      throw illegal(`xiangqi.illegal.state:red:${String(turn.red)}`)
    }
    applyMove(board, turn.red)
    lastMove = turn.red
    side = BLACK

    if (record(BLACK)) {
      // 红方这一手造成第三次重复局面：判和，对局到此结束
      if (turn.black !== null) throw illegal('xiangqi.illegal.state:reply-after-end')
      if (!isLast) throw illegal('xiangqi.illegal.state:turn-after-end')
      continue
    }

    if (turn.black === null) {
      /*
       * 黑方还没应手：tick 模型下这是**正常中间态**（红方刚走完、AI 还没落子），
       * 但它只能出现在最后一回合 —— 更早的回合缺黑方应手说明日志被截断过。
       */
      if (!isLast) throw illegal('xiangqi.illegal.state:turn-after-end')
      continue
    }

    if (!isMoveCode(turn.black) || !legalMoves(board, BLACK).includes(turn.black)) {
      throw illegal(`xiangqi.illegal.state:black:${String(turn.black)}`)
    }
    applyMove(board, turn.black)
    lastMove = turn.black
    blackCount++
    side = RED

    if ((record(RED) || legalMoves(board, RED).length === 0) && !isLast) {
      throw illegal('xiangqi.illegal.state:turn-after-end')
    }
  }

  return { board, sideToMove: side, blackCount, lastMove }
}

function assertPlaying(state: XiangqiState): void {
  if (gameStatus(state) !== 'playing') throw illegal('xiangqi.illegal.finished')
}

/* ---------------------------------- reduce --------------------------------- */

export function reduceXiangqi(state: XiangqiState, action: XiangqiAction): XiangqiState {
  switch (action.type) {
    case 'select': {
      assertPlaying(state)
      const index = action.index
      if (!isIndex(index)) throw illegal(`xiangqi.illegal.index:${String(index)}`)
      const piece = state.board[index] as number
      if (piece === EMPTY || sideOf(piece) !== RED) {
        throw illegal(`xiangqi.illegal.select:${String(index)}`)
      }
      // 点同一颗子 = 取消选中
      return { ...state, selected: state.selected === index ? null : index }
    }

    case 'move': {
      assertPlaying(state)
      if (state.sideToMove !== RED) throw illegal('xiangqi.illegal.not-your-turn')
      const { from, to } = action
      if (!isIndex(from) || !isIndex(to)) {
        throw illegal(`xiangqi.illegal.move:${String(from)}-${String(to)}`)
      }
      const move = packMove(from, to)
      // 送将、照面、被牵制的子、走法不合兵种规则……都在这里被挡下
      if (!legalMoves(state.board, RED).includes(move)) {
        throw illegal(`xiangqi.illegal.move:${from}-${to}`)
      }

      const board = state.board.slice()
      applyMove(board, move)
      /*
       * 只走红方这一手，黑方应手留给随后的 `tick`（用户要求 AI 落子前有延迟）。
       * 这一回合先记成 { red: move, black: null }，tick 到位后再补上黑方那手 ——
       * 回合结构不变，所以 encode/decode 的形状也没变。
       * 红方这一手若已终结对局（三次重复判和，或将死/困毙黑方），`gameStatus`
       * 立刻就是非 playing，壳层不会再派 tick（见 index.ts 的 tickMs）。
       */
      const blackReply: number | null = null
      const lastMove = move
      const sideToMove: Side = BLACK
      const rngCursor = state.rngCursor

      return {
        ...state,
        board,
        sideToMove,
        moves: state.moves + 1,
        rngCursor,
        // 走子后取消选中：下一手由玩家重新点自己的子
        selected: null,
        lastMove,
        history: [...state.history, { red: move, black: blackReply }],
      }
    }

    case 'tick': {
      assertPlaying(state)
      if (state.sideToMove !== BLACK) throw illegal('xiangqi.illegal.not-your-turn')
      const board = state.board.slice()
      if (state.opponentPick === null) {
        // 第一拍：只「选中」—— 棋盘一格不动，玩家能看到 AI 挑了哪枚子
        const blackMoves = legalMoves(board, BLACK)
        if (blackMoves.length === 0) throw illegal('xiangqi.illegal.tick-finished')
        const reply = chooseOpponentMove(state.difficulty, board, state.seed, state.rngCursor)
        // AI 必须给出合法着法：真出了岔子就明确报错，而不是让对局悄悄走歪
        if (reply === null || !blackMoves.includes(reply)) {
          throw illegal(`xiangqi.illegal.opponent-move:${String(reply)}`)
        }
        return { ...state, opponentPick: reply }
      }
      // 第二拍：真正落子。着法在第一拍就算好了，这里只核对它仍然合法
      const pick = state.opponentPick
      if (!legalMoves(board, BLACK).includes(pick)) {
        throw illegal(`xiangqi.illegal.opponent-move:${String(pick)}`)
      }
      applyMove(board, pick)
      const history = state.history.slice()
      const pending = history[history.length - 1]
      if (!pending || pending.black !== null) throw illegal('xiangqi.illegal.tick-no-turn')
      history[history.length - 1] = { red: pending.red, black: pick }
      const rngCursor = state.rngCursor + 1
      return { ...state, board, sideToMove: RED, rngCursor, lastMove: pick, opponentPick: null, history }
    }

    case 'undo': {
      if (state.history.length === 0) throw illegal('xiangqi.illegal.nothing-to-undo')
      // 连黑方应手一起退回：弹掉最后一回合并按剩余日志重放，红黑两手同时消失
      const history = state.history.slice(0, -1)
      const replay = replayTurns(history)
      const selected =
        state.selected !== null &&
        (replay.board[state.selected] as number) !== EMPTY &&
        sideOf(replay.board[state.selected] as number) === RED
          ? state.selected
          : null
      return {
        ...state,
        board: replay.board,
        sideToMove: replay.sideToMove,
        opponentPick: null,
        moves: history.length,
        rngCursor: replay.blackCount,
        selected,
        lastMove: replay.lastMove,
        history,
      }
    }

    case 'restart':
      // 同难度同种子重开：回到标准开局，历史清空（输赢后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`xiangqi.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: XiangqiState): XiangqiAction[] {
  const out: XiangqiAction[] = []
  if (gameStatus(state) === 'playing') {
    for (let index = 0; index < CELLS; index++) {
      const piece = state.board[index] as number
      if (piece !== EMPTY && sideOf(piece) === RED) out.push({ type: 'select', index })
    }
    for (const move of legalMoves(state.board, RED)) {
      out.push({ type: 'move', from: moveFrom(move), to: moveTo(move) })
    }
  }
  // 黑方待应手时（红方刚走完、AI 还没落子）只提供 tick：这一拍不属于玩家输入
  if (gameStatus(state) === 'playing' && state.sideToMove === BLACK) {
    out.length = 0
    out.push({ type: 'tick' })
  }
  if (state.history.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 *
 * - 点到自己的棋子 → `select`（点同一颗即取消，由 reduce 处理）；
 * - 已选中时点到该子的**合法落点** → `move`（含吃子）；
 * - 其余（空格、对方棋子且不是落点、终局后）→ null（点了没反应，由壳层给稳定文字提示）。
 *
 * 关键：只给出**当前合法**的那一步 —— 玩家不可能点到会抛错的位置。
 */
export function selectAction(state: XiangqiState, index: number): XiangqiAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!isIndex(index)) return null
  const piece = state.board[index] as number
  if (piece !== EMPTY && sideOf(piece) === RED) return { type: 'select', index }
  const from = state.selected
  if (from === null) return null
  const move = packMove(from, index)
  return legalMoves(state.board, RED).includes(move) ? { type: 'move', from, to: index } : null
}

/* ------------------------------- 存档编解码 ------------------------------- */

export function encodeState(state: XiangqiState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    sideToMove: state.sideToMove === RED ? 'red' : 'black',
    moves: state.moves,
    rngCursor: state.rngCursor,
    selected: state.selected,
    lastMove: state.lastMove,
    opponentPick: state.opponentPick,
    history: state.history.map((turn) => ({ red: turn.red, black: turn.black })),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`xiangqi.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  if (!isIndex(value)) throw illegal(`xiangqi.illegal.state:${field}`)
  return value
}

function readMove(value: unknown, field: string): number {
  if (!isMoveCode(value)) throw illegal(`xiangqi.illegal.state:${field}`)
  return value
}

function readBoard(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== CELLS) throw illegal('xiangqi.illegal.state:board')
  const board: number[] = []
  for (const cell of value) {
    if (!isPieceCode(cell)) throw illegal('xiangqi.illegal.state:board')
    board.push(cell)
  }
  return board
}

function readTurn(value: unknown, position: number): XiangqiTurn {
  if (!value || typeof value !== 'object') throw illegal('xiangqi.illegal.state:turn')
  const entry = value as { red?: unknown; black?: unknown }
  const red = readMove(entry.red, `turn-${position}-red`)
  const black =
    entry.black === null || entry.black === undefined
      ? null
      : readMove(entry.black, `turn-${position}-black`)
  return { red, black }
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。除了字段类型与取值，还做四件事：
 * 1. 用回合日志重放整局（每一手都按当时的局面复核合法性、终局后不得再走），逐格比对存档里的 board；
 * 2. 复核 `history.length === moves` 与 `rngCursor === 黑方应手数`；
 * 3. 复核 `sideToMove` 与 `lastMove` 与重放结果一致；
 * 4. 复核 `selected` 指向的确实是红方棋子（否则宁可不选中）。
 *
 * 刻意**不**复算黑方应手：黑方着法由日志给定，重放不需要调用 AI，
 * 因此 decode 的速度与难度强度无关，也不会因为将来调整 AI 权重而让旧存档变成「损坏」。
 */
export function decodeState(raw: unknown): XiangqiState {
  if (!raw || typeof raw !== 'object') throw illegal('xiangqi.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    board: unknown
    sideToMove: unknown
    moves: unknown
    rngCursor: unknown
    selected: unknown
    lastMove: unknown
    opponentPick: unknown
    history: unknown
  }>

  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('xiangqi.illegal.state:seed')
  const moves = readCount(value.moves, 'moves')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (!Array.isArray(value.history)) throw illegal('xiangqi.illegal.state:history')
  if (value.history.length !== moves) throw illegal('xiangqi.illegal.state:history-length')

  const history = (value.history as unknown[]).map((entry, position) => readTurn(entry, position))
  const replay = replayTurns(history)
  if (replay.blackCount !== rngCursor) throw illegal('xiangqi.illegal.state:cursor')

  const board = readBoard(value.board)
  if (!sameBoard(board, replay.board)) throw illegal('xiangqi.illegal.state:board-log')

  const storedSide = value.sideToMove
  if (storedSide !== 'red' && storedSide !== 'black') throw illegal('xiangqi.illegal.state:side')
  const sideToMove: Side = storedSide === 'red' ? RED : BLACK
  if (sideToMove !== replay.sideToMove) throw illegal('xiangqi.illegal.state:side-log')

  const storedLast = value.lastMove
  const lastMove =
    storedLast === null || storedLast === undefined ? null : readMove(storedLast, 'last-move')
  if (lastMove !== replay.lastMove) throw illegal('xiangqi.illegal.state:last-move')

  // AI 已选中但未落下的着法：只可能出现在「轮到黑方」时，且必须是黑方的合法着法
  const storedPick = value.opponentPick
  const opponentPick =
    storedPick === null || storedPick === undefined ? null : readMove(storedPick, 'opponent-pick')
  if (opponentPick !== null) {
    if (replay.sideToMove !== BLACK) throw illegal('xiangqi.illegal.state:pick-side')
    if (!legalMoves(replay.board, BLACK).includes(opponentPick)) throw illegal('xiangqi.illegal.state:pick')
  }

  const storedSelected = value.selected
  let selected: number | null = null
  if (storedSelected !== null && storedSelected !== undefined) {
    const index = readIndex(storedSelected, 'selected')
    const piece = replay.board[index] as number
    if (piece === EMPTY || sideOf(piece) !== RED) throw illegal('xiangqi.illegal.state:selected')
    selected = index
  }

  return {
    difficulty,
    seed,
    board: replay.board,
    sideToMove: replay.sideToMove,
    moves,
    rngCursor,
    selected,
    opponentPick,
    lastMove: replay.lastMove,
    history,
  }
}

/** 某一方是否正被将军（展示层用它提示「将军」） */
export function inCheck(state: XiangqiState, side: Side): boolean {
  return isKingInCheck(state.board, side)
}
