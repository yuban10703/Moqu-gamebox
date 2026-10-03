/**
 * 播棋（Kalah）棋盘模型：2 行 × 7 列 = 14 格，含环形播种几何与纯局面转移。
 *
 * ── 布局（画出来，索引就是 row*7+col）────────────────────────────────────────
 *        列0      列1   列2   列3   列4   列5   列6
 *  行0  白仓[0]  白坑1  白坑2  白坑3  白坑4  白坑5  白坑6     ← 白方（对手）
 *  行1  黑坑7    黑坑8  黑坑9  黑坑10 黑坑11 黑坑12 黑仓[13]  ← 黑方（玩家）
 *
 * - 白方仓 = 索引 0；白方坑 = 索引 1..6（**从右往左**播种：6→5→4→3→2→1）；
 * - 黑方坑 = 索引 7..12（**从左往右**播种：7→8→9→10→11→12）；黑方仓 = 索引 13。
 *
 * ── 方向判据（不是结论，判据本身）────────────────────────────────────────────
 * 把 14 格按**逆时针**串成一个环：
 *
 *   RING = [7, 8, 9, 10, 11, 12, 13, 6, 5, 4, 3, 2, 1, 0]  → 再回到 7
 *
 * 判据：黑坑在左下列、从左往右递增（7→12），接着是黑仓 13（右下），
 * 沿右侧往上到白坑 6（右上），白坑在右上列从右往左递减（6→1），
 * 接着是白仓 0（左上），再沿左侧往下回到黑坑 7 —— 于是整个环正好逆时针一圈。
 * 播种 = 沿着这个环往前走；**遇到对手的仓就跳过**（自己的仓不跳）。
 * 因此「最后一颗本该落在对手仓」时，实际落在**跳过对手仓之后的下一格**：
 * 黑方跳过白仓 0 → 落到黑坑 7；白方跳过黑仓 13 → 落到白坑 6。
 * 因为环上永远不踩对手仓，所以最后一颗落在对手仓这种情况在实现里根本不会出现。
 *
 * ── 纯局面转移 ─────────────────────────────────────────────────────────────
 * `sowOnce` 同时给出「是否连走」与「吃了多少」，规则层与 AI 试算共用同一份实现，
 * 保证两条路径语义完全一致。
 */
import { IllegalActionError } from '@eink/core'

export const GAME_ID = 'mancala'

export const COLS = 7
export const ROWS = 2
export const CELLS = COLS * ROWS
export const PITS_PER_SIDE = 6

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

/** 黑方是玩家（先手），白方由规则层自动应手 */
export type Side = 'black' | 'white'

export const BLACK: Side = 'black'
export const WHITE: Side = 'white'

export function otherSide(side: Side): Side {
  return side === BLACK ? WHITE : BLACK
}

/** 每坑初始石子数（三档都用 4，写进规则文案） */
export const INITIAL_STONES = 4

export const WHITE_STORE = 0
export const BLACK_STORE = 13

/** 逆时针一圈的格序（见文件头的判据） */
export const RING: readonly number[] = [7, 8, 9, 10, 11, 12, 13, 6, 5, 4, 3, 2, 1, 0]

const RING_POSITION: readonly number[] = (() => {
  const positions = new Array<number>(CELLS).fill(-1)
  RING.forEach((cell, position) => {
    positions[cell] = position
  })
  return positions
})()

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function inRange(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELLS
}

export function rowOf(index: number): number {
  return Math.floor(index / COLS)
}

export function colOf(index: number): number {
  return index % COLS
}

export function indexOf(row: number, col: number): number {
  return row * COLS + col
}

export function storeOf(side: Side): number {
  return side === BLACK ? BLACK_STORE : WHITE_STORE
}

/** 该方的 6 个坑（黑 7..12 升序；白 1..6 升序） */
export function pitIndexes(side: Side): number[] {
  return side === BLACK ? [7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6]
}

export function isStore(index: number): boolean {
  return inRange(index) && (index === WHITE_STORE || index === BLACK_STORE)
}

export function isPit(index: number): boolean {
  return inRange(index) && !isStore(index)
}

export function ringPosition(index: number): number {
  return RING_POSITION[index] ?? -1
}

/**
 * 沿逆时针走一格；**跳过对手的仓**。
 * 判据：从当前位置在环上前进，直到落点不是 `storeOf(otherSide(side))`。
 */
export function nextCell(index: number, side: Side): number {
  const forbidden = storeOf(otherSide(side))
  let position = ringPosition(index)
  for (let step = 0; step < CELLS; step++) {
    position = (position + 1) % CELLS
    const cell = RING[position]!
    if (cell !== forbidden) return cell
  }
  return index
}

/**
 * 正对面的坑（黑坑 7..12 ↔ 白坑 6..1）。
 * 判据：黑坑 7+i 对白坑 6-i；白坑 j 对黑坑 7+(6-j)。两边的行差正好是 1，列和正好是 6。
 */
export function oppositePit(index: number): number {
  if (index >= 7 && index <= 12) return 6 - (index - 7)
  if (index >= 1 && index <= 6) return 7 + (6 - index)
  return -1
}

export function initialCells(stones: number = INITIAL_STONES): number[] {
  const cells = new Array<number>(CELLS).fill(0)
  for (const pit of pitIndexes(BLACK)) cells[pit] = stones
  for (const pit of pitIndexes(WHITE)) cells[pit] = stones
  return cells
}

export function storeCount(cells: readonly number[], side: Side): number {
  return cells[storeOf(side)] ?? 0
}

/** 该方 6 个坑里的石子总数 */
export function pitStones(cells: readonly number[], side: Side): number {
  let total = 0
  for (const pit of pitIndexes(side)) total += cells[pit] ?? 0
  return total
}

export function totalStones(cells: readonly number[]): number {
  return cells.reduce((sum, count) => sum + count, 0)
}

/** 一方 6 个坑全空即结束（此时要结算） */
export function isFinished(cells: readonly number[]): boolean {
  return pitStones(cells, BLACK) === 0 || pitStones(cells, WHITE) === 0
}

/** 结算：双方把各自坑里的石子收回自己的仓（幂等，可以重复调用） */
export function settle(cells: readonly number[]): number[] {
  const next = [...cells]
  for (const side of [BLACK, WHITE] as const) {
    const store = storeOf(side)
    for (const pit of pitIndexes(side)) {
      next[store] = (next[store] ?? 0) + (next[pit] ?? 0)
      next[pit] = 0
    }
  }
  return next
}

export interface MancalaState {
  readonly difficulty: DifficultyId
  readonly seed: number
  /** 14 格石子数（含两个仓） */
  readonly cells: readonly number[]
  /** 现在轮到谁。可对局时恒为黑方（白方应手在同一次 reduce 内算完） */
  readonly turn: Side
  /** 玩家（黑方）播种次数；撤销会回退 */
  readonly moves: number
  /** 已应手过的白方回合数：白方每回合用 createRng(seed + 该值) 取一次随机流 */
  readonly rngCursor: number
  /** 玩家最近一次播种的坑（复盘/呈现用） */
  readonly lastPit: number | null
  /** 双方全部播种的日志（动作日志即存档） */
  readonly log: readonly number[]
}

export function createBoardState(seed: number, difficulty: DifficultyId, stones = INITIAL_STONES): MancalaState {
  return {
    difficulty,
    seed: normalizeSeed(seed),
    cells: initialCells(stones),
    turn: BLACK,
    moves: 0,
    rngCursor: 0,
    lastPit: null,
    log: [],
  }
}

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError(GAME_ID, reason)
}

export interface SowResult {
  readonly state: MancalaState
  /** 最后一颗落在自己的仓 → 连走 */
  readonly extraTurn: boolean
  /** 这一手吃进自己仓的石子数（含被吃的坑内石子） */
  readonly captured: number
}

/**
 * 纯局面转移：当前这一方从 pit 播种。
 *
 * 依次判定：
 * 1. 非法（越界 / 不是坑 / 不是当前方的坑 / 空坑）抛 IllegalActionError；
 * 2. 取出全部石子沿逆时针逐格放 1 颗（跳过对手的仓）；
 * 3. 最后一颗落在**自己的仓** → 连走（turn 不变）；
 * 4. 否则最后一颗落在**自己原本为空的坑**、且**正对面有石子** → 两边坑一起收进自己仓；
 * 5. 换手（连走则不变）；换到白方时随机游标 +1；
 * 6. 若换手后轮到的一方 6 坑全空 → 结算（双方坑内石子收回各自仓），对局结束。
 */
export function sowOnce(state: MancalaState, pit: number): SowResult {
  const side = state.turn
  if (!inRange(pit) || !isPit(pit)) {
    throw illegal(`mancala.illegal.sow:${String(pit)}`)
  }
  if (!pitIndexes(side).includes(pit)) {
    throw illegal(`mancala.illegal.not-your-pit:${pit}`)
  }
  const stones = state.cells[pit] ?? 0
  if (stones === 0) throw illegal(`mancala.illegal.empty-pit:${pit}`)

  const cells = state.cells.slice()
  cells[pit] = 0
  let cursor = pit
  let last = pit
  let emptyBeforeLast = false
  for (let stone = 0; stone < stones; stone++) {
    cursor = nextCell(cursor, side)
    emptyBeforeLast = (cells[cursor] ?? 0) === 0
    cells[cursor] = (cells[cursor] ?? 0) + 1
    last = cursor
  }

  const extraTurn = last === storeOf(side)
  let captured = 0
  if (!extraTurn && pitIndexes(side).includes(last) && emptyBeforeLast) {
    const opposite = oppositePit(last)
    const oppositeStones = opposite >= 0 ? cells[opposite] ?? 0 : 0
    if (oppositeStones > 0) {
      captured = (cells[last] ?? 0) + oppositeStones
      cells[storeOf(side)] = (cells[storeOf(side)] ?? 0) + captured
      cells[last] = 0
      cells[opposite] = 0
    }
  }

  const turn = extraTurn ? side : otherSide(side)
  let rngCursor = state.rngCursor
  if (turn === WHITE && side === BLACK) rngCursor += 1
  let next: MancalaState = {
    ...state,
    cells,
    turn,
    rngCursor,
    moves: side === BLACK ? state.moves + 1 : state.moves,
    lastPit: side === BLACK ? pit : state.lastPit,
    log: [...state.log, pit],
  }
  // 结算：轮到的一方无子可走 ⇒ 本局结束（settle 幂等，重复调用不会多算）
  if (isFinished(next.cells)) {
    next = { ...next, cells: settle(next.cells) }
  }
  return { state: next, extraTurn, captured }
}

/** 只关心结果状态的便捷入口 */
export function applySow(state: MancalaState, pit: number): MancalaState {
  return sowOnce(state, pit).state
}

/** 该方现在可以播种的坑（升序） */
export function legalPits(state: MancalaState, side: Side = state.turn): number[] {
  if (isFinished(state.cells)) return []
  return pitIndexes(side).filter((pit) => (state.cells[pit] ?? 0) > 0)
}

/** 仓里的石子数（用于比胜负） */
export function finalScore(state: MancalaState, side: Side): number {
  return storeCount(state.cells, side)
}
