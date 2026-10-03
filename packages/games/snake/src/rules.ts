/**
 * 贪吃蛇规则层：纯函数、无副作用、无 DOM、无定时器。
 *
 * 关键设计取舍：
 *
 * 1. **离散步进，不是动画**。墨水屏（1-bit、无快刷）不能做「每 200ms 自动走一格」的连续运动：
 *    本作里玩家每按一次方向按钮，蛇正好前进一格，画面立刻重画（与 2048 的离散步进同款）。
 *    因此状态里没有时间、没有速度，只有「第几步」。
 *
 * 2. **随机性写成「种子 + 游标」**（与 2048 完全一致的写法）。食物位置来自
 *    `createRng((seed + cursor) >>> 0)`，游标记录已消耗的抽样次数；
 *    障碍同样是「种子 + 游标」的确定性产物，且**落在状态里**（decode 不会重新摆放）。
 *    因此同一 seed + 同一动作序列在双端得到完全相同的局面，规则层禁止 Math.random / Date.now。
 *
 * 3. **撤销存逆操作，不存整盘快照**。每一步只压入一条很小的记录：
 *    「这一刻掉了哪节尾 / 食物在哪 / 游标到哪 / 分数、待长节数、步数是多少」，
 *    撤销时把蛇头退回上一格、把掉掉的尾接回去即可精确还原。
 *    整盘快照（蛇身最长可到 144 格）在每走一步都要落盘的场景下会让存档膨胀几十倍。
 *
 * 4. **原地掉头是非法输入，不是自杀**：蛇头会立刻撞上自己的脖子，经典规则里这种输入被忽略。
 *    壳层会按 illegalNoticeKey 给出明确文字提示（方向盘按钮保持可点，不会静默无响应）；
 *    真正撞到自己（撞到脖子以外的身体）仍然是失败，输掉之后也能撤销。
 */
import { IllegalActionError, createRng, type GameStatus, type MoveDir } from '@eink/core'
import {
  SNAKE_ID,
  difficultyOrThrow,
  difficultySpec,
  type DifficultyId,
  type SnakeDifficulty,
} from './meta.js'

/** 四个方向；顺序固定，保证 legal / controls 的输出稳定可断言 */
export const ALL_DIRS: readonly MoveDir[] = ['up', 'down', 'left', 'right']

export const OPPOSITE_DIR: Record<MoveDir, MoveDir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

export const DIR_DELTA: Record<MoveDir, { readonly dx: number; readonly dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

/** 初始蛇身长度 */
export const INITIAL_LENGTH = 3
/** 每放一个食物恰好消耗 1 个随机数 */
export const DRAWS_PER_FOOD = 1
/** 没有食物：棋盘已被蛇身与障碍填满，此时即胜利 */
export const NO_FOOD = -1

export type SnakeAction =
  /** 朝某方向前进一格（走不动/已结束/原地掉头都会抛 IllegalActionError） */
  | { type: 'move'; dir: MoveDir }
  /** 撤销上一步；没有可撤销的步骤时明确抛错 */
  | { type: 'undo' }
  /** 重开。壳层的重开按钮与 R 键会无条件派发它，因此规则层必须接受 */
  | { type: 'restart' }

/**
 * 一条撤销记录（逆操作）。
 *
 * · step：普通一步。`tail` 是这一步掉掉的尾格（null = 这一步是「长身子」的步，没掉尾）；
 *   撤销 = 去掉蛇头、必要时把尾接回去，再把食物 / 游标 / 分数 / 待长节数 / 步数还原。
 * · death：致命一步。蛇身**没有变化**（蛇头没有进入墙里），所以撤销只要把 dead 清掉。
 */
export type SnakeUndoEntry =
  | {
      readonly kind: 'step'
      readonly tail: number | null
      readonly food: number
      readonly cursor: number
      readonly score: number
      readonly pending: number
      readonly moves: number
    }
  | { readonly kind: 'death'; readonly moves: number }

export interface SnakeState {
  readonly difficulty: DifficultyId
  /** 食物与障碍的来源种子 */
  readonly seed: number
  /** 蛇身：头在 [0]，尾在末尾 */
  readonly body: readonly number[]
  /** 场内障碍（升序，永不变动） */
  readonly obstacles: readonly number[]
  /** 食物所在格；NO_FOOD 表示棋盘已满 */
  readonly food: number
  /** 还需长出的节数（吃食物时 +growth，每长一节 −1） */
  readonly pending: number
  /** 分数 = 吃到的食物数量 */
  readonly score: number
  /** 步数（含致命的一步）；恒等于 history.length */
  readonly moves: number
  /** 已消耗的随机数个数 */
  readonly cursor: number
  /** 本局是否已经撞墙 / 撞障碍 / 撞到自己 */
  readonly dead: boolean
  /** 撤销栈（重开清空） */
  readonly history: readonly SnakeUndoEntry[]
}

export interface Coords {
  readonly x: number
  readonly y: number
}

export function coordsOf(size: number, index: number): Coords {
  return { x: index % size, y: Math.floor(index / size) }
}

export function indexOf(size: number, x: number, y: number): number {
  return y * size + x
}

/** 取模到 [0, size)：穿墙档与「从脖子指向蛇头」的方向判定都要用 */
export function wrapCoord(value: number, size: number): number {
  return ((value % size) + size) % size
}

/** 从 from 格走到相邻的 to 格是哪个方向；两格不相邻即抛错（存档校验也会用到） */
export function directionBetween(size: number, from: number, to: number): MoveDir {
  const a = coordsOf(size, from)
  const b = coordsOf(size, to)
  const dx = wrapCoord(b.x - a.x, size)
  const dy = wrapCoord(b.y - a.y, size)
  if (dx === 1 && dy === 0) return 'right'
  if (dx === size - 1 && dy === 0) return 'left'
  if (dy === 1 && dx === 0) return 'down'
  if (dy === size - 1 && dx === 0) return 'up'
  throw new IllegalActionError(SNAKE_ID, `cells ${from} and ${to} are not adjacent`)
}

/** 当前朝向：由「脖子 → 蛇头」推出，因此不需要在状态里多存一个字段（也不会与蛇身不一致） */
export function directionOf(state: SnakeState): MoveDir {
  const spec = difficultySpec(state.difficulty)
  const head = state.body[0]
  const neck = state.body[1]
  if (head === undefined || neck === undefined) {
    throw new IllegalActionError(SNAKE_ID, 'body is too short to have a direction')
  }
  return directionBetween(spec.size, neck, head)
}

/** 初始蛇身：横放在棋盘中间一行，蛇头在正中、朝右 */
export function initialBody(size: number): number[] {
  const row = Math.floor(size / 2)
  const headX = Math.floor(size / 2)
  const body: number[] = []
  for (let offset = 0; offset < INITIAL_LENGTH; offset++) {
    body.push(indexOf(size, headX - offset, row))
  }
  return body
}

/** 障碍不得压在初始蛇身上，也不该紧贴蛇头正前方（否则开局第一步就必死） */
export function reservedCells(size: number): number[] {
  const body = initialBody(size)
  const head = coordsOf(size, body[0]!)
  return [...body, indexOf(size, head.x + 1, head.y)]
}

export interface ObstaclePlacement {
  readonly obstacles: number[]
  readonly cursor: number
}

/**
 * 确定性摆放障碍：每次抽样都从「当前还空着的格子」里取一个，
 * 第 n 次抽样固定用 `createRng((seed + n) >>> 0)` 的第一个输出。
 */
export function placeObstacles(
  spec: SnakeDifficulty,
  seed: number,
  reserved: readonly number[],
): ObstaclePlacement {
  const blocked = new Set(reserved)
  const obstacles: number[] = []
  let cursor = 0
  while (obstacles.length < spec.obstacles) {
    const free: number[] = []
    for (let index = 0; index < spec.size * spec.size; index++) {
      if (!blocked.has(index)) free.push(index)
    }
    // 棋盘远大于障碍数，理论上不会走到这里；真走到了也只放能放的，绝不死循环
    if (free.length === 0) break
    const pick = free[createRng((seed + cursor) >>> 0).int(free.length)]!
    blocked.add(pick)
    obstacles.push(pick)
    cursor += 1
  }
  return { obstacles: obstacles.sort((a, b) => a - b), cursor }
}

export interface FoodPlacement {
  readonly food: number
  readonly cursor: number
}

/**
 * 把食物放到一个空格里。**游标总是前进**（即使已经没有空格），
 * 这样「游标 = 障碍消耗 + 初始食物 + 已吃数量」就是一条可校验的不变量，
 * 撤销时把游标还原即可保证「重新吃同一个食物会得到同一个新食物」。
 */
export function placeFood(
  spec: SnakeDifficulty,
  body: readonly number[],
  obstacles: readonly number[],
  seed: number,
  cursor: number,
): FoodPlacement {
  const occupied = new Set<number>([...body, ...obstacles])
  const free: number[] = []
  for (let index = 0; index < spec.size * spec.size; index++) {
    if (!occupied.has(index)) free.push(index)
  }
  if (free.length === 0) return { food: NO_FOOD, cursor: cursor + DRAWS_PER_FOOD }
  const pick = free[createRng((seed + cursor) >>> 0).int(free.length)]!
  return { food: pick, cursor: cursor + DRAWS_PER_FOOD }
}

/** 确定性初始局面：中间一段蛇身 + 按 seed 摆好的障碍 + 按 seed 放好的第一个食物 */
export function createState(seed: number, difficultyId: DifficultyId): SnakeState {
  const spec = difficultySpec(difficultyId)
  const normalized = seed >>> 0
  const body = initialBody(spec.size)
  const placement = placeObstacles(spec, normalized, reservedCells(spec.size))
  const placed = placeFood(spec, body, placement.obstacles, normalized, placement.cursor)
  return {
    difficulty: spec.id,
    seed: normalized,
    body,
    obstacles: placement.obstacles,
    food: placed.food,
    pending: 0,
    score: 0,
    moves: 0,
    cursor: placed.cursor,
    dead: false,
    history: [],
  }
}

/** 还空着的格子数（蛇身与障碍之外） */
export function freeCellCount(state: SnakeState): number {
  const spec = difficultySpec(state.difficulty)
  return spec.size * spec.size - state.obstacles.length - state.body.length
}

/** 胜负：先把棋盘填满即胜；撞墙/撞障碍/撞自己即负（先判负，撞死的那一刻不可能同时填满） */
export function gameStatus(state: SnakeState): GameStatus {
  if (state.dead) return 'lost'
  return freeCellCount(state) === 0 ? 'won' : 'playing'
}

/**
 * 致命一步：蛇头不进入墙里（否则蛇身会出现越界下标），只标记 dead。
 * 撤销这一步不需要蛇身快照，因此记录极小（见 SnakeUndoEntry）。
 */
function die(state: SnakeState): SnakeState {
  return {
    ...state,
    dead: true,
    moves: state.moves + 1,
    history: [...state.history, { kind: 'death', moves: state.moves }],
  }
}

function step(state: SnakeState, dir: MoveDir): SnakeState {
  const spec = difficultySpec(state.difficulty)
  if (gameStatus(state) !== 'playing') {
    throw new IllegalActionError(SNAKE_ID, 'game already finished')
  }
  const head = state.body[0]
  const neck = state.body[1]
  if (head === undefined || neck === undefined) {
    throw new IllegalActionError(SNAKE_ID, 'body is too short')
  }
  // 原地掉头：蛇头会立刻撞上脖子。这是非法输入而不是失败，与经典贪吃蛇一致
  if (dir === OPPOSITE_DIR[directionBetween(spec.size, neck, head)]) {
    throw new IllegalActionError(SNAKE_ID, `cannot reverse into ${dir}`)
  }

  const from = coordsOf(spec.size, head)
  const delta = DIR_DELTA[dir]
  const rawX = from.x + delta.dx
  const rawY = from.y + delta.dy
  const outside = rawX < 0 || rawY < 0 || rawX >= spec.size || rawY >= spec.size
  if (outside && !spec.wrap) return die(state)
  const next = indexOf(spec.size, wrapCoord(rawX, spec.size), wrapCoord(rawY, spec.size))
  if (state.obstacles.includes(next)) return die(state)

  // 这一步是否会「长身子」：会长则蛇尾不动，尾格仍占着
  const willGrow = state.pending > 0
  const occupied = willGrow ? state.body : state.body.slice(0, -1)
  if (occupied.includes(next)) return die(state)

  const tail = willGrow ? null : state.body[state.body.length - 1]!
  const body = willGrow ? [next, ...state.body] : [next, ...state.body.slice(0, -1)]
  const pending = willGrow ? state.pending - 1 : state.pending
  const entry: SnakeUndoEntry = {
    kind: 'step',
    tail,
    food: state.food,
    cursor: state.cursor,
    score: state.score,
    pending: state.pending,
    moves: state.moves,
  }
  if (next !== state.food) {
    return { ...state, body, pending, moves: state.moves + 1, history: [...state.history, entry] }
  }
  // 吃到食物：分数 = 吃到的数量；接下来的 growth 步不掉尾（蛇变长）
  const placed = placeFood(spec, body, state.obstacles, state.seed, state.cursor)
  return {
    ...state,
    body,
    food: placed.food,
    cursor: placed.cursor,
    pending: pending + spec.growth,
    score: state.score + 1,
    moves: state.moves + 1,
    history: [...state.history, entry],
  }
}

function undo(state: SnakeState): SnakeState {
  /*
   * 撤销**不经过**「是否已结束」检查：撞死之后正是最需要撤销的时刻。
   * 没有可撤销的步骤时明确抛错（壳层给出文字提示），而不是静默返回原状态（那样按钮点了像坏了）。
   */
  const entry = state.history[state.history.length - 1]
  if (!entry) throw new IllegalActionError(SNAKE_ID, 'nothing to undo')
  const history = state.history.slice(0, -1)
  if (entry.kind === 'death') {
    return { ...state, dead: false, moves: entry.moves, history }
  }
  // body[1] 就是旧蛇头，因此「去掉蛇头」= slice(1)；这一步若掉过尾，再把它接回去
  const body =
    entry.tail === null ? state.body.slice(1) : [...state.body.slice(1), entry.tail]
  return {
    ...state,
    body,
    food: entry.food,
    cursor: entry.cursor,
    score: entry.score,
    pending: entry.pending,
    moves: entry.moves,
    dead: false,
    history,
  }
}

export function reduceState(state: SnakeState, action: SnakeAction): SnakeState {
  switch (action.type) {
    case 'undo':
      return undo(state)
    case 'restart':
      // 重开回到同一 seed 的初始局面，并丢掉历史：重开后不能撤销回重开之前
      return createState(state.seed, state.difficulty)
    case 'move':
      return step(state, action.dir)
    default: {
      // 壳层还会派发 nextLevel / startLevel 之类：本作没有这些语义，按契约抛错
      const unknown = action as { type?: string }
      throw new IllegalActionError(SNAKE_ID, `unknown action ${String(unknown.type)}`)
    }
  }
}

/** 当前局面下规则允许的动作（原地掉头不算，因为它会被拒绝） */
export function legalActions(state: SnakeState): readonly SnakeAction[] {
  const out: SnakeAction[] = []
  if (gameStatus(state) === 'playing') {
    const blocked = OPPOSITE_DIR[directionOf(state)]
    for (const dir of ALL_DIRS) if (dir !== blocked) out.push({ type: 'move', dir })
  }
  // 撤销在撞死之后仍然可用（那一步正是最想撤回的），因此放在状态判断之前
  if (state.history.length > 0) out.push({ type: 'undo' })
  if (state.moves > 0 || state.history.length > 0) out.push({ type: 'restart' })
  return out
}

export function isLegal(state: SnakeState, action: SnakeAction): boolean {
  try {
    reduceState(state, action)
    return true
  } catch (error) {
    if (error instanceof IllegalActionError) return false
    throw error
  }
}

export interface EncodedSnakeStep {
  kind: 'step'
  tail: number | null
  food: number
  cursor: number
  score: number
  pending: number
  moves: number
}

export interface EncodedSnakeDeath {
  kind: 'death'
  moves: number
}

export type EncodedSnakeUndoEntry = EncodedSnakeStep | EncodedSnakeDeath

export interface EncodedSnakeState {
  difficulty: string
  seed: number
  body: number[]
  obstacles: number[]
  food: number
  pending: number
  score: number
  moves: number
  cursor: number
  dead: boolean
  history: EncodedSnakeUndoEntry[]
}

/** 存档编码：只包含 JSON 可承载的原始值，且与 decodeState 严格往返一致 */
export function encodeState(state: SnakeState): EncodedSnakeState {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    body: [...state.body],
    obstacles: [...state.obstacles],
    food: state.food,
    pending: state.pending,
    score: state.score,
    moves: state.moves,
    cursor: state.cursor,
    dead: state.dead,
    history: state.history.map((entry) =>
      entry.kind === 'death'
        ? { kind: 'death' as const, moves: entry.moves }
        : {
            kind: 'step' as const,
            tail: entry.tail,
            food: entry.food,
            cursor: entry.cursor,
            score: entry.score,
            pending: entry.pending,
            moves: entry.moves,
          },
    ),
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new IllegalActionError(SNAKE_ID, `bad ${field}`)
  }
  return value
}

function readSeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new IllegalActionError(SNAKE_ID, 'bad seed')
  }
  return value
}

function readBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new IllegalActionError(SNAKE_ID, `bad ${field}`)
  return value
}

/** 蛇身：长度、取值范围、互不重复，并且必须是一条连续路径（含穿墙相邻） */
function readBody(value: unknown, size: number): number[] {
  const total = size * size
  if (!Array.isArray(value)) throw new IllegalActionError(SNAKE_ID, 'bad body')
  if (value.length < INITIAL_LENGTH) throw new IllegalActionError(SNAKE_ID, 'body too short')
  if (value.length > total) throw new IllegalActionError(SNAKE_ID, 'body too long')
  const seen = new Set<number>()
  const body = value.map((cell) => {
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= total) {
      throw new IllegalActionError(SNAKE_ID, 'bad cell in body')
    }
    if (seen.has(cell)) throw new IllegalActionError(SNAKE_ID, 'duplicate cell in body')
    seen.add(cell)
    return cell
  })
  for (let index = 1; index < body.length; index++) {
    // 不相邻（directionBetween 抛错）说明蛇身被改过：拒绝，而不是让规则层后面莫名崩掉
    directionBetween(size, body[index]!, body[index - 1]!)
  }
  return body
}

/** 障碍：严格升序 + 取值范围 + 数量与难度一致 */
function readObstacles(value: unknown, size: number, expected: number): number[] {
  const total = size * size
  if (!Array.isArray(value)) throw new IllegalActionError(SNAKE_ID, 'bad obstacles')
  if (value.length !== expected) throw new IllegalActionError(SNAKE_ID, 'obstacle count mismatch')
  let previous = -1
  return value.map((cell) => {
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell >= total) {
      throw new IllegalActionError(SNAKE_ID, 'bad obstacle cell')
    }
    if (cell <= previous) throw new IllegalActionError(SNAKE_ID, 'obstacles must be sorted')
    previous = cell
    return cell
  })
}

function readFood(value: unknown, size: number, body: ReadonlySet<number>, obstacles: ReadonlySet<number>): number {
  const total = size * size
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IllegalActionError(SNAKE_ID, 'bad food')
  }
  if (value === NO_FOOD) return NO_FOOD
  if (value < 0 || value >= total) throw new IllegalActionError(SNAKE_ID, 'food out of range')
  if (body.has(value) || obstacles.has(value)) {
    throw new IllegalActionError(SNAKE_ID, 'food overlaps the snake or an obstacle')
  }
  return value
}

/** 撤销栈条目在解码时的原始形状：每个字段都当成 unknown 单独校验 */
interface RawUndoEntry {
  kind?: unknown
  tail?: unknown
  food?: unknown
  cursor?: unknown
  score?: unknown
  pending?: unknown
  moves?: unknown
}

function readIndex(value: unknown, total: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= total) {
    throw new IllegalActionError(SNAKE_ID, `bad ${field}`)
  }
  return value
}

function readOptionalIndex(value: unknown, total: number, field: string): number | null {
  if (value === null || value === undefined) return null
  return readIndex(value, total, field)
}

/**
 * 撤销栈的校验。
 *
 * `undefined` / `null` 视为空栈：撤销栈是后加的字段，**缺字段的存档必须继续能读**，
 * 否则玩家已有的进度会被判成「存档损坏」。有该字段时逐条严格校验。
 */
function readHistory(value: unknown, size: number, obstacles: ReadonlySet<number>): SnakeUndoEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new IllegalActionError(SNAKE_ID, 'bad history')
  const total = size * size
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new IllegalActionError(SNAKE_ID, 'bad history entry')
    const entry = raw as RawUndoEntry
    const moves = readCount(entry.moves, 'history moves')
    if (entry.kind === 'death') return { kind: 'death', moves }
    if (entry.kind !== 'step') throw new IllegalActionError(SNAKE_ID, 'bad history kind')
    const food = readIndex(entry.food, total, 'history food')
    if (obstacles.has(food)) throw new IllegalActionError(SNAKE_ID, 'history food on an obstacle')
    return {
      kind: 'step',
      tail: readOptionalIndex(entry.tail, total, 'history tail'),
      food,
      cursor: readCount(entry.cursor, 'history cursor'),
      score: readCount(entry.score, 'history score'),
      pending: readCount(entry.pending, 'history pending'),
      moves,
    }
  })
}

/**
 * 存档解码：任何缺字段 / 类型不对 / 数值非法都抛 IllegalActionError，
 * 让壳层把「存档损坏」明确告诉用户，而不是带着半个局面继续玩。
 *
 * 除字段校验外还复核五条不变量（它们同时保证撤销栈与状态一致）：
 * 1. 蛇长 = 初始长度 + 分数 × 每食增长 − 尚待长出的节数；
 * 2. 游标 = 障碍消耗 + 初始食物 + 每吃一个食物 1 次抽样；
 * 3. 步数 = 撤销栈长度（历史缺失时不判，见 readHistory）；
 * 4. dead 与撤销栈末条必须一致（撞死是最后一步，之后不可能再有动作）；
 * 5. 棋盘填满 ⇔ 食物为「没有食物」，两个方向都判。
 */
export function decodeState(raw: unknown): SnakeState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IllegalActionError(SNAKE_ID, 'bad state')
  }
  const value = raw as Partial<EncodedSnakeState>
  if (typeof value.difficulty !== 'string') throw new IllegalActionError(SNAKE_ID, 'bad difficulty')
  const difficulty = difficultyOrThrow(value.difficulty)
  const spec = difficultySpec(difficulty)

  const seed = readSeed(value.seed)
  const body = readBody(value.body, spec.size)
  const obstacles = readObstacles(value.obstacles, spec.size, spec.obstacles)
  const obstacleSet = new Set(obstacles)
  const bodySet = new Set(body)
  if (obstacles.some((cell) => bodySet.has(cell))) {
    throw new IllegalActionError(SNAKE_ID, 'obstacle overlaps the snake')
  }
  const food = readFood(value.food, spec.size, bodySet, obstacleSet)
  const pending = readCount(value.pending, 'pending')
  const score = readCount(value.score, 'score')
  const moves = readCount(value.moves, 'moves')
  const cursor = readCount(value.cursor, 'cursor')
  const dead = readBool(value.dead, 'dead')
  const history = readHistory(value.history, spec.size, obstacleSet)

  if (body.length !== INITIAL_LENGTH + score * spec.growth - pending) {
    throw new IllegalActionError(SNAKE_ID, 'body length disagrees with score and pending')
  }
  if (cursor !== obstacles.length + DRAWS_PER_FOOD * (1 + score)) {
    throw new IllegalActionError(SNAKE_ID, 'cursor disagrees with score')
  }
  const full = body.length + obstacles.length === spec.size * spec.size
  // 棋盘填满 ⇔ 没有食物。两个方向都要判：既拒绝「满了还留着食物」，也拒绝「没满却没有食物」
  if (full !== (food === NO_FOOD)) {
    throw new IllegalActionError(SNAKE_ID, 'food disagrees with free cells')
  }
  const historyPresent = value.history !== undefined && value.history !== null
  if (historyPresent) {
    if (history.length !== moves) {
      throw new IllegalActionError(SNAKE_ID, 'history does not match moves')
    }
    const last = history[history.length - 1]
    if (dead !== (last?.kind === 'death')) {
      throw new IllegalActionError(SNAKE_ID, 'dead disagrees with the last undo entry')
    }
  }

  return {
    difficulty: spec.id,
    seed,
    body,
    obstacles,
    food,
    pending,
    score,
    moves,
    cursor,
    dead,
    history,
  }
}
