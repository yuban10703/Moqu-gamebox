/**
 * 2048 规则层：纯函数、无副作用、无 DOM。
 *
 * 关键设计取舍 —— 随机性写成「种子 + 游标」而不是保存 Rng 实例：
 * 状态必须能原样存进 JSON 存档，而 Rng 的内部状态是闭包、不可序列化；
 * 把「已消耗的随机数个数」作为游标写进状态后，任意时刻生成新块都等价于
 * `mulberry32(seed + cursor)` 的第 0/1 个输出（core 的 createRng 就是 mulberry32），
 * 因此同一 seed + 同一动作序列在双端必然得到完全相同的局面（F01）。
 * 规则层禁止 Math.random / Date.now。
 */
import { IllegalActionError, createRng, type GameStatus, type MoveDir } from '@eink/core'

export const GAME_2048_ID = '2048'

/** 四个滑动方向；顺序固定，保证 legal / controls 的输出稳定可断言 */
export const ALL_DIRS: readonly MoveDir[] = ['up', 'down', 'left', 'right']

/** 新块为 4 的概率，其余为 2（经典 2048 的 10%） */
export const SPAWN_FOUR_RATE = 0.1

/** 每次生成新块恰好消耗 2 个随机数：先选空格、再定数值 */
export const DRAWS_PER_SPAWN = 2

export type DifficultyId = 'starter' | 'skilled' | 'challenging'

export interface Difficulty2048 {
  readonly id: DifficultyId
  /** 棋盘边长（4 → 16 格，5 → 25 格） */
  readonly size: number
  /** 出现该数值即算达成目标 */
  readonly target: number
}

/**
 * 难度档位：入门目标低（256，快速有结果）、熟练是经典 2048、
 * 挑战用 5×5 更大棋盘（空格更多，因此目标同为 2048 但难度不同）。
 */
export const DIFFICULTIES: readonly Difficulty2048[] = [
  { id: 'starter', size: 4, target: 256 },
  { id: 'skilled', size: 4, target: 2048 },
  { id: 'challenging', size: 5, target: 2048 },
]

export const DIFFICULTY_IDS: readonly DifficultyId[] = DIFFICULTIES.map((spec) => spec.id)

/** 未知难度一律拒绝（存档损坏 / 版本不兼容都要有明确反馈） */
export function difficultyOf(id: string): Difficulty2048 {
  const spec = DIFFICULTIES.find((entry) => entry.id === id)
  if (!spec) throw new IllegalActionError(GAME_2048_ID, `unknown difficulty ${id}`)
  return spec
}

/** 一次有效移动之前的局面快照（撤销用） */
export interface Snapshot {
  readonly board: readonly number[]
  readonly score: number
  readonly moves: number
  readonly cursor: number
}

export interface Game2048State extends Snapshot {
  readonly difficulty: DifficultyId
  readonly seed: number
  /**
   * 从初始局面开始、每次有效移动前压入的快照栈。
   * 存快照而不是动作日志：撤销只需出栈，不必重放整局，且存档本身就是完整局面。
   */
  readonly history: readonly Snapshot[]
}

export type Game2048Action =
  | { type: 'move'; dir: MoveDir }
  | { type: 'undo' }
  /**
   * 重开：壳层会话对每款游戏都固定派发 `{ type: 'restart' }`，
   * 因此规则层必须接受它，否则点「重新开始」只会弹「走不通」。
   */
  | { type: 'restart' }

export function emptyBoard(size: number): number[] {
  return new Array<number>(size * size).fill(0)
}

/** 合法格子值：0（空）或 2 的幂 */
export function isTileValue(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return false
  if (value === 0) return true
  return Number.isInteger(Math.log2(value))
}

/** 取某条滑动线上的第 offset 格；offset 0 是「方块贴向的那一端」 */
export function lineCellIndex(size: number, dir: MoveDir, line: number, offset: number): number {
  switch (dir) {
    case 'left':
      return line * size + offset
    case 'right':
      return line * size + (size - 1 - offset)
    case 'up':
      return offset * size + line
    case 'down':
      return (size - 1 - offset) * size + line
  }
}

export interface SlideOutcome {
  readonly values: number[]
  readonly gained: number
  readonly moved: boolean
}

/**
 * 单条线向 offset 0 方向压缩 + 合并。
 * 「同一次移动中同一块不能被合并两次」靠游标跳过被吃掉的那一格实现：
 * [2,2,2,2] → [4,4]，而不会连锁成 [8]。
 */
export function slideLine(values: readonly number[]): SlideOutcome {
  const packed: number[] = []
  for (const value of values) if (value !== 0) packed.push(value)
  const merged: number[] = []
  let gained = 0
  for (let index = 0; index < packed.length; index++) {
    const current = packed[index]!
    const next = index + 1 < packed.length ? packed[index + 1]! : undefined
    if (next !== undefined && next === current) {
      const sum = current * 2
      merged.push(sum)
      gained += sum
      index++ // 跳过被合并掉的那一格，避免连锁合并
    } else {
      merged.push(current)
    }
  }
  while (merged.length < values.length) merged.push(0)
  const moved = merged.some((value, index) => value !== values[index])
  return { values: merged, gained, moved }
}

export interface MoveOutcome {
  readonly board: number[]
  readonly gained: number
  readonly moved: boolean
}

/** 对整盘应用一次滑动；返回新盘（不改原盘）与本次得分 */
export function applyMove(board: readonly number[], size: number, dir: MoveDir): MoveOutcome {
  const next = board.slice()
  let gained = 0
  let moved = false
  for (let line = 0; line < size; line++) {
    const values: number[] = []
    for (let offset = 0; offset < size; offset++) {
      values.push(board[lineCellIndex(size, dir, line, offset)]!)
    }
    const outcome = slideLine(values)
    if (outcome.moved) moved = true
    gained += outcome.gained
    for (let offset = 0; offset < size; offset++) {
      next[lineCellIndex(size, dir, line, offset)] = outcome.values[offset]!
    }
  }
  return { board: next, gained, moved }
}

export interface SpawnOutcome {
  readonly board: readonly number[]
  readonly cursor: number
}

/**
 * 在随机空格里放一个新块：90% 是 2、10% 是 4。
 * 随机数取自 `mulberry32(seed + cursor)`：先抽空格下标、再抽数值，游标推进 2。
 * 满盘时无处可放（有效移动后不会出现），此时原样返回且游标不动，保持可复现。
 */
export function spawnTile(board: readonly number[], seed: number, cursor: number): SpawnOutcome {
  const empty: number[] = []
  for (let index = 0; index < board.length; index++) {
    if (board[index] === 0) empty.push(index)
  }
  if (empty.length === 0) return { board, cursor }
  const rng = createRng((seed + cursor) >>> 0)
  const slot = empty[rng.int(empty.length)]!
  const value = rng.next() < SPAWN_FOUR_RATE ? 4 : 2
  const next = board.slice()
  next[slot] = value
  return { board: next, cursor: cursor + DRAWS_PER_SPAWN }
}

/** 确定性初始状态：空盘 + 两块（两块也走同一套「seed + 游标」逻辑） */
export function createState(seed: number, difficultyId: string): Game2048State {
  const spec = difficultyOf(difficultyId)
  const normalized = seed >>> 0
  const first = spawnTile(emptyBoard(spec.size), normalized, 0)
  const second = spawnTile(first.board, normalized, first.cursor)
  return {
    difficulty: spec.id,
    seed: normalized,
    board: second.board,
    score: 0,
    moves: 0,
    cursor: second.cursor,
    history: [],
  }
}

function snapshotOf(state: Game2048State): Snapshot {
  return { board: state.board, score: state.score, moves: state.moves, cursor: state.cursor }
}

export function reduceState(state: Game2048State, action: Game2048Action): Game2048State {
  if (action.type === 'undo') {
    const previous = state.history[state.history.length - 1]
    if (!previous) throw new IllegalActionError(GAME_2048_ID, 'nothing to undo')
    return {
      difficulty: state.difficulty,
      seed: state.seed,
      board: previous.board,
      score: previous.score,
      moves: previous.moves,
      cursor: previous.cursor,
      history: state.history.slice(0, -1),
    }
  }
  if (action.type === 'restart') {
    // 重开回到同一 seed 的初始局面，并丢掉历史：重开后不能撤销回重开之前
    return createState(state.seed, state.difficulty)
  }
  if ((action as { type: string }).type !== 'move') {
    throw new IllegalActionError(GAME_2048_ID, 'unknown action')
  }
  const spec = difficultyOf(state.difficulty)
  const slid = applyMove(state.board, spec.size, action.dir)
  // 无任何变化 = 非法动作：契约要求「走不通要有明确反馈」，所以不能静默返回原状态
  if (!slid.moved) throw new IllegalActionError(GAME_2048_ID, `blocked ${action.dir}`)
  const spawned = spawnTile(slid.board, state.seed, state.cursor)
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: spawned.board,
    score: state.score + slid.gained,
    moves: state.moves + 1,
    cursor: spawned.cursor,
    history: [...state.history, snapshotOf(state)],
  }
}

export function legalActions(state: Game2048State): readonly Game2048Action[] {
  const spec = difficultyOf(state.difficulty)
  const actions: Game2048Action[] = []
  for (const dir of ALL_DIRS) {
    if (applyMove(state.board, spec.size, dir).moved) actions.push({ type: 'move', dir })
  }
  if (state.history.length > 0) actions.push({ type: 'undo' })
  if (state.moves > 0) actions.push({ type: 'restart' })
  return actions
}

export function isLegal(state: Game2048State, action: Game2048Action): boolean {
  try {
    reduceState(state, action)
    return true
  } catch (error) {
    if (error instanceof IllegalActionError) return false
    throw error
  }
}

export function canMove(state: Game2048State): boolean {
  const spec = difficultyOf(state.difficulty)
  return ALL_DIRS.some((dir) => applyMove(state.board, spec.size, dir).moved)
}

export function maxTile(state: Game2048State): number {
  let max = 0
  for (const value of state.board) if (value > max) max = value
  return max
}

/**
 * 胜负：出现目标值即 won；棋盘填满且四个方向都动不了即 lost。
 * 先判胜：达成目标的那一步即使同时填满棋盘，也应该算赢而不是输。
 */
export function statusOf(state: Game2048State): GameStatus {
  const spec = difficultyOf(state.difficulty)
  if (state.board.some((value) => value >= spec.target)) return 'won'
  if (state.board.every((value) => value !== 0) && !canMove(state)) return 'lost'
  return 'playing'
}

export interface EncodedSnapshot {
  board: number[]
  score: number
  moves: number
  cursor: number
}

export interface EncodedState {
  difficulty: string
  seed: number
  board: number[]
  score: number
  moves: number
  cursor: number
  history: EncodedSnapshot[]
}

/** 存档编码：只包含 JSON 可承载的原始值，且与 decodeState 严格往返一致 */
export function encodeState(state: Game2048State): EncodedState {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    score: state.score,
    moves: state.moves,
    cursor: state.cursor,
    history: state.history.map((snapshot) => ({
      board: [...snapshot.board],
      score: snapshot.score,
      moves: snapshot.moves,
      cursor: snapshot.cursor,
    })),
  }
}

function asCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new IllegalActionError(GAME_2048_ID, `bad ${field}`)
  }
  return value
}

function asBoard(value: unknown, size: number): number[] {
  if (!Array.isArray(value) || value.length !== size * size) {
    throw new IllegalActionError(GAME_2048_ID, 'bad board')
  }
  return value.map((cell, index) => {
    if (!isTileValue(cell)) throw new IllegalActionError(GAME_2048_ID, `bad tile at ${index}`)
    return cell
  })
}

/**
 * 存档解码：任何缺字段 / 类型不对 / 数值非法都抛 IllegalActionError，
 * 让壳层把「存档损坏」明确告诉用户，而不是带着半个局面继续玩。
 */
export function decodeState(raw: unknown): Game2048State {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IllegalActionError(GAME_2048_ID, 'bad state')
  }
  const value = raw as Partial<EncodedState>
  if (typeof value.difficulty !== 'string') throw new IllegalActionError(GAME_2048_ID, 'bad difficulty')
  const spec = difficultyOf(value.difficulty)
  const board = asBoard(value.board, spec.size)
  const seed = asCount(value.seed, 'seed')
  const score = asCount(value.score, 'score')
  const moves = asCount(value.moves, 'moves')
  const cursor = asCount(value.cursor, 'cursor')
  if (cursor % DRAWS_PER_SPAWN !== 0) throw new IllegalActionError(GAME_2048_ID, 'bad cursor')
  if (!Array.isArray(value.history)) throw new IllegalActionError(GAME_2048_ID, 'bad history')
  const rawHistory = value.history as unknown[]
  const history: Snapshot[] = rawHistory.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new IllegalActionError(GAME_2048_ID, 'bad history entry')
    }
    const snapshot = entry as Partial<EncodedSnapshot>
    return {
      board: asBoard(snapshot.board, spec.size),
      score: asCount(snapshot.score, 'history score'),
      moves: asCount(snapshot.moves, 'history moves'),
      cursor: asCount(snapshot.cursor, 'history cursor'),
    }
  })
  // 不变式：历史长度恒等于步数（每次有效移动 +1、撤销 -1、重开清零）。
  // 不满足说明存档被截断或篡改，宁可拒绝也不要让撤销栈错位。
  if (history.length !== moves) {
    throw new IllegalActionError(GAME_2048_ID, 'history does not match moves')
  }
  return { difficulty: spec.id, seed, board, score, moves, cursor, history }
}
