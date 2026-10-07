/**
 * 俄罗斯方块规则层：纯函数、无副作用、无 DOM、**无定时器、零时间引用**。
 *
 * 四条硬约束（墨水屏 + 可复现存档）：
 *
 * 1. **规则层里没有重力定时器，只有 `tick` 这个动作**。间隔由难度声明（见 DIFFICULTIES.tickMs），
 *    到点由**壳层会话**派发 `{ type: 'tick' }`，reduce 把它解释成「自动下落一格」——
 *    和玩家按「落」走的是同一条 `stepDown`：落不动了就固化。因此规则层里没有
 *    setInterval/Date.now，存档在任何时刻都能原样恢复。
 *    「落到底不会立刻固化」是明确行为：方块停在堆上之后，**下一个 tick 才固化**，
 *    这一个间隔就是墨水屏上的「锁定缓冲」，玩家还有整整一格的时间平移/旋转（有测试守住）。
 * 2. **出块顺序只由 seed 决定**：7-bag（每袋 7 种形状各一次，袋内顺序洗牌），
 *    第 k 袋用 `createRng(seed + k*7)` 这条独立随机流。状态里只存「已出块数 cursor」，
 *    于是任意时刻都能算出当前块与下一块，且同一 seed + 同一操作序列双端必然一致。
 *    规则层禁止 Math.random（守卫脚本会扫描）。
 * 3. **撤销用逆操作，不存整盘快照**。棋盘 180 格、每步都存一份会把存档撑大：
 *    - 平移/旋转/下落一格 → 只记「上一步的方块位置」（4 个数字）；
 *    - 固化（含消行）→ 记 `{上一块位置, 出块游标, 分数, 消行数, 已固化块数, 被消掉的行号}`，
 *      棋盘本身由「把整行插回去 + 抹掉这一块自己」逆推出来（见 undoTetris）。
 * 4. **自动下落不占撤销层级**：tick 产生的记录标成 `auto`，撤销会先连续弹掉它们，
 *    再弹掉一条玩家操作 —— 按一次撤销退回「你上一次操作之前」，而不是半格。
 *    自动下落会持续往栈里塞记录，因此撤销栈封顶（MAX_HISTORY_ENTRIES），裁剪时裁到玩家操作上。
 */

import { IllegalActionError, createRng, type GameStatus, type MoveDir } from '@eink/core'
import {
  ALL_PIECES,
  boxOf,
  cellsOf,
  isPieceId,
  isRotation,
  nextRotation,
  type PieceId,
  type Rotation,
} from './pieces.js'

export const GAME_TETRIS_ID = 'tetris'

/** 棋盘格：0 空、1 已固定 */
export const CELL_EMPTY = 0
export const CELL_FILLED = 1

/** 7-bag：每袋恰好含 7 种形状各一次 */
export const PIECES_PER_BAG = ALL_PIECES.length

/** 消 1/2/3/4 行的基准分（再乘以等级） */
export const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800]

/** 一次固化最多能消掉的行数（同时填满 4 行的极限情况） */
export const MAX_LINE_CLEAR = 4

/**
 * 消行「定格」一拍的时长（毫秒）—— 这一拍里满行**先不消失**，整盘反色，下一拍才真正消掉。
 *
 * 为什么是固定 500ms 而不是跟难度走：它不是难度旋钮，而是**面板的物理时间**。
 * 真机实测一次整屏刷新约 500ms（docs/refresh-adaptation.md），所以定格正好等于一帧 ——
 * 短于它，反色那一帧还没画完就被下一帧覆盖，看上去只是脏了一下。
 * 上限也由壳层保证：任何 tickMs 都会被钳到 ≥ MIN_TICK_MS（400ms）。
 */
export const CLEAR_HOLD_MS = 500

/**
 * 消行定格：满行**先留一拍**再消失。
 *
 * 为什么要有这一拍（而不是直接消掉）：
 * 墨水屏做不出消行动画（面板约 2 次全屏刷新/秒，逐帧动画只会变成跳变加残影），
 * 能做的只有「离散状态之间的对比度」和「这个状态停多久」。于是：
 *   固化 → 【满行还在 + 整盘反色】停一拍 → 行消失、分数跳、下一块落下。
 * 这一拍不花任何额外的重绘：它就是一个 tick，壳层本来就要派发。
 *
 * 这一拍里的状态口径（三条不变式都保持不变，存档才能继续用同一套校验）：
 *   - 棋盘 = 已并进方块的棋盘（满行还在），当前块 = **刚固化那一块**（已并入棋盘、不再听指挥）；
 *   - `cursor` 与 `pieces` 都还没加 —— 所以 `cursor === pieces + 1` 与
 *     `piece.id === pieceAt(seed, cursor-1)` 依旧成立（这两个不变式是存档校验的核心）；
 *   - 分数与消行数也还没加：它们和满行一起在定格结束的那一刻跳。
 */
export interface PendingClear {
  /** 要消掉的行号（升序） */
  readonly rows: readonly number[]
  /** 定格结束时应加的分（消掉的那一刻才计入 score） */
  readonly points: number
  /**
   * 定格分两拍（用户要求「消的那几行反色，然后出文字」）：
   *   `flash` → 这几行**反色**（黑格变白条、留粗描边），还没写字；
   *   `label` → 文字出现在这条带上（左「消行」右分数）；
   * 再下一个 tick 才真正消掉（`commitClear`）。
   * 两拍都用 CLEAR_HOLD_MS —— 一格就是面板的一次刷新，短了会看到没画完的半帧。
   */
  readonly phase: 'flash' | 'label'
}

/** 每消这么多行升一级 */
export const LINES_PER_LEVEL = 10

/**
 * 旋转失败时的左右微调顺序（0 = 原地，再向两侧各让一格、两格）。
 * 只是为了让贴墙/贴堆时「转得动」，不是 SRS 踢墙表：不做上下微调，规则更好预期。
 */
export const ROTATE_KICKS: readonly number[] = [0, -1, 1, -2, 2]

/** 四个方向：顺序固定，保证 legal / controls 输出稳定可断言 */
export const ALL_DIRS: readonly MoveDir[] = ['up', 'down', 'left', 'right']

export type DifficultyId = 'starter' | 'skilled' | 'challenging'

export interface DifficultyTetris {
  readonly id: DifficultyId
  readonly cols: number
  readonly rows: number
  /** 开局预先堆在底部的垃圾行数（每行留一个洞，洞的位置由 seed 决定） */
  readonly garbageRows: number
  /**
   * 自动下落的间隔（毫秒/格）。
   *
   * 依据（真机实测数据，不是拍的）：
   * - BOOX 面板能完成的整屏刷新约 **2 次/秒**（≈500ms/次，docs/refresh-adaptation.md），
   *   低于 ~400ms 的重绘在墨水屏上只会看到跳变与残影（docs/eink-guidelines.md 定的硬下限）；
   * - 俄罗斯方块比贪吃蛇更需要「看清落点再决定」，而且每次操作都可能要连按几下
   *   （平移 + 旋转），因此三档都比贪吃蛇的对应档更慢一档：
   *   入门 1050ms（≈500ms 刷新 + 550ms 决策）、熟练 800ms、挑战 600ms。
   * - 想更快可以用「落」手动软降：**玩家操作即时生效**，自动下落只负责兜底节奏。
   */
  readonly tickMs: number
}

/**
 * 难度改**开局条件 + 自动下落速度**，不改规则：
 * - 入门：10×18 井（最深，回旋余量最大）、无初始堆叠、自动下落 1050ms/格；
 * - 熟练：10×16 井（更浅，可周转的余量更小）、800ms/格；
 * - 挑战：10×16 井，底部先堆 4 行垃圾（每行一个洞）—— 开局就得先挖洞，600ms/格。
 *
 * 尺寸是反推出来的，不是拍的。竖屏 439×847 下棋盘可用区最紧一档约 **415×420**
 * （真机实测表见 docs/handover.md 第 8 节；同一个口径也写在 games-contract.test.ts 里），
 * 格子 = min(可用宽/列数, 可用高/行数) —— 高度是瓶颈：
 *   10×18 → (420-10)/18 ≈ 22.8px；10×16 → ≈ 25.6px；再高一档 10×19 就只剩 21.6px（低于可读线）。
 * 所以列数固定 10、行数上限 18，难度差异改由「井深 + 初始堆叠 + 下落速度」承担。
 */
export const DIFFICULTIES: readonly DifficultyTetris[] = [
  { id: 'starter', cols: 10, rows: 18, garbageRows: 0, tickMs: 1050 },
  { id: 'skilled', cols: 10, rows: 16, garbageRows: 0, tickMs: 800 },
  { id: 'challenging', cols: 10, rows: 16, garbageRows: 4, tickMs: 600 },
]

export const DIFFICULTY_IDS: readonly DifficultyId[] = DIFFICULTIES.map((spec) => spec.id)

/** 未知难度一律拒绝（存档损坏 / 版本不兼容都要有明确反馈） */
export function difficultyOf(id: string): DifficultyTetris {
  const spec = DIFFICULTIES.find((entry) => entry.id === id)
  if (!spec) throw new IllegalActionError(GAME_TETRIS_ID, `unknown difficulty ${id}`)
  return spec
}

/** 当前块：位置用「方框左上角」的行列表示，格子 = 方框内偏移 + 左上角 */
export interface ActivePiece {
  readonly id: PieceId
  readonly row: number
  readonly col: number
  readonly rot: Rotation
}

export interface Cell {
  readonly row: number
  readonly col: number
}

/**
 * 撤销栈的一格。
 * - `piece`：平移/旋转/下落一格之前的位置，撤销 = 把方块放回去；
 * - `lock`：固化 + 消行之前的一切（棋盘由逆操作推回，不存整盘）。
 *
 * `auto` 只出现在自动下落（tick）产生的记录上；**撤销会跳过它们**，
 * 直到弹掉一条玩家操作，见 undoTetris。
 */
export type HistoryEntry =
  | { readonly kind: 'piece'; readonly piece: ActivePiece; readonly auto?: true }
  | {
      readonly kind: 'lock'
      readonly piece: ActivePiece
      readonly cursor: number
      readonly score: number
      readonly lines: number
      readonly pieces: number
      /** 本次固化后消掉的整行行号（升序） */
      readonly cleared: readonly number[]
      readonly auto?: true
    }

/**
 * 撤销栈上限：自动下落每隔几百毫秒就往栈里压一条记录，不封顶的话存档会随游玩时长无限增长。
 * 300 条大约相当于最近十几块方块的完整操作，够用；被裁掉的只是更早的撤销层级。
 */
export const MAX_HISTORY_ENTRIES = 300

export interface TetrisState {
  readonly difficulty: DifficultyId
  readonly seed: number
  /** 行优先、长度 cols*rows，元素是 CELL_EMPTY / CELL_FILLED */
  readonly board: readonly number[]
  /** 当前正在操作的方块（永远存在；放不下时局面即失败） */
  readonly piece: ActivePiece
  /** 已出块数：当前块序号 = cursor-1，下一块序号 = cursor */
  readonly cursor: number
  readonly score: number
  readonly lines: number
  /** 已固化的块数（结果面板与战绩里的「步数」口径） */
  readonly pieces: number
  /** 消行定格（见 PendingClear）：null = 没有待消的行 */
  readonly clearing: PendingClear | null
  readonly history: readonly HistoryEntry[]
}

export type TetrisAction =
  /**
   * 方向盘语义：left/right 平移一格、up 顺时针旋转、
   * **down = 直接落到底**（用户要求）；已经到底时按它＝固化，见 hardDrop
   */
  | { type: 'move'; dir: MoveDir }
  /** 自动下落一格（由壳层定时器到点派发）；着地则固化 —— 自动下落仍是一格一格走 */
  | { type: 'tick' }
  /** 撤销到**玩家上一次操作之前**（自动落下的格子会一并退回，见 undoTetris） */
  | { type: 'undo' }
  /** 重开：回到同一 seed 的初始局面（丢历史） */
  | { type: 'restart' }

export function emptyBoard(cols: number, rows: number): number[] {
  return new Array<number>(cols * rows).fill(CELL_EMPTY)
}

export function cellIndex(cols: number, row: number, col: number): number {
  return row * cols + col
}

/** 方块占用的棋盘坐标 */
export function pieceCells(piece: ActivePiece): Cell[] {
  return cellsOf(piece.id, piece.rot).map(([row, col]) => ({ row: piece.row + row, col: piece.col + col }))
}

/**
 * 方块能否放在这里：4 个格子都在棋盘内且都是空的。
 * 注意「忽略方块自身」在俄罗斯方块里不需要 —— 每步都会先把新位置算出来再判定，
 * 而方块始终只有一个位置。
 */
export function fits(board: readonly number[], spec: DifficultyTetris, piece: ActivePiece): boolean {
  return pieceCells(piece).every((cell) => {
    if (cell.row < 0 || cell.row >= spec.rows) return false
    if (cell.col < 0 || cell.col >= spec.cols) return false
    return board[cellIndex(spec.cols, cell.row, cell.col)] === CELL_EMPTY
  })
}

/** 出生位置：方块在井口居中，方框左上角行号 0 */
export function spawnPiece(id: PieceId, cols: number): ActivePiece {
  return { id, row: 0, col: Math.floor((cols - boxOf(id)) / 2), rot: 0 }
}

/** 由 seed 与盐值派生一条随机流（只用 core 的确定性随机源，禁止 Math.random） */
function mixSeed(seed: number, salt: number): number {
  return (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0
}

/**
 * 第 bagIndex 袋的出块顺序：7 种形状的一次洗牌。
 * 每袋一条独立随机流 `createRng(seed + 袋号 × 7)`，与 2048「seed + 游标」同一套做法：
 * 只需要存游标就能复算，且不会因为多存一个 Rng 实例而无法序列化。
 */
export function bagAt(seed: number, bagIndex: number): PieceId[] {
  const rng = createRng((seed + bagIndex * PIECES_PER_BAG) >>> 0)
  return rng.shuffle([...ALL_PIECES])
}

/** 出块序列是纯函数：第 index 块（0 起）由 (seed, index) 唯一决定 */
export function pieceAt(seed: number, index: number): PieceId {
  const bag = bagAt(seed, Math.floor(index / PIECES_PER_BAG))
  return bag[index % PIECES_PER_BAG]!
}

/** 下一块（结果里不展示形状，但规则层把它作为纯函数暴露，便于测试与将来的「预览」） */
export function nextPieceId(state: TetrisState): PieceId {
  return pieceAt(state.seed, state.cursor)
}

/** 垃圾行第 index 行（0 = 最底那行）的洞在第几列：由 seed 决定，可复算 */
export function garbageHole(seed: number, index: number, cols: number): number {
  return createRng(mixSeed(seed, index + 1)).int(cols)
}

export function levelOf(lines: number): number {
  return 1 + Math.floor(lines / LINES_PER_LEVEL)
}

/** 消行得分 = 基准分 × 等级（等级取**消行前**的等级，与经典口径一致） */
export function scoreForLines(cleared: number, level: number): number {
  return (LINE_SCORES[cleared] ?? 0) * level
}

/** 确定性初始局面：底部垃圾行 + 井口第一块 */
export function createState(seed: number, difficultyId: string): TetrisState {
  const spec = difficultyOf(difficultyId)
  const normalized = seed >>> 0
  const board = emptyBoard(spec.cols, spec.rows)
  for (let index = 0; index < spec.garbageRows; index++) {
    const row = spec.rows - 1 - index
    const hole = garbageHole(normalized, index, spec.cols)
    for (let col = 0; col < spec.cols; col++) {
      if (col !== hole) board[cellIndex(spec.cols, row, col)] = CELL_FILLED
    }
  }
  return {
    difficulty: spec.id,
    seed: normalized,
    board,
    piece: spawnPiece(pieceAt(normalized, 0), spec.cols),
    cursor: 1,
    score: 0,
    lines: 0,
    pieces: 0,
    clearing: null,
    history: [],
  }
}

/**
 * 胜负：只有「堆到顶部」这一种结束方式 —— 新块在井口放不下即失败。
 * 本玩法**没有胜利条件**，所以 status 不会返回 'won'（不编造一个「消满 N 行算赢」的目标）。
 * 其余动作都被碰撞检查挡住，因此方块「放不下」只可能发生在出块瞬间。
 *
 * 例外：消行定格那一拍（`clearing` 非空）里，刚固化的方块已经并进棋盘了，
 * 按 `fits` 判会立刻误报失败 —— 这一拍固定报 playing。
 */
export function statusOf(state: TetrisState): GameStatus {
  if (state.clearing) return 'playing'
  return fits(state.board, difficultyOf(state.difficulty), state.piece) ? 'playing' : 'lost'
}

/** 这条撤销记录是不是自动下落（tick）产生的 */
export function isAutoEntry(entry: HistoryEntry): boolean {
  return entry.auto === true
}

/**
 * 有没有「玩家操作」可撤 —— 界面据此决定撤销按钮是否可点。
 * 自动下落不算玩家操作：刚进对局、一步没走时撤销按钮不该亮着。
 */
export function canUndo(state: TetrisState): boolean {
  return state.history.some((entry) => !isAutoEntry(entry))
}

function fullRows(board: readonly number[], spec: DifficultyTetris): number[] {
  const rows: number[] = []
  for (let row = 0; row < spec.rows; row++) {
    let full = true
    for (let col = 0; col < spec.cols; col++) {
      if (board[cellIndex(spec.cols, row, col)] === CELL_EMPTY) {
        full = false
        break
      }
    }
    if (full) rows.push(row)
  }
  return rows
}

/** 消行：被消掉的行下面的行原地不动，上面的行整体下移，顶部补空行 */
function clearRows(board: readonly number[], spec: DifficultyTetris, cleared: readonly number[]): number[] {
  const keep: number[] = []
  for (let row = 0; row < spec.rows; row++) {
    if (cleared.includes(row)) continue
    for (let col = 0; col < spec.cols; col++) keep.push(board[cellIndex(spec.cols, row, col)]!)
  }
  const out = emptyBoard(spec.cols, spec.rows)
  const offset = cleared.length * spec.cols
  for (let index = 0; index < keep.length; index++) out[offset + index] = keep[index]!
  return out
}

/**
 * clearRows 的逆：把被消掉的整行插回去。
 *
 * 不变式：消行后**顶部恰好有 k 个空行**（k = 消掉的行数），
 * 因此「没被消掉的行」就是 `board.slice(k*cols)` 的按序排列；
 * 再按行号走一遍，遇到被消掉的行号就填一整行，否则从那份排列里取下一行。
 */
function restoreRows(board: readonly number[], spec: DifficultyTetris, cleared: readonly number[]): number[] {
  const kept = board.slice(cleared.length * spec.cols)
  const out = emptyBoard(spec.cols, spec.rows)
  let taken = 0
  for (let row = 0; row < spec.rows; row++) {
    const wasCleared = cleared.includes(row)
    for (let col = 0; col < spec.cols; col++) {
      out[cellIndex(spec.cols, row, col)] = wasCleared
        ? CELL_FILLED
        : (kept[taken * spec.cols + col] ?? CELL_EMPTY)
    }
    if (!wasCleared) taken++
  }
  return out
}

/**
 * 压入一条撤销记录，并在超限时裁剪最旧的一段；裁到一条**玩家操作**上，
 * 保证栈底落在「可撤销边界」（否则最老的那次撤销会变成退回半格）。
 * 整栈都是自动下落时退回「保留最后 N 条」—— 那时本来也没有可撤销的玩家操作。
 */
function withEntry(state: TetrisState, entry: HistoryEntry): TetrisState {
  const history = [...state.history, entry]
  if (history.length <= MAX_HISTORY_ENTRIES) return { ...state, history }
  let cut = history.length - MAX_HISTORY_ENTRIES
  while (cut < history.length && isAutoEntry(history[cut]!)) cut++
  if (cut >= history.length) cut = history.length - MAX_HISTORY_ENTRIES
  return { ...state, history: history.slice(cut) }
}

function shiftPiece(
  state: TetrisState,
  spec: DifficultyTetris,
  dir: 'left' | 'right',
): TetrisState {
  const moved: ActivePiece = { ...state.piece, col: state.piece.col + (dir === 'left' ? -1 : 1) }
  if (!fits(state.board, spec, moved)) {
    throw new IllegalActionError(GAME_TETRIS_ID, `blocked ${dir}`)
  }
  return { ...withEntry(state, { kind: 'piece', piece: state.piece }), piece: moved }
}

function cellKeys(piece: ActivePiece): string {
  return pieceCells(piece)
    .map((cell) => `${cell.row},${cell.col}`)
    .sort()
    .join(' ')
}

/**
 * 顺时针旋转；原地转不下时依次左右微调。
 * O 块旋转前后占的格子完全相同 —— 当作非法动作（否则会往撤销栈里塞一步「什么都没变」），
 * 由会话给出「这一步走不通」的文字反馈。
 */
function rotatePiece(state: TetrisState, spec: DifficultyTetris): TetrisState {
  const rot = nextRotation(state.piece.rot)
  const before = cellKeys(state.piece)
  for (const dc of ROTATE_KICKS) {
    const candidate: ActivePiece = { ...state.piece, rot, col: state.piece.col + dc }
    if (!fits(state.board, spec, candidate)) continue
    if (cellKeys(candidate) === before) break
    return { ...withEntry(state, { kind: 'piece', piece: state.piece }), piece: candidate }
  }
  throw new IllegalActionError(GAME_TETRIS_ID, 'rotate blocked')
}

/**
 * 「落」＝**直接落到底**（用户要求）。
 *
 * 与自动下落（`tick` → stepDown）的分工：
 *  - 自动下落仍是一格一格走，落到堆上后**当帧不固化** —— 那一格间隔是墨水屏上的锁定缓冲；
 *  - 玩家按「落」是把当前方块直接送到最下面能放的位置，**只占一层撤销**
 *    （若按一格一层记录，撤销一次硬降要按十几次，实际等于不能撤销）。
 * 已经到底时按「落」＝固化并出下一块，与改动前一致。
 */
function hardDrop(state: TetrisState, spec: DifficultyTetris): TetrisState {
  let row = state.piece.row
  while (fits(state.board, spec, { ...state.piece, row: row + 1 })) row++
  if (row === state.piece.row) return lockPiece(state, spec)
  return {
    // 只记一条：撤销一次就回到按「落」之前的位置
    ...withEntry(state, { kind: 'piece', piece: state.piece }),
    piece: { ...state.piece, row },
  }
}

/**
 * 下落一格；已经落到底（或压在堆上）就固化并出下一块。
 *
 * `auto` 标记这条记录来自自动下落：**落到底不会当帧固化** —— 停在堆上的那一格
 * 由下一个 tick 固化，这一个间隔就是墨水屏上的锁定缓冲（玩家还能平移/旋转）。
 */
function stepDown(state: TetrisState, spec: DifficultyTetris, auto = false): TetrisState {
  const down: ActivePiece = { ...state.piece, row: state.piece.row + 1 }
  if (fits(state.board, spec, down)) {
    return {
      ...withEntry(state, { kind: 'piece', piece: state.piece, ...(auto ? { auto: true as const } : {}) }),
      piece: down,
    }
  }
  return lockPiece(state, spec, auto)
}

function lockPiece(state: TetrisState, spec: DifficultyTetris, auto = false): TetrisState {
  const merged = state.board.slice()
  for (const cell of pieceCells(state.piece)) {
    merged[cellIndex(spec.cols, cell.row, cell.col)] = CELL_FILLED
  }
  const cleared = fullRows(merged, spec)
  const entry: HistoryEntry = {
    kind: 'lock',
    piece: state.piece,
    cursor: state.cursor,
    score: state.score,
    lines: state.lines,
    pieces: state.pieces,
    cleared,
    ...(auto ? { auto: true as const } : {}),
  }
  const next = withEntry(state, entry)
  // 没填满任何一行：照旧立刻出下一块（`piece` 保持刚固化那一块的位置，见下面注释）
  if (cleared.length === 0) {
    return {
      ...next,
      board: merged,
      // 下一块：cursor 指向的那一块；放不下就是失败局面（status 会报 lost）
      piece: spawnPiece(pieceAt(state.seed, state.cursor), spec.cols),
      cursor: state.cursor + 1,
      pieces: state.pieces + 1,
    }
  }
  /*
   * 填满了：进入「消行定格」一拍（见 PendingClear）。
   * 注意这里**只并盘、不消行、不加分、不出下一块、不动 cursor/pieces**：
   * 这一拍里当前块仍是刚固化那一块（它已经在棋盘里了，不再听指挥），
   * 于是 `cursor === pieces + 1` 与 `piece.id === pieceAt(seed, cursor-1)` 两条存档不变式原样成立。
   * 消行、加分、出下一块全部推迟到下一个 tick（commitClear）。
   */
  return {
    ...next,
    board: merged,
    clearing: { rows: cleared, points: scoreForLines(cleared.length, levelOf(state.lines)), phase: 'flash' },
  }
}

/**
 * 定格到点：先走完两拍（反色 → 出文字），第二拍结束时才真正消行。
 *
 * 「反色 → 出文字」分两拍而不是一拍做齐：1-bit 上一帧只能有一个状态，
 * 两件事挤在同一帧里就只剩"一下子全变了"，没有节奏（这正是用户看过真机后的要求）。
 */
function advanceClear(state: TetrisState, spec: DifficultyTetris): TetrisState {
  const pending = state.clearing
  if (!pending) return state
  if (pending.phase === 'flash') return { ...state, clearing: { ...pending, phase: 'label' } }
  return commitClear(state, spec)
}

/**
 * 定格结束：真正消行 + 加分 + 出下一块。
 *
 * 由**下一个 tick** 触发（间隔见 CLEAR_HOLD_MS），因此不引入任何时间引用；
 * 也**不压撤销记录** —— 这一整段（固化 + 消行）在撤销栈里就是固化那一条，
 * 按一次撤销直接回到「方块还没落下来」之前，不会出现"退一半"。
 */
function commitClear(state: TetrisState, spec: DifficultyTetris): TetrisState {
  const pending = state.clearing
  if (!pending) return state
  return {
    ...state,
    board: clearRows(state.board, spec, pending.rows),
    piece: spawnPiece(pieceAt(state.seed, state.cursor), spec.cols),
    cursor: state.cursor + 1,
    score: state.score + pending.points,
    lines: state.lines + pending.rows.length,
    pieces: state.pieces + 1,
    clearing: null,
  }
}

/**
 * 单步撤销：把栈顶那一条逆操作还原 —— 棋盘、当前块、出块游标、分数、消行、已固化块数
 * 全部回到动作之前。用逆操作而不是快照：一步最多只有 4 个格子 + 4 个计数。
 */
function undoOne(state: TetrisState, spec: DifficultyTetris): TetrisState {
  const entry = state.history[state.history.length - 1]
  if (!entry) throw new IllegalActionError(GAME_TETRIS_ID, 'nothing to undo')
  const history = state.history.slice(0, -1)
  if (entry.kind === 'piece') {
    return { ...state, piece: entry.piece, history }
  }
  /*
   * 逆序：先把被消掉的整行插回去（还原出「刚固化、还没消行」的棋盘），
   * 再抹掉这一块自己占的格子 —— 固化前那些格子本来就是空的。
   *
   * 例外：**消行定格那一拍里撤销**。这时棋盘是"已并盘、满行还在"的样子
   * （行还没被消掉），再插一次行就会多出一整行。判据是 `state.clearing` 非空 ——
   * 定格期间除了 tick 没有别的动作能压栈，所以栈顶那条 lock 记录一定就是它。
   */
  const board = state.clearing ? state.board.slice() : restoreRows(state.board, spec, entry.cleared)
  for (const cell of pieceCells(entry.piece)) {
    board[cellIndex(spec.cols, cell.row, cell.col)] = CELL_EMPTY
  }
  return {
    ...state,
    board,
    piece: entry.piece,
    cursor: entry.cursor,
    score: entry.score,
    lines: entry.lines,
    pieces: entry.pieces,
    clearing: null,
    history,
  }
}

/**
 * 撤销：**退回玩家上一次操作之前**。
 *
 * 自动下落（tick）也是状态变化（不记录就无法精确回退），但它不是玩家的操作 ——
 * 因此先把栈顶连续的自动下落一次退干净，再退掉一条玩家操作。
 * 若栈里只有自动下落（玩家还没操作过），退到栈空为止，不报错。
 *
 * 为什么不给每个 tick 单独留一次撤销：那样按一次撤销只退回半格，
 * 在墨水屏上（一次操作要等几百毫秒才有反馈）体验极差。
 */
export function undoTetris(state: TetrisState, spec: DifficultyTetris = difficultyOf(state.difficulty)): TetrisState {
  if (state.history.length === 0) throw new IllegalActionError(GAME_TETRIS_ID, 'nothing to undo')
  let next = state
  while (next.history.length > 0 && isAutoEntry(next.history[next.history.length - 1]!)) {
    next = undoOne(next, spec)
  }
  if (next.history.length > 0) next = undoOne(next, spec)
  return next
}

export function reduceState(state: TetrisState, action: TetrisAction): TetrisState {
  const spec = difficultyOf(state.difficulty)

  if (action.type === 'undo') return undoTetris(state, spec)
  // 重开：回到同一 seed 的初始局面，并丢掉历史（重开后不能撤销回重开之前）。
  // 壳层的「重新开始」在无关卡玩法上走的是重新开局（换 seed），这里保留 restart 是为了
  // 契约完整：会话对每款游戏都会派发它。
  if (action.type === 'restart') return createState(state.seed, state.difficulty)
  if (action.type !== 'move' && action.type !== 'tick') {
    throw new IllegalActionError(GAME_TETRIS_ID, 'unknown action')
  }

  // 已经堆到顶：除撤销/重开外一律拒绝（结果面板上的撤销按钮仍然可用，见 undoTetris）
  if (statusOf(state) !== 'playing') throw new IllegalActionError(GAME_TETRIS_ID, 'game over')

  // 消行定格那一拍：到点的 tick 用来**结清**这一拍，然后才继续下落
  if (action.type === 'tick') return state.clearing ? advanceClear(state, spec) : stepDown(state, spec, true)

  /*
   * 定格期间不接受移动/旋转/落：方块已经并进棋盘、下一块还没出，
   * 这时任何方向都没有意义。**明确抛错**而不是静默返回原状态 ——
   * 静默会让玩家觉得"按了没反应"（规范 5：输入被接受就必须产生状态变化；
   * 拒绝的输入由会话统一给出「走不通」的文字反馈）。
   */
  if (state.clearing) throw new IllegalActionError(GAME_TETRIS_ID, 'clearing')

  if (action.dir === 'left' || action.dir === 'right') return shiftPiece(state, spec, action.dir)
  if (action.dir === 'up') return rotatePiece(state, spec)
  return hardDrop(state, spec)
}

export function legalActions(state: TetrisState): readonly TetrisAction[] {
  const actions: TetrisAction[] = []
  if (statusOf(state) === 'playing') {
    for (const dir of ALL_DIRS) {
      if (isLegal(state, { type: 'move', dir })) actions.push({ type: 'move', dir })
    }
    // tick 也是规则允许的动作（壳层到点派发；回放校验同样需要它）
    actions.push({ type: 'tick' })
  }
  if (canUndo(state)) actions.push({ type: 'undo' })
  if (state.pieces > 0 || state.lines > 0 || canUndo(state)) actions.push({ type: 'restart' })
  return actions
}

export function isLegal(state: TetrisState, action: TetrisAction): boolean {
  try {
    reduceState(state, action)
    return true
  } catch (error) {
    if (error instanceof IllegalActionError) return false
    throw error
  }
}

export interface EncodedPiece {
  id: string
  row: number
  col: number
  rot: number
}

export type EncodedHistoryEntry =
  | { kind: 'piece'; piece: EncodedPiece; auto?: true }
  | {
      kind: 'lock'
      piece: EncodedPiece
      cursor: number
      score: number
      lines: number
      pieces: number
      cleared: number[]
      /** 只写 true：这条记录来自自动下落（缺字段 = 玩家操作，老存档语义正确） */
      auto?: true
    }

export interface EncodedState {
  difficulty: string
  seed: number
  board: number[]
  piece: EncodedPiece
  cursor: number
  score: number
  lines: number
  pieces: number
  /** 消行定格（缺字段 = 没有待消的行；老存档因此天然兼容） */
  clearing?: { rows: number[]; points: number; phase?: 'flash' | 'label' }
  history: EncodedHistoryEntry[]
}

function encodePiece(piece: ActivePiece): EncodedPiece {
  return { id: piece.id, row: piece.row, col: piece.col, rot: piece.rot }
}

/** 存档编码：只包含 JSON 可承载的原始值，且与 decodeState 严格往返一致 */
export function encodeState(state: TetrisState): EncodedState {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board: [...state.board],
    piece: encodePiece(state.piece),
    cursor: state.cursor,
    score: state.score,
    lines: state.lines,
    pieces: state.pieces,
    ...(state.clearing ? { clearing: { rows: [...state.clearing.rows], points: state.clearing.points, phase: state.clearing.phase } } : {}),
    history: state.history.map((entry): EncodedHistoryEntry => {
      if (entry.kind === 'piece') {
        return {
          kind: 'piece',
          piece: encodePiece(entry.piece),
          ...(entry.auto ? { auto: true as const } : {}),
        }
      }
      return {
        kind: 'lock',
        piece: encodePiece(entry.piece),
        cursor: entry.cursor,
        score: entry.score,
        lines: entry.lines,
        pieces: entry.pieces,
        cleared: [...entry.cleared],
        ...(entry.auto ? { auto: true as const } : {}),
      }
    }),
  }
}

function asCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new IllegalActionError(GAME_TETRIS_ID, `bad ${field}`)
  }
  return value
}

function asInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IllegalActionError(GAME_TETRIS_ID, `bad ${field}`)
  }
  return value
}

/**
 * 方块校验：只要求**4 个格子**落在棋盘内 —— 方框本身可以探出井口（例如竖直的 I 贴在
 * 最左列时方框左上角是 -2），这是方块旋转的几何事实，不是损坏。
 * 注意**允许与已固定的格子重叠**：那正是「堆到顶部」的失败局面。
 */
function asPiece(value: unknown, spec: DifficultyTetris): ActivePiece {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad piece')
  }
  const raw = value as Partial<EncodedPiece>
  if (!isPieceId(raw.id)) throw new IllegalActionError(GAME_TETRIS_ID, 'bad piece id')
  if (!isRotation(raw.rot)) throw new IllegalActionError(GAME_TETRIS_ID, 'bad piece rotation')
  const piece: ActivePiece = {
    id: raw.id,
    row: asInt(raw.row, 'piece row'),
    col: asInt(raw.col, 'piece col'),
    rot: raw.rot,
  }
  for (const cell of pieceCells(piece)) {
    if (cell.row < 0 || cell.row >= spec.rows || cell.col < 0 || cell.col >= spec.cols) {
      throw new IllegalActionError(GAME_TETRIS_ID, 'piece outside board')
    }
  }
  return piece
}

function asBoard(value: unknown, spec: DifficultyTetris): number[] {
  if (!Array.isArray(value) || value.length !== spec.cols * spec.rows) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad board')
  }
  return value.map((cell, index) => {
    if (cell !== CELL_EMPTY && cell !== CELL_FILLED) {
      throw new IllegalActionError(GAME_TETRIS_ID, `bad cell at ${index}`)
    }
    return cell
  })
}

/**
 * 撤销栈的一格。
 * 老存档没有 `history` 字段：按**空栈**处理而不是判损坏（见 decodeState）。
 * 但字段存在却写坏时必须抛错 —— 半个撤销栈比没有撤销栈更糟。
 */
function asHistoryEntry(value: unknown, spec: DifficultyTetris): HistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad history entry')
  }
  const raw = value as {
    kind?: unknown
    piece?: unknown
    cursor?: unknown
    score?: unknown
    lines?: unknown
    pieces?: unknown
    cleared?: unknown
    auto?: unknown
  }
  if (raw.kind !== 'piece' && raw.kind !== 'lock') {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad history kind')
  }
  // `auto` 只认 true / 缺字段：老存档里所有记录都是玩家操作，语义正确
  if (raw.auto !== undefined && raw.auto !== true && raw.auto !== false) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad auto flag')
  }
  const auto = raw.auto === true ? ({ auto: true } as const) : {}
  const piece = asPiece(raw.piece, spec)
  if (raw.kind === 'piece') return { kind: 'piece', piece, ...auto }
  const clearedRaw = raw.cleared
  if (!Array.isArray(clearedRaw) || clearedRaw.length > MAX_LINE_CLEAR) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad cleared rows')
  }
  const cleared: number[] = []
  for (const item of clearedRaw) {
    const row = asCount(item, 'cleared row')
    if (row >= spec.rows) throw new IllegalActionError(GAME_TETRIS_ID, 'cleared row outside board')
    if (cleared.includes(row)) throw new IllegalActionError(GAME_TETRIS_ID, 'duplicate cleared row')
    cleared.push(row)
  }
  cleared.sort((a, b) => a - b)
  return {
    kind: 'lock',
    piece,
    cursor: asCount(raw.cursor, 'history cursor'),
    score: asCount(raw.score, 'history score'),
    lines: asCount(raw.lines, 'history lines'),
    pieces: asCount(raw.pieces, 'history pieces'),
    cleared,
    ...auto,
  }
}

/**
 * 消行定格字段的校验。
 *
 * 这里能查的比"类型对不对"多得多，而且都是**结构性**的（不依赖计分公式，改分数表不会误伤老存档）：
 *   - 行号在盘内、升序、不重复、不超过一次能消的上限；
 *   - 这些行在棋盘上**确实是满的**（定格的定义就是"满行还没消失"）；
 *   - 当前块**确实已经并进棋盘**（定格那一拍里方块已经固化）。
 * 少了这几条，一个坏存档能让玩家在"定格"里看到半盘不存在的行。
 */
function asClearing(value: unknown, spec: DifficultyTetris, board: readonly number[], piece: ActivePiece): PendingClear | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad clearing')
  }
  const raw = value as { rows?: unknown; points?: unknown; phase?: unknown }
  const rowsRaw = raw.rows
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0 || rowsRaw.length > MAX_LINE_CLEAR) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad clearing rows')
  }
  const rows: number[] = []
  for (const item of rowsRaw) {
    const row = asCount(item, 'clearing row')
    if (row >= spec.rows) throw new IllegalActionError(GAME_TETRIS_ID, 'clearing row outside board')
    if (rows.includes(row)) throw new IllegalActionError(GAME_TETRIS_ID, 'duplicate clearing row')
    rows.push(row)
  }
  rows.sort((a, b) => a - b)
  for (const row of rows) {
    for (let col = 0; col < spec.cols; col++) {
      if (board[cellIndex(spec.cols, row, col)] !== CELL_FILLED) {
        throw new IllegalActionError(GAME_TETRIS_ID, 'clearing row is not full')
      }
    }
  }
  for (const cell of pieceCells(piece)) {
    if (board[cellIndex(spec.cols, cell.row, cell.col)] !== CELL_FILLED) {
      throw new IllegalActionError(GAME_TETRIS_ID, 'clearing piece is not merged')
    }
  }
  // 相位缺字段按 'flash' 处理：上一版（还没分两拍）写下的存档仍然能读
  const phase = raw.phase === undefined ? 'flash' : raw.phase
  if (phase !== 'flash' && phase !== 'label') {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad clearing phase')
  }
  return { rows, points: asCount(raw.points, 'clearing points'), phase }
}

/**
 * 存档解码：任何缺字段 / 类型不对 / 数值非法都抛 IllegalActionError，
 * 让壳层把「存档损坏」明确告诉用户，而不是带着半个局面继续玩。
 *
 * 唯一的例外是 `history` 缺失 —— 那按空撤销栈处理（老存档不判损坏）；
 * `clearing` 缺失同理（老存档里没有消行定格，按 null 处理）。
 */
export function decodeState(raw: unknown): TetrisState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad state')
  }
  const value = raw as Partial<EncodedState>
  if (typeof value.difficulty !== 'string') throw new IllegalActionError(GAME_TETRIS_ID, 'bad difficulty')
  const spec = difficultyOf(value.difficulty)
  const seed = asCount(value.seed, 'seed')
  const cursor = asCount(value.cursor, 'cursor')
  if (cursor < 1) throw new IllegalActionError(GAME_TETRIS_ID, 'cursor must start at 1')
  const pieces = asCount(value.pieces, 'pieces')
  // 不变式：每固化一块正好出新一块，所以「已出块数 = 已固化块数 + 1」。
  // 不满足说明存档被截断或篡改，宁可拒绝也不要让撤销栈错位。
  // （消行定格那一拍两者都还没加，因此这条在定格中同样成立 —— 见 PendingClear。）
  if (cursor !== pieces + 1) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'cursor does not match locked pieces')
  }
  const board = asBoard(value.board, spec)
  const piece = asPiece(value.piece, spec)
  // 不变式：当前块必须等于出块序列里 cursor-1 那一块。
  // 这同时校验了 seed 与 cursor：篡改任意一个都会在这里被拦住。
  if (piece.id !== pieceAt(seed, cursor - 1)) {
    throw new IllegalActionError(GAME_TETRIS_ID, 'piece does not match seed sequence')
  }
  const rawHistory = value.history
  let history: HistoryEntry[] = []
  if (rawHistory !== undefined) {
    if (!Array.isArray(rawHistory)) throw new IllegalActionError(GAME_TETRIS_ID, 'bad history')
    history = rawHistory.map((entry) => asHistoryEntry(entry, spec))
  }
  return {
    difficulty: spec.id,
    seed,
    board,
    piece,
    cursor,
    score: asCount(value.score, 'score'),
    lines: asCount(value.lines, 'lines'),
    pieces,
    clearing: asClearing(value.clearing, spec, board, piece),
    history,
  }
}
