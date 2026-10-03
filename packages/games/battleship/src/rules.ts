/**
 * 海战棋规则层：动作、白方自动应手、撤销一整回合与存档编解码（纯函数，无副作用）。
 *
 * 与 dotsboxes / checkers 同一套「动作日志即存档」：
 * - 双方舰队都由 `(seed, difficulty)` 确定，日志只需要记「打过的格」；
 * - 日志不含「谁打的」——轮次转移规则是确定的（命中继续、未中换手），重放时按同一套规则复算；
 * - `undo` 把日志截断到最近一次**玩家回合起点**再重放：玩家的连打与白方应手一起退回；
 * - `decode` 从 `(seed, difficulty, log)` 复算双方布局与射击记录并逐字段比对：
 *   「凭空多一次命中」「布局与 seed 不符」「谁打的不对」都会被拒绝。
 *
 * 白方应手在同一次 reduce 内算完（含命中连打）；随机只来自
 * `createRng(seed + AI_SEED_OFFSET + 白方回合数)`。
 */
import { IllegalActionError, createRng, type GameStatus } from '@eink/core'
import { chooseShot } from './ai.js'
import {
  AI_SEED_OFFSET,
  CELLS,
  ENEMY,
  PLAYER,
  applyShot,
  createBoardState,
  difficultyOrThrow,
  inRange,
  remainingShipCells,
  shipLengths,
  untriedCells,
  type BattleshipState,
  type DifficultyId,
  type Fleet,
} from './board.js'

export type BattleshipAction =
  /** 射击敌方海域的 index 格。重复打同一格 / 越界 / 非整数都抛 IllegalActionError */
  | { type: 'fire'; index: number }
  /** 撤回一整回合（玩家的连打 + 白方应手）。没有历史时抛错 */
  | { type: 'undo' }
  /** 重开：同 seed 同难度回到同一布局。壳层会无条件派发，必须接受 */
  | { type: 'restart' }

function illegal(reason: string): IllegalActionError {
  return new IllegalActionError('battleship', reason)
}

/** 起始局面：双方舰队按 seed 摆好，玩家先手 */
export function createState(seed: number, difficulty: DifficultyId): BattleshipState {
  return createBoardState(seed, difficulty)
}

/**
 * 胜负：敌方舰格全被打中 → won；我方舰格全被打中 → lost。
 * 海战没有平局，因此三态协议直接映射。
 */
export function gameStatus(state: BattleshipState): GameStatus {
  if (remainingShipCells(state, PLAYER) === 0) return 'lost'
  if (remainingShipCells(state, ENEMY) === 0) return 'won'
  return 'playing'
}

export function outcomeOf(state: BattleshipState): 'won' | 'lost' {
  return remainingShipCells(state, ENEMY) === 0 ? 'won' : 'lost'
}

function assertPlaying(state: BattleshipState): void {
  if (gameStatus(state) !== 'playing') throw illegal('game already finished')
}

interface DerivedShape {
  readonly state: BattleshipState
  /** 每一次玩家回合在 log 中的起始下标（撤销按它截断） */
  readonly playerTurnStarts: readonly number[]
}

/**
 * 从 `(seed, difficulty, log)` 重放：先按 seed 复算双方舰队，再按顺序施放每一发。
 * 命中继续、未中换手，轮次完全由规则推出。
 */
export function deriveWithMeta(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): DerivedShape {
  let state = createBoardState(seed, difficulty)
  const playerTurnStarts: number[] = []
  let turnStart = true
  for (let index = 0; index < log.length; index++) {
    if (state.turn === PLAYER && turnStart) playerTurnStarts.push(index)
    const before = state.turn
    state = applyShot(state, log[index]!)
    // 换手了 ⇒ 下一发是新回合；命中连打则仍是同一回合
    turnStart = state.turn !== before
  }
  return { state, playerTurnStarts }
}

export function deriveState(
  seed: number,
  difficulty: DifficultyId,
  log: readonly number[],
): BattleshipState {
  return deriveWithMeta(seed, difficulty, log).state
}

/**
 * 白方应手：`cursor` 是本回合开始前已应手过的白方回合数。
 * 只有轮到白方且对局未结束时才应手；命中连打会在循环里走完。
 */
function resolveOpponent(state: BattleshipState, cursor: number): BattleshipState {
  if (state.turn !== ENEMY) return state
  if (gameStatus(state) !== 'playing') return state
  const rng = createRng(state.seed + AI_SEED_OFFSET + cursor)
  let current = state
  let guard = 0
  while (current.turn === ENEMY && gameStatus(current) === 'playing') {
    // 格子有限，正常不可能走满循环；多一层护栏避免实现出错时死循环
    if (guard++ > CELLS) throw illegal('battleship.illegal.opponent-loop')
    const shot = chooseShot(current, current.difficulty, rng)
    current = applyShot(current, shot)
  }
  return current
}

export function reduceBattleship(
  state: BattleshipState,
  action: BattleshipAction,
): BattleshipState {
  switch (action.type) {
    case 'fire': {
      assertPlaying(state)
      // 白方应手用的游标是「本回合开始前」的值：applyShot 之后游标才 +1
      const cursor = state.rngCursor
      const next = applyShot(state, action.index)
      return resolveOpponent(next, cursor)
    }

    case 'undo': {
      const { playerTurnStarts } = deriveWithMeta(state.seed, state.difficulty, state.log)
      const start = playerTurnStarts[playerTurnStarts.length - 1]
      if (start === undefined) throw illegal('battleship.illegal.nothing-to-undo')
      // 截断到最近一次玩家回合起点：玩家的连打与白方应手一起退回
      return deriveState(state.seed, state.difficulty, state.log.slice(0, start))
    }

    case 'restart':
      // 同 seed 同难度重开：回到同一布局（对局结束后也必须可用）
      return createState(state.seed, state.difficulty)

    default: {
      // 未知动作（方向键、旧存档、壳层误派）明确报错，避免静默无响应
      const unknown = action as { type?: unknown }
      throw illegal(`battleship.illegal.action:${String(unknown.type)}`)
    }
  }
}

/** 当前局面下被规则允许的动作（供禁用按钮与回放校验） */
export function legalActions(state: BattleshipState): BattleshipAction[] {
  const out: BattleshipAction[] = []
  if (gameStatus(state) === 'playing') {
    for (const index of untriedCells(state, PLAYER)) out.push({ type: 'fire', index })
  }
  if (state.log.length > 0) out.push({ type: 'undo' })
  out.push({ type: 'restart' })
  return out
}

/**
 * 「点了第 index 个格子」→ 动作。
 * 只有玩家还没打过的格才返回 fire；已打过、越界都返回 null ——
 * 点了没反应比报错自然，也让壳层不可能点到必然抛错的位置。
 */
export function selectAction(state: BattleshipState, index: number): BattleshipAction | null {
  if (gameStatus(state) !== 'playing') return null
  if (!inRange(index)) return null
  if (state.playerShots[index]) return null
  return { type: 'fire', index }
}

export function encodeState(state: BattleshipState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    // 布局是 (seed, 难度) 的函数，但存档里也写一份，decode 会与复算结果比对
    playerShips: state.playerFleet.ships.map((ship) => ({
      start: ship.start,
      horizontal: ship.horizontal,
    })),
    enemyShips: state.enemyFleet.ships.map((ship) => ({
      start: ship.start,
      horizontal: ship.horizontal,
    })),
    playerShots: [...state.playerShots],
    enemyShots: [...state.enemyShots],
    turn: state.turn,
    moves: state.moves,
    rngCursor: state.rngCursor,
    lastShot: state.lastShot,
    lastPlayerShot: state.lastPlayerShot,
    log: [...state.log],
  }
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw illegal(`battleship.illegal.state:${field}`)
  }
  return value
}

function readShotList(value: unknown, field: string): boolean[] {
  if (!Array.isArray(value) || value.length !== CELLS) {
    throw illegal(`battleship.illegal.state:${field}`)
  }
  return value.map((item) => {
    if (typeof item !== 'boolean') throw illegal(`battleship.illegal.state:${field}`)
    return item
  })
}

function readLog(value: unknown): number[] {
  if (!Array.isArray(value)) throw illegal('battleship.illegal.state:log')
  return value.map((item) => {
    const index = readCount(item, 'log')
    if (index >= CELLS) throw illegal('battleship.illegal.state:log')
    return index
  })
}

function readShips(
  value: unknown,
  field: string,
  expected: readonly number[],
): Array<{ start: number; horizontal: boolean }> {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw illegal(`battleship.illegal.state:${field}`)
  }
  // 舰长由难度决定，因此这里只校验数量与「首格在盘内」；
  // 具体的摆放几何交给下面与复算结果逐舰比对
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw illegal(`battleship.illegal.state:${field}`)
    const ship = item as { start?: unknown; horizontal?: unknown }
    const start = readCount(ship.start, field)
    if (start >= CELLS) throw illegal(`battleship.illegal.state:${field}`)
    if (typeof ship.horizontal !== 'boolean') throw illegal(`battleship.illegal.state:${field}`)
    return { start, horizontal: ship.horizontal }
  })
}

function sameShips(
  a: readonly { start: number; horizontal: boolean }[],
  b: Fleet,
): boolean {
  return (
    a.length === b.ships.length &&
    a.every((ship, index) => ship.start === b.ships[index]!.start && ship.horizontal === b.ships[index]!.horizontal)
  )
}

function sameShotList(a: readonly boolean[], b: readonly boolean[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/**
 * 严格校验存档：从 `(seed, difficulty, log)` 复算布局与射击记录，并逐字段比对。
 * 复算会拒绝非法日志（重复打同一格、越界），比对则拒绝
 * 「凭空多一次命中」「布局与 seed 不符」「轮次/步数/游标对不上」。
 */
export function decodeState(raw: unknown): BattleshipState {
  if (!raw || typeof raw !== 'object') throw illegal('battleship.illegal.state:root')
  const value = raw as Partial<{
    difficulty: unknown
    seed: unknown
    playerShips: unknown
    enemyShips: unknown
    playerShots: unknown
    enemyShots: unknown
    turn: unknown
    moves: unknown
    rngCursor: unknown
    lastShot: unknown
    lastPlayerShot: unknown
    log: unknown
  }>
  const difficulty = difficultyOrThrow(String(value.difficulty ?? ''))
  const seed = readCount(value.seed, 'seed')
  if (seed > 0xffffffff) throw illegal('battleship.illegal.state:seed')
  const lengths = shipLengths(difficulty)
  const storedPlayer = readShips(value.playerShips, 'playerShips', lengths)
  const storedEnemy = readShips(value.enemyShips, 'enemyShips', lengths)
  const log = readLog(value.log)
  const derived = deriveWithMeta(seed, difficulty, log)

  // 布局必须与 (seed, 难度) 复算出来的完全一致
  if (!sameShips(storedPlayer, derived.state.playerFleet)) {
    throw illegal('battleship.illegal.state:player-fleet-mismatch')
  }
  if (!sameShips(storedEnemy, derived.state.enemyFleet)) {
    throw illegal('battleship.illegal.state:enemy-fleet-mismatch')
  }
  const playerShots = readShotList(value.playerShots, 'playerShots')
  if (!sameShotList(playerShots, derived.state.playerShots)) {
    throw illegal('battleship.illegal.state:player-shots-mismatch')
  }
  const enemyShots = readShotList(value.enemyShots, 'enemyShots')
  if (!sameShotList(enemyShots, derived.state.enemyShots)) {
    throw illegal('battleship.illegal.state:enemy-shots-mismatch')
  }
  const turn = value.turn === PLAYER || value.turn === ENEMY ? value.turn : null
  if (turn === null || turn !== derived.state.turn) {
    throw illegal('battleship.illegal.state:turn-mismatch')
  }
  const moves = readCount(value.moves, 'moves')
  if (moves !== derived.state.moves) throw illegal('battleship.illegal.state:moves-mismatch')
  const rngCursor = readCount(value.rngCursor, 'rngCursor')
  if (rngCursor !== derived.state.rngCursor) {
    throw illegal('battleship.illegal.state:cursor-mismatch')
  }
  const lastShot =
    value.lastShot === null || value.lastShot === undefined ? null : readCount(value.lastShot, 'lastShot')
  if (lastShot !== derived.state.lastShot) {
    throw illegal('battleship.illegal.state:last-shot-mismatch')
  }
  const lastPlayerShot =
    value.lastPlayerShot === null || value.lastPlayerShot === undefined
      ? null
      : readCount(value.lastPlayerShot, 'lastPlayerShot')
  if (lastPlayerShot !== derived.state.lastPlayerShot) {
    throw illegal('battleship.illegal.state:last-player-shot-mismatch')
  }
  // 可对局时必然是玩家该走（白方应手在同一次 reduce 内算完，不会把控制权交出去）
  if (gameStatus(derived.state) === 'playing' && derived.state.turn !== PLAYER) {
    throw illegal('battleship.illegal.state:enemy-to-move')
  }
  return derived.state
}
