/**
 * 数字华容道的棋盘模型：坐标换算、滑动、可解性判定与打乱。
 *
 * 两个关键设计（对应验收里的「打乱必须保证可解」）：
 * 1. **构造性保证**：打乱一律从已还原局面出发做 N 次随机合法滑动，
 *    因此得到的局面必然与初始局面同属一个可达分量（可解），不可能出现「无解盘」；
 * 2. **独立判据**：`isSolvable` 用逆序数奇偶性判定可解性，与构造方式无关 ——
 *    测试用它交叉验证构造结果，而不是让构造方式自证。
 *
 * 尺寸与打乱步数只在这里定义一处，规则层/视图层/测试都从这里取，
 * 避免出现「视图按 3×3 画、规则按 4×4 算」这类分叉。
 */
import { IllegalActionError, createRng, type MoveDir } from '@eink/core'

export const GAME_ID = 'fifteen'

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BoardConfig {
  readonly size: number
  /**
   * 打乱用的随机游走步数。3×3 也要 ≥ 60：
   * 步数太少的随机游走经常几步就走回还原态或留下「一眼就能还原」的盘面。
   */
  readonly scrambleSteps: number
}

export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  starter: { size: 3, scrambleSteps: 60 },
  skilled: { size: 4, scrambleSteps: 120 },
  challenging: { size: 5, scrambleSteps: 200 },
}

/** 四个方向的固定顺序：视图/方向盘/合法动作列表都按它输出，保证结果稳定可比对 */
export const DIRECTIONS: readonly MoveDir[] = ['up', 'down', 'left', 'right']

const DIRECTION_DELTAS: Record<MoveDir, { readonly row: number; readonly col: number }> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
}

export function isMoveDir(value: unknown): value is MoveDir {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

export function opposite(dir: MoveDir): MoveDir {
  switch (dir) {
    case 'up':
      return 'down'
    case 'down':
      return 'up'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function configFor(difficulty: DifficultyId): BoardConfig {
  return DIFFICULTIES[difficulty]
}

/** 格子总数（含空白格） */
export function cellCount(config: BoardConfig): number {
  return config.size * config.size
}

/** 数字块数量 = 格子总数 − 1 */
export function tileCount(config: BoardConfig): number {
  return cellCount(config) - 1
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同结果」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function rowOf(index: number, size: number): number {
  return Math.floor(index / size)
}

export function colOf(index: number, size: number): number {
  return index % size
}

export function indexOf(row: number, col: number, size: number): number {
  return row * size + col
}

/** 已还原局面：1..N−1 顺序排列，空白格（0）在最后一格 */
export function createSolvedBoard(size: number): number[] {
  const board: number[] = []
  for (let value = 1; value < size * size; value++) board.push(value)
  board.push(0)
  return board
}

export function blankIndex(board: readonly number[]): number {
  const index = board.indexOf(0)
  if (index < 0) throw new IllegalActionError(GAME_ID, 'board has no blank cell')
  return index
}

export function isSolved(board: readonly number[], size: number): boolean {
  for (let index = 0; index < size * size - 1; index++) {
    if (board[index] !== index + 1) return false
  }
  return board[size * size - 1] === 0
}

/** 已归位的数字块数量（空白格不计入，总数 = N−1） */
export function placedCount(board: readonly number[], size: number): number {
  let count = 0
  for (let index = 0; index < size * size - 1; index++) {
    if (board[index] === index + 1) count++
  }
  return count
}

/**
 * 空白格朝 dir 移动一格后的新位置。
 * 语义统一为「空白格朝该方向移动」，等价于「把该方向相邻的数字块滑进空白」。
 * 移出棋盘返回 null（该方向走不通）。
 */
export function targetOf(blank: number, dir: MoveDir, size: number): number | null {
  const delta = DIRECTION_DELTAS[dir]
  if (!delta) return null
  const row = rowOf(blank, size) + delta.row
  const col = colOf(blank, size) + delta.col
  if (row < 0 || row >= size || col < 0 || col >= size) return null
  return indexOf(row, col, size)
}

/** 该方向是否走得通（空白格朝该方向移动后仍在棋盘内） */
export function canSlide(board: readonly number[], size: number, dir: MoveDir): boolean {
  return targetOf(blankIndex(board), dir, size) !== null
}

/** 交换空白格与 index 处的数字块，返回新棋盘；index 与空白不相邻时返回 null */
function swapWithBlank(board: readonly number[], blank: number, index: number): number[] {
  const next = board.slice()
  next[blank] = board[index]!
  next[index] = 0
  return next
}

/** 执行一次滑动（空白格朝 dir 移动）；该方向走不通返回 null */
export function slide(board: readonly number[], size: number, dir: MoveDir): number[] | null {
  const blank = blankIndex(board)
  const target = targetOf(blank, dir, size)
  if (target === null) return null
  return swapWithBlank(board, blank, target)
}

/**
 * 点格子滑动：只有与空白格正交相邻的数字块能滑入空白，其余返回 null。
 * 返回 null 的各种情况（越界 / 空白格自身 / 不相邻）由调用方决定是「没反应」还是报错。
 */
export function slideTile(board: readonly number[], size: number, index: number): number[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= board.length) return null
  const blank = blankIndex(board)
  if (index === blank || board[index] === 0) return null
  const distance =
    Math.abs(rowOf(index, size) - rowOf(blank, size)) +
    Math.abs(colOf(index, size) - colOf(blank, size))
  if (distance !== 1) return null
  return swapWithBlank(board, blank, index)
}

/** 逆序数：忽略空白格，统计前面比后面大的数对个数 */
export function inversions(board: readonly number[]): number {
  const tiles = board.filter((value) => value !== 0)
  let count = 0
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[i]! > tiles[j]!) count += 1
    }
  }
  return count
}

/**
 * 逆序数奇偶性判据（与打乱方式无关的**独立**判据）：
 * - 奇数宽度：逆序数为偶数 ⇔ 可解；
 * - 偶数宽度：逆序数 + 空白格所在行（从下往上数，1 起）为奇数 ⇔ 可解。
 */
export function isSolvable(board: readonly number[], size: number): boolean {
  const parity = inversions(board)
  if (size % 2 === 1) return parity % 2 === 0
  const blankRowFromBottom = size - rowOf(blankIndex(board), size)
  return (parity + blankRowFromBottom) % 2 === 1
}

export interface ScrambleResult {
  readonly board: number[]
  /** 打乱实际消耗的随机数个数（含「打乱回还原态后退回重打」的次数），存档据此复核初始局面 */
  readonly cursor: number
}

/** 重打上限：随机游走走回还原态的概率极低，留一点余量即可，超出说明实现有问题 */
const MAX_SCRAMBLE_ATTEMPTS = 16
/** 重打时换一条随机流的盐：让第 k 次尝试的随机流彼此独立，同时保持完全确定性 */
const RETRY_SALT = 0x9e3779b9

/**
 * 从已还原局面出发做 scrambleSteps 次随机合法滑动。
 *
 * - 随机源只用 core 的 createRng（绝不用 Math.random）；
 * - 每一步都排除上一步的反向，避免「走一步退一步」把步数白白浪费掉；
 * - 打乱后若恰好还是已还原局面，**退回重打**（换一条随机流），
 *   因此调用方拿到的局面既保证可解，也保证不等于初始局面。
 */
export function scrambleBoard(config: BoardConfig, seed: number): ScrambleResult {
  const { size, scrambleSteps } = config
  for (let attempt = 0; attempt < MAX_SCRAMBLE_ATTEMPTS; attempt++) {
    const rng = createRng(seed + attempt * RETRY_SALT)
    const board = createSolvedBoard(size)
    let blank = board.length - 1
    let previous: MoveDir | null = null
    for (let step = 0; step < scrambleSteps; step++) {
      // 显式标注类型：避免 previous/candidates/dir 之间形成推断环（TS7022）
      const avoid: MoveDir | null = previous === null ? null : opposite(previous)
      const candidates: MoveDir[] = DIRECTIONS.filter(
        (dir) => dir !== avoid && targetOf(blank, dir, size) !== null,
      )
      const dir: MoveDir = rng.pick(candidates)
      const target = targetOf(blank, dir, size)!
      board[blank] = board[target]!
      board[target] = 0
      blank = target
      previous = dir
    }
    if (!isSolved(board, size)) {
      return { board, cursor: scrambleSteps * (attempt + 1) }
    }
  }
  // 固定随机流下连续多次都打回还原态（例如退化的 2×2 周期游走）：明确报错而不是返回还原盘
  throw new IllegalActionError(GAME_ID, 'scramble failed to leave the solved position')
}
