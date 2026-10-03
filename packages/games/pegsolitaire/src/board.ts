/**
 * 孔明棋（Peg Solitaire）的棋盘模型：33 孔英式棋盘、起始布局、跳吃合法性。
 *
 * 棋盘是 7×7 去掉四个 2×2 角块：第 0/1/5/6 行只在第 2~4 列有孔，
 * 第 2~4 行整行有孔 —— 共 4×3 + 3×7 = 33 个孔位（经典英式棋盘）。
 *
 * 与其它玩法不同，本玩法**没有任何随机性**：三档难度是三种固定的经典起始布局，
 * 因此不需要 seed，也绝不用 Math.random。
 */
import { IllegalActionError } from '@eink/core'

export const GAME_ID = 'pegsolitaire'

export const BOARD_SIZE = 7

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BoardConfig {
  /** 起始时为空（不放棋子）的孔位；其余孔位都放棋子 */
  readonly emptyHoles: readonly number[]
}

export function rowOf(index: number, size = BOARD_SIZE): number {
  return Math.floor(index / size)
}

export function colOf(index: number, size = BOARD_SIZE): number {
  return index % size
}

export function indexOf(row: number, col: number, size = BOARD_SIZE): number {
  return row * size + col
}

/** 棋盘中心孔：最经典的开局空位，也是「剩一枚棋子」时最理想的落点 */
export const CENTER = indexOf(3, 3)

/** 四个 2×2 角块不属于棋盘：这些格子在视图里画成墙（壳层的斜纹） */
function isCornerBlock(index: number): boolean {
  const row = rowOf(index)
  const col = colOf(index)
  const edgeRow = row <= 1 || row >= BOARD_SIZE - 2
  const edgeCol = col <= 1 || col >= BOARD_SIZE - 2
  return edgeRow && edgeCol
}

/** 33 个孔位（升序索引），棋盘相关的遍历都以它为准 */
export const HOLE_INDEXES: readonly number[] = (() => {
  const out: number[] = []
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index++) {
    if (!isCornerBlock(index)) out.push(index)
  }
  return out
})()

const HOLE_MASK: readonly boolean[] = (() => {
  const mask = new Array<boolean>(BOARD_SIZE * BOARD_SIZE).fill(false)
  for (const index of HOLE_INDEXES) mask[index] = true
  return mask
})()

export function isHole(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < HOLE_MASK.length && HOLE_MASK[index] === true
}

/**
 * 三档难度 = 三种起始布局。
 * - starter：只有中心空（最经典，也最对称）；
 * - skilled：中心 + 其正上方空（多一个空位，起手选择更多）；
 * - challenging：中心 + (6,4) 空 —— 这个起始在棋盘的 8 个对称变换下都会变样（非对称起始），
 *   并且已用独立求解器验证有解（见 tests）。
 */
export const DIFFICULTIES: Record<DifficultyId, BoardConfig> = {
  starter: { emptyHoles: [CENTER] },
  skilled: { emptyHoles: [CENTER, indexOf(2, 3)] },
  challenging: { emptyHoles: [CENTER, indexOf(6, 4)] },
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

/** 起始布局：除 emptyHoles 之外的所有孔位都放棋子；非孔位永远为 false */
export function initialPegs(difficulty: DifficultyId): boolean[] {
  const empty = new Set(configFor(difficulty).emptyHoles)
  const pegs = new Array<boolean>(BOARD_SIZE * BOARD_SIZE).fill(false)
  for (const index of HOLE_INDEXES) pegs[index] = !empty.has(index)
  return pegs
}

export function countPegs(pegs: readonly boolean[]): number {
  let count = 0
  for (const index of HOLE_INDEXES) if (pegs[index]) count += 1
  return count
}

/** 一次跳吃：从 from 跳过 jumped 落到 to */
export interface Jump {
  readonly from: number
  readonly to: number
  readonly jumped: number
}

/** 四个跳吃方向：上、下、左、右（各跨两格） */
const JUMP_DELTAS: readonly number[] = [-2 * BOARD_SIZE, 2 * BOARD_SIZE, -2, 2]

/**
 * from 与 to 之间被跳过的格子；不是「正交相隔一格」或两端不是孔位时返回 null。
 * 斜线一律不合法（棋盘上没有斜向跳吃）。
 */
export function jumpedIndex(from: number, to: number): number | null {
  if (!isHole(from) || !isHole(to)) return null
  const deltaRow = rowOf(to) - rowOf(from)
  const deltaCol = colOf(to) - colOf(from)
  const middle =
    Math.abs(deltaRow) === 2 && deltaCol === 0
      ? indexOf(rowOf(from) + deltaRow / 2, colOf(from))
      : Math.abs(deltaCol) === 2 && deltaRow === 0
        ? indexOf(rowOf(from), colOf(from) + deltaCol / 2)
        : null
  if (middle === null || !isHole(middle)) return null
  return middle
}

/** 合法性：起点有子、被跳过的格子有子、落点是空孔，且三点在一条正交直线上 */
export function isLegalJump(pegs: readonly boolean[], from: number, to: number): boolean {
  const jumped = jumpedIndex(from, to)
  if (jumped === null) return false
  return pegs[from] === true && pegs[jumped] === true && pegs[to] === false
}

/** from 处棋子能落到的所有空孔（固定顺序：上、下、左、右） */
export function jumpTargets(pegs: readonly boolean[], from: number): number[] {
  const out: number[] = []
  if (!isHole(from) || !pegs[from]) return out
  for (const delta of JUMP_DELTAS) {
    const to = from + delta
    const jumped = jumpedIndex(from, to)
    if (jumped !== null && pegs[jumped] && !pegs[to]) out.push(to)
  }
  return out
}

/** 当前局面上所有合法跳吃（from 升序、方向按固定顺序） */
export function legalJumps(pegs: readonly boolean[]): Jump[] {
  const out: Jump[] = []
  for (const from of HOLE_INDEXES) {
    for (const to of jumpTargets(pegs, from)) {
      out.push({ from, to, jumped: jumpedIndex(from, to)! })
    }
  }
  return out
}

/** 执行一次跳吃：起点与被跳过的棋子拿掉，落点放上棋子；返回新数组，不改原数组 */
export function applyJump(pegs: readonly boolean[], from: number, to: number): boolean[] {
  const jumped = jumpedIndex(from, to)
  if (jumped === null) throw new IllegalActionError(GAME_ID, `illegal jump ${from}->${to}`)
  const next = pegs.slice()
  next[from] = false
  next[jumped] = false
  next[to] = true
  return next
}
