/**
 * 海战棋棋盘模型：8×8 海域、舰队自动摆放与射击局面转移。
 *
 * 摆舰口径（写进规则文案）：
 * - 三档都是 8×8 海域，只是舰数不同：3 / 4 / 5 艘，舰长取 2、3、3、4、5 的前若干条；
 * - 舰只不重叠、不越界，而且**互不接触（含对角）**—— 即任意两艘舰的格子都不在彼此的 8 邻域里；
 * - 双方舰队都由 `createRng(seed + 固定偏移)` 自动摆放，同 seed 同难度必然同布局：
 *   我方用 `seed + 0`、敌方用 `seed + ENEMY_FLEET_OFFSET`（错开随机流，避免两条流相关），
 *   摆不下时按 `attempt * RETRY_SALT` 换流重试，仍然完全确定。
 *
 * 白方 AI 的随机流用 `seed + AI_SEED_OFFSET + 白方回合数`（见 rules.ts）。
 */
import { IllegalActionError, createRng, type Rng } from '@eink/core'

export const GAME_ID = 'battleship'

export const BOARD_SIZE = 8
export const CELLS = BOARD_SIZE * BOARD_SIZE

export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging'] as const

export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

/** 对局方：player 是玩家（先手），enemy 是白方 AI */
export type Side = 'player' | 'enemy'

export const PLAYER: Side = 'player'
export const ENEMY: Side = 'enemy'

export function otherSide(side: Side): Side {
  return side === PLAYER ? ENEMY : PLAYER
}

/** 三档难度的舰长表（舰长取 2/3/3/4/5 的前若干条） */
export const SHIP_LENGTHS: Record<DifficultyId, readonly number[]> = {
  starter: [2, 3, 3],
  skilled: [2, 3, 3, 4],
  challenging: [2, 3, 3, 4, 5],
}

/** 敌方舰队的随机流偏移（与玩家舰队错开） */
export const ENEMY_FLEET_OFFSET = 1
/** 白方 AI 的随机流偏移（在舰队之后） */
export const AI_SEED_OFFSET = 2
/** 摆舰重试的盐：让第 k 次尝试用彼此独立又完全确定的随机流 */
const RETRY_SALT = 0x9e3779b9
const MAX_PLACEMENT_ATTEMPTS = 32

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function difficultyOrThrow(value: string): DifficultyId {
  if (!isDifficultyId(value)) throw new IllegalActionError(GAME_ID, `unknown difficulty ${value}`)
  return value
}

/** 种子归一化成 uint32：负数/小数/NaN 都不会破坏「同 seed 同布局」 */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function shipLengths(difficulty: DifficultyId): readonly number[] {
  return SHIP_LENGTHS[difficulty]
}

export function rowOf(index: number): number {
  return Math.floor(index / BOARD_SIZE)
}

export function colOf(index: number): number {
  return index % BOARD_SIZE
}

export function indexOf(row: number, col: number): number {
  return row * BOARD_SIZE + col
}

export function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

export function inRange(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELLS
}

/** 八邻域（用于「互不接触含对角」） */
export function neighbors8(index: number): number[] {
  const row = rowOf(index)
  const col = colOf(index)
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const r = row + dr
      const c = col + dc
      if (onBoard(r, c)) out.push(indexOf(r, c))
    }
  }
  return out
}

export interface Ship {
  readonly id: number
  readonly length: number
  /** 舰首格索引 */
  readonly start: number
  readonly horizontal: boolean
  readonly cells: readonly number[]
}

export interface Fleet {
  readonly ships: readonly Ship[]
  /** 全部舰格（升序） */
  readonly cells: readonly number[]
  /** 64 格掩码：true = 该格有舰 */
  readonly mask: readonly boolean[]
}

function shipCellsAt(start: number, length: number, horizontal: boolean): number[] | null {
  const row = rowOf(start)
  const col = colOf(start)
  if (horizontal) {
    if (col + length > BOARD_SIZE) return null
    return Array.from({ length }, (_, step) => indexOf(row, col + step))
  }
  if (row + length > BOARD_SIZE) return null
  return Array.from({ length }, (_, step) => indexOf(row + step, col))
}

/** 一次摆放尝试（成功返回舰只列表，摆不下返回 null） */
function tryPlace(rng: Rng, lengths: readonly number[]): Ship[] | null {
  // forbidden：已放舰的格子 + 它们的 8 邻域（保证互不接触含对角）
  const forbidden = new Uint8Array(CELLS)
  const ships: Ship[] = []
  for (let id = 0; id < lengths.length; id++) {
    const length = lengths[id]!
    const candidates: Array<{ start: number; horizontal: boolean; cells: number[] }> = []
    for (let start = 0; start < CELLS; start++) {
      for (const horizontal of [true, false]) {
        const cells = shipCellsAt(start, length, horizontal)
        if (cells === null) continue
        if (cells.some((cell) => forbidden[cell] === 1)) continue
        candidates.push({ start, horizontal, cells })
      }
    }
    if (candidates.length === 0) return null
    // 候选顺序是确定的（行优先、先横后竖），用随机流挑一个
    const picked = candidates[rng.int(candidates.length)]!
    ships.push({ id, length, start: picked.start, horizontal: picked.horizontal, cells: picked.cells })
    for (const cell of picked.cells) {
      forbidden[cell] = 1
      for (const neighbor of neighbors8(cell)) forbidden[neighbor] = 1
    }
  }
  return ships
}

function toFleet(ships: readonly Ship[]): Fleet {
  const mask = new Array<boolean>(CELLS).fill(false)
  const cells: number[] = []
  for (const ship of ships) {
    for (const cell of ship.cells) {
      mask[cell] = true
      cells.push(cell)
    }
  }
  cells.sort((a, b) => a - b)
  return { ships, cells, mask }
}

/**
 * 按 seed + 难度自动摆放一支舰队。
 * 摆不下时换一条随机流重试（最多 32 次），因此同 seed 必然同布局；全失败才报错。
 */
export function placeFleet(seed: number, difficulty: DifficultyId, side: Side): Fleet {
  const normalized = normalizeSeed(seed)
  const offset = side === ENEMY ? ENEMY_FLEET_OFFSET : 0
  const lengths = shipLengths(difficulty)
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const rng = createRng(normalized + offset + attempt * RETRY_SALT)
    const ships = tryPlace(rng, lengths)
    if (ships !== null) return toFleet(ships)
  }
  throw new IllegalActionError(GAME_ID, 'battleship.illegal.fleet-placement')
}

/** 两艘舰是否接触（含对角） */
export function shipsTouch(a: Ship, b: Ship): boolean {
  for (const cell of a.cells) {
    if (b.cells.includes(cell)) return true
    for (const neighbor of neighbors8(cell)) {
      if (b.cells.includes(neighbor)) return true
    }
  }
  return false
}

/**
 * 海战棋状态。两张射击记录分开存：
 * - `playerShots` 是玩家打敌方海域的格子；
 * - `enemyShots` 是白方打我方海域的格子（同一格双方都可能打过，互不影响）。
 */
export interface BattleshipState {
  readonly difficulty: DifficultyId
  readonly seed: number
  readonly playerFleet: Fleet
  readonly enemyFleet: Fleet
  readonly playerShots: readonly boolean[]
  readonly enemyShots: readonly boolean[]
  /** 现在轮到谁。可对局时恒为 player（白方应手在同一次 reduce 内算完） */
  readonly turn: Side
  /** 玩家射击次数（白方应手不计；撤销会回退） */
  readonly moves: number
  /** 已应手过的白方回合数：白方每回合用 createRng(seed + AI_SEED_OFFSET + 该值) 取一次随机流 */
  readonly rngCursor: number
  /** 最后一手（可能是白方打的，用于存档校验） */
  readonly lastShot: number | null
  /** 玩家最后一手（棋盘上高亮它，因为棋盘画的是敌方海域） */
  readonly lastPlayerShot: number | null
  /** 双方全部射击的日志（动作日志即存档） */
  readonly log: readonly number[]
}

export function emptyShots(): boolean[] {
  return new Array<boolean>(CELLS).fill(false)
}

export function createBoardState(seed: number, difficulty: DifficultyId): BattleshipState {
  const normalized = normalizeSeed(seed)
  return {
    difficulty,
    seed: normalized,
    playerFleet: placeFleet(normalized, difficulty, PLAYER),
    enemyFleet: placeFleet(normalized, difficulty, ENEMY),
    playerShots: emptyShots(),
    enemyShots: emptyShots(),
    turn: PLAYER,
    moves: 0,
    rngCursor: 0,
    lastShot: null,
    lastPlayerShot: null,
    log: [],
  }
}

/** 该方还没打过的格（升序） */
export function untriedCells(state: BattleshipState, side: Side): number[] {
  const shots = side === PLAYER ? state.playerShots : state.enemyShots
  const out: number[] = []
  for (let index = 0; index < CELLS; index++) if (!shots[index]) out.push(index)
  return out
}

/** 该方打中了吗（射击目标舰队里有没有舰） */
export function isHit(state: BattleshipState, side: Side, index: number): boolean {
  const fleet = side === PLAYER ? state.enemyFleet : state.playerFleet
  return fleet.mask[index] === true
}

/** 某支舰队还剩多少格没被打中 */
export function remainingShipCells(state: BattleshipState, side: Side): number {
  const fleet = side === PLAYER ? state.playerFleet : state.enemyFleet
  const shots = side === PLAYER ? state.enemyShots : state.playerShots
  return fleet.cells.filter((cell) => !shots[cell]).length
}

/** 某支舰队已被击沉的舰数 */
export function sunkShips(state: BattleshipState, side: Side): number {
  const fleet = side === PLAYER ? state.playerFleet : state.enemyFleet
  const shots = side === PLAYER ? state.enemyShots : state.playerShots
  return fleet.ships.filter((ship) => ship.cells.every((cell) => shots[cell])).length
}

/**
 * 纯局面转移：当前这一方射击 index。
 * - 非法（越界 / 这一方已经打过这格）抛 IllegalActionError；
 * - 命中则**当前方继续射击**；未中则换手，换到白方时随机游标 +1（白方每回合正好消耗一条随机流）。
 */
export function applyShot(state: BattleshipState, index: number): BattleshipState {
  if (!inRange(index)) {
    throw new IllegalActionError(GAME_ID, `battleship.illegal.fire:${String(index)}`)
  }
  const side = state.turn
  const shots = side === PLAYER ? state.playerShots : state.enemyShots
  if (shots[index]) {
    throw new IllegalActionError(GAME_ID, `battleship.illegal.duplicate:${index}`)
  }
  const nextShots = shots.slice()
  nextShots[index] = true
  const hit = isHit(state, side, index)
  const moves = side === PLAYER ? state.moves + 1 : state.moves
  let turn = side
  let rngCursor = state.rngCursor
  if (!hit) {
    turn = otherSide(side)
    if (turn === ENEMY) rngCursor += 1
  }
  return {
    ...state,
    playerShots: side === PLAYER ? nextShots : state.playerShots,
    enemyShots: side === ENEMY ? nextShots : state.enemyShots,
    turn,
    moves,
    rngCursor,
    lastShot: index,
    lastPlayerShot: side === PLAYER ? index : state.lastPlayerShot,
    log: [...state.log, index],
  }
}
