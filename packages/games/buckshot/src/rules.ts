/**
 * 恶魔轮盘赌的 GameDef 层。
 *
 * 两种模式由「难度」选择（详情页的难度区就是模式选择，壳层不用改）：
 *   - 入门 / 熟练 / 挑战：你（0 号位）对恶魔（1 号位，电脑）；恶魔的每一步由 tickMs + { type: 'tick' } 推进；
 *   - 无尽 endless：对恶魔一轮接一轮，输掉一轮才结束；恶魔每 3 轮升一档（入门 → 熟练 → 挑战），成绩 = 赢下的轮数；
 *   - 双人同屏 hotseat：两个人在同一台设备上轮流，0 号位在下方、1 号位在上方，按钮永远替「当前行动者」操作。
 *
 * 状态只存 (difficulty, seed, log)：局面由 engine.replayDuel 复算，decode 逐步重放校验。
 */
import { IllegalActionError, createRng, type GameStatus } from '@eink/core'
import { decideMove, type DifficultyId as BotLevel } from './ai.js'
import {
  GAME_ID,
  SEATS,
  applyMove,
  opponent,
  replayDuel,
  type DuelState,
  type LoggedMove,
  type Mode,
  type Move,
  type Seat,
} from './engine.js'
import { observe } from './observe.js'

export { GAME_ID }

export const RULES_VERSION = 1
export const CONTENT_VERSION = 1
/** 恶魔每一步的间隔：墨水屏上看得清它用了什么、打了谁（≥ MIN_TICK_MS） */
export const DEVIL_DELAY_MS = 1000
export const DIFFICULTY_IDS = ['starter', 'skilled', 'challenging', 'endless', 'hotseat'] as const
/** 无尽模式里恶魔每隔几轮升一档 */
export const ENDLESS_LEVEL_EVERY = 3
const ENDLESS_LEVELS: readonly BotLevel[] = ['starter', 'skilled', 'challenging']
export type DifficultyId = (typeof DIFFICULTY_IDS)[number]

export interface BuckshotState {
  difficulty: DifficultyId
  seed: number
  log: LoggedMove[]
}

export type BuckshotAction =
  | { type: 'begin' }
  | { type: 'item'; slot: number }
  | { type: 'shoot'; target: 'self' | 'opponent' }
  | { type: 'nextRound' }
  | { type: 'tick' }

function illegal(reason: string): never {
  throw new IllegalActionError(GAME_ID, reason)
}

export function isDifficulty(value: unknown): value is DifficultyId {
  return typeof value === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(value)
}

export function modeOf(difficulty: DifficultyId): Mode {
  if (difficulty === 'hotseat') return 'hotseat'
  return difficulty === 'endless' ? 'endless' : 'vs'
}

/** 有没有恶魔（1 号位是电脑）：对恶魔三档与无尽都有，双人同屏没有 */
export function hasDevil(difficulty: DifficultyId): boolean {
  return modeOf(difficulty) !== 'hotseat'
}

/** 恶魔这一轮用哪一档：固定难度就是难度本身；无尽模式按轮数升档（第 1～3 轮入门、4～6 熟练、7 轮起挑战） */
export function devilLevelAt(difficulty: DifficultyId, round: number): BotLevel | null {
  if (!hasDevil(difficulty)) return null
  if (difficulty !== 'endless') return difficulty as BotLevel
  return ENDLESS_LEVELS[Math.min(Math.floor(round / ENDLESS_LEVEL_EVERY), ENDLESS_LEVELS.length - 1)]!
}

/** 无尽模式的成绩：赢下的轮数（其它模式没有成绩，返回 null） */
export function scoreOf(state: BuckshotState): number | null {
  if (state.difficulty !== 'endless') return null
  return duelOf(state).roundWins[0]
}

export function createState(seed: number, difficulty: string): BuckshotState {
  if (!isDifficulty(difficulty)) illegal(`unknown difficulty ${difficulty}`)
  return { difficulty, seed: seed >>> 0, log: [] }
}

const duelCache = new WeakMap<readonly LoggedMove[], { seed: number; mode: Mode; duel: DuelState }>()
export function duelOf(state: BuckshotState): DuelState {
  const mode = modeOf(state.difficulty)
  const hit = duelCache.get(state.log)
  if (hit && hit.seed === state.seed && hit.mode === mode) return hit.duel
  const duel = replayDuel(state.seed, mode, state.log)
  duelCache.set(state.log, { seed: state.seed, mode, duel })
  return duel
}

/** 这个座位现在是不是真人在操作（对恶魔时 1 号位是电脑） */
export function isHuman(state: BuckshotState, seat: Seat): boolean {
  return modeOf(state.difficulty) === 'hotseat' || seat === 0
}

/** 真人此刻能替哪个座位操作（null = 现在轮到电脑） */
export function humanActor(state: BuckshotState): Seat | null {
  const duel = duelOf(state)
  if (modeOf(state.difficulty) === 'hotseat') return duel.turn
  return duel.turn === 0 ? 0 : null
}

function commit(state: BuckshotState, duel: DuelState, entry: LoggedMove): BuckshotState {
  const next = applyMove(duel, entry.seat, entry.move)
  const log = [...state.log, entry]
  duelCache.set(log, { seed: state.seed, mode: duel.mode, duel: next })
  return { ...state, log }
}

/** 道具在当前局面能不能用（手铐不能叠、手锯不能重复） */
export function itemUsable(duel: DuelState, seat: Seat, slot: number): boolean {
  const item = duel.items[seat][slot]
  if (item === undefined) return false
  if (item === 'handcuffs') return !duel.cuffed[opponent(seat)]
  if (item === 'saw') return !duel.saw
  return true
}

export function reduceState(state: BuckshotState, action: BuckshotAction): BuckshotState {
  const duel = duelOf(state)
  const actor = humanActor(state)
  switch (action?.type) {
    case 'begin':
    case 'nextRound': {
      // 装填后的「开始」与轮间的「下一轮」：对恶魔时总是真人按；同屏时记在当前行动者名下
      const seat: Seat = modeOf(state.difficulty) === 'hotseat' ? duel.turn : 0
      return commit(state, duel, { seat, move: { kind: action.type } })
    }
    case 'item':
    case 'shoot': {
      if (duel.phase !== 'turn' || actor === null) illegal('not your turn')
      const move: Move =
        action.type === 'item' ? { kind: 'item', slot: action.slot } : { kind: 'shoot', target: action.target }
      return commit(state, duel, { seat: actor, move })
    }
    case 'tick': {
      const level = devilLevelAt(state.difficulty, duel.round)
      if (level === null || duel.phase !== 'turn' || duel.turn !== 1) illegal('the devil is not due to act')
      const rng = createRng((state.seed ^ Math.imul(state.log.length + 1, 0x27d4eb2f)) >>> 0)
      return commit(state, duel, { seat: 1, move: decideMove(observe(duel, 1), level, rng) })
    }
    default:
      illegal(`unknown action ${JSON.stringify(action)}`)
  }
}

export function statusOf(state: BuckshotState): GameStatus {
  const duel = duelOf(state)
  if (duel.phase !== 'matchOver') return 'playing'
  if (modeOf(state.difficulty) === 'hotseat') return 'won'
  // 无尽模式只会以输掉一轮收场；成绩（赢下的轮数）由 scoreOf 交给壳层记最高纪录
  return duel.winner === 0 ? 'won' : 'lost'
}

export function tickMsOf(state: BuckshotState): number | null {
  const duel = duelOf(state)
  return hasDevil(state.difficulty) && duel.phase === 'turn' && duel.turn === 1 ? DEVIL_DELAY_MS : null
}

export function legalActions(state: BuckshotState): BuckshotAction[] {
  const duel = duelOf(state)
  if (duel.phase === 'load') return [{ type: 'begin' }]
  if (duel.phase === 'roundOver') return [{ type: 'nextRound' }]
  if (duel.phase === 'matchOver') return []
  const actor = humanActor(state)
  if (actor === null) return [{ type: 'tick' }]
  const out: BuckshotAction[] = []
  duel.items[actor].forEach((_, slot) => {
    if (itemUsable(duel, actor, slot)) out.push({ type: 'item', slot })
  })
  out.push({ type: 'shoot', target: 'self' }, { type: 'shoot', target: 'opponent' })
  return out
}

/* ------------------------------------------------------------------ 存档 */

export function encodeState(state: BuckshotState): unknown {
  return {
    difficulty: state.difficulty,
    seed: state.seed,
    log: state.log.map((entry) => ({ seat: entry.seat, move: { ...entry.move } })),
  }
}

function readMove(raw: unknown): Move {
  if (!raw || typeof raw !== 'object') illegal('bad move')
  const move = raw as { kind?: unknown; slot?: unknown; target?: unknown }
  if (move.kind === 'begin' || move.kind === 'nextRound') return { kind: move.kind }
  if (move.kind === 'item') {
    if (typeof move.slot !== 'number' || !Number.isInteger(move.slot)) illegal('bad slot')
    return { kind: 'item', slot: move.slot }
  }
  if (move.kind === 'shoot') {
    if (move.target !== 'self' && move.target !== 'opponent') illegal('bad target')
    return { kind: 'shoot', target: move.target }
  }
  illegal('bad move kind')
}

/** 严格解码（重放式）：结构校验后从头重放日志，任何一步不合法都抛错（存档损坏，保留原档） */
export function decodeState(raw: unknown): BuckshotState {
  if (!raw || typeof raw !== 'object') illegal('bad state')
  const value = raw as Record<string, unknown>
  if (!isDifficulty(value.difficulty)) illegal('bad difficulty')
  const seed = value.seed
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) illegal('bad seed')
  if (!Array.isArray(value.log)) illegal('bad log')
  const log: LoggedMove[] = value.log.map((entry) => {
    if (!entry || typeof entry !== 'object') illegal('bad log entry')
    const seat = (entry as { seat?: unknown }).seat
    if (!SEATS.includes(seat as Seat)) illegal('bad seat')
    return { seat: seat as Seat, move: readMove((entry as { move?: unknown }).move) }
  })
  // 对恶魔时，「开始」「下一轮」只会记在真人（0 号位）名下；恶魔只会在自己的回合里用道具 / 开枪（由引擎校验回合）
  if (hasDevil(value.difficulty) && log.some((e) => e.seat === 1 && (e.move.kind === 'begin' || e.move.kind === 'nextRound'))) {
    illegal('the devil never presses begin / next round')
  }
  const state: BuckshotState = { difficulty: value.difficulty, seed, log }
  replayDuel(seed, modeOf(value.difficulty), log) // 非法步骤在这里抛错
  return state
}
