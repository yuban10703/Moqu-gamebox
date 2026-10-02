/**
 * 扫雷规则层：纯函数、无副作用、无平台依赖。
 *
 * 状态是「不可变」的：每个动作返回新状态，绝不原地改写。
 * 地雷在第一次翻开时才放置（延迟布雷），因此首点及其 8 邻域必然安全；
 * `encode`/`decode` 只搬运已经放好的雷，**不会**重新布雷（否则同一存档双端会开出不同盘面）。
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
  /** 重开。壳层的重开按钮与 R 键会无条件派发它，因此规则层必须接受 */
  | { type: 'restart' }

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
      return { ...state, flags }
    }

    case 'reveal':
      return reveal(state, action.index)

    default: {
      // 壳层会无条件派发 move / undo / nextLevel（方向键、U 键、结果面板按钮）：
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
  let mines = state.mines
  let rngCursor = state.rngCursor
  if (!state.firstClickUsed) {
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
  if (mineSet.has(index)) {
    // 踩雷：本次只翻开踩中的那一颗，其余雷由 view 在输局后统一亮出
    return { ...placed, revealed: sortedUnique([...placed.revealed, index]) }
  }
  return {
    ...placed,
    revealed: expandChain(
      config,
      mineSet,
      new Set(placed.flags),
      new Set(placed.revealed),
      index,
    ),
  }
}

/** 当前局面下规则允许的动作（可用按钮/回放校验） */
export function legalActions(state: MinesweeperState): readonly MinesweeperAction[] {
  const out: MinesweeperAction[] = [{ type: 'restart' }]
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
  if (
    typeof value.rngCursor !== 'number' ||
    !Number.isInteger(value.rngCursor) ||
    value.rngCursor < 0
  ) {
    throw new IllegalActionError(GAME_ID, 'bad rngCursor')
  }
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
    rngCursor: value.rngCursor,
    flagMode,
  }
}
