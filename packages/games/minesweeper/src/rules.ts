/**
 * 扫雷规则层：纯函数、无副作用、无平台依赖。
 *
 * 状态是「不可变」的：每个动作返回新状态，绝不原地改写。
 * 地雷在第一次翻开时才放置（延迟布雷），因此首点及其 8 邻域必然安全；
 * `encode`/`decode` 只搬运已经放好的雷，**不会**重新布雷（否则同一存档双端会开出不同盘面）。
 *
 * 撤销（`history`）：每次**被接受**的棋盘动作（翻开 / 插旗）压入一条「逆操作」，
 * `undo` 弹出一条并精确还原。存逆操作而不是整盘快照：16×16/50 雷的一盘要走上百步，
 * 快照栈会让存档膨胀到几百 KB（每走一步都要落盘），而逆操作只记「这一步新翻开了哪些格」。
 * 输局（踩雷）后也允许撤销 —— 那正是玩家最需要撤销的时刻。
 */
import { IllegalActionError, type GameStatus } from '@eink/core'
import {
  cellCount,
  configFor,
  difficultyOrThrow,
  GAME_ID,
  type DifficultyId,
} from './difficulty.js'
import { expandChain, neighborsOf, placeMines } from './generate.js'

export type MinesweeperAction =
  /** 翻开一格（点到雷即输） */
  | { type: 'reveal'; index: number }
  /** 插旗 / 取消旗 */
  | { type: 'toggleFlag'; index: number }
  /** 切换「标记模式」：开启后点格子 = 插旗（手机端没有右键，必须给一个明确的模式开关） */
  | { type: 'toggleFlagMode' }
  /** 撤销上一次被接受的棋盘动作（翻开 / 插旗）；没有可撤销的动作时明确抛错 */
  | { type: 'undo' }
  /** 重开。壳层的重开按钮与 R 键会无条件派发它，因此规则层必须接受 */
  | { type: 'restart' }

/**
 * 一条「逆操作」：撤销时按它把局面精确还原回去。
 *
 * · reveal：`added` 是这次新翻开的格子（连锁翻开可能有几十格）。
 *   撤销 = 把这些格子重新变回未翻开；`wasFirstClick` 为真时还要把延迟布雷一并还原
 *   （mines 清空、firstIndex/firstClickUsed/rngCursor 归零）—— 于是再点一次仍按
 *   同一 seed 布出同一份雷图，「同种子同结果」不受撤销影响。
 * · flag：插旗与取消旗互为逆操作，再翻一次同一格即可。
 */
export type MinesweeperUndoEntry =
  | { readonly kind: 'reveal'; readonly added: readonly number[]; readonly wasFirstClick: boolean }
  | { readonly kind: 'flag'; readonly index: number }

export interface MinesweeperState {
  difficulty: DifficultyId
  /** 布雷种子：同 seed + 同操作序列必然得到同一局面 */
  seed: number
  /** 雷位置（升序）：首次翻开之前是空数组 —— 延迟布雷 */
  mines: readonly number[]
  /** 已翻开的格子（升序） */
  revealed: readonly number[]
  /** 插旗的格子（升序） */
  flags: readonly number[]
  /** 首点位置；null 表示还没翻开过任何格子（此时 mines 必为空） */
  firstIndex: number | null
  /** 首点是否已用。与 firstIndex !== null 同义，单独存一份让存档自解释 */
  firstClickUsed: boolean
  /** 布雷消耗的随机数个数（游标）；decode 不会重放随机数，只做校验 */
  rngCursor: number
  /** 标记模式：开启后点格子 = 插旗 */
  flagMode: boolean
  /** 撤销栈：每次被接受的棋盘动作压入一条逆操作（重开清空） */
  history: readonly MinesweeperUndoEntry[]
}

/** 升序去重，保证状态可以用深比较直接比对 */
function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

export function createState(seed: number, difficulty: DifficultyId): MinesweeperState {
  return {
    difficulty,
    seed,
    mines: [],
    revealed: [],
    flags: [],
    firstIndex: null,
    firstClickUsed: false,
    rngCursor: 0,
    flagMode: false,
    history: [],
  }
}

export function gameStatus(state: MinesweeperState): GameStatus {
  const config = configFor(state.difficulty)
  const mineSet = new Set(state.mines)
  // 翻开过雷 = 输。首点必安全，因此这只可能发生在非首点的翻开上
  if (state.revealed.some((index) => mineSet.has(index))) return 'lost'
  if (!state.firstClickUsed) return 'playing'
  // 所有非雷格都翻开 = 赢
  return state.revealed.length >= cellCount(config) - state.mines.length ? 'won' : 'playing'
}

/** 剩余雷数 = 总雷数 − 旗数（与界面统计一致；多插旗会出现负数，这是经典行为） */
export function remainingMines(state: MinesweeperState): number {
  return configFor(state.difficulty).mineCount - state.flags.length
}

export function totalCells(state: MinesweeperState): number {
  return cellCount(configFor(state.difficulty))
}

function assertPlayable(state: MinesweeperState): void {
  if (gameStatus(state) !== 'playing') {
    throw new IllegalActionError(GAME_ID, 'game already finished')
  }
}

function assertIndex(state: MinesweeperState, index: number): void {
  const total = totalCells(state)
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new IllegalActionError(GAME_ID, `index out of range: ${index}`)
  }
}

export function reduceMinesweeper(
  state: MinesweeperState,
  action: MinesweeperAction,
): MinesweeperState {
  switch (action.type) {
    case 'restart':
      // 重开回到初始状态（同难度、同种子），延迟布雷重新挂起；输/赢后也必须可用
      return createState(state.seed, state.difficulty)

    case 'toggleFlagMode': {
      assertPlayable(state)
      return { ...state, flagMode: !state.flagMode }
    }

    case 'toggleFlag': {
      assertPlayable(state)
      assertIndex(state, action.index)
      // 已翻开的格子不可能还是雷、也没必要插旗：明确报错，而不是悄悄忽略
      if (state.revealed.includes(action.index)) {
        throw new IllegalActionError(GAME_ID, `cell ${action.index} is already revealed`)
      }
      const flags = state.flags.includes(action.index)
        ? state.flags.filter((index) => index !== action.index)
        : sortedUnique([...state.flags, action.index])
      return {
        ...state,
        flags,
        history: [...state.history, { kind: 'flag', index: action.index }],
      }
    }

    case 'reveal':
      return reveal(state, action.index)

    case 'undo': {
      /*
       * 撤销：**不经过 assertPlayable** —— 踩雷输掉之后正是最需要撤销的时刻，
       * 而输局状态会拒绝其它动作。没有可撤销的动作时明确抛错（壳层给出文字提示），
       * 而不是静默返回原状态（那样按钮点了像坏了）。
       */
      const entry = state.history[state.history.length - 1]
      if (!entry) throw new IllegalActionError(GAME_ID, 'nothing to undo')
      const history = state.history.slice(0, -1)
      if (entry.kind === 'flag') {
        const flags = state.flags.includes(entry.index)
          ? state.flags.filter((index) => index !== entry.index)
          : sortedUnique([...state.flags, entry.index])
        return { ...state, flags, history }
      }
      const added = new Set(entry.added)
      const revealed = state.revealed.filter((index) => !added.has(index))
      if (!entry.wasFirstClick) return { ...state, revealed, history }
      // 撤销的这一步就是首点：延迟布雷一并作废，重新点任意一格都会按 seed 布出同一份雷图
      return {
        ...state,
        mines: [],
        revealed,
        firstIndex: null,
        firstClickUsed: false,
        rngCursor: 0,
        history,
      }
    }

    default: {
      // 壳层会无条件派发 move / nextLevel（方向键、结果面板按钮）：
      // 扫雷没有这些语义，按契约抛错，壳层会给出明确文字提示而不是静默无响应
      const unknown = action as { type?: string }
      throw new IllegalActionError(GAME_ID, `unknown action ${String(unknown.type)}`)
    }
  }
}

function reveal(state: MinesweeperState, index: number): MinesweeperState {
  assertPlayable(state)
  assertIndex(state, index)
  // 重复翻开已翻开的格子、或点已插旗的格子：幂等（返回原状态，不报错）。
  // 手机端误触很常见，静默忽略比弹错误更自然；插旗格受旗子保护不被翻开。
  if (state.revealed.includes(index) || state.flags.includes(index)) return state

  const config = configFor(state.difficulty)
  const wasFirstClick = !state.firstClickUsed
  let mines = state.mines
  let rngCursor = state.rngCursor
  if (wasFirstClick) {
    const placement = placeMines(config, state.seed, index)
    mines = placement.mines
    rngCursor = placement.cursor
  }
  const placed: MinesweeperState = {
    ...state,
    mines,
    rngCursor,
    firstIndex: state.firstIndex ?? index,
    firstClickUsed: true,
  }
  const mineSet = new Set(mines)
  /** 本次动作新翻开的格子 = 撤销要还原回去的那一批（连锁翻开可能有几十格） */
  const undoEntry = (added: readonly number[]): MinesweeperUndoEntry => ({
    kind: 'reveal',
    added,
    wasFirstClick,
  })
  if (mineSet.has(index)) {
    // 踩雷：本次只翻开踩中的那一颗，其余雷由 view 在输局后统一亮出
    return {
      ...placed,
      revealed: sortedUnique([...placed.revealed, index]),
      history: [...state.history, undoEntry([index])],
    }
  }
  const revealed = expandChain(config, mineSet, new Set(placed.flags), new Set(placed.revealed), index)
  // expandChain 只会新增格子，因此「新翻开的格子」= 结果里原本没翻开的部分
  const before = new Set(placed.revealed)
  return {
    ...placed,
    revealed,
    history: [...state.history, undoEntry(revealed.filter((cell) => !before.has(cell)))],
  }
}

/** 当前局面下规则允许的动作（可用按钮/回放校验） */
export function legalActions(state: MinesweeperState): readonly MinesweeperAction[] {
  const out: MinesweeperAction[] = [{ type: 'restart' }]
  // 撤销在输/赢之后仍然可用（踩雷那一步正是最想撤回的），因此放在状态判断之前
  if (state.history.length > 0) out.push({ type: 'undo' })
  if (gameStatus(state) !== 'playing') return out
  out.push({ type: 'toggleFlagMode' })
  const revealed = new Set(state.revealed)
  const flags = new Set(state.flags)
  for (let index = 0; index < totalCells(state); index++) {
    if (!revealed.has(index) && !flags.has(index)) out.push({ type: 'reveal', index })
    if (!revealed.has(index)) out.push({ type: 'toggleFlag', index })
  }
  return out
}

/**
 * 「点了第 index 个格子」→ 一个动作。
 * 没有光标概念（手机端直接点格子），因此这里直接返回 reveal；
 * 标记模式开启时返回 toggleFlag。返回 null 表示该格当前不可点。
 */
export function selectAction(state: MinesweeperState, index: number): MinesweeperAction | null {
  if (gameStatus(state) !== 'playing') return null
  const total = totalCells(state)
  if (!Number.isInteger(index) || index < 0 || index >= total) return null
  if (state.revealed.includes(index)) return null
  if (state.flagMode) return { type: 'toggleFlag', index }
  // 插旗的格子受保护，点它不会翻开
  if (state.flags.includes(index)) return null
  return { type: 'reveal', index }
}

export function encodeState(state: MinesweeperState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    mines: [...state.mines],
    revealed: [...state.revealed],
    flags: [...state.flags],
    firstIndex: state.firstIndex,
    firstClickUsed: state.firstClickUsed,
    rngCursor: state.rngCursor,
    flagMode: state.flagMode,
    // 撤销栈一起进存档：重开应用后仍能撤销（与其它玩法的约定一致）
    history: state.history.map((entry) =>
      entry.kind === 'flag'
        ? { kind: 'flag', index: entry.index }
        : { kind: 'reveal', added: [...entry.added], wasFirstClick: entry.wasFirstClick },
    ),
  }
}

function readIntList(value: unknown, total: number, field: string): number[] {
  if (!Array.isArray(value)) throw new IllegalActionError(GAME_ID, `bad ${field}`)
  const out: number[] = []
  const seen = new Set<number>()
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= total) {
      throw new IllegalActionError(GAME_ID, `bad index in ${field}`)
    }
    if (seen.has(item)) throw new IllegalActionError(GAME_ID, `duplicate index in ${field}`)
    seen.add(item)
    out.push(item)
  }
  return out.sort((a, b) => a - b)
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new IllegalActionError(GAME_ID, `bad ${field}`)
  return value
}

function readRngCursor(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new IllegalActionError(GAME_ID, `bad ${field}`)
  }
  return value
}

/**
 * 撤销栈的校验。
 *
 * `undefined` 视为空栈：加了撤销之后，**旧存档（没有 history 字段）必须继续能读**，
 * 否则玩家已有的进度会被判成「存档损坏」。
 * 有该字段时逐条校验，坏数据（越界索引、重复格、未知 kind）一律拒绝。
 */
function readHistory(value: unknown, total: number): MinesweeperUndoEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new IllegalActionError(GAME_ID, 'bad history')
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new IllegalActionError(GAME_ID, 'bad history entry')
    }
    const entry = raw as {
      kind?: unknown
      added?: unknown
      wasFirstClick?: unknown
      index?: unknown
    }
    if (entry.kind === 'flag') {
      const index = entry.index
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= total) {
        throw new IllegalActionError(GAME_ID, 'bad history flag index')
      }
      return { kind: 'flag', index: index as number }
    }
    if (entry.kind === 'reveal') {
      return {
        kind: 'reveal',
        added: readIntList(entry.added, total, 'history added'),
        wasFirstClick: readBoolean(entry.wasFirstClick, 'history wasFirstClick'),
      }
    }
    throw new IllegalActionError(GAME_ID, 'bad history kind')
  })
}

/**
 * 严格校验存档（对应「拒绝损坏或非法存档」）。
 *
 * 除了字段类型与取值范围，还复核两条不变量：
 * 1. 首点安全：首点及其 8 邻域内不得有雷；
 * 2. 布雷一致性：首点前无雷、首点后恰好 mineCount 颗雷。
 * 被篡改的存档会在这里被拒绝，而不是算出一个奇怪的盘面。
 * decode 只读取雷位置，不会重新布雷。
 */
export function decodeState(raw: unknown): MinesweeperState {
  if (!raw || typeof raw !== 'object') throw new IllegalActionError(GAME_ID, 'bad state')
  const value = raw as Partial<MinesweeperState>
  if (typeof value.difficulty !== 'string') throw new IllegalActionError(GAME_ID, 'bad difficulty')
  const difficulty = difficultyOrThrow(value.difficulty)
  const config = configFor(difficulty)
  const total = cellCount(config)

  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0) {
    throw new IllegalActionError(GAME_ID, 'bad seed')
  }
  if (value.seed > 0xffffffff) throw new IllegalActionError(GAME_ID, 'seed out of range')
  const rngCursor = readRngCursor(value.rngCursor, 'rngCursor')
  const flagMode = readBoolean(value.flagMode, 'flagMode')
  const firstClickUsed = readBoolean(value.firstClickUsed, 'firstClickUsed')

  const firstIndex = value.firstIndex === null || value.firstIndex === undefined
    ? null
    : value.firstIndex
  if (firstIndex !== null) {
    if (!Number.isInteger(firstIndex) || firstIndex < 0 || firstIndex >= total) {
      throw new IllegalActionError(GAME_ID, 'bad firstIndex')
    }
  }
  // 「首点已用」是布尔字段，但也必须与 firstIndex 一致，否则存档自相矛盾
  if (firstClickUsed !== (firstIndex !== null)) {
    throw new IllegalActionError(GAME_ID, 'firstClickUsed disagrees with firstIndex')
  }

  const mines = readIntList(value.mines, total, 'mines')
  const revealed = readIntList(value.revealed, total, 'revealed')
  const flags = readIntList(value.flags, total, 'flags')
  const history = readHistory(value.history, total)

  if (firstIndex === null && revealed.length > 0) {
    throw new IllegalActionError(GAME_ID, 'revealed cells before the first click')
  }
  if (firstIndex === null && mines.length !== 0) {
    throw new IllegalActionError(GAME_ID, 'mines placed before the first click')
  }
  if (firstIndex !== null && mines.length !== config.mineCount) {
    throw new IllegalActionError(GAME_ID, 'mine count does not match difficulty')
  }
  if (firstIndex !== null) {
    const safe = new Set([firstIndex, ...neighborsOf(config, firstIndex)])
    if (mines.some((index) => safe.has(index))) {
      throw new IllegalActionError(GAME_ID, 'first click is not safe')
    }
  }
  if (revealed.some((index) => flags.includes(index))) {
    throw new IllegalActionError(GAME_ID, 'revealed cell cannot be flagged')
  }
  const mineSet = new Set(mines)
  // 输局只会翻开踩中的那一颗雷，翻开出两颗雷说明存档被改过
  if (revealed.filter((index) => mineSet.has(index)).length > 1) {
    throw new IllegalActionError(GAME_ID, 'more than one mine revealed')
  }

  return {
    difficulty,
    seed: value.seed,
    mines,
    revealed,
    flags,
    firstIndex,
    firstClickUsed,
    rngCursor,
    flagMode,
    history,
  }
}
