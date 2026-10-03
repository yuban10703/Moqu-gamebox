/**
 * 俄罗斯方块规则层：纯函数、无副作用、无 DOM、**无时间依赖**。
 *
 * 三条硬约束（墨水屏 + 可复现存档）：
 *
 * 1. **没有重力定时器**。规则层不引用时间，也不存在「每隔 N 毫秒自动下落」这回事：
 *    下落完全由玩家按「落」驱动 —— 走一格；已经落到底时再按一次就固化并出新块。
 *    因此规则层里没有 setInterval/Date.now，存档在任何时刻都能原样恢复。
 * 2. **出块顺序只由 seed 决定**：7-bag（每袋 7 种形状各一次，袋内顺序洗牌），
 *    第 k 袋用 `createRng(seed + k*7)` 这条独立随机流。状态里只存「已出块数 cursor」，
 *    于是任意时刻都能算出当前块与下一块，且同一 seed + 同一操作序列双端必然一致。
 *    规则层禁止 Math.random（守卫脚本会扫描）。
 * 3. **撤销用逆操作，不存整盘快照**。棋盘 180 格、每步都存一份会把存档撑大：
 *    - 平移/旋转/下落一格 → 只记「上一步的方块位置」（4 个数字）；
 *    - 固化（含消行）→ 记 `{上一块位置, 出块游标, 分数, 消行数, 已固化块数, 被消掉的行号}`，
 *      棋盘本身由「把整行插回去 + 抹掉这一块自己」逆推出来（见 undoTetris）。
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
}

/**
 * 难度只改**开局条件**，不改规则（离散步进下这是唯一有意义的差异来源）：
 * - 入门：10×18 井（最深，回旋余量最大）、无初始堆叠；
 * - 熟练：10×16 井（更浅，可周转的余量更小）；
 * - 挑战：10×16 井，底部先堆 4 行垃圾（每行一个洞）—— 开局就得先挖洞。
 *
 * 尺寸是反推出来的，不是拍的。竖屏 439×847 下棋盘可用区最紧一档约 **415×420**
 * （真机实测表见 docs/handover.md 第 8 节；同一个口径也写在 games-contract.test.ts 里），
 * 格子 = min(可用宽/列数, 可用高/行数) —— 高度是瓶颈：
 *   10×18 → (420-10)/18 ≈ 22.8px；10×16 → ≈ 25.6px；再高一档 10×19 就只剩 21.6px（低于可读线）。
 * 所以列数固定 10、行数上限 18，难度差异改由「井深 + 初始堆叠」承担。
 */
export const DIFFICULTIES: readonly DifficultyTetris[] = [
  { id: 'starter', cols: 10, rows: 18, garbageRows: 0 },
  { id: 'skilled', cols: 10, rows: 16, garbageRows: 0 },
  { id: 'challenging', cols: 10, rows: 16, garbageRows: 4 },
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
 */
export type HistoryEntry =
  | { readonly kind: 'piece'; readonly piece: ActivePiece }
  | {
      readonly kind: 'lock'
      readonly piece: ActivePiece
      readonly cursor: number
      readonly score: number
      readonly lines: number
      readonly pieces: number
      /** 本次固化后消掉的整行行号（升序） */
      readonly cleared: readonly number[]
    }

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
  readonly history: readonly HistoryEntry[]
}

export type TetrisAction =
  /** 方向盘语义：left/right 平移一格、up 顺时针旋转、down 下落一格（着地则固化） */
  | { type: 'move'; dir: MoveDir }
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
    history: [],
  }
}

/**
 * 胜负：只有「堆到顶部」这一种结束方式 —— 新块在井口放不下即失败。
 * 本玩法**没有胜利条件**，所以 status 不会返回 'won'（不编造一个「消满 N 行算赢」的目标）。
 * 其余动作都被碰撞检查挡住，因此方块「放不下」只可能发生在出块瞬间。
 */
export function statusOf(state: TetrisState): GameStatus {
  return fits(state.board, difficultyOf(state.difficulty), state.piece) ? 'playing' : 'lost'
}

export function canUndo(state: TetrisState): boolean {
  return state.history.length > 0
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

function withEntry(state: TetrisState, entry: HistoryEntry): TetrisState {
  return { ...state, history: [...state.history, entry] }
}

function shiftPiece(state: TetrisState, spec: DifficultyTetris, dir: 'left' | 'right'): TetrisState {
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

/** 下落一格；已经落到底（或压在堆上）就固化并出下一块 */
function stepDown(state: TetrisState, spec: DifficultyTetris): TetrisState {
  const down: ActivePiece = { ...state.piece, row: state.piece.row + 1 }
  if (fits(state.board, spec, down)) {
    return { ...withEntry(state, { kind: 'piece', piece: state.piece }), piece: down }
  }
  return lockPiece(state, spec)
}

function lockPiece(state: TetrisState, spec: DifficultyTetris): TetrisState {
  const merged = state.board.slice()
  for (const cell of pieceCells(state.piece)) {
    merged[cellIndex(spec.cols, cell.row, cell.col)] = CELL_FILLED
  }
  const cleared = fullRows(merged, spec)
  const board = cleared.length > 0 ? clearRows(merged, spec, cleared) : merged
  const entry: HistoryEntry = {
    kind: 'lock',
    piece: state.piece,
    cursor: state.cursor,
    score: state.score,
    lines: state.lines,
    pieces: state.pieces,
    cleared,
  }
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    board,
    // 下一块：cursor 指向的那一块；放不下就是失败局面（status 会报 lost）
    piece: spawnPiece(pieceAt(state.seed, state.cursor), spec.cols),
    cursor: state.cursor + 1,
    score: state.score + scoreForLines(cleared.length, levelOf(state.lines)),
    lines: state.lines + cleared.length,
    pieces: state.pieces + 1,
    history: [...state.history, entry],
  }
}

/**
 * 撤销：回退一步 —— 棋盘、当前块、出块游标、分数、消行、已固化块数全部回到动作之前。
 * 用逆操作而不是快照：一步最多只有 4 个格子 + 4 个计数。
 */
export function undoTetris(state: TetrisState, spec: DifficultyTetris = difficultyOf(state.difficulty)): TetrisState {
  const entry = state.history[state.history.length - 1]
  if (!entry) throw new IllegalActionError(GAME_TETRIS_ID, 'nothing to undo')
  const history = state.history.slice(0, -1)
  if (entry.kind === 'piece') {
    return { ...state, piece: entry.piece, history }
  }
  // 逆序：先把被消掉的整行插回去（还原出「刚固化、还没消行」的棋盘），
  // 再抹掉这一块自己占的格子 —— 固化前那些格子本来就是空的。
  const board = restoreRows(state.board, spec, entry.cleared)
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
    history,
  }
}

export function reduceState(state: TetrisState, action: TetrisAction): TetrisState {
  const spec = difficultyOf(state.difficulty)

  if (action.type === 'undo') return undoTetris(state, spec)
  // 重开：回到同一 seed 的初始局面，并丢掉历史（重开后不能撤销回重开之前）。
  // 壳层的「重新开始」在无关卡玩法上走的是重新开局（换 seed），这里保留 restart 是为了
  // 契约完整：会话对每款游戏都会派发它。
  if (action.type === 'restart') return createState(state.seed, state.difficulty)
  if (action.type !== 'move') throw new IllegalActionError(GAME_TETRIS_ID, 'unknown action')

  // 已经堆到顶：除撤销/重开外一律拒绝（结果面板上的撤销按钮仍然可用，见 undoTetris）
  if (statusOf(state) !== 'playing') throw new IllegalActionError(GAME_TETRIS_ID, 'game over')

  if (action.dir === 'left' || action.dir === 'right') return shiftPiece(state, spec, action.dir)
  if (action.dir === 'up') return rotatePiece(state, spec)
  return stepDown(state, spec)
}

export function legalActions(state: TetrisState): readonly TetrisAction[] {
  const actions: TetrisAction[] = []
  if (statusOf(state) === 'playing') {
    for (const dir of ALL_DIRS) {
      if (isLegal(state, { type: 'move', dir })) actions.push({ type: 'move', dir })
    }
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
  | { kind: 'piece'; piece: EncodedPiece }
  | {
      kind: 'lock'
      piece: EncodedPiece
      cursor: number
      score: number
      lines: number
      pieces: number
      cleared: number[]
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
    history: state.history.map((entry): EncodedHistoryEntry => {
      if (entry.kind === 'piece') return { kind: 'piece', piece: encodePiece(entry.piece) }
      return {
        kind: 'lock',
        piece: encodePiece(entry.piece),
        cursor: entry.cursor,
        score: entry.score,
        lines: entry.lines,
        pieces: entry.pieces,
        cleared: [...entry.cleared],
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
  }
  if (raw.kind !== 'piece' && raw.kind !== 'lock') {
    throw new IllegalActionError(GAME_TETRIS_ID, 'bad history kind')
  }
  const piece = asPiece(raw.piece, spec)
  if (raw.kind === 'piece') return { kind: 'piece', piece }
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
  }
}

/**
 * 存档解码：任何缺字段 / 类型不对 / 数值非法都抛 IllegalActionError，
 * 让壳层把「存档损坏」明确告诉用户，而不是带着半个局面继续玩。
 *
 * 唯一的例外是 `history` 缺失 —— 那按空撤销栈处理（老存档不判损坏）。
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
    history,
  }
}
