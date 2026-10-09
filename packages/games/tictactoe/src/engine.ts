/**
 * 井字棋的状态机（纯函数，无副作用）。
 *
 * 设计口径（照恶魔轮盘赌的「种子 + 日志」写法）：
 * 1. **状态只存「难度 + 种子 + 落子日志 + 两个过程中的标记」**，棋盘 / 轮到谁 / 胜负全部由日志重放推出 ——
 *    因此存档不可能出现「盘面与日志不一致」，`decode` 只要重放一遍就能拒绝任何手改过的数据；
 * 2. 玩家派发 `place` 落先手（✕）；对手（○）的应手由壳层定时派发**两拍 tick**完成
 *    （第一拍只亮出它选中的格子、棋盘一格不动，第二拍才落子），所以存在「等对手走棋」的中间态；
 * 3. `restart` 无条件接受（壳层的结果面板/暂停菜单会直接派发）；`undo` 在终局后仍可用；
 * 4. 全部随机性来自 `createRng(seed + 已落手数)`，规则层零时间引用、绝不使用 Math.random。
 *
 * 双人同屏（hotseat）与对电脑走的是同一套规则：差别只有两点 ——
 * 同屏两方都由真人点（谁都能 `place`），且**没有** tick（一个定时器都不起）。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import { OPPONENT_LEVELS, bestMove, chooseOpponentMove, type OpponentLevel } from './ai.js'
import {
  CELLS,
  EMPTY,
  FIRST,
  SECOND,
  createEmptyBoard,
  emptyCells,
  isFull,
  isIndex,
  lineOf,
  winnerOf,
  type Mark,
  type Side,
} from './board.js'

export const TICTACTOE_ID = 'tictactoe'
/** 规则版本：规则语义变化时 +1，旧存档据此判定兼容性 */
export const TICTACTOE_RULES_VERSION = 1
/** 内容版本：本作没有题库/关卡包，随规则一起走 */
export const TICTACTOE_CONTENT_VERSION = 1

/** 前三档只改对手（○）强度；第四档「双人同屏」没有电脑，两个人在同一块屏幕上轮流点 */
export const DIFFICULTY_IDS = [...OPPONENT_LEVELS, 'hotseat'] as const
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(TICTACTOE_ID, `bad difficulty: ${value}`)
  return value
}

export function difficultyLabelKey(id: DifficultyId): string {
  return `${TICTACTOE_ID}.difficulty.${id}`
}

/** 对电脑时返回对手档位；双人同屏返回 null（`null` 就是「这一档没有电脑」的判据） */
export function opponentLevel(difficulty: DifficultyId): OpponentLevel | null {
  return difficulty === 'hotseat' ? null : difficulty
}

export type TictactoeAction =
  /** 在 index 落子（对电脑时只有玩家能派发；同屏时谁轮到就谁派发） */
  | { type: 'place'; index: number }
  /** 自动步进（壳层按 tickMs 定时派发）：第一拍亮出对手选中的格子，第二拍才落子 */
  | { type: 'tick' }
  /** 要一次提示：标出当前这一步的正解（不需要就派发，属于可选功能） */
  | { type: 'hint' }
  /** 撤销：对电脑退一整回合（自己的落子 + 对手的应手），同屏只退最后一手 */
  | { type: 'undo' }
  /** 重开。壳层的结果面板/暂停菜单会无条件派发它，因此必须接受 */
  | { type: 'restart' }

/** 真实结果：先手（✕）胜 / 后手（○）胜 / 和局（九格下满且没人连成线） */
export type Outcome = 'first' | 'second' | 'draw'

export interface TictactoeState {
  difficulty: DifficultyId
  seed: number
  /**
   * 落子日志：每一项是一手的格子索引，**奇偶决定执子方**（第 0 手 ✕、第 1 手 ○、第 2 手 ✕…）。
   * 棋盘、轮到谁、手数、胜负全部由它推出，因此存档里不需要（也不允许）再存一份盘面。
   */
  log: readonly number[]
  /**
   * 对手（○）已经「选中」但还没落下的应手；null = 还没选。
   * 两拍式应手的中间态：第一拍 tick 只记下这个点（目标格在棋盘上亮出内框），第二拍 tick 才落子。
   */
  opponentPick: number | null
  /** 提示格（还是空格）；null = 没有提示。落子 / 撤销 / 重开都会清掉它 */
  hint: number | null
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(TICTACTOE_ID, reason)
}

/** 第 ply 手是谁落的：偶数手先手（✕），奇数手后手（○） */
export function sideAt(ply: number): Side {
  return ply % 2 === 0 ? FIRST : SECOND
}

/**
 * 由落子日志重放盘面（view / decode / 判定共用）。
 *
 * 顺带校验日志自洽 —— 这几条都是 `reduce` 的构造性事实，因此不会误伤自己产生的状态：
 * 每一手都必须在盘内、必须落在空格上，且**不能出现在对局已经结束之后**（有人连成线或盘面已满）。
 */
export function replayLog(log: readonly number[]): Mark[] {
  const board = createEmptyBoard()
  for (let ply = 0; ply < log.length; ply++) {
    const index = log[ply]!
    if (!isIndex(index)) throw illegal(`tictactoe.illegal.state:move:${String(index)}`)
    if (board[index] !== EMPTY) throw illegal(`tictactoe.illegal.state:occupied:${index}`)
    if (winnerOf(board) !== null || isFull(board)) throw illegal('tictactoe.illegal.state:move-after-end')
    board[index] = sideAt(ply)
  }
  return board
}

export function boardOf(state: TictactoeState): Mark[] {
  return replayLog(state.log)
}

/** 现在轮到谁落子 */
export function turnOf(state: TictactoeState): Side {
  return sideAt(state.log.length)
}

export function createState(seed: number, difficulty: DifficultyId): TictactoeState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    log: [],
    opponentPick: null,
    hint: null,
  }
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

/** 真实结果：先看有没有连线，再看九格是否下满 */
export function outcomeOf(state: TictactoeState): Outcome | null {
  const board = boardOf(state)
  const winner = winnerOf(board)
  if (winner === FIRST) return 'first'
  if (winner === SECOND) return 'second'
  return isFull(board) ? 'draw' : null
}

/** 赢的那条线（三格升序）；没人赢返回 null。结果页要把这三格反白，所以单独给一个入口 */
export function winningLineOf(state: TictactoeState): readonly number[] | null {
  const board = boardOf(state)
  const winner = winnerOf(board)
  return winner === null ? null : lineOf(board, winner)
}

/**
 * 终局判定；但 GameStatus 只有三态。
 * - 和局取 `won`：壳层**只在 status !== 'playing' 时**才展示结果面板，
 *   把和局算作 lost 会让玩家在九格下满后看到「你输了」这种与事实不符的结论
 *   （真实结果由 `view()` 的标题说明，和局用 `tictactoe.draw.title`）；
 * - 双人同屏没有「你」这个视角：无论谁赢，状态一律 `won`（标题里写清是哪一位赢的）。
 */
export function gameStatus(state: TictactoeState): GameStatus {
  const outcome = outcomeOf(state)
  if (outcome === null) return 'playing'
  if (outcome === 'draw' || opponentLevel(state.difficulty) === null) return 'won'
  return outcome === 'second' ? 'lost' : 'won'
}

/** 计步：总手数（✕ 与 ○ 都算）。最少手数 = 最快取胜，这就是本作的「最佳成绩」口径 */
export function movesOf(state: TictactoeState): number {
  return state.log.length
}

/** 现在是不是「等电脑应手」的中间态（此时只有 tick 能推进局面） */
function isComputerTurn(state: TictactoeState): boolean {
  return opponentLevel(state.difficulty) !== null && turnOf(state) === SECOND
}

/** 现在能不能要提示：对局中、且轮到真人（对电脑时对手回合不给提示） */
function canHint(state: TictactoeState): boolean {
  if (outcomeOf(state) !== null) return false
  return opponentLevel(state.difficulty) === null || turnOf(state) === FIRST
}

function assertPlayable(state: TictactoeState): void {
  if (outcomeOf(state) !== null) throw illegal('tictactoe.illegal.finished')
}

export function reduceState(state: TictactoeState, action: TictactoeAction): TictactoeState {
  switch (action.type) {
    case 'place': {
      assertPlayable(state)
      // 对电脑时玩家执先手：等应手期间玩家再点棋盘不是「替他落子」，而是还没轮到他
      if (isComputerTurn(state)) throw illegal('tictactoe.illegal.not-your-turn')
      const index = action.index
      if (!isIndex(index)) throw illegal(`tictactoe.illegal.index:${String(index)}`)
      if (boardOf(state)[index] !== EMPTY) throw illegal(`tictactoe.illegal.occupied:${index}`)
      return { ...state, log: [...state.log, index], hint: null }
    }

    case 'tick': {
      assertPlayable(state)
      const level = opponentLevel(state.difficulty)
      if (level === null) throw illegal('tictactoe.illegal.tick-hotseat')
      if (turnOf(state) !== SECOND) throw illegal('tictactoe.illegal.tick-no-turn')
      const board = boardOf(state)
      if (state.opponentPick === null) {
        // 第一拍：只「选中」—— 棋盘一格不动，玩家先看到对手要点哪里
        const pick = chooseOpponentMove(level, board, SECOND, state.seed, state.log.length)
        if (pick === null) throw illegal('tictactoe.illegal.opponent-stuck')
        if (board[pick] !== EMPTY) throw illegal(`tictactoe.illegal.opponent-move:${String(pick)}`)
        return { ...state, opponentPick: pick }
      }
      // 第二拍：真正落子。着法在第一拍就算好了，这里只核对它仍然合法
      const pick = state.opponentPick
      if (!isIndex(pick) || board[pick] !== EMPTY) {
        throw illegal(`tictactoe.illegal.opponent-move:${String(pick)}`)
      }
      return { ...state, log: [...state.log, pick], opponentPick: null, hint: null }
    }

    case 'hint': {
      assertPlayable(state)
      if (!canHint(state)) throw illegal('tictactoe.illegal.hint-not-your-turn')
      const pick = bestMove(boardOf(state), turnOf(state))
      if (pick === null) throw illegal('tictactoe.illegal.hint-none')
      return { ...state, hint: pick }
    }

    case 'undo': {
      if (state.log.length === 0) throw illegal('tictactoe.illegal.nothing-to-undo')
      /*
       * 对电脑：退到「玩家自己的回合」—— 最后一手是玩家的就退一手，是电脑的就连它一起退（= 撤销一回合）。
       * 同屏：只退最后一手（两个人各自悔自己刚下的那一步，不该替对方悔棋）。
       */
      const vsComputer = opponentLevel(state.difficulty) !== null
      const step = vsComputer ? (state.log.length % 2 === 1 ? 1 : 2) : 1
      return { ...state, log: state.log.slice(0, state.log.length - step), opponentPick: null, hint: null }
    }

    case 'restart':
      // 同难度同种子重开：回到空棋盘（换种子重开由壳层的「重新开始」另派一个新 seed）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（旧存档/壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`tictactoe.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: TictactoeState): TictactoeAction[] {
  const actions: TictactoeAction[] = []
  if (outcomeOf(state) === null) {
    if (isComputerTurn(state)) {
      // 等电脑应手：只接受 tick（玩家这一手已经落在盘上了）
      actions.push({ type: 'tick' })
    } else {
      for (const index of emptyCells(boardOf(state))) actions.push({ type: 'place', index })
    }
    if (canHint(state)) actions.push({ type: 'hint' })
  }
  if (state.log.length > 0) actions.push({ type: 'undo' })
  actions.push({ type: 'restart' })
  return actions
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 越界 / 已占用 / 对局结束 / 还没轮到玩家的格子一律返回 null：
 * 点了没反应比弹错误自然（手机端误触很常见），壳层另有统一的提示口径。
 */
export function selectAction(state: TictactoeState, index: number): TictactoeAction | null {
  if (!isIndex(index)) return null
  if (outcomeOf(state) !== null) return null
  if (isComputerTurn(state)) return null
  if (boardOf(state)[index] !== EMPTY) return null
  return { type: 'place', index }
}

export function encodeState(state: TictactoeState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    log: [...state.log],
    opponentPick: state.opponentPick,
    hint: state.hint,
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`tictactoe.illegal.state:${field}`)
  }
  return value
}

function readIndex(value: unknown, field: string): number {
  const index = readCount(value, field)
  if (index >= CELLS) throw illegal(`tictactoe.illegal.state:${field}`)
  return index
}

function readOptionalIndex(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : readIndex(value, field)
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 * 除了字段类型与取值，还用日志重放盘面，并复核两个过程中的标记：
 * - `opponentPick` 只能出现在「对电脑 + 轮到后手 + 对局未结束」的中间态，且必须是空格；
 * - `hint` 只能出现在「对局中 + 轮到真人」的局面，且必须是空格。
 * 重放不需要调用 AI，因此 decode 与对手强度无关（换难度不会让旧存档失效）。
 */
export function decodeState(raw: unknown): TictactoeState {
  if (!raw || typeof raw !== 'object') throw illegal('tictactoe.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    log: unknown
    opponentPick: unknown
    hint: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('tictactoe.illegal.state:seed')
  if (!Array.isArray(value.log)) throw illegal('tictactoe.illegal.state:log')
  const log = (value.log as unknown[]).map((entry, ply) => readIndex(entry, `move-${ply}`))
  const board = replayLog(log)

  const state: TictactoeState = { difficulty, seed, log, opponentPick: null, hint: null }
  const finished = outcomeOf(state) !== null

  const opponentPick = readOptionalIndex(value.opponentPick, 'opponent-pick')
  if (opponentPick !== null) {
    if (opponentLevel(difficulty) === null || turnOf(state) !== SECOND || finished) {
      throw illegal('tictactoe.illegal.state:pick-side')
    }
    if (board[opponentPick] !== EMPTY) throw illegal('tictactoe.illegal.state:pick')
  }

  const hint = readOptionalIndex(value.hint, 'hint')
  if (hint !== null) {
    if (finished || (opponentLevel(difficulty) !== null && turnOf(state) !== FIRST)) {
      throw illegal('tictactoe.illegal.state:hint-side')
    }
    if (board[hint] !== EMPTY) throw illegal('tictactoe.illegal.state:hint')
  }

  return { difficulty, seed, log, opponentPick, hint }
}
