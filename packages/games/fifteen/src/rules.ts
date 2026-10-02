/**
 * 规则层：状态、动作执行与存档编解码（纯函数，无副作用）。
 *
 * 三个约定：
 * 1. 方向语义统一为「**空白格朝该方向移动**」（等价于把该方向相邻的数字块滑进空白）；
 *    走不通时抛 IllegalActionError，壳层据此给出明确文字反馈，而不是静默无响应；
 * 2. 点格子（tap）只有与空白相邻的数字块才生效，其余返回原状态（点了没反应比报错自然）；
 * 3. 本玩法没有失败态：还原即 `won`，还原后再滑一步会变回 `playing`（允许继续玩），
 *    因此滑动/点格**不**做「对局已结束」的前置检查；restart / undo 同样无条件可用。
 *
 * 状态里的 `board` 与 `history` 都按不可变方式使用：每个动作返回新对象，绝不原地改写，
 * 因此撤销能精确回到「上一次 encode 的结果」。
 */
import { IllegalActionError, type GameStatus, type MoveDir } from '@eink/core'
import {
  DIRECTIONS,
  GAME_ID,
  cellCount,
  configFor,
  difficultyOrThrow,
  isMoveDir,
  isSolvable,
  isSolved,
  normalizeSeed,
  scrambleBoard,
  slide,
  slideTile,
  type DifficultyId,
} from './board.js'

export type FifteenAction =
  /** 空白格朝 dir 移动一格（方向键）。走不通抛 IllegalActionError */
  | { type: 'slide'; dir: MoveDir }
  /**
   * 壳层兼容别名：GameScreen 的方向盘与键盘回调派发的是 `{ type: 'move', dir }`
   * （见 apps/web 的 GameScreen.onMove / useKeyboardControls），与 `slide` 语义完全一致。
   * 契约里本玩法的动作名是 `slide`；这里多接受一个 `move` 是为了让现有壳层无需改动即可操作，
   * `legal()` 仍然只输出规范动作 `slide`。
   */
  | { type: 'move'; dir: MoveDir }
  /** 点第 index 格：只有与空白相邻的数字块滑入空白；其余点击无效果（返回原状态） */
  | { type: 'tap'; index: number }
  /** 撤回上一次滑动。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：回到同难度同种子的初始局面。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

/** 一步快照：撤销只需要「滑动前的棋盘 + 滑动前的步数」 */
export interface FifteenSnapshot {
  readonly board: readonly number[]
  readonly moves: number
}

export interface FifteenState {
  readonly difficulty: DifficultyId
  /** 打乱种子：同 seed + 同难度 + 同动作序列必然得到同一局面 */
  readonly seed: number
  /** 打乱消耗的随机数个数（载入时据此复核初始局面） */
  readonly rngCursor: number
  /** 行优先的格子数组：0 表示空白格，1..N−1 为数字块 */
  readonly board: readonly number[]
  /** 累计滑动步数（撤销会回退） */
  readonly moves: number
  /** 每次滑动前的快照；`history.length` 恒等于 `moves` */
  readonly history: readonly FifteenSnapshot[]
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

/** 确定性初始状态：从已还原局面随机游走打乱（构造性保证可解，且不等于已还原） */
export function createState(seed: number, difficulty: DifficultyId): FifteenState {
  const normalized = normalizeSeed(seed)
  const { board, cursor } = scrambleBoard(configFor(difficulty), normalized)
  return {
    difficulty,
    seed: normalized,
    rngCursor: cursor,
    board,
    moves: 0,
    history: [],
  }
}

/** 只有 `won`（还原）与 `playing` 两种状态，本玩法没有失败态 */
export function gameStatus(state: FifteenState): GameStatus {
  return isSolved(state.board, configFor(state.difficulty).size) ? 'won' : 'playing'
}

/** 记一步：把「滑动前的棋盘与步数」压入历史，返回新状态 */
function advance(state: FifteenState, board: readonly number[]): FifteenState {
  return {
    ...state,
    board,
    moves: state.moves + 1,
    history: [...state.history, { board: state.board, moves: state.moves }],
  }
}

function applySlide(state: FifteenState, dir: MoveDir): FifteenState {
  if (!isMoveDir(dir)) throw illegal(`fifteen.illegal.dir:${String(dir)}`)
  const size = configFor(state.difficulty).size
  const next = slide(state.board, size, dir)
  // 走不通（空白格已在边上）：明确拒绝，壳层按 illegalNoticeKey 提示
  if (next === null) throw illegal(`fifteen.illegal.slide:${dir}`)
  return advance(state, next)
}

function applyTap(state: FifteenState, index: number): FifteenState {
  const size = configFor(state.difficulty).size
  if (!Number.isInteger(index) || index < 0 || index >= state.board.length) {
    throw illegal(`fifteen.illegal.index:${String(index)}`)
  }
  const next = slideTile(state.board, size, index)
  // 点了空白格或不相邻的数字块：返回原状态（点击无效），不报错
  if (next === null) return state
  return advance(state, next)
}

export function reduceFifteen(state: FifteenState, action: FifteenAction): FifteenState {
  switch (action.type) {
    case 'slide':
    case 'move':
      return applySlide(state, action.dir)

    case 'tap':
      return applyTap(state, action.index)

    case 'undo': {
      const previous = state.history[state.history.length - 1]
      if (previous === undefined) throw illegal('fifteen.illegal.nothing-to-undo')
      // 快照取的是滑动前，因此棋盘/步数一次还原，encode 与滑动前逐字段相同
      return {
        ...state,
        board: previous.board.slice(),
        moves: previous.moves,
        history: state.history.slice(0, -1),
      }
    }

    case 'restart':
      // 同难度同种子重开：回到初始局面，历史清空（还原后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`fifteen.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验）；还原后仍可继续滑动 */
export function legalActions(state: FifteenState): FifteenAction[] {
  const size = configFor(state.difficulty).size
  const out: FifteenAction[] = []
  for (const dir of DIRECTIONS) {
    const next = slide(state.board, size, dir)
    if (next !== null) out.push({ type: 'slide', dir })
  }
  if (state.history.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * - 越界 / 空白格 / 与空白不相邻的数字块都返回 null：点了没反应比弹错误自然；
 * - 相邻的数字块返回 tap，由 reduce 执行滑动。
 */
export function selectAction(state: FifteenState, index: number): FifteenAction | null {
  const size = configFor(state.difficulty).size
  if (!Number.isInteger(index) || index < 0 || index >= state.board.length) return null
  if (slideTile(state.board, size, index) === null) return null
  return { type: 'tap', index }
}

export function encodeState(state: FifteenState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    rngCursor: state.rngCursor,
    board: [...state.board],
    moves: state.moves,
    history: state.history.map((snapshot) => ({
      board: [...snapshot.board],
      moves: snapshot.moves,
    })),
  }
}

/** 校验一个「数字块 + 空白格」的排列：长度、取值、去重三者都要成立 */
function readBoard(value: unknown, expected: number, field: string): number[] {
  if (!Array.isArray(value) || value.length !== expected) throw illegal(`fifteen.illegal.state:${field}`)
  const seen = new Set<number>()
  const board: number[] = []
  for (const cell of value) {
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= expected) {
      throw illegal(`fifteen.illegal.state:${field}`)
    }
    if (seen.has(cell)) throw illegal(`fifteen.illegal.state:${field}`)
    seen.add(cell)
    board.push(cell)
  }
  return board
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`fifteen.illegal.state:${field}`)
  }
  return value
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 *
 * 除了字段类型与排列合法性，还复核四条不变量：
 * 1. 初始局面可复算：`rngCursor` 必须等于同 seed/难度打乱的随机数消耗量，
 *    且 `moves === 0` 时棋盘必须与复算出的初始局面完全一致（保证「同 seed 同初始局面」）；
 * 2. 当前棋盘必须满足逆序数奇偶性可解（任何真实可达局面都满足；被改过奇偶性的盘面在此拒绝）；
 * 3. `history.length === moves`，且第 i 份快照的步数恰好是 i（每次滑动留一份，顺序递增）；
 * 4. 快照棋盘也是合法排列且可解。
 * decode 只搬运存档内容，不会重放动作去重算棋盘。
 */
export function decodeState(raw: unknown): FifteenState {
  if (!raw || typeof raw !== 'object') throw illegal('fifteen.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    rngCursor: unknown
    board: unknown
    moves: unknown
    history: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const config = configFor(difficulty)
  const total = cellCount(config)

  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('fifteen.illegal.state:seed')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  const board = readBoard(value.board, total, 'board')
  const moves = readCount(value.moves, 'moves')

  // 不变量 1：初始局面可复算（打乱是确定性的，游标必须对得上）
  const initial = createState(seed, difficulty)
  if (rngCursor !== initial.rngCursor) throw illegal('fifteen.illegal.state:rng-cursor')
  if (moves === 0 && !board.every((cell, index) => cell === initial.board[index])) {
    throw illegal('fifteen.illegal.state:initial-board')
  }
  // 不变量 2：当前盘面必须可解
  if (!isSolvable(board, config.size) || !isSolvable(initial.board, config.size)) {
    throw illegal('fifteen.illegal.state:unsolvable')
  }

  if (!Array.isArray(value.history)) throw illegal('fifteen.illegal.state:history')
  const history: FifteenSnapshot[] = (value.history as unknown[]).map((entry, position) => {
    if (!entry || typeof entry !== 'object') throw illegal('fifteen.illegal.state:history-entry')
    const snapshot = entry as Partial<Record<keyof FifteenSnapshot, unknown>>
    const snapshotBoard = readBoard(snapshot.board, total, 'history-board')
    const snapshotMoves = readCount(snapshot.moves, 'history-moves')
    // 不变量 3：快照顺序必须与步数一一对应
    if (snapshotMoves !== position) throw illegal('fifteen.illegal.state:history-order')
    // 不变量 4：快照棋盘同样要可解
    if (!isSolvable(snapshotBoard, config.size)) {
      throw illegal('fifteen.illegal.state:history-unsolvable')
    }
    return { board: snapshotBoard, moves: snapshotMoves }
  })
  if (history.length !== moves) throw illegal('fifteen.illegal.state:history-length')

  // 初始局面是「第 0 步」：有历史时，第一份快照必须就是它（否则撤销会回不到起点）
  if (history.length > 0) {
    const first = history[0]!
    if (!first.board.every((cell, index) => cell === initial.board[index])) {
      throw illegal('fifteen.illegal.state:history-root')
    }
  }

  return { difficulty, seed, rngCursor, board, moves, history }
}
