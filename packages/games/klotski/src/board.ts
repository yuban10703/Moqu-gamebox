/**
 * 华容道棋盘模型：4×5 棋盘、方块、关卡布局与滑动判定。
 *
 * 棋盘 4 列 × 5 行；出口在**最底行中间两格**（row 4, col 1 / col 2）。
 * 曹操（2×2）左上角到达 (row 3, col 1) 时两块正好压住出口两格 —— 这就是胜利条件。
 *
 * 关卡布局是固定的经典摆法，**没有任何随机性**，因此不需要 seed，也绝不用 Math.random。
 * 每关的 `optimalMoves` 是该布局的最少**单格滑动**次数，由测试里独立实现的 BFS 求解器验证
 * （经典资料里「横刀立马 81 步」用的是「同一块连续滑动算一步」的口径；
 *  本游戏的每次滑动只走一格，因此按单格口径记 116 步，两者是同一套解法）。
 */
import { IllegalActionError, type MoveDir } from '@eink/core'

export const GAME_ID = 'klotski'

export const COLS = 4
export const ROWS = 5
export const CELLS = COLS * ROWS

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function indexOf(row: number, col: number): number {
  return row * COLS + col
}

export function rowOf(index: number): number {
  return Math.floor(index / COLS)
}

export function colOf(index: number): number {
  return index % COLS
}

/** 出口两格：最底行中间 */
export const EXIT_CELLS: readonly number[] = [indexOf(4, 1), indexOf(4, 2)]
/** 曹操左上角的目标位置：到达它就刚好压住出口两格 */
export const CAO_GOAL = indexOf(3, 1)
/** 曹操的块 id */
export const CAO_ID = 'cao'

export interface LevelPiece {
  readonly id: string
  readonly glyph: string
  readonly width: number
  readonly height: number
  /** 左上角格子的行优先索引 */
  readonly start: number
}

export interface LevelDef {
  readonly id: string
  readonly difficulty: DifficultyId
  /** 本布局的最少单格滑动次数（独立 BFS 求解器验证；界面上的「目标」统计用它） */
  readonly optimalMoves: number
  readonly pieces: readonly LevelPiece[]
}

/**
 * 棋盘字形。它们和 ● / ○ 一样是**图形符号**而不是界面文案（中文/英文界面下都显示同样的字），
 * 因此标 i18n-exempt 跳过「硬编码中文文案」扫描。
 */
export const PIECE_GLYPHS = {
  cao: '曹', // i18n-exempt
  guan: '关', // i18n-exempt
  zhang: '张', // i18n-exempt
  zhao: '赵', // i18n-exempt
  ma: '马', // i18n-exempt
  huang: '黄', // i18n-exempt
  pawn: '卒', // i18n-exempt
} as const

function cao(col: number, row: number): LevelPiece {
  return { id: CAO_ID, glyph: PIECE_GLYPHS.cao, width: 2, height: 2, start: indexOf(row, col) }
}

function verticalGeneral(id: string, glyph: string, col: number, row: number): LevelPiece {
  return { id, glyph, width: 1, height: 2, start: indexOf(row, col) }
}

function horizontalGeneral(id: string, glyph: string, col: number, row: number): LevelPiece {
  return { id, glyph, width: 2, height: 1, start: indexOf(row, col) }
}

function pawn(n: number, col: number, row: number): LevelPiece {
  return { id: `pawn-${n}`, glyph: PIECE_GLYPHS.pawn, width: 1, height: 1, start: indexOf(row, col) }
}

/**
 * 四个经典布局（曹操都在顶部正中，五虎将四竖一横，四个卒）：
 *
 * level-1 横刀立马（关羽横在中间两行之间）
 *   张 曹 曹 马
 *   张 曹 曹 马
 *   赵 关 关 黄
 *   赵 卒 卒 黄
 *   卒 ·  ·  卒
 *
 * level-2 齐头并进（两个卒并排在关羽上面，四将纵队推进）
 *   张 曹 曹 马
 *   张 曹 曹 马
 *   赵 卒 卒 黄
 *   赵 关 关 黄
 *   卒 ·  ·  卒
 *
 * level-3 兵分三路（卒分两组，出口前留出通道）
 *   张 曹 曹 马
 *   张 曹 曹 马
 *   赵 卒 卒 黄
 *   赵 关 关 黄
 *   卒 卒 ·  ·
 *
 * level-4 层层设防（四个卒在最底行排成一堵墙，最难）
 *   张 曹 曹 马
 *   张 曹 曹 马
 *   赵 关 关 黄
 *   赵 ·  ·  黄
 *   卒 卒 卒 卒
 */
export const LEVELS: readonly LevelDef[] = [
  {
    id: 'level-1',
    difficulty: 'skilled',
    optimalMoves: 116,
    pieces: [
      cao(1, 0),
      verticalGeneral('zhang', PIECE_GLYPHS.zhang, 0, 0),
      verticalGeneral('ma', PIECE_GLYPHS.ma, 3, 0),
      verticalGeneral('zhao', PIECE_GLYPHS.zhao, 0, 2),
      verticalGeneral('huang', PIECE_GLYPHS.huang, 3, 2),
      horizontalGeneral('guan', PIECE_GLYPHS.guan, 1, 2),
      pawn(1, 1, 3),
      pawn(2, 2, 3),
      pawn(3, 0, 4),
      pawn(4, 3, 4),
    ],
  },
  {
    id: 'level-2',
    difficulty: 'starter',
    optimalMoves: 99,
    pieces: [
      cao(1, 0),
      verticalGeneral('zhang', PIECE_GLYPHS.zhang, 0, 0),
      verticalGeneral('ma', PIECE_GLYPHS.ma, 3, 0),
      verticalGeneral('zhao', PIECE_GLYPHS.zhao, 0, 2),
      verticalGeneral('huang', PIECE_GLYPHS.huang, 3, 2),
      horizontalGeneral('guan', PIECE_GLYPHS.guan, 1, 3),
      pawn(1, 1, 2),
      pawn(2, 2, 2),
      pawn(3, 0, 4),
      pawn(4, 3, 4),
    ],
  },
  {
    id: 'level-3',
    difficulty: 'skilled',
    optimalMoves: 101,
    pieces: [
      cao(1, 0),
      verticalGeneral('zhang', PIECE_GLYPHS.zhang, 0, 0),
      verticalGeneral('ma', PIECE_GLYPHS.ma, 3, 0),
      verticalGeneral('zhao', PIECE_GLYPHS.zhao, 0, 2),
      verticalGeneral('huang', PIECE_GLYPHS.huang, 3, 2),
      horizontalGeneral('guan', PIECE_GLYPHS.guan, 1, 3),
      pawn(1, 1, 2),
      pawn(2, 2, 2),
      pawn(3, 0, 4),
      pawn(4, 1, 4),
    ],
  },
  {
    id: 'level-4',
    difficulty: 'challenging',
    optimalMoves: 118,
    pieces: [
      cao(1, 0),
      verticalGeneral('zhang', PIECE_GLYPHS.zhang, 0, 0),
      verticalGeneral('ma', PIECE_GLYPHS.ma, 3, 0),
      verticalGeneral('zhao', PIECE_GLYPHS.zhao, 0, 2),
      verticalGeneral('huang', PIECE_GLYPHS.huang, 3, 2),
      horizontalGeneral('guan', PIECE_GLYPHS.guan, 1, 2),
      pawn(1, 0, 4),
      pawn(2, 1, 4),
      pawn(3, 2, 4),
      pawn(4, 3, 4),
    ],
  },
]

export interface KlotskiLevel {
  readonly def: LevelDef
  /** 整包序号（从 1 开始），用于界面显示 */
  readonly index: number
}

export const PACK: readonly KlotskiLevel[] = LEVELS.map((def, i) => ({ def, index: i + 1 }))

const BY_ID = new Map(PACK.map((level) => [level.def.id, level]))

export function levelById(id: string): KlotskiLevel | undefined {
  return BY_ID.get(id)
}

export function levelOrThrow(id: string): KlotskiLevel {
  const level = BY_ID.get(id)
  if (!level) throw new IllegalActionError(GAME_ID, `unknown level ${id}`)
  return level
}

export function levelsFor(difficulty: DifficultyId): readonly KlotskiLevel[] {
  return PACK.filter((level) => level.def.difficulty === difficulty)
}

export function firstLevelId(difficulty: DifficultyId): string {
  const list = levelsFor(difficulty)
  if (list.length === 0) throw new Error(`klotski: no levels for difficulty ${difficulty}`)
  return list[0]!.def.id
}

/** 下一关按整包顺序推进（跨难度时自然进入更高难度） */
export function nextLevelId(id: string): string | null {
  const current = BY_ID.get(id)
  if (!current) return null
  const next = PACK[current.index]
  return next ? next.def.id : null
}

export function isLastLevel(id: string): boolean {
  return nextLevelId(id) === null
}

export function packProgress(completed: readonly string[]): { done: number; total: number } {
  return {
    done: PACK.filter((level) => completed.includes(level.def.id)).length,
    total: PACK.length,
  }
}

// ---------------------------------------------------------------------------
// 几何与局面运算
// ---------------------------------------------------------------------------

/** 一个块在 start（左上角）时占用的格子（假定在盘内） */
export function cellsOf(start: number, width: number, height: number): number[] {
  const row = rowOf(start)
  const col = colOf(start)
  const out: number[] = []
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) out.push(indexOf(row + r, col + c))
  }
  return out
}

/** 左上角在 start 时整块是否都在盘内 */
export function insideBoard(start: number, width: number, height: number): boolean {
  if (!Number.isInteger(start) || start < 0 || start >= CELLS) return false
  const row = rowOf(start)
  const col = colOf(start)
  return row + height <= ROWS && col + width <= COLS
}

const DELTAS: Record<MoveDir, { readonly row: number; readonly col: number }> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
}

export function isMoveDir(value: unknown): value is MoveDir {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

/** 块沿 dir 滑一格后的左上角；越界返回 null */
export function targetStart(
  start: number,
  width: number,
  height: number,
  dir: MoveDir,
): number | null {
  const delta = DELTAS[dir]
  if (!delta) return null
  const row = rowOf(start) + delta.row
  const col = colOf(start) + delta.col
  // 必须先按行列判边界：indexOf(row, 4) 会「绕」到下一行，只查 index 是查不出来的
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null
  const next = indexOf(row, col)
  if (!insideBoard(next, width, height)) return null
  return next
}

/** 棋子位置表：块 id → 左上角索引 */
export type Positions = Readonly<Record<string, number>>

/** 由位置表生成占用图：20 格，每格是该块的 id 或 null */
export function occupancy(level: LevelDef, positions: Positions): Array<string | null> {
  const grid = new Array<string | null>(CELLS).fill(null)
  for (const piece of level.pieces) {
    const start = positions[piece.id]
    if (start === undefined) throw new IllegalActionError(GAME_ID, `missing piece ${piece.id}`)
    for (const cell of cellsOf(start, piece.width, piece.height)) {
      if (cell < 0 || cell >= CELLS) throw new IllegalActionError(GAME_ID, `piece out of board ${piece.id}`)
      if (grid[cell] !== null) throw new IllegalActionError(GAME_ID, `overlap at ${cell}`)
      grid[cell] = piece.id
    }
  }
  return grid
}

/** 某一格被哪块占用（没有则 null） */
export function ownerAt(grid: readonly (string | null)[], index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return null
  return grid[index] ?? null
}

export function initialPositions(level: LevelDef): Positions {
  const positions: Record<string, number> = {}
  for (const piece of level.pieces) positions[piece.id] = piece.start
  return positions
}

/**
 * 把 id 块沿 dir 滑一格；目标格必须**全部在盘内且为空**（不含自己），否则返回 null。
 * 返回新的位置表，不改原对象。
 */
export function slidePositions(
  level: LevelDef,
  positions: Positions,
  id: string,
  dir: MoveDir,
): Positions | null {
  const piece = level.pieces.find((item) => item.id === id)
  if (!piece) return null
  const start = positions[id]
  if (start === undefined) return null
  const next = targetStart(start, piece.width, piece.height, dir)
  if (next === null) return null
  const grid = occupancy(level, positions)
  for (const cell of cellsOf(next, piece.width, piece.height)) {
    const owner = grid[cell]
    if (owner !== null && owner !== id) return null
  }
  return { ...positions, [id]: next }
}

/** 曹操左上角是否已到出口位置 */
export function isSolved(positions: Positions): boolean {
  return positions[CAO_ID] === CAO_GOAL
}

/** 曹操以外还有哪些块（调试/测试用） */
export function pieceById(level: LevelDef, id: string): LevelPiece | undefined {
  return level.pieces.find((piece) => piece.id === id)
}

/** 从初始布局按滑动日志重放；任何一步非法都抛 IllegalActionError */
export function replaySlides(
  level: LevelDef,
  log: ReadonlyArray<{ readonly id: string; readonly dir: MoveDir }>,
): Positions {
  let positions = initialPositions(level)
  for (const slide of log) {
    const next = slidePositions(level, positions, slide.id, slide.dir)
    if (next === null) {
      throw new IllegalActionError(GAME_ID, `illegal slide ${slide.id}:${String(slide.dir)}`)
    }
    positions = next
  }
  return positions
}
