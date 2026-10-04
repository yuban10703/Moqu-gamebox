/**
 * 贪吃蛇规则层：纯函数、无副作用、无 DOM、**无定时器、零时间引用**。
 *
 * 关键设计取舍：
 *
 * 1. **慢速自动步进（tick），不是动画**。墨水屏（1-bit、无快刷）不能做连续运动，
 *    但"每按一次才走一格"在真机上被用户否掉了：本作改成**蛇按固定间隔自动前进一格**
 *    （间隔由玩法声明，见 meta.ts 的 tickMs，**三档统一 500ms**，硬下限 400ms）。
 *    规则层依然不引用时间：到点由壳层会话派发 `{ type: 'tick' }`，reduce 把它解释成
 *    「沿当前朝向前进一格」。因此状态里仍然没有时间、没有速度，只有「第几步」——
 *    同一 seed + 同一「玩家输入 + tick」序列，双端必然复现同一个局面。
 *
 * 2. **玩家输入是「转向并立即走一格」，不是「记下方向等下一次 tick」**。
 *    用户反馈原话：「延迟太高了……在我点击按钮后应该立即换向，而不是等固定延迟」。
 *    因此 `{ type: 'turn', dir }` 的语义是：**把朝向改成 dir，并当场沿 dir 前进一格**
 *    （与 `tick` 走的是同一条 step 路径，唯一差别是这条记录不带 `auto`）。
 *    - 点一下 = 走一格；连点 = 连走，节奏完全由玩家掌握（配合壳层「有效输入后重置计时」，
 *      连点之间不会被自动步进插队）；
 *    - 不点 = 按 `tickMs` 自动爬；
 *    - 按当前朝向也是「立即前进一格」：否则连点同一个方向会变成**把蛇按住不动**
 *      （每次输入都重置计时，蛇永远等不到 tick），那是个比吞输入更糟的缺陷；
 *    - `dir === 当前朝向的反向` 仍然非法（几何上会直接咬到脖子）：这是**唯一**被拒绝的
 *      方向输入，壳层按 illegalNoticeKey 给出明确文字提示。
 *    - 不再需要任何缓冲槽：单槽缓冲是为"一个 tick 内连按只取最后一个"设计的，
 *      而立即执行本身就是"按几次就走几格"，不存在丢输入（连点「上→左」= 先上一格再左一格）。
 *
 * 3. **随机性写成「种子 + 游标」**（与 2048 完全一致的写法）。食物位置来自
 *    `createRng((seed + cursor) >>> 0)`，游标记录已消耗的抽样次数；
 *    障碍同样是「种子 + 游标」的确定性产物，且**落在状态里**（decode 不会重新摆放）。
 *    因此同一 seed + 同一动作序列在双端得到完全相同的局面，规则层禁止 Math.random / Date.now。
 *
 * 4. **撤销存逆操作，不存整盘快照**。每一步只压入一条很小的记录：
 *    「这一刻掉了哪节尾 / 食物在哪 / 游标到哪 / 分数、待长节数、步数是多少」，
 *    撤销时把蛇头退回上一格、把掉掉的尾接回去即可精确还原。
 *    整盘快照（蛇身最长可到 144 格）在每走一步都要落盘的场景下会让存档膨胀几十倍。
 *
 * 5. **tick 不再是「一步」而是「一段」**：自动前进的每一步都会进撤销栈（否则无法精确回退），
 *    但被标记成 `auto`；**撤销会一次性退回玩家上一次操作之前**（先连续弹掉栈顶的自动步进，
 *    再弹掉一条玩家操作）。这样按一次撤销不会只退回半格 —— 那正是玩家最不想要的语义。
 *    自动步进会持续往栈里塞记录，因此撤销栈**封顶**（MAX_HISTORY_ENTRIES），
 *    裁剪时裁到一条玩家操作上，保证栈底永远落在「可撤销边界」。
 *
 * 6. **撞上去就是失败，不问这一步是谁让蛇走的**。原地掉头（几何上必咬脖子）是非法输入、
 *    不是自杀 —— 这一点与经典规则一致；但"朝某个方向走一格"这个动作本身，只要那一格是墙 /
 *    障碍 / 自己的身体，**无论来自自动步进还是玩家按键，都当场结束本局**。
 *    为什么不把玩家的致命按键"拒绝并提示"：那条路会让同一格出现两种结果
 *    （自己爬过去死、按过去不死），规则说明里无法自洽；而且拒绝之后蛇仍会按原朝向继续爬，
 *    大概率在下一个 tick 照旧撞死 —— 只是把死亡推迟几百毫秒。
 *    玩家按键走出来的那一步**不带 `auto`**，因此撞死之后「撤销」可以精确退回按键之前
 *    （壳层的结果面板就带这个按钮），误触并不会真的毁掉这一局。
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

/**
 * 撤销栈上限。
 *
 * 为什么必须封顶：自动步进每隔几百毫秒就往栈里压一条记录，不封顶的话存档会随**游玩时长**
 * 无限增长（每一步都要整份落盘）。封顶后仍保留最近 300 条 —— 按玩家的操作节奏算，
 * 大约相当于最近二十几次决策，够用；被裁掉的只是更早的撤销层级。
 */
export const MAX_HISTORY_ENTRIES = 300

export type SnakeAction =
  /**
   * 走一格（玩家输入）：把朝向改成 dir 并**立即**沿 dir 前进一格。
   *
   * - dir === 当前朝向 = 往前手动走一格（合法：连点同一个方向就是连续前进，
   *   不允许用它把蛇"按住不动"）；
   * - dir === 当前朝向的反向 = 非法（抛错，界面给文字提示），这是唯一被拒绝的方向输入；
   * - 这一格若撞墙 / 障碍 / 自己，本局**当场结束**（与自动步进同一条规则，见文件头第 6 条）。
   */
  | { type: 'turn'; dir: MoveDir }
  /** 自动前进一格（由壳层定时器到点派发）；方向 = 当前朝向 */
  | { type: 'tick' }
  /** 撤销到**玩家上一次操作之前**（自动步进会一并退回，见 undo） */
  | { type: 'undo' }
  /** 重开。壳层的重开按钮与 R 键会无条件派发它，因此规则层必须接受 */
  | { type: 'restart' }

/**
 * 一条撤销记录（逆操作）。
 *
 * · step：走了一格（`auto: true` = 自动步进走的，缺字段 = 玩家按键走的）。
 *   `tail` 是这一步掉掉的尾格（null = 这一步是「长身子」的步，没掉尾）；
 *   撤销 = 去掉蛇头、必要时把尾接回去，再把食物 / 游标 / 分数 / 待长节数 / 步数还原。
 * · turn：**只存在于老存档里**。旧语义下「转向」只写缓冲、不移动，因此记录里没有蛇身信息；
 *   新语义下转向本身就走一格（记成 step），所以新存档不会再产生这种记录。
 *   它在新语义下不改变任何局面，撤销/裁剪时一律跳过（见 isSkippedByUndo）。
 * · death：致命一步。蛇身**没有变化**（蛇头没有进入墙里），撤销只要把 dead 清掉。
 *
 * `auto` 只出现在自动步进产生的记录上（老存档没有该字段 = 玩家操作，语义正确）。
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
      readonly auto?: true
    }
  /** 老存档遗留：旧语义的「只转向不移动」记录（新存档不再产生） */
  | { readonly kind: 'turn'; readonly moves: number }
  | { readonly kind: 'death'; readonly moves: number; readonly auto?: true }

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
  /** 步数（含致命的一步）；自动前进与玩家按键走的每一步都算一步 */
  readonly moves: number
  /** 已消耗的随机数个数 */
  readonly cursor: number
  /** 本局是否已经撞墙 / 撞障碍 / 撞到自己 */
  readonly dead: boolean
  /**
   * 撤销栈（重开清空）。
   *
   * 注意：**状态里没有「待生效的方向」这种字段**。玩家按键立即执行，不需要缓冲；
   * 老存档里的 `pendingDir` 仍然能被 decode 接受，但只是兼容字段、不会被读进状态
   * （见 EncodedSnakeState.pendingDir 与 decodeState）。
   */
  readonly history: readonly SnakeUndoEntry[]
  /**
   * 撤销栈是否被裁剪过（超过 MAX_HISTORY_ENTRIES 时裁掉最旧的一段）。
   * 存进状态是为了让 decode 能区分两种情况：没裁剪过就必须满足
   * 「步数 = 栈里非转向记录的条数」这条强不变式，裁剪过才放宽成 ≤。
   */
  readonly trimmed: boolean
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
    trimmed: false,
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
 * 撤销栈封顶：裁掉最旧的一段，并且**裁到一条玩家操作上**。
 *
 * 为什么必须裁到玩家操作：撤销的语义是「退回上一次玩家操作之前」，
 * 栈底若落在一条自动步进上，最老的那次撤销就会变成「退回半格」——
 * 正是这条语义要避免的。老存档里的「转向缓冲」记录在新语义下不改变任何局面，
 * 同样不能当边界。没有玩家操作可依（整栈都是自动步进）时退回「保留最后 N 条」，
 * 此时本来也没有可撤销的玩家操作（canUndo 为假）。
 */
function pushEntry(history: readonly SnakeUndoEntry[], entry: SnakeUndoEntry): {
  history: SnakeUndoEntry[]
  trimmed: boolean
} {
  const next = [...history, entry]
  if (next.length <= MAX_HISTORY_ENTRIES) return { history: next, trimmed: false }
  let cut = next.length - MAX_HISTORY_ENTRIES
  while (cut < next.length && isSkippedByUndo(next[cut]!)) cut++
  if (cut >= next.length) cut = next.length - MAX_HISTORY_ENTRIES
  return { history: next.slice(cut), trimmed: true }
}

/** 这条撤销记录是不是自动步进（tick）产生的 */
export function isAutoEntry(entry: SnakeUndoEntry): boolean {
  return entry.kind !== 'turn' && entry.auto === true
}

/**
 * 撤销时应当**自动跳过**的记录 —— 它们都不是「玩家的一次操作」：
 * - 自动步进（`auto: true`，玩家没按任何东西）；
 * - 老存档里的「转向缓冲」记录（新语义下转向本身就走一格，这种记录不再改变任何局面，
 *   如果把它当成一次操作，按钮点下去会"什么都没发生"）。
 */
export function isSkippedByUndo(entry: SnakeUndoEntry): boolean {
  return isAutoEntry(entry) || entry.kind === 'turn'
}

/**
 * 有没有「玩家操作」可撤 —— 界面据此决定撤销按钮是否可点。
 *
 * 与老行为唯一的差别：开局一步都没走、只有自动前进时，撤销按钮不再无意义地亮着
 * （那时撤销只会把自动前进退掉，而玩家什么都没做过）。
 */
export function canUndo(state: SnakeState): boolean {
  return state.history.some((entry) => !isSkippedByUndo(entry))
}

function withEntry(state: SnakeState, entry: SnakeUndoEntry): SnakeState {
  const { history, trimmed } = pushEntry(state.history, entry)
  return { ...state, history, trimmed: state.trimmed || trimmed }
}

/**
 * 致命一步：蛇头不进入墙里（否则蛇身会出现越界下标），只标记 dead。
 * 撤销这一步不需要蛇身快照，因此记录极小（见 SnakeUndoEntry）。
 */
function die(state: SnakeState, auto: boolean): SnakeState {
  const entry: SnakeUndoEntry = {
    kind: 'death',
    moves: state.moves,
    ...(auto ? { auto: true as const } : {}),
  }
  return withEntry(
    { ...state, dead: true, moves: state.moves + 1 },
    entry,
  )
}

/**
 * 走一格（唯一的移动实现）。`auto` 只影响撤销记录上的标记：
 * - `auto: false` = 玩家按键走的一步（撤销时算一次"玩家操作"）；
 * - `auto: true` = 自动步进走的一步（撤销时会被跳过）。
 *
 * 除了这一个标记，两条路径的规则**完全相同**：
 * 原地掉头非法（抛错）、撞墙 / 撞障碍 / 撞自己当场结束、吃到食物一样长身子。
 */
function step(state: SnakeState, dir: MoveDir, auto: boolean): SnakeState {
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
  if (outside && !spec.wrap) return die(state, auto)
  const next = indexOf(spec.size, wrapCoord(rawX, spec.size), wrapCoord(rawY, spec.size))
  if (state.obstacles.includes(next)) return die(state, auto)

  // 这一步是否会「长身子」：会长则蛇尾不动，尾格仍占着
  const willGrow = state.pending > 0
  const occupied = willGrow ? state.body : state.body.slice(0, -1)
  if (occupied.includes(next)) return die(state, auto)

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
    ...(auto ? { auto: true as const } : {}),
  }
  const base = { ...state, body, pending, moves: state.moves + 1 }
  if (next !== state.food) {
    return withEntry(base, entry)
  }
  // 吃到食物：分数 = 吃到的数量；接下来的 growth 步不掉尾（蛇变长）
  const placed = placeFood(spec, body, state.obstacles, state.seed, state.cursor)
  return withEntry(
    {
      ...base,
      food: placed.food,
      cursor: placed.cursor,
      pending: pending + spec.growth,
      score: state.score + 1,
    },
    entry,
  )
}

/**
 * 玩家输入：改朝向并**当场**沿新方向走一格。
 *
 * 语义与 `tick` 完全一致（同一条 step），唯一差别是记录不带 `auto`：
 * - 点一次 = 走一格 → 点下去当帧棋盘就变（用户反馈的"等固定延迟"不再存在）；
 * - 连点两次不同方向 = 走两格（例如上→左：先上一格再左一格），不丢输入；
 * - 按当前朝向 = 手动前进一格（合法）；按反向 = 非法（抛错，界面提示）；
 * - 这一格会撞墙 / 障碍 / 自己时**当场结束**，且因为这一步算玩家操作，撤销可以退回。
 */
function turn(state: SnakeState, dir: MoveDir): SnakeState {
  return step(state, dir, false)
}

/** 自动前进一格：沿当前朝向（玩家按键会立即改变朝向，因此"想往哪走"不需要缓冲） */
function tick(state: SnakeState): SnakeState {
  return step(state, directionOf(state), true)
}

/** 单步撤销：把栈顶那一条逆操作还原（不判断它是玩家操作还是自动步进） */
function undoOne(state: SnakeState): SnakeState {
  const entry = state.history[state.history.length - 1]
  if (!entry) throw new IllegalActionError(SNAKE_ID, 'nothing to undo')
  const history = state.history.slice(0, -1)
  if (entry.kind === 'turn') {
    // 老存档遗留记录：旧语义下它只改缓冲方向，新语义下没有可还原的局面变化
    return { ...state, moves: entry.moves, history }
  }
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

/**
 * 撤销：**退回玩家上一次操作之前**。
 *
 * 自动步进也是状态变化（不记录就无法精确回退），但它不是玩家的操作 ——
 * 因此先把栈顶「玩家没做过的事」一次退干净（自动步进；老存档里的转向缓冲记录），
 * 再退掉一条玩家操作。若栈里只有自动步进（玩家还没操作过），退到栈空为止，不报错。
 *
 * 为什么不给每个 tick 单独留一次撤销：那样按一次撤销只退回半格，
 * 在墨水屏上（一次操作要等几百毫秒才有反馈）体验极差。
 */
function undo(state: SnakeState): SnakeState {
  /*
   * 撤销**不经过**「是否已结束」检查：撞死之后正是最需要撤销的时刻。
   * 没有可撤销的步骤时明确抛错（壳层给出文字提示），而不是静默返回原状态（那样按钮点了像坏了）。
   */
  if (state.history.length === 0) throw new IllegalActionError(SNAKE_ID, 'nothing to undo')
  let next = state
  while (next.history.length > 0 && isSkippedByUndo(next.history[next.history.length - 1]!)) {
    next = undoOne(next)
  }
  if (next.history.length > 0) next = undoOne(next)
  return next
}

export function reduceState(state: SnakeState, action: SnakeAction): SnakeState {
  switch (action.type) {
    case 'undo':
      return undo(state)
    case 'restart':
      // 重开回到同一 seed 的初始局面，并丢掉历史：重开后不能撤销回重开之前
      return createState(state.seed, state.difficulty)
    case 'turn':
      return turn(state, action.dir)
    case 'tick':
      return tick(state)
    default: {
      // 壳层还会派发 nextLevel / startLevel 之类：本作没有这些语义，按契约抛错
      const unknown = action as { type?: string }
      throw new IllegalActionError(SNAKE_ID, `unknown action ${String(unknown.type)}`)
    }
  }
}

/**
 * 当前局面下规则允许的动作（原地掉头不算，因为它会被拒绝）。
 *
 * 注意「允许」= 规则接受这个动作，**不代表走完不会死**：朝墙走一格是合法的，
 * 只是会结束本局（见文件头第 6 条）。legal() 的用途是"哪些动作可以派发"，
 * 因此这里不做生存性筛选 —— 否则界面与回放校验都要跟着学会预测未来。
 */
export function legalActions(state: SnakeState): readonly SnakeAction[] {
  const out: SnakeAction[] = []
  if (gameStatus(state) === 'playing') {
    const blocked = OPPOSITE_DIR[directionOf(state)]
    for (const dir of ALL_DIRS) if (dir !== blocked) out.push({ type: 'turn', dir })
    // tick 也是规则允许的动作（壳层到点派发；回放校验同样需要它）
    out.push({ type: 'tick' })
  }
  // 撤销在撞死之后仍然可用（那一步正是最想撤回的），因此放在状态判断之前
  if (canUndo(state)) out.push({ type: 'undo' })
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
  /**
   * 老存档遗留的「下一个 tick 生效的缓冲方向」。
   * 新语义下没有缓冲，这个字段**恒为 null**；保留它只是为了让老版本解码器
   * （规则版本仍是 1）读到新存档时看到的是"没有缓冲转向"，而不是一个缺失字段。
   */
  pendingDir?: MoveDir | null
  /** 只写 true：自动步进产生的记录（缺字段 = 玩家操作，老存档语义正确） */
  auto?: true
}

/** 老存档遗留：旧语义的「只转向不移动」记录（新存档不再产生，但必须能读） */
export interface EncodedSnakeTurn {
  kind: 'turn'
  pendingDir?: MoveDir | null
  moves: number
}

export interface EncodedSnakeDeath {
  kind: 'death'
  moves: number
  /** 同 EncodedSnakeStep.pendingDir：老字段，恒为 null */
  pendingDir?: MoveDir | null
  auto?: true
}

export type EncodedSnakeUndoEntry = EncodedSnakeStep | EncodedSnakeTurn | EncodedSnakeDeath

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
  /**
   * 老存档的「转向缓冲」字段：**解码时接受、忽略**（缺字段同样接受）。
   *
   * 为什么留着而不是删掉：规则版本仍是 1（本次只改了动作语义，没改存档结构），
   * 老存档带着这个字段、新存档写 null，两个方向的兼容都成立：
   * - 老存档 → 新版本：读到的是"没有待生效的转向"，照常开局（转向本身现在立即执行）；
   * - 新存档 → 老版本：老解码器读到 null = 没有缓冲，语义正确。
   * 注意校验仍然保留（值必须是四个方向或 null）：一个乱码值说明存档被改过，照样拒绝。
   */
  pendingDir?: MoveDir | null
  history: EncodedSnakeUndoEntry[]
  /** 缺字段 = 撤销栈没被裁剪过（老存档宽容） */
  trimmed?: boolean
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
    // 恒为 null：状态里已经没有缓冲方向了（见 EncodedSnakeState.pendingDir）
    pendingDir: null,
    history: state.history.map((entry): EncodedSnakeUndoEntry => {
      if (entry.kind === 'turn') {
        // 老存档遗留记录：原样写回（方向已经无意义，写 null）
        return { kind: 'turn', pendingDir: null, moves: entry.moves }
      }
      if (entry.kind === 'death') {
        return {
          kind: 'death',
          moves: entry.moves,
          pendingDir: null,
          ...(entry.auto ? { auto: true as const } : {}),
        }
      }
      return {
        kind: 'step',
        tail: entry.tail,
        food: entry.food,
        cursor: entry.cursor,
        score: entry.score,
        pending: entry.pending,
        moves: entry.moves,
        pendingDir: null,
        ...(entry.auto ? { auto: true as const } : {}),
      }
    }),
    // 没裁剪过时不写这个字段：存档形状与老版本一致（只在真正裁剪过时才多一个标记）
    ...(state.trimmed ? { trimmed: true } : {}),
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
  pendingDir?: unknown
  auto?: unknown
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
 * 老存档的缓冲方向字段：**只校验形状，不读进状态**（转向现在立即执行，没有"待生效"这回事）。
 *
 * - 缺字段 / null：照常接受（老存档本来就可能没有这个字段）；
 * - 四个方向之一：接受并忽略（老存档写的"下一个 tick 要转的方向"在新语义下无效，
 *   因为 tick 只沿当前朝向走）；
 * - 其它任何值：仍然拒绝 —— 一个乱码值说明存档被改过，不能当成"没有缓冲"放过去。
 */
function readLegacyPendingDir(value: unknown): null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !ALL_DIRS.includes(value as MoveDir)) {
    throw new IllegalActionError(SNAKE_ID, 'bad pendingDir')
  }
  return null
}

/** `auto` 缺字段 = 玩家操作（老存档里所有记录都是玩家操作，语义正确） */
function readAuto(value: unknown): true | undefined {
  if (value === undefined || value === false) return undefined
  if (value !== true) throw new IllegalActionError(SNAKE_ID, 'bad auto flag')
  return true
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
  return value.map((raw): SnakeUndoEntry => {
    if (!raw || typeof raw !== 'object') throw new IllegalActionError(SNAKE_ID, 'bad history entry')
    const entry = raw as RawUndoEntry
    const moves = readCount(entry.moves, 'history moves')
    if (entry.kind === 'turn') {
      // 老存档遗留：只保留 moves（旧语义下转向不移动，因此这条记录没有蛇身信息）
      readLegacyPendingDir(entry.pendingDir)
      return { kind: 'turn', moves }
    }
    if (entry.kind === 'death') {
      readLegacyPendingDir(entry.pendingDir)
      return {
        kind: 'death',
        moves,
        ...(readAuto(entry.auto) ? { auto: true as const } : {}),
      }
    }
    if (entry.kind !== 'step') throw new IllegalActionError(SNAKE_ID, 'bad history kind')
    const food = readIndex(entry.food, total, 'history food')
    if (obstacles.has(food)) throw new IllegalActionError(SNAKE_ID, 'history food on an obstacle')
    readLegacyPendingDir(entry.pendingDir)
    return {
      kind: 'step',
      tail: readOptionalIndex(entry.tail, total, 'history tail'),
      food,
      cursor: readCount(entry.cursor, 'history cursor'),
      score: readCount(entry.score, 'history score'),
      pending: readCount(entry.pending, 'history pending'),
      moves,
      ...(readAuto(entry.auto) ? { auto: true as const } : {}),
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
 * 3. 步数 = 撤销栈里**非转向**记录的条数（撤销栈被裁剪过时放宽成 ≤，见 trimmed）；
 * 4. dead 与撤销栈末条必须一致（撞死是最后一步，之后不可能再有动作）；
 * 5. 棋盘填满 ⇔ 食物为「没有食物」，两个方向都判。
 *
 * 老存档里的 `pendingDir` 仍然接受（只校验形状、不读进状态）：
 * 转向现在立即执行，没有"下一个 tick 生效的方向"这回事，因此不存在
 * "缓冲方向是掉头 → 下一个 tick 必撞脖子"这条老不变量了。
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
  // 老字段：校验形状但不读进状态（见 readLegacyPendingDir）
  readLegacyPendingDir(value.pendingDir)
  // 缺字段 = 没裁剪过（老存档宽容）；只有真的写了 true 才认
  if (value.trimmed !== undefined && value.trimmed !== true && value.trimmed !== false) {
    throw new IllegalActionError(SNAKE_ID, 'bad trimmed flag')
  }
  const trimmed = value.trimmed === true
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
    // 转向现在也走一格；只有老存档里那种「只转向不移动」的记录不计数
    const steps = history.filter((entry) => entry.kind !== 'turn').length
    if (trimmed ? steps > moves : steps !== moves) {
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
    trimmed,
  }
}
